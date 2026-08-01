'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BOUNDARY_STATE_SQL,
  CRLF_WRITE_AUTHORIZATION_SQL,
  CRLF_WRITE_AUTHORIZATION_TERMINAL,
  INSTALLED_STATE_SQL,
  LF_WRITE_AUTHORIZATION_SQL,
  LEGACY_HOLD_GUARD_ACL_SQL,
  LEGACY_HOLD_GUARD_ACL_TERMINAL,
  RETAINED_DRIFT_CONFIRMATION,
  RETAINED_DRIFT_DATABASES,
  ZERO_AUDIT_REINSTALL_DATABASE,
  parseArgs,
  publicFailure,
  publicReceipt,
  runProof,
  validatePrivateRoot,
  validateStateTransition,
  validateReinstallTransition,
  validateZeroAuditReinstallTransition,
  validateTarget,
} = require('../scripts/f27-database-rollback-postgres-proof');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else { failures += 1; console.error(`FAIL  ${message}`); }
}

function errorCode(action) {
  try {
    const result = action();
    if (result && typeof result.then === 'function') {
      return result.then(() => null, error => error && error.code);
    }
    return null;
  } catch (error) {
    return error && error.code;
  }
}

const HASHES = {
  snapshot: '1'.repeat(64),
  recipe: '2'.repeat(64),
  migration: '3'.repeat(64),
  transcript: '4'.repeat(64),
  boundary: '5'.repeat(64),
  installedBoundary: '6'.repeat(64),
  flags: '7'.repeat(64),
  flips: '8'.repeat(64),
  rollbacks: '9'.repeat(64),
  intents: 'a'.repeat(64),
  constraints: 'b'.repeat(64),
  indexes: 'c'.repeat(64),
  fences: 'd'.repeat(64),
  reinstallSnapshot: 'e'.repeat(64),
  reinstallRecipe: 'f'.repeat(64),
  postContract: '0'.repeat(64),
  retainedAudit: '1'.repeat(64),
  preservedGenerations: '2'.repeat(64),
};

function states() {
  const preinstall = {
    fences: {
      count: 2,
      teams: ['graphics', 'video'],
      generations: { graphics: 0, video: 0 },
      sha256: HASHES.fences,
    },
    boundary: { count: 3, sha256: HASHES.boundary },
    flags: { count: 3, sha256: HASHES.flags },
    flag_flips: { count: 0, sha256: HASHES.flips },
  };
  const beforeRollback = {
    fences: { ...preinstall.fences, teams: [...preinstall.fences.teams], generations: { ...preinstall.fences.generations } },
    rollbacks: { count: 1, sha256: HASHES.rollbacks },
    intents: { count: 1, sha256: HASHES.intents },
    constraints: {
      count: 3,
      names: [
        'mirror_outbox_f27_drill_rollback_id_fkey',
        'mirror_outbox_f27_drill_scope_check',
        'mirror_outbox_f27_generation_check',
      ].sort(),
      all_validated: true,
      sha256: HASHES.constraints,
    },
    indexes: {
      count: 1,
      names: ['mirror_outbox_one_f27_drill_row_idx'],
      unique: true,
      valid: true,
      ready: true,
      live: true,
      sha256: HASHES.indexes,
    },
    boundary: { count: 3, sha256: HASHES.installedBoundary },
    flags: { ...preinstall.flags },
    flag_flips: { ...preinstall.flag_flips },
    open_rollback_count: 0,
    unresolved_intent_count: 0,
    orphan_intent_count: 0,
    completed_drill_count: 1,
    trigger_enabled: 'O',
    production_assert_present: true,
    f27_table_count: 3,
    f27_outbox_column_count: 2,
    f27_hold_function_count: 1,
    f27_hold_trigger_count: 1,
    mutating_service_role_execute_count: 8,
  };
  const afterRollback = {
    ...beforeRollback,
    rollbacks: { ...beforeRollback.rollbacks },
    intents: { ...beforeRollback.intents },
    constraints: {
      ...beforeRollback.constraints,
      names: [...beforeRollback.constraints.names],
    },
    indexes: {
      ...beforeRollback.indexes,
      names: [...beforeRollback.indexes.names],
    },
    boundary: { ...preinstall.boundary },
    fences: {
      ...preinstall.fences,
      teams: [...preinstall.fences.teams],
      generations: { ...preinstall.fences.generations },
    },
    flags: { ...preinstall.flags },
    flag_flips: { ...preinstall.flag_flips },
    trigger_enabled: 'D',
    production_assert_present: true,
    mutating_service_role_execute_count: 0,
  };
  const afterReinstall = {
    ...beforeRollback,
    fences: {
      ...afterRollback.fences,
      teams: [...afterRollback.fences.teams],
      generations: { ...afterRollback.fences.generations },
    },
    rollbacks: { ...afterRollback.rollbacks },
    intents: { ...afterRollback.intents },
    constraints: { ...afterRollback.constraints, names: [...afterRollback.constraints.names] },
    indexes: { ...afterRollback.indexes, names: [...afterRollback.indexes.names] },
    boundary: { ...beforeRollback.boundary },
    flags: { ...afterRollback.flags },
    flag_flips: { ...afterRollback.flag_flips },
    trigger_enabled: 'O',
    mutating_service_role_execute_count: 8,
  };
  return { preinstall, beforeRollback, afterRollback, afterReinstall };
}

