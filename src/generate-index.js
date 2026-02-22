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

  // Sorteer datums nieuwste eerst, en screenshots binnen een datum ook nieuwste eerst
  for (const website of Object.keys(structure)) {
    const sorted = {};
    for (const date of Object.keys(structure[website]).sort().reverse()) {
      sorted[date] = structure[website][date].sort((a, b) => b.filename.localeCompare(a.filename));
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
      background: #faf9fb;
      color: #2d2d3a;
      min-height: 100vh;
    }

    header {
      background: linear-gradient(135deg, #783c96 0%, #d23278 50%, #e6463c 80%, #fabb22 100%);
      color: #fff;
      padding: 1.5rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 4px 20px rgba(120, 60, 150, 0.3);
    }

    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    header h1 {
      font-size: 1.4rem;
      font-weight: 700;
      letter-spacing: -0.02em;
    }

    header p {
      font-size: 0.78rem;
      opacity: 0.85;
      font-weight: 400;
    }

    /* Filter bar */
    .filter-bar {
      background: #fff;
      border-bottom: 1px solid #ece8f0;
      padding: 0.8rem 2rem;
      position: sticky;
      top: 68px;
      z-index: 99;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .filter-bar-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .filter-label {
      font-size: 0.72rem;
      font-weight: 600;
      color: #8a7a9a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      min-width: 58px;
    }

    .filter-chips {
      display: flex;
      gap: 0.3rem;
      flex-wrap: wrap;
    }

    .filter-chip {
      padding: 0.3rem 0.8rem;
      border: 1.5px solid #e0dae6;
      border-radius: 2rem;
      background: #f8f5fa;
      color: #5a4a6a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.75rem;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .filter-chip:hover {
      background: #ebe4f0;
      border-color: #c9b8d9;
    }

    .filter-chip.active {
      background: #783c96;
      color: #fff;
      border-color: #783c96;
      box-shadow: 0 2px 6px rgba(120, 60, 150, 0.2);
    }

    /* Website tabs */
    .tabs {
      display: flex;
      gap: 0.35rem;
      padding: 0.6rem 2rem;
      background: #f8f5fa;
      border-bottom: 1px solid #ece8f0;
      overflow-x: auto;
      position: sticky;
      top: 130px;
      z-index: 98;
    }

    .tabs::-webkit-scrollbar { height: 0; }

    .tab {
      padding: 0.4rem 0.9rem;
      border: 1.5px solid transparent;
      border-radius: 2rem;
      background: #fff;
      color: #5a4a6a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.78rem;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .tab:hover {
      background: #ebe4f0;
      border-color: #c9b8d9;
    }

    .tab.active {
      background: #783c96;
      color: #fff;
      border-color: #783c96;
      box-shadow: 0 2px 8px rgba(120, 60, 150, 0.25);
    }

    .tab.hidden { display: none; }

    .content { max-width: 1400px; margin: 0 auto; padding: 1rem 2rem 3rem; }

    .website-section { display: none; }
    .website-section.active { display: block; }

    /* Hero: grote weergave van het geselecteerde screenshot */
    .hero-wrap { margin-bottom: 0.75rem; }

    .hero-stage {
      background: #16101f;
      border-radius: 10px;
      overflow: hidden;
      position: relative;
      min-height: 180px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      cursor: zoom-in;
    }

    .hero-img {
      width: 100%;
      height: auto;
      max-height: 72vh;
      object-fit: contain;
      object-position: top;
      display: block;
      transition: opacity 0.18s ease;
    }

    .hero-img.loading { opacity: 0.4; }

    .hero-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #6a5a7a;
      font-size: 0.85rem;
    }

    .hero-meta {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.45rem 0.25rem 0.6rem;
    }

    .hero-badge {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.83rem;
      color: #5a4a6a;
    }

    .hero-date { font-weight: 700; color: #783c96; }
    .hero-sep { color: #c9b8d9; }
    .hero-time { font-weight: 500; }

    .hero-hint {
      font-size: 0.72rem;
      color: #a898b8;
      font-style: italic;
    }

    /* Filmstrip tijdlijn */
    .filmstrip-wrap {
      border-top: 1px solid #ece8f0;
      padding-top: 0.7rem;
    }

    .filmstrip-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 0.5rem;
    }

    .filmstrip-title {
      font-size: 0.72rem;
      font-weight: 600;
      color: #8a7a9a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .filmstrip-scroll-hint {
      font-size: 0.7rem;
      color: #b0a0c0;
    }

    .filmstrip {
      display: flex;
      flex-direction: row;
      gap: 0;
      overflow-x: auto;
      scroll-behavior: smooth;
      scrollbar-width: thin;
      scrollbar-color: #c9b8d9 #f0ebf6;
      padding-bottom: 0.5rem;
      align-items: stretch;
    }

    .filmstrip::-webkit-scrollbar { height: 5px; }
    .filmstrip::-webkit-scrollbar-track { background: #f0ebf6; border-radius: 3px; }
    .filmstrip::-webkit-scrollbar-thumb { background: #c9b8d9; border-radius: 3px; }

    .fs-date-group {
      display: flex;
      flex-direction: row;
      align-items: stretch;
      flex-shrink: 0;
      border-right: 2px solid #e8e0f0;
      padding-right: 0.6rem;
      margin-right: 0.6rem;
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
      font-size: 0.65rem;
      font-weight: 700;
      color: #783c96;
      padding: 0.3rem 0.35rem;
      background: #f0ebf6;
      border-radius: 6px 0 0 6px;
      margin-right: 0.35rem;
      flex-shrink: 0;
      min-width: 22px;
      letter-spacing: 0.04em;
      user-select: none;
    }

    .fs-thumbs {
      display: flex;
      flex-direction: row;
      gap: 0.3rem;
      align-items: flex-start;
    }

    .fs-thumb {
      flex: 0 0 96px;
      width: 96px;
      cursor: pointer;
      border-radius: 6px;
      overflow: hidden;
      border: 2px solid transparent;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
      background: #f0ecf5;
    }

    .fs-thumb:hover { border-color: #c9b8d9; }

    .fs-thumb.active {
      border-color: #783c96;
      box-shadow: 0 2px 8px rgba(120, 60, 150, 0.3);
    }

    .fs-thumb img {
      width: 100%;
      height: 62px;
      object-fit: cover;
      object-position: top;
      display: block;
    }

    .fs-time {
      display: block;
      text-align: center;
      font-size: 0.63rem;
      font-weight: 500;
      color: #5a4a6a;
      padding: 0.18rem 0;
      background: #fff;
      border-top: 1px solid #f0ecf3;
      white-space: nowrap;
    }

    .fs-thumb.active .fs-time {
      background: #f0ebf6;
      color: #783c96;
      font-weight: 700;
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
      background: rgba(30, 20, 40, 0.92);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
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
      font-size: 2rem;
      cursor: pointer;
      z-index: 1001;
      line-height: 1;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      transition: background 0.2s;
    }

    .lightbox-close:hover { background: rgba(255,255,255,0.2); }

    .lightbox-nav {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      color: #fff;
      font-size: 2.2rem;
      cursor: pointer;
      z-index: 1001;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(255,255,255,0.12);
      transition: background 0.2s;
      user-select: none;
    }

    .lightbox-nav:hover { background: rgba(255,255,255,0.25); }
    .lightbox-nav.prev { left: 1rem; }
    .lightbox-nav.next { right: 1rem; }
    .lightbox-nav.disabled { opacity: 0.2; cursor: default; pointer-events: none; }

    .lightbox-counter {
      position: fixed;
      bottom: 1.2rem;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.7);
      font-size: 0.8rem;
      font-weight: 500;
      background: rgba(0,0,0,0.3);
      padding: 0.3rem 0.8rem;
      border-radius: 999px;
      z-index: 1001;
      pointer-events: none;
    }

    /* Schema tab */
    .tab-schema {
      margin-left: auto;
      background: #f0ebf6;
      border-color: #c9b8d9;
      font-weight: 600;
    }

    .tab-schema.active {
      background: #5a2d82;
      border-color: #5a2d82;
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
      header { padding: 1rem; }
      .header-inner { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
      .filter-bar { padding: 0.6rem 1rem; top: 56px; }
      .tabs { padding: 0.5rem 1rem; top: auto; position: relative; }
      .content { padding: 0.75rem 1rem 2rem; }
      .hero-img { max-height: 55vw; }
      .fs-thumb { flex: 0 0 76px; width: 76px; }
      .fs-thumb img { height: 50px; }
      .lightbox-nav { width: 36px; height: 36px; font-size: 1.6rem; }
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

  <div class="filter-bar">
    <div class="filter-bar-inner">
      <div class="filter-row" data-filter="cluster">
        <span class="filter-label">Cluster</span>
        <div class="filter-chips" id="filter-cluster"></div>
      </div>
      <div class="filter-row" data-filter="date">
        <span class="filter-label">Ga naar</span>
        <div class="filter-chips" id="filter-date"></div>
      </div>
    </div>
  </div>

  <div class="tabs" id="tabs">
    ${websites.map((w, i) => {
      const m = websitesMeta[w];
      const label = m ? m.label : w;
      return `<button class="tab${i === 0 ? ' active' : ''}" data-site="${w}" data-cluster="${m ? m.cluster : ''}">${label}</button>`;
    }).join('\n    ')}
    <button class="tab tab-schema" data-site="__schema__" data-cluster="">Schema</button>
  </div>

  <div class="content">
    ${websites.length === 0 ? '<div class="empty">Nog geen screenshots gevonden.</div>' : ''}
    ${websites.map((website, i) => {
      const dates = structure[website];
      const dateKeys = Object.keys(dates);
      // Bepaal de URL van de allereerste (meest recente) screenshot voor eager loading
      const firstDatePairs = dates[dateKeys[0]] || [];
      const firstItem = firstDatePairs[0];
      const firstUrl = firstItem ? (baseUrl + '/' + firstItem.key) : '';
      const firstTIdx = firstItem ? firstItem.filename.indexOf('T') : -1;
      const firstTimePart = firstTIdx > -1 ? firstItem.filename.slice(firstTIdx+1, firstTIdx+9) : '';
      const firstTimeStr = firstTimePart.length === 8 ? firstTimePart.replace(/-/g, ':') : '';

      return `<div class="website-section${i === 0 ? ' active' : ''}" data-site="${website}">
      <!-- Hero: grote weergave van het geselecteerde screenshot -->
      <div class="hero-wrap">
        <div class="hero-stage" id="hero-stage-${website}">
          <img class="hero-img" id="hero-img-${website}"
            ${i === 0 && firstUrl ? 'src="'+firstUrl+'"' : ''}
            alt="Screenshot">
          <div class="hero-placeholder" id="hero-placeholder-${website}"${i === 0 && firstUrl ? ' style="display:none"' : ''}>Selecteer een screenshot in de tijdlijn hieronder</div>
        </div>
        <div class="hero-meta">
          <div class="hero-badge">
            <span class="hero-date" id="hero-date-${website}">${i === 0 ? dateKeys[0] : ''}</span>
            <span class="hero-sep">${i === 0 && firstTimeStr ? '·' : ''}</span>
            <span class="hero-time" id="hero-time-${website}">${i === 0 ? firstTimeStr : ''}</span>
          </div>
          <span class="hero-hint">klik op de afbeelding om te vergroten</span>
        </div>
      </div>

      <!-- Filmstrip tijdlijn: scroll naar rechts voor oudere screenshots -->
      <div class="filmstrip-wrap">
        <div class="filmstrip-header">
          <span class="filmstrip-title">Tijdlijn</span>
          <span class="filmstrip-scroll-hint">nieuwste ← scroll → oudste</span>
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
                const isFirstThumb = i === 0 && date === dateKeys[0] && pairIdx === 0;
                // Eager load enkel eerste thumb van eerste website
                const src = isFirstThumb ? 'src="'+url+'"' : '';
                return '<div class="fs-thumb'+(isFirstThumb ? ' active' : '')+'" data-url="'+url+'" data-date="'+date+'" data-time="'+timeStr+'">'
                  + '<img '+src+' data-src="'+url+'" alt="'+timeStr+'">'
                  + '<span class="fs-time">'+timeStr+'</span>'
                  + '</div>';
              }).join('')
              + '</div>'
              + '</div>';
          }).join('\n          ')}
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

    const clusterContainer = document.getElementById('filter-cluster');
    getUniqueValues('cluster').forEach(val => {
      const chip = document.createElement('button');
      chip.className = 'filter-chip';
      chip.textContent = val;
      chip.dataset.value = val;
      chip.addEventListener('click', () => {
        if (filterState.cluster === val) {
          filterState.cluster = null;
          chip.classList.remove('active');
        } else {
          clusterContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          filterState.cluster = val;
          chip.classList.add('active');
        }
        applyClusterFilter();
      });
      clusterContainer.appendChild(chip);
    });

    // Datum-chips: navigeren naar die datum in de actieve filmstrip
    (function buildDateChips() {
      const container = document.getElementById('filter-date');
      allDates.forEach((date, i) => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        chip.textContent = date;
        chip.dataset.date = date;
        chip.addEventListener('click', () => {
          container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          scrollFilmstripToDate(date);
          // Chip na korte tijd deactiveren (het is een navigatieactie, geen filter)
          setTimeout(() => chip.classList.remove('active'), 800);
        });
        container.appendChild(chip);
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

    function initSectionHero(section) {
      const firstThumb = section.querySelector('.fs-thumb');
      if (firstThumb && !section.querySelector('.fs-thumb.active')) {
        activateThumb(firstThumb);
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
        const filterBar = document.querySelector('.filter-bar');
        if (filterBar) filterBar.style.display = tab.dataset.site === '__schema__' ? 'none' : '';
        if (tab.dataset.site !== '__schema__') {
          initSectionHero(section);
        }
      }
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab));
    });

    // Initialiseer de hero van de eerste sectie
    (function() {
      const firstSection = document.querySelector('.website-section.active');
      if (firstSection) initSectionHero(firstSection);
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

    // Hero klikken opent lightbox
    document.querySelectorAll('.hero-stage').forEach(stage => {
      stage.addEventListener('click', (e) => {
        const heroImg = stage.querySelector('.hero-img');
        if (heroImg && heroImg.src && !heroImg.src.endsWith('/')) {
          e.stopPropagation();
          openLightbox();
        }
      });
    });

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
