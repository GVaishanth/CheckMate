const BUILD = 'source';
const SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg'];
const ROOT = new URL(self.registration.scope);
const PREFIX = `checkmate:${encodeURIComponent(ROOT.pathname)}:`;
const CACHE = `${PREFIX}${BUILD}`;
const FILES = new Set(SHELL.map((path) => new URL(path, ROOT).href));
const INDEX = new URL('index.html', ROOT).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith(PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== ROOT.origin) return;
  if (request.mode === 'navigate' && (url.pathname === ROOT.pathname || url.pathname === new URL(INDEX).pathname)) {
    event.respondWith(caches.open(CACHE).then((cache) => cache.match(INDEX, { ignoreVary: true }))
      .then((hit) => hit ?? fetch(request))
      .catch(() => new Response('CHECKMATE is not cached. Reconnect once to prepare offline play.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
    return;
  }
  if (!FILES.has(url.href)) return;
  // Module and font requests add Origin; these public static files do not vary by it.
  event.respondWith(caches.open(CACHE).then((cache) => cache.match(request, { ignoreVary: true }))
    .then((hit) => hit ?? fetch(request)));
});
