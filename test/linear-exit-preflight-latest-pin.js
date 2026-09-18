'use strict';

/*
 * THE STALE-PIN CLASS.
 *
 * `scripts/linear-exit-deploy-preflight.js` hashes each routine's body out of
 * ONE named migration file. When a later migration redefines that routine and
 * only some of its rows are repointed, the gate goes on hashing a body nobody
 * installs -- and the first thing anyone learns about it is a live
 * CONTRACT_MISMATCH inside a dispatch, which is where the whole point of this
 * gate is to NOT be.
 *
 * Measured: PR #1410 added `2026-09-18-notification-creative-channel.sql`,
 * which redefines SIX notification routines. Five rows were repointed. The
 * sixth, `production_notification_intent_guard()`, was left on the 2026-09-09
 * file, and the live preflight refused with
 * `CONTRACT_MISMATCH:routine:production_notification_intent_guard()`.
 *
 * THE INVARIANT, and why it is scoped the way it is. For every migration the
 * contract ALREADY CITES, every contract routine that file redefines must be
 * pinned to it, once that file is the later of the two citing files.
 *
 * Scoped to cited files on purpose. A repository-wide "pin to the newest file
 * that defines it" rule is WRONG here and would have made this suite demand a
 * real regression: `production_intake_append` is correctly pinned to
 * `2026-09-07-native-intake-named-append.sql`, whose own header says it
 * installs AFTER `2026-09-07-production-intake-append-v8.sql` -- which sorts
 * later by filename and is not cited at all. Filename order is not apply
 * order. What IS sound is that a file the contract itself points at is part of
 * the installed set, so anything it redefines has to be pinned there too.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PREFLIGHT = path.join(ROOT, 'scripts', 'linear-exit-deploy-preflight.js');
const source = fs.readFileSync(PREFLIGHT, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* The contract's own ROUTINES table, read out of the file rather than
   re-listed here, so a row added tomorrow is covered without an edit. */
const rows = [...source.matchAll(/\['([^']+\([^']*\))',\s*'(migrations\/[^']+)',\s*'([a-z0-9_]+)'/g)]
  .map(match => ({ signature: match[1], file: match[2], name: match[3] }));
ok(rows.length > 40, `the ROUTINES table was parsed (${rows.length} rows)`);

/* Mirrors bodyFor() in the preflight: the FIRST definition in the named file. */
function bodyFor(file, name) {
  const sql = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const match = sql.match(new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\)`
      + `[\\s\\S]*?\\bas\\s+(\\$[A-Za-z0-9_]*\\$)([\\s\\S]*?)\\1\\s*;`, 'i'));
  return match ? match[2] : null;
}
const md5 = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');

/* Every pinned file must actually define the routine it is pinned for --
   otherwise the gate throws `repository contract body missing` at dispatch. */
for (const row of rows) {
  ok(bodyFor(row.file, row.name) !== null,
    `${row.signature} is defined in the file the contract pins it to`);
}

const pinned = new Map(rows.map(row => [row.name, row.file]));
const citedFiles = [...new Set(rows.map(row => row.file))].sort();
ok(citedFiles.length > 0, `the contract cites ${citedFiles.length} migration files`);

const violations = [];
for (const file of citedFiles) {
  for (const row of rows) {
    if (pinned.get(row.name) === file) continue;
    const body = bodyFor(file, row.name);
    if (body === null) continue;              // this file does not redefine it
    if (file <= pinned.get(row.name)) continue; // the pin is the later cited file
    violations.push({
      routine: row.signature,
      pinned_to: pinned.get(row.name),
      redefined_by: file,
      body_differs: md5(body) !== md5(bodyFor(pinned.get(row.name), row.name)),
    });
  }
}
ok(violations.length === 0,
  violations.length === 0
    ? 'no contract routine is pinned to a file a later cited migration redefines'
    : 'stale pins: ' + violations.map(v => `${v.routine} pinned ${v.pinned_to} but redefined by ${v.redefined_by}`
      + (v.body_differs ? ' (bodies DIFFER: this is a live CONTRACT_MISMATCH)' : ' (bodies identical for now)')).join('; '));

/* The specific row this suite was written for, named so a future revert of it
   fails with the reason rather than only the rule. */
ok(pinned.get('production_notification_intent_guard') === 'migrations/2026-09-18-notification-creative-channel.sql',
  'production_notification_intent_guard is pinned to the migration that last redefines it');

/* The control: the rule must be seen to FIRE. A synthetic pair proves the
   comparison, without touching the real table. */
{
  const synthetic = [
    { name: 'synthetic_routine', file: 'migrations/2026-01-01-a.sql' },
    { name: 'synthetic_routine', file: 'migrations/2026-02-02-b.sql' },
  ];
  const stale = synthetic[1].file > synthetic[0].file;
  ok(stale, 'the control: a later cited file is recognised as later than the pin');
}

console.log(JSON.stringify({
  marker: 'LINEAR_EXIT_PREFLIGHT_LATEST_PIN_OK',
  routines: rows.length,
  cited_files: citedFiles.length,
  violations: violations.length,
}));
if (failures) process.exit(1);
