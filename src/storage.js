import { getSeedTemplates, saveTemplates, cleanTemplate, generateId } from './templates.js';

// localStorage key where all packing plans are persisted as a JSON string.
const PLAN_STORAGE_KEY = 'campfixer:plans';

// Templates are managed by templates.js — this just delegates to keep concerns separate.
function loadTemplates() {
  return getSeedTemplates();
}

// Returns all saved plans, or an empty array if storage is empty or the data is corrupt.
// Troubleshooting: open DevTools → Application → Local Storage and check "campfixer:plans".
function loadPlans() {
  const stored = localStorage.getItem(PLAN_STORAGE_KEY);
  if (!stored) {
    return [];
  }

  try {
    return JSON.parse(stored);
  } catch (error) {
    return [];
  }
}

function savePlans(plans) {
  localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plans));
}

// Creates a new template and prepends it so it appears first in the list.
function createTemplate(template) {
  const templates = loadTemplates();
  const clean = cleanTemplate(template);
  templates.unshift(clean);
  saveTemplates(templates);
  return clean;
}

// Replaces the matching template in storage and bumps its version number.
// Version is used by plans to track whether a sync is needed.
function updateTemplate(updatedTemplate) {
  const templates = loadTemplates();
  const index = templates.findIndex(t => t.id === updatedTemplate.id);
  if (index !== -1) {
    templates[index] = cleanTemplate(updatedTemplate);
    templates[index].version = (templates[index].version || 1) + 1;
    templates[index].updatedAt = new Date().toISOString().split('T')[0];
    saveTemplates(templates);
  }
  return templates;
}

function deleteTemplate(templateId) {
  const templates = loadTemplates().filter(t => t.id !== templateId);
  saveTemplates(templates);
  return templates;
}

// Converts a template into a new packing plan.
// Each plan item records sourceTemplateId and sourceItemId so we can later detect
// which template items are already represented in the plan (used by syncPlanWithTemplate).
function createPlanFromTemplate(template, planName) {
  const items = (template.defaultItems || []).map(item => ({
    planItemId: generateId('plan'),
    sourceTemplateId: template.id,
    sourceItemId: item.id,   // links this plan item back to its template item
    name: item.name,
    importance: item.importance,
    description: item.description,
    size: item.size,
    weight: item.weight,
    packed: false
  }));

  return {
    id: generateId('plan'),
    name: planName || `${template.name} plan`,
    templateId: template.id,
    createdAt: new Date().toISOString(),
    lastSyncedVersion: template.version || 1,
    items
  };
}

// Prepends the new plan to storage and returns the full updated plans array.
function addPlan(plan) {
  const plans = loadPlans();
  plans.unshift(plan);
  savePlans(plans);
  return plans;
}

// Replaces the matching plan in storage (matched by id) and returns the full updated array.
// Troubleshooting: if a save appears to do nothing, check that plan.id is set correctly.
function updatePlan(plan) {
  const plans = loadPlans();
  const index = plans.findIndex(p => p.id === plan.id);
  if (index !== -1) {
    plans[index] = plan;
    savePlans(plans);
  }
  return plans;
}

function deletePlan(planId) {
  const plans = loadPlans().filter(p => p.id !== planId);
  savePlans(plans);
  return plans;
}

// Pushes new plan items back to the source template (plan → template direction).
// "New" means the plan item has no sourceItemId (added manually) or its sourceItemId
// no longer exists in the template (template item was deleted after the plan was created).
// After pushing, the plan items are updated with the new template item IDs so a second
// push won't create duplicates.
function pushPlanItemsToTemplate(plan, template) {
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
    weight: item.weight || ''
  }));

  // Map from plan item's planItemId → the newly created template item id,
  // so we can back-fill sourceItemId on the plan items below.
  const idMap = new Map(itemsToAdd.map((item, i) => [item.planItemId, newTemplateItems[i].id]));

  const updatedTemplate = {
    ...template,
    defaultItems: [...template.defaultItems, ...newTemplateItems],
    version: (template.version || 1) + 1,
    updatedAt: new Date().toISOString().split('T')[0]
  };

  // Update the plan items that were just pushed so they're now linked to their
  // template counterparts — prevents them from being pushed again next time.
  const updatedPlan = {
    ...plan,
    items: plan.items.map(item => {
      const newSourceItemId = idMap.get(item.planItemId);
      if (!newSourceItemId) return item;
      return { ...item, sourceItemId: newSourceItemId, sourceTemplateId: template.id };
    }),
    lastSyncedVersion: updatedTemplate.version
  };

  return { template: updatedTemplate, plan: updatedPlan, addedCount: newTemplateItems.length };
}

// Pulls new items from the template into the plan (template → plan direction).
// Only adds items that don't already exist in the plan — identified by sourceItemId.
// Does NOT update fields on existing plan items if the template item changed.
// Mutates the plan object directly and also returns it.
function syncPlanWithTemplate(plan, template) {
  const existingSourceIds = new Set(plan.items.map(item => item.sourceItemId).filter(Boolean));
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
      packed: false
    }));

  if (newItems.length > 0) {
    plan.items = [...plan.items, ...newItems];
  }
  plan.lastSyncedVersion = template.version || plan.lastSyncedVersion;
  return plan;
}

export {
  loadTemplates,
  loadPlans,
  saveTemplates,
  savePlans,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createPlanFromTemplate,
  addPlan,
  updatePlan,
  deletePlan,
  syncPlanWithTemplate,
  pushPlanItemsToTemplate
};
