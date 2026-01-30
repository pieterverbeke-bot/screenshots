import puppeteer from 'puppeteer';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS_DIR = join(__dirname, '..', 'screenshots');

if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

export async function takeScreenshot(website, config) {
  const { url, name } = website;
  const { screenshot: screenshotConfig, browser: browserConfig } = config;

  const launchOptions = {
    headless: browserConfig.headless ? 'new' : false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  };

  if (browserConfig.executablePath) {
    launchOptions.executablePath = browserConfig.executablePath;
  }

  const browser = await puppeteer.launch(launchOptions);

  try {
    const page = await browser.newPage();

    await page.setViewport({
      width: screenshotConfig.width,
      height: screenshotConfig.height
    });

    console.log(`Navigating to ${url}...`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait a bit for any dynamic content
    await new Promise(resolve => setTimeout(resolve, 2000));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    console.log(`Taking screenshot...`);
    await page.screenshot({
      path: filepath,
      fullPage: screenshotConfig.fullPage
    });

    console.log(`Screenshot saved: ${filename}`);

    return {
      filepath,
      filename,
      timestamp: new Date().toISOString(),
      website: name,
      url
    };
  } finally {
    await browser.close();
  }
}

export async function takeAllScreenshots(websites, config) {
  const results = [];

  for (const website of websites) {
    try {
      const result = await takeScreenshot(website, config);
      results.push({ success: true, ...result });
    } catch (error) {
      console.error(`Failed to screenshot ${website.name}: ${error.message}`);
      results.push({
        success: false,
        website: website.name,
        url: website.url,
        error: error.message
      });
    }
  }

  return results;
}
