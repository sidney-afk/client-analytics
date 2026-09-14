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
  'True = never chosen by automatic assignment (intake/Submit tab). Still assignable when explicitly selected.';
