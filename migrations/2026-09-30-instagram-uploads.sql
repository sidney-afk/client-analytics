-- ============================================================
-- NOT APPLIED. Written 2026-09-30 by Relay for the instagram-upload Edge Function (Instagram side of the
-- TikTok Upload tab, through Post For Me). Lighthouse applies it with the owner's go, then the function is
-- deployed. Nothing in the page works against the live system until both are done.
--
-- The Instagram upload queue: one row per post sent to Post For Me. The function reads and writes it with
-- service_role only; no browser role holds anything (the page reads it through the function).
--
-- Supabase grants service_role, anon and authenticated full rights on every new object by default, so the
-- revoke names all four and service_role is then given back only what the function needs.
--
-- Rollback: drop table public.instagram_uploads;  (queue rows only; posts already sent stay on Instagram)
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.instagram_uploads (
  id             text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  client         text not null check (char_length(client) between 1 and 200),
  account_id     text not null check (account_id ~ '^spc_[A-Za-z0-9]{6,80}$'),
  title          text not null check (char_length(title) between 1 and 2200),
  options        jsonb not null default '{}'::jsonb check (jsonb_typeof(options) = 'object'),
  scheduled_for  timestamptz,
  timezone       text not null default '',
  status         text not null check (status in ('uploading', 'scheduled', 'processing', 'posted', 'failed', 'cancelled')),
  post_id        text not null default '',
  instagram_url  text not null default '',
  error          text not null default '' check (char_length(error) <= 600),
  posted_at      timestamptz,
  last_checked_at timestamptz,
  created_by     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists instagram_uploads_client_created_idx on public.instagram_uploads (client, created_at desc);
create index if not exists instagram_uploads_created_idx on public.instagram_uploads (created_at desc);

alter table public.instagram_uploads enable row level security;

revoke all on table public.instagram_uploads from public, anon, authenticated, service_role;
grant select, insert, update on table public.instagram_uploads to service_role;

-- Assert: no browser role holds anything, service_role holds exactly select, insert and update.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'instagram_uploads'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'instagram_uploads: a browser role still holds a privilege'; end if;

  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'instagram_uploads' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'instagram_uploads: service_role holds % (expected INSERT,SELECT,UPDATE)', sr;
  end if;
end
$assert$;

commit;
