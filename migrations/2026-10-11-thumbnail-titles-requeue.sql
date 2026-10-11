-- Thumbnail titles: put "Needs info" items back in the queue (OPEN_REPAIRS 405). Follows
-- 2026-10-10-thumbnail-titles-error-record.sql.
--
-- A "Needs info: ..." line sits in the work item's description, and the robot only writes into an
-- EMPTY description, so an item cannot simply be set back to pending. This adds one function that
-- does both, safely:
--   thumbnail_titles_requeue_needs_info(p_outcomes text[], p_client_slug text default null, p_apply boolean default false)
--     * only queue rows in state needs_info with an outcome in p_outcomes (and the one client, when given);
--     * a description that is already empty is left as it is (the row just goes back to pending); one that
--       is EXACTLY one of the robot's own "Needs info: ..." lines is cleared first (a whole-line match, checked
--       again at the moment of clearing; a line a person appended to or reworded is not a match). A description a person has
--       written or edited since is never touched, and that row is left alone (and not counted);
--     * the clearing is recorded in deliverable_events like every other robot write;
--     * p_apply = false (the default) changes nothing and returns counts per outcome.
--   Service role only, like the other thumbnail_titles_* functions.
--
-- Run it only after the new thumbnail-titles function is deployed, so the items are read by the new code.
begin;

create or replace function public.thumbnail_titles_requeue_needs_info(p_outcomes text[], p_client_slug text default null, p_apply boolean default false)
returns table(outcome text, items integer)
language plpgsql set search_path = public, pg_catalog as $$
declare r record; cleared integer; v_rows jsonb; v_skipped text[] := '{}';
  -- The robot's own lines, whole and exact (see NEEDS_INFO_TEXT in thumbnail-titles/logic.mjs). A line a person
  -- has added to, shortened or reworded matches none of these and is never cleared.
  v_lines constant text[] := array[
    '^Needs info: no filming plan is linked to this client in SyncView, so no thumbnail title was written\. Add the title here by hand\.$',
    '^Needs info: the client''s filming plan could not be opened \(it may not be shared by link\), so no thumbnail title was written\. Add the title here by hand\.$',
    '^Needs info: the client''s filming plan is empty, so no thumbnail title was written\. Add the title here by hand\.$',
    '^Needs info: the client''s filming plan has no tab for [A-Za-z ]{1,30}[0-9]{0,4}, so no thumbnail title was written\. Add the title here by hand\.$',
    '^Needs info: this post could not be matched to a video in the filming plan( \(post "[^"]{0,80}"\))?, so no thumbnail title was written\. Add the title here by hand\.$',
    '^Needs info: the suggested title did not use the filming plan''s own words, so it was not used\. Add the title here by hand\.$',
    '^Needs info: a thumbnail title could not be generated after several tries\. Add the title here by hand\.$'
  ];
begin
  if p_outcomes is null or cardinality(p_outcomes) = 0 then
    raise exception 'thumbnail_titles_requeue_needs_info_outcomes_required';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', q.deliverable_id, 'o', q.outcome)), '[]'::jsonb) into v_rows
    from public.thumbnail_title_queue q
    join public.deliverables d on d.id = q.deliverable_id
   where q.state = 'needs_info'
     and q.outcome = any(p_outcomes)
     and (p_client_slug is null or q.client_slug = p_client_slug)
     and d.kind = 'thumbnail'
     and d.status not in ('canceled', 'duplicate')
     and (coalesce(btrim(d.brief), '') = '' or d.brief ~ any(v_lines));
  if p_apply then
    for r in select e->>'id' as id from jsonb_array_elements(v_rows) e loop
      perform set_config('app.event_written', '1', true);
      update public.deliverables set brief = '' where id = r.id and brief ~ any(v_lines);
      get diagnostics cleared = row_count;
      if cleared = 1 then
        insert into public.deliverable_events (deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status, source, payload)
        select d.id, d.batch_id, d.client_slug, 'SyncView thumbnail titles', 'system', 'description_change', d.status, d.status, 'system',
               jsonb_build_object('surface', 'thumbnail_titles', 'outcome', 'requeue', 'description_length', 0)
          from public.deliverables d where d.id = r.id;
      end if;
      perform set_config('app.event_written', '', true);
      -- Changed by a person since the selection: leave it alone, and out of the count.
      if cleared = 0 and exists (select 1 from public.deliverables d where d.id = r.id and coalesce(btrim(d.brief), '') <> '') then
        v_skipped := v_skipped || r.id;
        continue;
      end if;
      update public.thumbnail_title_queue
         set state = 'pending', attempts = 0, outcome = null, lease_until = null, last_error = null, updated_at = now()
       where deliverable_id = r.id and state = 'needs_info';
    end loop;
  end if;
  return query select e->>'o', count(*)::integer
                 from jsonb_array_elements(v_rows) e
                where not ((e->>'id') = any(v_skipped))
                group by 1 order by 2 desc;
end $$;

revoke all on function public.thumbnail_titles_requeue_needs_info(text[], text, boolean) from public, anon, authenticated, service_role;
grant execute on function public.thumbnail_titles_requeue_needs_info(text[], text, boolean) to service_role;

commit;

-- DRY RUN (counts only, changes nothing; run as service role):
--   select * from public.thumbnail_titles_requeue_needs_info(array['no_match','no_month_tab','generation_failed']);
-- APPLY for one client first, then the rest:
--   select * from public.thumbnail_titles_requeue_needs_info(array['no_match','no_month_tab','generation_failed'], '<client slug>', true);
-- VERIFY: select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'thumbnail_titles_requeue_needs_info';
-- ROLLBACK: drop function public.thumbnail_titles_requeue_needs_info(text[], text, boolean);
