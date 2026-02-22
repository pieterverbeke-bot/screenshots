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
  desktopViewport: {
    width: 1366,
    height: 768
  },
  fullPage: true,
  timeout: 60000,
  scrollDelay: 200,
  waitAfterScroll: 1500,
  // WebP compressie (0-100), 40 geeft goede kwaliteit voor full-page screenshots (grotere bestanden dan viewport-only)
  webpQuality: 40,
  // Tijdzone voor bestandsnamen
  timezone: 'Europe/Brussels',
  // Aantal sites die tegelijk verwerkt worden (3 is optimaal voor GitHub Actions 2-core runners)
  concurrency: 3
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
    // Detecteer viewport hoogte voor adaptieve scroll-stap
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    const scrollStep = Math.max(200, Math.floor(viewportHeight * 0.6));

    await page.evaluate(async (scrollDelay, step) => {
      await new Promise((resolve) => {
        let totalHeight = 0;
        const maxScrolls = 50;
        let scrollCount = 0;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, step);
          totalHeight += step;
          scrollCount++;

          if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
            clearInterval(timer);
            // Scroll terug naar boven
            window.scrollTo(0, 0);
            resolve();
          }
        }, scrollDelay);
      });
    }, CONFIG.scrollDelay, scrollStep);
  } catch (error) {
    // Scroll errors negeren (sommige sites redirecten tijdens scroll)
    console.log(`⚠️  Scroll interrupted: ${error.message}`);
  }
}

// Forceer laden van lazy-loaded afbeeldingen (voor sites als VRT die custom lazy loading gebruiken)
async function forceLoadLazyImages(page) {
  try {
    const forced = await page.evaluate(() => {
      let count = 0;
      // data-src → src
      document.querySelectorAll('img[data-src]').forEach(img => {
        if (!img.src || img.src === '' || img.src === window.location.href || img.src.endsWith('/')) {
          img.src = img.dataset.src;
          count++;
        }
      });
      // data-srcset → srcset
      document.querySelectorAll('img[data-srcset]').forEach(img => {
        if (!img.srcset) { img.srcset = img.dataset.srcset; count++; }
      });
      document.querySelectorAll('source[data-srcset]').forEach(source => {
        if (!source.srcset) { source.srcset = source.dataset.srcset; count++; }
      });
      // Verwijder loading="lazy" om native lazy loading uit te schakelen
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.loading = 'eager';
        count++;
      });
      // VRT-specifiek: ze gebruiken vaak noscript/picture met verborgen bronnen
      document.querySelectorAll('noscript').forEach(ns => {
        const tmp = document.createElement('div');
        tmp.innerHTML = ns.textContent;
        const imgs = tmp.querySelectorAll('img');
        imgs.forEach(img => {
          if (img.src && !document.querySelector('img[src="' + img.src + '"]')) {
            const parent = ns.parentElement;
            if (parent) { parent.appendChild(img); count++; }
          }
        });
      });
      return count;
    });
    if (forced > 0) {
      console.log(`🖼️  Force-loaded ${forced} lazy image(s)`);
    }
  } catch (error) {
    console.log(`⚠️  Force-load lazy images error: ${error.message}`);
  }
}

// Wacht tot alle afbeeldingen geladen zijn
async function waitForImages(page) {
  try {
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
  } catch {
    // Pagina kan al genavigeerd zijn
  }
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
    await new Promise(resolve => setTimeout(resolve, 2000));
    return true;
  } catch (error) {
    console.log(`⚠️  Cloudflare challenge timeout or error: ${error.message}`);
    return false;
  }
}

