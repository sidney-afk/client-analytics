#!/usr/bin/env node
'use strict';

/*
 * One-shot installer for the B3 global-failure predicate accelerators.
 *
 * This operator is deliberately narrower than a general migration runner. It
 * accepts one exact source artifact, starts only from a pristine zero-index
 * state, uses one PostgreSQL session with psql autocommit enabled, and never
 * retries, resumes, drops, or repairs an index. Raw psql output stays in a
 * private runner-temporary file and is deleted before the process returns;
 * stdout/stderr receive only fixed public-safe receipts and refusal codes.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION_RELATIVE_PATH =
  'migrations/2026-08-05-b3-scoped-global-failure-accelerators.sql';
const PRECHECK_RELATIVE_PATH = 'scripts/b3-accelerator-precheck.sql';
const FAILURE_INVENTORY_RELATIVE_PATH =
  'scripts/b3-accelerator-failure-inventory.sql';
// The same catalog assertion is deliberately executed on both sides of the
// DDL with a fixed phase variable. That avoids two drifting copies of the ten-
// function/ACL/event-trigger closure while still producing distinct contracts.
const POSTCHECK_RELATIVE_PATH = PRECHECK_RELATIVE_PATH;
const EXPECTED_MIGRATION_SHA256 =
  '5154df84d66f05b0527c0174b5b74f8d97d1136e687b57125b7f91390b72bab3';
const EXPECTED_PRECHECK_SHA256 =
  '4629749ea90efd6c7ffc924024c9005b05ab91c35e2e161ff17da246ea3c0a21';
const EXPECTED_FAILURE_INVENTORY_SHA256 =
  '074ef2c6766862802e1691a540a0e65217b9a98d3a9986f07e2a888989086b48';
const CONFIRMATION = 'INSTALL_B3_ACCELERATOR_SCHEMA_ONLY';
const DDL_QUIESCENCE_CONFIRMATION =
  'I_CONFIRM_NO_PRIVILEGED_DDL_OR_RESTART_FOR_80_MINUTES';
const RELEASE_RE = /^[a-f0-9]{40}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const PROJECT_REF_RE = /^[a-z0-9]{20}$/;
const PRECHECK_CONTRACT = 'syncview-b3-accelerator-precheck-v1';
const POSTCHECK_CONTRACT = 'syncview-b3-accelerator-postcheck-v1';
const SESSION_CONTRACT = 'syncview-b3-accelerator-session-v1';
const FAILURE_INVENTORY_CONTRACT =
  'syncview-b3-accelerator-failure-inventory-v1';
// The database-side statement budgets remain unchanged. These are only child-
// process ceilings and deliberately exceed the mechanical sum of the two
// two-statement catalog checks, five ten-minute migration statements, and the
// final session receipt. They do not extend any database lock duration.
const FORWARD_PROCESS_TIMEOUT_MS = 72 * 60_000;
const INVENTORY_PROCESS_TIMEOUT_MS = 3 * 60_000;

class AcceleratorInstallError extends Error {
  constructor(code, receipt = null) {
    super(code);
    this.name = 'AcceleratorInstallError';
    this.code = code;
    this.receipt = receipt;
  }
}

function fail(code, receipt) {
  throw new AcceleratorInstallError(code, receipt);
}

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readExactFile(repoRoot, relativePath) {
  const absolute = path.join(repoRoot, ...relativePath.split('/'));
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (_) {
    fail('SOURCE_FILE_MISSING');
  }
  if (!stat.isFile() || stat.isSymbolicLink()) fail('SOURCE_FILE_TYPE_REJECTED');
  try {
    return fs.readFileSync(absolute);
  } catch (_) {
    fail('SOURCE_FILE_READ_FAILED');
  }
}

function releaseInfo(repoRoot = ROOT) {
  try {
    const gitOptions = {
      encoding: 'utf8', windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: safeProcessEnv({}),
    };
    const remoteLine = clean(execFileSync(
      'git', ['-C', repoRoot, 'ls-remote', 'origin', 'refs/heads/main'],
      gitOptions,
    ));
    const remoteFields = remoteLine.split(/\s+/);
    return {
      head: clean(execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
        ...gitOptions,
      })),
      originMain: remoteFields.length === 2 ? remoteFields[0] : '',
      dirty: Boolean(clean(execFileSync(
        'git', ['-C', repoRoot, 'status', '--porcelain=v1', '--untracked-files=all'], {
          ...gitOptions,
        },
      ))),
    };
  } catch (_) {
    fail('RELEASE_PROOF_FAILED');
  }
}

function assertRelease(requested, observed) {
  if (!RELEASE_RE.test(requested)) fail('RELEASE_SHA_INVALID');
  if (!observed
      || observed.head !== requested
      || observed.originMain !== requested) {
    fail('RELEASE_SHA_MISMATCH');
  }
  if (observed.dirty) fail('DIRTY_SOURCE_REJECTED');
}

function stripLineComments(source) {
  return source.split(/\r?\n/).map(line => line.replace(/--.*$/, '')).join('\n');
}

function stripSingleQuotedLiterals(source) {
  return source.replace(/'(?:''|[^'])*'/g, "''");
}

function assertMigrationSource(bytes, expectedHash) {
  if (expectedHash !== EXPECTED_MIGRATION_SHA256
      || sha256(bytes) !== EXPECTED_MIGRATION_SHA256) {
    fail('MIGRATION_HASH_MISMATCH');
  }
  const source = Buffer.from(bytes).toString('utf8');
  const executable = stripSingleQuotedLiterals(stripLineComments(source));
  if (/^\s*\\/m.test(executable)) fail('MIGRATION_PSQL_META_COMMAND_REJECTED');
  if (/^\s*(?:begin|commit|rollback(?:\s+to(?:\s+savepoint)?\s+[a-z0-9_]+)?|savepoint\s+[a-z0-9_]+|start\s+transaction|set\s+transaction[^;]*)\s*;\s*$/im.test(executable)) {
    fail('MIGRATION_TRANSACTION_WRAPPER_REJECTED');
  }
  if (/\b(?:insert|update|delete|merge|truncate|copy|call|grant|revoke|alter|execute|perform)\b/i.test(executable)
      || /\bcreate\s+(?:table|function|procedure|trigger|rule|policy|view|materialized|schema|extension|role)\b/i.test(executable)
      || /\bdrop\s+(?:table|function|procedure|trigger|rule|policy|view|materialized|schema|extension|role)\b/i.test(executable)) {
    fail('MIGRATION_ROW_OR_AUTHORITY_MUTATION_REJECTED');
  }
  const createIndexes = executable.match(/\bcreate\s+index\s+concurrently\b/gi) || [];
  const analyze = executable.match(/\banalyze\s+public\.deliverables\s*;/gi) || [];
  const doBlocks = executable.match(/\bdo\s+\$[a-z_]+\$/gi) || [];
  if (createIndexes.length !== 2 || analyze.length !== 1 || doBlocks.length !== 2) {
    fail('MIGRATION_STATEMENT_CONTRACT_REJECTED');
  }
}

function decodeServiceRoleProjectRef(token) {
  const parts = clean(token).split('.');
  if (parts.length !== 3) fail('SERVICE_ROLE_BINDING_FAILED');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (_) {
    fail('SERVICE_ROLE_BINDING_FAILED');
  }
  if (!payload
      || payload.iss !== 'supabase'
      || payload.role !== 'service_role'
      || !PROJECT_REF_RE.test(clean(payload.ref))) {
    fail('SERVICE_ROLE_BINDING_FAILED');
  }
  return clean(payload.ref);
}

function parseProductionDatabaseUrl(input, projectRef) {
  let parsed;
  try { parsed = new URL(input); } catch (_) { fail('DATABASE_URL_INVALID'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || parsed.hash
      || !parsed.hostname
      || !parsed.username
      || !parsed.password) {
    fail('DATABASE_URL_INVALID');
  }
  let database;
  let username;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    username = decodeURIComponent(parsed.username);
  } catch (_) {
    fail('DATABASE_URL_INVALID');
  }
  const hostname = parsed.hostname.toLowerCase();
  const port = parsed.port || '5432';
  const direct = hostname === `db.${projectRef}.supabase.co`
    && username === 'postgres';
  const sessionPooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(hostname)
    && username === `postgres.${projectRef}`;
  if ((!direct && !sessionPooler) || port !== '5432' || database !== 'postgres') {
    fail('DATABASE_PROJECT_OR_SESSION_BINDING_FAILED');
  }
  const keys = [...new Set([...parsed.searchParams.keys()])];
  if (keys.some(key => key !== 'sslmode')) fail('DATABASE_URL_OPTION_REJECTED');
  const sslmodes = parsed.searchParams.getAll('sslmode');
  if (sslmodes.length > 1 || (sslmodes.length === 1 && sslmodes[0] === '')) {
    fail('DATABASE_URL_OPTION_REJECTED');
  }
  const sslmode = sslmodes.length === 1 ? sslmodes[0] : 'require';
  if (!['require', 'verify-full'].includes(sslmode)) fail('DATABASE_TLS_REQUIRED');
  return {
    PGDATABASE: clean(input),
    PGSSLMODE: sslmode,
    PGAPPNAME: 'syncview-b3-accelerator-install',
    PGCONNECT_TIMEOUT: '15',
    PGCLIENTENCODING: 'UTF8',
  };
}

function safeProcessEnv(connectionEnv) {
  const names = [
    'PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'ComSpec',
    'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL',
  ];
  const env = {};
  for (const name of names) if (process.env[name] != null) env[name] = process.env[name];
  return { ...env, ...connectionEnv };
}

function buildPsqlStream(precheck, migration, postcheck, migrationHash) {
  const prelude = Buffer.from([
    '\\set ON_ERROR_STOP on',
    '\\set AUTOCOMMIT on',
    '\\pset format unaligned',
    '\\pset tuples_only on',
    '\\pset footer off',
    '\\pset pager off',
    'set search_path = pg_catalog, public;',
    'select pg_backend_pid() as b3_accelerator_backend_pid \\gset',
    '\\set b3_accelerator_phase pre',
    '',
  ].join('\n'), 'utf8');
  const postlude = Buffer.from([
    '',
    '\\set b3_accelerator_phase post',
    '',
  ].join('\n'), 'utf8');
  const sessionReceipt = Buffer.from([
    '',
    "select jsonb_build_object(",
    `  'contract','${SESSION_CONTRACT}',`,
    "  'status','PASS',",
    "  'same_session',pg_backend_pid() = :'b3_accelerator_backend_pid'::integer,",
    "  'search_path_pinned',current_setting('search_path') = 'pg_catalog, public',",
    "  'ddl_quiescence_confirmed',true,",
    "  'current_xact_id_assigned',pg_current_xact_id_if_assigned() is not null,",
    `  'migration_sha256','${migrationHash}'`,
    ')::text;',
    '',
  ].join('\n'), 'utf8');
  return Buffer.concat([
    prelude,
    Buffer.from(precheck), Buffer.from('\n'),
    Buffer.from(migration), Buffer.from('\n'),
    postlude,
    Buffer.from(postcheck),
    sessionReceipt,
  ]);
}

function spawnPsql(psqlPath, args, env, cwd, input, timeout) {
  return spawnSync(psqlPath, args, {
    cwd,
    env: safeProcessEnv(env),
    input,
    encoding: null,
    windowsHide: true,
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function defaultPsqlAdapter(psqlPath = 'psql') {
  return {
    run(args, env, cwd, input) {
      return spawnPsql(
        psqlPath, args, env, cwd, input, FORWARD_PROCESS_TIMEOUT_MS,
      );
    },
    inventory(args, env, cwd, input) {
      return spawnPsql(
        psqlPath, args, env, cwd, input, INVENTORY_PROCESS_TIMEOUT_MS,
      );
    },
  };
}

function parseContract(stdout, contract) {
  const rows = Buffer.from(stdout || '').toString('utf8').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.startsWith('{') && line.endsWith('}'))
    .map((line) => {
      try { return JSON.parse(line); } catch (_) { return null; }
    })
    .filter(row => row && row.contract === contract);
  if (rows.length !== 1) fail('PUBLIC_RECEIPT_MISSING_OR_DUPLICATE');
  return rows[0];
}

function assertSafeReceiptShape(receipt, allowedKeys) {
  if (!receipt || receipt.status !== 'PASS') fail('POST_CLOSURE_FAILED');
  const unexpected = Object.keys(receipt).filter(key => !allowedKeys.has(key));
  if (unexpected.length) fail('PUBLIC_RECEIPT_SHAPE_REJECTED');
}

function classifyPsqlFailure(result) {
  const stderr = Buffer.from(result && result.stderr || '').toString('utf8');
  // Once transport/process completion is ambiguous, earlier server text cannot
  // turn it back into a deterministic refusal. A later read-only inventory is
  // diagnostic state-at-read only and likewise never changes this class.
  if (!result
      || result.status == null
      || result.signal
      || result.error
      || /server closed the connection|connection to server was lost|could not connect|timeout expired|no connection to the server/i.test(stderr)) {
    return 'OUTCOME_UNKNOWN';
  }
  const known = [
    ['B3ACC_NON_PRISTINE_INDEX_STATE', 'NON_PRISTINE_INDEX_STATE'],
    ['b3_scoped_accelerator_index_prerequisite_failed', 'NON_PRISTINE_INDEX_STATE'],
    ['B3ACC_SOURCE_PREREQUISITE', 'SOURCE_PREREQUISITE'],
    ['b3_scoped_accelerator_source_prerequisite_failed', 'SOURCE_PREREQUISITE'],
    ['B3ACC_ACL_PREREQUISITE', 'ACL_PREREQUISITE'],
    ['b3_scoped_accelerator_acl_prerequisite_failed', 'ACL_PREREQUISITE'],
    ['B3ACC_EVENT_TRIGGER_PREREQUISITE', 'EVENT_TRIGGER_PREREQUISITE'],
    ['b3_scoped_accelerator_event_trigger_prerequisite_failed', 'EVENT_TRIGGER_PREREQUISITE'],
    ['B3ACC_PHASE_PREREQUISITE', 'PHASE_PREREQUISITE'],
    ['B3ACC_TARGET_RELATION_PREREQUISITE', 'TARGET_RELATION_PREREQUISITE'],
    ['B3ACC_OPERATOR_ROLE_PREREQUISITE', 'OPERATOR_ROLE_PREREQUISITE'],
    ['B3ACC_PLATFORM_PREREQUISITE', 'PLATFORM_PREREQUISITE'],
    ['B3ACC_AUTH_TIMEOUT_PREREQUISITE', 'AUTH_TIMEOUT_PREREQUISITE'],
    ['B3ACC_AUTHORITY_PREREQUISITE', 'AUTHORITY_PREREQUISITE'],
    ['B3ACC_RECEIPT_PREREQUISITE', 'RECEIPT_PREREQUISITE'],
    ['B3ACC_TARGET_PREREQUISITE', 'TARGET_PREREQUISITE'],
    ['B3ACC_CONCURRENT_ACTIVITY_PREREQUISITE', 'CONCURRENT_ACTIVITY_PREREQUISITE'],
    ['B3ACC_INDEX_POST_CLOSURE', 'INDEX_POST_CLOSURE_FAILED'],
    ['B3ACC_SOURCE_POST_CLOSURE', 'SOURCE_POST_CLOSURE_FAILED'],
    ['B3ACC_ACL_POST_CLOSURE', 'ACL_POST_CLOSURE_FAILED'],
    ['B3ACC_EVENT_TRIGGER_POST_CLOSURE', 'EVENT_TRIGGER_POST_CLOSURE_FAILED'],
    ['b3_scoped_accelerator_event_trigger_closure_failed', 'EVENT_TRIGGER_POST_CLOSURE_FAILED'],
    ['b3_scoped_accelerator_closure_failed', 'INDEX_POST_CLOSURE_FAILED'],
    ['b3_scoped_accelerator_source_closure_failed', 'SOURCE_POST_CLOSURE_FAILED'],
    ['b3_scoped_accelerator_acl_closure_failed', 'ACL_POST_CLOSURE_FAILED'],
    ['b3_scoped_accelerator_acl_or_source_closure_failed', 'SOURCE_OR_ACL_POST_CLOSURE_FAILED'],
  ];
  for (const [token, code] of known) if (stderr.includes(token)) return code;
  if (/canceling statement due to lock timeout|lock timeout/i.test(stderr)) {
    return 'LOCK_TIMEOUT';
  }
  if (/canceling statement due to statement timeout|statement timeout/i.test(stderr)) {
    return 'STATEMENT_TIMEOUT';
  }
  if (/canceling statement due to (?:user request|administrator command)/i.test(stderr)) {
    return 'OPERATOR_OR_SERVER_CANCELLATION';
  }
  if (/canceling statement due to/i.test(stderr)) return 'OTHER_STATEMENT_CANCELLATION';
  return 'INDEX_BUILD_OR_RUNTIME_FAILED';
}

function privateTranscript(root, result) {
  const directory = fs.mkdtempSync(path.join(root || os.tmpdir(), 'b3-accelerator-'));
  try {
    fs.chmodSync(directory, 0o700);
    const file = path.join(directory, 'psql.transcript');
    const bytes = Buffer.concat([
      Buffer.from(result && result.stdout || ''),
      Buffer.from('\n---STDERR---\n', 'utf8'),
      Buffer.from(result && result.stderr || ''),
    ]);
    fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
    fs.chmodSync(file, 0o600);
    return { directory, file, sha256: sha256(bytes) };
  } catch (_) {
    try { fs.rmSync(directory, { recursive: true, force: true }); } catch (_) { /* best effort */ }
    fail('PRIVATE_TRANSCRIPT_FAILED');
  }
}

