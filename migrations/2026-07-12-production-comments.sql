-- Native Production comments, including complete Linear history.
--
-- The base table is deliberately NOT anon-readable. The existing Production
-- tables predate body-bearing history and use permissive anon SELECT policies;
-- copying that pattern here would expose internal comment bodies through the
-- public browser key. Browser reads go through the staff-authenticated
-- production-comments Edge Function instead.

begin;

create extension if not exists pgcrypto;

create table if not exists public.production_comments (
  id text primary key,
  idempotency_key text not null,
  native_comment_id text,

  -- Exactly one native target when mapped. Historical Linear comments may be
  -- retained before a native batch/deliverable exists, provided the Linear
  -- issue UUID is present.
  deliverable_id text references public.deliverables(id),
  batch_id text references public.batches(id),
  -- Unmapped archived Linear issues can outlive the native client row. Mapped
  -- targets are derived from their real FK; this snapshot remains nullable and
  -- intentionally does not reject otherwise valid retained history.
  client_slug text,
  team text not null check (team in ('video', 'graphics')),
  linear_issue_uuid text,
  linear_identifier text,
  linear_comment_id text,

  -- Native and Linear thread identities are both retained. Native foreign keys
  -- can be linked in a later backfill pass without discarding Linear ancestry.
  parent_id text references public.production_comments(id)
    deferrable initially deferred,
  thread_root_id text references public.production_comments(id)
    deferrable initially deferred,
  linear_parent_comment_id text,
  linear_thread_root_id text,

  author_key text not null,
  author_member_id uuid references public.team_members(id),
  linear_author_id text,
  author_name text not null,
  role text not null,
  transport_actor text,
  transport_role text,
  transport_linear_user_id text,

  body text not null default '',
  body_format text not null default 'markdown'
    check (body_format in ('markdown', 'plain')),
  attachments jsonb not null default '[]'::jsonb
    check (jsonb_typeof(attachments) = 'array'),
  audience text not null default 'internal'
    check (audience in ('internal', 'client')),
  component text,
  is_tweak boolean not null default false,
  round integer check (round is null or round > 0),

  origin text not null default 'native'
    check (origin in ('native', 'linear', 'legacy', 'bridge')),
  source text not null default 'ui'
    check (source in ('ui', 'mirror', 'backfill', 'system')),
  source_created_at timestamptz,
  source_updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by_key text,
  deleted_by_name text,
  resolved_at timestamptz,
  resolved_by_key text,
  resolved_by_name text,
  version integer not null default 1 check (version > 0),

  import_run_id text,
  backfill_tag text,
  provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ingested_at timestamptz not null default now(),

  constraint production_comments_target_check check (
    (deliverable_id is not null and batch_id is null)
    or (deliverable_id is null and batch_id is not null)
    or (
      deliverable_id is null
      and batch_id is null
      and nullif(btrim(coalesce(linear_issue_uuid, '')), '') is not null
    )
  ),
  constraint production_comments_id_shape_check check (
    id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'
  ),
  constraint production_comments_idempotency_key_check check (
    nullif(btrim(idempotency_key), '') is not null
    and length(idempotency_key) <= 240
  ),
  constraint production_comments_author_key_check check (
    nullif(btrim(author_key), '') is not null
  ),
  constraint production_comments_no_self_parent_check check (
    parent_id is null or parent_id <> id
  )
);

create unique index if not exists production_comments_idempotency_key_idx
  on public.production_comments (idempotency_key);

create unique index if not exists production_comments_linear_comment_idx
  on public.production_comments (linear_comment_id)
  where linear_comment_id is not null;

create unique index if not exists production_comments_native_comment_idx
  on public.production_comments (native_comment_id)
  where native_comment_id is not null;

create index if not exists production_comments_deliverable_created_idx
  on public.production_comments (deliverable_id, created_at desc, id desc)
  where deliverable_id is not null;

create index if not exists production_comments_batch_created_idx
  on public.production_comments (batch_id, created_at desc, id desc)
  where batch_id is not null;

create index if not exists production_comments_linear_issue_created_idx
  on public.production_comments (linear_issue_uuid, created_at desc, id desc)
  where linear_issue_uuid is not null;

