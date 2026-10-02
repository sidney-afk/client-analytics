-- STATE: BUILT, NOT APPLIED. Lighthouse applies it by hand in the SQL editor, after the owner's
-- go at that moment, and only AFTER 2026-10-04-client-hubspot-sync.sql, the client-hubspot-sync
-- Edge Function deploy and its two secrets (HUBSPOT_READ_TOKEN, HUBSPOT_SYNC_KEY), and after
-- 2026-10-04-client-hubspot-sync-ping.sql has been run a minute earlier: this file refuses to
-- schedule anything unless a signed ping reached the deployed function in the last hour and was
-- answered (so a missing deploy or a key that differs from the Vault value stops it here, not
-- silently every morning).
--
-- The daily timer for the HubSpot refresh (docs/plans/2026-10-01-onboarding-checklist-and-profile.md,
-- step 2.3b). One pg_cron job: eight calls one minute apart from 05:30 UTC, each looking up a
-- few never-synced or day-old clients (six per call), so about 48 lookups cover every client
-- once a day. Nothing runs it through n8n.
--
-- Applying this file starts nothing by itself: the function answers {"skipped":"off"} to every
-- call until the switch row syncview_runtime_flags client_hubspot_sync says "on", and then
-- only for the clients it names (or "all": true once the owner approves the all-clients run).
--
-- The call is signed with HUBSPOT_SYNC_KEY. The same value (at least 32 characters) must be set
-- as the Edge Function secret AND stored in Vault under the name hubspot_sync_key. The value is
-- NEVER written in a file: create it once, by hand, in the SQL editor:
--   select vault.create_secret('<paste the same 64 characters>', 'hubspot_sync_key');
-- This file refuses to run until that secret exists.
--
-- Rollback (one statement): select cron.unschedule('client-hubspot-sync-daily');
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'hubspot_sync_key' and length(decrypted_secret) >= 32) then
    raise exception 'hubspot_sync_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
  if to_regprocedure('public.client_hubspot_sync_targets(text,integer,integer)') is null then
    raise exception 'apply 2026-10-04-client-hubspot-sync.sql first';
  end if;
  if not exists (select 1 from net._http_response
                  where status_code = 200 and content::text like '%"pong":"client-hubspot-sync"%'
                    and created > now() - interval '1 hour') then
    raise exception 'no answered ping from the deployed client-hubspot-sync in the last hour; deploy it, set HUBSPOT_SYNC_KEY to the Vault value, run 2026-10-04-client-hubspot-sync-ping.sql, wait a minute, then run this file';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'client-hubspot-sync-daily';
end
$unschedule$;

select cron.schedule('client-hubspot-sync-daily', '30-37 5 * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-hubspot-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hubspot-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'hubspot_sync_key' limit 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 55000)
$job$);

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname = 'client-hubspot-sync-daily';
-- (one row, active). Next morning: select status_code, count(*) from net._http_response
--   where created > now() - interval '1 day' group by 1;  (200 expected). The function answers 502 (some
--   clients failed) or 429 (HubSpot rate limit) when a sweep was not clean, so a non-200 is real.
