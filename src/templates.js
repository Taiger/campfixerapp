// Built-in starter template shown to new users on first launch.
// Add more objects here to seed additional default templates.
const DEFAULT_TEMPLATES = [
  {
    id: 'template-car-camping-1',
    name: 'Car Camping Essentials',
    description: 'A starter template for a comfortable car camping trip.',
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

// localStorage key where all templates are persisted as a JSON string.
const STORAGE_KEY = 'campfixer:templates';

// Generates a short random ID with the given prefix, e.g. "item-x7k2a9b".
function generateId(prefix = 'item') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneTemplate(template) {
  return JSON.parse(JSON.stringify(template));
}

function createDefaultTemplates() {
  return DEFAULT_TEMPLATES.map(cloneTemplate);
}

// Returns templates from localStorage, seeding defaults if storage is empty or corrupt.
// Troubleshooting: if templates keep resetting, localStorage may be clearing between sessions
// (private/incognito mode, or storage quota exceeded).
function getSeedTemplates() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seed = createDefaultTemplates();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Invalid templates');
    }
    return parsed;
  } catch (error) {
    // Storage was present but unparseable — fall back to defaults.
    const seed = createDefaultTemplates();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    return seed;
  }
}

function saveTemplates(templates) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

// Fills in missing fields with safe defaults so old/incomplete saved data doesn't break the UI.
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
