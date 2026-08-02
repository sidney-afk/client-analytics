'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  RETAINED_DIAGNOSTIC_PREDICATE_IDS,
  RETAINED_STATE_FAILURE_ARRAY_CATEGORIES,
  reviewedPreinstallGateSql,
  reviewedPostSection7Contract,
  reviewedRetainedDiagnosticContext,
  reviewedRetainedDiagnosticPredicates,
} = require('../scripts/f27-mirror-outbox-snapshot');
const {
  MAX_PUBLIC_RECEIPT_BYTES,
  buildReceipt,
  diagnosticSql,
  diagnose,
  parseArgs,
  predicateFailureCode,
  publicFailure,
  sanitizeFunctionDescriptor,
} = require('../scripts/f27-retained-state-diagnose');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function rejects(fn, code) {
  try { fn(); return false; } catch (error) { return Boolean(error && error.code === code); }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

const migration = fs.readFileSync(path.join(
  __dirname, '..', 'migrations', '2026-07-20-f27-team-rollback.sql',
), 'utf8').replace(/\r\n?/g, '\n');
const gate = reviewedPreinstallGateSql();
const predicates = reviewedRetainedDiagnosticPredicates();
const context = reviewedRetainedDiagnosticContext();
const sql = diagnosticSql();

ok(predicates.length === 21
  && predicates.map(predicate => predicate.id).join(',')
    === RETAINED_DIAGNOSTIC_PREDICATE_IDS.join(',')
  && predicates.every(predicate => gate.includes(predicate.sql))
  && predicates.every(predicate => sql.includes(predicate.sql)),
'all 21 ordered predicates are extracted from the migration and embedded source-exactly');

ok(context.declarations && context.setup && context.entryState
  && sql.includes(context.declarations)
  && sql.includes(context.setup)
  && sql.includes(context.entryState),
'the predicate declaration, OID setup, and entry-state binders are source-extracted too');

ok((migration.match(/F27_RETAINED_DIAGNOSTIC_PREDICATE_BEGIN/g) || []).length === 21
  && (migration.match(/F27_RETAINED_DIAGNOSTIC_PREDICATE_END/g) || []).length === 21
  && (gate.match(/raise exception 'F27_PREINSTALL_GATE_[A-Z0-9_]+';/g) || []).length
    === predicates.reduce((count, predicate) => count
      + (predicate.sql.match(/raise exception 'F27_PREINSTALL_GATE_[A-Z0-9_]+';/g) || []).length, 0),
'no fail-closed preinstall predicate sits outside the exact diagnostic marker manifest');

ok((sql.match(/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;/g) || []).length === 1
  && (sql.match(/\nCOMMIT;/g) || []).length === 1
  && sql.indexOf('READ ONLY;') < sql.indexOf('DO $f27_retained_diag_01$')
  && sql.indexOf('SELECT jsonb_build_object(') < sql.lastIndexOf('\nCOMMIT;')
  && !sql.includes('F27_PREINSTALL_EXACT_SUBSET_GATE_PASS'),
'the diagnostic is one repeatable-read/read-only transaction and cannot emit an install terminal');

ok(predicates.every(predicate => /^F27_PREINSTALL_GATE_[A-Z0-9_]+$/.test(
  predicateFailureCode(predicate),
))
  && (sql.match(/EXCEPTION WHEN raise_exception THEN/g) || []).length === predicates.length
  && (sql.match(/GET STACKED DIAGNOSTICS v_diagnostic_error_message = MESSAGE_TEXT;/g) || []).length
    === predicates.length
  && predicates.every((predicate, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    const delimiter = `$f27_retained_diag_${ordinal}$`;
    const start = sql.indexOf(`DO ${delimiter}`);
    const end = sql.indexOf(`${delimiter};`, start + delimiter.length);
    return start >= 0 && end > start
      && !sql.slice(start, end).includes('EXCEPTION WHEN OTHERS');
  }),
'each extracted predicate recognizes only its fixed gate terminal and rethrows unrelated SQL faults');

function baseInventory() {
  const inventory = {
    relations: [
      { identity: 'public.track_b_team_rollbacks', column_count: 15, check_count: 4 },
      { identity: 'public.track_b_team_rollback_intents', column_count: 10, check_count: 1 },
    ],
    columns: [
      {
        identity: 'public.track_b_team_rollbacks.actor',
        compression: '', statistics_target: null,
      },
      {
        identity: 'public.mirror_outbox.authority_generation',
        has_missing: true, missing_value: '{0}',
      },
    ],
    constraints: [{
      identity: 'public.mirror_outbox_f27_drill_rollback_id_fkey',
      relation_identity: 'public.mirror_outbox',
      deferrable: false, deferred: false,
    }],
    indexes: [],
    triggers: [],
    functions: reviewedPostSection7Contract().retained_functions.map(expected => ({
      identity: expected.identity,
      owner: 'postgres',
      result_type: expected.result,
      language: expected.language,
      security_definer: expected.security_definer,
      volatility: 'v',
      parallel: 'u',
      config: expected.config,
      cost: 100,
      source_sha256: expected.source_sha256,
    })),
    state: {
      state_capture_status: 'exact_columns',
      fences: [
        { team: 'graphics', generation: 0, updated_by: 'f27-migration' },
        { team: 'video', generation: 0, updated_by: 'f27-migration' },
      ],
      completed_real_by_team: [],
      open_rollback_count: 0,
      unresolved_intent_count: 0,
    },
    runtime_capture_status: 'exact_columns',
  };
  RETAINED_STATE_FAILURE_ARRAY_CATEGORIES.forEach(category => {
    if (!Object.prototype.hasOwnProperty.call(inventory, category)) inventory[category] = [];
  });
  return inventory;
}

function parsedFixture() {
  return {
    entry_state: 'exact_post_section7',
    metadata: {
      current_database: 'f27_fixture',
      transaction_isolation: 'repeatable read',
      transaction_read_only: 'on',
      server_version_num: '170006',
    },
    predicates: predicates.map(predicate => ({
      id: predicate.id,
      status: 'PASS',
      sql_sha256: predicate.sql_sha256,
    })),
    inventory: baseInventory(),
  };
}

const cleanReceipt = buildReceipt(parsedFixture());
ok(cleanReceipt.status === 'PASS'
  && cleanReceipt.entry_state === 'exact_post_section7'
  && cleanReceipt.failed_predicate_count === 0
  && cleanReceipt.predicate_count === 21
  && cleanReceipt.predicates.every(predicate => predicate.status === 'PASS')
  && cleanReceipt.scope === 'READ_ONLY_DIAGNOSTIC_ONLY'
  && cleanReceipt.transaction === 'repeatable_read_read_only',
'a clean install-to-Section-7 retained clone reports all PASS with exact_post_section7');

const driftCases = [
  {
    name: 'retained_object', id: 'retained_table_boundaries',
    mutate: fixture => { fixture.inventory.relations[0].column_count = 16; },
    field: 'column_count', expected: 15, observed: 16,
  },
  {
    name: 'naked_generation', id: 'retained_generation_history',
    mutate: fixture => { fixture.inventory.state.fences[1].generation = 1; },
    field: 'generation', expected: 0, observed: 1,
  },
  {
    name: 'open_work', id: 'retained_no_open_work', derivative: 'retained_rollback_history',
    mutate: fixture => { fixture.inventory.state.open_rollback_count = 1; },
    field: 'open_row_count', expected: 0, observed: 1,
  },
  {
    name: 'fk_metadata', id: 'retained_constraint_metadata',
    mutate: fixture => { fixture.inventory.constraints[0].deferrable = true; fixture.inventory.constraints[0].deferred = true; },
    field: 'deferrable', expected: false, observed: true,
  },
  {
    name: 'function_cost', id: 'retained_functions',
    mutate: fixture => { fixture.inventory.functions[0].cost = 42; },
    field: 'cost', expected: 100, observed: 42,
  },
  {
    name: 'column_catalog', id: 'retained_columns',
    mutate: fixture => { fixture.inventory.columns[0].compression = 'p'; },
    field: 'compression', expected: '', observed: 'p',
  },
  {
    name: 'stats_target', id: 'retained_columns',
    mutate: fixture => { fixture.inventory.columns[0].statistics_target = 42; },
    field: 'statistics_target', expected: null, observed: 42,
  },
  {
    name: 'missing_value', id: 'retained_columns',
    mutate: fixture => { fixture.inventory.columns[1].has_missing = false; fixture.inventory.columns[1].missing_value = null; },
    field: 'has_missing', expected: true, observed: false,
  },
];

ok(driftCases.every(drift => {
  const fixture = parsedFixture();
  fixture.predicates.find(predicate => predicate.id === drift.id).status = 'FAIL';
  if (drift.derivative) {
    fixture.predicates.find(predicate => predicate.id === drift.derivative).status = 'FAIL';
  }
  drift.mutate(fixture);
  const receipt = buildReceipt(fixture);
  const failed = receipt.predicates.filter(predicate => predicate.status === 'FAIL');
  const root = failed.find(predicate => predicate.id === drift.id);
  const descriptor = root && root.descriptor;
  const expectedFailedIds = [drift.id, ...(drift.derivative ? [drift.derivative] : [])];
  return receipt.status === 'FAIL'
    && receipt.failed_predicate_count === expectedFailedIds.length
    && failed.map(predicate => predicate.id).join(',') === expectedFailedIds.join(',')
    && receipt.first_gate_failure === drift.id
    && root.causal_role === 'first_gate_failure'
    && (!drift.derivative
      || failed.find(predicate => predicate.id === drift.derivative).causal_role
        === 'downstream_or_additional')
    && descriptor.expected.field === drift.field
    && descriptor.expected.value === drift.expected
    && descriptor.observed.field === drift.field
    && (typeof drift.observed === 'string'
      ? descriptor.observed.value_sha256 === hash(drift.observed)
        && descriptor.observed.value_byte_length === Buffer.byteLength(drift.observed)
        && !Object.prototype.hasOwnProperty.call(descriptor.observed, 'value')
      : descriptor.observed.value === drift.observed);
}), 'each drift names one exact first gate failure while preserving any real downstream FAIL');

const hostileTeamFixture = parsedFixture();
hostileTeamFixture.predicates.find(predicate => predicate.id === 'retained_generation_history').status = 'FAIL';
hostileTeamFixture.inventory.state.fences[1].team = 'PRIVATE_CLIENT_SLUG';
hostileTeamFixture.inventory.state.fences[1].generation = 1;
const hostileTeamReceipt = JSON.stringify(buildReceipt(hostileTeamFixture));
ok(!hostileTeamReceipt.includes('PRIVATE_CLIENT_SLUG')
  && hostileTeamReceipt.includes('team=other')
  && hostileTeamReceipt.includes('object_identity_sha256'),
'unexpected fence identities are classified and hashed instead of escaping publicly');

const functionFixture = parsedFixture();
functionFixture.predicates.find(predicate => predicate.id === 'retained_functions').status = 'FAIL';
functionFixture.inventory.functions[0].cost = 42;
functionFixture.inventory.functions[0].prosrc = 'PRIVATE RAW FUNCTION SOURCE';
const functionReceiptText = JSON.stringify(buildReceipt(functionFixture));
ok(!functionReceiptText.includes('PRIVATE RAW FUNCTION SOURCE')
  && !functionReceiptText.includes('prosrc')
  && !functionReceiptText.includes('definition')
  && /"cost"/.test(functionReceiptText),
'function failures expose bounded metadata while raw source is never emitted');

const hostileFunctionMetadataFixture = parsedFixture();
hostileFunctionMetadataFixture.predicates.find(predicate => predicate.id === 'retained_functions').status = 'FAIL';
hostileFunctionMetadataFixture.inventory.functions[0].owner = 'PRIVATE_CLIENT_SLUG';
const hostileFunctionMetadataReceipt = JSON.stringify(buildReceipt(hostileFunctionMetadataFixture));
ok(!hostileFunctionMetadataReceipt.includes('PRIVATE_CLIENT_SLUG')
  && hostileFunctionMetadataReceipt.includes(hash('PRIVATE_CLIENT_SLUG')),
'unexpected string-valued function metadata is hashed instead of escaping publicly');

const unexpectedFixture = parsedFixture();
unexpectedFixture.predicates.find(predicate => predicate.id === 'unexpected_f27_objects').status = 'FAIL';
unexpectedFixture.inventory.functions.push({
  identity: 'public.zzz_PRIVATE_CLIENT_SLUG()',
  source_sha256: 'b'.repeat(64),
});
const unexpectedReceiptText = JSON.stringify(buildReceipt(unexpectedFixture));
ok(!unexpectedReceiptText.includes('zzz_PRIVATE_CLIENT_SLUG')
  && unexpectedReceiptText.includes(hash('public.zzz_PRIVATE_CLIENT_SLUG()'))
  && unexpectedReceiptText.includes('"record_count":1')
  && unexpectedReceiptText.includes('"normalized_source_sha256":"' + 'b'.repeat(64) + '"'),
'unexpected-object diagnosis filters reviewed inventory first and retains a late residual by hash');

ok(rejects(() => sanitizeFunctionDescriptor({
  source_sha256: 'a'.repeat(64),
  prosrc: 'PRIVATE RAW FUNCTION SOURCE',
}), 'PUBLIC_RECEIPT_UNSAFE')
  && rejects(() => sanitizeFunctionDescriptor({
    normalized_source_sha256: 'a'.repeat(64),
    definition: 'PRIVATE RAW DEFINITION',
  }), 'PUBLIC_RECEIPT_UNSAFE'),
'a source hash can never be used to smuggle a raw function source or definition');

let capturedSql = '';
let capturedEnv = null;
const adapterReceipt = diagnose({
  confirmed: true,
  database: 'f27_fixture',
  connectionEnv: { PGDATABASE: 'f27_fixture', PGPASSWORD: 'private-secret' },
  skipReleaseProof: true,
  psqlAdapter: {
    version: () => 'psql (PostgreSQL) 17.6',
    capture(candidateSql, env) {
      capturedSql = candidateSql;
      capturedEnv = env;
      return `${JSON.stringify(parsedFixture())}\n`;
    },
  },
});
ok(adapterReceipt.status === 'PASS'
  && capturedSql === sql
  && capturedEnv.PGPASSWORD === 'private-secret'
  && !JSON.stringify(adapterReceipt).includes('private-secret'),
'the private PostgreSQL URL environment reaches only the adapter and never the public receipt');

ok(rejects(() => parseArgs([
  '--confirm-project-ref', 'abcdefghijklmnopqrst',
  '--confirm-database', 'postgres',
  '--release-sha', 'a'.repeat(40),
  '--sql', 'select 1',
]), 'ARGUMENT_REJECTED')
  && rejects(() => parseArgs([
    '--confirm-project-ref', 'abcdefghijklmnopqrst',
    '--confirm-database', 'postgres',
    '--release-sha', 'a'.repeat(40),
    '--psql', 'private-wrapper.exe',
  ]), 'ARGUMENT_REJECTED')
  && rejects(() => parseArgs([
    '--confirm-project-ref', 'abcdefghijklmnopqrst',
    '--confirm-database', 'postgres',
  ]), 'ARGUMENT_REJECTED'),
'the CLI rejects arbitrary SQL/executables and requires the exact release/project/database binders');

const safeFailure = JSON.stringify(publicFailure({
  message: 'private-secret public.track_b_client row-body',
}));
ok(!safeFailure.includes('private-secret')
  && !safeFailure.includes('row-body')
  && Buffer.byteLength(JSON.stringify(cleanReceipt)) < MAX_PUBLIC_RECEIPT_BYTES,
'unexpected failures and successful receipts remain inside the fixed public-safe envelope');

if (failures) {
  console.error(`\n${failures} F27 retained-state diagnosis check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nF27 retained-state diagnosis checks passed');
}