function removePrivateTranscript(transcript) {
  if (!transcript || !transcript.directory) return 'NOT_CREATED';
  const root = path.resolve(transcript.directory);
  const parent = path.resolve(path.dirname(root));
  if (root === parent || !path.basename(root).startsWith('b3-accelerator-')) {
    return 'REFUSED';
  }
  try {
    fs.rmSync(root, { recursive: true, force: false });
    return 'REMOVED';
  } catch (_) {
    return 'FAILED';
  }
}

function assertFailureInventorySource(bytes) {
  const source = Buffer.from(bytes).toString('utf8');
  const executable = stripSingleQuotedLiterals(stripLineComments(source));
  if (sha256(bytes) !== EXPECTED_FAILURE_INVENTORY_SHA256
      || !/\bbegin\s*;/i.test(executable)
      || !/\bset\s+transaction\s+read\s+only\s*;/i.test(executable)
      || !/pg_current_xact_id_if_assigned\s*\(\s*\)/i.test(executable)
      || !source.includes(FAILURE_INVENTORY_CONTRACT)
      || /^\s*(?:insert|update|delete|merge|truncate|copy|call|create|alter|drop|grant|revoke|analyze|vacuum)\b/im.test(executable)) {
    fail('FAILURE_INVENTORY_SOURCE_REJECTED');
  }
}

