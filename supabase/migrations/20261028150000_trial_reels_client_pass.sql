-- ef-auto-deploy: functions-cope-without-this
-- Trial reels: the client's "Not this one" on one version (owner, 2026-10-28; session Trials, OPEN_REPAIRS 562).
--
-- One column on the versions log. A client who does not want a version says so on their review link; the function
-- stamps client_pass_at on that version and leaves its status as it was. A passed version is not waiting for anyone:
-- the client stage, the card's Approved and the trial count without it, and the team sees "Client passed" and drops it
-- (only the team drops, so the card's link never moves for the client). A new cut, a new link, Bring back or the
-- client's own approve clear it.
--
-- Why the function copes without it: trial-reels reads these rows with select *, so before this is applied the rows
-- simply carry no client_pass_at; it then refuses only the pass itself (pass_unavailable), and it never names the
-- column in any other write unless a row already has a pass. Grants are unchanged: the table stays service-role only
-- (20261026200000_studio_trial_versions.sql), and a new column takes the table's privileges.

alter table public.studio_trial_versions
  add column if not exists client_pass_at timestamptz;

comment on column public.studio_trial_versions.client_pass_at is
  'When the client said "Not this one" on this version (trial-reels, client link). Null when not passed.';
