-- Thumbnail titles: put "Needs info" items back in the queue (OPEN_REPAIRS 405). Follows
-- 2026-10-10-thumbnail-titles-error-record.sql.
--
-- A "Needs info: ..." line sits in the work item's description, and the robot only writes into an
-- EMPTY description, so an item cannot simply be set back to pending. This adds one function that
-- does both, safely:
--   thumbnail_titles_requeue_needs_info(p_outcomes text[], p_client_slug text default null, p_apply boolean default false)
--     * only queue rows in state needs_info with an outcome in p_outcomes (and the one client, when given);
--     * a description that is already empty is left as it is (the row just goes back to pending); one that
--       still STARTS WITH the robot's own "Needs info: " text is cleared first. A description a person has
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
declare r record; cleared integer;
begin
  if p_outcomes is null or cardinality(p_outcomes) = 0 then
    raise exception 'thumbnail_titles_requeue_needs_info_outcomes_required';
  end if;
  create temp table if not exists _tt_requeue (deliverable_id text, outcome text) on commit drop;
  delete from _tt_requeue;
  insert into _tt_requeue
  select q.deliverable_id, q.outcome
    from public.thumbnail_title_queue q
    join public.deliverables d on d.id = q.deliverable_id
   where q.state = 'needs_info'
     and q.outcome = any(p_outcomes)
     and (p_client_slug is null or q.client_slug = p_client_slug)
     and d.kind = 'thumbnail'
     and d.status not in ('canceled', 'duplicate')
     and (coalesce(btrim(d.brief), '') = '' or d.brief like 'Needs info: %');
  if p_apply then
    for r in select t.deliverable_id from _tt_requeue t loop
      perform set_config('app.event_written', '1', true);
      update public.deliverables set brief = '' where id = r.deliverable_id and brief like 'Needs info: %';
      get diagnostics cleared = row_count;
      if cleared = 1 then
        insert into public.deliverable_events (deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status, source, payload)
        select d.id, d.batch_id, d.client_slug, 'SyncView thumbnail titles', 'system', 'description_change', d.status, d.status, 'system',
               jsonb_build_object('surface', 'thumbnail_titles', 'outcome', 'requeue', 'description_length', 0)
          from public.deliverables d where d.id = r.deliverable_id;
      end if;
      perform set_config('app.event_written', '', true);
      update public.thumbnail_title_queue
         set state = 'pending', attempts = 0, outcome = null, lease_until = null, last_error = null, updated_at = now()
       where deliverable_id = r.deliverable_id and state = 'needs_info';
    end loop;
  end if;
  return query select t.outcome, count(*)::integer from _tt_requeue t group by t.outcome order by 2 desc;
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
