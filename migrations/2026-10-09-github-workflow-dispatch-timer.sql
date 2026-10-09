-- STATE: BUILT, NOT APPLIED. Lighthouse applies it by hand in the SQL editor, after the owner's go
-- at that moment, and only after 2026-10-09-github-workflow-dispatch-ping.sql has been run a minute
-- earlier: this file refuses to schedule anything unless, in the last hour, the token both read a
-- workflow of this repository and dispatched one. OPEN_REPAIRS 388.
--
-- WHY. GitHub runs this repository's `schedule:` crons hours late (measured 2026-10-09: the
-- 5-minute native notification sender ran 6 times in 30 hours; the daily roster and Sheets copy
-- jobs started about 7 hours after their time). A run started through the workflow_dispatch API is not dropped that
-- way. So the database timer (pg_cron, through pg_net) dispatches every scheduled workflow at its
-- intended time. The `schedule:` blocks stay in the workflow files as a fallback: if this timer
-- stops, GitHub's own (late) schedule still runs them.
--
-- WHAT. One pg_cron job per workflow below, named gh-dispatch-<workflow>, on the SAME cron as the
-- workflow's own `schedule:` (pg_cron runs in UTC, like GitHub). Each job POSTs
--   /repos/sidney-afk/client-analytics/actions/workflows/<file>/dispatches  {"ref":"main","inputs":...}
-- Workflows that tell a timed run from a manual one get {"source":"db-timer"}, and treat it
-- exactly like a scheduled run; the others behave the same either way and get no inputs.
-- test/github-dispatch-timer.js checks this list against .github/workflows in both directions.
-- This is the ONLY dispatcher: lane-ticker.yml, the earlier GitHub-side dispatcher of the five
-- frequent lanes, is deleted in the same change, so no lane is dispatched twice.
--
-- NOT DISPATCHED, on purpose (also enforced by the test):
--   monitoring-deadman.yml, monitoring-crosscheck.yml  the dead-man's switch already runs every 15
--     minutes on the database timer (monitoring-watchdog-tick); these two stay on GitHub's own
--     schedule as the independent second observer, so they must not depend on this timer.
--
-- The token is read from Vault (github_dispatch_token) each time a job runs; it is never written
-- into a job or a file. See the ping file for the exact token to create.
--
-- Rollback (one statement): select cron.unschedule(jobid) from cron.job where jobname like 'gh-dispatch-%';
begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'github_dispatch_token' and length(decrypted_secret) >= 20) then
    raise exception 'github_dispatch_token is missing from Vault; create it first, see 2026-10-09-github-workflow-dispatch-ping.sql';
  end if;
  if not exists (select 1 from net._http_response
                  where status_code = 200 and content::text like '%".github/workflows/card-calendar-status-drift.yml"%'
                    and created > now() - interval '1 hour') then
    raise exception 'no successful token READ in the last hour; run 2026-10-09-github-workflow-dispatch-ping.sql, wait a minute, then run this file';
  end if;
  -- A dispatch answers 204 with an empty body. Nothing else this project sends through pg_net
  -- answers 204 (measured 2026-10-09: every stored response was a 200).
  if not exists (select 1 from net._http_response
                  where status_code = 204 and created > now() - interval '1 hour') then
    raise exception 'no successful token DISPATCH (204) in the last hour; the token needs "Actions: Read and write" on this repository. Run 2026-10-09-github-workflow-dispatch-ping.sql, wait a minute, then run this file';
  end if;
end
$check$;

do $unschedule$
begin
  perform cron.unschedule(jobid) from cron.job where jobname like 'gh-dispatch-%';
end
$unschedule$;

do $schedule$
declare
  r record;
begin
  for r in
    select * from (values
      -- workflow file                        cron (same as its schedule:)   inputs
      ('alert-digest.yml',                     '47 * * * *',          '{"source":"db-timer"}'),
      ('assurance-ledger-freshness.yml',       '37 7 * * *',          '{}'),
      ('calendar-e2e-nightly.yml',             '0 8 * * *',           '{"source":"db-timer"}'),
      ('card-calendar-status-drift.yml',       '27 * * * *',          '{}'),
      ('clients-roster-sync.yml',              '41 6 * * *',          '{"source":"db-timer"}'),
      ('dawn-check.yml',                       '30 11 * * 1-5',       '{"source":"db-timer"}'),
      ('n8n-execution-quota-watchdog.yml',     '17 13 * * *',         '{"source":"db-timer"}'),
      ('native-intake-completion-monitor.yml', '12,27,42,57 * * * *', '{}'),
      ('native-intake-completion.yml',         '5,20,35,50 * * * *',  '{}'),
      ('native-notification-monitor.yml',      '2-59/5 * * * *',      '{}'),
      ('native-notification-sender.yml',       '*/5 * * * *',         '{}'),
      ('production-polish-gate.yml',           '17 9 * * 1-5',        '{}'),
      ('rename-propagation-drain.yml',         '*/5 * * * *',         '{}'),
      ('samples-e2e-nightly.yml',              '0 6 * * *',           '{"source":"db-timer"}'),
      ('sheets-mirror-daily.yml',              '23 9 * * *',          '{"source":"db-timer"}'),
      ('thumbnail-revision-scan.yml',          '*/10 * * * *',        '{}'),
      ('track-b-backup.yml',                   '23 */6 * * *',        '{"source":"db-timer"}')
    ) as t(workflow, schedule, inputs)
  loop
    perform cron.schedule(
      'gh-dispatch-' || regexp_replace(r.workflow, '\.yml$', ''),
      r.schedule,
      format($cmd$select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'syncview-db-timer',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1)),
    body := jsonb_build_object('ref', 'main', 'inputs', %L::jsonb),
    timeout_milliseconds := 10000)$cmd$,
        'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/' || r.workflow || '/dispatches',
        r.inputs));
  end loop;
end
$schedule$;

commit;

-- VERIFY: select jobname, schedule, active from cron.job where jobname like 'gh-dispatch-%' order by 1;
-- (17 rows, active). Ten minutes later:
--   select status_code, count(*) from net._http_response where created > now() - interval '10 minutes' group by 1;
--   (204 for every dispatch; 401/403 means the token expired or lost its permission, 422 means a workflow's
--   inputs changed and this list needs the same change)
-- and the Actions tab shows workflow_dispatch runs of native-notification-sender.yml every 5 minutes.
