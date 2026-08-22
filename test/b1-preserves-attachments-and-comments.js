'use strict';
/*
 * The importer must not have an opinion about file_url or comments.
 *
 * WHY (2026-08-22). `deliverable_write` merges per COLUMN, and the test it
 * applies is key PRESENCE, not value:
 *
 *   file_url = case when v_row ? 'file_url' then excluded.file_url
 *                   else d.file_url end
 *
 * A JSON null is a present key. `deliverableRow` emitted `file_url: null` and
 * `comments: null` on every operational row since 2026-07-10, so those two
 * columns were REPLACED WITH NULL on every write B1 made -- and B1 writes
 * whenever any Linear-owned field drifts, which for an in-flight deliverable
 * is constantly. The importer reads neither attachments nor comments from
 * Linear, so it never had anything to say about them in the first place.
 *
 * Proven against production before the fix: calling the live
 * `deliverable_write` with file_url null on a row holding a Drive link left
 * the column NULL (inside a rolled-back transaction, so nothing persisted).
 * The reason the damage was not universal is that `softClosedDeliverableRow`
 * -- the builder for closed and out-of-window issues -- never emitted the keys
 * at all, so archived rows were untouched while live ones were not.
 *
 * What is pinned here is the BEHAVIOUR, not the shape: the RPC merge rule is
 * modelled and executed against a stored row that holds a file and a comment,
 * so a future edit that restores either key fails on the surviving value, not
 * on a source regex.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.B1_ATTACHMENT_SRC || path.join(ROOT, 'scripts', 'b1-linear-backfill.js');
const { deliverableRow, softClosedDeliverableRow } = require(SRC);
const source = fs.readFileSync(SRC, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* An executable model of the ONE rule in deliverable_write that matters here:
   a column moves only when p_row carries the key. Everything else about the
   function is irrelevant to this suite and is deliberately not modelled. */
const GUARDED = [
  'identifier', 'batch_id', 'client_slug', 'team', 'kind', 'title', 'brief',
  'status', 'status_at', 'assignee_id', 'due_date', 'priority', 'file_url',
  'comments', 'origin', 'card_id', 'sort_key', 'sync_state', 'created_by',
  'created_at', 'linear_issue_uuid', 'linear_identifier', 'linear_issue_url',
  'linear_aliases', 'linear_raw',
];
function deliverableWriteMerge(stored, pRow) {
  const out = Object.assign({}, stored);
  for (const key of GUARDED) {
    if (Object.prototype.hasOwnProperty.call(pRow, key)) out[key] = pRow[key];
  }
  return out;
}

const LINEAR_UUID = 'c41d9a63-8e2f-4a55-b0d7-19f7ac3e5b84';
const FILE = 'https://drive.google.com/file/d/TEST_FILE_ID/view';
const NOTE = 'client asked for a warmer grade on the thumbnail';

const issue = {
  id: LINEAR_UUID,
  identifier: 'GRA-7029',
  title: 'Thumbnail 3',
  description: '',
  createdAt: '2026-08-08T05:11:00.000Z',
  updatedAt: '2026-08-11T15:50:00.000Z',
  dueDate: '2026-08-14',
  priority: 2,
  team: { key: 'GRA', name: 'Graphics' },
  state: { name: 'In Progress', type: 'started' },
  assignee: null,
  project: { id: 'project-fixture' },
};

/* The row as a person left it: a file attached from the production tab and a
   comment typed into the card. B1 knows about neither. */
const stored = {
  id: 'del_b1927eeb-3af6-4c17-a84d-c524be394a0d',
  identifier: 'GRA-7029',
  batch_id: 'b1_b_49d27c1e703e643cbd32f0d69e2c',
  client_slug: 'fixture-client',
  team: 'graphics',
  kind: 'graphic',
  title: 'Thumbnail 3',
  status: 'in_progress',
  origin: 'manual',
  card_id: null,
  created_by: 'linear-backfill',
  created_at: '2026-08-08T05:11:00.000Z',
  file_url: FILE,
  comments: NOTE,
};

const batchByKey = { get: () => ({ id: 'b1_b_49d27c1e703e643cbd32f0d69e2c', client_slug: 'fixture-client' }) };
const attributionGraph = { byIssue: new Map(), byProject: new Map() };
const existingByUuid = new Map([[LINEAR_UUID, stored]]);

const operational = deliverableRow(
  issue, batchByKey, new Map(), new Map(), new Map(),
  attributionGraph, 'unresolved-fixture', existingByUuid,
);

ok(typeof deliverableRow === 'function' && operational && operational.id === stored.id,
  'the real operational builder ran against the stored row (harness is not vacuous)');

// 1. THE DEFECT. A live row keeps its attachment and its comment across a
//    write the importer makes for an unrelated Linear change.
const afterOperational = deliverableWriteMerge(stored, operational);
ok(afterOperational.file_url === FILE,
  'an operational B1 write leaves the attached file in place (got ' + String(afterOperational.file_url) + ')');
ok(afterOperational.comments === NOTE,
  'and leaves the card comment in place (got ' + String(afterOperational.comments) + ')');

// The mechanism, stated directly: presence is the whole test, so a null value
// is just as destructive as a wrong one.
ok(!Object.prototype.hasOwnProperty.call(operational, 'file_url'),
  'file_url is absent from p_row, not present-and-null -- presence is what deliverable_write checks');
ok(!Object.prototype.hasOwnProperty.call(operational, 'comments'),
  'comments is absent from p_row for the same reason');

// 2. Linear-owned fields must still move, or the fix would have bought
//    preservation by making the importer inert.
ok(afterOperational.title === 'Thumbnail 3' && afterOperational.due_date === '2026-08-14'
  && afterOperational.priority === 2 && afterOperational.status === 'in_progress',
  'Linear-owned fields still update in the same write');
ok(afterOperational.linear_issue_uuid === LINEAR_UUID,
  'and the row stays linked to its Linear issue');

// 3. The closed-issue builder always behaved correctly; pin it so the two
//    paths cannot drift apart again.
const soft = softClosedDeliverableRow(
  Object.assign({}, issue, { state: { name: 'Done', type: 'completed' } }),
  stored, attributionGraph, 'unresolved-fixture',
);
const afterSoft = deliverableWriteMerge(stored, soft);
ok(afterSoft.file_url === FILE && afterSoft.comments === NOTE,
  'the soft-closed builder preserves both as well -- the two builders agree');

// 4. Omitting the keys must not make a needed write invisible: neither column
//    is a write-candidate compare field, so nothing about change detection
//    depended on them being emitted.
const compareLists = source.match(/const deliverableFields = \[[^\]]*\]/g) || [];
ok(compareLists.length === 2, 'both write-candidate compare lists were found (got ' + compareLists.length + ')');
ok(compareLists.every(list => !/'file_url'|'comments'/.test(list)),
  'neither compare list mentions file_url or comments, so their absence cannot suppress a write');

// 5. The importer genuinely has no source for either value -- it never reads
//    attachments or comments from Linear -- so silence is the honest answer.
ok(!/attachments\s*\{/.test(source),
  'B1 does not query Linear attachments, so it has no attachment opinion to express');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
