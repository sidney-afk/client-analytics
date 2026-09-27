-- ============================================================
-- NOT APPLIED -- revoke every table privilege the "authenticated" role holds
-- on public.filming_plans, public.smm_weekly_reports and
-- public.social_media_managers.
--
-- Why: SyncView v2 will use Supabase anonymous (guest) sign-in. A guest login
-- carries role "authenticated". A read-only audit on 2026-09-27 found these
-- three tables are the ONLY objects where "authenticated" holds a right that
-- "anon" does not: SELECT (each has a `using (true)` read policy naming anon
-- and authenticated, but only authenticated holds the SELECT grant), plus
-- INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. No other table,
-- view, sequence, column grant, function EXECUTE, storage policy or schema
-- USAGE favoured authenticated over anon.
--
-- Why this cannot change v1: v1 never uses the authenticated role (auth.users
-- held 0 rows on 2026-09-27). v1 reads these tables through the
-- filming-plans and smm-weekly-reports Edge Functions, which use service_role.
-- anon, service_role and postgres grants are untouched. Policies untouched.
--
-- Rollback: migrations/2026-09-27-authenticated-grants-revoke-three.ROLLBACK.sql
-- Readback: run the "READBACK" block below before and after.
-- ============================================================
begin;
set local lock_timeout = '5s';

-- Refuse if a policy anywhere now favours authenticated alone (the audit's
-- premise); a new one would need its own review first.
do $guard$
begin
  if exists (
    select 1 from pg_policies
    where roles && array['authenticated']::name[]
      and not (roles && array['anon','public']::name[])
  ) then
    raise exception 'authenticated-only policy exists; re-audit before revoking';
  end if;
end
$guard$;

revoke all on table public.filming_plans         from authenticated;
revoke all on table public.smm_weekly_reports    from authenticated;
revoke all on table public.social_media_managers from authenticated;

-- Assert: authenticated now holds nothing on the three tables.
do $assert$
declare n int;
begin
  select count(*) into n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace,
       aclexplode(c.relacl) a
  where s.nspname = 'public'
    and c.relname in ('filming_plans','smm_weekly_reports','social_media_managers')
    and a.grantee = 'authenticated'::regrole;
  if n <> 0 then
    raise exception 'authenticated still holds % privileges', n;
  end if;
end
$assert$;

commit;

-- ============================================================
-- READBACK (read only). Expected BEFORE: 3 rows, each
--   DELETE,INSERT,MAINTAIN,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE
-- Expected AFTER: 0 rows.
--
-- with o as (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
--   where n.nspname not in ('pg_catalog','information_schema') and c.relkind in ('r','v','m','p','f'))
-- select o.relname, string_agg(p, ',' order by p) extra
-- from o cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
-- where has_table_privilege('authenticated', o.oid, p) and not has_table_privilege('anon', o.oid, p)
-- group by 1 order by 1;
--
-- Also confirm anon and service_role are unchanged:
-- select c.relname, a.grantee::regrole, string_agg(a.privilege_type, ',' order by a.privilege_type)
-- from pg_class c join pg_namespace n on n.oid=c.relnamespace, aclexplode(c.relacl) a
-- where n.nspname='public' and c.relname in ('filming_plans','smm_weekly_reports','social_media_managers')
-- group by 1,2 order by 1,2;
-- ============================================================
