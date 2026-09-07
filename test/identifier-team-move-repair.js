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
 * AND ONE PROPERTY THE REVIEW ADDED. Codex on #1333: the update makes the two
 * columns agree, which empties the browser's `aliasId` for these rows, so the
 * repair is also the moment the retired identifier would stop existing
 * anywhere. It is recorded in `deliverable_events` first, in the same
 * transaction, and the assertions below hold that pairing together -- an
 * update that lands without its ledger row is the failure this section exists
 * to prevent.
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

/* ---- 1. Two statements mutate, and between them one column moves ------- */

/* Statement-LEADING keywords, not every occurrence of the word. The insert
   writes the literal `'update'` as the event's action, and a scan that counts
   bare words reads that value as a third statement — which is precisely the
   kind of miscount a guard like this must not make about the thing it guards. */
const MUTATING = new Set(['update', 'insert', 'delete', 'drop', 'truncate', 'alter', 'grant', 'revoke', 'create']);
const leading = code.split(';')
  .map(stmt => (stmt.trim().match(/^[a-z]+/i) || [''])[0].toLowerCase())
  .filter(Boolean);
const mutating = leading.filter(word => MUTATING.has(word));
ok(leading.length > 0 && leading.every(word => /^[a-z]+$/.test(word)),
  'every statement in the file starts with a keyword the scan below can read (a parse that silently found nothing would pass the next check vacuously)');
ok(mutating.length === 2 && mutating[0] === 'insert' && mutating[1] === 'update',
  'exactly two mutating statements in the whole file: the ledger INSERT, then the UPDATE — no schema change, no grant, no function, nothing to deploy');
ok(/insert into public\.deliverable_events/.test(code),
  'the insert writes the append-only event ledger, never a second table anything matches on (`linear_aliases` is flattened and card-matched by b3-linkage-backfill)');
ok(/update public\.deliverables d/.test(code),
  'it names the table in full, so it cannot be run against a search_path that resolves elsewhere');
const setClause = (code.match(/set\s+([^\n]*)/i) || [])[1] || '';
ok(/^identifier = d\.linear_identifier\s*$/.test(setClause.trim()),
  'it sets `identifier` from `linear_identifier` and touches no other column of `deliverables` — status, client, batch, card linkage and every Linear column are out of range');

/* ---- 1b. The retired value is recorded, and recorded atomically -------- */

ok(/'retired_identifier', d\.identifier/.test(code) && /'current_identifier', d\.linear_identifier/.test(code),
  'the event carries the retired identifier and the one replacing it — after the repair this is the only place the old name exists, since the columns then agree and `aliasId` empties');
ok(/'identifier_team_move_repair'/.test(code),
  "and names the operation, so the reversal query can find its own rows");
const begin = code.search(/^\s*begin;/mi);
const commit = code.search(/^\s*commit;/mi);
const insertAt = code.search(/insert into public\.deliverable_events/i);
const updateAt = code.search(/update public\.deliverables d/i);
ok(begin >= 0 && commit > begin,
  'both are wrapped in one transaction');
ok(begin < insertAt && insertAt < updateAt && updateAt < commit,
  'and inside it the ledger row is written BEFORE the column it describes — an update that lands without its record is the failure mode this ordering removes');
ok(/event_key/.test(code) && /\|\| d\.identifier/.test(code),
  'the event key carries the retired value, so a row that diverges again later is a new key rather than a unique-index collision on re-run');

/* ---- 2. The three predicates that bound it ----------------------------- */

const update = code.slice(code.search(/update public\.deliverables d/i));
const insert = code.slice(insertAt, updateAt);
const PREDICATE = [
  [/d\.identifier is not null/i, 'a row with no snapshot is never touched, which is every natively created row'],
  [/d\.linear_identifier is not null/i, 'a row with no Linear identifier is never given one'],
  [/d\.identifier <> d\.linear_identifier/i, 'only rows that actually DISAGREE — which is also what makes it idempotent, since after it runs the predicate matches nothing'],
];
PREDICATE.forEach(([re, why]) => {
  ok(re.test(update), 'the update is bounded: ' + why);
  ok(re.test(insert), 'and the insert carries the SAME clause, so the ledger cannot record a row the update did not touch: ' + why);
});
ok(!/\blimit\b/i.test(update) && !/\bin\s*\(/i.test(update),
  'and it is expressed as a condition rather than a hardcoded list of ids, so it repairs the rows that have the defect rather than the rows someone remembered');

/* ---- 3. It is verifiable before and after ------------------------------ */

ok(/collides_with/.test(code),
  'step 1 surfaces a unique-constraint collision BEFORE the update, since `identifier` is `text unique` and a collision aborts the whole statement');
ok(/still_disagreeing/.test(code) && /identifier_duplicates/.test(code),
  'step 3 proves the outcome both ways: nothing left disagreeing, and no duplicate identifier created');
ok(/retired_identifier/.test(code.slice(code.search(/^\s*commit;/mi))),
  'and reads the repair events back afterwards, so the record is verified to exist rather than assumed');
ok(/order by/i.test(code),
  'and step 1 is ordered, so its output is a stable record of the old values before the fact, as the repair events are after it');

/* ---- 4. The claims the file makes about its own side effects ----------- */

ok(/updated_at/.test(SQL) && /status_at/.test(SQL),
  'the file states what the touch trigger will and will not move');
ok(/rpc_bypass_guard/.test(SQL),
  'and that the ledger guard writes one `update` event per row, which is the audit trail for a direct statement');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nIdentifier team-move repair checks passed.');
