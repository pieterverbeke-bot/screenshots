import cron from 'node-cron';
import { takeScreenshot } from './screenshot.js';
import { uploadScreenshot, authenticate } from './drive.js';
import { loadConfig } from './config.js';

const scheduledJobs = new Map();

function minutesToCron(minutes) {
  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `0 */${hours} * * *`;
  }

  const days = Math.floor(hours / 24);
  return `0 0 */${days} * *`;
}

async function processWebsite(website, config) {
  console.log(`\n[${new Date().toISOString()}] Processing: ${website.name}`);

  try {
    const screenshotResult = await takeScreenshot(website, config);

    if (config.googleDrive.folderId) {
      await uploadScreenshot(screenshotResult, config);
      console.log(`Successfully uploaded screenshot for ${website.name}`);
    } else {
      console.log(`Screenshot saved locally (no Google Drive configured): ${screenshotResult.filepath}`);
    }

    return { success: true, website: website.name };
  } catch (error) {
    console.error(`Error processing ${website.name}: ${error.message}`);
    return { success: false, website: website.name, error: error.message };
  }
}

export function scheduleWebsite(website, config) {
  const cronExpression = minutesToCron(website.intervalMinutes);

  console.log(`Scheduling ${website.name} with interval: ${website.intervalMinutes} minutes (cron: ${cronExpression})`);

  const job = cron.schedule(cronExpression, async () => {
    await processWebsite(website, config);
  });

  scheduledJobs.set(website.name, job);
  return job;
}

export function unscheduleWebsite(name) {
  const job = scheduledJobs.get(name);
  if (job) {
    job.stop();
    scheduledJobs.delete(name);
    console.log(`Unscheduled: ${name}`);
  }
}

export function unscheduleAll() {
  for (const [name, job] of scheduledJobs) {
    job.stop();
    console.log(`Stopped: ${name}`);
  }
  scheduledJobs.clear();
}

export async function startMonitoring() {
  const config = loadConfig();

  if (config.websites.length === 0) {
    console.log('No websites configured. Use "npm run add" to add websites.');
    return;
  }

  console.log('Starting website screenshot monitor...\n');

  // Authenticate with Google Drive if configured
  if (config.googleDrive.folderId) {
    try {
      await authenticate(config);
      console.log('Google Drive authenticated successfully\n');
    } catch (error) {
      console.warn(`Google Drive not configured: ${error.message}`);
      console.log('Screenshots will be saved locally only.\n');
    }
  }

  // Take initial screenshots
  console.log('Taking initial screenshots...\n');
  for (const website of config.websites) {
    await processWebsite(website, config);
  }

  // Schedule recurring screenshots
  console.log('\nScheduling recurring screenshots...\n');
  for (const website of config.websites) {
    scheduleWebsite(website, config);
  }

  console.log('\nMonitor is running. Press Ctrl+C to stop.\n');

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping monitor...');
    unscheduleAll();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nStopping monitor...');
    unscheduleAll();
    process.exit(0);
  });
}

export function getScheduledJobs() {
  return Array.from(scheduledJobs.keys());
}
