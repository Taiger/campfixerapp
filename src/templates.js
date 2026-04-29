// Pure data utilities for Plans: seed data, ID generation, cloning, and validation.
// No I/O — all reads and writes go through storage.js.
//
// Domain model
// ─────────────
// Plan     — a reusable camping checklist with a default set of items.
//            Stored in the `templates` DB table (legacy column name).
// PlanItem — one line-item on a Plan; copied into TripItems when a Trip is created.
// Trip     — a specific outing created from a Plan. Stored in the `plans` DB table.
//
// NOTE: getSeedTemplates() and saveTemplates() at the bottom of this file are
// left over from the localStorage era and are no longer called by anything.
// They are kept in case a future export/import feature needs them.

// Size categories for camping items — relative to packing volume.
// These are the only valid values for PlanItem.size and TripItem.size.
export const SIZE_OPTIONS = [
  { value: 'Tiny',   label: 'Tiny (toothpick)'         },
  { value: 'Small',  label: 'Small (deck of cards)'    },
  { value: 'Medium', label: 'Medium (loaf of bread)'   },
  { value: 'Large',  label: 'Large (portable fire pit)' },
];

// Built-in starter Plan shown to new users on first launch.
const DEFAULT_PLANS = [
  {
    id: 'template-car-camping-1', // legacy prefix — changing would orphan existing DB rows
    name: 'Camping Essentials',
    description: 'A starter plan for a comfortable camping trip.',
    version: 1,
    updatedAt: '2026-04-24',
    defaultItems: [
      {
        id: 'tent',
        name: 'Tent',
        importance: 'High',
        description: 'Shelter for sleeping and storing gear.',
        size: 'Large',
        weight: '5',
        extraFields: {}
      },
      {
        id: 'sleeping-bag',
        name: 'Sleeping bag',
        importance: 'High',
        description: 'Warm sleeping bag rated for the season.',
        size: 'Medium',
        weight: '3',
        extraFields: {}
      },
      {
        id: 'headlamp',
        name: 'Headlamp',
        importance: 'Medium',
        description: 'Hands-free light source for night tasks.',
        size: 'Tiny',
        weight: '0.5',
        extraFields: {}
      },
      {
        id: 'camp-chair',
        name: 'Camp chair',
        importance: 'Low',
        description: 'Portable chair for comfort around the fire.',
        size: 'Large',
        weight: '4',
        extraFields: {}
      }
    ]
  }
];

// ─── Active utilities ──────────────────────────────────────────────────────────

// Generates a short random ID with the given prefix, e.g. "plan-x7k2a9b".
// Math.random is fine here — IDs only need to be locally unique, not cryptographic.
function generateId(prefix = 'item') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// Deep-clones a Plan so mutations to the copy can't corrupt the original.
function clonePlan(plan) {
  return JSON.parse(JSON.stringify(plan));
}

// Returns fresh copies of the built-in defaults — called by loadPlans() when
// the SQLite templates table is empty (i.e. first ever launch on this device).
function createDefaultPlans() {
  return DEFAULT_PLANS.map(clonePlan);
}

// Fills in missing fields with safe defaults so old/incomplete saved data
// doesn't crash downstream rendering or SQLite inserts.
function normalizePlanItem(item) {
  return {
    id: item.id || generateId('item'),
    name: item.name || '',
    importance: item.importance || 'Medium',
    description: item.description || '',
    size: item.size || '',
    weight: item.weight || '',
    extraFields: item.extraFields || {},
  };
}

// Returns a fully validated Plan object — used before saving to prevent bad shapes in storage.
function cleanPlan(plan) {
  return {
    id: plan.id || generateId('plan'),
    name: plan.name || 'New plan',
    description: plan.description || '',
    version: plan.version || 1,
    updatedAt: plan.updatedAt || new Date().toISOString().split('T')[0],
    defaultItems: (plan.defaultItems || []).map(normalizePlanItem),
  };
}

// ─── Superseded localStorage helpers (kept for reference, not called) ─────────

const STORAGE_KEY = 'campfixer:templates';

function getSeedTemplates() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seed = createDefaultPlans();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('Invalid data');
    return parsed;
  } catch {
    const seed = createDefaultPlans();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function saveTemplates(plans) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
}

export {
  STORAGE_KEY,
  createDefaultPlans,
  getSeedTemplates,
  saveTemplates,
  cleanPlan,
  normalizePlanItem,
  generateId,
};
