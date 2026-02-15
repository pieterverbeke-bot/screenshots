import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const SCREENSHOTS_DIR = './screenshots';

function createR2Client() {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials. Need R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function uploadFile(client, bucketName, filepath, key) {
  const filename = basename(filepath);
  const fileSize = statSync(filepath).size;
  const body = readFileSync(filepath);

  console.log(`📤 Uploading ${filename} (${Math.round(fileSize / 1024)} KB) → ${key}`);

  const contentType = 'image/jpeg';

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  console.log(`✅ Uploaded: ${filename}`);
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
  const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.jpg'));

  if (files.length === 0) {
    console.log('⚠️  No screenshots found in', SCREENSHOTS_DIR);
    return;
  }

  console.log(`📸 Found ${files.length} screenshot(s) to upload\n`);

  // Datum voor subfolders
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' });

  let successCount = 0;
  let failCount = 0;

  for (const file of files) {
    const filepath = join(SCREENSHOTS_DIR, file);

    // Extract website name from filename (e.g., "hln_2024-01-15T10-00-00.jpg" -> "hln")
    const websiteName = file.split('_')[0];

    // Structuur: website/datum/bestand.jpg
    const key = `${websiteName}/${today}/${file}`;

    // Skip lege bestanden (mislukte screenshots)
    const fileSize = statSync(filepath).size;
    if (fileSize === 0) {
      console.log(`⚠️  Skipping empty file: ${file}`);
      continue;
    }

    try {
      await uploadFile(client, bucketName, filepath, key);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to upload ${file}: ${error.message}`);
      failCount++;
    }
  }

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
