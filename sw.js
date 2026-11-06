// Offline support. App files: network first so updates show up at once, cache when offline.
// Fonts: cache first, they never change.
const CACHE = 'tapeline-v3';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/ar.js', 'js/tools.js', 'js/estimators.js', 'js/ui.js', 'js/units.js', 'js/store.js', 'js/geometry.js',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isFont = url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com';

  if (isFont) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { put(req, res); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => { if (res.ok) put(req, res); return res; })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
