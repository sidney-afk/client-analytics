-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go, and only AFTER
-- 2026-10-02-analytics-top-videos-collect-shadow.sql and the Edge Function deploy).
--
-- The timer for the shadow run of the daily Top Videos job
-- (docs/plans/2026-10-01-n8n-off-analytics.md, section 7). Two pg_cron jobs:
--   analytics-top-videos-collect-tick   every minute from 08:00 to 12:59 UTC, 300 ticks (n8n's TOP VIDEOS
--                                       starts at 08:00 UTC and ends about an hour later): at least the 288
--                                       claims the 8-attempt budget of 36 clients can use. Calls "tick".
--   analytics-top-videos-collect-prune  03:47 UTC daily: drops queue rows older than 14 days and shadow
--                                       rows older than 30
--
-- Nothing runs the job while the flag analytics_top_videos_collect says "off", so applying this file
-- starts nothing by itself: the function answers {"skipped":"off"} to every tick.
--
-- Uses the SAME key as the metrics job: the Vault secret analytics_collect_key (created for
-- 2026-10-01-analytics-metrics-collect-schedule.sql) and the Edge Function secret
-- ANALYTICS_COLLECT_KEY. No new secret. This file refuses to run until the Vault secret exists.
--
-- Rollback (one statement each):
--   select cron.unschedule('analytics-top-videos-collect-tick');
--   select cron.unschedule('analytics-top-videos-collect-prune');
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'analytics_collect_key' and length(decrypted_secret) >= 32) then
    raise exception 'analytics_collect_key is missing from Vault (at least 32 characters); see the header of 2026-10-01-analytics-metrics-collect-schedule.sql';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-top-videos-collect-tick', 'analytics-top-videos-collect-prune');
end
$unschedule$;

select cron.schedule('analytics-top-videos-collect-tick', '* 8-12 * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-top-videos-collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

select cron.schedule('analytics-top-videos-collect-prune', '47 3 * * *', $job$
  delete from public.analytics_top_videos_collect_queue where run_date < (now() at time zone 'utc')::date - 14;
  delete from public.analytics_top_videos_shadow where run_date < (now() at time zone 'utc')::date - 30$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-top-videos-collect%';
-- (two rows, active). Next morning: select status_code, count(*) from net._http_response
--   where created > now() - interval '1 day' group by 1;  (200 expected)
