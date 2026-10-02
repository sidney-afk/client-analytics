'use strict';
/*
 * analytics-top-videos-collect-postgres.js: migrations/2026-10-02-analytics-top-videos-collect-shadow.sql
 * on a disposable PostgreSQL, before anyone applies it live.
 *
 * Measures (not reads): for the two new tables and the three new functions, what each of
 * public, anon, authenticated and service_role can really do; then the queue claim, the
 * replace-on-retry commit, the refusal of a dependency-less apply and the daily comparison
 * with real rows. Also checks the schedule migration's text (it needs pg_cron, which a
 * disposable server does not have).
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
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PHASE1 = read('migrations/2026-09-25-sheets-mirror-phase1.sql');
const METRICS = read('migrations/2026-10-01-analytics-metrics-collect-shadow.sql');
const MIGRATION = read('migrations/2026-10-02-analytics-top-videos-collect-shadow.sql');
const SCHEDULE = read('migrations/2026-10-02-analytics-top-videos-collect-schedule.sql');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'top_videos_collect_' + process.pid;

function psql(database, text, allowFail = false, role = null) {
  const input = (role ? `set role ${role};\n` : '') + text;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = (sql, role) => psql(DB, sql, false, role).out;

const TABLES = ['analytics_top_videos_shadow', 'analytics_top_videos_collect_queue'];
const FUNCTIONS = [
  'analytics_top_videos_collect_claim(date,integer,integer,integer)',
  'analytics_top_videos_collect_commit_shadow(date,text,jsonb,jsonb,text)',
  'analytics_top_videos_shadow_compare(date)',
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
  assert(!psql(DB, MIGRATION, true).ok, 'refuses to apply before the metrics migration (analytics_close missing)');
  psql(DB, METRICS);
  psql(DB, MIGRATION);
  psql(DB, MIGRATION); // idempotent
  assert.equal(q(`select value::text from public.syncview_runtime_flags where key = 'analytics_top_videos_collect'`), '{"mode": "off"}', 'default off');

  // ---- the four roles, measured ----
  for (const role of ['public_probe', 'anon', 'authenticated']) {
    for (const t of TABLES) {
      for (const stmt of [`select 1 from public.${t} limit 1`, `delete from public.${t}`, `truncate public.${t}`]) {
        assert(!psql(DB, stmt, true, role).ok, `${role} must not run "${stmt.split(' ').slice(0, 3).join(' ')}" on ${t}`);
      }
    }
    for (const f of FUNCTIONS) assert.equal(q(`select has_function_privilege('${role}', 'public.${f}', 'EXECUTE')`), 'f', `${role} cannot execute ${f}`);
  }
  for (const t of TABLES) {
    assert(psql(DB, `select 1 from public.${t} limit 1`, true, 'service_role').ok, 'service_role reads ' + t);
    assert(!psql(DB, `delete from public.${t}`, true, 'service_role').ok, 'service_role cannot delete ' + t);
    assert(!psql(DB, `truncate public.${t}`, true, 'service_role').ok, 'service_role cannot truncate ' + t);
    assert.equal(q(`select relrowsecurity from pg_class where oid = 'public.${t}'::regclass`), 't', t + ' has RLS');
    assert.equal(q(`select count(*) from pg_policy where polrelid = 'public.${t}'::regclass`), '0', t + ' has no policy');
  }
  for (const f of FUNCTIONS) assert.equal(q(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE')`), 't', 'service_role executes ' + f);
  // the real table is not granted anything new by this migration
  assert(!psql(DB, `insert into public.analytics_top_videos (row_hash, row_occurrence, client_slug, client_name, scraped_date, source, run_id) values (repeat('a',64),1,'x','x','2026-10-02','n8n','r')`, true, 'anon').ok, 'anon still cannot write the real table');

  // ---- the queue claim ----
  q(`insert into public.analytics_top_videos_collect_queue (run_date, client_slug) values
     ('2026-10-02','aa'),('2026-10-02','bb'),('2026-10-02','cc'),('2026-10-01','zz')`);
  const claim = (n = 1) => q(`select string_agg(client_slug || ':' || attempts, ',' order by client_slug) from public.analytics_top_videos_collect_claim('2026-10-02', ${n}, 170, 3)`, 'service_role');
  assert.equal(claim(1), 'aa:1', 'first claim takes the first client, one attempt');
  assert.equal(claim(1), 'bb:1', 'a held client is skipped');
  assert.equal(claim(5), 'cc:1', 'only the unheld one is left');
  assert.equal(claim(5), '', 'all three held: nothing to claim');
  q(`update public.analytics_top_videos_collect_queue set lease_until = null where client_slug = 'aa' and run_date = '2026-10-02'`);
  assert.equal(claim(1), 'aa:2', 'a released client comes back with its attempts counted');
  q(`update public.analytics_top_videos_collect_queue set lease_until = now() - interval '1 second', attempts = 3 where client_slug = 'bb' and run_date = '2026-10-02'`);
  assert.equal(claim(5), '', 'a client out of attempts is not handed out again');
  assert.equal(q(`select count(*) from public.analytics_top_videos_collect_claim('2026-10-03', 1, 170, 3)`, 'service_role'), '0', 'another day is empty');

  // ---- the commit: rows + done in one call; a retry replaces, never doubles ----
  const mk = (platform, period, rank, url, views, extra = {}) => ({ scraped_date: '2026-10-02', client_name: 'Probe', platform, period, rank: String(rank),
    caption: 'cap ' + url, video_url: url || null, views: String(views), likes: '10', comments: '2', shares: '1', ...extra });
  const R = [mk('instagram', 'week', 1, 'https://i/1', 1000), mk('instagram', 'month', 1, 'https://i/1', 1000), mk('instagram', 'month', 2, 'https://i/2', 500),
    mk('youtube', 'week', 0, '', 0, { caption: 'No new posts in the last 7 days', likes: '0', comments: '0', shares: '0' })];
  const states = { instagram: 'success', tiktok: 'not_configured', youtube: 'success' };
  const commit = (rows, slug = 'aa') => q(`select public.analytics_top_videos_collect_commit_shadow('2026-10-02','${slug}', $j$${JSON.stringify(rows)}$j$::jsonb, $s$${JSON.stringify(states)}$s$::jsonb, 'r1')`, 'service_role');
  commit(R);
  assert.equal(q(`select count(*) from public.analytics_top_videos_shadow where client_slug = 'aa'`), '4');
  assert.equal(q(`select state || ':' || (outcome->>'instagram') from public.analytics_top_videos_collect_queue where client_slug = 'aa' and run_date = '2026-10-02'`), 'done:success');
  assert.equal(q(`select video_url is null from public.analytics_top_videos_shadow where client_slug = 'aa' and platform = 'youtube'`), 't', 'an empty link is null, as the mirror stores it');
  commit(R.slice(0, 2));
  assert.equal(q(`select count(*) from public.analytics_top_videos_shadow where client_slug = 'aa'`), '2', 'a retry replaces the client\'s rows of the day');
  commit(R);
  commit([], 'cc');
  assert.equal(q(`select count(*) from public.analytics_top_videos_shadow where client_slug = 'cc'`), '0', 'a client with no rows commits an empty list');
  assert.equal(q(`select state from public.analytics_top_videos_collect_queue where client_slug = 'cc' and run_date = '2026-10-02'`), 'done');
  assert(!psql(DB, `select public.analytics_top_videos_collect_commit_shadow('2026-10-02','aa','[{"client_name":"x","scraped_date":"not-a-date"}]'::jsonb,'{}'::jsonb,'r')`, true, 'service_role').ok, 'a bad row is refused');
  assert.equal(q(`select count(*) from public.analytics_top_videos_shadow where client_slug = 'aa'`), '4', 'a refused commit leaves the earlier rows (all or nothing)');

  // ---- the comparison ----
  let seq = 0;
  const n8nRow = (slug, r, run = 'n8n-topvideos-1') => q(`insert into public.analytics_top_videos (row_hash, row_occurrence, client_slug, client_name, scraped_date, platform, period, rank, caption, video_url, views, likes, comments, shares, source, run_id)
     values (encode(sha256(convert_to('${slug}${++seq}', 'UTF8')), 'hex'), 1, '${slug}', 'Probe', '2026-10-02', '${r.platform}', '${r.period}', '${r.rank}', '${r.caption}', ${r.video_url ? `'${r.video_url}'` : 'null'}, '${r.views}', '${r.likes}', '${r.comments}', '${r.shares}', 'n8n', '${run}')`);
  R.forEach(r => n8nRow('aa', r));
  const cmp = () => JSON.parse(q(`select json_object_agg(client_slug, json_build_object('m', matches, 'bad', mismatched, 'n', n8n_rows, 's', shadow_rows)) from public.analytics_top_videos_shadow_compare('2026-10-02')`, 'service_role'));
  assert.deepEqual(cmp().aa, { m: true, bad: [], n: 4, s: 4 }, 'identical rows match');
  q(`update public.analytics_top_videos set views = '1040' where client_slug = 'aa' and video_url = 'https://i/1' and period = 'week'`);
  assert.equal(cmp().aa.m, true, 'views within 10 percent (minimum 50) match');
  q(`update public.analytics_top_videos set views = '1500' where client_slug = 'aa' and video_url = 'https://i/1' and period = 'week'`);
  assert.deepEqual(cmp().aa.bad, ['instagram:week:views'], 'views far apart are named, with platform and period');
  q(`update public.analytics_top_videos set rank = '3', caption = 'changed' where client_slug = 'aa' and video_url = 'https://i/2'`);
  q(`update public.analytics_top_videos set views = '1000' where client_slug = 'aa' and video_url = 'https://i/1'`);
  assert.deepEqual(cmp().aa.bad, ['instagram:month:caption', 'instagram:month:rank'], 'a different rank and caption are named');
  q(`update public.analytics_top_videos set rank = '2', caption = 'cap https://i/2' where client_slug = 'aa' and video_url = 'https://i/2'`);
  q(`delete from public.analytics_top_videos where client_slug = 'aa' and video_url = 'https://i/2'`);
  assert.deepEqual(cmp().aa.bad, ['instagram:month:only_shadow'], 'a row only the shadow has is named');
  n8nRow('aa', mk('tiktok', 'week', 1, 'https://t/1', 5));
  assert.deepEqual(cmp().aa.bad, ['instagram:month:only_shadow', 'tiktok:week:only_n8n'], 'a row only n8n has is named');
  // n8n's newest run of the day is the one compared (an earlier run of the same day is ignored)
  q(`delete from public.analytics_top_videos where client_slug = 'aa'`);
  R.forEach(r => n8nRow('aa', { ...r, views: '99999' }, 'n8n-topvideos-1'));
  R.forEach(r => n8nRow('aa', r, 'n8n-topvideos-2'));
  assert.deepEqual(cmp().aa, { m: true, bad: [], n: 4, s: 4 }, 'only the newest n8n run of the day counts');
  n8nRow('onlyn8n', mk('instagram', 'week', 1, 'https://i/9', 5));
  assert.deepEqual(cmp()['onlyn8n'], { m: false, bad: ['no_shadow_rows'], n: 1, s: 0 }, 'a client only n8n has is reported');
  assert.equal(cmp().cc, undefined, 'a client neither side wrote rows for agrees and is not listed');
  q(`insert into public.analytics_top_videos_collect_queue (run_date, client_slug) values ('2026-10-02','dd')`);
  commit(R.slice(0, 1), 'dd');
  assert.deepEqual(cmp().dd, { m: false, bad: ['no_n8n_rows'], n: 0, s: 1 }, 'a client only the shadow wrote rows for is reported');
  assert.equal(q(`select shadow_states->>'tiktok' from public.analytics_top_videos_shadow_compare('2026-10-02') where client_slug = 'aa'`, 'service_role'), 'not_configured', 'the comparison carries the per-platform outcome');

  // ---- the schedule migration (text only: a disposable server has no pg_cron) ----
  assert(SCHEDULE.includes("'* 8-12 * * *'") && SCHEDULE.includes('analytics_collect_key') && SCHEDULE.includes('/functions/v1/analytics-top-videos-collect'), 'timer 08:00 to 12:59 UTC, the shared Vault key, the new function');
  assert(!/analytics-metrics-collect-(tick|prune)/.test(SCHEDULE.replace(/^--.*$/gm, '')), 'the timer does not touch the metrics jobs');

  console.log('ANALYTICS_TOP_VIDEOS_COLLECT_POSTGRES_OK: 2 tables and 3 functions measured for 4 roles, dependency refusal, claim, replace-on-retry commit, comparison');
} catch (e) {
  failed = true;
  console.error(e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
