#!/usr/bin/env node

import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { readFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
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
  scrollDelay: 350,
  waitAfterScroll: 2500,
  // WebP compressie (0-100), 70 geeft hogere resolutie (70% web kwaliteit)
  webpQuality: 70,
  // Resize na capture: breedte verkleinen om bestandsgrootte te reduceren (100-300 KB target)
  resizeWidth: 960,
  // Maximale hoogte in pixels (beperkt extreem lange full-page screenshots)
  maxHeight: 8000,
  // Tijdzone voor bestandsnamen
  timezone: 'Europe/Brussels',
  // Aantal sites die tegelijk verwerkt worden (3 is optimaal voor GitHub Actions 2-core runners)
  concurrency: 3,
  // Minimale bestandsgrootte in KB — screenshots kleiner dan dit zijn waarschijnlijk blanco pagina's
  minFileSizeKB: 10,
  // Mobiel viewport (iPhone 14/15 formaat)
  mobileViewport: {
    width: 390,
    height: 844
  },
  // Resize-breedte voor mobiele screenshots (match viewport breedte)
  mobileResizeWidth: 390
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
        const maxScrolls = 60;
        let scrollCount = 0;

        const timer = setInterval(() => {
          const scrollHeight = document.body.scrollHeight;
          window.scrollBy(0, step);
          totalHeight += step;
          scrollCount++;

          if (totalHeight >= scrollHeight || scrollCount >= maxScrolls) {
            clearInterval(timer);
            // Wacht 5 seconden onderaan zodat IntersectionObservers tijd hebben om te vuren
            // en afbeeldingen onderaan de pagina beginnen laden
            setTimeout(() => {
              window.scrollTo(0, 0);
              resolve();
            }, 5000);
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

      // Helper: check of een src een placeholder is (base64 pixel, lege string, etc.)
      function isPlaceholder(src) {
        if (!src || src === '' || src === window.location.href || src.endsWith('/')) return true;
        if (src.startsWith('data:image/svg') || src.startsWith('data:image/gif') || src.startsWith('data:image/png')) return true;
        if (src.includes('placeholder') || src.includes('blank.') || src.includes('pixel.') || src.includes('spacer.')) return true;
        return false;
      }

      // data-src → src (inclusief gevallen waar src een placeholder is)
      document.querySelectorAll('img[data-src]').forEach(img => {
        if (isPlaceholder(img.getAttribute('src'))) {
          img.src = img.dataset.src;
          count++;
        }
      });

      // Extra lazy-load attributen: data-lazy-src, data-original, data-image
      ['data-lazy-src', 'data-original', 'data-image', 'data-hi-res-src'].forEach(attr => {
        document.querySelectorAll(`img[${attr}]`).forEach(img => {
          if (isPlaceholder(img.getAttribute('src'))) {
            img.src = img.getAttribute(attr);
            count++;
          }
        });
      });

      // data-srcset → srcset (voor img en source elementen)
      document.querySelectorAll('img[data-srcset]').forEach(img => {
        if (!img.srcset) { img.srcset = img.dataset.srcset; count++; }
      });
      document.querySelectorAll('source[data-srcset]').forEach(source => {
        if (!source.srcset) { source.srcset = source.dataset.srcset; count++; }
      });
      document.querySelectorAll('img[data-lazy-srcset]').forEach(img => {
        if (!img.srcset) { img.srcset = img.getAttribute('data-lazy-srcset'); count++; }
      });
      document.querySelectorAll('source[data-lazy-srcset]').forEach(source => {
        if (!source.srcset) { source.srcset = source.getAttribute('data-lazy-srcset'); count++; }
      });

      // Verwijder loading="lazy" om native lazy loading uit te schakelen
      document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.loading = 'eager';
        count++;
      });

      // Verwijder decoding="async" om directe decodering te forceren
      document.querySelectorAll('img[decoding="async"]').forEach(img => {
        img.decoding = 'sync';
      });

      // VRT-specifiek: ze gebruiken vaak noscript/picture met verborgen bronnen
      document.querySelectorAll('noscript').forEach(ns => {
        const tmp = document.createElement('div');
        tmp.innerHTML = ns.textContent;
        const imgs = tmp.querySelectorAll('img');
        imgs.forEach(img => {
          if (img.src && !document.querySelector(`img[src="${CSS.escape(img.src)}"]`)) {
            const parent = ns.parentElement;
            if (parent) { parent.appendChild(img); count++; }
          }
        });
      });

      // Data-background / data-bg voor elementen met lazy CSS background-image
      document.querySelectorAll('[data-bg]').forEach(el => {
        if (!el.style.backgroundImage || el.style.backgroundImage === 'none') {
          el.style.backgroundImage = `url('${el.getAttribute('data-bg')}')`;
          count++;
        }
      });
      document.querySelectorAll('[data-background-image]').forEach(el => {
        if (!el.style.backgroundImage || el.style.backgroundImage === 'none') {
          el.style.backgroundImage = `url('${el.getAttribute('data-background-image')}')`;
          count++;
        }
      });

      // React/Next.js blur-up patronen: vervang kleine placeholder-afbeeldingen door de echte
      // Sommige React image components gebruiken een tiny base64 placeholder in src
      // en de echte URL in een data-attribuut of sibling element
      document.querySelectorAll('img').forEach(img => {
        const src = img.getAttribute('src') || '';
        // Detecteer base64 placeholder die kleiner is dan ~200 bytes (typisch voor LQIP)
        if (src.startsWith('data:image/') && src.length < 300) {
          // Zoek een echte URL in data-attributen
          for (const attr of img.attributes) {
            if (attr.name !== 'src' && attr.value && attr.value.startsWith('http') && attr.value.match(/\.(jpg|jpeg|png|webp|avif)/i)) {
              img.src = attr.value;
              count++;
              break;
            }
          }
        }
      });

      // Picture/source elementen: zorg dat alle source elementen een srcset hebben
      document.querySelectorAll('picture > source').forEach(source => {
        if (!source.srcset || source.srcset === '') {
          // Check data-attributen voor de echte srcset
          for (const attr of source.attributes) {
            if (attr.name !== 'srcset' && attr.name.includes('src') && attr.value && !attr.value.startsWith('data:')) {
              source.srcset = attr.value;
              count++;
              break;
            }
          }
        }
      });

      // DPG Media / moderne sites: content-visibility kan afbeeldingen buiten viewport blokkeren
      document.querySelectorAll('[style*="content-visibility"]').forEach(el => {
        el.style.contentVisibility = 'visible';
        count++;
      });

      // Forceer img elementen zonder src maar met srcset om te laden
      document.querySelectorAll('img:not([src])').forEach(img => {
        if (img.srcset || img.dataset.srcset) {
          // Haal eerste URL uit srcset
          const srcset = img.srcset || img.dataset.srcset;
          const firstUrl = srcset.split(',')[0].trim().split(/\s+/)[0];
          if (firstUrl && firstUrl.startsWith('http')) {
            img.src = firstUrl;
            count++;
          }
        }
      });

      // Zoek verborgen/collapsed containers met afbeeldingen en maak ze zichtbaar
      document.querySelectorAll('img').forEach(img => {
        if (!img.complete || img.naturalHeight === 0) {
          // Check of een parent element display:none of visibility:hidden heeft
          let parent = img.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const style = window.getComputedStyle(parent);
            if (style.contentVisibility === 'auto' || style.contentVisibility === 'hidden') {
              parent.style.contentVisibility = 'visible';
              count++;
            }
            parent = parent.parentElement;
          }
        }
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
          // Controleer of het beeld daadwerkelijk geladen is (niet alleen complete=true met placeholder)
          if (img.complete && img.naturalHeight > 0) return Promise.resolve();
          // Afbeelding zonder src hoeft niet te wachten
          if (!img.src && !img.srcset) return Promise.resolve();
          return new Promise((resolve) => {
            img.addEventListener('load', resolve);
            img.addEventListener('error', resolve);
            // Timeout na 8 seconden per afbeelding (verhoogd voor trage CDN's)
            setTimeout(resolve, 8000);
          });
        })
      );
    });
  } catch {
    // Pagina kan al genavigeerd zijn
  }
}

