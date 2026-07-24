'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  OWNER_MANIFEST_SCHEMA,
  buildProjectIndex,
  configuredProjectIds,
  persistedExplicitClassifications,
  resolveAttributionGraph,
  storageClientSlug,
} = require('../scripts/f200-attribution');
const {
  buildRepairPlan,
  cohortSnapshotHash,
  parseArgs,
  publicReport,
} = require('../scripts/f200-attribution-plan');
const {
  batchGroupKey,
  batchRowsFor,
  deliverableRow,
  unresolvedAttributionSentinel,
} = require('../scripts/b1-linear-backfill');
const {
  buildF200CasPatchRequest,
  buildF200RepairExecutionPlan,
  buildPlan: buildReconcilePlan,
  buildSummaryEventPayload,
  f200RepairRowState,
  requireSingleF200CasPatchRow,
} = require('../scripts/linear-deliverables-reconcile');
const { assertPrivateOutputPath } = require('../scripts/f200-attribution-live-snapshot');

function ok(condition, message) {
  if (!condition) {
    console.error('FAIL f200-attribution:', message);
    process.exit(1);
  }
}

function throws(fn, pattern, message) {
  let error = null;
  try { fn(); } catch (caught) { error = caught; }
  ok(error && pattern.test(String(error.message)), message);
}

const clients = [
  {
    slug: 'client-a',
    display_name: 'Private Client A',
    kind: 'client',
    active: true,
    linear_project_ids: { video: 'project-a', graphics: { id: 'project-a' } },
  },
  {
    slug: 'client-b',
    display_name: 'Private Client B',
    kind: 'client',
    active: true,
    linear_project_ids: { video: 'project-b' },
  },
  {
    slug: 'sidneylaruel',
    display_name: 'TEST',
    kind: 'test',
    active: true,
    linear_project_ids: { video: 'project-test' },
  },
  {
    slug: 'internal-owner',
    display_name: 'Internal',
    kind: 'internal',
    active: true,
    linear_project_ids: {},
  },
  {
    slug: 'inactive-test',
    display_name: 'Inactive TEST',
    kind: 'test',
    active: false,
    linear_project_ids: { video: 'project-inactive' },
  },
  {
    slug: 'unattributed',
    display_name: 'Storage sentinel',
    kind: 'internal',
    active: false,
    linear_project_ids: {},
  },
];

ok(JSON.stringify(configuredProjectIds({
  video: 'project-a',
  graphics: { id: 'project-gra', note: 'not-a-project' },
  notes: { id: 'hostile-metadata-id' },
})) === JSON.stringify(['project-a', 'project-gra']),
'only documented configured project-id shapes become attribution authority');

const index = buildProjectIndex(clients);
ok(index.projectOwners.get('project-a').slug === 'client-a'
  && !index.projectOwners.has('project-inactive')
  && !index.clientBySlug.has('unattributed'),
'project index is global, active-roster-only, and excludes the storage sentinel');

throws(() => buildProjectIndex([
  clients[0],
  { ...clients[1], linear_project_ids: { graphics: 'project-a' } },
]), /multiple active roster owners/, 'cross-owner duplicate project mappings fail closed');

