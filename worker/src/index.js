// Sessie-cookie (ondertekend) en levensduur (30 dagen)
const SESSION_COOKIE = 'screenshots_session';
const STATE_COOKIE = 'screenshots_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
const STATE_MAX_AGE = 60 * 10; // OAuth-state blijft 10 minuten geldig

// Enkel Google-accounts van dit domein krijgen toegang
const ALLOWED_DOMAIN = 'persgroep.net';

// Google OpenID Connect endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/* ---------------------------------------------------------------------------
 * Encoding helpers
 * ------------------------------------------------------------------------- */

/** Base64url-encode een Uint8Array of string (zonder padding). */
function base64urlEncode(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url-decode naar een string. */
function base64urlDecodeToString(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '==='.slice((padded.length + 3) % 4));
  return decodeURIComponent(
    [...binary].map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')
  );
}

/** SHA-256 over een string, als Uint8Array. */
async function sha256Bytes(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}

/** HMAC-SHA256 ondertekening van data met secret, base64url-encoded. */
async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return base64urlEncode(new Uint8Array(sig));
}

/** Constant-time string-vergelijking. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

/** Genereer een willekeurige base64url-string van n bytes. */
function randomToken(n = 32) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

/* ---------------------------------------------------------------------------
 * Sessie-token (ondertekend met AUTH_SECRET)
 * ------------------------------------------------------------------------- */

