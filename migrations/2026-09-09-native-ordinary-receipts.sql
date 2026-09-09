-- Dormant by default.  This is the common-mutation native receipt contract
-- required before SyncView retirement admission may be activated.
begin;

do $preflight$
begin
  if to_regclass('public.mirror_outbox') is null
     or to_regclass('public.syncview_runtime_flags') is null
     or to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)') is null
     or to_regprocedure('public.mirror_outbox_enqueue(text,text,text,jsonb,text,timestamp with time zone,text,text,text,text,text,text,text,bigint,boolean)') is null
  then raise exception 'native_ordinary_receipt_prerequisite_missing'; end if;
end $preflight$;

insert into public.syncview_runtime_flags(key,value,updated_by) values
 ('production_native_ordinary_receipts',
  '{"schema_version":1,"video":{"mode":"provider","epoch":null},"graphics":{"mode":"provider","epoch":null}}',
  'native-ordinary-receipts-draft') on conflict(key) do nothing;

create table if not exists public.production_native_ordinary_receipt_admissions (
  token uuid primary key,
  epoch text not null check (epoch ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
  owner text not null check (owner in ('deliverable','comment')),
  entity text not null check (entity in ('deliverable','comment')),
  entity_id text not null, receipt_operation text not null,
  native_operation text not null,
  client_slug text not null, team text not null check (team in ('video','graphics')),
  actor text not null, role text not null,
  test_only boolean not null default false check (test_only=false),
  legacy_parity boolean not null default false check (legacy_parity=false),
  dedup_key text not null unique, intent_fingerprint text not null,
  source_edited_at timestamptz not null,
  receipt_id bigint unique references public.mirror_outbox(id),
  issued_at timestamptz not null default clock_timestamp(),
  check ((owner='deliverable' and entity='deliverable'
          and native_operation in ('status','due','title','priority','archive','restore','parent','description','attachment'))
      or (owner='comment' and entity='comment' and receipt_operation='comment'
          and native_operation in ('comment','edit','delete','resolve','unresolve')))
);
alter table public.production_native_ordinary_receipt_admissions enable row level security;
revoke all on table public.production_native_ordinary_receipt_admissions from public, anon, authenticated, service_role;

create or replace function public.production_native_ordinary_capability(p_team text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_value jsonb; v_entry jsonb;
begin
  if p_team not in ('video','graphics') then raise exception 'native_ordinary_receipt_scope_forbidden'; end if;
  select value into v_value from public.syncview_runtime_flags
    where key='production_native_ordinary_receipts' for share;
  v_entry:=v_value->p_team;
  if jsonb_typeof(v_value) is distinct from 'object' or v_value->'schema_version' is distinct from '1'::jsonb
     or jsonb_typeof(v_entry) is distinct from 'object'
     or coalesce(v_entry->>'mode','') not in ('provider','native','hold') then
    raise exception 'native_ordinary_receipt_config_invalid'; end if;
  if v_entry->>'mode'='native' then
    if coalesce(v_entry->>'epoch','') !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$' then
      raise exception 'native_ordinary_receipt_config_invalid'; end if;
  elsif v_entry->'epoch' is distinct from 'null'::jsonb then
    raise exception 'native_ordinary_receipt_config_invalid';
  end if;
  return v_entry;
end $fn$;

-- The marker is minted only by an owning security-definer RPC after replay and
-- authority checks.  A direct service_role INSERT has no admission token.
create or replace function public.production_native_ordinary_event(p_event jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_out jsonb:=coalesce(v_event->'outbound','{}'::jsonb);
 v_payload jsonb:=coalesce(v_out->'payload','{}'::jsonb); v_cap jsonb; v_token uuid:=gen_random_uuid();
 v_owner text:=p_expected->>'owner'; v_native text:=p_expected->>'native_operation';
begin
  if v_payload ? '_native_ordinary_receipt' then raise exception 'native_ordinary_receipt_marker_forbidden'; end if;
 if v_owner not in ('deliverable','comment') or coalesce(v_native,'')=''
     or p_expected->>'entity' is distinct from v_out->>'entity'
     or p_expected->>'entity_id' is distinct from v_out->>'entity_id'
     or p_expected->>'receipt_operation' is distinct from v_out->>'operation'
     or p_expected->>'client_slug' is distinct from coalesce(v_out->>'client_slug',p_expected->>'client_slug')
     or p_expected->>'team' is distinct from v_out->>'team'
     or p_expected->>'actor' is distinct from v_event->>'actor'
     or p_expected->>'role' is distinct from v_event->>'role'
     or coalesce(v_out->>'dedup_key','')='' or coalesce(v_payload->>'_intent_fingerprint','')=''
     or coalesce((v_out->>'test_only')::boolean,false) or coalesce((v_out->>'legacy_parity')::boolean,false)
  then raise exception 'native_ordinary_receipt_scope_forbidden'; end if;
  v_cap:=public.production_native_ordinary_capability(p_expected->>'team');
  if v_cap->>'mode'='hold' then raise exception 'native_ordinary_receipt_held'; end if;
  if v_cap->>'mode'='provider' then return v_event; end if;
  insert into public.production_native_ordinary_receipt_admissions(
    token,epoch,owner,entity,entity_id,receipt_operation,native_operation,client_slug,team,actor,role,dedup_key,intent_fingerprint,source_edited_at)
  values(v_token,v_cap->>'epoch',v_owner,p_expected->>'entity',p_expected->>'entity_id',p_expected->>'receipt_operation',v_native,
    p_expected->>'client_slug',p_expected->>'team',p_expected->>'actor',p_expected->>'role',v_out->>'dedup_key',v_payload->>'_intent_fingerprint',
    (v_out->>'source_edited_at')::timestamptz);
  return jsonb_set(v_event,'{outbound,payload}',v_payload||jsonb_build_object('_native_ordinary_receipt',
    jsonb_build_object('schema',1,'epoch',v_cap->>'epoch','owner',v_owner,'operation',v_native,'token',v_token::text)),true);
end $fn$;

create or replace function public.production_native_ordinary_receipt_guard()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare v_marker jsonb; v_token uuid; v_admission public.production_native_ordinary_receipt_admissions; v_cap jsonb;
begin
  if tg_op='DELETE' then
    if old.payload ? '_native_ordinary_receipt' then raise exception 'native_ordinary_receipt_retained'; end if; return old;
  end if;
  if tg_op='UPDATE' then
    if old.payload ? '_native_ordinary_receipt' and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
      raise exception 'native_ordinary_receipt_immutable'; end if;
    if new.payload->'_native_ordinary_receipt' is distinct from old.payload->'_native_ordinary_receipt' then raise exception 'idempotency_conflict'; end if;
    return new;
  end if;
  if not (new.payload ? '_native_ordinary_receipt') then return new; end if;
  v_marker:=new.payload->'_native_ordinary_receipt';
  if jsonb_typeof(v_marker) is distinct from 'object' or v_marker->'schema' is distinct from '1'::jsonb then raise exception 'native_ordinary_receipt_invalid'; end if;
  begin v_token:=(v_marker->>'token')::uuid; exception when others then raise exception 'native_ordinary_receipt_invalid'; end;
  select * into v_admission from public.production_native_ordinary_receipt_admissions where token=v_token for update;
  if not found or v_admission.receipt_id is not null
     or new.entity is distinct from v_admission.entity or new.entity_id is distinct from v_admission.entity_id
     or new.operation is distinct from v_admission.receipt_operation or new.client_slug is distinct from v_admission.client_slug
     or new.team is distinct from v_admission.team or new.actor is distinct from v_admission.actor or new.role is distinct from v_admission.role
     or new.test_only is distinct from false or new.legacy_parity is distinct from false
     or new.dedup_key is distinct from v_admission.dedup_key or new.payload->>'_intent_fingerprint' is distinct from v_admission.intent_fingerprint
     or new.source_edited_at is distinct from v_admission.source_edited_at
     or v_marker->>'epoch' is distinct from v_admission.epoch or v_marker->>'owner' is distinct from v_admission.owner
     or v_marker->>'operation' is distinct from v_admission.native_operation
  then raise exception 'native_ordinary_receipt_invalid'; end if;
  v_cap:=public.production_native_ordinary_capability(new.team);
  if v_cap->>'mode' is distinct from 'native' or v_cap->>'epoch' is distinct from v_admission.epoch then raise exception 'native_ordinary_receipt_epoch_changed'; end if;
  perform public.production_assert_authority(new.client_slug,new.team,false,false);
  new.status:='skipped'; new.processed_at:=clock_timestamp(); new.next_retry_at:=null; new.last_error:=null;
  new.linear_result:=jsonb_build_object('native_ordinary',true,'epoch',v_admission.epoch,'owner',v_admission.owner,'operation',v_admission.native_operation);
  update public.production_native_ordinary_receipt_admissions set receipt_id=new.id where token=v_token;
  return new;
end $fn$;
create trigger zzz_native_ordinary_receipt_guard before insert or update or delete on public.mirror_outbox
for each row execute function public.production_native_ordinary_receipt_guard();
create or replace function public.production_native_ordinary_receipt_truncate_guard() returns trigger language plpgsql security definer set search_path=public as $fn$
begin if exists(select 1 from public.mirror_outbox where payload ? '_native_ordinary_receipt') then raise exception 'native_ordinary_receipt_retained'; end if; return null; end $fn$;
create trigger zzz_native_ordinary_receipt_truncate_guard before truncate on public.mirror_outbox for each statement execute function public.production_native_ordinary_receipt_truncate_guard();

-- Rebind the common owner after its established authority/replay checks.  Intake
-- create and separate labels/assignee owners never enter this allowlist.
create or replace function public.production_deliverable_write(p_row jsonb,p_event jsonb default '{}'::jsonb) returns public.deliverables
language plpgsql security definer set search_path=public as $fn$
declare v_row jsonb:=coalesce(p_row,'{}'::jsonb); v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_outbound jsonb:=coalesce(v_event->'outbound','{}'::jsonb); v_payload jsonb:=coalesce(v_outbound->'payload','{}'::jsonb); v_id text:=nullif(btrim(v_row->>'id'),''); v_dedup text:=nullif(btrim(v_outbound->>'dedup_key'),''); v_fingerprint text:=nullif(btrim(v_payload->>'_intent_fingerprint'),''); v_result public.deliverables%rowtype; v_current public.deliverables%rowtype;
begin
 if v_id is null then raise exception 'production deliverable id required'; end if;
 perform public.production_assert_authority(nullif(v_row->>'client_slug',''),nullif(v_row->>'team',''),coalesce((v_outbound->>'test_only')::boolean,false),coalesce((v_outbound->>'legacy_parity')::boolean,false));
 if public.production_outbox_replay(coalesce(nullif(v_outbound->>'entity',''),'deliverable'),v_id,nullif(v_outbound->>'operation',''),nullif(v_row->>'client_slug',''),nullif(v_row->>'team',''),nullif(v_event->>'actor',''),nullif(v_event->>'role',''),coalesce((v_outbound->>'test_only')::boolean,false),coalesce((v_outbound->>'legacy_parity')::boolean,false),v_fingerprint,v_dedup) then select d.* into v_result from public.deliverables d where d.id=v_id; if not found then raise exception 'idempotent_result_missing'; end if; return v_result; end if;
 if nullif(v_outbound->>'operation','') in ('status','due','title','priority','archive','restore','parent','description','attachment') then
   v_event:=public.production_native_ordinary_event(v_event,jsonb_build_object('owner','deliverable','entity','deliverable','entity_id',v_id,'receipt_operation',v_outbound->>'operation','native_operation',v_outbound->>'operation','client_slug',v_row->>'client_slug','team',v_row->>'team','actor',v_event->>'actor','role',v_event->>'role'));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||v_id,0)); select d.* into v_current from public.deliverables d where d.id=v_id for update;
 if found then if v_event?'expected_status' and v_current.status is distinct from nullif(v_event->>'expected_status','') then raise exception 'write_conflict'; end if; if v_event?'expected_updated_at' and v_current.updated_at is distinct from nullif(v_event->>'expected_updated_at','')::timestamptz then raise exception 'write_conflict'; end if; end if;
 return public.deliverable_write(v_row,v_event);
end $fn$;

-- Comment owner retains normalized store/CAS and adds the marker only after exact receipt replay.
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
    if v_outbound->>'entity' is distinct from 'comment'
       or v_outbound->>'entity_id' is distinct from coalesce(v_result.deliverable_id,v_result.batch_id)
       or v_outbound->>'operation' is distinct from 'comment'
       or (v_comment ? 'deliverable_id' and nullif(btrim(v_comment->>'deliverable_id'),'') is distinct from v_result.deliverable_id)
       or (v_comment ? 'batch_id' and nullif(btrim(v_comment->>'batch_id'),'') is distinct from v_result.batch_id)
       or (v_comment ? 'team' and nullif(btrim(v_comment->>'team'),'') is distinct from v_result.team)
       or (v_comment ? 'author_name' and nullif(btrim(v_comment->>'author_name'),'') is distinct from v_result.author_name)
       or (v_comment ? 'role' and nullif(btrim(v_comment->>'role'),'') is distinct from v_result.role)
    then raise exception 'idempotency_conflict'; end if;
    if exists(select 1 from public.mirror_outbox o where o.dedup_key=v_dedup_key) then
      perform public.production_outbox_replay(
        'comment',coalesce(v_result.deliverable_id,v_result.batch_id),'comment',
        v_result.client_slug,v_result.team,nullif(v_event->>'actor',''),nullif(v_event->>'role',''),
        v_test_only,v_legacy_parity,v_fingerprint,v_dedup_key
      );
    end if;
    return v_result;
  end if;

  v_event := public.production_native_ordinary_event(v_event, jsonb_build_object(
    'owner','comment','entity','comment','entity_id',v_target_id,
    'receipt_operation','comment','native_operation','comment',
    'client_slug',v_client_slug,'team',v_team,'actor',v_comment->>'author_name','role',v_comment->>'role'
  ));
  v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);

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
$fn$;