const hierarchy = [
  { id: 'grandparent', identifier: 'VID-GRAND', parent: null, project: null },
  { id: 'parent', identifier: 'VID-PARENT', parent: { id: 'grandparent' }, project: null },
  { id: 'child', identifier: 'VID-CHILD', parent: { id: 'parent' }, project: { id: 'project-a' } },
  {
    id: 'name-trap',
    identifier: 'VID-NAME',
    title: 'Private Client A',
    project: { id: 'unknown-project', name: 'Private Client A' },
    parent: null,
  },
  {
    id: 'explicit-test',
    identifier: 'VID-TEST',
    project: null,
    parent: null,
  },
];
const hierarchyGraph = resolveAttributionGraph(hierarchy, clients, {
  familyComplete: true,
  explicitClassifications: {
    'explicit-test': {
      classification: 'explicit_internal_test',
      client_slug: 'sidneylaruel',
      reason: 'owner_classified_test_work',
    },
  },
});
ok(hierarchyGraph.byIssueId.get('child').state === 'resolved'
  && hierarchyGraph.byIssueId.get('child').source === 'direct_project'
  && hierarchyGraph.byIssueId.get('child').client_slug === 'client-a',
'direct mapped project resolves to its active roster owner');
ok(hierarchyGraph.byIssueId.get('parent').state === 'provisional_child_family'
  && hierarchyGraph.byIssueId.get('parent').provisional_client_slug === 'client-a'
  && hierarchyGraph.byIssueId.get('grandparent').state === 'provisional_child_family'
  && hierarchyGraph.byIssueId.get('grandparent').provisional_client_slug === 'client-a',
'unanimous child-family propagation reaches a bounded multi-level fixpoint');
ok(hierarchyGraph.byIssueId.get('name-trap').state === 'needs_attribution'
  && hierarchyGraph.byIssueId.get('name-trap').client_slug === null,
'unknown project names and issue titles never infer a client slug');
ok(hierarchyGraph.byIssueId.get('explicit-test').state === 'resolved'
  && hierarchyGraph.byIssueId.get('explicit-test').source === 'explicit_internal_test_classification'
  && hierarchyGraph.byIssueId.get('explicit-test').owner_kind === 'test'
  && hierarchyGraph.byIssueId.get('explicit-test').client_slug === 'sidneylaruel',
'owner-approved projectless TEST work can use an active explicit TEST owner');

const explicitRosterGraph = resolveAttributionGraph([{ id: 'explicit-roster' }], clients, {
  explicitClassifications: {
    'explicit-roster': {
      classification: 'explicit_roster',
      client_slug: 'client-a',
      reason: 'owner_roster_classification',
    },
  },
});
ok(explicitRosterGraph.byIssueId.get('explicit-roster').state === 'resolved'
  && explicitRosterGraph.byIssueId.get('explicit-roster').source === 'explicit_roster_classification'
  && explicitRosterGraph.byIssueId.get('explicit-roster').owner_kind === 'client'
  && explicitRosterGraph.byIssueId.get('explicit-roster').client_slug === 'client-a',
'owner classification may select an existing active roster client without deriving or creating one');
throws(() => resolveAttributionGraph([{ id: 'bad-inactive' }], clients, {
  explicitClassifications: {
    'bad-inactive': { classification: 'explicit_internal_test', client_slug: 'inactive-test' },
  },
}), /active roster owner/, 'projectless explicit classifications cannot target an inactive TEST row');
throws(() => resolveAttributionGraph([{ id: 'bad-unknown' }], clients, {
  explicitClassifications: {
    'bad-unknown': { classification: 'explicit_roster', client_slug: 'does-not-exist' },
  },
}), /active roster owner/, 'projectless explicit classifications cannot target an unknown slug');
throws(() => resolveAttributionGraph([{ id: 'wrong-mode' }], clients, {
  explicitClassifications: {
    'wrong-mode': { classification: 'explicit_internal_test', client_slug: 'client-a' },
  },
}), /does not match owner kind/, 'explicit mode cannot be reinterpreted for a different owner kind');
throws(() => resolveAttributionGraph([{ id: 'unknown-mode' }], clients, {
  explicitClassifications: {
    'unknown-mode': { classification: 'typo_mode', client_slug: 'client-a' },
  },
}), /mode is invalid/, 'unknown explicit classification modes fail closed');

const conflictGraph = resolveAttributionGraph([
  { id: 'family-parent', project: null, parent: null },
  { id: 'family-a', project: { id: 'project-a' }, parent: { id: 'family-parent' } },
  { id: 'family-b', project: { id: 'project-b' }, parent: { id: 'family-parent' } },
], clients, { familyComplete: true });
ok(conflictGraph.byIssueId.get('family-parent').state === 'conflict'
  && conflictGraph.byIssueId.get('family-parent').reason === 'child_family_conflict',
'conflicting child clients fail visibly instead of selecting a client');

const propagatedConflict = resolveAttributionGraph([
  { id: 'conflict-grandparent', project: null, parent: null },
  {
    id: 'conflict-parent',
    project: { id: 'project-a' },
    parent: { id: 'conflict-grandparent' },
  },
  {
    id: 'conflict-child',
    project: { id: 'project-b' },
    parent: { id: 'conflict-parent' },
  },
], clients, { familyComplete: true });
ok(['conflict-grandparent', 'conflict-parent', 'conflict-child']
  .every(id => propagatedConflict.byIssueId.get(id).state === 'conflict'),
'a late descendant mismatch propagates to every already-provisional ancestor at a stable fixpoint');

