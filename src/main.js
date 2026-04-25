import { initDB } from './db.js';
import { migrateFromLocalStorage } from './storage.js';
import { initApp } from './app.js';

function updateThemeIcon(isDark) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = isDark ? '☀' : '🌙';
}

function updateThemeColor(isDark) {
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = isDark ? '#0f172a' : '#f8fafc';
}

function showLoadingState() {
  const main = document.getElementById('app-main');
  if (main) main.innerHTML = '<p class="text-slate-500 dark:text-slate-400 text-sm p-4">Loading database…</p>';
}

function showErrorState(err) {
  const main = document.getElementById('app-main');
  if (main) main.innerHTML = `<p class="text-red-500 text-sm p-4">Failed to initialise storage: ${err.message}</p>`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const isDark = document.documentElement.classList.contains('dark');
  updateThemeIcon(isDark);
  updateThemeColor(isDark);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nowDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('campfixer:theme', nowDark ? 'dark' : 'light');
    updateThemeIcon(nowDark);
    updateThemeColor(nowDark);
  });

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

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/src/service-worker.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  }
});
