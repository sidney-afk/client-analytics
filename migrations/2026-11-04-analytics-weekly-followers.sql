-- STATE: BUILT, NOT APPLIED (Lighthouse / the supervisor applies it, then runs the merge lane if it holds).
--
-- Step 1 of the weekly client analytics snapshot: followers per client per platform per
-- week, read by the Edge Function analytics-weekly-followers.
--
--   analytics_weekly_snapshot          one row per client + platform + week (week_of is the
--                                      Monday, UTC). followers is null unless status is 'ok'.
--                                      A re-run that week updates the row, never adds one.
--   analytics_weekly_top_posts         EMPTY for now; step 2 fills it (same week key)
--   analytics_weekly_followers_queue   one row per client per week: state, attempts, lease
--   analytics_weekly_followers_claim() hands a tick the next client nobody holds
--   analytics_weekly_followers_commit() writes a client's rows and marks it done in ONE transaction
--   analytics_weekly_followers_run()   the manual run call (owner/postgres only, see below)
--   pg_cron: analytics-weekly-followers-tick (every minute, 05:00-07:59 UTC, Mondays only) and
--            analytics-weekly-followers-prune (Mondays 04:41 UTC, drops queue rows older than 60 days)
--
-- Access: RLS on with no policies, every privilege revoked from public, anon, authenticated AND
-- service_role (all four named: Supabase grants new objects to the last three by default), then
-- only what the function needs back to service_role. NO browser read of anything here.
--
-- HOW TO TELL IT IS APPLIED (merge-lane rule, docs/ops/EF_AUTO_DEPLOY.md): the line below is the
-- read the gate runs; it answers true once the tables and both functions exist.
-- ef-auto-deploy-applied-when: select to_regclass('public.analytics_weekly_snapshot') is not null and to_regclass('public.analytics_weekly_followers_queue') is not null and to_regprocedure('public.analytics_weekly_followers_claim(date,integer,integer,integer,text[])') is not null and to_regprocedure('public.analytics_weekly_followers_commit(date,text,jsonb)') is not null
--
-- The cron call is signed with the Vault secret analytics_collect_key, the same one the daily
-- collectors use (it must equal the Edge Function secret ANALYTICS_COLLECT_KEY). This file
-- refuses to run if it is missing; the value is never written in a file.
--
-- MANUAL RUN (SQL editor, as owner). Name the clients; the test client is the one to try first:
--   select public.analytics_weekly_followers_run(array['sidneylaruel']);   -- returns a request id
--   select status_code, content from net._http_response where id = <that id>;   -- {"ok":true,"results":{"done":1}}
--   select public.analytics_weekly_followers_run(null, 'status');           -- counts for this week
--   select platform, status, error_class, source, followers, recorded_at
--     from public.analytics_weekly_snapshot where week_of = date_trunc('week', now() at time zone 'utc')::date
--      and client_slug = 'sidneylaruel';
-- "results":{"waiting":1} means a provider failed transiently; the next Monday tick (or another
-- manual run) retries it. A real number or a failed row with its class: never a guess.
--
-- Rollback (statement each):
--   select cron.unschedule('analytics-weekly-followers-tick'); select cron.unschedule('analytics-weekly-followers-prune');
--   drop function public.analytics_weekly_followers_run(text[], text); drop function public.analytics_weekly_followers_commit(date, text, jsonb);
--   drop function public.analytics_weekly_followers_claim(date, integer, integer, integer, text[]);
--   drop table public.analytics_weekly_followers_queue, public.analytics_weekly_top_posts, public.analytics_weekly_snapshot;
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'analytics_collect_key' and length(decrypted_secret) >= 32) then
    raise exception 'analytics_collect_key is missing from Vault (at least 32 characters); see the header of this file';
  end if;
end
$check$;

create table if not exists public.analytics_weekly_snapshot (
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  platform    text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  week_of     date not null check (extract(isodow from week_of) = 1),
  followers   bigint check (followers is null or followers >= 0),
  status      text not null check (status in ('ok', 'not_configured', 'failed')),
  error_class text,
  source      text,
  recorded_at timestamptz not null default now(),
  primary key (client_slug, platform, week_of),
  check ((status = 'ok') = (followers is not null)),
  check ((status = 'ok') = (error_class is null))
);

create table if not exists public.analytics_weekly_top_posts (
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  week_of     date not null check (extract(isodow from week_of) = 1),
  platform    text not null check (platform in ('instagram', 'tiktok', 'youtube')),
  url         text not null,
  title       text,
  views       bigint,
  likes       bigint,
  comments    bigint,
  shares      bigint,
  posted_at   timestamptz,
  primary key (client_slug, week_of, platform, url)
);