const unresolvedIssue = {
  id: 'unknown-issue',
  identifier: 'VID-UNKNOWN',
  title: 'Private Client A',
  description: '',
  url: 'https://linear.example/VID-UNKNOWN',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  team: { key: 'VID' },
  state: { id: 'state-progress', name: 'In Progress', type: 'started' },
  project: { id: 'unknown-project', name: 'Private Client A' },
  parent: null,
  assignee: null,
  children: { nodes: [] },
};
const unresolvedGraph = resolveAttributionGraph([unresolvedIssue], clients, { familyComplete: false });
const sentinel = unresolvedAttributionSentinel(clients);
const batches = batchRowsFor([unresolvedIssue], unresolvedGraph, sentinel);
const batchByKey = new Map([[
  batchGroupKey(unresolvedIssue, unresolvedGraph, sentinel),
  batches[0],
]]);
const unresolvedRow = deliverableRow(
  unresolvedIssue,
  batchByKey,
  new Map(),
  new Map(),
  new Map(),
  unresolvedGraph,
  sentinel,
);
ok(storageClientSlug(unresolvedGraph.byIssueId.get('unknown-issue'), sentinel) === 'unattributed'
  && unresolvedRow.client_slug === 'unattributed'
  && unresolvedRow.linear_raw.attribution.state === 'needs_attribution'
  && unresolvedRow.linear_raw.attribution.client_slug === null,
'unattributed is only the FK storage sentinel while raw state remains visibly needs_attribution');

const reconciled = buildReconcilePlan({
  deliverables: [{
    id: 'del-stale',
    identifier: 'VID-UNKNOWN',
    batch_id: 'batch-stale',
    client_slug: 'client-a',
    team: 'video',
    kind: 'video',
    title: 'Private Client A',
    status: 'in_progress',
    due_date: null,
    priority: 0,
    assignee_id: null,
    origin: 'manual',
    linear_issue_uuid: 'unknown-issue',
    linear_identifier: 'VID-UNKNOWN',
    linear_raw: {
      issue: { id: 'unknown-issue' },
      attribution: {
        schema: 'syncview_attribution_v1',
        state: 'resolved',
        client_slug: 'client-a',
        source: 'stale',
        mapping_revision: 'old',
      },
    },
  }],
  allDeliverables: [],
  members: [],
  events: [],
  calendarPosts: [],
  sampleReviews: [],
  linearArchive: [],
  batches: [],
  allBatches: [],
  outboxRows: [],
  clients,
  prodAuthority: { video: 'linear', graphics: 'linear' },
  linearIssues: new Map([['unknown-issue', unresolvedIssue]]),
  webhooks: [],
});
const staleResult = reconciled.results.find(row => row.id === 'del-stale');
ok(staleResult.patch.client_slug === 'unattributed'
  && staleResult.patch.linear_raw.attribution.state === 'needs_attribution'
  && staleResult.repairs.some(row => row.field === 'client_attribution'),
'scheduled reconciler wiring invalidates a stale normal-client slug and persists visible repair state');

