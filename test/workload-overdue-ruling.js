'use strict';
/*
 * WHOSE OVERDUE IS IT? — the owner's ruling, pinned (ledger item 51).
 *
 * Measured 2026-08-27 on one video editor's plate: 132 sub-issues past their
 * due date in an active-type Linear state. Of those, 107 sat in `For Client
 * Approval` / `For SMM approval` / `For Kasper approval` — editing done, ball
 * with an approver — 6 in `Tweak Needed`, and 19 in Todo / In Progress. Linear's
 * own views call all 132 "overdue", which is how a person who finished their
 * editing weeks ago opens their board and reads a three-digit debt.
 *
 * The owner ruled (2026-08-27): work still to do — or in progress — past its
 * date COUNTS as the editor's overdue. Work waiting on an approval does NOT.
 * Tweak Needed goes to the NEEDED lane, not the overdue lane.
 *
 * NARROWED 2026-09-07, same owner, same lane. Overdue is now a TO DO lane
 * only. The reasoning: every live status other than To Do already says
 * something truer about where a row is — In Progress says somebody has it
 * open right now, Tweak Needed says it went back for a named change — and
 * that status OVERRIDES the date rather than doubling into a second lane. A
 * past-due In Progress row was previously counted in both strips at once; it
 * is now counted only in In progress. So of the 19, only the Todo share is
 * Overdue; the In Progress share moved one strip down, and the 113 parked and
 * tweak rows are unchanged.
 *
 * The narrowing moved a COUNT, not a PLACEMENT (owner decision, same day).
 * Past-due work still leaves the work-day calendar whenever a strip above is
 * already carrying it, so today's cell keeps the capacity totals it had; the
 * only rows that now fall through to `planned` are past-due rows in a live
 * status no strip claims, which would otherwise drop off the page entirely.
 *
 * The Workload view encodes that rule in three stages this suite executes:
 *
 *   1. `wlIsActiveStatus` parks the approval states by NAME (a fixed
 *      vocabulary, WL_PARKED_STATUSES) before any bucketing, so an
 *      approval-wait row never reaches a strip at all;
 *   2. the partition loop routes tweak-family rows to `tweaksNeeded` BEFORE
 *      the past-due check runs, so a late tweak is "needed", never "overdue";
 *   3. the past-due check itself is gated on `wlIsToDo`, so every remaining
 *      live status keeps its own strip and stays off the overdue lane;
 *   4. the calendar short-circuit is gated on a strip actually carrying the
 *      row, so a past-due row nothing claims stays visible on the calendar.
 *
 * What the page shows the editor is a subset of the ~19, never the 132. The
 * 132 lives in Linear's native UI, which we do not render and cannot re-teach;
 * changing what LINEAR calls overdue would mean changing the data (clearing
 * due dates at approval time), which is a workflow decision, not a view fix.
 *
 * One live shape earns its own pin: 5 of the 6 tweak rows carry the status
 * string "Tweak Needed " — trailing space, exactly as mirrored. They land in
 * the right lane only because `wlNormStatus` trims before comparing. That trim
 * is load-bearing; lose it and five real rows silently change lanes.
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- the predicates, EXECUTED ---------------------------------------------
const predFrom = html.indexOf('const WL_PARKED_STATUSES = new Set([');
const predTo = html.indexOf('// Editors who have left the team.');
ok(predFrom > -1 && predTo > predFrom, 'the status predicates are findable (harness is not vacuous)');
const predicates = new Function(html.slice(predFrom, predTo)
  + '\nreturn { WL_PARKED_STATUSES, wlNormStatus, wlIsActiveStatus, wlIsInProgress, wlIsTweaksNeeded, wlIsToDo };')();

const APPROVAL_STATES = ['For Client Approval', 'For SMM approval', 'For Kasper approval'];
for (const name of APPROVAL_STATES) {
  ok(predicates.wlIsActiveStatus({ status: name, statusType: 'started' }) === false,
    `"${name}" (Linear type: started) is parked — it reaches no strip, overdue included`);
}
ok(predicates.wlIsActiveStatus({ status: 'Todo', statusType: 'unstarted' }) === true
  && predicates.wlIsActiveStatus({ status: 'In Progress', statusType: 'started' }) === true,
  'while Todo and In Progress stay live work, as the ruling says they must');
ok(predicates.wlIsActiveStatus({ status: 'Tweak Needed ', statusType: 'started' }) === true,
  'and "Tweak Needed " — trailing space, the shape 5 live mirror rows actually carry — stays live too');
ok(predicates.wlNormStatus({ status: '  Tweak Needed  ' }) === 'tweak needed',
  'because the normaliser trims before comparing — the load-bearing trim');
ok(predicates.wlIsTweaksNeeded({ status: 'Tweak Needed ' })
  && predicates.wlIsTweaksNeeded({ status: 'Tweak Needed' }),
  'and the tweak predicate recognises both the mirrored spelling and the clean one');

// ---- the partition, EXECUTED ----------------------------------------------
/* The real loop, run with the real predicates. Only the helpers that reach
   outside the loop are stubbed: today is fixed, every editor is allowed, no
   manual plan pins. */
