#!/usr/bin/env node

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { KnownDevices } from 'puppeteer';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Stealth plugin om bot-detectie te omzeilen (Cloudflare, etc.)
puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = join(__dirname, '..');
const SCREENSHOTS_DIR = join(ROOT_DIR, 'screenshots');
const WEBSITES_FILE = join(ROOT_DIR, 'websites.json');

// Configuratie
const CONFIG = {
  desktopViewport: {
    width: 1920,
    height: 1080
  },
  mobileDevice: 'iPhone 14 Pro',
  fullPage: true,
  timeout: 90000,
  scrollDelay: 300,
  waitAfterScroll: 3000,
  // WebP compressie (0-100), 80 is goede balans tussen kwaliteit en grootte
  webpQuality: 80,
  // Tijdzone voor bestandsnamen
  timezone: 'Europe/Brussels'
};

// Genereer timestamp in GMT+1 (België/Nederland)
function getLocalTimestamp() {
  const now = new Date();
  const options = {
    timeZone: CONFIG.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const parts = new Intl.DateTimeFormat('nl-BE', options).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';

  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}-${get('minute')}-${get('second')}`;
}

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

// Detecteer en wacht op Cloudflare "Verify you are human" challenge
async function handleCloudflareChallenge(page) {
  try {
    const isChallengePage = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      const title = document.title || '';
      return (
        bodyText.includes('Verify you are human') ||
        bodyText.includes('Controleer of u een mens bent') ||
        bodyText.includes('confirm you are human') ||
        bodyText.includes('Just a moment') ||
        title.includes('Just a moment') ||
        !!document.querySelector('#challenge-running') ||
        !!document.querySelector('#challenge-stage') ||
        !!document.querySelector('.cf-turnstile') ||
        !!document.querySelector('iframe[src*="challenges.cloudflare.com"]')
      );
    });

    if (!isChallengePage) return false;

    console.log(`🛡️  Cloudflare challenge detected, waiting for resolution...`);

    // Probeer de Turnstile checkbox te klikken als die er is
    try {
      const turnstileFrame = await page.$('iframe[src*="challenges.cloudflare.com"]');
      if (turnstileFrame) {
        const frame = await turnstileFrame.contentFrame();
        if (frame) {
          const checkbox = await frame.$('input[type="checkbox"]');
          if (checkbox) {
            await checkbox.click();
            console.log(`🛡️  Clicked Turnstile checkbox`);
          }
        }
      }
    } catch {
      // Frame access kan falen door cross-origin, dat is normaal
    }

    // Wacht tot de challenge-pagina verdwijnt (max 15 seconden)
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || '';
      const title = document.title || '';
      return (
        !bodyText.includes('Verify you are human') &&
        !bodyText.includes('Controleer of u een mens bent') &&
        !bodyText.includes('confirm you are human') &&
        !title.includes('Just a moment') &&
        !document.querySelector('#challenge-running')
      );
    }, { timeout: 15000 });

    console.log(`🛡️  Cloudflare challenge passed!`);
    // Extra wachttijd na de challenge zodat de pagina volledig laadt
    await new Promise(resolve => setTimeout(resolve, 3000));
    return true;
  } catch (error) {
    console.log(`⚠️  Cloudflare challenge timeout or error: ${error.message}`);
    return false;
  }
}

// Probeer cookie/consent popups weg te klikken
async function dismissPopups(page) {
  // Veelgebruikte selectors voor consent-knoppen (Didomi, Sourcepoint, OneTrust, CookieBot, generiek)
  const consentSelectors = [
    // Didomi (NU.nl, AD, DPG Media sites)
    '#didomi-notice-agree-button',
    '.didomi-continue-without-agreeing',
    '[data-testid="notice-accept-btn"]',
    // Sourcepoint
    'button[title="Akkoord"]',
    'button[title="Accept"]',
    'button[title="Accepteren"]',
    // OneTrust
    '#onetrust-accept-btn-handler',
    // CookieBot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    // Quantcast / TCF
    'button.css-47sehv', // Quantcast accept
    '.qc-cmp2-summary-buttons button:first-child',
    // Generieke selectors op tekst en class/id patronen
    'button[id*="accept" i]',
    'button[id*="agree" i]',
    'button[id*="consent" i]',
    'button[class*="accept" i]',
    'button[class*="agree" i]',
    'button[class*="consent" i]',
    'a[id*="accept" i]',
    'a[class*="accept" i]',
  ];

  for (const selector of consentSelectors) {
    try {
      const button = await page.$(selector);
      if (button) {
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 &&
                 style.display !== 'none' && style.visibility !== 'hidden';
        }, button);
        if (isVisible) {
          await button.click();
          console.log(`🍪 Dismissed popup via: ${selector}`);
          // Korte wachttijd zodat popup verdwijnt
          await new Promise(resolve => setTimeout(resolve, 1000));
          return;
        }
      }
    } catch {
      // Negeer fouten per selector, probeer volgende
    }
  }

  // Fallback: zoek knoppen op tekst (Akkoord, Accepteren, Accept, Alle cookies accepteren, etc.)
  try {
    const dismissed = await page.evaluate(() => {
      const textPatterns = [
        /^akkoord$/i,
        /^accepteren$/i,
        /^accept(eer)? all(es?)?$/i,
        /^alle cookies accepteren$/i,
        /^accept$/i,
        /^agree$/i,
        /^ik ga akkoord$/i,
        /^ja,? ik accepteer$/i,
        /^alles accepteren$/i,
        /^toestaan$/i,
      ];

      const buttons = [...document.querySelectorAll('button, a[role="button"], [class*="button"]')];
      for (const btn of buttons) {
        const text = (btn.textContent || '').trim();
        if (textPatterns.some(pattern => pattern.test(text))) {
          const rect = btn.getBoundingClientRect();
          const style = window.getComputedStyle(btn);
          if (rect.width > 0 && rect.height > 0 &&
              style.display !== 'none' && style.visibility !== 'hidden') {
            btn.click();
            return text;
          }
        }
      }
      return null;
    });
    if (dismissed) {
      console.log(`🍪 Dismissed popup via text: "${dismissed}"`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch {
    // Negeer fouten
  }
}

async function loadAndPrepare(page, website) {
  const { name, url } = website;

  console.log(`📸 ${name}: Navigating to ${url}`);
  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: CONFIG.timeout
  });

  // Cloudflare "Verify you are human" challenge afhandelen
  await handleCloudflareChallenge(page);

  console.log(`📸 ${name}: Dismissing popups...`);
  await dismissPopups(page);

  console.log(`📸 ${name}: Scrolling to load all images...`);
  await autoScroll(page);

  console.log(`📸 ${name}: Waiting for images to load...`);
  await waitForImages(page);

  // Extra wachttijd voor eventuele animaties
  await new Promise(resolve => setTimeout(resolve, CONFIG.waitAfterScroll));
}

async function takeScreenshot(browser, website) {
  const { name, url } = website;
  const timestamp = getLocalTimestamp();
  const results = [];

  // --- Desktop screenshot ---
  const desktopPage = await browser.newPage();
  try {
    await desktopPage.setViewport(CONFIG.desktopViewport);
    await loadAndPrepare(desktopPage, website);

    const desktopFilename = `${name}_${timestamp}.webp`;
    const desktopFilepath = join(SCREENSHOTS_DIR, desktopFilename);

    console.log(`📸 ${name}: Taking desktop screenshot...`);
    await desktopPage.screenshot({
      path: desktopFilepath,
      fullPage: CONFIG.fullPage,
      type: 'webp',
      quality: CONFIG.webpQuality
    });

    console.log(`✅ ${name}: Saved ${desktopFilename}`);
    results.push({ success: true, name, filename: desktopFilename });
  } catch (error) {
    console.error(`❌ ${name} (desktop): ${error.message}`);
    results.push({ success: false, name, error: error.message });
  } finally {
    await desktopPage.close();
  }

  // --- Mobiele screenshot ---
  const mobilePage = await browser.newPage();
  try {
    const mobileDevice = KnownDevices[CONFIG.mobileDevice];
    await mobilePage.emulate(mobileDevice);
    await loadAndPrepare(mobilePage, website);

    const mobileFilename = `${name}_${timestamp}_mobile.webp`;
    const mobileFilepath = join(SCREENSHOTS_DIR, mobileFilename);

    console.log(`📱 ${name}: Taking mobile screenshot...`);
    await mobilePage.screenshot({
      path: mobileFilepath,
      fullPage: CONFIG.fullPage,
      type: 'webp',
      quality: CONFIG.webpQuality
    });

    console.log(`✅ ${name}: Saved ${mobileFilename}`);
    results.push({ success: true, name, filename: mobileFilename });
  } catch (error) {
    console.error(`❌ ${name} (mobile): ${error.message}`);
    results.push({ success: false, name, error: error.message });
  } finally {
    await mobilePage.close();
  }

  return results;
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
      const siteResults = await takeScreenshot(browser, website);
      results.push(...siteResults);
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
