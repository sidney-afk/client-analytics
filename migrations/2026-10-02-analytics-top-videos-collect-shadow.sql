-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go).
--
-- Step 2 of moving the daily analytics jobs off n8n (docs/plans/2026-10-01-n8n-off-analytics.md,
-- section 7): the daily Top Videos job (n8n "TOP VIDEOS") in our own Edge Function. SHADOW ONLY:
-- nothing here touches analytics_top_videos (what the pages read), a Sheet or n8n. Built the same
-- way as 2026-10-01-analytics-metrics-collect-shadow.sql.
--
--   analytics_top_videos_shadow         the function's own rows per client per day (a retry replaces
--                                       the client's rows of that day; the real table keeps every run)
--   analytics_top_videos_collect_queue  one row per client per day: state, attempts, the answers of
--                                       each scraper so far, and the outcome per platform
--   analytics_top_videos_collect_claim()          hands a tick the next client nobody holds
--   analytics_top_videos_collect_commit_shadow()  replaces a client's rows of the day and marks it
--                                       done in ONE transaction
--   analytics_top_videos_shadow_compare()         the daily comparison against n8n's rows
--
-- Access: RLS on with no policies, every privilege revoked from public, anon, authenticated AND
-- service_role (all four named: Supabase grants new objects to the last three by default), then
-- only what the function needs back to service_role. No DELETE or TRUNCATE for anyone but the
-- database owner (the commit function runs as its owner, so it can replace rows).
-- Needs 2026-10-01-analytics-metrics-collect-shadow.sql applied first (analytics_close and
-- analytics_num). Idempotent. Rollback block at the bottom.
begin;

do $dep$
begin
  if to_regprocedure('public.analytics_close(text,text,numeric,numeric,numeric)') is null then
    raise exception 'apply 2026-10-01-analytics-metrics-collect-shadow.sql first (analytics_close is missing)';
  end if;
end
$dep$;

create table if not exists public.analytics_top_videos_shadow (
  run_date     date not null,
  client_slug  text not null check (client_slug ~ '^[a-z0-9&]+$'),
  row_no       integer not null check (row_no >= 1),
  client_name  text not null,
  scraped_date date not null,
  platform     text,
  period       text,
  rank         text,
  caption      text,
  video_url    text,
  views        text,
  likes        text,
  comments     text,
  shares       text,
  run_id       text not null,
  written_at   timestamptz not null default now(),
  primary key (run_date, client_slug, row_no)
);

create table if not exists public.analytics_top_videos_collect_queue (
  run_date    date not null,
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  state       text not null default 'pending' check (state in ('pending', 'running', 'done')),
  attempts    integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  stages      jsonb not null default '{}'::jsonb check (jsonb_typeof(stages) = 'object'),
  outcome     jsonb,
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (run_date, client_slug)
);

