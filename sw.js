/* Service worker for Min Radio PWA (static hosting, e.g. GitHub Pages).
 * Strategy:
 *  - App shell (HTML/CSS/JS/manifest/icons): network-first with cache fallback,
 *    so updates arrive promptly but the app still opens offline.
 *  - SR API/feed requests: network-only (live data); UI handles failures.
 * Uses RELATIVE paths so the app works under any base path (e.g. /repo-name/).
 */

const CACHE_NAME = 'minradio-cb4632c3';
const SHELL_ASSETS = [
  './',
  './index.html',
  './styles.bf58aa11.css',
  './app.90c4a484.js',
  './help.html',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  // Only handle same-origin (the app's own files). SR API/feed traffic and all
  // cross-origin requests pass through untouched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('./index.html'))
      )
  );
});