// Detecteer en handel DPG Media privacy gate af (redirect naar myprivacy.dpgmedia.* of iframe)
async function handleDPGPrivacyGate(page) {
  const url = page.url();

  // Case 1: Volledig geredirect naar myprivacy.dpgmedia.be of .nl consent-pagina
  if (url.includes('myprivacy.dpgmedia')) {
    console.log(`🔒 DPG privacy gate redirect detected: ${url}`);
    // Wacht zodat de consent-pagina volledig gerenderd is
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Start navigatie-wacht VOOR de klik (race condition fix: klik kan onmiddellijk redirect triggeren)
    const navigationPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    const clicked = await clickAcceptButton(page);
    if (clicked) {
      console.log(`🔒 Clicked DPG consent: "${clicked}"`);
      await navigationPromise;
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    return;
  }

  // Case 2: Privacy gate als iframe op de pagina
  for (const frame of page.frames()) {
    if (frame.url().includes('myprivacy.dpgmedia')) {
      console.log(`🔒 DPG privacy gate iframe detected`);
      try {
        const clicked = await clickAcceptButton(frame);
        if (clicked) {
          console.log(`🔒 Clicked DPG iframe consent: "${clicked}"`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch {
        // Cross-origin iframe access kan falen
      }
      return;
    }
  }

  // Case 3: Privacy gate overlay op de pagina zelf (niet via iframe/redirect)
  const hasPrivacyWall = await page.evaluate(() => {
    return !!document.querySelector('[class*="privacy-wall"], [class*="privacy-gate"], [id*="privacy-wall"], [id*="privacy-gate"], [data-testid*="privacy"]');
  }).catch(() => false);

  if (hasPrivacyWall) {
    console.log(`🔒 DPG privacy wall overlay detected`);
    const clicked = await clickAcceptButton(page);
    if (clicked) {
      console.log(`🔒 Clicked DPG overlay consent: "${clicked}"`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Verwijder hardnekkige overlays/modals/popups uit de DOM (laatste redmiddel voor schone screenshots)
async function removeRemainingOverlays(page) {
  try {
    const removed = await page.evaluate(() => {
      const removedElements = [];

      // 1. Sluit open <dialog> elementen
      document.querySelectorAll('dialog[open]').forEach(d => {
        d.close();
        removedElements.push('dialog');
      });

      // 2. Verwijder bekende popup/overlay containers
      const overlaySelectors = [
        // Sourcepoint consent containers
        'div[id^="sp_message_container"]',
        'div[class*="sp_message"]',
        '.message-overlay',
        // DPG Media specifieke overlays
        '[class*="privacy-gate"]',
        '[class*="privacy-wall"]',
        '[id*="privacy-gate"]',
        '[id*="privacy-wall"]',
        // Notificatie/abonnement prompts
        '[class*="notification-prompt"]',
        '[class*="push-notification"]',
        '[class*="newsletter-popup"]',
        '[class*="subscribe-popup"]',
        // Login/registratie walls
        '[class*="regwall"]',
        '[class*="loginwall"]',
        '[class*="paywall-overlay"]',
        // App promotie banners
        '[class*="smart-banner"]',
        '[class*="app-banner"]',
        '[class*="app-promotion"]',
        // Generieke modal/popup patronen
        '[aria-modal="true"]',
        '[role="dialog"]',
        '[class*="consent-overlay"]',
        '[class*="cookie-wall"]',
        '[id*="consent-overlay"]',
      ];

      for (const selector of overlaySelectors) {
        document.querySelectorAll(selector).forEach(el => {
          el.remove();
          removedElements.push(selector);
        });
      }

      // 3. Verwijder fixed/absolute overlays die het scherm bedekken (gericht zoeken, niet alle elementen)
      const overlayTagsAndSelectors = [
        'div[style*="z-index"]',
        'div[style*="position: fixed"]',
        'div[style*="position:fixed"]',
        'section[style*="z-index"]',
        'aside[style*="position: fixed"]',
        'aside[style*="position:fixed"]',
        'iframe[style*="z-index"]',
        '[class*="overlay"]',
        '[class*="modal"]',
        '[class*="popup"]',
        '[class*="backdrop"]',
        '[class*="curtain"]',
      ];
      const candidates = document.querySelectorAll(overlayTagsAndSelectors.join(','));
      const viewportArea = window.innerWidth * window.innerHeight;
      for (const el of candidates) {
        const style = window.getComputedStyle(el);
        const pos = style.position;
        if (pos !== 'fixed' && pos !== 'absolute') continue;
        const zIndex = parseInt(style.zIndex, 10);
        if (isNaN(zIndex) || zIndex < 900) continue;
        const rect = el.getBoundingClientRect();
        const elArea = rect.width * rect.height;
        if (elArea > viewportArea * 0.3) {
          el.remove();
          removedElements.push(`z-index:${zIndex} (${Math.round(elArea / viewportArea * 100)}% viewport)`);
        }
      }

      // 4. Herstel scrolling op body/html (vaak geblokkeerd door modals)
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      document.documentElement.style.position = '';
      document.body.style.position = '';
      // Verwijder ook overflow:hidden classes die DPG sites vaak toevoegen
      document.documentElement.classList.remove('has-overlay', 'modal-open', 'no-scroll', 'overflow-hidden');
      document.body.classList.remove('has-overlay', 'modal-open', 'no-scroll', 'overflow-hidden');

      return removedElements;
    });

    if (removed.length > 0) {
      console.log(`🧹 Removed ${removed.length} overlay(s): ${removed.join(', ')}`);
    }
  } catch (error) {
    console.log(`⚠️  Overlay removal error: ${error.message}`);
  }
}

// Generieke functie om accept-knoppen te vinden en klikken (werkt op page of frame)
async function clickAcceptButton(context) {
  return context.evaluate(() => {
    const acceptPatterns = [
      /^akkoord$/i,
      /^accepteren$/i,
      /^accept$/i,
      /^agree$/i,
      /alle cookies accepteren/i,
      /alles aanvaarden/i,
      /alles accepteren/i,
      /accept(eer)? (en )?door/i,
      /ik ga akkoord/i,
      /ja,? ik accepteer/i,
      /toestaan/i,
      /doorgaan/i,
    ];

    const elements = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')];
    for (const el of elements) {
      const text = (el.textContent || el.value || '').trim();
      if (acceptPatterns.some(p => p.test(text))) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden') {
          el.click();
          return text;
        }
      }
    }
    return null;
  });
}

// Probeer cookie/consent popups weg te klikken (meerdere rondes voor opeenvolgende popups)
async function dismissPopups(page) {
  // Veelgebruikte selectors voor consent-knoppen (Didomi, Sourcepoint, OneTrust, CookieBot, generiek)
  const consentSelectors = [
    // Didomi (NU.nl, AD, DPG Media sites)
    '#didomi-notice-agree-button',
    '.didomi-continue-without-agreeing',
    '[data-testid="notice-accept-btn"]',
    // DPG Media privacy gate (verschijnt NA cookie consent)
    '[data-testid="privacy-gate-agree-button"]',
    'button[class*="privacy-gate"]',
    '.privacy-gate button',
    '[id*="privacy-gate"] button',
    // Sourcepoint (inclusief v2 patronen)
    'button[title="Akkoord"]',
    'button[title="Accept"]',
    'button[title="Accepteren"]',
    'button[title="Alle cookies accepteren"]',
    'button[title="Alles accepteren"]',
    '[class*="sp_choice_type_11"]',
    '[class*="sp_choice_type_ACCEPT_ALL"]',
    'div[id^="sp_message_container"] button[title*="kkoord"]',
    'div[id^="sp_message_container"] button[title*="ccept"]',
    // OneTrust
    '#onetrust-accept-btn-handler',
    // CookieBot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    // Quantcast / TCF
    'button.css-47sehv',
    '.qc-cmp2-summary-buttons button:first-child',
    // DPG notificatie/abonnement popups (verschijnen na consent)
    '[data-testid="close-button"]',
    '[class*="notification-prompt"] button[class*="close"]',
    '[class*="newsletter"] button[class*="close"]',
    '[class*="subscribe"] button[class*="close"]',
    // Nieuwsblad/DPG specifieke popups (notificaties, nieuwsbrief, abonnement)
    '[class*="banner--cookie"]',
    '[class*="banner--notification"]',
    '[class*="cmp-modal"] button',
    'button[data-testid="button-close"]',
    'button[class*="modal__close"]',
    '[class*="message-component"] button[class*="close"]',
    '[class*="piano-"] button[class*="close"]',
    '[id*="piano"] button[class*="close"]',
    // Generieke sluiten/weigeren knoppen voor popups
    '[aria-label="Sluiten"]',
    '[aria-label="Close"]',
    '[aria-label="close"]',
    '[aria-label="Sluit"]',
    'button[class*="dismiss"]',
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

  // Meerdere rondes: soms verschijnt een tweede popup (privacy gate) na de eerste (cookie consent)
  for (let round = 0; round < 3; round++) {
    let clickedSomething = false;

    // Stap 1: Probeer consent-knoppen in iframes (Sourcepoint/Didomi renderen vaak in iframe, vooral op mobiel)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const clicked = await clickAcceptButton(frame);
        if (clicked) {
          console.log(`🍪 Dismissed popup in iframe: "${clicked}"`);
          await new Promise(resolve => setTimeout(resolve, 1500));
          clickedSomething = true;
          break;
        }
      } catch {
        // Cross-origin iframe, negeren
      }
    }

    if (clickedSomething) continue; // Volgende ronde voor eventuele volgende popup

    // Stap 2: Probeer consent-knoppen op de main page via selectors
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
            await new Promise(resolve => setTimeout(resolve, 1000));
            clickedSomething = true;
            break; // Probeer volgende ronde voor eventuele volgende popup
          }
        }
      } catch {
        // Negeer fouten per selector, probeer volgende
      }
    }

    // Stap 3: Fallback - zoek knoppen op tekst
    if (!clickedSomething) {
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
            /^alles aanvaarden$/i,
            /^toestaan$/i,
            /^nee,? bedankt$/i,
            /^niet nu$/i,
            /^later$/i,
            /^sluiten$/i,
            /^sluit$/i,
            /^no,? thanks$/i,
            /^overslaan$/i,
            /^misschien later$/i,
            /^nu niet$/i,
            /^ik wil geen meldingen$/i,
            /^weigeren$/i,
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
          clickedSomething = true;
        }
      } catch {
        // Negeer fouten
      }
    }

    // Als er niets meer te klikken valt, stoppen
    if (!clickedSomething) break;
  }
}

