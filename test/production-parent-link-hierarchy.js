'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (!quote && char === '/' && next === '/') { lineComment = true; index++; continue; }
    if (!quote && char === '/' && next === '*') { blockComment = true; index++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

const sandbox = { Map, Set, String, Array };
vm.createContext(sandbox);
vm.runInContext(
  extractFunction('_prodResolveParentLinks')
    + '\nthis.resolveParentLinks = _prodResolveParentLinks;',
  sandbox,
);

const rows = [
  {
    id: 'true-parent',
    linear_issue_uuid: 'linear-parent',
    batch_id: 'parent-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Real parent issue',
  },
  {
    id: 'title-matched-sibling',
    linear_issue_uuid: 'linear-child-1',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Creation Batch',
  },
  {
    id: 'cross-team-sibling',
    linear_issue_uuid: 'linear-child-2',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'graphics',
    title: 'TEST 2',
  },
  {
    id: 'cross-client-sibling',
    linear_issue_uuid: 'linear-child-3',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'beta',
    team: 'video',
    title: 'TEST 3',
  },
  {
    id: 'grandchild',
    linear_issue_uuid: 'linear-grandchild',
    raw_issue_parent_id: 'linear-child-1',
    batch_id: 'third-level-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Nested work',
  },
  {
    id: 'same-batch-root',
    linear_issue_uuid: 'linear-root',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Ordinary root',
  },
  {
    id: 'unresolved-parent',
    linear_issue_uuid: 'linear-orphan',
    raw_issue_parent_id: 'linear-missing',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Visible orphan',
  },
  {
    id: 'self-parent',
    linear_issue_uuid: 'linear-self',
    raw_issue_parent_id: 'linear-self',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Malformed self link',
  },
  {
    id: 'duplicate-parent-a',
    linear_issue_uuid: 'linear-duplicate',
  },
  {
    id: 'duplicate-parent-b',
    linear_issue_uuid: 'linear-duplicate',
  },
  {
    id: 'duplicate-parent-child',
    linear_issue_uuid: 'linear-duplicate-child',
    raw_issue_parent_id: 'linear-duplicate',
  },
  {
    id: 'cycle-a',
    linear_issue_uuid: 'linear-cycle-a',
    raw_issue_parent_id: 'linear-cycle-b',
  },
  {
    id: 'cycle-b',
    linear_issue_uuid: 'linear-cycle-b',
    raw_issue_parent_id: 'linear-cycle-a',
  },
];

const links = sandbox.resolveParentLinks(rows);
ok(links.get('title-matched-sibling') === 'true-parent',
  'a title-matched child follows its real parent across creation batches');
ok(links.get('cross-team-sibling') === 'true-parent',
  'a real parent link is not constrained by team');
ok(links.get('cross-client-sibling') === 'true-parent',
  'a real parent link is not constrained by client');
ok(links.get('grandchild') === 'title-matched-sibling',
  'a valid three-level hierarchy preserves a child that is also a parent');
ok(!links.has('same-batch-root'),
  'an unparented batch-mate stays a root instead of becoming a sibling child');
ok(!links.has('unresolved-parent'),
  'a missing parent fails closed as a visible root');
ok(!links.has('self-parent'),
  'a self-parent link fails closed');
ok(!links.has('duplicate-parent-child'),
  'an ambiguous duplicate Linear parent fails closed');
ok(!links.has('cycle-a') && !links.has('cycle-b'),
  'a cyclic parent graph fails closed');

const adapter = extractFunction('_prodAdapter');
ok(/const parentLinks = _prodResolveParentLinks\(deliverables\)/.test(adapter)
  && /parent: parentLinks\.get\(String\(d\.id \|\| ''\)\) \|\| null/.test(adapter),
'the Production adapter consumes only resolved parent links');
// The batch layer is exact-UUID linkage, not a heuristic: a child adopts a
// batch parent only when its raw_issue_parent_id equals a Linear UUID the
// batch RECORDS, and only where the deliverable map resolved nothing. Title
// matching and batch-membership grouping stay forbidden.
ok(!/batchTeamKey|_prodSameTitle|_prodIsBatchParent/.test(adapter)
  && !/\.title === |sameTitle|byTitle/.test(adapter),
  'the Production adapter has no batch-membership or title parent heuristic');
ok(/const batchParents = _prodResolveBatchParentNodes\(deliverables, batches, parentLinks\)/.test(adapter)
  && /if \(!i\.parent && batchParents\.links\.has\(i\.id\)\) i\.parent = batchParents\.links\.get\(i\.id\)/.test(adapter)
  && /syntheticBatchParent: true/.test(adapter),
'native children hang under a synthesized batch parent only where the deliverable map resolved nothing');
// The synthetic parent must never fire the three deliverable-scoped readers:
// each would answer with a red error for a row that does not exist. Assets
// come from the batch row itself and the comment panel shows its calm empty
// state; the composer gate text explains where the work lives.
const ensureAssets = extractFunction('_prodEnsureAssets');
ok(/if \(issue\.syntheticBatchParent === true\)/.test(ensureAssets)
  && ensureAssets.indexOf('syntheticBatchParent') < ensureAssets.indexOf('_syncviewStaffIdentityForHeaders'),
'the asset prober short-circuits for a batch parent before any authenticated read');
const ensureDescription = extractFunction('_prodEnsureDescription');
ok(/if \(issue\.syntheticBatchParent === true\)/.test(ensureDescription)
  && ensureDescription.indexOf('syntheticBatchParent') < ensureDescription.indexOf('_syncviewStaffIdentityForHeaders'),
'the description reader short-circuits for a batch parent before any authenticated read');
ok(/if \(loadIssue && loadIssue\.syntheticBatchParent === true\) \{/.test(source)
  && /status: 'ready', items: \[\], cursor: null, hasMore: false,\n\s*loadingMore: false, moreError: '', clientSurface: null,\n\s*clientSurfaceVerified: false\n\s*\}\);\n\s*repaint\(\);/.test(source),
'the comment thread renders its empty state for a batch parent instead of the scope error');
ok(/filming_plan: String\(node\.batch\.filming_doc_url \|\| ''\)/.test(adapter)
  && /raw_footage: String\(node\.batch\.footage_folder_url \|\| ''\)/.test(adapter)
  && /delivery_folder: String\(node\.batch\.delivery_folder_url \|\| ''\)/.test(adapter),
'the synthetic parent shows the folder links the batch row already holds');

