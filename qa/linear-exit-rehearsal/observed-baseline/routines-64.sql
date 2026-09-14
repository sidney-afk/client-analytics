CREATE OR REPLACE FUNCTION public._calmerge_comment_cell(p_existing text, p_incoming text, p_base text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_ex jsonb := '[]'::jsonb;
  v_inc jsonb := '[]'::jsonb;
  v_all jsonb;
  v_result jsonb;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  begin v_ex  := coalesce(nullif(btrim(coalesce(p_existing,'')),'')::jsonb, '[]'::jsonb); exception when others then v_ex  := '[]'::jsonb; end;
  begin v_inc := coalesce(nullif(btrim(coalesce(p_incoming,'')),'')::jsonb, '[]'::jsonb); exception when others then v_inc := '[]'::jsonb; end;
  if jsonb_typeof(v_ex)  <> 'array' then v_ex  := '[]'::jsonb; end if;
  if jsonb_typeof(v_inc) <> 'array' then v_inc := '[]'::jsonb; end if;
  v_all := v_ex || v_inc;  -- existing first, incoming second (incoming wins stamp ties)

  with elems as (
    select e.elem,
           e.elem->>'id' as id,
           coalesce(e.elem->>'updated_at', e.elem->>'created_at', '') as ts,
           e.ord
    from jsonb_array_elements(v_all) with ordinality as e(elem, ord)
    where (e.elem ? 'id') and coalesce(e.elem->>'id','') <> ''
  ),
  ranked as (
    select elem, id, ts, ord,
           row_number() over (partition by id order by ts desc, ord desc) as rn,
           min(ord) over (partition by id) as first_ord
    from elems
  ),
  kept as (
    select elem, first_ord from ranked r
    where r.rn = 1 and not _calmerge_is_expired_tomb(r.elem, v_cutoff)
  )
  select coalesce(jsonb_agg(elem order by first_ord), '[]'::jsonb) into v_result from kept;

  if v_result is null or jsonb_array_length(v_result) = 0 then return ''; end if;
  return v_result::text;
end;
$function$

;
CREATE OR REPLACE FUNCTION public._calmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$function$

;
CREATE OR REPLACE FUNCTION public._sxrmerge_comment_cell(p_existing text, p_incoming text, p_base text DEFAULT ''::text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v_ex jsonb := '[]'::jsonb;
  v_inc jsonb := '[]'::jsonb;
  v_all jsonb;
  v_result jsonb;
  v_cutoff timestamptz := now() - interval '30 days';
begin
  begin v_ex  := coalesce(nullif(btrim(coalesce(p_existing,'')),'')::jsonb, '[]'::jsonb); exception when others then v_ex  := '[]'::jsonb; end;
  begin v_inc := coalesce(nullif(btrim(coalesce(p_incoming,'')),'')::jsonb, '[]'::jsonb); exception when others then v_inc := '[]'::jsonb; end;
  if jsonb_typeof(v_ex)  <> 'array' then v_ex  := '[]'::jsonb; end if;
  if jsonb_typeof(v_inc) <> 'array' then v_inc := '[]'::jsonb; end if;
  v_all := v_ex || v_inc;  -- existing first, incoming second (incoming wins stamp ties)

  with elems as (
    select e.elem,
           e.elem->>'id' as id,
           coalesce(e.elem->>'updated_at', e.elem->>'created_at', '') as ts,
           e.ord
    from jsonb_array_elements(v_all) with ordinality as e(elem, ord)
    where (e.elem ? 'id') and coalesce(e.elem->>'id','') <> ''
  ),
  ranked as (
    select elem, id, ts, ord,
           row_number() over (partition by id order by ts desc, ord desc) as rn,
           min(ord) over (partition by id) as first_ord
    from elems
  ),
  kept as (
    select elem, first_ord from ranked r
    where r.rn = 1 and not _sxrmerge_is_expired_tomb(r.elem, v_cutoff)
  )
  select coalesce(jsonb_agg(elem order by first_ord), '[]'::jsonb) into v_result from kept;

  if v_result is null or jsonb_array_length(v_result) = 0 then return ''; end if;
  return v_result::text;
end;
$function$

;
CREATE OR REPLACE FUNCTION public._sxrmerge_is_expired_tomb(p_elem jsonb, p_cutoff timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare v_ts timestamptz; v_s text;
begin
  if not coalesce((p_elem->>'deleted')::boolean, false) then return false; end if;
  v_s := coalesce(p_elem->>'updated_at', p_elem->>'created_at');
  if v_s is null or v_s = '' then return false; end if;
  begin v_ts := v_s::timestamptz; exception when others then return false; end;
  return v_ts < p_cutoff;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_calendar_event_digest(p_entries jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_raw_is_archived(p_raw jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_linear_url_projection(p_value text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_global_failure_state()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_comment_count(p_value text)
 RETURNS integer
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'pg_catalog'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_card_linkage_assert_plan(p_plan jsonb, p_expected_count integer, p_expected_scope_digest text, p_expected_plan_digest text, p_expected_global_failures integer, p_expected_global_digest text, p_pointer_phase text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '5s'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_cohort_population_state(p_scope_clients jsonb, p_entries jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_card_linkage_apply(p_plan jsonb, p_expected_count integer, p_expected_scope_digest text, p_expected_plan_digest text, p_expected_global_failures integer, p_expected_global_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_card_linkage_preflight()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.b3_scoped_card_linkage_rollback(p_plan jsonb, p_expected_count integer, p_expected_scope_digest text, p_expected_plan_digest text, p_expected_global_failures integer, p_expected_global_digest text, p_expected_rollback_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.batch_b4_comment_write(p_id text, p_comments text, p_base text, p_event jsonb)
 RETURNS batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_result public.batches%rowtype;
begin
 if nullif(btrim(coalesce(p_id,'')),'') is null or p_comments is null then raise exception 'incomplete batch comment write'; end if;
 perform set_config('app.event_written','1',true);
 update public.batches b set comments=public._calmerge_comment_cell(b.comments,p_comments,coalesce(p_base,'')),updated_at=now() where b.id=p_id returning * into v_result;
 if v_result.id is null then raise exception 'batch not found'; end if;
 insert into public.deliverable_events(deliverable_id,batch_id,client_slug,ts,actor,role,action,from_status,to_status,source,payload)
 values(null,v_result.id,v_result.client_slug,coalesce(nullif(v_event->>'ts','')::timestamptz,now()),nullif(v_event->>'actor',''),nullif(v_event->>'role',''),coalesce(nullif(v_event->>'action',''),'comment_change'),v_result.status,v_result.status,coalesce(nullif(v_event->>'source',''),'ui'),v_event);
 return v_result;
end;$function$

;
CREATE OR REPLACE FUNCTION public.batch_write(p_row jsonb, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_id text := nullif(v_row->>'id', '');
  v_old_status text;
  v_result public.batches%rowtype;
  v_action text;
begin
  if v_id is null then
    v_id := 'bat_' || replace(gen_random_uuid()::text, '-', '');
  end if;

  select b.status into v_old_status
    from public.batches b
   where b.id = v_id
   for update;

  perform set_config('app.event_written', '1', true);

  insert into public.batches as b (
    id, client_slug, team, name, description, filming_doc_url,
    footage_folder_url, delivery_folder_url, color, status,
    purpose,
    comments, sort_key, created_by, created_at, updated_at, linear_parent_ids
  )
  values (
    v_id,
    nullif(v_row->>'client_slug', ''),
    nullif(v_row->>'team', ''),
    coalesce(nullif(v_row->>'name', ''), 'Untitled batch'),
    nullif(v_row->>'description', ''),
    nullif(v_row->>'filming_doc_url', ''),
    nullif(v_row->>'footage_folder_url', ''),
    nullif(v_row->>'delivery_folder_url', ''),
    nullif(v_row->>'color', ''),
    coalesce(nullif(v_row->>'status', ''), 'active'),
    coalesce(nullif(v_row->>'purpose', ''), 'calendar'),
    nullif(v_row->>'comments', ''),
    nullif(v_row->>'sort_key', '')::numeric,
    nullif(v_row->>'created_by', ''),
    coalesce(nullif(v_row->>'created_at', '')::timestamptz, now()),
    now(),
    nullif(v_row->'linear_parent_ids', 'null'::jsonb)
  )
  on conflict (id) do update set
    client_slug = case when v_row ? 'client_slug' then excluded.client_slug else b.client_slug end,
    team = case when v_row ? 'team' then excluded.team else b.team end,
    name = case when v_row ? 'name' then excluded.name else b.name end,
    description = case when v_row ? 'description' then excluded.description else b.description end,
    filming_doc_url = case when v_row ? 'filming_doc_url' then excluded.filming_doc_url else b.filming_doc_url end,
    footage_folder_url = case when v_row ? 'footage_folder_url' then excluded.footage_folder_url else b.footage_folder_url end,
    delivery_folder_url = case when v_row ? 'delivery_folder_url' then excluded.delivery_folder_url else b.delivery_folder_url end,
    color = case when v_row ? 'color' then excluded.color else b.color end,
    status = case when v_row ? 'status' then excluded.status else b.status end,
    purpose = case when v_row ? 'purpose' then excluded.purpose else b.purpose end,
    comments = case when v_row ? 'comments' then excluded.comments else b.comments end,
    sort_key = case when v_row ? 'sort_key' then excluded.sort_key else b.sort_key end,
    created_by = case when v_row ? 'created_by' then excluded.created_by else b.created_by end,
    created_at = case when v_row ? 'created_at' then excluded.created_at else b.created_at end,
    updated_at = now(),
    linear_parent_ids = case when v_row ? 'linear_parent_ids' then excluded.linear_parent_ids else b.linear_parent_ids end
  returning * into v_result;

  v_action := coalesce(
    nullif(v_event->>'action', ''),
    case
      when v_old_status is null then 'batch_create'
      when v_old_status is distinct from v_result.status then 'batch_status_change'
      else 'batch_change'
    end
  );

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role,
    action, from_status, to_status, source, payload
  )
  values (
    null,
    v_result.id,
    v_result.client_slug,
    coalesce(nullif(v_event->>'ts', '')::timestamptz, now()),
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_action,
    coalesce(nullif(v_event->>'from_status', ''), v_old_status),
    coalesce(nullif(v_event->>'to_status', ''), case when v_old_status is distinct from v_result.status then v_result.status else null end),
    coalesce(nullif(v_event->>'source', ''), 'ui'),
    v_event
  );

  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.calendar_merge_comments(p_client text, p_id text, p_video text DEFAULT NULL::text, p_graphic text DEFAULT NULL::text, p_caption text DEFAULT NULL::text, p_title text DEFAULT NULL::text, p_base text DEFAULT ''::text)
 RETURNS SETOF calendar_posts
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  update calendar_posts c set
    video_tweaks   = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    tweaks         = case when p_video   is not null then _calmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.tweaks         end,
    graphic_tweaks = case when p_graphic is not null then _calmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    caption_tweaks = case when p_caption is not null then _calmerge_comment_cell(c.caption_tweaks, p_caption, coalesce(p_base,'')) else c.caption_tweaks end,
    title_tweaks   = case when p_title   is not null then _calmerge_comment_cell(c.title_tweaks,   p_title,   coalesce(p_base,'')) else c.title_tweaks   end,
    updated_at     = now()
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.calendar_posts_stamp_status_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    new.video_status_at   := coalesce(new.video_status_at,   now());
    new.graphic_status_at := coalesce(new.graphic_status_at, now());
    new.caption_status_at := coalesce(new.caption_status_at, now());
    new.title_status_at   := coalesce(new.title_status_at,   now());
  else
    if new.video_status   is distinct from old.video_status   then
      new.video_status_at := now();
    end if;
    if new.graphic_status is distinct from old.graphic_status then
      new.graphic_status_at := now();
    end if;
    if new.caption_status is distinct from old.caption_status then
      new.caption_status_at := now();
    end if;
    if new.title_status   is distinct from old.title_status   then
      new.title_status_at := now();
    end if;
  end if;
  return new;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.client_access_mint_review_token()
 RETURNS text
 LANGUAGE sql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  select translate(
    replace(encode(gen_random_bytes(24), 'base64'), E'\n', ''),
    '+/',
    '-_'
  );
$function$

;
CREATE OR REPLACE FUNCTION public.client_access_provision_for_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- Internal bookkeeping rows are never shared with a client; the B0 seeder
  -- skipped them for the same reason.
  if new.kind = 'internal' then
    return new;
  end if;

  insert into public.client_access (slug, review_token, notes)
  values (
    new.slug,
    public.client_access_mint_review_token(),
    'Auto-provisioned on client creation'
  )
  on conflict (slug) do nothing;

  return new;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.crosswalk_linear_identifier(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    upper((regexp_match(coalesce(p_value, ''), '/issue/([A-Za-z][A-Za-z0-9]*-[0-9]+)'))[1]),
    upper((regexp_match(btrim(coalesce(p_value, '')), '^([A-Za-z][A-Za-z0-9]*-[0-9]+)$'))[1]),
    ''
  );
$function$

;
CREATE OR REPLACE FUNCTION public.deliverable_b4_comment_write(p_id text, p_comments text, p_base text, p_event jsonb)
 RETURNS deliverables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_result public.deliverables%rowtype;
begin
 if nullif(btrim(coalesce(p_id,'')),'') is null or p_comments is null then raise exception 'incomplete deliverable comment write'; end if;
 perform set_config('app.event_written','1',true);
 update public.deliverables d set comments=public._calmerge_comment_cell(d.comments,p_comments,coalesce(p_base,'')),updated_at=now() where d.id=p_id returning * into v_result;
 if v_result.id is null then raise exception 'deliverable not found'; end if;
 insert into public.deliverable_events(deliverable_id,batch_id,client_slug,ts,actor,role,action,from_status,to_status,source,payload)
 values(v_result.id,v_result.batch_id,v_result.client_slug,coalesce(nullif(v_event->>'ts','')::timestamptz,now()),nullif(v_event->>'actor',''),nullif(v_event->>'role',''),coalesce(nullif(v_event->>'action',''),'comment_change'),v_result.status,v_result.status,coalesce(nullif(v_event->>'source',''),'ui'),v_event);
 return v_result;
end;$function$

;
CREATE OR REPLACE FUNCTION public.hiring_authorize_invite_send_v1(p_job_id uuid, p_claim_token uuid)
 RETURNS TABLE(authorized boolean, application_id uuid, recipient_email text, subject text, body text, interview_event_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.hiring_invite_jobs%rowtype;
  v_enabled boolean := false;
begin
  -- Lock the one-step flag before the job so an explicit disable cannot pass
  -- unnoticed during the authorization transaction.
  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled'
   for share;

  select * into v_job
    from public.hiring_invite_jobs
   where id = p_job_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'invite_not_found';
  end if;
  if v_job.state <> 'dispatching' or v_job.claim_token is distinct from p_claim_token then
    raise exception using errcode = 'P0001', message = 'claim_conflict';
  end if;
  if v_job.send_authorized_at is not null
     and (v_job.claimed_at is null or v_job.send_authorized_at >= v_job.claimed_at) then
    raise exception using errcode = 'P0001', message = 'send_already_authorized';
  end if;

  if not coalesce(v_enabled, false) then
    -- No provider call is authorized. Returning the job to queued lets the
    -- dispatcher resume only after an explicit later re-enable.
    update public.hiring_invite_jobs
       set state = 'queued',
           claim_token = null,
           claimed_at = null,
           send_authorized_at = null
     where id = v_job.id;
    return query select false, null::uuid, null::text, null::text, null::text, null::text;
    return;
  end if;

  update public.hiring_invite_jobs
     set send_authorized_at = now()
   where id = v_job.id
   returning * into v_job;

  return query select true, v_job.application_id, v_job.recipient_email, v_job.subject,
                      v_job.body, v_job.interview_event_url;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.hiring_claim_next_invite_v1(p_worker_id text)
 RETURNS TABLE(job_id uuid, claim_token uuid, application_id uuid, recipient_email text, subject text, body text, interview_event_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.hiring_invite_jobs%rowtype;
  v_worker text := btrim(coalesce(p_worker_id, ''));
  v_enabled boolean := false;
begin
  if v_worker = '' then
    raise exception using errcode = 'P0001', message = 'invalid_worker';
  end if;

  select value = '{"enabled": true}'::jsonb
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
  if not coalesce(v_enabled, false) then
    return;
  end if;

  with stale as (
    update public.hiring_invite_jobs as j
       set state = 'delivery_uncertain',
           claim_token = null,
           failure_code = 'dispatch_timeout'
     where j.state = 'dispatching'
       and coalesce(j.claimed_at, j.created_at) < now() - interval '30 minutes'
     returning j.id, j.application_id
  )
  insert into public.hiring_application_events (application_id, event_type, metadata)
  select s.application_id, 'invite_delivery_uncertain', jsonb_build_object('job_id', s.id, 'failure_code', 'dispatch_timeout')
    from stale s;

  select * into v_job
    from public.hiring_invite_jobs
   where state = 'queued'
   order by created_at asc
   for update skip locked
   limit 1;
  if not found then return; end if;

  update public.hiring_invite_jobs
     set state = 'dispatching',
         claim_token = gen_random_uuid(),
         claimed_at = now(),
         send_authorized_at = null,
         attempt_count = attempt_count + 1,
         failure_code = null
   where id = v_job.id
   returning * into v_job;
  return query select v_job.id, v_job.claim_token, v_job.application_id, v_job.recipient_email,
                      v_job.subject, v_job.body, v_job.interview_event_url;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.hiring_queue_interview_invite_v1(p_application_id uuid, p_expected_state_version bigint, p_recipient_email text, p_subject text, p_body text, p_interview_event_url text, p_actor text)
 RETURNS TABLE(job_id uuid, job_state text, existing boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_application public.hiring_applications%rowtype;
  v_job public.hiring_invite_jobs%rowtype;
  v_enabled boolean := false;
  v_actor text := btrim(coalesce(p_actor, ''));
begin
  select coalesce(value ->> 'enabled', 'false') = 'true'
    into v_enabled
    from public.syncview_runtime_flags
   where key = 'hiring_invites_enabled';
  if not coalesce(v_enabled, false) then
    raise exception using errcode = 'P0001', message = 'feature_disabled';
  end if;
  if v_actor = '' or position('@' in coalesce(p_recipient_email, '')) <= 1
    or btrim(coalesce(p_subject, '')) = '' or btrim(coalesce(p_body, '')) = '' then
    raise exception using errcode = 'P0001', message = 'invalid_invite';
  end if;

  select * into v_application
    from public.hiring_applications
   where id = p_application_id
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'application_not_found';
  end if;
  if v_application.state_version <> p_expected_state_version then
    raise exception using errcode = 'P0001', message = 'state_conflict';
  end if;
  if v_application.status in ('rejected', 'withdrawn', 'invited', 'interview_booked') then
    raise exception using errcode = 'P0001', message = 'terminal_status';
  end if;
  if lower(btrim(coalesce(p_recipient_email, ''))) <> lower(v_application.email) then
    raise exception using errcode = 'P0001', message = 'recipient_conflict';
  end if;
  if btrim(coalesce(p_interview_event_url, ''))
       <> 'https://app.iclosed.io/e/synchrosocial/client-success-content-manager-interview' then
    raise exception using errcode = 'P0001', message = 'invalid_interview_event';
  end if;

  select * into v_job
    from public.hiring_invite_jobs
   where application_id = v_application.id
   for update;
  if found then
    return query select v_job.id, v_job.state, true;
    return;
  end if;

  insert into public.hiring_invite_jobs (
    application_id, recipient_email, subject, body, interview_event_url, requested_by
  ) values (
    v_application.id, lower(btrim(p_recipient_email)), btrim(p_subject), p_body,
    btrim(p_interview_event_url), v_actor
  ) returning * into v_job;

  update public.hiring_applications
     set status = case when status = 'new' then 'reviewing' else status end,
         state_version = state_version + 1,
         reviewed_by = v_actor,
         reviewed_at = now()
   where id = v_application.id;
  insert into public.hiring_application_events (application_id, event_type, actor, metadata)
  values (v_application.id, 'invite_queued', v_actor, jsonb_build_object('job_id', v_job.id));

  return query select v_job.id, v_job.state, false;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.linear_archive_asset_ref_write(p_ref jsonb, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_rescue_capability text DEFAULT NULL::text)
 RETURNS linear_archive_asset_refs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ref jsonb := coalesce(p_ref, '{}'::jsonb);
  v_ref_id text := nullif(btrim(v_ref->>'ref_id'), '');
  v_linear_uuid text := nullif(btrim(v_ref->>'linear_uuid'), '');
  v_source_kind text := nullif(btrim(v_ref->>'source_kind'), '');
  v_location_key text := nullif(btrim(v_ref->>'location_key'), '');
  v_original_url text := nullif(btrim(v_ref->>'original_url'), '');
  v_hash text;
  v_state text := lower(coalesce(nullif(btrim(v_ref->>'state'), ''), 'pending'));
  v_rescued_url text := nullif(btrim(v_ref->>'rescued_url'), '');
  v_deliverable_id text := nullif(btrim(v_ref->>'deliverable_id'), '');
  v_comment_id text := nullif(btrim(v_ref->>'comment_id'), '');
  v_client_slug text;
  v_team text;
  v_audience text;
  v_media_type text := nullif(btrim(v_ref->>'media_type'), '');
  v_last_error_code text := nullif(btrim(v_ref->>'last_error_code'), '');
  v_reviewed_by text := nullif(btrim(v_ref->>'reviewed_by'), '');
  v_review_note text := nullif(btrim(v_ref->>'review_note'), '');
  v_owner_evidence jsonb := v_ref->'owner_evidence';
  v_destination_provider text := nullif(btrim(v_ref->>'destination_provider'), '');
  v_destination_folder_id text := nullif(btrim(v_ref->>'destination_folder_id'), '');
  v_destination_file_id text := nullif(btrim(v_ref->>'destination_file_id'), '');
  v_content_sha256 text := lower(nullif(btrim(v_ref->>'content_sha256'), ''));
  v_byte_length_text text := nullif(btrim(v_ref->>'byte_length'), '');
  v_byte_length bigint;
  v_verified_at_text text := nullif(btrim(v_ref->>'verified_at'), '');
  v_verified_at timestamptz;
  v_verification_receipt_hmac text :=
    lower(nullif(btrim(v_ref->>'verification_receipt_hmac'), ''));
  v_expected_receipt_hmac text;
  v_receipt_material text;
  v_config public.linear_archive_asset_rescue_config%rowtype;
  v_archive public.linear_archive%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_comment public.production_comments%rowtype;
  v_existing public.linear_archive_asset_refs%rowtype;
  v_result public.linear_archive_asset_refs%rowtype;
begin
  v_hash := encode(
    extensions.digest(convert_to(coalesce(v_original_url, ''), 'UTF8'), 'sha256'),
    'hex'
  );
  if v_source_kind = 'operational_brief' then
    if v_deliverable_id is null then
      raise exception 'archive_asset_deliverable_required';
    end if;
    select d.* into v_deliverable
    from public.deliverables d
    where d.id = v_deliverable_id
      and d.linear_issue_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_deliverable_scope_invalid'; end if;
    v_comment_id := null;
    v_client_slug := nullif(btrim(v_deliverable.client_slug), '');
    v_team := nullif(lower(btrim(v_deliverable.team)), '');
    v_audience := 'internal';
    if position(v_original_url in coalesce(v_deliverable.brief, '')) = 0 then
      raise exception 'archive_asset_source_mismatch';
    end if;
  elsif v_source_kind in ('normalized_comment_body', 'comment_attachment') then
    v_deliverable_id := null;
    if v_comment_id is null then raise exception 'archive_asset_comment_required'; end if;
    select c.* into v_comment
    from public.production_comments c
    where c.id = v_comment_id
      and c.linear_issue_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_comment_scope_invalid'; end if;
    v_client_slug := nullif(btrim(v_comment.client_slug), '');
    v_team := nullif(lower(btrim(v_comment.team)), '');
    v_audience := lower(v_comment.audience);
    if (v_source_kind = 'normalized_comment_body'
          and position(v_original_url in coalesce(v_comment.body, '')) = 0)
       or (v_source_kind = 'comment_attachment'
          and position(v_original_url in coalesce(v_comment.attachments::text, '')) = 0) then
      raise exception 'archive_asset_source_mismatch';
    end if;
  else
    v_deliverable_id := null;
    v_comment_id := null;
    select a.* into v_archive
    from public.linear_archive a
    where a.linear_uuid = v_linear_uuid;
    if not found then raise exception 'archive_asset_issue_not_found'; end if;
    v_client_slug := nullif(btrim(v_archive.client_slug), '');
    v_team := nullif(lower(btrim(v_archive.team)), '');
    v_audience := 'internal';
    if position(v_original_url in to_jsonb(v_archive)::text) = 0 then
      raise exception 'archive_asset_source_mismatch';
    end if;
  end if;

  if v_state = 'rescued' then
    if v_byte_length_text !~ '^[1-9][0-9]{0,7}$'
       or v_verified_at_text is null
       or v_verified_at_text !~
         '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?Z$' then
      raise exception 'archive_asset_certification_invalid';
    end if;
    v_byte_length := v_byte_length_text::bigint;
    v_verified_at := v_verified_at_text::timestamptz;
    select c.* into v_config
    from public.linear_archive_asset_rescue_config c
    where c.config_key = 'active'
      and c.active is true;
    if not found
       or v_destination_provider is distinct from v_config.destination_provider
       or v_destination_folder_id is distinct from v_config.approved_folder_id
       or encode(
         extensions.digest(
           convert_to(coalesce(p_rescue_capability, ''), 'UTF8'),
           'sha256'
         ),
         'hex'
       ) is distinct from v_config.rescue_capability_sha256 then
      raise exception 'archive_asset_certification_forbidden';
    end if;
    if v_destination_file_id !~ '^[A-Za-z0-9_-]{10,200}$'
       or v_content_sha256 !~ '^[a-f0-9]{64}$'
       or v_byte_length not between 1 and 52428800
       or v_verified_at > now() + interval '5 minutes'
       or v_verification_receipt_hmac !~ '^[a-f0-9]{64}$' then
      raise exception 'archive_asset_certification_invalid';
    end if;
    v_rescued_url :=
      'https://drive.google.com/file/d/' || v_destination_file_id || '/view';
    v_receipt_material := concat_ws(
      chr(31),
      v_ref_id,
      v_hash,
      v_destination_folder_id,
      v_destination_file_id,
      v_content_sha256,
      v_byte_length::text,
      v_verified_at_text
    );
    v_expected_receipt_hmac := encode(
      extensions.hmac(
        convert_to(v_receipt_material, 'UTF8'),
        convert_to(p_rescue_capability, 'UTF8'),
        'sha256'
      ),
      'hex'
    );
    if v_verification_receipt_hmac is distinct from v_expected_receipt_hmac then
      raise exception 'archive_asset_certification_invalid';
    end if;
  elsif v_state = 'owner_dispositioned' then
    select c.* into v_config
    from public.linear_archive_asset_rescue_config c
    where c.config_key = 'active'
      and c.active is true;
    if not found
       or encode(
         extensions.digest(
           convert_to(coalesce(p_rescue_capability, ''), 'UTF8'),
           'sha256'
         ),
         'hex'
       ) is distinct from v_config.rescue_capability_sha256 then
      raise exception 'archive_asset_disposition_forbidden';
    end if;
  end if;

  if v_ref_id is null or v_ref_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{7,199}$'
     or v_linear_uuid is null or v_source_kind is null or v_location_key is null
     or v_original_url is null or v_hash !~ '^[a-f0-9]{64}$'
     or lower(v_original_url) !~ '^https://uploads[.]linear[.]app/'
     or v_source_kind not in (
       'operational_brief', 'issue_description', 'archive_raw',
       'normalized_comment_body', 'comment_attachment'
     )
     or v_state not in ('pending', 'rescued', 'owner_dispositioned', 'failed')
     or (v_state = 'rescued' and (
        v_rescued_url is null
        or v_rescued_url !~ '^https://drive[.]google[.]com/file/d/[A-Za-z0-9_-]+/view$'
        or v_destination_provider is null
        or v_destination_folder_id is null
        or v_destination_file_id is null
        or v_content_sha256 is null
        or v_byte_length is null
        or v_verified_at is null
        or v_verification_receipt_hmac is null
        or v_reviewed_by is null
        or v_review_note is null
      ))
     or (v_state <> 'rescued' and (
       v_rescued_url is not null
       or v_destination_provider is not null
       or v_destination_folder_id is not null
       or v_destination_file_id is not null
       or v_content_sha256 is not null
       or v_byte_length_text is not null
       or v_verified_at_text is not null
       or v_verification_receipt_hmac is not null
     ))
     or (v_state = 'owner_dispositioned' and (
       v_reviewed_by is null
       or v_review_note is null
       or jsonb_typeof(v_owner_evidence) is distinct from 'object'
       or nullif(btrim(v_owner_evidence->>'confirmed_by'), '') is null
       or nullif(btrim(v_owner_evidence->>'confirmed_at'), '') is null
       or nullif(btrim(v_owner_evidence->>'decision'), '') is null
       or v_owner_evidence->>'confirmed_by' is distinct from v_reviewed_by
     ))
     or (v_state <> 'owner_dispositioned' and v_owner_evidence is not null)
     or v_client_slug is null
     or v_audience not in ('internal', 'client') then
    raise exception 'invalid_archive_asset_ref';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('archive-asset:' || v_ref_id, 0));
  select r.* into v_existing
  from public.linear_archive_asset_refs r
  where r.ref_id = v_ref_id
  for update;

  if found then
    if v_existing.linear_uuid is distinct from v_linear_uuid
       or v_existing.source_kind is distinct from v_source_kind
       or v_existing.location_key is distinct from v_location_key
       or v_existing.original_url_sha256 is distinct from v_hash
       or v_existing.original_url is distinct from v_original_url
       or v_existing.deliverable_id is distinct from v_deliverable_id then
      raise exception 'archive_asset_identity_conflict';
    end if;
    -- Exact retries are immutable no-ops, including terminal provenance.
    if v_existing.comment_id is not distinct from v_comment_id
       and v_existing.client_slug is not distinct from v_client_slug
       and v_existing.team is not distinct from v_team
       and v_existing.audience is not distinct from v_audience
       and v_existing.state is not distinct from v_state
       and v_existing.rescued_url is not distinct from v_rescued_url
       and v_existing.destination_provider is not distinct from v_destination_provider
       and v_existing.destination_folder_id is not distinct from v_destination_folder_id
       and v_existing.destination_file_id is not distinct from v_destination_file_id
       and v_existing.content_sha256 is not distinct from v_content_sha256
       and v_existing.byte_length is not distinct from v_byte_length
       and v_existing.verified_at is not distinct from v_verified_at
       and v_existing.verification_receipt_hmac is not distinct from v_verification_receipt_hmac
       and v_existing.media_type is not distinct from v_media_type
       and v_existing.last_error_code is not distinct from v_last_error_code
       and v_existing.reviewed_by is not distinct from v_reviewed_by
       and v_existing.review_note is not distinct from v_review_note
       and v_existing.owner_evidence is not distinct from v_owner_evidence then
      return v_existing;
    end if;
    if p_expected_updated_at is null
       or v_existing.updated_at is distinct from p_expected_updated_at then
      raise exception 'archive_asset_write_conflict';
    end if;
    if v_existing.state in ('rescued', 'owner_dispositioned') then
      raise exception 'archive_asset_terminal';
    end if;

    update public.linear_archive_asset_refs r
    set deliverable_id = v_deliverable_id,
        comment_id = v_comment_id,
        client_slug = v_client_slug,
        team = v_team,
        audience = v_audience,
        state = v_state,
        rescued_url = v_rescued_url,
        destination_provider = v_destination_provider,
        destination_folder_id = v_destination_folder_id,
        destination_file_id = v_destination_file_id,
        content_sha256 = v_content_sha256,
        byte_length = v_byte_length,
        verified_at = v_verified_at,
        verification_receipt_hmac = v_verification_receipt_hmac,
        media_type = v_media_type,
        last_error_code = v_last_error_code,
        reviewed_by = v_reviewed_by,
        review_note = v_review_note,
        owner_evidence = v_owner_evidence,
        rescued_at = case
          when v_state = 'rescued' then coalesce(r.rescued_at, now())
          else null
        end,
        updated_at = now()
    where r.ref_id = v_ref_id
    returning r.* into v_result;
  else
    if p_expected_updated_at is not null then
      raise exception 'archive_asset_write_conflict';
    end if;
    insert into public.linear_archive_asset_refs (
      ref_id, linear_uuid, deliverable_id, comment_id, client_slug, team, audience,
      source_kind, location_key, original_url, original_url_sha256,
      rescued_url, destination_provider, destination_folder_id,
      destination_file_id, content_sha256, byte_length, verified_at,
      verification_receipt_hmac, state, media_type, last_error_code, reviewed_by,
      review_note, owner_evidence, rescued_at
    ) values (
      v_ref_id,
      v_linear_uuid,
      v_deliverable_id,
      v_comment_id,
      v_client_slug,
      v_team,
      v_audience,
      v_source_kind,
      v_location_key,
      v_original_url,
      v_hash,
      v_rescued_url,
      v_destination_provider,
      v_destination_folder_id,
      v_destination_file_id,
      v_content_sha256,
      v_byte_length,
      v_verified_at,
      v_verification_receipt_hmac,
      v_state,
      v_media_type,
      v_last_error_code,
      v_reviewed_by,
      v_review_note,
      v_owner_evidence,
      case when v_state = 'rescued' then now() else null end
    )
    returning * into v_result;
  end if;

  if v_result.client_slug is null or v_result.audience not in ('internal', 'client')
     or v_result.source_kind not in (
       'operational_brief', 'issue_description', 'archive_raw',
       'normalized_comment_body', 'comment_attachment'
     ) then
    raise exception 'invalid_archive_asset_ref';
  end if;
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_raw_sha256(p_raw jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select encode(
    extensions.digest(
      convert_to(coalesce(p_raw, 'null'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$function$

;
CREATE OR REPLACE FUNCTION public.linear_deliverables_reconcile_hydrate(p_ids text[])
 RETURNS TABLE(id text, identifier text, batch_id text, client_slug text, team text, kind text, title text, status text, status_at timestamp with time zone, assignee_id uuid, due_date date, priority smallint, origin text, card_id text, created_by text, created_at timestamp with time zone, updated_at timestamp with time zone, linear_issue_uuid text, linear_identifier text, linear_issue_url text, linear_raw jsonb, source_linear_raw_sha256 text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'extensions'
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_js_truthy(p_value jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select case jsonb_typeof(p_value)
    when 'null' then false
    when 'boolean' then (p_value #>> '{}')::boolean
    when 'number' then (p_value #>> '{}')::numeric <> 0
    when 'string' then (p_value #>> '{}') <> ''
    when 'array' then true
    when 'object' then true
    else false
  end;
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_raw_has_any(p_raw jsonb, p_keys text[])
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_compact_raw(p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_js_string(p_value jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.linear_reconcile_event_comment_id(p_payload jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE PARALLEL SAFE
AS $function$
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
$function$

;
CREATE OR REPLACE FUNCTION public.mirror_outbox_requeue(p_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  update public.mirror_outbox
  set status = 'pending', attempts = 0, last_error = null, processed_at = null,
      next_retry_at = now(), lock_token = null, locked_at = null, updated_at = now()
  where id = p_id and operation = 'comment'
    and status in ('written', 'skipped', 'failed', 'stale');
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_artifact_write(p_row jsonb, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_current public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_projection_surface text;
  v_card text;
  v_surface text;
  v_projection_updated integer := 0;
  v_projection_matches integer := 0;
  v_revision text;
  v_effective_revision text;
  v_next_revision bigint;
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
begin
  if v_id is null then raise exception 'production artifact id required'; end if;
  if v_outbound->>'operation' is distinct from 'attachment' then
    raise exception 'invalid production artifact operation';
  end if;
  if nullif(btrim(v_row->>'file_url'), '') is null then
    raise exception 'production artifact url required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-artifact:' || v_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_current
  from public.deliverables d
  where d.id = v_id
  for update;
  if not found then raise exception 'production artifact not found'; end if;
  if not exists (
    select 1 from public.clients c
    where c.slug = v_current.client_slug
      and c.active is true
  ) then
    raise exception 'production artifact active client required';
  end if;
  if lower(coalesce(v_current.team, '')) not in ('graphics', 'video') then
    raise exception 'production artifact team unsupported';
  end if;
  if lower(coalesce(v_row->>'team', '')) is distinct from lower(coalesce(v_current.team, '')) then
    raise exception 'production artifact team mismatch';
  end if;

  perform public.production_assert_authority(
    v_current.client_slug,
    v_current.team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );
  if public.production_outbox_replay(
    coalesce(nullif(v_outbound->>'entity', ''), 'deliverable'),
    v_id,
    'attachment',
    v_current.client_slug,
    v_current.team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_fingerprint,
    v_dedup
  ) then
    return jsonb_build_object(
      'row', to_jsonb(v_current),
      'projection', jsonb_build_object(
        'surface', case when v_current.origin in ('calendar', 'samples')
          then v_current.origin else null end,
        'card_id', case when v_current.origin in ('calendar', 'samples')
          then v_current.card_id else null end,
        'updated', false,
        'replay', true,
        'artifact_revision', v_current.artifact_revision
      )
    );
  end if;

  v_next_revision := coalesce(v_current.artifact_revision, 0) + 1;
  if v_next_revision > 9007199254740991 then
    raise exception 'production artifact revision exhausted';
  end if;
  v_outbound := jsonb_set(
    v_outbound,
    '{payload}',
    coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object('artifact_revision', v_next_revision),
    true
  );
  v_event := jsonb_set(v_event, '{outbound}', v_outbound, true)
    || jsonb_build_object('artifact_revision', v_next_revision);
  v_result := public.production_deliverable_write(v_row, v_event);
  update public.deliverables d
  set artifact_revision = v_next_revision
  where d.id = v_result.id
  returning d.* into v_result;
  if not found then raise exception 'production artifact revision persist failed'; end if;
  v_revision := 'artifact-' || v_next_revision::text;

  v_card := nullif(btrim(coalesce(v_result.card_id, '')), '');
  v_surface := case
    when v_result.origin in ('calendar', 'samples') then v_result.origin
  end;
  if v_surface is null and v_card is not null then
    if exists (
      select 1 from public.calendar_posts p
      where p.client = v_result.client_slug
        and p.id = v_card
        and (case when lower(coalesce(v_result.team, '')) = 'video'
                  then p.video_deliverable_id
                  else p.graphic_deliverable_id end) = v_result.id
    ) then
      v_surface := 'calendar';
    elsif exists (
      select 1 from public.sample_reviews p
      where p.client = v_result.client_slug
        and p.id = v_card
        and (case when lower(coalesce(v_result.team, '')) = 'video'
                  then p.video_deliverable_id
                  else p.graphic_deliverable_id end) = v_result.id
    ) then
      v_surface := 'samples';
    end if;
  end if;

  if v_surface = 'calendar' and v_card is not null then
    v_projection_surface := 'calendar';
    if lower(coalesce(v_result.team, '')) = 'video' then
      update public.calendar_posts p
      set asset_url = v_result.file_url,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.calendar_posts p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id
        and p.asset_url is not distinct from v_result.file_url;
    else
      update public.calendar_posts p
      set thumbnail_url = v_result.file_url,
          thumb_rev = v_revision,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.graphic_deliverable_id = v_result.id
      returning p.thumb_rev into v_effective_revision;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.calendar_posts p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.graphic_deliverable_id = v_result.id
        and p.thumbnail_url is not distinct from v_result.file_url
        and p.thumb_rev is not distinct from v_effective_revision;
    end if;
  elsif v_surface = 'samples' and v_card is not null then
    v_projection_surface := 'samples';
    if lower(coalesce(v_result.team, '')) = 'video' then
      update public.sample_reviews p
      set asset_url = v_result.file_url,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.sample_reviews p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.video_deliverable_id = v_result.id
        and p.asset_url is not distinct from v_result.file_url;
    else
      update public.sample_reviews p
      set thumbnail_url = v_result.file_url,
          thumb_rev = v_revision,
          updated_at = to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.graphic_deliverable_id = v_result.id
      returning p.thumb_rev into v_effective_revision;
      get diagnostics v_projection_updated = row_count;

      select count(*)::integer into v_projection_matches
      from public.sample_reviews p
      where p.client = v_result.client_slug
        and p.id = v_result.card_id
        and p.graphic_deliverable_id = v_result.id
        and p.thumbnail_url is not distinct from v_result.file_url
        and p.thumb_rev is not distinct from v_effective_revision;
    end if;
  elsif v_card is not null then
    raise exception 'artifact_card_projection_scope_invalid';
  end if;

  if v_projection_surface is not null
     and (v_projection_updated > 1 or v_projection_matches <> 1) then
    raise exception 'artifact_card_projection_failed';
  end if;

  return jsonb_build_object(
    'row', to_jsonb(v_result),
    'projection', jsonb_build_object(
      'surface', v_projection_surface,
      'card_id', case when v_projection_surface is null then null else v_result.card_id end,
      'updated', v_projection_updated = 1,
      'replay', false,
      'artifact_revision', v_next_revision
    )
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_batch_asset_write(p_batch_id text, p_client_slug text, p_slot text, p_url text, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_column text;
  v_current public.batches%rowtype;
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_row jsonb;
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_teams text[];
  v_team text;
begin
  v_column := case lower(coalesce(p_slot, ''))
    when 'raw_footage' then 'footage_folder_url'
    when 'delivery_folder' then 'delivery_folder_url'
    else null
  end;
  if v_column is null then
    raise exception 'production batch asset slot unsupported';
  end if;

  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null then
    raise exception 'production batch asset scope required';
  end if;

  select b.* into v_current
  from public.batches b
  where b.id = p_batch_id
    and b.client_slug = p_client_slug
  for update;
  if not found then
    raise exception 'production batch asset target missing';
  end if;

  select coalesce(array_agg(distinct t), '{}'::text[])
    into v_teams
  from (
    select lower(btrim(coalesce(v_current.team, ''))) as t
    union all
    select lower(btrim(coalesce(d.team, '')))
    from public.deliverables d
    where d.batch_id = v_current.id
      and d.client_slug = v_current.client_slug
  ) s
  where t in ('video', 'graphics');

  if array_length(v_teams, 1) is null then
    perform public.production_assert_authority(
      v_current.client_slug, null, false, false
    );
  end if;

  foreach v_team in array v_teams loop
    perform public.production_assert_authority(
      v_current.client_slug, v_team, false, false
    );
  end loop;

  -- THE FIX. batch_write is an INSERT ... ON CONFLICT (id) DO UPDATE, and
  -- Postgres evaluates NOT NULL on the proposed INSERT row BEFORE the conflict
  -- is resolved -- so a row carrying only {id, <asset column>} died at 23502 on
  -- client_slug every time, and no batch asset write ever committed. The
  -- earlier reasoning was right about the per-key update arms and wrong about
  -- the insert arm having to be a valid row in its own right.
  -- client_slug is echoed back from the row we just locked, so the update arm
  -- sets it to the value it already holds.
  v_row := jsonb_build_object('id', v_current.id, 'client_slug', v_current.client_slug)
    || jsonb_build_object(v_column, v_url);

  return public.batch_write(
    v_row,
    v_event || jsonb_build_object(
      'action', 'batch_asset_change',
      'slot', lower(p_slot)
    )
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_batch_description_write(p_batch_id text, p_client_slug text, p_description text, p_expected_updated_at text DEFAULT NULL::text, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS batches
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current public.batches%rowtype;
  v_teams text[];
  v_team text;
  v_row jsonb;
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_expected timestamptz;
  v_description text := nullif(p_description, '');
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_client_slug, '')), '') is null then
    raise exception 'production_batch_description_scope_required';
  end if;

  select b.* into v_current
  from public.batches b
  where b.id = p_batch_id
    and b.client_slug = p_client_slug
  for update;
  if not found then
    raise exception 'production_batch_description_batch_not_found';
  end if;

  select coalesce(array_agg(distinct t), '{}'::text[])
    into v_teams
  from (
    select lower(btrim(coalesce(v_current.team, ''))) as t
    union all
    select lower(btrim(coalesce(d.team, '')))
    from public.deliverables d
    where d.batch_id = v_current.id
      and d.client_slug = v_current.client_slug
  ) s
  where t in ('video', 'graphics');

  if array_length(v_teams, 1) is null then
    perform public.production_assert_authority(
      v_current.client_slug, null, false, false
    );
  end if;

  foreach v_team in array v_teams loop
    perform public.production_assert_authority(
      v_current.client_slug, v_team, false, false
    );
  end loop;

  if p_expected_updated_at is not null then
    begin
      v_expected := nullif(btrim(p_expected_updated_at), '')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'production_batch_description_write_conflict';
    end;
    if v_expected is not null and v_current.updated_at is distinct from v_expected then
      raise exception 'production_batch_description_write_conflict';
    end if;
  end if;

  v_row := jsonb_build_object(
    'id', v_current.id,
    'client_slug', v_current.client_slug,
    'description', v_description
  );

  return public.batch_write(
    v_row,
    v_event || jsonb_build_object('action', 'batch_description_change')
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_batch_parent_ids_for_team(p_value jsonb, p_team text)
 RETURNS text[]
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_wanted text := case lower(btrim(coalesce(p_team, '')))
    when 'video' then 'video'
    when 'vid' then 'video'
    when 'graphics' then 'graphics'
    when 'graphic' then 'graphics'
    when 'gra' then 'graphics'
    else null
  end;
  v_key text;
  v_key_team text;
  v_entry jsonb;
  v_list jsonb;
  v_id text;
  v_ids text[] := array[]::text[];
begin
  if v_wanted is null or p_value is null then return v_ids; end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_entry in select key, value from jsonb_each(p_value)
    loop
      v_key_team := case lower(btrim(v_key))
        when 'video' then 'video'
        when 'vid' then 'video'
        when 'graphics' then 'graphics'
        when 'graphic' then 'graphics'
        when 'gra' then 'graphics'
        else null
      end;
      if v_key_team is distinct from v_wanted then continue; end if;
      if jsonb_typeof(v_entry) = 'string' then
        v_id := nullif(btrim(v_entry #>> '{}'), '');
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      elsif jsonb_typeof(v_entry) = 'object' then
        for v_id in
          select nullif(btrim(value), '')
          from (values (v_entry->>'id'), (v_entry->>'uuid'), (v_entry->>'linear_issue_id')) ids(value)
        loop
          if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
        end loop;
      end if;
    end loop;

    v_key_team := case lower(btrim(coalesce(
      p_value->>'team', p_value->>'team_key', p_value->>'key', p_value->>'kind', ''
    )))
      when 'video' then 'video'
      when 'vid' then 'video'
      when 'graphics' then 'graphics'
      when 'graphic' then 'graphics'
      when 'gra' then 'graphics'
      else null
    end;
    if v_key_team = v_wanted then
      for v_id in
        select nullif(btrim(value), '')
        from (values (p_value->>'id'), (p_value->>'uuid'), (p_value->>'linear_issue_id')) ids(value)
      loop
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      end loop;
    end if;
    v_list := p_value->'parents';
  elsif jsonb_typeof(p_value) = 'array' then
    v_list := p_value;
  end if;

  if jsonb_typeof(v_list) = 'array' then
    for v_entry in select value from jsonb_array_elements(v_list)
    loop
      if jsonb_typeof(v_entry) is distinct from 'object' then continue; end if;
      v_key_team := case lower(btrim(coalesce(
        v_entry->>'team', v_entry->>'team_key', v_entry->>'key', v_entry->>'kind', ''
      )))
        when 'video' then 'video'
        when 'vid' then 'video'
        when 'graphics' then 'graphics'
        when 'graphic' then 'graphics'
        when 'gra' then 'graphics'
        else null
      end;
      if v_key_team is distinct from v_wanted then continue; end if;
      for v_id in
        select nullif(btrim(value), '')
        from (values (v_entry->>'id'), (v_entry->>'uuid'), (v_entry->>'linear_issue_id')) ids(value)
      loop
        if v_id is not null then v_ids := array_append(v_ids, v_id); end if;
      end loop;
    end loop;
  end if;

  select coalesce(array_agg(found.id order by found.id), array[]::text[])
    into v_ids
  from (select distinct unnest(v_ids) as id) found;
  return v_ids;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_bind_linear_id(p_comment_id text, p_linear_comment_id text, p_outbox_id bigint)
 RETURNS production_comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comment_id text := nullif(btrim(p_comment_id), '');
  v_linear_id text := nullif(btrim(p_linear_comment_id), '');
  v_outbox public.mirror_outbox%rowtype;
  v_existing public.production_comments%rowtype;
  v_result public.production_comments%rowtype;
begin
  if v_comment_id is null or v_linear_id is null or p_outbox_id is null then
    raise exception 'production comment Linear binding identity required';
  end if;

  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for update;
  if not found
     or v_outbox.entity is distinct from 'comment'
     or v_outbox.operation is distinct from 'comment'
     or v_outbox.comment_id is distinct from v_comment_id
     or nullif(btrim(v_outbox.payload->>'comment_id'), '') is distinct from v_comment_id then
    raise exception 'production comment Linear binding outbox mismatch';
  end if;

  select c.* into v_existing
  from public.production_comments c
  where c.id = v_comment_id
  for update;
  if not found then raise exception 'production comment Linear binding target missing'; end if;
  if v_existing.linear_comment_id is not null then
    if v_existing.linear_comment_id is distinct from v_linear_id then
      raise exception 'production comment Linear binding conflict';
    end if;
    return v_existing;
  end if;
  perform 1
  from public.production_comments c
  where c.linear_comment_id = v_linear_id
    and c.id <> v_comment_id;
  if found then raise exception 'production comment Linear id already bound'; end if;

  v_result := public.production_comment_upsert(
    jsonb_build_object(
      'id', v_comment_id,
      'operation', 'link_linear',
      'linear_comment_id', v_linear_id
    ),
    jsonb_build_object(
      'source', 'outbound',
      'actor', 'SyncView Mirror',
      'role', 'system',
      'outbox_id', p_outbox_id
    )
  );
  if v_result.linear_comment_id is distinct from v_linear_id then
    raise exception 'production comment Linear binding failed';
  end if;
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.track_b_f27_write_authorization(p_team text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
     or lower(coalesce(v_authority->>v_team, '')) not in ('linear', 'syncview') then
    raise exception 'f27_write_authorization_unavailable';
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f27_write_authorization',
    'team', v_team,
    'authority', lower(v_authority->>v_team),
    'generation', v_generation
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_card_import(p_link jsonb, p_comment jsonb, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS production_comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link jsonb := coalesce(p_link, '{}'::jsonb);
  v_comment jsonb := coalesce(p_comment, '{}'::jsonb);
  v_surface text := lower(nullif(btrim(v_link->>'source_surface'), ''));
  v_card_id text := nullif(btrim(v_link->>'card_id'), '');
  v_component text := lower(nullif(btrim(v_link->>'component'), ''));
  v_native_id text := nullif(btrim(v_link->>'native_comment_id'), '');
  v_deliverable_id text := nullif(btrim(v_link->>'deliverable_id'), '');
  v_client_slug text := nullif(btrim(v_link->>'client_slug'), '');
  v_link_team text := lower(nullif(btrim(v_link->>'team'), ''));
  v_fingerprint text := nullif(btrim(v_link->>'source_fingerprint'), '');
  v_comment_id text;
  v_target_team text;
  v_target_client_slug text;
  v_target_card_id text;
  v_target_origin text;
  v_expected_team text;
  v_existing_link public.production_comment_card_links%rowtype;
  v_result public.production_comments%rowtype;
begin
  if v_surface not in ('calendar', 'sxr')
     or v_card_id is null
     or v_component not in ('video', 'graphic', 'caption', 'title')
     or v_native_id is null
     or v_deliverable_id is null or v_client_slug is null
     or v_link_team not in ('video', 'graphics')
     or v_fingerprint is null then
    raise exception 'invalid production comment card import identity';
  end if;
  v_expected_team := case when v_component = 'graphic' then 'graphics' else 'video' end;
  select d.team, d.client_slug, d.card_id, d.origin
    into v_target_team, v_target_client_slug, v_target_card_id, v_target_origin
  from public.deliverables d
  where d.id = v_deliverable_id;
  if not found then raise exception 'production comment card import deliverable missing'; end if;
  if v_target_team is distinct from v_expected_team
     or v_link_team is distinct from v_target_team
     or v_client_slug is distinct from v_target_client_slug
     or v_card_id is distinct from v_target_card_id
     or v_target_origin is distinct from (
       case
         when v_surface = 'calendar' then 'calendar'
         else 'samples'
       end
     ) then
    raise exception 'production comment card import crosswalk mismatch';
  end if;

  select l.* into v_existing_link
  from public.production_comment_card_links l
  where l.source_surface = v_surface
    and l.card_id = v_card_id
    and l.component = v_component
    and l.native_comment_id = v_native_id
  for update;
  if found then
    if v_existing_link.deliverable_id is distinct from v_deliverable_id
       or v_existing_link.source_fingerprint is distinct from v_fingerprint then
      raise exception 'production comment card import identity conflict';
    end if;
    select c.* into v_result
    from public.production_comments c
    where c.id = v_existing_link.production_comment_id;
    return v_result;
  end if;

  v_comment_id := 'pc_card_' || encode(
    extensions.digest(
      v_surface || ':' || v_card_id || ':' || v_component || ':' || v_native_id,
      'sha256'
    ),
    'hex'
  );
  v_comment := v_comment
    || jsonb_build_object(
      'id', v_comment_id,
      -- Raw card ids are not globally unique. Preserve the raw identity in
      -- the crosswalk/provenance and use the composite canonical id here.
      'native_comment_id', v_comment_id,
      'deliverable_id', v_deliverable_id,
      'team', v_target_team,
      'origin', 'legacy',
      'source', 'backfill',
      'operation', 'upsert',
      'provenance', coalesce(v_comment->'provenance', '{}'::jsonb)
        || jsonb_build_object(
          'source_surface', v_surface,
          'card_id', v_card_id,
          'component', v_component,
          'native_comment_id', v_native_id
        )
    );
  v_result := public.production_comment_upsert(v_comment, coalesce(p_event, '{}'::jsonb));

  insert into public.production_comment_card_links (
    source_surface, card_id, component, native_comment_id,
    deliverable_id, production_comment_id, source_fingerprint
  ) values (
    v_surface, v_card_id, v_component, v_native_id,
    v_deliverable_id, v_result.id, v_fingerprint
  );
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_card_bind_and_import(p_binding jsonb, p_comments jsonb DEFAULT '[]'::jsonb, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_binding jsonb := coalesce(p_binding, '{}'::jsonb);
  v_surface text := lower(nullif(btrim(v_binding->>'source_surface'), ''));
  v_deliverable_id text := nullif(btrim(v_binding->>'deliverable_id'), '');
  v_card_id text := nullif(btrim(v_binding->>'card_id'), '');
  v_client_slug text := nullif(btrim(v_binding->>'client_slug'), '');
  v_component text := lower(nullif(btrim(v_binding->>'component'), ''));
  v_evict text := lower(coalesce(nullif(btrim(v_binding->>'evict_occupant'), ''), 'off'));
  v_expected_team text;
  v_card_slot text;
  v_card_other_slot text;
  v_card_link text;
  v_card_ident text;
  v_kind text;
  v_kind_after text;
  v_del_ident text;
  v_del_batch text;
  v_current_client text;
  v_current_card text;
  v_occ record;
  v_occ_mode text;
  v_occ_team text;
  v_auth jsonb;
  v_evicted jsonb := '[]'::jsonb;
  v_prev_flag text;
  v_comment jsonb;
  v_native_id text;
  v_processed int := 0;
  v_imported int := 0;
  v_already int := 0;
  v_bound boolean := false;
begin
  -- 1. IDENTITY. Calendar only.
  if v_surface is distinct from 'calendar'
     or v_deliverable_id is null
     or v_card_id is null
     or v_client_slug is null
     or v_component not in ('video', 'graphic') then
    raise exception 'crosswalk_bind_invalid_identity';
  end if;
  if v_evict not in ('off', 'card_wins') then
    raise exception 'crosswalk_bind_invalid_evict_mode';
  end if;
  v_expected_team := case when v_component = 'graphic' then 'graphics' else 'video' end;

  -- 2. THE CARD MUST POINT AT THIS DELIVERABLE (keyed on (client, id); other slot read too).
  select case when v_component = 'graphic' then c.graphic_deliverable_id else c.video_deliverable_id end,
         case when v_component = 'graphic' then c.video_deliverable_id else c.graphic_deliverable_id end,
         case when v_component = 'graphic' then c.graphic_linear_issue_id else c.linear_issue_id end
    into v_card_slot, v_card_other_slot, v_card_link
  from public.calendar_posts c
  where c.client = v_client_slug and c.id = v_card_id
  for update;
  if not found then
    raise exception 'crosswalk_bind_card_missing';
  end if;
  if v_card_slot is distinct from v_deliverable_id then
    raise exception 'crosswalk_bind_card_does_not_reference_deliverable';
  end if;
  v_card_other_slot := nullif(btrim(coalesce(v_card_other_slot, '')), '');

  -- 3. THE DELIVERABLE MUST EXIST, and must not be another client's.
  select d.client_slug, d.card_id, d.kind, d.batch_id,
         case
           when public.crosswalk_linear_identifier(d.linear_identifier) <> ''
             then public.crosswalk_linear_identifier(d.linear_identifier)
           else public.crosswalk_linear_identifier(d.linear_issue_url)
         end
    into v_current_client, v_current_card, v_kind, v_del_batch, v_del_ident
  from public.deliverables d
  where d.id = v_deliverable_id
  for update;
  if not found then
    raise exception 'crosswalk_bind_deliverable_missing';
  end if;
  if v_current_client is not null
     and btrim(v_current_client) <> ''
     and btrim(v_current_client) is distinct from v_client_slug then
    raise exception 'crosswalk_bind_client_mismatch';
  end if;

  -- 4. NEVER RE-POINT AN EXISTING BINDING.
  if v_current_card is not null
     and btrim(v_current_card) <> ''
     and btrim(v_current_card) is distinct from v_card_id then
    raise exception 'crosswalk_bind_already_bound_elsewhere';
  end if;

  -- 4b. THE LABEL FOLLOWS THE CARD: kind becomes the slot key.
  v_kind_after := case when v_component = 'graphic' then 'thumbnail' else 'video' end;

  -- 4c. THE CARD AND THE DELIVERABLE MUST NAME THE SAME LINEAR ISSUE.
  v_card_ident := public.crosswalk_linear_identifier(v_card_link);
  if v_card_ident = '' or v_del_ident = '' then
    raise exception 'crosswalk_bind_linear_identity_unproven';
  end if;
  if v_card_ident is distinct from v_del_ident then
    raise exception 'crosswalk_bind_linear_identity_disagrees';
  end if;

  -- 5. THE SLOT: occupants the card does not point at.
  v_prev_flag := coalesce(current_setting('app.event_written', true), '');
  for v_occ in
    select d2.id, d2.status, d2.kind, d2.team, d2.batch_id, d2.linear_issue_uuid,
           case
             when public.crosswalk_linear_identifier(d2.linear_identifier) <> ''
               then public.crosswalk_linear_identifier(d2.linear_identifier)
             else public.crosswalk_linear_identifier(d2.linear_issue_url)
           end as ident
    from public.deliverables d2
    where d2.client_slug = v_client_slug
      and d2.origin = 'calendar'
      and d2.card_id = v_card_id
      and d2.id is distinct from v_deliverable_id
      and d2.id is distinct from v_card_other_slot
      and (lower(btrim(coalesce(d2.team, ''))) = v_expected_team
           or lower(btrim(coalesce(d2.kind, ''))) = v_kind_after)
    order by d2.id
    for update
  loop
    if v_evict <> 'card_wins' then
      raise exception 'crosswalk_bind_slot_occupied';
    end if;
    if v_occ.ident <> '' and v_occ.ident = v_card_ident then
      raise exception 'crosswalk_bind_occupant_same_issue';
    end if;
    v_occ_mode := case
      when lower(btrim(coalesce(v_occ.status, ''))) in ('approved', 'posted', 'canceled', 'duplicate') then 'detached'
      else 'canceled'
    end;
    v_occ_team := coalesce(nullif(btrim(coalesce(v_occ.team, '')), ''), v_expected_team);
    v_auth := null;
    if v_occ_mode = 'canceled' then
      -- F27: the authority binder the outbound fence compares, minted as the gateway mints it.
      v_auth := public.track_b_f27_write_authorization(v_occ_team);
      if lower(coalesce(v_auth->>'authority', '')) <> 'syncview' then
        v_occ_mode := 'detached_authority_linear';
      else
        perform public.production_assert_authority(v_client_slug, v_occ_team, false, false);
      end if;
    end if;
    perform set_config('app.event_written', '1', true);
    update public.deliverables d
    set card_id = null,
        status = case when v_occ_mode = 'canceled' then 'canceled' else d.status end,
        status_at = case when v_occ_mode = 'canceled' then now() else d.status_at end
    where d.id = v_occ.id;
    insert into public.deliverable_events(
      deliverable_id, batch_id, client_slug, ts, actor, role, action,
      from_status, to_status, source, payload
    ) values (
      v_occ.id, v_occ.batch_id, v_client_slug, now(),
      'crosswalk-bind-and-import', 'system', 'crosswalk_occupant_evicted',
      v_occ.status,
      case when v_occ_mode = 'canceled' then 'canceled' else v_occ.status end,
      'reconcile',
      jsonb_build_object(
        'card_id', v_card_id,
        'component', v_component,
        'mode', v_occ_mode,
        'kept_deliverable_id', v_deliverable_id,
        'kept_linear_identifier', v_card_ident,
        'occupant_linear_identifier', v_occ.ident,
        'authority', v_auth->>'authority',
        'authority_generation', v_auth->>'generation',
        'ruling', 'owner 2026-09-05: the card wins'
      )
    );
    perform set_config('app.event_written', v_prev_flag, true);
    if v_occ_mode = 'canceled' and nullif(btrim(coalesce(v_occ.linear_issue_uuid, '')), '') is not null then
      perform public.mirror_outbox_enqueue(
        p_entity := 'deliverable',
        p_entity_id := v_occ.id,
        p_operation := 'status',
        p_payload := jsonb_build_object(
          'status', 'canceled',
          'reason', 'crosswalk_occupant_evicted',
          'card_id', v_card_id,
          'kept_deliverable_id', v_deliverable_id,
          '_f27_authority_generation', (v_auth->>'generation')::bigint
        ),
        p_dedup_key := 'crosswalk-evict:' || v_occ.id || ':canceled',
        p_source_edited_at := now(),
        p_client_slug := v_client_slug,
        p_team := v_occ_team,
        p_actor := 'crosswalk-bind-and-import',
        p_role := 'system',
        p_deliverable_id := v_occ.id,
        p_batch_id := v_occ.batch_id
      );
    end if;
    v_evicted := v_evicted || jsonb_build_object(
      'deliverable_id', v_occ.id,
      'linear_identifier', v_occ.ident,
      'status_before', v_occ.status,
      'mode', v_occ_mode
    );
  end loop;

  -- 6. BIND.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set card_id = v_card_id,
      client_slug = v_client_slug,
      origin = 'calendar',
      team = v_expected_team,
      kind = v_kind_after
  where d.id = v_deliverable_id;
  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_deliverable_id, v_del_batch, v_client_slug, now(),
    'crosswalk-bind-and-import', 'system', 'crosswalk_bound',
    null, null, 'reconcile',
    jsonb_build_object(
      'card_id', v_card_id,
      'component', v_component,
      'team', v_expected_team,
      'kind_before', v_kind,
      'kind', v_kind_after,
      'linear_identifier', v_card_ident,
      'evicted', v_evicted
    )
  );
  perform set_config('app.event_written', v_prev_flag, true);
  v_bound := true;

  -- 7. IMPORT, in the same transaction.
  for v_comment in select * from jsonb_array_elements(coalesce(p_comments, '[]'::jsonb))
  loop
    v_processed := v_processed + 1;
    v_native_id := nullif(btrim(v_comment->>'native_comment_id'), '');
    if exists (
      select 1 from public.production_comment_card_links l
      where l.source_surface = 'calendar'
        and l.card_id = v_card_id
        and l.component = v_component
        and l.native_comment_id = v_native_id
    ) then
      v_already := v_already + 1;
    else
      v_imported := v_imported + 1;
    end if;
    perform public.production_comment_card_import(
      jsonb_build_object(
        'source_surface', 'calendar',
        'card_id', v_card_id,
        'component', v_component,
        'native_comment_id', v_comment->>'native_comment_id',
        'deliverable_id', v_deliverable_id,
        'client_slug', v_client_slug,
        'team', v_expected_team,
        'source_fingerprint', v_comment->>'source_fingerprint'
      ),
      v_comment - 'native_comment_id' - 'source_fingerprint',
      coalesce(p_event, '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object(
    'bound', v_bound,
    'deliverable_id', v_deliverable_id,
    'card_id', v_card_id,
    'client_slug', v_client_slug,
    'component', v_component,
    'team', v_expected_team,
    'kind_before', v_kind,
    'kind', v_kind_after,
    'linear_identifier', v_card_ident,
    'evicted', v_evicted,
    'processed', v_processed,
    'imported', v_imported,
    'already_linked', v_already
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_card_import_counts(p_backfill_tag text)
 RETURNS TABLE(card_link_count bigint, comment_count bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    count(*)::bigint as card_link_count,
    count(distinct l.production_comment_id)::bigint as comment_count
  from public.production_comment_card_links l
  join public.production_comments c on c.id = l.production_comment_id
  where c.backfill_tag = p_backfill_tag;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_mirror_applicable(p_test_only boolean, p_legacy_parity boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- F2 controls drainer activity; off/missing/unreadable is a staged pause,
  -- never the retired epoch. F32 has not installed an explicit server-owned
  -- retirement signal, so every currently applicable comment mutation queues.
  return true;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_lifecycle_write(p_comment jsonb, p_event jsonb DEFAULT '{}'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_expected_updated_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS production_comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comment jsonb := coalesce(p_comment, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_action text := lower(coalesce(nullif(v_comment->>'operation', ''), ''));
  v_requested_id text := coalesce(
    nullif(btrim(v_comment->>'id'), ''),
    nullif(btrim(v_comment->>'native_comment_id'), '')
  );
  v_dedup_key text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_outbound->'payload'->>'_intent_fingerprint'), '');
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
  v_existing public.production_comments%rowtype;
  v_result public.production_comments%rowtype;
  v_receipt public.production_comment_mutation_receipts%rowtype;
  v_target_id text;
  v_payload jsonb;
  v_outbox_id bigint;
  v_dependency_id bigint;
  v_supplied_dependency_id bigint :=
    nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  v_mirror_applicable boolean;
  v_card_import_without_foreign boolean := false;
begin
  if v_action not in ('edit', 'delete', 'resolve', 'unresolve') then
    raise exception 'unsupported production comment lifecycle operation';
  end if;
  if v_requested_id is null or v_dedup_key is null or v_fingerprint is null then
    raise exception 'production comment lifecycle identity required';
  end if;

  select r.* into v_receipt
  from public.production_comment_mutation_receipts r
  where r.dedup_key = v_dedup_key;
  if found then
    if v_receipt.comment_id is distinct from v_requested_id
       or v_receipt.action is distinct from v_action
       or v_receipt.intent_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_conflict';
    end if;
    select c.* into v_result
    from public.production_comments c
    where c.id = v_receipt.comment_id;
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;

  select c.* into v_existing
  from public.production_comments c
  where c.id = v_requested_id
     or c.native_comment_id = v_requested_id
  order by case when c.id = v_requested_id then 0 else 1 end
  limit 1
  for update;
  if not found then raise exception 'comment_write_conflict'; end if;
  if p_expected_version is null or p_expected_updated_at is null
     or v_existing.version is distinct from p_expected_version
     or v_existing.updated_at is distinct from p_expected_updated_at then
    raise exception 'comment_write_conflict';
  end if;
  if v_existing.parent_id is not null and v_action in ('resolve', 'unresolve') then
    raise exception 'production comment root required';
  end if;

  v_target_id := coalesce(v_existing.deliverable_id, v_existing.batch_id);
  if v_target_id is null then raise exception 'production comment lifecycle target required'; end if;
  perform public.production_assert_authority(
    v_existing.client_slug,
    v_existing.team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity
  );
  v_mirror_applicable := public.production_comment_mirror_applicable(
    coalesce((v_outbound->>'test_only')::boolean, false),
    v_legacy_parity
  );

  -- The CAS above proves the caller holds the current row, so a lifecycle
  -- edit/delete/resolve/reopen is a server-authoritative mutation. Clamp its
  -- source clock so it can never regress below the stored value. Without this a
  -- browser clock behind the row's source_updated_at — including a valid
  -- future-dated imported comment — would trip the production_comment_upsert
  -- stale-source guard, which returns the row unchanged; this function would
  -- then insert a mutation receipt and enqueue the old body, reporting (and
  -- letting exact retries replay) a false success for a write that never
  -- happened.
  v_comment := jsonb_set(
    v_comment,
    '{source_updated_at}',
    to_jsonb(greatest(
      coalesce(nullif(btrim(v_comment->>'source_updated_at'), '')::timestamptz, now()),
      v_existing.source_updated_at
    )::text),
    true
  );

  v_result := public.production_comment_upsert(v_comment, v_event - 'outbound');

  insert into public.production_comment_mutation_receipts (
    dedup_key, comment_id, action, intent_fingerprint, result_version
  ) values (
    v_dedup_key, v_result.id, v_action, v_fingerprint, v_result.version
  )
  on conflict (dedup_key) do nothing;
  if not found then raise exception 'idempotency_conflict'; end if;

  -- Linear has create/edit/delete mutations, but no native resolved state.
  -- Resolve/reopen therefore commits the canonical lifecycle and audit event
  -- without manufacturing a foreign comment or an inapplicable outbox row.
  if v_action in ('edit', 'delete') and v_mirror_applicable then
    -- Lifecycle writes never wait for the create mirror to bind a provider id.
    -- Instead each intent depends on the immediately preceding canonical
    -- comment intent. This preserves create -> edit(s) -> delete order while
    -- F2 is paused or Linear is unavailable, and lets the drainer hand the
    -- provider id forward from each durable predecessor receipt.
    select o.id into v_dependency_id
    from public.mirror_outbox o
    where o.entity = 'comment'
      and o.operation = 'comment'
      and o.comment_id = v_result.id
      and o.dedup_key <> v_dedup_key
      and o.status in ('pending', 'failed', 'shadow_ok', 'written', 'skipped')
    order by o.id desc
    limit 1;
    if v_supplied_dependency_id is not null
       and v_supplied_dependency_id is distinct from v_dependency_id then
      raise exception 'production comment dependency mismatch';
    end if;
    -- F42 rows were copied from native card arrays; the import itself never
    -- creates a Linear comment. Mark only an exact imported row that still has
    -- neither a provider id nor a predecessor intent. The drainer can then
    -- materialize a first edit as one create, or converge a first delete as a
    -- no-foreign-object terminal receipt, instead of retrying an impossible
    -- providerless edit/delete forever.
    select exists (
      select 1
      from public.production_comment_card_links l
      where l.production_comment_id = v_result.id
    )
      and v_result.linear_comment_id is null
      and v_dependency_id is null
    into v_card_import_without_foreign;
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object(
        'action', v_action,
        'body', v_result.body,
        'comment_id', v_result.id,
        'linear_comment_id', v_result.linear_comment_id,
        'card_import_without_foreign', v_card_import_without_foreign
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
      p_actor := nullif(v_event->>'actor', ''),
      p_role := nullif(v_event->>'role', ''),
      p_deliverable_id := v_result.deliverable_id,
      p_batch_id := v_result.batch_id,
      p_comment_id := v_result.id,
      p_depends_on_id := v_dependency_id,
      p_test_only := coalesce((v_outbound->>'test_only')::boolean, false)
    );
    if v_legacy_parity then
      update public.mirror_outbox
      set legacy_parity = true, updated_at = now()
      where id = v_outbox_id;
    end if;
  end if;

  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_read_authorize(p_actor_key text, p_auth_kind text, p_deliverable_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor text := nullif(btrim(p_actor_key), '');
  v_kind text := lower(nullif(btrim(p_auth_kind), ''));
  v_deliverable text := nullif(btrim(p_deliverable_id), '');
begin
  if v_actor is null or v_kind not in ('staff', 'client') or v_deliverable is null then
    raise exception 'invalid production comment read authorization';
  end if;

  insert into public.production_comment_read_audit (
    actor_key, auth_kind, deliverable_id, decision, reason
  ) values (
    v_actor, v_kind, v_deliverable, 'allow', 'target_authorized'
  );
  return jsonb_build_object('ok', true, 'authorized', true);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_read_budget_take(p_actor_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor text := nullif(btrim(p_actor_key), '');
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / 300) * 300
  );
  v_requests integer;
begin
  if v_actor is null then
    raise exception 'invalid production comment read budget actor';
  end if;

  insert into public.production_comment_read_budget (
    actor_key, window_start, requests
  ) values (
    v_actor, v_window, 1
  )
  on conflict (actor_key, window_start) do update
    set requests = public.production_comment_read_budget.requests + 1
    where public.production_comment_read_budget.requests < 120
  returning requests into v_requests;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'allowed', false,
      'remaining', 0,
      'retry_after_seconds', 300
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'allowed', true,
    'remaining', 120 - v_requests
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_comment_write(p_comment jsonb, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS production_comments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_comment jsonb := coalesce(p_comment, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_result public.production_comments%rowtype;
  v_receipt public.production_comment_mutation_receipts%rowtype;
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
  v_dedup_key text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_test_only boolean := coalesce((v_outbound->>'test_only')::boolean, false);
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
  v_mirror_applicable boolean;
begin
  if lower(coalesce(v_comment->>'operation', 'add')) <> 'add'
     or lower(coalesce(v_outbound->>'operation', 'comment')) <> 'comment'
     or v_requested_id is null or v_dedup_key is null or v_fingerprint is null then
    raise exception 'production comment add identity required';
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
    v_client_slug, v_team, v_test_only, v_legacy_parity
  );
  v_mirror_applicable := public.production_comment_mirror_applicable(
    v_test_only, v_legacy_parity
  );

  select r.* into v_receipt
  from public.production_comment_mutation_receipts r
  where r.dedup_key = v_dedup_key;
  if found then
    if v_receipt.comment_id is distinct from v_requested_id
       or v_receipt.action <> 'add'
       or v_receipt.intent_fingerprint is distinct from v_fingerprint then
      raise exception 'idempotency_conflict';
    end if;
    select c.* into v_result from public.production_comments c
    where c.id = v_receipt.comment_id;
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;

  if v_native_comment_id is not null then
    select c.idempotency_key into v_existing_native_dedup
    from public.production_comments c
    where c.native_comment_id = v_native_comment_id;
    if found and v_existing_native_dedup is distinct from v_dedup_key then
      raise exception 'idempotency_conflict';
    end if;
  end if;

  if v_mirror_applicable and public.production_outbox_replay(
    'comment', v_target_id, 'comment', v_client_slug, v_team,
    nullif(v_comment->>'author_name', ''), nullif(v_comment->>'role', ''),
    v_test_only, v_legacy_parity, v_fingerprint, v_dedup_key
  ) then
    select c.* into v_result
    from public.production_comments c
    where c.id = v_requested_id
       or c.native_comment_id = v_requested_id
       or c.idempotency_key = v_dedup_key
    order by case when c.id = v_requested_id then 0 else 1 end
    limit 1;
    if not found then raise exception 'idempotent_result_missing'; end if;
  else
    v_result := public.production_comment_upsert(v_comment, v_event - 'outbound');
  end if;

  insert into public.production_comment_mutation_receipts (
    dedup_key, comment_id, action, intent_fingerprint, result_version
  ) values (
    v_dedup_key, v_result.id, 'add', v_fingerprint, v_result.version
  )
  on conflict (dedup_key) do nothing;
  if not found then raise exception 'idempotency_conflict'; end if;

  if v_mirror_applicable then
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb)
      || jsonb_build_object(
        'action', 'add',
        'body', v_result.body,
        'comment_id', v_result.id
      );
    v_outbox_id := public.mirror_outbox_enqueue(
      p_entity := 'comment',
      p_entity_id := coalesce(v_result.deliverable_id, v_result.batch_id),
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
      p_test_only := v_test_only
    );
    if v_legacy_parity then
      update public.mirror_outbox
      set legacy_parity = true, updated_at = now()
      where id = v_outbox_id;
    end if;
  end if;
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_component_fill(p_batch_id text, p_expected_updated_at timestamp with time zone, p_sibling_id text, p_row jsonb, p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch public.batches%rowtype;
  v_sibling public.deliverables%rowtype;
  v_result public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_outbound jsonb;
  v_payload jsonb;
  v_team text;
  v_card_id text;
  v_title text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dep_parent_ids text[];
  v_shared_parent boolean;
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_terminal_dependency boolean := false;
  v_own_parent_ids text[];
  v_sibling_parent_ids text[];
  v_card_found boolean;
  v_card_status text;
  v_card_video text;
  v_card_graphic text;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or nullif(btrim(coalesce(p_sibling_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_row) is distinct from 'object'
     or jsonb_typeof(p_event) is distinct from 'object' then
    raise exception 'invalid_component_fill_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  v_outbound := coalesce(p_event->'outbound', '{}'::jsonb);
  v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_team := nullif(btrim(p_row->>'team'), '');
  v_card_id := nullif(btrim(p_row->>'card_id'), '');
  v_title := nullif(btrim(coalesce(p_row->>'title', '')), '');
  v_project_id := nullif(btrim(v_payload->>'project_id'), '');

  -- THE SIBLING IS THE AUTHORITY on where this component belongs. Locked in
  -- the same transaction as the batch so it cannot be re-carded underneath us.
  select d.* into v_sibling
  from public.deliverables d
  where d.id = p_sibling_id
  for update;
  if not found then raise exception 'component_fill_sibling_missing'; end if;
  if v_sibling.batch_id is distinct from v_batch.id
     or v_sibling.client_slug is distinct from v_batch.client_slug then
    raise exception 'component_fill_sibling_missing';
  end if;
  -- The card the caller named must be the card the sibling actually carries.
  -- Without this a caller could point any card at any batch's work.
  if v_card_id is null
     or nullif(btrim(coalesce(v_sibling.card_id, '')), '') is distinct from v_card_id then
    raise exception 'component_fill_card_mismatch';
  end if;
  if v_sibling.team is not distinct from v_team then
    raise exception 'component_fill_team_occupied';
  end if;

  -- THE DUPLICATE GUARD, against committed rows rather than the request: two
  -- tabs racing this button serialize on the batch lock, and the second one
  -- sees the first one's row and refuses.
  if exists (
    select 1
    from public.deliverables d
    where d.client_slug = v_batch.client_slug
      and nullif(btrim(coalesce(d.card_id, '')), '') = v_card_id
      and d.team = v_team
      and d.id is distinct from p_row->>'id'
  ) then
    raise exception 'component_fill_team_occupied';
  end if;

  /*
   * THE CARD ITSELF, READ AND LOCKED. Raised by Codex on PR 1195, and it was
   * right about something more fundamental than the race it named.
   *
   * Everything above validates the SIBLING: that it exists, that it carries
   * this card_id, that it is the other team. None of that reads the card, and
   * `deliverables.card_id` is plain text with no foreign key -- so before this
   * block the function could attach a live deliverable to a card that had been
   * archived since the tab loaded, or to one that does not exist at all. The
   * header of this migration claimed a card must "exist already, which is what
   * makes an orphaned component impossible"; that was enforced by the browser
   * and by a text column, not by the database.
   *
   * ARCHIVING IS THE CASE THAT BITES. Archiving a post PARKS its sub-issues
   * (owner ruling 2026-08-17, after 33 of 50 sub-issues on 37 archived cards
   * were found still open, several sitting in SMM or client approval -- "that
   * is phantom work on real people's lists"). The park moves only the
   * components captured BEFORE the archive write, so a fill landing after it
   * mints a fresh `todo` deliverable, mirrors it to Linear, and nothing will
   * ever park that one. Archiving does not advance batches.updated_at either,
   * so the CAS cursor above cannot see it.
   *
   * Locked FOR UPDATE, which is safe here: the archive path writes the card
   * row through calendar-upsert and parks the deliverables in SEPARATE
   * transactions, so there is no second transaction holding the card and
   * waiting on this batch. A concurrent archive either commits first -- and is
   * then seen, and refused -- or waits for this fill and parks after it.
   *
   * The TARGET SLOT is re-checked here too, on the card rather than on the
   * deliverables. The occupancy guard above reads `deliverables.card_id`; this
   * reads the other direction of the same link, so a card already pointing at
   * a component whose row lost its card_id is still refused rather than
   * silently gaining a second one.
   */
  if coalesce(v_batch.purpose, 'calendar') = 'samples' then
    select true, s.status, s.video_deliverable_id, s.graphic_deliverable_id
      into v_card_found, v_card_status, v_card_video, v_card_graphic
    from public.sample_reviews s
    where s.id = v_card_id and s.client = v_batch.client_slug
    for update;
  else
    select true, c.status, c.video_deliverable_id, c.graphic_deliverable_id
      into v_card_found, v_card_status, v_card_video, v_card_graphic
    from public.calendar_posts c
    where c.id = v_card_id and c.client = v_batch.client_slug
    for update;
  end if;
  if not coalesce(v_card_found, false) then
    raise exception 'component_fill_card_missing';
  end if;
  if lower(btrim(coalesce(v_card_status, ''))) = 'archived' then
    raise exception 'component_fill_card_archived';
  end if;
  if nullif(btrim(coalesce(
       case when v_team = 'graphics' then v_card_graphic else v_card_video end, '')), '')
     is distinct from null
     and nullif(btrim(coalesce(
       case when v_team = 'graphics' then v_card_graphic else v_card_video end, '')), '')
     is distinct from p_row->>'id' then
    raise exception 'component_fill_team_occupied';
  end if;

  if nullif(btrim(p_row->>'id'), '') is null
     or p_row->>'batch_id' is distinct from v_batch.id
     or p_row->>'client_slug' is distinct from v_batch.client_slug
     or v_team is null
     or v_team not in ('video', 'graphics')
     or v_title is null
     or length(v_title) > 500
     -- Same origin/purpose agreement as the append path: a samples row may
     -- only land in a samples batch and a calendar row only in a calendar one.
     or p_row->>'origin' not in ('calendar', 'samples')
     or p_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')
     -- Parenthesised because PL/pgSQL ends an IF condition at the first THEN.
     or p_row->>'kind' is distinct from (case when v_team = 'graphics' then 'thumbnail' else 'video' end)
     or p_event->>'source' is distinct from 'ui'
     or p_event->>'action' is distinct from 'create'
     or v_outbound->>'entity' is distinct from 'deliverable'
     or v_outbound->>'entity_id' is distinct from p_row->>'id'
     or v_outbound->>'team' is distinct from v_team
     or v_outbound->>'operation' is distinct from 'create'
     or nullif(btrim(v_outbound->>'dedup_key'), '') is null
     or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
     or v_project_id is null then
    raise exception 'invalid_component_fill_payload';
  end if;

  -- SORT KEY IS INHERITED EXACTLY, null included. 21 of the 65 conforming
  -- siblings measured on 2026-08-31 carry a null sort_key, so "must be a
  -- number" would refuse a third of the population this exists to serve.
  -- Compared as numeric rather than as jsonb because jsonb preserves the
  -- scale it was given and 3 is not 3.0 textually.
  if p_row ? 'sort_key' and jsonb_typeof(p_row->'sort_key') not in ('number', 'null') then
    raise exception 'invalid_component_fill_payload';
  end if;
  if (p_row->>'sort_key')::numeric is distinct from v_sibling.sort_key then
    raise exception 'component_fill_sort_mismatch';
  end if;

  -- The parent route, byte-for-byte the append path's rule: either the batch's
  -- recorded parent for this team, or a pending batch-create outbox row this
  -- child depends on. Exactly one of the two.
  v_parent_id := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
  begin
    v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  exception when others then
    raise exception 'invalid_component_fill_route';
  end;
  if (v_parent_id is null) = (v_dependency_id is null) then
    raise exception 'invalid_component_fill_route';
  end if;
  /* THE PARENT ROUTE IS INHERITED TOO, and leaving it out was the one thing
     this function inherited from its sibling in principle and not in fact.
     Raised by Codex on PR 1195; measured before it was believed. Across the 47
     distinct batches behind the 127 half-complete cards this exists for, 25
     carry a parent entry for the team being FILLED and 22 do not -- nearly
     half. A single-team batch (a Video-only or Thumbnail-only post, the
     freshest thing anyone would press this button on) records a parent only for
     the team it was created with, so asking the map for the missing team's
     parent answers nothing and the write was refused
     batch_parent_mapping_missing on exactly the population it targets.

     A batch has ONE parent issue and every child of it hangs under that issue.
     The sibling is already the authority for which batch, which sort position,
     which due date and which title; it is the authority for the parent too. So
     the target team's own entry wins when it has one, and the sibling's is used
     when it does not -- the same resolution parentRouteForAppend performs in
     the gateway with `appendParentTeam`, and the same reason parentOwnerTeamFor
     exists: validate against the team that OWNS the parent, never the team
     doing the asking. */
  v_own_parent_ids := public.production_batch_parent_ids_for_team(
    v_batch.linear_parent_ids, v_team);
  if cardinality(v_own_parent_ids) > 1 then
    raise exception 'batch_parent_mapping_ambiguous';
  end if;
  v_sibling_parent_ids := public.production_batch_parent_ids_for_team(
    v_batch.linear_parent_ids, v_sibling.team);
  if cardinality(v_sibling_parent_ids) > 1 then
    raise exception 'batch_parent_mapping_ambiguous';
  end if;
  v_parent_ids := case
    when cardinality(v_own_parent_ids) = 1 then v_own_parent_ids
    else v_sibling_parent_ids
  end;

  if v_parent_id is not null then
    if cardinality(v_parent_ids) <> 1 or v_parent_ids[1] is distinct from v_parent_id then
      raise exception 'batch_parent_mapping_missing';
    end if;
  else
    select o.* into v_dependency
    from public.mirror_outbox o
    where o.id = v_dependency_id
    for share;
    if not found then
      raise exception 'batch_parent_mapping_missing';
    end if;
    /* The shared-parent waiver from the append path (v4): one Linear issue can
       serve both teams, and when it does, a graphics child legitimately arrives
       carrying the VIDEO batch-create dependency -- whose team, parity and
       project describe its own lane, not the row's.

       EARNED TWO WAYS HERE, and the second is what a single-team batch needs.
       Either both teams resolve to the identical single parent (the original
       shape, unchanged), or the target team has NO recorded parent at all and
       the dependency is the sibling's own batch-create lane -- the only parent
       this batch has. Still not a blanket waiver: a dependency belonging to a
       team that is neither the target nor the sibling fails exactly as it did
       before, and so does one on a batch where the target team does have its
       own parent and the two disagree. */
    v_dep_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_dependency.team);
    v_shared_parent := v_dependency.team is distinct from v_team
      and (
        (cardinality(v_own_parent_ids) = 1 and v_own_parent_ids = v_dep_parent_ids)
        or (cardinality(v_own_parent_ids) = 0
            and lower(btrim(coalesce(v_dependency.team, '')))
                = lower(btrim(coalesce(v_sibling.team, ''))))
      );
    if v_dependency.entity is distinct from 'batch'
       or v_dependency.entity_id is distinct from v_batch.id
       or v_dependency.operation is distinct from 'create'
       or v_dependency.client_slug is distinct from v_batch.client_slug
       or (v_dependency.team is distinct from v_team and not v_shared_parent)
       or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
       or (v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
           and not v_shared_parent)
       or (v_dependency.payload->>'project_id' is distinct from v_project_id
           and not v_shared_parent)
       or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale') then
      raise exception 'batch_parent_mapping_missing';
    end if;
    if cardinality(v_parent_ids) > 1 then
      raise exception 'batch_parent_mapping_ambiguous';
    end if;
    if cardinality(v_parent_ids) = 1 then
      v_dependency_parent_id := nullif(btrim(coalesce(
        v_dependency.linear_result->>'issue_id',
        v_dependency.linear_result->>'linear_issue_id',
        v_dependency.linear_result->'issue'->>'id',
        ''
      )), '');
      if v_dependency_parent_id is distinct from v_parent_ids[1] then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
    end if;
    if v_dependency.status in ('skipped', 'stale') then
      v_terminal_dependency := true;
    end if;
  end if;

  perform public.production_assert_authority(
    v_batch.client_slug,
    v_team,
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false)
  );

  -- An exact retry returns the row it already made, and does not make a second.
  v_replay := public.production_outbox_replay(
    'deliverable',
    p_row->>'id',
    'create',
    v_batch.client_slug,
    v_team,
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    coalesce((v_outbound->>'test_only')::boolean, false),
    coalesce((v_outbound->>'legacy_parity')::boolean, false),
    v_payload->>'_intent_fingerprint',
    v_outbound->>'dedup_key'
  );
  if v_replay then
    select d.* into v_result from public.deliverables d where d.id = p_row->>'id';
    if not found
       or v_result.batch_id is distinct from v_batch.id
       or v_result.client_slug is distinct from v_batch.client_slug
       or v_result.team is distinct from v_team
       or v_result.card_id is distinct from v_card_id
       or v_result.title is distinct from v_title then
      raise exception 'idempotent_result_missing';
    end if;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  v_result := public.production_deliverable_write(p_row, p_event);

  -- The cursor advances under the same batch lock and transaction as the child
  -- and its outbox intent, so a concurrent fill carrying this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(p_event->>'ts', '')::timestamptz, now()),
    nullif(p_event->>'actor', ''),
    nullif(p_event->>'role', ''),
    'component_fill',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(p_event->>'surface', ''),
      'card_id', v_card_id,
      'team', v_team,
      'sibling_id', v_sibling.id
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'item', to_jsonb(v_result), 'replay', false);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_intake_append(p_batch_id text, p_expected_updated_at timestamp with time zone, p_rows jsonb, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch public.batches%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_row jsonb;
  v_event jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_count integer;
  v_index integer;
  v_team text;
  v_card_id text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
  v_dep_parent_ids text[];
  v_shared_parent boolean;
  v_dependency_id bigint;
  v_project_id text;
  v_replay boolean;
  v_replay_count integer := 0;
  v_terminal_dependency boolean := false;
  v_rows_out jsonb := '[]'::jsonb;
  v_base_sort numeric;
  v_base_ordinal integer;
  v_group record;
  v_group_index integer := 0;
  v_expected_sort numeric;
  v_expected_ordinal integer;
  v_first_event jsonb;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null
     or p_expected_updated_at is null
     or jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid_intake_append_payload';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 100 or v_count <> jsonb_array_length(p_events) then
    raise exception 'invalid_intake_append_payload';
  end if;

  select b.* into v_batch
  from public.batches b
  where b.id = p_batch_id
  for update;
  if not found then raise exception 'batch_not_found'; end if;
  if v_batch.status is distinct from 'active' then raise exception 'batch_not_active'; end if;

  if (
    select count(distinct nullif(btrim(value->>'id'), ''))
    from jsonb_array_elements(p_rows)
  ) <> v_count then
    raise exception 'invalid_intake_append_payload';
  end if;
  -- v2: a card group is a video+graphics pair OR a single-team row (the
  -- 2026-08-17 Video only / Thumbnail only modes), never two of one team.
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by nullif(btrim(item->>'card_id'), '')
    having nullif(btrim(item->>'card_id'), '') is null
       or count(*) < 1 or count(*) > 2
       or count(*) filter (where item->>'team' = 'video') > 1
       or count(*) filter (where item->>'team' = 'graphics') > 1
  ) then
    raise exception 'invalid_intake_append_pair';
  end if;

  -- Validate the complete trusted plan and acquire every dedup lock before the
  -- first child write. An exact concurrent replay is recognized before CAS.
  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
    v_team := nullif(btrim(v_row->>'team'), '');
    v_card_id := nullif(btrim(v_row->>'card_id'), '');
    v_project_id := nullif(btrim(v_payload->>'project_id'), '');
    if nullif(btrim(v_row->>'id'), '') is null
       or v_row->>'batch_id' is distinct from v_batch.id
       or v_row->>'client_slug' is distinct from v_batch.client_slug
       or v_team is null
       or v_team not in ('video', 'graphics')
       or v_card_id is null
       -- ORIGIN NOW AGREES WITH THE BATCH, rather than being pinned to one
       -- value (2026-08-19, samples native create). A samples row may append
       -- only to a purpose='samples' batch and a calendar row only to a
       -- calendar batch; the pair is checked for agreement, so neither can
       -- leak into the other's batch. An origin that is neither is refused
       -- outright, so the widening cannot become an open door.
       or v_row->>'origin' not in ('calendar', 'samples')
       or v_row->>'origin' is distinct from coalesce(v_batch.purpose, 'calendar')
       -- The CASE is parenthesised on purpose: PL/pgSQL finds the end of an
       -- IF condition by scanning for the first THEN, so a bare CASE...THEN
       -- here truncates the whole condition and the function will not compile.
       or v_row->>'kind' is distinct from (case when v_team = 'graphics' then 'thumbnail' else 'video' end)
       or coalesce(v_row->>'_intake_ordinal', '') !~ '^[1-9][0-9]*$'
       or coalesce(v_row->>'sort_key', '') !~ '^-?[0-9]+([.][0-9]+)?$'
       or v_event->>'source' is distinct from 'ui'
       or v_event->>'action' is distinct from 'create'
       or v_outbound->>'entity' is distinct from 'deliverable'
       or v_outbound->>'entity_id' is distinct from v_row->>'id'
       or v_outbound->>'team' is distinct from v_team
       or v_outbound->>'operation' is distinct from 'create'
       or nullif(btrim(v_outbound->>'dedup_key'), '') is null
       or nullif(btrim(v_payload->>'_intent_fingerprint'), '') is null
       or v_project_id is null then
      raise exception 'invalid_intake_append_payload';
    end if;

    v_parent_id := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
    begin
      v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
    exception when others then
      raise exception 'invalid_intake_append_route';
    end;
    if (v_parent_id is null) = (v_dependency_id is null) then
      raise exception 'invalid_intake_append_route';
    end if;
    if v_parent_id is not null then
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) <> 1 or v_parent_ids[1] is distinct from v_parent_id then
        raise exception 'batch_parent_mapping_missing';
      end if;
    else
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.id = v_dependency_id
      for share;
      if not found then
        raise exception 'batch_parent_mapping_missing';
      end if;
      -- v4: the gateway resolves ONE parent route per batch and shares it
      -- across every team on the card, because a batch must hang under a
      -- single parent issue. So a graphics row legitimately arrives carrying
      -- the VIDEO batch-create dependency -- and that dependency describes
      -- its OWN lane, not the row's: its team is video, its legacy_parity is
      -- the video lane's (true while video is Linear-authoritative; the
      -- graphics lane runs parity false post-flip), and its payload project
      -- is the video project. v3 waived only the team equality, so the very
      -- next comparison (parity) refused the same appends for the same
      -- underlying reason, and the project comparison was waiting behind it
      -- for any client whose per-team projects differ.
      --
      -- The waiver is earned, not assumed: it applies only when both teams
      -- resolve to the IDENTICAL single parent issue -- one issue really
      -- does serve both, which is exactly the shape the create flow writes.
      -- When the teams match, every check below is as strict as it ever was.
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      v_dep_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_dependency.team);
      v_shared_parent := v_dependency.team is distinct from v_team
        and cardinality(v_parent_ids) = 1
        and v_parent_ids = v_dep_parent_ids;
      if v_dependency.entity is distinct from 'batch'
         or v_dependency.entity_id is distinct from v_batch.id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_batch.client_slug
         or (v_dependency.team is distinct from v_team and not v_shared_parent)
         or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
         or (v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
             and not v_shared_parent)
         or (v_dependency.payload->>'project_id' is distinct from v_project_id
             and not v_shared_parent)
         or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale') then
        raise exception 'batch_parent_mapping_missing';
      end if;
      v_parent_ids := public.production_batch_parent_ids_for_team(v_batch.linear_parent_ids, v_team);
      if cardinality(v_parent_ids) > 1 then
        raise exception 'batch_parent_mapping_ambiguous';
      end if;
      if cardinality(v_parent_ids) = 1 then
        v_dependency_parent_id := nullif(btrim(coalesce(
          v_dependency.linear_result->>'issue_id',
          v_dependency.linear_result->>'linear_issue_id',
          v_dependency.linear_result->'issue'->>'id',
          ''
        )), '');
        if v_dependency_parent_id is distinct from v_parent_ids[1] then
          raise exception 'batch_parent_mapping_ambiguous';
        end if;
      end if;
      if v_dependency.status in ('skipped', 'stale') then
        v_terminal_dependency := true;
      end if;
    end if;

    perform public.production_assert_authority(
      v_batch.client_slug,
      v_team,
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false)
    );
    v_replay := public.production_outbox_replay(
      'deliverable',
      v_row->>'id',
      'create',
      v_batch.client_slug,
      v_team,
      nullif(v_event->>'actor', ''),
      nullif(v_event->>'role', ''),
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false),
      v_payload->>'_intent_fingerprint',
      v_outbound->>'dedup_key'
    );
    if v_replay then v_replay_count := v_replay_count + 1; end if;
  end loop;

  if v_replay_count > 0 and v_replay_count <> v_count then
    raise exception 'idempotency_conflict';
  end if;
  if v_replay_count = v_count then
    for v_index in 0..v_count - 1
    loop
      v_row := p_rows->v_index;
      select d.* into v_result from public.deliverables d where d.id = v_row->>'id';
      if not found
         or v_result.batch_id is distinct from v_batch.id
         or v_result.client_slug is distinct from v_batch.client_slug
         or v_result.team is distinct from v_row->>'team'
         or v_result.card_id is distinct from v_row->>'card_id'
         or v_result.title is distinct from v_row->>'title'
         or v_result.sort_key is distinct from (v_row->>'sort_key')::numeric then
        raise exception 'idempotent_result_missing';
      end if;
      v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
    end loop;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', true);
  end if;
  if v_terminal_dependency then raise exception 'batch_parent_mapping_missing'; end if;

  if v_batch.updated_at is distinct from p_expected_updated_at then
    raise exception 'write_conflict';
  end if;

  select coalesce(max(d.sort_key), -1)
    into v_base_sort
  from public.deliverables d
  where d.batch_id = v_batch.id
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );
  -- v2: Thumbnail titles advance the ordinal too, so a thumbnail-only
  -- batch never reissues an already-used number.
  -- The optional 'Sample ' prefix counts too: the first live samples batch
  -- predates the title ruling and its children read 'Video 1' / 'Thumbnail 1',
  -- so a strict per-purpose count would restart its numbering at 1.
  -- v8: a NAMED child counts too. 'Video 4 — Launch hook' has consumed the
  -- number 4 exactly as 'Video 4' would; the substring still captures only the
  -- digits, because the name group is non-capturing. Miss this and the next
  -- append hands out a number the batch is already using.
  select coalesce(max(substring(d.title from '^(?:Sample )?(?:Video|Thumbnail) ([1-9][0-9]*)(?: — .+)?$')::integer), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
    and d.title ~ '^(?:Sample )?(?:Video|Thumbnail) [1-9][0-9]*(?: — .+)?$'
    and not exists (
      select 1 from jsonb_array_elements(p_rows) item where item->>'id' = d.id
    );

  for v_group in
    select item->>'card_id' as card_id, min(ordinality) as first_ordinality
    from jsonb_array_elements(p_rows) with ordinality entries(item, ordinality)
    group by item->>'card_id'
    order by min(ordinality)
  loop
    v_group_index := v_group_index + 1;
    v_expected_sort := v_base_sort + v_group_index;
    v_expected_ordinal := v_base_ordinal + v_group_index;
    if exists (
      select 1
      from jsonb_array_elements(p_rows) item
      where item->>'card_id' = v_group.card_id
        and (
          (item->>'sort_key')::numeric is distinct from v_expected_sort
          or (item->>'_intake_ordinal')::integer is distinct from v_expected_ordinal
          -- v2: titles are per kind; the Jul 13 text demanded 'Video N' on
          -- both halves, which the create path never produced.
          -- Parenthesised for the same reason as the kind check above: this
          -- CASE sits inside an IF condition, and its THEN would otherwise be
          -- read as the end of that condition.
          -- v6: a samples batch titles its children 'Sample Video N' /
          -- 'Sample Thumbnail N' (owner ruling 2026-08-19). The prefix is
          -- derived from the BATCH's purpose -- the same column the origin
          -- agreement above checks -- so a title can never disagree with the
          -- batch it lands in. Fully parenthesised for the same IF/THEN
          -- reason as every CASE in this condition.
          -- v8: the composed head is unchanged and still exact; what may
          -- follow it is an optional ' — <name>' the owner typed into Create
          -- Post (2026-09-07). The `like` pattern is safe to build this way
          -- because the head is composed here, not supplied: it is only
          -- 'Sample ', 'Video '/'Thumbnail ' and digits, so it can carry no
          -- `%` or `_` of its own. The `_` after the separator makes the
          -- suffix non-empty -- a title ending in a bare separator is refused,
          -- not quietly accepted as unnamed.
          or not (
            item->>'title' = (
              (case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)
              || (case
                when item->>'team' = 'graphics' then 'Thumbnail ' || v_expected_ordinal::text
                else 'Video ' || v_expected_ordinal::text
              end)
            )
            or item->>'title' like (
              (case when coalesce(v_batch.purpose, 'calendar') = 'samples' then 'Sample ' else '' end)
              || (case
                when item->>'team' = 'graphics' then 'Thumbnail ' || v_expected_ordinal::text
                else 'Video ' || v_expected_ordinal::text
              end)
              || ' — _%'
            )
          )
        )
    ) then
      raise exception 'invalid_intake_append_order';
    end if;
  end loop;

  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_result := public.production_deliverable_write(v_row - '_intake_ordinal', v_event);
    v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
  end loop;

  -- The cursor advances under the same batch lock and transaction as both
  -- children/outbox intents. A concurrent append with this cursor now fails.
  perform set_config('app.event_written', '1', true);
  update public.batches b
  set updated_at = clock_timestamp()
  where b.id = v_batch.id
  returning b.* into v_batch;

  v_first_event := p_events->0;
  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    null,
    v_batch.id,
    v_batch.client_slug,
    coalesce(nullif(v_first_event->>'ts', '')::timestamptz, now()),
    nullif(v_first_event->>'actor', ''),
    nullif(v_first_event->>'role', ''),
    'intake_append',
    null,
    null,
    'ui',
    jsonb_build_object(
      'surface', nullif(v_first_event->>'surface', ''),
      'item_count', v_count,
      'card_count', (
        select count(distinct nullif(btrim(item->>'card_id'), ''))
        from jsonb_array_elements(p_rows) item
      )
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', false);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_issue_create(p_batch jsonb, p_row jsonb, p_event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_batch_input jsonb := coalesce(p_batch, '{}'::jsonb);
  v_row jsonb := coalesce(p_row, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_outbound jsonb := coalesce(v_event->'outbound', '{}'::jsonb);
  v_payload jsonb := coalesce(v_outbound->'payload', '{}'::jsonb);
  v_raw jsonb := coalesce(v_row->'linear_raw', '{}'::jsonb);
  v_issue jsonb := coalesce(v_row->'linear_raw'->'issue', '{}'::jsonb);
  v_attribution jsonb := coalesce(v_row->'linear_raw'->'attribution', '{}'::jsonb);
  v_id text := nullif(btrim(v_row->>'id'), '');
  v_batch_id text := nullif(btrim(v_row->>'batch_id'), '');
  v_client_slug text := nullif(btrim(v_row->>'client_slug'), '');
  v_team text := nullif(btrim(v_row->>'team'), '');
  v_dedup text := nullif(btrim(v_outbound->>'dedup_key'), '');
  v_fingerprint text := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
  v_planned_linear_id text := nullif(btrim(v_payload->>'planned_linear_issue_id'), '');
  v_parent_id text := nullif(btrim(v_event->>'parent_deliverable_id'), '');
  v_parent_linear_id text;
  v_direct_parent_id text := nullif(btrim(v_payload->>'parent_linear_issue_id'), '');
  v_dependency_id bigint;
  v_test_only boolean := coalesce((v_outbound->>'test_only')::boolean, false);
  v_legacy_parity boolean := coalesce((v_outbound->>'legacy_parity')::boolean, false);
  v_replay boolean;
  v_result public.deliverables%rowtype;
  v_batch public.batches%rowtype;
  v_parent public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_outbox_id bigint;
  v_count integer;
  v_event_count integer;
  v_batch_parent_ids text[];
begin
  if jsonb_typeof(v_batch_input) is distinct from 'object'
     or jsonb_typeof(v_row) is distinct from 'object'
     or jsonb_typeof(v_event) is distinct from 'object'
     or jsonb_typeof(v_outbound) is distinct from 'object'
     or jsonb_typeof(v_payload) is distinct from 'object'
     or v_id is null
     or v_batch_id is null
     or v_client_slug is null
     or v_team not in ('video', 'graphics')
     or v_dedup is null
     or v_fingerprint is null
     or v_planned_linear_id is null
     or v_event->>'source' is distinct from 'ui'
     or v_event->>'action' is distinct from 'create'
     or v_event->>'surface' is distinct from 'production'
     or nullif(btrim(v_event->>'actor'), '') is null
     or nullif(btrim(v_event->>'actor_key'), '') is null
     or nullif(btrim(v_event->>'role'), '') is null
     or nullif(btrim(v_event->>'auth_kind'), '') is null
     or nullif(btrim(v_event->>'ts'), '') is null
     or v_outbound->>'entity' is distinct from 'deliverable'
     or v_outbound->>'entity_id' is distinct from v_id
     or v_outbound->>'team' is distinct from v_team
     or v_outbound->>'operation' is distinct from 'create'
     or nullif(v_outbound->>'source_edited_at', '')::timestamptz
          is distinct from nullif(v_event->>'ts', '')::timestamptz
     or v_legacy_parity
     or v_row->>'kind' is distinct from 'other'
     or v_row->>'origin' is distinct from 'manual'
     or nullif(btrim(v_row->>'card_id'), '') is not null
     or v_row->>'created_by' is distinct from v_event->>'actor_key'
     or nullif(v_row->>'created_at', '')::timestamptz
          is distinct from nullif(v_event->>'ts', '')::timestamptz
     or v_row->>'linear_issue_uuid' is distinct from v_planned_linear_id
     or v_issue->>'id' is distinct from v_planned_linear_id
     or v_issue->'project'->>'id' is distinct from v_payload->>'project_id'
     or v_issue->'team'->>'id' is distinct from v_payload->>'team_id'
     or v_issue->'state'->>'id' is distinct from v_payload->>'state_id'
     or v_issue->>'title' is distinct from v_row->>'title'
     or v_payload->>'title' is distinct from v_row->>'title'
     or jsonb_typeof(v_payload->'description') is distinct from 'string'
     or v_payload->>'description' is distinct from coalesce(v_row->>'brief', '')
     or v_issue->>'description' is distinct from v_payload->>'description'
     or v_payload->>'status' is distinct from v_row->>'status'
     or coalesce(nullif(v_payload->>'due_date', ''), '')
          is distinct from coalesce(nullif(v_row->>'due_date', ''), '')
     or coalesce(nullif(v_issue->>'dueDate', ''), '')
          is distinct from coalesce(nullif(v_payload->>'due_date', ''), '')
     or coalesce(nullif(v_payload->>'assignee_id', ''), '')
          is distinct from coalesce(nullif(v_row->>'assignee_id', ''), '')
     or coalesce(nullif(v_issue->'assignee'->>'id', ''), '')
          is distinct from coalesce(nullif(v_payload->>'linear_user_id', ''), '')
     or jsonb_typeof(v_payload->'label_ids') is distinct from 'array'
     or jsonb_array_length(v_payload->'label_ids') > 250
     or v_issue->'labelIds' is distinct from v_payload->'label_ids'
     or jsonb_typeof(v_issue->'labels'->'nodes') is distinct from 'array'
     or jsonb_array_length(v_issue->'labels'->'nodes')
          is distinct from jsonb_array_length(v_payload->'label_ids')
     or v_issue->'labels'->'pageInfo'->'hasNextPage' is distinct from 'false'::jsonb
     or v_attribution->>'schema' is distinct from 'syncview_attribution_v1'
     or v_attribution->>'state' is distinct from 'resolved'
     or v_attribution->>'client_slug' is distinct from v_client_slug
     or v_attribution->>'project_id' is distinct from v_payload->>'project_id'
     or coalesce((v_attribution->>'repair_required')::boolean, true) then
    raise exception 'invalid_production_create_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_payload->'label_ids') item
    where jsonb_typeof(item) is distinct from 'string'
  ) or (
    select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
    from (
      select distinct value #>> '{}' as label
      from jsonb_array_elements(v_payload->'label_ids') value
    ) labels
  ) is distinct from v_payload->'label_ids' then
    raise exception 'invalid_production_create_payload';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_issue->'labels'->'nodes') node
    where jsonb_typeof(node) is distinct from 'object'
       or jsonb_typeof(node->'id') is distinct from 'string'
  ) or (
    select coalesce(jsonb_agg(label order by label), '[]'::jsonb)
    from (
      select distinct node->>'id' as label
      from jsonb_array_elements(v_issue->'labels'->'nodes') node
    ) labels
  ) is distinct from v_payload->'label_ids' then
    raise exception 'invalid_production_create_payload';
  end if;
  if (nullif(v_row->>'assignee_id', '') is null)
       is distinct from (nullif(v_payload->>'linear_user_id', '') is null) then
    raise exception 'invalid_production_create_payload';
  end if;
  begin
    v_dependency_id := nullif(btrim(v_outbound->>'depends_on_id'), '')::bigint;
  exception when others then
    raise exception 'production_create_parent_route';
  end;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  perform pg_advisory_xact_lock(hashtextextended('production-batch:' || v_batch_id, 0));
  v_replay := public.production_outbox_replay(
    'deliverable',
    v_id,
    'create',
    v_client_slug,
    v_team,
    nullif(v_event->>'actor', ''),
    nullif(v_event->>'role', ''),
    v_test_only,
    false,
    v_fingerprint,
    v_dedup
  );

  if v_replay then
    select d.* into v_result
    from public.deliverables d
    where d.id = v_id
    for share;
    select b.* into v_batch
    from public.batches b
    where b.id = v_batch_id
    for share;
    if v_result.id is null
       or v_batch.id is null
       or v_result.batch_id is distinct from v_batch_id
       or v_result.client_slug is distinct from v_client_slug
       or v_result.team is distinct from v_team
       or v_result.kind is distinct from 'other'
       or v_result.origin is distinct from 'manual'
       or v_result.card_id is not null
       or v_result.created_by is distinct from v_row->>'created_by'
       or v_result.created_at is distinct from nullif(v_row->>'created_at', '')::timestamptz
       or v_result.linear_issue_uuid is distinct from v_planned_linear_id
       or v_batch.client_slug is distinct from v_client_slug
       or (v_batch.team is not null and v_batch.team is distinct from v_team) then
      raise exception 'production_create_id_conflict';
    end if;
    select count(*), max(o.id)
      into v_count, v_outbox_id
    from public.mirror_outbox o
    where o.dedup_key = v_dedup
      and o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.operation = 'create'
      and o.client_slug = v_client_slug
      and o.team = v_team
      and o.actor is not distinct from nullif(v_event->>'actor', '')
      and o.role is not distinct from nullif(v_event->>'role', '')
      and o.test_only is not distinct from v_test_only
      and not o.legacy_parity
      and o.source_edited_at is not distinct from nullif(v_event->>'ts', '')::timestamptz
      and o.payload->>'_intent_fingerprint' = v_fingerprint
      and o.payload->>'planned_linear_issue_id' = v_planned_linear_id;
    select count(*)
      into v_event_count
    from public.deliverable_events e
    where e.deliverable_id = v_id
      and e.batch_id = v_batch_id
      and e.client_slug = v_client_slug
      and e.actor is not distinct from nullif(v_event->>'actor', '')
      and e.role is not distinct from nullif(v_event->>'role', '')
      and e.action = 'create'
      and e.source = 'ui'
      and e.ts is not distinct from nullif(v_event->>'ts', '')::timestamptz
      and e.payload->>'surface' = 'production'
      and e.payload->>'actor_key' = v_event->>'actor_key'
      and e.payload->>'auth_kind' = v_event->>'auth_kind'
      and e.payload->>'parent_deliverable_id' is not distinct from v_parent_id
      and not (e.payload ? 'outbound')
      and e.payload->'outbound_redacted'->>'operation' = 'create'
      and e.payload->'outbound_redacted'->>'dedup_key' = v_dedup
      and e.payload->'outbound_redacted'->>'intent_fingerprint' = v_fingerprint;
    if v_count <> 1 or v_outbox_id is null or v_event_count <> 1 then
      raise exception 'production_create_receipt_missing';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch.linear_parent_ids,
      v_team
    );
    if v_parent_id is null then
      if nullif(btrim(coalesce(
           v_result.linear_raw->'issue'->'parent'->>'id',
           v_result.linear_raw->'issue'->>'parentId',
           ''
         )), '') is not null
         or cardinality(v_batch_parent_ids) <> 1
         or v_batch_parent_ids[1] is distinct from v_planned_linear_id
         or not exists (
           select 1
           from public.deliverable_events e
           where e.deliverable_id is null
             and e.batch_id = v_batch_id
             and e.client_slug = v_client_slug
             and e.actor is not distinct from nullif(v_event->>'actor', '')
             and e.role is not distinct from nullif(v_event->>'role', '')
             and e.action = 'production_issue_container_create'
             and e.source = 'system'
             and e.payload->>'surface' = 'production'
             and e.payload->>'deliverable_id' = v_id
             and e.payload->>'structural_only' = 'true'
         ) then
        raise exception 'production_create_id_conflict';
      end if;
    else
      select d.* into v_parent
      from public.deliverables d
      where d.id = v_parent_id
      for share;
      if not found
         or v_parent.batch_id is distinct from v_batch_id
         or v_parent.client_slug is distinct from v_client_slug
         or v_parent.team is distinct from v_team
         or v_parent.linear_issue_uuid is null
         or nullif(btrim(coalesce(
              v_parent.linear_raw->'issue'->'parent'->>'id',
              v_parent.linear_raw->'issue'->>'parentId',
              ''
            )), '') is not null
         or nullif(btrim(coalesce(
              v_result.linear_raw->'issue'->'parent'->>'id',
              v_result.linear_raw->'issue'->>'parentId',
              ''
            )), '') is distinct from v_parent.linear_issue_uuid
         or cardinality(v_batch_parent_ids) <> 1
         or v_batch_parent_ids[1] is distinct from v_parent.linear_issue_uuid then
        raise exception 'production_create_id_conflict';
      end if;
    end if;
    return jsonb_build_object(
      'row', to_jsonb(v_result),
      'batch', to_jsonb(v_batch),
      'outbox_id', v_outbox_id,
      'replay', true
    );
  end if;

  perform public.production_assert_authority(
    v_client_slug,
    v_team,
    v_test_only,
    false
  );
  if exists (
    select 1 from public.deliverables d
    where d.id = v_id or d.linear_issue_uuid = v_planned_linear_id
  ) then
    raise exception 'production_create_id_conflict';
  end if;

  if v_parent_id is null then
    if v_dependency_id is not null
       or v_direct_parent_id is not null
       or v_issue->'parent' is distinct from 'null'::jsonb
       or v_batch_input->>'id' is distinct from v_batch_id
       or v_batch_input->>'client_slug' is distinct from v_client_slug
       or v_batch_input->>'team' is distinct from v_team
       or v_batch_input->>'name' is distinct from v_row->>'title'
       or v_batch_input->>'status' is distinct from 'active'
       or nullif(btrim(v_batch_input->>'description'), '') is not null
       or jsonb_typeof(v_batch_input->'linear_parent_ids') is distinct from 'object' then
      raise exception 'invalid_production_create_payload';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch_input->'linear_parent_ids',
      v_team
    );
    if cardinality(v_batch_parent_ids) <> 1
       or v_batch_parent_ids[1] is distinct from v_planned_linear_id
       or exists (select 1 from public.batches b where b.id = v_batch_id) then
      raise exception 'production_create_id_conflict';
    end if;
    v_batch := public.batch_write(
      v_batch_input,
      jsonb_build_object(
        'source', 'system',
        'action', 'production_issue_container_create',
        'actor', nullif(v_event->>'actor', ''),
        'role', nullif(v_event->>'role', ''),
        'ts', nullif(v_event->>'ts', ''),
        'surface', 'production',
        'deliverable_id', v_id,
        'structural_only', true
      )
    );
  else
    if v_batch_input <> '{}'::jsonb then
      raise exception 'invalid_production_create_payload';
    end if;
    select d.* into v_parent
    from public.deliverables d
    where d.id = v_parent_id
    for share;
    if not found
       or v_parent.client_slug is distinct from v_client_slug
       or v_parent.team is distinct from v_team
       or v_parent.batch_id is distinct from v_batch_id
       or v_parent.linear_issue_uuid is null
       or v_parent.linear_raw->'attribution'->>'state' is distinct from 'resolved'
       or v_parent.linear_raw->'attribution'->>'client_slug' is distinct from v_client_slug
       or v_parent.linear_raw->'issue'->'project'->>'id' is distinct from v_payload->>'project_id'
       or nullif(btrim(v_parent.linear_raw->'issue'->'parent'->>'id'), '') is not null then
      raise exception 'production_create_parent_scope';
    end if;
    v_parent_linear_id := v_parent.linear_issue_uuid;
    if v_issue->'parent'->>'id' is distinct from v_parent_linear_id then
      raise exception 'production_create_parent_route';
    end if;
    select b.* into v_batch
    from public.batches b
    where b.id = v_batch_id
    for share;
    if not found
       or v_batch.client_slug is distinct from v_client_slug
       or (v_batch.team is not null and v_batch.team is distinct from v_team)
       or v_batch.status is distinct from 'active' then
      raise exception 'production_create_batch_scope';
    end if;
    v_batch_parent_ids := public.production_batch_parent_ids_for_team(
      v_batch.linear_parent_ids,
      v_team
    );
    if cardinality(v_batch_parent_ids) <> 1
       or v_batch_parent_ids[1] is distinct from v_parent_linear_id
       or (v_direct_parent_id is null) = (v_dependency_id is null) then
      raise exception 'production_create_parent_route';
    end if;
    if v_dependency_id is not null then
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.id = v_dependency_id
      for share;
      if not found
         or v_dependency.entity is distinct from 'deliverable'
         or v_dependency.entity_id is distinct from v_parent_id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_client_slug
         or v_dependency.team is distinct from v_team
         or v_dependency.payload->>'project_id' is distinct from v_payload->>'project_id'
         or v_dependency.status not in ('pending', 'failed', 'shadow_ok', 'written') then
        raise exception 'production_create_parent_route';
      end if;
      if v_dependency.status = 'written' and nullif(btrim(coalesce(
        v_dependency.linear_result->>'issue_id',
        v_dependency.linear_result->>'linear_issue_id',
        v_dependency.linear_result->'issue'->>'id',
        ''
      )), '') is distinct from v_parent_linear_id then
        raise exception 'production_create_parent_route';
      elsif v_dependency.status <> 'written'
            and (
              v_dependency.test_only is distinct from v_test_only
              or v_dependency.legacy_parity
            ) then
        raise exception 'production_create_parent_route';
      end if;
    elsif v_direct_parent_id is distinct from v_parent_linear_id then
      raise exception 'production_create_parent_route';
    end if;
  end if;

  v_result := public.production_deliverable_write(v_row, v_event);
  select count(*), max(o.id)
    into v_count, v_outbox_id
  from public.mirror_outbox o
  where o.dedup_key = v_dedup
    and o.entity = 'deliverable'
    and o.entity_id = v_id
    and o.operation = 'create';
  if v_count <> 1 or v_outbox_id is null then
    raise exception 'production_create_outbox_not_exact';
  end if;
  if v_parent_id is null and exists (
    select 1 from public.mirror_outbox o
    where o.entity = 'batch'
      and o.entity_id = v_batch_id
      and o.operation = 'create'
  ) then
    raise exception 'production_create_batch_outbox_forbidden';
  end if;

  update public.deliverable_events e
  set payload = (e.payload - 'outbound') || jsonb_build_object(
    'outbound_redacted',
    jsonb_build_object(
      'operation', 'create',
      'dedup_key', v_dedup,
      'intent_fingerprint', v_fingerprint
    )
  )
  where e.deliverable_id = v_id
    and e.action = 'create'
    and e.source = 'ui'
    and e.payload->'outbound'->>'dedup_key' = v_dedup;
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'production_create_audit_redaction_not_exact';
  end if;

  return jsonb_build_object(
    'row', to_jsonb(v_result),
    'batch', to_jsonb(v_batch),
    'outbox_id', v_outbox_id,
    'replay', false
  );
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_issue_create_linkage(p_deliverable_id text, p_outbox_id bigint, p_expected jsonb, p_issue jsonb)
 RETURNS deliverables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_expected jsonb := coalesce(p_expected, '{}'::jsonb);
  v_issue jsonb := coalesce(p_issue, '{}'::jsonb);
  v_linear_id text := nullif(btrim(v_issue->>'id'), '');
  v_identifier text := nullif(btrim(v_issue->>'identifier'), '');
  v_url text := nullif(btrim(v_issue->>'url'), '');
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_current_issue jsonb;
  v_patched_issue jsonb;
  v_has_later_pending boolean;
begin
  if v_id is null
     or p_outbox_id is null
     or p_outbox_id < 1
     or jsonb_typeof(v_expected) is distinct from 'object'
     or jsonb_typeof(v_issue) is distinct from 'object'
     or v_expected->>'id' is distinct from v_id
     or v_linear_id is null
     or v_expected->>'planned_linear_issue_id' is distinct from v_linear_id
     or nullif(btrim(v_expected->>'intent_fingerprint'), '') is null then
    raise exception 'invalid_production_create_linkage';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_result
  from public.deliverables d
  where d.id = v_id
  for update;
  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for share;
  if v_result.id is null
     or v_outbox.id is null
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_id
     or v_outbox.operation is distinct from 'create'
     or v_outbox.client_slug is distinct from v_result.client_slug
     or v_outbox.team is distinct from v_result.team
     or v_outbox.status not in ('pending', 'failed', 'shadow_ok', 'written')
     or v_outbox.payload->>'planned_linear_issue_id' is distinct from v_linear_id
     or v_outbox.payload->>'_intent_fingerprint'
          is distinct from v_expected->>'intent_fingerprint'
     or v_result.batch_id is distinct from v_expected->>'batch_id'
     or v_result.client_slug is distinct from v_expected->>'client_slug'
     or v_result.team is distinct from v_expected->>'team'
     or v_result.kind is distinct from v_expected->>'kind'
     or v_result.origin is distinct from v_expected->>'origin'
     or coalesce(v_result.card_id, '')
          is distinct from coalesce(nullif(v_expected->>'card_id', ''), '')
     or v_result.created_by is distinct from v_expected->>'created_by'
     or v_result.created_at
          is distinct from nullif(v_expected->>'created_at', '')::timestamptz
     or v_result.linear_issue_uuid is distinct from v_linear_id
     or jsonb_typeof(v_result.linear_raw) is distinct from 'object'
     or jsonb_typeof(v_result.linear_raw->'issue') is distinct from 'object' then
    raise exception 'production_create_linkage_conflict';
  end if;

  v_current_issue := v_result.linear_raw->'issue';
  v_patched_issue := jsonb_set(
    jsonb_set(
      jsonb_set(v_current_issue, '{id}', to_jsonb(v_linear_id), true),
      '{identifier}', coalesce(to_jsonb(v_identifier), 'null'::jsonb), true
    ),
    '{url}', coalesce(to_jsonb(v_url), 'null'::jsonb), true
  );
  select exists (
    select 1
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.id > p_outbox_id
      and o.status in ('pending', 'failed', 'shadow_ok')
  ) into v_has_later_pending;

  -- This RPC writes its own exact linkage audit row below. Suppress the
  -- generic direct-write guard so one acknowledgement cannot emit a second,
  -- misleading rpc_bypass_guard event.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set linear_issue_uuid = v_linear_id,
      linear_identifier = v_identifier,
      linear_issue_url = v_url,
      linear_raw = jsonb_set(v_result.linear_raw, '{issue}', v_patched_issue, true),
      sync_state = case when v_has_later_pending then 'pending' else 'clean' end,
      updated_at = now()
  where d.id = v_id
  returning d.* into v_result;

  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    now(),
    'SyncView Mirror',
    'system',
    'mirror_out_create_link',
    v_result.status,
    v_result.status,
    'outbound',
    jsonb_build_object(
      'outbox_id', p_outbox_id,
      'linkage_only', true,
      'later_pending', v_has_later_pending
    )
  );
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_issue_create_quarantine(p_deliverable_id text, p_outbox_id bigint)
 RETURNS deliverables
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_raw jsonb;
  v_marker jsonb;
begin
  if v_id is null or p_outbox_id is null or p_outbox_id < 1 then
    raise exception 'invalid_production_create_quarantine';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:' || v_id, 0));
  select d.* into v_result
  from public.deliverables d
  where d.id = v_id
  for update;
  select o.* into v_outbox
  from public.mirror_outbox o
  where o.id = p_outbox_id
  for share;

  if v_result.id is null
     or v_outbox.id is null
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_id
     or v_outbox.operation is distinct from 'create'
     or v_outbox.client_slug is distinct from v_result.client_slug
     or v_outbox.team is distinct from v_result.team
     or nullif(btrim(v_outbox.payload->>'planned_linear_issue_id'), '') is null
     or v_outbox.payload->>'planned_linear_issue_id'
          is distinct from v_result.linear_issue_uuid
     or v_outbox.linear_result->'conflict'->>'decision'
          is distinct from 'idempotency_conflict'
     or jsonb_typeof(v_result.linear_raw) is distinct from 'object' then
    raise exception 'production_create_quarantine_conflict';
  end if;

  v_raw := v_result.linear_raw;
  if v_raw->'identity_repair'->>'state' = 'required'
     and (v_raw->'identity_repair'->>'outbox_id')::bigint = p_outbox_id then
    return v_result;
  end if;
  if v_raw ? 'identity_repair' then
    raise exception 'production_create_quarantine_conflict';
  end if;

  v_marker := jsonb_build_object(
    'schema', 'syncview_create_identity_repair_v1',
    'state', 'required',
    'reason', 'linear_create_idempotency_conflict',
    'outbox_id', p_outbox_id,
    'planned_linear_issue_id', v_result.linear_issue_uuid,
    'detected_at', now()
  );

  -- This RPC emits its own exact audit row below.
  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set sync_state = 'error',
      linear_raw = jsonb_set(v_raw, '{identity_repair}', v_marker, true),
      updated_at = now()
  where d.id = v_id
  returning d.* into v_result;

  insert into public.deliverable_events(
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload
  ) values (
    v_result.id,
    v_result.batch_id,
    v_result.client_slug,
    now(),
    'SyncView Mirror',
    'system',
    'production_create_identity_quarantined',
    v_result.status,
    v_result.status,
    'outbound',
    jsonb_build_object(
      'outbox_id', p_outbox_id,
      'state', 'required',
      'reason', 'linear_create_idempotency_conflict',
      'read_only', true
    )
  );
  return v_result;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.production_workload_label_projection(p_raw jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_issue jsonb;
  v_relation jsonb;
  v_nodes jsonb;
  v_page jsonb;
  v_node jsonb;
  v_value jsonb;
  v_id text;
  v_name text;
  v_color text;
  v_ids text[] := array[]::text[];
  v_names text[] := array[]::text[];
  v_selected text[] := array[]::text[];
  v_labels jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_raw) is distinct from 'object' then
    return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
  end if;
  v_issue := p_raw->'issue';
  v_relation := v_issue->'labels';
  v_nodes := v_relation->'nodes';
  v_page := v_relation->'pageInfo';
  if jsonb_typeof(v_issue) is distinct from 'object'
     or jsonb_typeof(v_relation) is distinct from 'object'
     or jsonb_typeof(v_nodes) is distinct from 'array'
     or jsonb_typeof(v_page) is distinct from 'object'
     or jsonb_typeof(v_page->'hasNextPage') is distinct from 'boolean'
     or (v_page->>'hasNextPage')::boolean is not false
     or jsonb_array_length(v_nodes) > 250 then
    return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
  end if;

  for v_node in select value from jsonb_array_elements(v_nodes)
  loop
    if jsonb_typeof(v_node) is distinct from 'object' then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    v_id := nullif(btrim(v_node->>'id'), '');
    v_name := nullif(btrim(v_node->>'name'), '');
    if v_id is null or length(v_id) > 200
       or v_name is null or length(v_name) > 200
       or v_id = any(v_ids)
       or v_name = any(v_names) then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    v_ids := array_append(v_ids, v_id);
    v_names := array_append(v_names, v_name);
    if v_name in (U&'2\00D7 Workload', U&'3\00D7 Workload') then
      v_color := case
        when coalesce(v_node->>'color', '') ~ '^#[0-9A-Fa-f]{6}$'
          then upper(v_node->>'color')
        else null
      end;
      v_labels := v_labels || jsonb_build_array(jsonb_build_object(
        'id', v_id,
        'name', v_name,
        'color', v_color
      ));
    end if;
  end loop;

  if v_issue ? 'labelIds' then
    if jsonb_typeof(v_issue->'labelIds') is distinct from 'array'
       or jsonb_array_length(v_issue->'labelIds') > 250 then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
    for v_value in select value from jsonb_array_elements(v_issue->'labelIds')
    loop
      if jsonb_typeof(v_value) is distinct from 'string' then
        return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
      end if;
      v_id := nullif(btrim(v_value #>> '{}'), '');
      if v_id is null or length(v_id) > 200 or v_id = any(v_selected) then
        return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
      end if;
      v_selected := array_append(v_selected, v_id);
    end loop;
    if cardinality(v_selected) <> cardinality(v_ids)
       or exists (
         select 1 from unnest(v_selected) selected_id
         where not selected_id = any(v_ids)
       )
       or exists (
         select 1 from unnest(v_ids) node_id
         where not node_id = any(v_selected)
       ) then
      return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
    end if;
  end if;

  return jsonb_build_object('complete', true, 'labels', v_labels);
exception when others then
  return jsonb_build_object('complete', false, 'labels', '[]'::jsonb);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.pto_create_request_v1(p_member_id uuid, p_type text, p_start_date date, p_end_date date, p_days numeric, p_note text, p_source text, p_expected_state_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    declare
      v_member public.pto_members%rowtype;
      v_inserted public.pto_requests%rowtype;
    begin
      perform 1
      from public.team_members
      where id = p_member_id
        and active is true
      for update;
      if not found then return jsonb_build_object('status', 'member_not_found'); end if;

      select * into v_member
      from public.pto_members
      where member_id = p_member_id
      for update;
      if not found then return jsonb_build_object('status', 'member_not_found'); end if;
      if not v_member.pto_enabled then return jsonb_build_object('status', 'not_enabled'); end if;
      if v_member.state_version <> p_expected_state_version then
        return jsonb_build_object('status', 'stale');
      end if;

      insert into public.pto_requests (
        member_id, type, start_date, end_date, days, note, source
      ) values (
        p_member_id, p_type, p_start_date, p_end_date, p_days,
        coalesce(p_note, ''), p_source
      )
      returning * into v_inserted;

      return jsonb_build_object('status', 'ok', 'request', to_jsonb(v_inserted));
    exception
      when unique_violation then
        if p_type = 'floating_holiday' then
          return jsonb_build_object('status', 'floating_holiday_used');
        end if;
        raise;
    end;
    $function$

;
CREATE OR REPLACE FUNCTION public.pto_finalize_decision_v1(p_request_id uuid, p_decision text, p_decision_note text, p_actor text, p_expected_state_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    declare
      v_request public.pto_requests%rowtype;
      v_member public.pto_members%rowtype;
      v_updated public.pto_requests%rowtype;
    begin
      if p_decision not in ('approved', 'denied') then
        return jsonb_build_object('status', 'invalid_decision');
      end if;

      select * into v_request
      from public.pto_requests
      where id = p_request_id
      for update;
      if not found then return jsonb_build_object('status', 'not_found'); end if;

      if p_decision = 'approved' then
        perform 1
        from public.team_members
        where id = v_request.member_id
          and active is true
        for update;
        if not found then return jsonb_build_object('status', 'member_inactive'); end if;
      end if;
      select * into v_member
      from public.pto_members
      where member_id = v_request.member_id
      for update;
      if not found then return jsonb_build_object('status', 'member_not_found'); end if;
      if v_request.status <> 'pending' then
        return jsonb_build_object('status', 'request_not_pending');
      end if;
      if v_member.state_version <> p_expected_state_version then
        return jsonb_build_object('status', 'stale');
      end if;

      update public.pto_requests
      set status = p_decision,
          decided_by = p_actor,
          decision_note = coalesce(p_decision_note, ''),
          decided_at = now()
      where id = p_request_id
        and status = 'pending'
      returning * into v_updated;

      if not found then return jsonb_build_object('status', 'request_not_pending'); end if;
      return jsonb_build_object('status', 'ok', 'request', to_jsonb(v_updated));
    end;
    $function$

;
CREATE OR REPLACE FUNCTION public.pto_set_member_start_v1(p_member_id uuid, p_start_date date, p_enabled boolean, p_expected_state_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    declare
      v_member public.pto_members%rowtype;
      v_upserted public.pto_members%rowtype;
      v_has_history boolean;
    begin
      perform 1
      from public.team_members
      where id = p_member_id
        and active is true
      for update;
      if not found then return jsonb_build_object('status', 'member_not_found'); end if;

      select * into v_member
      from public.pto_members
      where member_id = p_member_id
      for update;

      if found then
        if p_expected_state_version is null or v_member.state_version <> p_expected_state_version then
          return jsonb_build_object('status', 'stale');
        end if;
      elsif p_expected_state_version is not null then
        return jsonb_build_object('status', 'stale');
      end if;

      select exists (
        select 1 from public.pto_requests where member_id = p_member_id
        union all
        select 1 from public.pto_adjustments where member_id = p_member_id
      ) into v_has_history;

      if v_has_history and (v_member.member_id is null or v_member.pto_start_date <> p_start_date) then
        return jsonb_build_object('status', 'history_conflict');
      end if;

      insert into public.pto_members (
        member_id, pto_start_date, pto_enabled, updated_at
      ) values (
        p_member_id, p_start_date, p_enabled, now()
      )
      on conflict (member_id) do update
      set pto_start_date = excluded.pto_start_date,
          pto_enabled = excluded.pto_enabled,
          updated_at = excluded.updated_at
      returning * into v_upserted;

      return jsonb_build_object('status', 'ok', 'member', to_jsonb(v_upserted));
    end;
    $function$

;
CREATE OR REPLACE FUNCTION public.sample_review_merge_comments(p_client text, p_id text, p_video text DEFAULT NULL::text, p_graphic text DEFAULT NULL::text, p_base text DEFAULT ''::text)
 RETURNS SETOF sample_reviews
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  return query
  update sample_reviews c set
    video_tweaks   = case when p_video   is not null then _sxrmerge_comment_cell(c.video_tweaks,   p_video,   coalesce(p_base,'')) else c.video_tweaks   end,
    graphic_tweaks = case when p_graphic is not null then _sxrmerge_comment_cell(c.graphic_tweaks, p_graphic, coalesce(p_base,'')) else c.graphic_tweaks end,
    updated_at     = to_char((now() at time zone 'utc'), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  where c.client = p_client and c.id = p_id
  returning c.*;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.sample_reviews_stamp_status_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    new.video_status_at   := coalesce(new.video_status_at,   now());
    new.graphic_status_at := coalesce(new.graphic_status_at, now());
  else
    if new.video_status   is distinct from old.video_status   then
      new.video_status_at := now();
    end if;
    if new.graphic_status is distinct from old.graphic_status then
      new.graphic_status_at := now();
    end if;
  end if;
  return new;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.syncview_kasper_urgent_ping_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
declare
  v_comp  text;
  v_actor text;
begin
  begin
    v_comp  := nullif(btrim(coalesce(new.kasper_urgent_comp, '')), '');
    v_actor := nullif(btrim(coalesce(new.kasper_urgent_by, '')), '');

    if tg_table_name = 'calendar_posts' then
      insert into public.calendar_post_events
        (client, post_id, ts, actor, role, action, component, source, payload)
      values (new.client, new.id, now(), v_actor, null,
              'kasper_urgent_ping', v_comp, 'db',
              jsonb_build_object(
                'pinged_at', new.kasper_urgent_pinged_at,
                'status_at', new.kasper_urgent_status_at,
                'via',       'trigger'));
    else
      insert into public.sample_review_events
        (client, sample_id, ts, actor, role, action, component, source, payload)
      values (new.client, new.id, now(), v_actor, null,
              'kasper_urgent_ping', v_comp, 'db',
              jsonb_build_object(
                'pinged_at', new.kasper_urgent_pinged_at,
                'status_at', new.kasper_urgent_status_at,
                'via',       'trigger'));
    end if;
  exception when others then
    -- Best effort, always. A ledger row is never worth a failed client save.
    null;
  end;
  return null;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.workload_native_label_state_absent(p_raw jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select jsonb_typeof(p_raw) is distinct from 'object'
      or jsonb_typeof(p_raw->'issue') is distinct from 'object'
      or (p_raw->'issue')->'labels' is null;
$function$

;
CREATE OR REPLACE FUNCTION public.workload_native_plan_set_v1(p_native_id text, p_client_slug text, p_client text, p_plan_date date, p_actor text, p_provider_client_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_del public.deliverables%rowtype; v_batch public.batches%rowtype;
  v_client public.clients%rowtype; v_keys text[]; v_key text;
  v_plan public.workload_plan%rowtype; v_count integer; v_authority jsonb;
begin
  -- Serialize old-ID and native-ID writes on the same real owner. No new
  -- crosswalk table, rename, delete, migration or provider validation is needed.
  select * into strict v_del from public.deliverables where id=p_native_id for update;
  select * into strict v_batch from public.batches where id=v_del.batch_id for share;
  select * into strict v_client from public.clients where slug=v_del.client_slug for share;
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority' for share;
  if coalesce(v_authority->>v_del.team,'') not in ('syncview','linear') then
    raise exception using errcode='55000',message='workload_authority_unavailable';
  end if;
  if v_authority->>v_del.team='linear' then
    perform 1 from public.workload_issues w where w.id=v_del.linear_issue_uuid
      and w.active is true and w.is_sub_issue is true
      and w.client_name=p_provider_client_name for share;
    if not found then
      raise exception using errcode='55000',message='provider_plan_owner_unavailable';
    end if;
  end if;
  if v_del.client_slug is distinct from p_client_slug or v_client.active is not true
    or v_batch.status='archived' or coalesce(p_client,'') !~ '^[a-z0-9&]+$'
    or coalesce(btrim(p_actor),'')='' or not exists (
      select 1 from public.workload_issues_native_v1 n
       where n.id=p_native_id and n.is_sub_issue and n.active) then
    raise exception using errcode='55000',message='issue_not_writable';
  end if;
  -- A UUID may not be reused by a second native owner, even outside the current
  -- active board. Unproven historic alias ownership must remain a refusal.
  if v_del.linear_issue_uuid is not null and exists (
    select 1 from public.deliverables d where d.id<>v_del.id
      and (d.linear_issue_uuid=v_del.linear_issue_uuid or d.id=v_del.linear_issue_uuid)) then
    raise exception using errcode='55000',message='workload_plan_alias_ambiguous';
  end if;
  v_keys:=array_remove(array[v_del.id,v_del.linear_issue_uuid],null);
  perform 1 from public.workload_plan where issue_id=any(v_keys) for update;
  select count(*) into v_count from public.workload_plan where issue_id=any(v_keys);
  if v_count>1 then
    raise exception using errcode='55000',message='workload_plan_alias_conflict';
  end if;
  select * into v_plan from public.workload_plan where issue_id=any(v_keys);
  if found and v_plan.client<>p_client then
    raise exception using errcode='55000',message='workload_plan_scope_conflict';
  end if;
  v_key:=coalesce(v_plan.issue_id,case when v_authority->>v_del.team='linear'
    then v_del.linear_issue_uuid else v_del.id end);
  insert into public.workload_plan(issue_id,client,plan_date,updated_by,updated_at)
    values(v_key,p_client,p_plan_date,p_actor,clock_timestamp())
    on conflict(issue_id) do update set plan_date=excluded.plan_date,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at
    returning * into v_plan;
  get diagnostics v_count = row_count;
  return jsonb_build_object('ok',true,'updated',v_count,'plan',jsonb_build_object(
    'issue_id',v_del.id,'storage_issue_id',v_plan.issue_id,'client',v_plan.client,
    'plan_date',v_plan.plan_date,'updated_at',v_plan.updated_at));
end;
$function$

;
CREATE OR REPLACE FUNCTION public.workload_native_plan_target_v1(p_issue_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_rows jsonb; v_authority jsonb;
begin
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority';
  if coalesce(v_authority->>'video','') not in ('syncview','linear')
    or coalesce(v_authority->>'graphics','') not in ('syncview','linear') then
    raise exception using errcode='55000',message='workload_authority_unavailable';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'linear_id',n.linear_id,
    'client_slug',n.client_slug,'client_name',n.client_name,'active',n.active,
    'is_sub_issue',n.is_sub_issue,'authority',v_authority->>(case n.team_key when 'VID' then 'video' when 'GRA' then 'graphics' end),
    'provider_client_name',(select w.client_name from public.workload_issues w
      where w.id=n.linear_id and w.active is true and w.is_sub_issue is true))),'[]'::jsonb) into v_rows
    from public.workload_issues_native_v1 n where n.is_sub_issue
      and (n.id=p_issue_id or n.linear_id=p_issue_id);
  if jsonb_array_length(v_rows)>1 then
    raise exception using errcode='55000',message='workload_plan_alias_ambiguous';
  end if;
  return v_rows->0;
end;
$function$

;
CREATE OR REPLACE FUNCTION public.workload_native_snapshot_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_authority jsonb; v_rows jsonb; v_plans jsonb; v_count integer;
begin
  select value into strict v_authority from public.syncview_runtime_flags where key='prod_authority';
  if jsonb_typeof(v_authority) <> 'object'
     or coalesce(v_authority->>'video','') not in ('syncview','linear')
     or coalesce(v_authority->>'graphics','') not in ('syncview','linear') then
    raise exception using errcode='55000', message='workload_authority_unavailable';
  end if;
  -- STABLE RPC: all relations below are read under the same calling snapshot.
  -- A source cap cannot produce complete:true for a partial population.
  with source_rows as (
    select to_jsonb(n) || jsonb_build_object(
      'source','native', 'native_client_active',c.active,
      'native_assignee_eligible',coalesce(tm.active and tm.team=d.team
        and tm.role=case d.team when 'video' then 'editor' when 'graphics' then 'designer' end,false),
      'native_metadata',case when n.is_sub_issue then jsonb_build_object(
        'id',d.id,'client_slug',d.client_slug,'team',d.team,'due_date',d.due_date,
        'updated_at',d.updated_at,
        'workload_labels_complete',case
          when public.workload_native_label_state_absent(d.linear_raw) then true
          else pv.workload_labels_complete end,
        'workload_labels',case
          when public.workload_native_label_state_absent(d.linear_raw) then '[]'::jsonb
          else pv.workload_labels end) else null end) as row
    from public.workload_issues_native_v1 n
      left join public.deliverables d on n.is_sub_issue and d.id=n.id
      left join public.clients c on c.slug=n.client_slug
      left join public.team_members tm on tm.id=d.assignee_id
      left join public.production_deliverables_browser_v1 pv on pv.id=d.id
    where n.active is true and (
      (n.is_sub_issue and v_authority->>d.team='syncview')
      or (not n.is_sub_issue and exists (
        select 1 from public.deliverables child where child.batch_id=n.id
          and v_authority->>child.team='syncview')))
    union all
    select to_jsonb(w) || jsonb_build_object('source','legacy',
        'native_plan_id',n.id,'native_plan_client_name',n.client_name)
      from public.workload_issues w
      left join public.workload_issues_native_v1 n on n.is_sub_issue and n.linear_id=w.id
      where w.active is true and (
        coalesce(w.team_key,'') not in ('VID','GRA')
        or v_authority->>case w.team_key when 'VID' then 'video' when 'GRA' then 'graphics' end='linear')
  ) select coalesce(jsonb_agg(row order by row->>'id'),'[]'::jsonb),count(*)
    into v_rows,v_count from source_rows;
  if v_count>50000 or exists (select 1 from jsonb_array_elements(v_rows) r
    group by r->>'id' having count(*)<>1 or coalesce(r->>'id','')='') then
    raise exception using errcode='55000', message='workload_population_incomplete';
  end if;
  -- Every stored sidecar row is retained, including plans whose work has since
  -- completed. Alias resolution never invents a native owner from a title/name.
  select coalesce(jsonb_agg(jsonb_build_object('issue_id',p.issue_id,'client',p.client,
    'plan_date',p.plan_date,'updated_at',p.updated_at) order by p.issue_id),'[]'::jsonb)
    into v_plans from public.workload_plan p;
  if jsonb_array_length(v_plans)>50000 then
    raise exception using errcode='55000', message='workload_plan_list_limit';
  end if;
  return jsonb_build_object('ok',true,'contract','workload-native-snapshot-v1',
    'complete',true,'count',v_count,'authority',v_authority,'rows',v_rows,'plans',v_plans,
    'legacy_teams',coalesce((select jsonb_agg(distinct r->>'team_key')
      from jsonb_array_elements(v_rows) r where r->>'source'='legacy'),'[]'::jsonb));
end;
$function$

;
