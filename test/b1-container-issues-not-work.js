'use strict';
/*
 * THE IMPORTER STOPS MANUFACTURING THE DEFECT IT TOOK THREE FIXES TO CONTAIN.
 *
 * `batchGroupKey` reads `issue.parent || issue`, so a parent issue grouped
 * WITH its children and was imported as a deliverable row inside its own
 * batch. 75 of 535 open rows were that on 2026-08-27, and three consumers
 * (browser editor pool, gateway auto-assign, picker empty-batch count) each
 * shipped an incident before learning to ignore them. The registry guard
 * makes a fourth consumer safe; `containerIssueIds` makes the rows stop
 * being created at all.
 *
 * The boundary this suite spends its teeth on is the SELF-ONLY group: a
 * standalone work item becomes its own single-issue batch whose parent map
 * names ITSELF. Classify that as a container and every standalone import
 * dies on its second run — silently, estate-wide. Signal (c) therefore
 * requires a sibling row for a DIFFERENT issue before a batch map counts as
 * container evidence.
 */
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js');
const { containerIssueIds } = require(SCRIPT);
const fs = require('node:fs');
const source = fs.readFileSync(SCRIPT, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- signal a: an in-scope child names its parent --------------------------
const scoped = containerIssueIds(
  [
    { id: 'parent-1', title: 'Client · 27 Aug 2026' },
    { id: 'child-1', parent: { id: 'parent-1' } },
    { id: 'loner-1', title: 'A standalone task' },
  ], [], []);
ok(scoped.has('parent-1'), 'an issue named as parent by anything in scope is a container');
ok(!scoped.has('child-1') && !scoped.has('loner-1'),
  'children and standalone issues are not — they are the work');

// ---- signal b: history in existing rows ------------------------------------
/* The parent ref lives in `linear_raw.issue.parent.id` — the TABLE has no
 * raw_issue_parent_id column (that name exists only on the browser view, and
 * selecting it from the table is the 42703 that failed runs 3295/3296 on
 * 2026-08-27). The helper derives from linear_raw, in both the object shape
 * REST returns and the string shape a stale cache or CSV re-import can hold,
 * and still honors an explicit raw_issue_parent_id if a caller hands one in. */
const history = containerIssueIds(
  [{ id: 'parent-2', title: 'Eben-style container, children all cancelled' }],
  [{ id: 'b1_d_x', batch_id: 'b1_b_x', linear_issue_uuid: 'old-child',
     linear_raw: { issue: { parent: { id: 'parent-2' } } } }],
  []);
ok(history.has('parent-2'),
  'a parent whose children have all left the operational set is still a container — its cancelled children remember it');
const historyString = containerIssueIds(
  [{ id: 'parent-2s', title: 'same, but the raw payload is a JSON string' }],
  [{ id: 'b1_d_xs', batch_id: 'b1_b_xs', linear_issue_uuid: 'old-child-s',
     linear_raw: JSON.stringify({ issue: { parent: { id: 'parent-2s' } } }) }],
  []);
ok(historyString.has('parent-2s'),
  'signal b also reads a string-typed linear_raw — the shape is not assumed');
const historyExplicit = containerIssueIds(
  [{ id: 'parent-2e', title: 'same, via an explicit view-shaped field' }],
  [{ id: 'b1_d_xe', batch_id: 'b1_b_xe', linear_issue_uuid: 'old-child-e', raw_issue_parent_id: 'parent-2e' }],
  []);
ok(historyExplicit.has('parent-2e'),
  'an explicit raw_issue_parent_id (view-shaped caller) is still honored');

// ---- signal c: a gateway batch, family split across incremental windows ----
const gatewayRace = containerIssueIds(
  [{ id: 'parent-3', title: 'Jenna Phillips Ballard · 27 Aug 2026' }],
  [{ id: 'del_child', batch_id: 'batch_native_1', linear_issue_uuid: 'child-3', raw_issue_parent_id: '' }],
  [{ id: 'batch_native_1', linear_parent_ids: { video: { uuid: 'parent-3' }, graphics: { uuid: 'parent-3', owner_team: 'video' } } }]);
ok(gatewayRace.has('parent-3'),
  'a gateway-minted parent is caught through its batch even before any child names it — the batch and child rows exist first');

// ---- the boundary: a self-only group is NOT a container --------------------
const standalone = containerIssueIds(
  [{ id: 'solo-1', title: 'Test Issue to check slack automation' }],
  [{ id: 'b1_d_solo', batch_id: 'b1_b_solo', linear_issue_uuid: 'solo-1', raw_issue_parent_id: '' }],
  [{ id: 'b1_b_solo', linear_parent_ids: { video: { uuid: 'solo-1' } } }]);
ok(!standalone.has('solo-1'),
  'a standalone item whose own batch names it as parent is NOT a container — or every standalone import would die on its second run');

// ---- malformed inputs cannot throw ----------------------------------------
const hostile = containerIssueIds(
  [null, {}, { parent: {} }],
  [null, {}, { raw_issue_parent_id: null }, { linear_raw: 'not json {' }, { linear_raw: { issue: null } }],
  [null, {}, { linear_parent_ids: 'not an object' }, { linear_parent_ids: [{ uuid: '' }] }]);
ok(hostile.size === 0, 'nulls, empties and malformed maps contribute nothing rather than throwing');

// ---- both lanes actually use it, before the row build ----------------------
const fullLaneAt = source.indexOf('const containerIds = containerIssueIds(issues, existingDeliverables, existingBatches);');
const secondLaneAt = source.indexOf('const containerIds = containerIssueIds(issues, existingDeliverables, existingBatches);', fullLaneAt + 1);
ok(fullLaneAt > -1 && secondLaneAt > fullLaneAt,
  'the container set is computed in BOTH lanes — full and incremental');
const filters = source.match(/\.filter\(issue => !containerIds\.has\(clean\(issue\.id\)\)\)/g) || [];
ok(filters.length === 2,
  'and both lanes filter the deliverable build through it (' + filters.length + ' of 2 filters found)');
ok(source.indexOf('.concat(operational.filter(issue => containerIds.has(clean(issue.id))))') > -1,
  'a container whose row already exists keeps tracking Linear through the soft lane instead of being re-minted');
/* The data-supply pin, rewritten after the 2026-08-27 incident: the FIRST
 * version of this fix added raw_issue_parent_id to the table selects, but that
 * column exists only on production_deliverables_browser_v1 — PostgREST answers
 * 42703 and the whole run dies (runs 3295/3296). So the pin now guards both
 * directions: the selects must fetch linear_raw (signal b's real source), and
 * the view-only column must never reappear in a table select. */
const deliverableSelects = source.match(/supabaseRows\('deliverables', '[^']*'/g) || [];
ok(deliverableSelects.length >= 2 && deliverableSelects.every(s => s.includes(',linear_raw')),
  'every deliverables select fetches linear_raw, so signal b has data to read ('
  + deliverableSelects.length + ' selects)');
ok(!/supabaseRows\('[^']+', '[^']*raw_issue_parent_id/.test(source),
  'and none selects raw_issue_parent_id — the column is view-only, and asking the table for it is the 42703 that killed the import lane');

if (failures) {
  console.error(`\n${failures} container-issue check(s) failed`);
  process.exit(1);
}
console.log('\nB1 container-issue checks passed — parents are batches, never work');
