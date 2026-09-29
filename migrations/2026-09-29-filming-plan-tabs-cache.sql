-- ============================================================
-- NOT APPLIED. Written 2026-09-29 by Forge for the filming-plan-tabs Edge
-- Function (docs/plans/2026-09-28-n8n-exit.md, PR 1a). Lighthouse applies it
-- with the owner's go, then the function is deployed.
--
-- One small cache table: the tab list of a client's filming-plan Google Doc, so
-- opening Kasper > Filming costs no Google or n8n call while a copy is under a
-- few hours old. The function reads and writes it with service_role only. No
-- browser role holds anything on it (Doc ids are links to client documents).
--
-- Supabase grants service_role, anon and authenticated full rights on every new
-- object by default, so the revoke names all four and service_role is then
-- given back only what the function needs (select, insert, update; no delete).
--
-- Rollback: drop table public.filming_plan_tabs_cache;  (a cache, nothing is lost)
-- ============================================================
begin;
set local lock_timeout = '5s';

create table if not exists public.filming_plan_tabs_cache (
  doc_id     text primary key,
  tabs       jsonb not null default '[]'::jsonb,
  source     text not null default 'google' check (source in ('google', 'n8n')),
  fetched_at timestamptz not null default now()
);

alter table public.filming_plan_tabs_cache enable row level security;

revoke all on table public.filming_plan_tabs_cache from public, anon, authenticated, service_role;
grant select, insert, update on table public.filming_plan_tabs_cache to service_role;

-- Assert: no browser role holds anything, service_role holds exactly select,
-- insert and update.
do $assert$
declare n int; sr text;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'filming_plan_tabs_cache'
    and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid, 0::oid);
  if n <> 0 then
    raise exception 'browser roles still hold % privileges on filming_plan_tabs_cache', n;
  end if;
  select string_agg(a.privilege_type, ',' order by a.privilege_type) into sr
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public' and c.relname = 'filming_plan_tabs_cache'
    and a.grantee = 'service_role'::regrole::oid;
  if sr is distinct from 'INSERT,SELECT,UPDATE' then
    raise exception 'service_role privileges are %, expected INSERT,SELECT,UPDATE', sr;
  end if;
end
$assert$;

commit;
