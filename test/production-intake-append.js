'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const edge = read('supabase/functions/production-write/index.ts');
const migration = read('migrations/2026-08-02-f133-canonical-title.sql');
const executableMigration = migration.split(/\r?\n/)
  .filter(line => !/^\s*--/.test(line))
  .join('\n');
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
    { team: 'video', card_id: 'new-card', title: 'August product reveal', sort_key: 99 },
    { team: 'graphics', card_id: 'new-card', title: 'August product reveal', sort_key: 99 },
  ];
  const planned = policy.planAppendIntakeItems(existing, pair, ['new-v', 'new-g']);
  ok(planned.every(item => item.videoNumber === 2 && item.sort_key === 1 && item.title === 'August product reveal')
    && planned[0]._intake_ordinal === planned[1]._intake_ordinal,
  'gateway allocates one shared next ordinal/sort slot without replacing the canonical title');

  const twoPairs = policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'card-a', title: 'First real title' },
    { team: 'graphics', card_id: 'card-a', title: 'First real title' },
    { team: 'video', card_id: 'card-b', title: 'Second real title' },
    { team: 'graphics', card_id: 'card-b', title: 'Second real title' },
  ], ['a-v', 'a-g', 'b-v', 'b-g']);
  ok(twoPairs[0].videoNumber === 2 && twoPairs[1].sort_key === 1
    && twoPairs[2].videoNumber === 3 && twoPairs[3].sort_key === 2,
  'multiple appended cards receive dense server-owned ordinals and sort slots');

  const retryRows = existing.concat([
    { id: 'new-v', team: 'video', card_id: 'new-card', title: 'August product reveal', sort_key: 1 },
    { id: 'new-g', team: 'graphics', card_id: 'new-card', title: 'August product reveal', sort_key: 1 },
  ]);
  const retry = policy.planAppendIntakeItems(retryRows, pair, ['new-v', 'new-g']);
  ok(retry.every(item => item.videoNumber === 2 && item.sort_key === 1),
    'an exact retry reuses its persisted server allocation');
  const single = policy.planAppendIntakeItems(existing, [
    { team: 'video', card_id: 'video-only', title: 'Single-team post' },
  ], ['only-v']);
  ok(single.length === 1 && single[0].videoNumber === 2 && single[0].title === 'Single-team post'
    && throwsCode(() => policy.planAppendIntakeItems(existing, [
      { team: 'video', card_id: 'duplicate-team' },
      { team: 'video', card_id: 'duplicate-team' },
    ], ['bad-v-1', 'bad-v-2']), 'invalid_intake_append_pair'),
  'append intake supports an explicit single-team card and rejects duplicate-team linkage');

  const sparse = policy.planAppendIntakeItems(existing.concat([
    { id: 'historical-gap', team: 'video', origin: 'manual', card_id: null, sort_key: 4 },
  ]), [
    { team: 'video', card_id: 'after-gap', title: 'Sparse cursor title' },
  ], ['after-gap-video']);
  ok(sparse.length === 1
    && sparse[0].sort_key === 5
    && sparse[0]._intake_ordinal === 6
    && sparse[0].videoNumber === 6,
  'sparse historical sort slots advance the shared JS ordinal cursor by max, not row count');

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
    && /production_intake_commit/.test(appendBranch),
  'exact replay is recognized before the stale batch CAS and new writes use one atomic RPC');
  const cardReceiptStart = edge.indexOf('function exactIntakeCardReceipts(');
  const cardReceiptEnd = edge.indexOf('\nfunction exactIntakeBatchReceipt(', cardReceiptStart);
  const cardReceipt = edge.slice(cardReceiptStart, cardReceiptEnd);
  const batchReceiptStart = cardReceiptEnd;
  const batchReceiptEnd = edge.indexOf('\nasync function handleIntakeCreate(', batchReceiptStart);
  const batchReceipt = edge.slice(batchReceiptStart, batchReceiptEnd);
  ok(cardReceiptStart > 0 && cardReceiptEnd > cardReceiptStart
    && /observed\.length !== expected\.length/.test(cardReceipt)
    && /itemById\.size !== expectedItemIds\.size/.test(cardReceipt)
    && /clean\(row\.client_slug\) === clean\(planned\.client\)/.test(cardReceipt)
    && /clean\(row\.batch_id\) === expectedBatchId/.test(cardReceipt)
    && /clean\(row\.origin\) === "calendar"/.test(cardReceipt)
    && /clean\(row\.card_id\) === clean\(planned\.id\)/.test(cardReceipt)
    && /normalizeTeam\(row\.team\) === team/.test(cardReceipt)
    && /canonicalTitle\(row\.title\) === cardTitle/.test(cardReceipt)
    && /card\.linear_issue_id[\s\S]{0,100}video\.linear_issue_url/.test(cardReceipt)
    && /card\.graphic_linear_issue_id[\s\S]{0,100}graphic\.linear_issue_url/.test(cardReceipt),
  'intake accepts only an exact card/item identity, batch, origin, team, canonical-title, and Linear-link receipt set');
  ok(/\(!allowCurrentTitle && cardTitle !== plannedTitle\)/.test(cardReceipt)
    && /if \(cardTitle !== plannedTitle\) superseded = true/.test(cardReceipt)
    && /clean\(batch\.id\) !== expectedId \|\| clean\(batch\.client_slug\) !== clientSlug/.test(batchReceipt)
    && /\(appendCommit\.replay === true\) !== exactReplay/.test(appendBranch)
    && /replayed: exactReplay/.test(appendBranch)
    && /superseded: appendCardReceipt\.superseded \|\| responseCardReceipt\.superseded/.test(appendBranch),
  'intake returns exact replay/batch receipts while explicitly reporting a later canonical-title supersession');
  const appendFingerprint = appendBranch.indexOf('const childFingerprint = await intentFingerprint({');
  const appendDedupProof = appendBranch.indexOf('planned.child_replay = await assertDedupIntent(');
  const appendTitleException = appendBranch.indexOf('planned.existing_title_mismatch === true');
  ok(appendFingerprint > 0 && appendDedupProof > appendFingerprint && appendTitleException > appendDedupProof
    && /row: \{[\s\S]{0,100}title: row\.title/.test(appendBranch)
    && /clean\(payload\._intent_fingerprint\) === clean\(expected\.intent_fingerprint\)/.test(edge)
    && /v_existing_outbox\.payload is distinct from \([\s\S]{0,100}v_payload - '_f27_authority_generation' - '_f27_legacy_parity'/.test(migration)
    && /e\.payload is not distinct from v_expected_event/.test(migration)
    && /v_item\.title is distinct from v_title/.test(migration),
  'an intake replay proves the original requested title from immutable fingerprint, outbox payload, and event binders before adopting a newer coherent card title');
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
    && /invalid_intake_append_pair/.test(migration),
  'RPC independently enforces unique one-or-two-team linkage per card');
  ok(/production_batch_parent_ids_for_team\(v_batch\.linear_parent_ids, v_team\)/.test(migration)
    && /v_dependency\.payload->>'project_id' is distinct from v_project_id/.test(migration)
    && /v_dependency\.team is distinct from v_team/.test(migration)
    && /v_dependency_parent_id is distinct from v_parent_ids\[1\]/.test(migration),
  'RPC accepts only the exact team parent ID or matching native parent-create dependency');
  ok(/v_base_sort/.test(migration)
    && /v_base_ordinal/.test(migration)
    && /max\(floor\(d\.sort_key\)::integer \+ 1\)/.test(migration)
    && /invalid_intake_append_order/.test(migration)
    && /set updated_at = clock_timestamp\(\)/.test(migration),
  'RPC rechecks server ordering under lock and serializes concurrent appends with the batch cursor');
  ok(/revoke all on function public\.production_intake_append\([\s\S]{0,180}from public, anon, authenticated, service_role/.test(executableMigration)
    && !/grant execute on function public\.production_intake_append\([\s\S]{0,180}to service_role/.test(executableMigration)
    && /grant execute on function public\.production_intake_commit[\s\S]{0,180}to service_role/.test(executableMigration)
    && /OWNER-ONLY EXACT INVERSE/.test(migration),
  'low-level append is owner-internal while the atomic commit is service-only and rollback remains owner-run');
  ok((executableMigration.match(/insert into public\.syncview_runtime_flags/g) || []).length === 1
    && /f133_canonical_title_enabled[\s\S]{0,180}'\{"enabled":false\}'::jsonb[\s\S]{0,120}on conflict \(key\) do nothing/.test(executableMigration)
    && !/prod_authority\s*=|linear_outbound_enabled\s*=/.test(executableMigration),
    'migration only seeds its independent activation flag OFF and changes no authority or outbound flag');

  const intakeStart = edge.indexOf('async function handleIntakeCreate(');
  const intakeSource = edge.slice(intakeStart);
  const newBranch = edge.slice(edge.indexOf('  const batchRow: JsonMap = {', intakeStart));
  const newFingerprint = newBranch.indexOf('const childFingerprint = await intentFingerprint({');
  const newDedupProof = newBranch.indexOf('planned.child_replay = await assertDedupIntent(');
  const newTitleException = newBranch.indexOf('planned.existing_title_mismatch === true');
  ok(newFingerprint > 0 && newDedupProof > newFingerprint && newTitleException > newDedupProof
    && /row: \{[\s\S]{0,100}title: row\.title/.test(newBranch)
    && /exactReplay = replayCount === intentCount/.test(newBranch)
    && /\(newCommit\.replay === true\) !== exactReplay/.test(newBranch)
    && /newCommit\.cards, plannedCards, newCommit\.items, batchId, exactReplay/.test(newBranch)
    && /replayed: exactReplay/.test(newBranch)
    && /superseded: newCardReceipt\.superseded \|\| committedCardReceipt\.superseded/.test(newBranch),
  'new-batch intake applies the same immutable-title replay proof and exact/superseded receipt contract as append');
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

  if (failures) {
    console.error(`\n${failures} production intake append check(s) failed.`);
    process.exit(1);
  }
  console.log('\nProduction intake append checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
