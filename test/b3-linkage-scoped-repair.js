'use strict';

/*
 * B3 exact-cohort card-linkage repair.
 *
 * This suite is deliberately offline and fictional. It pins the source-only
 * planner and release gates for the exceptional lane without invoking the RPC,
 * Supabase, archive promotion, or any apply path.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  OWNER_CONFIRM_ENV,
  OWNER_CONFIRM_TOKEN,
  parseArgs,
  canonicalizeLinearIssue,
  buildScopedPlan,
  validateApplyGates,
  buildPublicSummary,
  stableDigest,
  globalFailureDigest,
  rpcPlan,
  rollbackArtifact,
  rollbackDigest,
  snapshotContentDigest,
} = require('../scripts/b3-linkage-scoped-repair.js');
const { strictActiveCalendarSweep } = require('../scripts/b3-linkage-backfill.js');

let failures = 0;
const GLOBAL_FAILURE_COUNT = 266;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalUrl(value) {
  const result = canonicalizeLinearIssue(value);
  if (typeof result === 'string') return result;
  return result && (result.canonical_url || result.url) || '';
}

function canonicalIdentifier(value) {
  const result = canonicalizeLinearIssue(value);
  if (result && typeof result === 'object') {
    return result.identifier || result.linear_identifier || '';
  }
  const match = String(result || value).match(/\b([A-Z]{2,8}-\d+)\b/i);
  return match ? match[1].toUpperCase() : '';
}

function snapshotGlobalFailureDigest(snapshot) {
  const failures = strictActiveCalendarSweep(snapshot).failures;
  return globalFailureDigest(failures);
}

function refreshManifestBindings(fixture, options) {
  const opts = options || {};
  fixture.manifest.snapshot_digest = snapshotContentDigest(fixture.snapshot);
  if (opts.global !== false) {
    const sweep = strictActiveCalendarSweep(fixture.snapshot);
    fixture.manifest.global_failure_count = sweep.failures.length;
    fixture.manifest.global_failure_digest = globalFailureDigest(sweep.failures);
  }
  return fixture;
}

function buildFixture(count) {
  const expectedCount = count == null ? 15 : count;
  const runnerSha256 = 'a'.repeat(64);
  const releaseSha = 'b'.repeat(40);
  const clients = [];
  const calendarPosts = [];
  const deliverables = [];
  const entries = [];

  for (let index = 0; index < expectedCount; index++) {
    const ordinal = String(index + 1).padStart(2, '0');
    const clientSlug = `fictional-client-${String((index % 3) + 1).padStart(2, '0')}`;
    const cardId = `fictional-card-${ordinal}`;
    const deliverableId = `fictional-deliverable-${ordinal}`;
    const identifier = `GFX-${1000 + index}`;
    const linkUrl = `https://linear.app/fictional-workspace/issue/${identifier}/fictional-graphic-${ordinal}`;
    const updatedAt = `2026-08-01T00:${ordinal}:00.000Z`;
    const deliverableUpdatedAt = `2026-08-01T01:${ordinal}:00.000Z`;

    if (!clients.some(row => row.slug === clientSlug)) {
      clients.push({ slug: clientSlug, active: true, kind: 'client' });
    }

    const card = {
      id: cardId,
      client: clientSlug,
      status: 'active',
      graphic_status: 'in_progress',
      posted_at: null,
      graphic_tweaks: '',
      graphic_linear_issue_id: linkUrl,
      graphic_deliverable_id: null,
      updated_at: updatedAt,
      graphic_comments: [],
      graphic_comment_count: 0,
    };
    const deliverable = {
      id: deliverableId,
      client_slug: clientSlug,
      team: 'graphics',
      kind: 'thumbnail',
      origin: 'calendar',
      card_id: cardId,
      status: 'in_progress',
      archived_at: null,
      deleted_at: null,
      updated_at: deliverableUpdatedAt,
      linear_issue_uuid: null,
      linear_identifier: identifier,
      linear_issue_url: linkUrl,
    };
    calendarPosts.push(card);
    deliverables.push(deliverable);
    entries.push({
      surface: 'calendar',
      component: 'graphic',
      table: 'calendar_posts',
      link_column: 'graphic_linear_issue_id',
      deliverable_column: 'graphic_deliverable_id',
      operation: 'link_existing_deliverable',
      client_slug: clientSlug,
      card_id: cardId,
      link_url: linkUrl,
      link_identifier: identifier,
      target_deliverable_id: deliverableId,
      card_before: {
        status: 'active',
        graphic_status: 'in_progress',
        updated_at: updatedAt,
        posted_at: null,
        graphic_tweaks: '',
        graphic_linear_issue_id: linkUrl,
        graphic_linear_issue_canonical: canonicalUrl(linkUrl),
        graphic_deliverable_id: { state: 'null', value: null },
        graphic_comments_sha256: stableDigest([]),
        graphic_comments_count: 0,
        native_comment_count: 0,
        native_comment_digest: stableDigest([]),
      },
      deliverable_before: {
        ...clone(deliverable),
        linear_issue_canonical: canonicalUrl(linkUrl),
      },
    });
  }

  const residueClient = 'fictional-residue-client';
  clients.push({ slug: residueClient, active: true, kind: 'client' });
  for (let residueIndex = 1; residueIndex <= GLOBAL_FAILURE_COUNT; residueIndex++) {
    const residueOrdinal = String(residueIndex).padStart(3, '0');
    const residueIdentifier = `GFX-${9000 + residueIndex}`;
    calendarPosts.push({
      id: `fictional-global-residue-card-${residueOrdinal}`,
      client: residueClient,
      status: 'active',
      graphic_status: 'in_progress',
      posted_at: null,
      graphic_tweaks: '',
      graphic_linear_issue_id:
        `https://linear.app/fictional-workspace/issue/${residueIdentifier}/intentional-unresolved-residue-${residueOrdinal}`,
      graphic_deliverable_id: null,
      updated_at: '2026-08-01T04:00:00.000Z',
      graphic_comments: [],
      graphic_comment_count: 0,
    });
  }

  const snapshot = {
    contract: 'syncview-b3-scoped-linkage-snapshot-v1',
    generated_at: '2026-08-04T12:00:00.000Z',
    project_ref: 'fictional-project-ref',
    release_sha: releaseSha,
    runner_sha256: runnerSha256,
    clients,
    prodAuthority: { video: 'linear', graphics: 'linear' },
    calendarPosts,
    deliverables,
    productionComments: [],
  };
  const sweep = strictActiveCalendarSweep(snapshot);
  const manifest = {
    contract: 'syncview-b3-scoped-linkage-manifest-v1',
    generated_at: '2026-08-04T12:00:00.000Z',
    project_ref: snapshot.project_ref,
    release_sha: releaseSha,
    runner_sha256: runnerSha256,
    scope_policy: 'exact_calendar_graphic_url_to_native_v1',
    expected_count: expectedCount,
    snapshot_digest: snapshotContentDigest(snapshot),
    global_failure_count: sweep.failures.length,
    global_failure_digest: globalFailureDigest(sweep.failures),
    entries: entries.sort((left, right) => (
      `${left.client_slug}\u0000${left.card_id}`.localeCompare(`${right.client_slug}\u0000${right.card_id}`)
    )),
  };
  return { snapshot, manifest, expectedCount, runnerSha256 };
}

function planFixture(fixture, expectedCount) {
  return buildScopedPlan(fixture.snapshot, fixture.manifest, {
    expectedCount: expectedCount == null ? fixture.expectedCount : expectedCount,
    runnerSha256: fixture.runnerSha256,
  });
}

function reasonText(result) {
  return JSON.stringify(result && (result.reasons || result.blockers || result.errors || result));
}

function blockedWith(fixture, reason, expectedCount) {
  let result;
  let error;
  try {
    result = planFixture(fixture, expectedCount);
  } catch (caught) {
    error = caught;
  }
  const text = error ? String(error.message || error) : reasonText(result);
  ok(Boolean(error) || result.status === 'BLOCKED', `fixture is BLOCKED for ${reason}`);
  ok(text.includes(reason), `BLOCKED result names ${reason}`);
  return result;
}

function mutateTarget(fixture, index, changes) {
  const entry = fixture.manifest.entries[index];
  const deliverable = fixture.snapshot.deliverables.find(row => row.id === entry.target_deliverable_id);
  Object.assign(deliverable, changes);
  entry.deliverable_before = {
    ...clone(deliverable),
    linear_issue_canonical: canonicalUrl(deliverable.linear_issue_url),
  };
  refreshManifestBindings(fixture);
  return fixture;
}

function completeApplyArgs(plan, expectedCount, runnerSha256) {
  return parseArgs([
    '--scope-manifest=C:\\private\\fictional-scope.json',
    '--apply',
    `--expected-writes=${expectedCount}`,
    `--expected-scope-digest=${plan.scope_digest}`,
    `--expected-plan-digest=${plan.plan_digest}`,
    `--expected-global-failures=${plan.global_failure_count}`,
    `--expected-global-digest=${plan.global_failure_digest}`,
    `--expected-runner-sha256=${runnerSha256}`,
    '--rollback-artifact=C:\\private\\fictional-rollback.json',
  ]);
}

function gateReasons(result) {
  return result && (result.reasons || result.blockers || result.errors) || [];
}

function gateBlockedWith(args, env, plan, deps, reason) {
  let result;
  let error;
  try {
    result = validateApplyGates(args, env, plan, deps);
  } catch (caught) {
    error = caught;
  }
  const text = error ? String(error.message || error) : JSON.stringify(gateReasons(result));
  ok(Boolean(error) || result.eligible === false, `apply gate refuses ${reason}`);
  ok(text.includes(reason), `apply refusal names ${reason}`);
}

console.log('B3 exact-cohort scoped repair\n');

// ------------------------------------------------------------ canonical identity/digest
ok(canonicalUrl('HTTPS://LINEAR.APP/fictional-workspace/issue/gfx-1001/name/?utm=x#fragment')
    === 'https://linear.app/fictional-workspace/issue/gfx-1001/name',
  'Linear URL canonicalization removes query/hash/trailing slash and normalizes host/protocol');
ok(canonicalIdentifier('https://linear.app/fictional-workspace/issue/gfx-1001/name') === 'GFX-1001',
  'Linear identity canonicalization extracts an uppercase issue identifier');
ok(stableDigest({ beta: 2, alpha: 1 }) === stableDigest({ alpha: 1, beta: 2 }),
  'stable digest ignores object key insertion order');
ok(stableDigest({ pointer: null }) !== stableDigest({ pointer: '' }),
  'stable digest preserves the contractually distinct NULL and empty-string states');

// ------------------------------------------------------------ exact success and global blocked visibility
const goodFixture = buildFixture(15);
const goodPlan = planFixture(goodFixture);
ok(goodPlan.status === 'READY' && goodPlan.writes.length === 15,
  'the exact fictional 15-row cohort plans exactly 15 pointer writes');
const exactRpcPlan = rpcPlan(goodPlan);
ok(JSON.stringify(exactRpcPlan.prod_authority) === JSON.stringify(goodPlan.prod_authority)
    && /^[0-9a-f]{64}$/.test(exactRpcPlan.prod_authority_digest)
    && exactRpcPlan.prod_authority_digest === stableDigest(exactRpcPlan.prod_authority),
  'the RPC payload carries the full authority object and its matching digest');
const exactRollback = rollbackArtifact(goodPlan);
ok(exactRollback.rollback_digest === rollbackDigest(goodPlan)
    && JSON.stringify(exactRollback.rollback_rpc.p_plan) === JSON.stringify(exactRpcPlan)
    && exactRollback.entries.length === goodPlan.expected_count
    && exactRollback.entries.every(entry => ['null', 'empty'].includes(entry.card.before.state)),
  'the private rollback artifact embeds the exact forward plan and NULL-versus-empty inverse');
ok(goodPlan.writes.every(write => (
  (write.table === 'calendar_posts' || write.surface === 'calendar')
  && (write.column === 'graphic_deliverable_id'
    || write.deliverable_column === 'graphic_deliverable_id'
    || Object.keys(write.patch || {}).join(',') === 'graphic_deliverable_id')
)), 'every scoped write targets only calendar_posts.graphic_deliverable_id');
ok(goodPlan.global_failure_count === GLOBAL_FAILURE_COUNT
    && goodPlan.global_before.failures.length === GLOBAL_FAILURE_COUNT
    && goodPlan.global_projected.failures.length === GLOBAL_FAILURE_COUNT
    && goodPlan.global_failure_digest === snapshotGlobalFailureDigest(goodFixture.snapshot),
  'the 266-failure global gate remains blocked and digest-bound');
ok(goodPlan.global_before.resolved_by_exact_url - goodPlan.global_projected.resolved_by_exact_url === 15
    && goodPlan.global_projected.resolved_by_id - goodPlan.global_before.resolved_by_id === 15,
  'the only projected movement is the exact 15 URL-to-native resolution shift');
ok(stableDigest(goodPlan.global_before.failures) === stableDigest(goodPlan.global_projected.failures),
  'the projected repair leaves the full global failure multiset unchanged');

// ------------------------------------------------------------ exact membership and descriptor shape
for (const wrongExpected of [14, 16]) {
  const fixture = buildFixture(15);
  fixture.manifest.expected_count = wrongExpected;
  blockedWith(fixture, 'expected_count_mismatch', wrongExpected);
}

{
  const fixture = buildFixture(101);
  blockedWith(fixture, 'expected_count_mismatch', 101);
}

{
  const fixture = buildFixture(15);
  fixture.snapshot.calendarPosts = fixture.snapshot.calendarPosts.filter(
    row => !row.id.startsWith('fictional-global-residue-card-'),
  );
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'global_gate_must_remain_blocked');
}

{
  const fixture = buildFixture(15);
  fixture.manifest.entries.pop();
  blockedWith(fixture, 'scope_membership_mismatch');
}

{
  const fixture = buildFixture(15);
  fixture.manifest.entries.push({
    ...clone(fixture.manifest.entries[0]),
    card_id: 'fictional-card-extra',
  });
  blockedWith(fixture, 'scope_membership_mismatch');
}

{
  const fixture = buildFixture(15);
  fixture.manifest.entries.push(clone(fixture.manifest.entries[0]));
  blockedWith(fixture, 'duplicate_scope_entry');
}

for (const [field, value, reason] of [
  ['surface', 'samples', 'scope_surface_must_be_calendar'],
  ['component', 'video', 'scope_component_must_be_graphic'],
]) {
  const fixture = buildFixture(15);
  fixture.manifest.entries[0][field] = value;
  blockedWith(fixture, reason);
}

for (const [field, value, reason] of [
  ['table', null, 'manifest_entry_incomplete'],
  ['link_column', '', 'manifest_entry_incomplete'],
  ['deliverable_column', null, 'manifest_entry_incomplete'],
  ['operation', null, 'archive_or_create_semantics_forbidden'],
  ['link_identifier', null, 'manifest_entry_incomplete'],
]) {
  const fixture = buildFixture(15);
  fixture.manifest.entries[0][field] = value;
  blockedWith(fixture, reason);
}

{
  const fixture = buildFixture(15);
  fixture.manifest.entries[0].card_before.graphic_linear_issue_canonical = null;
  blockedWith(fixture, 'manifest_entry_incomplete');
}

{
  const fixture = buildFixture(15);
  fixture.manifest.entries[0].card_before.graphic_deliverable_id = null;
  blockedWith(fixture, 'manifest_entry_incomplete');
}

// ------------------------------------------------------------ before-state and candidate drift
{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  const card = fixture.snapshot.calendarPosts.find(row => row.id === entry.card_id);
  const deliverable = fixture.snapshot.deliverables.find(row => row.id === entry.target_deliverable_id);
  const nextUrl = 'https://linear.app/fictional-workspace/issue/GFX-8001/changed-after-review';
  card.graphic_linear_issue_id = nextUrl;
  deliverable.linear_issue_url = nextUrl;
  deliverable.linear_identifier = 'GFX-8001';
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'card_linear_url_drift');
}

{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.find(row => row.id === entry.card_id).graphic_deliverable_id =
    'fictional-concurrent-pointer';
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'card_pointer_before_drift');
}

{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.find(row => row.id === entry.card_id).updated_at =
    '2026-08-04T13:00:00.000Z';
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'card_updated_at_drift');
}

{
  const fixture = buildFixture(15);
  const first = fixture.snapshot.deliverables[0];
  fixture.snapshot.deliverables.push({
    ...clone(first),
    id: 'fictional-ambiguous-deliverable',
    card_id: 'fictional-other-card',
  });
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'ambiguous_exact_url_candidate');
}

{
  const fixture = mutateTarget(buildFixture(15), 0, { status: 'archived' });
  blockedWith(fixture, 'target_deliverable_archived');
}

// ------------------------------------------------------------ full crosswalk and exclusivity
for (const [changes, reason] of [
  [{ origin: 'manual' }, 'deliverable_origin_mismatch'],
  [{ team: 'video' }, 'deliverable_team_mismatch'],
  [{ client_slug: 'fictional-wrong-client' }, 'deliverable_client_mismatch'],
  [{ card_id: 'fictional-wrong-card' }, 'deliverable_card_mismatch'],
]) {
  blockedWith(mutateTarget(buildFixture(15), 0, changes), reason);
}

{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.push({
    id: 'fictional-duplicate-link-card',
    client: entry.client_slug,
    status: 'active',
    graphic_status: 'in_progress',
    graphic_linear_issue_id: entry.link_url,
    graphic_deliverable_id: null,
    updated_at: '2026-08-03T00:00:00.000Z',
    posted_at: null,
    graphic_tweaks: '',
    graphic_comments: [],
    graphic_comment_count: 0,
  });
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'duplicate_live_link');
}

{
  const fixture = buildFixture(15);
  const first = fixture.snapshot.deliverables[0];
  fixture.snapshot.deliverables.push({
    ...clone(first),
    id: 'fictional-competing-slot-deliverable',
    linear_identifier: 'GFX-7001',
    linear_issue_url:
      'https://linear.app/fictional-workspace/issue/GFX-7001/competing-slot-occupant',
  });
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'card_slot_occupied');
}

{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.push({
    id: 'fictional-fanout-card',
    client: entry.client_slug,
    status: 'active',
    graphic_status: 'in_progress',
    graphic_linear_issue_id: '',
    graphic_deliverable_id: entry.target_deliverable_id,
    updated_at: '2026-08-03T00:00:00.000Z',
    posted_at: null,
    graphic_tweaks: '',
    graphic_comments: [],
    graphic_comment_count: 0,
  });
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'deliverable_has_other_consumer');
}

{
  const fixture = buildFixture(15);
  fixture.snapshot.prodAuthority.graphics = 'syncview';
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'graphics_authority_not_linear');
}

// ------------------------------------------------------------ NULL/empty and digest binding
{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.find(row => row.id === entry.card_id).graphic_deliverable_id = '';
  refreshManifestBindings(fixture);
  blockedWith(fixture, 'card_pointer_before_drift');

  entry.card_before.graphic_deliverable_id = { state: 'empty', value: '' };
  const exactEmptyPlan = planFixture(fixture);
  ok(exactEmptyPlan.status === 'READY' && exactEmptyPlan.writes.length === 15,
    'an exact empty-string before-state is accepted only when the manifest also records empty string');
}

{
  const fixture = buildFixture(15);
  const entry = fixture.manifest.entries[0];
  fixture.snapshot.calendarPosts.find(row => row.id === entry.card_id).updated_at =
    '2026-08-04T14:00:00.000Z';
  // Deliberately do not refresh snapshot_digest: any relevant input drift must move it.
  blockedWith(fixture, 'snapshot_digest_drift');
}

{
  const fixture = buildFixture(15);
  const residue = fixture.snapshot.calendarPosts.find(
    row => row.id === 'fictional-global-residue-card-001',
  );
  residue.graphic_deliverable_id = 'fictional-dangling-deliverable';
  // Refresh the whole-input digest, but retain the reviewed failure multiset digest.
  refreshManifestBindings(fixture, { global: false });
  blockedWith(fixture, 'global_failure_digest_drift');
}

// ------------------------------------------------------------ literal apply contract
ok(typeof OWNER_CONFIRM_ENV === 'string' && OWNER_CONFIRM_ENV.length > 0
    && typeof OWNER_CONFIRM_TOKEN === 'string' && OWNER_CONFIRM_TOKEN.length > 0,
  'the owner-confirmation environment name and exact token are explicit exports');

const parsedDryRunWithAmbientApply = parseArgs([], { APPLY: 'true' });
ok(parsedDryRunWithAmbientApply.apply === false,
  'ambient APPLY=true never enables apply; only the literal --apply argument can do that');
ok(parseArgs(['--apply']).apply === true, 'the literal --apply argument is parsed explicitly');

const gateDeps = {
  existsSync: () => false,
  assertPrivatePath: value => value,
};
const completeArgs = completeApplyArgs(goodPlan, 15, goodFixture.runnerSha256);
const ownerEnv = { [OWNER_CONFIRM_ENV]: OWNER_CONFIRM_TOKEN };
const completeGate = validateApplyGates(completeArgs, ownerEnv, goodPlan, gateDeps);
ok(completeGate.eligible === true && gateReasons(completeGate).length === 0,
  'every literal count/digest/runner/token/rollback gate admits the reviewed exact plan');

for (const [flag, reason] of [
  ['scope-manifest', 'scope_manifest_required_for_apply'],
  ['expected-writes', 'expected_writes_required_for_apply'],
  ['expected-scope-digest', 'expected_scope_digest_required_for_apply'],
  ['expected-plan-digest', 'expected_plan_digest_required_for_apply'],
  ['expected-global-failures', 'expected_global_failures_required_for_apply'],
  ['expected-global-digest', 'expected_global_digest_required_for_apply'],
  ['expected-runner-sha256', 'expected_runner_sha256_required_for_apply'],
  ['rollback-artifact', 'rollback_artifact_required_for_apply'],
]) {
  const argv = [
    '--scope-manifest=C:\\private\\fictional-scope.json',
    '--apply',
    '--expected-writes=15',
    `--expected-scope-digest=${goodPlan.scope_digest}`,
    `--expected-plan-digest=${goodPlan.plan_digest}`,
    `--expected-global-failures=${goodPlan.global_failure_count}`,
    `--expected-global-digest=${goodPlan.global_failure_digest}`,
    `--expected-runner-sha256=${goodFixture.runnerSha256}`,
    '--rollback-artifact=C:\\private\\fictional-rollback.json',
  ].filter(value => !value.startsWith(`--${flag}=`));
  gateBlockedWith(parseArgs(argv), ownerEnv, goodPlan, gateDeps, reason);
}

gateBlockedWith(completeArgs, {}, goodPlan, gateDeps, 'owner_confirmation_required');
gateBlockedWith(completeArgs, { ...ownerEnv, APPLY: 'true' }, goodPlan, gateDeps,
  'ambient_apply_forbidden');
gateBlockedWith(completeArgs, { ...ownerEnv, PROMOTE_ARCHIVE: 'true' }, goodPlan, gateDeps,
  'archive_or_create_semantics_forbidden');

for (const descriptor of [
  '--promote-archive',
  '--archive-descriptor=C:\\private\\archive.json',
  '--create-deliverable',
  '--create-descriptor=C:\\private\\create.json',
]) {
  const args = parseArgs([
    '--scope-manifest=C:\\private\\fictional-scope.json',
    '--apply',
    '--expected-writes=15',
    `--expected-scope-digest=${goodPlan.scope_digest}`,
    `--expected-plan-digest=${goodPlan.plan_digest}`,
    `--expected-global-failures=${goodPlan.global_failure_count}`,
    `--expected-global-digest=${goodPlan.global_failure_digest}`,
    `--expected-runner-sha256=${goodFixture.runnerSha256}`,
    '--rollback-artifact=C:\\private\\fictional-rollback.json',
    descriptor,
  ]);
  gateBlockedWith(args, ownerEnv, goodPlan, gateDeps, 'archive_or_create_semantics_forbidden');
}

// ------------------------------------------------------------ public output privacy
const planWithPrivateFailure = {
  ...goodPlan,
  private_errors: [{
    client_slug: goodFixture.manifest.entries[0].client_slug,
    card_id: goodFixture.manifest.entries[0].card_id,
    deliverable_id: goodFixture.manifest.entries[0].target_deliverable_id,
    url: goodFixture.manifest.entries[0].link_url,
    body: 'fictional-private-provider-error-body',
  }],
};
const publicSummary = buildPublicSummary(planWithPrivateFailure, { mode: 'dry-run' });
const publicText = JSON.stringify(publicSummary);
for (const entry of goodFixture.manifest.entries) {
  ok(!publicText.includes(entry.client_slug)
      && !publicText.includes(entry.card_id)
      && !publicText.includes(entry.target_deliverable_id)
      && !publicText.includes(entry.link_url)
      && !publicText.includes(entry.link_identifier),
    'public summary excludes every scoped client/card/deliverable/URL/Linear identity');
}
ok(!publicText.includes('fictional-private-provider-error-body'),
  'public summary excludes raw provider/RPC error bodies');
ok(publicSummary.global_gate === 'BLOCKED'
    && publicSummary.exact_scope_gate === 'READY'
    && publicSummary.global_failure_count === GLOBAL_FAILURE_COUNT,
  'public summary keeps the blocked global gate visible alongside the ready exact scope');

// ------------------------------------------------------------ transactional RPC source contract
const migration = fs.readFileSync(path.join(
  __dirname, '..', 'migrations', '2026-08-04-b3-scoped-card-linkage.sql',
), 'utf8');
const eventKeyMigration = fs.readFileSync(path.join(
  __dirname, '..', 'migrations', '2026-07-12-production-comments.sql',
), 'utf8');
const postgresProof = fs.readFileSync(path.join(
  __dirname, 'b3-linkage-scoped-postgres.js',
), 'utf8');
const unitWorkflow = fs.readFileSync(path.join(
  __dirname, '..', '.github', 'workflows', 'calendar-unit-tests.yml',
), 'utf8');

function sqlFunctionBody(name) {
  const signature = `create or replace function public.${name}(`;
  const signatureAt = migration.indexOf(signature);
  const bodyStartMarker = 'as $fn$';
  const bodyStart = migration.indexOf(bodyStartMarker, signatureAt);
  const bodyEnd = migration.indexOf('$fn$;', bodyStart + bodyStartMarker.length);
  return signatureAt >= 0 && bodyStart >= 0 && bodyEnd > bodyStart
    ? migration.slice(bodyStart + bodyStartMarker.length, bodyEnd)
    : '';
}

const assertPlanSql = sqlFunctionBody('b3_scoped_card_linkage_assert_plan');
const applySql = sqlFunctionBody('b3_scoped_card_linkage_apply');
const rollbackSql = sqlFunctionBody('b3_scoped_card_linkage_rollback');
const updateTargets = [...migration.matchAll(/\bupdate\s+public\.([a-z_]+)/gi)]
  .map(match => match[1].toLowerCase());

ok(/^begin;/m.test(migration) && /^commit;/m.test(migration)
    && /language plpgsql\s+security definer/.test(migration),
  'the additive migration and SECURITY DEFINER RPCs install in one explicit transaction');
ok(/pg_index[\s\S]*deliverable_events_event_key_unique_idx[\s\S]*indisunique[\s\S]*indisvalid[\s\S]*indisready[\s\S]*event_keyISNOTNULL/.test(migration),
  'installation fails closed unless the exact valid unique event-key prerequisite exists');
ok(/prod_authority[\s\S]*for share;/.test(assertPlanSql)
    && /graphics[\s\S]*linear/.test(assertPlanSql),
  'the validator share-locks live authority and requires Graphics to remain Linear-authoritative');
ok(/lock table public\.calendar_posts in share row exclusive mode;/.test(assertPlanSql)
    && /lock table public\.sample_reviews in share row exclusive mode;/.test(assertPlanSql)
    && /lock table public\.deliverables in share row exclusive mode;/.test(assertPlanSql)
    && /lock table public\.production_comments in share row exclusive mode;/.test(assertPlanSql)
    && /lock table public\.calendar_post_events in share row exclusive mode;/.test(assertPlanSql)
    && /lock table public\.deliverable_events in share row exclusive mode;/.test(assertPlanSql)
    && /order by c\.client, c\.id\s+for update of c;/.test(assertPlanSql)
    && /order by d\.id\s+for update of d;/.test(assertPlanSql),
  'the RPC freezes competing writers and locks every target card/deliverable deterministically');
const scopedLockOrder = [
  'deliverables',
  'production_comments',
  'deliverable_events',
  'calendar_posts',
  'sample_reviews',
  'calendar_post_events',
].map(table => assertPlanSql.indexOf(`lock table public.${table} in share row exclusive mode;`));
const authorityLockAt = assertPlanSql.indexOf("where f.key = 'prod_authority'");
ok(scopedLockOrder.every(index => index >= 0)
    && scopedLockOrder.every((index, offset) => offset === 0 || index > scopedLockOrder[offset - 1])
    && authorityLockAt > scopedLockOrder[scopedLockOrder.length - 1],
  'coarse locks follow writer dependency order before the compatible authority share lock');
ok((postgresProof.match(/await runLockOrderScenario\(/g) || []).length === 3
    && /function psqlCommandArguments[^]*'--command'/.test(postgresProof)
    && /const writer = startPsqlCommandSession\([^]*writerSql/.test(postgresProof)
    && /const validator = startPsqlCommandSession\([^]*validatorSql/.test(postgresProof)
    && /select pg_advisory_lock\(/.test(postgresProof)
    && /select pg_advisory_xact_lock\(/.test(postgresProof)
    && /select pg_advisory_unlock\(/.test(postgresProof)
    && /relationLockSql\(validatorName, config\.firstRelation, 'ShareRowExclusiveLock', false\)/.test(postgresProof)
    && /relationLockSql\(writerName, 'deliverables', 'RowExclusiveLock', false\)/.test(postgresProof)
    && /name: 'deliverable_first'[^]*firstRelation: 'deliverables'[^]*rowFirst: true/.test(postgresProof)
    && /name: 'comment_first'[^]*firstRelation: 'production_comments'[^]*rowFirst: true/.test(postgresProof)
    && /name: 'authority_first'[^]*firstRelation: 'syncview_runtime_flags'[^]*rowFirst: false/.test(postgresProof)
    && !/pg_sleep/i.test(postgresProof)
    && !/runPsql\(targetDatabase, validatorSql/.test(postgresProof)
    && /B3_SCOPED_REQUIRE_POSTGRES:\s*'1'/.test(unitWorkflow)
    && /B3_SCOPED_POSTGRES_EPHEMERAL_CLUSTER:\s*'1'/.test(unitWorkflow),
  'ephemeral CI deterministically exercises both row-first orders and authority-first concurrency');
ok(/runContentionClassificationProbe/.test(postgresProof)
    && /set lock_timeout='100ms'/.test(postgresProof)
    && /set lock_timeout='5s'/.test(postgresProof)
    && /assertPublicDatabaseFailure\(refused, 'B3C01', 'REFUSED_CONTENTION'\)/.test(postgresProof)
    && /relationLockSql\(writerName, 'deliverables', 'RowExclusiveLock', true\)/.test(postgresProof),
  'the production apply probe deterministically classifies a real lock timeout');
ok(/posted_at/.test(assertPlanSql)
    && /nullif\(btrim\(coalesce\(v_card_row\.posted_at, ''\)\), ''\) is not null/.test(assertPlanSql)
    && /graphic_tweaks/.test(assertPlanSql)
    && /graphic_comments_count[^]*<> 0/.test(assertPlanSql)
    && /native_comment_count[^]*<> 0/.test(assertPlanSql)
    && /convert_to\('\[\]', 'UTF8'\)/.test(assertPlanSql),
  'the database gate independently requires exact unposted, zero-legacy-comment, zero-native-comment state');
ok(/revoke all on function public\.b3_scoped_calendar_event_digest\(jsonb\)/.test(migration)
    && /has_function_privilege\(\s*'anon',\s*'public\.b3_scoped_calendar_event_digest\(jsonb\)'/m.test(migration)
    && /has_function_privilege\(\s*'authenticated',\s*'public\.b3_scoped_calendar_event_digest\(jsonb\)'/m.test(migration)
    && /has_function_privilege\(\s*'service_role',\s*'public\.b3_scoped_calendar_event_digest\(jsonb\)'/m.test(migration)
    && /drop function if exists public\.b3_scoped_calendar_event_digest\(jsonb\)/.test(migration),
  'the event high-water helper is owner-internal and covered by install and schema-rollback ACL checks');
ok(/v_target_row\.client_slug[^]*v_card_row\.client/.test(assertPlanSql)
    && /v_target_row\.card_id[^]*v_card_row\.id/.test(assertPlanSql)
    && /lower\(btrim\(coalesce\(v_target_row\.team, ''\)\)\) <> 'graphics'/.test(assertPlanSql)
    && /lower\(btrim\(coalesce\(v_target_row\.kind, ''\)\)\) <> 'thumbnail'/.test(assertPlanSql)
    && /lower\(btrim\(coalesce\(v_target_row\.origin, ''\)\)\) <> 'calendar'/.test(assertPlanSql),
  'the database validator re-enforces the complete client/card/team/kind/origin crosswalk');
ok(updateTargets.length === 2 && updateTargets.every(table => table === 'calendar_posts')
    && !/update\s+public\.deliverables/i.test(migration)
    && !/set\s+(?:status|updated_at|graphic_status|graphic_linear_issue_id)\s*=/i.test(migration),
  'forward and rollback SQL update only calendar_posts.graphic_deliverable_id');

const firstAssertAt = applySql.indexOf('b3_scoped_card_linkage_assert_plan');
const updateAt = applySql.indexOf('update public.calendar_posts');
const rowCountAt = applySql.indexOf('get diagnostics v_updated = row_count', updateAt);
const secondAssertAt = applySql.indexOf('b3_scoped_card_linkage_assert_plan', firstAssertAt + 1);
const receiptAt = applySql.indexOf('insert into public.deliverable_events');
ok(firstAssertAt >= 0 && firstAssertAt < updateAt
    && updateAt < rowCountAt && rowCountAt < secondAssertAt && secondAssertAt < receiptAt
    && /if v_updated <> p_expected_count then\s+raise exception/.test(applySql)
    && /when others then\s+raise exception using errcode = 'B3P05', message = 'FAILED_INTERNAL'/.test(applySql),
  'all rows validate before mutation; count/postvalidation failures raise inside the same RPC transaction');
const publicDatabaseFailures = [
  ['B3P01', 'REFUSED_PLAN'],
  ['B3P02', 'REFUSED_LIVE_DRIFT'],
  ['B3P03', 'REFUSED_CROSSWALK'],
  ['B3C01', 'REFUSED_CONTENTION'],
  ['B3C02', 'EXECUTION_INTERRUPTED'],
  ['B3P04', 'REFUSED_REPLAY'],
  ['B3P05', 'FAILED_INTERNAL'],
  ['B3F01', 'PREFLIGHT_FAILED_INTERNAL'],
  ['B3R01', 'ROLLBACK_INPUT_REFUSED'],
  ['B3R02', 'ROLLBACK_RECEIPT_REFUSED'],
  ['B3R03', 'ROLLBACK_ACTIVITY_REFUSED'],
  ['B3R04', 'ROLLBACK_STATE_REFUSED'],
  ['B3R05', 'ROLLBACK_REPLAY_REFUSED'],
  ['B3R06', 'ROLLBACK_FAILED_INTERNAL'],
];
ok(publicDatabaseFailures.every(([code, failureClass]) =>
  migration.includes(`errcode = '${code}', message = '${failureClass}'`))
    && !/b3_scoped_(?:preflight|plan|apply|rollback)_refused/.test(migration)
    && !/sqlerrm|pg_exception_detail|pg_exception_hint/i.test(migration),
  'RPC refusals use fixed public-safe classes without raw database diagnostics');
ok(/when lock_not_available or deadlock_detected or serialization_failure[^]*B3C01[^]*when query_canceled[^]*B3C02/.test(applySql)
    && /when sqlstate 'B3P01' or sqlstate 'B3P02' or sqlstate 'B3P03'[^]*raise;/.test(applySql)
    && /v_constraint_name = 'deliverable_events_event_key_unique_idx'[^]*B3P04/.test(applySql),
  'the production apply path preserves contention, drift/crosswalk, and replay classes');
ok(/assertPublicDatabaseFailure\(driftRefusal, 'B3P02', 'REFUSED_LIVE_DRIFT'\)/.test(postgresProof)
    && /assertPublicDatabaseFailure\(crosswalkRefusal, 'B3P03', 'REFUSED_CROSSWALK'\)/.test(postgresProof)
    && /assertPublicDatabaseFailure\(replayRefusal, 'B3P04', 'REFUSED_REPLAY'\)/.test(postgresProof)
    && /assertPublicDatabaseFailure\([^]*rollbackStateRefusal[^]*'B3R04'[^]*'ROLLBACK_STATE_REFUSED'/.test(postgresProof),
  'the disposable database proof distinguishes live drift, crosswalk, replay, and rollback state');
ok(/assert\.deepStrictEqual\(preflight, rpcPlan\(plan\)\.global_before\)/.test(postgresProof)
    && /b3_scoped_card_linkage_preflight\(\)->>'failure_count'[^]*then 'BLOCKED' else 'READY'/.test(postgresProof)
    && /assert\.deepStrictEqual\(afterApply, rpcPlan\(plan\)\.global_projected\)/.test(postgresProof)
    && /assert\.deepStrictEqual\(afterRollback, rpcPlan\(plan\)\.global_before\)/.test(postgresProof)
    && /where action='b3_scoped_card_linkage_rollback'[^]*\), '1'/.test(postgresProof)
    && /global_gate=BLOCKED failure_count=266 failure_digest_unchanged=true[^]*rollback_exercised=true/.test(postgresProof),
  'the database proof keeps the 266 gate blocked and exercises the forward inverse');
ok(/identity_fields', false/.test(applySql)
    && /deliverable_id, batch_id, client_slug[^]*values \(\s*null, null, '_system'/.test(applySql)
    && !/return jsonb_build_object\([^]*client_slug/.test(applySql.slice(applySql.indexOf('return '))),
  'the aggregate receipt and RPC return carry counts/digests, never row identities');
ok(/'b3-scoped-card-linkage:' \|\| p_expected_plan_digest/.test(applySql)
    && /deliverable_events_event_key_unique_idx/.test(eventKeyMigration)
    && /where event_key is not null/.test(eventKeyMigration),
  'deterministic receipt identity plus the existing unique index makes replay fail before a second event can land');
ok(/c\.graphic_deliverable_id = requested\.deliverable_id/.test(rollbackSql)
    && /when 'null' then null\s+when 'empty' then ''/.test(rollbackSql)
    && /later\.id > v_receipt_id/.test(rollbackSql),
  'rollback is a separately gated exact inverse and refuses dependent post-repair activity');
ok(/revoke all on function public\.b3_scoped_card_linkage_apply\([^]*from public, anon, authenticated, service_role;/.test(migration)
    && /grant execute on function public\.b3_scoped_card_linkage_apply\([^]*to service_role;/.test(migration)
    && !/grant execute on function public\.b3_scoped_card_linkage_apply\([^]*to (?:public|anon|authenticated);/.test(migration),
  'only service_role receives EXECUTE on the forward RPC');
ok(/promote_archive[^]*archive_promotion[^]*create_deliverable/.test(assertPlanSql),
  'the database plan parser independently rejects archive promotion and native creation descriptors');

assert.strictEqual(failures, 0, `${failures} B3 exact-cohort scoped repair checks failed`);
console.log('\nB3 exact-cohort scoped repair checks passed');
