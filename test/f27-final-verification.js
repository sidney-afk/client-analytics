'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { stripBlockComments } = require('./helpers/strip-comments');

const {
  FROZEN_WRITER_SLUGS,
  SECTION4_SLUGS,
  assertBaselineScope,
  canonicalN8nOrigin,
  createDefaultN8nAdapter,
  createPsqlDatabaseAdapter,
  evaluateFreshness,
  framedClosureHash,
  functionSummary,
  hashRows,
  n8nInventory,
  parseArgs,
  privateRegularFile,
  publicFailure,
  reconcilerProof,
  releaseBinding,
  stable,
  validateReconcilerStateBookend,
  verifyDatabaseState,
  workflowSemanticValue,
} = require('../scripts/f27-final-verification.js');
const {
  BUNDLE_SCHEMA: RECONCILER_BUNDLE_SCHEMA,
  EXPECTED_CLOSURE_PATHS,
  HASH_ALGORITHM: RECONCILER_HASH_ALGORITHM,
  ROLLBACK_ACTION: RECONCILER_ROLLBACK_ACTION,
  WORKFLOW_PATH: RECONCILER_WORKFLOW_PATH,
  packBundle: packReconcilerBundle,
} = require('../scripts/f27-reconciler-closure.js');
const {
  captureFunctions,
} = require('../scripts/f27-edge-source-rollback-lib.js');
const {
  expectedPreF27Baseline,
  postSection7BaselineTranscriptValue,
  retainedF27AuditInvariant,
  sealBundle,
} = require('../scripts/f27-mirror-outbox-snapshot.js');
const {
  postgresJsonbStringify,
} = require('../scripts/f27-drill-runner.js');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_REF = 'abcdefghijklmnopqrst';
const DATABASE = 'f27_disposable';
const POST_CONTRACT = 'd'.repeat(64);
const N8N_ORIGIN = 'https://n8n.example.invalid';
const N8N_ORIGIN_SHA256 = sha256(Buffer.from(N8N_ORIGIN, 'utf8'));
const PRIVATE_SENTINEL = 'PRIVATE_SENTINEL_DO_NOT_PRINT';
const RELEASE_SHA = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: ROOT, encoding: 'utf8',
}).trim();
const MIGRATION_PATH = 'migrations/2026-07-20-f27-team-rollback.sql';
const MIGRATION_SHA256 = sha256(execFileSync('git', [
  'show', `${RELEASE_SHA}:${MIGRATION_PATH}`,
], {
  cwd: ROOT, encoding: null,
}));

let checks = 0;
function ok(condition, message, failureDetail = '') {
  checks += 1;
  assert.ok(condition, failureDetail ? `${message} (${failureDetail})` : message);
  process.stdout.write(`  ok  ${message}\n`);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicSafeCliFailure(result) {
  const receipt = result && result.receipt && typeof result.receipt === 'object'
    ? result.receipt
    : {};
  return JSON.stringify({
    status: typeof receipt.status === 'string' ? receipt.status : 'UNKNOWN',
    stage: typeof receipt.stage === 'string' ? receipt.stage : 'UNKNOWN',
    code: typeof receipt.code === 'string' ? receipt.code : 'UNKNOWN',
  });
}

function tableHash(label, count) {
  return { count, sha256: sha256(Buffer.from(`${label}:${count}`, 'utf8')) };
}

function privateDir(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try { fs.chmodSync(directory, 0o700); } catch (_) {}
  return directory;
}

function writePrivate(file, bytes) {
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: 'wx' });
  try { fs.chmodSync(file, 0o600); } catch (_) {}
  return {
    file,
    sha256: sha256(bytes),
    byteLength: bytes.length,
  };
}

function makeReconcilerBundle(directory) {
  const files = new Map(EXPECTED_CLOSURE_PATHS.map(relative => [
    relative,
    execFileSync('git', ['show', `${RELEASE_SHA}:${relative}`], {
      cwd: ROOT, encoding: null, maxBuffer: 64 * 1024 * 1024,
    }),
  ]));
  const closureSha256 = framedClosureHash(RELEASE_SHA);
  const manifest = {
    schema: RECONCILER_BUNDLE_SCHEMA,
    artifact_kind: 'f27-apply-capable-reconciler-closure',
    prior_reconciler_sha: RELEASE_SHA,
    workflow_path: RECONCILER_WORKFLOW_PATH,
    workflow_apply_default_false: true,
    node_major: '22',
    package_module_mode: 'commonjs',
    rollback_action: RECONCILER_ROLLBACK_ACTION,
    closure_algorithm: RECONCILER_HASH_ALGORITHM,
    prior_reconciler_closure_sha256: closureSha256,
    file_count: EXPECTED_CLOSURE_PATHS.length,
    files: EXPECTED_CLOSURE_PATHS.map(relative => ({
      path: relative,
      byte_length: files.get(relative).length,
      sha256: sha256(files.get(relative)),
    })),
  };
  const bytes = packReconcilerBundle(manifest, files);
  return {
    ...writePrivate(path.join(directory, 'reconciler.capture'), bytes),
    closureSha256,
  };
}

function makeSnapshot(
  directory,
  rows,
  projection,
  runtime,
  {
    name = 'private.snapshot',
    database = DATABASE,
    metadata = {},
    preF27Baseline = expectedPreF27Baseline(),
  } = {},
) {
  const files = new Map([
    ['database/mirror_outbox.rows.jsonl',
      Buffer.from(`${rows.map(row => JSON.stringify(row)).join('\n')}\n`, 'utf8')],
    ['database/mirror_outbox.preinstall-column-projection.json',
      Buffer.from(`${JSON.stringify(projection)}\n`, 'utf8')],
    ['database/pre-f27-baseline.json', Buffer.from(`${JSON.stringify(preF27Baseline)}\n`, 'utf8')],
    ['database/runtime-safety-state.json', Buffer.from(`${JSON.stringify(runtime)}\n`, 'utf8')],
    ['metadata/snapshot.json', Buffer.from(`${JSON.stringify({
      release_sha: RELEASE_SHA,
      project_ref: PROJECT_REF,
      database,
      migration_path: MIGRATION_PATH,
      migration_sha256: MIGRATION_SHA256,
      ...metadata,
    })}\n`, 'utf8')],
  ]);
  const sealed = sealBundle(files, { snapshot_time: '2026-07-30T00:00:00.000Z' });
  return writePrivate(path.join(directory, name), sealed.bundleBytes);
}

function sourceRecord(slug, version, sourceText) {
  return {
    slug,
    version: String(version),
    status: 'ACTIVE',
    verifyJwt: false,
    entrypointPath: `functions/${slug}/index.ts`,
    files: new Map([[`functions/${slug}/index.ts`, Buffer.from(sourceText, 'utf8')]]),
    providerBundleHash: sha256(Buffer.from(`provider:${slug}:${version}`, 'utf8')),
    provider: {
      adapter: 'supabase-management-readback-cli-docker-deploy',
      project_ref: PROJECT_REF,
      supabase_cli_version: '2.109.0',
      restore_adapter: 'local-docker-provider-source-redeploy',
    },
  };
}

async function makeSourceBundle(directory, name, records) {
  const file = path.join(directory, `${name}.sourcebundle`);
  const adapter = {
    async readFunction(slug) {
      const record = records[slug];
      if (!record) throw new Error('missing source fixture');
      return record;
    },
  };
  const receipt = await captureFunctions({
    adapter,
    slugs: Object.keys(records),
    bundleFile: file,
    capturedAt: '2026-07-30T00:00:00.000Z',
  });
  return {
    file,
    sha256: receipt.sealed_bundle_sha256,
    byteLength: receipt.sealed_bundle_byte_length,
  };
}

