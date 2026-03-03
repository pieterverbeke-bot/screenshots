# CLAUDE.md — Website Screenshot Monitor

This document describes the codebase structure, development conventions, and key workflows for AI assistants working on this repository.

## Project Overview

This is a **website screenshot monitoring tool** that automatically captures full-page screenshots of Dutch and Belgian news websites and magazines. Screenshots are taken via Puppeteer on GitHub Actions, stored in Cloudflare R2 object storage, and served through a Cloudflare Worker with optional password protection.

**Tech stack:**
- Node.js (ESM modules, `"type": "module"` in `package.json`)
- Puppeteer + Sharp for screenshot capture and image processing
- AWS SDK v3 (`@aws-sdk/client-s3`) for Cloudflare R2 (S3-compatible API)
- Cloudflare Workers for the viewer/proxy
- GitHub Actions for CI/CD orchestration

---

## Repository Structure

```
.
├── src/                        # Core Node.js scripts (run in GitHub Actions)
│   ├── take-screenshots.js     # Main screenshot capture logic (Puppeteer)
│   ├── upload-to-r2.js         # Upload local screenshots/ dir to Cloudflare R2
│   ├── cleanup-r2.js           # Delete R2 objects older than retention period
│   ├── generate-index.js       # Build and upload index.html viewer to R2
│   └── r2-client.js            # Shared R2 client factory + listAllObjects helper
├── worker/
│   ├── src/index.js            # Cloudflare Worker: auth gate + R2 proxy
│   └── wrangler.toml           # Wrangler config (R2 bucket binding, compatibility)
├── websites.json               # List of websites to screenshot with metadata
├── get-refresh-token.js        # One-time OAuth helper (Google Drive, legacy)
├── .github/workflows/
│   └── screenshot.yml          # GitHub Actions workflow definition
└── package.json                # Project metadata and npm scripts
```

---

## Key Files in Detail

### `websites.json`

Defines the list of websites to monitor. Each entry is an object:

```json
{
  "name": "hln",          // Short identifier (used in filenames and R2 paths)
  "label": "HLN",         // Display label for the viewer UI
  "url": "https://www.hln.be",
  "land": "België",       // Country: "België" or "Nederland"
  "medium": "nieuwsmedia",// Category: "nieuwsmedia" or "Magazines"
  "cluster": "België",    // Grouping used in the viewer UI
  "interval": 30          // Screenshot frequency in minutes (30, 60, 180, ...)
}
```

**`interval` determines scheduling:**
- `30` → captured every half-hour run AND every full-hour run
- `60` → captured only on full-hour runs
- `180` → captured every 3 hours (only when `hour % 3 === 0`)

The workflow runs on demand (triggered by cron-job.org). The script itself reads the current Brussels-timezone time to decide which sites to include based on their `interval`.

### `src/take-screenshots.js`

The main script. Key constants in the `CONFIG` object at the top:

| Key | Value | Purpose |
|-----|-------|---------|
| `desktopViewport` | 1366×768 | Browser viewport size |
| `fullPage` | `true` | Capture entire page height |
| `timeout` | 60000ms | Page load timeout |
| `scrollDelay` | 350ms | Delay between scroll steps |
| `waitAfterScroll` | 2500ms | Wait after full scroll for lazy images |
| `webpQuality` | 30 | WebP compression quality (0–100) |
| `resizeWidth` | 960px | Output width after resize |
| `maxHeight` | 8000px | Maximum captured height |
| `timezone` | `Europe/Brussels` | Timestamp timezone (GMT+1/GMT+2) |
| `concurrency` | 3 | Sites processed in parallel per batch |

**Key functions:**
- `getLocalTimestamp()` — produces `YYYY-MM-DDTHH-MM-SS` in Brussels time
- `autoScroll(page)` — scrolls to bottom to trigger lazy-load, then back to top
- `forceLoadLazyImages(page)` — swaps `data-src`/`data-lazy-src` into `src` attributes
- `waitForImages(page)` — waits for `<img>` decode to complete
- `removeBlurEffects(page)` — removes CSS blur/paywall obfuscation
- `scrollImagesToLoad(page)` — scrolls each unloaded image into view individually
- `handleCloudflareChallenge(page)` — detects and waits past Cloudflare bot checks
- `handleDPGPrivacyGate(page)` — clicks through DPG Media's consent/privacy pages
- `dismissPopups(page)` — multi-round popup/consent banner dismissal
- `removeRemainingOverlays(page)` — DOM removal of stubborn popups as last resort
- `loadAndPrepare(page, website)` — full preparation pipeline (load → consent → scroll → images)
- `capturePage(browser, website, timestamp)` — opens page tab and runs full pipeline
- `processInBatches(browser, websites, concurrency)` — runs captures in parallel batches
- `main()` — entry point: filters sites by interval, launches browser, processes all sites

**Output format:** `screenshots/{name}_{YYYY-MM-DDTHH-MM-SS}.webp` locally, then uploaded to R2 as `{name}/{YYYY-MM-DD}/{name}_{YYYY-MM-DDTHH-MM-SS}.webp`.

### `src/r2-client.js`