// Laad pagina en maak klaar voor screenshot (consent-afhandeling, overlays, scroll).
async function loadAndPrepare(page, website, waitUntil = 'networkidle2') {
  const { name, url } = website;

  console.log(`📸 ${name}: Navigating to ${url} (waitUntil: ${waitUntil})`);
  await page.goto(url, {
    waitUntil,
    timeout: CONFIG.timeout
  });

  // Cloudflare "Verify you are human" challenge afhandelen
  await handleCloudflareChallenge(page);

  // DPG privacy gate afhandelen (redirect of iframe)
  await handleDPGPrivacyGate(page);

  console.log(`📸 ${name}: Dismissing popups...`);
  await dismissPopups(page);

  // Na cookie consent kan DPG privacy gate pas verschijnen, dus opnieuw checken
  await handleDPGPrivacyGate(page);

  // Laatste redmiddel: verwijder hardnekkige overlays/modals die niet via klikken weggaan
  console.log(`📸 ${name}: Cleaning up remaining overlays...`);
  await removeRemainingOverlays(page);

  console.log(`📸 ${name}: Scrolling to load all images...`);
  await autoScroll(page);

  // Forceer laden van lazy-loaded afbeeldingen (VRT, Nieuwsblad, etc.)
  console.log(`📸 ${name}: Force-loading lazy images...`);
  await forceLoadLazyImages(page);

  console.log(`📸 ${name}: Waiting for images to load...`);
  await waitForImages(page);

  // Extra wachttijd voor eventuele animaties
  await new Promise(resolve => setTimeout(resolve, CONFIG.waitAfterScroll));

  // Laatste cleanup: scrollen kan nieuwe popups triggeren (notificatie-prompts, etc.)
  await dismissPopups(page);
  await removeRemainingOverlays(page);
}

