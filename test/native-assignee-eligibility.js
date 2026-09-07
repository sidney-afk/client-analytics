'use strict';
// No live URLs accepted. CI's existing disposable PostgreSQL service is required;
// local use explicitly opts in after starting a disposable loopback database.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { bootCluster, connectionEnv } = require('../scripts/native-intake-manifest/harness.js');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native assignee lane: disposable PostgreSQL not explicitly required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('manifest proof requires disposable loopback PostgreSQL');
function applyChain(cluster) {
  // Exact repository DDL only; the historical migration's real-client seed and
  // realtime publication block are excluded. This fixture uses invented plans.
  const filming = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-07-09-filming-plans-source.sql'), 'utf8');
  const seed = filming.indexOf('insert into public.filming_plans');
  if (seed < 0) throw new Error('filming-plan schema seam drift');
  cluster.exec(filming.slice(0, seed));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-intake-root-manifest.sql'));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-only-intake.sql'));
  // Exercise the exact repository F27 enqueue and hold-trigger closure too.
  // This is not the full F27 installer/recovery proof. Extract rather than
  // model its business rules; the known section boundaries fail on drift.
  const f27 = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-07-20-f27-team-rollback.sql'), 'utf8').replace(/\r\n/g, '\n');
  const tableStart = f27.indexOf('create table if not exists public.track_b_team_rollbacks (');
  const tableEnd = f27.indexOf('create table if not exists public.track_b_team_rollback_intents (', tableStart);
  if (tableStart < 0 || tableEnd < tableStart) throw new Error('F27 table seam drift');
  cluster.exec(f27.slice(tableStart, tableEnd));
  cluster.exec('alter table public.mirror_outbox add column authority_generation bigint not null default 0, add column f27_drill_rollback_id uuid references public.track_b_team_rollbacks(id);');
  for (const name of ['mirror_outbox_enqueue', 'track_b_f27_hold_guard']) {
    const start = f27.indexOf('create or replace function public.' + name + '(');
    const end = f27.indexOf('$fn$;', start);
    if (start < 0 || end < start) throw new Error('F27 function seam drift: ' + name);
    cluster.exec(f27.slice(start, end + 5));
  }
  const triggerStart = f27.indexOf('create trigger track_b_f27_hold_guard\n');
  const triggerEnd = f27.indexOf('for each row execute function public.track_b_f27_hold_guard();', triggerStart);
  if (triggerStart < 0 || triggerEnd < triggerStart) throw new Error('F27 trigger seam drift');
  cluster.exec(f27.slice(triggerStart, triggerEnd + 'for each row execute function public.track_b_f27_hold_guard();'.length));
}
let cluster;
try {
  cluster = bootCluster();
  applyChain(cluster);
  /* The positive lane runs against the current checkout. The negative control
     re-runs the SAME journeys against the exact PR1302 head handler, which must
     FAIL its native chosen-editor journeys: that is what proves the lane is
     observing the handler and not the fixture. Each run gets a fresh database
     so the two cannot see each other's rows. */
  for (const negative of ['0', '1']) {
    if (negative === '1') { cluster.stop(); cluster = bootCluster(); applyChain(cluster); }
    const r = spawnSync(process.execPath, ['--experimental-strip-types', path.resolve(__dirname, '../scripts/native-intake-manifest/assignee-lane.mjs')], {
      encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, ...connectionEnv(cluster), ASSIGNEE_LANE_NEGATIVE_CONTROL: negative }, windowsHide: true,
    });
    process.stdout.write(r.stdout || '');
    process.stderr.write(r.stderr || '');
    const report = /\{"suite":"native-assignee-eligibility"[^\n]*\}/.exec(r.stdout || '');
    const readiness = report ? JSON.parse(report[0]).readiness : null;
    if (negative === '0') {
      if (r.status !== 0) throw new Error('native assignee lane failed (no SQL skips allowed)');
      if (!readiness || readiness.chosen_editor_provider_independence !== 'PASS') throw new Error('chosen-editor readiness did not pass');
    } else {
      if (r.status === 0 || !readiness || readiness.chosen_editor_provider_independence !== 'FAIL') {
        throw new Error('negative control: the PR1302 head handler must fail the native chosen-editor journeys');
      }
      console.log('ok   negative control: exact PR1302 head still refuses native chosen-editor assignment through the provider');
    }
  }
} finally {
  if (cluster) cluster.stop();
}
