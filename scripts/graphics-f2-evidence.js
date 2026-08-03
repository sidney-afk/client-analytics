#!/usr/bin/env node
'use strict';

/**
 * Packaged F98 Graphics F2 evidence lane.
 *
 * Commands:
 *   drainer-terminal  Build the bounded terminal artifact for one existing
 *                     linear-outbound GitHub Actions execution.
 *   linear-credential Prove the protected Linear key is accepted by a typed
 *                     viewer read bound to the selected drainer terminal.
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
const LINEAR_URL = 'https://api.linear.app/graphql';
const DISPATCH_SCHEMA = 'syncview.graphics-f2-drainer-dispatch.v1';
const CREDENTIAL_SCHEMA = 'syncview.graphics-f2-linear-credential.v1';
const DRAINER_SCHEMA = 'syncview.graphics-f2-drainer-terminal.v1';
const EVIDENCE_SCHEMA = 'syncview.graphics-f2-evidence.v1';
const WORKFLOW_PATH = '.github/workflows/linear-outbound-drain.yml';
const EVIDENCE_WORKFLOW_PATH = '.github/workflows/graphics-f2-evidence.yml';
const REQUIRED_FUNCTIONS = ['linear-outbound'];
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
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(text)
      || !Number.isFinite(Date.parse(text))) throw new GateError(code);
  return new Date(text).toISOString();
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

function buildDrainerTerminal({ context, headersBytes, bodyBytes }) {
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
  if (clean(context.workflow_event) !== 'schedule') {
    throw new GateError('drainer_not_scheduled');
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
  };
}

function validateCredentialReceipt(value, terminal, releaseSha, evidenceRunId, evidenceRunAttempt) {
  const credential = exactObject(value, 'credential_receipt_missing');
  const observedAt = exactIso(credential.observed_at, 'credential_receipt_missing');
  if (credential.schema !== CREDENTIAL_SCHEMA
      || credential.receipt_type !== 'linear_graphql_viewer_accepted'
      || credential.accepted !== true
      || credential.mutation_attempted !== false
      || credential.correlation_id !== terminal.correlation_id
      || credential.release_sha !== releaseSha
      || clean(credential.drainer_workflow_run_id) !== terminal.dispatch.workflow_run_id
      || clean(credential.drainer_workflow_run_attempt) !== terminal.dispatch.workflow_run_attempt
      || clean(credential.evidence_workflow_run_id) !== evidenceRunId
      || clean(credential.evidence_workflow_run_attempt) !== evidenceRunAttempt
      || !/^[0-9a-f]{64}$/.test(clean(credential.viewer_identity_sha256))
      || Date.parse(observedAt) < Date.parse(terminal.drainer_execution.finished_at)) {
    throw new GateError('credential_receipt_missing');
  }
  return {
    schema: CREDENTIAL_SCHEMA,
    receipt_type: 'linear_graphql_viewer_accepted',
    accepted: true,
    viewer_identity_sha256: clean(credential.viewer_identity_sha256),
    observed_at: observedAt,
    mutation_attempted: false,
  };
}

async function buildLinearCredentialReceipt({ terminalValue, releaseSha, evidenceRunId, evidenceRunAttempt }) {
  const terminal = validateTerminal(terminalValue, clean(releaseSha).toLowerCase());
  const runId = clean(evidenceRunId);
  const runAttempt = clean(evidenceRunAttempt);
  if (!/^[1-9][0-9]{0,19}$/.test(runId) || !/^[1-9][0-9]{0,9}$/.test(runAttempt)) {
    throw new GateError('evidence_workflow_identity_invalid');
  }
  const key = clean(process.env.LINEAR_MIRROR_API_KEY);
  if (!key) throw new GateError('linear_credential_unavailable');
  let response;
  let payload;
  try {
    response = await fetch(LINEAR_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: key },
      body: JSON.stringify({
        query: 'query SyncViewGraphicsF2Credential { viewer { id } }',
        variables: {},
      }),
      signal: AbortSignal.timeout(30_000),
    });
    payload = await response.json();
  } catch (_) {
    throw new GateError('linear_credential_unavailable');
  }
  const errors = payload && Array.isArray(payload.errors) ? payload.errors : [];
  const viewerId = clean(payload && payload.data && payload.data.viewer && payload.data.viewer.id);
  if (!response.ok || errors.length || !viewerId) throw new GateError('linear_credential_rejected');
  return {
    schema: CREDENTIAL_SCHEMA,
    receipt_type: 'linear_graphql_viewer_accepted',
    accepted: true,
    correlation_id: terminal.correlation_id,
    release_sha: terminal.release_sha,
    drainer_workflow_run_id: terminal.dispatch.workflow_run_id,
    drainer_workflow_run_attempt: terminal.dispatch.workflow_run_attempt,
    evidence_workflow_run_id: runId,
    evidence_workflow_run_attempt: runAttempt,
    viewer_identity_sha256: sha256(viewerId),
    observed_at: new Date().toISOString(),
    mutation_attempted: false,
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
  'database_role', jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'is_superuser', coalesce((select r.rolsuper from pg_roles r where r.rolname = current_user), true),
    'can_create_role', coalesce((select r.rolcreaterole from pg_roles r where r.rolname = current_user), true),
    'can_create_database', coalesce((select r.rolcreatedb from pg_roles r where r.rolname = current_user), true),
    'can_replicate', coalesce((select r.rolreplication from pg_roles r where r.rolname = current_user), true),
    'can_bypass_rls', coalesce((select r.rolbypassrls from pg_roles r where r.rolname = current_user), true),
    'role_membership_count', (
      select count(*)::integer
      from pg_auth_members m
      where m.member = (select r.oid from pg_roles r where r.rolname = current_user)
    ),
    'required_select', (
      has_table_privilege(current_user, 'public.syncview_runtime_flags', 'SELECT')
      and has_table_privilege(current_user, 'public.mirror_outbox', 'SELECT')
      and has_table_privilege(current_user, 'public.flag_flips', 'SELECT')
      and has_table_privilege(current_user, 'public.deliverable_events', 'SELECT')
    ),
    'effective_select_relation_count', (
      select count(*)::integer
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (
          has_table_privilege(current_user, c.oid, 'SELECT')
          or has_any_column_privilege(current_user, c.oid, 'SELECT')
        )
    ),
    'direct_select_relation_count', (
      select count(distinct c.oid)::integer
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[]))
        as acl(grantor, grantee, privilege_type, is_grantable)
      where n.nspname = 'public'
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and acl.grantee = (select r.oid from pg_roles r where r.rolname = current_user)
        and acl.privilege_type = 'SELECT'
    ),
    'required_direct_select_count', (
      select count(distinct c.oid)::integer
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[]))
        as acl(grantor, grantee, privilege_type, is_grantable)
      where n.nspname = 'public'
        and c.relname in ('syncview_runtime_flags', 'mirror_outbox', 'flag_flips', 'deliverable_events')
        and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and acl.grantee = (select r.oid from pg_roles r where r.rolname = current_user)
        and acl.privilege_type = 'SELECT'
    ),
    'full_visibility_policy_count', (
      select count(*)::integer
      from (values
        ('public.syncview_runtime_flags'),
        ('public.mirror_outbox'),
        ('public.flag_flips'),
        ('public.deliverable_events')
      ) as required(relation_name)
      where row_security_active(to_regclass(required.relation_name))
        and exists (
          select 1
          from pg_policy p
          where p.polrelid = to_regclass(required.relation_name)
            and p.polcmd = 'r'
            and p.polpermissive
            and p.polroles @> array[(select r.oid from pg_roles r where r.rolname = current_user)]
            and regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '[()[:space:]]', '', 'g') = 'true'
        )
        and not exists (
          select 1
          from pg_policy p
          where p.polrelid = to_regclass(required.relation_name)
            and p.polcmd in ('r', '*')
            and not p.polpermissive
            and (
              p.polroles @> array[0::oid]
              or p.polroles @> array[(select r.oid from pg_roles r where r.rolname = current_user)]
            )
            and regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '[()[:space:]]', '', 'g') <> 'true'
        )
    ),
    'can_write_application_tables', coalesce((
      select bool_or(
        has_table_privilege(current_user, c.oid, 'INSERT')
        or has_table_privilege(current_user, c.oid, 'UPDATE')
        or has_table_privilege(current_user, c.oid, 'DELETE')
        or has_table_privilege(current_user, c.oid, 'TRUNCATE')
        or has_table_privilege(current_user, c.oid, 'TRIGGER')
        or has_table_privilege(current_user, c.oid, 'REFERENCES')
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'f')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
    ), false),
    'can_use_application_sequences', coalesce((
      select bool_or(
        has_sequence_privilege(current_user, c.oid, 'USAGE')
        or has_sequence_privilege(current_user, c.oid, 'UPDATE')
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'S'
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
    ), false),
    'can_create_application_schema_object', coalesce((
      select bool_or(has_schema_privilege(current_user, n.oid, 'CREATE'))
      from pg_namespace n
      where n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
    ), false)
  ),
  'flags', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', f.key,
      'value', f.value,
      'updated_at', f.updated_at
    ) order by f.key)
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
  'outbound_flip', (
    select jsonb_build_object(
      'id', ff.id::text,
      'old_value', ff.old_value,
      'new_value', ff.new_value,
      'ts', ff.ts
    )
    from public.flag_flips ff
    where ff.key = 'linear_outbound_enabled'
    order by ff.id desc
    limit 1
  ),
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
  let databaseRole = username;
  if (!allowDisposable) {
    const direct = hostname === `db.${PROJECT_REF}.supabase.co` && port === '5432';
    const poolerSuffix = `.${PROJECT_REF}`;
    const pooled = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
      && username.endsWith(poolerSuffix) && ['5432', '6543'].includes(port);
    if (pooled) databaseRole = username.slice(0, -poolerSuffix.length);
    const reservedRoles = new Set(['postgres', 'authenticator', 'service_role']);
    const dedicatedRole = /^[a-z_][a-z0-9_-]{2,62}$/.test(databaseRole)
      && !reservedRoles.has(databaseRole)
      && !databaseRole.startsWith('supabase_');
    if ((!direct && !pooled) || !dedicatedRole || !['require', 'verify-full'].includes(sslmode)) {
      throw new GateError('database_target_invalid');
    }
  } else if (process.env.F2_DISPOSABLE_CONFIRM !== 'GRAPHICS_F2_DISPOSABLE_ONLY') {
    throw new GateError('disposable_confirmation_missing');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, '') || 'postgres');
  if (!allowDisposable && database !== 'postgres') throw new GateError('database_target_invalid');
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
  return { env, database, databaseRole };
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
  try {
    const snapshot = JSON.parse(lines[0]);
    snapshot.connection_role = connection.databaseRole;
    return snapshot;
  } catch (_) {
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
  const perTeam = { video: 0, graphics: 0, other: 0 };
  for (const row of inventory) {
    perTeam[row.public_team] += 1;
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
    exact_per_team: perTeam,
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
    const key = clean(row.key);
    if (flags.has(key)) throw new GateError('runtime_flags_invalid');
    flags.set(key, {
      value: exactObject(row.value, 'runtime_flags_invalid'),
      updated_at: exactIso(row.updated_at, 'runtime_flags_invalid'),
    });
  }
  const authorityRow = flags.get('prod_authority');
  const outboundRow = flags.get('linear_outbound_enabled');
  if (!authorityRow || !outboundRow) throw new GateError('runtime_flags_invalid');
  const authority = authorityRow.value;
  const outbound = outboundRow.value;
  return {
    authority: {
      video: clean(authority.video).toLowerCase(),
      graphics: clean(authority.graphics).toLowerCase(),
    },
    outbound_mode: clean(outbound.mode).toLowerCase(),
    outbound_updated_at: outboundRow.updated_at,
  };
}

function outboundFlip(value) {
  if (value == null) return {
    id: '0',
    old_mode: null,
    new_mode: null,
    at: null,
  };
  const row = exactObject(value, 'outbound_flip_invalid');
  const id = clean(row.id);
  if (!/^[1-9][0-9]*$/.test(id)) throw new GateError('outbound_flip_invalid');
  const oldValue = exactObject(row.old_value, 'outbound_flip_invalid');
  const newValue = exactObject(row.new_value, 'outbound_flip_invalid');
  return {
    id,
    old_mode: clean(oldValue.mode).toLowerCase(),
    new_mode: clean(newValue.mode).toLowerCase(),
    at: exactIso(row.ts, 'outbound_flip_invalid'),
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
      || clean(metadata.event) !== 'schedule'
      || clean(terminal.dispatch.workflow_event) !== 'schedule') {
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

function validatePreEvidenceObserver(observer, preReceipt, releaseSha, expectedRunId) {
  const metadata = exactObject(observer, 'pre_evidence_observer_absent');
  const evidence = exactObject(preReceipt.evidence_workflow, 'pre_evidence_receipt_invalid');
  const runId = clean(metadata.id);
  const attempt = clean(metadata.run_attempt);
  const workflowPath = clean(metadata.path).split('@')[0];
  const completedAt = exactIso(metadata.updated_at, 'pre_evidence_observer_absent');
  if (!/^[1-9][0-9]{0,19}$/.test(runId)
      || !/^[1-9][0-9]{0,9}$/.test(attempt)
      || metadata.status !== 'completed'
      || metadata.conclusion !== 'success'
      || clean(metadata.head_sha).toLowerCase() !== releaseSha
      || workflowPath !== EVIDENCE_WORKFLOW_PATH
      || clean(metadata.event) !== 'workflow_dispatch'
      || runId !== clean(expectedRunId)
      || runId !== clean(evidence.workflow_run_id)
      || attempt !== clean(evidence.workflow_run_attempt)) {
    throw new GateError('pre_evidence_observer_absent');
  }
  return { run_id: runId, run_attempt: attempt, completed_at: completedAt };
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
  if (clean(terminal.dispatch.workflow_event) !== 'schedule') {
    throw new GateError('drainer_not_scheduled');
  }
  const execution = exactObject(terminal.drainer_execution, 'drainer_terminal_invalid');
  normalizeCounts(execution.counts);
  if (!/^[a-zA-Z0-9._:-]{8,200}$/.test(clean(execution.edge_request_id))
      || !/^[0-9a-f]{64}$/.test(clean(execution.terminal_body_sha256))
      || !/^[0-9a-f]{64}$/.test(clean(execution.summary_sha256))) {
    throw new GateError('drainer_correlation_broken');
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
  const evidenceRunId = clean(options.evidenceRunId);
  const evidenceRunAttempt = clean(options.evidenceRunAttempt);
  if (!/^[1-9][0-9]{0,19}$/.test(evidenceRunId)
      || !/^[1-9][0-9]{0,9}$/.test(evidenceRunAttempt)) {
    throw new GateError('evidence_workflow_identity_invalid');
  }
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
    return validateCredentialReceipt(
      options.credential,
      terminal,
      releaseSha,
      evidenceRunId,
      evidenceRunAttempt,
    );
  });
  gates.push(credentialGate);

  const snapshot = options.snapshot;
  const readOnlyGate = proofGate('postgres_read_only', () => {
    const value = exactObject(snapshot, 'postgres_readonly_snapshot_failed');
    const server = exactInteger(value.server_version_num, 'postgres_version_invalid');
    if (value.transaction_read_only !== 'on') throw new GateError('postgres_not_read_only');
    const role = exactObject(value.database_role, 'postgres_role_not_read_only');
    const currentRole = clean(role.current_user);
    if (!currentRole
        || currentRole !== clean(role.session_user)
        || currentRole !== clean(value.connection_role)
        || role.is_superuser !== false
        || role.can_create_role !== false
        || role.can_create_database !== false
        || role.can_replicate !== false
        || role.can_bypass_rls !== false
        || role.role_membership_count !== 0
        || role.required_select !== true
        || role.effective_select_relation_count !== 4
        || role.direct_select_relation_count !== 4
        || role.required_direct_select_count !== 4
        || role.full_visibility_policy_count !== 4
        || role.can_write_application_tables !== false
        || role.can_use_application_sequences !== false
        || role.can_create_application_schema_object !== false) {
      throw new GateError('postgres_role_not_read_only');
    }
    if (options.requirePostgres17 && (server < 170000 || server >= 180000)) {
      throw new GateError('postgres_version_invalid');
    }
    return {
      status: 'PASS',
      server_version_num: server,
      transaction_read_only: 'on',
      dedicated_role_sha256: sha256(currentRole),
      required_select: true,
      exact_select_relations: 4,
      full_visibility_policies: 4,
      write_privileges: false,
    };
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

  const flipGate = proofGate('outbound_flag_revision', () => outboundFlip(snapshot && snapshot.outbound_flip));
  gates.push(flipGate);

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
      credentialGate.value, counts);
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

  let preReceipt = null;
  const preReceiptGate = proofGate('pre_post_binder', () => {
    if (mode === 'pre-f2') return { status: 'PASS', pre_receipt_sha256: null };
    const bytes = Buffer.from(options.preReceiptBytes || []);
    try { preReceipt = JSON.parse(bytes.toString('utf8')); } catch (_) {
      throw new GateError('pre_receipt_invalid');
    }
    if (preReceipt.schema !== EVIDENCE_SCHEMA || preReceipt.mode !== 'pre-f2' || preReceipt.status !== 'PASS'
        || preReceipt.release_sha !== releaseSha || preReceipt.binder_sha256 !== binderSha256
        || stableJson(preReceipt.function_source_sha256 || {}) !== stableJson(fingerprintGate.value || {})) {
      throw new GateError('pre_post_binder_mismatch');
    }
    return { status: 'PASS', pre_receipt_sha256: sha256(bytes) };
  });
  gates.push(preReceiptGate);

  const orderGate = proofGate('pre_f2_post_order', () => {
    const flip = flipGate.value;
    if (!flip || !flagGate.value || !terminal) throw new GateError('handoff_order_invalid');
    if (BigInt(evidenceRunId) <= BigInt(terminal.dispatch.workflow_run_id)) {
      throw new GateError('evidence_run_not_after_drainer');
    }
    if (mode === 'pre-f2') {
      return {
        status: 'PASS',
        pre_evidence_run_id: evidenceRunId,
        f2_flag_flip_id: null,
        post_drainer_run_id: null,
      };
    }
    if (!preReceipt || preReceiptGate.status !== 'PASS') throw new GateError('pre_receipt_invalid');
    const preObserver = validatePreEvidenceObserver(
      options.preObserver,
      preReceipt,
      releaseSha,
      options.preEvidenceRunId,
    );
    const preControl = exactObject(preReceipt.control_revision, 'pre_evidence_receipt_invalid');
    const preFlipId = clean(preControl.outbound_flag_flip_id);
    if (!/^(?:0|[1-9][0-9]*)$/.test(preFlipId)
        || BigInt(terminal.dispatch.workflow_run_id) <= BigInt(preObserver.run_id)) {
      throw new GateError('post_drainer_not_after_pre_evidence');
    }
    if (BigInt(flip.id) <= BigInt(preFlipId)
        || flip.old_mode !== 'off' || flip.new_mode !== 'live') {
      throw new GateError('f2_flip_not_between_receipts');
    }
    const preCompletedAt = Date.parse(preObserver.completed_at);
    const flipAt = Date.parse(flip.at);
    const flagUpdatedAt = Date.parse(flagGate.value.outbound_updated_at);
    const postStartedAt = Date.parse(terminal.drainer_execution.started_at);
    if (!(flipAt > preCompletedAt && flagUpdatedAt > preCompletedAt
        && flipAt <= postStartedAt && flagUpdatedAt <= postStartedAt)) {
      throw new GateError('f2_flip_not_between_receipts');
    }
    return {
      status: 'PASS',
      pre_evidence_run_id: preObserver.run_id,
      f2_flag_flip_id: flip.id,
      post_drainer_run_id: terminal.dispatch.workflow_run_id,
      pre_completed_before_f2: true,
      f2_before_post_drainer: true,
    };
  });
  gates.push(orderGate);

  const failed = gates.filter(gate => gate.status !== 'PASS');
  const residue = residueGate.value || {
    exact_count: null,
    exact_per_team: { video: null, graphics: null, other: null },
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
    evidence_workflow: {
      workflow_run_id: evidenceRunId,
      workflow_run_attempt: evidenceRunAttempt,
    },
    function_source_sha256: fingerprintGate.value || {},
    authority: flagGate.value ? flagGate.value.authority : { video: 'unknown', graphics: 'unknown' },
    outbound_mode: flagGate.value ? flagGate.value.outbound_mode : 'unknown',
    control_revision: {
      outbound_flag_flip_id: flipGate.value ? flipGate.value.id : null,
    },
    handoff_order: orderGate.value || { status: 'FAIL' },
    residue,
    correlation_chain: terminal && terminalEventGate.value ? {
      status: terminalGate.status === 'PASS' && terminalEventGate.status === 'PASS' ? 'PASS' : 'FAIL',
      correlation_id_sha256: sha256(terminal.correlation_id),
      edge_request_id_sha256: sha256(terminal.drainer_execution.edge_request_id),
      terminal_event_id: terminal.drainer_execution.event_id,
      drainer_workflow_run_id: terminal.dispatch.workflow_run_id,
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
    schema: command === 'drainer-terminal' ? DRAINER_SCHEMA
      : command === 'linear-credential' ? CREDENTIAL_SCHEMA : EVIDENCE_SCHEMA,
    status: 'FAIL',
    mode: ['pre-f2', 'post-f2'].includes(command) ? command : null,
    failed_gates: [{
      gate: command === 'drainer-terminal' ? 'terminal_artifact'
        : command === 'linear-credential' ? 'linear_credential' : 'operator_input',
      code: error instanceof GateError ? error.code : 'unexpected_failure',
    }],
  };
}

async function runCli(argv = process.argv.slice(2)) {
  let parsed = { command: clean(argv[0]), values: {} };
  try {
    parsed = parseArgs(argv);
    const { command, values } = parsed;
    if (command === 'drainer-terminal') {
      const context = readJson(required(values, 'context'), 'dispatch_context_invalid');
      const headersBytes = readBounded(required(values, 'headers'), 'drainer_headers_invalid', 1024 * 1024);
      const bodyBytes = readBounded(required(values, 'body'), 'drainer_body_invalid');
      const receipt = buildDrainerTerminal({ context, headersBytes, bodyBytes });
      writeCanonical(values.output, receipt);
      return receipt;
    }
    if (command === 'linear-credential') {
      const terminalValue = readJson(required(values, 'drainer_receipt'), 'drainer_terminal_invalid');
      const receipt = await buildLinearCredentialReceipt({
        terminalValue,
        releaseSha: required(values, 'release_sha'),
        evidenceRunId: required(values, 'evidence_run_id'),
        evidenceRunAttempt: required(values, 'evidence_run_attempt'),
      });
      writeCanonical(values.output, receipt);
      return receipt;
    }
    if (!['pre-f2', 'post-f2'].includes(command)) throw new GateError('command_invalid');
    const terminal = readJson(required(values, 'drainer_receipt'), 'drainer_terminal_invalid');
    const observer = readJson(required(values, 'observer_receipt'), 'outside_observer_absent');
    const credential = readJson(required(values, 'credential_receipt'), 'credential_receipt_missing');
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
    const preObserver = command === 'post-f2'
      ? readJson(required(values, 'pre_observer_receipt'), 'pre_evidence_observer_absent')
      : null;
    const receipt = buildEvidenceReceipt({
      mode: command,
      releaseSha,
      binder: required(values, 'binder'),
      evidenceRunId: required(values, 'evidence_run_id'),
      evidenceRunAttempt: required(values, 'evidence_run_attempt'),
      preEvidenceRunId: clean(values.pre_evidence_run_id),
      expectedLegacyParity: clean(values.expected_legacy_parity_written || '0'),
      legacyParityAck: clean(values.legacy_parity_ack_sha256),
      terminal,
      credential,
      observer,
      fingerprint,
      snapshot,
      preReceiptBytes,
      preObserver,
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

if (require.main === module) void runCli();
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
    buildLinearCredentialReceipt,
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
