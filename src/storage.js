import { getSeedTemplates, saveTemplates, cleanTemplate, generateId } from './templates.js';

const PLAN_STORAGE_KEY = 'campfixer:plans';

function loadTemplates() {
  return getSeedTemplates();
}

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

function createTemplate(template) {
  const templates = loadTemplates();
  const clean = cleanTemplate(template);
  templates.unshift(clean);
  saveTemplates(templates);
  return clean;
}

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

function createPlanFromTemplate(template, planName) {
  const items = (template.defaultItems || []).map(item => ({
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

  return {
    id: generateId('plan'),
    name: planName || `${template.name} plan`,
    templateId: template.id,
    createdAt: new Date().toISOString(),
    lastSyncedVersion: template.version || 1,
    items
  };
}

function addPlan(plan) {
  const plans = loadPlans();
  plans.unshift(plan);
  savePlans(plans);
  return plans;
}

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

  const idMap = new Map(itemsToAdd.map((item, i) => [item.planItemId, newTemplateItems[i].id]));

  const updatedTemplate = {
    ...template,
    defaultItems: [...template.defaultItems, ...newTemplateItems],
    version: (template.version || 1) + 1,
    updatedAt: new Date().toISOString().split('T')[0]
  };

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