function assertPrecheckSource(bytes) {
  const source = Buffer.from(bytes).toString('utf8');
  const executable = stripSingleQuotedLiterals(stripLineComments(source));
  if (sha256(bytes) !== EXPECTED_PRECHECK_SHA256
      || !/\bbegin\s*;/i.test(executable)
      || !/\bset\s+transaction\s+read\s+only\s*;/i.test(executable)
      || !/\bset\s+local\s+search_path\s*=\s*pg_catalog\s*,\s*public\s*;/i.test(executable)
      || !/pg_current_xact_id_if_assigned\s*\(\s*\)/i.test(executable)
      || !source.includes(PRECHECK_CONTRACT)
      || !source.includes(POSTCHECK_CONTRACT)
      || /^\s*(?:insert|update|delete|merge|truncate|copy|call|create|alter|drop|grant|revoke|analyze|vacuum)\b/im.test(executable)) {
    fail('PRECHECK_SOURCE_REJECTED');
  }
}

function unavailableFailureInventory(capture = {}) {
  return {
    inventory_status: 'UNAVAILABLE',
    inventory_state: 'UNKNOWN',
    trimmed_id_index_state: 'UNKNOWN',
    exact_url_index_state: 'UNKNOWN',
    named_index_count: null,
    exact_index_count: null,
    equivalent_other_count: null,
    invalid_index_count: null,
    ready_index_count: null,
    live_index_count: null,
    url_projector_dependency_count: null,
    active_build_count: null,
    transaction_read_only: null,
    search_path_pinned: null,
    current_xact_id_assigned: null,
    private_transcript_capture_status: capture.captureStatus || 'NOT_CAPTURED',
    private_transcript_cleanup_status: capture.cleanupStatus || 'NOT_CREATED',
    ...(capture.sha256 ? { private_transcript_sha256: capture.sha256 } : {}),
  };
}

