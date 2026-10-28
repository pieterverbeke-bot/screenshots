import { GetObjectCommand } from '@aws-sdk/client-s3';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createR2Client, listAllObjects } from './r2-client.js';
import { TITELS_SUFFIX } from './titels.js';
import { csvTekst, rijenUitTitels } from './titels-csv.js';

// Zet de titelbestanden (`*.titels.json`, zie titels.js) om naar CSV: één rij per
// artikel per opname. Eén bestand per dag, zodat elk bestand in Excel past (een
// dag is zo'n 100.000 rijen; Excel stopt bij ruim een miljoen).
//
//   node src/export-titels.js                       # laatste 7 dagen, alle sites
//   node src/export-titels.js --days 15 --sites hln,nos
//   node src/export-titels.js --map ./screenshots   # lokale titelbestanden i.p.v. R2
//
// Hetzelfde staat ook, zonder GitHub, als download in de Nieuwsmonitor
// (/homepages/titels); die leest de CSV's per run die upload-to-r2.js schrijft.

const WEBSITES_FILE = new URL('../websites.json', import.meta.url);
const UIT_MAP = './export';
const CONCURRENCY = 12;
const TIJDZONE = 'Europe/Brussels';

function parseArgs(argv) {
  const args = { days: 7, sites: [], map: null, out: UIT_MAP };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--days') args.days = Math.max(1, parseInt(argv[++i], 10) || 7);
    else if (argv[i] === '--sites') args.sites = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--map') args.map = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
  }
  return args;
}

// Vandaag en de dagen ervoor, als YYYY-MM-DD in Brusselse tijd (zoals de mappen in R2)
function laatsteDagen(aantal) {
  const dagen = [];
  for (let i = 0; i < aantal; i++) {
    const d = new Date(Date.now() - i * 86400000);
    dagen.push(d.toLocaleDateString('sv-SE', { timeZone: TIJDZONE }));
  }
  return dagen;
}

async function inBatches(items, n, fn) {
  const uit = [];
  for (let i = 0; i < items.length; i += n) {
    uit.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  }
  return uit;
}

// Geeft per dag de ingelezen titelbestanden terug: Map<datum, data[]>
async function leesUitR2(sites, dagen) {
  const bucketName = process.env.R2_BUCKET_NAME;
  if (!bucketName) throw new Error('R2_BUCKET_NAME not set');
  const client = createR2Client();

  const prefixen = sites.flatMap(site => dagen.map(dag => `${site}/${dag}/`));
  console.log(`🔎 ${prefixen.length} map(pen) doorzoeken (${sites.length} site(s) × ${dagen.length} dag(en))...`);
  const lijsten = await inBatches(prefixen, CONCURRENCY, prefix => listAllObjects(client, bucketName, prefix));
  const keys = lijsten.flat().map(o => o.Key).filter(k => k.endsWith(TITELS_SUFFIX));
  console.log(`📰 ${keys.length} titelbestand(en) gevonden, downloaden...`);

  let mislukt = 0;
  const data = await inBatches(keys, CONCURRENCY, async key => {
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
      return { dag: key.split('/')[1], data: JSON.parse(await object.Body.transformToString()) };
    } catch (error) {
      console.log(`⚠️  ${key} overgeslagen: ${error.message}`);
      mislukt++;
      return null;
    }
  });
  if (mislukt > 0) console.log(`⚠️  ${mislukt} titelbestand(en) konden niet gelezen worden`);
  return groepeerPerDag(data.filter(Boolean));
}

function leesUitMap(map, sites, dagen) {
  const data = readdirSync(map)
    .filter(f => f.endsWith(TITELS_SUFFIX))
    .map(f => JSON.parse(readFileSync(join(map, f), 'utf-8')))
    .filter(d => sites.includes(d.site))
    .map(d => ({ dag: String(d.tijd).split('T')[0], data: d }))
    .filter(({ dag }) => dagen.includes(dag));
  return groepeerPerDag(data);
}

function groepeerPerDag(items) {
  const perDag = new Map();
  for (const { dag, data } of items) {
    if (!perDag.has(dag)) perDag.set(dag, []);
    perDag.get(dag).push(data);
  }
  return perDag;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const websites = JSON.parse(readFileSync(WEBSITES_FILE, 'utf-8'));
  const labels = Object.fromEntries(websites.map(w => [w.name, w.label || w.name]));

  const onbekend = args.sites.filter(s => !labels[s]);
  if (onbekend.length > 0) console.log(`⚠️  Onbekende site(s): ${onbekend.join(', ')}`);
  const sites = args.sites.length > 0 ? args.sites.filter(s => labels[s]) : websites.map(w => w.name);
  const dagen = laatsteDagen(args.days);

  console.log('\n📤 Titels exporteren naar CSV\n');
  console.log('='.repeat(50));
  console.log(`📅 ${dagen[dagen.length - 1]} t/m ${dagen[0]}`);

  const perDag = args.map ? leesUitMap(args.map, sites, dagen) : await leesUitR2(sites, dagen);

  mkdirSync(args.out, { recursive: true });
  let totaal = 0;
  for (const dag of [...perDag.keys()].sort()) {
    const opnames = perDag.get(dag).sort((a, b) => String(a.site).localeCompare(b.site) || String(a.tijd).localeCompare(b.tijd));
    const rijen = opnames.flatMap(d => rijenUitTitels(d, labels[d.site]));
    const csv = csvTekst(rijen);
    const bestand = join(args.out, `titels_${dag}.csv`);
    writeFileSync(bestand, csv);
    totaal += rijen.length;
    console.log(`✅ ${bestand}: ${opnames.length} opname(s), ${rijen.length} rij(en)`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(perDag.size === 0
    ? '⚠️  Geen titelbestanden gevonden in deze periode'
    : `✨ ${totaal} rij(en) in ${perDag.size} bestand(en)`);
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
