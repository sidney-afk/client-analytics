-- STATE: BUILT, NOT APPLIED (Lighthouse / the supervisor applies it, AFTER 2026-11-04-analytics-weekly-followers.sql,
-- then runs the merge lane if it holds).
--
-- Step 2 of the weekly client analytics snapshot: the posts of the past 7 days per client and
-- platform, and the weekly client message built from them. Read by the Edge Function
-- analytics-weekly-posts. NOTHING here posts to Slack.
--
--   analytics_weekly_top_posts        (created by step 1, no new columns) filled by this step: one row per
--                                     client + week + platform + post url for the 7 days before week_of
--   analytics_weekly_messages         one row per client + week: the built text (null when no platform could
--                                     be read), built_at, and platform_status (what each platform answered,
--                                     for staff; the client text never mentions a failed platform)
--   analytics_weekly_posts_queue      one row per client per week: state, attempts, lease
--   analytics_weekly_posts_claim()    hands a tick the next client nobody holds
--   analytics_weekly_posts_commit()   writes a client's posts and message and marks it done in ONE transaction
--   analytics_weekly_posts_run()      the manual run call (owner/postgres only)
--   pg_cron: analytics-weekly-posts-tick (every minute, 08:00-09:59 UTC, Mondays only: after the followers
--            window 05:00-07:59) and analytics-weekly-posts-prune (Mondays 04:43 UTC, queue rows older than 60 days)
--
-- Access: RLS on with no policies, every privilege revoked from public, anon, authenticated AND service_role
-- (all four named), then only what the function needs back to service_role. NO browser read of anything here.
-- "Staff only" = server side: the messages table is readable by service_role (a later staff-facing function)
-- and by the owner in the SQL editor; no browser role can read it.
--
-- HOW TO TELL IT IS APPLIED (merge-lane rule, docs/ops/EF_AUTO_DEPLOY.md): the line below is the read the
-- gate runs; it answers true once the step-1 tables and this step's tables and functions exist.
-- ef-auto-deploy-applied-when: select to_regclass('public.analytics_weekly_snapshot') is not null and to_regclass('public.analytics_weekly_messages') is not null and to_regclass('public.analytics_weekly_posts_queue') is not null and to_regprocedure('public.analytics_weekly_posts_claim(date,integer,integer,integer,text[])') is not null and to_regprocedure('public.analytics_weekly_posts_commit(date,text,jsonb,text,jsonb)') is not null
--
-- The cron call is signed with the Vault secret analytics_collect_key (the same one step 1 and the daily
-- collectors use; it must equal the Edge Function secret ANALYTICS_COLLECT_KEY). This file refuses to run
-- if it is missing, or if step 1 is not applied; the value is never written in a file.
--
-- MANUAL RUN (SQL editor, as owner), 1 to 3 clients; the test client first. Run step 1's followers first so
-- the message has this Monday's count:
--   select public.analytics_weekly_posts_run(array['sidneylaruel']);   -- returns a request id
--   select status_code, content from net._http_response where id = <that id>;   -- {"ok":true,"results":{"done":1}}
--   select public.analytics_weekly_posts_run(null, 'status');          -- counts for this week
--   select client_slug, built_at, platform_status, text from public.analytics_weekly_messages
--    where week_of = date_trunc('week', now() at time zone 'utc')::date and client_slug = 'sidneylaruel';
-- "results":{"waiting":1} means a provider failed transiently; the next Monday tick (or another manual run)
-- retries it.
--
-- Rollback (statement each):
--   select cron.unschedule('analytics-weekly-posts-tick'); select cron.unschedule('analytics-weekly-posts-prune');
--   drop function public.analytics_weekly_posts_run(text[], text); drop function public.analytics_weekly_posts_commit(date, text, jsonb, text, jsonb);
--   drop function public.analytics_weekly_posts_claim(date, integer, integer, integer, text[]);
--   drop table public.analytics_weekly_posts_queue, public.analytics_weekly_messages;   -- top_posts belongs to step 1
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if to_regclass('public.analytics_weekly_snapshot') is null or to_regclass('public.analytics_weekly_top_posts') is null then
    raise exception 'step 1 is not applied (migrations/2026-11-04-analytics-weekly-followers.sql); apply it first';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'analytics_collect_key' and length(decrypted_secret) >= 32) then
    raise exception 'analytics_collect_key is missing from Vault (at least 32 characters); see the header of this file';
  end if;
end
$check$;

create table if not exists public.analytics_weekly_messages (
  client_slug     text not null check (client_slug ~ '^[a-z0-9&]+$'),
  week_of         date not null check (extract(isodow from week_of) = 1),
  text            text check (text is null or length(btrim(text)) > 0),
  built_at        timestamptz not null default now(),
  platform_status jsonb not null default '{}'::jsonb check (jsonb_typeof(platform_status) = 'object'),
  primary key (client_slug, week_of)
);

