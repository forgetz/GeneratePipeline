const axios = require('axios');
const ExcelJS = require('exceljs');
const https = require('https');

// GitLab API configuration
const GITLAB_URL = 'https://gitlab.com/api/v4';
const GITLAB_TOKEN = 'YOUR_GITLAB_PERSONAL_ACCESS_TOKEN';
const NAMESPACE_ID = 'YOUR_NAMESPACE_ID';

// Create a custom HTTPS agent that ignores SSL certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Function to fetch projects from GitLab API
async function fetchProjects(page = 1, perPage = 100) {
  try {
    const response = await axios.get(`${GITLAB_URL}/groups/${NAMESPACE_ID}/projects`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      params: { page, per_page: perPage },
      httpsAgent: httpsAgent // Use the custom HTTPS agent
    });
    return response.data;
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    return [];
  }
}

// Function to export projects to Excel
async function exportToExcel(projects) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Projects');

  worksheet.columns = [
    { header: 'projectid', key: 'id', width: 10 },
    { header: 'projectname', key: 'name', width: 30 },
    { header: 'namespaceid', key: 'namespace.id', width: 15 },
    { header: 'ssh repository', key: 'ssh_url_to_repo', width: 50 }
  ];

  projects.forEach(project => {
    worksheet.addRow({
      id: project.id,
      name: project.name,
      'namespace.id': project.namespace.id,
      ssh_url_to_repo: project.ssh_url_to_repo
    });
  });

  await workbook.xlsx.writeFile('gitlab_projects.xlsx');
  console.log('Excel file created: gitlab_projects.xlsx');
}

// Main function
async function main() {
  let allProjects = [];
  let page = 1;
  let hasMoreProjects = true;

  while (hasMoreProjects) {
    const projects = await fetchProjects(page);
    if (projects.length === 0) {
      hasMoreProjects = false;
    } else {
      allProjects = allProjects.concat(projects);
      page++;
    }
  }

  await exportToExcel(allProjects);
}

main();
