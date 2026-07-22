'use strict';

/*
 * F27 pre-DDL mirror_outbox capture.
 *
 * This tool is intentionally database-read-only. It opens one psql session and
 * takes every database item inside one REPEATABLE READ, READ ONLY transaction.
 * Private rows and definitions are written only below the explicitly supplied
 * private output directory; stdout receives a redacted receipt only.
 *
 * Usage (future owner-gated install window only):
 *   F27_DATABASE_URL='postgresql://...' \
 *   F27_CONFIRM_MIRROR_OUTBOX_SNAPSHOT=1 \
 *   node scripts/f27-mirror-outbox-snapshot.js \
 *     --output-dir /absolute/empty/private/directory \
 *     --confirm-project-ref <project-ref> \
 *     --confirm-database postgres \
 *     --release-sha <40-lowercase-hex>
 *
 * The receipt's snapshot_bundle_sha256 deterministically names the private
 * handoff file as f27-mirror-outbox-<sha256>.snapshot below --output-dir. The
 * private path itself is never printed. `--mode fingerprint-post` reads a
 * loopback disposable database to produce the exact source-contract hash;
 * `--mode verify-after` requires that hash plus the sealed private bundle and
 * performs the post-COMMIT old-projection and F27 object readback.
 *
 * No live invocation is part of this source-only change.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_RELATIVE_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const FORMAT = 'syncview-f27-mirror-outbox-snapshot-v1';
const TOOL_RELEASE = 'f27-mirror-outbox-snapshot-v1';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const SAFE_DATABASE_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const NEWEST_LIMIT = 5;
const REQUIRED_SECTIONS = [
  'metadata',
  'runtime_safety',
  'pre_f27_baseline',
  'table',
  'columns',
  'constraints',
  'triggers',
  'functions',
  'indexes',
  'policies',
  'grants',
  'rows',
  'aggregates',
  'newest',
];
const REQUIRED_COLUMNS = ['id', 'payload', 'created_at', 'team', 'status', 'dedup_key'];
const REQUIRED_FUNCTION_NAMES = ['mirror_outbox_enqueue', 'production_assert_authority'];
const REQUIRED_BOUNDARY_FUNCTION_IDENTITIES = [
  'public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)',
  'public.production_assert_authority(text,text,boolean,boolean)',
];
const EXPECTED_RUNTIME_FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};
const F27_FUNCTION_NAMES = [
  'mirror_outbox_enqueue',
  'track_b_f27_write_authorization',
  'track_b_f27_requeue',
  'track_b_f27_hold_guard',
  'production_assert_authority',
  'track_b_f27_begin',
  'track_b_f27_begin_drill',
  'track_b_f27_classify',
  'track_b_f27_execute_drill_replay',
  'track_b_f27_record_terminal',
  'track_b_f27_finalize',
  'track_b_f27_finalize_drill',
];
const F27_CONSTRAINT_NAMES = [
  'mirror_outbox_f27_drill_rollback_id_fkey',
  'mirror_outbox_f27_drill_scope_check',
  'mirror_outbox_f27_generation_check',
];
const F27_OUTBOX_COLUMN_NAMES = ['authority_generation', 'f27_drill_rollback_id'];
const F27_OUTBOX_INDEX_NAME = 'mirror_outbox_one_f27_drill_row_idx';
const F27_OUTBOX_TRIGGER_NAME = 'track_b_f27_hold_guard';
const F27_TABLE_NAMES = [
  'track_b_f27_team_fences',
  'track_b_team_rollbacks',
  'track_b_team_rollback_intents',
];
const F27_EXECUTE_FUNCTION_IDENTITIES = [
  'public.track_b_f27_write_authorization(text)',
  'public.track_b_f27_requeue(bigint,bigint)',
  'public.track_b_f27_begin(text,jsonb,text)',
  'public.track_b_f27_begin_drill(jsonb,text)',
  'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)',
  'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)',
  'public.track_b_f27_record_terminal(uuid,bigint,jsonb)',
  'public.track_b_f27_finalize(uuid,jsonb,text)',
  'public.track_b_f27_finalize_drill(uuid,jsonb,text)',
];
const SAFE_TEAMS = new Set(['video', 'graphics']);
const SAFE_STATUSES = new Set(['pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale']);
const WINDOWS_PRIVATE_ACL_FORMAT = 'syncview-f27-windows-private-acl-v1';
const WINDOWS_SYSTEM_SID = 'S-1-5-18';
const WINDOWS_ADMINISTRATORS_SID = 'S-1-5-32-544';
const WINDOWS_PRIVATE_ACL_ACTIONS = new Set(['protect-directory', 'verify-file']);
const WINDOWS_PRIVATE_ACL_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "$target = [Environment]::GetEnvironmentVariable('F27_PRIVATE_ACL_TARGET', 'Process')",
  "$action = [Environment]::GetEnvironmentVariable('F27_PRIVATE_ACL_ACTION', 'Process')",
  "if ([string]::IsNullOrWhiteSpace($target)) { throw 'missing ACL target' }",
  "$item = Get-Item -LiteralPath $target -Force",
  "$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
  "$allowedSids = @($currentSid, 'S-1-5-18', 'S-1-5-32-544') | Select-Object -Unique",
  "if ($action -eq 'protect-directory') {",
  "  if (-not $item.PSIsContainer) { throw 'ACL target is not a directory' }",
  "  $secureAcl = New-Object Security.AccessControl.DirectorySecurity",
  "  $secureAcl.SetOwner((New-Object Security.Principal.SecurityIdentifier($currentSid)))",
  "  $secureAcl.SetAccessRuleProtection($true, $false)",
  "  $inheritance = [Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit",
  "  foreach ($sidValue in $allowedSids) {",
  "    $sid = New-Object Security.Principal.SecurityIdentifier($sidValue)",
  "    $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inheritance, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow)",
  "    [void]$secureAcl.AddAccessRule($rule)",
  "  }",
  "  [IO.Directory]::SetAccessControl($target, $secureAcl)",
  "} elseif ($action -eq 'verify-file') {",
  "  if ($item.PSIsContainer) { throw 'ACL target is not a file' }",
  "} else { throw 'invalid ACL action' }",
  "$acl = Get-Acl -LiteralPath $target",
  "$ownerSid = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value",
  "$rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))",
  "$unexpected = 0",
  "$denied = 0",
  "$currentRights = [Security.AccessControl.FileSystemRights]0",
  "foreach ($rule in $rules) {",
  "  $sidValue = $rule.IdentityReference.Value",
  "  if ($allowedSids -notcontains $sidValue) { $unexpected += 1 }",
  "  if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { $denied += 1 }",
  "  if ($sidValue -eq $currentSid -and $rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) {",
  "    $currentRights = [Security.AccessControl.FileSystemRights]([int64]$currentRights -bor [int64]$rule.FileSystemRights)",
  "  }",
  "}",
  "$fullControl = (([int64]$currentRights -band [int64][Security.AccessControl.FileSystemRights]::FullControl) -eq [int64][Security.AccessControl.FileSystemRights]::FullControl)",
  "[ordered]@{",
  `  format = '${WINDOWS_PRIVATE_ACL_FORMAT}'`,
  "  action = $action",
  "  path_kind = $(if ($item.PSIsContainer) { 'directory' } else { 'file' })",
  "  current_user_sid = $currentSid",
  "  owner_sid = $ownerSid",
  "  allowed_sids = @($allowedSids | Sort-Object)",
  "  access_rule_count = $rules.Count",
  "  access_rules_protected = [bool]$acl.AreAccessRulesProtected",
  "  unexpected_access_rule_count = $unexpected",
  "  deny_rule_count = $denied",
  "  current_user_full_control = [bool]$fullControl",
  "} | ConvertTo-Json -Compress -Depth 4",
].join('\n');

class SnapshotCaptureError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SnapshotCaptureError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SnapshotCaptureError(code, message);
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
    return Object.keys(value).sort().reduce((output, key) => {
      output[key] = stableValue(value[key]);
      return output;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function defaultWindowsPrivateAclAdapter({
  spawn = spawnSync,
  environment = process.env,
} = {}) {
  const systemRoot = clean(environment && (environment.SystemRoot || environment.SYSTEMROOT));
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
  }
  const executable = path.win32.join(
    systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  const encoded = Buffer.from(WINDOWS_PRIVATE_ACL_SCRIPT, 'utf16le').toString('base64');
  return {
    run(action, target) {
      const childEnv = {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        F27_PRIVATE_ACL_ACTION: action,
        F27_PRIVATE_ACL_TARGET: target,
      };
      const result = spawn(executable, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', encoded,
      ], {
        env: childEnv,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      });
      if (!result || result.error || result.signal || result.status !== 0) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
      }
      const output = clean(result.stdout);
      if (!output || output.includes('\n') || clean(result.stderr)) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL proof was malformed.');
      }
      try { return JSON.parse(output); }
      catch (_) {
        fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL proof was malformed.');
      }
    },
  };
}

function assertWindowsPrivateAcl(target, action, options = {}) {
  const platform = clean(options.aclPlatform || options.platform || process.platform).toLowerCase();
  if (platform !== 'win32') return { status: 'SKIPPED', platform };
  if (!WINDOWS_PRIVATE_ACL_ACTIONS.has(action)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL action was invalid.');
  }
  const adapter = options.privateAclAdapter || defaultWindowsPrivateAclAdapter();
  if (!adapter || typeof adapter.run !== 'function') {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL verifier was unavailable.');
  }
  let proof;
  try { proof = adapter.run(action, path.resolve(target)); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private-path ACL boundary could not be established.');
  }
  const currentSid = clean(proof && proof.current_user_sid);
  const expectedAllowed = [...new Set([
    currentSid, WINDOWS_SYSTEM_SID, WINDOWS_ADMINISTRATORS_SID,
  ])].sort();
  const observedAllowed = Array.isArray(proof && proof.allowed_sids)
    ? proof.allowed_sids.map(clean).sort() : [];
  const expectedKind = action === 'protect-directory' ? 'directory' : 'file';
  if (!proof || proof.format !== WINDOWS_PRIVATE_ACL_FORMAT || proof.action !== action
      || proof.path_kind !== expectedKind || !/^S-\d+(?:-\d+)+$/.test(currentSid)
      || proof.owner_sid !== currentSid
      || JSON.stringify(observedAllowed) !== JSON.stringify(expectedAllowed)
      || !Number.isSafeInteger(Number(proof.access_rule_count))
      || Number(proof.access_rule_count) < 1
      || Number(proof.unexpected_access_rule_count) !== 0
      || Number(proof.deny_rule_count) !== 0
      || proof.current_user_full_control !== true
      || (action === 'protect-directory' && proof.access_rules_protected !== true)) {
    fail('WINDOWS_PRIVATE_ACL_REQUIRED', 'The Windows private path permits a broad principal or lacks owner full control.');
  }
  return proof;
}

function protectWindowsPrivateDirectory(target, options = {}) {
  return assertWindowsPrivateAcl(target, 'protect-directory', options);
}

function assertWindowsPrivateFileAcl(target, options = {}) {
  return assertWindowsPrivateAcl(target, 'verify-file', options);
}

function normalized(value) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`));
}

function lstatOrNull(value) {
  try {
    return fs.lstatSync(value);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be inspected safely.');
  }
}

function assertNoSymlinkComponents(absolutePath) {
  const parsed = path.parse(absolutePath);
  const tail = absolutePath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let cursor = parsed.root;
  for (const segment of tail) {
    cursor = path.join(cursor, segment);
    const stat = lstatOrNull(cursor);
    if (!stat) break;
    if (stat.isSymbolicLink()) {
      fail('SYMLINK_REJECTED', 'The private output directory must not contain a symbolic link or junction.');
    }
    let real;
    try {
      real = fs.realpathSync.native(cursor);
    } catch (_) {
      fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be resolved safely.');
    }
    if (normalized(real) !== normalized(cursor)) {
      fail('SYMLINK_REJECTED', 'The private output directory must not contain a symbolic link or junction.');
    }
  }
}

function discoverRegisteredWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('WORKTREE_DISCOVERY_FAILED', 'Git worktrees could not be enumerated; refusing private output.');
  }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED', 'Git returned no worktrees; refusing private output.');
  return roots;
}

function containingGitWorktree(value) {
  let cursor = path.resolve(value);
  let stat = lstatOrNull(cursor);
  while (!stat) {
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
    stat = lstatOrNull(cursor);
  }
  if (stat && !stat.isDirectory()) cursor = path.dirname(cursor);
  try {
    return clean(execFileSync('git', ['-C', cursor, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    })) || null;
  } catch (_) {
    return null;
  }
}

function assertPrivateEmptyOutput(outputDir, worktreeRoots) {
  if (!outputDir || !path.isAbsolute(outputDir)) {
    fail('ABSOLUTE_OUTPUT_REQUIRED', 'Output must be an explicit absolute private directory.');
  }
  const resolved = path.resolve(outputDir);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) {
      fail('WORKTREE_PATH_REJECTED', 'The private output directory must be outside every registered Git worktree.');
    }
  }
  const containing = containingGitWorktree(resolved);
  if (containing && isWithin(containing, resolved)) {
    fail('WORKTREE_PATH_REJECTED', 'The private output directory must be outside every Git worktree.');
  }
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail('OUTPUT_DIRECTORY_REQUIRED', 'Output must already exist as a regular private directory.');
  }
  let entries;
  try {
    entries = fs.readdirSync(resolved);
  } catch (_) {
    fail('OUTPUT_INSPECTION_FAILED', 'The private output directory could not be enumerated safely.');
  }
  if (entries.length) fail('DIRTY_OUTPUT_REJECTED', 'The private output directory must be empty.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private output directory must not grant group or other access.');
  }
  return resolved;
}

function parseDatabaseUrl(input, projectRef, databaseName) {
  if (!PROJECT_REF_RE.test(projectRef)) {
    fail('PROJECT_CONFIRMATION_INVALID', 'Project confirmation must be one exact 20-character lowercase project ref.');
  }
  if (!SAFE_DATABASE_RE.test(databaseName)) {
    fail('DATABASE_CONFIRMATION_INVALID', 'Database confirmation is missing or malformed.');
  }
  let parsed;
  try {
    parsed = new URL(input);
  } catch (_) {
    fail('DATABASE_URL_INVALID', 'F27_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    fail('DATABASE_URL_INVALID', 'F27_DATABASE_URL must use the PostgreSQL protocol.');
  }
  const urlDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (urlDatabase !== databaseName) {
    fail('DATABASE_CONFIRMATION_MISMATCH', 'The confirmed database does not match the database URL.');
  }
  const username = decodeURIComponent(parsed.username);
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';
  const directConnection = hostname === `db.${projectRef}.supabase.co`
    && username === 'postgres' && port === '5432';
  const pooledConnection = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
    && username === `postgres.${projectRef}` && ['5432', '6543'].includes(port);
  if (!directConnection && !pooledConnection) {
    fail('PROJECT_CONFIRMATION_MISMATCH', 'The confirmed project ref is not exactly bound by the database URL.');
  }
  if (!parsed.hostname || !username) fail('DATABASE_URL_INVALID', 'The database URL is incomplete.');
  const allowedParameters = new Set(['sslmode']);
  for (const key of parsed.searchParams.keys()) {
    if (!allowedParameters.has(key)) {
      fail('DATABASE_URL_INVALID', 'The database URL contains an unsupported connection option.');
    }
  }
  const sslmode = parsed.searchParams.get('sslmode') || 'require';
  if (!['require', 'verify-full'].includes(sslmode)) {
    fail('DATABASE_URL_INVALID', 'The live database URL must require TLS.');
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: port,
    PGDATABASE: urlDatabase,
    PGUSER: username,
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: sslmode,
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'f27-mirror-outbox-snapshot',
    PGOPTIONS: '',
  };
}

function parseDisposableDatabaseUrl(input, databaseName) {
  if (!SAFE_DATABASE_RE.test(databaseName) || !/^f27[_$-]/.test(databaseName)) {
    fail('DISPOSABLE_DATABASE_CONFIRMATION_INVALID', 'Disposable database confirmation must be an explicit f27-prefixed database.');
  }
  let parsed;
  try { parsed = new URL(input); } catch (_) { fail('DATABASE_URL_INVALID', 'F27_DISPOSABLE_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || !['localhost', '127.0.0.1', '::1'].includes(parsed.hostname.toLowerCase())) {
    fail('DISPOSABLE_DATABASE_REJECTED', 'Post-contract fingerprinting is restricted to an explicit loopback disposable database.');
  }
  const urlDatabase = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (urlDatabase !== databaseName || !parsed.username) {
    fail('DATABASE_CONFIRMATION_MISMATCH', 'The disposable database URL did not match the explicit confirmation.');
  }
  return {
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || '5432',
    PGDATABASE: urlDatabase,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: parsed.searchParams.get('sslmode') || 'disable',
    PGCLIENTENCODING: 'UTF8',
    PGCONNECT_TIMEOUT: '15',
    PGAPPNAME: 'f27-mirror-outbox-post-contract',
    PGOPTIONS: '',
  };
}

function assertRelease(options) {
  const requested = clean(options.releaseSha);
  if (!SHA_RE.test(requested)) fail('RELEASE_SHA_INVALID', 'Release SHA must be exactly 40 lowercase hexadecimal characters.');
  if (options.releaseInfo) {
    if (options.releaseInfo.headSha !== requested) fail('RELEASE_SHA_MISMATCH', 'Release SHA does not match the checked-out HEAD.');
    if (options.releaseInfo.originMainSha != null && options.releaseInfo.originMainSha !== requested) {
      fail('RELEASE_SHA_MISMATCH', 'Release SHA does not match the independently fetched origin/main.');
    }
    if (options.releaseInfo.dirty) fail('DIRTY_SOURCE_REJECTED', 'The source worktree must be clean.');
    if (!HASH_RE.test(options.releaseInfo.migrationSha256)) fail('MIGRATION_HASH_INVALID', 'Migration SHA-256 could not be proven.');
    return options.releaseInfo;
  }
  const repoRoot = options.repoRoot || REPO_ROOT;
  let headSha;
  let originMainSha;
  let status;
  try {
    headSha = clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }));
    originMainSha = clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'origin/main'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    }));
    status = execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('RELEASE_PROOF_FAILED', 'The checked-out release could not be proven.');
  }
  if (headSha !== requested || originMainSha !== requested) {
    fail('RELEASE_SHA_MISMATCH', 'Release SHA must match both checked-out HEAD and independently fetched origin/main.');
  }
  if (clean(status)) fail('DIRTY_SOURCE_REJECTED', 'The source worktree must be clean.');
  let migrationBytes;
  try {
    migrationBytes = fs.readFileSync(path.join(repoRoot, MIGRATION_RELATIVE_PATH));
  } catch (_) {
    fail('MIGRATION_READ_FAILED', 'The exact F27 migration bytes could not be read.');
  }
  return { headSha, originMainSha, dirty: false, migrationSha256: sha256(migrationBytes) };
}

function sqlText() {
  const f27TableNames = quotedSqlStrings(F27_TABLE_NAMES);
  const f27ColumnNames = quotedSqlStrings(F27_OUTBOX_COLUMN_NAMES);
  const f27ConstraintNames = quotedSqlStrings(F27_CONSTRAINT_NAMES);
  const f27FunctionNames = quotedSqlStrings(F27_FUNCTION_NAMES);
  const allowedBoundaryFunctionPredicate = REQUIRED_BOUNDARY_FUNCTION_IDENTITIES
    .map(identity => `p.oid IS DISTINCT FROM to_regprocedure('${identity.replace(/'/g, "''")}')::oid`)
    .join('\n      AND ');
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $f27$
DECLARE
  v_pk text[];
BEGIN
  IF to_regclass('public.mirror_outbox') IS NULL THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_MISSING_MIRROR_OUTBOX';
  END IF;
  IF to_regclass('public.syncview_runtime_flags') IS NULL
     OR to_regclass('public.flag_flips') IS NULL THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_MISSING_RUNTIME_SAFETY_TABLE';
  END IF;
  IF to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)') IS NULL
     OR to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)') IS NULL
     OR EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname IN (${f27TableNames})
     )
     OR EXISTS (
       SELECT 1 FROM pg_attribute a
       WHERE a.attrelid='public.mirror_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
         AND a.attname IN (${f27ColumnNames})
     )
     OR EXISTS (
       SELECT 1 FROM pg_constraint c
       WHERE c.conrelid='public.mirror_outbox'::regclass AND c.conname IN (${f27ConstraintNames})
     )
     OR EXISTS (
       SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='public' AND c.relname='${F27_OUTBOX_INDEX_NAME}'
     )
     OR EXISTS (
       SELECT 1 FROM pg_trigger t
       WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
         AND t.tgname='${F27_OUTBOX_TRIGGER_NAME}'
     )
     OR EXISTS (
       SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN (${f27FunctionNames})
         AND ${allowedBoundaryFunctionPredicate}
     ) THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED';
  END IF;
  SELECT array_agg(a.attname ORDER BY k.ordinality)
    INTO v_pk
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ordinality)
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  WHERE c.conrelid = 'public.mirror_outbox'::regclass AND c.contype = 'p';
  IF v_pk IS DISTINCT FROM ARRAY['id']::text[] THEN
    RAISE EXCEPTION 'F27_SNAPSHOT_PRIMARY_KEY_NOT_ID';
  END IF;
END
$f27$;

SELECT jsonb_build_object(
  'section','metadata','ordinal',1,'key','metadata',
  'value',jsonb_build_object(
    'current_database',current_database(),
    'current_user',current_user,
    'server_version',version(),
    'server_version_num',current_setting('server_version_num'),
    'transaction_isolation',current_setting('transaction_isolation'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'snapshot_time',transaction_timestamp(),
    'table_regclass','public.mirror_outbox',
    'primary_key_columns',ARRAY['id']::text[]
  )::text
)::text;

SELECT jsonb_build_object(
  'section','runtime_safety','ordinal',1,'key','runtime_safety',
  'value',jsonb_build_object(
    'flags',COALESCE((
      SELECT jsonb_object_agg(key,value ORDER BY key)
      FROM public.syncview_runtime_flags
      WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
    ),'{}'::jsonb),
    'flag_flips_count',(SELECT count(*) FROM public.flag_flips)
  )::text
)::text;

SELECT jsonb_build_object(
  'section','pre_f27_baseline','ordinal',1,'key','pre_f27_baseline',
  'value',jsonb_build_object(
    'f27_table_count',(
      SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN (${f27TableNames})
    ),
    'f27_outbox_column_count',(
      SELECT count(*) FROM pg_attribute a
      WHERE a.attrelid='public.mirror_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
        AND a.attname IN (${f27ColumnNames})
    ),
    'f27_outbox_constraint_count',(
      SELECT count(*) FROM pg_constraint c
      WHERE c.conrelid='public.mirror_outbox'::regclass AND c.conname IN (${f27ConstraintNames})
    ),
    'f27_outbox_index_count',(
      SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='${F27_OUTBOX_INDEX_NAME}'
    ),
    'f27_outbox_trigger_count',(
      SELECT count(*) FROM pg_trigger t
      WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
        AND t.tgname='${F27_OUTBOX_TRIGGER_NAME}'
    ),
    'allowed_boundary_function_count',(
      SELECT count(*) FROM (VALUES
        (to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)')),
        (to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)'))
      ) boundary(function_identity) WHERE function_identity IS NOT NULL
    ),
    'unexpected_f27_function_count',(
      SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN (${f27FunctionNames})
        AND ${allowedBoundaryFunctionPredicate}
    )
  )::text
)::text;

SELECT jsonb_build_object(
  'section','table','ordinal',1,'key','public.mirror_outbox',
  'value',jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'kind',c.relkind,'persistence',c.relpersistence,
    'owner',pg_get_userbyid(c.relowner),'acl',c.relacl,
    'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
    'replica_identity',c.relreplident,'tablespace',COALESCE(t.spcname,'pg_default'),
    'reloptions',c.reloptions
  )::text
)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
LEFT JOIN pg_tablespace t ON t.oid=c.reltablespace
WHERE c.oid='public.mirror_outbox'::regclass;

SELECT jsonb_build_object(
  'section','columns','ordinal',row_number() OVER (ORDER BY a.attnum),'key',a.attname,
  'value',jsonb_build_object(
    'ordinal',a.attnum,'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid,true),
    'identity',a.attidentity,'generated',a.attgenerated,'acl',a.attacl,
    'collation',CASE WHEN a.attcollation=0 THEN NULL ELSE quote_ident(cn.nspname)||'.'||quote_ident(co.collname) END,
    'storage',a.attstorage,'compression',a.attcompression
  )::text
)::text
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
LEFT JOIN pg_collation co ON co.oid=a.attcollation
LEFT JOIN pg_namespace cn ON cn.oid=co.collnamespace
WHERE a.attrelid='public.mirror_outbox'::regclass AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT jsonb_build_object(
  'section','constraints','ordinal',row_number() OVER (ORDER BY c.conname,c.oid),'key',c.conname,
  'value',jsonb_build_object(
    'name',c.conname,'type',c.contype,'validated',c.convalidated,'deferrable',c.condeferrable,
    'initially_deferred',c.condeferred,'no_inherit',c.connoinherit,
    'definition',pg_get_constraintdef(c.oid,true)
  )::text
)::text
FROM pg_constraint c
WHERE c.conrelid='public.mirror_outbox'::regclass
ORDER BY c.conname,c.oid;

SELECT jsonb_build_object(
  'section','triggers','ordinal',row_number() OVER (ORDER BY t.tgname,t.oid),'key',t.tgname,
  'value',jsonb_build_object(
    'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function_identity',p.oid::regprocedure::text
  )::text
)::text
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
ORDER BY t.tgname,t.oid;

WITH selected AS (
  SELECT DISTINCT p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid IN (
    SELECT t.tgfoid FROM pg_trigger t
    WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  ) OR p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')
  ) OR CASE
    WHEN n.nspname='public' AND p.prokind IN ('f','p')
      THEN pg_get_functiondef(p.oid) ILIKE '%mirror_outbox%'
    ELSE false
  END
), inventory AS (
  SELECT p.*,n.nspname,l.lanname,pg_get_userbyid(p.proowner) AS owner_name
  FROM selected s JOIN pg_proc p ON p.oid=s.oid
  JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
)
SELECT jsonb_build_object(
  'section','functions',
  'ordinal',row_number() OVER (ORDER BY nspname,proname,pg_get_function_identity_arguments(oid)),
  'key',quote_ident(nspname)||'.'||quote_ident(proname)||'('||pg_get_function_identity_arguments(oid)||')',
  'value',jsonb_build_object(
    'schema',nspname,'name',proname,'identity_arguments',pg_get_function_identity_arguments(oid),
    'regprocedure_identity',oid::regprocedure::text,
    'result',pg_get_function_result(oid),'language',lanname,'kind',prokind,
    'security_definer',prosecdef,'leakproof',proleakproof,'volatility',provolatile,
    'parallel',proparallel,'strict',proisstrict,'owner',owner_name,'acl',proacl,
    'config',proconfig,'definition',pg_get_functiondef(oid)
  )::text
)::text
FROM inventory
ORDER BY nspname,proname,pg_get_function_identity_arguments(oid);

SELECT jsonb_build_object(
  'section','indexes','ordinal',row_number() OVER (ORDER BY ni.nspname,ci.relname),'key',ni.nspname||'.'||ci.relname,
  'value',jsonb_build_object(
    'schema',ni.nspname,'name',ci.relname,'owner',pg_get_userbyid(ci.relowner),
    'unique',i.indisunique,'primary',i.indisprimary,'exclusion',i.indisexclusion,
    'immediate',i.indimmediate,'clustered',i.indisclustered,'valid',i.indisvalid,
    'ready',i.indisready,'live',i.indislive,'replica_identity',i.indisreplident,
    'definition',pg_get_indexdef(i.indexrelid,0,true),'tablespace',COALESCE(ts.spcname,'pg_default'),
    'reloptions',ci.reloptions
  )::text
)::text
FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
JOIN pg_namespace ni ON ni.oid=ci.relnamespace
LEFT JOIN pg_tablespace ts ON ts.oid=ci.reltablespace
WHERE i.indrelid='public.mirror_outbox'::regclass
ORDER BY ni.nspname,ci.relname;

SELECT jsonb_build_object(
  'section','policies',
  'ordinal',row_number() OVER (ORDER BY policyname),'key',policyname,
  'value',jsonb_build_object(
    'schema',schemaname,'table',tablename,'name',policyname,'permissive',permissive,
    'roles',roles,'command',cmd,'using',qual,'with_check',with_check
  )::text
)::text
FROM pg_policies WHERE schemaname='public' AND tablename='mirror_outbox'
ORDER BY policyname;

WITH rel AS (
  SELECT c.*,COALESCE(c.relacl,acldefault('r',c.relowner)) AS effective_acl
  FROM pg_class c WHERE c.oid='public.mirror_outbox'::regclass
), grants AS (
  SELECT CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
    pg_get_userbyid(x.grantor) AS grantor,x.privilege_type,x.is_grantable
  FROM rel CROSS JOIN LATERAL aclexplode(rel.effective_acl) x
)
SELECT jsonb_build_object(
  'section','grants',
  'ordinal',row_number() OVER (ORDER BY grantee,grantor,privilege_type,is_grantable),
  'key',grantee||'/'||grantor||'/'||privilege_type||'/'||is_grantable::text,
  'value',jsonb_build_object('grantee',grantee,'grantor',grantor,'privilege',privilege_type,'grantable',is_grantable)::text
)::text
FROM grants ORDER BY grantee,grantor,privilege_type,is_grantable;

SELECT jsonb_build_object(
  'section','rows','ordinal',row_number() OVER (ORDER BY o.id),'key',o.id::text,
  'value',to_jsonb(o)::text
)::text
FROM public.mirror_outbox o ORDER BY o.id;

SELECT jsonb_build_object(
  'section','aggregates',
  'ordinal',row_number() OVER (ORDER BY safe_team,safe_status),'key',safe_team||'/'||safe_status,
  'value',jsonb_build_object('team',safe_team,'status',safe_status,'count',row_count)::text
)::text
FROM (
  SELECT CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END AS safe_team,
    CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END AS safe_status,
    count(*) AS row_count
  FROM public.mirror_outbox GROUP BY 1,2
) grouped ORDER BY safe_team,safe_status;

SELECT jsonb_build_object(
  'section','newest','ordinal',rank,'key',rank::text,
  'value',jsonb_build_object(
    'rank',rank,
    'team',CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END,
    'status',CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END,
    'time',created_at,
    'private_row',row_text
  )::text
)::text
FROM (
  SELECT row_number() OVER (ORDER BY created_at DESC,id DESC) AS rank,team,status,created_at,to_jsonb(o)::text AS row_text
  FROM public.mirror_outbox o
) newest WHERE rank<=${NEWEST_LIMIT} ORDER BY rank;

WITH function_inventory AS (
  SELECT DISTINCT p.oid
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.oid IN (
    SELECT t.tgfoid FROM pg_trigger t
    WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  ) OR p.oid IN (
    to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)'),
    to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')
  ) OR CASE
    WHEN n.nspname='public' AND p.prokind IN ('f','p')
      THEN pg_get_functiondef(p.oid) ILIKE '%mirror_outbox%'
    ELSE false
  END
)
SELECT jsonb_build_object(
  'section','inventory','ordinal',1,'key','inventory',
  'value',jsonb_build_object(
    'metadata',1,
    'runtime_safety',1,
    'pre_f27_baseline',1,
    'table',(SELECT count(*) FROM pg_class WHERE oid='public.mirror_outbox'::regclass),
    'columns',(SELECT count(*) FROM pg_attribute WHERE attrelid='public.mirror_outbox'::regclass AND attnum>0 AND NOT attisdropped),
    'constraints',(SELECT count(*) FROM pg_constraint WHERE conrelid='public.mirror_outbox'::regclass),
    'triggers',(SELECT count(*) FROM pg_trigger WHERE tgrelid='public.mirror_outbox'::regclass AND NOT tgisinternal),
    'functions',(SELECT count(*) FROM function_inventory),
    'indexes',(SELECT count(*) FROM pg_index WHERE indrelid='public.mirror_outbox'::regclass),
    'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='mirror_outbox'),
    'grants',(SELECT count(*) FROM (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x WHERE c.oid='public.mirror_outbox'::regclass) q),
    'rows',(SELECT count(*) FROM public.mirror_outbox),
    'aggregates',(SELECT count(*) FROM (SELECT 1 FROM public.mirror_outbox GROUP BY CASE WHEN team IN ('video','graphics') THEN team ELSE 'other' END,CASE WHEN status IN ('pending','shadow_ok','written','failed','skipped','stale') THEN status ELSE 'other' END) q),
    'newest',LEAST(${NEWEST_LIMIT},(SELECT count(*) FROM public.mirror_outbox))
  )::text
)::text;

COMMIT;
`;
}

function quotedIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) {
    fail('PROJECTION_INVALID', 'The captured pre-install projection contained an unsafe identifier.');
  }
  return `"${value}"`;
}

function quotedSqlStrings(values) {
  return values.map(value => `'${value.replace(/'/g, "''")}'`).join(',');
}

function regprocedureExpressions(values) {
  return values.map(value => `to_regprocedure('${value.replace(/'/g, "''")}')`).join(',');
}

function verifyAfterSql(projection, includeRows = true) {
  if (!Array.isArray(projection) || !projection.length || new Set(projection).size !== projection.length
      || projection[0] !== 'id') {
    fail('PROJECTION_INVALID', 'The captured pre-install projection was missing, duplicated, or not primary-key-led.');
  }
  const projected = projection.map(name => `o.${quotedIdentifier(name)}`).join(',');
  const rowsQuery = includeRows ? String.raw`
SELECT jsonb_build_object(
  'section','post_rows','ordinal',row_number() OVER (ORDER BY projected.id),'key',projected.id::text,
  'value',to_jsonb(projected)::text
)::text
FROM (SELECT ${projected} FROM public.mirror_outbox o ORDER BY o.id) projected
ORDER BY projected.id;
` : '';
  const functionNames = quotedSqlStrings(F27_FUNCTION_NAMES);
  const constraintNames = quotedSqlStrings(F27_CONSTRAINT_NAMES);
  const tableNames = quotedSqlStrings(F27_TABLE_NAMES);
  const executeFunctionOids = regprocedureExpressions(F27_EXECUTE_FUNCTION_IDENTITIES);
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;

DO $f27$
BEGIN
  IF to_regclass('public.mirror_outbox') IS NULL
     OR to_regclass('public.track_b_f27_team_fences') IS NULL
     OR to_regclass('public.track_b_team_rollbacks') IS NULL
     OR to_regclass('public.track_b_team_rollback_intents') IS NULL
     OR to_regclass('public.syncview_runtime_flags') IS NULL
     OR to_regclass('public.flag_flips') IS NULL THEN
    RAISE EXCEPTION 'F27_VERIFY_REQUIRED_OBJECT_MISSING';
  END IF;
END
$f27$;

SELECT jsonb_build_object(
  'section','post_metadata','ordinal',1,'key','metadata',
  'value',jsonb_build_object(
    'current_database',current_database(),'server_version',version(),
    'transaction_isolation',current_setting('transaction_isolation'),
    'transaction_read_only',current_setting('transaction_read_only'),
    'verified_at',transaction_timestamp()
  )::text
)::text;

SELECT jsonb_build_object(
  'section','post_runtime_safety','ordinal',1,'key','runtime_safety',
  'value',jsonb_build_object(
    'flags',COALESCE((
      SELECT jsonb_object_agg(key,value ORDER BY key)
      FROM public.syncview_runtime_flags
      WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
    ),'{}'::jsonb),
    'flag_flips_count',(SELECT count(*) FROM public.flag_flips)
  )::text
)::text;
${rowsQuery}
SELECT jsonb_build_object(
  'section','f27_columns','ordinal',row_number() OVER (ORDER BY a.attnum),'key',a.attname,
  'value',jsonb_build_object(
    'name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid,true),
    'identity',a.attidentity,'generated',a.attgenerated
  )::text
)::text
FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='public.mirror_outbox'::regclass
  AND a.attname IN ('authority_generation','f27_drill_rollback_id')
  AND a.attnum>0 AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT jsonb_build_object(
  'section','f27_constraints','ordinal',row_number() OVER (ORDER BY c.conname),'key',c.conname,
  'value',jsonb_build_object(
    'name',c.conname,'type',c.contype,'validated',c.convalidated,
    'deferrable',c.condeferrable,'initially_deferred',c.condeferred,
    'definition',pg_get_constraintdef(c.oid,true)
  )::text
)::text
FROM pg_constraint c
WHERE c.conrelid='public.mirror_outbox'::regclass AND c.conname IN (${constraintNames})
ORDER BY c.conname;

SELECT jsonb_build_object(
  'section','f27_triggers','ordinal',row_number() OVER (ORDER BY t.tgname),'key',t.tgname,
  'value',jsonb_build_object(
    'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),
    'function_identity',p.oid::regprocedure::text
  )::text
)::text
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid='public.mirror_outbox'::regclass AND NOT t.tgisinternal
  AND t.tgname='track_b_f27_hold_guard'
ORDER BY t.tgname;

SELECT jsonb_build_object(
  'section','f27_functions',
  'ordinal',row_number() OVER (ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)),
  'key',quote_ident(n.nspname)||'.'||quote_ident(p.proname)||'('||pg_get_function_identity_arguments(p.oid)||')',
  'value',jsonb_build_object(
    'schema',n.nspname,'name',p.proname,'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'regprocedure_identity',p.oid::regprocedure::text,
    'result',pg_get_function_result(p.oid),'language',l.lanname,'kind',p.prokind,
    'security_definer',p.prosecdef,'leakproof',p.proleakproof,'volatility',p.provolatile,
    'parallel',p.proparallel,'strict',p.proisstrict,'owner',pg_get_userbyid(p.proowner),
    'acl',p.proacl,'config',p.proconfig,'definition',pg_get_functiondef(p.oid)
  )::text
)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE n.nspname='public' AND p.proname IN (${functionNames})
ORDER BY p.proname,pg_get_function_identity_arguments(p.oid);

SELECT jsonb_build_object(
  'section','f27_indexes','ordinal',1,'key',ci.relname,
  'value',jsonb_build_object(
    'name',ci.relname,'unique',i.indisunique,'primary',i.indisprimary,
    'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,
    'definition',pg_get_indexdef(i.indexrelid,0,true)
  )::text
)::text
FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid
WHERE i.indrelid='public.mirror_outbox'::regclass
  AND ci.relname='mirror_outbox_one_f27_drill_row_idx';

SELECT jsonb_build_object(
  'section','f27_table_boundaries',
  'ordinal',row_number() OVER (ORDER BY c.relname),
  'key',quote_ident(n.nspname)||'.'||quote_ident(c.relname),
  'value',jsonb_build_object(
    'schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'owner',pg_get_userbyid(c.relowner),
    'row_security',c.relrowsecurity,'force_row_security',c.relforcerowsecurity,
    'acl_is_null',c.relacl IS NULL,
    'raw_acl',COALESCE((
      SELECT jsonb_agg(raw_acl.acl_entry::text ORDER BY raw_acl.acl_entry::text)
      FROM unnest(c.relacl) AS raw_acl(acl_entry)
    ),'[]'::jsonb),
    'effective_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) a
    ),'[]'::jsonb)
  )::text
)::text
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p') AND c.relname IN (${tableNames})
ORDER BY c.relname;

SELECT jsonb_build_object(
  'section','f27_function_execute_grants',
  'ordinal',row_number() OVER (ORDER BY p.oid::regprocedure::text),
  'key',p.oid::regprocedure::text,
  'value',jsonb_build_object(
    'schema',n.nspname,'name',p.proname,
    'identity_arguments',pg_get_function_identity_arguments(p.oid),
    'regprocedure_identity',p.oid::regprocedure::text,
    'owner',pg_get_userbyid(p.proowner),
    'acl_is_null',p.proacl IS NULL,
    'raw_acl',COALESCE((
      SELECT jsonb_agg(raw_acl.acl_entry::text ORDER BY raw_acl.acl_entry::text)
      FROM unnest(p.proacl) AS raw_acl(acl_entry)
    ),'[]'::jsonb),
    'effective_execute_grants',COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          'grantor',pg_get_userbyid(a.grantor),
          'privilege',a.privilege_type,
          'grantable',a.is_grantable
        ) ORDER BY
          CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,
          pg_get_userbyid(a.grantor),a.privilege_type,a.is_grantable
      )
      FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
      WHERE a.privilege_type='EXECUTE'
    ),'[]'::jsonb)
  )::text
)::text
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.oid IN (${executeFunctionOids})
ORDER BY p.oid::regprocedure::text;

SELECT jsonb_build_object(
  'section','f27_state','ordinal',1,'key','state',
  'value',jsonb_build_object(
    'fences',COALESCE((SELECT jsonb_object_agg(team,generation ORDER BY team) FROM public.track_b_f27_team_fences),'{}'::jsonb),
    'fence_count',(SELECT count(*) FROM public.track_b_f27_team_fences),
    'rollback_count',(SELECT count(*) FROM public.track_b_team_rollbacks),
    'intent_count',(SELECT count(*) FROM public.track_b_team_rollback_intents),
    'residual_probe_count',(
      SELECT count(*) FROM public.mirror_outbox
      WHERE entity_id='f27-migration-test' OR client_slug='f27-migration-test'
        OR dedup_key LIKE 'f27-migration-test:%'
    )
  )::text
)::text;

COMMIT;
`;
}

function psqlCaptureFailure(stderr) {
  if (String(stderr == null ? '' : stderr).includes('F27_SNAPSHOT_PRE_F27_BASELINE_REQUIRED')) {
    return new SnapshotCaptureError(
      'PRE_F27_BASELINE_REQUIRED',
      'Capture requires a true pre-F27 baseline; partial F27 schema or function state was found.',
    );
  }
  return new SnapshotCaptureError('PSQL_CAPTURE_FAILED', 'The read-only psql snapshot transaction failed closed.');
}

function safePsqlEnvironment(connectionEnv = {}, baseEnv = process.env) {
  const names = new Set([
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec',
    'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  ]);
  const environment = {};
  for (const [name, value] of Object.entries(baseEnv || {})) {
    if (names.has(name)) environment[name] = value;
  }
  return { ...environment, ...connectionEnv };
}

function defaultPsqlAdapter(psqlPath) {
  return {
    version() {
      let output;
      try {
        output = execFileSync(psqlPath, ['--version'], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
          env: safePsqlEnvironment(),
        });
      } catch (_) {
        fail('PSQL_VERSION_FAILED', 'The pinned psql client version could not be read.');
      }
      const value = clean(output);
      if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(value)) {
        fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
      }
      return value;
    },
    capture(sql, connectionEnv) {
      const childEnv = safePsqlEnvironment(connectionEnv);
      const result = spawnSync(psqlPath, ['-X', '--quiet', '--no-align', '--tuples-only', '--set', 'ON_ERROR_STOP=1', '--file', '-'], {
        input: sql,
        encoding: 'utf8',
        windowsHide: true,
        env: childEnv,
        maxBuffer: 1024 * 1024 * 1024,
      });
      if (result.error || result.status !== 0 || result.signal || clean(result.stderr)) {
        throw psqlCaptureFailure(result.stderr);
      }
      return result.stdout;
    },
  };
}

function parseRecord(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch (_) {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript was not complete canonical JSONL.');
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)
      || !clean(record.section) || !Number.isInteger(Number(record.ordinal))
      || Number(record.ordinal) < 1 || !clean(record.key) || typeof record.value !== 'string') {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript contained a malformed inventory record.');
  }
  let value;
  try {
    value = JSON.parse(record.value);
  } catch (_) {
    fail('TRANSCRIPT_MALFORMED', 'The psql snapshot transcript contained malformed private JSON.');
  }
  return { section: record.section, ordinal: Number(record.ordinal), key: String(record.key), raw: record.value, value };
}

function validateRuntimeSafety(value, code) {
  const count = Number(value && value.flag_flips_count);
  const flags = value && value.flags;
  if (!Number.isSafeInteger(count) || count < 0
      || JSON.stringify(stableValue(flags)) !== JSON.stringify(stableValue(EXPECTED_RUNTIME_FLAGS))) {
    fail(code, 'Authority, outbound, parity, or flag-flip safety state was missing or outside the required dormant posture.');
  }
  return { flags: stableValue(flags), flagFlipsCount: count };
}

function parseTranscript(stdout, confirmedDatabase) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(line => line.length);
  if (!lines.length) fail('TRANSCRIPT_EMPTY', 'The psql snapshot transcript was empty.');
  const sections = new Map();
  let inventory = null;
  for (const line of lines) {
    const record = parseRecord(line);
    if (record.section === 'inventory') {
      if (inventory) fail('INVENTORY_DUPLICATE', 'The psql inventory terminator was duplicated.');
      inventory = record;
      continue;
    }
    if (!REQUIRED_SECTIONS.includes(record.section)) {
      fail('SECTION_UNEXPECTED', 'The psql snapshot transcript contained an unexpected section.');
    }
    if (!sections.has(record.section)) sections.set(record.section, []);
    sections.get(record.section).push(record);
  }
  if (!inventory || !inventory.value || typeof inventory.value !== 'object') {
    fail('INVENTORY_MISSING', 'The psql snapshot inventory terminator was missing.');
  }
  for (const section of REQUIRED_SECTIONS) {
    const records = sections.get(section) || [];
    const expected = Number(inventory.value[section]);
    if (!Number.isSafeInteger(expected) || expected < 0 || records.length !== expected) {
      fail('INVENTORY_INCOMPLETE', 'A psql snapshot section did not match its independent inventory count.');
    }
    const keys = new Set();
    records.forEach((record, index) => {
      if (record.ordinal !== index + 1) fail('INVENTORY_UNSTABLE', 'A psql snapshot section had unstable ordering.');
      if (keys.has(record.key)) fail('INVENTORY_DUPLICATE', 'A psql snapshot section contained a duplicate identity.');
      keys.add(record.key);
    });
  }
  const metadata = (sections.get('metadata') || [])[0];
  const runtimeRecord = (sections.get('runtime_safety') || [])[0];
  const preF27BaselineRecords = sections.get('pre_f27_baseline') || [];
  const preF27BaselineRecord = preF27BaselineRecords[0];
  const table = (sections.get('table') || [])[0];
  if (!metadata || !runtimeRecord || preF27BaselineRecords.length !== 1 || !table
      || metadata.value.current_database !== confirmedDatabase
      || metadata.value.transaction_isolation !== 'repeatable read'
      || metadata.value.transaction_read_only !== 'on'
      || metadata.value.table_regclass !== 'public.mirror_outbox'
      || JSON.stringify(metadata.value.primary_key_columns) !== '["id"]') {
    fail('TRANSACTION_PROOF_FAILED', 'Database identity or repeatable-read/read-only transaction proof failed.');
  }
  const preF27Baseline = stableValue(preF27BaselineRecord.value);
  if (JSON.stringify(preF27Baseline) !== JSON.stringify(stableValue({
    allowed_boundary_function_count: REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.length,
    f27_outbox_column_count: 0,
    f27_outbox_constraint_count: 0,
    f27_outbox_index_count: 0,
    f27_outbox_trigger_count: 0,
    f27_table_count: 0,
    unexpected_f27_function_count: 0,
  }))) {
    fail('PRE_F27_BASELINE_REQUIRED', 'Capture requires a true pre-F27 baseline with only the two pre-existing boundary functions.');
  }
  const columns = sections.get('columns') || [];
  const columnNames = columns.map(record => clean(record.value && record.value.name));
  if (!REQUIRED_COLUMNS.every(name => columnNames.includes(name)) || new Set(columnNames).size !== columnNames.length) {
    fail('COLUMN_INVENTORY_INVALID', 'The mirror_outbox column projection was missing, malformed, or duplicated.');
  }
  if (!(sections.get('constraints') || []).length
      || !(sections.get('indexes') || []).length || !(sections.get('grants') || []).length) {
    fail('BOUNDARY_INVENTORY_EMPTY', 'A required mirror_outbox boundary inventory was empty.');
  }
  const functions = sections.get('functions') || [];
  const functionNames = new Set(functions.map(record => clean(record.value && record.value.name)));
  const functionIdentities = new Set(functions.map(record => clean(record.value && record.value.regprocedure_identity)));
  if (!REQUIRED_FUNCTION_NAMES.every(name => functionNames.has(name))) {
    fail('FUNCTION_CLOSURE_INCOMPLETE', 'The required mirror_outbox function closure was incomplete.');
  }
  if (!REQUIRED_BOUNDARY_FUNCTION_IDENTITIES.every(identity => functionIdentities.has(identity))) {
    fail('FUNCTION_IDENTITY_INCOMPLETE', 'An exact required boundary-function identity was not captured.');
  }
  for (const section of ['constraints', 'triggers', 'functions', 'indexes']) {
    for (const record of sections.get(section) || []) {
      if (!record.value || !clean(record.value.definition)) {
        fail('DEFINITION_MALFORMED', 'A required boundary definition was missing.');
      }
    }
  }
  const rows = sections.get('rows') || [];
  const rowBodies = new Set(rows.map(record => record.raw));
  const newest = sections.get('newest') || [];
  for (const record of newest) {
    if (!record.value || !Number.isInteger(Number(record.value.rank))
        || !SAFE_TEAMS.has(record.value.team) && record.value.team !== 'other'
        || !SAFE_STATUSES.has(record.value.status) && record.value.status !== 'other'
        || !clean(record.value.time) || !rowBodies.has(record.value.private_row)) {
      fail('NEWEST_PROJECTION_INVALID', 'The newest-row proof was malformed or not bound to the private export.');
    }
  }
  const aggregates = sections.get('aggregates') || [];
  let aggregateCount = 0;
  for (const record of aggregates) {
    const count = Number(record.value && record.value.count);
    if (!Number.isSafeInteger(count) || count < 1
        || !SAFE_TEAMS.has(record.value.team) && record.value.team !== 'other'
        || !SAFE_STATUSES.has(record.value.status) && record.value.status !== 'other') {
      fail('AGGREGATE_PROJECTION_INVALID', 'The aggregate proof was malformed.');
    }
    aggregateCount += count;
  }
  if (aggregateCount !== rows.length) fail('ROW_COUNT_MISMATCH', 'Aggregate counts did not equal the private row export.');
  const runtimeSafety = validateRuntimeSafety(runtimeRecord.value, 'RUNTIME_SAFETY_INVALID');
  return {
    sections, metadata: metadata.value, runtimeSafety, preF27Baseline,
    columnNames, rows, newest, aggregates,
  };
}

function parsePostTranscript(stdout, confirmedDatabase, includeRows = true) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(line => line.length);
  if (!lines.length) fail('POST_TRANSCRIPT_EMPTY', 'The post-migration readback transcript was empty.');
  const allowed = new Set([
    'post_metadata', 'post_runtime_safety', 'post_rows', 'f27_columns', 'f27_constraints',
    'f27_triggers', 'f27_functions', 'f27_indexes', 'f27_table_boundaries',
    'f27_function_execute_grants', 'f27_state',
  ]);
  const sections = new Map();
  for (const line of lines) {
    const record = parseRecord(line);
    if (!allowed.has(record.section) || (!includeRows && record.section === 'post_rows')) {
      fail('POST_SECTION_UNEXPECTED', 'The post-migration readback contained an unexpected section.');
    }
    if (!sections.has(record.section)) sections.set(record.section, []);
    sections.get(record.section).push(record);
  }
  for (const [section, records] of sections) {
    const keys = new Set();
    records.forEach((record, index) => {
      if (record.ordinal !== index + 1) fail('POST_INVENTORY_UNSTABLE', 'Post-migration readback ordering was unstable.');
      if (keys.has(record.key)) fail('POST_INVENTORY_DUPLICATE', 'Post-migration readback contained a duplicate identity.');
      keys.add(record.key);
    });
  }
  const metadata = sections.get('post_metadata') || [];
  const runtimeRows = sections.get('post_runtime_safety') || [];
  const stateRows = sections.get('f27_state') || [];
  if (metadata.length !== 1 || runtimeRows.length !== 1 || stateRows.length !== 1
      || metadata[0].value.current_database !== confirmedDatabase
      || metadata[0].value.transaction_isolation !== 'repeatable read'
      || metadata[0].value.transaction_read_only !== 'on') {
    fail('POST_TRANSACTION_PROOF_FAILED', 'Post-migration database identity or read-only transaction proof failed.');
  }
  const columns = sections.get('f27_columns') || [];
  if (columns.length !== 2 || columns.map(record => record.key).sort().join(',') !== 'authority_generation,f27_drill_rollback_id') {
    fail('F27_COLUMNS_INVALID', 'The two additive F27 mirror_outbox columns were not exact.');
  }
  const generation = columns.find(record => record.key === 'authority_generation').value;
  const drillId = columns.find(record => record.key === 'f27_drill_rollback_id').value;
  if (generation.type !== 'bigint' || generation.not_null !== true
      || !/^\(?0(?:::bigint)?\)?$/.test(clean(generation.default))
      || drillId.type !== 'uuid' || drillId.not_null !== false || drillId.default != null) {
    fail('F27_COLUMNS_INVALID', 'The additive F27 column types, nullability, or defaults drifted.');
  }
  const constraints = sections.get('f27_constraints') || [];
  if (constraints.length !== F27_CONSTRAINT_NAMES.length
      || constraints.map(record => record.key).sort().join(',') !== [...F27_CONSTRAINT_NAMES].sort().join(',')
      || constraints.some(record => record.value.validated !== true || !clean(record.value.definition))) {
    fail('F27_CONSTRAINTS_INVALID', 'The F27 mirror_outbox constraints were missing, unvalidated, or malformed.');
  }
  const triggers = sections.get('f27_triggers') || [];
  if (triggers.length !== 1 || triggers[0].key !== 'track_b_f27_hold_guard'
      || triggers[0].value.enabled !== 'O' || !clean(triggers[0].value.definition)
      || !clean(triggers[0].value.function_identity).includes('track_b_f27_hold_guard')) {
    fail('F27_TRIGGER_INVALID', 'The enabled F27 server fence trigger was not exact.');
  }
  const functions = sections.get('f27_functions') || [];
  const functionNames = functions.map(record => clean(record.value && record.value.name));
  if (functions.length !== F27_FUNCTION_NAMES.length
      || [...functionNames].sort().join(',') !== [...F27_FUNCTION_NAMES].sort().join(',')
      || functions.some(record => !clean(record.value.definition))) {
    fail('F27_FUNCTIONS_INVALID', 'The complete F27 function definition closure was missing, overloaded, or malformed.');
  }
  const validGrant = (grant, expectedPrivilege = '') => grant && typeof grant === 'object'
    && clean(grant.grantee) && clean(grant.grantor) && clean(grant.privilege)
    && (!expectedPrivilege || grant.privilege === expectedPrivilege)
    && typeof grant.grantable === 'boolean';
  const tableBoundaries = sections.get('f27_table_boundaries') || [];
  const expectedTableKeys = F27_TABLE_NAMES.map(name => `public.${name}`).sort();
  if (tableBoundaries.length !== F27_TABLE_NAMES.length
      || tableBoundaries.map(record => record.key).sort().join(',') !== expectedTableKeys.join(',')
      || tableBoundaries.some(record => {
        const value = record.value || {};
        return value.schema !== 'public' || record.key !== `public.${value.name}`
          || !['r', 'p'].includes(value.kind) || !clean(value.owner)
          || typeof value.row_security !== 'boolean' || typeof value.force_row_security !== 'boolean'
          || typeof value.acl_is_null !== 'boolean'
          || !Array.isArray(value.raw_acl) || value.raw_acl.some(entry => !clean(entry))
          || !Array.isArray(value.effective_grants) || !value.effective_grants.length
          || value.effective_grants.some(grant => !validGrant(grant));
      })) {
    fail('F27_TABLE_BOUNDARIES_INVALID', 'The three F27 table owner, RLS, ACL, or effective-grant boundaries were incomplete or malformed.');
  }
  const functionExecuteGrants = sections.get('f27_function_execute_grants') || [];
  const expectedExecuteKeys = [...F27_EXECUTE_FUNCTION_IDENTITIES].sort();
  if (functionExecuteGrants.length !== F27_EXECUTE_FUNCTION_IDENTITIES.length
      || functionExecuteGrants.map(record => record.key).sort().join(',') !== expectedExecuteKeys.join(',')
      || functionExecuteGrants.some(record => {
        const value = record.value || {};
        return value.schema !== 'public' || record.key !== value.regprocedure_identity
          || !clean(value.name) || !clean(value.owner)
          || typeof value.identity_arguments !== 'string' || typeof value.acl_is_null !== 'boolean'
          || !Array.isArray(value.raw_acl) || value.raw_acl.some(entry => !clean(entry))
          || !Array.isArray(value.effective_execute_grants) || !value.effective_execute_grants.length
          || value.effective_execute_grants.some(grant => !validGrant(grant, 'EXECUTE'));
      })) {
    fail('F27_FUNCTION_EXECUTE_GRANTS_INVALID', 'The nine exact F27 RPC effective-EXECUTE boundaries were incomplete or malformed.');
  }
  const indexes = sections.get('f27_indexes') || [];
  if (indexes.length !== 1 || indexes[0].key !== 'mirror_outbox_one_f27_drill_row_idx'
      || indexes[0].value.unique !== true || indexes[0].value.valid !== true
      || indexes[0].value.ready !== true || indexes[0].value.live !== true
      || !clean(indexes[0].value.definition)) {
    fail('F27_INDEX_INVALID', 'The unique F27 drill binder index was missing or invalid.');
  }
  const state = stateRows[0].value;
  if (Number(state.fence_count) !== 2
      || JSON.stringify(stableValue(state.fences)) !== '{"graphics":0,"video":0}'
      || Number(state.rollback_count) !== 0 || Number(state.intent_count) !== 0
      || Number(state.residual_probe_count) !== 0) {
    fail('F27_POST_STATE_INVALID', 'F27 fences, empty ledgers, or migration-probe cleanup did not match the safe post-install state.');
  }
  const runtimeSafety = validateRuntimeSafety(runtimeRows[0].value, 'POST_RUNTIME_SAFETY_INVALID');
  if (includeRows && !sections.has('post_rows')) sections.set('post_rows', []);
  return { sections, metadata: metadata[0].value, runtimeSafety, state };
}

function postContract(parsed) {
  const contract = {
    format: `${FORMAT}-post-contract`,
    columns: (parsed.sections.get('f27_columns') || []).map(record => ({ key: record.key, value: record.value })),
    constraints: (parsed.sections.get('f27_constraints') || []).map(record => ({ key: record.key, value: record.value })),
    triggers: (parsed.sections.get('f27_triggers') || []).map(record => ({ key: record.key, value: record.value })),
    functions: (parsed.sections.get('f27_functions') || []).map(record => ({ key: record.key, value: record.value })),
    indexes: (parsed.sections.get('f27_indexes') || []).map(record => ({ key: record.key, value: record.value })),
    table_boundaries: (parsed.sections.get('f27_table_boundaries') || []).map(record => ({ key: record.key, value: record.value })),
    function_execute_grants: (parsed.sections.get('f27_function_execute_grants') || []).map(record => ({ key: record.key, value: record.value })),
  };
  return { contract, sha256: sha256(Buffer.from(stableJson(contract), 'utf8')) };
}

function assertPrivateBundle(bundlePath, expectedSha256, worktreeRoots, privacyOptions = {}) {
  if (!bundlePath || !path.isAbsolute(bundlePath) || !HASH_RE.test(clean(expectedSha256))) {
    fail('PRIVATE_BUNDLE_INPUT_INVALID', 'An absolute private bundle and its exact SHA-256 are required.');
  }
  const resolved = path.resolve(bundlePath);
  assertNoSymlinkComponents(resolved);
  for (const root of worktreeRoots) {
    if (isWithin(root, resolved)) fail('WORKTREE_PATH_REJECTED', 'The private bundle must be outside every Git worktree.');
  }
  const containing = containingGitWorktree(resolved);
  if (containing && isWithin(containing, resolved)) fail('WORKTREE_PATH_REJECTED', 'The private bundle must be outside every Git worktree.');
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_BUNDLE_INPUT_INVALID', 'The private bundle must be a regular file.');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    fail('PRIVATE_PERMISSIONS_REQUIRED', 'The private bundle must not grant group or other access.');
  }
  assertWindowsPrivateFileAcl(resolved, privacyOptions);
  let bytes;
  try { bytes = fs.readFileSync(resolved); } catch (_) { fail('PRIVATE_BUNDLE_READ_FAILED', 'The private bundle could not be read safely.'); }
  if (sha256(bytes) !== expectedSha256) fail('PRIVATE_BUNDLE_HASH_MISMATCH', 'The private bundle SHA-256 did not match.');
  let bundle;
  let manifestBytes;
  let manifest;
  try {
    bundle = JSON.parse(bytes);
    manifestBytes = Buffer.from(bundle.manifest_base64, 'base64');
    manifest = JSON.parse(manifestBytes);
  } catch (_) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle or manifest was malformed.');
  }
  if (!bundle || bundle.format !== `${FORMAT}-bundle` || !manifest
      || bundle.manifest_sha256 !== sha256(manifestBytes)
      || bundle.manifest_sha256 !== clean(bundle.manifest_sha256)
      || !Array.isArray(bundle.files) || !Array.isArray(manifest.files)
      || bundle.files.length !== manifest.files.length) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle manifest binding was incomplete.');
  }
  const files = new Map();
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const bundled = bundle.files[index];
    if (!entry || !bundled || entry.path !== bundled.path || files.has(entry.path)
        || !/^[a-z0-9_.\/-]+$/.test(entry.path) || path.posix.isAbsolute(entry.path)
        || entry.path.split('/').some(segment => segment === '..')) {
      fail('PRIVATE_BUNDLE_MALFORMED', 'The private bundle file inventory was unsafe or duplicated.');
    }
    let content;
    try { content = Buffer.from(bundled.content_base64, 'base64'); } catch (_) { fail('PRIVATE_BUNDLE_MALFORMED', 'A private bundle member was malformed.'); }
    if (content.length !== Number(entry.byte_length) || content.length !== Number(bundled.byte_length)
        || sha256(content) !== entry.sha256 || sha256(content) !== bundled.sha256) {
      fail('PRIVATE_BUNDLE_HASH_MISMATCH', 'A private bundle member failed byte-length or SHA-256 verification.');
    }
    files.set(entry.path, content);
  }
  for (const required of [
    'database/mirror_outbox.rows.jsonl',
    'database/mirror_outbox.preinstall-column-projection.json',
    'database/pre-f27-baseline.json',
    'database/runtime-safety-state.json',
    'metadata/snapshot.json',
  ]) {
    if (!files.has(required)) fail('PRIVATE_BUNDLE_INCOMPLETE', 'The private bundle lacked a required pre-install proof member.');
  }
  return { bytes, bundle, manifest, files };
}

function sectionJsonl(records) {
  return Buffer.from(records.map(record => record.raw).join(records.length ? '\n' : '') + (records.length ? '\n' : ''), 'utf8');
}

function buildFiles(parsed, localMetadata) {
  const files = new Map();
  files.set('database/mirror_outbox.rows.jsonl', sectionJsonl(parsed.rows));
  files.set('database/mirror_outbox.preinstall-column-projection.json', Buffer.from(stableJson(parsed.columnNames), 'utf8'));
  files.set('database/pre-f27-baseline.json', Buffer.from(stableJson(parsed.preF27Baseline), 'utf8'));
  for (const section of ['table', 'columns', 'constraints', 'triggers', 'functions', 'indexes', 'policies', 'grants']) {
    files.set(`database/mirror_outbox.${section}.jsonl`, sectionJsonl(parsed.sections.get(section) || []));
  }
  const safeProof = {
    row_count: parsed.rows.length,
    aggregates: parsed.aggregates.map(record => record.value),
    newest: parsed.newest.map(record => ({
      rank: Number(record.value.rank),
      team: record.value.team,
      status: record.value.status,
      time: record.value.time,
      private_row_sha256: sha256(Buffer.from(record.value.private_row, 'utf8')),
    })),
  };
  files.set('database/mirror_outbox.public-safe-proof.json', Buffer.from(stableJson(safeProof), 'utf8'));
  files.set('database/runtime-safety-state.json', Buffer.from(stableJson({
    flags: parsed.runtimeSafety.flags,
    flag_flips_count: parsed.runtimeSafety.flagFlipsCount,
  }), 'utf8'));
  files.set('metadata/snapshot.json', Buffer.from(stableJson({
    format: FORMAT,
    tool_release: TOOL_RELEASE,
    node_version: process.version,
    psql_version: localMetadata.psqlVersion,
    release_sha: localMetadata.releaseSha,
    migration_path: MIGRATION_RELATIVE_PATH,
    migration_sha256: localMetadata.migrationSha256,
    project_ref: localMetadata.projectRef,
    database: localMetadata.database,
    database_server_version: parsed.metadata.server_version,
    database_server_version_num: parsed.metadata.server_version_num,
    snapshot_time: parsed.metadata.snapshot_time,
    transaction_isolation: parsed.metadata.transaction_isolation,
    transaction_read_only: parsed.metadata.transaction_read_only,
    primary_key_columns: parsed.metadata.primary_key_columns,
  }), 'utf8'));
  return { files, safeProof, runtimeSafety: parsed.runtimeSafety };
}

function sealBundle(files, metadata) {
  const entries = [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([relativePath, bytes]) => ({
    path: relativePath.replace(/\\/g, '/'),
    byte_length: bytes.length,
    sha256: sha256(bytes),
  }));
  if (!entries.length || new Set(entries.map(entry => entry.path)).size !== entries.length) {
    fail('MANIFEST_INVALID', 'The private manifest inventory was empty or duplicated.');
  }
  const manifestBytes = Buffer.from(stableJson({
    format: `${FORMAT}-manifest`,
    snapshot_time: metadata.snapshot_time,
    files: entries,
  }), 'utf8');
  const manifestSha256 = sha256(manifestBytes);
  const bundleBytes = Buffer.from(stableJson({
    format: `${FORMAT}-bundle`,
    manifest_sha256: manifestSha256,
    manifest_base64: manifestBytes.toString('base64'),
    files: entries.map(entry => ({
      path: entry.path,
      byte_length: entry.byte_length,
      sha256: entry.sha256,
      content_base64: files.get(entry.path).toString('base64'),
    })),
  }), 'utf8');
  return { entries, manifestBytes, manifestSha256, bundleBytes, bundleSha256: sha256(bundleBytes) };
}

function writePrivateFiles(outputDir, files, sealed) {
  const written = [];
  try {
    for (const [relativePath, bytes] of [...files.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      const target = path.join(outputDir, ...relativePath.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
      written.push(target);
    }
    const manifestTarget = path.join(outputDir, 'manifest.json');
    fs.writeFileSync(manifestTarget, sealed.manifestBytes, { flag: 'wx', mode: 0o600 });
    written.push(manifestTarget);
    const bundleTarget = path.join(outputDir, `f27-mirror-outbox-${sealed.bundleSha256}.snapshot`);
    fs.writeFileSync(bundleTarget, sealed.bundleBytes, { flag: 'wx', mode: 0o600 });
    written.push(bundleTarget);
    for (const target of written) fs.chmodSync(target, 0o400);
    return bundleTarget;
  } catch (_) {
    for (const target of written.reverse()) {
      try { fs.chmodSync(target, 0o600); fs.unlinkSync(target); } catch (_) { /* exact incomplete capture only */ }
    }
    fail('PRIVATE_WRITE_FAILED', 'The sealed private snapshot could not be written atomically.');
  }
}

