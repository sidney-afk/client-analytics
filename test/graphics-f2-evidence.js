#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  CREDENTIAL_SCHEMA,
  DISPATCH_SCHEMA,
  EVIDENCE_SCHEMA,
  buildDrainerTerminal,
  buildEvidenceReceipt,
  capturePostgresSnapshot,
  deterministicCorrelation,
  sha256,
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
const observerSource = source('supabase/functions/linear-outbound-evidence/index.ts');
const drainWorkflow = source('.github/workflows/linear-outbound-drain.yml');
const evidenceWorkflow = source('.github/workflows/graphics-f2-evidence.yml');
const proofSql = source('scripts/graphics-f2-evidence-proof.sql');

ok(/begin transaction isolation level repeatable read read only;/.test(toolSource)
  && /current_setting\('transaction_read_only'\)/.test(toolSource),
'the production snapshot is mechanically REPEATABLE READ and READ ONLY');
ok(!/\b(?:insert|update|delete|merge|truncate|alter|drop|create)\b/i.test(
  toolSource.match(/function snapshotSql[\s\S]*?function databaseConnection/)[0]
    .replace(/function snapshotSql|function databaseConnection/g, '')
    .replace(/created_at|updated_at/g, ''),
), 'the evidence SQL contains no production mutation statement');
ok(observerSource.includes('query SyncViewGraphicsF2Credential { viewer { id } }')
  && !/query:\s*"mutation\b/i.test(observerSource)
  && observerSource.includes('mutation_attempted: false')
  && !observerSource.includes('createClient('),
'the credential sidecar performs one Linear read and has no database client or provider mutation');
ok(drainWorkflow.includes('X-Syncview-Correlation: $F2_CORRELATION_ID')
  && drainWorkflow.includes('linear-outbound-terminal-${{ github.run_id }}-${{ github.run_attempt }}')
  && drainWorkflow.includes('continue-on-error: true')
  && drainWorkflow.indexOf('name: Drain server-side outbox')
    < drainWorkflow.indexOf('name: Check out receipt builder after the drainer terminal'),
'the existing drainer carries a pinned request identity and remains operational if evidence-only observation is unavailable');
ok(evidenceWorkflow.includes('postgres:17')
  && evidenceWorkflow.includes('sabotage_cases=4')
  && evidenceWorkflow.includes('GRAPHICS_F2_READ_ONLY')
  && !/node scripts\/graphics-f2-evidence\.js[\s\S]{0,500}\$\{\{ inputs\.(?:binder|confirm|expected)/.test(evidenceWorkflow),
'the hosted lane proves PostgreSQL 17 sabotage and keeps operator inputs out of shell source interpolation');
const productionJob = evidenceWorkflow.split('  production-read-only-receipt:')[1] || '';
const productionJobEnv = (productionJob.match(/\n    env:\n([\s\S]*?)\n    steps:/) || [])[1] || '';
ok(!/F2_DATABASE_URL|SUPABASE_ACCESS_TOKEN|GH_TOKEN/.test(productionJobEnv)
  && /name: Pin both deployed[\s\S]*?env:\n\s+SUPABASE_ACCESS_TOKEN:/.test(productionJob)
  && /name: Emit the bounded[\s\S]*?env:\n\s+F2_DATABASE_URL:/.test(productionJob),
'production credentials are step-scoped to their single read-only consumers');
ok(/create table public\.mirror_outbox/.test(proofSql)
  && !/uzltbbrjidmjwwfakwve/.test(proofSql),
'the proof fixture is disposable and contains no production project identity');

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

function terminalFor({ mode, eventId, runId, startedAt, finishedAt, releaseSha }) {
  const runAttempt = '1';
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
    credential: {
      ok: true,
      schema: CREDENTIAL_SCHEMA,
      receipt_type: 'linear_graphql_viewer_accepted',
      accepted: true,
      correlation_id: correlationId,
      release_sha: releaseSha,
      workflow_run_id: runId,
      workflow_run_attempt: runAttempt,
      viewer_identity_sha256: sha256('linear-viewer-proof'),
      observed_at: startedAt,
      mutation_attempted: false,
    },
  });
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

function fingerprint(releaseSha) {
  return {
    schema_version: 1,
    pinned_sha: releaseSha,
    project_ref: 'uzltbbrjidmjwwfakwve',
    mode: 'live-read-only',
    results: ['linear-outbound', 'linear-outbound-evidence'].map((slug, index) => ({
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
    summary: { pass: 2, fail: 0, error: 0 },
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

function receiptOptions({ mode, terminal, releaseSha, snapshot, preReceiptBytes = null, observerValue = null }) {
  return {
    mode,
    terminal,
    releaseSha,
    binder: 'graphics-f2-proof-binder-0001',
    expectedLegacyParity: 0,
    legacyParityAck: '',
    observer: observerValue || observer(terminal, releaseSha),
    fingerprint: fingerprint(releaseSha),
    snapshot,
    preReceiptBytes,
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
    && terminal.correlation_id === `graphics-f2:${releaseSha}:123456789:1`
    && terminal.linear_credential_receipt.accepted === true,
  'the terminal artifact binds dispatch, request, drainer response, and typed credential');
  const publicText = stableJson(terminal);
  ok(!/authorization|api[_-]?key|client_slug|dedup_key|linear_result|viewer-proof/i.test(publicText),
  'the bounded terminal artifact exposes no credential, row identity, payload, or actor value');
  const unitSnapshot = {
    server_version_num: 170000,
    transaction_read_only: 'on',
    flags: [
      { key: 'linear_outbound_enabled', value: { mode: 'off' } },
      { key: 'prod_authority', value: { video: 'linear', graphics: 'linear' } },
    ],
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

const releaseSha = 'b'.repeat(40);
const preTimes = ['2026-08-02T13:00:00.000Z', '2026-08-02T13:00:02.000Z'];
const preResponse = response('off', 1, preTimes[0], preTimes[1]);
const preEventId = insertSummary(summaryFromResponse(preResponse));
assert.equal(preEventId, 1);
const preTerminal = terminalFor({
  mode: 'off', eventId: preEventId, runId: '200000001', releaseSha,
  startedAt: preTimes[0], finishedAt: preTimes[1],
});
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

shellSql(`update public.syncview_runtime_flags
  set value='{"mode":"live"}'::jsonb
  where key='linear_outbound_enabled';`);
const postTimes = ['2026-08-02T13:05:00.000Z', '2026-08-02T13:05:02.000Z'];
const postResponse = response('live', 2, postTimes[0], postTimes[1]);
const postEventId = insertSummary(summaryFromResponse(postResponse));
assert.equal(postEventId, 2);
const postTerminal = terminalFor({
  mode: 'live', eventId: postEventId, runId: '200000002', releaseSha,
  startedAt: postTimes[0], finishedAt: postTimes[1],
});
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
  && postReceipt.writes.normal_lane_count === 0
  && postReceipt.writes.legacy_parity_count === 0,
'the clean post-f2 receipt binds the exact pre receipt and proves zero normal writes');

const repeatedSnapshot = capturePostgresSnapshot({
  databaseUrl: process.env.F2_DATABASE_URL,
  eventId: postEventId,
  startedAt: postTimes[0],
  finishedAt: postTimes[1],
  allowDisposable: true,
});
ok(stableJson(repeatedSnapshot) === stableJson(postSnapshot),
'running the packaged capture leaves the disposable database byte-stable at its read surfaces');

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

const missingCredential = JSON.parse(JSON.stringify(postTerminal));
delete missingCredential.linear_credential_receipt.viewer_identity_sha256;
const credentialSabotage = buildEvidenceReceipt(receiptOptions({
  mode: 'post-f2', terminal: missingCredential, releaseSha, snapshot: postSnapshot, preReceiptBytes,
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

for (const receipt of [preReceipt, postReceipt, residueSabotage, correlationSabotage, credentialSabotage, observerSabotage]) {
  const text = stableJson(receipt);
  ok(!/client_slug|dedup_key|linear_result|actor|authorization|password|database_url|payload/i.test(text),
  'every public receipt remains bounded and private-row/credential free');
  ok(receipt.schema === EVIDENCE_SCHEMA, 'every proof result uses the versioned public receipt schema');
}

console.log(`GRAPHICS_F2_POSTGRES_17_PROOF_OK sabotage_cases=4 assertions=${passed}`);
