import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { gzipSync } from 'zlib';
import { createR2Client, listAllObjects } from './r2-client.js';

function buildStructure(objects) {
  // Structuur: { websiteName: { datum: [{ filename, key, size }] } }
  const structure = {};

  for (const obj of objects) {
    const parts = obj.Key.split('/');
    // Verwacht: website/datum/bestand.webp of .jpg
    if (parts.length !== 3) continue;
    if (!parts[2].endsWith('.webp') && !parts[2].endsWith('.jpg')) continue;

    const [website, date, filename] = parts;

    // Sla legacy mobiele screenshots over
    if (/_mobile\.(webp|jpg)$/.test(filename)) continue;

    if (!structure[website]) structure[website] = {};
    if (!structure[website][date]) structure[website][date] = [];
    structure[website][date].push({ filename, key: obj.Key, size: obj.Size });
  }

  // Sorteer datums oudste eerst, screenshots binnen een datum ook oudste eerst
  // (tijdlijn loopt van links/oud naar rechts/nieuw)
  for (const website of Object.keys(structure)) {
    const sorted = {};
    for (const date of Object.keys(structure[website]).sort()) {
      sorted[date] = structure[website][date].sort((a, b) => a.filename.localeCompare(b.filename));
    }
    structure[website] = sorted;
  }

  return structure;
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

function generateHTML(structure, publicUrl, websitesMeta, allWebsites) {
  const websites = Object.keys(structure).sort();
  const baseUrl = publicUrl.replace(/\/$/, '');

  // Bouw metadata JSON voor client-side filtering
  const metaJSON = JSON.stringify(websitesMeta);

  // Verzamel alle unieke datums (nieuwste eerst) voor het datumfilter
  const allDates = new Set();
  for (const website of Object.values(structure)) {
    for (const date of Object.keys(website)) {
      allDates.add(date);
    }
  }
  const sortedDates = [...allDates].sort().reverse();
  const datesJSON = JSON.stringify(sortedDates);

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RI&amp;G Screenshots</title>
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

    /* Date dropdown instead of chips row */
    .date-select-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .date-select {
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

    .date-select:hover { background-color: #ebe4f0; border-color: #c0b0d0; }
    .date-select:focus { outline: none; border-color: #783c96; box-shadow: 0 0 0 2px rgba(120,60,150,0.12); }

    /* Website tabs - inline in toolbar */
    .tabs-scroll {
      display: flex;
      gap: 0.2rem;
      overflow-x: auto;
      scrollbar-width: none;
      flex: 1;
      min-width: 0;
    }

    .tabs-scroll::-webkit-scrollbar { height: 0; }

    .tab {
      padding: 0.22rem 0.65rem;
      border: none;
      border-radius: 999px;
      background: transparent;
      color: #7a6a8a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.68rem;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.18s ease;
      line-height: 1.3;
    }

    .tab:hover {
      background: rgba(120,60,150,0.08);
      color: #5a3a7a;
    }

    .tab.active {
      background: #783c96;
      color: #fff;
      box-shadow: 0 1px 6px rgba(120, 60, 150, 0.3);
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
      background: #16101f;
      border-radius: 10px;
      overflow-y: auto;
      overflow-x: hidden;
      position: relative;
      height: 72vh;
      min-height: 180px;
      cursor: zoom-in;
      touch-action: pan-y;
      scrollbar-width: thin;
      scrollbar-color: #6a5a7a #16101f;
    }

    .hero-stage::-webkit-scrollbar { width: 5px; }
    .hero-stage::-webkit-scrollbar-track { background: #16101f; }
    .hero-stage::-webkit-scrollbar-thumb { background: #6a5a7a; border-radius: 3px; }

    .hero-img {
      width: 100%;
      height: auto;
      display: block;
      transition: opacity 0.25s ease, transform 0.25s ease;
      will-change: transform;
    }

    .hero-img.loading { opacity: 0.4; }
    .hero-img.swiping { transition: none !important; }

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

    /* Schema tab */
    .tab-schema {
      margin-left: auto;
      background: rgba(120,60,150,0.06);
      font-weight: 600;
    }

    .tab-schema.active {
      background: #5a2d82;
    }

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

    .schema-table td {
      padding: 0.55rem 0.9rem;
      border-bottom: 1px solid #f5f2f8;
      vertical-align: middle;
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

    @media (max-width: 700px) {
      header { padding: 0.5rem 1rem; }
      .header-inner { flex-direction: column; align-items: flex-start; gap: 0.1rem; }
      header h1 { font-size: 0.9rem; }
      .toolbar { padding: 0.35rem 0.75rem; top: 32px; }
      .toolbar-inner { flex-wrap: wrap; gap: 0.3rem; }
      .toolbar-divider { display: none; }
      .tabs-scroll { order: 10; flex-basis: 100%; }
      .content { padding: 0.5rem 0.75rem 2rem; }
      .hero-stage { height: 55vh; }
      .fs-thumb { flex: 0 0 64px; width: 64px; }
      .fs-thumb img { height: 42px; }
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
      <h1>RI&amp;G Screenshots</h1>
      <p>Laatste update: ${new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</p>
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
      <div class="toolbar-divider"></div>
      <div class="toolbar-section">
        <span class="toolbar-label">Datum</span>
        <div class="date-select-wrap">
          <select class="date-select" id="filter-date">
            <option value="">Spring naar...</option>
          </select>
        </div>
      </div>
      <div class="toolbar-divider"></div>
      <div class="tabs-scroll" id="tabs">
        ${websites.map((w, i) => {
          const m = websitesMeta[w];
          const label = m ? m.label : w;
          return `<button class="tab${i === 0 ? ' active' : ''}" data-site="${w}" data-cluster="${m ? m.cluster : ''}">${label}</button>`;
        }).join('\n        ')}
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

      return `<div class="website-section${i === 0 ? ' active' : ''}" data-site="${website}">
      <!-- Filmstrip tijdlijn: boven de hero voor snelle navigatie -->
      <div class="filmstrip-wrap">
        <div class="filmstrip-header">
          <span class="filmstrip-title">Tijdlijn</span>
          <span class="filmstrip-scroll-hint">oudste ← scroll → nieuwste</span>
        </div>
        <div class="filmstrip" id="filmstrip-${website}">
          ${Object.entries(dates).map(([date, pairs]) => {
            return '<div class="fs-date-group" data-date="'+date+'">'
              + '<div class="fs-date-sep">'+date+'</div>'
              + '<div class="fs-thumbs">'
              + pairs.map((item, pairIdx) => {
                const tIdx = item.filename.indexOf('T');
                const timePart = tIdx > -1 ? item.filename.slice(tIdx+1, tIdx+9) : '';
                const timeStr = timePart.length === 8 ? timePart.replace(/-/g, ':') : '';
                const url = baseUrl + '/' + item.key;
                const isNewestThumb = i === 0 && date === lastDateKey && pairIdx === pairs.length - 1;
                // Eager load enkel nieuwste thumb van eerste website
                const src = isNewestThumb ? 'src="'+url+'"' : '';
                return '<div class="fs-thumb'+(isNewestThumb ? ' active' : '')+'" data-url="'+url+'" data-date="'+date+'" data-time="'+timeStr+'">'
                  + '<img '+src+' data-src="'+url+'" alt="'+timeStr+'">'
                  + '<span class="fs-time">'+timeStr+'</span>'
                  + '</div>';
              }).join('')
              + '</div>'
              + '</div>';
          }).join('\n          ')}
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
          <span class="hero-hint">klik om te vergroten</span>
        </div>
        <div class="hero-stage" id="hero-stage-${website}">
          <img class="hero-img" id="hero-img-${website}"
            ${i === 0 && newestUrl ? 'src="'+newestUrl+'"' : ''}
            alt="Screenshot">
          <div class="hero-placeholder" id="hero-placeholder-${website}"${i === 0 && newestUrl ? ' style="display:none"' : ''}>Selecteer een screenshot in de tijdlijn hierboven</div>
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
        <thead><tr><th>Site</th><th>URL</th><th>Interval</th><th>Frequentie</th></tr></thead>
        <tbody>
          ${sites.map(w => {
            const interval = w.interval || 60;
            const freq = interval === 30 ? '2x per uur'
              : interval === 60 ? '1x per uur'
              : interval === 120 ? '1x per 2 uur'
              : interval === 180 ? '1x per 3 uur'
              : `1x per ${interval / 60} uur`;
            return `<tr>
              <td class="site-label">${w.label}</td>
              <td style="color:#8a7a9a;font-size:0.78rem">${w.url}</td>
              <td><span class="interval-badge interval-${interval}">${interval} min</span></td>
              <td style="color:#6a5a7a">${freq}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`).join('');
    })()}
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

    const filterState = { cluster: null };

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
    });

    // Datum-select: navigeren naar die datum in de actieve filmstrip
    (function buildDateSelect() {
      const select = document.getElementById('filter-date');
      allDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = date;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        if (select.value) {
          scrollFilmstripToDate(select.value);
          // Reset naar placeholder na navigatie
          setTimeout(() => { select.value = ''; }, 600);
        }
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

    function applyClusterFilter() {
      const tabs = document.querySelectorAll('.tab');
      let firstVisible = null;
      let activeIsVisible = false;

      tabs.forEach(tab => {
        const cluster = tab.dataset.cluster;
        const isSchema = tab.dataset.site === '__schema__';
        const visible = isSchema || !filterState.cluster || cluster === filterState.cluster;
        tab.classList.toggle('hidden', !visible);
        if (visible && !isSchema && !firstVisible) firstVisible = tab;
        if (visible && tab.classList.contains('active')) activeIsVisible = true;
      });

      if (!activeIsVisible && firstVisible) {
        activateTab(firstVisible);
      }
    }

    // Lazy loading via IntersectionObserver (horizontaal scrollen in filmstrip)
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src && !img.getAttribute('src')) {
            img.src = img.dataset.src;
          }
          imageObserver.unobserve(img);
        }
      });
    }, { rootMargin: '400px' });

    document.querySelectorAll('.fs-thumb img[data-src]').forEach(img => imageObserver.observe(img));

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
        heroImg.onload = () => heroImg.classList.remove('loading');
        heroImg.src = url;
      }
      if (heroPlaceholder) heroPlaceholder.style.display = 'none';
      if (heroDate) heroDate.textContent = date;
      if (heroTime) heroTime.textContent = time;
      if (heroSep) heroSep.textContent = time ? '·' : '';

      // Laad ook de miniatuur als die nog niet geladen is
      const thumbImg = thumb.querySelector('img');
      if (thumbImg && thumbImg.dataset.src && !thumbImg.getAttribute('src')) {
        thumbImg.src = thumbImg.dataset.src;
        imageObserver.unobserve(thumbImg);
      }
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

    // Filmstrip thumbnail klikken
    document.querySelectorAll('.fs-thumb').forEach(thumb => {
      thumb.addEventListener('click', () => activateThumb(thumb));
    });

    // Tabs
    function activateTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.website-section').forEach(s => s.classList.remove('active'));
      tab.classList.add('active');
      const section = document.querySelector('.website-section[data-site="' + tab.dataset.site + '"]');
      if (section) {
        section.classList.add('active');
        const toolbar = document.getElementById('toolbar');
        if (toolbar) toolbar.style.display = tab.dataset.site === '__schema__' ? 'none' : '';
        if (tab.dataset.site !== '__schema__') {
          initSectionHero(section);
        }
      }
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab));
    });

    // Initialiseer de hero van de eerste sectie (instant scroll naar nieuwste)
    (function() {
      const firstSection = document.querySelector('.website-section.active');
      if (firstSection) initSectionHero(firstSection, true);
    })();

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
      return [...activeSection.querySelectorAll('.fs-thumb')];
    }

    function openLightbox() {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection) return;
      lightboxThumbs = getVisibleThumbs();
      const activeThumb = activeSection.querySelector('.fs-thumb.active');
      lightboxIndex = activeThumb ? lightboxThumbs.indexOf(activeThumb) : 0;
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
        const rotation = dx * 0.03;
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
          // Fly out
          const flyX = dx > 0 ? window.innerWidth : -window.innerWidth;
          const flyRot = dx > 0 ? 12 : -12;
          heroImg.style.transition = 'transform 0.28s ease, opacity 0.28s ease';
          heroImg.style.transform = 'translateX(' + flyX + 'px) rotate(' + flyRot + 'deg)';
          heroImg.style.opacity = '0';

          setTimeout(() => {
            // Positie voor entry vanuit de andere kant
            heroImg.style.transition = 'none';
            heroImg.style.transform = 'translateX(' + (dx > 0 ? '-50%' : '50%') + ')';
            heroImg.style.opacity = '0';
            activateThumb(thumbs[newIdx]);
            requestAnimationFrame(() => { requestAnimationFrame(() => {
              heroImg.style.transition = 'transform 0.3s cubic-bezier(0.25,0.1,0.25,1), opacity 0.3s ease';
              heroImg.style.transform = '';
              heroImg.style.opacity = '1';
              setTimeout(() => { heroImg.style.transition = ''; }, 350);
            }); });
          }, 220);
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
        if (lightboxThumbs[lightboxIndex]) activateThumb(lightboxThumbs[lightboxIndex]);
      }
    });

    lightboxNext.addEventListener('click', (e) => {
      e.stopPropagation();
      if (lightboxIndex < lightboxThumbs.length - 1) {
        showLightboxAt(++lightboxIndex);
        // Sync met filmstrip
        if (lightboxThumbs[lightboxIndex]) activateThumb(lightboxThumbs[lightboxIndex]);
      }
    });

    lightbox.addEventListener('click', closeLightbox);
    lightboxImg.addEventListener('click', (e) => e.stopPropagation());

    document.addEventListener('keydown', (e) => {
      if (!lightbox.classList.contains('open')) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft' && lightboxIndex > 0) {
        showLightboxAt(--lightboxIndex);
        if (lightboxThumbs[lightboxIndex]) activateThumb(lightboxThumbs[lightboxIndex]);
      }
      if (e.key === 'ArrowRight' && lightboxIndex < lightboxThumbs.length - 1) {
        showLightboxAt(++lightboxIndex);
        if (lightboxThumbs[lightboxIndex]) activateThumb(lightboxThumbs[lightboxIndex]);
      }
    });
  </script>
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

  const structure = buildStructure(objects);
  const { meta: websitesMeta, websites: allWebsites } = loadWebsitesMeta();
  const websiteCount = Object.keys(structure).length;
  console.log(`   ${websiteCount} website(s) with screenshots\n`);

  const html = generateHTML(structure, publicUrl, websitesMeta, allWebsites);

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
