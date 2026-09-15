'use strict';

/*
 * Capacity-aware automatic Workload placement (owner rulings 2026-08-10 and
 * 2026-09-14).
 *
 * The capacity pass was born from an overload report: editors sat over
 * capacity on the Workload calendar, a pinned 2×-Workload pair filled one
 * editor's Monday and the automatic cards landed on the same day anyway
 * (6/4 · 2 over), and another 8/4 was seven automatic cards stacking on one
 * day with no pin involved at all. The 2026-09-14 ruling then flipped the
 * direction of the walk: work is now scheduled as EARLY as it fits instead of
 * as late as it fits, so a free day earlier in the week gets the work.
 *
 * The rules this suite pins, extracted straight out of index.html and run
 * hermetically (no DOM, no network, no clock):
 *
 *   1. A manual plan_date is ABSOLUTE — never moved, and its units are
 *      reserved before any automatic item is placed.
 *   2. Automatic items are placed as EARLY as they fit: the walk starts at
 *      TODAY and steps FORWARD over working days to the first day where that
 *      editor still has room.
 *   3. The walk never goes PAST the ideal day (one working day before the
 *      deadline, floored to today), and never starts before today.
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
const reshuffleCandidates = Number((source.match(/const WL_RESHUFFLE_MAX_CANDIDATES\s*=\s*(\d+)/) || [])[1]);
const reshuffleEvictions = Number((source.match(/const WL_RESHUFFLE_MAX_EVICTIONS\s*=\s*(\d+)/) || [])[1]);
assert(Number.isFinite(reshuffleCandidates) && reshuffleCandidates > 0
  && Number.isFinite(reshuffleEvictions) && reshuffleEvictions > 0,
  'the reshuffle search bounds are positive literals');

const wlState = {
  planByIssueId: new Map(),
  autoPlacementByIssueId: new Map(),
  autoPlacementSettled: new Map(),
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
  WL_RESHUFFLE_MAX_CANDIDATES: reshuffleCandidates,
  WL_RESHUFFLE_MAX_EVICTIONS: reshuffleEvictions,
  Map, Set, Array, Number, String, Boolean, Object, Date, Math, JSON,
  Intl, isNaN, parseInt, parseFloat, console,
};
context.globalThis = context;
vm.createContext(context);
for (const name of [
  'wlISO', 'wlParseISO', 'wlSubWorkingDays', 'wlAddWorkingDays', 'wlIsWorkingDay',
  'wlTeamBucket', 'wlEditorCapacity', 'wlDayOverCapacity',
  'wlWorkloadMeta', 'wlWorkloadWeight', 'wlWorkloadUnits',
  'wlPlanDate', 'wlAutoPlanDate', 'wlAutoPlacementDate', 'wlDisplayDate',
  'wlPlacementMode', 'wlCapacityKey', 'wlComputeAutoPlacements',
  'wlBucketByDisplayDate', 'wlFormatShort', 'wlAutoPlacementTip',
]) vm.runInContext(extract(name), context);

// ── Fixture helpers ─────────────────────────────────────────────────────
// 2026-08-10 is the Monday from the overload report; 08-07 is the Friday
// before it, 08-11/08-12 the Tuesday and Wednesday after.
const MON = '2026-08-10';
const TUE = '2026-08-11';
const WED_NEXT = '2026-08-12';
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
  // The anchor record from the previous pass. Cleared here so each check
  // starts from a first load; the churn checks below build it deliberately by
  // running the pass twice.
  wlState.autoPlacementSettled = new Map();
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
  // Two pinned videos at 2x Workload = the full 4-unit day, on today.
  const pinA = sub({ plan: MON, weight: 2, due: '2026-08-11' });
  const pinB = sub({ plan: MON, weight: 2, due: '2026-08-11' });
  // Two automatic videos that would otherwise start on that same Monday.
  const autoA = sub({ due: '2026-08-13' });
  const autoB = sub({ due: '2026-08-13' });
  const subs = [pinA, pinB, autoA, autoB];

  const dates = place(subs, MON);
  assert.strictEqual(dates[0], MON, 'pinned A holds its exact day');
  assert.strictEqual(dates[1], MON, 'pinned B holds its exact day');
  assert.strictEqual(dates[2], TUE, 'automatic A stepped forward one working day');
  assert.strictEqual(dates[3], TUE, 'automatic B stepped forward one working day');
  assert.strictEqual(maxOverBy(subs), 0, 'no editor/day is over capacity any more');
  assert.strictEqual(context.wlDayOverCapacity([pinA, pinB]), false,
    'the pinned pair alone is exactly at capacity, not over');
});

check('pins are never moved even when the pins alone blow the capacity', () => {
  reset();
  // Six pinned units on one 4-unit day: deliberate human placement wins, and
  // the day stays visibly over — the badge is the point.
  const pinned = [1, 2, 3, 4, 5, 6].map(() => sub({ plan: MON, due: '2026-08-14' }));
  const auto = sub({ due: '2026-08-13' });          // may sit anywhere MON→WED
  const subs = pinned.concat([auto]);

  const dates = place(subs, MON);
  assert.deepStrictEqual(dates.slice(0, 6), Array(6).fill(MON), 'every pin held');
  assert.strictEqual(dates[6], TUE, 'the automatic item stepped around the over-full pinned day');
  assert.strictEqual(context.wlDayOverCapacity(pinned), true,
    'the pinned overload stays visible');
});

// ── 2. Automatic-vs-automatic spreading (the 8/4 in the screenshot) ──────
check('seven automatic cards spread forwards instead of stacking', () => {
  reset();
  // ideal is WED_NEXT, so the window is MON → TUE → WED_NEXT.
  const subs = Array.from({ length: 7 }, () => sub({ due: '2026-08-13' }));
  const dates = place(subs, MON);
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [MON]: 4, [TUE]: 3 },
    'four fill today, the rest spill onto the next working day');
  assert.strictEqual(maxOverBy(subs), 0, 'nothing is left over capacity');
});

check('a long queue keeps filling later working days and skips the weekend', () => {
  reset();
  const subs = Array.from({ length: 10 }, () => sub({ due: '2026-08-13' }));
  const dates = place(subs, FRI);
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [FRI]: 4, [MON]: 4, [TUE]: 2 },
    'the walk steps Fri → Mon → Tue, never onto Sat/Sun');
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

check('the forward walk stops at the ideal day and never lands past it', () => {
  reset();
  // Both days of the window are pinned full, so there is nowhere forward to go.
  const onToday = Array.from({ length: 4 }, () => sub({ plan: MON, due: '2026-08-14' }));
  const onIdeal = Array.from({ length: 4 }, () => sub({ plan: TUE, due: '2026-08-14' }));
  const auto = sub({ due: WED_NEXT });            // ideal = Tue 11 Aug
  const subs = onToday.concat(onIdeal, [auto]);
  const dates = place(subs, MON);                 // today IS Monday
  assert.strictEqual(context.wlAutoPlanDate(auto, MON), TUE, 'its ideal day is Tuesday');
  assert.strictEqual(dates[8], TUE,
    'it stops on its ideal day instead of walking past the deadline buffer');
  assert.ok(dates[8] <= TUE, 'nothing is ever pushed later than the ideal day');
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
  const heavy = sub({ due: WED_NEXT, weight: 2 });      // needs 2 units, ideal TUE
  const subs = pinned.concat([heavy]);
  const dates = place(subs, MON);
  assert.strictEqual(context.wlWorkloadWeight(heavy), 2, 'the 2x label is read as two units');
  assert.strictEqual(dates[3], TUE, 'a 2-unit item skips a day with a single free unit');
});

check('the heavier item claims the earliest day before lighter ones fill it in pieces', () => {
  reset();
  const light = [sub({ due: WED_NEXT }), sub({ due: WED_NEXT }), sub({ due: WED_NEXT })];
  const heavy = sub({ due: WED_NEXT, weight: 2 });
  const subs = light.concat([heavy]);             // 5 units competing for a 4-unit day
  const dates = place(subs, MON);
  assert.strictEqual(dates[3], MON, 'the 2x item takes the earliest day first');
  assert.strictEqual(dates.filter(day => day === MON).length, 3,
    'the 2x item plus two 1x items exactly fill the 4-unit day');
  assert.strictEqual(dates.filter(day => day === TUE).length, 1, 'the fifth unit moves on a day');
  assert.strictEqual(maxOverBy(subs), 0, 'first-fit-decreasing leaves nothing over capacity');
});

// ── 5. Scope: per editor, per team, and independent of the filters ──────
check('one editor filling a day never moves another editor off it', () => {
  reset();
  const busy = Array.from({ length: 4 }, () => sub({ assignee: 'editor-a', due: WED_NEXT }));
  const other = sub({ assignee: 'editor-b', due: WED_NEXT });
  const subs = busy.concat([other]);
  const dates = place(subs, MON);
  assert.strictEqual(dates[4], MON, 'the second editor keeps the earliest day');
});

check('graphics uses its own 15-item capacity and ignores video workload labels', () => {
  reset();
  const rows = Array.from({ length: 16 }, () => sub({
    assignee: 'designer', teamKey: 'GRA', teamName: 'Graphics', due: WED_NEXT, weight: 3,
  }));
  assert.strictEqual(context.wlEditorCapacity('GRA', 'Graphics'), 15, 'graphics capacity is 15');
  assert.strictEqual(context.wlWorkloadWeight(rows[0]), 1,
    'a workload label on a graphics item still counts as one');
  const dates = place(rows, MON);
  const byDay = dates.reduce((acc, day) => (acc[day] = (acc[day] || 0) + 1, acc), {});
  assert.deepStrictEqual(byDay, { [MON]: 15, [TUE]: 1 }, 'the 16th item spills to Tuesday');
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
check('every automatic card reports ONE automatic mode, wherever it landed', () => {
  reset();
  const pinned = sub({ plan: MON, due: '2026-08-14' });          // 1 unit of today
  const stayed = sub({ due: '2026-08-11' });                     // ideal IS today
  const later = Array.from({ length: 4 }, () => sub({ due: WED_NEXT })); // ideal TUE
  const subs = [pinned, stayed].concat(later);
  place(subs, MON);

  /* Owner ruling 2026-09-14: one automatic state. The second mode split
     "the earliest day with room happened to BE the ideal day" from "it was
     earlier" — under earliest-fit that is not an incident, just arithmetic,
     and it showed as two different icons nobody could act on. */
  assert.strictEqual(context.wlPlacementMode(pinned), 'manual', 'a pin stays "manual"');
  const modes = subs.slice(1).map(row => context.wlPlacementMode(row));
  assert.strictEqual(modes.filter(mode => mode === 'auto').length, 5,
    'every automatic card reads "auto", whether or not it sits on its ideal day');
  assert.strictEqual(modes.filter(mode => mode === 'shifted').length, 0,
    'no card reports the retired "shifted" mode');
  const onIdeal = subs.slice(1).filter(row => context.wlDisplayDate(row) === context.wlAutoPlanDate(row, MON));
  assert.ok(onIdeal.length > 0 && onIdeal.length < 5,
    'the fixture still mixes cards on and off their ideal day (harness is not vacuous)');
});

