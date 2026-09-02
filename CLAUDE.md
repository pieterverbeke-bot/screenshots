# CLAUDE.md — Website Screenshot Monitor

## Project Overview

Automated website screenshot monitoring system that captures full-page desktop screenshots of Belgian/Dutch news and media websites, uploads them to Cloudflare R2, and serves them via a Cloudflare Worker with optional Google login restricted to the persgroep.net domain. Triggered hourly via cron-job.org (external) or GitHub Actions workflow dispatch.

## Repository Structure

```
screenshots/
├── src/
│   ├── take-screenshots.js   # Puppeteer screenshot capture (main entrypoint)
│   ├── upload-to-r2.js       # Batch upload screenshots to Cloudflare R2
│   ├── cleanup-r2.js         # Delete R2 objects older than retention period
│   ├── generate-index.js     # Build and upload index.html viewer to R2
│   ├── generate-thumbs-r2.js # One-off backfill of thumbnails for existing R2 objects
│   └── r2-client.js          # Shared R2/S3 client factory + listAllObjects helper
├── worker/
│   ├── src/index.js          # Cloudflare Worker: auth + R2 proxy
│   └── wrangler.toml         # Wrangler config (R2 binding, worker name)
├── .github/
│   └── workflows/
│       ├── screenshot.yml    # GitHub Actions workflow (workflow_dispatch only)
│       └── thumbnails.yml    # Manual thumbnail backfill (workflow_dispatch only)
├── websites.json             # List of websites to screenshot
├── get-refresh-token.js      # One-time helper for Google Drive OAuth (unused in main flow)
└── package.json              # ESM project, Node 20+
```

## Key Conventions

### Module System
- All source files use **ES modules** (`"type": "module"` in package.json). Use `import`/`export`, not `require()`.
- Path resolution uses `import.meta.url` + `fileURLToPath` instead of `__dirname`.

### Language
- Comments, console output, and variable names are in **Dutch** (Belgian/Dutch project). Keep new code consistent with existing Dutch comments and log messages.

### Screenshot Pipeline (GitHub Actions)
The workflow runs these steps sequentially:
1. `node src/take-screenshots.js` — capture screenshots to local `screenshots/` dir
2. `node src/upload-to-r2.js` — upload all `.webp`/`.jpg` to R2 under `{website}/{date}/{filename}`
3. `node src/cleanup-r2.js & node src/generate-index.js & wait` — cleanup old objects and regenerate `index.html` in parallel

### R2 Object Key Structure
```
{websiteName}/{YYYY-MM-DD}/{websiteName}_{timestamp}.webp        # volledig screenshot
{websiteName}/{YYYY-MM-DD}/{websiteName}_{timestamp}.thumb.webp  # miniatuur (tijdlijn)
```
Example: `hln/2026-03-05/hln_2026-03-05T10-00-00.webp`

- Elke opname heeft een miniatuur van 200x130px (~5 KB) naast het volledige beeld.
  De viewer laadt die in de tijdlijn; ontbreekt de miniatuur (oudere opnames), dan
  valt hij terug op het volledige screenshot. `cleanup-r2.js` verwijdert een miniatuur
  samen met zijn bronscreenshot — miniaturen worden nooit apart uitgedund
- `index.html` at the bucket root is the viewer page (excluded from cleanup)
- Images get `cache-control: public, max-age=31536000, immutable` (timestamp in filename = immutable)
- `index.html` gets `cache-control: public, max-age=300, s-maxage=60`

### Screenshot Configuration (`src/take-screenshots.js`)
Key constants in the `CONFIG` object:
- `desktopViewport`: 1366×768px
- `webpQuality`: 70 (WebP quality, 0–100)
- `resizeWidth`: 960px (resize after capture via sharp)
- `maxHeight`: 8000px (cap on full-page height)
- `concurrency`: 3 (parallel browser tabs, tuned for GitHub Actions 2-core runners)
- `minFileSizeKB`: 10 (screenshots below this threshold are treated as blank/failed)
- `thumbWidth`/`thumbHeight`/`thumbQuality`: 200x130px, kwaliteit 60 (miniatuur voor de tijdlijn)
- `timezone`: `Europe/Brussels` (all timestamps use Belgian time)

