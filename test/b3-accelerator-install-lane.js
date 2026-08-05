'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CONFIRMATION,
  DDL_QUIESCENCE_CONFIRMATION,
  EXPECTED_FAILURE_INVENTORY_SHA256,
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_PRECHECK_SHA256,
  FAILURE_INVENTORY_RELATIVE_PATH,
  MIGRATION_RELATIVE_PATH,
  PRECHECK_RELATIVE_PATH,
  AcceleratorInstallError,
  assertMigrationSource,
  installAccelerators,
  parseProductionDatabaseUrl,
  publicFailure,
  sha256,
} = require('../scripts/b3-accelerator-install.js');

let failures = 0;
function ok(value, message) {
  if (value) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}
function refusal(callback, expected) {
  try { callback(); return false; }
  catch (error) {
    return error instanceof AcceleratorInstallError && error.code === expected;
  }
}

const root = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'b3-accelerator-install.yml'), 'utf8',
);
const installerSource = fs.readFileSync(
  path.join(root, 'scripts', 'b3-accelerator-install.js'), 'utf8',
);
const migration = fs.readFileSync(path.join(root, ...MIGRATION_RELATIVE_PATH.split('/')));
const failureInventory = fs.readFileSync(
  path.join(root, ...FAILURE_INVENTORY_RELATIVE_PATH.split('/')),
);