check('the calendar buckets the moved item on its new day, not its ideal day', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: TUE, due: '2026-08-14' }));
  const bumped = sub({ due: WED_NEXT });          // ideal TUE, but today is free
  const subs = pinned.concat([bumped]);
  place(subs, MON);
  const buckets = context.wlBucketByDisplayDate(subs);
  // Arrays built inside the VM realm are not deepStrictEqual to host arrays,
  // so compare the ids as a plain string.
  const idsOn = day => (buckets.get(day) || []).map(row => row.id).join(',');
  assert.strictEqual((buckets.get(TUE) || []).length, 4, 'Tuesday holds only the four pins');
  assert.strictEqual(idsOn(TUE), pinned.map(row => row.id).join(','), 'Tuesday holds exactly the pins');
  assert.strictEqual(idsOn(MON), bumped.id, 'Monday holds the card pulled earlier');
});

check('a moved card is never placed later than its own ideal day', () => {
  reset();
  const rows = Array.from({ length: 12 }, () => sub({ due: '2026-08-13' }));
  place(rows, '2026-08-03');
  for (const row of rows) {
    assert.ok(context.wlDisplayDate(row) <= context.wlAutoPlanDate(row, '2026-08-03'),
      'no card was pushed later than its ideal (deadline − 1 working day, floored to today) placement');
  }
});