/** Maak een ondertekend sessie-token dat e-mail + vervaltijd bevat. */
async function createSession(email, secret) {
  const payload = base64urlEncode(JSON.stringify({
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  }));
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

/** Valideer een sessie-token; geef het e-mailadres terug of null. */
async function verifySession(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = await hmacSign(secret, payload);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const data = JSON.parse(base64urlDecodeToString(payload));
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data.email || null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Cookie helpers
 * ------------------------------------------------------------------------- */

/** Lees een specifieke cookie uit de request headers. */
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? match[1] : null;
}

/** Bouw een Set-Cookie header string. */
function buildSetCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

/* ---------------------------------------------------------------------------
 * HTML-pagina's
 * ------------------------------------------------------------------------- */

const PAGE_STYLE = `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f3f7;
      color: #2d2d3a;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background: linear-gradient(135deg, #783c96 0%, #d23278 50%, #e6463c 80%, #fabb22 100%);
      color: #fff;
      padding: 0.7rem 2rem;
      box-shadow: 0 2px 16px rgba(120, 60, 150, 0.25);
    }
    .header-inner {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    header h1 { font-size: 1rem; font-weight: 700; letter-spacing: -0.02em; }
    .login-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .login-card {
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 24px rgba(120, 60, 150, 0.10);
      padding: 2.5rem 2rem;
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .login-card h2 {
      font-size: 1.1rem;
      font-weight: 700;
      color: #783c96;
      margin-bottom: 0.3rem;
    }
    .login-card p {
      font-size: 0.82rem;
      color: #8a7a9a;
      margin-bottom: 1.5rem;
      line-height: 1.5;
    }
    .gsi-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.6rem;
      width: 100%;
      padding: 0.65rem 1rem;
      border: 1.5px solid #e0dae6;
      border-radius: 8px;
      background: #fff;
      color: #3c4043;
      font-family: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      transition: box-shadow 0.2s, border-color 0.2s, transform 0.15s;
    }
    .gsi-button:hover {
      box-shadow: 0 2px 10px rgba(120, 60, 150, 0.12);
      border-color: #c9bdd6;
      transform: translateY(-1px);
    }
    .gsi-button svg { width: 18px; height: 18px; }
    .brand { display: flex; align-items: center; gap: 0.55rem; }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: 0 0 24px;
      padding: 2.5px;
      background: #fff;
      border-radius: 7px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18);
    }
    .brand-mark svg, .login-mark svg { display: block; width: 100%; height: 100%; }
    .login-mark {
      display: block;
      width: 40px;
      height: 40px;
      margin: 0 auto 0.9rem;
    }
    .notice-box {
      background: #f0ebf5;
      color: #6a4a8a;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      margin-bottom: 1.2rem;
      line-height: 1.4;
    }
    .error-box {
      background: #fee2e2;
      color: #b91c1c;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      margin-bottom: 1.2rem;
      line-height: 1.4;
    }`;

const GOOGLE_LOGO = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>`;

// Het RI&G-merkteken: vier isometrische blokken in de huisstijlkleuren.
// Inline SVG, zodat het ook als favicon (data-URI) werkt zonder extra request.
// De faviconvariant staat op een witte tegel en blijft zo leesbaar op een
// donkere tabbalk.
const RIG_LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="RI&amp;G"><polygon points="10.28,16.3 15.54,13.26 10.28,10.23 5.03,13.26" fill="#ef4b3c"/><polygon points="10.28,16.3 15.54,13.26 15.54,19.34 10.28,22.37" fill="#d33f33"/><polygon points="10.28,16.3 5.03,13.26 5.03,19.34 10.28,22.37" fill="#e6463c"/><polygon points="21.72,16.3 26.97,13.26 21.72,10.23 16.46,13.26" fill="#d8397f"/><polygon points="21.72,16.3 26.97,13.26 26.97,19.34 21.72,22.37" fill="#b92a68"/><polygon points="21.72,16.3 16.46,13.26 16.46,19.34 21.72,22.37" fill="#c93074"/><polygon points="16,13 21.26,9.96 16,6.93 10.74,9.96" fill="#fabb22"/><polygon points="16,13 21.26,9.96 21.26,16.04 16,19.07" fill="#e0a417"/><polygon points="16,13 10.74,9.96 10.74,16.04 16,19.07" fill="#f0b01d"/><polygon points="16,19.6 21.26,16.56 16,13.53 10.74,16.56" fill="#8442a3"/><polygon points="16,19.6 21.26,16.56 21.26,22.64 16,25.67" fill="#5f2d79"/><polygon points="16,19.6 10.74,16.56 10.74,22.64 16,25.67" fill="#71378f"/></svg>';

const RIG_FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-label="RI&amp;G"><rect width="32" height="32" rx="7" fill="#ffffff"/><polygon points="10.28,16.3 15.54,13.26 10.28,10.23 5.03,13.26" fill="#ef4b3c"/><polygon points="10.28,16.3 15.54,13.26 15.54,19.34 10.28,22.37" fill="#d33f33"/><polygon points="10.28,16.3 5.03,13.26 5.03,19.34 10.28,22.37" fill="#e6463c"/><polygon points="21.72,16.3 26.97,13.26 21.72,10.23 16.46,13.26" fill="#d8397f"/><polygon points="21.72,16.3 26.97,13.26 26.97,19.34 21.72,22.37" fill="#b92a68"/><polygon points="21.72,16.3 16.46,13.26 16.46,19.34 21.72,22.37" fill="#c93074"/><polygon points="16,13 21.26,9.96 16,6.93 10.74,9.96" fill="#fabb22"/><polygon points="16,13 21.26,9.96 21.26,16.04 16,19.07" fill="#e0a417"/><polygon points="16,13 10.74,9.96 10.74,16.04 16,19.07" fill="#f0b01d"/><polygon points="16,19.6 21.26,16.56 16,13.53 10.74,16.56" fill="#8442a3"/><polygon points="16,19.6 21.26,16.56 21.26,22.64 16,25.67" fill="#5f2d79"/><polygon points="16,19.6 10.74,16.56 10.74,22.64 16,25.67" fill="#71378f"/></svg>'
);

/** Loginpagina met "Inloggen met Google" knop. */
function loginPage(errorMessage, noticeMessage) {
  const errorHtml = errorMessage
    ? `<div class="error-box">${errorMessage}</div>`
    : '';
  const noticeHtml = noticeMessage
    ? `<div class="notice-box">${noticeMessage}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — RI&amp;G Screenshots</title>
  <link rel="icon" href="${RIG_FAVICON}" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="brand">
        <span class="brand-mark">${RIG_LOGO_SVG}</span>
        <h1>RI&amp;G Screenshots</h1>
      </div>
    </div>
  </header>
  <div class="login-wrap">
    <div class="login-card">
      <span class="login-mark">${RIG_LOGO_SVG}</span>
      <h2>Aanmelden</h2>
      <p>Log in met je <strong>@${ALLOWED_DOMAIN}</strong> account om de screenshots te bekijken.</p>
      ${noticeHtml}
      ${errorHtml}
      <a class="gsi-button" href="/auth/login">${GOOGLE_LOGO}<span>Inloggen met Google</span></a>
    </div>
  </div>
</body>
</html>`;
}

/* ---------------------------------------------------------------------------
 * Worker
 * ------------------------------------------------------------------------- */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const clientId = env.GOOGLE_CLIENT_ID;
    const clientSecret = env.GOOGLE_CLIENT_SECRET;
    const authSecret = env.AUTH_SECRET;

    // Auth is actief zodra de Google-credentials zijn ingesteld.
    // Zonder deze secrets is de viewer publiek toegankelijk (zoals voorheen).
    const authEnabled = Boolean(clientId && clientSecret && authSecret);

    if (authEnabled) {
      const redirectUri = `${url.origin}/auth/callback`;

      // --- Start Google OAuth flow ---
      if (url.pathname === '/auth/login') {
        const state = randomToken();
        const verifier = randomToken();
        const challenge = base64urlEncode(await sha256Bytes(verifier));

        const authUrl = new URL(GOOGLE_AUTH_URL);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', 'openid email profile');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', challenge);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('hd', ALLOWED_DOMAIN); // hint: beperk tot dit domein
        authUrl.searchParams.set('prompt', 'select_account');

        // Bewaar state + PKCE-verifier kortstondig in een HttpOnly cookie
        const stateValue = base64urlEncode(JSON.stringify({ state, verifier }));
        return new Response(null, {
          status: 302,
          headers: {
            'Location': authUrl.toString(),
            'Set-Cookie': buildSetCookie(STATE_COOKIE, stateValue, STATE_MAX_AGE),
          },
        });
      }

      // --- OAuth callback van Google ---
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const stateCookie = getCookie(request, STATE_COOKIE);

        if (!code || !returnedState || !stateCookie) {
          return loginResponse('Aanmelden mislukt. Probeer opnieuw.');
        }

        let stored;
        try {
          stored = JSON.parse(base64urlDecodeToString(stateCookie));
        } catch {
          return loginResponse('Aanmelden mislukt. Probeer opnieuw.');
        }

        if (!stored.state || !timingSafeEqual(returnedState, stored.state)) {
          return loginResponse('Ongeldige aanmeldsessie. Probeer opnieuw.');
        }

        // Wissel de autorisatiecode in voor tokens
        const tokenResp = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
            code_verifier: stored.verifier,
          }),
        });

        if (!tokenResp.ok) {
          return loginResponse('Aanmelden bij Google mislukt. Probeer opnieuw.');
        }

        const tokens = await tokenResp.json();
        const claims = decodeIdToken(tokens.id_token);

        if (!claims || !claims.email) {
          return loginResponse('Geen e-mailadres ontvangen van Google.');
        }

        // Verifieer het domein server-side (de hd-parameter is enkel een hint)
        const email = String(claims.email).toLowerCase();
        const domainOk = email.endsWith('@' + ALLOWED_DOMAIN) &&
          (!claims.hd || claims.hd === ALLOWED_DOMAIN);
        const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

        if (!domainOk || !emailVerified) {
          return loginResponse(
            `Geen toegang. Enkel geverifieerde @${ALLOWED_DOMAIN} accounts zijn toegelaten.`
          );
        }

        // Geldige gebruiker: sessie-cookie zetten, state-cookie wissen
        const session = await createSession(email, authSecret);
        const headers = new Headers({ 'Location': '/' });
        headers.append('Set-Cookie', buildSetCookie(SESSION_COOKIE, session, SESSION_MAX_AGE));
        headers.append('Set-Cookie', buildSetCookie(STATE_COOKIE, '', 0));
        return new Response(null, { status: 302, headers });
      }

      // --- Uitloggen (zowel /logout als /afmelden) ---
      if (url.pathname === '/logout' || url.pathname === '/afmelden') {
        const headers = new Headers({ 'Location': '/?afgemeld=1' });
        headers.append('Set-Cookie', buildSetCookie(SESSION_COOKIE, '', 0));
        headers.append('Set-Cookie', buildSetCookie(STATE_COOKIE, '', 0));
        return new Response(null, { status: 302, headers });
      }

      // --- Alle overige requests: geldige sessie vereist ---
      const sessionToken = getCookie(request, SESSION_COOKIE);
      const sessionEmail = await verifySession(sessionToken, authSecret);
      if (!sessionEmail) {
        const justLoggedOut = url.searchParams.get('afgemeld') === '1';
        return loginResponse(null, justLoggedOut ? 'Je bent afgemeld.' : null);
      }

      // Injecteer "ingelogd als … · Uitloggen" in de viewer-pagina
      const wantsHtmlPage = url.pathname === '/' || url.pathname === '/index.html';
      if (wantsHtmlPage && (request.method === 'GET' || request.method === 'HEAD')) {
        return serveIndexWithAccountBar(env, sessionEmail, request.method);
      }
    }

    // --- Bestaande proxy-logica ---
    const key = url.pathname.slice(1) || 'index.html';

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Afbeeldingen zijn immutable (bestandsnaam bevat timestamp): bewaar ze in
    // de edge-cache van Cloudflare. Zonder dit gaat elk verzoek — ook van een
    // collega die dezelfde screenshots bekijkt — opnieuw naar R2.
    const isImage = /\.(webp|jpg|jpeg|png)$/i.test(key);
    const cache = caches.default;
    const cacheable = isImage && request.method === 'GET';

    if (cacheable) {
      const cached = await cache.match(request);
      if (cached) return cached;
    }

    const object = await env.SCREENSHOTS_BUCKET.get(key);

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    // index.html wijzigt regelmatig, kort cachen
    if (isImage) {
      headers.set('cache-control', 'public, max-age=31536000, immutable');
    } else {
      headers.set('cache-control', 'public, max-age=300, s-maxage=60');
    }

    // HEAD verzoeken sturen geen body
    if (request.method === 'HEAD') {
      return new Response(null, { headers });
    }

    // R2-objecten met Content-Encoding: gzip decomprimeren, zodat
    // Cloudflare's edge de encoding zelf kan afhandelen. Zonder dit
    // ontvangt de browser rauwe gzip-bytes en toont het onleesbare tekens.
    let body = object.body;
    if (headers.get('content-encoding') === 'gzip') {
      headers.delete('content-encoding');
      body = body.pipeThrough(new DecompressionStream('gzip'));
    }

    const response = new Response(body, { headers });

    if (cacheable && ctx) {
      ctx.waitUntil(cache.put(request, response.clone()));
    }

    return response;
  },
};

/** Bouw een 401-response met de loginpagina (en optionele fout-/statusmelding). */
function loginResponse(errorMessage, noticeMessage) {
  return new Response(loginPage(errorMessage, noticeMessage), {
    status: 401,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** Escape tekst voor veilig gebruik in HTML. */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Toon "ingelogd als … · Afmelden" in de header van de viewer.
 *  De viewer bevat daarvoor een verborgen blok (#account-slot); dat wordt hier
 *  gevuld en zichtbaar gemaakt. Oudere index.html-versies zonder dat blok
 *  krijgen de chip via de fallbacks eronder. */
function injectAccountBar(html, email) {
  const slot = '<span class="account-slot" id="account-slot" hidden>';
  if (html.includes(slot)) {
    return html
      .replace(slot, '<span class="account-slot" id="account-slot">')
      .replace('<span id="account-email"></span>',
        `<span id="account-email">${escapeHtml(email)}</span>`);
  }

  const chip = `<span style="display:inline-flex;align-items:center;gap:0.55rem;font-size:0.72rem;` +
    `background:rgba(255,255,255,0.18);padding:0.28rem 0.75rem;border-radius:999px;white-space:nowrap;">` +
    `<span style="opacity:0.95;">${escapeHtml(email)}</span>` +
    `<a href="/logout" style="color:#fff;text-decoration:none;font-weight:600;` +
    `border-left:1px solid rgba(255,255,255,0.45);padding-left:0.55rem;">Afmelden</a></span>`;

  // Groepeer de bestaande "Laatste update"-paragraaf samen met de account-chip
  // rechts in de header (deterministische anchor uit generate-index.js).
  const datePattern = /<p>Laatste update:[^<]*<\/p>/;
  if (datePattern.test(html)) {
    return html.replace(datePattern, m =>
      `<div style="display:flex;align-items:center;gap:0.9rem;">${m}${chip}</div>`);
  }

  // Fallback: geen "Laatste update"-regel gevonden → chip vast in de hoek tonen
  return html.replace('</body>',
    `<div style="position:fixed;top:0.6rem;right:1.5rem;z-index:200;">${chip}</div></body>`);
}