function drillFixture(baselineRows, {
  rollbackId = '11111111-1111-4111-8111-111111111111',
  correlationId = '22222222-2222-4222-8222-222222222222',
  outboxId = 9001,
  classifiedAt = '2026-07-30T00:01:30+00:00',
  completedAt = '2026-07-30T00:02:00+00:00',
} = {}) {
  const rowSnapshot = {
    id: outboxId,
    payload: { f27_drill: true },
    entity: 'deliverable',
    entity_id: `${DRILL_TEAM}:${rollbackId}`,
    operation: 'status',
    client_slug: DRILL_TEAM,
    team: DRILL_TEAM,
    dedup_key: `f27-drill:${rollbackId}`,
    source_edited_at: '2026-07-30T00:01:00+00:00',
    status: 'pending',
    test_only: true,
    legacy_parity: false,
    authority_generation: 0,
    f27_drill_rollback_id: rollbackId,
  };
  const rowSha = sha256(Buffer.from(postgresJsonbStringify(rowSnapshot), 'utf8'));
  const linearResult = {
    ok: true,
    type: 'f27_drill_replay_terminal',
    f27_drill: true,
    f27_preflight: true,
    no_external_call: true,
    mutation: 'f27DrillNoop',
    issue_id: `${DRILL_TEAM}:${rollbackId}`,
    expected: { input: { stateId: DRILL_TEAM } },
    rollback_id: rollbackId,
    outbox_id: outboxId,
    correlation_id: correlationId,
    dedup_key: `f27-drill:${rollbackId}`,
    operation: 'status',
    intent_snapshot_sha256: rowSha,
  };
  const replayReceipt = {
    ...linearResult,
    linear_result_sha256: sha256(Buffer.from(postgresJsonbStringify(linearResult), 'utf8')),
  };
  const outbox = {
    ...rowSnapshot,
    status: 'written',
    lock_token: null,
    locked_at: null,
    linear_result: linearResult,
  };
  const rollback = {
    id: rollbackId,
    correlation_id: correlationId,
    team: DRILL_TEAM,
    is_drill: true,
    state: 'complete',
    expected_authority: { video: 'linear', graphics: 'linear' },
    prior_outbound: { mode: 'off' },
    prior_parity: { enabled: false },
    fence_generation: null,
    snapshot_count: 1,
    snapshot_sha256: sha256(Buffer.from(rowSha, 'utf8')),
    terminal_receipt: {
      ok: true,
      type: 'f27_drill_terminal',
      rollback_id: rollbackId,
      correlation_id: correlationId,
      team: DRILL_TEAM,
      is_drill: true,
      snapshot_count: 1,
      snapshot_sha256: sha256(Buffer.from(rowSha, 'utf8')),
      unclassified: 0,
      unreceipted_replays: 0,
      replay_intents: 1,
      exact_terminal_replays: 1,
      active_drill_rows: 0,
      authority_before: { video: 'linear', graphics: 'linear' },
      authority_after: { video: 'linear', graphics: 'linear' },
      normal_outbound: { mode: 'off' },
      legacy_parity: { enabled: false },
      audit_history_retained: true,
      authority_cas: 'refused',
      authority_cas_reason: 'f27_drill_authority_cas_refused',
    },
    completed_at: completedAt,
  };
  const intent = {
    rollback_id: rollbackId,
    outbox_id: outboxId,
    row_snapshot: rowSnapshot,
    row_sha256: rowSha,
    classification: 'replay',
    classification_history: [{
      from: null,
      to: 'replay',
      reason: 'reserved drill replay',
      actor: 'f27-drill-runner',
      at: classifiedAt,
    }],
    reason: 'reserved drill replay',
    classified_by: 'f27-drill-runner',
    classified_at: classifiedAt,
    outbox_binding: {
      id: String(outbox.id),
      status: outbox.status,
      dedup_key: outbox.dedup_key,
      operation: outbox.operation,
      linear_result: outbox.linear_result,
      f27_drill_rollback_id: outbox.f27_drill_rollback_id,
      team: outbox.team,
      client_slug: outbox.client_slug,
      test_only: outbox.test_only,
      legacy_parity: outbox.legacy_parity,
      authority_generation: outbox.authority_generation,
    },
    terminal_receipt: replayReceipt,
  };
  const projection = baselineRows[0] ? Object.keys(baselineRows[0]) : ['id'];
  const projectedDrill = Object.fromEntries(projection.map(key => [key, outbox[key] ?? null]));
  return { rollback, intent, outbox, projectedDrill };
}

function realRollbackFixture(row) {
  const rollbackId = '33333333-3333-4333-8333-333333333333';
  const correlationId = '44444444-4444-4444-8444-444444444444';
  const classifiedAt = '2026-07-29T23:58:00+00:00';
  const rowSnapshot = clone(row);
  const rowSha = sha256(Buffer.from(postgresJsonbStringify(rowSnapshot), 'utf8'));
  const snapshotSha = sha256(Buffer.from(rowSha, 'utf8'));
  return {
    rollback: {
      id: rollbackId,
      correlation_id: correlationId,
      team: 'video',
      is_drill: false,
      state: 'complete',
      expected_authority: { video: 'linear', graphics: 'linear' },
      prior_outbound: { mode: 'off' },
      prior_parity: { enabled: false },
      fence_generation: 0,
      snapshot_count: 1,
      snapshot_sha256: snapshotSha,
      terminal_receipt: {
        ok: true,
        type: 'f27_rollback_terminal',
        rollback_id: rollbackId,
        correlation_id: correlationId,
        team: 'video',
        snapshot_count: 1,
        snapshot_sha256: snapshotSha,
        fence_generation_before: 0,
        fence_generation_after: 1,
        unclassified: 0,
        unreceipted_replays: 0,
        active_team_rows: 0,
        authority_before: { video: 'linear', graphics: 'linear' },
        authority_after: { video: 'linear', graphics: 'linear' },
        normal_outbound: { mode: 'off' },
        legacy_parity: { enabled: false },
      },
      completed_at: '2026-07-29T23:59:00+00:00',
    },
    intent: {
      rollback_id: rollbackId,
      outbox_id: row.id,
      row_snapshot: rowSnapshot,
      row_sha256: rowSha,
      classification: 'discard',
      classification_history: [{
        from: null,
        to: 'discard',
        reason: 'retained exact discard',
        actor: 'owner-runbook',
        at: classifiedAt,
      }],
      reason: 'retained exact discard',
      classified_by: 'owner-runbook',
      classified_at: classifiedAt,
      outbox_binding: {
        id: String(row.id),
        status: 'skipped',
        dedup_key: row.dedup_key,
        operation: row.operation,
        linear_result: null,
        f27_drill_rollback_id: row.f27_drill_rollback_id,
        team: row.team,
        client_slug: row.client_slug,
        test_only: row.test_only,
        legacy_parity: row.legacy_parity,
        authority_generation: row.authority_generation,
      },
      terminal_receipt: null,
    },
  };
}

const DRILL_TEAM = '__f27_drill__';
const FLAGS = {
  linear_legacy_parity_enabled: { enabled: false },
  linear_outbound_enabled: { mode: 'off' },
  prod_authority: { graphics: 'linear', video: 'linear' },
};