const scheduledParent = {
  ...unresolvedIssue,
  id: 'scheduled-parent',
  identifier: 'VID-PARENT',
  title: 'Scheduled parent',
  project: null,
  parent: null,
};
const scheduledChild = {
  ...unresolvedIssue,
  id: 'scheduled-child',
  identifier: 'VID-CHILD',
  title: 'Scheduled child',
  project: { id: 'project-a' },
  parent: { id: 'scheduled-parent' },
};
const scheduledRow = issue => ({
  id: `del-${issue.id}`,
  identifier: issue.identifier,
  batch_id: `batch-${issue.id}`,
  client_slug: issue.id === 'scheduled-child' ? 'client-a' : 'unattributed',
  team: 'video',
  kind: 'video',
  title: issue.title,
  status: 'in_progress',
  due_date: null,
  priority: 0,
  assignee_id: null,
  origin: 'manual',
  linear_issue_uuid: issue.id,
  linear_identifier: issue.identifier,
  linear_raw: { issue },
});
const familyReconcile = buildReconcilePlan({
  deliverables: [scheduledRow(scheduledParent), scheduledRow(scheduledChild)],
  allDeliverables: [],
  members: [],
  events: [],
  calendarPosts: [],
  sampleReviews: [],
  linearArchive: [],
  batches: [],
  allBatches: [],
  outboxRows: [],
  clients,
  attributionFamilyComplete: true,
  prodAuthority: { video: 'linear', graphics: 'linear' },
  linearIssues: new Map([
    ['scheduled-parent', scheduledParent],
    ['scheduled-child', scheduledChild],
  ]),
  webhooks: [],
});
const scheduledParentResult = familyReconcile.results.find(row => row.id === 'del-scheduled-parent');
ok(familyReconcile.summary.attribution.by_state.provisional_child_family === 1
  && scheduledParentResult.patch.linear_raw.attribution.state === 'provisional_child_family'
  && scheduledParentResult.patch.linear_raw.attribution.provisional_client_slug === 'client-a'
  && scheduledParentResult.patch.client_slug === undefined,
'complete scheduled reconciliation detects the owner-reproduced unanimous child family as provisional without silently assigning its client');

const cohortClients = [
  {
    slug: 'sidneylaruel',
    kind: 'test',
    active: true,
    linear_project_ids: {},
  },
  {
    slug: 'unattributed',
    kind: 'internal',
    active: false,
    linear_project_ids: {},
  },
];
const cohortDeliverables = [];
const cohortIssues = [];
for (let i = 1; i <= 72; i++) {
  const id = `linear-test-${String(i).padStart(2, '0')}`;
  const issue = {
    id,
    identifier: `VID-T${String(i).padStart(2, '0')}`,
    team: { key: 'VID' },
    project: null,
    parent: null,
  };
  cohortIssues.push(issue);
  cohortDeliverables.push({
    id: `deliverable-test-${String(i).padStart(2, '0')}`,
    identifier: issue.identifier,
    linear_issue_uuid: id,
    client_slug: 'unattributed',
    team: 'video',
    updated_at: '2026-07-23T00:00:00.000Z',
    linear_raw: { issue },
  });
}
const snapshot = {
  family_complete: true,
  clients: cohortClients,
  deliverables: cohortDeliverables,
  linear_issues: cohortIssues,
};
const manifest = {
  schema: OWNER_MANIFEST_SCHEMA,
  owner_approved: true,
  expected_count: 72,
  snapshot_sha256: cohortSnapshotHash(snapshot),
  decision_ref: 'synthetic-test-owner-gate',
  issues: Object.fromEntries(cohortIssues.map(issue => [issue.id, {
    classification: 'explicit_internal_test',
    client_slug: 'sidneylaruel',
    reason: 'synthetic_test_scope',
  }])),
};
const repairPlan = buildRepairPlan(snapshot, manifest);
ok(repairPlan.proof.complete === true
  && repairPlan.proof.resolved_count === 72
  && repairPlan.proof.exact_payload_count === true
  && repairPlan.proof.source_cohort_is_unattributed_repair === true
  && repairPlan.payloads.length === 72
  && repairPlan.rows.length === 72,
'owner manifest and repair payload scope are exactly the audited 72 rows');
ok(repairPlan.payloads.every(payload => payload.mutation === 'deliverables_cas_patch'
  && payload.table === 'deliverables'
  && JSON.stringify(Object.keys(payload.patch).sort())
    === JSON.stringify(['client_slug', 'linear_raw'])
  && payload.patch.client_slug === 'sidneylaruel'
  && payload.patch.linear_raw.attribution.state === 'resolved'
  && payload.patch.linear_raw.attribution.explicit_owner_approved === true
  && payload.patch.linear_raw.attribution.explicit_decision_ref === manifest.decision_ref
  && /^[a-f0-9]{64}$/.test(
    payload.patch.linear_raw.attribution.explicit_manifest_sha256,
  )),
'planner emits only exact bounded attribution-only CAS patch descriptors');

const reportText = JSON.stringify(publicReport(repairPlan));
ok(!reportText.includes('sidneylaruel')
  && !reportText.includes('deliverable-test-')
  && !reportText.includes('linear-test-'),
'public planner report is aggregate-only and excludes private slugs and row ids');