// Neem een desktopscreenshot op een verse pagina.
async function capturePage(browser, website, timestamp) {
  const { name } = website;

  const page = await browser.newPage();
  try {
    await page.setViewport(CONFIG.desktopViewport);

    console.log(`📸 ${name}: Loading page...`);
    await loadAndPrepare(page, website, 'networkidle2');

    const filename = `${name}_${timestamp}.webp`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    console.log(`📸 ${name}: Taking screenshot...`);
    await page.screenshot({
      path: filepath,
      fullPage: CONFIG.fullPage,
      type: 'webp',
      quality: CONFIG.webpQuality
    });
    console.log(`✅ ${name}: Saved ${filename}`);
    return filename;
  } finally {
    await page.close();
  }
}

async function takeScreenshot(browser, website) {
  const { name } = website;
  const timestamp = getLocalTimestamp();

  try {
    const filename = await capturePage(browser, website, timestamp);
    return { success: true, name, filename };
  } catch (error) {
    console.error(`❌ ${name}: Screenshot failed — ${error?.message}`);
    return { success: false, name, error: error?.message };
  }
}

// Verwerk websites in parallelle batches
async function processInBatches(browser, websites, concurrency) {
  const results = [];
  for (let i = 0; i < websites.length; i += concurrency) {
    const batch = websites.slice(i, i + concurrency);
    console.log(`\n⚡ Batch ${Math.floor(i / concurrency) + 1}: ${batch.map(w => w.name).join(', ')}`);
    const batchResults = await Promise.allSettled(
      batch.map(website => takeScreenshot(browser, website))
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        console.error(`❌ Batch error: ${result.reason?.message}`);
      }
    }
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

  const allWebsites = JSON.parse(readFileSync(WEBSITES_FILE, 'utf-8'));

  if (allWebsites.length === 0) {
    console.log('⚠️  No websites configured in websites.json');
    process.exit(0);
  }

  // Filter websites op basis van interval en huidige tijd (Brussels-tijdzone)
  const now = new Date();
  const currentMinute = parseInt(
    new Intl.DateTimeFormat('nl-BE', { timeZone: CONFIG.timezone, minute: '2-digit' }).format(now),
    10
  );
  const currentHour = parseInt(
    new Intl.DateTimeFormat('nl-BE', { timeZone: CONFIG.timezone, hour: '2-digit', hour12: false }).format(now),
    10
  );
  const isOnTheHour = currentMinute < 15;

  let websites;
  if (isOnTheHour) {
    // Op het hele uur: alle sites, maar filter sites met interval > 60 op basis van uur
    websites = allWebsites.filter(w => {
      const interval = w.interval || 60;
      if (interval <= 60) return true;
      // Voor interval > 60 (bv. 180 = elke 3 uur): alleen als het uur deelbaar is door (interval/60)
      const hourCycle = interval / 60;
      return currentHour % hourCycle === 0;
    });
  } else {
    // Half-uur run: alleen sites met interval <= 30
    websites = allWebsites.filter(w => (w.interval || 60) <= 30);
  }

  console.log(`📋 Found ${allWebsites.length} website(s) configured, ${websites.length} scheduled this run (minute=${currentMinute}, hour=${currentHour}, ${isOnTheHour ? 'full run' : 'half-hour run'})`);
  console.log(`⚡ Concurrency: ${CONFIG.concurrency} sites per batch\n`);

  // Start browser met realistische instellingen
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
      '--lang=nl-NL,nl,en'
    ]
  });

  let results = [];

  try {
    results = await processInBatches(browser, websites, CONFIG.concurrency);
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
