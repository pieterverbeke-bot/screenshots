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

## Schedule aanpassen

Bewerk `.github/workflows/screenshot.yml`:

```yaml
schedule:
  # Elk uur (standaard)
  - cron: '0 * * * *'

  # Elke 30 minuten:
  # - cron: '*/30 * * * *'

  # Elke 6 uur:
  # - cron: '0 */6 * * *'

  # Dagelijks om 9:00 UTC:
  # - cron: '0 9 * * *'
```

## Problemen?

### "Upload failed" of "Permission denied"
- Check of je de folder hebt gedeeld met het service account email
- Check of het service account "Editor" rechten heeft

### Screenshots niet in Drive
- Check of beide secrets correct zijn ingesteld in GitHub
- Kijk in de Actions log voor foutmeldingen
