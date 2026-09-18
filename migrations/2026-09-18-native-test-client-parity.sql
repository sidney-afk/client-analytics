-- Native test-client parity: the TEST client is treated like a real client by
-- BOTH native lanes.
--
-- WHAT WAS WRONG, AND WHY IT ONLY SHOWED UP NOW.
-- The nightly production-write drill writes exclusively as the TEST client
-- (`test_only = true`). Both native lanes refused that outright once their
-- capability was `native`:
--
--   * ordinary receipts -- `production_native_ordinary_event` refused any
--     test_only envelope with `native_ordinary_receipt_scope_forbidden`, and
--     `production_native_ordinary_receipt_admissions` carried
--     `check (test_only = false)` so the admission could not even be recorded;
--   * assignment -- `production_assignment_context` raised
--     `assignment_authority_unavailable` for a test_only write, and
--     `production_native_assignment_receipt_guard` refused it with
--     `assignment_scope_forbidden`.
--
-- The consequence, measured on 2026-09-18 (run 35327383049 and PR #1412): with
-- native intake on, the drill's card has no Linear issue, so its follow-up
-- rows can only fail on the provider lane -- and they could not be moved to the
-- native lane either, because the native lane refused TEST. There was no
-- configuration of the system in which the drill could be green. PR #1412
-- therefore had to PARK that assertion rather than make it.
--
-- WHAT THIS CHANGES. Each lane stops refusing `test_only`, RECORDS the value,
-- and COMPARES it, exactly as it already does for every other scope field. The
-- authority check then receives the real value, so a TEST write is validated as
-- a TEST write -- `production_assert_authority` requires an active
-- `kind = 'test'` client for it -- instead of being validated against the real
-- team's `prod_authority`, or refused.
--
-- `legacy_parity` is UNCHANGED in both lanes, deliberately and in every place:
-- the admissions table keeps `check (legacy_parity = false)`, both guards keep
-- refusing a parity row, and every `production_assert_authority` call still
-- passes `false` for it. Parity is a different question from TEST scope and is
-- not being answered here.
--
-- PRIVILEGES. No grant and no revoke is issued by this migration. All four
-- roles are named so the absence is a statement rather than an omission:
-- `service_role`, `anon`, `authenticated` and `public` gain nothing.
-- `create or replace function` preserves a function's existing ACL, so the
-- 2026-09-12 revoke of `production_native_ordinary_event` from
-- public/anon/authenticated/service_role stays in force, as do the 2026-09-06
-- revokes on the assignment functions and the service_role grants they kept.
-- The rehearsal measures this rather than assuming it. Dropping a CHECK
-- constraint changes no privilege on any role.
--
-- Each of the five function bodies below is the CURRENT text with the minimum
-- change, extracted and substituted programmatically rather than retyped, so
-- no other line can drift.
begin;

do $preflight$
begin
  if to_regprocedure('public.production_native_ordinary_event(jsonb,jsonb)') is null
     or to_regprocedure('public.production_native_ordinary_receipt_guard()') is null
     or to_regprocedure('public.production_assignment_context(jsonb)') is null
     or to_regprocedure('public.production_native_assignment_receipt_guard()') is null
     or to_regprocedure('public.production_assignee_write(jsonb,jsonb)') is null
     or to_regclass('public.production_native_ordinary_receipt_admissions') is null
     or to_regprocedure('public.production_assert_authority(text,text,boolean,boolean)') is null
  then raise exception 'native_test_client_parity_prerequisite_missing'; end if;
end $preflight$;

-- The admission must be able to RECORD a TEST write. Only the test_only check
-- is dropped, located by its exact definition so the legacy_parity check next
-- to it cannot be hit by accident; a shape this does not recognise fails the
-- migration rather than silently dropping nothing.
do $admission$
declare v_name text; v_parity integer;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.production_native_ordinary_receipt_admissions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) = 'CHECK ((test_only = false))';
  if v_name is null then raise exception 'native_test_client_parity_admission_check_missing'; end if;
  execute format('alter table public.production_native_ordinary_receipt_admissions drop constraint %I', v_name);
  select count(*) into v_parity from pg_constraint
   where conrelid = 'public.production_native_ordinary_receipt_admissions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) = 'CHECK ((legacy_parity = false))';
  if v_parity <> 1 then raise exception 'native_test_client_parity_legacy_check_disturbed'; end if;
end $admission$;

