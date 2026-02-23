// Cookie-naam en levensduur (30 dagen)
const AUTH_COOKIE = 'screenshots_auth';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Genereer een SHA-256 hex-hash van de opgegeven tekst.
 * Wordt gebruikt om een verificatie-token te maken voor de auth-cookie.
 */
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

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

/** HTML-loginpagina in dezelfde stijl als de screenshot viewer. */
function loginPage(error) {
  const errorHtml = error
    ? '<div style="background:#fee2e2;color:#b91c1c;padding:0.5rem 1rem;border-radius:8px;font-size:0.85rem;margin-bottom:1rem;">Verkeerd wachtwoord. Probeer opnieuw.</div>'
    : '';

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — RI&amp;G Screenshots</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
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
      max-width: 380px;
      width: 100%;
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
    }
    .login-card label {
      display: block;
      font-size: 0.72rem;
      font-weight: 600;
      color: #6a5a7a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.4rem;
    }
    .login-card input[type="password"] {
      width: 100%;
      padding: 0.6rem 0.9rem;
      border: 1.5px solid #e0dae6;
      border-radius: 8px;
      font-family: inherit;
      font-size: 0.9rem;
      color: #2d2d3a;
      background: #faf8fc;
      transition: border-color 0.2s, box-shadow 0.2s;
      margin-bottom: 1.2rem;
    }
    .login-card input[type="password"]:focus {
      outline: none;
      border-color: #783c96;
      box-shadow: 0 0 0 3px rgba(120, 60, 150, 0.12);
    }
    .login-card button {
      width: 100%;
      padding: 0.65rem;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #783c96, #d23278);
      color: #fff;
      font-family: inherit;
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s, transform 0.15s;
    }
    .login-card button:hover { opacity: 0.92; transform: translateY(-1px); }
    .login-card button:active { transform: translateY(0); }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <h1>RI&amp;G Screenshots</h1>
    </div>
  </header>
  <div class="login-wrap">
    <div class="login-card">
      <h2>Aanmelden</h2>
      <p>Voer het wachtwoord in om de screenshots te bekijken.</p>
      ${errorHtml}
      <form method="POST" action="/login">
        <label for="password">Wachtwoord</label>
        <input type="password" id="password" name="password" required autofocus>
        <button type="submit">Inloggen</button>
      </form>
    </div>
  </div>
</body>
</html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const password = env.AUTH_PASSWORD;

    // --- Wachtwoordbeveiliging (overslaan als geen AUTH_PASSWORD secret is ingesteld) ---
    if (password) {
      const expectedToken = await sha256('screenshots_auth_' + password);

      // POST /login: wachtwoord controleren
      if (url.pathname === '/login' && request.method === 'POST') {
        const formData = await request.formData();
        const submitted = formData.get('password') || '';

        if (submitted === password) {
          return new Response(null, {
            status: 302,
            headers: {
              'Location': '/',
              'Set-Cookie': buildSetCookie(AUTH_COOKIE, expectedToken, COOKIE_MAX_AGE),
            },
          });
        }

        // Verkeerd wachtwoord: toon loginpagina opnieuw met foutmelding
        return new Response(loginPage(true), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      // GET /logout: cookie verwijderen
      if (url.pathname === '/logout') {
        return new Response(null, {
          status: 302,
          headers: {
            'Location': '/',
            'Set-Cookie': buildSetCookie(AUTH_COOKIE, '', 0),
          },
        });
      }

      // Alle andere requests: cookie valideren
      const token = getCookie(request, AUTH_COOKIE);
      if (token !== expectedToken) {
        return new Response(loginPage(false), {
          status: 401,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    }

    // --- Bestaande proxy-logica ---
    const key = url.pathname.slice(1) || 'index.html';

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const object = await env.SCREENSHOTS_BUCKET.get(key);

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);

    // Afbeeldingen zijn immutable (bestandsnaam bevat timestamp), lang cachen
    // index.html wijzigt regelmatig, kort cachen
    const isImage = /\.(webp|jpg|jpeg|png)$/i.test(key);
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

    return new Response(body, { headers });
  },
};
