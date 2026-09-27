-- ============================================================
-- NOT APPLIED -- rollback for
-- migrations/2026-09-27-authenticated-grants-revoke-three.sql.
-- Restores exactly the grants "authenticated" held on 2026-09-27 (read live):
-- DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE,
-- none grantable. ALL on a table in PostgreSQL 17 is exactly that set.
-- Do not apply while anonymous sign-ins are ON: it re-opens these three
-- tables to every guest login.
-- ============================================================
begin;
set local lock_timeout = '5s';
grant all on table public.filming_plans         to authenticated;
grant all on table public.smm_weekly_reports    to authenticated;
grant all on table public.social_media_managers to authenticated;
commit;
