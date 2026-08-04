'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {
  buildPlan,
  compactLinearRaw,
  compactEventRows,
  syntheticCommentEvents,
  commentPairOrderContract,
  requireCompactDeliverables,
  requireReadyProjection,
  planBehaviorContract,
  assertHydratedPlanEquivalent,
  hydrateDeliverableDiffRows,
  supabaseRowsByPrimaryKey,
  loadReconcileSupportRows,
  canonicalDeliverableOrder,
  loadLiveData,
  loadLegacyLiveDataForProof,
  loadBoundedProjectionRowsForProof,
  compareReconcileSupportRows,
  alignLegacySupportRowsForProof,
  proofCounters,
  evaluateReadProofGate,
} = require('../scripts/linear-deliverables-reconcile');
const {
  deliverableArchivedOrDeleted,
  engineCommentIds,
} = require('../scripts/linear-deliverables-reconcile-lib');

const ROOT = path.join(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'linear-deliverables-reconcile.json'),
  'utf8',
));

function fixtureData(deliverables, events) {
  return {
    deliverables,
    allDeliverables: deliverables,
    members: fixture.members,
    events,
    calendarPosts: fixture.calendarPosts,
    sampleReviews: fixture.sampleReviews,
    linearArchive: [],
    batches: [],
    allBatches: [],
    outboxRows: [],
    clients: [],
    attributionFamilyComplete: false,
    attributionExpectedIssueCount: fixture.linearIssues.length,
    attributionLoadedIssueCount: fixture.linearIssues.length,
    prodAuthority: fixture.prodAuthority,
    linearIssues: new Map(fixture.linearIssues.map(issue => [issue.id, issue])),
    webhooks: fixture.webhooks,
  };
}

function supportRowsFromData(data) {
  return {
    calendarPosts: data.calendarPosts || [],
    sampleReviews: data.sampleReviews || [],
    linearArchive: data.linearArchive || [],
    batches: data.allBatches || data.batches || [],
    outboxRows: data.outboxRows || [],
  };
}

const fullRaw = {
  issue: {
    id: 'lin_issue_1',
    identifier: 'VID-TST',
    url: 'https://linear.app/example/VID-TST',
    parent: { id: 'lin_parent', ignored: 'large' },
    createdAt: '2026-07-01T00:00:00.000Z',
    completedAt: null,
    archivedAt: null,
    canceledAt: null,
    description: 'x'.repeat(10000),
    comments: Array.from({ length: 200 }, (_, id) => ({ id, body: 'payload' })),
  },
  attribution: {
    schema: 'syncview_attribution_v1',
    state: 'resolved',
    client_slug: 'fixture-client',
    owner_kind: 'client',
    source: 'direct_project',
    mapping_revision: 'a'.repeat(64),
    repair_required: false,
  },
  parent: { id: 'legacy_parent', ignored: true },
  parent_change: { id: 'older_parent', ignored: true },
  parent_id: 'oldest_parent',
  nested: {
    webhook_delete: false,
    deleted: 0,
    removed: '',
    refused_stale_regress: [],
  },
  irrelevant: 'y'.repeat(10000),
};
const compactRaw = compactLinearRaw(fullRaw);
assert.strictEqual(compactRaw.issue.id, fullRaw.issue.id);
assert.strictEqual(compactRaw.issue.parent.id, fullRaw.issue.parent.id);
assert.deepStrictEqual(compactRaw.attribution, fullRaw.attribution);
assert.strictEqual(compactRaw.archived, undefined, 'false-like archive markers must stay false');
assert.strictEqual(compactRaw.refused_stale_regress, true, 'arrays are truthy under the legacy JavaScript contract');
assert.ok(JSON.stringify(compactRaw).length < JSON.stringify(fullRaw).length / 20,
  'the compact raw projection must exclude large irrelevant payloads');
assert.strictEqual(
  deliverableArchivedOrDeleted({ status: 'active', linear_raw: fullRaw }),
  deliverableArchivedOrDeleted({ status: 'active', linear_raw: compactRaw }),
  'compact raw must preserve archive/delete classification',
);
const nestedArchived = { issue: { parent: { id: 'parent' } }, deeply: [{ archived: { reason: 'legacy' } }] };
assert.strictEqual(compactLinearRaw(nestedArchived).archived, true,
  'nested truthy archive markers must be synthesized');

