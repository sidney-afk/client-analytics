-- Preparation only: recorded batch/non-F203 create linkage; no provider calls.
begin;
create function public.production_provider_create_intent_v1(payload jsonb,ctx jsonb,issue jsonb,input jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,public as $intent$
declare k text;expected_value text;actual_value text;
begin
 -- Source createIntentMismatches checks, including same-target autolink equivalence.
 foreach k in array array['team','project'] loop
  expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->(k||'_id'),'""'::jsonb),ctx->(k||'_id')));
  if expected_value='' or public.production_provider_receipt_clean_v1(issue->k->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->(k||'Id')) is distinct from expected_value then raise exception 'provider_create_intent_%',k;end if;
 end loop;
 if public.production_provider_receipt_clean_v1(issue->'title') is distinct from public.production_provider_receipt_clean_v1(payload->'title') or input->>'title' is distinct from public.production_provider_receipt_clean_v1(payload->'title') then raise exception 'provider_create_intent_title';end if;
 if payload ? 'description' and ((issue ? 'description' and jsonb_typeof(issue->'description') not in ('null','string')) or jsonb_typeof(payload->'description') is distinct from 'string' or public.production_provider_create_autolinks_v1(coalesce(issue->>'description','')) is distinct from public.production_provider_create_autolinks_v1(payload->>'description') or coalesce(input->>'description','') is distinct from payload->>'description') then raise exception 'provider_create_intent_description';end if;
 if payload ? 'status' or payload ? 'state_id' then
  if nullif(public.production_provider_receipt_clean_v1(ctx->'state_id'),'') is null or public.production_provider_receipt_clean_v1(issue->'state'->'id') is distinct from public.production_provider_receipt_clean_v1(ctx->'state_id') or public.production_provider_receipt_clean_v1(input->'stateId') is distinct from public.production_provider_receipt_clean_v1(ctx->'state_id') then raise exception 'provider_create_intent_status';end if;
 end if;
 if payload ? 'due_date' and (public.production_provider_receipt_clean_v1(issue->'dueDate') is distinct from public.production_provider_receipt_clean_v1(payload->'due_date') or public.production_provider_receipt_clean_v1(input->'dueDate') is distinct from public.production_provider_receipt_clean_v1(payload->'due_date')) then raise exception 'provider_create_intent_due';end if;
 if payload ? 'assignee_id' or payload ? 'linear_user_id' then
  expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->'linear_user_id','""'::jsonb),ctx->'linear_user_id'));
  if public.production_provider_receipt_clean_v1(issue->'assignee'->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->'assigneeId') is distinct from expected_value then raise exception 'provider_create_intent_assignee';end if;
 end if;
 if payload ? 'priority' and (coalesce(nullif(payload->>'priority',''),'0')::numeric is distinct from coalesce(issue->>'priority','0')::numeric or coalesce(nullif(payload->>'priority',''),'0')::numeric is distinct from coalesce(input->>'priority','0')::numeric) then raise exception 'provider_create_intent_priority';end if;
 expected_value:=public.production_provider_receipt_clean_v1(coalesce(nullif(payload->'parent_linear_issue_id','""'::jsonb),ctx->'parent_linear_issue_id'));
 if public.production_provider_receipt_clean_v1(issue->'parent'->'id') is distinct from expected_value or public.production_provider_receipt_clean_v1(input->'parentId') is distinct from expected_value then raise exception 'provider_create_intent_parent';end if;
 if payload ? 'label_ids' then
  if jsonb_typeof(payload->'label_ids') is distinct from 'array' or jsonb_typeof(issue->'labelIds') is distinct from 'array' or jsonb_typeof(input->'labelIds') is distinct from 'array' then raise exception 'provider_create_intent_labels';end if;
  if (select coalesce(jsonb_agg(v order by v),'[]') from (select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(payload->'label_ids'))x where v<>'') is distinct from (select coalesce(jsonb_agg(v order by v),'[]') from (select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(issue->'labelIds'))x where v<>'') or input->'labelIds' is distinct from payload->'label_ids' then raise exception 'provider_create_intent_labels';end if;
 end if;

