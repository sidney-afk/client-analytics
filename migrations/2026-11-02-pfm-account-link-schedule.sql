-- ef-auto-deploy: functions-cope-without-this
-- ============================================================
-- 2026-11-02 -- The hourly timer for the automatic Post for Me account link (L1 of
--   docs/plans/2026-11-trial-and-posting/combined.md, Sidney's D4). Written by session Lbuild. OPEN_REPAIRS 666.
--
-- STATE: BUILT, NOT APPLIED. The supervisor applies it after the PR merges, client-profile-write is deployed,
-- 2026-11-02-pfm-account-link-runs.sql is applied, and the key below exists in BOTH places.
--
-- THE KEY (one value, at least 32 characters, never written in a file; created by the supervisor):
--   Edge Function secret:  PFM_ACCOUNT_LINK_KEY   (on client-profile-write's project)
--   Vault secret:          pfm_account_link_key   select vault.create_secret('<the same value>', 'pfm_account_link_key');
-- The timer signs each call with the header X-Pfm-Link-Key, read from Vault when the job runs (the value is
-- never copied into the job). client-profile-write lets that key call pfm_accounts_sync and nothing else.
-- This file refuses to schedule anything until the Vault secret exists and the run log is applied.
--
-- One pg_cron job, minute 41 of every hour. Each run links only exact, unique matches, never overwrites a
-- filled slot, and records its outcome in public.pfm_account_link_runs (30 days). A second run changes nothing.
--
-- WHY THE FUNCTIONS COPE WITHOUT IT (the marker on line 1): it only schedules calls to an action that already
-- exists; the admin button works without it.
--
-- HOW TO TELL IT IS APPLIED (expect true):
--   select count(*) = 1 as applied from cron.job where jobname = 'pfm-account-link-hourly' and active;
--
-- VERIFY a run (an hour later): select ran_at, ok, error, linked_count, needs_person_count
--   from public.pfm_account_link_runs_read(now() - interval '2 hours') where trigger = 'timer';
-- ROLLBACK (one statement): select cron.unschedule('pfm-account-link-hourly');
-- ============================================================
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if to_regprocedure('public.pfm_account_link_run_record(jsonb)') is null then
    raise exception 'apply 2026-11-02-pfm-account-link-runs.sql first';
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'pfm_account_link_key' and length(decrypted_secret) >= 32) then
    raise exception 'pfm_account_link_key is missing from Vault (at least 32 characters); create it and the PFM_ACCOUNT_LINK_KEY function secret first, see the header of this file';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'pfm-account-link-hourly';
end
$unschedule$;

select cron.schedule('pfm-account-link-hourly', '41 * * * *', $job$
  select net.http_post(
    url := 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/client-profile-write',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-pfm-link-key', (select decrypted_secret from vault.decrypted_secrets where name = 'pfm_account_link_key' limit 1)),
    body := '{"action": "pfm_accounts_sync"}'::jsonb,
    timeout_milliseconds := 55000)
$job$);

commit;