throws(() => buildRepairPlan(snapshot, {
  ...manifest,
  issues: Object.fromEntries(Object.entries(manifest.issues).slice(0, 71)),
}), /exactly equal the bounded cohort/, 'owner manifest cannot omit one of the exact 72 rows');
throws(() => buildRepairPlan({
  ...snapshot,
  deliverables: snapshot.deliverables.map((row, index) => (
    index === 0 ? { ...row, client_slug: 'client-a' } : row
  )),
}, manifest), /known unattributed repair cohort/,
'planner cannot repurpose an arbitrary 72-row active-client cohort');
throws(() => buildRepairPlan({
  ...snapshot,
  deliverables: snapshot.deliverables.map((row, index) => (
    index === 0
      ? { ...row, linear_raw: { ...row.linear_raw, attribution: { state: 'resolved' } } }
      : row
  )),
}, manifest), /known unattributed repair cohort/,
'planner rejects rows already carrying a resolved state from the repair cohort');
throws(() => buildRepairPlan(snapshot, {
  ...manifest,
  issues: Object.fromEntries(cohortIssues.map(issue => [issue.id, {
    classification: 'explicit_internal_test',
    client_slug: 'client-a',
  }])),
}, { expectedCount: 72 }), /active roster owner/,
'planner cannot target an owner absent from the active repair roster');
throws(() => parseArgs(['--apply']), /no write mode/, 'offline planner rejects apply mode');

const firstPayload = repairPlan.payloads[0];
const firstSourceRow = cohortDeliverables.find(
  row => row.id === firstPayload.precondition.deliverable_id,
);
const firstIssue = cohortIssues.find(
  issue => issue.id === firstPayload.precondition.linear_issue_uuid,
);
const pendingRepair = f200RepairRowState(firstSourceRow, firstIssue, firstPayload);
ok(pendingRepair.state === 'pending'
  && pendingRepair.patch.client_slug === 'sidneylaruel'
  && pendingRepair.patch.linear_raw.attribution.state === 'resolved',
'exact repair rechecks a pending row and merges only the resolved attribution');
const casRequest = buildF200CasPatchRequest(firstSourceRow, pendingRepair, {
  baseUrl: 'https://example.invalid',
  key: 'test-key',
});
ok(casRequest.init.method === 'PATCH'
  && casRequest.init.headers.Prefer === 'return=representation'
  && casRequest.url.includes(`id=eq.${firstSourceRow.id}`)
  && casRequest.url.includes(`updated_at=eq.${encodeURIComponent(firstSourceRow.updated_at)}`)
  && casRequest.url.includes('client_slug=eq.unattributed')
  && JSON.stringify(Object.keys(JSON.parse(casRequest.init.body)).sort())
    === JSON.stringify(['client_slug', 'linear_raw']),
'CAS request binds id, updated_at, and sentinel while patching only attribution ownership fields');
throws(() => requireSingleF200CasPatchRow([], firstSourceRow.id), /expected exactly 1/,
'CAS executor refuses a zero-row update caused by concurrent drift');
throws(() => requireSingleF200CasPatchRow([
  { id: firstSourceRow.id },
  { id: 'unexpected-second-row' },
], firstSourceRow.id), /expected exactly 1/,
'CAS executor refuses a non-singleton update result');
const firstRepairedRow = {
  ...firstSourceRow,
  client_slug: firstPayload.patch.client_slug,
  updated_at: '2026-07-23T00:00:01.000Z',
  linear_raw: firstPayload.patch.linear_raw,
};
ok(f200RepairRowState(firstRepairedRow, firstIssue, firstPayload).state === 'already_applied',
'exact repair recognizes an already-applied row so a partial run is resumable');
throws(() => f200RepairRowState(firstRepairedRow, {
  ...firstIssue,
  project: { id: 'changed-project-after-private-plan' },
}, firstPayload), /Linear issue drifted/,
'already-applied repair rows still require the freshly read project hierarchy to match the private plan');
throws(() => f200RepairRowState({
  ...firstSourceRow,
  linear_raw: { ...firstSourceRow.linear_raw, labels: ['concurrent-change'] },
}, firstIssue, firstPayload), /precondition drifted/,
'exact repair aborts when current raw state changes before the write');

