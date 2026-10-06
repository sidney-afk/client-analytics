'use strict';
/*
 * analytics-collect-live-postgres.js: migrations/2026-10-06-analytics-collect-live.sql (the
 * switch of the daily Metrics and Top Videos jobs to "live") on a disposable PostgreSQL,
 * before anyone applies it live.
 *
 * Measures (not reads): the migration applies twice; what each of public, anon,
 * authenticated and service_role can really do on the new table and the six new functions;
 * the new "edge" source is accepted and nothing else new is; the live commits write the real
 * tables exactly once per client per day (a retry and a second run add nothing); the
 * transition rule (a client that already has n8n's row for the day keeps it and gets
 * nothing added); a refused live record leaves nothing behind, not even the shadow row; the
 * receipts (one per client, one whole-dataset receipt only when the whole day is done); the
 * daily safety check fires on each of its three conditions and stays quiet otherwise; and the
 * schedule migration's text (a disposable server has no pg_cron).
 *
 * The records are prepared by the same code the Edge Functions use
 * (supabase/functions/_shared/analytics-collect-live.mjs, which calls analytics-write's
 * prepareRows). Synthetic clients only.
 *
 * Needs a throwaway server: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY
 * with the usual PG* variables (or F63_REQUIRE_POSTGRES=1 in the isolated lane).
 * It creates and drops its own database.
 */
