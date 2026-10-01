-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go).
--
-- Step 1 of moving the daily metrics job (n8n "CLIENTS METRICS") into our own
-- Edge Function, docs/plans/2026-10-01-n8n-off-analytics.md. SHADOW ONLY:
-- nothing here touches analytics_metrics (what the pages read), a Sheet or n8n.
--
--   analytics_metrics_shadow         the function's own metrics row per client per
--                                    day (one row, overwritten on a retry; the real
--                                    table keeps every row, this one is for comparing)
--   analytics_post_tracking          per-post "yesterday / today" views, the state the
--                                    daily gains are computed from (n8n keeps it in
--                                    the PostTracking tab). Seeded once from that tab.
--   analytics_metrics_collect_queue  one row per client per day: state, attempts, and
--                                    the answers of each scraper so far
--   analytics_metrics_collect_claim()   hands a tick the next client nobody holds
--   analytics_metrics_collect_commit_shadow()  writes a client's row and its post
--                                    tracking in ONE transaction and marks it done
--   analytics_num(), analytics_metrics_shadow_compare()  the daily comparison
--
-- Access: RLS on with no policies, every privilege revoked from public, anon,
-- authenticated AND service_role (all four named: Supabase grants new objects to
-- the last three by default), then only what the function needs back to
-- service_role. No DELETE or TRUNCATE for anyone but the database owner.
-- Idempotent. Rollback block at the bottom.
begin;

create table if not exists public.analytics_metrics_shadow (
  run_date                   date not null,
  client_slug                text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name                text not null,
  date                       date not null,
  ig_followers               text,
  ig_avg_views               text,
  ig_avg_likes               text,
  tiktok_followers           text,
  tiktok_avg_plays           text,
  yt_subscribers             text,
  yt_total_views             text,
  ig_views_gained_today      text,
  tiktok_plays_gained_today  text,
  ig_views_this_month        text,
  tiktok_plays_this_month    text,
  yt_views_gained_today      text,
  yt_shorts_views            text,
  yt_longs_views             text,
  analytics_receipt          text,
  run_id                     text not null,
  written_at                 timestamptz not null default now(),
  primary key (run_date, client_slug)
);

create table if not exists public.analytics_post_tracking (
  post_id            text primary key check (length(post_id) between 1 and 600),
  client_slug        text not null check (client_slug ~ '^[a-z0-9&]+$'),
  client_name        text not null,
  platform           text not null check (platform in ('instagram', 'tiktok')),
  first_seen_date    text not null,
  views_yesterday    bigint not null default 0,
  views_today        bigint not null default 0,
  views_gained_today bigint not null default 0,
  updated_at         timestamptz not null default now()
);
create index if not exists analytics_post_tracking_client_idx on public.analytics_post_tracking (client_slug);

create table if not exists public.analytics_metrics_collect_queue (
  run_date    date not null,
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  state       text not null default 'pending' check (state in ('pending', 'running', 'done')),
  attempts    integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  stages      jsonb not null default '{}'::jsonb check (jsonb_typeof(stages) = 'object'),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (run_date, client_slug)
);

