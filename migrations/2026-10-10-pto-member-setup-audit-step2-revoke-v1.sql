-- ============================================================
-- 2026-10-10 — PTO Member setup audit, STEP 2 of 2 (OPEN_REPAIRS 399).
--
-- NOT APPLIED. Apply ONLY AFTER both of these are done and read back:
--   1. migrations/2026-10-10-pto-member-setup-audit.sql is applied, and
--   2. the pto Edge Function from main (which calls pto_set_member_start_v2)
--      is deployed through .github/workflows/deploy-pto-edge-functions.yml.
--
-- WHAT. Takes EXECUTE on the old pto_set_member_start_v1 away from all four
-- roles (public, anon, authenticated, service_role), so no caller can still
-- change a start date or the PTO switch without leaving a pto_member_events
-- row. The function body stays, so undoing this is one GRANT (below).
--
-- If this is applied too early, the still-deployed old function's Member
-- setup save fails with "Time Off is temporarily unavailable" and writes
-- nothing (fail closed); deploying the new function, or the undo below,
-- clears it. Nothing else calls v1: test/linear-exit-owner-composition.js
-- uses it only on a disposable database.
--
-- Idempotent: safe to run twice. Refuses to run if v2 is missing, so it can
-- never leave Member setup with no working function at all.
-- ============================================================
begin;

do $pto_member_setup_audit_step2$
begin
  if to_regprocedure('public.pto_set_member_start_v2(uuid,date,boolean,bigint,text)') is null
     or to_regclass('public.pto_member_events') is null then
    raise exception 'apply migrations/2026-10-10-pto-member-setup-audit.sql (and deploy the pto function) before step 2';
  end if;
  if to_regprocedure('public.pto_set_member_start_v1(uuid,date,boolean,bigint)') is not null then
    execute 'revoke all on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) from public, anon, authenticated, service_role';
  end if;
end
$pto_member_setup_audit_step2$;

commit;

-- READBACK (expect all four false):
-- select has_function_privilege('anon', 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)', 'EXECUTE') anon_v1,
--   has_function_privilege('authenticated', 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)', 'EXECUTE') auth_v1,
--   has_function_privilege('service_role', 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)', 'EXECUTE') sr_v1,
--   exists (select 1 from aclexplode((select proacl from pg_proc where oid = 'public.pto_set_member_start_v1(uuid,date,boolean,bigint)'::regprocedure))
--     where grantee = 0) public_v1;

-- UNDO (only if the old pto function has to run again):
-- grant execute on function public.pto_set_member_start_v1(uuid, date, boolean, bigint) to service_role;
