'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const vm = require('vm');
const {
  D27_LIVE_ERA_START,
  classifyOutboundDeliverable,
  classifyOutboundBatch,
  historicalWriteDisposition,
  summarize,
} = require('../scripts/linear-deliverables-reconcile-lib');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const ROOT = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

(async () => {
  const mapping = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'linear-outbound',
    'mapping.mjs',
  )).href);
  const monitoring = await import(pathToFileURL(path.join(
    ROOT,
    'supabase',
    'functions',
    'linear-outbound',
    'monitoring.mjs',
  )).href);

  const baseRow = {
    operation: 'status',
    actor: 'Fixture Editor',
    dedup_key: 'fixture:status:1',
    source_edited_at: '2026-07-11T12:00:00Z',
    payload: { linear_issue_id: 'issue_fixture', status: 'approved' },
  };
  const issue = {
    id: 'issue_fixture',
    updatedAt: '2026-07-11T11:59:00Z',
    title: 'Fixture title',
    dueDate: null,
    priority: 1,
    archivedAt: null,
    state: { id: 'state_todo', name: 'Todo' },
    assignee: null,
    parent: null,
    comments: { nodes: [] },
  };

  ok(mapping.OUTBOUND_OPERATIONS.length === 10, 'all ten outbound operations are enumerated');
  ok(mapping.D27_LIVE_ERA_START === D27_LIVE_ERA_START,
    'reconciler and Edge Function share the exact D-27 live-era boundary');
  const status = mapping.buildMutation(baseRow, { state_id: 'state_approved', linear_issue_id: 'issue_fixture' });
  ok(status.kind === 'issueUpdate' && status.variables.input.stateId === 'state_approved',
    'status maps to issueUpdate.stateId');
  const bumpedStatus = mapping.buildMutation({
    ...baseRow,
    payload: { ...baseRow.payload, due_date: '2026-07-15' },
  }, { state_id: 'state_approved', linear_issue_id: 'issue_fixture' });
  ok(bumpedStatus.variables.input.stateId === 'state_approved'
    && bumpedStatus.variables.input.dueDate === '2026-07-15',
  'overdue status bump is one atomic Linear state + dueDate update');
  const sameStateBump = mapping.buildMutation({
    ...baseRow,
    payload: { ...baseRow.payload, due_date: '2026-07-15' },
  }, { state_id: 'state_approved', status_already_applied: true, linear_issue_id: 'issue_fixture' });
  ok(sameStateBump.variables.input.stateId === 'state_approved'
    && sameStateBump.variables.input.dueDate === '2026-07-15',
  'same-state overdue bumps retain the full state + due intent in the acknowledged mutation');
  ok(mapping.decideConflict(
    { ...baseRow, payload: { ...baseRow.payload, due_date: '2026-07-15' } },
    { ...issue, state: { id: 'state_approved' }, dueDate: '2026-07-14' },
    { state_id: 'state_approved' },
  ).decision === 'apply', 'matching state does not suppress a still-pending due bump');
  ok(mapping.decideConflict(
    { ...baseRow, payload: { ...baseRow.payload, due_date: '2026-07-15' } },
    { ...issue, state: { id: 'state_approved' }, dueDate: '2026-07-15' },
    { state_id: 'state_approved' },
  ).decision === 'already_applied', 'combined status + due bump is idempotent only when both fields match');
  ok(monitoring.pendingAgeThresholdMinutes({ minutes: 45 }) === 45
    && monitoring.pendingAgeThresholdMinutes({ minutes: 0 }) === 30,
  'pending-age threshold is runtime-configurable with a 30-minute safe default');
  ok(JSON.stringify(monitoring.pendingAgeAlertTeams(
    { video: 31, graphics: 120 },
    { video: 'syncview', graphics: 'linear' },
    30,
  )) === JSON.stringify(['video']), 'pending-age alerts page only SyncView-authoritative teams');
  const twoSlotParents = mapping.mergeBatchParentIds(
    { video: { uuid: 'video-parent', identifier: 'VID-1', url: 'https://example.invalid/video' } },
    'graphics',
    { id: 'graphic-parent', identifier: 'GRA-1', url: 'https://example.invalid/graphic' },
  );
  ok(twoSlotParents.video.uuid === 'video-parent' && twoSlotParents.graphics.uuid === 'graphic-parent',
    'batch native-create linkage preserves the other team in the two-slot parent map');

  const due = mapping.buildMutation({ ...baseRow, operation: 'due', payload: { linear_issue_id: 'issue_fixture', due_date: null } });
  ok(due.variables.input.dueDate === null, 'due clear maps to explicit null');
  const assignee = mapping.buildMutation({ ...baseRow, operation: 'assignee', payload: { linear_issue_id: 'issue_fixture', linear_user_id: null } });
  ok(assignee.variables.input.assigneeId === null, 'assignee clear maps to explicit null');
  const title = mapping.buildMutation({ ...baseRow, operation: 'title', payload: { linear_issue_id: 'issue_fixture', title: 'New title' } });
  ok(title.variables.input.title === 'New title', 'title maps to issueUpdate.title');
  const priority = mapping.buildMutation({ ...baseRow, operation: 'priority', payload: { linear_issue_id: 'issue_fixture', priority: 4 } });
  ok(priority.variables.input.priority === 4, 'priority maps to issueUpdate.priority');
  const parent = mapping.buildMutation({ ...baseRow, operation: 'parent', payload: { linear_issue_id: 'issue_fixture', parent_linear_issue_id: null } });
  ok(parent.variables.input.parentId === null, 'parent clear maps to explicit null');
  const archive = mapping.buildMutation({ ...baseRow, operation: 'archive', payload: { linear_issue_id: 'issue_fixture' } });
  const restore = mapping.buildMutation({ ...baseRow, operation: 'restore', payload: { linear_issue_id: 'issue_fixture' } });
  ok(archive.kind === 'issueArchive' && restore.kind === 'issueUnarchive',
    'archive and restore map to their dedicated mutations');

  const comment = mapping.buildMutation({
    ...baseRow,
    operation: 'comment',
    dedup_key: 'fixture:comment:1',
    payload: { linear_issue_id: 'issue_fixture', body: 'Fixture comment' },
  });
  ok(comment.kind === 'commentCreate'
    && /via SyncView/.test(comment.variables.input.body)
    && mapping.markerFromBody(comment.variables.input.body) === 'fixture:comment:1',
  'comment mapping carries the visible convention and hidden dedup marker');

  const create = mapping.buildMutation({
    ...baseRow,
    operation: 'create',
    payload: {
      team_id: 'team_fixture',
      project_id: 'project_fixture',
      title: 'Fixture create',
      status: 'todo',
    },
  }, { state_id: 'state_todo', create_id: '00000000-0000-5000-8000-000000000001' });
  ok(create.kind === 'issueCreate'
    && create.variables.input.id === '00000000-0000-5000-8000-000000000001'
    && create.variables.input.teamId === 'team_fixture'
    && create.variables.input.projectId === 'project_fixture',
  'native create maps to issueCreate with team and project');

  ok(mapping.decideConflict(baseRow, issue, { state_id: 'state_approved' }).decision === 'apply',
    'an older Linear value allows the SyncView intent');
  ok(mapping.decideConflict(
    { ...baseRow, source_edited_at: '2026-07-11T11:58:00Z' },
    issue,
    { state_id: 'state_approved' },
  ).decision === 'stale', 'a newer Linear edit drops the queued write');
  ok(mapping.decideConflict(
    baseRow,
    { ...issue, state: { id: 'state_approved' } },
    { state_id: 'state_approved' },
  ).decision === 'already_applied', 'an already-applied value is idempotent');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'comment', source_edited_at: '2026-07-11T11:58:00Z', payload: { body: 'Additive note' } },
    { ...issue, updatedAt: '2026-07-11T12:05:00Z' },
  ).decision === 'apply', 'a newer unrelated issue edit does not discard an additive comment');
  ok(mapping.decideConflict(
    { ...baseRow, source_edited_at: '2026-07-11T12:00:00Z' },
    { ...issue, updatedAt: '2026-07-11T12:05:00Z' },
    { state_id: 'state_approved', field_updated_at: '2026-07-11T11:59:00Z' },
  ).decision === 'stale', 'live Linear updatedAt safely bounds an omitted-field clock during resume');

  const historicalEntity = {
    created_by: 'linear-backfill',
    created_at: '2026-07-08T12:00:00Z',
    linear_raw: { issue: { completedAt: null } },
  };
  const liveEntity = { ...historicalEntity, created_at: '2026-07-12T05:00:00Z' };
  const oldActiveEntity = {
    created_by: 'ui',
    origin: 'manual',
    created_at: '2026-07-08T12:00:00Z',
    linear_raw: { issue: { completedAt: null } },
  };
  const completedHistoricalEntity = {
    ...oldActiveEntity,
    linear_raw: { issue: { completedAt: '2026-07-10T12:00:00Z' } },
  };
  ok(historicalWriteDisposition('parent', historicalEntity).decision === 'tolerated_historical'
    && historicalWriteDisposition('restore', historicalEntity).decision === 'tolerated_historical',
  'reconciler suppresses historical parent and restore operations');
  ok(historicalWriteDisposition('parent', liveEntity) === null
    && historicalWriteDisposition('parent', oldActiveEntity) === null
    && historicalWriteDisposition('restore', completedHistoricalEntity).decision === 'tolerated_historical',
  'D-27 uses the live-era boundary plus explicit backfill or completed-work evidence');
  ok(['create', 'status', 'comment', 'due', 'assignee', 'title', 'priority', 'archive']
    .every(operation => historicalWriteDisposition(operation, historicalEntity) === null),
  'all non-parent/non-restore operations on historical work remain writable');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'parent', payload: { parent_linear_issue_id: 'parent_new' } },
    issue,
    { entity: historicalEntity, parent_linear_issue_id: 'parent_new' },
  ).decision === 'tolerated_historical', 'drainer mapping suppresses a queued historical parent operation');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'restore', payload: {} },
    { ...issue, archivedAt: '2026-07-10T00:00:00Z' },
    { entity: historicalEntity },
  ).decision === 'tolerated_historical', 'drainer mapping suppresses a queued historical restore');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'parent', payload: { parent_linear_issue_id: 'parent_new' } },
    issue,
    { entity: liveEntity, parent_linear_issue_id: 'parent_new' },
  ).decision === 'apply', 'drainer mapping still emits a live-era parent operation');

  const member = { id: 'member_fixture', linear_user_id: 'linear_user_fixture' };
  const outbound = classifyOutboundDeliverable({
    deliverable: {
      id: 'del_fixture',
      client_slug: 'fixture-client',
      team: 'video',
      title: 'SyncView title',
      status: 'approved',
      due_date: '2026-07-15',
      priority: 2,
      assignee_id: member.id,
      updated_at: '2026-07-11T12:00:00Z',
      linear_issue_uuid: 'issue_fixture',
      linear_raw: {},
    },
    linearIssue: issue,
    memberById: new Map([[member.id, member]]),
    stateUuidMap: { state_todo: 'todo' },
    expectedParentId: '',
    outboxComments: [{
      comment_id: 'comment_missing',
      outbox_id: 77,
      body: 'Fixture missing comment',
      source_edited_at: '2026-07-11T12:00:00Z',
    }],
  });
  ok(outbound.direction === 'outbound' && outbound.diffs.length >= 4,
    'syncview-authoritative classification measures the outbound direction');
  ok(outbound.outbound_intents.some(intent => intent.operation === 'status')
    && outbound.outbound_intents.some(intent => intent.operation === 'title'),
  'outbound differences produce queue intents');
  ok(outbound.outbound_intents.some(intent => intent.operation === 'comment'
    && intent.requeue_outbox_id === 77),
  'missing outbound comment reuses its original idempotent outbox row');
  const historicalOutbound = classifyOutboundDeliverable({
    deliverable: {
      ...outbound.row,
      ...historicalEntity,
      title: 'Historical local title',
      linear_issue_uuid: 'issue_fixture',
    },
    linearIssue: { ...issue, title: 'Historical Linear title', parent: { id: 'parent_old' } },
    memberById: new Map([[member.id, member]]),
    stateUuidMap: { state_todo: 'todo' },
    expectedParentId: 'parent_new',
    outboxComments: [],
  });
  ok(!historicalOutbound.diffs.some(diff => diff.field === 'parent')
    && !historicalOutbound.outbound_intents.some(intent => intent.operation === 'parent')
    && historicalOutbound.tolerated.some(item => item.reason === 'tolerated_historical' && item.operation === 'parent'),
  'backfill-origin parent mismatch is reported as tolerated and never enqueued');
  ok(historicalOutbound.outbound_intents.some(intent => intent.operation === 'title'),
    'D-27 leaves title behavior on historical work unchanged');
  const summary = summarize([outbound], []);
  ok(summary.outbound_diff_count === outbound.diffs.length && summary.inbound_diff_count === 0,
    'reconciler summary separates outbound from inbound drift');
  const batchOutbound = classifyOutboundBatch({
    batch: {
      id: 'bat_fixture',
      client_slug: 'fixture-client',
      team: 'video',
      name: 'SyncView batch',
      status: 'active',
      updated_at: '2026-07-11T12:00:00Z',
    },
    linearIssue: { ...issue, title: 'Linear batch' },
    outboxComments: [],
  });
  ok(batchOutbound.entity === 'batch'
    && batchOutbound.outbound_intents.some(intent => intent.operation === 'title'),
  'two-way reconciler measures batch-parent title drift');
  const historicalRestore = classifyOutboundBatch({
    batch: {
      id: 'bat_historical', client_slug: 'fixture-client', team: 'video',
      name: 'Historical batch', status: 'active', ...historicalEntity,
    },
    linearIssue: { ...issue, title: 'Historical batch', archivedAt: '2026-07-10T00:00:00Z' },
    outboxComments: [],
  });
  const liveRestore = classifyOutboundBatch({
    batch: {
      id: 'bat_live', client_slug: 'fixture-client', team: 'video',
      name: 'Live batch', status: 'active', ...liveEntity,
    },
    linearIssue: { ...issue, title: 'Live batch', archivedAt: '2026-07-12T05:05:00Z' },
    outboxComments: [],
  });
  ok(historicalRestore.diffs.length === 0
    && historicalRestore.outbound_intents.length === 0
    && historicalRestore.tolerated.some(item => item.reason === 'tolerated_historical' && item.operation === 'restore'),
  'historical batch restore is reported but never emitted');
  ok(liveRestore.diffs.some(item => item.reason === 'outbound_batch_archive_mismatch')
    && liveRestore.outbound_intents.some(item => item.operation === 'restore'),
  'live-era batch restore remains an outbound operation');
  const d27Summary = summarize([historicalOutbound, historicalRestore, liveRestore], []);
  ok(d27Summary.tolerated_historical === 2
    && d27Summary.by_team.video.tolerated_historical === 2,
  'reconciler summary reports D-27 tolerances explicitly at total and team scope');
  const entitySummary = summarize([outbound, batchOutbound], []);
  ok(entitySummary.deliverables_checked === 1 && entitySummary.batches_checked === 1,
    'two-way summary reports deliverable and batch coverage separately');

  const migration = read('migrations/2026-07-11-b4-linear-outbound.sql');
  [
    'source_edited_at',
    'dedup_key',
    'linear_result',
    'shadow_actual',
    'track_b_enqueue_outbound_intent',
    'linear_outbound_enabled',
    'mirror_outbox_requeue',
    '{"mode":"off"}',
  ].forEach(token => ok(migration.includes(token), 'migration includes ' + token));
  ok(/new\.source <> 'ui'/.test(migration), 'only explicit UI ledger events enqueue');
  ok(/on conflict \(dedup_key\) do nothing/.test(migration), 'dedup key is idempotent');
  ok(/source in \([^)]*'outbound'/.test(migration), 'outbound summary events are ledger-valid');
  ok(/revoke all on function public\.mirror_outbox_requeue\(bigint\)[\s\S]*to service_role/.test(migration),
    'comment requeue RPC is service-role only');

  const ef = read('supabase/functions/linear-outbound/index.ts');
  ok(/linear_outbound_enabled/.test(ef) && /prod_authority/.test(ef),
    'drainer reads both switch and team authority');
  ok(/currentControl\(supabase, row, testOverride, f27Replay\)/.test(ef),
    'drainer re-reads control before each row');
  ok(/unlockPending\(supabase, row, testClient \? 0 : 30\)/.test(ef),
    'production pause keeps backoff while the service-only TEST drill can resume immediately');
  ok(/serviceRoleRequest/.test(ef) && /kind !== "test"/.test(ef) && /row\.test_only/.test(ef),
    'TEST override is service-only and fail-closed to test rows');
  ok(/deterministicCreateId/.test(ef)
    && /checkpointLinearResult/.test(ef)
    && /recovered_idempotently/.test(ef),
  'native create uses a deterministic Linear id and checkpoints before local linkage');
  ok(/row\.entity === "comment" && row\.batch_id/.test(ef) && /batchParentId/.test(ef),
    'batch comments resolve their batch parent issue rather than a deliverable row');
  const ownIssueResolver = ef.match(/function linearIssueId\([^]*?\n\}/);
  ok(ownIssueResolver && !/dependency\.linear_issue_id|dependency\.issue_id/.test(ownIssueResolver[0]),
    'a create dependency supplies parentId only and is never mistaken for the child issue');
  ok(/status: "stale"/.test(ef) && /linear_newer_than_syncview_intent/.test(read('supabase/functions/linear-outbound/mapping.mjs')),
    'newer Linear edits are marked stale, not overwritten');
  ok(/conflict\.decision === "tolerated_historical"/.test(ef)
    && /counts\.tolerated_historical\+\+/.test(ef),
  'drainer skips and counts defensively queued historical structure writes');
  ok(/linear_outbound_summary/.test(ef)
    && /echo_dropped/.test(ef)
    && /shadow_vs_actual_divergence/.test(ef),
  'each run writes the required watcher metrics');
  const oldestPending = ef.match(/async function oldestPendingMinutesByTeam\([^]*?\n\}/);
  ok(oldestPending
    && /\["pending", "failed", "shadow_ok"\]/.test(oldestPending[0])
    && /attempts/.test(oldestPending[0])
    && !/\.lt\("attempts"|MAX_ATTEMPTS/.test(oldestPending[0]),
  'per-team oldest pending age includes retry-exhausted failed rows');
  ok(/oldest_pending_minutes/.test(ef)
    && /oldest_pending_alert_threshold_minutes/.test(ef)
    && /oldest_pending_age/.test(ef),
  'drain summaries publish age, runtime threshold, and pager state');
  ok(/syncview_live/.test(ef)
    && /WRITE_UI_SYNCVIEW_LIVE/.test(ef)
    && /targetedSyncviewLive && mode === "live"/.test(ef),
  'normal targeted requests are accepted only through the confirmed live SyncView lane');

  const inbound = read('supabase/functions/linear-inbound/index.ts');
  ok(/mirror_actor_id/.test(inbound)
    && /outboundValueMatches/.test(inbound)
    && /mirror_out_echo_dropped/.test(inbound),
  'inbound echo drop requires mirror identity plus matching written intent');
  ok(/return \{ ok: true, dropped: "syncview_mirror_echo"/.test(inbound),
    'matched mirror echoes stop before inbound write handling');
  const outboundMatcherSource = inbound.match(/function outboundValueMatches\([^]*?\n\}/);
  ok(!!outboundMatcherSource, 'inbound exact-value echo matcher is present');
  if (outboundMatcherSource) {
    const echoContext = {
      clean: value => String(value == null ? '' : value).trim(),
      lower: value => String(value == null ? '' : value).trim().toLowerCase(),
      objectAt: value => value && typeof value === 'object' && !Array.isArray(value) ? value : {},
      payloadAction: payload => String(payload && payload.action || '').toLowerCase(),
      outboundExpected: row => row.linear_result.expected.input,
      outboundMarker: () => '',
    };
    vm.createContext(echoContext);
    vm.runInContext(outboundMatcherSource[0].replace(
      /function outboundValueMatches\([^\n]+\): boolean \{/,
      'function outboundValueMatches(row, payload, issue, comment) {',
    ), echoContext);
    const dueOnlyReceipt = {
      operation: 'status', status: 'written', processed_at: '2026-07-13T12:00:00Z',
      linear_result: { expected: { input: { dueDate: '2026-07-15' } } },
    };
    const fullReceipt = {
      operation: 'status', status: 'written', processed_at: '2026-07-13T12:00:00Z',
      linear_result: { expected: { input: { stateId: 'state_approved', dueDate: '2026-07-15' } } },
    };
    const exactIssue = { state: { id: 'state_approved' }, dueDate: '2026-07-15' };
    const laterExternalState = { state: { id: 'state_tweak' }, dueDate: '2026-07-15' };
    ok(echoContext.outboundValueMatches(dueOnlyReceipt, { action: 'update' }, laterExternalState, {}) === false
      && echoContext.outboundValueMatches(fullReceipt, { action: 'update' }, laterExternalState, {}) === false
      && echoContext.outboundValueMatches(fullReceipt, { action: 'update' }, exactIssue, {}) === true,
    'due-only receipts and different-state/same-due webhooks never echo-drop; exact state + due does');
  }

  const sharedWrite = read('supabase/functions/_shared/b4-write.ts');
  ok(/rpc\/b4_service_role_probe/.test(ef)
    && /rpc\/b4_service_role_probe/.test(sharedWrite)
    && !/mirror_outbox\?select=id&limit=0/.test(ef + sharedWrite),
  'service authentication uses an execute-grant probe, never an RLS-filtered zero-row read');
  ok(/revoke all on function public\.b4_service_role_probe\(\)[\s\S]*from public, anon, authenticated/.test(migration)
    && /grant execute on function public\.b4_service_role_probe\(\)[\s\S]*to service_role/.test(migration),
  'service-role probe is inaccessible to public, anon, and authenticated roles');
  ok(/team_is_linear_authoritative/.test(sharedWrite), 'paused teams refuse new SyncView writes');
  ok(/sourceEditTimestamp\(body\.source_edited_at\)/.test(sharedWrite)
    && /invalid_source_edited_at/.test(sharedWrite),
  'write wrappers preserve the authenticated edit clock and reject invalid future clocks');
  ok(/expected_status/.test(sharedWrite) && /expected_updated_at/.test(sharedWrite),
    'new write wrappers preserve compare-and-set guards');
  ok(/invalid_patch_field/.test(sharedWrite)
    && /operation === "create" && existing/.test(sharedWrite)
    && /operation !== "create" && !existing/.test(sharedWrite),
  'write wrappers reject arbitrary columns and create/update shape confusion');
  ok(/unsupported_batch_operation/.test(sharedWrite),
    'batch wrapper rejects operations without a durable batch field contract');
  ok(/patch\.status_at = sourceEditedAt/.test(sharedWrite)
    && /raw\.archived = sourceEditedAt/.test(sharedWrite)
    && /delete raw\[key\]/.test(sharedWrite),
  'status clocks and archive/restore markers are owned by the server');
  ok(/outbound/.test(sharedWrite) && /supabase\.rpc\(config\.rpc/.test(sharedWrite),
    'write wrappers enqueue atomically through the existing RPC ledger');
  ok(/deliverable_b4_comment_write/.test(sharedWrite)
    && /batch_b4_comment_write/.test(sharedWrite)
    && /_calmerge_comment_cell/.test(migration),
  'comments merge and enqueue in one service-only database transaction');
  ok(/validateTestOverride/.test(sharedWrite)
    && /serviceRoleRequest/.test(sharedWrite)
    && /kind !== "test"/.test(sharedWrite)
    && /test_only: testOverride/.test(sharedWrite),
  'write wrappers expose only a service-authenticated active-TEST override');

  const workflow = read('.github/workflows/linear-outbound-drain.yml');
  ok(/curl --fail-with-body --silent --show-error \\\r?\n/.test(workflow)
    && !/--show-error \+/.test(workflow),
  'scheduled drain uses valid shell continuations');
  ok(/GITHUB_STEP_SUMMARY/.test(workflow)
    && /oldest_pending_minutes/.test(workflow)
    && /oldest_pending_alert_teams/.test(workflow),
    'scheduled drain publishes the persisted watcher summary to the Actions run');
  const deployWorkflow = read('.github/workflows/deploy-onboarding-edge-functions.yml');
  const pushBlock = (deployWorkflow.match(/  push:\r?\n([\s\S]*?)  workflow_dispatch:/) || [])[1] || '';
  const forbiddenPushPaths = [
    'supabase/functions/linear-outbound/**',
    'supabase/functions/production-write/**',
    'supabase/functions/client-review-link/**',
    'supabase/functions/_shared/**',
  ];
  ok(!!pushBlock && forbiddenPushPaths.every(path => !pushBlock.includes(`- '${path}'`)),
    'high-risk functions and broad shared changes never trigger a push deploy');

  const pinnedStepAt = deployWorkflow.indexOf('- name: Deploy pinned Track-B write functions');
  const pinnedStep = pinnedStepAt >= 0 ? deployWorkflow.slice(pinnedStepAt) : '';
  const pinnedLoop = (pinnedStep.match(/for fn in ([^;]+); do/) || [])[1] || '';
  ok(/if: github\.event_name == 'workflow_dispatch'/.test(pinnedStep)
    && pinnedLoop === 'linear-outbound production-write',
  'manual deploy step is dispatch-only and deploys the provider before its gateway caller');

  const ancestorGuard = 'git merge-base --is-ancestor "$DEPLOY_COMMIT" origin/main';
  const ancestorGuardAt = deployWorkflow.indexOf(ancestorGuard);
  ok(/commit_sha:[\s\S]{0,180}required: true/.test(deployWorkflow)
    && /\^\[0-9a-f\]\{40\}\$/.test(deployWorkflow)
    && ancestorGuardAt >= 0
    && ancestorGuardAt < pinnedStepAt,
  'manual write-path deploy runs only after the exact-SHA main-ancestry guard');
  ok(/allowMissing && \/\\b\(entity\|issue\|resource\) not found/.test(ef)
    && !/if \(allowMissing\) return null/.test(ef),
  'native create treats only an explicit Linear not-found as absence');

  const reconciler = read('scripts/linear-deliverables-reconcile.js');
  ok(/classifyOutboundDeliverable/.test(reconciler)
    && /classifyOutboundBatch/.test(reconciler)
    && /mirror_outbox_enqueue/.test(reconciler)
    && /mirror_outbox_requeue/.test(reconciler)
    && /authority === 'syncview'/.test(reconciler),
  'reconciler measures and queues healing only in the outbound authority direction');
  ok(/B4_TEST_AUTHORITY_CLIENT/.test(reconciler)
    && /B4_CONFIRM_TEST_MUTATIONS/.test(reconciler)
    && /TEST_AUTHORITY_CLIENT !== 'sidneylaruel'/.test(reconciler),
  'two-way TEST authority override is dry-run-only and pinned to the TEST client');

  if (failures) {
    console.error('\n' + failures + ' linear-outbound check(s) failed');
    process.exit(1);
  }
  console.log('\nlinear-outbound checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
