export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const key = url.pathname.slice(1) || 'index.html';

    if (request.method !== 'GET') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const object = await env.SCREENSHOTS_BUCKET.get(key);

    if (!object) {
      return new Response('Not Found', { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('cache-control', 'public, max-age=3600');

    return new Response(object.body, { headers });
  },
};
