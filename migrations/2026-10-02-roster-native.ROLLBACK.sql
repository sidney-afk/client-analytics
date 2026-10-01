-- Way back for 2026-10-02-roster-native.sql. Safe while client_profiles_authority
-- still reads "sheet" (nothing has written through these objects). If the switch
-- was already flipped and rows were written natively, keep the two history tables
-- (they are the only record of those edits) and drop only the functions.
begin;
-- FIRST restore the original client_profile_admin_edit by re-running
-- migrations/2026-09-25-client-profile-edits.sql (idempotent). The new body calls
-- roster_authority(), so dropping that function before this step would break the
-- Clients tab's save.
drop function if exists public.smm_assign_client(text, text, text, text, text, text, text, text);
drop function if exists public.client_profile_service_write(text, text, jsonb, jsonb, jsonb, text, text, text);
drop function if exists public.roster_authority();
-- Only when nothing was written natively:
-- drop table if exists public.roster_sheet_outbox;
-- drop table if exists public.smm_assignment_edits;
-- alter table public.social_media_managers drop column if exists slack_profile_url;
commit;
