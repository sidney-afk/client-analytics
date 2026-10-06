-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go).
--
-- The switch of the daily analytics jobs (docs/plans/2026-10-01-n8n-off-analytics.md,
-- section 8b): analytics-metrics-collect and analytics-top-videos-collect get a third mode,
-- "live", in which they write the real tables the pages read. Applying this file changes
-- nothing anyone sees: both flags stay where they are (off or shadow) until someone sets
-- "live" by hand, and nothing here writes a row of the real tables by itself.
--
--   source "edge"                       one more allowed value in the source check of
--                                       analytics_metrics, analytics_top_videos and
--                                       analytics_ingest_receipts (the rows and receipts the
--                                       two jobs write in live mode)
--   analytics_metrics_collect_commit_live()     the shadow commit (row, post tracking, done)
--                                       PLUS the day's row in analytics_metrics, in ONE
--                                       transaction
--   analytics_top_videos_collect_commit_live()  the shadow commit PLUS the client's rows of
--                                       the day in analytics_top_videos, in ONE transaction
--   analytics_collect_live_receipt()    internal: the per-client receipt, and the
--                                       whole-dataset receipt once every queued client of
--                                       the day is done (the staff pages trust the mirror
--                                       only while such a receipt is less than 3 days old)
--   analytics_collect_daily_check()     n8n's end-of-run safety checks, rebuilt over the
--                                       queues: active clients with no terminal result,
--                                       clients with a platform that failed at the provider,
--                                       the frozen-Instagram pattern. Counts only.
--   analytics_collect_daily_checks      one row per dataset per day: the check's answer,
--                                       read by the combined Slack problem message
--                                       (scripts/alert-digest.js)
--   analytics_collect_daily_check_record()  runs the check and keeps its answer (the timer
--                                       in 2026-10-06-analytics-collect-daily-check-schedule.sql)
--
-- THE TRANSITION RULE (first writer wins, per client per day). A live commit adds the
-- client's row(s) to the real table only when the real table holds NO row for that client
-- and day yet, from any source. So on the switch-over day, when n8n is still on and has
-- already mirrored a client, n8n's row stays and the job adds nothing; a retry, a second
-- tick or a re-run never adds a second copy. If the job writes first and n8n mirrors the
-- same client later that day (n8n is not edited), the day holds two rows: the pages read
-- one Metrics row per client per day (test/analytics-same-day-rows-count-once.js) and Top
-- Videos of one day de-duplicated by link, so nothing is counted twice. Once n8n is off
-- there is exactly one writer.
--
-- Access: every new function and table has every privilege revoked from public, anon,
-- authenticated AND service_role (all four named: Supabase grants new objects to the last
-- three by default), then only what is needed back to service_role. The internal receipt
-- function is executable by nobody but its owner. The new table: RLS on, no policies,
-- service_role SELECT only (it is written through the record function).
-- Needs 2026-10-01-analytics-metrics-collect-shadow.sql and
-- 2026-10-02-analytics-top-videos-collect-shadow.sql applied first. Idempotent.
-- Rollback block at the bottom.
begin;

do $dep$
begin
  if to_regprocedure('public.analytics_metrics_collect_commit_shadow(date,text,jsonb,jsonb,text)') is null then
    raise exception 'apply 2026-10-01-analytics-metrics-collect-shadow.sql first';
  end if;
  if to_regprocedure('public.analytics_top_videos_collect_commit_shadow(date,text,jsonb,jsonb,text)') is null then
    raise exception 'apply 2026-10-02-analytics-top-videos-collect-shadow.sql first';
  end if;
end
$dep$;

-- ---------- One more allowed source: "edge" ----------
-- The check constraints were written inline (so Postgres named them); every CHECK that
-- reads the source column is replaced by one named constraint with the old values plus
-- "edge". Re-running replaces it with itself.
do $src$
declare
  t record;
  c record;
