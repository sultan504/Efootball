// ==================================================================
// Service worker — caches the static app shell only.
// Supabase requests (live scores, teams, auth) are never cached here,
// so admins and players always see live data; only the HTML/CSS/JS/
// icons that make up the app itself are served from cache when offline.
// ==================================================================

const CACHE_NAME = 'efootball-shell-v1';
const SHELL_FILES = [
  'index.html',
  'admin.html',
  'css/style.css',
  'js/main.js',
  'js/admin.js',
  'js/config.js',
  'manifest.json',
  'manifest-admin.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache Supabase API calls or the Supabase JS CDN bundle —
  // those must always be live/network.
  if (url.hostname.includes('supabase.co') || url.hostname.includes('jsdelivr.net')) {
    return;
  }

  // Only handle same-origin GET requests for the shell.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
