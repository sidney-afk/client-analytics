-- F133: one canonical title across native intake, Calendar/Samples, Production,
-- and the asynchronous Linear mirror.
--
-- This migration does not enable a runtime flag or change authority. A row
-- absent at the pristine pre-DDL boundary is legacy compatibility only; this
-- transaction seeds exact false as the installed, visibly paused posture.
-- Malformed/duplicate/unreadable state fails closed after installation.
-- Browser roles receive no new write capability: the public RPCs are
-- service-role only and expect production-write to authenticate the actor.

begin;

-- Two accepted pre-DDL boundaries, and nothing between them:
--   pristine: no flag/revision contract and the reviewed three-operation
--             parity CHECK;
--   retained: exact OFF flag, retained revision contract, and the reviewed
--             four-operation parity CHECK left by the owner-only inverse.
-- The gate also pins the exact F27/write-UI closures this migration calls.
-- It runs before the first mutation so IF NOT EXISTS can never heal drift.
do $f133_preinstall_gate$
declare
  v_entry text;
  v_flag_count integer;
  v_flag_value jsonb;
  v_column_count integer;
  v_check_count integer;
  v_named_check_count integer;
  v_parity_definition text;
  v_signature text;
  v_expected_hash text;
  v_expected_volatility "char";
  v_expected_return regtype;
  v_function record;
  v_non_owner_acl_count integer;
  v_exact_service_acl_count integer;
  v_owner_acl_delta integer;
begin
  select count(*), min(value::text)::jsonb
    into v_flag_count, v_flag_value
  from public.syncview_runtime_flags
  where key = 'f133_canonical_title_enabled';

  select count(*) into v_column_count
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name in ('calendar_posts', 'sample_reviews')
    and c.column_name = 'title_revision';
  select count(*) into v_check_count
  from pg_constraint c
  where (c.conrelid, c.conname) in (
    ('public.calendar_posts'::regclass, 'calendar_posts_title_revision_nonnegative'),
    ('public.sample_reviews'::regclass, 'sample_reviews_title_revision_nonnegative')
  );
  select count(*) into v_named_check_count
  from pg_constraint c
  where c.conname in (
    'calendar_posts_title_revision_nonnegative',
    'sample_reviews_title_revision_nonnegative'
  );
  select pg_get_constraintdef(c.oid, true) into v_parity_definition
  from pg_constraint c
  where c.conrelid = 'public.mirror_outbox'::regclass
    and c.conname = 'mirror_outbox_legacy_parity_operation_check'
    and c.contype = 'c' and c.convalidated and c.conislocal;

  if v_flag_count = 0
     and v_column_count = 0
     and v_check_count = 0
     and v_named_check_count = 0
     and v_parity_definition =
       'CHECK (legacy_parity = false OR (operation = ANY (ARRAY[''create''::text, ''status''::text, ''comment''::text])))' then
    v_entry := 'pristine';
  elsif v_flag_count = 1
     and v_flag_value = '{"enabled":false}'::jsonb
     and v_column_count = 2
     and v_check_count = 2
     and v_named_check_count = 2
     and not exists (
       select 1
       from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name in ('calendar_posts', 'sample_reviews')
         and c.column_name = 'title_revision'
         and (c.data_type <> 'bigint' or c.is_nullable <> 'NO'
              or c.column_default <> '0')
     )
     and not exists (
       select 1 from pg_constraint c
       where (c.conrelid, c.conname) in (
         ('public.calendar_posts'::regclass, 'calendar_posts_title_revision_nonnegative'),
         ('public.sample_reviews'::regclass, 'sample_reviews_title_revision_nonnegative')
       )
       and (not c.convalidated or not c.conislocal
            or pg_get_constraintdef(c.oid, true) <> 'CHECK (title_revision >= 0)')
     )
     and v_parity_definition =
       'CHECK (legacy_parity = false OR (operation = ANY (ARRAY[''create''::text, ''status''::text, ''comment''::text, ''title''::text])))' then
    v_entry := 'retained_inverse';
  else
    raise exception 'f133_preinstall_entry_state_required';
  end if;

  if exists (
    select 1 from public.mirror_outbox
    where operation = 'title' and status in ('pending', 'failed', 'shadow_ok')
  )
  or exists (
    select 1 from pg_proc p
    where p.proname like 'production_canonical_title_%'
       or p.proname in ('production_intake_commit', 'production_intake_v3_card_contract')
  )
  or exists (
    select 1 from pg_trigger t
    where not t.tgisinternal and t.tgname in (
      'production_deliverable_linear_link_projection_after',
      'production_canonical_title_guard_before',
      'production_canonical_title_deliverable_guard_before',
      'zz_production_canonical_title_cas_before'
    )
  )
  or to_regprocedure(
    'public.production_intake_append_v3(text,timestamp with time zone,jsonb,jsonb)'
  ) is not null
  or to_regprocedure(
    'public.production_issue_create_linkage_pre_f133(text,bigint,jsonb,jsonb)'
  ) is not null then
    raise exception 'f133_preinstall_entry_state_required';
  end if;

  for v_signature, v_expected_hash, v_expected_volatility, v_expected_return in
    select * from (values
      ('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)',
       '84a4cf95e05993649a19030e0df7755b007924b96dfd0fe29ba4ebcb4aeb671a', 'v'::"char", 'bigint'::regtype),
      ('public.track_b_f27_write_authorization(text)',
       'ff6d14af3fedd3b624dbbfa6796c7d598a083267a154936f26673f6267455e4f', 's'::"char", 'jsonb'::regtype),
      ('public.production_assert_authority(text,text,boolean,boolean)',
       '7a21affc44f8d259f581ee29cd2c8b9f60f543ae4de27f70c07e354afbe92247', 'v'::"char", 'void'::regtype),
      ('public.production_intake_append(text,timestamp with time zone,jsonb,jsonb)',
       '028c2c9c57891e37dcecb216173634cc4000a3d5b6d231ec6c96a908ac6d3804', 'v'::"char", 'jsonb'::regtype),
      ('public.production_issue_create_linkage(text,bigint,jsonb,jsonb)',
       '41886f43e77bf4a8acc79dc0b3476f7306ed6304407e8465737ebd1c8f367822', 'v'::"char", 'public.deliverables'::regtype)
    ) expected(signature, source_sha256, volatility, return_type)
  loop
    select p.*, r.rolname as owner_name
      into v_function
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    join pg_language l on l.oid = p.prolang
    where p.oid = to_regprocedure(v_signature)
      and l.lanname = 'plpgsql';
    if not found
       or not v_function.prosecdef
       or v_function.provolatile <> v_expected_volatility
       or v_function.prorettype <> v_expected_return
       or v_function.prokind <> 'f'
       or v_function.proisstrict or v_function.proleakproof
       or v_function.proparallel <> 'u'
       or v_function.proconfig is distinct from array['search_path=public']::text[]
       or encode(digest(convert_to(
            replace(v_function.prosrc, chr(13) || chr(10), chr(10)), 'UTF8'
          ), 'sha256'), 'hex') <> v_expected_hash then
      raise exception 'f133_preinstall_dependency_drift:%', v_signature;
    end if;
    select count(*), count(*) filter (
      where x.grantee = 'service_role'::regrole
        and x.privilege_type = 'EXECUTE' and not x.is_grantable
    ) into v_non_owner_acl_count, v_exact_service_acl_count
    from aclexplode(coalesce(
      v_function.proacl, acldefault('f', v_function.proowner)
    )) x
    where x.grantee <> v_function.proowner;
    select count(*) into v_owner_acl_delta
    from (
      (select x.grantee, x.privilege_type, x.is_grantable
       from aclexplode(coalesce(
         v_function.proacl, acldefault('f', v_function.proowner)
       )) x where x.grantee = v_function.proowner
       except
       select x.grantee, x.privilege_type, x.is_grantable
       from aclexplode(acldefault('f', v_function.proowner)) x
       where x.grantee = v_function.proowner)
      union all
      (select x.grantee, x.privilege_type, x.is_grantable
       from aclexplode(acldefault('f', v_function.proowner)) x
       where x.grantee = v_function.proowner
       except
       select x.grantee, x.privilege_type, x.is_grantable
       from aclexplode(coalesce(
         v_function.proacl, acldefault('f', v_function.proowner)
       )) x where x.grantee = v_function.proowner)
    ) delta;
    if v_non_owner_acl_count <> 1 or v_exact_service_acl_count <> 1
       or v_owner_acl_delta <> 0 then
      raise exception 'f133_preinstall_dependency_acl_drift:%', v_signature;
    end if;
  end loop;
end;
$f133_preinstall_gate$;

insert into public.syncview_runtime_flags (key, value, updated_by)
values (
  'f133_canonical_title_enabled',
  '{"enabled":false}'::jsonb,
  'f133-canonical-title-migration'
)
on conflict (key) do nothing;

do $f133_flag_pause_gate$
begin
  if (select count(*) from public.syncview_runtime_flags
      where key = 'f133_canonical_title_enabled') <> 1
     or not exists (
       select 1 from public.syncview_runtime_flags
       where key = 'f133_canonical_title_enabled'
         and value = '{"enabled":false}'::jsonb
     ) then
    raise exception 'f133_install_pause_flag_required';
  end if;
end;
$f133_flag_pause_gate$;

-- The visible title value is not a sufficient CAS cursor: A -> B -> A would
-- otherwise let a delayed tab that still holds A overwrite the newer state.
-- Keep a monotone, card-local revision in both native card stores.  These
-- additive columns and their checks are retained by the owner-only inverse so
-- audit history and stale-browser rejection survive a behavioral rollback.
alter table public.calendar_posts
  add column if not exists title_revision bigint not null default 0;
alter table public.sample_reviews
  add column if not exists title_revision bigint not null default 0;

do $title_revision_contract$
declare
  v_calendar_definition text;
  v_samples_definition text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.calendar_posts'::regclass
      and conname = 'calendar_posts_title_revision_nonnegative'
  ) then
    alter table public.calendar_posts
      add constraint calendar_posts_title_revision_nonnegative
      check (title_revision >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sample_reviews'::regclass
      and conname = 'sample_reviews_title_revision_nonnegative'
  ) then
    alter table public.sample_reviews
      add constraint sample_reviews_title_revision_nonnegative
      check (title_revision >= 0);
  end if;

  select pg_get_constraintdef(oid, true) into v_calendar_definition
  from pg_constraint
  where conrelid = 'public.calendar_posts'::regclass
    and conname = 'calendar_posts_title_revision_nonnegative';
  select pg_get_constraintdef(oid, true) into v_samples_definition
  from pg_constraint
  where conrelid = 'public.sample_reviews'::regclass
    and conname = 'sample_reviews_title_revision_nonnegative';
  if v_calendar_definition is distinct from 'CHECK (title_revision >= 0)'
     or v_samples_definition is distinct from 'CHECK (title_revision >= 0)'
     or exists (
       select 1
       from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name in ('calendar_posts', 'sample_reviews')
         and c.column_name = 'title_revision'
         and (
           c.data_type is distinct from 'bigint'
           or c.is_nullable is distinct from 'NO'
           or c.column_default is distinct from '0'
         )
     ) then
    raise exception 'f133_title_revision_contract_drift';
  end if;
end;
$title_revision_contract$;

-- A title written while a team is still Linear-authoritative is a reviewed
-- native-first parity mutation, just like create/status/comment. The durable
-- row remains fenced by F27's generation and parity binders.
alter table public.mirror_outbox
  drop constraint if exists mirror_outbox_legacy_parity_operation_check;
alter table public.mirror_outbox
  add constraint mirror_outbox_legacy_parity_operation_check
  check (
    legacy_parity = false
    or operation in ('create', 'status', 'comment', 'title')
  );

-- A browser that committed a version-3 intake before this migration may still
-- owe the frozen calendar-upsert materialisation.  Prove that compatibility
-- row entirely from its durable native create receipts.  This is deliberately
-- independent of the activation flag: an already-recorded v3 receipt remains
-- recoverable after activation, while a v4 receipt (which carries the numeric
-- marker) can never enter this contract.
create or replace function public.production_intake_v3_card_contract(
  p_client text,
  p_card_id text,
  p_request_id text,
  p_actor_key text,
  p_candidate jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_client text := nullif(btrim(coalesce(p_client, '')), '');
  v_card_id text := nullif(btrim(coalesce(p_card_id, '')), '');
  v_request_filter text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_actor_filter text := nullif(btrim(coalesce(p_actor_key, '')), '');
  v_card_match text[];
  v_number integer;
  v_item public.deliverables%rowtype;
  v_outbox public.mirror_outbox%rowtype;
  v_event public.deliverable_events%rowtype;
  v_batch public.batches%rowtype;
  v_outbound jsonb;
  v_payload jsonb;
  v_prefix text;
  v_request_id text;
  v_safe_request text;
  v_title text;
  v_batch_id text;
  v_actor_key text;
  v_source_at timestamptz;
  v_receipt_created_at timestamptz;
  v_sort_key numeric;
  v_video_id text;
  v_graphic_id text;
  v_video_url text := '';
  v_graphic_url text := '';
  v_count integer := 0;
  v_exact_count integer;
  v_candidate_at timestamptz;
  v_parent_ids text[];
begin
  v_card_match := regexp_match(coalesce(v_card_id, ''),
    '^p_native_([a-z0-9]{1,28})_([1-9][0-9]*)$');
  if v_client is null or v_card_match is null then
    return jsonb_build_object('ok', false);
  end if;
  begin
    v_number := v_card_match[2]::integer;
  exception when others then
    return jsonb_build_object('ok', false);
  end;
  v_title := 'Video ' || v_number::text;

  for v_item in
    select d.*
    from public.deliverables d
    where d.client_slug = v_client
      and d.origin = 'calendar'
      and d.card_id = v_card_id
    order by d.team, d.id
  loop
    v_count := v_count + 1;
    if v_count > 2
       or v_item.team not in ('video', 'graphics')
       or v_item.kind is distinct from (
         case when v_item.team = 'graphics' then 'thumbnail' else 'video' end
       )
       or v_item.title is distinct from v_title
       or v_item.batch_id is null
       or v_item.created_by is null
       or v_item.sort_key is null
       or v_item.sort_key < 0
       or trunc(v_item.sort_key) is distinct from v_item.sort_key then
      return jsonb_build_object('ok', false);
    end if;
    if v_batch_id is null then
      v_batch_id := v_item.batch_id;
      v_actor_key := v_item.created_by;
      v_sort_key := v_item.sort_key;
      select b.* into v_batch from public.batches b where b.id = v_batch_id;
      if not found
         or v_batch.client_slug is distinct from v_client
         or v_batch.created_by is distinct from v_actor_key then
        return jsonb_build_object('ok', false);
      end if;
    elsif v_item.batch_id is distinct from v_batch_id
       or v_item.created_by is distinct from v_actor_key
       or v_item.sort_key is distinct from v_sort_key then
      return jsonb_build_object('ok', false);
    end if;
    if v_actor_filter is not null and v_item.created_by is distinct from v_actor_filter then
      return jsonb_build_object('ok', false);
    end if;

    select count(*)::integer into v_exact_count
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_item.id
      and o.operation = 'create';
    if v_exact_count <> 1 then return jsonb_build_object('ok', false); end if;
    select o.* into v_outbox
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_item.id
      and o.operation = 'create';
    v_prefix := 'write-ui:create:deliverable:' || v_item.id || ':';
    if left(v_outbox.dedup_key, length(v_prefix)) is distinct from v_prefix
       or length(v_outbox.dedup_key) <= length(v_prefix) then
      return jsonb_build_object('ok', false);
    end if;
    if v_request_id is null then
      v_request_id := substring(v_outbox.dedup_key from length(v_prefix) + 1);
    elsif substring(v_outbox.dedup_key from length(v_prefix) + 1)
       is distinct from v_request_id then
      return jsonb_build_object('ok', false);
    end if;
    v_safe_request := right(regexp_replace(lower(v_request_id), '[^a-z0-9]+', '', 'g'), 28);
    if v_request_id !~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$'
       or v_safe_request = ''
       or v_card_match[1] is distinct from v_safe_request
       or (v_request_filter is not null and v_request_id is distinct from v_request_filter)
       or v_outbox.deliverable_id is distinct from v_item.id
       or v_outbox.op is distinct from 'create'
       or v_outbox.batch_id is distinct from v_item.batch_id
       or v_outbox.comment_id is not null
       or v_outbox.client_slug is distinct from v_item.client_slug
       or v_outbox.team is distinct from v_item.team
       or v_outbox.status not in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale')
       or v_outbox.actor is null
       or v_outbox.role is null
       or v_outbox.authority_generation < 0
       or jsonb_typeof(v_outbox.payload) is distinct from 'object'
       or v_outbox.payload ? '_intake_version'
       or v_outbox.payload->>'title' is distinct from v_item.title
       or nullif(btrim(v_outbox.payload->>'_intent_fingerprint'), '') is null
       or v_item.created_at is distinct from v_outbox.source_edited_at then
      return jsonb_build_object('ok', false);
    end if;
    if v_source_at is null then
      v_source_at := v_outbox.source_edited_at;
    elsif v_outbox.source_edited_at is distinct from v_source_at then
      return jsonb_build_object('ok', false);
    end if;
    if v_receipt_created_at is null
       or v_outbox.created_at > v_receipt_created_at then
      v_receipt_created_at := v_outbox.created_at;
    end if;

    select count(*)::integer into v_exact_count
    from public.deliverable_events e
    where e.deliverable_id = v_item.id and e.action = 'create';
    if v_exact_count <> 1 then return jsonb_build_object('ok', false); end if;
    select e.* into v_event
    from public.deliverable_events e
    where e.deliverable_id = v_item.id and e.action = 'create';
    v_outbound := coalesce(v_event.payload->'outbound', '{}'::jsonb);
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
    if v_event.batch_id is distinct from v_item.batch_id
       or v_event.client_slug is distinct from v_item.client_slug
       or v_event.ts is distinct from v_outbox.source_edited_at
       or v_event.actor is distinct from v_outbox.actor
       or v_event.role is distinct from v_outbox.role
       or v_event.source is distinct from 'ui'
       or v_event.from_status is not null
       or v_event.to_status is distinct from v_item.status
       or v_event.event_key is not null
       or jsonb_typeof(v_event.payload) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_event.payload) key
         where key not in (
           'source', 'action', 'actor', 'actor_key', 'role', 'auth_kind',
           'surface', 'ts', 'from_status', 'to_status', 'outbound'
         )
       )
       or v_event.payload->>'source' is distinct from 'ui'
       or v_event.payload->>'action' is distinct from 'create'
       or v_event.payload->>'actor' is distinct from v_event.actor
       or v_event.payload->>'actor_key' is distinct from v_item.created_by
       or v_event.payload->>'role' is distinct from v_event.role
       or v_event.payload->>'auth_kind' is distinct from 'staff'
       or v_event.payload->>'surface' not in ('calendar', 'submission')
       or (v_event.payload->>'ts')::timestamptz is distinct from v_event.ts
       or v_event.payload->'from_status' <> 'null'::jsonb
       or v_event.payload->>'to_status' is distinct from v_item.status
       or jsonb_typeof(v_outbound) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_outbound) key
         where key not in (
           'entity', 'entity_id', 'team', 'operation', 'dedup_key',
           'source_edited_at', 'test_only', 'legacy_parity', 'depends_on_id',
           'payload'
         )
       )
       or v_outbound->>'entity' is distinct from 'deliverable'
       or v_outbound->>'entity_id' is distinct from v_item.id
       or v_outbound->>'team' is distinct from v_item.team
       or v_outbound->>'operation' is distinct from 'create'
       or v_outbound->>'dedup_key' is distinct from v_outbox.dedup_key
       or (v_outbound->>'source_edited_at')::timestamptz is distinct from v_outbox.source_edited_at
       or (v_outbound->>'test_only')::boolean is distinct from v_outbox.test_only
       or (v_outbound->>'legacy_parity')::boolean is distinct from v_outbox.legacy_parity
       or (v_outbox.depends_on_id is null
         and nullif(btrim(v_outbound->>'depends_on_id'), '') is not null)
       or (v_outbox.depends_on_id is not null and (
         coalesce(v_outbound->>'depends_on_id', '') !~ '^[1-9][0-9]*$'
         or (v_outbound->>'depends_on_id')::bigint is distinct from v_outbox.depends_on_id
       ))
       or jsonb_typeof(v_payload) is distinct from 'object'
       or v_payload ? '_intake_version'
       or v_payload->>'_f27_authority_generation' !~ '^[0-9]+$'
       or (v_payload->>'_f27_authority_generation')::bigint
          is distinct from v_outbox.authority_generation
       or jsonb_typeof(v_payload->'_f27_legacy_parity') is distinct from 'boolean'
       or (v_payload->>'_f27_legacy_parity')::boolean
          is distinct from v_outbox.legacy_parity
       or (v_payload - '_f27_authority_generation' - '_f27_legacy_parity')
          is distinct from v_outbox.payload then
      return jsonb_build_object('ok', false);
    end if;
    if v_outbox.depends_on_id is null then
      if nullif(btrim(v_outbox.payload->>'parent_linear_issue_id'), '') is null then
        return jsonb_build_object('ok', false);
      end if;
      if v_item.team = 'video' then
        v_parent_ids := array_remove(array[
          nullif(btrim(v_batch.linear_parent_ids->>'video'), ''),
          nullif(btrim(v_batch.linear_parent_ids->>'vid'), '')
        ], null);
      else
        v_parent_ids := array_remove(array[
          nullif(btrim(v_batch.linear_parent_ids->>'graphics'), ''),
          nullif(btrim(v_batch.linear_parent_ids->>'graphic'), ''),
          nullif(btrim(v_batch.linear_parent_ids->>'gra'), '')
        ], null);
      end if;
      if cardinality(array(select distinct x from unnest(v_parent_ids) x)) <> 1
         or v_outbox.payload->>'parent_linear_issue_id'
            is distinct from (array(select distinct x from unnest(v_parent_ids) x))[1] then
        return jsonb_build_object('ok', false);
      end if;
    elsif not exists (
      select 1 from public.mirror_outbox parent
      where parent.id = v_outbox.depends_on_id
        and parent.entity = 'batch'
        and parent.entity_id = v_item.batch_id
        and parent.operation = 'create'
        and parent.client_slug = v_item.client_slug
        and parent.team = v_item.team
        and parent.dedup_key = 'write-ui:create:batch:' || v_item.batch_id
          || ':' || v_request_id || ':' || v_item.team
        and parent.test_only is not distinct from v_outbox.test_only
        and parent.legacy_parity is not distinct from v_outbox.legacy_parity
        and parent.authority_generation is not distinct from v_outbox.authority_generation
        and parent.status in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale')
    ) then
      return jsonb_build_object('ok', false);
    end if;
    if exists (
      select 1 from public.mirror_outbox title_row
      where title_row.entity = 'deliverable'
        and title_row.entity_id = v_item.id
        and title_row.operation = 'title'
    ) or exists (
      select 1 from public.deliverable_events title_event
      where title_event.deliverable_id = v_item.id
        and title_event.action = 'title_change'
    ) then
      return jsonb_build_object('ok', false);
    end if;
    if v_item.team = 'video' then
      if v_video_id is not null then return jsonb_build_object('ok', false); end if;
      v_video_id := v_item.id;
      v_video_url := coalesce(v_item.linear_issue_url, '');
    else
      if v_graphic_id is not null then return jsonb_build_object('ok', false); end if;
      v_graphic_id := v_item.id;
      v_graphic_url := coalesce(v_item.linear_issue_url, '');
    end if;
  end loop;
  if v_count < 1 then return jsonb_build_object('ok', false); end if;

  select b.* into v_batch from public.batches b where b.id = v_batch_id;
  if not found
     or v_batch.client_slug is distinct from v_client
     or v_batch.created_by is distinct from v_actor_key
     or (v_batch.team is not null and v_count <> 1)
     or (v_batch.team is not null and v_batch.team is distinct from (
       case when v_video_id is not null then 'video' else 'graphics' end
     )) then
    return jsonb_build_object('ok', false);
  end if;

  if p_candidate is not null then
    begin
      v_candidate_at := nullif(btrim(p_candidate->>'updated_at'), '')::timestamptz;
    exception when others then
      return jsonb_build_object('ok', false);
    end;
    if p_candidate->>'client' is distinct from v_client
       or p_candidate->>'id' is distinct from v_card_id
       or p_candidate->>'name' is distinct from v_title
       or coalesce(p_candidate->>'title_revision', '') is distinct from '0'
       or coalesce(p_candidate->>'video_deliverable_id', '')
          is distinct from coalesce(v_video_id, '')
       or coalesce(p_candidate->>'graphic_deliverable_id', '')
          is distinct from coalesce(v_graphic_id, '')
       or coalesce(p_candidate->>'linear_issue_id', '') is distinct from v_video_url
       or coalesce(p_candidate->>'graphic_linear_issue_id', '') is distinct from v_graphic_url
       or p_candidate->>'scheduled_date' is distinct from ''
       or p_candidate->>'status' is distinct from 'In Progress'
       or p_candidate->>'video_status' is distinct from 'In Progress'
       or p_candidate->>'graphic_status' is distinct from 'In Progress'
       or p_candidate->>'caption_status' is distinct from 'In Progress'
       or coalesce(p_candidate->>'asset_url', '') <> ''
       or coalesce(p_candidate->>'thumbnail_url', '') <> ''
       or coalesce(p_candidate->>'caption', '') <> ''
       or coalesce(p_candidate->>'cta', '') <> ''
       or coalesce(p_candidate->>'tweaks', '') <> ''
       or coalesce(p_candidate->>'video_tweaks', '') <> ''
       or coalesce(p_candidate->>'graphic_tweaks', '') <> ''
       or coalesce(p_candidate->>'caption_tweaks', '') <> ''
       or coalesce(p_candidate->>'order_index', '') !~ '^[0-9]+([.][0-9]+)?$'
       or (p_candidate->>'order_index')::numeric < 0
       or (p_candidate->>'order_index')::numeric > 1000000000000000
       or v_candidate_at < v_receipt_created_at
       or v_candidate_at > statement_timestamp() + interval '5 minutes'
       or exists (
         select 1
         from jsonb_each(p_candidate - array[
           'client', 'id', 'updated_at', 'order_index', 'scheduled_date', 'name',
           'title_revision',
           'status', 'video_status', 'graphic_status', 'caption_status',
           'asset_url', 'thumbnail_url', 'caption', 'cta', 'tweaks',
           'video_tweaks', 'graphic_tweaks', 'caption_tweaks',
           'linear_issue_id', 'graphic_linear_issue_id',
           'video_deliverable_id', 'graphic_deliverable_id'
         ]::text[]) extra
         where extra.value <> 'null'::jsonb and extra.value <> '""'::jsonb
       ) then
      return jsonb_build_object('ok', false);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'actor_key', v_actor_key,
    'client', v_client,
    'card_id', v_card_id,
    'batch_id', v_batch_id,
    'title', v_title,
    'title_revision', 0,
    'source_edited_at', v_source_at,
    'receipt_created_at', v_receipt_created_at,
    'video_deliverable_id', v_video_id,
    'graphic_deliverable_id', v_graphic_id,
    'linear_issue_id', v_video_url,
    'graphic_linear_issue_id', v_graphic_url,
    'item_count', v_count
  );
