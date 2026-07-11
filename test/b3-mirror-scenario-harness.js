'use strict';

const fs = require('fs');
const path = require('path');
const {
  STATUS_LADDER,
  CONSISTENCY_MODELS,
  PARTIAL_WEBHOOK_CONTRACT,
  isRetryableLinearRead,
  parseThread,
  rawContains,
  isMirrorVisible,
  parentIdFromRow,
  issueSnapshot,
  assertTestIssue,
  stateMapFromTeams,
  findState,
  eventCommentId,
  commentObservation,
  compactReconcile,
  compactPollObservation,
  deliverableSnapshotMatches,
  markdownReport,
} = require('../scripts/b3-mirror-scenario-harness');
const { classifyDeliverable } = require('../scripts/linear-deliverables-reconcile-lib');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const config = {
  projectId: 'project_test',
  projectName: 'Sidney Laruel',
};
const safeIssue = {
  id: 'linear_issue_test',
  identifier: 'VID-99999',
  title: 'TEST fixture',
  state: { id: 'state_todo', name: 'Todo', type: 'unstarted' },
  team: { id: 'team_video', key: 'VID' },
  project: { id: 'project_test', name: 'Sidney Laruel' },
  assignee: null,
  parent: null,
  dueDate: null,
  priority: 0,
  archivedAt: null,
  canceledAt: null,
};

ok(assertTestIssue(safeIssue, config) === safeIssue, 'TEST VID issue passes the fail-closed guard');
for (const [patch, message] of [
  [{ identifier: 'CON-1' }, 'non-VID/GRA identifier is rejected'],
  [{ project: { id: 'real_project', name: 'Real Client' } }, 'non-TEST project is rejected'],
  [{ identifier: 'GRA-1', team: { id: 'team_video', key: 'VID' } }, 'identifier/team mismatch is rejected'],
]) {
  let threw = false;
  try { assertTestIssue({ ...safeIssue, ...patch }, config); } catch (_error) { threw = true; }
  ok(threw, message);
}

const teams = [
  {
    key: 'VID',
    states: {
      nodes: [
        { id: 'state_todo', name: 'Todo', type: 'unstarted' },
        { id: 'state_progress', name: 'In Progress', type: 'started' },
        { id: 'state_kasper', name: 'For Kasper approval', type: 'started' },
        { id: 'state_unknown', name: 'Fixture Mystery', type: 'started' },
      ],
    },
  },
];
const stateMap = stateMapFromTeams(teams);
ok(stateMap.state_todo === 'todo' && stateMap.state_progress === 'in_progress', 'active workflow states map to reconciler slugs');
ok(stateMap.state_kasper === 'kasper_approval', 'For Kasper approval is the active Tweak Applied gate');
ok(!stateMap.state_unknown, 'unknown state is deliberately left unmapped');
ok(findState(teams, 'VID', 'kasper_approval').id === 'state_kasper', 'status-step lookup uses the shared state mapper');
ok(STATUS_LADDER.some(step => step.label === 'Tweak Applied' && step.slug === 'kasper_approval' && step.activeAlias === 'For Kasper approval'),
  'status ladder records the active-team Tweak Applied alias explicitly');
ok(CONSISTENCY_MODELS.create === 'refresh-eventual'
  && CONSISTENCY_MODELS.clear.includes('reconciler-eventual')
  && CONSISTENCY_MODELS.reparent.includes('refresh-eventual'),
  'scenario matrix records the realtime, reconciler, and refresh consistency boundaries');
ok(PARTIAL_WEBHOOK_CONTRACT.dueDateClear === 'omitted'
  && PARTIAL_WEBHOOK_CONTRACT.assigneeClear === 'omitted'
  && PARTIAL_WEBHOOK_CONTRACT.reparent === 'parentId-only',
  'partial-webhook expectations match the retained TEST payload evidence');
ok(isRetryableLinearRead('query HarnessRead { viewer { id } }', 503), 'transient Linear read failures are retryable');
ok(!isRetryableLinearRead('mutation HarnessWrite { issueUpdate { success } }', 503), 'Linear mutations are never retried automatically');

ok(parseThread('[{"body":"one"}]').length === 1 && parseThread('bad').length === 0, 'thread parser is deterministic and fail-safe');
ok(rawContains({ video: { uuid: 'parent_uuid', identifier: 'VID-1' } }, ['parent_uuid']), 'batch parent search matches nested values');
ok(!rawContains({ video: { uuid: 'parent_uuid' } }, ['other_uuid']), 'batch parent search rejects unrelated values');

