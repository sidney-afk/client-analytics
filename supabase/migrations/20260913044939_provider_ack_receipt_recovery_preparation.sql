-- Preparation only. V2 captures the existing source's receipt inputs before
-- sending. Older contextless attempts remain unreconstructible without evidence.
begin;
alter table linear_exit_provider.send_attempts_v1 add column receipt_context_v1 jsonb check(receipt_context_v1 is null or jsonb_typeof(receipt_context_v1)='object');
create or replace function linear_exit_provider.immutable_admission_preimage_v1() returns trigger
language plpgsql security definer set search_path=pg_catalog as $immutable$
begin
 if new.admission_preimage_v1 is distinct from old.admission_preimage_v1 or new.receipt_context_v1 is distinct from old.receipt_context_v1 then raise exception 'provider_admission_preimage_immutable';end if;
 return new;
end
$immutable$;
create function public.production_provider_send_admit_v2(p_epoch uuid,p_outbox_id bigint,p_lock_token text,p_request jsonb,p_replay_scope jsonb,p_receipt_context jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare gate public.card_write_admission_v1%rowtype; o public.mirror_outbox%rowtype; a linear_exit_provider.send_attempts_v1%rowtype;
begin
 if jsonb_typeof(p_receipt_context) is distinct from 'object' or p_receipt_context->>'format' is distinct from 'provider-receipt-context-v1' or (select array_agg(k order by k) from jsonb_object_keys(p_receipt_context) k) is distinct from array['context','format','issue','issueId','mirrorActor']::text[] or jsonb_typeof(p_receipt_context->'context') is distinct from 'object' or jsonb_typeof(p_receipt_context->'mirrorActor') is distinct from 'object' or jsonb_typeof(p_receipt_context->'issueId') is distinct from 'string' or (p_receipt_context->'issue'<>'null'::jsonb and jsonb_typeof(p_receipt_context->'issue')<>'object') or octet_length(p_receipt_context::text)>2097152 then raise exception 'provider_receipt_context_shape';end if;
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
 insert into linear_exit_provider.send_attempts_v1(epoch,outbox_id,team,lock_token,request,request_sha256,replay_scope,admission_preimage_v1,receipt_context_v1)
 values(gate.epoch,o.id,lower(o.team),p_lock_token,p_request,encode(extensions.digest(convert_to(p_request::text,'UTF8'),'sha256'),'hex'),p_replay_scope,to_jsonb(o),p_receipt_context) returning * into a;
 return jsonb_build_object('attempt_id',a.attempt_id,'epoch',a.epoch,'outbox_id',a.outbox_id::text,'request_sha256',a.request_sha256);
end $fn$;
create function public.production_provider_receipt_clean_v1(p_value jsonb) returns text
language plpgsql immutable security invoker set search_path=pg_catalog as $clean$
begin
 if p_value is null or p_value='null'::jsonb then return '';end if;
 if jsonb_typeof(p_value)<>'string' then raise exception 'provider_receipt_scalar_shape';end if;
 return btrim(p_value#>>'{}',chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
end
$clean$;
revoke all on function public.production_provider_receipt_clean_v1(jsonb) from public,anon,authenticated,service_role;
create function public.production_provider_ack_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype; a linear_exit_provider.send_attempts_v1%rowtype; o public.mirror_outbox%rowtype; receipt jsonb; result_issue jsonb; ctx jsonb; after_row jsonb; result jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_ack_recovery_gate';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_ack_recovery_preimage';end if;
 if a.receipt_context_v1 is null or a.admission_preimage_v1 is null then raise exception 'provider_ack_recovery_context_unproven';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_ack_recovery_original_intent_changed';end if;
 if o.linear_result is not null then return public.production_provider_checkpoint_recover_v1(p_epoch,p_attempt_id,p_expected_outbox);end if;
 if a.state<>'acknowledged' or a.request->>'kind'<>'issueUpdate' or o.operation not in ('status','due','assignee','title','priority','parent','labels','description') or a.provider_response->'issueUpdate'->'success' is distinct from 'true'::jsonb or jsonb_typeof(a.provider_response->'issueUpdate'->'issue') is distinct from 'object' then raise exception 'provider_ack_recovery_operation_or_observation';end if;
 if o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_ack_recovery_lock';end if;
 ctx:=a.receipt_context_v1;result_issue:=a.provider_response->'issueUpdate'->'issue';
 receipt:=jsonb_build_object('mutation','issueUpdate','issue_id',coalesce(nullif(public.production_provider_receipt_clean_v1(result_issue->'id'),''),ctx->>'issueId'),'identifier',public.production_provider_receipt_clean_v1(result_issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(case when result_issue->'updatedAt' is null or result_issue->'updatedAt' in ('null'::jsonb,'""'::jsonb) then result_issue->'createdAt' else result_issue->'updatedAt' end),'comment_id',null,'attachment_id',null,'attachment_url',null,'attachment_revision',null,'mirror_actor_id',public.production_provider_receipt_clean_v1(ctx->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(ctx->'mirrorActor'->'name'),'expected',a.request->'variables');
 after_row:=to_jsonb(o)||jsonb_build_object('linear_result',receipt,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set linear_result=receipt,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 select * into strict o from public.mirror_outbox where id=o.id;
 result:=public.production_provider_checkpoint_recover_v1(p_epoch,p_attempt_id,to_jsonb(o));
 return result||jsonb_build_object('reconstructed_source_receipt',true,'provider_resent',false);
end
$recover$;
revoke all on function public.production_provider_send_admit_v2(uuid,bigint,text,jsonb,jsonb,jsonb),public.production_provider_ack_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_send_admit_v2(uuid,bigint,text,jsonb,jsonb,jsonb),public.production_provider_ack_recover_v1(uuid,uuid,jsonb) to service_role;
commit;
