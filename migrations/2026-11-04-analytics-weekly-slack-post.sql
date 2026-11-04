-- STATE: BUILT, NOT APPLIED (Lighthouse / the supervisor applies it, AFTER 2026-11-04-analytics-weekly-posts.sql,
-- then runs the merge lane if it holds).
--
-- Step 3 of the weekly client analytics snapshot: the SyncView bot posts each client's built weekly
-- message (analytics_weekly_messages) in that client's PRIVATE Slack channel, tagging the client the same
-- way the "Notify client" button does. Read by the Edge Function analytics-weekly-slack-post.
--
-- OFF BY DEFAULT. The switch is the runtime flag analytics_weekly_slack_post (syncview_runtime_flags):
--     {"mode":"off"}          nothing posts (what this file inserts)
--     {"mode":"allow_list"}   only clients named in analytics_weekly_slack_allow
--     {"mode":"all"}          every client with a built message and a private channel
-- Anything else, a missing row or a failed read counts as off. The flag table is readable by the browser
-- keys, so the flag holds the mode only; the client names live in the private allow table.
-- Turn it on for the test client first:
--     insert into public.analytics_weekly_slack_allow (client_slug, added_by) values ('sidneylaruel', 'owner');
--     update public.syncview_runtime_flags set value = '{"mode":"allow_list"}', updated_by = 'owner' where key = 'analytics_weekly_slack_post';
-- Then widen the allow table, then set {"mode":"all"}. Back to off: set {"mode":"off"}.
--
--   analytics_weekly_slack_allow    client_slug list for mode allow_list
--   analytics_weekly_slack_posts    one row per client + week: status pending | sent | failed | skipped | unknown,
--                                   the Slack message ts when sent, an error class otherwise, attempts. This is
--                                   also the status table: a failed or skipped post is read here.
--   analytics_weekly_slack_claim()  hands a tick ONE client whose message is built and not yet posted. A client
--                                   with a row that is pending, sent or unknown is never handed out again
--                                   (unknown = Slack did not confirm; it may be in the channel, so it is never
--                                   re-posted by a timer). failed and skipped rows are retried at most 3 times,
--                                   5 minutes apart. A pending row older than 10 minutes becomes unknown.
--   analytics_weekly_slack_finish() records the outcome
--   analytics_weekly_slack_run()    the manual run call (owner/postgres only)
--   pg_cron: analytics-weekly-slack-tick (every minute, 15:00-16:59 UTC, Mondays only: well after the posts
--            window 08:00-09:59, so the messages are built) and analytics-weekly-slack-prune (Mondays 04:47 UTC)
--
-- Access: RLS on with no policies, every privilege revoked from public, anon, authenticated AND service_role
-- (all four named), then only what the function needs back to service_role. NO browser read of anything here.
--
-- HOW TO TELL IT IS APPLIED (merge-lane rule, docs/ops/EF_AUTO_DEPLOY.md): the line below is the read the
-- gate runs; it answers true once the tables, both functions and the switch row exist.
-- ef-auto-deploy-applied-when: select to_regclass('public.analytics_weekly_messages') is not null and to_regclass('public.analytics_weekly_slack_posts') is not null and to_regclass('public.analytics_weekly_slack_allow') is not null and to_regprocedure('public.analytics_weekly_slack_claim(date,text,text[],boolean)') is not null and to_regprocedure('public.analytics_weekly_slack_finish(date,text,text,text,text)') is not null and exists (select 1 from public.syncview_runtime_flags where key = 'analytics_weekly_slack_post')
--
-- The cron call is signed with the Vault secret analytics_collect_key (same as steps 1 and 2). This file
-- refuses to run if it is missing, or if step 2 is not applied.
--
-- MANUAL RUN (SQL editor, as owner), 1 to 3 clients. It obeys the switch and the allow-list exactly like the timer:
--   select public.analytics_weekly_slack_run(array['sidneylaruel']);   -- returns a request id
--   select status_code, content from net._http_response where id = <that id>;   -- {"ok":true,"mode":"allow_list","results":{"sent":1}}
--   select public.analytics_weekly_slack_run(null, 'status');          -- counts for this week by status
--   select status, error_class, attempts, slack_ts from public.analytics_weekly_slack_posts
--    where week_of = date_trunc('week', now() at time zone 'utc')::date and client_slug = 'sidneylaruel';
-- A manual run on named clients also lets a failed or skipped post start over (attempts reset); it never
-- re-posts a sent, pending or unknown one.
--
-- Rollback (statement each):
--   update public.syncview_runtime_flags set value = '{"mode":"off"}' where key = 'analytics_weekly_slack_post';   -- stop posting first
--   select cron.unschedule('analytics-weekly-slack-tick'); select cron.unschedule('analytics-weekly-slack-prune');
--   drop function public.analytics_weekly_slack_run(text[], text); drop function public.analytics_weekly_slack_finish(date, text, text, text, text);
--   drop function public.analytics_weekly_slack_claim(date, text, text[], boolean);
--   drop table public.analytics_weekly_slack_posts, public.analytics_weekly_slack_allow;
--   delete from public.syncview_runtime_flags where key = 'analytics_weekly_slack_post';
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if to_regclass('public.analytics_weekly_messages') is null then
    raise exception 'step 2 is not applied (migrations/2026-11-04-analytics-weekly-posts.sql); apply it first';
  end if;
  if to_regclass('public.syncview_runtime_flags') is null then
    raise exception 'syncview_runtime_flags is missing';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'analytics_collect_key' and length(decrypted_secret) >= 32) then
    raise exception 'analytics_collect_key is missing from Vault (at least 32 characters); see the header of this file';
  end if;
