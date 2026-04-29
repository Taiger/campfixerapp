// Service worker providing offline support via a cache-first strategy.
//
// Cache versioning
// ────────────────
// Bump CACHE_NAME (e.g. v4 → v5) whenever the asset list changes.  The activate
// handler deletes every cache whose name doesn't match CACHE_NAME, so old cached
// files are purged the moment the new SW takes control.
//
// skipWaiting + clients.claim
// ───────────────────────────
// self.skipWaiting() in the install handler lets the new SW bypass the normal
// "wait for all tabs to close" phase and activate immediately after install.
// self.clients.claim() in activate then takes control of all open tabs right
// away, so the fresh cache is served without requiring a manual reload.
// Together they ensure code changes are never blocked behind a stale SW.

// All app assets to pre-cache at install time.
const CACHE_NAME = 'campfixer-cache-v7';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/manifest.webmanifest',
  '/coi-serviceworker.js', // Must be cached so it's available offline for re-registration.
  '/src/main.js',
  '/src/app.js',
  '/src/storage.js',
  '/src/templates.js',
  '/src/db.js',
  '/vendor/lit/lit-html.js',
  '/vendor/sqlite/index.mjs',
  '/vendor/sqlite/sqlite3-worker1.mjs',
  '/vendor/sqlite/sqlite3.wasm',
  '/vendor/sqlite/sqlite3-opfs-async-proxy.js',
];

// Pre-caches all listed assets and immediately claims control so the new SW
// serves updated files without requiring the user to close all tabs first.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Purges caches from previous versions and claims all open clients so stale
// files (served by the old SW) are replaced as soon as this SW activates.
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )),
    ])
  );
});

// Serves from cache when available; falls back to network for uncached requests.
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
