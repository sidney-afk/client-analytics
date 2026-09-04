'use strict';
/*
 * A deliverable marked `duplicate` cannot be mirrored, and pretending otherwise
 * cost a permanent false alarm.
 *
 * MEASURED 2026-09-02, from the live mirror_outbox the owner read out:
 *
 *   team      graphics
 *   operation status
 *   attempts  8          <- MAX_ATTEMPTS
 *   error     "Linear GraphQL HTTP 200 invalid input: missing duplicate relation"
 *
 * MECHANISM. Native `duplicate` maps to Linear's "Duplicate" workflow state
 * (linear-outbound/mapping.mjs). Linear's API refuses a move into a
 * duplicate-type state unless the same mutation carries the RELATION naming the
 * issue being duplicated. SyncView has no such column and no UI that asks for
 * one, so the mutation is structurally unsendable -- not transiently failing.
 *
 * WHY IT MATTERED MORE THAN ONE ROW. The drainer skips anything at
 * MAX_ATTEMPTS, while oldestPendingMinutesByTeam deliberately does NOT filter
 * on attempts ("retry-exhausted failed rows must age into the pager instead of
 * disappearing from monitoring"). So the row parks forever AND keeps ageing --
 * it read 28 hours old and climbing, and was the whole of a two-consecutive-red
 * `SyncView Linear outbound drain` failure, which is a GATING item in
 * PRE_FLIP_HEALTH_CHECK.md 9a. Status writes to `duplicate` run about twelve a
 * month (52 since late July), so this recurs.
 *
 * SKIPPED, NOT FAILED. Skipping records what is true -- this write has no
 * Linear counterpart it is permitted to make -- and costs nothing: SyncView has
 * been authoritative for both teams since 2026-08-28, so Linear is a mirror,
 * and the mirror keeps its previous state. Failing buys the identical outcome
 * plus eight pointless API calls and an unclearable alarm.
 *
 * NOT remapped to `Canceled`: that writes a state the person did not choose,
 * and a wrong state is worse than a stale one.
 */
const fs = require('fs');
const path = require('path');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'index.ts'), 'utf8');
const MAPPING = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'mapping.mjs'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
const stripped = stripBlockComments(SRC, ' ')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

/* ---- 1. The premise: the mapping really does send Duplicate -------------- */

ok(/duplicate:\s*"Duplicate"/.test(MAPPING),
  'the premise holds: native `duplicate` maps to Linear\'s "Duplicate" state, which is the state Linear refuses without a relation');

/* ---- 2. The guard exists, is scoped, and SKIPS ------------------------- */

const guard = /if \(!f27Replay\s*\n?\s*&& row\.operation === "status"\s*\n?\s*&& clean\(parseJson\(row\.payload\)\.status\) === "duplicate"\) \{([\s\S]*?)\n      \}/.exec(stripped);
ok(!!guard, 'a guard matches exactly a STATUS write whose payload status is `duplicate` (and only outside the F27 replay lane — see section 6)');
const body = guard ? guard[1] : '';
ok(/status: "skipped"/.test(body),
  'and it SKIPS — recording that the write has no Linear counterpart it may make');
ok(!/counts\.failed\+\+/.test(body),
  'it does NOT count as a failure — a failure is a claim that retrying could work, and it cannot');
ok(/counts\.skipped\+\+/.test(body),
  'it counts as skipped, so the summary reports it honestly rather than silently');
ok(/last_error: null/.test(body),
  'and clears last_error — leaving Linear\'s message there would keep the row looking broken');
ok(/linear_state_unsendable/.test(body) && /duplicate_requires_relation/.test(body),
  'the reason is machine-readable in linear_result, so a later reader does not have to re-derive it');
ok(/processed_at: new Date\(\)\.toISOString\(\)/.test(body),
  'and it is stamped processed, which is what takes it out of the pending population the pager ages');

/* ---- 3. It runs BEFORE anything reaches Linear -------------------------- */

const guardAt = stripped.indexOf('=== "duplicate")');
const entityAt = stripped.indexOf('const entity = await entityRow(supabase, row);');
ok(guardAt > -1 && entityAt > guardAt,
  'THE GUARD IS BEFORE the entity read — so a row that can never be sent costs no lookup and no Linear call, which is the whole point');

/* ---- 4. It cannot leak past `duplicate` -------------------------------- */

['canceled', 'posted', 'approved', 'todo', 'tweak'].forEach(other => {
  ok(!new RegExp('=== "' + other + '"\\)\\s*\\{[\\s\\S]{0,200}status: "skipped"').test(stripped),
    `no other status is skipped by this guard — \`${other}\` still mirrors normally`);
});
ok(/row\.operation === "status"/.test(stripped),
  'and it is scoped to the status operation, so a comment or attachment on the same deliverable is untouched');

/* ---- 5. The same principle for an issue Linear no longer has ----------- */

/* The other two stuck rows had a different cause and the same shape: Linear
   answers `Entity not found: Issue` for an issue DELETED there, SyncView still
   holds its uuid and calls the row clean, so every write it owes fails
   identically, burns eight attempts and parks where oldest-pending keeps ageing
   it. Measured 2026-09-02: both rows named VID-13649, which the Linear-derived
   mirror has no row for at all. */

const catchBlock = /const notFound = [\s\S]*?\n        continue;\n      \}/.exec(stripped);
ok(!!catchBlock, 'the terminal catch recognises a deleted Linear issue');
const cb = catchBlock ? catchBlock[0] : '';
ok(/entity not found:\\s\*issue/i.test(cb) || /entity not found/i.test(cb),
  'matched on Linear\'s own message rather than a status code, which it does not vary');
ok(/status: "skipped"/.test(cb) && /next_retry_at: null/.test(cb),
  'and it stops retrying immediately instead of spending eight attempts to learn the issue is still gone');
