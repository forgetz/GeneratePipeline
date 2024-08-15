const axios = require('axios');
const https = require('https');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');

// GitLab API configuration
const GITLAB_URL = 'https://gitlab-devops.aeonth.com';
const GITLAB_API = `${GITLAB_URL}/api/v4`;

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

async function createGitlabFolder(teamName, token) {
  console.log(`Creating GitLab folder for team: ${teamName}`);
  try {
    const response = await axiosInstance.post(`${GITLAB_API}/groups`, {
      name: teamName,
      path: teamName,
      parent_id: 'PARENT_GROUP_ID', // Replace with the actual parent group ID
    }, {
      headers: { 'PRIVATE-TOKEN': token }
    });
    console.log(`Folder created successfully: ${response.data.web_url}`);
    return response.data.id;
  } catch (error) {
    if (error.response && error.response.status === 409) {
      console.log(`Folder ${teamName} already exists. Skipping creation.`);
      return null;
    }
    console.error(`Error creating folder: ${error.message}`);
    throw error;
  }
}

async function createGitlabProject(projectName, groupId, token) {
  console.log(`Creating GitLab project: ${projectName}`);
  try {
    const response = await axiosInstance.post(`${GITLAB_API}/projects`, {
      name: projectName,
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

async function cloneAndModifyRepository(templateUrl, localPath, appName, teamName) {
  console.log(`Cloning template repository: ${templateUrl}`);
  await simpleGit().clone(templateUrl, localPath);

  console.log('Modifying files...');
  const files = await fs.readdir(localPath);
  for (const file of files) {
    const filePath = path.join(localPath, file);
    let content = await fs.readFile(filePath, 'utf8');
    content = content.replace(/{{VALUE_APP_NAME}}/g, appName)
                     .replace(/{{VALUE_TEAM_NAME}}/g, teamName);
    await fs.writeFile(filePath, content);
  }
}

async function pushToGitlab(localPath, remoteUrl) {
  console.log(`Pushing changes to GitLab: ${remoteUrl}`);
  const git = simpleGit(localPath);
  await git.add('./*');
  await git.commit('Initial commit');
  await git.push(remoteUrl, 'master');
}

async function setupCICD(appName, teamName) {
  try {
    const token = await getGitlabToken();

    // CI Setup
    const ciGroupId = await createGitlabFolder(teamName, token);
    const ciProjectUrl = await createGitlabProject(`ci-${teamName}`, ciGroupId, token);
    if (ciProjectUrl) {
      const ciLocalPath = `./ci-${teamName}`;
      await cloneAndModifyRepository('https://gitlab-devops.aeonth.com/devops/pipeline-template/ci-template/ci-example.git', ciLocalPath, appName, teamName);
      await pushToGitlab(ciLocalPath, ciProjectUrl);
    }

    // CD Setup
    const cdGroupId = await createGitlabFolder(teamName, token);
    const cdProjectUrl = await createGitlabProject(`cd-${teamName}`, cdGroupId, token);
    if (cdProjectUrl) {
      const cdLocalPath = `./cd-${teamName}`;
      await cloneAndModifyRepository('https://gitlab-devops.aeonth.com/devops/pipeline-template/cd-template/cd-example.git', cdLocalPath, appName, teamName);
      await pushToGitlab(cdLocalPath, cdProjectUrl);
    }

    console.log('CI/CD setup completed successfully!');
  } catch (error) {
    console.error('Error during CI/CD setup:', error.message);
  }
}

// Usage
setupCICD('otpapi', 'spi');
