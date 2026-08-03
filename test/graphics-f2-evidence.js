#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  CREDENTIAL_SCHEMA,
  DISPATCH_SCHEMA,
  EVIDENCE_SCHEMA,
  GateError,
  PROJECT_REF,
  buildDrainerTerminal,
  buildEvidenceReceipt,
  capturePostgresSnapshot,
  deterministicCorrelation,
  sha256,
  snapshotSql,
  stableJson,
} = require('../scripts/graphics-f2-evidence.js');

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed++;
}

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

const toolSource = source('scripts/graphics-f2-evidence.js');
const drainWorkflow = source('.github/workflows/linear-outbound-drain.yml');
const evidenceWorkflow = source('.github/workflows/graphics-f2-evidence.yml');
const proofSql = source('scripts/graphics-f2-evidence-proof.sql');
const flipRunbook = source('docs/ops/FLIP_RUNBOOK.md');
const triggerExecuteRevokeMatch = flipRunbook.match(
  /<!-- GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_BEGIN -->\r?\n```sql\r?\n([\s\S]*?)\r?\n```\r?\n<!-- GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_END -->/,
);
assert.ok(triggerExecuteRevokeMatch, 'the F2 runbook must carry the exact owner-gated ACL action');
const triggerExecuteRevokeSql = triggerExecuteRevokeMatch[1];
const triggerExecuteRollbackMatch = flipRunbook.match(
  /<!-- GRAPHICS_F2_TRIGGER_EXECUTE_ROLLBACK_SQL_BEGIN -->\r?\n```sql\r?\n([\s\S]*?)\r?\n```\r?\n<!-- GRAPHICS_F2_TRIGGER_EXECUTE_ROLLBACK_SQL_END -->/,
);
assert.ok(triggerExecuteRollbackMatch, 'the F2 runbook must carry the exact owner-only ACL rollback');
const triggerExecuteRollbackSql = triggerExecuteRollbackMatch[1];

