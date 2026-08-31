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
  extractFunction('_prodResolveBatchParentNodes')
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
  ok(!result.links.has('twin-child'),
    'a UUID recorded by two batches with no deliverable row fails closed as ambiguous');
  ok(!result.links.has('already-linked'),
    'a child the deliverable map already resolved keeps that parent');
  ok(!result.nodes.has('imported-batch') && !result.nodes.has('twin-batch-a'),
    'only batches an actual child references produce a synthesized node');
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