begin
  for t in select * from (values
      ('analytics_metrics', 'sheet-backfill,n8n,edge'),
      ('analytics_top_videos', 'sheet-backfill,n8n,edge'),
      ('analytics_ingest_receipts', 'sheet-backfill,sheet-copy,n8n,edge')) as v(tbl, allowed)
  loop
    for c in
      select con.conname
      from pg_constraint con
      join pg_attribute a on a.attrelid = con.conrelid and a.attname = 'source'
      where con.conrelid = format('public.%I', t.tbl)::regclass
        and con.contype = 'c' and a.attnum = any(con.conkey)
    loop
      execute format('alter table public.%I drop constraint %I', t.tbl, c.conname);
    end loop;
    execute format('alter table public.%I add constraint %I check (source = any (%L::text[]))',
      t.tbl, t.tbl || '_source_check', '{' || t.allowed || '}');
  end loop;
end
$src$;

-- ---------- A receipt JSON that may be broken text ----------
create or replace function public.analytics_receipt_json(r text)
returns jsonb
language plpgsql immutable
as $fn$
begin
  return r::jsonb;
exception when others then
  return null;
end
$fn$;

-- ---------- Receipts of a live commit (internal) ----------
-- One receipt per client commit (it vouches for that client, as an analytics-write call
-- does), then, when the run covers every active client and no queued client of the day is
-- left, one whole-dataset receipt. The advisory lock makes the last two commits of a day
-- take turns, so the later one always sees the earlier one as done.
create or replace function public.analytics_collect_live_receipt(
  p_dataset text, p_run_date date, p_client_slug text, p_run_id text, p_received integer, p_written integer, p_full_snapshot boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_open integer;
  v_rows integer;
  v_slugs text[];
begin
  if p_dataset not in ('metrics', 'top_videos') then raise exception 'live_receipt_unknown_dataset'; end if;
  insert into public.analytics_ingest_receipts (dataset, source, run_id, rows_received, rows_written, client_slugs, run_part, complete, full_snapshot)
  values (p_dataset, 'edge', p_run_id, greatest(0, p_received), greatest(0, p_written), array[p_client_slug], 0, true, false);

  if not coalesce(p_full_snapshot, false) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('analytics_collect_snapshot:' || p_dataset || ':' || p_run_date::text, 0));
  if p_dataset = 'metrics' then
    select count(*) filter (where q.state <> 'done'), coalesce(array_agg(q.client_slug order by q.client_slug), '{}')
      into v_open, v_slugs from public.analytics_metrics_collect_queue q where q.run_date = p_run_date;
    select count(*) into v_rows from public.analytics_metrics m where m.date = p_run_date;
  else
    select count(*) filter (where q.state <> 'done'), coalesce(array_agg(q.client_slug order by q.client_slug), '{}')
      into v_open, v_slugs from public.analytics_top_videos_collect_queue q where q.run_date = p_run_date;
    select count(*) into v_rows from public.analytics_top_videos t where t.scraped_date = p_run_date;
  end if;
  if v_open = 0 and not exists (
      select 1 from public.analytics_ingest_receipts r
      where r.dataset = p_dataset and r.source = 'edge' and r.run_id = p_run_id and r.full_snapshot) then
    insert into public.analytics_ingest_receipts (dataset, source, run_id, rows_received, rows_written, client_slugs, run_part, complete, full_snapshot)
    values (p_dataset, 'edge', p_run_id, v_rows, v_rows, v_slugs, 0, true, true);
  end if;
end
$fn$;

