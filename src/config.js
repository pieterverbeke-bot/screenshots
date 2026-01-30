import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, '..', 'config.json');

const DEFAULT_CONFIG = {
  websites: [],
  googleDrive: {
    folderId: '',
    credentialsPath: './credentials.json'
  },
  screenshot: {
    width: 1920,
    height: 1080,
    fullPage: true
  },
  browser: {
    executablePath: null,
    headless: true
  }
};

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    saveConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (error) {
    console.error('Error loading config:', error.message);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function addWebsite(name, url, intervalMinutes = 60) {
  const config = loadConfig();

  const exists = config.websites.some(w => w.name === name || w.url === url);
  if (exists) {
    throw new Error('Website with this name or URL already exists');
  }

  config.websites.push({ name, url, intervalMinutes });
  saveConfig(config);
  return config;
}

export function removeWebsite(name) {
  const config = loadConfig();
  const index = config.websites.findIndex(w => w.name === name);

  if (index === -1) {
    throw new Error('Website not found');
  }

  config.websites.splice(index, 1);
  saveConfig(config);
  return config;
}

export function updateWebsite(name, updates) {
  const config = loadConfig();
  const website = config.websites.find(w => w.name === name);

  if (!website) {
    throw new Error('Website not found');
  }

  Object.assign(website, updates);
  saveConfig(config);
  return config;
}

export function setGoogleDriveFolder(folderId) {
  const config = loadConfig();
  config.googleDrive.folderId = folderId;
  saveConfig(config);
  return config;
}