function zeroAuditStates() {
  const value = states();
  for (const state of [value.beforeRollback, value.afterRollback, value.afterReinstall]) {
    state.rollbacks = { count: 0, sha256: HASHES.rollbacks };
    state.intents = { count: 0, sha256: HASHES.intents };
    state.completed_drill_count = 0;
  }
  return value;
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function privateDirectory(parent, name) {
  const value = path.join(parent, name);
  fs.mkdirSync(value, { mode: 0o700 });
  if (process.platform !== 'win32') fs.chmodSync(value, 0o700);
  return value;
}

async function main() {
  const base = states();
  ok(validateStateTransition(
    base.preinstall,
    base.beforeRollback,
    base.afterRollback,
  ) === true,
  'exact audit, flags, restored three-function boundary, and disabled hold trigger pass');
  const convergedPostContract = {
    status: 'PASS',
    f27_post_contract_sha256: HASHES.postContract,
  };
  ok(validateReinstallTransition(
    base.beforeRollback,
    base.afterRollback,
    base.afterReinstall,
    HASHES.postContract,
    convergedPostContract,
  ) === true,
  'exact post-Section-7 state reinstalls to the pristine normalized contract without changing fences or audit');
  const zeroAudit = zeroAuditStates();
  ok(validateZeroAuditReinstallTransition(
    zeroAudit.preinstall,
    zeroAudit.beforeRollback,
    zeroAudit.afterRollback,
    zeroAudit.afterReinstall,
    HASHES.postContract,
    convergedPostContract,
  ) === true,
  'production-shaped zero-audit Section-7 state reinstalls with zero generations and converges');
  const zeroAuditGenerationDrift = copy(zeroAudit);
  zeroAuditGenerationDrift.afterReinstall.fences.generations.video = 1;
  ok(errorCode(() => validateZeroAuditReinstallTransition(
    zeroAuditGenerationDrift.preinstall,
    zeroAuditGenerationDrift.beforeRollback,
    zeroAuditGenerationDrift.afterRollback,
    zeroAuditGenerationDrift.afterReinstall,
    HASHES.postContract,
    convergedPostContract,
  )) === 'ZERO_AUDIT_FENCES_CHANGED',
  'zero-audit production-shaped proof rejects a generation change');
  ok(INSTALLED_STATE_SQL.includes('pg_get_constraintdef(c.oid,true)')
      && INSTALLED_STATE_SQL.includes('pg_get_indexdef(i.indexrelid,0,true)')
      && BOUNDARY_STATE_SQL.includes(
        "to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')",
      )
      && INSTALLED_STATE_SQL.includes(
        "to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)')",
      )
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_drill_rollback_id_fkey')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_drill_scope_check')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_generation_check')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_one_f27_drill_row_idx')
      && INSTALLED_STATE_SQL.includes("c.conname ~* 'f27'")
      && INSTALLED_STATE_SQL.includes("ci.relname ~* 'f27'"),
  'hosted readback hashes exact definitions and includes every named or extra F27 constraint/index');

  for (const [label, mutate, code] of [
    ['fence', state => { state.afterReinstall.fences.sha256 = '3'.repeat(64); }, 'REINSTALL_FENCES_CHANGED'],
    ['audit', state => { state.afterReinstall.intents.sha256 = '4'.repeat(64); }, 'REINSTALL_AUDIT_CHANGED'],
    ['boundary', state => { state.afterReinstall.boundary.sha256 = '5'.repeat(64); }, 'REINSTALL_BOUNDARY_NOT_CONVERGED'],
    ['open work', state => { state.afterReinstall.open_rollback_count = 1; }, 'POST_REINSTALL_STATE_INVALID'],
  ]) {
    const changed = copy(base);
    mutate(changed);
    ok(errorCode(() => validateReinstallTransition(
      changed.beforeRollback,
      changed.afterRollback,
      changed.afterReinstall,
      HASHES.postContract,
      convergedPostContract,
    )) === code,
    `post-rollback reinstall fails closed on ${label} drift`);
  }
  ok(errorCode(() => validateReinstallTransition(
    base.beforeRollback,
    base.afterRollback,
    base.afterReinstall,
    HASHES.postContract,
    { ...convergedPostContract, f27_post_contract_sha256: '6'.repeat(64) },
  )) === 'REINSTALL_POST_CONTRACT_NOT_CONVERGED',
  'post-rollback reinstall must converge to the independently fingerprinted pristine contract');

  const auditDrift = copy(base);
  auditDrift.afterRollback.intents.sha256 = 'b'.repeat(64);
  ok(errorCode(() => validateStateTransition(
    auditDrift.preinstall,
    auditDrift.beforeRollback,
    auditDrift.afterRollback,
  )) === 'ROLLBACK_AUDIT_CHANGED',
  'any retained audit-row drift fails closed');

  const flagDrift = copy(base);
  flagDrift.afterRollback.flags.sha256 = 'c'.repeat(64);
  ok(errorCode(() => validateStateTransition(
    flagDrift.preinstall,
    flagDrift.beforeRollback,
    flagDrift.afterRollback,
  )) === 'ROLLBACK_RUNTIME_FLAGS_CHANGED',
  'any runtime flag or flag-flip drift fails closed');

  const boundaryDrift = copy(base);
  boundaryDrift.afterRollback.boundary.sha256 = 'd'.repeat(64);
  ok(errorCode(() => validateStateTransition(
    boundaryDrift.preinstall,
    boundaryDrift.beforeRollback,
    boundaryDrift.afterRollback,
  )) === 'ROLLBACK_BOUNDARY_NOT_RESTORED',
  'boundary definitions must return to their exact preinstall hash');

  const constraintDrift = copy(base);
  constraintDrift.afterRollback.constraints.sha256 = 'd'.repeat(64);
  ok(errorCode(() => validateStateTransition(
    constraintDrift.preinstall,
    constraintDrift.beforeRollback,
    constraintDrift.afterRollback,
  )) === 'ROLLBACK_ADDITIVE_SCHEMA_CHANGED',
  'the three exact F27 constraint definitions must retain their before-rollback hash');

  const indexDrift = copy(base);
  indexDrift.afterRollback.indexes.sha256 = 'e'.repeat(64);
  ok(errorCode(() => validateStateTransition(
    indexDrift.preinstall,
    indexDrift.beforeRollback,
    indexDrift.afterRollback,
  )) === 'ROLLBACK_ADDITIVE_SCHEMA_CHANGED',
  'the exact unique drill index definition must retain its before-rollback hash');

  const replacedConstraint = copy(base);
  replacedConstraint.afterRollback.constraints.names[0] = 'mirror_outbox_f27_unreviewed_check';
  ok(errorCode(() => validateStateTransition(
    replacedConstraint.preinstall,
    replacedConstraint.beforeRollback,
    replacedConstraint.afterRollback,
  )) === 'ROLLBACK_CONSTRAINTS_INVALID',
  'three constraints cannot pass when any reviewed identity is replaced by an extra F27 object');

  const nonUniqueIndex = copy(base);
  nonUniqueIndex.afterRollback.indexes.unique = false;
  ok(errorCode(() => validateStateTransition(
    nonUniqueIndex.preinstall,
    nonUniqueIndex.beforeRollback,
    nonUniqueIndex.afterRollback,
  )) === 'ROLLBACK_ADDITIVE_SCHEMA_INVALID',
  'the retained drill index must independently read back as unique, valid, ready, and live');

  for (const mutation of [
    state => { state.trigger_enabled = 'O'; },
    state => { state.production_assert_present = false; },
    state => { state.f27_table_count = 2; },
    state => { state.f27_outbox_column_count = 1; },
    state => { state.f27_hold_function_count = 0; },
    state => { state.f27_hold_trigger_count = 0; },
    state => { state.mutating_service_role_execute_count = 1; },
  ]) {
    const changed = copy(base);
    mutation(changed.afterRollback);
    ok(errorCode(() => validateStateTransition(
      changed.preinstall,
      changed.beforeRollback,
      changed.afterRollback,
    )) === 'POST_ROLLBACK_STATE_INVALID',
    'each post-rollback restored-function, disabled-trigger, additive-object, and grant guard is mandatory');
  }

  const receipt = publicReceipt({
    afterRollback: base.afterRollback,
    snapshot: {
      mirror_outbox_row_count: 2,
      mirror_outbox_non_terminal_row_count: 2,
      snapshot_bundle_sha256: HASHES.snapshot,
    },
    migration: { migration_sha256: HASHES.migration },
    recipe: { rollback_recipe_sha256: HASHES.recipe },
    rollback: { private_transcript_sha256: HASHES.transcript },
    reinstallSnapshot: {
      snapshot_bundle_sha256: HASHES.reinstallSnapshot,
      preserved_fence_generations_sha256: HASHES.preservedGenerations,
      retained_audit_sha256: HASHES.retainedAudit,
    },
    reinstallRecipe: { rollback_recipe_sha256: HASHES.reinstallRecipe },
    postContract: { f27_post_contract_sha256: HASHES.postContract },
    zeroAudit: {
      afterRollback: zeroAudit.afterRollback,
      pristinePostContract: { f27_post_contract_sha256: HASHES.postContract },
      lineEndingReceipt: {
        status: 'PASS',
        normalized_source_sha256: HASHES.boundary,
        raw_cr_count: 0,
        preserved_non_source_field_count: 31,
      },
      reinstallSnapshot: {
        preserved_fence_generations_sha256: HASHES.preservedGenerations,
        retained_audit_sha256: HASHES.retainedAudit,
      },
      rollback: { private_transcript_sha256: HASHES.transcript },
      postContract: { f27_post_contract_sha256: HASHES.postContract },
    },
  });
  const receiptText = JSON.stringify(receipt);
  ok(Object.values(receipt).every(value =>
    value === 'PASS' || Number.isInteger(value) || /^[a-f0-9]{64}$/.test(value)),
  'public receipt values are limited to PASS, integer counts, and SHA-256 hashes');
  ok(!/project_ref|database_name|private_path|source_closure|row_body|payload|token|password/i.test(receiptText)
      && receipt.audit_rollback_row_count === 1
      && receipt.audit_intent_row_count === 1
      && receipt.boundary_function_count === 3
      && receipt.production_assert_authority_restored === 'PASS'
      && receipt.additive_constraint_count === 3
      && receipt.additive_drill_index_count === 1
      && receipt.additive_object_count === 11
      && receipt.retained_state_drift_clone_count === 8
      && receipt.normalized_post_contract_converged === 'PASS'
      && receipt.reinstalled_post_contract_sha256 === HASHES.postContract
      && receipt.zero_audit_production_sequence === 'PASS'
      && receipt.zero_audit_legacy_hold_guard_acl_adopted === 'PASS'
      && receipt.zero_audit_alternate_reviewed_line_endings === 'PASS'
      && receipt.zero_audit_write_authorization_normalized_source_sha256 === HASHES.boundary
      && receipt.zero_audit_write_authorization_raw_cr_count === 0
      && receipt.zero_audit_write_authorization_preserved_non_source_field_count === 31
      && receipt.zero_audit_crlf_derived_pristine_post_contract_sha256 === HASHES.postContract
      && receipt.zero_audit_rollback_row_count === 0
      && receipt.zero_audit_intent_row_count === 0,
  'public receipt contains no project identity, private path, closure, credential, or row body');

  const releaseSha = 'e'.repeat(40);
  ok(validateTarget({
    database: 'f27_rollback_execution',
    releaseSha,
  }, {
    PGHOST: 'localhost',
    PGPORT: '5432',
    PGUSER: 'postgres',
    PGDATABASE: 'f27_rollback_execution',
  }).database === 'f27_rollback_execution',
  'only an explicitly confirmed f27-prefixed loopback database is accepted');
  ok(errorCode(() => validateTarget({
    database: 'postgres',
    releaseSha,
  }, {
    PGHOST: 'db.example.com',
    PGPORT: '5432',
    PGUSER: 'postgres',
    PGDATABASE: 'postgres',
  })) === 'DISPOSABLE_DATABASE_CONFIRMATION_REQUIRED',
  'a production-shaped database target is rejected before any psql call');

  ok(parseArgs([
    '--private-root=/tmp/f27-private',
    `--release-sha=${releaseSha}`,
    '--confirm-database=f27_rollback_execution',
    `--expected-post-contract-sha256=${HASHES.postContract}`,
    `--prepare-retained-drift-clones=${RETAINED_DRIFT_CONFIRMATION}`,
  ]).database === 'f27_rollback_execution'
    && parseArgs([
      '--private-root=/tmp/f27-private',
      `--release-sha=${releaseSha}`,
      '--confirm-database=f27_rollback_execution',
      `--expected-post-contract-sha256=${HASHES.postContract}`,
      `--prepare-retained-drift-clones=${RETAINED_DRIFT_CONFIRMATION}`,
    ]).prepareRetainedDriftClones === true
    && errorCode(() => parseArgs([
      '--private-root=/tmp/a',
      '--private-root=/tmp/b',
      `--release-sha=${releaseSha}`,
      '--confirm-database=f27_rollback_execution',
      `--expected-post-contract-sha256=${HASHES.postContract}`,
      `--prepare-retained-drift-clones=${RETAINED_DRIFT_CONFIRMATION}`,
    ])) === 'ARGUMENT_REJECTED',
  'CLI requires one exact private root, release SHA, post-contract hash, database, and retained-drift confirmation');
  ok(RETAINED_DRIFT_DATABASES.join(',')
      === 'f27_reinstall_retained_object,f27_reinstall_generation,f27_reinstall_open_work,f27_reinstall_fk_metadata,f27_reinstall_function_cost,f27_reinstall_column_catalog,f27_reinstall_stats_target,f27_reinstall_missing_value',
  'retained-state drift clones are a fixed literal set rather than operator-selected databases');
  ok(ZERO_AUDIT_REINSTALL_DATABASE === 'f27_reinstall_zero_audit'
      && LEGACY_HOLD_GUARD_ACL_SQL.includes("current_database() <> 'f27_reinstall_zero_audit'")
      && LEGACY_HOLD_GUARD_ACL_SQL.includes('DROP TRIGGER track_b_f27_hold_guard')
      && LEGACY_HOLD_GUARD_ACL_SQL.includes('DROP FUNCTION public.track_b_f27_hold_guard()')
      && LEGACY_HOLD_GUARD_ACL_SQL.includes('EXECUTE v_function_definition')
      && LEGACY_HOLD_GUARD_ACL_SQL.includes('EXECUTE v_trigger_definition')
      && LEGACY_HOLD_GUARD_ACL_SQL.includes('proacl IS NULL')
      && !LEGACY_HOLD_GUARD_ACL_SQL.includes('UPDATE pg_catalog'),
  'legacy production ACL is materialized only by ordinary DDL in one fixed disposable database');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f27-postgres-proof-test-'));
  try {
    const validPrivate = privateDirectory(tempRoot, 'private');
    ok(validatePrivateRoot(validPrivate, [path.join(tempRoot, 'worktree')]) === validPrivate,
      'private proof root must be empty, private, and outside every worktree');
    fs.writeFileSync(path.join(validPrivate, 'occupied'), 'x');
    ok(errorCode(() => validatePrivateRoot(validPrivate, [])) === 'PRIVATE_ROOT_NOT_EMPTY',
      'an occupied private root is rejected');

    const integrationPrivate = privateDirectory(tempRoot, 'integration-private');
    const callOrder = [];
    let installedRead = 0;
    let snapshotCall = 0;
    let recipeCall = 0;
    let migrationCall = 0;
    let zeroInstalledRead = 0;
    const zero = zeroAuditStates();
    const psql = {
      scalar(sql) {
        if (sql.includes('server_version_num')) return '17';
        if (sql.includes('rollback_operator_fixture.identity')) return 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE';
        throw new Error('unexpected scalar');
      },
      json(sql) {
        if (sql === BOUNDARY_STATE_SQL) return copy(base.preinstall);
        if (sql === INSTALLED_STATE_SQL) {
          installedRead += 1;
          if (installedRead === 1) return copy(base.beforeRollback);
          if (installedRead === 2) return copy(base.afterRollback);
          return copy(base.afterReinstall);
        }
        throw new Error('unexpected JSON query');
      },
      snapshotAdapter: {},
      migrationAdapter: {},
      rollbackAdapter: {},
    };
    const zeroAuditPsql = {
      scalar(sql) {
        if (sql.includes('server_version_num')) return '17';
        if (sql === CRLF_WRITE_AUTHORIZATION_SQL) {
          callOrder.push('alternate-reviewed-crlf');
          return CRLF_WRITE_AUTHORIZATION_TERMINAL;
        }
        if (sql === LEGACY_HOLD_GUARD_ACL_SQL) {
          callOrder.push('legacy-acl-materialization');
          return LEGACY_HOLD_GUARD_ACL_TERMINAL;
        }
        if (sql.includes('rollback_operator_fixture.identity')) return 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE';
        throw new Error('unexpected zero-audit scalar');
      },
      json(sql) {
        if (sql === LF_WRITE_AUTHORIZATION_SQL) {
          callOrder.push('alternate-reviewed-lf');
          return {
            status: 'PASS',
            normalized_source_sha256: HASHES.boundary,
            raw_cr_count: 0,
            preserved_non_source_field_count: 31,
          };
        }
        if (sql === BOUNDARY_STATE_SQL) return copy(zero.preinstall);
        if (sql === INSTALLED_STATE_SQL) {
          zeroInstalledRead += 1;
          if (zeroInstalledRead === 1) return copy(zero.beforeRollback);
          if (zeroInstalledRead === 2) return copy(zero.afterRollback);
          return copy(zero.afterReinstall);
        }
        throw new Error('unexpected zero-audit JSON query');
      },
      snapshotAdapter: {},
      migrationAdapter: {},
      rollbackAdapter: {},
    };
    const integrationReceipt = await runProof({
      privateRoot: integrationPrivate,
      database: 'f27_rollback_execution',
      releaseSha,
      expectedPostContractSha256: HASHES.postContract,
      prepareRetainedDriftClones: true,
      env: {
        PGHOST: 'localhost',
        PGPORT: '5432',
        PGUSER: 'postgres',
        PGDATABASE: 'f27_rollback_execution',
      },
    }, {
      worktrees: [path.resolve(__dirname, '..')],
      verifyRelease() {},
      psql,
      zeroAuditPsql,
      clonePristineZeroAuditDatabase(_env, source, target) {
        callOrder.push('clone-pristine-zero-audit');
        ok(source === 'f27_rollback_execution'
            && target === ZERO_AUDIT_REINSTALL_DATABASE,
        'orchestrator clones the pristine boundary to one fixed zero-audit database');
      },
      clonePostRollbackDatabases(_env, source, targets) {
        callOrder.push('clone-retained');
        ok(source === 'f27_rollback_execution'
            && JSON.stringify(targets) === JSON.stringify(RETAINED_DRIFT_DATABASES),
        'orchestrator clones only the fixed retained-state drift databases');
      },
      api: {
        captureSnapshot(options) {
          callOrder.push('capture');
          snapshotCall += 1;
          const pristine = [1, 3].includes(snapshotCall);
          return {
            status: 'PASS',
            pre_f27_baseline: 'PASS',
            pre_f27_entry_state: pristine
              ? 'pristine_pre_f27'
              : 'exact_post_section7',
            mirror_outbox_row_count: 2,
            mirror_outbox_non_terminal_row_count: 2,
            snapshot_bundle_sha256: pristine
              ? HASHES.snapshot
              : HASHES.reinstallSnapshot,
            preserved_fence_generations_sha256: HASHES.preservedGenerations,
            retained_audit_sha256: HASHES.retainedAudit,
          };
        },
        generateRollbackRecipe() {
          callOrder.push('recipe');
          recipeCall += 1;
          return {
            status: 'PASS',
            static_validation: 'PASS',
            private_readback: 'PASS',
            rollback_recipe_sha256: recipeCall % 2 === 1 ? HASHES.recipe : HASHES.reinstallRecipe,
          };
        },
        applyMigration(options) {
          callOrder.push('migration');
          migrationCall += 1;
          return {
            status: 'PASS',
            psql_exit_status: 0,
            migration_transaction_and_self_probe: 'PASS',
            migration_sha256: options.expectedMigrationSha256,
          };
        },
        createDrillTransport() {
          callOrder.push('transport');
          return {};
        },
        async runF27Drill() {
          callOrder.push('drill');
          return {
            terminal: 'F27_DRILL_RUNNER_OK',
            team: '__f27_drill__',
            audit_history_retained: true,
            dormant: true,
          };
        },
        executeRollback() {
          callOrder.push('rollback');
          return {
            status: 'PASS',
            execution: 'PASS',
            private_transcript_readback: 'PASS',
            private_transcript_sha256: HASHES.transcript,
          };
        },
        fingerprintPost() {
          callOrder.push('fingerprint-post');
          return { ...convergedPostContract };
        },
      },
    });
    ok(callOrder.join(',') === [
      'clone-pristine-zero-audit',
      'capture', 'recipe', 'migration', 'transport', 'drill', 'rollback',
      'clone-retained', 'capture', 'recipe', 'migration', 'fingerprint-post',
      'alternate-reviewed-crlf',
      'capture', 'recipe', 'migration', 'fingerprint-post', 'rollback',
      'alternate-reviewed-lf', 'legacy-acl-materialization',
      'capture', 'recipe', 'migration', 'fingerprint-post',
    ].join(',')
        && snapshotCall === 4 && recipeCall === 4 && migrationCall === 4
        && zeroInstalledRead === 3
        && integrationReceipt.status === 'PASS'
        && integrationReceipt.postgresql_17 === 'PASS'
        && integrationReceipt.zero_audit_production_sequence === 'PASS'
        && integrationReceipt.zero_audit_legacy_hold_guard_acl_adopted === 'PASS'
        && integrationReceipt.zero_audit_alternate_reviewed_line_endings === 'PASS'
        && integrationReceipt.zero_audit_write_authorization_raw_cr_count === 0
        && integrationReceipt.zero_audit_crlf_derived_pristine_post_contract_sha256
          === HASHES.postContract
        && !Object.prototype.hasOwnProperty.call(integrationReceipt, 'postgresql_16')
        && !fs.existsSync(integrationPrivate),
    'orchestrator proves drill-bearing and production-shaped zero-audit legacy-ACL reinstalls before removing private files');

    const wrongMajorPrivate = privateDirectory(tempRoot, 'wrong-major-private');
    let wrongMajor;
    try {
      await runProof({
        privateRoot: wrongMajorPrivate,
        database: 'f27_rollback_execution',
        releaseSha,
        expectedPostContractSha256: HASHES.postContract,
        prepareRetainedDriftClones: true,
        env: {
          PGHOST: 'localhost',
          PGPORT: '5432',
          PGUSER: 'postgres',
          PGDATABASE: 'f27_rollback_execution',
        },
      }, {
        worktrees: [path.resolve(__dirname, '..')],
        verifyRelease() {},
        psql: {
          scalar(sql) {
            if (sql.includes('server_version_num')) return '16';
            throw new Error('PostgreSQL 16 must be rejected before any other query');
          },
        },
        api: {
          captureSnapshot() { throw new Error('PostgreSQL 16 reached mutation proof'); },
        },
      });
    } catch (error) {
      wrongMajor = error;
    }
    ok(wrongMajor && wrongMajor.code === 'POSTGRESQL_17_REQUIRED'
        && !fs.existsSync(wrongMajorPrivate),
    'the rollback proof rejects PostgreSQL 16 before any operator step');

    const failedPrivate = privateDirectory(tempRoot, 'failed-private');
    let caught;
    try {
      await runProof({
        privateRoot: failedPrivate,
        database: 'f27_rollback_execution',
        releaseSha,
        expectedPostContractSha256: HASHES.postContract,
        prepareRetainedDriftClones: true,
        env: {
          PGHOST: 'localhost',
          PGPORT: '5432',
          PGUSER: 'postgres',
          PGDATABASE: 'f27_rollback_execution',
        },
      }, {
        worktrees: [path.resolve(__dirname, '..')],
        verifyRelease() {},
        psql,
        clonePristineZeroAuditDatabase() {},
        api: {
          captureSnapshot() {
            return {
              status: 'PASS',
              pre_f27_baseline: 'PASS',
              mirror_outbox_row_count: 2,
              mirror_outbox_non_terminal_row_count: 2,
              snapshot_bundle_sha256: HASHES.snapshot,
            };
          },
          generateRollbackRecipe() {
            return {
              status: 'PASS',
              static_validation: 'PASS',
              private_readback: 'PASS',
              rollback_recipe_sha256: HASHES.recipe,
            };
          },
          applyMigration() {
            throw new Error('private row body password=fixture-secret');
          },
        },
      });
    } catch (error) {
      caught = error;
    }
    const safeFailure = JSON.stringify(publicFailure(caught));
    ok(!fs.existsSync(failedPrivate)
        && safeFailure === '{"status":"FAIL","code":"F27_DATABASE_ROLLBACK_POSTGRES_PROOF_FAILED"}'
        && !safeFailure.includes('fixture-secret'),
    'failures delete all private runner files and expose only a bounded public-safe code');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  const source = fs.readFileSync(path.join(
    __dirname,
    '..',
    'scripts',
    'f27-database-rollback-postgres-proof.js',
  ), 'utf8');
  const runProofSource = source.slice(source.indexOf('async function runProof'));
  const sequence = [
    'const snapshot = api.captureSnapshot',
    'const recipe = api.generateRollbackRecipe',
    'const migration = api.applyMigration',
    'const drill = await api.runF27Drill',
    'const rollback = api.executeRollback',
    'cloneRetainedState(localEnv, target.database, RETAINED_DRIFT_DATABASES)',
    'const reinstallSnapshot = api.captureSnapshot',
    'const reinstallRecipe = api.generateRollbackRecipe',
    'const reinstallMigration = api.applyMigration',
    'const postContract = api.fingerprintPost',
  ].map(anchor => runProofSource.indexOf(anchor));
  ok(sequence.every(index => index >= 0)
      && sequence.every((index, offset) => offset === 0 || sequence[offset - 1] < index)
      && runProofSource.includes('finally {\n    cleanupPrivateRoot(privateRoot);')
      && !runProofSource.includes('console.log')
      && !runProofSource.includes('console.error'),
  'source contract fixes install, rollback, retained-state clone, reinstall, convergence, cleanup, and one bounded JSON output channel');
  ok(source.includes('clonePristineState(localEnv, target.database, ZERO_AUDIT_REINSTALL_DATABASE)')
      && source.includes('const zeroAudit = runZeroAuditReinstallProof({')
      && source.includes("current_database() <> 'f27_reinstall_zero_audit'")
      && source.includes('DROP TRIGGER track_b_f27_hold_guard ON public.mirror_outbox')
      && source.includes('DROP FUNCTION public.track_b_f27_hold_guard()')
      && source.includes('EXECUTE v_function_definition')
      && source.includes('EXECUTE v_trigger_definition')
      && source.includes('proacl IS NULL')
      && !source.includes('UPDATE pg_catalog.pg_proc'),
  'production-shaped zero-audit leg materializes the witnessed legacy ACL by ordinary disposable DDL and reinstalls');
  ok(CRLF_WRITE_AUTHORIZATION_SQL.includes('pg_get_functiondef(p.oid)')
      && CRLF_WRITE_AUTHORIZATION_SQL.includes("E'\\n',E'\\r\\n'")
      && LF_WRITE_AUTHORIZATION_SQL.includes(
        "replace(v_function_definition,E'\\r\\n',E'\\n')",
      )
      && LF_WRITE_AUTHORIZATION_SQL.includes("E'\\r',E'\\n'")
      && LF_WRITE_AUTHORIZATION_SQL.includes('EXECUTE v_function_definition')
      && LF_WRITE_AUTHORIZATION_SQL.includes('p.proowner=v_owner')
      && LF_WRITE_AUTHORIZATION_SQL.includes('p.proacl IS NOT DISTINCT FROM v_acl')
      && LF_WRITE_AUTHORIZATION_SQL.includes('p.proconfig IS NOT DISTINCT FROM v_config')
      && LF_WRITE_AUTHORIZATION_SQL.includes("to_jsonb(p)-'prosrc'=v_non_source_metadata")
      && LF_WRITE_AUTHORIZATION_SQL.includes("position(E'\\r' in p.prosrc)=0")
      && LF_WRITE_AUTHORIZATION_SQL.includes("length(replace(p.prosrc,E'\\r',''))")
      && LF_WRITE_AUTHORIZATION_SQL.includes("'raw_cr_count',v_raw_cr_count")
      && source.includes('const pristinePostContract = api.fingerprintPost')
      && source.includes(
        'pristinePostContract.f27_post_contract_sha256,\n    postContract',
      )
      && !CRLF_WRITE_AUTHORIZATION_SQL.includes('UPDATE pg_catalog')
      && !LF_WRITE_AUTHORIZATION_SQL.includes('UPDATE pg_catalog'),
  'zero-audit PG17 leg proves an LF-only alternate reviewed representation preserves all non-source function metadata and converges to the CRLF-derived contract');

  const workflow = fs.readFileSync(path.join(
    __dirname,
    '..',
    '.github',
    'workflows',
    'f27-team-rollback-proof.yml',
  ), 'utf8');
  ok(workflow.includes('"scripts/f27-database-rollback-postgres-proof.js"')
      && workflow.includes('"test/f27-database-rollback-postgres-proof.js"')
      && workflow.includes('node test/f27-database-rollback-postgres-proof.js')
      && workflow.includes('createdb f27_rollback_execution')
      && /PGDATABASE=f27_rollback_execution[\s\S]{0,180}f27_preinstall_only=1/.test(workflow)
      && /PGDATABASE: f27_rollback_execution[\s\S]{0,600}node scripts\/f27-database-rollback-postgres-proof\.js/.test(workflow),
  'workflow triggers, unit tests, and hosted proof all bind the dedicated preinstall-only disposable database');
  ok(/--expected-post-contract-sha256="\$expected_post_contract_sha256"/.test(workflow)
      && /--prepare-retained-drift-clones=F27_DISPOSABLE_RETAINED_DRIFT_ONLY/.test(workflow)
      && RETAINED_DRIFT_DATABASES.every(database => workflow.includes(database))
      && /retained_object[\s\S]*F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT/.test(workflow)
      && /naked_generation[\s\S]*F27_PREINSTALL_GATE_GENERATION_HISTORY_DRIFT/.test(workflow)
      && /open_work[\s\S]*F27_PREINSTALL_GATE_RETAINED_LEDGER_OPEN/.test(workflow)
      && /fk_metadata[\s\S]*mirror_outbox_f27_drill_rollback_id_fkey[\s\S]*DEFERRABLE INITIALLY DEFERRED/.test(workflow)
      && /function_cost[\s\S]*track_b_f27_begin\(text,jsonb,text\) COST 42/.test(workflow)
      && /column_catalog[\s\S]*track_b_team_rollbacks[\s\S]*actor SET COMPRESSION pglz/.test(workflow)
      && /stats_target[\s\S]*track_b_team_rollbacks[\s\S]*actor SET STATISTICS 42/.test(workflow)
      && /missing_value[\s\S]*VACUUM FULL public\.mirror_outbox/.test(workflow)
      && /CREATE EVENT TRIGGER proof_abort_if_persistent_mutation[\s\S]*ON ddl_command_start/.test(workflow)
      && /PROOF_PERSISTENT_MUTATION_REACHED/.test(workflow)
      && /schema_after[\s\S]*schema_before/.test(workflow)
      && /state_after[\s\S]*state_before/.test(workflow),
  'hosted PostgreSQL 17 proof clones exact post-Section-7 state and proves eight separate snapshot/migration aborts before DDL');
  ok(workflow.includes('F27_PRIVATE_ROOT: ${{ runner.temp }}/f27-database-rollback-private')
      && workflow.includes('test ! -e "$F27_PRIVATE_ROOT"')
      && !workflow.includes('F27_PRIVATE_ROOT: ${{ runner.temp }}/f27-proof')
      && !workflow.includes('SUPABASE_ACCESS_TOKEN')
      && !workflow.includes('F27_DATABASE_URL'),
  'hosted proof receives no production credential and cannot persist its private files in the artifact path');

  if (failures) {
    console.error(`\n${failures} F27 PostgreSQL rollback proof test(s) failed.`);
    process.exit(1);
  }
  console.log('\nF27 PostgreSQL rollback proof tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