exception when others then
  return jsonb_build_object('ok', false);
end;
$fn$;

revoke all on function public.production_intake_v3_card_contract(
  text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

-- Frozen whole-card writers may continue saving unrelated fields and may
-- repeat the current name. They may not create a linked card except for the
-- exact provenance-bound v3 compatibility row above, or change a linked
-- card's name. Only the reviewed intake/title RPCs set this local,
-- transaction-scoped marker.
create or replace function public.production_canonical_title_card_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if current_setting('app.f133_canonical_title_write', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.video_deliverable_id is not null
       or new.graphic_deliverable_id is not null then
      if coalesce((public.production_intake_v3_card_contract(
        new.client, new.id, null, null, to_jsonb(new)
      )->>'ok')::boolean, false) is not true then
        raise exception 'f133_linked_card_insert_requires_canonical_rpc:%', tg_table_name;
      end if;
    end if;
    return new;
  end if;

  if (new.name is distinct from old.name
      or new.title_revision is distinct from old.title_revision)
     and (
       old.video_deliverable_id is not null
       or old.graphic_deliverable_id is not null
       or new.video_deliverable_id is not null
       or new.graphic_deliverable_id is not null
     ) then
    raise exception 'f133_linked_card_title_requires_canonical_rpc:%', tg_table_name;
  end if;
  if new.video_deliverable_id is distinct from old.video_deliverable_id
     or new.graphic_deliverable_id is distinct from old.graphic_deliverable_id then
    raise exception 'f133_linked_card_linkage_requires_canonical_rpc:%', tg_table_name;
  end if;
  return new;
end;
$fn$;

revoke all on function public.production_canonical_title_card_guard()
  from public, anon, authenticated;

drop trigger if exists production_canonical_title_guard_before
  on public.calendar_posts;
create trigger production_canonical_title_guard_before
  before insert or update of name, title_revision,
    video_deliverable_id, graphic_deliverable_id
  on public.calendar_posts
  for each row execute function public.production_canonical_title_card_guard();

-- Every title intent is a strict per-deliverable chain. The first title may
-- depend on the exact native create while provider identity is absent; every
-- later title depends on the immediately preceding title row. This predicate
-- is used for replay/readback and rejects gaps, forks, or foreign binders.
create or replace function public.production_canonical_title_dependency_valid(
  p_outbox_id bigint
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_row public.mirror_outbox%rowtype;
  v_dependency public.mirror_outbox%rowtype;
begin
  select o.* into v_row from public.mirror_outbox o where o.id = p_outbox_id;
  if not found
     or v_row.entity is distinct from 'deliverable'
     or v_row.operation is distinct from 'title'
     or v_row.deliverable_id is distinct from v_row.entity_id
     or v_row.comment_id is not null then
    return false;
  end if;
  if v_row.depends_on_id is null then
    return not exists (
      select 1 from public.mirror_outbox prior
      where prior.entity = 'deliverable'
        and prior.entity_id = v_row.entity_id
        and prior.operation = 'title'
        and prior.id < v_row.id
    ) and exists (
      select 1 from public.deliverables d
      where d.id = v_row.entity_id
        and nullif(btrim(coalesce(
          d.linear_issue_uuid, d.linear_raw->'issue'->>'id', ''
        )), '') is not null
    );
  end if;

  select o.* into v_dependency
  from public.mirror_outbox o where o.id = v_row.depends_on_id;
  if not found or v_dependency.id >= v_row.id then return false; end if;
  if v_dependency.operation = 'title' then
    return v_dependency.entity = 'deliverable'
      and v_dependency.entity_id = v_row.entity_id
      and v_dependency.deliverable_id = v_row.deliverable_id
      and v_dependency.batch_id = v_row.batch_id
      and v_dependency.comment_id is null
      and v_dependency.client_slug = v_row.client_slug
      and v_dependency.team = v_row.team
      and v_dependency.status in (
        'pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale'
      )
      and not exists (
        select 1 from public.mirror_outbox between_row
        where between_row.entity = 'deliverable'
          and between_row.entity_id = v_row.entity_id
          and between_row.operation = 'title'
          and between_row.id > v_dependency.id
          and between_row.id < v_row.id
      );
  end if;
  return v_dependency.entity = 'deliverable'
    and v_dependency.entity_id = v_row.entity_id
    and v_dependency.deliverable_id = v_row.deliverable_id
    and v_dependency.batch_id = v_row.batch_id
    and v_dependency.comment_id is null
    and v_dependency.operation = 'create'
    and v_dependency.op = 'create'
    and v_dependency.client_slug = v_row.client_slug
    and v_dependency.team = v_row.team
    and v_dependency.test_only is not distinct from v_row.test_only
    and v_dependency.legacy_parity is not distinct from v_row.legacy_parity
    and v_dependency.authority_generation is not distinct from v_row.authority_generation
    and v_dependency.status in (
      'pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale'
    )
    and not exists (
      select 1 from public.mirror_outbox prior
      where prior.entity = 'deliverable'
        and prior.entity_id = v_row.entity_id
        and prior.operation = 'title'
        and prior.id < v_row.id
    );
end;
$fn$;

revoke all on function public.production_canonical_title_dependency_valid(bigint)
  from public, anon, authenticated;
grant execute on function public.production_canonical_title_dependency_valid(bigint)
  to service_role;

-- Resolve a title row's complete predecessor chain inside one database call.
-- The Edge drainer must not perform two provider-facing REST reads for every
-- historical edit: long-lived cards can legitimately have hundreds of title
-- revisions. Strictly decreasing ids make this walk finite without an
-- arbitrary lifetime cap. Every edge and fork is still proven before a narrow
-- terminal/waiting receipt is returned.
create or replace function public.production_canonical_title_dependency_resolve(
  p_outbox_id bigint
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_row public.mirror_outbox%rowtype;
  v_child public.mirror_outbox%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_native public.deliverables%rowtype;
  v_result jsonb;
  v_receipt jsonb;
  v_expected_input jsonb;
  v_payload jsonb;
  v_conflict jsonb;
  v_successor_count integer;
  v_successor_id bigint;
  v_create_count integer;
  v_issue_id text;
  v_create_title text;
  v_provider_updated_at text;
  v_provider_updated_ts timestamptz;
  v_bound_issue_id text;
  v_bound_title_clock text;
  v_bound_title_clock_ts timestamptz;
  v_ack_issue_ids text[] := array[]::text[];
  v_root_kind text;
  v_acknowledged boolean;
begin
  select o.* into v_row
  from public.mirror_outbox o
  where o.id = p_outbox_id;
  if not found
     or v_row.entity is distinct from 'deliverable'
     or v_row.operation is distinct from 'title'
     or v_row.op is distinct from 'update_fields'
     or v_row.deliverable_id is distinct from v_row.entity_id
     or v_row.comment_id is not null
     or v_row.depends_on_id is null
     or nullif(btrim(v_row.payload->>'title'), '') is null then
    raise exception 'canonical_title_dependency_resolve_invalid_row';
  end if;
  select d.* into v_native
  from public.deliverables d
  where d.id = v_row.entity_id;
  if not found
     or v_native.id is distinct from v_row.deliverable_id
     or v_native.batch_id is distinct from v_row.batch_id
     or v_native.client_slug is distinct from v_row.client_slug
     or v_native.team is distinct from v_row.team
     or v_native.origin not in ('calendar', 'samples')
     or nullif(btrim(v_native.card_id), '') is null then
    raise exception 'canonical_title_dependency_resolve_native_scope_invalid';
  end if;
  v_bound_issue_id := nullif(btrim(coalesce(
    v_native.linear_issue_uuid,
    v_native.linear_raw->'issue'->>'id',
    ''
  )), '');
  v_bound_title_clock := nullif(btrim(
    coalesce(v_native.linear_raw->'field_updated_at'->>'title', '')
  ), '');

  v_child := v_row;
  loop
    select o.* into v_dependency
    from public.mirror_outbox o
    where o.id = v_child.depends_on_id;
    if not found
       or v_dependency.id >= v_child.id
       or v_child.depends_on_id is distinct from v_dependency.id
       or v_dependency.entity is distinct from 'deliverable'
       or v_dependency.entity_id is distinct from v_row.entity_id
       or v_dependency.deliverable_id is distinct from v_row.deliverable_id
       or v_dependency.batch_id is distinct from v_row.batch_id
       or v_dependency.comment_id is not null
       or v_dependency.client_slug is distinct from v_row.client_slug
       or v_dependency.team is distinct from v_row.team then
      raise exception 'canonical_title_dependency_resolve_chain_invalid';
    end if;

    select count(*)::integer, min(successor.id)
      into v_successor_count, v_successor_id
    from public.mirror_outbox successor
    where successor.entity = 'deliverable'
      and successor.entity_id = v_row.entity_id
      and successor.operation = 'title'
      and successor.depends_on_id = v_dependency.id;
    if v_successor_count <> 1 or v_successor_id is distinct from v_child.id then
      raise exception 'canonical_title_dependency_resolve_fork_invalid';
    end if;

    if v_dependency.operation = 'title' then
      if v_dependency.op is distinct from 'update_fields'
         or nullif(btrim(v_dependency.payload->>'title'), '') is null
         or exists (
           select 1 from public.mirror_outbox between_row
           where between_row.entity = 'deliverable'
             and between_row.entity_id = v_row.entity_id
             and between_row.operation = 'title'
             and between_row.id > v_dependency.id
             and between_row.id < v_child.id
         ) then
        raise exception 'canonical_title_dependency_resolve_chain_invalid';
      end if;

      v_receipt := coalesce(v_dependency.linear_result, '{}'::jsonb);
      v_expected_input := coalesce(v_receipt->'expected'->'input', '{}'::jsonb);
      v_acknowledged := v_dependency.status in ('written', 'skipped')
        and v_receipt->>'mutation' = 'issueUpdate'
        and nullif(btrim(v_receipt->>'issue_id'), '') is not null
        and nullif(btrim(v_receipt->>'updated_at'), '') is not null
        and v_expected_input->>'title' is not distinct from v_dependency.payload->>'title'
        and nullif(btrim(v_receipt->>'mirror_actor_id'), '') is not null;
      if v_acknowledged then
        v_ack_issue_ids := array_append(
          v_ack_issue_ids, nullif(btrim(v_receipt->>'issue_id'), '')
        );
      end if;
      if v_result is null then
        if v_dependency.status not in ('written', 'skipped', 'stale', 'shadow_ok') then
          v_result := jsonb_build_object(
            'kind', 'waiting',
            'dependency_outbox_id', v_dependency.id,
            'dependency_status', v_dependency.status
          );
        elsif v_acknowledged then
          v_result := jsonb_build_object(
            'kind', 'terminal_title',
            'dependency_outbox_id', v_dependency.id,
            'dependency_status', v_dependency.status
          );
        end if;
      end if;

      if v_dependency.depends_on_id is null then
        begin
          v_bound_title_clock_ts := v_bound_title_clock::timestamptz;
        exception when others then
          raise exception 'canonical_title_dependency_resolve_existing_binder_invalid';
        end;
        if v_bound_issue_id is null
           or v_bound_title_clock_ts is null
           or exists (
             select 1 from public.mirror_outbox prior
             where prior.entity = 'deliverable'
               and prior.entity_id = v_row.entity_id
               and prior.operation = 'title'
               and prior.id < v_dependency.id
           )
           or exists (
             select 1 from unnest(v_ack_issue_ids) acknowledged(issue_id)
             where acknowledged.issue_id is distinct from v_bound_issue_id
           ) then
          raise exception 'canonical_title_dependency_resolve_existing_binder_invalid';
        end if;
        v_root_kind := 'bound_existing_issue_root';
        if v_result is null then
          v_result := jsonb_build_object(
            'kind', 'bound_existing_issue_root',
            'dependency_outbox_id', v_dependency.id,
            'dependency_status', v_dependency.status,
            'bound_issue_id', v_bound_issue_id
          );
        end if;
        exit;
      end if;
      v_child := v_dependency;
      continue;
    end if;

    if v_dependency.operation is distinct from 'create'
       or v_dependency.op is distinct from 'create'
       or v_dependency.test_only is distinct from v_child.test_only
       or v_dependency.legacy_parity is distinct from v_child.legacy_parity
       or v_dependency.authority_generation is distinct from v_child.authority_generation
       or nullif(btrim(v_dependency.payload->>'title'), '') is null
       or nullif(btrim(v_dependency.payload->>'_intent_fingerprint'), '') is null then
      raise exception 'canonical_title_dependency_resolve_create_invalid';
    end if;
    select count(*)::integer into v_create_count
    from public.mirror_outbox exact_create
    where exact_create.entity = 'deliverable'
      and exact_create.entity_id = v_row.entity_id
      and exact_create.operation = 'create';
    if v_create_count <> 1 then
      raise exception 'canonical_title_dependency_resolve_create_invalid';
    end if;

    v_receipt := coalesce(v_dependency.linear_result, '{}'::jsonb);
    v_conflict := coalesce(v_receipt->'conflict', '{}'::jsonb);
    v_root_kind := 'create_root';
    if v_dependency.status = 'written' then
      -- Validate the create acknowledgement even when a nearer title row has
      -- already selected the waiting/terminal return receipt. The root still
      -- binds the complete chain to one native/provider issue identity.
      v_expected_input := coalesce(v_receipt->'expected'->'input', '{}'::jsonb);
      v_issue_id := nullif(btrim(v_receipt->>'issue_id'), '');
      v_create_title := nullif(btrim(v_expected_input->>'title'), '');
      v_provider_updated_at := nullif(btrim(v_receipt->>'updated_at'), '');
      begin
        v_provider_updated_ts := v_provider_updated_at::timestamptz;
      exception when others then
        raise exception 'canonical_title_dependency_resolve_create_ack_invalid';
      end;
      if v_receipt->>'mutation' is distinct from 'issueCreate'
         or nullif(btrim(v_receipt->>'mirror_actor_id'), '') is null
         or v_issue_id is null
         or v_expected_input->>'id' is distinct from v_issue_id
         or v_create_title is null
         or v_dependency.payload->>'title' is distinct from v_create_title
         or v_provider_updated_ts is null
         or v_dependency.source_edited_at >= v_child.source_edited_at then
        raise exception 'canonical_title_dependency_resolve_create_ack_invalid';
      end if;
      if (v_bound_issue_id is not null and v_bound_issue_id is distinct from v_issue_id)
         or exists (
           select 1 from unnest(v_ack_issue_ids) acknowledged(issue_id)
           where acknowledged.issue_id is distinct from v_issue_id
         ) then
        raise exception 'canonical_title_dependency_resolve_create_ack_invalid';
      end if;
      if v_result is null then
        v_result := jsonb_build_object(
          'kind', 'create_root',
          'dependency_outbox_id', v_dependency.id,
          'dependency_status', 'written',
          'title_create_root_receipt', jsonb_build_object(
            'outbox_id', v_dependency.id,
            'issue_id', v_issue_id,
            'title', v_create_title,
            'source_edited_at', v_dependency.source_edited_at,
            'provider_updated_at', v_provider_updated_at
          )
        );
      end if;
    elsif v_result is null
       and v_dependency.status = 'skipped'
       and v_conflict->>'decision' = 'idempotency_conflict' then
      v_result := jsonb_build_object(
        'kind', 'terminal_create_conflict',
        'dependency_outbox_id', v_dependency.id,
        'dependency_entity_id', v_dependency.entity_id,
        'dependency_status', v_dependency.status,
        'conflict', v_conflict
      );
    elsif v_result is null then
      v_result := jsonb_build_object(
        'kind', 'waiting',
        'dependency_outbox_id', v_dependency.id,
        'dependency_status', v_dependency.status
      );
    end if;
    exit;
  end loop;

  if v_result is null then
    raise exception 'canonical_title_dependency_resolve_empty';
  end if;
  return v_result || jsonb_build_object(
    'requested_outbox_id', v_row.id,
    'requested_entity', v_row.entity,
    'requested_entity_id', v_row.entity_id,
    'requested_team', v_row.team,
    'root_kind', v_root_kind
  ) || case when v_root_kind = 'bound_existing_issue_root'
    then jsonb_build_object('bound_issue_id', v_bound_issue_id)
    else '{}'::jsonb
  end;
end;
$fn$;

revoke all on function public.production_canonical_title_dependency_resolve(bigint)
  from public, anon, authenticated;
grant execute on function public.production_canonical_title_dependency_resolve(bigint)
  to service_role;

-- A linked deliverable title is not an ordinary whole-row field anymore.
-- Frozen writers may persist other fields, but any stale row image attempting
-- to restore an older title aborts at the database boundary.
create or replace function public.production_canonical_title_deliverable_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.title is not distinct from old.title then return new; end if;
  if old.origin in ('calendar', 'samples') and old.card_id is not null
     and current_setting('app.f133_canonical_title_write', true) is distinct from '1' then
    raise exception 'f133_linked_deliverable_title_requires_canonical_rpc:%', old.id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.production_canonical_title_deliverable_guard()
  from public, anon, authenticated;
drop trigger if exists production_canonical_title_deliverable_guard_before
  on public.deliverables;
create trigger production_canonical_title_deliverable_guard_before
  before update of title on public.deliverables
  for each row execute function public.production_canonical_title_deliverable_guard();

-- Run after the existing `track_b_*` BEFORE trigger and strengthen only a
-- canonical title mutation's CAS cursor. Every unrelated deliverable write
-- keeps the established timestamp behavior unchanged.
create or replace function public.production_canonical_title_cas_guard()
returns trigger
language plpgsql
as $fn$
begin
  if current_setting('app.f133_binder_adopt', true) = '1'
     and new.title is not distinct from old.title then
    new.updated_at := greatest(
      clock_timestamp(),
      coalesce(old.updated_at + interval '1 millisecond', '-infinity'::timestamptz)
    );
  elsif current_setting('app.f133_title_ack_projection', true) = '1'
     and new.title is not distinct from old.title then
    -- Provider acknowledgement updates only linear_raw. Preserve the native
    -- title CAS cursor after the shared track_b trigger has touched it.
    new.updated_at := old.updated_at;
  elsif current_setting('app.f133_canonical_title_write', true) = '1'
     and old.origin in ('calendar', 'samples')
     and old.card_id is not null
     and new.title is distinct from old.title then
    new.updated_at := greatest(
      clock_timestamp(),
      coalesce(old.updated_at + interval '1 millisecond', '-infinity'::timestamptz)
    );
  end if;
  return new;
end;
$fn$;

revoke all on function public.production_canonical_title_cas_guard()
  from public, anon, authenticated;
drop trigger if exists zz_production_canonical_title_cas_before
  on public.deliverables;
create trigger zz_production_canonical_title_cas_before
  before update of title on public.deliverables
  for each row execute function public.production_canonical_title_cas_guard();

-- Project one exact provider title acknowledgement into the narrow raw mirror
-- binder. The native title/card/event are already committed by the canonical
-- CAS and are never rewritten here. A newer inbound field clock wins; equal
-- clock/different value is corruption and fails closed. The zz trigger above
-- preserves the native CAS cursor for this raw-only projection.
create or replace function public.production_canonical_title_acknowledge(
  p_outbox_id bigint,
  p_ack jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_ack jsonb := coalesce(p_ack, '{}'::jsonb);
  v_issue_id text := nullif(btrim(v_ack->>'issue_id'), '');
  v_title text := nullif(btrim(v_ack->>'title'), '');
  v_provider_text text := nullif(btrim(v_ack->>'provider_updated_at'), '');
  v_provider_at timestamptz;
  v_current_text text;
  v_current_at timestamptz;
  v_outbox public.mirror_outbox%rowtype;
  v_deliverable public.deliverables%rowtype;
  v_raw jsonb;
  v_issue jsonb;
begin
  begin
    v_provider_at := v_provider_text::timestamptz;
  exception when others then
    raise exception 'invalid_canonical_title_acknowledgement';
  end;
  if p_outbox_id is null or p_outbox_id < 1
     or jsonb_typeof(v_ack) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_ack)) <> 3
     or exists (
       select 1 from jsonb_object_keys(v_ack) key
       where key <> all (array['issue_id', 'title', 'provider_updated_at']::text[])
     )
     or v_issue_id is null or v_title is null or v_provider_at is null then
    raise exception 'invalid_canonical_title_acknowledgement';
  end if;

  select o.* into v_outbox
  from public.mirror_outbox o where o.id = p_outbox_id for share;
  if not found
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_outbox.deliverable_id
     or v_outbox.comment_id is not null
     or v_outbox.operation is distinct from 'title'
     or v_outbox.op is distinct from 'update_fields'
     or v_outbox.status not in ('pending', 'failed', 'written', 'skipped')
     or v_outbox.payload->>'title' is distinct from v_title
     or v_outbox.linear_result->>'mutation' is distinct from 'issueUpdate'
     or v_outbox.linear_result->>'issue_id' is distinct from v_issue_id
     or v_outbox.linear_result->>'updated_at' is distinct from v_provider_text
     or v_outbox.linear_result->'expected'->'input'->>'title' is distinct from v_title
     or nullif(btrim(v_outbox.linear_result->>'mirror_actor_id'), '') is null then
    raise exception 'canonical_title_acknowledgement_outbox_mismatch';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'production-title-ack:' || v_outbox.entity_id, 0
  ));
  select d.* into v_deliverable
  from public.deliverables d where d.id = v_outbox.entity_id for update;
  if not found
     or v_deliverable.client_slug is distinct from v_outbox.client_slug
     or v_deliverable.team is distinct from v_outbox.team
     or v_deliverable.batch_id is distinct from v_outbox.batch_id
     or nullif(btrim(coalesce(
       v_deliverable.linear_issue_uuid,
       v_deliverable.linear_raw->'issue'->>'id', ''
     )), '') is distinct from v_issue_id then
    raise exception 'canonical_title_acknowledgement_identity_mismatch';
  end if;
  v_raw := coalesce(v_deliverable.linear_raw, '{}'::jsonb);
  v_issue := coalesce(v_raw->'issue', '{}'::jsonb);
  v_current_text := nullif(btrim(v_raw->'field_updated_at'->>'title'), '');
  begin
    v_current_at := v_current_text::timestamptz;
  exception when others then
    raise exception 'canonical_title_acknowledgement_clock_invalid';
  end;
  if v_current_at > v_provider_at then
    return jsonb_build_object(
      'deliverable_id', v_deliverable.id,
      'applied', false,
      'replayed', false,
      'newer_inbound', true,
      'provider_updated_at', v_provider_text
    );
  end if;
  if v_current_at = v_provider_at then
    if v_issue->>'title' is distinct from v_title then
      raise exception 'canonical_title_acknowledgement_equal_clock_conflict';
    end if;
    return jsonb_build_object(
      'deliverable_id', v_deliverable.id,
      'applied', false,
      'replayed', true,
      'newer_inbound', false,
      'provider_updated_at', v_provider_text
    );
  end if;

  perform set_config('app.f133_title_ack_projection', '1', true);
  v_issue := jsonb_set(
    jsonb_set(v_issue, '{id}', to_jsonb(v_issue_id), true),
    '{title}', to_jsonb(v_title), true
  );
  v_issue := jsonb_set(v_issue, '{updatedAt}', to_jsonb(v_provider_text), true);
  v_raw := jsonb_set(v_raw, '{issue}', v_issue, true);
  v_raw := jsonb_set(
    v_raw,
    '{field_updated_at}',
    coalesce(v_raw->'field_updated_at', '{}'::jsonb)
      || jsonb_build_object('title', v_provider_text),
    true
  );
  update public.deliverables d
  set linear_raw = v_raw
  where d.id = v_deliverable.id
  returning d.* into v_deliverable;
  if v_deliverable.linear_raw->'issue'->>'title' is distinct from v_title
     or v_deliverable.linear_raw->'field_updated_at'->>'title' is distinct from v_provider_text then
    raise exception 'canonical_title_acknowledgement_projection_failed';
  end if;
  return jsonb_build_object(
    'deliverable_id', v_deliverable.id,
    'applied', true,
    'replayed', false,
    'newer_inbound', false,
    'provider_updated_at', v_provider_text
  );
end;
$fn$;

revoke all on function public.production_canonical_title_acknowledge(bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_canonical_title_acknowledge(bigint, jsonb)
  to service_role;

-- One pre-activation adoption path exists for linked historical rows whose
-- provider create acknowledgement predates the title field-clock binder. The
-- private operator manifest independently reads Linear, then this RPC locks
-- and re-verifies every native/create/provider binder before adding only the
-- missing raw title clock. It cannot repair a title, adopt title history, or
-- accept an incomplete/ambiguous provenance chain.
create or replace function public.production_canonical_title_binder_adopt(
  p_evidence jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_evidence jsonb := coalesce(p_evidence, '{}'::jsonb);
  v_del jsonb := coalesce(v_evidence->'deliverable', '{}'::jsonb);
  v_create jsonb := coalesce(v_evidence->'create', '{}'::jsonb);
  v_provider jsonb := coalesce(v_evidence->'provider', '{}'::jsonb);
  v_id text := nullif(btrim(v_del->>'id'), '');
  v_evidence_sha text := lower(nullif(btrim(v_evidence->>'evidence_sha256'), ''));
  v_expected_at timestamptz;
  v_provider_at timestamptz;
  v_create_provider_at timestamptz;
  v_event_at timestamptz;
  v_create_source_at timestamptz;
  v_row public.deliverables%rowtype;
  v_outbox public.mirror_outbox%rowtype;
  v_event public.deliverable_events%rowtype;
  v_raw jsonb;
  v_issue jsonb;
  v_adopted_issue jsonb;
  v_replayed boolean := false;
  v_count integer;
begin
  begin
    v_expected_at := nullif(v_del->>'expected_updated_at', '')::timestamptz;
    v_provider_at := nullif(v_provider->>'updated_at', '')::timestamptz;
    v_create_provider_at := nullif(v_create->>'provider_updated_at', '')::timestamptz;
    v_event_at := nullif(v_create->>'event_ts', '')::timestamptz;
    v_create_source_at := nullif(v_create->>'source_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_f133_title_binder_adoption_evidence';
  end;
  if jsonb_typeof(v_evidence) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_evidence)) <> 6
     or exists (
       select 1 from jsonb_object_keys(v_evidence) key
       where key <> all (array[
         'contract', 'release_sha', 'evidence_sha256',
         'deliverable', 'create', 'provider'
       ]::text[])
     )
     or v_evidence->>'contract' is distinct from
       'syncview-f133-canonical-title-binder-adopt/v1'
     or coalesce(v_evidence->>'release_sha', '') !~ '^[0-9a-f]{40}$'
     or coalesce(v_evidence_sha, '') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(v_del) is distinct from 'object'
     or jsonb_typeof(v_create) is distinct from 'object'
     or jsonb_typeof(v_provider) is distinct from 'object'
     or v_id is null or v_expected_at is null or v_provider_at is null
     or v_create_provider_at is null or v_event_at is null
     or v_create_source_at is null
     or v_provider_at < v_create_provider_at
     or v_del->>'title' is distinct from v_provider->>'title'
     or v_del->>'linear_issue_uuid' is distinct from v_provider->>'id'
     or v_del->>'linear_identifier' is distinct from v_provider->>'identifier'
     or v_del->>'linear_issue_url' is distinct from v_provider->>'url'
     or v_del->'stored_issue'->>'id' is distinct from v_provider->>'id'
     or v_del->'stored_issue'->>'identifier' is distinct from v_provider->>'identifier'
     or v_del->'stored_issue'->>'title' is distinct from v_provider->>'title'
     or v_del->'stored_issue'->>'url' is distinct from v_provider->>'url'
     or v_create->>'event_ts' is distinct from v_create->>'source_at' then
    raise exception 'invalid_f133_title_binder_adoption_evidence';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('f133-binder-adopt:' || v_id, 0));
  select d.* into v_row from public.deliverables d where d.id = v_id for update;
  if not found
     or v_row.batch_id is distinct from v_del->>'batch_id'
     or v_row.client_slug is distinct from v_del->>'client_slug'
     or v_row.team is distinct from v_del->>'team'
     or v_row.kind is distinct from v_del->>'kind'
     or v_row.origin is distinct from v_del->>'origin'
     or coalesce(v_row.card_id, '') is distinct from coalesce(v_del->>'card_id', '')
     or v_row.title is distinct from v_del->>'title'
     or coalesce(v_row.created_by, '') is distinct from coalesce(v_del->>'created_by', '')
     or v_row.created_at is distinct from nullif(v_del->>'created_at', '')::timestamptz
     or v_row.linear_issue_uuid is distinct from v_del->>'linear_issue_uuid'
     or v_row.linear_identifier is distinct from v_del->>'linear_identifier'
     or v_row.linear_issue_url is distinct from v_del->>'linear_issue_url'
     or v_row.origin not in ('calendar', 'samples')
     or v_row.card_id is null
     or (v_row.team = 'video' and v_row.kind is distinct from 'video')
     or (v_row.team = 'graphics' and v_row.kind is distinct from 'thumbnail') then
    raise exception 'f133_title_binder_adoption_row_mismatch';
  end if;
  if (v_row.origin = 'calendar' and v_row.team = 'video' and not exists (
       select 1 from public.calendar_posts c where c.client = v_row.client_slug
         and c.id = v_row.card_id and c.video_deliverable_id = v_row.id
     )) or (v_row.origin = 'calendar' and v_row.team = 'graphics' and not exists (
       select 1 from public.calendar_posts c where c.client = v_row.client_slug
         and c.id = v_row.card_id and c.graphic_deliverable_id = v_row.id
     )) or (v_row.origin = 'samples' and v_row.team = 'video' and not exists (
       select 1 from public.sample_reviews c where c.client = v_row.client_slug
         and c.id = v_row.card_id and c.video_deliverable_id = v_row.id
     )) or (v_row.origin = 'samples' and v_row.team = 'graphics' and not exists (
       select 1 from public.sample_reviews c where c.client = v_row.client_slug
         and c.id = v_row.card_id and c.graphic_deliverable_id = v_row.id
     )) or exists (
       select 1 from public.deliverables other
       where other.client_slug = v_row.client_slug
         and other.origin = v_row.origin and other.card_id = v_row.card_id
         and other.team = v_row.team and other.id <> v_row.id
     ) then
    raise exception 'f133_title_binder_adoption_linkage_mismatch';
  end if;

  v_raw := coalesce(v_row.linear_raw, '{}'::jsonb);
  v_issue := coalesce(v_raw->'issue', '{}'::jsonb);
  v_adopted_issue := coalesce(v_del->'stored_issue', '{}'::jsonb)
    || jsonb_build_object(
      'id', v_provider->>'id',
      'identifier', v_provider->>'identifier',
      'title', v_provider->>'title',
      'updatedAt', v_provider->>'updated_at',
      'url', v_provider->>'url'
    );
  if coalesce(v_del->>'stored_title_clock', '') = ''
     and v_row.updated_at is distinct from v_expected_at then
    if v_row.updated_at > v_expected_at
       and v_issue is not distinct from v_adopted_issue
       and v_raw->'field_updated_at'->>'title'
         is not distinct from v_provider->>'updated_at' then
      v_replayed := true;
    else
      raise exception 'f133_title_binder_adoption_stored_issue_mismatch';
    end if;
  elsif v_issue is distinct from coalesce(v_del->'stored_issue', '{}'::jsonb)
     or coalesce(v_raw->'field_updated_at'->>'title', '')
       is distinct from coalesce(v_del->>'stored_title_clock', '') then
    raise exception 'f133_title_binder_adoption_stored_issue_mismatch';
  end if;

  select o.* into v_outbox from public.mirror_outbox o
  where o.id = nullif(v_create->>'outbox_id', '')::bigint for share;
  if not found
     or v_outbox.entity is distinct from 'deliverable'
     or v_outbox.entity_id is distinct from v_row.id
     or v_outbox.deliverable_id is distinct from v_row.id
     or v_outbox.batch_id is distinct from v_row.batch_id
     or v_outbox.comment_id is not null
     or v_outbox.operation is distinct from 'create'
     or v_outbox.op is distinct from 'create'
     or v_outbox.client_slug is distinct from v_row.client_slug
     or v_outbox.team is distinct from v_row.team
     or v_outbox.dedup_key is distinct from v_create->>'dedup_key'
     or v_outbox.source_edited_at is distinct from v_create_source_at
     or v_outbox.status is distinct from 'written'
     or v_outbox.test_only is distinct from false
     or v_outbox.payload->>'title' is distinct from v_row.title
     or v_outbox.payload->>'_intent_fingerprint'
       is distinct from v_create->>'intent_fingerprint'
     or v_outbox.payload->>'team_id' is distinct from v_provider->>'team_id'
     or v_outbox.payload->>'project_id' is distinct from v_provider->>'project_id'
     or v_outbox.linear_result->>'mutation' is distinct from 'issueCreate'
     or v_outbox.linear_result->>'issue_id' is distinct from v_provider->>'id'
     or v_outbox.linear_result->>'updated_at'
       is distinct from v_create->>'provider_updated_at'
     or v_outbox.linear_result->'expected'->'input'->>'title'
       is distinct from v_row.title
     or nullif(btrim(v_outbox.linear_result->>'mirror_actor_id'), '') is null then
    raise exception 'f133_title_binder_adoption_create_mismatch';
  end if;
  select count(*)::integer into v_count from public.mirror_outbox o
  where o.entity = 'deliverable' and o.entity_id = v_row.id and o.operation = 'create';
  if v_count <> 1 then raise exception 'f133_title_binder_adoption_create_ambiguous'; end if;

  select e.* into v_event from public.deliverable_events e
  where e.id = nullif(v_create->>'event_id', '')::bigint;
  if not found
     or v_event.deliverable_id is distinct from v_row.id
     or v_event.batch_id is distinct from v_row.batch_id
     or v_event.client_slug is distinct from v_row.client_slug
     or v_event.ts is distinct from v_event_at
     or v_event.action is distinct from 'create'
     or v_event.source is distinct from 'ui'
     or v_event.payload->'outbound'->>'entity_id' is distinct from v_row.id
     or v_event.payload->'outbound'->>'dedup_key' is distinct from v_outbox.dedup_key
     or v_event.payload->'outbound'->'payload'->>'_intent_fingerprint'
       is distinct from v_create->>'intent_fingerprint' then
    raise exception 'f133_title_binder_adoption_event_mismatch';
  end if;
  select count(*)::integer into v_count from public.deliverable_events e
  where e.deliverable_id = v_row.id and e.action = 'create' and e.source = 'ui';
  if v_count <> 1 then raise exception 'f133_title_binder_adoption_event_ambiguous'; end if;
  if exists (
       select 1 from public.mirror_outbox o
       where o.entity = 'deliverable' and o.entity_id = v_row.id
         and o.operation = 'title'
     ) or exists (
       select 1 from public.deliverable_events e
       where e.client_slug = v_row.client_slug
         and e.batch_id = v_row.batch_id
         and e.action = 'title_change'
         and (
           e.deliverable_id = v_row.id
           or e.payload->>'card_id' = v_row.card_id
           or e.payload->'expected_deliverable_titles' ? v_row.id
         )
     ) or exists (
       select 1 from public.mirror_outbox o
       where o.entity = 'deliverable' and o.entity_id = v_row.id
         and o.id > v_outbox.id and o.status in ('pending', 'failed', 'shadow_ok')
     ) then
    raise exception 'f133_title_binder_adoption_history_ambiguous';
  end if;

  if v_replayed then
    null;
  elsif coalesce(v_del->>'stored_title_clock', '') <> '' then
    if v_del->>'stored_title_clock' is distinct from v_provider->>'updated_at'
       or v_issue->>'title' is distinct from v_provider->>'title' then
      raise exception 'f133_title_binder_adoption_existing_clock_conflict';
    end if;
    v_replayed := true;
  else
    v_issue := jsonb_set(v_issue, '{id}', to_jsonb(v_provider->>'id'), true);
    v_issue := jsonb_set(v_issue, '{identifier}', to_jsonb(v_provider->>'identifier'), true);
    v_issue := jsonb_set(v_issue, '{title}', to_jsonb(v_provider->>'title'), true);
    v_issue := jsonb_set(v_issue, '{updatedAt}', to_jsonb(v_provider->>'updated_at'), true);
    v_issue := jsonb_set(v_issue, '{url}', to_jsonb(v_provider->>'url'), true);
    v_raw := jsonb_set(v_raw, '{issue}', v_issue, true);
    v_raw := jsonb_set(
      v_raw, '{field_updated_at}',
      coalesce(v_raw->'field_updated_at', '{}'::jsonb)
        || jsonb_build_object('title', v_provider->>'updated_at'), true
    );
    perform set_config('app.f133_binder_adopt', '1', true);
    update public.deliverables d
    set linear_raw = v_raw
    where d.id = v_row.id
    returning d.* into v_row;
    if v_row.updated_at <= v_expected_at
       or v_row.linear_raw->'field_updated_at'->>'title'
         is distinct from v_provider->>'updated_at' then
      raise exception 'f133_title_binder_adoption_projection_failed';
    end if;
  end if;
  return jsonb_build_object(
    'ok', true,
    'type', 'f133_title_binder_adoption',
    'deliverable_id', v_row.id,
    'evidence_sha256', v_evidence_sha,
    'title', v_row.title,
    'provider_updated_at', v_provider->>'updated_at',
    'replayed', v_replayed
  );
end;
$fn$;

revoke all on function public.production_canonical_title_binder_adopt(jsonb)
  from public, anon, authenticated;
grant execute on function public.production_canonical_title_binder_adopt(jsonb)
  to service_role;

-- F203 create acknowledgement is the only trustworthy instant for the first
-- title value/clock binder. The provider-verified create response is passed in
-- by linear-outbound and stored atomically with identity linkage. A later
-- unrelated issue edit may then advance issue.updatedAt without making the
-- first native title intent look stale. Missing or inexact provider title
-- evidence fails closed instead of inventing a field clock.
do $fn$
begin
  if to_regprocedure(
    'public.production_issue_create_linkage_pre_f133(text,bigint,jsonb,jsonb)'
  ) is null then
    alter function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
      rename to production_issue_create_linkage_pre_f133;
  end if;
end;
$fn$;

revoke all on function public.production_issue_create_linkage_pre_f133(text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_issue_create_linkage_pre_f133(text, bigint, jsonb, jsonb)
  to service_role;

create or replace function public.production_issue_create_linkage(
  p_deliverable_id text,
  p_outbox_id bigint,
  p_expected jsonb,
  p_issue jsonb
) returns public.deliverables
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id text := nullif(btrim(coalesce(p_deliverable_id, '')), '');
  v_expected jsonb := coalesce(p_expected, '{}'::jsonb);
  v_issue jsonb := coalesce(p_issue, '{}'::jsonb);
  v_linear_id text := nullif(btrim(v_issue->>'id'), '');
  v_identifier text := nullif(btrim(v_issue->>'identifier'), '');
  v_url text := nullif(btrim(v_issue->>'url'), '');
  v_title text := nullif(btrim(v_issue->>'title'), '');
  v_provider_updated_at_text text := nullif(btrim(v_issue->>'updated_at'), '');
  v_provider_updated_at timestamptz;
  v_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_current_issue jsonb;
  v_patched_issue jsonb;
  v_patched_raw jsonb;
  v_has_later_pending boolean;
begin
  begin
    v_provider_updated_at := v_provider_updated_at_text::timestamptz;
  exception when others then
    raise exception 'invalid_production_create_linkage';
  end;
  if v_id is null
     or p_outbox_id is null
     or p_outbox_id < 1
     or jsonb_typeof(v_expected) is distinct from 'object'
     or jsonb_typeof(v_issue) is distinct from 'object'
     or v_expected->>'id' is distinct from v_id
     or v_linear_id is null
     or v_title is null
     or v_provider_updated_at is null
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
     or v_outbox.payload->>'title' is distinct from v_title
     or v_result.title is distinct from v_title
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
      jsonb_set(
        jsonb_set(
          jsonb_set(v_current_issue, '{id}', to_jsonb(v_linear_id), true),
          '{identifier}', coalesce(to_jsonb(v_identifier), 'null'::jsonb), true
        ),
        '{url}', coalesce(to_jsonb(v_url), 'null'::jsonb), true
      ),
      '{title}', to_jsonb(v_title), true
    ),
    '{updatedAt}', to_jsonb(v_provider_updated_at_text), true
  );
  v_patched_raw := jsonb_set(
    jsonb_set(v_result.linear_raw, '{issue}', v_patched_issue, true),
    '{field_updated_at}',
    coalesce(v_result.linear_raw->'field_updated_at', '{}'::jsonb)
      || jsonb_build_object('title', v_provider_updated_at_text),
    true
  );
  select exists (
    select 1
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_id
      and o.id > p_outbox_id
      and o.status in ('pending', 'failed', 'shadow_ok')
  ) into v_has_later_pending;

  perform set_config('app.event_written', '1', true);
  update public.deliverables d
  set linear_issue_uuid = v_linear_id,
      linear_identifier = v_identifier,
      linear_issue_url = v_url,
      linear_raw = v_patched_raw,
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
      'later_pending', v_has_later_pending,
      'title_clock_bound', true
    )
  );
  return v_result;