function validateFailureInventory(receipt) {
  const allowed = new Set([
    'contract', 'status', 'inventory_state', 'trimmed_id_index_state',
    'exact_url_index_state', 'named_index_count', 'exact_index_count',
    'equivalent_other_count', 'invalid_index_count', 'ready_index_count',
    'live_index_count', 'url_projector_dependency_count',
    'active_build_count', 'transaction_read_only',
    'search_path_pinned', 'current_xact_id_assigned',
  ]);
  assertSafeReceiptShape(receipt, allowed);
  const indexStates = new Set([
    'MISSING', 'EXACT_VALID', 'INVALID_OR_NOT_READY', 'WRONG_DEFINITION',
  ]);
  const inventoryStates = new Set(['FRESH', 'EXACT_COMPLETE', 'REVIEW_REQUIRED']);
  const counts = [
    'named_index_count', 'exact_index_count', 'equivalent_other_count',
    'invalid_index_count', 'ready_index_count', 'live_index_count',
    'url_projector_dependency_count', 'active_build_count',
  ];
  if (!inventoryStates.has(receipt.inventory_state)
      || !indexStates.has(receipt.trimmed_id_index_state)
      || !indexStates.has(receipt.exact_url_index_state)
      || counts.some(key => !Number.isInteger(receipt[key]) || receipt[key] < 0)
      || receipt.transaction_read_only !== true
      || receipt.search_path_pinned !== true
      || receipt.current_xact_id_assigned !== false) {
    fail('FAILURE_INVENTORY_RECEIPT_REJECTED');
  }
  if (receipt.inventory_state === 'FRESH'
      && (receipt.named_index_count !== 0
        || receipt.exact_index_count !== 0
        || receipt.equivalent_other_count !== 0
        || receipt.trimmed_id_index_state !== 'MISSING'
        || receipt.exact_url_index_state !== 'MISSING')) {
    fail('FAILURE_INVENTORY_RECEIPT_REJECTED');
  }
  if (receipt.inventory_state === 'EXACT_COMPLETE'
      && (receipt.named_index_count !== 2
        || receipt.exact_index_count !== 2
        || receipt.equivalent_other_count !== 0
        || receipt.invalid_index_count !== 0
        || receipt.ready_index_count !== 2
        || receipt.live_index_count !== 2
        || receipt.url_projector_dependency_count !== 1
        || receipt.trimmed_id_index_state !== 'EXACT_VALID'
        || receipt.exact_url_index_state !== 'EXACT_VALID')) {
    fail('FAILURE_INVENTORY_RECEIPT_REJECTED');
  }
}

