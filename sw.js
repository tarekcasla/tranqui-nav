/* Service worker de Tranqui — cachea el "shell" para que abra rápido / offline.
 * Los mapas y el ruteo necesitan internet (no se cachean). */
const CACHE = 'tranqui-v2';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'vendor/maplibre-gl.js',
  'vendor/maplibre-gl.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Tiles/ruteo/búsqueda (cross-origin): red normal, sin tocar.
  if (url.origin !== location.origin) return;
  // Shell propio: network-first (código fresco si hay internet), cache como respaldo offline.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return resp;
      })
      .catch(() => caches.match(e.request))
  );
});
