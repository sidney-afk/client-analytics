'use strict';
/*
 * CARRIED OVER: unfinished work pinned to a day that has passed.
 *
 * A saved plan day (workload_plan.plan_date) is a person's deliberate choice
 * and the view never edits or deletes it. But a pin on a past day used to hold
 * the card on that past day: the week view starts on this week's Monday, so a
 * card pinned to an earlier week was on no visible day at all, and one pinned
 * earlier this week sat on a day nobody was working on. Owner request
 * 2026-09-30: unfinished work planned on a past day shows on the first working
 * day from today, clearly marked "Carried over", never hidden.
 *
 * Run hermetically (no DOM, no network, no clock) straight out of the source
 * fragments in src/index, so it does not depend on which script file the build
 * puts the Workload code in.
 *
 *   1. A pin before today is DISPLAYED on today (or the next working day when
 *      today is a weekend) and its mode is 'carried'.
 *   2. The saved day itself is untouched: wlPlanDate still returns it, so a
 *      drag, a clear or a write starts from the real saved value.
 *   3. A pin today or later is unchanged and stays 'manual'.
 *   4. Carried cards spend capacity on the day they are shown, so an automatic
 *      card yields around them instead of stacking on top.
 *   5. The carried mark has a label, an icon branch and a tip.
 *   6. Finished work never reaches this code: approval-wait statuses are parked
 *      upstream, and the partition loop keeps a pinned past-due card on the
 *      calendar.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIR = path.resolve(__dirname, '..', 'src', 'index');
const read = name => fs.readFileSync(path.join(DIR, name), 'utf8');
const source = ['068-core-workload-dates.js.part', '069-workload-planning-helpers.js.part',
  '071-workload-planner.js.part', '080-workload-render.js.part'].map(read).join('\n');

let pass = 0;
const failures = [];
function check(name, fn) {
  try { fn(); pass++; console.log('ok - ' + name); }
  catch (error) { failures.push(name); console.log('FAIL - ' + name + '\n     ' + error.message); }
}
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
const literal = name => Number((source.match(new RegExp('const ' + name + '\\s*=\\s*(\\d+)')) || [])[1]);

const wlState = {
  planByIssueId: new Map(), autoPlacementByIssueId: new Map(), autoPlacementSettled: new Map(),
  workloadByIssueId: new Map(), planHasSnapshot: true, planLoading: false,
};
let TODAY = '2026-09-30';
const context = {
  wlState, wlWorkloadTodayISO: () => TODAY,
  WL_PLACEMENT_WALK_LIMIT: literal('WL_PLACEMENT_WALK_LIMIT'),
  WL_RESHUFFLE_MAX_CANDIDATES: literal('WL_RESHUFFLE_MAX_CANDIDATES'),
  WL_RESHUFFLE_MAX_EVICTIONS: literal('WL_RESHUFFLE_MAX_EVICTIONS'),
  wlEscape: s => String(s), Map, Set, Array, Number, String, Boolean, Object, Date, Math, JSON,
  Intl, isNaN, parseInt, parseFloat, console,
};
assert(context.WL_PLACEMENT_WALK_LIMIT > 0 && context.WL_RESHUFFLE_MAX_CANDIDATES > 0, 'constants found');
context.globalThis = context;
vm.createContext(context);
for (const name of [
  'wlISO', 'wlParseISO', 'wlSubWorkingDays', 'wlAddWorkingDays', 'wlIsWorkingDay',
  'wlTeamBucket', 'wlEditorCapacity', 'wlDayOverCapacity', 'wlWorkloadMeta', 'wlWorkloadWeight',
  'wlWorkloadUnits', 'wlPlanDate', 'wlCarriedDate', 'wlAutoPlanDate', 'wlAutoPlacementDate',
  'wlDisplayDate', 'wlPlacementMode', 'wlCapacityKey', 'wlComputeAutoPlacements',
  'wlBucketByDisplayDate', 'wlWeekMondayISO', 'wlDefaultWeekStartISO', 'wlFormatShort', 'wlAutoPlacementTip', 'wlPlacementLabel', 'wlPlanOriginHtml',
]) vm.runInContext(extract(name), context);

// 2026-09-30 is a Wednesday. 09-28 Monday, 09-19 a Saturday, 10-02 Friday.
let n = 0;
function sub(o) {
  const id = 'i' + (++n);
  wlState.planByIssueId.delete(id);
  if (o.plan) wlState.planByIssueId.set(id, o.plan);
  return { id, identifier: 'VID-' + (1000 + n), assigneeId: o.assignee || 'ed', teamKey: 'VID', teamName: 'Video',
    clientName: 'Client', dueDate: o.due || null };
}
function reset() { wlState.planByIssueId = new Map(); wlState.autoPlacementByIssueId = new Map(); wlState.autoPlacementSettled = new Map(); n = 0; TODAY = '2026-09-30'; }

check('a pin from a past week is shown on today and marked carried', () => {
  reset();
  const s = sub({ plan: '2026-09-02', due: '2026-09-04' });
  assert.strictEqual(context.wlDisplayDate(s), '2026-09-30');
  assert.strictEqual(context.wlPlacementMode(s), 'carried');
  assert.ok(context.wlBucketByDisplayDate([s]).has('2026-09-30'), 'it is in today\'s bucket, so the week view can draw it');
});
check('a pin from earlier this week is carried to today too', () => {
  reset();
  const s = sub({ plan: '2026-09-28' });
  assert.strictEqual(context.wlDisplayDate(s), '2026-09-30');
  assert.strictEqual(context.wlPlacementMode(s), 'carried');
});
check('on a weekend it lands on the first working day', () => {
  reset(); TODAY = '2026-10-03'; // Saturday
  const s = sub({ plan: '2026-09-15' });
  assert.strictEqual(context.wlDisplayDate(s), '2026-10-05');
});
check('at a weekend the default week is the coming one, so the carried card is on screen', () => {
  reset(); TODAY = '2026-10-03'; // Saturday
  const s = sub({ plan: '2026-09-15' });
  const start = context.wlDefaultWeekStartISO(TODAY);
  assert.strictEqual(start, '2026-10-05');
  assert.strictEqual(context.wlDisplayDate(s), start, 'the carried day is the first day of the default week');
  assert.strictEqual(context.wlDefaultWeekStartISO('2026-09-30'), '2026-09-28', 'a weekday keeps its own week');
});
check('the saved plan day is never changed', () => {
  reset();
  const s = sub({ plan: '2026-09-02' });
  context.wlDisplayDate(s); context.wlPlacementMode(s);
  assert.strictEqual(context.wlPlanDate(s), '2026-09-02');
  assert.strictEqual(wlState.planByIssueId.get(s.id), '2026-09-02');
  assert.strictEqual(wlState.planByIssueId.size, 1);
});
check('a pin today or later is unchanged and stays manual', () => {
  reset();
  const today = sub({ plan: '2026-09-30' }), later = sub({ plan: '2026-10-02' });
  assert.strictEqual(context.wlDisplayDate(today), '2026-09-30');
  assert.strictEqual(context.wlDisplayDate(later), '2026-10-02');
  assert.strictEqual(context.wlPlacementMode(today), 'manual');
  assert.strictEqual(context.wlPlacementMode(later), 'manual');
  assert.strictEqual(context.wlCarriedDate(later), '');
});
check('carried cards spend capacity on the day they are shown', () => {
  reset();
  // Two 2-unit... use default weight 1: four carried cards fill the 4-unit day.
  const carried = [1, 2, 3, 4].map(() => sub({ plan: '2026-09-02', due: '2026-10-05' }));
  const auto = sub({ due: '2026-10-05' });
  wlState.autoPlacementByIssueId = context.wlComputeAutoPlacements(carried.concat([auto]), TODAY);
  assert.notStrictEqual(context.wlDisplayDate(auto), '2026-09-30', 'the automatic card yields to the full day');
});
check('an unpinned overdue card is untouched (still not on the calendar rule here)', () => {
  reset();
  const s = sub({ due: '2026-09-02' });
  assert.strictEqual(context.wlPlacementMode(s), 'auto');
  assert.strictEqual(context.wlDisplayDate(s), '2026-09-30');
});
check('the carried mark has a label, icon and tip', () => {
  const html = context.wlPlanOriginHtml('carried', false, 0, '');
  assert.ok(html.includes('is-carried') && html.includes('Carried over'), html);
  assert.ok(/data-tip="Carried over:/.test(html), 'tip explains it');
  assert.ok(read('010-styles-foundation.css.part').includes('.wl-plan-origin.is-carried'), 'styled');
});
check('a pinned past-due card is kept on the calendar by the partition loop', () => {
  const loop = read('080-workload-render.js.part');
  assert.ok(loop.includes('if (isPastDue && (isOverdue || inProg) && !hasManualPlan) continue;'),
    'pinned past-due work still falls through to planned');
  assert.ok(/WL_PARKED_STATUSES/.test(loop) || /wlIsActiveStatus/.test(source), 'finished statuses are parked upstream');
});

console.log(`\nworkload-carried-over: ${pass} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