-- ---------- Access ----------
do $grants$
declare t text;
begin
  foreach t in array array['analytics_top_videos_shadow', 'analytics_top_videos_collect_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end
$grants$;

-- ---------- The queue claim ----------
create or replace function public.analytics_top_videos_collect_claim(
  p_run_date date, p_limit integer, p_lease_seconds integer, p_max_attempts integer)
returns setof public.analytics_top_videos_collect_queue
language sql
security definer
set search_path = public, pg_temp
as $fn$
  with c as (
    select run_date, client_slug
    from public.analytics_top_videos_collect_queue
    where run_date = p_run_date
      and state in ('pending', 'running')
      and (lease_until is null or lease_until < now())
      and attempts < p_max_attempts
    order by attempts, client_slug
    limit greatest(1, least(p_limit, 4))
    for update skip locked
  )
  update public.analytics_top_videos_collect_queue q
     set state = 'running',
         attempts = q.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         updated_at = now()
    from c
   where q.run_date = c.run_date and q.client_slug = c.client_slug
  returning q.*;
$fn$;

-- ---------- The commit: the client's rows of the day + done, all or nothing ----------
-- A client with no rows at all (n8n would write nothing for it) is committed with an empty list.
create or replace function public.analytics_top_videos_collect_commit_shadow(
  p_run_date date, p_client_slug text, p_rows jsonb, p_states jsonb, p_run_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  delete from public.analytics_top_videos_shadow where run_date = p_run_date and client_slug = p_client_slug;

  insert into public.analytics_top_videos_shadow (run_date, client_slug, row_no, client_name, scraped_date, platform, period,
    rank, caption, video_url, views, likes, comments, shares, run_id, written_at)
  select p_run_date, p_client_slug, x.ord::integer, x.client_name, x.scraped_date::date, x.platform, x.period,
         x.rank, x.caption, x.video_url, x.views, x.likes, x.comments, x.shares, p_run_id, now()
    from rows from (jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb))
      as (scraped_date text, client_name text, platform text, period text, rank text, caption text,
          video_url text, views text, likes text, comments text, shares text)) with ordinality as x(scraped_date, client_name, platform, period,
          rank, caption, video_url, views, likes, comments, shares, ord);

  update public.analytics_top_videos_collect_queue
     set state = 'done', lease_until = null, last_error = null, outcome = p_states, updated_at = now()
   where run_date = p_run_date and client_slug = p_client_slug;
end
$fn$;

-- ---------- The daily comparison ----------
-- n8n's rows are the ones of its newest run of that date (analytics_top_videos, one call per client).
-- Rows are matched by platform, period, video link (and the nth row when a link repeats); both jobs
-- scrape live data up to an hour apart, so views must agree within 10 percent (minimum 50), likes,
-- comments and shares within 10 percent (minimum 10). Caption and rank must be equal. A row only one
-- side has is named. A client one side did not write at all is named too.
-- Issue text: platform:period:reason (reasons: only_n8n, only_shadow, caption, rank, views, likes,
-- comments, shares) or no_n8n_rows / no_shadow_rows.
create or replace function public.analytics_top_videos_shadow_compare(p_date date default (now() at time zone 'utc')::date)
returns table (client_slug text, n8n_present boolean, shadow_present boolean, matches boolean, mismatched text[],
               n8n_rows integer, shadow_rows integer, shadow_states jsonb)
