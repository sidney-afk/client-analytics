'use strict';
/*
 * The standing check `OPEN_REPAIRS.md` item 72 asked for, pinned offline.
 *
 * Item 72: the flip moved only the due date and the workload weight to the
 * native store, so a RETIRED system still decides what counts as live work on
 * the page an editor opens to see what they owe. It ended by naming the check
 * that should become standing. `scripts/workload-native-visibility-check.js` is
 * that check; this file proves its classification rules without a network, so
 * the suite never depends on a service being up.
 *
 * THE NARROWING IS THE POINT and is what this mostly guards. Measured
 * 2026-09-02, 86 native live-work rows look dropped by Workload and 81 of them
 * are dropped CORRECTLY -- they have no native parent, so they are batch
 * parents (posts), not assignable deliverables. Zero of the 81 carry a parent.
 * A check that counted them would report a defect eighty-one times bigger than
 * the real one, and the real one would be ignored. That is the alarm-fatigue
 * failure `PRE_FLIP_HEALTH_CHECK.md` exists to prevent, reproduced inside a
 * different tool.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'workload-native-visibility-check.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* The real classifier, lifted from the script. */
const parkedTypesSrc = /const PARKED_TYPES = new Set\(\[[\s\S]*?\]\);/.exec(SRC);
const parkedStatusesSrc = /const PARKED_STATUSES = new Set\(\[[\s\S]*?\]\);/.exec(SRC);
const hides = new Function(
  (parkedTypesSrc ? parkedTypesSrc[0] : '') + '\n'
  + (parkedStatusesSrc ? parkedStatusesSrc[0] : '') + '\n'
  + grabFunc(SRC, 'workloadHides') + '\nreturn workloadHides;')();

/* The two halves of the cause column, also lifted and RUN rather than
   pattern-matched. Both are pure by design so that this is possible. */
const { foldDeletionEvents, attachCauses } = new Function(
  grabFunc(SRC, 'foldDeletionEvents') + '\n'
  + grabFunc(SRC, 'attachCauses') + '\n'
  + 'return { foldDeletionEvents, attachCauses };')();

/* ---- 1. BOTH parked sets match the page, term for term ------------------ */

/* Workload parks a row for two independent reasons and the first version of
   this check knew only one. Review on #1218 caught it: a mirror row whose TYPE
   is live but whose NAMED status is an approval queue is hidden by
   WL_PARKED_STATUSES, so a type-only classifier calls it visible. That is
   item 72's own headline shape -- VID-13491, "For Kasper approval" -- meaning
   the check would have missed the exact row that motivated it. Adding the named
   set immediately surfaced one more live row (VID-12983, natively `tweak`).
   Both sets are EXTRACTED from index.html here and compared as sets, rather
   than a handful of spot-checks, so neither can drift. */

