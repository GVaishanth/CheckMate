/* Production builds include all bundled assets in SHELL. */
const CACHE = 'checkmate-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put('./', copy)).catch(() => undefined);
          return res;
        })
        .catch(() => caches.match('./').then((r) => r ?? caches.match('./index.html'))),
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE).then((cache) => cache.match(req, { ignoreVary: true })).catch(() => undefined).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
        }
        return res;
      });
    }),
  );
});
