-- ============================================================
-- APPLIED 2026-09-27 by Lighthouse with the owner's go (PR #1772), exactly
-- as the SQL below reads; guard and assert passed. Revokes every table privilege the "authenticated" role holds
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
-- READBACK (read only). Corrected after review; the SQL above is unchanged.
--
-- 1. Exact grants on the three tables, per role.
--    BEFORE (read live 2026-09-27):
--      anon          DELETE,INSERT,MAINTAIN,REFERENCES,TRIGGER,TRUNCATE,UPDATE (x3)
--      authenticated all eight incl. SELECT (x3)
--      postgres, service_role: all eight (x3)
--    AFTER (read live 2026-09-27, post-apply): identical, no authenticated rows.
--
-- select c.relname, a.grantee::regrole, string_agg(a.privilege_type, ',' order by a.privilege_type)
-- from pg_class c join pg_namespace n on n.oid=c.relnamespace, aclexplode(c.relacl) a
-- where n.nspname='public' and c.relname in ('filming_plans','smm_weekly_reports','social_media_managers')
-- group by 1,2 order by 1,2;
--
-- 2. Full "authenticated can, anon cannot" delta across every kind: tables
--    (incl. MAINTAIN), sequences, columns, function EXECUTE, schema USAGE and
--    CREATE, and policies in every schema (storage and realtime included).
--    BEFORE: 3 table rows, each SELECT only (anon already held the other
--    seven, so they were never a delta). AFTER (read live 2026-09-27,
--    post-apply): 0 rows. Re-run this before turning guest sign-in on.
--
-- select kind, obj, string_agg(priv, ',' order by priv) privs from (
-- with rel as (
--   select c.oid, n.nspname, c.relname, c.relkind
--   from pg_class c join pg_namespace n on n.oid = c.relnamespace
--   where n.nspname not in ('pg_catalog','information_schema')
--     and n.nspname not like 'pg_toast%' and n.nspname not like 'pg_temp%'
-- )
-- select 'table' kind, nspname || '.' || relname obj, p priv
-- from rel cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
-- where relkind in ('r','v','m','f','p')
--   and has_table_privilege('authenticated', oid, p) and not has_table_privilege('anon', oid, p)
-- union all
-- select 'sequence', nspname || '.' || relname, p
-- from rel cross join unnest(array['USAGE','SELECT','UPDATE']) p
-- where relkind = 'S'
--   and has_sequence_privilege('authenticated', oid, p) and not has_sequence_privilege('anon', oid, p)
-- union all
-- select 'column', r.nspname || '.' || r.relname || '.' || a.attname, p
-- from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
-- cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p
-- where r.relkind in ('r','v','m','f','p')
--   and has_column_privilege('authenticated', r.oid, a.attnum, p) and not has_column_privilege('anon', r.oid, a.attnum, p)
--   and not has_table_privilege('authenticated', r.oid, p)   -- already counted at table level
-- union all
-- select 'function', n.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')', 'EXECUTE'
-- from pg_proc f join pg_namespace n on n.oid = f.pronamespace
-- where n.nspname not in ('pg_catalog','information_schema') and n.nspname not like 'pg_%'
--   and has_function_privilege('authenticated', f.oid, 'EXECUTE') and not has_function_privilege('anon', f.oid, 'EXECUTE')
-- union all
-- select 'schema', n.nspname, p
-- from pg_namespace n cross join unnest(array['USAGE','CREATE']) p
-- where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'
--   and has_schema_privilege('authenticated', n.oid, p) and not has_schema_privilege('anon', n.oid, p)
-- union all
-- select 'policy', schemaname || '.' || tablename || ':' || policyname, cmd
-- from pg_policies
-- where roles && array['authenticated']::name[] and not (roles && array['anon','public']::name[])
-- ) d group by 1,2 order by 1,2;
-- ============================================================
