import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createR2Client, listAllObjects } from './r2-client.js';

// Aantal dagen waarna screenshots verwijderd worden
const RETENTION_DAYS = 182; // 26 weken

function getDateFromKey(key) {
  // Verwachte structuur: website/datum/bestand.webp (bv. hln/2026-02-05/hln_2026-02-05T10-00-00.webp)
  const parts = key.split('/');
  if (parts.length < 2) return null;

  const dateStr = parts[1]; // bv. "2026-02-05"
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) return null;

  return parsed;
}

async function deleteObjects(client, bucketName, keys) {
  // DeleteObjects ondersteunt max 1000 objecten per keer
  const batchSize = 1000;
  let totalDeleted = 0;

  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize);

    await client.send(new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: batch.map(key => ({ Key: key })),
        Quiet: true,
      },
    }));

    totalDeleted += batch.length;
    console.log(`   Deleted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} object(s)`);
  }

  return totalDeleted;
}

async function main() {
  console.log('\n🧹 Cloudflare R2 Cleanup\n');
  console.log('='.repeat(50));

  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) {
    console.error('R2_BUCKET_NAME not set');
    process.exit(1);
  }

  console.log(`🪣 Bucket: ${bucketName}`);
  console.log(`📅 Retention: ${RETENTION_DAYS} days\n`);

  const client = createR2Client();

  // Bereken cutoff datum
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  cutoff.setHours(0, 0, 0, 0);

  console.log(`📅 Cutoff date: ${cutoff.toISOString().split('T')[0]}`);
  console.log(`   Objects older than ${cutoff.toISOString().split('T')[0]} will be deleted\n`);

  // Lijst alle objecten
  console.log('Listing all objects in bucket...');
  const objects = await listAllObjects(client, bucketName);
  console.log(`   Found ${objects.length} total object(s)\n`);

  // Filter objecten ouder dan de cutoff datum
  const toDelete = [];
  const toKeep = [];

  for (const obj of objects) {
    // Sla index.html over
    if (obj.Key === 'index.html') {
      toKeep.push(obj.Key);
      continue;
    }

    const objectDate = getDateFromKey(obj.Key);
    if (!objectDate) {
      // Kan datum niet bepalen, behouden
      toKeep.push(obj.Key);
      continue;
    }

    if (objectDate < cutoff) {
      toDelete.push(obj.Key);
    } else {
      toKeep.push(obj.Key);
    }
  }

  console.log(`📊 Results:`);
  console.log(`   To keep:   ${toKeep.length} object(s)`);
  console.log(`   To delete: ${toDelete.length} object(s)\n`);

  if (toDelete.length === 0) {
    console.log('✅ Nothing to clean up - no objects older than the retention period.');
    return;
  }

  // Toon welke datums verwijderd worden
  const deleteDates = new Set();
  for (const key of toDelete) {
    const parts = key.split('/');
    if (parts.length >= 2) deleteDates.add(parts[1]);
  }
  console.log(`🗑️  Dates to remove: ${[...deleteDates].sort().join(', ')}\n`);

  // Verwijder de objecten
  console.log('Deleting old screenshots...');
  const deleted = await deleteObjects(client, bucketName, toDelete);

  console.log(`\n${'='.repeat(50)}`);
  console.log(`✅ Cleanup complete: ${deleted} object(s) deleted`);
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
