const axios = require('axios');
const { promises: fs } = require('fs');
const path = require('path');
const simpleGit = require('simple-git');
const csv = require('csv-parse/sync');

const GITLAB_API_URL = 'https://gitlab-devops.aeonth.com/api/v4';
const GITLAB_TOKEN = 'YOUR_GITLAB_PERSONAL_ACCESS_TOKEN';

async function processProjects(csvFilePath) {
  try {
    const fileContent = await fs.readFile(csvFilePath, 'utf8');
    const records = csv.parse(fileContent, { columns: true, skip_empty_lines: true });

    for (const record of records) {
      await setupCICD(record.app_name, record.app_team, record.repository_url, record.ci_template, record.cd_template);
    }

    console.log('All projects processed successfully!');
  } catch (error) {
    console.error('Error processing projects:', error.message);
  }
}

async function setupCICD(appName, teamName, repoUrl, ciTemplateUrl, cdTemplateUrl) {
  const ciPath = `/devops/pipeline-template/ci/${teamName}`;
  const cdPath = `/devops/pipeline-template/cd/${teamName}`;

  try {
    console.log(`Setting up CI/CD for ${appName} (${teamName})`);

    // Step 1: Check and create team folder in CI
    await createFolderIfNotExists(ciPath);

    // Step 2: Import CI template
    await importTemplate(ciTemplateUrl, `${ciPath}/${appName}-ci`);

    // Step 3: Replace values in CI files
    await replaceValuesInFiles(`${ciPath}/${appName}-ci`, appName, teamName);

    // Repeat for CD
    await createFolderIfNotExists(cdPath);
    await importTemplate(cdTemplateUrl, `${cdPath}/${appName}-cd`);
    await replaceValuesInFiles(`${cdPath}/${appName}-cd`, appName, teamName);

    console.log(`CI/CD setup completed for ${appName}`);
  } catch (error) {
    console.error(`Error setting up CI/CD for ${appName}:`, error.message);
  }
}

async function createFolderIfNotExists(folderPath) {
  try {
    await axios.get(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template${encodeURIComponent(folderPath)}`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });
    console.log(`Folder ${folderPath} already exists.`);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      await axios.post(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template/repository/files${encodeURIComponent(folderPath)}%2F.gitkeep`, {
        branch: 'main',
        content: '',
        commit_message: `Create ${folderPath} folder`
      }, {
        headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
      });
      console.log(`Created folder ${folderPath}`);
    } else {
      throw error;
    }
  }
}

async function importTemplate(templateUrl, destinationPath) {
  const tempDir = path.join(__dirname, 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const git = simpleGit();
  await git.clone(templateUrl, tempDir);

  await axios.post(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template/repository/files${encodeURIComponent(destinationPath)}`, {
    branch: 'main',
    content: await fs.readFile(path.join(tempDir, 'README.md'), 'utf8'),
    commit_message: `Import template to ${destinationPath}`
  }, {
    headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
  });

  await fs.rmdir(tempDir, { recursive: true });
  console.log(`Imported template to ${destinationPath}`);
}

async function replaceValuesInFiles(folderPath, appName, teamName) {
  const files = await axios.get(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template/repository/tree`, {
    params: { path: folderPath },
    headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
  });

  for (const file of files.data) {
    const content = await axios.get(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template/repository/files/${encodeURIComponent(file.path)}/raw`, {
      params: { ref: 'main' },
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });

    const updatedContent = content.data
      .replace(/{{VALUE_APP_NAME}}/g, appName)
      .replace(/{{VALUE_TEAM_NAME}}/g, teamName);

    await axios.put(`${GITLAB_API_URL}/projects/devops%2Fpipeline-template/repository/files/${encodeURIComponent(file.path)}`, {
      branch: 'main',
      content: updatedContent,
      commit_message: `Update ${file.path}`
    }, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN }
    });
  }

  console.log(`Replaced values in files in ${folderPath}`);
}

// Usage example
processProjects('path/to/your/projects.csv');
