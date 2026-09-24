-- ROLLBACK for 2026-09-24-retire-tiktok-pilot-and-content-samples.sql (NOT APPLIED).
-- Moves the four tables back to public intact. Grants are NOT restored
-- automatically: re-apply the pre-move grants captured in EXECUTION_LOG.md
-- (capture them with \dp before applying the forward migration).
begin;
alter table retired_20260924.tiktok_accounts    set schema public;
alter table retired_20260924.tiktok_oauth_state set schema public;
alter table retired_20260924.tiktok_pilot_posts set schema public;
alter table retired_20260924.content_samples    set schema public;
alter publication supabase_realtime add table public.content_samples; -- only if it was published before (check the capture)
drop schema retired_20260924;
commit;
