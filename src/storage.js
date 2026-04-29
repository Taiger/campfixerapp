// Persistence layer: all reads and writes to the SQLite DB go through here.
// Exports CRUD functions for Plans and Trips, plus two-way sync helpers.
//
// Domain model
// ─────────────
// Plan    — a reusable camping checklist with a default set of items.
//           Stored in the `templates` DB table (legacy column name).
// Trip    — a specific outing created from a Plan. Items may diverge from
//           the source Plan over time. Stored in the `plans` DB table.
// TripItem — one line-item on a Trip. Stored in the `plan_items` DB table.
//
// DB column → in-memory field mappings (legacy names kept to avoid migrations)
// ─────────────────────────────────────────────────────────────────────────────
// templates.id            → plan.id
// plans.templateId        → trip.planId
// plan_items.planItemId   → tripItem.tripItemId
// plan_items.planId       → tripItem.tripId
// plan_items.sourceTemplateId → tripItem.sourcePlanId
// plan_items.sourceItemId → tripItem.sourcePlanItemId
//
// Sync model overview
// ───────────────────
// Plans are the source of truth for what items belong in a trip type.
// Trips are instances of a Plan for a specific outing; they may diverge from
// their Plan over time (items added, removed, or renamed per-trip).
//
// Two operations keep Plans and Trips in sync:
//
//   syncTripWithPlan (pull) — copies Plan items not yet in the Trip.
//     Triggered by "Sync with plan". Identified by sourcePlanItemId: only
//     Plan items whose id is absent from trip.items[*].sourcePlanItemId are new.
//
//   pushTripItemsToPlan (push) — promotes Trip-only items back to the Plan.
//     Triggered by "Push items to plan". Items with no sourcePlanItemId (or a
//     stale one not found in the Plan) are Trip-exclusive and worth sharing.
//     After the push, each promoted item gets a sourcePlanItemId so future
//     syncs won't re-add it.
//
// plan.version drives the "sync available" signal: when a trip's
// lastSyncedVersion is behind plan.version, new items may be available.
// Version is bumped on every Plan save and on every push.

import { exec, run, transaction } from './db.js';
import { createDefaultPlans, cleanPlan, generateId } from './templates.js';

// ─── Plans ────────────────────────────────────────────────────────────────────
// A Plan is a reusable camping checklist. Stored in the `templates` DB table.

// Seeds default Plans on first launch if the table is empty; otherwise maps rows to objects.
export async function loadPlans() {
  const rows = await exec('SELECT * FROM templates ORDER BY rowid ASC');
  if (rows.length === 0) {
    const seeds = createDefaultPlans();
    for (const p of seeds) await _insertPlan(p);
    return seeds;
  }
  return rows.map(_rowToPlan);
}

// Replaces the entire Plans table in a single transaction (used for bulk reorder/save).
export async function savePlans(plans) {
  await transaction(async () => {
    await run('DELETE FROM templates');
    for (const p of plans) await _insertPlan(p);
  });
}

// Validates and inserts a single new Plan; returns the cleaned object.
export async function createPlan(plan) {
  const clean = cleanPlan(plan);
  await _insertPlan(clean);
  return clean;
}

// Bumps version and updatedAt, then upserts the updated Plan; returns the full list.
export async function updatePlan(updatedPlan) {
  const all = await loadPlans();
  const index = all.findIndex(p => p.id === updatedPlan.id);
  if (index !== -1) {
    const next = cleanPlan(updatedPlan);
    next.version = (all[index].version || 1) + 1;
    next.updatedAt = new Date().toISOString().split('T')[0];
    all[index] = next;
    await _upsertPlan(next);
  }
  return all;
}

// Deletes a Plan by id and returns the refreshed Plan list.
export async function deletePlan(planId) {
  await run('DELETE FROM templates WHERE id = ?', [planId]);
  return loadPlans();
}

// Maps a `templates` DB row to a Plan object, parsing the JSON-serialised item list.
function _rowToPlan(row) {
  let defaultItems = [];
  try { defaultItems = JSON.parse(row.data); } catch (_) {}
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    version: row.version,
    updatedAt: row.updatedAt || '',
    defaultItems,
  };
}

// Simple INSERT into `templates` — used for bulk writes where conflicts are not expected.
async function _insertPlan(p) {
  await run(
    `INSERT INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [p.id, p.name, p.description || '', p.version || 1, p.updatedAt || '', JSON.stringify(p.defaultItems || [])]
  );
}

// INSERT OR REPLACE into `templates` — used for single-record updates (conflict = overwrite).
async function _upsertPlan(p) {
  await run(
    `INSERT OR REPLACE INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [p.id, p.name, p.description || '', p.version || 1, p.updatedAt || '', JSON.stringify(p.defaultItems || [])]
  );
}

