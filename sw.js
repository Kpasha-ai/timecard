const CACHE_NAME = 'timecard-shell-v2';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// IMPORTANT: never intercept the app's own HTML or JS. A navigation request
// (loading the page itself) or a request for the page document must always
// go straight to the network with no service-worker involvement at all —
// that's what caused a stale build to stick around after a real redeploy.
// Only truly static, rarely-changing assets (icons) get a light cache.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate' || req.destination === 'document' || req.destination === 'script') return;

  if (req.destination === 'image') {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      }))
    );
  }
});
