# CLAUDE.md — Website Screenshot Monitor

## Project Overview

Automated website screenshot monitoring system that captures full-page desktop screenshots of Belgian/Dutch news and media websites, uploads them to Cloudflare R2, and serves them via a Cloudflare Worker with optional password protection. Triggered hourly via cron-job.org (external) or GitHub Actions workflow dispatch.

## Repository Structure

```
screenshots/
├── src/
│   ├── take-screenshots.js   # Puppeteer screenshot capture (main entrypoint)
│   ├── upload-to-r2.js       # Batch upload screenshots to Cloudflare R2
│   ├── cleanup-r2.js         # Delete R2 objects older than retention period
│   ├── generate-index.js     # Build and upload index.html viewer to R2
│   └── r2-client.js          # Shared R2/S3 client factory + listAllObjects helper
├── worker/
│   ├── src/index.js          # Cloudflare Worker: auth + R2 proxy
│   └── wrangler.toml         # Wrangler config (R2 binding, worker name)
├── .github/
│   └── workflows/
│       └── screenshot.yml    # GitHub Actions workflow (workflow_dispatch only)
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
{websiteName}/{YYYY-MM-DD}/{websiteName}_{timestamp}.webp
```
Example: `hln/2026-03-05/hln_2026-03-05T10-00-00.webp`

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

- Acts as a **proxy** for the R2 bucket with optional **password authentication**
- Auth uses SHA-256 cookie tokens; cookie lives 30 days
- Password is set via `npx wrangler secret put AUTH_PASSWORD` (if not set, viewer is public)
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

### Triggering the Workflow
- **Primary**: cron-job.org POSTs to the GitHub API `workflow_dispatch` endpoint every hour
- **Fallback**: Manual trigger via GitHub Actions UI ("Run workflow")
- The workflow YAML has no `schedule:` — it is `workflow_dispatch`-only

## Important Notes

- Do **not** add a `schedule:` trigger back to the workflow — cron-job.org is the reliable scheduler
- The `screenshots/` directory is gitignored — never commit local screenshots
- `get-refresh-token.js` is a legacy helper for Google Drive OAuth; Google Drive upload is no longer part of the active pipeline
- The viewer (`index.html`) is generated client-side from a JSON data blob embedded in the HTML; it supports filtering by cluster, website, and date range
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

