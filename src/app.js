// UI layer: view templates, state management, and event wiring.
// No SQL here — all persistence goes through storage.js.
//
// Domain model
// ─────────────
// Plan    — a reusable camping checklist with a default set of items.
//           Managed in Settings via the plan editor.
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
  backView: null,         // Most recent distinct view; used by Back buttons.
  plans: [],              // Plan[] — reusable checklists
  trips: [],              // Trip[] — specific outings
  activePlan: null,       // Plan being edited in the plan editor
  activeTrip: null,       // Trip the user tapped into
  editingPlan: null,      // working copy of activePlan (with _fields arrays)
  editingTrip: null,      // working copy of activeTrip (with _fields arrays)
  expandedTripItemIndex: null,  // index of the inline-expanded TripItem, or null
  expandedPlanItemIndex: null,  // index of the inline-expanded PlanItem, or null
  tripDetailsOpen: false,
};

const elements = {
  main: document.getElementById('app-main'),
};

// ─── Core helpers ─────────────────────────────────────────────────────────────

function rerender() { renderView(state.view, { track: false }); }

async function persistCurrentView() {
  if (state.view === 'trip-detail' && state.editingTrip) {
    await persistEditingTripDraft();
  }
}

async function navigateTo(view) {
  await persistCurrentView();
  renderView(view);
}

async function goToTrips() {
  await navigateTo('trips');
}

async function goBack(fallback = 'trips') {
  await persistCurrentView();
  const target = state.backView && state.backView !== state.view ? state.backView : fallback;
  state.backView = null;
  renderView(target, { track: false });
}

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
  if (!button.classList.replace('btn-danger', 'btn-danger-armed')) {
    button.classList.add('danger-armed');
  }
  setTimeout(() => {
    if (button.dataset.armed === 'true') {
      button.dataset.armed = 'false';
      button.textContent = orig;
      if (!button.classList.replace('btn-danger-armed', 'btn-danger')) {
        button.classList.remove('danger-armed');
      }
    }
  }, 3000);
}

