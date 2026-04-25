import {
  loadTemplates,
  loadPlans,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createPlanFromTemplate,
  addPlan,
  updatePlan,
  deletePlan,
  syncPlanWithTemplate,
  pushPlanItemsToTemplate,
  saveTemplates,
  savePlans,
} from './storage.js';
import { exportDB } from './db.js';

const state = {
  view: 'dashboard',
  templates: [],
  plans: [],
  activeTemplate: null,
  activePlan: null,
};

const elements = {
  main: document.getElementById('app-main'),
  navButtons: Array.from(document.querySelectorAll('.nav-btn')),
};

function armDeleteButton(button, onConfirm) {
  if (button.dataset.armed === 'true') {
    onConfirm();
    return;
  }
  const originalText = button.textContent;
  button.dataset.armed = 'true';
  button.textContent = 'Tap again to confirm';
  button.classList.replace('btn-danger', 'btn-danger-armed');
  setTimeout(() => {
    if (button.dataset.armed === 'true') {
      button.dataset.armed = 'false';
      button.textContent = originalText;
      button.classList.replace('btn-danger-armed', 'btn-danger');
    }
  }, 3000);
}

async function initApp() {
  state.templates = await loadTemplates();
  state.plans = await loadPlans();
  attachNavListeners();
  renderView('dashboard');
}

function attachNavListeners() {
  elements.navButtons.forEach(button => {
    button.addEventListener('click', () => {
      renderView(button.dataset.view);
    });
  });
}

