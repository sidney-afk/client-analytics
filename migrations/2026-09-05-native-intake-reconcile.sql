-- 2026-09-05. Server-owned completion of ACCEPTED native intake work. Draft, unapplied.
--
-- Depends on PR1293 (production_intake_manifests, production_intake_root_begin) and
-- PR1302 (manifest.native_epochs, terminal native receipts). Install after both.
-- Additive: two reconciliation RPCs, two read-only inventory RPCs, helpers, and
-- one append-only card provenance table with row triggers on the card tables.
-- No existing table, column, trigger, flag, policy or frozen writer is changed. Rollback
-- retains every accepted row this creates; see the audit for the release order.
--
-- WHAT IS RECONCILED. A root intake is accepted when production_intake_root_begin
-- commits the manifest and the parent together. From that moment the request owes
-- (1) one deliverable per expected item, written through the same
-- production_deliverable_write path the gateway uses, with the ORIGINAL ids,
-- content, receipt keys, fingerprints and accepted per-team epoch, and (2) one
-- Calendar or Samples card per expected card id, whose two slots point at those
-- deliverables. Today the gateway writes (1) child by child in separate
-- transactions and the BROWSER writes (2) after the response arrives, so a lost
-- response, a closed tab or a cleared localStorage strands either obligation.
--
-- WHAT IS NOT RECONCILED, ON PURPOSE.
--   * Provider-era children (an accepted team epoch of '') are reported, never
--     recreated: they would be pending Linear intents whose drain state this
--     path cannot own. Their retry owner remains the explicit original request
--     through the gateway. Native completion makes no provider call.
--   * Requests without a manifest (pre-PR1293 receipts) are invisible here.
--   * A card that once existed and is now gone, an archived card, an occupied
--     slot, a deliverable a human re-carded or un-carded, a row whose identity
--     disagrees with the manifest: all are reported with a durable reason and an
--     owner, never repaired blindly.
--
-- COMPLETION IS A FACT, NOT A STATUS. Neither RPC keeps a state column. Stage 1
-- is complete when every expected deliverable row exists with its identity and
-- carries its receipt; stage 2 is complete when the card row's slots equal the
-- expected ids. The reconcile event rows written to deliverable_events (source
-- 'reconcile') are the durable REASON ledger for what could not be completed and
-- are never consulted to decide completeness.
begin;

