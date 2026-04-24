# Campfixer

Campfixer is a lightweight Progressive Web App for planning car camping packing lists using custom templates. The app is built with vanilla JavaScript, stores data in the browser, and supports template-driven plan creation with two-way sync between plans and templates.

## What this app does

- Create car camping templates that include default packing items
- Store each template item with:
  - name
  - importance rating (High / Medium / Low)
  - description
  - optional size
  - optional weight
- Create a packing plan from any template
- Mark individual items as packed
- Sync plans with their source template to pull in newly added template items
- Push new plan items back to the source template so other plans can benefit
- Persist templates and plans locally in the browser
- Work offline for static UI assets via a service worker

## Data model

### Template
- `id` — unique identifier (e.g. `template-x7k2a9b`)
- `name`
- `description`
- `version` — incremented each time the template is saved; used by plans to detect sync opportunities
- `updatedAt` — ISO date string of the last save
- `defaultItems` — array of template items (see below)

### Template item
- `id` — unique identifier (e.g. `item-x7k2a9b`)
- `name`
- `importance` — `"High"`, `"Medium"`, or `"Low"`
- `description`
- `size` (optional)
- `weight` (optional)

### Packing plan
- `id` — unique identifier (e.g. `plan-x7k2a9b`)
- `name`
- `templateId` — id of the template this plan was created from
- `createdAt` — ISO timestamp
- `lastSyncedVersion` — template version at the time of last sync
- `items` — array of plan items (see below)

### Plan item
- `planItemId` — unique identifier for this item within the plan
- `sourceTemplateId` — id of the template this item came from (`null` if added manually)
- `sourceItemId` — id of the template item this was copied from (`null` if added manually)
- `name`
- `importance`
- `description`
- `size`
- `weight`
- `packed` — boolean; toggled with the Packed / Unpack button

`sourceItemId` is the key field for sync logic. When syncing a plan with its template, only template items whose `id` does not appear as a `sourceItemId` in the plan are added. When pushing plan items to a template, items with `sourceItemId: null` (or a stale id not found in the template) are the ones sent back.

## How it works

1. Start on the dashboard and open the Templates view.
2. Create or edit a template and add default packing items.
3. Open Packing Plans and create a new plan from a template.
4. The new plan is preloaded with the template's default items.
5. Add extra items to the plan as needed. These have no `sourceItemId`.
6. **Sync with template** — pulls any new default items added to the template into the plan since it was last synced.
7. **Push items to template** — sends any new plan items (those without a `sourceItemId`) back to the source template, so future plans or syncs can include them.

## Running locally

From the project root, start a simple static server and open the app in your browser.

```bash
cd /mnt/chromeos/GoogleDrive/MyDrive/Projects/campfixerapp
python3 -m http.server 8000
```

Then visit:

```
http://localhost:8000
```

## PWA support

- `manifest.webmanifest` defines the PWA metadata
- `src/service-worker.js` caches static assets for offline access
- `icons/icon-192.png` and `icons/icon-512.png` are the PWA icons

## GitHub Pages deployment

This project can be hosted as a static site on GitHub Pages. After adding a Git remote, push to a branch such as `main` or `gh-pages` and enable Pages in the repository settings.

## Project structure

```
index.html              — app shell, <template> elements for each view, page structure
style.css               — dark-themed app styling and layout
manifest.webmanifest    — PWA metadata and app icons
package.json            — local development scripts
src/main.js             — app bootstrap and service worker registration
src/app.js              — UI rendering, event wiring, and in-memory state management
src/storage.js          — localStorage read/write, plan/template CRUD, and sync logic
src/templates.js        — default seed data, template validation utilities
src/service-worker.js   — caching strategy for offline support
icons/                  — PWA icon assets (192px and 512px)
```

## Troubleshooting

**Templates or plans keep resetting** — The app seeds defaults when localStorage is empty or corrupt. This can happen in private/incognito mode or if the browser clears storage. Check DevTools → Application → Local Storage for the keys `campfixer:templates` and `campfixer:plans`.

**Sync with template adds nothing** — The sync only adds items that aren't already tracked by `sourceItemId`. If all template items are already in the plan (even if their content changed), nothing is added. Sync does not update existing items — only adds missing ones.

**Push items to template adds nothing** — Only items with `sourceItemId: null` (manually added) or a stale `sourceItemId` (template item was deleted) are pushed. Items originally copied from the template are excluded.

**Delete button does nothing on first press** — This is intentional. The delete button requires two taps within 3 seconds to confirm. The first press turns the button amber and changes its label to "Tap again to confirm".
