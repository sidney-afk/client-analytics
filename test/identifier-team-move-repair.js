'use strict';
/*
 * The 2026-09-07 data repair, held to the shape it was reviewed at.
 *
 * OPEN_REPAIRS 160. `deliverables.identifier` is a snapshot the b1 import took
 * and nothing maintains; a Linear team move re-keys the issue, so seven rows
 * carry a VID- number for work that lives on the Graphics team. The browser
 * already ignores the snapshot (test/prod-deep-link-linear-identifier.js);
 * this file is about the statement that repairs the DATA, which the owner runs
 * by hand in the SQL Editor.
 *
 * WHY A TEST FOR A ONE-SHOT FILE. It is a direct UPDATE on the table every
 * other write goes through a gateway to reach, so the only things standing
 * between it and a much larger blast radius are three predicates and one SET
 * column. A later session re-running it after widening a clause would not be
 * caught by anything else in the suite: nothing else in the repository reads
 * this file. These assertions are that reader.
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

ok(fs.existsSync(FILE), 'the repair file is where OPEN_REPAIRS 160 says it is');
const SQL = fs.readFileSync(FILE, 'utf8');
const code = SQL.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
ok(code.trim().length > 0, 'the file carries statements and not only prose (a comment-only file would pass every check below vacuously)');

/* ---- 1. One statement mutates, and it mutates one column --------------- */

const mutating = code.match(/\b(update|insert|delete|drop|truncate|alter|grant|revoke|create)\b/gi) || [];
ok(mutating.length === 1 && /update/i.test(mutating[0]),
  'exactly one mutating verb in the whole file, and it is an UPDATE — no schema change, no grant, no function, nothing to deploy');
ok(/update public\.deliverables d/.test(code),
  'it names the table in full, so it cannot be run against a search_path that resolves elsewhere');
const setClause = (code.match(/set\s+([^\n]*)/i) || [])[1] || '';
ok(/^identifier = d\.linear_identifier\s*$/.test(setClause.trim()),
  'it sets `identifier` from `linear_identifier` and touches no other column — status, client, batch, card linkage and every Linear column are out of range');

/* ---- 2. The three predicates that bound it ----------------------------- */

const update = code.slice(code.search(/update public\.deliverables/i));
ok(/where d\.identifier is not null/i.test(update),
  'bounded: a row with no snapshot is never touched, which is every natively created row');
ok(/and d\.linear_identifier is not null/i.test(update),
  'bounded: a row with no Linear identifier is never given one');
ok(/and d\.identifier <> d\.linear_identifier/i.test(update),
  'bounded to rows that actually DISAGREE — which is also what makes it idempotent, since after it runs the predicate matches nothing');
ok(!/\blimit\b/i.test(update) && !/\bin\s*\(/i.test(update),
  'and it is expressed as a condition rather than a hardcoded list of ids, so it repairs the rows that have the defect rather than the rows someone remembered');

/* ---- 3. It is verifiable before and after ------------------------------ */

ok(/collides_with/.test(code),
  'step 1 surfaces a unique-constraint collision BEFORE the update, since `identifier` is `text unique` and a collision aborts the whole statement');
ok(/still_disagreeing/.test(code) && /identifier_duplicates/.test(code),
  'step 3 proves the outcome both ways: nothing left disagreeing, and no duplicate identifier created');
ok(/order by/i.test(code),
  'and step 1 is ordered, so its output is a stable record of the old values — the only reversal material, because the ledger guard records op and reason only');

/* ---- 4. The claims the file makes about its own side effects ----------- */

ok(/updated_at/.test(SQL) && /status_at/.test(SQL),
  'the file states what the touch trigger will and will not move');
ok(/rpc_bypass_guard/.test(SQL),
  'and that the ledger guard writes one `update` event per row, which is the audit trail for a direct statement');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nIdentifier team-move repair checks passed.');
