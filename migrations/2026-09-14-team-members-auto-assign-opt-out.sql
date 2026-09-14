-- Auto-assign opt-out for the video editor pool.
--
-- Owner request 2026-09-14: an outsourced editor must never be picked by the
-- Submit-tab / intake auto-assignment, while staying fully assignable when
-- somebody chooses them on purpose. Roster data, not code: the flag lives on
-- the row so nobody has to ship a deploy to add or remove a person.
--
-- Additive-only, defaults to false, so every existing row keeps today's
-- behaviour.

alter table public.team_members
  add column if not exists auto_assign_opt_out boolean not null default false;

comment on column public.team_members.auto_assign_opt_out is
  'True = never chosen by automatic assignment (intake/Submit tab). Still assignable when explicitly selected. Service-role only: never granted to anon/authenticated.';

-- The point of keeping this flag in DATA rather than in code was that the
-- PUBLIC repo never learns who it is. A table-wide `grant select` to anon
-- (2026-07-05-b0, still in force) would have handed the same fact straight back
-- out: anyone with the browser publishable key could read the column beside the
-- name and email on the same row. So anon/authenticated are re-granted
-- COLUMN-LEVEL select over exactly the roster columns they read today, and the
-- new column is left out. Postgres takes the union of table and column grants,
-- so the table-wide grant has to be revoked for the narrower one to bind.
--
-- Nothing in the browser reads this column: the gateway (service role, whose
-- grants are untouched) is the only reader, and the Create Post editor picker
-- deliberately still lists and ranks everyone. Adding a roster column in future
-- means adding it to this list, or it is invisible to the app.
revoke select on table public.team_members from anon;
revoke select on table public.team_members from authenticated;

grant select (
  id, name, email, role, team, slack_user_id, linear_user_id,
  avatar_color, default_for_team, active, created_at
) on table public.team_members to anon;

grant select (
  id, name, email, role, team, slack_user_id, linear_user_id,
  avatar_color, default_for_team, active, created_at
) on table public.team_members to authenticated;
