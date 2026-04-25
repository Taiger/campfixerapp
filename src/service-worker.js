// Service worker providing offline support via a cache-first strategy.
// Bump CACHE_NAME whenever the asset list changes — clients with the old cache
// name will download the new assets on next visit and activate the updated SW.

// All app assets to pre-cache at install time.
const CACHE_NAME = 'campfixer-cache-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/src/main.js',
  '/src/app.js',
  '/src/storage.js',
  '/src/templates.js',
  '/src/db.js',
  '/vendor/sqlite/index.mjs',
  '/vendor/sqlite/sqlite3-worker1.mjs',
  '/vendor/sqlite/sqlite3.wasm',
  '/vendor/sqlite/sqlite3-opfs-async-proxy.js',
];

// Pre-caches all listed assets so the app works offline immediately after install.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Purges caches from previous versions once this SW takes control of all clients.
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

// Serves from cache when available; falls back to network for uncached requests.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