ok(/begin transaction isolation level repeatable read read only;/.test(toolSource)
  && /current_setting\('transaction_read_only'\)/.test(toolSource),
'the production snapshot is mechanically REPEATABLE READ and READ ONLY');
ok(toolSource.includes("acldefault('f', p.proowner)")
  && toolSource.includes("'granted_to_public', grants.granted_to_public")
  && toolSource.includes("where p.prokind in ('f', 'p', 'w', 'a')")
  && toolSource.includes('a.aggtransfn::oid')
  && toolSource.includes("'security_definer_via_aggregate_support', aggregate_support.has_security_definer")
  && toolSource.includes('accepted_public_execute: acceptedPublicExecute')
  && toolSource.includes('|| row.security_definer)'),
'effective function, procedure, window-function, and aggregate EXECUTE is provenance-classified and audited');
ok(!/^\s*(?:insert|update|delete|merge|truncate|alter|drop|create)\b/im.test(
  toolSource.match(/function snapshotSql[\s\S]*?function databaseConnection/)[0]
    .replace(/function snapshotSql|function databaseConnection/g, '')
), 'the evidence SQL contains no production mutation statement');
ok(toolSource.includes('query SyncViewGraphicsF2Credential { viewer { id } }')
  && toolSource.includes('LINEAR_MIRROR_API_KEY')
  && !/query:\s*['"]mutation\b/i.test(toolSource)
  && toolSource.includes('mutation_attempted: false'),
'the packaged credential command performs one typed Linear read and no provider mutation');
ok(drainWorkflow.includes('X-Syncview-Correlation: $F2_CORRELATION_ID')
  && drainWorkflow.includes('linear-outbound-terminal-${{ github.run_id }}-${{ github.run_attempt }}')
  && drainWorkflow.includes('continue-on-error: true')
  && drainWorkflow.indexOf('name: Drain server-side outbox')
    < drainWorkflow.indexOf('name: Check out receipt builder after the drainer terminal'),
'the existing drainer carries a pinned request identity and builds its terminal after the write attempt');
ok(evidenceWorkflow.includes('postgres:17')
  && evidenceWorkflow.includes('sabotage_cases=26')
  && evidenceWorkflow.includes('pre_cli_happy=PASS')
  && evidenceWorkflow.includes('post_cli_happy=PASS')
  && evidenceWorkflow.includes('GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_BEGIN')
  && evidenceWorkflow.includes('GRAPHICS_F2_TRIGGER_EXECUTE_ROLLBACK_SQL_BEGIN')
  && evidenceWorkflow.includes('graphics_f2_rollback')
  && evidenceWorkflow.includes("sed '1d;$d;/^```/d'")
  && evidenceWorkflow.includes('actions/workflows/linear-outbound-drain.yml/runs')
  && evidenceWorkflow.includes('-f head_sha="${{ github.sha }}"')
  && evidenceWorkflow.includes('test "$history_exhausted" = true')
  && evidenceWorkflow.includes('actions/runs/$run_id/attempts/$attempt')
  && evidenceWorkflow.includes('latest_run_attempt')
  && evidenceWorkflow.includes('--scheduled-sequence-receipt=')
  && evidenceWorkflow.includes('GRAPHICS_F2_READ_ONLY')
  && !/node scripts\/graphics-f2-evidence\.js[\s\S]{0,500}\$\{\{ inputs\.(?:binder|confirm|expected)/.test(evidenceWorkflow),
'the hosted lane proves PostgreSQL 17 sabotage and keeps operator inputs out of shell source interpolation');
const productionJob = evidenceWorkflow.split('  production-read-only-receipt:')[1] || '';
const productionJobEnv = (productionJob.match(/\n    env:\n([\s\S]*?)\n    steps:/) || [])[1] || '';
ok(!/F2_DATABASE_URL|SUPABASE_ACCESS_TOKEN|LINEAR_MIRROR_API_KEY|GH_TOKEN/.test(productionJobEnv)
  && /name: Pin the deployed[\s\S]*?env:\n\s+SUPABASE_ACCESS_TOKEN:/.test(productionJob)
  && /name: Obtain the correlation-bound[\s\S]*?env:\n\s+LINEAR_MIRROR_API_KEY:/.test(productionJob)
  && /name: Emit the bounded[\s\S]*?env:\n\s+F2_DATABASE_URL:/.test(productionJob),
'production credentials are step-scoped to their single read-only consumers');
ok(/create table public\.mirror_outbox/.test(proofSql)
  && !/uzltbbrjidmjwwfakwve/.test(proofSql),
'the proof fixture is disposable and contains no production project identity');
const revokeStatements = triggerExecuteRevokeSql.match(/^\s*revoke\s+/gim) || [];
ok(revokeStatements.length === 1
  && /revoke execute on function public\.track_b_enqueue_outbound_intent\(\) from public;/i.test(
    triggerExecuteRevokeSql,
  )
  && /graphics_f2_existing_trigger_boundary_invalid/.test(triggerExecuteRevokeSql)
  && /graphics_f2_existing_trigger_changed_by_revoke/.test(triggerExecuteRevokeSql)
  && /other_public_security_definer/.test(triggerExecuteRevokeSql)
  && !/^\s*(?:grant|insert|update|delete|merge|truncate|alter|drop|create)\b/im.test(
    triggerExecuteRevokeSql.replace(/^\s*--.*$/gm, ''),
  ),
'the reviewed runbook action changes one exact PUBLIC EXECUTE ACL and audits the trigger plus sweep');
ok((triggerExecuteRollbackSql.match(/^\s*grant\s+/gim) || []).length === 1
  && /7a28c4675cbdeee06539d1c5115fc08f46ba5ba6e6a5d84bc12ab654a4d5381e/.test(
    triggerExecuteRollbackSql,
  )
  && /d5561965a9a8a7ef60103f165678cbda532e1cd064bdbc831a68fdafbbcebe1e/.test(
    triggerExecuteRollbackSql,
  )
  && /graphics_f2_public_execute_rollback_function_drift/.test(triggerExecuteRollbackSql)
  && /graphics_f2_public_execute_rollback_trigger_drift/.test(triggerExecuteRollbackSql)
  && /graphics_f2_public_execute_rollback_readback_invalid/.test(triggerExecuteRollbackSql),
'the owner-only inverse revalidates exact function and trigger identities before and after re-grant');
ok([false, true, 1, {}].every(value => {
  try {
    snapshotSql('1', '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:02.000Z', value);
    return false;
  } catch (error) {
    return error instanceof GateError && error.code === 'write_window_lower_bound_invalid';
  }
}), 'the snapshot boundary rejects every non-null non-string value without coercion');

function response(mode, eventId, startedAt, finishedAt, counts = {}) {
  return {
    ok: true,
    event_id: eventId,
    mode,
    test_override: false,
    legacy_parity_enabled: false,
    targeted: false,
    started_at: startedAt,
    finished_at: finishedAt,
    counts: {
      enqueued: 0,
      shadow_ok: 0,
      written: 0,
      failed: 0,
      retried: 0,
      echo_dropped: 0,
      stale_dropped: 0,
      tolerated_historical: 0,
      skipped: 0,
      paused: 0,
      legacy_parity_written: 0,
      legacy_parity_paused: 0,
      shadow_vs_actual_divergence: 0,
      ...counts,
    },
    backlog: { video: 0, graphics: 0 },
    authority: { video: 'linear', graphics: 'linear' },
    oldest_pending_minutes: { video: null, graphics: null },
    oldest_pending_alert_threshold_minutes: 30,
    oldest_pending_alert_teams: [],
    alerts: {
      failed_write: false,
      backlog_growth: false,
      write_volume_spike: false,
      shadow_mismatch: false,
      oldest_pending_age: false,
    },
  };
}

function terminalFor({ mode, eventId, runId, startedAt, finishedAt, releaseSha, runAttempt = '1' }) {
  const correlationId = deterministicCorrelation(releaseSha, runId, runAttempt);
  const body = Buffer.from(JSON.stringify(response(mode, eventId, startedAt, finishedAt)));
  return buildDrainerTerminal({
    context: {
      release_sha: releaseSha,
      repository: 'sidney-afk/client-analytics',
      workflow_run_id: runId,
      workflow_run_attempt: runAttempt,
      workflow_event: 'schedule',
      correlation_id: correlationId,
      http_status: '200',
    },
    headersBytes: Buffer.from('HTTP/2 200\r\nsb-request-id: req-graphics-f2-proof-0001\r\n'),
    bodyBytes: body,
  });
}

function credential(terminal, evidenceRunId, observedAt = null) {
  return {
    schema: CREDENTIAL_SCHEMA,
    receipt_type: 'linear_graphql_viewer_accepted',
    accepted: true,
    correlation_id: terminal.correlation_id,
    release_sha: terminal.release_sha,
    drainer_workflow_run_id: terminal.dispatch.workflow_run_id,
    drainer_workflow_run_attempt: terminal.dispatch.workflow_run_attempt,
    evidence_workflow_run_id: evidenceRunId,
    evidence_workflow_run_attempt: '1',
    viewer_identity_sha256: sha256('linear-viewer-proof'),
    observed_at: observedAt || terminal.drainer_execution.finished_at,
    mutation_attempted: false,
  };
}

function observer(terminal, releaseSha) {
  return {
    id: terminal.dispatch.workflow_run_id,
    run_attempt: terminal.dispatch.workflow_run_attempt,
    event: terminal.dispatch.workflow_event,
    status: 'completed',
    conclusion: 'success',
    head_sha: releaseSha,
    path: '.github/workflows/linear-outbound-drain.yml',
  };
}

function evidenceObserver(runId, releaseSha, completedAt) {
  return {
    id: runId,
    run_attempt: '1',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: releaseSha,
    path: '.github/workflows/graphics-f2-evidence.yml',
    updated_at: completedAt,
  };
}

function scheduledSequence(terminal, extraRuns = []) {
  const runs = [
    {
      id: '200000001',
      run_attempt: '1',
      event: 'schedule',
      status: 'completed',
      conclusion: 'success',
      head_sha: terminal.release_sha,
      path: '.github/workflows/linear-outbound-drain.yml',
      created_at: '2026-08-02T13:02:00.000Z',
      run_started_at: '2026-08-02T13:02:05.000Z',
    },
    ...extraRuns,
    {
      id: terminal.dispatch.workflow_run_id,
      run_attempt: terminal.dispatch.workflow_run_attempt,
      event: 'schedule',
      status: 'completed',
      conclusion: 'success',
      head_sha: terminal.release_sha,
      path: '.github/workflows/linear-outbound-drain.yml',
      created_at: '2026-08-02T13:04:30.000Z',
      run_started_at: '2026-08-02T13:04:40.000Z',
    },
  ].map(run => ({
    ...run,
    latest_run_attempt: run.latest_run_attempt || run.run_attempt,
  }));
  return {
    schema: 'syncview.graphics-f2-scheduled-sequence.v3',
    workflow_path: '.github/workflows/linear-outbound-drain.yml',
    release_sha: terminal.release_sha,
    history_exhausted: true,
    base_run_count: new Set(runs.map(run => run.id)).size,
    lower_bound_pre_completed_at: '2026-08-02T13:03:00.000Z',
    boundary_witness_created_at: '2026-08-02T13:02:00.000Z',
    selected_run_id: terminal.dispatch.workflow_run_id,
    runs,
  };
}

function fingerprint(releaseSha) {
  return {
    schema_version: 1,
    pinned_sha: releaseSha,
    project_ref: 'uzltbbrjidmjwwfakwve',
    mode: 'live-read-only',
    results: ['linear-outbound'].map((slug, index) => ({
      slug,
      result: 'PASS',
      status: 'ACTIVE',
      version: index + 1,
      verify_jwt: false,
      expected_fingerprint: sha256(`${slug}-source`),
      live_fingerprint: sha256(`${slug}-source`),
      expected_entrypoint: `functions/${slug}/index.ts`,
      live_entrypoint: `functions/${slug}/index.ts`,
      entrypoint_match: true,
      expected_files: 1,
      live_files: 1,
    })),
    summary: { pass: 1, fail: 0, error: 0 },
  };
}

function shellSql(sql) {
  const result = spawnSync('psql', ['-X', '--quiet', '--set', 'ON_ERROR_STOP=1', '--file', '-'], {
    input: sql,
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`disposable SQL failed: ${String(result.stderr).trim()}`);
  }
}

function shellSqlAsTriggerInvoker(sql) {
  const result = spawnSync('psql', ['-X', '--quiet', '--set', 'ON_ERROR_STOP=1', '--file', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGUSER: 'graphics_f2_trigger_invoker',
      PGPASSWORD: 'graphics-f2-trigger-proof',
    },
    windowsHide: true,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`disposable trigger SQL failed: ${String(result.stderr).trim()}`);
  }
}

function shellSqlAsEvidenceRoleResult(sql) {
  const result = spawnSync('psql', ['-X', '--quiet', '--set', 'ON_ERROR_STOP=1', '--file', '-'], {
    input: sql,
    encoding: 'utf8',
    env: {
      ...process.env,
      PGUSER: 'graphics_f2_readonly',
      PGPASSWORD: 'graphics-f2-proof',
      PGDATABASE: 'graphics_f2',
    },
    windowsHide: true,
  });
  return result;
}

function shellSqlAsEvidenceRole(sql) {
  const result = shellSqlAsEvidenceRoleResult(sql);
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`disposable evidence-role SQL failed: ${String(result.stderr).trim()}`);
  }
}

