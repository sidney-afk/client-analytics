-- STATE: BUILT, NOT APPLIED (Lighthouse applies it, after the owner's go, and only AFTER
-- 2026-10-06-analytics-collect-live.sql).
--
-- The timer for the daily safety check of the two analytics jobs
-- (docs/plans/2026-10-01-n8n-off-analytics.md, section 8b). It replaces n8n's end-of-run
-- checks ("Validate Roster Coverage") once n8n is off. Two pg_cron jobs, each a plain SQL
-- call (no network, no key):
--   analytics-collect-check-metrics     09:07 UTC daily, after the metrics window (04:00 to 08:59)
--   analytics-collect-check-top-videos  13:07 UTC daily, after the Top Videos window (08:00 to 12:59)
-- Each runs public.analytics_collect_daily_check_record(<dataset>), which keeps the day's
-- answer in public.analytics_collect_daily_checks. It records nothing while the job's flag is
-- off. The combined Slack problem message (scripts/alert-digest.js, hourly) reads that table
-- and names a problem of a LIVE job once per day, counts only.
--
-- Rollback (one statement each):
--   select cron.unschedule('analytics-collect-check-metrics');
--   select cron.unschedule('analytics-collect-check-top-videos');
begin;

create extension if not exists pg_cron;

do $dep$
begin
  if to_regprocedure('public.analytics_collect_daily_check_record(text,date)') is null then
    raise exception 'apply 2026-10-06-analytics-collect-live.sql first';
  end if;
end
$dep$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job
    where jobname in ('analytics-collect-check-metrics', 'analytics-collect-check-top-videos');
end
$unschedule$;

select cron.schedule('analytics-collect-check-metrics', '7 9 * * *',
  $job$select public.analytics_collect_daily_check_record('metrics')$job$);

select cron.schedule('analytics-collect-check-top-videos', '7 13 * * *',
  $job$select public.analytics_collect_daily_check_record('top_videos')$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'analytics-collect-check%';
-- (two rows, active). After 09:07 UTC on a day the metrics flag is shadow or live:
--   select run_date, dataset, mode, problems from public.analytics_collect_daily_checks order by run_date desc limit 4;
