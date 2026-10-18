-- ef-auto-deploy: functions-cope-without-this
--
-- The raw copy of every upload, stored first (owner goal 2026-10-18: an upload
-- from the client link or the Submit tab must never be lost).
--
-- WHY. Until now the only server record of an upload before its rows were built
-- was public_intake_log: client, request id and a count, with none of what the
-- person typed. If a later step refused the request or rolled it back, the links
-- and notes existed only in that person's browser. The gateway now writes the
-- request body here, as received, as soon as the caller is accepted and before
-- any row is built from it. One row per request id; a retry bumps `attempts`.
--
-- The gateway treats this table as best effort: a missing table never refuses an
-- upload, so the gateway may deploy before this is applied (hence the line at
-- the top of this file). Apply it so the copies start being kept.
--
-- WHAT STAFF SEE. `production-write` action `intake_raw_list` (admin and SMM
-- keys only) lists the newest rows, and returns one row's raw body when given
-- its request id. See docs/ops/INTAKE_RAW_COPY.md.
--
-- PRIVILEGES. The raw body holds client links and notes, so the browser keys
-- must never read it. Supabase grants service_role, anon and authenticated full
-- rights on every new object by default, so the revoke names all four roles and
-- service_role then gets back only what the gateway uses.

begin;

create table if not exists public.intake_raw_submissions (
  request_id text primary key,
  client_slug text not null,
  surface text not null,
  received_as text not null,
  item_count integer not null default 0,
  raw_body jsonb not null,
  attempts integer not null default 1,
  outcome text not null default 'received',
  outcome_detail text,
  first_received_at timestamptz not null default now(),
  last_received_at timestamptz not null default now(),
  outcome_at timestamptz
);

create index if not exists intake_raw_submissions_first_received_idx
  on public.intake_raw_submissions (first_received_at desc);
create index if not exists intake_raw_submissions_client_idx
  on public.intake_raw_submissions (client_slug, first_received_at desc);

alter table public.intake_raw_submissions enable row level security;

revoke all on table public.intake_raw_submissions from public, anon, authenticated, service_role;
grant select, insert, update on table public.intake_raw_submissions to service_role;

commit;

-- ROLLBACK (only if the copies must stop; the gateway keeps working without the table):
--   begin;
--   drop table if exists public.intake_raw_submissions;
--   commit;