const assert = require('assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PHASE1 = read('migrations/2026-09-25-sheets-mirror-phase1.sql');
const METRICS = read('migrations/2026-10-01-analytics-metrics-collect-shadow.sql');
const TOPV = read('migrations/2026-10-02-analytics-top-videos-collect-shadow.sql');
const MIGRATION = read('migrations/2026-10-06-analytics-collect-live.sql');
const SCHEDULE = read('migrations/2026-10-06-analytics-collect-daily-check-schedule.sql');
if (process.env.F63_REQUIRE_POSTGRES !== '1' && process.env.SHEETS_MIRROR_TEST_CONFIRM !== 'LOCAL_DISPOSABLE_ONLY') {
  throw Error('DISPOSABLE_REQUIRED: set SHEETS_MIRROR_TEST_CONFIRM=LOCAL_DISPOSABLE_ONLY with PG* pointing at a throwaway server');
}
const DB = 'collect_live_' + process.pid;
const DAY = '2026-10-07';

function psql(database, text, allowFail = false, role = null) {
  const input = (role ? `set role ${role};\n` : '') + text;
  const r = spawnSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', database],
    { input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0 && !allowFail) throw Error('psql failed: ' + (r.stderr || r.stdout));
  return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}
const q = (sql, role) => psql(DB, sql, false, role).out;
const lit = v => `$j$${JSON.stringify(v)}$j$::jsonb`;

const FUNCTIONS = [
  'analytics_metrics_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean)',
  'analytics_top_videos_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean)',
  'analytics_collect_daily_check(date,text)',
  'analytics_collect_daily_check_record(text,date)',
];
const INTERNAL = ['analytics_collect_live_receipt(text,date,text,text,integer,integer,boolean)', 'analytics_receipt_json(text)'];

let failed = false;
(async () => {
  const live = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-collect-live.mjs')).href);
  const M = await import(pathToFileURL(path.join(ROOT, 'supabase/functions/_shared/analytics-metrics-collect.mjs')).href);
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
    assert(!psql(DB, MIGRATION, true).ok, 'refuses to apply before the two shadow migrations');
    psql(DB, METRICS);
    psql(DB, TOPV);
    // an existing n8n row must survive the source check being replaced
    q(`insert into public.analytics_metrics (row_hash, row_occurrence, client_slug, client_name, date, source, run_id)
       values (repeat('0', 64), 1, 'probeold', 'Probe Old', '2026-09-01', 'n8n', 'r0')`);
    psql(DB, MIGRATION);
    psql(DB, MIGRATION); // idempotent
    assert.equal(q(`select count(*) from pg_constraint where conrelid = 'public.analytics_metrics'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%source%'`), '1', 'one source check, not two, after two applies');
    assert.equal(q(`select value->>'mode' from public.syncview_runtime_flags where key = 'analytics_metrics_collect'`), 'off', 'the migration switches nothing on');
    assert.equal(q(`select value->>'mode' from public.syncview_runtime_flags where key = 'analytics_top_videos_collect'`), 'off', 'the migration switches nothing on');

    // ---- the new source value: "edge" and nothing else ----
    for (const t of ['analytics_metrics', 'analytics_top_videos']) {
      const day = t === 'analytics_metrics' ? 'date' : 'scraped_date';
      assert(psql(DB, `begin; insert into public.${t} (row_hash, row_occurrence, client_slug, client_name, ${day}, source, run_id) values (repeat('e',64),1,'probex','x','2026-09-02','edge','r'); rollback;`, true).ok, t + ' accepts source edge');
      assert(!psql(DB, `insert into public.${t} (row_hash, row_occurrence, client_slug, client_name, ${day}, source, run_id) values (repeat('f',64),1,'probex','x','2026-09-02','bogus','r')`, true).ok, t + ' still refuses an unknown source');
    }
    assert(psql(DB, `begin; insert into public.analytics_ingest_receipts (dataset, source, run_id, rows_received, rows_written, complete) values ('metrics','edge','r',0,0,true); rollback;`, true).ok, 'receipts accept source edge');
    assert(psql(DB, `begin; insert into public.analytics_ingest_receipts (dataset, source, run_id, rows_received, rows_written, complete) values ('metrics','sheet-copy','r',0,0,true); rollback;`, true).ok, 'receipts keep sheet-copy');

    // ---- the four roles, measured ----
    const T = 'analytics_collect_daily_checks';
    for (const role of ['public_probe', 'anon', 'authenticated']) {
      for (const stmt of [`select 1 from public.${T} limit 1`, `insert into public.${T} (run_date, dataset, mode, result) values ('${DAY}','metrics','live','{}')`, `delete from public.${T}`, `truncate public.${T}`]) {
        assert(!psql(DB, stmt, true, role).ok, `${role} must not run "${stmt.split(' ').slice(0, 2).join(' ')}" on ${T}`);
      }
      for (const f of [...FUNCTIONS, ...INTERNAL]) assert.equal(q(`select has_function_privilege('${role}', 'public.${f}', 'EXECUTE')`), 'f', `${role} cannot execute ${f}`);
      assert(!psql(DB, `insert into public.analytics_metrics (row_hash, row_occurrence, client_slug, client_name, date, source, run_id) values (repeat('a',64),1,'probex','x','${DAY}','edge','r')`, true, role).ok, `${role} still cannot write the real table`);
    }
    assert(psql(DB, `select 1 from public.${T} limit 1`, true, 'service_role').ok, 'service_role reads the checks');
    for (const stmt of [`insert into public.${T} (run_date, dataset, mode, result) values ('${DAY}','metrics','live','{}')`, `update public.${T} set mode = 'live'`, `delete from public.${T}`, `truncate public.${T}`]) {
      assert(!psql(DB, stmt, true, 'service_role').ok, `service_role must not run "${stmt.split(' ')[0]}" on ${T} (only through the record function)`);
    }
    assert.equal(q(`select relrowsecurity from pg_class where oid = 'public.${T}'::regclass`), 't', T + ' has RLS');
    assert.equal(q(`select count(*) from pg_policy where polrelid = 'public.${T}'::regclass`), '0', T + ' has no policy');
    for (const f of FUNCTIONS) assert.equal(q(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE')`), 't', 'service_role executes ' + f);
    for (const f of INTERNAL) assert.equal(q(`select has_function_privilege('service_role', 'public.${f}', 'EXECUTE')`), 'f', 'service_role cannot call the internal ' + f);
    assert(!psql(DB, `delete from public.analytics_metrics`, true, 'service_role').ok, 'service_role still cannot delete real rows');

    // ---- metrics: live commit ----
    q(`insert into public.client_profiles (slug, display_name) values ('probea','Probe A'),('probeb','Probe B'),('probec','Probe C')`);
    q(`insert into public.analytics_metrics_collect_queue (run_date, client_slug, state) values ('${DAY}','probea','running'),('${DAY}','probeb','running'),('${DAY}','probec','running')`);
    const now = DAY + 'T05:00:00.000Z';
    const metricRow = (name, over = {}) => {
      const merged = M.mergeClient({ client_name: name, instagram_handle: 'h', tiktok_handle: '', youtube_channel_id: '' },
        { ig: M.aggregateInstagram({ followersCount: 100 }, [{ id: 'r1', videoPlayCount: 50, likesCount: 3 }], now) }, now);
      return { ...M.toStoredRow(M.computeDiffs(merged, { ig_views_gained_today: 40, tiktok_plays_gained_today: 0 }, [], now)), ...over };
    };
    const commitMetrics = async (slug, name, full = true, role = 'service_role', recOver = {}) => {
      const row = metricRow(name);
      const [rec] = await live.liveRecords('metrics', [row], { runId: 'collect-' + DAY, clientSlug: slug, runDate: DAY });
      return psql(DB, `select public.analytics_metrics_collect_commit_live('${DAY}','${slug}', ${lit(row)}, ${lit([{ post_id: 'igr_' + slug, client_name: name, platform: 'instagram', first_seen_date: DAY, views_yesterday: 0, views_today: 50, views_gained_today: 0 }])}, 'collect-${DAY}', ${lit({ ...rec, ...recOver })}, ${full})`, true, role);
    };
    let r = await commitMetrics('probea', 'Probe A');
    assert(r.ok, 'the live commit runs as service_role: ' + r.err);
    assert.deepEqual(JSON.parse(r.out), { written: 1, skipped: null }, 'first live commit writes one row');
    assert.equal(q(`select count(*) || ':' || min(source) || ':' || min(run_id) from public.analytics_metrics where client_slug = 'probea' and date = '${DAY}'`), '1:edge:collect-' + DAY, 'one real row, source edge');
    assert.equal(q(`select count(*) from public.analytics_metrics_shadow where client_slug = 'probea' and run_date = '${DAY}'`), '1', 'the shadow row is written too');
    assert.equal(q(`select state from public.analytics_metrics_collect_queue where client_slug = 'probea' and run_date = '${DAY}'`), 'done');
    assert.equal(q(`select count(*) from public.analytics_post_tracking where post_id = 'igr_probea'`), '1', 'post tracking advances in the same transaction');
    const sameAsWrite = (await live.liveRecords('metrics', [metricRow('Probe A')], { runId: 'x', clientSlug: 'probea', runDate: DAY }))[0].row_hash;
    assert.equal(q(`select row_hash from public.analytics_metrics where client_slug = 'probea' and date = '${DAY}'`), sameAsWrite, 'the stored fingerprint is the one analytics-write computes');

    r = await commitMetrics('probea', 'Probe A');
    assert.deepEqual(JSON.parse(r.out), { written: 0, skipped: 'existing_rows' }, 'a retry adds nothing');
    assert.equal(q(`select count(*) from public.analytics_metrics where client_slug = 'probea' and date = '${DAY}'`), '1', 'still one row after a retry');

    // the transition rule: n8n's row first, then the job
    q(`insert into public.analytics_metrics (row_hash, row_occurrence, client_slug, client_name, date, ig_followers, source, run_id)
       values (repeat('b', 64), 1, 'probeb', 'Probe B', '${DAY}', '999', 'n8n', 'n8n-1')`);
    r = await commitMetrics('probeb', 'Probe B');
    assert.deepEqual(JSON.parse(r.out), { written: 0, skipped: 'existing_rows' }, 'a client n8n already wrote today keeps n8n\'s row');
    assert.equal(q(`select string_agg(source, ',') from public.analytics_metrics where client_slug = 'probeb' and date = '${DAY}'`), 'n8n', 'only n8n\'s row for that day');
    assert.equal(q(`select state from public.analytics_metrics_collect_queue where client_slug = 'probeb' and run_date = '${DAY}'`), 'done', 'the client is still done (and its shadow row kept for the comparison)');

    // a refused record leaves nothing behind, not even the shadow row or the done mark
    for (const bad of [{ date: '2026-10-08' }, { client_slug: 'probea' }, { source: 'n8n' }]) {
      r = await commitMetrics('probec', 'Probe C', true, 'service_role', bad);
      assert(!r.ok, 'refused: ' + JSON.stringify(bad));
    }
    assert.equal(q(`select count(*) from public.analytics_metrics_shadow where client_slug = 'probec'`), '0', 'a refused live commit writes no shadow row');
    assert.equal(q(`select state from public.analytics_metrics_collect_queue where client_slug = 'probec' and run_date = '${DAY}'`), 'running', 'and leaves the client retryable');
    for (const role of ['anon', 'authenticated']) assert(!(await commitMetrics('probec', 'Probe C', true, role)).ok, role + ' cannot run the live commit');

    // receipts: one per client commit; the whole-dataset one only once the day is done
    assert.equal(q(`select count(*) from public.analytics_ingest_receipts where dataset = 'metrics' and source = 'edge' and full_snapshot`), '0', 'no whole-dataset receipt while a client is open');
    r = await commitMetrics('probec', 'Probe C');
    assert.deepEqual(JSON.parse(r.out), { written: 1, skipped: null });
    assert.equal(q(`select count(*) from public.analytics_ingest_receipts where dataset = 'metrics' and source = 'edge' and not full_snapshot`), '4', 'one receipt per client commit (three clients, one retry)');
    assert.equal(q(`select rows_written || ':' || array_to_string(client_slugs, ',') || ':' || complete from public.analytics_ingest_receipts where dataset = 'metrics' and source = 'edge' and full_snapshot`), '3:probea,probeb,probec:true', 'one whole-dataset receipt when the last client is done, counting the day\'s rows');
    await commitMetrics('probec', 'Probe C');
    assert.equal(q(`select count(*) from public.analytics_ingest_receipts where dataset = 'metrics' and source = 'edge' and full_snapshot`), '1', 'never a second whole-dataset receipt for the same run');

    // a run limited to a clients list never claims the whole dataset
    const DAY2 = '2026-10-08';
    q(`insert into public.analytics_metrics_collect_queue (run_date, client_slug, state) values ('${DAY2}','probea','running')`);
    const row2 = metricRow('Probe A', { date: DAY2 });
    const [rec2] = await live.liveRecords('metrics', [row2], { runId: 'collect-' + DAY2, clientSlug: 'probea', runDate: DAY2 });
    q(`select public.analytics_metrics_collect_commit_live('${DAY2}','probea', ${lit(row2)}, '[]'::jsonb, 'collect-${DAY2}', ${lit(rec2)}, false)`, 'service_role');
    assert.equal(q(`select count(*) from public.analytics_ingest_receipts where run_id = 'collect-${DAY2}' and full_snapshot`), '0', 'with a clients list: per-client receipts only');

    // ---- top videos: live commit ----
    q(`insert into public.analytics_top_videos_collect_queue (run_date, client_slug, state) values ('${DAY}','probea','running'),('${DAY}','probeb','running'),('${DAY}','probec','running')`);
    const tv = (name, rank, url, views) => ({ scraped_date: DAY, client_name: name, platform: 'instagram', period: 'week', rank: String(rank),
      caption: 'cap', video_url: url, views: String(views), likes: '1', comments: '0', shares: '0' });
    const shadowRec = r0 => ({ ...r0 });
    const commitTop = async (slug, rows, full = true) => {
      const recs = await live.liveRecords('top_videos', rows, { runId: 'top-videos-collect-' + DAY, clientSlug: slug, runDate: DAY });
      return psql(DB, `select public.analytics_top_videos_collect_commit_live('${DAY}','${slug}', ${lit(rows.map(shadowRec))}, ${lit({ instagram: 'success', tiktok: 'not_configured', youtube: 'not_configured' })}, 'top-videos-collect-${DAY}', ${lit(recs)}, ${full})`, true, 'service_role');
    };
    const A = [tv('Probe A', 1, 'https://i/1', 100), tv('Probe A', 2, 'https://i/2', 50), tv('Probe A', 2, 'https://i/2', 50)];
    r = await commitTop('probea', A);
    assert.deepEqual(JSON.parse(r.out), { written: 3, skipped: null }, 'all the client\'s rows, an identical pair kept as two (occurrence 1 and 2, as analytics-write keeps them)');
    r = await commitTop('probea', A);
    assert.deepEqual(JSON.parse(r.out), { written: 0, skipped: 'existing_rows' }, 'a retry adds nothing');
    assert.equal(q(`select count(*) from public.analytics_top_videos where client_slug = 'probea' and scraped_date = '${DAY}'`), '3', 'still three rows');
    q(`insert into public.analytics_top_videos (row_hash, row_occurrence, client_slug, client_name, scraped_date, source, run_id) values (repeat('c', 64), 1, 'probeb', 'Probe B', '${DAY}', 'n8n', 'n8n-topvideos-1')`);
    r = await commitTop('probeb', [tv('Probe B', 1, 'https://i/b', 10)]);
    assert.deepEqual(JSON.parse(r.out), { written: 0, skipped: 'existing_rows' }, 'n8n wrote this client today: its rows stay, nothing added');
    assert.equal(q(`select count(*) from public.analytics_top_videos_shadow where client_slug = 'probeb' and run_date = '${DAY}'`), '1', 'the shadow rows are still written for the comparison');
    const bad = await live.liveRecords('top_videos', [tv('Probe C', 1, 'https://i/c', 1)], { runId: 'r', clientSlug: 'probec', runDate: DAY });
    assert(!psql(DB, `select public.analytics_top_videos_collect_commit_live('${DAY}','probec','[]'::jsonb,'{}'::jsonb,'r', ${lit(bad.map(x => ({ ...x, scraped_date: '2026-10-09' })))}, true)`, true, 'service_role').ok, 'a record of another day is refused');
    assert.equal(q(`select state from public.analytics_top_videos_collect_queue where client_slug = 'probec' and run_date = '${DAY}'`), 'running', 'and nothing is marked done');
    r = await commitTop('probec', []);
    assert.deepEqual(JSON.parse(r.out), { written: 0, skipped: null }, 'a client with no rows today commits an empty list');
    assert.equal(q(`select rows_written from public.analytics_ingest_receipts where dataset = 'top_videos' and source = 'edge' and full_snapshot`), '4', 'the whole-dataset receipt counts the day\'s rows of every source');

    // ---- the daily safety check ----
    const check = (ds, d = DAY) => JSON.parse(q(`select public.analytics_collect_daily_check('${d}', '${ds}')`, 'service_role'));
    const setFlag = (key, v) => q(`update public.syncview_runtime_flags set value = ${lit(v)} where key = '${key}'`);
    setFlag('analytics_metrics_collect', { mode: 'live' });
    setFlag('analytics_top_videos_collect', { mode: 'live' });
    let c = check('metrics');
    assert.deepEqual(c.problems, [], 'quiet: every active client has its result, nothing failed, fewer than 5 Instagram clients');
    assert.equal(c.active_clients, 3);
    assert.equal(c.terminal_clients, 3);
    assert.equal(c.mode, 'live');
    assert.deepEqual(check('top_videos').problems, [], 'top videos quiet');

    // 1. an active client with no result
    q(`insert into public.client_profiles (slug, display_name) values ('probed','Probe D')`);
    c = check('metrics');
    assert.deepEqual(c.problems, ['missing_terminal'], 'an active client with no queue row is a missing result');
    assert.equal(c.missing_terminal, 1);
    q(`insert into public.analytics_metrics_collect_queue (run_date, client_slug, state, attempts) values ('${DAY}','probed','running', 8)`);
    assert.deepEqual(check('metrics').problems, ['missing_terminal'], 'a client stuck at its last attempt is a missing result too');
    assert.deepEqual(check('top_videos').problems, ['missing_terminal'], 'and for Top Videos');
    q(`update public.client_profiles set archived_at = now() where slug = 'probed'`);
    assert.deepEqual(check('metrics').problems, [], 'an archived client is not expected');
    setFlag('analytics_metrics_collect', { mode: 'live', clients: ['probea'] });
    assert.equal(check('metrics').active_clients, 1, 'with a clients list only those clients are expected');
    setFlag('analytics_metrics_collect', { mode: 'live' });

    // 2. a configured platform ended as a provider failure
    const setReceipt = (slug, ig, gain = '40') => q(`update public.analytics_metrics_shadow set ig_views_gained_today = '${gain}', analytics_receipt = ${lit({ result: 'degraded', platforms: { instagram: ig, tiktok: { expected: false, state: 'not_configured' }, youtube: { expected: false, state: 'not_configured' } } })}::text where client_slug = '${slug}' and run_date = '${DAY}'`);
    setReceipt('probea', { expected: true, state: 'provider_failed', error_class: 'apify_http_error' });
    c = check('metrics');
    assert.deepEqual(c.problems, ['provider_failed'], 'a provider failure on a configured platform is named');
    assert.equal(c.provider_failed_clients, 1);
    setReceipt('probea', { expected: true, state: 'provider_failed', error_class: 'apify_restricted_profile' });
    assert.deepEqual(check('metrics').problems, [], 'a restricted Instagram profile is not counted (n8n treats it as non-fatal)');
    setReceipt('probea', { expected: true, state: 'success' });
    q(`update public.analytics_top_videos_collect_queue set outcome = '{"instagram":"provider_failed","tiktok":"success","youtube":"not_configured"}' where client_slug = 'probea' and run_date = '${DAY}'`);
    c = check('top_videos');
    assert.deepEqual(c.problems, ['provider_failed'], 'a Top Videos platform that failed is named');
    assert.equal(c.instagram_frozen, false, 'the frozen rule is a Metrics rule only');
    q(`update public.analytics_top_videos_collect_queue set outcome = '{"instagram":"success"}' where client_slug = 'probea' and run_date = '${DAY}'`);

    // 3. frozen Instagram: 5 or more configured, all healthy, none gained
    const more = ['probee', 'probef', 'probeg'];
    q(`insert into public.client_profiles (slug, display_name) values ${more.map(s => `('${s}','x')`).join(',')}`);
    q(`insert into public.analytics_metrics_collect_queue (run_date, client_slug, state) values ${more.map(s => `('${DAY}','${s}','done')`).join(',')}`);
    q(`insert into public.analytics_metrics_shadow (run_date, client_slug, client_name, date, run_id) values ${more.map(s => `('${DAY}','${s}','x','${DAY}','r')`).join(',')}`);
    const okIg = { expected: true, state: 'success' };
    for (const s of ['probea', 'probeb', 'probec', ...more]) setReceipt(s, okIg, '0');
    c = check('metrics');
    assert.deepEqual(c.problems, ['instagram_frozen'], 'six healthy Instagram clients and no gain anywhere is the frozen pattern');
    assert.equal(c.instagram_configured, 6);
    setReceipt('probeg', okIg, '12');
    assert.deepEqual(check('metrics').problems, [], 'one client with a gain: not frozen');
    setReceipt('probeg', { expected: true, state: 'provider_failed', error_class: 'apify_no_items' }, '0');
    assert.deepEqual(check('metrics').problems, ['instagram_frozen'], 'a non-fatal answer still counts as healthy (n8n\'s rule)');
    setReceipt('probeg', { expected: false, state: 'not_configured' }, '0');
    setReceipt('probef', { expected: false, state: 'not_configured' }, '0');
    assert.deepEqual(check('metrics').problems, [], 'four configured clients is below the threshold of five');
    setReceipt('probef', okIg, '0');
    setReceipt('probeg', okIg, '0');

    // ---- the record function: keeps one answer per day and dataset, nothing while off ----
    setFlag('analytics_metrics_collect', { mode: 'off' });
    assert.equal(JSON.parse(q(`select public.analytics_collect_daily_check_record('metrics', '${DAY}')`, 'service_role')).mode, 'off');
    assert.equal(q(`select count(*) from public.analytics_collect_daily_checks`), '0', 'off: nothing recorded');
    setFlag('analytics_metrics_collect', { mode: 'live' });
    q(`select public.analytics_collect_daily_check_record('metrics', '${DAY}')`, 'service_role');
    assert.equal(q(`select mode || ':' || array_to_string(problems, ',') from public.analytics_collect_daily_checks where run_date = '${DAY}' and dataset = 'metrics'`), 'live:instagram_frozen');
    setReceipt('probeg', okIg, '12');
    q(`select public.analytics_collect_daily_check_record('metrics', '${DAY}')`, 'service_role');
    assert.equal(q(`select count(*) || ':' || coalesce(array_to_string(min(problems), ','), '') from public.analytics_collect_daily_checks where run_date = '${DAY}' and dataset = 'metrics'`), '1:', 'a re-run the same day replaces the answer');
    assert(!psql(DB, `select public.analytics_collect_daily_check('${DAY}', 'market_research')`, true, 'service_role').ok, 'an unknown dataset is refused');

    // ---- the schedule migration (text only: no pg_cron here) ----
    const body = SCHEDULE.replace(/^--.*$/gm, '');
    assert(body.includes("'7 9 * * *'") && body.includes("analytics_collect_daily_check_record('metrics')"), 'metrics check at 09:07 UTC, after its 04:00 to 08:59 window');
    assert(body.includes("'7 13 * * *'") && body.includes("analytics_collect_daily_check_record('top_videos')"), 'top videos check at 13:07 UTC, after its 08:00 to 12:59 window');
    assert(!/net\.http_post|vault\./.test(body), 'the check timer makes no network call and reads no secret');

    console.log('ANALYTICS_COLLECT_LIVE_POSTGRES_OK: applied twice, edge source, 1 table and 6 functions measured for 4 roles, live commits once per client per day, transition rule, receipts, daily check fires on 3 conditions and stays quiet otherwise');
  } catch (e) {
    failed = true;
    console.error(e && e.stack || e);
  } finally {
    psql('postgres', `drop database if exists ${DB};`, true);
  }
  if (failed) process.exit(1);
})();
