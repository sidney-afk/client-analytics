-- Preparation only: opt-in Calendar/Samples RPC boundary, not a global freeze.
-- Existing handlers, direct SQL, other writers and retirement activation unchanged.
begin;
create table public.card_write_admission_v1 (
 singleton boolean primary key default true check(singleton),
 epoch uuid not null default gen_random_uuid(),
 mode text not null default 'open' check(mode in ('open','closed','sealed')),
 closed_at timestamptz, sealed_at timestamptz, reason text
);
insert into public.card_write_admission_v1(singleton) values(true);
create table public.card_write_operations_v1 (
 operation_id uuid primary key, epoch uuid not null,
 request jsonb not null check(jsonb_typeof(request)='object'),
 request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
 result jsonb not null, committed_at timestamptz not null default clock_timestamp()
);
create table public.card_write_followups_v1 (
 operation_id uuid not null references public.card_write_operations_v1(operation_id),
 kind text not null check(kind in ('graphic_baseline','graphic_resolution')),
 payload jsonb not null check(jsonb_typeof(payload)='object'),
 state text not null default 'pending' check(state in ('pending','running','failed','unknown','dispositioned')),
 attempt integer not null default 0 check(attempt>=0), lease_token uuid, lease_until timestamptz,
 outcome jsonb, history jsonb not null default '[]'::jsonb check(jsonb_typeof(history)='array'), completed_at timestamptz,
 primary key(operation_id,kind)
);
alter table public.card_write_admission_v1 enable row level security;
alter table public.card_write_operations_v1 enable row level security;
alter table public.card_write_followups_v1 enable row level security;
revoke all on public.card_write_admission_v1,public.card_write_operations_v1,public.card_write_followups_v1 from public,anon,authenticated,service_role;
grant select on public.card_write_admission_v1,public.card_write_operations_v1,public.card_write_followups_v1 to service_role;

