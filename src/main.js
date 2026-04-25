// App entry point: initialises the database, runs any one-time migrations,
// boots the UI, and registers the service worker for offline support.

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

  // Persist the choice to localStorage so the inline <head> script can apply
  // it before first paint on the next load, preventing a theme flash.
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
