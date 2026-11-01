/* كيّال Service Worker — ADR-0010 (مُحدَّث جولة 3، 2026-10-31):
 * - القشرة العامة والأصول الساكنة فقط تُخزَّن مؤقتًا (Cache API).
 * - لا يُخزَّن أبدًا: HTML المُوثَّق، أي رد من /api/، حمولات RSC، الطفرات POST.
 * - البيانات المرجعية المحمية تعيش في IndexedDB (refcache) — تُمحى مع خروج
 *   الجهاز عبر مخزن عدم الاتصال، وليس في Cache API العام.
 */
const SHELL_CACHE = 'kayyal-public-shell-v2';
const STATIC_CACHE = 'kayyal-static-v2';
const SHELL = '/offline.html';
const SHELL_PRECASCADE = [
  SHELL,
  '/offline.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL_PRECASCADE.map((url) => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      const ours = key.startsWith('kayyal-public-shell-') || key.startsWith('kayyal-static-');
      if (ours && key !== SHELL_CACHE && key !== STATIC_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

const isStaticAsset = (url) => url.origin === self.location.origin
  && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')
    || url.pathname === '/manifest.webmanifest' || url.pathname === '/offline.js');

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return; // الطفرات لا يمسّها الوسيط أبدًا
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || request.headers.has('RSC') || url.searchParams.has('_rsc')) return;

  // أصول ساكنة ثابتة المحتوى: cache-first مع تعبئة رجعية — يسرّع التحميل حتى
  // مع شبكة متقطعة، ولا يحتوي أي بيانات أعمال.
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        // dون شبكة: أصول القشرة المسبقة (offline.js وملحقاته) من مخبأ القشرة
        const shellHit = await (await caches.open(SHELL_CACHE)).match(request);
        if (shellHit) return shellHit;
      }
      return Response.error();
    })());
    return;
  }

  // التنقلات: الشبكة أولًا؛ وعند انقطاعها تُقدَّم القشرة العامة (لا أي صفحة
  // محمية مخزنة — تلك لا تُخزَّن أصلًا).
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const shell = await (await caches.open(SHELL_CACHE)).match(SHELL);
      return shell ?? new Response('غير متصل — أعد المحاولة عند عودة الشبكة', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }));
  }
});