create index if not exists production_comments_thread_created_idx
  on public.production_comments (thread_root_id, created_at, id)
  where thread_root_id is not null;

create index if not exists production_comments_client_updated_idx
  on public.production_comments (client_slug, updated_at desc);

create index if not exists production_comments_import_run_idx
  on public.production_comments (import_run_id, id)
  where import_run_id is not null;

alter table public.production_comments enable row level security;
revoke all on table public.production_comments from public, anon, authenticated;
grant select, insert, update, delete on table public.production_comments to service_role;

-- New self-contained comment events receive a deterministic key. The column is
-- nullable so every existing ledger writer and historical row remains valid.
alter table public.deliverable_events
  add column if not exists event_key text;

create unique index if not exists deliverable_events_event_key_unique_idx
  on public.deliverable_events (event_key)
  where event_key is not null;

-- deliverable_events is otherwise anon-readable. This restrictive policy keeps
-- the new body-bearing snapshots behind the protected reader without changing
-- visibility of existing non-comment activity rows.
drop policy if exists "protect production comment event bodies"
  on public.deliverable_events;
create policy "protect production comment event bodies"
  on public.deliverable_events
  as restrictive
  for select
  to anon, authenticated
  using (
    event_key is null
    or action not in (
      'comment_add', 'comment_edit', 'comment_delete', 'comment_resolve',
      'comment_unresolve', 'comment_link_linear', 'comment_link_native'
    )
  );

