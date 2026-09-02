'use strict';
/*
 * Two batch rows naming one Linear parent must not delete the post.
 *
 * OWNER CORRECTION, 2026-09-01. I told him a video editor's missing issue was
 * "created directly in Linear, never imported". He pushed back: "are you saying
 * that the issue she's sending me was created only on linear? I don't think so,
 * I'm pretty sure it was created by our system, it even has the same naming as
 * our system." He was right and the diagnosis was wrong.
 *
 * WHAT IT ACTUALLY IS. SyncView created the batch AND its Linear parent; B1
 * then imported the same post as a mirror batch. So `bat_...` and `b1_b_...`
 * both carry the one parent uuid in linear_parent_ids. Different batch ids, so
 * _prodResolveBatchParentNodes marked the uuid ambiguous and
 * `ambiguous.forEach(uuid => byUuid.delete(uuid))` removed it. No synthetic
 * parent row was minted, its children linked to nothing, and a deep link by its
 * identifier resolved to nothing at all -- with a notice that then guessed at a
 * cause it could not establish.
 *
 * MEASURED across all 1,657 live batch rows that day: 23 parent uuids across 14
 * clients mint no row for this reason, and 12 of those are exactly this
 * native-plus-mirror pair. Replayed through the real resolver over the real
 * rows for the reported client: before, 0 parents and 32 orphaned children;
 * after, the parent resolves to the NATIVE batch and all 32 link to it.
 *
 * THE TIE-BREAK IS NOT ARBITRARY. `bat_` is the row SyncView writes to --
 * batch_description targets it, intake populates its asset columns, and
 * WIRED-PARITY item 36 measured that the mirror's asset columns are empty while
 * the native ones carry the links.
 *
 * AMENDED 2026-09-02: this header used to end "a pair with no native side stays
 * ambiguous and is still dropped ... inventing one would show a different
 * batch's description under this parent". Measured, those pairs are not
 * different batches -- they are one post imported twice, byte-identical in name
 * in 8 of the 10 real cases. Same-kind pairs now resolve on sub-issue count,
 * then description length, then the lower id. See section 2 below.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* The REAL resolver, lifted from the page, with the same-kind tie-break helper
   it now calls. Both come from index.html; nothing here is re-typed. */
const resolve = new Function(
  grabFunc(INDEX, '_prodBatchClaimWins') + '\n'
  + grabFunc(INDEX, '_prodResolveBatchParentNodes')
  + '\nreturn _prodResolveBatchParentNodes;')();

const UUID = '2a39c264-uuid';
const parentEntry = (owner) => ({
  video: { uuid: UUID, identifier: 'VID-13555', url: 'https://linear.app/x/VID-13555',
    ...(owner ? { owner_team: 'video' } : {}) },
});
const NATIVE = { id: 'bat_native', client_slug: 'acme', name: 'Post', status: 'active', linear_parent_ids: parentEntry(true) };
const MIRROR = { id: 'b1_b_mirror', client_slug: 'acme', name: 'Post', status: 'active', linear_parent_ids: parentEntry(false) };
const archivedOf = (batch, id) => ({ ...batch, id: id || batch.id, status: 'archived' });
const children = (batchId) => Array.from({ length: 3 }, (_, i) => ({
  id: 'del_' + i, batch_id: batchId, raw_issue_parent_id: UUID, linear_issue_uuid: 'kid-' + i,
}));

function run(batches, rows) {
  const out = resolve(rows, batches, new Map());
  const nodes = [...out.nodes.values()];
  return { nodes, links: out.links, byIdentifier: new Map(nodes.map(n => [n.identifier, n])) };
}

/* ---- 1. THE REPORTED FAILURE ------------------------------------------- */

