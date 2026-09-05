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
--   * It refuses when the card slot is already held by a DIFFERENT deliverable.
--     `deliverables_card_slot_unique` keys on (client_slug, origin, card_id,
--     kind); 11 slots are contested today, and a blind bind fails the whole
--     statement on the constraint rather than reporting which.
--   * THE CARD POINTER IS NOT SUFFICIENT AUTHORITY ON ITS OWN. A stale pointer
--     that happens to name an unbound deliverable of the same client would,
--     with only the checks above, rewrite that unrelated row and copy the
--     card's conversation onto it. `scripts/f42-linkage-defect-repair.js`
--     (classAObjections) already refuses that class for the planner, and this
--     function now asks the same two independent questions:
--       - `kind` must be the kind the card slot implies. `team` is too coarse:
--         team='video' covers kind='video' AND kind='other', so a bind keyed on
--         team alone can address the wrong artifact and the crosswalk will
--         still call it linked.
--       - The card and the deliverable must name the SAME Linear issue. Either
--         side missing is UNPROVEN, not permission -- a refusal, not a pass.
--     These narrow what the repair can do on its own, deliberately: a slot that
--     cannot prove its identity is a slot for a person, not for a runner.
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
  v_expected_team text;
  v_expected_kind text;
  v_card_slot text;
  v_card_link text;
  v_card_ident text;
  v_kind text;
  v_del_ident text;
  v_current_client text;
  v_current_card text;
  v_occupant text;
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
  v_expected_team := case when v_component = 'graphic' then 'graphics' else 'video' end;
  -- team is NOT kind: team='video' covers kind='video' and kind='other'.
  v_expected_kind := case when v_component = 'graphic' then 'thumbnail' else 'video' end;

  -- 2. THE CARD MUST POINT AT THIS DELIVERABLE. `calendar_posts` is keyed on
  --    (client, id) -- the bare id is reused across clients by design -- so the
  --    lookup carries both. Reading the slot the component names is what makes
  --    the bind safe: this function never invents a link, it only records the
  --    one the card already asserts.
  --    FOR UPDATE, and this is not belt-and-braces: without it, staff relinking
  --    the card between this read and the commit leaves the function binding and
  --    importing into a deliverable the card no longer points at. The nested
  --    import validates only the deliverable side, so it cannot notice. Cards
  --    are locked BEFORE deliverables here and everywhere, so the two locks are
  --    always taken in the same order.
  select case when v_component = 'graphic' then c.graphic_deliverable_id else c.video_deliverable_id end,
         case when v_component = 'graphic' then c.graphic_linear_issue_id else c.linear_issue_id end
    into v_card_slot, v_card_link
  from public.calendar_posts c
  where c.client = v_client_slug and c.id = v_card_id
  for update;
  if not found then
    raise exception 'crosswalk_bind_card_missing';
  end if;
  if v_card_slot is distinct from v_deliverable_id then
    raise exception 'crosswalk_bind_card_does_not_reference_deliverable';
  end if;

  -- 3. THE DELIVERABLE MUST EXIST, and must not be another client's.
  select d.client_slug, d.card_id, d.kind,
         case
           when public.crosswalk_linear_identifier(d.linear_identifier) <> ''
             then public.crosswalk_linear_identifier(d.linear_identifier)
           else public.crosswalk_linear_identifier(d.linear_issue_url)
         end
    into v_current_client, v_current_card, v_kind, v_del_ident
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

  -- 4b. THE ROW MUST BE THE RIGHT KIND FOR THIS SLOT. See the header: `team`
  --     alone cannot prove it, and a bind onto the wrong kind produces a link
  --     the crosswalk accepts while it addresses the wrong artifact.
  if lower(btrim(coalesce(v_kind, ''))) is distinct from v_expected_kind then
    raise exception 'crosswalk_bind_kind_does_not_match_slot';
  end if;

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

  -- 5. THE SLOT MUST BE FREE. Checked here so a contested slot is REPORTED,
  --    rather than surfacing as a unique-violation that says nothing about
  --    which card or which occupant.
  select d2.id into v_occupant
  from public.deliverables d2
  where d2.client_slug = v_client_slug
    and d2.origin = 'calendar'
    and d2.card_id = v_card_id
    and d2.kind is not distinct from v_kind
    and d2.id is distinct from v_deliverable_id
  limit 1;
  if v_occupant is not null then
    raise exception 'crosswalk_bind_slot_occupied';
  end if;

  -- 6. BIND. Same four fields `_prodCrosswalkMismatchFields` compares.
  update public.deliverables d
  set card_id = v_card_id,
      client_slug = v_client_slug,
      origin = 'calendar',
      team = v_expected_team
  where d.id = v_deliverable_id;
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
    'linear_identifier', v_card_ident,
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
  'Binds a calendar card to the deliverable the card already references and imports that card''s legacy comment thread in one transaction. Copies; never deletes the legacy thread. Refuses a cross-client reference, an already-bound deliverable, and a contested card slot.';