check('a deadline of today plans ON the due date — the floor outranks the buffer', () => {
  reset();
  // The ideal day is max(deadline − 1 working day, today), so an item due today
  // plans on its due date. "Never later than the ideal day" is the real
  // invariant; "always before the deadline" is NOT true at the floor.
  const dueToday = sub({ due: MON });
  place([dueToday], MON);
  assert.strictEqual(context.wlDisplayDate(dueToday), MON, 'it plans on its own due date');
  assert.strictEqual(context.wlPlacementMode(dueToday), 'auto', 'and is an ordinary automatic card');
});

// ── 7b. A stored move must honour the same today floor as wlAutoPlanDate ──
check('a capacity move that has gone stale overnight is ignored, not rendered in the past', () => {
  reset();
  // Friday: the card's ideal day is next Tuesday, but Friday has room, so the
  // earliest-fit walk stops on today.
  const bumped = sub({ due: WED_NEXT });
  place([bumped], FRI);
  assert.strictEqual(context.wlDisplayDate(bumped), FRI, 'on Friday it renders on Friday');
  assert.strictEqual(context.wlPlacementMode(bumped), 'auto', 'as one automatic card like any other');
  assert.ok(/earliest working day with room/.test(context.wlAutoPlacementTip(bumped)),
    'and its detail names the rule it was placed by');

  // The tab stays open over the weekend. wlApplyData has not re-run, so the map
  // still says Friday — a day that is now in the past.
  TODAY = MON;
  assert.strictEqual(context.wlAutoPlacementDate(bumped), '',
    'the stale entry is dropped at read time');
  assert.strictEqual(context.wlDisplayDate(bumped), TUE,
    'the card falls back to its re-floored ideal day instead of a past Friday');
  assert.strictEqual(context.wlPlacementMode(bumped), 'auto',
    'and is still an ordinary automatic card');
  assert.ok(context.wlAutoPlacementTip(bumped).includes(context.wlFormatShort(TUE)),
    'and its detail names the day it is actually on, not the stale Friday');
});

