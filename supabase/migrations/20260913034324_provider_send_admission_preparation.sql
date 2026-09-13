-- Preparation only. Private attempt custody does not fence unmodified external workers.
begin;
create schema linear_exit_provider;
revoke all on schema linear_exit_provider from public,anon,authenticated,service_role;
create table linear_exit_provider.send_attempts_v1 (
 attempt_id uuid primary key default gen_random_uuid(), epoch uuid not null,
 outbox_id bigint not null unique, team text not null, lock_token text not null,
 request jsonb not null, request_sha256 text not null,
 replay_scope jsonb, state text not null default 'admitted' check(state in ('admitted','acknowledged','completed')),
 provider_response jsonb, local_receipt jsonb,
 admitted_at timestamptz not null default clock_timestamp(), acknowledged_at timestamptz, completed_at timestamptz
);
alter table linear_exit_provider.send_attempts_v1 enable row level security;
revoke all on linear_exit_provider.send_attempts_v1 from public,anon,authenticated,service_role;

create function public.production_provider_send_admit_v1(p_epoch uuid,p_outbox_id bigint,p_lock_token text,p_request jsonb,p_replay_scope jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; o public.mirror_outbox%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'open' then raise exception 'provider_send_admission_closed';end if;
 if p_outbox_id is null or nullif(p_lock_token,'') is null or jsonb_typeof(p_request) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(p_request) k) is distinct from array['kind','query','variables']::text[]
 or jsonb_typeof(p_request->'kind') is distinct from 'string' or jsonb_typeof(p_request->'query') is distinct from 'string'
 or jsonb_typeof(p_request->'variables') is distinct from 'object' or length(p_request->>'query') not between 1 and 262144
 or p_request->>'kind' not in ('issueCreate','issueUpdate','commentCreate','commentUpdate','commentDelete','attachmentCreate','issueArchive','issueUnarchive')
 then raise exception 'provider_send_request_shape';end if;
 -- Real replay support needs its own closed-gate authorization owner. Never infer it here.
 if p_replay_scope is not null and p_replay_scope<>'null'::jsonb then raise exception 'provider_send_replay_not_prepared';end if;
 select * into strict o from public.mirror_outbox where id=p_outbox_id for update;
 if o.lock_token::text is distinct from p_lock_token or o.locked_at is null or lower(o.team) not in ('video','graphics')
 or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_send_outbox_binding';end if;
 -- A new lock token or retry cannot authorize a second uncertain external send.
 if exists(select from linear_exit_provider.send_attempts_v1 where outbox_id=p_outbox_id) then raise exception 'provider_send_existing_attempt_requires_reconciliation';end if;
 insert into linear_exit_provider.send_attempts_v1(epoch,outbox_id,team,lock_token,request,request_sha256,replay_scope)
 values(gate.epoch,o.id,lower(o.team),p_lock_token,p_request,encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex'),p_replay_scope) returning * into a;
 return jsonb_build_object('attempt_id',a.attempt_id,'epoch',a.epoch,'outbox_id',a.outbox_id::text,'request_sha256',a.request_sha256);
end $fn$;

create function public.production_provider_send_ack_v1(p_attempt_id uuid,p_lock_token text,p_request jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a linear_exit_provider.send_attempts_v1%rowtype;
begin
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 if a.lock_token is distinct from p_lock_token or a.request is distinct from p_request or jsonb_typeof(p_response) is distinct from 'object' then raise exception 'provider_send_ack_binding';end if;
 if a.state<>'admitted' then
  if a.provider_response is distinct from p_response then raise exception 'provider_send_ack_conflict';end if;
 else
  update linear_exit_provider.send_attempts_v1 set state='acknowledged',provider_response=p_response,acknowledged_at=clock_timestamp() where attempt_id=a.attempt_id;
 end if;
 return jsonb_build_object('acknowledged',true,'completed',false);
end $fn$;

create function public.production_provider_send_complete_v1(p_attempt_id uuid,p_lock_token text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare a linear_exit_provider.send_attempts_v1%rowtype; o public.mirror_outbox%rowtype;
begin
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for share;
 if a.lock_token is distinct from p_lock_token or o.lock_token is not null or o.locked_at is not null or o.status is distinct from 'written'
 or a.state not in ('acknowledged','completed') or jsonb_typeof(p_receipt) is distinct from 'object'
 or o.linear_result is distinct from p_receipt then raise exception 'provider_send_complete_binding';end if;
 if p_receipt->>'mutation' is distinct from a.request->>'kind' or p_receipt->'expected' is distinct from a.request->'variables'
 or a.provider_response->(a.request->>'kind')->'success' is distinct from 'true'::jsonb
 then raise exception 'provider_send_complete_evidence';end if;
 if a.request->>'kind' in ('issueCreate','issueUpdate') and (nullif(p_receipt->>'issue_id','') is null or p_receipt->>'issue_id' is distinct from a.provider_response->(a.request->>'kind')->'issue'->>'id') then raise exception 'provider_send_complete_evidence';end if;
 if a.request->>'kind' in ('commentCreate','commentUpdate') and (nullif(p_receipt->>'comment_id','') is null or p_receipt->>'comment_id' is distinct from a.provider_response->(a.request->>'kind')->'comment'->>'id') then raise exception 'provider_send_complete_evidence';end if;
 if a.request->>'kind'='attachmentCreate' and (nullif(p_receipt->>'attachment_id','') is null or p_receipt->>'attachment_id' is distinct from a.provider_response->'attachmentCreate'->'attachment'->>'id') then raise exception 'provider_send_complete_evidence';end if;
 if a.request->>'kind'='commentDelete' and (nullif(p_receipt->>'comment_id','') is null or p_receipt->>'comment_id' is distinct from a.request->'variables'->>'id') then raise exception 'provider_send_complete_evidence';end if;
 if a.request->>'kind' in ('issueArchive','issueUnarchive') and (nullif(p_receipt->>'issue_id','') is null or p_receipt->>'issue_id' is distinct from a.request->'variables'->>'id') then raise exception 'provider_send_complete_evidence';end if;
 if a.state='completed' and a.local_receipt is distinct from p_receipt then raise exception 'provider_send_complete_conflict';end if;
 if a.state<>'completed' then update linear_exit_provider.send_attempts_v1 set state='completed',local_receipt=p_receipt,completed_at=clock_timestamp() where attempt_id=a.attempt_id;end if;
 return jsonb_build_object('completed',true,'external_worker_coverage_proven',false);
end $fn$;

create function public.production_provider_send_drain_v1(p_epoch uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; unresolved bigint;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_send_drain_gate';end if;
 select count(*) into unresolved from linear_exit_provider.send_attempts_v1 where state<>'completed';
 if unresolved<>0 then raise exception 'provider_send_unresolved_attempts';end if;
 return jsonb_build_object('tracked_attempts_drained',true,'external_worker_coverage_proven',false,'old_history_proven',false,'activation_authorized',false);
end $fn$;
create function linear_exit_provider.refuse_unresolved_seal_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if new.mode='sealed' and exists(select from linear_exit_provider.send_attempts_v1 where state<>'completed') then raise exception 'provider_send_unresolved_attempts';end if;
 return new;
end $fn$;
revoke all on function linear_exit_provider.refuse_unresolved_seal_v1() from public,anon,authenticated,service_role;
create trigger provider_send_unresolved_seal_v1 before update on public.card_write_admission_v1 for each row execute function linear_exit_provider.refuse_unresolved_seal_v1();
revoke all on function public.production_provider_send_admit_v1(uuid,bigint,text,jsonb,jsonb),public.production_provider_send_ack_v1(uuid,text,jsonb,jsonb),public.production_provider_send_complete_v1(uuid,text,jsonb),public.production_provider_send_drain_v1(uuid) from public,anon,authenticated;
grant execute on function public.production_provider_send_admit_v1(uuid,bigint,text,jsonb,jsonb),public.production_provider_send_ack_v1(uuid,text,jsonb,jsonb),public.production_provider_send_complete_v1(uuid,text,jsonb),public.production_provider_send_drain_v1(uuid) to service_role;
commit;