ok(/const attributions = _prodResolveAttributions\(deliverables, activeClients, parentLinks\)/.test(adapter)
  && adapter.indexOf('_prodResolveAttributions(deliverables, activeClients, parentLinks)')
    < adapter.indexOf('_prodResolveBatchParentNodes(deliverables, batches, parentLinks)'),
'attribution still consumes the deliverable-only parent map, so the display layer cannot move a verdict');

// Behavioral: the batch-parent resolver in a VM, same style as above.
vm.runInContext(
  // The resolver calls _prodBatchClaimWins for a same-kind collision, so the
  // helper has to come across with it or the sandbox throws on the real path.
  extractFunction('_prodBatchClaimWins') + '\n'
    + extractFunction('_prodResolveBatchParentNodes')
    + '\nthis.resolveBatchParents = _prodResolveBatchParentNodes;',
  sandbox,
);
{
  const batchRows = [
    { id: 'native-batch', client_slug: 'alpha', name: 'Alpha · 18 Aug',
      linear_parent_ids: { video: { uuid: 'lin-native-parent', identifier: 'VID-1', url: 'u', owner_team: 'video' },
        graphics: { uuid: 'lin-native-parent', identifier: 'VID-1', url: 'u', owner_team: 'video' } } },
    { id: 'imported-batch', client_slug: 'alpha', name: 'Imported',
      linear_parent_ids: { video: { uuid: 'linear-parent', identifier: 'VID-0', url: 'u' } } },
    { id: 'twin-batch-a', client_slug: 'alpha', name: 'Twin A',
      linear_parent_ids: { graphics: { uuid: 'lin-shared', identifier: 'GRA-9', url: 'u' } } },
    { id: 'twin-batch-b', client_slug: 'alpha', name: 'Twin B',
      linear_parent_ids: { graphics: { uuid: 'lin-shared', identifier: 'GRA-9', url: 'u' } } },
  ];
  const childRows = [
    { id: 'native-child', raw_issue_parent_id: 'lin-native-parent' },
    { id: 'imported-child', linear_issue_uuid: 'linear-parent', raw_issue_parent_id: '' },
    { id: 'deliv-claimed-child', raw_issue_parent_id: 'linear-parent' },
    { id: 'twin-child', raw_issue_parent_id: 'lin-shared' },
    { id: 'already-linked', raw_issue_parent_id: 'lin-native-parent' },
  ];
  const priorLinks = new Map([['already-linked', 'some-deliverable-parent']]);
  const result = sandbox.resolveBatchParents(childRows, batchRows, priorLinks);
  ok(result.links.get('native-child') === 'native-batch',
    'a native child adopts the batch that records its exact Linear parent UUID');
  ok(result.nodes.get('native-batch') && result.nodes.get('native-batch').team === 'video'
    && result.nodes.get('native-batch').identifier === 'VID-1',
    'the synthesized node carries the owner team and identifier, deduped across per-team entries');
  ok(!result.links.has('deliv-claimed-child'),
    'a UUID claimed by a deliverable row is never claimed by a batch (imported cards untouched)');
  /* AMENDED 2026-09-02. This asserted the twin pair "fails closed as
     ambiguous". Failing closed here does not protect anyone: it deletes the
     post from Scene View. Measured across all 1,660 live batches, all 10 real
     same-kind collisions are ONE post imported twice (8 byte-identical names),
     so there is no second post to mislabel. The pair now resolves through the
     measured cascade -- sub-issue count, description length, lower id -- and
     with both twins empty and equal it lands on the lower id, deterministically.
     See test/batch-parent-same-kind-tiebreak.js. */
  ok(result.links.get('twin-child') === 'twin-batch-a',
    'two batches recording one UUID now resolve to a single deterministic winner instead of deleting the post');
  ok(!result.links.has('already-linked'),
    'a child the deliverable map already resolved keeps that parent');
  ok(!result.nodes.has('imported-batch'),
    'a batch whose UUID a deliverable row already claims still produces no synthesized node — imported cards stay untouched');
  ok(result.nodes.has('twin-batch-a') && !result.nodes.has('twin-batch-b'),
    'and exactly ONE of the twins synthesizes a node — the winner, never both, which would put the same children under two parents');
}

