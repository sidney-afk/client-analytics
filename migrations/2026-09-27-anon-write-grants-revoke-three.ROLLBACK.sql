-- ============================================================
-- NOT APPLIED -- rollback for
-- migrations/2026-09-27-anon-write-grants-revoke-three.sql.
-- Restores exactly the six grants anon held on 2026-09-27 (read live), none
-- grantable. SELECT and MAINTAIN were never touched and are not granted here.
-- ============================================================
begin;
set local lock_timeout = '5s';
grant insert, update, delete, truncate, references, trigger
  on table public.filming_plans, public.smm_weekly_reports, public.social_media_managers
  to anon;
commit;
