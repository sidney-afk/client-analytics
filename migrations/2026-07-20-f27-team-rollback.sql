-- F27: guarded, per-team Track-B rollback accounting.
--
-- This is additive source only. Applying it does not flip a flag, change
-- authority, deploy an Edge Function, or touch n8n. The final authority
-- reversal remains owner-executed and is refused unless the affected team is
-- held, every captured intent is classified, approved replays are terminal,
-- and the team's active outbox count is exactly zero.

begin;

create table if not exists public.track_b_f27_team_fences (
  team text primary key check (team in ('video', 'graphics')),
  generation bigint not null default 0 check (generation >= 0),
  updated_at timestamptz not null default now(),
  updated_by text not null
);

insert into public.track_b_f27_team_fences (team, generation, updated_by)
values ('video', 0, 'f27-migration'), ('graphics', 0, 'f27-migration')
on conflict (team) do nothing;

create table if not exists public.track_b_team_rollbacks (
  id uuid primary key default gen_random_uuid(),
  correlation_id uuid not null unique default gen_random_uuid(),
  team text not null,
  is_drill boolean not null default false,
  state text not null default 'open' check (state in ('open', 'complete', 'cancelled')),
  expected_authority jsonb not null,
  prior_outbound jsonb not null,
  prior_parity jsonb not null,
  fence_generation bigint check (fence_generation >= 0),
  snapshot_count integer not null default 0 check (snapshot_count >= 0),
  snapshot_sha256 text,
  terminal_receipt jsonb,
  actor text not null,
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint track_b_team_rollbacks_scope_check check (
    (is_drill = false and team in ('video', 'graphics') and fence_generation is not null)
    or (is_drill = true and team = '__f27_drill__' and fence_generation is null)
  )
);

create unique index if not exists track_b_team_rollbacks_one_open_team_idx
  on public.track_b_team_rollbacks (team)
  where state = 'open';

create table if not exists public.track_b_team_rollback_intents (
  rollback_id uuid not null references public.track_b_team_rollbacks(id),
  outbox_id bigint not null references public.mirror_outbox(id),
  row_snapshot jsonb not null,
  row_sha256 text not null,
  classification text check (classification in (
    'replay', 'quarantine', 'discard', 'already_reflected'
  )),
  classification_history jsonb not null default '[]'::jsonb,
  reason text,
  classified_by text,
  classified_at timestamptz,
  terminal_receipt jsonb,
  primary key (rollback_id, outbox_id)
);

