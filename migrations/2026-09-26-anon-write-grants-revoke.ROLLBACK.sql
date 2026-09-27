-- NOT APPLIED -- rollback for 2026-09-26-anon-write-grants-revoke.sql.
-- Restores the Supabase default write grants exactly as they were read live on
-- 2026-09-26 (anon and authenticated both held all six). Row level security
-- still refuses the row writes, as before.
begin;
grant insert, update, delete, truncate, references, trigger
  on public.calendar_posts, public.sample_reviews, public.deliverables,
     public.batches, public.deliverable_events
  to anon, authenticated;
commit;
