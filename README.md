# Website Screenshot Monitor

**100% Gratis** website monitoring met GitHub Actions. Neemt automatisch screenshots van websites en bewaart ze als artifacts.

## Features

- ✅ Volledig gratis (GitHub Actions)
- ✅ Geen server of hosting nodig
- ✅ Automatische scheduling (elk uur, dagelijks, etc.)
- ✅ Screenshots 90 dagen bewaard als artifacts
- ✅ Meerdere websites tegelijk
- ✅ Volledige pagina screenshots

## Snelle Start

### 1. Fork of clone deze repo

### 2. Configureer je websites

Bewerk `websites.json`:

```json
[
  {
    "name": "mijn-site",
    "url": "https://mijnwebsite.nl"
  },
  {
    "name": "google",
    "url": "https://www.google.com"
  },
  {
    "name": "nieuws",
    "url": "https://nos.nl"
  }
]
```

### 3. Pas het schedule aan (optioneel)

Bewerk `.github/workflows/screenshot.yml`:

```yaml
schedule:
  # Elk uur
  - cron: '0 * * * *'

  # Of kies een ander interval:
  # Elke 30 minuten:
  # - cron: '*/30 * * * *'

  # Elke 6 uur:
  # - cron: '0 */6 * * *'

  # Eens per dag om 9:00 UTC (10:00 NL):
  # - cron: '0 9 * * *'

  # Alleen doordeweeks om 9:00:
  # - cron: '0 9 * * 1-5'
```

### 4. Push naar GitHub

```bash
git add .
git commit -m "Configure websites"
git push
```

### 5. Klaar!

De workflow draait automatisch volgens je schedule. Je kunt ook handmatig triggeren:

1. Ga naar je repo op GitHub
2. Klik op **Actions**
3. Klik op **Website Screenshots**
4. Klik op **Run workflow**

## Screenshots bekijken

1. Ga naar **Actions** in je GitHub repo
2. Klik op een workflow run
3. Scroll naar beneden naar **Artifacts**
4. Download `screenshots-X-X.zip`

## Screenshots in de repo bewaren (optioneel)

Wil je screenshots direct in de repo bewaren in plaats van als artifacts?

1. Ga naar je repo **Settings** → **Variables** → **Repository variables**
2. Klik **New repository variable**
3. Name: `SAVE_TO_REPO`
4. Value: `true`

Let op: dit gebruikt meer storage van je repo.

## Lokaal testen

```bash
# Install dependencies
npm install

# Install Chrome
npx puppeteer browsers install chrome

# Run
npm run screenshots
```

## Cron Schedule Voorbeelden

| Schedule | Cron expressie |
|----------|---------------|
| Elk uur | `0 * * * *` |
| Elke 30 min | `*/30 * * * *` |
| Elke 6 uur | `0 */6 * * *` |
| Dagelijks 9:00 UTC | `0 9 * * *` |
| Dagelijks 18:00 UTC | `0 18 * * *` |
| Maandag t/m vrijdag 9:00 | `0 9 * * 1-5` |
| Elke maandag 8:00 | `0 8 * * 1` |

> **Tip:** GitHub Actions cron gebruikt UTC tijd. Nederland is UTC+1 (winter) of UTC+2 (zomer).

## Limieten (gratis)

- **2000 minuten/maand** voor private repos
- **Onbeperkt** voor public repos
- **Artifacts**: 90 dagen bewaard, max 500MB per artifact
- **Repo storage**: 500MB-2GB afhankelijk van account type

Voor de meeste use cases is dit ruim voldoende.

## Problemen oplossen

### Workflow draait niet
- Check of Actions is ingeschakeld in je repo settings
- De eerste schedule kan tot een uur duren voordat hij start

### Screenshot mislukt
- Controleer of de URL correct is in `websites.json`
- Sommige sites blokkeren headless browsers - niet veel aan te doen

### Artifacts niet zichtbaar
- Artifacts verschijnen pas nadat de workflow volledig klaar is
