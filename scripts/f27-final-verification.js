#!/usr/bin/env node
'use strict';

/*
 * F27 packaged final verifier.
 *
 * `capture-baseline` is a pre-DDL, read-only capture. It seals only hashes,
 * byte lengths, counts, versions, JWT posture, and source/entrypoint
 * fingerprints. It never stores database rows, workflow bodies, source bytes,
 * project refs, credentials, private paths, or provider response bodies.
 *
 * `verify` is the Section 6 read-only terminal. It performs a database safety
 * bookend around GET-only provider/n8n/reconciler/freshness reads and emits
 * exactly one bounded, public-safe JSON PASS or FAIL receipt.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const {
  assertPrivateBundle,
  parseDatabaseUrl,
  parseDisposableDatabaseUrl,
  parsePostTranscript,
  postContract,
  protectWindowsPrivateDirectory,
  assertWindowsPrivateFileAcl,
  safePsqlEnvironment,
  verifyAfterSql,
} = require('./f27-mirror-outbox-snapshot.js');
const {
  assertCaptureProviderContract,
  closureFingerprint,
  loadCapture,
} = require('./f27-edge-source-rollback-lib.js');
const {
  postgresJsonbStringify,
} = require('./f27-drill-runner.js');
const {
  gitChildEnvironment,
  unpackBundle: unpackReconcilerBundle,
  validateRecentRunWindow,
} = require('./f27-reconciler-closure.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const MIGRATION_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const FORMAT = 'syncview-f27-final-verification-baseline-v1';
const SEALED_FORMAT = `${FORMAT}-sealed`;
const HASH_RE = /^[0-9a-f]{64}$/;
const SHA_RE = /^[0-9a-f]{40}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const DRILL_TEAM = '__f27_drill__';
const MAX_RECEIPT_BYTES = 12 * 1024;
const MAX_BASELINE_BYTES = 4 * 1024 * 1024;
const EXPECTED_FLAGS = Object.freeze({
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
});
const PINNED_INBOUND_SLUG = 'linear-inbound';
const SECTION4_SLUGS = Object.freeze([
  'batch-write',
  'deliverable-write',
  'linear-outbound',
  'production-write',
]);
const FROZEN_WRITER_SLUGS = Object.freeze([
  'calendar-upsert',
  'sample-review-upsert',
]);
const RECONCILER_WORKFLOW_PATH = '.github/workflows/linear-deliverables-reconcile.yml';
const RECONCILER_WORKFLOW_API_ID = 'linear-deliverables-reconcile.yml';
const TRUSTED_GITHUB_REPOSITORY = 'sidney-afk/client-analytics';
const RECONCILER_SCAN_DELAY_MS = 2000;
const REVIEWED_SUPABASE_CLI_VERSION = '2.109.0';
const MAX_FUTURE_FRESHNESS_SKEW_MS = 5 * 60 * 1000;
const RECONCILER_CLOSURE_PATHS = Object.freeze([
  '.github/workflows/linear-deliverables-reconcile.yml',
  'package.json',
  'scripts/b3-linkage-backfill.js',
  'scripts/f200-attribution-plan.js',
  'scripts/f200-attribution.js',
  'scripts/linear-deliverables-reconcile-lib.js',
  'scripts/linear-deliverables-reconcile.js',
  'scripts/linear-reconcile-inbound-pager.js',
  'scripts/prod-authority-guard.js',
]);
const NONTERMINAL_RUN_STATUSES = Object.freeze([
  'queued', 'in_progress', 'waiting', 'pending', 'requested',
]);
const PUBLIC_MESSAGES = Object.freeze({
  F27_FINAL_ARGUMENT_REJECTED: 'The final-verifier arguments were incomplete or outside the reviewed contract.',
  F27_FINAL_CONFIRMATION_REQUIRED: 'The exact final-verifier confirmation was not supplied.',
  F27_FINAL_RELEASE_MISMATCH: 'The verifier release or migration binding did not match.',
  F27_FINAL_ARTIFACT_INVALID: 'A sealed private input failed its exact hash, byte, inventory, or release binding.',
  F27_FINAL_BASELINE_INVALID: 'The sealed final-verification baseline was malformed or mismatched.',
  F27_FINAL_DATABASE_IDENTITY_MISMATCH: 'The confirmed database identity did not match the sealed baseline.',
  F27_FINAL_TRANSACTION_NOT_READ_ONLY: 'The database proof was not repeatable-read and read-only.',
  F27_FINAL_RUNTIME_FLAGS_DRIFT: 'The authority, outbound, or parity flags were not exact and unchanged.',
  F27_FINAL_FLAG_FLIPS_DRIFT: 'The flag-flip ledger changed during the install window.',
  F27_FINAL_PREEXISTING_QUEUE_DRIFT: 'The pre-DDL old-column queue projection changed.',
  F27_FINAL_UNEXPECTED_QUEUE_ROW: 'The only permitted queue addition was not one exact completed reserved-drill row.',
  F27_FINAL_FENCES_DRIFT: 'The two F27 team fences changed.',
  F27_FINAL_POST_CONTRACT_DRIFT: 'The installed F27 schema and grant contract did not match exact source.',
  F27_FINAL_OPEN_ROLLBACK_PRESENT: 'An open real-team or reserved-drill rollback exists.',
  F27_FINAL_REAL_ROLLBACK_PRESENT: 'A real-team rollback or intent exists.',
  F27_FINAL_REPLAY_ELIGIBLE: 'An F27 replay remains eligible instead of dormant.',
  F27_FINAL_DRILL_AUDIT_INVALID: 'The retained reserved-drill terminal audit is not exact.',
  F27_FINAL_CLIENTS_DRIFT: 'The full clients table changed during the window.',
  F27_FINAL_TEAM_MEMBERS_DRIFT: 'The full team_members table changed during the window.',
  F27_FINAL_DATABASE_BOOKEND_DRIFT: 'Database state changed while the final external readbacks ran.',
  F27_FINAL_PINNED_INBOUND_DRIFT: 'The active linear-inbound provider closure differs from the sealed pinned baseline.',
  F27_FINAL_SECTION4_SOURCE_DRIFT: 'A Section 4 function differs from the reviewed release closure.',
  F27_FINAL_FROZEN_WRITER_DRIFT: 'A frozen writer source, entrypoint, JWT posture, status, or active version changed.',
  F27_FINAL_PROVIDER_UNSTABLE_READ: 'Provider metadata or source changed during version-stable readback.',
  F27_FINAL_N8N_INVENTORY_DRIFT: 'The complete n8n semantic workflow inventory changed.',
  F27_FINAL_N8N_UNSTABLE_READ: 'The n8n workflow inventory changed while it was being read.',
  F27_FINAL_RECONCILER_DRIFT: 'The reconciler closure, disabled posture, or quiescence proof changed.',
  F27_FINAL_RECONCILER_IN_FLIGHT: 'The reconciler has a nonterminal run or is not mechanically disabled.',
  F27_FINAL_INBOUND_NOT_FRESH: 'Linear inbound freshness did not pass the reviewed safety margin.',
  F27_FINAL_NETWORK_METHOD_FORBIDDEN: 'A read-only adapter reported a non-GET network method.',
  F27_FINAL_PRIVATE_WRITE_FAILED: 'The sealed final baseline could not be written and independently read back.',
  F27_FINAL_UNEXPECTED_FAILURE: 'The final verifier failed closed.',
});

class FinalVerificationError extends Error {
  constructor(code, stage = 'verify') {
    super(PUBLIC_MESSAGES[code] || PUBLIC_MESSAGES.F27_FINAL_UNEXPECTED_FAILURE);
    this.name = 'FinalVerificationError';
    this.code = code;
    this.stage = stage;
  }
}

function reject(code, stage) {
  throw new FinalVerificationError(code, stage);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
  }
  return value;
}

function stable(value) {
  return JSON.stringify(canonicalValue(value));
}

function stablePretty(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

function exact(left, right) {
  return stable(left) === stable(right);
}

function hashRows(rows) {
  const ordered = [...rows].sort((left, right) => {
    const a = stable(left);
    const b = stable(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { count: ordered.length, sha256: sha256(Buffer.from(stable(ordered), 'utf8')) };
}

function assertHash(value, code = 'F27_FINAL_ARGUMENT_REJECTED', stage = 'arguments') {
  if (!HASH_RE.test(clean(value))) reject(code, stage);
  return clean(value);
}

function assertSha(value, code = 'F27_FINAL_ARGUMENT_REJECTED', stage = 'arguments') {
  if (!SHA_RE.test(clean(value))) reject(code, stage);
  return clean(value);
}

function assertPositiveBytes(value, code = 'F27_FINAL_ARGUMENT_REJECTED') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 134217728) reject(code, 'arguments');
  return number;
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  const accepted = new Set([
    'output-dir', 'baseline', 'baseline-sha256', 'release-sha', 'project-ref',
    'database', 'snapshot-bundle', 'snapshot-sha256', 'pinned-inbound-bundle',
    'pinned-inbound-sha256', 'prior-four-bundle', 'prior-four-sha256',
    'prior-four-byte-length', 'reconciler-capture', 'reconciler-capture-sha256',
    'reconciler-release-sha', 'reconciler-closure-sha256',
    'expected-post-contract-sha256', 'n8n-origin-sha256', 'adapter-module',
    'n8n-read-scope', 'psql', 'postgres-proof',
  ]);
  let command = '';
  for (const token of argv) {
    if (!command && !token.startsWith('--')) {
      command = token;
      continue;
    }
    if (!token.startsWith('--')) reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    if (!accepted.has(name) || Object.prototype.hasOwnProperty.call(options, name)) {
      reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
    }
    if (name === 'postgres-proof') {
      if (equals !== -1) reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
      options[name] = true;
      continue;
    }
    if (equals === -1 || !token.slice(equals + 1)) reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
    options[name] = token.slice(equals + 1);
  }
  if (!['capture-baseline', 'verify'].includes(command)) {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
  }
  const required = [
    'release-sha', 'project-ref', 'database', 'snapshot-bundle', 'snapshot-sha256',
    'pinned-inbound-bundle', 'pinned-inbound-sha256', 'prior-four-bundle',
    'prior-four-sha256', 'prior-four-byte-length', 'reconciler-capture',
    'reconciler-capture-sha256', 'reconciler-release-sha',
    'reconciler-closure-sha256', 'expected-post-contract-sha256',
    'n8n-origin-sha256', 'n8n-read-scope',
  ];
  if (required.some(name => !options[name])) reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
  if (command === 'capture-baseline' && (!options['output-dir']
      || options.baseline || options['baseline-sha256'])) {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
  }
  if (command === 'verify' && (!options.baseline || !options['baseline-sha256']
      || options['output-dir'])) {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
  }
  if (options['n8n-read-scope'] !== 'CONFIRMED_INSTANCE_WIDE_WORKFLOW_READ') {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'arguments');
  }
  return {
    command,
    outputDir: options['output-dir'],
    baselinePath: options.baseline,
    baselineSha256: options['baseline-sha256'],
    releaseSha: assertSha(options['release-sha']),
    projectRef: clean(options['project-ref']),
    database: clean(options.database),
    snapshotBundle: options['snapshot-bundle'],
    snapshotSha256: assertHash(options['snapshot-sha256']),
    pinnedInboundBundle: options['pinned-inbound-bundle'],
    pinnedInboundSha256: assertHash(options['pinned-inbound-sha256']),
    priorFourBundle: options['prior-four-bundle'],
    priorFourSha256: assertHash(options['prior-four-sha256']),
    priorFourByteLength: assertPositiveBytes(options['prior-four-byte-length']),
    reconcilerCapture: options['reconciler-capture'],
    reconcilerCaptureSha256: assertHash(options['reconciler-capture-sha256']),
    reconcilerReleaseSha: assertSha(options['reconciler-release-sha']),
    reconcilerClosureSha256: assertHash(options['reconciler-closure-sha256']),
    expectedPostContractSha256: assertHash(options['expected-post-contract-sha256']),
    n8nOriginSha256: assertHash(options['n8n-origin-sha256']),
    n8nReadScope: 'INSTANCE_WIDE',
    adapterModule: options['adapter-module'],
    psqlPath: options.psql || 'psql',
    postgresProof: options['postgres-proof'] === true,
  };
}

function publicFailure(error) {
  const safe = error instanceof FinalVerificationError
    ? error
    : new FinalVerificationError('F27_FINAL_UNEXPECTED_FAILURE', 'internal');
  return {
    status: 'FAIL',
    stage: safe.stage,
    code: safe.code,
    message: safe.message,
  };
}

function boundedReceipt(value) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8');
  if (bytes.length > MAX_RECEIPT_BYTES) {
    return publicFailure(new FinalVerificationError('F27_FINAL_UNEXPECTED_FAILURE', 'receipt'));
  }
  return value;
}

function releaseBinding(args, { allowDirty = false } = {}) {
  let head;
  let originMain;
  let dirty;
  let migrationBytes;
  const gitEnv = gitChildEnvironment();
  try {
    head = clean(execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv,
    }));
    originMain = clean(execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'origin/main'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv,
    }));
    dirty = Boolean(clean(execFileSync('git', [
      '-C', REPO_ROOT, 'status', '--porcelain=v1', '--untracked-files=all',
    ], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], env: gitEnv,
    })));
    migrationBytes = execFileSync('git', ['-C', REPO_ROOT, 'show', `${args.releaseSha}:${MIGRATION_PATH}`], {
      encoding: null, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024, env: gitEnv,
    });
  } catch (_) {
    reject('F27_FINAL_RELEASE_MISMATCH', 'release');
  }
  if (head !== args.releaseSha || (!args.postgresProof && originMain !== args.releaseSha)
      || (dirty && !allowDirty)) {
    reject('F27_FINAL_RELEASE_MISMATCH', 'release');
  }
  return {
    releaseSha: args.releaseSha,
    migrationSha256: sha256(migrationBytes),
  };
}

function identityBindings(projectRef, database, n8nOriginSha256, n8nReadScope) {
  if (!PROJECT_REF_RE.test(projectRef)
      || !/^[A-Za-z_][A-Za-z0-9_$-]{0,62}$/.test(database)
      || !HASH_RE.test(clean(n8nOriginSha256))
      || n8nReadScope !== 'INSTANCE_WIDE') {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'identity');
  }
  return {
    projectIdentitySha256: sha256(Buffer.from(projectRef, 'utf8')),
    databaseIdentitySha256: sha256(Buffer.from(`${projectRef}\0${database}`, 'utf8')),
    n8nOriginSha256: clean(n8nOriginSha256),
    n8nReadScope,
  };
}

function privateRegularFile(
  file,
  expectedHash,
  expectedBytes = null,
  { testMode = false, aclOptions = {} } = {},
) {
  if (!path.isAbsolute(file)) reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  let stat;
  let bytes;
  let resolved;
  try {
    stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not regular');
    resolved = fs.realpathSync.native(file);
    bytes = fs.readFileSync(file);
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  }
  const normalized = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  for (const root of registeredWorktrees()) {
    let realRoot;
    try { realRoot = fs.realpathSync.native(root); }
    catch (_) { reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts'); }
    if (process.platform === 'win32') realRoot = realRoot.toLowerCase();
    const relative = path.relative(realRoot, normalized);
    if (relative === '' || (!path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
      reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
    }
  }
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  }
  if (!testMode) {
    try { assertWindowsPrivateFileAcl(resolved, aclOptions); }
    catch (_) { reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts'); }
  }
  if (bytes.length > 134217728 || sha256(bytes) !== expectedHash
      || (expectedBytes !== null && bytes.length !== expectedBytes)) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  }
  return { bytes, byteLength: bytes.length, sha256: expectedHash };
}

function registeredWorktrees() {
  let output;
  try {
    output = execFileSync('git', ['-C', REPO_ROOT, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
      env: gitChildEnvironment(),
    });
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  }
  const roots = String(output).split(/\r?\n/)
    .filter(line => line.startsWith('worktree '))
    .map(line => line.slice('worktree '.length).trim())
    .filter(Boolean);
  if (!roots.length) reject('F27_FINAL_ARTIFACT_INVALID', 'artifacts');
  return roots;
}

function loadSnapshot(args, release, { testMode = false } = {}) {
  let loaded;
  try {
    loaded = assertPrivateBundle(
      args.snapshotBundle,
      args.snapshotSha256,
      registeredWorktrees(),
      testMode ? { aclPlatform: 'linux' } : {},
    );
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'snapshot');
  }
  let projection;
  let rows;
  let runtime;
  let metadata;
  try {
    projection = JSON.parse(loaded.files.get('database/mirror_outbox.preinstall-column-projection.json'));
    rows = loaded.files.get('database/mirror_outbox.rows.jsonl').toString('utf8')
      .split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    runtime = JSON.parse(loaded.files.get('database/runtime-safety-state.json'));
    metadata = JSON.parse(loaded.files.get('metadata/snapshot.json'));
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'snapshot');
  }
  if (!Array.isArray(projection) || !projection.length || projection[0] !== 'id'
      || !projection.includes('team')
      || new Set(projection).size !== projection.length
      || projection.some(name => !/^[a-z_][a-z0-9_]*$/.test(name))
      || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))
      || rows.some(row => row.team === DRILL_TEAM)
      || !runtime || !exact(runtime.flags, EXPECTED_FLAGS)
      || !Number.isSafeInteger(Number(runtime.flag_flips_count))
      || Number(runtime.flag_flips_count) < 0) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'snapshot');
  }
  if (!metadata || metadata.release_sha !== args.releaseSha
      || metadata.project_ref !== args.projectRef || metadata.database !== args.database
      || metadata.migration_path !== MIGRATION_PATH
      || metadata.migration_sha256 !== release.migrationSha256) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'snapshot');
  }
  return {
    projection,
    queue: hashRows(rows),
    runtime,
    byteLength: loaded.bytes.length,
  };
}

function sourceCaptureSummary(
  file,
  expectedHash,
  expectedSlugs,
  expectedBytes = null,
  { projectRef, testMode = false } = {},
) {
  const artifact = privateRegularFile(
    file,
    expectedHash,
    expectedBytes,
    { testMode },
  );
  let capture;
  try {
    capture = loadCapture(file, { expectedBundleSha256: expectedHash });
    assertCaptureProviderContract(capture, {
      projectRef,
      cliVersion: REVIEWED_SUPABASE_CLI_VERSION,
    });
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'source-bundle');
  }
  const slugs = capture.functions.map(item => item.slug).sort();
  const wanted = [...expectedSlugs].sort();
  if (!exact(slugs, wanted)
      || capture.functions.some(item =>
        !/^[1-9][0-9]*$/.test(clean(item && item.manifest && item.manifest.captured_version)))) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'source-bundle');
  }
  return {
    byteLength: artifact.byteLength,
    sha256: expectedHash,
    aggregateSourceSha256: capture.manifest.aggregate_source_sha256,
    functions: Object.fromEntries(capture.functions.map(item => [item.slug, {
      slug: item.slug,
      version: String(item.manifest.captured_version),
      status: 'ACTIVE',
      verifyJwt: item.manifest.verify_jwt,
      sourceSha256: item.manifest.source_closure_sha256,
      entrypoint: item.manifest.entrypoint_path,
      entrypointSha256: sha256(Buffer.from(item.manifest.entrypoint_path, 'utf8')),
      fileCount: item.files.size,
    }])),
  };
}

function functionSummary(raw, slug) {
  if (!raw || raw.slug !== slug || !raw.files
      || typeof raw.verifyJwt !== 'boolean' || !/^[1-9][0-9]*$/.test(clean(raw.version))
      || clean(raw.status).toUpperCase() !== 'ACTIVE' || !clean(raw.entrypointPath)) {
    reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  }
  let files;
  try {
    files = raw.files instanceof Map
      ? new Map([...raw.files].map(([file, bytes]) => [file, Buffer.from(bytes)]))
      : new Map(Object.entries(raw.files).map(([file, bytes]) => [file, Buffer.from(bytes)]));
  } catch (_) {
    reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  }
  if (!files.size || !files.has(raw.entrypointPath)) {
    reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  }
  return {
    slug,
    version: String(raw.version),
    status: 'ACTIVE',
    verifyJwt: raw.verifyJwt,
    sourceSha256: closureFingerprint(files),
    entrypoint: raw.entrypointPath,
    entrypointSha256: sha256(Buffer.from(raw.entrypointPath, 'utf8')),
    fileCount: files.size,
  };
}

async function stableProviderRead(provider, slug) {
  let first;
  let second;
  try {
    first = functionSummary(await provider.readFunction(slug), slug);
    second = functionSummary(await provider.readFunction(slug), slug);
  } catch (error) {
    if (error instanceof FinalVerificationError) throw error;
    reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  }
  if (!exact(first, second)) reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  return first;
}

function releaseExpectedFunctions(releaseSha) {
  let report;
  try {
    const output = execFileSync(process.execPath, [
      path.join(REPO_ROOT, 'scripts', 'ef-fingerprint.js'),
      releaseSha,
      `--slugs=${SECTION4_SLUGS.join(',')}`,
      '--format=json',
      '--expected-only',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 16 * 1024 * 1024,
      env: gitChildEnvironment(),
    });
    report = JSON.parse(output);
  } catch (_) {
    reject('F27_FINAL_RELEASE_MISMATCH', 'release-source');
  }
  if (!report || report.mode !== 'expected-only' || report.pinned_sha !== releaseSha
      || !Array.isArray(report.results) || report.results.length !== SECTION4_SLUGS.length) {
    reject('F27_FINAL_RELEASE_MISMATCH', 'release-source');
  }
  return Object.fromEntries(report.results.map(row => [row.slug, {
    slug: row.slug,
    verifyJwt: false,
    sourceSha256: row.expected_fingerprint,
    entrypoint: row.expected_entrypoint,
    entrypointSha256: sha256(Buffer.from(row.expected_entrypoint, 'utf8')),
    fileCount: Number(row.expected_files),
  }]));
}

async function expectedReleaseFunctions(provider, releaseSha) {
  if (provider && typeof provider.readReleaseFunctions === 'function') {
    let value;
    try { value = await provider.readReleaseFunctions(SECTION4_SLUGS, releaseSha); }
    catch (_) { reject('F27_FINAL_RELEASE_MISMATCH', 'release-source'); }
    return value;
  }
  return releaseExpectedFunctions(releaseSha);
}

function workflowSemanticValue(raw) {
  if (!raw || !clean(raw.id) || !clean(raw.name) || typeof raw.active !== 'boolean'
      || !Array.isArray(raw.nodes) || !raw.connections || typeof raw.connections !== 'object') {
    reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
  }
  const nodeFields = [
    'id', 'name', 'type', 'typeVersion', 'position', 'parameters', 'credentials',
    'disabled', 'notes', 'notesInFlow', 'executeOnce', 'retryOnFail', 'maxTries',
    'waitBetweenTries', 'onError', 'alwaysOutputData', 'continueOnFail',
    'webhookId',
  ];
  const nodes = raw.nodes.map(node => Object.fromEntries(nodeFields
    .filter(field => Object.prototype.hasOwnProperty.call(node || {}, field))
    .map(field => [field, node[field]])))
    .sort((left, right) => clean(left.id).localeCompare(clean(right.id)));
  const tags = Array.isArray(raw.tags)
    ? raw.tags.map(tag => ({ id: clean(tag && tag.id), name: clean(tag && tag.name) }))
      .sort((a, b) => `${a.id}\0${a.name}`.localeCompare(`${b.id}\0${b.name}`))
    : [];
  return canonicalValue({
    id: clean(raw.id),
    name: clean(raw.name),
    active: raw.active,
    versionId: raw.versionId == null ? null : String(raw.versionId),
    activeVersionId: raw.activeVersionId == null ? null : String(raw.activeVersionId),
    nodes,
    connections: raw.connections,
    settings: raw.settings || {},
    pinData: raw.pinData || {},
    tags,
  });
}

async function collectN8nList(n8n) {
  const rows = [];
  const seenCursors = new Set();
  const seenIds = new Set();
  let cursor = null;
  for (let page = 0; page < 1000; page += 1) {
    let response;
    try { response = await n8n.listPage(cursor); }
    catch (_) { reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n'); }
    if (!response || !Array.isArray(response.data)) {
      reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
    }
    for (const row of response.data) {
      const id = clean(row && row.id);
      if (!id || seenIds.has(id) || typeof row.active !== 'boolean') {
        reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
      }
      seenIds.add(id);
      const version = n8nVersionIdentity(row);
      rows.push({
        id,
        active: row.active,
        ...version,
      });
    }
    if (!Object.prototype.hasOwnProperty.call(response, 'nextCursor')
        || (response.nextCursor !== null
          && (typeof response.nextCursor !== 'string'
            || !clean(response.nextCursor)))) {
      reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
    }
    const next = response.nextCursor === null ? '' : clean(response.nextCursor);
    if (!next) return rows.sort((a, b) => a.id.localeCompare(b.id));
    if (seenCursors.has(next)) reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
    seenCursors.add(next);
    cursor = next;
  }
  reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
}

function n8nVersionIdentity(raw) {
  const hasVersionId = Object.prototype.hasOwnProperty.call(raw || {}, 'versionId');
  const hasActiveVersionId = Object.prototype.hasOwnProperty.call(
    raw || {},
    'activeVersionId',
  );
  const versionId = hasVersionId && raw.versionId != null
    ? clean(raw.versionId) : '';
  const activeVersionId = hasActiveVersionId && raw.activeVersionId != null
    ? clean(raw.activeVersionId) : null;
  if (!hasVersionId || !versionId || !hasActiveVersionId
      || (raw.active === true && !activeVersionId)
      || (raw.active === false && activeVersionId !== null)) {
    reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
  }
  return { versionId, activeVersionId };
}

async function n8nInventory(n8n) {
  const before = await collectN8nList(n8n);
  const workflows = [];
  for (const row of before) {
    let detail;
    try { detail = await n8n.getWorkflow(row.id); }
    catch (_) { reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n'); }
    const detailVersion = n8nVersionIdentity(detail);
    const semantic = workflowSemanticValue(detail);
    if (semantic.id !== row.id || semantic.active !== row.active
        || detailVersion.versionId !== row.versionId
        || detailVersion.activeVersionId !== row.activeVersionId) {
      reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
    }
    workflows.push(semantic);
  }
  const after = await collectN8nList(n8n);
  if (!exact(before, after)) reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
  const ordered = workflows.sort((a, b) => a.id.localeCompare(b.id));
  return { count: ordered.length, sha256: sha256(Buffer.from(stable(ordered), 'utf8')) };
}

function framedClosureHash(releaseSha, files = RECONCILER_CLOSURE_PATHS) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) {
    let bytes;
    try {
      bytes = execFileSync('git', ['-C', REPO_ROOT, 'show', `${releaseSha}:${file}`], {
        encoding: null, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024, env: gitChildEnvironment(),
      });
    } catch (_) {
      reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
    }
    hash.update(`${Buffer.byteLength(file, 'utf8')}:`);
    hash.update(file, 'utf8');
    hash.update(`\n${bytes.length}:`);
    hash.update(bytes);
    hash.update('\n');
  }
  return hash.digest('hex');
}

async function reconcilerProof(reconciler, expected) {
  let first;
  let second;
  try {
    first = await reconciler.readState();
    if (typeof reconciler.betweenScans === 'function') {
      await reconciler.betweenScans();
    } else {
      await new Promise(resolve => setTimeout(resolve, RECONCILER_SCAN_DELAY_MS));
    }
    second = await reconciler.readState();
  }
  catch (_) { reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler'); }
  for (const state of [first, second]) {
    if (!state || state.workflowPath !== RECONCILER_WORKFLOW_PATH
        || state.workflowState !== 'disabled_manually'
        || Number(state.nonterminalRunCount) !== 0
        || !Array.isArray(state.recentRunWindow)) {
      reject('F27_FINAL_RECONCILER_IN_FLIGHT', 'reconciler');
    }
    try {
      validateRecentRunWindow({
        total_count: state.recentRunWindow.length,
        workflow_runs: state.recentRunWindow,
      });
    } catch (_) {
      reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
    }
    if (state.releaseSha !== expected.releaseSha
        || state.closureSha256 !== expected.closureSha256) {
      reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
    }
  }
  if (!exact(first, second)) reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
  return {
    workflowState: 'disabled_manually',
    nonterminalRunCount: 0,
    scanCount: 2,
    releaseSha: second.releaseSha,
    closureSha256: second.closureSha256,
  };
}

function normalizeTableHash(value, code, stage = 'database') {
  if (!value || !Number.isSafeInteger(Number(value.count)) || Number(value.count) < 0
      || !HASH_RE.test(clean(value.sha256))) reject(code, stage);
  return { count: Number(value.count), sha256: clean(value.sha256) };
}

function assertReadOnlyMetadata(state) {
  if (!state || !state.metadata
      || state.metadata.transactionIsolation !== 'repeatable read'
      || state.metadata.transactionReadOnly !== 'on') {
    reject('F27_FINAL_TRANSACTION_NOT_READ_ONLY', 'database');
  }
}

function validateBaselineDatabase(state, snapshot) {
  assertReadOnlyMetadata(state);
  if (!exact(state.flags, EXPECTED_FLAGS)) reject('F27_FINAL_RUNTIME_FLAGS_DRIFT', 'baseline-database');
  const queue = hashRows(state.projectedRows || []);
  if (!exact(queue, snapshot.queue)) reject('F27_FINAL_PREEXISTING_QUEUE_DRIFT', 'baseline-database');
  if (Number(state.flagFlips && state.flagFlips.count) !== Number(snapshot.runtime.flag_flips_count)) {
    reject('F27_FINAL_FLAG_FLIPS_DRIFT', 'baseline-database');
  }
  return {
    queue,
    flags: normalizeTableHash(state.flagsHash, 'F27_FINAL_RUNTIME_FLAGS_DRIFT'),
    flagFlips: normalizeTableHash(state.flagFlips, 'F27_FINAL_FLAG_FLIPS_DRIFT'),
    fences: normalizeTableHash(state.fences, 'F27_FINAL_FENCES_DRIFT'),
    clients: normalizeTableHash(state.clients, 'F27_FINAL_CLIENTS_DRIFT'),
    teamMembers: normalizeTableHash(state.teamMembers, 'F27_FINAL_TEAM_MEMBERS_DRIFT'),
  };
}

function exactDrillAudit(state) {
  const rollbacks = Array.isArray(state.rollbacks) ? state.rollbacks : [];
  const intents = Array.isArray(state.intents) ? state.intents : [];
  const rows = Array.isArray(state.fullRows) ? state.fullRows : [];
  const drillRows = rows.filter(row => row && row.team === DRILL_TEAM);
  if (rollbacks.length !== 1 || intents.length !== 1 || drillRows.length !== 1) {
    reject('F27_FINAL_DRILL_AUDIT_INVALID', 'database-drill');
  }
  const rollback = rollbacks[0];
  const intent = intents[0];
  const outbox = drillRows[0];
  const terminal = rollback && rollback.terminal_receipt;
  const replay = intent && intent.terminal_receipt;
  const history = intent && intent.classification_history;
  const rollbackId = clean(rollback && rollback.id);
  const outboxId = String(outbox && outbox.id);
  const rowHash = intent && intent.row_sha256;
  if (!intent || !intent.row_snapshot || typeof intent.row_snapshot !== 'object'
      || Array.isArray(intent.row_snapshot) || !HASH_RE.test(clean(rowHash))) {
    reject('F27_FINAL_DRILL_AUDIT_INVALID', 'database-drill');
  }
  const independentRowHash = sha256(Buffer.from(
    postgresJsonbStringify(intent.row_snapshot),
    'utf8',
  ));
  const expectedAuthority = { graphics: 'linear', video: 'linear' };
  const expectedOutbound = { mode: 'off' };
  const expectedParity = { enabled: false };
  const linearResult = outbox && outbox.linear_result;
  const expectedReplay = linearResult && typeof linearResult === 'object'
    ? {
      ...linearResult,
      linear_result_sha256: sha256(Buffer.from(postgresJsonbStringify(linearResult), 'utf8')),
    }
    : null;
  const exactScope = rollbackId
    && rollback.team === DRILL_TEAM && rollback.is_drill === true && rollback.state === 'complete'
    && rollback.fence_generation == null && Number(rollback.snapshot_count) === 1
    && rollback.snapshot_sha256 === sha256(Buffer.from(rowHash, 'utf8'))
    && exact(rollback.expected_authority, expectedAuthority)
    && exact(rollback.prior_outbound, expectedOutbound)
    && exact(rollback.prior_parity, expectedParity)
    && rollback.completed_at && terminal && terminal.type === 'f27_drill_terminal'
    && terminal.ok === true
    && clean(terminal.rollback_id) === rollbackId
    && clean(terminal.correlation_id) === clean(rollback.correlation_id)
    && terminal.team === DRILL_TEAM && terminal.is_drill === true
    && Number(terminal.snapshot_count) === 1
    && terminal.snapshot_sha256 === rollback.snapshot_sha256
    && Number(terminal.unclassified) === 0
    && Number(terminal.unreceipted_replays) === 0
    && Number(terminal.replay_intents) === 1
    && Number(terminal.exact_terminal_replays) === 1
    && Number(terminal.active_drill_rows) === 0
    && exact(terminal.authority_before, expectedAuthority)
    && exact(terminal.authority_after, expectedAuthority)
    && exact(terminal.normal_outbound, expectedOutbound)
    && exact(terminal.legacy_parity, expectedParity)
    && terminal.audit_history_retained === true
    && terminal.authority_cas === 'refused'
    && terminal.authority_cas_reason === 'f27_drill_authority_cas_refused'
    && clean(intent.rollback_id) === rollbackId && String(intent.outbox_id) === outboxId
    && intent.classification === 'replay'
    && intent.reason === 'reserved drill replay'
    && Array.isArray(history) && history.length === 1 && history[0].to === 'replay'
    && replay && replay.type === 'f27_drill_replay_terminal'
    && independentRowHash === rowHash
    && clean(intent.row_snapshot.id) === outboxId
    && intent.row_snapshot.team === DRILL_TEAM
    && intent.row_snapshot.client_slug === DRILL_TEAM
    && clean(intent.row_snapshot.f27_drill_rollback_id) === rollbackId
    && outbox.team === DRILL_TEAM && outbox.client_slug === DRILL_TEAM
    && outbox.test_only === true && outbox.legacy_parity === false
    && Number(outbox.authority_generation) === 0
    && clean(outbox.f27_drill_rollback_id) === rollbackId
    && outbox.entity === 'deliverable' && outbox.operation === 'status'
    && outbox.payload && outbox.payload.f27_drill === true
    && outbox.dedup_key === `f27-drill:${rollbackId}`
    && outbox.status === 'written' && outbox.lock_token == null && outbox.locked_at == null
    && linearResult && linearResult.ok === true
    && linearResult.type === 'f27_drill_replay_terminal'
    && linearResult.f27_drill === true && linearResult.f27_preflight === true
    && linearResult.no_external_call === true && linearResult.mutation === 'f27DrillNoop'
    && linearResult.issue_id === `${DRILL_TEAM}:${rollbackId}`
    && exact(linearResult.expected, { input: { stateId: DRILL_TEAM } })
    && clean(linearResult.rollback_id) === rollbackId
    && String(linearResult.outbox_id) === outboxId
    && clean(linearResult.correlation_id) === clean(rollback.correlation_id)
    && clean(linearResult.dedup_key) === clean(outbox.dedup_key)
    && clean(linearResult.operation) === clean(outbox.operation)
    && linearResult.intent_snapshot_sha256 === rowHash
    && exact(replay, expectedReplay);
  if (!exactScope) reject('F27_FINAL_DRILL_AUDIT_INVALID', 'database-drill');
  return {
    count: 1,
    sha256: sha256(Buffer.from(stable({ rollback, intent, outbox }), 'utf8')),
  };
}

function verifyDatabaseState(state, baseline, expectedPostContractSha256) {
  assertReadOnlyMetadata(state);
  if (!exact(state.flags, EXPECTED_FLAGS)
      || !exact(normalizeTableHash(state.flagsHash, 'F27_FINAL_RUNTIME_FLAGS_DRIFT'), baseline.database.flags)) {
    reject('F27_FINAL_RUNTIME_FLAGS_DRIFT', 'database');
  }
  if (!exact(normalizeTableHash(state.flagFlips, 'F27_FINAL_FLAG_FLIPS_DRIFT'), baseline.database.flagFlips)) {
    reject('F27_FINAL_FLAG_FLIPS_DRIFT', 'database');
  }
  if (!exact(normalizeTableHash(state.clients, 'F27_FINAL_CLIENTS_DRIFT'), baseline.database.clients)) {
    reject('F27_FINAL_CLIENTS_DRIFT', 'database');
  }
  if (!exact(normalizeTableHash(state.teamMembers, 'F27_FINAL_TEAM_MEMBERS_DRIFT'), baseline.database.teamMembers)) {
    reject('F27_FINAL_TEAM_MEMBERS_DRIFT', 'database');
  }
  if (!exact(normalizeTableHash(state.fences, 'F27_FINAL_FENCES_DRIFT'), baseline.database.fences)) {
    reject('F27_FINAL_FENCES_DRIFT', 'database');
  }
  const nonDrillProjected = (state.projectedRows || []).filter(row => row && row.team !== DRILL_TEAM);
  if (!exact(hashRows(nonDrillProjected), baseline.database.queue)) {
    reject('F27_FINAL_PREEXISTING_QUEUE_DRIFT', 'database');
  }
  const fullRows = Array.isArray(state.fullRows) ? state.fullRows : [];
  const drillRows = fullRows.filter(row => row && row.team === DRILL_TEAM);
  if (fullRows.length !== baseline.database.queue.count + 1 || drillRows.length !== 1) {
    reject('F27_FINAL_UNEXPECTED_QUEUE_ROW', 'database');
  }
  if (clean(state.postContractSha256) !== expectedPostContractSha256) {
    reject('F27_FINAL_POST_CONTRACT_DRIFT', 'database');
  }
  const rollbacks = Array.isArray(state.rollbacks) ? state.rollbacks : [];
  const intents = Array.isArray(state.intents) ? state.intents : [];
  if (rollbacks.some(row => row && row.state === 'open')) {
    reject('F27_FINAL_OPEN_ROLLBACK_PRESENT', 'database');
  }
  if (rollbacks.some(row => row && row.is_drill !== true)
      || intents.some(intent => {
        const rollback = rollbacks.find(row => clean(row && row.id) === clean(intent && intent.rollback_id));
        return !rollback || rollback.is_drill !== true;
      })) {
    reject('F27_FINAL_REAL_ROLLBACK_PRESENT', 'database');
  }
  if (Number(state.replayEligible) !== 0) reject('F27_FINAL_REPLAY_ELIGIBLE', 'database');
  const drillAudit = exactDrillAudit(state);
  return {
    bookendSha256: sha256(Buffer.from(stable({
      flags: state.flags,
      flagsHash: state.flagsHash,
      flagFlips: state.flagFlips,
      fences: state.fences,
      clients: state.clients,
      teamMembers: state.teamMembers,
      projectedRows: state.projectedRows,
      fullRows: state.fullRows,
      rollbacks: state.rollbacks,
      intents: state.intents,
      replayEligible: state.replayEligible,
      postContractSha256: state.postContractSha256,
    }), 'utf8')),
    drillAudit,
  };
}

function sqlStrings(values) {
  return values.map(value => `'${String(value).replace(/'/g, "''")}'`).join(',');
}

function stateHashCtes() {
  return String.raw`
flags_rows AS (
  SELECT key, encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_hash
  FROM public.syncview_runtime_flags f
  WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')
),
flip_rows AS (
  SELECT id, encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_hash
  FROM public.flag_flips f
),
fence_rows AS (
  SELECT team, encode(extensions.digest(convert_to(to_jsonb(f)::text,'UTF8'),'sha256'),'hex') row_hash
  FROM public.track_b_f27_team_fences f
),
client_rows AS (
  SELECT slug, encode(extensions.digest(convert_to(to_jsonb(c)::text,'UTF8'),'sha256'),'hex') row_hash
  FROM public.clients c
),
team_member_rows AS (
  SELECT id::text id, encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') row_hash
  FROM public.team_members t
)`;
}

function aggregateHashSql(cte, key) {
  return `jsonb_build_object(
    'count',(SELECT count(*) FROM ${cte}),
    'sha256',encode(extensions.digest(convert_to(COALESCE((
      SELECT string_agg(row_hash,'' ORDER BY ${key}) FROM ${cte}
    ),''),'UTF8'),'sha256'),'hex')
  )`;
}

function projectedRowsCte(projection) {
  if (!Array.isArray(projection) || !projection.length || projection[0] !== 'id'
      || new Set(projection).size !== projection.length
      || projection.some(name => !/^[a-z_][a-z0-9_]*$/.test(name))) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'snapshot-projection');
  }
  return String.raw`
projected_outbox AS (
  SELECT o.id, (
    SELECT jsonb_object_agg(e.key,e.value ORDER BY e.key)
    FROM jsonb_each(to_jsonb(o)) e
    WHERE e.key IN (${sqlStrings(projection)})
  ) row_value
  FROM public.mirror_outbox o
)`;
}

function baselineStateSql(projection) {
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
WITH
${projectedRowsCte(projection)},
${stateHashCtes()}
SELECT jsonb_build_object(
  'metadata',jsonb_build_object(
    'transactionIsolation',current_setting('transaction_isolation'),
    'transactionReadOnly',current_setting('transaction_read_only')
  ),
  'flags',COALESCE((SELECT jsonb_object_agg(key,value ORDER BY key)
    FROM public.syncview_runtime_flags
    WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')),'{}'::jsonb),
  'projectedRows',COALESCE((SELECT jsonb_agg(row_value ORDER BY id) FROM projected_outbox),'[]'::jsonb),
  'flagsHash',${aggregateHashSql('flags_rows', 'key')},
  'flagFlips',${aggregateHashSql('flip_rows', 'id')},
  'fences',${aggregateHashSql('fence_rows', 'team')},
  'clients',${aggregateHashSql('client_rows', 'slug')},
  'teamMembers',${aggregateHashSql('team_member_rows', 'id')}
)::text;
COMMIT;
`;
}

function finalStateSql(projection) {
  return String.raw`\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
WITH
${projectedRowsCte(projection)},
${stateHashCtes()},
replay_eligible AS (
  SELECT i.rollback_id,i.outbox_id
  FROM public.track_b_team_rollbacks r
  JOIN public.track_b_team_rollback_intents i ON i.rollback_id=r.id
  JOIN public.mirror_outbox o ON o.id=i.outbox_id
  WHERE r.state='open'
    AND i.classification='replay'
    AND i.terminal_receipt IS NULL
    AND o.status IN ('pending','skipped')
    AND (o.next_retry_at IS NULL OR o.next_retry_at<=clock_timestamp())
    AND (
      (r.is_drill=true AND r.team='${DRILL_TEAM}'
        AND o.team='${DRILL_TEAM}' AND o.client_slug='${DRILL_TEAM}'
        AND o.f27_drill_rollback_id=r.id
        AND o.test_only=true AND o.legacy_parity=false)
      OR
      (r.is_drill=false AND r.team IN ('video','graphics')
        AND o.team=r.team AND o.f27_drill_rollback_id IS NULL)
    )
)
SELECT jsonb_build_object(
  'metadata',jsonb_build_object(
    'transactionIsolation',current_setting('transaction_isolation'),
    'transactionReadOnly',current_setting('transaction_read_only')
  ),
  'flags',COALESCE((SELECT jsonb_object_agg(key,value ORDER BY key)
    FROM public.syncview_runtime_flags
    WHERE key IN ('prod_authority','linear_outbound_enabled','linear_legacy_parity_enabled')),'{}'::jsonb),
  'projectedRows',COALESCE((SELECT jsonb_agg(row_value ORDER BY id) FROM projected_outbox),'[]'::jsonb),
  'fullRows',COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.id) FROM public.mirror_outbox o),'[]'::jsonb),
  'rollbacks',COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM public.track_b_team_rollbacks r),'[]'::jsonb),
  'intents',COALESCE((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.rollback_id,i.outbox_id)
    FROM public.track_b_team_rollback_intents i),'[]'::jsonb),
  'replayEligible',(SELECT count(*) FROM replay_eligible),
  'flagsHash',${aggregateHashSql('flags_rows', 'key')},
  'flagFlips',${aggregateHashSql('flip_rows', 'id')},
  'fences',${aggregateHashSql('fence_rows', 'team')},
  'clients',${aggregateHashSql('client_rows', 'slug')},
  'teamMembers',${aggregateHashSql('team_member_rows', 'id')}
)::text;
COMMIT;
`;
}

function parseSingleJson(stdout) {
  const lines = String(stdout == null ? '' : stdout).split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) reject('F27_FINAL_TRANSACTION_NOT_READ_ONLY', 'database');
  try { return JSON.parse(lines[0]); }
  catch (_) { reject('F27_FINAL_TRANSACTION_NOT_READ_ONLY', 'database'); }
}

function psqlRunner(psqlPath, connectionEnv) {
  return sql => {
    const result = spawnSync(psqlPath, [
      '-X', '--quiet', '--no-align', '--tuples-only',
      '--set', 'ON_ERROR_STOP=1', '--file', '-',
    ], {
      input: sql,
      encoding: 'utf8',
      windowsHide: true,
      env: safePsqlEnvironment(connectionEnv),
      maxBuffer: 1024 * 1024 * 1024,
    });
    if (result.error || result.status !== 0 || result.signal || clean(result.stderr)) {
      reject('F27_FINAL_TRANSACTION_NOT_READ_ONLY', 'database');
    }
    return result.stdout;
  };
}

function postContractAfterDrill(stdout, database) {
  const rewritten = String(stdout).split(/\r?\n/).filter(Boolean).map(line => {
    let wrapper;
    try { wrapper = JSON.parse(line); } catch (_) { return line; }
    if (wrapper && wrapper.section === 'f27_state') {
      let value;
      try { value = JSON.parse(wrapper.value); } catch (_) { return line; }
      // The existing exact contract attestor predates the mandatory permanent
      // drill and requires empty ledgers. Only those two excluded state counts
      // are neutralized for schema hashing; the final query independently
      // requires one exact terminal drill and rejects every real/open ledger.
      value.rollback_count = 0;
      value.intent_count = 0;
      wrapper.value = JSON.stringify(value);
      return JSON.stringify(wrapper);
    }
    return line;
  }).join('\n');
  let parsed;
  try { parsed = parsePostTranscript(`${rewritten}\n`, database, false); }
  catch (_) { reject('F27_FINAL_POST_CONTRACT_DRIFT', 'database-contract'); }
  return postContract(parsed).sha256;
}

function createPsqlDatabaseAdapter({
  databaseUrl,
  projectRef,
  database,
  psqlPath = 'psql',
  disposable = false,
}) {
  let connectionEnv;
  try {
    connectionEnv = disposable
      ? parseDisposableDatabaseUrl(databaseUrl, database)
      : parseDatabaseUrl(databaseUrl, projectRef, database);
  } catch (_) {
    reject('F27_FINAL_DATABASE_IDENTITY_MISMATCH', 'database');
  }
  connectionEnv.PGAPPNAME = 'f27-final-verification-read-only';
  const run = psqlRunner(psqlPath, connectionEnv);
  return {
    captureBaseline({ projection }) {
      return Promise.resolve(parseSingleJson(run(baselineStateSql(projection))));
    },
    readFinal({ projection }) {
      return Promise.resolve(parseSingleJson(run(finalStateSql(projection))));
    },
    readPostContract() {
      const transcript = run(verifyAfterSql(['id'], false));
      return Promise.resolve(postContractAfterDrill(transcript, database));
    },
  };
}

function networkLedger() {
  const methods = [];
  return {
    record(method) {
      const normalized = clean(method).toUpperCase();
      methods.push(normalized);
      if (normalized !== 'GET') reject('F27_FINAL_NETWORK_METHOD_FORBIDDEN', 'network');
    },
    methods() { return [...methods]; },
  };
}

async function getResponse(ledger, url, options = {}) {
  ledger.record('GET');
  const response = await fetch(url, {
    ...options,
    method: 'GET',
    redirect: 'error',
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw new Error(`GET ${response.status}`);
  return response;
}

function canonicalN8nOrigin(baseUrl, expectedOriginSha256) {
  const raw = clean(baseUrl);
  const expected = clean(expectedOriginSha256);
  let parsed;
  try { parsed = new URL(raw); }
  catch (_) { reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n'); }
  if (!HASH_RE.test(expected)
      || parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
      || parsed.port
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash
      || (raw !== parsed.origin && raw !== `${parsed.origin}/`)
      || sha256(Buffer.from(parsed.origin, 'utf8')) !== expected) {
    reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
  }
  return parsed.origin;
}

function createDefaultN8nAdapter(ledger, expectedOriginSha256, env = process.env) {
  const base = canonicalN8nOrigin(env.N8N_BASE_URL, expectedOriginSha256);
  const key = clean(env.N8N_API_KEY);
  if (!key) {
    reject('F27_FINAL_N8N_UNSTABLE_READ', 'n8n');
  }
  const headers = { 'X-N8N-API-KEY': key, Accept: 'application/json' };
  return {
    async listPage(cursor) {
      const url = new URL(`${base}/api/v1/workflows`);
      url.searchParams.set('limit', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await getResponse(ledger, url, { headers });
      return response.json();
    },
    async getWorkflow(id) {
      const response = await getResponse(
        ledger,
        `${base}/api/v1/workflows/${encodeURIComponent(id)}`,
        { headers },
      );
      return response.json();
    },
  };
}

function createDefaultProviderAdapter(projectRef) {
  try {
    return require('./f27-edge-source-rollback-supabase-adapter.js').createAdapter({ projectRef });
  } catch (_) {
    reject('F27_FINAL_PROVIDER_UNSTABLE_READ', 'provider');
  }
}

async function readCompleteReconcilerInventory(ledger, root, headers) {
  const workflowRuns = [];
  let totalCount = null;
  for (let page = 1; page <= 1000; page += 1) {
    const url = new URL(`${root}/runs`);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    const response = await (await getResponse(ledger, url, { headers })).json();
    if (!response || !Number.isSafeInteger(response.total_count)
        || response.total_count < 0 || response.total_count > 100000
        || !Array.isArray(response.workflow_runs)
        || response.workflow_runs.length > 100
        || (totalCount !== null && response.total_count !== totalCount)) {
      throw new Error('invalid run inventory');
    }
    totalCount = response.total_count;
    workflowRuns.push(...response.workflow_runs);
    if (workflowRuns.length >= totalCount) break;
    if (response.workflow_runs.length !== 100) throw new Error('partial run inventory');
  }
  if (totalCount === null || workflowRuns.length !== totalCount) {
    throw new Error('incomplete run inventory');
  }
  return {
    totalCount,
    recentRunWindow: validateRecentRunWindow({
      total_count: totalCount,
      workflow_runs: workflowRuns,
    }),
  };
}

function validateReconcilerStateBookend({
  metadataBefore,
  inventoryBefore,
  nonterminalRunCount,
  inventoryAfter,
  metadataAfter,
  releaseSha,
  closureSha256,
}) {
  for (const metadata of [metadataBefore, metadataAfter]) {
    if (!metadata || metadata.path !== RECONCILER_WORKFLOW_PATH
        || metadata.state !== 'disabled_manually') {
      reject('F27_FINAL_RECONCILER_IN_FLIGHT', 'reconciler');
    }
  }
  if (!Number.isSafeInteger(nonterminalRunCount) || nonterminalRunCount !== 0) {
    reject('F27_FINAL_RECONCILER_IN_FLIGHT', 'reconciler');
  }
  if (!inventoryBefore || !inventoryAfter
      || !exact(inventoryBefore, inventoryAfter)) {
    reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
  }
  return {
    workflowPath: RECONCILER_WORKFLOW_PATH,
    workflowState: 'disabled_manually',
    nonterminalRunCount: 0,
    recentRunWindow: inventoryAfter.recentRunWindow,
    releaseSha,
    closureSha256,
  };
}

function createDefaultReconcilerAdapter(ledger, releaseSha, closureSha256, env = process.env) {
  const token = clean(env.GH_TOKEN || env.GITHUB_TOKEN);
  if (!token) {
    reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  return {
    async readState() {
      const root = `https://api.github.com/repos/${TRUSTED_GITHUB_REPOSITORY}/actions/workflows/${RECONCILER_WORKFLOW_API_ID}`;
      const metadataBefore = await (await getResponse(ledger, root, { headers })).json();
      const inventoryBefore = await readCompleteReconcilerInventory(ledger, root, headers);
      let nonterminalRunCount = 0;
      for (const status of NONTERMINAL_RUN_STATUSES) {
        const url = new URL(`${root}/runs`);
        url.searchParams.set('status', status);
        url.searchParams.set('per_page', '1');
        const response = await (await getResponse(ledger, url, { headers })).json();
        if (!Number.isSafeInteger(Number(response.total_count)) || Number(response.total_count) < 0) {
          throw new Error('invalid run count');
        }
        nonterminalRunCount += Number(response.total_count);
      }
      const inventoryAfter = await readCompleteReconcilerInventory(ledger, root, headers);
      const metadataAfter = await (await getResponse(ledger, root, { headers })).json();
      return validateReconcilerStateBookend({
        metadataBefore,
        inventoryBefore,
        nonterminalRunCount,
        inventoryAfter,
        metadataAfter,
        releaseSha,
        closureSha256: framedClosureHash(releaseSha),
      });
    },
    async betweenScans() {
      await new Promise(resolve => setTimeout(resolve, RECONCILER_SCAN_DELAY_MS));
    },
  };
}

function createDefaultFreshnessAdapter(ledger, projectRef, env = process.env) {
  const key = clean(env.SUPABASE_SERVICE_ROLE_KEY);
  const base = clean(env.SUPABASE_URL);
  if (!key || !PROJECT_REF_RE.test(projectRef)
      || (base !== `https://${projectRef}.supabase.co`
        && base !== `https://${projectRef}.supabase.co/`)) {
    reject('F27_FINAL_INBOUND_NOT_FRESH', 'freshness');
  }
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: 'application/json',
  };
  return {
    async read() {
      const now = new Date();
      const latest = new URL(`${base.replace(/\/$/, '')}/rest/v1/deliverable_events`);
      latest.searchParams.set('select', 'ts,action,actor,source');
      latest.searchParams.set('source', 'eq.mirror');
      latest.searchParams.set('actor', 'eq.Linear webhook');
      latest.searchParams.set('action', 'like.mirror_in_*');
      latest.searchParams.set('order', 'ts.desc');
      latest.searchParams.set('limit', '1');
      const count = new URL(latest);
      count.searchParams.set('select', 'id');
      count.searchParams.delete('order');
      count.searchParams.set('ts', `gte.${new Date(now.getTime() - 12 * 3600000).toISOString()}`);
      const latestResponse = await getResponse(ledger, latest, { headers });
      const countResponse = await getResponse(ledger, count, {
        headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
      });
      const rows = await latestResponse.json();
      const range = clean(countResponse.headers.get('content-range'));
      const match = range.match(/^(?:\d+-\d+|\*)\/(\d+)$/);
      const recentCount = match ? Number(match[1]) : -1;
      const row = Array.isArray(rows) ? rows[0] : null;
      return evaluateFreshness(row, recentCount, now);
    },
  };
}

function evaluateFreshness(row, recentCount, now = new Date()) {
  const timestamp = row && new Date(row.ts);
  const rawAgeMs = timestamp && Number.isFinite(timestamp.getTime())
    && now instanceof Date && Number.isFinite(now.getTime())
    ? now.getTime() - timestamp.getTime()
    : Infinity;
  const ageMinutes = rawAgeMs / 60000;
  return {
    ok: Boolean(row)
      && row.source === 'mirror'
      && row.actor === 'Linear webhook'
      && /^mirror_in_[a-z0-9_]+$/.test(clean(row.action))
      && Number.isSafeInteger(Number(recentCount))
      && Number(recentCount) > 0
      && rawAgeMs >= -MAX_FUTURE_FRESHNESS_SKEW_MS
      && rawAgeMs < 360 * 60 * 1000,
    recentCount: Number(recentCount),
    ageMinutes,
  };
}

function loadInjectedAdapters(args, context) {
  if (!args.adapterModule) return {};
  if (!args.postgresProof
      || clean(process.env.F27_CONFIRM_DISPOSABLE_FINAL_VERIFIER)
        !== 'F27_DISPOSABLE_FINAL_VERIFIER_ONLY'
      || !path.isAbsolute(args.adapterModule)) {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'adapters');
  }
  let factory;
  try {
    const resolved = require.resolve(args.adapterModule);
    delete require.cache[resolved];
    factory = require(resolved);
  } catch (_) {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'adapters');
  }
  if (!factory || typeof factory.createAdapters !== 'function') {
    reject('F27_FINAL_ARGUMENT_REJECTED', 'adapters');
  }
  let adapters;
  try { adapters = factory.createAdapters(context); }
  catch (_) { reject('F27_FINAL_ARGUMENT_REJECTED', 'adapters'); }
  return adapters || {};
}

function adapterSet(args, context) {
  const ledger = networkLedger();
  const injected = loadInjectedAdapters(args, context);
  const databaseUrl = args.postgresProof
    ? process.env.F27_DISPOSABLE_DATABASE_URL
    : process.env.F27_DATABASE_URL;
  return {
    ledger,
    db: injected.db || createPsqlDatabaseAdapter({
      databaseUrl,
      projectRef: args.projectRef,
      database: args.database,
      psqlPath: args.psqlPath,
      disposable: args.postgresProof,
    }),
    provider: injected.provider || createDefaultProviderAdapter(args.projectRef),
    n8n: injected.n8n || createDefaultN8nAdapter(ledger, args.n8nOriginSha256),
    reconciler: injected.reconciler || createDefaultReconcilerAdapter(
      ledger, args.reconcilerReleaseSha, args.reconcilerClosureSha256,
    ),
    freshness: injected.freshness || (args.command === 'verify'
      ? createDefaultFreshnessAdapter(ledger, args.projectRef)
      : null),
    networkAudit: injected.networkAudit || (() => ledger.methods()),
    now: injected.now || (() => new Date()),
  };
}

function assertNetworkMethods(adapters) {
  let methods;
  try { methods = adapters.networkAudit(); }
  catch (_) { reject('F27_FINAL_NETWORK_METHOD_FORBIDDEN', 'network'); }
  if (!Array.isArray(methods)
      || methods.some(method => clean(method).toUpperCase() !== 'GET')) {
    reject('F27_FINAL_NETWORK_METHOD_FORBIDDEN', 'network');
  }
  return methods.length;
}

function sealedBaselineBytes(payload) {
  const payloadBytes = Buffer.from(stablePretty(payload), 'utf8');
  const envelope = {
    format: SEALED_FORMAT,
    payloadByteLength: payloadBytes.length,
    payloadSha256: sha256(payloadBytes),
    payloadBase64: payloadBytes.toString('base64'),
  };
  return Buffer.from(stablePretty(envelope), 'utf8');
}

function writeBaseline(outputDir, payload, { testMode = false } = {}) {
  if (!path.isAbsolute(outputDir)) reject('F27_FINAL_PRIVATE_WRITE_FAILED', 'baseline-write');
  let resolved;
  let entries;
  try {
    resolved = path.resolve(outputDir);
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('not dir');
    const real = fs.realpathSync.native(resolved);
    const normalized = process.platform === 'win32' ? real.toLowerCase() : real;
    for (const root of registeredWorktrees()) {
      let realRoot = fs.realpathSync.native(root);
      if (process.platform === 'win32') realRoot = realRoot.toLowerCase();
      const relative = path.relative(realRoot, normalized);
      if (relative === '' || (!path.isAbsolute(relative)
          && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
        throw new Error('inside worktree');
      }
    }
    if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) {
      throw new Error('broad permissions');
    }
    entries = fs.readdirSync(resolved);
  } catch (_) {
    reject('F27_FINAL_PRIVATE_WRITE_FAILED', 'baseline-write');
  }
  if (entries.length) reject('F27_FINAL_PRIVATE_WRITE_FAILED', 'baseline-write');
  if (!testMode) {
    try { protectWindowsPrivateDirectory(resolved); }
    catch (_) { reject('F27_FINAL_PRIVATE_WRITE_FAILED', 'baseline-write'); }
  }
  const bytes = sealedBaselineBytes(payload);
  const bundleSha256 = sha256(bytes);
  const target = path.join(resolved, `f27-final-baseline-${bundleSha256}.f27final`);
  try {
    fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(target, 0o400);
    if (!testMode) assertWindowsPrivateFileAcl(target);
    const readback = fs.readFileSync(target);
    if (!readback.equals(bytes) || sha256(readback) !== bundleSha256) throw new Error('readback');
  } catch (_) {
    try { fs.chmodSync(target, 0o600); fs.unlinkSync(target); } catch (_) {}
    reject('F27_FINAL_PRIVATE_WRITE_FAILED', 'baseline-write');
  }
  return { bundleSha256, byteLength: bytes.length };
}

function loadBaseline(file, expectedSha256, { testMode = false } = {}) {
  const artifact = privateRegularFile(
    file,
    assertHash(expectedSha256, 'F27_FINAL_BASELINE_INVALID'),
    null,
    { testMode },
  );
  if (artifact.byteLength > MAX_BASELINE_BYTES) reject('F27_FINAL_BASELINE_INVALID', 'baseline');
  let envelope;
  let payloadBytes;
  let payload;
  try {
    envelope = JSON.parse(artifact.bytes);
    payloadBytes = Buffer.from(envelope.payloadBase64, 'base64');
    payload = JSON.parse(payloadBytes);
  } catch (_) {
    reject('F27_FINAL_BASELINE_INVALID', 'baseline');
  }
  if (!envelope || envelope.format !== SEALED_FORMAT
      || Number(envelope.payloadByteLength) !== payloadBytes.length
      || envelope.payloadSha256 !== sha256(payloadBytes)
      || !Buffer.from(stablePretty(payload), 'utf8').equals(payloadBytes)
      || !payload || payload.format !== FORMAT) {
    reject('F27_FINAL_BASELINE_INVALID', 'baseline');
  }
  return { payload, byteLength: artifact.byteLength, sha256: artifact.sha256 };
}

function commonArtifacts(args, release, identities, { testMode = false } = {}) {
  const snapshot = loadSnapshot(args, release, { testMode });
  const inbound = sourceCaptureSummary(
    args.pinnedInboundBundle,
    args.pinnedInboundSha256,
    [PINNED_INBOUND_SLUG],
    null,
    { projectRef: args.projectRef, testMode },
  );
  const priorFour = sourceCaptureSummary(
    args.priorFourBundle,
    args.priorFourSha256,
    SECTION4_SLUGS,
    args.priorFourByteLength,
    { projectRef: args.projectRef, testMode },
  );
  const reconcilerArtifact = privateRegularFile(
    args.reconcilerCapture,
    args.reconcilerCaptureSha256,
    null,
    { testMode },
  );
  let reconcilerBundle;
  try {
    reconcilerBundle = unpackReconcilerBundle(reconcilerArtifact.bytes);
  } catch (_) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'reconciler-capture');
  }
  const reconcilerManifest = reconcilerBundle && reconcilerBundle.manifest;
  if (!reconcilerManifest
      || reconcilerManifest.prior_reconciler_sha !== args.reconcilerReleaseSha
      || reconcilerManifest.prior_reconciler_closure_sha256
        !== args.reconcilerClosureSha256
      || reconcilerManifest.workflow_path !== RECONCILER_WORKFLOW_PATH
      || reconcilerManifest.workflow_apply_default_false !== true
      || reconcilerManifest.rollback_action !== 'keep_apply_disabled'
      || Number(reconcilerManifest.file_count) !== RECONCILER_CLOSURE_PATHS.length) {
    reject('F27_FINAL_ARTIFACT_INVALID', 'reconciler-capture');
  }
  if (args.reconcilerReleaseSha !== args.releaseSha
      || framedClosureHash(args.reconcilerReleaseSha) !== args.reconcilerClosureSha256) {
    reject('F27_FINAL_RECONCILER_DRIFT', 'reconciler');
  }
  return {
    release: {
      sha: release.releaseSha,
      migrationSha256: release.migrationSha256,
    },
    identity: identities,
    snapshot: {
      sha256: args.snapshotSha256,
      byteLength: snapshot.byteLength,
      projectionSha256: sha256(Buffer.from(stable(snapshot.projection), 'utf8')),
    },
    inbound: {
      sha256: inbound.sha256,
      byteLength: inbound.byteLength,
      aggregateSourceSha256: inbound.aggregateSourceSha256,
      function: inbound.functions[PINNED_INBOUND_SLUG],
    },
    priorFour: {
      sha256: priorFour.sha256,
      byteLength: priorFour.byteLength,
      aggregateSourceSha256: priorFour.aggregateSourceSha256,
    },
    reconciler: {
      captureSha256: reconcilerArtifact.sha256,
      captureByteLength: reconcilerArtifact.byteLength,
      releaseSha: args.reconcilerReleaseSha,
      closureSha256: args.reconcilerClosureSha256,
    },
    expectedPostContractSha256: args.expectedPostContractSha256,
    snapshotPrivate: snapshot,
  };
}

function verifyCommonBindings(args, baseline, common) {
  const expected = {
    release: common.release,
    identity: common.identity,
    snapshot: common.snapshot,
    inbound: common.inbound,
    priorFour: common.priorFour,
    reconciler: common.reconciler,
    expectedPostContractSha256: common.expectedPostContractSha256,
  };
  const actual = {
    release: baseline.release,
    identity: baseline.identity,
    snapshot: baseline.snapshot,
    inbound: baseline.inbound,
    priorFour: baseline.priorFour,
    reconciler: baseline.reconciler,
    expectedPostContractSha256: baseline.expectedPostContractSha256,
  };
  if (!exact(actual, expected)) reject('F27_FINAL_BASELINE_INVALID', 'baseline-binding');
  if (baseline.identity.databaseIdentitySha256
      !== identityBindings(
        args.projectRef,
        args.database,
        args.n8nOriginSha256,
        args.n8nReadScope,
      ).databaseIdentitySha256) {
    reject('F27_FINAL_DATABASE_IDENTITY_MISMATCH', 'identity');
  }
}

function assertBaselineScope(baseline, { testMode = false } = {}) {
  const expectedScope = testMode ? 'DISPOSABLE_ONLY' : 'PRODUCTION';
  if (!baseline || baseline.scope !== expectedScope) {
    reject('F27_FINAL_BASELINE_INVALID', 'baseline-scope');
  }
}

async function captureBaseline(args, adapters, release, identities, common) {
  const dbState = await adapters.db.captureBaseline({
    projection: common.snapshotPrivate.projection,
  });
  const database = validateBaselineDatabase(dbState, common.snapshotPrivate);
  const pinnedLive = await stableProviderRead(adapters.provider, PINNED_INBOUND_SLUG);
  if (!exact(pinnedLive, common.inbound.function)) {
    reject('F27_FINAL_PINNED_INBOUND_DRIFT', 'provider-inbound');
  }
  const frozenWriters = {};
  for (const slug of FROZEN_WRITER_SLUGS) {
    frozenWriters[slug] = await stableProviderRead(adapters.provider, slug);
  }
  const n8n = await n8nInventory(adapters.n8n);
  await reconcilerProof(adapters.reconciler, {
    releaseSha: common.reconciler.releaseSha,
    closureSha256: common.reconciler.closureSha256,
  });
  const networkGetCalls = assertNetworkMethods(adapters);
  const now = adapters.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    reject('F27_FINAL_UNEXPECTED_FAILURE', 'clock');
  }
  const payload = {
    format: FORMAT,
    scope: args.postgresProof ? 'DISPOSABLE_ONLY' : 'PRODUCTION',
    capturedAt: now.toISOString(),
    release: common.release,
    identity: common.identity,
    snapshot: common.snapshot,
    inbound: common.inbound,
    priorFour: common.priorFour,
    reconciler: common.reconciler,
    expectedPostContractSha256: common.expectedPostContractSha256,
    database,
    provider: { frozenWriters },
    n8n,
  };
  const written = writeBaseline(args.outputDir, payload, { testMode: args.postgresProof });
  return {
    status: 'PASS',
    scope: args.postgresProof ? 'DISPOSABLE_ONLY' : 'PRODUCTION',
    terminal: args.postgresProof
      ? 'F27_FINAL_BASELINE_CAPTURE_DISPOSABLE_ONLY'
      : 'F27_FINAL_BASELINE_CAPTURE_OK',
    release_sha: release.releaseSha,
    migration_sha256: release.migrationSha256,
    baseline_bundle_sha256: written.bundleSha256,
    baseline_bundle_byte_length: written.byteLength,
    private_snapshot_sha256: common.snapshot.sha256,
    pinned_inbound_sha256: common.inbound.sha256,
    prior_four_sha256: common.priorFour.sha256,
    reconciler_capture_sha256: common.reconciler.captureSha256,
    database_identity_sha256: identities.databaseIdentitySha256,
    n8n_origin_sha256: identities.n8nOriginSha256,
    n8n_read_scope: identities.n8nReadScope,
    preexisting_queue_count: database.queue.count,
    preexisting_queue_sha256: database.queue.sha256,
    clients_count: database.clients.count,
    clients_sha256: database.clients.sha256,
    team_members_count: database.teamMembers.count,
    team_members_sha256: database.teamMembers.sha256,
    frozen_writer_count: FROZEN_WRITER_SLUGS.length,
    n8n_workflow_count: n8n.count,
    n8n_semantic_inventory_sha256: n8n.sha256,
    network_get_calls: networkGetCalls,
    network_mutation_calls: 0,
    local_private_readback: 'PASS',
  };
}

async function verifyFinal(args, adapters, release, identities, common) {
  const loaded = loadBaseline(
    args.baselinePath,
    args.baselineSha256,
    { testMode: args.postgresProof },
  );
  const baseline = loaded.payload;
  assertBaselineScope(baseline, { testMode: args.postgresProof });
  verifyCommonBindings(args, baseline, common);

  const first = await adapters.db.readFinal({ projection: common.snapshotPrivate.projection });
  first.postContractSha256 = await adapters.db.readPostContract();
  const firstProof = verifyDatabaseState(
    first,
    baseline,
    common.expectedPostContractSha256,
  );

  const inbound = await stableProviderRead(adapters.provider, PINNED_INBOUND_SLUG);
  if (!exact(inbound, baseline.inbound.function)) {
    reject('F27_FINAL_PINNED_INBOUND_DRIFT', 'provider-inbound');
  }
  const releaseExpected = await expectedReleaseFunctions(adapters.provider, release.releaseSha);
  const section4 = {};
  for (const slug of SECTION4_SLUGS) {
    const live = await stableProviderRead(adapters.provider, slug);
    const expected = releaseExpected[slug];
    if (!expected || live.verifyJwt !== false
        || live.sourceSha256 !== expected.sourceSha256
        || live.entrypoint !== expected.entrypoint
        || live.entrypointSha256 !== expected.entrypointSha256
        || live.fileCount !== Number(expected.fileCount)) {
      reject('F27_FINAL_SECTION4_SOURCE_DRIFT', 'provider-section4');
    }
    section4[slug] = live;
  }
  for (const slug of FROZEN_WRITER_SLUGS) {
    const live = await stableProviderRead(adapters.provider, slug);
    if (!exact(live, baseline.provider.frozenWriters[slug])) {
      reject('F27_FINAL_FROZEN_WRITER_DRIFT', 'provider-frozen');
    }
  }

  const n8n = await n8nInventory(adapters.n8n);
  if (!exact(n8n, baseline.n8n)) reject('F27_FINAL_N8N_INVENTORY_DRIFT', 'n8n');
  const reconciler = await reconcilerProof(adapters.reconciler, {
    releaseSha: baseline.reconciler.releaseSha,
    closureSha256: baseline.reconciler.closureSha256,
  });
  let freshness;
  try { freshness = await adapters.freshness.read(); }
  catch (_) { reject('F27_FINAL_INBOUND_NOT_FRESH', 'freshness'); }
  if (!freshness || freshness.ok !== true
      || !Number.isFinite(Number(freshness.ageMinutes))
      || Number(freshness.ageMinutes) < -5
      || Number(freshness.ageMinutes) >= 360
      || !Number.isSafeInteger(Number(freshness.recentCount))
      || Number(freshness.recentCount) < 1) {
    reject('F27_FINAL_INBOUND_NOT_FRESH', 'freshness');
  }

  const second = await adapters.db.readFinal({ projection: common.snapshotPrivate.projection });
  second.postContractSha256 = await adapters.db.readPostContract();
  const secondProof = verifyDatabaseState(
    second,
    baseline,
    common.expectedPostContractSha256,
  );
  if (firstProof.bookendSha256 !== secondProof.bookendSha256
      || firstProof.drillAudit.sha256 !== secondProof.drillAudit.sha256) {
    reject('F27_FINAL_DATABASE_BOOKEND_DRIFT', 'database-bookend');
  }
  const networkGetCalls = assertNetworkMethods(adapters);
  const section4Aggregate = sha256(Buffer.from(stable(Object.fromEntries(
    Object.entries(section4).map(([slug, value]) => [slug, {
      version: value.version,
      sourceSha256: value.sourceSha256,
      entrypointSha256: value.entrypointSha256,
      verifyJwt: value.verifyJwt,
    }]),
  )), 'utf8'));
  const section4Functions = Object.fromEntries(SECTION4_SLUGS.map(slug => [
    slug,
    {
      version: section4[slug].version,
      source_sha256: section4[slug].sourceSha256,
      entrypoint_sha256: section4[slug].entrypointSha256,
      verify_jwt: section4[slug].verifyJwt,
    },
  ]));
  return {
    status: 'PASS',
    scope: args.postgresProof ? 'DISPOSABLE_ONLY' : 'PRODUCTION',
    terminal: args.postgresProof
      ? 'F27_FINAL_VERIFICATION_DISPOSABLE_ONLY'
      : 'F27_FINAL_VERIFICATION_OK',
    release_sha: release.releaseSha,
    migration_sha256: release.migrationSha256,
    baseline_bundle_sha256: loaded.sha256,
    private_snapshot_sha256: common.snapshot.sha256,
    pinned_inbound_sha256: common.inbound.sha256,
    prior_four_sha256: common.priorFour.sha256,
    reconciler_capture_sha256: common.reconciler.captureSha256,
    database_identity_sha256: identities.databaseIdentitySha256,
    n8n_origin_sha256: identities.n8nOriginSha256,
    n8n_read_scope: identities.n8nReadScope,
    transaction: 'repeatable_read_read_only',
    database_bookend_sha256: firstProof.bookendSha256,
    preexisting_queue_count: baseline.database.queue.count,
    preexisting_queue_sha256: baseline.database.queue.sha256,
    flag_flips_delta: 0,
    open_rollbacks: 0,
    replay_eligible: 0,
    retained_terminal_drills: 1,
    drill_audit_binder_sha256: firstProof.drillAudit.sha256,
    clients_count: baseline.database.clients.count,
    clients_sha256: baseline.database.clients.sha256,
    team_members_count: baseline.database.teamMembers.count,
    team_members_sha256: baseline.database.teamMembers.sha256,
    pinned_inbound_version: inbound.version,
    section4_function_count: SECTION4_SLUGS.length,
    section4_aggregate_sha256: section4Aggregate,
    section4_functions: section4Functions,
    frozen_writer_count: FROZEN_WRITER_SLUGS.length,
    frozen_writer_versions_unchanged: 'PASS',
    n8n_workflow_count: n8n.count,
    n8n_semantic_inventory_sha256: n8n.sha256,
    reconciler_workflow_state: reconciler.workflowState,
    reconciler_nonterminal_run_count: 0,
    inbound_freshness: 'PASS',
    network_get_calls: networkGetCalls,
    network_mutation_calls: 0,
    assertions: [
      'preexisting_old_columns_exact',
      'exact_completed_reserved_drill_only',
      'post_contract_and_fences_exact',
      'flags_and_flag_flips_unchanged',
      'no_open_or_real_team_rollback',
      'f27_replay_dormant',
      'clients_and_team_members_unchanged',
      'pinned_inbound_exact',
      'section4_release_exact',
      'frozen_writers_not_deployed',
      'n8n_semantic_inventory_unchanged',
      'reconciler_exact_and_quiescent',
      'linear_inbound_fresh',
      'database_safety_bookend_exact',
      'network_get_only',
    ],
  };
}

async function runFromEnvironment(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const expectedConfirmation = args.command === 'capture-baseline'
    ? 'CAPTURE_F27_FINAL_BASELINE'
    : 'VERIFY_F27_FINAL_READ_ONLY';
  const suppliedConfirmation = args.command === 'capture-baseline'
    ? clean(env.F27_CONFIRM_FINAL_BASELINE)
    : clean(env.F27_CONFIRM_FINAL_VERIFICATION);
  if (suppliedConfirmation !== expectedConfirmation) {
    reject('F27_FINAL_CONFIRMATION_REQUIRED', 'confirmation');
  }
  if (args.postgresProof
      && clean(env.F27_CONFIRM_DISPOSABLE_FINAL_VERIFIER)
        !== 'F27_DISPOSABLE_FINAL_VERIFIER_ONLY') {
    reject('F27_FINAL_CONFIRMATION_REQUIRED', 'confirmation');
  }
  const release = releaseBinding(args, { allowDirty: args.postgresProof });
  const identities = identityBindings(
    args.projectRef,
    args.database,
    args.n8nOriginSha256,
    args.n8nReadScope,
  );
  const common = commonArtifacts(args, release, identities, { testMode: args.postgresProof });
  const adapters = adapterSet(args, {
    command: args.command,
    releaseSha: args.releaseSha,
    projectRefSha256: identities.projectIdentitySha256,
    databaseIdentitySha256: identities.databaseIdentitySha256,
  });
  return args.command === 'capture-baseline'
    ? captureBaseline(args, adapters, release, identities, common)
    : verifyFinal(args, adapters, release, identities, common);
}

if (require.main === module) {
  runFromEnvironment().then(result => {
    process.stdout.write(`${JSON.stringify(boundedReceipt(result))}${os.EOL}`);
  }).catch(error => {
    process.stdout.write(`${JSON.stringify(boundedReceipt(publicFailure(error)))}${os.EOL}`);
    process.exitCode = 1;
  });
}

module.exports = {
  FORMAT,
  FinalVerificationError,
  FROZEN_WRITER_SLUGS,
  PINNED_INBOUND_SLUG,
  RECONCILER_CLOSURE_PATHS,
  SECTION4_SLUGS,
  assertBaselineScope,
  baselineStateSql,
  boundedReceipt,
  canonicalN8nOrigin,
  canonicalValue,
  createDefaultN8nAdapter,
  createPsqlDatabaseAdapter,
  evaluateFreshness,
  exactDrillAudit,
  finalStateSql,
  framedClosureHash,
  functionSummary,
  hashRows,
  n8nInventory,
  parseArgs,
  postContractAfterDrill,
  privateRegularFile,
  publicFailure,
  reconcilerProof,
  runFromEnvironment,
  sealedBaselineBytes,
  stable,
  validateReconcilerStateBookend,
  verifyDatabaseState,
  workflowSemanticValue,
};
