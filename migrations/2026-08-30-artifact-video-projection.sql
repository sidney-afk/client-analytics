-- 2026-08-30 — Let a VIDEO deliverable carry a canonical artifact.
--
-- Owner request, day 2 post-flip: an editor should be able to attach the
-- finished video in SyncLinear the same way a designer attaches a thumbnail,
-- and have it land on the calendar card. Today "Attach / replace" is
-- graphics-only at six layers and this function is the deepest of them,
-- raising `production artifact graphics only`.
--
-- The refusal was never about video being unsafe. It is that this function
-- only knew how to PROJECT a graphics artifact onto a card: it writes
-- calendar_posts.thumbnail_url keyed on graphic_deliverable_id. A video
-- artifact is the finished video, so it belongs in asset_url keyed on
-- video_deliverable_id. Opening the guard WITHOUT adding that branch would
-- fall straight through to `artifact_card_projection_scope_invalid` and roll
-- the attach back -- a live-looking button that fails every time, which is the
-- exact shape of the defect this file's predecessor fixed on 2026-08-06.
--
-- THE TRAP, written down because it cost a full cycle in August:
-- syncview_thumbnail_thumb_rev_before_write (2026-07-14-thumbnail-revision-v2)
-- fires `before update of thumbnail_url, ASSET_URL` on BOTH calendar_posts and
-- sample_reviews, and unconditionally mints its own epoch-base36 token. So a
-- video projection cannot own thumb_rev either: the video branch does not set
-- it (it is the thumbnail cache-buster, not this write's to spend) and its
-- readback verifies asset_url alone. Setting a token and then verifying
-- against it is precisely what made every graphics attach roll back before
-- 2026-08-06.
--
-- Everything else is byte-identical to
-- migrations/2026-08-06-artifact-projection-scope-and-revision.sql. Unchanged
-- and deliberately so: the advisory-lock ORDER against
-- production_deliverable_write (advisory locks first, both keys, same
-- sequence, then the row lock -- the arrangement that makes an
-- advisory<->row deadlock impossible), the outbox replay short-circuit and its
-- no-bump/no-event/no-projection contract, the artifact_revision increment and
-- its exhaustion guard, the active-client requirement,
-- production_assert_authority, the scope refusal for a card whose surface this
-- function does not know, and the fall-through for a row with no card at all.
--
-- Additive and idempotent: CREATE OR REPLACE plus the same grants. No table,
-- column, index, trigger, policy, runtime flag or authority value is touched,
-- and no row is written at install time.
--
-- ORDERING. This migration is the FLOOR of the change: run it BEFORE deploying
-- the production-write edge function and before the browser half reaches main.
-- Each layer above fails closed on its own, so a database that already accepts
-- video while the layers above still refuse is simply the status quo -- while
-- the reverse order produces a button that 403s.
--
-- ROLLBACK. Corrected 2026-08-31 after review; the first version of this note
-- was wrong in a way that would have caused an incident during the rollback it
-- was written for. It said: re-apply the definition from
-- migrations/2026-08-06-artifact-projection-scope-and-revision.sql, and nothing
-- else needs undoing. That is only true BEFORE the layers above ship. Once the
-- gateway and the browser carry the widening, reverting the database ALONE
-- leaves the gateway accepting a video attach and calling a graphics-only
-- function, whose raise reaches rpc() as a 500 native_write_failed -- while the
-- panel goes on offering the control. That is strictly worse than the widened
-- state and worse than the original refusal.
--
-- Deploy runs bottom-up, so rollback runs TOP-DOWN, and stops before this file:
--   1. Revert the browser half (Pages). The Attach control stops being offered
--      on a video row. Stale tabs keep it until they reload, which is why the
--      gateway is next and not last.
--   2. Redeploy the prior production-write closure through
--      .github/workflows/deploy-f27-section4-closures.yml, which exists for
--      exactly this source-exact restore. A video attach is then refused with
--      operation_forbidden, the original behaviour, from the layer that
--      actually decides it.
--   3. Leave THIS migration installed. It is additive: with the gateway
--      reverted, the video branch below is never reached, so it costs nothing
--      and reverting it is what creates the 500 above. Re-apply the August 6
--      definition only if the defect is IN this function and graphics attaches
--      are failing because of it -- and then revert the layers above first.
--
-- One-step containment, if the widening has to stop RIGHT NOW and a deploy is
-- too slow: set prod_authority.video back to 'linear'. production_artifact_write
-- calls production_assert_authority on the row team before it does anything
-- else, so every video attach raises team_is_linear_authoritative at the
-- database, with no deploy and no stale-tab window, and the browser stops
-- offering the control for the same reason. Know its cost before reaching for
-- it: it is not scoped to attach. It stops EVERY native video write -- status,
-- due date, assignee, comments -- which for the post-flip team is the whole
-- Production tab. Prefer steps 1-2 unless the incident is broad enough to
-- justify that.

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

  if v_result.origin = 'calendar' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
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
  elsif v_result.origin = 'samples' and nullif(btrim(coalesce(v_result.card_id, '')), '') is not null then
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