// Verwijder CSS blur/filter effecten die overblijven van LQIP (Low Quality Image Placeholder) lazy loading.
// Sites als VRT NWS gebruiken een blur-up patroon: een klein, wazig beeld wordt getoond terwijl
// het volledige beeld laadt. Soms blijft de CSS filter hangen, zelfs als het beeld geladen is.
async function removeBlurEffects(page) {
  try {
    const removed = await page.evaluate(() => {
      let count = 0;

      // 1. Verwijder filter:blur() van alle elementen (img, picture, div containers, etc.)
      const allElements = document.querySelectorAll('img, picture, figure, [class*="image"], [class*="lazy"], [class*="blur"], [class*="placeholder"], [class*="progressive"], [class*="lqip"]');
      allElements.forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.filter && style.filter.includes('blur')) {
          el.style.filter = 'none';
          count++;
        }
        // Check ook inline styles
        if (el.style.filter && el.style.filter.includes('blur')) {
          el.style.filter = 'none';
          count++;
        }
      });

      // 2. Verwijder blur van alle elementen met hoge z-index of position (overlay placeholders)
      document.querySelectorAll('*').forEach(el => {
        const style = window.getComputedStyle(el);
        if (style.filter && style.filter.includes('blur')) {
          el.style.filter = 'none';
          count++;
        }
      });

      // 3. Verwijder opacity:0 van img elementen (sommige lazy loaders verstoppen de echte afbeelding)
      document.querySelectorAll('img').forEach(img => {
        const style = window.getComputedStyle(img);
        if (img.complete && img.naturalWidth > 0 && parseFloat(style.opacity) < 0.1) {
          img.style.opacity = '1';
          count++;
        }
      });

      // 4. Verwijder CSS classes die blur toepassen (veelvoorkomende patronen)
      const blurClassPatterns = ['blur', 'blurred', 'is-blurred', 'lazy-blur', 'lqip', 'placeholder'];
      document.querySelectorAll('img, picture, figure, [class*="image"]').forEach(el => {
        blurClassPatterns.forEach(pattern => {
          el.classList.forEach(cls => {
            if (cls.toLowerCase().includes(pattern)) {
              el.classList.remove(cls);
              count++;
            }
          });
        });
      });

      return count;
    });

    if (removed > 0) {
      console.log(`🔮 Removed ${removed} blur/filter effect(s)`);
    }

    // 5. Voeg een CSS override toe als vangnet: verwijder alle blur filters en transitions op afbeeldingen
    await page.addStyleTag({
      content: `
        img, picture, picture > source, figure, [class*="image"], [class*="lazy"], [class*="blur"],
        [class*="placeholder"], [class*="progressive"], [class*="lqip"] {
          filter: none !important;
          -webkit-filter: none !important;
        }
        img {
          opacity: 1 !important;
          transition: none !important;
          animation: none !important;
        }
        /* Override content-visibility: auto zodat afbeeldingen buiten viewport ook renderen */
        * {
          content-visibility: visible !important;
        }
      `
    });
  } catch (error) {
    console.log(`⚠️  Remove blur effects error: ${error.message}`);
  }
}