end;
$fn$;

revoke all on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
  to service_role;

drop trigger if exists production_canonical_title_guard_before
  on public.sample_reviews;
create trigger production_canonical_title_guard_before
  before insert or update of name, title_revision,
    video_deliverable_id, graphic_deliverable_id
  on public.sample_reviews
  for each row execute function public.production_canonical_title_card_guard();

-- The asynchronous create acknowledgement owns the deliverable's Linear URL.
-- Project that one field into the exact linked Calendar/Samples slot without
-- involving either frozen whole-card writer. A missing card or mismatched slot
-- aborts the originating deliverable update in the same transaction.
create or replace function public.production_deliverable_linear_link_projection()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_updated integer;
begin
  if new.linear_issue_url is not distinct from old.linear_issue_url then
    return new;
  end if;
  if new.origin not in ('calendar', 'samples') or new.card_id is null then
    return new;
  end if;
  if new.client_slug is null or new.team not in ('video', 'graphics') then
    raise exception 'f133_linear_link_projection_invalid_deliverable:%', new.id;
  end if;

  if new.origin = 'calendar' and new.team = 'video' then
    update public.calendar_posts c
    set linear_issue_id = new.linear_issue_url
    where c.client = new.client_slug
      and c.id = new.card_id
      and c.video_deliverable_id = new.id;
  elsif new.origin = 'calendar' and new.team = 'graphics' then
    update public.calendar_posts c
    set graphic_linear_issue_id = new.linear_issue_url
    where c.client = new.client_slug
      and c.id = new.card_id
      and c.graphic_deliverable_id = new.id;
  elsif new.origin = 'samples' and new.team = 'video' then
    update public.sample_reviews c
    set linear_issue_id = new.linear_issue_url
    where c.client = new.client_slug
      and c.id = new.card_id
      and c.video_deliverable_id = new.id;
  else
    update public.sample_reviews c
    set graphic_linear_issue_id = new.linear_issue_url
    where c.client = new.client_slug
      and c.id = new.card_id
      and c.graphic_deliverable_id = new.id;
  end if;
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'f133_linear_link_projection_mismatch:%:%:%',
      new.origin, new.team, new.id;
  end if;
  return new;
