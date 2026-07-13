-- Write-UI epoch: reversible Linear-authoritative parity lane.
--
-- Existing outbound/authority flags are deliberately untouched. Explicit
-- server-authenticated legacy-parity intents receive their own marker and may
-- be recovered while their team remains Linear-authoritative. The marker is
-- never accepted from a direct browser/table write: service-only ledger/RPC
-- writers set it after the existing idempotent enqueue helper returns.

begin;

alter table public.mirror_outbox
  add column if not exists legacy_parity boolean not null default false;

create index if not exists mirror_outbox_legacy_parity_retry_idx
  on public.mirror_outbox (status, next_retry_at, created_at)
  where legacy_parity = true;

do $block$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_legacy_parity_operation_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_legacy_parity_operation_check
      check (
        legacy_parity = false
        or operation in ('create', 'status', 'comment')
      );
  end if;
end
$block$;

insert into public.syncview_runtime_flags (key, value, updated_by)
values (
  'linear_legacy_parity_enabled',
  '{"enabled":true}'::jsonb,
  'write-ui-outbox-parity-migration'
)
on conflict (key) do nothing;

-- Preserve the existing enqueue contract while carrying the server-derived
-- outbound.legacy_parity bit into the row. The enqueue RPC remains service-only
-- and dedup_key remains the sole idempotency key.
create or replace function public.track_b_enqueue_outbound_intent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_outbound jsonb := coalesce(new.payload->'outbound', '{}'::jsonb);
  v_entity text;
  v_entity_id text;
  v_operation text;
  v_client_slug text := new.client_slug;
  v_team text;
  v_deliverable_id text := new.deliverable_id;
  v_batch_id text := new.batch_id;
  v_outbox_id bigint;
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
begin
  if new.source <> 'ui'
     or jsonb_typeof(new.payload->'outbound') is distinct from 'object' then
    return new;
  end if;

  v_entity := coalesce(nullif(v_outbound->>'entity', ''), case when new.deliverable_id is null then 'batch' else 'deliverable' end);
  v_entity_id := coalesce(nullif(v_outbound->>'entity_id', ''), new.deliverable_id, new.batch_id);
  v_operation := nullif(v_outbound->>'operation', '');

  if v_legacy_parity and v_operation not in ('create', 'status', 'comment') then
    raise exception 'unsupported legacy parity operation';
  end if;

  if new.deliverable_id is not null then
    select d.client_slug, d.team, d.batch_id
      into v_client_slug, v_team, v_batch_id
    from public.deliverables d
    where d.id = new.deliverable_id;
  elsif new.batch_id is not null then
    select b.client_slug, b.team
      into v_client_slug, v_team
    from public.batches b
    where b.id = new.batch_id;
  end if;

  -- Paired/mixed native batches have no single team. The authenticated server
  -- event owns this explicit team value for its team-specific parent intent.
  v_team := coalesce(nullif(v_outbound->>'team', ''), v_team);

  v_outbox_id := public.mirror_outbox_enqueue(
    p_entity := v_entity,
    p_entity_id := v_entity_id,
    p_operation := v_operation,
    p_payload := coalesce(v_outbound->'payload', '{}'::jsonb),
    p_dedup_key := nullif(v_outbound->>'dedup_key', ''),
    p_source_edited_at := coalesce(nullif(v_outbound->>'source_edited_at', '')::timestamptz, new.ts),
    p_client_slug := v_client_slug,
    p_team := v_team,
    p_actor := new.actor,
    p_role := new.role,
    p_deliverable_id := v_deliverable_id,
    p_batch_id := v_batch_id,
    p_comment_id := nullif(v_outbound->>'comment_id', ''),
    p_depends_on_id := nullif(v_outbound->>'depends_on_id', '')::bigint,
    p_test_only := coalesce((v_outbound->>'test_only')::boolean, false)
  );

  if v_legacy_parity then
    update public.mirror_outbox
    set legacy_parity = true,
        updated_at = now()
    where id = v_outbox_id;
  end if;

  return new;