create function public.production_card_atomic_write_v1(p_operation_id uuid,p_request jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare
 gate public.card_write_admission_v1%rowtype; prior public.card_write_operations_v1%rowtype;
 surface text; client_key text; card_key text; card_table text; event_table text; event_key text;
 incoming jsonb; expected jsonb; actual jsonb; saved jsonb; scalar_row jsonb; event_row jsonb; task jsonb;
 typed_equal boolean; cols text; result jsonb; key text; existing boolean;
begin
 if p_operation_id is null or jsonb_typeof(p_request) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(p_request) k)
 is distinct from array['client','events','expected_existing','followups','id','row','surface']::text[] then raise exception 'card_atomic_request_shape';end if;
 surface:=p_request->>'surface';client_key:=p_request->>'client';card_key:=p_request->>'id';incoming:=p_request->'row';expected:=p_request->'expected_existing';
 if surface not in ('calendar','samples') or surface is null or nullif(client_key,'') is null or nullif(card_key,'') is null
 or jsonb_typeof(incoming) is distinct from 'object' or incoming->>'client' is distinct from client_key or incoming->>'id' is distinct from card_key
 or jsonb_typeof(expected) not in ('object','null') or jsonb_typeof(p_request->'events') is distinct from 'array' or jsonb_typeof(p_request->'followups') is distinct from 'array'
 then raise exception 'card_atomic_request_values';end if;
 -- Shared admission lock is held through all owning effects. Close takes UPDATE.
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 perform pg_advisory_xact_lock(hashtextextended('card-operation:'||p_operation_id::text,0));
 select * into prior from public.card_write_operations_v1 where operation_id=p_operation_id;
 if found then
  if prior.request is distinct from p_request then raise exception 'card_atomic_replay_mismatch';end if;
  return prior.result||jsonb_build_object('replayed',true);
 end if;
 if gate.mode<>'open' then raise exception 'card_atomic_admission_closed';end if;
 card_table:=case surface when 'calendar' then 'calendar_posts' else 'sample_reviews' end;
 event_table:=case surface when 'calendar' then 'calendar_post_events' else 'sample_review_events' end;
 event_key:=case surface when 'calendar' then 'post_id' else 'sample_id' end;
 perform pg_advisory_xact_lock(hashtextextended('card-write:'||surface||':'||client_key||':'||card_key,0));
 execute format('select to_jsonb(t),t is not distinct from jsonb_populate_record(null::public.%I,$3) from public.%I t where client=$1 and id=$2 for update',card_table,card_table)
 into actual,typed_equal using client_key,card_key,case when expected='null'::jsonb then '{}'::jsonb else expected end;
 existing:=actual is not null;
 if existing then
  if expected='null'::jsonb or not coalesce(typed_equal,false)
   or (select array_agg(k order by k) from jsonb_object_keys(actual) k) is distinct from (select array_agg(k order by k) from jsonb_object_keys(expected) k)
   then raise exception 'card_atomic_preimage_conflict';end if;
 elsif expected<>'null'::jsonb then raise exception 'card_atomic_preimage_conflict';end if;
 -- Reject unknown/generated/identity fields; SQL identifiers come only from catalog.
 for key in select jsonb_object_keys(incoming) loop
  if not exists(select from pg_attribute where attrelid=('public.'||card_table)::regclass and attname=key and attnum>0 and not attisdropped and attgenerated='' and attidentity='') then raise exception 'card_atomic_unknown_column';end if;
 end loop;
 scalar_row:=incoming;
 if existing then
  if surface='calendar' then
   if incoming ?| array['video_tweaks','graphic_tweaks','caption_tweaks','title_tweaks'] then
    perform public.calendar_merge_comments(p_client=>client_key,p_id=>card_key,p_base=>'',p_video=>case when incoming?'video_tweaks' then coalesce(incoming->>'video_tweaks','') else null end,p_graphic=>case when incoming?'graphic_tweaks' then coalesce(incoming->>'graphic_tweaks','') else null end,p_caption=>case when incoming?'caption_tweaks' then coalesce(incoming->>'caption_tweaks','') else null end,p_title=>case when incoming?'title_tweaks' then coalesce(incoming->>'title_tweaks','') else null end);
   end if;
   scalar_row:=incoming-array['video_tweaks','graphic_tweaks','caption_tweaks','title_tweaks','tweaks','video_status_at','graphic_status_at','caption_status_at','title_status_at'];
  else
   if incoming ?| array['video_tweaks','graphic_tweaks'] then
    perform public.sample_review_merge_comments(p_client=>client_key,p_id=>card_key,p_base=>'',p_video=>case when incoming?'video_tweaks' then coalesce(incoming->>'video_tweaks','') else null end,p_graphic=>case when incoming?'graphic_tweaks' then coalesce(incoming->>'graphic_tweaks','') else null end);
   end if;
   scalar_row:=incoming-array['video_tweaks','graphic_tweaks'];
  end if;
  scalar_row:=scalar_row-array['id','client'];
  select string_agg(format('%I',k),',' order by k) into cols from jsonb_object_keys(scalar_row) k;
  if cols is not null then execute format('update public.%I as t set (%s)=(select %s from jsonb_populate_record(null::public.%I,$1)) where client=$2 and id=$3',card_table,cols,cols,card_table) using scalar_row,client_key,card_key;end if;
 else
  select string_agg(format('%I',k),',' order by k) into cols from jsonb_object_keys(incoming) k;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1)',card_table,cols,cols,card_table) using incoming;
 end if;
 execute format('select to_jsonb(t) from public.%I t where client=$1 and id=$2',card_table) into strict saved using client_key,card_key;
 for event_row in select value from jsonb_array_elements(p_request->'events') loop
  if jsonb_typeof(event_row) is distinct from 'object' or event_row->>'client' is distinct from client_key or event_row->>event_key is distinct from card_key then raise exception 'card_atomic_event_scope';end if;
  for key in select jsonb_object_keys(event_row) loop
   if not exists(select from pg_attribute where attrelid=('public.'||event_table)::regclass and attname=key and attnum>0 and not attisdropped and attgenerated='' and attidentity='') then raise exception 'card_atomic_event_column';end if;
  end loop;
  select string_agg(format('%I',k),',' order by k) into cols from jsonb_object_keys(event_row) k;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I,$1)',event_table,cols,cols,event_table) using event_row;
 end loop;
 result:=jsonb_build_object('ok',true,'operation_id',p_operation_id,'epoch',gate.epoch,'row',saved,'replayed',false);
 insert into public.card_write_operations_v1(operation_id,epoch,request,request_sha256,result) values(p_operation_id,gate.epoch,p_request,encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex'),result);
 for task in select value from jsonb_array_elements(p_request->'followups') loop
  if jsonb_typeof(task) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(task) k) is distinct from array['kind','payload']::text[] then raise exception 'card_atomic_followup_shape';end if;
  if task->'payload'->>'surface' is distinct from surface or task->'payload'->>'client' is distinct from client_key or task->'payload'->>'sourceId' is distinct from card_key then raise exception 'card_atomic_followup_scope';end if;
  insert into public.card_write_followups_v1(operation_id,kind,payload) values(p_operation_id,task->>'kind',task->'payload');
 end loop;
 return result;
end $fn$;