### websites.json Schema
Each entry has:
```json
{
  "name": "hln",          // Used as R2 folder prefix and filename prefix
  "label": "HLN",         // Display name in the viewer
  "url": "https://...",   // Full URL to screenshot
  "land": "België",       // Country
  "medium": "nieuwsmedia",// Media type
  "cluster": "België",    // Grouping in viewer
  "interval": 30          // Screenshot interval in minutes (30 or 60)
}
```
- `name` must be **lowercase, URL-safe** (used in filenames and R2 keys)
- `interval: 30` means "every run"; `interval: 60` means "every other run" (skipped in odd-numbered runs)

### Concurrency Patterns
- Screenshot capture: `concurrency: 3` parallel Puppeteer tabs via manual batching
- R2 uploads: `UPLOAD_CONCURRENCY = 6` via `Promise.allSettled` batches
- Cleanup + index generation: run in parallel with `&` in shell

### Error Handling
- Scripts call `process.exit(1)` on fatal errors or if any upload fails
- Screenshots below `minFileSizeKB` are skipped (blank page detection)
- `cleanup-r2.js`: objects with unparseable date paths are kept (safe default)

## Required GitHub Secrets

| Secret | Description |
|--------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare Account ID |
| `R2_ACCESS_KEY_ID` | R2 API token Access Key |
| `R2_SECRET_ACCESS_KEY` | R2 API token Secret Key |
| `R2_BUCKET_NAME` | R2 bucket name (e.g. `screenshots`) |
| `R2_PUBLIC_URL` | Public R2 URL (e.g. `https://pub-xxx.r2.dev`) — used by generate-index.js |

## Cloudflare Worker

Located in `worker/`. Deployed separately from the main workflow.

- Acts as a **proxy** for the R2 bucket with optional **Google login (OAuth/OIDC)**
- Access is restricted to verified Google accounts on the `persgroep.net` domain (`ALLOWED_DOMAIN` in `worker/src/index.js`)
- OAuth uses the authorization code flow with PKCE; on success an HMAC-signed session cookie (HttpOnly) is set, living 30 days
- Requires three secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` (via `npx wrangler secret put ...`); if any is missing, the viewer is public
- Afmelden gebeurt via `/logout` (of `/afmelden`): beide cookies worden gewist en de
  loginpagina toont "Je bent afgemeld". De viewer bevat daarvoor een verborgen blok
  `#account-slot`; de Worker vult het e-mailadres in en maakt het zichtbaar
- Afbeeldingen worden in de edge-cache (`caches.default`) bewaard, zodat herhaalde
  bezoeken niet telkens R2 aanspreken
- Google Cloud Console: create a "Web application" OAuth client with redirect URI `https://<worker-domain>/auth/callback`
- Deploy: `npm run deploy-worker` (runs `cd worker && npx wrangler deploy`)
- R2 binding name in wrangler.toml: `SCREENSHOTS_BUCKET`

## Development Workflow

### Running Locally
```bash
npm ci
# Requires R2 env vars to be set
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET_NAME=... \
  node src/take-screenshots.js
```
Screenshots are saved to `screenshots/` (gitignored).

### Adding Websites
Edit `websites.json` — add a new object following the schema above. The `name` field becomes the R2 folder and filename prefix.

### Adjusting Retention
Change `RETENTION_DAYS` in `src/cleanup-r2.js` (currently 15 days).

### Backfilling Thumbnails
Nieuwe screenshots krijgen hun miniatuur automatisch. Voor bestaande R2-objecten:
```bash
npm run thumbs -- --days 30   # of --days 0 voor alles, --dry-run om te tellen
```
Kan ook via GitHub Actions → "Miniaturen bijwerken" (workflow_dispatch).

### Triggering the Workflow
- **Primary**: cron-job.org POSTs to the GitHub API `workflow_dispatch` endpoint every hour
- **Fallback**: Manual trigger via GitHub Actions UI ("Run workflow")
- The workflow YAML has no `schedule:` — it is `workflow_dispatch`-only

## Important Notes

