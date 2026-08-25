'use strict';
/*
 * "Read the child's parent" is wrong for a child that has none and IS one.
 *
 * 26 active batches hold 63 deliverables with no `linear_parent_ids`, so nothing
 * can be appended to them. Linear still knows the answer — but probing four of
 * them on 2026-08-25 turned up two different shapes, and a repair that assumes
 * only the first would write a wrong parent for the second:
 *
 *   A. GRA-7149 -> parent VID-13469, GRA-6992 -> parent VID-13203. Ordinary
 *      children. Note the parent is a VIDEO issue under a GRAPHICS child, which
 *      is the house shape rather than an anomaly.
 *   B. VID-13346 and VID-13355 have NO parent, were authored by "SyncView
 *      Mirror", and carry a Filming Plan link as their description. They ARE
 *      batch parents that got imported into `deliverables` as if they were work.
 *
 * This suite executes the shipped classifier against both shapes and the ways
 * they can be mixed, because the dangerous outcome is not "no answer" — it is a
 * confident wrong one.
 */
const path = require('path');
const { classifyBatch } = require(path.join(__dirname, '..', 'scripts', 'batch-parent-recovery-dry-run.js'));

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

const child = (identifier, parentIdentifier, parentTeam) => ({
  id: 'uuid-' + identifier, identifier, team: { key: identifier.slice(0, 3) },
  parent: parentIdentifier
    ? { id: 'uuid-' + parentIdentifier, identifier: parentIdentifier, team: { key: parentTeam || 'VID' } }
    : null,
});

ok(typeof classifyBatch === 'function', 'the shipped classifier loads (harness is not vacuous)');

/* A — every child agrees on one parent. */
{
  const v = classifyBatch([child('GRA-7149', 'VID-13469'), child('GRA-7150', 'VID-13469')]);
  ok(v.verdict === 'recover_from_child' && v.parent.identifier === 'VID-13469',
    'children agreeing on one parent recover it');
}
/* ...and a single child is enough. */
{
  const v = classifyBatch([child('GRA-6992', 'VID-13203')]);
  ok(v.verdict === 'recover_from_child' && v.parent.identifier === 'VID-13203',
    'one child with a parent is enough');
}

/* B — the deliverable IS the parent. Must NOT be reported as recovered from a
   child, and must NOT be silently treated as ordinary work. */
{
  const v = classifyBatch([child('VID-13346', null)]);
  ok(v.verdict === 'deliverable_is_the_parent' && v.parent.identifier === 'VID-13346',
    'a parentless issue that IS the batch parent is named as such, not as a child');
  ok(v.verdict !== 'recover_from_child',
    'and is never reported as recovered from a child, which would be a wrong answer');
}

/* Mixed: a real child AND a self-parent in one batch. The child's parent wins,
   and the self-parent is still surfaced rather than swallowed — it is a
   separate defect in the deliverables table. */
{
  const v = classifyBatch([child('GRA-7149', 'VID-13469'), child('VID-13346', null)]);
  ok(v.verdict === 'recover_from_child' && v.parent.identifier === 'VID-13469',
    'a real child decides the parent even when a self-parent sits beside it');
  ok(Array.isArray(v.also_self_parent) && v.also_self_parent.includes('VID-13346'),
    'and the self-parent is still reported, never swallowed');
}

/* Disagreement is the case that must NEVER produce a confident answer. */
{
  const v = classifyBatch([child('GRA-1', 'VID-100'), child('GRA-2', 'VID-200')]);
  ok(v.verdict === 'ambiguous' && !v.parent,
    'children disagreeing yields ambiguous and NO parent');
  ok(v.candidates.includes('VID-100') && v.candidates.includes('VID-200'),
    'and names both candidates so a human can decide');
}
{
  const v = classifyBatch([child('VID-1', null), child('VID-2', null)]);
  ok(v.verdict === 'ambiguous' && !v.parent,
    'several parentless issues and no shared parent is ambiguous, not a guess');
}

/* Nothing to probe must not become an answer either. */
{
  const v = classifyBatch([]);
  ok(v.verdict === 'no_probe' && !v.parent, 'no probes yields no_probe and no parent');
}
{
  const v = classifyBatch([null, null]);
  ok(v.verdict === 'no_probe' && !v.parent, 'probes that all failed yield no_probe, not ambiguity');
}

if (failures) { console.error('\nbatch parent recovery classifier checks FAILED: ' + failures); process.exit(1); }
console.log('\nbatch parent recovery classifier checks passed');
