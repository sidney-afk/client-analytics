'use strict';
/* Disposable PostgreSQL proof.  It is opt-in because the repository's local
 * sandbox may deny socket creation.  The test never contacts a hosted backend. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { bootCluster } = require('../scripts/native-intake-manifest/harness.js');
const { fromRepository } = require('../scripts/native-intake-named-append-compose.js');

if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native client provisioning: disposable PostgreSQL not explicitly required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('native client provisioning proof requires disposable loopback PostgreSQL');

let cluster;
try {
  cluster = bootCluster();
  const root = path.resolve(__dirname, '..');
  cluster.runFile(path.join(root, 'migrations', '2026-07-05-b0-linear-auth-scaffold.sql'));
  cluster.runFile(path.join(root, 'migrations', '2026-08-04-client-access-auto-provision.sql'));
  cluster.runFile(path.join(root, 'migrations', '2026-09-05-native-intake-root-manifest.sql'));
  const artifact = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'native-client-provisioning-')), 'composed.sql');
  fs.writeFileSync(artifact, fromRepository().sql);
  cluster.runFile(artifact);
  cluster.runFile(path.join(root, 'migrations', '2026-09-08-native-intake-receipt-retention.sql'));
  cluster.exec(`
    insert into public.syncview_runtime_flags(key, value) values
      ('calendar_upsert_ef_clients', '{"clients":[]}'::jsonb),
      ('sample_review_ef_clients', '{"clients":[]}'::jsonb),
      ('settings_ef_clients', '{"clients":[]}'::jsonb),
      ('write_ui_reroute_clients', '{"clients":[]}'::jsonb)
    on conflict (key) do update set value = excluded.value;
    update public.syncview_runtime_flags
    set value = '{"video":{"enabled":true,"epoch":"fixture-v1"},"graphics":{"enabled":true,"epoch":"fixture-g1"}}'::jsonb
    where key = 'native_intake_epochs';
    update public.syncview_runtime_flags
    set value = '{"video":"syncview","graphics":"syncview"}'::jsonb
    where key = 'prod_authority';
  `);
  cluster.runFile(path.join(root, 'migrations', '2026-09-09-native-client-provisioning.sql'));
  const call = `select public.production_native_client_provision('fixture-native-provision-1', 'fixture-native-client', 'Fixture Native Client');`;
  const first = JSON.parse(cluster.run('', null, { sql: call, tuplesOnly: true }).trim());
  assert.equal(first.ok, true); assert.equal(first.outcome, 'created');
  assert.match(first.native_project_ids.video, /^svproj_video_[0-9a-f]{32}$/);
  assert.match(first.native_project_ids.graphics, /^svproj_graphics_[0-9a-f]{32}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'display_name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'review_token'), false);
  const tokenHash = cluster.run('', null, { sql: "select encode(extensions.digest(review_token, 'sha256'), 'hex') from public.client_access where slug = 'fixture-native-client'", tuplesOnly: true }).trim();
  const replay = JSON.parse(cluster.run('', null, { sql: call, tuplesOnly: true }).trim());
  assert.equal(replay.outcome, 'replayed');
  assert.equal(cluster.run('', null, { sql: "select encode(extensions.digest(review_token, 'sha256'), 'hex') from public.client_access where slug = 'fixture-native-client'", tuplesOnly: true }).trim(), tokenHash, 'replay does not rotate a token');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.production_native_client_provisions", tuplesOnly: true }).trim(), '1');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.client_access where slug = 'fixture-native-client' and review_token <> ''", tuplesOnly: true }).trim(), '1');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.syncview_runtime_flags where key in ('calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients') and value->'clients' @> '[\"fixture-native-client\"]'::jsonb", tuplesOnly: true }).trim(), '4');
  assert.throws(() => cluster.run('', null, { sql: "select public.production_native_client_provision('fixture-native-provision-1', 'fixture-native-client', 'Changed Fixture Name')" }), /idempotency_conflict/);
  cluster.exec("update public.syncview_runtime_flags set value = '{\"video\":\"linear\",\"graphics\":\"syncview\"}'::jsonb where key = 'prod_authority';");
  assert.throws(() => cluster.run('', null, { sql: "select public.production_native_client_provision('fixture-native-authority', 'fixture-native-authority', 'Fixture Native Authority')" }), /authority_unavailable/);
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.clients where slug = 'fixture-native-authority'", tuplesOnly: true }).trim(), '0');
  cluster.exec("update public.syncview_runtime_flags set value = '{\"video\":\"syncview\",\"graphics\":\"syncview\"}'::jsonb where key = 'prod_authority';");
  cluster.exec("update public.syncview_runtime_flags set value = '{\"clients\":\"malformed\"}'::jsonb where key = 'settings_ef_clients';");
  assert.throws(() => cluster.run('', null, { sql: "select public.production_native_client_provision('fixture-native-malformed', 'fixture-native-malformed', 'Fixture Native Malformed')" }), /routing_flag_invalid/);
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.clients where slug = 'fixture-native-malformed'", tuplesOnly: true }).trim(), '0', 'malformed fourth route rolls back the client insert');
  cluster.exec("update public.syncview_runtime_flags set value = '{\"clients\":[\"fixture-native-client\"]}'::jsonb where key = 'settings_ef_clients';");
  cluster.exec("update public.syncview_runtime_flags set value = '{\"clients\":[]}'::jsonb where key = 'settings_ef_clients';");
  assert.throws(() => cluster.run('', null, { sql: call }), /routing_drift/);
  assert.throws(() => cluster.run('', null, { sql: "update public.production_native_client_provisions set intent_sha256 = intent_sha256 where request_id = 'fixture-native-provision-1'" }), /immutable/);
  assert.throws(() => cluster.run('', null, { sql: "delete from public.production_native_client_provisions where request_id = 'fixture-native-provision-1'" }), /immutable/);
  assert.throws(() => cluster.run('', null, { sql: 'truncate public.production_native_client_provisions' }), /immutable/);
  assert.throws(() => cluster.run('', null, { sql: "begin; set local role anon; select public.production_native_client_provision('fixture-anon', 'fixture-anon', 'Fixture Anon'); rollback;" }), /permission denied/);
  console.log('ok native client provisioning PostgreSQL proof');
} finally {
  if (cluster) cluster.stop();
}