const persisted = persistedExplicitClassifications([firstRepairedRow], cohortClients);
const postRepairGraph = resolveAttributionGraph([firstIssue], cohortClients, {
  explicitClassifications: persisted,
  familyComplete: false,
});
ok(postRepairGraph.byIssueId.get(firstIssue.id).state === 'resolved'
  && postRepairGraph.byIssueId.get(firstIssue.id).client_slug === 'sidneylaruel'
  && postRepairGraph.byIssueId.get(firstIssue.id).source
    === 'explicit_internal_test_classification',
'a proven projectless owner decision remains durable on the next attribution pass');
const postRepairBatches = batchRowsFor(
  [firstIssue],
  postRepairGraph,
  unresolvedAttributionSentinel(cohortClients),
);
const postRepairBatchByKey = new Map();
for (const batch of postRepairBatches) {
  for (const issue of batch._issues) {
    postRepairBatchByKey.set(
      batchGroupKey(issue, postRepairGraph, unresolvedAttributionSentinel(cohortClients)),
      batch,
    );
  }
}
const postRepairB1Row = deliverableRow(
  firstIssue,
  postRepairBatchByKey,
  new Map(),
  new Map(),
  new Map(),
  postRepairGraph,
  unresolvedAttributionSentinel(cohortClients),
);
ok(postRepairB1Row.client_slug === 'sidneylaruel'
  && postRepairB1Row.linear_raw.attribution.state === 'resolved',
'the next B1 projection keeps the proven projectless owner instead of restoring the sentinel');
const postRepairReconcile = buildReconcilePlan({
  deliverables: [{
    ...firstRepairedRow,
    identifier: firstIssue.identifier,
    title: firstIssue.identifier,
    status: 'todo',
    kind: 'video',
    origin: 'manual',
  }],
  allDeliverables: [{
    ...firstRepairedRow,
    identifier: firstIssue.identifier,
    title: firstIssue.identifier,
    status: 'todo',
    kind: 'video',
    origin: 'manual',
  }],
  clients: cohortClients,
  members: [],
  events: [],
  batches: [],
  allBatches: [],
  outboxRows: [],
  calendarPosts: [],
  sampleReviews: [],
  linearArchive: [],
  attributionFamilyComplete: false,
  prodAuthority: { video: 'linear', graphics: 'linear' },
  linearIssues: new Map([[firstIssue.id, firstIssue]]),
  webhooks: [],
});
const postRepairReconcileRow = postRepairReconcile.results[0];
ok(postRepairReconcileRow.patch.client_slug !== 'unattributed'
  && !(postRepairReconcileRow.patch.linear_raw
    && postRepairReconcileRow.patch.linear_raw.attribution.state === 'needs_attribution'),
'the next scheduled reconcile does not undo a proven projectless owner decision');

