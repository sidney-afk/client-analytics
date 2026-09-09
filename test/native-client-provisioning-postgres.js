'use strict';
/* Disposable PostgreSQL proof.  It is opt-in because the repository's local
 * sandbox may deny socket creation.  The test never contacts a hosted backend. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { bootCluster, connectionEnv } = require('../scripts/native-intake-manifest/harness.js');

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
  cluster.runFile(path.join(root, 'migrations', '2026-09-05-native-only-intake.sql'));
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
  `);
  cluster.runFile(path.join(root, 'migrations', '2026-09-09-native-client-provisioning.sql'));
  const call = `select public.production_native_client_provision('fixture-native-provision-1', 'fixture-native-client', 'Fixture Native Client');`;
  const first = JSON.parse(cluster.run('', null, { sql: call, tuplesOnly: true }).trim());
  assert.equal(first.ok, true); assert.equal(first.outcome, 'created');
  assert.match(first.native_project_ids.video, /^svproj_video_[0-9a-f]{32}$/);
  assert.match(first.native_project_ids.graphics, /^svproj_graphics_[0-9a-f]{32}$/);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'display_name'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(first, 'review_token'), false);
  const replay = JSON.parse(cluster.run('', null, { sql: call, tuplesOnly: true }).trim());
  assert.equal(replay.outcome, 'replayed');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.production_native_client_provisions", tuplesOnly: true }).trim(), '1');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.client_access where slug = 'fixture-native-client' and review_token <> ''", tuplesOnly: true }).trim(), '1');
  assert.equal(cluster.run('', null, { sql: "select count(*) from public.syncview_runtime_flags where key in ('calendar_upsert_ef_clients','sample_review_ef_clients','settings_ef_clients','write_ui_reroute_clients') and value->'clients' @> '[\"fixture-native-client\"]'::jsonb", tuplesOnly: true }).trim(), '4');
  assert.throws(() => cluster.run('', null, { sql: "select public.production_native_client_provision('fixture-native-provision-1', 'fixture-native-client', 'Changed Fixture Name')" }), /idempotency_conflict/);
  cluster.exec("update public.syncview_runtime_flags set value = '{\"clients\":[]}'::jsonb where key = 'settings_ef_clients';");
  assert.throws(() => cluster.run('', null, { sql: call }), /routing_drift/);
  console.log('ok native client provisioning PostgreSQL proof');
} finally {
  if (cluster) cluster.stop();
}
