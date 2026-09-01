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
 * the native ones carry the links. A pair with no native side stays ambiguous
 * and is still dropped: that is a real conflict with no principled winner, and
 * inventing one would show a different batch's description under this parent.
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

/* The REAL resolver, lifted from the page. */
const resolve = new Function(
  grabFunc(INDEX, '_prodResolveBatchParentNodes') + '\nreturn _prodResolveBatchParentNodes;')();

const UUID = '2a39c264-uuid';
const parentEntry = (owner) => ({
  video: { uuid: UUID, identifier: 'VID-13555', url: 'https://linear.app/x/VID-13555',
    ...(owner ? { owner_team: 'video' } : {}) },
});
const NATIVE = { id: 'bat_native', client_slug: 'acme', name: 'Post', linear_parent_ids: parentEntry(true) };
const MIRROR = { id: 'b1_b_mirror', client_slug: 'acme', name: 'Post', linear_parent_ids: parentEntry(false) };
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

/* ---- 2. What the guard was written for is unchanged -------------------- */

{
  const second = { ...NATIVE, id: 'bat_other' };
  const r = run([NATIVE, second], children('bat_native'));
  ok(!r.byIdentifier.has('VID-13555'),
    'TWO NATIVE batches claiming one parent stay ambiguous and are still dropped — that is a real conflict with no principled winner');
}
{
  const second = { ...MIRROR, id: 'b1_b_other' };
  const r = run([MIRROR, second], children('b1_b_mirror'));
  ok(!r.byIdentifier.has('VID-13555'),
    'and so do two mirrors — inventing a winner would show one batch description under another batch parent');
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

/* ---- 3. The tie-break is stated in code, not inferred ------------------ */

const resolver = grabFunc(INDEX, '_prodResolveBatchParentNodes');
ok(/\/\^bat_\/\.test\(byUuid\.get\(uuid\)\.batchId\)/.test(resolver)
  && /\/\^bat_\/\.test\(batchId\)/.test(resolver),
  'provenance is read from the id prefix on BOTH sides rather than assumed from arrival order');
ok(/if \(heldIsNative === thisIsNative\) \{ ambiguous\.add\(uuid\); return; \}/.test(resolver),
  'a same-provenance pair takes the ambiguous path, so the widening cannot leak past the case it was measured for');
ok(/ambiguous\.forEach\(uuid => byUuid\.delete\(uuid\)\)/.test(resolver),
  'and the ambiguous drop itself is still there — this change chooses a winner where one exists, it does not remove the guard');

console.log(failures === 0
  ? '\nduplicate batch parent checks passed'
  : '\n' + failures + ' duplicate batch parent check(s) failed');
process.exit(failures === 0 ? 0 : 1);
