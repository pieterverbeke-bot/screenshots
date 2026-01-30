# Website Screenshot Monitor

Automatisch periodieke screenshots nemen van websites en opslaan in Google Drive.

## Features

- Monitor meerdere websites tegelijk
- Configureerbaar interval per website (minuten, uren, dagen)
- Volledige pagina screenshots
- Automatische upload naar Google Drive (shared folders ondersteund)
- Organiseert screenshots per website in submappen
- CLI interface voor eenvoudig beheer

## Installatie

```bash
npm install
```

### Browser Setup

De app gebruikt Puppeteer voor screenshots. Je hebt Chrome/Chromium nodig:

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get install chromium-browser
# Of Google Chrome
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

**Mac:**
Chrome is meestal al geinstalleerd. Anders: https://www.google.com/chrome/

Stel het browser pad in als de automatische detectie niet werkt:
```bash
node src/cli.js set-browser /usr/bin/chromium-browser
```

## Google Drive Setup

### 1. Maak een Google Cloud Project

1. Ga naar [Google Cloud Console](https://console.cloud.google.com)
2. Maak een nieuw project
3. Activeer de **Google Drive API**

### 2. Maak OAuth2 Credentials

1. Ga naar "APIs & Services" > "Credentials"
2. Klik "Create Credentials" > "OAuth client ID"
3. Kies "Desktop app"
4. Download het JSON bestand en bewaar als `credentials.json` in de project root

### 3. Authenticeer

```bash
npm run auth
```

Volg de instructies om in te loggen met je Google account.

### 4. Stel de Drive folder in

1. Open Google Drive en ga naar je (shared) folder
2. Kopieer de folder ID uit de URL: `drive.google.com/drive/folders/[FOLDER_ID]`
3. Configureer:

```bash
node src/cli.js set-folder JOUW_FOLDER_ID
```

## Gebruik

### Websites toevoegen

```bash
# Interactief
npm run add

# Of met opties
node src/cli.js add --name "mijn-site" --url "https://example.com" --interval 60
```

### Websites beheren

```bash
# Lijst alle websites
npm run list

# Verwijder een website
npm run remove

# Bekijk volledige configuratie
node src/cli.js config
```

### Test een screenshot

```bash
npm run test-screenshot
```

### Start de monitor

```bash
npm start
```

De monitor:
1. Neemt direct een screenshot van alle geconfigureerde websites
2. Upload naar Google Drive (als geconfigureerd)
3. Herhaalt dit volgens het ingestelde interval per website

## Configuratie

De configuratie wordt opgeslagen in `config.json`:

```json
{
  "websites": [
    {
      "name": "voorbeeld",
      "url": "https://example.com",
      "intervalMinutes": 60
    }
  ],
  "googleDrive": {
    "folderId": "jouw-folder-id",
    "credentialsPath": "./credentials.json"
  },
  "screenshot": {
    "width": 1920,
    "height": 1080,
    "fullPage": true
  },
  "browser": {
    "executablePath": null,
    "headless": true
  }
}
```

### Interval voorbeelden

| Minuten | Beschrijving |
|---------|--------------|
| 15 | Elk kwartier |
| 60 | Elk uur |
| 360 | Elke 6 uur |
| 1440 | Eens per dag |

## Folder structuur in Google Drive

Screenshots worden automatisch georganiseerd:

```
Shared Drive Folder/
├── website-naam-1/
│   ├── website-naam-1_2024-01-15T10-00-00-000Z.png
│   ├── website-naam-1_2024-01-15T11-00-00-000Z.png
│   └── ...
├── website-naam-2/
│   └── ...
```

## Als achtergrond service draaien

### Met PM2 (aanbevolen)

```bash
npm install -g pm2

pm2 start src/index.js --name "screenshot-monitor"
pm2 save
pm2 startup  # Om te starten bij boot
```

### Met systemd (Linux)

Maak `/etc/systemd/system/screenshot-monitor.service`:

```ini
[Unit]
Description=Website Screenshot Monitor
After=network.target

[Service]
Type=simple
User=jouw-gebruiker
WorkingDirectory=/pad/naar/project
ExecStart=/usr/bin/node src/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable screenshot-monitor
sudo systemctl start screenshot-monitor
```

## Problemen oplossen

### Browser niet gevonden
```bash
node src/cli.js set-browser /pad/naar/chrome
```

### Google Drive authenticatie mislukt
- Verwijder `token.json` en run `npm run auth` opnieuw
- Controleer of de Drive API is ingeschakeld in Google Cloud

### Screenshots mislukken
- Controleer of de URL correct is
- Test handmatig met `npm run test-screenshot`
- Bekijk de console output voor foutmeldingen