function shellScalar(sql) {
  const result = spawnSync('psql', [
    '-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1',
    '--command', sql,
  ], { encoding: 'utf8', env: process.env, windowsHide: true });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`disposable scalar SQL failed: ${String(result.stderr).trim()}`);
  }
  return String(result.stdout).trim();
}

function writeCliFixture(directory, name, value) {
  const target = path.join(directory, name);
  fs.writeFileSync(target, `${stableJson(value)}\n`, { mode: 0o600 });
  return target;
}

function runEvidenceCli({
  root, mode, terminal, releaseSha, evidenceRunId,
  preReceiptFile = null, preEvidenceRunId = '', preObserverValue = null,
  scheduledSequenceValue = null,
}) {
  const directory = fs.mkdtempSync(path.join(root, `${mode}-`));
  const terminalFile = writeCliFixture(directory, 'terminal.json', terminal);
  const observerFile = writeCliFixture(directory, 'observer.json', observer(terminal, releaseSha));
  const credentialFile = writeCliFixture(
    directory, 'credential.json', credential(terminal, evidenceRunId),
  );
  const fingerprintFile = writeCliFixture(directory, 'fingerprint.json', fingerprint(releaseSha));
  const outputFile = path.join(directory, 'receipt.json');
  const args = [
    path.join(ROOT, 'scripts', 'graphics-f2-evidence.js'),
    mode,
    `--release-sha=${releaseSha}`,
    '--binder=graphics-f2-proof-binder-0001',
    `--evidence-run-id=${evidenceRunId}`,
    '--evidence-run-attempt=1',
    `--pre-evidence-run-id=${preEvidenceRunId}`,
    `--drainer-receipt=${terminalFile}`,
    `--observer-receipt=${observerFile}`,
    `--credential-receipt=${credentialFile}`,
    `--function-fingerprint=${fingerprintFile}`,
    '--expected-legacy-parity-written=0',
    '--legacy-parity-ack-sha256=',
    '--require-postgres-17=true',
    '--allow-disposable=true',
    `--output=${outputFile}`,
  ];
  if (mode === 'post-f2') {
    args.push(`--pre-receipt=${preReceiptFile}`);
    args.push(`--pre-observer-receipt=${writeCliFixture(
      directory, 'pre-observer.json', preObserverValue,
    )}`);
    args.push(`--scheduled-sequence-receipt=${writeCliFixture(
      directory, 'scheduled-sequence.json', scheduledSequenceValue,
    )}`);
  }
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    env: process.env,
    windowsHide: true,
  });
  if (result.status !== 0 || result.error || result.signal) {
    throw new Error(`evidence CLI ${mode} failed: ${String(result.stdout).trim()} ${String(result.stderr).trim()}`);
  }
  return {
    file: outputFile,
    receipt: JSON.parse(fs.readFileSync(outputFile, 'utf8')),
  };
}

function insertSummary(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  const result = spawnSync('psql', [
    '-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1',
    '--command', `insert into public.deliverable_events(action,source,payload)
      values ('linear_outbound_summary','outbound',convert_from(decode('${encoded}','base64'),'UTF8')::jsonb)
      returning id;`,
  ], { encoding: 'utf8', env: process.env, windowsHide: true });
  if (result.status !== 0) throw new Error(String(result.stderr));
  return Number(String(result.stdout).trim());
}

function summaryFromResponse(value) {
  const copy = JSON.parse(JSON.stringify(value));
  delete copy.event_id;
  return copy;
}

function receiptOptions({
  mode, terminal, releaseSha, snapshot, preReceiptBytes = null, observerValue = null,
  evidenceRunId = null, preEvidenceRunId = null, preObserverValue = null,
  credentialValue = null, scheduledSequenceValue = null,
}) {
  const currentEvidenceRunId = evidenceRunId
    || (mode === 'pre-f2' ? '200000002' : '200000006');
  const boundPreRunId = preEvidenceRunId || '200000002';
  const proofSnapshot = mode === 'post-f2' && snapshot.write_window_lower_bound == null
    ? { ...snapshot, write_window_lower_bound: '2026-08-02T13:03:00.000Z' }
    : snapshot;
  return {
    mode,
    terminal,
    releaseSha,
    binder: 'graphics-f2-proof-binder-0001',
    evidenceRunId: currentEvidenceRunId,
    evidenceRunAttempt: '1',
    preEvidenceRunId: boundPreRunId,
    expectedLegacyParity: 0,
    legacyParityAck: '',
    observer: observerValue || observer(terminal, releaseSha),
    credential: credentialValue || credential(terminal, currentEvidenceRunId),
    fingerprint: fingerprint(releaseSha),
    snapshot: proofSnapshot,
    preReceiptBytes,
    preObserver: preObserverValue
      || evidenceObserver(boundPreRunId, releaseSha, '2026-08-02T13:03:00.000Z'),
    scheduledSequence: mode === 'post-f2'
      ? (scheduledSequenceValue || scheduledSequence(terminal)) : null,
    requirePostgres17: true,
  };
}

