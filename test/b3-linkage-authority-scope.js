'use strict';

/*
 * The linkage backfill and the archive promotion used to share one authority
 * rule: "the team must be Linear-authoritative". After the graphics flip that
 * rule blocked the safe write and the team paid for it -- thumbnail status
 * controls stayed greyed out on cards whose thumbnail deliverable existed all
 * along, because the card's link slot could no longer be filled.
 *
 * These pins hold the split in place:
 *   - linkage may proceed under linear OR syncview authority,
 *   - archive promotion still demands linear,
 *   - neither proceeds without a fresh live prod_authority read.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'b3-linkage-backfill.js'), 'utf8');

let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures += 1; console.error('FAIL  ' + label); }
}

ok(/async function assertLinearAuthority\(writes, \{ promotingArchive = false \} = \{\}\)/.test(source),
  'the authority guard takes an explicit archive-promotion flag');

ok(/promotingArchive && authority !== 'linear'/.test(source)
  && /Refusing \$\{team\} archive promotion while that team is not Linear-authoritative/.test(source),
  'archive promotion still refuses unless the team is Linear-authoritative');

ok(/authority !== 'linear' && authority !== 'syncview'/.test(source),
  'linkage accepts a Linear- or SyncView-authoritative team and nothing else');

ok(/Refusing writes without a fresh live prod_authority read/.test(source),
  'both writes still refuse without a fresh live authority read');

/*
 * The strict active-card precondition. It used to count EVERY failing slot in
 * the system, so 367 unrelated failures (mostly daily-drill fixtures whose
 * deliverable was never imported) vetoed a plan of 10 real repairs -- and would
 * have kept vetoing for as long as one stale fixture existed anywhere. It is
 * now scoped to slots the run actually writes, without weakening what it
 * protects: a repair whose OWN slot stays unresolved still aborts the run
 * before any write.
 */
ok(/const plannedSlots = new Set\(allLinkWrites\.map\(slotKey\)\);/.test(source),
  'the precondition builds its slot set from the writes this run intends');

ok(/sweeps\.projected\.failures\.filter\(row => plannedSlots\.has\(slotKey\(row\)\)\)/.test(source),
  'only failures landing on a planned slot are treated as blocking');

ok(/if \(blockingFailures\.length\) \{/.test(source)
  && /throw new Error\(`Strict active-card precondition failed/.test(source),
  'a blocking failure still aborts the run before any write');

ok(/\$\{sweeps\.projected\.failures\.length\} unresolved or ambiguous slot\(s\) belong to this plan/.test(source),
  'the error still reports the full failure count, so scoping never hides residue');

ok(/row\.component/.test(source) && /row\.card_id/.test(source) && /row\.client_slug \|\| row\.client/.test(source),
  'slot identity is client + card + component, so two slots on one card stay distinct');

ok(!/if \(sweeps\.projected\.failures\.length\) \{/.test(source),
  'the unscoped whole-system veto is gone, not merely bypassed');

ok(/\{ promotingArchive: !!promotions \}/.test(source),
  'the call site passes the flag from the actual promotion plan, not a constant');

// The guard must not have been widened into a blanket allow: an unknown or
// missing authority value still has to stop the run.
ok(!/authority !== 'linear' \|\| authority !== 'syncview'/.test(source),
  'the authority comparison is a conjunction, so an unknown value still refuses');

if (failures) {
  console.error(`\nb3 linkage authority scope: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nb3 linkage authority scope checks passed');
