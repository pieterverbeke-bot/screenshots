import { google } from 'googleapis';
import { readFileSync, existsSync, createReadStream } from 'fs';
import { dirname, join, basename } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, '..', 'token.json');

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

let authClient = null;

export async function authenticate(config) {
  const credentialsPath = join(__dirname, '..', config.googleDrive.credentialsPath);

  if (!existsSync(credentialsPath)) {
    throw new Error(
      `Credentials file not found at ${credentialsPath}.\n` +
      'Please download your OAuth2 credentials from Google Cloud Console and save as credentials.json'
    );
  }

  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf-8'));
    oauth2Client.setCredentials(token);
    authClient = oauth2Client;
    return oauth2Client;
  }

  throw new Error('Not authenticated. Run "npm run auth" first to authenticate with Google Drive.');
}

export function getAuthUrl(config) {
  const credentialsPath = join(__dirname, '..', config.googleDrive.credentialsPath);

  if (!existsSync(credentialsPath)) {
    throw new Error(
      `Credentials file not found at ${credentialsPath}.\n` +
      'Please download your OAuth2 credentials from Google Cloud Console.'
    );
  }

  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
}

export async function saveToken(code, config) {
  const credentialsPath = join(__dirname, '..', config.googleDrive.credentialsPath);
  const credentials = JSON.parse(readFileSync(credentialsPath, 'utf-8'));
  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const { writeFileSync } = await import('fs');
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  console.log('Token saved to', TOKEN_PATH);

  authClient = oauth2Client;
  return oauth2Client;
}

export async function uploadToDrive(filepath, config) {
  if (!authClient) {
    await authenticate(config);
  }

  const drive = google.drive({ version: 'v3', auth: authClient });
  const filename = basename(filepath);

  const folderId = config.googleDrive.folderId;
  if (!folderId) {
    throw new Error('Google Drive folder ID not set. Use CLI to set it first.');
  }

  const fileMetadata = {
    name: filename,
    parents: [folderId]
  };

  const media = {
    mimeType: 'image/png',
    body: createReadStream(filepath)
  };

  console.log(`Uploading ${filename} to Google Drive...`);

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true
  });

  console.log(`Uploaded: ${response.data.name} (ID: ${response.data.id})`);

  return response.data;
}

export async function createSubfolder(name, config) {
  if (!authClient) {
    await authenticate(config);
  }

  const drive = google.drive({ version: 'v3', auth: authClient });

  const folderId = config.googleDrive.folderId;
  if (!folderId) {
    throw new Error('Google Drive folder ID not set.');
  }

  const folderMetadata = {
    name: name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [folderId]
  };

  const response = await drive.files.create({
    resource: folderMetadata,
    fields: 'id, name',
    supportsAllDrives: true
  });

  return response.data;
}

export async function getOrCreateWebsiteFolder(websiteName, config) {
  if (!authClient) {
    await authenticate(config);
  }

  const drive = google.drive({ version: 'v3', auth: authClient });
  const parentId = config.googleDrive.folderId;

  // Check if folder already exists
  const query = `name='${websiteName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  if (response.data.files.length > 0) {
    return response.data.files[0];
  }

  // Create new folder
  return await createSubfolder(websiteName, config);
}

export async function uploadScreenshot(screenshotResult, config) {
  // Get or create folder for this website
  const folder = await getOrCreateWebsiteFolder(screenshotResult.website, config);

  // Temporarily change folder ID to upload to website subfolder
  const originalFolderId = config.googleDrive.folderId;
  config.googleDrive.folderId = folder.id;

  try {
    const result = await uploadToDrive(screenshotResult.filepath, config);
    return result;
  } finally {
    config.googleDrive.folderId = originalFolderId;
  }
}
