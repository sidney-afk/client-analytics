'use strict';
// No live URLs accepted. CI's existing disposable PostgreSQL service is required;
// local use explicitly opts in after starting a disposable loopback database.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { bootCluster, connectionEnv } = require('../scripts/native-intake-manifest/harness.js');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native intake manifest: disposable PostgreSQL not explicitly required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('manifest proof requires disposable loopback PostgreSQL');
let cluster;
try {
  cluster = bootCluster();
  // Exact repository DDL only; the historical migration's real-client seed and
  // realtime publication block are excluded. This fixture uses invented plans.
  const filming = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-07-09-filming-plans-source.sql'), 'utf8');
  const seed = filming.indexOf('insert into public.filming_plans');
  if (seed < 0) throw new Error('filming-plan schema seam drift');
  cluster.exec(filming.slice(0, seed));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-intake-root-manifest.sql'));
  for (const negative of ['1', '0']) {
  const r = spawnSync(process.execPath, ['--experimental-strip-types', path.resolve(__dirname, '../scripts/native-intake-manifest/gateway-lane.mjs')], {
    encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ...connectionEnv(cluster), INTAKE_MANIFEST_NEGATIVE_CONTROL: negative }, windowsHide: true,
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) throw new Error('manifest gateway proof failed (no SQL skips allowed)');
  }
} finally {
  if (cluster) cluster.stop();
}