end;
$fn$;

revoke all on function public.production_deliverable_linear_link_projection()
  from public, anon, authenticated;

drop trigger if exists production_deliverable_linear_link_projection_after
  on public.deliverables;
create trigger production_deliverable_linear_link_projection_after
  after update of linear_issue_url on public.deliverables
  for each row
  when (new.linear_issue_url is distinct from old.linear_issue_url)
  execute function public.production_deliverable_linear_link_projection();

-- Replace only the append implementation. Its authority, exact parent-route,
-- replay, and all-or-none guarantees remain. Ordinals no longer come from a
-- user-visible generic title: existing linked card groups own that cursor,
-- while every new pair carries one independently validated canonical title.
-- Preserve the exact pre-F133 implementation under a closed service-only name
-- before replacing it. Production-write uses this only for a version-3 intake
-- receipt; version 4 can never enter it.
do $fn$
begin
  if to_regprocedure(
    'public.production_intake_append_v3(text,timestamp with time zone,jsonb,jsonb)'
  ) is null then
    alter function public.production_intake_append(text, timestamptz, jsonb, jsonb)
      rename to production_intake_append_v3;
  end if;
end;
$fn$;

revoke all on function public.production_intake_append_v3(text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_intake_append_v3(text, timestamptz, jsonb, jsonb)
  to service_role;

create or replace function public.production_intake_append(
  p_batch_id text,
  p_expected_updated_at timestamptz,
  p_rows jsonb,
  p_events jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_batch public.batches%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_existing_outbox public.mirror_outbox%rowtype;
  v_result public.deliverables%rowtype;
  v_row jsonb;
  v_event jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_count integer;
  v_index integer;
  v_team text;
  v_card_id text;
  v_title text;
  v_parent_id text;
  v_dependency_parent_id text;
  v_parent_ids text[];
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
  v_source_edited_at timestamptz;
  v_generation bigint;
  v_bound_parity boolean;
  v_legacy_parity boolean;
  v_test_only boolean;
  v_event_count integer;
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
  if exists (
    select 1
    from jsonb_array_elements(p_rows) item
    group by nullif(btrim(item->>'card_id'), '')
    having nullif(btrim(item->>'card_id'), '') is null
       or count(*) > 2
       or count(*) filter (where item->>'team' = 'video') > 1
       or count(*) filter (where item->>'team' = 'graphics') > 1
       or count(*) <> count(distinct item->>'team')
       or count(*) filter (where item->>'team' in ('video', 'graphics')) <> count(*)
       or count(distinct item->>'title') <> 1
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
    v_title := regexp_replace(btrim(coalesce(v_row->>'title', '')), '[[:space:]]+', ' ', 'g');
    v_project_id := nullif(btrim(v_payload->>'project_id'), '');
    begin
      v_source_edited_at := nullif(v_outbound->>'source_edited_at', '')::timestamptz;
      v_test_only := coalesce((v_outbound->>'test_only')::boolean, false);
      v_legacy_parity := coalesce((v_outbound->>'legacy_parity')::boolean, false);
      v_generation := nullif(v_payload->>'_f27_authority_generation', '')::bigint;
      v_bound_parity := coalesce((v_payload->>'_f27_legacy_parity')::boolean, false);
    exception when others then
      raise exception 'invalid_intake_append_payload';
    end;
    if nullif(btrim(v_row->>'id'), '') is null
       or v_row->>'batch_id' is distinct from v_batch.id
       or v_row->>'client_slug' is distinct from v_batch.client_slug
       or v_team is null
       or v_team not in ('video', 'graphics')
       or (v_batch.team is not null and v_team is distinct from v_batch.team)
       or v_card_id is null
       or v_title = ''
       or length(v_title) > 500
       or v_title ~* '^(video|graphics?)[[:space:]]+[0-9]+$'
       or v_row->>'title' is distinct from v_title
       or v_row->>'origin' is distinct from 'calendar'
       or v_row->>'kind' is distinct from (
         case when v_team = 'graphics' then 'thumbnail' else 'video' end
       )
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
       or v_payload->>'title' is distinct from v_title
       or v_project_id is null
       or v_source_edited_at is null
       or v_source_edited_at is distinct from nullif(v_event->>'ts', '')::timestamptz
       or v_generation is null or v_generation < 0
       or v_bound_parity is distinct from v_legacy_parity then
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
      if not found
         or v_dependency.entity is distinct from 'batch'
         or v_dependency.entity_id is distinct from v_batch.id
         or v_dependency.operation is distinct from 'create'
         or v_dependency.client_slug is distinct from v_batch.client_slug
         or v_dependency.team is distinct from v_team
         or v_dependency.test_only is distinct from coalesce((v_outbound->>'test_only')::boolean, false)
         or v_dependency.legacy_parity is distinct from coalesce((v_outbound->>'legacy_parity')::boolean, false)
         or v_dependency.payload->>'project_id' is distinct from v_project_id
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
    if v_replay then
      v_replay_count := v_replay_count + 1;
      select o.* into v_existing_outbox
      from public.mirror_outbox o where o.dedup_key = v_outbound->>'dedup_key';
      if not found
         or v_existing_outbox.entity is distinct from 'deliverable'
         or v_existing_outbox.entity_id is distinct from v_row->>'id'
         or v_existing_outbox.deliverable_id is distinct from v_row->>'id'
         or v_existing_outbox.batch_id is distinct from v_batch.id
         or v_existing_outbox.comment_id is not null
         or v_existing_outbox.operation is distinct from 'create'
         or v_existing_outbox.op is distinct from 'create'
         or v_existing_outbox.client_slug is distinct from v_batch.client_slug
         or v_existing_outbox.team is distinct from v_team
         or v_existing_outbox.source_edited_at is distinct from v_source_edited_at
         or v_existing_outbox.actor is distinct from nullif(v_event->>'actor', '')
         or v_existing_outbox.role is distinct from nullif(v_event->>'role', '')
         or v_existing_outbox.depends_on_id is distinct from v_dependency_id
         or v_existing_outbox.test_only is distinct from v_test_only
         or v_existing_outbox.legacy_parity is distinct from v_legacy_parity
         or v_existing_outbox.authority_generation is distinct from v_generation
         or v_existing_outbox.payload is distinct from (
           v_payload - '_f27_authority_generation' - '_f27_legacy_parity'
         ) then
        raise exception 'idempotent_result_missing';
      end if;
      select count(*)::integer into v_event_count
      from public.deliverable_events e
      where e.deliverable_id = v_row->>'id'
        and e.batch_id = v_batch.id
        and e.client_slug = v_batch.client_slug
        and e.ts is not distinct from v_source_edited_at
        and e.actor is not distinct from nullif(v_event->>'actor', '')
        and e.role is not distinct from nullif(v_event->>'role', '')
        and e.action = 'create'
        and e.from_status is null
        and e.to_status is not distinct from coalesce(
          nullif(v_row->>'status', ''), 'in_progress'
        )
        and e.source = 'ui'
        and e.event_key is null
        and e.payload is not distinct from v_event;
      if v_event_count <> 1 then raise exception 'idempotent_result_missing'; end if;
    end if;
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
         or v_result.kind is distinct from v_row->>'kind'
         or v_result.origin is distinct from v_row->>'origin'
         or v_result.card_id is distinct from v_row->>'card_id'
         or v_result.sort_key is distinct from (v_row->>'sort_key')::numeric then
        raise exception 'idempotent_result_missing';
      end if;
      v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_result));
    end loop;
    return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', true);
  end if;
  for v_index in 0..v_count - 1
  loop
    v_row := p_rows->v_index;
    v_event := p_events->v_index;
    v_outbound := v_event->'outbound';
    perform public.production_assert_authority(
      v_batch.client_slug,
      v_row->>'team',
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false)
    );
  end loop;
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
  -- Keep the SQL cursor byte-for-byte aligned with planAppendIntakeItems.
  -- Historical batches may have sparse sort keys after a reorder/delete; a
  -- cardinality cursor would allocate an ordinal that the reviewed JS plan
  -- can never produce. The next ordinal is therefore max(sort_key)+2 while
  -- the next sort slot remains max(sort_key)+1.
  select coalesce(max(floor(d.sort_key)::integer + 1), 0)
    into v_base_ordinal
  from public.deliverables d
  where d.batch_id = v_batch.id
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
        select count(distinct item->>'card_id')
        from jsonb_array_elements(p_rows) item
      )
    )
  );

  return jsonb_build_object('batch', to_jsonb(v_batch), 'items', v_rows_out, 'replay', false);
end;
$fn$;

revoke all on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated, service_role;