if (!process.argv.includes('--postgres-proof')) {
  const releaseSha = 'a'.repeat(40);
  const unitResponse = response(
    'off', 1, '2026-08-02T12:00:00.000Z', '2026-08-02T12:00:02.000Z',
  );
  const terminal = terminalFor({
    mode: 'off', eventId: 1, runId: '123456789', releaseSha,
    startedAt: '2026-08-02T12:00:00.000Z', finishedAt: '2026-08-02T12:00:02.000Z',
  });
  ok(terminal.schema === 'syncview.graphics-f2-drainer-terminal.v1'
    && terminal.correlation_id === `graphics-f2:${releaseSha}:123456789:1`,
  'the terminal artifact binds dispatch, request, and drainer response');
  const publicText = stableJson(terminal);
  ok(!/authorization|api[_-]?key|client_slug|dedup_key|linear_result|viewer-proof/i.test(publicText),
  'the bounded terminal artifact exposes no credential, row identity, payload, or actor value');
  const unitSnapshot = {
    server_version_num: 170000,
    transaction_read_only: 'on',
    write_window_started_at: '2026-08-02T12:00:00.000Z',
    write_window_lower_bound: null,
    connection_role: 'graphics_f2_readonly',
    database_role: {
      current_user: 'graphics_f2_readonly',
      session_user: 'graphics_f2_readonly',
      is_superuser: false,
      can_create_role: false,
      can_create_database: false,
      can_replicate: false,
      can_bypass_rls: false,
      owns_current_database: false,
      can_create_current_database: false,
      role_membership_count: 0,
      required_select: true,
      effective_select_relation_count: 4,
      direct_select_relation_count: 4,
      required_direct_select_count: 4,
      full_visibility_policy_count: 4,
      can_write_application_tables: false,
      can_write_application_columns: false,
      direct_function_execute_privilege_count: 0,
      application_function_execute_privileges: [],
      can_use_application_sequences: false,
      can_create_application_schema_object: false,
    },
    flags: [
      {
        key: 'linear_outbound_enabled', value: { mode: 'off' },
        updated_at: '2026-08-02T11:50:00.000Z',
      },
      {
        key: 'prod_authority', value: { video: 'linear', graphics: 'linear' },
        updated_at: '2026-08-02T11:50:00.000Z',
      },
    ],
    outbound_flip: null,
    outbound_transitions: [],
    residue_rows: [],
    summary_event: {
      id: '1', action: 'linear_outbound_summary', source: 'outbound',
      payload: summaryFromResponse(unitResponse),
    },
    written_rows: [],
  };
  const unitReceipt = buildEvidenceReceipt(receiptOptions({
    mode: 'pre-f2', terminal, releaseSha, snapshot: unitSnapshot,
  }));
  ok(unitReceipt.status === 'PASS'
    && unitReceipt.failed_gates.length === 0
    && unitReceipt.residue.exact_count === 0
    && unitReceipt.residue.exact_per_team.video === 0
    && unitReceipt.residue.exact_per_team.graphics === 0,
  'the complete bounded pre-f2 contract passes against a synthetic read-only snapshot');
  console.log(`Graphics F2 source guards passed (${passed})`);
  process.exit(0);
}

const cliProofRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphics-f2-cli-proof-'));
process.on('exit', () => fs.rmSync(cliProofRoot, { recursive: true, force: true }));
const releaseSha = 'b'.repeat(40);
const preTimes = ['2026-08-02T13:00:00.000Z', '2026-08-02T13:00:02.000Z'];
const preResponse = response('off', 1, preTimes[0], preTimes[1]);
const preEventId = insertSummary(summaryFromResponse(preResponse));
assert.equal(preEventId, 1);
const preTerminal = terminalFor({
  mode: 'off', eventId: preEventId, runId: '200000001', releaseSha,
  startedAt: preTimes[0], finishedAt: preTimes[1],
});
const cliPre = runEvidenceCli({
  root: cliProofRoot,
  mode: 'pre-f2',
  terminal: preTerminal,
  releaseSha,
  evidenceRunId: '200000002',
});
ok(cliPre.receipt.status === 'PASS'
  && cliPre.receipt.failed_gates.length === 0
  && cliPre.receipt.postgres.status === 'PASS'
  && cliPre.receipt.postgres.transaction_read_only === 'on'
  && cliPre.receipt.postgres.direct_function_execute_privileges === false
  && cliPre.receipt.postgres.public_security_definer_execute === false
  && cliPre.receipt.postgres.public_security_definer_direct_invocation === false
  && cliPre.receipt.postgres.accepted_public_execute.exact_count === 2
  && cliPre.receipt.postgres.accepted_public_execute.classifications.every(
    row => row.grant_source === 'PUBLIC' && row.security_definer === false,
  )
  && cliPre.receipt.postgres.server_version_num >= 170000,
'the pre-f2 CLI happy path reaches PASS with postgres_read_only evaluated on PostgreSQL 17');
const preSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: preEventId,
  startedAt: preTimes[0],
  finishedAt: preTimes[1],
  allowDisposable: true,
});
const preReceipt = buildEvidenceReceipt(receiptOptions({
  mode: 'pre-f2', terminal: preTerminal, releaseSha, snapshot: preSnapshot,
}));
ok(preReceipt.status === 'PASS'
  && preReceipt.mode === 'pre-f2'
  && preReceipt.residue.exact_count === 0
  && preReceipt.residue.exact_per_team.video === 0
  && preReceipt.residue.exact_per_team.graphics === 0
  && preReceipt.postgres.server_version_num >= 170000,
'the clean pre-f2 receipt passes on PostgreSQL 17 with exact zero residue');
const preReceiptBytes = Buffer.from(`${stableJson(preReceipt)}\n`, 'utf8');

shellSql(`begin;
  update public.syncview_runtime_flags
    set value='{"mode":"live"}'::jsonb, updated_at='2026-08-02T13:04:00.000Z'
    where key='linear_outbound_enabled';
  insert into public.flag_flips(key,old_value,new_value,actor,ts)
    values ('linear_outbound_enabled','{"mode":"off"}'::jsonb,'{"mode":"live"}'::jsonb,
      'owner-proof','2026-08-02T13:04:00.100Z');
  commit;`);