function offlineDatabaseState(rows, postContract = POST_CONTRACT, {
  fullRows = rows,
  retainedRollbacks = [],
  retainedIntents = [],
  fenceGenerations = { graphics: 0, video: 0 },
} = {}) {
  const flagsHash = { count: 3, sha256: sha256(Buffer.from(stable(FLAGS), 'utf8')) };
  const shared = {
    metadata: {
      transactionIsolation: 'repeatable read',
      transactionReadOnly: 'on',
    },
    flags: clone(FLAGS),
    flagsHash,
    flagFlips: tableHash('flips', 0),
    fences: tableHash('fences', 2),
    fenceGenerations: clone(fenceGenerations),
    clients: tableHash('clients', 1),
    teamMembers: tableHash('team-members', 1),
  };
  const drill = drillFixture(rows);
  return {
    capture: {
      ...clone(shared),
      projectedRows: clone(rows),
    },
    final: {
      ...clone(shared),
      projectedRows: [...clone(rows), drill.projectedDrill],
      fullRows: [...clone(fullRows), drill.outbox],
      rollbacks: [...clone(retainedRollbacks), drill.rollback],
      intents: [...clone(retainedIntents), drill.intent],
      replayEligible: 0,
      postContractSha256: postContract,
    },
  };
}

function serializeFunction(record) {
  return {
    ...record,
    files: Object.fromEntries([...record.files].map(([file, bytes]) => [
      file, Buffer.from(bytes).toString('base64'),
    ])),
  };
}

function adapterModuleSource() {
  return `'use strict';
const fs = require('node:fs');
function state() { return JSON.parse(fs.readFileSync(process.env.F27_FINAL_TEST_STATE, 'utf8')); }
function record(raw) {
  return {
    ...raw,
    files: new Map(Object.entries(raw.files).map(([file, bytes]) => [file, Buffer.from(bytes, 'base64')])),
  };
}
exports.createAdapters = function createAdapters() {
  const adapters = {
    provider: {
      async readFunction(slug) { return record(state().provider[slug]); },
      async readReleaseFunctions() { return state().releaseExpected; },
    },
    n8n: {
      async listPage(cursor) {
        if (cursor) return { data: [], nextCursor: null };
        return { data: state().n8n.list, nextCursor: null };
      },
      async getWorkflow(id) { return state().n8n.workflows[id]; },
    },
    reconciler: {
      async readState() { return state().reconciler; },
      async betweenScans() {},
    },
    freshness: {
      async read() { return state().freshness; },
    },
    networkAudit() { return state().networkMethods; },
    now() { return new Date('2026-07-30T00:00:00.000Z'); },
  };
  if (process.env.F27_FINAL_USE_REAL_DB !== '1') {
    adapters.db = {
      async captureBaseline() { return state().db.capture; },
      async readFinal() { return state().db.final; },
      async readPostContract() { return state().postContract; },
    };
  }
  return adapters;
};
`;
}

function cliArguments(fixtures, command, extra = []) {
  return [
    path.join(ROOT, 'scripts', 'f27-final-verification.js'),
    command,
    `--release-sha=${RELEASE_SHA}`,
    `--project-ref=${PROJECT_REF}`,
    `--database=${fixtures.database || DATABASE}`,
    `--snapshot-bundle=${fixtures.snapshot.file}`,
    `--snapshot-sha256=${fixtures.snapshot.sha256}`,
    `--pinned-inbound-bundle=${fixtures.inbound.file}`,
    `--pinned-inbound-sha256=${fixtures.inbound.sha256}`,
    `--prior-four-bundle=${fixtures.priorFour.file}`,
    `--prior-four-sha256=${fixtures.priorFour.sha256}`,
    `--prior-four-byte-length=${fixtures.priorFour.byteLength}`,
    `--reconciler-capture=${fixtures.reconciler.file}`,
    `--reconciler-capture-sha256=${fixtures.reconciler.sha256}`,
    `--reconciler-release-sha=${RELEASE_SHA}`,
    `--reconciler-closure-sha256=${fixtures.reconcilerClosureSha256}`,
    `--expected-post-contract-sha256=${fixtures.postContract}`,
    `--n8n-origin-sha256=${N8N_ORIGIN_SHA256}`,
    '--n8n-read-scope=CONFIRMED_INSTANCE_WIDE_WORKFLOW_READ',
    `--adapter-module=${fixtures.adapterModule}`,
    '--postgres-proof',
    ...extra,
  ];
}