alter table public.mirror_outbox
  add column if not exists authority_generation bigint not null default 0,
  add column if not exists f27_drill_rollback_id uuid
    references public.track_b_team_rollbacks(id);

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_f27_generation_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_f27_generation_check
      check (authority_generation >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_f27_drill_scope_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_f27_drill_scope_check
      check (
        (team <> '__f27_drill__' and f27_drill_rollback_id is null)
        or (
          team = '__f27_drill__'
          and client_slug = '__f27_drill__'
          and entity = 'deliverable'
          and operation = 'status'
          and test_only = true
          and legacy_parity = false
          and depends_on_id is null
          and authority_generation = 0
          and f27_drill_rollback_id is not null
          and payload->>'f27_drill' = 'true'
        )
      );
  end if;
end
$block$;

create unique index if not exists mirror_outbox_one_f27_drill_row_idx
  on public.mirror_outbox (f27_drill_rollback_id)
  where f27_drill_rollback_id is not null;

-- Keep the public enqueue signature stable. Exact-source writers carry the
-- generation/lane binder inside two reserved payload keys; this helper strips
-- those keys before persistence and writes the trusted columns atomically so
-- the BEFORE INSERT fence never mistakes parity for a native write.
create or replace function public.mirror_outbox_enqueue(
  p_entity text,
  p_entity_id text,
  p_operation text,
  p_payload jsonb,
  p_dedup_key text,
  p_source_edited_at timestamptz,
  p_client_slug text,
  p_team text,
  p_actor text default null,
  p_role text default null,
  p_deliverable_id text default null,
  p_batch_id text default null,
  p_comment_id text default null,
  p_depends_on_id bigint default null,
  p_test_only boolean default false
) returns bigint
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id bigint;
  v_legacy_op text;
  v_raw_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_payload jsonb;
  v_generation bigint;
  v_legacy_parity boolean;
begin
  if coalesce(p_entity, '') not in ('deliverable', 'batch', 'comment') then
    raise exception 'invalid outbound entity';
  end if;
  if coalesce(p_operation, '') not in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels', 'description', 'attachment'
  ) then
    raise exception 'invalid outbound operation';
  end if;
  if nullif(btrim(coalesce(p_entity_id, '')), '') is null
     or nullif(btrim(coalesce(p_dedup_key, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null
     or nullif(btrim(coalesce(p_team, '')), '') is null
     or p_source_edited_at is null then
    raise exception 'incomplete outbound intent';
  end if;

  begin
    v_generation := nullif(v_raw_payload->>'_f27_authority_generation', '')::bigint;
    v_legacy_parity := coalesce((v_raw_payload->>'_f27_legacy_parity')::boolean, false);
  exception when others then
    raise exception 'invalid f27 authority binder';
  end;
  v_payload := v_raw_payload
    - '_f27_authority_generation'
    - '_f27_legacy_parity';

  v_legacy_op := case p_operation
    when 'create' then 'create'
    when 'status' then 'update_state'
    when 'comment' then 'comment'
    when 'archive' then 'archive'
    else 'update_fields'
  end;

  -- Preserve the old idempotent return contract without firing a stale
  -- generation trigger for an intent that already exists.
  perform pg_advisory_xact_lock(hashtextextended(p_dedup_key, 0));
  select id into v_id from public.mirror_outbox where dedup_key = p_dedup_key;
  if found then return v_id; end if;

  insert into public.mirror_outbox (
    deliverable_id, op, payload, attempts, created_at, next_retry_at,
    entity, entity_id, batch_id, comment_id, operation, client_slug, team,
    dedup_key, source_edited_at, status, actor, role, depends_on_id,
    updated_at, test_only, authority_generation, legacy_parity
  ) values (
    p_deliverable_id, v_legacy_op, v_payload, 0, now(), now(),
    p_entity, p_entity_id, p_batch_id, p_comment_id, p_operation,
    p_client_slug, p_team, p_dedup_key, p_source_edited_at, 'pending',
    nullif(btrim(coalesce(p_actor, '')), ''),
    nullif(btrim(coalesce(p_role, '')), ''),
    p_depends_on_id, now(), coalesce(p_test_only, false),
    coalesce(v_generation, -1), v_legacy_parity
  )
  returning id into v_id;

  return v_id;
end;
$fn$;

create or replace function public.track_b_f27_write_authorization(p_team text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_generation bigint;
  v_authority jsonb;
begin
  if v_team not in ('video', 'graphics') then
    raise exception 'f27_invalid_write_team';
  end if;
  select generation into v_generation
  from public.track_b_f27_team_fences where team = v_team;
  select value into v_authority
  from public.syncview_runtime_flags where key = 'prod_authority';
  if v_generation is null or jsonb_typeof(v_authority) is distinct from 'object'
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview', 'supabase') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', case when lower(v_authority->>v_team) = 'supabase' then 'syncview'
                      else lower(v_authority->>v_team) end,
    'generation', v_generation
  );
end;
$fn$;

-- Reconciler reactivation is a new authorization event, not permission to
-- reuse the generation captured by the old intent. Update the generation and
-- status in one statement so the BEFORE trigger validates the fresh binder.
create or replace function public.track_b_f27_requeue(
  p_id bigint,
  p_authority_generation bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if p_authority_generation is null or p_authority_generation < 0 then
    raise exception 'f27_requeue_authorization_required';
  end if;
  update public.mirror_outbox
  set status = 'pending',
      attempts = 0,
      last_error = null,
      processed_at = null,
      next_retry_at = now(),
      lock_token = null,
      locked_at = null,
      updated_at = now(),
      authority_generation = p_authority_generation,
      legacy_parity = false
  where id = p_id
    and team in ('video', 'graphics')
    and operation = 'comment'
    and f27_drill_rollback_id is null
    and status in ('written', 'skipped', 'failed', 'stale');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;

create or replace function public.track_b_f27_hold_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_team text := lower(coalesce(new.team, ''));
  v_generation bigint;
  v_authority jsonb;
  v_parity jsonb;
begin
  if current_setting('app.f27_rollback_bypass', true) = '1' then
    return new;
  end if;

  if v_team = '__f27_drill__' and tg_op = 'INSERT' then
    raise exception 'f27_drill_insert_forbidden';
  end if;

  if new.status in ('pending', 'failed', 'shadow_ok')
     and exists (
       select 1 from public.track_b_team_rollbacks r
       where r.team = v_team and r.state = 'open'
     ) then
    raise exception 'team_rollback_hold:%', v_team;
  end if;

  if new.status in ('pending', 'failed', 'shadow_ok')
     and v_team in ('video', 'graphics') then
    select value into v_authority
    from public.syncview_runtime_flags
    where key = 'prod_authority'
    for share;
    select value into v_parity
    from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled'
    for share;
    select generation into v_generation
    from public.track_b_f27_team_fences
    where team = v_team
    for share;

    if new.authority_generation is distinct from v_generation then
      raise exception 'f27_authority_generation_stale:%', v_team;
    end if;
    if new.test_only = true then
      return new;
    elsif new.legacy_parity = true then
      if lower(coalesce(v_authority->>v_team, '')) <> 'linear'
         or v_parity is distinct from '{"enabled":true}'::jsonb then
        raise exception 'legacy_parity_gate_unavailable';
      end if;
    elsif lower(coalesce(v_authority->>v_team, '')) not in ('syncview', 'supabase') then
      raise exception 'team_is_linear_authoritative';
    end if;
  end if;
  return new;
end;
$fn$;

create trigger track_b_f27_hold_guard
  before insert or update of status, team, authority_generation,
    legacy_parity, test_only, f27_drill_rollback_id
  on public.mirror_outbox
  for each row execute function public.track_b_f27_hold_guard();

-- Existing production RPCs take an authority row lock before their event
-- trigger reaches mirror_outbox. F27 finalization takes the outbox table first;
-- align the writer order to table -> flags -> fence so neither side can hold
-- one resource while waiting on the other.
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
  lock table public.mirror_outbox in row exclusive mode;
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
  elsif not p_legacy_parity and v_authority not in ('syncview', 'supabase') then
    raise exception 'team_is_linear_authoritative';
  end if;
end;
$fn$;

create or replace function public.track_b_f27_begin(
  p_team text,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_team text := lower(nullif(btrim(coalesce(p_team, '')), ''));
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_rollback public.track_b_team_rollbacks%rowtype;
  v_count integer;
  v_inflight integer;
  v_hash text;
  v_fence_generation bigint;
begin
  if v_team not in ('video', 'graphics') or v_actor is null then
    raise exception 'f27_invalid_scope';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27:' || v_team, 0));
  lock table public.mirror_outbox in share row exclusive mode;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;
  select generation into v_fence_generation
  from public.track_b_f27_team_fences
  where team = v_team
  for update;

  if v_authority is distinct from p_expected_authority
     or v_authority->>v_team is distinct from 'syncview' then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;
  if v_fence_generation is null then
    raise exception 'f27_team_fence_required';
  end if;

  -- F2/F4 stop new scans, but a stateless drainer may already hold a row and
  -- have passed its control read. Never clear that lease: wait for the worker
  -- to checkpoint/release, or investigate an expired lease, then begin again.
  select count(*) into v_inflight
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
    and (o.lock_token is not null or o.locked_at is not null);
  if v_inflight <> 0 then
    raise exception 'f27_inflight_rows:%', v_inflight;
  end if;

  insert into public.track_b_team_rollbacks (
    team, is_drill, expected_authority, prior_outbound, prior_parity,
    fence_generation, actor
  ) values (
    v_team, false, v_authority, v_outbound, v_parity,
    v_fence_generation, v_actor
  )
  returning * into v_rollback;

  insert into public.track_b_team_rollback_intents (
    rollback_id, outbox_id, row_snapshot, row_sha256
  )
  select
    v_rollback.id,
    o.id,
    to_jsonb(o),
    encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
  from public.mirror_outbox o
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok')
  order by o.id;
  get diagnostics v_count = row_count;

  select encode(
    extensions.digest(convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'), 'sha256'),
    'hex'
  ) into v_hash
  from public.track_b_team_rollback_intents i
  where i.rollback_id = v_rollback.id;

  perform set_config('app.f27_rollback_bypass', '1', true);
  update public.mirror_outbox o
  set status = 'skipped',
      last_error = 'F27 hold ' || v_rollback.correlation_id::text,
      next_retry_at = null,
      updated_at = now()
  where lower(o.team) = v_team
    and o.status in ('pending', 'failed', 'shadow_ok');

  update public.track_b_team_rollbacks
  set snapshot_count = v_count, snapshot_sha256 = v_hash
  where id = v_rollback.id;

  return jsonb_build_object(
    'ok', true,
    'type', 'f27_snapshot_terminal',
    'rollback_id', v_rollback.id,
    'correlation_id', v_rollback.correlation_id,
    'team', v_team,
    'fence_generation', v_fence_generation,
    'snapshot_count', v_count,
    'snapshot_sha256', v_hash,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
end;
$fn$;

create or replace function public.track_b_f27_begin_drill(
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_rollback public.track_b_team_rollbacks%rowtype;
  v_outbox_id bigint;
  v_row_hash text;
  v_hash text;
begin
  if v_actor is null then raise exception 'f27_actor_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27:__f27_drill__', 0));

  -- One statement snapshot, no real-team row/table lock. A drill is available
  -- only in the dormant live posture and cannot manufacture SyncView authority.
  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;

  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  insert into public.track_b_team_rollbacks (
    team, is_drill, expected_authority, prior_outbound, prior_parity,
    fence_generation, actor
  ) values (
    '__f27_drill__', true, v_authority, v_outbound, v_parity,
    null, v_actor
  ) returning * into v_rollback;

  perform set_config('app.f27_rollback_bypass', '1', true);
  insert into public.mirror_outbox (
    deliverable_id, op, payload, attempts, created_at, next_retry_at,
    entity, entity_id, operation, client_slug, team, dedup_key,
    source_edited_at, status, actor, role, updated_at, test_only,
    legacy_parity, authority_generation, f27_drill_rollback_id
  ) values (
    null, 'update_state', '{"f27_drill":true,"value":"noop"}'::jsonb,
    0, now(), now(), 'deliverable', 'f27-drill:' || v_rollback.id::text,
    'status', '__f27_drill__', '__f27_drill__',
    'f27-drill:' || v_rollback.id::text, now(), 'pending',
    'F27 drill', 'system', now(), true, false, 0, v_rollback.id
  ) returning id into v_outbox_id;

  insert into public.track_b_team_rollback_intents (
    rollback_id, outbox_id, row_snapshot, row_sha256
  )
  select
    v_rollback.id,
    o.id,
    to_jsonb(o),
    encode(extensions.digest(convert_to(to_jsonb(o)::text, 'UTF8'), 'sha256'), 'hex')
  from public.mirror_outbox o
  where o.id = v_outbox_id
    and o.f27_drill_rollback_id = v_rollback.id
  returning row_sha256 into v_row_hash;

  -- Exercise the exact real-rollback aggregate algorithm even though the
  -- reserved drill has one row: hash the ordered row-hash stream separately
  -- from the immutable row hash itself.
  select encode(
    extensions.digest(convert_to(coalesce(string_agg(i.row_sha256, '' order by i.outbox_id), ''), 'UTF8'), 'sha256'),
    'hex'
  ) into v_hash
  from public.track_b_team_rollback_intents i
  where i.rollback_id = v_rollback.id;

  update public.mirror_outbox
  set status = 'skipped',
      last_error = 'F27 drill hold ' || v_rollback.correlation_id::text,
      next_retry_at = null,
      updated_at = now()
  where id = v_outbox_id and f27_drill_rollback_id = v_rollback.id;

  update public.track_b_team_rollbacks
  set snapshot_count = 1, snapshot_sha256 = v_hash
  where id = v_rollback.id and is_drill = true;

  return jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_snapshot_terminal',
    'rollback_id', v_rollback.id,
    'correlation_id', v_rollback.correlation_id,
    'team', '__f27_drill__',
    'is_drill', true,
    'outbox_id', v_outbox_id,
    'snapshot_count', 1,
    'row_sha256', v_row_hash,
    'snapshot_sha256', v_hash,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity,
    'authority', v_authority
  );
end;
$fn$;

create or replace function public.track_b_f27_classify(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_classification text,
  p_reason text,
  p_actor text,
  p_reflected_receipt jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_kind text := lower(nullif(btrim(coalesce(p_classification, '')), ''));
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_team text;
  v_correlation_id uuid;
  v_row_sha256 text;
  v_dedup_key text;
  v_operation text;
  v_is_drill boolean;
  v_count integer;
begin
  if v_kind not in ('replay', 'quarantine', 'discard', 'already_reflected')
     or v_reason is null or v_actor is null then
    raise exception 'f27_classification_incomplete';
  end if;
  -- Match finalization's table -> rollback-row order. Without this explicit
  -- table lock, classify could hold the rollback row while finalize held the
  -- outbox table and each would wait for the other.
  lock table public.mirror_outbox in row exclusive mode;
  select r.team, r.correlation_id, i.row_sha256, o.dedup_key, o.operation, r.is_drill
  into v_team, v_correlation_id, v_row_sha256, v_dedup_key, v_operation, v_is_drill
  from public.track_b_team_rollbacks r
  join public.track_b_team_rollback_intents i
    on i.rollback_id = r.id and i.outbox_id = p_outbox_id
  join public.mirror_outbox o on o.id = i.outbox_id
  where r.id = p_rollback_id and r.state = 'open'
  for update of r;
  if not found then raise exception 'f27_open_rollback_required'; end if;
  if v_is_drill and v_kind <> 'replay' then
    raise exception 'f27_drill_replay_classification_required';
  end if;
  if v_kind = 'already_reflected'
     and (
       p_reflected_receipt->>'ok' is distinct from 'true'
       or p_reflected_receipt->>'type' is distinct from 'f27_already_reflected_terminal'
       or p_reflected_receipt->>'rollback_id' is distinct from p_rollback_id::text
       or p_reflected_receipt->>'outbox_id' is distinct from p_outbox_id::text
       or p_reflected_receipt->>'correlation_id' is distinct from v_correlation_id::text
       or p_reflected_receipt->>'intent_snapshot_sha256' is distinct from v_row_sha256
       or p_reflected_receipt->>'dedup_key' is distinct from v_dedup_key
       or p_reflected_receipt->>'operation' is distinct from v_operation
       or coalesce(p_reflected_receipt->>'issue_id', '') = ''
       or jsonb_typeof(p_reflected_receipt->'observed_result') is distinct from 'object'
       or p_reflected_receipt->>'observed_result_sha256' is distinct from encode(
         extensions.digest(
           convert_to((p_reflected_receipt->'observed_result')::text, 'UTF8'),
           'sha256'
         ),
         'hex'
       )
     ) then
    raise exception 'f27_reflected_receipt_required';
  end if;

  update public.track_b_team_rollback_intents i
  set classification = v_kind, reason = v_reason,
      classified_by = v_actor, classified_at = now(),
      terminal_receipt = case
        when v_kind = 'already_reflected' then p_reflected_receipt
        else i.terminal_receipt
      end,
      classification_history = i.classification_history || jsonb_build_array(
        jsonb_build_object(
          'from', i.classification,
          'to', v_kind,
          'reason', v_reason,
          'actor', v_actor,
          'at', now()
        )
      )
  where i.rollback_id = p_rollback_id and i.outbox_id = p_outbox_id
    and (
      i.classification is null
      or (
        i.classification = 'replay'
        and v_kind in ('quarantine', 'discard', 'already_reflected')
        and i.terminal_receipt is null
        and exists (
          select 1 from public.mirror_outbox o
          where o.id = i.outbox_id
            and lower(o.team) = v_team
            and o.status = 'skipped'
            and o.lock_token is null
            and o.locked_at is null
        )
      )
    );
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_intent_classification_cas_refused'; end if;

  perform set_config('app.f27_rollback_bypass', '1', true);
  if v_kind = 'replay' then
    update public.mirror_outbox
    set attempts = 0, last_error = 'F27 approved replay pending',
        processed_at = null, next_retry_at = now(),
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  elsif v_kind = 'already_reflected' then
    update public.mirror_outbox
    set status = 'written', processed_at = now(), next_retry_at = null,
        linear_result = p_reflected_receipt,
        last_error = 'F27 already_reflected: ' || v_reason,
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  elsif v_kind = 'discard' then
    update public.mirror_outbox
    set status = 'skipped', processed_at = now(), next_retry_at = null,
        last_error = 'F27 ' || v_kind || ': ' || v_reason,
        lock_token = null, locked_at = null, updated_at = now()
    where id = p_outbox_id and lower(team) = v_team and status = 'skipped';
  end if;

  return jsonb_build_object(
    'ok', true, 'type', 'f27_classification_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'classification', v_kind
  );
end;
$fn$;

create or replace function public.track_b_f27_execute_drill_replay(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_lock_token uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_correlation_id uuid;
  v_dedup_key text;
  v_operation text;
  v_row_sha256 text;
  v_result jsonb;
  v_receipt jsonb;
  v_updated integer;
begin
  if p_lock_token is null then raise exception 'f27_drill_claim_required'; end if;

  select r.correlation_id, o.dedup_key, o.operation, i.row_sha256
  into v_correlation_id, v_dedup_key, v_operation, v_row_sha256
  from public.track_b_team_rollbacks r
  join public.track_b_team_rollback_intents i
    on i.rollback_id = r.id and i.outbox_id = p_outbox_id
  join public.mirror_outbox o
    on o.id = i.outbox_id and o.f27_drill_rollback_id = r.id
  where r.id = p_rollback_id
    and r.state = 'open'
    and r.is_drill = true
    and r.team = '__f27_drill__'
    and i.classification = 'replay'
    and i.terminal_receipt is null
    and o.team = '__f27_drill__'
    and o.client_slug = '__f27_drill__'
    and o.test_only = true
    and o.legacy_parity = false
    and o.authority_generation = 0
    and o.status = 'skipped'
    and o.lock_token = p_lock_token
    and o.dedup_key = 'f27-drill:' || p_rollback_id::text
  for update of r, i, o;
  if not found then raise exception 'f27_drill_replay_refused'; end if;

  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;
  if v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_replay_terminal',
    'f27_drill', true,
    'f27_preflight', true,
    'no_external_call', true,
    'mutation', 'f27DrillNoop',
    'issue_id', '__f27_drill__:' || p_rollback_id::text,
    'expected', jsonb_build_object(
      'input', jsonb_build_object('stateId', '__f27_drill__')
    ),
    'rollback_id', p_rollback_id,
    'correlation_id', v_correlation_id,
    'outbox_id', p_outbox_id,
    'dedup_key', v_dedup_key,
    'operation', v_operation,
    'intent_snapshot_sha256', v_row_sha256
  );

  update public.mirror_outbox
  set status = 'written',
      linear_result = v_result,
      processed_at = now(),
      next_retry_at = null,
      last_error = null,
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where id = p_outbox_id
    and f27_drill_rollback_id = p_rollback_id
    and status = 'skipped'
    and lock_token = p_lock_token;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_replay_cas_refused'; end if;
  -- Return the exact recordable replay receipt. `linear_result` deliberately
  -- remains the unhashed mutation result so its stable hash is not recursive.
  v_receipt := v_result || jsonb_build_object(
    'linear_result_sha256', encode(
      extensions.digest(convert_to(v_result::text, 'UTF8'), 'sha256'), 'hex'
    )
  );
  update public.track_b_team_rollback_intents
  set terminal_receipt = v_receipt
  where rollback_id = p_rollback_id
    and outbox_id = p_outbox_id
    and classification = 'replay'
    and terminal_receipt is null;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_terminal_receipt_cas_refused'; end if;
  return v_receipt;
end;
$fn$;

create or replace function public.track_b_f27_record_terminal(
  p_rollback_id uuid,
  p_outbox_id bigint,
  p_receipt jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if coalesce(p_receipt->>'correlation_id', '') = ''
     or p_receipt->>'ok' is distinct from 'true'
     or p_receipt->>'rollback_id' is distinct from p_rollback_id::text
     or p_receipt->>'outbox_id' is distinct from p_outbox_id::text then
    raise exception 'f27_correlated_terminal_receipt_required';
  end if;
  -- Drill execution records its server-built hash receipt atomically with the
  -- synthetic outbox terminal. Re-presenting that exact receipt is an
  -- idempotent readback, so a lost HTTP response can never strand the drill.
  if exists (
    select 1
    from public.track_b_team_rollback_intents i
    join public.track_b_team_rollbacks r on r.id = i.rollback_id
    where i.rollback_id = p_rollback_id
      and i.outbox_id = p_outbox_id
      and r.is_drill = true
      and i.terminal_receipt = p_receipt
  ) then
    return jsonb_build_object(
      'ok', true, 'type', 'f27_replay_terminal',
      'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
      'correlation_id', p_receipt->>'correlation_id',
      'is_drill', true, 'idempotent', true
    );
  end if;
  update public.track_b_team_rollback_intents i
  set terminal_receipt = p_receipt
  from public.track_b_team_rollbacks r, public.mirror_outbox o
  where i.rollback_id = p_rollback_id and i.outbox_id = p_outbox_id
    and r.id = i.rollback_id and r.state = 'open'
    and o.id = i.outbox_id
    and p_receipt->>'type' is not distinct from case
      when r.is_drill then 'f27_drill_replay_terminal'
      else 'linear_write_terminal'
    end
    and (r.is_drill = false or o.f27_drill_rollback_id = r.id)
    and (r.is_drill = false or o.linear_result->>'type' = 'f27_drill_replay_terminal')
    and i.classification = 'replay'
    and i.terminal_receipt is null
    and o.status = 'written'
    and o.linear_result is not null
    and p_receipt->>'dedup_key' is not distinct from o.dedup_key
    and p_receipt->>'operation' is not distinct from o.operation
    and p_receipt->>'correlation_id' is not distinct from o.linear_result->>'correlation_id'
    and p_receipt->>'linear_result_sha256' is not distinct from encode(
      extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
    and p_receipt->>'intent_snapshot_sha256' is not distinct from i.row_sha256;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'f27_terminal_receipt_refused'; end if;
  return jsonb_build_object(
    'ok', true, 'type', 'f27_replay_terminal',
    'rollback_id', p_rollback_id, 'outbox_id', p_outbox_id,
    'correlation_id', p_receipt->>'correlation_id',
    'is_drill', p_receipt->>'type' = 'f27_drill_replay_terminal'
  );
end;
$fn$;

create or replace function public.track_b_f27_finalize(
  p_rollback_id uuid,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.track_b_team_rollbacks%rowtype;
  v_is_drill boolean;
  v_authority jsonb;
  v_new_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_fence_generation bigint;
  v_unclassified integer;
  v_unreceipted integer;
  v_active integer;
  v_receipt jsonb;
  v_updated integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27-finalize:' || p_rollback_id::text, 0));
  select is_drill into v_is_drill
  from public.track_b_team_rollbacks
  where id = p_rollback_id and state = 'open';
  if not found then raise exception 'f27_open_rollback_required'; end if;
  -- A drill must prove that the real authority CAS refuses without taking the
  -- real-team table/flag/fence lock chain or attempting any authority write.
  if v_is_drill then raise exception 'f27_drill_authority_cas_refused'; end if;
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'f27_actor_required';
  end if;

  -- Global lock order for native writers, begin, and finalize is always:
  -- mirror_outbox table -> runtime flags -> team fence. A writer that passed
  -- Edge authorization either commits before this lock or reaches the trigger
  -- after the generation advances and fails closed.
  lock table public.mirror_outbox in share row exclusive mode;
  select * into v_case from public.track_b_team_rollbacks
    where id = p_rollback_id and state = 'open' and is_drill = false for update;
  if not found then raise exception 'f27_open_rollback_required'; end if;

  select value into v_authority from public.syncview_runtime_flags
    where key = 'prod_authority' for update;
  select value into v_outbound from public.syncview_runtime_flags
    where key = 'linear_outbound_enabled' for update;
  select value into v_parity from public.syncview_runtime_flags
    where key = 'linear_legacy_parity_enabled' for update;
  select generation into v_fence_generation
  from public.track_b_f27_team_fences
  where team = v_case.team
  for update;
  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from v_case.expected_authority then
    raise exception 'f27_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;
  if v_fence_generation is distinct from v_case.fence_generation then
    raise exception 'f27_authority_generation_cas_refused';
  end if;

  select count(*) into v_unclassified
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification is null;
  select count(*) into v_unreceipted
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id
    and classification = 'replay' and terminal_receipt is null;
  select count(*) into v_active
  from public.mirror_outbox
  where lower(team) = v_case.team
    and status in ('pending', 'failed', 'shadow_ok');
  if v_unclassified <> 0 or v_unreceipted <> 0 or v_active <> 0 then
    raise exception 'f27_team_not_zero: unclassified=%, unreceipted=%, active=%',
      v_unclassified, v_unreceipted, v_active;
  end if;

  v_new_authority := jsonb_set(v_authority, array[v_case.team], '"linear"'::jsonb, false);
  update public.syncview_runtime_flags
  set value = v_new_authority, updated_by = p_actor
  where key = 'prod_authority' and value = p_expected_authority;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_authority_update_refused'; end if;

  update public.track_b_f27_team_fences
  set generation = generation + 1,
      updated_at = now(),
      updated_by = p_actor
  where team = v_case.team and generation = v_case.fence_generation;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_authority_generation_update_refused'; end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'type', 'f27_rollback_terminal',
    'rollback_id', v_case.id,
    'correlation_id', v_case.correlation_id,
    'team', v_case.team,
    'snapshot_count', v_case.snapshot_count,
    'snapshot_sha256', v_case.snapshot_sha256,
    'unclassified', v_unclassified,
    'unreceipted_replays', v_unreceipted,
    'active_team_rows', v_active,
    'authority_before', v_authority,
    'authority_after', v_new_authority,
    'fence_generation_before', v_case.fence_generation,
    'fence_generation_after', v_case.fence_generation + 1,
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity
  );
  update public.track_b_team_rollbacks
  set state = 'complete', terminal_receipt = v_receipt, completed_at = now()
  where id = p_rollback_id and state = 'open';
  return v_receipt;
end;
$fn$;

create or replace function public.track_b_f27_finalize_drill(
  p_rollback_id uuid,
  p_expected_authority jsonb,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_case public.track_b_team_rollbacks%rowtype;
  v_authority jsonb;
  v_outbound jsonb;
  v_parity jsonb;
  v_unclassified integer;
  v_unreceipted integer;
  v_intent_count integer;
  v_replay_count integer;
  v_exact_terminal integer;
  v_active integer;
  v_receipt jsonb;
  v_updated integer;
begin
  if nullif(btrim(coalesce(p_actor, '')), '') is null then
    raise exception 'f27_actor_required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('track-b-f27-finalize:' || p_rollback_id::text, 0));
  select * into v_case
  from public.track_b_team_rollbacks
  where id = p_rollback_id
    and state = 'open'
    and is_drill = true
    and team = '__f27_drill__'
  for update;
  if not found then raise exception 'f27_open_drill_required'; end if;

  select
    (select value from public.syncview_runtime_flags where key = 'prod_authority'),
    (select value from public.syncview_runtime_flags where key = 'linear_outbound_enabled'),
    (select value from public.syncview_runtime_flags where key = 'linear_legacy_parity_enabled')
  into v_authority, v_outbound, v_parity;
  if v_authority is distinct from p_expected_authority
     or v_authority is distinct from v_case.expected_authority
     or v_authority is distinct from '{"video":"linear","graphics":"linear"}'::jsonb then
    raise exception 'f27_drill_authority_cas_refused';
  end if;
  if v_outbound is distinct from '{"mode":"off"}'::jsonb
     or v_parity is distinct from '{"enabled":false}'::jsonb then
    raise exception 'f27_emergency_stops_required';
  end if;

  -- Exercise the real finalizer inside this transaction. Its drill guard must
  -- be the reason no authority CAS is attempted; a string in the receipt is
  -- never accepted as proof by itself.
  begin
    perform public.track_b_f27_finalize(
      p_rollback_id,
      p_expected_authority,
      p_actor
    );
    raise exception 'f27_drill_authority_cas_unexpectedly_succeeded';
  exception when others then
    if sqlerrm <> 'f27_drill_authority_cas_refused' then raise; end if;
  end;

  select count(*) into v_intent_count
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id;
  select count(*) into v_unclassified
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification is null;
  select count(*) into v_unreceipted
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id
    and classification = 'replay' and terminal_receipt is null;
  select count(*) into v_replay_count
  from public.track_b_team_rollback_intents
  where rollback_id = p_rollback_id and classification = 'replay';
  select count(*) into v_exact_terminal
  from public.track_b_team_rollback_intents i
  join public.mirror_outbox o on o.id = i.outbox_id
  where i.rollback_id = p_rollback_id
    and i.classification = 'replay'
    and i.terminal_receipt->>'ok' = 'true'
    and i.terminal_receipt->>'type' = 'f27_drill_replay_terminal'
    and i.terminal_receipt->>'rollback_id' = p_rollback_id::text
    and i.terminal_receipt->>'outbox_id' = i.outbox_id::text
    and i.terminal_receipt->>'correlation_id' = v_case.correlation_id::text
    and i.terminal_receipt->>'dedup_key' = o.dedup_key
    and i.terminal_receipt->>'operation' = o.operation
    and i.terminal_receipt->>'intent_snapshot_sha256' = i.row_sha256
    and i.terminal_receipt->>'linear_result_sha256' = encode(
      extensions.digest(convert_to(o.linear_result::text, 'UTF8'), 'sha256'), 'hex'
    )
    and o.f27_drill_rollback_id = p_rollback_id
    and o.team = '__f27_drill__'
    and o.client_slug = '__f27_drill__'
    and o.test_only = true
    and o.legacy_parity = false
    and o.status = 'written'
    and o.linear_result->>'ok' = 'true'
    and o.linear_result->>'type' = 'f27_drill_replay_terminal'
    and o.linear_result->>'f27_drill' = 'true'
    and o.linear_result->>'no_external_call' = 'true'
    and o.linear_result->>'rollback_id' = p_rollback_id::text
    and o.linear_result->>'outbox_id' = i.outbox_id::text
    and o.linear_result->>'correlation_id' = v_case.correlation_id::text
    and o.linear_result->>'intent_snapshot_sha256' = i.row_sha256;
  select count(*) into v_active
  from public.mirror_outbox
  where f27_drill_rollback_id = p_rollback_id
    and team = '__f27_drill__'
    and status in ('pending', 'failed', 'shadow_ok');
  if v_case.snapshot_count <> 1
     or coalesce(v_case.snapshot_sha256, '') = ''
     or v_intent_count <> 1
     or v_replay_count <> 1
     or v_exact_terminal <> 1
     or v_unclassified <> 0
     or v_unreceipted <> 0
     or v_active <> 0 then
    raise exception 'f27_drill_not_zero: unclassified=%, unreceipted=%, active=%',
      v_unclassified, v_unreceipted, v_active;
  end if;

  v_receipt := jsonb_build_object(
    'ok', true,
    'type', 'f27_drill_terminal',
    'rollback_id', v_case.id,
    'correlation_id', v_case.correlation_id,
    'team', v_case.team,
    'is_drill', true,
    'snapshot_count', v_case.snapshot_count,
    'snapshot_sha256', v_case.snapshot_sha256,
    'unclassified', v_unclassified,
    'unreceipted_replays', v_unreceipted,
    'replay_intents', v_replay_count,
    'exact_terminal_replays', v_exact_terminal,
    'active_drill_rows', v_active,
    'authority_before', v_authority,
    'authority_after', v_authority,
    'authority_cas', 'refused',
    'authority_cas_reason', 'f27_drill_authority_cas_refused',
    'normal_outbound', v_outbound,
    'legacy_parity', v_parity,
    'audit_history_retained', true
  );
  update public.track_b_team_rollbacks
  set state = 'complete', terminal_receipt = v_receipt, completed_at = now()
  where id = p_rollback_id and state = 'open' and is_drill = true;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'f27_drill_finalize_cas_refused'; end if;
  return v_receipt;
end;
$fn$;

revoke all on table public.track_b_f27_team_fences from public, anon, authenticated, service_role;
revoke all on table public.track_b_team_rollbacks from public, anon, authenticated, service_role;
revoke all on table public.track_b_team_rollback_intents from public, anon, authenticated, service_role;
grant select on table public.track_b_f27_team_fences to service_role;
grant select on table public.track_b_team_rollbacks to service_role;
grant select on table public.track_b_team_rollback_intents to service_role;
revoke all on function public.track_b_f27_write_authorization(text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_requeue(bigint, bigint)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_begin(text, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_begin_drill(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_classify(uuid, bigint, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_execute_drill_replay(uuid, bigint, uuid)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_record_terminal(uuid, bigint, jsonb)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_finalize(uuid, jsonb, text)
  from public, anon, authenticated;
revoke all on function public.track_b_f27_finalize_drill(uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.track_b_f27_write_authorization(text) to service_role;
grant execute on function public.track_b_f27_requeue(bigint, bigint) to service_role;
grant execute on function public.track_b_f27_begin(text, jsonb, text) to service_role;
grant execute on function public.track_b_f27_begin_drill(jsonb, text) to service_role;
grant execute on function public.track_b_f27_classify(uuid, bigint, text, text, text, jsonb) to service_role;
grant execute on function public.track_b_f27_execute_drill_replay(uuid, bigint, uuid) to service_role;
grant execute on function public.track_b_f27_record_terminal(uuid, bigint, jsonb) to service_role;
grant execute on function public.track_b_f27_finalize(uuid, jsonb, text) to service_role;
grant execute on function public.track_b_f27_finalize_drill(uuid, jsonb, text) to service_role;

-- Exact-source install smoke: exercise the new enqueue function and trigger in
-- this migration transaction, then erase only the synthetic TEST row. Any
-- constraint/trigger regression aborts the entire migration before COMMIT.
savepoint f27_enqueue_probe;
select public.mirror_outbox_enqueue(
  'deliverable',
  'f27-migration-test',
  'status',
  jsonb_build_object(
    'status', 'F27 migration TEST',
    '_f27_authority_generation', (
      select generation from public.track_b_f27_team_fences where team = 'video'
    ),
    '_f27_legacy_parity', false
  ),
  'f27-migration-test:' || gen_random_uuid()::text,
  clock_timestamp(),
  'f27-migration-test',
  'video',
  'F27 migration TEST',
  'system',
  null,
  null,
  null,
  null,
  true
);
rollback to savepoint f27_enqueue_probe;
release savepoint f27_enqueue_probe;

commit;
