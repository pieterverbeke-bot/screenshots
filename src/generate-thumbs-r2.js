import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createR2Client, listAllObjects } from './r2-client.js';

// Eenmalige inhaalslag: maakt miniaturen (`*.thumb.webp`) voor screenshots die
// nog vóór de miniatuur-generatie zijn geüpload. Nieuwe screenshots krijgen hun
// miniatuur meteen in take-screenshots.js, dus dit script is enkel nodig om de
// bestaande geschiedenis sneller te maken.
//
//   node src/generate-thumbs-r2.js               # laatste 30 dagen
//   node src/generate-thumbs-r2.js --days 182    # volledige bewaarperiode
//   node src/generate-thumbs-r2.js --days 0      # alles (zelfde als hierboven)
//   node src/generate-thumbs-r2.js --dry-run     # enkel tellen

const THUMB_SUFFIX = '.thumb.webp';
const THUMB_WIDTH = 200;
const THUMB_HEIGHT = 130;
const THUMB_QUALITY = 60;
const CONCURRENCY = 6;

function parseArgs(argv) {
  const args = { days: 30, limit: 0, dryRun: false };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = parseInt(argv[++i], 10) || 0;
    else if (argv[i] === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (argv[i] === '--dry-run') args.dryRun = true;
  }

  return args;
}

function getDateFromKey(key) {
  const parts = key.split('/');
  if (parts.length !== 3) return null;
  const parsed = new Date(parts[1] + 'T00:00:00Z');
  return isNaN(parsed.getTime()) ? null : parsed;
}

async function makeThumbnail(client, bucketName, key) {
  const object = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const source = Buffer.from(await object.Body.transformToByteArray());

  const thumb = await sharp(source)
    .resize(THUMB_WIDTH, THUMB_HEIGHT, { fit: 'cover', position: 'top' })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key.replace(/\.webp$/, THUMB_SUFFIX),
    Body: thumb,
    ContentType: 'image/webp',
  }));

  return thumb.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log('\n🖼️  Miniaturen genereren voor bestaande screenshots\n');
  console.log('='.repeat(50));

  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    console.error('R2_BUCKET_NAME not set');
    process.exit(1);
  }

  const client = createR2Client();

  console.log('Listing all objects in bucket...');
  const objects = await listAllObjects(client, bucketName);
  console.log(`   Found ${objects.length} object(s)`);

  const existingThumbs = new Set();
  for (const obj of objects) {
    if (obj.Key.endsWith(THUMB_SUFFIX)) existingThumbs.add(obj.Key);
  }

  let cutoff = null;
  if (args.days > 0) {
    cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - args.days);
    cutoff.setHours(0, 0, 0, 0);
    console.log(`📅 Enkel screenshots vanaf ${cutoff.toISOString().split('T')[0]}`);
  } else {
    console.log('📅 Alle screenshots in de bucket');
  }

  const todo = [];
  for (const obj of objects) {
    const key = obj.Key;
    if (!key.endsWith('.webp') || key.endsWith(THUMB_SUFFIX)) continue;
    if (existingThumbs.has(key.replace(/\.webp$/, THUMB_SUFFIX))) continue;

    const date = getDateFromKey(key);
    if (!date) continue;
    if (cutoff && date < cutoff) continue;

    todo.push(key);
  }

  // Nieuwste eerst: die worden het vaakst bekeken
  todo.sort().reverse();
  const selected = args.limit > 0 ? todo.slice(0, args.limit) : todo;

  console.log(`   ${existingThumbs.size} miniatuur(en) bestaan al`);
  console.log(`   ${selected.length} screenshot(s) zonder miniatuur\n`);

  if (selected.length === 0) {
    console.log('✅ Niets te doen — alle screenshots hebben een miniatuur.');
    return;
  }

  if (args.dryRun) {
    console.log('🔍 Dry-run: er wordt niets geschreven.');
    return;
  }

  let done = 0;
  let failed = 0;
  let bytes = 0;

  for (let i = 0; i < selected.length; i += CONCURRENCY) {
    const batch = selected.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(key => makeThumbnail(client, bucketName, key))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        done++;
        bytes += result.value;
      } else {
        failed++;
        console.error(`❌ Mislukt: ${result.reason?.message}`);
      }
    }

    if ((i / CONCURRENCY) % 20 === 0 || i + CONCURRENCY >= selected.length) {
      console.log(`   ${done + failed}/${selected.length} verwerkt (${done} ok, ${failed} mislukt)`);
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✨ Klaar: ${done} miniatuur(en) aangemaakt` +
    (done > 0 ? ` (gemiddeld ${Math.round(bytes / done / 1024)} KB)` : '') +
    (failed > 0 ? `, ${failed} mislukt` : ''));
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