const liveRow = {
  status: 'todo',
  linear_raw: { issue: { archivedAt: null, canceledAt: null, parent: { id: 'parent_1' } } },
};
ok(isMirrorVisible(liveRow), 'normal mirrored row is visible');
ok(!isMirrorVisible({ ...liveRow, linear_raw: { issue: { archivedAt: '2026-07-11T00:00:00Z' } } }), 'archived issue is hidden');
ok(!isMirrorVisible({ ...liveRow, raw_issue_canceled_at: '2026-07-11T00:00:00Z' }), 'lightweight canceled marker is hidden');
ok(!isMirrorVisible({ ...liveRow, linear_raw: { archived: true } }), 'top-level archive marker is hidden');
ok(parentIdFromRow(liveRow) === 'parent_1', 'parent expectation reads the inbound raw issue shape');
const compactLatest = compactPollObservation({
  id: 'deliverable_test',
  identifier: 'VID-99999',
  status: 'todo',
  due_date: '2026-07-20',
  assignee_id: 'member_1',
  updated_at: '2026-07-11T00:00:00Z',
  linear_raw: { issue: { parent: { id: 'parent_1' } }, large_private_blob: 'not-copied' },
});
ok(compactLatest.parent_id === 'parent_1' && compactLatest.due_date === '2026-07-20' && !('linear_raw' in compactLatest),
  'timeout reports compact the last row instead of copying its raw payload');
const expectedRow = {
  id: 'deliverable_test',
  identifier: 'VID-99999',
  batch_id: 'batch_original',
  client_slug: 'test-client',
  team: 'video',
  kind: 'video',
  title: 'Fixture',
  status: 'todo',
  linear_issue_uuid: 'linear_issue_test',
  linear_identifier: 'VID-99999',
  linear_raw: { issue: { parent: null } },
  linear_aliases: { identifier: 'VID-99999' },
  comments: '[]',
};
ok(deliverableSnapshotMatches({ ...expectedRow, updated_at: 'server-owned' }, expectedRow),
  'cleanup comparison ignores server-generated timestamps');
ok(!deliverableSnapshotMatches({ ...expectedRow, linear_raw: { issue: { parent: { id: 'late_parent' } } } }, expectedRow),
  'cleanup comparison catches a late webhook restoring stale parent metadata');

const snapshot = issueSnapshot({
  ...safeIssue,
  dueDate: '2026-07-20T00:00:00Z',
  priority: 3,
  assignee: { id: 'linear_user_1' },
  parent: { id: 'parent_1' },
});
ok(snapshot.dueDate === '2026-07-20' && snapshot.priority === 3 && snapshot.assigneeId === 'linear_user_1' && snapshot.parentId === 'parent_1',
  'cleanup snapshot pins every mutable issue field');

const nestedEvent = { payload: { payload: { linear_comment_id: 'comment_1' } } };
ok(eventCommentId(nestedEvent) === 'comment_1', 'comment expectation reads the RPC-nested event payload');
const comments = JSON.stringify([
  { body: 'marker-genuine', is_tweak: false, done: false, round: null, parent_id: null, author: 'Fixture Editor' },
]);
const observedComments = commentObservation(comments, 'marker-genuine', 'marker-echo');
ok(observedComments.genuine_count === 1 && observedComments.echo_count === 0 && observedComments.pinned,
  'comment expectation requires one genuine pinned entry and no echo');

const member = { id: 'member_1', linear_user_id: 'known_user' };
const baseDeliverable = {
  id: 'deliverable_test',
  identifier: 'VID-99999',
  team: 'video',
  kind: 'video',
  title: 'TEST fixture',
  status: 'todo',
  priority: 0,
  assignee_id: null,
  origin: 'manual',
  linear_raw: { issue: { parent: null } },
};
const baseLinear = {
  ...safeIssue,
  comments: { nodes: [] },
};
let classification = classifyDeliverable({
  deliverable: { ...baseDeliverable, linear_raw: { issue: { parent: null }, unknown_assignee: { linear_user_id: 'ghost_user' } } },
  linearIssue: { ...baseLinear, assignee: { id: 'ghost_user', name: 'Fixture Ghost' } },
  events: [],
  memberById: new Map([[member.id, member]]),
  memberByLinearId: new Map([[member.linear_user_id, member]]),
  stateUuidMap: stateMap,
  authority: 'linear',
});
let compact = compactReconcile(classification);
ok(compact.diff_count === 0 && compact.repair_list_size === 1 && compact.repair_reasons.includes('unknown_assignee'),
  'unknown assignee expectation is repair-only, never a real diff');

