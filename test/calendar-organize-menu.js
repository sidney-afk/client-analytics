'use strict';
/*
 * Content Calendar — Organize menu + auto-organize-by-date ordering.
 *
 * Run:  node test/calendar-organize-menu.js   (exit 0 = all good)
 *
 * The Sheet tab used to be manual-only: cards sat in the drag-and-drop order
 * stored in `order_index`, and the toolbar carried two separate filter pills
 * ("All months", "All content"). The Organize menu collapses those two pills
 * into one control and adds a third setting beside them — an ordering mode that
 * auto-organizes the strip by scheduled date instead.
 *
 * The contract that matters, and what this suite pins:
 *
 *   1. ORDERING. Auto mode is oldest → soonest, with every UNDATED card parked
 *      after every dated one. Ties (same date, and the whole undated tail) fall
 *      back to order_index, so the SMM's manual order still shows through
 *      instead of shuffling on each render.
 *
 *   2. NON-DESTRUCTIVE. Auto mode is a render-time sort and nothing else. It
 *      must never write order_index and never reach the reorder webhook, so
 *      switching back returns the exact manual order — that is the whole
 *      promise of the toggle ("if it toggles back they should have it as it is
 *      right now"), and a client flipping it can't rearrange the shared sheet.
 *
 *   3. DRAG IS SUSPENDED WHILE IT'S ON. The strip's drop handler derives
 *      order_index from DOM order. Left live under a date sort, one drag would
 *      overwrite the manual order with the date order — permanently, with
 *      nothing to switch back to. Cards go non-draggable instead.
 *
 *   4. PERSISTENCE. The mode rides with the per-client filters in
 *      localStorage: per client, per device, never sent to the backend.
 *
 * Extracts the REAL helpers from ../index.html rather than restating them.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const SANDBOX = `
const _store = Object.create(null);
const localStorage = {
  getItem(k){ return k in _store ? _store[k] : null; },
  setItem(k,v){ _store[k] = String(v); },
  removeItem(k){ delete _store[k]; }
};
let calState = { client: null, monthFilter: null, statusFilter: 'all', sortMode: 'manual' };
function calClientSlug(c){ return String(c || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }
${grabConst('CAL_FILTERS_KEY')}
${grabFunc('_calNormMonthFilter')}
${grabFunc('_calNormStatusFilter')}
${grabFunc('_calNormSortMode')}
${grabFunc('_calSortMode')}
${grabFunc('_calIsAutoSortOn')}
${grabFunc('_calDateSortKey')}
${grabFunc('_calOrganizerSort')}
${grabFunc('_calFiltersRead')}
${grabFunc('_calLoadClientFilters')}
${grabFunc('_calSaveClientFilters')}
${grabFunc('_calStatusFilterLabel')}
${grabFunc('_calMonthLabel')}
${grabFunc('_calOrganizeTriggerLabel')}
${grabFunc('_calOrganizeIsActive')}
return {
  _store, _calOrganizerSort, _calDateSortKey, _calIsAutoSortOn,
  _calLoadClientFilters, _calSaveClientFilters,
  _calOrganizeTriggerLabel, _calOrganizeIsActive,
  get calState(){ return calState; }
};`;
const m = new Function(SANDBOX)();

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } };
const names = list => list.map(p => p.id).join(',');

/* A deliberately adversarial fixture: manual order (order_index) and date
   order disagree completely, two cards share a date, and two are undated with
   their own manual order. */
const FIXTURE = () => [
  { id: 'a', order_index: 1, scheduled_date: '2026-08-19' },
  { id: 'b', order_index: 2, scheduled_date: '' },
  { id: 'c', order_index: 3, scheduled_date: '2026-07-28' },
  { id: 'd', order_index: 4, scheduled_date: '2026-08-04' },
  { id: 'e', order_index: 5, scheduled_date: null },
  { id: 'f', order_index: 6, scheduled_date: '2026-08-04' },
];

console.log('\n============================================================');
console.log('A) ORDERING — manual is untouched, auto is oldest → soonest');
console.log('============================================================');
m.calState.sortMode = 'manual';
ok(names(m._calOrganizerSort(FIXTURE())) === 'a,b,c,d,e,f',
   'manual mode orders by order_index (unchanged behaviour)');

m.calState.sortMode = 'date';
const sorted = m._calOrganizerSort(FIXTURE());
ok(names(sorted) === 'c,d,f,a,b,e',
   'auto mode: oldest → soonest, undated last (got ' + names(sorted) + ')');
ok(names(sorted).indexOf('d,f') === 2,
   'cards sharing a date keep their manual order (d before f)');
ok(names(sorted).endsWith('b,e'),
   'the undated tail keeps its manual order too (b before e)');

