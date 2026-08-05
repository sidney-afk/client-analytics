#!/usr/bin/env node
'use strict';

/**
 * Fail-closed Graphics F2 flip-night pre-flight.
 *
 * This command is read-only. It proves one just-completed scheduled drainer is
 * the newest outbound-drainer run on the exact release, bookends the database
 * snapshot with zero active drainer runs, and inventories every production
 * pending/failed/shadow_ok row without filtering team, parity lane, attempts,
 * or retry time.
 *
 * Supported production invocation is the manual-only
 * .github/workflows/graphics-f2-preflight.yml workflow. It supplies the
 * dedicated F2 read-only PostgreSQL URL and GitHub Actions read token without
 * provisioning any new credential.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const {
  EVIDENCE_SCHEMA,
  acceptedPublicExecuteReceipt,
  databaseConnection,
  parseFlags,
} = require('./graphics-f2-evidence.js');

const REPOSITORY = 'sidney-afk/client-analytics';
const WORKFLOW_PATH = '.github/workflows/linear-outbound-drain.yml';
const WORKFLOW_FILE = 'linear-outbound-drain.yml';
const EVIDENCE_WORKFLOW_PATH = '.github/workflows/graphics-f2-evidence.yml';
const OWNER_LOGIN = 'sidney-afk';
const QUEUE_SCHEMA = 'syncview.graphics-f2-preflight-queue.v2';
const ACTIVE_SWEEP_STATUSES = Object.freeze([
  'queued', 'in_progress', 'waiting', 'requested', 'pending',
]);
const RESIDUE_STATUSES = Object.freeze(['pending', 'failed', 'shadow_ok']);
const MAX_SCHEDULE_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const SHA_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[1-9][0-9]{0,19}$/;
const ROW_ID_RE = /^[1-9][0-9]{0,30}$/;
const MAX_GITHUB_RUNS = 10_000;
const GITHUB_PAGE_SIZE = 100;

class PreflightError extends Error {
  constructor(code, details = null) {
    super(code);
    this.name = 'PreflightError';
    this.code = code;
    this.details = details;
  }
}

function reject(code, details) {
  throw new PreflightError(code, details);
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

function readBounded(pathValue, code, maximum = 2 * 1024 * 1024) {
  const file = clean(pathValue);
  if (!file) reject(code);
  let bytes;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum) reject(code);
    bytes = fs.readFileSync(file);
  } catch (error) {
    if (error instanceof PreflightError) throw error;
    reject(code);
  }
  return bytes;
}

function exactObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(code);
  return value;
}

function exactInteger(value, code, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum) reject(code);
  return number;
}

function queueSnapshotSql() {
  return `
begin transaction isolation level repeatable read read only;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
with residue as materialized (
  select o.id::text as id, o.team, o.status
  from public.mirror_outbox o
  where o.test_only = false
    and o.status in ('pending', 'failed', 'shadow_ok')
), role_boundary as (
  select jsonb_build_object(
    'current_user', current_user,
    'session_user', session_user,
    'current_database', current_database(),
    'is_superuser', coalesce((select r.rolsuper from pg_roles r where r.rolname = current_user), true),
    'can_create_role', coalesce((select r.rolcreaterole from pg_roles r where r.rolname = current_user), true),
    'can_create_database', coalesce((select r.rolcreatedb from pg_roles r where r.rolname = current_user), true),
    'can_replicate', coalesce((select r.rolreplication from pg_roles r where r.rolname = current_user), true),
    'can_bypass_rls', coalesce((select r.rolbypassrls from pg_roles r where r.rolname = current_user), true),
    'owns_current_database', coalesce((
      select d.datdba = (select r.oid from pg_roles r where r.rolname = current_user)
      from pg_database d
      where d.datname = current_database()
    ), true),
    'can_create_current_database', has_database_privilege(current_user, current_database(), 'CREATE'),
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
      cross join lateral aclexplode(c.relacl)
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
      cross join lateral aclexplode(c.relacl)
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
            and p.polroles = array[(select r.oid from pg_roles r where r.rolname = current_user)]
            and regexp_replace(coalesce(pg_get_expr(p.polqual, p.polrelid), ''), '[()[:space:]]', '', 'g') = 'true'
        )
        and not exists (
          select 1
          from pg_policy p
          where p.polrelid = to_regclass(required.relation_name)
            and p.polcmd in ('r', '*')
            and p.polroles @> array[0::oid]
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
    'mirror_outbox_test_only_not_null', coalesce((
      select a.attnotnull
      from pg_attribute a
      where a.attrelid = 'public.mirror_outbox'::regclass
        and a.attname = 'test_only'
        and not a.attisdropped
    ), false),
    'can_write_application_tables', coalesce((
      select bool_or(
        has_table_privilege(current_user, c.oid, 'INSERT')
        or has_table_privilege(current_user, c.oid, 'UPDATE')
        or has_table_privilege(current_user, c.oid, 'DELETE')
        or has_table_privilege(current_user, c.oid, 'TRUNCATE')
        or has_table_privilege(current_user, c.oid, 'TRIGGER')
        or has_table_privilege(current_user, c.oid, 'REFERENCES')
        or case
          when current_setting('server_version_num')::integer >= 170000
            then has_table_privilege(current_user, c.oid, 'MAINTAIN')
          else false
        end
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'm', 'f')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
    ), false),
    'can_write_application_columns', coalesce((
      select bool_or(
        has_any_column_privilege(current_user, c.oid, 'INSERT')
        or has_any_column_privilege(current_user, c.oid, 'UPDATE')
        or has_any_column_privilege(current_user, c.oid, 'REFERENCES')
      )
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'p', 'v', 'f')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
    ), false),
    'direct_function_execute_privilege_count', (
      select count(*)::integer
      from pg_proc p
      cross join lateral aclexplode(p.proacl) acl
      where acl.grantee = (select r.oid from pg_roles r where r.rolname = current_user)
        and acl.privilege_type = 'EXECUTE'
    ),
    'application_function_execute_privileges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'identity', format('%I.%I(%s)', n.nspname, p.proname,
          pg_get_function_identity_arguments(p.oid)),
        'routine_kind', case p.prokind
          when 'p' then 'procedure'
          when 'w' then 'window_function'
          when 'a' then 'aggregate'
          else 'function'
        end,
        'security_definer', p.prosecdef
          or aggregate_support.has_security_definer
          or range_support.has_security_definer,
        'security_definer_via_aggregate_support', aggregate_support.has_security_definer,
        'security_definer_via_range_support', range_support.has_security_definer,
        'returns_trigger', p.prorettype = 'pg_catalog.trigger'::regtype,
        'granted_to_public', grants.granted_to_public,
        'granted_directly', grants.granted_directly,
        'owned_by_role', p.proowner = (select r.oid from pg_roles r where r.rolname = current_user),
        'effective_execute', has_schema_privilege(current_user, n.oid, 'USAGE')
          and has_function_privilege(current_user, p.oid, 'EXECUTE')
      ) order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      cross join lateral (
        select coalesce(bool_or(s.prosecdef), false) as has_security_definer
        from pg_aggregate a
        cross join lateral unnest(array[
          a.aggtransfn::oid,
          a.aggfinalfn::oid,
          a.aggcombinefn::oid,
          a.aggserialfn::oid,
          a.aggdeserialfn::oid,
          a.aggmtransfn::oid,
          a.aggminvtransfn::oid,
          a.aggmfinalfn::oid
        ]) as support(support_oid)
        join pg_proc s on s.oid = support_oid
        where a.aggfnoid = p.oid
          and support_oid <> 0::oid
      ) aggregate_support
      cross join lateral (
        select coalesce(bool_or(
          s.prosecdef
          and has_schema_privilege(current_user, t.typnamespace, 'USAGE')
          and has_type_privilege(current_user, t.oid, 'USAGE')
        ), false) as has_security_definer
        from pg_range r
        join pg_type t on t.oid = r.rngtypid
        join pg_proc s on s.oid = r.rngcanonical
        where p.prokind = 'f'
          and p.pronamespace = t.typnamespace
          and p.proname = t.typname
          and p.prorettype = t.oid
          and r.rngcanonical <> 0::oid
      ) range_support
      cross join lateral (
        select
          exists (
            select 1
            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
            where acl.grantee = 0::oid
              and acl.privilege_type = 'EXECUTE'
          ) as granted_to_public,
          exists (
            select 1
            from aclexplode(p.proacl) acl
            where acl.grantee = (select r.oid from pg_roles r where r.rolname = current_user)
              and acl.privilege_type = 'EXECUTE'
          ) as granted_directly
      ) grants
      where p.prokind in ('f', 'p', 'w', 'a')
        and n.nspname not in ('pg_catalog', 'information_schema')
        and n.nspname !~ '^pg_(toast|temp_)'
        and (
          grants.granted_directly
          or p.proowner = (select r.oid from pg_roles r where r.rolname = current_user)
          or range_support.has_security_definer
          or (
            has_schema_privilege(current_user, n.oid, 'USAGE')
            and has_function_privilege(current_user, p.oid, 'EXECUTE')
          )
        )
    ), '[]'::jsonb),
    'can_use_application_sequences', coalesce((
      select bool_or(
        has_sequence_privilege(current_user, c.oid, 'SELECT')
        or has_sequence_privilege(current_user, c.oid, 'USAGE')
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
  ) as value
)
select jsonb_build_object(
  'schema', '${QUEUE_SCHEMA}',
  'transaction_read_only', current_setting('transaction_read_only'),
  'role_boundary', (select value from role_boundary),
  'flags', coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', f.key,
      'value', f.value,
      'updated_at', f.updated_at
    ) order by f.key)
    from public.syncview_runtime_flags f
    where f.key in ('prod_authority', 'linear_outbound_enabled')
  ), '[]'::jsonb),
  'exact_count', (select count(*)::integer from residue),
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'team', r.team,
      'status', r.status
    ) order by r.id::bigint)
    from residue r
  ), '[]'::jsonb)
)::text;
commit;
`;
}

function validateQueueSnapshot(value, expectedRole, expectedDatabase = 'postgres') {
  const snapshot = exactObject(value, 'database_snapshot_invalid');
  if (snapshot.schema !== QUEUE_SCHEMA || snapshot.transaction_read_only !== 'on') {
    reject('database_read_only_unproven');
  }
  const role = exactObject(snapshot.role_boundary, 'database_role_boundary_invalid');
  const roleName = clean(expectedRole);
  let acceptedPublicExecute;
  try {
    acceptedPublicExecute = acceptedPublicExecuteReceipt(
      role.application_function_execute_privileges,
    );
  } catch (_) {
    reject('database_role_boundary_invalid');
  }
  if (!roleName
      || role.current_user !== roleName
      || role.session_user !== roleName
      || role.current_database !== clean(expectedDatabase)
      || role.is_superuser !== false
      || role.can_create_role !== false
      || role.can_create_database !== false
      || role.can_replicate !== false
      || role.can_bypass_rls !== false
      || role.owns_current_database !== false
      || role.can_create_current_database !== false
      || role.role_membership_count !== 0
      || role.required_select !== true
      || role.effective_select_relation_count !== 4
      || role.direct_select_relation_count !== 4
      || role.required_direct_select_count !== 4
      || role.full_visibility_policy_count !== 4
      || role.mirror_outbox_test_only_not_null !== true
      || role.can_write_application_tables !== false
      || role.can_write_application_columns !== false
      || role.direct_function_execute_privilege_count !== 0
      || role.can_use_application_sequences !== false
      || role.can_create_application_schema_object !== false) {
    reject('database_role_boundary_invalid');
  }
  const flags = (() => {
    try { return parseFlags(snapshot.flags); } catch (_) { reject('runtime_flags_invalid'); }
  })();
  if (flags.authority.video !== 'linear'
      || flags.authority.graphics !== 'linear'
      || flags.outbound_mode !== 'off') {
    reject('runtime_boundary_invalid');
  }
  const count = exactInteger(snapshot.exact_count, 'database_inventory_incomplete', 10_000_000);
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== count) {
    reject('database_inventory_incomplete');
  }
  const seen = new Set();
  let previousId = null;
  const rows = snapshot.rows.map(candidate => {
    const row = exactObject(candidate, 'database_row_invalid');
    const keys = Object.keys(row).sort();
    const id = clean(row.id);
    const team = clean(row.team);
    const status = clean(row.status);
    if (keys.join(',') !== 'id,status,team'
        || !ROW_ID_RE.test(id)
        || !team || team.length > 128 || /[\u0000-\u001f\u007f]/.test(team)
        || !RESIDUE_STATUSES.includes(status)
        || seen.has(id)
        || (previousId !== null && BigInt(id) <= BigInt(previousId))) {
      reject('database_row_invalid');
    }
    seen.add(id);
    previousId = id;
    return { id, team, status };
  });
  return {
    rows,
    count,
    authority: flags.authority,
    outbound_mode: flags.outbound_mode,
    accepted_public_execute: acceptedPublicExecute,
  };
}

function captureQueueSnapshot({ databaseUrl, spawn = spawnSync, allowDisposable = false }) {
  let connection;
  try {
    connection = databaseConnection(databaseUrl, allowDisposable);
  } catch (_) {
    reject('database_target_invalid');
  }
  const env = { ...connection.env, PGAPPNAME: 'graphics-f2-preflight-readonly' };
  const result = spawn('psql', [
    '-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-',
  ], {
    input: queueSnapshotSql(),
    encoding: 'utf8',
    env,
    windowsHide: true,
    timeout: 45_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!result || result.status !== 0 || result.error || result.signal || clean(result.stderr)) {
    reject('database_snapshot_failed');
  }
  const lines = clean(result.stdout).split(/\r?\n/).map(clean).filter(Boolean);
  if (lines.length !== 1) reject('database_snapshot_invalid');
  let parsed;
  try {
    parsed = JSON.parse(lines[0]);
  } catch (_) {
    reject('database_snapshot_invalid');
  }
  return validateQueueSnapshot(parsed, connection.databaseRole, connection.database);
}

function githubEnvironment(base = process.env) {
  const env = {};
  for (const key of [
    'PATH', 'Path', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
    'TEMP', 'TMP', 'LANG', 'LC_ALL', 'TZ', 'HOME', 'USERPROFILE',
  ]) {
    if (base[key] !== undefined) env[key] = base[key];
  }
  if (base.GH_TOKEN !== undefined) env.GH_TOKEN = base.GH_TOKEN;
  env.GH_HOST = 'github.com';
  env.NO_COLOR = '1';
  return env;
}

function ghApiJson(endpoint, { spawn = spawnSync, env = process.env } = {}) {
  if (!clean(env.GH_TOKEN)) reject('github_token_missing');
  const result = spawn('gh', ['api', '--method', 'GET', endpoint], {
    encoding: 'utf8',
    env: githubEnvironment(env),
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!result || result.status !== 0 || result.error || result.signal || clean(result.stderr)) {
    reject('github_read_failed');
  }
  try {
    return JSON.parse(clean(result.stdout));
  } catch (_) {
    reject('github_receipt_invalid');
  }
}

function normalizedRun(value, code) {
  const run = exactObject(value, code);
  const id = clean(run.id);
  const runAttempt = clean(run.run_attempt);
  const event = clean(run.event);
  const status = clean(run.status);
  const conclusion = clean(run.conclusion);
  const headSha = clean(run.head_sha).toLowerCase();
  const path = clean(run.path).split('@')[0];
  const createdAt = clean(run.created_at);
  const runStartedAt = clean(run.run_started_at);
  const updatedAt = clean(run.updated_at);
  if (!RUN_ID_RE.test(id)
      || !/^[1-9][0-9]{0,9}$/.test(runAttempt)
      || !event || !status
      || !SHA_RE.test(headSha)
      || !path
      || !Number.isFinite(Date.parse(createdAt))
      || (runStartedAt && !Number.isFinite(Date.parse(runStartedAt)))
      || !Number.isFinite(Date.parse(updatedAt))) {
    reject(code);
  }
  return {
    id,
    run_attempt: runAttempt,
    event,
    status,
    conclusion,
    head_sha: headSha,
    path,
    created_at: createdAt,
    run_started_at: runStartedAt || null,
    updated_at: updatedAt,
  };
}

function currentMainSha(ghRead) {
  const value = exactObject(
    ghRead(`repos/${REPOSITORY}/git/ref/heads/main`),
    'current_main_unproven',
  );
  const object = exactObject(value.object, 'current_main_unproven');
  const sha = clean(object.sha).toLowerCase();
  if (clean(value.ref) !== 'refs/heads/main'
      || clean(object.type) !== 'commit'
      || !SHA_RE.test(sha)) {
    reject('current_main_unproven');
  }
  return sha;
}

function loadWorkflowInventory(ghRead) {
  const runs = [];
  const ids = new Set();
  let total = null;
  for (let pageNumber = 1; pageNumber <= Math.ceil(MAX_GITHUB_RUNS / GITHUB_PAGE_SIZE); pageNumber++) {
    const page = exactObject(ghRead(
      `repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=${GITHUB_PAGE_SIZE}&page=${pageNumber}`,
    ), 'github_receipt_invalid');
    const pageTotal = exactInteger(page.total_count, 'github_receipt_invalid', MAX_GITHUB_RUNS);
    if (total === null) total = pageTotal;
    if (pageTotal !== total || !Array.isArray(page.workflow_runs)
        || page.workflow_runs.length > GITHUB_PAGE_SIZE) {
      reject('github_inventory_changed');
    }
    for (const candidate of page.workflow_runs) {
      let run = normalizedRun(candidate, 'github_receipt_invalid');
      if (ids.has(run.id)) reject('github_inventory_changed');
      if (Number(run.run_attempt) > 1) {
        const exactAttemptValue = ghRead(
          `repos/${REPOSITORY}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
        );
        const exactAttempt = normalizedRun(exactAttemptValue, 'github_attempt_invalid');
        const attemptRepository = exactObject(exactAttemptValue, 'github_attempt_invalid').repository;
        const comparable = runValue => ({
          id: runValue.id,
          run_attempt: runValue.run_attempt,
          event: runValue.event,
          status: runValue.status,
          conclusion: runValue.conclusion,
          head_sha: runValue.head_sha,
          path: runValue.path,
          run_started_at: runValue.run_started_at,
          updated_at: runValue.updated_at,
        });
        if (clean(attemptRepository && attemptRepository.full_name) !== REPOSITORY
            || stableJson(comparable(exactAttempt)) !== stableJson(comparable(run))) {
          reject('github_attempt_invalid');
        }
        run = exactAttempt;
      }
      ids.add(run.id);
      runs.push(run);
    }
    if (runs.length === total) break;
    if (runs.length > total || page.workflow_runs.length !== GITHUB_PAGE_SIZE) {
      reject('github_inventory_incomplete');
    }
  }
  if (total === null || runs.length !== total) reject('github_inventory_incomplete');
  return runs;
}

function loadActiveWorkflowRuns(ghRead) {
  const active = [];
  const ids = new Set();
  for (const status of ACTIVE_SWEEP_STATUSES) {
    let total = null;
    for (let pageNumber = 1; pageNumber <= 10; pageNumber++) {
      const page = exactObject(ghRead(
        `repos/${REPOSITORY}/actions/workflows/${WORKFLOW_FILE}/runs?status=${status}&per_page=${GITHUB_PAGE_SIZE}&page=${pageNumber}`,
      ), 'github_receipt_invalid');
      const pageTotal = exactInteger(page.total_count, 'github_receipt_invalid', 1000);
      if (total === null) total = pageTotal;
      if (pageTotal !== total || !Array.isArray(page.workflow_runs)
          || page.workflow_runs.length > GITHUB_PAGE_SIZE) {
        reject('github_active_inventory_changed');
      }
      for (const candidate of page.workflow_runs) {
        const run = normalizedRun(candidate, 'github_receipt_invalid');
        if (run.status !== status || ids.has(run.id)) reject('github_active_inventory_changed');
        ids.add(run.id);
        active.push(run);
      }
      const statusCount = active.filter(run => run.status === status).length;
      if (statusCount === total) break;
      if (statusCount > total || page.workflow_runs.length !== GITHUB_PAGE_SIZE) {
        reject('github_active_inventory_incomplete');
      }
    }
    if (active.filter(run => run.status === status).length !== total) {
      reject('github_active_inventory_incomplete');
    }
  }
  return active;
}

function verifyPreReceipt({
  releaseSha,
  binder,
  preEvidenceRunId,
  preReceiptPath,
  preReceiptChecksumPath,
  ghRead = endpoint => ghApiJson(endpoint),
}) {
  const sha = clean(releaseSha).toLowerCase();
  const runId = clean(preEvidenceRunId);
  const binderValue = clean(binder);
  if (!SHA_RE.test(sha)) reject('release_sha_invalid');
  if (!RUN_ID_RE.test(runId)) reject('pre_evidence_run_id_invalid');
  if (!/^[a-zA-Z0-9._:-]{16,128}$/.test(binderValue)) reject('binder_invalid');

  const receiptBytes = readBounded(preReceiptPath, 'pre_receipt_invalid');
  const checksumBytes = readBounded(preReceiptChecksumPath, 'pre_receipt_checksum_invalid', 4096);
  const checksumLines = clean(checksumBytes).split(/\r?\n/).filter(Boolean);
  const checksumMatch = checksumLines.length === 1
    ? /^([0-9a-f]{64})\s+\*?.*receipt\.json$/.exec(checksumLines[0]) : null;
  const receiptSha256 = sha256(receiptBytes);
  if (!checksumMatch || checksumMatch[1] !== receiptSha256) {
    reject('pre_receipt_checksum_invalid');
  }
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString('utf8')); } catch (_) {
    reject('pre_receipt_invalid');
  }

  const metadataValue = ghRead(`repos/${REPOSITORY}/actions/runs/${runId}`);
  const metadata = normalizedRun(metadataValue, 'pre_evidence_run_invalid');
  const rawMetadata = exactObject(metadataValue, 'pre_evidence_run_invalid');
  const evidence = exactObject(receipt.evidence_workflow, 'pre_receipt_invalid');
  const authority = exactObject(receipt.authority, 'pre_receipt_invalid');
  const handoff = exactObject(receipt.handoff_order, 'pre_receipt_invalid');
  const residue = exactObject(receipt.residue, 'pre_receipt_invalid');
  const writes = exactObject(receipt.writes, 'pre_receipt_invalid');
  const correlation = exactObject(receipt.correlation_chain, 'pre_receipt_invalid');
  const eligibility = exactObject(receipt.dispatch_eligibility, 'pre_receipt_invalid');
  const credential = exactObject(receipt.linear_credential_receipt, 'pre_receipt_invalid');
  const observer = exactObject(receipt.observer, 'pre_receipt_invalid');
  const postgres = exactObject(receipt.postgres, 'pre_receipt_invalid');
  const sourceHashes = exactObject(receipt.function_source_sha256, 'pre_receipt_invalid');
  if (clean(rawMetadata.repository && rawMetadata.repository.full_name) !== REPOSITORY
      || metadata.id !== runId
      || metadata.path !== EVIDENCE_WORKFLOW_PATH
      || metadata.event !== 'workflow_dispatch'
      || metadata.status !== 'completed'
      || metadata.conclusion !== 'success'
      || metadata.head_sha !== sha
      || clean(rawMetadata.head_branch) !== 'main'
      || clean(rawMetadata.actor && rawMetadata.actor.login) !== OWNER_LOGIN
      || clean(rawMetadata.triggering_actor && rawMetadata.triggering_actor.login) !== OWNER_LOGIN
      || receipt.schema !== EVIDENCE_SCHEMA
      || receipt.status !== 'PASS'
      || receipt.mode !== 'pre-f2'
      || receipt.release_sha !== sha
      || receipt.binder_sha256 !== sha256(`graphics-f2\n${binderValue}`)
      || clean(evidence.workflow_run_id) !== runId
      || clean(evidence.workflow_run_attempt) !== metadata.run_attempt
      || authority.video !== 'linear' || authority.graphics !== 'linear'
      || receipt.outbound_mode !== 'off'
      || handoff.status !== 'PASS'
      || clean(handoff.pre_evidence_run_id) !== runId
      || residue.exact_count !== 0
      || writes.normal_lane_count !== 0
      || correlation.status !== 'PASS'
      || eligibility.status !== 'PASS'
      || credential.status !== 'PASS'
      || observer.status !== 'PASS'
      || postgres.status !== 'PASS'
      || postgres.transaction_read_only !== 'on'
      || !/^[0-9a-f]{64}$/.test(clean(sourceHashes['linear-outbound']))
      || !Array.isArray(receipt.failed_gates)
      || receipt.failed_gates.length !== 0) {
    reject('pre_receipt_invalid');
  }
  return {
    run_id: runId,
    run_attempt: metadata.run_attempt,
    completed_at: new Date(Date.parse(metadata.updated_at)).toISOString(),
    receipt_sha256: receiptSha256,
    binder_sha256: receipt.binder_sha256,
  };
}

function verifyClearAir({
  releaseSha,
  scheduledRunId,
  preCompletedAt,
  now = () => Date.now(),
  ghRead = endpoint => ghApiJson(endpoint),
}) {
  const sha = clean(releaseSha).toLowerCase();
  const runId = clean(scheduledRunId);
  const preCompleted = Date.parse(clean(preCompletedAt));
  if (!SHA_RE.test(sha)) reject('release_sha_invalid');
  if (!RUN_ID_RE.test(runId)) reject('scheduled_run_id_invalid');
  if (!Number.isFinite(preCompleted)) reject('pre_evidence_completion_invalid');
  if (currentMainSha(ghRead) !== sha) reject('current_main_moved');

  const scheduledValue = ghRead(`repos/${REPOSITORY}/actions/runs/${runId}`);
  const scheduled = normalizedRun(scheduledValue, 'scheduled_run_invalid');
  const repository = exactObject(scheduledValue, 'scheduled_run_invalid').repository;
  if (clean(repository && repository.full_name) !== REPOSITORY
      || scheduled.id !== runId
      || scheduled.path !== WORKFLOW_PATH
      || scheduled.event !== 'schedule'
      || scheduled.status !== 'completed'
      || scheduled.conclusion !== 'success'
      || scheduled.head_sha !== sha) {
    reject('scheduled_run_invalid');
  }

  const completedAt = Date.parse(scheduled.updated_at);
  const startedAt = Date.parse(clean(scheduled.run_started_at));
  if (!Number.isFinite(startedAt) || startedAt <= preCompleted || completedAt <= preCompleted) {
    reject('scheduled_run_not_after_pre_evidence');
  }
  const inventory = loadWorkflowInventory(ghRead);
  const selected = inventory.find(run => run.id === runId);
  if (!selected
      || selected.run_attempt !== scheduled.run_attempt
      || selected.updated_at !== scheduled.updated_at
      || selected.status !== 'completed'
      || selected.conclusion !== 'success') {
    reject('scheduled_run_inventory_mismatch');
  }
  const activeByInventory = inventory.filter(run => run.status !== 'completed');
  const activeByFinalSweep = loadActiveWorkflowRuns(ghRead);
  const active = [...activeByInventory, ...activeByFinalSweep]
    .filter((run, index, all) => all.findIndex(candidate => candidate.id === run.id) === index);
  if (active.length) {
    reject('active_drainer_present', {
      active: active.map(run => ({ id: run.id, event: run.event, status: run.status })),
    });
  }
  if (inventory.some(run => run.id !== runId
      && (Date.parse(run.updated_at) >= completedAt
        || (run.run_started_at && Date.parse(run.run_started_at) >= completedAt)))) {
    reject('scheduled_run_not_latest_completion');
  }

  if (currentMainSha(ghRead) !== sha) reject('current_main_moved');
  const currentTime = typeof now === 'function' ? Number(now()) : Number(now);
  const age = currentTime - completedAt;
  if (!Number.isFinite(currentTime)
      || age < -MAX_CLOCK_SKEW_MS
      || age > MAX_SCHEDULE_AGE_MS) {
    reject('scheduled_run_not_fresh');
  }
  const inventoryReceipt = inventory.map(run => ({
    id: run.id,
    run_attempt: run.run_attempt,
    status: run.status,
    conclusion: run.conclusion,
    run_started_at: run.run_started_at,
    updated_at: run.updated_at,
  }));
  return {
    scheduled_run_id: runId,
    scheduled_run_attempt: scheduled.run_attempt,
    release_sha: sha,
    scheduled_completed_at: new Date(completedAt).toISOString(),
    inventory_sha256: sha256(stableJson(inventoryReceipt)),
    checked_at: new Date(currentTime).toISOString(),
  };
}

function parseArgs(argv) {
  const values = {};
  for (const arg of argv) {
    const match = /^--([a-z0-9_-]+)=(.*)$/.exec(arg);
    if (!match || ![
      'release-sha', 'scheduled-run-id', 'pre-evidence-run-id', 'binder',
      'pre-receipt', 'pre-receipt-checksum',
    ].includes(match[1]) || values[match[1]] !== undefined) {
      reject('arguments_invalid');
    }
    values[match[1]] = match[2];
  }
  if (Object.keys(values).length !== 6) reject('arguments_invalid');
  return {
    releaseSha: values['release-sha'],
    scheduledRunId: values['scheduled-run-id'],
    preEvidenceRunId: values['pre-evidence-run-id'],
    binder: values.binder,
    preReceiptPath: values['pre-receipt'],
    preReceiptChecksumPath: values['pre-receipt-checksum'],
  };
}

function runPreflight({
  releaseSha,
  scheduledRunId,
  preEvidenceRunId,
  binder,
  preReceiptPath,
  preReceiptChecksumPath,
  databaseUrl,
}, {
  now = () => Date.now(),
  captureQueue = options => captureQueueSnapshot(options),
  clearAir = options => verifyClearAir(options),
  verifyPre = options => verifyPreReceipt(options),
} = {}) {
  const preOptions = {
    releaseSha,
    binder,
    preEvidenceRunId,
    preReceiptPath,
    preReceiptChecksumPath,
  };
  const preBefore = verifyPre(preOptions);
  let before = null;
  let beforeFailure = null;
  try {
    before = clearAir({
      releaseSha,
      scheduledRunId,
      preCompletedAt: preBefore.completed_at,
      now,
    });
  } catch (error) {
    beforeFailure = error;
  }
  const queue = captureQueue({ databaseUrl });
  if (queue.count !== 0) reject('production_residue', queue);
  if (beforeFailure) throw beforeFailure;
  const preAfter = verifyPre(preOptions);
  let after;
  try {
    after = clearAir({
      releaseSha,
      scheduledRunId,
      preCompletedAt: preBefore.completed_at,
      now,
    });
  } catch (error) {
    const diagnosticQueue = captureQueue({ databaseUrl });
    if (diagnosticQueue.count !== 0) reject('production_residue', diagnosticQueue);
    throw error;
  }
  if (before.scheduled_run_id !== after.scheduled_run_id
      || before.scheduled_run_attempt !== after.scheduled_run_attempt
      || before.release_sha !== after.release_sha
      || before.scheduled_completed_at !== after.scheduled_completed_at
      || before.inventory_sha256 !== after.inventory_sha256
      || stableJson(preBefore) !== stableJson(preAfter)) {
    reject('clear_air_changed');
  }
  return { ...after, pre_evidence: preAfter };
}

function failureLines(error) {
  const code = error instanceof PreflightError ? error.code : 'unexpected_failure';
  if (code === 'production_residue' && error.details && Array.isArray(error.details.rows)) {
    const counts = Object.fromEntries(RESIDUE_STATUSES.map(status => [status, 0]));
    for (const row of error.details.rows) counts[row.status]++;
    return [
      `REFUSE graphics_f2_preflight production_residue=${error.details.rows.length} pending=${counts.pending} failed=${counts.failed} shadow_ok=${counts.shadow_ok}`,
      ...error.details.rows.map(row => JSON.stringify(row)),
    ];
  }
  if (code === 'active_drainer_present'
      && error.details && Array.isArray(error.details.active)) {
    return [
      'REFUSE graphics_f2_preflight active_drainer_present',
      ...error.details.active.map(run => JSON.stringify(run)),
    ];
  }
  return [`REFUSE graphics_f2_preflight ${code}`];
}

function runCli(argv = process.argv.slice(2), {
  env = process.env,
  stdout = line => console.log(line),
  stderr = line => console.error(line),
  run = options => runPreflight(options),
} = {}) {
  try {
    const parsed = parseArgs(argv);
    const result = run({
      ...parsed,
      databaseUrl: clean(env.F2_DATABASE_URL),
    });
    stdout(`GO graphics_f2_preflight production_residue=0 teams=all parity_lanes=both attempts=all retry_times=all scheduled_run_id=${result.scheduled_run_id} scheduled_run_attempt=${result.scheduled_run_attempt} pre_evidence_run_id=${result.pre_evidence.run_id} pre_receipt_sha256=${result.pre_evidence.receipt_sha256} binder_sha256=${result.pre_evidence.binder_sha256} release_sha=${result.release_sha}`);
    return 0;
  } catch (error) {
    for (const line of failureLines(error)) stderr(line);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = runCli();
} else {
  module.exports = {
    MAX_SCHEDULE_AGE_MS,
    PreflightError,
    QUEUE_SCHEMA,
    REPOSITORY,
    RESIDUE_STATUSES,
    WORKFLOW_FILE,
    WORKFLOW_PATH,
    captureQueueSnapshot,
    currentMainSha,
    failureLines,
    ghApiJson,
    loadWorkflowInventory,
    parseArgs,
    queueSnapshotSql,
    runCli,
    runPreflight,
    validateQueueSnapshot,
    verifyClearAir,
    verifyPreReceipt,
  };
}
