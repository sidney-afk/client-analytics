-- ef-auto-deploy-applied-when: select to_regclass('public.hf_studio_downloads') is not null
--
-- Synchro video studio download log (supabase/functions/higgsfield-mcp, the
-- "studio_latest" tool).
--
-- One row per studio_latest call: which connector link was used (member_name),
-- on the shared team link the first name the person gave (who), and the
-- version and file handed out (both null when nothing was given out, for
-- example before any version is uploaded). So the team can see who is on which
-- studio version. Written fire and forget after the answer: a row that cannot
-- be written never fails or slows the tool.
--
-- The zips themselves live in the private Storage bucket "studio" (created by
-- Lighthouse; the connector only reads it with the service role). This file
-- touches no bucket and no storage policy.
--
-- Access: no browser key and no signed-in role reads or writes it. Only the
-- higgsfield-mcp Edge Function (service role) inserts and reads rows. Supabase
-- grants every new table to anon, authenticated and service_role by default,
-- so all four roles are named in the revoke.
--
-- Rollback: drop table public.hf_studio_downloads;
-- Written by session Atelier 2026-10-16; applied by Lighthouse.
begin;

create table if not exists public.hf_studio_downloads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  member_name text not null check (length(member_name) between 1 and 80),
  who text check (who is null or length(who) between 1 and 40),
  version text check (version is null or version ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$'),
  file text check (file is null or length(file) between 1 and 120)
);

create index if not exists hf_studio_downloads_created_idx on public.hf_studio_downloads (created_at desc);

alter table public.hf_studio_downloads enable row level security;

revoke all on table public.hf_studio_downloads from public, anon, authenticated, service_role;
grant select, insert on table public.hf_studio_downloads to service_role;

comment on table public.hf_studio_downloads is
  'Synchro video studio downloads: one row per studio_latest call (link owner, team first name, version and file given out). Written only by higgsfield-mcp (service role).';

-- Assert: no browser role holds anything, service_role holds exactly INSERT and SELECT.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_studio_downloads'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then raise exception 'hf_studio_downloads: a browser role holds privileges'; end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace, aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'hf_studio_downloads' and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT' then
    raise exception 'hf_studio_downloads: service_role holds % (expected INSERT,SELECT)', sr;
  end if;
end
$assert$;

commit;
