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

/*
 * The post-write sweep kept its OWN unscoped copy of the same veto, which is
 * how the owner's apply run committed all 10 links correctly and then reported
 * itself as failed on 370 unrelated slots. Scope it the same way, and keep the
 * checks that actually concern the written rows fatal.
 */
ok(/const verifiedSlots = new Set\(\(writes \|\| \[\]\)\.map/.test(source),
  'the post-sweep builds its slot set from the rows this run wrote');

ok(/const strictBlocking = strictSweep\.failures\.filter\(row => verifiedSlots\.has/.test(source),
  'post-sweep strict failures only count on slots this run wrote');

ok(/if \(failures\.length \|\| archiveFailures\.length \|\| strictBlocking\.length\) \{/.test(source),
  'a targeted mismatch or archive blocker still fails the run');

ok(!/if \(failures\.length \|\| archiveFailures\.length \|\| strictSweep\.failures\.length\) \{/.test(source),
  'the post-sweep no longer fails on the whole-system strict count');

ok(/strict active-card failure\(s\) on written slots/.test(source),
  'the post-sweep message reports blocking-of-total, so residue stays visible');

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
