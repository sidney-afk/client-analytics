#!/usr/bin/env node
'use strict';

/*
 * Hosted PostgreSQL 17 proof for the complete F27 database rollback path.
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
  fingerprintPost,
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
const ACTOR = 'f27-postgres17-proof';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const DATABASE_RE = /^f27_[A-Za-z0-9_$-]{1,58}$/;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const FIXTURE_MARKER = 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE';
const RETAINED_DRIFT_CONFIRMATION = 'F27_DISPOSABLE_RETAINED_DRIFT_ONLY';
const RETAINED_DRIFT_DATABASES = Object.freeze([
  'f27_reinstall_retained_object',
  'f27_reinstall_generation',
  'f27_reinstall_open_work',
  'f27_reinstall_fk_metadata',
  'f27_reinstall_function_cost',
  'f27_reinstall_column_catalog',
  'f27_reinstall_stats_target',
  'f27_reinstall_missing_value',
]);
const ZERO_AUDIT_REINSTALL_DATABASE = 'f27_reinstall_zero_audit';
const CRLF_WRITE_AUTHORIZATION_TERMINAL =
  'F27_DISPOSABLE_ALTERNATE_REVIEWED_CRLF_OK';
// Disposable-only alternate reviewed representation. This deliberately does
// not claim to reproduce the production source bytes.
const CRLF_WRITE_AUTHORIZATION_SQL = String.raw`
DO $f27_disposable_alternate_reviewed_crlf$
DECLARE
  v_oid oid := to_regprocedure('public.track_b_f27_write_authorization(text)');
  v_function_definition text;
  v_normalized_source text;
  v_non_source_metadata jsonb;
BEGIN
  IF current_database() <> 'f27_reinstall_zero_audit'
     OR NOT EXISTS (
       SELECT 1 FROM rollback_operator_fixture.identity
       WHERE singleton=true AND marker='ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE'
     )
     OR v_oid IS NULL THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_ALTERNATE_REVIEWED_CRLF_BOUNDARY_REQUIRED';
  END IF;
  SELECT
    pg_get_functiondef(p.oid),
    replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),
    to_jsonb(p)-'prosrc'
  INTO v_function_definition,v_normalized_source,v_non_source_metadata
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;
  v_function_definition := replace(
    replace(
      replace(v_function_definition,E'\r\n',E'\n'),
      E'\r',E'\n'
    ),
    E'\n',E'\r\n'
  );
  EXECUTE v_function_definition;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_oid
      AND position(E'\r' in p.prosrc)>0
      AND replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')=v_normalized_source
      AND to_jsonb(p)-'prosrc'=v_non_source_metadata
  ) THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_ALTERNATE_REVIEWED_CRLF_FAILED';
  END IF;
END
$f27_disposable_alternate_reviewed_crlf$;
SELECT '${CRLF_WRITE_AUTHORIZATION_TERMINAL}';
`;
const LF_WRITE_AUTHORIZATION_SQL = String.raw`
DO $f27_disposable_alternate_reviewed_lf$
DECLARE
  v_oid oid := to_regprocedure('public.track_b_f27_write_authorization(text)');
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_function_definition text;
  v_normalized_source text;
  v_non_source_metadata jsonb;
  v_non_source_field_count integer;
  v_raw_cr_count integer;
BEGIN
  IF current_database() <> 'f27_reinstall_zero_audit'
     OR NOT EXISTS (
       SELECT 1 FROM rollback_operator_fixture.identity
       WHERE singleton=true AND marker='ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE'
     )
     OR v_oid IS NULL
     OR (SELECT count(*) FROM public.track_b_team_rollbacks) <> 0
     OR (SELECT count(*) FROM public.track_b_team_rollback_intents) <> 0
     OR EXISTS (
       SELECT 1 FROM public.track_b_f27_team_fences WHERE generation <> 0
     ) THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_ALTERNATE_REVIEWED_LF_BOUNDARY_REQUIRED';
  END IF;
  SELECT
    p.proowner,p.proacl,p.proconfig,pg_get_functiondef(p.oid),
    replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n'),
    to_jsonb(p)-'prosrc'
  INTO v_owner,v_acl,v_config,v_function_definition,v_normalized_source,
       v_non_source_metadata
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;
  IF position(E'\r' in v_function_definition)=0 THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_ALTERNATE_REVIEWED_CRLF_REQUIRED';
  END IF;
  v_function_definition := replace(
    replace(v_function_definition,E'\r\n',E'\n'),
    E'\r',E'\n'
  );
  EXECUTE v_function_definition;
  SELECT length(p.prosrc)-length(replace(p.prosrc,E'\r',''))
  INTO v_raw_cr_count
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid=v_oid
      AND p.proowner=v_owner
      AND p.proacl IS NOT DISTINCT FROM v_acl
      AND p.proconfig IS NOT DISTINCT FROM v_config
      AND to_jsonb(p)-'prosrc'=v_non_source_metadata
      AND replace(replace(p.prosrc,E'\r\n',E'\n'),E'\r',E'\n')=v_normalized_source
      AND position(E'\r' in p.prosrc)=0
  ) OR v_raw_cr_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_ALTERNATE_REVIEWED_LF_FAILED';
  END IF;
  SELECT count(*) INTO v_non_source_field_count
  FROM jsonb_object_keys(v_non_source_metadata);
  PERFORM set_config(
    'syncview.f27_alternate_reviewed_line_endings_receipt',
    jsonb_build_object(
      'status','PASS',
      'normalized_source_sha256',encode(extensions.digest(
        convert_to(v_normalized_source,'UTF8'),'sha256'
      ),'hex'),
      'raw_cr_count',v_raw_cr_count,
      'preserved_non_source_field_count',v_non_source_field_count
    )::text,
    false
  );
END
$f27_disposable_alternate_reviewed_lf$;
SELECT current_setting('syncview.f27_alternate_reviewed_line_endings_receipt');
`;
const LEGACY_HOLD_GUARD_ACL_TERMINAL = 'F27_DISPOSABLE_LEGACY_HOLD_GUARD_ACL_OK';
const LEGACY_HOLD_GUARD_ACL_SQL = String.raw`
DO $f27_disposable_legacy_hold_guard_acl$
DECLARE
  v_function_definition text;
  v_trigger_definition text;
BEGIN
  IF current_database() <> 'f27_reinstall_zero_audit'
     OR NOT EXISTS (
       SELECT 1 FROM rollback_operator_fixture.identity
       WHERE singleton=true AND marker='ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE'
     )
     OR to_regprocedure('public.track_b_f27_hold_guard()') IS NULL
     OR (SELECT count(*) FROM public.track_b_team_rollbacks) <> 0
     OR (SELECT count(*) FROM public.track_b_team_rollback_intents) <> 0
     OR EXISTS (
       SELECT 1 FROM public.track_b_f27_team_fences WHERE generation <> 0
     ) THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_LEGACY_ACL_FIXTURE_BOUNDARY_REQUIRED';
  END IF;
  SELECT pg_get_functiondef(p.oid),pg_get_triggerdef(t.oid,true)
    INTO v_function_definition,v_trigger_definition
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_trigger t ON t.tgfoid=p.oid
  WHERE p.oid=to_regprocedure('public.track_b_f27_hold_guard()')
    AND t.tgrelid='public.mirror_outbox'::regclass
    AND t.tgname='track_b_f27_hold_guard'
    AND t.tgenabled='D'
    AND NOT t.tgisinternal;
  IF v_function_definition IS NULL OR v_trigger_definition IS NULL THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_LEGACY_ACL_FIXTURE_BOUNDARY_REQUIRED';
  END IF;
  DROP TRIGGER track_b_f27_hold_guard ON public.mirror_outbox;
  DROP FUNCTION public.track_b_f27_hold_guard();
  EXECUTE v_function_definition;
  EXECUTE v_trigger_definition;
  ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc
       WHERE oid=to_regprocedure('public.track_b_f27_hold_guard()')
         AND proacl IS NULL
     )
     OR (SELECT pg_get_functiondef(to_regprocedure('public.track_b_f27_hold_guard()')))
          IS DISTINCT FROM v_function_definition
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger t
       WHERE t.tgrelid='public.mirror_outbox'::regclass
         AND t.tgname='track_b_f27_hold_guard'
         AND t.tgenabled='D'
         AND NOT t.tgisinternal
         AND pg_get_triggerdef(t.oid,true)=v_trigger_definition
     ) THEN
    RAISE EXCEPTION 'F27_DISPOSABLE_LEGACY_ACL_FIXTURE_FAILED';
  END IF;
END
$f27_disposable_legacy_hold_guard_acl$;
SELECT '${LEGACY_HOLD_GUARD_ACL_TERMINAL}';
`;

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

function clonePostRollbackDatabases(
  localEnv,
  sourceDatabase,
  targetDatabases = RETAINED_DRIFT_DATABASES,
  spawn = spawnSync,
) {
  if (!DATABASE_RE.test(clean(sourceDatabase))
      || !Array.isArray(targetDatabases)
      || targetDatabases.length !== RETAINED_DRIFT_DATABASES.length
      || targetDatabases.some((database, index) => (
        database !== RETAINED_DRIFT_DATABASES[index]
        || !DATABASE_RE.test(database)
        || database === sourceDatabase
      ))) {
    fail('RETAINED_DRIFT_DATABASE_TARGET_INVALID');
  }
  for (const database of targetDatabases) {
    const result = spawn('createdb', [
      '--maintenance-db=postgres',
      `--template=${sourceDatabase}`,
      database,
    ], {
      env: localEnv,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (!result || result.error || result.signal || result.status !== 0) {
      fail('RETAINED_DRIFT_DATABASE_CLONE_FAILED');
    }
  }
  return true;
}

function clonePristineZeroAuditDatabase(
  localEnv,
  sourceDatabase,
  targetDatabase = ZERO_AUDIT_REINSTALL_DATABASE,
  spawn = spawnSync,
) {
  if (!DATABASE_RE.test(clean(sourceDatabase))
      || targetDatabase !== ZERO_AUDIT_REINSTALL_DATABASE
      || sourceDatabase === targetDatabase) {
    fail('ZERO_AUDIT_DATABASE_TARGET_INVALID');
  }
  const result = spawn('createdb', [
    '--maintenance-db=postgres',
    `--template=${sourceDatabase}`,
    targetDatabase,
  ], {
    env: localEnv,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (!result || result.error || result.signal || result.status !== 0) {
    fail('ZERO_AUDIT_DATABASE_CLONE_FAILED');
  }
  return true;
}

const BOUNDARY_STATE_SQL = String.raw`
WITH fence_rows AS (
  SELECT team,generation,
    encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.track_b_f27_team_fences f
), boundary_rows AS (
  SELECT
    p.oid::regprocedure::text AS identity,
    encode(extensions.digest(convert_to(jsonb_build_object(
      'identity',p.oid::regprocedure::text,
      'owner',pg_get_userbyid(p.proowner),
      'acl',p.proacl,
      'config',p.proconfig,
      'definition',replace(
        replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),E'\r',E'\n'
      )
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
  'fences',jsonb_build_object(
    'count',(SELECT count(*) FROM fence_rows),
    'teams',coalesce((SELECT jsonb_agg(team ORDER BY team) FROM fence_rows),'[]'::jsonb),
    'generations',coalesce((SELECT jsonb_object_agg(team,generation ORDER BY team) FROM fence_rows),'{}'::jsonb),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY team) FROM fence_rows
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
  )
)::text
`;

const MUTATING_VALUES_SQL = MUTATING_F27_FUNCTIONS
  .map(identity => `('${identity.replace(/'/g, "''")}')`)
  .join(',\n    ');

const INSTALLED_STATE_SQL = String.raw`
WITH fence_rows AS (
  SELECT team,generation,
    encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_sha256
  FROM public.track_b_f27_team_fences f
), rollback_rows AS (
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
      'definition',replace(
        replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'),E'\r',E'\n'
      )
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
  'fences',jsonb_build_object(
    'count',(SELECT count(*) FROM fence_rows),
    'teams',coalesce((SELECT jsonb_agg(team ORDER BY team) FROM fence_rows),'[]'::jsonb),
    'generations',coalesce((SELECT jsonb_object_agg(team,generation ORDER BY team) FROM fence_rows),'{}'::jsonb),
    'sha256',encode(extensions.digest(convert_to(coalesce((
      SELECT string_agg(row_sha256,'' ORDER BY team) FROM fence_rows
    ),''),'UTF8'),'sha256'),'hex')
  ),
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
  'unresolved_intent_count',(SELECT count(*)
    FROM public.track_b_team_rollback_intents i
    JOIN public.track_b_team_rollbacks r ON r.id=i.rollback_id
    WHERE r.state='open' OR i.classification IS NULL
      OR (i.classification='replay' AND i.terminal_receipt IS NULL)),
  'orphan_intent_count',(SELECT count(*)
    FROM public.track_b_team_rollback_intents i
    LEFT JOIN public.track_b_team_rollbacks r ON r.id=i.rollback_id
    WHERE r.id IS NULL),
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

function assertFenceState(value, code) {
  assertHashCount(value, 2, code);
  if (!same(value.teams, ['graphics', 'video'])
      || !value.generations
      || !Number.isSafeInteger(Number(value.generations.graphics))
      || !Number.isSafeInteger(Number(value.generations.video))
      || Number(value.generations.graphics) < 0
      || Number(value.generations.video) < 0) {
    fail(code);
  }
}

function validateStateTransition(preinstall, beforeRollback, afterRollback) {
  const constraintNames = [
    'mirror_outbox_f27_drill_rollback_id_fkey',
    'mirror_outbox_f27_drill_scope_check',
    'mirror_outbox_f27_generation_check',
  ];
  const indexNames = ['mirror_outbox_one_f27_drill_row_idx'];
  assertFenceState(preinstall.fences, 'PREINSTALL_FENCES_INVALID');
  assertHashCount(preinstall.boundary, 3, 'PREINSTALL_BOUNDARY_INVALID');
  assertHashCount(preinstall.flags, 3, 'PREINSTALL_FLAGS_INVALID');
  assertHashCount(preinstall.flag_flips, 0, 'PREINSTALL_FLAG_FLIPS_INVALID');
  assertHashCount(beforeRollback.rollbacks, 1, 'DRILL_ROLLBACK_AUDIT_INVALID');
  assertHashCount(beforeRollback.intents, 1, 'DRILL_INTENT_AUDIT_INVALID');
  assertFenceState(beforeRollback.fences, 'INSTALLED_FENCES_INVALID');
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
  assertFenceState(afterRollback.fences, 'ROLLBACK_FENCES_INVALID');
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
      || Number(beforeRollback.unresolved_intent_count) !== 0
      || Number(beforeRollback.orphan_intent_count) !== 0
      || Number(beforeRollback.completed_drill_count) !== 1
      || beforeRollback.trigger_enabled !== 'O'
      || beforeRollback.production_assert_present !== true) {
    fail('PRE_ROLLBACK_INSTALLED_STATE_INVALID');
  }
  if (Number(afterRollback.open_rollback_count) !== 0
      || Number(afterRollback.unresolved_intent_count) !== 0
      || Number(afterRollback.orphan_intent_count) !== 0
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
  if (!same(preinstall.fences, beforeRollback.fences)
      || !same(beforeRollback.fences, afterRollback.fences)) {
    fail('ROLLBACK_FENCES_CHANGED');
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

function validateReinstallTransition(
  beforeRollback,
  afterRollback,
  afterReinstall,
  expectedPostContractSha256,
  postContract,
) {
  const constraintNames = [
    'mirror_outbox_f27_drill_rollback_id_fkey',
    'mirror_outbox_f27_drill_scope_check',
    'mirror_outbox_f27_generation_check',
  ];
  const indexNames = ['mirror_outbox_one_f27_drill_row_idx'];
  assertFenceState(afterReinstall.fences, 'REINSTALL_FENCES_INVALID');
  assertHashCount(afterReinstall.rollbacks, 1, 'REINSTALL_ROLLBACK_AUDIT_INVALID');
  assertHashCount(afterReinstall.intents, 1, 'REINSTALL_INTENT_AUDIT_INVALID');
  assertNamedHashCount(afterReinstall.constraints, constraintNames, 'REINSTALL_CONSTRAINTS_INVALID');
  assertNamedHashCount(afterReinstall.indexes, indexNames, 'REINSTALL_INDEX_INVALID');
  assertHashCount(afterReinstall.boundary, 3, 'REINSTALL_BOUNDARY_INVALID');
  assertHashCount(afterReinstall.flags, 3, 'REINSTALL_FLAGS_INVALID');
  assertHashCount(afterReinstall.flag_flips, 0, 'REINSTALL_FLAG_FLIPS_INVALID');
  if (Number(afterReinstall.open_rollback_count) !== 0
      || Number(afterReinstall.unresolved_intent_count) !== 0
      || Number(afterReinstall.orphan_intent_count) !== 0
      || Number(afterReinstall.completed_drill_count) !== 1
      || afterReinstall.trigger_enabled !== 'O'
      || afterReinstall.production_assert_present !== true
      || Number(afterReinstall.f27_table_count) !== 3
      || Number(afterReinstall.f27_outbox_column_count) !== 2
      || Number(afterReinstall.f27_hold_function_count) !== 1
      || Number(afterReinstall.f27_hold_trigger_count) !== 1
      || Number(afterReinstall.mutating_service_role_execute_count) !== 8) {
    fail('POST_REINSTALL_STATE_INVALID');
  }
  if (!same(afterRollback.fences, afterReinstall.fences)) {
    fail('REINSTALL_FENCES_CHANGED');
  }
  if (!same(afterRollback.rollbacks, afterReinstall.rollbacks)
      || !same(afterRollback.intents, afterReinstall.intents)) {
    fail('REINSTALL_AUDIT_CHANGED');
  }
  if (!same(beforeRollback.constraints, afterReinstall.constraints)
      || !same(beforeRollback.indexes, afterReinstall.indexes)) {
    fail('REINSTALL_ADDITIVE_SCHEMA_CHANGED');
  }
  if (!same(beforeRollback.boundary, afterReinstall.boundary)) {
    fail('REINSTALL_BOUNDARY_NOT_CONVERGED');
  }
  if (!same(afterRollback.flags, afterReinstall.flags)
      || !same(afterRollback.flag_flips, afterReinstall.flag_flips)) {
    fail('REINSTALL_RUNTIME_FLAGS_CHANGED');
  }
  // fingerprintPost seals only the normalized seven-category schema/grant
  // contract.  The generation, ledger, audit, and flag invariants above come
  // from the same database through INSTALLED_STATE_SQL and stay independently
  // mandatory.
  if (!postContract || postContract.status !== 'PASS'
      || postContract.f27_post_contract_sha256 !== expectedPostContractSha256) {
    fail('REINSTALL_POST_CONTRACT_NOT_CONVERGED');
  }
  return true;
}

function validateZeroAuditReinstallTransition(
  preinstall,
  beforeRollback,
  afterRollback,
  afterReinstall,
  expectedPostContractSha256,
  postContract,
) {
  const constraintNames = [
    'mirror_outbox_f27_drill_rollback_id_fkey',
    'mirror_outbox_f27_drill_scope_check',
    'mirror_outbox_f27_generation_check',
  ];
  const indexNames = ['mirror_outbox_one_f27_drill_row_idx'];
  assertFenceState(preinstall.fences, 'ZERO_AUDIT_PREINSTALL_FENCES_INVALID');
  for (const team of ['graphics', 'video']) {
    if (Number(preinstall.fences.generations[team]) !== 0) {
      fail('ZERO_AUDIT_PREINSTALL_GENERATION_NOT_ZERO');
    }
  }
  for (const [state, phase] of [
    [beforeRollback, 'INSTALLED'],
    [afterRollback, 'ROLLBACK'],
    [afterReinstall, 'REINSTALL'],
  ]) {
    assertFenceState(state.fences, `ZERO_AUDIT_${phase}_FENCES_INVALID`);
    assertHashCount(state.rollbacks, 0, `ZERO_AUDIT_${phase}_ROLLBACKS_NOT_EMPTY`);
    assertHashCount(state.intents, 0, `ZERO_AUDIT_${phase}_INTENTS_NOT_EMPTY`);
    assertNamedHashCount(state.constraints, constraintNames, `ZERO_AUDIT_${phase}_CONSTRAINTS_INVALID`);
    assertNamedHashCount(state.indexes, indexNames, `ZERO_AUDIT_${phase}_INDEX_INVALID`);
    assertHashCount(state.boundary, 3, `ZERO_AUDIT_${phase}_BOUNDARY_INVALID`);
    assertHashCount(state.flags, 3, `ZERO_AUDIT_${phase}_FLAGS_INVALID`);
    assertHashCount(state.flag_flips, 0, `ZERO_AUDIT_${phase}_FLAG_FLIPS_INVALID`);
    if (Number(state.open_rollback_count) !== 0
        || Number(state.unresolved_intent_count) !== 0
        || Number(state.orphan_intent_count) !== 0
        || Number(state.completed_drill_count) !== 0
        || state.production_assert_present !== true
        || Number(state.f27_table_count) !== 3
        || Number(state.f27_outbox_column_count) !== 2
        || Number(state.f27_hold_function_count) !== 1
        || Number(state.f27_hold_trigger_count) !== 1) {
      fail(`ZERO_AUDIT_${phase}_STATE_INVALID`);
    }
  }
  if (beforeRollback.trigger_enabled !== 'O'
      || Number(beforeRollback.mutating_service_role_execute_count) !== 8
      || afterRollback.trigger_enabled !== 'D'
      || Number(afterRollback.mutating_service_role_execute_count) !== 0
      || afterReinstall.trigger_enabled !== 'O'
      || Number(afterReinstall.mutating_service_role_execute_count) !== 8) {
    fail('ZERO_AUDIT_OPERATIVE_POSTURE_INVALID');
  }
  if (!same(preinstall.fences, beforeRollback.fences)
      || !same(beforeRollback.fences, afterRollback.fences)
      || !same(afterRollback.fences, afterReinstall.fences)) {
    fail('ZERO_AUDIT_FENCES_CHANGED');
  }
  if (!same(beforeRollback.rollbacks, afterRollback.rollbacks)
      || !same(afterRollback.rollbacks, afterReinstall.rollbacks)
      || !same(beforeRollback.intents, afterRollback.intents)
      || !same(afterRollback.intents, afterReinstall.intents)) {
    fail('ZERO_AUDIT_LEDGER_CHANGED');
  }
  if (!same(beforeRollback.constraints, afterRollback.constraints)
      || !same(afterRollback.constraints, afterReinstall.constraints)
      || !same(beforeRollback.indexes, afterRollback.indexes)
      || !same(afterRollback.indexes, afterReinstall.indexes)) {
    fail('ZERO_AUDIT_ADDITIVE_SCHEMA_CHANGED');
  }
  if (!same(preinstall.boundary, afterRollback.boundary)
      || !same(beforeRollback.boundary, afterReinstall.boundary)) {
    fail('ZERO_AUDIT_BOUNDARY_NOT_CONVERGED');
  }
  if (!same(preinstall.flags, beforeRollback.flags)
      || !same(beforeRollback.flags, afterRollback.flags)
      || !same(afterRollback.flags, afterReinstall.flags)
      || !same(preinstall.flag_flips, beforeRollback.flag_flips)
      || !same(beforeRollback.flag_flips, afterRollback.flag_flips)
      || !same(afterRollback.flag_flips, afterReinstall.flag_flips)) {
    fail('ZERO_AUDIT_RUNTIME_FLAGS_CHANGED');
  }
  if (!postContract || postContract.status !== 'PASS'
      || postContract.f27_post_contract_sha256 !== expectedPostContractSha256) {
    fail('ZERO_AUDIT_POST_CONTRACT_NOT_CONVERGED');
  }
  return true;
}

function fakeLiveDatabaseUrl(database) {
  return `postgresql://postgres:f27-proof@db.${PROJECT_REF}.supabase.co:5432/${database}?sslmode=require`;
}

function disposableDatabaseUrl(database) {
  return `postgresql://postgres:postgres@localhost:5432/${database}`;
}

function createPrivateDirectories(privateRoot) {
  const paths = {
    snapshot: path.join(privateRoot, 'snapshot'),
    apply: path.join(privateRoot, 'apply'),
    recipe: path.join(privateRoot, 'recipe'),
    reinstallSnapshot: path.join(privateRoot, 'reinstall-snapshot'),
    reinstallApply: path.join(privateRoot, 'reinstall-apply'),
    reinstallRecipe: path.join(privateRoot, 'reinstall-recipe'),
    postContract: path.join(privateRoot, 'reinstall-post-contract'),
    zeroSnapshot: path.join(privateRoot, 'zero-audit-snapshot'),
    zeroApply: path.join(privateRoot, 'zero-audit-apply'),
    zeroRecipe: path.join(privateRoot, 'zero-audit-recipe'),
    zeroPristinePostContract: path.join(
      privateRoot,
      'zero-audit-crlf-derived-pristine-post-contract',
    ),
    zeroReinstallSnapshot: path.join(privateRoot, 'zero-audit-reinstall-snapshot'),
    zeroReinstallApply: path.join(privateRoot, 'zero-audit-reinstall-apply'),
    zeroReinstallRecipe: path.join(privateRoot, 'zero-audit-reinstall-recipe'),
    zeroPostContract: path.join(privateRoot, 'zero-audit-reinstall-post-contract'),
  };
  for (const value of Object.values(paths)) {
    fs.mkdirSync(value, { mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(value, 0o700);
  }
  return paths;
}

function runZeroAuditReinstallProof({
  api,
  psql,
  database,
  directories,
  target,
  releaseInfo,
  applyReleaseInfo,
  migrationBytes,
  migrationSha256,
  repoRoot,
  worktrees,
  expectedPostContractSha256,
}) {
  const databaseUrl = fakeLiveDatabaseUrl(database);
  if (psql.scalar('select current_setting(\'server_version_num\')::integer / 10000') !== '17'
      || psql.scalar(
        "select coalesce((select marker from rollback_operator_fixture.identity where singleton=true),'')",
      ) !== FIXTURE_MARKER) {
    fail('ZERO_AUDIT_DISPOSABLE_BOUNDARY_INVALID');
  }
  if (psql.scalar(CRLF_WRITE_AUTHORIZATION_SQL) !== CRLF_WRITE_AUTHORIZATION_TERMINAL) {
    fail('ZERO_AUDIT_ALTERNATE_REVIEWED_CRLF_INVALID');
  }
  const preinstall = psql.json(BOUNDARY_STATE_SQL);
  const snapshot = api.captureSnapshot({
    confirmed: true,
    outputDir: directories.zeroSnapshot,
    projectRef: PROJECT_REF,
    database,
    databaseUrl,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    psqlAdapter: psql.snapshotAdapter,
    aclPlatform: 'linux',
  });
  if (snapshot.status !== 'PASS' || snapshot.pre_f27_baseline !== 'PASS'
      || snapshot.pre_f27_entry_state !== 'pristine_pre_f27'
      || !HASH_RE.test(clean(snapshot.snapshot_bundle_sha256))) {
    fail('ZERO_AUDIT_SNAPSHOT_CAPTURE_INVALID');
  }
  const bundlePath = path.join(
    directories.zeroSnapshot,
    `f27-mirror-outbox-${snapshot.snapshot_bundle_sha256}.snapshot`,
  );
  const recipePath = path.join(directories.zeroRecipe, 'f27-database-rollback.sql');
  const recipe = api.generateRollbackRecipe({
    confirmed: true,
    bundlePath,
    expectedBundleSha256: snapshot.snapshot_bundle_sha256,
    outputPath: recipePath,
    projectRef: PROJECT_REF,
    database,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    aclPlatform: 'linux',
  });
  if (recipe.status !== 'PASS' || recipe.static_validation !== 'PASS'
      || recipe.private_readback !== 'PASS'
      || !HASH_RE.test(clean(recipe.rollback_recipe_sha256))) {
    fail('ZERO_AUDIT_ROLLBACK_RECIPE_INVALID');
  }
  const migration = api.applyMigration({
    confirmation: APPLY_CONFIRMATION,
    outputDir: directories.zeroApply,
    projectRef: PROJECT_REF,
    database,
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
    fail('ZERO_AUDIT_MIGRATION_APPLY_INVALID');
  }
  const pristinePostContract = api.fingerprintPost({
    confirmed: true,
    database,
    databaseUrl: disposableDatabaseUrl(database),
    outputDir: directories.zeroPristinePostContract,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    psqlAdapter: psql.snapshotAdapter,
    aclPlatform: 'linux',
  });
  if (!pristinePostContract || pristinePostContract.status !== 'PASS'
      || pristinePostContract.f27_post_contract_sha256 !== expectedPostContractSha256) {
    fail('ZERO_AUDIT_CRLF_DERIVED_POST_CONTRACT_INVALID');
  }
  const beforeRollback = psql.json(INSTALLED_STATE_SQL);
  const rollback = api.executeRollback({
    confirmation: EXECUTE_CONFIRMATION,
    databaseUrl,
    recipePath,
    expectedRecipeSha256: recipe.rollback_recipe_sha256,
    transcriptPath: path.join(directories.zeroRecipe, 'f27-database-rollback.transcript'),
    releaseSha: target.releaseSha,
    projectRef: PROJECT_REF,
    database,
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
    fail('ZERO_AUDIT_ROLLBACK_EXECUTION_INVALID');
  }
  const afterRollback = psql.json(INSTALLED_STATE_SQL);
  assertFenceState(afterRollback.fences, 'ZERO_AUDIT_ROLLBACK_FENCES_INVALID');
  assertHashCount(afterRollback.rollbacks, 0, 'ZERO_AUDIT_ROLLBACKS_NOT_EMPTY');
  assertHashCount(afterRollback.intents, 0, 'ZERO_AUDIT_INTENTS_NOT_EMPTY');
  if (!same(preinstall.fences, afterRollback.fences)
      || Number(afterRollback.open_rollback_count) !== 0
      || Number(afterRollback.unresolved_intent_count) !== 0
      || Number(afterRollback.orphan_intent_count) !== 0
      || afterRollback.trigger_enabled !== 'D'
      || Number(afterRollback.mutating_service_role_execute_count) !== 0) {
    fail('ZERO_AUDIT_ROLLBACK_STATE_INVALID');
  }
  const lineEndingReceipt = psql.json(LF_WRITE_AUTHORIZATION_SQL);
  if (lineEndingReceipt.status !== 'PASS'
      || !HASH_RE.test(clean(lineEndingReceipt.normalized_source_sha256))
      || Number(lineEndingReceipt.raw_cr_count) !== 0
      || !Number.isSafeInteger(Number(lineEndingReceipt.preserved_non_source_field_count))
      || Number(lineEndingReceipt.preserved_non_source_field_count) <= 0) {
    fail('ZERO_AUDIT_ALTERNATE_REVIEWED_LF_INVALID');
  }
  if (psql.scalar(LEGACY_HOLD_GUARD_ACL_SQL) !== LEGACY_HOLD_GUARD_ACL_TERMINAL) {
    fail('ZERO_AUDIT_LEGACY_ACL_FIXTURE_INVALID');
  }
  const reinstallSnapshot = api.captureSnapshot({
    confirmed: true,
    outputDir: directories.zeroReinstallSnapshot,
    projectRef: PROJECT_REF,
    database,
    databaseUrl,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    psqlAdapter: psql.snapshotAdapter,
    aclPlatform: 'linux',
  });
  if (reinstallSnapshot.status !== 'PASS'
      || reinstallSnapshot.pre_f27_baseline !== 'PASS'
      || reinstallSnapshot.pre_f27_entry_state !== 'exact_post_section7'
      || !HASH_RE.test(clean(reinstallSnapshot.snapshot_bundle_sha256))
      || !HASH_RE.test(clean(reinstallSnapshot.preserved_fence_generations_sha256))
      || !HASH_RE.test(clean(reinstallSnapshot.retained_audit_sha256))) {
    fail('ZERO_AUDIT_POST_SECTION7_SNAPSHOT_INVALID');
  }
  const reinstallBundlePath = path.join(
    directories.zeroReinstallSnapshot,
    `f27-mirror-outbox-${reinstallSnapshot.snapshot_bundle_sha256}.snapshot`,
  );
  const reinstallRecipePath = path.join(
    directories.zeroReinstallRecipe,
    'f27-database-rollback.sql',
  );
  const reinstallRecipe = api.generateRollbackRecipe({
    confirmed: true,
    bundlePath: reinstallBundlePath,
    expectedBundleSha256: reinstallSnapshot.snapshot_bundle_sha256,
    outputPath: reinstallRecipePath,
    projectRef: PROJECT_REF,
    database,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    aclPlatform: 'linux',
  });
  if (reinstallRecipe.status !== 'PASS'
      || reinstallRecipe.static_validation !== 'PASS'
      || reinstallRecipe.private_readback !== 'PASS'
      || !HASH_RE.test(clean(reinstallRecipe.rollback_recipe_sha256))) {
    fail('ZERO_AUDIT_REINSTALL_RECIPE_INVALID');
  }
  const reinstallMigration = api.applyMigration({
    confirmation: APPLY_CONFIRMATION,
    outputDir: directories.zeroReinstallApply,
    projectRef: PROJECT_REF,
    database,
    databaseUrl,
    releaseSha: target.releaseSha,
    expectedMigrationSha256: migrationSha256,
    snapshotBundle: reinstallBundlePath,
    expectedSnapshotBundleSha256: reinstallSnapshot.snapshot_bundle_sha256,
    migrationBytes,
    releaseInfo: applyReleaseInfo,
    preSpawnReleaseInfo: applyReleaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    psqlAdapter: psql.migrationAdapter,
    aclPlatform: 'linux',
  });
  if (reinstallMigration.status !== 'PASS' || reinstallMigration.psql_exit_status !== 0
      || reinstallMigration.migration_transaction_and_self_probe !== 'PASS') {
    fail('ZERO_AUDIT_REINSTALL_INVALID');
  }
  const afterReinstall = psql.json(INSTALLED_STATE_SQL);
  const postContract = api.fingerprintPost({
    confirmed: true,
    database,
    databaseUrl: disposableDatabaseUrl(database),
    outputDir: directories.zeroPostContract,
    releaseSha: target.releaseSha,
    releaseInfo,
    repoRoot,
    worktreeRoots: worktrees,
    psqlAdapter: psql.snapshotAdapter,
    aclPlatform: 'linux',
  });
  validateZeroAuditReinstallTransition(
    preinstall,
    beforeRollback,
    afterRollback,
    afterReinstall,
    pristinePostContract.f27_post_contract_sha256,
    postContract,
  );
  return {
    preinstall,
    snapshot,
    recipe,
    migration,
    pristinePostContract,
    beforeRollback,
    rollback,
    afterRollback,
    lineEndingReceipt,
    reinstallSnapshot,
    reinstallRecipe,
    reinstallMigration,
    afterReinstall,
    postContract,
  };
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
    postgresql_17: 'PASS',
    exact_preinstall_subset: 'PASS',
    snapshot_capture: 'PASS',
    rollback_recipe_generation: 'PASS',
    migration_apply_once: 'PASS',
    reserved_drill: 'PASS',
    rollback_recipe_execution: 'PASS',
    exact_post_section7_snapshot_acceptance: 'PASS',
    retained_state_drift_clone_count: RETAINED_DRIFT_DATABASES.length,
    post_rollback_reinstall_apply_once: 'PASS',
    normalized_post_contract_converged: 'PASS',
    f27_fence_generation_invariants: 'PASS',
    f27_no_open_or_unresolved_work: 'PASS',
    f27_baseline_state_preserved: 'PASS',
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
    post_section7_snapshot_bundle_sha256: results.reinstallSnapshot.snapshot_bundle_sha256,
    post_section7_rollback_recipe_sha256: results.reinstallRecipe.rollback_recipe_sha256,
    preserved_fence_generations_sha256:
      results.reinstallSnapshot.preserved_fence_generations_sha256,
    retained_audit_sha256: results.reinstallSnapshot.retained_audit_sha256,
    reinstalled_post_contract_sha256: results.postContract.f27_post_contract_sha256,
    zero_audit_production_sequence: 'PASS',
    zero_audit_legacy_hold_guard_acl_adopted: 'PASS',
    zero_audit_alternate_reviewed_line_endings: results.zeroAudit.lineEndingReceipt.status,
    zero_audit_write_authorization_normalized_source_sha256:
      results.zeroAudit.lineEndingReceipt.normalized_source_sha256,
    zero_audit_write_authorization_raw_cr_count:
      Number(results.zeroAudit.lineEndingReceipt.raw_cr_count),
    zero_audit_write_authorization_preserved_non_source_field_count:
      Number(results.zeroAudit.lineEndingReceipt.preserved_non_source_field_count),
    zero_audit_crlf_derived_pristine_post_contract_sha256:
      results.zeroAudit.pristinePostContract.f27_post_contract_sha256,
    zero_audit_rollback_row_count: Number(results.zeroAudit.afterRollback.rollbacks.count),
    zero_audit_intent_row_count: Number(results.zeroAudit.afterRollback.intents.count),
    zero_audit_preserved_fence_generations_sha256:
      results.zeroAudit.reinstallSnapshot.preserved_fence_generations_sha256,
    zero_audit_retained_audit_sha256:
      results.zeroAudit.reinstallSnapshot.retained_audit_sha256,
    zero_audit_rollback_transcript_sha256:
      results.zeroAudit.rollback.private_transcript_sha256,
    zero_audit_reinstalled_post_contract_sha256:
      results.zeroAudit.postContract.f27_post_contract_sha256,
  };
}

async function runProof(options, dependencies = {}) {
  const worktrees = dependencies.worktrees || registeredWorktrees(options.repoRoot || REPO_ROOT);
  const privateRoot = validatePrivateRoot(options.privateRoot, worktrees);
  const target = validateTarget(options, options.env || process.env);
  const expectedPostContractSha256 = clean(options.expectedPostContractSha256);
  if (!HASH_RE.test(expectedPostContractSha256)) fail('POST_CONTRACT_HASH_REQUIRED');
  if (options.prepareRetainedDriftClones !== true) {
    fail('RETAINED_DRIFT_CONFIRMATION_REQUIRED');
  }
  const localEnv = localPsqlEnvironment(options.env || process.env, target.database);
  const psql = dependencies.psql || createLocalPsql(localEnv);
  const cloneRetainedState = dependencies.clonePostRollbackDatabases
    || clonePostRollbackDatabases;
  const clonePristineState = dependencies.clonePristineZeroAuditDatabase
    || clonePristineZeroAuditDatabase;
  const api = {
    captureSnapshot,
    fingerprintPost,
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
    if (psql.scalar('select current_setting(\'server_version_num\')::integer / 10000') !== '17') {
      fail('POSTGRESQL_17_REQUIRED');
    }
    if (psql.scalar(
      "select coalesce((select marker from rollback_operator_fixture.identity where singleton=true),'')",
    ) !== FIXTURE_MARKER) {
      fail('DISPOSABLE_FIXTURE_MARKER_REQUIRED');
    }
    const directories = createPrivateDirectories(privateRoot);
    const preinstall = psql.json(BOUNDARY_STATE_SQL);
    clonePristineState(localEnv, target.database, ZERO_AUDIT_REINSTALL_DATABASE);
    const zeroAuditEnv = localPsqlEnvironment(
      options.env || process.env,
      ZERO_AUDIT_REINSTALL_DATABASE,
    );
    const zeroAuditPsql = dependencies.zeroAuditPsql || createLocalPsql(zeroAuditEnv);
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
    cloneRetainedState(localEnv, target.database, RETAINED_DRIFT_DATABASES);

    const reinstallSnapshot = api.captureSnapshot({
      confirmed: true,
      outputDir: directories.reinstallSnapshot,
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
    if (reinstallSnapshot.status !== 'PASS'
        || reinstallSnapshot.pre_f27_baseline !== 'PASS'
        || reinstallSnapshot.pre_f27_entry_state !== 'exact_post_section7'
        || !HASH_RE.test(clean(reinstallSnapshot.snapshot_bundle_sha256))
        || !HASH_RE.test(clean(reinstallSnapshot.preserved_fence_generations_sha256))
        || !HASH_RE.test(clean(reinstallSnapshot.retained_audit_sha256))) {
      fail('POST_SECTION7_SNAPSHOT_CAPTURE_INVALID');
    }
    const reinstallBundlePath = path.join(
      directories.reinstallSnapshot,
      `f27-mirror-outbox-${reinstallSnapshot.snapshot_bundle_sha256}.snapshot`,
    );
    const reinstallRecipePath = path.join(
      directories.reinstallRecipe,
      'f27-database-rollback.sql',
    );
    const reinstallRecipe = api.generateRollbackRecipe({
      confirmed: true,
      bundlePath: reinstallBundlePath,
      expectedBundleSha256: reinstallSnapshot.snapshot_bundle_sha256,
      outputPath: reinstallRecipePath,
      projectRef: PROJECT_REF,
      database: target.database,
      releaseSha: target.releaseSha,
      releaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      aclPlatform: 'linux',
    });
    if (reinstallRecipe.status !== 'PASS'
        || reinstallRecipe.static_validation !== 'PASS'
        || reinstallRecipe.private_readback !== 'PASS'
        || !HASH_RE.test(clean(reinstallRecipe.rollback_recipe_sha256))) {
      fail('POST_SECTION7_ROLLBACK_RECIPE_INVALID');
    }
    const reinstallMigration = api.applyMigration({
      confirmation: APPLY_CONFIRMATION,
      outputDir: directories.reinstallApply,
      projectRef: PROJECT_REF,
      database: target.database,
      databaseUrl,
      releaseSha: target.releaseSha,
      expectedMigrationSha256: migrationSha256,
      snapshotBundle: reinstallBundlePath,
      expectedSnapshotBundleSha256: reinstallSnapshot.snapshot_bundle_sha256,
      migrationBytes,
      releaseInfo: applyReleaseInfo,
      preSpawnReleaseInfo: applyReleaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      psqlAdapter: psql.migrationAdapter,
      aclPlatform: 'linux',
    });
    if (reinstallMigration.status !== 'PASS' || reinstallMigration.psql_exit_status !== 0
        || reinstallMigration.migration_transaction_and_self_probe !== 'PASS') {
      fail('POST_SECTION7_REINSTALL_INVALID');
    }
    const afterReinstall = psql.json(INSTALLED_STATE_SQL);
    const postContract = api.fingerprintPost({
      confirmed: true,
      database: target.database,
      databaseUrl: disposableDatabaseUrl(target.database),
      outputDir: directories.postContract,
      releaseSha: target.releaseSha,
      releaseInfo,
      repoRoot,
      worktreeRoots: worktrees,
      psqlAdapter: psql.snapshotAdapter,
      aclPlatform: 'linux',
    });
    validateReinstallTransition(
      beforeRollback,
      afterRollback,
      afterReinstall,
      expectedPostContractSha256,
      postContract,
    );
    const zeroAudit = runZeroAuditReinstallProof({
      api,
      psql: zeroAuditPsql,
      database: ZERO_AUDIT_REINSTALL_DATABASE,
      directories,
      target,
      releaseInfo,
      applyReleaseInfo,
      migrationBytes,
      migrationSha256,
      repoRoot,
      worktrees,
      expectedPostContractSha256,
    });
    receipt = publicReceipt({
      preinstall,
      beforeRollback,
      afterRollback,
      snapshot,
      migration,
      recipe,
      rollback,
      reinstallSnapshot,
      reinstallRecipe,
      reinstallMigration,
      afterReinstall,
      postContract,
      zeroAudit,
    });
  } finally {
    cleanupPrivateRoot(privateRoot);
  }
  return receipt;
}

function parseArgs(argv) {
  const allowed = new Set([
    'private-root',
    'release-sha',
    'confirm-database',
    'expected-post-contract-sha256',
    'prepare-retained-drift-clones',
  ]);
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
    expectedPostContractSha256: values['expected-post-contract-sha256'],
    prepareRetainedDriftClones:
      values['prepare-retained-drift-clones'] === RETAINED_DRIFT_CONFIRMATION,
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
  CRLF_WRITE_AUTHORIZATION_SQL,
  CRLF_WRITE_AUTHORIZATION_TERMINAL,
  INSTALLED_STATE_SQL,
  LF_WRITE_AUTHORIZATION_SQL,
  LEGACY_HOLD_GUARD_ACL_SQL,
  LEGACY_HOLD_GUARD_ACL_TERMINAL,
  PostgresRollbackProofError,
  RETAINED_DRIFT_CONFIRMATION,
  RETAINED_DRIFT_DATABASES,
  ZERO_AUDIT_REINSTALL_DATABASE,
  clonePristineZeroAuditDatabase,
  clonePostRollbackDatabases,
  createLocalPsql,
  parseArgs,
  publicFailure,
  publicReceipt,
  runProof,
  validatePrivateRoot,
  validateStateTransition,
  validateReinstallTransition,
  validateZeroAuditReinstallTransition,
  validateTarget,
  verifyCheckedOutRelease,
};
