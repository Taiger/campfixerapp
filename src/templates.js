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
// Size categories for camping items — relative to packing volume.
// These are the only valid values for PlanItem.size and TripItem.size.
export const SIZE_OPTIONS = [
  { value: 'Tiny',   label: 'Tiny (toothpick)'         },
  { value: 'Small',  label: 'Small (deck of cards)'    },
  { value: 'Medium', label: 'Medium (loaf of bread)'   },
  { value: 'Large',  label: 'Large (portable fire pit)' },
];

function planItem(id, name, importance, size, weight, description = '') {
  return {
    id,
    name,
    importance,
    description,
    size,
    weight,
    extraFields: {},
  };
}

// Built-in starter Plan shown to new users on first launch.
const DEFAULT_PLANS = [
  {
    id: 'template-car-camping-1', // legacy prefix — changing would orphan existing DB rows
    name: 'Car Camping Essentials',
    description: 'A starter plan for a comfortable camping trip.',
    version: 1,
    updatedAt: '2026-04-29',
    defaultItems: [
      planItem('tent', 'Tent', 'High', 'Large', '5', 'Shelter for sleeping and storing gear.'),
      planItem('sleeping-bag', 'Sleeping bag', 'High', 'Medium', '3', 'Warm sleeping bag rated for the season.'),
      planItem('headlamp', 'Headlamp', 'Medium', 'Tiny', '0.5', 'Hands-free light source for night tasks.'),
      planItem('camp-chair', 'Camp chair', 'Low', 'Large', '4', 'Portable chair for comfort around the fire.'),
    ],
  },
  {
    id: 'template-complete-backpacking-1',
    name: 'Complete Backpacking Checklist',
    description: 'A comprehensive backpacking checklist with estimated carried weights.',
    version: 1,
    updatedAt: '2026-04-29',
    defaultItems: [
      planItem('backpacking-first-aid-kit', 'First-aid kit', 'High', 'Small', '0.5', 'Compact kit with blister care and personal medications.'),
      planItem('backpacking-trail-maps', 'Trail map(s)', 'High', 'Tiny', '0.1', 'Paper maps or printed route notes in a waterproof sleeve.'),
      planItem('backpacking-backcountry-permit', 'Backcountry permit if needed', 'Medium', 'Tiny', '0.05', 'Required permit or reservation paperwork when applicable.'),
      planItem('backpacking-passport', 'Passport if needed', 'Medium', 'Tiny', '0.1', 'Identification for international or border-area trips.'),
      planItem('backpacking-camera-kit', 'Camera, spare battery, camera pack', 'Low', 'Small', '1.2', 'Optional photo kit; weight varies widely by camera system.'),
      planItem('backpacking-book', 'Book', 'Low', 'Small', '0.6', 'Optional camp entertainment.'),
      planItem('backpacking-pack-cover', 'Backpack, pack cover if needed', 'High', 'Large', '3.5', 'Overnight backpack with rain cover or pack liner.'),
      planItem('backpacking-daypack', 'Daypack (lightweight and optional, for side hikes)', 'Low', 'Small', '0.7', 'Packable daypack for side hikes from camp.'),
      planItem('backpacking-sleeping-bag', 'Sleeping bag', 'High', 'Medium', '2', 'Season-appropriate backpacking sleeping bag.'),
      planItem('backpacking-pad-pillow', 'Air mattress/sleeping pad, inflatable pillow', 'High', 'Medium', '1.2', 'Sleeping pad plus small inflatable pillow.'),
      planItem('backpacking-camp-chair', 'Camp chair', 'Low', 'Medium', '1.2', 'Optional lightweight backpacking chair.'),
      planItem('backpacking-tent-tarp', 'Tent/tarp', 'High', 'Large', '2.5', 'Backpacking shelter with stakes and guylines.'),
      planItem('backpacking-toiletries', 'Toiletries, toothbrush, small amount of toothpaste, floss', 'Medium', 'Small', '0.4', 'Minimal hygiene kit.'),
      planItem('backpacking-toilet-paper', 'Double-bagged toilet paper (for packing out used TP)', 'Medium', 'Small', '0.2', 'Pack-out toilet paper in sealed bags.'),
      planItem('backpacking-stove-fuel', 'Stove and fuel', 'High', 'Small', '1', 'Backpacking stove and enough fuel for planned meals.'),
      planItem('backpacking-cooking-kit', 'Cooking kit', 'High', 'Small', '0.8', 'Cook pot, lid, pot grabber, and cleaning basics.'),
      planItem('backpacking-utensils', 'Utensils', 'Medium', 'Tiny', '0.1', 'Spoon, spork, or compact utensil set.'),
      planItem('backpacking-dining-set', 'Mug/bowl/plate', 'Medium', 'Small', '0.4', 'Minimal eating and drinking setup.'),
      planItem('backpacking-water-storage', 'Water bottle(s), bladder', 'High', 'Medium', '0.5', 'Empty bottle and/or hydration reservoir weight.'),
      planItem('backpacking-water-treatment', 'Water treatment', 'High', 'Tiny', '0.3', 'Filter, purifier, drops, or tablets.'),
      planItem('backpacking-trekking-poles', 'Trekking poles', 'Medium', 'Medium', '1', 'Pair of lightweight trekking poles.'),
      planItem('backpacking-headlamp', 'Headlamp, batteries', 'High', 'Tiny', '0.3', 'Headlamp with spare batteries or charge.'),
      planItem('backpacking-navigation-tools', 'Compass/GPS/altimeter', 'High', 'Tiny', '0.4', 'Navigation tools to supplement paper maps.'),
      planItem('backpacking-fire-starter', 'Matches/lighter', 'High', 'Tiny', '0.1', 'Waterproof matches, lighter, or both.'),
      planItem('backpacking-repair-kit', 'Multi-tool/knife, tape, cord (for hanging food)', 'High', 'Small', '0.7', 'Repair and utility kit for camp tasks.'),
      planItem('backpacking-stuff-sacks', 'Stuff sacks', 'Medium', 'Small', '0.3', 'Organization and moisture protection.'),
      planItem('backpacking-eye-protection', 'Sunglasses, eyeglasses, case', 'Medium', 'Small', '0.3', 'Eye protection and prescription eyewear case.'),
      planItem('backpacking-bug-protection', 'Bug repellent/bug nets', 'Medium', 'Small', '0.5', 'Insect repellent and bug netting when needed.'),
      planItem('backpacking-sun-protection', 'Sunscreen, lip balm', 'Medium', 'Small', '0.3', 'Sun protection for exposed trail days.'),
      planItem('backpacking-footwear', 'Boots/shoes, camp footwear', 'High', 'Large', '3', 'Primary hiking footwear plus lightweight camp footwear.'),
      planItem('backpacking-gaiters', 'Gaiters/low gaiters', 'Low', 'Small', '0.4', 'Optional protection for debris, mud, or wet brush.'),
      planItem('backpacking-gloves', 'Gloves/mittens', 'Medium', 'Small', '0.3', 'Hand warmth for cool mornings and evenings.'),
      planItem('backpacking-hats', 'Warm hat, earband, sun hat, rain hat', 'Medium', 'Medium', '0.5', 'Headwear for sun, rain, and cold.'),
      planItem('backpacking-rain-shell', 'Rain shell', 'High', 'Medium', '0.8', 'Waterproof breathable shell layer.'),
      planItem('backpacking-shirts', 'T-shirt, long-sleeve shirt', 'Medium', 'Medium', '0.8', 'Trail shirts for layering and sun protection.'),
      planItem('backpacking-bottoms', 'Shorts, pants', 'Medium', 'Medium', '1', 'Trail bottoms for changing conditions.'),
      planItem('backpacking-long-underwear', 'Long underwear', 'Medium', 'Medium', '0.7', 'Base layer for sleeping or cold weather.'),
      planItem('backpacking-underwear', 'Underwear', 'Medium', 'Small', '0.3', 'Trip-appropriate underwear.'),
      planItem('backpacking-puffy', 'Insulation/puffy jacket', 'High', 'Medium', '1', 'Warm insulating layer for camp and cold weather.'),
      planItem('backpacking-socks', 'Socks', 'High', 'Small', '0.4', 'Hiking socks plus dry spare pair.'),
    ],
  },
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

export {
  createDefaultPlans,
  cleanPlan,
  normalizePlanItem,
  generateId,
};