-- (1) ORDINARY LANE, admission. The scope check no longer refuses a test_only
-- envelope; the legacy_parity half of that same condition is untouched. The
-- admission now records the value so the guard has something to compare against.
create or replace function public.production_native_ordinary_event(p_event jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_event jsonb:=coalesce(p_event,'{}'::jsonb); v_out jsonb:=coalesce(v_event->'outbound','{}'::jsonb); v_payload jsonb:=coalesce(v_out->'payload','{}'::jsonb); v_cap jsonb; v_token uuid:=gen_random_uuid(); v_owner text:=p_expected->>'owner'; v_native text:=p_expected->>'native_operation'; v_source_edited_at timestamptz;
begin
 if v_payload ? '_native_ordinary_receipt' then raise exception 'native_ordinary_receipt_marker_forbidden'; end if;
 v_cap:=public.production_native_ordinary_capability(p_expected->>'team');
 if v_cap->>'mode'='provider' then return v_event; end if;
 if v_cap->>'mode'='hold' then raise exception 'native_ordinary_receipt_held'; end if;
 -- outboundBase carries entity/id/op/dedup/clock only. Scope comes from the
 -- locked owner row; supplied optional scope is rejected only if contradictory.
 v_source_edited_at:=coalesce(nullif(p_expected->>'source_edited_at','')::timestamptz,(v_out->>'source_edited_at')::timestamptz);
 if v_owner not in ('deliverable','comment') or coalesce(v_native,'')='' or v_source_edited_at is null
    or p_expected->>'entity' is distinct from v_out->>'entity' or p_expected->>'entity_id' is distinct from v_out->>'entity_id'
    or p_expected->>'receipt_operation' is distinct from v_out->>'operation'
    or (v_out ? 'client_slug' and p_expected->>'client_slug' is distinct from v_out->>'client_slug')
    or (v_out ? 'team' and p_expected->>'team' is distinct from v_out->>'team')
    or p_expected->>'actor' is distinct from v_event->>'actor' or p_expected->>'role' is distinct from v_event->>'role'
    or coalesce(v_out->>'dedup_key','')='' or coalesce(v_payload->>'_intent_fingerprint','')=''
    or coalesce((v_out->>'legacy_parity')::boolean,false)
 then raise exception 'native_ordinary_receipt_scope_forbidden'; end if;
 insert into public.production_native_ordinary_receipt_admissions(token,epoch,owner,entity,entity_id,receipt_operation,native_operation,client_slug,team,actor,role,test_only,dedup_key,intent_fingerprint,source_edited_at)
 values(v_token,v_cap->>'epoch',v_owner,p_expected->>'entity',p_expected->>'entity_id',p_expected->>'receipt_operation',v_native,p_expected->>'client_slug',p_expected->>'team',p_expected->>'actor',p_expected->>'role',coalesce((v_out->>'test_only')::boolean,false),v_out->>'dedup_key',v_payload->>'_intent_fingerprint',v_source_edited_at);
 return jsonb_set(v_event,'{outbound,payload}',v_payload||jsonb_build_object('_native_ordinary_receipt',jsonb_build_object('schema',1,'epoch',v_cap->>'epoch','owner',v_owner,'operation',v_native,'token',v_token::text)),true);
end $fn$;

-- (2) ORDINARY LANE, receipt guard. `new.test_only` is compared to the value
-- the admission recorded instead of to a hard `false`, and the authority check
-- receives the real value so a TEST row is validated as a TEST row. The
-- legacy_parity comparison stays `is distinct from false`.
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
     or new.test_only is distinct from v_admission.test_only or new.legacy_parity is distinct from false
     or new.dedup_key is distinct from v_admission.dedup_key or new.payload->>'_intent_fingerprint' is distinct from v_admission.intent_fingerprint
     or new.source_edited_at is distinct from v_admission.source_edited_at
     or v_marker->>'epoch' is distinct from v_admission.epoch or v_marker->>'owner' is distinct from v_admission.owner
     or v_marker->>'operation' is distinct from v_admission.native_operation
  then raise exception 'native_ordinary_receipt_invalid'; end if;
  v_cap:=public.production_native_ordinary_capability(new.team);
  if v_cap->>'mode' is distinct from 'native' or v_cap->>'epoch' is distinct from v_admission.epoch then raise exception 'native_ordinary_receipt_epoch_changed'; end if;
  perform public.production_assert_authority(new.client_slug,new.team,new.test_only,false);
  new.status:='skipped'; new.processed_at:=clock_timestamp(); new.next_retry_at:=null; new.last_error:=null;
  new.linear_result:=jsonb_build_object('native_ordinary',true,'epoch',v_admission.epoch,'owner',v_admission.owner,'operation',v_admission.native_operation);
  update public.production_native_ordinary_receipt_admissions set receipt_id=new.id where token=v_token;
  return new;
end $fn$;

-- (3) ASSIGNMENT LANE, admission. The lane already RECORDS test_only (on the
-- mirror_outbox row itself) and already COMPARES it on replay -- see the
-- `v_receipt.test_only is distinct from (p_expected->>'test_only')::boolean`
-- line above, which is unchanged. All that is removed is the up-front refusal;
-- the legacy_parity refusal beside it stays exactly as it was.
create or replace function public.production_assignment_context(p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_receipt public.mirror_outbox; v_epoch text; v_dedup text := p_expected->>'dedup_key';
begin
  if p_expected->>'entity' is distinct from 'deliverable' or p_expected->>'operation' is distinct from 'assignee'
     or coalesce(p_expected->>'actor','')='' or coalesce(p_expected->>'role','') not in ('admin','smm')
     or not exists(select 1 from public.deliverables where id=p_expected->>'entity_id'
       and client_slug=p_expected->>'client_slug' and team=p_expected->>'team') then
    raise exception 'assignment_scope_forbidden';
  end if;
  if coalesce(v_dedup,'')<>'' then
    if coalesce(p_expected->>'intent_fingerprint','')='' then raise exception 'idempotency_conflict'; end if;
    select * into v_receipt from public.mirror_outbox where dedup_key=v_dedup;
    if found then
      if v_receipt.entity is distinct from p_expected->>'entity'
         or v_receipt.entity_id is distinct from p_expected->>'entity_id'
         or v_receipt.operation is distinct from p_expected->>'operation'
         or v_receipt.client_slug is distinct from p_expected->>'client_slug'
         or v_receipt.team is distinct from p_expected->>'team'
         or v_receipt.actor is distinct from p_expected->>'actor'
         or v_receipt.role is distinct from p_expected->>'role'
         or v_receipt.test_only is distinct from (p_expected->>'test_only')::boolean
         or v_receipt.legacy_parity is distinct from (p_expected->>'legacy_parity')::boolean
         or v_receipt.payload->>'_intent_fingerprint' is distinct from p_expected->>'intent_fingerprint' then
        raise exception 'idempotency_conflict';
      end if;
      v_epoch := coalesce(v_receipt.payload->>'_native_assignment_epoch','');
      if v_epoch<>'' and (v_receipt.status is distinct from 'skipped'
         or v_receipt.linear_result->>'native_assignment' is distinct from 'true') then
        raise exception 'idempotency_conflict';
      end if;
      -- A provider receipt remains provider debt; HOLD must not let its retry
      -- schedule new egress. This check never relabels or mutates that receipt.
      if v_epoch='' then perform public.production_assignment_epoch(p_expected->>'team'); end if;
      return jsonb_build_object('contract','existing-assignment-v1','epoch',v_epoch,'replay',true);
    end if;
  end if;
  v_epoch := public.production_assignment_epoch(p_expected->>'team');
  if v_epoch<>'' then
    if (p_expected->>'legacy_parity')::boolean is distinct from false then
      raise exception 'assignment_authority_unavailable';
    end if;
    perform public.production_assert_authority(p_expected->>'client_slug',p_expected->>'team',
      coalesce((p_expected->>'test_only')::boolean,false),false);
  end if;
  return jsonb_build_object('contract','existing-assignment-v1','epoch',v_epoch,'replay',false);
end; $$;

-- (4) ASSIGNMENT LANE, receipt guard. `or new.test_only` is dropped from the
-- scope refusal and the real value is passed to the authority check.
-- `or new.legacy_parity` stays.
create or replace function public.production_native_assignment_receipt_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_epoch text;
begin
  if tg_op='DELETE' then
    if coalesce(old.payload->>'_native_assignment_epoch','')<>'' then raise exception 'native_assignment_receipt_retained'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.payload->>'_native_assignment_epoch' is distinct from old.payload->>'_native_assignment_epoch' then
      raise exception 'idempotency_conflict';
    end if;
    if coalesce(old.payload->>'_native_assignment_epoch','')<>''
       and (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
      raise exception 'idempotency_conflict';
    end if;
    return new;
  end if;
  if new.operation<>'assignee' or new.dedup_key not like 'write-ui:assignee:deliverable:%' then
    if new.payload ? '_native_assignment_epoch' then raise exception 'assignment_authority_unavailable'; end if;
    return new;
  end if;
  v_epoch := public.production_assignment_epoch(new.team);
  if v_epoch is distinct from coalesce(new.payload->>'_native_assignment_epoch','') then
    raise exception 'assignment_authority_unavailable';
  end if;
  if v_epoch<>'' then
    if new.entity<>'deliverable' or new.legacy_parity or new.role not in ('admin','smm')
       or coalesce(new.payload->>'_intent_fingerprint','')='' then raise exception 'assignment_scope_forbidden'; end if;
    perform public.production_assert_authority(new.client_slug,new.team,new.test_only,false);
    new.status := 'skipped'; new.processed_at := clock_timestamp(); new.next_retry_at := null;
    new.linear_result := jsonb_build_object('native_assignment',true,'epoch',v_epoch);
    new.last_error := null;
  end if;
  return new;
end; $$;

-- (5) ASSIGNMENT LANE, writer. Its pre-lock authority check hard-coded
-- `false` for test_only, so a TEST assignment was validated against the real
-- team's prod_authority rather than TEST scope -- passing only by luck of the
-- flag, and refusing with `team_is_linear_authoritative` otherwise. It now
-- passes the envelope's own value. legacy_parity stays `false`, as everywhere.
create or replace function public.production_assignee_write(p_row jsonb,p_event jsonb) returns public.deliverables
language plpgsql security definer set search_path=public as $$
declare v_out jsonb:=p_event->'outbound'; v_payload jsonb:=v_out->'payload'; v_context jsonb;
 v_current public.deliverables; v_member public.team_members; v_result public.deliverables;
 v_assignee text:=nullif(btrim(p_row->>'assignee_id'),''); v_expected jsonb;
begin
  if p_event->>'surface' is distinct from 'production' or p_event->>'auth_kind' is distinct from 'staff'
     or p_event->>'source' is distinct from 'ui' or p_event->>'action' is distinct from 'assignee_change'
     or v_out->>'operation' is distinct from 'assignee' or v_out->>'entity' is distinct from 'deliverable'
     or v_out->>'entity_id' is distinct from p_row->>'id'
     or v_payload->>'assignee_id' is distinct from v_assignee
     or coalesce(p_event->>'expected_updated_at','')=''
     or coalesce(v_payload->>'_native_assignment_epoch','')='' then raise exception 'assignment_scope_forbidden'; end if;
  perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',
    coalesce((v_out->>'test_only')::boolean,false),false);
  -- Match the established dedup -> deliverable lock order; the epoch's SHARE
  -- lock then remains held through eligibility, event and outbox insertion.
  perform pg_advisory_xact_lock(hashtextextended(v_out->>'dedup_key',0));
  v_expected := jsonb_build_object('entity','deliverable','entity_id',p_row->>'id','operation','assignee',
    'client_slug',p_row->>'client_slug','team',p_row->>'team','actor',p_event->>'actor','role',p_event->>'role',
    'test_only',v_out->'test_only','legacy_parity',v_out->'legacy_parity',
    'dedup_key',v_out->>'dedup_key','intent_fingerprint',v_payload->>'_intent_fingerprint');
  v_context := public.production_assignment_context(v_expected);
  if v_context->>'epoch' is distinct from v_payload->>'_native_assignment_epoch' then
    raise exception 'assignment_authority_unavailable'; end if;
  if v_context->>'replay'='true' then
    return public.production_deliverable_write(p_row,p_event);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||(p_row->>'id'),0));
  select * into v_current from public.deliverables where id=p_row->>'id' for update;
  if not found or v_current.client_slug is distinct from p_row->>'client_slug'
     or v_current.team is distinct from p_row->>'team' then raise exception 'assignment_scope_forbidden'; end if;
  if v_current.updated_at is distinct from (p_event->>'expected_updated_at')::timestamptz then raise exception 'write_conflict'; end if;
  if v_assignee is not null then
    select * into v_member from public.team_members where id::text=v_assignee for share;
    if not found or v_member.active is distinct from true or v_member.team is distinct from v_current.team then
      raise exception 'assignee_out_of_scope'; end if;
    if lower(v_member.role) is distinct from (case v_current.team when 'video' then 'editor' when 'graphics' then 'designer' end) then
      raise exception 'assignee_role_incompatible'; end if;
  end if;
  -- The wrapper changes only its owned column. The existing RPC retains CAS,
  -- events, journal triggers, dedup and F27 enqueue as one transaction.
  v_result := public.production_deliverable_write(to_jsonb(v_current)||jsonb_build_object('assignee_id',v_assignee),p_event);
  return v_result;
end; $$;

commit;
