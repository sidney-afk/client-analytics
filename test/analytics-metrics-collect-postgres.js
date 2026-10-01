'use strict';
/*
 * analytics-metrics-collect-postgres.js: migrations/2026-10-01-analytics-metrics-collect-shadow.sql
 * on a disposable PostgreSQL, before anyone applies it live.
 *
 * Measures (not reads): for the three new tables and the six new functions, what
 * each of public, anon, authenticated and service_role can really do; then the
 * queue claim, the all-or-nothing commit and the daily comparison with real rows.
 *
 * Needs a throwaway server: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY
 * with the usual PG* variables (or F63_REQUIRE_POSTGRES=1 in the isolated lane).
 * It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PHASE1 = fs.readFileSync(path.join(ROOT, 'migrations/2026-09-25-sheets-mirror-phase1.sql'), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'migrations/2026-10-01-analytics-metrics-collect-shadow.sql'), 'utf8');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'metrics_collect_' + process.pid;

function psql(database, text, allowFail = false, role = null) {
  const input = (role ? `set role ${role};\n` : '') + text;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = (sql, role) => psql(DB, sql, false, role).out;

const TABLES = ['analytics_metrics_shadow', 'analytics_post_tracking', 'analytics_metrics_collect_queue'];
const FUNCTIONS = [
  'analytics_metrics_collect_claim(date,integer,integer,integer)',
  'analytics_metrics_collect_commit_shadow(date,text,jsonb,jsonb,text)',
  'analytics_metrics_shadow_compare(date)',
  'analytics_num(text)',
  'analytics_close(text,text,numeric,numeric,numeric)',
  'analytics_receipt_states(text)',
];

let failed = false;
try {
  psql('postgres', `drop database if exists ${DB}; create database ${DB};`);
  psql(DB, `
    do $r$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'public_probe') then create role public_probe nologin; end if;
    end $r$;
    grant usage on schema public to anon, authenticated, service_role, public_probe;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.syncview_runtime_flags (key text primary key, value jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(), updated_by text);
  `);
  psql(DB, PHASE1);
  psql(DB, MIGRATION);
  psql(DB, MIGRATION); // idempotent
  assert.equal(q(`select value::text from public.syncview_runtime_flags where key = 'analytics_metrics_collect'`), '{"mode": "off"}', 'default off');

  // ---- the four roles, measured ----
  for (const role of ['public_probe', 'anon', 'authenticated']) {
    for (const t of TABLES) {
      for (const stmt of [`select 1 from public.${t} limit 1`, `delete from public.${t}`, `truncate public.${t}`]) {
        assert(!psql(DB, stmt, true, role).ok, `${role} must not run "${stmt.split(' ').slice(0, 3).join(' ')}" on ${t}`);
      }
    }
    for (const f of FUNCTIONS) assert.equal(q(`select has_function_privilege('${role === 'public_probe' ? 'public_probe' : role}', 'public.${f}', 'EXECUTE')`), 'f', `${role} cannot execute ${f}`);
  }
  for (const t of TABLES) {
    assert(psql(DB, `select 1 from public.${t} limit 1`, true, 'service_role').ok, 'service_role reads ' + t);
    assert(!psql(DB, `delete from public.${t}`, true, 'service_role').ok, 'service_role cannot delete ' + t);
    assert(!psql(DB, `truncate public.${t}`, true, 'service_role').ok, 'service_role cannot truncate ' + t);
    assert.equal(q(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`), 't', t + ' has RLS');
    assert.equal(q(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass`), '0', t + ' has no policy');
  }
  for (const f of FUNCTIONS) assert.equal(q(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE')`), 't', 'service_role executes ' + f);

  // ---- the queue claim ----
  q(`insert into public.analytics_metrics_collect_queue (run_date, client_slug) values
     ('2026-10-02','aa'),('2026-10-02','bb'),('2026-10-02','cc'),('2026-10-01','zz')`);
  const claim = (n = 1) => q(`select string_agg(client_slug || ':' || attempts, ',' order by client_slug) from public.analytics_metrics_collect_claim('2026-10-02', ${n}, 170, 3)`, 'service_role');
  assert.equal(claim(1), 'aa:1', 'first claim takes the first client, one attempt');
  assert.equal(claim(1), 'bb:1', 'a held client is skipped');
  assert.equal(claim(5), 'cc:1', 'only the unheld one is left');
  assert.equal(claim(5), '', 'all three held: nothing to claim');
  q(`update public.analytics_metrics_collect_queue set lease_until = null where client_slug = 'aa' and run_date = '2026-10-02'`);
  assert.equal(claim(1), 'aa:2', 'a released client comes back with its attempts counted');
  q(`update public.analytics_metrics_collect_queue set lease_until = now() - interval '1 second', attempts = 3 where client_slug = 'bb' and run_date = '2026-10-02'`);
  assert.equal(claim(5), '', 'a client out of attempts is not handed out again');
  assert.equal(q(`select count(*) from public.analytics_metrics_collect_claim('2026-10-03', 1, 170, 3)`, 'service_role'), '0', 'another day is empty');

  // ---- the commit: row, posts and done in one call; a retry keeps first_seen_date ----
  const row = { client_name: 'Probe', date: '2026-10-02', ig_followers: '100', ig_avg_views: '10', ig_avg_likes: '2', tiktok_followers: '', tiktok_avg_plays: '',
    yt_subscribers: '', yt_total_views: '', ig_views_gained_today: '40', tiktok_plays_gained_today: '0', ig_views_this_month: '540',
    tiktok_plays_this_month: '0', yt_views_gained_today: '0', yt_shorts_views: '', yt_longs_views: '',
    analytics_receipt: JSON.stringify({ result: 'success', platforms: { instagram: { state: 'success' }, tiktok: { state: 'not_configured' }, youtube: { state: 'not_configured' } } }) };
  const post = (id, today, first) => ({ post_id: id, client_name: 'Probe', platform: 'instagram', first_seen_date: first, views_yesterday: 5, views_today: today, views_gained_today: 1 });
  const commit = (posts) => q(`select public.analytics_metrics_collect_commit_shadow('2026-10-02','aa', $j$${JSON.stringify(row)}$j$::jsonb, $p$${JSON.stringify(posts)}$p$::jsonb, 'r1')`, 'service_role');
  commit([post('igr_1', 50, '2026-10-02'), post('igr_2', 60, '2026-10-02'), post('igr_1', 70, '2026-10-02')]);
  assert.equal(q(`select views_today from public.analytics_post_tracking where post_id = 'igr_1'`), '70', 'a post listed twice: the last one wins');
  assert.equal(q(`select state from public.analytics_metrics_collect_queue where client_slug = 'aa' and run_date = '2026-10-02'`), 'done');
  q(`update public.analytics_post_tracking set first_seen_date = '2026-09-01' where post_id = 'igr_2'`);
  commit([post('igr_2', 90, '2026-10-02')]);
  assert.equal(q(`select first_seen_date || ':' || views_today from public.analytics_post_tracking where post_id = 'igr_2'`), '2026-09-01:90', 'first_seen_date is kept on update');
  assert.equal(q(`select count(*) from public.analytics_metrics_shadow where client_slug = 'aa'`), '1', 'a retry overwrites, never doubles');
  assert(!psql(DB, `select public.analytics_metrics_collect_commit_shadow('2026-10-02','aa','{"client_name":"x","date":"not-a-date"}'::jsonb,'[]'::jsonb,'r')`, true, 'service_role').ok, 'a bad row is refused');
  assert.equal(q(`select count(*) from public.analytics_metrics_shadow`), '1', 'a refused commit leaves nothing behind');

  // ---- the comparison ----
  const n8nRow = (slug, over = {}) => {
    const r = { ...row, ...over };
    q(`insert into public.analytics_metrics (row_hash, row_occurrence, client_slug, client_name, date, ig_followers, ig_avg_views, ig_avg_likes, ig_views_gained_today,
        ig_views_this_month, tiktok_plays_gained_today, tiktok_plays_this_month, yt_views_gained_today, yt_total_views, analytics_receipt, source, run_id)
       values (encode(sha256(convert_to('${slug}${JSON.stringify(over)}', 'UTF8')), 'hex'), 1, '${slug}', 'Probe', '2026-10-02', '${r.ig_followers}', '${r.ig_avg_views}', '${r.ig_avg_likes}',
        '${r.ig_views_gained_today}', '${r.ig_views_this_month}', '0', '0', '0', '', '${r.analytics_receipt}', 'n8n', 'r')`);
  };
  n8nRow('aa'); // identical to the shadow row
  const cmp = () => JSON.parse(q(`select json_object_agg(client_slug, json_build_object('m', matches, 'bad', mismatched)) from public.analytics_metrics_shadow_compare('2026-10-02')`, 'service_role'));
  assert.deepEqual(cmp().aa, { m: true, bad: [] }, 'identical rows match');
  q(`update public.analytics_metrics set ig_followers = '101' where client_slug = 'aa'`);
  assert.equal(cmp().aa.m, true, 'followers within 0.5 percent or 5 match');
  q(`update public.analytics_metrics set ig_followers = '140' where client_slug = 'aa'`);
  assert.deepEqual(cmp().aa, { m: false, bad: ['ig_followers'] }, 'followers far apart are named');
  q(`update public.analytics_metrics set ig_followers = '100', ig_views_gained_today = '1000', ig_views_this_month = '1500' where client_slug = 'aa'`);
  assert.deepEqual(cmp().aa.bad, ['ig_views_gained_today', 'ig_views_this_month'], 'a gain off by more than 10 percent and 500 is named, and the counter it feeds with it');
  q(`update public.analytics_metrics set ig_views_gained_today = '300', ig_views_this_month = '800' where client_slug = 'aa'`);
  assert.equal(cmp().aa.m, true, 'a small gain difference passes, and so does the counter that moved with it');
  q(`update public.analytics_metrics set ig_views_gained_today = '40', ig_views_this_month = '540', analytics_receipt = replace(analytics_receipt, '"success"},"tiktok"', '"provider_failed"},"tiktok"') where client_slug = 'aa'`);
  assert.deepEqual(cmp().aa.bad, ['receipt_states'], 'a different platform state is named');
  n8nRow('onlyn8n');
  assert.deepEqual(cmp()['onlyn8n'], { m: false, bad: ['no_shadow_row'] }, 'a client only n8n has is reported');

  console.log('ANALYTICS_METRICS_COLLECT_POSTGRES_OK: 3 tables and 6 functions measured for 4 roles, claim, commit, comparison');
} catch (e) {
  failed = true;
  console.error(e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
