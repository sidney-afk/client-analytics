#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const {
  MAX_SCHEDULE_AGE_MS,
  PreflightError,
  QUEUE_SCHEMA,
  REPOSITORY,
  WORKFLOW_FILE,
  captureQueueSnapshot,
  failureLines,
  loadWorkflowInventory,
  queueSnapshotSql,
  runCli,
  runPreflight,
  validateQueueSnapshot,
  verifyClearAir,
  verifyPreReceipt,
} = require('../scripts/graphics-f2-preflight.js');

let passed = 0;
function ok(condition, message) {
  assert.ok(condition, message);
  passed++;
}

function source(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function roleBoundary(overrides = {}) {
  return {
    current_user: 'graphics_f2_readonly',
    session_user: 'graphics_f2_readonly',
    current_database: 'postgres',
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
    mirror_outbox_test_only_not_null: true,
    can_write_application_tables: false,
    can_write_application_columns: false,
    direct_function_execute_privilege_count: 0,
    application_function_execute_privileges: [],
    can_use_application_sequences: false,
    can_create_application_schema_object: false,
    ...overrides,
  };
}

function snapshot(rows = [], overrides = {}) {
  return {
    schema: QUEUE_SCHEMA,
    transaction_read_only: 'on',
    role_boundary: roleBoundary(),
    flags: [
      {
        key: 'linear_outbound_enabled',
        value: { mode: 'off' },
        updated_at: '2026-08-04T22:00:00.000Z',
      },
      {
        key: 'prod_authority',
        value: { video: 'linear', graphics: 'linear' },
        updated_at: '2026-08-04T22:00:00.000Z',
      },
    ],
    exact_count: rows.length,
    rows,
    ...overrides,
  };
}

const toolSource = source('scripts/graphics-f2-preflight.js');
const workflowSource = source('.github/workflows/graphics-f2-preflight.yml');
const evidenceWorkflowSource = source('.github/workflows/graphics-f2-evidence.yml');
const flipRunbook = source('docs/ops/FLIP_RUNBOOK.md');
const sql = queueSnapshotSql();
const residueSql = sql.match(/with residue as materialized \(([\s\S]*?)\n\), role_boundary/)[1];

ok(/begin transaction isolation level repeatable read read only;/.test(sql)
  && /current_setting\('transaction_read_only'\)/.test(sql)
  && !/^\s*(?:insert|update|delete|merge|truncate|alter|drop|create|grant|revoke)\b/im.test(sql),
'the machine gate takes one read-only repeatable-read snapshot and contains no mutation statement');
ok(/where o\.test_only = false\s+and o\.status in \('pending', 'failed', 'shadow_ok'\)/.test(residueSql),
'the production residue predicate is exact');
ok(!/\b(?:attempts|next_retry_at|legacy_parity)\b/i.test(residueSql)
  && !/\b(?:team|legacy_parity)\s*(?:=|in\b|is\b)/i.test(residueSql),
'team, parity lane, attempt count, and retry time cannot narrow the residue inventory');
ok(/order by r\.id::bigint/.test(sql)
  && /'id', r\.id/.test(sql)
  && /'team', r\.team/.test(sql)
  && /'status', r\.status/.test(sql)
  && !/client_slug|payload|last_error|linear_result/.test(sql),
'the refusal inventory is complete, numerically ordered, and limited to id/team/status');

const rows = [
  { id: '7', team: 'graphics', status: 'pending' },
  { id: '11', team: 'video', status: 'failed' },
  { id: '19', team: 'another-team', status: 'shadow_ok' },
];
const accepted = validateQueueSnapshot(snapshot(rows), 'graphics_f2_readonly');
ok(accepted.count === 3 && JSON.stringify(accepted.rows) === JSON.stringify(rows),
'all statuses and an arbitrary team are retained without narrowing');

for (const sabotage of [
  snapshot(rows, { transaction_read_only: 'off' }),
  snapshot(rows, { exact_count: 4 }),
  snapshot(rows, { role_boundary: roleBoundary({ full_visibility_policy_count: 3 }) }),
  snapshot(rows, { role_boundary: roleBoundary({ effective_select_relation_count: 5 }) }),
  snapshot(rows, { role_boundary: roleBoundary({ direct_function_execute_privilege_count: 1 }) }),
  snapshot(rows, { role_boundary: roleBoundary({ can_write_application_tables: true }) }),
  snapshot(rows, { flags: snapshot().flags.map(row => row.key === 'linear_outbound_enabled'
    ? { ...row, value: { mode: 'live' } } : row) }),
  snapshot(rows, { flags: snapshot().flags.map(row => row.key === 'prod_authority'
    ? { ...row, value: { video: 'linear', graphics: 'syncview' } } : row) }),
  snapshot([{ id: '7', team: 'graphics\nleak', status: 'failed' }]),
  snapshot([{ id: '8', team: 'graphics', status: 'failed' }, { id: '8', team: 'video', status: 'pending' }]),
  snapshot([{ id: '10', team: 'graphics', status: 'failed' }, { id: '9', team: 'video', status: 'pending' }]),
  snapshot([{ id: '7', team: 'graphics', status: 'written' }]),
]) {
  let refused = false;
  try {
    validateQueueSnapshot(sabotage, 'graphics_f2_readonly');
  } catch (error) {
    refused = error instanceof PreflightError;
  }
  ok(refused, 'malformed, incomplete, hidden, writable, duplicate, or unordered evidence refuses');
}

const residueLines = failureLines(new PreflightError('production_residue', { rows }));
ok(residueLines[0] === 'REFUSE graphics_f2_preflight production_residue=3 pending=1 failed=1 shadow_ok=1'
  && residueLines.slice(1).every((line, index) => line === JSON.stringify(rows[index]))
  && residueLines.every(line => !/NO-GO|client_slug|payload|last_error|next_retry/i.test(line)),
'residue refuses with exact bounded row identities and never emits an ambiguous GO token');
ok(failureLines(new Error('postgresql://user:secret@host/db'))[0]
  === 'REFUSE graphics_f2_preflight unexpected_failure',
'unexpected tool and credential details are replaced by a fixed safe refusal');

const releaseSha = 'a'.repeat(40);
const scheduledRunId = '30956858526';
const preEvidenceRunId = '30956858000';
const preCompletedAt = '2026-08-04T22:30:00.000Z';
const completedAt = '2026-08-04T22:33:59.000Z';
function scheduledRun(overrides = {}) {
  return {
    id: Number(scheduledRunId),
    run_attempt: 1,
    event: 'schedule',
    status: 'completed',
    conclusion: 'success',
    head_sha: releaseSha,
    path: '.github/workflows/linear-outbound-drain.yml@refs/heads/main',
    created_at: '2026-08-04T22:33:30.000Z',
    run_started_at: '2026-08-04T22:33:31.000Z',
    updated_at: completedAt,
    repository: { full_name: 'sidney-afk/client-analytics' },
    ...overrides,
  };
}

function clearAirReader({
  inventory = [scheduledRun()],
  finalActive = [],
  scheduled = scheduledRun(),
  mainSha = releaseSha,
} = {}) {
  let mainReads = 0;
  return endpoint => {
    if (endpoint.endsWith('/git/ref/heads/main')) {
      const value = Array.isArray(mainSha)
        ? mainSha[Math.min(mainReads++, mainSha.length - 1)] : mainSha;
      return { ref: 'refs/heads/main', object: { type: 'commit', sha: value } };
    }
    if (endpoint.endsWith(`/actions/runs/${scheduledRunId}`)) return scheduled;
    const attemptMatch = /\/actions\/runs\/([0-9]+)\/attempts\/([0-9]+)$/.exec(endpoint);
    if (attemptMatch) {
      const match = inventory.find(run => String(run.id) === attemptMatch[1]
        && String(run.run_attempt) === attemptMatch[2]);
      if (!match) throw new Error(`missing attempt ${endpoint}`);
      return match;
    }
    const activeMatch = /[?&]status=([^&]+).*?[?&]page=([0-9]+)/.exec(endpoint);
    if (activeMatch) {
      const matches = finalActive.filter(run => run.status === activeMatch[1]);
      const pageNumber = Number(activeMatch[2]);
      return {
        total_count: matches.length,
        workflow_runs: matches.slice((pageNumber - 1) * 100, pageNumber * 100),
      };
    }
    if (endpoint.endsWith('/runs?per_page=100&page=1')) {
      return { total_count: inventory.length, workflow_runs: inventory };
    }
    throw new Error(`unexpected endpoint ${endpoint}`);
  };
}

const rerunBase = scheduledRun({
  id: 30950000000,
  run_attempt: 2,
  created_at: '2026-08-04T20:00:00.000Z',
  run_started_at: '2026-08-04T21:00:00.000Z',
  updated_at: '2026-08-04T21:00:30.000Z',
});
const rerunAttempt = { ...rerunBase, created_at: '2026-08-04T20:59:58.000Z' };
const rerunInventory = loadWorkflowInventory(endpoint => {
  if (endpoint.endsWith('/runs?per_page=100&page=1')) {
    return { total_count: 1, workflow_runs: [rerunBase] };
  }
  if (endpoint.endsWith('/actions/runs/30950000000/attempts/2')) return rerunAttempt;
  throw new Error(`unexpected endpoint ${endpoint}`);
});
ok(rerunInventory.length === 1
  && rerunInventory[0].created_at === rerunAttempt.created_at,
'latest rerun verification accepts the attempt-specific created_at while binding every shared field');

const clear = verifyClearAir({
  releaseSha,
  scheduledRunId,
  preCompletedAt,
  now: Date.parse(completedAt) + 60_000,
  ghRead: clearAirReader(),
});
ok(clear.scheduled_run_id === scheduledRunId && clear.release_sha === releaseSha,
'a fresh exact-release successful schedule with no active drainer passes clear air');

for (const options of [
  {
    now: Date.parse(completedAt) + MAX_SCHEDULE_AGE_MS + 1,
    ghRead: clearAirReader(),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({ scheduled: scheduledRun({ conclusion: 'failure' }) }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({
      inventory: [
        scheduledRun(),
        scheduledRun({
          id: 30956858527,
          event: 'workflow_dispatch',
          created_at: '2026-08-04T22:34:00.000Z',
          run_started_at: '2026-08-04T22:34:00.000Z',
          updated_at: '2026-08-04T22:34:30.000Z',
        }),
      ],
    }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({
      finalActive: [scheduledRun({
        id: 30950000000,
        run_attempt: 2,
        status: 'in_progress',
        conclusion: null,
        created_at: '2026-08-04T20:00:00.000Z',
        run_started_at: '2026-08-04T22:34:00.000Z',
        updated_at: '2026-08-04T22:34:00.000Z',
      })],
    }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({
      inventory: [
        scheduledRun(),
        scheduledRun({
          id: 30956858527,
          status: 'future_nonterminal_status',
          conclusion: null,
          created_at: '2026-08-04T20:00:00.000Z',
          run_started_at: '2026-08-04T20:00:01.000Z',
          updated_at: '2026-08-04T20:00:02.000Z',
        }),
      ],
    }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({
      inventory: [
        scheduledRun(),
        scheduledRun({
          id: 30956858527,
          event: 'repository_dispatch',
          status: 'queued',
          conclusion: null,
          created_at: '2026-08-04T22:34:00.000Z',
          run_started_at: '',
          updated_at: '2026-08-04T22:34:00.000Z',
        }),
      ],
    }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({ mainSha: 'b'.repeat(40) }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({ mainSha: [releaseSha, 'b'.repeat(40)] }),
  },
  {
    now: Date.parse(completedAt) + 60_000,
    ghRead: clearAirReader({
      inventory: [
        scheduledRun(),
        scheduledRun({
          id: 30950000000,
          run_attempt: 2,
          created_at: '2026-08-04T20:00:00.000Z',
          run_started_at: '2026-08-04T22:34:00.000Z',
          updated_at: '2026-08-04T22:34:30.000Z',
        }),
      ],
    }),
  },
]) {
  let refused = false;
  try {
    verifyClearAir({ releaseSha, scheduledRunId, preCompletedAt, ...options });
  } catch (error) {
    refused = error instanceof PreflightError;
  }
  ok(refused, 'stale, failed, superseded, active, moved-main, or older-run rerun state refuses clear air');
}

const binder = 'graphics-f2-test-binder-20260804';
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function preReceipt(overrides = {}) {
  return {
    schema: 'syncview.graphics-f2-evidence.v2',
    status: 'PASS',
    mode: 'pre-f2',
    release_sha: releaseSha,
    binder_sha256: digest(`graphics-f2\n${binder}`),
    evidence_workflow: { workflow_run_id: preEvidenceRunId, workflow_run_attempt: '1' },
    function_source_sha256: { 'linear-outbound': 'c'.repeat(64) },
    authority: { video: 'linear', graphics: 'linear' },
    outbound_mode: 'off',
    handoff_order: { status: 'PASS', pre_evidence_run_id: preEvidenceRunId },
    residue: { exact_count: 0 },
    correlation_chain: { status: 'PASS' },
    dispatch_eligibility: { status: 'PASS' },
    linear_credential_receipt: { status: 'PASS' },
    writes: { normal_lane_count: 0 },
    observer: { status: 'PASS' },
    postgres: { status: 'PASS', transaction_read_only: 'on' },
    failed_gates: [],
    ...overrides,
  };
}
function preRun(overrides = {}) {
  return {
    id: Number(preEvidenceRunId),
    run_attempt: 1,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: releaseSha,
    head_branch: 'main',
    path: '.github/workflows/graphics-f2-evidence.yml@refs/heads/main',
    created_at: '2026-08-04T22:29:00.000Z',
    run_started_at: '2026-08-04T22:29:01.000Z',
    updated_at: preCompletedAt,
    repository: { full_name: REPOSITORY },
    actor: { login: 'sidney-afk' },
    triggering_actor: { login: 'sidney-afk' },
    ...overrides,
  };
}
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'graphics-f2-preflight-'));
const receiptPath = path.join(tempRoot, 'receipt.json');
const checksumPath = path.join(tempRoot, 'receipt.sha256');
const receiptBytes = Buffer.from(JSON.stringify(preReceipt()));
fs.writeFileSync(receiptPath, receiptBytes);
fs.writeFileSync(checksumPath, `${digest(receiptBytes)}  /tmp/graphics-f2-output/receipt.json\n`);
const boundPre = verifyPreReceipt({
  releaseSha,
  binder,
  preEvidenceRunId,
  preReceiptPath: receiptPath,
  preReceiptChecksumPath: checksumPath,
  ghRead: endpoint => {
    if (endpoint.endsWith(`/actions/runs/${preEvidenceRunId}`)) return preRun();
    throw new Error(`unexpected endpoint ${endpoint}`);
  },
});
ok(boundPre.run_id === preEvidenceRunId
  && boundPre.receipt_sha256 === digest(receiptBytes)
  && boundPre.binder_sha256 === digest(`graphics-f2\n${binder}`),
'the hard gate binds the exact PASS pre receipt bytes, binder, run attempt, and GitHub observer');

for (const sabotage of [
  { binder: `${binder}-wrong`, run: preRun() },
  { binder, run: preRun({ head_sha: 'b'.repeat(40) }) },
  { binder, run: preRun({ run_attempt: 2 }) },
]) {
  let refused = false;
  try {
    verifyPreReceipt({
      releaseSha,
      binder: sabotage.binder,
      preEvidenceRunId,
      preReceiptPath: receiptPath,
      preReceiptChecksumPath: checksumPath,
      ghRead: () => sabotage.run,
    });
  } catch (error) {
    refused = error instanceof PreflightError;
  }
  ok(refused, 'wrong binder, release, or run attempt cannot reuse a pre receipt');
}

let clearAirCalls = 0;
let verifyPreCalls = 0;
const preControl = {
  run_id: preEvidenceRunId,
  run_attempt: '1',
  completed_at: preCompletedAt,
  receipt_sha256: digest(receiptBytes),
  binder_sha256: digest(`graphics-f2\n${binder}`),
};
const preflight = runPreflight({
  releaseSha,
  scheduledRunId,
  preEvidenceRunId,
  binder,
  preReceiptPath: receiptPath,
  preReceiptChecksumPath: checksumPath,
  databaseUrl: 'redacted',
}, {
  now: () => Date.parse(completedAt) + 60_000,
  captureQueue: () => ({ count: 0, rows: [] }),
  verifyPre: () => {
    verifyPreCalls++;
    return preControl;
  },
  clearAir: () => {
    clearAirCalls++;
    return clear;
  },
});
ok(preflight.release_sha === releaseSha && clearAirCalls === 2 && verifyPreCalls === 2,
'the queue read is bookended by pre-receipt and clear-air checks');

let failedScheduleResidue = null;
try {
  runPreflight({
    releaseSha,
    scheduledRunId,
    preEvidenceRunId,
    binder,
    preReceiptPath: receiptPath,
    preReceiptChecksumPath: checksumPath,
    databaseUrl: 'redacted',
  }, {
    captureQueue: () => ({ count: rows.length, rows }),
    verifyPre: () => preControl,
    clearAir: () => { throw new PreflightError('scheduled_run_invalid'); },
  });
} catch (error) {
  failedScheduleResidue = error;
}
ok(failedScheduleResidue instanceof PreflightError
  && failedScheduleResidue.code === 'production_residue'
  && failedScheduleResidue.details.rows.length === rows.length,
'a failed scheduled drain cannot hide blocking queue rows from the operator diagnostic');

let finalClearCalls = 0;
let diagnosticQueueCalls = 0;
let finalClearResidue = null;
try {
  runPreflight({
    releaseSha,
    scheduledRunId,
    preEvidenceRunId,
    binder,
    preReceiptPath: receiptPath,
    preReceiptChecksumPath: checksumPath,
    databaseUrl: 'redacted',
  }, {
    captureQueue: () => {
      diagnosticQueueCalls++;
      return diagnosticQueueCalls === 1 ? { count: 0, rows: [] } : { count: rows.length, rows };
    },
    verifyPre: () => preControl,
    clearAir: () => {
      finalClearCalls++;
      if (finalClearCalls === 1) return clear;
      throw new PreflightError('active_drainer_present');
    },
  });
} catch (error) {
  finalClearResidue = error;
}
ok(finalClearResidue instanceof PreflightError
  && finalClearResidue.code === 'production_residue'
  && diagnosticQueueCalls === 2,
'a final clear-air failure re-reads and names any newly blocking queue rows before refusing');

const stdout = [];
const stderr = [];
const cliArgs = [
  `--release-sha=${releaseSha}`,
  `--scheduled-run-id=${scheduledRunId}`,
  `--pre-evidence-run-id=${preEvidenceRunId}`,
  `--binder=${binder}`,
  `--pre-receipt=${receiptPath}`,
  `--pre-receipt-checksum=${checksumPath}`,
];
const cliStatus = runCli([
  ...cliArgs,
], {
  env: { F2_DATABASE_URL: 'redacted' },
  stdout: line => stdout.push(line),
  stderr: line => stderr.push(line),
  run: () => ({ ...clear, pre_evidence: preControl }),
});
ok(cliStatus === 0 && stdout.length === 1 && stderr.length === 0
  && stdout[0].startsWith('GO graphics_f2_preflight production_residue=0 ')
  && stdout[0].includes(`pre_evidence_run_id=${preEvidenceRunId}`)
  && stdout[0].includes(`pre_receipt_sha256=${preControl.receipt_sha256}`)
  && !stdout[0].includes(binder),
'zero residue plus clear air prints one literal GO and exits zero');

const refusedStdout = [];
const refusedStderr = [];
const refusedStatus = runCli([
  ...cliArgs,
], {
  env: { F2_DATABASE_URL: 'redacted' },
  stdout: line => refusedStdout.push(line),
  stderr: line => refusedStderr.push(line),
  run: () => { throw new PreflightError('production_residue', { rows }); },
});
ok(refusedStatus === 1 && refusedStdout.length === 0
  && refusedStderr.length === 4 && refusedStderr[0].startsWith('REFUSE '),
'residue prints REFUSE plus every row and exits nonzero');

ok(/^name: Graphics F2 hard pre-flight/m.test(workflowSource)
  && /on:\n  workflow_dispatch:/.test(workflowSource)
  && !/\n  (?:push|pull_request|schedule|repository_dispatch):/.test(workflowSource)
  && /environment: production/.test(workflowSource)
  && /GRAPHICS_F2_PREFLIGHT_READ_ONLY/.test(workflowSource)
  && /refs\/heads\/main/.test(workflowSource)
  && /GITHUB_ACTOR.*sidney-afk|test "\$GITHUB_ACTOR" = "sidney-afk"/.test(workflowSource)
  && /pre_evidence_run_id:/.test(workflowSource)
  && /binder:/.test(workflowSource)
  && /name: graphics-f2-evidence-pre-f2-\$\{\{ inputs\.pre_evidence_run_id \}\}/.test(workflowSource)
  && /GRAPHICS_F2_READONLY_DATABASE_URL/.test(workflowSource)
  && !/SUPABASE_SERVICE_ROLE_KEY|LINEAR_MIRROR_API_KEY|SUPABASE_ACCESS_TOKEN/.test(workflowSource)
  && !/upload-artifact/.test(workflowSource),
'the supported operator route is manual/main/owner-only, read-only-secret-only, and uploads no row artifact');
ok(toolSource.includes("run.status !== 'completed'")
  && toolSource.includes('ACTIVE_SWEEP_STATUSES')
  && toolSource.includes('status=${status}&per_page=${GITHUB_PAGE_SIZE}&page=${pageNumber}')
  && toolSource.includes('/git/ref/heads/main')
  && toolSource.includes('runs?per_page=${GITHUB_PAGE_SIZE}&page=${pageNumber}')
  && toolSource.includes('/attempts/${run.run_attempt}')
  && toolSource.includes('MAX_SCHEDULE_AGE_MS = 5 * 60 * 1000'),
'the source pins current main, exhaustive latest attempts, active runs, and final five-minute freshness');
ok(evidenceWorkflowSource.indexOf('GRAPHICS_F2_TRIGGER_EXECUTE_REVOKE_SQL_BEGIN')
    < evidenceWorkflowSource.indexOf('node test/graphics-f2-preflight.js --postgres-proof'),
'the hosted preflight proof models the already-accepted trigger execute revoke');
ok(/'required_select'/.test(sql)
  && /'effective_select_relation_count'/.test(sql)
  && /'direct_function_execute_privilege_count'/.test(sql)
  && /'application_function_execute_privileges'/.test(sql)
  && /from public\.syncview_runtime_flags/.test(sql),
'the queue snapshot reuses the exact-four read-only role boundary and current F1/F2 state');
ok(flipRunbook.includes('### Hard machine pre-flight and clear air (required immediately before F2)')
  && flipRunbook.includes('does **not** guarantee that run will pass')
  && flipRunbook.includes('### If the first eligible post-F2 drainer fails')
  && flipRunbook.includes('This is **not a catastrophe and the flip is not ruined**')
  && flipRunbook.includes('normally costs roughly 30 minutes')
  && flipRunbook.includes('EMERGENCY NORMAL-LANE KILL')
  && flipRunbook.includes('Discard the failed binder and pre-evidence run ID')
  && flipRunbook.includes('function Invoke-ExactWorkflow')
  && flipRunbook.includes('function Assert-CurrentMain')
  && flipRunbook.includes('$script:LastWorkflowRunId = $null')
  && flipRunbook.includes("'graphics-f2-preflight.yml'")
  && flipRunbook.includes('pre_evidence_run_id = $PreEvidenceRunId')
  && flipRunbook.includes("Read-Host 'Paste the private owner attestation' -AsSecureString")
  && flipRunbook.indexOf('Wait for the next successful same-release scheduled drainer')
    < flipRunbook.indexOf('The owner alone runs F2 and its SQL readback'),
'the runbook makes GO a pre-F2 hard gate, preserves the risk caveat, and gives ordered recovery');

function shellSql(statement) {
  const result = spawnSync('psql', [
    '-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--command', statement,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0 || result.error || result.signal || String(result.stderr || '').trim()) {
    throw new Error('disposable PostgreSQL command failed');
  }
  return String(result.stdout || '').trim();
}

function postgresProof() {
  if (process.env.F2_DISPOSABLE_CONFIRM !== 'GRAPHICS_F2_DISPOSABLE_ONLY'
      || !process.env.F2_DATABASE_URL
      || process.env.PGDATABASE !== 'graphics_f2') {
    throw new Error('postgres proof requires the explicit Graphics F2 disposable database');
  }
  shellSql(`alter table public.mirror_outbox
    add column if not exists attempts integer not null default 0,
    add column if not exists next_retry_at timestamptz;`);
  shellSql(`delete from public.mirror_outbox;
    insert into public.mirror_outbox(team, operation, status, test_only, legacy_parity, attempts, next_retry_at)
    values
      ('graphics', 'title', 'failed', true, false, 1, now() - interval '1 minute'),
      ('video', 'status', 'pending', true, true, 0, null),
      ('graphics', 'title', 'written', false, false, 0, null),
      ('video', 'status', 'skipped', false, true, 0, null),
      ('other-team', 'comment', 'stale', false, false, 0, null);`);
  const green = captureQueueSnapshot({
    databaseUrl: process.env.F2_DATABASE_URL,
    allowDisposable: true,
  });
  ok(green.count === 0, 'TEST-only active rows and production terminal rows do not block');

  shellSql(`insert into public.mirror_outbox(team, operation, status, test_only, legacy_parity, attempts, next_retry_at)
    values
      ('graphics', 'title', 'pending', false, false, 0, null),
      ('video', 'status', 'failed', false, true, 8, now() + interval '1 day'),
      ('unknown-team', 'comment', 'shadow_ok', false, true, 99, now() + interval '1 year');`);
  const red = captureQueueSnapshot({
    databaseUrl: process.env.F2_DATABASE_URL,
    allowDisposable: true,
  });
  ok(red.count === 3
    && red.rows.map(row => row.status).join(',') === 'pending,failed,shadow_ok'
    && red.rows[2].team === 'unknown-team',
  'both parity lanes, all teams, exhausted attempts, and future retries remain blocking');

  shellSql(`alter policy graphics_f2_readonly_outbox_select
    on public.mirror_outbox using (false);`);
  let hiddenRefused = false;
  try {
    captureQueueSnapshot({ databaseUrl: process.env.F2_DATABASE_URL, allowDisposable: true });
  } catch (error) {
    hiddenRefused = error instanceof PreflightError
      && error.code === 'database_role_boundary_invalid';
  } finally {
    shellSql(`alter policy graphics_f2_readonly_outbox_select
      on public.mirror_outbox using (true);
      delete from public.mirror_outbox;`);
  }
  ok(hiddenRefused, 'RLS drift cannot manufacture a false zero');
  console.log(`GRAPHICS_F2_PREFLIGHT_POSTGRES_17_PROOF_OK assertions=${passed}`);
}

if (process.argv.includes('--postgres-proof')) postgresProof();
else console.log(`GRAPHICS_F2_PREFLIGHT_SOURCE_OK assertions=${passed}`);
