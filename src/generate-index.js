import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

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
    // Verwacht: website/datum/bestand.jpg
    if (parts.length !== 3 || !parts[2].endsWith('.jpg')) continue;

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

  // Sorteer datums nieuwste eerst
  for (const website of Object.keys(structure)) {
    const sorted = {};
    for (const date of Object.keys(structure[website]).sort().reverse()) {
      sorted[date] = structure[website][date];
    }
    structure[website] = sorted;
  }

  return structure;
}

function generateHTML(structure, publicUrl) {
  const websites = Object.keys(structure).sort();
  const baseUrl = publicUrl.replace(/\/$/, '');

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

    .tabs {
      display: flex;
      gap: 0.4rem;
      padding: 0.8rem 2rem;
      background: #fff;
      border-bottom: 1px solid #ece8f0;
      overflow-x: auto;
      position: sticky;
      top: 68px;
      z-index: 99;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
    }

    .tabs::-webkit-scrollbar { height: 0; }

    .tab {
      padding: 0.45rem 1.1rem;
      border: 1.5px solid transparent;
      border-radius: 2rem;
      background: #f3eff6;
      color: #5a4a6a;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.82rem;
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

    @media (max-width: 600px) {
      header { padding: 1rem; }
      .header-inner { flex-direction: column; align-items: flex-start; gap: 0.2rem; }
      .tabs { padding: 0.6rem 1rem; top: 56px; }
      .content { padding: 1rem; }
      .grid { grid-template-columns: 1fr; }
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

  <div class="tabs">
    ${websites.map((w, i) => `<button class="tab${i === 0 ? ' active' : ''}" data-site="${w}">${w}</button>`).join('\n    ')}
  </div>

  <div class="content">
    ${websites.length === 0 ? '<div class="empty">Nog geen screenshots gevonden.</div>' : ''}
    ${websites.map((website, i) => {
      const dates = structure[website];
      return `<div class="website-section${i === 0 ? ' active' : ''}" data-site="${website}">
      ${Object.entries(dates).map(([date, files]) => `<div class="date-group">
        <div class="date-header">${date}</div>
        <div class="grid">
          ${files.map(f => {
            const time = f.filename.match(/T(\d{2})-(\d{2})-(\d{2})/);
            const timeStr = time ? `${time[1]}:${time[2]}:${time[3]}` : '';
            const sizeKB = Math.round((f.size || 0) / 1024);
            return `<div class="card" data-url="${baseUrl}/${f.key}">
            <img src="${baseUrl}/${f.key}" loading="lazy" alt="${f.filename}">
            <div class="card-info"><span>${timeStr}</span><span>${sizeKB} KB</span></div>
          </div>`;
          }).join('\n          ')}
        </div>
      </div>`).join('\n      ')}
    </div>`;
    }).join('\n    ')}
  </div>

  <div class="lightbox" id="lightbox">
    <span class="lightbox-close">&times;</span>
    <img src="" alt="Screenshot">
  </div>

  <script>
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.website-section').forEach(s => s.classList.remove('active'));
        tab.classList.add('active');
        const section = document.querySelector('.website-section[data-site="' + tab.dataset.site + '"]');
        if (section) section.classList.add('active');
      });
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
  console.log('\n📄 Generating screenshot viewer\n');
  console.log('='.repeat(50));

  const bucketName = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucketName) {
    console.error('❌ R2_BUCKET_NAME not set');
    process.exit(1);
  }

  if (!publicUrl) {
    console.error('❌ R2_PUBLIC_URL not set — enable public access on your R2 bucket and add the URL as secret');
    process.exit(1);
  }

  const client = createR2Client();

  console.log('📋 Listing all objects in bucket...');
  const objects = await listAllObjects(client, bucketName);
  console.log(`   Found ${objects.length} object(s)`);

  const structure = buildStructure(objects);
  const websiteCount = Object.keys(structure).length;
  console.log(`   ${websiteCount} website(s) with screenshots\n`);

  const html = generateHTML(structure, publicUrl);

  console.log('📤 Uploading index.html...');
  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: 'index.html',
    Body: html,
    ContentType: 'text/html; charset=utf-8',
  }));

  console.log(`✅ Viewer uploaded to: ${publicUrl}/index.html`);
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