function captureFailureInventory(options) {
  const adapter = options.adapter;
  const runInventory = typeof adapter.inventory === 'function'
    ? adapter.inventory.bind(adapter) : adapter.run.bind(adapter);
  const inventoryEnv = {
    ...options.connectionEnv,
    PGAPPNAME: 'syncview-b3-accelerator-failure-inventory',
  };
  let result;
  try {
    result = runInventory(
      options.args, inventoryEnv, options.repoRoot, options.inventoryBytes,
    );
  } catch (_) {
    return unavailableFailureInventory();
  }

  let transcript;
  try {
    transcript = privateTranscript(options.privateRoot, result);
  } catch (_) {
    return unavailableFailureInventory({ captureStatus: 'FAILED' });
  }

  let receipt;
  let available = false;
  if (result
      && result.status === 0
      && !result.error
      && !result.signal) {
    try {
      receipt = parseContract(result.stdout, FAILURE_INVENTORY_CONTRACT);
      validateFailureInventory(receipt);
      available = true;
    } catch (_) {
      available = false;
    }
  }
  const cleanupStatus = removePrivateTranscript(transcript);
  if (!available) {
    return unavailableFailureInventory({
      captureStatus: 'CAPTURED', cleanupStatus, sha256: transcript.sha256,
    });
  }
  return {
    inventory_status: 'AVAILABLE',
    inventory_state: receipt.inventory_state,
    trimmed_id_index_state: receipt.trimmed_id_index_state,
    exact_url_index_state: receipt.exact_url_index_state,
    named_index_count: receipt.named_index_count,
    exact_index_count: receipt.exact_index_count,
    equivalent_other_count: receipt.equivalent_other_count,
    invalid_index_count: receipt.invalid_index_count,
    ready_index_count: receipt.ready_index_count,
    live_index_count: receipt.live_index_count,
    url_projector_dependency_count: receipt.url_projector_dependency_count,
    active_build_count: receipt.active_build_count,
    transaction_read_only: receipt.transaction_read_only,
    search_path_pinned: receipt.search_path_pinned,
    current_xact_id_assigned: receipt.current_xact_id_assigned,
    private_transcript_capture_status: 'CAPTURED',
    private_transcript_cleanup_status: cleanupStatus,
    private_transcript_sha256: transcript.sha256,
  };
}

