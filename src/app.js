// UI layer: view templates, state management, and event wiring.
// No SQL here — all persistence goes through storage.js.
//
// Domain model
// ─────────────
// Plan    — a reusable camping checklist with a default set of items.
//           Managed in the Config tab via the plan editor.
// Trip    — a specific outing created from a Plan; items can diverge
//           from the Plan over time. Listed on the Trips tab.
// TripItem — one line-item on a Trip (checkbox, importance, size, weight).
// PlanItem — one line-item on a Plan; copied into TripItems on Trip creation.

import { html, render } from '../vendor/lit/lit-html.js';
import {
  loadPlans,
  savePlans,
  deletePlan,
  loadTrips,
  createTripFromPlan,
  addTrip,
  updateTrip,
  deleteTrip,
  syncTripWithPlan,
  pushTripItemsToPlan,
} from './storage.js';
import { exportDB } from './db.js';
import { generateId, SIZE_OPTIONS } from './templates.js';

// ─── State ────────────────────────────────────────────────────────────────────

const state = {
  view: 'trips',
  plans: [],              // Plan[] — reusable checklists
  trips: [],              // Trip[] — specific outings
  activePlan: null,       // Plan being edited in the plan editor
  activeTrip: null,       // Trip the user tapped into
  editingPlan: null,      // working copy of activePlan (with _fields arrays)
  editingTrip: null,      // working copy of activeTrip (with _fields arrays)
  expandedTripItemIndex: null,  // index of the inline-expanded TripItem, or null
  expandedPlanItemIndex: null,  // index of the inline-expanded PlanItem, or null
};

const elements = {
  main: document.getElementById('app-main'),
};

// ─── Core helpers ─────────────────────────────────────────────────────────────

function rerender() { renderView(state.view); }

