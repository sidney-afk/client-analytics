'use strict';
/*
 * B1 must not move rows the native gateway has filed, and must not resurrect
 * batches an operator archived.
 *
 * WHY (2026-08-21). An interrupted 16-video intake was converged by the
 * gateway: rows the importer had materialized mid-incident were adopted back
 * into the intake's deterministic batch and the importer's leftover shell was
 * archived. But `deliverableRow` always recomputed batch_id from its own
 * b1_b_ group key and origin from its card-link lookup, and batch_id/origin
 * are compared write-candidate fields -- so the very next pass over the same
 * Linear family would have stolen the rows back into the shell, rewritten
 * origin to 'manual', and (because batchRowsFor always emits status 'active'
 * and status is a compared batchField) revived the archived shell complete
 * with its duplicate parent map. The incident would silently regrow forever.
 *
 * The rules pinned here:
 *   1. A reused row whose stored batch is NOT b1_b_* keeps its stored batch,
 *      origin, and any stored card linkage. Linear-owned fields still update.
 *   2. Rows in b1_b_* batches keep the importer's existing regrouping
 *      behavior, byte for byte.
 *   3. Both write-candidate filters skip batches whose stored status is
 *      'archived'.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.B1_PRESERVE_SRC || path.join(ROOT, 'scripts', 'b1-linear-backfill.js');
const { deliverableRow } = require(SRC);
const source = fs.readFileSync(SRC, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const LINEAR_UUID = '9f2b41d0-7c5e-4b7a-9d31-2c8a5e6f1a22';
const issue = {
  id: LINEAR_UUID,
  identifier: 'VID-99001',
  title: 'Video 1',
  description: '',
  createdAt: '2026-08-21T20:14:07.886Z',
  updatedAt: '2026-08-21T20:14:07.886Z',
  team: { key: 'VID', name: 'Video' },
  state: { name: 'Todo', type: 'unstarted' },
  assignee: null,
  project: { id: 'project-fixture' },
};
const groupBatch = { id: 'b1_b_groupfixture', client_slug: 'fixture-client' };
const batchByKey = { get: () => groupBatch };
const emptyLookup = new Map();
const noLinks = new Map();
const attributionGraph = { byIssue: new Map(), byProject: new Map() };

function build(existingRow) {
  const existingByUuid = new Map();
  if (existingRow) existingByUuid.set(LINEAR_UUID, existingRow);
  return deliverableRow(
    issue, batchByKey, emptyLookup, emptyLookup, noLinks,
    attributionGraph, 'fixture-client', existingByUuid,
  );
}

// 1. THE RULE: a row filed in a native (non-b1_b_) batch keeps its filing.
const nativeStored = {
  id: 'del_native-fixture', linear_issue_uuid: LINEAR_UUID,
  batch_id: 'bat_native-fixture', origin: 'calendar', card_id: 'p_native_fixture_1',
};
let row = build(nativeStored);
ok(row.id === 'del_native-fixture', 'reused native row keeps its id (pre-existing rule still holds)');
ok(row.batch_id === 'bat_native-fixture', 'native batch filing is preserved, not regrouped into b1_b_*');
ok(row.origin === 'calendar', 'native origin is preserved, not recomputed to manual');
ok(row.card_id === 'p_native_fixture_1', 'stored card linkage is preserved');
ok(row.status === 'todo' && row.linear_identifier === 'VID-99001',
  'Linear-owned fields still come from the issue');

// 2. A row with native filing but no stored card falls back to the link lookup
//    (here: none), never to a b1 regroup.
row = build(Object.assign({}, nativeStored, { card_id: null }));
ok(row.batch_id === 'bat_native-fixture' && row.card_id === null,
  'missing stored card does not un-preserve the batch');

// 3. Rows in b1_b_* batches keep the importer's own regrouping behavior.
row = build({ id: 'b1_d_old', linear_issue_uuid: LINEAR_UUID, batch_id: 'b1_b_older', origin: 'manual', card_id: null });
ok(row.batch_id === 'b1_b_groupfixture', 'importer-filed rows still regroup under the current group key');
ok(row.origin === 'manual', 'importer-filed rows keep the link-derived origin');

// 4. No existing row: minted id, group batch — untouched legacy path.
row = build(null);
ok(String(row.id).startsWith('b1_d_') && row.batch_id === 'b1_b_groupfixture',
  'fresh issues still mint b1 ids into the group batch');

// 5. Both write-candidate filters refuse to touch archived batches.
const archivedSkips = source.match(/if \(existing && clean\(existing\.status\) === 'archived'\) return false;/g) || [];
ok(archivedSkips.length === 2,
  'both batch write-candidate filters skip archived batches (found ' + archivedSkips.length + ' of 2)');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
