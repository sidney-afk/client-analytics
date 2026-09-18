'use strict';

/*
 * Offline half of the native test-client parity proof.
 *
 * The PostgreSQL lane (native-test-client-parity-postgres.js) proves the
 * BEHAVIOUR. This one proves the things a behaviour test cannot see and that a
 * later edit could silently undo: that the deploy contract still hashes the
 * definitions actually installed, that legacy_parity was not quietly widened
 * alongside test_only, and that the migration replaces rather than re-creates.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = 'migrations/2026-09-18-native-test-client-parity.sql';
const source = fs.readFileSync(path.join(ROOT, MIGRATION), 'utf8');
const preflight = fs.readFileSync(path.join(ROOT, 'scripts/linear-exit-deploy-preflight.js'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* The five routines this migration owns from here on. Each must be repointed
   in the deploy preflight, or the gate hashes a body nobody installs. */
const OWNED = [
  'production_native_ordinary_event(jsonb,jsonb)',
  'production_native_ordinary_receipt_guard()',
  'production_assignment_context(jsonb)',
  'production_native_assignment_receipt_guard()',
  'production_assignee_write(jsonb,jsonb)',
];
for (const signature of OWNED) {
  const row = new RegExp(`\\['${signature.replace(/[(){}[\].*+?^$|\\]/g, '\\$&')}',\\s*'([^']+)'`);
  const match = preflight.match(row);
  ok(match && match[1] === MIGRATION,
    `deploy preflight hashes ${signature} from this migration, not its superseded source`);
}

/* bodyFor takes the FIRST definition in the named file, so a second one would
   be hashed and never installed. */
for (const signature of OWNED) {
  const name = signature.replace(/\(.*$/, '');
  const defs = source.match(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'gi')) || [];
  ok(defs.length === 1, `${name} is defined exactly once, and as a replacement`);
}
ok(!/\bcreate\s+function\s+public\./i.test(source),
  'every routine is create-or-replace, so each keeps the ACL it already had');

/* The whole point: test_only stops being refused, legacy_parity does not. */
ok(!/or coalesce\(\(v_out->>'test_only'\)::boolean,false\)/.test(source),
  'the ordinary scope check no longer refuses a test_only envelope');
ok(/or coalesce\(\(v_out->>'legacy_parity'\)::boolean,false\)/.test(source),
  'the ordinary scope check still refuses a legacy_parity envelope');
ok(/new\.test_only is distinct from v_admission\.test_only/.test(source),
  'the ordinary guard compares test_only against the value the admission recorded');
ok(/new\.legacy_parity is distinct from false/.test(source),
  'the ordinary guard still compares legacy_parity against a hard false');
ok(/insert into public\.production_native_ordinary_receipt_admissions\([^)]*\btest_only\b/.test(source),
  'the admission records test_only');
ok(!/or new\.test_only or new\.legacy_parity/.test(source),
  'the assignment guard no longer refuses a test_only row outright');
ok(/if new\.entity<>'deliverable' or new\.legacy_parity or new\.role not in/.test(source),
  'the assignment guard still refuses a legacy_parity row');
ok(!/\(p_expected->>'test_only'\)::boolean is distinct from false/.test(source),
  'the assignment context no longer refuses a test_only envelope');
ok(/\(p_expected->>'legacy_parity'\)::boolean is distinct from false/.test(source),
  'the assignment context still refuses a legacy_parity envelope');

/* Every authority call must now carry the real test_only and a literal false
   for legacy_parity. A call still passing a hard false for test_only would
   validate a TEST write against the real team's prod_authority. */
/* `perform` only: the prerequisite block names the same routine in a
   to_regprocedure() signature string, which is not a call. */
const authorityCalls = source.match(/perform public\.production_assert_authority\([\s\S]*?\);/g) || [];
ok(authorityCalls.length === 4, `four authority calls are rewritten, found ${authorityCalls.length}`);
ok(authorityCalls.every(call => /,\s*false\s*\);$/.test(call.trim())),
  'every authority call still passes a literal false for legacy_parity');
ok(authorityCalls.every(call => /new\.test_only|p_expected->>'test_only'|v_out->>'test_only'/.test(call)),
  'no authority call passes a hard-coded false for test_only any more');

/* The constraint drop must be exact: the sibling legacy_parity check lives on
   the same table and must survive. */
ok(/pg_get_constraintdef\(oid\) = 'CHECK \(\(test_only = false\)\)'/.test(source),
  'the dropped constraint is located by its exact definition, not by name guessing');
ok(/pg_get_constraintdef\(oid\) = 'CHECK \(\(legacy_parity = false\)\)'/.test(source)
  && /native_test_client_parity_legacy_check_disturbed/.test(source),
  'the migration verifies the legacy_parity check is still there when it finishes');
ok(/native_test_client_parity_prerequisite_missing/.test(source),
  'the migration refuses to run against a database missing any object it replaces');

/* No grant, no revoke, and all four roles named so the absence is a statement. */
ok(!/^\s*(grant|revoke)\b/im.test(source),
  'the migration issues no grant and no revoke');
for (const role of ['service_role', 'anon', 'authenticated', 'public']) {
  ok(new RegExp(`\\b${role}\\b`).test(source), `${role} is named in the privilege note`);
}

/* Public-safety: this file ships in a public repository. */
ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(source),
  'the migration carries no uuid literal');

console.log(JSON.stringify({
  marker: 'NATIVE_TEST_CLIENT_PARITY_CONTRACT_OK',
  migration_sha256: crypto.createHash('sha256').update(source).digest('hex'),
  routines_repointed: OWNED.length,
}));
if (failures) process.exit(1);
