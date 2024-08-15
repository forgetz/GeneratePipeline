const axios = require('axios');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');

// GitLab API configuration
const GITLAB_URL = 'https://gitlab-devops.aeonth.com';
const GITLAB_TOKEN = 'YOUR_GITLAB_TOKEN';
const GITLAB_API = `${GITLAB_URL}/api/v4`;

// Disable certificate verification (not recommended for production)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

async function createGitlabFolder(teamName) {
  console.log(`Creating GitLab folder for team: ${teamName}`);
  try {
    const response = await axios.post(`${GITLAB_API}/groups`, {
      name: teamName,
      path: teamName,
      parent_id: 'PARENT_GROUP_ID', // Replace with the actual parent group ID
    }, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
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

async function createGitlabProject(projectName, groupId) {
  console.log(`Creating GitLab project: ${projectName}`);
  try {
    const response = await axios.post(`${GITLAB_API}/projects`, {
      name: projectName,
      namespace_id: groupId,
    }, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
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
    // CI Setup
    const ciGroupId = await createGitlabFolder(teamName);
    const ciProjectUrl = await createGitlabProject(`ci-${teamName}`, ciGroupId);
    if (ciProjectUrl) {
      const ciLocalPath = `./ci-${teamName}`;
      await cloneAndModifyRepository('https://gitlab-devops.aeonth.com/devops/pipeline-template/ci-template/ci-example.git', ciLocalPath, appName, teamName);
      await pushToGitlab(ciLocalPath, ciProjectUrl);
    }

    // CD Setup
    const cdGroupId = await createGitlabFolder(teamName);
    const cdProjectUrl = await createGitlabProject(`cd-${teamName}`, cdGroupId);
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
