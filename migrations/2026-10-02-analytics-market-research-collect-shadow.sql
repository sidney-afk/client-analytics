-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go).
--
-- Step 3 of moving the analytics jobs off n8n (docs/plans/2026-10-01-n8n-off-analytics.md, section 7):
-- the Market Research brief job (n8n "MARKET RESEARCH", branch generate-market-brief) in our own Edge
-- Function. SHADOW ONLY: nothing here touches analytics_market_research_briefs (what the pages read),
-- a Sheet or n8n. Built the same way as the metrics and Top Videos shadow migrations.
--
-- Unlike those two, this job is not daily: n8n builds a brief only when someone calls its webhook (the last
-- one was in June). So the queue holds REQUESTS (one row per brief asked for, inserted by hand with SQL, see
-- scripts/analytics-market-research-request.js), and the comparison matches a shadow brief with the n8n brief
-- of the same client within a day.
--
--   analytics_market_research_collect_queue  one row per requested brief: keywords, state, attempts, the
--                                       answers of each stage so far (scrapes, transcripts, the Claude batch)
--   analytics_market_research_shadow    the finished brief, cut into the same pieces n8n stores (raw_json,
--                                       raw_json_2, raw_json_3)
--   analytics_market_research_collect_claim()          hands a tick the next request nobody holds
--   analytics_market_research_collect_commit_shadow()  stores the brief and marks the request done, one transaction
--   analytics_try_jsonb(), analytics_mr_brief_stats(), analytics_market_research_shadow_compare()  the comparison
--
-- Access: RLS on with no policies, every privilege revoked from public, anon, authenticated AND
-- service_role (all four named: Supabase grants new objects to the last three by default), then
-- only what the function needs back to service_role. No DELETE or TRUNCATE for anyone but the
-- database owner. Needs 2026-10-01-analytics-metrics-collect-shadow.sql applied first (analytics_close).
-- Idempotent. Rollback block at the bottom.
begin;

do $dep$
begin
  if to_regprocedure('public.analytics_close(text,text,numeric,numeric,numeric)') is null then
    raise exception 'apply 2026-10-01-analytics-metrics-collect-shadow.sql first (analytics_close is missing)';
  end if;
end
$dep$;