function setActiveNav(view) {
  elements.navButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

function renderView(view) {
  state.view = view;
  setActiveNav(view);
  if (view === 'dashboard') renderDashboard();
  else if (view === 'templates') renderTemplatesList();
  else if (view === 'plans') renderPlansList();
}

function renderDashboard() {
  const template = document.getElementById('dashboard-template');
  const fragment = template.content.cloneNode(true);
  fragment.querySelectorAll('[data-action="goto"]').forEach(button => {
    button.addEventListener('click', event => renderView(event.target.dataset.target));
  });
  fragment.querySelector('[data-action="download-db"]').addEventListener('click', async () => {
    const bytes = await exportDB();
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campfixer.db';
    a.click();
    URL.revokeObjectURL(url);
  });
  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

function renderTemplatesList() {
  const template = document.getElementById('templates-list-template');
  const fragment = template.content.cloneNode(true);
  const listRoot = fragment.getElementById('templates-list');
  const emptyState = fragment.getElementById('templates-empty');

  if (state.templates.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
    state.templates.forEach(templateData => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <strong>${templateData.name}</strong>
        <p>${templateData.description}</p>
        <small>${templateData.defaultItems.length} default item(s)</small>
        <div class="card-actions">
          <button data-action="edit-template" data-id="${templateData.id}" class="btn-secondary">Edit</button>
          <button data-action="copy-template" data-id="${templateData.id}" class="btn-secondary">Duplicate</button>
        </div>
      `;
      listRoot.appendChild(card);
    });
  }

  fragment.querySelector('[data-action="create-template"]').addEventListener('click', () => {
    state.activeTemplate = null;
    renderTemplateEditor();
  });

  fragment.querySelectorAll('[data-action="edit-template"]').forEach(button => {
    button.addEventListener('click', () => {
      state.activeTemplate = state.templates.find(t => t.id === button.dataset.id) || null;
      renderTemplateEditor();
    });
  });

  fragment.querySelectorAll('[data-action="copy-template"]').forEach(button => {
    button.addEventListener('click', async () => {
      const original = state.templates.find(t => t.id === button.dataset.id);
      if (original) {
        const copy = JSON.parse(JSON.stringify(original));
        copy.id = `template-${Math.random().toString(36).slice(2, 9)}`;
        copy.name = `${original.name} copy`;
        copy.version = 1;
        state.templates.unshift(copy);
        await saveTemplates(state.templates);
        renderTemplatesList();
      }
    });
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

function renderTemplateEditor() {
  const template = document.getElementById('template-editor-template');
  const fragment = template.content.cloneNode(true);
  const title = fragment.getElementById('template-editor-title');
  const form = fragment.getElementById('template-form');
  const itemsRoot = fragment.getElementById('template-items');

  const currentTemplate = state.activeTemplate ? JSON.parse(JSON.stringify(state.activeTemplate)) : {
    name: '',
    description: '',
    defaultItems: [],
  };

  title.textContent = currentTemplate.name ? `Edit template: ${currentTemplate.name}` : 'New template';
  form.name.value = currentTemplate.name;
  form.description.value = currentTemplate.description;

  function renderItems(animateNewItem = false) {
    itemsRoot.innerHTML = '';
    currentTemplate.defaultItems.forEach((item, index) => {
      const isNew = animateNewItem && index === currentTemplate.defaultItems.length - 1;
      const card = document.createElement('div');
      card.className = 'item-card' + (isNew ? ' animate-fade-in' : '');
      card.innerHTML = `
        <label>Item name<input value="${item.name}" data-field="name" data-index="${index}" /></label>
        <label>Importance
          <select data-field="importance" data-index="${index}">
            <option${item.importance === 'High' ? ' selected' : ''}>High</option>
            <option${item.importance === 'Medium' ? ' selected' : ''}>Medium</option>
            <option${item.importance === 'Low' ? ' selected' : ''}>Low</option>
          </select>
        </label>
        <label>Description<textarea data-field="description" data-index="${index}">${item.description}</textarea></label>
        <div class="inline-fields">
          <label>Size<input value="${item.size}" data-field="size" data-index="${index}" /></label>
          <label>Weight<input value="${item.weight}" data-field="weight" data-index="${index}" /></label>
        </div>
        <div class="card-actions">
          <button data-action="remove-item" data-index="${index}" class="btn-danger">Remove</button>
        </div>
      `;
      itemsRoot.appendChild(card);
      if (isNew) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function updateItem(event) {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.field;
    if (Number.isNaN(index) || !field) return;
    currentTemplate.defaultItems[index][field] = event.target.value;
  }

  function removeItem(index) {
    currentTemplate.defaultItems.splice(index, 1);
    renderItems();
    attachItemListeners();
  }

  function attachItemListeners() {
    itemsRoot.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', updateItem));
    itemsRoot.querySelectorAll('[data-action="remove-item"]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        removeItem(Number(button.dataset.index));
      });
    });
  }

  function addItem() {
    currentTemplate.defaultItems.push({
      id: `item-${Math.random().toString(36).slice(2, 9)}`,
      name: 'New item',
      importance: 'Medium',
      description: '',
      size: '',
      weight: '',
    });
    renderItems(true);
    attachItemListeners();
  }

  renderItems();
  attachItemListeners();

  fragment.querySelector('[data-action="add-item"]').addEventListener('click', addItem);
  fragment.querySelector('[data-action="back-to-templates"]').addEventListener('click', () => renderTemplatesList());

  fragment.querySelector('[data-action="save-template"]').addEventListener('click', async () => {
    currentTemplate.name = form.name.value.trim() || 'Untitled template';
    currentTemplate.description = form.description.value.trim();
    if (!currentTemplate.id) {
      currentTemplate.id = `template-${Math.random().toString(36).slice(2, 9)}`;
      currentTemplate.version = 1;
      currentTemplate.updatedAt = new Date().toISOString().split('T')[0];
      state.templates.unshift(currentTemplate);
    } else {
      const index = state.templates.findIndex(t => t.id === currentTemplate.id);
      if (index !== -1) {
        currentTemplate.version = (state.templates[index].version || 1) + 1;
        currentTemplate.updatedAt = new Date().toISOString().split('T')[0];
        state.templates[index] = currentTemplate;
      }
    }
    await saveTemplates(state.templates);
    renderTemplatesList();
  });

  fragment.querySelector('[data-action="delete-template"]').addEventListener('click', async () => {
    if (!currentTemplate.id) { renderTemplatesList(); return; }
    if (confirm('Delete this template?')) {
      state.templates = await deleteTemplate(currentTemplate.id);
      renderTemplatesList();
    }
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

function renderPlansList() {
  const template = document.getElementById('plans-list-template');
  const fragment = template.content.cloneNode(true);
  const listRoot = fragment.getElementById('plans-list');
  const emptyState = fragment.getElementById('plans-empty');

  if (state.plans.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';
    state.plans.forEach(plan => {
      const templateSource = state.templates.find(t => t.id === plan.templateId);
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <strong>${plan.name}</strong>
        <p>From template: ${templateSource ? templateSource.name : 'Unknown'}</p>
        <small>${plan.items.length} item(s)</small>
        <div class="card-actions">
          <button data-action="open-plan" data-id="${plan.id}" class="btn-primary">Open</button>
          <button data-action="delete-plan" data-id="${plan.id}" class="btn-danger">Delete</button>
        </div>
      `;
      listRoot.appendChild(card);
    });
  }

  fragment.querySelector('[data-action="create-plan"]').addEventListener('click', () => renderPlanCreator());

  fragment.querySelectorAll('[data-action="open-plan"]').forEach(button => {
    button.addEventListener('click', () => {
      state.activePlan = state.plans.find(p => p.id === button.dataset.id) || null;
      renderPlanDetail();
    });
  });

  fragment.querySelectorAll('[data-action="delete-plan"]').forEach(button => {
    button.addEventListener('click', () => {
      armDeleteButton(button, async () => {
        state.plans = await deletePlan(button.dataset.id);
        renderPlansList();
      });
    });
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

function renderPlanCreator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';
  wrapper.innerHTML = `
    <div class="panel-header">
      <button id="back-to-plans" class="btn-secondary">← Back</button>
      <h2 class="text-xl font-semibold">Create packing plan</h2>
    </div>
    <form class="form-grid" id="create-plan-form">
      <label>Plan name<input name="planName" type="text" placeholder="My weekend trip" required /></label>
      <label>Choose template<select name="templateId"></select></label>
    </form>
    <div class="form-actions">
      <button id="save-plan" class="btn-primary">Create plan</button>
    </div>
  `;

  const select = wrapper.querySelector('select[name="templateId"]');
  state.templates.forEach(template => {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = template.name;
    select.appendChild(option);
  });

  wrapper.querySelector('#back-to-plans').addEventListener('click', () => renderPlansList());
  wrapper.querySelector('#save-plan').addEventListener('click', async event => {
    event.preventDefault();
    const planName = wrapper.querySelector('input[name="planName"]').value.trim();
    const templateId = select.value;
    if (!planName) { alert('Please enter a plan name.'); return; }
    const template = state.templates.find(t => t.id === templateId);
    if (!template) { alert('Please choose a valid template.'); return; }
    const plan = await createPlanFromTemplate(template, planName);
    state.plans = await addPlan(plan);
    state.activePlan = plan;
    renderPlanDetail();
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(wrapper);
}

function renderPlanDetail() {
  if (!state.activePlan) { renderPlansList(); return; }

  const plan = JSON.parse(JSON.stringify(state.activePlan));
  const templateSource = state.templates.find(t => t.id === plan.templateId);
  const template = document.getElementById('plan-detail-template');
  const fragment = template.content.cloneNode(true);
  fragment.getElementById('plan-title').textContent = plan.name;
  fragment.getElementById('plan-from-template').textContent =
    `From template: ${templateSource ? templateSource.name : 'Unknown'}`;

  const itemsRoot = fragment.getElementById('plan-items');

  function renderItems(animateNewItem = false) {
    itemsRoot.innerHTML = '';
    plan.items.forEach((item, index) => {
      const isNew = animateNewItem && index === plan.items.length - 1;
      const card = document.createElement('div');
      card.className = 'item-card' + (isNew ? ' animate-fade-in' : '');
      if (item.packed) card.classList.add('opacity-60');
      card.innerHTML = `
        <label>Item name<input value="${item.name}" data-field="name" data-index="${index}" /></label>
        <label>Importance
          <select data-field="importance" data-index="${index}">
            <option${item.importance === 'High' ? ' selected' : ''}>High</option>
            <option${item.importance === 'Medium' ? ' selected' : ''}>Medium</option>
            <option${item.importance === 'Low' ? ' selected' : ''}>Low</option>
          </select>
        </label>
        <label>Description<textarea data-field="description" data-index="${index}">${item.description}</textarea></label>
        <div class="inline-fields">
          <label>Size<input value="${item.size}" data-field="size" data-index="${index}" /></label>
          <label>Weight<input value="${item.weight}" data-field="weight" data-index="${index}" /></label>
        </div>
        <div class="card-actions">
          <button data-action="toggle-packed" data-index="${index}" class="btn-secondary">
            ${item.packed ? 'Unpack' : 'Pack'}
          </button>
          <button data-action="remove-item" data-index="${index}" class="btn-danger">Remove</button>
        </div>
      `;
      itemsRoot.appendChild(card);
      if (isNew) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  function updateItem(event) {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.field;
    if (Number.isNaN(index) || !field) return;
    plan.items[index][field] = event.target.value;
  }

  function removeItem(index) { plan.items.splice(index, 1); renderItems(); attachItemListeners(); }
  function togglePacked(index) { plan.items[index].packed = !plan.items[index].packed; renderItems(); attachItemListeners(); }

  function attachItemListeners() {
    itemsRoot.querySelectorAll('[data-field]').forEach(input => input.addEventListener('input', updateItem));
    itemsRoot.querySelectorAll('[data-action="remove-item"]').forEach(button => {
      button.addEventListener('click', event => { event.preventDefault(); removeItem(Number(button.dataset.index)); });
    });
    itemsRoot.querySelectorAll('[data-action="toggle-packed"]').forEach(button => {
      button.addEventListener('click', event => { event.preventDefault(); togglePacked(Number(button.dataset.index)); });
    });
  }

  function addItem() {
    plan.items.push({
      planItemId: `plan-${Math.random().toString(36).slice(2, 9)}`,
      sourceTemplateId: null,
      sourceItemId: null,
      name: 'New item',
      importance: 'Medium',
      description: '',
      size: '',
      weight: '',
      packed: false,
    });
    renderItems(true);
    attachItemListeners();
  }

  renderItems();
  attachItemListeners();

  fragment.querySelector('[data-action="back-to-plans"]').addEventListener('click', () => renderPlansList());
  fragment.querySelector('[data-action="add-plan-item"]').addEventListener('click', addItem);

  fragment.querySelector('[data-action="save-plan"]').addEventListener('click', async () => {
    plan.name = document.getElementById('plan-title').textContent;
    state.plans = await updatePlan(plan);
    state.activePlan = plan;
    alert('Plan saved.');
  });

  const tName = templateSource ? templateSource.name : 'template';
  fragment.querySelector('[data-action="sync-plan"]').dataset.tooltip =
    `Adds new items from "${tName}" that aren't in this plan yet`;
  fragment.querySelector('[data-action="push-to-template"]').dataset.tooltip =
    `Sends new items from this plan back to "${tName}"`;

  fragment.querySelector('[data-action="sync-plan"]').addEventListener('click', async () => {
    if (!templateSource) { alert('Template source not available.'); return; }
    await syncPlanWithTemplate(plan, templateSource);
    state.plans = await updatePlan(plan);
    state.activePlan = plan;
    renderPlanDetail();
  });

  fragment.querySelector('[data-action="push-to-template"]').addEventListener('click', async () => {
    if (!templateSource) { alert('Template source not available.'); return; }
    const result = await pushPlanItemsToTemplate(plan, templateSource);
    if (result.addedCount === 0) { alert('No new items to add to the template.'); return; }
    const tIdx = state.templates.findIndex(t => t.id === result.template.id);
    if (tIdx !== -1) state.templates[tIdx] = result.template;
    await saveTemplates(state.templates);
    state.plans = await updatePlan(result.plan);
    state.activePlan = result.plan;
    alert(`Added ${result.addedCount} item(s) to "${result.template.name}".`);
    renderPlanDetail();
  });

  const deletePlanBtn = fragment.querySelector('[data-action="delete-plan"]');
  deletePlanBtn.addEventListener('click', () => {
    armDeleteButton(deletePlanBtn, async () => {
      state.plans = await deletePlan(plan.id);
      renderPlansList();
    });
  });

  fragment.querySelector('[data-action="download-db"]').addEventListener('click', async () => {
    const bytes = await exportDB();
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campfixer.db';
    a.click();
    URL.revokeObjectURL(url);
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

export { initApp };
