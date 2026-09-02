import { PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { createR2Client } from './r2-client.js';

const SCREENSHOTS_DIR = './screenshots';
const UPLOAD_CONCURRENCY = 6;

async function uploadFile(client, bucketName, filepath, key) {
  const filename = basename(filepath);
  const body = readFileSync(filepath);

  console.log(`📤 Uploading ${filename} (${Math.round(body.length / 1024)} KB) → ${key}`);

  const contentType = filename.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  console.log(`✅ Uploaded: ${filename}`);
}

// Verwerk uploads in parallelle batches
async function uploadInBatches(tasks, concurrency) {
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(t => t.fn()));

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        console.error(`❌ Upload failed: ${result.reason?.message}`);
        failCount++;
      }
    }
  }

  return { successCount, failCount };
}

async function main() {
  console.log('\n☁️  Cloudflare R2 Upload\n');
  console.log('='.repeat(50));

  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    console.error('❌ R2_BUCKET_NAME not set');
    process.exit(1);
  }
  console.log(`🪣 Target bucket: ${bucketName}`);

  const client = createR2Client();

  // Get all screenshots
  const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.webp') || f.endsWith('.jpg'));

  if (files.length === 0) {
    console.log('⚠️  No screenshots found in', SCREENSHOTS_DIR);
    return;
  }

  const thumbCount = files.filter(f => f.endsWith('.thumb.webp')).length;
  console.log(`📸 Found ${files.length - thumbCount} screenshot(s) + ${thumbCount} miniatuur(en) to upload`);
  console.log(`⚡ Upload concurrency: ${UPLOAD_CONCURRENCY}\n`);

  // Datum voor subfolders
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });

  // Bouw upload-taken, filter lege bestanden in één keer (één statSync per bestand)
  const tasks = [];
  for (const file of files) {
    const filepath = join(SCREENSHOTS_DIR, file);
    const fileSize = statSync(filepath).size;

    if (fileSize === 0) {
      console.log(`⚠️  Skipping empty file: ${file}`);
      continue;
    }

    const websiteName = file.split('_')[0];
    const key = `${websiteName}/${today}/${file}`;
    tasks.push({ fn: () => uploadFile(client, bucketName, filepath, key) });
  }

  const { successCount, failCount } = await uploadInBatches(tasks, UPLOAD_CONCURRENCY);

  console.log('\n' + '='.repeat(50));
  console.log(`✨ Upload complete: ${successCount} successful, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
