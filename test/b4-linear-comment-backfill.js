'use strict';

const fs = require('fs');
const path = require('path');
const {
  LINEAR_COMMENTS_QUERY,
  applyLegacyNativeRecovery,
  assertUniqueLinearCommentIds,
  buildMappingIndex,
  contentSignature,
  linearThreadRoots,
  loadAllCommentPages,
  normalizeLinearComments,
  optionsFrom,
  parseBridgeBody,
  planBackfill,
  reconcileIds,
  renderRollbackSql,
  resolveAuthor,
  scopeAllows,
  selfContainedEvent,
  validateOptions,
} = require('../scripts/b4-linear-comment-backfill');

function ok(condition, message) {
  if (!condition) {
    console.error('FAIL b4-linear-comment-backfill:', message);
    process.exit(1);
  }
}

function throws(fn, pattern, message) {
  try {
    fn();
  } catch (error) {
    ok(pattern.test(String(error && error.message)), message);
    return;
  }
  ok(false, message);
}

const baseOptions = {
  apply: false,
  scope: 'full',
  import_run_id: 'linear-comment-backfill-test',
  backfill_tag: 'linear-comment-backfill-test',
};

const mapping = buildMappingIndex({
  deliverables: [{
    id: 'del_1',
    batch_id: 'batch_1',
    client_slug: 'sidneylaruel',
    team: 'video',
    linear_issue_uuid: 'issue_1',
    linear_identifier: null,
    linear_issue_url: 'https://linear.app/example/issue/vid-1/test',
    comments: JSON.stringify([{
      id: 'native_legacy_1',
      author: 'Kasper',
      body: 'Please tighten the opening.',
      created_at: '2001-01-01T00:00:00Z',
    }]),
  }],
  batches: [{
    id: 'batch_2',
    client_slug: 'sidneylaruel',
    linear_parent_ids: { video: { uuid: 'issue_parent' } },
  }],
  archive: [{ linear_uuid: 'issue_archive', client_slug: 'archived-client', team: 'VID' }],
  members: [
    { id: 'member_1', name: 'Editor Two', role: 'creative', linear_user_id: 'user_2' },
    { id: 'member_kasper', name: 'Kasper', role: 'admin', linear_user_id: null },
  ],
});

const rawComments = [
  {
    id: 'comment_root',
    body: '**Kasper (via SyncView):**\n\nPlease tighten the opening.\n\n<!-- syncview-mirror:dedup-1 -->',
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
    editedAt: null,
    archivedAt: null,
    parentId: null,
    resolvedAt: null,
    user: { id: 'house_user', name: 'House transport' },
    externalUser: null,
    botActor: null,
    onBehalfOf: null,
    issue: {
      id: 'issue_1', identifier: 'VID-1', team: { key: 'VID' },
      project: { id: 'project_test_video', name: 'Sidney Laruel' },
    },
  },
  {
    id: 'comment_reply',
    body: 'Done.',
    createdAt: '2026-07-01T01:00:00Z',
    updatedAt: '2026-07-01T02:00:00Z',
    editedAt: '2026-07-01T02:00:00Z',
    archivedAt: '2026-07-02T00:00:00Z',
    parentId: 'comment_root',
    resolvedAt: '2026-07-03T00:00:00Z',
    user: { id: 'transport_2', name: 'Transport two' },
    externalUser: null,
    botActor: null,
    onBehalfOf: { id: 'user_2', displayName: 'Editor Two' },
    issue: {
      id: 'issue_1', identifier: 'VID-1', team: { key: 'VID' },
      project: { id: 'project_test_video', name: 'Sidney Laruel' },
    },
  },
  {
    id: 'comment_reply_2',
    body: 'Nested reply.',
    createdAt: '2026-07-01T03:00:00Z',
    updatedAt: '2026-07-01T03:00:00Z',
    parentId: 'comment_reply',
    issue: {
      id: 'issue_1', identifier: 'VID-1', team: { key: 'VID' },
      project: { id: 'project_test_video', name: 'Sidney Laruel' },
    },
  },
];

const parsedBridge = parseBridgeBody(rawComments[0].body);
ok(parsedBridge.bridge_author === 'Kasper', 'bridge wrapper author is parsed');
ok(parsedBridge.body === 'Please tighten the opening.', 'bridge wrapper and mirror marker are stripped');
ok(parsedBridge.mirror_marker === 'dedup-1', 'outbound marker is retained as provenance');

