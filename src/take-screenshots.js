#!/usr/bin/env node

import puppeteer from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SCREENSHOTS_DIR = join(ROOT_DIR, 'screenshots');
const WEBSITES_FILE = join(ROOT_DIR, 'websites.json');

// Configuratie
const CONFIG = {
  viewport: {
    width: 1920,
    height: 1080
  },
  fullPage: true,
  timeout: 60000,
  waitAfterLoad: 2000
};

async function takeScreenshot(browser, website) {
  const { name, url } = website;
  const page = await browser.newPage();

  try {
    await page.setViewport(CONFIG.viewport);

    console.log(`📸 ${name}: Navigating to ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: CONFIG.timeout
    });

    // Wacht op dynamische content
    await new Promise(resolve => setTimeout(resolve, CONFIG.waitAfterLoad));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    await page.screenshot({
      path: filepath,
      fullPage: CONFIG.fullPage
    });

    console.log(`✅ ${name}: Saved ${filename}`);
    return { success: true, name, filename };

  } catch (error) {
    console.error(`❌ ${name}: ${error.message}`);
    return { success: false, name, error: error.message };

  } finally {
    await page.close();
  }
}

async function main() {
  console.log('🚀 Website Screenshot Monitor\n');
  console.log(`⏰ ${new Date().toISOString()}\n`);

  // Maak screenshots directory
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  // Laad websites
  if (!existsSync(WEBSITES_FILE)) {
    console.error('❌ websites.json not found!');
    console.log('Create a websites.json file with your websites:');
    console.log(JSON.stringify([{ name: 'example', url: 'https://example.com' }], null, 2));
    process.exit(1);
  }

  const websites = JSON.parse(readFileSync(WEBSITES_FILE, 'utf-8'));

  if (websites.length === 0) {
    console.log('⚠️  No websites configured in websites.json');
    process.exit(0);
  }

  console.log(`📋 Found ${websites.length} website(s) to screenshot\n`);

  // Start browser
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  const results = [];

  try {
    for (const website of websites) {
      const result = await takeScreenshot(browser, website);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  console.log(`📊 Done: ${successful} successful, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
