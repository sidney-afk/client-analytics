-- B3 exact-scope Calendar graphics linkage repair, v2 cohort binding.
--
-- CORRECTIVE SOURCE / NOT INSTALLED. The already-installed v1 migration stays
-- byte-for-byte immutable for provenance. Installing this v2 replacement is a
-- separate owner-approved operation and is required before any v2 apply.
--
-- The forward RPC can update only
-- calendar_posts.graphic_deliverable_id for an exact, private, pre-reviewed
-- plan. It cannot promote archive rows, create native rows, change authority,
-- write Linear, or touch any other card/deliverable field.
--
-- The old global B3 sweep is deliberately not relaxed here. A caller must pin
-- its still-BLOCKED failure count and multiset digest in the exact-scope plan;
-- the runner independently proves that digest is unchanged after the RPC.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- Replay refusal depends on the existing partial unique event-key index. Fail
-- the install closed if that prerequisite was removed, invalidated, or changed.
do $prerequisite$
begin
  if not exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = to_regclass('public.deliverable_events')
      and idx.relnamespace = 'public'::regnamespace
      and idx.relname = 'deliverable_events_event_key_unique_idx'
      and i.indisunique
      and i.indisvalid
      and i.indisready
      and i.indnkeyatts = 1
      and pg_catalog.pg_get_indexdef(i.indexrelid, 1, true) = 'event_key'
      and regexp_replace(
        pg_catalog.pg_get_expr(i.indpred, i.indrelid),
        '[()[:space:]]', '', 'g'
      ) = 'event_keyISNOTNULL'
  ) then
    raise exception 'b3_scoped_event_key_index_prerequisite_failed';
  end if;
end;
$prerequisite$;

-- A second, intentionally conservative URL projection used only as an
-- additional database-side ambiguity check. The runner still CAS-binds both
-- exact raw URLs and its own canonical values. Lower-casing the projection can
-- reject an extra case-variant collision; it can never make a mismatched raw
-- URL eligible.
create or replace function public.b3_scoped_linear_url_projection(p_value text)
returns text
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_value text := btrim(coalesce(p_value, ''));
  v_origin text;
begin
  if v_value = '' then return ''; end if;
  v_value := regexp_replace(v_value, '[?#].*$', '');
  v_value := regexp_replace(v_value, '/+$', '');
  v_origin := substring(v_value from '(?i)^https?://[^/]+');
  if v_origin is not null then
    return lower(v_origin) || substring(v_value from char_length(v_origin) + 1);
  end if;
  return lower(v_value);
end;
$fn$;

-- Invalid legacy comment cells fail closed as -1 without returning the cell or
-- a parser error that could expose comment content.
create or replace function public.b3_scoped_comment_count(p_value text)
returns integer
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_value jsonb;
begin
  if p_value is null or btrim(p_value) = '' then return 0; end if;
  begin
    v_value := p_value::jsonb;
  exception when others then
    return -1;
  end;
  if jsonb_typeof(v_value) <> 'array' then return -1; end if;
  return jsonb_array_length(v_value);
end;
$fn$;

-- Mirrors the existing B3 deleted/archive refusal without depending on a
-- separately installed reconciler helper. No source document is returned.
create or replace function public.b3_scoped_raw_is_archived(p_raw jsonb)
returns boolean
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $fn$
declare
  v_stack jsonb[] := array[coalesce(p_raw, '{}'::jsonb)];
  v_current jsonb;
  v_key text;
  v_value jsonb;
  v_truthy boolean;
  v_length integer;
