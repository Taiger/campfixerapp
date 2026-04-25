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
               (planItemId, planId, sourceTemplateId, sourceItemId, name, importance, description, size, weight, packed)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [item.planItemId, p.id, item.sourceTemplateId || null, item.sourceItemId || null,
               item.name || '', item.importance || 'Medium', item.description || '',
               item.size || '', item.weight || '', item.packed ? 1 : 0]
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

export async function loadTemplates() {
  const rows = await exec('SELECT * FROM templates ORDER BY rowid ASC');
  if (rows.length === 0) {
    const seeds = createDefaultTemplates();
    for (const t of seeds) await _insertTemplate(t);
    return seeds;
  }
  return rows.map(_rowToTemplate);
}

export async function saveTemplates(templates) {
  await transaction(async () => {
    await run('DELETE FROM templates');
    for (const t of templates) await _insertTemplate(t);
  });
}

export async function createTemplate(template) {
  const clean = cleanTemplate(template);
  await _insertTemplate(clean);
  return clean;
}

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

export async function deleteTemplate(templateId) {
  await run('DELETE FROM templates WHERE id = ?', [templateId]);
  return loadTemplates();
}

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

async function _insertTemplate(t) {
  await run(
    `INSERT INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [t.id, t.name, t.description || '', t.version || 1, t.updatedAt || '', JSON.stringify(t.defaultItems || [])]
  );
}

async function _upsertTemplate(t) {
  await run(
    `INSERT OR REPLACE INTO templates (id, name, description, version, updatedAt, data) VALUES (?, ?, ?, ?, ?, ?)`,
    [t.id, t.name, t.description || '', t.version || 1, t.updatedAt || '', JSON.stringify(t.defaultItems || [])]
  );
}

// ─── Plans ────────────────────────────────────────────────────────────────────

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

export async function deletePlan(planId) {
  await transaction(async () => {
    await run('DELETE FROM plan_items WHERE planId = ?', [planId]);
    await run('DELETE FROM plans WHERE id = ?', [planId]);
  });
  return loadPlans();
}

// ─── Sync logic ───────────────────────────────────────────────────────────────

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
    }));

  if (newItems.length > 0) plan.items = [...plan.items, ...newItems];
  plan.lastSyncedVersion = template.version || plan.lastSyncedVersion;
  return plan;
}

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
  }));

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
    })),
  };
}

async function _insertPlanItem(item, planId) {
  await run(
    `INSERT INTO plan_items (planItemId, planId, sourceTemplateId, sourceItemId, name, importance, description, size, weight, packed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.planItemId, planId, item.sourceTemplateId || null, item.sourceItemId || null,
     item.name || '', item.importance || 'Medium', item.description || '',
     item.size || '', item.weight || '', item.packed ? 1 : 0]
  );
}
