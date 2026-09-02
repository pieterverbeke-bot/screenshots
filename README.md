# Website Screenshot Monitor

**100% Gratis** website monitoring met GitHub Actions. Screenshots worden automatisch opgeslagen in Cloudflare R2 en deelbaar met collega's via een publieke URL.

## Features

- ✅ Volledig gratis (GitHub Actions + Cloudflare R2 free tier)
- ✅ Automatisch uploaden naar Cloudflare R2
- ✅ Deelbaar met collega's via publieke URL
- ✅ Elk uur screenshots (via cron-job.org)
- ✅ Meerdere websites tegelijk
- ✅ Georganiseerd per website en datum

## Setup

### Stap 1: Cloudflare account + R2 bucket

1. Ga naar **[dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)** en maak een gratis account
2. Klik in het linker menu op **"R2 Object Storage"**
3. Klik **"Create bucket"**
4. Naam: `screenshots` → **"Create bucket"**

### Stap 2: Publieke toegang aanzetten

1. Open je bucket → ga naar **"Settings"**
2. Scroll naar **"Public access"**
3. Klik **"Allow Access"** bij **"R2.dev subdomain"**
4. Noteer de publieke URL (bijv. `https://pub-abc123.r2.dev`) — dit is de link voor je collega's

### Stap 3: R2 API token aanmaken

1. Ga naar **R2 Overview** (linker menu)
2. Klik op **"Manage R2 API Tokens"**
3. Klik **"Create API token"**
4. Permissions: **"Object Read & Write"**
5. Scope: beperkt tot je `screenshots` bucket
6. Klik **"Create API Token"**
7. **Noteer deze waarden:**
   - **Access Key ID**
   - **Secret Access Key**
8. Noteer ook je **Account ID** (rechter zijbalk op de R2 overzichtspagina)

### Stap 4: GitHub Secrets instellen

1. Ga naar je GitHub repo → **"Settings"** → **"Secrets and variables"** → **"Actions"**
2. Voeg deze 4 secrets toe:

   | Secret name | Waarde |
   |-------------|--------|
   | `R2_ACCOUNT_ID` | Je Cloudflare Account ID |
   | `R2_ACCESS_KEY_ID` | Access Key ID uit stap 3 |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key uit stap 3 |
   | `R2_BUCKET_NAME` | `screenshots` (of de naam die je koos) |

### Stap 5: Test!

1. Ga naar **"Actions"** tab
2. Klik op **"Website Screenshots"**
3. Klik **"Run workflow"** → **"Run workflow"**
4. Wacht 2-3 minuten
5. Check je R2 bucket of de publieke URL!

## Folder structuur in R2

```
screenshots/
├── hln/
│   ├── 2024-01-15/
│   │   ├── hln_2024-01-15T10-00-00.webp        # volledig screenshot
│   │   └── hln_2024-01-15T10-00-00.thumb.webp  # miniatuur voor de tijdlijn
│   └── 2024-01-16/
│       └── ...
├── ad/
│   ├── 2024-01-15/
│   │   └── ad_2024-01-15T10-00-00.webp
│   └── ...
└── vk/
    └── ...
```

Collega's kunnen screenshots bekijken via: `https://pub-abc123.r2.dev/hln/2024-01-15/`

### Miniaturen

Bij elk screenshot wordt een miniatuur van 200x130px (~5 KB) bewaard. De tijdlijn in
de viewer toont die miniaturen in plaats van de volledige screenshots (100-300 KB),
waardoor een site openen vrijwel meteen gaat in plaats van 10-15 seconden.

Screenshots van vóór deze wijziging hebben nog geen miniatuur. Die haal je in met:

```bash
npm run thumbs -- --days 30      # laatste 30 dagen
npm run thumbs -- --days 0       # volledige geschiedenis
npm run thumbs -- --dry-run      # enkel tellen
```

Of via GitHub Actions → **Miniaturen bijwerken** → *Run workflow* (die werkt daarna
ook meteen de viewer bij). Zonder miniatuur valt de viewer terug op het volledige
screenshot, dus de tijdlijn blijft altijd werken.

## Websites aanpassen

Bewerk `websites.json`:

