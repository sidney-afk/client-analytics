'use strict';

/*
 * Offline contract checks for the assignment lane's auth_kind binding. No
 * database, no network. Guards the shape of the change -- the things a
 * disposable-PostgreSQL rehearsal can pass while the migration still says
 * something it should not.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const MIGRATION = 'migrations/2026-09-18-native-assignment-auth-kind-binding.sql';
const migration = read(MIGRATION);
/* The header QUOTES the gate it removes, so any "is it gone" check has to read
   the executable body, not the file. Comment lines are stripped for exactly
   that: a migration must not pass its own contract check on its prose. */
const body = migration.split('\n').filter(line => !/^\s*--/.test(line)).join('\n');
const source = read('migrations/2026-09-18-native-test-client-parity.sql');

let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };

ok('it replaces exactly one routine and defines nothing new',
  JSON.stringify([...migration.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/g)].map(m => m[1]))
    === JSON.stringify(['production_assignee_write']));
ok('it creates no table, trigger, index or column', !/\b(create\s+(table|trigger|index)|alter\s+table)\b/i.test(migration));

ok('the staff-only gate this fixes is really there in the file it replaces',
  source.includes("or p_event->>'auth_kind' is distinct from 'staff'"));
ok('and it is gone from the executable body', !body.includes("p_event->>'auth_kind' is distinct from 'staff'"));
ok('auth_kind is BOUND to test_only in both directions, not merely widened',
  body.includes("or p_event->>'auth_kind' is distinct from (case when v_out->'test_only'='true'::jsonb then 'test' else 'staff' end)"));
ok('test_only must be a JSON boolean',
  body.includes("or jsonb_typeof(v_out->'test_only') is distinct from 'boolean'"));

/* legacy_parity is the half that must NOT move, asserted separately so a later
   edit cannot widen one while claiming the other. */
ok('the authority call still passes a LITERAL false for legacy_parity',
  body.includes("coalesce((v_out->>'test_only')::boolean,false),false)"));
ok('no legacy_parity refusal was removed',
  (source.match(/legacy_parity/g) || []).length > 0 && migration.includes('legacy_parity'));

const revokes = [...migration.matchAll(/revoke all on function[\s\S]*?;/g)].map(m => m[0]);
ok('every revoke names all four roles',
  revokes.length === 1 && ['public', 'anon', 'authenticated', 'service_role']
    .every(role => new RegExp(`\\b${role}\\b`).test(revokes[0])));
const grants = [...migration.matchAll(/grant execute on function ([\s\S]*?);/g)].map(m => m[1]);
ok('only service_role keeps EXECUTE, exactly as before',
  grants.length === 1 && /production_assignee_write/.test(grants[0]) && /to service_role/.test(grants[0]));
ok('the migration carries no UUID literal',
  !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(migration));

/* The premise, re-read from the gateway so this migration's reason cannot go
   stale without something failing. */
const gateway = read('supabase/functions/production-write/index.ts');
ok('eventFor still emits auth_kind from principal.kind', gateway.includes('auth_kind: principal.kind,'));
ok('the TEST principal still has kind "test"', /kind: "test",[\s\S]{0,400}?testOnly: true,/.test(gateway));
/* Why this lane needs no gateway change, stated precisely rather than by a
   proximity regex: after #1414 removed the label path's one, NO gateway line
   both reads principal.testOnly and throws. Every remaining use builds an
   event field. So the SQL binding is the whole fix here. */
ok('no gateway line both reads principal.testOnly and throws -- SQL is the whole fix for this lane',
  gateway.split('\n').filter(line => line.includes('principal.testOnly') && line.includes('throw')).length === 0);

const preflight = read('scripts/linear-exit-deploy-preflight.js');
ok('the preflight pins production_assignee_write to this migration',
  preflight.includes(`['production_assignee_write(jsonb,jsonb)', '${MIGRATION}'`));
const built = require('../scripts/linear-exit-install-manifest').build();
ok('it is in the install inventory', built.entries.some(e => e.id === path.basename(MIGRATION)));
ok('it installs after the parity migration whose body it replaces',
  built.dependency_order.indexOf('2026-09-18-native-test-client-parity.sql')
    < built.dependency_order.indexOf(path.basename(MIGRATION)));

console.log(JSON.stringify({
  marker: 'NATIVE_ASSIGNMENT_AUTH_KIND_CONTRACT_OK',
  checks: passed,
  migration_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, MIGRATION))).digest('hex'),
}));
