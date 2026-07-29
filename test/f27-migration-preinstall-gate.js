'use strict';

const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'migrations', '2026-07-20-f27-team-rollback.sql'),
  'utf8',
);
const driftFixture = fs.readFileSync(
  path.join(root, 'scripts', 'f27-migration-preinstall-drift.sql'),
  'utf8',
);
const abortProof = fs.readFileSync(
  path.join(root, 'scripts', 'f27-migration-preinstall-abort-proof.sql'),
  'utf8',
);
const proofWorkflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'f27-team-rollback-proof.yml'),
  'utf8',
);
const operatorFixture = fs.readFileSync(
  path.join(root, 'scripts', 'f27-drill-runner-fixture.sql'),
  'utf8',
);
const beginMarker = 'begin;';
const gateStartMarker = '-- F27_PREINSTALL_EXACT_SUBSET_GATE_BEGIN';
const gateEndMarker = '-- F27_PREINSTALL_EXACT_SUBSET_GATE_END';
const beginAt = migration.indexOf(beginMarker);
const gateStartAt = migration.indexOf(gateStartMarker);
const gateEndAt = migration.indexOf(gateEndMarker, gateStartAt);
const firstDdlAt = migration.indexOf(
  'create table if not exists public.track_b_f27_team_fences',
);
const gate = gateStartAt >= 0 && gateEndAt > gateStartAt
  ? migration.slice(gateStartAt, gateEndAt + gateEndMarker.length)
  : '';

ok(
  beginAt >= 0
    && gateStartAt > beginAt
    && gateEndAt > gateStartAt
    && firstDdlAt > gateEndAt,
  'the exact-subset gate runs immediately after BEGIN and before the first DDL',
);

const postBegin = migration.slice(beginAt + beginMarker.length);
const firstPersistentMutation = /^\s*(?:create|alter|drop|insert|update|delete|truncate|grant|revoke)\b/im.exec(
  postBegin,
);
const firstPersistentMutationAt = firstPersistentMutation
  ? beginAt + beginMarker.length + firstPersistentMutation.index
    + firstPersistentMutation[0].search(/\S/)
  : -1;
ok(
  firstPersistentMutation
    && firstPersistentMutationAt === firstDdlAt
    && firstPersistentMutationAt > gateEndAt,
  'no persistent mutation can run before the gate has passed',
);
ok(
  !/^\s*(?:create|alter|drop|insert|update|delete|truncate|grant|revoke)\b/im.test(gate),
  'the precondition itself contains no persistent mutation statement',
);

ok(
  /set local lock_timeout = '10s';/.test(gate)
    && /pg_advisory_xact_lock/.test(gate)
    && /lock table public\.mirror_outbox in access exclusive mode;/.test(gate)
    && /lock table public\.syncview_runtime_flags in share mode;/.test(gate)
    && /lock table public\.flag_flips in share mode;/.test(gate)
    && /lock table public\.track_b_f27_team_fences in share mode;/.test(gate),
  'transaction-scoped locks close queue, flag, ledger, and fence races before DDL',
);

ok(
  /'prod_authority'[\s\S]*'\{"video":"linear","graphics":"linear"\}'::jsonb/.test(gate)
    && /'linear_outbound_enabled'[\s\S]*'\{"mode":"off"\}'::jsonb/.test(gate)
    && /'linear_legacy_parity_enabled'[\s\S]*'\{"enabled":false\}'::jsonb/.test(gate)
    && /F27_PREINSTALL_GATE_RUNTIME_FLAGS_REQUIRED/.test(gate),
  'the later install window hard-requires Linear/Linear, F2 off, and F4 false',
);

ok(
  /pg_get_userbyid\(c\.relowner\) is distinct from 'postgres'/.test(gate)
    && /'postgres=arwdDxt\/postgres'/.test(gate)
    && /'service_role=r\/postgres'/.test(gate)
    && /c\.relchecks is distinct from 2/.test(gate)
    && /c\.relnatts is distinct from 4/.test(gate)
    && /track_b_f27_team_fences_team_check/.test(gate)
    && /track_b_f27_team_fences_generation_check/.test(gate)
    && /track_b_f27_team_fences_pkey/.test(gate)
    && /c\.conname = 'track_b_f27_team_fences_pkey'[\s\S]*?c\.contype = 'p'[\s\S]*?c\.connoinherit[\s\S]*?c\.conkey/.test(gate)
    && /c\.conname = 'track_b_f27_team_fences_team_check'[\s\S]*?c\.contype = 'c'[\s\S]*?not c\.connoinherit[\s\S]*?pg_get_expr/.test(gate)
    && /c\.conname = 'track_b_f27_team_fences_generation_check'[\s\S]*?c\.contype = 'c'[\s\S]*?not c\.connoinherit[\s\S]*?pg_get_expr/.test(gate)
    && /i\.indnullsnotdistinct/.test(gate)
    && /i\.indclass::text/.test(gate)
    && /i\.indcollation::text/.test(gate)
    && /where team not in \('video', 'graphics'\)/.test(gate)
    && /generation is distinct from 0/.test(gate)
    && /updated_by is distinct from 'f27-migration'/.test(gate),
  'the fence table requires the exact owner, ACL, shape, PostgreSQL-native inheritance posture, constraints, index, and generation-zero rows',
);

