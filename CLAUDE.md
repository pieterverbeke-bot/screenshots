# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Website screenshot monitoring system that captures periodic screenshots of 25+ Belgian/Dutch news websites using GitHub Actions + Puppeteer, stores them in Cloudflare R2, and serves an interactive viewer via a Cloudflare Worker.

## Commands

```bash
npm run screenshots        # Capture screenshots of all websites in websites.json
npm run cleanup            # Delete R2 screenshots older than 15 days
npm run deploy-worker      # Deploy Cloudflare Worker (cd worker && npx wrangler deploy)
```

No test suite exists. To install dependencies: `npm ci && npx puppeteer browsers install chrome`.

## Architecture

### Pipeline Flow

```
GitHub Actions trigger (cron-job.org webhook or manual dispatch)
  → take-screenshots.js   (Puppeteer captures → local screenshots/ dir, WebP @ 960px wide)
  → upload-to-r2.js       (uploads to R2: {website}/{date}/{filename}.webp)
  → generate-index.js     (reads R2 listing → generates gzipped index.html → uploads to R2)
  → cleanup-r2.js         (deletes files older than 15 days)
```

### Key Components

- **`src/take-screenshots.js`** — Puppeteer-based capture with adaptive scrolling, lazy-load forcing, and Sharp image optimization (WebP quality 30, max 8000px height). Runs 3 concurrent captures. Viewport: 1366×768. Timezone: Europe/Brussels.
- **`src/generate-index.js`** — Generates a single-page HTML viewer with all CSS/JS embedded inline. The viewer has filmstrip navigation, Tinder-style touch swipe, lightbox zoom, date/website filtering. All screenshot data is embedded as JSON in the HTML.
- **`src/upload-to-r2.js`** — S3-compatible uploader (6 concurrent uploads). R2 key format: `{website}/{YYYY-MM-DD}/{website}_{ISO-datetime}.webp`.
- **`src/cleanup-r2.js`** — 15-day retention enforcement. Preserves `index.html`.
- **`src/r2-client.js`** — Shared S3Client factory for R2 access.
- **`worker/src/index.js`** — Cloudflare Worker that proxies R2 objects. Optional SHA-256 cookie-based password auth. Caches images 1 year (immutable), HTML 5 min.
- **`websites.json`** — Website config array. Each entry: `name` (slug), `label`, `url`, `land` (country), `medium` (type), `cluster`, `interval` (minutes between captures).

### Environment Variables (GitHub Actions secrets)

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL`

Worker optional secret: `AUTH_PASSWORD` (enables login protection).

## Code Conventions

- All source is vanilla JavaScript (Node.js 20, no TypeScript, no frameworks).
- The viewer UI in `generate-index.js` is a single template literal containing HTML/CSS/JS — no build step.
- Dutch comments and commit messages are common in this codebase.
- Website names use lowercase slugs (e.g., `hln`, `ad`, `nos`) matching `websites.json` `name` field.
