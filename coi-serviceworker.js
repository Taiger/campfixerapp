// Enables SharedArrayBuffer on GitHub Pages by injecting the two security headers
// (COOP + COEP) that the host can't set itself.  sqlite-wasm's OPFS VFS requires
// both headers; without them the worker thread fails to open the database.
//
// Dual-role file:
//   • Page script  — registers this file as a service worker, then reloads once active.
//   • Service worker — intercepts every fetch and stamps the required headers onto responses.

(function () {
  "use strict";

  // ── Service-worker role ─────────────────────────────────────────────────────

  if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
    // Take control of all clients immediately — skip the normal waiting phase.
    self.addEventListener("install",  () => self.skipWaiting());
    self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

    self.addEventListener("fetch", event => {
      // Opaque no-cors requests can't receive custom headers; skip them.
      if (event.request.cache === "only-if-cached" && event.request.mode !== "same-origin") {
        return;
      }

      event.respondWith(
        fetch(event.request)
          .then(response => {
            if (!response || response.status === 0) return response;

            const headers = new Headers(response.headers);
            headers.set("Cross-Origin-Opener-Policy",   "same-origin");
            headers.set("Cross-Origin-Embedder-Policy", "require-corp");

            return new Response(response.body, {
              status:     response.status,
              statusText: response.statusText,
              headers,
            });
          })
          .catch(() => fetch(event.request)) // Network error — passthrough unmodified.
      );
    });

    return; // Nothing more to do inside the SW global.
  }

  // ── Page-script role ────────────────────────────────────────────────────────

  if (!("serviceWorker" in navigator)) return; // Browser doesn't support SWs — give up.
  if (window.crossOriginIsolated)      return; // Already isolated — SW not needed.

  navigator.serviceWorker
    .register("coi-serviceworker.js")
    .then(registration => {
      // New SW installed: wait for it to reach "installed" state, then reload.
      // skipWaiting() above means activation follows almost immediately.
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });

      // SW already active from a prior visit but page isn't isolated yet — reload now.
      if (registration.active && !window.crossOriginIsolated) {
        window.location.reload();
      }
    })
    .catch(err => console.warn("COI service worker registration failed:", err));
})();
