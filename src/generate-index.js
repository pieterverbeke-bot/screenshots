import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';

function createR2Client() {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials.');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function listAllObjects(client, bucketName) {
  const objects = [];
  let continuationToken;

  do {
    const response = await client.send(new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    }));

    if (response.Contents) {
      objects.push(...response.Contents);
    }
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

function buildStructure(objects) {
  // Structuur: { websiteName: { datum: [bestanden] } }
  const structure = {};

  for (const obj of objects) {
    const parts = obj.Key.split('/');
    // Verwacht: website/datum/bestand.webp of .jpg
    if (parts.length !== 3) continue;
    if (!parts[2].endsWith('.webp') && !parts[2].endsWith('.jpg')) continue;

    const [website, date, filename] = parts;

    if (!structure[website]) structure[website] = {};
    if (!structure[website][date]) structure[website][date] = [];

    structure[website][date].push({
      key: obj.Key,
      filename,
      size: obj.Size,
      lastModified: obj.LastModified,
    });
  }

  // Sorteer datums nieuwste eerst, en bestanden binnen elke datum ook nieuwste eerst
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
      top: 176px;
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

    .content { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

    .website-section { display: none; }
    .website-section.active { display: block; }

    .date-group { margin-bottom: 2.5rem; }

    .date-header {
      font-size: 0.95rem;
      font-weight: 600;
      color: #783c96;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #ece8f0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .date-header::before {
      content: '';
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: linear-gradient(135deg, #d23278, #e6463c);
      flex-shrink: 0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
      gap: 1.2rem;
    }

    .card {
      background: #fff;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
      cursor: pointer;
      transition: all 0.2s ease;
      border: 1px solid #f0ecf3;
    }

    .card:hover {
      transform: translateY(-3px);
      box-shadow: 0 12px 24px rgba(120, 60, 150, 0.12), 0 4px 8px rgba(0,0,0,0.06);
      border-color: #d9cde3;
    }

    .card img {
      width: 100%;
      height: 220px;
      object-fit: cover;
      object-position: top;
      display: block;
      background: #f5f3f7;
    }

    .card-info {
      padding: 0.7rem 1rem;
      font-size: 0.75rem;
      color: #8a7a9a;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #f5f2f8;
    }

    .card-info span:first-child { font-weight: 500; color: #5a4a6a; }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(30, 20, 40, 0.92);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 1000;
      cursor: zoom-out;
      overflow: auto;
    }

    .lightbox.open { display: flex; align-items: flex-start; justify-content: center; }

    .lightbox img {
      max-width: 95%;
      margin: 2rem auto;
      display: block;
      border-radius: 8px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
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

    .empty {
      text-align: center;
      color: #a898b8;
      padding: 4rem 2rem;
      font-size: 0.95rem;
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
      .content { padding: 1rem; }
      .grid { grid-template-columns: 1fr; }
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
      <div class="filter-row" data-filter="date">
        <span class="filter-label">Datum</span>
        <div class="filter-chips" id="filter-date"></div>
      </div>
      <div class="filter-row" data-filter="cluster">
        <span class="filter-label">Cluster</span>
        <div class="filter-chips" id="filter-cluster"></div>
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
      return `<div class="website-section${i === 0 ? ' active' : ''}" data-site="${website}">
      ${Object.entries(dates).map(([date, files]) => `<div class="date-group" data-date="${date}">
        <div class="date-header">${date}</div>
        <div class="grid">
          ${files.map(f => {
            const tIdx = f.filename.indexOf('T');
            const timePart = tIdx > -1 ? f.filename.slice(tIdx+1, tIdx+9) : '';
            const timeStr = timePart.length === 8 ? timePart.replace(/-/g, ':') : '';
            const sizeKB = Math.round((f.size || 0) / 1024);
            const imgUrl = baseUrl+'/'+f.key;
            // Alleen images van eerste sectie + eerste datum laden, rest via data-src
            const shouldLoad = i === 0 && date === dateKeys[0];
            const srcAttr = shouldLoad ? 'src="'+imgUrl+'"' : '';
            return '<div class="card" data-url="'+imgUrl+'">'
            +'<img '+srcAttr+' data-src="'+imgUrl+'" loading="lazy" alt="'+f.filename+'">'
            +'<div class="card-info"><span>'+timeStr+'</span><span>'+sizeKB+' KB</span></div>'
            +'</div>';
          }).join('\n          ')}
        </div>
      </div>`).join('\n      ')}
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
    <span class="lightbox-close">&times;</span>
    <img src="" alt="Screenshot">
  </div>

  <script>
    const meta = ${metaJSON};
    const allDates = ${datesJSON};

    // Standaard de meest recente datum selecteren
    const filterState = { cluster: null, date: allDates[0] || null };

    // Bouw cluster-chips dynamisch uit metadata
    const filterKeys = ['cluster'];

    function getUniqueValues(key) {
      const vals = new Set();
      Object.values(meta).forEach(m => { if (m[key]) vals.add(m[key]); });
      return [...vals].sort();
    }

    filterKeys.forEach(key => {
      const container = document.getElementById('filter-' + key);
      getUniqueValues(key).forEach(val => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        chip.textContent = val;
        chip.dataset.value = val;
        chip.addEventListener('click', () => toggleFilter(key, val, chip));
        container.appendChild(chip);
      });
    });

    // Bouw datum-chips (nieuwste eerst, standaard meest recente actief)
    (function buildDateChips() {
      const container = document.getElementById('filter-date');
      allDates.forEach((date, i) => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip' + (i === 0 ? ' active' : '');
        chip.textContent = date;
        chip.dataset.value = date;
        chip.addEventListener('click', () => {
          container.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          filterState.date = date;
          applyFilters();
        });
        container.appendChild(chip);
      });
    })();

    function toggleFilter(key, val, chip) {
      if (filterState[key] === val) {
        filterState[key] = null;
        chip.classList.remove('active');
      } else {
        chip.parentElement.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        filterState[key] = val;
        chip.classList.add('active');
      }
      applyFilters();
    }

    function applyFilters() {
      // Filter tabs op cluster
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
        return; // activateTab roept applyFilters indirect aan via loadSection
      }

      // Filter date-groups en cards in de actieve sectie
      loadSection();
    }

    function loadSection() {
      const activeSection = document.querySelector('.website-section.active');
      if (!activeSection) return;

      // Filter date-groups op datum
      activeSection.querySelectorAll('.date-group').forEach(group => {
        const date = group.dataset.date;
        const dateVisible = !filterState.date || date === filterState.date;
        group.style.display = dateVisible ? '' : 'none';

        // Laad/ontlaad images op basis van datum-zichtbaarheid
        group.querySelectorAll('.card').forEach(card => {
          card.style.display = dateVisible ? '' : 'none';
          const img = card.querySelector('img');
          if (img) {
            if (dateVisible && !img.src && img.dataset.src) {
              img.src = img.dataset.src;
            } else if (!dateVisible && img.src) {
              img.removeAttribute('src');
            }
          }
        });
      });
    }

    // Pas initieel filter toe
    applyFilters();

    // Tabs
    function activateTab(tab) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.website-section').forEach(s => {
        s.classList.remove('active');
        // Ontlaad images van verborgen secties om geheugen te besparen
        s.querySelectorAll('.card img[src]').forEach(img => img.removeAttribute('src'));
      });
      tab.classList.add('active');
      const section = document.querySelector('.website-section[data-site="' + tab.dataset.site + '"]');
      if (section) {
        section.classList.add('active');
        // Verberg filterbar bij schema-tab, toon hem bij normale tabs
        const filterBar = document.querySelector('.filter-bar');
        if (filterBar) filterBar.style.display = tab.dataset.site === '__schema__' ? 'none' : '';
        if (tab.dataset.site !== '__schema__') loadSection();
      }
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => activateTab(tab));
    });

    // Lightbox
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = lightbox.querySelector('img');

    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('click', () => {
        lightboxImg.src = card.dataset.url;
        lightbox.classList.add('open');
      });
    });

    lightbox.addEventListener('click', () => {
      lightbox.classList.remove('open');
      lightboxImg.src = '';
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        lightbox.classList.remove('open');
        lightboxImg.src = '';
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

  console.log('Uploading index.html...');
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'index.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
  }));

  console.log(`Viewer uploaded to: ${publicUrl}/index.html`);
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