// ─── Trips ────────────────────────────────────────────────────────────────────
// A Trip is a specific outing created from a Plan. Stored in the `plans` DB table.

// Loads all Trips, fetching each Trip's TripItems in a per-trip query.
export async function loadTrips() {
  const trips = await exec('SELECT * FROM plans ORDER BY rowid ASC');
  const result = [];
  for (const t of trips) {
    const items = await exec(
      `SELECT * FROM plan_items WHERE planId = ? ORDER BY rowid ASC`,
      [t.id]
    );
    result.push(_rowToTrip(t, items));
  }
  return result;
}

// Replaces all Trips and their TripItems in a single transaction (used for bulk reorder/save).
export async function saveTrips(trips) {
  await transaction(async () => {
    await run('DELETE FROM plan_items');
    await run('DELETE FROM plans');
    for (const t of trips) {
      await run(
        `INSERT INTO plans
         (id, templateId, name, startDate, endDate, locationUrl, description, lastSyncedVersion, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id, t.planId || '', t.name, t.startDate || '', t.endDate || '',
          t.locationUrl || '', t.description || '', t.lastSyncedVersion || 1, t.createdAt || '',
        ]
      );
      for (const item of (t.items || [])) await _insertTripItem(item, t.id);
    }
  });
}

// Copies Plan.defaultItems into TripItems, recording sourcePlanItemId on each so
// future syncs can identify which Plan items are already present in the Trip.
export async function createTripFromPlan(plan, tripName) {
  const items = (plan.defaultItems || []).map(item => ({
    tripItemId: generateId('trip'),
    sourcePlanId: plan.id,
    sourcePlanItemId: item.id,
    name: item.name,
    importance: item.importance,
    description: item.description,
    size: item.size,
    weight: item.weight,
    packed: false,
    extraFields: item.extraFields || {},
  }));

  return {
    id: generateId('trip'),
    name: tripName || `${plan.name} trip`,
    planId: plan.id,
    startDate: '',
    endDate: '',
    locationUrl: '',
    description: '',
    createdAt: new Date().toISOString(),
    lastSyncedVersion: plan.version || 1,
    items,
  };
}

// Persists a new Trip with all its TripItems; returns the refreshed Trip list.
export async function addTrip(trip) {
  await transaction(async () => {
    await run(
      `INSERT INTO plans
       (id, templateId, name, startDate, endDate, locationUrl, description, lastSyncedVersion, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trip.id, trip.planId || '', trip.name, trip.startDate || '', trip.endDate || '',
        trip.locationUrl || '', trip.description || '', trip.lastSyncedVersion || 1, trip.createdAt || '',
      ]
    );
    for (const item of (trip.items || [])) await _insertTripItem(item, trip.id);
  });
  return loadTrips();
}

// Replaces a Trip's header row and all its TripItems (used for edits and post-sync saves).
export async function updateTrip(trip) {
  await transaction(async () => {
    await run(
      `INSERT OR REPLACE INTO plans
       (id, templateId, name, startDate, endDate, locationUrl, description, lastSyncedVersion, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trip.id, trip.planId || '', trip.name, trip.startDate || '', trip.endDate || '',
        trip.locationUrl || '', trip.description || '', trip.lastSyncedVersion || 1, trip.createdAt || '',
      ]
    );
    await run('DELETE FROM plan_items WHERE planId = ?', [trip.id]);
    for (const item of (trip.items || [])) await _insertTripItem(item, trip.id);
  });
  return loadTrips();
}

// Deletes a Trip and all its TripItems; returns the refreshed Trip list.
export async function deleteTrip(tripId) {
  await transaction(async () => {
    await run('DELETE FROM plan_items WHERE planId = ?', [tripId]);
    await run('DELETE FROM plans WHERE id = ?', [tripId]);
  });
  return loadTrips();
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

// One-way pull: appends any Plan items the Trip doesn't already have.
// Matching is done by sourcePlanItemId, NOT by name — so a renamed Plan item
// is still considered "already in the Trip" as long as its id is present.
// Updates lastSyncedVersion to the Plan's current version.
// Does not persist — caller must await updateTrip(trip) afterwards.
export async function syncTripWithPlan(trip, plan) {
  const existingSourceIds = new Set(trip.items.map(i => i.sourcePlanItemId).filter(Boolean));
  const newItems = (plan.defaultItems || [])
    .filter(item => !existingSourceIds.has(item.id))
    .map(item => ({
      tripItemId: generateId('trip'),
      sourcePlanId: plan.id,
      sourcePlanItemId: item.id,
      name: item.name,
      importance: item.importance,
      description: item.description,
      size: item.size,
      weight: item.weight,
      packed: false,
      extraFields: item.extraFields || {},
    }));

  if (newItems.length > 0) trip.items = [...trip.items, ...newItems];
  trip.lastSyncedVersion = plan.version || trip.lastSyncedVersion;
  return trip;
}

// One-way push: promotes Trip-exclusive items back to the Plan so future Trips
// and syncs can include them.  A TripItem is "Trip-exclusive" when it has no
// sourcePlanItemId, or its sourcePlanItemId doesn't match any current Plan item
// (meaning the source item was deleted from the Plan after the Trip was made).
//
// After pushing, each promoted TripItem receives a new sourcePlanItemId pointing
// to the freshly created Plan item — this prevents future syncs from re-adding
// the same item again.  plan.version is bumped so other Trips can detect the
// new items via their lastSyncedVersion comparison.
//
// Returns { plan, trip, addedCount }.  Caller must persist both objects:
//   await updatePlan(result.plan);
//   await updateTrip(result.trip);
export async function pushTripItemsToPlan(trip, plan) {
  const existingIds = new Set(plan.defaultItems.map(i => i.id));
  const itemsToAdd = trip.items.filter(
    item => !item.sourcePlanItemId || !existingIds.has(item.sourcePlanItemId)
  );

  if (itemsToAdd.length === 0) return { plan, trip, addedCount: 0 };

  const newPlanItems = itemsToAdd.map(item => ({
    id: generateId('item'),
    name: item.name,
    importance: item.importance,
    description: item.description,
    size: item.size || '',
    weight: item.weight || '',
    extraFields: item.extraFields || {},
  }));

  // Map each original tripItemId to its newly assigned Plan item id so we
  // can back-fill sourcePlanItemId on the Trip without a second array scan.
  const idMap = new Map(itemsToAdd.map((item, i) => [item.tripItemId, newPlanItems[i].id]));

  const updatedPlan = {
    ...plan,
    defaultItems: [...plan.defaultItems, ...newPlanItems],
    version: (plan.version || 1) + 1,
    updatedAt: new Date().toISOString().split('T')[0],
  };

  const updatedTrip = {
    ...trip,
    items: trip.items.map(item => {
      const newSourcePlanItemId = idMap.get(item.tripItemId);
      if (!newSourcePlanItemId) return item;
      return { ...item, sourcePlanItemId: newSourcePlanItemId, sourcePlanId: plan.id };
    }),
    lastSyncedVersion: updatedPlan.version,
  };

  return { plan: updatedPlan, trip: updatedTrip, addedCount: newPlanItems.length };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Maps a `plans` DB row + its `plan_items` rows to a plain JS Trip object.
// SQLite stores booleans as 0/1 integers, so packed is coerced to boolean here.
function _rowToTrip(row, itemRows) {
  return {
    id: row.id,
    planId: row.templateId,        // DB column: templateId → in-memory: planId
    name: row.name,
    startDate: row.startDate || '',
    endDate: row.endDate || '',
    locationUrl: row.locationUrl || '',
    description: row.description || '',
    lastSyncedVersion: row.lastSyncedVersion,
    createdAt: row.createdAt,
    items: itemRows.map(r => ({
      tripItemId: r.planItemId,            // DB column: planItemId   → tripItemId
      tripId: r.planId,                    // DB column: planId       → tripId
      sourcePlanId: r.sourceTemplateId || null,  // DB column: sourceTemplateId → sourcePlanId
      sourcePlanItemId: r.sourceItemId || null,  // DB column: sourceItemId     → sourcePlanItemId
      name: r.name,
      importance: r.importance,
      description: r.description,
      size: r.size,
      weight: r.weight,
      packed: r.packed === 1,
      extraFields: (() => { try { return JSON.parse(r.extraFields || '{}'); } catch (_) { return {}; } })(),
    })),
  };
}

// Inserts a TripItem into `plan_items`, mapping in-memory names back to DB column names.
async function _insertTripItem(item, tripId) {
  await run(
    `INSERT INTO plan_items (planItemId, planId, sourceTemplateId, sourceItemId, name, importance, description, size, weight, packed, extraFields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.tripItemId,                   // DB column: planItemId
      tripId,                            // DB column: planId
      item.sourcePlanId || null,         // DB column: sourceTemplateId
      item.sourcePlanItemId || null,     // DB column: sourceItemId
      item.name || '', item.importance || 'Medium', item.description || '',
      item.size || '', item.weight || '', item.packed ? 1 : 0,
      JSON.stringify(item.extraFields || {}),
    ]
  );
}
