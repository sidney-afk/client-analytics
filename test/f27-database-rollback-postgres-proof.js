'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  BOUNDARY_STATE_SQL,
  INSTALLED_STATE_SQL,
  parseArgs,
  publicFailure,
  publicReceipt,
  runProof,
  validatePrivateRoot,
  validateStateTransition,
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
};

function states() {
  const preinstall = {
    boundary: { count: 2, sha256: HASHES.boundary },
    flags: { count: 3, sha256: HASHES.flags },
    flag_flips: { count: 0, sha256: HASHES.flips },
  };
  const beforeRollback = {
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
    boundary: { count: 2, sha256: HASHES.installedBoundary },
    flags: { ...preinstall.flags },
    flag_flips: { ...preinstall.flag_flips },
    open_rollback_count: 0,
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
    flags: { ...preinstall.flags },
    flag_flips: { ...preinstall.flag_flips },
    trigger_enabled: 'D',
    production_assert_present: false,
    mutating_service_role_execute_count: 0,
  };
  return { preinstall, beforeRollback, afterRollback };
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
  'exact audit, flags, restored boundary, disabled hold trigger, and absent production assertion pass');
  ok(INSTALLED_STATE_SQL.includes('pg_get_constraintdef(c.oid,true)')
      && INSTALLED_STATE_SQL.includes('pg_get_indexdef(i.indexrelid,0,true)')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_drill_rollback_id_fkey')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_drill_scope_check')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_f27_generation_check')
      && INSTALLED_STATE_SQL.includes('mirror_outbox_one_f27_drill_row_idx')
      && INSTALLED_STATE_SQL.includes("c.conname ~* 'f27'")
      && INSTALLED_STATE_SQL.includes("ci.relname ~* 'f27'"),
  'hosted readback hashes exact definitions and includes every named or extra F27 constraint/index');

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
    state => { state.production_assert_present = true; },
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
    'each post-rollback absence, disabled-trigger, additive-object, and grant guard is mandatory');
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
  });
  const receiptText = JSON.stringify(receipt);
  ok(Object.values(receipt).every(value =>
    value === 'PASS' || Number.isInteger(value) || /^[a-f0-9]{64}$/.test(value)),
  'public receipt values are limited to PASS, integer counts, and SHA-256 hashes');
  ok(!/project_ref|database_name|private_path|source_closure|row_body|payload|token|password/i.test(receiptText)
      && receipt.audit_rollback_row_count === 1
      && receipt.audit_intent_row_count === 1
      && receipt.boundary_function_count === 2
      && receipt.additive_constraint_count === 3
      && receipt.additive_drill_index_count === 1
      && receipt.additive_object_count === 11,
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
  ]).database === 'f27_rollback_execution'
    && errorCode(() => parseArgs([
      '--private-root=/tmp/a',
      '--private-root=/tmp/b',
      `--release-sha=${releaseSha}`,
      '--confirm-database=f27_rollback_execution',
    ])) === 'ARGUMENT_REJECTED',
  'CLI requires one exact private root, release SHA, and database confirmation');

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
    const psql = {
      scalar(sql) {
        if (sql.includes('server_version_num')) return '16';
        if (sql.includes('rollback_operator_fixture.identity')) return 'ROLLBACK_DISPOSABLE_OPERATOR_FIXTURE';
        throw new Error('unexpected scalar');
      },
      json(sql) {
        if (sql === BOUNDARY_STATE_SQL) return copy(base.preinstall);
        if (sql === INSTALLED_STATE_SQL) {
          installedRead += 1;
          return copy(installedRead === 1 ? base.beforeRollback : base.afterRollback);
        }
        throw new Error('unexpected JSON query');
      },
      snapshotAdapter: {},
      migrationAdapter: {},
      rollbackAdapter: {},
    };
    const integrationReceipt = await runProof({
      privateRoot: integrationPrivate,
      database: 'f27_rollback_execution',
      releaseSha,
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
      api: {
        captureSnapshot(options) {
          callOrder.push('capture');
          return {
            status: 'PASS',
            pre_f27_baseline: 'PASS',
            mirror_outbox_row_count: 2,
            mirror_outbox_non_terminal_row_count: 2,
            snapshot_bundle_sha256: HASHES.snapshot,
          };
        },
        generateRollbackRecipe() {
          callOrder.push('recipe');
          return {
            status: 'PASS',
            static_validation: 'PASS',
            private_readback: 'PASS',
            rollback_recipe_sha256: HASHES.recipe,
          };
        },
        applyMigration(options) {
          callOrder.push('migration');
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
      },
    });
    ok(callOrder.join(',') === 'capture,recipe,migration,transport,drill,rollback'
        && integrationReceipt.status === 'PASS'
        && !fs.existsSync(integrationPrivate),
    'orchestrator generates the recipe before one migration, runs one reserved drill, executes rollback, then removes private files');

    const failedPrivate = privateDirectory(tempRoot, 'failed-private');
    let caught;
    try {
      await runProof({
        privateRoot: failedPrivate,
        database: 'f27_rollback_execution',
        releaseSha,
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
  const sequence = [
    'const snapshot = api.captureSnapshot',
    'const recipe = api.generateRollbackRecipe',
    'const migration = api.applyMigration',
    'const drill = await api.runF27Drill',
    'const rollback = api.executeRollback',
  ].map(anchor => source.indexOf(anchor));
  ok(sequence.every(index => index >= 0)
      && sequence.every((index, offset) => offset === 0 || sequence[offset - 1] < index)
      && source.includes('finally {\n    cleanupPrivateRoot(privateRoot);')
      && !source.includes('console.log')
      && !source.includes('console.error'),
  'source contract fixes exact operator order, mandatory cleanup, and one bounded JSON output channel');

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
