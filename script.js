const axios = require('axios');
const { exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const csv = require('csv-parse/sync');
const https = require('https');

const execPromise = util.promisify(exec);

// GitLab API configuration
const GITLAB_API_URL = 'https://gitlab-devops.aeonth.com/api/v4';
const GITLAB_TOKEN = 'YOUR_GITLAB_ACCESS_TOKEN'; // Replace with your actual token

// SSL Configuration
const SSL_CONFIG = {
  // Set this to true only if you can't resolve the certificate issue and need to bypass verification (NOT recommended for production)
  rejectUnauthorized: true,
  // Uncomment and set the path to your CA certificate if you have one
  // ca: fs.readFileSync('/path/to/your/ca-certificate.pem'),
};

// Axios instance for GitLab API requests
const gitlabApi = axios.create({
  baseURL: GITLAB_API_URL,
  headers: { 'PRIVATE-TOKEN': GITLAB_TOKEN },
  httpsAgent: new https.Agent(SSL_CONFIG)
});

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

// ... [rest of the script remains the same]

// Start processing projects
processProjects();
