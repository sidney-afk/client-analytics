#!/usr/bin/env node
'use strict';

/*
 * Execute one generated F27 private database rollback recipe without placing
 * a database URL or password in the psql argument vector. The recipe and its
 * non-overwriting transcript must both live outside every Git worktree.
 *
 * F27_DATABASE_URL='postgresql://...' \
 * F27_CONFIRM_DATABASE_ROLLBACK_EXECUTE=EXECUTE_F27_DATABASE_ROLLBACK \
 * node scripts/f27-database-rollback-execute.js \
 *   --recipe=/absolute/private/f27-database-rollback.sql \
 *   --expected-recipe-sha256=<sha256> \
 *   --transcript=/absolute/private/f27-database-rollback.transcript \
 *   --release-sha=<40-lowercase-hex> \
 *   --confirm-project-ref=<20-char-ref> \
 *   --confirm-database=postgres \
 *   --snapshot-bundle-sha256=<sha256>
 *
 * No live invocation is part of this source-only change.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const {
  assertWindowsPrivateFileAcl,
  parseDatabaseUrl,
} = require('./f27-mirror-outbox-snapshot');
const { releaseProof } = require('./f27-database-rollback-recipe');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIRMATION = 'EXECUTE_F27_DATABASE_ROLLBACK';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const DATABASE_RE = /^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/;
const TRANSCRIPT_FORMAT = 'syncview-f27-database-rollback-transcript-v1';
const MAX_PSQL_OUTPUT_BYTES = 8 * 1024 * 1024;

class RollbackExecutorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'RollbackExecutorError';
    this.code = code;
  }
}

function fail(code) {
  throw new RollbackExecutorError(code);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
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

function assertPrivateRecipe(recipePath, expectedHash, worktreeRoots, privacyOptions = {}) {
  if (!recipePath || !path.isAbsolute(recipePath) || path.extname(recipePath).toLowerCase() !== '.sql') {
    fail('PRIVATE_RECIPE_INPUT_INVALID');
  }
  if (!HASH_RE.test(expectedHash)) fail('RECIPE_HASH_REQUIRED');
  const resolved = assertOutsideWorktrees(recipePath, worktreeRoots, 'PRIVATE_RECIPE_WORKTREE_REJECTED');
  const stat = lstatOrNull(resolved);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail('PRIVATE_RECIPE_INPUT_INVALID');
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('PRIVATE_PERMISSIONS_REQUIRED');
  try { assertWindowsPrivateFileAcl(resolved, privacyOptions); }
  catch (_) { fail('WINDOWS_PRIVATE_ACL_REQUIRED'); }
  let bytes;
  try { bytes = fs.readFileSync(resolved); }
  catch (_) { fail('PRIVATE_RECIPE_READ_FAILED'); }
  if (!bytes.length || sha256(bytes) !== expectedHash) fail('PRIVATE_RECIPE_HASH_MISMATCH');
  return { path: resolved, bytes };
}

function assertPrivateTranscriptTarget(transcriptPath, recipePath, worktreeRoots) {
  if (!transcriptPath || !path.isAbsolute(transcriptPath)) fail('PRIVATE_TRANSCRIPT_OUTPUT_INVALID');
  const resolved = assertOutsideWorktrees(
    transcriptPath, worktreeRoots, 'PRIVATE_TRANSCRIPT_WORKTREE_REJECTED',
  );
  if (normalized(resolved) === normalized(recipePath)) fail('PRIVATE_TRANSCRIPT_OUTPUT_INVALID');
  if (lstatOrNull(resolved)) fail('PRIVATE_TRANSCRIPT_EXISTS');
  const parent = path.dirname(resolved);
  assertNoSymlinkComponents(parent);
  const stat = lstatOrNull(parent);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail('PRIVATE_TRANSCRIPT_DIRECTORY_INVALID');
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) fail('PRIVATE_PERMISSIONS_REQUIRED');
  return resolved;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function assertGeneratedRecipe(recipeBytes, binders) {
  const sql = recipeBytes.toString('utf8');
  const expectedBinders = [
    ['f27_release_sha', binders.releaseSha],
    ['f27_project_ref', binders.projectRef],
    ['f27_database', binders.database],
    ['f27_snapshot_bundle_sha256', binders.snapshotBundleSha256],
  ];
  const required = [
    '\\set ON_ERROR_STOP on',
    '\\set QUIET on',
    'BEGIN;',
    'LOCK TABLE public.mirror_outbox IN ACCESS EXCLUSIVE MODE;',
    'ALTER TABLE public.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard;',
    'F27_ROLLBACK_BOUNDARY_FUNCTION_READBACK_MISMATCH',
    'F27_ROLLBACK_PREINSTALL_ROW_PROJECTION_CHANGED',
    'F27_ROLLBACK_RUNTIME_SAFETY_CHANGED',
    'COMMIT;',
  ];
  const metaCommands = [...sql.matchAll(/\\([A-Za-z]+|[!?])/g)]
    .map(match => match[1].toLowerCase());
  const allowedMetaCommands = new Set(['set', 'if', 'gset', 'else', 'quit', 'endif']);
  if (!required.every(value => sql.includes(value))
      || (sql.match(/\bBEGIN;/g) || []).length !== 1
      || (sql.match(/\bCOMMIT;/g) || []).length !== 1
      || expectedBinders.some(([name, value]) => !sql.includes(
        `SELECT :'${name}' = ${sqlLiteral(value)} AS f27_binder_ok \\gset`,
      ))
      || metaCommands.some(command => !allowedMetaCommands.has(command))
      || /\bCOPY\b[\s\S]{0,200}\bPROGRAM\b/i.test(sql)
      || sql.includes('`')
      || sql.includes('\u0000')) fail('PRIVATE_RECIPE_CONTRACT_MISMATCH');
  return true;
}

function defaultPsqlAdapter(psqlPath) {
  return {
    version() {
      let output;
      try {
        output = execFileSync(psqlPath, ['--version'], {
          encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch (_) { fail('PSQL_VERSION_FAILED'); }
      const value = clean(output);
      if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(value)) fail('PSQL_VERSION_FAILED');
      return value;
    },
    execute(argv, env, input) {
      return spawnSync(psqlPath, argv, {
        input,
        windowsHide: true,
        env,
        maxBuffer: MAX_PSQL_OUTPUT_BYTES,
      });
    },
  };
}

function sanitizedChildEnvironment(baseEnv, connectionEnv) {
  const result = {};
  const allowed = new Set([
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec',
    'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  ]);
  for (const [key, value] of Object.entries(baseEnv || {})) {
    if (allowed.has(key)) result[key] = value;
  }
  Object.assign(result, connectionEnv, {
    PGAPPNAME: 'f27-database-rollback-executor',
    PGOPTIONS: '',
  });
  return result;
}

function psqlArguments(binders) {
  return [
    '-X', '--quiet', '--no-align', '--tuples-only',
    '--set', 'ON_ERROR_STOP=1',
    '--set', `f27_release_sha=${binders.releaseSha}`,
    '--set', `f27_project_ref=${binders.projectRef}`,
    '--set', `f27_database=${binders.database}`,
    '--set', `f27_snapshot_bundle_sha256=${binders.snapshotBundleSha256}`,
    '--file', '-',
  ];
}

function reserveTranscript(transcriptPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(transcriptPath, 'wx', 0o600);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
  } catch (_) {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch (_) { /* reservation failure only */ }
    }
    fail('PRIVATE_TRANSCRIPT_RESERVATION_FAILED');
  }
}

function resultBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value == null ? '' : String(value), 'utf8');
}

function finalizeTranscript(transcriptPath, psqlVersion, result) {
  const bytes = Buffer.from(`${JSON.stringify({
    format: TRANSCRIPT_FORMAT,
    psql_version: psqlVersion,
    exit_status: Number.isInteger(result && result.status) ? result.status : null,
    signal: clean(result && result.signal) || null,
    spawn_error_code: clean(result && result.error && result.error.code) || null,
    stdout_base64: resultBytes(result && result.stdout).toString('base64'),
    stderr_base64: resultBytes(result && result.stderr).toString('base64'),
  })}\n`, 'utf8');
  let descriptor;
  try {
    descriptor = fs.openSync(transcriptPath, 'r+');
    fs.ftruncateSync(descriptor, 0);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.chmodSync(transcriptPath, 0o400);
  } catch (_) {
    if (descriptor != null) {
      try { fs.closeSync(descriptor); } catch (_) { /* transcript failure only */ }
    }
    fail('PRIVATE_TRANSCRIPT_WRITE_FAILED');
  }
  let readback;
  try { readback = fs.readFileSync(transcriptPath); }
  catch (_) { fail('PRIVATE_TRANSCRIPT_READBACK_FAILED'); }
  if (!readback.equals(bytes)) fail('PRIVATE_TRANSCRIPT_READBACK_MISMATCH');
  return sha256(readback);
}

