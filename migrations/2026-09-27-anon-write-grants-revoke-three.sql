-- ============================================================
-- NOT APPLIED -- revoke INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and
-- TRIGGER from anon on public.filming_plans, public.smm_weekly_reports and
-- public.social_media_managers. Owner's go 2026-09-27; Lighthouse applies.
--
-- Why: anon (the publishable key shipped in v1's index.html) holds these
-- write grants. Row level security refuses row writes (no write policy), but
-- TRUNCATE ignores RLS. Same defence-in-depth gap phase 0 closed on the five
-- card tables (docs/ops/ANON_READ_SCOPE_2026-09-26.md).
--
-- Unchanged: anon holds no SELECT today and still holds none (reads are
-- unchanged); MAINTAIN is not in the owner's list and is left as is;
-- service_role, postgres and every policy are untouched; authenticated
-- already holds nothing here (2026-09-27-authenticated-grants-revoke-three).
-- Why v1 cannot change: v1 reads and writes these tables only through the
-- filming-plans and smm-weekly-reports Edge Functions, which run as
-- service_role; the browser never writes them directly.
--
-- Rollback: migrations/2026-09-27-anon-write-grants-revoke-three.ROLLBACK.sql
-- ============================================================
begin;
set local lock_timeout = '5s';

-- Guard: refuse if any policy lets anon write these tables (then the grants
-- would be in real use and need their own review).
do $guard$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('filming_plans','smm_weekly_reports','social_media_managers')
      and cmd in ('INSERT','UPDATE','DELETE','ALL')
      and roles && array['anon','public']::name[]
  ) then
    raise exception 'an anon write policy exists on these tables; re-audit before revoking';
  end if;
end
$guard$;

revoke insert, update, delete, truncate, references, trigger
  on table public.filming_plans, public.smm_weekly_reports, public.social_media_managers
  from anon;

-- Assert: anon holds none of the six; its SELECT state is unchanged (none);
-- service_role still holds all eight.
do $assert$
declare t text; p text;
begin
  foreach t in array array['public.filming_plans','public.smm_weekly_reports','public.social_media_managers'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      if has_table_privilege('anon', t, p) then raise exception 'anon still holds % on %', p, t; end if;
    end loop;
    if has_table_privilege('anon', t, 'SELECT') then raise exception 'anon unexpectedly holds SELECT on %', t; end if;
    foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] loop
      if not has_table_privilege('service_role', t, p) then raise exception 'service_role lost % on %', p, t; end if;
    end loop;
  end loop;
end
$assert$;

commit;

-- ============================================================
-- READBACK (read only; run before and after).
--   BEFORE (read live 2026-09-27):
--     anon          DELETE,INSERT,MAINTAIN,REFERENCES,TRIGGER,TRUNCATE,UPDATE (x3)
--     postgres      all eight (x3)
--     service_role  all eight (x3)
--     (no authenticated rows)
--   AFTER: anon MAINTAIN only (x3); postgres and service_role unchanged.
--
-- select c.relname, a.grantee::regrole, string_agg(a.privilege_type, ',' order by a.privilege_type)
-- from pg_class c join pg_namespace n on n.oid=c.relnamespace, aclexplode(c.relacl) a
-- where n.nspname='public' and c.relname in ('filming_plans','smm_weekly_reports','social_media_managers')
-- group by 1,2 order by 1,2;
-- ============================================================