-- Commit the native batch/children/outbox intents and their linked Calendar
-- cards in one database transaction. A response can therefore be lost and
-- retried, but a committed deliverable can never be left waiting for one
-- browser's local materialisation state.
create or replace function public.production_intake_commit(
  p_mode text,
  p_batch jsonb,
  p_parent_events jsonb,
  p_rows jsonb,
  p_events jsonb,
  p_cards jsonb,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_mode text := lower(nullif(btrim(coalesce(p_mode, '')), ''));
  v_batch_input jsonb := coalesce(p_batch, '{}'::jsonb);
  v_parent_events jsonb := coalesce(p_parent_events, '[]'::jsonb);
  v_rows jsonb := coalesce(p_rows, '[]'::jsonb);
  v_events jsonb := coalesce(p_events, '[]'::jsonb);
  v_cards jsonb := coalesce(p_cards, '[]'::jsonb);
  v_batch_id text := nullif(btrim(v_batch_input->>'id'), '');
  v_client_slug text := nullif(btrim(v_batch_input->>'client_slug'), '');
  v_batch public.batches%rowtype;
  v_item public.deliverables%rowtype;
  v_existing_outbox public.mirror_outbox%rowtype;
  v_row jsonb;
  v_event jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_card jsonb;
  v_current_card jsonb;
  v_parent_outbox_by_team jsonb := '{}'::jsonb;
  v_rows_out jsonb := '[]'::jsonb;
  v_cards_out jsonb := '[]'::jsonb;
  v_append_result jsonb;
  v_index integer;
  v_count integer;
  v_parent_count integer;
  v_card_count integer;
  v_total_intents integer;
  v_replay_count integer := 0;
  v_replay boolean;
  v_team text;
  v_dedup text;
  v_fingerprint text;
  v_parent_outbox_id bigint;
  v_title text;
  v_actor text;
  v_role text;
  v_event_ts timestamptz;
  v_generation bigint;
  v_bound_parity boolean;
  v_legacy_parity boolean;
  v_test_only boolean;
  v_event_count integer;
  v_expected_event jsonb;
  v_video_id text;
  v_graphic_id text;
  v_matching integer;
  v_order_base numeric;
begin
  if v_mode not in ('new', 'append')
     or v_batch_id is null
     or jsonb_typeof(v_parent_events) is distinct from 'array'
     or jsonb_typeof(v_rows) is distinct from 'array'
     or jsonb_typeof(v_events) is distinct from 'array'
     or jsonb_typeof(v_cards) is distinct from 'array' then
    raise exception 'invalid_intake_commit_payload';
  end if;
  v_count := jsonb_array_length(v_rows);
  v_parent_count := jsonb_array_length(v_parent_events);
  v_card_count := jsonb_array_length(v_cards);
  if v_count < 1 or v_count > 100
     or jsonb_array_length(v_events) <> v_count
     or v_card_count < 1 or v_card_count > v_count
     or (v_mode = 'new' and (v_parent_count < 1 or v_parent_count > 2))
     or (v_mode = 'append' and (v_parent_count <> 0 or p_expected_updated_at is null)) then
    raise exception 'invalid_intake_commit_payload';
  end if;

  if v_mode = 'append' then
    select b.* into v_batch from public.batches b where b.id = v_batch_id;
    if not found then raise exception 'batch_not_found'; end if;
    v_client_slug := v_batch.client_slug;
  elsif v_client_slug is null then
    raise exception 'invalid_intake_commit_payload';
  end if;
  -- Cards are deliberately a narrow typed payload. Unknown whole-card fields
  -- fail closed rather than becoming an accidental second writer surface.
  for v_index in 0..v_card_count - 1
  loop
    v_card := v_cards->v_index;
    if jsonb_typeof(v_card) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_card) key
         where key <> all (array[
           'client', 'id', 'updated_at', 'order_index', 'scheduled_date',
           'name', 'status', 'video_status', 'graphic_status', 'caption_status',
           'asset_url', 'thumbnail_url', 'caption', 'cta', 'tweaks',
           'video_tweaks', 'graphic_tweaks', 'caption_tweaks',
           'linear_issue_id', 'graphic_linear_issue_id',
           'video_deliverable_id', 'graphic_deliverable_id'
         ]::text[])
       ) then
      raise exception 'invalid_intake_card_payload';
    end if;
    v_title := regexp_replace(btrim(coalesce(v_card->>'name', '')), '[[:space:]]+', ' ', 'g');
    v_video_id := nullif(btrim(v_card->>'video_deliverable_id'), '');
    v_graphic_id := nullif(btrim(v_card->>'graphic_deliverable_id'), '');
    if v_card->>'client' is distinct from v_client_slug
       or nullif(btrim(v_card->>'id'), '') is null
       or v_title = '' or length(v_title) > 500
       or v_title ~* '^(video|graphics?)[[:space:]]+[0-9]+$'
       or v_card->>'name' is distinct from v_title
       or coalesce(v_card->>'order_index', '') <> ''
       or coalesce(v_card->>'scheduled_date', '') <> ''
       or (v_video_id is null and v_graphic_id is null)
       or (v_video_id is not null and v_video_id = v_graphic_id)
       or nullif(btrim(coalesce(v_card->>'linear_issue_id', '')), '') is not null
       or nullif(btrim(coalesce(v_card->>'graphic_linear_issue_id', '')), '') is not null then
      raise exception 'invalid_intake_card_payload';
    end if;
    select count(*)::integer into v_matching
    from jsonb_array_elements(v_rows) item
    where item->>'client_slug' = v_client_slug
      and item->>'batch_id' = v_batch_id
      and item->>'origin' = 'calendar'
      and item->>'card_id' = v_card->>'id'
      and item->>'title' = v_title
      and (
        (item->>'id' = v_video_id and item->>'team' = 'video' and item->>'kind' = 'video')
        or (item->>'id' = v_graphic_id and item->>'team' = 'graphics' and item->>'kind' = 'thumbnail')
      );
    if v_matching <> (case when v_video_id is null then 0 else 1 end)
                       + (case when v_graphic_id is null then 0 else 1 end) then
      raise exception 'invalid_intake_card_linkage';
    end if;
  end loop;
  if (
    select count(distinct item->>'id') from jsonb_array_elements(v_cards) item
  ) <> v_card_count
     or exists (
       select 1
       from jsonb_array_elements(v_rows) item
       where not exists (
         select 1 from jsonb_array_elements(v_cards) card
         where card->>'id' = item->>'card_id'
           and card->>'name' = item->>'title'
           and item->>'id' in (
             nullif(btrim(card->>'video_deliverable_id'), ''),
             nullif(btrim(card->>'graphic_deliverable_id'), '')
           )
       )
     ) then
    raise exception 'invalid_intake_card_linkage';
  end if;

  if v_mode = 'new' then
    -- One parent intent per represented team, and one child event per row.
    if (
      select count(distinct item->>'team') from jsonb_array_elements(v_rows) item
    ) <> v_parent_count
       or exists (
         select 1 from jsonb_array_elements(v_rows) item
         where item->>'team' not in ('video', 'graphics')
            or item->>'client_slug' is distinct from v_client_slug
            or item->>'batch_id' is distinct from v_batch_id
       )
       or exists (
         select 1 from (
           select event->'outbound'->>'team' as team, count(*) as event_count
           from jsonb_array_elements(v_parent_events) event
           group by event->'outbound'->>'team'
         ) parent_plan
         where parent_plan.team not in ('video', 'graphics')
            or parent_plan.event_count <> 1
            or not exists (
              select 1 from jsonb_array_elements(v_rows) item
              where item->>'team' = parent_plan.team
            )
       ) then
      raise exception 'invalid_intake_parent_plan';
    end if;

    v_total_intents := v_parent_count + v_count;
    -- Validate and lock every durable intent before any row is created. A
    -- mixed old/new set is never adopted into the atomic contract.
    for v_index in 0..v_parent_count - 1
    loop
      v_event := v_parent_events->v_index;
      v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);
      v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
      v_team := nullif(btrim(v_outbound->>'team'), '');
      v_actor := nullif(btrim(v_event->>'actor'), '');
      v_role := lower(nullif(btrim(v_event->>'role'), ''));
      v_dedup := nullif(btrim(v_outbound->>'dedup_key'), '');
      v_fingerprint := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
      begin
        v_event_ts := nullif(v_event->>'ts', '')::timestamptz;
        v_test_only := coalesce((v_outbound->>'test_only')::boolean, false);
        v_legacy_parity := coalesce((v_outbound->>'legacy_parity')::boolean, false);
        v_generation := nullif(v_payload->>'_f27_authority_generation', '')::bigint;
        v_bound_parity := coalesce((v_payload->>'_f27_legacy_parity')::boolean, false);
      exception when others then
        raise exception 'invalid_intake_parent_plan';
      end;
      if v_event->>'source' is distinct from 'ui'
         or v_event->>'action' is distinct from 'create'
         or v_actor is null or v_role not in ('admin', 'smm')
         or v_outbound->>'entity' is distinct from 'batch'
         or v_outbound->>'entity_id' is distinct from v_batch_id
         or v_outbound->>'operation' is distinct from 'create'
         or v_team not in ('video', 'graphics')
         or v_dedup is null or v_fingerprint is null
         or v_event_ts is null
         or nullif(v_outbound->>'source_edited_at', '')::timestamptz is distinct from v_event_ts
         or v_generation is null or v_generation < 0
         or v_bound_parity is distinct from v_legacy_parity then
        raise exception 'invalid_intake_parent_plan';
      end if;
      if public.production_outbox_replay(
        'batch', v_batch_id, 'create', v_client_slug, v_team,
        v_actor, v_role,
        coalesce((v_outbound->>'test_only')::boolean, false),
        coalesce((v_outbound->>'legacy_parity')::boolean, false),
        v_fingerprint, v_dedup
      ) then
        v_replay_count := v_replay_count + 1;
        select o.* into v_existing_outbox
        from public.mirror_outbox o where o.dedup_key = v_dedup;
        if not found
           or v_existing_outbox.entity is distinct from 'batch'
           or v_existing_outbox.entity_id is distinct from v_batch_id
           or v_existing_outbox.deliverable_id is not null
           or v_existing_outbox.batch_id is distinct from v_batch_id
           or v_existing_outbox.comment_id is not null
           or v_existing_outbox.operation is distinct from 'create'
           or v_existing_outbox.op is distinct from 'create'
           or v_existing_outbox.client_slug is distinct from v_client_slug
           or v_existing_outbox.team is distinct from v_team
           or v_existing_outbox.source_edited_at is distinct from v_event_ts
           or v_existing_outbox.actor is distinct from v_actor
           or v_existing_outbox.role is distinct from v_role
           or v_existing_outbox.depends_on_id is not null
           or v_existing_outbox.test_only is distinct from v_test_only
           or v_existing_outbox.legacy_parity is distinct from v_legacy_parity
           or v_existing_outbox.authority_generation is distinct from v_generation
           or v_existing_outbox.payload is distinct from (
             v_payload - '_f27_authority_generation' - '_f27_legacy_parity'
           ) then
          raise exception 'idempotent_result_missing';
        end if;
        v_parent_outbox_by_team := jsonb_set(
          v_parent_outbox_by_team, array[v_team], to_jsonb(v_existing_outbox.id), true
        );
        select count(*)::integer into v_event_count
        from public.deliverable_events e
        where e.deliverable_id is null
          and e.batch_id = v_batch_id
          and e.client_slug = v_client_slug
          and e.ts is not distinct from v_event_ts
          and e.actor is not distinct from v_actor
          and e.role is not distinct from v_role
          and e.action = 'create'
          and e.from_status is null
          and e.to_status is not distinct from case
            when v_index = 0 then coalesce(nullif(v_batch_input->>'status', ''), 'active')
            else null
          end
          and e.source = 'ui'
          and e.event_key is null
          and e.payload is not distinct from v_event;
        if v_event_count <> 1 then raise exception 'idempotent_result_missing'; end if;
      end if;
    end loop;
    for v_index in 0..v_count - 1
    loop
      v_row := v_rows->v_index;
      v_event := v_events->v_index;
      v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);
      v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
      v_team := nullif(btrim(v_row->>'team'), '');
      v_actor := nullif(btrim(v_event->>'actor'), '');
      v_role := lower(nullif(btrim(v_event->>'role'), ''));
      v_dedup := nullif(btrim(v_outbound->>'dedup_key'), '');
      v_fingerprint := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
      begin
        v_event_ts := nullif(v_event->>'ts', '')::timestamptz;
        v_test_only := coalesce((v_outbound->>'test_only')::boolean, false);
        v_legacy_parity := coalesce((v_outbound->>'legacy_parity')::boolean, false);
        v_generation := nullif(v_payload->>'_f27_authority_generation', '')::bigint;
        v_bound_parity := coalesce((v_payload->>'_f27_legacy_parity')::boolean, false);
      exception when others then
        raise exception 'invalid_intake_child_plan';
      end;
      if v_event->>'source' is distinct from 'ui'
         or v_event->>'action' is distinct from 'create'
         or v_actor is null or v_role not in ('admin', 'smm')
         or v_outbound->>'entity' is distinct from 'deliverable'
         or v_outbound->>'entity_id' is distinct from v_row->>'id'
         or v_outbound->>'team' is distinct from v_team
         or v_outbound->>'operation' is distinct from 'create'
         or v_payload->>'title' is distinct from v_row->>'title'
         or nullif(btrim(v_outbound->>'depends_on_id'), '') is not null
         or v_dedup is null or v_fingerprint is null
         or v_event_ts is null
         or nullif(v_outbound->>'source_edited_at', '')::timestamptz is distinct from v_event_ts
         or v_generation is null or v_generation < 0
         or v_bound_parity is distinct from v_legacy_parity then
        raise exception 'invalid_intake_child_plan';
      end if;
      if public.production_outbox_replay(
        'deliverable', v_row->>'id', 'create', v_client_slug, v_team,
        v_actor, v_role,
        coalesce((v_outbound->>'test_only')::boolean, false),
        coalesce((v_outbound->>'legacy_parity')::boolean, false),
        v_fingerprint, v_dedup
      ) then
        v_replay_count := v_replay_count + 1;
        v_parent_outbox_id := nullif(v_parent_outbox_by_team->>v_team, '')::bigint;
        if v_parent_outbox_id is null then raise exception 'idempotent_result_missing'; end if;
        v_expected_event := jsonb_set(
          v_event, '{outbound,depends_on_id}', to_jsonb(v_parent_outbox_id), true
        );
        select o.* into v_existing_outbox
        from public.mirror_outbox o where o.dedup_key = v_dedup;
        if not found
           or v_existing_outbox.entity is distinct from 'deliverable'
           or v_existing_outbox.entity_id is distinct from v_row->>'id'
           or v_existing_outbox.deliverable_id is distinct from v_row->>'id'
           or v_existing_outbox.batch_id is distinct from v_batch_id
           or v_existing_outbox.comment_id is not null
           or v_existing_outbox.operation is distinct from 'create'
           or v_existing_outbox.op is distinct from 'create'
           or v_existing_outbox.client_slug is distinct from v_client_slug
           or v_existing_outbox.team is distinct from v_team
           or v_existing_outbox.source_edited_at is distinct from v_event_ts
           or v_existing_outbox.actor is distinct from v_actor
           or v_existing_outbox.role is distinct from v_role
           or v_existing_outbox.depends_on_id is distinct from v_parent_outbox_id
           or v_existing_outbox.test_only is distinct from v_test_only
           or v_existing_outbox.legacy_parity is distinct from v_legacy_parity
           or v_existing_outbox.authority_generation is distinct from v_generation
           or v_existing_outbox.payload is distinct from (
             v_payload - '_f27_authority_generation' - '_f27_legacy_parity'
           ) then
          raise exception 'idempotent_result_missing';
        end if;
        select count(*)::integer into v_event_count
        from public.deliverable_events e
        where e.deliverable_id = v_row->>'id'
          and e.batch_id = v_batch_id
          and e.client_slug = v_client_slug
          and e.ts is not distinct from v_event_ts
          and e.actor is not distinct from v_actor
          and e.role is not distinct from v_role
          and e.action = 'create'
          and e.from_status is null
          and e.to_status is not distinct from coalesce(
            nullif(v_row->>'status', ''), 'in_progress'
          )
          and e.source = 'ui'
          and e.event_key is null
          and e.payload is not distinct from v_expected_event;
        if v_event_count <> 1 then raise exception 'idempotent_result_missing'; end if;
      end if;
    end loop;
    if v_replay_count > 0 and v_replay_count <> v_total_intents then
      raise exception 'idempotency_conflict';
    end if;
    v_replay := v_replay_count = v_total_intents;

    if not v_replay then
      if not exists (
        select 1 from public.clients c
        where c.slug = v_client_slug and c.active is true
      ) then
        raise exception 'active_client_required';
      end if;
      for v_index in 0..v_parent_count - 1
      loop
        v_outbound := v_parent_events->v_index->'outbound';
        perform public.production_assert_authority(
          v_client_slug,
          v_outbound->>'team',
          coalesce((v_outbound->>'test_only')::boolean, false),
          coalesce((v_outbound->>'legacy_parity')::boolean, false)
        );
      end loop;
      for v_index in 0..v_count - 1
      loop
        v_outbound := v_events->v_index->'outbound';
        perform public.production_assert_authority(
          v_client_slug,
          v_outbound->>'team',
          coalesce((v_outbound->>'test_only')::boolean, false),
          coalesce((v_outbound->>'legacy_parity')::boolean, false)
        );
      end loop;
    end if;

    if not v_replay then
      for v_index in 0..v_parent_count - 1
      loop
        v_event := v_parent_events->v_index;
        v_team := v_event->'outbound'->>'team';
        if v_index = 0 then
          v_batch := public.production_batch_write(v_batch_input, v_event);
        else
          v_batch := public.production_batch_intent_write(v_batch_id, v_event);
        end if;
        select o.id into v_parent_outbox_id
        from public.mirror_outbox o
        where o.dedup_key = v_event->'outbound'->>'dedup_key';
        if not found then raise exception 'intake_parent_outbox_missing'; end if;
        v_parent_outbox_by_team := jsonb_set(
          v_parent_outbox_by_team,
          array[v_team],
          to_jsonb(v_parent_outbox_id),
          true
        );
      end loop;
      for v_index in 0..v_count - 1
      loop
        v_row := v_rows->v_index;
        v_event := v_events->v_index;
        v_team := v_row->>'team';
        v_parent_outbox_id := nullif(v_parent_outbox_by_team->>v_team, '')::bigint;
        if v_parent_outbox_id is null then raise exception 'intake_parent_outbox_missing'; end if;
        v_event := jsonb_set(
          v_event,
          '{outbound,depends_on_id}',
          to_jsonb(v_parent_outbox_id),
          true
        );
        v_item := public.production_deliverable_write(v_row, v_event);
        v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_item));
      end loop;
    else
      select b.* into v_batch from public.batches b where b.id = v_batch_id;
      if not found or v_batch.client_slug is distinct from v_client_slug then
        raise exception 'idempotent_result_missing';
      end if;
    end if;
  else
    v_append_result := public.production_intake_append(
      v_batch_id, p_expected_updated_at, v_rows, v_events
    );
    v_batch := jsonb_populate_record(null::public.batches, v_append_result->'batch');
    v_rows_out := coalesce(v_append_result->'items', '[]'::jsonb);
    v_replay := coalesce((v_append_result->>'replay')::boolean, false);
    if not v_replay and not exists (
      select 1 from public.clients c
      where c.slug = v_client_slug and c.active is true
    ) then
      raise exception 'active_client_required';
    end if;
  end if;

  -- Intake owns Calendar placement. Serialize allocations per client and use
  -- payload array order after the greatest existing parseable numeric slot.
  -- Exact replays only read their original cards, preserving their slots.
  perform pg_advisory_xact_lock(hashtextextended(
    'f133-calendar-order:' || v_client_slug,
    0
  ));
  if not v_replay then
    select coalesce(max(btrim(c.order_index)::numeric), 0)
      into v_order_base
    from public.calendar_posts c
    where c.client = v_client_slug
      and btrim(coalesce(c.order_index, ''))
        ~ '^[+-]?[0-9]+([.][0-9]+)?$';
  end if;

  -- A full replay must prove the original atomic card half still exists. A new
  -- commit inserts every linked card only after all child rows are durable;
  -- any error rolls the complete SQL call back.
  perform set_config('app.f133_canonical_title_write', '1', true);
  for v_index in 0..v_card_count - 1
  loop
    v_card := v_cards->v_index;
    v_video_id := nullif(btrim(v_card->>'video_deliverable_id'), '');
    v_graphic_id := nullif(btrim(v_card->>'graphic_deliverable_id'), '');
    if v_replay then
      select to_jsonb(c.*) into v_current_card
      from public.calendar_posts c
      where c.client = v_client_slug and c.id = v_card->>'id';
      if not found
         or nullif(btrim(v_current_card->>'video_deliverable_id'), '') is distinct from v_video_id
         or nullif(btrim(v_current_card->>'graphic_deliverable_id'), '') is distinct from v_graphic_id then
        raise exception 'idempotent_result_missing';
      end if;
      select count(*)::integer into v_matching
      from public.deliverables d
      where d.id = any(array_remove(array[v_video_id, v_graphic_id], null))
        and d.batch_id = v_batch_id
        and d.client_slug = v_client_slug
        and d.origin = 'calendar'
        and d.card_id = v_card->>'id'
        and d.title is not distinct from v_current_card->>'name'
        and (
          (d.id = v_video_id and d.team = 'video' and d.kind = 'video')
          or (d.id = v_graphic_id and d.team = 'graphics' and d.kind = 'thumbnail')
        );
      if v_matching <> cardinality(array_remove(array[v_video_id, v_graphic_id], null)) then
        raise exception 'idempotent_result_missing';
      end if;
    else
      insert into public.calendar_posts (
        client, id, updated_at, order_index, scheduled_date, name,
        status, video_status, graphic_status, caption_status,
        asset_url, thumbnail_url, caption, cta, tweaks,
        video_tweaks, graphic_tweaks, caption_tweaks,
        linear_issue_id, graphic_linear_issue_id,
        video_deliverable_id, graphic_deliverable_id
      ) values (
        v_client_slug,
        v_card->>'id',
        coalesce(v_card->>'updated_at', ''),
        (v_order_base + v_index + 1)::text,
        '',
        v_card->>'name',
        coalesce(v_card->>'status', 'In Progress'),
        coalesce(v_card->>'video_status', 'In Progress'),
        coalesce(v_card->>'graphic_status', 'In Progress'),
        coalesce(v_card->>'caption_status', 'In Progress'),
        coalesce(v_card->>'asset_url', ''),
        coalesce(v_card->>'thumbnail_url', ''),
        coalesce(v_card->>'caption', ''),
        coalesce(v_card->>'cta', ''),
        coalesce(v_card->>'tweaks', ''),
        coalesce(v_card->>'video_tweaks', ''),
        coalesce(v_card->>'graphic_tweaks', ''),
        coalesce(v_card->>'caption_tweaks', ''),
        coalesce(v_card->>'linear_issue_id', ''),
        coalesce(v_card->>'graphic_linear_issue_id', ''),
        v_video_id,
        v_graphic_id
      );
      select to_jsonb(c.*) into v_current_card
      from public.calendar_posts c
      where c.client = v_client_slug and c.id = v_card->>'id';
    end if;
    v_cards_out := v_cards_out || jsonb_build_array(v_current_card);
  end loop;

  if v_replay then
    v_rows_out := '[]'::jsonb;
    for v_index in 0..v_count - 1
    loop
      v_row := v_rows->v_index;
      select d.* into v_item from public.deliverables d where d.id = v_row->>'id';
      select c.name into v_title
      from public.calendar_posts c
      where c.client = v_client_slug and c.id = v_row->>'card_id';
      if not found
         or v_item.batch_id is distinct from v_batch_id
         or v_item.client_slug is distinct from v_client_slug
         or v_item.team is distinct from v_row->>'team'
         or v_item.kind is distinct from v_row->>'kind'
         or v_item.origin is distinct from 'calendar'
         or v_item.card_id is distinct from v_row->>'card_id'
         or v_item.title is distinct from v_title then
        raise exception 'idempotent_result_missing';
      end if;
      v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_item));
    end loop;
  end if;

  return jsonb_build_object(
    'batch', to_jsonb(v_batch),
    'items', v_rows_out,
    'cards', v_cards_out,
    'mode', v_mode,
    'replay', v_replay
  );
