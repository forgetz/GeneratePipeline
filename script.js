const axios = require('axios');
const https = require('https');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const csv = require('csv-parse/sync');
const os = require('os');

const execPromise = util.promisify(exec);

// GitLab API configuration
const GITLAB_API_URL = 'https://gitlab-devops.aeonth.com/api/v4';
const GITLAB_TOKEN = 'YOUR_GITLAB_ACCESS_TOKEN'; // Replace with your actual token

// SSL Verification Option
const DISABLE_SSL_VERIFY = true; // Set to false in production environments

if (DISABLE_SSL_VERIFY) {
  console.warn('\x1b[33m%s\x1b[0m', 'WARNING: SSL certificate verification is disabled. This is insecure and should not be used in production environments.');
}

// Axios instance for GitLab API requests
const gitlabApi = axios.create({
  baseURL: GITLAB_API_URL,
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  httpsAgent: new https.Agent({  
    rejectUnauthorized: !DISABLE_SSL_VERIFY
  })
});

// Function to execute Git command with SSL verification disabled if needed
async function executeGitCommand(command) {
  let fullCommand;
  if (DISABLE_SSL_VERIFY) {
    if (os.platform() === 'win32') {
      fullCommand = `set GIT_SSL_NO_VERIFY=true && ${command}`;
    } else {
      fullCommand = `GIT_SSL_NO_VERIFY=true ${command}`;
    }
  } else {
    fullCommand = command;
  }
  return execPromise(fullCommand);
}

async function getProjectId(repositoryUrl) {
  try {
    const encodedProjectPath = encodeURIComponent(
      repositoryUrl.replace('https://gitlab-devops.aeonth.com/', '').replace('.git', '')
    );
    const response = await gitlabApi.get(`/projects/${encodedProjectPath}`);
    return response.data.id;
  } catch (error) {
    console.error(`Error fetching project ID for ${repositoryUrl}:`, error.message);
    throw error;
  }
}

async function processProjects() {
  try {
    const fileContent = await fs.readFile('projects.csv', 'utf-8');
    const records = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

    for (const record of records) {
      await setupCICD(record);
    }

    console.log('All projects processed successfully');
  } catch (error) {
    console.error('Error processing projects:', error.message);
  }
}

async function setupCICD(project) {
  try {
    console.log(`Starting CI/CD setup for ${project.app_name} in team ${project.app_team}`);

    const projectId = await getProjectId(project.repository_url);
    console.log(`Project ID for ${project.app_name}: ${projectId}`);

    // CI setup
    await processSetup('ci', project, projectId);

    // CD setup
    await processSetup('cd', project, projectId);

    console.log(`CI/CD setup completed successfully for ${project.app_name}`);
  } catch (error) {
    console.error(`Error setting up CI/CD for ${project.app_name}:`, error.message);
  }
}

async function processSetup(type, project, projectId) {
  console.log(`Processing ${type.toUpperCase()} setup for ${project.app_name}`);

  // Step 1: Check and create team folder
  await checkAndCreateFolder(project.app_team, type, projectId);

  // Step 2: Import template and create app folder
  await importTemplate(type, project, projectId);

  // Step 3: Replace placeholders
  await replacePlaceholders(type, project, projectId);
}

async function checkAndCreateFolder(teamName, type, projectId) {
  const folderPath = `devops/pipeline-template/${type}/${teamName}`;
  try {
    await gitlabApi.get(`/projects/${projectId}/repository/tree`, {
      params: { path: folderPath }
    });
    console.log(`Folder ${folderPath} already exists`);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      console.log(`Creating folder ${folderPath}`);
      await gitlabApi.post(`/projects/${projectId}/repository/files/${encodeURIComponent(folderPath + '/.gitkeep')}`, {
        branch: 'main',
        content: '',
        commit_message: `Create ${teamName} folder for ${type}`
      });
    } else {
      throw error;
    }
  }
}

async function importTemplate(type, project, projectId) {
  const templateUrl = type === 'ci' ? project.ci_template : project.cd_template;
  const targetFolder = `devops/pipeline-template/${type}/${project.app_team}/${project.app_name}-${type}`;

  console.log(`Importing ${type.toUpperCase()} template for ${project.app_name}`);

  const tempDir = path.join(__dirname, 'temp', `${project.app_name}-${type}-${Date.now()}`);
  
  try {
    await executeGitCommand(`git clone ${templateUrl} ${tempDir}`);
    await executeGitCommand(`git -C ${tempDir} push --mirror https://oauth2:${GITLAB_TOKEN}@gitlab-devops.aeonth.com/${targetFolder}.git`);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function replacePlaceholders(type, project, projectId) {
  const folderPath = `devops/pipeline-template/${type}/${project.app_team}/${project.app_name}-${type}`;
  
  console.log(`Replacing placeholders in ${folderPath}`);

  const files = await gitlabApi.get(`/projects/${projectId}/repository/tree`, {
    params: { path: folderPath, recursive: true }
  });

  for (const file of files.data) {
    if (file.type === 'blob') {
      const fileContent = await gitlabApi.get(`/projects/${projectId}/repository/files/${encodeURIComponent(file.path)}/raw`);
      let updatedContent = fileContent.data
        .replace(/{{VALUE_APP_NAME}}/g, project.app_name)
        .replace(/{{VALUE_TEAM_NAME}}/g, project.app_team);

      await gitlabApi.put(`/projects/${projectId}/repository/files/${encodeURIComponent(file.path)}`, {
        branch: 'main',
        content: updatedContent,
        commit_message: `Update placeholders in ${file.path}`
      });
    }
  }
}

// Start processing projects
processProjects();