ok(/linear_entity_deleted/.test(cb) && /issue_not_found/.test(cb),
  'recording the decision machine-readably');
ok(/item 95/.test(SRC),
  'and pointing at OPEN_REPAIRS item 95, which owns the dangling link itself');
ok(!/linear_issue_uuid.*null/.test(cb) && !/update\(/.test(cb),
  'IT DOES NOT CLEAR THE DANGLING UUID: quietly repairing the link from inside the drainer would destroy the evidence item 95 needs while looking like a fix');
ok(/&& !f27Replay/.test(cb),
  'and the F27 replay lane keeps its own terminal handling, which must stay correlated');

/* ---- 6. The duplicate guard is exempt during an F27 replay ------------- */

/* Raised by review on #1219. The deleted-issue branch already carried
   `&& !f27Replay` and this one did not. F27 is the owner-scoped emergency
   rollback lane: an owner-classified intent must reach its own correlated
   terminal receipt through that lane's handling, so terminalizing it here with
   an unbound linear_result would leave the rollback unable to finalize. The
   asymmetry is the bug — two branches doing the same kind of work must agree
   about the lane they are running in. */

ok(/&& !f27Replay/.test(cb) && /!f27Replay\s*\n?\s*&& row\.operation === "status"/.test(stripped),
  'BOTH terminal branches now agree: neither the duplicate guard nor the deleted-issue catch terminalizes an F27 replay row');
ok(/if \(!f27Replay/.test(stripped) && /if \(notFound && !f27Replay\)/.test(stripped),
  'and both spell the lane check the same way, so grepping `!f27Replay` finds every place a row is terminalized outside the replay lane');

/* ---- 7. And the guards are actually REACHABLE by the rows they are for -- */

/* THE FIX THAT DID NOT FIX ANYTHING. Also raised by review on #1219: readRows
   drops every row at MAX_ATTEMPTS before the loop, and all three live rows were
   already at 8. So the guards above applied only to writes made from now on,
   while the three that raised the alarm went on ageing into the pager forever.
   isUnsendableRow admits exactly those two measured shapes past the ceiling so
   they reach the guards that terminalize them -- one path, not a second
   divergent cleanup. */

ok(/function isUnsendableRow\(/.test(SRC),
  'a single shared predicate names what "Linear can never accept this" means');
ok(/\.filter\(row => f27Replay \|\| Number\(row\.attempts \|\| 0\) < MAX_ATTEMPTS \|\| isUnsendableRow\(row\)\)/.test(stripped),
  'THE ADMISSION FILTER USES IT — without this the guards are unreachable for the very rows that motivated them');

/* Behavioural, not textual: extract the predicate and run it. */
const fnSrc = (() => {
  const start = SRC.indexOf('function isUnsendableRow(');
  if (start < 0) return null;
  const end = SRC.indexOf('\n}', start);
  return end < 0 ? null : SRC.slice(start, end + 2).replace(/: OutboxRow/g, '').replace(/: boolean/g, '');
})();
ok(!!fnSrc, 'the predicate can be lifted out and executed rather than only pattern-matched');

if (fnSrc) {
  const clean = v => String(v == null ? '' : v).trim();
  const parseJson = v => { if (!v) return {}; if (typeof v === 'object' && !Array.isArray(v)) return v;
    try { const p = JSON.parse(String(v)); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; } catch (_e) { return {}; } };
  // eslint-disable-next-line no-new-func
  const isUnsendableRow = new Function('clean', 'parseJson', fnSrc + '; return isUnsendableRow;')(clean, parseJson);

  ok(isUnsendableRow({ operation: 'status', payload: { status: 'duplicate' }, last_error: null }) === true,
    'the measured graphics row (status -> duplicate, 8 attempts) is admitted past the ceiling');
  ok(isUnsendableRow({ operation: 'status', payload: '{"status":"duplicate"}', last_error: null }) === true,
    'and so is the same row when the payload arrives as a JSON string, which is how PostgREST returns jsonb');
  ok(isUnsendableRow({ operation: 'status', payload: {}, last_error: 'Linear GraphQL HTTP 200 Entity not found: Issue' }) === true,
    'the two VID-13649 rows are admitted on Linear\'s own deleted-issue message');
  ok(isUnsendableRow({ operation: 'comment', payload: {}, last_error: 'entity not found: issue - argh' }) === true,
    'the deleted-issue shape is matched case-insensitively and on any operation, because a deleted issue takes every write with it');

  /* The narrowness is the safety property. */
  ok(isUnsendableRow({ operation: 'status', payload: { status: 'posted' }, last_error: 'Linear GraphQL HTTP 500' }) === false,
    'AN ORDINARY EXHAUSTED FAILURE IS NOT RESURRECTED — a 500 stopped by the ceiling stays stopped, which is what the ceiling is for');
  ok(isUnsendableRow({ operation: 'status', payload: { status: 'canceled' }, last_error: null }) === false,
    'no other status is admitted');
  ok(isUnsendableRow({ operation: 'comment', payload: { status: 'duplicate' }, last_error: null }) === false,
    'and the duplicate shape stays scoped to the status operation — a comment carrying that word is not special');
  ok(isUnsendableRow({ operation: 'status', payload: {}, last_error: 'Entity not found: Project' }) === false,
    'a different missing entity is not the deleted-issue case and is left to the ordinary ceiling');
  ok(isUnsendableRow({ operation: 'status', payload: {}, last_error: null }) === false,
    'and a row with no error at all is not unsendable, so nothing is admitted merely for being old');
}

console.log(failures === 0
  ? '\noutbound unsendable-write checks passed'
  : '\n' + failures + ' outbound duplicate-state check(s) failed');
process.exit(failures === 0 ? 0 : 1);
