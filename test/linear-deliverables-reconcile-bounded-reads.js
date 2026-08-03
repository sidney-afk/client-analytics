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
  loadLiveData,
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

assert.strictEqual(requireCompactDeliverables([projectedDeliverable]).length, 1);
assert.strictEqual(requireReadyProjection([{ projection_version: 1, ready: true }]).ready, true);
assert.throws(() => requireReadyProjection([{ projection_version: 1, ready: false }]), /not installed and ready/);
assert.throws(() => requireCompactDeliverables([Object.assign({}, projectedDeliverable, {
  source_linear_raw_sha256: '',
})]), /missing or stale/);

(async () => {
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
  assert.ok(liveLoader.includes('RECONCILE_DELIVERABLES_VIEW')
    && liveLoader.includes('RECONCILE_COMMENT_IDS_VIEW'));
  assert.ok(!liveLoader.includes("supabaseRows('deliverables'")
    && !liveLoader.includes("supabaseRows('deliverable_events'"),
  'normal live loading must never fall back to either payload-bearing source table');
  assert.strictEqual((source.match(/supabaseRows\('deliverable_events', '[^']*payload[^']*'/g) || []).length, 1,
    'the whole-history payload query may exist only in the explicit manual proof reader');

  const migration = fs.readFileSync(
    path.join(ROOT, 'migrations', '2026-08-03-linear-reconciler-bounded-inputs.sql'),
    'utf8',
  );
  assert.ok(/linear_reconcile_deliverable_cache_after/.test(migration)
    && /linear_reconcile_comment_event_after/.test(migration),
  'both persisted projections must be trigger-maintained');
  assert.ok(/cardinality\(p_ids\).*100/s.test(migration)
    && /source_linear_raw_sha256/.test(migration),
  'full raw hydration must be hash-bound and capped at 100 IDs');
  assert.ok(/max\(event_ts\) as latest_ts/.test(migration)
    && /array_agg\(event_id order by event_ts desc, event_id desc\)/.test(migration),
  'comment aggregation must retain the legacy newest-first ordering key');
  assert.ok(/full join public\.linear_reconcile_deliverable_cache/.test(migration)
    && /full join public\.linear_reconcile_comment_event_map/.test(migration),
  'install validation must detect missing, extra, and mismatched projection rows');
  assert.strictEqual((migration.match(/^commit;$/gm) || []).length, 3,
    'source trigger DDL locks must be committed before either JSON backfill runs');
  assert.ok(/linear_reconcile_projection_status_v1/.test(migration)
    && /set ready = true/.test(migration),
  'the normal reader must stay fail-closed until all backfills and validations complete');
  assert.ok(/revoke all on table public\.linear_reconcile_deliverable_cache/.test(migration)
    && /grant select on table public\.linear_deliverables_reconcile_input_v1 to service_role/.test(migration),
  'projection storage and view must remain service-only');

  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'linear-deliverables-reconcile.yml'),
    'utf8',
  );
  assert.ok(/proof_only:/.test(workflow)
    && /--read-proof=true/.test(workflow)
    && /--expected-sha="\$PROOF_EXPECTED_SHA"/.test(workflow),
  'the existing manual workflow must expose the exact-SHA read-only proof');
  assert.deepStrictEqual(
    [...new Set([...workflow.matchAll(/\bnode\s+(scripts\/[A-Za-z0-9._/-]+\.js)/g)]
      .map(match => match[1]).filter(pathValue => pathValue.includes('linear-deliverables-reconcile')))],
    ['scripts/linear-deliverables-reconcile.js'],
    'proof mode must reuse the reviewed reconciler entrypoint instead of widening the F27 closure',
  );
  assert.ok(/Read proof blocked a non-allowlisted Supabase request/.test(source)
    && /Read proof blocked a Linear mutation or malformed query/.test(source),
  'proof mode must install a fail-closed network write guard before live loading');

  console.log('linear-deliverables-reconcile bounded-read checks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
