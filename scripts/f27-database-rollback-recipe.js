#!/usr/bin/env node
'use strict';

/*
 * Render the private, one-shot F27 database rollback recipe from the sealed
 * pre-DDL mirror_outbox snapshot. This generator never connects to a database.
 * Both its input bundle and output recipe must be outside every Git worktree.
 *
 * F27_CONFIRM_DATABASE_ROLLBACK_RECIPE=1 \
 * node scripts/f27-database-rollback-recipe.js \
 *   --bundle=/absolute/private/f27-mirror-outbox-<sha256>.snapshot \
 *   --expected-bundle-sha256=<sha256> \
 *   --output=/absolute/private/f27-database-rollback-<sha256>.sql \
 *   --confirm-project-ref=<20-char-ref> \
 *   --confirm-database=postgres \
 *   --release-sha=<40-lowercase-hex>
 *
 * The generated psql recipe additionally requires these exact invocation
 * binders: f27_release_sha, f27_project_ref, f27_database, and
 * f27_snapshot_bundle_sha256.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { assertWindowsPrivateFileAcl } = require('./f27-mirror-outbox-snapshot');

const REPO_ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_FORMAT = 'syncview-f27-mirror-outbox-snapshot-v1';
const MIGRATION_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const DATABASE_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const SAFE_IDENTIFIER_RE = /^[a-z_][a-z0-9_]*$/;
const EXPECTED_FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const BOUNDARY_FUNCTIONS = [
  {
    name: 'mirror_outbox_enqueue',
    identity: 'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)',
  },
  {
    name: 'production_assert_authority',
    identity: 'public.production_assert_authority(text,text,boolean,boolean)',
  },
];
const MUTATING_F27_FUNCTIONS = [
  'public.track_b_f27_requeue(bigint,bigint)',
  'public.track_b_f27_begin(text,jsonb,text)',
  'public.track_b_f27_begin_drill(jsonb,text)',
  'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)',
  'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)',
  'public.track_b_f27_record_terminal(uuid,bigint,jsonb)',
  'public.track_b_f27_finalize(uuid,jsonb,text)',
  'public.track_b_f27_finalize_drill(uuid,jsonb,text)',
];
const REQUIRED_MEMBERS = [
  'database/mirror_outbox.rows.jsonl',
  'database/mirror_outbox.preinstall-column-projection.json',
  'database/mirror_outbox.functions.jsonl',
  'database/runtime-safety-state.json',
  'metadata/snapshot.json',
];

class RollbackRecipeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RollbackRecipeError';
    this.code = code;
  }
}

function fail(code) {
  throw new RollbackRecipeError(code);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
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

function normalized(value) {
  const result = path.resolve(value);
  return process.platform === 'win32' ? result.toLowerCase() : result;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function lstatOrNull(value) {
  try { return fs.lstatSync(value); }
  catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('PRIVATE_PATH_INSPECTION_FAILED');
  }
}

function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const parts = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) fail('PRIVATE_SYMLINK_REJECTED');
    let real;
    try { real = fs.realpathSync.native(cursor); }
    catch (_) { fail('PRIVATE_PATH_INSPECTION_FAILED'); }
    if (normalized(real) !== normalized(cursor)) fail('PRIVATE_SYMLINK_REJECTED');
  }
}

function discoverWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) { fail('WORKTREE_DISCOVERY_FAILED'); }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED');
  return roots;
}

function containingWorktree(value) {
  let cursor = path.resolve(value);
  while (!lstatOrNull(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (lstatOrNull(cursor) && !lstatOrNull(cursor).isDirectory()) cursor = path.dirname(cursor);
  try {
    return clean(execFileSync('git', ['-C', cursor, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })) || null;
  } catch (_) { return null; }
}

function assertOutsideWorktrees(value, worktreeRoots, code) {
  const resolved = path.resolve(value);
  assertNoSymlinkComponents(resolved);
  if (worktreeRoots.some(root => isWithin(root, resolved))) fail(code);
  const containing = containingWorktree(resolved);
  if (containing && isWithin(containing, resolved)) fail(code);
  return resolved;
}

function assertPrivateBundlePath(value, worktreeRoots, privacyOptions = {}) {
  if (!value || !path.isAbsolute(value)) fail('PRIVATE_BUNDLE_INPUT_INVALID');
  const resolved = assertOutsideWorktrees(value, worktreeRoots, 'PRIVATE_BUNDLE_WORKTREE_REJECTED');
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_BUNDLE_INPUT_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('PRIVATE_PERMISSIONS_REQUIRED');
  try { assertWindowsPrivateFileAcl(resolved, privacyOptions); }
  catch (_) { fail('WINDOWS_PRIVATE_ACL_REQUIRED'); }
  return resolved;
}

function assertPrivateOutputPath(value, worktreeRoots) {
  if (!value || !path.isAbsolute(value) || path.extname(value).toLowerCase() !== '.sql') {
    fail('PRIVATE_OUTPUT_INVALID');
  }
  const resolved = assertOutsideWorktrees(value, worktreeRoots, 'PRIVATE_OUTPUT_WORKTREE_REJECTED');
  if (lstatOrNull(resolved)) fail('PRIVATE_OUTPUT_EXISTS');
  const parent = path.dirname(resolved);
  assertNoSymlinkComponents(parent);
  const stat = lstatOrNull(parent);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) fail('PRIVATE_OUTPUT_DIRECTORY_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('PRIVATE_PERMISSIONS_REQUIRED');
  return resolved;
}

function decodeBase64Exact(value, code) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    fail(code);
  }
  let bytes;
  try { bytes = Buffer.from(value, 'base64'); }
  catch (_) { fail(code); }
  if (bytes.toString('base64') !== value) fail(code);
  return bytes;
}

function parseJson(bytes, code) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch (_) { fail(code); }
}

function verifyBundle(bundlePath, expectedSha256, worktreeRoots, privacyOptions = {}) {
  if (!HASH_RE.test(expectedSha256)) fail('PRIVATE_BUNDLE_HASH_REQUIRED');
  const resolved = assertPrivateBundlePath(bundlePath, worktreeRoots, privacyOptions);
  let bytes;
  try { bytes = fs.readFileSync(resolved); }
  catch (_) { fail('PRIVATE_BUNDLE_READ_FAILED'); }
  if (sha256(bytes) !== expectedSha256) fail('PRIVATE_BUNDLE_HASH_MISMATCH');
  const bundle = parseJson(bytes, 'PRIVATE_BUNDLE_MALFORMED');
  if (!bundle || bundle.format !== `${SNAPSHOT_FORMAT}-bundle`
      || !HASH_RE.test(clean(bundle.manifest_sha256))
      || !Array.isArray(bundle.files)) fail('PRIVATE_BUNDLE_MALFORMED');
  const manifestBytes = decodeBase64Exact(bundle.manifest_base64, 'PRIVATE_BUNDLE_MALFORMED');
  if (sha256(manifestBytes) !== bundle.manifest_sha256) fail('PRIVATE_BUNDLE_HASH_MISMATCH');
  const manifest = parseJson(manifestBytes, 'PRIVATE_BUNDLE_MALFORMED');
  if (!manifest || manifest.format !== `${SNAPSHOT_FORMAT}-manifest`
      || !Array.isArray(manifest.files) || manifest.files.length !== bundle.files.length) {
    fail('PRIVATE_BUNDLE_MALFORMED');
  }
  const files = new Map();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const stored = bundle.files[index];
    if (!entry || !stored || entry.path !== stored.path || files.has(entry.path)
        || !/^[a-z0-9_.\/-]+$/.test(entry.path)
        || path.posix.isAbsolute(entry.path)
        || entry.path.split('/').some(part => part === '..')
        || !HASH_RE.test(clean(entry.sha256)) || entry.sha256 !== stored.sha256) {
      fail('PRIVATE_BUNDLE_MALFORMED');
    }
    const content = decodeBase64Exact(stored.content_base64, 'PRIVATE_BUNDLE_MALFORMED');
    if (content.length !== Number(entry.byte_length)
        || content.length !== Number(stored.byte_length)
        || sha256(content) !== entry.sha256) fail('PRIVATE_BUNDLE_HASH_MISMATCH');
    files.set(entry.path, content);
  }
  if (!REQUIRED_MEMBERS.every(member => files.has(member))) fail('PRIVATE_BUNDLE_INCOMPLETE');
  return { bytes, files };
}

function releaseProof(options) {
  if (!SHA_RE.test(options.releaseSha)) fail('RELEASE_SHA_INVALID');
  if (options.releaseInfo) {
    const info = options.releaseInfo;
    if (info.headSha !== options.releaseSha) fail('RELEASE_SHA_MISMATCH');
    if (clean(info.originMainSha || info.originMain) !== options.releaseSha) fail('ORIGIN_MAIN_MISMATCH');
    if (info.dirty) fail('DIRTY_SOURCE_REJECTED');
    if (!HASH_RE.test(clean(info.migrationSha256))) fail('MIGRATION_HASH_INVALID');
    return { ...info, originMainSha: clean(info.originMainSha || info.originMain) };
  }
  let headSha;
  let originMainSha;
  let status;
  const repoRoot = options.repoRoot || REPO_ROOT;
  try {
    headSha = clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }));
    originMainSha = clean(execFileSync(
      'git', ['-C', repoRoot, 'rev-parse', '--verify', 'refs/remotes/origin/main'],
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    ));
    status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) { fail('RELEASE_PROOF_FAILED'); }
  if (headSha !== options.releaseSha) fail('RELEASE_SHA_MISMATCH');
  if (originMainSha !== options.releaseSha) fail('ORIGIN_MAIN_MISMATCH');
  if (clean(status)) fail('DIRTY_SOURCE_REJECTED');
  let migration;
  try { migration = fs.readFileSync(path.join(repoRoot, MIGRATION_PATH)); }
  catch (_) { fail('MIGRATION_READ_FAILED'); }
  return { headSha, originMainSha, dirty: false, migrationSha256: sha256(migration) };
}

function jsonl(bytes, code) {
  const text = bytes.toString('utf8');
  const lines = text.split(/\r?\n/).filter(line => line.length);
  return lines.map(line => {
    try { return { raw: line, value: JSON.parse(line) }; }
    catch (_) { fail(code); }
  });
}

function parseSnapshot(files, options, release) {
  const metadata = parseJson(files.get('metadata/snapshot.json'), 'PRIVATE_METADATA_MALFORMED');
  if (!metadata || metadata.format !== SNAPSHOT_FORMAT
      || metadata.release_sha !== release.headSha
      || metadata.migration_sha256 !== release.migrationSha256
      || metadata.project_ref !== options.projectRef
      || metadata.database !== options.database) fail('PRIVATE_BUNDLE_BINDING_MISMATCH');

  const runtime = parseJson(files.get('database/runtime-safety-state.json'), 'PRIVATE_RUNTIME_MALFORMED');
  if (!runtime || !same(runtime.flags, EXPECTED_FLAGS)
      || !Number.isSafeInteger(Number(runtime.flag_flips_count))
      || Number(runtime.flag_flips_count) < 0) fail('PRIVATE_RUNTIME_INVALID');

  const projection = parseJson(
    files.get('database/mirror_outbox.preinstall-column-projection.json'),
    'PRIVATE_PROJECTION_MALFORMED',
  );
  if (!Array.isArray(projection) || projection[0] !== 'id'
      || !projection.length || new Set(projection).size !== projection.length
      || projection.some(name => !SAFE_IDENTIFIER_RE.test(name))
      || !['id', 'payload', 'created_at', 'team', 'status', 'dedup_key'].every(name => projection.includes(name))) {
    fail('PRIVATE_PROJECTION_INVALID');
  }

  const rows = jsonl(files.get('database/mirror_outbox.rows.jsonl'), 'PRIVATE_ROWS_MALFORMED');
  for (const row of rows) {
    if (!row.value || typeof row.value !== 'object' || Array.isArray(row.value)
        || !Object.prototype.hasOwnProperty.call(row.value, 'id')) fail('PRIVATE_ROWS_MALFORMED');
    const keys = Object.keys(row.value).sort();
    if (keys.length !== projection.length || keys.some((key, index) => key !== [...projection].sort()[index])) {
      fail('PRIVATE_ROW_PROJECTION_MISMATCH');
    }
  }

  const functionRecords = jsonl(
    files.get('database/mirror_outbox.functions.jsonl'),
    'PRIVATE_FUNCTIONS_MALFORMED',
  ).map(record => record.value);
  const functions = BOUNDARY_FUNCTIONS.map(required => {
    const matches = functionRecords.filter(item => item && item.regprocedure_identity === required.identity);
    if (matches.length !== 1) fail('PRIVATE_BOUNDARY_FUNCTION_MISSING');
    const item = matches[0];
    if (item.name !== required.name || !clean(item.owner)
        || typeof item.definition !== 'string' || !item.definition.trim()
        || !new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${required.name}\\s*\\(`, 'i').test(item.definition)
        || !(item.config == null || Array.isArray(item.config) && item.config.every(value => typeof value === 'string' && value.includes('=')))
        || !(item.acl == null || Array.isArray(item.acl) && item.acl.every(value => typeof value === 'string' && value.length))) {
      fail('PRIVATE_BOUNDARY_FUNCTION_INVALID');
    }
    return {
      name: required.name,
      identity: required.identity,
      owner: item.owner,
      definition: item.definition,
      config: item.config == null ? null : item.config,
      acl: item.acl == null ? null : item.acl,
    };
  });
  return {
    metadata,
    runtime: { flags: stableValue(runtime.flags), flagFlipsCount: Number(runtime.flag_flips_count) },
    projection,
    rows,
    functions,
  };
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quotedIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlTextArray(values) {
  if (values == null) return 'NULL::text[]';
  if (!values.length) return 'ARRAY[]::text[]';
  return `ARRAY[${values.map(sqlLiteral).join(',')} ]::text[]`;
}

function sqlAclArray(values) {
  if (values == null) return 'NULL::aclitem[]';
  if (!values.length) return 'ARRAY[]::aclitem[]';
  return `ARRAY[${values.map(sqlLiteral).join(',')} ]::aclitem[]`;
}

function psqlBinder(name, expected) {
  return String.raw`\if :{?${name}}
SELECT :'${name}' = ${sqlLiteral(expected)} AS f27_binder_ok \gset
\if :f27_binder_ok
\else
\quit 3
\endif
\else
\quit 3
\endif`;
}

function buildRecipe(snapshot, options) {
  const rowValues = snapshot.rows.map(row => `  (convert_from(decode(${sqlLiteral(Buffer.from(row.raw, 'utf8').toString('base64'))},'base64'),'UTF8')::jsonb)`).join(',\n');
  const functionValues = snapshot.functions.map(fn => `  (${sqlLiteral(fn.identity)},${sqlLiteral(fn.owner)},convert_from(decode(${sqlLiteral(Buffer.from(fn.definition, 'utf8').toString('base64'))},'base64'),'UTF8'),${sqlTextArray(fn.config)},${sqlAclArray(fn.acl)})`).join(',\n');
  const projectedColumns = snapshot.projection
    .map(name => `o.${quotedIdentifier(name)} AS ${quotedIdentifier(name)}`)
    .join(',');
  const revokeStatements = MUTATING_F27_FUNCTIONS.map(identity =>
    `REVOKE EXECUTE ON FUNCTION ${identity} FROM PUBLIC, anon, authenticated, service_role;`).join('\n');
  const revokeAssertions = MUTATING_F27_FUNCTIONS.map(identity =>
    `    (${sqlLiteral(identity)}, has_function_privilege('service_role', ${sqlLiteral(identity)}, 'EXECUTE'))`).join(',\n');
  const runtimeBase64 = Buffer.from(JSON.stringify(snapshot.runtime.flags), 'utf8').toString('base64');

  return String.raw`\set ON_ERROR_STOP on
\set QUIET on
${psqlBinder('f27_release_sha', options.releaseSha)}
${psqlBinder('f27_project_ref', options.projectRef)}
${psqlBinder('f27_database', options.database)}
${psqlBinder('f27_snapshot_bundle_sha256', options.expectedBundleSha256)}

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';
LOCK TABLE public.mirror_outbox IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE f27_captured_rows(row_json jsonb NOT NULL) ON COMMIT DROP;
INSERT INTO f27_captured_rows(row_json) VALUES
${rowValues || "  ('{}'::jsonb)"};
${snapshot.rows.length ? '' : 'TRUNCATE f27_captured_rows;'}

CREATE TEMP TABLE f27_runtime_guard(flags jsonb NOT NULL, flag_flips_count bigint NOT NULL) ON COMMIT DROP;
INSERT INTO f27_runtime_guard(flags,flag_flips_count)
VALUES (convert_from(decode(${sqlLiteral(runtimeBase64)},'base64'),'UTF8')::jsonb,${snapshot.runtime.flagFlipsCount});

CREATE TEMP TABLE f27_audit_guard(name text PRIMARY KEY,row_count bigint NOT NULL,row_sha256 text NOT NULL) ON COMMIT DROP;
INSERT INTO f27_audit_guard(name,row_count,row_sha256)
SELECT 'rollbacks',count(*),encode(extensions.digest(convert_to(coalesce(string_agg(
  encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex'),'' ORDER BY r.id::text
),''),'UTF8'),'sha256'),'hex') FROM public.track_b_team_rollbacks r
UNION ALL
SELECT 'intents',count(*),encode(extensions.digest(convert_to(coalesce(string_agg(
  encode(extensions.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex'),'' ORDER BY i.rollback_id::text,i.outbox_id
),''),'UTF8'),'sha256'),'hex') FROM public.track_b_team_rollback_intents i;

CREATE TEMP TABLE f27_restore_boundary(
  function_identity text PRIMARY KEY,
  owner_name text NOT NULL,
  definition text NOT NULL,
  function_config text[],
  raw_acl aclitem[]
) ON COMMIT DROP;
INSERT INTO f27_restore_boundary(function_identity,owner_name,definition,function_config,raw_acl) VALUES
${functionValues};

DO $f27_preflight$
DECLARE v_flags jsonb; v_flips bigint;
BEGIN
  IF current_database() IS DISTINCT FROM ${sqlLiteral(options.database)} THEN
    RAISE EXCEPTION 'F27_ROLLBACK_DATABASE_MISMATCH';
  END IF;
  IF to_regclass('public.track_b_team_rollbacks') IS NULL
     OR to_regclass('public.track_b_team_rollback_intents') IS NULL
     OR to_regclass('public.track_b_f27_team_fences') IS NULL
     OR to_regprocedure('public.track_b_f27_hold_guard()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attname='authority_generation' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attname='f27_drill_rollback_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'F27_ROLLBACK_ADDITIVE_OBJECTS_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.mirror_outbox'::regclass
      AND t.tgname='track_b_f27_hold_guard' AND NOT t.tgisinternal
      AND p.oid=to_regprocedure('public.track_b_f27_hold_guard()')
      AND t.tgenabled='O'
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_GUARD_TRIGGER_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM public.track_b_team_rollbacks WHERE state='open') THEN
    RAISE EXCEPTION 'F27_ROLLBACK_OPEN_CASE_PRESENT';
  END IF;
  IF to_regrole('service_role') IS NULL OR to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'F27_ROLLBACK_ROLE_MISSING';
  END IF;
  -- CREATE OR REPLACE preserves function ACLs. F27 never changed these two
  -- ACLs, so require the raw pg_proc ACL (including NULL-vs-explicit form) to
  -- still be byte-logically exact. Refuse instead of approximating a drifted
  -- ACL through GRANT statements, which cannot reproduce every raw ACL form.
  IF EXISTS (
    SELECT 1 FROM f27_restore_boundary f
    LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.function_identity)
    WHERE p.oid IS NULL
       OR pg_get_userbyid(p.proowner) IS DISTINCT FROM f.owner_name
       OR p.proacl IS DISTINCT FROM f.raw_acl
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_BOUNDARY_OWNER_OR_ACL_DRIFT'; END IF;
  IF EXISTS (
    SELECT 1 FROM f27_captured_rows
    WHERE jsonb_typeof(row_json)<>'object' OR NOT (row_json ? 'id') OR row_json->>'id' !~ '^[0-9]+$'
  ) OR (SELECT count(*) FROM f27_captured_rows)
       <> (SELECT count(DISTINCT (row_json->>'id')::bigint) FROM f27_captured_rows) THEN
    RAISE EXCEPTION 'F27_ROLLBACK_CAPTURED_ROWS_INVALID';
  END IF;
  SELECT jsonb_object_agg(key,value ORDER BY key),
         (SELECT count(*) FROM public.flag_flips)
    INTO v_flags,v_flips
  FROM public.syncview_runtime_flags
  WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled');
  IF (v_flags,v_flips) IS DISTINCT FROM (
    (SELECT flags FROM f27_runtime_guard),(SELECT flag_flips_count FROM f27_runtime_guard)
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_RUNTIME_SAFETY_DRIFT'; END IF;
END
$f27_preflight$;

ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;

DO $f27_restore$
DECLARE
  f record; setting text; setting_name text; setting_value text;
BEGIN
  FOR f IN SELECT * FROM f27_restore_boundary ORDER BY function_identity LOOP
    IF to_regrole(f.owner_name) IS NULL THEN RAISE EXCEPTION 'F27_ROLLBACK_FUNCTION_OWNER_MISSING'; END IF;
    EXECUTE f.definition;
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',f.function_identity,f.owner_name);
    EXECUTE format('ALTER FUNCTION %s RESET ALL',f.function_identity);
    FOREACH setting IN ARRAY coalesce(f.function_config,ARRAY[]::text[]) LOOP
      setting_name:=split_part(setting,'=',1);
      setting_value:=substring(setting FROM position('=' IN setting)+1);
      IF setting_name !~ '^[a-z_][a-z0-9_.]*$' OR position('=' IN setting)=0 THEN
        RAISE EXCEPTION 'F27_ROLLBACK_FUNCTION_CONFIG_INVALID';
      END IF;
      PERFORM set_config(setting_name,setting_value,true);
      EXECUTE format('ALTER FUNCTION %s SET %I FROM CURRENT',f.function_identity,setting_name);
    END LOOP;
    IF (SELECT proacl FROM pg_proc WHERE oid=to_regprocedure(f.function_identity)) IS DISTINCT FROM f.raw_acl
       OR (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid=to_regprocedure(f.function_identity)) IS DISTINCT FROM f.owner_name
       OR (SELECT proconfig FROM pg_proc WHERE oid=to_regprocedure(f.function_identity)) IS DISTINCT FROM f.function_config
       OR pg_get_functiondef(to_regprocedure(f.function_identity)) IS DISTINCT FROM f.definition THEN
      RAISE EXCEPTION 'F27_ROLLBACK_BOUNDARY_FUNCTION_READBACK_MISMATCH';
    END IF;
  END LOOP;
END
$f27_restore$;

${revokeStatements}

DO $f27_verify$
DECLARE v_flags jsonb; v_flips bigint; v_trigger_enabled "char";
BEGIN
  IF EXISTS (
    SELECT 1
    FROM f27_captured_rows c
    LEFT JOIN public.mirror_outbox o ON o.id=(c.row_json->>'id')::bigint
    LEFT JOIN LATERAL (SELECT ${projectedColumns}) projected ON o.id IS NOT NULL
    WHERE o.id IS NULL OR to_jsonb(projected) IS DISTINCT FROM c.row_json
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_PREINSTALL_ROW_PROJECTION_CHANGED'; END IF;

  SELECT tgenabled INTO v_trigger_enabled FROM pg_trigger
  WHERE tgrelid='public.mirror_outbox'::regclass AND tgname='track_b_f27_hold_guard' AND NOT tgisinternal;
  IF v_trigger_enabled IS DISTINCT FROM 'D' THEN RAISE EXCEPTION 'F27_ROLLBACK_GUARD_NOT_DISABLED'; END IF;
  IF to_regclass('public.track_b_team_rollbacks') IS NULL
     OR to_regclass('public.track_b_team_rollback_intents') IS NULL
     OR to_regclass('public.track_b_f27_team_fences') IS NULL
     OR to_regprocedure('public.track_b_f27_hold_guard()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attname='authority_generation' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attname='f27_drill_rollback_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'F27_ROLLBACK_ADDITIVE_OBJECTS_NOT_RETAINED';
  END IF;

  IF EXISTS (
    SELECT 1 FROM (VALUES
${revokeAssertions}
    ) AS grants(function_identity,still_executable)
    WHERE still_executable
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_MUTATING_RPC_GRANT_RETAINED'; END IF;

  IF EXISTS (
    SELECT 1 FROM f27_audit_guard saved
    FULL JOIN (
      SELECT 'rollbacks'::text name,count(*) row_count,encode(extensions.digest(convert_to(coalesce(string_agg(
        encode(extensions.digest(convert_to(to_jsonb(r)::text,'UTF8'),'sha256'),'hex'),'' ORDER BY r.id::text
      ),''),'UTF8'),'sha256'),'hex') row_sha256 FROM public.track_b_team_rollbacks r
      UNION ALL
      SELECT 'intents',count(*),encode(extensions.digest(convert_to(coalesce(string_agg(
        encode(extensions.digest(convert_to(to_jsonb(i)::text,'UTF8'),'sha256'),'hex'),'' ORDER BY i.rollback_id::text,i.outbox_id
      ),''),'UTF8'),'sha256'),'hex') FROM public.track_b_team_rollback_intents i
    ) current_state USING(name)
    WHERE (saved.row_count,saved.row_sha256) IS DISTINCT FROM (current_state.row_count,current_state.row_sha256)
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_AUDIT_ROWS_CHANGED'; END IF;

  SELECT jsonb_object_agg(key,value ORDER BY key),
         (SELECT count(*) FROM public.flag_flips)
    INTO v_flags,v_flips
  FROM public.syncview_runtime_flags
  WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled');
  IF (v_flags,v_flips) IS DISTINCT FROM (
    (SELECT flags FROM f27_runtime_guard),(SELECT flag_flips_count FROM f27_runtime_guard)
  ) THEN RAISE EXCEPTION 'F27_ROLLBACK_RUNTIME_SAFETY_CHANGED'; END IF;
END
$f27_verify$;

COMMIT;
`;
}

function validateRecipe(sql, snapshot) {
  const required = [
    '\\set ON_ERROR_STOP on',
    'BEGIN;',
    'LOCK TABLE public.mirror_outbox IN ACCESS EXCLUSIVE MODE;',
    'ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;',
    'EXECUTE f.definition;',
    'F27_ROLLBACK_PREINSTALL_ROW_PROJECTION_CHANGED',
    'F27_ROLLBACK_RUNTIME_SAFETY_CHANGED',
    'F27_ROLLBACK_AUDIT_ROWS_CHANGED',
    'F27_ROLLBACK_MUTATING_RPC_GRANT_RETAINED',
    'COMMIT;',
  ];
  if (!required.every(value => sql.includes(value))
      || (sql.match(/\bBEGIN;/g) || []).length !== 1
      || (sql.match(/\bCOMMIT;/g) || []).length !== 1
      || sql.indexOf('LOCK TABLE public.mirror_outbox') > sql.indexOf('DISABLE TRIGGER')
      || BOUNDARY_FUNCTIONS.some(fn => !sql.includes(fn.identity))
      || MUTATING_F27_FUNCTIONS.some(identity => !sql.includes(`REVOKE EXECUTE ON FUNCTION ${identity}`))
      || /\b(?:DROP\s+(?:TABLE|SCHEMA|COLUMN)|TRUNCATE\s+(?:public\.)?track_b_|DELETE\s+FROM\s+(?:public\.)?track_b_)\b/i.test(sql)
      || snapshot.rows.some(row => sql.includes(row.raw))) fail('RECIPE_STATIC_VALIDATION_FAILED');
  const markers = ['$f27_preflight$', '$f27_restore$', '$f27_verify$'];
  if (markers.some(marker => sql.split(marker).length !== 3)) fail('RECIPE_STATIC_VALIDATION_FAILED');
  return true;
}

function generateRollbackRecipe(options) {
  if (!options || options.confirmed !== true) fail('CONFIRMATION_REQUIRED');
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const releaseSha = clean(options.releaseSha);
  const expectedBundleSha256 = clean(options.expectedBundleSha256);
  if (!PROJECT_REF_RE.test(projectRef)) fail('PROJECT_CONFIRMATION_INVALID');
  if (!DATABASE_RE.test(database)) fail('DATABASE_CONFIRMATION_INVALID');
  const worktreeRoots = options.worktreeRoots || discoverWorktrees(options.repoRoot || REPO_ROOT);
  const release = releaseProof({ ...options, releaseSha });
  const bundle = verifyBundle(options.bundlePath, expectedBundleSha256, worktreeRoots, {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  });
  const snapshot = parseSnapshot(bundle.files, { projectRef, database }, release);
  const outputPath = assertPrivateOutputPath(options.outputPath, worktreeRoots);
  const sql = buildRecipe(snapshot, {
    projectRef,
    database,
    releaseSha,
    expectedBundleSha256,
  });
  validateRecipe(sql, snapshot);
  const bytes = Buffer.from(sql, 'utf8');
  try {
    fs.writeFileSync(outputPath, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(outputPath, 0o400);
  } catch (_) { fail('PRIVATE_RECIPE_WRITE_FAILED'); }
  let readback;
  try { readback = fs.readFileSync(outputPath); }
  catch (_) { fail('PRIVATE_RECIPE_READBACK_FAILED'); }
  if (readback.length !== bytes.length || sha256(readback) !== sha256(bytes)) {
    fail('PRIVATE_RECIPE_READBACK_MISMATCH');
  }
  return {
    status: 'PASS',
    snapshot_bundle_sha256: expectedBundleSha256,
    rollback_recipe_sha256: sha256(bytes),
    captured_preinstall_row_count: snapshot.rows.length,
    restored_boundary_function_count: snapshot.functions.length,
    static_validation: 'PASS',
    private_readback: 'PASS',
  };
}

function parseArgs(argv) {
  const allowed = new Set([
    'bundle', 'expected-bundle-sha256', 'output', 'confirm-project-ref',
    'confirm-database', 'release-sha',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = clean(argv[index]);
    if (!token.startsWith('--')) fail('ARGUMENT_REJECTED');
    const equals = token.indexOf('=');
    const name = token.slice(2, equals < 0 ? undefined : equals);
    if (!allowed.has(name) || Object.prototype.hasOwnProperty.call(values, name)) fail('ARGUMENT_REJECTED');
    let value = equals < 0 ? '' : token.slice(equals + 1);
    if (equals < 0) {
      if (index + 1 >= argv.length || clean(argv[index + 1]).startsWith('--')) fail('ARGUMENT_REJECTED');
      value = argv[++index];
    }
    if (!clean(value)) fail('ARGUMENT_REJECTED');
    values[name] = clean(value);
  }
  if ([...allowed].some(name => !Object.prototype.hasOwnProperty.call(values, name))) fail('ARGUMENT_REJECTED');
  return values;
}

function publicFailure(error) {
  return {
    status: 'FAIL',
    code: error instanceof RollbackRecipeError && /^[A-Z0-9_]+$/.test(error.code)
      ? error.code
      : 'ROLLBACK_RECIPE_FAILED',
  };
}

function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  return generateRollbackRecipe({
    confirmed: clean(env.F27_CONFIRM_DATABASE_ROLLBACK_RECIPE) === '1',
    bundlePath: path.resolve(args.bundle),
    expectedBundleSha256: args['expected-bundle-sha256'],
    outputPath: path.resolve(args.output),
    projectRef: args['confirm-project-ref'],
    database: args['confirm-database'],
    releaseSha: args['release-sha'],
  });
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(runFromEnvironment())}${os.EOL}`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  }
}

module.exports = {
  BOUNDARY_FUNCTIONS,
  MUTATING_F27_FUNCTIONS,
  RollbackRecipeError,
  buildRecipe,
  generateRollbackRecipe,
  parseArgs,
  publicFailure,
  releaseProof,
  validateRecipe,
  verifyBundle,
};
