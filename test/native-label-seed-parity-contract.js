'use strict';

/*
 * Offline contract checks for the two label-lane migrations on this PR. No
 * database, no network. These police the SHAPE of the change -- the things a
 * disposable-PostgreSQL rehearsal can pass while the migration still says
 * something it should not.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SEED_PATH = 'migrations/2026-09-18-native-label-empty-state-seed.sql';
const PARITY_PATH = 'migrations/2026-09-18-native-label-test-client-parity.sql';
const SOURCE_PATH = 'migrations/2026-09-06-native-label-writes.sql';
const seed = read(SEED_PATH);
const parity = read(PARITY_PATH);
const source = read(SOURCE_PATH);

let passed = 0;
const ok = (name, value) => { assert.ok(value, name); passed += 1; console.log(`  ok ${name}`); };

/* ---------------------------------------------------------- the parity half */

/* Exactly the two bodies, replaced, and nothing else defined. */
const parityDefs = [...parity.matchAll(/create\s+or\s+replace\s+function\s+public\.(\w+)\s*\(/g)].map(m => m[1]).sort();
ok('the parity migration replaces exactly the two label routines and defines nothing new',
  JSON.stringify(parityDefs) === JSON.stringify(['production_labels_write', 'production_native_label_receipt_guard']));
ok('it creates no table, trigger, index or column', !/\b(create\s+(table|trigger|index)|alter\s+table)\b/i.test(parity));

/* test_only: the refusals are gone and the real value flows to both places. */
ok('production_labels_write no longer refuses test_only',
  source.includes("or v_out->'test_only' is distinct from 'false'::jsonb")
    && !parity.includes("or v_out->'test_only' is distinct from 'false'::jsonb"));
ok('the receipt guard no longer refuses test_only',
  source.includes('or new.test_only is distinct from false')
    && !parity.includes('or new.test_only is distinct from false'));
ok('the writer passes the REAL test_only to production_assert_authority',
  parity.includes("perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',coalesce((v_out->>'test_only')::boolean,false),false);"));
ok('the guard passes the REAL test_only to production_assert_authority',
  parity.includes('perform public.production_assert_authority(new.client_slug,new.team,new.test_only,false);'));
ok('THE COMPARE: production_outbox_replay receives the real test_only, not a literal false',
  parity.includes("p_event->>'role',coalesce((v_out->>'test_only')::boolean,false),false,v_payload->>'_intent_fingerprint'"));

/* legacy_parity: every half of it is untouched, asserted separately so a later
   edit cannot widen one while claiming the other. */
ok('legacy_parity is still refused in the writer',
  parity.includes("or v_out->'legacy_parity' is distinct from 'false'::jsonb"));
ok('legacy_parity is still refused in the guard',
  parity.includes('or new.legacy_parity is distinct from false'));
ok('both authority calls still pass a LITERAL false for legacy_parity',
  (parity.match(/production_assert_authority\([^;]*,false\);/g) || []).length === 2);
ok('the replay call still passes a literal false for legacy_parity',
  parity.includes("coalesce((v_out->>'test_only')::boolean,false),false,v_payload"));

/* Privileges: all four roles named, nothing new granted. */
for (const [label, text] of [['seed', seed], ['parity', parity]]) {
  const revokes = [...text.matchAll(/revoke all on function[\s\S]*?;/g)].map(m => m[0]);
  ok(`${label}: every revoke names all four roles`,
    revokes.length > 0 && revokes.every(r =>
      ['public', 'anon', 'authenticated', 'service_role'].every(role => new RegExp(`\\b${role}\\b`).test(r))));
}
const parityGrants = [...parity.matchAll(/grant execute on function ([\s\S]*?);/g)].map(m => m[1]);
ok('parity grants EXECUTE to service_role only, and only on the writer it already had',
  parityGrants.length === 1 && /production_labels_write/.test(parityGrants[0]) && /to service_role/.test(parityGrants[0]));
ok('the seed migration grants nothing at all', !/^\s*grant\s/im.test(seed));

/* ------------------------------------------------------------ the seed half */

ok('the seed defines exactly the shape helper and the trigger guard',
  JSON.stringify([...seed.matchAll(/create function public\.(\w+)\s*\(/g)].map(m => m[1]).sort())
    === JSON.stringify(['production_native_label_empty_state', 'production_native_label_seed_guard']));
ok('the seeded relation is the empty-but-COMPLETE one, in all three branches',
  (seed.match(/'nodes','\[\]'::jsonb,\s*\n?\s*'pageInfo',jsonb_build_object\('hasNextPage',false,'endCursor',null\)/g) || []).length === 3);
ok('an already-present relation is never overwritten',
  seed.includes("when (p_raw->'issue')->'labels' is null") && seed.includes('else p_raw'));
ok('a non-object linear_raw and a non-object issue are both left alone',
  seed.includes("when jsonb_typeof(p_raw)<>'object' then p_raw")
    && seed.includes("when jsonb_typeof(p_raw->'issue')<>'object' then p_raw"));
ok('only cards WITHOUT a provider issue are seeded',
  seed.includes('if new.linear_issue_uuid is not null then return new; end if;')
    && seed.includes('where d.linear_issue_uuid is null'));
ok('the seed predicate is the workload lane\'s own, reused rather than restated',
  (seed.match(/workload_native_label_state_absent/g) || []).length >= 3);
ok('the backfill suppresses the ledger, so it enqueues no provider debt',
  seed.includes("perform set_config('app.event_written','1',true);"));
ok('the backfill fails closed if any native card still reads as absent afterwards',
  seed.includes("raise exception 'native_label_seed_incomplete'"));
ok('the trigger is before insert or update, for each row, on deliverables',
  /create trigger zzz_native_label_state_seed\s*\n?\s*before insert or update on public\.deliverables\s*\n?\s*for each row/.test(seed));

/* The gateway predicate this seed exists to satisfy, re-read from the source
   so the migration's premise cannot go stale without this failing. */
const gateway = read('supabase/functions/production-write/index.ts');
ok('the gateway still requires a nodes ARRAY and hasNextPage exactly false',
  gateway.includes('const nodes = Array.isArray(connection.nodes) ? connection.nodes : null;')
    && gateway.includes('if (!nodes || pageInfo.hasNextPage !== false) return null;'));

/* ---------------------------------------------------- inventory and pinning */

const preflight = read('scripts/linear-exit-deploy-preflight.js');
for (const [routine, file] of [
  ['production_labels_write(jsonb,jsonb)', PARITY_PATH],
  ['production_native_label_receipt_guard()', PARITY_PATH],
  ['production_native_label_empty_state(jsonb)', SEED_PATH],
  ['production_native_label_seed_guard()', SEED_PATH],
]) ok(`the preflight pins ${routine} to ${path.basename(file)}`,
  preflight.includes(`['${routine}', '${file}'`));
ok('the preflight knows about the new trigger on deliverables',
  preflight.includes("['deliverables.zzz_native_label_state_seed', 'deliverables', 'zzz_native_label_state_seed', 'production_native_label_seed_guard', 23]"));
ok('both new routines are declared private -- nothing holds EXECUTE on either',
  preflight.includes("'production_native_label_empty_state',") && preflight.includes("'production_native_label_seed_guard',"));

const manifest = require('../scripts/linear-exit-install-manifest');
const built = manifest.build();
const order = built.dependency_order;
for (const id of ['2026-09-18-native-label-empty-state-seed.sql', '2026-09-18-native-label-test-client-parity.sql'])
  ok(`${id} is in the install inventory`, built.entries.some(e => e.id === id));
ok('the parity migration installs after the file whose bodies it replaces',
  order.indexOf('2026-09-06-native-label-writes.sql') < order.indexOf('2026-09-18-native-label-test-client-parity.sql'));
ok('the seed installs after the workload predicate it reuses',
  order.indexOf('2026-09-08-workload-native-label-state-shape.sql') < order.indexOf('2026-09-18-native-label-empty-state-seed.sql'));
ok('the seed installs before the parity migration that depends on it being reachable',
  order.indexOf('2026-09-18-native-label-empty-state-seed.sql') < order.indexOf('2026-09-18-native-label-test-client-parity.sql'));

/* Nothing identifying, and no invented UUID literal smuggled into the SQL. */
for (const [label, text] of [['seed', seed], ['parity', parity]])
  ok(`${label}: carries no UUID literal`, !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(text));

console.log(JSON.stringify({
  marker: 'NATIVE_LABEL_SEED_PARITY_CONTRACT_OK',
  checks: passed,
  seed_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, SEED_PATH))).digest('hex'),
  parity_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, PARITY_PATH))).digest('hex'),
}));
