import { html, render } from '../vendor/lit/lit-html.js';
import {
  loadTemplates,
  loadPlans,
  deleteTemplate,
  createPlanFromTemplate,
  addPlan,
  updatePlan,
  deletePlan,
  syncPlanWithTemplate,
  pushPlanItemsToTemplate,
  saveTemplates,
} from './storage.js';
import { exportDB } from './db.js';
import { generateId } from './templates.js';

const state = {
  view: 'dashboard',
  templates: [],
  plans: [],
  activeTemplate: null,
  activePlan: null,
  editingTemplate: null,
  editingPlan: null,
};

const elements = {
  main: document.getElementById('app-main'),
  navButtons: Array.from(document.querySelectorAll('.nav-btn')),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rerender() { renderView(state.view); }

function setActiveNav(view) {
  const navKey = { 'template-editor': 'templates', 'plan-detail': 'plans', 'plan-creator': 'plans' }[view] || view;
  elements.navButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.view === navKey));
}

// Two-tap delete guard.
function armDeleteButton(button, onConfirm) {
  if (button.dataset.armed === 'true') { onConfirm(); return; }
  const orig = button.textContent;
  button.dataset.armed = 'true';
  button.textContent = 'Tap again to confirm';
  button.classList.replace('btn-danger', 'btn-danger-armed');
  setTimeout(() => {
    if (button.dataset.armed === 'true') {
      button.dataset.armed = 'false';
      button.textContent = orig;
      button.classList.replace('btn-danger-armed', 'btn-danger');
    }
  }, 3000);
}

async function downloadDB() {
  const bytes = await exportDB();
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'campfixer.db'; a.click();
  URL.revokeObjectURL(url);
}

// ─── extraFields ↔ editing array ──────────────────────────────────────────────

// Adds a _fields array (editable [{key,value}] pairs) alongside extraFields.
function withFields(item) {
  return {
    ...item,
    _fields: Object.entries(item.extraFields || {}).map(([key, value]) => ({ key, value })),
  };
}

// Strips _fields and rebuilds extraFields from it; skips blank keys.
function finalizeItem(item) {
  const extraFields = {};
  for (const { key, value } of (item._fields || [])) {
    if (key.trim()) extraFields[key.trim()] = value;
  }
  const { _fields, ...rest } = item;
  return { ...rest, extraFields };
}

// ─── Entry points (initialize editing state before rendering an editor view) ──

function enterTemplateEditor(template) {
  state.activeTemplate = template || null;
  const base = template
    ? JSON.parse(JSON.stringify(template))
    : { name: '', description: '', defaultItems: [] };
  base.defaultItems = base.defaultItems.map(withFields);
  state.editingTemplate = base;
  renderView('template-editor');
}

