'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log(`  ok  ${message}`);
  else {
    failures += 1;
    console.error(`FAIL  ${message}`);
  }
}

const root = path.join(__dirname, '..');
const {
  reviewedFenceTableSqlGate: snapshotReviewedFenceTableSqlGate,
  sqlText: snapshotSqlText,
} = require(path.join(root, 'scripts', 'f27-mirror-outbox-snapshot.js'));
const migration = fs.readFileSync(
  path.join(root, 'migrations', '2026-07-20-f27-team-rollback.sql'),
  'utf8',
);
const liveAuthorityMigration = fs.readFileSync(
  path.join(root, 'migrations', '2026-07-12-write-ui-outbox-parity.sql'),
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
const snapshotPreinstallSql = snapshotSqlText();
const canonicalFenceTableSqlGate = snapshotReviewedFenceTableSqlGate();
const retainedGateStartMarker = "  if v_entry_state = 'retained_post_rollback' then\n"
  + '    -- Section 7 deliberately retains';
const retainedGateEndMarker = '\n  if exists (\n    select 1\n    from pg_proc p\n'
  + '    where p.oid = v_mirror_enqueue_oid';
const retainedGateStartAt = migration.indexOf(retainedGateStartMarker);
const retainedGateEndAt = migration.indexOf(
  retainedGateEndMarker,
  retainedGateStartAt + retainedGateStartMarker.length,
);
const canonicalRetainedSqlGate = retainedGateStartAt >= 0 && retainedGateEndAt > retainedGateStartAt
  ? migration.slice(retainedGateStartAt, retainedGateEndAt).trimEnd()
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
    && /lock table public\.track_b_f27_team_fences in share mode;/.test(gate)
    && /v_entry_state = 'retained_post_rollback'[\s\S]*execute 'lock table public\.track_b_team_rollbacks in share mode';/.test(gate)
    && /execute 'lock table public\.track_b_team_rollback_intents in share mode';/.test(gate),
  'transaction-scoped locks close queue, flag, ledger, and fence races before DDL',
);

