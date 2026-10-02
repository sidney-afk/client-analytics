-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go, and only AFTER
-- 2026-10-02-analytics-market-research-collect-shadow.sql and the Edge Function deploy).
--
-- The timer for the shadow run of the Market Research brief job
-- (docs/plans/2026-10-01-n8n-off-analytics.md, section 7). Two pg_cron jobs:
--   analytics-market-research-collect-tick   every minute, but it calls the function ONLY while a request is
--                                            open (pending or running): most days nothing is called at all
--   analytics-market-research-collect-prune  03:53 UTC daily: drops finished or failed requests older than 60 days
--                                            (their saved scrape and transcript state is large; the brief stays)
--
-- Nothing runs a request while the flag analytics_market_research_collect says "off", so applying this file
-- starts nothing by itself: the function answers {"skipped":"off"} to every tick, and a request only exists when
-- somebody inserts one.
--
-- Uses the SAME key as the metrics and Top Videos jobs: the Vault secret analytics_collect_key and the Edge
-- Function secret ANALYTICS_COLLECT_KEY. No new key. This file refuses to run until the Vault secret exists.
--
-- Rollback (one statement each):
--   select cron.unschedule('analytics-market-research-collect-tick');
--   select cron.unschedule('analytics-market-research-collect-prune');
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
    where jobname in ('analytics-market-research-collect-tick', 'analytics-market-research-collect-prune');
end
$unschedule$;

select cron.schedule('analytics-market-research-collect-tick', '* * * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/analytics-market-research-collect',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-analytics-collect-key', (select decrypted_secret from vault.decrypted_secrets where name = 'analytics_collect_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 150000)
  where exists (select 1 from public.analytics_market_research_collect_queue where state in ('pending', 'running'))
$job$);

select cron.schedule('analytics-market-research-collect-prune', '53 3 * * *', $job$
  delete from public.analytics_market_research_collect_queue
   where state in ('done', 'failed') and updated_at < now() - interval '60 days'
     and not exists (select 1 from public.analytics_market_research_shadow s where s.queue_id = analytics_market_research_collect_queue.id)$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-market-research-collect%';
-- (two rows, active).