- Do **not** add a `schedule:` trigger back to the workflow — cron-job.org is the reliable scheduler
- Chrome draait **headed onder xvfb** in de workflow (`xvfb-run` in screenshot.yml; `take-screenshots.js` detecteert `DISPLAY`). Dit vermijdt de headless-fingerprint waarop Cloudflare/Akamai GitHub-runners blokkeren (Nieuwsblad/GvA/VRT-blocks, geblokkeerde CSS/afbeeldingen). Niet terugzetten naar pure headless zonder hertest
- `installConsentKiller` injecteert op document-start een permanente Sourcepoint-verberger (CSS + inline `!important`) én een in-page auto-clicker die de DPG privacy gate ("Jouw privacy-instellingen") accepteert zodra die verschijnt — ook ná alle Node-consent-passes (De Morgen, Humo). Bot-blokpagina's en ongestylede pagina's (CSS geblokkeerd) gooien `blocked page` en triggeren een retry
- The `screenshots/` directory is gitignored — never commit local screenshots
- `get-refresh-token.js` is a legacy helper for Google Drive OAuth; Google Drive upload is no longer part of the active pipeline
- The viewer (`index.html`) is generated client-side from a JSON data blob embedded in the HTML; it supports filtering by cluster, website, and date range
- Die JSON-blob bewaart per website/datum enkel het tijdstip (`HH-MM-SS`) van elke opname;
  de client bouwt de bestandsnaam op in `decodeEntry()`. Een `*`-prefix betekent
  "miniatuur beschikbaar", een `!`-prefix "letterlijke bestandsnaam" (afwijkend patroon).
  Wijzigt het bestandsnaampatroon, pas dan `encodeEntry()` én `decodeEntry()` samen aan
- De viewer laadt bewust getemperd: miniaturen via `IntersectionObserver`, volledige
  screenshots zonder miniatuur met maximaal 2 tegelijk, en de peek-/preload-beelden pas
  nadat de hero geladen is. Zo krijgt het zichtbare beeld voorrang op de rest
- Het RI&G-merkteken staat als inline SVG in `src/generate-index.js` (`RIG_LOGO_SVG`) én in
  `worker/src/index.js`; het dient ook als favicon via een data-URI. Pas je het aan, doe dat
  dan op beide plekken
- Mobile screenshots are filtered out in `generate-index.js` (legacy `_mobile.` suffix check)

## Lazy Loading & Image Loading Strategy (`src/take-screenshots.js`)

De screenshot-tool gebruikt een multi-pass strategie om lazy-loaded afbeeldingen te forceren:

### IntersectionObserver Override
- `evaluateOnNewDocument` overschrijft `window.IntersectionObserver` zodat alle entries `isIntersecting=true` rapporteren
- **Belangrijk**: `observe()` triggert de callback ook onmiddellijk via `setTimeout(0)`, zodat frameworks (VRT NWS, DPG Media) direct het "zichtbaar"-signaal krijgen — zelfs als de browser de IO-callback zou uitstellen voor elementen buiten de viewport
- Dit is de primaire fix voor het laden van hero-afbeeldingen op VRT en Nieuwsblad

### Synthetische Events
- `dispatchVisibilityEvents()` dispatcht `scroll`, `resize`, `scrollend` en `visibilitychange` events op window/document
- Zet `document.visibilityState` op `'visible'` voor frameworks die laden uitstellen tot de pagina zichtbaar is
- Wordt aangeroepen na elke `forceLoadLazyImages()` pass

### Force-Load Lazy Images (multi-pass)
1. `data-src` / `data-srcset` / `data-lazy-src` → echte `src`/`srcset`
2. `loading="lazy"` → `loading="eager"`
3. VRT-specifiek: `<noscript>` extractie
4. `<picture>` fallback: verwijdert niet-matchende `media`-attributen van `<source>` en wijst eerste geldige URL direct toe aan `<img>`
5. Shadow DOM traversal: zoekt afbeeldingen in Web Component shadow roots
6. `content-visibility: auto/hidden` → `visible` op parent-containers

### Post-Consent Wachttijd
- Na consent-afhandeling (DPG privacy gate, cookie popups) wordt 2 seconden gewacht
- Gevolgd door een vroege `forceLoadLazyImages()` + `dispatchVisibilityEvents()` pass
- Dit geeft DPG Media frameworks (Nieuwsblad, HLN) tijd om te re-renderen na consent

