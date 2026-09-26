-- NOT APPLIED -- rollback for 2026-09-26-scoped-read-policies.sql. Restores the
-- 2026-09-26 live read access exactly: `using (true)` read policies (calendar
-- and samples for anon; production tables for anon and authenticated) and the
-- anon SELECT grants. This re-opens every client's rows to the anon key; use it
-- only to undo a broken rollout.
begin;
drop policy if exists "session read calendar_posts" on public.calendar_posts;
drop policy if exists "session read sample_reviews" on public.sample_reviews;
drop policy if exists "session read deliverables" on public.deliverables;
drop policy if exists "session read batches" on public.batches;
drop policy if exists "session read deliverable_events" on public.deliverable_events;
create policy "anon read calendar_posts" on public.calendar_posts for select to anon using (true);
create policy "anon read sample_reviews" on public.sample_reviews for select to anon using (true);
create policy "anon read deliverables" on public.deliverables for select to authenticated, anon using (true);
create policy "anon read batches" on public.batches for select to authenticated, anon using (true);
create policy "anon read deliverable_events" on public.deliverable_events for select to authenticated, anon using (true);
grant select on public.calendar_posts, public.sample_reviews, public.deliverable_events to anon;
-- deliverables and batches were readable column by column (brief, file_url,
-- comments, linear_raw and the three folder links / comments stay hidden).
grant select (id, identifier, batch_id, client_slug, team, kind, title, status, status_at, assignee_id,
  due_date, priority, origin, card_id, sort_key, sync_state, created_by, created_at, updated_at,
  linear_issue_uuid, linear_identifier, linear_issue_url, linear_aliases, artifact_revision)
  on public.deliverables to anon;
grant select (id, client_slug, team, name, description, color, status, sort_key, created_by,
  created_at, updated_at, linear_parent_ids, purpose) on public.batches to anon;
commit;