{
  const r = run([MIRROR, NATIVE], children('bat_native'));
  const node = r.byIdentifier.get('VID-13555');
  ok(!!node,
    'THE REPORT: a post claimed by BOTH its native batch and its B1 mirror now mints a parent row instead of vanishing');
  ok(node && node.batchId === 'bat_native',
    'and it resolves to the NATIVE batch — the row SyncView writes to, and the one carrying the asset links');
  ok(r.links.size === 3,
    'so its children link to it rather than hanging off nothing');
}
{
  // Order must not decide it: the projection arrives sorted by created_at and
  // either row can come first.
  const r = run([NATIVE, MIRROR], children('bat_native'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'bat_native',
    'the same answer whichever row the projection happens to deliver first — a tie-break that depends on ordering is not one');
}

/* ---- 2. SAME-KIND PAIRS NOW RESOLVE, and this section is amended -------- */

/* AMENDED 2026-09-02. This section asserted that two natives, or two mirrors,
   "stay ambiguous and are still dropped", on the reasoning that there was no
   principled winner and that inventing one would show one batch's description
   under another's parent. The assertions were faithful to the code; the
   REASONING did not survive being measured.
   Across all 1,660 live batches, 10 collisions reach this branch, and in 8 of
   them the two rows carry a BYTE-IDENTICAL name. The remaining 2 differ only by
   a typo of one post ("Hook Videos" / "Hooks videos", "12 Thumbnails" /
   "Thumbnails"). None of the 10 is two different posts competing for a parent;
   every one is a single post imported twice. So "a different batch's
   description" was never the risk being run -- while dropping both makes the
   whole post vanish from Scene View, which is the failure a video editor
   reported on 2026-09-01 and the reason any of this was looked at.
   The cascade is now: liveness, provenance, sub-issue count, description
   length, then the lower id. `test/batch-parent-same-kind-tiebreak.js` proves
   each rung against the real production shapes. */

{
  const heavy = { ...NATIVE, id: 'bat_other' };
  const r = run([NATIVE, heavy], children('bat_native'));
  ok(r.byIdentifier.has('VID-13555'),
    'TWO NATIVE batches claiming one parent now mint a row instead of deleting the post');
  ok(r.byIdentifier.get('VID-13555').batchId === 'bat_native',
    'and the one the sub-issues actually hang off wins');
}
{
  const second = { ...MIRROR, id: 'b1_b_other' };
  const r = run([MIRROR, second], children('b1_b_mirror'));
  ok(r.byIdentifier.has('VID-13555'),
    'and so do two mirrors — 8 of the 10 real cases are the same post under a byte-identical name, so dropping both cost the post and saved nothing');
  ok(r.byIdentifier.get('VID-13555').batchId === 'b1_b_mirror',
    'resolving to the row carrying the work');
}
{
  const r = run([NATIVE], children('bat_native'));
  ok(r.byIdentifier.get('VID-13555') && r.byIdentifier.get('VID-13555').batchId === 'bat_native',
    'a post with a single batch is untouched, which is every post that already worked');
}
{
  // A deliverable that IS the parent must never mint a synthetic row for itself.
  const rows = children('bat_native').concat([{ id: 'del_parent', batch_id: 'bat_native', linear_issue_uuid: UUID }]);
  const r = run([MIRROR, NATIVE], rows);
  ok(!r.byIdentifier.has('VID-13555'),
    'a parent that has a REAL deliverable row of its own still mints no synthetic one — the uuid is excluded before any of this');
}

/* ---- 3. AN ARCHIVED CLAIMANT NEVER WINS -------------------------------
   Raised by review, and it is not hypothetical. B1's own
   dropClaimsOwnedByAnotherBatch skips archived rows when deciding who owns a
   uuid (b1-linear-backfill.js:1080), so an ACTIVE import is deliberately
   allowed to reuse a claim held by an ARCHIVED batch -- while this projection
   loads batches with no status filter and sees both. On a prefix-only rule the
   archived native row wins and live children hang under a retired post,
   rendered with its stale title and description.
   Measured across all 1,658 live batch rows: 1 of the 12 native-plus-mirror
   pairs is exactly that shape, and the same rule rescues a second post whose
   two claimants are both mirrors with one archived. */

{
  const r = run([archivedOf(NATIVE), MIRROR], children('b1_b_mirror'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'b1_b_mirror',
    'an ARCHIVED native loses to an ACTIVE mirror — provenance never outranks being retired, or live children render under a dead post');
}
{
  const r = run([NATIVE, archivedOf(MIRROR)], children('bat_native'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'bat_native',
    'and an archived MIRROR loses to an active native, where both rules point the same way');
}
{
  // Both archived: nothing is live, so provenance decides as before.
  const r = run([archivedOf(MIRROR), archivedOf(NATIVE)], children('bat_native'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'bat_native',
    'when BOTH are archived the native still wins — the archived rule ranks liveness, it does not veto a post outright');
}
{
  // The rule also settles a mirror-vs-mirror pair, which provenance cannot.
  const r = run([archivedOf(MIRROR, 'b1_b_old'), MIRROR], children('b1_b_mirror'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'b1_b_mirror',
    'two mirrors with one archived now resolve to the live one — measured to rescue a second post that provenance alone could not');
}
{
  // `done` is a finished post, not a retired one.
  const doneNative = { ...NATIVE, status: 'done' };
  const r = run([MIRROR, doneNative], children('bat_native'));
  const node = r.byIdentifier.get('VID-13555');
  ok(node && node.batchId === 'bat_native',
    "a `done` batch is not archived and still competes — a finished post is a real post");
}
{
  /* AMENDED 2026-09-02: this asserted that two ARCHIVED mirrors stay dropped,
     because neither liveness nor provenance could separate them. They are now
     separated by what is actually on the rows. Both being archived is not a
     reason to delete the post -- an archived post still has to render when
     someone opens its link. */
  const r = run([archivedOf(MIRROR, 'b1_b_a'), archivedOf(MIRROR, 'b1_b_b')], children('b1_b_a'));
  ok(r.byIdentifier.has('VID-13555'),
    'two archived mirrors now resolve too — being retired is a reason to lose to a live row, never a reason for the post to disappear');
  ok(r.byIdentifier.get('VID-13555').batchId === 'b1_b_a',
    'to the one carrying the sub-issues');
}

/* ---- 4. The tie-break is stated in code, not inferred ------------------ */

const resolver = grabFunc(INDEX, '_prodResolveBatchParentNodes');
ok(/\/\^bat_\/\.test\(held\.batchId\)/.test(resolver)
  && /\/\^bat_\/\.test\(batchId\)/.test(resolver),
  'provenance is read from the id prefix on BOTH sides rather than assumed from arrival order');
ok(/_prodBatchClaimWins\(batch, held\.batch, childCounts\)/.test(resolver),
  'a same-provenance pair is settled by the measured cascade rather than dropped — count, then description, then the lower id');
ok(/const batchArchived = String\(batch && batch\.status \|\| ''\)\.trim\(\)\.toLowerCase\(\) === 'archived';/.test(resolver),
  'archived-ness is read off the row and normalised, not inferred from the id or assumed absent');
ok(resolver.indexOf('heldArchived !== thisArchived') < resolver.indexOf('heldIsNative !== thisIsNative'),
  'and it is checked BEFORE provenance — the ordering IS the fix, since a prefix-first rule hands live children to a retired post');
ok(resolver.indexOf('heldIsNative !== thisIsNative') < resolver.indexOf('_prodBatchClaimWins'),
  'and provenance is still checked before the new cascade, so a native never loses to a mirror on sub-issue count');
ok(/ambiguous\.forEach\(uuid => byUuid\.delete\(uuid\)\)/.test(resolver),
  'and the ambiguous drop mechanism is still present — nothing reaches it today, but removing it would make a future unresolvable case mint a wrong row silently instead of none');

console.log(failures === 0
  ? '\nduplicate batch parent checks passed'
  : '\n' + failures + ' duplicate batch parent check(s) failed');
process.exit(failures === 0 ? 0 : 1);
