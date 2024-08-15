const axios = require('axios');
const https = require('https');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const rimraf = require('rimraf');

// GitLab API configuration
const GITLAB_URL = 'https://gitlab-devops.aeonth.com';
const GITLAB_API = `${GITLAB_URL}/api/v4`;

// Template repository URLs
const CI_TEMPLATE_URL = 'git@gitlab-devops.aeonth.com:devops/pipeline-template/ci-template/ci-example.git';
const CD_TEMPLATE_URL = 'git@gitlab-devops.aeonth.com:devops/pipeline-template/cd-template/cd-example.git';

// Parent paths for CI and CD
const CI_PARENT_PATH = 'devops/pipeline-template/ci';
const CD_PARENT_PATH = 'devops/pipeline-template/cd';

// Create a custom HTTPS agent that ignores SSL certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Create an axios instance with the custom agent
const axiosInstance = axios.create({
  httpsAgent: httpsAgent
});

// Function to read GitLab token from file
async function getGitlabToken() {
  try {
    const token = await fs.readFile('gitlab_token.txt', 'utf8');
    return token.trim();
  } catch (error) {
    console.error('Error reading GitLab token:', error.message);
    throw error;
  }
}

// Function to get parent group ID
async function getParentGroupId(token, parentPath) {
  console.log(`Retrieving parent group ID for path: ${parentPath}`);
  try {
    const response = await axiosInstance.get(`${GITLAB_API}/groups`, {
      params: { search: parentPath },
      headers: { 'PRIVATE-TOKEN': token }
    });
    
    const group = response.data.find(g => g.full_path === parentPath);
    if (group) {
      console.log(`Parent group ID found: ${group.id}`);
      return group.id;
    } else {
      throw new Error(`Parent group not found for path: ${parentPath}`);
    }
  } catch (error) {
    console.error(`Error retrieving parent group ID: ${error.message}`);
    throw error;
  }
}

async function getOrCreateGitlabFolder(teamName, parentId, token) {
  console.log(`Checking if GitLab folder exists for team: ${teamName}`);
  try {
    // First, try to get the group
    const response = await axiosInstance.get(`${GITLAB_API}/groups`, {
      params: { search: teamName },
      headers: { 'PRIVATE-TOKEN': token }
    });

    const existingGroup = response.data.find(g => g.name === teamName && g.parent_id === parentId);
    
    if (existingGroup) {
      console.log(`Folder ${teamName} already exists. Using existing folder.`);
      return existingGroup.id;
    }

    // If the group doesn't exist, create it
    console.log(`Creating GitLab folder for team: ${teamName}`);
    const createResponse = await axiosInstance.post(`${GITLAB_API}/groups`, {
      name: teamName,
      path: teamName,
      parent_id: parentId,
    }, {
      headers: { 'PRIVATE-TOKEN': token }
    });
    
    console.log(`Folder created successfully: ${createResponse.data.web_url}`);
    return createResponse.data.id;
  } catch (error) {
    console.error(`Error handling GitLab folder: ${error.message}`);
    throw error;
  }
}

async function createGitlabProject(projectName, groupId, token) {
  console.log(`Creating GitLab project: ${projectName}`);
  try {
    const response = await axiosInstance.post(`${GITLAB_API}/projects`, {
      name: projectName,
      path: projectName,
      namespace_id: groupId,
    }, {
      headers: { 'PRIVATE-TOKEN': token }
    });
    console.log(`Project created successfully: ${response.data.web_url}`);
    return response.data.ssh_url_to_repo;
  } catch (error) {
    if (error.response && error.response.status === 409) {
      console.log(`Project ${projectName} already exists. Skipping creation.`);
      return null;
    }
    console.error(`Error creating project: ${error.message}`);
    throw error;
  }
}

async function modifyFiles(dirPath, appName, teamName) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await modifyFiles(fullPath, appName, teamName);
    } else if (entry.isFile()) {
      let content = await fs.readFile(fullPath, 'utf8');
      content = content.replace(/{{VALUE_APP_NAME}}/g, appName)
                       .replace(/{{VALUE_TEAM_NAME}}/g, teamName);
      await fs.writeFile(fullPath, content);
    }
  }
}

async function cloneAndModifyRepository(templateUrl, localPath, appName, teamName) {
  console.log(`Cloning template repository: ${templateUrl}`);
  await simpleGit().clone(templateUrl, localPath);
  
  console.log('Removing .git directory...');
  await fs.rm(path.join(localPath, '.git'), { recursive: true, force: true });

  console.log('Modifying files...');
  await modifyFiles(localPath, appName, teamName);
}

async function pushToGitlab(localPath, remoteUrl) {
  console.log(`Pushing changes to GitLab: ${remoteUrl}`);
  const git = simpleGit(localPath);
  await git.init();
  await git.add('./*');
  await git.commit('Initial commit');
  await git.addRemote('origin', remoteUrl);
  await git.push('origin', 'master', ['--force']);
}

function generateUniqueId() {
  return crypto.randomBytes(8).toString('hex');
}

async function setupCICD(appName, teamName) {
  const uniqueId = generateUniqueId();
  const tempDir = path.join(process.cwd(), `temp_${uniqueId}`);
  
  try {
    const token = await getGitlabToken();

    // CI Setup
    console.log('Setting up CI...');
    const ciParentId = await getParentGroupId(token, CI_PARENT_PATH);
    const ciGroupId = await getOrCreateGitlabFolder(teamName, ciParentId, token);
    const ciProjectName = `ci-${appName}`;
    const ciProjectUrl = await createGitlabProject(ciProjectName, ciGroupId, token);
    if (ciProjectUrl) {
      const ciLocalPath = path.join(tempDir, ciProjectName);
      await cloneAndModifyRepository(CI_TEMPLATE_URL, ciLocalPath, appName, teamName);
      await pushToGitlab(ciLocalPath, ciProjectUrl);
    }

    // CD Setup
    console.log('Setting up CD...');
    const cdParentId = await getParentGroupId(token, CD_PARENT_PATH);
    const cdGroupId = await getOrCreateGitlabFolder(teamName, cdParentId, token);
    const cdProjectName = `cd-${appName}`;
    const cdProjectUrl = await createGitlabProject(cdProjectName, cdGroupId, token);
    if (cdProjectUrl) {
      const cdLocalPath = path.join(tempDir, cdProjectName);
      await cloneAndModifyRepository(CD_TEMPLATE_URL, cdLocalPath, appName, teamName);
      await pushToGitlab(cdLocalPath, cdProjectUrl);
    }

    console.log('CI/CD setup completed successfully!');
  } catch (error) {
    console.error('Error during CI/CD setup:', error.message);
  } finally {
    console.log('Cleaning up temporary files...');
    rimraf.sync(tempDir);
  }
}

// Usage
setupCICD('otpapi', 'infra'); //
