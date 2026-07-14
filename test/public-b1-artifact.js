'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { publicB1Artifact } = require('../scripts/public-b1-artifact');

const privateSentinels = [
  'Private Person',
  'private.person@example.invalid',
  '+1 202 555 0199',
  'private-client-slug',
  'A private issue title',
  'A private brief',
];

const plan = {
  generated_at: '2026-07-14T00:00:00.000Z',
  mode: 'incremental',
  as_of: '2026-07-14T00:00:00.000Z',
  changed_since: '2026-07-13T23:30:00.000Z',
  cutoff_months: 12,
  changed_issue_count: 3,
  operational_count: 2,
  soft_handled_count: 1,
  archive_count: 1,
  authority: {
    value: { video: 'linear', graphics: 'linear' },
    source: 'live',
    write_safe: true,
    warning: privateSentinels.join(' '),
  },
  gated: {
    batch_write_candidates: 1,
    deliverable_write_candidates: 2,
    by_team: { video: 1, graphics: 1 },
  },
  writes: {
    clients: [{ slug: privateSentinels[3], display_name: privateSentinels[0] }],
    deliverables: [{
      title: privateSentinels[4],
      brief: privateSentinels[5],
      linear_raw: { assignee: { name: privateSentinels[0], email: privateSentinels[1], phone: privateSentinels[2] } },
    }],
  },
  raw: { issues: privateSentinels },
};

const verification = {
  counts: { batches: 1, deliverables: 2 },
  expected: { batches: 1, deliverables: 2 },
  event_source_counts: { system: 3 },
  all_events_backfill: true,
  deliverables_with_backfill_event: 2,
  batches_with_backfill_event: 1,
  spot_parity_passed: 1,
  spot_parity: [{ title: privateSentinels[4], linear_assignee: privateSentinels[0] }],
  replay_verify: { deliverable_count_matches: true },
};

const artifact = publicB1Artifact(plan, { deliverable_rpc_writes: 2, leaked_error: privateSentinels[1] }, verification);
const serialized = JSON.stringify(artifact);

for (const sentinel of privateSentinels) {
  assert(!serialized.includes(sentinel), `public artifact leaked sentinel: ${sentinel}`);
}
assert.deepStrictEqual(artifact.planned_write_counts, {
  clients: 1,
  team_members: 0,
  team_member_link_updates: 0,
  batches: 0,
  deliverables: 1,
  linear_archive: 0,
});
assert.strictEqual(artifact.apply.deliverable_rpc_writes, 2);
assert(!Object.prototype.hasOwnProperty.call(artifact.apply, 'leaked_error'));
assert.strictEqual(artifact.verification.spot_parity_checked, 1);
assert(!Object.prototype.hasOwnProperty.call(artifact.verification, 'spot_parity'));

const poisonedTimes = publicB1Artifact({
  ...plan,
  generated_at: privateSentinels[1],
  as_of: privateSentinels[2],
  changed_since: privateSentinels[0],
}, null, null);
assert.strictEqual(poisonedTimes.generated_at, '');
assert.strictEqual(poisonedTimes.window.as_of, '');
assert.strictEqual(poisonedTimes.window.changed_since, '');

function exactKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  for (const key of Object.keys(value)) assert(allowed.includes(key), `${label} has unexpected key: ${key}`);
}

