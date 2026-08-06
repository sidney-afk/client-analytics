-- 2026-08-06 — Fix the two defects that made "Attach / replace" unusable.
--
-- Both live in public.production_artifact_write, both were found only after
-- the asset-probe fix (#1026) let a request reach them for the first time, and
-- together they meant the button could not succeed for ANY graphics
-- deliverable: without a linked card it refused, and with one it refused.
--
--   1. artifact_card_projection_scope_invalid
--      The scope predicate refused every origin other than 'manual' whether or
--      not a card was named. Intake stamps new deliverables 'calendar' at
--      birth and they acquire a card later, so 1,887 of 2,160 graphics rows --
--      including 214 sitting in an approval state -- could never be attached
--      to. A row with no card has nothing to project; it now falls through.
--      A row that DOES name a card whose surface is unknown still refuses.
--
--   2. artifact_card_projection_failed
--      The projection wrote thumb_rev = 'artifact-N' and then verified the row
--      by reading that value back. But syncview_thumbnail_thumb_rev_before_write
--      (2026-07-14-thumbnail-revision-v2.sql) fires BEFORE UPDATE OF
--      thumbnail_url and unconditionally overwrites thumb_rev with its own
--      epoch-base36 token -- that is the owner's before/after and cache-busting
--      mechanism, and it is enabled for every active client
--      (thumbnail_revision_v2 = {"mode":"on"}). The readback therefore matched
--      zero rows and raised, rolling back the file_url attach with it. The
--      projection now verifies against the value the row actually holds after
--      the trigger, so the "exactly one row is in the intended state" contract
--      is kept without fighting the trigger.
--
-- Function body is otherwise byte-identical to
-- migrations/2026-07-23-f34-f53-production-attachments.sql. Additive and
-- idempotent: CREATE OR REPLACE plus the same grants. No table, column, index,
-- trigger, policy, runtime flag or authority value is touched, and no row is
-- written at install time.
--
-- Rollback: re-apply the production_artifact_write definition from
-- migrations/2026-07-23-f34-f53-production-attachments.sql. That restores the
-- refusing behaviour exactly; nothing else in this file needs undoing.

begin;

create or replace function public.production_artifact_write(
  p_row jsonb,
  p_event jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_current public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_projection_surface text;
  v_projection_updated integer := 0;
  v_projection_matches integer := 0;
  v_revision text;
  -- The requested token, and what the row ACTUALLY holds after any BEFORE
  -- UPDATE trigger has run. syncview_thumbnail_thumb_rev_before_write fires
  -- on `update of thumbnail_url` for every enrolled client and unconditionally
  -- mints its own epoch-base36 token, discarding ours. Verifying against the
  -- requested token therefore found zero rows and raised
  -- artifact_card_projection_failed on every correctly linked card, rolling
  -- back the file_url attach with it.
  v_effective_revision text;
  v_next_revision bigint;
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
begin
  if v_id is null then raise exception 'production artifact id required'; end if;
  if v_outbound->>'operation' is distinct from 'attachment' then
    raise exception 'invalid production artifact operation';
  end if;
  if nullif(btrim(v_row->>'file_url'), '') is null then
    raise exception 'production artifact url required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-artifact:' || v_id, 0));
  -- Match production_deliverable_write's lock order before taking the row
  -- lock. A concurrent scalar writer may already hold this advisory lock; by
  -- waiting here (rather than while holding the row) the two paths cannot
  -- form advisory-lock <-> row-lock deadlock.
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_current
  from public.deliverables d
  where d.id = v_id
  for update;
  if not found then raise exception 'production artifact not found'; end if;
  if not exists (
    select 1 from public.clients c
    where c.slug = v_current.client_slug
      and c.active is true
  ) then
    raise exception 'production artifact active client required';
  end if;
  if lower(coalesce(v_current.team, '')) <> 'graphics'
     or lower(coalesce(v_row->>'team', '')) <> 'graphics' then
    raise exception 'production artifact graphics only';
  end if;

  perform public.production_assert_authority(
    v_current.client_slug,
    v_current.team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  -- The artifact lock makes this replay check authoritative even when two
  -- identical gateway requests raced before either outbox row was visible.
  -- Exact replay returns without revision bump, event, or card projection.
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'deliverable'),
    v_id,
    'attachment',
    v_current.client_slug,
    v_current.team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_fingerprint,
    v_dedup
  ) then
    return jsonb_build_object(
      'row', to_jsonb(v_current),
      'projection', jsonb_build_object(
        'surface', case when v_current.origin in ('calendar', 'samples')
          then v_current.origin else null end,
        'card_id', case when v_current.origin in ('calendar', 'samples')
          then v_current.card_id else null end,
        'updated', false,
        'replay', true,
        'artifact_revision', v_current.artifact_revision
      )
    );
  end if;

  v_next_revision := coalesce(v_current.artifact_revision, 0) + 1;
  if v_next_revision > 9007199254740991 then
    raise exception 'production artifact revision exhausted';
  end if;
  v_outbound := jsonb_set(
    v_outbound,
    '{payload}',
    coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object('artifact_revision', v_next_revision),
    true
  );
  v_event := jsonb_set(v_event, '{outbound}', v_outbound, true)
    || jsonb_build_object('artifact_revision', v_next_revision);
  v_result := public.production_deliverable_write(v_row, v_event);
  update public.deliverables d
  set artifact_revision = v_next_revision
  where d.id = v_result.id
  returning d.* into v_result;
  if not found then raise exception 'production artifact revision persist failed'; end if;
  v_revision := 'artifact-' || v_next_revision::text;

  if v_result.origin = 'calendar' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    v_projection_surface := 'calendar';
    update public.calendar_posts p
    set thumbnail_url = v_result.file_url,
        thumb_rev = v_revision,
        updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
    returning p.thumb_rev into v_effective_revision;
    get diagnostics v_projection_updated = row_count;

    select count(*)::integer into v_projection_matches
    from public.calendar_posts p
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
      and p.thumbnail_url is not distinct from v_result.file_url
      and p.thumb_rev is not distinct from v_effective_revision;
  elsif v_result.origin = 'samples' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    v_projection_surface := 'samples';
    update public.sample_reviews p
    set thumbnail_url = v_result.file_url,
        thumb_rev = v_revision,
        updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
    returning p.thumb_rev into v_effective_revision;
    get diagnostics v_projection_updated = row_count;

    select count(*)::integer into v_projection_matches
    from public.sample_reviews p
    where p.client = v_result.client_slug
      and p.id = v_result.card_id
      and p.graphic_deliverable_id = v_result.id
      and p.thumbnail_url is not distinct from v_result.file_url
      and p.thumb_rev is not distinct from v_effective_revision;
  elsif nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
    -- A card IS named but neither branch above could project onto it, so the
    -- origin does not identify a surface this function knows how to update.
    -- Refusing stays correct: skipping would leave that card showing a stale
    -- thumbnail while the deliverable claims a new one.
    --
    -- A row with NO card is a different case and is no longer an error. The
    -- previous predicate refused every non-`manual` origin regardless of
    -- card_id, so an intake-created `calendar` deliverable -- which is stamped
    -- `calendar` at birth and only acquires a card later -- could never receive
    -- an artifact at all. There is simply nothing to project; fall through.
    raise exception 'artifact_card_projection_scope_invalid';
  end if;

  if v_projection_surface is not null
     and (v_projection_updated > 1 or v_projection_matches <> 1) then
    raise exception 'artifact_card_projection_failed';
  end if;

  return jsonb_build_object(
    'row', to_jsonb(v_result),
    'projection', jsonb_build_object(
      'surface', v_projection_surface,
      'card_id', case when v_projection_surface is null then null else v_result.card_id end,
      'updated', v_projection_updated = 1,
      'replay', false,
      'artifact_revision', v_next_revision
    )
  );
end;
$fn$;

revoke all on function public.production_artifact_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_artifact_write(jsonb, jsonb)
  to service_role;

commit;