function receiptClosureFailure(pre, post, session, expectedHash) {
  if (pre.index_state !== 'FRESH'
      || pre.named_index_count !== 0
      || pre.exact_index_count !== 0
      || pre.invalid_index_count !== 0
      || pre.ready_index_count !== 0
      || pre.live_index_count !== 0
      || pre.url_projector_dependency_count !== 0
      || post.index_state !== 'EXACT_COMPLETE'
      || post.named_index_count !== 2
      || post.exact_index_count !== 2
      || post.invalid_index_count !== 0
      || post.ready_index_count !== 2
      || post.live_index_count !== 2
      || post.url_projector_dependency_count !== 1) {
    return 'INDEX_POST_CLOSURE_FAILED';
  }
  if (pre.source_exact_count !== 10
      || post.source_exact_count !== 10
      || post.source_digest !== pre.source_digest) {
    return 'SOURCE_POST_CLOSURE_FAILED';
  }
  if (post.acl_digest !== pre.acl_digest) return 'ACL_POST_CLOSURE_FAILED';
  if (pre.event_trigger_exact_count !== 6
      || post.event_trigger_exact_count !== 6
      || post.event_trigger_digest !== pre.event_trigger_digest) {
    return 'EVENT_TRIGGER_POST_CLOSURE_FAILED';
  }
  if (pre.active_build_count !== 0
      || post.active_build_count !== 0
      || pre.prepared_transaction_count !== 0
      || post.prepared_transaction_count !== 0
      || pre.long_transaction_count !== 0
      || post.long_transaction_count !== 0) {
    return 'CONCURRENT_ACTIVITY_POST_CLOSURE_FAILED';
  }
  if (post.settings_digest !== pre.settings_digest) {
    return 'SETTINGS_POST_CLOSURE_FAILED';
  }
  if (pre.b3_receipt_count !== 0
      || post.b3_receipt_count !== 0
      || post.b3_receipt_digest !== pre.b3_receipt_digest) {
    return 'B3_RECEIPT_POST_CLOSURE_FAILED';
  }
  if (pre.row_write_source_contract !== 'NO_APPLICATION_ROW_DML_REACHABLE'
      || post.row_write_source_contract !== 'NO_APPLICATION_ROW_DML_REACHABLE') {
    return 'ROW_WRITE_SOURCE_CLOSURE_FAILED';
  }
  if (pre.transaction_read_only !== true
      || post.transaction_read_only !== true
      || pre.search_path_pinned !== true
      || post.search_path_pinned !== true
      || pre.current_xact_id_assigned !== false
      || post.current_xact_id_assigned !== false) {
    return 'READ_ONLY_EVIDENCE_FAILED';
  }
  if (session.same_session !== true
      || session.search_path_pinned !== true
      || session.ddl_quiescence_confirmed !== true
      || session.current_xact_id_assigned !== false
      || session.migration_sha256 !== expectedHash) {
    return 'SESSION_CLOSURE_FAILED';
  }
  return null;
}

