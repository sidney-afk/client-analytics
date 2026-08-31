-- Fill a card's MISSING component, from the calendar card that is missing it.
--
-- THE PROBLEM. Measured live 2026-08-31 across non-archived calendar cards:
--
--     both components   459
--     video only         67   <- needs a thumbnail
--     graphic only       60   <- needs a video
--     neither           102   (drafts; not this function's business)
--
-- 127 cards carry half a post. Today there is no way to complete one. The
-- Production tab refuses creation outright (`_prodCreateGateText` returns
-- PROD_CREATE_CLOSED_TEXT everywhere) and that refusal is CORRECT and stays:
-- the owner's ruling 2026-08-31 is that nothing may be created from SyncLinear
-- that would not appear on the calendar. So the affordance belongs on the
-- card, and the write has to be born attached to that card.
--
-- WHY NOT production_intake_append, WHICH ALREADY APPENDS TO A BATCH. It
-- cannot serve this, and the reason is a numbering contract rather than an
-- oversight. Both halves of that path -- planAppendIntakeItems in policy.mjs
-- and the RPC itself -- independently compute
--
--     ordinal := base + group_index
--
-- and refuse any row whose title is not exactly 'Video ' || ordinal. That is
-- right for an intake, where the batch numbers its own children densely. It is
-- wrong for a repair. Of the 126 readable siblings behind those 127 cards only
-- 65 are titled in the strict 'Video N' / 'Thumbnail N' form; the other 61 are
-- human-titled Linear-era issues -- 'Doug Cartwright | Jun. 29 - Jul. 5 |
-- Reel 4', 'Video 6 - Before Coming To Us', '5. When Gut Protocols Don''t
-- Work' -- and 21 of the conforming ones carry a null sort_key. Riding append
-- would refuse half the population with invalid_intake_append_order, and for
-- the other half would hand the new component the NEXT free number, so a card
-- would read 'Video 9' beside 'Thumbnail 12'.
--
-- A fill is not an intake. It inherits; it does not allocate.
--
-- WHAT THIS INHERITS FROM THE SIBLING, under the batch lock:
--   * the batch, and therefore the Linear parent route;
--   * sort_key EXACTLY, null included, so the pair stays adjacent wherever the
--     sibling already sits;
--   * the title, composed by the gateway from the sibling's own (see
--     componentFillTitle in policy.mjs) and only length-checked here.
-- It allocates nothing, which is the whole reason it is a separate function
-- from the one that does.
--
-- WHAT IT REFUSES, and these are the guarantees the owner asked for:
--   * component_fill_card_mismatch -- the sibling does not carry the card_id
--     the caller named. The card the browser is looking at must be the card
--     the work actually belongs to; a fill can never invent an attachment.
--   * component_fill_team_occupied -- that card already has a deliverable of
--     the team being filled, anywhere for this client. This is the duplicate
--     guard, and it is checked against COMMITTED ROWS rather than the request,
--     so two tabs racing the same button produce one component, not two.
--   * every guard production_intake_append already applies: batch active,
--     CAS on batches.updated_at, origin/purpose agreement, kind/team
--     agreement, the parent-map or dependency route, production_assert_authority
--     for the team being written, and production_outbox_replay for exact
--     retries. None of them is relaxed here.
--
-- There is deliberately no path that creates a CARD. This function requires
-- one to exist already, which is what makes an orphaned component impossible
-- through it: a component created here is, by construction, attached to a card
-- someone was looking at.
--
-- ADDITIVE. Installs one new function; no table, column, index, trigger,
-- policy, flag or authority value is touched, and no row is written at install
-- time. production_intake_append is not modified -- read this file beside it,
-- not over it.
--
-- ORDER OF INSTALLATION. Apply this FIRST, then deploy production-write, then
-- ship the browser half. Alone it is inert: nothing calls it until the gateway
-- is redeployed. Any other order shows an SMM a button whose save 500s.
--
-- Compiled against a disposable PostgreSQL 16 over the live schema baseline
-- before handover -- house rule since the v2 CASE defect: no migration is
-- handed over unexecuted.

begin;