const postTimes = ['2026-08-02T13:05:00.000Z', '2026-08-02T13:05:02.000Z'];
const postResponse = response('live', 2, postTimes[0], postTimes[1]);
const postEventId = insertSummary(summaryFromResponse(postResponse));
assert.equal(postEventId, 2);
const postTerminal = terminalFor({
  mode: 'live', eventId: postEventId, runId: '200000005', releaseSha,
  startedAt: postTimes[0], finishedAt: postTimes[1],
});
const cliPost = runEvidenceCli({
  root: cliProofRoot,
  mode: 'post-f2',
  terminal: postTerminal,
  releaseSha,
  evidenceRunId: '200000006',
  preReceiptFile: cliPre.file,
  preEvidenceRunId: '200000002',
  preObserverValue: evidenceObserver('200000002', releaseSha, '2026-08-02T13:03:00.000Z'),
  scheduledSequenceValue: scheduledSequence(postTerminal),
});
const cliPreReceiptBytes = fs.readFileSync(cliPre.file);
ok(cliPost.receipt.status === 'PASS'
  && cliPost.receipt.failed_gates.length === 0
  && cliPost.receipt.postgres.status === 'PASS'
  && cliPost.receipt.postgres.transaction_read_only === 'on'
  && cliPost.receipt.postgres.accepted_public_execute.exact_count === 2
  && cliPost.receipt.postgres.accepted_public_execute.classifications.every(
    row => row.grant_source === 'PUBLIC',
  )
  && cliPost.receipt.postgres.server_version_num >= 170000
  && cliPost.receipt.pre_receipt_sha256 === sha256(cliPreReceiptBytes),
'the post-f2 CLI happy path reaches PASS with postgres_read_only evaluated on PostgreSQL 17');
const postSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const postReceipt = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: postSnapshot, preReceiptBytes,
}));
ok(postReceipt.status === 'PASS'
  && postReceipt.pre_receipt_sha256 === sha256(preReceiptBytes)
  && postReceipt.handoff_order.pre_completed_before_f2 === true
  && postReceipt.handoff_order.f2_before_post_drainer === true
  && postReceipt.writes.normal_lane_count === 0
  && postReceipt.writes.legacy_parity_count === 0,
'the clean post-f2 receipt binds the exact pre receipt and proves zero normal writes');

ok(shellScalar(`select count(*)
  from pg_proc p
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
  where p.oid = 'public.track_b_enqueue_outbound_intent()'::regprocedure
    and acl.grantee = 0::oid
    and acl.privilege_type = 'EXECUTE';`) === '0'
  && shellScalar(`select count(*)
    from pg_trigger t
    where t.tgrelid = 'public.deliverable_events'::regclass
      and t.tgfoid = 'public.track_b_enqueue_outbound_intent()'::regprocedure
      and t.tgname = 'track_b_outbound_intent_after'
      and not t.tgisinternal
      and t.tgenabled = 'O';`) === '1',
'the exact PUBLIC grant is absent while the existing trigger binding remains enabled');
shellSqlAsTriggerInvoker(`insert into public.deliverable_events(action, source, payload)
  values ('graphics_f2_trigger_fire_probe', 'proof', '{}'::jsonb);`);
ok(shellScalar(`select count(*)
  from public.graphics_f2_trigger_fire_receipts r
  join public.deliverable_events e on e.id = r.event_id
  where e.action = 'graphics_f2_trigger_fire_probe'
    and e.source = 'proof'
    and r.fired_as = current_user;`) === '1',
'the pre-existing SECURITY DEFINER trigger still fires as its owner after PUBLIC EXECUTE is revoked');

const queuedSequence = scheduledSequence(postTerminal);
const queuedSelected = queuedSequence.runs.find(
  run => run.id === postTerminal.dispatch.workflow_run_id,
);
queuedSelected.created_at = '2026-08-02T13:03:50.000Z';
queuedSelected.run_started_at = '2026-08-02T13:04:40.000Z';
const queuedPostReceipt = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: postSnapshot,
  preReceiptBytes, scheduledSequenceValue: queuedSequence,
}));
ok(queuedPostReceipt.status === 'PASS'
  && queuedPostReceipt.handoff_order.selected_is_first_scheduled_after_f2 === true,
'a queued scheduled run created before F2 may qualify when it is the first run started after F2');

const oldPostTerminal = terminalFor({
  mode: 'live', eventId: postEventId, runId: '199999999', releaseSha,
  startedAt: postTimes[0], finishedAt: postTimes[1],
});
const oldPostSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: oldPostTerminal, releaseSha,
  snapshot: postSnapshot, preReceiptBytes,
}));
ok(oldPostSabotage.status === 'FAIL'
  && oldPostSabotage.failed_gates.some(row => row.code === 'post_drainer_not_after_pre_evidence'),
'an older live drainer cannot satisfy the ordered pre-F2-post receipt chain');

const skippedFirstSequence = scheduledSequence(postTerminal, [{
  id: '200000003',
  run_attempt: '1',
  event: 'schedule',
  status: 'completed',
  conclusion: 'failure',
  head_sha: releaseSha,
  path: '.github/workflows/linear-outbound-drain.yml',
  created_at: '2026-08-02T13:04:20.000Z',
  run_started_at: '2026-08-02T13:04:25.000Z',
}]);
const skippedFirstSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: postSnapshot,
  preReceiptBytes, scheduledSequenceValue: skippedFirstSequence,
}));
ok(skippedFirstSabotage.status === 'FAIL'
  && skippedFirstSabotage.failed_gates.some(
    row => row.code === 'post_drainer_not_first_scheduled_after_f2',
  ),
'a later successful drainer cannot hide an earlier scheduled post-F2 failure');

const rerunTerminal = terminalFor({
  mode: 'live', eventId: postEventId, runId: '200000005', runAttempt: '2', releaseSha,
  startedAt: postTimes[0], finishedAt: postTimes[1],
});
const rerunSequence = scheduledSequence(rerunTerminal, [{
  id: '200000005',
  run_attempt: '1',
  latest_run_attempt: '2',
  event: 'schedule',
  status: 'completed',
  conclusion: 'failure',
  head_sha: releaseSha,
  path: '.github/workflows/linear-outbound-drain.yml',
  created_at: '2026-08-02T13:04:30.000Z',
  run_started_at: '2026-08-02T13:04:35.000Z',
}]);
const rerunSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: rerunTerminal, releaseSha, snapshot: postSnapshot,
  preReceiptBytes, scheduledSequenceValue: rerunSequence,
}));
ok(rerunSabotage.status === 'FAIL'
  && rerunSabotage.failed_gates.some(
    row => row.code === 'post_drainer_not_first_scheduled_after_f2',
  ),
'a successful rerun cannot hide the earlier attempt of the same scheduled run');

const repeatedSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
ok(stableJson(repeatedSnapshot) === stableJson(postSnapshot),
'running the packaged capture leaves the disposable database byte-stable at its read surfaces');

shellSql(`insert into public.mirror_outbox(
    team, operation, status, test_only, legacy_parity, processed_at, linear_result
  ) values (
    'graphics', 'title', 'written', false, false, '2026-08-02T13:04:30.000Z',
    '{"mutation":"issueUpdate","issue_id":"linear-window-proof","mirror_actor_id":"linear-viewer-proof"}'::jsonb
  );`);
const omittedAttemptWriteSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const omittedAttemptWriteSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: omittedAttemptWriteSnapshot,
  preReceiptBytes,
}));
ok(omittedAttemptWriteSabotage.status === 'FAIL'
  && omittedAttemptWriteSabotage.failed_gates.some(row => row.code === 'normal_lane_write_present'),
'a normal write by an omitted older-run attempt anywhere after F2 cannot hide before the selected run');
shellSql("delete from public.mirror_outbox where status = 'written';");

shellSql(`insert into public.mirror_outbox(
    team, operation, status, test_only, legacy_parity, processed_at, linear_result
  ) values (
    'graphics', 'title', 'written', false, false, '2026-08-02T13:04:30.000Z',
    '{"mutation":"issueUpdate","issue_id":"linear-repeat-flip","mirror_actor_id":"linear-viewer-proof"}'::jsonb
  );
  update public.syncview_runtime_flags
    set value='{"mode":"off"}'::jsonb, updated_at='2026-08-02T13:04:40.000Z'
    where key='linear_outbound_enabled';
  insert into public.flag_flips(key,old_value,new_value,actor,ts)
    values ('linear_outbound_enabled','{"mode":"live"}'::jsonb,'{"mode":"off"}'::jsonb,
      'owner-proof','2026-08-02T13:04:40.000Z');
  update public.syncview_runtime_flags
    set value='{"mode":"live"}'::jsonb, updated_at='2026-08-02T13:04:50.000Z'
    where key='linear_outbound_enabled';
  insert into public.flag_flips(key,old_value,new_value,actor,ts)
    values ('linear_outbound_enabled','{"mode":"off"}'::jsonb,'{"mode":"live"}'::jsonb,
      'owner-proof','2026-08-02T13:04:50.000Z');`);
const repeatedFlipSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  writeWindowLowerBound: '2026-08-02T13:03:00.000Z',
  allowDisposable: true,
});
const repeatedFlipSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: repeatedFlipSnapshot,
  preReceiptBytes,
}));
ok(repeatedFlipSnapshot.outbound_transitions.length === 3
  && repeatedFlipSnapshot.written_rows.length === 1
  && repeatedFlipSabotage.status === 'FAIL'
  && repeatedFlipSabotage.failed_gates.some(row => row.code === 'f2_transition_ambiguous'),
'repeated off/live transitions cannot re-anchor the F2 window past an earlier normal write');
shellSql(`delete from public.mirror_outbox where status = 'written';
  delete from public.flag_flips where id > 1;
  update public.syncview_runtime_flags
    set value='{"mode":"live"}'::jsonb, updated_at='2026-08-02T13:04:00.000Z'
    where key='linear_outbound_enabled';`);

shellSql(`insert into public.mirror_outbox(team,operation,status,test_only,legacy_parity)
  values ('video','title','pending',false,false),
         ('graphics','comment','failed',false,false);`);
const residueSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const residueSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha,
  snapshot: residueSnapshot, preReceiptBytes,
}));
ok(residueSabotage.status === 'FAIL'
  && residueSabotage.residue.exact_count === 2
  && residueSabotage.residue.exact_per_team.video === 1
  && residueSabotage.residue.exact_per_team.graphics === 1
  && residueSabotage.residue.classifications.length === 2
  && residueSabotage.failed_gates.some(row => row.code === 'residue_requires_owner_classification'),
'residue sabotage goes red with exact count, digest, and bounded classification');
shellSql('delete from public.mirror_outbox;');

const brokenTerminal = JSON.parse(JSON.stringify(postTerminal));
brokenTerminal.correlation_id = `${brokenTerminal.correlation_id}:broken`;
const correlationSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: brokenTerminal, releaseSha, snapshot: postSnapshot, preReceiptBytes,
}));
ok(correlationSabotage.status === 'FAIL'
  && correlationSabotage.failed_gates.some(row => row.code === 'drainer_correlation_broken'),
'broken dispatch/drainer correlation goes red');

const missingCredential = credential(postTerminal, '200000006');
delete missingCredential.viewer_identity_sha256;
const credentialSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: postSnapshot, preReceiptBytes,
  credentialValue: missingCredential,
}));
ok(credentialSabotage.status === 'FAIL'
  && credentialSabotage.failed_gates.some(row => row.code === 'credential_receipt_missing'),
'missing typed Linear credential receipt goes red');

const absentObserver = { ...observer(postTerminal, releaseSha), conclusion: null, status: 'in_progress' };
const observerSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: postSnapshot,
  preReceiptBytes, observerValue: absentObserver,
}));
ok(observerSabotage.status === 'FAIL'
  && observerSabotage.failed_gates.some(row => row.code === 'outside_observer_absent'),
'absent outside-n8n observer goes red');

const nonScheduledTerminal = JSON.parse(JSON.stringify(postTerminal));
nonScheduledTerminal.dispatch.workflow_event = 'workflow_dispatch';
const nonScheduledSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: nonScheduledTerminal, releaseSha, snapshot: postSnapshot,
  preReceiptBytes,
}));
ok(nonScheduledSabotage.status === 'FAIL'
  && nonScheduledSabotage.failed_gates.some(row => row.code === 'drainer_not_scheduled'),
'a manually dispatched drainer cannot satisfy the scheduled-run evidence contract');

shellSql(`create role graphics_f2_writer;
  grant update on public.mirror_outbox to graphics_f2_writer;
  grant graphics_f2_writer to graphics_f2_readonly with inherit false, set true;`);
const membershipSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const membershipSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: membershipSnapshot,
  preReceiptBytes,
}));
ok(membershipSabotage.status === 'FAIL'
  && membershipSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'a non-inherited but settable writer-role membership cannot certify a read-only credential');
shellSql('revoke graphics_f2_writer from graphics_f2_readonly;');

shellSql('grant select on public.graphics_f2_unrelated_relation to graphics_f2_readonly;');
const extraSelectSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const extraSelectSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: extraSelectSnapshot,
  preReceiptBytes,
}));
ok(extraSelectSabotage.status === 'FAIL'
  && extraSelectSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'SELECT on a fifth public application relation cannot satisfy the exact four-relation allowlist');
shellSql('revoke select on public.graphics_f2_unrelated_relation from graphics_f2_readonly;');

shellSql('grant create on database graphics_f2 to graphics_f2_readonly;');
const databaseCreateSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const databaseCreateSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: databaseCreateSnapshot,
  preReceiptBytes,
}));
ok(databaseCreateSabotage.status === 'FAIL'
  && databaseCreateSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'database-level CREATE cannot satisfy the dedicated read-only role contract');
shellSql('revoke create on database graphics_f2 from graphics_f2_readonly;');

shellSql('grant update (id) on public.graphics_f2_unrelated_relation to graphics_f2_readonly;');
const columnWriteSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const columnWriteSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: columnWriteSnapshot,
  preReceiptBytes,
}));
ok(columnWriteSabotage.status === 'FAIL'
  && columnWriteSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'a column-level UPDATE grant cannot satisfy the dedicated read-only role contract');
