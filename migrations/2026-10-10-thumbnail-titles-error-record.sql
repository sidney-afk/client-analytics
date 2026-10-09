-- Thumbnail titles: keep the reason on record (OPEN_REPAIRS 393). Follows
-- 2026-10-09-thumbnail-titles.sql.
--
-- The backfill on 2026-10-09 ended 15 items as generation_failed with last_error empty on every row:
-- the earlier tries had stored a reason, and the final write (thumbnail_title_apply) set last_error back
-- to null. thumbnail_title_apply now takes an optional p_error and keeps it, so the row that ends in
-- "Needs info: ... could not be generated" says why. A write that leaves no error keeps clearing it.
--
-- The four-argument version is replaced in the same transaction; the new fifth argument has a default,
-- so a caller still sending four named arguments (the function as deployed before this change) keeps
-- working until the function is redeployed.
begin;

drop function if exists public.thumbnail_title_apply(text, text, text, text);

create or replace function public.thumbnail_title_apply(p_deliverable_id text, p_text text, p_state text, p_outcome text, p_error text default null)
returns text language plpgsql set search_path = public, pg_catalog as $$
declare d public.deliverables%rowtype; final_state text;
begin
  if p_state not in ('written', 'needs_info') or coalesce(btrim(p_text), '') = '' or length(p_text) > 2000 then
    raise exception 'thumbnail_title_apply_invalid';
  end if;
  select * into d from public.deliverables where id = p_deliverable_id for update;
  if not found or d.kind <> 'thumbnail' or d.status in ('canceled', 'duplicate') then
    final_state := 'skipped_gone';
  elsif coalesce(btrim(d.brief), '') <> '' then
    final_state := 'skipped_human';
  else
    perform set_config('app.event_written', '1', true);
    update public.deliverables set brief = p_text where id = d.id;
    insert into public.deliverable_events (deliverable_id, batch_id, client_slug, actor, role, action, from_status, to_status, source, payload)
    values (d.id, d.batch_id, d.client_slug, 'SyncView thumbnail titles', 'system', 'description_change', d.status, d.status, 'system',
            jsonb_build_object('surface', 'thumbnail_titles', 'outcome', p_outcome, 'description_length', length(p_text)));
    perform set_config('app.event_written', '', true);
    final_state := p_state;
  end if;
  update public.thumbnail_title_queue
     set state = final_state, outcome = case when final_state in ('written', 'needs_info') then p_outcome else final_state end,
         lease_until = null,
         last_error = case when final_state in ('written', 'needs_info') then nullif(left(coalesce(p_error, ''), 300), '') else last_error end,
         updated_at = now()
   where deliverable_id = p_deliverable_id
     -- A refused write never overwrites the record of a line already written.
     and (final_state in ('written', 'needs_info') or state in ('pending', 'running'));
  return final_state;
end $$;

revoke all on function public.thumbnail_title_apply(text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.thumbnail_title_apply(text, text, text, text, text) to service_role;

commit;

-- VERIFY: select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'thumbnail_title_apply';
--   one row: p_deliverable_id text, p_text text, p_state text, p_outcome text, p_error text
-- ROLLBACK: re-run the thumbnail_title_apply block of 2026-10-09-thumbnail-titles.sql after
--   drop function public.thumbnail_title_apply(text, text, text, text, text);