end;
$fn$;

revoke all on function public.production_intake_commit(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.production_intake_commit(
  text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz
) to service_role;

-- A pre-v4 browser may already hold a durable native intake result whose card
-- was not materialised before F133. The strict linked-card trigger must remain
-- closed during migration-first rollout, so recovery crosses this one narrow
-- service-only adopter instead of reopening calendar-upsert. The caller names
-- only the original request and deterministic card; every client, batch,
-- title, deliverable, provider link, and placement value is derived under lock
-- from the exact committed create intents.
create or replace function public.production_intake_card_adopt(
  p_request_id text,
  p_card_id text,
  p_actor_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request_id text := nullif(btrim(coalesce(p_request_id, '')), '');
  v_card_id text := nullif(btrim(coalesce(p_card_id, '')), '');
  v_actor_key text := nullif(btrim(coalesce(p_actor_key, '')), '');
  v_contract jsonb;
  v_item public.deliverables%rowtype;
  v_client_slug text;
  v_batch_id text;
  v_title text;
  v_source_at timestamptz;
  v_plan_source_at timestamptz;
  v_video_id text;
  v_graphic_id text;
  v_video_url text := '';
  v_graphic_url text := '';
  v_count integer := 0;
  v_matching integer;
  v_order_base numeric;
  v_current_card jsonb;
  v_rows_out jsonb := '[]'::jsonb;
  v_replayed boolean := false;
begin
  if v_request_id is null
     or v_request_id !~ '^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$'
     or v_card_id is null
     or v_actor_key is null
     or length(v_actor_key) > 500 then
    raise exception 'invalid_intake_recovery_payload';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'f133-intake-recover:' || v_request_id || ':' || v_card_id, 0
  ));
  -- The caller intentionally cannot choose a client. Resolve the one
  -- receipt-owned client, then evaluate the same contract as the trigger.
  select min(d.client_slug) into v_client_slug
  from public.deliverables d
  where d.origin = 'calendar' and d.card_id = v_card_id;
  v_contract := public.production_intake_v3_card_contract(
    v_client_slug, v_card_id, v_request_id, v_actor_key, null
  );
  if coalesce((v_contract->>'ok')::boolean, false) is not true then
    raise exception 'intake_recovery_identity_invalid';
  end if;
  v_client_slug := null;

  for v_item in
    select d.*
    from public.deliverables d
    where d.origin = 'calendar'
      and d.card_id = v_card_id
      and exists (
        select 1 from public.mirror_outbox o
        where o.entity = 'deliverable'
          and o.entity_id = d.id
          and o.operation = 'create'
          and right(o.dedup_key, length(':' || v_request_id)) = ':' || v_request_id
      )
    order by d.id
    for update
  loop
    v_count := v_count + 1;
    if v_count > 2
       or v_item.created_by is distinct from v_actor_key
       or v_item.team not in ('video', 'graphics')
       or v_item.kind is distinct from (
         case when v_item.team = 'graphics' then 'thumbnail' else 'video' end
       )
       or v_item.client_slug is null
       or v_item.batch_id is null
       or v_item.title is null
       or v_item.title = ''
       or length(v_item.title) > 500
       or v_item.title is distinct from regexp_replace(
         btrim(v_item.title), '[[:space:]]+', ' ', 'g'
       ) then
      raise exception 'intake_recovery_identity_invalid';
    end if;
    if v_client_slug is null then
      v_client_slug := v_item.client_slug;
      v_batch_id := v_item.batch_id;
      v_title := v_item.title;
    elsif v_item.client_slug is distinct from v_client_slug
       or v_item.batch_id is distinct from v_batch_id
       or v_item.title is distinct from v_title then
      raise exception 'intake_recovery_identity_invalid';
    end if;
    select count(*)::integer, min(o.source_edited_at)
      into v_matching, v_source_at
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_item.id
      and o.deliverable_id = v_item.id
      and o.batch_id = v_item.batch_id
      and o.comment_id is null
      and o.operation = 'create'
      and o.op = 'create'
      and o.client_slug = v_item.client_slug
      and o.team = v_item.team
      and right(o.dedup_key, length(':' || v_request_id)) = ':' || v_request_id
      and o.payload->>'title' = v_item.title
      and nullif(btrim(o.payload->>'_intent_fingerprint'), '') is not null;
    if v_matching <> 1 or v_source_at is null then
      raise exception 'intake_recovery_identity_invalid';
    end if;
    if v_plan_source_at is null then
      v_plan_source_at := v_source_at;
    elsif v_source_at is distinct from v_plan_source_at then
      raise exception 'intake_recovery_identity_invalid';
    end if;
    if v_item.team = 'video' then
      if v_video_id is not null then raise exception 'intake_recovery_identity_invalid'; end if;
      v_video_id := v_item.id;
      v_video_url := coalesce(v_item.linear_issue_url, '');
    else
      if v_graphic_id is not null then raise exception 'intake_recovery_identity_invalid'; end if;
      v_graphic_id := v_item.id;
      v_graphic_url := coalesce(v_item.linear_issue_url, '');
    end if;
    v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_item));
  end loop;
  if v_count < 1
     or not exists (
       select 1 from public.clients c
       where c.slug = v_client_slug and c.active is true
     ) then
    raise exception 'intake_recovery_identity_invalid';
  end if;

  select to_jsonb(c.*) into v_current_card
  from public.calendar_posts c
  where c.client = v_client_slug and c.id = v_card_id
  for update;
  if found then
    v_replayed := true;
    if v_current_card->>'name' is distinct from v_title
       or nullif(btrim(v_current_card->>'video_deliverable_id'), '') is distinct from v_video_id
       or nullif(btrim(v_current_card->>'graphic_deliverable_id'), '') is distinct from v_graphic_id
       or coalesce(v_current_card->>'linear_issue_id', '') is distinct from v_video_url
       or coalesce(v_current_card->>'graphic_linear_issue_id', '') is distinct from v_graphic_url then
      raise exception 'intake_recovery_identity_invalid';
    end if;
  else
    perform pg_advisory_xact_lock(hashtextextended(
      'f133-calendar-order:' || v_client_slug, 0
    ));
    select coalesce(max(btrim(c.order_index)::numeric), 0)
      into v_order_base
    from public.calendar_posts c
    where c.client = v_client_slug
      and btrim(coalesce(c.order_index, ''))
        ~ '^[+-]?[0-9]+([.][0-9]+)?$';
    perform set_config('app.f133_canonical_title_write', '1', true);
    insert into public.calendar_posts (
      client, id, updated_at, order_index, scheduled_date, name,
      status, video_status, graphic_status, caption_status,
      asset_url, thumbnail_url, caption, cta, tweaks,
      video_tweaks, graphic_tweaks, caption_tweaks,
      linear_issue_id, graphic_linear_issue_id,
      video_deliverable_id, graphic_deliverable_id
    ) values (
      v_client_slug, v_card_id,
      to_char(v_plan_source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      (v_order_base + 1)::text, '', v_title,
      'In Progress', 'In Progress', 'In Progress', 'In Progress',
      '', '', '', '', '', '', '', '',
      v_video_url, v_graphic_url, v_video_id, v_graphic_id
    );
    select to_jsonb(c.*) into v_current_card
    from public.calendar_posts c
    where c.client = v_client_slug and c.id = v_card_id;
  end if;
  return jsonb_build_object(
    'card', v_current_card,
    'rows', v_rows_out,
    'replayed', v_replayed
  );
end;
$fn$;

revoke all on function public.production_intake_card_adopt(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.production_intake_card_adopt(text, text, text)
  to service_role;

-- Linear-authoritative inbound title changes are also canonical card changes.
-- The source issue is never echoed. Each opposite linked deliverable receives
-- one asynchronous title intent using its current authority lane, with the
-- same exact pending-create dependency contract as browser title writes.
create or replace function public.production_canonical_title_from_linear(
  p_request jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_request jsonb := coalesce(p_request, '{}'::jsonb);
  v_source_id text := nullif(btrim(v_request->>'source_deliverable_id'), '');
  v_source_issue_uuid text := nullif(btrim(v_request->>'source_issue_uuid'), '');
  v_source_identifier text := nullif(btrim(v_request->>'source_identifier'), '');
  v_source_issue_url text := nullif(btrim(v_request->>'source_issue_url'), '');
  v_delivery_id text := nullif(btrim(v_request->>'delivery_id'), '');
  v_title text := regexp_replace(
    btrim(coalesce(v_request->>'title', '')), '[[:space:]]+', ' ', 'g'
  );
  v_source_at timestamptz;
  v_card_current_at timestamptz;
  v_card_committed_at timestamptz;
  v_source public.deliverables%rowtype;
  v_linked public.deliverables%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_create_dependency public.mirror_outbox%rowtype;
  v_origin text;
  v_client_slug text;
  v_card_id text;
  v_batch_id text;
  v_current_card jsonb;
  v_current_name text;
  v_current_revision bigint;
  v_card_committed_revision bigint;
  v_ids text[];
  v_video_id text;
  v_graphic_id text;
  v_count integer;
  v_matching integer;
  v_source_auth jsonb;
  v_dest_auth jsonb;
  v_client_kind text;
  v_test_only boolean := false;
  v_legacy_parity boolean;
  v_generation bigint;
  v_dependency_id bigint;
  v_dedup text;
  v_fingerprint text;
  v_plan jsonb := '[]'::jsonb;
  v_plan_item jsonb;
  v_outbox_id bigint;
  v_outbox_ids jsonb := '[]'::jsonb;
  v_outbox_count integer := 0;
  v_event_id bigint;
  v_event_key text := 'linear-inbound:title:' || coalesce(v_delivery_id, '');
  v_existing_event public.deliverable_events%rowtype;
  v_latest_title_at timestamptz;
  v_latest_title_is_inbound boolean;
  v_latest_title_token text;
  v_event_outbox_count integer;
  v_event_noop boolean;
  v_event_test_only boolean;
  v_event_from_revision bigint;
  v_event_title_revision bigint;
  v_rows_out jsonb := '[]'::jsonb;
  v_replayed boolean := false;
  v_noop boolean := false;
  v_superseded boolean := false;
  v_stale boolean := false;
begin
  if jsonb_typeof(v_request) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(v_request)) <> 7
     or exists (
       select 1 from jsonb_object_keys(v_request) key
       where key <> all (array[
         'source_deliverable_id', 'source_issue_uuid', 'source_identifier',
         'source_issue_url', 'delivery_id', 'source_edited_at', 'title'
       ]::text[])
     )
     or v_source_id is null or v_source_issue_uuid is null
     or v_source_identifier is null or v_source_issue_url is null
     or v_delivery_id is null or length(v_delivery_id) > 500
     or v_title = '' or length(v_title) > 500
     or v_title ~* '^(video|graphics?)[[:space:]]+[0-9]+$'
     or v_title ~ '[[:cntrl:]]' then
    raise exception 'invalid_linear_canonical_title_payload';
  end if;
  begin
    v_source_at := nullif(v_request->>'source_edited_at', '')::timestamptz;
  exception when others then
    raise exception 'invalid_linear_canonical_title_payload';
  end;
  if v_source_at is null then raise exception 'invalid_linear_canonical_title_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_event_key, 0));

  select d.* into v_source from public.deliverables d
  where d.id = v_source_id;
  if not found
     or v_source.linear_issue_uuid is distinct from v_source_issue_uuid
     or v_source.linear_identifier is distinct from v_source_identifier
     or v_source.linear_issue_url is distinct from v_source_issue_url
     or v_source.team not in ('video', 'graphics')
     or v_source.origin not in ('calendar', 'samples')
     or v_source.card_id is null then
    raise exception 'linear_canonical_title_source_invalid';
  end if;
  v_origin := v_source.origin;
  v_client_slug := v_source.client_slug;
  v_card_id := v_source.card_id;
  v_batch_id := v_source.batch_id;
  -- Use the same card lock as the browser CAS so two Linear issues and a UI
  -- edit cannot acquire sibling rows in conflicting orders.
  perform pg_advisory_xact_lock(hashtextextended(
    'production-title:' || v_origin || ':' || v_client_slug || ':' || v_card_id,
    0
  ));
  if v_origin = 'calendar' then
    select to_jsonb(c.*) into v_current_card from public.calendar_posts c
    where c.client = v_client_slug and c.id = v_card_id for update;
  else
    select to_jsonb(c.*) into v_current_card from public.sample_reviews c
    where c.client = v_client_slug and c.id = v_card_id for update;
  end if;
  if not found then raise exception 'linear_canonical_title_linkage_invalid'; end if;
  v_current_name := v_current_card->>'name';
  begin
    v_current_revision := (v_current_card->>'title_revision')::bigint;
  exception when others then
    raise exception 'linear_canonical_title_revision_invalid';
  end;
  if v_current_revision < 0 then raise exception 'linear_canonical_title_revision_invalid'; end if;
  v_video_id := nullif(btrim(v_current_card->>'video_deliverable_id'), '');
  v_graphic_id := nullif(btrim(v_current_card->>'graphic_deliverable_id'), '');
  v_ids := array_remove(array[v_video_id, v_graphic_id], null);
  v_count := cardinality(v_ids);
  if v_count < 1 or v_count > 2
     or not (v_source_id = any(v_ids))
     or v_count <> (select count(*) from (select distinct unnest(v_ids) id) exact_ids)
     or exists (
       select 1 from public.deliverables d
       where d.client_slug = v_client_slug and d.origin = v_origin
         and d.card_id = v_card_id and not d.id = any(v_ids)
     ) then
    raise exception 'linear_canonical_title_linkage_invalid';
  end if;
  for v_linked in
    select d.* from public.deliverables d
    where d.id = any(v_ids) order by d.id for update
  loop
    if v_linked.client_slug is distinct from v_client_slug
       or v_linked.batch_id is distinct from v_batch_id
       or v_linked.origin is distinct from v_origin
       or v_linked.card_id is distinct from v_card_id
       or (v_linked.id = v_video_id and (
         v_linked.team is distinct from 'video' or v_linked.kind is distinct from 'video'
       ))
       or (v_linked.id = v_graphic_id and (
         v_linked.team is distinct from 'graphics' or v_linked.kind is distinct from 'thumbnail'
       )) then
      raise exception 'linear_canonical_title_linkage_invalid';
    end if;
    if v_linked.id = v_source_id then v_source := v_linked; end if;
    v_rows_out := v_rows_out || jsonb_build_array(to_jsonb(v_linked));
  end loop;
  if jsonb_array_length(v_rows_out) <> v_count then
    raise exception 'linear_canonical_title_linkage_invalid';
  end if;
  if v_source.linear_issue_uuid is distinct from v_source_issue_uuid
     or v_source.linear_identifier is distinct from v_source_identifier
     or v_source.linear_issue_url is distinct from v_source_issue_url then
    raise exception 'linear_canonical_title_source_invalid';
  end if;

  -- Exact replay is a readback of the original accepted inbound delivery and
  -- therefore precedes current authority/parity checks.
  select e.* into v_existing_event from public.deliverable_events e
  where e.event_key = v_event_key;
  if found then
    begin
      v_event_outbox_count := (v_existing_event.payload->>'outbox_count')::integer;
      v_event_noop := (v_existing_event.payload->>'noop')::boolean;
      v_event_test_only := (v_existing_event.payload->>'test_only')::boolean;
      v_event_from_revision := (v_existing_event.payload->>'from_title_revision')::bigint;
      v_event_title_revision := (v_existing_event.payload->>'title_revision')::bigint;
    exception when others then
      raise exception 'idempotent_result_missing';
    end;
    if v_event_outbox_count not in (0, v_count - 1)
       or (v_event_noop and v_event_outbox_count <> 0)
       or (not v_event_noop and v_event_outbox_count <> v_count - 1)
       or v_event_from_revision < 0
       or (v_event_noop and v_event_title_revision <> v_event_from_revision)
       or (not v_event_noop and v_event_title_revision <> v_event_from_revision + 1) then
      raise exception 'idempotent_result_missing';
    end if;
    if v_existing_event.deliverable_id is not null
       or v_existing_event.batch_id is distinct from v_batch_id
       or v_existing_event.client_slug is distinct from v_client_slug
       or v_existing_event.ts is distinct from v_source_at
       or v_existing_event.actor is distinct from 'Linear inbound'
       or v_existing_event.role is distinct from 'system'
       or v_existing_event.action is distinct from 'title_change'
       or v_existing_event.from_status is not null
       or v_existing_event.to_status is not null
       or v_existing_event.source is distinct from 'mirror'
       or (v_existing_event.payload - 'from_title'
             - 'from_title_revision' - 'title_revision')
          is distinct from jsonb_build_object(
         'surface', v_origin,
         'card_id', v_card_id,
         'title', v_title,
         'source_deliverable_id', v_source_id,
         'source_issue_uuid', v_source_issue_uuid,
         'source_identifier', v_source_identifier,
         'source_issue_url', v_source_issue_url,
         'delivery_id', v_delivery_id,
         'deliverable_count', v_count,
         'outbox_count', v_event_outbox_count,
         'noop', v_event_noop,
         'test_only', v_event_test_only
       ) then
      raise exception 'idempotent_result_missing';
    end if;
    if v_event_outbox_count > 0 then
      for v_linked in
        select d.* from public.deliverables d
        where d.id = any(v_ids) and d.id <> v_source_id order by d.id
      loop
        v_dedup := 'linear-inbound:title:' || v_delivery_id || ':' || v_linked.id;
        select o.* into v_dependency from public.mirror_outbox o
        where o.dedup_key = v_dedup;
        if not found
           or v_dependency.entity is distinct from 'deliverable'
           or v_dependency.entity_id is distinct from v_linked.id
           or v_dependency.deliverable_id is distinct from v_linked.id
           or v_dependency.batch_id is distinct from v_batch_id
           or v_dependency.comment_id is not null
           or v_dependency.operation is distinct from 'title'
           or v_dependency.op is distinct from 'update_fields'
           or v_dependency.client_slug is distinct from v_client_slug
           or v_dependency.team is distinct from v_linked.team
           or v_dependency.source_edited_at is distinct from v_source_at
           or v_dependency.actor is distinct from 'Linear inbound'
           or v_dependency.role is distinct from 'system'
           or v_dependency.test_only is distinct from v_event_test_only
           or (v_event_test_only and v_dependency.legacy_parity is distinct from false)
           or v_dependency.payload->>'title' is distinct from v_title
           or nullif(btrim(v_dependency.payload->>'_intent_fingerprint'), '') is null then
          raise exception 'idempotent_result_missing';
        end if;
        if not public.production_canonical_title_dependency_valid(v_dependency.id) then
          raise exception 'idempotent_result_missing';
        end if;
        v_outbox_count := v_outbox_count + 1;
        v_outbox_ids := v_outbox_ids || jsonb_build_array(v_dependency.id);
      end loop;
    elsif exists (
      select 1 from public.mirror_outbox o
      where left(
        o.dedup_key,
        length('linear-inbound:title:' || v_delivery_id || ':')
      ) = 'linear-inbound:title:' || v_delivery_id || ':'
    ) then
      raise exception 'idempotent_result_missing';
    end if;
    if v_outbox_count <> v_event_outbox_count then raise exception 'idempotent_result_missing'; end if;
    v_replayed := true;
    v_event_id := v_existing_event.id;
    v_superseded := v_current_name is distinct from v_title
      or v_current_revision is distinct from v_event_title_revision;
    return jsonb_build_object(
      'ok', true, 'source_deliverable_id', v_source_id, 'title', v_title,
      'linked_deliverable_count', v_count, 'outbox_count', v_outbox_count,
      'event_id', v_event_id, 'event_key', v_event_key,
      'outbox_ids', v_outbox_ids, 'card', v_current_card, 'rows', v_rows_out,
      'replayed', v_replayed, 'noop', v_event_noop,
      'superseded', v_superseded, 'stale', false,
      'from_title_revision', v_event_from_revision,
      'title_revision', v_event_title_revision,
      'current_title_revision', v_current_revision,
      'test_only', v_event_test_only
    );
  end if;

  v_source_auth := public.track_b_f27_write_authorization(v_source.team);
  select c.kind into v_client_kind
  from public.clients c where c.slug = v_client_slug and c.active is true;
  if not found then
    raise exception 'active_client_required';
  end if;
  v_test_only := v_client_kind = 'test';
  if not v_test_only and v_source_auth->>'authority' is distinct from 'linear' then
    raise exception 'linear_canonical_title_source_not_authoritative';
  end if;
  -- Order all accepted title sources by provider time and a deterministic
  -- delivery token. UI events win an exact timestamp tie. A late webhook is a
  -- bounded stale receipt and cannot regress either visible or raw truth.
  select e.ts,
         coalesce((
           e.source = 'mirror'
           and e.actor = 'Linear inbound'
           and e.role = 'system'
           and nullif(e.payload->>'delivery_id', '') is not null
         ), false),
         coalesce(e.payload->>'delivery_id', '')
    into v_latest_title_at, v_latest_title_is_inbound, v_latest_title_token
  from public.deliverable_events e
  where e.client_slug = v_client_slug
    and e.batch_id = v_batch_id
    and e.action = 'title_change'
    and e.payload->>'surface' = v_origin
    and e.payload->>'card_id' = v_card_id
  order by e.ts desc,
    not coalesce((
      e.source = 'mirror'
      and e.actor = 'Linear inbound'
      and e.role = 'system'
      and nullif(e.payload->>'delivery_id', '') is not null
    ), false) desc,
    coalesce(e.payload->>'delivery_id', '') collate "C" desc,
    e.id desc
  limit 1;
  if found and (
    v_source_at < v_latest_title_at
    or (v_source_at = v_latest_title_at and (
      not v_latest_title_is_inbound
      or v_delivery_id collate "C" <= v_latest_title_token collate "C"
    ))
  ) then
    v_stale := true;
    return jsonb_build_object(
      'ok', true, 'source_deliverable_id', v_source_id, 'title', v_title,
      'current_title', v_current_name,
      'linked_deliverable_count', v_count, 'outbox_count', 0,
      'event_id', null, 'event_key', null, 'outbox_ids', '[]'::jsonb,
      'card', v_current_card, 'rows', v_rows_out,
      'replayed', false, 'noop', true, 'superseded', true, 'stale', v_stale,
      'from_title_revision', null, 'title_revision', null,
      'current_title_revision', v_current_revision,
      'test_only', v_test_only
    );
  end if;
  if v_current_name is not distinct from v_title and not exists (
    select 1 from public.deliverables d
    where d.id = any(v_ids) and d.title is distinct from v_title
  ) then
    v_noop := true;
  end if;

  -- Validate every opposite-side mirror intent before changing either store.
  for v_linked in
    select d.* from public.deliverables d
    where not v_noop and d.id = any(v_ids) and d.id <> v_source_id order by d.id
  loop
    v_dest_auth := public.track_b_f27_write_authorization(v_linked.team);
    v_legacy_parity := not v_test_only and v_dest_auth->>'authority' = 'linear';
    v_generation := nullif(v_dest_auth->>'generation', '')::bigint;
    perform public.production_assert_authority(
      v_client_slug, v_linked.team, v_test_only, v_legacy_parity
    );
    v_dependency_id := null;
    select o.* into v_dependency
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_linked.id
      and o.deliverable_id = v_linked.id
      and o.batch_id = v_linked.batch_id
      and o.comment_id is null
      and o.operation = 'title'
      and o.client_slug = v_client_slug
      and o.team = v_linked.team
      and o.status in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale')
    order by o.id desc
    limit 1;
    if found then
      v_dependency_id := v_dependency.id;
    elsif nullif(btrim(coalesce(
      v_linked.linear_issue_uuid,
      v_linked.linear_raw->'issue'->>'id',
      ''
    )), '') is null then
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.entity = 'deliverable'
        and o.entity_id = v_linked.id
        and o.deliverable_id = v_linked.id
        and o.batch_id = v_linked.batch_id
        and o.comment_id is null
        and o.operation = 'create'
        and o.op = 'create'
        and o.client_slug = v_client_slug
        and o.team = v_linked.team
        and o.test_only is not distinct from v_test_only
        and (not v_test_only or o.legacy_parity is false)
        and o.status in ('pending', 'failed', 'shadow_ok');
      if not found or (
        select count(*) from public.mirror_outbox exact_create
        where exact_create.entity = 'deliverable'
          and exact_create.entity_id = v_linked.id
          and exact_create.operation = 'create'
      ) <> 1 then
        raise exception 'canonical_title_create_dependency_invalid';
      end if;
      v_dependency_id := v_dependency.id;
    end if;
    v_dedup := 'linear-inbound:title:' || v_delivery_id || ':' || v_linked.id;
    v_fingerprint := encode(sha256(convert_to(
      concat_ws('|', 'linear-inbound-title', v_delivery_id, v_source_id,
        v_source_issue_uuid, v_linked.id, v_title, v_source_at::text,
        v_generation::text, v_legacy_parity::text,
        v_test_only::text, coalesce(v_dependency_id::text, '')),
      'UTF8'
    )), 'hex');
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'deliverable_id', v_linked.id,
      'team', v_linked.team,
      'generation', v_generation,
      'legacy_parity', v_legacy_parity,
      'test_only', v_test_only,
      'dependency_id', v_dependency_id,
      'dedup_key', v_dedup,
      'fingerprint', v_fingerprint
    ));
  end loop;

  perform set_config('app.event_written', '1', true);
  perform set_config('app.f133_canonical_title_write', '1', true);
  if not v_noop then
    begin
      v_card_current_at := nullif(v_current_card->>'updated_at', '')::timestamptz;
    exception when others then
      v_card_current_at := null;
    end;
    v_card_committed_at := greatest(
      clock_timestamp(),
      coalesce(v_card_current_at + interval '1 millisecond', '-infinity'::timestamptz)
    );
    v_card_committed_revision := v_current_revision + 1;
  else
    v_card_committed_revision := v_current_revision;
  end if;
  -- The generic inbound metadata write deliberately preserves canonical title
  -- raw fields. Advance them here only after this card-wide ordering decision.
  update public.deliverables d
  set linear_raw = jsonb_set(
    jsonb_set(
      coalesce(d.linear_raw, '{}'::jsonb),
      '{issue}',
      coalesce(d.linear_raw->'issue', '{}'::jsonb)
        || jsonb_build_object('title', v_title),
      true
    ),
    '{field_updated_at}',
    coalesce(d.linear_raw->'field_updated_at', '{}'::jsonb)
      || jsonb_build_object('title', to_char(
        v_source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )),
    true
  )
  where d.id = v_source_id;
  -- Keep the title write last among deliverable updates. The existing shared
  -- timestamp trigger may use a transaction clock for the raw metadata write;
  -- the title-only `zz_*` trigger then guarantees the final CAS cursor is newer.
  if not v_noop then
    update public.deliverables d
    set title = v_title,
        updated_at = greatest(
          clock_timestamp(),
          d.updated_at + interval '1 millisecond'
        )
    where d.id = any(v_ids);
  end if;
  if not v_noop and v_origin = 'calendar' then
    update public.calendar_posts c
    set name = v_title,
        title_revision = v_card_committed_revision,
        updated_at = to_char(v_card_committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where c.client = v_client_slug and c.id = v_card_id
    returning to_jsonb(c.*) into v_current_card;
  elsif not v_noop then
    update public.sample_reviews c
    set name = v_title,
        title_revision = v_card_committed_revision,
        updated_at = to_char(v_card_committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where c.client = v_client_slug and c.id = v_card_id
    returning to_jsonb(c.*) into v_current_card;
  end if;
  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload, event_key
  ) values (
    null, v_batch_id, v_client_slug, v_source_at,
    'Linear inbound', 'system', 'title_change', null, null, 'mirror',
    jsonb_build_object(
      'surface', v_origin, 'card_id', v_card_id,
      'from_title', v_current_name,
      'from_title_revision', v_current_revision,
      'title', v_title,
      'title_revision', v_card_committed_revision,
      'source_deliverable_id', v_source_id,
      'source_issue_uuid', v_source_issue_uuid,
      'source_identifier', v_source_identifier,
      'source_issue_url', v_source_issue_url,
      'delivery_id', v_delivery_id,
      'deliverable_count', v_count,
      'outbox_count', case when v_noop then 0 else v_count - 1 end,
      'noop', v_noop,
      'test_only', v_test_only
    ),
    v_event_key
  ) returning id into v_event_id;
  for v_plan_item in select value from jsonb_array_elements(v_plan)
  loop
    select d.* into v_linked from public.deliverables d
    where d.id = v_plan_item->>'deliverable_id';
    v_outbox_id := public.mirror_outbox_enqueue(
      p_entity := 'deliverable', p_entity_id := v_linked.id,
      p_operation := 'title',
      p_payload := jsonb_build_object(
        'title', v_title,
        '_intent_fingerprint', v_plan_item->>'fingerprint',
        '_f27_authority_generation', (v_plan_item->>'generation')::bigint,
        '_f27_legacy_parity', (v_plan_item->>'legacy_parity')::boolean
      ),
      p_dedup_key := v_plan_item->>'dedup_key',
      p_source_edited_at := v_source_at,
      p_client_slug := v_client_slug, p_team := v_linked.team,
      p_actor := 'Linear inbound', p_role := 'system',
      p_deliverable_id := v_linked.id, p_batch_id := v_batch_id,
      p_comment_id := null,
      p_depends_on_id := nullif(v_plan_item->>'dependency_id', '')::bigint,
      p_test_only := (v_plan_item->>'test_only')::boolean
    );
    if v_outbox_id is null then raise exception 'linear_canonical_title_outbox_missing'; end if;
    if not public.production_canonical_title_dependency_valid(v_outbox_id) then
      raise exception 'canonical_title_dependency_chain_invalid';
    end if;
    v_outbox_count := v_outbox_count + 1;
    v_outbox_ids := v_outbox_ids || jsonb_build_array(v_outbox_id);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(d.*) order by d.id), '[]'::jsonb)
    into v_rows_out from public.deliverables d where d.id = any(v_ids);
  return jsonb_build_object(
    'ok', true, 'source_deliverable_id', v_source_id, 'title', v_title,
    'linked_deliverable_count', v_count, 'outbox_count', v_outbox_count,
    'event_id', v_event_id, 'event_key', v_event_key,
    'outbox_ids', v_outbox_ids, 'card', v_current_card, 'rows', v_rows_out,
    'replayed', false, 'noop', v_noop, 'superseded', false, 'stale', false,
    'from_title_revision', v_current_revision,
    'title_revision', v_card_committed_revision,
    'current_title_revision', v_card_committed_revision,
    'test_only', v_test_only
  );
