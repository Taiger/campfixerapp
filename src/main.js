import { initApp } from './app.js';

window.addEventListener('DOMContentLoaded', () => {
  initApp();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/src/service-worker.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  }
});
