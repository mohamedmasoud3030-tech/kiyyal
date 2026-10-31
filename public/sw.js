/* Public fallback only. Never cache authenticated HTML, API, RSC, or mutations. */
const CACHE = 'kayyal-public-shell-v1';
const SHELL = '/offline.html';
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add(new Request(SHELL, { cache: 'reload' }))));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('kayyal-public-shell-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).catch(async () => {
    const shell = await (await caches.open(CACHE)).match(SHELL);
    return shell ?? new Response('غير متصل — أعد المحاولة عند عودة الشبكة', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }));
});
