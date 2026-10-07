-- "ALSO SEES" for Today and the client dropdown's "My clients" (owner request
-- 2026-10-07, session Compass).
--
-- The SMM roster (social_media_managers) stays one manager per client: it
-- feeds the review queue and n8n, and nothing here changes it. This is a
-- separate, staff-only list of extra clients a staff member also sees on
-- Today and in "My clients" (svSmmCurrentClients in 098-smm-clients), for
-- people who share clients with other managers.
--
-- One row is one grant to one staff member (viewer_member_id), and is either
--   manager_slug  every CURRENT client of that roster manager. It follows the
--                 roster: read through the manager's source_clients each time,
--                 never copied, so a client moved on or off that manager moves
--                 here too. An inactive manager grants nothing.
--   client_name   one client, by its Clients Info name (matched the way the
--                 roster is, through svClientKey). A former client drops out
--                 because only current Clients Info clients are ever shown.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- smm-weekly-reports Edge Function reads it (service role, SELECT only), and
-- returns it beside the roster to the same SMM and admin keys that already
-- receive the whole roster. Rows are added by hand in the SQL editor (owner).
-- Supabase grants every new table to anon, authenticated and service_role by
-- default, so all four roles are named below.
begin;

create table if not exists public.smm_also_sees (
  id uuid primary key default gen_random_uuid(),
  viewer_member_id uuid not null references public.team_members(id) on delete cascade,
  manager_slug text references public.social_media_managers(slug) on delete cascade,
  client_name text check (client_name is null or length(btrim(client_name)) between 1 and 200),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  constraint smm_also_sees_one_target check ((manager_slug is null) <> (client_name is null))
);

create unique index if not exists smm_also_sees_viewer_manager_uq
  on public.smm_also_sees (viewer_member_id, manager_slug) where manager_slug is not null;
create unique index if not exists smm_also_sees_viewer_client_uq
  on public.smm_also_sees (viewer_member_id, lower(btrim(client_name))) where client_name is not null;

alter table public.smm_also_sees enable row level security;

revoke all on table public.smm_also_sees from public, anon, authenticated, service_role;
grant select on table public.smm_also_sees to service_role;

comment on table public.smm_also_sees is
  'Staff-only: extra clients a staff member also sees on Today and in My clients. Never changes the SMM roster. Read only by smm-weekly-reports (service role).';

commit;
