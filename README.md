# Campfixer

NOTE: app is unreleased, so expect breaking changes!

Campfixer is a Progressive Web App for planning camping packing lists. You build reusable templates of default gear items, create trip-specific packing plans from those templates, mark items packed as you load the car, and sync plans back and forth with their source template as your kit evolves.

All data is stored locally in the browser using **SQLite WASM + OPFS** — no server, no account, no sync service. The app works fully offline once loaded.

---

## Features

- Create camping templates with default packing items
- Store each item with name, importance (High / Medium / Low), description, optional size, and optional weight
- Create a packing plan from any template — the plan is pre-loaded with the template's default items
- Mark individual items packed/unpacked during loading
- **Sync with template** — pulls new default items added to the template since the plan was last synced
- **Push items to template** — sends plan-exclusive items back to the source template so future plans and syncs can include them
- Download a backup of the SQLite database file
- Full offline support via a service worker
- Light and dark mode

---

## Tech stack

| Layer | Technology |
|---|---|
| Language | Vanilla JavaScript (ES modules) |
| Styling | Tailwind CSS v3 (compiled to `style.css`) |
| Storage | SQLite WASM (`@sqlite.org/sqlite-wasm`) via OPFS VFS |
| Worker bridge | `sqlite3Worker1Promiser` (v2, from the sqlite-wasm package) |
| PWA | Web App Manifest + Cache-first service worker |
| Headers shim | `coi-serviceworker.js` (COOP/COEP injection for GitHub Pages) |

---

## Architecture

```
main thread
  └─ main.js            bootstrap: initDB → initApp
  └─ app.js             UI: render functions, event handlers, in-memory state
  └─ storage.js         CRUD + sync helpers; calls db.js
  └─ db.js              promiser bridge → sqlite3-worker1.mjs

worker thread (Web Worker)
  └─ sqlite3-worker1.mjs    official sqlite-wasm worker (vendored)
  └─ sqlite3.wasm            SQLite compiled to WASM
  └─ sqlite3-opfs-async-proxy.js   OPFS VFS async proxy
```

**Why a worker?** The OPFS synchronous I/O API that SQLite needs is blocked on the main thread by the browser. All SQL runs in the worker; the main thread sends messages and awaits results via the promiser bridge.

**Why OPFS?** OPFS (Origin Private File System) gives SQLite a persistent, randomly-accessible file on the user's device. Unlike `localStorage` (string-only, ~5 MB limit, synchronous) or IndexedDB (document store), OPFS supports the byte-level I/O that SQLite expects, has a much higher storage quota, and survives browser cache clears.

---

## Data model

### Template

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `template-x7k2a9b` |
| `name` | string | |
| `description` | string | |
| `version` | integer | incremented on every save; used by plans to detect new items |
| `updatedAt` | string | ISO date (`YYYY-MM-DD`) |
| `defaultItems` | array | see Template item below |

### Template item

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `item-x7k2a9b` |
| `name` | string | |
| `importance` | string | `"High"` \| `"Medium"` \| `"Low"` |
| `description` | string | |
| `size` | string | optional |
| `weight` | string | optional |

### Packing plan

| Field | Type | Notes |
|---|---|---|
| `id` | string | e.g. `plan-x7k2a9b` |
| `name` | string | |
| `templateId` | string | id of the source template |
| `createdAt` | string | ISO timestamp |
| `lastSyncedVersion` | integer | template version at last sync; used to flag when a sync is available |
| `items` | array | see Plan item below |

### Plan item

| Field | Type | Notes |
|---|---|---|
| `planItemId` | string | unique within the plan |
| `sourceTemplateId` | string \| null | `null` if added manually to the plan |
| `sourceItemId` | string \| null | id of the template item this was copied from; `null` if added manually |
| `name` | string | |
| `importance` | string | |
| `description` | string | |
| `size` | string | |
| `weight` | string | |
| `packed` | boolean | toggled with Pack / Unpack |

**`sourceItemId` is the key field for sync.** When syncing a plan with its template, only template items whose `id` is absent from `plan.items[*].sourceItemId` are added. When pushing plan items to the template, items with `sourceItemId: null` (or a stale id no longer in the template) are the candidates.

---

## Sync model

```
Template  ──── Sync with template ────▶  Plan
              (pull: adds missing items)

Template  ◀─── Push items to template ── Plan
              (push: promotes plan-only items)
```

Neither operation overwrites existing items — sync only adds, push only appends. This means:

- Renaming an item in the template after it was synced to a plan does **not** rename it in the plan.
- Deleting an item from the template does **not** remove it from existing plans.
- Pushing an item sets its `sourceItemId`, so subsequent syncs won't re-add it.

---

## Browser requirements

| Requirement | Why |
|---|---|
| **SharedArrayBuffer** | Required by the sqlite-wasm OPFS VFS for zero-copy worker communication |
| **OPFS** (Origin Private File System) | The persistent storage VFS used by SQLite |
| **Web Workers** | All SQL runs in a worker; blocked on the main thread by design |