create function public.production_card_admission_close_v1(p_epoch uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or nullif(btrim(p_reason),'') is null then raise exception 'card_admission_close_cas';end if;
 if gate.mode='open' then update public.card_write_admission_v1 set mode='closed',closed_at=clock_timestamp(),reason=p_reason where singleton;end if;
 return jsonb_build_object('epoch',gate.epoch,'scope','atomic_card_rpc_only','global_freeze_proven',false);
end $fn$;

create function public.production_card_followup_claim_v1(p_limit integer default 1)
returns setof public.card_write_followups_v1 language plpgsql security definer set search_path=public,pg_catalog as $fn$
begin
 if p_limit is null or p_limit not between 1 and 10 then raise exception 'card_followup_claim_limit';end if;
 perform 1 from public.card_write_admission_v1 where singleton for share;
 -- Never silently reclaim an expired worker: its effect may have happened.
 update public.card_write_followups_v1 set state='unknown',outcome='{"reason":"lease_expired_effect_unknown"}',history=history||jsonb_build_array(jsonb_build_object('state','unknown','attempt',attempt,'at',clock_timestamp(),'reason','lease_expired_effect_unknown')) where state='running' and lease_until<clock_timestamp();
 return query with picked as(select operation_id,kind from public.card_write_followups_v1 where state='pending' order by operation_id,kind for update skip locked limit p_limit)
 update public.card_write_followups_v1 t set state='running',attempt=t.attempt+1,lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',history=t.history||jsonb_build_array(jsonb_build_object('state','running','attempt',t.attempt+1,'at',clock_timestamp()))
 from picked p where t.operation_id=p.operation_id and t.kind=p.kind returning t.*;
end $fn$;

create function public.production_card_followup_fail_v1(p_operation_id uuid,p_kind text,p_attempt integer,p_lease_token uuid,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_catalog as $fn$
begin
 perform 1 from public.card_write_admission_v1 where singleton for share;
 if nullif(btrim(p_reason),'') is null then raise exception 'card_followup_reason_required';end if;
 update public.card_write_followups_v1 set state='failed',outcome=jsonb_build_object('reason',p_reason),history=history||jsonb_build_array(jsonb_build_object('state','failed','attempt',attempt,'reason',p_reason,'at',clock_timestamp())),completed_at=clock_timestamp() where operation_id=p_operation_id and kind=p_kind and state='running' and attempt=p_attempt and lease_token=p_lease_token and lease_until>=clock_timestamp();
 if not found then raise exception 'card_followup_attempt_cas';end if;
end $fn$;

-- No generic success acknowledgement: owner effects are not yet transactional.
-- An explicit human disposition is separately bound to immutable operation bytes.
create function public.production_card_followup_dispose_v1(p_operation_id uuid,p_kind text,p_request_sha256 text,p_evidence_sha256 text,p_actor text,p_reason text,p_confirmation text)
returns void language plpgsql security definer set search_path=public,pg_catalog as $fn$
begin
 perform 1 from public.card_write_admission_v1 where singleton for share;
 if p_confirmation is distinct from 'REVIEWED_EXACT_FOLLOWUP_DISPOSITION' or p_evidence_sha256 !~ '^[a-f0-9]{64}$' or p_evidence_sha256 is null or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null then raise exception 'card_followup_disposition_evidence';end if;
 if not exists(select from public.card_write_operations_v1 where operation_id=p_operation_id and request_sha256=p_request_sha256) then raise exception 'card_followup_operation_binding';end if;
 update public.card_write_followups_v1 set state='dispositioned',outcome=jsonb_build_object('actor',p_actor,'reason',p_reason,'evidence_sha256',p_evidence_sha256,'request_sha256',p_request_sha256,'classification','manual_disposition_not_automatic_effect_proof'),history=history||jsonb_build_array(jsonb_build_object('state','dispositioned','actor',p_actor,'reason',p_reason,'evidence_sha256',p_evidence_sha256,'at',clock_timestamp())),completed_at=clock_timestamp() where operation_id=p_operation_id and kind=p_kind and state in ('pending','failed','unknown');
 if not found then raise exception 'card_followup_disposition_state';end if;
end $fn$;

create function public.production_card_admission_seal_v1(p_epoch uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'card_admission_seal_cas';end if;
 if exists(select from public.card_write_followups_v1 where state<>'dispositioned') then raise exception 'card_admission_unresolved_followups';end if;
 if exists(select from public.card_write_followups_v1 where attempt>0) then raise exception 'card_admission_claimed_effect_fence_unproven';end if;
 update public.card_write_admission_v1 set mode='sealed',sealed_at=clock_timestamp() where singleton;
 return jsonb_build_object('epoch',p_epoch,'scope','atomic_card_rpc_only','global_freeze_proven',false,'retirement_activated',false);
end $fn$;

revoke all on function public.production_card_atomic_write_v1(uuid,jsonb),public.production_card_admission_close_v1(uuid,text),public.production_card_followup_claim_v1(integer),public.production_card_followup_fail_v1(uuid,text,integer,uuid,text),public.production_card_followup_dispose_v1(uuid,text,text,text,text,text,text),public.production_card_admission_seal_v1(uuid) from public,anon,authenticated;
grant execute on function public.production_card_atomic_write_v1(uuid,jsonb),public.production_card_admission_close_v1(uuid,text),public.production_card_followup_claim_v1(integer),public.production_card_followup_fail_v1(uuid,text,integer,uuid,text),public.production_card_followup_dispose_v1(uuid,text,text,text,text,text,text),public.production_card_admission_seal_v1(uuid) to service_role;
commit;
