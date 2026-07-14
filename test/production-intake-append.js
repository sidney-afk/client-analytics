'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
const migration = read('migrations/2026-07-13-production-intake-append.sql');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function throwsCode(fn, code) {
  try { fn(); } catch (error) { return error && error.message === code; }
  return false;
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href);

  ok(JSON.stringify(policy.parentIdsForTeam({
    video: { uuid: 'parent-video' },
    graphics: { id: 'parent-graphics' },
  }, 'VID')) === JSON.stringify(['parent-video'])
    && JSON.stringify(policy.parentIdsForTeam([
      { team: 'GRA', linear_issue_id: 'parent-graphics' },
    ], 'graphics')) === JSON.stringify(['parent-graphics'])
    && policy.parentIdsForTeam({ graphics: { id: 'wrong-parent' } }, 'video').length === 0
    && policy.parentIdsForTeam({ video: { id: 'a', uuid: 'b' } }, 'video').length === 2,
  'append parent lookup accepts only one explicit team-tagged Linear parent');

  const existing = [
    { id: 'old-v', team: 'video', card_id: 'old-card', title: 'Video 1', sort_key: 0 },
    { id: 'old-g', team: 'graphics', card_id: 'old-card', title: 'Video 1', sort_key: 0 },
  ];
  const pair = [
    { team: 'video', card_id: 'new-card', title: 'caller title', sort_key: 99 },
    { team: 'graphics', card_id: 'new-card', sort_key: 99 },
  ];
  const planned = policy.planAppendIntakeItems(existing, pair, ['new-v', 'new-g']);
  ok(planned.every(item => item.videoNumber === 2 && item.sort_key === 1 && item.title === 'Video 2')
    && planned[0]._intake_ordinal === planned[1]._intake_ordinal,
  'gateway allocates one shared next ordinal/sort slot for a paired Video + Graphics card');

  const twoPairs = policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'card-a' },
    { team: 'graphics', card_id: 'card-a' },
    { team: 'video', card_id: 'card-b' },
    { team: 'graphics', card_id: 'card-b' },
  ], ['a-v', 'a-g', 'b-v', 'b-g']);
  ok(twoPairs[0].videoNumber === 2 && twoPairs[1].sort_key === 1
    && twoPairs[2].videoNumber === 3 && twoPairs[3].sort_key === 2,
  'multiple appended cards receive dense server-owned ordinals and sort slots');

  const retryRows = existing.concat([
    { id: 'new-v', team: 'video', card_id: 'new-card', title: 'Video 2', sort_key: 1 },
    { id: 'new-g', team: 'graphics', card_id: 'new-card', title: 'Video 2', sort_key: 1 },
  ]);
  const retry = policy.planAppendIntakeItems(retryRows, pair, ['new-v', 'new-g']);
  ok(retry.every(item => item.videoNumber === 2 && item.sort_key === 1),
    'an exact retry reuses its persisted server allocation');
  ok(throwsCode(() => policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'unpaired' },
  ], ['only-v']), 'invalid_intake_append_pair'),
  'append intake rejects an unpaired or malformed card before writes');

  ok(/surface !== "submission" && surface !== "calendar"/.test(edge)
    && /\(lane === "submission" \|\| lane === "calendar"\) && op === "intake_create"/.test(
      read('supabase/functions/production-write/policy.mjs'),
    ),
  'one intake_create operation is admitted from both Submit and Calendar');
  ok(/const requestedBatchId = clean\(body\.batch_id\)/.test(edge)
    && /appendToBatch && hasNewBatchInput/.test(edge)
    && /expected_batch_updated_at/.test(edge)
    && /cas_required/.test(edge),
  'existing batch_id is mutually exclusive with new batch input and requires a CAS cursor');

  const appendStart = edge.indexOf('if (appendToBatch) {\n    if (!appendBatch)');
  const appendEnd = edge.indexOf('\n  const batchRow: JsonMap = {', appendStart);
  const appendBranch = edge.slice(appendStart, appendEnd);
  ok(appendStart > 0 && appendEnd > appendStart
    && /return json\(\{/.test(appendBranch)
    && !/ensureBatch\(|production_batch_intent_write|parentPlans/.test(appendBranch),
  'append returns before the new-batch parent path and cannot mint or duplicate a parent');
  ok(/clean\(appendBatch\.client_slug\) !== clientSlug/.test(edge)
    && /lower\(appendBatch\.status\) !== "active"/.test(edge)
    && /batchTeam && teamList\.some/.test(edge),
  'gateway requires an active same-client batch compatible with every requested team');
  ok(/projectByTeam\[team\] = await projectForIntake/.test(edge)
    && /project_id: projectId/.test(appendBranch)
    && /validateLinearBatchParent/.test(edge)
    && /issue\(id: \$id\).*team \{ key \} project \{ id \}/.test(edge),
  'each child uses its exact team project and the existing Linear parent is read-only validated');
  ok(/parentIdsForTeam\(batch\.linear_parent_ids, team\)/.test(edge)
    && /batch_parent_mapping_ambiguous/.test(edge)
    && /dependency_dedup_key/.test(appendBranch)
    && /pending -> written\/linkage/.test(edge)
    && /writtenParentId !== directIds\[0\]/.test(edge)
    && !/\.limit\(3\)/.test(edge.slice(edge.indexOf('async function parentRouteForAppend'), edge.indexOf('async function projectForIntake'))),
  'parent routing is exact per team and a native parent dependency remains stable after linkage');
  ok(/expectedBatchUpdatedAt: clean\(body\.expected_batch_updated_at\)/.test(appendBranch)
    && /parentRoute: routeFingerprint/.test(appendBranch)
    && /projectId, batchId/.test(appendBranch),
  'append fingerprints bind batch cursor, per-team project, and exact parent route');
  ok(/const exactReplay = replayCount === plannedItems\.length/.test(appendBranch)
    && appendBranch.indexOf('const exactReplay') < appendBranch.indexOf('Date.parse(clean(body.expected_batch_updated_at))')
    && /production_intake_append/.test(appendBranch),
  'exact replay is recognized before the stale batch CAS and new writes use one atomic RPC');
  ok(/appendToBatch && appendBatch[\s\S]{0,80}\? \{ name: appendBatch\.name, notes: appendBatch\.description \}/.test(edge)
    && /video_number: Number\(planned\.video_number\)/.test(appendBranch),
  'append generation uses trusted batch context and returns the server-owned video number');
  ok(/browserCredentialTestOverride\(body\.test_override, key, token\)/.test(edge)
    && /serviceTestOverrideAllowed\(key, token, body\.confirm, await serviceRoleRequest\(req\)\)/.test(edge)
    && !/deriveBrowserTestScope/.test(edge),
  'append preserves the service-authenticated TEST-only lock');

  const lockPos = migration.indexOf('for update;');
  const replayPos = migration.indexOf('public.production_outbox_replay(');
  const casPos = migration.indexOf("raise exception 'write_conflict'");
  const writePos = migration.indexOf('public.production_deliverable_write(');
  const cursorPos = migration.indexOf('update public.batches b');
  ok(lockPos > 0 && replayPos > lockPos && casPos > replayPos && writePos > casPos && cursorPos > writePos,
    'RPC locks the batch, recognizes exact replay, checks CAS, writes both children, then advances the cursor');
  ok(/count\(\*\) filter \(where item->>'team' = 'video'\) <> 1/.test(migration)
    && /count\(\*\) filter \(where item->>'team' = 'graphics'\) <> 1/.test(migration)
    && /invalid_intake_append_pair/.test(migration),
  'RPC independently enforces one Video and one Graphics child per card');
  ok(/production_batch_parent_ids_for_team\(v_batch\.linear_parent_ids, v_team\)/.test(migration)
    && /v_dependency\.payload->>'project_id' is distinct from v_project_id/.test(migration)
    && /v_dependency\.team is distinct from v_team/.test(migration)
    && /v_dependency_parent_id is distinct from v_parent_ids\[1\]/.test(migration),
  'RPC accepts only the exact team parent ID or matching native parent-create dependency');
  ok(/v_base_sort/.test(migration)
    && /v_base_ordinal/.test(migration)
    && /invalid_intake_append_order/.test(migration)
    && /set updated_at = clock_timestamp\(\)/.test(migration),
  'RPC rechecks server ordering under lock and serializes concurrent appends with the batch cursor');
  ok(/revoke all on function public\.production_intake_append/.test(migration)
    && /grant execute on function public\.production_intake_append[\s\S]*to service_role/.test(migration)
    && /OWNER-ONLY ONE-COMMAND ROLLBACK/.test(migration),
  'atomic append is service-only and includes the owner-run rollback block');
  ok(!/syncview_runtime_flags|prod_authority\s*=|linear_outbound_enabled\s*=/.test(migration),
    'append migration changes no runtime authority or outbound flag');

  if (failures) {
    console.error(`\n${failures} production intake append check(s) failed.`);
    process.exit(1);
  }
  console.log('\nProduction intake append checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