function runCli(fixtures, command, extra, envExtra = {}) {
  const result = spawnSync(process.execPath, cliArguments(fixtures, command, extra), {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      F27_CONFIRM_FINAL_BASELINE: 'CAPTURE_F27_FINAL_BASELINE',
      F27_CONFIRM_FINAL_VERIFICATION: 'VERIFY_F27_FINAL_READ_ONLY',
      F27_CONFIRM_DISPOSABLE_FINAL_VERIFIER: 'F27_DISPOSABLE_FINAL_VERIFIER_ONLY',
      F27_FINAL_TEST_STATE: fixtures.stateFile,
      ...envExtra,
    },
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = String(result.stdout || '').split(/\r?\n/).filter(Boolean);
  let receipt = {};
  if (lines.length === 1) {
    try { receipt = JSON.parse(lines[0]); } catch (_) {}
  }
  const execution = { status: result.status, receipt, raw: lines[0] || '' };
  const safeFailure = publicSafeCliFailure(execution);
  assert.equal(lines.length, 1, `operator emitted one JSON receipt (${safeFailure})`);
  assert.equal(String(result.stderr || ''), '', `operator emitted no stderr (${safeFailure})`);
  return execution;
}

async function buildOfflineFixtures() {
  const directory = privateDir('f27-final-verifier-');
  const artifactDirectory = path.join(directory, 'artifacts');
  const baselineDirectory = path.join(directory, 'baseline');
  fs.mkdirSync(artifactDirectory, { mode: 0o700 });
  fs.mkdirSync(baselineDirectory, { mode: 0o700 });
  const rows = [
    {
      id: 1,
      payload: { value: PRIVATE_SENTINEL },
      created_at: '2026-07-30T00:00:00+00:00',
      team: 'video',
      status: 'pending',
      dedup_key: 'fixture:video',
      operation: 'status',
      client_slug: 'fixture-video',
      test_only: false,
      legacy_parity: false,
      authority_generation: 0,
      f27_drill_rollback_id: null,
    },
    {
      id: 2,
      payload: { value: 'graphics' },
      created_at: '2026-07-30T00:00:01+00:00',
      team: 'graphics',
      status: 'written',
      dedup_key: 'fixture:graphics',
      operation: 'status',
      client_slug: 'fixture-graphics',
      test_only: false,
      legacy_parity: false,
      authority_generation: 0,
      f27_drill_rollback_id: null,
    },
  ];
  const retainedReal = realRollbackFixture(rows[0]);
  const retainedDrill = drillFixture(rows, {
    rollbackId: '55555555-5555-4555-8555-555555555555',
    correlationId: '66666666-6666-4666-8666-666666666666',
    outboxId: 8001,
    classifiedAt: '2026-07-29T23:55:00+00:00',
    completedAt: '2026-07-29T23:56:00+00:00',
  });
  const retainedRollbacks = [retainedReal.rollback, retainedDrill.rollback];
  const retainedIntents = [retainedReal.intent, retainedDrill.intent];
  const fenceGenerations = { graphics: 0, video: 1 };
  const baselineRows = [...rows, retainedDrill.projectedDrill];
  const baselineFullRows = [...rows, retainedDrill.outbox];
  const preF27Baseline = postSection7BaselineTranscriptValue({
    fences: fenceGenerations,
    rollbacks: retainedRollbacks,
    intents: retainedIntents,
    holdGuardAclVariant: 'current_owner_only',
  });
  const projection = Object.keys(rows[0]);
  const runtime = { flags: FLAGS, flag_flips_count: 0 };
  const snapshot = makeSnapshot(artifactDirectory, baselineRows, projection, runtime, {
    preF27Baseline,
  });

  const inboundRecords = {
    'linear-inbound': sourceRecord('linear-inbound', 40, `export default "${PRIVATE_SENTINEL}";\n`),
  };
  const priorRecords = Object.fromEntries(SECTION4_SLUGS.map((slug, index) => [
    slug, sourceRecord(slug, 10 + index, `export default "prior-${slug}";\n`),
  ]));
  const inbound = await makeSourceBundle(artifactDirectory, 'inbound', inboundRecords);
  const priorFour = await makeSourceBundle(artifactDirectory, 'prior-four', priorRecords);
  const reconciler = makeReconcilerBundle(artifactDirectory);
  const adapterModule = path.join(directory, 'adapter.js');
  fs.writeFileSync(adapterModule, adapterModuleSource(), { mode: 0o600 });
  const reconcilerClosureSha256 = reconciler.closureSha256;

  const liveRecords = {
    'linear-inbound': inboundRecords['linear-inbound'],
    ...Object.fromEntries(SECTION4_SLUGS.map((slug, index) => [
      slug, sourceRecord(slug, 100 + index, `export default "candidate-${slug}";\n`),
    ])),
    ...Object.fromEntries(FROZEN_WRITER_SLUGS.map((slug, index) => [
      slug, sourceRecord(slug, 200 + index, `export default "frozen-${slug}-${PRIVATE_SENTINEL}";\n`),
    ])),
  };
  const releaseExpected = Object.fromEntries(SECTION4_SLUGS.map(slug => {
    const summary = functionSummary(liveRecords[slug], slug);
    return [slug, {
      slug,
      verifyJwt: summary.verifyJwt,
      sourceSha256: summary.sourceSha256,
      entrypoint: summary.entrypoint,
      entrypointSha256: summary.entrypointSha256,
      fileCount: summary.fileCount,
    }];
  }));
  const state = {
    db: offlineDatabaseState(baselineRows, POST_CONTRACT, {
      fullRows: baselineFullRows,
      retainedRollbacks,
      retainedIntents,
      fenceGenerations,
    }),
    postContract: POST_CONTRACT,
    retainedAudit: retainedF27AuditInvariant({
      fences: fenceGenerations,
      rollbacks: retainedRollbacks,
      intents: retainedIntents,
    }),
    provider: Object.fromEntries(Object.entries(liveRecords).map(([slug, record]) => [
      slug, serializeFunction(record),
    ])),
    releaseExpected,
    n8n: {
      list: [{
        id: '1',
        active: true,
        versionId: 'v1',
        activeVersionId: 'v1',
      }],
      workflows: {
        1: {
          id: '1',
          name: 'private workflow name',
          active: true,
          versionId: 'v1',
          activeVersionId: 'v1',
          nodes: [{
            id: 'node-1',
            name: 'private node',
            type: 'n8n-nodes-base.noOp',
            typeVersion: 1,
            position: [0, 0],
            parameters: { sentinel: PRIVATE_SENTINEL },
          }],
          connections: {},
          settings: {},
          pinData: {},
          tags: [],
          updatedAt: 'ignored',
          staticData: { runtime: 'ignored' },
        },
      },
    },
    reconciler: {
      workflowPath: '.github/workflows/linear-deliverables-reconcile.yml',
      workflowState: 'disabled_manually',
      nonterminalRunCount: 0,
      recentRunWindow: [{
        id: '123',
        status: 'completed',
        conclusion: 'success',
        created_at: '2026-07-30T00:00:00Z',
        updated_at: '2026-07-30T00:01:00Z',
      }],
      releaseSha: RELEASE_SHA,
      closureSha256: reconcilerClosureSha256,
    },
    freshness: { ok: true, recentCount: 7, ageMinutes: 1 },
    networkMethods: ['GET', 'GET', 'GET'],
  };
  const stateFile = path.join(directory, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify(state), { mode: 0o600 });
  return {
    directory,
    baselineDirectory,
    snapshot,
    inbound,
    priorFour,
    reconciler,
    reconcilerClosureSha256,
    adapterModule,
    stateFile,
    postContract: POST_CONTRACT,
    database: DATABASE,
  };
}

function baselinePayload(file) {
  const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
  return JSON.parse(Buffer.from(envelope.payloadBase64, 'base64'));
}

function expectDatabaseFailure(state, baseline, code, mutate) {
  const candidate = clone(state);
  mutate(candidate);
  let thrown = null;
  try { verifyDatabaseState(candidate, baseline, POST_CONTRACT); }
  catch (error) { thrown = error; }
  assert.ok(thrown, `${code} was rejected`);
  assert.equal(thrown.code, code, `${code} was exact`);
  checks += 1;
  process.stdout.write(`  ok  ${code} predicate remains load-bearing\n`);
}

async function offlineProof() {
  const missingOriginMigration = Buffer.from('f27-missing-origin-main-proof', 'utf8');
  function missingOriginMainGit(calls) {
    return (executable, args) => {
      assert.equal(executable, 'git');
      const operation = args.slice(2);
      calls.push(operation);
      if (operation[0] === 'rev-parse' && operation[1] === 'HEAD') {
        return `${RELEASE_SHA}\n`;
      }
      if (operation[0] === 'rev-parse' && operation[1] === 'origin/main') {
        throw new Error('missing origin/main');
      }
      if (operation[0] === 'status') return '';
      if (operation[0] === 'show'
          && operation[1] === `${RELEASE_SHA}:${MIGRATION_PATH}`) {
        return missingOriginMigration;
      }
      throw new Error('unexpected git invocation');
    };
  }
  const differentOriginMainSha = RELEASE_SHA === 'a'.repeat(40)
    ? 'b'.repeat(40)
    : 'a'.repeat(40);
  function differentOriginMainGit(calls) {
    const missingOrigin = missingOriginMainGit(calls);
    return (executable, args) => {
      const operation = args.slice(2);
      if (operation[0] === 'rev-parse' && operation[1] === 'origin/main') {
        calls.push(operation);
        return `${differentOriginMainSha}\n`;
      }
      return missingOrigin(executable, args);
    };
  }
  const disposableGitCalls = [];
  const disposableRelease = releaseBinding(
    { releaseSha: RELEASE_SHA, postgresProof: true },
    {
      allowDirty: true,
      execGit: missingOriginMainGit(disposableGitCalls),
    },
  );
  ok(disposableRelease.releaseSha === RELEASE_SHA
    && disposableRelease.migrationSha256 === sha256(missingOriginMigration)
    && !disposableGitCalls.some(args => args[0] === 'rev-parse'
      && args[1] === 'origin/main'),
  'disposable proof binds HEAD and migration without resolving missing origin/main');
  const productionGitCalls = [];
  assert.throws(
    () => releaseBinding(
      { releaseSha: RELEASE_SHA, postgresProof: false },
      { execGit: missingOriginMainGit(productionGitCalls) },
    ),
    error => error
      && error.code === 'F27_FINAL_RELEASE_MISMATCH'
      && error.stage === 'release',
  );
  ok(productionGitCalls.some(args => args[0] === 'rev-parse'
    && args[1] === 'origin/main'),
  'production mode fails closed when origin/main is missing');
  const differentOriginProofCalls = [];
  const differentOriginProof = releaseBinding(
    { releaseSha: RELEASE_SHA, postgresProof: true },
    {
      allowDirty: true,
      execGit: differentOriginMainGit(differentOriginProofCalls),
    },
  );
  ok(differentOriginProof.releaseSha === RELEASE_SHA
    && differentOriginProof.migrationSha256 === sha256(missingOriginMigration)
    && !differentOriginProofCalls.some(args => args[0] === 'rev-parse'
      && args[1] === 'origin/main'),
  'disposable proof passes when the available origin/main value would differ');
  const differentOriginProductionCalls = [];
  assert.throws(
    () => releaseBinding(
      { releaseSha: RELEASE_SHA, postgresProof: false },
      { execGit: differentOriginMainGit(differentOriginProductionCalls) },
    ),
    error => error
      && error.code === 'F27_FINAL_RELEASE_MISMATCH'
      && error.stage === 'release',
  );
  ok(differentOriginProductionCalls.some(args => args[0] === 'rev-parse'
    && args[1] === 'origin/main'),
  'production mode rejects a valid origin/main SHA that differs from RELEASE_SHA');

  const fixtures = await buildOfflineFixtures();
  const capture = runCli(
    fixtures,
    'capture-baseline',
    [`--output-dir=${fixtures.baselineDirectory}`],
  );
  ok(capture.status === 0
    && capture.receipt.status === 'PASS'
    && capture.receipt.scope === 'DISPOSABLE_ONLY'
    && capture.receipt.terminal === 'F27_FINAL_BASELINE_CAPTURE_DISPOSABLE_ONLY'
    && capture.receipt.retained_rollback_count === 2
    && capture.receipt.retained_intent_count === 2
    && /^[0-9a-f]{64}$/.test(capture.receipt.retained_audit_sha256)
    && /^[0-9a-f]{64}$/.test(capture.receipt.preserved_fence_generations_sha256)
    && !capture.raw.includes('F27_FINAL_BASELINE_CAPTURE_OK'),
  'actual CLI capture-baseline returns one disposable-only terminal PASS',
  publicSafeCliFailure(capture));
  ok(!capture.raw.includes(PRIVATE_SENTINEL)
    && !capture.raw.includes(PROJECT_REF)
    && !capture.raw.includes(fixtures.snapshot.file),
  'capture receipt omits private rows, source, project ref, and paths');
  const baselineFiles = fs.readdirSync(fixtures.baselineDirectory);
  assert.equal(baselineFiles.length, 1);
  const baselineFile = path.join(fixtures.baselineDirectory, baselineFiles[0]);
  const baselineHash = sha256(fs.readFileSync(baselineFile));
  const verifyArgs = [
    `--baseline=${baselineFile}`,
    `--baseline-sha256=${baselineHash}`,
  ];
  const pass = runCli(fixtures, 'verify', verifyArgs);
  ok(pass.status === 0
    && pass.receipt.status === 'PASS'
    && pass.receipt.scope === 'DISPOSABLE_ONLY'
    && pass.receipt.terminal === 'F27_FINAL_VERIFICATION_DISPOSABLE_ONLY'
    && !pass.raw.includes('F27_FINAL_VERIFICATION_OK')
    && pass.receipt.open_rollbacks === 0
    && pass.receipt.replay_eligible === 0
    && pass.receipt.retained_rollback_count === 2
    && pass.receipt.retained_intent_count === 2
    && pass.receipt.final_rollback_count === 3
    && pass.receipt.final_intent_count === 3
    && pass.receipt.new_reserved_drill_count === 1
    && /^[0-9a-f]{64}$/.test(pass.receipt.retained_audit_sha256)
    && /^[0-9a-f]{64}$/.test(pass.receipt.final_audit_sha256)
    && /^[0-9a-f]{64}$/.test(pass.receipt.preserved_fence_generations_sha256)
    && stable(Object.keys(pass.receipt.section4_functions).sort())
      === stable([...SECTION4_SLUGS].sort())
    && SECTION4_SLUGS.every(slug => {
      const value = pass.receipt.section4_functions[slug];
      return value && /^[1-9][0-9]*$/.test(value.version)
        && /^[0-9a-f]{64}$/.test(value.source_sha256)
        && /^[0-9a-f]{64}$/.test(value.entrypoint_sha256)
        && value.verify_jwt === false;
    }),
  'actual CLI verifies the complete green fixture with a disposable-only terminal',
  publicSafeCliFailure(pass));
  ok(!capture.raw.includes('"scope":"PRODUCTION"')
    && !pass.raw.includes('"scope":"PRODUCTION"'),
  'disposable adapter runs cannot emit production-scoped evidence');
  assert.throws(
    () => assertBaselineScope({ scope: 'DISPOSABLE_ONLY' }),
    error => error && error.code === 'F27_FINAL_BASELINE_INVALID',
  );
  checks += 1;
  process.stdout.write('  ok  production verification rejects a disposable baseline\n');
  ok(!pass.raw.includes(PRIVATE_SENTINEL)
    && !pass.raw.includes(PROJECT_REF)
    && !pass.raw.includes('private workflow name')
    && !pass.raw.includes(fixtures.stateFile),
  'terminal PASS is public-safe');
  ok(Buffer.byteLength(pass.raw, 'utf8') < 12 * 1024
    && pass.receipt.network_mutation_calls === 0,
  'terminal PASS is bounded and GET-only');

  const payload = baselinePayload(baselineFile);
  const state = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  const greenFinal = state.db.final;
  const proof = verifyDatabaseState(clone(greenFinal), payload, POST_CONTRACT);
  ok(/^[0-9a-f]{64}$/.test(proof.drillAudit.sha256)
    && proof.finalAudit.generation_chain_invariants === 'PASS'
    && proof.finalAudit.fence_generations.video === 1
    && proof.finalAudit.rollback_row_count === 3,
  'generation-greater-than-zero retained chain plus exactly one new drill passes');

  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_PREEXISTING_QUEUE_DRIFT',
    candidate => { candidate.projectedRows[0].status = 'written'; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_UNEXPECTED_QUEUE_ROW',
    candidate => {
      candidate.fullRows.push({ ...clone(candidate.fullRows.at(-1)), id: 9002 });
      candidate.projectedRows.push({ ...clone(candidate.projectedRows.at(-1)), id: 9002 });
    });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_RUNTIME_FLAGS_DRIFT',
    candidate => { candidate.flags.linear_outbound_enabled.mode = 'live'; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_FLAG_FLIPS_DRIFT',
    candidate => { candidate.flagFlips.sha256 = '1'.repeat(64); });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_FENCES_DRIFT',
    candidate => {
      candidate.fenceGenerations.video += 1;
      candidate.fences.sha256 = '2'.repeat(64);
    });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_CLIENTS_DRIFT',
    candidate => { candidate.clients.sha256 = '3'.repeat(64); });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_TEAM_MEMBERS_DRIFT',
    candidate => { candidate.teamMembers.sha256 = '4'.repeat(64); });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_OPEN_ROLLBACK_PRESENT',
    candidate => { candidate.rollbacks[0].state = 'open'; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_RETAINED_AUDIT_DRIFT',
    candidate => { candidate.intents[0].reason = 'drifted retained reason'; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_REPLAY_ELIGIBLE',
    candidate => { candidate.replayEligible = 1; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_DRILL_AUDIT_INVALID',
    candidate => { candidate.fullRows.at(-1).linear_result.no_external_call = false; });
  expectDatabaseFailure(greenFinal, payload, 'F27_FINAL_POST_CONTRACT_DRIFT',
    candidate => { candidate.postContractSha256 = '5'.repeat(64); });

  const stateBeforeRed = fs.readFileSync(fixtures.stateFile);
  state.db.final.rollbacks[0].state = 'open';
  fs.writeFileSync(fixtures.stateFile, JSON.stringify(state), { mode: 0o600 });
  const seededBytes = fs.readFileSync(fixtures.stateFile);
  const red = runCli(fixtures, 'verify', verifyArgs);
  ok(red.status !== 0
    && red.receipt.status === 'FAIL'
    && red.receipt.code === 'F27_FINAL_OPEN_ROLLBACK_PRESENT',
  'actual CLI goes red on a seeded load-bearing open rollback');
  ok(fs.readFileSync(fixtures.stateFile).equals(seededBytes)
    && !red.raw.includes(PRIVATE_SENTINEL)
    && !red.raw.includes(PROJECT_REF),
  'refused verifier preserves the seeded violation and keeps failure public-safe');
  fs.writeFileSync(fixtures.stateFile, stateBeforeRed, { mode: 0o600 });

  const frozenState = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  frozenState.provider['calendar-upsert'].version = '999';
  fs.writeFileSync(fixtures.stateFile, JSON.stringify(frozenState), { mode: 0o600 });
  const frozenRed = runCli(fixtures, 'verify', verifyArgs);
  ok(frozenRed.status !== 0
    && frozenRed.receipt.code === 'F27_FINAL_FROZEN_WRITER_DRIFT',
  'actual CLI rejects a frozen-writer version-only deployment');
  fs.writeFileSync(fixtures.stateFile, stateBeforeRed, { mode: 0o600 });

  const n8nState = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  n8nState.n8n.workflows['1'].nodes[0].parameters.changed = true;
  fs.writeFileSync(fixtures.stateFile, JSON.stringify(n8nState), { mode: 0o600 });
  const n8nRed = runCli(fixtures, 'verify', verifyArgs);
  ok(n8nRed.status !== 0
    && n8nRed.receipt.code === 'F27_FINAL_N8N_INVENTORY_DRIFT',
  'actual CLI rejects a meaningful n8n definition drift');
  fs.writeFileSync(fixtures.stateFile, stateBeforeRed, { mode: 0o600 });

  const methodState = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  methodState.networkMethods.push('POST');
  fs.writeFileSync(fixtures.stateFile, JSON.stringify(methodState), { mode: 0o600 });
  const methodRed = runCli(fixtures, 'verify', verifyArgs);
  ok(methodRed.status !== 0
    && methodRed.receipt.code === 'F27_FINAL_NETWORK_METHOD_FORBIDDEN',
  'actual CLI rejects any adapter-reported network mutation method');

  const semanticA = workflowSemanticValue({
    id: 'w', name: 'W', active: true, versionId: 'v',
    nodes: [{ id: 'n', name: 'N', type: 'x', typeVersion: 1, position: [0, 0], parameters: { a: 1 } }],
    connections: {}, settings: {}, updatedAt: 'one', staticData: { one: true },
  });
  const semanticB = workflowSemanticValue({
    id: 'w', name: 'W', active: true, versionId: 'v',
    nodes: [{ id: 'n', name: 'N', type: 'x', typeVersion: 1, position: [0, 0], parameters: { a: 1 } }],
    connections: {}, settings: {}, updatedAt: 'two', staticData: { two: true },
  });
  ok(stable(semanticA) === stable(semanticB),
    'n8n semantic hash excludes execution-mutated metadata');
  semanticB.nodes[0].parameters.a = 2;
  ok(stable(semanticA) !== stable(semanticB),
    'n8n semantic hash includes meaningful node parameters');
  const webhookA = workflowSemanticValue({
    id: 'w', name: 'W', active: true, versionId: 'v',
    nodes: [{
      id: 'n', name: 'N', type: 'n8n-nodes-base.webhook', typeVersion: 1,
      position: [0, 0], parameters: {}, webhookId: 'webhook-a',
    }],
    connections: {}, settings: {},
  });
  const webhookB = workflowSemanticValue({
    id: 'w', name: 'W', active: true, versionId: 'v',
    nodes: [{
      id: 'n', name: 'N', type: 'n8n-nodes-base.webhook', typeVersion: 1,
      position: [0, 0], parameters: {}, webhookId: 'webhook-b',
    }],
    connections: {}, settings: {},
  });
  ok(stable(webhookA) !== stable(webhookB),
    'n8n semantic hash includes webhook identity');

  const mismatchedDetailN8n = {
    async listPage() {
      return {
        data: [{
          id: 'w',
          active: true,
          versionId: 'list-v1',
          activeVersionId: 'list-v1',
        }],
        nextCursor: null,
      };
    },
    async getWorkflow() {
      return {
        id: 'w', name: 'W', active: true, versionId: 'detail-v2',
        activeVersionId: 'detail-v2', nodes: [], connections: {}, settings: {},
      };
    },
  };
  await assert.rejects(() => n8nInventory(mismatchedDetailN8n), error =>
    error && error.code === 'F27_FINAL_N8N_UNSTABLE_READ');
  checks += 1;
  process.stdout.write('  ok  n8n list metadata is bound to each workflow detail\n');

  let listCalls = 0;
  const unstableN8n = {
    async listPage() {
      listCalls += 1;
      return {
        data: [{
          id: 'w',
          active: true,
          versionId: listCalls === 1 ? 'one' : 'two',
          activeVersionId: listCalls === 1 ? 'one' : 'two',
        }],
        nextCursor: null,
      };
    },
    async getWorkflow() {
      return {
        id: 'w', name: 'W', active: true, versionId: 'one',
        activeVersionId: 'one',
        nodes: [], connections: {}, settings: {},
      };
    },
  };
  await assert.rejects(() => n8nInventory(unstableN8n), error =>
    error && error.code === 'F27_FINAL_N8N_UNSTABLE_READ');
  checks += 1;
  process.stdout.write('  ok  n8n complete-list bookend rejects concurrent inventory drift\n');

  const versionlessN8n = {
    async listPage() {
      return { data: [{ id: 'w', active: true }], nextCursor: null };
    },
    async getWorkflow() {
      return {
        id: 'w', name: 'W', active: true,
        nodes: [], connections: {}, settings: {},
      };
    },
  };
  await assert.rejects(() => n8nInventory(versionlessN8n), error =>
    error && error.code === 'F27_FINAL_N8N_UNSTABLE_READ');
  checks += 1;
  process.stdout.write('  ok  n8n inventory rejects missing current and active version identity\n');

  const cursorlessN8n = {
    async listPage() {
      return {
        data: [{
          id: 'w',
          active: true,
          versionId: 'v1',
          activeVersionId: 'v1',
        }],
      };
    },
    async getWorkflow() {
      return {
        id: 'w', name: 'W', active: true, versionId: 'v1',
        activeVersionId: 'v1', nodes: [], connections: {}, settings: {},
      };
    },
  };
  await assert.rejects(() => n8nInventory(cursorlessN8n), error =>
    error && error.code === 'F27_FINAL_N8N_UNSTABLE_READ');
  checks += 1;
  process.stdout.write('  ok  n8n inventory requires an explicit terminal or continuation cursor\n');

  let n8nRequestCount = 0;
  assert.throws(
    () => createDefaultN8nAdapter(
      { record() { n8nRequestCount += 1; } },
      N8N_ORIGIN_SHA256,
      {
        N8N_BASE_URL: 'https://wrong-n8n.example.invalid',
        N8N_API_KEY: PRIVATE_SENTINEL,
      },
    ),
    error => error && error.code === 'F27_FINAL_N8N_UNSTABLE_READ',
  );
  ok(n8nRequestCount === 0,
    'wrong n8n origin hash is refused before any credentialed request');
  ok(canonicalN8nOrigin(`${N8N_ORIGIN}/`, N8N_ORIGIN_SHA256) === N8N_ORIGIN,
    'approved canonical n8n origin binds by public-safe hash');

  const futureFreshness = evaluateFreshness({
    ts: '2026-07-30T00:06:00.001Z',
    source: 'mirror',
    actor: 'Linear webhook',
    action: 'mirror_in_update',
  }, 1, new Date('2026-07-30T00:00:00.000Z'));
  ok(futureFreshness.ok === false && futureFreshness.ageMinutes < -5,
    'inbound freshness rejects timestamps beyond the five-minute future-skew allowance');

  assert.throws(
    () => validateReconcilerStateBookend({
      metadataBefore: {
        path: '.github/workflows/linear-deliverables-reconcile.yml',
        state: 'disabled_manually',
      },
      inventoryBefore: {
        totalCount: 1,
        recentRunWindow: [{ id: '1', status: 'completed' }],
      },
      nonterminalRunCount: 0,
      inventoryAfter: {
        totalCount: 2,
        recentRunWindow: [{ id: '1', status: 'completed' }, { id: '2', status: 'completed' }],
      },
      metadataAfter: {
        path: '.github/workflows/linear-deliverables-reconcile.yml',
        state: 'disabled_manually',
      },
      releaseSha: RELEASE_SHA,
      closureSha256: fixtures.reconcilerClosureSha256,
    }),
    error => error && error.code === 'F27_FINAL_RECONCILER_DRIFT',
  );
  checks += 1;
  process.stdout.write('  ok  reconciler state bookend rejects a tail run created after status scans\n');

  assert.throws(
    () => privateRegularFile(
      fixtures.inbound.file,
      fixtures.inbound.sha256,
      null,
      {
        aclOptions: {
          aclPlatform: 'win32',
          privateAclAdapter: { run() { return {}; } },
        },
      },
    ),
    error => error && error.code === 'F27_FINAL_ARTIFACT_INVALID',
  );
  checks += 1;
  process.stdout.write('  ok  private artifact reads fail closed on an invalid Windows ACL proof\n');

  let reconcilerRead = 0;
  await assert.rejects(() => reconcilerProof({
    async readState() {
      reconcilerRead += 1;
        return {
          workflowPath: '.github/workflows/linear-deliverables-reconcile.yml',
          workflowState: reconcilerRead === 1 ? 'disabled_manually' : 'active',
          nonterminalRunCount: 0,
          recentRunWindow: [{
            id: '123',
            status: 'completed',
            conclusion: 'success',
            created_at: '2026-07-30T00:00:00Z',
            updated_at: '2026-07-30T00:01:00Z',
          }],
          releaseSha: RELEASE_SHA,
        closureSha256: fixtures.reconcilerClosureSha256,
      };
    },
    async betweenScans() {},
  }, {
    releaseSha: RELEASE_SHA,
    closureSha256: fixtures.reconcilerClosureSha256,
  }), error => error && error.code === 'F27_FINAL_RECONCILER_IN_FLIGHT');
  checks += 1;
  process.stdout.write('  ok  reconciler disabled-state bookend rejects re-enable between zero scans\n');

  await assert.rejects(() => reconcilerProof({
    async readState() {
      return {
        workflowPath: '.github/workflows/linear-deliverables-reconcile.yml',
        workflowState: 'disabled_manually',
        nonterminalRunCount: 0,
        recentRunWindow: [{
          id: '999',
          status: 'in_progress',
          conclusion: '',
          created_at: '2026-07-30T00:00:00Z',
          updated_at: '2026-07-30T00:01:00Z',
        }],
        releaseSha: RELEASE_SHA,
        closureSha256: fixtures.reconcilerClosureSha256,
      };
    },
    async betweenScans() {},
  }, {
    releaseSha: RELEASE_SHA,
    closureSha256: fixtures.reconcilerClosureSha256,
  }), error => error && error.code === 'F27_FINAL_RECONCILER_DRIFT');
  checks += 1;
  process.stdout.write('  ok  reconciler core rejects a claimed-zero inventory containing an active run\n');

  const invalidReconciler = writePrivate(
    path.join(fixtures.directory, 'invalid-reconciler.capture'),
    Buffer.from('not a reconciler closure bundle', 'utf8'),
  );
  const invalidOutput = path.join(fixtures.directory, 'invalid-output');
  fs.mkdirSync(invalidOutput, { mode: 0o700 });
  const invalidCapture = runCli(
    { ...fixtures, reconciler: invalidReconciler },
    'capture-baseline',
    [`--output-dir=${invalidOutput}`],
  );
  ok(invalidCapture.status !== 0
    && invalidCapture.receipt.code === 'F27_FINAL_ARTIFACT_INVALID',
  'reconciler capture must unpack and bind its manifest even when the supplied outer hash matches');

  const snapshotState = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  const wrongSnapshot = makeSnapshot(
    fixtures.directory,
    snapshotState.db.capture.projectedRows,
    Object.keys(snapshotState.db.capture.projectedRows[0]),
    {
      flags: snapshotState.db.capture.flags,
      flag_flips_count: snapshotState.db.capture.flagFlips.count,
    },
    {
      name: 'wrong-migration.snapshot',
      metadata: { migration_sha256: '0'.repeat(64) },
    },
  );
  const wrongSnapshotOutput = path.join(fixtures.directory, 'wrong-snapshot-output');
  fs.mkdirSync(wrongSnapshotOutput, { mode: 0o700 });
  const wrongSnapshotCapture = runCli(
    { ...fixtures, snapshot: wrongSnapshot },
    'capture-baseline',
    [`--output-dir=${wrongSnapshotOutput}`],
  );
  ok(wrongSnapshotCapture.status !== 0
    && wrongSnapshotCapture.receipt.code === 'F27_FINAL_ARTIFACT_INVALID',
  'private snapshot is bound to the reviewed migration path and bytes');

  const wrongProviderRecord = sourceRecord(
    'linear-inbound',
    40,
    'export default "wrong-provider";\n',
  );
  wrongProviderRecord.provider.project_ref = 'zzzzzzzzzzzzzzzzzzzz';
  const wrongProviderBundle = await makeSourceBundle(
    fixtures.directory,
    'wrong-provider',
    { 'linear-inbound': wrongProviderRecord },
  );
  const wrongProviderOutput = path.join(fixtures.directory, 'wrong-provider-output');
  fs.mkdirSync(wrongProviderOutput, { mode: 0o700 });
  const wrongProviderCapture = runCli(
    { ...fixtures, inbound: wrongProviderBundle },
    'capture-baseline',
    [`--output-dir=${wrongProviderOutput}`],
  );
  ok(wrongProviderCapture.status !== 0
    && wrongProviderCapture.receipt.code === 'F27_FINAL_ARTIFACT_INVALID',
  'sealed provider source is bound to the reviewed project and CLI identity');

  assert.throws(
    () => functionSummary(
      { ...sourceRecord('linear-inbound', 40, 'export default 1;\n'), version: 'v40' },
      'linear-inbound',
    ),
    error => error && error.code === 'F27_FINAL_PROVIDER_UNSTABLE_READ',
  );
  checks += 1;
  process.stdout.write('  ok  provider version receipts require positive numeric version ids\n');

  assert.throws(
    () => parseArgs(['verify', '--release-sha=x']),
    error => error && error.code === 'F27_FINAL_ARGUMENT_REJECTED',
  );
  checks += 1;
  process.stdout.write('  ok  CLI rejects partial or unknown argument contracts\n');
  const wrongN8nScopeArgs = cliArguments(fixtures, 'verify', verifyArgs)
    .slice(1)
    .map(value => value.startsWith('--n8n-read-scope=')
      ? '--n8n-read-scope=PARTIAL_WORKFLOW_READ'
      : value);
  assert.throws(
    () => parseArgs(wrongN8nScopeArgs),
    error => error && error.code === 'F27_FINAL_ARGUMENT_REJECTED',
  );
  checks += 1;
  process.stdout.write('  ok  CLI requires explicit instance-wide n8n workflow-read confirmation\n');

  const publicUnexpected = publicFailure(new Error(PRIVATE_SENTINEL));
  ok(!JSON.stringify(publicUnexpected).includes(PRIVATE_SENTINEL)
    && publicUnexpected.code === 'F27_FINAL_UNEXPECTED_FAILURE',
  'unexpected errors collapse to a fixed public-safe failure');

  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'f27-final-verification.js'), 'utf8');
  ok((source.match(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/g) || []).length >= 2
    && !/\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\s+(?:INTO|TABLE|FUNCTION|TRIGGER|INDEX|SCHEMA|ROLE|EXTENSION)\b/i
      .test(stripBlockComments(source, '')),
  'database adapters contain only repeatable-read read-only proof SQL');
  ok(!/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(source),
    'production network adapters contain only GET methods');

  process.stdout.write(`F27_FINAL_VERIFIER_OFFLINE_PROOF_OK checks=${checks}\n`);
  return { fixtures, baselineFile, baselineHash };
}

