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
  timeout: 90000,
  scrollDelay: 300,
  waitAfterScroll: 3000
};

// Scroll naar beneden om alle lazy-loaded afbeeldingen te laden
async function autoScroll(page) {
  try {
    await page.evaluate(async (scrollDelay) => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const distance = 500;
        const maxScrolls = 50; // Maximum aantal scrolls om infinite loops te voorkomen
        let scrollCount = 0;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, distance);
          totalHeight += distance;
          scrollCount++;

          if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
            clearInterval(timer);
            // Scroll terug naar boven
            window.scrollTo(0, 0);
            resolve();
          }
        }, scrollDelay);
      });
    }, CONFIG.scrollDelay);
  } catch (error) {
    // Scroll errors negeren (sommige sites redirecten tijdens scroll)
    console.log(`⚠️  Scroll interrupted: ${error.message}`);
  }
}

// Wacht tot alle afbeeldingen geladen zijn
async function waitForImages(page) {
  await page.evaluate(async () => {
    const images = Array.from(document.querySelectorAll('img'));
    await Promise.all(
      images.map((img) => {
        if (img.complete) return Promise.resolve();
        return new Promise((resolve) => {
          img.addEventListener('load', resolve);
          img.addEventListener('error', resolve);
          // Timeout na 5 seconden per afbeelding
          setTimeout(resolve, 5000);
        });
      })
    );
  });
}

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

    console.log(`📸 ${name}: Scrolling to load all images...`);
    await autoScroll(page);

    console.log(`📸 ${name}: Waiting for images to load...`);
    await waitForImages(page);

    // Extra wachttijd voor eventuele animaties
    await new Promise(resolve => setTimeout(resolve, CONFIG.waitAfterScroll));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${name}_${timestamp}.png`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    console.log(`📸 ${name}: Taking screenshot...`);
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

  // Niet falen als minstens 1 screenshot is gelukt (zodat upload doorgaat)
  if (successful === 0) {
    console.error('❌ All screenshots failed!');
    process.exit(1);
  }

  if (failed > 0) {
    console.log('⚠️  Some screenshots failed, but continuing with upload...');
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
