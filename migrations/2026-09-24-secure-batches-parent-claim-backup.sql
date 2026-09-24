-- ============================================================
-- Secure public.batches_parent_claim_backup_20260824 (OPEN_REPAIRS 246).
--
-- Live read 2026-09-24 (read-only): RLS OFF, no policies, and
-- relacl = {postgres=arwdDxtm, anon=arwdDxtm, authenticated=arwdDxtm,
-- service_role=arwdDxtm}. So the browser publishable key could read,
-- insert, update, delete and truncate this backup (1455 rows).
-- Nothing reads it: no function, view, cron job or Edge Function names it,
-- except the two aaa_application_dml_admission_* triggers ON the table and
-- production_retirement_contract_assert_v1, which pins those triggers'
-- definition md5s only (pg_get_triggerdef; not RLS, not ACLs).
--
-- This enables RLS with NO policies and revokes every privilege from public,
-- anon and authenticated. postgres (owner) and service_role (BYPASSRLS) keep
-- their existing rights. The triggers and the table's rows are untouched.
-- Idempotent. Does not drop the table.
-- ============================================================
begin;
alter table public.batches_parent_claim_backup_20260824 enable row level security;
revoke all on table public.batches_parent_claim_backup_20260824 from public, anon, authenticated;
commit;

-- VERIFY (expect: rls=true, acl={postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres},
-- anon_any=false, authenticated_any=false, policies=0, triggers unchanged = 2):
-- select c.relrowsecurity rls, c.relacl::text acl,
--   has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') anon_any,
--   has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') authenticated_any,
--   (select count(*) from pg_policy where polrelid = c.oid) policies,
--   (select count(*) from pg_trigger where tgrelid = c.oid and not tgisinternal) triggers
-- from pg_class c where c.oid = 'public.batches_parent_claim_backup_20260824'::regclass;
-- select public.production_retirement_contract_assert_v1();  -- must still pass

-- ROLLBACK (restores the exact prior state read live 2026-09-24; re-opens the exposure):
-- begin;
-- alter table public.batches_parent_claim_backup_20260824 disable row level security;
-- grant select, insert, update, delete, truncate, references, trigger, maintain
--   on table public.batches_parent_claim_backup_20260824 to anon, authenticated;
-- commit;