function runPsql(databaseUrl, sql, file = null) {
  const url = new URL(databaseUrl);
  const env = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'disable',
  };
  const args = ['-X', '-q', '-v', 'ON_ERROR_STOP=1'];
  if (file) args.push('-f', file);
  else args.push('-At', '-c', sql);
  const result = spawnSync('psql', args, {
    cwd: ROOT, env, encoding: 'utf8', windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`psql proof setup failed: ${String(result.stderr).split(/\r?\n/)[0]}`);
  }
  return String(result.stdout || '').trim();
}

async function postgresProof() {
  const databaseUrl = process.env.F27_DISPOSABLE_DATABASE_URL;
  const expectedPost = process.env.F27_EXPECTED_POST_CONTRACT_SHA256;
  if (!databaseUrl || !/^[0-9a-f]{64}$/.test(String(expectedPost || ''))) {
    throw new Error('postgres proof requires F27_DISPOSABLE_DATABASE_URL and F27_EXPECTED_POST_CONTRACT_SHA256');
  }
  const url = new URL(databaseUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!/^f27[_$-]/.test(database)
      || !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('postgres proof requires an explicit loopback f27-prefixed database');
  }
  const fixtures = await buildOfflineFixtures();
  fixtures.database = database;
  fixtures.postContract = expectedPost;
  const state = JSON.parse(fs.readFileSync(fixtures.stateFile, 'utf8'));
  state.postContract = expectedPost;
  fs.writeFileSync(fixtures.stateFile, JSON.stringify(state), { mode: 0o600 });

  runPsql(databaseUrl, `
    CREATE TABLE IF NOT EXISTS public.team_members (
      id uuid PRIMARY KEY,
      team text NOT NULL,
      active boolean NOT NULL DEFAULT true
    );
    INSERT INTO public.team_members(id,team,active)
    VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','video',true)
    ON CONFLICT (id) DO NOTHING;
  `);
  const projection = JSON.parse(runPsql(databaseUrl, `
    SELECT json_agg(attname ORDER BY attnum)::text
    FROM pg_attribute
    WHERE attrelid='public.mirror_outbox'::regclass
      AND attnum>0 AND NOT attisdropped;
  `));
  const db = createPsqlDatabaseAdapter({
    databaseUrl,
    projectRef: PROJECT_REF,
    database,
    disposable: true,
  });
  const pre = await db.captureBaseline({ projection });
  fs.unlinkSync(fixtures.snapshot.file);
  fixtures.snapshot = makeSnapshot(
    path.dirname(fixtures.snapshot.file),
    pre.projectedRows,
    projection,
    { flags: pre.flags, flag_flips_count: pre.flagFlips.count },
    { database },
  );
  fs.rmSync(fixtures.baselineDirectory, { recursive: true });
  fs.mkdirSync(fixtures.baselineDirectory, { mode: 0o700 });

  const capture = runCli(
    fixtures,
    'capture-baseline',
    [`--output-dir=${fixtures.baselineDirectory}`],
    {
      F27_DISPOSABLE_DATABASE_URL: databaseUrl,
      F27_FINAL_USE_REAL_DB: '1',
    },
  );
  assert.equal(capture.receipt.status, 'PASS');
  const baselineFile = path.join(fixtures.baselineDirectory, fs.readdirSync(fixtures.baselineDirectory)[0]);
  const baselineHash = sha256(fs.readFileSync(baselineFile));

  runPsql(databaseUrl, '', path.join(ROOT, 'migrations', '2026-07-20-f27-team-rollback.sql'));
  const drillEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: database,
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: url.searchParams.get('sslmode') || 'disable',
  };
  const drill = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'f27-drill-runner.js'),
    '--transport=psql',
    '--confirm=F27_DISPOSABLE_DRILL_ONLY',
    `--confirm-database=${database}`,
    '--actor=f27-final-verifier-proof',
  ], {
    cwd: ROOT, env: drillEnv, encoding: 'utf8', windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (drill.status !== 0) throw new Error(`disposable drill failed: ${drill.stderr}`);

  const verifyArgs = [
    `--baseline=${baselineFile}`,
    `--baseline-sha256=${baselineHash}`,
  ];
  const pass = runCli(fixtures, 'verify', verifyArgs, {
    F27_DISPOSABLE_DATABASE_URL: databaseUrl,
    F27_FINAL_USE_REAL_DB: '1',
  });
  assert.equal(pass.receipt.status, 'PASS');

  const rollbackId = runPsql(databaseUrl, `
    INSERT INTO public.track_b_team_rollbacks(
      team,is_drill,state,expected_authority,prior_outbound,prior_parity,
      fence_generation,actor
    ) VALUES (
      'video',false,'open',
      '{"video":"linear","graphics":"linear"}',
      '{"mode":"off"}','{"enabled":false}',0,'f27-final-red-proof'
    ) RETURNING id::text;
  `);
  const red = runCli(fixtures, 'verify', verifyArgs, {
    F27_DISPOSABLE_DATABASE_URL: databaseUrl,
    F27_FINAL_USE_REAL_DB: '1',
  });
  assert.notEqual(red.status, 0);
  assert.equal(red.receipt.code, 'F27_FINAL_OPEN_ROLLBACK_PRESENT');
  const persisted = runPsql(databaseUrl,
    `SELECT count(*) FROM public.track_b_team_rollbacks WHERE id='${rollbackId}'::uuid AND state='open';`);
  assert.equal(persisted, '1');
  process.stdout.write('F27_FINAL_VERIFIER_POSTGRES_RED_PROOF_OK persisted_open_rollback=1\n');
}

async function main() {
  await offlineProof();
  if (process.argv.includes('--postgres-proof')) await postgresProof();
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
