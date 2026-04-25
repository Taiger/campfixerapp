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

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
