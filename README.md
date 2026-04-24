# Campfixer

Campfixer is a lightweight Progressive Web App for planning car camping packing lists using custom templates. The app is built with vanilla JavaScript, stores data in the browser, and supports template-driven plan creation plus template-update sync.

## What this app does

- Create car camping templates that include packing items
- Store each template item with:
  - name
  - importance rating
  - description
  - optional size
  - optional weight
- Create a packing plan from any template
- Keep plans in sync when templates add new default items
- Persist templates and plans locally in the browser
- Work offline for static UI assets via a service worker

## Data model

### Template
- `id`
- `name`
- `description`
- `version`
- `updatedAt`
- `defaultItems` (array of template items)

### Item
- `id`
- `name`
- `importance`
- `description`
- `size` (optional)
- `weight` (optional)

### Packing plan
- `id`
- `name`
- `templateId`
- `createdAt`
- `lastSyncedVersion`
- `items`

## How it works

1. Start on the dashboard and open the Templates view.
2. Create or edit a template and add default packing items.
3. Open Packing Plans and create a new plan from a template.
4. The new plan is preloaded with the template's default items.
5. When you update a template by adding new default items, open the plan and use "Sync with template" to pull only the new items into the plan.

## Running locally

From the project root, run a simple static server and open the app in your browser.

```bash
cd /mnt/chromeos/GoogleDrive/MyDrive/Projects/campfixerapp
python3 -m http.server 8000
```

Then visit:

```text
http://localhost:8000
```

## PWA support

- `manifest.webmanifest` defines the PWA metadata
- `src/service-worker.js` caches static assets for offline access
- `icons/icon-192.png` and `icons/icon-512.png` are the PWA icons

## GitHub Pages deployment

This project can be hosted as a static site on GitHub Pages. After adding a Git remote, push to a branch such as `main` or `gh-pages` and enable Pages in the repository settings.

## Project structure

- `index.html` — app shell, view templates, and page structure
- `style.css` — dark-themed app styling and layout
- `manifest.webmanifest` — PWA metadata and app icons
- `package.json` — local development and syntax-check scripts
- `src/main.js` — app bootstrap and service worker registration
- `src/app.js` — UI rendering, user interactions, and view state
- `src/storage.js` — local storage handling, plan creation, and sync logic
- `src/templates.js` — default template seed data and template utilities
- `src/service-worker.js` — caching strategy for offline support
- `icons/` — PWA icon assets