-- ---------- Access ----------
do $grants$
declare t text;
begin
  foreach t in array array['analytics_metrics_shadow', 'analytics_post_tracking', 'analytics_metrics_collect_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end
$grants$;

-- ---------- The queue claim ----------
-- Gives a tick the next clients nobody holds a lease on. Fewest attempts first,
-- so a client still waiting on a slow scraper is revisited after every other
-- client has had its first turn.
create or replace function public.analytics_metrics_collect_claim(
  p_run_date date, p_limit integer, p_lease_seconds integer, p_max_attempts integer)
returns setof public.analytics_metrics_collect_queue
language sql
security definer
set search_path = public, pg_temp
as $fn$
  with c as (
    select run_date, client_slug
    from public.analytics_metrics_collect_queue
    where run_date = p_run_date
      and state in ('pending', 'running')
      and (lease_until is null or lease_until < now())
      and attempts < p_max_attempts
    order by attempts, client_slug
    limit greatest(1, least(p_limit, 4))
    for update skip locked
  )
  update public.analytics_metrics_collect_queue q
     set state = 'running',
         attempts = q.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         updated_at = now()
    from c
   where q.run_date = c.run_date and q.client_slug = c.client_slug
  returning q.*;
$fn$;

-- ---------- The commit: row + post tracking + done, all or nothing ----------
create or replace function public.analytics_metrics_collect_commit_shadow(
  p_run_date date, p_client_slug text, p_row jsonb, p_posts jsonb, p_run_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  insert into public.analytics_metrics_shadow (
    run_date, client_slug, client_name, date, ig_followers, ig_avg_views, ig_avg_likes, tiktok_followers,
    tiktok_avg_plays, yt_subscribers, yt_total_views, ig_views_gained_today, tiktok_plays_gained_today,
    ig_views_this_month, tiktok_plays_this_month, yt_views_gained_today, yt_shorts_views, yt_longs_views,
    analytics_receipt, run_id, written_at)
  values (
    p_run_date, p_client_slug, p_row->>'client_name', (p_row->>'date')::date, p_row->>'ig_followers',
    p_row->>'ig_avg_views', p_row->>'ig_avg_likes', p_row->>'tiktok_followers', p_row->>'tiktok_avg_plays',
    p_row->>'yt_subscribers', p_row->>'yt_total_views', p_row->>'ig_views_gained_today',
    p_row->>'tiktok_plays_gained_today', p_row->>'ig_views_this_month', p_row->>'tiktok_plays_this_month',
    p_row->>'yt_views_gained_today', p_row->>'yt_shorts_views', p_row->>'yt_longs_views',
    p_row->>'analytics_receipt', p_run_id, now())
  on conflict (run_date, client_slug) do update set
    client_name = excluded.client_name, date = excluded.date, ig_followers = excluded.ig_followers,
    ig_avg_views = excluded.ig_avg_views, ig_avg_likes = excluded.ig_avg_likes,
    tiktok_followers = excluded.tiktok_followers, tiktok_avg_plays = excluded.tiktok_avg_plays,
    yt_subscribers = excluded.yt_subscribers, yt_total_views = excluded.yt_total_views,
    ig_views_gained_today = excluded.ig_views_gained_today,
    tiktok_plays_gained_today = excluded.tiktok_plays_gained_today,
    ig_views_this_month = excluded.ig_views_this_month, tiktok_plays_this_month = excluded.tiktok_plays_this_month,
    yt_views_gained_today = excluded.yt_views_gained_today, yt_shorts_views = excluded.yt_shorts_views,
    yt_longs_views = excluded.yt_longs_views, analytics_receipt = excluded.analytics_receipt,
    run_id = excluded.run_id, written_at = excluded.written_at;

  -- Like the PostTracking tab's append-or-update on post_id: a post present in
  -- today's scrape is updated (its first_seen_date is kept), others stay as they are.
  -- A post listed twice in one scrape: the last one wins.
  insert into public.analytics_post_tracking (post_id, client_slug, client_name, platform, first_seen_date,
    views_yesterday, views_today, views_gained_today, updated_at)
  select distinct on (x.post_id) x.post_id, p_client_slug, x.client_name, x.platform, x.first_seen_date,
         coalesce(x.views_yesterday, 0), coalesce(x.views_today, 0), coalesce(x.views_gained_today, 0), now()
    from rows from (jsonb_to_recordset(coalesce(p_posts, '[]'::jsonb))
      as (post_id text, client_name text, platform text, first_seen_date text,
          views_yesterday bigint, views_today bigint, views_gained_today bigint)) with ordinality as x
   order by x.post_id, x.ordinality desc
  on conflict (post_id) do update set
    client_name = excluded.client_name, platform = excluded.platform,
    views_yesterday = excluded.views_yesterday, views_today = excluded.views_today,
    views_gained_today = excluded.views_gained_today, updated_at = now();

  update public.analytics_metrics_collect_queue
     set state = 'done', lease_until = null, last_error = null, updated_at = now()
   where run_date = p_run_date and client_slug = p_client_slug;
end
$fn$;

-- ---------- The daily comparison ----------
create or replace function public.analytics_num(t text)
returns numeric
language sql immutable
as $fn$ select case when t ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then t::numeric else null end $fn$;

-- Two numbers (as text) agree: within max(abs_tol, rel_tol * larger), where an
-- optional basis replaces "larger" (for the cumulative counters). Both empty,
-- or the same text, agree. One empty and one not does not.
create or replace function public.analytics_close(a text, b text, rel_tol numeric, abs_tol numeric, basis numeric default null)
returns boolean
language sql immutable
as $fn$
  select case
    when coalesce(a, '') = coalesce(b, '') then true
    when public.analytics_num(a) is null or public.analytics_num(b) is null then false
    else abs(public.analytics_num(a) - public.analytics_num(b))
         <= greatest(abs_tol, rel_tol * coalesce(basis, greatest(abs(public.analytics_num(a)), abs(public.analytics_num(b)))))
  end
$fn$;

create or replace function public.analytics_receipt_states(r text)
returns text
language plpgsql immutable
as $fn$
declare j jsonb;
begin
  begin j := r::jsonb; exception when others then return null; end;
  return concat_ws('|', j->>'result', j#>>'{platforms,instagram,state}', j#>>'{platforms,tiktok,state}', j#>>'{platforms,youtube,state}');
end
$fn$;

-- One row per client for a day. n8n's value is the LAST row it stored that day
-- (the page keeps the last row per date too). "Within tolerance" because both
-- scrape live data a few minutes apart: followers 0.5 percent (min 5), averages
-- 10 percent (min 50), YouTube totals 0.5 percent (min 500), gains 10 percent
-- (min 500), the cumulative "this month" counters by the gain tolerance of the
-- day, YouTube shorts and longs 1 percent (min 100) or the same empty text,
-- and the per-platform receipt states must be equal.
create or replace function public.analytics_metrics_shadow_compare(p_date date default (now() at time zone 'utc')::date)
returns table (client_slug text, n8n_present boolean, shadow_present boolean, matches boolean, mismatched text[], n8n jsonb, shadow jsonb)
language sql stable
set search_path = public, pg_temp
as $fn$
  with n as (
    select distinct on (m.client_slug) m.* from public.analytics_metrics m where m.date = p_date
    order by m.client_slug, m.seq desc),
  s as (select * from public.analytics_metrics_shadow where run_date = p_date),
  j as (
    select coalesce(n.client_slug, s.client_slug) as slug, n.client_slug is not null as np, s.client_slug is not null as sp,
           to_jsonb(n) as nj, to_jsonb(s) as sj
    from n full join s on s.client_slug = n.client_slug),
  c as (
    select j.*,
      array_remove(array[
        case when np and sp and not public.analytics_close(nj->>'ig_followers', sj->>'ig_followers', 0.005, 5) then 'ig_followers' end,
        case when np and sp and not public.analytics_close(nj->>'tiktok_followers', sj->>'tiktok_followers', 0.005, 5) then 'tiktok_followers' end,
        case when np and sp and not public.analytics_close(nj->>'yt_subscribers', sj->>'yt_subscribers', 0.005, 5) then 'yt_subscribers' end,
        case when np and sp and not public.analytics_close(nj->>'ig_avg_views', sj->>'ig_avg_views', 0.10, 50) then 'ig_avg_views' end,
        case when np and sp and not public.analytics_close(nj->>'ig_avg_likes', sj->>'ig_avg_likes', 0.10, 50) then 'ig_avg_likes' end,
        case when np and sp and not public.analytics_close(nj->>'tiktok_avg_plays', sj->>'tiktok_avg_plays', 0.10, 50) then 'tiktok_avg_plays' end,
        case when np and sp and not public.analytics_close(nj->>'yt_total_views', sj->>'yt_total_views', 0.005, 500) then 'yt_total_views' end,
        case when np and sp and not public.analytics_close(nj->>'ig_views_gained_today', sj->>'ig_views_gained_today', 0.10, 500) then 'ig_views_gained_today' end,
        case when np and sp and not public.analytics_close(nj->>'tiktok_plays_gained_today', sj->>'tiktok_plays_gained_today', 0.10, 500) then 'tiktok_plays_gained_today' end,
        case when np and sp and not public.analytics_close(nj->>'yt_views_gained_today', sj->>'yt_views_gained_today', 0.10, 500) then 'yt_views_gained_today' end,
        case when np and sp and not public.analytics_close(nj->>'ig_views_this_month', sj->>'ig_views_this_month',
          0.10, 500, greatest(public.analytics_num(nj->>'ig_views_gained_today'), public.analytics_num(sj->>'ig_views_gained_today'))) then 'ig_views_this_month' end,
        case when np and sp and not public.analytics_close(nj->>'tiktok_plays_this_month', sj->>'tiktok_plays_this_month',
          0.10, 500, greatest(public.analytics_num(nj->>'tiktok_plays_gained_today'), public.analytics_num(sj->>'tiktok_plays_gained_today'))) then 'tiktok_plays_this_month' end,
        case when np and sp and not public.analytics_close(nj->>'yt_shorts_views', sj->>'yt_shorts_views', 0.01, 100) then 'yt_shorts_views' end,
        case when np and sp and not public.analytics_close(nj->>'yt_longs_views', sj->>'yt_longs_views', 0.01, 100) then 'yt_longs_views' end,
        case when np and sp and public.analytics_receipt_states(nj->>'analytics_receipt') is distinct from public.analytics_receipt_states(sj->>'analytics_receipt') then 'receipt_states' end
      ], null) as bad
    from j)
  select c.slug, c.np, c.sp, (c.np and c.sp and cardinality(c.bad) = 0),
         case when not c.np then array['no_n8n_row'] when not c.sp then array['no_shadow_row'] else c.bad end,
         c.nj - 'analytics_receipt' - 'extra', c.sj - 'analytics_receipt'
  from c order by c.slug;
$fn$;

do $fns$
declare f text;
begin
  foreach f in array array[
    'public.analytics_metrics_collect_claim(date,integer,integer,integer)',
    'public.analytics_metrics_collect_commit_shadow(date,text,jsonb,jsonb,text)',
    'public.analytics_metrics_shadow_compare(date)',
    'public.analytics_num(text)',
    'public.analytics_close(text,text,numeric,numeric,numeric)',
    'public.analytics_receipt_states(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$fns$;

-- ---------- Default-off switch ----------
insert into public.syncview_runtime_flags (key, value, updated_by) values
  ('analytics_metrics_collect', '{"mode": "off"}'::jsonb, 'migration:2026-10-01-analytics-metrics-collect-shadow')
on conflict (key) do nothing;

commit;

-- VERIFY (expect rls true, policies 0, anon/authenticated all false, service_role
-- select/insert/update true and delete/truncate false; functions: only service_role
-- may execute):
-- select c.relname, c.relrowsecurity rls,
--   (select count(*) from pg_policy p where p.polrelid = c.oid) policies,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated_any,
--   has_table_privilege('service_role', c.oid, 'DELETE') sr_delete
-- from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
--   ('analytics_metrics_shadow','analytics_post_tracking','analytics_metrics_collect_queue');
-- select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') sr_x
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'analytics\_metrics\_%' or p.proname in ('analytics_close','analytics_num','analytics_receipt_states'));

-- ROLLBACK (shadow data only; nothing the pages read is involved):
-- begin;
-- drop function if exists public.analytics_metrics_shadow_compare(date), public.analytics_close(text,text,numeric,numeric,numeric),
--   public.analytics_receipt_states(text), public.analytics_num(text),
--   public.analytics_metrics_collect_commit_shadow(date,text,jsonb,jsonb,text),
--   public.analytics_metrics_collect_claim(date,integer,integer,integer);
-- drop table if exists public.analytics_metrics_collect_queue, public.analytics_post_tracking, public.analytics_metrics_shadow;
-- delete from public.syncview_runtime_flags where key = 'analytics_metrics_collect';
-- commit;
