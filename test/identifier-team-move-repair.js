'use strict';
/*
 * The 2026-09-07 data repair, held to the shape it was reviewed at.
 *
 * OPEN_REPAIRS 161. `deliverables.identifier` is a snapshot the b1 import took
 * and nothing maintains; a Linear team move re-keys the issue, so seven rows
 * carry a VID- number for work that lives on the Graphics team. The browser
 * already ignores the snapshot (test/prod-deep-link-linear-identifier.js);
 * this file is about the statement that repairs the DATA, which the owner runs
 * by hand in the SQL Editor.
 *
 * WHY A TEST FOR A ONE-SHOT FILE. It is a direct write on the table every other
 * write goes through a gateway to reach, so the only things standing between it
 * and a much larger blast radius are one bounded cohort and one SET column. A
 * later session re-running it after widening a clause would not be caught by
 * anything else in the suite: nothing else in the repository reads this file.
 * These assertions are that reader.
 *
 * AND THREE PROPERTIES THE REVIEW ADDED (Codex on #1333):
 *
 *   1. The update makes the two columns agree, which empties the browser's
 *      `aliasId` for these rows -- so the repair is also the moment the retired
 *      identifier would stop existing anywhere. It is recorded in
 *      `deliverable_events` in the same statement, and the count guard makes
 *      "no column moves without its record" a mechanism rather than a promise.
 *   2. Two statements under READ COMMITTED take two snapshots, so a
 *      `linear-inbound` write landing between them could repair a row the
 *      ledger does not describe. The cohort is selected ONCE, `for update`, and
 *      both writes read it.
 *   3. An issue that cycles between teams can be repaired twice, so the event
 *      key must distinguish occurrences instead of colliding with the row's own
 *      earlier repair.
 *
 * It deliberately does NOT execute SQL. The F63 gate is the only suite allowed
 * a database, the repair is applied once by a person, and a mock Postgres would
 * prove the statement runs rather than that it is narrow.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'migrations',
  '2026-09-07-deliverable-identifier-team-move-repair.sql');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(fs.existsSync(FILE), 'the repair file is where OPEN_REPAIRS 161 says it is');
const SQL = fs.readFileSync(FILE, 'utf8');
const code = SQL.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
ok(code.trim().length > 0,
  'the file carries statements and not only prose (a comment-only file would pass every check below vacuously)');

/* ---- 1. What may write, and to what ------------------------------------ */

['delete', 'drop', 'truncate', 'alter', 'grant', 'revoke', 'create'].forEach(verb => {
  ok(!new RegExp('\\b' + verb + '\\b', 'i').test(code),
    'no ' + verb.toUpperCase() + ' anywhere — this is data only: no schema change, no grant, no function, nothing to deploy');
});
const inserts = code.match(/insert\s+into\s+[a-z_.]+/gi) || [];
ok(inserts.length === 1 && /public\.deliverable_events/i.test(inserts[0]),
  'exactly one INSERT, and it writes the append-only event ledger — never a column anything matches on (`linear_aliases` is flattened and card-matched by b3-linkage-backfill)');
const updates = code.match(/update\s+public\.[a-z_]+/gi) || [];
ok(updates.length === 1 && /public\.deliverables/i.test(updates[0]),
  'exactly one UPDATE, on `deliverables`, named in full so it cannot resolve elsewhere through a search_path');
const setClause = (code.match(/^\s*set\s+([^\n]*)/mi) || [])[1] || '';
ok(/^identifier = c\.linear_identifier\s*$/.test(setClause.trim()),
  'it sets `identifier` from the cohort\'s `linear_identifier` and touches no other column — status, client, batch, card linkage and every Linear column are out of range');

/* ---- 2. One cohort, selected once, locked, and bounded ----------------- */

