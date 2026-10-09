-- STATE: BUILT, NOT APPLIED. Lighthouse applies it by hand in the SQL editor, after the owner's
-- go at that moment, and only after the monitoring-watchdog-tick Edge Function is deployed with
-- its two secrets and 2026-10-09-monitoring-watchdog-tick-ping.sql has been run a minute earlier:
-- this file refuses to schedule anything unless a signed ping reached the deployed function in the
-- last hour and was answered "ready":true. OPEN_REPAIRS 388.
--
-- READ BEFORE APPLYING: the ledger entry measured (2026-10-09, read only, last 7 days) that a
-- 15-minute observer would see the GitHub-hosted lanes' own schedule gaps far more often than the
-- GitHub hosts do today (about 54 stale pages a week at today's thresholds, against 18 sent), so
-- the threshold follow-up named there should land first.
--
-- The timer for the monitoring dead-man's switch (scripts/monitoring-watchdog.js,
-- docs/ops/MONITORING.md). One pg_cron job, every 15 minutes: calls the Edge Function's "tick",
-- which runs the same check as `node scripts/monitoring-watchdog.js --check` (same lanes, same
-- latches, same relay page) and writes the `monitoring_watchdog` heartbeat. It replaces nothing:
-- monitoring-deadman.yml and monitoring-crosscheck.yml keep running as a second observer.
-- Nothing runs through n8n except the page itself, which goes to the same n8n alert relay the
-- GitHub hosts page through.
--
-- The call is signed with MONITORING_WATCHDOG_KEY. The same value (at least 32 characters) must
-- be set as the Edge Function secret AND stored in Vault under the name monitoring_watchdog_key.
-- The value is NEVER written in a file: create it once, by hand, in the SQL editor:
--   select vault.create_secret('<paste the same 64 characters>', 'monitoring_watchdog_key');
-- This file refuses to run until that secret exists.
--
-- Rollback (one statement): select cron.unschedule('monitoring-watchdog-tick');
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'monitoring_watchdog_key' and length(decrypted_secret) >= 32) then
    raise exception 'monitoring_watchdog_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
  if not exists (select 1 from net._http_response
                  where status_code = 200 and content::text like '%"pong":"monitoring-watchdog-tick","ready":true%'
                    and created > now() - interval '1 hour') then
    raise exception 'no ready ping from the deployed monitoring-watchdog-tick in the last hour; deploy it, set MONITORING_WATCHDOG_KEY to the Vault value and MONITORING_ALERT_WEBHOOK, run 2026-10-09-monitoring-watchdog-tick-ping.sql, wait a minute, then run this file';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'monitoring-watchdog-tick';
end
$unschedule$;

select cron.schedule('monitoring-watchdog-tick', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/monitoring-watchdog-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monitoring-watchdog-key', (select decrypted_secret from vault.decrypted_secrets where name = 'monitoring_watchdog_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname = 'monitoring-watchdog-tick';
-- (one row, active). Twenty minutes later:
--   select status_code, count(*) from net._http_response where created > now() - interval '1 hour' group by 1;
--   (200 expected; 502 means a pass failed, its "detail" says which read or write)
--   select ts, actor, payload->>'run_id' from deliverable_events
--    where action = 'monitoring_heartbeat' and payload->>'lane' = 'monitoring_watchdog' order by id desc limit 3;
--   (rows with actor supabase-cron-monitoring-watchdog and run_id pgcron:..., one per 15 minutes)