These APIs are available in Chrome 102+, Firefox 111+, and Safari 16.4+. The app will not work in older browsers or in environments where SharedArrayBuffer is disabled.

**On GitHub Pages**, the necessary `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` security headers are injected by `coi-serviceworker.js` (a service worker shim loaded before any other script). These headers enable SharedArrayBuffer on hosts that can't set server-level headers.

---

## Running locally

From the project root, start any static HTTP server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

> **Note:** `localhost` is treated as a secure context by browsers, so SharedArrayBuffer and OPFS work without the COI service worker. The `coi-serviceworker.js` is still loaded but detects `window.crossOriginIsolated === true` and exits early.

---

## Vendor setup

The SQLite WASM files are vendored under `vendor/sqlite/` and committed to the repository. If you need to update them:

```bash
npm install          # installs @sqlite.org/sqlite-wasm
npm run copy-sqlite  # copies the four required files into vendor/sqlite/
```

The four files required at runtime:

| File | Purpose |
|---|---|
| `vendor/sqlite/index.mjs` | JS module entry point; exports `sqlite3Worker1Promiser` |
| `vendor/sqlite/sqlite3-worker1.mjs` | Worker script that owns the WASM instance |
| `vendor/sqlite/sqlite3.wasm` | The SQLite engine compiled to WebAssembly |
| `vendor/sqlite/sqlite3-opfs-async-proxy.js` | OPFS VFS async proxy loaded by the worker |

---

## CSS build

Tailwind CSS is compiled from `src/input.css` to `style.css`. After editing `input.css` or any file that contains Tailwind class names:

```bash
npm run build:css
```

The compiled `style.css` is committed to the repository so the app runs without a build step in production.

---

## GitHub Pages deployment

Push to `main` (or `gh-pages`) and enable Pages in the repository Settings → Pages → Source. No build step is required — `style.css` and the vendored SQLite files are already committed.

**COOP/COEP headers:** GitHub Pages cannot serve custom response headers. `coi-serviceworker.js` works around this by registering a service worker on first load that intercepts every subsequent fetch and injects the required `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. The page reloads once after the service worker activates; from then on every request has the headers and SharedArrayBuffer is available.

---

## Project structure

```
index.html                  app shell and <template> elements for each view
style.css                   compiled Tailwind output (do not edit directly)
manifest.webmanifest        PWA metadata and icon references
tailwind.config.js          Tailwind configuration (theme extensions, content paths)
package.json                dev scripts (build:css, copy-sqlite, check, start)
coi-serviceworker.js        COOP/COEP header injection shim for GitHub Pages
src/
  main.js                   bootstrap: DB init → migration → UI boot → SW registration
  app.js                    UI: render functions, event handlers, in-memory state
  storage.js                SQLite CRUD for templates and plans; sync helpers
  db.js                     sqlite3Worker1Promiser bridge; schema creation
  templates.js              default seed data, id generation, validation utilities
  service-worker.js         cache-first offline strategy; skipWaiting/clients.claim
  input.css                 Tailwind source (edit this, not style.css)
vendor/
  sqlite/
    index.mjs               sqlite-wasm JS entry point
    sqlite3-worker1.mjs     Web Worker entry point for the sqlite-wasm worker API
    sqlite3.wasm            SQLite compiled to WebAssembly
    sqlite3-opfs-async-proxy.js  OPFS VFS async bridge
icons/
  icon-192.png              PWA icon (home screen, small)
  icon-512.png              PWA icon (splash screen, large)
```

---

## Troubleshooting

**"Failed to initialise storage" on first load**
The OPFS database failed to open. Most likely cause: the page is not cross-origin isolated (`window.crossOriginIsolated === false`). Open DevTools → Application → Service Workers and check that `coi-serviceworker.js` is registered and active. If it isn't, unregister any stale service workers, clear site data, and hard-reload.

**App still shows old data after an update**
The old service worker may still be serving cached files. Open DevTools → Application → Service Workers → click Unregister, then hard-reload (`Cmd+Shift+R` / `Ctrl+Shift+R`). The new service worker uses `skipWaiting` + `clients.claim` so this should only be needed when transitioning from an older version that lacked those calls.

**Sync with template adds nothing**
Sync only adds template items whose `id` is absent from the plan's `sourceItemId` values. If all template items are already tracked (even if their name or details changed), nothing is added. Sync does not update existing plan items — it only appends missing ones.

**Push items to template adds nothing**
Only items with `sourceItemId: null` (added manually to the plan) or a stale `sourceItemId` (the source template item was deleted) are pushed. Items that were originally copied from the template already have a valid `sourceItemId` and are excluded.

**Delete button does nothing on first press**
Intentional. Delete requires two taps within 3 seconds. The first tap turns the button amber and changes the label to "Tap again to confirm". This prevents accidental deletions on touch screens.

**Data disappeared after clearing browser storage**
"Clear site data" in DevTools removes the OPFS database. Use the "Download database" button on the Dashboard or Plan detail view to save a backup `.db` file before clearing storage. The file can be opened with any SQLite tool (e.g. DB Browser for SQLite) but cannot currently be re-imported into the app.