const legacyEvents = [
  { deliverable_id: 'del_fixture', action: 'COMMENT_A', source: 'ui', ts: '2020-01-01', payload: { linear_comment_id: 'c1' } },
  { deliverable_id: 'del_fixture', action: 'comment_b', source: 'mirror', payload: { comment_id: 'c2' } },
  { deliverable_id: 'del_fixture', action: 'comment_c', source: 'outbound', payload: { comment: { linear_comment_id: 'c3' } } },
  { deliverable_id: 'del_fixture', action: 'comment_d', source: 'mirror', payload: { comment: { native_comment_id: 'c4' } } },
  { deliverable_id: 'del_fixture', action: 'comment_e', source: 'mirror', payload: { comment: { id: 'c5' } } },
  { deliverable_id: 'del_fixture', action: 'comment_f', source: 'mirror', payload: { linear_comment: { id: 'c6' } } },
  { deliverable_id: 'del_fixture', action: 'comment_duplicate', source: 'mirror', payload: { linear_comment_id: 'c1' } },
  { deliverable_id: 'other', action: 'comment_other', source: 'mirror', payload: { linear_comment_id: 'other-c' } },
  { deliverable_id: 'del_fixture', action: 'status', source: 'mirror', payload: { linear_comment_id: 'ignored' } },
];
const compactEvents = syntheticCommentEvents(compactEventRows(legacyEvents));
assert.deepStrictEqual(
  [...engineCommentIds(legacyEvents.filter(event => event.deliverable_id === 'del_fixture'))].sort(),
  [...engineCommentIds(compactEvents.filter(event => event.deliverable_id === 'del_fixture'))].sort(),
  'distinct lifetime comment IDs must preserve every legacy payload shape and duplicate behavior',
);
const orderedCompactEvents = syntheticCommentEvents([
  { deliverable_id: 'del_fixture', linear_comment_id: 'newer', latest_ts: '2026-08-03T12:00:00Z', latest_event_id: 9 },
  { deliverable_id: 'del_fixture', linear_comment_id: 'older', latest_ts: '2026-08-02T12:00:00Z', latest_event_id: 8 },
]);
assert.deepStrictEqual([...engineCommentIds(orderedCompactEvents)], ['newer', 'older'],
  'the bounded projection ordering keys must preserve newest-first comment diff order');
assert.deepStrictEqual(commentPairOrderContract([
  { deliverable_id: 'b', linear_comment_id: 'b-new' },
  { deliverable_id: 'a', linear_comment_id: 'a-new' },
  { deliverable_id: 'a', linear_comment_id: 'a-old' },
]), { a: ['a-new', 'a-old'], b: ['b-new'] });

const fullDeliverable = Object.assign({}, fixture.deliverables[0], {
  linear_raw: fullRaw,
});
const projectedDeliverable = Object.assign({}, fullDeliverable, {
  linear_raw: compactRaw,
  source_linear_raw_sha256: 'b'.repeat(64),
  projection_version: 1,
});
const fullPlan = buildPlan(fixtureData([fullDeliverable], legacyEvents));
const compactPlan = buildPlan(fixtureData([projectedDeliverable], compactEvents));
assert.deepStrictEqual(planBehaviorContract(compactPlan), planBehaviorContract(fullPlan),
  'compact deliverables and aggregated events must produce the identical behavioral plan');

const movingCounters = {
  repair_list_size: 35,
  linkage_actionable: 46,
  outbound_diff_count: 2,
};
const movingCounterGate = evaluateReadProofGate({
  projectionSource: 'actual',
  behavioralEquivalence: true,
  sharedLinearSnapshot: true,
  sameSnapshotSupportRows: true,
  legacySummary: movingCounters,
  candidateSummary: Object.assign({}, movingCounters),
});
assert.strictEqual(movingCounterGate.same_snapshot_counter_equivalence, true);
assert.strictEqual(movingCounterGate.rollout_gate_ok, true,
  'moving absolute counters must pass when the same-run legacy and bounded readers agree');
assert.strictEqual(evaluateReadProofGate({
  projectionSource: 'simulated',
  behavioralEquivalence: true,
  sharedLinearSnapshot: true,
  sameSnapshotSupportRows: true,
  legacySummary: movingCounters,
  candidateSummary: Object.assign({}, movingCounters),
}).rollout_gate_ok, false, 'an in-memory simulation must never satisfy the installed-reader gate');
assert.ok(!/baseline/i.test(evaluateReadProofGate.toString()),
  'historical baseline evidence must be structurally excluded from acceptance');

