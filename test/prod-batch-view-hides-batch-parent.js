'use strict';
/*
 * The batch view must not list the batch itself as a deliverable.
 *
 * Seen 2026-09-24 on batch bat_7eef3235-ceb4-469a-ac22-719f323ac359 (a mixed
 * video + thumbnail batch): the Deliverables list opened with an extra row
 * titled with the batch's own name, with a checkbox and status circle, and no
 * such deliverable exists in the database. It was the synthetic batch parent
 * the app mints in memory for a batch whose Linear parent is not a row; it
 * carries the batch id, so `_prodBatchRows` kept it. Only batches that mint one
 * (a Linear parent named in linear_parent_ids, with children pointing at it)
 * showed the extra row, which is why it looked batch-specific.
 *
 * The same shape arrives from B1 imports as a REAL row: a Linear parent issue
 * filed inside the same batch as its own children. It is the batch, not work.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

let failures = 0;
function ok(c, m) { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } }

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function build(rows) {
  const body = extractFunction(source, '_prodBatchRows')
    + '\nreturn _prodBatchRows;';
  return new Function('_prodIssues', '_prodChildOrder', body)(() => rows, (a, b) => a.title.localeCompare(b.title));
}

const B = 'bat_x';
const rows = [
  { id: B, batchId: B, title: 'Batch name', syntheticBatchParent: true, parent: null },
  { id: 'v1', batchId: B, title: 'Video 1', parent: B },
  { id: 't1', batchId: B, title: 'Thumbnail 1', parent: B },
  { id: 'other', batchId: 'bat_y', title: 'Elsewhere', parent: null },
];
const titles = build(rows)(B).map(r => r.title);
ok(!titles.includes('Batch name'), 'the synthetic batch parent is not listed as a deliverable');
ok(titles.length === 2 && titles.includes('Video 1') && titles.includes('Thumbnail 1'), 'the real deliverables are all still listed');

const imported = [
  { id: 'p', batchId: 'b1_b_x', title: 'Batch name', parent: null, isHierarchyParent: true },
  { id: 'c1', batchId: 'b1_b_x', title: 'Video 1', parent: 'p' },
];
const importedTitles = build(imported)('b1_b_x').map(r => r.title);
ok(importedTitles.length === 1 && importedTitles[0] === 'Video 1', 'an imported Linear parent filed with its own children is not listed');

const lone = [{ id: 'solo', batchId: 'b1_b_z', title: 'A standalone task', parent: null }];
ok(build(lone)('b1_b_z').length === 1, 'a standalone row with no children in the batch is still listed');

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log('\nprod-batch-view-hides-batch-parent: all passed');