shellSql('revoke update (id) on public.graphics_f2_unrelated_relation from graphics_f2_readonly;');

shellSql('grant maintain on public.graphics_f2_unrelated_relation to graphics_f2_readonly;');
const maintainSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const maintainSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: maintainSnapshot,
  preReceiptBytes,
}));
ok(maintainSabotage.status === 'FAIL'
  && maintainSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'an effective PostgreSQL 17 MAINTAIN grant cannot satisfy the read-only role contract');
shellSql('revoke maintain on public.graphics_f2_unrelated_relation from graphics_f2_readonly;');

shellSql('grant maintain on public.graphics_f2_unrelated_materialized to graphics_f2_readonly;');
const materializedMaintainSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const materializedMaintainSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: materializedMaintainSnapshot,
  preReceiptBytes,
}));
ok(materializedMaintainSabotage.status === 'FAIL'
  && materializedMaintainSabotage.failed_gates.some(
    row => row.code === 'postgres_role_not_read_only',
  ),
'MAINTAIN on an application materialized view cannot satisfy the read-only role contract');
shellSql('revoke maintain on public.graphics_f2_unrelated_materialized from graphics_f2_readonly;');

shellSql('grant select on sequence public.mirror_outbox_id_seq to graphics_f2_readonly;');
const sequenceSelectSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const sequenceSelectSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: sequenceSelectSnapshot,
  preReceiptBytes,
}));
ok(sequenceSelectSabotage.status === 'FAIL'
  && sequenceSelectSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'SELECT on an application sequence cannot satisfy the four-grant-only role contract');
shellSql('revoke select on sequence public.mirror_outbox_id_seq from graphics_f2_readonly;');

