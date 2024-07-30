const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');

// Configuration
const gitlabToken = 'YOUR_GITLAB_PERSONAL_ACCESS_TOKEN';
const gitlabApiUrl = 'https://gitlab.com/api/v4';
const excelFilePath = './projects.xlsx';

function readProjectsFromExcel() {
  const workbook = XLSX.readFile(excelFilePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const projects = XLSX.utils.sheet_to_json(sheet);

  return projects.map(project => ({
    ...project,
    replacementValues: parseReplacementValues(project.replacementValues)
  }));
}

function parseReplacementValues(replacementValuesString) {
  const pairs = replacementValuesString.split(',');
  return pairs.reduce((acc, pair) => {
    const [key, value] = pair.trim().split('=');
    acc[key.trim()] = value.trim();
    return acc;
  }, {});
}

function getLatestRepo(gitlabRepoUrl, localRepoPath) {
  if (fs.existsSync(localRepoPath)) {
    console.log('Repository exists. Pulling latest changes...');
    execSync(`git -C ${localRepoPath} pull`);
  } else {
    console.log('Cloning repository...');
    execSync(`git clone ${gitlabRepoUrl} ${localRepoPath}`);
  }
}

function replaceValuesInFiles(dir, replacementValues) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      replaceValuesInFiles(filePath, replacementValues);
    } else if (stats.isFile()) {
      let content = fs.readFileSync(filePath, 'utf8');
      let modified = false;

      for (const [placeholder, replacement] of Object.entries(replacementValues)) {
        if (content.includes(placeholder)) {
          content = content.replace(new RegExp(placeholder, 'g'), replacement);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Replaced values in ${filePath}`);
      }
    }
  });
}

function removeGitFolder(localRepoPath) {
  const gitFolderPath = path.join(localRepoPath, '.git');
  if (fs.existsSync(gitFolderPath)) {
    fs.rmSync(gitFolderPath, { recursive: true, force: true });
    console.log('.git folder removed successfully.');
  } else {
    console.log('.git folder not found.');
  }
}

async function createNewProject(newProjectName, namespaceId) {
  try {
    const response = await axios.post(`${gitlabApiUrl}/projects`, {
      name: newProjectName,
      namespace_id: namespaceId
    }, {
      headers: { 'PRIVATE-TOKEN': gitlabToken }
    });
    console.log('New project created successfully.');
    return response.data.http_url_to_repo;
  } catch (error) {
    console.error('Error creating new project:', error.response?.data || error.message);
    throw error;
  }
}

function pushToNewRepo(localRepoPath, newRepoUrl) {
  execSync(`git init`, { cwd: localRepoPath });
  execSync(`git add .`, { cwd: localRepoPath });
  execSync(`git commit -m "Initial commit"`, { cwd: localRepoPath });
  execSync(`git remote add origin ${newRepoUrl}`, { cwd: localRepoPath });
  execSync(`git push -u origin master`, { cwd: localRepoPath });
  console.log('Files pushed to the new repository successfully.');
}

function removeTempPath(localRepoPath) {
  if (fs.existsSync(localRepoPath)) {
    fs.rmSync(localRepoPath, { recursive: true, force: true });
    console.log(`Temporary path ${localRepoPath} removed successfully.`);
  } else {
    console.log(`Temporary path ${localRepoPath} not found.`);
  }
}

async function processProject(project, prefix, namespaceId, templateRepo) {
  const prefixedProjectName = `${prefix}-${project.projectName}`;
  const localRepoPath = `./${prefixedProjectName}`;
  
  try {
    getLatestRepo(templateRepo, localRepoPath);
    replaceValuesInFiles(localRepoPath, project.replacementValues);
    removeGitFolder(localRepoPath);
    const newRepoUrl = await createNewProject(prefixedProjectName, namespaceId);
    pushToNewRepo(localRepoPath, newRepoUrl);
    removeTempPath(localRepoPath);
    console.log(`Process completed successfully for project: ${prefixedProjectName}`);
  } catch (error) {
    console.error(`An error occurred for project ${prefixedProjectName}:`, error.message);
  }
}

async function main() {
  const projects = readProjectsFromExcel();
  
  for (const project of projects) {
    // Process for CI
    await processProject(project, 'CI', project.ciNamespaceId, project['ci-template-repo']);
    
    // Process for CD
    await processProject(project, 'CD', project.cdNamespaceId, project['cd-template-repo']);
  }
  
  console.log('All projects processed for both CI and CD.');
}

main();