end $intent$;
revoke all on function public.production_provider_create_intent_v1(jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.production_provider_create_uuid_v1(p_key text)
returns text language plpgsql immutable set search_path=pg_catalog as $uuid$
declare key text:=public.production_provider_receipt_clean_v1(to_jsonb(p_key));bytes bytea;hex text;
begin
 if key='' then raise exception 'create_dedup_key_required';end if;
 bytes:=substring(extensions.digest(decode('8ec6f2de20f44dc38f218b3298e780db','hex')||convert_to(key,'UTF8'),'sha1') from 1 for 16);
 bytes:=set_byte(bytes,6,(get_byte(bytes,6)&15)|64);bytes:=set_byte(bytes,8,(get_byte(bytes,8)&63)|128);hex:=encode(bytes,'hex');
 return substr(hex,1,8)||'-'||substr(hex,9,4)||'-'||substr(hex,13,4)||'-'||substr(hex,17,4)||'-'||substr(hex,21,12);
end $uuid$;
revoke all on function public.production_provider_create_uuid_v1(text) from public,anon,authenticated,service_role;
create function public.production_provider_parent_team_v1(p_key jsonb)
returns text language sql immutable set search_path=pg_catalog as $team$
 select case when lower(public.production_provider_receipt_clean_v1(p_key)) in ('gra','graphic','graphics') then 'graphics' else 'video' end
$team$;
revoke all on function public.production_provider_parent_team_v1(jsonb) from public,anon,authenticated,service_role;
create function public.production_provider_parent_merge_v1(p_raw jsonb,p_teams jsonb,p_issue jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $merge$
declare parsed jsonb:=p_raw;parents jsonb:='{}';item jsonb;entry record;key text;owner text;teams jsonb;
begin
 if jsonb_typeof(parsed)='string' then begin parsed:=(parsed#>>'{}')::jsonb;exception when invalid_text_representation then parsed:='{}';end;end if;
 if jsonb_typeof(parsed)='array' then
  for item in select value from jsonb_array_elements(parsed) loop
   if jsonb_typeof(item)<>'object' then continue;end if;
   key:=public.production_provider_parent_team_v1(coalesce(nullif(nullif(item->'team','null'),'""'),nullif(nullif(item->'team_key','null'),'""'),item->'key'));
   parents:=jsonb_set(parents,array[key],jsonb_build_object('uuid',public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(item->'uuid','null'),'""'),nullif(nullif(item->'id','null'),'""'),item->'linear_issue_id')),'identifier',public.production_provider_receipt_clean_v1(item->'identifier'),'url',public.production_provider_receipt_clean_v1(item->'url')),true);
  end loop;
 elsif jsonb_typeof(parsed)='object' then
  for entry in select * from jsonb_each(parsed) loop
   if jsonb_typeof(entry.value)<>'object' then continue;end if;
   parents:=jsonb_set(parents,array[public.production_provider_parent_team_v1(to_jsonb(entry.key))],entry.value,true);
  end loop;
 end if;
 teams:=case when jsonb_typeof(p_teams)='array' then p_teams else jsonb_build_array(p_teams) end;owner:=public.production_provider_parent_team_v1(teams->0);
 for item in select value from jsonb_array_elements(teams) loop
  key:=public.production_provider_parent_team_v1(item);
  parents:=jsonb_set(parents,array[key],coalesce(parents->key,'{}')||jsonb_build_object('uuid',public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(p_issue->'id','null'),'""'),p_issue->'uuid')),'identifier',public.production_provider_receipt_clean_v1(p_issue->'identifier'),'url',public.production_provider_receipt_clean_v1(p_issue->'url'),'owner_team',owner),true);
 end loop;
 return parents;
