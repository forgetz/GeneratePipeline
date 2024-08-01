const axios = require('axios');
const ExcelJS = require('exceljs');
const https = require('https');

// GitLab API configuration
const GITLAB_URL = 'https://gitlab.com/api/v4';
const GITLAB_TOKEN = 'YOUR_GITLAB_PERSONAL_ACCESS_TOKEN';
const GROUP_URL = 'https://gitlab.com/your-group/subgroup'; // Replace with your group URL

// Create a custom HTTPS agent that ignores SSL certificate errors
const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

// Function to get group ID from URL
async function getGroupId(groupUrl) {
  const encodedPath = encodeURIComponent(new URL(groupUrl).pathname.slice(1));
  try {
    const response = await axios.get(`${GITLAB_URL}/groups/${encodedPath}`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      httpsAgent: httpsAgent
    });
    return response.data.id;
  } catch (error) {
    console.error('Error fetching group ID:', error.message);
    process.exit(1);
  }
}

// Function to fetch projects from GitLab API
async function fetchProjects(groupId, page = 1, perPage = 100) {
  try {
    const response = await axios.get(`${GITLAB_URL}/groups/${groupId}/projects`, {
      headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
      params: { page, per_page: perPage },
      httpsAgent: httpsAgent
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
  const groupId = await getGroupId(GROUP_URL);
  console.log(`Found group ID: ${groupId}`);

  let allProjects = [];
  let page = 1;
  let hasMoreProjects = true;

  while (hasMoreProjects) {
    const projects = await fetchProjects(groupId, page);
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