function captureSnapshot(options) {
  if (!options || options.confirmed !== true) {
    fail('CONFIRMATION_REQUIRED', 'Explicit mirror_outbox snapshot confirmation is required.');
  }
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database);
  const release = assertRelease(options);
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const outputDir = assertPrivateEmptyOutput(options.outputDir, worktreeRoots);
  const privacyOptions = {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  };
  protectWindowsPrivateDirectory(outputDir, privacyOptions);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try {
    transcript = adapter.capture(sqlText(), connectionEnv);
  } catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('PSQL_CAPTURE_FAILED', 'The read-only psql snapshot transaction failed closed.');
  }
  const parsed = parseTranscript(transcript, database);
  const built = buildFiles(parsed, {
    psqlVersion,
    releaseSha: release.headSha,
    migrationSha256: release.migrationSha256,
    projectRef,
    database,
  });
  const sealed = sealBundle(built.files, parsed.metadata);
  const bundleTarget = writePrivateFiles(outputDir, built.files, sealed);
  assertWindowsPrivateFileAcl(bundleTarget, privacyOptions);
  const readback = fs.readFileSync(bundleTarget);
  if (readback.length !== sealed.bundleBytes.length || sha256(readback) !== sealed.bundleSha256) {
    fail('LOCAL_READBACK_MISMATCH', 'The local sealed bundle did not pass an independent byte readback.');
  }
  const hashes = Object.fromEntries(sealed.entries.map(entry => [entry.path, entry.sha256]));
  return {
    status: 'PASS',
    snapshot_manifest_sha256: sealed.manifestSha256,
    snapshot_bundle_sha256: sealed.bundleSha256,
    mirror_outbox_row_count: built.safeProof.row_count,
    pre_f27_baseline: 'PASS',
    runtime_flags: built.runtimeSafety.flags,
    flag_flips_count: built.runtimeSafety.flagFlipsCount,
    runtime_safety_state_sha256: hashes['database/runtime-safety-state.json'],
    pre_f27_baseline_sha256: hashes['database/pre-f27-baseline.json'],
    newest_public_safe_rows: built.safeProof.newest,
    newest_public_safe_aggregates: built.safeProof.aggregates,
    constraint_definition_sha256: hashes['database/mirror_outbox.constraints.jsonl'],
    trigger_definition_sha256: hashes['database/mirror_outbox.triggers.jsonl'],
    dependent_function_closure_sha256: hashes['database/mirror_outbox.functions.jsonl'],
    table_boundary_definition_sha256: sha256(Buffer.from(stableJson({
      table: hashes['database/mirror_outbox.table.jsonl'],
      columns: hashes['database/mirror_outbox.columns.jsonl'],
      projection: hashes['database/mirror_outbox.preinstall-column-projection.json'],
      constraints: hashes['database/mirror_outbox.constraints.jsonl'],
      triggers: hashes['database/mirror_outbox.triggers.jsonl'],
      functions: hashes['database/mirror_outbox.functions.jsonl'],
      indexes: hashes['database/mirror_outbox.indexes.jsonl'],
      policies: hashes['database/mirror_outbox.policies.jsonl'],
      grants: hashes['database/mirror_outbox.grants.jsonl'],
    }), 'utf8')),
    local_private_readback: 'PASS',
  };
}