// Guard the exact bug a naive date compare would introduce: '' sorts BEFORE
// every real date, which would float the reserve pile to the front of the strip.
ok(m._calDateSortKey({ scheduled_date: '' }) > m._calDateSortKey({ scheduled_date: '2099-12-31' }),
   'an undated card sorts after even the furthest-future dated card');
ok(m._calDateSortKey({ scheduled_date: 'not-a-date' }) === m._calDateSortKey({}),
   'a malformed date is treated as undated, not as a sortable string');
ok(m._calDateSortKey({ scheduled_date: '2026-08-04T09:00:00Z' }) === m._calDateSortKey({ scheduled_date: '2026-08-04' }),
   'a timestamped date sorts on its calendar day (time of day is ignored)');

// Idempotence: re-sorting an already-sorted list must not reshuffle it, or the
// strip would churn on every realtime re-render.
m.calState.sortMode = 'date';
const once = names(m._calOrganizerSort(FIXTURE()));
const twice = names(m._calOrganizerSort(m._calOrganizerSort(FIXTURE())));
ok(once === twice, 'the sort is stable across repeated renders');

console.log('\n============================================================');
console.log('B) NON-DESTRUCTIVE — the toggle never rewrites order_index');
console.log('============================================================');
const live = FIXTURE();
const before = live.map(p => p.id + ':' + p.order_index).join(',');
m.calState.sortMode = 'date';
m._calOrganizerSort(live);
m.calState.sortMode = 'manual';
const restored = m._calOrganizerSort(live);
ok(live.map(p => p.id + ':' + p.order_index).sort().join(',') === before.split(',').sort().join(','),
   'no card had its order_index changed by sorting');
ok(names(restored) === 'a,b,c,d,e,f',
   'toggling back restores the exact manual order');

// Source-level: the ordering mode must not be able to reach the write path.
const sortFn = grabFunc('_calOrganizerSort');
const toggleFn = grabFunc('onCalSortModeToggle');
ok(!/order_index\s*=/.test(sortFn), '_calOrganizerSort assigns no order_index');
ok(!/persistCalReorder|_calRecordReorderOptimistic|CALENDAR_REORDER/.test(sortFn + toggleFn),
   'neither the sort nor the toggle touches the reorder write path');
ok(!/_calSaveSettings|calendar-upsert/.test(toggleFn),
   'the toggle writes nothing to the backend (view-only, per device)');

console.log('\n============================================================');
console.log('C) DRAG IS SUSPENDED WHILE THE DATE SORT IS ON');
console.log('============================================================');
ok(/const autoSorted = _calIsAutoSortOn\(\);/.test(INDEX),
   'the card renderer reads the ordering mode');
ok(/const draggable = \(isBlank \|\| selectable \|\| autoSorted\) \? 'false' : 'true';/.test(INDEX),
   'cards are non-draggable while the strip is auto-organized');
// The drop handler harvests [draggable="true"] and writes those ids' order_index.
// With every card non-draggable it collects nothing and returns before writing —
// this is the mechanism that stops a date sort being persisted over the manual one.
ok(/const ids = Array\.from\(strip\.querySelectorAll\('\.cal-card\[draggable="true"\]'\)\)[\s\S]{0,200}?if \(!ids\.length\) return;/.test(INDEX),
   'the strip drop handler bails when no card is draggable (no reorder can be written)');
ok(/cal-card-grip\$\{autoSorted \? ' is-locked' : ''\}/.test(INDEX),
   'the grip shows a locked state instead of silently doing nothing');
ok(/\.cal-card-grip\.is-locked \{ cursor: not-allowed; \}/.test(INDEX),
   'the locked grip has the matching cursor rule');

console.log('\n============================================================');
console.log('D) PERSISTENCE — per client, per device, alongside the filters');
console.log('============================================================');
m.calState.client = 'Danielle Robin';
m.calState.monthFilter = '2026-08';
m.calState.statusFilter = 'scheduled';
m.calState.sortMode = 'date';
m._calSaveClientFilters();

m.calState.client = 'Chelsey Scaffidi';
m._calLoadClientFilters();
ok(m.calState.sortMode === 'manual', 'a different client defaults back to manual order');
ok(m.calState.monthFilter === 'all' && m.calState.statusFilter === 'all',
   'and to the default filters (unchanged behaviour)');

m.calState.client = 'Danielle Robin';
m._calLoadClientFilters();
ok(m.calState.sortMode === 'date', 'the saved client gets its ordering mode back');
ok(m.calState.monthFilter === '2026-08' && m.calState.statusFilter === 'scheduled',
   'and its month + content filters (unchanged behaviour)');

// A stored row written before this feature existed has no `sort` key at all.
// Written under the real slug so the row is genuinely found and read back —
// a typo'd key here would pass by falling through to the default instead.
m._store['syncview_cal_filters_v1'] =
  JSON.stringify({ daniellerobin: { month: '2026-08', status: 'scheduled' } });