function enterPlanDetail(plan) {
  state.activePlan = plan;
  const clone = JSON.parse(JSON.stringify(plan));
  clone.items = clone.items.map(withFields);
  state.editingPlan = clone;
  renderView('plan-detail');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function initApp() {
  state.templates = await loadTemplates();
  state.plans = await loadPlans();
  elements.navButtons.forEach(btn => btn.addEventListener('click', () => renderView(btn.dataset.view)));
  renderView('dashboard');
}

// ─── View dispatch ────────────────────────────────────────────────────────────

function renderView(view) {
  state.view = view;
  setActiveNav(view);
  const views = {
    dashboard: dashboardTemplate,
    templates: templatesListTemplate,
    'template-editor': templateEditorTemplate,
    plans: plansListTemplate,
    'plan-creator': planCreatorTemplate,
    'plan-detail': planDetailTemplate,
  };
  if (views[view]) render(views[view](), elements.main);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function dashboardTemplate() {
  return html`
    <section class="panel">
      <h2 class="text-xl font-semibold mb-1">Campfixer Dashboard</h2>
      <p class="text-slate-500 dark:text-slate-400 text-sm mb-5">
        Use templates to create custom camping packing plans. Sync plans when you add new default items.
      </p>
      <div class="card-grid">
        <div class="card">
          <h3>Templates</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Manage your camping templates and default pack items.</p>
          <button @click=${() => renderView('templates')} class="btn-primary">Open Templates</button>
        </div>
        <div class="card">
          <h3>Packing Plans</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Create and sync plans from templates, then keep your packing list ready.</p>
          <button @click=${() => renderView('plans')} class="btn-primary">Open Plans</button>
        </div>
        <div class="card">
          <h3>Backup</h3>
          <p class="text-sm text-slate-500 dark:text-slate-400 mb-4">Download a copy of the SQLite database file for offline backup.</p>
          <button @click=${downloadDB} class="btn-secondary">⬇ Download database</button>
        </div>
      </div>
    </section>
  `;
}

// ─── Templates list ───────────────────────────────────────────────────────────

function templatesListTemplate() {
  return html`
    <section class="panel">
      <div class="panel-header">
        <h2 class="text-xl font-semibold">Templates</h2>
        <button @click=${() => enterTemplateEditor(null)} class="btn-primary">New template</button>
      </div>
      <div class="list">
        ${state.templates.length === 0
          ? html`<p class="empty-state">No templates found. Add one to get started.</p>`
          : state.templates.map(t => html`
              <div class="item-card">
                <strong>${t.name}</strong>
                <p>${t.description}</p>
                <small>${t.defaultItems.length} default item(s)</small>
                <div class="card-actions">
                  <button @click=${() => enterTemplateEditor(t)} class="btn-secondary">Edit</button>
                  <button @click=${async () => {
                    const copy = JSON.parse(JSON.stringify(t));
                    copy.id = generateId('template');
                    copy.name = `${t.name} copy`;
                    copy.version = 1;
                    state.templates.unshift(copy);
                    await saveTemplates(state.templates);
                    rerender();
                  }} class="btn-secondary">Duplicate</button>
                </div>
              </div>
            `)
        }
      </div>
    </section>
  `;
}

// ─── Template editor ──────────────────────────────────────────────────────────

function extraFieldsSection(item) {
  return html`
    ${(item._fields || []).map((field, fi) => html`
      <div class="inline-fields">
        <label>Key
          <input .value=${field.key} placeholder="Field name"
                 @input=${e => { item._fields[fi].key = e.target.value; }} />
        </label>
        <label>Value
          <input .value=${field.value} placeholder="Value"
                 @input=${e => { item._fields[fi].value = e.target.value; }} />
        </label>
        <button @click=${() => { item._fields.splice(fi, 1); rerender(); }}
                class="btn-danger" style="align-self:flex-end">×</button>
      </div>
    `)}
    <button @click=${() => { item._fields.push({ key: '', value: '' }); rerender(); }}
            class="btn-secondary">+ Add field</button>
  `;
}

function templateItemCard(item, index) {
  const t = state.editingTemplate;
  return html`
    <div class="item-card">
      <label>Item name
        <input .value=${item.name}
               @input=${e => { t.defaultItems[index].name = e.target.value; }} />
      </label>
      <label>Importance
        <select @change=${e => { t.defaultItems[index].importance = e.target.value; }}>
          <option value="High" ?selected=${item.importance === 'High'}>High</option>
          <option value="Medium" ?selected=${item.importance === 'Medium'}>Medium</option>
          <option value="Low" ?selected=${item.importance === 'Low'}>Low</option>
        </select>
      </label>
      <label>Description
        <textarea .value=${item.description}
                  @input=${e => { t.defaultItems[index].description = e.target.value; }}></textarea>
      </label>
      <div class="inline-fields">
        <label>Size
          <input .value=${item.size}
                 @input=${e => { t.defaultItems[index].size = e.target.value; }} />
        </label>
        <label>Weight
          <input .value=${item.weight}
                 @input=${e => { t.defaultItems[index].weight = e.target.value; }} />
        </label>
      </div>
      ${extraFieldsSection(item)}
      <div class="card-actions">
        <button @click=${() => { t.defaultItems.splice(index, 1); rerender(); }} class="btn-danger">Remove</button>
      </div>
    </div>
  `;
}

function templateEditorTemplate() {
  const t = state.editingTemplate;
  if (!t) return html``;
  return html`
    <section class="panel">
      <div class="panel-header">
        <button @click=${() => renderView('templates')} class="btn-secondary">← Back</button>
        <h2 class="text-xl font-semibold">${t.name ? `Edit template: ${t.name}` : 'New template'}</h2>
      </div>
      <form class="form-grid" @submit=${e => e.preventDefault()}>
        <label>Template name
          <input type="text" name="name" .value=${t.name}
                 @input=${e => { t.name = e.target.value; }} required />
        </label>
        <label>Description
          <textarea name="description" rows="3" .value=${t.description}
                    @input=${e => { t.description = e.target.value; }}></textarea>
        </label>
      </form>
      <div class="section-header mt-6 mb-1">
        <h3 class="font-semibold text-slate-900 dark:text-slate-100">Default items</h3>
        <button @click=${() => {
          t.defaultItems.push({
            id: generateId('item'),
            name: 'New item',
            importance: 'Medium',
            description: '',
            size: '',
            weight: '',
            extraFields: {},
            _fields: [],
          });
          rerender();
        }} class="btn-secondary">+ Add item</button>
      </div>
      <div class="list">
        ${t.defaultItems.map((item, i) => templateItemCard(item, i))}
      </div>
      <div class="form-actions">
        <button @click=${saveEditingTemplate} class="btn-primary">Save template</button>
        <button @click=${async () => {
          if (!t.id) { renderView('templates'); return; }
          if (confirm('Delete this template?')) {
            state.templates = await deleteTemplate(t.id);
            state.editingTemplate = null;
            renderView('templates');
          }
        }} class="btn-danger">Delete template</button>
      </div>
    </section>
  `;
}

async function saveEditingTemplate() {
  const t = state.editingTemplate;
  t.name = (t.name || '').trim() || 'Untitled template';
  t.defaultItems = t.defaultItems.map(finalizeItem);
  if (!t.id) {
    t.id = generateId('template');
    t.version = 1;
    t.updatedAt = new Date().toISOString().split('T')[0];
    state.templates.unshift(t);
  } else {
    const idx = state.templates.findIndex(x => x.id === t.id);
    if (idx !== -1) {
      t.version = (state.templates[idx].version || 1) + 1;
      t.updatedAt = new Date().toISOString().split('T')[0];
      state.templates[idx] = t;
    }
  }
  await saveTemplates(state.templates);
  state.editingTemplate = null;
  renderView('templates');
}

// ─── Plans list ───────────────────────────────────────────────────────────────

function plansListTemplate() {
  return html`
    <section class="panel">
      <div class="panel-header">
        <h2 class="text-xl font-semibold">Packing Plans</h2>
        <button @click=${() => renderView('plan-creator')} class="btn-primary">New packing plan</button>
      </div>
      <div class="list">
        ${state.plans.length === 0
          ? html`<p class="empty-state">No plans created yet. Create one from a template.</p>`
          : state.plans.map(plan => {
              const src = state.templates.find(t => t.id === plan.templateId);
              return html`
                <div class="item-card">
                  <strong>${plan.name}</strong>
                  <p>From template: ${src ? src.name : 'Unknown'}</p>
                  <small>${plan.items.length} item(s)</small>
                  <div class="card-actions">
                    <button @click=${() => enterPlanDetail(plan)} class="btn-primary">Open</button>
                    <button @click=${e => armDeleteButton(e.currentTarget, async () => {
                      state.plans = await deletePlan(plan.id);
                      rerender();
                    })} class="btn-danger">Delete</button>
                  </div>
                </div>
              `;
            })
        }
      </div>
    </section>
  `;
}

// ─── Plan creator ─────────────────────────────────────────────────────────────

function planCreatorTemplate() {
  return html`
    <div class="panel">
      <div class="panel-header">
        <button @click=${() => renderView('plans')} class="btn-secondary">← Back</button>
        <h2 class="text-xl font-semibold">Create packing plan</h2>
      </div>
      <form class="form-grid" id="create-plan-form" @submit=${e => e.preventDefault()}>
        <label>Plan name<input name="planName" type="text" placeholder="My weekend trip" required /></label>
        <label>Choose template
          <select name="templateId">
            ${state.templates.map(t => html`<option value=${t.id}>${t.name}</option>`)}
          </select>
        </label>
      </form>
      <div class="form-actions">
        <button @click=${async () => {
          const form = elements.main.querySelector('#create-plan-form');
          const planName = form.planName.value.trim();
          const templateId = form.templateId.value;
          if (!planName) { alert('Please enter a plan name.'); return; }
          const template = state.templates.find(t => t.id === templateId);
          if (!template) { alert('Please choose a valid template.'); return; }
          const plan = await createPlanFromTemplate(template, planName);
          state.plans = await addPlan(plan);
          enterPlanDetail(plan);
        }} class="btn-primary">Create plan</button>
      </div>
    </div>
  `;
}

// ─── Plan detail ──────────────────────────────────────────────────────────────

function planItemCard(item, index) {
  const plan = state.editingPlan;
  return html`
    <div class="item-card${item.packed ? ' opacity-60' : ''}">
      <label>Item name
        <input .value=${item.name}
               @input=${e => { plan.items[index].name = e.target.value; }} />
      </label>
      <label>Importance
        <select @change=${e => { plan.items[index].importance = e.target.value; }}>
          <option value="High" ?selected=${item.importance === 'High'}>High</option>
          <option value="Medium" ?selected=${item.importance === 'Medium'}>Medium</option>
          <option value="Low" ?selected=${item.importance === 'Low'}>Low</option>
        </select>
      </label>
      <label>Description
        <textarea .value=${item.description}
                  @input=${e => { plan.items[index].description = e.target.value; }}></textarea>
      </label>
      <div class="inline-fields">
        <label>Size
          <input .value=${item.size}
                 @input=${e => { plan.items[index].size = e.target.value; }} />
        </label>
        <label>Weight
          <input .value=${item.weight}
                 @input=${e => { plan.items[index].weight = e.target.value; }} />
        </label>
      </div>
      ${extraFieldsSection(item)}
      <div class="card-actions">
        <button @click=${() => {
          plan.items[index].packed = !plan.items[index].packed;
          rerender();
        }} class="btn-secondary">${item.packed ? 'Unpack' : 'Pack'}</button>
        <button @click=${() => { plan.items.splice(index, 1); rerender(); }} class="btn-danger">Remove</button>
      </div>
    </div>
  `;
}

function planDetailTemplate() {
  if (!state.editingPlan) { renderView('plans'); return html``; }
  const plan = state.editingPlan;
  const templateSource = state.templates.find(t => t.id === plan.templateId);
  const tName = templateSource ? templateSource.name : 'template';

  return html`
    <section class="panel">
      <div class="panel-header">
        <button @click=${() => renderView('plans')} class="btn-secondary">← Back</button>
        <div>
          <h2 class="text-xl font-semibold">${plan.name}</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400">From template: ${tName}</p>
        </div>
      </div>
      <div class="section-header mb-1">
        <h3 class="font-semibold text-slate-900 dark:text-slate-100">Packing items</h3>
        <button @click=${() => {
          plan.items.push({
            planItemId: generateId('plan'),
            sourceTemplateId: null,
            sourceItemId: null,
            name: 'New item',
            importance: 'Medium',
            description: '',
            size: '',
            weight: '',
            packed: false,
            extraFields: {},
            _fields: [],
          });
          rerender();
        }} class="btn-secondary">+ Add item</button>
      </div>
      <div class="list">
        ${plan.items.map((item, i) => planItemCard(item, i))}
      </div>
      <div class="form-actions">
        <button title=${"Adds new items from \"" + tName + "\" that aren't in this plan yet"}
                @click=${async () => {
                  if (!templateSource) { alert('Template source not available.'); return; }
                  plan.items = plan.items.map(finalizeItem);
                  await syncPlanWithTemplate(plan, templateSource);
                  state.plans = await updatePlan(plan);
                  const updated = state.plans.find(p => p.id === plan.id) || plan;
                  enterPlanDetail(updated);
                }} class="btn-sync">Sync with template</button>
        <button title=${"Sends new items from this plan back to \"" + tName + "\""}
                @click=${async () => {
                  if (!templateSource) { alert('Template source not available.'); return; }
                  plan.items = plan.items.map(finalizeItem);
                  const result = await pushPlanItemsToTemplate(plan, templateSource);
                  if (result.addedCount === 0) { alert('No new items to add to the template.'); return; }
                  const tIdx = state.templates.findIndex(t => t.id === result.template.id);
                  if (tIdx !== -1) state.templates[tIdx] = result.template;
                  await saveTemplates(state.templates);
                  state.plans = await updatePlan(result.plan);
                  const updated = state.plans.find(p => p.id === result.plan.id) || result.plan;
                  alert(`Added ${result.addedCount} item(s) to "${result.template.name}".`);
                  enterPlanDetail(updated);
                }} class="btn-push">Push items to template</button>
        <button @click=${saveEditingPlan} class="btn-primary">Save plan</button>
        <button @click=${e => armDeleteButton(e.currentTarget, async () => {
          state.plans = await deletePlan(plan.id);
          state.editingPlan = null;
          renderView('plans');
        })} class="btn-danger">Delete plan</button>
        <button @click=${downloadDB} class="btn-secondary">⬇ Download database</button>
      </div>
    </section>
  `;
}

async function saveEditingPlan() {
  const plan = state.editingPlan;
  plan.items = plan.items.map(finalizeItem);
  state.plans = await updatePlan(plan);
  const saved = state.plans.find(p => p.id === plan.id) || plan;
  state.activePlan = saved;
  enterPlanDetail(saved);
  alert('Plan saved.');
}

export { initApp };
