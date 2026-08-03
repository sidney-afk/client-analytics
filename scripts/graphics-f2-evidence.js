#!/usr/bin/env node
'use strict';

/**
 * Packaged F98 Graphics F2 evidence lane.
 *
 * Commands:
 *   drainer-terminal  Build the bounded terminal artifact for one existing
 *                     linear-outbound GitHub Actions execution.
 *   pre-f2            Prove Linear/Linear authority, F2 off, exact residue
 *                     zero, correlated terminal/credential evidence, and an
 *                     outside-n8n observer.
 *   post-f2           Repeat the proof with F2 live and bind it to the exact
 *                     pre-f2 receipt, release, source closures, and binder.
 *
 * The pre/post commands are read-only. Their PostgreSQL session is explicitly
 * REPEATABLE READ, READ ONLY; the remaining inputs are local receipt files and
 * read-only GitHub/Supabase source-readback results prepared by the workflow.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PROJECT_REF = 'uzltbbrjidmjwwfakwve';
const DISPATCH_SCHEMA = 'syncview.graphics-f2-drainer-dispatch.v1';
const CREDENTIAL_SCHEMA = 'syncview.graphics-f2-linear-credential.v1';
const DRAINER_SCHEMA = 'syncview.graphics-f2-drainer-terminal.v1';
const EVIDENCE_SCHEMA = 'syncview.graphics-f2-evidence.v1';
const WORKFLOW_PATH = '.github/workflows/linear-outbound-drain.yml';
const REQUIRED_FUNCTIONS = ['linear-outbound', 'linear-outbound-evidence'];
const RESIDUE_STATUSES = new Set(['pending', 'failed', 'shadow_ok']);
const SAFE_OPERATIONS = new Set([
  'create', 'status', 'comment', 'due', 'assignee', 'title', 'priority',
  'parent', 'archive', 'restore', 'labels', 'description', 'attachment',
]);
const COUNT_KEYS = [
  'enqueued', 'shadow_ok', 'written', 'failed', 'retried', 'echo_dropped',
  'stale_dropped', 'tolerated_historical', 'skipped', 'paused',
  'legacy_parity_written', 'legacy_parity_paused',
  'shadow_vs_actual_divergence',
];

class GateError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function exactObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new GateError(code);
  return value;
}

function exactInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) throw new GateError(code);
  return number;
}

function exactIso(value, code) {
  const text = clean(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(text)
      || !Number.isFinite(Date.parse(text))) throw new GateError(code);
  return text;
}

function readBounded(file, code, maximum = 8 * 1024 * 1024) {
  const target = path.resolve(clean(file));
  const stats = fs.statSync(target);
  if (!stats.isFile() || stats.size <= 0 || stats.size > maximum) throw new GateError(code);
  return fs.readFileSync(target);
}

function readJson(file, code, maximum) {
  try {
    return JSON.parse(readBounded(file, code, maximum).toString('utf8'));
  } catch (error) {
    if (error instanceof GateError) throw error;
    throw new GateError(code);
  }
}

function deterministicCorrelation(releaseSha, runId, runAttempt) {
  return `graphics-f2:${releaseSha}:${runId}:${runAttempt}`;
}

function normalizeCounts(value) {
  const counts = exactObject(value, 'drainer_counts_invalid');
  return Object.fromEntries(COUNT_KEYS.map(key => [key, exactInteger(counts[key], 'drainer_counts_invalid')]));
}

function parseHeaders(bytes) {
  const text = Buffer.from(bytes).toString('utf8');
  const candidates = [];
  for (const name of ['sb-request-id', 'x-request-id', 'x-deno-ray', 'cf-ray']) {
    const pattern = new RegExp(`^${name}:\\s*([^\\r\\n]+)$`, 'gim');
    let match;
    while ((match = pattern.exec(text))) candidates.push({ name, value: clean(match[1]) });
  }
  const receipt = candidates.find(row => /^[a-zA-Z0-9._:-]{8,200}$/.test(row.value));
  if (!receipt) throw new GateError('edge_request_id_missing');
  return receipt;
}

function drainerSummary(response) {
  const summary = { ...response };
  delete summary.event_id;
  delete summary.target;
  delete summary.f27_drill_receipt;
  return summary;
}

function buildDrainerTerminal({ context, headersBytes, bodyBytes, credential }) {
  const releaseSha = clean(context.release_sha).toLowerCase();
  const runId = clean(context.workflow_run_id);
  const runAttempt = clean(context.workflow_run_attempt);
  const correlationId = clean(context.correlation_id);
  if (!/^[0-9a-f]{40}$/.test(releaseSha)
      || !/^[1-9][0-9]{0,19}$/.test(runId)
      || !/^[1-9][0-9]{0,9}$/.test(runAttempt)
      || correlationId !== deterministicCorrelation(releaseSha, runId, runAttempt)) {
    throw new GateError('dispatch_correlation_invalid');
  }
  if (clean(context.repository) !== 'sidney-afk/client-analytics') {
    throw new GateError('dispatch_repository_invalid');
  }

  let response;
  try { response = JSON.parse(Buffer.from(bodyBytes).toString('utf8')); } catch (_) {
    throw new GateError('drainer_body_invalid');
  }
  exactObject(response, 'drainer_body_invalid');
  const eventId = exactInteger(response.event_id, 'drainer_event_missing');
  if (eventId < 1 || response.ok !== true) throw new GateError('drainer_terminal_not_ok');
  const mode = clean(response.mode).toLowerCase();
  if (!['off', 'shadow', 'live'].includes(mode)) throw new GateError('drainer_mode_invalid');
  const authority = exactObject(response.authority, 'drainer_authority_invalid');
  const counts = normalizeCounts(response.counts);
  const startedAt = exactIso(response.started_at, 'drainer_time_invalid');
  const finishedAt = exactIso(response.finished_at, 'drainer_time_invalid');
  if (Date.parse(finishedAt) < Date.parse(startedAt)) throw new GateError('drainer_time_invalid');

  const typedCredential = exactObject(credential, 'credential_receipt_missing');
  if (typedCredential.ok !== true
      || typedCredential.accepted !== true
      || typedCredential.schema !== CREDENTIAL_SCHEMA
      || typedCredential.receipt_type !== 'linear_graphql_viewer_accepted'
      || typedCredential.correlation_id !== correlationId
      || typedCredential.release_sha !== releaseSha
      || clean(typedCredential.workflow_run_id) !== runId
      || clean(typedCredential.workflow_run_attempt) !== runAttempt
      || !/^[0-9a-f]{64}$/.test(clean(typedCredential.viewer_identity_sha256))
      || typedCredential.mutation_attempted !== false) {
    throw new GateError('credential_receipt_missing');
  }
  const credentialObservedAt = exactIso(typedCredential.observed_at, 'credential_receipt_missing');
  if (Date.parse(credentialObservedAt) < Date.parse(startedAt)
      || Date.parse(credentialObservedAt) > Date.parse(finishedAt) + 120_000) {
    throw new GateError('credential_receipt_missing');
  }
  const requestId = parseHeaders(headersBytes);
  const summary = drainerSummary(response);
  const httpStatus = exactInteger(context.http_status, 'drainer_http_status_invalid', 599);
  if (httpStatus !== 200) throw new GateError('drainer_http_status_invalid');

  return {
    schema: DRAINER_SCHEMA,
    correlation_id: correlationId,
    release_sha: releaseSha,
    dispatch: {
      repository: clean(context.repository),
      workflow_run_id: runId,
      workflow_run_attempt: runAttempt,
      workflow_event: clean(context.workflow_event),
    },
    drainer_execution: {
      edge_request_header: requestId.name,
      edge_request_id: requestId.value,
      http_status: httpStatus,
      terminal_body_sha256: sha256(bodyBytes),
      summary_sha256: sha256(stableJson(summary)),
      event_id: eventId,
      started_at: startedAt,
      finished_at: finishedAt,
      mode,
      authority: {
        video: clean(authority.video).toLowerCase(),
        graphics: clean(authority.graphics).toLowerCase(),
      },
      legacy_parity_enabled: response.legacy_parity_enabled === true,
      counts,
    },
    linear_credential_receipt: {
      schema: CREDENTIAL_SCHEMA,
      receipt_type: 'linear_graphql_viewer_accepted',
      accepted: true,
      viewer_identity_sha256: clean(typedCredential.viewer_identity_sha256),
      observed_at: credentialObservedAt,
      mutation_attempted: false,
    },
  };
}

function snapshotSql(eventId, startedAt, finishedAt) {
  const safeEventId = exactInteger(eventId, 'drainer_event_missing');
  const safeStartedAt = exactIso(startedAt, 'drainer_time_invalid');
  const safeFinishedAt = exactIso(finishedAt, 'drainer_time_invalid');
  return `
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
select jsonb_build_object(
  'server_version_num', current_setting('server_version_num')::integer,
  'transaction_read_only', current_setting('transaction_read_only'),
  'flags', coalesce((
    select jsonb_agg(jsonb_build_object('key', f.key, 'value', f.value) order by f.key)
    from public.syncview_runtime_flags f
    where f.key in ('prod_authority', 'linear_outbound_enabled')
  ), '[]'::jsonb),
  'residue_rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id::text,
      'team', o.team,
      'status', o.status,
      'operation', o.operation,
      'created_at', o.created_at
    ) order by o.id)
    from public.mirror_outbox o
    where o.test_only is distinct from true
      and o.legacy_parity is distinct from true
      and o.status in ('pending', 'failed', 'shadow_ok')
  ), '[]'::jsonb),
  'summary_event', (
    select jsonb_build_object(
      'id', e.id::text,
      'action', e.action,
      'source', e.source,
      'payload', e.payload
    )
    from public.deliverable_events e
    where e.id = ${safeEventId}
  ),
  'written_rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', o.id::text,
      'team', o.team,
      'operation', o.operation,
      'legacy_parity', o.legacy_parity,
      'test_only', o.test_only,
      'processed_at', o.processed_at,
      'linear_result', o.linear_result
    ) order by o.id)
    from public.mirror_outbox o
    where o.status = 'written'
      and o.processed_at >= '${safeStartedAt}'::timestamptz
      and o.processed_at <= '${safeFinishedAt}'::timestamptz
  ), '[]'::jsonb)
)::text;
commit;
`;
}

function databaseConnection(databaseUrl, allowDisposable = false) {
  let parsed;
  try { parsed = new URL(clean(databaseUrl)); } catch (_) {
    throw new GateError('database_url_invalid');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || !parsed.hostname || !parsed.username || !parsed.password) {
    throw new GateError('database_url_invalid');
  }
  const sslmode = clean(parsed.searchParams.get('sslmode') || (allowDisposable ? 'disable' : 'require')).toLowerCase();
  const username = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';
  const allowedParameters = new Set(['sslmode']);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedParameters.has(key)) throw new GateError('database_url_invalid');
  }
  if (!allowDisposable) {
    const direct = hostname === `db.${PROJECT_REF}.supabase.co`
      && username === 'postgres' && port === '5432';
    const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
      && username === `postgres.${PROJECT_REF}` && ['5432', '6543'].includes(port);
    if ((!direct && !pooled) || !['require', 'verify-full'].includes(sslmode)) {
      throw new GateError('database_target_invalid');
    }
  } else if (process.env.F2_DISPOSABLE_CONFIRM !== 'GRAPHICS_F2_DISPOSABLE_ONLY') {
    throw new GateError('disposable_confirmation_missing');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres');
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, {
    PGHOST: hostname,
    PGPORT: port,
    PGUSER: username,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
    PGSSLMODE: sslmode,
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'graphics-f2-evidence-readonly',
    PGOPTIONS: '',
  });
  return { env, database };
}

function capturePostgresSnapshot({ databaseUrl, eventId, startedAt, finishedAt, allowDisposable = false }) {
  const connection = databaseConnection(databaseUrl, allowDisposable);
  const result = spawnSync('psql', [
    '-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-',
  ], {
    input: snapshotSql(eventId, startedAt, finishedAt),
    encoding: 'utf8',
    env: connection.env,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal || clean(result.stderr)) {
    throw new GateError('postgres_readonly_snapshot_failed');
  }
  const lines = clean(result.stdout).split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length !== 1) throw new GateError('postgres_readonly_snapshot_failed');
  try { return JSON.parse(lines[0]); } catch (_) {
    throw new GateError('postgres_readonly_snapshot_failed');
  }
}

function normalizedTeam(value) {
  const team = clean(value).toLowerCase();
  if (['video', 'vid'].includes(team)) return 'video';
  if (['graphics', 'graphic', 'gra', 'thumbnail'].includes(team)) return 'graphics';
  return 'other';
}

function normalizedOperation(value) {
  const operation = clean(value).toLowerCase();
  return SAFE_OPERATIONS.has(operation) ? operation : 'other';
}

function residueReceipt(rows) {
  if (!Array.isArray(rows)) throw new GateError('residue_inventory_invalid');
  const inventory = rows.map(rowValue => {
    const row = exactObject(rowValue, 'residue_inventory_invalid');
    const id = clean(row.id);
    const status = clean(row.status).toLowerCase();
    if (!/^[1-9][0-9]*$/.test(id) || !RESIDUE_STATUSES.has(status)) {
      throw new GateError('residue_inventory_invalid');
    }
    return {
      id,
      team: clean(row.team),
      public_team: normalizedTeam(row.team),
      status,
      operation: clean(row.operation),
      public_operation: normalizedOperation(row.operation),
      created_at: clean(row.created_at),
    };
  }).sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);

  const classified = new Map();
  for (const row of inventory) {
    const key = `${row.public_team}\u0000${row.status}\u0000${row.public_operation}`;
    classified.set(key, (classified.get(key) || 0) + 1);
  }
  const classifications = [...classified.entries()].map(([key, count]) => {
    const [team, status, operation] = key.split('\u0000');
    return { team, status, operation, count };
  }).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  const privateCanonical = inventory.map(row => ({
    id: row.id,
    team: row.team,
    status: row.status,
    operation: row.operation,
    created_at: row.created_at,
  }));
  return {
    exact_count: inventory.length,
    inventory_sha256: sha256(stableJson(privateCanonical)),
    classifications,
    requires_owner_classification: inventory.length > 0,
  };
}

function parseFlags(rows) {
  if (!Array.isArray(rows) || rows.length !== 2) throw new GateError('runtime_flags_invalid');
  const flags = new Map();
  for (const rowValue of rows) {
    const row = exactObject(rowValue, 'runtime_flags_invalid');
    if (flags.has(row.key)) throw new GateError('runtime_flags_invalid');
    flags.set(clean(row.key), exactObject(row.value, 'runtime_flags_invalid'));
  }
  const authority = flags.get('prod_authority');
  const outbound = flags.get('linear_outbound_enabled');
  if (!authority || !outbound) throw new GateError('runtime_flags_invalid');
  return {
    authority: {
      video: clean(authority.video).toLowerCase(),
      graphics: clean(authority.graphics).toLowerCase(),
    },
    outbound_mode: clean(outbound.mode).toLowerCase(),
  };
}

function providerReceipt(rowValue, credential) {
  const row = exactObject(rowValue, 'typed_linear_receipt_invalid');
  const result = exactObject(row.linear_result, 'typed_linear_receipt_invalid');
  const operation = normalizedOperation(row.operation);
  const mutation = clean(result.mutation);
  const issueId = clean(result.issue_id);
  const commentId = clean(result.comment_id);
  const attachmentId = clean(result.attachment_id);
  const actorId = clean(result.mirror_actor_id);
  const recovered = result.recovered_idempotently === true;
  const conflict = result.conflict && typeof result.conflict === 'object' && !Array.isArray(result.conflict)
    ? result.conflict : null;

  let acceptanceType = '';
  let providerIdentity = '';
  if (mutation && issueId) {
    if (/^comment(?:Create|Update|Delete)$/.test(mutation)) {
      if (!commentId) throw new GateError('typed_linear_receipt_invalid');
      providerIdentity = commentId;
    } else if (mutation === 'attachmentCreate') {
      if (!attachmentId) throw new GateError('typed_linear_receipt_invalid');
      providerIdentity = attachmentId;
    } else {
      providerIdentity = issueId;
    }
    acceptanceType = recovered || conflict ? 'linear_readback_accepted' : 'linear_mutation_accepted';
  }
  if (!acceptanceType || !actorId
      || sha256(actorId) !== clean(credential.viewer_identity_sha256)) {
    throw new GateError('typed_linear_receipt_invalid');
  }
  return {
    row_identity_sha256: sha256(`${clean(row.id)}\n${clean(row.team)}\n${clean(row.operation)}`),
    team: normalizedTeam(row.team),
    operation,
    lane: row.legacy_parity === true ? 'legacy_parity' : 'normal',
    acceptance_type: acceptanceType,
    mutation,
    provider_identity_sha256: sha256(providerIdentity),
    accepted: true,
  };
}

function writtenReceipt(rows, credential, counts) {
  if (!Array.isArray(rows)) throw new GateError('written_inventory_invalid');
  const receipts = rows.map(row => providerReceipt(row, credential));
  const legacyParity = receipts.filter(row => row.lane === 'legacy_parity').length;
  const normal = receipts.filter(row => row.lane === 'normal').length;
  if (receipts.length !== counts.written || legacyParity !== counts.legacy_parity_written) {
    throw new GateError('written_inventory_count_mismatch');
  }
  const byType = new Map();
  for (const receipt of receipts) {
    const key = `${receipt.lane}\u0000${receipt.acceptance_type}\u0000${receipt.operation}`;
    byType.set(key, (byType.get(key) || 0) + 1);
  }
  const classifications = [...byType.entries()].map(([key, count]) => {
    const [lane, acceptance_type, operation] = key.split('\u0000');
    return { lane, acceptance_type, operation, count };
  }).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
  return {
    exact_count: receipts.length,
    normal_lane_count: normal,
    legacy_parity_count: legacyParity,
    linear_accepted_count: receipts.length,
    inventory_sha256: sha256(stableJson(receipts)),
    classifications,
  };
}

function validateSummaryEvent(summaryEvent, terminal) {
  const event = exactObject(summaryEvent, 'terminal_event_missing');
  if (clean(event.id) !== String(terminal.drainer_execution.event_id)
      || event.action !== 'linear_outbound_summary'
      || event.source !== 'outbound') {
    throw new GateError('terminal_event_missing');
  }
  const payload = exactObject(event.payload, 'terminal_event_missing');
  if (sha256(stableJson(payload)) !== terminal.drainer_execution.summary_sha256) {
    throw new GateError('terminal_event_hash_mismatch');
  }
}

function validateObserver(observer, terminal, releaseSha) {
  const metadata = exactObject(observer, 'outside_observer_absent');
  const runId = clean(metadata.id);
  const attempt = clean(metadata.run_attempt);
  const workflowPath = clean(metadata.path).split('@')[0];
  if (metadata.status !== 'completed'
      || metadata.conclusion !== 'success'
      || clean(metadata.head_sha).toLowerCase() !== releaseSha
      || workflowPath !== WORKFLOW_PATH
      || runId !== terminal.dispatch.workflow_run_id
      || attempt !== terminal.dispatch.workflow_run_attempt
      || clean(metadata.event) !== terminal.dispatch.workflow_event) {
    throw new GateError('outside_observer_absent');
  }
  return {
    type: 'github_actions',
    status: 'PASS',
    workflow_path: WORKFLOW_PATH,
    workflow_run_id: runId,
    workflow_run_attempt: attempt,
    conclusion: 'success',
  };
}

function validateFingerprint(report, releaseSha) {
  const value = exactObject(report, 'deployed_source_unpinned');
  if (value.schema_version !== 1
      || value.mode !== 'live-read-only'
      || clean(value.pinned_sha).toLowerCase() !== releaseSha
      || value.project_ref !== PROJECT_REF
      || !Array.isArray(value.results)
      || value.results.length !== REQUIRED_FUNCTIONS.length) {
    throw new GateError('deployed_source_unpinned');
  }
  const receipts = {};
  for (const slug of REQUIRED_FUNCTIONS) {
    const row = value.results.find(result => result && result.slug === slug);
    if (!row || row.result !== 'PASS'
        || row.status !== 'ACTIVE'
        || row.verify_jwt !== false
        || row.entrypoint_match !== true
        || !/^[0-9a-f]{64}$/.test(clean(row.expected_fingerprint))
        || row.expected_fingerprint !== row.live_fingerprint) {
      throw new GateError('deployed_source_unpinned');
    }
    receipts[slug] = clean(row.expected_fingerprint);
  }
  return receipts;
}

function validateTerminal(terminalValue, releaseSha) {
  const terminal = exactObject(terminalValue, 'drainer_terminal_invalid');
  const runId = clean(terminal.dispatch && terminal.dispatch.workflow_run_id);
  const attempt = clean(terminal.dispatch && terminal.dispatch.workflow_run_attempt);
  if (terminal.schema !== DRAINER_SCHEMA
      || terminal.release_sha !== releaseSha
      || terminal.correlation_id !== deterministicCorrelation(releaseSha, runId, attempt)
      || clean(terminal.dispatch && terminal.dispatch.repository) !== 'sidney-afk/client-analytics'
      || !/^[1-9][0-9]{0,19}$/.test(runId)
      || !/^[1-9][0-9]{0,9}$/.test(attempt)) {
    throw new GateError('drainer_correlation_broken');
  }
  const execution = exactObject(terminal.drainer_execution, 'drainer_terminal_invalid');
  normalizeCounts(execution.counts);
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(clean(execution.edge_request_id))
      || !/^[0-9a-f]{64}$/.test(clean(execution.terminal_body_sha256))
      || !/^[0-9a-f]{64}$/.test(clean(execution.summary_sha256))) {
    throw new GateError('drainer_correlation_broken');
  }
  const credential = exactObject(terminal.linear_credential_receipt, 'credential_receipt_missing');
  if (credential.schema !== CREDENTIAL_SCHEMA
      || credential.receipt_type !== 'linear_graphql_viewer_accepted'
      || credential.accepted !== true
      || credential.mutation_attempted !== false
      || !/^[0-9a-f]{64}$/.test(clean(credential.viewer_identity_sha256))) {
    throw new GateError('credential_receipt_missing');
  }
  return terminal;
}

function proofGate(name, fn) {
  try {
    const value = fn();
    return { name, status: 'PASS', value };
  } catch (error) {
    return {
      name,
      status: 'FAIL',
      failure_code: error instanceof GateError ? error.code : `${name}_failed`,
    };
  }
}

function buildEvidenceReceipt(options) {
  const mode = clean(options.mode).toLowerCase();
  if (!['pre-f2', 'post-f2'].includes(mode)) throw new GateError('mode_invalid');
  const releaseSha = clean(options.releaseSha).toLowerCase();
  const binder = clean(options.binder);
  if (!/^[0-9a-f]{40}$/.test(releaseSha) || !/^[a-zA-Z0-9._:-]{16,128}$/.test(binder)) {
    throw new GateError('release_binder_invalid');
  }
  const binderSha256 = sha256(`graphics-f2\n${binder}`);
  const expectedLegacyParity = exactInteger(options.expectedLegacyParity, 'legacy_parity_expectation_invalid', 50);
  const acknowledgement = clean(options.legacyParityAck).toLowerCase();
  if ((expectedLegacyParity === 0 && acknowledgement)
      || (expectedLegacyParity > 0 && !/^[0-9a-f]{64}$/.test(acknowledgement))) {
    throw new GateError('legacy_parity_acknowledgement_invalid');
  }

  const gates = [];
  const terminalGate = proofGate('correlation_chain', () => validateTerminal(options.terminal, releaseSha));
  gates.push(terminalGate);
  const terminal = terminalGate.value;

  const observerGate = proofGate('outside_n8n_observer', () => {
    if (!terminal) throw new GateError('outside_observer_absent');
    return validateObserver(options.observer, terminal, releaseSha);
  });
  gates.push(observerGate);

  const fingerprintGate = proofGate('same_release_source', () => validateFingerprint(options.fingerprint, releaseSha));
  gates.push(fingerprintGate);

  const credentialGate = proofGate('typed_linear_credential', () => {
    if (!terminal) throw new GateError('credential_receipt_missing');
    return terminal.linear_credential_receipt;
  });
  gates.push(credentialGate);

  const snapshot = options.snapshot;
  const readOnlyGate = proofGate('postgres_read_only', () => {
    const value = exactObject(snapshot, 'postgres_readonly_snapshot_failed');
    const server = exactInteger(value.server_version_num, 'postgres_version_invalid');
    if (value.transaction_read_only !== 'on') throw new GateError('postgres_not_read_only');
    if (options.requirePostgres17 && (server < 170000 || server >= 180000)) {
      throw new GateError('postgres_version_invalid');
    }
    return { status: 'PASS', server_version_num: server, transaction_read_only: 'on' };
  });
  gates.push(readOnlyGate);

  const flagGate = proofGate('runtime_flag_readback', () => {
    const flags = parseFlags(snapshot && snapshot.flags);
    const expectedMode = mode === 'pre-f2' ? 'off' : 'live';
    if (flags.authority.video !== 'linear' || flags.authority.graphics !== 'linear') {
      throw new GateError('authority_not_linear_linear');
    }
    if (flags.outbound_mode !== expectedMode) throw new GateError(`outbound_not_${expectedMode}`);
    if (terminal && (terminal.drainer_execution.mode !== expectedMode
        || terminal.drainer_execution.authority.video !== 'linear'
        || terminal.drainer_execution.authority.graphics !== 'linear')) {
      throw new GateError('drainer_runtime_readback_mismatch');
    }
    return flags;
  });
  gates.push(flagGate);

  const residueGate = proofGate('exact_both_team_residue', () => {
    const receipt = residueReceipt(snapshot && snapshot.residue_rows);
    if (receipt.exact_count !== 0) throw Object.assign(new GateError('residue_requires_owner_classification'), { receipt });
    return receipt;
  });
  if (residueGate.status === 'FAIL') {
    try { residueGate.value = residueReceipt(snapshot && snapshot.residue_rows); } catch (_) {}
  }
  gates.push(residueGate);

  const terminalEventGate = proofGate('terminal_event_binding', () => {
    if (!terminal) throw new GateError('terminal_event_missing');
    validateSummaryEvent(snapshot && snapshot.summary_event, terminal);
    return {
      event_id: terminal.drainer_execution.event_id,
      summary_sha256: terminal.drainer_execution.summary_sha256,
      terminal_body_sha256: terminal.drainer_execution.terminal_body_sha256,
    };
  });
  gates.push(terminalEventGate);

  const writesGate = proofGate('typed_write_receipts', () => {
    if (!terminal) throw new GateError('written_inventory_invalid');
    const counts = normalizeCounts(terminal.drainer_execution.counts);
    const receipt = writtenReceipt(snapshot && snapshot.written_rows,
      terminal.linear_credential_receipt, counts);
    if (receipt.normal_lane_count !== 0) throw new GateError('normal_lane_write_present');
    if (receipt.legacy_parity_count !== expectedLegacyParity) {
      throw new GateError('legacy_parity_write_count_unacknowledged');
    }
    if (receipt.legacy_parity_count > 0 && !acknowledgement) {
      throw new GateError('legacy_parity_acknowledgement_missing');
    }
    return {
      ...receipt,
      expected_legacy_parity_written: expectedLegacyParity,
      acknowledgement_sha256: acknowledgement || null,
    };
  });
  gates.push(writesGate);

  const preReceiptGate = proofGate('pre_post_binder', () => {
    if (mode === 'pre-f2') return { status: 'PASS', pre_receipt_sha256: null };
    const bytes = Buffer.from(options.preReceiptBytes || []);
    let pre;
    try { pre = JSON.parse(bytes.toString('utf8')); } catch (_) {
      throw new GateError('pre_receipt_invalid');
    }
    if (pre.schema !== EVIDENCE_SCHEMA || pre.mode !== 'pre-f2' || pre.status !== 'PASS'
        || pre.release_sha !== releaseSha || pre.binder_sha256 !== binderSha256
        || stableJson(pre.function_source_sha256 || {}) !== stableJson(fingerprintGate.value || {})) {
      throw new GateError('pre_post_binder_mismatch');
    }
    return { status: 'PASS', pre_receipt_sha256: sha256(bytes) };
  });
  gates.push(preReceiptGate);

  const failed = gates.filter(gate => gate.status !== 'PASS');
  const residue = residueGate.value || {
    exact_count: null,
    inventory_sha256: null,
    classifications: [],
    requires_owner_classification: true,
  };
  const result = {
    schema: EVIDENCE_SCHEMA,
    status: failed.length ? 'FAIL' : 'PASS',
    mode,
    release_sha: releaseSha,
    binder_sha256: binderSha256,
    function_source_sha256: fingerprintGate.value || {},
    authority: flagGate.value ? flagGate.value.authority : { video: 'unknown', graphics: 'unknown' },
    outbound_mode: flagGate.value ? flagGate.value.outbound_mode : 'unknown',
    residue,
    correlation_chain: terminal && terminalEventGate.value ? {
      status: terminalGate.status === 'PASS' && terminalEventGate.status === 'PASS' ? 'PASS' : 'FAIL',
      correlation_id_sha256: sha256(terminal.correlation_id),
      edge_request_id_sha256: sha256(terminal.drainer_execution.edge_request_id),
      terminal_event_id: terminal.drainer_execution.event_id,
      terminal_body_sha256: terminal.drainer_execution.terminal_body_sha256,
      terminal_summary_sha256: terminal.drainer_execution.summary_sha256,
    } : { status: 'FAIL' },
    linear_credential_receipt: credentialGate.value ? {
      schema: CREDENTIAL_SCHEMA,
      status: 'PASS',
      receipt_type: credentialGate.value.receipt_type,
      viewer_identity_sha256: credentialGate.value.viewer_identity_sha256,
    } : { schema: CREDENTIAL_SCHEMA, status: 'FAIL' },
    writes: writesGate.value || {
      exact_count: null,
      normal_lane_count: null,
      legacy_parity_count: null,
      linear_accepted_count: null,
      inventory_sha256: null,
      classifications: [],
      expected_legacy_parity_written: expectedLegacyParity,
      acknowledgement_sha256: acknowledgement || null,
    },
    observer: observerGate.value || { type: 'github_actions', status: 'FAIL' },
    postgres: readOnlyGate.value || { status: 'FAIL' },
    pre_receipt_sha256: preReceiptGate.value ? preReceiptGate.value.pre_receipt_sha256 : null,
    failed_gates: failed.map(gate => ({ gate: gate.name, code: gate.failure_code })),
  };
  return result;
}

function parseArgs(argv) {
  const command = clean(argv[0]);
  const values = {};
  for (const arg of argv.slice(1)) {
    if (!arg.startsWith('--') || !arg.includes('=')) throw new GateError('argument_invalid');
    const index = arg.indexOf('=');
    const key = arg.slice(2, index).replace(/-/g, '_');
    if (!key || Object.prototype.hasOwnProperty.call(values, key)) throw new GateError('argument_invalid');
    values[key] = arg.slice(index + 1);
  }
  return { command, values };
}

function required(values, key) {
  const value = clean(values[key]);
  if (!value) throw new GateError(`argument_${key}_required`);
  return value;
}

function writeCanonical(file, value) {
  const bytes = Buffer.from(`${stableJson(value)}\n`, 'utf8');
  if (file) fs.writeFileSync(path.resolve(file), bytes, { mode: 0o600 });
  process.stdout.write(bytes);
}

function publicFailure(command, error) {
  return {
    schema: command === 'drainer-terminal' ? DRAINER_SCHEMA : EVIDENCE_SCHEMA,
    status: 'FAIL',
    mode: ['pre-f2', 'post-f2'].includes(command) ? command : null,
    failed_gates: [{
      gate: command === 'drainer-terminal' ? 'terminal_artifact' : 'operator_input',
      code: error instanceof GateError ? error.code : 'unexpected_failure',
    }],
  };
}

function runCli(argv = process.argv.slice(2)) {
  let parsed = { command: clean(argv[0]), values: {} };
  try {
    parsed = parseArgs(argv);
    const { command, values } = parsed;
    if (command === 'drainer-terminal') {
      const context = readJson(required(values, 'context'), 'dispatch_context_invalid');
      const headersBytes = readBounded(required(values, 'headers'), 'drainer_headers_invalid', 1024 * 1024);
      const bodyBytes = readBounded(required(values, 'body'), 'drainer_body_invalid');
      const credential = readJson(required(values, 'credential'), 'credential_receipt_missing');
      const receipt = buildDrainerTerminal({ context, headersBytes, bodyBytes, credential });
      writeCanonical(values.output, receipt);
      return receipt;
    }
    if (!['pre-f2', 'post-f2'].includes(command)) throw new GateError('command_invalid');
    const terminal = readJson(required(values, 'drainer_receipt'), 'drainer_terminal_invalid');
    const observer = readJson(required(values, 'observer_receipt'), 'outside_observer_absent');
    const fingerprint = readJson(required(values, 'function_fingerprint'), 'deployed_source_unpinned');
    const releaseSha = required(values, 'release_sha');
    const databaseUrl = clean(process.env.F2_DATABASE_URL);
    if (!databaseUrl) throw new GateError('database_url_missing');
    const snapshot = capturePostgresSnapshot({
      databaseUrl,
      eventId: terminal && terminal.drainer_execution && terminal.drainer_execution.event_id,
      startedAt: terminal && terminal.drainer_execution && terminal.drainer_execution.started_at,
      finishedAt: terminal && terminal.drainer_execution && terminal.drainer_execution.finished_at,
      allowDisposable: values.allow_disposable === 'true',
    });
    const preReceiptBytes = command === 'post-f2'
      ? readBounded(required(values, 'pre_receipt'), 'pre_receipt_invalid')
      : null;
    const receipt = buildEvidenceReceipt({
      mode: command,
      releaseSha,
      binder: required(values, 'binder'),
      expectedLegacyParity: clean(values.expected_legacy_parity_written || '0'),
      legacyParityAck: clean(values.legacy_parity_ack_sha256),
      terminal,
      observer,
      fingerprint,
      snapshot,
      preReceiptBytes,
      requirePostgres17: values.require_postgres_17 === 'true',
    });
    writeCanonical(values.output, receipt);
    if (receipt.status !== 'PASS') process.exitCode = 1;
    return receipt;
  } catch (error) {
    const receipt = publicFailure(parsed.command, error);
    writeCanonical(parsed.values && parsed.values.output, receipt);
    process.exitCode = 1;
    return receipt;
  }
}

if (require.main === module) runCli();
else {
  module.exports = {
    CREDENTIAL_SCHEMA,
    DISPATCH_SCHEMA,
    DRAINER_SCHEMA,
    EVIDENCE_SCHEMA,
    GateError,
    PROJECT_REF,
    buildDrainerTerminal,
    buildEvidenceReceipt,
    capturePostgresSnapshot,
    deterministicCorrelation,
    residueReceipt,
    runCli,
    sha256,
    snapshotSql,
    stableJson,
    validateFingerprint,
    validateObserver,
    writtenReceipt,
  };
}
