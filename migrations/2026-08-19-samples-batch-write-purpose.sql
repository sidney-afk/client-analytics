-- Samples native create, persistence layer (owner task 2026-08-18:
-- "samples should have their own batches").
--
-- SUPERSEDES nothing. Replaces ONE function: public.batch_write.
-- Requires migrations/2026-08-19-samples-batch-purpose.sql (the column).
--
-- WHY THIS IS REQUIRED, AND WHY IT IS EASY TO MISS
-- The gateway now stamps `purpose` on the batch it sends. batch_write inserts
-- through an EXPLICIT column list, so a key it does not name is silently
-- dropped -- no error, no warning. Without this migration every samples batch
-- would be written with the column default 'calendar', the Samples picker
-- would show nothing, the Calendar picker would show samples batches, and the
-- only symptom would be "the feature does not work". That is the same failure
-- shape as the append chain: an upper layer sending a field a lower layer
-- quietly ignores.
--
-- THE CONFLICT BRANCH MATTERS AS MUCH AS THE INSERT
-- Every sibling column updates under a `v_row ? 'key'` guard so a partial
-- write preserves what it does not mention. `purpose` follows that pattern
-- exactly: without the guard, ANY later batch update that omits purpose --
-- a rename, a status change, a colour change -- would reset a samples batch
-- to 'calendar'.
--
-- Derived mechanically from the live definition in
-- migrations/2026-07-06-b1-linear-data-model.sql (three edits: one column, one
-- value, one guarded update) so nothing else in the function drifts.
--
-- Compiled and behaviour-proven against a disposable PostgreSQL 16 before
-- handover, per the house rule.

begin;

create or replace function public.batch_write(p_row jsonb, p_event jsonb default '{}'::jsonb)
returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_id text := nullif(v_row->>'id', '');
  v_old_status text;
  v_result public.batches%rowtype;
  v_action text;
begin
  if v_id is null then
    v_id := 'bat_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  select b.status into v_old_status
    from public.batches b
   where b.id = v_id
   for update;

  perform set_config('app.event_written', '1', true);

  insert into public.batches as b (
    id,
    client_slug,
    team,
    name,
    description,
    filming_doc_url,
    footage_folder_url,
    delivery_folder_url,
    color,
    status,
    purpose,
    comments,
    sort_key,
    created_by,
    created_at,
    updated_at,
    linear_parent_ids
  )
  values (
    v_id,
    nullif(v_row->>'client_slug', ''),
    nullif(v_row->>'team', ''),
    coalesce(nullif(v_row->>'name', ''), 'Untitled batch'),
    nullif(v_row->>'description', ''),
    nullif(v_row->>'filming_doc_url', ''),
    nullif(v_row->>'footage_folder_url', ''),
    nullif(v_row->>'delivery_folder_url', ''),
    nullif(v_row->>'color', ''),
    coalesce(nullif(v_row->>'status', ''), 'active'),
    coalesce(nullif(v_row->>'purpose', ''), 'calendar'),
    nullif(v_row->>'comments', ''),
    nullif(v_row->>'sort_key', '')::numeric,
    nullif(v_row->>'created_by', ''),
    coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(v_row->'linear_parent_ids', 'null'::jsonb)
  )
  on conflict (id) do update set
    client_slug = case when v_row ? 'client_slug' then excluded.client_slug else b.client_slug end,
    team = case when v_row ? 'team' then excluded.team else b.team end,
    name = case when v_row ? 'name' then excluded.name else b.name end,
    description = case when v_row ? 'description' then excluded.description else b.description end,
    filming_doc_url = case when v_row ? 'filming_doc_url' then excluded.filming_doc_url else b.filming_doc_url end,
    footage_folder_url = case when v_row ? 'footage_folder_url' then excluded.footage_folder_url else b.footage_folder_url end,
    delivery_folder_url = case when v_row ? 'delivery_folder_url' then excluded.delivery_folder_url else b.delivery_folder_url end,
    color = case when v_row ? 'color' then excluded.color else b.color end,
    status = case when v_row ? 'status' then excluded.status else b.status end,
    purpose = case when v_row ? 'purpose' then excluded.purpose else b.purpose end,
    comments = case when v_row ? 'comments' then excluded.comments else b.comments end,
    sort_key = case when v_row ? 'sort_key' then excluded.sort_key else b.sort_key end,
    created_by = case when v_row ? 'created_by' then excluded.created_by else b.created_by end,
    created_at = case when v_row ? 'created_at' then excluded.created_at else b.created_at end,
    updated_at = now(),
    linear_parent_ids = case when v_row ? 'linear_parent_ids' then excluded.linear_parent_ids else b.linear_parent_ids end
  returning * into v_result;

  v_action := coalesce(
    nullif(v_event->>'action', ''),
    case
      when v_old_status is null then 'batch_create'
      when v_old_status is distinct from v_result.status then 'batch_status_change'
      else 'batch_change'
    end
  );

  insert into public.deliverable_events (
    deliverable_id,
    batch_id,
    client_slug,
    ts,
    actor,
    role,
    action,
    from_status,
    to_status,
    source,
    payload
  )
  values (
    null,
    v_result.id,
    v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_action,
    coalesce(nullif(v_event->>'from_status', ''), v_old_status),
    coalesce(nullif(v_event->>'to_status', ''), case when v_old_status is distinct from v_result.status then v_result.status else null end),
    coalesce(nullif(v_event->>'source', ''), 'ui'),
    v_event
  );

  return v_result;
end;
$fn$;
commit;

-- ROLLBACK: re-apply the batch_write definition from
-- migrations/2026-07-06-b1-linear-data-model.sql (lines 345-462) verbatim.
-- Batches already carrying purpose='samples' keep it; the column is untouched
-- by this function's removal, only newly written batches would stop recording
-- it.
