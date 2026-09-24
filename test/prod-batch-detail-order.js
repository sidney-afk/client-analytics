'use strict';
/*
 * The batch detail view (?prod=1&batch=<id>) rendered _prodBatchRows(batchId)
 * as-is, and that function only FILTERED -- it never sorted. On a 16-video
 * batch the rows come back in fetch order, so videos and thumbnails land
 * interleaved and out of numeric order, unlike the parent view's sub-issue
 * section (_prodChildrenOf), which has ordered video-then-graphics,
 * numerically, since the owner's 2026-08-19 ruling.
 *
 * The fix lifts the comparator out of _prodChildrenOf into a shared
 * _prodChildOrder(a, b) and sorts _prodBatchRows' result with it too, so both
 * views agree. This pins that with a synthetic 32-row batch (16 videos + 16
 * thumbnails) in shuffled fetch order, asserting Video 1..16 then
 * Thumbnail 1..16 -- the same shape of defect as prod-subissue-order.js, but
 * for the batch detail reader rather than the sub-issue section.
 */

const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function constant(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*([^;]+);');
  const m = re.exec(source);
  if (!m) throw new Error('missing const ' + name);
  return m[0];
}

function build(rows) {
  const body = constant('PROD_TEAM_ORDER') + '\n'
    + extractFunction(source, '_prodWriteTeam') + '\n'
    + extractFunction(source, '_prodChildTeamRank') + '\n'
    + extractFunction(source, '_prodChildOrder') + '\n'
    + extractFunction(source, '_prodChildrenOf') + '\n'
    + extractFunction(source, '_prodBatchRows') + '\n'
    + 'return { _prodBatchRows, _prodChildrenOf };';
  return new Function('_prodIssues', body)(() => rows);
}

function buildEligible() {
  const body = extractFunction(source, '_prodAssetEligibleRow')
    + '\nreturn _prodAssetEligibleRow;';
  return new Function('_prodClient', 'PROD_ATTRIBUTION_NEEDS', 'PROD_ATTRIBUTION_CONFLICT', body)(
    slug => (slug === 'acme' ? { id: 'acme' } : null),
    '__needs_attribution__',
    '__attribution_conflict__',
  );
}

// 16 videos + 16 thumbnails, shuffled fetch order (interleaved, not grouped,
// not numeric) -- the shape the owner reported.
const BATCH_ID = 'batch-1';
function shuffledFetchOrder() {
  const videos = [];
  const thumbs = [];
  for (let n = 1; n <= 16; n++) {
    videos.push({ id: 'v' + n, batchId: BATCH_ID, parent: 'p1', title: 'Video ' + n, team: 'video' });
    thumbs.push({ id: 't' + n, batchId: BATCH_ID, parent: 'p1', title: 'Thumbnail ' + n, team: 'graphics' });
  }
  // Deterministic interleave that also scrambles numeric order within each
  // team, e.g. Video 9 arrives before Video 2.
  const rows = [];
  for (let n = 1; n <= 16; n++) {
    rows.push(thumbs[(n * 7) % 16]);
    rows.push(videos[(n * 5) % 16]);
  }
  return rows;
}

const EXPECTED = []
  .concat(Array.from({ length: 16 }, (_, i) => 'Video ' + (i + 1)))
  .concat(Array.from({ length: 16 }, (_, i) => 'Thumbnail ' + (i + 1)));

const rows = shuffledFetchOrder();
const { _prodBatchRows, _prodChildrenOf } = build(rows);

const batchOrder = _prodBatchRows(BATCH_ID).map(r => r.title);
ok(JSON.stringify(batchOrder) === JSON.stringify(EXPECTED),
  '_prodBatchRows orders a 16-video batch as Video 1..16 then Thumbnail 1..16');

// Only rows of the requested batch, still.
const withOtherBatch = build(rows.concat([
  { id: 'x1', batchId: 'batch-2', parent: 'p1', title: 'Video 1', team: 'video' },
]));
ok(withOtherBatch._prodBatchRows(BATCH_ID).length === 32,
  '_prodBatchRows still excludes rows from a different batch');

// The parent view keeps the same order through the shared comparator.
const parentOrder = _prodChildrenOf('p1').map(r => r.title);
ok(JSON.stringify(parentOrder) === JSON.stringify(EXPECTED),
  '_prodChildrenOf agrees with _prodBatchRows -- both read _prodChildOrder');

// The shared comparator itself is what both callers use.
ok(/function _prodChildrenOf\(id\) \{\s*return _prodIssues\(\)\.filter\(d => d\.parent === id\)\.sort\(_prodChildOrder\);/.test(source),
  '_prodChildrenOf sorts with the shared _prodChildOrder comparator');
ok(/function _prodBatchRows\(batchId\) \{[\s\S]*?\.sort\(_prodChildOrder\);\s*\}/.test(source),
  '_prodBatchRows sorts with the same shared _prodChildOrder comparator');

// --- asset-source choice stays decoupled from display order ---------------
// Sorting _prodBatchRows makes rows[0] deterministically the numerically
// first deliverable, which is not guaranteed to be the one with usable
// client attribution. The batch panel and its prefetch must pick the asset
// source by ELIGIBILITY, not by display position (Codex, PR #1467).
const eligible = buildEligible();
const unattributedFirst = [
  { id: 'v1', title: 'Video 1', team: 'video' }, // no scope at all
  { id: 'v2', title: 'Video 2', team: 'video', authorityProject: 'acme' },
];
ok(eligible(unattributedFirst) && eligible(unattributedFirst).id === 'v2',
  '_prodAssetEligibleRow skips an unattributed first row for an eligible later one');

const needsAttrFirst = [
  { id: 'v1', title: 'Video 1', team: 'video', authorityProject: '__needs_attribution__' },
  { id: 'v2', title: 'Video 2', team: 'video', authorityProject: 'acme' },
];
ok(eligible(needsAttrFirst) && eligible(needsAttrFirst).id === 'v2',
  '_prodAssetEligibleRow skips the __needs_attribution__ sentinel too');

ok(eligible([]) === null, '_prodAssetEligibleRow answers null when nothing is eligible');

ok(/const assetRow = _prodAssetEligibleRow\(rows\) \|\| rows\[0\];/.test(source),
  '_prodBatchDetail chooses its asset panel source by eligibility, not rows[0]');
ok(/_prodAssetsPanelHTML\(assetRow, \{ slots:/.test(source),
  'the batch panel renders against the eligibility-chosen row');
ok(/const assetRow = _prodAssetEligibleRow\(batchRows\) \|\| batchRows\[0\];/.test(source),
  'the batch-view asset prefetch also chooses by eligibility, not display position');

if (failures) process.exit(1);
console.log('\nProduction batch-detail ordering checks passed');