end;
$fn$;

-- HTTP prechecks cannot serialize two simultaneous uses of the same request
-- id. Lock and compare the durable outbox identity in the same transaction as
-- the native row/event write. The first request owns its source timestamp;
-- semantic retries compare the server-computed intent fingerprint instead.
create or replace function public.production_outbox_replay(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_client_slug text,
  p_team text,
  p_actor text,
  p_role text,
  p_test_only boolean,
  p_legacy_parity boolean,
  p_intent_fingerprint text,
  p_dedup_key text
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_existing public.mirror_outbox%rowtype;
begin
  if nullif(btrim(coalesce(p_dedup_key, '')), '') is null
     or nullif(btrim(coalesce(p_intent_fingerprint, '')), '') is null then
    raise exception 'production write dedup and intent fingerprint required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  select o.* into v_existing
  from public.mirror_outbox o
  where o.dedup_key = p_dedup_key
  for update;
  if not found then return false; end if;

  if v_existing.entity is distinct from p_entity
     or v_existing.entity_id is distinct from p_entity_id
     or v_existing.operation is distinct from p_operation
     or v_existing.client_slug is distinct from p_client_slug
     or v_existing.team is distinct from p_team
     or v_existing.actor is distinct from p_actor
     or v_existing.role is distinct from p_role
     or v_existing.test_only is distinct from coalesce(p_test_only, false)
     or v_existing.legacy_parity is distinct from coalesce(p_legacy_parity, false)
     or nullif(v_existing.payload->>'_intent_fingerprint', '')
          is distinct from p_intent_fingerprint then
    raise exception 'idempotency_conflict';
  end if;
  return true;
end;
$fn$;

revoke all on function public.production_outbox_replay(
  text, text, text, text, text, text, text, boolean, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.production_outbox_replay(
  text, text, text, text, text, text, text, boolean, boolean, text, text
) to service_role;

create or replace function public.production_assert_authority(
  p_client_slug text,
  p_team text,
  p_test_only boolean,
  p_legacy_parity boolean
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_value jsonb;
  v_parity_value jsonb;
  v_authority text;
  v_test_ok boolean;
begin
  if p_test_only then
    select exists(
      select 1 from public.clients c
      where c.slug = p_client_slug and c.active = true and c.kind = 'test'
    ) into v_test_ok;
    if not v_test_ok then raise exception 'test_client_scope_required'; end if;
    return;
  end if;
  if p_team is null or p_team not in ('video', 'graphics') then
    raise exception 'authority_unavailable';
  end if;
  if p_legacy_parity then
    select f.value into v_parity_value
    from public.syncview_runtime_flags f
    where f.key = 'linear_legacy_parity_enabled'
    for share;
    if not found
       or jsonb_typeof(v_parity_value) <> 'object'
       or v_parity_value->'enabled' is distinct from 'true'::jsonb then
      raise exception 'legacy_parity_gate_unavailable';
    end if;
  end if;
  select f.value into v_value
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found or jsonb_typeof(v_value) <> 'object' then
    raise exception 'authority_unavailable';
  end if;
  v_authority := lower(nullif(v_value->>p_team, ''));
  if p_legacy_parity and v_authority is distinct from 'linear' then
    raise exception 'legacy_parity_not_allowed';
  elsif not p_legacy_parity and v_authority is distinct from 'syncview' then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$fn$;

revoke all on function public.production_assert_authority(text, text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.production_assert_authority(text, text, boolean, boolean)
  to service_role;

create or replace function public.production_deliverable_write(
  p_row jsonb,
  p_event jsonb default '{}'::jsonb
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_payload jsonb := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
  v_result public.deliverables%rowtype;
  v_current public.deliverables%rowtype;
begin
  if v_id is null then raise exception 'production deliverable id required'; end if;
  perform public.production_assert_authority(
    nullif(v_row->>'client_slug', ''), nullif(v_row->>'team', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'deliverable'),
    v_id,
    nullif(v_outbound->>'operation', ''),
    nullif(v_row->>'client_slug', ''),
    nullif(v_row->>'team', ''),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_fingerprint,
    v_dedup
  ) then
    select d.* into v_result from public.deliverables d where d.id = v_id;
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_current from public.deliverables d where d.id = v_id for update;
  if found then
    if v_event ? 'expected_status'
       and v_current.status is distinct from nullif(v_event->>'expected_status', '') then
      raise exception 'write_conflict';
    end if;
    if v_event ? 'expected_updated_at'
       and v_current.updated_at is distinct from nullif(v_event->>'expected_updated_at', '')::timestamptz then
      raise exception 'write_conflict';
    end if;
  end if;
  return public.deliverable_write(v_row, v_event);
end;
$fn$;

create or replace function public.production_batch_write(
  p_row jsonb,
  p_event jsonb default '{}'::jsonb
) returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_payload jsonb := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_team text := coalesce(nullif(v_outbound->>'team', ''), nullif(v_row->>'team', ''));
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
  v_result public.batches%rowtype;
begin
  if v_id is null then raise exception 'production batch id required'; end if;
  perform public.production_assert_authority(
    nullif(v_row->>'client_slug', ''), v_team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'batch'),
    v_id,
    nullif(v_outbound->>'operation', ''),
    nullif(v_row->>'client_slug', ''),
    v_team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_fingerprint,
    v_dedup
  ) then
    select b.* into v_result from public.batches b where b.id = v_id;
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;
  return public.batch_write(v_row, v_event);
end;
$fn$;

-- A paired VID/GRA intake has one native batch but two Linear parent intents.
-- The first intent accompanies production_batch_write; this helper appends the
-- second ledger/outbox intent without mutating the batch row a second time.
create or replace function public.production_batch_intent_write(
  p_batch_id text,
  p_event jsonb
) returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_payload jsonb := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_result public.batches%rowtype;
begin
  select b.* into v_result from public.batches b where b.id = p_batch_id;
  if not found then raise exception 'production batch not found'; end if;
  perform public.production_assert_authority(
    v_result.client_slug,
    coalesce(nullif(v_outbound->>'team', ''), v_result.team),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'batch'),
    p_batch_id,
    nullif(v_outbound->>'operation', ''),
    v_result.client_slug,
    coalesce(nullif(v_outbound->>'team', ''), v_result.team),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    nullif(v_payload->>'_intent_fingerprint', ''),
    nullif(v_outbound->>'dedup_key', '')
  ) then
    return v_result;
  end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    null, v_result.id, v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''), nullif(v_event->>'role', ''),
    coalesce(nullif(v_event->>'action', ''), 'create'),
    null, null, coalesce(nullif(v_event->>'source', ''), 'ui'), v_event
  );
  return v_result;
end;
$fn$;

revoke all on function public.production_deliverable_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_deliverable_write(jsonb, jsonb)
  to service_role;
revoke all on function public.production_batch_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_batch_write(jsonb, jsonb)
  to service_role;
revoke all on function public.production_batch_intent_write(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_batch_intent_write(text, jsonb)
  to service_role;

-- Native comments need the normalized Part-1 store and the Linear outbox to
-- commit together. production_comment_upsert owns normalization, thread state,
-- and the self-contained ledger event; this wrapper consumes its outbound
-- envelope and enqueues exactly one idempotent comment intent in the same SQL
-- transaction.
create or replace function public.production_comment_write(
  p_comment jsonb,
  p_event jsonb default '{}'::jsonb
) returns public.production_comments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_comment jsonb := coalesce(p_comment, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_result public.production_comments%rowtype;
  v_target_id text;
  v_outbox_id bigint;
  v_payload jsonb;
  v_deliverable_id text := nullif(btrim(v_comment->>'deliverable_id'), '');
  v_batch_id text := nullif(btrim(v_comment->>'batch_id'), '');
  v_client_slug text;
  v_team text;
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
  v_native_comment_id text := nullif(btrim(v_comment->>'native_comment_id'), '');
  v_existing_native_dedup text;
  v_requested_id text := coalesce(
    nullif(btrim(v_comment->>'id'), ''),
    nullif(btrim(v_comment->>'native_comment_id'), '')
  );
  v_operation text := coalesce(nullif(lower(v_outbound->>'operation'), ''), 'comment');
  v_dedup_key text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
begin
  if not (v_event ? 'outbound')
     or jsonb_typeof(v_event->'outbound') is distinct from 'object' then
    raise exception 'production comment outbound intent required';
  end if;
  if v_operation <> 'comment' then
    raise exception 'production comment outbound operation must be comment';
  end if;
  if v_dedup_key is null then
    raise exception 'production comment outbound dedup key required';
  end if;

  v_target_id := coalesce(v_deliverable_id, v_batch_id);
  if v_target_id is null then raise exception 'production comment outbound target required'; end if;
  if v_deliverable_id is not null then
    select d.client_slug, d.team into v_client_slug, v_team
    from public.deliverables d where d.id = v_deliverable_id;
  else
    select b.client_slug, coalesce(b.team, nullif(v_outbound->>'team', ''))
      into v_client_slug, v_team
    from public.batches b where b.id = v_batch_id;
  end if;
  if v_client_slug is null or v_team is null then
    raise exception 'production comment outbound scope required';
  end if;

  perform public.production_assert_authority(
    v_client_slug, v_team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity
  );

  -- A legacy browser queue may retry the same native comment under a new
  -- request id. That must be the same intent, never a second Linear comment.
  if v_native_comment_id is not null then
    select c.idempotency_key into v_existing_native_dedup
    from public.production_comments c
    where c.native_comment_id = v_native_comment_id;
    if found and v_existing_native_dedup is distinct from v_dedup_key then
      raise exception 'idempotency_conflict';
    end if;
  end if;

  if public.production_outbox_replay(
    'comment',
    v_target_id,
    'comment',
    v_client_slug,
    v_team,
    nullif(v_comment->>'author_name', ''),
    nullif(v_comment->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity,
    v_fingerprint,
    v_dedup_key
  ) then
    select c.* into v_result
    from public.production_comments c
    where c.id = v_requested_id
       or c.native_comment_id = v_requested_id
       or c.idempotency_key = v_dedup_key
    order by case when c.id = v_requested_id then 0 else 1 end
    limit 1;
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;

  v_result := public.production_comment_upsert(
    v_comment,
    v_event - 'outbound'
  );
  v_target_id := coalesce(v_result.deliverable_id, v_result.batch_id);
  if v_target_id is null then
    raise exception 'production comment outbound target required';
  end if;

  -- Body always comes from the normalized durable row, never a second
  -- caller-supplied value that could disagree with storage/ledger truth.
  v_payload := jsonb_set(
    coalesce(v_outbound->'payload', '{}'::jsonb),
    '{body}',
    to_jsonb(v_result.body),
    true
  );

  v_outbox_id := public.mirror_outbox_enqueue(
    p_entity := 'comment',
    p_entity_id := v_target_id,
    p_operation := 'comment',
    p_payload := v_payload,
    p_dedup_key := v_dedup_key,
    p_source_edited_at := v_result.source_updated_at,
    p_client_slug := v_result.client_slug,
    p_team := v_result.team,
    p_actor := v_result.author_name,
    p_role := v_result.role,
    p_deliverable_id := v_result.deliverable_id,
    p_batch_id := v_result.batch_id,
    p_comment_id := v_result.id,
    p_depends_on_id := nullif(v_outbound->>'depends_on_id', '')::bigint,
    p_test_only := coalesce((v_outbound->>'test_only')::boolean, false)
  );

  if v_legacy_parity then
    update public.mirror_outbox
    set legacy_parity = true,
        updated_at = now()
    where id = v_outbox_id;
  end if;

  return v_result;
end;
$fn$;

revoke all on function public.production_comment_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_comment_write(jsonb, jsonb)
  to service_role;

commit;
