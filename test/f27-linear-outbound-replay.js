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

  ok(/F27_ROLLBACK_REPLAY/.test(helperSource) && /f27ReplayRequest\(body\)/.test(source),
    'real writer exposes an explicit F27 replay confirmation');
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

  let rejected = false;
  try { helper.f27ReplayRequest({ rollback_id: 'r', target_dedup_key: 'd' }); } catch (_) { rejected = true; }
  ok(rejected, 'missing explicit replay confirmation is rejected');
  const request = helper.f27ReplayRequest({
    rollback_id: 'rollback-1',
    target_dedup_key: 'dedup-1',
    confirm: 'F27_ROLLBACK_REPLAY',
  });
  ok(request.rollbackId === 'rollback-1' && request.dedupKey === 'dedup-1',
    'exact rollback and dedup scope are retained');
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
