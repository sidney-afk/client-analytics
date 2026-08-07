'use strict';
/*
 * B1 importer must reuse an existing deliverable row's primary key when that row
 * already represents the Linear issue, instead of minting its own.
 *
 * THE OUTAGE THIS GUARDS (2026-08-07, P0, ~90 minutes).
 *
 * `deliverableId()` mints `b1_d_<linear-uuid>`. A deliverable created natively
 * through the production-write gateway instead carries a `del_<uuid>` id, plus
 * the same `linear_issue_uuid`. The write-candidate dedupe in both plan builders
 * is keyed on the row id, so the native row was invisible to it and the importer
 * planned an INSERT for an issue it already stored. `deliverables_linear_uuid_live`
 * (a partial unique index on linear_issue_uuid) answered 23505; the deliverable
 * write loop has no per-row guard, so the whole run aborted; and the incremental
 * cursor only advances on an `ok:true` summary, so `changed_since` froze and every
 * later run re-read the same window and re-collided.
 *
 * Net effect: no Linear-born issue could enter SyncView for ANY client — including
 * hand-made sub-issues from an SMM — and it could not self-heal. It had cleared
 * itself in the past only because the colliding rows were disposable TEST fixtures
 * deleted in Linear; the first real client's open issue never disappears.
 *
 * `softClosedDeliverableRow` had always done the right thing (`id: existing.id`).
 * The bug was that the operational path did not.
 *
 * Guard both directions: reuse when the uuid is known, mint when it is not.
 */