language sql stable
set search_path = public, pg_temp
as $fn$
  with newest as (
    select distinct on (t.client_slug) t.client_slug, t.run_id
    from public.analytics_top_videos t where t.scraped_date = p_date
    order by t.client_slug, t.seq desc),
  n as (
    select t.client_slug, t.platform, t.period, coalesce(t.video_url, '') as u, t.rank, t.caption, t.views, t.likes, t.comments, t.shares,
           row_number() over (partition by t.client_slug, t.platform, t.period, coalesce(t.video_url, '') order by t.rank, t.seq) as nth
    from public.analytics_top_videos t join newest w on w.client_slug = t.client_slug and w.run_id = t.run_id
    where t.scraped_date = p_date),
  s as (
    select h.client_slug, h.platform, h.period, coalesce(h.video_url, '') as u, h.rank, h.caption, h.views, h.likes, h.comments, h.shares,
           row_number() over (partition by h.client_slug, h.platform, h.period, coalesce(h.video_url, '') order by h.row_no) as nth
    from public.analytics_top_videos_shadow h where h.run_date = p_date),
  j as (
    select coalesce(n.client_slug, s.client_slug) as slug, coalesce(n.platform, s.platform) as pf, coalesce(n.period, s.period) as pe,
           n.client_slug is not null as np, s.client_slug is not null as sp,
           n.rank as nr, s.rank as sr, n.caption as nc, s.caption as sc, n.views as nv, s.views as sv,
           n.likes as nl, s.likes as sl, n.comments as nm, s.comments as sm, n.shares as nh, s.shares as sh
    from n full join s on n.client_slug = s.client_slug and n.platform is not distinct from s.platform
      and n.period is not distinct from s.period and n.u = s.u and n.nth = s.nth),
  issues as (
    select j.slug, unnest(array_remove(array[
      case when not j.sp then j.pf || ':' || j.pe || ':only_n8n' end,
      case when not j.np then j.pf || ':' || j.pe || ':only_shadow' end,
      case when j.np and j.sp and j.nc is distinct from j.sc then j.pf || ':' || j.pe || ':caption' end,
      case when j.np and j.sp and j.nr is distinct from j.sr then j.pf || ':' || j.pe || ':rank' end,
      case when j.np and j.sp and not public.analytics_close(j.nv, j.sv, 0.10, 50) then j.pf || ':' || j.pe || ':views' end,
      case when j.np and j.sp and not public.analytics_close(j.nl, j.sl, 0.10, 10) then j.pf || ':' || j.pe || ':likes' end,
      case when j.np and j.sp and not public.analytics_close(j.nm, j.sm, 0.10, 10) then j.pf || ':' || j.pe || ':comments' end,
      case when j.np and j.sp and not public.analytics_close(j.nh, j.sh, 0.10, 10) then j.pf || ':' || j.pe || ':shares' end
    ], null)) as issue
    from j),
  per as (
    select slug, coalesce(array_agg(distinct issue order by issue), '{}') as bad from issues group by slug
    union all
    select slug, '{}' from j where slug not in (select slug from issues) group by slug),
  cl as (
    select j.slug, bool_or(j.np) as np, bool_or(j.sp) as sp, count(*) filter (where j.np)::integer as nrows, count(*) filter (where j.sp)::integer as srows
    from j group by j.slug)
  select cl.slug, cl.np, cl.sp, (cl.np and cl.sp and cardinality(per.bad) = 0),
         case when not cl.np then array['no_n8n_rows'] when not cl.sp then array['no_shadow_rows'] else per.bad end,
         cl.nrows, cl.srows, (select qq.outcome from public.analytics_top_videos_collect_queue qq where qq.run_date = p_date and qq.client_slug = cl.slug)
  from cl join per on per.slug = cl.slug
  order by cl.slug;
$fn$;

do $fns$
declare f text;
begin
  foreach f in array array[
    'public.analytics_top_videos_collect_claim(date,integer,integer,integer)',
    'public.analytics_top_videos_collect_commit_shadow(date,text,jsonb,jsonb,text)',
    'public.analytics_top_videos_shadow_compare(date)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$fns$;

-- ---------- Default-off switch ----------
insert into public.syncview_runtime_flags (key, value, updated_by) values
  ('analytics_top_videos_collect', '{"mode": "off"}'::jsonb, 'migration:2026-10-02-analytics-top-videos-collect-shadow')
on conflict (key) do nothing;

commit;

-- VERIFY (expect rls true, policies 0, anon/authenticated all false, service_role
-- select/insert/update true and delete/truncate false; functions: only service_role may execute):
-- select c.relname, c.relrowsecurity rls,
--   (select count(*) from pg_policy p where p.polrelid = c.oid) policies,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated_any,
--   has_table_privilege('service_role', c.oid, 'DELETE') sr_delete
-- from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in
--   ('analytics_top_videos_shadow','analytics_top_videos_collect_queue');
-- select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') sr_x
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_top\_videos\_%';

-- ROLLBACK (shadow data only; nothing the pages read is involved):
-- begin;
-- drop function if exists public.analytics_top_videos_shadow_compare(date),
--   public.analytics_top_videos_collect_commit_shadow(date,text,jsonb,jsonb,text),
--   public.analytics_top_videos_collect_claim(date,integer,integer,integer);
-- drop table if exists public.analytics_top_videos_collect_queue, public.analytics_top_videos_shadow;
-- delete from public.syncview_runtime_flags where key = 'analytics_top_videos_collect';
-- commit;