m.calState.client = 'Danielle Robin';
m.calState.sortMode = 'date';
m._calLoadClientFilters();
ok(m.calState.monthFilter === '2026-08', 'the pre-feature row is actually found (not silently defaulted)');
ok(m.calState.sortMode === 'manual', 'a pre-feature saved row reads back as manual, not undefined');
m.calState.sortMode = 'garbage';
ok(!m._calIsAutoSortOn(), 'an unrecognised stored value falls back to manual');

console.log('\n============================================================');
console.log('E) THE PILL — one control, and it still names what is active');
console.log('============================================================');
// Collapsing three controls into one menu must not cost at-a-glance state:
// the trigger names whatever is non-default.
m.calState.sortMode = 'manual'; m.calState.monthFilter = 'all'; m.calState.statusFilter = 'all';
ok(m._calOrganizeTriggerLabel() === 'Organize', 'all-default reads simply "Organize"');
ok(m._calOrganizeIsActive() === false, 'and the pill is not highlighted');

m.calState.sortMode = 'date';
ok(m._calOrganizeTriggerLabel() === 'By date', 'the ordering mode alone shows as "By date"');
ok(m._calOrganizeIsActive() === true, 'and highlights the pill');

m.calState.monthFilter = '2026-08';
m.calState.statusFilter = 'scheduled';
ok(m._calOrganizeTriggerLabel() === 'By date · August 2026 · Scheduled',
   'order + month + content are summarised together (got "' + m._calOrganizeTriggerLabel() + '")');

m.calState.sortMode = 'manual';
ok(m._calOrganizeTriggerLabel() === 'August 2026 · Scheduled',
   'the ordering mode drops out of the summary when it is back to manual');

// Structure: one pill in the toolbar, holding all three sections.
ok(/\$\{_calOrganizeHtml\(\)\}/.test(INDEX) && !/_calMonthFilterHtml|_calStatusFilterHtml/.test(INDEX),
   'the toolbar mounts the single Organize pill (the two old pills are gone)');
const org = grabFunc('_calOrganizeHtml');
ok(/>Order<[\s\S]*?>Month<[\s\S]*?>Content</.test(org),
   'the menu carries Order, Month and Content sections, in that reading order');
ok((org.match(/role="group" aria-labelledby="calOrgSec/g) || []).length === 3,
   'each section is a labelled ARIA group, not three loose runs of buttons');
ok(/_calMonthWarnChipHtml\(\)/.test(org) && /getElementById\('calOrganizeWrap'\)/.test(grabFunc('_calSyncMonthWarnIcon')),
   'the hidden-cards warning chip moved onto the new pill with the month filter');
// Clearing filters is not the same as changing the order.
ok(!/sortMode/.test(grabFunc('onCalClearFilters')),
   '"Clear filters" leaves the ordering mode alone');

// Accessibility: the row is a real switch, and it explains itself through its
// own label rather than an info icon (docs/features/UI_DESIGN_STANDARDS.md).
const orderSec = grabFunc('_calOrganizeOrderSectionHtml');
// menuitemcheckbox, not switch: the row lives inside role="menu", where
// `switch` is not a valid child role.
ok(/role="menuitemcheckbox"/.test(orderSec) && /aria-checked="\$\{on \? 'true' : 'false'\}"/.test(orderSec),
   'the ordering row exposes toggle semantics valid inside a menu, with live aria-checked');
ok(/role="menuitemradio"/.test(grabFunc('_calOrganizeMonthSectionHtml'))
   && /role="menuitemradio"/.test(grabFunc('_calOrganizeContentSectionHtml')),
   'the month and content choices are single-select menu radios');
ok(/data-sv-explain/.test(orderSec) && /data-tip="/.test(orderSec),
   'its explanation rides the shared label-explainer layer');
ok(!/cal-kebab-info-i|aria-label="What does/.test(orderSec),
   'no info-icon badge sits beside the label');
const dismiss = grabFunc('_calWireOrganizeDismiss');
ok(/Escape/.test(dismiss), 'Escape closes the menu');
// Capture phase, not bubble: card thumbs, captions, link fields and status
// pills all stopPropagation on click, so a bubble-phase listener never sees a
// click that lands on one and the menu stays stuck open over the strip.
ok(/_calSetOrganizeOpen\(false\);\s*\}, true\);/.test(dismiss),
   'the outside-click listener runs in the capture phase (stopPropagation-proof)');
ok(/!t\.isConnected/.test(dismiss),
   'a target detached by a mid-dispatch re-render is not mistaken for an outside click');

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log(fail ? `  FAIL ❌  (${pass} passed, ${fail} failed)` : `  PASS ✅  (${pass} passed)`);
process.exit(fail ? 1 : 0);
