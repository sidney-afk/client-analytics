-- Bind a calendar card to its deliverable AND import that card's legacy
-- comment thread, in ONE transaction.
--
-- WHY THIS EXISTS. `production_comment_card_import` validates the crosswalk
-- BEFORE it copies anything (2026-07-23-production-comment-thread-lifecycle.sql:689,
-- 'production comment card import crosswalk mismatch'). So it refuses precisely
-- while the crosswalk is broken -- which is the only moment the copy is needed.
-- Repairing the binding first to satisfy that guard opens the window this
-- ordering exists to close: with the binding valid and the canonical store
-- still empty, `_prodCanonicalCoversLegacy` returns false, the read is stamped
-- `legacy_retained`, and the card DISPLAYS the legacy thread while new writes
-- land canonically. Nobody is refused and nothing errors -- the conversation
-- simply splits in silence, which is harder to notice than a refusal.
-- OPEN_REPAIRS 147 §4 names this as the reason no legal order exists without a
-- combined operation.
--
-- WHAT IT DOES NOT DO. It does not delete, move or rewrite the legacy thread.
-- `production_comment_card_import` COPIES into `production_comments` and
-- records a link; `calendar_posts.*_tweaks` is never touched by this function.
-- The legacy thread remains exactly where it was, so the repair is reversible
-- by dropping the canonical rows and the binding.
--
-- SAFETY, and each of these was a real defect found while measuring:
--   * It binds ONLY what the card itself points at. The card's own
--     video/graphic slot must already name this deliverable, so a deliverable
--     cannot be dragged onto a card that never referenced it.
--   * It refuses to move a deliverable between CLIENTS. One live measurement
--     found a card of one client pointing at another client's live deliverable
--     (OPEN_REPAIRS 147); binding that would have rewritten the wrong client's
--     row. A cross-client reference is a broken card reference, not a missing
--     binding, and needs a person.
--   * THE CARD POINTER IS NOT SUFFICIENT AUTHORITY ON ITS OWN. A stale pointer
--     that happens to name an unbound deliverable of the same client would,
--     with only the checks above, rewrite that unrelated row and copy the
--     card's conversation onto it. So the card and the deliverable must name
--     the SAME Linear issue. Either side missing is UNPROVEN, not permission --
--     a refusal, not a pass. This is THE proof of "the same work item", and
--     the only check here that does not descend from the card pointer.
--
-- THE LABEL RULE (owner ruling 2026-09-05, OPEN_REPAIRS 156). The first
-- version of this function ALSO required the deliverable's `kind` to be the
-- kind the card slot implies ("team is too coarse: team='video' covers
-- kind='video' and kind='other'"). Measured against live data that refused 40
-- of 107 slots in which the card and the row named the SAME Linear issue:
-- graphics rows titled "Carousel"/"Story" (kind='other') in graphic slots, and
-- 14 "Reel N" video rows stamped kind='thumbnail' because their BATCH PARENT
-- was titled "...Reels and Thumbnails". `kind` is a regex over the issue title
-- and its parent's title (b1-linear-backfill.js classifyKind); it is a guess,
-- not a fact about the artifact. The ruling, in the owner's words: "I would
-- believe the card." So:
--   * kind never refuses. Identity (above) is the proof.
--   * on bind, the labels FOLLOW THE CARD: a row bound into the video slot is
--     kind='video'; a row bound into the graphic slot is kind='thumbnail';
--     team is the slot's team, as it always was. Once bound, kind IS the slot
--     key and nothing else: `deliverables_card_slot_unique` keys on it, and
--     linear-inbound's maintainCardLinkage reads exactly two values from it
--     (thumbnail -> graphic slot, anything else -> video slot). A graphic-slot
--     row left at 'other' would collide with nothing today and be written into
--     the VIDEO slot by the first inbound write after a team returned to
--     Linear authority (Codex P1 on #1291). A video-slot row left at
--     'thumbnail' collides with the same card's real thumbnail. Normalising
--     both ways is what makes the bind possible AND stable.
--   * a Linear identifier's prefix (VID-/GRA-) is NOT required to match the
--     slot either: 9 live graphic slots point at thumbnails tracked on the
--     Video team, and the card's word is what the client sees.
--
-- THE SLOT, and who loses it (same ruling). A card has one video slot and one
-- graphic slot. When a slot is held by a row the card does NOT point at, that
-- row is an OCCUPANT. All 18 live occupants are native-born rows ("Video N",
-- created by SyncView Mirror when the card was created natively) on cards a
-- person then re-pointed by hand at the older batch issue ("Reel N"). Every one
-- inspected in Linear was an empty shell: no description, no attachment, no
-- lifecycle of its own, its status stamped from the card at birth. Two had
-- been canceled by hand and were RESURRECTED by the sync, because the shell
-- stayed attached to the card and kept receiving the card's status. Hence:
--   * by default a contested slot is still a REFUSAL (`slot_occupied`), so a
--     runner that did not ask for eviction gets a report, not a mutation;
--   * with `"evict_occupant": "card_wins"` in the binding, each occupant is
--     DETACHED from the card (card_id -> null) and, if its status is still
--     live, set to 'canceled' natively with the cancel handed to the OUTBOUND
--     lane (`mirror_outbox_enqueue`, operation 'status') -- never a direct
--     Linear call. A terminal occupant (approved/posted/canceled/duplicate) is
--     detached and its status left alone. Each eviction is written to
--     `deliverable_events` as `crosswalk_occupant_evicted` and returned in the
--     receipt;
--   * THE CANCEL CARRIES THE F27 AUTHORITY BINDER. Live has the F27 outbox
--     closure installed (2026-08-02): `track_b_f27_hold_guard` refuses any
--     pending intent whose `authority_generation` is not the team's current
--     fence, and the F27 `mirror_outbox_enqueue` reads that generation from
--     the reserved payload key `_f27_authority_generation` (absent -> -1 ->
--     refused as `f27_authority_generation_stale`). The first live apply on
--     2026-09-05 bound 89 slots and lost exactly the 11 whose eviction
--     cancelled a live shell, because this function enqueued without the
--     binder and the rehearsal chain predated F27. It now mints the binder
--     the gateway mints (`track_b_f27_write_authorization`), asserts
--     authority the way the gateway does, and -- if the occupant's team is
--     not SyncView-authoritative -- DETACHES ONLY (`detached_authority_linear`)
--     rather than cancelling natively a status Linear owns;
--   * an occupant that names the SAME Linear issue as the card is NOT an
--     occupant that lost -- it is a second projection of one issue
--     (`ambiguous_projection_rows`), and evicting it would cancel the issue the
--     card keeps. Refused as `occupant_same_issue`, with or without eviction.
--   * the row the card's OTHER slot points at is never an occupant of this
--     one, whatever its team or kind: 9 live graphic slots hold Video-team
--     rows, and a video-slot bind on those cards must not evict them.
--
-- Service-role only, like every other function in this family.

-- The Linear issue identifier (e.g. VID-123) a value names, from a full issue
-- URL or a bare identifier. '' when nothing parseable is present, which every
-- caller must read as UNPROVEN. Transcribed from linearIdentifier() in
-- scripts/f42-linkage-defect-repair.js so the SQL repair and the JS planner
-- cannot disagree about what counts as the same issue.
create or replace function public.crosswalk_linear_identifier(p_value text)
returns text
language sql
immutable
set search_path = public
as $ident$
  select coalesce(
    upper((regexp_match(coalesce(p_value, ''), '/issue/([A-Za-z][A-Za-z0-9]*-[0-9]+)'))[1]),
    upper((regexp_match(btrim(coalesce(p_value, '')), '^([A-Za-z][A-Za-z0-9]*-[0-9]+)$'))[1]),
    ''
  );
$ident$;

revoke all on function public.crosswalk_linear_identifier(text)
  from public, anon, authenticated;

create or replace function public.production_comment_card_bind_and_import(
  p_binding jsonb,
  p_comments jsonb default '[]'::jsonb,
  p_event jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_binding jsonb := coalesce(p_binding, '{}'::jsonb);
  v_surface text := lower(nullif(btrim(v_binding->>'source_surface'), ''));
  v_deliverable_id text := nullif(btrim(v_binding->>'deliverable_id'), '');
  v_card_id text := nullif(btrim(v_binding->>'card_id'), '');
  v_client_slug text := nullif(btrim(v_binding->>'client_slug'), '');
  v_component text := lower(nullif(btrim(v_binding->>'component'), ''));
  -- 'off' (default): a contested slot is a refusal. 'card_wins': the occupant
  -- loses, per the owner ruling in the header. Named, not boolean, so a call
  -- reads as the decision it is.
  v_evict text := lower(coalesce(nullif(btrim(v_binding->>'evict_occupant'), ''), 'off'));
  v_expected_team text;
  v_card_slot text;
  v_card_other_slot text;
  v_card_link text;
  v_card_ident text;
  v_kind text;
  v_kind_after text;
  v_del_ident text;
  v_del_batch text;
  v_current_client text;
  v_current_card text;
  v_occ record;
  v_occ_mode text;
  v_occ_team text;
  v_auth jsonb;
  v_evicted jsonb := '[]'::jsonb;
  v_prev_flag text;
  v_comment jsonb;
  v_native_id text;
  v_processed int := 0;
  v_imported int := 0;
  v_already int := 0;
  v_bound boolean := false;
begin
  -- 1. IDENTITY. Calendar only: the samples surface has its own origin and is
  --    not what this repair is scoped to.
  if v_surface is distinct from 'calendar'
     or v_deliverable_id is null
     or v_card_id is null
     or v_client_slug is null
     or v_component not in ('video', 'graphic') then
    raise exception 'crosswalk_bind_invalid_identity';
  end if;
  if v_evict not in ('off', 'card_wins') then
    raise exception 'crosswalk_bind_invalid_evict_mode';
  end if;
  v_expected_team := case when v_component = 'graphic' then 'graphics' else 'video' end;

  -- 2. THE CARD MUST POINT AT THIS DELIVERABLE. `calendar_posts` is keyed on
  --    (client, id) -- the bare id is reused across clients by design -- so the
  --    lookup carries both. Reading the slot the component names is what makes
  --    the bind safe: this function never invents a link, it only records the
  --    one the card already asserts. The OTHER slot's pointer is read too, so
  --    the row it names is never mistaken for an occupant of this one.
  --    FOR UPDATE, and this is not belt-and-braces: without it, staff relinking
  --    the card between this read and the commit leaves the function binding and
  --    importing into a deliverable the card no longer points at. The nested
  --    import validates only the deliverable side, so it cannot notice. Cards
  --    are locked BEFORE deliverables here and everywhere, so the two locks are
  --    always taken in the same order.
  select case when v_component = 'graphic' then c.graphic_deliverable_id else c.video_deliverable_id end,
         case when v_component = 'graphic' then c.video_deliverable_id else c.graphic_deliverable_id end,
         case when v_component = 'graphic' then c.graphic_linear_issue_id else c.linear_issue_id end
    into v_card_slot, v_card_other_slot, v_card_link
  from public.calendar_posts c
  where c.client = v_client_slug and c.id = v_card_id
  for update;
  if not found then
    raise exception 'crosswalk_bind_card_missing';
  end if;
  if v_card_slot is distinct from v_deliverable_id then
    raise exception 'crosswalk_bind_card_does_not_reference_deliverable';
  end if;
  v_card_other_slot := nullif(btrim(coalesce(v_card_other_slot, '')), '');

  -- 3. THE DELIVERABLE MUST EXIST, and must not be another client's.
  select d.client_slug, d.card_id, d.kind, d.batch_id,
         case
           when public.crosswalk_linear_identifier(d.linear_identifier) <> ''
             then public.crosswalk_linear_identifier(d.linear_identifier)
           else public.crosswalk_linear_identifier(d.linear_issue_url)
         end
    into v_current_client, v_current_card, v_kind, v_del_batch, v_del_ident
  from public.deliverables d
  where d.id = v_deliverable_id
  for update;
  if not found then
    raise exception 'crosswalk_bind_deliverable_missing';
  end if;
  if v_current_client is not null
     and btrim(v_current_client) <> ''
     and btrim(v_current_client) is distinct from v_client_slug then
    raise exception 'crosswalk_bind_client_mismatch';
  end if;

  -- 4. NEVER RE-POINT AN EXISTING BINDING. Filling an empty binding is a
  --    repair; moving a bound deliverable to a different card is a decision.
  if v_current_card is not null
     and btrim(v_current_card) <> ''
     and btrim(v_current_card) is distinct from v_card_id then
    raise exception 'crosswalk_bind_already_bound_elsewhere';
  end if;

  -- 4b. THE LABEL FOLLOWS THE CARD. See the header: `kind` is a title regex,
  --     and the card's slot is a person's word. It never refuses; it is
  --     normalised on bind to the slot key -- the two values the unique index
  --     and linear-inbound read -- so it can neither collide with the same
  --     card's other slot nor be routed into the wrong one later. (The former
  --     kind refusal lived here.)
  v_kind_after := case when v_component = 'graphic' then 'thumbnail' else 'video' end;

  -- 4c. THE CARD AND THE DELIVERABLE MUST NAME THE SAME LINEAR ISSUE. This is
  --     the only check here that does not descend from the card pointer, and
  --     that is the whole reason it exists: it is what makes a stale pointer
  --     naming an innocent unbound row a refusal rather than a rewrite.
  --     Missing on either side is unproven, and unproven is a refusal.
  v_card_ident := public.crosswalk_linear_identifier(v_card_link);
  if v_card_ident = '' or v_del_ident = '' then
    raise exception 'crosswalk_bind_linear_identity_unproven';
  end if;
  if v_card_ident is distinct from v_del_ident then
    raise exception 'crosswalk_bind_linear_identity_disagrees';
  end if;

  -- 5. THE SLOT. An occupant is any OTHER row already attached to this card in
  --    this slot's family -- the slot's team, or the slot key this row will
  --    carry after the bind (the two keys the unique index and the workload
  --    page respectively read) -- that is not the row the card's other slot
  --    names.
  --    Checked here so a contested slot is REPORTED (or, on request, resolved
  --    by the ruling), rather than surfacing as a unique-violation that says
  --    nothing about which card or which occupant.
  --    The ledger guard would write a bare 'update' event for every row this
  --    function touches; it is bypassed ONLY around writes that record their
  --    own, richer event, and restored to whatever the caller had set.
  v_prev_flag := coalesce(current_setting('app.event_written', true), '');
  for v_occ in
    select d2.id, d2.status, d2.kind, d2.team, d2.batch_id, d2.linear_issue_uuid,
           case
             when public.crosswalk_linear_identifier(d2.linear_identifier) <> ''
               then public.crosswalk_linear_identifier(d2.linear_identifier)
             else public.crosswalk_linear_identifier(d2.linear_issue_url)
           end as ident
    from public.deliverables d2
    where d2.client_slug = v_client_slug
      and d2.origin = 'calendar'
      and d2.card_id = v_card_id
      and d2.id is distinct from v_deliverable_id
      and d2.id is distinct from v_card_other_slot
      and (lower(btrim(coalesce(d2.team, ''))) = v_expected_team
           or lower(btrim(coalesce(d2.kind, ''))) = v_kind_after)
    order by d2.id
    for update
  loop
    if v_evict <> 'card_wins' then
      raise exception 'crosswalk_bind_slot_occupied';
    end if;
    if v_occ.ident <> '' and v_occ.ident = v_card_ident then
      raise exception 'crosswalk_bind_occupant_same_issue';
    end if;
    v_occ_mode := case
      when lower(btrim(coalesce(v_occ.status, ''))) in ('approved', 'posted', 'canceled', 'duplicate') then 'detached'
      else 'canceled'
    end;
    v_occ_team := coalesce(nullif(btrim(coalesce(v_occ.team, '')), ''), v_expected_team);
    v_auth := null;
    if v_occ_mode = 'canceled' then
      -- F27: the authority binder the outbound fence compares, minted exactly
      -- as the gateway mints it. Raises f27_write_authorization_unavailable if
      -- the fence is missing -- a refusal, not a guess.
      v_auth := public.track_b_f27_write_authorization(v_occ_team);
      if lower(coalesce(v_auth->>'authority', '')) <> 'syncview' then
        -- Linear owns this team's status: a native cancel could not reach it
        -- and the fence would refuse the intent. Detach only.
        v_occ_mode := 'detached_authority_linear';
      else
        perform public.production_assert_authority(v_client_slug, v_occ_team, false, false);
      end if;
    end if;
    perform set_config('app.event_written', '1', true);
    update public.deliverables d
    set card_id = null,
        status = case when v_occ_mode = 'canceled' then 'canceled' else d.status end,
        status_at = case when v_occ_mode = 'canceled' then now() else d.status_at end
    where d.id = v_occ.id;
    insert into public.deliverable_events(
      deliverable_id, batch_id, client_slug, ts, actor, role, action,
      from_status, to_status, source, payload
    ) values (
      v_occ.id, v_occ.batch_id, v_client_slug, now(),
      'crosswalk-bind-and-import', 'system', 'crosswalk_occupant_evicted',
      v_occ.status,
      case when v_occ_mode = 'canceled' then 'canceled' else v_occ.status end,
      'reconcile',
      jsonb_build_object(
        'card_id', v_card_id,
        'component', v_component,
        'mode', v_occ_mode,
        'kept_deliverable_id', v_deliverable_id,
        'kept_linear_identifier', v_card_ident,
        'occupant_linear_identifier', v_occ.ident,
        'authority', v_auth->>'authority',
        'authority_generation', v_auth->>'generation',
        'ruling', 'owner 2026-09-05: the card wins'
      )
    );
    perform set_config('app.event_written', v_prev_flag, true);
    -- The cancel reaches Linear through the lane every other status change
    -- uses, carrying the F27 binder that lane requires. A shell that never got
    -- a Linear issue has nothing to cancel there.
    if v_occ_mode = 'canceled' and nullif(btrim(coalesce(v_occ.linear_issue_uuid, '')), '') is not null then
      perform public.mirror_outbox_enqueue(
        p_entity := 'deliverable',
        p_entity_id := v_occ.id,
        p_operation := 'status',
        p_payload := jsonb_build_object(
          'status', 'canceled',
          'reason', 'crosswalk_occupant_evicted',
          'card_id', v_card_id,
          'kept_deliverable_id', v_deliverable_id,
          '_f27_authority_generation', (v_auth->>'generation')::bigint
        ),
        p_dedup_key := 'crosswalk-evict:' || v_occ.id || ':canceled',
        p_source_edited_at := now(),
        p_client_slug := v_client_slug,
        p_team := v_occ_team,
        p_actor := 'crosswalk-bind-and-import',
        p_role := 'system',
        p_deliverable_id := v_occ.id,
        p_batch_id := v_occ.batch_id
      );
    end if;
    v_evicted := v_evicted || jsonb_build_object(
      'deliverable_id', v_occ.id,
      'linear_identifier', v_occ.ident,
      'status_before', v_occ.status,
      'mode', v_occ_mode
    );
  end loop;

  -- 6. BIND. The same four fields `_prodCrosswalkMismatchFields` compares,
  --    plus the slot key from 4b.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set card_id = v_card_id,
      client_slug = v_client_slug,
      origin = 'calendar',
      team = v_expected_team,
      kind = v_kind_after
  where d.id = v_deliverable_id;
  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_deliverable_id, v_del_batch, v_client_slug, now(),
    'crosswalk-bind-and-import', 'system', 'crosswalk_bound',
    null, null, 'reconcile',
    jsonb_build_object(
      'card_id', v_card_id,
      'component', v_component,
      'team', v_expected_team,
      'kind_before', v_kind,
      'kind', v_kind_after,
      'linear_identifier', v_card_ident,
      'evicted', v_evicted
    )
  );
  perform set_config('app.event_written', v_prev_flag, true);
  v_bound := true;

  -- 7. IMPORT, in the same transaction, so the window between a valid binding
  --    and a populated canonical thread never exists for a reader.
  for v_comment in select * from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb))
  loop
    v_processed := v_processed + 1;
    /* production_comment_card_import returns the EXISTING production_comments
       row when the link is already there -- an idempotent retry, or the same
       identity twice in one payload -- and is otherwise indistinguishable from
       an insert. Counting the loop and calling it `imported` would let a repair
       runner certify more copied comments than were created, so the link is
       looked up first and the two outcomes are reported separately. */
    v_native_id := nullif(btrim(v_comment->>'native_comment_id'), '');
    if exists (
      select 1 from public.production_comment_card_links l
      where l.source_surface = 'calendar'
        and l.card_id = v_card_id
        and l.component = v_component
        and l.native_comment_id = v_native_id
    ) then
      v_already := v_already + 1;
    else
      v_imported := v_imported + 1;
    end if;
    perform public.production_comment_card_import(
      jsonb_build_object(
        'source_surface', 'calendar',
        'card_id', v_card_id,
        'component', v_component,
        'native_comment_id', v_comment->>'native_comment_id',
        'deliverable_id', v_deliverable_id,
        'client_slug', v_client_slug,
        'team', v_expected_team,
        'source_fingerprint', v_comment->>'source_fingerprint'
      ),
      v_comment - 'native_comment_id' - 'source_fingerprint',
      coalesce(p_event, '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object(
    'bound', v_bound,
    'deliverable_id', v_deliverable_id,
    'card_id', v_card_id,
    'client_slug', v_client_slug,
    'component', v_component,
    'team', v_expected_team,
    'kind_before', v_kind,
    'kind', v_kind_after,
    'linear_identifier', v_card_ident,
    'evicted', v_evicted,
    -- processed = entries seen; imported = links this call created;
    -- already_linked = entries a previous call had already copied.
    'processed', v_processed,
    'imported', v_imported,
    'already_linked', v_already
  );
end;
$fn$;

revoke all on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)
  to service_role;

comment on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb) is
  'Binds a calendar card to the deliverable the card already references and imports that card''s legacy comment thread in one transaction. Copies; never deletes the legacy thread. Identity (the same Linear issue on both sides) is the proof; kind and team follow the card. Refuses a cross-client reference, an already-bound deliverable, an occupant naming the same issue, and -- unless evict_occupant=card_wins -- a contested card slot.';