const triggerBlock = (workflow.match(/^on:\s*\n([\s\S]*?)^permissions:/m) || [])[1] || '';
ok(/^  workflow_dispatch:\s*$/m.test(triggerBlock)
    && !/^  (?:push|pull_request|schedule|workflow_run|repository_dispatch):/m.test(triggerBlock),
'the production lane has workflow_dispatch as its only trigger');
ok(/permissions:\s*\n  contents: read/.test(workflow)
    && /environment: production/.test(workflow)
    && /group: b3-global-failure-accelerator-production/.test(workflow)
    && /cancel-in-progress: false/.test(workflow),
'the job has read-only repository permission, the production Environment, and a non-canceling singleton');
ok(/commit_sha:[\s\S]*migration_sha256:[\s\S]*confirm:[\s\S]*ddl_quiescence_confirm:/.test(triggerBlock)
    && workflow.includes(CONFIRMATION)
    && workflow.includes(DDL_QUIESCENCE_CONFIRMATION)
    && workflow.includes(EXPECTED_MIGRATION_SHA256)
    && workflow.includes(EXPECTED_PRECHECK_SHA256)
    && workflow.includes(EXPECTED_FAILURE_INVENTORY_SHA256),
'dispatch requires the exact release, artifact digests, and operation confirmation');
ok(/WORKFLOW_RUN_ATTEMPT[\s\S]*= "1"/.test(workflow)
    && /WORKFLOW_REF[\s\S]*refs\/heads\/main/.test(workflow)
    && (workflow.match(/git ls-remote origin refs\/heads\/main/g) || []).length === 1
    && /remote_main[\s\S]*REQUESTED_COMMIT_SHA/.test(workflow)
    && installerSource.includes(
      "'git', ['-C', repoRoot, 'ls-remote', 'origin', 'refs/heads/main']",
    )
    && /const gitOptions[\s\S]*env: safeProcessEnv\(\{\}\)/.test(installerSource)
    && /preSpawnReleaseInfo \|\| options\.releaseInfo \|\| releaseInfo\(repoRoot\)/
      .test(installerSource),
'a first-attempt dispatch and the immediate pre-connect recheck must equal the current remote main head');
ok(/actions\/checkout@[0-9a-f]{40}/.test(workflow)
    && !/uses:\s*[^\s]+@v\d+/m.test(workflow),
'the sole third-party action is pinned to a full commit SHA');
ok((workflow.match(/\$\{\{ secrets\.B3_ACCELERATOR_DATABASE_URL \}\}/g) || []).length === 1
    && !/B3_ACCELERATOR_DATABASE_URL[^\n]*(?:GITHUB_ENV|GITHUB_OUTPUT|echo|printf)/.test(workflow)
    && !/upload-artifact/.test(workflow),
'the database URL enters one step once and cannot reach outputs, summaries, or artifacts');
ok(/mode_and_type[\s\S]*100644 blob/.test(workflow)
    && /sha256sum "\$MIGRATION_PATH"/.test(workflow)
    && /precheck_mode_and_type[\s\S]*100644 blob/.test(workflow)
    && /sha256sum "\$PRECHECK_PATH"/.test(workflow)
    && /inventory_mode_and_type[\s\S]*100644 blob/.test(workflow)
    && /sha256sum "\$FAILURE_INVENTORY_PATH"/.test(workflow)
    && (workflow.match(/git cat-file blob/g) || []).length === 3,
'the workflow refuses artifact type drift and checks filesystem plus committed-byte digests');
ok((workflow.match(/node scripts\/b3-accelerator-install\.js/g) || []).length === 1
    && !/continue-on-error:\s*true/.test(workflow)
    && !/\b(?:retry|rerun)\s*\(/i.test(workflow)
    && !/drop index/i.test(workflow),
'one connected operator invocation has no retry, error continuation, or cleanup DDL');

assertMigrationSource(migration, EXPECTED_MIGRATION_SHA256);
ok(sha256(migration) === EXPECTED_MIGRATION_SHA256,
'the source-only accelerator artifact still has the reviewed exact digest');
ok(sha256(failureInventory) === EXPECTED_FAILURE_INVENTORY_SHA256,
'the read-only failure-inventory artifact still has the reviewed exact digest');
ok(/'-X', '--quiet', '--set=ON_ERROR_STOP=1', '--set=AUTOCOMMIT=on', '--file=-'/.test(installerSource)
    && !/--single-transaction|['"]-1['"]/.test(installerSource),
'the forward operator uses psqlrc-disabled error-stop autocommit with stdin input');
ok(/precheck[\s\S]*migration[\s\S]*postcheck[\s\S]*sessionReceipt/.test(installerSource)
    && /set search_path = pg_catalog, public/.test(installerSource)
    && /NON_PRISTINE_INDEX_STATE/.test(installerSource)
    && /retry_permitted:\s*false/.test(installerSource),
'pristine refusal precedes the exact migration and post-closure, with retry disabled');

const projectRef = 'abcdefghijklmnopqrst';
const serviceRolePayload = Buffer.from(JSON.stringify({
  iss: 'supabase', ref: projectRef, role: 'service_role', exp: 4102444800,
})).toString('base64url');
const serviceRoleKey = `header.${serviceRolePayload}.signature`;
const secretCanary = 'private-database-canary';
const clientCanary = 'private-client-canary';
const databaseUrl = `postgresql://postgres.${projectRef}:${secretCanary}`
  + '@aws-0-us-east-1.pooler.supabase.com:5432/postgres?sslmode=require';
const releaseSha = 'a'.repeat(40);
const sourceDigest = 'b'.repeat(64);
const aclDigest = 'c'.repeat(64);
const eventDigest = 'd'.repeat(64);
const settingsDigest = 'e'.repeat(64);
const precheck = fs.readFileSync(
  path.join(root, ...PRECHECK_RELATIVE_PATH.split('/')),
);
const postcheck = Buffer.from(precheck);

function receiptLines(overrides = {}) {
  const pre = {
    contract: 'syncview-b3-accelerator-precheck-v1',
    status: 'PASS',
    index_state: 'FRESH',
    named_index_count: 0,
    exact_index_count: 0,
    invalid_index_count: 0,
    ready_index_count: 0,
    live_index_count: 0,
    url_projector_dependency_count: 0,
    source_exact_count: 10,
    source_digest: sourceDigest,
    acl_digest: aclDigest,
    event_trigger_exact_count: 6,
    event_trigger_digest: eventDigest,
    active_build_count: 0,
    prepared_transaction_count: 0,
    long_transaction_count: 0,
    settings_digest: settingsDigest,
    b3_receipt_count: 0,
    b3_receipt_digest: 'f'.repeat(64),
    row_write_source_contract: 'NO_APPLICATION_ROW_DML_REACHABLE',
    search_path_pinned: true,
    transaction_read_only: true,
    current_xact_id_assigned: false,
    ...(overrides.pre || {}),
  };
  const post = {
    contract: 'syncview-b3-accelerator-postcheck-v1',
    status: 'PASS',
    index_state: 'EXACT_COMPLETE',
    named_index_count: 2,
    exact_index_count: 2,
    invalid_index_count: 0,
    ready_index_count: 2,
    live_index_count: 2,
    url_projector_dependency_count: 1,
    source_exact_count: 10,
    source_digest: sourceDigest,
    acl_digest: aclDigest,
    event_trigger_exact_count: 6,
    event_trigger_digest: eventDigest,
    active_build_count: 0,
    prepared_transaction_count: 0,
    long_transaction_count: 0,
    settings_digest: settingsDigest,
    b3_receipt_count: 0,
    b3_receipt_digest: 'f'.repeat(64),
    row_write_source_contract: 'NO_APPLICATION_ROW_DML_REACHABLE',
    search_path_pinned: true,
    transaction_read_only: true,
    current_xact_id_assigned: false,
    ...(overrides.post || {}),
  };
  const session = {
    contract: 'syncview-b3-accelerator-session-v1',
    status: 'PASS',
    same_session: true,
    search_path_pinned: true,
    ddl_quiescence_confirmed: true,
    current_xact_id_assigned: false,
    migration_sha256: EXPECTED_MIGRATION_SHA256,
    ...(overrides.session || {}),
  };
  return Buffer.from([pre, post, session].map(row => JSON.stringify(row)).join('\n') + '\n');
}

function freshFailureInventoryLines(overrides = {}) {
  return Buffer.from(JSON.stringify({
    contract: 'syncview-b3-accelerator-failure-inventory-v1',
    status: 'PASS',
    inventory_state: 'FRESH',
    trimmed_id_index_state: 'MISSING',
    exact_url_index_state: 'MISSING',
    named_index_count: 0,
    exact_index_count: 0,
    equivalent_other_count: 0,
    invalid_index_count: 0,
    ready_index_count: 0,
    live_index_count: 0,
    url_projector_dependency_count: 0,
    active_build_count: 0,
    search_path_pinned: true,
    transaction_read_only: true,
    current_xact_id_assigned: false,
    ...overrides,
  }) + '\n');
}

function options(privateRoot, adapter, overrides = {}) {
  return {
    confirmation: CONFIRMATION,
    ddlQuiescenceConfirmation: DDL_QUIESCENCE_CONFIRMATION,
    releaseSha,
    expectedMigrationSha256: EXPECTED_MIGRATION_SHA256,
    databaseUrl,
    serviceRoleKey,
    repoRoot: root,
    releaseInfo: { head: releaseSha, originMain: releaseSha, dirty: false },
    migrationBytes: migration,
    precheckBytes: precheck,
    postcheckBytes: postcheck,
    failureInventoryBytes: failureInventory,
    privateRoot,
    psqlAdapter: adapter,
    ...overrides,
  };
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'b3-accelerator-lane-test-'));
try {
  let connectedCalls = 0;
  let call;
  const result = installAccelerators(options(tempRoot, {
    run(args, env, cwd, input) {
      connectedCalls += 1;
      call = { args, env, cwd, input };
      return { status: 0, stdout: receiptLines(), stderr: Buffer.alloc(0) };
    },
    inventory() {
      throw new Error('success must not open the failure-inventory connection');
    },
  }));
  ok(connectedCalls === 1
      && call.args.join(' ') === '-X --quiet --set=ON_ERROR_STOP=1 --set=AUTOCOMMIT=on --file=-'
      && call.cwd === root
      && call.env.PGDATABASE === databaseUrl
      && call.env.PGSSLMODE === 'require'
      && !JSON.stringify(call.args).includes(secretCanary),
  'the real boundary makes one session-mode psql call and keeps the credential off argv');
  const precheckOffset = call.input.indexOf(precheck);
  const migrationOffset = call.input.indexOf(migration);
  const postcheckOffset = call.input.indexOf(
    postcheck, precheckOffset + precheck.length,
  );
  const searchPathOffset = call.input.indexOf(
    Buffer.from('set search_path = pg_catalog, public;'),
  );
  ok(searchPathOffset >= 0
      && searchPathOffset < precheckOffset
      && precheckOffset >= 0
      && migrationOffset >= 0
      && postcheckOffset >= 0
      && precheckOffset < migrationOffset
      && migrationOffset < postcheckOffset
      && call.input.includes(Buffer.from('\\set AUTOCOMMIT on')),
  'the single stream orders precheck, exact artifact, postcheck, and literal autocommit');
  ok(result.status === 'PASS'
      && result.exact_index_count === 2
      && result.invalid_index_count === 0
      && result.same_session === true
      && result.search_path_pinned === true
      && result.ddl_quiescence_confirmed === true
      && result.catalog_mutation_witness_unchanged === true
      && result.retry_permitted === false
      && !JSON.stringify(result).includes(secretCanary)
      && !JSON.stringify(result).includes(clientCanary),
  'success emits only the allowlisted public-safe closure receipt');
  ok(fs.readdirSync(tempRoot).length === 0,
  'the raw psql transcript is removed after its digest is bound into the receipt');

  let precheckSabotageCalls = 0;
  ok(refusal(() => installAccelerators(options(tempRoot, {
    run() { precheckSabotageCalls += 1; return {}; },
  }, {
    precheckBytes: Buffer.concat([precheck, Buffer.from('\n-- digest sabotage\n')]),
  })), 'PRECHECK_SOURCE_REJECTED') && precheckSabotageCalls === 0,
  'a precheck digest sabotage refuses before any connected process');

  let mutationInventoryCalls = 0;
  ok(refusal(() => installAccelerators(options(tempRoot, {
    run() {
      return {
        status: 0,
        stdout: receiptLines({ post: { source_digest: '0'.repeat(64) } }),
        stderr: Buffer.alloc(0),
      };
    },
    inventory() {
      mutationInventoryCalls += 1;
      return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
    },
  })), 'SOURCE_POST_CLOSURE_FAILED') && mutationInventoryCalls === 1,
  'a change-and-restore catalog tuple witness refuses success and opens only the read-only inventory');

  let failedCalls = 0;
  let failedInventoryCalls = 0;
  let failed;
  try {
    installAccelerators(options(tempRoot, {
      run() {
        failedCalls += 1;
        return {
          status: 3,
          stdout: Buffer.from(clientCanary),
          stderr: Buffer.from(`ERROR: B3ACC_NON_PRISTINE_INDEX_STATE ${secretCanary}`),
        };
      },
      inventory() {
        failedInventoryCalls += 1;
        return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
      },
    }));
  } catch (error) { failed = error; }
  const failureReceipt = JSON.stringify(publicFailure(failed));
  ok(failedCalls === 1
      && failedInventoryCalls === 1
      && failed instanceof AcceleratorInstallError
      && failed.code === 'NON_PRISTINE_INDEX_STATE'
      && failed.receipt.retry_permitted === false
      && failed.receipt.cleanup_permitted === false
      && failed.receipt.failure_inventory.inventory_state === 'FRESH'
      && !failureReceipt.includes(secretCanary)
      && !failureReceipt.includes(clientCanary),
  'a non-pristine state gets one read-only inventory, no forward retry, and no raw-output leak');
  ok(fs.readdirSync(tempRoot).length === 0,
  'the raw failure transcript is also removed after its private digest is captured');

  let unknownCalls = 0;
  let unknownInventoryCalls = 0;
  ok(refusal(() => installAccelerators(options(tempRoot, {
    run() {
      unknownCalls += 1;
      return { status: null, signal: 'SIGTERM', error: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    },
    inventory() {
      unknownInventoryCalls += 1;
      return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
    },
  })), 'OUTCOME_UNKNOWN') && unknownCalls === 1 && unknownInventoryCalls === 1,
  'a lost or killed forward connection stays outcome-unknown after one diagnostic inventory');

  for (const stderr of [
    'ERROR: B3ACC_NON_PRISTINE_INDEX_STATE',
    'ERROR: b3_scoped_accelerator_closure_failed',
    'ERROR: canceling statement due to lock timeout',
  ]) {
    let mixedForwardCalls = 0;
    let mixedInventoryCalls = 0;
    ok(refusal(() => installAccelerators(options(tempRoot, {
      run() {
        mixedForwardCalls += 1;
        return {
          status: null,
          signal: 'SIGTERM',
          error: true,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(stderr),
        };
      },
      inventory() {
        mixedInventoryCalls += 1;
        return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
      },
    })), 'OUTCOME_UNKNOWN')
        && mixedForwardCalls === 1
        && mixedInventoryCalls === 1,
    `transport ambiguity outranks the prior diagnostic marker: ${stderr}`);
  }

  for (const [stderr, expectedCode] of [
    ['ERROR: canceling statement due to lock timeout', 'LOCK_TIMEOUT'],
    ['ERROR: canceling statement due to statement timeout', 'STATEMENT_TIMEOUT'],
    ['ERROR: canceling statement due to user request', 'OPERATOR_OR_SERVER_CANCELLATION'],
    ['ERROR: canceling statement due to conflict with recovery', 'OTHER_STATEMENT_CANCELLATION'],
  ]) {
    ok(refusal(() => installAccelerators(options(tempRoot, {
      run() {
        return {
          status: 3,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(stderr),
        };
      },
      inventory() {
        return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
      },
    })), expectedCode),
    `a completed server refusal keeps its exact public-safe class: ${expectedCode}`);
  }

  ok(refusal(() => installAccelerators(options(tempRoot, {
    run() { return { status: 0, stdout: receiptLines({ post: { invalid_index_count: 1 } }), stderr: Buffer.alloc(0) }; },
    inventory() {
      return { status: 0, stdout: freshFailureInventoryLines(), stderr: Buffer.alloc(0) };
    },
  })), 'INDEX_POST_CLOSURE_FAILED'),
  'an invalid named index after the build is a hard post-closure refusal');

  ok(refusal(() => parseProductionDatabaseUrl(
    databaseUrl.replace(':5432/', ':6543/'), projectRef,
  ), 'DATABASE_PROJECT_OR_SESSION_BINDING_FAILED'),
  'the transaction-pooler port is rejected before psql');
  ok(refusal(() => parseProductionDatabaseUrl(
    databaseUrl.replace(projectRef, 'zzzzzzzzzzzzzzzzzzzz'), projectRef,
  ), 'DATABASE_PROJECT_OR_SESSION_BINDING_FAILED'),
  'a database URL bound to another project is rejected before psql');
  ok(refusal(() => parseProductionDatabaseUrl(
    `${databaseUrl}&sslmode=disable`, projectRef,
  ), 'DATABASE_URL_OPTION_REJECTED'),
  'duplicate TLS options are rejected instead of passing an ambiguous URI to libpq');
  ok(refusal(() => parseProductionDatabaseUrl(
    databaseUrl.replace('sslmode=require', 'sslmode='), projectRef,
  ), 'DATABASE_URL_OPTION_REJECTED'),
  'an explicitly empty TLS option is rejected instead of being treated as absent');
  ok(refusal(() => installAccelerators(options(tempRoot, { run() {} }, {
    confirmation: '',
  })), 'CONFIRMATION_REQUIRED'),
  'missing literal owner confirmation refuses before any connected process');
  ok(refusal(() => installAccelerators(options(tempRoot, { run() {} }, {
    ddlQuiescenceConfirmation: '',
  })), 'DDL_QUIESCENCE_CONFIRMATION_REQUIRED'),
  'missing literal DDL-quiescence confirmation refuses before any connected process');
  ok(refusal(() => installAccelerators(options(tempRoot, { run() {} }, {
    releaseInfo: { head: releaseSha, originMain: 'f'.repeat(40), dirty: false },
  })), 'RELEASE_SHA_MISMATCH'),
  'release head and independently refreshed origin/main must be identical');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

if (failures) {
  console.error(`\n${failures} B3 accelerator install-lane check(s) failed`);
  process.exit(1);
}
console.log('\nB3 accelerator install-lane source and boundary checks passed');
