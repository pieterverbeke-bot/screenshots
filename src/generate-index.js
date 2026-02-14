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
  <title>Screenshot Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f2f5;
      color: #1a1a2e;
    }

    header {
      background: #1a1a2e;
      color: #fff;
      padding: 1.2rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    }

    header h1 { font-size: 1.3rem; font-weight: 600; }
    header p { font-size: 0.8rem; opacity: 0.6; margin-top: 0.2rem; }

    .tabs {
      display: flex;
      gap: 0.5rem;
      padding: 1rem 2rem;
      background: #fff;
      border-bottom: 1px solid #e0e0e0;
      overflow-x: auto;
      position: sticky;
      top: 60px;
      z-index: 99;
    }

    .tab {
      padding: 0.5rem 1.2rem;
      border: none;
      border-radius: 2rem;
      background: #e8eaf0;
      color: #1a1a2e;
      cursor: pointer;
      font-size: 0.85rem;
      font-weight: 500;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .tab:hover { background: #d0d4e0; }
    .tab.active { background: #1a1a2e; color: #fff; }

    .content { max-width: 1400px; margin: 0 auto; padding: 1.5rem 2rem 3rem; }

    .website-section { display: none; }
    .website-section.active { display: block; }

    .date-group { margin-bottom: 2rem; }

    .date-header {
      font-size: 1rem;
      font-weight: 600;
      color: #555;
      margin-bottom: 0.8rem;
      padding-bottom: 0.4rem;
      border-bottom: 2px solid #e0e0e0;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 1rem;
    }

    .card {
      background: #fff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;
    }

    .card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    }

    .card img {
      width: 100%;
      height: 200px;
      object-fit: cover;
      object-position: top;
      display: block;
      background: #f5f5f5;
    }

    .card-info {
      padding: 0.6rem 0.8rem;
      font-size: 0.75rem;
      color: #888;
      display: flex;
      justify-content: space-between;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.9);
      z-index: 1000;
      cursor: zoom-out;
      overflow: auto;
    }

    .lightbox.open { display: flex; align-items: flex-start; justify-content: center; }

    .lightbox img {
      max-width: 95%;
      margin: 2rem auto;
      display: block;
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
    }

    .empty {
      text-align: center;
      color: #999;
      padding: 3rem;
      font-size: 0.95rem;
    }

    @media (max-width: 600px) {
      header { padding: 1rem; }
      .tabs { padding: 0.8rem 1rem; }
      .content { padding: 1rem; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Screenshot Monitor</h1>
    <p>Laatste update: ${new Date().toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}</p>
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
