import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { createR2Client, listAllObjects } from './r2-client.js';

// Aantal dagen waarna screenshots verwijderd worden
const RETENTION_DAYS = 182; // 26 weken

// Vanaf deze leeftijd is het niet meer nodig om elke 30/60 min een screenshot te bewaren:
// dan volstaat 1 screenshot per THINNING_INTERVAL_HOURS uur (per website/dag/variant)
const THINNING_AFTER_DAYS = 15;
const THINNING_INTERVAL_HOURS = 3;

function getDateFromKey(key) {
  // Verwachte structuur: website/datum/bestand.webp (bv. hln/2026-02-05/hln_2026-02-05T10-00-00.webp)
  const parts = key.split('/');
  if (parts.length < 2) return null;

  const dateStr = parts[1]; // bv. "2026-02-05"
  const parsed = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(parsed.getTime())) return null;

  return parsed;
}

// Parseert website/datum/naam_YYYY-MM-DDTHH-MM-SS[_mobile].ext
// Retourneert een groep-sleutel (per website/datum/variant) en het tijdstip van de opname
function parseKeyInfo(key) {
  const parts = key.split('/');
  if (parts.length < 3) return null;

  const match = parts[2].match(/^(.+?)_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(_mobile)?\.\w+$/);
  if (!match) return null;

  const [, namePrefix, dateStr, hh, mm, ss, mobileSuffix] = match;
  const dateTime = new Date(`${dateStr}T${hh}:${mm}:${ss}Z`);
  if (isNaN(dateTime.getTime())) return null;

  return {
    groupKey: `${parts[0]}/${parts[1]}/${namePrefix}${mobileSuffix || ''}`,
    dateTime,
  };
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

  // Thinning: voor screenshots ouder dan THINNING_AFTER_DAYS volstaat 1 opname
  // per THINNING_INTERVAL_HOURS uur (per website/dag/variant) — overtollige tussentijdse
  // opnames (elke 30/60 min) worden verwijderd.
  const thinningCutoff = new Date(now);
  thinningCutoff.setDate(thinningCutoff.getDate() - THINNING_AFTER_DAYS);
  thinningCutoff.setHours(0, 0, 0, 0);

  console.log(`📅 Thinning cutoff: ${thinningCutoff.toISOString().split('T')[0]}`);
  console.log(`   Objects older than this date are thinned to 1 per ${THINNING_INTERVAL_HOURS}u\n`);

  const keptAfterThinning = [];
  const thinningGroups = new Map();

  for (const key of toKeep) {
    const objectDate = getDateFromKey(key);
    if (!objectDate || objectDate >= thinningCutoff) {
      keptAfterThinning.push(key);
      continue;
    }

    const info = parseKeyInfo(key);
    if (!info) {
      // Kan geen tijdstip bepalen, behouden
      keptAfterThinning.push(key);
      continue;
    }

    if (!thinningGroups.has(info.groupKey)) thinningGroups.set(info.groupKey, []);
    thinningGroups.get(info.groupKey).push({ key, dateTime: info.dateTime });
  }

  for (const items of thinningGroups.values()) {
    items.sort((a, b) => a.dateTime - b.dateTime);
    const seenBuckets = new Set();
    for (const item of items) {
      const bucket = Math.floor(item.dateTime.getUTCHours() / THINNING_INTERVAL_HOURS);
      if (seenBuckets.has(bucket)) {
        toDelete.push(item.key);
      } else {
        seenBuckets.add(bucket);
        keptAfterThinning.push(item.key);
      }
    }
  }

  toKeep.length = 0;
  toKeep.push(...keptAfterThinning);

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
  console.log(`🗑️  Dates affected (verwijdering en/of thinning): ${[...deleteDates].sort().join(', ')}\n`);

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