/** Haal index.html uit R2, injecteer de account-balk en stuur het terug. */
async function serveIndexWithAccountBar(env, email, method) {
  const object = await env.SCREENSHOTS_BUCKET.get('index.html');
  if (!object) {
    return new Response('Not Found', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  // De pagina is per gebruiker aangepast → enkel in de browser van die gebruiker
  // cachen, en kort: de screenshots vernieuwen om het half uur.
  headers.set('cache-control', 'private, max-age=60');
  headers.set('content-type', 'text/html; charset=utf-8');

  if (method === 'HEAD') {
    headers.delete('content-length');
    return new Response(null, { headers });
  }

  // Body uitlezen (eventueel gzip-gedecomprimeerd) en de account-balk injecteren
  let stream = object.body;
  if (headers.get('content-encoding') === 'gzip') {
    headers.delete('content-encoding');
    stream = stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const original = await new Response(stream).text();
  const modified = injectAccountBar(original, email);

  headers.delete('content-length'); // lengte is gewijzigd door injectie
  return new Response(modified, { headers });
}

/** Decodeer het JWT-payload van een Google id_token (zonder verificatie:
 *  het token komt rechtstreeks via TLS van Google's token-endpoint). */
function decodeIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64urlDecodeToString(parts[1]));
  } catch {
    return null;
  }
}
