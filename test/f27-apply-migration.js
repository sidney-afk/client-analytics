'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONFIRMATION,
  MigrationApplyError,
  applyMigration,
  parseArgs,
  publicFailure,
  sha256,
} = require('../scripts/f27-apply-migration.js');
const {
  WINDOWS_PRIVATE_ACL_FORMAT,
  sealBundle,
} = require('../scripts/f27-mirror-outbox-snapshot.js');

let failures = 0;
function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}
function code(fn, expected) {
  try { fn(); return false; } catch (error) { return error instanceof MigrationApplyError && error.code === expected; }
}

const ACL_USER_SID = 'S-1-5-21-111-222-333-1001';
function aclAdapter(overrides = {}) {
  const calls = [];
  return {
    calls,
    run(action, target) {
      calls.push({ action, target });
      return {
        format: WINDOWS_PRIVATE_ACL_FORMAT,
        action,
        path_kind: 'file',
        current_user_sid: ACL_USER_SID,
        owner_sid: ACL_USER_SID,
        allowed_sids: [ACL_USER_SID, 'S-1-5-18', 'S-1-5-32-544'].sort(),
        access_rule_count: 3,
        access_rules_protected: true,
        unexpected_access_rule_count: 0,
        deny_rule_count: 0,
        current_user_full_control: true,
        ...overrides,
      };
    },
  };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-apply-migration-'));
const privateRoot = path.join(root, 'private');
const worktree = path.join(root, 'worktree');
fs.mkdirSync(privateRoot, { mode: 0o700 });
fs.mkdirSync(worktree, { mode: 0o700 });
const migration = Buffer.from([
  'begin;',
  'savepoint f27_enqueue_probe;',
  "select 'synthetic TEST enqueue';",
  'rollback to savepoint f27_enqueue_probe;',
  'commit;',
  '',
].join('\n'));
const migrationHash = sha256(migration);
const releaseSha = 'a'.repeat(40);
const projectRef = 'abcdefghijklmnopqrst';
const databaseUrl = `postgresql://postgres:private-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=require`;
const baseline = {
  allowed_boundary_function_count: 2,
  f27_outbox_column_count: 0,
  f27_outbox_constraint_count: 0,
  f27_outbox_index_count: 0,
  f27_outbox_trigger_count: 0,
  f27_table_count: 0,
  unexpected_f27_function_count: 0,
};
const snapshotFiles = new Map([
  ['database/mirror_outbox.rows.jsonl', Buffer.alloc(0)],
  ['database/mirror_outbox.preinstall-column-projection.json', Buffer.from('[]\n')],
  ['database/pre-f27-baseline.json', Buffer.from(`${JSON.stringify(baseline)}\n`)],
  ['database/runtime-safety-state.json', Buffer.from('{}\n')],
  ['metadata/snapshot.json', Buffer.from(`${JSON.stringify({
    release_sha: releaseSha,
    migration_sha256: migrationHash,
    project_ref: projectRef,
    database: 'postgres',
  })}\n`)],
]);
const sealedSnapshot = sealBundle(snapshotFiles, { snapshot_time: '2026-07-22T00:00:00.000Z' });
const snapshotBundle = path.join(privateRoot, 'snapshot.bundle.json');
fs.writeFileSync(snapshotBundle, sealedSnapshot.bundleBytes, { flag: 'wx', mode: 0o600 });
fs.chmodSync(snapshotBundle, 0o400);

function privateDir(name) {
  const value = path.join(privateRoot, name);
  fs.mkdirSync(value, { mode: 0o700 });
  return value;
}

function options(outputDir, adapter, overrides = {}) {
  return {
    confirmation: CONFIRMATION,
    outputDir,
    projectRef,
    database: 'postgres',
    databaseUrl,
    releaseSha,
    expectedMigrationSha256: migrationHash,
    snapshotBundle,
    expectedSnapshotBundleSha256: sealedSnapshot.bundleSha256,
    releaseInfo: { head: releaseSha, originMain: releaseSha, dirty: false },
    migrationBytes: migration,
    repoRoot: worktree,
    worktreeRoots: [worktree],
    psqlAdapter: adapter,
    aclPlatform: 'linux',
    ...overrides,
  };
}

try {
  let call;
  const successDir = privateDir('success');
  const result = applyMigration(options(successDir, {
    run(args, env, cwd, input) {
      call = { args, env, cwd, input };
      return { status: 0, stdout: Buffer.from('private synthetic output'), stderr: Buffer.alloc(0) };
    },
  }));
  ok(result.status === 'PASS'
      && result.migration_transaction_and_self_probe === 'PASS'
      && result.snapshot_bundle_sha256 === sealedSnapshot.bundleSha256
      && /^[a-f0-9]{64}$/.test(result.private_transcript_sha256),
  'successful psql completion yields only a hash-bound PASS receipt');
  ok(call.cwd === worktree
      && call.args.includes('-X')
      && call.args.includes('--set=ON_ERROR_STOP=1')
      && call.args.includes('--file=-')
      && Buffer.isBuffer(call.input)
      && call.input.equals(migration)
      && !call.args.includes('--single-transaction')
      && !JSON.stringify(call.args).includes('private-password'),
  'the exact already-hashed migration bytes stream to psql and own their transaction without exposing the database secret');
  ok(call.env.PGHOST === `db.${projectRef}.supabase.co`
      && call.env.PGSSLMODE === 'require'
      && call.env.PGPASSWORD === 'private-password',
  'psql receives only the exact project-bound TLS connection through its private environment');
  const files = fs.readdirSync(successDir);
  const transcript = fs.readFileSync(path.join(successDir, files[0]));
  ok(files.length === 1
      && sha256(transcript) === result.private_transcript_sha256
      && transcript.includes(Buffer.from('private synthetic output')) === false,
  'private transcript is content-addressed and stores psql bytes only as non-stdout base64');
  ok(!JSON.stringify(result).includes('private synthetic output')
      && !JSON.stringify(result).includes('private-password')
      && !JSON.stringify(result).includes(successDir),
  'public success receipt omits transcript body, credential, and private path');

  const safeAcl = aclAdapter();
  const aclPsql = { run() { return { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }; } };
  const aclReceipt = applyMigration(options(privateDir('windows-acl-safe'), aclPsql, {
    aclPlatform: 'win32', privateAclAdapter: safeAcl,
  }));
  ok(aclReceipt.status === 'PASS'
      && safeAcl.calls.length === 1
      && safeAcl.calls[0].action === 'verify-file'
      && safeAcl.calls[0].target === path.resolve(snapshotBundle),
  'migration apply proves the sealed snapshot Windows ACL before reading its row bodies');

  const broadAcl = aclAdapter({ unexpected_access_rule_count: 1 });
  let broadAclPsqlCalled = false;
  ok(code(() => applyMigration(options(privateDir('windows-acl-broad'), {
    run() { broadAclPsqlCalled = true; },
  }, {
    aclPlatform: 'win32', privateAclAdapter: broadAcl,
  })), 'WINDOWS_PRIVATE_ACL_REQUIRED')
      && broadAcl.calls.length === 1
      && broadAclPsqlCalled === false,
  'a broad snapshot ACL refuses migration apply before database credentials reach psql');

  const failureDir = privateDir('failure');
  let failure;
  try {
    applyMigration(options(failureDir, {
      run() { return { status: 3, stdout: Buffer.alloc(0), stderr: Buffer.from('private row failure token=secret') }; },
    }));
  } catch (error) { failure = error; }
  const failureReceipt = JSON.stringify(publicFailure(failure));
  ok(failure && failure.code === 'PSQL_MIGRATION_FAILED'
      && /^[a-f0-9]{64}$/.test(failure.receipt.private_transcript_sha256)
      && !/private row|token=secret|failureDir/.test(failureReceipt),
  'migration failure remains aborted and emits only a private transcript hash');

  ok(code(() => applyMigration(options(privateDir('unconfirmed'), { run() {} }, { confirmation: '' })), 'CONFIRMATION_REQUIRED'),
    'missing exact owner-window confirmation refuses before psql');
  ok(code(() => applyMigration(options(privateDir('dirty'), { run() {} }, {
    releaseInfo: { head: releaseSha, originMain: releaseSha, dirty: true },
  })), 'DIRTY_SOURCE_REJECTED'), 'dirty source refuses before psql');
  ok(code(() => applyMigration(options(privateDir('wrong-main'), { run() {} }, {
    releaseInfo: { head: releaseSha, originMain: 'b'.repeat(40), dirty: false },
  })), 'RELEASE_SHA_MISMATCH'), 'HEAD must equal the independently fetched origin/main SHA');
  let preSpawnCalled = false;
  ok(code(() => applyMigration(options(privateDir('pre-spawn-drift'), {
    run() { preSpawnCalled = true; },
  }, {
    preSpawnReleaseInfo: { head: 'b'.repeat(40), originMain: releaseSha, dirty: false },
  })), 'RELEASE_SHA_MISMATCH') && preSpawnCalled === false,
  'release identity is rechecked immediately before the verified migration bytes reach psql');
  ok(code(() => applyMigration(options(privateDir('wrong-hash'), { run() {} }, {
    expectedMigrationSha256: 'b'.repeat(64),
  })), 'MIGRATION_HASH_MISMATCH'), 'operator-provided migration hash must match exact bytes');
  ok(code(() => applyMigration(options(privateDir('wrong-snapshot-hash'), { run() {} }, {
    expectedSnapshotBundleSha256: 'b'.repeat(64),
  })), 'PRIVATE_BUNDLE_HASH_MISMATCH'), 'migration cannot run without the exact sealed pre-DDL snapshot bytes');
  const mismatchedSnapshotFiles = new Map(snapshotFiles);
  mismatchedSnapshotFiles.set('metadata/snapshot.json', Buffer.from(`${JSON.stringify({
    release_sha: 'b'.repeat(40),
    migration_sha256: migrationHash,
    project_ref: projectRef,
    database: 'postgres',
  })}\n`));
  const mismatchedSealed = sealBundle(mismatchedSnapshotFiles, { snapshot_time: '2026-07-22T00:00:00.000Z' });
  const mismatchedBundle = path.join(privateRoot, 'mismatched.bundle.json');
  fs.writeFileSync(mismatchedBundle, mismatchedSealed.bundleBytes, { flag: 'wx', mode: 0o600 });
  fs.chmodSync(mismatchedBundle, 0o400);
  ok(code(() => applyMigration(options(privateDir('wrong-snapshot-release'), { run() {} }, {
    snapshotBundle: mismatchedBundle,
    expectedSnapshotBundleSha256: mismatchedSealed.bundleSha256,
  })), 'SNAPSHOT_BASELINE_MISMATCH'), 'snapshot release, migration, project, and database binders must match the install target');
  ok(code(() => applyMigration(options(privateDir('missing-probe'), { run() {} }, {
    migrationBytes: Buffer.from('begin;\ncommit;\n'),
    expectedMigrationSha256: sha256(Buffer.from('begin;\ncommit;\n')),
  })), 'MIGRATION_SELF_PROBE_MISSING'), 'migration without its savepoint self-probe cannot run');
  ok(code(() => applyMigration(options(worktree, { run() {} })), 'WORKTREE_PATH_REJECTED'),
    'private transcript output inside a Git worktree is rejected');

  let argsRejected = false;
  try { parseArgs(['--output-dir', privateRoot, '--output-dir', privateRoot]); }
  catch (error) { argsRejected = error && error.code === 'ARGUMENT_REJECTED'; }
  ok(argsRejected, 'duplicate or incomplete operator arguments fail closed');
} finally {
  fs.chmodSync(root, 0o700);
  fs.rmSync(root, { recursive: true, force: true });
}

if (failures) process.exit(1);
console.log('F27 migration apply checks passed');