const sabotageLegacyData = fixtureData([fullDeliverable], legacyEvents);
sabotageLegacyData.prodAuthority = Object.assign({}, sabotageLegacyData.prodAuthority, {
  video: 'syncview',
});
const sabotagedDeliverable = Object.assign({}, fullDeliverable, {
  title: 'Sabotaged candidate title',
});
const sabotageCandidateData = Object.assign({}, sabotageLegacyData, {
  deliverables: [sabotagedDeliverable],
  allDeliverables: [sabotagedDeliverable],
});
const sabotageLegacyPlan = buildPlan(sabotageLegacyData);
const sabotageCandidatePlan = buildPlan(sabotageCandidateData);
assert.ok(sabotageCandidatePlan.results.some(row => row.diffs.some(
  diff => diff.reason === 'outbound_title_mismatch',
)), 'the sabotage must create a genuine bounded-reader behavioral divergence');
assert.strictEqual(
  sabotageCandidatePlan.summary.outbound_diff_count,
  sabotageLegacyPlan.summary.outbound_diff_count + 1,
  'the sabotage must change a real acceptance counter',
);
const sabotageGate = evaluateReadProofGate({
  projectionSource: 'actual',
  behavioralEquivalence: true,
  sharedLinearSnapshot: sabotageCandidateData.linearIssues === sabotageLegacyData.linearIssues
    && sabotageCandidateData.webhooks === sabotageLegacyData.webhooks,
  sameSnapshotSupportRows: true,
  legacySummary: sabotageLegacyPlan.summary,
  candidateSummary: sabotageCandidatePlan.summary,
});
assert.strictEqual(sabotageGate.same_snapshot_counter_equivalence, false);
assert.strictEqual(sabotageGate.rollout_gate_ok, false,
  'a genuine legacy-versus-bounded counter divergence must fail closed even when every other gate is green');

const supportLegacyData = fixtureData([fullDeliverable], legacyEvents);
supportLegacyData.calendarPosts = supportLegacyData.calendarPosts.concat([{
  client: 'another-client',
  id: 'same-card-id',
  status: 'archived',
  linear_issue_id: null,
  graphic_linear_issue_id: null,
  video_deliverable_id: null,
  graphic_deliverable_id: null,
}]);
supportLegacyData.sampleReviews = [{
  client: 'fixture-client',
  id: 'sample-proof',
  status: 'active',
  linear_issue_id: 'VID-TST',
  graphic_linear_issue_id: null,
  video_deliverable_id: 'del_fixture',
  graphic_deliverable_id: null,
}];
const matchingSupportRows = JSON.parse(JSON.stringify(supportRowsFromData(supportLegacyData)));
matchingSupportRows.calendarPosts.reverse();
const matchingSupportComparison = compareReconcileSupportRows(supportLegacyData, matchingSupportRows);
assert.strictEqual(matchingSupportComparison.same_snapshot_support_rows, true,
  'all five keyset readers must match the legacy selected rows on the same proof run');
assert.deepStrictEqual(
  matchingSupportComparison.tables.calendar_posts.primary_key,
  ['client', 'id'],
  'Calendar proof identity must use its real composite primary key',
);
assert.deepStrictEqual(
  matchingSupportComparison.tables.sample_reviews.primary_key,
  ['client', 'id'],
  'Samples proof identity must use its real composite primary key',
);
const alignedSupportLegacy = alignLegacySupportRowsForProof(
  supportLegacyData,
  matchingSupportRows,
  matchingSupportComparison,
);
assert.deepStrictEqual(
  alignedSupportLegacy.calendarPosts.map(row => `${row.client}|${row.id}`),
  matchingSupportRows.calendarPosts.map(row => `${row.client}|${row.id}`),
  'proof comparison must align only the legacy support-row order to the candidate primary-key sequence',
);

const sameKeyChangedRows = JSON.parse(JSON.stringify(matchingSupportRows));
sameKeyChangedRows.calendarPosts[0].status = 'same-key-concurrent-change';
const sameKeyChangedComparison = compareReconcileSupportRows(supportLegacyData, sameKeyChangedRows);
assert.strictEqual(sameKeyChangedComparison.tables.calendar_posts.primary_key_set_equal, true);
assert.strictEqual(sameKeyChangedComparison.tables.calendar_posts.selected_rows_equal, false);
assert.strictEqual(sameKeyChangedComparison.same_snapshot_support_rows, false,
  'a same-key selected-value change must disprove the shared support-row snapshot');
assert.strictEqual(evaluateReadProofGate({
  projectionSource: 'actual',
  behavioralEquivalence: true,
  sharedLinearSnapshot: true,
  sameSnapshotSupportRows: sameKeyChangedComparison.same_snapshot_support_rows,
  legacySummary: movingCounters,
  candidateSummary: Object.assign({}, movingCounters),
}).rollout_gate_ok, false,
'support-row drift must fail closed even when all three absolute counters still coincide');

