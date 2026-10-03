'use strict';
/*
 * analytics-market-research-collect-postgres.js: migrations/2026-10-02-analytics-market-research-collect-shadow.sql
 * on a disposable PostgreSQL, before anyone applies it live.
 *
 * Measures (not reads): for the two new tables and the five new functions, what each of public, anon,
 * authenticated and service_role can really do; then the queue claim (one at a time, the daily cap, a started
 * request always continued, attempts exhausted), the all-or-nothing commit and the comparison with real briefs.
 * Also checks the schedule migration's text (it needs pg_cron, which a disposable server does not have).
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
const MIGRATION = read('migrations/2026-10-02-analytics-market-research-collect-shadow.sql');
const SCHEDULE = read('migrations/2026-10-02-analytics-market-research-collect-schedule.sql');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'mr_collect_' + process.pid;

function psql(database, text, allowFail = false, role = null) {
  const input = (role ? `set role ${role};\n` : '') + text;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = (sql, role) => psql(DB, sql, false, role).out;

const TABLES = ['analytics_market_research_collect_queue', 'analytics_market_research_shadow'];
const FUNCTIONS = [
  'analytics_market_research_collect_claim(integer,integer,integer)',
  'analytics_market_research_collect_commit_shadow(uuid,jsonb,jsonb,text)',
  'analytics_market_research_shadow_compare(date)',
  'analytics_mr_brief_stats(text)',
  'analytics_try_jsonb(text)',
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
  assert.equal(q(`select value::text from public.syncview_runtime_flags where key = 'analytics_market_research_collect'`), '{"mode": "off"}', 'default off');

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
  assert(!psql(DB, `insert into public.analytics_market_research_briefs (id, client_slug, client_name, row_hash, source, run_id) values ('x','x','x',repeat('a',64),'n8n','r')`, true, 'anon').ok, 'anon still cannot write the real table');

  // ---- requests are checked on the way in ----
  const ins = (slug, kw, extra = '') => psql(DB, `insert into public.analytics_market_research_collect_queue (client_slug, keywords${extra ? ', ' + extra.split('=')[0] : ''}) values ('${slug}', '${JSON.stringify(kw)}'::jsonb${extra ? ', ' + extra.split('=')[1] : ''})`, true);
  assert(!ins('Bad Slug', ['a']).ok, 'a slug must be a slug');
  assert(!ins('aa', []).ok, 'at least one keyword');
  assert(!ins('aa', Array.from({ length: 11 }, (_, i) => 'k' + i)).ok, 'at most ten keywords');
  assert(!psql(DB, `insert into public.analytics_market_research_collect_queue (client_slug, keywords) values ('aa', '{"a":1}'::jsonb)`, true).ok, 'keywords must be a list');

  // ---- the queue claim ----
  q(`insert into public.analytics_market_research_collect_queue (id, client_slug, keywords, created_at) values
     ('00000000-0000-0000-0000-000000000001','aa','["k"]', now() - interval '3 minutes'),
     ('00000000-0000-0000-0000-000000000002','bb','["k"]', now() - interval '2 minutes'),
     ('00000000-0000-0000-0000-000000000003','cc','["k"]', now() - interval '1 minute')`);
  const claim = (cap = 5, maxAttempts = 5) => q(`select string_agg(client_slug || ':' || attempts, ',') from public.analytics_market_research_collect_claim(170, ${maxAttempts}, ${cap})`, 'service_role');
  assert.equal(claim(2), 'aa:1', 'the oldest request first, one at a time, one attempt');
  assert.equal(claim(2), 'bb:1', 'a held request is skipped');
  assert.equal(claim(2), '', 'two have started today: the third waits (the daily cap)');
  q(`update public.analytics_market_research_collect_queue set lease_until = null where client_slug = 'aa'`);
  assert.equal(claim(2), 'aa:2', 'a request that has started is continued even at the cap');
  q(`update public.analytics_market_research_collect_queue set lease_until = null`);
  assert.equal(claim(3), 'aa:3', 'started requests come before new ones');
  q(`update public.analytics_market_research_collect_queue set lease_until = null, started_at = null where client_slug = 'aa'`);
  q(`update public.analytics_market_research_collect_queue set lease_until = null where client_slug <> 'aa'`);
  q(`update public.analytics_market_research_collect_queue set state = 'done' where client_slug = 'aa'`);
  assert.equal(claim(3), 'bb:2', 'a done request is not handed out');
  q(`update public.analytics_market_research_collect_queue set lease_until = null, attempts = 5 where client_slug = 'bb'`);
  assert.equal(claim(9, 5), 'cc:1', 'a request out of attempts is not handed out again');
  assert.equal(q(`select state || ':' || last_error from public.analytics_market_research_collect_queue where client_slug = 'bb'`), 'failed:attempts_exhausted', 'and is marked failed');

  // ---- the commit: brief + done in one call; a retry replaces, never doubles ----
  const ID = '00000000-0000-0000-0000-000000000003';
  const row = { id: '2026-10-02T09:30:00.000Z', client_name: 'Probe', date: '2026-10-02', raw_json: '{"a":1', raw_json_2: '}', raw_json_3: '' };
  const commit = (r = row, id = ID) => q(`select public.analytics_market_research_collect_commit_shadow('${id}', $j$${JSON.stringify(r)}$j$::jsonb, '{"model":"m","transcribed":2}'::jsonb, 'r1')`, 'service_role');
  commit();
  commit({ ...row, raw_json_3: 'z' });
  assert.equal(q(`select count(*) || ':' || max(raw_json_3) || ':' || max(model) from public.analytics_market_research_shadow`), '1:z:m', 'a retry replaces the brief');
  assert.equal(q(`select state || ':' || (outcome->>'transcribed') from public.analytics_market_research_collect_queue where id = '${ID}'`), 'done:2');
  assert(!psql(DB, `select public.analytics_market_research_collect_commit_shadow('00000000-0000-0000-0000-0000000000ff', '{}'::jsonb, '{}'::jsonb, 'r')`, true, 'service_role').ok, 'a brief for an unknown request is refused');

  // ---- the comparison ----
  q(`delete from public.analytics_market_research_shadow`);
  const brief = (o = {}) => JSON.stringify({ clientName: 'Probe', date: '2026-10-02', keywords: ['k1', 'k2'], totalReels: 100, transcribedCount: 40,
    landscapeAnalysis: Array(8).fill({}), topicClusters: Array(5).fill({}), hookAnalysis: Array(20).fill({}), filmingAngles: Array(20).fill({}), theGap: Array(5).fill({}),
    sources: Array.from({ length: 10 }, (_, i) => ({ url: 'https://s/' + i })), ...o });
  const shadow = (slug, json, id) => {
    q(`insert into public.analytics_market_research_collect_queue (id, client_slug, keywords, state, outcome) values ('${id}', '${slug}', '["k1","k2"]', 'done', '{"model":"m"}')`);
    q(`insert into public.analytics_market_research_shadow (queue_id, run_date, client_slug, id, raw_json, raw_json_2, run_id) values ('${id}', (now() at time zone 'utc')::date, '${slug}', 'i', $a$${json.slice(0, 50)}$a$, $b$${json.slice(50)}$b$, 'r')`);
  };
  let nid = 0;
  const n8n = (slug, json, date = new Date().toISOString().slice(0, 10)) => q(`insert into public.analytics_market_research_briefs (id, client_slug, client_name, date, raw_json, raw_json_2, row_hash, source, run_id)
    values ('n8n-${++nid}', '${slug}', 'Probe', '${date}', $a$${json.slice(0, 70)}$a$, $b$${json.slice(70)}$b$, repeat('a', 64), 'n8n', 'r')`);
  const cmp = () => JSON.parse(q(`select json_object_agg(client_slug, json_build_object('m', matches, 'bad', mismatched, 'np', n8n_present)) from public.analytics_market_research_shadow_compare()`, 'service_role'));
  shadow('aa', brief(), '10000000-0000-0000-0000-000000000001');
  assert.deepEqual(cmp().aa, { m: false, bad: ['no_n8n_brief'], np: false }, 'no n8n brief for the client: expected, reported');
  n8n('aa', brief());
  assert.deepEqual(cmp().aa, { m: true, bad: [], np: true }, 'identical briefs match (stored in two pieces on both sides)');
  n8n('aa', brief({ totalReels: 110, transcribedCount: 45, hookAnalysis: Array(12).fill({}), sources: Array.from({ length: 10 }, (_, i) => ({ url: 'https://s/' + (i + 3) })) }), new Date().toISOString().slice(0, 10));
  assert.deepEqual(cmp().aa, { m: true, bad: [], np: true }, 'the newest n8n brief counts; small differences in reels, hooks and sources pass (10 percent, 12 vs 20 hooks, 7 of 10 sources shared)');
  n8n('aa', brief({ keywords: ['other'], totalReels: 300, transcribedCount: 5, landscapeAnalysis: Array(6).fill({}), topicClusters: [], filmingAngles: Array(18).fill({}), theGap: Array(4).fill({}), hookAnalysis: [], sources: Array.from({ length: 10 }, (_, i) => ({ url: 'https://other/' + i })) }));
  assert.deepEqual(cmp().aa.bad, ['keywords', 'totalReels', 'transcribedCount', 'landscape_count', 'topic_cluster_count', 'filming_angle_count', 'gap_count', 'hook_count', 'sources_overlap'], 'every difference is named');
  n8n('aa', '{"clientName":"Probe","broken":');
  assert.deepEqual(cmp().aa.bad, ['n8n_json_invalid'], 'a brief that is not valid JSON is named (n8n stores it as it is)');
  q(`delete from public.analytics_market_research_briefs`);
  n8n('aa', brief(), new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10));
  assert.deepEqual(cmp().aa.bad, ['no_n8n_brief'], 'an n8n brief from three days ago is not the same brief');
  q(`delete from public.analytics_market_research_briefs`);
  n8n('aa', brief(), new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  assert.equal(cmp().aa.m, true, 'a brief dated the day after still matches (the model writes its own date)');
  n8n('bb', brief());
  assert.equal(cmp().bb, undefined, 'an n8n brief with no shadow brief is not reported');
  assert.equal(q(`select analytics_try_jsonb('{broken') is null and analytics_try_jsonb('') is null and analytics_try_jsonb(null) is null`), 't');
  assert.equal(q(`select analytics_mr_brief_stats('[1]')`), '{"valid": false}', 'not an object is not a brief');

  // ---- the schedule migration (text only: a disposable server has no pg_cron) ----
  assert(SCHEDULE.includes("'* * * * *'") && SCHEDULE.includes('analytics_collect_key') && SCHEDULE.includes('/functions/v1/analytics-market-research-collect'), 'timer every minute, the shared Vault key, the new function');
  assert(/where exists \(select 1 from public\.analytics_market_research_collect_queue where state in \('pending', 'running'\)\)/.test(SCHEDULE), 'it calls the function only while a request is open');
  assert(!/analytics-(metrics|top-videos)-collect-(tick|prune)/.test(SCHEDULE.replace(/^--.*$/gm, '')), 'the timer does not touch the other jobs');

  console.log('ANALYTICS_MARKET_RESEARCH_COLLECT_POSTGRES_OK: 2 tables and 5 functions measured for 4 roles, dependency refusal, request checks, claim (one at a time, daily cap, continue, exhausted), replace-on-retry commit, comparison');
} catch (e) {
  failed = true;
  console.error(e && e.stack || e);
} finally {
  psql('postgres', `drop database if exists ${DB};`, true);
}
if (failed) process.exit(1);