check('an automatic card can never render before today, whatever the map holds', () => {
  reset();
  const rows = Array.from({ length: 12 }, () => sub({ due: '2026-08-13' }));
  place(rows, '2026-08-03');            // spreads forward across that week
  assert.ok(wlState.autoPlacementByIssueId.size > 0, 'the fixture really does move cards');
  for (const laterToday of [FRI, MON, '2026-08-11', '2026-09-01']) {
    TODAY = laterToday;
    for (const row of rows) {
      assert.ok(context.wlDisplayDate(row) >= laterToday,
        `no card renders before ${laterToday} once the clock has moved on`);
    }
  }
});

check('a move that is still in the future survives the same read-time floor', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: WED, due: '2026-08-14' }));
  const bumped = sub({ due: WED_NEXT }); // today is full, so it lands on THU
  place(pinned.concat([bumped]), WED);
  for (const stillEarlier of [WED, THU]) {
    TODAY = stillEarlier;                // the floor is inclusive of today
    assert.strictEqual(context.wlDisplayDate(bumped), THU,
      `the move is kept while today is ${stillEarlier}`);
    assert.strictEqual(context.wlPlacementMode(bumped), 'auto', 'and reads as an ordinary automatic card');
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
  TODAY = MON;
  const rows = Array.from({ length: 6 }, () => sub({ due: '2026-08-11' }));
  wlState.autoPlacementByIssueId = new Map();
  assert.deepStrictEqual(rows.map(row => context.wlDisplayDate(row)), Array(6).fill(MON),
    'during the fast paint every card sits at its unmoved automatic estimate');
});

check('a capacity move is derived only — it never becomes a saved plan_date', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: WED, due: '2026-08-14' }));
  const bumped = sub({ due: WED_NEXT });
  place(pinned.concat([bumped]), WED);
  assert.strictEqual(context.wlDisplayDate(bumped), THU, 'the card renders on the next free day');
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

