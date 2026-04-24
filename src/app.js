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
  savePlans
} from './storage.js';

// Central in-memory state. All renders read from here; storage functions keep
// localStorage in sync. Never mutate state directly from event handlers —
// always go through a storage function and reassign the returned value.
const state = {
  view: 'dashboard',       // which top-level view is active
  templates: [],           // full list of templates loaded from localStorage
  plans: [],               // full list of plans loaded from localStorage
  activeTemplate: null,    // template currently open in the editor (null = new)
  activePlan: null         // plan currently open in the detail view
};

// Cached DOM references used across multiple renders.
const elements = {
  main: document.getElementById('app-main'),
  navButtons: Array.from(document.querySelectorAll('.nav-btn'))
};

// Two-step delete guard: first click arms the button and changes its label;
// second click (within 3 seconds) calls onConfirm. Resets automatically if not confirmed.
// This replaces window.confirm() which can be silently suppressed in PWA/ChromeOS contexts.
function armDeleteButton(button, onConfirm) {
  if (button.dataset.armed === 'true') {
    onConfirm();
    return;
  }
  const originalText = button.textContent;
  button.dataset.armed = 'true';
  button.textContent = 'Tap again to confirm';
  setTimeout(() => {
    if (button.dataset.armed === 'true') {
      button.dataset.armed = 'false';
      button.textContent = originalText;
    }
  }, 3000);
}

function initApp() {
  state.templates = loadTemplates();
  state.plans = loadPlans();
  attachNavListeners();
  renderView('dashboard');
}

function attachNavListeners() {
  elements.navButtons.forEach(button => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      renderView(view);
    });
  });
}

// Highlights the nav button matching the active view.
function setActiveNav(view) {
  elements.navButtons.forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
}

function renderView(view) {
  state.view = view;
  setActiveNav(view);

  if (view === 'dashboard') {
    renderDashboard();
  } else if (view === 'templates') {
    renderTemplatesList();
  } else if (view === 'plans') {
    renderPlansList();
  }
}

