-- 2026-09-05 — Resolve the card SURFACE from the binding, not from `origin`.
--
-- OWNER REPORT: attaching a deliverable file to one sub-issue of a post was
-- refused with "The deliverable was not changed because its linked card could
-- not be updated safely", while its 31 siblings accepted the same kind of link.
--
-- THE ROW. It carries `origin = 'manual'` and `card_id = 'p_native_…'`, and
-- that card is real: same client, and it names THIS deliverable back in the
-- slot for THIS team. Every sibling carries `origin = 'calendar'`. Only the
-- filing column disagrees with the link it is supposed to describe.
--
-- WHY THAT REFUSES EVERY ATTACH. production_artifact_write routes the card
-- projection on a literal `origin` comparison chain. With `origin = 'manual'`
-- and a non-null card_id the two projection arms are both false and the third
-- is unconditionally true, so it raises
-- `artifact_card_projection_scope_invalid`. (Not `..._failed`, which is gated
-- on a projection surface having been chosen and is therefore unreachable for
-- this shape — both map to one 409 and one sentence in the panel, which is why
-- the report could not distinguish them.) The raise aborts a transaction that
-- has already run production_deliverable_write and bumped artifact_revision,
-- so `file_url` rolls back with it and "the deliverable was not changed" is
-- literal. The row can never receive an artifact, from any seat, ever.
--
-- MEASURED 2026-09-05 across all 6,330 browser-visible deliverables: 7 live
-- rows carry a real `p_` card id while `origin` is still 'manual'. All 7 are
-- refused identically today.
--
-- THE BINDING IS THE HALF THAT CANNOT BE WRONG. `origin` is a filing column
-- written at creation and never re-derived; the card link is checked in both
-- directions at every use. So when `origin` names no projectable surface but a
-- card IS named, the surface is resolved from the two-way binding instead. A
-- row whose `origin` already names a surface never enters that branch, so
-- nothing about the rows that attach correctly today moves: the two projection
-- arms below are reached with exactly the value they are reached with now, and
-- a row with no card at all still falls through as it has since 2026-08-30.
-- The only rows whose behaviour changes are rows that currently always fail.
--
-- DELIBERATELY NOT A DATA REPAIR. Flipping those 7 rows' `origin` would be a
-- write on live client rows, it would need a per-row collision pre-check
-- against deliverables_card_slot_unique, and it would move those cards from
-- legacy to canonical comment rendering — a hazard tracked separately. It also
-- fixes 7 rows and not the class. The filing column is left exactly as it is;
-- this reads around it. Whether to repair the column as well is the owner's
-- call and is recorded in the ledger, not assumed here.
--
-- THE PRODUCER is fixed in the same change, outside this file:
-- scripts/b1-linear-backfill.js adopted `preferred.card_id` onto a native-batch
-- row while `origin` fell back to the literal 'manual' and never consulted
-- `preferred.origin` — two halves of one fact resolved from two sources.
--
-- Everything else is byte-identical to
-- migrations/2026-08-30-artifact-video-projection.sql: the advisory-lock ORDER
-- against production_deliverable_write, the outbox replay short-circuit and its
-- no-bump/no-event/no-projection contract, the artifact_revision increment and
-- its exhaustion guard, the active-client requirement,
-- production_assert_authority, the thumb_rev trap and its readback rule, and
-- the fall-through for a row with no card at all.
--
-- Additive and idempotent: CREATE OR REPLACE plus the same grants. No table,
-- column, index, trigger, policy, runtime flag or authority value is touched,
-- and no row is written at install time.
--
-- ORDERING. Independent of the edge-function deploy: this file adds no file
-- and edits no file under supabase/functions/, so it is not in any deploy
-- lane's closure and needs no fingerprint re-pin, no sealed capture and no
-- merge freeze. Apply it whenever; the layers above are unchanged.
--
-- ROLLBACK. Re-apply the definition from
-- migrations/2026-08-30-artifact-video-projection.sql. Nothing else needs
-- undoing: no layer above this one was widened for it, and the only rows whose
-- behaviour it changes are rows that were refused before and would simply be
-- refused again.

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
  -- The row's card id, and the surface resolved for it. See the header: the
  -- surface comes from `origin` when `origin` names one, and from the two-way
  -- card binding when it does not.
  v_card text;
  v_surface text;
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
  -- 2026-08-30: video joins graphics. The refusal was never about video being
  -- unsafe -- it is that this function only knew how to PROJECT a graphics
  -- artifact onto a card. It knows both now, so the guard tests what it
  -- actually needs: a team this function can project, and a payload that does
  -- not disagree with the row being written. The mismatch check is what stops
  -- a graphics payload landing on a video row and vice versa.
  if lower(coalesce(v_current.team, '')) not in ('graphics', 'video') then
    raise exception 'production artifact team unsupported';
  end if;
  if lower(coalesce(v_row->>'team', '')) is distinct from lower(coalesce(v_current.team, '')) then
    raise exception 'production artifact team mismatch';
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

  v_card := nullif(btrim(coalesce(v_result.card_id, '')), '');
  v_surface := case
    when v_result.origin in ('calendar', 'samples') then v_result.origin
  end;
  if v_surface is null and v_card is not null then
    /* BINDING-FIRST, AND ONLY HERE. Reached only when `origin` names no
       projectable surface AND a card IS named -- the shape that raises below
       today, without exception. A row whose `origin` already names a surface
       skips this entirely, so no row that attaches correctly today changes
       behaviour.

       The binding is checked in the SAME direction and with the SAME team
       pairing the projection arms use, so a surface resolved here is a surface
       whose update below is guaranteed to match exactly one row. Both filters
       are pinned to this row's client, so a card id colliding across clients
       cannot be adopted.

       Calendar is tried first and wins a tie. The two id spaces do not overlap
       in practice, and a deterministic order matters more than which one it is:
       the alternative is a surface that depends on evaluation order. */
    if exists (
      select 1 from public.calendar_posts p
      where p.client = v_result.client_slug
        and p.id = v_card
        and (case when lower(coalesce(v_result.team, '')) = 'video'
                  then p.video_deliverable_id
                  else p.graphic_deliverable_id end) = v_result.id
    ) then
      v_surface := 'calendar';
    elsif exists (
      select 1 from public.sample_reviews p
      where p.client = v_result.client_slug
        and p.id = v_card
        and (case when lower(coalesce(v_result.team, '')) = 'video'
                  then p.video_deliverable_id
                  else p.graphic_deliverable_id end) = v_result.id
    ) then
      v_surface := 'samples';
    end if;
  end if;

  if v_surface = 'calendar' and v_card is not null then
    v_projection_surface := 'calendar';
    if lower(coalesce(v_result.team, '')) = 'video' then
      -- A video artifact is the finished video, so it lands in asset_url and is
      -- keyed on video_deliverable_id. thumb_rev is deliberately NOT set: it is
      -- the thumbnail cache-buster, and syncview_thumbnail_thumb_rev_before_write
      -- fires on `update of thumbnail_url, ASSET_URL`, minting its own token on
      -- this very write. Setting one and reading it back is exactly the
      -- 2026-08-06 defect -- verifying against a value the trigger has already
      -- discarded -- so the readback below compares asset_url alone.
      update public.calendar_posts p
      set asset_url = v_result.file_url,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.calendar_posts p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id
        and p.asset_url is not distinct from v_result.file_url;
    else
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
    end if;
  elsif v_surface = 'samples' and v_card is not null then
    v_projection_surface := 'samples';
    if lower(coalesce(v_result.team, '')) = 'video' then
      update public.sample_reviews p
      set asset_url = v_result.file_url,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.sample_reviews p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id
        and p.asset_url is not distinct from v_result.file_url;
    else
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
    end if;
  elsif v_card is not null then
    -- A card IS named, `origin` does not identify a surface, and NO card in
    -- either surface binds back to this deliverable -- so there is nothing to
    -- project onto and no evidence of what this card_id was ever meant to name.
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
