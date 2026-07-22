#!/usr/bin/env node
'use strict';

/*
 * Exact, one-shot F27 migration operator.
 *
 * This mutating command is for a separately owner-authorized install window.
 * It validates the clean origin/main release and migration bytes, binds the
 * database URL to the independently confirmed Supabase project, and lets the
 * checked-in migration own BEGIN/COMMIT and its savepoint self-probe. psql
 * output is written only to an empty private directory outside every Git
 * worktree; stdout/stderr receive a bounded public-safe receipt.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  assertPrivateBundle,
  assertPrivateEmptyOutput,
  parseDatabaseUrl,
} = require('./f27-mirror-outbox-snapshot.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_RELATIVE_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const CONFIRMATION = 'APPLY_F27_MIGRATION_ONCE';
const SHA_RE = /^[a-f0-9]{40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

class MigrationApplyError extends Error {
  constructor(code, receipt = null) {
    super(code);
    this.name = 'MigrationApplyError';
    this.code = code;
    this.receipt = receipt;
  }
}

function fail(code, receipt) {
  throw new MigrationApplyError(code, receipt);
}

function boundaryCall(callback, fallbackCode) {
  try { return callback(); }
  catch (error) {
    const code = clean(error && error.code);
    fail(/^[A-Z][A-Z0-9_]+$/.test(code) ? code : fallbackCode);
  }
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function stableJson(value) {
  return `${JSON.stringify(stable(value), null, 2)}\n`;
}

function discoverWorktrees(repoRoot = REPO_ROOT) {
  let output;
  try {
    output = execFileSync('git', ['-C', repoRoot, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (_) {
    fail('WORKTREE_DISCOVERY_FAILED');
  }
  const roots = output.split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) fail('WORKTREE_DISCOVERY_FAILED');
  return roots;
}

function releaseInfo(repoRoot = REPO_ROOT) {
  try {
    return {
      head: clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true })),
      originMain: clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'origin/main'], { encoding: 'utf8', windowsHide: true })),
      dirty: Boolean(clean(execFileSync('git', ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
        encoding: 'utf8', windowsHide: true,
      }))),
    };
  } catch (_) {
    fail('RELEASE_PROOF_FAILED');
  }
}

function assertRelease(requested, observed) {
  if (!SHA_RE.test(requested)) fail('RELEASE_SHA_INVALID');
  if (!observed || observed.head !== requested || observed.originMain !== requested) {
    fail('RELEASE_SHA_MISMATCH');
  }
  if (observed.dirty) fail('DIRTY_SOURCE_REJECTED');
}

function assertMigration(bytes, expectedHash) {
  if (!HASH_RE.test(expectedHash) || sha256(bytes) !== expectedHash) {
    fail('MIGRATION_HASH_MISMATCH');
  }
  const text = Buffer.from(bytes).toString('utf8');
  const anchors = [
    /^begin;\s*$/im,
    /^savepoint f27_enqueue_probe;\s*$/im,
    /^rollback to savepoint f27_enqueue_probe;\s*$/im,
    /^commit;\s*$/im,
  ];
  if (!anchors.every(pattern => pattern.test(text))) fail('MIGRATION_SELF_PROBE_MISSING');
}

function assertSnapshotBaseline(options) {
  const privateBundle = boundaryCall(
    () => assertPrivateBundle(
      options.snapshotBundle,
      clean(options.expectedSnapshotBundleSha256),
      options.worktreeRoots,
      {
        aclPlatform: options.aclPlatform,
        privateAclAdapter: options.privateAclAdapter,
      },
    ),
    'SNAPSHOT_BASELINE_REJECTED',
  );
  let metadata;
  let baseline;
  try {
    metadata = JSON.parse(privateBundle.files.get('metadata/snapshot.json'));
    baseline = JSON.parse(privateBundle.files.get('database/pre-f27-baseline.json'));
  } catch (_) {
    fail('SNAPSHOT_BASELINE_REJECTED');
  }
  const expectedBaseline = stable({
    allowed_boundary_function_count: 2,
    f27_outbox_column_count: 0,
    f27_outbox_constraint_count: 0,
    f27_outbox_index_count: 0,
    f27_outbox_trigger_count: 0,
    f27_table_count: 0,
    unexpected_f27_function_count: 0,
  });
  if (!metadata
      || metadata.release_sha !== options.releaseSha
      || metadata.migration_sha256 !== options.migrationSha256
      || metadata.project_ref !== options.projectRef
      || metadata.database !== options.database
      || JSON.stringify(stable(baseline)) !== JSON.stringify(expectedBaseline)) {
    fail('SNAPSHOT_BASELINE_MISMATCH');
  }
  return clean(options.expectedSnapshotBundleSha256);
}

function safeProcessEnv(connectionEnv) {
  const names = ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP'];
  const env = {};
  for (const name of names) if (process.env[name] != null) env[name] = process.env[name];
  return { ...env, ...connectionEnv };
}

function defaultPsqlAdapter(psqlPath = 'psql') {
  return {
    run(args, env, cwd, input) {
      return spawnSync(psqlPath, args, {
        cwd,
        env: safeProcessEnv(env),
        input,
        encoding: null,
        windowsHide: true,
        timeout: 15 * 60_000,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    },
  };
}

function writePrivateTranscript(outputDir, payload) {
  const bytes = Buffer.from(stableJson(payload), 'utf8');
  const hash = sha256(bytes);
  const target = path.join(outputDir, `f27-migration-apply-${hash}.transcript`);
  try {
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(target, 0o400);
    const readback = fs.readFileSync(target);
    if (!readback.equals(bytes) || sha256(readback) !== hash) fail('PRIVATE_TRANSCRIPT_READBACK_FAILED');
  } catch (error) {
    if (error instanceof MigrationApplyError) throw error;
    fail('PRIVATE_TRANSCRIPT_WRITE_FAILED');
  }
  return { hash, byteLength: bytes.length };
}

function applyMigration(options) {
  if (!options || options.confirmation !== CONFIRMATION) fail('CONFIRMATION_REQUIRED');
  const releaseSha = clean(options.releaseSha);
  const expectedHash = clean(options.expectedMigrationSha256);
  assertRelease(releaseSha, options.releaseInfo || releaseInfo(options.repoRoot || REPO_ROOT));
  const repoRoot = options.repoRoot || REPO_ROOT;
  let migrationBytes = options.migrationBytes;
  if (!migrationBytes) {
    try { migrationBytes = fs.readFileSync(path.join(repoRoot, MIGRATION_RELATIVE_PATH)); }
    catch (_) { fail('MIGRATION_READ_FAILED'); }
  }
  migrationBytes = Buffer.from(migrationBytes);
  assertMigration(migrationBytes, expectedHash);
  const connectionEnv = boundaryCall(() => parseDatabaseUrl(
    options.databaseUrl,
    clean(options.projectRef),
    clean(options.database),
  ), 'DATABASE_BINDING_FAILED');
  const worktrees = options.worktreeRoots || discoverWorktrees(repoRoot);
  const snapshotBundleSha256 = assertSnapshotBaseline({
    snapshotBundle: options.snapshotBundle,
    expectedSnapshotBundleSha256: options.expectedSnapshotBundleSha256,
    worktreeRoots: worktrees,
    releaseSha,
    migrationSha256: expectedHash,
    projectRef: clean(options.projectRef),
    database: clean(options.database),
    aclPlatform: options.aclPlatform,
    privateAclAdapter: options.privateAclAdapter,
  });
  const outputDir = boundaryCall(
    () => assertPrivateEmptyOutput(options.outputDir, worktrees),
    'PRIVATE_OUTPUT_REJECTED',
  );
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const args = [
    '-X', '--quiet', '--set=ON_ERROR_STOP=1',
    '--file=-',
  ];
  assertRelease(
    releaseSha,
    options.preSpawnReleaseInfo || options.releaseInfo || releaseInfo(repoRoot),
  );
  let result;
  try { result = adapter.run(args, connectionEnv, repoRoot, migrationBytes); }
  catch (_) { result = { status: null, signal: null, error: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; }
  const transcript = writePrivateTranscript(outputDir, {
    format: 'syncview-f27-migration-apply-transcript-v1',
    release_sha: releaseSha,
    migration_sha256: expectedHash,
    snapshot_bundle_sha256: snapshotBundleSha256,
    psql_exit_status: Number.isInteger(result && result.status) ? result.status : null,
    psql_signal: clean(result && result.signal) || null,
    stdout_base64: Buffer.from(result && result.stdout || '').toString('base64'),
    stderr_base64: Buffer.from(result && result.stderr || '').toString('base64'),
  });
  const receipt = {
    private_transcript_sha256: transcript.hash,
    private_transcript_byte_length: transcript.byteLength,
    migration_sha256: expectedHash,
    snapshot_bundle_sha256: snapshotBundleSha256,
    release_sha: releaseSha,
  };
  if (!result || result.error || result.status !== 0) fail('PSQL_MIGRATION_FAILED', receipt);
  return {
    status: 'PASS',
    ...receipt,
    psql_exit_status: 0,
    migration_transaction_and_self_probe: 'PASS',
  };
}

function parseArgs(argv) {
  const allowed = new Set([
    '--output-dir', '--confirm-project-ref', '--confirm-database', '--release-sha',
    '--expected-migration-sha256', '--snapshot-bundle', '--expected-snapshot-bundle-sha256', '--psql',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(values, key)) fail('ARGUMENT_REJECTED');
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_REJECTED');
    values[key] = value;
    index += 1;
  }
  for (const key of [
    '--output-dir', '--confirm-project-ref', '--confirm-database', '--release-sha',
    '--expected-migration-sha256', '--snapshot-bundle', '--expected-snapshot-bundle-sha256',
  ]) {
    if (!values[key]) fail('ARGUMENT_REJECTED');
  }
  return {
    outputDir: values['--output-dir'],
    projectRef: values['--confirm-project-ref'],
    database: values['--confirm-database'],
    releaseSha: values['--release-sha'],
    expectedMigrationSha256: values['--expected-migration-sha256'],
    snapshotBundle: values['--snapshot-bundle'],
    expectedSnapshotBundleSha256: values['--expected-snapshot-bundle-sha256'],
    psqlPath: values['--psql'] || 'psql',
  };
}

function publicFailure(error) {
  const safe = error instanceof MigrationApplyError ? error : new MigrationApplyError('UNEXPECTED_FAILURE');
  return { status: 'FAIL', code: safe.code, ...(safe.receipt || {}) };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = applyMigration({
      ...args,
      databaseUrl: process.env.F27_DATABASE_URL,
      confirmation: clean(process.env.F27_CONFIRM_APPLY_MIGRATION),
    });
    process.stdout.write(`${JSON.stringify(result)}${os.EOL}`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIRMATION,
  MIGRATION_RELATIVE_PATH,
  MigrationApplyError,
  applyMigration,
  assertMigration,
  assertSnapshotBaseline,
  parseArgs,
  publicFailure,
  sha256,
};