end;
$fn$;

revoke all on function public.production_canonical_title_from_linear(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.production_canonical_title_from_linear(jsonb)
  to service_role;

-- Authenticated gateway title mutation. The card's visible base value and the
-- exact base value of every linked deliverable form the CAS. One transaction
-- updates both stores, emits one card-scoped event, and enqueues one durable
-- asynchronous title intent for each linked team. The first request owns the
-- event/outbox identities; a lost response replays without a second mutation.
create or replace function public.production_canonical_title_write(
  p_card jsonb,
  p_event jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_card_request jsonb := coalesce(p_card, '{}'::jsonb);
  v_event jsonb := coalesce(p_event, '{}'::jsonb);
  v_repair jsonb := coalesce(p_card->'repair', '{}'::jsonb);
  v_is_repair boolean := p_card ? 'repair';
  v_outbounds jsonb := coalesce(v_card_request->'outbounds', '[]'::jsonb);
  v_expected_titles jsonb := coalesce(v_card_request->'expected_deliverable_titles', '{}'::jsonb);
  v_identity_surface text := lower(nullif(btrim(v_card_request->>'surface'), ''));
  v_surface text := v_identity_surface;
  v_origin text;
  v_client_slug text := nullif(btrim(v_card_request->>'client_slug'), '');
  v_card_id text := nullif(btrim(v_card_request->>'card_id'), '');
  v_expected_title text;
  v_title text := regexp_replace(btrim(coalesce(v_card_request->>'title', '')), '[[:space:]]+', ' ', 'g');
  v_current_card jsonb;
  v_current_name text;
  v_current_cas_title text;
  v_current_revision bigint;
  v_expected_revision bigint;
  v_committed_revision bigint;
  v_video_id text;
  v_graphic_id text;
  v_ids text[];
  v_deliverable public.deliverables%rowtype;
  v_deliverables_out jsonb := '[]'::jsonb;
  v_outbound jsonb;
  v_payload jsonb;
  v_actor text := nullif(btrim(v_event->>'actor'), '');
  v_actor_key text := nullif(btrim(v_event->>'actor_key'), '');
  v_role text := lower(nullif(btrim(v_event->>'role'), ''));
  v_auth_kind text := lower(nullif(btrim(v_event->>'auth_kind'), ''));
  v_event_key text := nullif(btrim(v_event->>'event_key'), '');
  v_source_edited_at timestamptz;
  v_committed_at timestamptz;
  v_outbound_source_at timestamptz;
  v_team text;
  v_dedup text;
  v_fingerprint text;
  v_generation bigint;
  v_bound_parity boolean;
  v_legacy_parity boolean;
  v_test_only boolean;
  v_replay_count integer := 0;
  v_outbox_count integer := 0;
  v_outbox_id bigint;
  v_existing_outbox public.mirror_outbox%rowtype;
  v_dependency public.mirror_outbox%rowtype;
  v_dependency_id bigint;
  v_outbox_ids jsonb := '[]'::jsonb;
  v_event_id bigint;
  v_batch_id text;
  v_index integer;
  v_count integer;
  v_all_target boolean := true;
  v_deliverable_cas_matches boolean := true;
  v_superseded boolean := false;
  v_replay boolean;
begin
  if v_surface = 'calendar' then
    v_origin := 'calendar';
  elsif v_surface in ('samples', 'sxr') then
    v_surface := 'samples';
    v_origin := 'samples';
  else
    raise exception 'invalid_canonical_title_surface';
  end if;
  if v_client_slug is null or v_card_id is null
     or not (v_card_request ? 'expected_title')
     or jsonb_typeof(v_card_request->'expected_title_revision') is distinct from 'number'
     or coalesce(v_card_request->>'expected_title_revision', '') !~ '^(0|[1-9][0-9]*)$'
     or v_title = '' or length(v_title) > 500
     or v_title ~* '^(video|graphics?)[[:space:]]+[0-9]+$'
     or jsonb_typeof(v_expected_titles) is distinct from 'object'
     or jsonb_typeof(v_outbounds) is distinct from 'array'
     or v_actor is null or v_actor_key is null
     or not (
       (v_auth_kind = 'staff' and v_role in ('admin', 'smm')
         and v_actor_key like 'member:%' and length(v_actor_key) > 7)
       or (v_auth_kind = 'test' and v_role = 'admin'
         and v_actor_key = 'test:production-write')
       or (v_auth_kind = 'client' and v_role = 'client' and v_surface = 'calendar'
         and v_actor_key = 'client:' || v_client_slug)
     )
     or v_event->>'source' is distinct from 'ui'
     or v_event->>'action' is distinct from 'title_change'
     or v_event->>'surface' is distinct from v_surface
     or v_event->>'from_title' is distinct from v_card_request->>'expected_title'
     or v_event->'from_title_revision' is distinct from v_card_request->'expected_title_revision'
     or v_event->>'to_title' is distinct from v_title
     or coalesce(v_event->'repair', '{}'::jsonb) is distinct from v_repair
     or v_event_key is null or length(v_event_key) > 500 then
    raise exception 'invalid_canonical_title_payload';
  end if;
  if v_is_repair then
    if jsonb_typeof(v_repair) is distinct from 'object'
       or v_identity_surface not in ('calendar', 'sxr')
       or (select count(*) from jsonb_object_keys(v_repair)) <> 5
       or exists (
         select 1 from jsonb_object_keys(v_repair) key
         where key <> all (array[
           'confirmation', 'inventory_sha256', 'plan_digest',
           'identity_sha256', 'request_id'
         ]::text[])
       )
       or v_repair->>'confirmation'
          is distinct from 'APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR'
       or coalesce(v_repair->>'inventory_sha256', '') !~ '^[a-f0-9]{64}$'
       or coalesce(v_repair->>'plan_digest', '') !~ '^[a-f0-9]{64}$'
       or coalesce(v_repair->>'identity_sha256', '') !~ '^[a-f0-9]{64}$'
       or v_repair->>'identity_sha256' is distinct from encode(sha256(convert_to(
         v_identity_surface || chr(0)
           || v_client_slug || chr(0) || v_card_id,
         'UTF8'
       )), 'hex')
       or v_repair->>'request_id' is distinct from (
         'f133-title-repair:' || left(encode(sha256(convert_to(
           v_repair->>'identity_sha256' || ':' || v_repair->>'plan_digest',
           'UTF8'
         )), 'hex'), 32)
       )
       or v_event_key is distinct from (
         'write-ui:title:card:' || v_surface || ':' || v_client_slug || ':'
         || v_card_id || ':' || v_repair->>'request_id'
       )
       or v_auth_kind is distinct from 'staff'
       or v_role is distinct from 'admin'
       or v_actor_key not like 'member:%'
       or not exists (
         select 1 from public.syncview_runtime_flags f
         where f.key = 'f133_canonical_title_enabled'
           and f.value = '{"enabled":false}'::jsonb
       ) then
      raise exception 'invalid_canonical_title_repair_payload';
    end if;
  elsif v_event ? 'repair' then
    raise exception 'invalid_canonical_title_payload';
  end if;
  begin
    v_source_edited_at := nullif(v_event->>'ts', '')::timestamptz;
    v_expected_revision := (v_card_request->>'expected_title_revision')::bigint;
  exception when others then
    raise exception 'invalid_canonical_title_payload';
  end;
  if v_source_edited_at is null then raise exception 'invalid_canonical_title_payload'; end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'production-title:' || v_surface || ':' || v_client_slug || ':' || v_card_id,
    0
  ));
  if v_surface = 'calendar' then
    select to_jsonb(c.*) into v_current_card
    from public.calendar_posts c
    where c.client = v_client_slug and c.id = v_card_id
    for update;
  else
    select to_jsonb(c.*) into v_current_card
    from public.sample_reviews c
    where c.client = v_client_slug and c.id = v_card_id
    for update;
  end if;
  if not found then raise exception 'canonical_title_card_not_found'; end if;

  v_current_name := v_current_card->>'name';
  begin
    v_current_revision := (v_current_card->>'title_revision')::bigint;
  exception when others then
    raise exception 'canonical_title_revision_invalid';
  end;
  if v_current_revision < 0 then raise exception 'canonical_title_revision_invalid'; end if;
  v_current_cas_title := regexp_replace(
    btrim(coalesce(v_current_name, '')), '[[:space:]]+', ' ', 'g'
  );
  v_expected_title := v_card_request->>'expected_title';
  v_video_id := nullif(btrim(v_current_card->>'video_deliverable_id'), '');
  v_graphic_id := nullif(btrim(v_current_card->>'graphic_deliverable_id'), '');
  v_ids := array_remove(array[v_video_id, v_graphic_id], null);
  v_count := cardinality(v_ids);
  if v_count < 1
     or v_count <> (
       select count(*) from (select distinct unnest(v_ids) id) linked
     )
     or v_count <> (select count(*) from jsonb_object_keys(v_expected_titles)) then
    raise exception 'canonical_title_linkage_invalid';
  end if;
  if exists (
    select 1 from jsonb_object_keys(v_expected_titles) expected(id)
    where not expected.id = any(v_ids)
  ) or exists (
    select 1 from public.deliverables d
    where d.client_slug = v_client_slug
      and d.origin = v_origin
      and d.card_id = v_card_id
      and not d.id = any(v_ids)
  ) then
    raise exception 'canonical_title_linkage_invalid';
  end if;

  -- Lock every linked row in one deterministic order before validating any
  -- base value or outbound envelope.
  for v_deliverable in
    select d.* from public.deliverables d
    where d.id = any(v_ids)
    order by d.id
    for update
  loop
    if v_deliverable.client_slug is distinct from v_client_slug
       or v_deliverable.origin is distinct from v_origin
       or v_deliverable.card_id is distinct from v_card_id
       or (v_deliverable.id = v_video_id and (
         v_deliverable.team is distinct from 'video'
         or v_deliverable.kind is distinct from 'video'
       ))
       or (v_deliverable.id = v_graphic_id and (
         v_deliverable.team is distinct from 'graphics'
         or v_deliverable.kind is distinct from 'thumbnail'
       )) then
      raise exception 'canonical_title_linkage_invalid';
    end if;
    if v_batch_id is null then v_batch_id := v_deliverable.batch_id;
    elsif v_batch_id is distinct from v_deliverable.batch_id then
      raise exception 'canonical_title_linkage_invalid';
    end if;
    if v_deliverable.title is distinct from v_expected_titles->>v_deliverable.id then
      v_deliverable_cas_matches := false;
    end if;
    if v_deliverable.title is distinct from v_title then v_all_target := false; end if;
    v_deliverables_out := v_deliverables_out || jsonb_build_array(to_jsonb(v_deliverable));
  end loop;
  if jsonb_array_length(v_deliverables_out) <> v_count then
    raise exception 'canonical_title_linkage_invalid';
  end if;

  -- A caller may omit mirror envelopes only for an already-converged exact
  -- no-op. This path produces no event and no outbox row. Any real mutation or
  -- stale base must provide the complete one-per-linked-row outbound set.
  if jsonb_array_length(v_outbounds) = 0 then
    if v_current_cas_title is distinct from v_expected_title
       or v_current_revision is distinct from v_expected_revision
       or not v_deliverable_cas_matches
       or v_current_name is distinct from v_title
       or not v_all_target then
      raise exception 'invalid_canonical_title_outbound';
    end if;
    if not exists (
      select 1 from public.clients c
      where c.slug = v_client_slug and c.active is true
    ) then
      raise exception 'active_client_required';
    end if;
    if v_auth_kind = 'client' and not exists (
      select 1 from public.calendar_posts settings
      where settings.client = v_client_slug
        and settings.id = 'p_cal_settings'
        and coalesce((settings.caption::jsonb)->>'collab_mode', 'false') = 'true'
    ) then
      raise exception 'canonical_title_client_collab_required';
    end if;
    return jsonb_build_object(
      'card', v_current_card,
      'rows', v_deliverables_out,
      'event_key', null,
      'committed_at', null,
      'outbox_ids', '[]'::jsonb,
      'replayed', false,
      'superseded', false,
      'noop', true
    );
  elsif jsonb_array_length(v_outbounds) <> v_count then
    raise exception 'invalid_canonical_title_outbound';
  end if;

  -- Outbounds are a set keyed by the exact linked deliverable ids. Every
  -- envelope carries the current F27 generation/parity binder; dependency
  -- ordering is derived under the card lock below and cannot be caller-chosen.
  if (
    select count(distinct item->>'entity_id') from jsonb_array_elements(v_outbounds) item
  ) <> v_count
     or (
       select count(distinct nullif(btrim(item->>'dedup_key'), ''))
       from jsonb_array_elements(v_outbounds) item
     ) <> v_count
     or exists (
       select 1 from jsonb_array_elements(v_outbounds) item
       where not (item->>'entity_id' = any(v_ids))
     ) then
    raise exception 'invalid_canonical_title_outbound';
  end if;
  for v_index in 0..v_count - 1
  loop
    v_outbound := v_outbounds->v_index;
    v_payload := coalesce(v_outbound->'payload', '{}'::jsonb);
    select d.* into v_deliverable
    from public.deliverables d where d.id = v_outbound->>'entity_id';
    v_team := v_deliverable.team;
    v_dedup := nullif(btrim(v_outbound->>'dedup_key'), '');
    v_fingerprint := nullif(btrim(v_payload->>'_intent_fingerprint'), '');
    begin
      v_dependency_id := null;
      v_outbound_source_at := nullif(v_outbound->>'source_edited_at', '')::timestamptz;
      v_test_only := coalesce((v_outbound->>'test_only')::boolean, false);
      v_legacy_parity := coalesce((v_outbound->>'legacy_parity')::boolean, false);
      v_generation := nullif(v_payload->>'_f27_authority_generation', '')::bigint;
      v_bound_parity := coalesce((v_payload->>'_f27_legacy_parity')::boolean, false);
    exception when others then
      raise exception 'invalid_canonical_title_outbound';
    end;
    if v_outbound->>'entity' is distinct from 'deliverable'
       or v_outbound->>'operation' is distinct from 'title'
       or v_outbound ? 'depends_on_id'
       or v_outbound->>'team' is distinct from v_team
       or v_dedup is null or v_fingerprint is null
       or v_outbound_source_at is distinct from v_source_edited_at
       or v_payload->>'title' is distinct from v_title
       or v_generation is null or v_generation < 0
       or v_bound_parity is distinct from v_legacy_parity then
      raise exception 'invalid_canonical_title_outbound';
    end if;
    v_replay := public.production_outbox_replay(
      'deliverable', v_deliverable.id, 'title', v_client_slug, v_team,
      v_actor, v_role, v_test_only, v_legacy_parity,
      v_fingerprint, v_dedup
    );
    if v_replay then
      v_replay_count := v_replay_count + 1;
      select o.* into v_existing_outbox
      from public.mirror_outbox o where o.dedup_key = v_dedup;
      if not found
         or v_existing_outbox.entity is distinct from 'deliverable'
         or v_existing_outbox.entity_id is distinct from v_deliverable.id
         or v_existing_outbox.deliverable_id is distinct from v_deliverable.id
         or v_existing_outbox.batch_id is distinct from v_deliverable.batch_id
         or v_existing_outbox.comment_id is not null
         or v_existing_outbox.operation is distinct from 'title'
         or v_existing_outbox.op is distinct from 'update_fields'
         or v_existing_outbox.client_slug is distinct from v_client_slug
         or v_existing_outbox.team is distinct from v_team
         or v_existing_outbox.dedup_key is distinct from v_dedup
         or v_existing_outbox.actor is distinct from v_actor
         or v_existing_outbox.role is distinct from v_role
         or v_existing_outbox.test_only is distinct from v_test_only
         or v_existing_outbox.legacy_parity is distinct from v_legacy_parity
         or v_existing_outbox.authority_generation is distinct from v_generation
         or v_existing_outbox.payload is distinct from (
           v_payload - '_f27_authority_generation' - '_f27_legacy_parity'
          )
         or not public.production_canonical_title_dependency_valid(
           v_existing_outbox.id
         ) then
        raise exception 'idempotent_result_missing';
      end if;
      v_outbox_id := v_existing_outbox.id;
      v_outbox_ids := v_outbox_ids || jsonb_build_array(v_outbox_id);
    end if;
  end loop;

  if v_replay_count > 0 and v_replay_count <> v_count then
    raise exception 'idempotency_conflict';
  end if;
  if v_replay_count = v_count then
    if v_current_name is distinct from regexp_replace(
         btrim(coalesce(v_current_name, '')), '[[:space:]]+', ' ', 'g'
       )
       or (select count(*) from public.deliverables d where d.id = any(v_ids)) <> v_count
       or exists (
         select 1 from public.deliverables d
         where d.id = any(v_ids) and d.title is distinct from v_current_name
       ) then
      raise exception 'idempotent_result_missing';
    end if;
    select e.id, e.ts into v_event_id, v_committed_at
    from public.deliverable_events e
    where e.event_key = v_event_key
      and e.actor is not distinct from v_actor
      and e.role is not distinct from v_role
      and e.deliverable_id is null
      and e.action = 'title_change'
      and e.from_status is null
      and e.to_status is null
      and e.source = 'ui'
      and e.client_slug = v_client_slug
      and e.batch_id = v_batch_id
      and regexp_replace(
        btrim(coalesce(e.payload->>'from_title', '')), '[[:space:]]+', ' ', 'g'
      ) is not distinct from v_expected_title
      and e.payload->>'from_title_revision' = v_expected_revision::text
      and e.payload->>'title_revision' = (v_expected_revision + 1)::text
      and (e.payload - 'from_title' - 'from_title_revision' - 'title_revision')
        is not distinct from jsonb_build_object(
        'surface', v_surface,
        'card_id', v_card_id,
        'title', v_title,
        'client_edited_at', v_source_edited_at,
        'expected_deliverable_titles', v_expected_titles,
        'deliverable_count', v_count,
        'outbox_count', v_count,
        'actor_key', v_actor_key,
        'auth_kind', v_auth_kind
      ) || case when v_is_repair
        then jsonb_build_object('repair', v_repair)
        else '{}'::jsonb end;
    if not found then raise exception 'idempotent_result_missing'; end if;
    v_committed_revision := v_expected_revision + 1;
    if exists (
      select 1
      from public.mirror_outbox o
      where o.id in (
        select value::text::bigint from jsonb_array_elements(v_outbox_ids)
      )
        and o.source_edited_at is distinct from v_committed_at
    ) then
      raise exception 'idempotent_result_missing';
    end if;
    select coalesce(jsonb_agg(to_jsonb(d.*) order by d.id), '[]'::jsonb)
      into v_deliverables_out
    from public.deliverables d where d.id = any(v_ids);
    v_superseded := v_current_name is distinct from v_title
      or v_current_revision is distinct from v_committed_revision;
    return jsonb_build_object(
      'card', v_current_card,
      'rows', v_deliverables_out,
      'event_id', v_event_id,
      'event_key', v_event_key,
      'committed_at', v_committed_at,
      'outbox_ids', v_outbox_ids,
      'replayed', true,
      'superseded', v_superseded,
      'noop', false
    );
  end if;

  -- Only a new mutation is subject to current client/collaboration and
  -- authority posture. An exact durable replay above is a readback of the
  -- original authorized commit, not a new write authorization decision.
  if not exists (
    select 1 from public.clients c
    where c.slug = v_client_slug and c.active is true
  ) then
    raise exception 'active_client_required';
  end if;
  if v_auth_kind = 'client' and not exists (
    select 1 from public.calendar_posts settings
    where settings.client = v_client_slug
      and settings.id = 'p_cal_settings'
      and coalesce((settings.caption::jsonb)->>'collab_mode', 'false') = 'true'
  ) then
    raise exception 'canonical_title_client_collab_required';
  end if;
  for v_index in 0..v_count - 1
  loop
    v_outbound := v_outbounds->v_index;
    perform public.production_assert_authority(
      v_client_slug,
      v_outbound->>'team',
      coalesce((v_outbound->>'test_only')::boolean, false),
      coalesce((v_outbound->>'legacy_parity')::boolean, false)
    );
  end loop;

  if v_current_cas_title is distinct from v_expected_title
     or v_current_revision is distinct from v_expected_revision
     or not v_deliverable_cas_matches then
    raise exception 'canonical_title_write_conflict';
  end if;
  if v_current_name is not distinct from v_title and v_all_target then
    return jsonb_build_object(
      'card', v_current_card,
      'rows', v_deliverables_out,
      'event_key', null,
      'committed_at', null,
      'outbox_ids', '[]'::jsonb,
      'replayed', false,
      'superseded', false,
      'noop', true
    );
  end if;

  perform set_config('app.event_written', '1', true);
  perform set_config('app.f133_canonical_title_write', '1', true);
  -- Browser clocks are evidence for exact request replay, not a safe ordering
  -- clock across an offline UI and delayed provider webhooks. Serialize the
  -- accepted CAS at the database and use that commit clock for the card,
  -- canonical event, and every outbound title intent.
  v_committed_at := clock_timestamp();
  v_committed_revision := v_expected_revision + 1;
  update public.deliverables d
  set title = v_title,
      updated_at = greatest(
        clock_timestamp(),
        d.updated_at + interval '1 millisecond'
      )
  where d.id = any(v_ids);
  if v_surface = 'calendar' then
    update public.calendar_posts c
    set name = v_title,
        title_revision = v_committed_revision,
        updated_at = to_char(v_committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where c.client = v_client_slug and c.id = v_card_id
    returning to_jsonb(c.*) into v_current_card;
  else
    update public.sample_reviews c
    set name = v_title,
        title_revision = v_committed_revision,
        updated_at = to_char(v_committed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    where c.client = v_client_slug and c.id = v_card_id
    returning to_jsonb(c.*) into v_current_card;
  end if;

  insert into public.deliverable_events (
    deliverable_id, batch_id, client_slug, ts, actor, role, action,
    from_status, to_status, source, payload, event_key
  ) values (
    null, v_batch_id, v_client_slug, v_committed_at, v_actor, v_role,
    'title_change', null, null, 'ui',
    jsonb_build_object(
      'surface', v_surface,
      'card_id', v_card_id,
      'from_title', v_current_name,
      'from_title_revision', v_expected_revision,
      'title', v_title,
      'title_revision', v_committed_revision,
      'client_edited_at', v_source_edited_at,
      'expected_deliverable_titles', v_expected_titles,
      'deliverable_count', v_count,
      'outbox_count', v_count,
      'actor_key', v_actor_key,
      'auth_kind', v_auth_kind
    ) || case when v_is_repair
      then jsonb_build_object('repair', v_repair)
      else '{}'::jsonb end,
    v_event_key
  ) returning id into v_event_id;

  for v_index in 0..v_count - 1
  loop
    v_outbound := v_outbounds->v_index;
    v_payload := v_outbound->'payload';
    select d.* into v_deliverable
    from public.deliverables d where d.id = v_outbound->>'entity_id';
    v_test_only := coalesce((v_outbound->>'test_only')::boolean, false);
    v_legacy_parity := coalesce((v_outbound->>'legacy_parity')::boolean, false);
    v_generation := nullif(v_payload->>'_f27_authority_generation', '')::bigint;
    v_dependency_id := null;
    select o.* into v_dependency
    from public.mirror_outbox o
    where o.entity = 'deliverable'
      and o.entity_id = v_deliverable.id
      and o.deliverable_id = v_deliverable.id
      and o.batch_id = v_deliverable.batch_id
      and o.comment_id is null
      and o.operation = 'title'
      and o.client_slug = v_client_slug
      and o.team = v_deliverable.team
      and o.status in ('pending', 'failed', 'shadow_ok', 'written', 'skipped', 'stale')
    order by o.id desc
    limit 1;
    if found then
      v_dependency_id := v_dependency.id;
    elsif nullif(btrim(coalesce(
      v_deliverable.linear_issue_uuid,
      v_deliverable.linear_raw->'issue'->>'id',
      ''
    )), '') is null then
      select o.* into v_dependency
      from public.mirror_outbox o
      where o.entity = 'deliverable'
        and o.entity_id = v_deliverable.id
        and o.deliverable_id = v_deliverable.id
        and o.batch_id = v_deliverable.batch_id
        and o.comment_id is null
        and o.operation = 'create'
        and o.op = 'create'
        and o.client_slug = v_client_slug
        and o.team = v_deliverable.team
        and o.test_only is not distinct from v_test_only
        and o.legacy_parity is not distinct from v_legacy_parity
        and o.authority_generation is not distinct from v_generation
        and o.status in ('pending', 'failed', 'shadow_ok');
      if not found or (
        select count(*) from public.mirror_outbox exact_create
        where exact_create.entity = 'deliverable'
          and exact_create.entity_id = v_deliverable.id
          and exact_create.operation = 'create'
      ) <> 1 then
        raise exception 'canonical_title_create_dependency_invalid';
      end if;
      v_dependency_id := v_dependency.id;
    end if;
    v_outbox_id := public.mirror_outbox_enqueue(
      p_entity := 'deliverable',
      p_entity_id := v_deliverable.id,
      p_operation := 'title',
      p_payload := v_payload,
      p_dedup_key := v_outbound->>'dedup_key',
      p_source_edited_at := v_committed_at,
      p_client_slug := v_client_slug,
      p_team := v_deliverable.team,
      p_actor := v_actor,
      p_role := v_role,
      p_deliverable_id := v_deliverable.id,
      p_batch_id := v_deliverable.batch_id,
      p_comment_id := null,
      p_depends_on_id := v_dependency_id,
      p_test_only := coalesce((v_outbound->>'test_only')::boolean, false)
    );
    if v_outbox_id is null then raise exception 'canonical_title_outbox_missing'; end if;
    if not public.production_canonical_title_dependency_valid(v_outbox_id) then
      raise exception 'canonical_title_dependency_chain_invalid';
    end if;
    v_outbox_count := v_outbox_count + 1;
    v_outbox_ids := v_outbox_ids || jsonb_build_array(v_outbox_id);
  end loop;

  select coalesce(jsonb_agg(to_jsonb(d.*) order by d.id), '[]'::jsonb)
    into v_deliverables_out
  from public.deliverables d where d.id = any(v_ids);
  return jsonb_build_object(
    'card', v_current_card,
    'rows', v_deliverables_out,
    'event_id', v_event_id,
    'event_key', v_event_key,
    'committed_at', v_committed_at,
    'outbox_ids', v_outbox_ids,
    'replayed', false,
    'superseded', false,
    'noop', false
  );
end;
$fn$;

revoke all on function public.production_canonical_title_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_canonical_title_write(jsonb, jsonb)
  to service_role;

commit;

-- OWNER-ONLY EXACT INVERSE. Keep the activation flag exact OFF, deploy/read
-- back the reviewed F133-aware three-function closure, and prove zero open
-- title intents before opening this transaction. Apply this database inverse
-- first; only after it commits restore and independently read back the exact
-- captured pre-F133 linear-inbound, production-write, and linear-outbound
-- closures, in that order. The new inbound falls back safely once this inverse
-- removes the canonical RPC, whereas restoring the old inbound before dropping
-- the guard would strand authoritative Linear title webhooks.
--
-- Do not delete title rows/events, the monotone title_revision columns/checks,
-- or restore the narrower parity CHECK: retained F133 audit evidence must
-- remain valid after behavior rollback. Increment every linked card revision
-- once before dropping the guards. That kill-generation invalidates every
-- pre-inverse browser cursor, even if an old writer later performs A -> B -> A
-- without knowing how to advance the retained revision.
-- begin;
-- do $rollback_guard$
-- begin
--   if not exists (
--     select 1 from public.syncview_runtime_flags
--     where key = 'f133_canonical_title_enabled'
--       and value = '{"enabled":false}'::jsonb
--   ) or exists (
--     select 1 from public.mirror_outbox
--     where operation = 'title'
--       and status in ('pending', 'failed', 'shadow_ok')
--   ) then
--     raise exception 'f133_rollback_precondition_failed';
--   end if;
-- end;
-- $rollback_guard$;
-- select set_config('app.f133_canonical_title_write', '1', true);
-- update public.calendar_posts
-- set title_revision = title_revision + 1
-- where video_deliverable_id is not null or graphic_deliverable_id is not null;
-- update public.sample_reviews
-- set title_revision = title_revision + 1
-- where video_deliverable_id is not null or graphic_deliverable_id is not null;
-- drop trigger if exists production_deliverable_linear_link_projection_after on public.deliverables;
-- drop trigger if exists production_canonical_title_guard_before on public.calendar_posts;
-- drop trigger if exists production_canonical_title_guard_before on public.sample_reviews;
-- drop trigger if exists production_canonical_title_deliverable_guard_before on public.deliverables;
-- drop trigger if exists zz_production_canonical_title_cas_before on public.deliverables;
-- drop function if exists public.production_canonical_title_write(jsonb, jsonb);
-- drop function if exists public.production_canonical_title_from_linear(jsonb);
-- drop function if exists public.production_intake_card_adopt(text, text, text);
-- drop function if exists public.production_intake_commit(text, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz);
-- drop function if exists public.production_canonical_title_acknowledge(bigint, jsonb);
-- drop function if exists public.production_canonical_title_binder_adopt(jsonb);
-- drop function if exists public.production_canonical_title_dependency_resolve(bigint);
-- drop function if exists public.production_canonical_title_dependency_valid(bigint);
-- drop function if exists public.production_deliverable_linear_link_projection();
-- drop function if exists public.production_canonical_title_card_guard();
-- drop function if exists public.production_intake_v3_card_contract(text, text, text, text, jsonb);
-- drop function if exists public.production_canonical_title_deliverable_guard();
-- drop function if exists public.production_canonical_title_cas_guard();
-- drop function public.production_intake_append(text, timestamptz, jsonb, jsonb);
-- alter function public.production_intake_append_v3(text, timestamptz, jsonb, jsonb)
--   rename to production_intake_append;
-- revoke all on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
--   from public, anon, authenticated;
-- grant execute on function public.production_intake_append(text, timestamptz, jsonb, jsonb)
--   to service_role;
-- drop function public.production_issue_create_linkage(text, bigint, jsonb, jsonb);
-- alter function public.production_issue_create_linkage_pre_f133(text, bigint, jsonb, jsonb)
--   rename to production_issue_create_linkage;
-- revoke all on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
--   from public, anon, authenticated;
-- grant execute on function public.production_issue_create_linkage(text, bigint, jsonb, jsonb)
--   to service_role;
-- commit;
