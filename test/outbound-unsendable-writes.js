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

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'index.ts'), 'utf8');
const MAPPING = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'linear-outbound', 'mapping.mjs'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
const stripped = SRC
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');

/* ---- 1. The premise: the mapping really does send Duplicate -------------- */

ok(/duplicate:\s*"Duplicate"/.test(MAPPING),
  'the premise holds: native `duplicate` maps to Linear\'s "Duplicate" state, which is the state Linear refuses without a relation');

/* ---- 2. The guard exists, is scoped, and SKIPS ------------------------- */

const guard = /if \(row\.operation === "status"\s*\n?\s*&& clean\(parseJson\(row\.payload\)\.status\) === "duplicate"\) \{([\s\S]*?)\n      \}/.exec(stripped);
ok(!!guard, 'a guard matches exactly a STATUS write whose payload status is `duplicate`');
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

console.log(failures === 0
  ? '\noutbound unsendable-write checks passed'
  : '\n' + failures + ' outbound duplicate-state check(s) failed');
process.exit(failures === 0 ? 0 : 1);
