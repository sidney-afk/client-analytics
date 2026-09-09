-- Native-client provisioning prerequisite.
--
-- This is intentionally DORMANT.  It creates no client and changes no runtime
-- flag when applied.  A service-only caller must deliberately invoke
-- production_native_client_provision() after the native intake epochs and both
-- SyncView authorities are already enabled.  The RPC creates one NEW client,
-- its two opaque native project identities, its review-token row, and all four
-- routing-list entries in one transaction.  It never exposes the display name
-- or review token.
--
-- Prerequisites, in this order: B0 clients/client_access; client-access
-- auto-provisioning; native root + native-only intake (for
-- production_native_intake_epochs); and the four runtime-flag migrations.

begin;

create extension if not exists pgcrypto;

alter table public.clients
  add column if not exists native_project_ids jsonb not null default '{}'::jsonb;

alter table public.clients
  drop constraint if exists clients_native_project_ids_object;
alter table public.clients
  add constraint clients_native_project_ids_object
  check (
    native_project_ids = '{}'::jsonb
    or (
      jsonb_typeof(native_project_ids) = 'object'
      and native_project_ids ? 'video'
      and native_project_ids ? 'graphics'
      and (native_project_ids - 'video' - 'graphics') = '{}'::jsonb
      and jsonb_typeof(native_project_ids->'video') = 'string'
      and jsonb_typeof(native_project_ids->'graphics') = 'string'
      and native_project_ids->>'video' ~ '^svproj_video_[0-9a-f]{32}$'
      and native_project_ids->>'graphics' ~ '^svproj_graphics_[0-9a-f]{32}$'
      and native_project_ids->>'video' <> native_project_ids->>'graphics'
    )
  );

create unique index if not exists clients_native_project_ids_video_unique
  on public.clients ((native_project_ids->>'video'))
  where native_project_ids ? 'video';
create unique index if not exists clients_native_project_ids_graphics_unique
  on public.clients ((native_project_ids->>'graphics'))
  where native_project_ids ? 'graphics';

create table if not exists public.production_native_client_provisions (
  request_id text primary key,
  client_slug text not null unique references public.clients(slug) on delete restrict,
  intent_sha256 text not null check (intent_sha256 ~ '^[0-9a-f]{64}$'),
  native_project_ids jsonb not null check (jsonb_typeof(native_project_ids) = 'object'),
  created_at timestamptz not null default now()
);

alter table public.production_native_client_provisions enable row level security;
revoke all on table public.production_native_client_provisions from public, anon, authenticated, service_role;

create or replace function public.production_native_client_provisions_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception 'native_client_provision_receipt_immutable';
end;
$$;

revoke all on function public.production_native_client_provisions_immutable() from public, anon, authenticated, service_role;

drop trigger if exists production_native_client_provisions_immutable_row
  on public.production_native_client_provisions;
create trigger production_native_client_provisions_immutable_row
  before update or delete on public.production_native_client_provisions
  for each row execute function public.production_native_client_provisions_immutable();

drop trigger if exists production_native_client_provisions_immutable_truncate
  on public.production_native_client_provisions;
create trigger production_native_client_provisions_immutable_truncate
  before truncate on public.production_native_client_provisions
  for each statement execute function public.production_native_client_provisions_immutable();