end
$check$;

-- The switch, OFF. Never overwritten by a re-run of this file.
insert into public.syncview_runtime_flags (key, value, updated_by)
values ('analytics_weekly_slack_post', '{"mode":"off"}'::jsonb, 'migration')
on conflict (key) do nothing;

create table if not exists public.analytics_weekly_slack_allow (
  client_slug text primary key check (client_slug ~ '^[a-z0-9&]+$'),
  added_at    timestamptz not null default now(),
  added_by    text
);

create table if not exists public.analytics_weekly_slack_posts (
  client_slug text not null check (client_slug ~ '^[a-z0-9&]+$'),
  week_of     date not null check (extract(isodow from week_of) = 1),
  status      text not null check (status in ('pending', 'sent', 'failed', 'skipped', 'unknown')),
  slack_ts    text check (slack_ts is null or slack_ts ~ '^[0-9]{10,}\.[0-9]{6}$'),
  error_class text,
  attempts    integer not null default 1 check (attempts >= 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (client_slug, week_of),
  check ((status = 'sent') = (slack_ts is not null))
);

do $grants$
declare t text;
begin
  foreach t in array array['analytics_weekly_slack_allow', 'analytics_weekly_slack_posts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', t);
  end loop;
  -- The function reads the allow list and the post log (status); posts are written only through claim and finish.
  grant select on public.analytics_weekly_slack_allow to service_role;
  grant select on public.analytics_weekly_slack_posts to service_role;
end
$grants$;

-- One client to post: built message, allowed by the mode, no sent / pending / unknown row, retries spaced.
-- p_mode is read by the function from the switch ('allow_list' or 'all'; 'off' never reaches here).
-- p_reset (manual run on named clients only): a failed or skipped row starts over.
create or replace function public.analytics_weekly_slack_claim(
  p_week_of date, p_mode text, p_slugs text[] default null, p_reset boolean default false)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare c text; got text;
begin
  if p_mode not in ('allow_list', 'all') then return null; end if;
  -- Slack never confirmed these and nothing finished them: they may be in the channel, so they are not retried.
  update public.analytics_weekly_slack_posts
     set status = 'unknown', error_class = 'stuck_pending', updated_at = now()
   where week_of = p_week_of and status = 'pending' and updated_at < now() - interval '10 minutes';

  select m.client_slug into c
    from public.analytics_weekly_messages m
    left join public.analytics_weekly_slack_posts p on p.client_slug = m.client_slug and p.week_of = m.week_of
   where m.week_of = p_week_of
     and m.text is not null
     and (p_slugs is null or m.client_slug = any (p_slugs))
     and (p_mode = 'all' or exists (select 1 from public.analytics_weekly_slack_allow a where a.client_slug = m.client_slug))
     and (p.client_slug is null
          or (p.status in ('failed', 'skipped') and (p_reset or (p.attempts < 3 and p.updated_at < now() - interval '5 minutes'))))
   order by coalesce(p.attempts, 0), m.client_slug
   limit 1
   for update of m skip locked;
  if c is null then return null; end if;

  insert into public.analytics_weekly_slack_posts as p (client_slug, week_of, status, attempts)
  values (c, p_week_of, 'pending', 1)
  on conflict (client_slug, week_of) do update
    set status = 'pending', attempts = case when p_reset then 1 else p.attempts + 1 end,
        slack_ts = null, error_class = null, updated_at = now()
    where p.status in ('failed', 'skipped')
  returning client_slug into got;
  return got;  -- null when another tick won the race
end
$fn$;

create or replace function public.analytics_weekly_slack_finish(
  p_week_of date, p_client_slug text, p_status text, p_slack_ts text, p_error_class text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  update public.analytics_weekly_slack_posts
     set status = p_status, slack_ts = nullif(p_slack_ts, ''), error_class = nullif(left(p_error_class, 80), ''), updated_at = now()
   where week_of = p_week_of and client_slug = p_client_slug and status = 'pending'
$fn$;

-- The manual run call. Owner only: no role below postgres can run it.
create or replace function public.analytics_weekly_slack_run(p_slugs text[], p_action text default 'run')
returns bigint
language sql
security definer
set search_path = public, pg_temp
as $fn$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-slack-post',
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
    'public.analytics_weekly_slack_claim(date,text,text[],boolean)',
    'public.analytics_weekly_slack_finish(date,text,text,text,text)',
    'public.analytics_weekly_slack_run(text[],text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  grant execute on function public.analytics_weekly_slack_claim(date,text,text[],boolean) to service_role;
  grant execute on function public.analytics_weekly_slack_finish(date,text,text,text,text) to service_role;
end
$fnacl$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-weekly-slack-tick', 'analytics-weekly-slack-prune');
end
$unschedule$;

-- Day-of-week 1 = Monday; 15:00-16:59 UTC (a working hour in the Americas, long after the messages are built at
-- 08:00-09:59). Change the hours here if the owner wants another time. While the switch says off the function
-- answers every tick with {"mode":"off"} and does nothing else.
select cron.schedule('analytics-weekly-slack-tick', '* 15-16 * * 1', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-weekly-slack-post',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

select cron.schedule('analytics-weekly-slack-prune', '47 4 * * 1',
  $job$delete from public.analytics_weekly_slack_posts where week_of < (now() at time zone 'utc')::date - 60$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-weekly-slack%';  (two rows, active)
--         select value from public.syncview_runtime_flags where key = 'analytics_weekly_slack_post';  ({"mode":"off"})