function installAccelerators(options) {
  if (!options || options.confirmation !== CONFIRMATION) fail('CONFIRMATION_REQUIRED');
  if (options.ddlQuiescenceConfirmation !== DDL_QUIESCENCE_CONFIRMATION) {
    fail('DDL_QUIESCENCE_CONFIRMATION_REQUIRED');
  }
  const repoRoot = options.repoRoot || ROOT;
  const releaseSha = clean(options.releaseSha);
  const expectedHash = clean(options.expectedMigrationSha256);
  assertRelease(releaseSha, options.releaseInfo || releaseInfo(repoRoot));

  const migration = options.migrationBytes
    ? Buffer.from(options.migrationBytes)
    : readExactFile(repoRoot, MIGRATION_RELATIVE_PATH);
  const precheck = options.precheckBytes
    ? Buffer.from(options.precheckBytes)
    : readExactFile(repoRoot, PRECHECK_RELATIVE_PATH);
  const postcheck = options.postcheckBytes
    ? Buffer.from(options.postcheckBytes)
    : readExactFile(repoRoot, POSTCHECK_RELATIVE_PATH);
  const inventoryBytes = options.failureInventoryBytes
    ? Buffer.from(options.failureInventoryBytes)
    : readExactFile(repoRoot, FAILURE_INVENTORY_RELATIVE_PATH);
  assertMigrationSource(migration, expectedHash);
  assertPrecheckSource(precheck);
  assertPrecheckSource(postcheck);
  if (!precheck.equals(postcheck)) fail('PRECHECK_POSTCHECK_SOURCE_MISMATCH');
  assertFailureInventorySource(inventoryBytes);

  const projectRef = decodeServiceRoleProjectRef(options.serviceRoleKey);
  const connectionEnv = parseProductionDatabaseUrl(options.databaseUrl, projectRef);
  const stream = buildPsqlStream(precheck, migration, postcheck, expectedHash);
  const adapter = options.psqlAdapter || defaultPsqlAdapter(options.psqlPath || 'psql');
  const args = [
    '-X', '--quiet', '--set=ON_ERROR_STOP=1', '--set=AUTOCOMMIT=on', '--file=-',
  ];

  // Re-check the release immediately before the sole forward connected child.
  // A failed forward outcome may open one separately labeled read-only catalog
  // inventory connection; it can never continue or retry this artifact.
  assertRelease(
    releaseSha,
    options.preSpawnReleaseInfo || options.releaseInfo || releaseInfo(repoRoot),
  );

  let result;
  try { result = adapter.run(args, connectionEnv, repoRoot, stream); }
  catch (_) {
    result = { status: null, signal: null, error: true, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
  }
  let transcript;
  let transcriptCaptureStatus = 'CAPTURED';
  try {
    transcript = privateTranscript(options.privateRoot, result);
  } catch (_) {
    transcriptCaptureStatus = 'FAILED';
  }

  let successReceipt;
  let forwardError;
  try {
    if (!result || result.status !== 0 || result.error || result.signal) {
      fail(classifyPsqlFailure(result), {
        migration_sha256: expectedHash,
      });
    }
    if (transcriptCaptureStatus !== 'CAPTURED') {
      fail('PRIVATE_TRANSCRIPT_CAPTURE_FAILED');
    }

    const pre = parseContract(result.stdout, PRECHECK_CONTRACT);
    const post = parseContract(result.stdout, POSTCHECK_CONTRACT);
    const session = parseContract(result.stdout, SESSION_CONTRACT);
    const catalogReceiptKeys = new Set([
      'contract', 'status', 'index_state', 'named_index_count',
      'exact_index_count', 'invalid_index_count', 'ready_index_count',
      'live_index_count', 'url_projector_dependency_count',
      'source_exact_count', 'source_digest', 'acl_digest',
      'event_trigger_exact_count', 'event_trigger_digest', 'active_build_count',
      'prepared_transaction_count', 'long_transaction_count', 'settings_digest',
      'b3_receipt_count', 'b3_receipt_digest', 'row_write_source_contract',
      'search_path_pinned', 'transaction_read_only', 'current_xact_id_assigned',
    ]);
    assertSafeReceiptShape(pre, catalogReceiptKeys);
    assertSafeReceiptShape(post, catalogReceiptKeys);
    assertSafeReceiptShape(session, new Set([
      'contract', 'status', 'same_session', 'search_path_pinned',
      'ddl_quiescence_confirmed', 'current_xact_id_assigned', 'migration_sha256',
    ]));

    const closureFailure = receiptClosureFailure(pre, post, session, expectedHash);
    if (closureFailure) fail(closureFailure);

    successReceipt = {
      contract: 'syncview-b3-accelerator-install-v1',
      status: 'PASS',
      release_sha: releaseSha,
      migration_sha256: expectedHash,
      precheck_sha256: sha256(precheck),
      postcheck_sha256: sha256(postcheck),
      exact_index_count: post.exact_index_count,
      invalid_index_count: post.invalid_index_count,
      ready_index_count: post.ready_index_count,
      live_index_count: post.live_index_count,
      url_projector_dependency_count: post.url_projector_dependency_count,
      source_exact_count: post.source_exact_count,
      acl_anon_execute_count: 0,
      acl_authenticated_execute_count: 0,
      acl_public_execute_count: 0,
      acl_service_entrypoint_count: 3,
      acl_service_helper_count: 0,
      event_trigger_exact_count: post.event_trigger_exact_count,
      same_session: true,
      search_path_pinned: true,
      ddl_quiescence_confirmed: true,
      catalog_mutation_witness_unchanged: true,
      autocommit_concurrent_builds: true,
      application_row_write_source_contract: post.row_write_source_contract,
      retry_permitted: false,
      private_transcript_sha256: transcript.sha256,
    };
  } catch (error) {
    forwardError = error instanceof AcceleratorInstallError
      ? error : new AcceleratorInstallError('UNCLASSIFIED_OUTCOME');
  }

  if (forwardError) {
    const inventory = captureFailureInventory({
      adapter, args, connectionEnv, repoRoot, inventoryBytes,
      privateRoot: options.privateRoot,
    });
    const cleanupStatus = removePrivateTranscript(transcript);
    throw new AcceleratorInstallError(forwardError.code, {
      ...(forwardError.receipt || {}),
      forward_outcome: 'FAIL',
      forward_failure_class: forwardError.code,
      migration_sha256: expectedHash,
      failure_inventory_source_sha256: sha256(inventoryBytes),
      forward_private_transcript_capture_status: transcriptCaptureStatus,
      forward_private_transcript_cleanup_status: cleanupStatus,
      ...(transcript ? { private_transcript_sha256: transcript.sha256 } : {}),
      failure_inventory: inventory,
      retry_permitted: false,
      cleanup_permitted: false,
      operator_action: inventory.inventory_status === 'AVAILABLE'
        ? 'OWNER_REVIEW_REQUIRED_NO_RETRY'
        : 'READ_ONLY_CATALOG_RECHECK_REQUIRED',
    });
  }

  const cleanupStatus = removePrivateTranscript(transcript);
  if (cleanupStatus !== 'REMOVED') {
    const inventory = captureFailureInventory({
      adapter, args, connectionEnv, repoRoot, inventoryBytes,
      privateRoot: options.privateRoot,
    });
    throw new AcceleratorInstallError('PRIVATE_TRANSCRIPT_CLEANUP_FAILED', {
      forward_outcome: 'PASS',
      forward_failure_class: 'NONE',
      migration_sha256: expectedHash,
      failure_inventory_source_sha256: sha256(inventoryBytes),
      forward_private_transcript_capture_status: transcriptCaptureStatus,
      forward_private_transcript_cleanup_status: cleanupStatus,
      private_transcript_sha256: transcript.sha256,
      failure_inventory: inventory,
      retry_permitted: false,
      cleanup_permitted: false,
      operator_action: 'OWNER_REVIEW_REQUIRED_NO_RETRY',
    });
  }
  successReceipt.private_transcript_cleanup_status = cleanupStatus;
  return successReceipt;
}

function parseArgs(argv) {
  const allowed = new Set([
    '--release-sha', '--expected-migration-sha256', '--psql', '--private-root',
  ]);
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!allowed.has(key) || Object.prototype.hasOwnProperty.call(values, key)) {
      fail('ARGUMENT_REJECTED');
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('ARGUMENT_REJECTED');
    values[key] = value;
    index += 1;
  }
  if (!values['--release-sha'] || !values['--expected-migration-sha256']) {
    fail('ARGUMENT_REJECTED');
  }
  return {
    releaseSha: values['--release-sha'],
    expectedMigrationSha256: values['--expected-migration-sha256'],
    psqlPath: values['--psql'] || 'psql',
    privateRoot: values['--private-root'] || process.env.RUNNER_TEMP || os.tmpdir(),
  };
}