create table if not exists public.analytics_market_research_collect_queue (
  id           uuid primary key default gen_random_uuid(),
  client_slug  text not null check (client_slug ~ '^[a-z0-9&]+$'),
  keywords     jsonb not null check (jsonb_typeof(keywords) = 'array' and jsonb_array_length(keywords) between 1 and 10),
  state        text not null default 'pending' check (state in ('pending', 'running', 'done', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  started_at   timestamptz,
  lease_until  timestamptz,
  stages       jsonb not null default '{}'::jsonb check (jsonb_typeof(stages) = 'object'),
  outcome      jsonb,
  last_error   text,
  requested_by text not null default 'sql' check (length(requested_by) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists analytics_mr_queue_open_idx on public.analytics_market_research_collect_queue (created_at)
  where state in ('pending', 'running');

create table if not exists public.analytics_market_research_shadow (
  queue_id    uuid primary key references public.analytics_market_research_collect_queue (id),
  run_date    date not null,
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  id          text not null,
  client_name text,
  date        text,
  raw_json    text,
  raw_json_2  text,
  raw_json_3  text,
  model       text,
  run_id      text not null,
  written_at  timestamptz not null default now()
);
create index if not exists analytics_mr_shadow_day_idx on public.analytics_market_research_shadow (run_date, client_slug);

-- ---------- Access ----------
do $grants$
declare t text;
begin
  foreach t in array array['analytics_market_research_collect_queue', 'analytics_market_research_shadow'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select, insert, update on table public.%I to service_role', t);
  end loop;
end
$grants$;

-- ---------- The queue claim ----------
-- One request at a time. Requests that have not started wait while p_max_new_per_day requests have already
-- started today (UTC): a spending cap, because one brief costs real Apify, Whisper and Claude money. A request
-- that has started is always continued. Out of attempts means failed.
create or replace function public.analytics_market_research_collect_claim(
  p_lease_seconds integer, p_max_attempts integer, p_max_new_per_day integer)
returns setof public.analytics_market_research_collect_queue
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
begin
  update public.analytics_market_research_collect_queue
     set state = 'failed', last_error = 'attempts_exhausted', lease_until = null, updated_at = now()
   where state in ('pending', 'running') and attempts >= p_max_attempts;

  return query
  with c as (
    select q.id
    from public.analytics_market_research_collect_queue q
    where q.state in ('pending', 'running')
      and (q.lease_until is null or q.lease_until < now())
      and (q.started_at is not null
           or (select count(*) from public.analytics_market_research_collect_queue s
                where (s.started_at at time zone 'utc')::date = (now() at time zone 'utc')::date) < p_max_new_per_day)
    order by (q.started_at is null), q.created_at
    limit 1
    for update skip locked
  )
  update public.analytics_market_research_collect_queue u
     set state = 'running',
         attempts = u.attempts + 1,
         started_at = coalesce(u.started_at, now()),
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         updated_at = now()
    from c
   where u.id = c.id
  returning u.*;
end
$fn$;

-- ---------- The commit: the brief + done, all or nothing ----------
create or replace function public.analytics_market_research_collect_commit_shadow(
  p_id uuid, p_row jsonb, p_outcome jsonb, p_run_id text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare v_slug text;
begin
  select client_slug into v_slug from public.analytics_market_research_collect_queue where id = p_id;
  if v_slug is null then raise exception 'unknown request'; end if;

  insert into public.analytics_market_research_shadow (queue_id, run_date, client_slug, id, client_name, date,
    raw_json, raw_json_2, raw_json_3, model, run_id, written_at)
  values (p_id, (now() at time zone 'utc')::date, v_slug, p_row->>'id', p_row->>'client_name', p_row->>'date',
    p_row->>'raw_json', p_row->>'raw_json_2', p_row->>'raw_json_3', p_outcome->>'model', p_run_id, now())
  on conflict (queue_id) do update set
    run_date = excluded.run_date, id = excluded.id, client_name = excluded.client_name, date = excluded.date,
    raw_json = excluded.raw_json, raw_json_2 = excluded.raw_json_2, raw_json_3 = excluded.raw_json_3,
    model = excluded.model, run_id = excluded.run_id, written_at = excluded.written_at;

  update public.analytics_market_research_collect_queue
     set state = 'done', lease_until = null, last_error = null, outcome = p_outcome,
         stages = jsonb_build_object('finished', true), updated_at = now()
   where id = p_id;
end
$fn$;

-- ---------- The comparison ----------
create or replace function public.analytics_try_jsonb(t text)
returns jsonb
language plpgsql immutable
as $fn$
begin
  if t is null or btrim(t) = '' then return null; end if;
  return t::jsonb;
exception when others then
  return null;
end
$fn$;

-- The numbers a brief is judged by: how many reels, how many transcribed, how many entries in each section,
-- the keywords it was built for and the links of its sources.
create or replace function public.analytics_mr_brief_stats(p_raw text)
returns jsonb
language plpgsql immutable
as $fn$
declare j jsonb := public.analytics_try_jsonb(p_raw);
begin
  if j is null or jsonb_typeof(j) <> 'object' then return jsonb_build_object('valid', false); end if;
  return jsonb_build_object(
    'valid', true,
    'keywords', coalesce((select jsonb_agg(k order by k) from jsonb_array_elements_text(case when jsonb_typeof(j->'keywords') = 'array' then j->'keywords' else '[]'::jsonb end) k), '[]'::jsonb),
    'totalReels', j->>'totalReels',
    'transcribedCount', j->>'transcribedCount',
    'landscape', case when jsonb_typeof(j->'landscapeAnalysis') = 'array' then jsonb_array_length(j->'landscapeAnalysis') else 0 end,
    'topics', case when jsonb_typeof(j->'topicClusters') = 'array' then jsonb_array_length(j->'topicClusters') else 0 end,
    'hooks', case when jsonb_typeof(j->'hookAnalysis') = 'array' then jsonb_array_length(j->'hookAnalysis') else 0 end,
    'angles', case when jsonb_typeof(j->'filmingAngles') = 'array' then jsonb_array_length(j->'filmingAngles') else 0 end,
    'gap', case when jsonb_typeof(j->'theGap') = 'array' then jsonb_array_length(j->'theGap') else 0 end,
    'sources', coalesce((select jsonb_agg(distinct s->>'url') from jsonb_array_elements(case when jsonb_typeof(j->'sources') = 'array' then j->'sources' else '[]'::jsonb end) s where s->>'url' is not null), '[]'::jsonb));
end
$fn$;

-- One row per shadow brief of a day (the day the function wrote it), matched with the newest n8n brief of the
-- same client dated within a day of it. Both are written by a language model from live scrapes, so the text is
-- never compared; the numbers are: keywords equal, reels within 15 percent (minimum 10), transcribed within
-- 30 percent (minimum 5), the fixed sections (landscape, topic clusters, filming angles, the gap) the same
-- count, hook entries within 50 percent (minimum 3), at least half of the shorter source list in common.
-- The brief n8n writes reaches analytics_market_research_briefs through the daily Sheet copy, up to a day late.
-- Most days no n8n brief exists for the client: that reads no_n8n_brief and is expected unless someone also ran
-- n8n for that client.
create or replace function public.analytics_market_research_shadow_compare(p_date date default (now() at time zone 'utc')::date)
returns table (queue_id uuid, client_slug text, n8n_present boolean, shadow_present boolean, matches boolean, mismatched text[],
               n8n_stats jsonb, shadow_stats jsonb, outcome jsonb)
language sql stable
set search_path = public, pg_temp
as $fn$
  with s as (
    select h.queue_id, h.client_slug, public.analytics_mr_brief_stats(h.raw_json || coalesce(h.raw_json_2, '') || coalesce(h.raw_json_3, '')) as st
    from public.analytics_market_research_shadow h where h.run_date = p_date),
  n as (
    select distinct on (s.queue_id) s.queue_id, public.analytics_mr_brief_stats(b.raw_json || coalesce(b.raw_json_2, '') || coalesce(b.raw_json_3, '')) as st
    from s join public.analytics_market_research_briefs b on b.client_slug = s.client_slug
      and b.date between (p_date - 1)::text and (p_date + 1)::text
    order by s.queue_id, b.id desc),
  j as (
    select s.queue_id, s.client_slug, n.queue_id is not null as np, s.st as ss, n.st as ns,
      (select count(*) from jsonb_array_elements_text(s.st->'sources') x where n.st is not null and (n.st->'sources') ? x) as shared,
      jsonb_array_length(coalesce(s.st->'sources', '[]'::jsonb)) as s_n, jsonb_array_length(coalesce(n.st->'sources', '[]'::jsonb)) as n_n
    from s left join n on n.queue_id = s.queue_id),
  c as (
    select j.*, array_remove(array[
      case when not (j.ss->>'valid')::boolean then 'shadow_json_invalid' end,
      case when not (j.ns->>'valid')::boolean then 'n8n_json_invalid' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and j.ss->'keywords' is distinct from j.ns->'keywords' then 'keywords' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and not public.analytics_close(j.ns->>'totalReels', j.ss->>'totalReels', 0.15, 10) then 'totalReels' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and not public.analytics_close(j.ns->>'transcribedCount', j.ss->>'transcribedCount', 0.30, 5) then 'transcribedCount' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and (j.ss->>'landscape') is distinct from (j.ns->>'landscape') then 'landscape_count' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and (j.ss->>'topics') is distinct from (j.ns->>'topics') then 'topic_cluster_count' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and (j.ss->>'angles') is distinct from (j.ns->>'angles') then 'filming_angle_count' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and (j.ss->>'gap') is distinct from (j.ns->>'gap') then 'gap_count' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and not public.analytics_close(j.ns->>'hooks', j.ss->>'hooks', 0.50, 3) then 'hook_count' end,
      case when (j.ss->>'valid')::boolean and (j.ns->>'valid')::boolean and least(j.s_n, j.n_n) > 0 and j.shared < 0.5 * least(j.s_n, j.n_n) then 'sources_overlap' end
    ], null) as bad
    from j)
  select c.queue_id, c.client_slug, c.np, true, (c.np and cardinality(c.bad) = 0),
    case when not c.np then array['no_n8n_brief'] else c.bad end,
    c.ns, c.ss, (select qq.outcome from public.analytics_market_research_collect_queue qq where qq.id = c.queue_id)
  from c order by c.client_slug, c.queue_id;
$fn$;

do $fns$
declare f text;
begin
  foreach f in array array[
    'public.analytics_market_research_collect_claim(integer,integer,integer)',
    'public.analytics_market_research_collect_commit_shadow(uuid,jsonb,jsonb,text)',
    'public.analytics_market_research_shadow_compare(date)',
    'public.analytics_mr_brief_stats(text)',
    'public.analytics_try_jsonb(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$fns$;

-- ---------- Default-off switch ----------
insert into public.syncview_runtime_flags (key, value, updated_by) values
  ('analytics_market_research_collect', '{"mode": "off"}'::jsonb, 'migration:2026-10-02-analytics-market-research-collect-shadow')
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
--   ('analytics_market_research_collect_queue','analytics_market_research_shadow');
-- select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') anon_x,
--   has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_x,
--   has_function_privilege('service_role', p.oid, 'EXECUTE') sr_x
-- from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'analytics\_market\_research\_%' or p.proname in ('analytics_mr_brief_stats','analytics_try_jsonb'));

-- ROLLBACK (shadow data only; nothing the pages read is involved):
-- begin;
-- drop function if exists public.analytics_market_research_shadow_compare(date), public.analytics_mr_brief_stats(text),
--   public.analytics_try_jsonb(text), public.analytics_market_research_collect_commit_shadow(uuid,jsonb,jsonb,text),
--   public.analytics_market_research_collect_claim(integer,integer,integer);
-- drop table if exists public.analytics_market_research_shadow, public.analytics_market_research_collect_queue;
-- delete from public.syncview_runtime_flags where key = 'analytics_market_research_collect';
-- commit;