const executionData = {
  deliverables: cohortDeliverables,
  allDeliverables: cohortDeliverables,
  clients: cohortClients,
  prodAuthority: { video: 'linear', graphics: 'linear' },
  linearIssues: new Map(cohortIssues.map(issue => [issue.id, issue])),
  webhooks: [],
};
const executionPlan = buildF200RepairExecutionPlan(executionData, repairPlan);
ok(executionPlan.f200Repair === true
  && executionPlan.results.length === 72
  && executionPlan.results.every(row => row.repair_payload
    && row.repair_payload.mutation === 'deliverables_cas_patch'),
'existing reconciler consumes the exact 72 validated private CAS repair descriptors');
const privateSummaryPayload = buildSummaryEventPayload(
  executionPlan,
  '2026-07-23T00:00:00.000Z',
  '2026-07-23T00:00:01.000Z',
);
ok(privateSummaryPayload.inbound_identifier_sample.length === 0
  && privateSummaryPayload.linkage_sample.length === 0
  && privateSummaryPayload.tolerated_sample.length === 0
  && privateSummaryPayload.repair_sample.length === 0
  && privateSummaryPayload.identifier_filter === null
  && privateSummaryPayload.client_filter === null
  && privateSummaryPayload.test_authority_client === null
  && !JSON.stringify(privateSummaryPayload).includes(firstIssue.identifier)
  && !JSON.stringify(privateSummaryPayload).includes(firstIssue.id)
  && !JSON.stringify(privateSummaryPayload).includes(firstSourceRow.id),
'generic F200 summary events are aggregate-only and persist no private identifiers or row samples');
const privateSummaryWithFilters = JSON.parse(execFileSync(process.execPath, [
  '-e',
  [
    "process.env.B4_CONFIRM_TEST_MUTATIONS = '1';",
    "process.argv.push('--identifier=VID-SECRET', '--client=private-client', '--test-authority-client=sidneylaruel');",
    "const { buildSummaryEventPayload } = require('./scripts/linear-deliverables-reconcile');",
    "process.stdout.write(JSON.stringify(buildSummaryEventPayload({ f200Repair: true, results: [], linkageRows: [], summary: {} }, 'start', 'finish')));",
  ].join(' '),
], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
}));
ok(privateSummaryWithFilters.identifier_filter === null
  && privateSummaryWithFilters.client_filter === null
  && privateSummaryWithFilters.test_authority_client === null
  && !JSON.stringify(privateSummaryWithFilters).includes('VID-SECRET')
  && !JSON.stringify(privateSummaryWithFilters).includes('private-client')
  && !JSON.stringify(privateSummaryWithFilters).includes('sidneylaruel'),
'F200 aggregate-only summaries suppress populated invocation filters as well as row samples');
const resumableExecutionPlan = buildF200RepairExecutionPlan({
  ...executionData,
  deliverables: executionData.deliverables.map(row => (
    row.id === firstRepairedRow.id
      ? {
        ...firstRepairedRow,
        updated_at: '2026-07-23T00:00:02.000Z',
        linear_raw: { ...firstRepairedRow.linear_raw, labels: ['post-repair-label'] },
      }
      : row
  )),
  allDeliverables: executionData.allDeliverables.map(row => (
    row.id === firstRepairedRow.id
      ? {
        ...firstRepairedRow,
        updated_at: '2026-07-23T00:00:02.000Z',
        linear_raw: { ...firstRepairedRow.linear_raw, labels: ['post-repair-label'] },
      }
      : row
  )),
}, repairPlan);
ok(resumableExecutionPlan.results.find(row => row.id === firstRepairedRow.id).repair_state
  === 'already_applied',
'executor accepts an exact already-applied row so a partial cohort can resume');
throws(() => buildF200RepairExecutionPlan({
  ...executionData,
  allDeliverables: executionData.allDeliverables.map((row, index) => (
    index === 0 ? { ...row, client_slug: 'sidneylaruel' } : row
  )),
}, repairPlan), /precondition drifted/, 'reconciler rejects the full repair if one row precondition drifts');
throws(() => buildF200RepairExecutionPlan({
  ...executionData,
  prodAuthority: {},
}, repairPlan), /validated live prod_authority/,
'exact repair fails closed when the live authority flag is missing or invalid');

