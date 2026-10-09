-- STATE: BUILT, NOT APPLIED. Run by hand in the SQL editor, after the owner's go at that moment,
-- once the GitHub token is in Vault, and before 2026-10-09-github-workflow-dispatch-timer.sql.
-- OPEN_REPAIRS 388.
--
-- Proves the token works, both halves, before any timer is installed:
--   1. a READ of one workflow of this repository (answer 200 naming the workflow file), and
--   2. ONE real dispatch of card-calendar-status-drift.yml (answer 204). That workflow only
--      reads: it measures card vs calendar status drift and writes its own heartbeat, and it
--      runs every hour anyway, so one extra run changes nothing.
-- It changes nothing in this database except the request records pg_net keeps. The timer file
-- reads those answers and refuses to install without both.
--
-- The token is a fine-grained GitHub personal access token: repository access "Only select
-- repositories" = this repository alone; repository permissions "Actions: Read and write"
-- (Metadata: Read-only is added by GitHub automatically); nothing else. Store it once, by hand
-- (never in a file):
--   select vault.create_secret('<paste the token>', 'github_dispatch_token');
begin;

create extension if not exists pg_net;

do $check$
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'github_dispatch_token' and length(decrypted_secret) >= 20) then
    raise exception 'github_dispatch_token is missing from Vault; create it first, see the header of this file';
  end if;
end
$check$;

select net.http_get(
  url := 'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/card-calendar-status-drift.yml',
  headers := jsonb_build_object(
    'Accept', 'application/vnd.github+json',
    'X-GitHub-Api-Version', '2022-11-28',
    'User-Agent', 'syncview-db-timer',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1)),
  timeout_milliseconds := 10000);

select net.http_post(
  url := 'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/card-calendar-status-drift.yml/dispatches',
  headers := jsonb_build_object(
    'Accept', 'application/vnd.github+json',
    'X-GitHub-Api-Version', '2022-11-28',
    'User-Agent', 'syncview-db-timer',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1)),
  body := '{"ref":"main","inputs":{}}'::jsonb,
  timeout_milliseconds := 10000);

commit;

-- VERIFY (a minute later): select status_code, left(content, 120) from net._http_response order by created desc limit 2;
-- expect one 200 (the read; its body names .github/workflows/card-calendar-status-drift.yml) and one 204 (the
-- dispatch, empty body). 401 = the token is wrong or expired; 403 = it lacks "Actions: Read and write" on
-- this repository; 404 = it cannot see this repository. A new "workflow_dispatch" run of
-- card-calendar-status-drift.yml also appears in the Actions tab.