const sabotagedSupportRows = JSON.parse(JSON.stringify(matchingSupportRows));
sabotagedSupportRows.sampleReviews[0].video_deliverable_id = null;
const supportSabotageComparison = compareReconcileSupportRows(supportLegacyData, sabotagedSupportRows);
const supportCandidateData = Object.assign({}, supportLegacyData, sabotagedSupportRows, {
  allBatches: sabotagedSupportRows.batches,
});
const supportLegacyPlan = buildPlan(supportLegacyData);
const supportCandidatePlan = buildPlan(supportCandidateData);
assert.strictEqual(
  supportCandidatePlan.summary.linkage_actionable,
  supportLegacyPlan.summary.linkage_actionable + 1,
  'the support-row sabotage must change a real acceptance counter',
);
const supportSabotageGate = evaluateReadProofGate({
  projectionSource: 'actual',
  behavioralEquivalence: false,
  sharedLinearSnapshot: supportCandidateData.linearIssues === supportLegacyData.linearIssues
    && supportCandidateData.webhooks === supportLegacyData.webhooks,
  sameSnapshotSupportRows: supportSabotageComparison.same_snapshot_support_rows,
  legacySummary: supportLegacyPlan.summary,
  candidateSummary: supportCandidatePlan.summary,
});
assert.strictEqual(supportSabotageGate.same_snapshot_counter_equivalence, false);
assert.strictEqual(supportSabotageGate.rollout_gate_ok, false,
  'a genuine keyset-support reader divergence must fail the rollout gate');

assert.strictEqual(requireCompactDeliverables([projectedDeliverable]).length, 1);
assert.strictEqual(requireReadyProjection([{ projection_version: 1, ready: true }]).ready, true);
assert.throws(() => requireReadyProjection([{ projection_version: 1, ready: false }]), /not installed and ready/);
assert.throws(() => requireCompactDeliverables([Object.assign({}, projectedDeliverable, {
  source_linear_raw_sha256: '',
})]), /missing or stale/);
assert.deepStrictEqual(proofCounters({
  repair_list_size: 35,
  linkage_actionable: 46,
  outbound_diff_count: 2,
}), movingCounters);
assert.throws(() => proofCounters({ repair_list_size: 35, linkage_actionable: 46 }), /missing/,
  'a missing proof field must not be coerced to zero');
assert.throws(() => proofCounters({
  repair_list_size: 35,
  linkage_actionable: '46',
  outbound_diff_count: 2,
}), /invalid/,
'proof counters must remain exact JSON integers');