// Scroll elke nog niet geladen afbeelding individueel in beeld om IntersectionObserver te triggeren
async function scrollImagesToLoad(page) {
  try {
    const unloadedCount = await page.evaluate(() => {
      return document.querySelectorAll('img:not([complete])').length +
        Array.from(document.querySelectorAll('img')).filter(img =>
          !img.complete || img.naturalHeight === 0
        ).length;
    });

    if (unloadedCount === 0) return;

    await page.evaluate(async () => {
      const images = Array.from(document.querySelectorAll('img'));
      const unloaded = images.filter(img => !img.complete || img.naturalHeight === 0);

      for (const img of unloaded) {
        img.scrollIntoView({ behavior: 'instant', block: 'center' });
        // Korte pauze zodat IntersectionObserver kan vuren
        await new Promise(r => setTimeout(r, 150));
      }

      // Scroll terug naar boven
      window.scrollTo(0, 0);
    });

    console.log(`🔍 Scrolled ${unloadedCount} unloaded image(s) into view`);
  } catch (error) {
    console.log(`⚠️  scrollImagesToLoad error: ${error.message}`);
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

  // Case 2: Privacy gate als iframe op de pagina (myprivacy.dpgmedia of Sourcepoint iframe)
  for (const frame of page.frames()) {
    const frameUrl = frame.url();
    if (frameUrl.includes('myprivacy.dpgmedia') || frameUrl.includes('sourcepoint') || frameUrl.includes('sp-prod')) {
      console.log(`🔒 DPG/Sourcepoint privacy gate iframe detected: ${frameUrl.slice(0, 80)}...`);
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

// Probeer consent te geven via knoppen in een blokkerende overlay voordat die overlay verwijderd wordt.
// Alleen actief als er een overlay met z-index >= 900 is die > 30% van het scherm bedekt.
// Dit voorkomt dat removeRemainingOverlays de overlay verwijdert zonder consent te geven,
// waardoor de pagina blanco blijft (zoals bij indebuurt.nl sites).
async function tryConsentBeforeRemoval(page) {
  try {
    // Stap 1: Detecteer of er een blokkerende overlay is
    const hasBlockingOverlay = await page.evaluate(() => {
      const viewportArea = window.innerWidth * window.innerHeight;
      const selectors = [
        'div[style*="z-index"]', 'div[style*="position: fixed"]', 'div[style*="position:fixed"]',
        '[class*="overlay"]', '[class*="modal"]', '[class*="popup"]', '[class*="backdrop"]',
        'iframe[style*="z-index"]',
      ];
      const els = document.querySelectorAll(selectors.join(','));
      for (const el of els) {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'absolute') continue;
        const z = parseInt(style.zIndex, 10);
        if (isNaN(z) || z < 900) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height > viewportArea * 0.3) return true;
      }
      return false;
    }).catch(() => false);

    if (!hasBlockingOverlay) return; // Geen overlay → geen actie nodig

    console.log(`🔒 Blocking overlay detected, waiting for CMP to load...`);
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Stap 2: Probeer dismissPopups opnieuw (CMP iframe kan nu geladen zijn)
    await dismissPopups(page);

    // Check of overlay nog steeds aanwezig is na dismissPopups
    const stillBlocked = await page.evaluate(() => {
      const viewportArea = window.innerWidth * window.innerHeight;
      const selectors = [
        'div[style*="z-index"]', 'div[style*="position: fixed"]', 'div[style*="position:fixed"]',
        '[class*="overlay"]', '[class*="modal"]', '[class*="popup"]', '[class*="backdrop"]',
        'iframe[style*="z-index"]',
      ];
      const els = document.querySelectorAll(selectors.join(','));
      for (const el of els) {
        const style = window.getComputedStyle(el);
        if (style.position !== 'fixed' && style.position !== 'absolute') continue;
        const z = parseInt(style.zIndex, 10);
        if (isNaN(z) || z < 900) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width * rect.height > viewportArea * 0.3) return true;
      }
      return false;
    }).catch(() => false);

    if (!stillBlocked) {
      console.log(`🔒 Overlay dismissed via consent button`);
      return;
    }

    // Stap 3: Probeer accept-knoppen in ALLE iframes (niet alleen bekende URL-patronen)
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        const clicked = await clickAcceptButton(frame);
        if (clicked) {
          console.log(`🔒 Clicked consent in iframe: "${clicked}"`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return;
        }
      } catch {
        // Cross-origin iframe, negeren
      }
    }

    // Stap 4: Zoek accept-knoppen binnen de overlay zelf (bredere tekstpatronen)
    const clickedInOverlay = await page.evaluate(() => {
      const acceptPatterns = [
        /akkoord/i, /accepteren/i, /accept/i, /agree/i, /toestaan/i,
        /alle cookies/i, /consent/i, /ga verder/i, /doorgaan/i,
        /i understand/i, /got it/i, /continue/i, /ok/i,
      ];
      const buttons = [...document.querySelectorAll('button, a, [role="button"], input[type="submit"]')];
      for (const btn of buttons) {
        const text = (btn.textContent || btn.value || '').trim();
        if (text.length > 50 || text.length === 0) continue; // Skip lange teksten en lege knoppen
        if (acceptPatterns.some(p => p.test(text))) {
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
    }).catch(() => null);

    if (clickedInOverlay) {
      console.log(`🔒 Clicked consent button: "${clickedInOverlay}"`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      return;
    }

    // Stap 5: Probeer TCF API als laatste redmiddel
    const tcfResult = await page.evaluate(() => {
      if (typeof window.__tcfapi === 'function') {
        return new Promise(resolve => {
          // IAB TCF v2 standaard: postCustomConsent met alle purposes
          window.__tcfapi('getTCData', 2, (data) => {
            if (data?.tcString) {
              // TCF is actief, probeer consent te geven
              // Sommige CMPs ondersteunen 'acceptAll' of vergelijkbaar
              if (typeof window.__tcfapi === 'function') {
                window.__tcfapi('postCustomConsent', 2,
                  () => resolve('tcf-postCustomConsent'),
                  [1,2,3,4,5,6,7,8,9,10], // Standard TCF purposes
                  [], []
                );
              } else {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
          // Timeout na 2s
          setTimeout(() => resolve(null), 2000);
        });
      }
      return null;
    }).catch(() => null);

    if (tcfResult) {
      console.log(`🔒 Granted consent via TCF API: ${tcfResult}`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.log(`⚠️  tryConsentBeforeRemoval error: ${error.message}`);
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

  // Probeer consent te geven als er een blokkerende overlay is (voorkomt blanco screenshots)
  await tryConsentBeforeRemoval(page);

  // Laatste redmiddel: verwijder hardnekkige overlays/modals die niet via klikken weggaan
  console.log(`📸 ${name}: Cleaning up remaining overlays...`);
  await removeRemainingOverlays(page);

  console.log(`📸 ${name}: Scrolling to load all images...`);
  await autoScroll(page);

  // Forceer laden van lazy-loaded afbeeldingen (VRT, Nieuwsblad, etc.)
  console.log(`📸 ${name}: Force-loading lazy images...`);
  await forceLoadLazyImages(page);

  // Geef browser tijd om DOM-wijzigingen te verwerken en netwerk-verzoeken te starten
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log(`📸 ${name}: Waiting for images to load...`);
  await waitForImages(page);

  // Tweede pass: scroll niet-geladen afbeeldingen individueel in beeld
  // Dit vangt IntersectionObserver-gebaseerde lazy loading die de eerste scroll gemist heeft
  console.log(`📸 ${name}: Scrolling unloaded images into view...`);
  await scrollImagesToLoad(page);

  // Na individueel scrollen opnieuw force-loaden en wachten
  await forceLoadLazyImages(page);

  // Wacht tot alle getriggerde netwerk-verzoeken zijn afgerond (alle afbeeldingen geladen)
  console.log(`📸 ${name}: Waiting for network to settle...`);
  try {
    await page.waitForNetworkIdle({ idleTime: 500, timeout: 8000 });
  } catch { /* Timeout is ok — sommige sites laden continu (ads, trackers) */ }

  await waitForImages(page);

  // Derde pass voor hardnekkige lazy-loaded afbeeldingen (DPG Media, VRT NWS)
  const unloadedCount = await page.evaluate(() =>
    Array.from(document.querySelectorAll('img')).filter(img =>
      !img.complete || img.naturalHeight === 0
    ).length
  ).catch(() => 0);

  if (unloadedCount > 3) {
    console.log(`📸 ${name}: ${unloadedCount} images still unloaded, doing third pass...`);
    await scrollImagesToLoad(page);
    await forceLoadLazyImages(page);
    await new Promise(resolve => setTimeout(resolve, 2000));
    await waitForImages(page);
  }

  // Verwijder CSS blur/filter effecten van LQIP lazy loading (VRT NWS, React blur-up, etc.)
  console.log(`📸 ${name}: Removing blur/placeholder effects...`);
  await removeBlurEffects(page);

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

    // Override IntersectionObserver zodat alle lazy-loaded elementen (vooral React-gebaseerde
    // image components zoals bij VRT NWS) meteen als zichtbaar worden beschouwd.
    // Dit voorkomt dat afbeeldingen als blurred placeholders blijven hangen.
    await page.evaluateOnNewDocument(() => {
      // Bewaar de originele IntersectionObserver als fallback
      const OriginalIO = window.IntersectionObserver;

      window.IntersectionObserver = function(callback, options) {
        // Wrap de callback zodat alle entries als zichtbaar worden gemeld
        const wrappedCallback = (entries, observer) => {
          const modified = entries.map(entry => {
            if (!entry.isIntersecting) {
              // Maak een nieuw object met isIntersecting=true
              // We gebruiken Object.defineProperties omdat IntersectionObserverEntry readonly is
              const fake = {};
              for (const key of ['boundingClientRect', 'intersectionRect', 'rootBounds', 'target', 'time']) {
                fake[key] = entry[key];
              }
              fake.isIntersecting = true;
              fake.intersectionRatio = 1;
              return fake;
            }
            return entry;
          });
          callback(modified, observer);
        };

        // Maak een echte IntersectionObserver met de gewrapte callback
        const instance = new OriginalIO(wrappedCallback, options);
        return instance;
      };

      // Kopieer prototype en statische properties van de originele IO
      window.IntersectionObserver.prototype = OriginalIO.prototype;

      // Override content-visibility: auto zodat afbeeldingen buiten viewport ook renderen
      // (voorkomt dat de browser afbeeldingen skip die buiten het zichtbare gebied vallen)
      const style = document.createElement('style');
      style.textContent = '* { content-visibility: visible !important; }';
      (document.head || document.documentElement).appendChild(style);
    });

    console.log(`📸 ${name}: Loading page...`);
    await loadAndPrepare(page, website, 'networkidle2');

    const filename = `${name}_${timestamp}.webp`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    console.log(`📸 ${name}: Taking screenshot...`);
    const rawBuffer = await page.screenshot({
      fullPage: CONFIG.fullPage,
      type: 'webp',
      quality: 80 // hoge kwaliteit voor tussenresultaat, sharp doet de finale compressie
    });

    // Guard: voorkom crash in sharp bij lege buffer (bv. "Input Buffer is empty")
    if (!rawBuffer || rawBuffer.length === 0) {
      throw new Error('Screenshot produced an empty buffer — page may not have rendered');
    }

    // Resize en comprimeer met sharp voor kleinere bestanden (target: 100-300 KB)
    const metadata = await sharp(rawBuffer).metadata();
    const targetWidth = CONFIG.resizeWidth;
    const maxHeight = CONFIG.maxHeight;

    let pipeline = sharp(rawBuffer);

    // Bereken of hoogte beperkt moet worden
    if (metadata.width && metadata.height) {
      const scaledHeight = Math.round(metadata.height * (targetWidth / metadata.width));
      if (scaledHeight > maxHeight) {
        // Crop naar maximale hoogte na resize
        pipeline = pipeline.resize(targetWidth, maxHeight, { fit: 'cover', position: 'top' });
      } else {
        pipeline = pipeline.resize(targetWidth, null, { fit: 'inside', withoutEnlargement: true });
      }
    } else {
      pipeline = pipeline.resize(targetWidth, null, { fit: 'inside', withoutEnlargement: true });
    }

    await pipeline.webp({ quality: CONFIG.webpQuality }).toFile(filepath);

    const stats = statSync(filepath);
    const fileSizeKB = Math.round(stats.size / 1024);

    // Detecteer blanco screenshots (1 KB = vrijwel zeker een lege pagina)
    if (fileSizeKB < CONFIG.minFileSizeKB) {
      unlinkSync(filepath);
      throw new Error(`Screenshot too small: ${fileSizeKB} KB (likely blank page)`);
    }

    console.log(`✅ ${name}: Saved ${filename} (${fileSizeKB} KB)`);
    return filename;
  } finally {
    await page.close();
  }
}

// Neem een mobiele screenshot op een verse pagina.
async function capturePageMobile(browser, website, timestamp) {
  const { name } = website;

  const page = await browser.newPage();
  try {
    await page.setViewport(CONFIG.mobileViewport);

    // Zelfde IntersectionObserver override als desktop
    await page.evaluateOnNewDocument(() => {
      const OriginalIO = window.IntersectionObserver;
      window.IntersectionObserver = function(callback, options) {
        const wrappedCallback = (entries, observer) => {
          const modified = entries.map(entry => {
            if (!entry.isIntersecting) {
              const fake = {};
              for (const key of ['boundingClientRect', 'intersectionRect', 'rootBounds', 'target', 'time']) {
                fake[key] = entry[key];
              }
              fake.isIntersecting = true;
              fake.intersectionRatio = 1;
              return fake;
            }
            return entry;
          });
          callback(modified, observer);
        };
        const instance = new OriginalIO(wrappedCallback, options);
        return instance;
      };
      window.IntersectionObserver.prototype = OriginalIO.prototype;
      const style = document.createElement('style');
      style.textContent = '* { content-visibility: visible !important; }';
      (document.head || document.documentElement).appendChild(style);
    });

    console.log(`📱 ${name}: Loading mobile page...`);
    await loadAndPrepare(page, website, 'networkidle2');

    const filename = `${name}_${timestamp}_mobile.webp`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    console.log(`📱 ${name}: Taking mobile screenshot...`);
    const rawBuffer = await page.screenshot({
      fullPage: CONFIG.fullPage,
      type: 'webp',
      quality: 80
    });

    if (!rawBuffer || rawBuffer.length === 0) {
      throw new Error('Mobile screenshot produced an empty buffer');
    }

    const metadata = await sharp(rawBuffer).metadata();
    const targetWidth = CONFIG.mobileResizeWidth;
    const maxHeight = CONFIG.maxHeight;

    let pipeline = sharp(rawBuffer);

    if (metadata.width && metadata.height) {
      const scaledHeight = Math.round(metadata.height * (targetWidth / metadata.width));
      if (scaledHeight > maxHeight) {
        pipeline = pipeline.resize(targetWidth, maxHeight, { fit: 'cover', position: 'top' });
      } else {
        pipeline = pipeline.resize(targetWidth, null, { fit: 'inside', withoutEnlargement: true });
      }
    } else {
      pipeline = pipeline.resize(targetWidth, null, { fit: 'inside', withoutEnlargement: true });
    }

    await pipeline.webp({ quality: CONFIG.webpQuality }).toFile(filepath);

    const stats = statSync(filepath);
    const fileSizeKB = Math.round(stats.size / 1024);

    if (fileSizeKB < CONFIG.minFileSizeKB) {
      unlinkSync(filepath);
      throw new Error(`Mobile screenshot too small: ${fileSizeKB} KB (likely blank page)`);
    }

    console.log(`✅ ${name}: Saved mobile ${filename} (${fileSizeKB} KB)`);
    return filename;
  } finally {
    await page.close();
  }
}

async function takeScreenshot(browser, website) {
  const { name } = website;
  const timestamp = getLocalTimestamp();
  const maxAttempts = 2;

  // Desktop screenshot
  let desktopResult = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const filename = await capturePage(browser, website, timestamp);
      desktopResult = { success: true, name, filename };
      break;
    } catch (error) {
      if (attempt < maxAttempts && error?.message?.includes('too small')) {
        console.log(`⚠️  ${name}: Blank page detected, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.error(`❌ ${name}: Screenshot failed — ${error?.message}`);
      desktopResult = { success: false, name, error: error?.message };
    }
  }

  // Mobiele screenshot (onafhankelijk van desktop resultaat)
  let mobileFilename = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      mobileFilename = await capturePageMobile(browser, website, timestamp);
      break;
    } catch (error) {
      if (attempt < maxAttempts && error?.message?.includes('too small')) {
        console.log(`⚠️  ${name}: Mobile blank page, retrying (attempt ${attempt + 1}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }
      console.error(`⚠️  ${name}: Mobile screenshot failed — ${error?.message}`);
    }
  }

  if (desktopResult) {
    desktopResult.mobileFilename = mobileFilename;
    return desktopResult;
  }
  return { success: false, name, error: 'Desktop screenshot failed', mobileFilename };
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
    // Op het hele uur: alle sites (behalve halfHour-sites), filter interval > 60 op basis van uur
    websites = allWebsites.filter(w => {
      if (w.halfHour) return false; // deze draaien op het halve uur
      const interval = w.interval || 60;
      if (interval <= 60) return true;
      // Voor interval > 60 (bv. 180 = elke 3 uur): alleen als het uur deelbaar is door (interval/60)
      const hourCycle = interval / 60;
      const offset = w.offset || 0;
      return ((currentHour - offset + 24) % hourCycle) === 0;
    });
  } else {
    // Half-uur run: sites met interval <= 30 + halfHour-sites die op dit uur gepland staan
    websites = allWebsites.filter(w => {
      const interval = w.interval || 60;
      if (!w.halfHour && interval <= 30) return true;
      if (w.halfHour && interval > 60) {
        const hourCycle = interval / 60;
        const offset = w.offset || 0;
        return ((currentHour - offset + 24) % hourCycle) === 0;
      }
      return false;
    });
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