end $merge$;
revoke all on function public.production_provider_parent_merge_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function public.production_application_dml_guard_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; context public.card_write_transaction_context_v1%rowtype; before_row jsonb;after_row jsonb; item jsonb; allowed boolean:=false; card_table text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 select * into context from public.card_write_transaction_context_v1 where transaction_id=txid_current() and backend_pid=pg_backend_pid() and epoch=gate.epoch;
 if gate.mode='open' and context.kind is distinct from 'followup' then
  if tg_level='STATEMENT' then return null;elsif tg_op='DELETE' then return old;else return new;end if;
 end if;
 if context.kind='flag_control' then
  if tg_level='STATEMENT' then
   if (tg_table_name='syncview_runtime_flags' and tg_op='UPDATE') or (tg_table_name='flag_flips' and tg_op='INSERT') then return null;end if;
  else
   before_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
   after_row:=case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
   if tg_table_name='syncview_runtime_flags' and tg_op='UPDATE' then
    allowed:=before_row->>'key'=context.scope->>'key' and after_row->>'key'=context.scope->>'key' and before_row->'value'=context.scope->'before' and after_row->'value'=context.scope->'after' and after_row->>'updated_by'=context.scope->>'actor' and (before_row-array['value','updated_by','updated_at'])=(after_row-array['value','updated_by','updated_at']);
   elsif tg_table_name='flag_flips' and tg_op='INSERT' then
    allowed:=after_row->>'key'=context.scope->>'key' and after_row->'old_value'=context.scope->'before' and after_row->'new_value'=context.scope->'after' and after_row->>'actor'=context.scope->>'actor';
   end if;
  end if;
 elsif context.kind='provider_recovery' then
  if tg_level='STATEMENT' then
   if (tg_table_name='mirror_outbox' and tg_op='UPDATE') or (tg_table_name='production_comments' and tg_op='UPDATE' and context.scope ? 'comment_before') or (tg_table_name='deliverable_events' and tg_op='INSERT' and context.scope ? 'comment_event') or (tg_table_name='card_change_journal' and tg_op='INSERT' and (context.scope ? 'comment_before' or context.scope ? 'create_before')) or (tg_table_name='deliverables' and tg_op='UPDATE' and context.scope ? 'create_before') or (tg_table_name='deliverable_events' and tg_op='INSERT' and context.scope ? 'create_event') or (context.scope ? 'legacy_before' and ((tg_table_name=context.scope->>'legacy_table' and tg_table_name in ('batches','deliverables') and tg_op='UPDATE') or (tg_table_name in ('card_change_journal','deliverable_events') and tg_op='INSERT'))) then return null;end if;
  elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'before' and to_jsonb(new)=context.scope->'after';
  elsif tg_table_name='production_comments' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'comment_before' and to_jsonb(new)=context.scope->'comment_after';
  elsif tg_table_name=context.scope->>'legacy_table' and tg_table_name in ('batches','deliverables') and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'legacy_before' and to_jsonb(new)=context.scope->'legacy_after';
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' and context.scope ? 'legacy_before' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'=context.scope->>'legacy_table' and after_row->>'operation'='UPDATE'
    and case when context.scope->>'legacy_table'='batches' then jsonb_populate_record(null::public.batches,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.batches,context.scope->'legacy_before') and jsonb_populate_record(null::public.batches,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.batches,context.scope->'legacy_after') else jsonb_populate_record(null::public.deliverables,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'legacy_before') and jsonb_populate_record(null::public.deliverables,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'legacy_after') end
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'legacy_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'legacy_after'->'id')
    and after_row->>'client_before'=context.scope->'legacy_before'->>'client_slug' and after_row->>'client_after'=context.scope->'legacy_after'->>'client_slug' and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='deliverables' and tg_op='UPDATE' then
   allowed:=to_jsonb(old)=context.scope->'create_before' and to_jsonb(new)=context.scope->'create_after';
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' and context.scope ? 'create_before' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'='deliverables' and after_row->>'operation'='UPDATE'
    and jsonb_populate_record(null::public.deliverables,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'create_before')
    and jsonb_populate_record(null::public.deliverables,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.deliverables,context.scope->'create_after')
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'create_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'create_after'->'id')
    and after_row->>'client_before'=context.scope->'create_before'->>'client_slug' and after_row->>'client_after'=context.scope->'create_after'->>'client_slug' and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='card_change_journal' and tg_op='INSERT' then
   after_row:=to_jsonb(new);
   allowed:=after_row->>'relation_schema'='public' and after_row->>'relation_name'='production_comments' and after_row->>'operation'='UPDATE'
    and jsonb_populate_record(null::public.production_comments,after_row->'row_before') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_before') and jsonb_populate_record(null::public.production_comments,after_row->'row_after') is not distinct from jsonb_populate_record(null::public.production_comments,context.scope->'comment_after')
    and after_row->'entity_key_before'=jsonb_build_object('id',context.scope->'comment_before'->'id') and after_row->'entity_key_after'=jsonb_build_object('id',context.scope->'comment_after'->'id')
    and after_row->>'client_before'=context.scope->'comment_before'->>'client_slug' and after_row->>'client_after'=context.scope->'comment_after'->>'client_slug'
    and after_row->>'transaction_id'=txid_current()::text;
  elsif tg_table_name='deliverable_events' and tg_op='INSERT' then
   allowed:=(to_jsonb(new)-'id')=coalesce(context.scope->'comment_event',context.scope->'create_event',context.scope->'legacy_event');
  end if;
 elsif context.kind='provider_snapshot' then
  if tg_level='STATEMENT' then
   if (tg_table_name='track_b_team_rollbacks' and tg_op in ('INSERT','UPDATE')) or (tg_table_name='track_b_team_rollback_intents' and tg_op='INSERT') or (tg_table_name='mirror_outbox' and tg_op='UPDATE') then return null;end if;
  else
   before_row:=case when tg_op='UPDATE' then to_jsonb(old) else null end;after_row:=to_jsonb(new);
   if tg_table_name='track_b_team_rollbacks' and tg_op='INSERT' then
    allowed:=not(context.scope?'rollback') and (after_row-array['id','correlation_id','opened_at'])=jsonb_build_object('team',context.scope->>'team','is_drill',false,'state','open','expected_authority',context.scope->'authority','prior_outbound',jsonb_build_object('mode','off'),'prior_parity',jsonb_build_object('enabled',false),'fence_generation',context.scope->'generation','snapshot_count',0,'snapshot_sha256',null,'terminal_receipt',null,'actor',context.scope->>'actor','completed_at',null);
    if coalesce(allowed,false) then update public.card_write_transaction_context_v1 set scope=scope||jsonb_build_object('rollback',after_row) where transaction_id=context.transaction_id;end if;
   elsif tg_table_name='track_b_team_rollbacks' and tg_op='UPDATE' then
    allowed:=before_row=context.scope->'rollback' and after_row=before_row||jsonb_build_object('snapshot_count',jsonb_array_length(context.scope->'rows'),'snapshot_sha256',context.scope->>'snapshot_hash');
   elsif tg_table_name='track_b_team_rollback_intents' and tg_op='INSERT' then
    select value into item from jsonb_array_elements(context.scope->'rows') where value->>'id'=after_row->>'outbox_id';
    allowed:=item is not null and after_row=jsonb_build_object('rollback_id',context.scope->'rollback'->'id','outbox_id',item->'id','row_snapshot',item,'row_sha256',encode(extensions.digest(convert_to(item::text,'UTF8'),'sha256'),'hex'),'classification',null,'classification_history','[]'::jsonb,'reason',null,'classified_by',null,'classified_at',null,'terminal_receipt',null);
   elsif tg_table_name='mirror_outbox' and tg_op='UPDATE' then
    allowed:=exists(select from jsonb_array_elements(context.scope->'rows') r where r.value=before_row) and after_row=before_row||jsonb_build_object('status','skipped','last_error','F27 hold '||(context.scope->'rollback'->>'correlation_id'),'next_retry_at',null,'updated_at',to_jsonb(now()));
   end if;
  end if;
 elsif context.kind='provider_disposition' then
  if tg_level='STATEMENT' then
   if tg_op='UPDATE' and tg_table_name in ('mirror_outbox','track_b_team_rollback_intents') then return null;end if;
  elsif tg_op='UPDATE' then
   before_row:=to_jsonb(old);after_row:=to_jsonb(new);
   if tg_table_name='mirror_outbox' then
    allowed:=before_row=context.scope->'outbox' and context.scope->>'classification'='discard'
     and (before_row-array['processed_at','next_retry_at','last_error','updated_at'])=(after_row-array['processed_at','next_retry_at','last_error','updated_at'])
     and after_row->>'status'='skipped' and after_row->'next_retry_at'='null'::jsonb
     and after_row->>'last_error'='F27 discard: '||(context.scope->>'reason');
   elsif tg_table_name='track_b_team_rollback_intents' then
    allowed:=before_row=context.scope->'intent'
     and (before_row-array['classification','reason','classified_by','classified_at','classification_history'])=(after_row-array['classification','reason','classified_by','classified_at','classification_history'])
     and after_row->>'classification'=context.scope->>'classification'
     and after_row->>'reason'=context.scope->>'reason' and after_row->>'classified_by'=context.scope->>'actor'
     and after_row->'classification_history'=(before_row->'classification_history')||jsonb_build_array(jsonb_build_object('from',before_row->'classification','to',context.scope->>'classification','reason',context.scope->>'reason','actor',context.scope->>'actor','at',now()));
   end if;
  end if;
 elsif context.kind='followup' then
  card_table:=case context.scope->>'surface' when 'calendar' then 'calendar_posts' when 'samples' then 'sample_reviews' end;
  if tg_level='STATEMENT' then
   if tg_op<>'TRUNCATE' and tg_table_name in ('thumbnail_media_revisions',card_table,'card_change_journal') then return null;end if;
  else
   before_row:=case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end;
   after_row:=case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end;
   allowed:=true;
   for item in select value from jsonb_array_elements(jsonb_build_array(before_row,after_row)) where value<>'null'::jsonb loop
    if tg_table_name='thumbnail_media_revisions' then
     allowed:=allowed and item->>'surface'=context.scope->>'surface' and item->>'client'=context.scope->>'client' and item->>'source_id'=context.scope->>'sourceId';
    elsif tg_table_name=card_table then
     allowed:=allowed and item->>'client'=context.scope->>'client' and item->>'id'=context.scope->>'sourceId' and tg_op='UPDATE';
    elsif tg_table_name='card_change_journal' and tg_op='INSERT' then
     allowed:=allowed and item->>'relation_name'=card_table and item->>'client_after'=context.scope->>'client' and item->'entity_key_after'->>'id'=context.scope->>'sourceId' and item->'entity_key_after'->>'client'=context.scope->>'client';
    else allowed:=false;end if;
   end loop;
  end if;
 end if;
 if not coalesce(allowed,false) then raise exception 'application_dml_admission_closed_or_scope_refused:%',tg_table_name;end if;
 if context.kind='followup' then
  update public.card_write_transaction_context_v1 set effect_count=effect_count+1,effect_hashes=effect_hashes||jsonb_build_array(jsonb_build_object('table',tg_table_name,'operation',tg_op,'row_id',coalesce(after_row->>'id',before_row->>'id'),'sha256',encode(extensions.digest(convert_to(jsonb_build_array(before_row,after_row)::text,'UTF8'),'sha256'),'hex'))) where transaction_id=context.transaction_id;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $fn$;