(async () => {
  const pageCalls = [];
  const pages = [
    [
      { id: 'id-a', team: 'video', identifier: 'VID-2' },
      { id: 'id-b', team: 'graphics', identifier: 'GRA-2' },
    ],
    [
      { id: 'id-c', team: 'video', identifier: null },
      { id: 'id-z', team: 'video', identifier: 'VID-1' },
    ],
    [],
  ];
  const keysetRows = await supabaseRowsByPrimaryKey(
    'linear_deliverables_reconcile_input_v1',
    'id,team,identifier',
    {
      serviceKey: 'bounded-read-test-key',
      limit: 2,
      fetchImpl: async url => {
        pageCalls.push(new URL(url));
        const page = pages.shift();
        return {
          ok: true,
          status: 200,
          json: async () => page,
          text: async () => '',
        };
      },
    },
  );
  assert.deepStrictEqual(keysetRows.map(row => row.id), ['id-a', 'id-b', 'id-c', 'id-z']);
  assert.strictEqual(pageCalls.length, 3, 'an exact full page must be followed by a terminal empty page');
  for (const call of pageCalls) {
    assert.strictEqual(call.searchParams.get('order'), 'id.asc');
    assert.strictEqual(call.searchParams.get('limit'), '2');
    assert.strictEqual(call.searchParams.has('offset'), false, 'primary-key paging must never emit OFFSET');
  }
  assert.strictEqual(pageCalls[0].searchParams.has('id'), false);
  assert.strictEqual(pageCalls[1].searchParams.get('id'), 'gt.id-b');
  assert.strictEqual(pageCalls[2].searchParams.get('id'), 'gt.id-z');
  assert.deepStrictEqual(
    canonicalDeliverableOrder(keysetRows).map(row => row.id),
    ['id-b', 'id-z', 'id-a', 'id-c'],
    'primary-key pages must be restored to the prior team/identifier order with NULLS LAST',
  );
  await assert.rejects(
    supabaseRowsByPrimaryKey('linear_deliverables_reconcile_input_v1', 'id', {
      serviceKey: 'bounded-read-test-key',
      limit: 1,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [{ id: 'same-id' }],
        text: async () => '',
      }),
    }),
    /missing or duplicate primary key/,
    'a repeated keyset cursor must fail closed',
  );

  const compositeCalls = [];
  const compositePages = [
    [
      { client: 'alpha', id: 'same-id' },
      { client: 'client,west', id: 'id(1)' },
    ],
    [{ client: 'client,west', id: 'same-id' }],
    [{ client: 'null', id: 'tail' }],
    [],
    [],
  ];
  const compositeRows = await supabaseRowsByPrimaryKey('calendar_posts', 'client,id', {
    serviceKey: 'bounded-read-test-key',
    limit: 2,
    primaryKey: ['client', 'id'],
    fetchImpl: async url => {
      compositeCalls.push(new URL(url));
      return {
        ok: true,
        status: 200,
        json: async () => compositePages.shift(),
        text: async () => '',
      };
    },
  });
  assert.deepStrictEqual(compositeRows.map(row => `${row.client}|${row.id}`), [
    'alpha|same-id',
    'client,west|id(1)',
    'client,west|same-id',
    'null|tail',
  ], 'the composite cursor must retain identical ids owned by different clients');
  assert.strictEqual(compositeCalls.length, 5);
  for (const call of compositeCalls) {
    assert.strictEqual(call.searchParams.get('order'), 'client.asc,id.asc');
    assert.strictEqual(call.searchParams.has('offset'), false);
    assert.strictEqual(call.searchParams.has('or'), false,
      'composite pagination must never hide its predicates in a planner-filtered OR');
  }
  assert.strictEqual(compositeCalls[0].searchParams.has('client'), false);
  assert.strictEqual(compositeCalls[0].searchParams.has('id'), false);
  assert.strictEqual(compositeCalls[0].searchParams.get('limit'), '2');
  assert.strictEqual(compositeCalls[1].searchParams.get('client'), 'eq."client,west"');
  assert.strictEqual(compositeCalls[1].searchParams.get('id'), 'gt."id(1)"');
  assert.strictEqual(compositeCalls[1].searchParams.get('limit'), '2');
  assert.strictEqual(compositeCalls[2].searchParams.get('client'), 'gt."client,west"');
  assert.strictEqual(compositeCalls[2].searchParams.has('id'), false);
  assert.strictEqual(compositeCalls[2].searchParams.get('limit'), '1',
    'the outer branch may fetch only the logical page capacity left by the exact-prefix branch');
  assert.strictEqual(compositeCalls[3].searchParams.get('client'), 'eq."null"');
  assert.strictEqual(compositeCalls[3].searchParams.get('id'), 'gt.tail');
  assert.strictEqual(compositeCalls[3].searchParams.get('limit'), '2');
  assert.strictEqual(compositeCalls[4].searchParams.get('client'), 'gt."null"');
  assert.strictEqual(compositeCalls[4].searchParams.has('id'), false);
  assert.strictEqual(compositeCalls[4].searchParams.get('limit'), '2');

  const orderedCompositeFixture = [
    { client: 'a', id: '1' },
    { client: 'a', id: '2' },
    { client: 'a', id: '3' },
    { client: 'b', id: '1' },
    { client: 'b', id: '2' },
    { client: 'c', id: '1' },
    { client: 'c', id: '2' },
    { client: 'c', id: '3' },
  ];
  const orderedCompositeCalls = [];
  const orderedCompositeRows = await supabaseRowsByPrimaryKey('calendar_posts', 'client,id', {
    serviceKey: 'bounded-read-test-key',
    limit: 3,
    primaryKey: ['client', 'id'],
    fetchImpl: async url => {
      const call = new URL(url);
      orderedCompositeCalls.push(call);
      let matches = orderedCompositeFixture;
      for (const column of ['client', 'id']) {
        const filter = call.searchParams.get(column);
        if (!filter) continue;
        const operator = filter.slice(0, 2);
        const value = filter.slice(3);
        matches = matches.filter(row => (
          operator === 'eq' ? row[column] === value : row[column] > value
        ));
      }
      const pageLimit = Number(call.searchParams.get('limit'));
      return {
        ok: true,
        status: 200,
        json: async () => matches.slice(0, pageLimit),
        text: async () => '',
      };
    },
  });
  assert.deepStrictEqual(orderedCompositeRows, orderedCompositeFixture,
    'split branches must preserve the complete global composite primary-key order');
  assert.ok(orderedCompositeCalls.every(call => (
    !call.searchParams.has('offset')
      && !call.searchParams.has('or')
      && Number(call.searchParams.get('limit')) <= 3
  )), 'every physical branch must stay inside the logical page cap with explicit indexable predicates');
  await assert.rejects(
    supabaseRowsByPrimaryKey('calendar_posts', 'client,id', {
      serviceKey: 'bounded-read-test-key',
      limit: 1,
      primaryKey: ['client', 'id'],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [{ id: 'missing-client' }],
        text: async () => '',
      }),
    }),
    /missing primary key/,
    'a missing composite primary-key component must fail closed',
  );
  await assert.rejects(
    supabaseRowsByPrimaryKey('calendar_posts', 'client,id', {
      serviceKey: 'bounded-read-test-key',
      limit: 1,
      primaryKey: ['client', 'id'],
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => [{ client: 'same-client', id: 'same-id' }],
        text: async () => '',
      }),
    }),
    /duplicate primary key|cursor did not advance/,
    'a non-advancing composite cursor must fail closed',
  );

  const supportCalls = [];
  const emptySupportRows = await loadReconcileSupportRows({
    serviceKey: 'bounded-read-test-key',
    fetchImpl: async url => {
      supportCalls.push(new URL(url));
      return {
        ok: true,
        status: 200,
        json: async () => [],
        text: async () => '',
      };
    },
  });
  assert.deepStrictEqual(Object.keys(emptySupportRows), [
    'calendarPosts',
    'sampleReviews',
    'linearArchive',
    'batches',
    'outboxRows',
  ]);
  assert.deepStrictEqual(Object.fromEntries(supportCalls.map(call => [
    call.pathname.split('/').pop(),
    call.searchParams.get('order'),
  ])), {
    calendar_posts: 'client.asc,id.asc',
    sample_reviews: 'client.asc,id.asc',
    linear_archive: 'linear_uuid.asc',
    batches: 'id.asc',
    mirror_outbox: 'id.asc',
  }, 'all five lifetime inputs must page on their exact checked-in primary keys');

  const driftedFull = Object.assign({}, fullDeliverable, { title: 'Stored old title' });
  const driftedCompact = Object.assign({}, projectedDeliverable, { title: 'Stored old title' });
  const compactData = fixtureData([driftedCompact], compactEvents);
  const before = buildPlan(compactData);
  assert.deepStrictEqual(before.results.filter(row => row.diffs.length).map(row => row.id), ['del_fixture']);
  const hydratedData = await hydrateDeliverableDiffRows(compactData, before, async (name, body) => {
    assert.strictEqual(name, 'linear_deliverables_reconcile_hydrate');
    assert.deepStrictEqual(body, { p_ids: ['del_fixture'] });
    return [Object.assign({}, driftedFull, { source_linear_raw_sha256: 'b'.repeat(64) })];
  });
  const hydratedPlan = buildPlan(hydratedData);
  assert.strictEqual(assertHydratedPlanEquivalent(before, hydratedPlan), hydratedPlan,
    'full-raw hydration must preserve the complete behavior contract');
  assert.strictEqual(hydratedPlan.results[0].row.linear_raw.irrelevant.length, 10000,
    'a diff row must regain its original full raw before a possible write');
  await assert.rejects(
    hydrateDeliverableDiffRows(compactData, before, async () => [Object.assign({}, driftedFull, {
      source_linear_raw_sha256: 'c'.repeat(64),
    })]),
    /stale, duplicate, or unrequested/,
    'a source hash mismatch must fail closed',
  );
  await assert.rejects(
    hydrateDeliverableDiffRows(compactData, before, async () => [], {
      ids: Array.from({ length: 101 }, (_, index) => `deliverable-${index}`),
      maxRows: 100,
    }),
    /Refusing to hydrate 101 full-raw row/,
    'full-raw hydration must have a hard per-run ceiling, not only a per-request page size',
  );

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
  const liveLoader = loadLiveData.toString();
  const legacyProofLoader = loadLegacyLiveDataForProof.toString();
  const boundedProofLoader = loadBoundedProjectionRowsForProof.toString();
  assert.ok(liveLoader.includes('loadReconcileDeliverableRows()')
    && liveLoader.includes('RECONCILE_COMMENT_IDS_VIEW')
    && liveLoader.includes('loadReconcileSupportRows()'));
  assert.ok(liveLoader.includes('loadReconcileDeliverableRows()')
    && !liveLoader.includes('supabaseRows(RECONCILE_DELIVERABLES_VIEW'),
  'normal deliverable loading must use primary-key keyset pagination');
  assert.ok(boundedProofLoader.includes('loadReconcileDeliverableRows()')
    && boundedProofLoader.includes('loadReconcileSupportRows()')
    && !boundedProofLoader.includes('supabaseRows(RECONCILE_DELIVERABLES_VIEW'),
  'the deployed-view proof must exercise the same primary-key keyset readers');
  assert.ok(legacyProofLoader.includes("order=team.asc,identifier.asc")
    && !legacyProofLoader.includes('canonicalDeliverableOrder'),
  'the legacy half of the proof must preserve the prior database-returned output order');
  assert.ok(!liveLoader.includes("supabaseRows('deliverables'")
    && !liveLoader.includes("supabaseRows('deliverable_events'"),
  'normal live loading must never fall back to either payload-bearing source table');
  for (const table of ['calendar_posts', 'sample_reviews', 'linear_archive', 'batches', 'mirror_outbox']) {
    assert.ok(!liveLoader.includes(`supabaseRows('${table}'`),
      `normal live loading must not OFFSET-page ${table}`);
    assert.ok(legacyProofLoader.includes(`supabaseRows('${table}'`),
      `the explicit proof reader must retain the legacy ${table} reader for same-run comparison`);
  }
  assert.strictEqual((source.match(/supabaseRows\('deliverable_events', '[^']*payload[^']*'/g) || []).length, 1,
    'the whole-history payload query may exist only in the explicit manual proof reader');
  assert.ok(/same_snapshot_support_rows/.test(source)
    && /selected_rows_equal/.test(source)
    && /primary_key_set_equal/.test(source)
    && !/query\.set\('or'/.test(source),
  'the read proof must fail closed on same-key support-row drift, not only missing keys or moving counters');

  const schemaBaseline = fs.readFileSync(
    path.join(ROOT, 'migrations', 'live-schema-baseline-2026-07-03.sql'),
    'utf8',
  );
  const trackBModel = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026-07-06-b1-linear-data-model.sql'),
    'utf8',
  );
  assert.ok(/calendar_posts_pkey PRIMARY KEY \(client, id\)/.test(schemaBaseline)
    && /sample_reviews_pkey PRIMARY KEY \(client, id\)/.test(schemaBaseline),
  'Calendar and Samples keysets must remain bound to their checked-in composite primary keys');
  assert.ok(/create table if not exists public\.batches \([\s\S]*?id text primary key/.test(trackBModel)
    && /create table if not exists public\.mirror_outbox \([\s\S]*?id bigint generated always as identity primary key/.test(trackBModel)
    && /create table if not exists public\.linear_archive \([\s\S]*?linear_uuid text primary key/.test(trackBModel),
  'the remaining support readers must stay bound to their checked-in single-column primary keys');

  const migration = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026-08-03-linear-reconciler-bounded-inputs.sql'),
    'utf8',
  );
  const executableMigration = migration.replace(/^\s*--.*$/gm, '');
  assert.ok(!/^\s*create\s+trigger\b/im.test(executableMigration)
    && !/^\s*create\s+table\b/im.test(executableMigration)
    && /from public\.deliverables d;/.test(migration)
    && /from public\.deliverable_events e/.test(migration),
  'both bounded inputs must compute on read without a source trigger, cache, or backfill writer');
  assert.ok(/cardinality\(p_ids\).*100/s.test(migration)
    && /source_linear_raw_sha256/.test(migration),
  'full raw hydration must be hash-bound and capped at 100 IDs');
  assert.ok(/max\(e\.ts\) as latest_ts/.test(migration)
    && /array_agg\(e\.id order by e\.ts desc, e\.id desc\)/.test(migration),
  'comment aggregation must retain the legacy newest-first ordering key');
  assert.ok(/where e\.deliverable_id is not null\s+and e\.source in \('ui', 'mirror', 'outbound'\)\s+and position\('comment' in lower\(e\.action\)\) > 0/s.test(migration)
    && !/deliverable_events[\s\S]*where[^;]*(?:ts|created_at)\s*[<>]=?/i.test(migration),
  'comment aggregation must expose the partial-index predicate and retain exact lifetime scope');
  assert.ok(/compute-on-read deliverable view is incomplete/.test(migration)
    && /compute-on-read deliverable view is invalid/.test(migration)
    && /compute-on-read install created a source trigger/.test(migration),
  'install validation must prove complete valid rows and the no-trigger boundary');
  assert.strictEqual((migration.match(/^commit;$/gm) || []).length, 1,
    'the no-trigger view/function install must be one atomic transaction');
  assert.ok(/linear_deliverables_reconcile_input_v1\s+with \(security_invoker = true\)/.test(migration)
    && !/linear_deliverables_reconcile_input_v1\s+with \(security_barrier/.test(migration),
  'the service-only deliverables view must allow primary-key predicate and LIMIT pushdown');
  assert.ok(/linear_reconcile_projection_status_v1/.test(migration)
    && /true as ready/.test(migration),
  'the normal reader may become ready only when the atomic compute-on-read install commits');
  assert.ok(/revoke all on table public\.linear_deliverables_reconcile_input_v1/.test(migration)
    && /grant select on table public\.linear_deliverables_reconcile_input_v1 to service_role/.test(migration)
    && !/^\s*grant\s+(?:select|insert|update|delete)\s+(?:\([^;]+\)\s+)?on\s+table\s+public\.(?:deliverables|deliverable_events)\b/im.test(migration)
    && /grant execute on function public\.linear_reconcile_compact_raw\(jsonb\)\s+to service_role/.test(migration),
  'bounded views and pure helpers must remain service-only without widening source-table ACLs');

  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'linear-deliverables-reconcile.yml'),
    'utf8',
  );
  assert.ok(/proof_only:/.test(workflow)
    && /--read-proof=true/.test(workflow)
    && /--expected-sha="\$PROOF_EXPECTED_SHA"/.test(workflow)
    && /--baseline-event-id="\$PROOF_BASELINE_EVENT_ID"/.test(workflow)
    && !/--required-(?:repair|linkage|outbound)=/.test(workflow),
  'the existing manual workflow must expose the exact-SHA read-only proof without an absolute counter gate');
  assert.ok(/cron: '\*\/10 \* \* \* \*'/.test(workflow)
    && !/cron: '0 \* \* \* \*'/.test(workflow),
  'the repository cron must remain unchanged; only the live n8n V2 branch has temporary hourly relief');
  assert.deepStrictEqual(
    [...new Set([...workflow.matchAll(/\bnode\s+(scripts\/[A-Za-z0-9._/-]+\.js)/g)]
      .map(match => match[1]).filter(pathValue => pathValue.includes('linear-deliverables-reconcile')))],
    ['scripts/linear-deliverables-reconcile.js'],
    'proof mode must reuse the reviewed reconciler entrypoint instead of widening the F27 closure',
  );
  assert.ok(/Read proof blocked a non-allowlisted Supabase request/.test(source)
    && /Read proof blocked a Linear mutation or malformed query/.test(source)
    && /Read proof SHA guard failed/.test(source)
    && /baseline-event-id is required/.test(source)
    && /ok: gate\.rollout_gate_ok/.test(source)
    && /same_snapshot_counter_equivalence/.test(source)
    && /same_snapshot_support_rows/.test(source)
    && !/READ_PROOF_REQUIRED_COUNTERS|required-repair|required-linkage|required-outbound/.test(source),
  'proof mode must keep the network guard and fail closed on same-snapshot counter or support-row divergence');

  const optionalIndex = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026-08-03-linear-reconciler-comment-index-optional.sql'),
    'utf8',
  );
  assert.ok(/create index concurrently if not exists deliverable_events_linear_comment_candidate_idx/i.test(optionalIndex)
    && /where deliverable_id is not null\s+and source in \('ui', 'mirror', 'outbound'\)\s+and position\('comment' in lower\(action\)\) > 0/s.test(optionalIndex)
    && !/(?:ts|created_at)\s*[<>]=?\s*(?:now|current_)/i.test(optionalIndex),
  'the optional write-nonblocking index must match the exact lifetime candidate predicate');

  const installWindow = fs.readFileSync(
    path.join(ROOT, 'docs', 'ops', 'LINEAR_RECONCILER_BOUNDED_READ_WINDOW.md'),
    'utf8',
  );
  const preCommitRecovery = installWindow.match(
    /On any pre-COMMIT database failure[\s\S]*?(?=\r?\n\r?\nOn a post-COMMIT proof failure)/,
  );
  assert.ok(preCommitRecovery, 'the install window must retain a bounded pre-COMMIT recovery branch');
  assert.ok(installWindow.includes('qllIDZPkdNAPRj0b')
    && installWindow.includes('Trigger Reconciler V2')
    && /shared 15-minute trigger remains unchanged/.test(installWindow)
    && /roughly 37 full reconciler runs\/day/.test(installWindow)
    && /no quarter-hour V2 `workflow_dispatch` calls/.test(installWindow)
    && /identical legacy-versus-bounded[\s\S]*counters in the same acceptance run/.test(installWindow)
    && /absolute counter values[\s\S]*evidence[\s\S]*do not assert a fixed value/.test(installWindow)
    && /Read back that all ten candidate objects are absent/.test(preCommitRecovery[0])
    && /revert repository source while[\s\S]*disabled/.test(preCommitRecovery[0])
    && /exact reverted `main` SHA/.test(preCommitRecovery[0])
    && /re-enable and[\s\S]*read back the reverted workflow/.test(preCommitRecovery[0])
    && /terminal-success run plus its reconciler summary/.test(preCommitRecovery[0])
    && /No n8n edit is included in PR #1013/.test(installWindow),
  'the install window must preserve the isolated hourly V2 relief and unchanged shared trigger');

  const repoMap = fs.readFileSync(path.join(ROOT, 'REPO_MAP.md'), 'utf8');
  for (const requiredPath of [
    'migrations/2026-08-03-linear-reconciler-bounded-inputs.sql',
    'migrations/2026-08-03-linear-reconciler-comment-index-optional.sql',
    'test/linear-deliverables-reconcile-bounded-reads.js',
    'test/linear-deliverables-reconcile-bounded-postgres.js',
    'docs/ops/LINEAR_RECONCILER_BOUNDED_READ_WINDOW.md',
  ]) {
    assert.ok(repoMap.includes(requiredPath), `REPO_MAP must register ${requiredPath}`);
  }

  console.log('linear-deliverables-reconcile bounded-read checks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
