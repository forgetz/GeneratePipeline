const axios = require('axios');
const https = require('https');
const ExcelJS = require('exceljs');
const fs = require('fs');

// Read Jenkins token from file
const jenkinsToken = fs.readFileSync('token.txt', 'utf8').trim();

// Jenkins URL and authentication
const jenkinsUrl = 'https://your-jenkins-url.com';
const auth = { username: 'your-username', password: jenkinsToken };

// Create a custom Axios instance with SSL certificate verification disabled
const axiosInstance = axios.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  })
});

async function getJobsRecursively(url, parentPath = '') {
  const response = await axiosInstance.get(`${url}/api/json`, { auth });
  const data = response.data;
  
  let jobs = [];
  
  if (data.jobs) {
    for (const item of data.jobs) {
      const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
      if (item._class.includes('WorkflowJob')) {
        // This is a pipeline job
        jobs.push({ ...item, fullName: fullPath, rootFolder: parentPath.split('/')[0] || 'Root' });
      } else if (item._class.includes('Folder')) {
        // This is a folder, recursively get jobs inside it
        const subJobs = await getJobsRecursively(item.url, fullPath);
        jobs = jobs.concat(subJobs);
      }
    }
  }
  
  return jobs;
}

async function getBuilds(jobUrl) {
  const response = await axiosInstance.get(`${jobUrl}/api/json`, { auth });
  return response.data.builds;
}

async function getBuildDetails(buildUrl) {
  const response = await axiosInstance.get(`${buildUrl}/api/json`, { auth });
  return response.data;
}

async function generateReport(startDate, endDate) {
  const jobs = await getJobsRecursively(jenkinsUrl);

  const reportData = [];

  for (const job of jobs) {
    const builds = await getBuilds(job.url);
    
    let prodBuilds = 0;
    const prodBuildTimes = [];
    const allBuildTimes = [];
    let buildSuccess = 'failed';
    let lastFailedBuildTime = null;
    
    // Sort builds by timestamp in descending order (newest first)
    builds.sort((a, b) => b.timestamp - a.timestamp);
    
    for (const build of builds) {
      const buildDetails = await getBuildDetails(build.url);
      const buildTime = new Date(buildDetails.timestamp);
      
      if (buildTime >= startDate && buildTime <= endDate) {
        allBuildTimes.push(buildDetails.duration / 1000); // Convert to seconds
        
        if (buildDetails.result === 'SUCCESS') {
          // Check if this is a production build
          // Adjust this condition based on how you identify production builds
          if (buildDetails.description && buildDetails.description.includes('deployment to production')) {
            prodBuilds++;
            prodBuildTimes.push(buildDetails.duration / 1000);
          }
          
          // Check if this successful build is within 1 hour of the last failed build
          if (lastFailedBuildTime && (buildTime - lastFailedBuildTime <= 3600000)) {
            buildSuccess = 'pass';
            break; // We've found our answer, no need to check older builds
          }
        } else if (buildDetails.result === 'FAILURE') {
          if (!lastFailedBuildTime) {
            lastFailedBuildTime = buildTime;
          }
        }
      } else if (buildTime < startDate) {
        // We've gone past our date range, no need to check older builds
        break;
      }
    }
    
    const avgProdBuildTime = prodBuildTimes.length > 0 ? prodBuildTimes.reduce((a, b) => a + b) / prodBuildTimes.length : 0;
    const avgAllBuildTime = allBuildTimes.length > 0 ? allBuildTimes.reduce((a, b) => a + b) / allBuildTimes.length : 0;
    
    reportData.push({
      Project: job.fullName,
      'Root Folder': job.rootFolder,
      'total build on prod': prodBuilds,
      'average build time successfully': avgProdBuildTime,
      'average build time': avgAllBuildTime,
      'build success': buildSuccess
    });
  }

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Jenkins Report');

  worksheet.columns = [
    { header: 'Project', key: 'Project', width: 50 },
    { header: 'Root Folder', key: 'Root Folder', width: 20 },
    { header: 'total build on prod', key: 'total build on prod', width: 20 },
    { header: 'average build time successfully', key: 'average build time successfully', width: 30 },
    { header: 'average build time', key: 'average build time', width: 20 },
    { header: 'build success', key: 'build success', width: 15 }
  ];

  worksheet.addRows(reportData);

  await workbook.xlsx.writeFile('jenkins_report.xlsx');
  console.log('Report generated: jenkins_report.xlsx');
}

// Generate report for January to September
const startDate = new Date('2024-01-01');
const endDate = new Date('2024-09-30');
generateReport(startDate, endDate).catch(console.error);
