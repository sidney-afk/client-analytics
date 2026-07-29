#!/usr/bin/env node
'use strict';

/*
 * Hosted PostgreSQL 16 proof for the complete F27 database rollback path.
 *
 * This helper is deliberately restricted to an f27_-prefixed loopback
 * database carrying the disposable operator-fixture marker. It captures the
 * exact approved preinstall subset, generates the real private rollback
 * recipe, applies the parent migration through the one-shot operator, runs the
 * packaged reserved-team drill, executes the generated recipe, and performs an
 * independent catalog/data readback.
 *
 * All snapshot, recipe, and transcript files remain below one empty private
 * runner-temp directory and are deleted before the bounded public receipt is
 * emitted. The receipt contains only PASS values, counts, and SHA-256 hashes.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  captureSnapshot,
} = require('./f27-mirror-outbox-snapshot');
const {
  CONFIRMATION: APPLY_CONFIRMATION,
  applyMigration,
} = require('./f27-apply-migration');
const {
  MUTATING_F27_FUNCTIONS,
  generateRollbackRecipe,
} = require('./f27-database-rollback-recipe');
const {
  CONFIRMATION: EXECUTE_CONFIRMATION,
  executeRollback,
} = require('./f27-database-rollback-execute');
const {
  PsqlDisposableTransport,
  runF27Drill,
} = require('./f27-drill-runner');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROJECT_REF = 'f27proof000000000000';
const ACTOR = 'f27-postgres16-proof';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const DATABASE_RE = /^f27_[A-Za-z0-9_$-]{1,58}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FIXTURE_MARKER = 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE';

class PostgresRollbackProofError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PostgresRollbackProofError';
    this.code = code;
  }
}

function fail(code) {
  throw new PostgresRollbackProofError(code);
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
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = stableValue(value[key]);
      return result;
    }, {});
  }
  return value;
}

function same(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function registeredWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync(
      'git',
      ['-C', repoRoot, 'worktree', 'list', '--porcelain'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (_) {
    fail('WORKTREE_DISCOVERY_FAILED');
  }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => path.resolve(line.slice('worktree '.length).trim()))
    .filter(Boolean);
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED');
  return roots;
}

function validatePrivateRoot(value, worktrees) {
  if (!value || !path.isAbsolute(value)) fail('PRIVATE_ROOT_INVALID');
  const resolved = path.resolve(value);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch (_) {
    fail('PRIVATE_ROOT_INVALID');
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PRIVATE_ROOT_INVALID');
  let real;
  try {
    real = fs.realpathSync.native(resolved);
  } catch (_) {
    fail('PRIVATE_ROOT_INVALID');
  }
  if (path.resolve(real) !== resolved) fail('PRIVATE_ROOT_INVALID');
  if (worktrees.some(root => isWithin(root, resolved))) fail('PRIVATE_ROOT_WORKTREE_REJECTED');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_ROOT_PERMISSIONS_REQUIRED');
  }
  let entries;
  try {
    entries = fs.readdirSync(resolved);
  } catch (_) {
    fail('PRIVATE_ROOT_INVALID');
  }
  if (entries.length) fail('PRIVATE_ROOT_NOT_EMPTY');
  return resolved;
}

function cleanupPrivateRoot(privateRoot) {
  if (!privateRoot) return;
  try {
    fs.rmSync(privateRoot, { recursive: true, force: false });
  } catch (_) {
    fail('PRIVATE_ROOT_CLEANUP_FAILED');
  }
}

function validateTarget(options, env = process.env) {
  const database = clean(options.database);
  const releaseSha = clean(options.releaseSha);
  const host = clean(env.PGHOST).toLowerCase();
  const port = clean(env.PGPORT || '5432');
  const user = clean(env.PGUSER);
  if (!DATABASE_RE.test(database) || clean(env.PGDATABASE) !== database) {
    fail('DISPOSABLE_DATABASE_CONFIRMATION_REQUIRED');
  }
  if (!LOOPBACK_HOSTS.has(host) || port !== '5432' || user !== 'postgres') {
    fail('LOOPBACK_POSTGRES_REQUIRED');
  }
  if (!SHA_RE.test(releaseSha)) fail('RELEASE_SHA_INVALID');
  return { database, releaseSha };
}

function verifyCheckedOutRelease(repoRoot, releaseSha) {
  let head;
  let status;
  try {
    head = clean(execFileSync(
      'git',
      ['-C', repoRoot, 'rev-parse', 'HEAD'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ));
    status = execFileSync(
      'git',
      ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
  } catch (_) {
    fail('CHECKED_OUT_RELEASE_PROOF_FAILED');
  }
  if (head !== releaseSha || clean(status)) fail('CHECKED_OUT_RELEASE_MISMATCH');
  return true;
}

function localPsqlEnvironment(env, database) {
  const allowed = new Set([
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec',
    'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
    'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD',
  ]);
  const result = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (allowed.has(key)) result[key] = value;
  }
  return {
    ...result,
    PGDATABASE: database,
    PGSSLMODE: 'disable',
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'f27-database-rollback-postgres-proof',
    PGOPTIONS: '',
  };
}

function createLocalPsql(localEnv, spawn = spawnSync) {
  function run(args, input = null, options = {}) {
    const result = spawn('psql', args, {
      input,
      env: localEnv,
      encoding: options.encoding === null ? null : 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (!result || result.error || result.signal || result.status !== 0) {
      fail('LOCAL_PSQL_FAILED');
    }
    return result;
  }

  function version() {
    const result = spawn('psql', ['--version'], {
      env: localEnv,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result || result.error || result.signal || result.status !== 0
        || !/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(clean(result.stdout))) {
      fail('PSQL_VERSION_FAILED');
    }
    return clean(result.stdout);
  }

  function scalar(sql) {
    const result = run(['-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--command', sql]);
    const lines = clean(result.stdout).split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) fail('LOCAL_PSQL_SCALAR_INVALID');
    return lines[0];
  }

  function json(sql) {
    try {
      const parsed = JSON.parse(scalar(sql));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        fail('LOCAL_PSQL_JSON_INVALID');
      }
      return parsed;
    } catch (error) {
      if (error instanceof PostgresRollbackProofError) throw error;
      fail('LOCAL_PSQL_JSON_INVALID');
    }
  }

  return {
    version,
    scalar,
    json,
    snapshotAdapter: {
      version,
      capture(sql) {
        const result = run([
          '-X', '--quiet', '--no-align', '--tuples-only',
          '--set', 'ON_ERROR_STOP=1', '--file', '-',
        ], sql);
        if (clean(result.stderr)) fail('LOCAL_PSQL_CAPTURE_STDERR_REJECTED');
        return result.stdout;
      },
    },
    migrationAdapter: {
      run(args, _ignoredConnectionEnv, cwd, input) {
        return spawn('psql', args, {
          cwd,
          input,
          env: localEnv,
          encoding: null,
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      },
    },
    rollbackAdapter: {
      version,
      execute(argv, _ignoredConnectionEnv, input) {
        return spawn('psql', argv, {
          input,
          env: localEnv,
          encoding: null,
          windowsHide: true,
          maxBuffer: 1024 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      },
    },
  };
}

const BOUNDARY_STATE_SQL = String.raw`
WITH boundary_rows AS (
  SELECT
    p.oid::regprocedure::text AS identity,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'identity',p.oid::regprocedure::text,
      'owner',pg_get_userbyid(p.proowner),
      'acl',p.proacl,
      'config',p.proconfig,
      'definition',pg_get_functiondef(p.oid)
    )::text,'UTF8'),'sha256'),'hex') AS row_sha256
  FROM pg_proc p
  WHERE p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('public.track_b_f27_write_authorization(text)'),
    to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')
  )
), flag_rows AS (
  SELECT key,encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.syncview_runtime_flags f
  WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
), flip_rows AS (
  SELECT id,encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.flag_flips f
)
SELECT jsonb_build_object(
  'boundary',jsonb_build_object(
    'count',(SELECT count(*) FROM boundary_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY identity) FROM boundary_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'flags',jsonb_build_object(
    'count',(SELECT count(*) FROM flag_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY key) FROM flag_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'flag_flips',jsonb_build_object(
    'count',(SELECT count(*) FROM flip_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY id) FROM flip_rows
    ),''),'UTF8'),'sha256'),'hex')
  )
)::text
`;

const MUTATING_VALUES_SQL = MUTATING_F27_FUNCTIONS
  .map(identity => `('${identity.replace(/'/g, "''")}')`)
  .join(',\n    ');

const INSTALLED_STATE_SQL = String.raw`
WITH rollback_rows AS (
  SELECT id,encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.track_b_team_rollbacks r
), intent_rows AS (
  SELECT rollback_id,outbox_id,
    encode(extensions.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.track_b_team_rollback_intents i
), constraint_rows AS (
  SELECT c.conname AS identity,c.convalidated AS validated,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'name',c.conname,
      'type',c.contype,
      'validated',c.convalidated,
      'deferrable',c.condeferrable,
      'initially_deferred',c.condeferred,
      'no_inherit',c.connoinherit,
      'definition',pg_get_constraintdef(c.oid,true)
    )::text,'UTF8'),'sha256'),'hex') AS row_sha256
  FROM pg_constraint c
  WHERE c.conrelid='public.mirror_outbox'::regclass
    AND (
      c.conname IN (
        'mirror_outbox_f27_drill_rollback_id_fkey',
        'mirror_outbox_f27_drill_scope_check',
        'mirror_outbox_f27_generation_check'
      )
      OR c.conname ~* 'f27'
    )
), index_rows AS (
  SELECT ci.relname AS identity,i.indisunique AS is_unique,
    i.indisvalid AS is_valid,i.indisready AS is_ready,i.indislive AS is_live,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'name',ci.relname,
      'owner',pg_get_userbyid(ci.relowner),
      'unique',i.indisunique,
      'primary',i.indisprimary,
      'exclusion',i.indisexclusion,
      'immediate',i.indimmediate,
      'clustered',i.indisclustered,
      'valid',i.indisvalid,
      'ready',i.indisready,
      'live',i.indislive,
      'replica_identity',i.indisreplident,
      'definition',pg_get_indexdef(i.indexrelid,0,true),
      'reloptions',ci.reloptions
    )::text,'UTF8'),'sha256'),'hex') AS row_sha256
  FROM pg_index i
  JOIN pg_class ci ON ci.oid=i.indexrelid
  JOIN pg_namespace ni ON ni.oid=ci.relnamespace
  WHERE i.indrelid='public.mirror_outbox'::regclass
    AND ni.nspname='public'
    AND (
      ci.relname='mirror_outbox_one_f27_drill_row_idx'
      OR ci.relname ~* 'f27'
    )
), boundary_rows AS (
  SELECT
    p.oid::regprocedure::text AS identity,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'identity',p.oid::regprocedure::text,
      'owner',pg_get_userbyid(p.proowner),
      'acl',p.proacl,
      'config',p.proconfig,
      'definition',pg_get_functiondef(p.oid)
    )::text,'UTF8'),'sha256'),'hex') AS row_sha256
  FROM pg_proc p
  WHERE p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('public.track_b_f27_write_authorization(text)'),
    to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')
  )
), flag_rows AS (
  SELECT key,encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.syncview_runtime_flags f
  WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
), flip_rows AS (
  SELECT id,encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.flag_flips f
), mutating(function_identity) AS (
  VALUES
    ${MUTATING_VALUES_SQL}
)
SELECT jsonb_build_object(
  'rollbacks',jsonb_build_object(
    'count',(SELECT count(*) FROM rollback_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY id::text) FROM rollback_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'intents',jsonb_build_object(
    'count',(SELECT count(*) FROM intent_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY rollback_id::text,outbox_id) FROM intent_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'constraints',jsonb_build_object(
    'count',(SELECT count(*) FROM constraint_rows),
    'names',coalesce((SELECT jsonb_agg(identity ORDER BY identity) FROM constraint_rows),'[]'::jsonb),
    'all_validated',coalesce((SELECT bool_and(validated) FROM constraint_rows),false),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY identity) FROM constraint_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'indexes',jsonb_build_object(
    'count',(SELECT count(*) FROM index_rows),
    'names',coalesce((SELECT jsonb_agg(identity ORDER BY identity) FROM index_rows),'[]'::jsonb),
    'unique',coalesce((SELECT bool_and(is_unique) FROM index_rows),false),
    'valid',coalesce((SELECT bool_and(is_valid) FROM index_rows),false),
    'ready',coalesce((SELECT bool_and(is_ready) FROM index_rows),false),
    'live',coalesce((SELECT bool_and(is_live) FROM index_rows),false),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY identity) FROM index_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'boundary',jsonb_build_object(
    'count',(SELECT count(*) FROM boundary_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY identity) FROM boundary_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'flags',jsonb_build_object(
    'count',(SELECT count(*) FROM flag_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY key) FROM flag_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'flag_flips',jsonb_build_object(
    'count',(SELECT count(*) FROM flip_rows),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY id) FROM flip_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
  'open_rollback_count',(SELECT count(*) FROM public.track_b_team_rollbacks WHERE state='open'),
  'completed_drill_count',(SELECT count(*) FROM public.track_b_team_rollbacks
    WHERE state='complete' AND is_drill=true AND team='__f27_drill__'),
  'trigger_enabled',(SELECT tgenabled FROM pg_trigger
    WHERE tgrelid='public.mirror_outbox'::regclass
      AND tgname='track_b_f27_hold_guard' AND NOT tgisinternal),
  'production_assert_present',
    to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)') IS NOT NULL,
  'f27_table_count',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN ('track_b_f27_team_fences','track_b_team_rollbacks','track_b_team_rollback_intents')),
  'f27_outbox_column_count',(SELECT count(*) FROM pg_attribute
    WHERE attrelid='public.mirror_outbox'::regclass AND attnum>0 AND NOT attisdropped
      AND attname IN ('authority_generation','f27_drill_rollback_id')),
  'f27_hold_function_count',(SELECT count(*) FROM pg_proc
    WHERE oid=to_regprocedure('public.track_b_f27_hold_guard()')),
  'f27_hold_trigger_count',(SELECT count(*) FROM pg_trigger
    WHERE tgrelid='public.mirror_outbox'::regclass
      AND tgname='track_b_f27_hold_guard' AND NOT tgisinternal),
  'mutating_service_role_execute_count',(SELECT count(*) FROM mutating
    WHERE has_function_privilege('service_role',function_identity,'EXECUTE'))
)::text
`;

function assertHashCount(value, expectedCount, code) {
  if (!value || Number(value.count) !== expectedCount || !HASH_RE.test(clean(value.sha256))) {
    fail(code);
  }
}

function assertNamedHashCount(value, expectedNames, code) {
  assertHashCount(value, expectedNames.length, code);
  if (!same(value.names, [...expectedNames].sort())) fail(code);
}

function validateStateTransition(preinstall, beforeRollback, afterRollback) {
  const constraintNames = [
    'mirror_outbox_f27_drill_rollback_id_fkey',
    'mirror_outbox_f27_drill_scope_check',
    'mirror_outbox_f27_generation_check',
  ];
  const indexNames = ['mirror_outbox_one_f27_drill_row_idx'];
  assertHashCount(preinstall.boundary, 3, 'PREINSTALL_BOUNDARY_INVALID');
  assertHashCount(preinstall.flags, 3, 'PREINSTALL_FLAGS_INVALID');
  assertHashCount(preinstall.flag_flips, 0, 'PREINSTALL_FLAG_FLIPS_INVALID');
  assertHashCount(beforeRollback.rollbacks, 1, 'DRILL_ROLLBACK_AUDIT_INVALID');
  assertHashCount(beforeRollback.intents, 1, 'DRILL_INTENT_AUDIT_INVALID');
  assertNamedHashCount(
    beforeRollback.constraints,
    constraintNames,
    'INSTALLED_CONSTRAINTS_INVALID',
  );
  assertNamedHashCount(beforeRollback.indexes, indexNames, 'INSTALLED_INDEX_INVALID');
  if (beforeRollback.constraints.all_validated !== true
      || beforeRollback.indexes.unique !== true
      || beforeRollback.indexes.valid !== true
      || beforeRollback.indexes.ready !== true
      || beforeRollback.indexes.live !== true) {
    fail('INSTALLED_ADDITIVE_SCHEMA_INVALID');
  }
  assertHashCount(beforeRollback.boundary, 3, 'INSTALLED_BOUNDARY_INVALID');
  assertHashCount(beforeRollback.flags, 3, 'INSTALLED_FLAGS_INVALID');
  assertHashCount(beforeRollback.flag_flips, 0, 'INSTALLED_FLAG_FLIPS_INVALID');
  assertHashCount(afterRollback.rollbacks, 1, 'ROLLBACK_AUDIT_INVALID');
  assertHashCount(afterRollback.intents, 1, 'ROLLBACK_INTENT_AUDIT_INVALID');
  assertNamedHashCount(afterRollback.constraints, constraintNames, 'ROLLBACK_CONSTRAINTS_INVALID');
  assertNamedHashCount(afterRollback.indexes, indexNames, 'ROLLBACK_INDEX_INVALID');
  if (afterRollback.constraints.all_validated !== true
      || afterRollback.indexes.unique !== true
      || afterRollback.indexes.valid !== true
      || afterRollback.indexes.ready !== true
      || afterRollback.indexes.live !== true) {
    fail('ROLLBACK_ADDITIVE_SCHEMA_INVALID');
  }
  assertHashCount(afterRollback.boundary, 3, 'ROLLBACK_BOUNDARY_INVALID');
  assertHashCount(afterRollback.flags, 3, 'ROLLBACK_FLAGS_INVALID');
  assertHashCount(afterRollback.flag_flips, 0, 'ROLLBACK_FLAG_FLIPS_INVALID');

  if (Number(beforeRollback.open_rollback_count) !== 0
      || Number(beforeRollback.completed_drill_count) !== 1
      || beforeRollback.trigger_enabled !== 'O'
      || beforeRollback.production_assert_present !== true) {
    fail('PRE_ROLLBACK_INSTALLED_STATE_INVALID');
  }
  if (Number(afterRollback.open_rollback_count) !== 0
      || Number(afterRollback.completed_drill_count) !== 1
      || afterRollback.trigger_enabled !== 'D'
      || afterRollback.production_assert_present !== true
      || Number(afterRollback.f27_table_count) !== 3
      || Number(afterRollback.f27_outbox_column_count) !== 2
      || Number(afterRollback.f27_hold_function_count) !== 1
      || Number(afterRollback.f27_hold_trigger_count) !== 1
      || Number(afterRollback.mutating_service_role_execute_count) !== 0) {
    fail('POST_ROLLBACK_STATE_INVALID');
  }
  if (!same(beforeRollback.rollbacks, afterRollback.rollbacks)
      || !same(beforeRollback.intents, afterRollback.intents)) {
    fail('ROLLBACK_AUDIT_CHANGED');
  }
  if (!same(beforeRollback.constraints, afterRollback.constraints)
      || !same(beforeRollback.indexes, afterRollback.indexes)) {
    fail('ROLLBACK_ADDITIVE_SCHEMA_CHANGED');
  }
  if (!same(preinstall.flags, beforeRollback.flags)
      || !same(preinstall.flags, afterRollback.flags)
      || !same(preinstall.flag_flips, beforeRollback.flag_flips)
      || !same(preinstall.flag_flips, afterRollback.flag_flips)) {
    fail('ROLLBACK_RUNTIME_FLAGS_CHANGED');
  }
  if (!same(preinstall.boundary, afterRollback.boundary)) {
    fail('ROLLBACK_BOUNDARY_NOT_RESTORED');
  }
  return true;
}

function fakeLiveDatabaseUrl(database) {
  return `postgresql://postgres:f27-proof@db.${PROJECT_REF}.supabase.co:5432/${database}?sslmode=require`;
}

function createPrivateDirectories(privateRoot) {
  const paths = {
    snapshot: path.join(privateRoot, 'snapshot'),
    apply: path.join(privateRoot, 'apply'),
    recipe: path.join(privateRoot, 'recipe'),
  };
  for (const value of Object.values(paths)) {
    fs.mkdirSync(value, { mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(value, 0o700);
  }
  return paths;
}

function publicReceipt(results) {
  const auditSha256 = sha256(Buffer.from(JSON.stringify(stableValue({
    rollbacks: results.afterRollback.rollbacks,
    intents: results.afterRollback.intents,
  })), 'utf8'));
  const runtimeSha256 = sha256(Buffer.from(JSON.stringify(stableValue({
    flags: results.afterRollback.flags,
    flag_flips: results.afterRollback.flag_flips,
  })), 'utf8'));
  return {
    status: 'PASS',
    postgresql_16: 'PASS',
    exact_preinstall_subset: 'PASS',
    snapshot_capture: 'PASS',
    rollback_recipe_generation: 'PASS',
    migration_apply_once: 'PASS',
    reserved_drill: 'PASS',
    rollback_recipe_execution: 'PASS',
    audit_rows_preserved: 'PASS',
    audit_rollback_row_count: Number(results.afterRollback.rollbacks.count),
    audit_intent_row_count: Number(results.afterRollback.intents.count),
    audit_rows_sha256: auditSha256,
    runtime_flags_preserved: 'PASS',
    runtime_flags_sha256: runtimeSha256,
    boundary_definitions_restored: 'PASS',
    boundary_function_count: Number(results.afterRollback.boundary.count),
    boundary_definitions_sha256: results.afterRollback.boundary.sha256,
    additive_constraints_preserved: 'PASS',
    additive_constraint_count: Number(results.afterRollback.constraints.count),
    additive_constraint_definitions_sha256: results.afterRollback.constraints.sha256,
    additive_drill_index_preserved: 'PASS',
    additive_drill_index_count: Number(results.afterRollback.indexes.count),
    additive_drill_index_definition_sha256: results.afterRollback.indexes.sha256,
    hold_trigger_disabled: 'PASS',
    production_assert_authority_restored: 'PASS',
    additive_objects_retained: 'PASS',
    additive_object_count: Number(results.afterRollback.f27_table_count)
      + Number(results.afterRollback.f27_outbox_column_count)
      + Number(results.afterRollback.f27_hold_function_count)
      + Number(results.afterRollback.f27_hold_trigger_count)
      + Number(results.afterRollback.constraints.count)
      + Number(results.afterRollback.indexes.count),
    mutating_rpc_service_role_execute_revoked: 'PASS',
    snapshot_row_count: Number(results.snapshot.mirror_outbox_row_count),
    snapshot_non_terminal_row_count: Number(results.snapshot.mirror_outbox_non_terminal_row_count),
    snapshot_bundle_sha256: results.snapshot.snapshot_bundle_sha256,
    migration_sha256: results.migration.migration_sha256,
    rollback_recipe_sha256: results.recipe.rollback_recipe_sha256,
    rollback_transcript_sha256: results.rollback.private_transcript_sha256,
  };
}

async function runProof(options, dependencies = {}) {
  const worktrees = dependencies.worktrees || registeredWorktrees(options.repoRoot || REPO_ROOT);
  const privateRoot = validatePrivateRoot(options.privateRoot, worktrees);
  const target = validateTarget(options, options.env || process.env);
  const localEnv = localPsqlEnvironment(options.env || process.env, target.database);
  const psql = dependencies.psql || createLocalPsql(localEnv);
  const api = {
    captureSnapshot,
    generateRollbackRecipe,
    applyMigration,
    executeRollback,
    createDrillTransport: config => new PsqlDisposableTransport(config),
    runF27Drill,
    ...dependencies.api,
  };
  const repoRoot = options.repoRoot || REPO_ROOT;
  (dependencies.verifyRelease || verifyCheckedOutRelease)(repoRoot, target.releaseSha);
  const migrationBytes = fs.readFileSync(path.join(
    repoRoot,
    'migrations',
    '2026-07-20-f27-team-rollback.sql',
  ));
  const migrationSha256 = sha256(migrationBytes);
  const releaseInfo = {
    headSha: target.releaseSha,
    originMainSha: target.releaseSha,
    dirty: false,
    migrationSha256,
  };
  const applyReleaseInfo = {
    head: target.releaseSha,
    originMain: target.releaseSha,
    dirty: false,
  };
  const databaseUrl = fakeLiveDatabaseUrl(target.database);
  let receipt;
  try {
    if (psql.scalar('select current_setting(\'server_version_num\')::integer / 10000') !== '16') {
      fail('POSTGRESQL_16_REQUIRED');
    }
    if (psql.scalar(
      "select coalesce((select marker from rollback_operator_fixture.identity where singleton=true),'')",
    ) !== FIXTURE_MARKER) {
      fail('DISPOSABLE_FIXTURE_MARKER_REQUIRED');
    }
    const directories = createPrivateDirectories(privateRoot);
    const preinstall = psql.json(BOUNDARY_STATE_SQL);
    const snapshot = api.captureSnapshot({
      confirmed: true,
      outputDir: directories.snapshot,
      projectRef: PROJECT_REF,
      database: target.database,
      databaseUrl,
      releaseSha: target.releaseSha,
      releaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      psqlAdapter: psql.snapshotAdapter,
      aclPlatform: 'linux',
    });
    if (snapshot.status !== 'PASS' || snapshot.pre_f27_baseline !== 'PASS'
        || !HASH_RE.test(clean(snapshot.snapshot_bundle_sha256))) {
      fail('SNAPSHOT_CAPTURE_INVALID');
    }
    const bundlePath = path.join(
      directories.snapshot,
      `f27-mirror-outbox-${snapshot.snapshot_bundle_sha256}.snapshot`,
    );
    const recipePath = path.join(directories.recipe, 'f27-database-rollback.sql');
    const recipe = api.generateRollbackRecipe({
      confirmed: true,
      bundlePath,
      expectedBundleSha256: snapshot.snapshot_bundle_sha256,
      outputPath: recipePath,
      projectRef: PROJECT_REF,
      database: target.database,
      releaseSha: target.releaseSha,
      releaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      aclPlatform: 'linux',
    });
    if (recipe.status !== 'PASS' || recipe.static_validation !== 'PASS'
        || recipe.private_readback !== 'PASS'
        || !HASH_RE.test(clean(recipe.rollback_recipe_sha256))) {
      fail('ROLLBACK_RECIPE_INVALID');
    }
    const migration = api.applyMigration({
      confirmation: APPLY_CONFIRMATION,
      outputDir: directories.apply,
      projectRef: PROJECT_REF,
      database: target.database,
      databaseUrl,
      releaseSha: target.releaseSha,
      expectedMigrationSha256: migrationSha256,
      snapshotBundle: bundlePath,
      expectedSnapshotBundleSha256: snapshot.snapshot_bundle_sha256,
      migrationBytes,
      releaseInfo: applyReleaseInfo,
      preSpawnReleaseInfo: applyReleaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      psqlAdapter: psql.migrationAdapter,
      aclPlatform: 'linux',
    });
    if (migration.status !== 'PASS' || migration.psql_exit_status !== 0
        || migration.migration_transaction_and_self_probe !== 'PASS') {
      fail('MIGRATION_APPLY_INVALID');
    }
    const drillTransport = api.createDrillTransport({
      database: target.database,
      env: localEnv,
      resumeConfirmation: 'F27_DISPOSABLE_DRILL_RESUME',
    });
    const drill = await api.runF27Drill(drillTransport, { actor: ACTOR });
    if (!drill || drill.terminal !== 'F27_DRILL_RUNNER_OK'
        || drill.team !== '__f27_drill__'
        || drill.audit_history_retained !== true
        || drill.dormant !== true) {
      fail('RESERVED_DRILL_INVALID');
    }
    const beforeRollback = psql.json(INSTALLED_STATE_SQL);
    const rollback = api.executeRollback({
      confirmation: EXECUTE_CONFIRMATION,
      databaseUrl,
      recipePath,
      expectedRecipeSha256: recipe.rollback_recipe_sha256,
      transcriptPath: path.join(directories.recipe, 'f27-database-rollback.transcript'),
      releaseSha: target.releaseSha,
      projectRef: PROJECT_REF,
      database: target.database,
      snapshotBundleSha256: snapshot.snapshot_bundle_sha256,
      releaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      psqlAdapter: psql.rollbackAdapter,
      baseEnv: {},
      aclPlatform: 'linux',
    });
    if (rollback.status !== 'PASS' || rollback.execution !== 'PASS'
        || rollback.private_transcript_readback !== 'PASS'
        || !HASH_RE.test(clean(rollback.private_transcript_sha256))) {
      fail('ROLLBACK_EXECUTION_INVALID');
    }
    const afterRollback = psql.json(INSTALLED_STATE_SQL);
    validateStateTransition(preinstall, beforeRollback, afterRollback);
    receipt = publicReceipt({
      preinstall,
      beforeRollback,
      afterRollback,
      snapshot,
      migration,
      recipe,
      rollback,
    });
  } finally {
    cleanupPrivateRoot(privateRoot);
  }
  return receipt;
}

function parseArgs(argv) {
  const allowed = new Set(['private-root', 'release-sha', 'confirm-database']);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = clean(argv[index]);
    if (!token.startsWith('--')) fail('ARGUMENT_REJECTED');
    const equals = token.indexOf('=');
    const name = token.slice(2, equals < 0 ? undefined : equals);
    if (!allowed.has(name) || Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED');
    }
    let value = equals < 0 ? '' : token.slice(equals + 1);
    if (equals < 0) {
      if (index + 1 >= argv.length || clean(argv[index + 1]).startsWith('--')) {
        fail('ARGUMENT_REJECTED');
      }
      value = argv[++index];
    }
    if (!clean(value)) fail('ARGUMENT_REJECTED');
    values[name] = clean(value);
  }
  if ([...allowed].some(name => !Object.prototype.hasOwnProperty.call(values, name))) {
    fail('ARGUMENT_REJECTED');
  }
  return {
    privateRoot: path.resolve(values['private-root']),
    releaseSha: values['release-sha'],
    database: values['confirm-database'],
  };
}

function publicFailure(error) {
  return {
    status: 'FAIL',
    code: error instanceof PostgresRollbackProofError
      && /^[A-Z][A-Z0-9_]+$/.test(clean(error.code))
      ? error.code
      : 'F27_DATABASE_ROLLBACK_POSTGRES_PROOF_FAILED',
  };
}

async function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  return runProof({ ...parseArgs(argv), env });
}

if (require.main === module) {
  runFromEnvironment().then(result => {
    process.stdout.write(`${JSON.stringify(result)}${os.EOL}`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  });
}

module.exports = {
  BOUNDARY_STATE_SQL,
  INSTALLED_STATE_SQL,
  PostgresRollbackProofError,
  createLocalPsql,
  parseArgs,
  publicFailure,
  publicReceipt,
  runProof,
  validatePrivateRoot,
  validateStateTransition,
  validateTarget,
  verifyCheckedOutRelease,
};