let predefinedRoleRejected = false;
try {
  capturePostgresSnapshot({
    databaseUrl: `postgresql://pg_write_server_files:proof@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
    eventId: postEventId,
    startedAt: postTimes[0],
    finishedAt: postTimes[1],
  });
} catch (error) {
  predefinedRoleRejected = error instanceof GateError && error.code === 'database_target_invalid';
}
ok(predefinedRoleRejected,
'a login-enabled PostgreSQL predefined pg_ role is rejected before any connection attempt');

shellSql(`create function public.graphics_f2_direct_helper(value integer) returns integer
  language sql immutable security invoker
  as 'select value';
  revoke all on function public.graphics_f2_direct_helper(integer) from public;
  grant execute on function public.graphics_f2_direct_helper(integer) to graphics_f2_readonly;`);
const directExecuteSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const directExecuteSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: directExecuteSnapshot,
  preReceiptBytes,
}));
ok(directExecuteSabotage.status === 'FAIL'
  && directExecuteSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'a directly granted application function EXECUTE cannot satisfy the read-only role contract');
shellSql('drop function public.graphics_f2_direct_helper(integer);');

shellSql(`create function public.graphics_f2_public_definer_writer() returns void
  language sql security definer set search_path = pg_catalog, public
  as 'update public.graphics_f2_unrelated_relation set id = id';`);
const publicDefinerSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerSabotage.status === 'FAIL'
  && publicDefinerSabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'a PUBLIC-executable non-trigger SECURITY DEFINER function cannot satisfy the contract');
shellSql('drop function public.graphics_f2_public_definer_writer();');

shellSql(`create function public.graphics_f2_public_definer_window(value integer) returns integer
  language sql immutable window security definer set search_path = pg_catalog, public
  as 'select value';`);
const publicDefinerWindowSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerWindowSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerWindowSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerWindowSabotage.status === 'FAIL'
  && publicDefinerWindowSabotage.failed_gates.some(
    row => row.code === 'postgres_role_not_read_only',
  ),
'a PUBLIC-executable SECURITY DEFINER window function cannot satisfy the contract');
shellSql('drop function public.graphics_f2_public_definer_window(integer);');

shellSql(`create function public.graphics_f2_aggregate_trans(state bigint, value bigint)
  returns bigint
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    update public.graphics_f2_unrelated_relation set id = id;
    return coalesce(state, 0) + coalesce(value, 0);
  end;
  $$;
  revoke execute on function public.graphics_f2_aggregate_trans(bigint, bigint) from public;
  create aggregate public.graphics_f2_public_definer_aggregate(bigint) (
    sfunc = public.graphics_f2_aggregate_trans,
    stype = bigint,
    initcond = '0'
  );`);
shellSqlAsEvidenceRole(`begin read write;
  select public.graphics_f2_public_definer_aggregate(value)
  from (values (1::bigint)) as input(value);
  rollback;`);
const publicDefinerAggregateSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const aggregatePrivilege = publicDefinerAggregateSnapshot.database_role
  .application_function_execute_privileges.find(
    row => row.routine_kind === 'aggregate'
      && row.identity.includes('graphics_f2_public_definer_aggregate'),
  );
ok(aggregatePrivilege
  && aggregatePrivilege.granted_to_public === true
  && aggregatePrivilege.security_definer === true
  && aggregatePrivilege.security_definer_via_aggregate_support === true,
'an accessible aggregate inventories its revoked-direct SECURITY DEFINER support function');
const publicDefinerAggregateSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerAggregateSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerAggregateSabotage.status === 'FAIL'
  && publicDefinerAggregateSabotage.failed_gates.some(
    row => row.code === 'postgres_role_not_read_only',
  ),
'a PUBLIC-executable aggregate backed by a SECURITY DEFINER function cannot satisfy the contract');
shellSql(`drop aggregate public.graphics_f2_public_definer_aggregate(bigint);
  drop function public.graphics_f2_aggregate_trans(bigint, bigint);`);

shellSql(`create function public.graphics_f2_operator_writer(left_value bigint, right_value bigint)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    update public.graphics_f2_unrelated_relation set id = id;
    return left_value = right_value;
  end;
  $$;
  revoke execute on function public.graphics_f2_operator_writer(bigint, bigint) from public;
  create operator public.#=# (
    leftarg = bigint,
    rightarg = bigint,
    function = public.graphics_f2_operator_writer
  );`);
const publicDefinerOperatorAttempt = shellSqlAsEvidenceRoleResult(`begin read write;
  select 1 OPERATOR(public.#=#) 1;
  rollback;`);
const publicDefinerOperatorSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerOperatorSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerOperatorSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerOperatorAttempt.status !== 0
  && /permission denied for function graphics_f2_operator_writer/.test(
    String(publicDefinerOperatorAttempt.stderr),
  )
  && publicDefinerOperatorSabotage.status === 'PASS',
'an operator cannot bypass revoked direct EXECUTE on its SECURITY DEFINER implementation');
shellSql(`drop operator public.#=# (bigint, bigint);
  drop function public.graphics_f2_operator_writer(bigint, bigint);`);

shellSql(`create type public.graphics_f2_cast_source as (value bigint);
  create function public.graphics_f2_cast_writer(value public.graphics_f2_cast_source)
  returns bigint
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    update public.graphics_f2_unrelated_relation set id = id;
    return value.value;
  end;
  $$;
  revoke execute on function public.graphics_f2_cast_writer(public.graphics_f2_cast_source)
    from public;
  create cast (public.graphics_f2_cast_source as bigint)
    with function public.graphics_f2_cast_writer(public.graphics_f2_cast_source);`);
const publicDefinerCastAttempt = shellSqlAsEvidenceRoleResult(
  `begin read write;
  select row(7)::public.graphics_f2_cast_source::bigint;
  rollback;`,
);
const publicDefinerCastSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerCastSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerCastSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerCastAttempt.status !== 0
  && /permission denied for function graphics_f2_cast_writer/.test(
    String(publicDefinerCastAttempt.stderr),
  )
  && publicDefinerCastSabotage.status === 'PASS',
'a cast cannot bypass revoked direct EXECUTE on its SECURITY DEFINER implementation');
shellSql(`drop cast (public.graphics_f2_cast_source as bigint);
  drop function public.graphics_f2_cast_writer(public.graphics_f2_cast_source);
  drop type public.graphics_f2_cast_source;`);

shellSql(`create function public.graphics_f2_domain_writer(value bigint)
  returns boolean
  language plpgsql security definer set search_path = pg_catalog, public
  as $$
  begin
    update public.graphics_f2_unrelated_relation set id = id;
    return true;
  end;
  $$;
  revoke execute on function public.graphics_f2_domain_writer(bigint) from public;
  create domain public.graphics_f2_public_definer_domain as bigint
    check (public.graphics_f2_domain_writer(value));`);
const publicDefinerDomainAttempt = shellSqlAsEvidenceRoleResult(`begin read write;
  select 7::public.graphics_f2_public_definer_domain;
  rollback;`);
const publicDefinerDomainSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerDomainSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerDomainSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerDomainAttempt.status !== 0
  && /permission denied for function graphics_f2_domain_writer/.test(
    String(publicDefinerDomainAttempt.stderr),
  )
  && publicDefinerDomainSabotage.status === 'PASS',
'a domain constraint cannot bypass revoked direct EXECUTE on its SECURITY DEFINER implementation');
shellSql(`drop domain public.graphics_f2_public_definer_domain;
  drop function public.graphics_f2_domain_writer(bigint);`);

shellSql(`create type public.graphics_f2_public_definer_range;
  create function public.graphics_f2_range_canonical(
    value public.graphics_f2_public_definer_range
  ) returns public.graphics_f2_public_definer_range
  language internal immutable security definer
  as 'int4range_canonical';
  revoke execute on function public.graphics_f2_range_canonical(
    public.graphics_f2_public_definer_range
  ) from public;
  create type public.graphics_f2_public_definer_range as range (
    subtype = integer,
    canonical = public.graphics_f2_range_canonical,
    multirange_type_name = public.graphics_f2_public_definer_multirange
  );`);
const publicDefinerRangeAttempt = shellSqlAsEvidenceRoleResult(`begin read write;
  select public.graphics_f2_public_definer_range(1, 2);
  rollback;`);
console.log(`GRAPHICS_F2_RANGE_CANONICAL_PROBE result=${
  publicDefinerRangeAttempt.status === 0 ? 'invoked' : 'refused'
}`);
shellSql(`drop type public.graphics_f2_public_definer_range cascade;`);

shellSql('grant execute on function public.track_b_enqueue_outbound_intent() to public;');
const publicDefinerTriggerSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicDefinerTriggerSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicDefinerTriggerSnapshot,
  preReceiptBytes,
}));
ok(publicDefinerTriggerSabotage.status === 'FAIL'
  && publicDefinerTriggerSabotage.failed_gates.some(
    row => row.code === 'postgres_role_not_read_only',
  ),
'a PUBLIC-executable SECURITY DEFINER trigger function cannot satisfy the contract');
shellSql('revoke execute on function public.track_b_enqueue_outbound_intent() from public;');

shellSql('drop policy graphics_f2_readonly_outbox_select on public.mirror_outbox;');
const policySnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const policySabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: policySnapshot,
  preReceiptBytes,
}));
ok(policySabotage.status === 'FAIL'
  && policySabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'an incomplete all-rows RLS policy set cannot certify an exact inventory');

shellSql(`create role graphics_f2_other_reader;
  create policy graphics_f2_multi_outbox_select
    on public.mirror_outbox for select
    to graphics_f2_readonly, graphics_f2_other_reader using (true);`);
const multiRolePolicySnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const multiRolePolicySabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: multiRolePolicySnapshot,
  preReceiptBytes,
}));
ok(multiRolePolicySabotage.status === 'FAIL'
  && multiRolePolicySabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'an all-rows policy targeting the evidence role plus another role cannot satisfy the singleton policy contract');
shellSql('drop policy graphics_f2_multi_outbox_select on public.mirror_outbox;');

shellSql(`create policy graphics_f2_public_outbox_select
  on public.mirror_outbox for select to public using (true);`);
const publicPolicySnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
const publicPolicySabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: postTerminal, releaseSha, snapshot: publicPolicySnapshot,
  preReceiptBytes,
}));
ok(publicPolicySabotage.status === 'FAIL'
  && publicPolicySabotage.failed_gates.some(row => row.code === 'postgres_role_not_read_only'),
'a PUBLIC all-rows policy cannot substitute for a direct evidence-role policy');

for (const receipt of [
  preReceipt, postReceipt, queuedPostReceipt, oldPostSabotage, skippedFirstSabotage, residueSabotage,
  rerunSabotage, omittedAttemptWriteSabotage, repeatedFlipSabotage,
  correlationSabotage, credentialSabotage, observerSabotage, nonScheduledSabotage,
  membershipSabotage, extraSelectSabotage, databaseCreateSabotage,
  columnWriteSabotage, maintainSabotage, materializedMaintainSabotage,
  sequenceSelectSabotage, directExecuteSabotage, publicDefinerSabotage,
  publicDefinerWindowSabotage, publicDefinerTriggerSabotage,
  policySabotage, multiRolePolicySabotage, publicPolicySabotage,
]) {
  const text = stableJson(receipt);
  ok(!/client_slug|dedup_key|linear_result|actor|authorization|password|database_url|payload/i.test(text),
  'every public receipt remains bounded and private-row/credential free');
  ok(receipt.schema === EVIDENCE_SCHEMA, 'every proof result uses the versioned public receipt schema');
}

console.log(`GRAPHICS_F2_POSTGRES_17_PROOF_OK sabotage_cases=26 pre_cli_happy=PASS post_cli_happy=PASS assertions=${passed}`);