function setActiveNav(view) {
  const navKey = {
    'trip-detail':  'trips',
    'trip-creator': 'trips',
    'plan-editor':  'config',
  }[view] || view;
  document.querySelectorAll('.bottom-nav-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.view === navKey));
}

// Two-tap delete guard — first tap arms, second tap confirms.
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

// ─── Weight unit preference ───────────────────────────────────────────────────

function getWeightUnit() {
  return localStorage.getItem('campfixer:weightUnit') || 'lbs';
}

function toggleWeightUnit() {
  localStorage.setItem('campfixer:weightUnit', getWeightUnit() === 'lbs' ? 'kg' : 'lbs');
  rerender();
}

// ─── extraFields ↔ editing array ──────────────────────────────────────────────

function withFields(item) {
  return {
    ...item,
    _fields: Object.entries(item.extraFields || {}).map(([key, value]) => ({ key, value })),
  };
}

function finalizeItem(item) {
  const extraFields = {};
  for (const { key, value } of (item._fields || [])) {
    if (key.trim()) extraFields[key.trim()] = value;
  }
  const { _fields, ...rest } = item;
  return { ...rest, extraFields };
}

// ─── Computed helpers ─────────────────────────────────────────────────────────

// Counts Plan items not yet present in the Trip (by sourcePlanItemId match).
// Used to show the "new items available" sync badge.
function syncBadgeCount(trip) {
  const plan = state.plans.find(p => p.id === trip.planId);
  if (!plan || plan.version <= trip.lastSyncedVersion) return 0;
  const existingSourceIds = new Set(trip.items.map(i => i.sourcePlanItemId).filter(Boolean));
  return plan.defaultItems.filter(item => !existingSourceIds.has(item.id)).length;
}

function packedProgress(trip) {
  const total = trip.items.length;
  const packed = trip.items.filter(i => i.packed).length;
  return { packed, total, pct: total ? Math.round((packed / total) * 100) : 0 };
}

function importanceBadge(importance) {
  const map = {
    High:   ['badge-high',   '🔴'],
    Medium: ['badge-medium', '🟡'],
    Low:    ['badge-low',    '🟢'],
  };
  const [cls, dot] = map[importance] || map.Medium;
  return html`<span class="badge ${cls}">${dot} ${importance}</span>`;
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function stumpySVG(cls = 'w-24 h-24') {
  return html`
    <svg class="${cls} text-stone-300 dark:text-forest-green/40" viewBox="0 0 100 100"
         fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="50" cy="45" r="22"/>
      <circle cx="35" cy="27" r="8"/>
      <circle cx="65" cy="27" r="8"/>
      <circle cx="43" cy="42" r="2.5" fill="currentColor" stroke="none"/>
      <circle cx="57" cy="42" r="2.5" fill="currentColor" stroke="none"/>
      <ellipse cx="50" cy="50" rx="5" ry="3.5" fill="currentColor" stroke="none"/>
      <rect x="30" y="64" width="40" height="28" rx="12"/>
      <path d="M30 74 Q18 70 20 82"/>
      <path d="M70 74 Q82 70 80 82"/>
    </svg>`;
}

function gearSVG(cls = 'w-10 h-10') {
  return html`
    <svg class="${cls} text-stone-300 dark:text-forest-green/40" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2v2m0 16v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M2 12h2m16 0h2
               M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
    </svg>`;
}

// ─── Entry points ─────────────────────────────────────────────────────────────

// Opens the plan editor for an existing Plan or starts a new one.
function enterPlanEditor(plan) {
  state.activePlan = plan || null;
  const base = plan
    ? JSON.parse(JSON.stringify(plan))
    : { name: '', description: '', defaultItems: [] };
  base.defaultItems = base.defaultItems.map(withFields);
  state.editingPlan = base;
  state.expandedPlanItemIndex = null;
  renderView('plan-editor');
}

// Opens the trip detail view for a Trip.
function enterTripDetail(trip) {
  state.activeTrip = trip;
  const clone = JSON.parse(JSON.stringify(trip));
  clone.items = clone.items.map(withFields);
  state.editingTrip = clone;
  state.expandedTripItemIndex = null;
  renderView('trip-detail');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initApp() {
  state.plans = await loadPlans();   // Plans: reusable checklists
  state.trips = await loadTrips();   // Trips: specific outings

  document.querySelectorAll('.bottom-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => renderView(btn.dataset.view)));

  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.addEventListener('click', () => renderView('trip-creator'));

  renderView('trips');
}

// ─── View dispatch ────────────────────────────────────────────────────────────

function renderView(view) {
  state.view = view;
  setActiveNav(view);
  const views = {
    trips:          tripsListTemplate,
    'trip-creator': tripCreatorTemplate,
    'trip-detail':  tripDetailTemplate,
    config:         configTemplate,
    'plan-editor':  planEditorTemplate,
  };
  if (views[view]) render(views[view](), elements.main);

  if (view === 'config') {
    const btn = elements.main.querySelector('#theme-toggle-config');
    if (btn) btn.addEventListener('click', applyThemeToggle);
  }
}

// ─── Trips list (home) ────────────────────────────────────────────────────────

function tripsListTemplate() {
  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.remove('hidden');

  if (state.trips.length === 0) {
    return html`
      <section class="px-4 pt-6">
        <h2 class="font-display text-2xl font-bold text-forest-green dark:text-sage-green mb-1">My Trips</h2>
        <div class="empty-state-new mt-8">
          ${stumpySVG()}
          <p>Nothing packed yet! Start a new trip and I'll keep track.</p>
        </div>
      </section>`;
  }

  return html`
    <section class="px-4 pt-6">
      <h2 class="font-display text-2xl font-bold text-forest-green dark:text-sage-green mb-4">My Trips</h2>
      <div class="grid gap-4">
        ${state.trips.map(trip => tripCardTemplate(trip))}
      </div>
    </section>`;
}

function tripCardTemplate(trip) {
  const { packed, total, pct } = packedProgress(trip);
  const srcPlan = state.plans.find(p => p.id === trip.planId);
  const badge = syncBadgeCount(trip);

  return html`
    <div class="trip-card" @click=${() => enterTripDetail(trip)} role="button" tabindex="0">
      <div class="trip-card-header">
        <div class="w-10 h-10 rounded-full bg-forest-green/10 dark:bg-forest-green/20
                    flex items-center justify-center text-xl flex-shrink-0">🏕️</div>
        <div class="flex-1 min-w-0">
          <p class="trip-card-title truncate">${trip.name}</p>
          <p class="text-xs text-stone-400 dark:text-stone-500 mt-0.5 truncate">
            ${srcPlan ? srcPlan.name : 'Custom'}
          </p>
        </div>
        ${badge > 0 ? html`
          <span class="flex-shrink-0 text-xs bg-camp-amber text-white rounded-full px-2 py-0.5 font-medium">
            ${badge} new
          </span>` : ''}
      </div>
      <div class="trip-card-body">
        <div class="flex justify-between text-xs text-stone-500 dark:text-stone-400 mb-1.5">
          <span>${packed} of ${total} packed</span>
          <span>${pct}%</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${pct}%"></div>
        </div>
      </div>
      ${trip.createdAt ? html`
        <div class="trip-card-footer">Created ${trip.createdAt.slice(0, 10)}</div>` : ''}
    </div>`;
}

// ─── Trip detail ──────────────────────────────────────────────────────────────

// Condensed TripItem row: [checkbox] [name] [badge] [pencil]. Pencil toggles inline expansion.
function tripItemRow(item, index) {
  const isExpanded = state.expandedTripItemIndex === index;

  return html`
    <div class="item-row-wrap">
      <div class="check-row" @click=${() => togglePackedTripItem(index)}>
        <div class="check-box ${item.packed ? 'checked' : ''}">
          ${item.packed ? html`
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 13l4 4L19 7"/>
            </svg>` : ''}
        </div>
        <span class="check-row-label ${item.packed ? 'packed' : ''} flex-1 min-w-0 truncate">${item.name}</span>
        ${importanceBadge(item.importance)}
        <button class="flex-shrink-0 w-9 h-9 flex items-center justify-center
                       text-stone-400 hover:text-stone-600 dark:hover:text-stone-300
                       rounded-lg transition-colors"
                @click=${e => { e.stopPropagation(); toggleExpandedTripItem(index); }}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/>
            <path d="M18.586 2.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l9.586-9.586z"/>
          </svg>
        </button>
      </div>
      ${isExpanded ? tripItemExpandedTemplate(item, index) : ''}
    </div>`;
}

// Inline edit form shown when a TripItem row is expanded.
function tripItemExpandedTemplate(item, index) {
  const unit = getWeightUnit();
  return html`
    <div class="item-expand">
      <div class="grid gap-3">
        <label class="form-label">Name
          <input type="text" .value=${item.name}
                 @input=${e => { state.editingTrip.items[index].name = e.target.value; rerender(); }} />
        </label>

        <div>
          <p class="form-label mb-1">Importance</p>
          <div class="importance-toggle">
            ${['High', 'Medium', 'Low'].map(level => html`
              <button class="importance-btn ${item.importance === level ? 'selected' : ''}"
                      data-value="${level}"
                      @click=${() => {
                        state.editingTrip.items[index].importance = level;
                        rerender();
                      }}>
                ${level}
              </button>`)}
          </div>
        </div>

        <div class="inline-fields">
          <label class="form-label">Size
            <select .value=${item.size || ''}
                    @change=${e => { state.editingTrip.items[index].size = e.target.value; }}>
              <option value="">— pick size —</option>
              ${SIZE_OPTIONS.map(s => html`
                <option value=${s.value} ?selected=${item.size === s.value}>${s.label}</option>`)}
            </select>
          </label>
          <label class="form-label">Weight (${unit})
            <input type="number" min="0" step="0.1" .value=${item.weight || ''}
                   @input=${e => { state.editingTrip.items[index].weight = e.target.value; }} />
          </label>
        </div>

        <label class="form-label">Notes
          <textarea rows="2" .value=${item.description || ''}
                    @input=${e => { state.editingTrip.items[index].description = e.target.value; }}></textarea>
        </label>
      </div>

      <div class="flex gap-2 mt-3">
        <button @click=${() => { state.expandedTripItemIndex = null; rerender(); }}
                class="btn-secondary text-sm">Done</button>
        <button @click=${() => removeTripItem(index)} class="btn-danger text-sm ml-auto">Remove</button>
      </div>
    </div>`;
}

function toggleExpandedTripItem(index) {
  state.expandedTripItemIndex = state.expandedTripItemIndex === index ? null : index;
  rerender();
}

function togglePackedTripItem(index) {
  if (!state.editingTrip) return;
  state.editingTrip.items[index].packed = !state.editingTrip.items[index].packed;
  rerender();
}

function removeTripItem(index) {
  if (!state.editingTrip) return;
  state.editingTrip.items.splice(index, 1);
  if (state.expandedTripItemIndex === index) state.expandedTripItemIndex = null;
  rerender();
}

function addNewTripItem() {
  if (!state.editingTrip) return;
  const newItem = withFields({
    tripItemId: generateId('trip'),
    sourcePlanId: null,
    sourcePlanItemId: null,
    name: 'New item',
    importance: 'Medium',
    description: '',
    size: '',
    weight: '',
    packed: false,
    extraFields: {},
  });
  state.editingTrip.items.push(newItem);
  const index = state.editingTrip.items.length - 1;
  state.expandedTripItemIndex = index;
  rerender();
}

async function syncTripNow() {
  const trip = state.editingTrip;
  if (!trip) return;
  const plan = state.plans.find(p => p.id === trip.planId);
  if (!plan) { alert('Plan source not available.'); return; }
  trip.items = trip.items.map(finalizeItem);
  await syncTripWithPlan(trip, plan);
  state.trips = await updateTrip(trip);
  const updated = state.trips.find(t => t.id === trip.id) || trip;
  enterTripDetail(updated);
}

async function pushTripNow() {
  const trip = state.editingTrip;
  if (!trip) return;
  const plan = state.plans.find(p => p.id === trip.planId);
  if (!plan) { alert('Plan source not available.'); return; }
  trip.items = trip.items.map(finalizeItem);
  const result = await pushTripItemsToPlan(trip, plan);
  if (result.addedCount === 0) { alert('No new items to add to the plan.'); return; }
  const pIdx = state.plans.findIndex(p => p.id === result.plan.id);
  if (pIdx !== -1) state.plans[pIdx] = result.plan;
  await savePlans(state.plans);
  state.trips = await updateTrip(result.trip);
  alert(`Added ${result.addedCount} item(s) to "${result.plan.name}".`);
  enterTripDetail(state.trips.find(t => t.id === result.trip.id) || result.trip);
}

async function saveEditingTrip(silent = false) {
  const trip = state.editingTrip;
  if (!trip) return;
  trip.items = trip.items.map(finalizeItem);
  state.trips = await updateTrip(trip);
  const saved = state.trips.find(t => t.id === trip.id) || trip;
  state.activeTrip = saved;
  enterTripDetail(saved);
  if (!silent) alert('Trip saved.');
}

async function deleteTripNow() {
  if (!state.editingTrip) return;
  state.trips = await deleteTrip(state.editingTrip.id);
  state.editingTrip = null;
  renderView('trips');
}

function tripDetailTemplate() {
  if (!state.editingTrip) { renderView('trips'); return html``; }
  const trip = state.editingTrip;
  const srcPlan = state.plans.find(p => p.id === trip.planId);
  const badge = syncBadgeCount(trip);
  const { packed, total, pct } = packedProgress(trip);

  const highItems   = trip.items.filter(i => !i.packed && i.importance === 'High');
  const medItems    = trip.items.filter(i => !i.packed && i.importance === 'Medium');
  const lowItems    = trip.items.filter(i => !i.packed && i.importance === 'Low');
  const packedItems = trip.items.filter(i => i.packed);

  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.add('hidden');

  return html`
    <section class="px-4 pt-4 pb-6">

      <!-- Back + title -->
      <div class="flex items-center gap-3 mb-4 flex-wrap">
        <button @click=${() => { saveEditingTrip(true); }} class="btn-secondary">← Back</button>
        <h2 class="font-display text-xl font-bold text-forest-green dark:text-sage-green flex-1 min-w-0 truncate">
          ${trip.name}
        </h2>
        ${badge > 0 ? html`
          <button @click=${syncTripNow} class="btn-sync">
            Sync
            <span class="ml-1 bg-white/30 rounded-full px-1.5 py-0.5 text-xs">${badge}</span>
          </button>` : ''}
      </div>

      <!-- Progress summary -->
      <div class="mb-5">
        <div class="flex justify-between text-sm text-stone-500 dark:text-stone-400 mb-1.5">
          <span>${packed} of ${total} packed</span><span>${pct}%</span>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
      </div>

      <!-- Action row -->
      <div class="flex gap-2 mb-5 flex-wrap">
        <button @click=${addNewTripItem} class="btn-secondary">+ Add item</button>
        ${srcPlan ? html`
          <button @click=${pushTripNow} class="btn-push">Push to plan</button>` : ''}
        <button @click=${() => saveEditingTrip(false)} class="btn-primary">Save</button>
        <button @click=${e => armDeleteButton(e.currentTarget, deleteTripNow)} class="btn-danger">
          Delete trip
        </button>
      </div>

      <!-- High importance — always rendered, hidden when empty -->
      <details class="section-group ${highItems.length === 0 ? 'hidden' : ''}" open>
        <summary>
          <span>🔴 High <span class="badge badge-high ml-2">${highItems.length}</span></span>
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${highItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Medium importance -->
      <details class="section-group ${medItems.length === 0 ? 'hidden' : ''}" open>
        <summary>
          <span>🟡 Medium <span class="badge badge-medium ml-2">${medItems.length}</span></span>
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${medItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Low importance -->
      <details class="section-group ${lowItems.length === 0 ? 'hidden' : ''}">
        <summary>
          <span>🟢 Low <span class="badge badge-low ml-2">${lowItems.length}</span></span>
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${lowItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Packed items -->
      <details class="section-group ${packedItems.length === 0 ? 'hidden' : ''}">
        <summary>
          <span class="text-stone-400 dark:text-stone-500">
            ✓ Packed <span class="ml-2 text-xs font-normal">${packedItems.length}</span>
          </span>
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div class="opacity-60">
          ${packedItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

    </section>`;
}

// ─── Trip creator ─────────────────────────────────────────────────────────────

function tripCreatorTemplate() {
  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.add('hidden');

  // No plans to start from — prompt user to create one first.
  if (state.plans.length === 0) {
    return html`
      <div class="panel">
        <div class="panel-header">
          <button @click=${() => renderView('trips')} class="btn-secondary">← Back</button>
          <h2 class="font-display text-xl font-bold text-forest-green dark:text-sage-green">
            New Trip
          </h2>
        </div>
        <div class="empty-state-new mt-8">
          ${gearSVG('w-16 h-16')}
          <p>
            No plans yet.
            <button @click=${() => renderView('config')} class="inline-link">Add a plan in Config</button>
            to get started.
          </p>
        </div>
      </div>`;
  }

  return html`
    <div class="panel">
      <div class="panel-header">
        <button @click=${() => renderView('trips')} class="btn-secondary">← Back</button>
        <h2 class="font-display text-xl font-bold text-forest-green dark:text-sage-green">
          New Trip
        </h2>
      </div>
      <form class="form-grid" id="create-trip-form" @submit=${e => e.preventDefault()}>
        <label>Trip name
          <input name="tripName" type="text" placeholder="My weekend trip" required />
        </label>
        <label>Start from plan
          <select name="planId">
            ${state.plans.map(p => html`<option value=${p.id}>${p.name}</option>`)}
          </select>
        </label>
      </form>
      <div class="form-actions">
        <button @click=${async () => {
          const form = elements.main.querySelector('#create-trip-form');
          const tripName = form.tripName.value.trim();
          const planId = form.planId.value;
          if (!tripName) { alert('Please enter a trip name.'); return; }
          const plan = state.plans.find(p => p.id === planId);
          if (!plan) { alert('Please choose a valid plan.'); return; }
          const trip = await createTripFromPlan(plan, tripName);
          state.trips = await addTrip(trip);
          enterTripDetail(trip);
        }} class="btn-primary">Create trip</button>
      </div>
    </div>`;
}

// ─── Config ───────────────────────────────────────────────────────────────────

function configTemplate() {
  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.add('hidden');

  const isDark = document.documentElement.classList.contains('dark');
  const unit = getWeightUnit();

  return html`
    <section class="px-4 pt-6 pb-6">

      <!-- Stumpy header -->
      <div class="flex items-center gap-4 mb-6">
        <div class="flex-shrink-0 w-14 h-14 rounded-full bg-forest-green/10 dark:bg-forest-green/20
                    flex items-center justify-center overflow-hidden">
          ${stumpySVG('w-12 h-12')}
        </div>
        <div>
          <h2 class="font-display text-2xl font-bold text-forest-green dark:text-sage-green">Config</h2>
          <p class="text-sm text-stone-400 dark:text-stone-500">Settings &amp; Admin</p>
        </div>
      </div>

      <!-- Plans (reusable checklists) -->
      <p class="config-section-header" style="margin-top:0">Plans</p>
      <div class="grid gap-3">
        ${state.plans.length === 0
          ? html`<p class="empty-state">No plans yet.</p>`
          : state.plans.map(p => html`
              <div class="config-card flex items-center gap-3">
                <div class="flex-1 min-w-0">
                  <p class="font-semibold text-stone-800 dark:text-stone-200 truncate">${p.name}</p>
                  <p class="text-xs text-stone-400 mt-0.5">
                    ${p.defaultItems.length} items · updated ${p.updatedAt || '—'}
                  </p>
                </div>
                <button @click=${() => enterPlanEditor(p)}
                        class="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">Edit</button>
                <button @click=${async () => {
                  const copy = JSON.parse(JSON.stringify(p));
                  copy.id = generateId('plan');
                  copy.name = `${p.name} copy`;
                  copy.version = 1;
                  state.plans.unshift(copy);
                  await savePlans(state.plans);
                  rerender();
                }} class="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">Dup</button>
              </div>`)}
      </div>
      <button @click=${() => enterPlanEditor(null)} class="btn-primary mt-4">+ New plan</button>

      <!-- Appearance -->
      <p class="config-section-header">Appearance</p>
      <div class="config-card flex items-center justify-between mb-3">
        <div>
          <p class="font-medium text-stone-800 dark:text-stone-200">Theme</p>
          <p class="text-xs text-stone-400 mt-0.5">${isDark ? 'Dark Moss' : 'Aged Paper'}</p>
        </div>
        <button id="theme-toggle-config" class="btn-icon" aria-label="Toggle theme">
          <span>${isDark ? '☀' : '🌙'}</span>
        </button>
      </div>
      <div class="config-card flex items-center justify-between">
        <div>
          <p class="font-medium text-stone-800 dark:text-stone-200">Weight unit</p>
          <p class="text-xs text-stone-400 mt-0.5">Used for all item weight fields</p>
        </div>
        <button @click=${toggleWeightUnit}
                class="btn-secondary text-xs px-3 py-1.5 flex-shrink-0 font-mono">
          ${unit === 'lbs' ? 'lbs → kg' : 'kg → lbs'}
        </button>
      </div>

      <!-- Backup -->
      <p class="config-section-header">Backup</p>
      <div class="config-card flex items-center justify-between">
        <div>
          <p class="font-medium text-stone-800 dark:text-stone-200">Download database</p>
          <p class="text-xs text-stone-400 mt-0.5">SQLite .db file for offline backup</p>
        </div>
        <button @click=${downloadDB} class="btn-secondary text-xs px-3 py-1.5 flex-shrink-0">
          ⬇ Backup
        </button>
      </div>

    </section>`;
}

// ─── Plan editor ──────────────────────────────────────────────────────────────

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
            class="btn-secondary">+ Add field</button>`;
}

// Condensed PlanItem row in the plan editor, with inline expansion.
function planItemRow(item, index) {
  const p = state.editingPlan;
  const isExpanded = state.expandedPlanItemIndex === index;
  const unit = getWeightUnit();

  return html`
    <div class="item-row-wrap">
      <!-- Condensed row: name + badge + pencil -->
      <div class="check-row" style="cursor:default">
        <span class="check-row-label flex-1 min-w-0 truncate">${item.name || 'Unnamed item'}</span>
        ${importanceBadge(item.importance)}
        <button class="flex-shrink-0 w-9 h-9 flex items-center justify-center
                       text-stone-400 hover:text-stone-600 dark:hover:text-stone-300
                       rounded-lg transition-colors"
                @click=${() => {
                  state.expandedPlanItemIndex = isExpanded ? null : index;
                  rerender();
                }}>
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5"/>
            <path d="M18.586 2.414a2 2 0 1 1 2.828 2.828L11.828 15H9v-2.828l9.586-9.586z"/>
          </svg>
        </button>
      </div>

      <!-- Inline edit form -->
      ${isExpanded ? html`
        <div class="item-expand">
          <div class="grid gap-3">
            <label class="form-label">Name
              <input type="text" .value=${item.name}
                     @input=${e => { p.defaultItems[index].name = e.target.value; rerender(); }} />
            </label>
            <div>
              <p class="form-label mb-1">Importance</p>
              <div class="importance-toggle">
                ${['High', 'Medium', 'Low'].map(level => html`
                  <button class="importance-btn ${item.importance === level ? 'selected' : ''}"
                          data-value="${level}"
                          @click=${() => {
                            p.defaultItems[index].importance = level;
                            rerender();
                          }}>
                    ${level}
                  </button>`)}
              </div>
            </div>
            <div class="inline-fields">
              <label class="form-label">Size
                <select .value=${item.size || ''}
                        @change=${e => { p.defaultItems[index].size = e.target.value; }}>
                  <option value="">— pick size —</option>
                  ${SIZE_OPTIONS.map(s => html`
                    <option value=${s.value} ?selected=${item.size === s.value}>${s.label}</option>`)}
                </select>
              </label>
              <label class="form-label">Weight (${unit})
                <input type="number" min="0" step="0.1" .value=${item.weight || ''}
                       @input=${e => { p.defaultItems[index].weight = e.target.value; }} />
              </label>
            </div>
            <label class="form-label">Description
              <textarea rows="2" .value=${item.description || ''}
                        @input=${e => { p.defaultItems[index].description = e.target.value; }}></textarea>
            </label>
          </div>
          <div class="flex gap-2 mt-3">
            <button @click=${() => { state.expandedPlanItemIndex = null; rerender(); }}
                    class="btn-secondary text-sm">Done</button>
            <button @click=${() => { p.defaultItems.splice(index, 1); state.expandedPlanItemIndex = null; rerender(); }}
                    class="btn-danger text-sm ml-auto">Remove</button>
          </div>
        </div>` : ''}
    </div>`;
}

function planEditorTemplate() {
  const p = state.editingPlan;
  if (!p) return html``;
  return html`
    <section class="panel">
      <div class="panel-header">
        <button @click=${() => renderView('config')} class="btn-secondary">← Back</button>
        <h2 class="font-display text-xl font-bold text-forest-green dark:text-sage-green">
          ${p.name ? `Edit: ${p.name}` : 'New plan'}
        </h2>
      </div>
      <form class="form-grid" @submit=${e => e.preventDefault()}>
        <label>Plan name
          <input type="text" name="name" .value=${p.name}
                 @input=${e => { p.name = e.target.value; }} required />
        </label>
        <label>Description
          <textarea name="description" rows="3" .value=${p.description}
                    @input=${e => { p.description = e.target.value; }}></textarea>
        </label>
      </form>
      <div class="section-header mt-6 mb-1">
        <h3 class="font-semibold text-stone-900 dark:text-stone-100">Default items</h3>
        <button @click=${() => {
          const newItem = withFields({
            id: generateId('item'),
            name: 'New item',
            importance: 'Medium',
            description: '',
            size: '',
            weight: '',
            extraFields: {},
          });
          p.defaultItems.push(newItem);
          state.expandedPlanItemIndex = p.defaultItems.length - 1;
          rerender();
        }} class="btn-secondary">+ Add item</button>
      </div>
      <div class="list">
        ${p.defaultItems.map((item, i) => planItemRow(item, i))}
      </div>
      <div class="form-actions">
        <button @click=${saveEditingPlan} class="btn-primary">Save plan</button>
        <button @click=${async () => {
          if (!p.id) { renderView('config'); return; }
          if (confirm('Delete this plan?')) {
            state.plans = await deletePlan(p.id);
            state.editingPlan = null;
            renderView('config');
          }
        }} class="btn-danger">Delete plan</button>
      </div>
    </section>`;
}

async function saveEditingPlan() {
  const p = state.editingPlan;
  p.name = (p.name || '').trim() || 'Untitled plan';
  p.defaultItems = p.defaultItems.map(finalizeItem);
  if (!p.id) {
    p.id = generateId('plan');
    p.version = 1;
    p.updatedAt = new Date().toISOString().split('T')[0];
    state.plans.unshift(p);
  } else {
    const idx = state.plans.findIndex(x => x.id === p.id);
    if (idx !== -1) {
      p.version = (state.plans[idx].version || 1) + 1;
      p.updatedAt = new Date().toISOString().split('T')[0];
      state.plans[idx] = p;
    }
  }
  await savePlans(state.plans);
  state.editingPlan = null;
  renderView('config');
}

// ─── Theme helper (shared between header toggle and config toggle) ────────────

export function applyThemeToggle() {
  const nowDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('campfixer:theme', nowDark ? 'dark' : 'light');
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = nowDark ? '☀' : '🌙';
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.content = nowDark ? '#1A1C14' : '#F5F0E8';
  if (state.view === 'config') rerender();
}
