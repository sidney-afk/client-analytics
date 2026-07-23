'use strict';

// Hermetic behavioral contract for the pure Workload Linear policy. Synthetic
// IDs, labels, dates, and receipts only: no Supabase or Linear calls.

const path = require('path');
const { pathToFileURL } = require('url');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures += 1;
    console.error('FAIL workload-linear-policy: ' + message);
  }
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    __dirname,
    '..',
    'supabase',
    'functions',
    'workload-linear',
    'policy.mjs',
  )).href + '?workload-linear-policy');

  ok(policy.MAX_METADATA_ISSUES === 100
    && policy.LINEAR_ALIAS_BATCH_SIZE === 20,
  'metadata requests are bounded at 100 and split into 20-issue Linear alias batches');

  ok(policy.workloadTeamBucket('VID', 'Video') === 'video'
    && policy.workloadTeamBucket('GRA', 'Graphics') === 'graphics'
    && policy.workloadTeamBucket('VID', 'Graphics') === ''
    && policy.workloadTeamBucket('CON', 'Content') === '',
  'writer team scope accepts only consistent Video or Graphics mirror metadata');
  const stillLinear = policy.linearAuthorityDecision(
    { video: 'linear', graphics: 'syncview' },
    'video',
  );
  const staleAfterFlip = policy.linearAuthorityDecision(
    { video: 'syncview', graphics: 'linear' },
    'video',
  );
  const unreadableAuthority = policy.linearAuthorityDecision(
    { video: 'linear', graphics: 'unknown' },
    'video',
  );
  ok(stillLinear.ok === true
    && staleAfterFlip.ok === false
    && staleAfterFlip.status === 409
    && staleAfterFlip.error === 'team_is_syncview_authoritative'
    && unreadableAuthority.ok === false
    && unreadableAuthority.status === 503,
  'a stale Linear browser route is denied after the current team flips to SyncView, and malformed authority fails closed');

  const exactIds = Array.from({ length: 100 }, (_, index) => `issue-${index + 1}`);
  const accepted = policy.normalizeMetadataIssueIds(exactIds);
  ok(accepted.ok && accepted.issueIds.length === 100,
    'the exact request ceiling is accepted without truncation');
  ok(policy.normalizeMetadataIssueIds([]).error === 'invalid_issue_ids'
    && policy.normalizeMetadataIssueIds([...exactIds, 'issue-101']).error === 'too_many_issue_ids'
    && policy.normalizeMetadataIssueIds(['issue-1', ' issue-1 ']).error === 'duplicate_issue_id'
    && policy.normalizeMetadataIssueIds(['bad issue']).error === 'invalid_issue_id',
  'empty, oversized, normalized-duplicate, and malformed issue lists fail closed');

  const batches = policy.splitAliasBatches(Array.from({ length: 41 }, (_, index) => `id-${index}`));
  ok(batches.length === 3
    && batches[0].length === 20
    && batches[1].length === 20
    && batches[2].length === 1,
  'alias batching is deterministic and retains every requested issue exactly once');

  ok(policy.validIsoDateOrNull(null)
    && policy.validIsoDateOrNull('2028-02-29')
    && !policy.validIsoDateOrNull('')
    && !policy.validIsoDateOrNull('2026-02-29')
    && !policy.validIsoDateOrNull('2026-13-01')
    && !policy.validIsoDateOrNull('22-07-2026'),
  'due dates accept explicit null or a real YYYY-MM-DD calendar date only');

  ok(policy.validRfc3339Timestamp('2026-07-22T16:00:00.000Z')
    && policy.validRfc3339Timestamp('2026-07-22T10:00:00-06:00')
    && !policy.validRfc3339Timestamp('not-a-date')
    && !policy.validRfc3339Timestamp('2026-02-29T16:00:00.000Z')
    && !policy.validRfc3339Timestamp('2026-07-22T25:00:00.000Z')
    && !policy.validRfc3339Timestamp(' 2026-07-22T16:00:00.000Z '),
  'Linear update receipts require a real canonical RFC3339 timestamp');

  ok(!policy.graphqlResponseHasErrors({ data: {} })
    && !policy.graphqlResponseHasErrors({ data: {}, errors: [] })
    && policy.graphqlResponseHasErrors({ data: {}, errors: [{ message: 'synthetic' }] })
    && policy.graphqlResponseHasErrors({ data: {}, errors: {} })
    && policy.graphqlResponseHasErrors({ data: {}, errors: null })
    && policy.graphqlResponseHasErrors(null),
  'present GraphQL errors must be an empty array; malformed error envelopes fail incomplete');

  const exactTwo = policy.maxWorkloadLabel([
    { name: 'Priority', color: '#123456' },
    { name: '2x Workload', color: '#654321' },
    { name: '2× Workload ', color: '#ABCDEF' },
    { name: '2× Workload', color: '#f59e0b' },
  ]);
  ok(exactTwo
    && exactTwo.label === '2× Workload'
    && exactTwo.weight === 2
    && exactTwo.color === '#F59E0B',
  'only the exact 2× label is recognized and its valid color is normalized to #RRGGBB');

  const maxBoth = policy.maxWorkloadLabel([
    { name: '2× Workload', color: '#FFA500' },
    { name: '3× Workload', color: 'linear-gradient(red, blue)' },
    { name: 'Unrelated', color: '#000000' },
  ]);
  ok(maxBoth
    && maxBoth.label === '3× Workload'
    && maxBoth.weight === 3
    && maxBoth.color === '#94A3B8',
  'both exact labels resolve to the maximum weight and unsafe Linear color text gets a safe hex fallback');
  ok(policy.maxWorkloadLabel([{ name: '3x Workload', color: '#FF0000' }]) === null,
    'lookalike labels never change planning weight');

  const exactMetadata = policy.linearMetadataRow({
    id: 'issue-1',
    dueDate: null,
    updatedAt: '2026-07-22T16:00:00.000Z',
    labels: {
      nodes: [{ name: '2× Workload', color: '#f59e0b' }],
      pageInfo: { hasNextPage: false },
    },
  }, 'issue-1');
  ok(exactMetadata.row
    && !exactMetadata.incomplete
    && exactMetadata.row.due_date === null
    && exactMetadata.row.workload.weight === 2,
  'a structurally complete Linear row preserves an explicit null deadline and exact workload label');

  for (const [name, value, hasRow] of [
    ['omitted dueDate', {
      id: 'issue-1', updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: [], pageInfo: { hasNextPage: false } },
    }, false],
    ['omitted labels', {
      id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z',
    }, true],
    ['non-canonical dueDate', {
      id: 'issue-1', dueDate: ' 2026-07-30 ', updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: [], pageInfo: { hasNextPage: false } },
    }, false],
    ['malformed updatedAt', {
      id: 'issue-1', dueDate: null, updatedAt: 'not-a-date',
      labels: { nodes: [], pageInfo: { hasNextPage: false } },
    }, false],
    ['malformed nodes', {
      id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: null, pageInfo: { hasNextPage: false } },
    }, true],
    ['omitted pageInfo', {
      id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: [] },
    }, true],
    ['non-boolean hasNextPage', {
      id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: [], pageInfo: { hasNextPage: 'false' } },
    }, true],
    ['truncated labels', {
      id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z',
      labels: { nodes: [], pageInfo: { hasNextPage: true } },
    }, true],
  ]) {
    const parsed = policy.linearMetadataRow(value, 'issue-1');
    ok(parsed.incomplete && (!!parsed.row === hasRow),
      `${name} cannot claim complete metadata`);
  }

  const clearAck = policy.exactDueDateAcknowledgement({
    success: true,
    issue: { id: 'issue-1', dueDate: null, updatedAt: '2026-07-22T16:00:00.000Z' },
  }, 'issue-1', null);
  const omittedClearAck = policy.exactDueDateAcknowledgement({
    success: true,
    issue: { id: 'issue-1', updatedAt: '2026-07-22T16:00:00.000Z' },
  }, 'issue-1', null);
  const mismatchedAck = policy.exactDueDateAcknowledgement({
    success: true,
    issue: { id: 'issue-1', dueDate: '2026-07-31', updatedAt: '2026-07-22T16:00:00.000Z' },
  }, 'issue-1', '2026-07-30');
  const malformedTimestampAck = policy.exactDueDateAcknowledgement({
    success: true,
    issue: { id: 'issue-1', dueDate: null, updatedAt: 'not-a-date' },
  }, 'issue-1', null);
  ok(clearAck && clearAck.dueDate === null,
    'an explicit Linear null exactly acknowledges a due-date clear');
  ok(omittedClearAck === null && mismatchedAck === null && malformedTimestampAck === null,
    'omitted/mismatched dates and malformed timestamps never acknowledge a Linear commit');

  const fullMetadata = policy.metadataSuccessReceipt(
    ['issue-1', 'issue-2'],
    [{ issue_id: 'issue-1' }, { issue_id: 'issue-2' }],
    [],
    [],
  );
  const missingMetadata = policy.metadataSuccessReceipt(
    ['issue-1', 'issue-2'],
    [{ issue_id: 'issue-1' }],
    ['issue-2'],
    ['issue-2'],
  );
  const truncatedLabels = policy.metadataSuccessReceipt(
    ['issue-1'],
    [{ issue_id: 'issue-1' }],
    [],
    ['issue-1'],
  );
  ok(fullMetadata.ok && fullMetadata.complete
    && fullMetadata.requested === 2 && fullMetadata.returned === 2,
  'metadata reports complete only when every validated issue has a complete Linear row');
  ok(missingMetadata.ok && !missingMetadata.complete
    && missingMetadata.returned === 1
    && missingMetadata.missing_issue_ids[0] === 'issue-2',
  'an absent Linear alias remains an explicit partial success instead of disappearing silently');
  ok(truncatedLabels.ok && !truncatedLabels.complete
    && truncatedLabels.returned === 1
    && truncatedLabels.incomplete_issue_ids[0] === 'issue-1',
  'a returned row with a truncated label connection cannot claim complete metadata');

  const mirrored = policy.dueDateSuccessReceipt(
    'issue-1',
    '2026-07-30',
    '2026-07-22T16:00:00.000Z',
    1,
  );
  const pending = policy.dueDateSuccessReceipt(
    'issue-1',
    null,
    '2026-07-22T16:01:00.000Z',
    0,
  );
  const impossibleMulti = policy.dueDateSuccessReceipt(
    'issue-1',
    null,
    '2026-07-22T16:01:00.000Z',
    2,
  );
  ok(mirrored.ok && mirrored.linear_committed
    && mirrored.mirror_updated === 1 && mirrored.mirror_pending === false,
  'one actual mirror row reports a confirmed Linear commit with a fresh mirror');
  ok(pending.ok && pending.linear_committed
    && pending.due_date === null
    && pending.mirror_updated === 0 && pending.mirror_pending === true,
  'a mirror miss after the external commit stays successful and explicitly pending');
  ok(impossibleMulti.ok && impossibleMulti.linear_committed
    && impossibleMulti.mirror_updated === 0 && impossibleMulti.mirror_pending === true,
  'a non-exact mirror count never becomes a false one-row success or reverses the Linear commit');

  if (failures) {
    console.error(`\n${failures} workload-linear policy check(s) failed`);
    process.exit(1);
  }
  console.log('\nWorkload Linear policy checks passed');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
