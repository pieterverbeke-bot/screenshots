import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { createR2Client, listAllObjects } from './r2-client.js';

// Achtervoegsel van de miniaturen (zie writeThumbnail in take-screenshots.js)
const THUMB_SUFFIX = '.thumb.webp';

function buildStructure(objects) {
  // Twee structuren: desktop en mobiel
  // { websiteName: { datum: [{ filename, key, size, thumb }] } }
  const desktop = {};
  const mobile = {};

  // Eerst alle beschikbare miniaturen verzamelen; screenshots van vóór de
  // miniatuur-generatie hebben er geen en vallen terug op het volledige beeld.
  const thumbs = new Set();
  for (const obj of objects) {
    if (obj.Key.endsWith(THUMB_SUFFIX)) thumbs.add(obj.Key);
  }

  for (const obj of objects) {
    const parts = obj.Key.split('/');
    // Verwacht: website/datum/bestand.webp of .jpg
    if (parts.length !== 3) continue;
    if (!parts[2].endsWith('.webp') && !parts[2].endsWith('.jpg')) continue;
    // Miniaturen zijn geen aparte screenshots
    if (parts[2].endsWith(THUMB_SUFFIX)) continue;

    const [website, date, filename] = parts;
    const isMobile = /_mobile\.(webp|jpg)$/.test(filename);
    const target = isMobile ? mobile : desktop;

    if (!target[website]) target[website] = {};
    if (!target[website][date]) target[website][date] = [];
    const thumb = thumbs.has(obj.Key.replace(/\.webp$/, THUMB_SUFFIX));
    target[website][date].push({ filename, key: obj.Key, size: obj.Size, thumb });
  }

  // Sorteer datums oudste eerst, screenshots binnen een datum ook oudste eerst
  for (const structure of [desktop, mobile]) {
    for (const website of Object.keys(structure)) {
      const sorted = {};
      for (const date of Object.keys(structure[website]).sort()) {
        sorted[date] = structure[website][date].sort((a, b) => a.filename.localeCompare(b.filename));
      }
      structure[website] = sorted;
    }
  }

  return { desktop, mobile };
}

// Slanke structuur voor client-side: per website/datum enkel het tijdstip van
// elke opname. Website, datum en de vaste extensie zitten al in de keys, dus de
// client bouwt de bestandsnaam zelf op (decodeEntry in de viewer-script).
// Formaat per item: [*]HH-MM-SS  — de '*' betekent "miniatuur beschikbaar".
// Wijkt een bestandsnaam af van het vaste patroon, dan wordt hij letterlijk
// bewaard met een '!'-prefix.
function encodeEntry(item, website, date, isMobile) {
  const prefix = `${website}_${date}T`;
  const suffix = isMobile ? '_mobile.webp' : '.webp';
  let core = '!' + item.filename;

  if (item.filename.startsWith(prefix) && item.filename.endsWith(suffix)) {
    const time = item.filename.slice(prefix.length, item.filename.length - suffix.length);
    if (/^\d{2}-\d{2}-\d{2}$/.test(time)) core = time;
  }

  return (item.thumb ? '*' : '') + core;
}

function buildClientStructure(structure, isMobile) {
  const result = {};
  for (const [website, dates] of Object.entries(structure)) {
    result[website] = {};
    for (const [date, items] of Object.entries(dates)) {
      result[website][date] = items.map(item => encodeEntry(item, website, date, isMobile));
    }
  }
  return result;
}

function loadWebsitesMeta() {
  const raw = readFileSync(new URL('../websites.json', import.meta.url), 'utf-8');
  const websites = JSON.parse(raw);
  const meta = {};
  for (const w of websites) {
    meta[w.name] = { label: w.label, cluster: w.cluster, interval: w.interval || 60 };
  }
  return { meta, websites };
}

// Het RI&G-merkteken: vier isometrische blokken in de huisstijlkleuren.
// Exacte natrek van het logo dat RI&G aanlevert (rigby-logo.png), niet een
// eigen benadering ervan. Inline SVG, zodat het ook als favicon (data-URI)
// werkt zonder extra request. De faviconvariant staat op een witte tegel en
// blijft zo leesbaar op een donkere tabbalk.
const RIG_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="RI&amp;G"><polygon points="48.44,2.85 68.22,14.79 68.50,34.34 47.70,46.25 48.26,36.26 28.32,24.57 28.02,14.97" fill="#E0A424"/><polygon points="48.44,2.85 68.22,14.79 48.92,26.50 28.02,14.97" fill="#F8BA1E"/><polygon points="68.22,14.79 68.50,34.34 47.70,46.25 48.92,26.50" fill="#E0A424"/><polygon points="28.02,14.97 48.92,26.50 48.26,36.26 28.32,24.57" fill="#EAA528"/><polygon points="8.00,70.44 7.54,36.71 28.32,24.57 48.26,36.26 48.30,54.39 27.78,66.40 27.54,81.57" fill="#E6443A"/><polygon points="8.00,70.44 7.54,36.71 27.56,47.81 27.54,81.57" fill="#DA3739"/><polygon points="7.54,36.71 28.32,24.57 48.26,36.26 27.56,47.81" fill="#E6443A"/><polygon points="27.78,66.40 27.56,47.81 48.26,36.26 48.30,54.39" fill="#B73230"/><polygon points="89.00,70.82 68.50,82.03 68.44,66.32 48.30,54.39 47.70,46.25 68.50,34.34 89.00,46.16" fill="#D22E78"/><polygon points="89.00,70.82 68.50,82.03 68.76,57.65 89.00,46.16" fill="#9E2660"/><polygon points="89.00,46.16 68.76,57.65 47.70,46.25 68.50,34.34" fill="#D22E78"/><polygon points="68.44,66.32 48.30,54.39 47.70,46.25 68.76,57.65" fill="#BD2C79"/><polygon points="48.06,93.44 27.54,81.57 27.78,66.40 48.30,54.39 68.44,66.32 68.50,82.03" fill="#592975"/><polygon points="48.06,78.22 27.78,66.40 48.30,54.39 68.44,66.32" fill="#773B97"/><polygon points="48.06,93.44 48.06,78.22 68.44,66.32 68.50,82.03" fill="#592975"/><polygon points="48.06,93.44 27.54,81.57 27.78,66.40 48.06,78.22" fill="#703694"/></svg>';

const RIG_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96" role="img" aria-label="RI&amp;G"><rect width="96" height="96" rx="21" fill="#ffffff"/><g transform="translate(48 48) scale(.84) translate(-48 -48)"><polygon points="48.44,2.85 68.22,14.79 68.50,34.34 47.70,46.25 48.26,36.26 28.32,24.57 28.02,14.97" fill="#E0A424"/><polygon points="48.44,2.85 68.22,14.79 48.92,26.50 28.02,14.97" fill="#F8BA1E"/><polygon points="68.22,14.79 68.50,34.34 47.70,46.25 48.92,26.50" fill="#E0A424"/><polygon points="28.02,14.97 48.92,26.50 48.26,36.26 28.32,24.57" fill="#EAA528"/><polygon points="8.00,70.44 7.54,36.71 28.32,24.57 48.26,36.26 48.30,54.39 27.78,66.40 27.54,81.57" fill="#E6443A"/><polygon points="8.00,70.44 7.54,36.71 27.56,47.81 27.54,81.57" fill="#DA3739"/><polygon points="7.54,36.71 28.32,24.57 48.26,36.26 27.56,47.81" fill="#E6443A"/><polygon points="27.78,66.40 27.56,47.81 48.26,36.26 48.30,54.39" fill="#B73230"/><polygon points="89.00,70.82 68.50,82.03 68.44,66.32 48.30,54.39 47.70,46.25 68.50,34.34 89.00,46.16" fill="#D22E78"/><polygon points="89.00,70.82 68.50,82.03 68.76,57.65 89.00,46.16" fill="#9E2660"/><polygon points="89.00,46.16 68.76,57.65 47.70,46.25 68.50,34.34" fill="#D22E78"/><polygon points="68.44,66.32 48.30,54.39 47.70,46.25 68.76,57.65" fill="#BD2C79"/><polygon points="48.06,93.44 27.54,81.57 27.78,66.40 48.30,54.39 68.44,66.32 68.50,82.03" fill="#592975"/><polygon points="48.06,78.22 27.78,66.40 48.30,54.39 68.44,66.32" fill="#773B97"/><polygon points="48.06,93.44 48.06,78.22 68.44,66.32 68.50,82.03" fill="#592975"/><polygon points="48.06,93.44 27.54,81.57 27.78,66.40 48.06,78.22" fill="#703694"/></g></svg>'
);

