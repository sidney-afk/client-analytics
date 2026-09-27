-- ============================================================
-- NOT APPLIED -- rollback for
-- migrations/2026-09-27-authenticated-grants-revoke-three.sql.
-- Restores exactly the grants "authenticated" held on 2026-09-27 (read live):
-- DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE,
-- none grantable. ALL on a table in PostgreSQL 17 is exactly that set.
--
-- DANGER: while anonymous (guest) sign-ins are ON, this hands every guest
-- SELECT on every row of these tables, and TRUNCATE (which ignores RLS).
-- The guest switch lives in Supabase Auth settings, which SQL cannot read, so
-- this file refuses unless BOTH hold:
--   1. auth.users holds no guest (is_anonymous) account, and
--   2. the operator states in this same session, after checking
--      Dashboard > Authentication > Sign In / Providers > "Allow anonymous
--      sign-ins" is OFF:
--        set syncview.guest_signin_off_confirmed = 'yes';
-- ============================================================
begin;
set local lock_timeout = '5s';
do $guard$
begin
  if coalesce(current_setting('syncview.guest_signin_off_confirmed', true), '') <> 'yes' then
    raise exception 'refused: confirm anonymous sign-ins are OFF, then: set syncview.guest_signin_off_confirmed = ''yes'';';
  end if;
  if exists (select 1 from auth.users where is_anonymous) then
    raise exception 'refused: guest accounts exist in auth.users, so guest sign-in has been used; do not re-grant';
  end if;
end
$guard$;
grant all on table public.filming_plans         to authenticated;
grant all on table public.smm_weekly_reports    to authenticated;
grant all on table public.social_media_managers to authenticated;
commit;