create table if not exists public.analytics_weekly_followers_queue (
  week_of     date not null check (extract(isodow from week_of) = 1),
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  state       text not null default 'pending' check (state in ('pending', 'running', 'done')),
  attempts    integer not null default 0 check (attempts >= 0),
  lease_until timestamptz,
  stages      jsonb not null default '{}'::jsonb check (jsonb_typeof(stages) = 'object'),
  last_error  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (week_of, client_slug)
);

do $grants$
declare t text;
begin
  foreach t in array array['analytics_weekly_snapshot', 'analytics_weekly_top_posts', 'analytics_weekly_followers_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
  -- What the function needs: it reads the snapshot (status), writes the queue. The snapshot is written
  -- only through the commit function below, the top-post table by step 2's function later.
  grant select on public.analytics_weekly_snapshot to service_role;
  grant select, insert, update on public.analytics_weekly_followers_queue to service_role;
end
$grants$;

create or replace function public.analytics_weekly_followers_claim(
  p_week_of date, p_limit integer, p_lease_seconds integer, p_max_attempts integer, p_slugs text[] default null)
returns setof public.analytics_weekly_followers_queue
language sql
security definer
set search_path = public, pg_temp
as $fn$
  with c as (
    select week_of, client_slug
    from public.analytics_weekly_followers_queue
    where week_of = p_week_of
      and state in ('pending', 'running')
      and (lease_until is null or lease_until < now())
      and attempts < p_max_attempts
      and (p_slugs is null or client_slug = any (p_slugs))
    order by attempts, client_slug
    limit greatest(1, least(p_limit, 3))
    for update skip locked
  )
  update public.analytics_weekly_followers_queue q
     set state = 'running',
         attempts = q.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         updated_at = now()
    from c
   where q.week_of = c.week_of and q.client_slug = c.client_slug
  returning q.*;
$fn$;

-- All rows of a client and "done", all or nothing. A failed or not_configured re-run never replaces
-- an 'ok' row of the same week; an ok re-run always updates it.
create or replace function public.analytics_weekly_followers_commit(p_week_of date, p_client_slug text, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare r jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows_not_array'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.analytics_weekly_snapshot (client_slug, platform, week_of, followers, status, error_class, source, recorded_at)
    values (p_client_slug, r->>'platform', p_week_of, nullif(r->>'followers', '')::bigint, r->>'status',
            nullif(r->>'error_class', ''), nullif(r->>'source', ''), now())
    on conflict (client_slug, platform, week_of) do update
      set followers = excluded.followers, status = excluded.status, error_class = excluded.error_class,
          source = excluded.source, recorded_at = excluded.recorded_at
      where excluded.status = 'ok' or public.analytics_weekly_snapshot.status <> 'ok';
  end loop;
  update public.analytics_weekly_followers_queue
     set state = 'done', lease_until = null, last_error = null, updated_at = now()
   where week_of = p_week_of and client_slug = p_client_slug;
end
$fn$;

-- The manual run call. Owner only: no role below postgres can run it.
create or replace function public.analytics_weekly_followers_run(p_slugs text[], p_action text default 'run')
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-followers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := case when p_action = 'status' then '{"action":"status"}'::jsonb
                 else jsonb_build_object('action', 'run', 'slugs', to_jsonb(p_slugs)) end,
    timeout_milliseconds := 150000)
$fn$;

do $fnacl$
declare f text;
begin
  foreach f in array array[
    'public.analytics_weekly_followers_claim(date,integer,integer,integer,text[])',
    'public.analytics_weekly_followers_commit(date,text,jsonb)',
    'public.analytics_weekly_followers_run(text[],text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  grant execute on function public.analytics_weekly_followers_claim(date,integer,integer,integer,text[]) to service_role;
  grant execute on function public.analytics_weekly_followers_commit(date,text,jsonb) to service_role;
end
$fnacl$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-weekly-followers-tick', 'analytics-weekly-followers-prune');
end
$unschedule$;

-- Day-of-week 1 = Monday. 180 ticks, one client each: room for every client plus retries.
select cron.schedule('analytics-weekly-followers-tick', '* 5-7 * * 1', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-followers',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

select cron.schedule('analytics-weekly-followers-prune', '41 4 * * 1',
  $job$delete from public.analytics_weekly_followers_queue where week_of < (now() at time zone 'utc')::date - 60$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-weekly-followers%';  (two rows, active)