create function public.production_provider_create_labels_v1(payload jsonb,initial jsonb,issue jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,public as $labels$
declare expected jsonb;nodes jsonb;connection jsonb;ids jsonb;
begin
 if not(payload ? 'label_ids') then return issue;end if;
 select coalesce(jsonb_agg(v order by v),'[]') into expected from (select distinct public.production_provider_receipt_clean_v1(value) v from jsonb_array_elements(payload->'label_ids'))x where v<>'';
 connection:=issue->'labels';nodes:=connection->'nodes';
 if jsonb_typeof(nodes)='array' then select coalesce(jsonb_agg(v order by v),'[]') into ids from (select distinct public.production_provider_receipt_clean_v1(value->'id') v from jsonb_array_elements(nodes))x where v<>'';end if;
 if connection->'pageInfo'->'hasNextPage'='false'::jsonb and jsonb_array_length(nodes)=jsonb_array_length(expected) and ids=expected then return issue||jsonb_build_object('labelIds',expected);end if;
 connection:=initial->'linear_raw'->'issue'->'labels';nodes:=connection->'nodes';ids:=null;
 if jsonb_typeof(nodes)='array' then select coalesce(jsonb_agg(v order by v),'[]') into ids from (select distinct public.production_provider_receipt_clean_v1(value->'id') v from jsonb_array_elements(nodes))x where v<>'';end if;
 if connection->'pageInfo'->'hasNextPage' is distinct from 'false'::jsonb or jsonb_typeof(nodes) is distinct from 'array' or jsonb_array_length(nodes) is distinct from jsonb_array_length(expected) or ids is distinct from expected then raise exception 'provider_recorded_create_labels_incomplete';end if;
 return issue||jsonb_build_object('labelIds',expected,'labels',connection);
end $labels$;
revoke all on function public.production_provider_create_labels_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
create function public.production_provider_recorded_create_recover_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $recover$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;b public.batches%rowtype;d public.deliverables%rowtype;ctx jsonb;initial jsonb;current_row jsonb;next_row jsonb;payload jsonb;issue jsonb;complete_issue jsonb;input jsonb;receipt jsonb;after_row jsonb;event_row jsonb;event_payload jsonb;observed boolean;observation jsonb;pid text;k text;table_name text;teams jsonb;parents jsonb;next_parents jsonb;item jsonb;existing_id text;raw_issue jsonb;later_pending boolean;changed boolean;event_batch text;event_deliverable text;prior_event_setting text;audit_count integer;audit_needed boolean;hydrated_initial jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'provider_recorded_create_gate';end if;
 if (select value from public.syncview_runtime_flags where key='linear_outbound_enabled') is distinct from '{"mode":"off"}'::jsonb or (select value from public.syncview_runtime_flags where key='linear_legacy_parity_enabled') is distinct from '{"enabled":false}'::jsonb then raise exception 'provider_recorded_create_stops';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox then raise exception 'provider_recorded_create_preimage';end if;
 if a.admission_preimage_v1 is null or a.receipt_context_v1 is null then raise exception 'provider_recorded_create_context_unproven';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_recorded_create_original_intent_changed';end if;
 if a.request->>'kind' is distinct from 'issueCreate' or o.entity not in ('batch','deliverable') or o.operation is distinct from 'create' or nullif(public.production_provider_receipt_clean_v1(o.payload->'planned_linear_issue_id'),'') is not null or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_recorded_create_scope';end if;
 ctx:=a.receipt_context_v1->'context';initial:=ctx->'entity';payload:=o.payload;input:=a.request->'variables'->'input';pid:=public.production_provider_create_uuid_v1(o.dedup_key);
 if jsonb_typeof(initial) is distinct from 'object' or input->>'id' is distinct from pid or ctx->>'create_id' is distinct from pid then raise exception 'provider_recorded_create_deterministic_identity';end if;
 observed:=a.provider_response->>'format'='provider-create-read-observations-v1';
 if coalesce(observed,false) then
  if a.state not in ('admitted','completed') or a.provider_response->>'query_sha256' is distinct from '3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd' or a.provider_response->'variables' is distinct from jsonb_build_object('id',pid) or jsonb_typeof(a.provider_response->'observations') is distinct from 'array' or jsonb_array_length(a.provider_response->'observations')<1 then raise exception 'provider_recorded_create_observation';end if;
  observation:=a.provider_response->'observations'->-1->'response';
  if ((observation->>'http_status')::int between 200 and 299) is distinct from true or observation->'body' ? 'errors' or jsonb_typeof(observation->'body'->'data'->'issue') is distinct from 'object' then raise exception 'provider_recorded_create_unresolved';end if;
  issue:=observation->'body'->'data'->'issue';
 else
  if a.state not in ('acknowledged','completed') or a.provider_response->'issueCreate'->'success' is distinct from 'true'::jsonb then raise exception 'provider_recorded_create_ack';end if;
  issue:=a.provider_response->'issueCreate'->'issue';
 end if;
 if jsonb_typeof(issue) is distinct from 'object' or issue->>'id' is distinct from pid then raise exception 'provider_recorded_create_provider_identity';end if;
 perform public.production_provider_create_intent_v1(payload,ctx,issue,input);
 if o.entity='deliverable' then complete_issue:=public.production_provider_create_labels_v1(payload,initial,issue);end if;
 if o.entity='batch' then
  table_name:='batches';select * into strict b from public.batches where id=o.entity_id for update;current_row:=to_jsonb(b);event_batch:=b.id;event_deliverable:=null;
 else
  table_name:='deliverables';perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||o.entity_id,0));select * into strict d from public.deliverables where id=o.entity_id for update;current_row:=to_jsonb(d);event_batch:=d.batch_id;event_deliverable:=d.id;
 end if;
 foreach k in array array['id','client_slug','created_by'] loop
  if public.production_provider_receipt_clean_v1(current_row->k) is distinct from public.production_provider_receipt_clean_v1(initial->k) then raise exception 'provider_recorded_create_native_identity_%',k;end if;
 end loop;
 if current_row->>'id' is distinct from o.entity_id or current_row->>'client_slug' is distinct from o.client_slug or (current_row->>'created_at')::timestamptz is distinct from (initial->>'created_at')::timestamptz then raise exception 'provider_recorded_create_native_identity';end if;
 if o.entity='batch' then
  teams:=jsonb_build_array(o.team);if jsonb_typeof(payload->'_parent_teams')='array' then teams:=teams||(payload->'_parent_teams');end if;
  parents:=public.production_provider_parent_merge_v1(b.linear_parent_ids,'[]','{}');
  for item in select value from jsonb_array_elements(teams) loop
   if public.production_provider_receipt_clean_v1(item)='' then continue;end if;
   k:=public.production_provider_parent_team_v1(item);existing_id:=public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(parents->k->'uuid','null'),'""'),parents->k->'id'));
   if existing_id<>'' and existing_id<>pid then raise exception 'provider_recorded_create_parent_conflict';end if;
  end loop;
  select jsonb_agg(value) into teams from jsonb_array_elements(teams) where public.production_provider_receipt_clean_v1(value)<>'';
  next_parents:=public.production_provider_parent_merge_v1(b.linear_parent_ids,teams,issue);
  next_row:=current_row||jsonb_build_object('linear_parent_ids',next_parents);
 else
  foreach k in array array['batch_id','team','kind','origin','card_id'] loop
   if public.production_provider_receipt_clean_v1(current_row->k) is distinct from public.production_provider_receipt_clean_v1(initial->k) then raise exception 'provider_recorded_create_native_identity_%',k;end if;
  end loop;
  if d.team is distinct from o.team or (nullif(d.linear_issue_uuid,'') is not null and d.linear_issue_uuid<>pid) or jsonb_typeof(d.linear_raw) is distinct from 'object' then raise exception 'provider_recorded_create_native_link_conflict';end if;
  raw_issue:=coalesce(nullif(d.linear_raw->'issue','null'),'{}');if jsonb_typeof(raw_issue)<>'object' or (nullif(public.production_provider_receipt_clean_v1(raw_issue->'id'),'') is not null and raw_issue->>'id'<>pid) then raise exception 'provider_recorded_create_native_raw_conflict';end if;
  -- Initialize missing/unchanged partial label evidence only; later native label selections remain intact.
  if payload ? 'label_ids' and (not(raw_issue ? 'labels') or raw_issue->'labels'=initial->'linear_raw'->'issue'->'labels') then raw_issue:=raw_issue||jsonb_build_object('labels',complete_issue->'labels');if not(raw_issue ? 'labelIds') or raw_issue->'labelIds'=initial->'linear_raw'->'issue'->'labelIds' then raw_issue:=raw_issue||jsonb_build_object('labelIds',complete_issue->'labelIds');end if;end if;
  raw_issue:=raw_issue||jsonb_build_object('id',pid,'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'url',public.production_provider_receipt_clean_v1(issue->'url'));
  select exists(select from public.mirror_outbox where entity='deliverable' and entity_id=d.id and id>o.id and status in ('pending','failed','shadow_ok')) into later_pending;
  -- Recovery-owned hydration is an exact second baseline, not a general label-change exemption.
  hydrated_initial:=initial->'linear_raw';
  if payload ? 'label_ids' then hydrated_initial:=jsonb_set(hydrated_initial,'{issue}',coalesce(nullif(hydrated_initial->'issue','null'),'{}')||jsonb_build_object('labels',complete_issue->'labels','labelIds',complete_issue->'labelIds'),true);end if;
  later_pending:=later_pending or (current_row-array['updated_at','linear_issue_uuid','linear_identifier','linear_issue_url','sync_state','linear_raw']) is distinct from (initial-array['updated_at','linear_issue_uuid','linear_identifier','linear_issue_url','sync_state','linear_raw']) or ((d.linear_raw#-'{issue,id}'#-'{issue,identifier}'#-'{issue,url}') is distinct from (initial->'linear_raw'#-'{issue,id}'#-'{issue,identifier}'#-'{issue,url}') and (d.linear_raw#-'{issue,id}'#-'{issue,identifier}'#-'{issue,url}') is distinct from (hydrated_initial#-'{issue,id}'#-'{issue,identifier}'#-'{issue,url}'));
  next_row:=current_row||jsonb_build_object('linear_issue_uuid',pid,'linear_identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'linear_issue_url',public.production_provider_receipt_clean_v1(issue->'url'),'linear_raw',jsonb_set(d.linear_raw,'{issue}',raw_issue),'sync_state',case when later_pending then 'pending' else 'clean' end);
 end if;
 if coalesce(observed,false) then
  receipt:=coalesce(nullif(a.admission_preimage_v1->'linear_result','null'),'{}');if jsonb_typeof(receipt)<>'object' then raise exception 'provider_recorded_create_receipt_shape';end if;
  receipt:=receipt||jsonb_build_object('mutation','issueCreate','issue_id',pid,'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(issue->'updatedAt','null'),'""'),issue->'createdAt')),'mirror_actor_id',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'name'),'recovered_idempotently',true,'conflict',jsonb_build_object('decision','already_exists','reason','linear_issue_already_exists_exact'));
 else
  receipt:=jsonb_build_object('mutation','issueCreate','issue_id',pid,'identifier',public.production_provider_receipt_clean_v1(issue->'identifier'),'updated_at',public.production_provider_receipt_clean_v1(coalesce(nullif(nullif(issue->'updatedAt','null'),'""'),issue->'createdAt')),'comment_id',null,'attachment_id',null,'attachment_url',null,'attachment_revision',null,'mirror_actor_id',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'id'),'mirror_actor_name',public.production_provider_receipt_clean_v1(a.receipt_context_v1->'mirrorActor'->'name'),'expected',a.request->'variables','create_verification',jsonb_build_object('decision','already_exists','reason','linear_issue_already_exists_exact'));
 end if;
 if o.linear_result is not null and o.linear_result is distinct from receipt then raise exception 'provider_recorded_create_checkpoint_conflict';end if;
 changed:=next_row is distinct from current_row;
 event_payload:=jsonb_build_object('source','outbound','action','mirror_out_create_link','actor','SyncView Mirror','role','system','payload',jsonb_build_object('outbox_id',o.id));
 select count(*) into audit_count from public.deliverable_events e where e.action='mirror_out_create_link' and e.payload->'payload'->>'outbox_id'=o.id::text;
 if audit_count>1 or exists(select from public.deliverable_events e where e.action='mirror_out_create_link' and e.payload->'payload'->>'outbox_id'=o.id::text and (e.deliverable_id is distinct from event_deliverable or e.batch_id is distinct from event_batch or e.client_slug is distinct from o.client_slug or e.actor is distinct from 'SyncView Mirror' or e.role is distinct from 'system' or e.source is distinct from 'outbound' or e.to_status is not null or e.payload is distinct from event_payload)) then raise exception 'provider_recorded_create_audit_conflict';end if;
 audit_needed:=audit_count=0;
 if changed and not audit_needed then raise exception 'provider_recorded_create_audited_linkage_changed';end if;
 if a.state='completed' then
  if changed or audit_needed or o.status is distinct from 'written' or o.lock_token is not null or o.locked_at is not null or a.local_receipt is distinct from receipt or o.linear_result is distinct from receipt then raise exception 'provider_recorded_create_completed_binding';end if;
  return jsonb_build_object('completed',true,'provider_resent',false,'external_worker_coverage_proven',false);
 end if;
 if o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') then raise exception 'provider_recorded_create_lock';end if;
 if changed or audit_needed then
  if changed then next_row:=next_row||jsonb_build_object('updated_at',now());end if;

  event_row:=to_jsonb(jsonb_populate_record(null::public.deliverable_events,jsonb_build_object('deliverable_id',event_deliverable,'batch_id',event_batch,'client_slug',o.client_slug,'ts',now(),'actor','SyncView Mirror','role','system','action','mirror_out_create_link','from_status',current_row->'status','to_status',null,'source','outbound','payload',event_payload,'event_assignee_attribution','unknown')))-'id';
  insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('legacy_table',table_name,'legacy_before',current_row,'legacy_after',next_row,'legacy_event',event_row));
  prior_event_setting:=current_setting('app.event_written',true);perform set_config('app.event_written','1',true);
  if changed then
  if o.entity='batch' then update public.batches set linear_parent_ids=next_parents,updated_at=now() where id=b.id;
  else update public.deliverables set linear_issue_uuid=pid,linear_identifier=next_row->>'linear_identifier',linear_issue_url=next_row->>'linear_issue_url',linear_raw=next_row->'linear_raw',sync_state=next_row->>'sync_state',updated_at=now() where id=d.id;end if;
  end if;
  insert into public.deliverable_events(deliverable_id,batch_id,client_slug,ts,actor,role,action,from_status,to_status,source,payload) values(event_deliverable,event_batch,o.client_slug,now(),'SyncView Mirror','system','mirror_out_create_link',current_row->>'status',null,'outbound',event_payload);
  perform set_config('app.event_written',coalesce(prior_event_setting,''),true);delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 end if;
 after_row:=to_jsonb(o)||jsonb_build_object('linear_result',receipt,'status','written','processed_at',now(),'last_error',null,'next_retry_at',null,'attempts',coalesce(o.attempts,0)+1,'lock_token',null,'locked_at',null,'updated_at',now());
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'provider_recovery',jsonb_build_object('before',to_jsonb(o),'after',after_row));
 update public.mirror_outbox set linear_result=receipt,status='written',processed_at=now(),last_error=null,next_retry_at=null,attempts=coalesce(o.attempts,0)+1,lock_token=null,locked_at=null,updated_at=now() where id=o.id;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 if not coalesce(observed,false) then return public.production_provider_send_complete_v1(a.attempt_id,a.lock_token,receipt)||jsonb_build_object('linkage_only',true,'provider_resent',false);end if;
 update linear_exit_provider.send_attempts_v1 set state='completed',local_receipt=receipt,completed_at=clock_timestamp() where attempt_id=a.attempt_id;
 return jsonb_build_object('completed',true,'linkage_only',true,'recovered_by_read',true,'provider_resent',false,'external_worker_coverage_proven',false);
end $recover$;
revoke all on function public.production_provider_recorded_create_recover_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_recorded_create_recover_v1(uuid,uuid,jsonb) to service_role;
create function public.production_provider_recorded_create_observe_v1(p_epoch uuid,p_attempt_id uuid,p_expected_outbox jsonb,p_expected_observation jsonb,p_query text,p_variables jsonb,p_response jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $observe$
declare gate public.card_write_admission_v1%rowtype;a linear_exit_provider.send_attempts_v1%rowtype;o public.mirror_outbox%rowtype;history jsonb;envelope jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode<>'closed' or gate.epoch is distinct from p_epoch then raise exception 'provider_create_observe_gate';end if;
 select * into strict a from linear_exit_provider.send_attempts_v1 where attempt_id=p_attempt_id for update;
 select * into strict o from public.mirror_outbox where id=a.outbox_id for update;
 if to_jsonb(o) is distinct from p_expected_outbox or a.provider_response is distinct from p_expected_observation then raise exception 'provider_create_observe_cas';end if;
 if a.state<>'admitted' or a.admission_preimage_v1 is null or a.receipt_context_v1 is null or a.request->>'kind' is distinct from 'issueCreate' or o.entity not in ('batch','deliverable') or o.operation is distinct from 'create' or o.lock_token::text is distinct from a.lock_token or o.locked_at is null or o.status not in ('pending','failed','shadow_ok') or (a.replay_scope is not null and a.replay_scope<>'null'::jsonb) then raise exception 'provider_create_observe_attempt';end if;
 if (to_jsonb(o)-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) is distinct from (a.admission_preimage_v1-array['linear_result','updated_at','processed_at','last_error','next_retry_at','attempts','lock_token','locked_at','status']) then raise exception 'provider_create_observe_original_intent_changed';end if;
 if nullif(public.production_provider_receipt_clean_v1(o.payload->'planned_linear_issue_id'),'') is not null or a.receipt_context_v1->'context'->>'create_id' is distinct from public.production_provider_create_uuid_v1(o.dedup_key) then raise exception 'provider_recorded_create_observe_identity';end if;
 if encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex') is distinct from '3b9dca6d2c4958575692c69ef6999a1659ff13edef22cd01b13e85559fd395dd' or p_variables is distinct from jsonb_build_object('id',public.production_provider_create_uuid_v1(a.admission_preimage_v1->>'dedup_key')) or nullif(p_variables->>'id','') is null or a.request->'variables'->'input'->>'id' is distinct from p_variables->>'id' then raise exception 'provider_create_observe_query';end if;
 if jsonb_typeof(p_response) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_response)key) is distinct from array['body','http_status']::text[] or jsonb_typeof(p_response->'http_status') is distinct from 'number' or (p_response->>'http_status')::numeric not between 100 and 599 or trunc((p_response->>'http_status')::numeric)<>(p_response->>'http_status')::numeric or jsonb_typeof(p_response->'body') is distinct from 'object' or octet_length(p_response::text)>1048576 then raise exception 'provider_create_observe_response';end if;
 if a.provider_response is null then history:='[]'::jsonb;
 elsif a.provider_response->>'format'='provider-create-read-observations-v1' and a.provider_response->>'query_sha256'=encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex') and a.provider_response->'variables'=p_variables and jsonb_typeof(a.provider_response->'observations')='array' then history:=a.provider_response->'observations';
 else raise exception 'provider_create_observe_existing_evidence';end if;
 if jsonb_array_length(history)>=16 or octet_length(history::text)+octet_length(p_response::text)>4194304 then raise exception 'provider_create_observe_history_bound';end if;
 envelope:=jsonb_build_object('format','provider-create-read-observations-v1','query_sha256',encode(extensions.digest(convert_to(p_query,'UTF8'),'sha256'),'hex'),'variables',p_variables,'observations',history||jsonb_build_array(jsonb_build_object('sequence',jsonb_array_length(history)+1,'observed_at',clock_timestamp(),'response',p_response)));
 update linear_exit_provider.send_attempts_v1 set provider_response=envelope where attempt_id=a.attempt_id;
 return jsonb_build_object('recorded',true,'observation',envelope,'mutation_acknowledged',false,'provider_resent',false,'external_worker_coverage_proven',false);
end $observe$;
revoke all on function public.production_provider_recorded_create_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.production_provider_recorded_create_observe_v1(uuid,uuid,jsonb,jsonb,text,jsonb,jsonb) to service_role;

commit;