/*
 * A batch that parents BOTH teams keeps both parents (2026-08-24).
 *
 * linear_parent_ids is a per-team map because one batch legitimately has a
 * video parent issue and a graphics parent issue -- two different Linear
 * issues. `nodes` was keyed by batch id, so the second team overwrote the
 * first: one synthetic row survived, every child of both teams hung under it,
 * and a deep link by the losing team's identifier resolved to nothing. The
 * case above only covers the MIRRORED shape, where both slots hold the same
 * uuid and the dedupe hides the collapse; this is the correctly-filled shape.
 */
{
  const batchRows = [
    { id: 'dual-batch', client_slug: 'alpha', name: 'Dual',
      linear_parent_ids: {
        video: { uuid: 'lin-vid', identifier: 'VID-5', url: 'uv', owner_team: 'video' },
        graphics: { uuid: 'lin-gra', identifier: 'GRA-5', url: 'ug', owner_team: 'graphics' },
      } },
  ];
  const childRows = [
    { id: 'vid-child', raw_issue_parent_id: 'lin-vid' },
    { id: 'gra-child', raw_issue_parent_id: 'lin-gra' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  ok(result.nodes.size === 2,
    'a batch with a video parent AND a graphics parent synthesizes BOTH, not whichever row came last');
  const ids = Array.from(result.nodes.keys()).sort();
  ok(ids[0] === 'dual-batch' && ids[1] === 'dual-batch::lin-vid',
    'one keeps the bare batch id so existing ids and ?d= URLs never change meaning, the other is suffixed');
  ok(result.links.get('gra-child') !== result.links.get('vid-child'),
    'and each team of children hangs under its OWN parent rather than the survivor');
  const identifiers = Array.from(result.nodes.values()).map(n => n.identifier).sort();
  ok(identifiers.join(',') === 'GRA-5,VID-5',
    'both Linear identifiers stay reachable — the losing one is what a deep link could not find');
  ok(Array.from(result.nodes.values()).every(n => n.batchId === 'dual-batch'),
    'both still name the batch they belong to, so batch grouping is unaffected');

  // Deterministic: the same inputs in the other row order produce the same ids.
  const reversed = sandbox.resolveBatchParents(childRows.slice().reverse(), batchRows, new Map());
  ok(Array.from(reversed.nodes.keys()).sort().join(',') === ids.join(','),
    'the ids do not depend on the order rows happened to arrive in');
}
/*
 * A batch created entirely NATIVELY -- outbound skipped -- has no Linear
 * parent at all: `linear_parent_ids` is null, not just missing an entry.
 * Everything above keys off that field, so without this branch the batch
 * mints no synthetic parent and its own children surface as bare top-level
 * issues with no "Sub-issue of" and no way back to their batch or siblings
 * (the reported bug). ONE PARENT PER CARD (owner ruling 2026-08-18, the same
 * rule production-write's own batch-create intake follows): a batch mints
 * exactly ONE synthetic parent regardless of how many teams it serves, owned
 * by the primary team (video when present), and every child of every team
 * links to that SAME node -- not one row per team, which would leave a video
 * card with no route to its own thumbnail siblings and show duplicate
 * representations of one batch.
 */
{
  const batchRows = [
    { id: 'native-only-batch', client_slug: 'alpha', name: 'Native Only Batch',
      linear_parent_ids: null },
  ];
  const childRows = [
    { id: 'native-vid-1', batch_id: 'native-only-batch', team: 'video' },
    { id: 'native-vid-2', batch_id: 'native-only-batch', team: 'video' },
    { id: 'native-vid-3', batch_id: 'native-only-batch', team: 'video' },
    { id: 'native-gra-1', batch_id: 'native-only-batch', team: 'graphics' },
    { id: 'native-gra-2', batch_id: 'native-only-batch', team: 'graphics' },
    { id: 'native-gra-3', batch_id: 'native-only-batch', team: 'graphics' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  ok(result.nodes.size === 1,
    'a native batch with video AND graphics children synthesizes exactly ONE parent node, shared by both teams');
  const [onlyNode] = Array.from(result.nodes.values());
  ok(onlyNode.batchId === 'native-only-batch',
    'the single synthetic parent names the native batch it was minted from');
  ok(onlyNode.team === 'video',
    'the shared parent is owned by the primary team (video, when the batch has one) -- same rule as the backend intake\'s own batch-create');
  const sharedNodeId = result.links.get('native-vid-1');
  ok(!!sharedNodeId, 'video children resolve to the shared synthetic parent');
  ['native-vid-1', 'native-vid-2', 'native-vid-3', 'native-gra-1', 'native-gra-2', 'native-gra-3'].forEach(id => {
    ok(result.links.get(id) === sharedNodeId,
      'child ' + id + ' (either team) links to the ONE shared synthetic parent, not a per-team one');
  });

  // Deterministic: the same inputs in a different row order produce the same links.
  const reversed = sandbox.resolveBatchParents(childRows.slice().reverse(), batchRows, new Map());
  ok(reversed.links.get('native-vid-1') === sharedNodeId && reversed.links.get('native-gra-1') === sharedNodeId,
    'the native synthetic parent id does not depend on row order either');
}
{
  // A row with an EXPLICIT parent edge that fails to resolve (missing,
  // duplicated, self-referential, or cyclic target) must stay a root, never
  // get silently reparented to its batch -- that would invent a relationship
  // the data never claimed, reversing the fail-closed behavior proven above
  // for the Linear-backed cases.
  const batchRows = [
    { id: 'native-unresolved-batch', client_slug: 'alpha', name: 'Native Unresolved Batch',
      linear_parent_ids: null },
  ];
  const childRows = [
    { id: 'native-unresolved-1', batch_id: 'native-unresolved-batch', team: 'video',
      raw_issue_parent_id: 'ghost-uuid-that-resolves-to-nothing' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  ok(!result.links.has('native-unresolved-1'),
    'a row with an unresolved explicit parent edge stays a root instead of falling back to its batch');
}
{
  // A batch mixing genuinely native rows (no Linear identity at all) with a
  // Linear-born row that simply has no recorded parent
  // (docs/syncview-design/tests/prod-structure-subset.js's `same-batch-root`
  // shape). The native rows are real evidence the batch needs a synthetic
  // parent and link to it; the Linear-born row is NOT that evidence -- it
  // already has a real Linear identity and no parent was ever recorded for
  // it, so it must stay a root exactly like the unparented-batch-mate case
  // proven for the Linear-backed branch above. Sweeping it into the native
  // synthetic parent would invent a relationship the data never claimed.
  const batchRows = [
    { id: 'mixed-native-batch', client_slug: 'alpha', name: 'Mixed Native Batch',
      linear_parent_ids: null },
  ];
  const childRows = [
    { id: 'mixed-native-1', batch_id: 'mixed-native-batch', team: 'video' },
    { id: 'mixed-native-2', batch_id: 'mixed-native-batch', team: 'video' },
    { id: 'mixed-linear-root', batch_id: 'mixed-native-batch', team: 'video', linear_issue_uuid: 'linear-mixed-root' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  const mixedNodeId = result.links.get('mixed-native-1');
  ok(!!mixedNodeId, 'the native rows still mint and link to a synthetic parent');
  ok(result.links.get('mixed-native-2') === mixedNodeId,
    'both native rows link to the SAME synthetic parent');
  ok(!result.links.has('mixed-linear-root'),
    'the Linear-born unparented row is NOT swept into the native synthetic parent -- it stays a root');
}
{
  /* MIXED BATCH, shape one: the batch's Linear parent became a node, and
     native-born children added after the outbound cutoff must find it. Before
     PR 1494 the fallback only knew about nodes the native-minting loop had
     itself created -- nothing, for a batch that already counts as
     Linear-backed -- so those children were left top-level. */
  const batchRows = [
    { id: 'mixed-linear-batch', client_slug: 'alpha', name: 'Mixed Linear Batch',
      linear_parent_ids: JSON.stringify([{ uuid: 'uuid-mixed-parent', team: 'video' }]) },
  ];
  const childRows = [
    { id: 'pre-cutoff-child', batch_id: 'mixed-linear-batch', team: 'video',
      linear_issue_uuid: 'uuid-pre-child', raw_issue_parent_id: 'uuid-mixed-parent' },
    { id: 'post-cutoff-native', batch_id: 'mixed-linear-batch', team: 'video' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  const parentNode = result.links.get('pre-cutoff-child');
  ok(!!parentNode, 'the pre-cutoff child still resolves through its own raw_issue_parent_id');
  ok(result.links.get('post-cutoff-native') === parentNode,
    'the native-born child lands under the SAME parent as its pre-cutoff batch mates');
}
{
  /* MIXED BATCH, shape two, which the first fix still missed (Codex P1 on PR
     1494). Here the batch's Linear parent has itself been imported as a
     deliverable row, so the `byUuid` pass skips that uuid on purpose
     (`deliverableUuids`) -- the issue is already in the tree and a second node
     would double it. The batch therefore never counts as Linear-backed, while
     `hasUsableParentIds` stops the native mint because it DOES record a parent
     uuid, leaving it with no node at all: a nodes-only fallback cannot see it.
     The native-born child has to attach to the parent's own row id, which is
     where _prodResolveParentLinks already puts its pre-cutoff siblings. */
  const batchRows = [
    { id: 'deliverable-parent-batch', client_slug: 'alpha', name: 'Deliverable Parent Batch',
      linear_parent_ids: JSON.stringify([{ uuid: 'uuid-imported-parent', team: 'video' }]) },
  ];
  const childRows = [
    { id: 'imported-parent-row', batch_id: 'deliverable-parent-batch', team: 'video',
      linear_issue_uuid: 'uuid-imported-parent' },
    { id: 'native-under-imported', batch_id: 'deliverable-parent-batch', team: 'video' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  ok(result.links.get('native-under-imported') === 'imported-parent-row',
    'a native-born child attaches to the deliverable row representing its batch\'s Linear parent');
  ok(!result.links.has('imported-parent-row'),
    'the imported parent row itself is never reparented under anything');
}
{
  // Ambiguity attaches nothing rather than guessing: two rows claiming one
  // Linear uuid is the duplicate case _prodResolveParentLinks already drops,
  // and this fallback drops it identically.
  const batchRows = [
    { id: 'ambiguous-parent-batch', client_slug: 'alpha', name: 'Ambiguous Parent Batch',
      linear_parent_ids: JSON.stringify([{ uuid: 'uuid-claimed-twice', team: 'video' }]) },
  ];
  const childRows = [
    { id: 'claimant-a', batch_id: 'ambiguous-parent-batch', team: 'video', linear_issue_uuid: 'uuid-claimed-twice' },
    { id: 'claimant-b', batch_id: 'ambiguous-parent-batch', team: 'video', linear_issue_uuid: 'uuid-claimed-twice' },
    { id: 'native-under-ambiguous', batch_id: 'ambiguous-parent-batch', team: 'video' },
  ];
  const result = sandbox.resolveBatchParents(childRows, batchRows, new Map());
  ok(!result.links.has('native-under-ambiguous'),
    'a native-born child stays a root when its batch\'s recorded parent uuid is claimed by two rows');
}
/*
 * FOLLOW-UP INVESTIGATION (Fix 2/3 of the native-card sweep after #1444):
 * does _prodResolveParentLinks need its OWN native-batch fallback, or does
 * #1444's _prodResolveBatchParentNodes -- wired in by _prodAdapter exactly
 * where _prodResolveParentLinks resolved nothing -- already cover it?
 *
 * A genuinely native child has neither `linear_issue_uuid` (no Linear
 * identity) nor `raw_issue_parent_id` (no Linear-derived parent pointer), so
 * _prodResolveParentLinks -- which matches purely on those two Linear-side
 * fields -- produces no entry for it at all: first proven directly below.
 * That is exactly Fix 2's stated symptom. But _prodAdapter never uses
 * _prodResolveParentLinks alone: it always follows it with
 * _prodResolveBatchParentNodes and keeps that second pass's answer for any
 * row the first pass left parentless (`if (!i.parent && batchParents.links
 * .has(i.id)) i.parent = batchParents.links.get(i.id)`, pinned by the
 * "the Production adapter consumes only resolved parent links" /
 * "native children hang under a synthesized batch parent" checks above).
 * _prodResolveBatchParentNodes's own native branch (also proven above, the
 * "native-only-batch" cases) resolves precisely this shape by batch_id
 * grouping -- the SAME grouping this suite already pins.
 *
 * So the combined pipeline _prodAdapter actually runs already resolves a
 * genuinely native child's parent correctly, through the mechanism #1444
 * shipped. Fix 2 needs no additional code in _prodResolveParentLinks: doing
 * so would duplicate, and could diverge from, the one batch-parent notion of
 * truth _prodResolveBatchParentNodes already owns. This block is the traced
 * proof of that conclusion, run end to end rather than argued from reading.
 */
{
  const nativeChild = {
    id: 'native-child-no-parent-link', batch_id: 'native-fallback-batch', team: 'video',
    // Deliberately neither field: no Linear identity, no Linear-derived
    // parent pointer.
    linear_issue_uuid: '', raw_issue_parent_id: '',
  };
  const soleParentLinks = sandbox.resolveParentLinks([nativeChild]);
  ok(!soleParentLinks.has('native-child-no-parent-link'),
    '_prodResolveParentLinks ALONE resolves nothing for a genuinely native child -- the stated Fix 2 symptom is real in isolation');

  const nativeBatches = [
    { id: 'native-fallback-batch', client_slug: 'alpha', name: 'Native Fallback Batch', linear_parent_ids: null },
  ];
  const batchParents = sandbox.resolveBatchParents([nativeChild], nativeBatches, soleParentLinks);
  // Mirrors _prodAdapter's own merge exactly: keep the deliverable-map
  // answer if there is one, otherwise take the batch-parent fallback.
  const issue = { id: nativeChild.id, parent: soleParentLinks.get(nativeChild.id) || null };
  if (!issue.parent && batchParents.links.has(issue.id)) issue.parent = batchParents.links.get(issue.id);
  ok(issue.parent === 'native-fallback-batch',
    'the SAME combined pipeline _prodAdapter runs (parentLinks, then the batch-parent fallback) resolves the native child to its batch parent -- Fix 2 is already satisfied end to end, no code change needed');
}

ok(/linear_issue_uuid/.test(source)
  && /production_deliverables_browser_v1/.test(source)
  && /raw_issue_parent_id,raw_project_id/.test(source)
  && /if \(!_prodBrowserProjectionMissing\(error\)\) throw error/.test(source),
'the safe lightweight Production projection carries stable Linear issue and parent UUIDs');

if (failures) {
  console.error('\nproduction-parent-link-hierarchy: ' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('production-parent-link-hierarchy: true Linear parent links pinned');
