'use strict';
/*
 * Owner report 2026-09-21: opening a batch parent from the Workload calendar
 * landed on the plain batch view (?prod=1&batch=<id>, a status chip and
 * "Deliverables N"), while the parent card's own detail view
 * (?prod=1&d=<identifier>, "Sub-issues N" with client chip, link, due date,
 * assignee) is the correct page. A batch imported from Linear has a real
 * parent deliverable row -- isHierarchyParent true, not a synthetic node the
 * batch mints for its own children -- and native post-cutoff batches do not.
 *
 * _prodBatchParentIssue(batch) is the pure lookup this pins: read
 * linear_parent_ids (keyed by team, same vocabulary _calNativeBatchParentTeams
 * reads), resolve each named id through _prodIssue(), keep only real
 * hierarchy parents, and answer with the row ONLY when exactly one resolves.
 * _prodOpenBatch and the URL route (_prodPrimeFromUrl, plus the authoritative
 * wanted-id branch in _prodApplyDeepLinkFallback) both consult it before
 * settling on the batch view.
 *
 * This also pins that _prodBatchDetail draws its deliverables list with the
 * parent view's own row renderer, _prodSubIssueRowHTML, rather than a
 * second, plainer markup string -- so a rich row (client chip, due date,
 * assignee, file pill) looks the same whether it is read from a batch or
 * from a real parent's sub-issue section.
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

function build(issues) {
  const byId = new Map();
  issues.forEach(i => {
    byId.set(i.id, i);
    if (i.displayId) byId.set(i.displayId, i);
    if (i.aliasId) byId.set(i.aliasId, i);
  });
  const body = extractFunction(source, '_prodIssue') + '\n'
    + extractFunction(source, '_prodBatchParentIssue') + '\n'
    + 'return { _prodIssue, _prodBatchParentIssue };';
  return new Function('_prodIssues', body)(() => issues);
}

/* ---- exactly one real hierarchy parent resolves -> that row ------------- */

const oneParent = build([
  {
    id: 'VID-13634',
    displayId: 'VID-13634',
    isHierarchyParent: true,
    title: 'The Client 32-Deliverable Post',
  },
]);
const batchWithOneParent = { id: 'bat_1', linear_parent_ids: { video: { identifier: 'VID-13634' } } };
const resolvedOne = oneParent._prodBatchParentIssue(batchWithOneParent);
ok(resolvedOne && resolvedOne.id === 'VID-13634',
  '_prodBatchParentIssue resolves the single real hierarchy parent named by linear_parent_ids');

/* ---- two resolvable parents (video + graphics) -> null, stays on batch -- */

const twoParents = build([
  { id: 'VID-1', displayId: 'VID-1', isHierarchyParent: true, title: 'Video parent' },
  { id: 'GRA-1', displayId: 'GRA-1', isHierarchyParent: true, title: 'Graphics parent' },
]);
const batchWithTwoParents = {
  id: 'bat_2',
  linear_parent_ids: { video: { identifier: 'VID-1' }, graphics: { identifier: 'GRA-1' } },
};
ok(twoParents._prodBatchParentIssue(batchWithTwoParents) === null,
  '_prodBatchParentIssue answers null for a two-team batch with two distinct real parents (stays on the batch view)');

/* ---- no linear_parent_ids at all -> null --------------------------------- */

const none = build([]);
ok(none._prodBatchParentIssue({ id: 'bat_3', linear_parent_ids: {} }) === null,
  '_prodBatchParentIssue answers null for a batch with no linear_parent_ids');
ok(none._prodBatchParentIssue({ id: 'bat_4' }) === null,
  '_prodBatchParentIssue answers null when linear_parent_ids is absent entirely');

/* ---- the named id resolves only to a synthetic batch-mint node ---------- */

const syntheticOnly = build([
  {
    id: 'bat_5',
    displayId: 'VID-99',
    isHierarchyParent: false,
    syntheticBatchParent: true,
    title: 'Batch',
  },
]);
ok(syntheticOnly._prodBatchParentIssue({ id: 'bat_5', linear_parent_ids: { video: { identifier: 'VID-99' } } }) === null,
  '_prodBatchParentIssue never treats a synthetic batch-mint node as a real parent, even when it resolves');

/* ---- a stray non-hierarchy-parent row (e.g. a plain child) never counts - */

const notAParent = build([
  { id: 'VID-2', displayId: 'VID-2', isHierarchyParent: false, title: 'Some other row' },
]);
ok(notAParent._prodBatchParentIssue({ id: 'bat_6', linear_parent_ids: { video: { identifier: 'VID-2' } } }) === null,
  '_prodBatchParentIssue answers null when the named id resolves but is not a hierarchy parent');

/* ---- unrecognized team keys are ignored, same vocabulary as the Calendar - */

const unknownKey = build([
  { id: 'VID-3', displayId: 'VID-3', isHierarchyParent: true, title: 'Real parent' },
]);
ok(unknownKey._prodBatchParentIssue({ id: 'bat_7', linear_parent_ids: { bogus: { identifier: 'VID-3' } } }) === null,
  '_prodBatchParentIssue ignores a linear_parent_ids key outside the video/graphics vocabulary');

/* ---- same uuid claimed twice under both team keys still resolves to one - */

const sameParentBothTeams = build([
  { id: 'VID-4', displayId: 'VID-4', isHierarchyParent: true, title: 'Shared-project parent' },
]);
ok(sameParentBothTeams._prodBatchParentIssue({
  id: 'bat_8',
  linear_parent_ids: { video: { identifier: 'VID-4' }, graphics: { identifier: 'VID-4' } },
}) && sameParentBothTeams._prodBatchParentIssue({
  id: 'bat_8',
  linear_parent_ids: { video: { identifier: 'VID-4' }, graphics: { identifier: 'VID-4' } },
}).id === 'VID-4',
  '_prodBatchParentIssue de-dupes the same resolved parent named under two team keys rather than reading it as two');

/* ---- source: the three call sites consult the helper before the batch view ---- */

ok(/function _prodOpenBatch\(id\) \{[\s\S]{0,900}_prodBatchParentIssue\(_prodBatch\(id\)\)/.test(source),
  '_prodOpenBatch checks _prodBatchParentIssue before falling back to the batch view');
ok(/_prodOpenDeliverable\(parent\.displayId \|\| parent\.id\)/.test(source),
  '_prodOpenBatch opens the resolved parent through _prodOpenDeliverable');

ok(/const primeParent = _prodBatchParentIssue\(_prodBatch\(batch\)\);/.test(source),
  '_prodPrimeFromUrl (the ?prod=1&batch= URL route) also checks _prodBatchParentIssue');

ok(/wanted\.kind === 'batch' && _prodBatch\(wanted\.id\)\) \{\s*const parent = _prodBatchParentIssue\(_prodBatch\(wanted\.id\)\);/.test(source),
  '_prodApplyDeepLinkFallback\'s authoritative wanted-id branch checks _prodBatchParentIssue too');

/* ---- source: _prodBatchDetail draws rows with the parent view's own renderer --- */

ok(/function _prodBatchDetail\(\) \{[\s\S]{0,3000}rows\.map\(_prodSubIssueRowHTML\)/.test(source),
  '_prodBatchDetail renders its deliverables list with _prodSubIssueRowHTML, not a second plain row markup');
ok(!/rows\.map\(d => '<div class="prod-subrow"/.test(source),
  'the old plain prod-subrow markup in the batch view is gone');

if (failures) process.exit(1);
console.log('\nProduction batch-parent routing checks passed');
