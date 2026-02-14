# Website Screenshot Monitor

**100% Gratis** website monitoring met GitHub Actions. Screenshots worden automatisch opgeslagen in Google Drive.

## Features

- ✅ Volledig gratis (GitHub Actions)
- ✅ Automatisch uploaden naar Google Drive
- ✅ Elk uur screenshots (of ander interval)
- ✅ Meerdere websites tegelijk
- ✅ Georganiseerd per datum en website

## Setup

### Stap 1: Google Cloud Project maken

1. Ga naar **[console.cloud.google.com](https://console.cloud.google.com)**
2. Klik bovenaan op het project dropdown → **"New Project"**
3. Naam: `screenshot-monitor` → **"Create"**

### Stap 2: Google Drive API activeren

1. Ga naar menu (☰) → **"APIs & Services"** → **"Library"**
2. Zoek **"Google Drive API"**
3. Klik erop → **"Enable"**

### Stap 3: Service Account maken

1. Ga naar **"APIs & Services"** → **"Credentials"**
2. Klik **"+ Create Credentials"** → **"Service account"**
3. Naam: `screenshot-uploader` → **"Create and Continue"**
4. Klik **"Done"** (role mag leeg blijven)
5. Klik op de service account die je net maakte
6. Ga naar **"Keys"** tab
7. **"Add Key"** → **"Create new key"** → **"JSON"** → **"Create"**
8. Een JSON bestand wordt gedownload - **bewaar dit goed!**

### Stap 4: Google Drive folder delen

1. Open **[drive.google.com](https://drive.google.com)**
2. Maak een folder aan (of gebruik een bestaande)
3. Rechtsklik op de folder → **"Share"**
4. Voeg het service account email toe (staat in je JSON bestand als `client_email`)
   - Ziet eruit als: `screenshot-uploader@jouw-project.iam.gserviceaccount.com`
5. Geef **"Editor"** rechten
6. Kopieer de folder ID uit de URL:
   ```
   https://drive.google.com/drive/folders/1ABC123xyz456
                                          └─────────────┘
                                          Dit is je FOLDER_ID
   ```

### Stap 5: GitHub Secrets instellen

1. Ga naar je GitHub repo → **"Settings"** → **"Secrets and variables"** → **"Actions"**
2. Klik **"New repository secret"**:

   **Secret 1:**
   - Name: `GOOGLE_SERVICE_ACCOUNT`
   - Value: *plak de volledige inhoud van het gedownloade JSON bestand*

   **Secret 2:**
   - Name: `GOOGLE_DRIVE_FOLDER_ID`
   - Value: *de folder ID uit stap 4*

### Stap 6: Test!

1. Ga naar **"Actions"** tab
2. Klik op **"Website Screenshots"**
3. Klik **"Run workflow"** → **"Run workflow"**
4. Wacht 2-3 minuten
5. Check je Google Drive folder!

## Folder structuur in Google Drive

```
Jouw Folder/
├── 2024-01-15/
│   ├── hln/
│   │   └── hln_2024-01-15T10-00-00-000Z.png
│   ├── ad/
│   │   └── ad_2024-01-15T10-00-00-000Z.png
│   └── vk/
│       └── vk_2024-01-15T10-00-00-000Z.png
├── 2024-01-16/
│   └── ...
```

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

### "Upload failed" of "Permission denied"
- Check of je de folder hebt gedeeld met het service account email
- Check of het service account "Editor" rechten heeft

### Screenshots niet in Drive
- Check of beide secrets correct zijn ingesteld in GitHub
- Kijk in de Actions log voor foutmeldingen
