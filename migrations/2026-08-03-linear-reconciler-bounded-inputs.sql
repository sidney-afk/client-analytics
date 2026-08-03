-- Urgent bounded-input projection for the Track-B Linear reconciler.
--
-- The scheduled reconciler must not scan/detoast every deliverables.linear_raw
-- document or every deliverable_events.payload document on every run. These
-- service-only views derive the bounded shape when the hourly reconciler reads
-- it. Normal reconciliation transfers only narrow rows. Full raw is available
-- only through a <=100-id hydration RPC.
--
-- SOURCE-ONLY until an owner-approved production window applies and reads back
-- this delta. Install this migration before enabling the matching script.
-- This lower-risk route intentionally creates no source-table trigger, cache,
-- backfill, or write path. The entire install is one transaction.
-- Production read-only measurement on 2026-08-03 (warm cache, before install):
-- 4,760 deliverables projected in 3,686.345 ms; 35,727 events aggregated to
-- 575 comment pairs in 2,251.719 ms; both plans reported zero shared reads.
-- These measurements support the separately reviewed hourly cadence; they are
-- not a latency assertion or permission to install outside the owner window.

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

do $clean_boundary$
begin
  if to_regclass('public.linear_reconcile_deliverable_cache') is not null
     or to_regclass('public.linear_reconcile_comment_event_map') is not null
     or exists (
       select 1
       from pg_trigger t
       where not t.tgisinternal
         and t.tgname in (
           'linear_reconcile_deliverable_cache_after',
           'linear_reconcile_comment_event_after'
         )
     ) then
    raise exception 'linear reconcile compute-on-read install requires a clean no-sidecar boundary';
  end if;
end;
$clean_boundary$;

create or replace view public.linear_reconcile_projection_status_v1
with (security_barrier = true, security_invoker = true)
as
select 1::smallint as projection_version, true as ready, null::timestamptz as ready_at;

revoke all on table public.linear_reconcile_projection_status_v1
  from public, anon, authenticated, service_role;

create or replace view public.linear_deliverables_reconcile_input_v1
with (security_barrier = true, security_invoker = true)
as
select
  d.id, d.identifier, d.batch_id, d.client_slug, d.team, d.kind, d.title,
  d.status, d.status_at, d.assignee_id, d.due_date, d.priority, d.origin,
  d.card_id, d.created_by, d.created_at, d.updated_at, d.linear_issue_uuid,
  d.linear_identifier, d.linear_issue_url,
  public.linear_reconcile_compact_raw(d.linear_raw) as linear_raw,
  public.linear_reconcile_raw_sha256(d.linear_raw) as source_linear_raw_sha256,
  1::smallint as projection_version
from public.deliverables d;

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

create or replace view public.linear_deliverable_comment_ids_v1
with (security_barrier = true, security_invoker = true)
as
select
  e.deliverable_id,
  extracted.linear_comment_id,
  max(e.ts) as latest_ts,
  (array_agg(e.id order by e.ts desc, e.id desc))[1] as latest_event_id
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
where nullif(extracted.linear_comment_id, '') is not null
group by e.deliverable_id, extracted.linear_comment_id;

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

-- The compute-on-read views run with the caller's privileges. The service role
-- therefore receives only the pure helper EXECUTEs used by those views.
grant execute on function public.linear_reconcile_js_truthy(jsonb)
  to service_role;
grant execute on function public.linear_reconcile_raw_has_any(jsonb, text[])
  to service_role;
grant execute on function public.linear_reconcile_compact_raw(jsonb)
  to service_role;
grant execute on function public.linear_reconcile_raw_sha256(jsonb)
  to service_role;
grant execute on function public.linear_reconcile_js_string(jsonb)
  to service_role;
grant execute on function public.linear_reconcile_event_comment_id(jsonb)
  to service_role;

do $check$
begin
  if (select count(*) from public.linear_deliverables_reconcile_input_v1)
      <> (select count(*) from public.deliverables) then
    raise exception 'linear reconcile compute-on-read deliverable view is incomplete';
  end if;
  if exists (
    select 1
    from public.linear_deliverables_reconcile_input_v1
    where projection_version is distinct from 1
       or source_linear_raw_sha256 !~ '^[a-f0-9]{64}$'
       or jsonb_typeof(linear_raw) is distinct from 'object'
  ) then
    raise exception 'linear reconcile compute-on-read deliverable view is invalid';
  end if;
  if exists (
    select 1
    from pg_trigger t
    where not t.tgisinternal
      and t.tgname in (
        'linear_reconcile_deliverable_cache_after',
        'linear_reconcile_comment_event_after'
      )
  ) then
    raise exception 'linear reconcile compute-on-read install created a source trigger';
  end if;
end;
$check$;

grant select on table public.linear_reconcile_projection_status_v1 to service_role;

commit;

-- Owner-only rollback (views/functions only; source rows remain untouched):
-- begin;
-- drop view if exists public.linear_reconcile_projection_status_v1;
-- drop view if exists public.linear_deliverable_comment_ids_v1;
-- drop view if exists public.linear_deliverables_reconcile_input_v1;
-- drop function if exists public.linear_deliverables_reconcile_hydrate(text[]);
-- drop function if exists public.linear_reconcile_event_comment_id(jsonb);
-- drop function if exists public.linear_reconcile_js_string(jsonb);
-- drop function if exists public.linear_reconcile_raw_sha256(jsonb);
-- drop function if exists public.linear_reconcile_compact_raw(jsonb);
-- drop function if exists public.linear_reconcile_raw_has_any(jsonb, text[]);
-- drop function if exists public.linear_reconcile_js_truthy(jsonb);
-- commit;