create or replace function public.production_intake_reconcile_iso(p_ts timestamptz)
returns text language sql immutable as $$
  select to_char(p_ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
revoke all on function public.production_intake_reconcile_iso(timestamptz) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_iso(timestamptz) to service_role;


-- Reasons are CODES, never free text. The ledger rows below are readable with
-- the anon key (deliverable_events is anon-readable by policy), the runner
-- prints aggregates of them publicly, and PostgreSQL's own messages can carry
-- row values. Any message that is not one of the codes this file or the writers
-- raise collapses to its SQLSTATE class.
create or replace function public.production_intake_reconcile_reason(p_message text, p_state text)
returns text language plpgsql immutable as $$
declare
  v_code text := lower(coalesce(substring(p_message from '^[a-z_]+'), ''));
begin
  if v_code = any (array['card_archived', 'card_slot_occupied', 'card_deleted_after_creation',
      'card_provenance_unavailable', 'reconcile_readback_mismatch', 'authority_unavailable',
      'team_is_linear_authoritative', 'legacy_parity_gate_unavailable', 'legacy_parity_not_allowed',
      'test_client_scope_required', 'idempotency_conflict', 'write_conflict', 'idempotent_result_missing',
      'project_mapping_missing', 'team_rollback_hold', 'f27_authority_generation_stale', 'f27_drill_insert_forbidden',
      'invalid_outbound_entity', 'invalid_outbound_operation', 'incomplete_outbound_intent', 'invalid_f27_authority_binder',
      'production_deliverable_id_required', 'production_write_dedup_and_intent_fingerprint_required']) then
    return v_code;
  end if;
  return 'sql_error:' || coalesce(nullif(p_state, ''), 'XX000');
end;
$$;
revoke all on function public.production_intake_reconcile_reason(text, text) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_reason(text, text) to service_role;

-- Read-only. The complete obligation state of one accepted request, derived
-- from the manifest and the current rows. Used by both stages, the backlog
-- pager and the proof lane, so there is exactly one definition of "owed".
create or replace function public.production_intake_reconcile_state(p_request_id text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m public.production_intake_manifests;
  v_batch public.batches;
  v_purpose text;
  v_item jsonb;
  v_row jsonb;
  v_d public.deliverables;
  v_receipt public.mirror_outbox;
  v_children jsonb := '[]';
  v_cards jsonb := '[]';
  v_card record;
  v_card_found boolean;
  v_card_status text;
  v_card_video text;
  v_card_graphic text;
  v_slots jsonb;
  v_card_complete boolean;
  v_events_seen boolean;
  v_epoch text;
  v_present boolean;
  v_terminal_ok boolean;
  v_owed_native int := 0;
  v_owed_provider int := 0;
  v_owed_cards int := 0;
  v_missing_terminal int := 0;
  v_conflicts int := 0;
  v_identity_ok boolean;
  v_provenance jsonb;
  v_installed timestamptz;
begin
  select * into v_m from public.production_intake_manifests where request_id = p_request_id;
  if not found then raise exception 'intake_manifest_missing'; end if;
  select * into v_batch from public.batches where id = v_m.batch_id;
  v_purpose := coalesce(v_batch.purpose, 'calendar');
  select min(at) into v_installed from public.production_card_provenance where kind = 'installed' and surface = v_purpose;

  for v_item in select value from jsonb_array_elements(v_m.expected_items) order by (value->>'item_index')::int loop
    v_row := v_item->'row';
    v_epoch := coalesce(v_m.native_epochs->>(v_row->>'team'), '');
    select * into v_d from public.deliverables where id = v_row->>'id';
    v_present := found;
    v_identity_ok := not v_present or (
      v_d.batch_id is not distinct from v_m.batch_id
      and v_d.client_slug is not distinct from v_m.client_slug
      and v_d.team is not distinct from v_row->>'team'
      and v_d.kind is not distinct from v_row->>'kind');
    select * into v_receipt from public.mirror_outbox where dedup_key = v_item->>'child_dedup';
    v_terminal_ok := found and (v_epoch = '' or (v_receipt.status = 'skipped'
      and coalesce(v_receipt.payload->>'_native_intake_epoch', '') = v_epoch));
    if not v_present then
      if v_epoch <> '' then v_owed_native := v_owed_native + 1; else v_owed_provider := v_owed_provider + 1; end if;
    elsif not v_identity_ok then
      v_conflicts := v_conflicts + 1;
    elsif not v_terminal_ok then
      v_missing_terminal := v_missing_terminal + 1;
    end if;
    v_children := v_children || jsonb_build_object(
      'id', v_row->>'id', 'team', v_row->>'team', 'kind', v_row->>'kind',
      'expected_card_id', v_row->>'card_id', 'video_number', v_item->'video_number',
      'epoch', v_epoch, 'present', v_present, 'identity_ok', v_identity_ok,
      'current_card_id', case when v_present then v_d.card_id end,
      'receipt_status', case when v_receipt.id is not null then v_receipt.status end,
      'terminal_ok', v_terminal_ok);
  end loop;

  for v_card in
    select value->'row'->>'card_id' as card_id, min((value->>'video_number')::int) as number,
           jsonb_agg(value->'row'->>'id' order by (value->>'item_index')::int) as item_ids
    from jsonb_array_elements(v_m.expected_items)
    group by value->'row'->>'card_id'
    order by min((value->>'item_index')::int)
  loop
    if v_purpose = 'samples' then
      select true, s.status, s.video_deliverable_id, s.graphic_deliverable_id
        into v_card_found, v_card_status, v_card_video, v_card_graphic
      from public.sample_reviews s where s.id = v_card.card_id and s.client = v_m.client_slug;
      v_events_seen := exists(select 1 from public.sample_review_events e
        where e.client = v_m.client_slug and e.sample_id = v_card.card_id);
    else
      select true, c.status, c.video_deliverable_id, c.graphic_deliverable_id
        into v_card_found, v_card_status, v_card_video, v_card_graphic
      from public.calendar_posts c where c.id = v_card.card_id and c.client = v_m.client_slug;
      v_events_seen := exists(select 1 from public.calendar_post_events e
        where e.client = v_m.client_slug and e.post_id = v_card.card_id);
    end if;
    v_card_found := coalesce(v_card_found, false);
    v_provenance := (select coalesce(jsonb_object_agg(kind, n), '{}') from (
      select kind, count(*) as n from public.production_card_provenance p
      where p.surface = v_purpose and p.client = v_m.client_slug and p.card_id = v_card.card_id group by kind) t);
    -- Expected slot ids come from the manifest; a slot is satisfied only when the
    -- card row names exactly that deliverable.
    v_slots := '{}';
    v_card_complete := v_card_found;
    for v_item in select value from jsonb_array_elements(v_m.expected_items)
        where value->'row'->>'card_id' = v_card.card_id loop
      v_row := v_item->'row';
      v_slots := v_slots || jsonb_build_object(v_row->>'team', jsonb_build_object(
        'expected', v_row->>'id',
        'current', case when v_card_found then
          case when v_row->>'team' = 'graphics' then v_card_graphic else v_card_video end end));
      if not v_card_found or nullif(btrim(coalesce(
          case when v_row->>'team' = 'graphics' then v_card_graphic else v_card_video end, '')), '')
          is distinct from v_row->>'id' then
        v_card_complete := false;
      end if;
    end loop;
    if not v_card_complete then v_owed_cards := v_owed_cards + 1; end if;
    v_cards := v_cards || jsonb_build_object(
      'card_id', v_card.card_id, 'number', v_card.number, 'surface', v_purpose,
      'item_ids', v_card.item_ids, 'present', v_card_found,
      'status', case when v_card_found then v_card_status end,
      'events_seen', v_events_seen, 'provenance', v_provenance,
      'provenance_recorded_since_acceptance', v_m.recorded_at >= v_installed,
      'slots', v_slots, 'complete', v_card_complete);
    v_card_found := null; v_card_status := null; v_card_video := null; v_card_graphic := null;
  end loop;

  return jsonb_build_object(
    'request_id', v_m.request_id, 'batch_id', v_m.batch_id, 'client_slug', v_m.client_slug,
    'surface', v_purpose, 'batch_status', v_batch.status, 'recorded_at', v_m.recorded_at,
    'native_epochs', v_m.native_epochs, 'children', v_children, 'cards', v_cards,
    'owed', jsonb_build_object('children_native', v_owed_native, 'children_provider', v_owed_provider,
      'cards', v_owed_cards, 'identity_conflicts', v_conflicts, 'missing_terminal_receipts', v_missing_terminal),
    'complete', (v_owed_native + v_owed_provider + v_owed_cards + v_conflicts + v_missing_terminal) = 0);
end;
$$;
revoke all on function public.production_intake_reconcile_state(text) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_state(text) to service_role;

-- Durable reason ledger. Written OUTSIDE the stage subtransaction so a refused
-- or rolled-back stage still leaves its reason. source='reconcile' keeps this
-- out of the outbound-intent trigger (it enqueues only source='ui').
create or replace function public.production_intake_reconcile_record(
  p_m public.production_intake_manifests, p_actor text, p_stage text, p_outcome text, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.deliverable_events(deliverable_id, batch_id, client_slug, ts, actor, role,
    action, from_status, to_status, source, payload)
  values (null, p_m.batch_id, p_m.client_slug, clock_timestamp(), p_actor, 'reconciler',
    'native_intake_reconcile', null, null, 'reconcile',
    jsonb_build_object('request_id', p_m.request_id, 'stage', p_stage, 'outcome', p_outcome) || coalesce(p_detail, '{}'));
end;
$$;
revoke all on function public.production_intake_reconcile_record(public.production_intake_manifests, text, text, text, jsonb)
  from public, anon, authenticated, service_role;


-- CARD PROVENANCE. Independent review of the first head found two holes in
-- the card stage that the frozen writers cannot close from their side:
--
--   (a) "no calendar_post_events row" was read as "never created". The writers
--       insert their events through EdgeRuntime.waitUntil, best effort, after the
--       row commit; a card can commit, lose its create event, be deleted by a
--       person, and the reconciler would have recreated it.
--   (b) an ORIGINAL browser job that resumes after the reconciler created the
--       card sends the complete initial row again with no comments_base_at, so
--       the writer's scalar CAS never engages and a person's rename, schedule or
--       archive between the two is overwritten. Old tabs and saved jobs keep
--       doing this whatever new browser code ships.
--
-- Both are closed at the ONE layer every caller shares: the tables. Row
-- triggers run inside the writer's own transaction, so they are durable, and
-- they see the writer's effect without the writer changing. No writer body, no
-- credential, no refusal is added; the frozen anonymous writers stay exactly as
-- they serve.
create table public.production_card_provenance (
  id bigint generated always as identity primary key,
  surface text not null check (surface in ('calendar', 'samples')),
  client text not null,
  card_id text not null,
  kind text not null check (kind in ('created', 'deleted', 'installed')),
  at timestamptz not null default clock_timestamp(),
  materialization boolean not null default false,
  initial jsonb,
  snapshot jsonb,
  source text
);
create index production_card_provenance_card_idx on public.production_card_provenance (surface, client, card_id, kind);
alter table public.production_card_provenance enable row level security;
revoke all on public.production_card_provenance from public, anon, authenticated, service_role;
grant select on public.production_card_provenance to service_role;
comment on table public.production_card_provenance is
  'Append-only card creation/deletion provenance written by row triggers inside the writer transaction. The installed marker bounds what the reconciler may treat as never created. Retain on rollback.';
-- The marker: any request accepted before this row cannot prove a card was
-- never created, because no provenance was being recorded then.
insert into public.production_card_provenance(surface, client, card_id, kind, source)
values ('calendar', '', '', 'installed', 'migration'), ('samples', '', '', 'installed', 'migration');

-- The exact field set the browser materialization sends and the writer
-- persists for an existing card (scalarPayloadForExisting): everything a late
-- replay would overwrite. Link and slot columns are handled separately.
create or replace function public.production_card_signature(p_surface text, p_row jsonb)
returns jsonb language sql immutable as $$
  select case when p_surface = 'samples'
    then jsonb_build_object('name', p_row->>'name', 'creative_direction', p_row->>'creative_direction',
      'hide_creative_direction', p_row->>'hide_creative_direction', 'status', p_row->>'status',
      'video_status', p_row->>'video_status', 'graphic_status', p_row->>'graphic_status',
      'asset_url', p_row->>'asset_url', 'thumbnail_url', p_row->>'thumbnail_url')
    else jsonb_build_object('name', p_row->>'name', 'scheduled_date', p_row->>'scheduled_date',
      'status', p_row->>'status', 'video_status', p_row->>'video_status', 'graphic_status', p_row->>'graphic_status',
      'caption_status', p_row->>'caption_status', 'asset_url', p_row->>'asset_url', 'thumbnail_url', p_row->>'thumbnail_url',
      'caption', p_row->>'caption', 'cta', p_row->>'cta') end
$$;
revoke all on function public.production_card_signature(text, jsonb) from public, anon, authenticated;

-- A native materialization is recognisable from the row alone: fresh statuses,
-- no schedule, and at least one deliverable slot bound at creation.
create or replace function public.production_card_is_materialization(p_surface text, p_row jsonb)
returns boolean language sql immutable as $$
  select coalesce(p_row->>'status', '') = 'In Progress'
    and coalesce(p_row->>'video_status', '') = 'In Progress'
    and coalesce(p_row->>'graphic_status', '') = 'In Progress'
    and (nullif(p_row->>'video_deliverable_id', '') is not null or nullif(p_row->>'graphic_deliverable_id', '') is not null)
    and (p_surface = 'samples' or coalesce(p_row->>'scheduled_date', '') = '')
$$;
revoke all on function public.production_card_is_materialization(text, jsonb) from public, anon, authenticated;

create or replace function public.production_card_provenance_record()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_surface text := case when tg_table_name = 'sample_reviews' then 'samples' else 'calendar' end;
  v_row jsonb;
begin
  if tg_op = 'INSERT' then
    v_row := to_jsonb(new);
    insert into public.production_card_provenance(surface, client, card_id, kind, materialization, initial, snapshot, source)
    values (v_surface, new.client, new.id, 'created', public.production_card_is_materialization(v_surface, v_row),
      public.production_card_signature(v_surface, v_row),
      jsonb_build_object('video_deliverable_id', v_row->>'video_deliverable_id', 'graphic_deliverable_id', v_row->>'graphic_deliverable_id'),
      nullif(current_setting('app.card_materialization_source', true), ''));
    return new;
  end if;
  v_row := to_jsonb(old);
  insert into public.production_card_provenance(surface, client, card_id, kind, materialization, initial, snapshot, source)
  values (v_surface, old.client, old.id, 'deleted', false, null,
    jsonb_build_object('status', v_row->>'status', 'video_deliverable_id', v_row->>'video_deliverable_id',
      'graphic_deliverable_id', v_row->>'graphic_deliverable_id'),
    nullif(current_setting('app.card_materialization_source', true), ''));
  return old;
end;
$$;
revoke all on function public.production_card_provenance_record() from public, anon, authenticated, service_role;
create trigger zz_production_card_provenance after insert or delete on public.calendar_posts
  for each row execute function public.production_card_provenance_record();
create trigger zz_production_card_provenance after insert or delete on public.sample_reviews
  for each row execute function public.production_card_provenance_record();

-- THE LATE MATERIALIZATION GUARD. Engaged only when this card was CREATED as a
-- materialization (provenance says so) and the incoming update carries exactly
-- the initial signature that creation recorded. That is the fingerprint of the
-- original browser job replaying its create over a card that already exists;
-- a person editing a card sends a different name, date, status or caption and
-- never matches all of it at once. On a match the human-owned fields keep
-- their current values, a slot that already names a different deliverable
-- keeps it, and the write otherwise proceeds: the caller still gets its
-- acknowledgement, the card still gains any empty slot, nothing is refused.
create or replace function public.production_card_materialization_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_surface text := case when tg_table_name = 'sample_reviews' then 'samples' else 'calendar' end;
  v_initial jsonb;
  v_new jsonb := to_jsonb(new);
  v_old jsonb := to_jsonb(old);
  v_key text;
begin
  select p.initial into v_initial from public.production_card_provenance p
    where p.surface = v_surface and p.client = new.client and p.card_id = new.id
      and p.kind = 'created' and p.materialization
    order by p.at desc, p.id desc limit 1;
  if v_initial is null then return new; end if;
  if public.production_card_signature(v_surface, v_new) is distinct from v_initial then return new; end if;
  if public.production_card_signature(v_surface, v_old) is not distinct from v_initial
     and v_old->>'order_index' is not distinct from v_new->>'order_index' then return new; end if;
  -- Recognised replay over an edited card: keep every human-owned field.
  for v_key in select jsonb_object_keys(v_initial) union all select 'order_index' loop
    v_new := jsonb_set(v_new, array[v_key], coalesce(v_old->v_key, 'null'::jsonb), true);
  end loop;
  if nullif(old.video_deliverable_id, '') is not null and new.video_deliverable_id is distinct from old.video_deliverable_id then
    v_new := jsonb_set(v_new, '{video_deliverable_id}', to_jsonb(old.video_deliverable_id), true); end if;
  if nullif(old.graphic_deliverable_id, '') is not null and new.graphic_deliverable_id is distinct from old.graphic_deliverable_id then
    v_new := jsonb_set(v_new, '{graphic_deliverable_id}', to_jsonb(old.graphic_deliverable_id), true); end if;
  if tg_table_name = 'sample_reviews' then
    new := jsonb_populate_record(new, v_new);
  else
    new := jsonb_populate_record(new, v_new);
  end if;
  return new;
end;
$$;
revoke all on function public.production_card_materialization_guard() from public, anon, authenticated, service_role;
create trigger zy_production_card_materialization_guard before update on public.calendar_posts
  for each row execute function public.production_card_materialization_guard();
create trigger zy_production_card_materialization_guard before update on public.sample_reviews
  for each row execute function public.production_card_materialization_guard();

-- STAGE 1. Recover missing expected NATIVE children from the immutable manifest.
--
-- Provenance for the reconstructed event comes only from durable facts: the
-- manifest (ids, content, receipt keys, fingerprints, epochs, actor key/role/auth
-- kind, surface, source time), the parent receipt row (actor display name,
-- test_only, outbox id the gateway makes every child depend on) and same-team
-- receipts of this batch or the reviewed client mapping (project/team ids).
-- Anything missing is an unresolved reason, not a guess. The write itself is the
-- unchanged production_deliverable_write: authority, replay lock, F27 fence and
-- hold triggers, and the native receipt guard all execute exactly as they do for
-- the gateway. All missing children of one request recover in one transaction.
create or replace function public.production_intake_reconcile_children(
  p_request_id text, p_actor text, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m public.production_intake_manifests;
  v_batch public.batches;
  v_client public.clients;
  v_state jsonb;
  v_child jsonb;
  v_item jsonb;
  v_row jsonb;
  v_parent public.mirror_outbox;
  v_generation bigint;
  v_project text;
  v_team_id text;
  v_payload jsonb;
  v_event jsonb;
  v_plan jsonb := '[]';
  v_complete jsonb := '[]';
  v_unresolved jsonb := '[]';
  v_conflicts jsonb := '[]';
  v_recovered jsonb := '[]';
  v_outcome text;
  v_reason text;
  v_d public.deliverables;
  v_receipt public.mirror_outbox;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then raise exception 'reconcile_actor_required'; end if;
  select * into v_m from public.production_intake_manifests where request_id = p_request_id;
  if not found then raise exception 'intake_manifest_missing'; end if;
  -- Same lock the root wrapper takes: an explicit gateway retry and this
  -- reconciler serialize on the request, and two reconcilers on the same request
  -- see each other's committed work.
  perform pg_advisory_xact_lock(hashtextextended('root-intake-manifest:' || p_request_id, 0));
  v_state := public.production_intake_reconcile_state(p_request_id);
  select * into v_batch from public.batches where id = v_m.batch_id for share;
  select * into v_client from public.clients where slug = v_m.client_slug;
  select * into v_parent from public.mirror_outbox where dedup_key = v_m.parent_receipt->>'dedup_key';

  for v_child in select value from jsonb_array_elements(v_state->'children') loop
    if (v_child->>'present')::boolean then
      if not (v_child->>'identity_ok')::boolean then
        v_conflicts := v_conflicts || jsonb_build_object('id', v_child->>'id',
          'reason', 'child_identity_conflict', 'owner', 'operator');
      else
        v_complete := v_complete || (v_child->'id');
      end if;
      continue;
    end if;
    if v_child->>'epoch' = '' then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id',
        'reason', 'provider_epoch_child_missing', 'owner', 'gateway-retry');
    elsif v_child->>'receipt_status' is not null then
      v_conflicts := v_conflicts || jsonb_build_object('id', v_child->>'id',
        'reason', 'child_receipt_without_row', 'owner', 'operator');
    elsif v_batch.id is null then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id', 'reason', 'batch_missing', 'owner', 'operator');
    elsif v_batch.status is distinct from 'active' then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id', 'reason', 'batch_not_active', 'owner', 'operator');
    elsif v_client.slug is null or v_client.active is distinct from true then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id', 'reason', 'client_inactive', 'owner', 'operator');
    elsif v_parent.id is null then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id', 'reason', 'parent_receipt_missing', 'owner', 'operator');
    elsif v_parent.role is distinct from v_m.actor_role or v_parent.client_slug is distinct from v_m.client_slug then
      v_conflicts := v_conflicts || jsonb_build_object('id', v_child->>'id', 'reason', 'parent_receipt_provenance_mismatch', 'owner', 'operator');
    elsif exists(select 1 from public.track_b_team_rollbacks r where r.team = v_child->>'team' and r.state = 'open') then
      v_unresolved := v_unresolved || jsonb_build_object('id', v_child->>'id', 'reason', 'f27_hold', 'owner', 'reconciler');
    else
      v_plan := v_plan || (v_child->'id');
    end if;
  end loop;

  -- ALL OR NOTHING PER REQUEST, like the gateway's own admission: one
  -- conflicted or unresolved expected child holds every planned child of the
  -- request. A request is recovered completely or left exactly as found.
  if not p_apply or jsonb_array_length(v_plan) = 0
     or jsonb_array_length(v_conflicts) > 0 or jsonb_array_length(v_unresolved) > 0 then
    v_outcome := case when jsonb_array_length(v_conflicts) > 0 then 'conflict'
      when jsonb_array_length(v_unresolved) > 0 then 'unresolved'
      when jsonb_array_length(v_plan) > 0 then 'planned' else 'complete' end;
    -- A dry run leaves no trace. An apply that found nothing safe to write
    -- still records WHY, so a conflict or hold is durable; a clean no-op is not
    -- a decision and records nothing.
    if p_apply and v_outcome in ('conflict', 'unresolved') then
      perform public.production_intake_reconcile_record(v_m, p_actor, 'children', v_outcome,
        jsonb_build_object('recovered', '[]'::jsonb, 'held', v_plan, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved));
    end if;
    return jsonb_build_object('stage', 'children', 'request_id', p_request_id, 'applied', false,
      'outcome', v_outcome,
      'plan', v_plan, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved, 'recovered', '[]'::jsonb);
  end if;

  -- The subtransaction: every planned child or none. A refusal by authority, the
  -- F27 fence/hold triggers, the native receipt guard, a constraint, or the
  -- readback below rolls all of them back and becomes one durable reason.
  begin
    for v_item in select value from jsonb_array_elements(v_m.expected_items)
        where value->'row'->>'id' in (select jsonb_array_elements_text(v_plan))
        order by (value->>'item_index')::int loop
      v_row := v_item->'row';
      select generation into v_generation from public.track_b_f27_team_fences where team = v_row->>'team' for share;
      if v_generation is null then raise exception 'authority_unavailable'; end if;
      select payload->>'project_id', payload->>'team_id' into v_project, v_team_id
        from public.mirror_outbox
        where batch_id = v_m.batch_id and team = v_row->>'team' and payload ? 'project_id'
        order by id limit 1;
      v_project := coalesce(v_project, v_client.linear_project_ids->>(v_row->>'team'));
      if v_project is null then raise exception 'project_mapping_missing'; end if;
      v_payload := jsonb_build_object(
        'project_id', v_project,
        'title', v_row->>'title',
        'status', v_row->>'status',
        'assignee_id', v_row->'assignee_id',
        '_intent_fingerprint', v_item->>'child_fingerprint',
        '_native_intake_epoch', v_m.native_epochs->>(v_row->>'team'),
        '_native_intake_request', v_m.request_id,
        '_f27_authority_generation', v_generation,
        '_f27_legacy_parity', false);
      if v_team_id is not null then v_payload := v_payload || jsonb_build_object('team_id', v_team_id); end if;
      if nullif(v_row->>'brief', '') is not null then v_payload := v_payload || jsonb_build_object('description', v_row->>'brief'); end if;
      if nullif(v_row->>'due_date', '') is not null then v_payload := v_payload || jsonb_build_object('due_date', v_row->>'due_date'); end if;
      if v_row->'priority' is not null and jsonb_typeof(v_row->'priority') <> 'null' then
        v_payload := v_payload || jsonb_build_object('priority', v_row->'priority'); end if;
      v_event := jsonb_build_object(
        'source', 'ui', 'action', 'create',
        'actor', v_parent.actor, 'actor_key', v_m.actor_key, 'role', v_m.actor_role,
        'auth_kind', v_m.auth_kind, 'surface', v_m.surface,
        'ts', public.production_intake_reconcile_iso(v_m.source_edited_at),
        'from_status', null, 'to_status', v_row->>'status',
        'outbound', jsonb_build_object(
          'entity', 'deliverable', 'entity_id', v_row->>'id', 'team', v_row->>'team',
          'operation', 'create', 'dedup_key', v_item->>'child_dedup',
          'source_edited_at', public.production_intake_reconcile_iso(v_m.source_edited_at),
          'test_only', v_parent.test_only, 'legacy_parity', false,
          'depends_on_id', v_parent.id, 'payload', v_payload));
      v_d := public.production_deliverable_write(v_row, v_event);
      -- Readback of the facts, not of the RPC result: identity, card plan, receipt.
      select * into v_d from public.deliverables where id = v_row->>'id';
      select * into v_receipt from public.mirror_outbox where dedup_key = v_item->>'child_dedup';
      if v_d.id is null or v_d.batch_id is distinct from v_m.batch_id or v_d.client_slug is distinct from v_m.client_slug
         or v_d.team is distinct from v_row->>'team' or v_d.card_id is distinct from v_row->>'card_id'
         or v_receipt.id is null or v_receipt.status is distinct from 'skipped'
         or coalesce(v_receipt.payload->>'_intent_fingerprint', '') is distinct from v_item->>'child_fingerprint'
         or coalesce(v_receipt.payload->>'_native_intake_epoch', '') is distinct from (v_m.native_epochs->>(v_row->>'team')) then
        raise exception 'reconcile_readback_mismatch';
      end if;
      v_recovered := v_recovered || (v_row->'id');
    end loop;
    v_outcome := case when jsonb_array_length(v_conflicts) > 0 then 'conflict'
      when jsonb_array_length(v_unresolved) > 0 then 'unresolved' else 'recovered' end;
  exception when others then
    v_reason := public.production_intake_reconcile_reason(sqlerrm, sqlstate);
    v_recovered := '[]';
    v_outcome := 'unresolved';
    v_unresolved := v_unresolved || jsonb_build_object('ids', v_plan, 'reason', v_reason,
      'owner', case when v_reason in ('team_rollback_hold', 'f27_authority_generation_stale', 'authority_unavailable') then 'reconciler' else 'operator' end);
  end;

  perform public.production_intake_reconcile_record(v_m, p_actor, 'children', v_outcome,
    jsonb_build_object('recovered', v_recovered, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved));
  return jsonb_build_object('stage', 'children', 'request_id', p_request_id, 'applied', true,
    'outcome', v_outcome, 'plan', v_plan, 'complete', v_complete, 'conflicts', v_conflicts,
    'unresolved', v_unresolved, 'recovered', v_recovered);
end;
$$;
revoke all on function public.production_intake_reconcile_children(text, text, boolean) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_children(text, text, boolean) to service_role;

-- STAGE 2. Materialize the card binding once the native result is complete.
--
-- The obligation is derived from the manifest: one card per expected card id,
-- on the surface the BATCH names (purpose 'samples' -> sample_reviews, otherwise
-- calendar_posts), with a slot per expected team. A missing card is created with
-- exactly the row the browser's materialization sends through calendar-upsert /
-- sample-review-upsert today (stripPrivate/buildIncoming shape: text columns,
-- empty strings, null deliverable slots, ISO updated_at, 'create' event). An
-- existing card only ever gains an EMPTY slot; every other field stays as the
-- humans left it. The frozen anonymous writers are not called and not changed.
create or replace function public.production_intake_reconcile_cards(
  p_request_id text, p_actor text, p_apply boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_m public.production_intake_manifests;
  v_batch public.batches;
  v_parent public.mirror_outbox;
  v_state jsonb;
  v_card jsonb;
  v_slot record;
  v_plan jsonb := '[]';
  v_complete jsonb := '[]';
  v_unresolved jsonb := '[]';
  v_conflicts jsonb := '[]';
  v_created jsonb := '[]';
  v_bound jsonb := '[]';
  v_outcome text;
  v_reason text;
  v_action text;
  v_binds jsonb;
  v_d public.deliverables;
  v_now text;
  v_order numeric;
  v_name text;
  v_video_id text;
  v_graphic_id text;
  v_video_link text;
  v_graphic_link text;
  v_found boolean;
  v_status text;
  v_cur_video text;
  v_cur_graphic text;
  v_ok boolean;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then raise exception 'reconcile_actor_required'; end if;
  select * into v_m from public.production_intake_manifests where request_id = p_request_id;
  if not found then raise exception 'intake_manifest_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('root-intake-manifest:' || p_request_id, 0));
  v_state := public.production_intake_reconcile_state(p_request_id);
  select * into v_batch from public.batches where id = v_m.batch_id for share;
  select * into v_parent from public.mirror_outbox where dedup_key = v_m.parent_receipt->>'dedup_key';

  for v_card in select value from jsonb_array_elements(v_state->'cards') loop
    if (v_card->>'complete')::boolean then
      v_complete := v_complete || (v_card->'card_id');
      continue;
    end if;
    -- Every expected child of this card must exist with its identity and still
    -- carry THIS card. A cleared or moved card_id is a human decision.
    v_action := null;
    for v_slot in select value as child from jsonb_array_elements(v_state->'children')
        where value->>'expected_card_id' = v_card->>'card_id' loop
      if not (v_slot.child->>'present')::boolean or not (v_slot.child->>'identity_ok')::boolean then
        v_action := coalesce(v_action, 'children_incomplete');
      elsif v_slot.child->>'current_card_id' is null then
        v_action := coalesce(v_action, 'deliverable_card_cleared');
      elsif v_slot.child->>'current_card_id' is distinct from v_card->>'card_id' then
        v_action := coalesce(v_action, 'deliverable_rebound');
      end if;
    end loop;
    if v_action is not null then
      v_unresolved := v_unresolved || jsonb_build_object('card_id', v_card->>'card_id', 'reason', v_action,
        'owner', case when v_action = 'children_incomplete' then 'reconciler' else 'operator' end);
      continue;
    end if;
    if v_batch.id is null or v_batch.status is distinct from 'active' then
      v_unresolved := v_unresolved || jsonb_build_object('card_id', v_card->>'card_id', 'reason', 'batch_not_active', 'owner', 'operator');
      continue;
    end if;
    if (v_card->>'present')::boolean then
      if lower(btrim(coalesce(v_card->>'status', ''))) = 'archived' then
        v_unresolved := v_unresolved || jsonb_build_object('card_id', v_card->>'card_id', 'reason', 'card_archived', 'owner', 'operator');
        continue;
      end if;
      -- Each slot: empty -> bind; equal -> fine; anything else -> conflict.
      v_ok := true;
      for v_slot in select key as team, value as slot from jsonb_each(v_card->'slots') loop
        if nullif(btrim(coalesce(v_slot.slot->>'current', '')), '') is not null
           and v_slot.slot->>'current' is distinct from v_slot.slot->>'expected' then
          v_ok := false;
        end if;
      end loop;
      if not v_ok then
        v_conflicts := v_conflicts || jsonb_build_object('card_id', v_card->>'card_id', 'reason', 'card_slot_occupied', 'owner', 'operator');
        continue;
      end if;
      v_plan := v_plan || jsonb_build_object('card_id', v_card->>'card_id', 'action', 'bind');
    else
      -- NEVER CREATED must be PROVED, not inferred from an absent best-effort
      -- event. Proof is: provenance recording was installed before this request
      -- was accepted, and no created/deleted provenance row exists for the card.
      -- An event row is an additional deletion signal, never a permission.
      if (v_card->>'events_seen')::boolean or (v_card->'provenance'->>'created') is not null
         or (v_card->'provenance'->>'deleted') is not null then
        v_unresolved := v_unresolved || jsonb_build_object('card_id', v_card->>'card_id', 'reason', 'card_deleted_after_creation', 'owner', 'operator');
        continue;
      end if;
      if not coalesce((v_card->>'provenance_recorded_since_acceptance')::boolean, false) then
        v_unresolved := v_unresolved || jsonb_build_object('card_id', v_card->>'card_id', 'reason', 'card_provenance_unavailable', 'owner', 'operator');
        continue;
      end if;
      v_plan := v_plan || jsonb_build_object('card_id', v_card->>'card_id', 'action', 'create');
    end if;
  end loop;

  if not p_apply or jsonb_array_length(v_plan) = 0 then
    v_outcome := case when jsonb_array_length(v_conflicts) > 0 then 'conflict'
      when jsonb_array_length(v_unresolved) > 0 then 'unresolved'
      when jsonb_array_length(v_plan) > 0 then 'planned' else 'complete' end;
    if p_apply and v_outcome in ('conflict', 'unresolved') then
      perform public.production_intake_reconcile_record(v_m, p_actor, 'cards', v_outcome,
        jsonb_build_object('created', '[]'::jsonb, 'bound', '[]'::jsonb, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved));
    end if;
    return jsonb_build_object('stage', 'cards', 'request_id', p_request_id, 'applied', false,
      'outcome', v_outcome,
      'plan', v_plan, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved,
      'created', '[]'::jsonb, 'bound', '[]'::jsonb);
  end if;

  begin
    v_now := public.production_intake_reconcile_iso(clock_timestamp());
    for v_card in select c.value from jsonb_array_elements(v_state->'cards') c
        where c.value->>'card_id' in (select value->>'card_id' from jsonb_array_elements(v_plan))
        order by (c.value->>'number')::int loop
      v_video_id := null; v_graphic_id := null; v_video_link := null; v_graphic_link := null; v_name := null;
      for v_d in select d.* from public.deliverables d
          where d.id in (select jsonb_array_elements_text(v_card->'item_ids')) for update loop
        if v_d.team = 'graphics' then v_graphic_id := v_d.id; v_graphic_link := v_d.linear_issue_url;
        else v_video_id := v_d.id; v_video_link := v_d.linear_issue_url; end if;
      end loop;
      -- The browser names the card after the video title, then the graphic title,
      -- then 'Video N'. Same order here.
      select coalesce(nullif(btrim((select title from public.deliverables where id = v_video_id)), ''),
                      nullif(btrim((select title from public.deliverables where id = v_graphic_id)), ''),
                      'Video ' || (v_card->>'number')) into v_name;
      if v_card->>'surface' = 'samples' then
        select true, s.status, s.video_deliverable_id, s.graphic_deliverable_id
          into v_found, v_status, v_cur_video, v_cur_graphic
          from public.sample_reviews s where s.client = v_m.client_slug and s.id = v_card->>'card_id' for update;
      else
        select true, c.status, c.video_deliverable_id, c.graphic_deliverable_id
          into v_found, v_status, v_cur_video, v_cur_graphic
          from public.calendar_posts c where c.client = v_m.client_slug and c.id = v_card->>'card_id' for update;
      end if;
      v_found := coalesce(v_found, false);
      if v_found then
        -- Re-check under the lock; the plan was computed before it.
        if lower(btrim(coalesce(v_status, ''))) = 'archived' then raise exception 'card_archived'; end if;
        if (v_video_id is not null and nullif(btrim(coalesce(v_cur_video, '')), '') is not null and v_cur_video is distinct from v_video_id)
           or (v_graphic_id is not null and nullif(btrim(coalesce(v_cur_graphic, '')), '') is not null and v_cur_graphic is distinct from v_graphic_id) then
          raise exception 'card_slot_occupied';
        end if;
        if v_card->>'surface' = 'samples' then
          update public.sample_reviews s set
            video_deliverable_id = case when v_video_id is not null then v_video_id else s.video_deliverable_id end,
            graphic_deliverable_id = case when v_graphic_id is not null then v_graphic_id else s.graphic_deliverable_id end,
            updated_at = v_now
          where s.client = v_m.client_slug and s.id = v_card->>'card_id';
        else
          update public.calendar_posts c set
            video_deliverable_id = case when v_video_id is not null then v_video_id else c.video_deliverable_id end,
            graphic_deliverable_id = case when v_graphic_id is not null then v_graphic_id else c.graphic_deliverable_id end,
            updated_at = v_now
          where c.client = v_m.client_slug and c.id = v_card->>'card_id';
        end if;
        v_bound := v_bound || (v_card->'card_id');
      else
        if exists(select 1 from public.production_card_provenance p where p.surface = v_card->>'surface'
            and p.client = v_m.client_slug and p.card_id = v_card->>'card_id' and p.kind in ('created', 'deleted')) then
          raise exception 'card_deleted_after_creation'; end if;
        perform set_config('app.card_materialization_source', 'native-intake-reconcile:' || p_actor, true);
        if v_card->>'surface' = 'samples' then
          if exists(select 1 from public.sample_review_events e where e.client = v_m.client_slug and e.sample_id = v_card->>'card_id') then
            raise exception 'card_deleted_after_creation'; end if;
          select coalesce(max(nullif(order_index, '')::numeric), floor(extract(epoch from clock_timestamp()))) + (v_card->>'number')::int
            into v_order from public.sample_reviews where client = v_m.client_slug and order_index ~ '^-?[0-9]+(\.[0-9]+)?$';
          -- Duplicate-link guard of the writer: a Linear link already held by a
          -- live card of this client is not copied onto a second card.
          if v_video_link is not null and exists(select 1 from public.sample_reviews t where t.client = v_m.client_slug
              and lower(coalesce(t.status, '')) <> 'archived' and t.linear_issue_id = v_video_link) then v_video_link := null; end if;
          if v_graphic_link is not null and exists(select 1 from public.sample_reviews t where t.client = v_m.client_slug
              and lower(coalesce(t.status, '')) <> 'archived' and t.graphic_linear_issue_id = v_graphic_link) then v_graphic_link := null; end if;
          insert into public.sample_reviews(client, id, updated_at, order_index, name, creative_direction, hide_creative_direction,
            status, video_status, graphic_status, asset_url, thumbnail_url,
            linear_issue_id, video_deliverable_id, graphic_linear_issue_id, graphic_deliverable_id)
          values (v_m.client_slug, v_card->>'card_id', v_now, v_order::text, v_name, '', '',
            'In Progress', 'In Progress', 'In Progress', '', '',
            coalesce(v_video_link, ''), v_video_id, coalesce(v_graphic_link, ''), v_graphic_id);
          insert into public.sample_review_events(client, sample_id, ts, actor, role, action, component, from_status, to_status, source, payload)
          values (v_m.client_slug, v_card->>'card_id', clock_timestamp(), v_parent.actor, v_m.actor_role, 'create', null, '', 'In Progress',
            'native-intake-reconcile', jsonb_build_object('request_id', v_m.request_id, 'reconciled_by', p_actor));
        else
          if exists(select 1 from public.calendar_post_events e where e.client = v_m.client_slug and e.post_id = v_card->>'card_id') then
            raise exception 'card_deleted_after_creation'; end if;
          select coalesce(max(nullif(order_index, '')::numeric), floor(extract(epoch from clock_timestamp()))) + (v_card->>'number')::int
            into v_order from public.calendar_posts where client = v_m.client_slug and order_index ~ '^-?[0-9]+(\.[0-9]+)?$';
          if v_video_link is not null and exists(select 1 from public.calendar_posts t where t.client = v_m.client_slug
              and lower(coalesce(t.status, '')) <> 'archived' and t.linear_issue_id = v_video_link) then v_video_link := null; end if;
          insert into public.calendar_posts(client, id, updated_at, order_index, name, scheduled_date, status,
            video_status, graphic_status, caption_status, asset_url, thumbnail_url, caption, cta,
            tweaks, video_tweaks, graphic_tweaks, caption_tweaks,
            linear_issue_id, video_deliverable_id, graphic_linear_issue_id, graphic_deliverable_id)
          values (v_m.client_slug, v_card->>'card_id', v_now, v_order::text, v_name, '', 'In Progress',
            'In Progress', 'In Progress', 'In Progress', '', '', '', '',
            '', '', '', '',
            coalesce(v_video_link, ''), v_video_id, coalesce(v_graphic_link, ''), v_graphic_id);
          insert into public.calendar_post_events(client, post_id, ts, actor, role, action, component, from_status, to_status, source, payload)
          values (v_m.client_slug, v_card->>'card_id', clock_timestamp(), v_parent.actor, v_m.actor_role, 'create', null, '', 'In Progress',
            'native-intake-reconcile', jsonb_build_object('request_id', v_m.request_id, 'reconciled_by', p_actor));
        end if;
        v_created := v_created || (v_card->'card_id');
      end if;
      -- Readback of the fact: both directions of the binding agree.
      if v_card->>'surface' = 'samples' then
        select s.video_deliverable_id, s.graphic_deliverable_id into v_cur_video, v_cur_graphic
          from public.sample_reviews s where s.client = v_m.client_slug and s.id = v_card->>'card_id';
      else
        select c.video_deliverable_id, c.graphic_deliverable_id into v_cur_video, v_cur_graphic
          from public.calendar_posts c where c.client = v_m.client_slug and c.id = v_card->>'card_id';
      end if;
      if (v_video_id is not null and v_cur_video is distinct from v_video_id)
         or (v_graphic_id is not null and v_cur_graphic is distinct from v_graphic_id)
         or exists(select 1 from public.deliverables d where d.id in (select jsonb_array_elements_text(v_card->'item_ids'))
                   and d.card_id is distinct from v_card->>'card_id') then
        raise exception 'reconcile_readback_mismatch';
      end if;
      v_found := null; v_status := null; v_cur_video := null; v_cur_graphic := null;
    end loop;
    v_outcome := case when jsonb_array_length(v_conflicts) > 0 then 'conflict'
      when jsonb_array_length(v_unresolved) > 0 then 'unresolved' else 'materialized' end;
  exception when others then
    v_reason := public.production_intake_reconcile_reason(sqlerrm, sqlstate);
    v_created := '[]'; v_bound := '[]';
    v_outcome := 'unresolved';
    v_unresolved := v_unresolved || jsonb_build_object('card_ids', (select coalesce(jsonb_agg(value->'card_id'), '[]') from jsonb_array_elements(v_plan)),
      'reason', v_reason, 'owner', 'operator');
  end;

  perform public.production_intake_reconcile_record(v_m, p_actor, 'cards', v_outcome,
    jsonb_build_object('created', v_created, 'bound', v_bound, 'complete', v_complete, 'conflicts', v_conflicts, 'unresolved', v_unresolved));
  return jsonb_build_object('stage', 'cards', 'request_id', p_request_id, 'applied', true,
    'outcome', v_outcome, 'plan', v_plan, 'complete', v_complete, 'conflicts', v_conflicts,
    'unresolved', v_unresolved, 'created', v_created, 'bound', v_bound);
end;
$$;
revoke all on function public.production_intake_reconcile_cards(text, text, boolean) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_cards(text, text, boolean) to service_role;

-- Read-only keyset page of requests with any unmet obligation. A page that is
-- cut short by p_limit reports the last request examined as the cursor, so a
-- caller resuming from it never skips or repeats a request; a request completed
-- between pages simply stops appearing. Requests without a manifest never appear.
create or replace function public.production_intake_reconcile_backlog(p_limit int default 50, p_after text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_state jsonb;
  v_items jsonb := '[]';
  v_last text := p_after;
  v_exhausted boolean := true;
  v_examined int := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then raise exception 'invalid_backlog_limit'; end if;
  for v_id in select request_id from public.production_intake_manifests
      where p_after is null or request_id > p_after order by request_id loop
    if jsonb_array_length(v_items) >= p_limit then v_exhausted := false; exit; end if;
    v_state := public.production_intake_reconcile_state(v_id);
    v_last := v_id;
    v_examined := v_examined + 1;
    if not (v_state->>'complete')::boolean then
      v_items := v_items || (v_state - 'children' - 'cards' || jsonb_build_object(
        'children_missing', (select coalesce(jsonb_agg(c->'id'), '[]') from jsonb_array_elements(v_state->'children') c where not (c->>'present')::boolean),
        'cards_incomplete', (select coalesce(jsonb_agg(c->'card_id'), '[]') from jsonb_array_elements(v_state->'cards') c where not (c->>'complete')::boolean)));
    end if;
  end loop;
  return jsonb_build_object('items', v_items, 'next_after', v_last, 'exhausted', v_exhausted, 'examined', v_examined);
end;
$$;
revoke all on function public.production_intake_reconcile_backlog(int, text) from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_backlog(int, text) to service_role;

-- Read-only aggregate for the operator report and any future alert: per-stage
-- owed/complete/conflicted counts, backlog age, missing terminal receipts, and
-- the latest recorded outcome per request. Counts are facts; outcomes are the
-- reason ledger. Neither is a completion signal on its own.
create or replace function public.production_intake_reconcile_summary()
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id text;
  v_state jsonb;
  v_manifests int := 0;
  v_complete int := 0;
  v_owed_children_native int := 0;
  v_owed_children_provider int := 0;
  v_owed_cards int := 0;
  v_conflicts int := 0;
  v_missing_terminal int := 0;
  v_requests_owed int := 0;
  v_oldest timestamptz;
  v_outcomes jsonb;
begin
  for v_id in select request_id from public.production_intake_manifests order by request_id loop
    v_manifests := v_manifests + 1;
    v_state := public.production_intake_reconcile_state(v_id);
    if (v_state->>'complete')::boolean then
      v_complete := v_complete + 1;
    else
      v_requests_owed := v_requests_owed + 1;
      v_oldest := least(v_oldest, (v_state->>'recorded_at')::timestamptz);
      if v_oldest is null then v_oldest := (v_state->>'recorded_at')::timestamptz; end if;
    end if;
    v_owed_children_native := v_owed_children_native + (v_state->'owed'->>'children_native')::int;
    v_owed_children_provider := v_owed_children_provider + (v_state->'owed'->>'children_provider')::int;
    v_owed_cards := v_owed_cards + (v_state->'owed'->>'cards')::int;
    v_conflicts := v_conflicts + (v_state->'owed'->>'identity_conflicts')::int;
    v_missing_terminal := v_missing_terminal + (v_state->'owed'->>'missing_terminal_receipts')::int;
  end loop;
  select coalesce(jsonb_object_agg(outcome, n), '{}') into v_outcomes from (
    select payload->>'stage' || ':' || (payload->>'outcome') as outcome, count(*) as n
    from (select distinct on (payload->>'request_id', payload->>'stage') payload
          from public.deliverable_events
          where action = 'native_intake_reconcile' and source = 'reconcile'
          order by payload->>'request_id', payload->>'stage', ts desc, id desc) latest
    group by 1) t;
  return jsonb_build_object(
    'manifests', v_manifests, 'requests_complete', v_complete, 'requests_owed', v_requests_owed,
    'owed', jsonb_build_object('children_native', v_owed_children_native, 'children_provider', v_owed_children_provider,
      'cards', v_owed_cards, 'identity_conflicts', v_conflicts, 'missing_terminal_receipts', v_missing_terminal),
    'backlog_oldest_recorded_at', v_oldest,
    'backlog_age_seconds', case when v_oldest is null then 0 else floor(extract(epoch from (clock_timestamp() - v_oldest))) end,
    'latest_outcomes', v_outcomes, 'observed_at', clock_timestamp());
end;
$$;
revoke all on function public.production_intake_reconcile_summary() from public, anon, authenticated;
grant execute on function public.production_intake_reconcile_summary() to service_role;

commit;
