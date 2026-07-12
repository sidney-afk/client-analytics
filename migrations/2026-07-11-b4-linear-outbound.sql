-- Track B B4: durable SyncView -> Linear outbox.
--
-- Additive expansion of the empty B1 mirror_outbox placeholder. The existing
-- deliverable_write / batch_write RPCs already write deliverable_events in the
-- same transaction. An AFTER INSERT trigger turns only an explicit
-- p_event.outbound intent on a source='ui' event into an outbox row, preserving
-- atomicity without changing inbound/reconcile/backfill behavior.

begin;

alter table public.mirror_outbox
  alter column deliverable_id drop not null,
  add column if not exists entity text,
  add column if not exists entity_id text,
  add column if not exists batch_id text,
  add column if not exists comment_id text,
  add column if not exists operation text,
  add column if not exists client_slug text,
  add column if not exists team text,
  add column if not exists dedup_key text,
  add column if not exists source_edited_at timestamptz,
  add column if not exists status text default 'pending',
  add column if not exists linear_result jsonb,
  add column if not exists shadow_actual jsonb,
  add column if not exists actor text,
  add column if not exists role text,
  add column if not exists depends_on_id bigint,
  add column if not exists locked_at timestamptz,
  add column if not exists lock_token uuid,
  add column if not exists processed_at timestamptz,
  add column if not exists updated_at timestamptz default now(),
  add column if not exists test_only boolean not null default false;

update public.mirror_outbox o
set
  entity = coalesce(o.entity, 'deliverable'),
  entity_id = coalesce(o.entity_id, o.deliverable_id),
  operation = coalesce(
    o.operation,
    case o.op
      when 'update_state' then 'status'
      when 'update_fields' then 'title'
      when 'comment' then 'comment'
      when 'archive' then 'archive'
      else 'create'
    end
  ),
  client_slug = coalesce(o.client_slug, d.client_slug, '_unknown'),
  team = coalesce(o.team, d.team, 'unknown'),
  dedup_key = coalesce(o.dedup_key, 'legacy:' || o.id::text),
  source_edited_at = coalesce(o.source_edited_at, o.created_at),
  status = coalesce(o.status, 'pending'),
  updated_at = coalesce(o.updated_at, o.created_at)
from public.deliverables d
where d.id = o.deliverable_id;

-- Handles an empty queue and any legacy row whose deliverable has since gone.
update public.mirror_outbox
set
  entity = coalesce(entity, 'deliverable'),
  entity_id = coalesce(entity_id, deliverable_id, 'legacy:' || id::text),
  operation = coalesce(operation, 'create'),
  client_slug = coalesce(client_slug, '_unknown'),
  team = coalesce(team, 'unknown'),
  dedup_key = coalesce(dedup_key, 'legacy:' || id::text),
  source_edited_at = coalesce(source_edited_at, created_at),
  status = coalesce(status, 'pending'),
  updated_at = coalesce(updated_at, created_at);