const bridgeAuthor = resolveAuthor(rawComments[0]);
ok(bridgeAuthor.author_name === 'Kasper', 'bridge display author wins over transport actor');
ok(bridgeAuthor.transport_linear_user_id === 'house_user', 'transport Linear actor is retained separately');

const roots = linearThreadRoots(rawComments);
ok(roots.get('comment_root') === 'comment_root', 'root comment points at itself');
ok(roots.get('comment_reply') === 'comment_root', 'reply resolves to root');
ok(roots.get('comment_reply_2') === 'comment_root', 'nested reply resolves to root');
throws(() => assertUniqueLinearCommentIds([rawComments[0], rawComments[0]]), /Duplicate Linear comment id/,
  'duplicate source ids stop the import');

const normalized = normalizeLinearComments(rawComments, mapping, baseOptions);
ok(mapping.byIdentifier.get('VID-1')?.deliverable_id === 'del_1',
  'native deliverables remain mappable by stable identifier when issue UUID linkage is absent');
const root = normalized[0].row;
const reply = normalized[1].row;
ok(root.id === 'linear:comment_root' && root.idempotency_key === 'linear:comment_root',
  'Linear ids produce deterministic row and idempotency ids');
ok(root.native_comment_id === root.id && root.provenance.native_id_provenance === 'linear_derived',
  'backfill supplies both deterministic store and native comment ids');
ok(root.author_key === 'team:member_kasper' && root.author_member_id === 'member_kasper'
  && root.role === 'admin', 'bridge author resolves by exact normalized roster name and preserves roster role');
ok(reply.parent_id === 'linear:comment_root' && reply.thread_root_id === 'linear:comment_root',
  'reply parent and thread root are durable deterministic ids');
const reversed = normalizeLinearComments(rawComments.slice().reverse(), mapping, baseOptions);
ok(reversed[0].row.linear_comment_id === 'comment_root'
  && reversed[1].row.linear_comment_id === 'comment_reply',
  'normalization sorts roots before replies so per-row RPC transactions satisfy parent FKs');
ok(reply.author_member_id === 'member_1' && reply.author_name === 'Editor Two',
  'on-behalf-of author resolves to a native member without losing transport identity');
ok(reply.edited_at && reply.deleted_at && reply.resolved_at,
  'edit, archive/delete, and resolution timestamps are preserved');

const event = selfContainedEvent(root);
ok(event.payload.comment.body === root.body && event.payload.comment.author_name === root.author_name,
  'backfill event is self-contained with body and author');
ok(event.payload.import_run_id === baseOptions.import_run_id, 'event carries rollback run tag');

const firstPlan = planBackfill(normalized, [], baseOptions);
ok(firstPlan.planned.length === 3 && firstPlan.noops.length === 0,
  'empty store plans every normalized comment once');
const rerunPlan = planBackfill(normalized, normalized.map(item => ({ ...item.row })), baseOptions);
ok(rerunPlan.planned.length === 0 && rerunPlan.noops.length === 3 && rerunPlan.conflicts.length === 0,
  'same source replay is an exact no-op');
const changed = normalized.map(item => ({ ...item.row }));
changed[0].body = 'Different stored body';
const conflictPlan = planBackfill(normalized, changed, baseOptions);
ok(conflictPlan.conflicts.length === 1 && conflictPlan.planned.length === 0,
  'content mismatch is a conflict and is never overwritten');
ok(contentSignature(normalized[0].row) === contentSignature({ ...normalized[0].row }),
  'content signature is stable');

const editedSource = rawComments.map(comment => ({ ...comment }));
editedSource[0].body = '**Kasper (via SyncView):**\n\nUpdated request.';
editedSource[0].updatedAt = '2026-07-04T00:00:00Z';
editedSource[0].editedAt = '2026-07-04T00:00:00Z';
const editedRows = normalizeLinearComments(editedSource, mapping, baseOptions);
const updatePlan = planBackfill(editedRows, normalized.map(item => ({ ...item.row })), baseOptions);
ok(updatePlan.updates.length === 1 && updatePlan.conflicts.length === 0,
  'newer Linear edit plans a safe RPC update instead of a conflict');
const stalePlan = planBackfill(normalized, editedRows.map(item => ({ ...item.row })), baseOptions);
ok(stalePlan.stale_noops.length === 1 && stalePlan.conflicts.length === 0,
  'older Linear replay is a successful stale no-op');