function executeRollback(options) {
  if (!options || options.confirmation !== CONFIRMATION) fail('CONFIRMATION_REQUIRED');
  const releaseSha = clean(options.releaseSha);
  const projectRef = clean(options.projectRef);
  const database = clean(options.database);
  const recipeHash = clean(options.expectedRecipeSha256);
  const snapshotBundleSha256 = clean(options.snapshotBundleSha256);
  if (!SHA_RE.test(releaseSha)) fail('RELEASE_SHA_INVALID');
  if (!PROJECT_REF_RE.test(projectRef)) fail('PROJECT_CONFIRMATION_INVALID');
  if (!DATABASE_RE.test(database)) fail('DATABASE_CONFIRMATION_INVALID');
  if (!HASH_RE.test(snapshotBundleSha256)) fail('SNAPSHOT_BUNDLE_HASH_REQUIRED');
  const worktreeRoots = options.worktreeRoots || discoverWorktrees(options.repoRoot || REPO_ROOT);
  releaseProof({
    releaseSha,
    releaseInfo: options.releaseInfo,
    repoRoot: options.repoRoot || REPO_ROOT,
  });
  const recipe = assertPrivateRecipe(options.recipePath, recipeHash, worktreeRoots, {
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  });
  const transcriptPath = assertPrivateTranscriptTarget(
    options.transcriptPath, recipe.path, worktreeRoots,
  );
  const binders = { releaseSha, projectRef, database, snapshotBundleSha256 };
  assertGeneratedRecipe(recipe.bytes, binders);

  let connectionEnv;
  try { connectionEnv = parseDatabaseUrl(options.databaseUrl, projectRef, database); }
  catch (error) {
    if (error && /^[A-Z0-9_]+$/.test(clean(error.code))) fail(error.code);
    fail('DATABASE_URL_INVALID');
  }
  if (!clean(connectionEnv.PGPASSWORD)) fail('DATABASE_URL_PASSWORD_REQUIRED');
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const psqlVersion = adapter.version();
  if (!/^psql \(PostgreSQL\) \d+(?:\.\d+)+/.test(clean(psqlVersion))) fail('PSQL_VERSION_FAILED');
  const argv = psqlArguments(binders);
  if (argv.some(value => value === options.databaseUrl || value === connectionEnv.PGPASSWORD)) {
    fail('PSQL_ARGUMENT_SECRET_REJECTED');
  }
  const childEnv = sanitizedChildEnvironment(options.baseEnv || process.env, connectionEnv);

  reserveTranscript(transcriptPath);
  let result;
  try { result = adapter.execute(argv, childEnv, recipe.bytes); }
  catch (error) {
    result = { status: null, signal: null, stdout: '', stderr: '', error };
  }
  const transcriptSha256 = finalizeTranscript(transcriptPath, clean(psqlVersion), result || {});
  if (!result || result.error || result.signal || result.status !== 0) fail('PSQL_EXECUTION_FAILED');
  return {
    status: 'PASS',
    rollback_recipe_sha256: recipeHash,
    snapshot_bundle_sha256: snapshotBundleSha256,
    private_transcript_sha256: transcriptSha256,
    execution: 'PASS',
    private_transcript_readback: 'PASS',
  };
}

function parseArgs(argv) {
  const required = new Set([
    'recipe', 'expected-recipe-sha256', 'transcript', 'release-sha',
    'confirm-project-ref', 'confirm-database', 'snapshot-bundle-sha256',
  ]);
  const allowed = new Set([...required, 'psql']);
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
  if ([...required].some(name => !Object.prototype.hasOwnProperty.call(values, name))) {
    fail('ARGUMENT_REJECTED');
  }
  return values;
}

function publicFailure(error) {
  return {
    status: 'FAIL',
    code: error && /^[A-Z0-9_]+$/.test(clean(error.code))
      ? error.code
      : 'ROLLBACK_EXECUTOR_FAILED',
  };
}

function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  return executeRollback({
    confirmation: clean(env.F27_CONFIRM_DATABASE_ROLLBACK_EXECUTE),
    databaseUrl: env.F27_DATABASE_URL,
    recipePath: args.recipe,
    expectedRecipeSha256: args['expected-recipe-sha256'],
    transcriptPath: args.transcript,
    releaseSha: args['release-sha'],
    projectRef: args['confirm-project-ref'],
    database: args['confirm-database'],
    snapshotBundleSha256: args['snapshot-bundle-sha256'],
    psqlPath: args.psql || 'psql',
    baseEnv: env,
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
  CONFIRMATION,
  RollbackExecutorError,
  assertGeneratedRecipe,
  assertPrivateRecipe,
  executeRollback,
  finalizeTranscript,
  parseArgs,
  psqlArguments,
  publicFailure,
  sanitizedChildEnvironment,
};
