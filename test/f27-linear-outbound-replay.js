const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  let failures = 0;
  const ok = (value, message) => {
    if (!value) {
      failures++;
      console.error(`FAIL: ${message}`);
    } else console.log(`PASS: ${message}`);
  };
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'supabase', 'functions', 'linear-outbound', 'index.ts'), 'utf8');
  const helperPath = path.join(root, 'supabase', 'functions', 'linear-outbound', 'f27-replay.mjs');
  const helperSource = fs.readFileSync(helperPath, 'utf8');
  const helper = await import(pathToFileURL(helperPath).href);
  const rejects = fn => {
    try { fn(); } catch (_) { return true; }
    return false;
  };

  ok(/F27_ROLLBACK_REPLAY/.test(helperSource) && /f27ReplayRequest\(body\)/.test(source),
    'real writer exposes an explicit F27 replay confirmation');
  ok(/F27_ROLLBACK_DRILL/.test(helperSource),
    'drill replay has a distinct explicit confirmation');
  ok(/modeFrom\(outbound\) !== "off" \|\| parity\.enabled !== false/.test(source),
    'scoped replay requires F2 off and F4 false');
  ok(/track_b_team_rollback_intents/.test(source) && /\.eq\("classification", "replay"\)/.test(source),
    'real writer reads the exact open approved rollback intent');
  ok(/await f27ReplayAuthorization\(supabase, f27ReplayRequestValue, row\)/.test(source),
    'real writer revalidates rollback authorization after claiming the row');
  ok(/fetchLane\(null, \["pending", "skipped"\], 1, "any"\)/.test(source)
    && /status: f27Replay \? "skipped" : "failed"/.test(source),
    'scoped writer retries only the exact ledger-quarantined rollback row while global lanes stay stopped');
  ok(/let f27Replay: JsonMap \| null = f27ReplayRequestValue;\s*try \{\s*f27Replay =/.test(source),
    'validated replay mode remains in catch scope even when post-claim authorization fails');
  ok(/f27Replay \|\| Number\(row\.attempts \|\| 0\) < MAX_ATTEMPTS/.test(source)
    && /!f27Replay && attempts >= MAX_ATTEMPTS/.test(source),
    'F27 recovery remains selectable and scheduled beyond the normal attempt ceiling');
  ok(/status: "skipped"/.test(source)
    && /status: f27Replay \? "skipped" : "stale"/.test(source)
    && /F27 replay declined: tolerated_historical/.test(source)
    && /F27 replay declined: stale/.test(source),
    'declined F27 conflicts remain quarantined, visible, and retryable');
  ok(/bindF27LinearResult/.test(source) && /checkpointLinearResult\(supabase, row, linearResult\)/.test(source),
    'real writer checkpoints rollback-bound correlation before release');
  ok(/f27_preflight: true/.test(source)
    && /await checkpointLinearResult\(supabase, row, bindF27LinearResult/.test(source),
    'F27 writer checkpoints its exact echo identity before the Linear mutation');
  ok(/\.select\("id"\)[\s\S]*\.maybeSingle\(\)/.test(source)
    && /outbox create checkpoint CAS failed/.test(source),
    'writer refuses to mutate Linear unless the claimed checkpoint updates exactly one row');
  ok(/track_b_f27_execute_drill_replay/.test(source)
    && /p_rollback_id: rollbackId/.test(source)
    && /p_outbox_id: Number\(row\.id\)/.test(source)
    && /p_lock_token: lockToken/.test(source)
    && /isExactF27DrillReceipt\(receipt, replay, row\)/.test(source),
  'drill execution is delegated with the exact rollback, outbox, and claim token');
  ok(/f27DrillReceipt = await executeF27DrillReplay/.test(source)
    && /f27_drill_receipt: f27DrillReceipt/.test(source),
  'the response exposes the exact server-built receipt accepted by the terminal ledger RPC');
  const drillExecutor = source.match(/async function executeF27DrillReplay\([^]*?\n\}/);
  ok(drillExecutor
    && !/readViewer|entityRow|readIssue|linearGraphql|fetch\(/.test(drillExecutor[0]),
  'drill executor contains only the service RPC boundary and no provider call');

  const drillBranchStart = source.indexOf('if (f27Replay && f27Replay.isDrill === true)');
  const normalControlStart = source.indexOf('const control = await currentControl', drillBranchStart);
  const drillBranch = source.slice(drillBranchStart, normalControlStart);
  ok(drillBranchStart > 0
    && normalControlStart > drillBranchStart
    && /await executeF27DrillReplay\(supabase, f27Replay, row\)/.test(drillBranch)
    && /continue;/.test(drillBranch)
    && !/readViewer|entityRow|readIssue|linearGraphql|currentControl/.test(drillBranch),
  'post-claim drill branch terminates before viewer, entity, issue, control, or Linear calls');
  const viewerCall = source.indexOf('mirrorActor = await readViewer()');
  const viewerGuard = source.slice(source.lastIndexOf('if (f27ReplayRequestValue', viewerCall), viewerCall);
  ok(viewerCall > 0 && /f27ReplayRequestValue\?\.isDrill !== true/.test(viewerGuard),
    'pre-loop viewer lookup is excluded for drill replay');
  const normalTarget = source.match(/async function targetResult\([^]*?\n\}/);
  const f27Target = source.match(/async function f27TargetResult\([^]*?\n\}/);
  ok(normalTarget && f27Target
    && !/f27_drill_rollback_id|client_slug/.test(normalTarget[0])
    && /f27_drill_rollback_id/.test(f27Target[0]),
  'ordinary targeted result shape is unchanged and drill columns are F27-only');

  ok(helper.f27ReplayRequest({}) === null
    && helper.f27ReplayRequest({ limit: 1, confirm: 'unrelated' }) === null,
  'ordinary requests do not enter an F27 path');
  ok(rejects(() => helper.f27ReplayRequest({ rollback_id: 'r', target_dedup_key: 'd' })),
    'missing explicit replay confirmation is rejected');
  const request = helper.f27ReplayRequest({
    rollback_id: 'rollback-1',
    target_dedup_key: 'dedup-1',
    confirm: 'F27_ROLLBACK_REPLAY',
  });
  ok(request.rollbackId === 'rollback-1' && request.dedupKey === 'dedup-1' && request.isDrill === false,
    'exact rollback and dedup scope are retained');
  const normalScope = helper.bindF27ReplayScope(
    request,
    { id: 'rollback-1', correlation_id: 'correlation-1', team: 'graphics', is_drill: false },
    { id: 7, dedup_key: 'dedup-1', team: 'graphics', test_only: false, legacy_parity: false },
  );
  ok(normalScope.isDrill === false && normalScope.correlationId === 'correlation-1',
    'ordinary F27 replay retains its real-team authorization contract');
  ok(rejects(() => helper.bindF27ReplayScope(
    request,
    { id: 'rollback-1', team: helper.F27_DRILL_TEAM, is_drill: true },
    { dedup_key: 'dedup-1', team: helper.F27_DRILL_TEAM },
  )), 'ordinary replay confirmation cannot target a drill rollback');

  const drillRequest = helper.f27ReplayRequest({
    rollback_id: 'drill-rollback-1',
    target_dedup_key: 'drill-dedup-1',
    confirm: 'F27_ROLLBACK_DRILL',
  });
  ok(rejects(() => helper.f27ReplayRequest({
    rollback_id: 'drill-rollback-1',
    target_dedup_key: 'drill-dedup-1',
    confirm: 'f27_rollback_drill',
  })), 'drill confirmation is exact and case-sensitive');
  const drillRollback = {
    id: 'drill-rollback-1',
    correlation_id: 'drill-correlation-1',
    team: helper.F27_DRILL_TEAM,
    is_drill: true,
  };
  const drillOutbox = {
    id: 8,
    dedup_key: 'drill-dedup-1',
    team: helper.F27_DRILL_TEAM,
    client_slug: helper.F27_DRILL_CLIENT,
    f27_drill_rollback_id: 'drill-rollback-1',
    test_only: true,
    legacy_parity: false,
  };
  const drillScope = helper.bindF27ReplayScope(drillRequest, drillRollback, drillOutbox);
  ok(drillScope.isDrill === true
    && drillScope.rollbackId === 'drill-rollback-1'
    && drillScope.dedupKey === 'drill-dedup-1',
  'drill scope retains the exact reserved rollback/outbox binding');
  ok(rejects(() => helper.bindF27ReplayScope(
    drillRequest,
    { id: 'drill-rollback-1', team: 'video', is_drill: false },
    { ...drillOutbox, team: 'video', client_slug: 'ordinary' },
  )), 'drill confirmation cannot target a real-team rollback');
  ok(helper.isExactF27DrillAuthority({ video: 'linear', graphics: 'linear' })
    && !helper.isExactF27DrillAuthority({ video: 'syncview', graphics: 'linear' })
    && !helper.isExactF27DrillAuthority({ video: 'Linear', graphics: 'linear' })
    && !helper.isExactF27DrillAuthority({ video: 'linear', graphics: 'linear', drill: 'linear' }),
  'drill authorization requires the exact two-key Linear/Linear authority value');
  ok(helper.hasExactF27DrillStops({ mode: 'off' }, { enabled: false })
    && !helper.hasExactF27DrillStops({ mode: 'invalid' }, { enabled: false })
    && !helper.hasExactF27DrillStops({ mode: 'off', extra: true }, { enabled: false })
    && !helper.hasExactF27DrillStops({ mode: 'off' }, { enabled: false, extra: true }),
  'drill authorization requires exact F2-off and F4-false flag values');
  const receiptReplay = {
    ...drillScope,
    intentSnapshotSha256: 'a'.repeat(64),
  };
  const drillReceipt = {
    ok: true,
    type: 'f27_drill_replay_terminal',
    f27_drill: true,
    f27_preflight: true,
    no_external_call: true,
    mutation: 'f27DrillNoop',
    issue_id: `${helper.F27_DRILL_TEAM}:drill-rollback-1`,
    expected: { input: { stateId: helper.F27_DRILL_TEAM } },
    rollback_id: 'drill-rollback-1',
    correlation_id: 'drill-correlation-1',
    outbox_id: 8,
    dedup_key: 'drill-dedup-1',
    operation: 'status',
    intent_snapshot_sha256: 'a'.repeat(64),
    linear_result_sha256: 'c'.repeat(64),
  };
  ok(helper.isExactF27DrillReceipt(drillReceipt, receiptReplay, {
    ...drillOutbox,
    operation: 'status',
  }), 'drill terminal receipt is fully bound to the deterministic no-op and intent snapshot');
  for (const [field, value] of [
    ['f27_preflight', false],
    ['no_external_call', false],
    ['mutation', 'issueUpdate'],
    ['issue_id', 'not-the-reserved-issue'],
    ['expected', { input: { stateId: 'not-the-reserved-value' } }],
    ['intent_snapshot_sha256', 'b'.repeat(64)],
    ['linear_result_sha256', 'not-a-sha256'],
  ]) {
    ok(!helper.isExactF27DrillReceipt(
      { ...drillReceipt, [field]: value },
      receiptReplay,
      { ...drillOutbox, operation: 'status' },
    ), `drill receipt rejects mismatched ${field}`);
  }
  for (const [field, value] of [
    ['team', 'video'],
    ['client_slug', 'not-the-reserved-client'],
    ['f27_drill_rollback_id', 'other-rollback'],
    ['test_only', false],
    ['legacy_parity', true],
  ]) {
    ok(rejects(() => helper.bindF27ReplayScope(
      drillRequest,
      drillRollback,
      { ...drillOutbox, [field]: value },
    )), `drill scope rejects mismatched ${field}`);
  }
  const result = helper.bindF27LinearResult(
    { issue_id: 'TEST' },
    { rollbackId: 'rollback-1', correlationId: 'correlation-1' },
    { id: 7, dedup_key: 'dedup-1', operation: 'status' },
  );
  ok(result.rollback_id === 'rollback-1'
    && result.correlation_id === 'correlation-1'
    && result.outbox_id === '7'
    && result.dedup_key === 'dedup-1'
    && result.operation === 'status',
  'persisted writer result is bound to exact replay identity');

  if (failures) process.exit(1);
  console.log('F27 real-writer scoped replay checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