revoke all on function public.production_comment_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.production_comment_write(jsonb, jsonb)
  to service_role;


create or replace function public.production_comment_lifecycle_write(
  p_comment jsonb,
  p_event jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_expected_updated_at timestamptz default null
) returns public.production_comments
language plpgsql
security definer
set search_path = public
as $fn$
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
    if v_outbound->>'entity' is distinct from 'comment'
       or v_outbound->>'entity_id' is distinct from coalesce(v_result.deliverable_id,v_result.batch_id)
       or v_outbound->>'operation' is distinct from 'comment'
       or (v_comment ? 'deliverable_id' and nullif(btrim(v_comment->>'deliverable_id'),'') is distinct from v_result.deliverable_id)
       or (v_comment ? 'batch_id' and nullif(btrim(v_comment->>'batch_id'),'') is distinct from v_result.batch_id)
       or (v_comment ? 'team' and nullif(btrim(v_comment->>'team'),'') is distinct from v_result.team)
       or (v_comment ? 'author_name' and nullif(btrim(v_comment->>'author_name'),'') is distinct from v_result.author_name)
       or (v_comment ? 'role' and nullif(btrim(v_comment->>'role'),'') is distinct from v_result.role)
    then raise exception 'idempotency_conflict'; end if;
    if exists(select 1 from public.mirror_outbox o where o.dedup_key=v_dedup_key) then
      perform public.production_outbox_replay(
        'comment',coalesce(v_result.deliverable_id,v_result.batch_id),'comment',
        v_result.client_slug,v_result.team,nullif(v_event->>'actor',''),nullif(v_event->>'role',''),
        coalesce((v_outbound->>'test_only')::boolean,false),v_legacy_parity,
        v_fingerprint,v_dedup_key
      );
    end if;
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

  v_event := public.production_native_ordinary_event(v_event, jsonb_build_object(
    'owner','comment','entity','comment','entity_id',v_target_id,
    'receipt_operation','comment','native_operation',v_action,
    'client_slug',v_existing.client_slug,'team',v_existing.team,'actor',v_event->>'actor','role',v_event->>'role'
  ));
  v_outbound := coalesce(v_event->'outbound', '{}'::jsonb);

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
  if (v_action in ('edit', 'delete') or (v_outbound->'payload' ? '_native_ordinary_receipt')) and v_mirror_applicable then
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
$fn$;

revoke all on function public.production_comment_lifecycle_write(
  jsonb, jsonb, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.production_comment_lifecycle_write(
  jsonb, jsonb, integer, timestamptz
) to service_role;


revoke all on function public.production_native_ordinary_capability(text), public.production_native_ordinary_event(jsonb,jsonb), public.production_native_ordinary_receipt_guard(), public.production_native_ordinary_receipt_truncate_guard() from public,anon,authenticated,service_role;
revoke all on function public.production_deliverable_write(jsonb,jsonb), public.production_batch_write(jsonb,jsonb), public.production_comment_write(jsonb,jsonb), public.production_comment_lifecycle_write(jsonb,jsonb,integer,timestamp with time zone) from public,anon,authenticated;
grant execute on function public.production_deliverable_write(jsonb,jsonb), public.production_batch_write(jsonb,jsonb), public.production_comment_write(jsonb,jsonb), public.production_comment_lifecycle_write(jsonb,jsonb,integer,timestamp with time zone) to service_role;
commit;
