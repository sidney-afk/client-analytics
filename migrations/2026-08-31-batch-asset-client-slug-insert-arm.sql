-- Batch asset writes never committed. Not once, for anyone, since the slots
-- shipped -- `select count(*) from deliverable_events where action =
-- 'batch_asset_change'` was 0 on 2026-08-31, while due_change and
-- status_change were landing normally in the same window.
--
-- Reported the same day by three people within two hours: an SMM and a video
-- editor could not save a Frame folder, another SMM could not save a raw
-- footage folder. All three saw "The change was not saved. Please try again."
-- and, after PR #1192, the transient-class sentence -- because the edge
-- function's outer catch turns any non-GatewayError into `write_failed`, and
-- a raw Postgres exception from the RPC is exactly that.
--
-- CAUSE, from running the function in a transaction and reading the error:
--
--   ERROR: 23502: null value in column "client_slug" of relation "batches"
--   violates not-null constraint
--   Failing row contains (bat_..., null, null, Untitled batch, ...)
--   CONTEXT: SQL statement "insert into public.batches as b (...)"
--   PL/pgSQL function batch_write(jsonb,jsonb) line 21
--   PL/pgSQL function production_batch_asset_write(...) line 75 at RETURN
--
-- production_batch_asset_write handed batch_write a row of exactly two keys:
-- the id, and the asset column. batch_write is an INSERT ... ON CONFLICT (id)
-- DO UPDATE, and PostgreSQL evaluates NOT NULL on the proposed INSERT tuple
-- BEFORE resolving the conflict -- so the statement died on client_slug every
-- time and never reached the update arm it was designed around.
--
-- The previous reasoning is preserved because it was half right, and the half
-- it got wrong is the interesting part. Its comment read:
--
--   "Exactly two keys reach batch_write: the id it matches on, and the one
--    column being written. Every other column is left alone by the per-key
--    `case when v_row ? '<col>'` arms of its ON CONFLICT clause, so this
--    cannot clobber a name, a description or a sibling asset by omission."
--
-- Every word of that is true OF THE UPDATE ARM. It simply does not follow that
-- the INSERT arm may be an invalid row: an upsert has to be able to insert.
--
-- THE FIX is to echo client_slug back from the row already locked three
-- statements above, so the insert arm is valid and the update arm sets the
-- column to the value it already holds. Nothing else is added: every other
-- omitted column is still governed by the `v_row ? '<col>'` guards, so the
-- no-clobber property the original comment describes is untouched.
--
-- Verified on live data before shipping, inside a transaction that was rolled
-- back: the call returned (bat_72f46d2f-..., bayavoce,
-- https://drive.google.com/drive/folders/TEST-DIAGNOSTIC) where the same call
-- raised 23502 minutes earlier.
--
-- Idempotent, additive, no table/column/index/policy touched. CREATE OR
-- REPLACE preserves the existing ACL, so the service_role execute grant from
-- 2026-08-31-batch-asset-write.sql survives.

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
  v_teams text[];
  v_team text;
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

  -- The batch's own team AND every team its deliverables belong to, because
  -- these slots are shared across the whole post. (2026-08-31 team fallback;
  -- 303 of 1,644 batches carry a null team.)
  select coalesce(array_agg(distinct t), '{}'::text[])
    into v_teams
  from (
    select lower(btrim(coalesce(v_current.team, ''))) as t
    union all
    select lower(btrim(coalesce(d.team, '')))
    from public.deliverables d
    where d.batch_id = v_current.id
      and d.client_slug = v_current.client_slug
  ) s
  where t in ('video', 'graphics');

  if array_length(v_teams, 1) is null then
    -- No resolvable scope anywhere. Refused through the same assertion so the
    -- error vocabulary a caller sees does not change with the cause.
    perform public.production_assert_authority(
      v_current.client_slug, null, false, false
    );
  end if;

  -- Fails closed on the FIRST team that is not writable, so a mixed batch
  -- cannot be edited while half of it is Linear-authoritative.
  foreach v_team in array v_teams loop
    perform public.production_assert_authority(
      v_current.client_slug, v_team, false, false
    );
  end loop;

  /* client_slug is here because batch_write is an upsert and its INSERT arm
     must be a valid batches row: NOT NULL is checked on the proposed tuple
     before ON CONFLICT resolves, so omitting it raised 23502 on every call and
     no batch asset write ever committed. It is echoed from the row locked
     above, so the update arm assigns the value the row already holds.
     Do not reduce this back to {id, <column>}: the per-key `v_row ? '<col>'`
     guards in batch_write protect the UPDATE arm only. */
  v_row := jsonb_build_object('id', v_current.id, 'client_slug', v_current.client_slug)
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

commit;
