-- Raw footage and Frame folder could not be saved by ANYONE, on ANY post.
--
-- Found by the round-3 tester 2026-08-31 (PR #1186), who replayed the write and
-- read the raw response rather than trusting the UI message:
--   {"error":"entity_scope_unavailable"}
--
-- Cause: `batches.team` is not reliably populated. Measured the same day, 303
-- of 1,644 batches carry a null team -- including one created ninety seconds
-- before the test, so this is not stale data. Some creation paths set it and
-- some do not. That intake gap is real and is tracked separately; it must not
-- be what decides whether a folder link can be saved.
--
-- BOTH halves refused, which is why the gateway fix alone was not enough:
--   * the edge function read `batches.team` for its permission check;
--   * this function passes `v_current.team` to production_assert_authority,
--     whose first act is `if p_team is null ... raise 'authority_unavailable'`.
--
-- So the team is DERIVED from the batch's own deliverables when the column is
-- empty. That is not a guess: a batch's team IS the team of the work in it, and
-- deliverables carry it reliably.
--
-- EVERY TEAM THE BATCH SERVES IS AUTHORIZED, NOT THE FIRST ONE FOUND, and that
-- distinction is the whole safety of this change. The first draft picked the
-- earliest child and asserted authority once, reasoning that the choice could
-- not matter because prod_authority is flipped for video and graphics alike.
-- That reasoning assumed the current flag state and the flag state is exactly
-- what a per-team rollback changes -- there is a CI lane named for it
-- (f27-team-rollback-proof). On a mixed-team batch mid-rollback, picking the
-- earliest child would make authorization depend on ROW ORDER: pick the
-- still-SyncView child and the shared folder write is accepted even though the
-- same folder serves the rolled-back team; reverse the order and an otherwise
-- writable batch is refused. Raised by Codex on PR 1187.
--
-- These slots are BATCH-level: one raw-footage folder and one frame folder for
-- the whole post, read by every sibling on every team. So the write is
-- authorized against the union of the batch's own team and all of its
-- children's, and fails closed unless EVERY one of them is currently writable.
-- That is stricter than before for the 1,341 batches that already carry a team,
-- identical under the current both-teams-flipped flag, and correct in the
-- direction that matters when it is not.
--
-- IT IS NOT WRITTEN BACK, deliberately. Repairing the column belongs to intake,
-- where the right value is known at creation; guessing one into the row here is
-- how a wrong value becomes permanent, and this path must not mutate a column
-- nobody asked it to touch.
--
-- If there are no deliverables either, the refusal STANDS. Such a batch has no
-- scope to authorize against, and inventing one would be the defect this whole
-- function exists to avoid.
--
-- Everything else below is byte-identical to 2026-08-31-batch-asset-write.sql.
-- Rollback: re-apply that file. See ROLLBACK.md.

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

  -- THE FIX. The batch's own team AND every team its deliverables belong to,
  -- because these slots are shared across the whole post.
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

commit;
