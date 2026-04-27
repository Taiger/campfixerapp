// Persistence layer: all reads and writes to the SQLite DB go through here.
// Exports CRUD functions for templates and plans, plus two-way sync helpers.
//
// Sync model overview
// ───────────────────
// Templates are the source of truth for what items belong in a trip type.
// Plans are instances of a template for a specific trip; they may diverge from
// their template over time (items added, removed, or renamed per-trip).
//
// Two operations keep templates and plans in sync:
//
//   syncPlanWithTemplate (pull)  — copies template items not yet in the plan.
//     Triggered by "Sync with template".  Identified by sourceItemId: only
//     template items whose id is absent from plan.items[*].sourceItemId are new.
//
//   pushPlanItemsToTemplate (push) — promotes plan-only items to the template.
//     Triggered by "Push items to template".  Items with no sourceItemId (or a
//     stale one not found in the template) are considered plan-exclusive and
//     worth sharing.  After the push, each promoted item gets a sourceItemId so
//     future syncs won't re-add it.
//
// template.version drives the "sync available" signal: when a plan's
// lastSyncedVersion is behind template.version, new items may be available.
// Version is bumped on every template save and on every push.

import { exec, run, transaction } from './db.js';
import { createDefaultTemplates, cleanTemplate, generateId } from './templates.js';

// ─── Migration ────────────────────────────────────────────────────────────────

// On first boot, migrate any data from localStorage into SQLite, then clear it.
export async function migrateFromLocalStorage() {
  const rawTemplates = localStorage.getItem('campfixer:templates');
  const rawPlans = localStorage.getItem('campfixer:plans');
  if (!rawTemplates && !rawPlans) return;

  await transaction(async () => {
    if (rawTemplates) {
      try {
        const templates = JSON.parse(rawTemplates);
        for (const t of templates) {
          await run(
            `INSERT OR IGNORE INTO templates (id, name, description, version, updatedAt, data)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [t.id, t.name, t.description || '', t.version || 1, t.updatedAt || '', JSON.stringify(t.defaultItems || [])]
          );
        }
      } catch (_) { /* corrupt data — skip */ }
    }

    if (rawPlans) {
      try {
        const plans = JSON.parse(rawPlans);
        for (const p of plans) {
          await run(
            `INSERT OR IGNORE INTO plans (id, templateId, name, lastSyncedVersion, createdAt)
             VALUES (?, ?, ?, ?, ?)`,
            [p.id, p.templateId || '', p.name, p.lastSyncedVersion || 1, p.createdAt || '']
          );
          for (const item of (p.items || [])) {
            await run(
              `INSERT OR IGNORE INTO plan_items
               (planItemId, planId, sourceTemplateId, sourceItemId, name, importance, description, size, weight, packed, extraFields)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [item.planItemId, p.id, item.sourceTemplateId || null, item.sourceItemId || null,
               item.name || '', item.importance || 'Medium', item.description || '',
               item.size || '', item.weight || '', item.packed ? 1 : 0,
               JSON.stringify(item.extraFields || {})]
            );
          }
        }
      } catch (_) { /* corrupt data — skip */ }
    }
  });

  localStorage.removeItem('campfixer:templates');
  localStorage.removeItem('campfixer:plans');
}

// ─── Templates ────────────────────────────────────────────────────────────────

// Seeds defaults on first launch if the table is empty; otherwise maps rows to objects.
export async function loadTemplates() {
  const rows = await exec('SELECT * FROM templates ORDER BY rowid ASC');
  if (rows.length === 0) {
    const seeds = createDefaultTemplates();
    for (const t of seeds) await _insertTemplate(t);
    return seeds;
  }
  return rows.map(_rowToTemplate);
}

// Replaces the entire templates table in a single transaction (used for bulk reorder/save).
export async function saveTemplates(templates) {
  await transaction(async () => {
    await run('DELETE FROM templates');
    for (const t of templates) await _insertTemplate(t);
  });
}

// Validates and inserts a single new template; returns the cleaned object.
export async function createTemplate(template) {
  const clean = cleanTemplate(template);
  await _insertTemplate(clean);
  return clean;
}

// Bumps version and updatedAt, then upserts the updated template; returns the full list.
export async function updateTemplate(updatedTemplate) {
  const all = await loadTemplates();
  const index = all.findIndex(t => t.id === updatedTemplate.id);
  if (index !== -1) {
    const next = cleanTemplate(updatedTemplate);
    next.version = (all[index].version || 1) + 1;
    next.updatedAt = new Date().toISOString().split('T')[0];
    all[index] = next;
    await _upsertTemplate(next);
  }
  return all;
}

