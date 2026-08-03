'use strict';

const assert = require('assert');
const path = require('path');
const {
  BOOLEAN_PREDICATES, GATE, SOURCE_PREDICATES, SQL, functionBody, main, sha256,
} = require('../scripts/f133-post-inverse-verify.js');

const repo = path.resolve(__dirname, '..');
const hashes = {
  intake_append_source_sha256: sha256(functionBody(
    path.join(repo, 'migrations', '2026-07-13-production-intake-append.sql'),
    'production_intake_append',
  )),
  issue_linkage_source_sha256: sha256(functionBody(
    path.join(repo, 'migrations', '2026-07-23-f203-production-issue-create.sql'),
    'production_issue_create_linkage',
  )),
};
const pass = {
  transaction_exact: true,
  flag_off: true,
  zero_open_title_intents: true,
  canonical_functions_absent: true,
  canonical_triggers_absent: true,
  temporary_function_names_absent: true,
  restored_functions_present: true,
  restored_function_metadata_exact: true,
  ...hashes,
  retained_title_revision_exact: true,
  retained_title_outbox_check: true,
};

function spawnReceipt(receipt) {
  return () => ({ status: 0, stdout: `${JSON.stringify(receipt)}\n`, stderr: '' });
}

assert.match(SQL, /begin isolation level repeatable read read only/i);
assert.strictEqual((SQL.match(/begin isolation level repeatable read read only/gi) || []).length, 1);
assert.strictEqual((SQL.match(/^commit;/gim) || []).length, 1);
assert.doesNotMatch(SQL, /^\s*(?:insert|update|delete|alter|drop|create|grant|revoke|truncate|call)\b/im);
assert.match(SQL, /production_canonical_title_dependency_resolve/);
assert.match(SQL, /production_canonical_title_dependency_valid/);
assert.match(SQL, /title_revision/);
assert.match(SQL, /temporary_function_names_absent[\s\S]*p\.proname in \([\s\S]*production_intake_append_v3[\s\S]*production_issue_create_linkage_pre_f133/i);
assert.match(SQL, /p\.proname='production_intake_append'\) = 1[\s\S]*p\.proname='production_issue_create_linkage'\) = 1/i);
assert.match(SQL, /production_intake_append'[\s\S]*p\.prorettype is distinct from 'jsonb'::regtype[\s\S]*production_issue_create_linkage'[\s\S]*public\.deliverables'::regtype/i);
assert.match(SQL, /aclexplode\(acldefault\('f',p\.proowner\)\)[\s\S]*except[\s\S]*aclexplode\(coalesce\(p\.proacl,acldefault\('f',p\.proowner\)\)\)/i);
assert.match(SQL, /count\(\*\)[\s\S]*a\.grantee is distinct from p\.proowner\)[\s\S]*is distinct from 1/i);
assert.match(SQL, /r\.rolname is distinct from 'service_role'[\s\S]*a\.grantor is distinct from p\.proowner[\s\S]*a\.privilege_type is distinct from 'EXECUTE'/i);
assert.match(SQL, /\('calendar_posts'::text, 'calendar_posts_title_revision_nonnegative'::text\)[\s\S]*\('sample_reviews'::text, 'sample_reviews_title_revision_nonnegative'::text\)[\s\S]*con\.conrelid = case expected\.table_name/i);
assert.match(SQL, /not con\.convalidated[\s\S]*con\.coninhcount <> 0[\s\S]*pg_get_expr\(con\.conbin,con\.conrelid,true\)[\s\S]*title_revision>=0/i);
assert.match(SQL, /mirror_outbox_legacy_parity_operation_check[\s\S]*con\.convalidated[\s\S]*legacy_parity=falseoroperation=anyarray\[''create''::text,''status''::text,''comment''::text,''title''::text\]/i);
assert.doesNotMatch(SQL, /pg_get_constraintdef\([^)]*\)\s+like\s+'%title%'/i);
const success = main({ F133_DATABASE_URL: 'postgresql://fixture.invalid/db' }, {
  spawnSync: spawnReceipt(pass),
});
assert.deepStrictEqual(success, {
  status: 'PASS', gate: GATE, predicate_count: 12, failed_predicates: [],
});

const priorExit = process.exitCode;
function requireOnlyFailure(observed, expectedFailure) {
  process.exitCode = 0;
  const red = main({ F133_DATABASE_URL: 'postgresql://fixture.invalid/db' }, {
    spawnSync: spawnReceipt(observed),
  });
  assert.strictEqual(red.status, 'FAIL');
  assert.deepStrictEqual(red.failed_predicates, [expectedFailure]);
  assert.strictEqual(red.predicate_count, 12);
  assert.strictEqual(process.exitCode, 1);
}
for (const predicate of BOOLEAN_PREDICATES) {
  requireOnlyFailure({ ...pass, [predicate]: false }, predicate);
}
for (const [sourceField, predicate] of Object.entries(SOURCE_PREDICATES)) {
  requireOnlyFailure({ ...pass, [sourceField]: '0'.repeat(64) }, predicate);
}
const missingFlag = { ...pass };
delete missingFlag.flag_off;
requireOnlyFailure(missingFlag, 'flag_off');
requireOnlyFailure({ ...pass, unexpected_contract_field: true }, 'receipt_shape_exact');
process.exitCode = priorExit;

console.log(JSON.stringify({ status: 'PASS', test: 'f133-post-inverse-verify' }));
