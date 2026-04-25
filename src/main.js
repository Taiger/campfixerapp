// App entry point: initialises the database, runs any one-time migrations,
// boots the UI, and registers the service worker for offline support.
//
// Initialisation sequence (DOMContentLoaded)
// ───────────────────────────────────────────
//   1. Apply theme immediately (already done by inline <head> script to avoid flash)
//   2. showLoadingState  — placeholder while the SQLite worker starts
//   3. initDB            — starts the Web Worker, opens campfixer.db in OPFS
//   4. migrateFromLocalStorage — one-time copy of any pre-migration data, then clears it
//   5. initApp           — loads templates + plans from SQLite, renders dashboard
//   6. Register service worker — non-blocking; failure is non-fatal
//
// Theme storage exception
// ───────────────────────
// Theme preference is the one piece of data still stored in localStorage (key:
// 'campfixer:theme').  It must be readable synchronously in a tiny inline <head>
// script so the correct background colour is applied before the first paint,
// preventing a white flash on dark-mode devices.  SQLite/OPFS is async and
// worker-based — it cannot be read that early in the page lifecycle.

import { initDB } from './db.js';
import { migrateFromLocalStorage } from './storage.js';
import { initApp } from './app.js';

// Updates the sun/moon icon to match the active theme.
function updateThemeIcon(isDark) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = isDark ? '☀' : '🌙';
}

// Updates <meta name="theme-color"> so the browser chrome matches the active theme.
function updateThemeColor(isDark) {
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = isDark ? '#0f172a' : '#f8fafc';
}

// Shows a placeholder while the SQLite worker and OPFS database initialise.
function showLoadingState() {
  const main = document.getElementById('app-main');
  if (main) main.innerHTML = '<p class="text-slate-500 dark:text-slate-400 text-sm p-4">Loading database…</p>';
}

// Replaces the loading placeholder with a fatal error message if init fails.
function showErrorState(err) {
  const main = document.getElementById('app-main');
  if (main) main.innerHTML = `<p class="text-red-500 text-sm p-4">Failed to initialise storage: ${err.message}</p>`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const isDark = document.documentElement.classList.contains('dark');
  updateThemeIcon(isDark);
  updateThemeColor(isDark);

  // Persist to localStorage (not SQLite) — the inline <head> script reads it
  // synchronously to set the 'dark' class before first paint (see note above).
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nowDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('campfixer:theme', nowDark ? 'dark' : 'light');
    updateThemeIcon(nowDark);
    updateThemeColor(nowDark);
  });

  // Hamburger: toggle .nav-open on the nav; any nav-btn click closes it.
  const nav = document.getElementById('app-nav');
  document.getElementById('open-menu').addEventListener('click', () => nav.classList.toggle('nav-open'));
  nav.querySelectorAll('.nav-btn').forEach(btn => btn.addEventListener('click', () => nav.classList.remove('nav-open')));

  showLoadingState();

  try {
    await initDB();
    await migrateFromLocalStorage();
    await initApp();
  } catch (err) {
    console.error('DB init failed:', err);
    showErrorState(err);
    return;
  }

  // Service worker registration happens after the app is ready; failure is
  // non-fatal — the app still works online without it.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/src/service-worker.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  }
});
