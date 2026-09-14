-- Draft/unapplied. Root intake only; existing parent/child receipts stay authoritative.
-- Rollback retains this table and RPC. Never drop accepted/inflight request evidence.
begin;

create table public.production_intake_manifests (
  request_id text primary key,
  batch_id text not null unique references public.batches(id) on delete restrict
    deferrable initially deferred,
  client_slug text not null,
  actor_key text not null,
  actor_role text not null,
  auth_kind text not null,
  surface text not null,
  source_edited_at timestamptz not null,
  request_intent jsonb not null check (jsonb_typeof(request_intent) = 'object'),
  batch_snapshot jsonb not null check (jsonb_typeof(batch_snapshot) = 'object'),
  expected_items jsonb not null check (jsonb_typeof(expected_items) = 'array'
    and jsonb_array_length(expected_items) between 1 and 100),
  parent_receipt jsonb not null check (jsonb_typeof(parent_receipt) = 'object'),
  recorded_at timestamptz not null default now()
);
alter table public.production_intake_manifests enable row level security;
revoke all on public.production_intake_manifests from public, anon, authenticated, service_role;
grant select on public.production_intake_manifests to service_role;
comment on table public.production_intake_manifests is
  'Private immutable root request intent, including confidential briefs and asset links. No browser/public report exposure or automatic reconstruction. Retain on rollback.';

create function public.production_intake_root_begin(p_row jsonb, p_event jsonb, p_manifest jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_request text := nullif(p_manifest->>'request_id', '');
  v_out jsonb := p_event->'outbound';
  v_existing public.production_intake_manifests;
  v_item jsonb;
  v_ordinal bigint;
  v_receipt jsonb;
  v_result public.batches;
begin
  -- Service-only caller is the already-authenticated gateway. Keep the existing
  -- database authority check BEFORE creating or consulting confidential evidence.
  perform public.production_assert_authority(p_row->>'client_slug', v_out->>'team',
    coalesce((v_out->>'test_only')::boolean, false),
    coalesce((v_out->>'legacy_parity')::boolean, false));
  if v_request is null or length(v_request) > 200
    or nullif(p_row->>'id', '') is null
    or nullif(p_event->>'actor_key', '') is null
    or nullif(p_event->>'role', '') is null
    or nullif(p_event->>'auth_kind', '') is null
    or p_event->>'action' is distinct from 'create'
    or v_out->>'entity' is distinct from 'batch'
    or v_out->>'operation' is distinct from 'create'
    or v_out->>'entity_id' is distinct from p_row->>'id'
    or v_out->>'dedup_key' is distinct from
      'write-ui:create:batch:' || (p_row->>'id') || ':' || v_request || ':' || (v_out->>'team')
    or nullif(v_out->'payload'->>'_intent_fingerprint', '') is null
    or jsonb_typeof(p_manifest->'request_intent') is distinct from 'object'
    or jsonb_typeof(p_manifest->'expected_items') is distinct from 'array'
  then raise exception 'invalid_intake_manifest'; end if;
  if jsonb_array_length(p_manifest->'expected_items') not between 1 and 100 then
    raise exception 'invalid_intake_manifest';
  end if;
  for v_item, v_ordinal in select value, ordinality
      from jsonb_array_elements(p_manifest->'expected_items') with ordinality loop
    if (v_item->>'item_index')::bigint is distinct from v_ordinal - 1
      or nullif(v_item->'row'->>'id', '') is null
      or v_item->'row'->>'batch_id' is distinct from p_row->>'id'
      or v_item->'row'->>'client_slug' is distinct from p_row->>'client_slug'
      or coalesce(v_item->'row'->>'team', '') not in ('video', 'graphics')
      or v_item->>'child_dedup' is distinct from
        'write-ui:create:deliverable:' || (v_item->'row'->>'id') || ':' || v_request
      or nullif(v_item->>'child_fingerprint', '') is null
    then raise exception 'invalid_intake_manifest'; end if;
  end loop;
  if (select count(distinct value->'row'->>'id')
      from jsonb_array_elements(p_manifest->'expected_items')) <> jsonb_array_length(p_manifest->'expected_items')
  then raise exception 'invalid_intake_manifest'; end if;

  v_receipt := jsonb_build_object('dedup_key', v_out->>'dedup_key',
    'intent_fingerprint', v_out->'payload'->>'_intent_fingerprint',
    'team', v_out->>'team', 'test_only', coalesce((v_out->>'test_only')::boolean, false),
    'legacy_parity', coalesce((v_out->>'legacy_parity')::boolean, false));
  perform pg_advisory_xact_lock(hashtextextended('root-intake-manifest:' || v_request, 0));
  select * into v_existing from public.production_intake_manifests where request_id = v_request;
  if found then
    -- First accepted plan stays immutable, including generated content and
    -- attribution. Compare caller intent and unchanged receipt semantics. Brief
    -- enrichment and attribution may regenerate without changing caller intent;
    -- return the FIRST accepted rows so the explicit retry uses that content.
    if v_existing.batch_id is distinct from p_row->>'id'
      or v_existing.client_slug is distinct from p_row->>'client_slug'
      or v_existing.actor_key is distinct from p_event->>'actor_key'
      or v_existing.actor_role is distinct from p_event->>'role'
      or v_existing.auth_kind is distinct from p_event->>'auth_kind'
      or v_existing.surface is distinct from p_event->>'surface'
      or (coalesce((p_manifest->'request_intent'->>'source_timestamp_supplied')::boolean, false)
        and v_existing.source_edited_at is distinct from (p_event->>'ts')::timestamptz)
      or v_existing.request_intent is distinct from p_manifest->'request_intent'
      or v_existing.parent_receipt is distinct from v_receipt
      or (select jsonb_agg(jsonb_set(value, '{row}', (value->'row') - 'linear_raw' - 'brief' - 'created_at' - 'status_at') order by ordinality)
          from jsonb_array_elements(v_existing.expected_items) with ordinality)
        is distinct from
        (select jsonb_agg(jsonb_set(value, '{row}', (value->'row') - 'linear_raw' - 'brief' - 'created_at' - 'status_at') order by ordinality)
          from jsonb_array_elements(p_manifest->'expected_items') with ordinality)
    then raise exception 'idempotency_conflict'; end if;
  else
    insert into public.production_intake_manifests(request_id, batch_id, client_slug,
      actor_key, actor_role, auth_kind, surface, source_edited_at,
      request_intent, batch_snapshot, expected_items, parent_receipt)
    values(v_request, p_row->>'id', p_row->>'client_slug', p_event->>'actor_key',
      p_event->>'role', p_event->>'auth_kind', p_event->>'surface', (p_event->>'ts')::timestamptz,
      p_manifest->'request_intent', p_row, p_manifest->'expected_items', v_receipt)
    returning * into v_existing;
  end if;
  -- The deferred FK, manifest and original parent receipt commit together.
  -- Any authority, receipt, writer or trigger failure rolls the entire call back.
  v_result := public.production_batch_write(p_row, p_event);
  return jsonb_build_object('batch', to_jsonb(v_result), 'expected_items', v_existing.expected_items,
    'source_edited_at', v_existing.source_edited_at);
end;
$$;
revoke all on function public.production_intake_root_begin(jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.production_intake_root_begin(jsonb,jsonb,jsonb) to service_role;
commit;