const beforeDeleteResolve = { ...reply, deleted_at: null, resolved_at: null };
const lifecyclePlan = planBackfill([normalized[1]], [beforeDeleteResolve], baseOptions);
ok(lifecyclePlan.updates.length === 1 && lifecyclePlan.conflicts.length === 0,
  'delete/resolve transition advances safely even when Linear updatedAt is unchanged');
const postUpdateReplay = { ...editedRows[0].row, version: 2 };
const postUpdatePlan = planBackfill([editedRows[0]], [postUpdateReplay], baseOptions);
ok(postUpdatePlan.noops.length === 1 && postUpdatePlan.conflicts.length === 0,
  'rerun after an RPC version increment remains an exact no-op');

const nativeLinked = { ...normalized[0].row,
  id: 'native:existing', idempotency_key: 'native:existing', native_comment_id: 'native:existing',
  source: 'ui', origin: 'native', import_run_id: null, backfill_tag: null };
const convergencePlan = planBackfill([normalized[0]], [nativeLinked], baseOptions);
ok(convergencePlan.noops.length === 1 && convergencePlan.conflicts.length === 0,
  'same Linear id safely converges with an already native-linked row whose store id differs');
const archiveOnlyBeforeLink = {
  ...normalized[0].row,
  deliverable_id: null,
  batch_id: null,
  client_slug: 'archive-only',
};
const nativeTargetPlan = planBackfill([normalized[0]], [archiveOnlyBeforeLink], baseOptions);
ok(nativeTargetPlan.updates.length === 1 && nativeTargetPlan.conflicts.length === 0,
  'same-run identifier recovery safely enriches an archive-only row with its native target');
const pilotTagged = { ...normalized[0].row, import_run_id: 'pilot-run', backfill_tag: 'pilot-run' };
const pilotLeakPlan = planBackfill([normalized[0]], [pilotTagged], baseOptions);
ok(pilotLeakPlan.conflicts.length === 1 && pilotLeakPlan.conflicts[0].reason === 'backfill_run_mismatch',
  'full import refuses to absorb an unrolled-back pilot tag');

const testItem = normalized[0];
ok(scopeAllows(testItem, 'test'), 'TEST scope accepts only TEST client + TEST project + VID/GRA');
ok(!scopeAllows({ ...testItem, issue_project_name: 'Production Client' }, 'test'),
  'TEST scope rejects a non-TEST project');
ok(!scopeAllows({ ...testItem, subject: { ...testItem.subject, client_slug: 'production-client' } }, 'test'),
  'TEST scope rejects a non-TEST client even if a project name is misleading');
throws(() => validateOptions(optionsFrom(['--apply'], {})), /explicit --scope/,
  'apply without explicit scope is rejected');
throws(() => validateOptions(optionsFrom(['--apply', '--scope', 'test', '--import-run-id', 'run'], {})),
  /TEST apply requires/, 'TEST apply requires a fail-closed confirmation');
ok(validateOptions(optionsFrom([
  '--apply', '--scope', 'test', '--import-run-id', 'run', '--confirm-test', 'sidneylaruel',
], {})).scope === 'test', 'confirmed TEST apply options are accepted');
ok(validateOptions(optionsFrom(['--scope', 'full', '--write-concurrency', '16'], {})).write_concurrency === 16,
  'bounded write concurrency accepts the documented maximum');
throws(() => validateOptions(optionsFrom(['--scope', 'full', '--write-concurrency', '17'], {})),
  /write-concurrency/, 'write concurrency fails closed above the service-safe bound');

mapping.legacyByDeliverable.get('del_1').push({ author: 'Unknown Legacy', body: 'Local only message' });
const fullBeforeRecovery = {
  ...normalized[0].row,
  provenance: { ...normalized[0].row.provenance },
};
const recovery = applyLegacyNativeRecovery(normalized, mapping, [], {
  legacy_native_cap: 8,
  legacy_capture_at: '2026-07-12T23:00:00Z',
  import_run_id: baseOptions.import_run_id,
  backfill_tag: baseOptions.backfill_tag,
});
ok(recovery.matches.length === 1, 'legacy-native recovery requires one exact body match inside the linked issue');
ok(recovery.standalone.length === 1 && recovery.standalone[0].row.id.startsWith('legacy:'),
  'unmatched local-only comment becomes one deterministic standalone legacy row');
ok(recovery.standalone[0].row.native_comment_id === recovery.standalone[0].row.id,
  'standalone local-only row still has both store and native ids');