create table if not exists public.analytics_weekly_posts_queue (
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
  foreach t in array array['analytics_weekly_messages', 'analytics_weekly_posts_queue', 'analytics_weekly_top_posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
  -- The function reads messages (status) and writes the queue; posts and messages are written only through
  -- the commit function below.
  grant select on public.analytics_weekly_messages to service_role;
  grant select, insert, update on public.analytics_weekly_posts_queue to service_role;
end
$grants$;

create or replace function public.analytics_weekly_posts_claim(
  p_week_of date, p_limit integer, p_lease_seconds integer, p_max_attempts integer, p_slugs text[] default null)
returns setof public.analytics_weekly_posts_queue
language sql
security definer
set search_path = public, pg_temp
as $fn$
  with c as (
    select week_of, client_slug
    from public.analytics_weekly_posts_queue
    where week_of = p_week_of
      and state in ('pending', 'running')
      and (lease_until is null or lease_until < now())
      and attempts < p_max_attempts
      and (p_slugs is null or client_slug = any (p_slugs))
    order by attempts, client_slug
    limit greatest(1, least(p_limit, 3))
    for update skip locked
  )
  update public.analytics_weekly_posts_queue q
     set state = 'running',
         attempts = q.attempts + 1,
         lease_until = now() + make_interval(secs => greatest(30, least(p_lease_seconds, 600))),
         updated_at = now()
    from c
   where q.week_of = c.week_of and q.client_slug = c.client_slug
  returning q.*;
$fn$;

-- p_platforms: [{platform, status, error_class, source, posts:[{url,title,views,likes,comments,shares,posted_at}]}].
-- An ok platform REPLACES its stored posts for the week (a re-run never duplicates); a failed or
-- not_configured one leaves earlier posts alone. The message is replaced only by a text built from at
-- least as many ok platforms as the stored one, so a worse re-run never overwrites a better message.
create or replace function public.analytics_weekly_posts_commit(
  p_week_of date, p_client_slug text, p_platforms jsonb, p_text text, p_platform_status jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare r jsonb; p jsonb; old_ok integer; new_ok integer;
begin
  if jsonb_typeof(p_platforms) <> 'array' then raise exception 'platforms_not_array'; end if;
  if jsonb_typeof(p_platform_status) <> 'object' then raise exception 'status_not_object'; end if;
  for r in select * from jsonb_array_elements(p_platforms) loop
    if r->>'status' <> 'ok' then continue; end if;
    delete from public.analytics_weekly_top_posts
     where client_slug = p_client_slug and week_of = p_week_of and platform = r->>'platform';
    for p in select * from jsonb_array_elements(coalesce(r->'posts', '[]'::jsonb)) loop
      insert into public.analytics_weekly_top_posts (client_slug, week_of, platform, url, title, views, likes, comments, shares, posted_at)
      values (p_client_slug, p_week_of, r->>'platform', p->>'url', nullif(p->>'title', ''),
              nullif(p->>'views', '')::bigint, nullif(p->>'likes', '')::bigint, nullif(p->>'comments', '')::bigint,
              nullif(p->>'shares', '')::bigint, nullif(p->>'posted_at', '')::timestamptz)
      on conflict (client_slug, week_of, platform, url) do update
        set title = excluded.title, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
            shares = excluded.shares, posted_at = excluded.posted_at;
    end loop;
  end loop;

  select count(*) into new_ok from jsonb_each_text(p_platform_status) where value = 'ok';
  select count(*) into old_ok
    from public.analytics_weekly_messages m, jsonb_each_text(m.platform_status) e
   where m.client_slug = p_client_slug and m.week_of = p_week_of and m.text is not null and e.value = 'ok';
  insert into public.analytics_weekly_messages (client_slug, week_of, text, built_at, platform_status)
  values (p_client_slug, p_week_of, nullif(btrim(p_text), ''), now(), p_platform_status)
  on conflict (client_slug, week_of) do update
    set text = excluded.text, built_at = excluded.built_at, platform_status = excluded.platform_status
    where excluded.text is not null and new_ok >= coalesce(old_ok, 0);

  update public.analytics_weekly_posts_queue
     set state = 'done', lease_until = null, last_error = null, updated_at = now()
   where week_of = p_week_of and client_slug = p_client_slug;
end
$fn$;

-- The manual run call. Owner only: no role below postgres can run it.
create or replace function public.analytics_weekly_posts_run(p_slugs text[], p_action text default 'run')
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-posts',
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
    'public.analytics_weekly_posts_claim(date,integer,integer,integer,text[])',
    'public.analytics_weekly_posts_commit(date,text,jsonb,text,jsonb)',
    'public.analytics_weekly_posts_run(text[],text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  grant execute on function public.analytics_weekly_posts_claim(date,integer,integer,integer,text[]) to service_role;
  grant execute on function public.analytics_weekly_posts_commit(date,text,jsonb,text,jsonb) to service_role;
end
$fnacl$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-weekly-posts-tick', 'analytics-weekly-posts-prune');
end
$unschedule$;

-- Day-of-week 1 = Monday; 08:00-09:59 UTC, after the followers window. 120 ticks, one client each.
select cron.schedule('analytics-weekly-posts-tick', '* 8-9 * * 1', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-posts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

select cron.schedule('analytics-weekly-posts-prune', '43 4 * * 1',
  $job$delete from public.analytics_weekly_posts_queue where week_of < (now() at time zone 'utc')::date - 60$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-weekly-posts%';  (two rows, active)
