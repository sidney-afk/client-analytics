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
 * confident wrong one. Two of those wrong answers were caught in review of this
 * very script and are pinned below by name: a parentless issue with NO shape-B
 * signal, and a batch whose probes did not all come back.
 */
const path = require('path');
const { classifyBatch } = require(path.join(__dirname, '..', 'scripts', 'batch-parent-recovery-dry-run.js'));

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

/* A probe is a record of an ATTEMPT. These three builders are the only shapes
   the live prober can hand the classifier. */
const probe = issue => ({ identifier: issue.identifier, ok: true, issue });
const unread = (identifier, reason) => ({ identifier, ok: false, reason: reason || 'linear HTTP 500' });

const child = (identifier, parentIdentifier, parentTeam) => probe({
  id: 'uuid-' + identifier, identifier, team: { key: identifier.slice(0, 3) },
  creator: { name: 'Sidney Laruel' }, description: 'Edit the hook.',
  parent: parentIdentifier
    ? { id: 'uuid-' + parentIdentifier, identifier: parentIdentifier, team: { key: parentTeam || 'VID' } }
    : null,
});
/* Shape B: no parent, mirror-authored, Filming Plan description. */
const batchParent = (identifier, over) => probe(Object.assign({
  id: 'uuid-' + identifier, identifier, title: 'Client · 17 Aug 2026', team: { key: 'VID' },
  creator: { name: 'SyncView Mirror' }, description: 'Filming Plan: https://example.invalid/plan',
  parent: null,
}, over || {}));

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
  const v = classifyBatch([batchParent('VID-13346')]);
  ok(v.verdict === 'deliverable_is_the_parent' && v.parent.identifier === 'VID-13346',
    'a parentless issue that IS the batch parent is named as such, not as a child');
  ok(v.verdict !== 'recover_from_child',
    'and is never reported as recovered from a child, which would be a wrong answer');
  ok(Array.isArray(v.signals) && v.signals.length,
    'and it says which signal made it the parent, so the call can be checked');
}

/* REVIEW FINDING (P2): "no parent" was treated as proof of shape B. It is not —
   an ordinary top-level issue also has no parent, and this batch would have
   been handed VID-9001 as its parent on the strength of nothing at all. */
{
  const v = classifyBatch([child('VID-9001', null)]);
  ok(v.verdict === 'ambiguous' && !v.parent,
    'a parentless issue with NO batch-parent signal is ambiguous, not the parent');
  ok(/signal/.test(String(v.reason)),
    'and the reason says a signal was what was missing');
}
/* Either signal alone is enough — the two were measured together but a batch
   parent with an empty description is still a batch parent. */
{
  const byAuthor = classifyBatch([batchParent('VID-13355', { description: '' })]);
  ok(byAuthor.verdict === 'deliverable_is_the_parent',
    'mirror authorship alone identifies the batch parent');
  const byPlan = classifyBatch([batchParent('VID-13356', { creator: { name: 'Sidney Laruel' } })]);
  ok(byPlan.verdict === 'deliverable_is_the_parent',
    'a Filming Plan description alone identifies the batch parent');
}
/* Two candidates is a human's call, not a coin flip. */
{
  const v = classifyBatch([batchParent('VID-1'), batchParent('VID-2')]);
  ok(v.verdict === 'ambiguous' && !v.parent && v.candidates.length === 2,
    'two issues that both look like the batch parent is ambiguous, not first-wins');
}
/* The verdict never carries the issue body — descriptions can hold client
   detail and --json prints the verdict verbatim (F64). */
{
  const v = classifyBatch([batchParent('VID-13346')]);
  ok(!('description' in v.parent) && !('creator' in v.parent),
    'the named parent is an identity, not the issue body that identified it');
}

/* Mixed: a real child AND a self-parent in one batch. The child's parent wins,
   and the self-parent is still surfaced rather than swallowed — it is a
   separate defect in the deliverables table. */
{
  const v = classifyBatch([child('GRA-7149', 'VID-13469'), batchParent('VID-13346')]);
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

/* REVIEW FINDING (P2): a failed probe became `null` and was filtered away, so
   ONE unreadable child left ONE survivor — and one survivor reads as unanimous.
   The unread child is precisely the one that might have disagreed. */
{
  const v = classifyBatch([child('GRA-7149', 'VID-13469'), unread('GRA-7150')]);
  ok(v.verdict === 'probe_incomplete' && !v.parent,
    'an unread child blocks the verdict rather than letting the survivor speak for the batch');
  ok(v.unread.includes('GRA-7150'),
    'and names what could not be read, so the re-run is targeted');
  ok(v.unread_reasons.some(r => /GRA-7150/.test(r)),
    'with the reason attached — a 500 and a deleted issue need different follow-ups');
}
/* Including when the survivor would have been shape B. */
{
  const v = classifyBatch([batchParent('VID-13346'), unread('GRA-7150')]);
  ok(v.verdict === 'probe_incomplete' && !v.parent,
    'an unread child blocks a shape-B verdict too');
}
/* An identifier Linear does not know is a failed probe, not an absent one. */
{
  const v = classifyBatch([unread('GRA-404', 'linear has no issue GRA-404')]);
  ok(v.verdict === 'probe_incomplete',
    'an identifier Linear does not know is unread, not "nothing to probe"');
}

/* Nothing to probe must not become an answer either. */
{
  const v = classifyBatch([]);
  ok(v.verdict === 'no_probe' && !v.parent, 'no probes yields no_probe and no parent');
}
{
  const v = classifyBatch(null);
  ok(v.verdict === 'no_probe' && !v.parent, 'a missing probe list yields no_probe, not a crash');
}

/* Every verdict that carries a parent must carry a usable one — the caller
   writes `parent.id` into `linear_parent_ids`, and an identifier alone is not
   something the gateway can store. */
{
  const withParents = [
    classifyBatch([child('GRA-7149', 'VID-13469')]),
    classifyBatch([batchParent('VID-13346')]),
  ];
  ok(withParents.every(v => v.parent && v.parent.id && v.parent.identifier
    && v.parent.team && v.parent.team.key),
    'a recovered parent always carries the uuid, identifier and team the write needs');
}

if (failures) { console.error('\nbatch parent recovery classifier checks FAILED: ' + failures); process.exit(1); }
console.log('\nbatch parent recovery classifier checks passed');