const assert = require('node:assert');
const { deliverableRow } = require('../scripts/b1-linear-backfill.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const LINEAR_UUID = '4264ca43-6e6f-4106-b005-4363bd034024';
const NATIVE_ID = 'del_6962dc23-84b9-4cf6-a1a8-ef1cdcb40d9b';

const issue = {
  id: LINEAR_UUID,
  identifier: 'GRA-7024',
  title: 'Video 1',
  description: '',
  createdAt: '2026-08-07T15:30:39.685Z',
  updatedAt: '2026-08-07T15:30:39.685Z',
  team: { key: 'GRA', name: 'Graphics' },
  state: { name: 'Todo', type: 'unstarted' },
  assignee: null,
  project: { id: 'project-fixture' },
};

const batch = { id: 'bat_fixture', client_slug: 'fixture-client' };
const batchByKey = { get: () => batch };
const emptyLookup = new Map();
const linksByIdentifier = new Map();
const attributionGraph = { byIssue: new Map(), byProject: new Map() };

function buildRow(existingByUuid) {
  return deliverableRow(
    issue,
    batchByKey,
    emptyLookup,
    emptyLookup,
    linksByIdentifier,
    attributionGraph,
    'fixture-client',
    existingByUuid,
  );
}

// 1. The regression itself: a native row already holds this Linear issue.
const nativeRow = {
  id: NATIVE_ID,
  linear_issue_uuid: LINEAR_UUID,
  identifier: null,
  linear_identifier: 'GRA-7024',
  team: 'graphics',
  status: 'todo',
};
const reused = buildRow(new Map([[LINEAR_UUID, nativeRow]]));
ok(reused.id === NATIVE_ID,
  'a Linear issue already stored under a native id plans an UPDATE to that row, not an INSERT under a minted id');
ok(!String(reused.id).startsWith('b1_d_'),
  'the minted b1_d_ id is not used when the issue is already stored (this is the 23505 collision)');
ok(reused.linear_issue_uuid === LINEAR_UUID,
  'the row still carries the Linear uuid, so the unique index matches the row it is updating');

// 2. The unchanged path: an issue the importer has never seen still gets a minted id.
const minted = buildRow(new Map());
ok(minted.id === 'b1_d_4264ca436e6f4106b0054363bd034024',
  'a genuinely new Linear issue still receives the deterministic b1_d_ id');

// 3. A different issue's row must never be borrowed.
const other = buildRow(new Map([['some-other-uuid', { id: 'del_unrelated', linear_issue_uuid: 'some-other-uuid' }]]));
ok(other.id === 'b1_d_4264ca436e6f4106b0054363bd034024',
  'an unrelated stored row does not donate its id');

// 4. Callers that pass nothing (or a non-Map) must not throw — the parameter is optional.
let tolerated = true;
try {
  const noMap = deliverableRow(issue, batchByKey, emptyLookup, emptyLookup,
    linksByIdentifier, attributionGraph, 'fixture-client');
  assert.strictEqual(noMap.id, 'b1_d_4264ca436e6f4106b0054363bd034024');
  const badMap = deliverableRow(issue, batchByKey, emptyLookup, emptyLookup,
    linksByIdentifier, attributionGraph, 'fixture-client', null);
  assert.strictEqual(badMap.id, 'b1_d_4264ca436e6f4106b0054363bd034024');
} catch (error) {
  tolerated = false;
  console.error('  (threw: ' + (error && error.message) + ')');
}
ok(tolerated, 'omitting the index, or passing null, falls back to minting rather than throwing');

// 5. Both plan builders must actually pass the index — a fix only in the helper
//    would leave the outage in place.
const source = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
const callSites = source.match(/deliverableRow\(\s*\n\s*issue,[\s\S]{0,400?}?\)/g)
  || source.split('operational.map(issue => deliverableRow(').slice(1);
ok(callSites.length >= 2, 'both plan builders call deliverableRow (full backfill + incremental)');
const passesIndex = source.split('operational.map(issue => deliverableRow(').slice(1)
  .every(chunk => /existingDeliverableByUuid/.test(chunk.slice(0, 400)));
ok(passesIndex,
  'every operational deliverableRow call site passes an existing-by-uuid index');

// ---------------------------------------------------------------------------
// Card-slot conflict withholding (2026-08-07, the SECOND wedge of the same day).
//
// deliverables_card_slot_unique allows one video and one graphic deliverable per
// calendar/samples card. An SMM created a second video sub-issue and linked it to
// a card whose video slot was still held by the original issue. The importer then
// planned a write that PostgreSQL rejected with 23505, and because the write loop
// is deliberately unguarded, that single ambiguous card stopped Linear-born
// ingestion for every client — the second full outage of the day, on the same lane.
//
// A row whose slot is held by a DIFFERENT deliverable is now withheld from the
// plan and reported, so the run completes and the ambiguity stays visible.
// Deciding which issue owns the slot is an owner judgement, not the importer's.
const { withholdCardSlotConflicts, cardSlotIndex } = require('../scripts/b1-linear-backfill.js');

const held = {
  id: 'b1_d_original', client_slug: 'fixture-client', origin: 'calendar',
  card_id: 'card-1', kind: 'video', identifier: 'VID-1', linear_issue_uuid: 'uuid-original',
};
const slotIndex = cardSlotIndex([held]);

const intruder = {
  id: 'b1_d_intruder', client_slug: 'fixture-client', origin: 'calendar',
  card_id: 'card-1', kind: 'video', identifier: 'VID-2', linear_issue_uuid: 'uuid-intruder',
};
const sameRow = { ...held, title: 'renamed' };
const otherKind = { ...intruder, id: 'b1_d_graphic', kind: 'thumbnail', identifier: 'GRA-1' };
const otherCard = { ...intruder, id: 'b1_d_othercard', card_id: 'card-2' };
const noCard = { id: 'b1_d_nocard', client_slug: 'fixture-client', origin: 'linear', card_id: null, kind: 'video' };

const out = withholdCardSlotConflicts([intruder, sameRow, otherKind, otherCard, noCard], slotIndex);
const writableIds = out.writable.map(r => r.id);

ok(!writableIds.includes('b1_d_intruder'),
  'a different issue claiming an occupied card slot is withheld from the write plan (this is the 23505)');
ok(out.conflicts.length === 1
  && out.conflicts[0].card_id === 'card-1'
  && out.conflicts[0].holder_identifier === 'VID-1'
  && out.conflicts[0].incoming_identifier === 'VID-2',
'the conflict is reported with both sides, so the ambiguity is visible rather than silently dropped');
ok(writableIds.includes('b1_d_original'),
  'the row that already HOLDS the slot still updates normally');
ok(writableIds.includes('b1_d_graphic'),
  'the other slot on the same card is unaffected (video and graphic are independent)');
ok(writableIds.includes('b1_d_othercard') && writableIds.includes('b1_d_nocard'),
  'a different card, and a row with no card linkage at all, are never withheld');
ok(out.writable.length === 4 && out.conflicts.length === 1,
  'exactly one row is withheld and every other candidate survives');

const planSource = require('node:fs').readFileSync(
  require('node:path').join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
ok((planSource.match(/withholdCardSlotConflicts\(/g) || []).length >= 3,
  'both plan builders route their deliverable candidates through the guard');
ok((planSource.match(/card_slot_conflict_count/g) || []).length >= 2,
  'both plans surface a conflict count, so a withheld row cannot pass unnoticed');


if (failures) {
  console.error(`\n${failures} B1 native-row-id-reuse check(s) failed`);
  process.exit(1);
}
console.log('\nB1 native row id reuse checks passed');
