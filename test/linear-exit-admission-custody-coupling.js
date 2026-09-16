'use strict';
/*
 * THE ADMISSION GUARD LIST AND THE CUSTODY CORPUS ARE THE SAME SET.
 *
 * Owner ruling D25, 2026-09-16, in the owner's words:
 *
 *   "A table worth guarding holds data worth backing up. A table that is
 *    guarded but never backed up can lose its data behind a check that makes
 *    it look protected."
 *
 * Two files state that set independently and nothing used to say they must
 * agree. They agreed by history, not by construction, until B10 added
 * hiring_practical_test_jobs to one of them and the divergence broke three
 * suites that the unit lane does not run. This check exists so the next
 * divergence is a named failure at the edit instead of a surprise at an
 * install rehearsal.
 *
 * WHY THIS ASSERTS INSTEAD OF DERIVING ONE FROM THE OTHER. Generating the
 * guard list from the corpus would work and would cost far more than it
 * saves: the guard's migration is install-plan source #2, so its bytes feed
 * every profile's plan hash and therefore every profile's target. B10
 * measured that bill -- three plan hashes moved, three targets were
 * invalidated, and each had to be re-derived by a real install run on the
 * owner's machine. A custody corpus must be able to gain a table without
 * costing three target re-derivations. See
 * docs/ops/LINEAR_EXIT_TABLE_NAME_COUPLING_PROPOSAL.md.
 *
 * WHY IT LIVES IN THE UNIT LANE. It reads two files and compares two sorted
 * arrays: no cluster, no private input, no network. The defect this guards
 * was invisible precisely because it lived in suites the unit lane defers, so
 * a coupling check placed in that deferred set would reproduce the failure it
 * exists to prevent.
 *
 * HOW TO DIVERGE ON PURPOSE. Do not relax this to a subset check. Add the
 * name to EXCEPTIONS below with the reason and the date. That keeps an
 * accidental divergence impossible and a deliberate one on the record.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GUARD_MIGRATION = 'supabase/migrations/20260912183653_application_dml_admission_preparation.sql';

/* Deliberate, reviewed divergences. Each entry needs a reason and a date, and
 * each must name which side it is missing from. Empty is the expected state. */
const EXCEPTIONS = Object.freeze({
  guardOnly: Object.freeze({}),   // name -> 'reason (YYYY-MM-DD)'
  corpusOnly: Object.freeze({}),
});

/* Read the guard's table list out of the migration's own foreach array, so the
 * check reads what the database will actually be told, not a copy of it. */
function guardList() {
  const sql = fs.readFileSync(path.join(ROOT, GUARD_MIGRATION), 'utf8');
  const block = /foreach t in array array\[(.*?)\] loop/s.exec(sql);
  assert.ok(block, 'admission guard foreach array not found in ' + GUARD_MIGRATION);
  const names = [...block[1].matchAll(/''([a-z0-9_]+)''/g)].map(m => m[1]);
  assert.ok(names.length > 0, 'admission guard list parsed empty');
  assert.deepEqual(names, [...names].sort(), 'admission guard list is not sorted');
  assert.equal(new Set(names).size, names.length, 'admission guard list has a duplicate');
  return names;
}

const guard = guardList();
const corpus = require('../scripts/linear-exit-complete-application-data').expectedNames();

const guardOnly = guard.filter(n => !corpus.includes(n));
const corpusOnly = corpus.filter(n => !guard.includes(n));

const unexplainedGuardOnly = guardOnly.filter(n => !Object.hasOwn(EXCEPTIONS.guardOnly, n));
const unexplainedCorpusOnly = corpusOnly.filter(n => !Object.hasOwn(EXCEPTIONS.corpusOnly, n));

assert.deepEqual(unexplainedGuardOnly, [],
  'D25: these tables are admission-guarded but absent from the custody corpus, so their data is not backed up while a check makes them look protected. '
  + 'Add them to docs/independence/LINEAR_EXIT_COMPLETE_APPLICATION_DATA_V1.json, or record a reviewed exception in EXCEPTIONS.guardOnly with a reason: '
  + JSON.stringify(unexplainedGuardOnly));

assert.deepEqual(unexplainedCorpusOnly, [],
  'D25: these tables are in the custody corpus but not admission-guarded, so writes to them are not gated with the rest. '
  + 'Add them to the guard list in ' + GUARD_MIGRATION + ', or record a reviewed exception in EXCEPTIONS.corpusOnly with a reason: '
  + JSON.stringify(unexplainedCorpusOnly));

/* Every exception must name a table that is actually diverging. A stale
 * exception is how a real divergence gets waved through later. */
for (const name of Object.keys(EXCEPTIONS.guardOnly)) {
  assert.ok(guardOnly.includes(name), 'stale EXCEPTIONS.guardOnly entry, no longer diverging: ' + name);
}
for (const name of Object.keys(EXCEPTIONS.corpusOnly)) {
  assert.ok(corpusOnly.includes(name), 'stale EXCEPTIONS.corpusOnly entry, no longer diverging: ' + name);
}

console.log(JSON.stringify({
  marker: 'LINEAR_EXIT_ADMISSION_CUSTODY_COUPLING_OK',
  relation: 'equality',
  guard_tables: guard.length,
  corpus_tables: corpus.length,
  exceptions: Object.keys(EXCEPTIONS.guardOnly).length + Object.keys(EXCEPTIONS.corpusOnly).length,
  ruling: 'D25',
}));