create or replace function public.production_native_client_provision(
  p_request_id text,
  p_client_slug text,
  p_display_name text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions, pg_temp
as $fn$
declare
  v_request_id text := btrim(coalesce(p_request_id, ''));
  v_slug text := lower(btrim(coalesce(p_client_slug, '')));
  v_display_name text := btrim(coalesce(p_display_name, ''));
  v_intent_sha256 text;
  v_existing public.production_native_client_provisions;
  v_client public.clients;
  v_epochs jsonb;
  v_flags jsonb := '{}'::jsonb;
  v_authority jsonb;
  v_project_ids jsonb;
  v_flag record;
  v_flag_count integer;
  v_route_key text;
  v_token text;
  v_route_value jsonb;
  v_route_keys text[] := array[
    'calendar_upsert_ef_clients',
    'sample_review_ef_clients',
    'settings_ef_clients',
    'write_ui_reroute_clients'
  ];
  v_lock_keys text[] := array[
    'calendar_upsert_ef_clients',
    'native_intake_epochs',
    'prod_authority',
    'sample_review_ef_clients',
    'settings_ef_clients',
    'write_ui_reroute_clients'
  ];
begin
  -- A canonical slug is deliberately narrower than the roster's historical
  -- free-form slugs.  Provisioning is only for a new native client.
  if v_request_id = '' or length(v_request_id) > 160
     or v_request_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$' then
    raise exception 'native_client_provision_request_invalid';
  end if;
  if v_slug = '' or length(v_slug) > 100
     or v_slug !~ '^[a-z0-9][a-z0-9_&-]{0,99}$' then
    raise exception 'native_client_provision_slug_invalid';
  end if;
  if v_display_name = '' or length(v_display_name) > 160
     or v_display_name ~ '[\n\r\t]' then
    raise exception 'native_client_provision_display_name_invalid';
  end if;

  -- Same request and slug have a stable lock order.  Different request ids for
  -- the same slug serialize on the second lock, and no path reacquires either.
  perform pg_advisory_xact_lock(hashtextextended('native-client-provision-request:' || v_request_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('native-client-provision-slug:' || v_slug, 0));

  v_intent_sha256 := encode(digest(convert_to(
    jsonb_build_object('client_slug', v_slug, 'display_name', v_display_name)::text,
    'UTF8'
  ), 'sha256'), 'hex');

  -- Lock the complete capability/routing snapshot in lexical key order before
  -- deciding whether this is a replay or a new provision.  This is also the
  -- only flag mutation in this migration.
  for v_flag in
    select key, value
    from public.syncview_runtime_flags
    where key = any(v_lock_keys)
    order by key
    for update
  loop
    v_flags := v_flags || jsonb_build_object(v_flag.key, v_flag.value);
  end loop;
  select count(*) into v_flag_count from jsonb_object_keys(v_flags);
  if v_flag_count <> cardinality(v_lock_keys) then
    raise exception 'native_client_provision_runtime_flag_missing';
  end if;

  v_authority := v_flags->'prod_authority';
  if jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>'video', '')) <> 'syncview'
     or lower(coalesce(v_authority->>'graphics', '')) <> 'syncview' then
    raise exception 'native_client_provision_authority_unavailable';
  end if;
  v_epochs := public.production_native_intake_epochs();
  if jsonb_typeof(v_epochs) is distinct from 'object'
     or coalesce(v_epochs->>'video', '') = ''
     or coalesce(v_epochs->>'graphics', '') = '' then
    raise exception 'native_client_provision_epochs_unavailable';
  end if;

  -- All four writers use the same object-with-clients-array contract.  Reject
  -- malformed or duplicate old entries rather than normalizing a live flag.
  foreach v_route_key in array v_route_keys loop
    v_route_value := v_flags->v_route_key;
    if jsonb_typeof(v_route_value) is distinct from 'object'
       or jsonb_typeof(v_route_value->'clients') is distinct from 'array'
       or exists (
         select 1
         from jsonb_array_elements(v_route_value->'clients') entry
         where jsonb_typeof(entry) is distinct from 'string'
            or entry #>> '{}' !~ '^[a-z0-9][a-z0-9_&-]{0,99}$'
       )
       or (select count(*) from jsonb_array_elements_text(v_route_value->'clients'))
          <> (select count(distinct entry #>> '{}') from jsonb_array_elements(v_route_value->'clients') entry) then
      raise exception 'native_client_provision_routing_flag_invalid';
    end if;
  end loop;

  select * into v_existing
  from public.production_native_client_provisions
  where request_id = v_request_id;

  if found then
    if v_existing.intent_sha256 is distinct from v_intent_sha256 then
      raise exception 'native_client_provision_idempotency_conflict';
    end if;
    select * into v_client from public.clients where slug = v_slug;
    if not found
       or v_client.active is distinct from true
       or v_client.kind is distinct from 'client'
       or v_client.source is distinct from 'syncview_native'
       or v_client.native_project_ids is distinct from v_existing.native_project_ids then
      raise exception 'native_client_provision_state_drift';
    end if;
    select review_token into v_token from public.client_access where slug = v_slug;
    if coalesce(v_token, '') = '' then
      raise exception 'native_client_provision_token_missing';
    end if;
    foreach v_route_key in array v_route_keys loop
      if (select count(*) from jsonb_array_elements_text((v_flags->v_route_key)->'clients') entry where entry = v_slug) <> 1 then
        raise exception 'native_client_provision_routing_drift';
      end if;
    end loop;
    return jsonb_build_object(
      'ok', true,
      'outcome', 'replayed',
      'client_slug', v_slug,
      'native_project_ids', v_existing.native_project_ids,
      'created_at', v_existing.created_at
    );
  end if;

  -- A slug is never adopted, reactivated, or reconfigured.  A caller must
  -- choose a different, explicitly new canonical slug or resolve the drift.
  if exists (select 1 from public.clients where slug = v_slug) then
    raise exception 'native_client_provision_client_exists';
  end if;

  v_project_ids := jsonb_build_object(
    'video', 'svproj_video_' || encode(gen_random_bytes(16), 'hex'),
    'graphics', 'svproj_graphics_' || encode(gen_random_bytes(16), 'hex')
  );
  if v_project_ids->>'video' !~ '^svproj_video_[0-9a-f]{32}$'
     or v_project_ids->>'graphics' !~ '^svproj_graphics_[0-9a-f]{32}$'
     or v_project_ids->>'video' = v_project_ids->>'graphics' then
    raise exception 'native_client_provision_project_id_generation_failed';
  end if;

  insert into public.clients(slug, display_name, active, kind, source, native_project_ids)
  values (v_slug, v_display_name, true, 'client', 'syncview_native', v_project_ids);

  -- The after-insert trigger is the normal mint path.  This INSERT is only a
  -- missing-row fallback and ON CONFLICT deliberately never rotates a token.
  insert into public.client_access(slug, review_token, notes)
  values (v_slug, public.client_access_mint_review_token(), 'Auto-provisioned by native client provisioning')
  on conflict (slug) do nothing;
  select review_token into v_token from public.client_access where slug = v_slug;
  if coalesce(v_token, '') = '' then
    raise exception 'native_client_provision_token_missing';
  end if;

  foreach v_route_key in array v_route_keys loop
    v_route_value := v_flags->v_route_key;
    update public.syncview_runtime_flags
    set value = jsonb_set(v_route_value, '{clients}', (v_route_value->'clients') || jsonb_build_array(v_slug), false)
    where key = v_route_key;
  end loop;

  insert into public.production_native_client_provisions(
    request_id, client_slug, intent_sha256, native_project_ids
  ) values (v_request_id, v_slug, v_intent_sha256, v_project_ids);

  return jsonb_build_object(
    'ok', true,
    'outcome', 'created',
    'client_slug', v_slug,
    'native_project_ids', v_project_ids
  );
end;
$fn$;

revoke all on function public.production_native_client_provision(text, text, text)
  from public, anon, authenticated;
grant execute on function public.production_native_client_provision(text, text, text)
  to service_role;

commit;