function validateArtifact(value) {
  exactKeys(value, ['schema_version', 'generated_at', 'mode', 'window', 'counts', 'authority', 'gated', 'planned_write_counts', 'existing_counts', 'batch_shapes', 'event_source_counts', 'apply', 'verification'], 'root');
  assert.strictEqual(value.schema_version, 1);
  assert(value.generated_at === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.generated_at));
  assert(['', 'incremental', 'apply', 'apply-reconciliation-only', 'plan'].includes(value.mode));
  exactKeys(value.window, ['as_of', 'changed_since', 'cutoff_months'], 'window');
  for (const field of ['as_of', 'changed_since']) assert(value.window[field] === '' || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.window[field]));
  exactKeys(value.counts, ['issue_count_total', 'changed_issue_count', 'operational_count', 'soft_handled_count', 'archive_count', 'linked_live_card_included'], 'counts');
  exactKeys(value.authority, ['video', 'graphics', 'source', 'write_safe'], 'authority');
  assert(['', 'linear', 'syncview'].includes(value.authority.video));
  assert(['', 'linear', 'syncview'].includes(value.authority.graphics));
  assert(['', 'live', 'last-known-good'].includes(value.authority.source));
  exactKeys(value.gated, ['batch_write_candidates', 'deliverable_write_candidates', 'by_team'], 'gated');
  exactKeys(value.gated.by_team, ['video', 'graphics'], 'gated.by_team');
  exactKeys(value.planned_write_counts, ['clients', 'team_members', 'team_member_link_updates', 'batches', 'deliverables', 'linear_archive'], 'planned_write_counts');
  exactKeys(value.existing_counts, ['batches', 'deliverables', 'linear_archive', 'deliverable_events'], 'existing_counts');
  exactKeys(value.batch_shapes, ['total_batches', 'mirrored_pair_batches', 'video_only_batches', 'graphics_only_batches', 'mixed_or_null_team_batches'], 'batch_shapes');
  exactKeys(value.event_source_counts, ['backfill', 'system', 'linear', 'reconcile', 'ui'], 'event_source_counts');
  exactKeys(value.apply, ['inserted_clients', 'inserted_team_members', 'patched_team_members', 'batch_rpc_writes', 'deliverable_rpc_writes', 'archive_upserts', 'summary_event_written'], 'apply');
  assert(value.verification === null, 'incremental public artifact must not contain detailed verification');
  const walk = current => {
    assert(!Array.isArray(current), 'public artifact must not contain row arrays');
    if (!current || typeof current !== 'object') return;
    for (const item of Object.values(current)) walk(item);
  };
  walk(value);
}

validateArtifact(publicB1Artifact(plan, { deliverable_rpc_writes: 2 }, null));

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'b1-linear-incremental-refresh.yml'), 'utf8');
assert(!/--out\s+artifacts\//.test(workflow), 'public workflow must not upload the detailed Markdown report');
assert(/> \.codex-tmp\/b1-private\.log 2>&1/.test(workflow), 'detailed stdout/stderr must stay runner-local');
assert(/--json-out artifacts\/b1-linear-incremental-refresh\.json/.test(workflow), 'public workflow must upload only the aggregate JSON serializer');
assert(/if:\s*success\(\)[\s\S]{0,180}path:\s*artifacts\/b1-linear-incremental-refresh\.json/.test(workflow), 'upload must be success-only and name the exact aggregate file');
assert(/Prove public artifact projection[\s\S]*node test\/public-b1-artifact\.js[\s\S]*Run incremental refresh/.test(workflow), 'privacy projection test must run before live apply');
assert(/node test\/public-b1-artifact\.js artifacts\/b1-linear-incremental-refresh\.json/.test(workflow), 'generated artifact must pass exact-schema validation before upload');

const gitignore = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
assert(/^\.codex-tmp\/$/m.test(gitignore) && /^\/artifacts\/$/m.test(gitignore), 'local live-derived output directories must be gitignored');

const productionWorkflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'production-polish-gate.yml'), 'utf8');
assert(!/uses:\s*actions\/upload-artifact/.test(productionWorkflow), 'Production workflow must not upload live-derived visual artifacts');
assert(!/npm exec -- argos|argos upload/i.test(productionWorkflow), 'Production workflow must not send live-derived visuals to Argos');
assert(!/cat\s+[^\n]*GITHUB_STEP_SUMMARY/.test(productionWorkflow), 'Production workflow must not copy generated manifests into public summaries');
for (const log of ['prod-fast-private', 'prod-interaction-private', 'prod-heavy-private', 'prod-review-private', 'prod-validate-private', 'prod-export-private']) {
  assert(productionWorkflow.includes(`.codex-tmp/${log}.log 2>&1`), `${log} stdout/stderr must stay runner-local`);
}

if (process.argv[2]) {
  validateArtifact(JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8')));
}

console.log('public-b1-artifact: aggregate-only serializer excludes row and person fields');