begin
  -- JavaScript's explicit top-level raw.issue archived/canceled check.
  if jsonb_typeof(coalesce(p_raw, '{}'::jsonb)->'issue') = 'object' then
    for v_key, v_value in
      select e.key, e.value
      from jsonb_each(coalesce(p_raw, '{}'::jsonb)->'issue') e
      where e.key in ('archivedAt', 'canceledAt')
    loop
      v_truthy := case jsonb_typeof(v_value)
        when 'null' then false
        when 'boolean' then (v_value #>> '{}')::boolean
        when 'number' then (v_value #>> '{}')::numeric <> 0
        when 'string' then (v_value #>> '{}') <> ''
        when 'array' then true
        when 'object' then true
        else false
      end;
      if v_truthy then return true; end if;
    end loop;
  end if;

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
      for v_key, v_value in select e.key, e.value from jsonb_each(v_current) e
      loop
        v_truthy := case jsonb_typeof(v_value)
          when 'null' then false
          when 'boolean' then (v_value #>> '{}')::boolean
          when 'number' then (v_value #>> '{}')::numeric <> 0
          when 'string' then (v_value #>> '{}') <> ''
          when 'array' then true
          when 'object' then true
          else false
        end;
        if v_key = any(array[
          'webhook_delete', 'deleted', 'delete', 'removed', 'archived'
        ]) and v_truthy then
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

-- Recomputes the existing B3 strict active-Calendar failure multiset inside
-- the same transaction that owns the cohort locks. The digest protocol is
-- deliberately cross-runtime: each UTF-8 field is hex-encoded, fields are
-- colon-separated, sorted row tokens are LF-separated, and that byte string is
-- SHA-256 hashed. The Node planner implements the identical protocol.
create or replace function public.b3_scoped_global_failure_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with slots as (
  select
    'calendar'::text as source,
    slot.component,
    slot.kind,
    btrim(coalesce(c.client, '')) as client_slug,
    btrim(coalesce(c.id, '')) as card_id,
    btrim(coalesce(slot.link_url, '')) as link_url,
    btrim(coalesce(slot.deliverable_id, '')) as deliverable_id,
    upper(coalesce(substring(
      btrim(coalesce(slot.link_url, ''))
      from '(?i)\m([a-z]{2,5}-[0-9]+)\M'
    ), '')) as link_identifier
  from public.calendar_posts c
  cross join lateral (
    values
      ('video'::text, 'video'::text, c.linear_issue_id, c.video_deliverable_id),
      ('graphic'::text, 'thumbnail'::text,
       c.graphic_linear_issue_id, c.graphic_deliverable_id)
  ) slot(component, kind, link_url, deliverable_id)
  where lower(btrim(coalesce(c.status, ''))) not in (
      'archived', 'canceled', 'cancelled', 'duplicate'
    )
    and (
      btrim(coalesce(slot.link_url, '')) <> ''
      or btrim(coalesce(slot.deliverable_id, '')) <> ''
    )
),
counts as (
  select
    s.*,
    (
      select count(*)
      from public.deliverables d
      where btrim(coalesce(d.id, '')) = s.deliverable_id
    )::integer as id_count,
    (
      select count(*)
      from public.deliverables d
      where btrim(coalesce(d.id, '')) = s.deliverable_id
        and lower(btrim(coalesce(d.status, ''))) <> 'archived'
        and not public.b3_scoped_raw_is_archived(d.linear_raw)
        and lower(btrim(coalesce(d.client_slug, ''))) = lower(s.client_slug)
        and lower(btrim(coalesce(d.kind, ''))) = lower(s.kind)
        and (
          s.link_url = ''
          or public.b3_scoped_linear_url_projection(d.linear_issue_url)
             = public.b3_scoped_linear_url_projection(s.link_url)
        )
    )::integer as scoped_id_count,
    (
      select count(*)
      from public.deliverables d
      where s.deliverable_id = ''
        and s.link_url ~* '^https?://'
        and lower(btrim(coalesce(d.status, ''))) <> 'archived'
        and not public.b3_scoped_raw_is_archived(d.linear_raw)
        and lower(btrim(coalesce(d.client_slug, ''))) = lower(s.client_slug)
        and lower(btrim(coalesce(d.kind, ''))) = lower(s.kind)
        and public.b3_scoped_linear_url_projection(d.linear_issue_url)
            = public.b3_scoped_linear_url_projection(s.link_url)
    )::integer as exact_count
  from slots s
),
classified as (
  select
    c.*,
    case
      when c.deliverable_id <> '' and c.id_count = 0
        then 'dangling_deliverable_id'
      when c.deliverable_id <> '' and c.scoped_id_count = 0
        then 'wrong_deliverable_id'
      when c.deliverable_id <> '' and c.scoped_id_count <> 1
        then 'ambiguous_deliverable_id'
      when c.deliverable_id = '' and c.exact_count = 0
        then 'unresolved_exact_url'
      when c.deliverable_id = '' and c.exact_count <> 1
        then 'ambiguous_exact_url'
      else null
    end as reason,
    case
      when c.deliverable_id <> '' and c.scoped_id_count > 1
        then c.scoped_id_count
      when c.deliverable_id <> '' then c.id_count
      else c.exact_count
    end as candidate_count
  from counts c
),
tokens as (
  select concat_ws(':',
    encode(convert_to(coalesce(source, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(component, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(client_slug, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(card_id, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(link_identifier, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(reason, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(candidate_count, 0)::text, 'UTF8'), 'hex')
  ) as token
  from classified
  where reason is not null
)
select jsonb_build_object(
  'checked', (select count(*) from classified),
  'resolved', (
    select count(*) from classified where reason is null
  ),
  'resolved_by_id', (
    select count(*) from classified
    where reason is null and deliverable_id <> ''
  ),
  'resolved_by_exact_url', (
    select count(*) from classified
    where reason is null and deliverable_id = ''
  ),
  'failure_count', (select count(*) from tokens),
  'failure_digest', (
    select encode(extensions.digest(
      convert_to(coalesce(string_agg(token, E'\n' order by token collate "C"), ''), 'UTF8'),
      'sha256'
    ), 'hex')
    from tokens
  )
);
$fn$;

-- Recomputes the complete broad source population for an explicit, private
-- scope-client selector. This runs before any deliverable lookup: every live,
-- unposted Calendar Graphics card with a Linear link and missing pointer is in
-- scope, including rows B3 would skip as unresolved, archive-only, or
-- ambiguous. The return is aggregate-only; identities never leave the RPC.
create or replace function public.b3_scoped_cohort_population_state(
  p_scope_clients jsonb,
  p_entries jsonb
) returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
with requested_clients as (
  select btrim(scoped.value) as client_slug
  from jsonb_array_elements_text(
    coalesce(p_scope_clients, '[]'::jsonb)
  ) as scoped(value)
),
population as (
  select
    btrim(coalesce(c.client, '')) as client_slug,
    btrim(coalesce(c.id, '')) as card_id
  from public.calendar_posts c
  join requested_clients requested
    on requested.client_slug = btrim(coalesce(c.client, ''))
  join public.clients cl
    on cl.slug = c.client
   and cl.active = true
   and lower(btrim(coalesce(cl.kind, ''))) = 'client'
  where nullif(btrim(coalesce(c.status, '')), '') is not null
    and lower(btrim(coalesce(c.status, ''))) not in (
      'archived', 'canceled', 'cancelled', 'duplicate', 'posted', 'published'
    )
    and nullif(btrim(coalesce(c.posted_at, '')), '') is null
    and nullif(btrim(coalesce(c.graphic_status, '')), '') is not null
    and lower(btrim(coalesce(c.graphic_status, ''))) not in (
      'archived', 'canceled', 'cancelled', 'duplicate', 'posted', 'published'
    )
    and nullif(btrim(coalesce(c.graphic_linear_issue_id, '')), '') is not null
    and (c.graphic_deliverable_id is null or c.graphic_deliverable_id = '')
),
tokens as (
  select concat_ws(':',
    encode(convert_to(client_slug, 'UTF8'), 'hex'),
    encode(convert_to(card_id, 'UTF8'), 'hex'),
    encode(convert_to('graphic', 'UTF8'), 'hex')
  ) as token
  from population
),
entry_population as (
  select
    btrim(coalesce(e.value->'card'->>'client', '')) as client_slug,
    btrim(coalesce(e.value->'card'->>'id', '')) as card_id
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e(value)
),
population_missing_from_entries as (
  select client_slug, card_id from population
  except
  select client_slug, card_id from entry_population
),
entries_missing_from_population as (
  select client_slug, card_id from entry_population
  except
  select client_slug, card_id from population
)
select jsonb_build_object(
  'population_count', (select count(*) from population),
  'population_digest', encode(extensions.digest(convert_to(
    coalesce((select string_agg(token, E'\n' order by token collate "C") from tokens), ''),
    'UTF8'
  ), 'sha256'), 'hex'),
  'population_missing_from_entries',
    (select count(*) from population_missing_from_entries),
  'entries_missing_from_population',
    (select count(*) from entries_missing_from_population)
);
$fn$;

-- Aggregate-only readback used by the separately approved private dry-run to
-- prove that the database-side B3 projection agrees with the Node planner.
create or replace function public.b3_scoped_card_linkage_preflight()
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $fn$
begin
  return public.b3_scoped_global_failure_state();
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'B3C01', message = 'REFUSED_CONTENTION';
  when query_canceled then
    raise exception using errcode = 'B3C02', message = 'EXECUTION_INTERRUPTED';
  when others then
    raise exception using errcode = 'B3F01', message = 'PREFLIGHT_FAILED_INTERNAL';
end;
$fn$;

-- Identity-free high-water binder for dependent card activity. The receipt
-- stores only this digest; card identities remain in the private plan.
create or replace function public.b3_scoped_calendar_event_digest(p_entries jsonb)
returns text
language sql
stable
security definer
set search_path = public
as $fn$
with requested as (
  select
    e.value->'card'->>'client' as client,
    e.value->'card'->>'id' as card_id
  from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) e(value)
),
tokens as (
  select concat_ws(':',
    encode(convert_to(coalesce(r.client, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(r.card_id, ''), 'UTF8'), 'hex'),
    encode(convert_to(coalesce(max(cpe.id), 0)::text, 'UTF8'), 'hex')
  ) as token
  from requested r
  left join public.calendar_post_events cpe
    on cpe.client = r.client and cpe.post_id = r.card_id
  group by r.client, r.card_id
)
select encode(extensions.digest(convert_to(
  coalesce(string_agg(token, E'\n' order by token collate "C"), ''),
  'UTF8'
), 'sha256'), 'hex')
from tokens;
$fn$;

-- Internal assertion used before and after each pointer transition. It first
-- freezes every table that can create a competing card/deliverable/comment or
-- event fact, then share-locks authority and locks named rows deterministically.
-- This dependency order is compatible with the existing row-first production
-- writers while still blocking an authority update. All per-entry identities
-- remain inside the private request and never appear in an exception/return.
create or replace function public.b3_scoped_card_linkage_assert_plan(
  p_plan jsonb,
  p_expected_count integer,
  p_expected_scope_digest text,
  p_expected_plan_digest text,
  p_expected_global_failures integer,
  p_expected_global_digest text,
  p_pointer_phase text
) returns void
language plpgsql
security definer
set search_path = public
set lock_timeout = '5s'
as $fn$
declare
  v_entries jsonb;
  v_entry jsonb;
  v_card jsonb;
  v_target jsonb;
  v_pointer jsonb;
  v_card_row public.calendar_posts%rowtype;
  v_target_row public.deliverables%rowtype;
  v_authority jsonb;
  v_locked integer;
  v_distinct integer;
  v_candidate_count integer;
  v_candidate_target_count integer;
  v_consumer_count integer;
  v_native_comment_count integer;
  v_card_identifier text;
  v_target_identifier text;
  v_global_state jsonb;
  v_expected_global_state jsonb;
  v_entry_population_digest text;
  v_empty_digest constant text :=
    encode(extensions.digest(convert_to('[]', 'UTF8'), 'sha256'), 'hex');
begin
  if jsonb_typeof(p_plan) <> 'object'
     or p_plan->>'contract' is distinct from 'b3-scoped-card-linkage/v2'
     or p_plan->>'scope_policy' is distinct from
          'exact_calendar_graphic_url_to_native_cohort_bound_v2'
     or p_plan->>'global_gate' is distinct from 'BLOCKED'
     or p_plan->>'exact_scope_gate' is distinct from 'READY'
     or p_pointer_phase not in ('before', 'after')
     or p_expected_count is null or p_expected_count < 1 or p_expected_count > 100
     or p_expected_global_failures is null or p_expected_global_failures < 1
     or coalesce(p_expected_scope_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_plan_digest, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_expected_global_digest, '') !~ '^[0-9a-f]{64}$'
     or p_plan->>'expected_count' is distinct from p_expected_count::text
     or p_plan->>'scope_digest' is distinct from p_expected_scope_digest
     or p_plan->>'plan_digest' is distinct from p_expected_plan_digest
     or p_plan->>'global_failure_count' is distinct from p_expected_global_failures::text
     or p_plan->>'global_failure_digest' is distinct from p_expected_global_digest
     or jsonb_typeof(p_plan->'prod_authority') <> 'object'
     or coalesce(p_plan->>'prod_authority_digest', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_plan->'scope_clients') <> 'array'
     or coalesce(p_plan->>'cohort_population_count', '') !~ '^[1-9][0-9]{0,2}$'
     or coalesce(p_plan->>'cohort_population_digest', '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_plan->'global_before') <> 'object'
     or jsonb_typeof(p_plan->'global_projected') <> 'object'
     or p_plan ?| array[
       'promote_archive', 'archive_promotion', 'promotion',
       'create_deliverable', 'create_batch', 'create'
     ] then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  v_entries := p_plan->'entries';
  if jsonb_typeof(v_entries) <> 'array'
     or jsonb_array_length(v_entries) <> p_expected_count
     or (p_plan->>'cohort_population_count')::integer <> p_expected_count
     or jsonb_array_length(p_plan->'scope_clients') < 1
     or jsonb_array_length(p_plan->'scope_clients') > 100
     or exists (
       select 1
       from jsonb_array_elements(p_plan->'scope_clients') scoped(value)
       where jsonb_typeof(scoped.value) <> 'string'
          or nullif(btrim(scoped.value #>> '{}'), '') is null
          or scoped.value #>> '{}' <> btrim(scoped.value #>> '{}')
     )
     or p_plan->'scope_clients' is distinct from (
       select jsonb_agg(to_jsonb(scoped.value) order by scoped.value collate "C")
       from (
         select distinct value
         from jsonb_array_elements_text(p_plan->'scope_clients') as rows(value)
       ) scoped
     ) then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  if not ((p_plan->'global_before') ?& array[
       'checked', 'resolved', 'resolved_by_id', 'resolved_by_exact_url',
       'failure_count', 'failure_digest'
     ])
     or not ((p_plan->'global_projected') ?& array[
       'checked', 'resolved', 'resolved_by_id', 'resolved_by_exact_url',
       'failure_count', 'failure_digest'
     ])
     or (p_plan->'global_before'->>'checked')::integer
          <> (p_plan->'global_projected'->>'checked')::integer
     or (p_plan->'global_before'->>'resolved')::integer
          <> (p_plan->'global_projected'->>'resolved')::integer
     or (p_plan->'global_before'->>'resolved_by_exact_url')::integer
          - p_expected_count
          <> (p_plan->'global_projected'->>'resolved_by_exact_url')::integer
     or (p_plan->'global_before'->>'resolved_by_id')::integer
          + p_expected_count
          <> (p_plan->'global_projected'->>'resolved_by_id')::integer
     or (p_plan->'global_before'->>'failure_count')::integer
          <> p_expected_global_failures
     or (p_plan->'global_projected'->>'failure_count')::integer
          <> p_expected_global_failures
     or p_plan->'global_before'->>'failure_digest'
          is distinct from p_expected_global_digest
     or p_plan->'global_projected'->>'failure_digest'
          is distinct from p_expected_global_digest then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_entries) e(value)
    where jsonb_typeof(e.value) <> 'object'
       or e.value->>'surface' is distinct from 'calendar'
       or e.value->>'table' is distinct from 'calendar_posts'
       or e.value->>'component' is distinct from 'graphic'
       or e.value->>'link_column' is distinct from 'graphic_linear_issue_id'
       or e.value->>'deliverable_column' is distinct from 'graphic_deliverable_id'
       or e.value->>'operation' is distinct from 'link_existing_deliverable'
       or e.value ?| array[
         'promote_archive', 'archive_promotion', 'promotion',
         'create_deliverable', 'create_batch', 'create'
       ]
       or jsonb_typeof(e.value->'card') <> 'object'
       or jsonb_typeof(e.value->'deliverable') <> 'object'
  ) then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_entries) e(value)
    cross join lateral (select e.value->'card' as card) c
    cross join lateral (select e.value->'deliverable' as target) d
    where not (c.card ?& array[
        'client', 'id', 'status', 'graphic_status', 'updated_at', 'posted_at',
        'graphic_linear_issue_id', 'graphic_linear_issue_canonical',
        'graphic_deliverable_id', 'graphic_tweaks', 'graphic_comments_sha256',
        'graphic_comments_count', 'native_comment_count',
        'native_comment_digest'
      ])
       or not (d.target ?& array[
        'id', 'client_slug', 'team', 'kind', 'origin', 'card_id', 'status',
        'updated_at', 'linear_issue_uuid', 'linear_identifier',
        'linear_issue_url', 'linear_issue_canonical'
      ])
       or nullif(btrim(c.card->>'client'), '') is null
       or not exists (
         select 1
         from jsonb_array_elements_text(p_plan->'scope_clients') scoped(client_slug)
         where scoped.client_slug = c.card->>'client'
       )
       or nullif(btrim(c.card->>'id'), '') is null
       or nullif(btrim(c.card->>'graphic_linear_issue_id'), '') is null
       or nullif(btrim(c.card->>'graphic_linear_issue_canonical'), '') is null
       or nullif(btrim(d.target->>'id'), '') is null
       or nullif(btrim(d.target->>'linear_issue_url'), '') is null
       or nullif(btrim(d.target->>'linear_issue_canonical'), '') is null
       or c.card->>'graphic_linear_issue_canonical'
            is distinct from d.target->>'linear_issue_canonical'
       or jsonb_typeof(c.card->'graphic_deliverable_id') <> 'object'
       or not ((c.card->'graphic_deliverable_id') ?& array['state', 'value'])
       or c.card->'graphic_deliverable_id'->>'state' <> 'null'
       or jsonb_typeof(c.card->'graphic_deliverable_id'->'value') <> 'null'
       or coalesce(c.card->>'graphic_comments_sha256', '') !~ '^[0-9a-f]{64}$'
       or coalesce(c.card->>'native_comment_digest', '') !~ '^[0-9a-f]{64}$'
  ) then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  select count(distinct jsonb_build_array(
           e.value->'card'->>'client', e.value->'card'->>'id'
         )),
         count(distinct e.value->'deliverable'->>'id')
    into v_distinct, v_locked
  from jsonb_array_elements(v_entries) e(value);
  if v_distinct <> p_expected_count or v_locked <> p_expected_count then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  select encode(extensions.digest(convert_to(
    coalesce(string_agg(token, E'\n' order by token collate "C"), ''),
    'UTF8'
  ), 'sha256'), 'hex')
  into v_entry_population_digest
  from (
    select concat_ws(':',
      encode(convert_to(e.value->'card'->>'client', 'UTF8'), 'hex'),
      encode(convert_to(e.value->'card'->>'id', 'UTF8'), 'hex'),
      encode(convert_to('graphic', 'UTF8'), 'hex')
    ) as token
    from jsonb_array_elements(v_entries) e(value)
  ) entry_tokens;
  if v_entry_population_digest is distinct from
       p_plan->>'cohort_population_digest' then
    raise exception using errcode = 'B3P01', message = 'REFUSED_PLAN';
  end if;

  -- These short locks close the insertion races that named-row locks alone
  -- cannot close (a new competing consumer, slot occupant, or native comment).
  -- No lock changes data. Dependency tables precede their event/card sinks so
  -- row-first writers finish before this lane holds any authority lock.
  lock table public.deliverables in share row exclusive mode;
  lock table public.production_comments in share row exclusive mode;
  lock table public.deliverable_events in share row exclusive mode;
  lock table public.calendar_posts in share row exclusive mode;
  lock table public.sample_reviews in share row exclusive mode;
  lock table public.calendar_post_events in share row exclusive mode;

  -- FOR SHARE is compatible with existing authority readers, but prevents a
  -- concurrent flag update until this RPC transaction commits or aborts.
  select f.value into v_authority
  from public.syncview_runtime_flags f
  where f.key = 'prod_authority'
  for share;
  if not found
     or lower(coalesce(v_authority->>'graphics', '')) <> 'linear'
     or v_authority is distinct from p_plan->'prod_authority' then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  -- The global gate remains truthfully BLOCKED. Recompute its complete live
  -- failure multiset only after every source table is frozen, both before and
  -- after the pointer updates. Caller-supplied matching strings are not proof.
  v_global_state := public.b3_scoped_global_failure_state();
  v_expected_global_state := case p_pointer_phase
    when 'before' then p_plan->'global_before'
    else p_plan->'global_projected'
  end;
  if v_global_state is distinct from v_expected_global_state then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  perform c.client
  from public.calendar_posts c
  join (
    select e.value->'card'->>'client' as client,
           e.value->'card'->>'id' as card_id
    from jsonb_array_elements(v_entries) e(value)
  ) requested on requested.client = c.client and requested.card_id = c.id
  order by c.client, c.id
  for update of c;
  get diagnostics v_locked = row_count;
  if v_locked <> p_expected_count then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  perform d.id
  from public.deliverables d
  join (
    select e.value->'deliverable'->>'id' as deliverable_id
    from jsonb_array_elements(v_entries) e(value)
  ) requested on requested.deliverable_id = d.id
  order by d.id
  for update of d;
  get diagnostics v_locked = row_count;
  if v_locked <> p_expected_count then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  perform cl.slug
  from public.clients cl
  join jsonb_array_elements_text(p_plan->'scope_clients') requested(client)
    on requested.client = cl.slug
  order by cl.slug
  for share of cl;
  get diagnostics v_locked = row_count;
  if v_locked <> jsonb_array_length(p_plan->'scope_clients')
     or exists (
       select 1
       from public.clients cl
       join jsonb_array_elements_text(p_plan->'scope_clients') requested(client)
         on requested.client = cl.slug
       where cl.active is distinct from true
          or lower(btrim(coalesce(cl.kind, ''))) <> 'client'
     ) then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  -- The loop performs all row/content assertions. No mutation occurs until the
  -- loop has successfully validated every member of the cohort.
  for v_entry in
    select e.value
    from jsonb_array_elements(v_entries) e(value)
    order by e.value->'card'->>'client', e.value->'card'->>'id',
             e.value->'deliverable'->>'id'
  loop
    v_card := v_entry->'card';
    v_target := v_entry->'deliverable';
    v_pointer := v_card->'graphic_deliverable_id';

    select c.* into strict v_card_row
    from public.calendar_posts c
    where c.client = v_card->>'client' and c.id = v_card->>'id';

    select d.* into strict v_target_row
    from public.deliverables d
    where d.id = v_target->>'id';

    if v_card_row.status is distinct from v_card->>'status'
       or v_card_row.graphic_status is distinct from v_card->>'graphic_status'
       or v_card_row.updated_at is distinct from v_card->>'updated_at'
       or v_card_row.posted_at is distinct from v_card->>'posted_at'
       or v_card_row.graphic_tweaks is distinct from v_card->>'graphic_tweaks'
       or v_card_row.graphic_linear_issue_id
            is distinct from v_card->>'graphic_linear_issue_id'
       or nullif(btrim(coalesce(v_card_row.posted_at, '')), '') is not null
       or nullif(btrim(coalesce(v_card_row.status, '')), '') is null
       or nullif(btrim(coalesce(v_card_row.graphic_status, '')), '') is null
       or lower(btrim(coalesce(v_card_row.status, ''))) in (
         'archived', 'canceled', 'cancelled', 'duplicate', 'posted', 'published'
       )
       or lower(btrim(coalesce(v_card_row.graphic_status, ''))) in (
         'archived', 'canceled', 'cancelled', 'duplicate', 'posted', 'published'
       )
       or not exists (
         select 1 from public.clients cl
         where cl.slug = v_card_row.client and cl.active = true and cl.kind = 'client'
       ) then
      raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
    end if;

    if p_pointer_phase = 'before' then
      if v_pointer->>'state' <> 'null'
         or v_card_row.graphic_deliverable_id is not null then
        raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
      end if;
    elsif v_card_row.graphic_deliverable_id is distinct from v_target_row.id then
      raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
    end if;

    if v_target_row.client_slug is distinct from v_target->>'client_slug'
       or v_target_row.team is distinct from v_target->>'team'
       or v_target_row.kind is distinct from v_target->>'kind'
       or v_target_row.origin is distinct from v_target->>'origin'
       or v_target_row.card_id is distinct from v_target->>'card_id'
       or v_target_row.status is distinct from v_target->>'status'
       or v_target_row.updated_at
            is distinct from nullif(v_target->>'updated_at', '')::timestamptz
       or v_target_row.linear_issue_uuid
            is distinct from v_target->>'linear_issue_uuid'
       or v_target_row.linear_identifier
            is distinct from v_target->>'linear_identifier'
       or v_target_row.linear_issue_url
            is distinct from v_target->>'linear_issue_url'
       or lower(btrim(coalesce(v_target_row.team, ''))) <> 'graphics'
       or lower(btrim(coalesce(v_target_row.kind, ''))) <> 'thumbnail'
       or lower(btrim(coalesce(v_target_row.origin, ''))) <> 'calendar'
       or v_target_row.client_slug is distinct from v_card_row.client
       or v_target_row.card_id is distinct from v_card_row.id
       or lower(btrim(coalesce(v_target_row.status, ''))) in (
         'canceled', 'cancelled', 'duplicate', 'archived', 'posted', 'published'
       )
       or public.b3_scoped_raw_is_archived(v_target_row.linear_raw) then
      raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
    end if;

    -- Exact raw values are already CAS-bound above and the plan canonicals were
    -- required to agree. This independent projection compares only the two raw
    -- live values, so it adds an ambiguity refusal without redefining the
    -- runner's canonical representation.
    if public.b3_scoped_linear_url_projection(v_card_row.graphic_linear_issue_id)
         is distinct from
           public.b3_scoped_linear_url_projection(v_target_row.linear_issue_url) then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;
    v_card_identifier := upper(substring(
      v_card_row.graphic_linear_issue_id
      from '(?i)/issue/([a-z][a-z0-9]*-[0-9]+)'
    ));
    v_target_identifier := upper(substring(
      v_target_row.linear_issue_url
      from '(?i)/issue/([a-z][a-z0-9]*-[0-9]+)'
    ));
    if nullif(v_card_identifier, '') is null
       or v_card_identifier is distinct from v_target_identifier
       or (
         nullif(btrim(coalesce(v_target_row.linear_identifier, '')), '') is not null
         and upper(v_target_row.linear_identifier) is distinct from v_card_identifier
       ) then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;

    select count(*), count(*) filter (where d.id = v_target_row.id)
      into v_candidate_count, v_candidate_target_count
    from public.deliverables d
    where lower(d.client_slug) = lower(v_card_row.client)
      and lower(d.kind) = 'thumbnail'
      and not public.b3_scoped_raw_is_archived(d.linear_raw)
      and lower(btrim(coalesce(d.status, ''))) not in (
        'canceled', 'cancelled', 'duplicate', 'archived', 'posted', 'published'
      )
      and public.b3_scoped_linear_url_projection(d.linear_issue_url)
        = public.b3_scoped_linear_url_projection(v_target_row.linear_issue_url);
    if v_candidate_count <> 1 or v_candidate_target_count <> 1 then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;

    if public.b3_scoped_linear_url_projection(v_card_row.linear_issue_id)
         = public.b3_scoped_linear_url_projection(v_card_row.graphic_linear_issue_id)
       or exists (
      select 1
      from public.calendar_posts other
      where (other.client, other.id) <> (v_card_row.client, v_card_row.id)
        and lower(btrim(coalesce(other.status, ''))) not in (
          'archived', 'canceled', 'cancelled', 'duplicate'
        )
        and (
          public.b3_scoped_linear_url_projection(other.linear_issue_id)
            = public.b3_scoped_linear_url_projection(v_card_row.graphic_linear_issue_id)
          or public.b3_scoped_linear_url_projection(other.graphic_linear_issue_id)
            = public.b3_scoped_linear_url_projection(v_card_row.graphic_linear_issue_id)
        )
    ) or exists (
      select 1
      from public.deliverables other
      where other.id <> v_target_row.id
        and other.client_slug = v_card_row.client
        and lower(other.origin) = 'calendar'
        and other.card_id = v_card_row.id
        and lower(other.kind) = 'thumbnail'
    ) then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;

    -- Stage 1's reviewed cohort is legacy-comment-free. Preserve the exact raw
    -- cell (CAS above), and independently require the semantic empty-array
    -- digest/count so any newly appeared comment blocks before the update.
    if v_card->>'graphic_comments_sha256' is distinct from v_empty_digest
       or (v_card->>'graphic_comments_count')::integer <> 0
       or public.b3_scoped_comment_count(v_card_row.graphic_tweaks) <> 0 then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;

    -- This Stage-1 lane is deliberately limited to a native-comment-free
    -- cohort. Any row, including a deleted/tombstoned one, is dependent native
    -- activity and blocks both forward repair and rollback.
    select count(*) into v_native_comment_count
    from public.production_comments pc
    where pc.deliverable_id = v_target_row.id
       or (
         nullif(btrim(coalesce(v_target_row.linear_issue_uuid, '')), '') is not null
         and lower(btrim(coalesce(pc.linear_issue_uuid, '')))
           = lower(btrim(v_target_row.linear_issue_uuid))
       )
       or upper(coalesce(substring(
         btrim(coalesce(pc.linear_identifier, ''))
         from '(?i)\m([a-z]{2,5}-[0-9]+)\M'
       ), '')) = v_target_identifier;
    if (v_card->>'native_comment_count')::integer <> 0
       or v_card->>'native_comment_digest' is distinct from v_empty_digest
       or v_native_comment_count <> 0 then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;

    select count(*) into v_consumer_count
    from (
      select 1
      from public.calendar_posts c
      where c.video_deliverable_id = v_target_row.id
         or c.graphic_deliverable_id = v_target_row.id
      union all
      select 1
      from public.sample_reviews s
      where s.video_deliverable_id = v_target_row.id
         or s.graphic_deliverable_id = v_target_row.id
    ) consumers;
    if (p_pointer_phase = 'before' and v_consumer_count <> 0)
       or (p_pointer_phase = 'after' and v_consumer_count <> 1) then
      raise exception using errcode = 'B3P03', message = 'REFUSED_CROSSWALK';
    end if;
  end loop;
exception
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'B3C01', message = 'REFUSED_CONTENTION';
  when query_canceled then
    raise exception using errcode = 'B3C02', message = 'EXECUTION_INTERRUPTED';
  when sqlstate 'B3P01' or sqlstate 'B3P02' or sqlstate 'B3P03' then
    raise;
  when others then
    raise exception using errcode = 'B3P05', message = 'FAILED_INTERNAL';
end;
$fn$;

create or replace function public.b3_scoped_card_linkage_apply(
  p_plan jsonb,
  p_expected_count integer,
  p_expected_scope_digest text,
  p_expected_plan_digest text,
  p_expected_global_failures integer,
  p_expected_global_digest text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated integer;
  v_calendar_event_digest text;
  v_population_state jsonb;
  v_constraint_name text;
  v_empty_population_digest constant text :=
    encode(extensions.digest(convert_to('', 'UTF8'), 'sha256'), 'hex');
begin
  perform public.b3_scoped_card_linkage_assert_plan(
    p_plan, p_expected_count, p_expected_scope_digest, p_expected_plan_digest,
    p_expected_global_failures, p_expected_global_digest, 'before'
  );
  -- The table locks acquired by assert_plan remain held for this transaction.
  -- Recompute the broad source population under those locks and require it to
  -- equal the manifest-entry digest that assert_plan independently verified.
  -- A valid 15-row plan against 16 live eligible source rows is refused here,
  -- before the first pointer update.
  v_population_state := public.b3_scoped_cohort_population_state(
    p_plan->'scope_clients', p_plan->'entries'
  );
  if v_population_state->>'population_count' is distinct from
       p_plan->>'cohort_population_count'
     or v_population_state->>'population_digest' is distinct from
       p_plan->>'cohort_population_digest'
     or v_population_state->>'population_missing_from_entries' <> '0'
     or v_population_state->>'entries_missing_from_population' <> '0' then
    raise exception using errcode = 'B3P06', message = 'REFUSED_COHORT_POPULATION';
  end if;
  v_calendar_event_digest :=
    public.b3_scoped_calendar_event_digest(p_plan->'entries');

  update public.calendar_posts c
  set graphic_deliverable_id = requested.deliverable_id
  from (
    select e.value->'card'->>'client' as client,
           e.value->'card'->>'id' as card_id,
           e.value->'card'->'graphic_deliverable_id'->>'state' as pointer_state,
           e.value->'deliverable'->>'id' as deliverable_id
    from jsonb_array_elements(p_plan->'entries') e(value)
  ) requested
  where c.client = requested.client
    and c.id = requested.card_id
    and requested.pointer_state = 'null'
    and c.graphic_deliverable_id is null;
  get diagnostics v_updated = row_count;
  if v_updated <> p_expected_count then
    raise exception using errcode = 'B3P02', message = 'REFUSED_LIVE_DRIFT';
  end if;

  perform public.b3_scoped_card_linkage_assert_plan(
    p_plan, p_expected_count, p_expected_scope_digest, p_expected_plan_digest,
    p_expected_global_failures, p_expected_global_digest, 'after'
  );
  v_population_state := public.b3_scoped_cohort_population_state(
    p_plan->'scope_clients', p_plan->'entries'
  );
  if v_population_state->>'population_count' <> '0'
     or v_population_state->>'population_digest' is distinct from
       v_empty_population_digest then
    raise exception using errcode = 'B3P06', message = 'REFUSED_COHORT_POPULATION';
  end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, actor, role, action,
    from_status, to_status, source, payload, event_key
  ) values (
    null, null, '_system', 'b3-scoped-runner', 'service_role',
    'b3_scoped_card_linkage_apply', null, null, 'reconcile',
    jsonb_build_object(
      'contract', 'b3-scoped-card-linkage/v2',
      'applied_count', v_updated,
      'scope_digest', p_expected_scope_digest,
      'plan_digest', p_expected_plan_digest,
      'global_failure_count', p_expected_global_failures,
      'global_failure_digest', p_expected_global_digest,
      'calendar_event_digest', v_calendar_event_digest,
      'identity_fields', false,
      'mutation', 'calendar_graphic_pointer_only'
    ),
    'b3-scoped-card-linkage:' || p_expected_plan_digest
  );

  return jsonb_build_object(
    'contract', 'b3-scoped-card-linkage/v2',
    'applied_count', v_updated,
    'receipt_count', 1,
    'scope_digest', p_expected_scope_digest,
    'plan_digest', p_expected_plan_digest,
    'global_failure_count', p_expected_global_failures,
    'global_failure_digest', p_expected_global_digest,
    'calendar_event_digest', v_calendar_event_digest
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'deliverable_events_event_key_unique_idx' then
      raise exception using errcode = 'B3P04', message = 'REFUSED_REPLAY';
    end if;
    raise exception using errcode = 'B3P05', message = 'FAILED_INTERNAL';
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'B3C01', message = 'REFUSED_CONTENTION';
  when query_canceled then
    raise exception using errcode = 'B3C02', message = 'EXECUTION_INTERRUPTED';
  when sqlstate 'B3P01' or sqlstate 'B3P02' or sqlstate 'B3P03'
       or sqlstate 'B3P06'
       or sqlstate 'B3C01' or sqlstate 'B3C02' or sqlstate 'B3P05' then
    raise;
  when others then
    raise exception using errcode = 'B3P05', message = 'FAILED_INTERNAL';
end;
$fn$;

-- Exact inverse for a separately approved recovery. It accepts the same
-- private plan, requires the aggregate apply receipt, revalidates every
-- original CAS field, rejects any later deliverable event or native comment,
-- and restores each pointer to its exact original NULL state.
create or replace function public.b3_scoped_card_linkage_rollback(
  p_plan jsonb,
  p_expected_count integer,
  p_expected_scope_digest text,
  p_expected_plan_digest text,
  p_expected_global_failures integer,
  p_expected_global_digest text,
  p_expected_rollback_digest text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated integer;
  v_receipt_id bigint;
  v_expected_calendar_event_digest text;
  v_current_calendar_event_digest text;
  v_calculated_rollback_digest text;
  v_constraint_name text;
begin
  if coalesce(p_expected_rollback_digest, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = 'B3R01', message = 'ROLLBACK_INPUT_REFUSED';
  end if;

  select encode(extensions.digest(convert_to(
    'b3-scoped-card-linkage-rollback/v2' || E'\n'
    || p_expected_plan_digest || E'\n'
    || coalesce(string_agg(token, E'\n' order by token collate "C"), ''),
    'UTF8'
  ), 'sha256'), 'hex')
  into v_calculated_rollback_digest
  from (
    select concat_ws(':',
      encode(convert_to(coalesce(e.value->'card'->>'client', ''), 'UTF8'), 'hex'),
      encode(convert_to(coalesce(e.value->'card'->>'id', ''), 'UTF8'), 'hex'),
      encode(convert_to(
        coalesce(e.value->'card'->'graphic_deliverable_id'->>'state', ''),
        'UTF8'
      ), 'hex'),
      encode(convert_to(case
        when e.value->'card'->'graphic_deliverable_id'->>'state' = 'null'
          then '<NULL>'
        else coalesce(e.value->'card'->'graphic_deliverable_id'->>'value', '')
      end, 'UTF8'), 'hex'),
      encode(convert_to(coalesce(e.value->'deliverable'->>'id', ''), 'UTF8'), 'hex')
    ) as token
    from jsonb_array_elements(coalesce(p_plan->'entries', '[]'::jsonb)) e(value)
  ) rollback_tokens;
  if v_calculated_rollback_digest is distinct from p_expected_rollback_digest then
    raise exception using errcode = 'B3R01', message = 'ROLLBACK_INPUT_REFUSED';
  end if;

  begin
    perform public.b3_scoped_card_linkage_assert_plan(
      p_plan, p_expected_count, p_expected_scope_digest, p_expected_plan_digest,
      p_expected_global_failures, p_expected_global_digest, 'after'
    );
  exception
    when sqlstate 'B3P01' then
      raise exception using errcode = 'B3R01', message = 'ROLLBACK_INPUT_REFUSED';
    when sqlstate 'B3P02' then
      raise exception using errcode = 'B3R04', message = 'ROLLBACK_STATE_REFUSED';
    when sqlstate 'B3P03' then
      raise exception using errcode = 'B3R03', message = 'ROLLBACK_ACTIVITY_REFUSED';
    when sqlstate 'B3P05' then
      raise exception using errcode = 'B3R06', message = 'ROLLBACK_FAILED_INTERNAL';
  end;

  begin
    select e.id, e.payload->>'calendar_event_digest'
      into strict v_receipt_id, v_expected_calendar_event_digest
    from public.deliverable_events e
    where e.event_key = 'b3-scoped-card-linkage:' || p_expected_plan_digest
      and e.action = 'b3_scoped_card_linkage_apply'
      and e.payload->>'scope_digest' = p_expected_scope_digest
      and e.payload->>'plan_digest' = p_expected_plan_digest
      and e.payload->>'applied_count' = p_expected_count::text
      and e.payload->>'global_failure_count' = p_expected_global_failures::text
      and e.payload->>'global_failure_digest' = p_expected_global_digest
    for update;
  exception
    when no_data_found or too_many_rows then
      raise exception using errcode = 'B3R02', message = 'ROLLBACK_RECEIPT_REFUSED';
  end;

  if exists (
    select 1
    from public.deliverable_events later
    where later.id > v_receipt_id
      and later.deliverable_id in (
        select e.value->'deliverable'->>'id'
        from jsonb_array_elements(p_plan->'entries') e(value)
      )
  ) then
    raise exception using errcode = 'B3R03', message = 'ROLLBACK_ACTIVITY_REFUSED';
  end if;
  v_current_calendar_event_digest :=
    public.b3_scoped_calendar_event_digest(p_plan->'entries');
  if coalesce(v_expected_calendar_event_digest, '')
       is distinct from v_current_calendar_event_digest then
    raise exception using errcode = 'B3R03', message = 'ROLLBACK_ACTIVITY_REFUSED';
  end if;

  update public.calendar_posts c
  set graphic_deliverable_id = null
  from (
    select e.value->'card'->>'client' as client,
           e.value->'card'->>'id' as card_id,
           e.value->'card'->'graphic_deliverable_id'->>'state' as pointer_state,
           e.value->'deliverable'->>'id' as deliverable_id
    from jsonb_array_elements(p_plan->'entries') e(value)
  ) requested
  where c.client = requested.client
    and c.id = requested.card_id
    and requested.pointer_state = 'null'
    and c.graphic_deliverable_id = requested.deliverable_id;
  get diagnostics v_updated = row_count;
  if v_updated <> p_expected_count then
    raise exception using errcode = 'B3R04', message = 'ROLLBACK_STATE_REFUSED';
  end if;

  begin
    perform public.b3_scoped_card_linkage_assert_plan(
      p_plan, p_expected_count, p_expected_scope_digest, p_expected_plan_digest,
      p_expected_global_failures, p_expected_global_digest, 'before'
    );
  exception
    when sqlstate 'B3P01' then
      raise exception using errcode = 'B3R01', message = 'ROLLBACK_INPUT_REFUSED';
    when sqlstate 'B3P02' or sqlstate 'B3P03' then
      raise exception using errcode = 'B3R04', message = 'ROLLBACK_STATE_REFUSED';
    when sqlstate 'B3P05' then
      raise exception using errcode = 'B3R06', message = 'ROLLBACK_FAILED_INTERNAL';
  end;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, actor, role, action,
    from_status, to_status, source, payload, event_key
  ) values (
    null, null, '_system', 'b3-scoped-runner', 'service_role',
    'b3_scoped_card_linkage_rollback', null, null, 'reconcile',
    jsonb_build_object(
      'contract', 'b3-scoped-card-linkage/v2',
      'restored_count', v_updated,
      'scope_digest', p_expected_scope_digest,
      'plan_digest', p_expected_plan_digest,
      'rollback_digest', p_expected_rollback_digest,
      'identity_fields', false,
      'mutation', 'calendar_graphic_pointer_inverse_only'
    ),
    'b3-scoped-card-linkage-rollback:' || p_expected_rollback_digest
  );

  return jsonb_build_object(
    'contract', 'b3-scoped-card-linkage/v2',
    'restored_count', v_updated,
    'receipt_count', 1,
    'scope_digest', p_expected_scope_digest,
    'plan_digest', p_expected_plan_digest,
    'rollback_digest', p_expected_rollback_digest
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint_name = constraint_name;
    if v_constraint_name = 'deliverable_events_event_key_unique_idx' then
      raise exception using errcode = 'B3R05', message = 'ROLLBACK_REPLAY_REFUSED';
    end if;
    raise exception using errcode = 'B3R06', message = 'ROLLBACK_FAILED_INTERNAL';
  when lock_not_available or deadlock_detected or serialization_failure then
    raise exception using errcode = 'B3C01', message = 'REFUSED_CONTENTION';
  when query_canceled then
    raise exception using errcode = 'B3C02', message = 'EXECUTION_INTERRUPTED';
  when sqlstate 'B3R01' or sqlstate 'B3R02' or sqlstate 'B3R03'
       or sqlstate 'B3R04' or sqlstate 'B3R05' or sqlstate 'B3R06'
       or sqlstate 'B3C01' or sqlstate 'B3C02' then
    raise;
  when others then
    raise exception using errcode = 'B3R06', message = 'ROLLBACK_FAILED_INTERNAL';
end;
$fn$;

-- Helpers are callable only by their SECURITY DEFINER owners. The three
-- explicit RPCs are service-role-only; browsers receive no execution path.
revoke all on function public.b3_scoped_linear_url_projection(text)
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_comment_count(text)
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_raw_is_archived(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_global_failure_state()
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_cohort_population_state(jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_calendar_event_digest(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_card_linkage_preflight()
  from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_card_linkage_assert_plan(
  jsonb, integer, text, text, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_card_linkage_apply(
  jsonb, integer, text, text, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.b3_scoped_card_linkage_rollback(
  jsonb, integer, text, text, integer, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.b3_scoped_card_linkage_apply(
  jsonb, integer, text, text, integer, text
) to service_role;
grant execute on function public.b3_scoped_card_linkage_preflight()
  to service_role;
grant execute on function public.b3_scoped_card_linkage_rollback(
  jsonb, integer, text, text, integer, text, text
) to service_role;

-- Installation-time ACL self-check only. It invokes no repair function and
-- reads/writes no card, deliverable, authority, comment, event, or flag row.
do $check$
begin
  if to_regprocedure(
       'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)'
     ) is null
     or to_regprocedure(
       'public.b3_scoped_card_linkage_preflight()'
     ) is null
     or to_regprocedure(
       'public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)'
     ) is null
     or to_regprocedure(
       'public.b3_scoped_calendar_event_digest(jsonb)'
     ) is null
     or to_regprocedure(
       'public.b3_scoped_cohort_population_state(jsonb,jsonb)'
     ) is null
     or not has_function_privilege(
       'service_role',
       'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.b3_scoped_card_linkage_preflight()',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.b3_scoped_card_linkage_apply(jsonb,integer,text,text,integer,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.b3_scoped_card_linkage_preflight()',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.b3_scoped_card_linkage_preflight()',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.b3_scoped_card_linkage_rollback(jsonb,integer,text,text,integer,text,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.b3_scoped_calendar_event_digest(jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.b3_scoped_calendar_event_digest(jsonb)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.b3_scoped_calendar_event_digest(jsonb)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.b3_scoped_cohort_population_state(jsonb,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.b3_scoped_cohort_population_state(jsonb,jsonb)',
       'execute'
     )
     or has_function_privilege(
       'service_role',
       'public.b3_scoped_cohort_population_state(jsonb,jsonb)',
       'execute'
     ) then
    raise exception 'b3_scoped_acl_self_check_failed';
  end if;
end;
$check$;

commit;

-- OWNER-ONLY SCHEMA ROLLBACK (does not reverse an applied data repair):
-- begin;
-- revoke all on function public.b3_scoped_card_linkage_apply(
--   jsonb, integer, text, text, integer, text
-- ) from public, anon, authenticated, service_role;
-- revoke all on function public.b3_scoped_card_linkage_rollback(
--   jsonb, integer, text, text, integer, text, text
-- ) from public, anon, authenticated, service_role;
-- drop function if exists public.b3_scoped_card_linkage_rollback(
--   jsonb, integer, text, text, integer, text, text
-- );
-- drop function if exists public.b3_scoped_card_linkage_apply(
--   jsonb, integer, text, text, integer, text
-- );
-- drop function if exists public.b3_scoped_card_linkage_preflight();
-- drop function if exists public.b3_scoped_card_linkage_assert_plan(
--   jsonb, integer, text, text, integer, text, text
-- );
-- drop function if exists public.b3_scoped_calendar_event_digest(jsonb);
-- drop function if exists public.b3_scoped_cohort_population_state(jsonb, jsonb);
-- drop function if exists public.b3_scoped_global_failure_state();
-- drop function if exists public.b3_scoped_raw_is_archived(jsonb);
-- drop function if exists public.b3_scoped_comment_count(text);
-- drop function if exists public.b3_scoped_linear_url_projection(text);
-- commit;