Shared module exporting:
- `createR2Client()` — builds an `S3Client` pointed at `https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
- `listAllObjects(client, bucketName)` — paginates through all R2 objects

Always import from this module rather than constructing an `S3Client` directly.

### `src/upload-to-r2.js`

Reads `./screenshots/*.webp` (and `.jpg`) and uploads them to R2 with concurrency 6. Key path logic:
```
{websiteName}/{today}/{filename}
// websiteName = filename.split('_')[0]
// today = new Date() in Europe/Brussels, formatted as YYYY-MM-DD
```

### `src/cleanup-r2.js`

Deletes R2 objects older than `RETENTION_DAYS` (currently 15). Parses date from the R2 key path (`website/YYYY-MM-DD/filename`). Always preserves `index.html`.

### `src/generate-index.js`

Generates a single-file HTML viewer app and uploads it to R2 as `index.html`. The viewer is a self-contained SPA that:
- Lists screenshots grouped by website cluster and sorted chronologically
- Allows browsing by date with a timeline slider
- Renders comparisons between different sites in the same cluster
- Fetches the object list from R2 on load and rebuilds the UI client-side

The HTML is gzip-compressed before upload (Content-Encoding: gzip set on the R2 object). The Worker decompresses it when serving.

### `worker/src/index.js`

A Cloudflare Worker that:
1. Optionally password-protects the viewer (if `AUTH_PASSWORD` secret is set)
2. Proxies requests to R2 via `env.SCREENSHOTS_BUCKET` binding
3. Sets long-lived cache headers for images (`immutable, max-age=31536000`) and short for `index.html`
4. Decompresses gzip-encoded responses (for `index.html`) before streaming to the client

Auth flow: password submitted via POST `/login` → SHA-256 token stored in `HttpOnly` cookie valid 30 days. Logout via GET `/logout`.

### `.github/workflows/screenshot.yml`

Single job `screenshot` running on `ubuntu-latest` with a 55-minute timeout:

1. Checkout → Node 20 setup → `npm ci`
2. Install Chromium: `npx puppeteer browsers install chrome`
3. `node src/take-screenshots.js`
4. `node src/upload-to-r2.js` (requires R2 secrets)
5. `node src/cleanup-r2.js & node src/generate-index.js & wait` (parallel)
6. Upload screenshots folder as GitHub Actions artifact (90-day retention, backup)

**Trigger:** `workflow_dispatch` only — the workflow is triggered externally by cron-job.org every 30 minutes. There is no GitHub-native `schedule:` cron configured (it was removed because GitHub Actions scheduled runs are unreliable).

**Concurrency:** group `screenshots`, `cancel-in-progress: false` — overlapping runs queue rather than cancel.

---

## Required GitHub Secrets

| Secret | Purpose |
|--------|---------|
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | R2 bucket name (e.g. `screenshots`) |
| `R2_PUBLIC_URL` | Public R2 URL used in `generate-index.js` for image URLs |

The Worker uses a separate secret (`AUTH_PASSWORD`) set via `npx wrangler secret put AUTH_PASSWORD`.

---

## NPM Scripts

```bash
npm run screenshots    # node src/take-screenshots.js
npm run cleanup        # node src/cleanup-r2.js
npm run deploy-worker  # cd worker && npx wrangler deploy
```

There are no test scripts or linters configured.

---

## Development Conventions

### Module System
All source files use **ES Modules** (`import`/`export`). Do not use `require()`. The `"type": "module"` in `package.json` applies to the whole project.

### Language
- Source code comments and console output are written in **Dutch** (Nederlands)
- This README and code variable names use Dutch terms like `land`, `medium`, `cluster`, `interval`

### Error Handling
- Scripts exit with `process.exit(1)` on fatal errors
- Non-fatal errors (single site failure, single upload failure) are logged but don't abort the whole run
- `Promise.allSettled` is used for batch operations so one failure doesn't block others

### R2 Key/Path Convention
```
{websiteName}/{YYYY-MM-DD}/{websiteName}_{YYYY-MM-DDTHH-MM-SS}.webp
```
- `websiteName` matches the `name` field in `websites.json`
- Date folder uses `sv-SE` locale (ISO date format) in Brussels timezone
- Timestamp in filename uses `-` instead of `:` for filesystem compatibility
- Legacy mobile screenshots match `/_mobile\.(webp|jpg)$/` — skip these in `generate-index.js`

### Screenshot Pipeline Order
When modifying `loadAndPrepare()` or `capturePage()`, maintain this order:
1. Navigate (`goto`) with `networkidle2`
2. Handle Cloudflare challenge
3. Handle DPG privacy gate (full redirect)
4. Dismiss popups (multi-round, including iframes)
5. Force-load lazy images
6. Auto-scroll to bottom and back
7. Scroll individual images into view
8. Force-load lazy images again
9. Wait for images
10. Remove blur effects
11. Final popup cleanup (scroll can trigger new popups)
12. Scroll back to top
13. Capture screenshot
14. Sharp resize + WebP encode

### Adding New Websites
Edit `websites.json` only. Add a new object with all required fields (`name`, `label`, `url`, `land`, `medium`, `cluster`, `interval`). The `name` must be unique and URL-safe (no spaces, lowercase).

### Modifying Retention Period
Change `RETENTION_DAYS` constant in `src/cleanup-r2.js` (currently 15 days).

### Modifying Screenshot Quality/Size
Adjust `CONFIG` values in `src/take-screenshots.js`. Target file size is 100–300 KB per screenshot.

### Worker Deployment
```bash
cd worker
npx wrangler deploy
# Set/update password:
npx wrangler secret put AUTH_PASSWORD
```

---

## Known Issues & History

- Multiple popup/consent handling approaches were tried and reverted (PRs #60–#67). The current implementation uses a layered approach: iframe consent click → main page selector click → text-based button search → DOM removal as last resort.
- Cloudflare anti-bot challenges are handled in `handleCloudflareChallenge()`.
- DPG Media sites (HLN, De Morgen, etc.) have a two-step consent flow: cookie consent popup first, then a privacy gate redirect.
- GitHub Actions scheduled cron is intentionally not used — use cron-job.org for reliable 30-minute triggering.
- `index.html` is gzip-compressed in R2; the Worker must decompress it before streaming (handles this transparently).