const cohort = code.slice(code.search(/with cohort as/i), code.search(/recorded as/i));
ok(/from public\.deliverables d/i.test(cohort), 'the cohort is the thing that reads `deliverables`');
[
  [/d\.identifier is not null/i, 'a row with no snapshot is never touched, which is every natively created row'],
  [/d\.linear_identifier is not null/i, 'a row with no Linear identifier is never given one'],
  [/d\.identifier <> d\.linear_identifier/i, 'only rows that actually DISAGREE — which is also what makes it idempotent, since afterwards the cohort is empty'],
].forEach(([re, why]) => {
  ok(re.test(cohort), 'the cohort is bounded: ' + why);
});
ok(/for update/i.test(cohort),
  'and it is locked FOR UPDATE — under READ COMMITTED an unlocked cohort lets a concurrent linear-inbound write land between the reads (review #1333)');
ok(!/\blimit\b/i.test(cohort) && !/\bin\s*\(/i.test(cohort),
  'expressed as a condition rather than a hardcoded list of ids, so it repairs the rows that have the defect rather than the rows someone remembered');

const begin = code.search(/^\s*begin;/mi);
const commit = code.search(/^\s*commit;/mi);
const step2 = code.slice(begin, commit);
const insertAt = step2.search(/insert\s+into/i);
const updateAt = step2.search(/update\s+public\.deliverables/i);
ok(insertAt > 0 && updateAt > insertAt, 'step 2 carries the insert and then the update');
ok(/from cohort c/i.test(step2.slice(insertAt, updateAt)),
  'the insert reads the cohort rather than re-querying the table');
ok(/from cohort c/i.test(step2.slice(updateAt)),
  'and so does the update — one predicate, evaluated once, so the two writes cannot see different rows');
ok((step2.match(/identifier <> d\.linear_identifier/gi) || []).length === 1,
  'the predicate appears exactly once in step 2: a second copy is a second chance to drift');

/* ---- 3. The record, and that it cannot be skipped ---------------------- */

ok(/'retired_identifier', c\.identifier/.test(code) && /'current_identifier', c\.linear_identifier/.test(code),
  'the event carries the retired identifier and the one replacing it — after the repair this is the only place the old name exists, since the columns then agree and `aliasId` empties');
ok(/'identifier_team_move_repair'/.test(code),
  'and names the operation, so the reversal query can find its own rows');
ok(/\(select count\(\*\) from recorded\) = \(select count\(\*\) from cohort\)/i.test(code),
  'the update is gated on the ledger insert having covered the whole cohort — "no column moves without its record" as a mechanism, not a promise');
ok(/clock_timestamp\(\)/i.test(code) && /'->'/.test(code),
  'the event key carries the moment and both identifiers, so an issue that cycles between teams and is repaired twice gets a distinct key instead of colliding with its own earlier repair (review #1333)');
ok(begin >= 0 && commit > begin, 'both writes are inside one explicit transaction');

/* ---- 4. Verifiable before, and proved after ---------------------------- */

ok(/collides_with/.test(code),
  'step 1 surfaces a unique-constraint collision BEFORE the repair, since `identifier` is `text unique` and a collision aborts the whole transaction');
ok(/order by/i.test(code),
  'and step 1 is ordered, so its output is a stable record of the old values before the fact, as the repair events are after it');
const step3 = code.slice(commit);
ok(/still_disagreeing/.test(step3) && /identifier_duplicates/.test(step3),
  'step 3 proves the outcome both ways: nothing left disagreeing, and no duplicate identifier created');
ok(/retired_identifier/.test(step3),
  'and reads the repair events back, so the record is verified to exist rather than assumed');

/* ---- 5. The claims the file makes about itself ------------------------- */

ok(/updated_at/.test(SQL) && /status_at/.test(SQL),
  'the file states what the touch trigger will and will not move');
ok(/rpc_bypass_guard/.test(SQL),
  'and that the ledger guard writes its own `update` event per row beside the explicit one');
ok(/ROLLBACK\.md/.test(SQL) && /REVERSAL/.test(SQL),
  'and points at the runbook entry while carrying the executable reversal inline (review #1333: a note that only SELECTs the old values is not a restoration procedure)');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nIdentifier team-move repair checks passed.');