const partFrom = html.indexOf('const todayISO     = wlWorkloadTodayISO();');
const partTo = html.indexOf('wlState.unassigned   = unassigned;');
ok(partFrom > -1 && partTo > partFrom, 'the partition loop is findable (harness is not vacuous)');
const partitionSrc = html.slice(partFrom, partTo + 'wlState.unassigned   = unassigned;'.length);
const runPartition = (subs, overrides) => new Function(
  'subs', 'wlState', 'wlWorkloadTodayISO', 'wlIsInProgress', 'wlIsTweaksNeeded',
  'wlIsToDo', 'wlPlanDate', 'wlDisplayDate', 'wlIssueEditorAllowed',
  partitionSrc + '\nreturn { nowWorking, tweaksNeeded, planned, overdue, undated, unassigned };')(
  subs, {},
  () => '2026-08-27',
  (overrides && overrides.wlIsInProgress) || predicates.wlIsInProgress,
  (overrides && overrides.wlIsTweaksNeeded) || predicates.wlIsTweaksNeeded,
  (overrides && overrides.wlIsToDo) || predicates.wlIsToDo,
  () => null,
  s => s.dueDate || null,
  new Function('wlIsAllowedEditor', html.slice(html.indexOf('    function wlIssueEditorAllowed('), html.indexOf('    function wlSnapshotIdentity(')) + '; return wlIssueEditorAllowed;')(() => true));

/* Fixtures shaped like the measured plate: approval-wait, tweaks (mirrored
   trailing-space spelling included), late Todo / In Progress, future Todo,
   and terminal rows. The approval rows are filtered exactly where the app
   filters them — through the real wlIsActiveStatus, before the partition. */
const mk = (id, status, statusType, dueDate) => ({
  id, isSubIssue: true, assigneeId: 'ed-1', assigneeName: 'Editor', teamKey: 'VID',
  teamName: 'Video', clientName: 'Client', parentId: 'p-1', status, statusType, dueDate,
});
const plate = [
  mk('client-appr', 'For Client Approval', 'started', '2026-08-01'),
  mk('smm-appr', 'For SMM approval', 'started', '2026-08-01'),
  mk('kasper-appr', 'For Kasper approval', 'started', '2026-08-01'),
  mk('tweak-mirrored', 'Tweak Needed ', 'started', '2026-08-01'),
  mk('tweak-clean', 'Tweak Needed', 'started', '2026-08-01'),
  mk('todo-late', 'Todo', 'unstarted', '2026-08-01'),
  mk('inprog-late', 'In Progress', 'started', '2026-08-01'),
  mk('todo-future', 'Todo', 'unstarted', '2026-09-05'),
  mk('posted', 'Posted', 'completed', '2026-08-01'),
  mk('backlogged', 'Backlog', 'backlog', '2026-08-01'),
];
const active = plate.filter(s => s.isSubIssue && predicates.wlIsActiveStatus(s));
const buckets = runPartition(active);
const ids = list => list.map(s => s.id).sort().join(',');

ok(ids(buckets.overdue) === 'todo-late',
  'overdue is EXACTLY the late Todo — the 2026-09-07 narrowing, nobody else');
ok(!buckets.overdue.some(s => s.id === 'inprog-late'),
  'and the late In Progress row is NOT overdue — its own status overrides the date');
ok(ids(buckets.tweaksNeeded) === 'tweak-clean,tweak-mirrored',
  'both tweak spellings land in NEEDED, the lane the owner named for them');
ok(!buckets.overdue.some(s => predicates.wlIsTweaksNeeded(s)),
  'and no tweak row is also called overdue, however late it is');
ok(active.every(s => !APPROVAL_STATES.includes(s.status)),
  'no approval-wait row even reaches the partition — parked upstream, exactly where the app parks it');
ok(buckets.nowWorking.some(s => s.id === 'inprog-late')
  && buckets.nowWorking.filter(s => s.id === 'inprog-late').length === 1,
  'a late In Progress row shows in the in-progress strip, once, and only there');
ok(!buckets.planned.some(s => s.id === 'inprog-late'),
  'and it leaves the work-day calendar exactly as it did before — the narrowing moved a count, not a placement');
ok(buckets.planned.some(s => s.id === 'todo-future') && !buckets.overdue.some(s => s.id === 'todo-future'),
  'future-dated work is planned, not overdue');

/* Inversion — proof this suite would catch the regressions it exists to stop.
   If the tweak branch stopped short-circuiting, a late tweak becomes overdue;
   if the To Do gate stopped gating, the late In Progress row comes back. */
const inverted = runPartition(active, { wlIsTweaksNeeded: () => false });
ok(!inverted.tweaksNeeded.some(s => s.id === 'tweak-mirrored')
  && inverted.planned.some(s => s.id === 'tweak-mirrored'),
  'remove the tweak short-circuit and a late tweak leaves the NEEDED lane for the calendar — the assertions above are doing work');
const bothOff = runPartition(active, { wlIsTweaksNeeded: () => false, wlIsToDo: () => true });
ok(bothOff.overdue.some(s => s.id === 'tweak-mirrored'),
  'and with the To Do gate off too it is called overdue outright — the lane is reachable, the two guards are what keep it out');
const ungated = runPartition(active, { wlIsToDo: () => true });
ok(ungated.overdue.some(s => s.id === 'inprog-late'),
  'remove the To Do gate and the late In Progress row IS called overdue again — the gate is doing work');

// ---- the composition is the app's own -------------------------------------
const filterAt = html.indexOf('const subs = issues.filter(i => i.isSubIssue && wlIsActiveStatus(i) && wlIssueClientAllowed(i));');
ok(filterAt > -1 && filterAt < partFrom,
  'the app filters through wlIsActiveStatus BEFORE the partition — the order this suite reproduces');
for (const name of ['for client approval', 'for smm approval', 'for kasper approval']) {
  ok(predicates.WL_PARKED_STATUSES.has(name), `the parked vocabulary carries "${name}"`);
}

if (failures) {
  console.error(`\n${failures} Workload overdue-ruling check(s) failed`);
  process.exit(1);
}
console.log('\nWorkload overdue ruling checks passed');