ok(
  /v_entry_state := case[\s\S]*when v_rollbacks_oid is null then 'pristine'[\s\S]*else 'retained_post_rollback'/.test(gate)
    && /\(v_rollbacks_oid is null\) is distinct from \(v_intents_oid is null\)/.test(gate)
    && /F27_PREINSTALL_GATE_UNEXPECTED_F27_OBJECT/.test(gate)
    && !/allowlist|bypass|warning/i.test(gate),
  'the gate classifies exactly pristine or exact post-section-7 entry state and rejects every mixed state',
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
    && /aclexplode\(\s*coalesce\(c\.relacl, acldefault\('r', c\.relowner\)\)/.test(gate)
    && !gate.includes("'postgres=arwdDxt/postgres'")
    && /granted\.grantee is distinct from c\.relowner/.test(gate)
    && /granted\.grantor is distinct from c\.relowner/.test(gate)
    && /granted\.privilege_type is distinct from 'SELECT'/.test(gate)
    && /has_table_privilege\([\s\S]*supported_privilege\.privilege_type/.test(gate)
    && /'SELECT WITH GRANT OPTION'/.test(gate)
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
  'the fence table requires the exact owner, semantic service-role-only access, PostgreSQL-native shape, constraints, index, and generation-zero rows',
);

function countExact(source, value) {
  return source.split(value).length - 1;
}
const exactColumnCatalogPredicates = [
  'a.attcompression is distinct from \'\'::"char"',
  'a.attoptions is not null',
  'a.attfdwoptions is not null',
];
ok(
  exactColumnCatalogPredicates.every(predicate => (
    countExact(canonicalFenceTableSqlGate, predicate) === 1
      && countExact(canonicalRetainedSqlGate, predicate) === 2
  )),
  'every common fence, retained ledger, and retained outbox column binds compression, attribute options, and FDW options',
);
ok(
  countExact(canonicalRetainedSqlGate, 'a.attstattarget is not null') === 2
    && !canonicalRetainedSqlGate.includes('a.attstattarget is distinct from -1'),
  'the retained column contract binds the PostgreSQL 17 catalog-default statistics target rather than the PostgreSQL 16 sentinel',
);
ok(
  canonicalRetainedSqlGate.includes("('authority_generation', 'bigint', true, '0', true, '{0}')")
    && canonicalRetainedSqlGate.includes("('f27_drill_rollback_id', 'uuid', false, null::text, false, null::text)")
    && canonicalRetainedSqlGate.includes('a.atthasmissing is distinct from e.has_missing')
    && canonicalRetainedSqlGate.includes('a.attmissingval::text is distinct from e.missing_value')
    && countExact(canonicalRetainedSqlGate, 'or a.attmissingval is not null') === 1,
  'the exact PG17 retained contract preserves the authority-generation fast-default marker while forbidding missing values on every other retained column',
);
ok(
  canonicalFenceTableSqlGate
    && canonicalRetainedSqlGate
    && snapshotPreinstallSql.includes(canonicalFenceTableSqlGate)
    && snapshotPreinstallSql.includes(canonicalRetainedSqlGate),
  'the snapshot preflight inherits both canonical column-catalog gates source-exactly',
);

ok(
  /replace\(replace\(p\.prosrc, E'\\r\\n', E'\\n'\), E'\\r', E'\\n'\)/.test(gate)
    && /\$f27_write_authorization_source\$/.test(gate)
    && /pg_get_userbyid\(p\.proowner\) is distinct from 'postgres'/.test(gate)
    && /p\.proconfig is distinct from array\['search_path=public'\]::text\[\]/.test(gate)
    && /p\.proallargtypes is not null/.test(gate)
    && /p\.proargmodes is not null/.test(gate)
    && /p\.protrftypes is not null/.test(gate)
    && /p\.provariadic <> 0/.test(gate)
    && /p\.prosupport <> 0/.test(gate)
    && (gate.match(/aclexplode\(coalesce\(p\.proacl, acldefault\('f', p\.proowner\)\)\)/g) || []).length >= 8
    && (gate.match(/\bexcept\b/g) || []).length >= 4
    && (gate.match(/where a\.grantee is distinct from p\.proowner/g) || []).length >= 4
    && /select oid from pg_roles where rolname = 'service_role'/.test(gate)
    && /a\.grantor is distinct from p\.proowner/.test(gate)
    && /a\.privilege_type is distinct from 'EXECUTE'/.test(gate)
    && !/'postgres=X\/postgres'/.test(gate)
    && !/'service_role=X\/postgres'/.test(gate)
    && /F27_PREINSTALL_GATE_WRITE_AUTHORIZATION_DRIFT/.test(gate),
  'the write-authorization function requires the exact source, metadata, owner, and service-only ACL',
);
ok(
  /v_mirror_enqueue_oid := to_regprocedure\([\s\S]*mirror_outbox_enqueue/.test(gate)
    && /where p\.oid = v_mirror_enqueue_oid[\s\S]*acldefault\('f', p\.proowner\)[\s\S]*F27_PREINSTALL_GATE_MIRROR_ENQUEUE_ACL_DRIFT/.test(gate),
  'the preinstall gate preserves the reviewed service-only mirror enqueue ACL for exact rollback',
);

function extractedFunctionBody(source, signature) {
  const signatureAt = source.indexOf(signature);
  const bodyStartMarker = 'as $fn$';
  const bodyStart = source.indexOf(bodyStartMarker, signatureAt);
  const bodyEnd = source.indexOf('$fn$;', bodyStart + bodyStartMarker.length);
  if (signatureAt < 0 || bodyStart < 0 || bodyEnd <= bodyStart) return '';
  return source.slice(bodyStart + bodyStartMarker.length, bodyEnd);
}

const retainedFunctionHashes = {
  track_b_f27_requeue: '338f81384297ef8f8a36ba0cf2728badfc431a5d5dffff06a1bd7bb6bc37f37e',
  track_b_f27_hold_guard: 'c4bbdb066759e1eba586323d2b71ce3ceceb5041942aca1c14b1c404456c71c4',
  track_b_f27_begin: 'c5952a0bba903a2c7176eed67c6e54c8374f062a3d06d5c6b3b422d047a3f70b',
  track_b_f27_begin_drill: '88f2205fcae13dd0dd5b95d85f01b2a2c53dc34e5676feca221116a022134802',
  track_b_f27_classify: '456b94514bb590ef71280f421360772b21d43c6d0a77892c1f45d43f351dbe78',
  track_b_f27_execute_drill_replay: '02f94eebb08137f1450ca2a35ace81d78984c59028d30e05a042f650490d4f80',
  track_b_f27_record_terminal: '6ac629af0a9609d62a864199b0b2f5994354052d3a2ba00ba13480741ade6010',
  track_b_f27_finalize: '4a32ce511aea7b294b9d78c91a229cd77adbabd7a997505489a4b5f6d8767940',
  track_b_f27_finalize_drill: '99709ffcbb987d51851998e7f2b799400cb53765d643a180e456adda2f08c839',
};
const retainedHashesMatchReviewedBodies = Object.entries(retainedFunctionHashes).every(([name, expected]) => {
  const body = extractedFunctionBody(
    migration,
    `create or replace function public.${name}(`,
  ).replace(/\r\n?/g, '\n');
  const actual = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
  return actual === expected && gate.includes(`'${expected}'`);
});
ok(
  retainedHashesMatchReviewedBodies
    && /extensions\.digest\([\s\S]*replace\(replace\(p\.prosrc, E'\\r\\n', E'\\n'\), E'\\r', E'\\n'\)[\s\S]*sha256/.test(gate)
    && /F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT/.test(gate),
  'the retained function closure is normalized-source-hash-bound to the reviewed bodies installed by this migration',
);
const reviewedSourceMatch = gate.match(
  /\$f27_write_authorization_source\$([\s\S]*?)\$f27_write_authorization_source\$/,
);
ok(
  reviewedSourceMatch
    && reviewedSourceMatch[1] === extractedFunctionBody(
      migration,
      'create or replace function public.track_b_f27_write_authorization(p_team text)',
    ),
  'the atomic catalog predicate is normalized-source-bound to the function body installed later in the same migration',
);
const productionSourceMatch = gate.match(
  /\$f27_production_authority_source\$([\s\S]*?)\$f27_production_authority_source\$/,
);
const liveProductionSource = extractedFunctionBody(
  liveAuthorityMigration,
  'create or replace function public.production_assert_authority(',
);
ok(
  productionSourceMatch
    && productionSourceMatch[1] === liveProductionSource
    && /v_production_authority_oid := to_regprocedure\([\s\S]*production_assert_authority/.test(gate)
    && /F27_PREINSTALL_GATE_PRODUCTION_AUTHORITY_DRIFT/.test(gate)
    && /p\.prorettype is distinct from 'void'::regtype/.test(gate)
    && /p\.provolatile is distinct from 'v'/.test(gate)
    && /p\.proargnames is distinct from array\[[\s\S]*p_client_slug[\s\S]*p_legacy_parity/.test(gate)
    && /acldefault\('f', p\.proowner\)/.test(gate)
    && /a\.grantee is distinct from \(\s*select oid from pg_roles where rolname = 'service_role'/.test(gate),
  'the preinstall gate requires the exact normalized 2026-07-12 production authority boundary',
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
    && /v_object_pattern constant text :=\s*'f27\|track_b_team_rollback\|production_assert_authority\|authority_generation';/.test(gate)
    && /p\.oid <> v_production_authority_oid/.test(gate),
  'function names still reject every unreviewed authority overload while allowing only the exact pre-F27 identity',
);
ok(
  /create function public\.production_legacy_authority_probe\(/.test(operatorFixture)
    && /perform public\.production_assert_authority\(/.test(operatorFixture)
    && /create or replace function public\.production_assert_authority\(/i.test(operatorFixture)
    && extractedFunctionBody(
      operatorFixture,
      'create or replace function public.production_assert_authority(',
    ) === liveProductionSource
    && /f27_crlf_fixture/.test(operatorFixture)
    && operatorFixture.indexOf('production_legacy_authority_probe')
      < operatorFixture.indexOf('2026-07-28-f27-write-authorization-only.sql'),
  'the hosted positive fixture carries the exact live authority boundary and exercises CRLF-normalized source checks',
);

ok(
  /a\.attrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /c\.conrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /i\.indrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /t\.tgrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /r\.ev_class = 'public\.mirror_outbox'::regclass/.test(gate)
    && /p\.polrelid = 'public\.mirror_outbox'::regclass/.test(gate)
    && /F27_PREINSTALL_GATE_UNEXPECTED_F27_OBJECT/.test(gate),
  'every unreviewed F27 outbox column, constraint, index, trigger, rule, or policy remains a hard failure',
);

ok(
  /\(v_rollbacks_oid, 15, 4\)/.test(gate)
    && /\(v_intents_oid, 10, 1\)/.test(gate)
    && /track_b_team_rollbacks_scope_check/.test(gate)
    && /track_b_team_rollback_intents_classification_check/.test(gate)
    && /mirror_outbox_f27_drill_scope_check/.test(gate)
    && /track_b_team_rollbacks_one_open_team_idx/.test(gate)
    && /mirror_outbox_one_f27_drill_row_idx/.test(gate)
    && /t\.tgenabled = 'D'/.test(gate)
    && /t\.tgfoid = to_regprocedure\('public\.track_b_f27_hold_guard\(\)'\)/.test(gate)
    && /t\.tgtype = 23/.test(gate)
    && /authority_generation[\s\S]*f27_drill_rollback_id[\s\S]*legacy_parity[\s\S]*status[\s\S]*team[\s\S]*test_only/.test(gate),
  'the retained tables, additive outbox boundary, indexes, checks, and disabled trigger are exact before adoption',
);

ok(
  /cases=\(retained_object naked_generation open_work fk_metadata function_cost column_catalog stats_target missing_value\)/.test(proofWorkflow)
    && /column_catalog\)[\s\S]*f27_reinstall_column_catalog[\s\S]*F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT[\s\S]*ALTER TABLE public\.track_b_team_rollbacks[\s\S]*ALTER COLUMN actor SET COMPRESSION pglz/.test(proofWorkflow)
    && /stats_target\)[\s\S]*f27_reinstall_stats_target[\s\S]*ALTER COLUMN actor SET STATISTICS 42/.test(proofWorkflow)
    && /missing_value\)[\s\S]*f27_reinstall_missing_value[\s\S]*VACUUM FULL public\.mirror_outbox/.test(proofWorkflow),
  'the retained-state proof seeds nondefault PG17 compression, statistics, and fast-default catalog posture and requires both pre-DDL gates to fail closed',
);

const retainedTriggerMatch = gate.match(
  /if \(select count\(\*\) from pg_trigger t[\s\S]*?raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';\s+end if;/,
);
const retainedTriggerGate = retainedTriggerMatch ? retainedTriggerMatch[0] : '';
const retainedTriggerOrderMatch = retainedTriggerGate.match(
  /select array_agg\(a\.attname::text order by trigger_column\.ordinality\)[\s\S]*?\) = array\[([\s\S]*?)\]::text\[\]/,
);
const retainedTriggerColumns = retainedTriggerOrderMatch
  ? [...retainedTriggerOrderMatch[1].matchAll(/'([^']+)'/g)].map(match => match[1])
  : [];
const installedTriggerOrderMatch = migration.match(
  /create trigger track_b_f27_hold_guard\s+before insert or update of([\s\S]*?)\s+on public\.mirror_outbox/,
);
const installedTriggerColumns = installedTriggerOrderMatch
  ? installedTriggerOrderMatch[1].split(',').map(value => value.trim().replace(/\s+/g, ' '))
  : [];
const reviewedTriggerColumns = [
  'status',
  'team',
  'authority_generation',
  'legacy_parity',
  'test_only',
  'f27_drill_rollback_id',
];
const permutedTriggerColumns = [
  'team',
  'status',
  'authority_generation',
  'legacy_parity',
  'test_only',
  'f27_drill_rollback_id',
];
const exactTriggerOrder = columns => (
  JSON.stringify(columns) === JSON.stringify(reviewedTriggerColumns)
);
ok(
  retainedTriggerGate
    && /select array_agg\(a\.attname::text order by trigger_column\.ordinality\)[\s\S]*?from unnest\(t\.tgattr::smallint\[\]\) with ordinality\s+as trigger_column\(attnum, ordinality\)/.test(retainedTriggerGate)
    && !/order by a\.attname/.test(retainedTriggerGate)
    && exactTriggerOrder(retainedTriggerColumns)
    && exactTriggerOrder(installedTriggerColumns)
    && !exactTriggerOrder(permutedTriggerColumns),
  'the retained disabled trigger binds the reviewed UPDATE OF column order and rejects a set-equivalent permutation',
);
ok(
  retainedTriggerGate && snapshotPreinstallSql.includes(retainedTriggerGate),
  'the snapshot preflight inherits the exact retained trigger-order predicate from the canonical migration gate',
);

const retainedCheckConstraintMatch = gate.match(
  /if exists \(\s+with expected\(name, relation_oid, expression_text\)[\s\S]*?raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';\s+end if;/,
);
const retainedCheckConstraintGate = retainedCheckConstraintMatch
  ? retainedCheckConstraintMatch[0]
  : '';
const retainedOutboxFkMatch = gate.match(
  /where c\.conrelid = 'public\.mirror_outbox'::regclass\s+and c\.conname = 'mirror_outbox_f27_drill_rollback_id_fkey'[\s\S]*?and c\.confupdtype = 'a' and c\.confdeltype = 'a' and c\.confmatchtype = 's'/,
);
const retainedOutboxFkGate = retainedOutboxFkMatch ? retainedOutboxFkMatch[0] : '';
function hasExactConstraintPosture(source, checkConstraint) {
  return /c\.connamespace (?:is distinct from|=) 'public'::regnamespace/.test(source)
    && (checkConstraint
      ? /c\.contype is distinct from 'c'/.test(source)
      : /c\.contype = 'f'/.test(source))
    && (checkConstraint ? /not c\.convalidated/.test(source) : /c\.convalidated/.test(source))
    && (checkConstraint ? /c\.condeferrable/.test(source) : /not c\.condeferrable/.test(source))
    && (checkConstraint ? /c\.condeferred/.test(source) : /not c\.condeferred/.test(source))
    && (checkConstraint ? /not c\.conislocal/.test(source) : /c\.conislocal/.test(source))
    && /c\.coninhcount (?:<>|=) 0/.test(source)
    && /c\.conparentid (?:<>|=) 0/.test(source)
    && (checkConstraint ? /c\.connoinherit/.test(source) : /and c\.connoinherit/.test(source));
}
ok(
  retainedCheckConstraintGate.includes("'mirror_outbox_f27_generation_check'")
    && retainedCheckConstraintGate.includes("'mirror_outbox_f27_drill_scope_check'")
    && hasExactConstraintPosture(retainedCheckConstraintGate, true)
    && retainedOutboxFkGate
    && hasExactConstraintPosture(retainedOutboxFkGate, false)
    && canonicalRetainedSqlGate.includes("c.connoinherit is distinct from (c.contype <> 'c')"),
  'all retained constraints require the exact PG17 public, validated, immediate, local, and type-relative no-inherit catalog posture',
);
ok(
  retainedCheckConstraintGate
    && retainedOutboxFkGate
    && snapshotPreinstallSql.includes(retainedCheckConstraintGate)
    && snapshotPreinstallSql.includes(retainedOutboxFkGate),
  'the snapshot preflight inherits all retained outbox constraint metadata predicates from the canonical migration gate',
);

const retainedFunctionDefinitionMatch = gate.match(
  /with expected\(\s+identity, result_type, argument_names, argument_defaults,\s+volatility, source_sha256\s+\)[\s\S]*?raise exception 'F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT';\s+end if;/,
);
const retainedFunctionDefinitionGate = retainedFunctionDefinitionMatch
  ? retainedFunctionDefinitionMatch[0]
  : '';
const writeAuthorizationDefinitionMatch = gate.match(
  /where p\.oid = v_write_authorization_oid[\s\S]*?raise exception 'F27_PREINSTALL_GATE_WRITE_AUTHORIZATION_DRIFT';\s+end if;/,
);
const productionAuthorityDefinitionMatch = gate.match(
  /where p\.oid = v_production_authority_oid[\s\S]*?raise exception 'F27_PREINSTALL_GATE_PRODUCTION_AUTHORITY_DRIFT';\s+end if;/,
);
function hasExactPlpgsqlExecutionMetadata(source) {
  return /p\.procost is distinct from 100::real/.test(source)
    && /p\.prorows is distinct from 0::real/.test(source)
    && /p\.probin is not null/.test(source)
    && /p\.prosqlbody is not null/.test(source);
}
ok(
  retainedFunctionDefinitionGate
    && hasExactPlpgsqlExecutionMetadata(retainedFunctionDefinitionGate)
    && writeAuthorizationDefinitionMatch
    && hasExactPlpgsqlExecutionMetadata(writeAuthorizationDefinitionMatch[0])
    && productionAuthorityDefinitionMatch
    && hasExactPlpgsqlExecutionMetadata(productionAuthorityDefinitionMatch[0]),
  'all adopted or already source-exact PL/pgSQL functions bind COST, ROWS, probin, and prosqlbody before DDL',
);
ok(
  retainedFunctionDefinitionGate
    && snapshotPreinstallSql.includes(retainedFunctionDefinitionGate),
  'the snapshot preflight inherits the retained function execution-metadata predicates from the canonical migration gate',
);

ok(
  /legacy_2026_08_01_acldefault_public_execute/.test(gate)
    && /current_owner_only/.test(gate)
    && /when p\.proacl is null[\s\S]*a\.grantee <> 0[\s\S]*a\.privilege_type is distinct from 'EXECUTE'/.test(gate)
    && /when p\.proacl is not null[\s\S]*where a\.grantee is distinct from p\.proowner/.test(gate)
    && /p\.proacl is null[\s\S]*F27_PREINSTALL_GATE_RETAINED_OBJECT_DRIFT/.test(gate)
    && /public\.track_b_f27_finalize_drill\(uuid,jsonb,text\)/.test(gate),
  'hold_guard accepts only the witnessed legacy NULL/default ACL or current explicit owner-only ACL, while all eight mutating RPCs are owner-only',
);

ok(
  /where state = 'open'[\s\S]*classification is null[\s\S]*classification = 'replay' and terminal_receipt is null[\s\S]*F27_PREINSTALL_GATE_RETAINED_LEDGER_OPEN/.test(gate)
    && /i\.row_sha256 is distinct from encode\([\s\S]*i\.row_snapshot::text/.test(gate)
    && /i\.row_snapshot->>'id' is distinct from i\.outbox_id::text/.test(gate)
    && /i\.classification_history->-1->>'to' is distinct from i\.classification/.test(gate)
    && /i\.classification in \('replay', 'already_reflected'\)[\s\S]*jsonb_typeof\(i\.terminal_receipt\) is distinct from 'object'/.test(gate)
    && /jsonb_typeof\(r\.expected_authority\) is distinct from 'object'/.test(gate)
    && /jsonb_typeof\(r\.prior_outbound\) is distinct from 'object'/.test(gate)
    && /jsonb_typeof\(r\.prior_parity\) is distinct from 'object'/.test(gate)
    && /jsonb_typeof\(r\.terminal_receipt\) is distinct from 'object'/.test(gate)
    && /f27_already_reflected_terminal/.test(gate)
    && /linear_write_terminal/.test(gate)
    && /f27_drill_replay_terminal/.test(gate)
    && /r\.snapshot_count is distinct from audit\.intent_count/.test(gate)
    && /r\.snapshot_sha256 is distinct from audit\.intent_sha256/.test(gate)
    && /fence_generation_before/.test(gate)
    && /fence_generation_after/.test(gate)
    && /history\.distinct_generation_count is distinct from history\.completed_count/.test(gate)
    && /f\.generation is distinct from history\.completed_count/.test(gate)
    && /F27_PREINSTALL_GATE_GENERATION_HISTORY_DRIFT/.test(gate),
  'the retained audit chain binds JSON object types, rows, classifications, receipts, snapshots, and monotone contiguous fence generations',
);

const retainedAdoptions = [
  ['write_authorization', 'public.track_b_f27_write_authorization(text)'],
  ['requeue', 'public.track_b_f27_requeue(bigint,bigint)'],
  ['hold_guard', 'public.track_b_f27_hold_guard()'],
  ['begin', 'public.track_b_f27_begin(text,jsonb,text)'],
  ['begin_drill', 'public.track_b_f27_begin_drill(jsonb,text)'],
  ['classify', 'public.track_b_f27_classify(uuid,bigint,text,text,text,jsonb)'],
  ['execute_drill_replay', 'public.track_b_f27_execute_drill_replay(uuid,bigint,uuid)'],
  ['record_terminal', 'public.track_b_f27_record_terminal(uuid,bigint,jsonb)'],
  ['finalize', 'public.track_b_f27_finalize(uuid,jsonb,text)'],
  ['finalize_drill', 'public.track_b_f27_finalize_drill(uuid,jsonb,text)'],
];
ok(
  retainedAdoptions.every(([tag, identity]) => (
    migration.includes(`do $f27_adopt_${tag}$`)
      && migration.includes(`if to_regprocedure('${identity}') is null then`)
      && migration.includes(`execute $f27_create_${tag}$`)
  ))
    && /on conflict \(team\) do nothing;/.test(migration)
    && /do \$f27_adopt_hold_trigger\$[\s\S]*if not exists[\s\S]*create trigger track_b_f27_hold_guard[\s\S]*else[\s\S]*alter table public\.mirror_outbox enable trigger track_b_f27_hold_guard/.test(migration),
  'reinstall adopts retained function and trigger OIDs, creates only missing objects, and never resets fence generations',
);

ok(
  gate.includes('c4fa6e8e34feb187980a616a076d2aa1f5b7580a4c76204d2661ba3e208296d9')
    && gate.includes('e884b7d369389388ed5e55c376f3518f4fdc4379e64c683596adf4cb9ab2772c'),
  'the exact retained contract records the reviewed 2026-08-01 boundary and rollback transcript cross-check receipts',
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
  'fence_acl_public',
  'fence_acl_service_write',
  'fence_acl_service_grant',
  'fence_acl_unexpected_grantee',
  'function_source',
  'function_acl',
  'mirror_enqueue_acl',
  'production_authority_source',
  'production_authority_acl',
  'production_authority_overload',
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
    && /grant select on public\.track_b_f27_team_fences to public/.test(driftFixture)
    && /grant update on public\.track_b_f27_team_fences to service_role/.test(driftFixture)
    && /with grant option/.test(driftFixture)
    && /create role f27_unexpected_reader/.test(driftFixture)
    && /mirror_outbox_enqueue\([\s\S]*\) to authenticated/.test(driftFixture)
    && /production_assert_authority\([\s\S]*raise notice 'drift'/.test(driftFixture)
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
  'the hosted PostgreSQL 17 workflow triggers and executes every fresh-database drift-abort proof',
);

if (failures) {
  console.error(`\n${failures} F27 migration preinstall-gate assertion(s) failed.`);
  process.exit(1);
}
console.log('\nF27 migration exact-subset precondition source contract passed.');