const b1Source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js'), 'utf8');
ok(!/issueClientCandidate|supabaseInsert\('clients'/.test(b1Source)
  && /clients:\s*\[\]/.test(b1Source)
  && /persistedExplicitClassifications\([\s\S]{0,300}existingDeliverables/.test(b1Source)
  && /linear_raw[\s\S]{0,300}withAttribution|withAttribution\([\s\S]{0,300}linear_raw/.test(b1Source),
'B1 no longer derives/inserts clients and reuses only proven persisted attribution state');

const reconcileSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'),
  'utf8',
);
ok(/resolveAttributionGraph\(\[\.\.\.data\.linearIssues\.values\(\)\], data\.clients/.test(reconcileSource)
  && /persistedExplicitClassifications\([\s\S]{0,300}data\.allDeliverables/.test(reconcileSource)
  && /attribution:\s*attributionGraph/.test(reconcileSource)
  && /F200 repair apply requires exactly/.test(reconcileSource)
  && /executeF200CasPatch\(liveRow\.current, repairState\)/.test(reconcileSource)
  && /client_slug=eq\.unattributed/.test(reconcileSource),
'scheduled reconciler preserves proven attribution and uses the exact-count atomic CAS repair lane');

const liveSnapshotSource = fs.readFileSync(
  path.join(__dirname, '..', 'scripts', 'f200-attribution-live-snapshot.js'),
  'utf8',
);
ok(/family_complete:\s*false/.test(liveSnapshotSource)
  && !/family_complete:\s*true/.test(liveSnapshotSource),
'the private F200 sentinel snapshot fails closed rather than claiming a complete family graph');
throws(
  () => assertPrivateOutputPath(path.join(__dirname, '..', 'f200-live-snapshot.json')),
  /outside every Git worktree/,
  'the private F200 snapshot refuses a worktree output path',
);
const privateSnapshotTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f200-private-snapshot-'));
try {
  if (process.platform === 'win32') {
    throws(
      () => assertPrivateOutputPath(path.join(privateSnapshotTestRoot, 'fresh-snapshot.json')),
      /ACL verification is unavailable/,
      'the private F200 snapshot fails closed where Windows ACL privacy cannot be verified',
    );
  } else {
    fs.chmodSync(privateSnapshotTestRoot, 0o700);
    const freshPrivateSnapshot = path.join(privateSnapshotTestRoot, 'fresh-snapshot.json');
    ok(assertPrivateOutputPath(freshPrivateSnapshot) === freshPrivateSnapshot,
      'the private F200 snapshot accepts a new absolute path outside Git worktrees');
    const existingPrivateSnapshot = path.join(privateSnapshotTestRoot, 'snapshot.json');
    fs.writeFileSync(existingPrivateSnapshot, '{}', 'utf8');
    throws(
      () => assertPrivateOutputPath(existingPrivateSnapshot),
      /destination must not already exist/,
      'the private F200 snapshot refuses to overwrite an existing file',
    );
  }
} finally {
  fs.rmSync(privateSnapshotTestRoot, { recursive: true, force: true });
}
ok(/assertNoLinkedComponents\(output\)/.test(liveSnapshotSource)
  && /flag:\s*'wx'/.test(liveSnapshotSource)
  && /chmodSync\(output, 0o600\)/.test(liveSnapshotSource)
  && /assertPrivateParent\(parent\)/.test(liveSnapshotSource),
'the private F200 snapshot rejects linked destinations and creates a new private-mode file in a verified private parent');

const inboundSource = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'functions', 'linear-inbound', 'index.ts'),
  'utf8',
);
ok(/function payloadAttributionChangeFields[\s\S]{0,420}\["project", "projectId", "parent", "parentId"\]/.test(inboundSource)
  && /mark\("attribution", \["project", "projectId", "parent", "parentId"\]\)/.test(inboundSource),
'inbound detects both object and scalar project/parent ownership changes');
ok(/function invalidateClientAttribution[\s\S]{0,700}state: "needs_attribution"[\s\S]{0,300}source: "linear_inbound_structure_change"/.test(inboundSource)
  && /row\.client_slug = "unattributed"[\s\S]{0,180}invalidateClientAttribution\(row\.linear_raw, existing, attributionChangeFields\)/.test(inboundSource)
  && /attribution_invalidated = \{[\s\S]{0,160}state: "needs_attribution"/.test(inboundSource),
'inbound replaces a stale normal-client slug with the FK sentinel and a visible needs_attribution repair state');
ok(/if \(await isDetectOnlyTeam[\s\S]{0,180}if \(attributionChangeFields\.length\)[\s\S]{0,1400}mergeAttributionStructureRaw\(existing, issue, payload\)[\s\S]{0,1200}eventFor\([\s\S]{0,180}"attribution_change"/.test(inboundSource)
  && /if \(projectChanged\)[\s\S]{0,700}if \(parentChanged\)/.test(inboundSource)
  && /const nextIssue: JsonMap = \{ \.\.\.previousIssue \}/.test(inboundSource)
  && !/function mergeAttributionStructureRaw[\s\S]{0,1500}nextIssue\.title/.test(inboundSource),
'detect-only authority writes only project/parent attribution invalidation and refuses foreign business fields');
ok(/!has\(issue, "project"\)[\s\S]{0,180}!projectChanged[\s\S]{0,140}previousIssue\.project/.test(inboundSource)
  && /!has\(issue, "parent"\)[\s\S]{0,180}!parentChanged[\s\S]{0,140}previousIssue\.parent/.test(inboundSource),
'unrelated inbound webhooks preserve project/parent snapshots while structural changes invalidate them');

console.log('F200 roster-owned attribution checks passed');
