#!/usr/bin/env node

import { program } from 'commander';
import { createInterface } from 'readline';
import { loadConfig, addWebsite, removeWebsite, setGoogleDriveFolder, saveConfig } from './config.js';
import { getAuthUrl, saveToken, authenticate } from './drive.js';
import { takeScreenshot } from './screenshot.js';
import { uploadScreenshot } from './drive.js';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

program
  .name('website-screenshot-monitor')
  .description('Monitor websites by taking periodic screenshots')
  .version('1.0.0');

program
  .command('add')
  .description('Add a website to monitor')
  .option('-n, --name <name>', 'Website name/identifier')
  .option('-u, --url <url>', 'Website URL')
  .option('-i, --interval <minutes>', 'Screenshot interval in minutes', '60')
  .action(async (options) => {
    try {
      let { name, url, interval } = options;

      if (!name) {
        name = await question('Website name: ');
      }
      if (!url) {
        url = await question('Website URL: ');
      }
      if (!options.interval) {
        const intervalInput = await question('Interval in minutes (default: 60): ');
        interval = intervalInput || '60';
      }

      addWebsite(name, url, parseInt(interval, 10));
      console.log(`\nAdded website: ${name}`);
      console.log(`  URL: ${url}`);
      console.log(`  Interval: ${interval} minutes`);

      rl.close();
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program
  .command('remove')
  .description('Remove a website from monitoring')
  .argument('[name]', 'Website name to remove')
  .action(async (name) => {
    try {
      if (!name) {
        const config = loadConfig();
        if (config.websites.length === 0) {
          console.log('No websites configured.');
          rl.close();
          return;
        }

        console.log('Configured websites:');
        config.websites.forEach((w, i) => {
          console.log(`  ${i + 1}. ${w.name} (${w.url})`);
        });

        name = await question('\nWebsite name to remove: ');
      }

      removeWebsite(name);
      console.log(`Removed website: ${name}`);
      rl.close();
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all monitored websites')
  .action(() => {
    const config = loadConfig();

    if (config.websites.length === 0) {
      console.log('No websites configured.');
      console.log('Use "npm run add" to add a website.');
      return;
    }

    console.log('\nMonitored websites:\n');
    config.websites.forEach((website, index) => {
      console.log(`${index + 1}. ${website.name}`);
      console.log(`   URL: ${website.url}`);
      console.log(`   Interval: ${website.intervalMinutes} minutes`);
      console.log('');
    });

    console.log(`Google Drive folder: ${config.googleDrive.folderId || 'Not configured'}`);
  });

program
  .command('auth')
  .description('Authenticate with Google Drive')
  .action(async () => {
    try {
      const config = loadConfig();

      console.log('\nGoogle Drive Authentication\n');
      console.log('1. Make sure you have downloaded your OAuth2 credentials');
      console.log('   from Google Cloud Console and saved as credentials.json\n');

      const authUrl = getAuthUrl(config);

      console.log('2. Open this URL in your browser:\n');
      console.log(authUrl);
      console.log('');

      const code = await question('3. Enter the authorization code: ');

      await saveToken(code.trim(), config);
      console.log('\nAuthentication successful!');

      rl.close();
    } catch (error) {
      console.error('Authentication error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program
  .command('set-folder')
  .description('Set Google Drive folder ID')
  .argument('[folderId]', 'Google Drive folder ID')
  .action(async (folderId) => {
    try {
      if (!folderId) {
        console.log('\nTo get your Google Drive folder ID:');
        console.log('1. Open Google Drive in your browser');
        console.log('2. Navigate to your shared folder');
        console.log('3. The folder ID is in the URL: drive.google.com/drive/folders/[FOLDER_ID]\n');

        folderId = await question('Enter folder ID: ');
      }

      setGoogleDriveFolder(folderId.trim());
      console.log(`\nGoogle Drive folder set: ${folderId}`);

      rl.close();
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Test screenshot and upload for a website')
  .argument('[name]', 'Website name to test')
  .action(async (name) => {
    try {
      const config = loadConfig();

      if (!name) {
        if (config.websites.length === 0) {
          console.log('No websites configured. Add one first with "npm run add"');
          rl.close();
          return;
        }

        console.log('Configured websites:');
        config.websites.forEach((w, i) => {
          console.log(`  ${i + 1}. ${w.name}`);
        });

        name = await question('\nWebsite name to test: ');
      }

      const website = config.websites.find(w => w.name === name);
      if (!website) {
        console.error(`Website not found: ${name}`);
        rl.close();
        process.exit(1);
      }

      console.log(`\nTesting screenshot for: ${website.name}`);
      console.log(`URL: ${website.url}\n`);

      const result = await takeScreenshot(website, config);
      console.log(`\nScreenshot saved: ${result.filepath}`);

      if (config.googleDrive.folderId) {
        console.log('\nUploading to Google Drive...');
        try {
          await authenticate(config);
          const uploadResult = await uploadScreenshot(result, config);
          console.log(`Uploaded successfully!`);
          if (uploadResult.webViewLink) {
            console.log(`View: ${uploadResult.webViewLink}`);
          }
        } catch (error) {
          console.log(`Upload failed: ${error.message}`);
          console.log('Screenshot is still saved locally.');
        }
      } else {
        console.log('\nGoogle Drive not configured. Screenshot saved locally only.');
        console.log('Use "npm run auth" and set-folder to enable Drive upload.');
      }

      rl.close();
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    const config = loadConfig();
    console.log('\nCurrent configuration:\n');
    console.log(JSON.stringify(config, null, 2));
  });

program
  .command('set-browser')
  .description('Set browser executable path')
  .argument('[path]', 'Path to browser executable')
  .action(async (browserPath) => {
    try {
      if (!browserPath) {
        console.log('\nCommon browser paths:');
        console.log('  Chrome (Linux): /usr/bin/google-chrome');
        console.log('  Chrome (Mac): /Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
        console.log('  Chromium: /usr/bin/chromium-browser\n');

        browserPath = await question('Enter browser path (or leave empty for default): ');
      }

      const config = loadConfig();
      config.browser.executablePath = browserPath.trim() || null;
      saveConfig(config);

      if (browserPath.trim()) {
        console.log(`\nBrowser path set: ${browserPath}`);
      } else {
        console.log('\nBrowser path cleared (will use Puppeteer default)');
      }

      rl.close();
    } catch (error) {
      console.error('Error:', error.message);
      rl.close();
      process.exit(1);
    }
  });

program.parse();
