-- F44: durable, idempotent receipts for Calendar -> Linear intake.
--
-- Supabase is the authoritative receipt ledger. The n8n Data Table with the
-- same public column shape is an operator-only mirror for failed/partial rows;
-- it is never the duplicate or success authority.

begin;

-- Supabase installs pgcrypto in the extensions schema. Keep the digest at the
-- database boundary so a caller cannot pair an arbitrary hash with a different
-- recovery payload.
create extension if not exists pgcrypto with schema extensions;

create or replace function public._linear_intake_canonical_json(p_value jsonb)
returns text
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $fn$
declare
  v_result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      select '{' || coalesce(
        string_agg(
          to_json(pair.key)::text || ':' || public._linear_intake_canonical_json(pair.value),
          ',' order by pair.key collate "C"
        ),
        ''
      ) || '}'
        into v_result
        from jsonb_each(p_value) as pair(key, value);
      return v_result;
    when 'array' then
      select '[' || coalesce(
        string_agg(
          public._linear_intake_canonical_json(item.value),
          ',' order by item.ordinality
        ),
        ''
      ) || ']'
        into v_result
        from jsonb_array_elements(p_value) with ordinality as item(value, ordinality);
      return v_result;
    else
      return p_value::text;
  end case;
end;
$fn$;

create or replace function public._linear_intake_sha256_hex(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, extensions
as $fn$
  select encode(extensions.digest(convert_to(p_value, 'UTF8'), 'sha256'), 'hex');
$fn$;

create or replace function public._linear_intake_payload_is_canonical(p_value text)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, public
as $fn$
declare
  v_payload jsonb;
  v_payload_keys text[];
  v_video jsonb;
  v_video_keys text[];
  v_ordinality bigint;
begin
  begin
    v_payload := p_value::jsonb;
  exception when others then
    return false;
  end;

  if jsonb_typeof(v_payload) <> 'object'
     or p_value <> public._linear_intake_canonical_json(v_payload) then
    return false;
  end if;

  select array_agg(key order by key collate "C")
    into v_payload_keys
    from jsonb_object_keys(v_payload) as item(key);
  if v_payload_keys is distinct from
     array['clientName', 'filmingPlans', 'notes', 'title', 'videos']::text[] then
    return false;
  end if;

  if jsonb_typeof(v_payload -> 'clientName') <> 'string'
     or nullif(btrim(v_payload ->> 'clientName'), '') is null
     or v_payload ->> 'clientName' <> btrim(v_payload ->> 'clientName')
     or jsonb_typeof(v_payload -> 'filmingPlans') <> 'string'
     or jsonb_typeof(v_payload -> 'notes') <> 'string'
     or jsonb_typeof(v_payload -> 'title') <> 'string'
     or nullif(btrim(v_payload ->> 'title'), '') is null
     or jsonb_typeof(v_payload -> 'videos') <> 'array'
     or jsonb_array_length(v_payload -> 'videos') = 0 then
    return false;
  end if;

  for v_video, v_ordinality in
    select item.value, item.ordinality
      from jsonb_array_elements(v_payload -> 'videos') with ordinality
        as item(value, ordinality)
  loop
    if jsonb_typeof(v_video) <> 'object' then
      return false;
    end if;
    select array_agg(key order by key collate "C")
      into v_video_keys
      from jsonb_object_keys(v_video) as item(key);
    if v_video_keys is distinct from
       array['audio', 'dueDate', 'main_cam', 'number', 'side_cam']::text[] then
      return false;
    end if;
    if jsonb_typeof(v_video -> 'number') <> 'number'
       or (v_video ->> 'number') !~ '^[1-9][0-9]*$'
       or (v_video ->> 'number')::bigint <> v_ordinality
       or jsonb_typeof(v_video -> 'main_cam') <> 'string'
       or jsonb_typeof(v_video -> 'side_cam') <> 'string'
       or jsonb_typeof(v_video -> 'audio') <> 'string'
       or jsonb_typeof(v_video -> 'dueDate') not in ('null', 'string') then
      return false;
    end if;
  end loop;

  return true;
end;
$fn$;

create or replace function public._linear_intake_expected_child_count(p_value jsonb)
returns integer
language sql
immutable
strict
set search_path = pg_catalog
as $fn$
  select case
    when jsonb_typeof(p_value) = 'object'
     and jsonb_typeof(p_value -> 'videos') = 'array'
      then jsonb_array_length(p_value -> 'videos')
    else null
  end;
$fn$;

create or replace function public._linear_intake_is_string_array(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
begin
  if jsonb_typeof(p_value) is distinct from 'array' then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_value) as item(value)
    where jsonb_typeof(item.value) <> 'string'
       or nullif(btrim(item.value #>> '{}'), '') is null
       or (item.value #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  and jsonb_array_length(p_value) = (
    select count(distinct item.value #>> '{}')
    from jsonb_array_elements(p_value) as item(value)
  );
end;
$fn$;

create or replace function public._linear_intake_replay_note_is_valid(
  p_value text,
  p_receipt_key text,
  p_payload_hash text,
  p_source_status text,
  p_prior_attempts integer,
  p_parent_issue_id text,
  p_child_issue_ids jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public
as $fn$
declare
  v_note jsonb;
  v_readback jsonb;
  v_note_keys text[];
  v_readback_keys text[];
begin
  if nullif(btrim(coalesce(p_value, '')), '') is null then
    return false;
  end if;
  begin
    v_note := p_value::jsonb;
  exception when others then
    return false;
  end;
  if jsonb_typeof(v_note) is distinct from 'object'
     or p_value <> public._linear_intake_canonical_json(v_note)
     or jsonb_typeof(v_note -> 'schema_version') is distinct from 'number'
     or v_note ->> 'schema_version' is distinct from '1'
     or jsonb_typeof(v_note -> 'replay_id') is distinct from 'string'
     or coalesce(v_note ->> 'replay_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or jsonb_typeof(v_note -> 'receipt_key') is distinct from 'string'
     or v_note ->> 'receipt_key' is distinct from p_receipt_key
     or jsonb_typeof(v_note -> 'payload_hash') is distinct from 'string'
     or v_note ->> 'payload_hash' is distinct from p_payload_hash
     or jsonb_typeof(v_note -> 'source_status') is distinct from 'string'
     or v_note ->> 'source_status' is distinct from p_source_status
     or jsonb_typeof(v_note -> 'prior_attempts') is distinct from 'number'
     or coalesce(v_note ->> 'prior_attempts', '') !~ '^[0-9]+$'
     or jsonb_typeof(v_note -> 'requested_by') is distinct from 'string'
     or nullif(btrim(coalesce(v_note ->> 'requested_by', '')), '') is null
     or jsonb_typeof(v_note -> 'reason') is distinct from 'string'
     or nullif(btrim(coalesce(v_note ->> 'reason', '')), '') is null
     or jsonb_typeof(v_note -> 'requested_at') is distinct from 'string'
     or coalesce(v_note ->> 'requested_at', '') !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3,6})?Z$' then
    return false;
  end if;
  begin
    if (v_note ->> 'prior_attempts')::integer is distinct from p_prior_attempts then
      return false;
    end if;
  exception when others then
    return false;
  end;

  select array_agg(key order by key collate "C")
    into v_note_keys
    from jsonb_object_keys(v_note) as item(key);
  if v_note_keys is distinct from array[
    'exact_id_readback', 'payload_hash', 'prior_attempts', 'reason',
    'receipt_key', 'replay_id', 'requested_at', 'requested_by',
    'schema_version', 'source_status'
  ]::text[] then
    return false;
  end if;

  v_readback := v_note -> 'exact_id_readback';
  if jsonb_typeof(v_readback) is distinct from 'object'
     or v_readback ->> 'strategy' is distinct from 'read-before-create'
     or coalesce(v_readback ->> 'parent', '') not in ('present', 'absent', 'unknown')
     or not coalesce(public._linear_intake_is_string_array(v_readback -> 'confirmed_child_ids'), false)
     or v_readback -> 'confirmed_child_ids' is distinct from p_child_issue_ids then
    return false;
  end if;
  select array_agg(key order by key collate "C")
    into v_readback_keys
    from jsonb_object_keys(v_readback) as item(key);
  if v_readback_keys is distinct from
     array['confirmed_child_ids', 'parent', 'strategy']::text[] then
    return false;
  end if;
  if p_parent_issue_id is not null and v_readback ->> 'parent' <> 'present' then
    return false;
  end if;
  return true;
end;
$fn$;

create table if not exists public.linear_intake_receipts (
  receipt_key text primary key,
  payload_hash text not null,
  client text not null,
  team text not null,
  payload_json text not null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending',
  attempts integer not null default 0,
  parent_issue_id text,
  parent_issue_url text,
  child_issue_ids text not null default '[]',
  error text,
  replay_note text,

  constraint linear_intake_receipts_hash_check check (
    payload_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint linear_intake_receipts_team_check check (
    team in ('video', 'graphics')
  ),
  constraint linear_intake_receipts_key_check check (
    receipt_key = 'linear-intake-v1:' || team || ':' || payload_hash
  ),
  constraint linear_intake_receipts_client_check check (
    nullif(btrim(client), '') is not null
  ),
  constraint linear_intake_receipts_payload_check check (
    public._linear_intake_payload_is_canonical(payload_json)
    and client = btrim(payload_json::jsonb ->> 'clientName')
  ),
  constraint linear_intake_receipts_payload_hash_binding_check check (
    payload_hash = public._linear_intake_sha256_hex(payload_json)
  ),
  constraint linear_intake_receipts_status_check check (
    status in ('pending', 'created', 'failed', 'partial')
  ),
  constraint linear_intake_receipts_attempts_check check (
    attempts >= 0
  ),
  constraint linear_intake_receipts_children_check check (
    public._linear_intake_is_string_array(child_issue_ids::jsonb)
  ),
  constraint linear_intake_receipts_parent_id_check check (
    parent_issue_id is null
    or parent_issue_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  constraint linear_intake_receipts_parent_url_check check (
    parent_issue_url is null or parent_issue_id is not null
  ),
  constraint linear_intake_receipts_created_children_complete_check check (
    status <> 'created'
    or jsonb_array_length(child_issue_ids::jsonb)
       = public._linear_intake_expected_child_count(payload_json::jsonb)
  ),
  constraint linear_intake_receipts_terminal_shape_check check (
    (
      status <> 'created'
      or (
        nullif(btrim(coalesce(parent_issue_id, '')), '') is not null
        and error is null
      )
    )
    and (
      status <> 'failed'
      or (
        nullif(btrim(coalesce(error, '')), '') is not null
        and parent_issue_id is null
        and jsonb_array_length(child_issue_ids::jsonb) = 0
      )
    )
    and (
      status <> 'partial'
      or (
        nullif(btrim(coalesce(error, '')), '') is not null
        and (
          nullif(btrim(coalesce(parent_issue_id, '')), '') is not null
          or jsonb_array_length(child_issue_ids::jsonb) > 0
        )
      )
    )
  )
);

-- CREATE TABLE IF NOT EXISTS does not add constraints to an already-installed
-- ledger. Reinstall these hardened checks explicitly so reapplying this
-- migration upgrades the live 14-column table without changing its shape.
alter table public.linear_intake_receipts
  drop constraint if exists linear_intake_receipts_payload_check;
alter table public.linear_intake_receipts
  add constraint linear_intake_receipts_payload_check check (
    public._linear_intake_payload_is_canonical(payload_json)
    and client = btrim(payload_json::jsonb ->> 'clientName')
  );
alter table public.linear_intake_receipts
  drop constraint if exists linear_intake_receipts_payload_hash_binding_check;
alter table public.linear_intake_receipts
  add constraint linear_intake_receipts_payload_hash_binding_check check (
    payload_hash = public._linear_intake_sha256_hex(payload_json)
  );
alter table public.linear_intake_receipts
  drop constraint if exists linear_intake_receipts_children_check;
alter table public.linear_intake_receipts
  add constraint linear_intake_receipts_children_check check (
    public._linear_intake_is_string_array(child_issue_ids::jsonb)
  );
alter table public.linear_intake_receipts
  drop constraint if exists linear_intake_receipts_parent_id_check;
alter table public.linear_intake_receipts
  add constraint linear_intake_receipts_parent_id_check check (
    parent_issue_id is null
    or parent_issue_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  );
alter table public.linear_intake_receipts
  drop constraint if exists linear_intake_receipts_created_children_complete_check;
alter table public.linear_intake_receipts
  add constraint linear_intake_receipts_created_children_complete_check check (
    status <> 'created'
    or jsonb_array_length(child_issue_ids::jsonb)
       = public._linear_intake_expected_child_count(payload_json::jsonb)
  );

comment on table public.linear_intake_receipts is
  'Authoritative F44 intake receipts. Browser access is forbidden; n8n uses the service role.';
comment on column public.linear_intake_receipts.receipt_key is
  'linear-intake-v1:<team>:<canonical payload SHA-256>; immutable duplicate authority.';
comment on column public.linear_intake_receipts.payload_json is
  'Exact stable JSON create payload. Its UTF-8 SHA-256 must equal payload_hash. Never copy to public logs or tickets.';
comment on column public.linear_intake_receipts.child_issue_ids is
  'Monotonic JSON array of Linear UUID strings positively confirmed by readback.';
comment on column public.linear_intake_receipts.replay_note is
  'Private canonical JSON replay claim bound to this receipt, prior status/attempt, requester, reason, and exact-ID readback.';

create index if not exists linear_intake_receipts_status_updated_idx
  on public.linear_intake_receipts (status, updated_at);

create or replace function public._linear_intake_receipt_guard_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_old_child text;
  v_new_replay jsonb;
  v_old_replay_id text;
begin
  if new.receipt_key is distinct from old.receipt_key
     or new.payload_hash is distinct from old.payload_hash
     or new.client is distinct from old.client
     or new.team is distinct from old.team
     or new.payload_json is distinct from old.payload_json
     or new.requested_at is distinct from old.requested_at then
    raise exception 'linear_intake_identity_immutable';
  end if;

  if new.attempts < old.attempts then
    raise exception 'linear_intake_attempts_must_be_monotonic';
  end if;

  if old.parent_issue_id is not null
     and new.parent_issue_id is distinct from old.parent_issue_id then
    raise exception 'linear_intake_parent_id_immutable';
  end if;
  if old.parent_issue_url is not null
     and new.parent_issue_url is distinct from old.parent_issue_url then
    raise exception 'linear_intake_parent_url_immutable';
  end if;

  for v_old_child in
    select item.value #>> '{}'
    from jsonb_array_elements(old.child_issue_ids::jsonb) as item(value)
  loop
    if not (new.child_issue_ids::jsonb ? v_old_child) then
      raise exception 'linear_intake_child_ids_must_be_monotonic';
    end if;
  end loop;

  if old.status = 'created' and new.status <> 'created' then
    raise exception 'linear_intake_created_is_terminal';
  end if;

  if old.status in ('failed', 'partial') and new.status = 'pending' then
    if new.attempts <> old.attempts + 1 then
      raise exception 'linear_intake_replay_attempt_must_increment_once';
    end if;
    if new.replay_note is not distinct from old.replay_note then
      raise exception 'linear_intake_new_replay_note_required';
    end if;
    if not public._linear_intake_replay_note_is_valid(
      new.replay_note,
      old.receipt_key,
      old.payload_hash,
      old.status,
      old.attempts,
      old.parent_issue_id,
      old.child_issue_ids::jsonb
    ) then
      raise exception 'linear_intake_structured_replay_note_required';
    end if;
    v_new_replay := new.replay_note::jsonb;
    begin
      v_old_replay_id := old.replay_note::jsonb ->> 'replay_id';
    exception when others then
      v_old_replay_id := null;
    end;
    if v_new_replay ->> 'replay_id' is not distinct from v_old_replay_id then
      raise exception 'linear_intake_replay_id_must_be_new';
    end if;
  end if;

  -- A second stale replay update that waited on the first row lock sees the
  -- row as pending. It may not replace the winning replay claim or bump the
  -- claim counter; the workflow must treat the receipt as in progress.
  if old.status = 'pending' and new.status = 'pending'
     and (
       new.replay_note is distinct from old.replay_note
       or new.attempts is distinct from old.attempts
     ) then
    raise exception 'linear_intake_pending_replay_conflict';
  end if;

  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists linear_intake_receipts_guard_update
  on public.linear_intake_receipts;
create trigger linear_intake_receipts_guard_update
  before update on public.linear_intake_receipts
  for each row execute function public._linear_intake_receipt_guard_update();

alter table public.linear_intake_receipts enable row level security;

revoke all on table public.linear_intake_receipts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.linear_intake_receipts
  to service_role;

revoke all on function public._linear_intake_is_string_array(jsonb)
  from public, anon, authenticated;
grant execute on function public._linear_intake_is_string_array(jsonb)
  to service_role;
revoke all on function public._linear_intake_canonical_json(jsonb)
  from public, anon, authenticated;
grant execute on function public._linear_intake_canonical_json(jsonb)
  to service_role;
revoke all on function public._linear_intake_sha256_hex(text)
  from public, anon, authenticated;
grant execute on function public._linear_intake_sha256_hex(text)
  to service_role;
revoke all on function public._linear_intake_payload_is_canonical(text)
  from public, anon, authenticated;
grant execute on function public._linear_intake_payload_is_canonical(text)
  to service_role;
revoke all on function public._linear_intake_expected_child_count(jsonb)
  from public, anon, authenticated;
grant execute on function public._linear_intake_expected_child_count(jsonb)
  to service_role;
revoke all on function public._linear_intake_replay_note_is_valid(text, text, text, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function public._linear_intake_replay_note_is_valid(text, text, text, text, integer, text, jsonb)
  to service_role;
revoke all on function public._linear_intake_receipt_guard_update()
  from public, anon, authenticated;
grant execute on function public._linear_intake_receipt_guard_update()
  to service_role;

commit;
