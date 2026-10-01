-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go, and only AFTER
-- 2026-10-01-analytics-metrics-collect-shadow.sql, the Edge Function deploy and its secrets).
--
-- The timer for the shadow run of the daily metrics job
-- (docs/plans/2026-10-01-n8n-off-analytics.md, section 3). Two pg_cron jobs:
--   analytics-metrics-collect-tick   every minute from 04:00 to 08:59 UTC, 300 ticks: at least the 288 claims
--                                    the 8-attempt budget of 36 clients can use (n8n starts at
--                                    04:00 and ends about 05:15): calls the function's "tick"
--   analytics-metrics-collect-prune  03:41 UTC daily: drops queue rows older than 14 days
--
-- Nothing runs the job while the flag analytics_metrics_collect says "off", so applying this
-- file starts nothing by itself: the function answers {"skipped":"off"} to every tick.
--
-- The call is signed with the secret ANALYTICS_COLLECT_KEY. The same value must be stored in
-- Vault under the name analytics_collect_key. The value is NEVER written in a file: create
-- it once, by hand, in the SQL editor, after setting the Edge Function secret to the same text:
--   select vault.create_secret('<paste the same 64 characters>', 'analytics_collect_key');
-- This file refuses to run until that secret exists.
--
-- Rollback (one statement each):
--   select cron.unschedule('analytics-metrics-collect-tick');
--   select cron.unschedule('analytics-metrics-collect-prune');
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'analytics_collect_key' and length(decrypted_secret) >= 32) then
    raise exception 'analytics_collect_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-metrics-collect-tick', 'analytics-metrics-collect-prune');
end
$unschedule$;

select cron.schedule('analytics-metrics-collect-tick', '* 4-8 * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-metrics-collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
$job$);

select cron.schedule('analytics-metrics-collect-prune', '41 3 * * *',
  $job$delete from public.analytics_metrics_collect_queue where run_date < (now() at time zone 'utc')::date - 14$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-metrics-collect%';
-- (two rows, active). Next morning: select status_code, count(*) from net._http_response
--   where created > now() - interval '1 day' group by 1;  (200 expected)
