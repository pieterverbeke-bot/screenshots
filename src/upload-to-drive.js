import { google } from 'googleapis';
import { createReadStream, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const SCREENSHOTS_DIR = './screenshots';

async function authenticate() {
  console.log('🔑 Authenticating with Google Drive...');

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  console.log(`🔑 Using service account: ${credentials.client_email}`);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive']
  });

  return auth;
}

async function getOrCreateFolder(drive, folderName, parentId) {
  const query = `name='${folderName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });

  if (response.data.files.length > 0) {
    console.log(`📁 Found existing folder: ${folderName}`);
    return response.data.files[0].id;
  }

  const folderMetadata = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId]
  };

  const folder = await drive.files.create({
    resource: folderMetadata,
    fields: 'id',
    supportsAllDrives: true
  });

  console.log(`📁 Created new folder: ${folderName}`);
  return folder.data.id;
}

async function uploadFile(drive, filepath, folderId) {
  const filename = basename(filepath);
  const fileSize = statSync(filepath).size;

  console.log(`📤 Uploading ${filename} (${Math.round(fileSize / 1024)} KB)...`);

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

  console.log(`✅ Uploaded: ${response.data.name} (ID: ${response.data.id})`);
  return response.data;
}

async function main() {
  console.log('\n☁️  Google Drive Upload\n');
  console.log('='.repeat(50));

  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) {
    console.error('❌ GOOGLE_DRIVE_FOLDER_ID not set');
    process.exit(1);
  }
  console.log(`📂 Target folder ID: ${folderId}`);

  if (!process.env.GOOGLE_SERVICE_ACCOUNT) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT not set');
    process.exit(1);
  }

  const auth = await authenticate();
  const drive = google.drive({ version: 'v3', auth });

  // Test connection
  try {
    const folder = await drive.files.get({
      fileId: folderId,
      fields: 'id, name',
      supportsAllDrives: true
    });
    console.log(`✅ Connected to folder: ${folder.data.name}\n`);
  } catch (error) {
    console.error(`❌ Cannot access folder: ${error.message}`);
    console.error('Make sure the folder is shared with the service account email');
    process.exit(1);
  }

  // Get all screenshots
  const files = readdirSync(SCREENSHOTS_DIR).filter(f => f.endsWith('.png'));

  if (files.length === 0) {
    console.log('⚠️  No screenshots found in', SCREENSHOTS_DIR);
    return;
  }

  console.log(`📸 Found ${files.length} screenshot(s) to upload\n`);

  // Create date folder (e.g., "2024-01-15")
  const today = new Date().toISOString().split('T')[0];
  const dateFolderId = await getOrCreateFolder(drive, today, folderId);

  let successCount = 0;
  let failCount = 0;

  // Upload each file
  for (const file of files) {
    const filepath = join(SCREENSHOTS_DIR, file);

    // Extract website name from filename (e.g., "hln_2024-01-15T10-00-00.png" -> "hln")
    const websiteName = file.split('_')[0];

    // Create website subfolder
    const websiteFolderId = await getOrCreateFolder(drive, websiteName, dateFolderId);

    try {
      await uploadFile(drive, filepath, websiteFolderId);
      successCount++;
    } catch (error) {
      console.error(`❌ Failed to upload ${file}: ${error.message}`);
      failCount++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✨ Upload complete: ${successCount} successful, ${failCount} failed`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
