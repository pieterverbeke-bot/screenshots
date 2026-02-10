import { google } from 'googleapis';
import { createReadStream, readdirSync } from 'fs';
import { join, basename } from 'path';

const SCREENSHOTS_DIR = './screenshots';

async function authenticate() {
  // Service account credentials from environment variable
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  return auth;
}

async function getOrCreateFolder(drive, folderName, parentId) {
  // Check if folder exists
  const query = parentId
    ? `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
    : `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  if (response.data.files.length > 0) {
    return response.data.files[0].id;
  }

  // Create folder
  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentId && { parents: [parentId] })
  };

  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: 'id',
    supportsAllDrives: true
  });

  console.log(`📁 Created folder: ${folderName}`);
  return folder.data.id;
}

async function uploadFile(drive, filepath, folderId) {
  const filename = basename(filepath);

  const fileMetadata = {
    name: filename,
    parents: [folderId]
  };

  const media = {
    mimeType: 'image/png',
    body: createReadStream(filepath)
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink',
    supportsAllDrives: true
  });

  return response.data;
}

async function main() {
  console.log('\n☁️  Uploading to Google Drive...\n');

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    console.error('❌ GOOGLE_DRIVE_FOLDER_ID not set');
    process.exit(1);
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT not set');
    process.exit(1);
  }

  const auth = await authenticate();
  const drive = google.drive({ version: 'v3', auth });

  // Get all screenshots
  const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));

  if (files.length === 0) {
    console.log('⚠️  No screenshots to upload');
    return;
  }

  console.log(`📸 Found ${files.length} screenshot(s)\n`);

  // Create date folder (e.g., "2024-01-15")
  const today = new Date().toISOString().split('T')[0];
  const dateFolderId = await getOrCreateFolder(drive, today, folderId);

  // Upload each file
  for (const file of files) {
    const filepath = join(SCREENSHOTS_DIR, file);

    // Extract website name from filename (e.g., "hln_2024-01-15T10-00-00.png" -> "hln")
    const websiteName = file.split('_')[0];

    // Create website subfolder
    const websiteFolderId = await getOrCreateFolder(drive, websiteName, dateFolderId);

    try {
      const result = await uploadFile(drive, filepath, websiteFolderId);
      console.log(`✅ ${file}`);
    } catch (error) {
      console.error(`❌ ${file}: ${error.message}`);
    }
  }

  console.log('\n✨ Upload complete!');
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  process.exit(1);
});
