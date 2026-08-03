-- Urgent bounded-input projection for the Track-B Linear reconciler.
--
-- The scheduled reconciler must not scan/detoast every deliverables.linear_raw
-- document or every deliverable_events.payload document on every run. These
-- service-only sidecars are derived transactionally from the source rows once
-- per source write. Normal reconciliation then reads only narrow persisted
-- rows. Full raw is available only through a <=100-id hydration RPC.
--
-- SOURCE-ONLY until an owner-approved production window applies and reads back
-- this delta. Install this migration before enabling the matching script.
-- The three short transactions are intentional: each source trigger is made
-- authoritative and its DDL lock released before the corresponding one-time
-- payload scan. A readiness row is granted only after final exact validation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

create or replace function public.linear_reconcile_js_truthy(p_value jsonb)
returns boolean
language sql
immutable
parallel safe
as $fn$
  select case jsonb_typeof(p_value)
    when 'null' then false
    when 'boolean' then (p_value #>> '{}')::boolean
    when 'number' then (p_value #>> '{}')::numeric <> 0
    when 'string' then (p_value #>> '{}') <> ''
    when 'array' then true
    when 'object' then true
    else false
  end;
$fn$;

create or replace function public.linear_reconcile_raw_has_any(
  p_raw jsonb,
  p_keys text[]
)
returns boolean
language plpgsql
immutable
parallel safe
as $fn$
declare
  v_stack jsonb[] := array[coalesce(p_raw, '{}'::jsonb)];
  v_current jsonb;
  v_key text;
  v_value jsonb;
  v_length integer;
begin
  loop
    v_length := coalesce(array_length(v_stack, 1), 0);
    exit when v_length = 0;
    v_current := v_stack[v_length];
    if v_length = 1 then
      v_stack := array[]::jsonb[];
    else
      v_stack := v_stack[1:v_length - 1];
    end if;

    if jsonb_typeof(v_current) = 'object' then
      for v_key, v_value in
        select e.key, e.value from jsonb_each(v_current) e
      loop
        if v_key = any(p_keys) and public.linear_reconcile_js_truthy(v_value) then
          return true;
        end if;
        if jsonb_typeof(v_value) in ('object', 'array') then
          v_stack := array_append(v_stack, v_value);
        end if;
      end loop;
    elsif jsonb_typeof(v_current) = 'array' then
      for v_value in select a.value from jsonb_array_elements(v_current) a
      loop
        if jsonb_typeof(v_value) in ('object', 'array') then
          v_stack := array_append(v_stack, v_value);
        end if;
      end loop;
    end if;
  end loop;
  return false;
end;
$fn$;

create or replace function public.linear_reconcile_compact_raw(p_raw jsonb)
returns jsonb
language plpgsql
immutable
parallel safe
as $fn$
declare
  v_root jsonb := case when jsonb_typeof(p_raw) = 'object' then p_raw else '{}'::jsonb end;
  v_issue jsonb;
  v_result jsonb;
begin
  v_issue := case when jsonb_typeof(v_root -> 'issue') = 'object'
    then v_root -> 'issue' else '{}'::jsonb end;
  v_result := '{"issue":{}}'::jsonb;
  if v_issue ? 'id' then
    v_result := jsonb_set(v_result, '{issue,id}', v_issue -> 'id');
  end if;
  if v_issue ? 'identifier' then
    v_result := jsonb_set(v_result, '{issue,identifier}', v_issue -> 'identifier');
  end if;
  if v_issue ? 'url' then
    v_result := jsonb_set(v_result, '{issue,url}', v_issue -> 'url');
  end if;
  if jsonb_typeof(v_issue -> 'parent') = 'object' then
    v_result := jsonb_set(v_result, '{issue,parent}', '{}'::jsonb);
    if (v_issue -> 'parent') ? 'id' then
      v_result := jsonb_set(v_result, '{issue,parent,id}', v_issue #> '{parent,id}');
    end if;
  end if;
  if v_issue ? 'createdAt' then
    v_result := jsonb_set(v_result, '{issue,createdAt}', v_issue -> 'createdAt');
  end if;
  if v_issue ? 'completedAt' then
    v_result := jsonb_set(v_result, '{issue,completedAt}', v_issue -> 'completedAt');
  end if;
  if v_issue ? 'archivedAt' then
    v_result := jsonb_set(v_result, '{issue,archivedAt}', v_issue -> 'archivedAt');
  end if;
  if v_issue ? 'canceledAt' then
    v_result := jsonb_set(v_result, '{issue,canceledAt}', v_issue -> 'canceledAt');
  end if;
  if v_root ? 'attribution' then
    v_result := jsonb_set(v_result, '{attribution}', v_root -> 'attribution');
  end if;
  if jsonb_typeof(v_root -> 'parent') = 'object' then
    v_result := jsonb_set(v_result, '{parent}', '{}'::jsonb);
    if (v_root -> 'parent') ? 'id' then
      v_result := jsonb_set(v_result, '{parent,id}', v_root #> '{parent,id}');
    end if;
  end if;
  if jsonb_typeof(v_root -> 'parent_change') = 'object' then
    v_result := jsonb_set(v_result, '{parent_change}', '{}'::jsonb);
    if (v_root -> 'parent_change') ? 'id' then
      v_result := jsonb_set(v_result, '{parent_change,id}', v_root #> '{parent_change,id}');
    end if;
  end if;
  if v_root ? 'parent_id' then
    v_result := jsonb_set(v_result, '{parent_id}', v_root -> 'parent_id');
  end if;
  if public.linear_reconcile_raw_has_any(
    v_root,
    array['webhook_delete', 'deleted', 'delete', 'removed', 'archived']
  ) then
    v_result := v_result || '{"archived":true}'::jsonb;
  end if;
  if public.linear_reconcile_raw_has_any(v_root, array['unmapped_state']) then
    v_result := v_result || '{"unmapped_state":true}'::jsonb;
  end if;
  if public.linear_reconcile_raw_has_any(
    v_root,
    array['stale_linear_regress', 'refused_stale_regress']
  ) then
    v_result := v_result || '{"refused_stale_regress":true}'::jsonb;
  end if;
  return v_result;
end;
$fn$;

create or replace function public.linear_reconcile_raw_sha256(p_raw jsonb)
returns text
language sql
immutable
parallel safe
as $fn$
  select encode(
    extensions.digest(
      convert_to(coalesce(p_raw, 'null'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$fn$;

create table if not exists public.linear_reconcile_deliverable_cache (
  id text primary key references public.deliverables(id) on delete cascade,
  identifier text,
  batch_id text not null,
  client_slug text not null,
  team text not null,
  kind text not null,
  title text not null,
  status text not null,
  status_at timestamptz,
  assignee_id uuid,
  due_date date,
  priority smallint,
  origin text not null,
  card_id text,
  created_by text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  compact_linear_raw jsonb not null check (jsonb_typeof(compact_linear_raw) = 'object'),
  source_linear_raw_sha256 text not null check (source_linear_raw_sha256 ~ '^[a-f0-9]{64}$'),
  projection_version smallint not null default 1 check (projection_version = 1),
  refreshed_at timestamptz not null default clock_timestamp()
);

alter table public.linear_reconcile_deliverable_cache enable row level security;
revoke all on table public.linear_reconcile_deliverable_cache
  from public, anon, authenticated, service_role;
grant select on table public.linear_reconcile_deliverable_cache to service_role;

create table if not exists public.linear_reconcile_projection_state (
  singleton boolean primary key default true check (singleton),
  projection_version smallint not null check (projection_version = 1),
  ready boolean not null default false,
  ready_at timestamptz,
  refreshed_at timestamptz not null default clock_timestamp()
);

alter table public.linear_reconcile_projection_state enable row level security;
revoke all on table public.linear_reconcile_projection_state
  from public, anon, authenticated, service_role;

insert into public.linear_reconcile_projection_state (
  singleton, projection_version, ready, ready_at, refreshed_at
) values (
  true, 1, false, null, clock_timestamp()
)
on conflict (singleton) do update set
  projection_version = excluded.projection_version,
  ready = false,
  ready_at = null,
  refreshed_at = excluded.refreshed_at;

create or replace view public.linear_reconcile_projection_status_v1
with (security_barrier = true, security_invoker = true)
as
select projection_version, ready, ready_at
from public.linear_reconcile_projection_state
where singleton;

revoke all on table public.linear_reconcile_projection_status_v1
  from public, anon, authenticated, service_role;

create or replace function public.linear_reconcile_deliverable_cache_refresh()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $fn$
begin
  insert into public.linear_reconcile_deliverable_cache (
    id, identifier, batch_id, client_slug, team, kind, title, status, status_at,
    assignee_id, due_date, priority, origin, card_id, created_by, created_at,
    updated_at, linear_issue_uuid, linear_identifier, linear_issue_url,
    compact_linear_raw, source_linear_raw_sha256, projection_version, refreshed_at
  ) values (
    new.id, new.identifier, new.batch_id, new.client_slug, new.team, new.kind,
    new.title, new.status, new.status_at, new.assignee_id, new.due_date,
    new.priority, new.origin, new.card_id, new.created_by, new.created_at,
    new.updated_at, new.linear_issue_uuid, new.linear_identifier,
    new.linear_issue_url, public.linear_reconcile_compact_raw(new.linear_raw),
    public.linear_reconcile_raw_sha256(new.linear_raw), 1, clock_timestamp()
  )
  on conflict (id) do update set
    identifier = excluded.identifier,
    batch_id = excluded.batch_id,
    client_slug = excluded.client_slug,
    team = excluded.team,
    kind = excluded.kind,
    title = excluded.title,
    status = excluded.status,
    status_at = excluded.status_at,
    assignee_id = excluded.assignee_id,
    due_date = excluded.due_date,
    priority = excluded.priority,
    origin = excluded.origin,
    card_id = excluded.card_id,
    created_by = excluded.created_by,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    linear_issue_uuid = excluded.linear_issue_uuid,
    linear_identifier = excluded.linear_identifier,
    linear_issue_url = excluded.linear_issue_url,
    compact_linear_raw = excluded.compact_linear_raw,
    source_linear_raw_sha256 = excluded.source_linear_raw_sha256,
    projection_version = excluded.projection_version,
    refreshed_at = excluded.refreshed_at;
  return null;
end;
$fn$;

revoke all on function public.linear_reconcile_js_truthy(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_raw_has_any(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_compact_raw(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_raw_sha256(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_deliverable_cache_refresh()
  from public, anon, authenticated, service_role;

drop trigger if exists linear_reconcile_deliverable_cache_after
  on public.deliverables;
create trigger linear_reconcile_deliverable_cache_after
  after insert or update on public.deliverables
  for each row execute function public.linear_reconcile_deliverable_cache_refresh();

-- Release the trigger-DDL lock before the one-time JSON backfill. The trigger
-- is now the last writer for any source row changed while the backfill runs.
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

insert into public.linear_reconcile_deliverable_cache (
  id, identifier, batch_id, client_slug, team, kind, title, status, status_at,
  assignee_id, due_date, priority, origin, card_id, created_by, created_at,
  updated_at, linear_issue_uuid, linear_identifier, linear_issue_url,
  compact_linear_raw, source_linear_raw_sha256, projection_version, refreshed_at
)
select
  d.id, d.identifier, d.batch_id, d.client_slug, d.team, d.kind, d.title,
  d.status, d.status_at, d.assignee_id, d.due_date, d.priority, d.origin,
  d.card_id, d.created_by, d.created_at, d.updated_at, d.linear_issue_uuid,
  d.linear_identifier, d.linear_issue_url,
  public.linear_reconcile_compact_raw(d.linear_raw),
  public.linear_reconcile_raw_sha256(d.linear_raw),
  1,
  transaction_timestamp()
from public.deliverables d
on conflict (id) do update set
  identifier = excluded.identifier,
  batch_id = excluded.batch_id,
  client_slug = excluded.client_slug,
  team = excluded.team,
  kind = excluded.kind,
  title = excluded.title,
  status = excluded.status,
  status_at = excluded.status_at,
  assignee_id = excluded.assignee_id,
  due_date = excluded.due_date,
  priority = excluded.priority,
  origin = excluded.origin,
  card_id = excluded.card_id,
  created_by = excluded.created_by,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  linear_issue_uuid = excluded.linear_issue_uuid,
  linear_identifier = excluded.linear_identifier,
  linear_issue_url = excluded.linear_issue_url,
  compact_linear_raw = excluded.compact_linear_raw,
  source_linear_raw_sha256 = excluded.source_linear_raw_sha256,
  projection_version = excluded.projection_version,
  refreshed_at = excluded.refreshed_at
where public.linear_reconcile_deliverable_cache.refreshed_at <= excluded.refreshed_at;

create or replace view public.linear_deliverables_reconcile_input_v1
with (security_barrier = true, security_invoker = true)
as
select
  id, identifier, batch_id, client_slug, team, kind, title, status, status_at,
  assignee_id, due_date, priority, origin, card_id, created_by, created_at,
  updated_at, linear_issue_uuid, linear_identifier, linear_issue_url,
  compact_linear_raw as linear_raw,
  source_linear_raw_sha256,
  projection_version
from public.linear_reconcile_deliverable_cache;

revoke all on table public.linear_deliverables_reconcile_input_v1
  from public, anon, authenticated, service_role;
grant select on table public.linear_deliverables_reconcile_input_v1 to service_role;

create or replace function public.linear_reconcile_js_string(p_value jsonb)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  v_result text := '';
  v_value jsonb;
  v_first boolean := true;
begin
  case jsonb_typeof(p_value)
    when 'null' then return '';
    when 'string' then return p_value #>> '{}';
    when 'boolean' then return p_value #>> '{}';
    when 'number' then return p_value #>> '{}';
    when 'object' then return '[object Object]';
    when 'array' then
      for v_value in select a.value from jsonb_array_elements(p_value) a
      loop
        if not v_first then v_result := v_result || ','; end if;
        v_result := v_result || public.linear_reconcile_js_string(v_value);
        v_first := false;
      end loop;
      return v_result;
    else return '';
  end case;
end;
$fn$;

create or replace function public.linear_reconcile_event_comment_id(p_payload jsonb)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  v_payload jsonb := case when jsonb_typeof(p_payload) = 'object'
    then p_payload else '{}'::jsonb end;
  v_candidates jsonb[];
  v_candidate jsonb;
begin
  v_candidates := array[
    v_payload -> 'linear_comment_id',
    v_payload -> 'comment_id',
    v_payload #> '{comment,linear_comment_id}',
    v_payload #> '{comment,native_comment_id}',
    v_payload #> '{comment,id}',
    v_payload #> '{linear_comment,id}'
  ];
  foreach v_candidate in array v_candidates
  loop
    if public.linear_reconcile_js_truthy(v_candidate) then
      return btrim(public.linear_reconcile_js_string(v_candidate));
    end if;
  end loop;
  return null;
end;
$fn$;

create table if not exists public.linear_reconcile_comment_event_map (
  event_id bigint primary key references public.deliverable_events(id) on delete cascade,
  deliverable_id text,
  linear_comment_id text,
  qualifies boolean not null,
  event_ts timestamptz not null,
  refreshed_at timestamptz not null default clock_timestamp(),
  check (
    (qualifies and deliverable_id is not null and nullif(btrim(linear_comment_id), '') is not null)
    or (not qualifies and deliverable_id is null and linear_comment_id is null)
  )
);

create index if not exists linear_reconcile_comment_pair_idx
  on public.linear_reconcile_comment_event_map (deliverable_id, linear_comment_id)
  where qualifies;

alter table public.linear_reconcile_comment_event_map enable row level security;
revoke all on table public.linear_reconcile_comment_event_map
  from public, anon, authenticated, service_role;
grant select on table public.linear_reconcile_comment_event_map to service_role;

create or replace function public.linear_reconcile_comment_event_refresh()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_comment_id text;
  v_qualifies boolean;
begin
  v_qualifies := new.deliverable_id is not null
    and new.source in ('ui', 'mirror', 'outbound')
    and position('comment' in lower(new.action)) > 0;
  if v_qualifies then
    v_comment_id := public.linear_reconcile_event_comment_id(new.payload);
    v_qualifies := nullif(v_comment_id, '') is not null;
  end if;
  insert into public.linear_reconcile_comment_event_map (
    event_id, deliverable_id, linear_comment_id, qualifies, event_ts, refreshed_at
  ) values (
    new.id,
    case when v_qualifies then new.deliverable_id else null end,
    case when v_qualifies then v_comment_id else null end,
    v_qualifies,
    new.ts,
    clock_timestamp()
  )
  on conflict (event_id) do update set
    deliverable_id = excluded.deliverable_id,
    linear_comment_id = excluded.linear_comment_id,
    qualifies = excluded.qualifies,
    event_ts = excluded.event_ts,
    refreshed_at = excluded.refreshed_at;
  return null;
end;
$fn$;

revoke all on function public.linear_reconcile_js_string(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_event_comment_id(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_comment_event_refresh()
  from public, anon, authenticated, service_role;

drop trigger if exists linear_reconcile_comment_event_after
  on public.deliverable_events;
create trigger linear_reconcile_comment_event_after
  after insert or update of deliverable_id, action, source, payload, ts
  on public.deliverable_events
  for each row execute function public.linear_reconcile_comment_event_refresh();

-- As above, release the source-table DDL lock before scanning event payloads.
commit;

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

insert into public.linear_reconcile_comment_event_map (
  event_id, deliverable_id, linear_comment_id, qualifies, event_ts, refreshed_at
)
select
  e.id,
  case when candidate.qualifies then e.deliverable_id else null end,
  case when candidate.qualifies then extracted.linear_comment_id else null end,
  candidate.qualifies,
  e.ts,
  transaction_timestamp()
from public.deliverable_events e
cross join lateral (
  select case
    when e.deliverable_id is not null
      and e.source in ('ui', 'mirror', 'outbound')
      and position('comment' in lower(e.action)) > 0
    then public.linear_reconcile_event_comment_id(e.payload)
    else null
  end as linear_comment_id
) extracted
cross join lateral (
  select nullif(extracted.linear_comment_id, '') is not null as qualifies
) candidate
on conflict (event_id) do update set
  deliverable_id = excluded.deliverable_id,
  linear_comment_id = excluded.linear_comment_id,
  qualifies = excluded.qualifies,
  event_ts = excluded.event_ts,
  refreshed_at = excluded.refreshed_at
where public.linear_reconcile_comment_event_map.refreshed_at <= excluded.refreshed_at;

create or replace view public.linear_deliverable_comment_ids_v1
with (security_barrier = true, security_invoker = true)
as
select
  deliverable_id,
  linear_comment_id,
  max(event_ts) as latest_ts,
  (array_agg(event_id order by event_ts desc, event_id desc))[1] as latest_event_id
from public.linear_reconcile_comment_event_map
where qualifies
group by deliverable_id, linear_comment_id;

revoke all on table public.linear_deliverable_comment_ids_v1
  from public, anon, authenticated, service_role;
grant select on table public.linear_deliverable_comment_ids_v1 to service_role;

create or replace function public.linear_deliverables_reconcile_hydrate(p_ids text[])
returns table (
  id text,
  identifier text,
  batch_id text,
  client_slug text,
  team text,
  kind text,
  title text,
  status text,
  status_at timestamptz,
  assignee_id uuid,
  due_date date,
  priority smallint,
  origin text,
  card_id text,
  created_by text,
  created_at timestamptz,
  updated_at timestamptz,
  linear_issue_uuid text,
  linear_identifier text,
  linear_issue_url text,
  linear_raw jsonb,
  source_linear_raw_sha256 text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public, extensions
as $fn$
declare
  v_count integer;
  v_unique_count integer;
begin
  v_count := coalesce(cardinality(p_ids), 0);
  select count(distinct btrim(value)) into v_unique_count
  from unnest(coalesce(p_ids, array[]::text[])) value
  where nullif(btrim(value), '') is not null;
  if v_count < 1 or v_count > 100 or v_unique_count <> v_count then
    raise exception 'linear reconcile hydration requires 1..100 unique nonempty ids';
  end if;

  return query
  select
    d.id, d.identifier, d.batch_id, d.client_slug, d.team, d.kind, d.title,
    d.status, d.status_at, d.assignee_id, d.due_date, d.priority, d.origin,
    d.card_id, d.created_by, d.created_at, d.updated_at, d.linear_issue_uuid,
    d.linear_identifier, d.linear_issue_url, d.linear_raw,
    public.linear_reconcile_raw_sha256(d.linear_raw)
  from public.deliverables d
  where d.id = any(p_ids);
end;
$fn$;

revoke all on function public.linear_deliverables_reconcile_hydrate(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.linear_deliverables_reconcile_hydrate(text[])
  to service_role;

revoke all on function public.linear_reconcile_js_truthy(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_raw_has_any(jsonb, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_compact_raw(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_raw_sha256(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_js_string(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_event_comment_id(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_deliverable_cache_refresh()
  from public, anon, authenticated, service_role;
revoke all on function public.linear_reconcile_comment_event_refresh()
  from public, anon, authenticated, service_role;

do $check$
begin
  if exists (
    select 1
    from public.deliverables d
    full join public.linear_reconcile_deliverable_cache c using (id)
    where d.id is null
       or c.id is null
       or c.identifier is distinct from d.identifier
       or c.batch_id is distinct from d.batch_id
       or c.client_slug is distinct from d.client_slug
       or c.team is distinct from d.team
       or c.kind is distinct from d.kind
       or c.title is distinct from d.title
       or c.status is distinct from d.status
       or c.status_at is distinct from d.status_at
       or c.assignee_id is distinct from d.assignee_id
       or c.due_date is distinct from d.due_date
       or c.priority is distinct from d.priority
       or c.origin is distinct from d.origin
       or c.card_id is distinct from d.card_id
       or c.created_by is distinct from d.created_by
       or c.created_at is distinct from d.created_at
       or c.updated_at is distinct from d.updated_at
       or c.linear_issue_uuid is distinct from d.linear_issue_uuid
       or c.linear_identifier is distinct from d.linear_identifier
       or c.linear_issue_url is distinct from d.linear_issue_url
       or c.compact_linear_raw is distinct from public.linear_reconcile_compact_raw(d.linear_raw)
       or c.source_linear_raw_sha256 is distinct from public.linear_reconcile_raw_sha256(d.linear_raw)
       or c.projection_version is distinct from 1
  ) then
    raise exception 'linear reconcile deliverable cache is incomplete or mismatched';
  end if;
  if exists (
    select 1
    from (
      select
        e.id as event_id,
        case when candidate.qualifies then e.deliverable_id else null end as deliverable_id,
        case when candidate.qualifies then extracted.linear_comment_id else null end as linear_comment_id,
        candidate.qualifies,
        e.ts as event_ts
      from public.deliverable_events e
      cross join lateral (
        select case
          when e.deliverable_id is not null
            and e.source in ('ui', 'mirror', 'outbound')
            and position('comment' in lower(e.action)) > 0
          then public.linear_reconcile_event_comment_id(e.payload)
          else null
        end as linear_comment_id
      ) extracted
      cross join lateral (
        select nullif(extracted.linear_comment_id, '') is not null as qualifies
      ) candidate
    ) expected
    full join public.linear_reconcile_comment_event_map actual using (event_id)
    where expected.event_id is null
       or actual.event_id is null
       or actual.deliverable_id is distinct from expected.deliverable_id
       or actual.linear_comment_id is distinct from expected.linear_comment_id
       or actual.qualifies is distinct from expected.qualifies
       or actual.event_ts is distinct from expected.event_ts
  ) then
    raise exception 'linear reconcile comment event map is incomplete or mismatched';
  end if;
end;
$check$;

update public.linear_reconcile_projection_state
set ready = true,
    ready_at = clock_timestamp(),
    refreshed_at = clock_timestamp()
where singleton and projection_version = 1;

grant select on table public.linear_reconcile_projection_state to service_role;
grant select on table public.linear_reconcile_projection_status_v1 to service_role;

commit;

-- Owner-only rollback (derived sidecars only; source rows remain untouched):
-- begin;
-- drop trigger if exists linear_reconcile_comment_event_after on public.deliverable_events;
-- drop trigger if exists linear_reconcile_deliverable_cache_after on public.deliverables;
-- drop view if exists public.linear_reconcile_projection_status_v1;
-- drop view if exists public.linear_deliverable_comment_ids_v1;
-- drop view if exists public.linear_deliverables_reconcile_input_v1;
-- drop function if exists public.linear_deliverables_reconcile_hydrate(text[]);
-- drop table if exists public.linear_reconcile_comment_event_map;
-- drop table if exists public.linear_reconcile_deliverable_cache;
-- drop table if exists public.linear_reconcile_projection_state;
-- drop function if exists public.linear_reconcile_comment_event_refresh();
-- drop function if exists public.linear_reconcile_deliverable_cache_refresh();
-- drop function if exists public.linear_reconcile_event_comment_id(jsonb);
-- drop function if exists public.linear_reconcile_js_string(jsonb);
-- drop function if exists public.linear_reconcile_raw_sha256(jsonb);
-- drop function if exists public.linear_reconcile_compact_raw(jsonb);
-- drop function if exists public.linear_reconcile_raw_has_any(jsonb, text[]);
-- drop function if exists public.linear_reconcile_js_truthy(jsonb);
-- commit;
