'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
// v2 (2026-08-18): the Jul 13 migration was written but NEVER APPLIED to the
// live database (every append 500'd on a missing function); v2 supersedes it
// with per-kind titles and single-team card groups for the post-shape modes.
const migration = read('migrations/2026-08-19-production-intake-append-v5.sql');
const v3Migration = read('migrations/2026-08-19-production-intake-append-v3.sql');
const v2Migration = read('migrations/2026-08-18-production-intake-append-v2.sql');
const supersededMigration = read('migrations/2026-07-13-production-intake-append.sql');
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
  ok(planned.every(item => item.videoNumber === 2 && item.sort_key === 1)
    && planned[0].title === 'Video 2' && planned[1].title === 'Thumbnail 2'
    && planned[0]._intake_ordinal === planned[1]._intake_ordinal,
  'gateway allocates one shared next ordinal/sort slot for a paired card, titled per kind');

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
    { id: 'new-g', team: 'graphics', card_id: 'new-card', title: 'Thumbnail 2', sort_key: 1 },
  ]);
  const retry = policy.planAppendIntakeItems(retryRows, pair, ['new-v', 'new-g']);
  ok(retry.every(item => item.videoNumber === 2 && item.sort_key === 1),
    'an exact retry reuses its persisted server allocation');
  const soloVideo = policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'solo-v-card' },
  ], ['solo-v']);
  ok(soloVideo.length === 1 && soloVideo[0].title === 'Video 2'
    && soloVideo[0]._intake_ordinal === 2 && soloVideo[0].sort_key === 1,
  'a Video-only card appends alone with the next ordinal (2026-08-17 modes)');
  const soloThumb = policy.planAppendIntakeItems(existing, [
    { team: 'graphics', card_id: 'solo-g-card' },
  ], ['solo-g']);
  ok(soloThumb.length === 1 && soloThumb[0].title === 'Thumbnail 2'
    && soloThumb[0]._intake_ordinal === 2,
  'a Thumbnail-only card appends alone and is titled per kind');
  const thumbOnlyBase = policy.planAppendIntakeItems([
    { id: 'old-t', team: 'graphics', card_id: 'old-t-card', title: 'Thumbnail 3', sort_key: 4 },
  ], [{ team: 'graphics', card_id: 'next-t-card' }], ['next-t']);
  ok(thumbOnlyBase[0]._intake_ordinal === 4 && thumbOnlyBase[0].title === 'Thumbnail 4'
    && thumbOnlyBase[0].sort_key === 5,
  'Thumbnail titles advance the base ordinal so numbers never repeat');
  ok(throwsCode(() => policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'dup-card' },
    { team: 'video', card_id: 'dup-card' },
  ], ['dup-1', 'dup-2']), 'invalid_intake_append_pair'),
  'two same-team rows on one card still refuse before writes');

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
  ok(/count\(\*\) filter \(where item->>'team' = 'video'\) > 1/.test(migration)
    && /count\(\*\) filter \(where item->>'team' = 'graphics'\) > 1/.test(migration)
    && /count\(\*\) < 1 or count\(\*\) > 2/.test(migration)
    && /invalid_intake_append_pair/.test(migration),
  'RPC allows a pair or a single-team card group, never two of one team');
  ok(/when item->>'team' = 'graphics' then 'Thumbnail ' \|\| v_expected_ordinal::text/.test(migration)
    && /\^\(\?:Video\|Thumbnail\) \(\[1-9\]\[0-9\]\*\)\$/.test(migration),
  'RPC titles are per kind and Thumbnail titles advance the base ordinal');
  // The lineage claim lives in v2 now: v2 is the file that records the Jul 13
  // migration was never applied. v3 supersedes v2 for a different reason and
  // says so in its own header, so asserting "NEVER APPLIED" against the newest
  // file would pin the wrong document.
  ok(/SUPERSEDED -- DO NOT RUN/.test(supersededMigration)
    && /NEVER APPLIED/.test(v2Migration),
  'the unapplied Jul 13 file is fenced off and v2 records why it exists');
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

  const intakeStart = edge.indexOf('async function handleIntakeCreate(');
  const intakeSource = edge.slice(intakeStart);
  ok(/async function intakeFilmingPlanForClient[\s\S]{0,500}from\("filming_plans"\)[\s\S]{0,220}eq\("client_slug", clientSlug\)/.test(edge)
    && /intake filming-plan lookup failed/.test(edge)
    && !/from\("filming_plans"\)[\s\S]{0,500}throw new GatewayError/.test(edge),
  'new native intake resolves the protected filming plan by server-side client slug and degrades safely on lookup failure');
  ok(/function intakeDescriptionWithFilmingPlan\(/.test(edge)
    && /INTAKE_FILMING_PLAN_MISSING_MARKER/.test(edge)
    && /status: "missing"/.test(edge)
    && /await intakeFilmingPlanForClient\(supabase, clientSlug\)/.test(intakeSource)
    && /description: intakePlan\.description \|\| null/.test(intakeSource)
    && /filming_doc_url: intakePlan\.planUrl \|\| null/.test(intakeSource)
    && /description: clean\(batchRow\.description\) \|\| undefined/.test(intakeSource)
    && /filming_plan_missing: intakePlan\.status === "missing"/.test(intakeSource),
  'new native intake attaches the server plan or creates a visible non-blocking SMM follow-up marker');

  // v4: the batch-create dependency describes its OWN lane -- team, parity,
  // project -- and the gateway shares one dependency across every team on the
  // card. v2 refused the team difference; v3 fixed only that, so the parity
  // comparison refused the same appends next (video lane parity true, graphics
  // lane parity false post-flip, read off the live outbox rows), with the
  // project comparison queued behind it for distinct-project clients. All
  // three waive together, and only under the shared-parent proof. Proven on
  // PostgreSQL 16: both shared shapes refuse under v3 and complete under v4;
  // a same-team parity mismatch still refuses.
  ok(/v_shared_parent := v_dependency\.team is distinct from v_team\s*\n\s*and cardinality\(v_parent_ids\) = 1\s*\n\s*and v_parent_ids = v_dep_parent_ids;/.test(migration),
  'the shared-parent proof demands one identical parent issue for both teams');
  ok(/\(v_dependency\.team is distinct from v_team and not v_shared_parent\)/.test(migration),
  'the team comparison waives only under that proof');
  ok(/legacy_parity is distinct from coalesce\(\(v_outbound->>'legacy_parity'\)::boolean, false\)\s*\n\s*and not v_shared_parent\)/.test(migration),
  'the parity comparison waives only under that proof');
  ok(/'project_id' is distinct from v_project_id\s*\n\s*and not v_shared_parent\)/.test(migration),
  'the project comparison waives only under that proof');
  ok(/\n         or v_dependency\.legacy_parity is distinct from coalesce\(\(v_outbound->>'legacy_parity'\)::boolean, false\)\n/.test(v3Migration),
  'v3 carried the unconditional parity rule this file replaces');
  ok(/\n         or v_dependency\.team is distinct from v_team\n/.test(v2Migration),
  'v2 carried the unconditional team rule the lineage began with');
  // This suite follows the LIVE migration, which is v5 since samples native
  // create widened the origin pin into a row-origin/batch-purpose agreement.
  // Everything above still applies because v5 is byte-identical to v4 apart
  // from that one condition (pinned in test/samples-append-origin.js).
  ok(/SUPERSEDES migrations\/2026-08-19-production-intake-append-v4\.sql/.test(migration),
  'the live migration names the one it supersedes');

  if (failures) {
    console.error(`\n${failures} production intake append check(s) failed.`);
    process.exit(1);
  }
  console.log('\nProduction intake append checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