create or replace function public.production_component_fill(
  p_batch_id text,
  p_expected_updated_at timestamptz,
  p_sibling_id text,
  p_row jsonb,
  p_event jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch public.batches%rowtype;
  v_sibling public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_outbound jsonb;
  v_payload jsonb;
  v_team text;
  v_card_id text;
  v_title text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dep_parent_ids text[];
  v_shared_parent boolean;
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_terminal_dependency boolean := false;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_sibling_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_row) is distinct from 'object'
     or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid_component_fill_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  v_outbound := coalesce(p_event->'outbound', '{}'::jsonb);
  v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_team := nullif(btrim(p_row->>'team'), '');
  v_card_id := nullif(btrim(p_row->>'card_id'), '');
  v_title := nullif(btrim(coalesce(p_row->>'title', '')), '');
  v_project_id := nullif(btrim(v_payload->>'project_id'), '');

  -- THE SIBLING IS THE AUTHORITY on where this component belongs. Locked in
  -- the same transaction as the batch so it cannot be re-carded underneath us.
  select d.* into v_sibling
  from public.deliverables d
  where d.id = p_sibling_id
  for update;
  if not found then raise exception 'component_fill_sibling_missing'; end if;
  if v_sibling.batch_id is distinct from v_batch.id
     or v_sibling.client_slug is distinct from v_batch.client_slug then
    raise exception 'component_fill_sibling_missing';
  end if;
  -- The card the caller named must be the card the sibling actually carries.
  -- Without this a caller could point any card at any batch's work.
  if v_card_id is null
     or nullif(btrim(coalesce(v_sibling.card_id, '')), '') is distinct from v_card_id then
    raise exception 'component_fill_card_mismatch';
  end if;
  if v_sibling.team is not distinct from v_team then
    raise exception 'component_fill_team_occupied';
  end if;

  -- THE DUPLICATE GUARD, against committed rows rather than the request: two
  -- tabs racing this button serialize on the batch lock, and the second one
  -- sees the first one's row and refuses.
  if exists (
    select 1
    from public.deliverables d
    where d.client_slug = v_batch.client_slug
      and nullif(btrim(coalesce(d.card_id, '')), '') = v_card_id
      and d.team = v_team
      and d.id is distinct from p_row->>'id'
  ) then
    raise exception 'component_fill_team_occupied';
  end if;

  if nullif(btrim(p_row->>'id'), '') is null
     or p_row->>'batch_id' is distinct from v_batch.id
     or p_row->>'client_slug' is distinct from v_batch.client_slug
     or v_team is null
     or v_team not in ('video', 'graphics')
     or v_title is null
     or length(v_title) > 500
     -- Same origin/purpose agreement as the append path: a samples row may
     -- only land in a samples batch and a calendar row only in a calendar one.
     or p_row->>'origin' not in ('calendar', 'samples')
     or p_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')
     -- Parenthesised because PL/pgSQL ends an IF condition at the first THEN.
     or p_row->>'kind' is distinct from (case when v_team = 'graphics' then 'thumbnail' else 'video' end)
     or p_event->>'source' is distinct from 'ui'
     or p_event->>'action' is distinct from 'create'
     or v_outbound->>'entity' is distinct from 'deliverable'
     or v_outbound->>'entity_id' is distinct from p_row->>'id'
     or v_outbound->>'team' is distinct from v_team
     or v_outbound->>'operation' is distinct from 'create'
     or nullif(btrim(v_outbound->>'dedup_key'), '') is null
     or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
     or v_project_id is null then
    raise exception 'invalid_component_fill_payload';
  end if;

  -- SORT KEY IS INHERITED EXACTLY, null included. 21 of the 65 conforming
  -- siblings measured on 2026-08-31 carry a null sort_key, so "must be a
  -- number" would refuse a third of the population this exists to serve.
  -- Compared as numeric rather than as jsonb because jsonb preserves the
  -- scale it was given and 3 is not 3.0 textually.
  if p_row ? 'sort_key' and jsonb_typeof(p_row->'sort_key') not in ('number', 'null') then
    raise exception 'invalid_component_fill_payload';
  end if;
  if (p_row->>'sort_key')::numeric is distinct from v_sibling.sort_key then
    raise exception 'component_fill_sort_mismatch';
  end if;

  -- The parent route, byte-for-byte the append path's rule: either the batch's
  -- recorded parent for this team, or a pending batch-create outbox row this
  -- child depends on. Exactly one of the two.
  v_parent_id := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
  begin
    v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  exception when others then
    raise exception 'invalid_component_fill_route';
  end;
  if (v_parent_id is null) = (v_dependency_id is null) then
    raise exception 'invalid_component_fill_route';
  end if;
  if v_parent_id is not null then
    v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
    if cardinality(v_parent_ids) > 1 then
      raise exception 'batch_parent_mapping_ambiguous';
    end if;
    if cardinality(v_parent_ids) <> 1 or v_parent_ids[1] is distinct from v_parent_id then
      raise exception 'batch_parent_mapping_missing';
    end if;
  else
    select o.* into v_dependency
    from public.mirror_outbox o
    where o.id = v_dependency_id
    for share;
    if not found then
      raise exception 'batch_parent_mapping_missing';
    end if;
    -- The shared-parent waiver, carried over verbatim from the append path
    -- (v4): one Linear issue can serve both teams, and when it does, a
    -- graphics child legitimately arrives carrying the VIDEO batch-create
    -- dependency -- whose team, parity and project describe its own lane, not
    -- the row's. Earned, not assumed: it applies only when both teams resolve
    -- to the identical single parent issue.
    v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
    v_dep_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_dependency.team);
    v_shared_parent := v_dependency.team is distinct from v_team
      and cardinality(v_parent_ids) = 1
      and v_parent_ids = v_dep_parent_ids;
    if v_dependency.entity is distinct from 'batch'
       or v_dependency.entity_id is distinct from v_batch.id
       or v_dependency.operation is distinct from 'create'
       or v_dependency.client_slug is distinct from v_batch.client_slug
       or (v_dependency.team is distinct from v_team and not v_shared_parent)
       or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
       or (v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
           and not v_shared_parent)
       or (v_dependency.payload->>'project_id' is distinct from v_project_id
           and not v_shared_parent)
       or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale') then
      raise exception 'batch_parent_mapping_missing';
    end if;
    if cardinality(v_parent_ids) > 1 then
      raise exception 'batch_parent_mapping_ambiguous';
    end if;
    if cardinality(v_parent_ids) = 1 then
      v_dependency_parent_id := nullif(btrim(coalesce(
        v_dependency.linear_result->>'issue_id',
        v_dependency.linear_result->>'linear_issue_id',
        v_dependency.linear_result->'issue'->>'id',
        ''
      )), '');
      if v_dependency_parent_id is distinct from v_parent_ids[1] then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
    end if;
    if v_dependency.status in ('skipped', 'stale') then
      v_terminal_dependency := true;
    end if;
  end if;

  perform public.production_assert_authority(
    v_batch.client_slug,
    v_team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );

  -- An exact retry returns the row it already made, and does not make a second.
  v_replay := public.production_outbox_replay(
    'deliverable',
    p_row->>'id',
    'create',
    v_batch.client_slug,
    v_team,
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_payload->>'_intent_fingerprint',
    v_outbound->>'dedup_key'
  );
  if v_replay then
    select d.* into v_result from public.deliverables d where d.id = p_row->>'id';
    if not found
       or v_result.batch_id is distinct from v_batch.id
       or v_result.client_slug is distinct from v_batch.client_slug
       or v_result.team is distinct from v_team
       or v_result.card_id is distinct from v_card_id
       or v_result.title is distinct from v_title then
      raise exception 'idempotent_result_missing';
    end if;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  v_result := public.production_deliverable_write(p_row, p_event);

  -- The cursor advances under the same batch lock and transaction as the child
  -- and its outbox intent, so a concurrent fill carrying this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    'component_fill',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(p_event->>'surface', ''),
      'card_id', v_card_id,
      'team', v_team,
      'sibling_id', v_sibling.id
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', false);
end;
$fn$;

revoke all on function public.production_component_fill(text, timestamptz, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_component_fill(text, timestamptz, text, jsonb, jsonb)
  to service_role;

commit;

-- OWNER-ONLY ROLLBACK.
--
-- This installs a NEW function and modifies nothing, so the rollback is a drop
-- -- but only AFTER the gateway that calls it is redeployed without the
-- `component_fill` operation. Dropping it under a deployed caller turns every
-- press of the card button into a missing-function 500, which is worse than
-- the behaviour being rolled back.
--
--     drop function if exists public.production_component_fill(text, timestamptz, text, jsonb, jsonb);
--
-- ONE-STEP CONTAINMENT, if the button must stop before any deploy can run: set
-- the affected team's prod_authority back to `linear`. production_assert_authority
-- is called before the write, so every fill for that team refuses at the
-- database with no deploy and no stale-tab window -- and the browser stops
-- offering the control for the same reason, so there is no dead button. Its
-- cost is the usual one: it also stops every other native write for that team.
--
-- What a rollback does NOT undo, deliberately: a component someone already
-- filled stays filled, and its card keeps the link. The row is an ordinary
-- deliverable with an ordinary outbox leg from that point on; there is no
-- queue to drain and nothing in flight that is special to this path.
