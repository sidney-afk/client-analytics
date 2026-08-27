'use strict';
/*
 * A stuck-attribution report is only worth reading if it separates the row a
 * person is waiting on from the ninety that are history.
 *
 * The failure this guards against is the one the card-linkage leak report
 * already demonstrated: a single headline count that keeps a stale number alive
 * for weeks because it blends a live problem with old debris. Measured
 * 2026-08-22 there were 92 unresolved rows, 90 repairable, 87 of them live —
 * and exactly TWO that an active client was waiting on. A report that printed
 * "87" would have been true and useless.
 *
 * What is pinned, all EXECUTED against the real classifier:
 *   1. a row is repairable only when its project maps to EXACTLY one client;
 *      two claimants is ambiguous and must never be resolved by picking one;
 *   2. both stored shapes of `linear_project_ids` are read — the older array
 *      and the per-team object — because reading one would report half the
 *      roster as unmapped;
 *   3. "an active client is waiting" excludes terminal rows, former clients and
 *      test fixtures, and counts nothing else;
 *   4. a row with no project is never guessed at.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.ATTRIBUTION_CHECK_SRC || path.join(ROOT, 'scripts', 'attribution-stuck-check.js');
const { classify, buildProjectOwners, buildLiveClients, projectIdsFor, TERMINAL } = require(SRC);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(typeof classify === 'function' && typeof buildProjectOwners === 'function',
  'the real classifier loads and runs (harness is not vacuous)');

const NOW = Date.parse('2026-08-22T06:00:00Z');
const P_ACTIVE = 'proj-active';
const P_FORMER = 'proj-former';
const P_TEST = 'proj-test';
const P_SHARED = 'proj-shared';
const P_ORPHAN = 'proj-orphan';

const CLIENTS = [
  // The per-team object shape.
  { slug: 'activeclient', active: true, kind: 'client', linear_project_ids: { video: P_ACTIVE, graphics: P_ACTIVE } },
  // The older array shape. Reading only one of the two would break this row.
  { slug: 'formerclient', active: false, kind: 'client', linear_project_ids: [P_FORMER] },
  { slug: 'testfixture', active: false, kind: 'test', linear_project_ids: [P_TEST] },
  // Two clients claiming one project — a real possibility, never guessed at.
  { slug: 'twinone', active: true, kind: 'client', linear_project_ids: [P_SHARED] },
  { slug: 'twintwo', active: true, kind: 'client', linear_project_ids: [P_SHARED] },
  { slug: 'noprojects', active: true, kind: 'client', linear_project_ids: null },
];

ok(projectIdsFor(CLIENTS[0]).length === 1 && projectIdsFor(CLIENTS[0])[0] === P_ACTIVE,
  'the per-team object shape yields its project id');
ok(projectIdsFor(CLIENTS[1])[0] === P_FORMER, 'the older array shape does too');
ok(projectIdsFor(CLIENTS[5]).length === 0 && projectIdsFor(null).length === 0,
  'a client with no projects yields none rather than throwing');

const owners = buildProjectOwners(CLIENTS);
ok(owners.get(P_ACTIVE).length === 1, 'a project claimed once has one claimant');
ok(owners.get(P_SHARED).length === 2, 'a project claimed twice keeps BOTH claimants');
ok(!owners.has(P_ORPHAN), 'a project nobody claims is absent');

const waiting = buildLiveClients(CLIENTS);
ok(waiting.has('activeclient'), 'an active client of kind client counts as waiting');
ok(!waiting.has('formerclient'), 'a former client does not');
ok(!waiting.has('testfixture'), 'a test fixture does not, even though it is a roster row');

function row(over) {
  return Object.assign({
    id: 'del_x', linear_identifier: 'GRA-1', team: 'graphics', status: 'kasper_approval',
    client_slug: 'unattributed', updated_at: '2026-08-18T06:00:00Z',
    raw_project_id: P_ACTIVE, raw_attribution_state: 'needs_attribution',
    raw_attribution_reason: 'project_or_parent_changed_reconcile_required',
    raw_attribution_client_slug: 'activeclient',
  }, over || {});
}

// 1. A resolved row is not this report's business at all.
let out = classify([row({ raw_attribution_state: 'resolved' })], owners, NOW, waiting);
ok(out.counts.repairable.total === 0, 'a resolved row is skipped entirely');
out = classify([row({ raw_attribution_state: '' })], owners, NOW, waiting);
ok(out.counts.repairable.total === 0, 'so is a row carrying no attribution stamp');

// 1b. A row whose slug was REPAIRED (the 2026-08-27 owner SQL) has an owner
// again, whatever the imported payload still says — it goes to the watchlist,
// never back into repairable, or the report reads 84-stuck the minute after
// the repair lands. The unattributed default and the needs_attribution
// placeholder both still count as ownerless.
out = classify([row({ client_slug: 'formerclient' })], owners, NOW, waiting);
ok(out.counts.repairable.total === 0 && out.counts.repaired_state_stale.total === 1,
  'a repaired slug moves the row to the repaired_state_stale watchlist');
out = classify([row({ client_slug: 'needs_attribution' })], owners, NOW, waiting);
ok(out.counts.repairable.total === 1 && out.counts.repaired_state_stale.total === 0,
  'while the needs_attribution placeholder is still ownerless, still repairable');

// 2. THE ONE THAT MATTERS. Live, active client, project maps to exactly one.
out = classify([row()], owners, NOW, waiting);
ok(out.counts.repairable.total === 1 && out.counts.repairable.owner_waiting === 1,
  'a live row for an active client is counted as somebody waiting');
const e = out.buckets.repairable[0];
ok(e.resolves_to === 'activeclient', 'and it names who it resolves to');
ok(e.previous_client === 'activeclient', 'while keeping what it used to say, so a change of owner is visible');
ok(e.days_stuck === 4, 'and how long it has been sitting (got ' + e.days_stuck + ')');

// 3. The bulk that must NOT inflate the headline.
out = classify([
  row({ resolves: 1, raw_project_id: P_FORMER }),
  row({ raw_project_id: P_TEST }),
], owners, NOW, waiting);
ok(out.counts.repairable.total === 2 && out.counts.repairable.live === 2,
  'former-client and test rows are still counted — they do inflate attribution numbers');
ok(out.counts.repairable.owner_waiting === 0,
  'but nobody is waiting on them, and the headline says so');

// 4. Terminal rows are counted, never treated as somebody waiting.
for (const status of [...TERMINAL]) {
  const t = classify([row({ status })], owners, NOW, waiting);
  ok(t.counts.repairable.total === 1 && t.counts.repairable.live === 0 && t.counts.repairable.owner_waiting === 0,
    'a ' + status + ' row is counted but nobody is waiting on it');
}

// 5. Ambiguity is never resolved by picking one.
out = classify([row({ raw_project_id: P_SHARED })], owners, NOW, waiting);
ok(out.counts.ambiguous.total === 1 && out.counts.repairable.total === 0,
  'a project two clients claim is ambiguous, not repairable');
ok(out.buckets.ambiguous[0].resolves_to === null && out.buckets.ambiguous[0].claimants.length === 2,
  'and it names both claimants rather than choosing');
ok(out.counts.ambiguous.owner_waiting === 0,
  'an ambiguous row is never reported as somebody waiting, however live it is');

// 6. An unclaimed project is the real backlog: a human must map it first.
out = classify([row({ raw_project_id: P_ORPHAN })], owners, NOW, waiting);
ok(out.counts.unmapped_project.total === 1 && out.counts.repairable.total === 0,
  'a project no client claims needs a mapping, not a repair');

// 7. No project at all is never guessed at from anything else.
out = classify([row({ raw_project_id: '' })], owners, NOW, waiting);
ok(out.counts.no_project.total === 1 && out.counts.repairable.total === 0,
  'a row with no project is set aside, not attributed from its previous value');
ok(out.buckets.no_project[0].previous_client === 'activeclient',
  'even though the previous value is right there — it is reported, not applied');

// 8. Oldest first, so the thing that has been ignored longest reads first.
out = classify([
  row({ id: 'a', updated_at: '2026-08-21T06:00:00Z' }),
  row({ id: 'b', updated_at: '2026-08-01T06:00:00Z' }),
  row({ id: 'c', updated_at: '2026-08-15T06:00:00Z' }),
], owners, NOW, waiting);
ok(out.buckets.repairable.map(x => x.id).join(',') === 'b,c,a',
  'the longest-stuck row is listed first (got ' + out.buckets.repairable.map(x => x.id).join(',') + ')');

// 9. Degenerate inputs report nothing rather than throwing.
ok(classify([], owners, NOW, waiting).counts.repairable.total === 0
  && classify(undefined, owners, NOW, waiting).counts.repairable.total === 0,
  'an empty or missing row set reports zero');
ok(classify([row()], owners, NOW, undefined).counts.repairable.owner_waiting === 0,
  'with no roster to check against, nothing is claimed to be waited on');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