alter table public.mirror_outbox
  alter column entity set not null,
  alter column entity_id set not null,
  alter column operation set not null,
  alter column client_slug set not null,
  alter column team set not null,
  alter column dedup_key set not null,
  alter column source_edited_at set not null,
  alter column status set not null,
  alter column updated_at set not null;

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_entity_b4_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_entity_b4_check
      check (entity in ('deliverable', 'batch', 'comment'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_operation_b4_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_operation_b4_check
      check (operation in (
        'create', 'status', 'comment', 'due', 'assignee', 'title',
        'priority', 'parent', 'archive', 'restore'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_status_b4_check'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_status_b4_check
      check (status in (
        'pending', 'shadow_ok', 'written', 'failed', 'skipped', 'stale'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mirror_outbox'::regclass
      and conname = 'mirror_outbox_depends_on_b4_fkey'
  ) then
    alter table public.mirror_outbox
      add constraint mirror_outbox_depends_on_b4_fkey
      foreign key (depends_on_id) references public.mirror_outbox(id);
  end if;
end
$block$;

create unique index if not exists mirror_outbox_dedup_key_idx
  on public.mirror_outbox (dedup_key);

create index if not exists mirror_outbox_status_retry_idx
  on public.mirror_outbox (status, next_retry_at, created_at);

create index if not exists mirror_outbox_team_status_idx
  on public.mirror_outbox (team, status, created_at);

create index if not exists mirror_outbox_entity_idx
  on public.mirror_outbox (entity, entity_id, created_at desc);

-- Summary events for the outbound edge must use source='outbound'.
alter table public.deliverable_events
  drop constraint if exists deliverable_events_source_check;
alter table public.deliverable_events
  add constraint deliverable_events_source_check
  check (source in ('ui', 'mirror', 'reconcile', 'backfill', 'system', 'outbound'));

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
begin
  if coalesce(p_entity, '') not in ('deliverable', 'batch', 'comment') then
    raise exception 'invalid outbound entity';
  end if;
  if coalesce(p_operation, '') not in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore'
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

  v_legacy_op := case p_operation
    when 'create' then 'create'
    when 'status' then 'update_state'
    when 'comment' then 'comment'
    when 'archive' then 'archive'
    else 'update_fields'
  end;

  insert into public.mirror_outbox (
    deliverable_id,
    op,
    payload,
    attempts,
    created_at,
    next_retry_at,
    entity,
    entity_id,
    batch_id,
    comment_id,
    operation,
    client_slug,
    team,
    dedup_key,
    source_edited_at,
    status,
    actor,
    role,
    depends_on_id,
    updated_at,
    test_only
  ) values (
    p_deliverable_id,
    v_legacy_op,
    coalesce(p_payload, '{}'::jsonb),
    0,
    now(),
    now(),
    p_entity,
    p_entity_id,
    p_batch_id,
    p_comment_id,
    p_operation,
    p_client_slug,
    p_team,
    p_dedup_key,
    p_source_edited_at,
    'pending',
    nullif(btrim(coalesce(p_actor, '')), ''),
    nullif(btrim(coalesce(p_role, '')), ''),
    p_depends_on_id,
    now(),
    coalesce(p_test_only, false)
  )
  on conflict (dedup_key) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from public.mirror_outbox
    where dedup_key = p_dedup_key;
  end if;

  return v_id;
end;
$fn$;

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
begin
  if new.source <> 'ui'
     or jsonb_typeof(new.payload->'outbound') <> 'object' then
    return new;
  end if;

  v_entity := coalesce(nullif(v_outbound->>'entity', ''), case when new.deliverable_id is null then 'batch' else 'deliverable' end);
  v_entity_id := coalesce(nullif(v_outbound->>'entity_id', ''), new.deliverable_id, new.batch_id);
  v_operation := nullif(v_outbound->>'operation', '');

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

  perform public.mirror_outbox_enqueue(
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

  return new;
end;
$fn$;

create or replace function public.mirror_outbox_quarantine_test_run(
  p_dedup_prefix text
) returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  if nullif(btrim(coalesce(p_dedup_prefix, '')), '') is null
     or p_dedup_prefix not like 'b4-%' then
    raise exception 'invalid B4 TEST prefix';
  end if;

  update public.mirror_outbox
  set status = 'skipped',
      last_error = coalesce(last_error, 'TEST fixture run quarantined before completion'),
      processed_at = now(),
      updated_at = now(),
      next_retry_at = null,
      lock_token = null,
      locked_at = null
  where test_only = true
    and client_slug = 'sidneylaruel'
    and dedup_key like p_dedup_prefix || ':%'
    and status in ('pending', 'failed', 'shadow_ok');
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

-- Edge runtimes can receive a service key representation that is not byte-equal
-- to the injected secret. Authenticate it through PostgREST without relying on
-- an RLS-filtered SELECT, which can return HTTP 200 with an empty result to anon.
create or replace function public.b4_service_role_probe()
returns boolean
language sql
stable
set search_path = public
as $fn$
  select true;
$fn$;

create or replace function public.mirror_outbox_requeue(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_count integer;
begin
  update public.mirror_outbox
  set status = 'pending',
      attempts = 0,
      last_error = null,
      processed_at = null,
      next_retry_at = now(),
      lock_token = null,
      locked_at = null,
      updated_at = now()
  where id = p_id
    and operation = 'comment'
    and status in ('written', 'skipped', 'failed', 'stale');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$fn$;

create or replace function public.deliverable_b4_comment_write(
  p_id text,
  p_comments text,
  p_base text,
  p_event jsonb
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_result public.deliverables%rowtype;
begin
  if nullif(btrim(coalesce(p_id, '')), '') is null or p_comments is null then
    raise exception 'incomplete deliverable comment write';
  end if;
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set comments = public._calmerge_comment_cell(d.comments, p_comments, coalesce(p_base, '')),
      updated_at = now()
  where d.id = p_id
  returning * into v_result;
  if v_result.id is null then raise exception 'deliverable not found'; end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id, v_result.batch_id, v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''), nullif(v_event->>'role', ''),
    coalesce(nullif(v_event->>'action', ''), 'comment_change'),
    v_result.status, v_result.status,
    coalesce(nullif(v_event->>'source', ''), 'ui'), v_event
  );
  return v_result;
end;
$fn$;

create or replace function public.batch_b4_comment_write(
  p_id text,
  p_comments text,
  p_base text,
  p_event jsonb
) returns public.batches
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_result public.batches%rowtype;
begin
  if nullif(btrim(coalesce(p_id, '')), '') is null or p_comments is null then
    raise exception 'incomplete batch comment write';
  end if;
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set comments = public._calmerge_comment_cell(b.comments, p_comments, coalesce(p_base, '')),
      updated_at = now()
  where b.id = p_id
  returning * into v_result;
  if v_result.id is null then raise exception 'batch not found'; end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    null, v_result.id, v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''), nullif(v_event->>'role', ''),
    coalesce(nullif(v_event->>'action', ''), 'comment_change'),
    v_result.status, v_result.status,
    coalesce(nullif(v_event->>'source', ''), 'ui'), v_event
  );
  return v_result;
end;
$fn$;

drop trigger if exists track_b_outbound_intent_after on public.deliverable_events;
create trigger track_b_outbound_intent_after
  after insert on public.deliverable_events
  for each row execute function public.track_b_enqueue_outbound_intent();

revoke all on function public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamptz, text, text,
  text, text, text, text, text, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.mirror_outbox_enqueue(
  text, text, text, jsonb, text, timestamptz, text, text,
  text, text, text, text, text, bigint, boolean
) to service_role;
revoke all on function public.mirror_outbox_quarantine_test_run(text)
  from public, anon, authenticated;
grant execute on function public.mirror_outbox_quarantine_test_run(text)
  to service_role;
revoke all on function public.b4_service_role_probe()
  from public, anon, authenticated;
grant execute on function public.b4_service_role_probe()
  to service_role;
revoke all on function public.mirror_outbox_requeue(bigint)
  from public, anon, authenticated;
grant execute on function public.mirror_outbox_requeue(bigint)
  to service_role;
revoke all on function public.deliverable_b4_comment_write(text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.batch_b4_comment_write(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.deliverable_b4_comment_write(text, text, text, jsonb)
  to service_role;
grant execute on function public.batch_b4_comment_write(text, text, text, jsonb)
  to service_role;

insert into public.syncview_runtime_flags (key, value, updated_by)
values (
  'linear_outbound_enabled',
  '{"mode":"off"}'::jsonb,
  'b4-linear-outbound-migration'
)
on conflict (key) do nothing;

commit;
