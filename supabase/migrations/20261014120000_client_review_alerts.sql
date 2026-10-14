-- "Notify client" button: one row per alert attempt (and per owner preview), so the
-- confirm box can say when an alert last went to a client and who sent it.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- client-review-alert Edge Function (service role) does, after checking the staff
-- key. Nothing secret is stored: no token, no link, no message text. Supabase
-- grants every new table to anon, authenticated and service_role by default, so
-- all four roles are named in the revoke.
--
-- Rollback: drop table public.client_review_alerts;
-- Written by session Herald 2026-10-14; applied by the owner, not by CI.
begin;

create table if not exists public.client_review_alerts (
  id uuid primary key,
  client_slug text not null check (length(client_slug) between 1 and 120),
  surface text not null check (surface in ('calendar', 'samples')),
  mode text not null check (mode in ('send', 'preview')),
  actor text,
  role text check (role in ('admin', 'smm')),
  channel_id text,
  status text not null check (status in ('pending', 'sent', 'failed', 'unknown')),
  slack_ts text,
  slack_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists client_review_alerts_last_idx
  on public.client_review_alerts (client_slug, surface, mode, created_at desc);

alter table public.client_review_alerts enable row level security;

revoke all on table public.client_review_alerts from public, anon, authenticated, service_role;
grant select, insert, update on table public.client_review_alerts to service_role;

comment on table public.client_review_alerts is
  'Staff-only log of "Notify client" alerts and owner previews. Read and written only by client-review-alert (service role).';

commit;