// Deletes a template by id and returns the refreshed template list.
export async function deleteTemplate(templateId) {
  await run('DELETE FROM templates WHERE id = ?', [templateId]);
  return loadTemplates();
}

// Maps a DB row to a template object, parsing the JSON-serialised item list.
function _rowToTemplate(row) {
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

// Simple INSERT — used for bulk writes where conflicts are not expected.
async function _insertTemplate(t) {
  await run(
    `INSERT INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [t.id, t.name, t.description || '', t.version || 1, t.updatedAt || '', JSON.stringify(t.defaultItems || [])]
  );
}

// INSERT OR REPLACE — used for single-record updates where a conflict means "overwrite".
async function _upsertTemplate(t) {
  await run(
    `INSERT OR REPLACE INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [t.id, t.name, t.description || '', t.version || 1, t.updatedAt || '', JSON.stringify(t.defaultItems || [])]
  );
}

// ─── Plans ────────────────────────────────────────────────────────────────────

// Loads all plans, fetching each plan's items in a per-plan query.
export async function loadPlans() {
  const plans = await exec('SELECT * FROM plans ORDER BY rowid ASC');
  const result = [];
  for (const p of plans) {
    const items = await exec(
      `SELECT * FROM plan_items WHERE planId = ? ORDER BY rowid ASC`,
      [p.id]
    );
    result.push(_rowToPlan(p, items));
  }
  return result;
}

// Replaces all plans and their items in a single transaction (used for bulk reorder/save).
export async function savePlans(plans) {
  await transaction(async () => {
    await run('DELETE FROM plan_items');
    await run('DELETE FROM plans');
    for (const p of plans) {
      await run(
        `INSERT INTO plans (id, templateId, name, lastSyncedVersion, createdAt) VALUES (?, ?, ?, ?, ?)`,
        [p.id, p.templateId || '', p.name, p.lastSyncedVersion || 1, p.createdAt || '']
      );
      for (const item of (p.items || [])) await _insertPlanItem(item, p.id);
    }
  });
}

// Copies template.defaultItems into plan items, recording sourceItemId on each so
// future syncs can identify which template items are already present in the plan.
export async function createPlanFromTemplate(template, planName) {
  const items = (template.defaultItems || []).map(item => ({
    planItemId: generateId('plan'),
    sourceTemplateId: template.id,
    sourceItemId: item.id,
    name: item.name,
    importance: item.importance,
    description: item.description,
    size: item.size,
    weight: item.weight,
    packed: false,
    extraFields: item.extraFields || {},
  }));

  return {
    id: generateId('plan'),
    name: planName || `${template.name} plan`,
    templateId: template.id,
    createdAt: new Date().toISOString(),
    lastSyncedVersion: template.version || 1,
    items,
  };
}

// Persists a new plan with all its items; returns the refreshed plan list.
export async function addPlan(plan) {
  await transaction(async () => {
    await run(
      `INSERT INTO plans (id, templateId, name, lastSyncedVersion, createdAt) VALUES (?, ?, ?, ?, ?)`,
      [plan.id, plan.templateId || '', plan.name, plan.lastSyncedVersion || 1, plan.createdAt || '']
    );
    for (const item of (plan.items || [])) await _insertPlanItem(item, plan.id);
  });
  return loadPlans();
}

// Replaces a plan's header row and all its items (used for edits and post-sync saves).
export async function updatePlan(plan) {
  await transaction(async () => {
    await run(
      `INSERT OR REPLACE INTO plans (id, templateId, name, lastSyncedVersion, createdAt) VALUES (?, ?, ?, ?, ?)`,
      [plan.id, plan.templateId || '', plan.name, plan.lastSyncedVersion || 1, plan.createdAt || '']
    );
    await run('DELETE FROM plan_items WHERE planId = ?', [plan.id]);
    for (const item of (plan.items || [])) await _insertPlanItem(item, plan.id);
  });
  return loadPlans();
}

// Deletes a plan and all its items; returns the refreshed plan list.
export async function deletePlan(planId) {
  await transaction(async () => {
    await run('DELETE FROM plan_items WHERE planId = ?', [planId]);
    await run('DELETE FROM plans WHERE id = ?', [planId]);
  });
  return loadPlans();
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

// One-way pull: appends any template items the plan doesn't already have.
// Matching is done by sourceItemId, NOT by name — so a renamed template item
// is still considered "already in the plan" as long as its id is present.
// Updates lastSyncedVersion to the template's current version.
// Does not persist — caller must await updatePlan(plan) afterwards.
export async function syncPlanWithTemplate(plan, template) {
  const existingSourceIds = new Set(plan.items.map(i => i.sourceItemId).filter(Boolean));
  const newItems = (template.defaultItems || [])
    .filter(item => !existingSourceIds.has(item.id))
    .map(item => ({
      planItemId: generateId('plan'),
      sourceTemplateId: template.id,
      sourceItemId: item.id,
      name: item.name,
      importance: item.importance,
      description: item.description,
      size: item.size,
      weight: item.weight,
      packed: false,
      extraFields: item.extraFields || {},
    }));

  if (newItems.length > 0) plan.items = [...plan.items, ...newItems];
  plan.lastSyncedVersion = template.version || plan.lastSyncedVersion;
  return plan;
}

// One-way push: promotes plan-exclusive items to the template so future plans
// and syncs can include them.  A plan item is "plan-exclusive" when it has no
// sourceItemId, or its sourceItemId doesn't match any current template item
// (meaning the source item was deleted from the template after the plan was made).
//
// After pushing, each promoted plan item receives a new sourceItemId pointing to
// the freshly created template item — this prevents future syncs from re-adding
// the same item again.  template.version is bumped so other plans can detect the
// new items via their lastSyncedVersion comparison.
//
// Returns { template, plan, addedCount }.  Caller must persist both objects:
//   await updateTemplate(result.template);
//   await updatePlan(result.plan);
export async function pushPlanItemsToTemplate(plan, template) {
  const existingIds = new Set(template.defaultItems.map(i => i.id));
  const itemsToAdd = plan.items.filter(
    item => !item.sourceItemId || !existingIds.has(item.sourceItemId)
  );

  if (itemsToAdd.length === 0) return { template, plan, addedCount: 0 };

  const newTemplateItems = itemsToAdd.map(item => ({
    id: generateId('item'),
    name: item.name,
    importance: item.importance,
    description: item.description,
    size: item.size || '',
    weight: item.weight || '',
    extraFields: item.extraFields || {},
  }));

  // Map each original planItemId to its newly assigned template item id so we
  // can back-fill sourceItemId on the plan without a second array scan.
  const idMap = new Map(itemsToAdd.map((item, i) => [item.planItemId, newTemplateItems[i].id]));

  const updatedTemplate = {
    ...template,
    defaultItems: [...template.defaultItems, ...newTemplateItems],
    version: (template.version || 1) + 1,
    updatedAt: new Date().toISOString().split('T')[0],
  };

  const updatedPlan = {
    ...plan,
    items: plan.items.map(item => {
      const newSourceItemId = idMap.get(item.planItemId);
      if (!newSourceItemId) return item;
      return { ...item, sourceItemId: newSourceItemId, sourceTemplateId: template.id };
    }),
    lastSyncedVersion: updatedTemplate.version,
  };

  return { template: updatedTemplate, plan: updatedPlan, addedCount: newTemplateItems.length };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Maps a plans row + its plan_items rows to a plain JS plan object.
// SQLite stores booleans as 0/1 integers, so packed is coerced to boolean here.
function _rowToPlan(row, itemRows) {
  return {
    id: row.id,
    templateId: row.templateId,
    name: row.name,
    lastSyncedVersion: row.lastSyncedVersion,
    createdAt: row.createdAt,
    items: itemRows.map(r => ({
      planItemId: r.planItemId,
      planId: r.planId,
      sourceTemplateId: r.sourceTemplateId || null,
      sourceItemId: r.sourceItemId || null,
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

async function _insertPlanItem(item, planId) {
  await run(
    `INSERT INTO plan_items (planItemId, planId, sourceTemplateId, sourceItemId, name, importance, description, size, weight, packed, extraFields)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.planItemId, planId, item.sourceTemplateId || null, item.sourceItemId || null,
     item.name || '', item.importance || 'Medium', item.description || '',
     item.size || '', item.weight || '', item.packed ? 1 : 0,
     JSON.stringify(item.extraFields || {})]
  );
}