async function downloadDB() {
  const bytes = await exportDB();
  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'campfixer-v2.db'; a.click();
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

function tripWeightSummary(trip) {
  const weights = trip.items
    .map(item => Number.parseFloat(item.weight))
    .filter(weight => Number.isFinite(weight) && weight > 0);
  const packedWeights = trip.items
    .filter(item => item.packed)
    .map(item => Number.parseFloat(item.weight))
    .filter(weight => Number.isFinite(weight) && weight > 0);
  const sum = values => values.reduce((total, weight) => total + weight, 0);
  return {
    total: sum(weights),
    packed: sum(packedWeights),
    hasWeight: weights.length > 0,
  };
}

function formatWeight(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function importanceBadge(importance) {
  const map = {
    High:   'badge-high',
    Medium: 'badge-medium',
    Low:    'badge-low',
  };
  const cls = map[importance] || map.Medium;
  return html`<span class="badge ${cls}"><span class="badge-dot"></span>${importance}</span>`;
}

function sectionLabel(label, count, cls = '') {
  return html`
    <span class="section-label ${cls}">
      <span>${label}</span>
      <span class="section-count">${count}</span>
    </span>`;
}

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function stumpySVG(cls = 'w-24 h-24') {
  return html`
    <svg class="${cls} text-stone-300 dark:text-forest-green/40" viewBox="0 0 100 100"
         role="img" aria-label="Camping checklist icon"
         fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 78h64"/>
      <path d="M28 78 50 26l22 52"/>
      <path d="M50 26v52"/>
      <path d="M38 78 50 52l12 26"/>
      <path d="M24 70c-4-6-4-13 0-19"/>
      <path d="M76 70c4-6 4-13 0-19"/>
      <path d="M35 18h30"/>
      <path d="M40 12h20"/>
      <path d="M32 86h36"/>
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
  state.tripDetailsOpen = false;
  renderView('trip-detail');
}

// ─── Init ─────────────────────────────────────────────────────────────────────

export async function initApp() {
  state.plans = await loadPlans();   // Plans: reusable checklists
  state.trips = await loadTrips();   // Trips: specific outings

  const logo = document.getElementById('logo-home');
  if (logo) {
    logo.addEventListener('click', async event => {
      event.preventDefault();
      await goToTrips();
    });
  }

  document.querySelectorAll('.bottom-nav-btn').forEach(btn =>
    btn.addEventListener('click', async () => {
      if (btn.dataset.view === 'trips') {
        await goToTrips();
      } else {
        await navigateTo(btn.dataset.view);
      }
    }));

  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.addEventListener('click', () => navigateTo('trip-creator'));

  renderView('trips', { track: false });
}

// ─── View dispatch ────────────────────────────────────────────────────────────

function renderView(view, { track = true } = {}) {
  if (track && view !== state.view) state.backView = state.view;
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
  if (fab) fab.classList.add('hidden');

  if (state.trips.length === 0) {
    return html`
      <section class="app-page">
        <div class="page-header">
          <div>
            <h2 class="page-title">Trips</h2>
            <p class="page-subtitle">Packing lists for each outing.</p>
          </div>
          <button @click=${() => navigateTo('trip-creator')} class="btn-primary">New Trip</button>
        </div>
        <div class="empty-state-new">
          ${stumpySVG()}
          <p>Nothing packed yet! Start a new trip and I'll keep track.</p>
        </div>
      </section>`;
  }

  return html`
    <section class="app-page">
      <div class="page-header">
        <div>
          <h2 class="page-title">Trips</h2>
          <p class="page-subtitle">${state.trips.length} active ${state.trips.length === 1 ? 'trip' : 'trips'}</p>
        </div>
        <button @click=${() => navigateTo('trip-creator')} class="btn-primary">New Trip</button>
      </div>
      <div class="grid gap-3">
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
        <div class="trip-card-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19h16L12 5 4 19z"/>
            <path d="M12 5v14"/>
            <path d="M8.5 19 12 12.5 15.5 19"/>
          </svg>
        </div>
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

// Condensed TripItem row: checkbox packs; label/edit button opens inline editing.
function tripItemRow(item, index) {
  const isExpanded = state.expandedTripItemIndex === index;

  return html`
    <div class="item-row-wrap">
      <div class="check-row">
        <button class="check-box ${item.packed ? 'checked' : ''}"
                type="button"
                aria-label="${item.packed ? 'Mark unpacked' : 'Mark packed'}: ${item.name}"
                @click=${() => togglePackedTripItem(index)}>
          ${item.packed ? html`
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 13l4 4L19 7"/>
            </svg>` : ''}
        </button>
        <button class="check-row-label ${item.packed ? 'packed' : ''} flex-1 min-w-0 truncate"
                type="button"
                @click=${() => toggleExpandedTripItem(index)}>
          ${item.name}
        </button>
        <button class="flex-shrink-0 w-9 h-9 flex items-center justify-center
                       text-stone-400 hover:text-stone-600 dark:hover:text-stone-300
                       rounded-lg transition-colors"
                type="button"
                aria-label="Edit ${item.name}"
                @click=${() => toggleExpandedTripItem(index)}>
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
    <div class="item-expand item-edit-card">
      <div class="item-edit-header">
        <span>Edit item</span>
        <button type="button"
                class="item-edit-close"
                aria-label="Close item editor"
                @click=${() => closeExpandedTripItem()}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6 6 18"/>
            <path d="m6 6 12 12"/>
          </svg>
        </button>
      </div>
      <div class="item-edit-grid">
        <label class="compact-field span-2">Name
          <input type="text" .value=${item.name}
                 @input=${e => { state.editingTrip.items[index].name = e.target.value; }}
                 @blur=${persistEditingTripDraft} />
        </label>

        <div class="span-2">
          <p class="compact-label">Importance</p>
          <div class="importance-toggle compact">
            ${['High', 'Medium', 'Low'].map(level => html`
              <button class="importance-btn ${item.importance === level ? 'selected' : ''}"
                      data-value="${level}"
                      @click=${async () => {
                        state.editingTrip.items[index].importance = level;
                        rerender();
                        await persistEditingTripDraft();
                      }}>
                ${level}
              </button>`)}
          </div>
        </div>

        <label class="compact-field">Size
          <select .value=${item.size || ''}
                  @change=${async e => {
                    state.editingTrip.items[index].size = e.target.value;
                    await persistEditingTripDraft();
                  }}>
              <option value="">Pick size</option>
              ${SIZE_OPTIONS.map(s => html`
                <option value=${s.value} ?selected=${item.size === s.value}>${s.label}</option>`)}
          </select>
        </label>
        <label class="compact-field">Weight (${unit})
          <input type="number" min="0" step="0.1" .value=${item.weight || ''}
                 @input=${e => { state.editingTrip.items[index].weight = e.target.value; }}
                 @blur=${persistEditingTripDraft} />
        </label>

        <label class="compact-field span-2">Notes
          <textarea rows="2" .value=${item.description || ''}
                    @input=${e => { state.editingTrip.items[index].description = e.target.value; }}
                    @blur=${persistEditingTripDraft}></textarea>
        </label>
      </div>

      <div class="item-edit-actions">
        <button @click=${() => removeTripItem(index)} class="btn-danger text-sm ml-auto">Remove</button>
      </div>
    </div>`;
}

async function closeExpandedTripItem() {
  state.expandedTripItemIndex = null;
  rerender();
  await persistEditingTripDraft();
}

function toggleExpandedTripItem(index) {
  state.expandedTripItemIndex = state.expandedTripItemIndex === index ? null : index;
  rerender();
}

async function persistEditingTripDraft() {
  if (!state.editingTrip) return;
  const draft = {
    ...state.editingTrip,
    items: state.editingTrip.items.map(finalizeItem),
  };
  state.trips = await updateTrip(draft);
  state.activeTrip = state.trips.find(t => t.id === draft.id) || draft;
}

async function togglePackedTripItem(index) {
  if (!state.editingTrip) return;
  state.editingTrip.items[index].packed = !state.editingTrip.items[index].packed;
  rerender();
  await persistEditingTripDraft();
}

async function unpackAllTripItems() {
  if (!state.editingTrip) return;
  state.editingTrip.items = state.editingTrip.items.map(item => ({ ...item, packed: false }));
  state.expandedTripItemIndex = null;
  rerender();
  await persistEditingTripDraft();
}

async function removeTripItem(index) {
  if (!state.editingTrip) return;
  state.editingTrip.items.splice(index, 1);
  if (state.expandedTripItemIndex === index) state.expandedTripItemIndex = null;
  rerender();
  await persistEditingTripDraft();
}

async function addNewTripItem() {
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
  await persistEditingTripDraft();
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

async function deleteTripNow() {
  if (!state.editingTrip) return;
  state.trips = await deleteTrip(state.editingTrip.id);
  state.editingTrip = null;
  renderView('trips');
}

function tripDetailsEditorTemplate(trip) {
  return html`
    <details class="trip-details-editor" ?open=${state.tripDetailsOpen}
             @toggle=${event => { state.tripDetailsOpen = event.currentTarget.open; }}>
      <summary>
        <span>
          <strong>Trip details</strong>
          <small>${trip.startDate || trip.locationUrl || trip.description ? 'Dates, location, notes' : 'Add dates, location, and notes'}</small>
        </span>
        <span class="text-stone-400 text-sm font-normal">▾</span>
      </summary>
      <div class="trip-details-grid">
        <label class="compact-field span-2">Trip name
          <input type="text" .value=${trip.name || ''}
                 @input=${event => { trip.name = event.target.value; }}
                 @change=${persistEditingTripDraft} />
        </label>
        <label class="compact-field">Start date
          <input type="date" .value=${trip.startDate || ''}
                 @input=${event => { trip.startDate = event.target.value; }}
                 @change=${persistEditingTripDraft} />
        </label>
        <label class="compact-field">End date
          <input type="date" .value=${trip.endDate || ''}
                 @input=${event => { trip.endDate = event.target.value; }}
                 @change=${persistEditingTripDraft} />
        </label>
        <label class="compact-field span-2">Location link
          <input type="url" inputmode="url" placeholder="https://maps.example/..."
                 .value=${trip.locationUrl || ''}
                 @input=${event => { trip.locationUrl = event.target.value; }}
                 @change=${persistEditingTripDraft} />
        </label>
        <label class="compact-field span-2">Description
          <textarea rows="2" .value=${trip.description || ''}
                    @input=${event => { trip.description = event.target.value; }}
                    @change=${persistEditingTripDraft}></textarea>
        </label>
      </div>
    </details>`;
}

function tripDetailTemplate() {
  if (!state.editingTrip) { renderView('trips'); return html``; }
  const trip = state.editingTrip;
  const srcPlan = state.plans.find(p => p.id === trip.planId);
  const badge = syncBadgeCount(trip);
  const { packed, total, pct } = packedProgress(trip);
  const weight = tripWeightSummary(trip);
  const unit = getWeightUnit();

  const highItems   = trip.items.filter(i => !i.packed && i.importance === 'High');
  const medItems    = trip.items.filter(i => !i.packed && i.importance === 'Medium');
  const lowItems    = trip.items.filter(i => !i.packed && i.importance === 'Low');
  const packedItems = trip.items.filter(i => i.packed);

  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.add('hidden');

  return html`
    <section class="app-page trip-detail-page">

      <!-- Back + title -->
      <div class="detail-toolbar">
        <button @click=${() => goBack('trips')} class="btn-secondary">← Back</button>
        <div class="min-w-0 flex-1">
          <h2 class="page-title truncate">${trip.name}</h2>
          <p class="page-subtitle truncate">${srcPlan ? srcPlan.name : 'Custom trip'}</p>
        </div>
        ${badge > 0 ? html`
          <button @click=${syncTripNow} class="btn-sync">
            Sync
            <span class="ml-1 bg-white/30 rounded-full px-1.5 py-0.5 text-xs">${badge}</span>
          </button>` : ''}
        <details class="action-menu">
          <summary aria-label="More trip actions">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="19" cy="12" r="1"/>
              <circle cx="5" cy="12" r="1"/>
            </svg>
          </summary>
          <div class="action-menu-panel">
            ${srcPlan ? html`
              <button @click=${pushTripNow} class="menu-action">Push to plan</button>` : ''}
            <button @click=${e => armDeleteButton(e.currentTarget, deleteTripNow)} class="menu-action danger">
              Delete trip
            </button>
          </div>
        </details>
      </div>

      ${tripDetailsEditorTemplate(trip)}

      <!-- Progress summary -->
      <div class="progress-summary">
        <div class="progress-summary-header">
          <span>${packed} of ${total} packed</span>
          <div class="progress-actions">
            ${packed > 0 ? html`
              <button @click=${unpackAllTripItems} class="inline-action">Unpack everything</button>` : ''}
            <span>${pct}%</span>
          </div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        ${weight.hasWeight ? html`
          <div class="weight-summary">
            <span>Total weight</span>
            <strong>${formatWeight(weight.packed)} / ${formatWeight(weight.total)} ${unit}</strong>
          </div>` : ''}
      </div>

      <!-- Action row -->
      <div class="primary-action-row">
        <button @click=${addNewTripItem} class="btn-primary">Add item</button>
      </div>

      <!-- High importance — always rendered, hidden when empty -->
      <details class="section-group ${highItems.length === 0 ? 'hidden' : ''}" open>
        <summary>
          ${sectionLabel('High', highItems.length, 'priority-high')}
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${highItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Medium importance -->
      <details class="section-group ${medItems.length === 0 ? 'hidden' : ''}" open>
        <summary>
          ${sectionLabel('Medium', medItems.length, 'priority-medium')}
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${medItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Low importance -->
      <details class="section-group ${lowItems.length === 0 ? 'hidden' : ''}">
        <summary>
          ${sectionLabel('Low', lowItems.length, 'priority-low')}
          <span class="text-stone-400 text-sm font-normal">▾</span>
        </summary>
        <div>
          ${lowItems.map(item => tripItemRow(item, trip.items.indexOf(item)))}
        </div>
      </details>

      <!-- Packed items -->
      <details class="section-group ${packedItems.length === 0 ? 'hidden' : ''}">
        <summary>
          ${sectionLabel('Packed', packedItems.length, 'priority-packed')}
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
      <section class="app-page">
        <div class="page-header">
          <button @click=${() => goBack('trips')} class="btn-secondary">← Back</button>
          <h2 class="page-title">New Trip</h2>
        </div>
        <div class="empty-state-new">
          ${gearSVG('w-16 h-16')}
          <p>
            No plans yet.
            <button @click=${() => navigateTo('config')} class="inline-link">Add a plan in Settings</button>
            to get started.
          </p>
        </div>
      </section>`;
  }

  return html`
    <section class="app-page">
      <div class="page-header">
        <button @click=${() => goBack('trips')} class="btn-secondary">← Back</button>
        <h2 class="page-title">New Trip</h2>
      </div>
      <form class="surface form-grid" id="create-trip-form" @submit=${e => e.preventDefault()}>
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
          state.backView = 'trips';
        }} class="btn-primary w-full sm:w-auto">Create trip</button>
      </div>
    </section>`;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function configTemplate() {
  const fab = document.getElementById('fab-new-trip');
  if (fab) fab.classList.add('hidden');

  const isDark = document.documentElement.classList.contains('dark');
  const unit = getWeightUnit();

  return html`
    <section class="app-page">

      <div class="page-header">
        <div>
          <h2 class="page-title">Settings</h2>
          <p class="page-subtitle">Plans, preferences, and backup.</p>
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
      <button @click=${() => enterPlanEditor(null)} class="btn-primary mt-4">New plan</button>

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
                    class="btn-secondary text-sm">Close</button>
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
        <button @click=${() => goBack('config')} class="btn-secondary">← Back</button>
        <h2 class="page-title">
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