check('the forward walk is bounded so a bad date can never hang the render', () => {
  const compute = extract('wlComputeAutoPlacements');
  assert.ok(/guard < WL_PLACEMENT_WALK_LIMIT && day <= entry\.ideal/.test(compute),
    'the loop is bounded by both the walk limit and the ideal-day ceiling');
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
for (const name of ['wlPlacementLabel', 'wlPlanOriginHtml',
  'wlRenderPlanIssueCards']) vm.runInContext(extract(name), context);

/* ── Last-resort reshuffle (owner ruling 2026-09-14) ──────────────────────
   First fit alone can manufacture an overload a different order would have
   avoided. The repair is deliberately narrow, and the owner's condition for
   wanting it at all was that a settled board must not churn every time a new
   sub-issue arrives — so "nothing moves unless it clears an overload" is as
   much the contract as the rearrangement itself. */
check('a fragmented window is rearranged instead of declared overloaded', () => {
  reset();
  // Codex's case: pins of 1/2/2 on Mon/Tue/Wed leave holes no single pass
  // fills. 2x due Wed takes Monday first; 3x due Thu then fits nowhere —
  // unless the 2x moves to Tuesday, which is within ITS OWN window.
  const pins = [sub({ plan: MON, weight: 1 }), sub({ plan: TUE, weight: 2 }), sub({ plan: WED_NEXT, weight: 2 })];
  const light = sub({ due: WED_NEXT, weight: 2, identifier: 'VID-7001' });
  const heavy = sub({ due: '2026-08-13', weight: 3, identifier: 'VID-7002' });
  place(pins.concat([light, heavy]), MON);

  assert.strictEqual(context.wlDisplayDate(heavy), MON, 'the heavy card takes Monday');
  assert.strictEqual(context.wlDisplayDate(light), TUE, 'and the lighter one moves to Tuesday, inside its own window');
  const load = dayLoad(pins.concat([light, heavy]));
  assert.strictEqual(load.get(context.wlCapacityKey(heavy) + '@' + MON), 4, 'Monday is exactly full');
  assert.strictEqual(load.get(context.wlCapacityKey(light) + '@' + TUE), 4, 'Tuesday is exactly full');
  assert.ok(!context.wlDayOverCapacity([pins[2], light, heavy].filter(row => context.wlDisplayDate(row) === WED_NEXT)),
    'and nothing is left over capacity');
});

check('a HEAVY newcomer does not rearrange a settled board to take the earlier day', () => {
  reset();
  // The first version of this check used equal weights, where the sort order
  // happens to keep incumbents in place — so it proved nothing. Codex's case:
  // four settled 1-unit cards fill Monday, then a 3-unit card with the same
  // deadline arrives and SORTS FIRST (heavier first within one ideal day). It
  // would take Monday and push three incumbents to Tuesday, although it could
  // simply take Tuesday alone.
  const settled = Array.from({ length: 4 }, (_, i) => sub({ due: WED_NEXT, identifier: 'VID-710' + i }));
  const before = place(settled, MON);
  assert.deepStrictEqual(before, [MON, MON, MON, MON], 'all four settle on the earliest day');

  // The SAME snapshot plus the newcomer, recomputed from scratch as a real
  // refresh does — the anchor record from the pass above is what carries the
  // incumbents, and it is the only thing that survives.
  const newcomer = sub({ due: WED_NEXT, weight: 3, identifier: 'VID-7199' });
  const after = place(settled.concat([newcomer]), MON);
  assert.deepStrictEqual(after.slice(0, 4), [MON, MON, MON, MON], 'every incumbent keeps its day');
  assert.strictEqual(after[4], TUE, 'and the newcomer takes the next day with room for it');
});

check('an anchor is dropped when it stops fitting, and never on a first load', () => {
  reset();
  const settled = Array.from({ length: 4 }, () => sub({ due: WED_NEXT }));
  place(settled, MON);
  // A pin lands on Monday afterwards and takes the room the anchors held: the
  // soft anchors must yield to it rather than sit over capacity.
  const pin = sub({ plan: MON, weight: 2 });
  const dates = place(settled.concat([pin]), MON);
  const monday = dates.slice(0, 4).filter(day => day === MON).length;
  assert.strictEqual(monday, 2, 'only what fits beside the pin stays on Monday');
  assert.ok(dates.slice(0, 4).every(day => day >= MON && day <= WED_NEXT),
    'the displaced cards re-place inside their own window');
  assert.strictEqual(dates[4], MON, 'and the pin itself is untouched');
});

check('an anchored board never shows more overload than a reload would', () => {
  /* Owner report 2026-09-14 (second round): "use automatic planning" on a
     pinned card left the day over capacity — 5/4 — and only a refresh showed
     the clean 4/4, because a fresh page has no anchors. The invariant that
     covers that whole class, whatever the arrangement: an anchor is a
     preference for stability, never a reason to render a worse board than the
     same data would render on a reload.

     Swept over deterministic scenarios rather than one fixture, because the
     shapes that defeat the bounded repair are exactly the ones nobody thinks
     to write down. Each scenario settles, pins a card away, unpins it, and
     compares the resulting overload with the same data planned from scratch. */
  const overloadOf = (subs) => {
    const totals = dayLoad(subs);
    let over = 0;
    for (const [key, units] of totals) {
      const row = subs.find(s => context.wlCapacityKey(s) + '@' + context.wlDisplayDate(s) === key);
      const cap = context.wlEditorCapacity(row && row.teamKey, row && row.teamName);
      if (units > cap) over += units - cap;
    }
    return over;
  };
  const WEIGHTS = [1, 2, 3];
  const DUES = ['2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14'];
  let scenarios = 0;
  for (let shape = 0; shape < 24; shape++) {
    reset();
    const subs = [];
    for (let i = 0; i < 9; i++) {
      subs.push(sub({
        due: DUES[(i + shape) % DUES.length],
        weight: WEIGHTS[(i * (shape + 1)) % WEIGHTS.length],
        identifier: 'VID-8' + shape + i,
      }));
    }
    place(subs, MON);                                   // settle, filling the anchors
    wlState.planByIssueId.set(subs[shape % subs.length].id, '2026-08-14');
    place(subs, MON);                                   // pin one card away
    wlState.planByIssueId.delete(subs[shape % subs.length].id);
    place(subs, MON);                                   // "use automatic planning"
    const anchored = overloadOf(subs);

    wlState.autoPlacementSettled = new Map();           // exactly what a reload has
    place(subs, MON);
    const reloaded = overloadOf(subs);

    assert.ok(anchored <= reloaded,
      `shape ${shape}: anchored board is ${anchored} units over capacity where a reload is ${reloaded}`);
    scenarios++;
  }
  assert.strictEqual(scenarios, 24, 'every scenario ran (harness is not vacuous)');
});

check('room freed by a new pin is reclaimed in the SAME pass, without a reload', () => {
  reset();
  // Owner report 2026-09-14: "when I drag things around to pin them, I need to
  // refresh the page to actually see the new board". The anchor held every
  // card on its remembered day, so pinning one card AWAY from a day left the
  // gap it opened unfilled until a reload dropped the anchors.
  const cards = Array.from({ length: 5 }, (_, i) => sub({ due: '2026-08-14', identifier: 'VID-760' + i }));
  const settled = place(cards, MON);
  assert.deepStrictEqual(settled, [MON, MON, MON, MON, TUE], 'four fill Monday and the fifth takes Tuesday');

  // Pin one of the Monday cards to Wednesday: Monday now has room for one.
  wlState.planByIssueId.set(cards[0].id, WED_NEXT);
  const after = place(cards, MON);
  assert.strictEqual(after[0], WED_NEXT, 'the pinned card holds exactly where it was dropped');
  assert.strictEqual(after[4], MON, 'and the Tuesday card moves up into the room that just opened');
  assert.deepStrictEqual(after.slice(1, 4), [MON, MON, MON], 'the untouched cards do not move');
});

check('the reshuffle tries eviction SETS, not the cheapest card first', () => {
  reset();
  // Codex's second case: Monday holds a 2 and a 1, Tuesday is pinned at 2,
  // Wednesday is pinned full. A 3-unit newcomer needs three units on Monday.
  // Taking the lightest candidate first moves the 1 into Tuesday's only hole,
  // stranding the 2 — and the whole repair rolls back. Moving just the 2 fits
  // everything: Monday 1+3, Tuesday 2+2.
  const pins = [sub({ plan: TUE, weight: 2 }), sub({ plan: WED_NEXT, weight: 4 })];
  const two = sub({ due: WED_NEXT, weight: 2, identifier: 'VID-7401' });
  const one = sub({ due: WED_NEXT, weight: 1, identifier: 'VID-7402' });
  place(pins.concat([two, one]), MON);
  const newcomer = sub({ due: WED_NEXT, weight: 3, identifier: 'VID-7403' });
  const dates = place(pins.concat([two, one, newcomer]), MON);

  assert.strictEqual(dates[4], MON, 'the newcomer gets the room it needs');
  assert.strictEqual(dates[2], TUE, 'the 2-unit card is the one that moves');
  assert.strictEqual(dates[3], MON, 'and the 1-unit card stays where it was');
  const load = dayLoad(pins.concat([two, one, newcomer]));
  assert.strictEqual(load.get(context.wlCapacityKey(newcomer) + '@' + MON), 4, 'Monday is exactly full');
  assert.strictEqual(load.get(context.wlCapacityKey(two) + '@' + TUE), 4, 'Tuesday is exactly full');
});

check('the reshuffle never moves a pin and never pushes anything past its own deadline', () => {
  reset();
  const pin = sub({ plan: MON, weight: 3 });
  // Its window is Monday only (due Tuesday), so it cannot be evicted anywhere.
  const stuck = sub({ due: TUE, weight: 2, identifier: 'VID-7300' });
  const blocker = sub({ due: TUE, weight: 2, identifier: 'VID-7301' });
  place([pin, stuck, blocker], MON);
  assert.strictEqual(context.wlDisplayDate(pin), MON, 'the pin holds its exact day');
  assert.ok(context.wlDisplayDate(stuck) <= MON && context.wlDisplayDate(blocker) <= MON,
    'neither automatic card is pushed past its own deadline to make room');
});

check('a weekend policy day starts the walk on Monday, not on the weekend itself', () => {
  reset();
  // Saturday 2026-08-08 with a Wednesday 2026-08-12 deadline: the ideal day is
  // Tuesday, and every day in the window is empty. Starting the walk at a bare
  // `today` put ordinary automatic work on the Saturday.
  const SAT = '2026-08-08';
  const weekendCard = sub({ due: '2026-08-12' });
  const [placed] = place([weekendCard], SAT);
  assert.strictEqual(placed, '2026-08-10', 'it lands on the Monday, not the Saturday');

  // A card due on the weekend day itself keeps its one-day window: the ideal is
  // floored to today, the forward start runs past it, and it stays put rather
  // than being pushed into the next week.
  reset();
  const dueNow = sub({ due: SAT });
  assert.strictEqual(place([dueNow], SAT)[0], SAT, 'a card due today stays on today even on a weekend');
});

check('an automatic card renders ONE automatic icon and names the day it is on', () => {
  reset();
  const pinned = Array.from({ length: 4 }, () => sub({ plan: WED, due: '2026-08-14' }));
  const bumped = sub({ due: WED_NEXT, identifier: 'VID-9001' });
  place(pinned.concat([bumped]), WED);

  const html = context.wlRenderPlanIssueCards([bumped], THU);
  assert.ok(html.includes('wl-plan-origin is-auto'), 'it is an automatic card like any other');
  assert.ok(!/is-shifted/.test(html), 'the retired second automatic icon is gone');
  assert.ok(/aria-label="Automatically planned"/.test(html), 'with the one automatic label');
  assert.ok(html.includes('6 Aug'), 'the detail names the day it is actually on');
  assert.ok(html.includes('11 Aug'), 'and the latest day it could have sat on');
  assert.ok(/4-unit daily capacity/.test(html), 'and the cap that is the only thing pushing a card later');

  const stayed = context.wlRenderPlanIssueCards([pinned[0]], WED);
  assert.ok(stayed.includes('wl-plan-origin is-manual'), 'a pin still renders as manual, which does mean something');
});

check('an automatic card on its ideal day carries the same icon and says so plainly', () => {
  reset();
  const auto = sub({ due: '2026-08-11' });        // ideal day IS today
  place([auto], MON);
  const html = context.wlRenderPlanIssueCards([auto], MON);
  assert.ok(html.includes('wl-plan-origin is-auto'), 'the same automatic icon as a card placed earlier');
  assert.ok(/aria-label="Automatically planned"/.test(html), 'and the same label');
  assert.ok(/earliest working day with room/.test(html),
    'its detail describes the rule rather than distinguishing a non-event');
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
