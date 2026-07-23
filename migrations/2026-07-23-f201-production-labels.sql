-- F201: allow guarded Production label intents in the existing B4 outbox.
--
-- DELIBERATE ADDITIVE-ONLY EXCEPTION (owner-approved): PostgreSQL cannot alter
-- a CHECK expression in place, so widening the named operation CHECK requires
-- dropping and re-adding that constraint. The replacement is a strict
-- superset: it keeps create, status, comment, due, assignee, title, priority,
-- parent, archive, and restore, and adds only labels. The replacement is
-- data-safe because it runs in one transaction, validates every existing row,
-- and performs no data drop, table/column drop, rename, type change, or
-- backfill.
--
-- This file is source-only until a separate post-merge, owner-approved live
-- window. It does not deploy production-write, run the real TEST labels drill,
-- change a runtime flag or authority, or touch n8n.

begin;

alter table public.mirror_outbox
  drop constraint if exists mirror_outbox_operation_b4_check;

alter table public.mirror_outbox
  add constraint mirror_outbox_operation_b4_check
  check (operation in (
    'create', 'status', 'comment', 'due', 'assignee', 'title',
    'priority', 'parent', 'archive', 'restore', 'labels'
  ));

-- Preserve the installed pre-F27 enqueue contract byte-for-byte in behavior;
-- only the operation allowlist is widened by labels.
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
    'priority', 'parent', 'archive', 'restore', 'labels'
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

commit;
