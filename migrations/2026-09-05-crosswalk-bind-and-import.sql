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
--
-- Service-role only, like every other function in this family.

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
  v_card_slot text;
  v_kind text;
  v_current_client text;
  v_current_card text;
  v_occupant text;
  v_comment jsonb;
  v_imported int := 0;
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

  -- 2. THE CARD MUST POINT AT THIS DELIVERABLE. `calendar_posts` is keyed on
  --    (client, id) -- the bare id is reused across clients by design -- so the
  --    lookup carries both. Reading the slot the component names is what makes
  --    the bind safe: this function never invents a link, it only records the
  --    one the card already asserts.
  select case when v_component = 'graphic' then c.graphic_deliverable_id else c.video_deliverable_id end
    into v_card_slot
  from public.calendar_posts c
  where c.client = v_client_slug and c.id = v_card_id;
  if not found then
    raise exception 'crosswalk_bind_card_missing';
  end if;
  if v_card_slot is distinct from v_deliverable_id then
    raise exception 'crosswalk_bind_card_does_not_reference_deliverable';
  end if;

  -- 3. THE DELIVERABLE MUST EXIST, and must not be another client's.
  select d.client_slug, d.card_id, d.kind
    into v_current_client, v_current_card, v_kind
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
    v_imported := v_imported + 1;
  end loop;

  return jsonb_build_object(
    'bound', v_bound,
    'deliverable_id', v_deliverable_id,
    'card_id', v_card_id,
    'client_slug', v_client_slug,
    'component', v_component,
    'team', v_expected_team,
    'imported', v_imported
  );
end;
$fn$;

revoke all on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb)
  to service_role;

comment on function public.production_comment_card_bind_and_import(jsonb, jsonb, jsonb) is
  'Binds a calendar card to the deliverable the card already references and imports that card''s legacy comment thread in one transaction. Copies; never deletes the legacy thread. Refuses a cross-client reference, an already-bound deliverable, and a contested card slot.';
