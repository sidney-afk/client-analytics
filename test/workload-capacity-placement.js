'use strict';

/*
 * Capacity-aware automatic Workload placement (owner ruling 2026-08-10).
 *
 * Raha reported editors sitting over capacity on the Workload calendar: a
 * pinned 2×-Workload pair filled Nahuel's Monday and the automatic Doug cards
 * landed on the same day anyway (6/4 · 2 over), and Iaramiraille's 8/4 was
 * seven automatic cards stacking on one day with no pin involved at all.
 *
 * The rules this suite pins, extracted straight out of index.html and run
 * hermetically (no DOM, no network, no clock):
 *
 *   1. A manual plan_date is ABSOLUTE — never moved, and its units are
 *      reserved before any automatic item is placed.
 *   2. Automatic items are placed as LATE as they fit, walking BACKWARD in
 *      working days from their ideal day (one working day before the deadline).
 *   3. The walk never goes FORWARD past the ideal day, and never before today.
 *   4. A genuinely saturated window keeps the item on its ideal day and leaves
 *      the visible over-capacity badge — the honest "a person must fix this".
 *   5. Placement is deterministic and depends only on the unfiltered snapshot.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (error) { failures.push(name); console.log('FAIL - ' + name + '\n     ' + error.message); }
}

// ── Extract the real functions out of the single-file app ────────────────
function extract(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed function ' + name);
}

const walkLimit = Number((source.match(/const WL_PLACEMENT_WALK_LIMIT\s*=\s*(\d+)/) || [])[1]);
assert(Number.isFinite(walkLimit) && walkLimit > 0, 'WL_PLACEMENT_WALK_LIMIT is a positive literal');

const wlState = {
  planByIssueId: new Map(),
  autoPlacementByIssueId: new Map(),
  workloadByIssueId: new Map(),
  planHasSnapshot: true,
  planLoading: false,
};
// The clock is the one thing we stub: every helper that needs "today" goes
// through wlWorkloadTodayISO(), so pinning it makes the whole suite hermetic
// and keeps the fixtures readable as real dates.
let TODAY = '2026-08-10';
const context = {
  wlState,
  wlWorkloadTodayISO: () => TODAY,
  WL_PLACEMENT_WALK_LIMIT: walkLimit,
  Map, Set, Array, Number, String, Boolean, Object, Date, Math, JSON,
  Intl, isNaN, parseInt, parseFloat, console,
};
context.globalThis = context;
vm.createContext(context);
for (const name of [
  'wlISO', 'wlParseISO', 'wlSubWorkingDays', 'wlAddWorkingDays',
  'wlTeamBucket', 'wlEditorCapacity', 'wlDayOverCapacity',
  'wlWorkloadMeta', 'wlWorkloadWeight', 'wlWorkloadUnits',
  'wlPlanDate', 'wlAutoPlanDate', 'wlAutoPlacementDate', 'wlDisplayDate',
  'wlPlacementMode', 'wlCapacityKey', 'wlComputeAutoPlacements',
  'wlBucketByDisplayDate',
]) vm.runInContext(extract(name), context);

// ── Fixture helpers ─────────────────────────────────────────────────────
// 2026-08-10 is the Monday from Raha's screenshot; 08-07 is the Friday before.
const MON = '2026-08-10';
const FRI = '2026-08-07';
const THU = '2026-08-06';
const WED = '2026-08-05';

let nextId = 0;
function sub(options) {
  const id = options.id || ('issue-' + (++nextId));
  const row = {
    id,
    identifier: options.identifier || ('VID-' + String(1000 + nextId)),
    assigneeId: options.assignee || 'editor-a',
    teamKey: options.teamKey || 'VID',
    teamName: options.teamName || 'Video',
    clientName: options.client || 'Client',
    dueDate: options.due || null,
  };
  if (options.plan) wlState.planByIssueId.set(id, options.plan);
  if (options.weight) {
    wlState.workloadByIssueId.set(id, {
      label: options.weight + '× Workload', weight: options.weight, color: '#EA580C',
    });
  }
  return row;
}
function reset() {
  wlState.planByIssueId = new Map();
  wlState.autoPlacementByIssueId = new Map();
  wlState.workloadByIssueId = new Map();
  wlState.planHasSnapshot = true;
  wlState.planLoading = false;
  nextId = 0;
}
function place(subs, today) {
  TODAY = today;
  wlState.autoPlacementByIssueId = context.wlComputeAutoPlacements(subs, today);
  return subs.map(row => context.wlDisplayDate(row));
}
// Units committed per (editor, team, day) once placement has run.
function dayLoad(subs) {
  const totals = new Map();
  for (const row of subs) {
    const key = context.wlCapacityKey(row) + '@' + context.wlDisplayDate(row);
    totals.set(key, (totals.get(key) || 0) + context.wlWorkloadWeight(row));
  }
  return totals;
}
function maxOverBy(subs) {
  let worst = 0;
  for (const [key, units] of dayLoad(subs)) {
    const row = subs.find(r => context.wlCapacityKey(r) + '@' + context.wlDisplayDate(r) === key);
    worst = Math.max(worst, units - context.wlEditorCapacity(row.teamKey, row.teamName));
  }
  return worst;
}

// ── 1. The reported bug: pins hold, automatics yield ─────────────────────
check('a pinned 2x pair keeps the day and the automatic cards move off it', () => {
  reset();
  // Nahuel: two pinned Henry videos at 2x Workload = the full 4-unit day.
  const henryA = sub({ plan: MON, weight: 2, due: '2026-08-11', client: 'Henry Ammar' });
  const henryB = sub({ plan: MON, weight: 2, due: '2026-08-11', client: 'Henry Ammar' });
  // Two automatic Doug videos whose ideal day is that same Monday.
  const dougA = sub({ due: '2026-08-11', client: 'Doug Cartwright' });
  const dougB = sub({ due: '2026-08-11', client: 'Doug Cartwright' });
  const subs = [henryA, henryB, dougA, dougB];

  const dates = place(subs, WED);
  assert.strictEqual(dates[0], MON, 'pinned Henry A holds its exact day');
  assert.strictEqual(dates[1], MON, 'pinned Henry B holds its exact day');
  assert.strictEqual(dates[2], FRI, 'automatic Doug A moved back one working day');
  assert.strictEqual(dates[3], FRI, 'automatic Doug B moved back one working day');
  assert.strictEqual(maxOverBy(subs), 0, 'no editor/day is over capacity any more');
  assert.strictEqual(context.wlDayOverCapacity([henryA, henryB]), false,
    'the pinned pair alone is exactly at capacity, not over');
});

check('pins are never moved even when the pins alone blow the capacity', () => {
  reset();
  // Six pinned units on one 4-unit day: deliberate human placement wins, and
  // the day stays visibly over — the badge is the point.
  const pinned = [1, 2, 3, 4, 5, 6].map(() => sub({ plan: MON, due: '2026-08-14' }));
  const auto = sub({ due: '2026-08-11' });          // ideal is MON
  const subs = pinned.concat([auto]);

  const dates = place(subs, WED);
  assert.deepStrictEqual(dates.slice(0, 6), Array(6).fill(MON), 'every pin held');
  assert.strictEqual(dates[6], FRI, 'the automatic item stepped around the over-full pinned day');
  assert.strictEqual(context.wlDayOverCapacity(pinned), true,
    'the pinned overload stays visible');
});

// ── 2. Automatic-vs-automatic spreading (the 8/4 in the screenshot) ──────
check('seven automatic cards spread backwards instead of stacking', () => {
  reset();
  const subs = Array.from({ length: 7 }, () => sub({ due: '2026-08-11' })); // ideal MON
  const dates = place(subs, '2026-08-03');
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [MON]: 4, [FRI]: 3 },
    'four fill the ideal day, the rest fall back to the previous working day');
  assert.strictEqual(maxOverBy(subs), 0, 'nothing is left over capacity');
});

check('a long queue keeps filling earlier working days and skips the weekend', () => {
  reset();
  const subs = Array.from({ length: 10 }, () => sub({ due: '2026-08-11' }));
  const dates = place(subs, '2026-08-01');
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [MON]: 4, [FRI]: 4, [THU]: 2 },
    'the walk steps Mon → Fri → Thu, never onto Sat/Sun');
});

// ── 3. Never forward, never before today ────────────────────────────────
check('a saturated window keeps the item on its ideal day rather than going late', () => {
  reset();
  // Today IS the ideal day, so there is nowhere earlier to go.
  const subs = Array.from({ length: 6 }, () => sub({ due: '2026-08-11' }));
  const dates = place(subs, MON);
  assert.deepStrictEqual(dates, Array(6).fill(MON),
    'every card stays on its ideal day; none is pushed past the deadline');
  assert.strictEqual(maxOverBy(subs), 2, 'the honest 6/4 overload remains visible');
  assert.strictEqual(wlState.autoPlacementByIssueId.size, 0,
    'nothing is recorded as moved, so the cards stay plain "auto"');
});

check('the backward walk stops at today and never lands in the past', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: THU, due: '2026-08-14' }));
  const auto = sub({ due: FRI });                 // ideal = Thu 06 Aug
  const subs = pinned.concat([auto]);
  const dates = place(subs, THU);                 // today IS Thursday
  assert.strictEqual(context.wlAutoPlanDate(auto, THU), THU, 'its ideal day is today');
  assert.strictEqual(dates[4], THU, 'it stays on today instead of moving into the past');
});

check('an overdue deadline floors the ideal day at today, not before it', () => {
  reset();
  const auto = sub({ due: '2026-07-01' });
  place([auto], MON);
  assert.strictEqual(context.wlDisplayDate(auto), MON, 'a past deadline plans for today');
});

// ── 4. Weights are respected when looking for a hole ────────────────────
check('a 2x item will not squeeze into a day with only one free unit', () => {
  reset();
  const pinned = [sub({ plan: MON, due: '2026-08-14' }), sub({ plan: MON, due: '2026-08-14' }),
    sub({ plan: MON, due: '2026-08-14' })];       // 3 of 4 units used on Monday
  const heavy = sub({ due: '2026-08-11', weight: 2 });   // needs 2 units, ideal MON
  const subs = pinned.concat([heavy]);
  const dates = place(subs, WED);
  assert.strictEqual(context.wlWorkloadWeight(heavy), 2, 'the 2x label is read as two units');
  assert.strictEqual(dates[3], FRI, 'a 2-unit item skips a day with a single free unit');
});

check('the heavier item claims the ideal day before lighter ones fill it in pieces', () => {
  reset();
  const light = [sub({ due: '2026-08-11' }), sub({ due: '2026-08-11' }),
    sub({ due: '2026-08-11' })];
  const heavy = sub({ due: '2026-08-11', weight: 2 });
  const subs = light.concat([heavy]);             // 5 units competing for a 4-unit day
  const dates = place(subs, WED);
  assert.strictEqual(dates[3], MON, 'the 2x item takes the ideal day first');
  assert.strictEqual(dates.filter(day => day === MON).length, 3,
    'the 2x item plus two 1x items exactly fill the 4-unit day');
  assert.strictEqual(dates.filter(day => day === FRI).length, 1, 'the fifth unit moves back a day');
  assert.strictEqual(maxOverBy(subs), 0, 'first-fit-decreasing leaves nothing over capacity');
});

// ── 5. Scope: per editor, per team, and independent of the filters ──────
check('one editor filling a day never moves another editor off it', () => {
  reset();
  const busy = Array.from({ length: 4 }, () => sub({ assignee: 'editor-a', due: '2026-08-11' }));
  const other = sub({ assignee: 'editor-b', due: '2026-08-11' });
  const subs = busy.concat([other]);
  const dates = place(subs, WED);
  assert.strictEqual(dates[4], MON, 'the second editor keeps the ideal day');
});

check('graphics uses its own 15-item capacity and ignores video workload labels', () => {
  reset();
  const rows = Array.from({ length: 16 }, () => sub({
    assignee: 'designer', teamKey: 'GRA', teamName: 'Graphics', due: '2026-08-11', weight: 3,
  }));
  assert.strictEqual(context.wlEditorCapacity('GRA', 'Graphics'), 15, 'graphics capacity is 15');
  assert.strictEqual(context.wlWorkloadWeight(rows[0]), 1,
    'a workload label on a graphics item still counts as one');
  const dates = place(rows, '2026-08-03');
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [MON]: 15, [FRI]: 1 }, 'the 16th item spills to Friday');
});

check('placement is deterministic regardless of snapshot order', () => {
  reset();
  const rows = Array.from({ length: 9 }, (_, index) => sub({
    id: 'fixed-' + index, identifier: 'VID-' + (2000 + index),
    due: index % 2 ? '2026-08-11' : '2026-08-12',
    weight: index === 3 ? 2 : 0,
  }));
  const forward = place(rows.slice(), WED).slice();
  const byId = new Map(rows.map((row, index) => [row.id, forward[index]]));
  place(rows.slice().reverse(), WED);
  for (const row of rows) {
    assert.strictEqual(context.wlDisplayDate(row), byId.get(row.id),
      'row ' + row.id + ' lands on the same day when the snapshot order flips');
  }
});

// ── 6. What the board and the labels report ─────────────────────────────
check('only genuinely moved items report the "shifted" placement mode', () => {
  reset();
  const pinned = sub({ plan: MON, due: '2026-08-14' });
  const stayed = sub({ due: '2026-08-11' });
  const bumped = Array.from({ length: 4 }, () => sub({ due: '2026-08-11' }));
  const subs = [pinned, stayed].concat(bumped);
  place(subs, WED);

  assert.strictEqual(context.wlPlacementMode(pinned), 'manual', 'a pin stays "manual"');
  const modes = subs.slice(1).map(row => context.wlPlacementMode(row));
  assert.strictEqual(modes.filter(mode => mode === 'auto').length, 3,
    'the three that kept their ideal day stay plain "auto"');
  assert.strictEqual(modes.filter(mode => mode === 'shifted').length, 2,
    'exactly the two that moved report "shifted"');
  for (const row of subs.slice(1)) {
    const mode = context.wlPlacementMode(row);
    const moved = context.wlDisplayDate(row) !== context.wlAutoPlanDate(row, WED);
    assert.strictEqual(mode === 'shifted', moved, 'the mode matches whether the day actually changed');
  }
});

check('the calendar buckets the moved item on its new day, not its ideal day', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: MON, due: '2026-08-14' }));
  const bumped = sub({ due: '2026-08-11' });
  const subs = pinned.concat([bumped]);
  place(subs, WED);
  const buckets = context.wlBucketByDisplayDate(subs);
  // Arrays built inside the VM realm are not deepStrictEqual to host arrays,
  // so compare the ids as a plain string.
  const idsOn = day => (buckets.get(day) || []).map(row => row.id).join(',');
  assert.strictEqual((buckets.get(MON) || []).length, 4, 'Monday holds only the four pins');
  assert.strictEqual(idsOn(MON), pinned.map(row => row.id).join(','), 'Monday holds exactly the pins');
  assert.strictEqual(idsOn(FRI), bumped.id, 'Friday holds the moved card');
});

check('a moved card keeps deadline buffer: it is never planned on or after its due date', () => {
  reset();
  const rows = Array.from({ length: 12 }, () => sub({ due: '2026-08-11' }));
  place(rows, '2026-08-01');
  for (const row of rows) {
    assert.ok(context.wlDisplayDate(row) <= context.wlAutoPlanDate(row, '2026-08-01'),
      'no card was pushed later than its ideal (deadline − 1 working day) placement');
  }
});

// ── 7. Source contract: derivation only, gated on the plan snapshot ─────
const applyData = extract('wlApplyData');
check('the placement pass runs on the unfiltered planned set inside wlApplyData', () => {
  assert.ok(/wlComputeAutoPlacements\(planned, todayISO\)/.test(applyData),
    'it is fed the whole planned list, so team/editor/client filters cannot move a card');
  assert.ok(applyData.indexOf('wlComputeAutoPlacements')
    < applyData.indexOf('wlState.calendarByDate = wlBucketByDisplayDate(planned)'),
    'placement is computed before the calendar buckets the days');
  assert.ok(/wlState\.autoPlacementByIssueId = new Map\(\);[\s\S]{0,400}wlState\.issueSnapshot =/.test(applyData),
    'the previous snapshot\'s moves are dropped before anything reads a display date');
});

check('placement is withheld until the authoritative plan snapshot proves what is pinned', () => {
  assert.ok(/wlState\.planHasSnapshot\s*\?\s*wlComputeAutoPlacements\(planned, todayISO\)\s*:\s*new Map\(\)/
    .test(applyData), 'no snapshot (fast first paint or a plan-read failure) means no capacity moves');

  reset();
  wlState.planHasSnapshot = false;
  wlState.planLoading = true;
  const rows = Array.from({ length: 6 }, () => sub({ due: '2026-08-11' }));
  wlState.autoPlacementByIssueId = new Map();
  assert.deepStrictEqual(rows.map(row => context.wlDisplayDate(row)), Array(6).fill(MON),
    'during the fast paint every card sits at its unmoved automatic estimate');
});

check('a capacity move is derived only — it never becomes a saved plan_date', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: MON, due: '2026-08-14' }));
  const bumped = sub({ due: '2026-08-11' });
  place(pinned.concat([bumped]), WED);
  assert.strictEqual(context.wlDisplayDate(bumped), FRI, 'the card renders on the earlier day');
  assert.strictEqual(context.wlPlanDate(bumped), '', 'but no plan_date was invented for it');
  assert.strictEqual(wlState.planByIssueId.size, 4, 'the sidecar still holds only the four real pins');
});

check('the sensitive-state purge drops the derived moves with the pins', () => {
  const purge = extract('wlPurgePlanSensitiveState');
  assert.ok(/wlState\.autoPlacementByIssueId = new Map\(\)/.test(purge),
    'wlPurgePlanSensitiveState clears autoPlacementByIssueId');
  assert.ok(purge.indexOf('wlState.planByIssueId.clear()') < purge.indexOf('wlState.autoPlacementByIssueId'),
    'it is cleared alongside the plan map it is derived from');
});

check('the backward walk is bounded so a bad date can never hang the render', () => {
  const compute = extract('wlComputeAutoPlacements');
  assert.ok(/guard < WL_PLACEMENT_WALK_LIMIT && day >= today/.test(compute),
    'the loop is bounded by both the walk limit and the today floor');
  assert.ok(walkLimit >= 250, 'the limit still covers about a working year');
});

// ── 8. The render layer actually says so ────────────────────────────────
// Stubs for the parts of the card that this suite does not own, so the real
// wlRenderPlanIssueCards → wlPlanOriginHtml → wlShiftedPlacementTip wiring is
// exercised end to end.
Object.assign(context, {
  wlEscape: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  wlPlanEditingEnabled: () => true,
  _wlPlanWriteInFlight: new Map(),
  wlWorkloadBadgeHtml: () => '',
  wlIssueDragHandleHtml: () => '',
  wlDeadlineTagHtml: () => '',
});
for (const name of ['wlFormatShort', 'wlPlacementLabel', 'wlPlanOriginHtml',
  'wlShiftedPlacementTip', 'wlRenderPlanIssueCards']) vm.runInContext(extract(name), context);

check('a moved card renders the shifted icon and names the day it came from', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: MON, due: '2026-08-14' }));
  const bumped = sub({ due: '2026-08-11', identifier: 'VID-9001' });
  place(pinned.concat([bumped]), WED);

  const html = context.wlRenderPlanIssueCards([bumped], FRI);
  assert.ok(html.includes('wl-plan-origin is-shifted'), 'the card carries the shifted origin icon');
  assert.ok(/aria-label="Moved earlier for capacity"/.test(html), 'and an accessible label saying so');
  assert.ok(html.includes('7 Aug'), 'the tooltip names where it landed');
  assert.ok(html.includes('10 Aug'), 'the tooltip names the full day it came from');
  assert.ok(/4-unit daily capacity/.test(html), 'and why it could not stay there');

  const stayed = context.wlRenderPlanIssueCards([pinned[0]], MON);
  assert.ok(stayed.includes('wl-plan-origin is-manual'), 'a pin still renders as manual');
  assert.ok(!stayed.includes('is-shifted'), 'and never picks up the shifted icon');
});

check('an unmoved automatic card keeps the plain automatic tooltip', () => {
  reset();
  const auto = sub({ due: '2026-08-11' });
  place([auto], WED);
  const html = context.wlRenderPlanIssueCards([auto], MON);
  assert.ok(html.includes('wl-plan-origin is-auto'), 'it stays a plain automatic card');
  assert.ok(/follows the authoritative due date/.test(html), 'with the unchanged automatic tooltip');
  assert.ok(!/Moved earlier automatically/.test(html), 'and no capacity explanation');
});

check('the settle animation covers the cards the capacity pass moved', () => {
  const loader = source.slice(
    source.indexOf('if (fastPainted && wlState.planHasSnapshot) {'),
    source.indexOf('_wlSettleAnimIds = moved.size ? moved : null;'),
  );
  assert.ok(/for \(const issueId of wlState\.autoPlacementByIssueId\.keys\(\)\) moved\.add/.test(loader),
    'moved automatic cards settle with the manually planned ones instead of jumping');
});

console.log(failures.length
  ? `\n${failures.length} of ${pass + failures.length} Workload capacity-placement checks failed ❌\n  - ${failures.join('\n  - ')}`
  : `\nAll ${pass} Workload capacity-placement checks passed ✅`);
process.exit(failures.length ? 1 : 0);