ok(recovery.standalone[0].row.provenance.timestamp_provenance === 'ingestion_only'
  && recovery.standalone[0].row.source_created_at === '2026-07-12T23:00:00.000Z',
  'local-only row marks its timestamp as explicit ingestion time');
const recoveryAfterFull = planBackfill([normalized[0]], [fullBeforeRecovery], baseOptions);
ok(recoveryAfterFull.updates.length === 1 && recoveryAfterFull.conflicts.length === 0,
  'optional recovery after full import safely enriches exact same-clock body+author metadata');
ok(normalized[0].row.native_comment_id === 'native_legacy_1'
  && normalized[0].row.origin === 'legacy', 'exact legacy match annotates the Linear row');
ok(normalized[0].row.provenance.native_original_timestamp === 'unavailable'
  && normalized[0].row.provenance.native_timestamp_used === false,
  'legacy-native recovery never invents or copies an original native timestamp');
const recoveryReplaySource = normalizeLinearComments(rawComments, mapping, baseOptions);
const recoveryReplay = applyLegacyNativeRecovery(recoveryReplaySource, mapping, [normalized[0].row], {
  legacy_native_cap: 8,
  legacy_capture_at: '2026-07-12T23:00:00Z',
  import_run_id: baseOptions.import_run_id,
  backfill_tag: baseOptions.backfill_tag,
});
ok(recoveryReplay.matches.length === 1
  && recoveryReplaySource[0].row.native_comment_id === 'native_legacy_1',
  'rerun keeps a previously stored original native ID in the desired-state model');
const standaloneReplayPlan = planBackfill(recovery.standalone, recovery.standalone.map(item => ({
  ...item.row,
  version: 2,
  updated_at: '2026-07-12T23:05:00Z',
})), baseOptions);
ok(standaloneReplayPlan.noops.length === 1 && standaloneReplayPlan.updates.length === 0,
  'standalone legacy-native rows are exact no-ops after their first committed import');

const reconcile = reconcileIds(normalized, normalized.map(item => item.row), 'full');
ok(reconcile.missing_from_store === 0 && reconcile.extra_in_store === 0,
  'source/store id reconciliation is exact');

ok(/comments\([\s\S]*first:\s*100[\s\S]*includeArchived:\s*true/.test(LINEAR_COMMENTS_QUERY),
  'query uses the verified root comments cursor with archived comments');
ok(/team:\s*\{\s*key:\s*\{\s*in:\s*\["VID",\s*"GRA"\]/.test(LINEAR_COMMENTS_QUERY),
  'query is limited to VID/GRA issue comments');
ok(!/\bmutation\b/i.test(LINEAR_COMMENTS_QUERY), 'Linear query contains no mutation');

const rollback = renderRollbackSql("linear-comment-backfill-test'quoted");
ok(/^begin;/.test(rollback) && /commit;$/.test(rollback), 'rollback is one transaction');
ok(/delete from public\.deliverable_events[\s\S]*delete from public\.production_comments/.test(rollback),
  'rollback removes self-contained events before their tagged comments');
ok(/import_run_id = 'linear-comment-backfill-test''quoted'/.test(rollback)
  && /source = 'backfill'/.test(rollback), 'rollback is limited to the escaped import-run tag and backfill source');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b4-linear-comment-backfill.js'), 'utf8');
ok(/p_comment:\s*item\.row[\s\S]*p_event:\s*selfContainedEvent/.test(source),
  'all writes use the production_comment_upsert p_comment/p_event contract');
ok(/byDepth[\s\S]*depthFor[\s\S]*Promise\.all/.test(source),
  'bounded parallel writes are partitioned by parent depth');
ok(!/fetch\([^\n]*api\.linear\.app[\s\S]{0,300}method:\s*['"](?:PUT|PATCH|DELETE)['"]/.test(source),
  'tool has no Linear write request');

(async () => {
  const cursors = [];
  const result = await loadAllCommentPages(async after => {
    cursors.push(after);
    if (!after) return { nodes: [{ id: 'page_1' }], pageInfo: { hasNextPage: true, endCursor: 'cursor_1' } };
    return { nodes: [{ id: 'page_2' }], pageInfo: { hasNextPage: false, endCursor: null } };
  }, 0);
  ok(result.pages === 2 && result.comments.length === 2, 'pagination follows every Linear page');
  ok(cursors.length === 2 && cursors[0] === null && cursors[1] === 'cursor_1',
    'pagination passes the returned end cursor to the next request');
  console.log('b4-linear-comment-backfill checks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
