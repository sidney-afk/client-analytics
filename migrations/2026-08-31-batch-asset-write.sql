-- 2026-08-31 — Raw footage and the frame folder become editable.
--
-- OWNER REQUEST, 2026-08-30: "anyone should be able to change the link of the
-- raw footage, or the frame folder, or the deliverable file, just not the
-- filming plan for a video sub-issue... on the parent issue we should see the
-- filming plan assets which is the only one that is not editable because it is
-- from the supabase database and no one should be able to touch that".
--
-- The deliverable file already has a write path (production_artifact_write).
-- The other two had none, anywhere in the estate: batches.footage_folder_url
-- and batches.delivery_folder_url are written exactly once, at intake, and the
-- gateway refuses every batch-entity mutation except `comment`
-- (unsupported_batch_operation). A wrong folder link was therefore permanent
-- from every seat in the product.
--
-- WHY A FUNCTION AND NOT A DIRECT UPDATE. The interesting half of this change
-- is the column that must NOT move. `filming_doc_url` is derived from the
-- filming_plans source and the owner wants it untouchable, so the whitelist
-- lives HERE, in the database, and not only in the gateway that happens to call
-- it today. A future caller -- a script, a repair, a second gateway -- cannot
-- reach the filming plan through this function even by asking for it by name.
-- That is the same layering the graphics-only artifact rule had, and the reason
-- widening it took a migration rather than an if-statement.
--
-- It is deliberately thin. Slot whitelist, row lock, authority, then
-- public.batch_write, which already does the per-key partial update of exactly
-- these columns and already records the deliverable_events audit row
-- (deliverable_id null, batch_id set) that every other batch write records. No
-- new audit shape and no second copy of the upsert.
--
-- NOT public.production_batch_write, which is the other obvious candidate: it
-- requires an outbox dedup key AND an intent fingerprint and RAISES without
-- them (production_outbox_replay, 2026-07-12-write-ui-outbox-parity.sql:146).
-- That contract exists for writes with a Linear mirror leg. A batch folder link
-- has none -- Linear never held it -- so there is nothing to dedup against, and
-- inventing an outbox row to satisfy a guard would be a fiction in the one
-- table the drain reads.
--
-- LOCKING. This takes a row lock on public.batches and nothing else.
-- production_artifact_write locks deliverables and calendar_posts and never
-- batches, so the two cannot form a cycle no matter how they interleave.
--
-- Additive: no table, column, index, trigger, policy, grant on another object,
-- runtime flag or authority value is touched, and no row is written at install
-- time.
--
-- ROLLBACK, and it runs TOP-DOWN like the video artifact, for the same reason.
-- Revert the browser half first (the Edit control disappears from the two
-- folder rows), then redeploy the prior production-write closure through
-- .github/workflows/deploy-f27-section4-closures.yml, and only then, if you
-- want it gone entirely: `drop function if exists
-- public.production_batch_asset_write(text, text, text, text, jsonb);`.
-- Dropping it FIRST leaves a live Edit control whose save reaches a missing
-- function and returns a 500 write_failed with no explanation -- the same shape
-- of incident the video migration note was corrected to prevent. Leaving the
-- function installed under a reverted gateway costs nothing: nothing else calls
-- it. See ROLLBACK.md.

begin;

create or replace function public.production_batch_asset_write(
  p_batch_id text,
  p_client_slug text,
  p_slot text,
  p_url text,
  p_event jsonb default '{}'::jsonb
) returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_column text;
  v_current public.batches%rowtype;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_row jsonb;
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
begin
  -- The whitelist. filming_doc_url is absent on purpose and its absence is the
  -- reason this function exists; do not add it.
  v_column := case lower(coalesce(p_slot, ''))
    when 'raw_footage' then 'footage_folder_url'
    when 'delivery_folder' then 'delivery_folder_url'
    else null
  end;
  if v_column is null then
    raise exception 'production batch asset slot unsupported';
  end if;

  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null then
    raise exception 'production batch asset scope required';
  end if;

  -- Scope and existence resolve together, so a caller cannot use a mismatched
  -- client slug to discover which batch ids exist.
  select b.* into v_current
  from public.batches b
  where b.id = p_batch_id
    and b.client_slug = p_client_slug
  for update;
  if not found then
    raise exception 'production batch asset target missing';
  end if;

  perform public.production_assert_authority(
    v_current.client_slug, v_current.team, false, false
  );

  -- Exactly two keys reach batch_write: the id it matches on, and the one
  -- column being written. Every other column is left alone by the per-key
  -- `case when v_row ? '<col>'` arms of its ON CONFLICT clause, so this cannot
  -- clobber a name, a description or a sibling asset by omission.
  v_row := jsonb_build_object('id', v_current.id)
    || jsonb_build_object(v_column, v_url);

  return public.batch_write(
    v_row,
    v_event || jsonb_build_object(
      'action', 'batch_asset_change',
      'slot', lower(p_slot)
    )
  );
end;
$fn$;

revoke all on function public.production_batch_asset_write(text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_batch_asset_write(text, text, text, text, jsonb)
  to service_role;

commit;
