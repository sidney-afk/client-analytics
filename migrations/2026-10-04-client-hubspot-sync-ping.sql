-- STATE: BUILT, NOT APPLIED. Run by hand in the SQL editor, after the owner's go at that moment,
-- once the client-hubspot-sync Edge Function is deployed with HUBSPOT_SYNC_KEY set, and before
-- 2026-10-04-client-hubspot-sync-schedule.sql.
--
-- Sends ONE signed ping to the deployed function: it proves the function exists and that its
-- HUBSPOT_SYNC_KEY equals the Vault value hubspot_sync_key. The ping touches no table and makes
-- no HubSpot call; the function answers it before it reads the switch or opens the database.
-- It changes nothing in this database except the request record pg_net keeps.
-- The schedule file reads that answer and refuses to run without a fresh good one.
--
-- Create the Vault secret first, by hand (never in a file):
--   select vault.create_secret('<paste the same 64 characters>', 'hubspot_sync_key');
begin;

create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'hubspot_sync_key' and length(decrypted_secret) >= 32) then
    raise exception 'hubspot_sync_key is missing from Vault (at least 32 characters); create it first, see the header of this file';
  end if;
end
$check$;

select net.http_post(
  url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-hubspot-sync',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'x-hubspot-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'hubspot_sync_key' limit 1)),
  body := '{"action":"ping"}'::jsonb,
  timeout_milliseconds := 10000);

commit;

-- VERIFY (a minute later): select status_code, content from net._http_response order by created desc limit 1;
-- expect 200 and {"ok":true,"pong":"client-hubspot-sync"}. 401 means the secret differs; 404 means not deployed.
