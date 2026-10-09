-- STATE: BUILT, NOT APPLIED. Run by hand in the SQL editor, after the owner's go at that moment,
-- once the monitoring-watchdog-tick Edge Function is deployed with its two secrets set
-- (MONITORING_WATCHDOG_KEY and MONITORING_ALERT_WEBHOOK), and before
-- 2026-10-09-monitoring-watchdog-tick-schedule.sql. OPEN_REPAIRS 388.
--
-- Sends ONE signed ping to the deployed function. The ping reads no table, writes no event and
-- sends no page; the function answers it before it touches the database. Its answer says whether
-- the function exists, whether its MONITORING_WATCHDOG_KEY equals the Vault value, and whether
-- the alert webhook secret is set ("ready":true). It changes nothing in this database except the
-- request record pg_net keeps. The schedule file reads that answer and refuses to run without a
-- fresh "ready":true.
--
-- Create the Vault secret first, by hand (never in a file), with the same text as the Edge
-- Function secret MONITORING_WATCHDOG_KEY:
--   select vault.create_secret('<paste the same 64 characters>', 'monitoring_watchdog_key');
begin;

create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'monitoring_watchdog_key' and length(decrypted_secret) >= 32) then
    raise exception 'monitoring_watchdog_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
end
$check$;

select net.http_post(
  url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/monitoring-watchdog-tick',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-monitoring-watchdog-key', (select decrypted_secret from vault.decrypted_secrets where name = 'monitoring_watchdog_key' limit 1)),
  body := '{"action":"ping"}'::jsonb,
  timeout_milliseconds := 10000);

commit;

-- VERIFY (a minute later): select status_code, content from net._http_response order by created desc limit 1;
-- expect 200 and {"ok":true,"pong":"monitoring-watchdog-tick","ready":true,"missing":[]}.
-- 401 means the key differs from the Vault value; 404 means not deployed; "ready":false names the
-- unset secret(s) in "missing".