const wlActive = grabFunc(INDEX, 'wlIsActiveStatus');
const setFrom = (src, re) => {
  const m = re.exec(src);
  if (!m) return null;
  return new Set((m[1].match(/'([^']*)'/g) || []).map(v => v.slice(1, -1)));
};
const pageNamed = setFrom(INDEX, /const WL_PARKED_STATUSES = new Set\(\[([\s\S]*?)\]\);/);
const checkNamed = setFrom(SRC, /const PARKED_STATUSES = new Set\(\[([\s\S]*?)\]\);/);
ok(!!pageNamed && !!checkNamed, 'both named parked-status sets were located');
const sameSet = (a, b) => a && b && a.size === b.size && [...a].every(v => b.has(v));
ok(sameSet(pageNamed, checkNamed),
  `the check's named parked statuses match the page's WL_PARKED_STATUSES exactly (${pageNamed ? pageNamed.size : '?'} terms) — a check with its own idea of "live" measures nothing`);
ok(pageNamed && pageNamed.has('for kasper approval'),
  "including 'for kasper approval', which is the status item 72's headline row sits in");

/* The TYPE set is asserted the same way. */
const checkTypes = setFrom(SRC, /const PARKED_TYPES = new Set\(\[([\s\S]*?)\]\);/);
['completed', 'canceled', 'duplicate', 'triage'].forEach(t => {
  ok(new RegExp("'" + t + "'").test(wlActive) && checkTypes && checkTypes.has(t),
    `type \`${t}\` is parked in BOTH the page and the check`);
});
ok(/backlog/i.test(wlActive) && checkTypes && checkTypes.has('backlog'),
  'and Backlog too, per the 2026-08-23 owner ruling that it is not work anyone is holding');

/* ---- 2. Every way the mirror hides a live row -------------------------- */

const live = { active: true, is_sub_issue: true, status: 'Todo', status_type: 'unstarted' };
ok(hides(live) === '',
  'a row that is active, a sub-issue and unstarted is VISIBLE — the check does not cry wolf on healthy work');
ok(hides(null) === 'no workload row at all',
  'NEVER IMPORTED: no mirror row at all is its own class — measured at 7 real rows aged 17-150h against a mirror synced 20 minutes prior, so it is not sync lag');
ok(hides({ ...live, active: false }) === 'active=false',
  'MIRROR SAYS INACTIVE: item 72\'s class — the row exists and the retired system calls it dead');
ok(hides({ ...live, is_sub_issue: false }) === 'is_sub_issue=false',
  'and a row the mirror denies is a sub-issue is hidden too');
ok(/parked/.test(hides({ ...live, status_type: 'backlog' })),
  'a Backlog-TYPE row is parked whatever its column is called');
ok(/parked/.test(hides({ ...live, status: 'Backlog', status_type: 'unstarted' })),
  'and a column literally named Backlog is caught even when its type is not');
ok(/parked status/.test(hides({ ...live, status: 'For Kasper approval', status_type: 'started' })),
  'PARKED BY NAME: an approval queue whose TYPE is still live is hidden — the shape item 72 leads with, and the one the first version of this check missed entirely');
ok(/parked status/.test(hides({ ...live, status: 'Posted', status_type: 'started' }))
  && /parked status/.test(hides({ ...live, status: 'Approved', status_type: 'unstarted' })),
  'and so are the finished states, whose type is often not terminal either');
ok(hides({ ...live, active: false, is_sub_issue: false }) === 'active=false + is_sub_issue=false',
  'two reasons are reported together rather than the first one found — the cause matters for the repair');

/* ---- 3. The narrowing that keeps the number honest --------------------- */

ok(/if \(!String\(row\.raw_issue_parent_id \|\| ''\)\.trim\(\)\) \{ batchParents\+\+; continue; \}/.test(SRC),
  'A ROW WITH NO NATIVE PARENT IS A POST, not assignable work, and is excluded — 81 of the 86 apparent drops are exactly this, and counting them would bury the real 5');
ok(/if \(row\.raw_issue_archived_at \|\| row\.raw_issue_canceled_at\)/.test(SRC),
  'archived and canceled rows are excluded — nothing reconciles their native status, so they are stale natively rather than hidden');
ok(/const TEST_CLIENT/.test(SRC) && /h\.client !== TEST_CLIENT/.test(SRC),
  'the test client is reported but never gated — it is mutated by drills on purpose, and gating on it would ring for work nobody is owed');
ok(/process\.exit\(failed \? 1 : 0\)/.test(SRC),
  'and it exits non-zero above the baseline, so it can gate rather than only inform');
ok(/--json/.test(SRC) && /no writes/i.test(SRC),
  'read-only, with a --json mode for a caller that wants the rows');

/* ---- 4. The cause column ---------------------------------------------- */

/* A count without a cause gets read once and filed. Item 98 ended with the
   question open -- "why B1 skipped seven live graphics issues for six days is
   not answered here" -- and the answer was three queries away: B1 skipped
   nothing. All seven were TRASHED IN LINEAR 15-47 seconds after the mirror
   created the issue there, and `workload_issues` is rebuilt from a Linear query
   that does not return a trashed issue, so the row never entered the cache.
   Running the same lookup over BOTH classes, 12 of the 13 gated rows carry a
   recorded deletion -- 7 trashed, 5 with an explicit `mirror_in_delete` -- so
   "mirror says inactive" and "never imported" are ONE defect, separated only by
   whether a sync happened to run in between. The check now says so per row. */

ok(/action=in\.\(foreign_write_detected,mirror_in_delete,mirror_in_restore\)/.test(SRC),
  'the check reads BOTH deletion signatures — a `trashed: true` webhook snapshot and an explicit mirror_in_delete — and RESTORES alongside them');

/* Executed, not read. */
const trashEvent = (id, ts, createdAt) => ({ deliverable_id: id, ts, action: 'foreign_write_detected',
  payload: { issue: { trashed: true, createdAt } } });
const deleteEvent = (id, ts) => ({ deliverable_id: id, ts, action: 'mirror_in_delete', payload: {} });
const restoreEvent = (id, ts) => ({ deliverable_id: id, ts, action: 'mirror_in_restore', payload: {} });

{
  const folded = foldDeletionEvents([
    trashEvent('d1', '2026-08-28T13:20:06Z', '2026-08-28T13:19:47Z'),
    deleteEvent('d2', '2026-08-28T14:00:00Z'),
    { deliverable_id: 'd3', ts: '2026-08-28T14:00:00Z', action: 'foreign_write_detected', payload: { issue: { trashed: false } } },
  ]);
  ok(folded.get('d1') && /trashed in Linear 19s after the mirror created it/.test(folded.get('d1').label),
    'a trashed snapshot carries the gap between the mirror creating the issue and it disappearing — 19 seconds is the evidence that this is not somebody tidying up days later');
  ok(folded.get('d2') && folded.get('d2').label === 'deleted in Linear',
    'an explicit mirror_in_delete is recorded as its own label');
  ok(!folded.has('d3'),
    'and a foreign write that is NOT a deletion is not one — the whole point is to name a cause, not to label every foreign write');
}
{
  /* THE CASE REVIEW ON #1223 RAISED, and it is real rather than hypothetical:
     `mirror_in_restore` exists in this estate. */
  const folded = foldDeletionEvents([
    trashEvent('d1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    restoreEvent('d1', '2026-08-02T00:00:00Z'),
  ]);
  ok(!folded.has('d1'),
    'A DELETION FOLLOWED BY A RESTORE LEAVES NO CAUSE — labelling a restored row with its oldest deletion sends the reader at the wrong repair');
  const again = foldDeletionEvents([
    trashEvent('d1', '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
    restoreEvent('d1', '2026-08-02T00:00:00Z'),
    deleteEvent('d1', '2026-08-03T00:00:00Z'),
  ]);
  ok(again.get('d1') && again.get('d1').label === 'deleted in Linear',
    'and a deletion AFTER the restore is the cause again — last event wins, because the current state is what a reader is about to act on');
}
{
  const deletions = new Map([['x', { label: 'deleted in Linear', ts: '2026-08-01T00:00:00Z' }]]);
  const absent = { id: 'x', why: 'no workload row at all' };
  const inactive = { id: 'x', why: 'active=false' };
  const parked = { id: 'x', why: 'parked status (For Kasper approval)' };
  attachCauses([absent, inactive, parked], deletions);
  ok(absent.cause === 'deleted in Linear' && inactive.cause === 'deleted in Linear',
    'a deletion explains the two states a deletion actually produces: no mirror row at all, and active=false');
  ok(!parked.cause && /history rather than the cause/.test(parked.note || ''),
    'A DELETION DOES NOT EXPLAIN A ROW PARKED BY NAME — a deletion cannot move a status into an approval queue, and a confident wrong cause is worse than none');
  ok(/deleted in Linear/.test(parked.note || ''),
    'but it is kept as HISTORY rather than dropped, so nothing goes quiet');
}
ok(/issue\.trashed === true/.test(SRC),
  'trashed is read from the webhook snapshot the event already stored, so no Linear call is added to a check whose whole safety property is that it makes none');
ok(/deliverable_id=in\.\(\$\{hiddenIds\.join\(','\)\}\)/.test(SRC),
  'BOUNDED TO THE ROWS ALREADY FOUND HIDDEN — a dozen or so in one request, not a sweep of every event in the estate');
ok(/NOT exported/.test(SRC) && !/module\.exports/.test(SRC),
  'and the script exports nothing — it ends in a top-level async IIFE that reads the estate and calls process.exit, so a require() would RUN it; this suite lifts the functions from the source instead');
ok(/catch \(err\) \{\s*\n\s*diagnosisError = String\(err && err\.message \|\| err\);/.test(SRC)
  && /cause_lookup_error: diagnosisError/.test(SRC),
  'and it FAILS SOFT: a diagnosis is worth having and never worth turning a working gate red over, so a lookup failure is caught, reported, and the counts stand');
ok(/let diagnosisError = null;/.test(SRC) && /cause lookup unavailable this run/.test(SRC),
  'a failed lookup SAYS SO in the human output too — a silently missing cause column reads as "no cause found"');
ok(/s after the mirror created it/.test(SRC),
  'the label carries the gap between the issue being created and being deleted, which is the whole evidence that this is not a person tidying up days later');
ok(/OPEN_REPAIRS items 95 and 98/.test(SRC),
  'and it points at the two entries that own the mechanism, so the reader does not have to rediscover them');
ok(!/process\.exit\(2\)[\s\S]{0,80}diagnosis/.test(SRC) && /gated_count/.test(SRC),
  'the gate still turns on the count alone — a cause is context for a human, never a reason to pass or fail');

console.log(failures === 0
  ? '\nworkload native visibility checks passed'
  : '\n' + failures + ' workload native visibility check(s) failed');
process.exit(failures === 0 ? 0 : 1);