classification = classifyDeliverable({
  deliverable: { ...baseDeliverable, linear_raw: { issue: { parent: null }, unmapped_state: { id: 'state_unknown' } } },
  linearIssue: { ...baseLinear, state: { id: 'state_unknown', name: 'Fixture Mystery', type: 'started' } },
  events: [],
  memberById: new Map(),
  memberByLinearId: new Map(),
  stateUuidMap: stateMap,
  authority: 'linear',
});
compact = compactReconcile(classification);
ok(compact.diff_count === 0 && compact.tolerated_reasons.includes('unmapped_state_refused'),
  'unmapped-state expectation is tolerated after the inbound marker lands');

const rendered = markdownReport({
  run_marker: 'fixture-run',
  started_at: 'start',
  finished_at: 'finish',
  test_project_name: 'Sidney Laruel',
  total: 2,
  passed: 1,
  failed: 1,
  skipped: 0,
  cleanup_complete: true,
  final_reconciler: { diff_count: 0, repair_list_size: 0, linkage_actionable: 0 },
  scenarios: [
    { name: 'Fixture pass', consistency: 'realtime', status: 'PASS', latency_ms: 10, fired: ['VID-99999'], expected: { ok: true }, observed: { ok: true } },
    { name: 'Fixture red', consistency: 'refresh-eventual', status: 'FAIL', latency_ms: 20, fired: [], expected: { ok: true }, observed: { ok: false } },
  ],
});
ok(/Fixture pass \| realtime \| PASS/.test(rendered) && /Fixture red \| refresh-eventual \| FAIL/.test(rendered),
  'coverage report keeps consistency and red scenarios visible');
ok(/Final reconciler: diff=0, repair=0, linkage=0/.test(rendered), 'coverage report records the final 0/0/0 gate');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b3-mirror-scenario-harness.js'), 'utf8');
const refreshSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
ok(/B3_CONFIRM_TEST_MUTATIONS === '1'/.test(source), 'live harness requires explicit TEST mutation confirmation');
ok(/Configured client is not the active TEST client/.test(source), 'live preflight requires clients.kind=test');
ok(/\^\(VID\|GRA\)-\\d\+\$/.test(source), 'live guard restricts identifiers to VID/GRA');
ok(/method: 'GET'[\s\S]{0,180}apikey: this\.config\.anonKey/.test(source), 'all Supabase observations use the anon key');
ok(/\['deliverable_write', 'batch_write'\]\.includes\(name\)/.test(source), 'service-role cleanup is restricted to the two ledgered RPCs');
ok(!/syncview_runtime_flags/.test(source), 'harness does not read or mutate runtime flags');
ok(!/rest\/v1\/mirror_outbox|from\(['"]mirror_outbox/.test(source), 'harness never touches mirror_outbox');
ok(/const PROJECT_FILTER = clean\(args\.get\('--project-id'\)\)/.test(refreshSource)
  && /issueProjectId\(issue\) === PROJECT_FILTER/.test(refreshSource),
  'incremental refresh supports an opt-in TEST-project write scope');
ok(/runNodeScript\('scripts\/b1-linear-backfill\.js'/.test(source)
  && /'--project-id',[\s\S]*this\.config\.projectId/.test(source),
  'harness invokes refresh through the TEST-project scope');
ok(/runNodeScript\('scripts\/linear-deliverables-reconcile\.js'/.test(source)
  && /`--identifier=\$\{issue\.identifier\}`/.test(source),
  'harness invokes reconciliation through the TEST-identifier scope');
ok(/status = 'SKIPPED'/.test(source), 'no unmapped state is reported SKIPPED rather than red');
ok(!/teamId.*allowed|projectId.*allowed/.test(source), 'issueUpdate allow-list cannot move an issue to another team/project');
const cleanupSource = source.slice(source.indexOf('async restoreScenarioSnapshots('), source.indexOf('async withRestoration('));
ok(cleanupSource.indexOf('restoreLinearSnapshot') < cleanupSource.indexOf('cleanupSettleMs')
  && cleanupSource.indexOf('cleanupSettleMs') < cleanupSource.indexOf('restoreDeliverableSnapshot')
  && /deliverableSnapshotMatches/.test(cleanupSource),
  'cleanup lets inbound settle, applies the exact row snapshot, and verifies it');
ok(!/Supabase cleanup reflection/.test(source), 'cleanup never waits on the inbound path before reaching its RPC fallback');

if (failures) {
  console.error(`\n${failures} B3 mirror harness check(s) failed`);
  process.exit(1);
}
console.log('\nB3 mirror scenario harness offline checks passed');
