import { initApp } from './app.js';

// Updates the theme toggle icon to reflect the current mode.
function updateThemeIcon(isDark) {
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = isDark ? '☀' : '🌙';
}

// Updates the <meta name="theme-color"> so the browser chrome matches the app theme.
function updateThemeColor(isDark) {
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = isDark ? '#0f172a' : '#f8fafc';
}

window.addEventListener('DOMContentLoaded', () => {
  // Sync icon with whatever class the inline <head> script already applied.
  const isDark = document.documentElement.classList.contains('dark');
  updateThemeIcon(isDark);
  updateThemeColor(isDark);

  // Theme toggle button — saves preference so the <head> script can apply it next visit.
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const nowDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('campfixer:theme', nowDark ? 'dark' : 'light');
    updateThemeIcon(nowDark);
    updateThemeColor(nowDark);
  });

  // Hamburger menu — toggles .nav-open on the nav so it's visible on mobile.
  // On md+ screens the nav is always visible via CSS regardless of this class.
  const nav = document.getElementById('app-nav');
  document.getElementById('open-menu').addEventListener('click', () => {
    nav.classList.toggle('nav-open');
  });

  // Close the mobile nav whenever a nav button is pressed.
  nav.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => nav.classList.remove('nav-open'));
  });

  initApp();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/src/service-worker.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  }
});
