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

  ok(mapping.OUTBOUND_OPERATIONS.length === 12
    && mapping.OUTBOUND_OPERATIONS.includes('labels')
    && mapping.OUTBOUND_OPERATIONS.includes('description'),
  'the strict outbound operation catalog adds description after labels without dropping an existing operation');
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
  const labels = mapping.buildMutation({
    ...baseRow,
    operation: 'labels',
    payload: { linear_issue_id: 'issue_fixture', label_ids: ['label-z', 'label-a', 'label-z'] },
  });
  ok(labels.kind === 'issueUpdate'
    && JSON.stringify(labels.variables.input.labelIds) === JSON.stringify(['label-a', 'label-z']),
  'labels maps one canonical complete selected-ID set to issueUpdate.labelIds');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'labels', payload: { label_ids: ['label-z', 'label-a'] } },
    { ...issue, labelIds: ['label-a', 'label-z'] },
  ).decision === 'already_applied'
    && mapping.decideConflict(
      { ...baseRow, operation: 'labels', payload: { label_ids: ['label-z', 'label-a'] } },
      { ...issue, labelIds: ['label-a'] },
    ).decision === 'apply',
  'label conflict checks compare exact canonical full sets, independent of order');
  ok(mapping.decideConflict(
    {
      ...baseRow,
      operation: 'labels',
      source_edited_at: '2026-07-11T11:58:00Z',
      payload: { label_ids: ['label-a'] },
    },
    { ...issue, updatedAt: '2026-07-11T12:05:00Z', labelIds: ['label-z'] },
    { field_updated_at: '2026-07-11T12:04:00Z' },
  ).decision === 'stale', 'newer Linear label clocks prevent an outbound overwrite');
  const markdownDescription = '  # Exact Markdown\n\n- trailing spaces  \n';
  const description = mapping.buildMutation({
    ...baseRow,
    operation: 'description',
    payload: { linear_issue_id: 'issue_fixture', description: markdownDescription },
  });
  const clearDescription = mapping.buildMutation({
    ...baseRow,
    operation: 'description',
    payload: { linear_issue_id: 'issue_fixture', description: '' },
  });
  ok(description.kind === 'issueUpdate'
    && description.variables.input.description === markdownDescription
    && clearDescription.variables.input.description === null,
  'description maps exact Markdown to issueUpdate.description and an empty clear to explicit null');
  ok(mapping.decideConflict(
    { ...baseRow, operation: 'description', payload: { description: markdownDescription } },
    { ...issue, description: markdownDescription },
  ).decision === 'already_applied'
    && mapping.decideConflict(
      { ...baseRow, operation: 'description', payload: { description: markdownDescription } },
      { ...issue, description: markdownDescription.trim() },
    ).decision === 'apply'
    && mapping.decideConflict(
      {
        ...baseRow,
        operation: 'description',
        source_edited_at: '2026-07-11T11:58:00Z',
        payload: { description: markdownDescription },
      },
      { ...issue, description: 'newer Linear Markdown', updatedAt: '2026-07-11T12:05:00Z' },
      { field_updated_at: '2026-07-11T12:04:00Z' },
    ).decision === 'stale',
  'description conflict handling is whitespace-exact and refuses a newer Linear field clock');
  for (const invalidDescription of [null, 7, 'before\0after', 'x'.repeat(100_001)]) {
    let rejected = false;
    try {
      mapping.buildMutation({
        ...baseRow,
        operation: 'description',
        payload: { linear_issue_id: 'issue_fixture', description: invalidDescription },
      });
    } catch (error) {
      rejected = /valid description required/.test(String(error && error.message));
    }
    ok(rejected, `outbound description rejects invalid payload ${typeof invalidDescription}`);
  }
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

  const createPayload = {
    team_id: 'team_fixture',
    project_id: 'project_fixture',
    title: 'Fixture create',
    description: '## Exact Markdown\n\nCreate body  \n',
    status: 'todo',
    state_id: 'state_todo',
    due_date: '2026-08-19',
    assignee_id: 'native-member',
    linear_user_id: 'linear-user',
    parent_linear_issue_id: 'parent-linear',
    label_ids: ['label-a', 'label-z'],
  };
  const createRow = {
    ...baseRow,
    operation: 'create',
    payload: createPayload,
  };
  const createContext = {
    state_id: 'state_todo',
    create_id: '00000000-0000-5000-8000-000000000001',
    parent_linear_issue_id: 'parent-linear',
  };
  const create = mapping.buildMutation(createRow, createContext);
  ok(create.kind === 'issueCreate'
    && create.variables.input.id === '00000000-0000-5000-8000-000000000001'
    && create.variables.input.teamId === 'team_fixture'
    && create.variables.input.projectId === 'project_fixture'
    && create.variables.input.title === 'Fixture create'
    && create.variables.input.description === createPayload.description
    && create.variables.input.stateId === 'state_todo'
    && create.variables.input.dueDate === '2026-08-19'
    && create.variables.input.assigneeId === 'linear-user'
    && create.variables.input.parentId === 'parent-linear'
    && JSON.stringify(create.variables.input.labelIds) === JSON.stringify(['label-a', 'label-z']),
  'native create maps the complete canonical Production intent to one issueCreate');

  const exactCreateIssue = {
    id: createContext.create_id,
    title: createPayload.title,
    description: createPayload.description,
    dueDate: createPayload.due_date,
    priority: 0,
    team: { id: createPayload.team_id },
    project: { id: createPayload.project_id },
    state: { id: createPayload.state_id },
    assignee: { id: createPayload.linear_user_id },
    parent: { id: createPayload.parent_linear_issue_id },
    labelIds: [...createPayload.label_ids],
    labels: {
      nodes: [
        { id: 'label-a', name: 'Alpha', color: '#111111' },
        { id: 'label-z', name: 'Zulu', color: '#999999' },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
  ok(mapping.decideConflict(createRow, exactCreateIssue, createContext).decision === 'already_exists',
    'deterministic create recovery accepts only an issue whose full intent already matches');
  const createMismatchCases = [
    ['team', { ...exactCreateIssue, team: { id: 'wrong-team' } }],
    ['project', { ...exactCreateIssue, project: { id: 'wrong-project' } }],
    ['title', { ...exactCreateIssue, title: 'Wrong title' }],
    ['description', { ...exactCreateIssue, description: createPayload.description.trim() }],
    ['status', { ...exactCreateIssue, state: { id: 'wrong-state' } }],
    ['due_date', { ...exactCreateIssue, dueDate: '2027-08-19' }],
    ['assignee', { ...exactCreateIssue, assignee: { id: 'wrong-user' } }],
    ['parent', { ...exactCreateIssue, parent: { id: 'wrong-parent' } }],
    ['labels', { ...exactCreateIssue, labelIds: ['label-a'] }],
  ];
  for (const [field, mismatchedIssue] of createMismatchCases) {
    const conflict = mapping.decideConflict(createRow, mismatchedIssue, createContext);
    ok(conflict.decision === 'idempotency_conflict'
      && conflict.reason === 'linear_create_intent_mismatch'
      && conflict.mismatched_fields.includes(field),
    `deterministic create recovery terminalizes ${field} drift as an idempotency conflict`);
  }

  const nativeCreateEntity = {
    linear_raw: {
      issue: {
        labels: {
          nodes: exactCreateIssue.labels.nodes.map(label => ({ ...label, color: '#abcdef' })),
          pageInfo: { hasNextPage: false },
        },
      },
    },
  };
  const wrongRelationResult = {
    ...exactCreateIssue,
    labels: {
      nodes: [
        { id: 'label-a', name: 'Alpha', color: '#111111' },
        { id: 'wrong-label', name: 'Wrong', color: '#222222' },
      ],
      pageInfo: { hasNextPage: false },
    },
  };
  const completedCreateLabels = mapping.completeCreateIssueLabels(
    createRow,
    nativeCreateEntity,
    wrongRelationResult,
  );
  ok(completedCreateLabels.labels.nodes.every(label => label.color === '#abcdef')
    && JSON.stringify(completedCreateLabels.labelIds) === JSON.stringify(createPayload.label_ids),
  'create linkage rejects a mismatched returned label relation and preserves only the validated complete native snapshot');
  let incompleteCreateLabelsRejected = false;
  try {
    mapping.completeCreateIssueLabels(
      createRow,
      { linear_raw: { issue: { labels: { nodes: [], pageInfo: { hasNextPage: false } } } } },
      wrongRelationResult,
    );
  } catch (error) {
    incompleteCreateLabelsRejected = /outbound create labels incomplete/.test(String(error && error.message));
  }
  ok(incompleteCreateLabelsRejected,
    'create linkage fails when neither Linear nodes nor the native snapshot exactly covers the selected label IDs');
  const manyCreateLabelIds = Array.from({ length: 101 }, (_, index) =>
    `label-${String(index + 1).padStart(3, '0')}`);
  const manyCreateRow = {
    ...createRow,
    payload: {
      ...createRow.payload,
      label_ids: manyCreateLabelIds,
      planned_linear_issue_id: createContext.create_id,
    },
  };
  const partialManyLabelIssue = {
    ...exactCreateIssue,
    labelIds: manyCreateLabelIds,
    labels: {
      nodes: manyCreateLabelIds.slice(0, 100).map(id => ({ id })),
      pageInfo: { hasNextPage: true },
    },
  };
  const laterNativeLabelEdit = {
    linear_raw: {
      issue: {
        labels: {
          nodes: [{ id: 'later-native-label' }],
          pageInfo: { hasNextPage: false },
        },
      },
    },
  };
  const identityOnlyLabels = mapping.exactCreateIssueLabelIds(
    manyCreateRow,
    partialManyLabelIssue,
  );
  let legacyManyLabelLinkageRejected = false;
  try {
    mapping.completeCreateIssueLabels(
      manyCreateRow,
      laterNativeLabelEdit,
      partialManyLabelIssue,
    );
  } catch (error) {
    legacyManyLabelLinkageRejected = /outbound create labels incomplete/.test(String(error && error.message));
  }
  ok(JSON.stringify(identityOnlyLabels.labelIds) === JSON.stringify(manyCreateLabelIds)
    && legacyManyLabelLinkageRejected,
  'F203 identity-only linkage accepts exact complete labelIds above Linear’s 100-node cap without overwriting a later native label edit');

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
  ok(['create', 'status', 'comment', 'due', 'assignee', 'title', 'description', 'priority', 'labels', 'archive']
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
  const mappingSource = read('supabase/functions/linear-outbound/mapping.mjs');
  const createMigration = read('migrations/2026-07-23-f203-production-issue-create.sql');
  ok(!/production-write\/policy\.mjs/.test(mappingSource)
    && /const MAX_DESCRIPTION_LENGTH = 100_000/.test(mappingSource)
    && /!value\.includes\("\\0"\)/.test(mappingSource),
  'linear-outbound keeps an independent deployable exact-description validator with the same bound and NUL rejection');
  ok(/description: typeof issue\.description === "string" \? issue\.description : null/.test(ef),
    'outbound receipts retain exact Linear description text for audit and recovery');
  ok(/linear_outbound_enabled/.test(ef) && /prod_authority/.test(ef),
    'drainer reads both switch and team authority');
  ok(/currentControl\(supabase, row, testOverride, f27Replay\)/.test(ef),
    'drainer re-reads control before each row');
  ok(/unlockPending\(supabase, row, testClient \? 0 : 30\)/.test(ef),
    'production pause keeps backoff while the service-only TEST drill can resume immediately');
  ok(/serviceRoleRequest/.test(ef) && /kind !== "test"/.test(ef) && /row\.test_only/.test(ef),
    'TEST override is service-only and fail-closed to test rows');
  ok(/deterministicLinearCreateId/.test(ef)
    && /_shared\/linear-create-id\.mjs/.test(ef)
    && /checkpointLinearResult/.test(ef)
    && /recovered_idempotently/.test(ef),
  'native create shares one deterministic Linear id and checkpoints before local linkage');
  ok(/const createVerification = row\.operation === "create"/.test(ef)
    && /create_verification: createVerification/.test(ef)
    && /createVerification\.decision !== "already_exists"/.test(ef)
    && /applyCreateLinkage\(supabase, row, entity, resultIssue\)/.test(ef)
    && /exactCreateIssueLabelIds\(row, issue\)/.test(ef)
    && /completeCreateIssueLabels\(row, entity, issue\)/.test(ef)
    && /JSON\.stringify\(resultNodeIds\) === JSON\.stringify\(expectedIds\)/.test(mappingSource),
  'create is checkpointed, full-intent verified, and label-relation verified before native linkage');
  ok(/conflict\.decision === "idempotency_conflict" && row\.operation === "create"/.test(ef)
    && /status: "skipped"[\s\S]{0,320}last_error: f27Replay \? "F27 replay declined: idempotency_conflict" : "idempotency_conflict"[\s\S]{0,120}next_retry_at: f27Replay \?/.test(ef)
    && /createVerification\?\.decision === "idempotency_conflict"[\s\S]{0,520}status: "skipped"/.test(ef),
  'deterministic create intent conflicts become structured terminal receipts before or after the mutation response and never enter generic retry exhaustion');
  const linkageStart = ef.indexOf('async function applyCreateLinkage(');
  const linkageEnd = ef.indexOf('\nasync function latestOutboundSummaryTs(', linkageStart);
  const linkage = ef.slice(linkageStart, linkageEnd);
  const f203BranchStart = linkage.indexOf('if (plannedLinearIssueId) {');
  const f203BranchEnd = linkage.indexOf('\n  const raw = parseJson(entity.linear_raw);', f203BranchStart);
  const f203Linkage = linkage.slice(f203BranchStart, f203BranchEnd);
  ok(/plannedLinearIssueId[\s\S]{0,160}\? exactCreateIssueLabelIds\(row, issue\)[\s\S]{0,100}: completeCreateIssueLabels\(row, entity, issue\)/.test(linkage)
    && /from\("deliverables"\)[\s\S]{0,120}\.select\("\*"\)[\s\S]{0,120}\.eq\("id", clean\(row\.entity_id\)\)/.test(f203Linkage)
    && /sameCreateIdentity\(row, entity, current, plannedLinearIssueId\)/.test(f203Linkage)
    && /rpc\("production_issue_create_linkage"/.test(f203Linkage)
    && !/\.\.\.entity|sync_state: "clean"|deliverable_write/.test(f203Linkage),
  'F203 re-reads after Linear acknowledgement and delegates a linkage-only atomic patch instead of spreading the stale entity snapshot');
  ok(/create or replace function public\.production_issue_create_linkage/.test(createMigration)
    && /from public\.deliverables d[\s\S]{0,80}for update/.test(createMigration)
    && /v_outbox\.payload->>'_intent_fingerprint'[\s\S]{0,100}v_expected->>'intent_fingerprint'/.test(createMigration)
    && /v_patched_issue := jsonb_set\([\s\S]*'\{id\}'[\s\S]*'\{identifier\}'[\s\S]*'\{url\}'/.test(createMigration)
    && /o\.id > p_outbox_id[\s\S]{0,100}o\.status in \('pending', 'failed', 'shadow_ok'\)/.test(createMigration)
    && /set_config\('app\.event_written', '1', true\)[\s\S]{0,220}update public\.deliverables d/.test(createMigration)
    && /sync_state = case when v_has_later_pending then 'pending' else 'clean' end/.test(createMigration)
    && !/production_issue_create_linkage[\s\S]*mirror_outbox_enqueue/.test(createMigration),
  'atomic F203 linkage preserves current native semantics and labels, while later nonterminal intents keep sync pending');
  ok(/row\.entity === "comment" && row\.batch_id/.test(ef) && /batchParentId/.test(ef),
    'batch comments resolve their batch parent issue rather than a deliverable row');
  const ownIssueResolver = ef.match(/function linearIssueId\([^]*?\n\}/);
  ok(ownIssueResolver && !/dependency\.linear_issue_id|dependency\.issue_id/.test(ownIssueResolver[0]),
    'a create dependency supplies parentId only and is never mistaken for the child issue');
  ok(/status: f27Replay \? "skipped" : "stale"/.test(ef)
    && /linear_newer_than_syncview_intent/.test(read('supabase/functions/linear-outbound/mapping.mjs')),
    'newer Linear edits are marked stale, not overwritten; F27 recovery stays quarantined');
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
  const inboundEchoProof = read('supabase/functions/linear-inbound/f27-echo.mjs');
  ok(/mirror_actor_id/.test(inboundEchoProof)
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
      canonicalIssueLabelIds: issueRow => [...new Set(
        (Array.isArray(issueRow.labelIds) ? issueRow.labelIds : []).map(String).filter(Boolean),
      )].sort(),
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
    const labelReceipt = {
      operation: 'labels', status: 'written',
      linear_result: { expected: { input: { labelIds: ['label-a', 'label-z'] } } },
    };
    ok(echoContext.outboundValueMatches(labelReceipt, { action: 'update' }, {
      labelIds: ['label-z', 'label-a'],
    }, {}) === true
      && echoContext.outboundValueMatches(labelReceipt, { action: 'update' }, {
        labelIds: ['label-a'],
      }, {}) === false,
    'label echoes drop only for the exact canonical full selected-ID receipt');
    const descriptionReceipt = {
      operation: 'description', status: 'written',
      linear_result: { expected: { input: { description: markdownDescription } } },
    };
    const clearDescriptionReceipt = {
      operation: 'description', status: 'written',
      linear_result: { expected: { input: { description: null } } },
    };
    ok(echoContext.outboundValueMatches(
      descriptionReceipt,
      { action: 'update' },
      { description: markdownDescription },
      {},
    ) === true
      && echoContext.outboundValueMatches(
        descriptionReceipt,
        { action: 'update' },
        { description: markdownDescription.trim() },
        {},
      ) === false
      && echoContext.outboundValueMatches(
        clearDescriptionReceipt,
        { action: 'update' },
        { description: null },
        {},
      ) === true,
    'description echoes require the exact Markdown receipt while explicit null matches the empty clear intent');
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
    && /track_b_f27_requeue/.test(reconciler)
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