ok(
  /p\.prosrc is distinct from \$f27_write_authorization_source\$/.test(gate)
    && /pg_get_userbyid\(p\.proowner\) is distinct from 'postgres'/.test(gate)
    && /p\.proconfig is distinct from array\['search_path=public'\]::text\[\]/.test(gate)
    && /p\.proallargtypes is not null/.test(gate)
    && /p\.proargmodes is not null/.test(gate)
    && /p\.protrftypes is not null/.test(gate)
    && /p\.provariadic <> 0/.test(gate)
    && /p\.prosupport <> 0/.test(gate)
    && /'postgres=X\/postgres'/.test(gate)
    && /'service_role=X\/postgres'/.test(gate)
    && /F27_PREINSTALL_GATE_WRITE_AUTHORIZATION_DRIFT/.test(gate),
  'the write-authorization function requires the exact source, metadata, owner, and service-only ACL',
);

function extractedFunctionBody(source) {
  const signature =
    'create or replace function public.track_b_f27_write_authorization(p_team text)';
  const signatureAt = source.indexOf(signature);
  const bodyStartMarker = 'as $fn$';
  const bodyStart = source.indexOf(bodyStartMarker, signatureAt);
  const bodyEnd = source.indexOf('$fn$;', bodyStart + bodyStartMarker.length);
  if (signatureAt < 0 || bodyStart < 0 || bodyEnd <= bodyStart) return '';
  return source.slice(bodyStart + bodyStartMarker.length, bodyEnd);
}
const reviewedSourceMatch = gate.match(
  /\$f27_write_authorization_source\$([\s\S]*?)\$f27_write_authorization_source\$/,
);
ok(
  reviewedSourceMatch
    && reviewedSourceMatch[1] === extractedFunctionBody(migration),
  'the atomic catalog predicate is byte-bound to the function body installed later in the same migration',
);

