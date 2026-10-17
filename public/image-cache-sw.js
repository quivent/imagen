/* Cache only public artwork encountered by this browser, never app/API state. */
const CACHE = 'kinship-artwork-images-v1';
function artwork(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === '/api/gallery/image') return Boolean(url.searchParams.get('key'));
  return /^\/data\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp|avif)$/i.test(url.pathname);
}
async function remember(cache, request, response) {
  if (response.ok && (response.headers.get('Content-Type') || '').startsWith('image/')) {
    try { await cache.put(request, response.clone()); } catch { /* Quota/storage trouble must not hide a usable image. */ }
  }
}
async function image(request) {
  let cache;
  try { cache = await caches.open(CACHE); } catch { return fetch(request); }
  let cached;
  try { cached = await cache.match(request); } catch { return fetch(request); }
  const url = new URL(request.url);
  const versioned = /^[a-f0-9]{64}$/i.test(url.searchParams.get('sha256') || '');
  // Known content hashes are immutable cache identities across reloads/tabs.
  if (cached && versioned) return cached;
  try {
    const headers = new Headers(request.headers);
    if (cached?.headers.get('ETag')) headers.set('If-None-Match', cached.headers.get('ETag'));
    else if (cached?.headers.get('Last-Modified')) headers.set('If-Modified-Since', cached.headers.get('Last-Modified'));
    const response = await fetch(request, { headers });
    if (response.status === 304 && cached) return cached;
    if (!response.ok && cached) return cached;
    await remember(cache, request, response);
    return response;
  } catch (problem) {
    if (cached) return cached;
    throw problem;
  }
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('kinship-artwork-images-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method === 'GET' && artwork(new URL(event.request.url))) event.respondWith(image(event.request));
});