function publicFailure(error) {
  const safe = error instanceof AcceleratorInstallError
    ? error : new AcceleratorInstallError('UNCLASSIFIED_OUTCOME');
  return { contract: 'syncview-b3-accelerator-install-v1', status: 'FAIL', code: safe.code, ...(safe.receipt || {}) };
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const receipt = installAccelerators({
      ...args,
      confirmation: clean(process.env.B3_ACCELERATOR_CONFIRM),
      ddlQuiescenceConfirmation:
        clean(process.env.B3_ACCELERATOR_DDL_QUIESCENCE_CONFIRM),
      databaseUrl: process.env.B3_ACCELERATOR_DATABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    });
    process.stdout.write(`${JSON.stringify(receipt)}${os.EOL}`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(publicFailure(error))}${os.EOL}`);
    process.exitCode = 1;
  }
}

module.exports = {
  CONFIRMATION,
  DDL_QUIESCENCE_CONFIRMATION,
  EXPECTED_FAILURE_INVENTORY_SHA256,
  EXPECTED_MIGRATION_SHA256,
  EXPECTED_PRECHECK_SHA256,
  FAILURE_INVENTORY_CONTRACT,
  FAILURE_INVENTORY_RELATIVE_PATH,
  FORWARD_PROCESS_TIMEOUT_MS,
  INVENTORY_PROCESS_TIMEOUT_MS,
  MIGRATION_RELATIVE_PATH,
  PRECHECK_RELATIVE_PATH,
  POSTCHECK_CONTRACT,
  POSTCHECK_RELATIVE_PATH,
  PRECHECK_CONTRACT,
  SESSION_CONTRACT,
  AcceleratorInstallError,
  assertMigrationSource,
  assertPrecheckSource,
  buildPsqlStream,
  captureFailureInventory,
  classifyPsqlFailure,
  decodeServiceRoleProjectRef,
  defaultPsqlAdapter,
  installAccelerators,
  parseArgs,
  parseProductionDatabaseUrl,
  publicFailure,
  sha256,
};