function verifyAfter(options) {
  if (!options || options.confirmed !== true) {
    fail('VERIFY_CONFIRMATION_REQUIRED', 'Explicit post-migration readback confirmation is required.');
  }
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const expectedContractSha256 = clean(options.expectedPostContractSha256);
  if (!HASH_RE.test(expectedContractSha256)) {
    fail('POST_CONTRACT_HASH_REQUIRED', 'The disposable-source post-contract SHA-256 is required.');
  }
  const connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database);
  const release = assertRelease(options);
  const worktreeRoots = options.worktreeRoots || discoverRegisteredWorktrees(options.repoRoot || REPO_ROOT);
  const privateBundle = assertPrivateBundle(
    options.bundlePath,
    clean(options.expectedBundleSha256),
    worktreeRoots,
    { aclPlatform: options.aclPlatform, privateAclAdapter: options.privateAclAdapter },
  );
  let projection;
  let snapshotMetadata;
  let baselineRuntimeSafety;
  try {
    projection = JSON.parse(privateBundle.files.get('database/mirror_outbox.preinstall-column-projection.json'));
    snapshotMetadata = JSON.parse(privateBundle.files.get('metadata/snapshot.json'));
    baselineRuntimeSafety = JSON.parse(privateBundle.files.get('database/runtime-safety-state.json'));
  } catch (_) {
    fail('PRIVATE_BUNDLE_MALFORMED', 'The captured projection or metadata member was malformed.');
  }
  if (!snapshotMetadata || snapshotMetadata.release_sha !== release.headSha
      || snapshotMetadata.migration_sha256 !== release.migrationSha256
      || snapshotMetadata.project_ref !== projectRef || snapshotMetadata.database !== database) {
    fail('PRIVATE_BUNDLE_RELEASE_MISMATCH', 'The private baseline was not bound to this exact release/project/database.');
  }
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try { transcript = adapter.capture(verifyAfterSql(projection, true), connectionEnv); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('POST_PSQL_CAPTURE_FAILED', 'The post-migration read-only transaction failed closed.');
  }
  const parsed = parsePostTranscript(transcript, database, true);
  const baselineSafety = validateRuntimeSafety(baselineRuntimeSafety, 'PRIVATE_BUNDLE_RUNTIME_SAFETY_INVALID');
  if (JSON.stringify(stableValue(parsed.runtimeSafety.flags)) !== JSON.stringify(stableValue(baselineSafety.flags))
      || parsed.runtimeSafety.flagFlipsCount !== baselineSafety.flagFlipsCount) {
    fail('RUNTIME_SAFETY_DRIFT', 'Authority, outbound, parity, or flag-flip state changed across the migration window.');
  }
  const postRows = sectionJsonl(parsed.sections.get('post_rows') || []);
  const preRows = privateBundle.files.get('database/mirror_outbox.rows.jsonl');
  if (postRows.length !== preRows.length || sha256(postRows) !== sha256(preRows)
      || (parsed.sections.get('post_rows') || []).length !== (preRows.length ? preRows.toString('utf8').trimEnd().split('\n').length : 0)) {
    fail('PREEXISTING_ROWS_CHANGED', 'Pre-existing rows changed when projected through the captured old-column list.');
  }
  const contract = postContract(parsed);
  if (contract.sha256 !== expectedContractSha256) {
    fail('POST_CONTRACT_MISMATCH', 'The installed F27 schema, function, table-security, or execute-grant contract did not match exact source.');
  }
  return {
    status: 'PASS',
    mirror_outbox_row_count_preserved: (parsed.sections.get('post_rows') || []).length,
    preexisting_projection_sha256: sha256(postRows),
    residual_synthetic_probe_count: 0,
    runtime_flags: parsed.runtimeSafety.flags,
    flag_flips_count_delta: parsed.runtimeSafety.flagFlipsCount - baselineSafety.flagFlipsCount,
    f27_fences_generation_zero: 'PASS',
    f27_empty_ledgers: 'PASS',
    f27_table_security_boundaries: 'PASS',
    f27_function_execute_grants: 'PASS',
    f27_post_contract_sha256: contract.sha256,
    transaction: 'repeatable_read_read_only',
  };
}

