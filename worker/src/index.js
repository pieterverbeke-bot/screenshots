export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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

    return new Response(object.body, { headers });
  },
};