function generateHTML(desktopStructure, mobileStructure, publicUrl, websitesMeta, allWebsites) {
  const websites = Object.keys(desktopStructure).sort();
  const baseUrl = '';

  // Bouw metadata JSON voor client-side filtering
  const metaJSON = JSON.stringify(websitesMeta);

  // Slanke structuur voor lazy rendering van filmstrips (alleen bestandsnamen)
  const clientStructure = buildClientStructure(desktopStructure, false);
  const clientStructureJSON = JSON.stringify(clientStructure);

  // Mobiele structuur voor client-side switching
  const mobileClientStructure = buildClientStructure(mobileStructure, true);
  const mobileClientStructureJSON = JSON.stringify(mobileClientStructure);

  // Verzamel alle unieke datums (nieuwste eerst) voor het datumfilter
  const allDates = new Set();
  for (const website of Object.values(desktopStructure)) {
    for (const date of Object.keys(website)) {
      allDates.add(date);
    }
  }
  const sortedDates = [...allDates].sort().reverse();
  const datesJSON = JSON.stringify(sortedDates);

  // Gebruik desktopStructure als primaire structuur voor server-side HTML rendering
  const structure = desktopStructure;

  // URL van de hero die meteen zichtbaar is: preloaden met hoge prioriteit zodat
  // de browser er niet mee wacht tot het script de rest van de tijdlijn opzet.
  let firstHeroUrl = '';
  if (websites.length > 0) {
    const firstDates = structure[websites[0]];
    const firstDateKeys = Object.keys(firstDates);
    const firstItems = firstDates[firstDateKeys[firstDateKeys.length - 1]] || [];
    const firstNewest = firstItems[firstItems.length - 1];
    if (firstNewest) firstHeroUrl = baseUrl + '/' + firstNewest.key;
  }

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RI&amp;G Screenshots</title>
  <link rel="icon" href="${RIG_FAVICON}" type="image/svg+xml">
  <link rel="preconnect" href="${baseUrl}" crossorigin>
  ${firstHeroUrl ? `<link rel="preload" as="image" href="${firstHeroUrl}" fetchpriority="high">` : ''}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f3f7;
      color: #2d2d3a;
      min-height: 100vh;
    }

    /* Merkteken + account/afmeldknop in de header */
    .brand { display: flex; align-items: center; gap: 0.55rem; }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      padding: 2.5px;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    }
    .brand-mark svg { display: block; width: 100%; height: 100%; }

    .header-right { display: flex; align-items: center; gap: 0.9rem; }

    .account-slot {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      font-size: 0.72rem;
      background: rgba(255, 255, 255, 0.18);
      padding: 0.28rem 0.75rem;
      border-radius: 999px;
      white-space: nowrap;
    }
    .account-slot[hidden] { display: none; }
    .account-slot a {
      color: #fff;
      text-decoration: none;
      font-weight: 600;
      border-left: 1px solid rgba(255, 255, 255, 0.45);
      padding-left: 0.55rem;
    }
    .account-slot a:hover { text-decoration: underline; }
    .account-slot #account-email { opacity: 0.95; }

    /* Linkje naar de Nieuwsmonitor (chef.rigby.be): dezelfde tool-familie,
       dus zichtbaar maar rustiger dan de eigen titel. */
    .tool-link {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      font-weight: 600;
      color: #fff;
      text-decoration: none;
      background: rgba(255, 255, 255, 0.18);
      padding: 0.28rem 0.75rem;
      border-radius: 999px;
      white-space: nowrap;
    }
    .tool-link:hover { background: rgba(255, 255, 255, 0.3); }

    /* Modern compact header */
    header {
      background: linear-gradient(135deg, #783c96 0%, #d23278 50%, #e6463c 80%, #fabb22 100%);
      color: #fff;
      padding: 0.7rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 16px rgba(120, 60, 150, 0.25);
    }

    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    header h1 {
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    header p {
      font-size: 0.7rem;
      opacity: 0.8;
      font-weight: 400;
    }

    /* Compact unified toolbar: filters + tabs in one bar */
    .toolbar {
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid rgba(120,60,150,0.08);
      padding: 0.4rem 2rem;
      position: sticky;
      top: 38px;
      z-index: 99;
      box-shadow: 0 1px 8px rgba(0,0,0,0.04);
    }

    .toolbar-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .toolbar-section {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      flex-shrink: 0;
    }

    .toolbar-divider {
      width: 1px;
      height: 20px;
      background: #ddd4e4;
      margin: 0 0.35rem;
      flex-shrink: 0;
    }

    .toolbar-label {
      font-size: 0.62rem;
      font-weight: 700;
      color: #9a8aaa;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-right: 0.2rem;
      white-space: nowrap;
    }

    .cluster-select {
      appearance: none;
      -webkit-appearance: none;
      padding: 0.2rem 1.4rem 0.2rem 0.5rem;
      border: 1px solid #e0dae6;
      border-radius: 999px;
      background: #f8f5fa url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236a5a7a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 0.45rem center;
      color: #6a5a7a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 500;
      transition: all 0.15s ease;
      line-height: 1.3;
    }

    .cluster-select:hover { background-color: #ebe4f0; border-color: #c0b0d0; }
    .cluster-select:focus { outline: none; border-color: #783c96; box-shadow: 0 0 0 2px rgba(120,60,150,0.12); }

    /* Cluster- en website-keuzelijsten */
    .date-select-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    /* Kalender: één popover voor beide datumvelden (tijdlijn en vergelijkpagina).
       Dagen zonder opnames blijven staan maar zijn niet klikbaar — zo zie je in
       één oogopslag welke dagen er wél zijn. */
    .cal-trigger {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.6rem 0.2rem 0.5rem;
      border: 1px solid #e0dae6;
      border-radius: 999px;
      background: #f8f5fa;
      color: #6a5a7a;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 500;
      line-height: 1.3;
      cursor: pointer;
      transition: all 0.15s ease;
      font-variant-numeric: tabular-nums;
    }

    .cal-trigger::before {
      content: "";
      width: 11px;
      height: 11px;
      flex: 0 0 11px;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%236a5a7a' stroke-width='1.4'%3E%3Crect x='2' y='3.5' width='12' height='11' rx='2'/%3E%3Cpath d='M2 7h12M5.5 1.8v3M10.5 1.8v3' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat center / contain;
    }

    .cal-trigger:hover { background: #ebe4f0; border-color: #c0b0d0; }
    .cal-trigger:focus-visible { outline: none; border-color: #783c96; box-shadow: 0 0 0 2px rgba(120,60,150,0.12); }
    .cal-trigger[aria-expanded="true"] { background: #783c96; border-color: #783c96; color: #fff; }
    .cal-trigger[aria-expanded="true"]::before { filter: brightness(0) invert(1); }

    .cal-pop {
      position: fixed;
      z-index: 300;
      width: 236px;
      padding: 0.6rem;
      background: #fff;
      border: 1px solid #e6dfec;
      border-radius: 12px;
      box-shadow: 0 12px 32px rgba(60, 30, 80, 0.18);
    }

    .cal-pop[hidden] { display: none; }

    .cal-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.3rem;
      margin-bottom: 0.45rem;
    }

    .cal-title {
      font-size: 0.75rem;
      font-weight: 700;
      color: #3d2d4a;
      text-transform: capitalize;
    }

    .cal-nav {
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #e6dfec;
      border-radius: 50%;
      background: #fff;
      color: #6a5a7a;
      font-size: 0.95rem;
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .cal-nav:hover:not(:disabled) { background: #f0ebf6; border-color: #c0b0d0; }
    .cal-nav:disabled { opacity: 0.25; cursor: default; }

    .cal-grid {
      display: grid;
      /* minmax(0, 1fr): zonder die 0 leidt Chrome de kolombreedte af uit de
         aspect-ratio van de dagknoppen en wordt de kalender metersbreed */
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 2px;
    }

    .cal-weekday {
      text-align: center;
      font-size: 0.58rem;
      font-weight: 700;
      color: #a898b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      padding-bottom: 0.2rem;
    }

    .cal-day {
      aspect-ratio: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 7px;
      background: #f6f2f9;
      color: #4a3a5a;
      font-family: inherit;
      font-size: 0.7rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.12s ease;
      font-variant-numeric: tabular-nums;
    }

    .cal-day:hover:not(:disabled) { background: #e3d6ee; }
    /* Dag zonder opnames: wel zichtbaar, niet klikbaar */
    .cal-day.off { background: none; color: #cfc4d8; cursor: default; }
    .cal-day.today { box-shadow: inset 0 0 0 1px #c0b0d0; }
    .cal-day.active { background: #783c96; color: #fff; }
    .cal-day.active:hover { background: #6a3485; }

    .cal-foot { margin-top: 0.5rem; }

    .cal-foot-btn {
      width: 100%;
      padding: 0.3rem;
      border: 1px solid #e6dfec;
      border-radius: 8px;
      background: #faf8fc;
      color: #783c96;
      font-family: inherit;
      font-size: 0.66rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .cal-foot-btn:hover { background: #f0ebf6; border-color: #c0b0d0; }
    .cal-foot-btn[hidden] { display: none; }

    /* Ruimere tikvlakken op een telefoon */
    @media (max-width: 720px) {
      .cal-pop { width: 282px; }
    }

    /* Website select dropdown - replaces horizontal tabs for better navigation */
    .site-select {
      appearance: none;
      -webkit-appearance: none;
      padding: 0.2rem 1.4rem 0.2rem 0.5rem;
      border: 1px solid #e0dae6;
      border-radius: 999px;
      background: #f8f5fa url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236a5a7a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 0.45rem center;
      color: #6a5a7a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 500;
      transition: all 0.15s ease;
      line-height: 1.3;
      max-width: 220px;
    }

    .site-select:hover { background-color: #ebe4f0; border-color: #c0b0d0; }
    .site-select:focus { outline: none; border-color: #783c96; box-shadow: 0 0 0 2px rgba(120,60,150,0.12); }

    .toolbar.cmp-mode .toolbar-hideable { display: none; }

    /* Hidden tabs container - keeps DOM for JS compatibility but not displayed */
    .tabs-scroll {
      display: none;
    }

    .tab {
      display: none;
    }

    .tab.hidden { display: none; }

    .content { max-width: 1400px; margin: 0 auto; padding: 0.75rem 2rem 3rem; }

    .website-section { display: none; }
    .website-section.active { display: block; }

    /* Filmstrip tijdlijn - NOW ABOVE the hero */
    .filmstrip-wrap {
      margin-bottom: 0.5rem;
    }

    .filmstrip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.35rem;
    }

    .filmstrip-title {
      font-size: 0.65rem;
      font-weight: 600;
      color: #9a8aaa;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .filmstrip-scroll-hint {
      font-size: 0.62rem;
      color: #b0a0c0;
    }

    .filmstrip {
      display: flex;
      flex-direction: row;
      gap: 0;
      overflow-x: auto;
      scroll-behavior: smooth;
      scrollbar-width: thin;
      scrollbar-color: #c9b8d9 transparent;
      padding-bottom: 0.35rem;
      align-items: stretch;
    }

    .filmstrip::-webkit-scrollbar { height: 4px; }
    .filmstrip::-webkit-scrollbar-track { background: transparent; border-radius: 3px; }
    .filmstrip::-webkit-scrollbar-thumb { background: #c9b8d9; border-radius: 3px; }

    .fs-date-group {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      flex-shrink: 0;
      border-right: 1.5px solid #e8e0f0;
      padding-right: 0.5rem;
      margin-right: 0.5rem;
    }

    .fs-date-group:last-child {
      border-right: none;
      padding-right: 0;
      margin-right: 0;
    }

    .fs-date-sep {
      display: flex;
      align-items: center;
      justify-content: center;
      writing-mode: vertical-rl;
      text-orientation: mixed;
      transform: rotate(180deg);
      font-size: 0.58rem;
      font-weight: 700;
      color: #783c96;
      padding: 0.2rem 0.25rem;
      background: linear-gradient(180deg, #f0ebf6 0%, #e8e0f0 100%);
      border-radius: 5px 0 0 5px;
      margin-right: 0.3rem;
      flex-shrink: 0;
      min-width: 18px;
      letter-spacing: 0.03em;
      user-select: none;
    }

    .fs-thumbs {
      display: flex;
      flex-direction: row;
      gap: 0.25rem;
      align-items: flex-start;
    }

    .fs-thumb {
      flex: 0 0 80px;
      width: 80px;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      border: 2px solid transparent;
      transition: all 0.18s ease;
      background: #f0ecf5;
    }

    .fs-thumb:hover {
      border-color: #c9b8d9;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(120, 60, 150, 0.12);
    }

    .fs-thumb.active {
      border-color: #783c96;
      box-shadow: 0 2px 10px rgba(120, 60, 150, 0.35);
      transform: translateY(-1px);
    }

    .fs-thumb img {
      width: 100%;
      height: 52px;
      object-fit: cover;
      object-position: top;
      display: block;
    }

    .fs-time {
      display: block;
      text-align: center;
      font-size: 0.58rem;
      font-weight: 500;
      color: #6a5a7a;
      padding: 0.12rem 0;
      background: #fff;
      border-top: 1px solid #f0ecf3;
      white-space: nowrap;
    }

    .fs-thumb.active .fs-time {
      background: #f0ebf6;
      color: #783c96;
      font-weight: 700;
    }

    /* Hero: grote weergave van het geselecteerde screenshot - NOW BELOW filmstrip */
    .hero-wrap { margin-bottom: 0.75rem; }

    .hero-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.3rem 0.15rem 0.35rem;
    }

    .hero-badge {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
      color: #5a4a6a;
    }

    .hero-date { font-weight: 700; color: #783c96; }
    .hero-sep { color: #c9b8d9; }
    .hero-time { font-weight: 500; }

    .hero-hint {
      font-size: 0.65rem;
      color: #b0a0c0;
      font-style: italic;
    }

    .hero-stage {
      background: #ffffff;
      border-radius: 10px;
      border: 1px solid #e0d8e8;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
      height: 72vh;
      min-height: 180px;
      cursor: zoom-in;
      touch-action: pan-y;
      scrollbar-width: thin;
      scrollbar-color: #c9b8d9 #ffffff;
    }

    .hero-stage::-webkit-scrollbar { width: 5px; }
    .hero-stage::-webkit-scrollbar-track { background: #ffffff; }
    .hero-stage::-webkit-scrollbar-thumb { background: #c9b8d9; border-radius: 3px; }

    .hero-img {
      width: 100%;
      height: auto;
      display: block;
      transition: opacity 0.25s ease, transform 0.25s ease;
      will-change: transform;
      border: 1px solid #e0d8e8;
      border-radius: 6px;
    }

    .hero-img.loading { opacity: 0.4; }
    .hero-img.swiping {
      transition: none !important;
      border-color: #c9b8d9;
      box-shadow: 0 4px 24px rgba(120, 60, 150, 0.15);
    }

    /* Carousel wrapper met peek-afbeeldingen links/rechts */
    .hero-carousel {
      display: flex;
      align-items: stretch;
      justify-content: center;
      gap: 4px;
    }

    .hero-peek {
      width: 28px;
      flex-shrink: 0;
      overflow: hidden;
      border-radius: 10px;
      background: #ffffff;
      border: 1px solid #e0d8e8;
      opacity: 0.45;
      transition: opacity 0.2s ease;
      cursor: pointer;
    }

    .hero-peek:hover { opacity: 0.7; }

    .hero-peek img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      display: block;
    }

    .hero-peek.hidden { visibility: hidden; pointer-events: none; }


    .hero-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6a5a7a;
      font-size: 0.85rem;
    }

    .empty {
      text-align: center;
      color: #a898b8;
      padding: 4rem 2rem;
      font-size: 0.95rem;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(22, 16, 31, 0.94);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      z-index: 1000;
      overflow: auto;
    }

    .lightbox.open { display: flex; align-items: flex-start; justify-content: center; }

    .lightbox img {
      max-width: 95%;
      margin: 2rem auto;
      display: block;
      border-radius: 8px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      cursor: default;
    }

    .lightbox-close {
      position: fixed;
      top: 1rem;
      right: 1.5rem;
      color: #fff;
      font-size: 1.6rem;
      cursor: pointer;
      z-index: 1001;
      line-height: 1;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(4px);
      transition: all 0.2s;
    }

    .lightbox-close:hover { background: rgba(255,255,255,0.22); transform: scale(1.1); }

    .lightbox-nav {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      color: #fff;
      font-size: 1.8rem;
      cursor: pointer;
      z-index: 1001;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      backdrop-filter: blur(4px);
      transition: all 0.2s;
      user-select: none;
    }

    .lightbox-nav:hover { background: rgba(255,255,255,0.22); transform: translateY(-50%) scale(1.1); }
    .lightbox-nav.prev { left: 1rem; }
    .lightbox-nav.next { right: 1rem; }
    .lightbox-nav.disabled { opacity: 0.15; cursor: default; pointer-events: none; }

    .lightbox-counter {
      position: fixed;
      bottom: 1.2rem;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.7);
      font-size: 0.75rem;
      font-weight: 500;
      background: rgba(0,0,0,0.35);
      backdrop-filter: blur(4px);
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      z-index: 1001;
      pointer-events: none;
    }

    /* Vergelijk titels: mobiele opnames van meerdere merken naast elkaar.
       Enkel mobiel — die beelden zijn smal genoeg om er zes te laten passen. */
    /* De vergelijkpagina staat buiten .content en gebruikt de volle breedte:
       zo passen er meer kolommen naast elkaar. */
    .website-section[data-site="__vergelijk__"] { padding: 0.6rem 1rem 0.8rem; }
    body.cmp-open .content { display: none; }

    .cmp-bar {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      margin-bottom: 0.7rem;
    }

    .cmp-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
    }

    .cmp-date { font-size: 0.7rem; font-weight: 600; color: #5a4a6a; padding: 0.24rem 0.65rem 0.24rem 0.55rem; }

    .cmp-nav {
      width: 26px;
      height: 26px;
      flex: 0 0 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #e0dae6;
      border-radius: 50%;
      background: #fff;
      color: #6a5a7a;
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .cmp-nav:hover:not(:disabled) { background: #f0ebf6; border-color: #c0b0d0; }
    .cmp-nav:disabled { opacity: 0.3; cursor: default; }

    .cmp-moment {
      display: flex;
      align-items: baseline;
      gap: 0.4rem;
      min-width: 170px;
    }

    .cmp-moment-time {
      font-size: 0.95rem;
      font-weight: 700;
      color: #3d2d4a;
      letter-spacing: -0.01em;
      font-variant-numeric: tabular-nums;
    }

    .cmp-moment-meta {
      font-size: 0.65rem;
      color: #9a8aaa;
      white-space: nowrap;
    }

    .cmp-slider {
      flex: 1 1 140px;
      min-width: 110px;
      accent-color: #783c96;
      cursor: pointer;
    }

    .cmp-tol {
      appearance: none;
      -webkit-appearance: none;
      padding: 0.2rem 1.3rem 0.2rem 0.5rem;
      border: 1px solid #e0dae6;
      border-radius: 999px;
      background: #f8f5fa url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%236a5a7a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E") no-repeat right 0.4rem center;
      color: #6a5a7a;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 500;
      cursor: pointer;
    }

    .cmp-sync {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.65rem;
      color: #6a5a7a;
      cursor: pointer;
      white-space: nowrap;
    }

    .cmp-sync input { accent-color: #783c96; cursor: pointer; }

    .cmp-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.3rem 0.2rem 0.6rem;
      border: 1px solid #ddd0e8;
      border-radius: 999px;
      background: #f3edf8;
      color: #5a4a6a;
      font-size: 0.64rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .cmp-chip button {
      border: none;
      background: transparent;
      color: #9a8aaa;
      font-size: 0.8rem;
      line-height: 1;
      padding: 0 0.15rem;
      cursor: pointer;
      border-radius: 50%;
    }

    .cmp-chip button:hover { color: #d23278; background: rgba(210,50,120,0.1); }

    .cmp-add {
      appearance: none;
      -webkit-appearance: none;
      padding: 0.22rem 0.7rem;
      border: 1px dashed #c8b8d8;
      border-radius: 999px;
      background: #fff;
      color: #783c96;
      font-family: inherit;
      font-size: 0.64rem;
      font-weight: 600;
      cursor: pointer;
    }

    .cmp-add:disabled { opacity: 0.4; cursor: default; }

    .cmp-hint { font-size: 0.65rem; color: #9a8aaa; }

    .cmp-grid {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(215px, 1fr);
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.4rem;
    }

    .cmp-col {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 220px);
      min-height: 320px;
      min-width: 0;
      border: 1px solid #e6dfec;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
      box-shadow: 0 1px 6px rgba(120,60,150,0.06);
    }

    .cmp-col-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.4rem;
      padding: 0.35rem 0.55rem;
      border-bottom: 1px solid #f0ebf4;
      background: #faf8fc;
    }

    .cmp-col-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #3d2d4a;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cmp-col-time {
      font-size: 0.68rem;
      font-weight: 600;
      color: #783c96;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }

    /* Wijkt de opname meer dan een paar minuten af van de rest van het moment,
       dan verdient dat een waarschuwing in plaats van stille misleiding. */
    .cmp-col-time.drift { color: #d23278; }
    .cmp-col-time.missing { color: #a898b8; font-weight: 500; }

    .cmp-shot {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      background: #f7f5f9;
      cursor: zoom-in;
    }

    .cmp-shot img { display: block; width: 100%; height: auto; }

    .cmp-missing {
      flex: 1 1 auto;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 1rem;
      color: #a898b8;
      font-size: 0.7rem;
      line-height: 1.5;
      background: repeating-linear-gradient(45deg, #faf8fc, #faf8fc 8px, #f4f0f8 8px, #f4f0f8 16px);
    }

    .cmp-empty {
      text-align: center;
      color: #a898b8;
      padding: 3rem 2rem;
      font-size: 0.85rem;
      line-height: 1.7;
    }

    @media (max-width: 720px) {
      .website-section[data-site="__vergelijk__"] { padding: 0.5rem 0.6rem 0.8rem; }
      /* Schuifbalk op een eigen regel, anders loopt de rij van het scherm af */
      .cmp-slider { flex-basis: 100%; }
      .cmp-grid { grid-auto-columns: minmax(180px, 76vw); }
      .cmp-col { height: calc(100vh - 260px); }
    }

    /* Schema tab - hidden, navigated via dropdown */

    .schema-intro {
      margin-bottom: 1.5rem;
      padding: 1rem 1.2rem;
      background: #f0ebf6;
      border-radius: 10px;
      border-left: 4px solid #783c96;
      font-size: 0.85rem;
      color: #5a4a6a;
      line-height: 1.6;
    }

    .schema-intro code {
      background: #e4d9ee;
      padding: 0.1em 0.4em;
      border-radius: 4px;
      font-size: 0.82rem;
      font-family: 'SFMono-Regular', 'Consolas', monospace;
      color: #783c96;
    }

    .schema-group { margin-bottom: 2rem; }

    .schema-group-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #8a7a9a;
      margin-bottom: 0.6rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid #ece8f0;
    }

    .schema-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.84rem;
      table-layout: fixed;
    }

    .schema-table th {
      text-align: left;
      padding: 0.5rem 0.9rem;
      font-weight: 600;
      color: #5a4a6a;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      background: #f8f5fa;
    }

    .schema-table th:nth-child(1) { width: 14%; }
    .schema-table th:nth-child(2) { width: 46%; }
    .schema-table th:nth-child(3) { width: 16%; }
    .schema-table th:nth-child(4) { width: 24%; }

    .schema-table td {
      padding: 0.55rem 0.9rem;
      border-bottom: 1px solid #f5f2f8;
      vertical-align: middle;
    }

    .schema-table td:nth-child(2) {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .schema-table tr:last-child td { border-bottom: none; }

    .schema-table .site-label { font-weight: 600; color: #2d2d3a; }

    .interval-badge {
      display: inline-block;
      padding: 0.22rem 0.65rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }
    .interval-30  { background: #dcfce7; color: #15803d; }
    .interval-60  { background: #dbeafe; color: #1d4ed8; }
    .interval-120 { background: #fef9c3; color: #a16207; }
    .interval-180 { background: #ffedd5; color: #c2410c; }
    .interval-240 { background: #fee2e2; color: #b91c1c; }

    .mobile-toggle {
      appearance: none;
      -webkit-appearance: none;
      padding: 0.2rem 0.6rem;
      border: 1px solid #e0dae6;
      border-radius: 999px;
      background: #f8f5fa;
      color: #6a5a7a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.62rem;
      font-weight: 600;
      transition: all 0.15s ease;
      line-height: 1.3;
      white-space: nowrap;
    }
    .mobile-toggle:hover { background: #ebe4f0; border-color: #c0b0d0; }

    /* Snelknop naar de vergelijkpagina (en terug), altijd zichtbaar */
    .view-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.7rem;
      border: 1px solid #783c96;
      border-radius: 999px;
      background: #fff;
      color: #783c96;
      font-family: inherit;
      font-size: 0.65rem;
      font-weight: 700;
      line-height: 1.3;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .view-toggle::before {
      content: "";
      width: 11px;
      height: 11px;
      flex: 0 0 11px;
      background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23783c96' stroke-width='1.5'%3E%3Crect x='1.6' y='2.4' width='5' height='11.2' rx='1.4'/%3E%3Crect x='9.4' y='2.4' width='5' height='11.2' rx='1.4'/%3E%3C/svg%3E") no-repeat center / contain;
    }

    .view-toggle:hover { background: #f3edf8; }
    .view-toggle.active { background: #783c96; color: #fff; }
    .view-toggle.active::before { filter: brightness(0) invert(1); }
    .view-toggle.active:hover { background: #6a3485; }
    .mobile-toggle.active {
      background: #783c96;
      color: #fff;
      border-color: #783c96;
    }
    .mobile-toggle.active:hover { background: #6a3485; }

    @media (max-width: 700px) {
      header { padding: 0.5rem 1rem; }
      .header-inner { flex-direction: column; align-items: flex-start; gap: 0.25rem; }
      .header-right { flex-wrap: wrap; gap: 0.5rem; }
      header h1 { font-size: 0.9rem; }
      .toolbar { padding: 0.35rem 0.75rem; top: 32px; }
      .toolbar-inner { flex-wrap: wrap; gap: 0.3rem; }
      .toolbar-divider { display: none; }
      .content { padding: 0.5rem 0.75rem 2rem; }
      .hero-stage { height: 55vh; }
      .fs-thumb { flex: 0 0 64px; width: 64px; }
      .fs-thumb img { height: 42px; }
      .hero-peek { width: 20px; }
      .lightbox-nav { width: 36px; height: 36px; font-size: 1.4rem; }
      .lightbox-nav.prev { left: 0.3rem; }
      .lightbox-nav.next { right: 0.3rem; }
      .schema-table th, .schema-table td { padding: 0.45rem 0.6rem; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <span class="brand-mark">${RIG_LOGO_SVG}</span>
        <h1>RI&amp;G Screenshots</h1>
      </div>
      <div class="header-right">
        <!-- De twee tools horen bij elkaar: de Nieuwsmonitor toont wat er nu in
             het nieuws is, deze pagina wat er toen op de homepages stond. -->
        <a class="tool-link" href="https://chef.rigby.be/" title="RI&amp;G Nieuwsmonitor: wat er nu in het nieuws is">Nieuwsmonitor &#8599;</a>
        <p>Laatste update: ${new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</p>
        <!-- De Worker vult dit blok met het aangemelde account en toont het;
             zonder login blijft het verborgen. -->
        <span class="account-slot" id="account-slot" hidden><span id="account-email"></span><a href="/logout" id="logout-link">Afmelden</a></span>
      </div>
    </div>
  </header>

  <div class="toolbar" id="toolbar">
    <div class="toolbar-inner">
      <div class="toolbar-section">
        <span class="toolbar-label">Cluster</span>
        <div class="date-select-wrap">
          <select class="cluster-select" id="filter-cluster">
            <option value="">Alle clusters</option>
          </select>
        </div>
      </div>
      <div class="toolbar-divider toolbar-hideable"></div>
      <div class="toolbar-section toolbar-hideable">
        <span class="toolbar-label">Datum</span>
        <button class="cal-trigger" type="button" id="filter-date" aria-haspopup="dialog" aria-expanded="false">Kies datum</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-section">
        <span class="toolbar-label">Website</span>
        <div class="date-select-wrap">
          <select class="site-select" id="filter-site">
          </select>
        </div>
      </div>
      <div class="toolbar-divider toolbar-hideable"></div>
      <div class="toolbar-section toolbar-hideable">
        <button class="mobile-toggle" id="mobile-toggle" title="Schakelen tussen desktop en mobiele screenshots">Mobiele versie</button>
      </div>
      <div class="toolbar-divider"></div>
      <div class="toolbar-section">
        <button class="view-toggle" id="view-toggle" title="Meerdere titels naast elkaar op hetzelfde moment">Vergelijk titels</button>
      </div>
      <div class="tabs-scroll" id="tabs">
        ${websites.map((w, i) => {
          const m = websitesMeta[w];
          const label = m ? m.label : w;
          return `<button class="tab${i === 0 ? ' active' : ''}" data-site="${w}" data-cluster="${m ? m.cluster : ''}">${label}</button>`;
        }).join('\n        ')}
        <button class="tab tab-vergelijk" data-site="__vergelijk__" data-cluster="">Vergelijk titels</button>
        <button class="tab tab-schema" data-site="__schema__" data-cluster="">Schema</button>
      </div>
    </div>
  </div>

  <div class="content">
    ${websites.length === 0 ? '<div class="empty">Nog geen screenshots gevonden.</div>' : ''}
    ${websites.map((website, i) => {
      const dates = structure[website];
      const dateKeys = Object.keys(dates);
      // Bepaal de URL van de meest recente (laatste) screenshot voor eager loading
      const lastDateKey = dateKeys[dateKeys.length - 1];
      const lastDatePairs = dates[lastDateKey] || [];
      const newestItem = lastDatePairs[lastDatePairs.length - 1];
      const newestUrl = newestItem ? (baseUrl + '/' + newestItem.key) : '';
      const newestTIdx = newestItem ? newestItem.filename.indexOf('T') : -1;
      const newestTimePart = newestTIdx > -1 ? newestItem.filename.slice(newestTIdx+1, newestTIdx+9) : '';
      const newestTimeStr = newestTimePart.length === 8 ? newestTimePart.replace(/-/g, ':') : '';

      return `<div class="website-section${i === 0 ? ' active' : ''}" data-site="${website}" data-rendered="${i === 0 ? 'true' : 'false'}" data-rendered-mode="${i === 0 ? 'desktop' : ''}">
      <!-- Filmstrip tijdlijn: boven de hero voor snelle navigatie -->
      <div class="filmstrip-wrap">
        <div class="filmstrip-header">
          <span class="filmstrip-title">Tijdlijn</span>
          <span class="filmstrip-scroll-hint">oudste ← scroll → nieuwste</span>
        </div>
        <div class="filmstrip" id="filmstrip-${website}">
          ${i === 0 ? Object.entries(dates).map(([date, pairs]) => {
            return '<div class="fs-date-group" data-date="'+date+'">'
              + '<div class="fs-date-sep">'+date+'</div>'
              + '<div class="fs-thumbs">'
              + pairs.map((item, pairIdx) => {
                const tIdx = item.filename.indexOf('T');
                const timePart = tIdx > -1 ? item.filename.slice(tIdx+1, tIdx+9) : '';
                const timeStr = timePart.length === 8 ? timePart.replace(/-/g, ':') : '';
                const url = baseUrl + '/' + item.key;
                // Miniatuur (~5 KB) i.p.v. het volledige screenshot (100-300 KB);
                // oudere opnames zonder miniatuur vallen terug op het origineel.
                const thumbSrc = item.thumb ? url.replace(/\.webp$/, THUMB_SUFFIX) : url;
                const heavy = item.thumb ? '' : ' data-heavy="1"';
                const isNewestThumb = date === lastDateKey && pairIdx === pairs.length - 1;
                // Eager load enkel nieuwste thumb van eerste website
                const src = isNewestThumb ? 'src="'+thumbSrc+'" ' : '';
                return '<div class="fs-thumb'+(isNewestThumb ? ' active' : '')+'" data-url="'+url+'" data-date="'+date+'" data-time="'+timeStr+'">'
                  + '<img '+src+'data-src="'+thumbSrc+'"'+heavy+' decoding="async" fetchpriority="low" alt="'+timeStr+'">'
                  + '<span class="fs-time">'+timeStr+'</span>'
                  + '</div>';
              }).join('')
              + '</div>'
              + '</div>';
          }).join('\n          ') : '<!-- lazy rendered -->'}
        </div>
      </div>

      <!-- Hero: grote weergave van het geselecteerde screenshot -->
      <div class="hero-wrap">
        <div class="hero-meta">
          <div class="hero-badge">
            <span class="hero-date" id="hero-date-${website}">${i === 0 ? lastDateKey : ''}</span>
            <span class="hero-sep">${i === 0 && newestTimeStr ? '·' : ''}</span>
            <span class="hero-time" id="hero-time-${website}">${i === 0 ? newestTimeStr : ''}</span>
          </div>
          <span class="hero-hint">klik om te vergroten · pijltjestoetsen ← → · swipe</span>
        </div>
        <div class="hero-carousel">
          <div class="hero-peek hero-peek-left hidden" id="peek-left-${website}"><img alt=""></div>
          <div class="hero-stage" id="hero-stage-${website}">
            <img class="hero-img" id="hero-img-${website}"
              ${i === 0 && newestUrl ? 'src="'+newestUrl+'" fetchpriority="high"' : ''}
              alt="Screenshot">
            <div class="hero-placeholder" id="hero-placeholder-${website}"${i === 0 && newestUrl ? ' style="display:none"' : ''}>Selecteer een screenshot in de tijdlijn hierboven</div>
          </div>
          <div class="hero-peek hero-peek-right hidden" id="peek-right-${website}"><img alt=""></div>
        </div>
      </div>
    </div>`;
    }).join('\n    ')}
  </div>

  <div class="website-section" data-site="__schema__">
    <div class="schema-intro">
      Pas de frequentie per site aan via het <code>interval</code>-veld in <code>websites.json</code>.
      Geldige waarden: <strong>30</strong> (2x/uur), <strong>60</strong> (1x/uur),
      <strong>120</strong> (1x/2u), <strong>180</strong> (1x/3u), <strong>240</strong> (1x/4u) minuten.
      Met <code>halfHour: true</code> draait een site op het halve uur in plaats van het hele —
      zo blijft het werk verdeeld over twee runs. Enkel sites die in dezelfde run zitten,
      kan je naast elkaar leggen op de vergelijkpagina.
      Na aanpassen: commit &amp; push naar GitHub, de volgende run gebruikt direct de nieuwe instelling.
    </div>
    ${(() => {
      const grouped = {};
      for (const w of allWebsites) {
        const cluster = w.cluster || 'Overig';
        if (!grouped[cluster]) grouped[cluster] = [];
        grouped[cluster].push(w);
      }
      return Object.entries(grouped).map(([cluster, sites]) => `
    <div class="schema-group">
      <div class="schema-group-title">${cluster}</div>
      <table class="schema-table">
        <thead><tr><th>Site</th><th>URL</th><th>Interval</th><th>Frequentie</th><th>Moment</th></tr></thead>
        <tbody>
          ${sites.map(w => {
            const interval = w.interval || 60;
            const freq = interval === 30 ? '2x per uur'
              : interval === 60 ? '1x per uur'
              : interval === 120 ? '1x per 2 uur'
              : interval === 180 ? '1x per 3 uur'
              : `1x per ${interval / 60} uur`;
            // Wanneer een site draait bepaalt of je hem naast een andere titel kan
            // leggen: twee sites vergelijken lukt enkel als ze in dezelfde run zitten.
            const moment = interval <= 30 ? 'heel + half uur'
              : w.halfHour ? 'op het halve uur'
              : 'op het hele uur';
            const skip = w.skipHours && w.skipHours.length
              ? ` · niet om ${w.skipHours.join(', ')}u`
              : '';
            return `<tr>
              <td class="site-label">${w.label}</td>
              <td style="color:#8a7a9a;font-size:0.78rem">${w.url}</td>
              <td><span class="interval-badge interval-${interval}">${interval} min</span></td>
              <td style="color:#6a5a7a">${freq}</td>
              <td style="color:#6a5a7a">${moment}${skip}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`).join('');
    })()}
  </div>

  <div class="website-section" data-site="__vergelijk__">
    <div class="cmp-bar">
      <div class="cmp-row">
        <button class="cal-trigger cmp-date" type="button" id="cmp-date" aria-haspopup="dialog" aria-expanded="false">Kies datum</button>
        <button class="cmp-nav" id="cmp-prev" title="Vorig moment">&#8249;</button>
        <div class="cmp-moment">
          <span class="cmp-moment-time" id="cmp-moment-time">--:--</span>
          <span class="cmp-moment-meta" id="cmp-moment-meta"></span>
        </div>
        <button class="cmp-nav" id="cmp-next" title="Volgend moment">&#8250;</button>
        <input type="range" class="cmp-slider" id="cmp-slider" min="0" max="0" value="0" title="Schuif door de momenten van deze dag">
        <select class="cmp-tol" id="cmp-tol" title="Hoeveel mogen de tijdstippen van elkaar afwijken?">
          <option value="5">max 5 min</option>
          <option value="10">max 10 min</option>
          <option value="15" selected>max 15 min</option>
          <option value="30">max 30 min</option>
        </select>
        <label class="cmp-sync"><input type="checkbox" id="cmp-sync" checked>samen scrollen</label>
      </div>
      <div class="cmp-row" id="cmp-chips"></div>
    </div>
    <div class="cmp-grid" id="cmp-grid"></div>
  </div>

  <div class="cal-pop" id="cal-pop" hidden role="dialog" aria-label="Kies een datum">
    <div class="cal-head">
      <button class="cal-nav" type="button" id="cal-prev" title="Vorige maand">&#8249;</button>
      <span class="cal-title" id="cal-title"></span>
      <button class="cal-nav" type="button" id="cal-next" title="Volgende maand">&#8250;</button>
    </div>
    <div class="cal-grid" id="cal-grid"></div>
    <div class="cal-foot"><button class="cal-foot-btn" type="button" id="cal-foot" hidden></button></div>
  </div>

  <div class="lightbox" id="lightbox">
    <span class="lightbox-close" id="lightbox-close">&times;</span>
    <span class="lightbox-nav prev" id="lightbox-prev">&#8249;</span>
    <span class="lightbox-nav next" id="lightbox-next">&#8250;</span>
    <span class="lightbox-counter" id="lightbox-counter"></span>
    <img src="" alt="Screenshot" id="lightbox-img">
  </div>

  <script>
    const meta = ${metaJSON};
    const allDates = ${datesJSON};
    const screenshotData = ${clientStructureJSON};
    const mobileScreenshotData = ${mobileClientStructureJSON};
    const screenshotBaseUrl = '${baseUrl}';

    let isMobileMode = false;
    function getActiveData() { return isMobileMode ? mobileScreenshotData : screenshotData; }

    // Standaardweergave bij openen: AD.nl in de tijdlijn, en op de vergelijkpagina
    // AD, NU, VK en HLN naast elkaar. Titels zonder (mobiele) opnames vallen weg.
    var DEFAULT_SITE = 'ad';
    var DEFAULT_COMPARE = ['ad', 'nu', 'vk', 'hln'];

    // Naast de websites staan er twee vaste pagina's in dezelfde navigatie
    var VIRTUAL_SITES = { '__schema__': 'Schema', '__vergelijk__': 'Vergelijk titels' };
    function isVirtualSite(site) { return Object.prototype.hasOwnProperty.call(VIRTUAL_SITES, site); }

    const filterState = { cluster: null };

    // URL query parameters parsen voor deelbare links
    // Gebruik: ?cluster=HLN&site=hln&date=2024-01-15&t=14:35
    //
    // 't' is het tijdstip waarnaar een link wijst: niet elke opname heeft een
    // eigen adres, dus de viewer zoekt de opname die er het dichtst bij ligt.
    // Zo kan een andere tool (de Nieuwsmonitor op chef.rigby.be) doorlinken
    // vanaf het moment dat een bericht verscheen naar de homepage van toen.
    function getUrlParams() {
      const params = new URLSearchParams(window.location.search);
      return {
        cluster: params.get('cluster'),
        site: params.get('site'),
        date: params.get('date'),
        mobile: params.get('mobile'),
        view: params.get('view'),
        cmp: params.get('cmp'),
        plus: params.get('plus'),
        t: params.get('t') || params.get('tijd'),
      };
    }

    // Een tijdstip uit een link of uit data-time lezen: '14:35', '14:35:07',
    // '14-35-00' en '1435' geven alle vier hetzelfde aantal minuten na
    // middernacht. Onleesbaar of onbestaand tijdstip -> null.
    function parseClock(value) {
      if (!value) return null;
      // Let op: dit staat in een template literal, dus geen backslashes in
      // het patroon ('\\d' zou hier als 'd' in de pagina belanden).
      var m = /^([0-9]{1,2})[:.h-]?([0-9]{2})(?:[:.-]([0-9]{2}))?$/.exec(String(value).trim());
      if (!m) return null;
      var hh = parseInt(m[1], 10), mm = parseInt(m[2], 10), ss = m[3] ? parseInt(m[3], 10) : 0;
      if (hh > 23 || mm > 59 || ss > 59) return null;
      return hh * 60 + mm + ss / 60;
    }

    function updateUrl() {
      const params = new URLSearchParams();
      if (filterState.cluster) params.set('cluster', filterState.cluster);
      const activeTab = document.querySelector('.tab.active');
      const activeSite = activeTab ? activeTab.dataset.site : '';
      if (activeSite === '__vergelijk__') {
        params.set('view', 'vergelijk');
        if (cmpState.sites.length) params.set('cmp', cmpState.sites.join(','));
        if (cmpState.date) params.set('date', cmpState.date);
        const moment = cmpState.moments[cmpState.index];
        if (moment) params.set('t', moment.shots[0].time);
      } else if (activeTab && !isVirtualSite(activeSite)) {
        params.set('site', activeSite);
        // Datum en tijdstip van de opname die nu in de hero staat, zodat het
        // adres in de balk altijd terugleidt naar precies dit beeld.
        const shown = document.querySelector('.website-section.active .fs-thumb.active');
        if (shown && shown.dataset.date) {
          params.set('date', shown.dataset.date);
          if (shown.dataset.time) params.set('t', shown.dataset.time.slice(0, 5));
        }
      }
      if (isMobileMode) params.set('mobile', '1');
      const qs = params.toString();
      history.replaceState(null, '', qs ? '?' + qs : window.location.pathname);
    }

    // Bladeren door de tijdlijn verandert het adres mee, maar niet bij elke
    // pijltjestoets: wie doorklikt, schrijft pas als hij stilvalt.
    var urlTimer = null;
    function scheduleUrlUpdate() {
      if (urlTimer) clearTimeout(urlTimer);
      urlTimer = setTimeout(updateUrl, 250);
    }

    const urlParams = getUrlParams();

    // Bouw cluster-chips dynamisch uit metadata
    function getUniqueValues(key) {
      const vals = new Set();
      Object.values(meta).forEach(m => { if (m[key]) vals.add(m[key]); });
      return [...vals].sort();
    }

    const clusterSelect = document.getElementById('filter-cluster');
    getUniqueValues('cluster').forEach(val => {
      const option = document.createElement('option');
      option.value = val;
      option.textContent = val;
      clusterSelect.appendChild(option);
    });
    clusterSelect.addEventListener('change', () => {
      filterState.cluster = clusterSelect.value || null;
      applyClusterFilter();
      updateSiteSelect();
      // In de vergelijkweergave bepaalt het cluster welke titels je naast elkaar legt
      const openTab = document.querySelector('.tab.active');
      if (openTab && openTab.dataset.site === '__vergelijk__') cmpSetCluster();
      updateUrl();
    });

    // Website-select: dropdown om websites te kiezen (vervangt horizontale tabs)
    const siteSelect = document.getElementById('filter-site');

    function updateSiteSelect() {
      const tabs = document.querySelectorAll('.tab');
      const activeTab = document.querySelector('.tab.active');
      const activeSite = activeTab ? activeTab.dataset.site : '';

      // Verwijder oude opties
      siteSelect.innerHTML = '';

      // Voeg zichtbare websites toe als opties
      let hasActive = false;
      tabs.forEach(tab => {
        const isVirtual = isVirtualSite(tab.dataset.site);
        const cluster = tab.dataset.cluster;
        const visible = isVirtual || !filterState.cluster || cluster === filterState.cluster;
        if (!visible) return;

        const option = document.createElement('option');
        option.value = tab.dataset.site;
        option.textContent = isVirtual ? VIRTUAL_SITES[tab.dataset.site] : (meta[tab.dataset.site] ? meta[tab.dataset.site].label : tab.dataset.site);
        if (tab.dataset.site === activeSite) {
          option.selected = true;
          hasActive = true;
        }
        siteSelect.appendChild(option);
      });

      // Als de actieve tab niet zichtbaar is, selecteer de eerste optie
      if (!hasActive && siteSelect.options.length > 0) {
        siteSelect.options[0].selected = true;
      }
    }

    siteSelect.addEventListener('change', () => {
      const siteKey = siteSelect.value;
      const tab = document.querySelector('.tab[data-site="' + siteKey + '"]');
      if (tab) {
        activateTab(tab);
        updateUrl();
      }
    });

    // ---- Kalender -----------------------------------------------------------
    // Eén popover voor beide datumvelden: de tijdlijn en de vergelijkpagina.
    // De aanroeper geeft door welke dagen opnames hebben; de rest van de maand
    // blijft staan maar is niet klikbaar.
    var CAL_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni',
      'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
    var CAL_WEEKDAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

    var calState = { open: false, trigger: null, year: 0, month: 0, dates: {}, min: null, max: null,
      selected: null, onPick: null, onFoot: null };

    function calPad(n) { return (n < 10 ? '0' : '') + n; }
    function calKey(year, month, day) { return year + '-' + calPad(month + 1) + '-' + calPad(day); }
    function calMonthStart(key) { return key.slice(0, 8) + '01'; }

    function calRender() {
      var title = document.getElementById('cal-title');
      var grid = document.getElementById('cal-grid');
      if (!title || !grid) return;

      title.textContent = CAL_MONTHS[calState.month] + ' ' + calState.year;

      var html = '';
      for (var w = 0; w < 7; w++) html += '<span class="cal-weekday">' + CAL_WEEKDAYS[w] + '</span>';

      // Maandag als eerste kolom (getDay geeft zondag = 0)
      var offset = (new Date(calState.year, calState.month, 1).getDay() + 6) % 7;
      for (var b = 0; b < offset; b++) html += '<span class="cal-blank"></span>';

      var now = new Date();
      var todayKey = calKey(now.getFullYear(), now.getMonth(), now.getDate());
      var days = new Date(calState.year, calState.month + 1, 0).getDate();
      for (var d = 1; d <= days; d++) {
        var key = calKey(calState.year, calState.month, d);
        var has = calState.dates[key];
        var cls = 'cal-day' + (has ? '' : ' off') +
          (key === calState.selected ? ' active' : '') +
          (key === todayKey ? ' today' : '');
        html += '<button type="button" class="' + cls + '" data-date="' + key + '"' +
          (has ? '' : ' disabled') + '>' + d + '</button>';
      }
      grid.innerHTML = html;

      var viewStart = calKey(calState.year, calState.month, 1);
      var prev = document.getElementById('cal-prev');
      var next = document.getElementById('cal-next');
      if (prev) prev.disabled = !calState.min || viewStart <= calMonthStart(calState.min);
      if (next) next.disabled = !calState.max || viewStart >= calMonthStart(calState.max);
    }

    function calShift(delta) {
      var month = calState.month + delta;
      calState.year += Math.floor(month / 12);
      calState.month = ((month % 12) + 12) % 12;
      calRender();
    }

    function calPlace() {
      var pop = document.getElementById('cal-pop');
      if (!pop || !calState.trigger) return;
      var rect = calState.trigger.getBoundingClientRect();
      var left = Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8);
      pop.style.left = Math.max(8, left) + 'px';
      // Onder de knop, tenzij daar geen plaats is
      var below = rect.bottom + 6;
      pop.style.top = (below + pop.offsetHeight > window.innerHeight
        ? Math.max(8, rect.top - pop.offsetHeight - 6)
        : below) + 'px';
    }

    function calOpen(trigger, options) {
      var pop = document.getElementById('cal-pop');
      if (!pop) return;

      var list = (options.dates || []).slice().sort();
      calState.dates = {};
      for (var i = 0; i < list.length; i++) calState.dates[list[i]] = true;
      calState.min = list[0] || null;
      calState.max = list[list.length - 1] || null;
      calState.selected = options.selected || null;
      calState.onPick = options.onPick || null;
      calState.onFoot = options.onFoot || null;
      calState.trigger = trigger;

      // Open op de gekozen dag, anders op de laatste dag met opnames
      var start = (calState.selected && calState.dates[calState.selected]) ? calState.selected : calState.max;
      if (start) {
        calState.year = parseInt(start.slice(0, 4), 10);
        calState.month = parseInt(start.slice(5, 7), 10) - 1;
      } else {
        var now = new Date();
        calState.year = now.getFullYear();
        calState.month = now.getMonth();
      }

      var foot = document.getElementById('cal-foot');
      if (foot) {
        foot.textContent = options.footLabel || '';
        foot.hidden = !options.footLabel;
      }

      calRender();
      pop.hidden = false;
      calState.open = true;
      trigger.setAttribute('aria-expanded', 'true');
      calPlace();
    }

    function calClose() {
      var pop = document.getElementById('cal-pop');
      if (pop) pop.hidden = true;
      if (calState.trigger) calState.trigger.setAttribute('aria-expanded', 'false');
      calState.open = false;
      calState.trigger = null;
    }

    // Een tweede klik op dezelfde knop sluit de kalender weer
    function calToggle(trigger, options) {
      if (calState.open && calState.trigger === trigger) { calClose(); return; }
      calOpen(trigger, options);
    }

    (function bindCalendar() {
      var pop = document.getElementById('cal-pop');
      if (!pop) return;

      document.getElementById('cal-prev').addEventListener('click', function() { calShift(-1); });
      document.getElementById('cal-next').addEventListener('click', function() { calShift(1); });

      document.getElementById('cal-grid').addEventListener('click', function(e) {
        var day = e.target.closest('.cal-day[data-date]');
        if (!day || day.disabled) return;
        var pick = calState.onPick;
        var date = day.dataset.date;
        calClose();
        if (pick) pick(date);
      });

      document.getElementById('cal-foot').addEventListener('click', function() {
        var run = calState.onFoot;
        calClose();
        if (run) run();
      });

      // Klik buiten de kalender (en buiten de knop die hem opende) sluit hem
      document.addEventListener('click', function(e) {
        if (!calState.open) return;
        if (pop.contains(e.target)) return;
        if (calState.trigger && calState.trigger.contains(e.target)) return;
        calClose();
      });

      // Meebewegen in plaats van dichtklappen: de tijdlijn en de kolommen
      // scrollen zelf ook, en daar hoeft de kalender niet van te verdwijnen.
      window.addEventListener('resize', function() { if (calState.open) calPlace(); });
      window.addEventListener('scroll', function() { if (calState.open) calPlace(); }, true);
    })();

    // Datumknop van de tijdlijn: de kalender toont de dagen van de actieve site
    function jumpToNewest() {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection || isVirtualSite(activeSection.dataset.site)) return;
      const thumbs = [...activeSection.querySelectorAll('.fs-thumb')];
      const lastThumb = thumbs[thumbs.length - 1];
      if (!lastThumb) return;
      activateThumb(lastThumb);
      const filmstrip = activeSection.querySelector('.filmstrip');
      if (filmstrip) filmstrip.scrollTo({ left: filmstrip.scrollWidth, behavior: 'smooth' });
    }

    function activeSiteDates() {
      const section = document.querySelector('.website-section.active');
      const site = section ? section.dataset.site : null;
      const data = getActiveData();
      if (site && data[site]) return Object.keys(data[site]);
      return allDates;
    }

    // De knop toont welke dag je bekijkt; zonder keuze de uitnodiging
    function refreshDateTrigger() {
      const trigger = document.getElementById('filter-date');
      if (!trigger) return;
      const section = document.querySelector('.website-section.active');
      const thumb = section ? section.querySelector('.fs-thumb.active') : null;
      trigger.textContent = thumb && thumb.dataset.date ? thumb.dataset.date : 'Kies datum';
    }

    (function bindDateTrigger() {
      const trigger = document.getElementById('filter-date');
      if (!trigger) return;
      trigger.addEventListener('click', () => {
        const section = document.querySelector('.website-section.active');
        const thumb = section ? section.querySelector('.fs-thumb.active') : null;
        calToggle(trigger, {
          dates: activeSiteDates(),
          selected: thumb ? thumb.dataset.date : null,
          footLabel: 'Nieuwste opname',
          onFoot: jumpToNewest,
          onPick: (date) => { scrollFilmstripToDate(date); refreshDateTrigger(); },
        });
      });
    })();

    function scrollFilmstripToDate(date) {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection) return;
      const filmstrip = activeSection.querySelector('.filmstrip');
      const dateGroup = activeSection.querySelector('.fs-date-group[data-date="' + date + '"]');
      if (filmstrip && dateGroup) {
        filmstrip.scrollTo({ left: dateGroup.offsetLeft - filmstrip.offsetLeft, behavior: 'smooth' });
        // Activeer de eerste thumb van die datum
        const firstThumb = dateGroup.querySelector('.fs-thumb');
        if (firstThumb) activateThumb(firstThumb);
      }
    }

    // Deeplink naar één opname: de opname van die dag die het dichtst bij het
    // gevraagde tijdstip ligt. Zonder datum die van de nieuwste dag.
    function jumpToMoment(date, minutes) {
      const section = document.querySelector('.website-section.active');
      if (!section) return false;
      const thumbs = [...section.querySelectorAll('.fs-thumb')];
      if (!thumbs.length) return false;
      const day = date || thumbs[thumbs.length - 1].dataset.date;
      const pool = thumbs.filter(function(t) { return t.dataset.date === day; });
      if (!pool.length) return false;

      let target = pool[0], best = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const mins = parseClock(pool[i].dataset.time);
        if (mins === null) continue;
        const delta = Math.abs(mins - minutes);
        if (delta < best) { best = delta; target = pool[i]; }
      }
      activateThumb(target);
      scrollFilmstripToThumb(target);
      return true;
    }

    function applyClusterFilter() {
      const tabs = document.querySelectorAll('.tab');
      let firstVisible = null;
      let activeIsVisible = false;

      tabs.forEach(tab => {
        const cluster = tab.dataset.cluster;
        const isVirtual = isVirtualSite(tab.dataset.site);
        const visible = isVirtual || !filterState.cluster || cluster === filterState.cluster;
        tab.classList.toggle('hidden', !visible);
        if (visible && !isVirtual && !firstVisible) firstVisible = tab;
        if (visible && tab.classList.contains('active')) activeIsVisible = true;
      });

      if (!activeIsVisible && firstVisible) {
        activateTab(firstVisible);
      }
    }

    // Bestandsnaam terugbouwen uit een gecomprimeerd item: [*][!]HH-MM-SS
    // '*' = miniatuur beschikbaar, '!' = letterlijke bestandsnaam (afwijkend patroon)
    function decodeEntry(entry, siteKey, date, forceMobile) {
      var mobile = forceMobile === undefined ? isMobileMode : forceMobile;
      var hasThumb = entry.charAt(0) === '*';
      var rest = hasThumb ? entry.slice(1) : entry;
      var filename = rest.charAt(0) === '!'
        ? rest.slice(1)
        : siteKey + '_' + date + 'T' + rest + (mobile ? '_mobile' : '') + '.webp';
      return { filename: filename, hasThumb: hasThumb };
    }

    var THUMB_SUFFIX = '${THUMB_SUFFIX}';

    // Oudere screenshots hebben nog geen miniatuur: die 100-300 KB grote beelden
    // worden hoogstens met twee tegelijk geladen, zodat ze de zichtbare hero en
    // de lichte miniaturen niet verdringen.
    var HEAVY_CONCURRENCY = 2;
    var heavyQueue = [];
    var heavyActive = 0;

    function pumpHeavyQueue() {
      while (heavyActive < HEAVY_CONCURRENCY && heavyQueue.length > 0) {
        var img = heavyQueue.shift();
        if (!img.isConnected || img.getAttribute('src')) continue;
        heavyActive++;
        var done = function() { heavyActive--; pumpHeavyQueue(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        img.src = img.dataset.src;
      }
    }

    function loadThumbImage(img) {
      if (!img.dataset.src || img.getAttribute('src')) return;
      if (img.dataset.heavy === '1') {
        heavyQueue.push(img);
        pumpHeavyQueue();
      } else {
        img.src = img.dataset.src;
      }
    }

    // Lazy loading via IntersectionObserver (horizontaal scrollen in filmstrip)
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          loadThumbImage(entry.target);
          imageObserver.unobserve(entry.target);
        }
      });
    }, { rootMargin: '600px' });

    // Observeer alleen de eerste (actieve) sectie bij het laden
    // Andere secties worden geobserveerd wanneer ze gerenderd worden
    (function() {
      var first = document.querySelector('.website-section.active');
      if (first) first.querySelectorAll('.fs-thumb img[data-src]').forEach(function(img) { imageObserver.observe(img); });
    })();

    // Lazy rendering: bouw filmstrip HTML vanuit JSON data bij eerste tab-activatie
    function renderFilmstrip(siteKey, forceRerender) {
      var section = document.querySelector('.website-section[data-site="' + siteKey + '"]');
      if (!section) return;

      // Track welke modus gerenderd is zodat we weten wanneer herrendering nodig is
      var renderedMode = section.dataset.renderedMode;
      var currentMode = isMobileMode ? 'mobile' : 'desktop';
      if (section.dataset.rendered === 'true' && renderedMode === currentMode && !forceRerender) return;

      var data = getActiveData();
      var dates = data[siteKey];
      if (!dates) {
        // Geen data voor deze modus — toon melding
        var filmstrip = section.querySelector('.filmstrip');
        if (filmstrip) filmstrip.innerHTML = '<div style="padding:1rem;color:#9a8aaa;font-size:0.8rem;">Geen ' + (isMobileMode ? 'mobiele' : 'desktop') + ' screenshots beschikbaar.</div>';
        section.dataset.rendered = 'true';
        section.dataset.renderedMode = currentMode;
        return;
      }

      var filmstrip = section.querySelector('.filmstrip');
      if (!filmstrip) return;

      var html = '';
      var dateKeys = Object.keys(dates);
      for (var d = 0; d < dateKeys.length; d++) {
        var date = dateKeys[d];
        var entries = dates[date];
        html += '<div class="fs-date-group" data-date="' + date + '">';
        html += '<div class="fs-date-sep">' + date + '</div>';
        html += '<div class="fs-thumbs">';
        for (var f = 0; f < entries.length; f++) {
          var decoded = decodeEntry(entries[f], siteKey, date);
          var filename = decoded.filename;
          var tIdx = filename.indexOf('T');
          var timePart = tIdx > -1 ? filename.slice(tIdx + 1, tIdx + 9) : '';
          var timeStr = timePart.length === 8 ? timePart.replace(/-/g, ':') : '';
          var url = screenshotBaseUrl + '/' + siteKey + '/' + date + '/' + filename;
          // Miniatuur waar beschikbaar; anders het volledige beeld (getemperd geladen)
          var thumbSrc = decoded.hasThumb ? url.replace(/\.webp$/, THUMB_SUFFIX) : url;
          html += '<div class="fs-thumb" data-url="' + url + '" data-date="' + date + '" data-time="' + timeStr + '">';
          html += '<img data-src="' + thumbSrc + '"' + (decoded.hasThumb ? '' : ' data-heavy="1"') +
            ' decoding="async" fetchpriority="low" alt="' + timeStr + '">';
          html += '<span class="fs-time">' + timeStr + '</span>';
          html += '</div>';
        }
        html += '</div></div>';
      }

      // Wachtrij van de vorige site is niet meer relevant
      heavyQueue.length = 0;
      filmstrip.innerHTML = html;
      section.dataset.rendered = 'true';
      section.dataset.renderedMode = currentMode;

      // Observeer nieuwe afbeeldingen voor lazy loading
      filmstrip.querySelectorAll('.fs-thumb img[data-src]').forEach(function(img) { imageObserver.observe(img); });
    }

    // Hero: activeer een filmstrip-thumbnail en update de grote weergave
    function activateThumb(thumb) {
      const section = thumb.closest('.website-section');
      if (!section) return;

      section.querySelectorAll('.fs-thumb').forEach(t => t.classList.remove('active'));
      thumb.classList.add('active');

      const url = thumb.dataset.url;
      const date = thumb.dataset.date;
      const time = thumb.dataset.time;
      const siteKey = section.dataset.site;

      const heroImg = document.getElementById('hero-img-' + siteKey);
      const heroDate = document.getElementById('hero-date-' + siteKey);
      const heroTime = document.getElementById('hero-time-' + siteKey);
      const heroPlaceholder = document.getElementById('hero-placeholder-' + siteKey);
      const heroSep = section.querySelector('.hero-sep');

      const heroStage = document.getElementById('hero-stage-' + siteKey);
      if (heroStage) heroStage.scrollTop = 0;

      if (heroImg) {
        heroImg.classList.add('loading');
        heroImg.setAttribute('fetchpriority', 'high');
        heroImg.onload = () => heroImg.classList.remove('loading');
        heroImg.onerror = () => heroImg.classList.remove('loading');
        heroImg.src = url;
      }
      if (heroPlaceholder) heroPlaceholder.style.display = 'none';
      if (heroDate) heroDate.textContent = date;
      if (heroTime) heroTime.textContent = time;
      if (heroSep) heroSep.textContent = time ? '·' : '';

      // Laad ook de miniatuur als die nog niet geladen is
      const thumbImg = thumb.querySelector('img');
      if (thumbImg && thumbImg.dataset.src && !thumbImg.getAttribute('src')) {
        loadThumbImage(thumbImg);
        imageObserver.unobserve(thumbImg);
      }

      // Peek-pijlen meteen bijwerken; de zware buurbeelden pas nadat de hero
      // binnen is, zodat die niet om bandbreedte moeten concurreren.
      updatePeeks(section, false);
      schedulePeeks(section);
      refreshDateTrigger();
      scheduleUrlUpdate();
    }

    // Laad de peek-/preload-beelden pas na de hero (of na een korte time-out
    // wanneer die uit cache komt of faalt).
    let peekTimer = null;
    function schedulePeeks(section) {
      if (peekTimer) clearTimeout(peekTimer);
      const heroImg = document.getElementById('hero-img-' + section.dataset.site);
      const run = () => { peekTimer = setTimeout(() => updatePeeks(section, true), 120); };
      if (heroImg && heroImg.getAttribute('src') && !heroImg.complete) {
        heroImg.addEventListener('load', run, { once: true });
        heroImg.addEventListener('error', run, { once: true });
      } else {
        run();
      }
    }

    function updatePeeks(section, withImages) {
      // Na snel wisselen van site kan een uitgestelde oproep nog binnenkomen voor
      // een sectie die niet meer zichtbaar is — die beelden hoeven niet geladen.
      if (withImages && !section.classList.contains('active')) return;

      const siteKey = section.dataset.site;
      const thumbs = [...section.querySelectorAll('.fs-thumb')];
      const activeThumb = section.querySelector('.fs-thumb.active');
      const idx = activeThumb ? thumbs.indexOf(activeThumb) : -1;

      const peekLeft = document.getElementById('peek-left-' + siteKey);
      const peekRight = document.getElementById('peek-right-' + siteKey);

      const setPeek = (peek, neighbour) => {
        if (!peek) return;
        if (!neighbour) {
          peek.classList.add('hidden');
          return;
        }
        peek.classList.remove('hidden');
        const img = peek.querySelector('img');
        if (!img) return;
        if (withImages) img.src = neighbour.dataset.url;
        else if (img.getAttribute('src') !== neighbour.dataset.url) img.removeAttribute('src');
      };

      setPeek(peekLeft, idx > 0 ? thumbs[idx - 1] : null);
      setPeek(peekRight, idx >= 0 && idx < thumbs.length - 1 ? thumbs[idx + 1] : null);

      if (!withImages) return;

      // Preload nog een stap verder voor sneller swipen — enkel wanneer de
      // browser toch niets beters te doen heeft.
      const preloadFurther = () => {
        if (idx > 1) { var p = new Image(); p.src = thumbs[idx - 2].dataset.url; }
        if (idx < thumbs.length - 2) { var p2 = new Image(); p2.src = thumbs[idx + 2].dataset.url; }
      };
      if (window.requestIdleCallback) requestIdleCallback(preloadFurther, { timeout: 2000 });
      else setTimeout(preloadFurther, 400);
    }

    function initSectionHero(section, instant) {
      const thumbs = [...section.querySelectorAll('.fs-thumb')];
      const lastThumb = thumbs[thumbs.length - 1];
      if (lastThumb && !section.querySelector('.fs-thumb.active')) {
        activateThumb(lastThumb);
      }
      // Scroll filmstrip naar het einde (nieuwste rechts)
      const filmstrip = section.querySelector('.filmstrip');
      if (filmstrip) {
        if (instant) {
          filmstrip.style.scrollBehavior = 'auto';
          filmstrip.scrollLeft = filmstrip.scrollWidth;
          filmstrip.style.scrollBehavior = '';
        } else {
          filmstrip.scrollLeft = filmstrip.scrollWidth;
        }
      }
    }

    // Filmstrip thumbnail klikken (event delegation: werkt ook voor lazy-gerenderde thumbs)
    document.querySelectorAll('.filmstrip').forEach(filmstrip => {
      filmstrip.addEventListener('click', (e) => {
        const thumb = e.target.closest('.fs-thumb');
        if (thumb) activateThumb(thumb);
      });
    });

    // Tabs
    function activateTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.website-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const section = document.querySelector('.website-section[data-site="' + tab.dataset.site + '"]');
      if (section) {
        section.classList.add('active');
        // Toolbar always visible since navigation is via dropdown
        if (!isVirtualSite(tab.dataset.site)) {
          renderFilmstrip(tab.dataset.site);
          initSectionHero(section);
        } else if (tab.dataset.site === '__vergelijk__') {
          cmpRefresh(false);
        }
      }
      // Datum- en mobielknop zijn niet van toepassing op de vergelijkweergave
      const isCompare = tab.dataset.site === '__vergelijk__';
      const toolbar = document.getElementById('toolbar');
      if (toolbar) toolbar.classList.toggle('cmp-mode', isCompare);
      document.body.classList.toggle('cmp-open', isCompare);
      refreshDateTrigger();
      if (!isVirtualSite(tab.dataset.site)) lastSiteTab = tab;
      refreshViewToggle();
      // Sync de website dropdown
      if (siteSelect) siteSelect.value = tab.dataset.site;
    }

    // Knop in de werkbalk: heen naar de vergelijkpagina, terug naar de tijdlijn
    var lastSiteTab = null;

    function refreshViewToggle() {
      var btn = document.getElementById('view-toggle');
      if (!btn) return;
      var active = document.querySelector('.tab.active');
      var onCompare = !!active && active.dataset.site === '__vergelijk__';
      btn.textContent = onCompare ? 'Terug naar tijdlijn' : 'Vergelijk titels';
      btn.classList.toggle('active', onCompare);
    }

    (function bindViewToggle() {
      var btn = document.getElementById('view-toggle');
      if (!btn) return;
      btn.addEventListener('click', function() {
        var active = document.querySelector('.tab.active');
        var target;
        if (active && active.dataset.site === '__vergelijk__') {
          target = (lastSiteTab && !lastSiteTab.classList.contains('hidden'))
            ? lastSiteTab
            : document.querySelector('.tab:not(.hidden):not(.tab-vergelijk):not(.tab-schema)');
          if (!target) {
            // Geen enkele site zichtbaar binnen dit cluster (je kwam hier via een
            // directe link): dan maar het clusterfilter opheffen
            clusterSelect.value = '';
            filterState.cluster = null;
            applyClusterFilter();
            updateSiteSelect();
            target = document.querySelector('.tab:not(.hidden):not(.tab-vergelijk):not(.tab-schema)');
          }
        } else {
          target = document.querySelector('.tab[data-site="__vergelijk__"]');
        }
        if (target) { activateTab(target); updateUrl(); }
      });
    })();

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => { activateTab(tab); updateUrl(); });
    });

    // Initialiseer de hero van de eerste sectie (instant scroll naar nieuwste)
    (function() {
      const firstSection = document.querySelector('.website-section.active');
      if (firstSection) initSectionHero(firstSection, true);
    })();

    // ---- Vergelijk titels ---------------------------------------------------
    // Meerdere merken naast elkaar op hetzelfde moment. Bewust enkel mobiele
    // opnames: die zijn smal genoeg om er vijf of zes naast elkaar te leggen.
    // Sites draaien niet synchroon, dus exact gelijke tijdstippen bestaan amper.
    // Een "moment" is daarom een groepje opnames dat hoogstens cmpState.tol
    // minuten uit elkaar ligt (standaard 15).
    var CMP_MAX_SITES = 8;
    var CMP_DEFAULT_SITES = 5;
    var CMP_DRIFT_MIN = 5;

    var cmpState = { sites: [], date: null, tol: 15, index: 0, moments: [], sync: true };

    // Alle sites met mobiele opnames, gesorteerd op label, eventueel binnen cluster
    function cmpSitesWithMobile(cluster) {
      return Object.keys(mobileScreenshotData).filter(function(site) {
        if (!meta[site]) return false;
        return !cluster || meta[site].cluster === cluster;
      }).sort(function(a, b) {
        return (meta[a].label || a).localeCompare(meta[b].label || b);
      });
    }

    function cmpAvailableDates(sites) {
      var set = {};
      for (var i = 0; i < sites.length; i++) {
        var dates = mobileScreenshotData[sites[i]];
        if (!dates) continue;
        for (var date in dates) set[date] = true;
      }
      return Object.keys(set).sort();
    }

    // Tijdstip uit een gecomprimeerd item halen: HH-MM-SS -> minuten sinds middernacht
    function cmpEntryTime(entry, site, date) {
      var filename = decodeEntry(entry, site, date, true).filename;
      var tIdx = filename.indexOf('T');
      var part = tIdx > -1 ? filename.slice(tIdx + 1, tIdx + 9) : '';
      if (part.length !== 8) return null;
      var bits = part.split('-');
      var hh = parseInt(bits[0], 10), mm = parseInt(bits[1], 10), ss = parseInt(bits[2], 10);
      if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return null;
      return { site: site, filename: filename, time: bits[0] + ':' + bits[1], minutes: hh * 60 + mm + ss / 60 };
    }

    // Groepeer de opnames van de gekozen titels in momenten: vensters waarin alle
    // opnames hoogstens tol minuten van elkaar liggen. Per titel telt de eerste
    // opname in het venster; vensters die volledig in een ander venster passen,
    // voegen niets toe en vallen weg.
    function cmpBuildMoments() {
      var sites = cmpState.sites, date = cmpState.date, tol = cmpState.tol;
      if (!date || sites.length < 2) return [];

      var all = [];
      for (var i = 0; i < sites.length; i++) {
        var dates = mobileScreenshotData[sites[i]];
        var entries = dates && dates[date];
        if (!entries) continue;
        for (var j = 0; j < entries.length; j++) {
          var shot = cmpEntryTime(entries[j], sites[i], date);
          if (shot) all.push(shot);
        }
      }
      all.sort(function(a, b) { return a.minutes - b.minutes; });

      var windows = [], seen = {};
      for (var s = 0; s < all.length; s++) {
        var picked = [], taken = {};
        for (var e = s; e < all.length && all[e].minutes - all[s].minutes <= tol; e++) {
          if (taken[all[e].site]) continue;
          taken[all[e].site] = true;
          picked.push(all[e]);
        }
        if (picked.length < 2) continue;
        var sig = picked.map(function(p) { return p.site + '@' + p.time; }).join('|');
        if (seen[sig]) continue;
        seen[sig] = true;
        windows.push({ shots: picked, start: picked[0].minutes, end: picked[picked.length - 1].minutes, keys: sig.split('|') });
      }

      var sets = windows.map(function(w) {
        var set = {};
        for (var k = 0; k < w.keys.length; k++) set[w.keys[k]] = true;
        return set;
      });

      var result = [];
      for (var w = 0; w < windows.length; w++) {
        var covered = false;
        for (var o = 0; o < windows.length && !covered; o++) {
          if (o === w || windows[o].shots.length <= windows[w].shots.length) continue;
          covered = windows[w].keys.every(function(key) { return sets[o][key]; });
        }
        if (!covered) result.push(windows[w]);
      }
      return result;
    }

    function cmpRenderChips() {
      var wrap = document.getElementById('cmp-chips');
      if (!wrap) return;
      var html = '';
      for (var i = 0; i < cmpState.sites.length; i++) {
        var site = cmpState.sites[i];
        var label = meta[site] ? meta[site].label : site;
        html += '<span class="cmp-chip">' + label +
          '<button type="button" data-remove="' + site + '" title="Verwijder uit de vergelijking">&times;</button></span>';
      }

      var remaining = cmpSitesWithMobile(null).filter(function(site) { return cmpState.sites.indexOf(site) === -1; });
      var full = cmpState.sites.length >= CMP_MAX_SITES;
      html += '<select class="cmp-add" id="cmp-add"' + (full || !remaining.length ? ' disabled' : '') + '>';
      html += '<option value="">+ titel</option>';
      var clusters = {};
      for (var r = 0; r < remaining.length; r++) {
        var cluster = meta[remaining[r]].cluster || 'Overig';
        if (!clusters[cluster]) clusters[cluster] = [];
        clusters[cluster].push(remaining[r]);
      }
      var clusterNames = Object.keys(clusters).sort();
      for (var c = 0; c < clusterNames.length; c++) {
        html += '<optgroup label="' + clusterNames[c] + '">';
        var sites = clusters[clusterNames[c]];
        for (var t = 0; t < sites.length; t++) {
          html += '<option value="' + sites[t] + '">' + (meta[sites[t]].label || sites[t]) + '</option>';
        }
        html += '</optgroup>';
      }
      html += '</select>';

      if (full) html += '<span class="cmp-hint">maximum ' + CMP_MAX_SITES + ' titels</span>';
      else if (cmpState.sites.length < 2) html += '<span class="cmp-hint">kies minstens twee titels</span>';

      wrap.innerHTML = html;

      var add = document.getElementById('cmp-add');
      if (add) add.addEventListener('change', function() {
        if (!this.value || cmpState.sites.indexOf(this.value) > -1) return;
        cmpState.sites.push(this.value);
        cmpRefresh(false);
        updateUrl();
      });

      wrap.querySelectorAll('button[data-remove]').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var site = btn.dataset.remove;
          cmpState.sites = cmpState.sites.filter(function(s) { return s !== site; });
          cmpRefresh(false);
          updateUrl();
        });
      });
    }

    function cmpRenderGrid() {
      var grid = document.getElementById('cmp-grid');
      if (!grid) return;

      if (cmpState.sites.length < 2) {
        grid.style.display = 'block';
        grid.innerHTML = '<div class="cmp-empty">Kies minstens twee titels om naast elkaar te leggen.</div>';
        return;
      }

      var moment = cmpState.moments[cmpState.index];
      if (!moment) {
        grid.style.display = 'block';
        grid.innerHTML = '<div class="cmp-empty">Geen vergelijkbare momenten op ' + (cmpState.date || 'deze dag') + '.' +
          '<br>Probeer een andere dag, een ruimere marge of andere titels.</div>';
        return;
      }

      grid.style.display = '';
      var byShot = {};
      for (var i = 0; i < moment.shots.length; i++) byShot[moment.shots[i].site] = moment.shots[i];
      var midpoint = (moment.start + moment.end) / 2;

      var html = '';
      for (var s = 0; s < cmpState.sites.length; s++) {
        var site = cmpState.sites[s];
        var label = meta[site] ? meta[site].label : site;
        var shot = byShot[site];
        html += '<div class="cmp-col">';
        html += '<div class="cmp-col-head"><span class="cmp-col-label">' + label + '</span>';
        if (shot) {
          var drift = Math.abs(shot.minutes - midpoint) > CMP_DRIFT_MIN ? ' drift' : '';
          var url = screenshotBaseUrl + '/' + site + '/' + cmpState.date + '/' + shot.filename;
          html += '<span class="cmp-col-time' + drift + '">' + shot.time + '</span></div>';
          html += '<div class="cmp-shot" data-url="' + url + '" data-time="' + shot.time + '">';
          html += '<img src="' + url + '" decoding="async" alt="' + label + ' ' + shot.time + '">';
          html += '</div>';
        } else {
          html += '<span class="cmp-col-time missing">geen opname</span></div>';
          html += '<div class="cmp-missing">Geen opname binnen ' + cmpState.tol + ' min van dit moment</div>';
        }
        html += '</div>';
      }
      // Scrolldiepte vasthouden bij het wisselen van moment: je wil dezelfde
      // hoogte van de pagina blijven vergelijken, niet telkens opnieuw bovenaan.
      var keep = 0;
      var open = grid.querySelector('.cmp-shot');
      if (open) keep = open.scrollTop;

      grid.innerHTML = html;

      if (keep > 0) {
        grid.querySelectorAll('.cmp-shot').forEach(function(shot) {
          shot.scrollTop = keep;
          var img = shot.querySelector('img');
          // Pas als het beeld binnen is, is de kolom hoog genoeg om ver te scrollen
          if (img && !img.complete) img.addEventListener('load', function() { shot.scrollTop = keep; }, { once: true });
        });
      }

      cmpBindScrollSync();
      cmpPreloadNeighbour();
    }

    // Kolommen samen laten scrollen: zo vergelijk je dezelfde diepte van de pagina
    var cmpScrollLock = false;
    function cmpBindScrollSync() {
      var shots = [].slice.call(document.querySelectorAll('#cmp-grid .cmp-shot'));
      shots.forEach(function(shot) {
        shot.addEventListener('scroll', function() {
          if (!cmpState.sync || cmpScrollLock) return;
          cmpScrollLock = true;
          var top = shot.scrollTop;
          for (var i = 0; i < shots.length; i++) {
            if (shots[i] !== shot && Math.abs(shots[i].scrollTop - top) > 1) shots[i].scrollTop = top;
          }
          requestAnimationFrame(function() { cmpScrollLock = false; });
        }, { passive: true });
      });
    }

    // Het volgende moment vast ophalen, maar enkel als de browser niets beters doet
    function cmpPreloadNeighbour() {
      var next = cmpState.moments[cmpState.index + 1];
      if (!next) return;
      var run = function() {
        for (var i = 0; i < next.shots.length; i++) {
          var shot = next.shots[i];
          var img = new Image();
          img.src = screenshotBaseUrl + '/' + shot.site + '/' + cmpState.date + '/' + shot.filename;
        }
      };
      if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 3000 });
      else setTimeout(run, 600);
    }

    function cmpRenderMoment() {
      var timeEl = document.getElementById('cmp-moment-time');
      var metaEl = document.getElementById('cmp-moment-meta');
      var slider = document.getElementById('cmp-slider');
      var prev = document.getElementById('cmp-prev');
      var next = document.getElementById('cmp-next');
      var total = cmpState.moments.length;
      var moment = cmpState.moments[cmpState.index];

      if (timeEl) {
        if (!moment) timeEl.textContent = '--:--';
        else {
          var from = moment.shots[0].time;
          var to = moment.shots[moment.shots.length - 1].time;
          timeEl.textContent = from === to ? from : from + '-' + to;
        }
      }
      if (metaEl) {
        if (!moment) metaEl.textContent = '';
        else {
          var spread = Math.round(moment.end - moment.start);
          metaEl.textContent = moment.shots.length + '/' + cmpState.sites.length + ' titels · spreiding ' +
            spread + ' min · moment ' + (cmpState.index + 1) + '/' + total;
        }
      }
      if (slider) {
        slider.max = String(Math.max(0, total - 1));
        slider.value = String(cmpState.index);
        slider.disabled = total < 2;
      }
      if (prev) prev.disabled = cmpState.index <= 0;
      if (next) next.disabled = cmpState.index >= total - 1;
    }

    function cmpRenderDate() {
      var trigger = document.getElementById('cmp-date');
      if (trigger) trigger.textContent = cmpState.date || 'Kies datum';
    }

    function cmpDates() {
      return cmpAvailableDates(cmpState.sites.length ? cmpState.sites : cmpSitesWithMobile(null));
    }

    function cmpSetDate(date) {
      if (!date || date === cmpState.date) return;
      cmpState.date = date;
      cmpRefresh(true);
      updateUrl();
    }

    // Herbouw de momenten en teken alles opnieuw. resetIndex: spring naar het
    // laatste (nieuwste) moment, anders de dichtstbijzijnde bij het huidige.
    function cmpRefresh(resetIndex) {
      var previous = cmpState.moments[cmpState.index];
      cmpState.moments = cmpBuildMoments();

      if (!cmpState.moments.length) cmpState.index = 0;
      else if (resetIndex || !previous) {
        // Het nieuwste moment waarop zoveel mogelijk titels samen in beeld komen:
        // de laatste opnames van een dag vallen zelden nog samen.
        var fullest = 0, cover = 0;
        for (var f = 0; f < cmpState.moments.length; f++) {
          if (cmpState.moments[f].shots.length >= cover) { cover = cmpState.moments[f].shots.length; fullest = f; }
        }
        cmpState.index = fullest;
      } else {
        // Zoek het moment dat het dichtst bij het vorige tijdstip ligt
        var best = 0, bestDelta = Infinity;
        for (var i = 0; i < cmpState.moments.length; i++) {
          var delta = Math.abs(cmpState.moments[i].start - previous.start);
          if (delta < bestDelta) { bestDelta = delta; best = i; }
        }
        cmpState.index = best;
      }

      cmpRenderDate();
      cmpRenderChips();
      cmpRenderMoment();
      cmpRenderGrid();
    }

    function cmpGoto(index) {
      if (index < 0 || index >= cmpState.moments.length || index === cmpState.index) return;
      cmpState.index = index;
      cmpRenderMoment();
      cmpRenderGrid();
      scheduleUrlUpdate();
    }

    // Het moment dat het dichtst bij een tijdstip uit de link ligt. Een moment
    // is een venster, dus binnen dat venster is de afstand nul en erbuiten telt
    // die tot de dichtstbijzijnde rand.
    function cmpGotoTime(minutes) {
      if (minutes === null || !cmpState.moments.length) return;
      var best = 0, bestDelta = Infinity;
      for (var i = 0; i < cmpState.moments.length; i++) {
        var m = cmpState.moments[i];
        var delta = minutes < m.start ? m.start - minutes : (minutes > m.end ? minutes - m.end : 0);
        if (delta < bestDelta) { bestDelta = delta; best = i; }
      }
      cmpGoto(best);
    }

    // Pijltjestoetsen in de vergelijkweergave: vorig/volgend moment
    function cmpHandleKey(e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); cmpGoto(cmpState.index - 1); return true; }
      if (e.key === 'ArrowRight') { e.preventDefault(); cmpGoto(cmpState.index + 1); return true; }
      return false;
    }

    // De eerste titels van het actieve cluster met mobiele opnames
    function cmpClusterSites() {
      var sites = cmpSitesWithMobile(filterState.cluster);
      if (sites.length < 2) sites = cmpSitesWithMobile(null);
      return sites.slice(0, CMP_DEFAULT_SITES);
    }

    // Standaardselectie bij openen: de vaste vier, over de clusters heen.
    // Zijn die er niet (nog geen mobiele opnames), dan toch maar het cluster.
    function cmpDefaultSites() {
      var preset = DEFAULT_COMPARE.filter(function(site) {
        return mobileScreenshotData[site] && meta[site];
      });
      return preset.length >= 2 ? preset.slice(0, CMP_MAX_SITES) : cmpClusterSites();
    }

    // De vergelijking rond één titel: die titel staat er altijd in en vooraan,
    // de rest komt uit haar cluster. Zo opent een link vanuit de Nieuwsmonitor
    // op de eigen titel van de chef, naast de titels waar hij zich mee meet.
    // 'plus' zijn titels die er hoe dan ook bij horen — het merk waarvan hij de
    // regel aanklikte, dat in een ander cluster kan zitten dan het zijne.
    // Staat een titel alleen in haar cluster (NU.nl, RTL), dan vullen de vaste
    // vier aan: met één kolom valt er niets te vergelijken.
    function cmpSitesAround(site, plus) {
      if (!site || !meta[site] || !mobileScreenshotData[site]) return null;
      var sites = [site];
      function voegToe(kandidaten) {
        for (var i = 0; i < kandidaten.length && sites.length < CMP_DEFAULT_SITES; i++) {
          var s = kandidaten[i];
          if (meta[s] && mobileScreenshotData[s] && sites.indexOf(s) === -1) sites.push(s);
        }
      }
      voegToe((plus || []).filter(Boolean));
      voegToe(cmpSitesWithMobile(meta[site].cluster));
      if (sites.length < 2) voegToe(DEFAULT_COMPARE);
      return sites;
    }

    function cmpSetCluster() {
      cmpState.sites = cmpClusterSites();
      var dates = cmpAvailableDates(cmpState.sites);
      if (!cmpState.date || dates.indexOf(cmpState.date) === -1) cmpState.date = dates[dates.length - 1] || null;
      cmpRefresh(true);
    }

    function cmpInit() {
      // Selectie en datum uit de URL, anders het actieve cluster van vandaag
      var fromUrl = (urlParams.cmp || '').split(',').filter(function(site) {
        return site && mobileScreenshotData[site] && meta[site];
      });
      // Zonder cmp maar mét een titel: de vergelijking wordt rond die titel
      // gebouwd. Dat is wat een link uit de Nieuwsmonitor meegeeft — alleen de
      // titel van de chef, niet de hele selectie, want welke titels bij elkaar
      // horen staat hier (in websites.json) en niet daar.
      var around = cmpSitesAround(urlParams.site, (urlParams.plus || '').split(','));
      cmpState.sites = fromUrl.length ? fromUrl.slice(0, CMP_MAX_SITES) : (around || cmpDefaultSites());

      var dates = cmpAvailableDates(cmpState.sites);
      cmpState.date = (urlParams.date && dates.indexOf(urlParams.date) > -1)
        ? urlParams.date
        : (dates[dates.length - 1] || null);

      var dateTrigger = document.getElementById('cmp-date');
      if (dateTrigger) dateTrigger.addEventListener('click', function() {
        var dates = cmpDates();
        calToggle(dateTrigger, {
          dates: dates,
          selected: cmpState.date,
          footLabel: 'Nieuwste dag',
          onFoot: function() { cmpSetDate(dates[dates.length - 1]); },
          onPick: cmpSetDate,
        });
      });

      var slider = document.getElementById('cmp-slider');
      if (slider) slider.addEventListener('input', function() { cmpGoto(parseInt(this.value, 10)); });

      var prev = document.getElementById('cmp-prev');
      if (prev) prev.addEventListener('click', function() { cmpGoto(cmpState.index - 1); });
      var next = document.getElementById('cmp-next');
      if (next) next.addEventListener('click', function() { cmpGoto(cmpState.index + 1); });

      var tol = document.getElementById('cmp-tol');
      if (tol) tol.addEventListener('change', function() {
        cmpState.tol = parseInt(this.value, 10) || 15;
        cmpRefresh(false);
      });

      var sync = document.getElementById('cmp-sync');
      if (sync) sync.addEventListener('change', function() { cmpState.sync = this.checked; });

      var grid = document.getElementById('cmp-grid');
      if (grid) grid.addEventListener('click', function(e) {
        var shot = e.target.closest('.cmp-shot');
        if (shot) openLightbox(shot);
      });

      cmpRefresh(true);
      // Een link met een tijdstip opent op het moment dat er het dichtst bij ligt
      cmpGotoTime(parseClock(urlParams.t));
    }

    // Standaard cluster selecteren bij openen (URL param overschrijft default)
    (function() {
      // Een gedeelde link naar een titel uit een ander cluster moet werken:
      // zonder cluster in de URL volgt het filter de titel. Dat geldt ook op de
      // vergelijkpagina, waar die titel het anker van de vergelijking is.
      const siteCluster = urlParams.site && !urlParams.cluster && meta[urlParams.site]
        ? meta[urlParams.site].cluster : null;
      const defaultCluster = urlParams.cluster || siteCluster ||
        (meta[DEFAULT_SITE] ? meta[DEFAULT_SITE].cluster : 'AD Regiosites');
      clusterSelect.value = defaultCluster;
      filterState.cluster = defaultCluster;
      applyClusterFilter();
      updateSiteSelect();

      // Vergelijkweergave klaarzetten: titels uit de URL of uit het actieve cluster
      cmpInit();

      // Openen via ?view=vergelijk of via het pad /vergelijk
      const wantsCompare = urlParams.view === 'vergelijk' ||
        window.location.pathname.indexOf('/vergelijk') === 0;
      if (wantsCompare) {
        const cmpTab = document.querySelector('.tab[data-site="__vergelijk__"]');
        if (cmpTab) activateTab(cmpTab);
      }

      // Site uit de URL, anders de standaardsite
      const wantedSite = urlParams.site || DEFAULT_SITE;
      if (wantedSite && !wantsCompare) {
        const targetTab = document.querySelector('.tab[data-site="' + wantedSite + '"]');
        if (targetTab && !targetTab.classList.contains('hidden')) {
          activateTab(targetTab);
        }
      }

      // Mobiele modus via URL parameter
      if (urlParams.mobile === '1') {
        isMobileMode = true;
        document.getElementById('mobile-toggle').classList.add('active');
        // Herrender de actieve sectie in mobiele modus
        var activeSec = document.querySelector('.website-section.active');
        if (activeSec && !isVirtualSite(activeSec.dataset.site)) {
          renderFilmstrip(activeSec.dataset.site, true);
          initSectionHero(activeSec, true);
        }
      }

      // Datum en/of tijdstip uit de link: daarheen zodra de filmstrip er staat.
      // Met een tijdstip landt de hero op de opname die er het dichtst bij ligt
      // — een link vanuit de Nieuwsmonitor wijst naar het moment dat een bericht
      // verscheen, en dat is zelden precies een opnametijdstip.
      const wantedMinutes = parseClock(urlParams.t);
      if ((urlParams.date || wantedMinutes !== null) && !wantsCompare) {
        requestAnimationFrame(() => {
          if (wantedMinutes !== null) jumpToMoment(urlParams.date, wantedMinutes);
          else scrollFilmstripToDate(urlParams.date);
          refreshDateTrigger();
        });
      }

      updateUrl();
    })();

    // Mobiele versie toggle
    document.getElementById('mobile-toggle').addEventListener('click', function() {
      isMobileMode = !isMobileMode;
      this.classList.toggle('active', isMobileMode);

      // Markeer alle secties als niet-gerenderd zodat ze herrenderd worden
      document.querySelectorAll('.website-section').forEach(function(s) {
        if (!isVirtualSite(s.dataset.site)) {
          s.dataset.rendered = 'false';
        }
      });

      // Herrender de actieve sectie
      var activeSection = document.querySelector('.website-section.active');
      if (activeSection && !isVirtualSite(activeSection.dataset.site)) {
        renderFilmstrip(activeSection.dataset.site, true);
        initSectionHero(activeSection, true);
      }

      updateUrl();
    });

    // Klik op peek-afbeeldingen om te navigeren
    document.querySelectorAll('.hero-peek-left').forEach(peek => {
      peek.addEventListener('click', () => {
        const section = peek.closest('.website-section');
        if (!section) return;
        const thumbs = [...section.querySelectorAll('.fs-thumb')];
        const activeThumb = section.querySelector('.fs-thumb.active');
        const idx = activeThumb ? thumbs.indexOf(activeThumb) : -1;
        if (idx > 0) activateThumb(thumbs[idx - 1]);
      });
    });

    document.querySelectorAll('.hero-peek-right').forEach(peek => {
      peek.addEventListener('click', () => {
        const section = peek.closest('.website-section');
        if (!section) return;
        const thumbs = [...section.querySelectorAll('.fs-thumb')];
        const activeThumb = section.querySelector('.fs-thumb.active');
        const idx = activeThumb ? thumbs.indexOf(activeThumb) : -1;
        if (idx < thumbs.length - 1) activateThumb(thumbs[idx + 1]);
      });
    });

    // Lightbox: openen via klik op hero-afbeelding
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCounter = document.getElementById('lightbox-counter');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');

    let lightboxThumbs = [];
    let lightboxIndex = 0;

    function getVisibleThumbs() {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection) return [];
      // In de vergelijkweergave loopt de lichtbak over de kolommen van dit moment
      if (activeSection.dataset.site === '__vergelijk__') {
        return [...activeSection.querySelectorAll('.cmp-shot[data-url]')];
      }
      return [...activeSection.querySelectorAll('.fs-thumb')];
    }

    // Enkel de tijdlijn kent een actief beeld; kolommen in de vergelijkweergave niet
    function syncLightboxSelection(thumb) {
      if (thumb && thumb.classList.contains('fs-thumb')) activateThumb(thumb);
    }

    function openLightbox(target) {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection) return;
      lightboxThumbs = getVisibleThumbs();
      const activeThumb = target || activeSection.querySelector('.fs-thumb.active');
      lightboxIndex = activeThumb ? Math.max(0, lightboxThumbs.indexOf(activeThumb)) : 0;
      showLightboxAt(lightboxIndex);
      lightbox.classList.add('open');
    }

    function showLightboxAt(idx) {
      const thumb = lightboxThumbs[idx];
      if (!thumb) return;
      const url = thumb.dataset.url;
      lightboxImg.src = url;
      const thumbImg = thumb.querySelector('img');
      if (thumbImg && thumbImg.dataset.src && !thumbImg.getAttribute('src')) {
        thumbImg.src = thumbImg.dataset.src;
      }
      lightboxCounter.textContent = (idx + 1) + ' / ' + lightboxThumbs.length;
      lightboxPrev.classList.toggle('disabled', idx === 0);
      lightboxNext.classList.toggle('disabled', idx === lightboxThumbs.length - 1);
    }

    function closeLightbox() {
      lightbox.classList.remove('open');
      lightboxImg.src = '';
    }

    // Hero klikken opent lightbox + Tinder-achtige swipe navigatie
    document.querySelectorAll('.hero-stage').forEach(stage => {
      let preventClick = false;
      let touchState = { startX: 0, startY: 0, isDragging: false, decided: false };

      stage.addEventListener('click', (e) => {
        if (preventClick) { preventClick = false; return; }
        const heroImg = stage.querySelector('.hero-img');
        if (heroImg && heroImg.src && !heroImg.src.endsWith('/')) {
          e.stopPropagation();
          openLightbox();
        }
      });

      stage.addEventListener('touchstart', (e) => {
        touchState = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, isDragging: false, decided: false };
      }, { passive: true });

      stage.addEventListener('touchmove', (e) => {
        const x = e.touches[0].clientX;
        const y = e.touches[0].clientY;
        const dx = x - touchState.startX;
        const dy = y - touchState.startY;

        if (!touchState.decided) {
          if (Math.abs(dx) > 12 || Math.abs(dy) > 12) {
            touchState.decided = true;
            touchState.isDragging = Math.abs(dx) > Math.abs(dy);
          }
          return;
        }
        if (!touchState.isDragging) return;

        touchState.lastX = x;
        const heroImg = stage.querySelector('.hero-img');
        if (!heroImg) return;
        const rotation = dx * 0.015;
        const opacity = Math.max(0.4, 1 - Math.abs(dx) / 300);
        heroImg.classList.add('swiping');
        heroImg.style.transform = 'translateX(' + dx + 'px) rotate(' + rotation + 'deg)';
        heroImg.style.opacity = opacity;
      }, { passive: true });

      stage.addEventListener('touchend', (e) => {
        if (!touchState.isDragging) return;
        preventClick = true;
        const dx = e.changedTouches[0].clientX - touchState.startX;
        const heroImg = stage.querySelector('.hero-img');
        if (!heroImg) return;
        heroImg.classList.remove('swiping');

        const section = stage.closest('.website-section');
        if (!section) { resetHeroTransform(heroImg); return; }
        const thumbs = [...section.querySelectorAll('.fs-thumb')];
        const activeThumb = section.querySelector('.fs-thumb.active');
        const idx = activeThumb ? thumbs.indexOf(activeThumb) : -1;

        // Swipe rechts (dx>0) = ouder (lager index), swipe links (dx<0) = nieuwer (hoger index)
        let newIdx = idx;
        if (dx > 0 && idx > 0) newIdx = idx - 1;
        else if (dx < 0 && idx < thumbs.length - 1) newIdx = idx + 1;

        if (Math.abs(dx) > 70 && newIdx !== idx && thumbs[newIdx]) {
          // Snelle fly-out (afbeeldingen zijn al gepreload via peeks)
          const flyX = dx > 0 ? window.innerWidth : -window.innerWidth;
          const flyRot = dx > 0 ? 8 : -8;
          heroImg.style.transition = 'transform 0.15s ease-out, opacity 0.15s ease-out';
          heroImg.style.transform = 'translateX(' + flyX + 'px) rotate(' + flyRot + 'deg)';
          heroImg.style.opacity = '0';

          setTimeout(() => {
            // Positie voor entry vanuit de andere kant
            heroImg.style.transition = 'none';
            heroImg.style.transform = 'translateX(' + (dx > 0 ? '-40%' : '40%') + ')';
            heroImg.style.opacity = '0';
            activateThumb(thumbs[newIdx]);
            requestAnimationFrame(() => { requestAnimationFrame(() => {
              heroImg.style.transition = 'transform 0.18s cubic-bezier(0.25,0.1,0.25,1), opacity 0.18s ease';
              heroImg.style.transform = '';
              heroImg.style.opacity = '1';
              setTimeout(() => { heroImg.style.transition = ''; }, 220);
            }); });
          }, 120);
        } else {
          resetHeroTransform(heroImg);
        }
        touchState.isDragging = false;
      }, { passive: true });
    });

    function resetHeroTransform(heroImg) {
      heroImg.style.transition = 'transform 0.3s cubic-bezier(0.25,0.1,0.25,1), opacity 0.3s ease';
      heroImg.style.transform = '';
      heroImg.style.opacity = '1';
      setTimeout(() => { heroImg.style.transition = ''; }, 350);
    }

    lightboxPrev.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lightboxIndex > 0) {
        showLightboxAt(--lightboxIndex);
        // Sync met filmstrip
        syncLightboxSelection(lightboxThumbs[lightboxIndex]);
      }
    });

    lightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lightboxIndex < lightboxThumbs.length - 1) {
        showLightboxAt(++lightboxIndex);
        // Sync met filmstrip
        syncLightboxSelection(lightboxThumbs[lightboxIndex]);
      }
    });

    lightbox.addEventListener('click', closeLightbox);
    lightboxImg.addEventListener('click', (e) => e.stopPropagation());

    // Scroll de filmstrip zodat de actieve thumbnail zichtbaar blijft
    function scrollFilmstripToThumb(thumb) {
      const filmstrip = thumb.closest('.filmstrip');
      if (!filmstrip) return;
      const thumbRect = thumb.getBoundingClientRect();
      const stripRect = filmstrip.getBoundingClientRect();
      if (thumbRect.left < stripRect.left || thumbRect.right > stripRect.right) {
        const offset = thumb.offsetLeft - filmstrip.offsetLeft - stripRect.width / 2 + thumb.offsetWidth / 2;
        filmstrip.scrollTo({ left: offset, behavior: 'smooth' });
      }
    }

    // Navigeer naar vorige/volgende screenshot in de hero view
    function navigateHero(direction) {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection || isVirtualSite(activeSection.dataset.site)) return;
      const thumbs = [...activeSection.querySelectorAll('.fs-thumb')];
      const activeThumb = activeSection.querySelector('.fs-thumb.active');
      const idx = activeThumb ? thumbs.indexOf(activeThumb) : -1;
      const newIdx = idx + direction;
      if (newIdx >= 0 && newIdx < thumbs.length) {
        activateThumb(thumbs[newIdx]);
        scrollFilmstripToThumb(thumbs[newIdx]);
      }
    }

    document.addEventListener('keydown', (e) => {
      // Negeer toetsen als een inputveld of select actief is
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      // Staat de kalender open, dan gaat Escape daarover
      if (calState.open) {
        if (e.key === 'Escape') calClose();
        return;
      }

      if (lightbox.classList.contains('open')) {
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft' && lightboxIndex > 0) {
          showLightboxAt(--lightboxIndex);
          syncLightboxSelection(lightboxThumbs[lightboxIndex]);
        }
        if (e.key === 'ArrowRight' && lightboxIndex < lightboxThumbs.length - 1) {
          showLightboxAt(++lightboxIndex);
          syncLightboxSelection(lightboxThumbs[lightboxIndex]);
        }
        return;
      }

      // In de vergelijkweergave springen de pijltjes tussen de momenten
      const openSection = document.querySelector('.website-section.active');
      if (openSection && openSection.dataset.site === '__vergelijk__') {
        cmpHandleKey(e);
        return;
      }

      // Pijltjestoetsen navigatie in de hero view
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        navigateHero(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        navigateHero(1);
      }
    });
  </script>
  <!-- Cloudflare Web Analytics --><script type='module' src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "3f8864277c7d415eab6d36bcb0f9221a"}'></script><!-- End Cloudflare Web Analytics -->
</body>
</html>`;
}

async function main() {
  console.log('\\n Generating screenshot viewer\\n');
  console.log('='.repeat(50));

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucketName) {
    console.error('R2_BUCKET_NAME not set');
    process.exit(1);
  }

  if (!publicUrl) {
    console.error('R2_PUBLIC_URL not set');
    process.exit(1);
  }

  const client = createR2Client();

  console.log('Listing all objects in bucket...');
  const objects = await listAllObjects(client, bucketName);
  console.log(`   Found ${objects.length} object(s)`);

  const { desktop, mobile } = buildStructure(objects);
  const { meta: websitesMeta, websites: allWebsites } = loadWebsitesMeta();
  const desktopCount = Object.keys(desktop).length;
  const mobileCount = Object.keys(mobile).length;
  console.log(`   ${desktopCount} website(s) with desktop screenshots`);
  console.log(`   ${mobileCount} website(s) with mobile screenshots\n`);

  const html = generateHTML(desktop, mobile, publicUrl, websitesMeta, allWebsites);

  // Gzip compressie: typisch 70-80% kleiner, snellere downloads
  const compressed = gzipSync(html, { level: 9 });
  const savings = Math.round((1 - compressed.length / Buffer.byteLength(html)) * 100);
  console.log(`Uploading index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB → ${Math.round(compressed.length / 1024)} KB gzipped, ${savings}% smaller)...`);

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'index.html',
    Body: compressed,
    ContentType: 'text/html; charset=utf-8',
    ContentEncoding: 'gzip',
  }));

  console.log(`Viewer uploaded to: ${publicUrl}/index.html`);
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