create or replace function public.production_comment_upsert(
  p_comment jsonb,
  p_event jsonb default '{}'::jsonb
) returns public.production_comments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_input jsonb := coalesce(p_comment, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_requested_id text := nullif(btrim(v_input->>'id'), '');
  v_id text := v_requested_id;
  v_idempotency_key text := nullif(btrim(v_input->>'idempotency_key'), '');
  v_native_comment_id text := nullif(btrim(v_input->>'native_comment_id'), '');
  v_linear_comment_id text := nullif(btrim(v_input->>'linear_comment_id'), '');
  v_linear_issue_uuid text := nullif(btrim(v_input->>'linear_issue_uuid'), '');
  v_deliverable_id text := nullif(btrim(v_input->>'deliverable_id'), '');
  v_batch_id text := nullif(btrim(v_input->>'batch_id'), '');
  v_client_slug text;
  v_team text;
  v_event_batch_id text;
  v_parent_id text;
  v_thread_root_id text;
  v_audience text;
  v_operation text := lower(coalesce(
    nullif(v_input->>'operation', ''),
    nullif(v_event->>'operation', ''),
    'upsert'
  ));
  v_source_updated_at timestamptz := coalesce(
    nullif(v_input->>'source_updated_at', '')::timestamptz,
    nullif(v_input->>'updated_at', '')::timestamptz,
    now()
  );
  v_source_created_at timestamptz := coalesce(
    nullif(v_input->>'source_created_at', '')::timestamptz,
    nullif(v_input->>'created_at', '')::timestamptz,
    v_source_updated_at
  );
  v_existing public.production_comments%rowtype;
  v_parent public.production_comments%rowtype;
  v_result public.production_comments%rowtype;
  v_has_existing boolean := false;
  v_changed boolean := false;
  v_event_action text;
  v_event_key text;
  v_event_payload jsonb;
begin
  -- Transitional callers may use the inventory/spec field names. Normalize
  -- them once here so the stored schema remains canonical.
  if not (v_input ? 'linear_identifier') and v_input ? 'linear_issue_identifier' then
    v_input := jsonb_set(v_input, '{linear_identifier}', v_input->'linear_issue_identifier', true);
  end if;
  if not (v_input ? 'role') and v_input ? 'author_role' then
    v_input := jsonb_set(v_input, '{role}', v_input->'author_role', true);
  end if;
  if not (v_input ? 'transport_actor') and v_input ? 'transport_author_name' then
    v_input := jsonb_set(v_input, '{transport_actor}', v_input->'transport_author_name', true);
  end if;
  if lower(coalesce(v_input->>'source', '')) = 'linear_inbound' then
    v_input := jsonb_set(v_input, '{source}', '"mirror"'::jsonb, true);
  end if;
  if lower(coalesce(v_event->>'source', '')) = 'linear_inbound' then
    v_event := jsonb_set(v_event, '{source}', '"mirror"'::jsonb, true);
  end if;
  v_operation := case v_operation
    when 'create' then 'add'
    when 'update' then 'edit'
    when 'remove' then 'delete'
    else v_operation
  end;

  if v_operation not in (
    'add', 'edit', 'delete', 'resolve', 'unresolve', 'upsert',
    'link_linear', 'link_native'
  ) then
    raise exception 'unsupported production comment operation';
  end if;

  if v_id is null and v_native_comment_id is not null then
    v_id := v_native_comment_id;
  end if;
  if v_id is null and v_linear_comment_id is not null then
    v_id := 'pc_lin_' || encode(digest(v_linear_comment_id, 'sha256'), 'hex');
  end if;
  if v_id is null then
    raise exception 'production comment id required';
  end if;
  if v_idempotency_key is null then
    v_idempotency_key := case
      when v_linear_comment_id is not null then 'linear:' || v_linear_comment_id
      else 'native:' || v_id
    end;
  end if;
  if v_native_comment_id is null and coalesce(nullif(lower(v_input->>'origin'), ''), 'native') = 'native' then
    v_native_comment_id := v_id;
  end if;

  select c.* into v_existing
  from public.production_comments c
  where c.id = v_id
  for update;
  v_has_existing := found;

  if not v_has_existing and v_linear_comment_id is not null then
    select c.* into v_existing
    from public.production_comments c
    where c.linear_comment_id = v_linear_comment_id
    for update;
    v_has_existing := found;
  end if;

  if not v_has_existing and v_native_comment_id is not null then
    select c.* into v_existing
    from public.production_comments c
    where c.native_comment_id = v_native_comment_id
    for update;
    v_has_existing := found;
  end if;

  if not v_has_existing then
    select c.* into v_existing
    from public.production_comments c
    where c.idempotency_key = v_idempotency_key
    for update;
    v_has_existing := found;
  end if;

  if v_has_existing then
    v_id := v_existing.id;
    if v_existing.deliverable_id is not null or v_existing.batch_id is not null then
      if v_input ? 'deliverable_id'
         and nullif(btrim(v_input->>'deliverable_id'), '') is distinct from v_existing.deliverable_id then
        raise exception 'production comment deliverable cannot be changed';
      end if;
      if v_input ? 'batch_id'
         and nullif(btrim(v_input->>'batch_id'), '') is distinct from v_existing.batch_id then
        raise exception 'production comment batch cannot be changed';
      end if;
    end if;
    v_deliverable_id := coalesce(v_existing.deliverable_id, v_deliverable_id);
    v_batch_id := coalesce(v_existing.batch_id, v_batch_id);
    v_native_comment_id := coalesce(v_native_comment_id, v_existing.native_comment_id);
    v_linear_issue_uuid := coalesce(v_linear_issue_uuid, v_existing.linear_issue_uuid);

    if not (v_input ? 'source_updated_at') and not (v_input ? 'updated_at') then
      v_source_updated_at := v_existing.source_updated_at;
    end if;
    if not (v_input ? 'source_created_at') and not (v_input ? 'created_at') then
      v_source_created_at := coalesce(v_existing.source_created_at, v_existing.created_at);
    end if;

    -- Webhook replays older than the stored source clock are successful no-ops.
    if v_source_updated_at < v_existing.source_updated_at then
      return v_existing;
    end if;
  end if;

  if v_deliverable_id is not null and v_batch_id is not null then
    raise exception 'production comment must have exactly one native target';
  elsif v_deliverable_id is not null then
    select d.client_slug, d.team, d.batch_id
      into v_client_slug, v_team, v_event_batch_id
    from public.deliverables d
    where d.id = v_deliverable_id;
    if not found then raise exception 'production comment deliverable not found'; end if;
  elsif v_batch_id is not null then
    select b.client_slug, coalesce(
      case when b.team in ('video', 'graphics') then b.team end,
      nullif(lower(btrim(v_input->>'team')), '')
    )
      into v_client_slug, v_team
    from public.batches b
    where b.id = v_batch_id;
    if not found then raise exception 'production comment batch not found'; end if;
    if v_team is null or v_team not in ('video', 'graphics') then
      raise exception 'production comment batch requires VID/GRA issue team';
    end if;
    v_event_batch_id := v_batch_id;
  else
    if v_linear_issue_uuid is null then
      raise exception 'unmapped production comment requires linear issue uuid';
    end if;
    v_client_slug := coalesce(
      nullif(btrim(v_input->>'client_slug'), ''),
      case when v_has_existing then v_existing.client_slug else null end
    );
    v_team := lower(coalesce(
      nullif(btrim(v_input->>'team'), ''),
      case when v_has_existing then v_existing.team else null end
    ));
    if v_team is null or v_team not in ('video', 'graphics') then
      raise exception 'unmapped production comment requires VID/GRA team';
    end if;
  end if;

  v_parent_id := coalesce(
    case when v_input ? 'parent_id' then nullif(btrim(v_input->>'parent_id'), '') end,
    case when v_has_existing then v_existing.parent_id else null end
  );
  v_thread_root_id := coalesce(
    case when v_input ? 'thread_root_id' then nullif(btrim(v_input->>'thread_root_id'), '') end,
    case when v_has_existing then v_existing.thread_root_id else null end
  );
  v_audience := lower(coalesce(
    nullif(v_input->>'audience', ''),
    case when v_has_existing then v_existing.audience else null end,
    'internal'
  ));

  if v_parent_id is not null then
    select c.* into v_parent
    from public.production_comments c
    where c.id = v_parent_id;
    if not found and (
      nullif(btrim(v_input->>'linear_parent_comment_id'), '') is not null
      or v_parent_id like 'linear:%'
    ) then
      -- A paged Linear import may see a reply before its native parent row.
      -- Preserve external ancestry now and link the native FK in a later pass.
      if not (v_input ? 'linear_parent_comment_id') and v_parent_id like 'linear:%' then
        v_input := jsonb_set(
          v_input,
          '{linear_parent_comment_id}',
          to_jsonb(substring(v_parent_id from length('linear:') + 1)),
          true
        );
      end if;
      v_parent_id := null;
    elsif not found then
      raise exception 'production comment parent not found';
    end if;
  end if;

  if v_parent_id is not null then
    if v_parent.deliverable_id is distinct from v_deliverable_id
       or v_parent.batch_id is distinct from v_batch_id
       or (
         v_deliverable_id is null
         and v_batch_id is null
         and v_parent.linear_issue_uuid is distinct from v_linear_issue_uuid
       ) then
      raise exception 'production comment parent belongs to a different thread target';
    end if;
    v_thread_root_id := coalesce(v_parent.thread_root_id, v_parent.id);
    v_audience := v_parent.audience;
  else
    if v_thread_root_id is not null and v_thread_root_id <> v_id then
      perform 1 from public.production_comments c where c.id = v_thread_root_id;
      if not found and (
        nullif(btrim(v_input->>'linear_thread_root_id'), '') is not null
        or v_thread_root_id like 'linear:%'
      ) then
        if not (v_input ? 'linear_thread_root_id') and v_thread_root_id like 'linear:%' then
          v_input := jsonb_set(
            v_input,
            '{linear_thread_root_id}',
            to_jsonb(substring(v_thread_root_id from length('linear:') + 1)),
            true
          );
        end if;
        v_thread_root_id := null;
      elsif not found then
        raise exception 'production comment thread root not found';
      end if;
    end if;
    if v_thread_root_id is null then v_thread_root_id := v_id; end if;
  end if;

  if v_audience not in ('internal', 'client') then
    raise exception 'invalid production comment audience';
  end if;

  if not v_has_existing then
    if nullif(btrim(coalesce(v_input->>'author_key', '')), '') is null
       or nullif(btrim(coalesce(v_input->>'author_name', '')), '') is null
       or nullif(btrim(coalesce(v_input->>'role', '')), '') is null then
      raise exception 'production comment author snapshot required';
    end if;
    if v_operation not in ('delete', 'upsert')
       and nullif(btrim(coalesce(v_input->>'body', '')), '') is null then
      raise exception 'production comment body required';
    end if;

    if v_operation = 'delete' and not (v_input ? 'deleted_at') then
      v_input := jsonb_set(v_input, '{deleted_at}', to_jsonb(v_source_updated_at::text), true);
    elsif v_operation = 'resolve' and not (v_input ? 'resolved_at') then
      v_input := jsonb_set(v_input, '{resolved_at}', to_jsonb(v_source_updated_at::text), true);
    end if;

    insert into public.production_comments (
      id, idempotency_key, native_comment_id,
      deliverable_id, batch_id, client_slug, team,
      linear_issue_uuid, linear_identifier, linear_comment_id,
      parent_id, thread_root_id, linear_parent_comment_id, linear_thread_root_id,
      author_key, author_member_id, linear_author_id, author_name, role,
      transport_actor, transport_role, transport_linear_user_id,
      body, body_format, attachments, audience,
      component, is_tweak, round, origin, source, source_created_at,
      source_updated_at, edited_at, deleted_at, deleted_by_key, deleted_by_name,
      resolved_at, resolved_by_key, resolved_by_name, version, import_run_id,
      backfill_tag, provenance, created_at, updated_at, ingested_at
    ) values (
      v_id, v_idempotency_key, v_native_comment_id,
      v_deliverable_id, v_batch_id, v_client_slug, v_team,
      v_linear_issue_uuid, nullif(btrim(v_input->>'linear_identifier'), ''),
      v_linear_comment_id, v_parent_id, v_thread_root_id,
      nullif(btrim(v_input->>'linear_parent_comment_id'), ''),
      nullif(btrim(v_input->>'linear_thread_root_id'), ''),
      btrim(v_input->>'author_key'), nullif(v_input->>'author_member_id', '')::uuid,
      nullif(btrim(v_input->>'linear_author_id'), ''), btrim(v_input->>'author_name'),
      btrim(v_input->>'role'),
      coalesce(nullif(btrim(v_input->>'transport_actor'), ''), nullif(btrim(v_event->>'actor'), '')),
      coalesce(nullif(btrim(v_input->>'transport_role'), ''), nullif(btrim(v_event->>'role'), '')),
      nullif(btrim(v_input->>'transport_linear_user_id'), ''),
      coalesce(v_input->>'body', ''), coalesce(nullif(v_input->>'body_format', ''), 'markdown'),
      coalesce(v_input->'attachments', '[]'::jsonb), v_audience,
      nullif(btrim(v_input->>'component'), ''), coalesce((v_input->>'is_tweak')::boolean, false),
      nullif(v_input->>'round', '')::integer,
      coalesce(nullif(lower(v_input->>'origin'), ''), 'native'),
      coalesce(nullif(lower(v_input->>'source'), ''), nullif(lower(v_event->>'source'), ''), 'ui'),
      v_source_created_at, v_source_updated_at,
      nullif(v_input->>'edited_at', '')::timestamptz,
      nullif(v_input->>'deleted_at', '')::timestamptz,
      nullif(btrim(v_input->>'deleted_by_key'), ''), nullif(btrim(v_input->>'deleted_by_name'), ''),
      nullif(v_input->>'resolved_at', '')::timestamptz,
      nullif(btrim(v_input->>'resolved_by_key'), ''), nullif(btrim(v_input->>'resolved_by_name'), ''),
      greatest(coalesce(nullif(v_input->>'version', '')::integer, 1), 1),
      nullif(btrim(v_input->>'import_run_id'), ''), nullif(btrim(v_input->>'backfill_tag'), ''),
      coalesce(v_input->'provenance', '{}'::jsonb),
      coalesce(nullif(v_input->>'created_at', '')::timestamptz, v_source_created_at),
      now(), now()
    )
    on conflict do nothing
    returning * into v_result;
    if not found then
      -- A concurrent webhook/backfill retry may win after the identity reads
      -- above. Treat the committed unique identity as the idempotent result.
      select c.* into v_result
      from public.production_comments c
      where c.idempotency_key = v_idempotency_key
         or c.id = v_id
         or (v_linear_comment_id is not null and c.linear_comment_id = v_linear_comment_id)
         or (v_native_comment_id is not null and c.native_comment_id = v_native_comment_id)
      order by case when c.idempotency_key = v_idempotency_key then 0 else 1 end
      limit 1;
      if not found then raise exception 'production comment identity conflict'; end if;
      return v_result;
    end if;
    v_changed := true;
  else
    v_changed :=
      v_source_updated_at > v_existing.source_updated_at
      or v_deliverable_id is distinct from v_existing.deliverable_id
      or v_batch_id is distinct from v_existing.batch_id
      or v_client_slug is distinct from v_existing.client_slug
      or v_team is distinct from v_existing.team
      or v_linear_issue_uuid is distinct from v_existing.linear_issue_uuid
      or (v_input ? 'native_comment_id' and v_native_comment_id is distinct from v_existing.native_comment_id)
      or (v_input ? 'body' and (v_input->>'body') is distinct from v_existing.body)
      or (v_input ? 'body_format' and (v_input->>'body_format') is distinct from v_existing.body_format)
      or (v_input ? 'attachments' and (v_input->'attachments') is distinct from v_existing.attachments)
      or (v_input ? 'linear_comment_id' and v_linear_comment_id is distinct from v_existing.linear_comment_id)
      or (v_input ? 'linear_identifier' and nullif(v_input->>'linear_identifier', '') is distinct from v_existing.linear_identifier)
      or (v_input ? 'parent_id' and v_parent_id is distinct from v_existing.parent_id)
      or (v_input ? 'thread_root_id' and v_thread_root_id is distinct from v_existing.thread_root_id)
      or (v_input ? 'linear_parent_comment_id' and nullif(v_input->>'linear_parent_comment_id', '') is distinct from v_existing.linear_parent_comment_id)
      or (v_input ? 'linear_thread_root_id' and nullif(v_input->>'linear_thread_root_id', '') is distinct from v_existing.linear_thread_root_id)
      or (v_input ? 'author_key' and nullif(v_input->>'author_key', '') is distinct from v_existing.author_key)
      or (v_input ? 'author_member_id' and nullif(v_input->>'author_member_id', '')::uuid is distinct from v_existing.author_member_id)
      or (v_input ? 'linear_author_id' and nullif(v_input->>'linear_author_id', '') is distinct from v_existing.linear_author_id)
      or (v_input ? 'author_name' and nullif(v_input->>'author_name', '') is distinct from v_existing.author_name)
      or (v_input ? 'role' and nullif(v_input->>'role', '') is distinct from v_existing.role)
      or (v_input ? 'transport_actor' and nullif(v_input->>'transport_actor', '') is distinct from v_existing.transport_actor)
      or (v_input ? 'transport_role' and nullif(v_input->>'transport_role', '') is distinct from v_existing.transport_role)
      or (v_input ? 'transport_linear_user_id' and nullif(v_input->>'transport_linear_user_id', '') is distinct from v_existing.transport_linear_user_id)
      or (v_input ? 'audience' and v_audience is distinct from v_existing.audience)
      or (v_input ? 'component' and nullif(v_input->>'component', '') is distinct from v_existing.component)
      or (v_input ? 'is_tweak' and coalesce((v_input->>'is_tweak')::boolean, false) is distinct from v_existing.is_tweak)
      or (v_input ? 'round' and nullif(v_input->>'round', '')::integer is distinct from v_existing.round)
      or (v_input ? 'origin' and nullif(lower(v_input->>'origin'), '') is distinct from v_existing.origin)
      or (v_input ? 'source' and nullif(lower(v_input->>'source'), '') is distinct from v_existing.source)
      or (v_input ? 'edited_at' and nullif(v_input->>'edited_at', '')::timestamptz is distinct from v_existing.edited_at)
      or (v_input ? 'deleted_at' and nullif(v_input->>'deleted_at', '')::timestamptz is distinct from v_existing.deleted_at)
      or (v_input ? 'deleted_by_key' and nullif(v_input->>'deleted_by_key', '') is distinct from v_existing.deleted_by_key)
      or (v_input ? 'deleted_by_name' and nullif(v_input->>'deleted_by_name', '') is distinct from v_existing.deleted_by_name)
      or (v_input ? 'resolved_at' and nullif(v_input->>'resolved_at', '')::timestamptz is distinct from v_existing.resolved_at)
      or (v_input ? 'resolved_by_key' and nullif(v_input->>'resolved_by_key', '') is distinct from v_existing.resolved_by_key)
      or (v_input ? 'resolved_by_name' and nullif(v_input->>'resolved_by_name', '') is distinct from v_existing.resolved_by_name)
      or (v_input ? 'import_run_id' and nullif(v_input->>'import_run_id', '') is distinct from v_existing.import_run_id)
      or (v_input ? 'backfill_tag' and nullif(v_input->>'backfill_tag', '') is distinct from v_existing.backfill_tag)
      or (v_input ? 'provenance' and (v_existing.provenance || coalesce(v_input->'provenance', '{}'::jsonb)) is distinct from v_existing.provenance);

    if v_operation = 'delete' and not (v_input ? 'deleted_at') then
      v_input := jsonb_set(v_input, '{deleted_at}', to_jsonb(v_source_updated_at::text), true);
      v_changed := v_changed or v_existing.deleted_at is distinct from v_source_updated_at;
    elsif v_operation = 'resolve' and not (v_input ? 'resolved_at') then
      v_input := jsonb_set(v_input, '{resolved_at}', to_jsonb(v_source_updated_at::text), true);
      v_changed := v_changed or v_existing.resolved_at is distinct from v_source_updated_at;
    elsif v_operation = 'unresolve' then
      v_input := jsonb_set(v_input, '{resolved_at}', 'null'::jsonb, true);
      v_changed := v_changed or v_existing.resolved_at is not null;
    end if;

    if not v_changed then
      return v_existing;
    end if;

    update public.production_comments c
    set native_comment_id = case when v_input ? 'native_comment_id' then v_native_comment_id else c.native_comment_id end,
        deliverable_id = v_deliverable_id,
        batch_id = v_batch_id,
        client_slug = v_client_slug,
        team = v_team,
        linear_issue_uuid = coalesce(v_linear_issue_uuid, c.linear_issue_uuid),
        linear_identifier = case when v_input ? 'linear_identifier' then nullif(btrim(v_input->>'linear_identifier'), '') else c.linear_identifier end,
        linear_comment_id = case when v_input ? 'linear_comment_id' then v_linear_comment_id else c.linear_comment_id end,
        parent_id = v_parent_id,
        thread_root_id = v_thread_root_id,
        linear_parent_comment_id = case when v_input ? 'linear_parent_comment_id' then nullif(btrim(v_input->>'linear_parent_comment_id'), '') else c.linear_parent_comment_id end,
        linear_thread_root_id = case when v_input ? 'linear_thread_root_id' then nullif(btrim(v_input->>'linear_thread_root_id'), '') else c.linear_thread_root_id end,
        author_key = case when v_input ? 'author_key' then nullif(btrim(v_input->>'author_key'), '') else c.author_key end,
        author_member_id = case when v_input ? 'author_member_id' then nullif(v_input->>'author_member_id', '')::uuid else c.author_member_id end,
        linear_author_id = case when v_input ? 'linear_author_id' then nullif(btrim(v_input->>'linear_author_id'), '') else c.linear_author_id end,
        author_name = case when v_input ? 'author_name' then nullif(btrim(v_input->>'author_name'), '') else c.author_name end,
        role = case when v_input ? 'role' then nullif(btrim(v_input->>'role'), '') else c.role end,
        transport_actor = coalesce(nullif(btrim(v_input->>'transport_actor'), ''), nullif(btrim(v_event->>'actor'), ''), c.transport_actor),
        transport_role = coalesce(nullif(btrim(v_input->>'transport_role'), ''), nullif(btrim(v_event->>'role'), ''), c.transport_role),
        transport_linear_user_id = case when v_input ? 'transport_linear_user_id' then nullif(btrim(v_input->>'transport_linear_user_id'), '') else c.transport_linear_user_id end,
        body = case when v_input ? 'body' then coalesce(v_input->>'body', '') else c.body end,
        body_format = case when v_input ? 'body_format' then coalesce(nullif(v_input->>'body_format', ''), c.body_format) else c.body_format end,
        attachments = case when v_input ? 'attachments' then coalesce(v_input->'attachments', '[]'::jsonb) else c.attachments end,
        audience = v_audience,
        component = case when v_input ? 'component' then nullif(btrim(v_input->>'component'), '') else c.component end,
        is_tweak = case when v_input ? 'is_tweak' then coalesce((v_input->>'is_tweak')::boolean, false) else c.is_tweak end,
        round = case when v_input ? 'round' then nullif(v_input->>'round', '')::integer else c.round end,
        origin = case when v_input ? 'origin' then lower(v_input->>'origin') else c.origin end,
        source = case when v_input ? 'source' then lower(v_input->>'source') else c.source end,
        source_created_at = case when v_input ? 'source_created_at' then v_source_created_at else c.source_created_at end,
        source_updated_at = greatest(c.source_updated_at, v_source_updated_at),
        edited_at = case
          when v_input ? 'edited_at' then nullif(v_input->>'edited_at', '')::timestamptz
          when v_input ? 'body' and (v_input->>'body') is distinct from c.body then v_source_updated_at
          else c.edited_at
        end,
        deleted_at = case when v_input ? 'deleted_at' then nullif(v_input->>'deleted_at', '')::timestamptz else c.deleted_at end,
        deleted_by_key = case when v_input ? 'deleted_by_key' then nullif(btrim(v_input->>'deleted_by_key'), '') else c.deleted_by_key end,
        deleted_by_name = case when v_input ? 'deleted_by_name' then nullif(btrim(v_input->>'deleted_by_name'), '') else c.deleted_by_name end,
        resolved_at = case when v_input ? 'resolved_at' then nullif(v_input->>'resolved_at', '')::timestamptz else c.resolved_at end,
        resolved_by_key = case when v_input ? 'resolved_by_key' then nullif(btrim(v_input->>'resolved_by_key'), '') else c.resolved_by_key end,
        resolved_by_name = case when v_input ? 'resolved_by_name' then nullif(btrim(v_input->>'resolved_by_name'), '') else c.resolved_by_name end,
        version = c.version + 1,
        import_run_id = case when v_input ? 'import_run_id' then nullif(btrim(v_input->>'import_run_id'), '') else c.import_run_id end,
        backfill_tag = case when v_input ? 'backfill_tag' then nullif(btrim(v_input->>'backfill_tag'), '') else c.backfill_tag end,
        provenance = c.provenance || coalesce(v_input->'provenance', '{}'::jsonb),
        updated_at = now()
    where c.id = v_existing.id
    returning * into v_result;
  end if;

  if v_deliverable_id is not null or v_batch_id is not null then
    v_event_action := case
      when v_operation = 'delete'
        or (not v_has_existing and v_result.deleted_at is not null)
        or (v_has_existing and v_existing.deleted_at is null and v_result.deleted_at is not null)
        then 'comment_delete'
      when v_operation = 'unresolve' then 'comment_unresolve'
      when v_operation = 'resolve'
        or (not v_has_existing and v_result.resolved_at is not null)
        or (v_has_existing and v_existing.resolved_at is distinct from v_result.resolved_at)
        then 'comment_resolve'
      when not v_has_existing then 'comment_add'
      when v_operation = 'link_linear' then 'comment_link_linear'
      when v_operation = 'link_native' then 'comment_link_native'
      else 'comment_edit'
    end;
    v_event_key := 'production-comment:' || v_result.id || ':v' || v_result.version::text || ':' || v_event_action;
    v_event_payload :=
      (v_event - 'outbound' - 'comment' - 'event_key')
      || jsonb_build_object(
        'event_key', v_event_key,
        'comment', to_jsonb(v_result),
        'transport', jsonb_build_object(
          'actor', v_result.transport_actor,
          'role', v_result.transport_role
        )
      );

    insert into public.deliverable_events (
      deliverable_id, batch_id, client_slug, ts, actor, role, action,
      from_status, to_status, source, payload, event_key
    ) values (
      v_result.deliverable_id, v_event_batch_id, v_client_slug,
      v_result.source_updated_at,
      v_result.author_name,
      v_result.role,
      v_event_action, null, null, v_result.source, v_event_payload, v_event_key
    )
    on conflict do nothing;
  end if;

  return v_result;
end;
$fn$;

revoke all on function public.production_comment_upsert(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_comment_upsert(jsonb, jsonb)
  to service_role;

commit;
