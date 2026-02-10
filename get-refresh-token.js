#!/usr/bin/env node

/**
 * Run dit script lokaal om een refresh token te krijgen:
 *
 * 1. Zorg dat oauth-credentials.json in dezelfde folder staat
 * 2. Run: node get-refresh-token.js
 * 3. Open de URL in je browser en log in
 * 4. Kopieer de code en plak in de terminal
 * 5. Je krijgt een refresh token - sla die op als GitHub secret
 */

import { readFileSync } from 'fs';
import { google } from 'googleapis';
import { createInterface } from 'readline';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  console.log('\n🔐 Google Drive OAuth Setup\n');
  console.log('='.repeat(50));

  // Load OAuth credentials
  let credentials;
  try {
    credentials = JSON.parse(readFileSync('./oauth-credentials.json', 'utf-8'));
  } catch (error) {
    console.error('❌ oauth-credentials.json niet gevonden!');
    console.log('\nDownload je OAuth credentials van Google Cloud Console');
    console.log('en sla op als oauth-credentials.json in deze folder.\n');
    process.exit(1);
  }

  const { client_id, client_secret, redirect_uris } = credentials.installed || credentials.web;

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    'urn:ietf:wg:oauth:2.0:oob'
  );

  // Generate auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive'],
    prompt: 'consent'
  });

  console.log('\n📋 Stap 1: Open deze URL in je browser:\n');
  console.log(authUrl);
  console.log('\n📋 Stap 2: Log in met je Google account en geef toestemming');
  console.log('\n📋 Stap 3: Kopieer de code die je krijgt\n');

  const code = await question('Plak de code hier: ');

  try {
    const { tokens } = await oauth2Client.getToken(code.trim());

    console.log('\n✅ Succes! Hier zijn je tokens:\n');
    console.log('='.repeat(50));
    console.log('\n🔑 REFRESH TOKEN (sla op als GitHub secret GOOGLE_REFRESH_TOKEN):\n');
    console.log(tokens.refresh_token);
    console.log('\n🔑 CLIENT ID (sla op als GitHub secret GOOGLE_CLIENT_ID):\n');
    console.log(client_id);
    console.log('\n🔑 CLIENT SECRET (sla op als GitHub secret GOOGLE_CLIENT_SECRET):\n');
    console.log(client_secret);
    console.log('\n' + '='.repeat(50));
    console.log('\n📝 Voeg deze 3 secrets toe aan GitHub:');
    console.log('   Settings → Secrets and variables → Actions → New repository secret\n');

  } catch (error) {
    console.error('❌ Fout bij het ophalen van tokens:', error.message);
  }

  rl.close();
}

main();