function fingerprintPost(options) {
  if (!options || options.confirmed !== true) {
    fail('DISPOSABLE_CONFIRMATION_REQUIRED', 'Explicit disposable post-contract confirmation is required.');
  }
  const database = clean(options.database);
  const connectionEnv = parseDisposableDatabaseUrl(options.databaseUrl, database);
  const release = assertRelease(options);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = clean(adapter.version());
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(psqlVersion)) {
    fail('PSQL_VERSION_FAILED', 'The psql version response was malformed.');
  }
  let transcript;
  try { transcript = adapter.capture(verifyAfterSql(['id'], false), connectionEnv); }
  catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    fail('POST_PSQL_CAPTURE_FAILED', 'The disposable post-contract read-only transaction failed closed.');
  }
  const parsed = parsePostTranscript(transcript, database, false);
  const contract = postContract(parsed);
  return {
    status: 'PASS',
    f27_post_contract_sha256: contract.sha256,
    f27_table_security_boundaries: 'PASS',
    f27_function_execute_grants: 'PASS',
    release_sha: release.headSha,
    migration_sha256: release.migrationSha256,
    source: 'disposable_postgresql_read_only',
  };
}

function parseArgs(argv) {
  const accepted = new Set([
    '--mode', '--output-dir', '--bundle', '--expected-bundle-sha256',
    '--expected-post-contract-sha256', '--confirm-project-ref', '--confirm-database',
    '--release-sha', '--psql',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (!accepted.has(name) || Object.prototype.hasOwnProperty.call(values, name)) {
      fail('ARGUMENT_REJECTED', 'Only unique documented snapshot options are accepted.');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_REJECTED', 'Every snapshot option requires one value.');
    values[name] = value;
    index += 1;
  }
  const mode = values['--mode'] || 'capture';
  if (!['capture', 'verify-after', 'fingerprint-post'].includes(mode)) {
    fail('ARGUMENT_REJECTED', '--mode must be capture, verify-after, or fingerprint-post.');
  }
  for (const required of ['--confirm-database', '--release-sha']) {
    if (!values[required]) fail('ARGUMENT_REJECTED', 'All required snapshot options must be explicit.');
  }
  if (mode !== 'fingerprint-post' && !values['--confirm-project-ref']) {
    fail('ARGUMENT_REJECTED', 'Live capture/readback modes require an explicit project ref.');
  }
  if (mode === 'capture' && !values['--output-dir']) {
    fail('ARGUMENT_REJECTED', 'Capture mode requires --output-dir.');
  }
  if (mode === 'capture' && (values['--bundle'] || values['--expected-bundle-sha256']
      || values['--expected-post-contract-sha256'])) {
    fail('ARGUMENT_REJECTED', 'Capture mode rejects verify-after inputs.');
  }
  if (mode === 'verify-after' && (!values['--bundle'] || !values['--expected-bundle-sha256']
      || !values['--expected-post-contract-sha256'])) {
    fail('ARGUMENT_REJECTED', 'Verify-after mode requires the private bundle and both exact expected hashes.');
  }
  if (mode === 'verify-after' && values['--output-dir']) {
    fail('ARGUMENT_REJECTED', 'Verify-after is read-only and rejects an output directory.');
  }
  if (mode === 'fingerprint-post' && (values['--output-dir'] || values['--bundle']
      || values['--expected-bundle-sha256'] || values['--expected-post-contract-sha256']
      || values['--confirm-project-ref'])) {
    fail('ARGUMENT_REJECTED', 'Disposable post-contract mode rejects live-project and private-bundle inputs.');
  }
  return {
    mode,
    outputDir: values['--output-dir'],
    bundlePath: values['--bundle'],
    expectedBundleSha256: values['--expected-bundle-sha256'],
    expectedPostContractSha256: values['--expected-post-contract-sha256'],
    projectRef: values['--confirm-project-ref'],
    database: values['--confirm-database'],
    releaseSha: values['--release-sha'],
    psqlPath: values['--psql'] || 'psql',
  };
}

function publicFailure(error) {
  if (error instanceof SnapshotCaptureError) return { status: 'FAIL', code: error.code, message: error.message };
  return { status: 'FAIL', code: 'UNEXPECTED_FAILURE', message: 'The private mirror_outbox capture failed closed.' };
}

function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const common = {
    ...args,
    databaseUrl: env.F27_DATABASE_URL,
  };
  if (args.mode === 'verify-after') {
    return verifyAfter({
      ...common,
      confirmed: clean(env.F27_CONFIRM_MIRROR_OUTBOX_VERIFY_AFTER) === '1',
    });
  }
  if (args.mode === 'fingerprint-post') {
    return fingerprintPost({
      ...args,
      databaseUrl: env.F27_DISPOSABLE_DATABASE_URL,
      confirmed: clean(env.F27_CONFIRM_DISPOSABLE_POST_CONTRACT) === '1',
    });
  }
  return captureSnapshot({
    ...common,
    confirmed: clean(env.F27_CONFIRM_MIRROR_OUTBOX_SNAPSHOT) === '1',
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
  FORMAT,
  SnapshotCaptureError,
  WINDOWS_PRIVATE_ACL_FORMAT,
  assertPrivateBundle,
  assertPrivateEmptyOutput,
  assertWindowsPrivateAcl,
  assertWindowsPrivateFileAcl,
  buildFiles,
  captureSnapshot,
  defaultWindowsPrivateAclAdapter,
  fingerprintPost,
  parseArgs,
  parseDatabaseUrl,
  parseDisposableDatabaseUrl,
  parseTranscript,
  parsePostTranscript,
  postContract,
  psqlCaptureFailure,
  publicFailure,
  protectWindowsPrivateDirectory,
  sealBundle,
  safePsqlEnvironment,
  sqlText,
  verifyAfter,
  verifyAfterSql,
};