-- ---------- Metrics: the shadow commit plus the real row, all or nothing ----------
-- p_record is the row as analytics-write would store it (client_slug, row_hash,
-- row_occurrence, the 17 columns, extra, source, run_id, run_part), prepared by the function
-- with the same code analytics-write uses. Returns {"written": 0|1, "skipped": null|"existing_rows"}.
create or replace function public.analytics_metrics_collect_commit_live(
  p_run_date date, p_client_slug text, p_row jsonb, p_posts jsonb, p_run_id text, p_record jsonb, p_full_snapshot boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_written integer := 0;
  v_skipped text := null;
begin
  if p_record is null or jsonb_typeof(p_record) <> 'object' then raise exception 'live_record_missing'; end if;
  if p_record->>'client_slug' is distinct from p_client_slug then raise exception 'live_record_wrong_client'; end if;
  if p_record->>'date' is distinct from p_run_date::text then raise exception 'live_record_wrong_day'; end if;
  if p_record->>'source' is distinct from 'edge' then raise exception 'live_record_wrong_source'; end if;

  perform public.analytics_metrics_collect_commit_shadow(p_run_date, p_client_slug, p_row, p_posts, p_run_id);

  -- Two writers of the same client and day take turns (n8n's analytics-write does not
  -- take this lock; see the transition rule in the header).
  perform pg_advisory_xact_lock(hashtextextended('analytics_live:metrics:' || p_client_slug || ':' || p_run_date::text, 0));
  if exists (select 1 from public.analytics_metrics m where m.client_slug = p_client_slug and m.date = p_run_date) then
    v_skipped := 'existing_rows';
  else
    insert into public.analytics_metrics (row_hash, row_occurrence, client_slug, client_name, date, ig_followers, ig_avg_views,
      ig_avg_likes, tiktok_followers, tiktok_avg_plays, yt_subscribers, yt_total_views, ig_views_gained_today,
      tiktok_plays_gained_today, ig_views_this_month, tiktok_plays_this_month, yt_views_gained_today, yt_shorts_views,
      yt_longs_views, analytics_receipt, extra, source, run_id, run_part)
    select r.row_hash, r.row_occurrence, r.client_slug, r.client_name, r.date::date, r.ig_followers, r.ig_avg_views,
      r.ig_avg_likes, r.tiktok_followers, r.tiktok_avg_plays, r.yt_subscribers, r.yt_total_views, r.ig_views_gained_today,
      r.tiktok_plays_gained_today, r.ig_views_this_month, r.tiktok_plays_this_month, r.yt_views_gained_today, r.yt_shorts_views,
      r.yt_longs_views, r.analytics_receipt, coalesce(r.extra, '{}'::jsonb), r.source, r.run_id, coalesce(r.run_part, 0)
    from jsonb_to_record(p_record) as r(row_hash text, row_occurrence integer, client_slug text, client_name text, date text,
      ig_followers text, ig_avg_views text, ig_avg_likes text, tiktok_followers text, tiktok_avg_plays text, yt_subscribers text,
      yt_total_views text, ig_views_gained_today text, tiktok_plays_gained_today text, ig_views_this_month text,
      tiktok_plays_this_month text, yt_views_gained_today text, yt_shorts_views text, yt_longs_views text,
      analytics_receipt text, extra jsonb, source text, run_id text, run_part integer)
    on conflict (row_hash, row_occurrence) do nothing;
    get diagnostics v_written = row_count;
  end if;

  perform public.analytics_collect_live_receipt('metrics', p_run_date, p_client_slug, p_run_id, 1, v_written, p_full_snapshot);
  return jsonb_build_object('written', v_written, 'skipped', v_skipped);
end
$fn$;

-- ---------- Top Videos: the shadow commit plus the real rows, all or nothing ----------
-- p_records: the client's rows as analytics-write would store them. An empty list is a
-- client with no rows today (n8n writes nothing for it either).
-- Returns {"written": n, "skipped": null|"existing_rows"}.
create or replace function public.analytics_top_videos_collect_commit_live(
  p_run_date date, p_client_slug text, p_rows jsonb, p_states jsonb, p_run_id text, p_records jsonb, p_full_snapshot boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_written integer := 0;
  v_skipped text := null;
  v_count integer;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then raise exception 'live_records_missing'; end if;
  v_count := jsonb_array_length(p_records);
  if exists (
      select 1 from jsonb_array_elements(p_records) e
      where jsonb_typeof(e) <> 'object'
         or e->>'client_slug' is distinct from p_client_slug
         or e->>'scraped_date' is distinct from p_run_date::text
         or e->>'source' is distinct from 'edge') then
    raise exception 'live_records_refused';
  end if;

  perform public.analytics_top_videos_collect_commit_shadow(p_run_date, p_client_slug, p_rows, p_states, p_run_id);

  perform pg_advisory_xact_lock(hashtextextended('analytics_live:top_videos:' || p_client_slug || ':' || p_run_date::text, 0));
  if exists (select 1 from public.analytics_top_videos t where t.client_slug = p_client_slug and t.scraped_date = p_run_date) then
    v_skipped := 'existing_rows';
  elsif v_count > 0 then
    insert into public.analytics_top_videos (row_hash, row_occurrence, client_slug, client_name, scraped_date, platform, period,
      rank, caption, video_url, views, likes, comments, shares, extra, source, run_id, run_part)
    select r.row_hash, r.row_occurrence, r.client_slug, r.client_name, r.scraped_date::date, r.platform, r.period,
      r.rank, r.caption, r.video_url, r.views, r.likes, r.comments, r.shares, coalesce(r.extra, '{}'::jsonb), r.source, r.run_id,
      coalesce(r.run_part, 0)
    from rows from (jsonb_to_recordset(p_records) as (row_hash text, row_occurrence integer, client_slug text,
      client_name text, scraped_date text, platform text, period text, rank text, caption text, video_url text, views text,
      likes text, comments text, shares text, extra jsonb, source text, run_id text, run_part integer))
      with ordinality as r(row_hash, row_occurrence, client_slug, client_name, scraped_date, platform, period, rank, caption,
        video_url, views, likes, comments, shares, extra, source, run_id, run_part, ord)
    order by r.ord
    on conflict (row_hash, row_occurrence) do nothing;
    get diagnostics v_written = row_count;
  end if;

  perform public.analytics_collect_live_receipt('top_videos', p_run_date, p_client_slug, p_run_id, v_count, v_written, p_full_snapshot);
  return jsonb_build_object('written', v_written, 'skipped', v_skipped);
end
$fn$;

-- ---------- n8n's end-of-run safety checks, over our own queues ----------
-- For one dataset and day (counts only, never a client):
--   missing_terminal   active clients (not archived; only the flag's `clients` list when it
--                      has one) whose queue row is not done: no result at all for the day
--   provider_failed    clients with at least one configured platform that ended as a
--                      provider failure. Metrics follows n8n exactly: an Instagram
--                      "restricted profile" or "no items" answer is not counted (n8n calls
--                      those non-fatal). Top Videos records no error class, so every
--                      provider failure counts.
--   instagram_frozen   metrics only, n8n's rule: 5 or more clients with Instagram
--                      configured, all of them healthy (success, genuinely empty, or a
--                      non-fatal answer), and not one with Instagram views gained today
-- mode is the flag's mode (off, shadow or live).
create or replace function public.analytics_collect_daily_check(p_date date, p_dataset text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_flags jsonb;
  v_mode text;
  v_list text[];
  v_active integer := 0;
  v_terminal integer := 0;
  v_failed integer := 0;
  v_ig_conf integer := 0;
  v_ig_healthy integer := 0;
  v_ig_growth integer := 0;
  v_frozen boolean := false;
  v_problems text[] := '{}';
begin
  if p_dataset not in ('metrics', 'top_videos') then raise exception 'unknown_dataset'; end if;
  select f.value into v_flags from public.syncview_runtime_flags f
   where f.key = case p_dataset when 'metrics' then 'analytics_metrics_collect' else 'analytics_top_videos_collect' end;
  v_mode := case when v_flags->>'mode' in ('shadow', 'live') then v_flags->>'mode' else 'off' end;
  v_list := array(
    select btrim(x) from jsonb_array_elements_text(
      case when jsonb_typeof(v_flags->'clients') = 'array' then v_flags->'clients' else '[]'::jsonb end) x
    where btrim(x) <> '');

  if p_dataset = 'metrics' then
    with active as (
      select p.slug from public.client_profiles p
      where p.archived_at is null and (cardinality(v_list) = 0 or p.slug = any(v_list))),
    done as (
      select a.slug, public.analytics_receipt_json(s.analytics_receipt) as rc, public.analytics_num(s.ig_views_gained_today) as ig_gain
      from active a
      join public.analytics_metrics_collect_queue q on q.run_date = p_date and q.client_slug = a.slug and q.state = 'done'
      left join public.analytics_metrics_shadow s on s.run_date = p_date and s.client_slug = a.slug),
    per as (
      select d.slug,
        exists (select 1 from jsonb_each(coalesce(d.rc->'platforms', '{}'::jsonb)) pl
                where pl.value->>'state' = 'provider_failed'
                  and coalesce(pl.value->>'error_class', '') not in ('apify_restricted_profile', 'apify_no_items')) as failed,
        coalesce(d.rc#>>'{platforms,instagram,expected}', '') = 'true' as ig_conf,
        d.rc#>>'{platforms,instagram,state}' in ('success', 'genuinely_empty')
          or (d.rc#>>'{platforms,instagram,state}' = 'provider_failed'
              and d.rc#>>'{platforms,instagram,error_class}' in ('apify_restricted_profile', 'apify_no_items')) as ig_healthy,
        d.rc#>>'{platforms,instagram,state}' in ('success', 'genuinely_empty') and coalesce(d.ig_gain, 0) > 0 as ig_growth
      from done d)
    select (select count(*) from active), (select count(*) from done),
           count(*) filter (where per.failed),
           count(*) filter (where per.ig_conf),
           count(*) filter (where per.ig_conf and per.ig_healthy),
           count(*) filter (where per.ig_conf and per.ig_growth)
      into v_active, v_terminal, v_failed, v_ig_conf, v_ig_healthy, v_ig_growth
      from per;
    v_frozen := v_ig_conf >= 5 and v_ig_healthy = v_ig_conf and v_ig_growth = 0;
  else
    with active as (
      select p.slug from public.client_profiles p
      where p.archived_at is null and (cardinality(v_list) = 0 or p.slug = any(v_list))),
    done as (
      select a.slug, q.outcome
      from active a
      join public.analytics_top_videos_collect_queue q on q.run_date = p_date and q.client_slug = a.slug and q.state = 'done')
    select (select count(*) from active), (select count(*) from done),
           (select count(*) from done d where exists (
              select 1 from jsonb_each_text(case when jsonb_typeof(d.outcome) = 'object' then d.outcome else '{}'::jsonb end) o
              where o.value = 'provider_failed'))
      into v_active, v_terminal, v_failed;
  end if;

  if v_active > v_terminal then v_problems := v_problems || 'missing_terminal'::text; end if;
  if v_failed > 0 then v_problems := v_problems || 'provider_failed'::text; end if;
  if v_frozen then v_problems := v_problems || 'instagram_frozen'::text; end if;

  return jsonb_build_object(
    'dataset', p_dataset, 'run_date', p_date, 'mode', v_mode,
    'active_clients', v_active, 'terminal_clients', v_terminal, 'missing_terminal', greatest(0, v_active - v_terminal),
    'provider_failed_clients', v_failed,
    'instagram_configured', v_ig_conf, 'instagram_healthy', v_ig_healthy, 'instagram_growth_clients', v_ig_growth,
    'instagram_frozen', v_frozen,
    'problems', to_jsonb(v_problems));
end
$fn$;

create table if not exists public.analytics_collect_daily_checks (
  run_date   date not null,
  dataset    text not null check (dataset in ('metrics', 'top_videos')),
  mode       text not null check (mode in ('shadow', 'live')),
  problems   text[] not null default '{}',
  result     jsonb not null check (jsonb_typeof(result) = 'object'),
  checked_at timestamptz not null default now(),
  primary key (run_date, dataset)
);

-- Runs the check and keeps its answer, unless the job is off (nothing to check then).
-- Run again the same day, it replaces that day's answer.
create or replace function public.analytics_collect_daily_check_record(
  p_dataset text, p_date date default (now() at time zone 'utc')::date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v jsonb;
begin
  v := public.analytics_collect_daily_check(p_date, p_dataset);
  if v->>'mode' = 'off' then return v; end if;
  insert into public.analytics_collect_daily_checks (run_date, dataset, mode, problems, result, checked_at)
  values (p_date, p_dataset, v->>'mode', array(select jsonb_array_elements_text(v->'problems')), v, now())
  on conflict (run_date, dataset) do update set
    mode = excluded.mode, problems = excluded.problems, result = excluded.result, checked_at = excluded.checked_at;
  return v;
end
$fn$;

-- ---------- Access ----------
alter table public.analytics_collect_daily_checks enable row level security;
revoke all on table public.analytics_collect_daily_checks from public, anon, authenticated, service_role;
grant select on table public.analytics_collect_daily_checks to service_role;

do $fns$
declare f text;
begin
  foreach f in array array[
    'public.analytics_metrics_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean)',
    'public.analytics_top_videos_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean)',
    'public.analytics_collect_daily_check(date,text)',
    'public.analytics_collect_daily_check_record(text,date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
  foreach f in array array[
    'public.analytics_collect_live_receipt(text,date,text,text,integer,integer,boolean)',
    'public.analytics_receipt_json(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
end
$fns$;

commit;

-- VERIFY
-- 1. The three source checks allow "edge" (expect 3 rows, each listing edge):
-- select conrelid::regclass, pg_get_constraintdef(oid) from pg_constraint
--  where conname in ('analytics_metrics_source_check','analytics_top_videos_source_check','analytics_ingest_receipts_source_check');
-- 2. The new table (expect rls true, policies 0, anon/authenticated all false, service_role select true,
--    insert/update/delete/truncate false):
-- select c.relname, c.relrowsecurity rls, (select count(*) from pg_policy p where p.polrelid = c.oid) policies,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated_any,
--   has_table_privilege('service_role', c.oid, 'SELECT') sr_select,
--   has_table_privilege('service_role', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') sr_write
-- from pg_class c where c.oid = 'public.analytics_collect_daily_checks'::regclass;
-- 3. Functions (expect anon_x and auth_x false everywhere; sr_x true for the four public ones,
--    false for analytics_collect_live_receipt and analytics_receipt_json):
-- select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') sr_x
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
--   ('analytics_metrics_collect_commit_live','analytics_top_videos_collect_commit_live','analytics_collect_daily_check',
--    'analytics_collect_daily_check_record','analytics_collect_live_receipt','analytics_receipt_json');
-- 4. Nothing switched on (expect both still off or shadow):
-- select key, value from public.syncview_runtime_flags where key in ('analytics_metrics_collect','analytics_top_videos_collect');
-- 5. Today's check, read only (counts; nothing is recorded by this select):
-- select public.analytics_collect_daily_check((now() at time zone 'utc')::date, 'metrics');

-- ROLLBACK (only while no "edge" row exists; first set both flags back to shadow or off):
-- select count(*) from public.analytics_metrics where source = 'edge';      -- must be 0 to restore the old checks
-- select count(*) from public.analytics_top_videos where source = 'edge';   -- must be 0
-- begin;
-- drop function if exists public.analytics_collect_daily_check_record(text,date), public.analytics_collect_daily_check(date,text),
--   public.analytics_top_videos_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean),
--   public.analytics_metrics_collect_commit_live(date,text,jsonb,jsonb,text,jsonb,boolean),
--   public.analytics_collect_live_receipt(text,date,text,text,integer,integer,boolean), public.analytics_receipt_json(text);
-- drop table if exists public.analytics_collect_daily_checks;
-- delete from public.analytics_ingest_receipts where source = 'edge';
-- alter table public.analytics_metrics drop constraint analytics_metrics_source_check,
--   add constraint analytics_metrics_source_check check (source in ('sheet-backfill', 'n8n'));
-- alter table public.analytics_top_videos drop constraint analytics_top_videos_source_check,
--   add constraint analytics_top_videos_source_check check (source in ('sheet-backfill', 'n8n'));
-- alter table public.analytics_ingest_receipts drop constraint analytics_ingest_receipts_source_check,
--   add constraint analytics_ingest_receipts_source_check check (source in ('sheet-backfill', 'sheet-copy', 'n8n'));
-- commit;
-- Rolling back the FLAG (live -> shadow) is enough to stop every write; the edge rows can stay.
