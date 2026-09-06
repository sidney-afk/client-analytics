'use strict';
// No live URLs accepted. CI's existing disposable PostgreSQL service is required;
// local use explicitly opts in after starting a disposable loopback database.
// Chain: PR1293 manifest -> PR1302 native-only intake -> this reconcile draft,
// plus the exact live column set of both card tables and their event ledgers
// (from the schema baseline) so stage 2 writes the same columns it would live.
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const { bootCluster, connectionEnv } = require('../scripts/native-intake-manifest/harness.js');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.INTAKE_MANIFEST_REQUIRE_POSTGRES !== '1') {
  console.log('SKIP native intake reconcile: disposable PostgreSQL not explicitly required');
  process.exit(0);
}
const host = process.env.F42_REHEARSAL_SOCKET || process.env.F42_REHEARSAL_PGHOST || process.env.PGHOST || '';
if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('reconcile proof requires disposable loopback PostgreSQL');

/* Exact live DDL for one table from the schema baseline, replayed as
   add-column statements so the F42 foundation's id-only stubs gain the columns
   the frozen writers and the reconciler actually address. */
function baselineColumns(baseline, table) {
  const start = baseline.indexOf(`create table if not exists public.${table} (`);
  if (start < 0) throw new Error('baseline seam drift: ' + table);
  const end = baseline.indexOf('\n);', start);
  const body = baseline.slice(baseline.indexOf('(', start) + 1, end);
  return body.split('\n').map(l => l.trim().replace(/,$/, '')).filter(Boolean)
    .map(l => `alter table public.${table} add column if not exists ${l.replace(/ not null$/, '')};`).join('\n');
}
function baselineTable(baseline, table) {
  const start = baseline.indexOf(`create table if not exists public.${table} (`);
  if (start < 0) throw new Error('baseline seam drift: ' + table);
  const end = baseline.indexOf('\n);', start);
  return baseline.slice(start, end + 3);
}

let cluster;
try {
  cluster = bootCluster();
  const filming = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-07-09-filming-plans-source.sql'), 'utf8');
  const seed = filming.indexOf('insert into public.filming_plans');
  if (seed < 0) throw new Error('filming-plan schema seam drift');
  cluster.exec(filming.slice(0, seed));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-intake-root-manifest.sql'));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-only-intake.sql'));
  // Same exact F27 write-fence subset the native-only proof installs.
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
  // Card tables and their event ledgers, exactly as the live baseline names them.
  const baseline = fs.readFileSync(path.resolve(__dirname, '../migrations/live-schema-baseline-2026-07-03.sql'), 'utf8').replace(/\r\n/g, '\n');
  cluster.exec(baselineColumns(baseline, 'calendar_posts'));
  cluster.exec(baselineColumns(baseline, 'sample_reviews'));
  // Live keys both card tables on (client, id); the F42 stub keys them on id
  // alone. The competing-insertion and cross-client scenarios need the live key.
  cluster.exec('alter table public.calendar_posts drop constraint calendar_posts_pkey, add primary key (client, id);');
  cluster.exec('alter table public.sample_reviews drop constraint sample_reviews_pkey, add primary key (client, id);');
  // calendar_post_events postdates the baseline capture; its exact DDL is the
  // A1 calendar-upsert migration's table block (no publication or policy here).
  const a1 = fs.readFileSync(path.resolve(__dirname, '../migrations/2026-07-03-a1-calendar-upsert.sql'), 'utf8').replace(/\r\n/g, '\n');
  cluster.exec(baselineTable(a1, 'calendar_post_events'));
  cluster.exec(baselineTable(baseline, 'sample_review_events'));
  // The calendar writer merges comment cells through this RPC on every existing
  // row; the browser materialization payload names the tweak columns, so the
  // real writer reaches it. Exact repository migration, self-contained.
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-06-18-atomic-comment-merge.sql'));
  cluster.runFile(path.resolve(__dirname, '../migrations/2026-09-05-native-intake-reconcile.sql'));

  const r = spawnSync(process.execPath, ['--experimental-strip-types', path.resolve(__dirname, '../scripts/native-intake-reconcile/lane.mjs')], {
    encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, ...connectionEnv(cluster) }, windowsHide: true,
  });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) throw new Error('native intake reconcile proof failed (no SQL skips allowed)');
} finally {
  if (cluster) cluster.stop();
}
