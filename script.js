const { Gitlab } = require('@gitbeaker/node');
const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

async function getGitLabToken() {
  try {
    return await fs.readFile('gitlab_token.txt', 'utf8');
  } catch (error) {
    console.error('Error reading GitLab token file:', error);
    process.exit(1);
  }
}

async function initializeGitLabAPI() {
  const token = await getGitLabToken();
  
  return new Gitlab({
    host: 'https://gitlab-devops.aeonth.com',
    token: token.trim(),
    rejectUnauthorized: false, // Disable SSL verification
  });
}

// Create a custom HTTPS agent that doesn't verify SSL certificates
const agent = new https.Agent({
  rejectUnauthorized: false
});

async function setupCICD(appName, teamName) {
  try {
    const api = await initializeGitLabAPI();

    // Step 1: Check and create team folder
    const ciProjectId = 'devops/pipeline-template/ci';
    await createTeamFolder(api, ciProjectId, teamName);

    // Step 2 & 3: Import CI template and replace values
    await importAndReplaceTemplate(
      api,
      'https://gitlab-devops.aeonth.com/devops/pipeline-template/ci-template/ci-example.git',
      `${teamName}/${appName}-ci`,
      appName,
      teamName,
      'ci'
    );

    // Step 2 & 3 for CD: Import CD template and replace values
    await importAndReplaceTemplate(
      api,
      'https://gitlab-devops.aeonth.com/devops/pipeline-template/cd-template/cd-example.git',
      `${teamName}/${appName}-cd`,
      appName,
      teamName,
      'cd'
    );

    console.log('CI/CD setup completed successfully!');
  } catch (error) {
    console.error('Error setting up CI/CD:', error);
  }
}

async function createTeamFolder(api, projectId, teamName) {
  try {
    await api.RepositoryFiles.create(
      projectId,
      `${teamName}/.gitkeep`,
      'main',
      'Create team folder',
      ''
    );
    console.log(`Team folder '${teamName}' created successfully.`);
  } catch (error) {
    if (error.response && error.response.status === 400 && error.response.data.message === 'A file with this name already exists') {
      console.log(`Team folder '${teamName}' already exists.`);
    } else {
      throw error;
    }
  }
}

async function importAndReplaceTemplate(api, templateUrl, destPath, appName, teamName, type) {
  const tempDir = `temp-${type}-${Date.now()}`;
  
  try {
    // Clone template repository
    await simpleGit().env('GIT_SSL_NO_VERIFY', '1').clone(templateUrl, tempDir);

    // Replace values in all files
    await replaceValuesInDirectory(tempDir, appName, teamName);

    // Create new project in GitLab
    const project = await api.Projects.create({
      name: `${appName}-${type}`,
      namespace_id: await getNamespaceId(api, `devops/pipeline-template/${type}/${teamName}`),
      visibility: 'internal'
    });

    // Push modified files to the new project
    const git = simpleGit(tempDir).env('GIT_SSL_NO_VERIFY', '1');
    await git.removeRemote('origin');
    await git.addRemote('origin', project.http_url_to_repo);
    await git.add('./*');
    await git.commit('Initial commit');
    await git.push('origin', 'main');

    console.log(`${type.toUpperCase()} template imported and values replaced successfully.`);
  } finally {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function replaceValuesInDirectory(dir, appName, teamName) {
  const files = await fs.readdir(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      await replaceValuesInDirectory(filePath, appName, teamName);
    } else {
      let content = await fs.readFile(filePath, 'utf8');
      content = content.replace(/{{VALUE_APP_NAME}}/g, appName);
      content = content.replace(/{{VALUE_TEAM_NAME}}/g, teamName);
      await fs.writeFile(filePath, content, 'utf8');
    }
  }
}

async function getNamespaceId(api, path) {
  const namespace = await api.Namespaces.show(path);
  return namespace.id;
}

// Usage example
setupCICD('otpapi', 'spi');