```json
[
  {
    "name": "hln",
    "url": "https://www.hln.be"
  },
  {
    "name": "ad",
    "url": "https://www.ad.nl"
  }
]
```

## Betrouwbare scheduling via cron-job.org (aanbevolen)

GitHub Actions cron is onbetrouwbaar — runs worden vaak 1-3 uur uitgesteld bij hoge load. Gebruik **[cron-job.org](https://cron-job.org)** als externe trigger voor betrouwbare, stipte uitvoering.

### Stap 1: GitHub Personal Access Token (PAT) maken

1. Ga naar **[github.com/settings/tokens](https://github.com/settings/tokens)**
2. Klik **"Generate new token"** → **"Generate new token (classic)"**
3. Naam: `cron-job-screenshot-trigger`
4. Expiration: kies een passende duur (of "No expiration")
5. Selecteer scope: **`repo`** (volledige repo access nodig voor workflow dispatch)
6. Klik **"Generate token"**
7. **Kopieer het token** — je ziet het maar één keer!

### Stap 2: Account maken op cron-job.org

1. Ga naar **[cron-job.org](https://cron-job.org)** en maak een gratis account
2. Het gratis plan ondersteunt cronjobs tot elke minuut

### Stap 3: Cronjob aanmaken

1. Klik **"Create cronjob"**
2. Vul in:
   - **Title:** `Screenshot workflow trigger`
   - **URL:**
     ```
     https://api.github.com/repos/OWNER/REPO/actions/workflows/screenshot.yml/dispatches
     ```
     Vervang `OWNER` door je GitHub-gebruikersnaam en `REPO` door de repository-naam.
   - **Schedule:** Every **1 hour** (of kies je gewenst interval)
   - **Request method:** `POST`
3. Ga naar het tabblad **"Advanced"**:
   - **Headers:**
     ```
     Authorization: Bearer JOUW_GITHUB_PAT
     Accept: application/vnd.github.v3+json
     ```
     Vervang `JOUW_GITHUB_PAT` door het token uit stap 1.
   - **Request body:**
     ```json
     {"ref":"main"}
     ```
4. Klik **"Save"**

### Stap 4: Testen

1. Klik op de cronjob en kies **"Test run"**
2. Je zou status **204** moeten krijgen (= success, no content)
3. Check je GitHub Actions tab — de workflow zou nu moeten starten

> **Tip:** De `schedule` in de workflow YAML blijft als fallback staan. Zelfs als cron-job.org een keer faalt, pikt GitHub Actions het uiteindelijk op.

## Schedule aanpassen (fallback)

De ingebouwde GitHub Actions cron in `.github/workflows/screenshot.yml` dient als fallback.
Dit interval is **niet betrouwbaar** voor stipte uitvoering — gebruik cron-job.org (zie hierboven).

```yaml
schedule:
  # Elk uur (standaard, fallback)
  - cron: '0 * * * *'

  # Elke 30 minuten:
  # - cron: '*/30 * * * *'

  # Elke 6 uur:
  # - cron: '0 */6 * * *'

  # Dagelijks om 9:00 UTC:
  # - cron: '0 9 * * *'
```

## Problemen?

### Cron-job.org geeft geen 204 response
- Check of je GitHub PAT geldig is en de `repo` scope heeft
- Check of de URL klopt: `https://api.github.com/repos/OWNER/REPO/actions/workflows/screenshot.yml/dispatches`
- Check of de `ref` in de body overeenkomt met een bestaande branch (standaard: `main`)

### Workflow draait niet elk uur (zonder cron-job.org)
- Dit is een **bekend probleem** met GitHub Actions scheduled workflows
- GitHub garandeert geen stipte uitvoering — delays van 1-3+ uur komen vaak voor
- Oplossing: gebruik cron-job.org (zie sectie hierboven)

### "Upload failed" of R2 fouten
- Check of alle 4 R2 secrets correct zijn ingesteld in GitHub
- Check of het API token "Object Read & Write" permissions heeft
- Check of de bucket naam klopt

### Screenshots niet in R2
- Check of de secrets correct zijn ingesteld in GitHub
- Kijk in de Actions log voor foutmeldingen
