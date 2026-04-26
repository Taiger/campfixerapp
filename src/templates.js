// Pure data utilities for templates: seed data, id generation, cloning, and validation.
// No I/O — all reads and writes go through storage.js.
//
// NOTE: getSeedTemplates() and saveTemplates() at the bottom of this file are
// left over from the localStorage era and are no longer called by anything.
// They are kept here in case a future export/import feature needs them, but the
// live storage path is exclusively through storage.js → db.js (SQLite/OPFS).

// Built-in starter template shown to new users on first launch.
// Add more objects here to seed additional default templates.
const DEFAULT_TEMPLATES = [
  {
    id: 'template-car-camping-1',
    name: 'camping Essentials',
    description: 'A starter template for a comfortable camping trip.',
    version: 1,
    updatedAt: '2026-04-24',
    defaultItems: [
      {
        id: 'tent',
        name: 'Tent',
        importance: 'High',
        description: 'Shelter for sleeping and storing gear.',
        size: '2-person',
        weight: '5 lb'
      },
      {
        id: 'sleeping-bag',
        name: 'Sleeping bag',
        importance: 'High',
        description: 'Warm sleeping bag rated for the season.',
        size: 'Regular',
        weight: '3 lb'
      },
      {
        id: 'headlamp',
        name: 'Headlamp',
        importance: 'Medium',
        description: 'Hands-free light source for night tasks.',
        weight: '0.5 lb'
      },
      {
        id: 'camp-chair',
        name: 'Camp chair',
        importance: 'Low',
        description: 'Portable chair for comfort around the fire.',
        weight: '4 lb'
      }
    ]
  }
];

// ─── Superseded localStorage helpers (kept for reference, not called) ─────────
// These were the storage layer before the SQLite/OPFS migration.
// The active storage path is storage.js → db.js.

// Key used to store the templates array in localStorage before the migration.
const STORAGE_KEY = 'campfixer:templates';

// Returns templates from localStorage, seeding defaults if storage is empty or corrupt.
// Not called by the app — replaced by storage.js loadTemplates().
function getSeedTemplates() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seed = createDefaultTemplates();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid templates');
    return parsed;
  } catch {
    const seed = createDefaultTemplates();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

// Persists the templates array to localStorage.
// Not called by the app — replaced by storage.js saveTemplates().
function saveTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

// ─── Active utilities ──────────────────────────────────────────────────────────

// Generates a short random ID with the given prefix, e.g. "item-x7k2a9b".
// Math.random is fine here — IDs only need to be locally unique, not cryptographic.
function generateId(prefix = 'item') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// Deep-clones a template so mutations to the copy can't corrupt the original.
function cloneTemplate(template) {
  return JSON.parse(JSON.stringify(template));
}

// Returns fresh copies of the built-in defaults — called by loadTemplates() when
// the SQLite templates table is empty (i.e. first ever launch on this device).
function createDefaultTemplates() {
  return DEFAULT_TEMPLATES.map(cloneTemplate);
}

// Fills in missing fields with safe defaults so old/incomplete saved data
// (e.g. items that were hand-typed before description/size/weight existed)
// doesn't crash downstream rendering or SQLite inserts.
function normalizeTemplateItem(item) {
  return {
    id: item.id || generateId('item'),
    name: item.name || '',
    importance: item.importance || 'Medium',
    description: item.description || '',
    size: item.size || '',
    weight: item.weight || ''
  };
}

// Returns a fully validated template object — used before saving to prevent bad shapes in storage.
function cleanTemplate(template) {
  return {
    id: template.id || generateId('template'),
    name: template.name || 'New template',
    description: template.description || '',
    version: template.version || 1,
    updatedAt: template.updatedAt || new Date().toISOString().split('T')[0],
    defaultItems: (template.defaultItems || []).map(normalizeTemplateItem)
  };
}

export {
  STORAGE_KEY,
  createDefaultTemplates,
  getSeedTemplates,
  saveTemplates,
  cleanTemplate,
  normalizeTemplateItem,
  generateId
};