const requiredCatalogs = [
  'pg_namespace',
  'pg_class',
  'pg_type',
  'pg_proc',
  'pg_constraint',
  'pg_index',
  'pg_trigger',
  'pg_rewrite',
  'pg_policy',
  'pg_inherits',
  'pg_collation',
  'pg_opclass',
  'pg_opfamily',
];
ok(
  requiredCatalogs.every(catalog => gate.includes(`from ${catalog}`))
    && /v_object_pattern constant text :=\s*'f27\|/.test(gate)
    && (gate.match(/~\* v_object_pattern/g) || []).length >= 20,
  'case-insensitive extra F27 schemas, relations, types/domains, functions, rules, inheritance, collations, and opclasses fail closed',
);
ok(
  /v_function_body_pattern constant text :=\s*'track_b_f27_\|track_b_team_rollback\|authority_generation\|f27_drill_rollback_id\|_f27_';/.test(gate)
    && /pg_get_functiondef\(p\.oid\) ~\* v_function_body_pattern/.test(gate)
    && !/pg_get_functiondef\(p\.oid\) ~\* v_object_pattern/.test(gate)
    && /v_object_pattern constant text :=\s*'f27\|track_b_team_rollback\|production_assert_authority\|authority_generation';/.test(gate),
  'function names still reject the retired authority RPC, while legitimate pre-F27 caller bodies do not',
);
ok(
  /create function public\.production_legacy_authority_probe\(/.test(operatorFixture)
    && /perform public\.production_assert_authority\(/.test(operatorFixture)
    && !/create (?:or replace )?function public\.production_assert_authority\(/i.test(operatorFixture)
    && operatorFixture.indexOf('production_legacy_authority_probe')
      < operatorFixture.indexOf('2026-07-28-f27-write-authorization-only.sql'),
  'the hosted positive fixture retains a representative legacy authority caller while the retired function stays absent',
);

ok(
  /a\.attrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /c\.conrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /i\.indrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /t\.tgrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /r\.ev_class = 'public\.mirror_outbox'::regclass/.test(gate)
    && /p\.polrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /F27_PREINSTALL_GATE_UNEXPECTED_F27_OBJECT/.test(gate),
  'every F27 outbox column, constraint, index, trigger, rule, or policy remains a hard failure',
);

ok(
  /F27_PREINSTALL_GATE_REQUIRED_BOUNDARY_MISSING/.test(gate)
    && /F27_PREINSTALL_GATE_FENCE_SUBSET_DRIFT/.test(gate)
    && /F27_PREINSTALL_EXACT_SUBSET_GATE_PASS/.test(gate)
    && !/current_setting|\\if|warning|configurable/i.test(gate),
  'the gate is hard-coded, fail-closed, and exposes only explicit terminal markers',
);

const hostedDriftCases = [
  'runtime_f4',
  'fence_generation',
  'function_source',
  'function_acl',
  'extra_function_overload',
  'fence_shape',
  'outbox_catalog',
  'outbox_constraint',
  'outbox_index',
  'outbox_trigger',
  'extra_schema',
  'extra_type_domain',
  'extra_rule',
  'extra_inheritance',
  'extra_collation',
  'extra_opclass',
  'extra_opfamily',
];
ok(
  hostedDriftCases.every(name => driftFixture.includes(`'${name}'`))
    && /"MiXeDF27OutboxDrift"/.test(driftFixture)
    && /track_b_f27_write_authorization\(\s*p_team text,\s*p_drift text\s*\)/.test(driftFixture)
    && /alter column generation drop not null/.test(driftFixture)
    && /"MiXeDF27OutboxConstraint"/.test(driftFixture)
    && /"MiXeDF27OutboxIndex"/.test(driftFixture)
    && /"MiXeDF27OutboxTrigger"/.test(driftFixture)
    && /"MiXeDF27Schema"/.test(driftFixture)
    && /"MiXeDF27Type"/.test(driftFixture)
    && /"MiXeDF27Domain"/.test(driftFixture)
    && /"MiXeDF27Rule"/.test(driftFixture)
    && /inherits \(public\.track_b_f27_team_fences\)/i.test(driftFixture)
    && /"MiXeDF27Collation"/.test(driftFixture)
    && /"MiXeDF27OperatorClass"/.test(driftFixture)
    && /"MiXeDF27OperatorFamily"/.test(driftFixture),
  'hosted disposable fixtures cover flags, generation, source, ACL, outbox, and mixed-case catalog drift classes',
);
ok(
  /track_b_team_rollbacks/.test(abortProof)
    && /track_b_team_rollback_intents/.test(abortProof)
    && /authority_generation/.test(abortProof)
    && /f27_drill_rollback_id/.test(abortProof)
    && /production_assert_authority/.test(abortProof)
    && /F27_PREINSTALL_DRIFT_ABORT_LEFT_DDL_RESIDUE/.test(abortProof)
    && /F27_PREINSTALL_DRIFT_ABORT_OK/.test(abortProof)
    && !/drop\s|delete\s|truncate\s/i.test(abortProof),
  'hosted post-error proof is read-only and rejects any first-DDL or self-probe residue',
);
ok(
  /scripts\/f27-migration-preinstall-drift\.sql/.test(proofWorkflow)
    && /scripts\/f27-migration-preinstall-abort-proof\.sql/.test(proofWorkflow)
    && /test\/f27-migration-preinstall-gate\.js/.test(proofWorkflow)
    && /node test\/f27-migration-preinstall-gate\.js/.test(proofWorkflow)
    && /Prove every preinstall drift aborts before DDL/.test(proofWorkflow)
    && hostedDriftCases.every(name => proofWorkflow.includes(name))
    && /F27_SNAPSHOT_DRIFT_ABORT_OK/.test(proofWorkflow)
    && /snapshot_gate=PASS/.test(proofWorkflow)
    && /candidate migration unexpectedly accepted/.test(proofWorkflow)
    && /F27_PREINSTALL_DRIFT_ABORT_OK/.test(proofWorkflow)
    && /persistent DDL residue: zero/.test(proofWorkflow),
  'the hosted PostgreSQL 16 workflow triggers and executes every fresh-database drift-abort proof',
);

if (failures) {
  console.error(`\n${failures} F27 migration preinstall-gate assertion(s) failed.`);
  process.exit(1);
}
console.log('\nF27 migration exact-subset precondition source contract passed.');