// Rendering pattern used throughout: clone a <template> element from the HTML,
// wire up event listeners on the fragment, then swap it into #app-main.
// This avoids rebuilding HTML strings in JS and keeps markup in index.html.
function renderDashboard() {
  const template = document.getElementById('dashboard-template');
  const fragment = template.content.cloneNode(true);
  fragment.querySelectorAll('[data-action="goto"]').forEach(button => {
    button.addEventListener('click', event => {
      renderView(event.target.dataset.target);
    });
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
          <button data-action="edit-template" data-id="${templateData.id}">Edit</button>
          <button data-action="copy-template" data-id="${templateData.id}">Duplicate</button>
        </div>
      `;
      listRoot.appendChild(card);
    });
  }

  fragment.querySelector('[data-action="create-template"]').addEventListener('click', () => {
    state.activeTemplate = null; // null signals "new template" to the editor
    renderTemplateEditor();
  });

  fragment.querySelectorAll('[data-action="edit-template"]').forEach(button => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      state.activeTemplate = state.templates.find(t => t.id === id) || null;
      renderTemplateEditor();
    });
  });

  fragment.querySelectorAll('[data-action="copy-template"]').forEach(button => {
    button.addEventListener('click', () => {
      const original = state.templates.find(t => t.id === button.dataset.id);
      if (original) {
        const copy = JSON.parse(JSON.stringify(original));
        copy.id = `template-${Math.random().toString(36).slice(2, 9)}`;
        copy.name = `${original.name} copy`;
        copy.version = 1; // reset version — it's a new independent template
        state.templates.unshift(copy);
        saveTemplates(state.templates);
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

  // Deep-clone so edits don't mutate state until the user explicitly saves.
  const currentTemplate = state.activeTemplate ? JSON.parse(JSON.stringify(state.activeTemplate)) : {
    name: '',
    description: '',
    defaultItems: []
  };

  title.textContent = currentTemplate.name ? `Edit template: ${currentTemplate.name}` : 'New template';
  form.name.value = currentTemplate.name;
  form.description.value = currentTemplate.description;

  // Rebuilds the item list from currentTemplate.defaultItems.
  // Called after any add/remove so indices stay accurate.
  function renderItems() {
    itemsRoot.innerHTML = '';
    currentTemplate.defaultItems.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <label>
          Item name
          <input value="${item.name}" data-field="name" data-index="${index}" />
        </label>
        <label>
          Importance
          <select data-field="importance" data-index="${index}">
            <option${item.importance === 'High' ? ' selected' : ''}>High</option>
            <option${item.importance === 'Medium' ? ' selected' : ''}>Medium</option>
            <option${item.importance === 'Low' ? ' selected' : ''}>Low</option>
          </select>
        </label>
        <label>
          Description
          <textarea data-field="description" data-index="${index}">${item.description}</textarea>
        </label>
        <div class="inline-fields">
          <label>
            Size
            <input value="${item.size}" data-field="size" data-index="${index}" />
          </label>
          <label>
            Weight
            <input value="${item.weight}" data-field="weight" data-index="${index}" />
          </label>
        </div>
        <div class="card-actions">
          <button data-action="remove-item" data-index="${index}">Remove</button>
        </div>
      `;
      itemsRoot.appendChild(card);
    });
  }

  // Writes a single field change into currentTemplate immediately on input,
  // keeping the in-memory object in sync without re-rendering the whole list.
  function updateItem(event) {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.field;
    if (Number.isNaN(index) || !field) return;
    currentTemplate.defaultItems[index][field] = event.target.value;
  }

  function removeItem(index) {
    currentTemplate.defaultItems.splice(index, 1);
    renderItems();
    attachItemListeners(); // re-attach because the DOM was rebuilt
  }

  // Attaches input/change and remove listeners after each renderItems() call.
  // Must be re-called whenever the list re-renders, since new DOM nodes lose old listeners.
  function attachItemListeners() {
    itemsRoot.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', updateItem);
    });
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
      weight: ''
    });
    renderItems();
    attachItemListeners();
  }

  renderItems();
  attachItemListeners();

  fragment.querySelector('[data-action="add-item"]').addEventListener('click', addItem);
  fragment.querySelector('[data-action="back-to-templates"]').addEventListener('click', () => renderTemplatesList());

  fragment.querySelector('[data-action="save-template"]').addEventListener('click', () => {
    currentTemplate.name = form.name.value.trim() || 'Untitled template';
    currentTemplate.description = form.description.value.trim();
    if (!currentTemplate.id) {
      // New template: assign a fresh id and prepend to the list.
      currentTemplate.id = `template-${Math.random().toString(36).slice(2, 9)}`;
      currentTemplate.version = 1;
      currentTemplate.updatedAt = new Date().toISOString().split('T')[0];
      state.templates.unshift(currentTemplate);
    } else {
      // Existing template: find it by id and replace in-place, bumping the version.
      // Plans use the version number to know when a sync is available.
      const index = state.templates.findIndex(t => t.id === currentTemplate.id);
      if (index !== -1) {
        currentTemplate.version = (state.templates[index].version || 1) + 1;
        currentTemplate.updatedAt = new Date().toISOString().split('T')[0];
        state.templates[index] = currentTemplate;
      }
    }
    saveTemplates(state.templates);
    renderTemplatesList();
  });

  fragment.querySelector('[data-action="delete-template"]').addEventListener('click', () => {
    if (!currentTemplate.id) {
      // Template was never saved — just navigate away.
      renderTemplatesList();
      return;
    }
    if (confirm('Delete this template?')) {
      state.templates = deleteTemplate(currentTemplate.id);
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
      // Look up the source template by id for display purposes.
      // Shows "Unknown" if the template was deleted after the plan was created.
      const templateSource = state.templates.find(t => t.id === plan.templateId);
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <strong>${plan.name}</strong>
        <p>From template: ${templateSource ? templateSource.name : 'Unknown'}</p>
        <small>${plan.items.length} item(s)</small>
        <div class="card-actions">
          <button data-action="open-plan" data-id="${plan.id}">Open</button>
          <button data-action="delete-plan" data-id="${plan.id}">Delete</button>
        </div>
      `;
      listRoot.appendChild(card);
    });
  }

  fragment.querySelector('[data-action="create-plan"]').addEventListener('click', () => {
    renderPlanCreator();
  });

  fragment.querySelectorAll('[data-action="open-plan"]').forEach(button => {
    button.addEventListener('click', () => {
      const planId = button.dataset.id;
      state.activePlan = state.plans.find(p => p.id === planId) || null;
      renderPlanDetail();
    });
  });

  fragment.querySelectorAll('[data-action="delete-plan"]').forEach(button => {
    button.addEventListener('click', () => {
      armDeleteButton(button, () => {
        state.plans = deletePlan(button.dataset.id);
        renderPlansList();
      });
    });
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

// Renders the "create plan" form. Built with createElement instead of a <template>
// because it includes dynamic content (the template selector) that doesn't fit
// a static HTML template cleanly.
function renderPlanCreator() {
  const wrapper = document.createElement('div');
  wrapper.className = 'panel';
  wrapper.innerHTML = `
    <div class="panel-header">
      <button id="back-to-plans">← Back</button>
      <h2>Create packing plan</h2>
    </div>
    <form class="form-grid" id="create-plan-form">
      <label>
        Plan name
        <input name="planName" type="text" placeholder="My weekend trip" required />
      </label>
      <label>
        Choose template
        <select name="templateId"></select>
      </label>
    </form>
    <div class="form-actions">
      <button id="save-plan">Create plan</button>
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
  wrapper.querySelector('#save-plan').addEventListener('click', event => {
    event.preventDefault();
    const planName = wrapper.querySelector('input[name="planName"]').value.trim();
    const templateId = select.value;
    if (!planName) {
      alert('Please enter a plan name.');
      return;
    }
    const template = state.templates.find(t => t.id === templateId);
    if (!template) {
      alert('Please choose a valid template.');
      return;
    }
    const plan = createPlanFromTemplate(template, planName);
    state.plans = addPlan(plan);
    state.activePlan = plan;
    renderPlanDetail();
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(wrapper);
}

function renderPlanDetail() {
  if (!state.activePlan) {
    renderPlansList();
    return;
  }

  // Deep-clone so in-flight edits don't affect state until the user hits Save.
  // Troubleshooting: if edits appear to persist after Cancel, check this clone.
  const plan = JSON.parse(JSON.stringify(state.activePlan));
  const templateSource = state.templates.find(t => t.id === plan.templateId);
  const template = document.getElementById('plan-detail-template');
  const fragment = template.content.cloneNode(true);
  fragment.getElementById('plan-title').textContent = plan.name;
  fragment.getElementById('plan-from-template').textContent = `From template: ${templateSource ? templateSource.name : 'Unknown'}`;

  const itemsRoot = fragment.getElementById('plan-items');

  // Rebuilds the item list from plan.items. Called after any structural change
  // (add, remove, toggle packed) to keep indices accurate.
  function renderItems() {
    itemsRoot.innerHTML = '';
    plan.items.forEach((item, index) => {
      const card = document.createElement('div');
      card.className = 'item-card';
      card.innerHTML = `
        <label>
          Item name
          <input value="${item.name}" data-field="name" data-index="${index}" />
        </label>
        <label>
          Importance
          <select data-field="importance" data-index="${index}">
            <option${item.importance === 'High' ? ' selected' : ''}>High</option>
            <option${item.importance === 'Medium' ? ' selected' : ''}>Medium</option>
            <option${item.importance === 'Low' ? ' selected' : ''}>Low</option>
          </select>
        </label>
        <label>
          Description
          <textarea data-field="description" data-index="${index}">${item.description}</textarea>
        </label>
        <div class="inline-fields">
          <label>
            Size
            <input value="${item.size}" data-field="size" data-index="${index}" />
          </label>
          <label>
            Weight
            <input value="${item.weight}" data-field="weight" data-index="${index}" />
          </label>
        </div>
        <div class="card-actions">
          <button data-action="toggle-packed" data-index="${index}">${item.packed ? 'Unpack' : 'Packed'}</button>
          <button data-action="remove-item" data-index="${index}">Remove</button>
        </div>
      `;
      if (item.packed) {
        card.style.opacity = '0.85';
      }
      itemsRoot.appendChild(card);
    });
  }

  // Updates a single field on the in-memory plan item as the user types.
  function updateItem(event) {
    const index = Number(event.target.dataset.index);
    const field = event.target.dataset.field;
    if (Number.isNaN(index) || !field) return;
    plan.items[index][field] = event.target.value;
  }

  function removeItem(index) {
    plan.items.splice(index, 1);
    renderItems();
    attachItemListeners();
  }

  function togglePacked(index) {
    plan.items[index].packed = !plan.items[index].packed;
    renderItems();
    attachItemListeners();
  }

  // Must be re-called after every renderItems() because rebuilt DOM nodes lose listeners.
  function attachItemListeners() {
    itemsRoot.querySelectorAll('[data-field]').forEach(input => {
      input.addEventListener('input', updateItem);
    });
    itemsRoot.querySelectorAll('[data-action="remove-item"]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        removeItem(Number(button.dataset.index));
      });
    });
    itemsRoot.querySelectorAll('[data-action="toggle-packed"]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        togglePacked(Number(button.dataset.index));
      });
    });
  }

  // Manually added items have sourceItemId: null, marking them as not from a template.
  // These are the items that "Push items to template" will send back.
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
      packed: false
    });
    renderItems();
    attachItemListeners();
  }

  renderItems();
  attachItemListeners();

  fragment.querySelector('[data-action="back-to-plans"]').addEventListener('click', () => renderPlansList());
  fragment.querySelector('[data-action="add-plan-item"]').addEventListener('click', addItem);
  fragment.querySelector('[data-action="save-plan"]').addEventListener('click', () => {
    plan.name = document.getElementById('plan-title').textContent;
    state.plans = updatePlan(plan);
    state.activePlan = plan;
    alert('Plan saved.');
  });

  // Set tooltips dynamically so they can include the actual template name.
  const tName = templateSource ? templateSource.name : 'template';
  fragment.querySelector('[data-action="sync-plan"]').dataset.tooltip =
    `Adds new items from "${tName}" that aren't in this plan yet`;
  fragment.querySelector('[data-action="push-to-template"]').dataset.tooltip =
    `Sends new items from this plan back to "${tName}"`;

  // Sync: template → plan. Adds any template items not yet in the plan.
  fragment.querySelector('[data-action="sync-plan"]').addEventListener('click', () => {
    if (!templateSource) {
      alert('Template source not available.');
      return;
    }
    syncPlanWithTemplate(plan, templateSource);
    state.plans = updatePlan(plan);
    state.activePlan = plan;
    renderPlanDetail();
  });

  // Push: plan → template. Sends manually added plan items back to the source template.
  // After pushing, updates the plan items' sourceItemId so they won't be pushed again.
  fragment.querySelector('[data-action="push-to-template"]').addEventListener('click', () => {
    if (!templateSource) {
      alert('Template source not available.');
      return;
    }
    const result = pushPlanItemsToTemplate(plan, templateSource);
    if (result.addedCount === 0) {
      alert('No new items to add to the template.');
      return;
    }
    const tIdx = state.templates.findIndex(t => t.id === result.template.id);
    if (tIdx !== -1) state.templates[tIdx] = result.template;
    saveTemplates(state.templates);
    state.plans = updatePlan(result.plan);
    state.activePlan = result.plan;
    alert(`Added ${result.addedCount} item(s) to "${result.template.name}".`);
    renderPlanDetail();
  });

  const deletePlanBtn = fragment.querySelector('[data-action="delete-plan"]');
  deletePlanBtn.addEventListener('click', () => {
    armDeleteButton(deletePlanBtn, () => {
      state.plans = deletePlan(plan.id);
      renderPlansList();
    });
  });

  elements.main.innerHTML = '';
  elements.main.appendChild(fragment);
}

export { initApp };
