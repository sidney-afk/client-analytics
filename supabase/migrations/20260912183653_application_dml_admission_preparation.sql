-- Preparation DML boundary only. No DDL, sequence, Storage, Auth or activation proof.
begin;
alter table public.card_write_admission_v1 add column control_history jsonb not null default '[]' check(jsonb_typeof(control_history)='array');
alter table public.card_write_followups_v1 drop constraint card_write_followups_v1_state_check;
alter table public.card_write_followups_v1 add constraint card_write_followups_v1_state_check check(state in ('pending','running','failed','unknown','dispositioned','completed'));
create table public.card_write_transaction_context_v1(
 transaction_id bigint primary key, backend_pid integer not null, epoch uuid not null,
 kind text not null check(kind in ('flag_control','followup')),
 operation_id uuid, task_kind text, attempt integer, lease_token uuid,
 scope jsonb not null, effect_count integer not null default 0, effect_hashes jsonb not null default '[]'
);
alter table public.card_write_transaction_context_v1 enable row level security;
revoke all on public.card_write_transaction_context_v1 from public,anon,authenticated,service_role;
create function public.production_card_context_consumed_v1()
returns trigger language plpgsql security definer set search_path=public,pg_catalog as $fn$
begin
 if exists(select from public.card_write_transaction_context_v1 where transaction_id=new.transaction_id) then raise exception 'card_transaction_context_not_consumed';end if;
 return null;
end $fn$;
revoke all on function public.production_card_context_consumed_v1() from public,anon,authenticated,service_role;
create constraint trigger card_context_must_be_consumed after insert or update on public.card_write_transaction_context_v1 deferrable initially deferred for each row execute function public.production_card_context_consumed_v1();

create function public.production_application_dml_guard_v1()
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
  update public.card_write_transaction_context_v1 set effect_count=effect_count+1,effect_hashes=effect_hashes||jsonb_build_array(jsonb_build_object('table',tg_table_name,'operation',tg_op,'sha256',encode(extensions.digest(convert_to(jsonb_build_array(before_row,after_row)::text,'UTF8'),'sha256'),'hex'))) where transaction_id=context.transaction_id;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $fn$;
revoke all on function public.production_application_dml_guard_v1() from public,anon,authenticated,service_role;

-- The exact reviewed table list is generated below from the pinned V1 inventory.
-- A missing owner aborts installation. New tables/DDL require separate closure.
do 'declare t text; begin foreach t in array array[''ai_client_onboarding'',''batches'',''batches_parent_claim_backup_20260824'',''calendar_feedback_materializations'',''calendar_post_events'',''calendar_posts'',''caption_prompts'',''card_change_journal'',''client_access'',''client_access_events'',''client_credential_events'',''client_credentials'',''client_credentials_rev'',''client_onboarding'',''clients'',''content_samples'',''deliverable_events'',''deliverables'',''description_images'',''filming_plans'',''flag_flips'',''hiring_application_events'',''hiring_applications'',''hiring_invite_jobs'',''kasper_ad_campaign_daily'',''kasper_ad_leads'',''kasper_ad_performance_by_ad_daily'',''kasper_ad_performance_daily'',''kasper_ad_unfinished_leads'',''legacy_intake_native_triage'',''legacy_onboarding'',''linear_archive'',''linear_archive_asset_refs'',''linear_archive_asset_rescue_config'',''linear_intake_receipts'',''linear_outbound_cutoff_control'',''linear_project_ids_shape_migration_20260728'',''mirror_outbox'',''native_brief_media_occurrences'',''onboarding_fallback'',''production_asset_access_checks'',''production_card_materialization_ingress'',''production_card_materialization_receipts'',''production_card_provenance'',''production_comment_card_links'',''production_comment_import_conflicts'',''production_comment_mutation_receipts'',''production_comment_read_audit'',''production_comment_read_budget'',''production_comments'',''production_intake_manifests'',''production_label_catalog_versions'',''production_native_client_provisions'',''production_native_identifier_grants'',''production_native_identifier_mint'',''production_native_ordinary_receipt_admissions'',''production_notification_config'',''production_notification_delivery_receipts'',''production_notification_intents'',''production_notification_reconciliations'',''pto_adjustments'',''pto_members'',''pto_requests'',''public_intake_log'',''quiz_intake_log'',''quiz_responses'',''sales_intakes'',''sample_review_events'',''sample_reviews'',''settings_events'',''smm_weekly_reports'',''social_media_managers'',''syncview_auth_events'',''syncview_retirement_admission'',''syncview_runtime_flags'',''team_members'',''templates'',''thumbnail_media_revisions'',''tiktok_accounts'',''tiktok_oauth_state'',''tiktok_pilot_posts'',''track_b_f27_team_fences'',''track_b_team_rollback_intents'',''track_b_team_rollbacks'',''workload_issues'',''workload_plan''] loop if to_regclass(''public.''||t) is null then raise exception ''application_admission_missing_owner:%'',t;end if;execute format(''create trigger aaa_application_dml_admission_statement before insert or update or delete or truncate on public.%I for each statement execute function public.production_application_dml_guard_v1()'',t);execute format(''create trigger aaa_application_dml_admission_row before insert or update or delete on public.%I for each row execute function public.production_application_dml_guard_v1()'',t);end loop;end';

create function public.production_card_admission_flag_control_v1(p_epoch uuid,p_key text,p_expected jsonb,p_value jsonb,p_actor text,p_reason text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; previous jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null then raise exception 'admission_flag_control_cas';end if;
 if not ((p_key='linear_legacy_parity_enabled' and p_value='{"enabled":false}'::jsonb) or (p_key='linear_outbound_enabled' and p_value in ('{"mode":"off"}'::jsonb,'{"mode":"live"}'::jsonb))) then raise exception 'admission_flag_control_value';end if;
 select value into strict previous from public.syncview_runtime_flags where key=p_key for update;
 if previous is distinct from p_expected then raise exception 'admission_flag_control_preimage';end if;
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'flag_control',jsonb_build_object('key',p_key,'before',previous,'after',p_value,'actor',p_actor));
 update public.syncview_runtime_flags set value=p_value,updated_by=p_actor where key=p_key;
 delete from public.card_write_transaction_context_v1 where transaction_id=txid_current();
 update public.card_write_admission_v1 set control_history=control_history||jsonb_build_array(jsonb_build_object('action','flag_control','epoch',gate.epoch,'key',p_key,'before',previous,'after',p_value,'actor',p_actor,'reason',p_reason,'at',clock_timestamp())) where singleton;
 return jsonb_build_object('key',p_key,'value',p_value,'epoch',gate.epoch);
end $fn$;

create function public.production_card_admission_reopen_v1(p_epoch uuid,p_actor text,p_reason text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; next_epoch uuid:=gen_random_uuid(); retirement text;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 select mode into strict retirement from public.syncview_retirement_admission where singleton for share;
 if retirement<>'active' then raise exception 'admission_reopen_retired';end if;
 if gate.epoch is distinct from p_epoch or gate.mode not in ('closed','sealed') or nullif(btrim(p_actor),'') is null or nullif(btrim(p_reason),'') is null or p_confirmation is distinct from 'REOPEN_PRESERVING_ACCEPTED_WORK' then raise exception 'admission_reopen_cas';end if;
 update public.card_write_admission_v1 set epoch=next_epoch,mode='open',closed_at=null,sealed_at=null,reason=p_reason,control_history=control_history||jsonb_build_array(jsonb_build_object('action','reopen','prior_epoch',gate.epoch,'new_epoch',next_epoch,'actor',p_actor,'reason',p_reason,'at',clock_timestamp())) where singleton;
 return jsonb_build_object('epoch',next_epoch,'prior_epoch',gate.epoch,'accepted_work_preserved',true,'global_freeze_proven',false);
end $fn$;

create function public.production_card_followup_begin_v1(p_operation_id uuid,p_kind text,p_attempt integer,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; task public.card_write_followups_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode='sealed' then raise exception 'card_followup_gate_sealed';end if;
 select * into strict task from public.card_write_followups_v1 where operation_id=p_operation_id and kind=p_kind for update;
 if task.state<>'running' or task.attempt is distinct from p_attempt or task.lease_token is distinct from p_lease or task.lease_until<clock_timestamp() then raise exception 'card_followup_begin_cas';end if;
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,operation_id,task_kind,attempt,lease_token,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'followup',p_operation_id,p_kind,p_attempt,p_lease,task.payload);
 return jsonb_build_object('payload',task.payload,'epoch',gate.epoch);
end $fn$;

create function public.production_card_followup_complete_v1(p_operation_id uuid,p_kind text,p_attempt integer,p_lease uuid,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare context public.card_write_transaction_context_v1%rowtype; task public.card_write_followups_v1%rowtype; before_tweak boolean; after_tweak boolean; transition_required boolean;
begin
 select * into strict context from public.card_write_transaction_context_v1 where transaction_id=txid_current() and backend_pid=pg_backend_pid() and kind='followup';
 if context.operation_id is distinct from p_operation_id or context.task_kind is distinct from p_kind or context.attempt is distinct from p_attempt or context.lease_token is distinct from p_lease or jsonb_typeof(p_outcome) is distinct from 'object' then raise exception 'card_followup_complete_context';end if;
 select * into strict task from public.card_write_followups_v1 where operation_id=p_operation_id and kind=p_kind for update;
 if task.state<>'running' or task.attempt is distinct from p_attempt or task.lease_token is distinct from p_lease or task.lease_until<clock_timestamp() then raise exception 'card_followup_complete_cas';end if;
 if jsonb_typeof(task.payload->'patch') is distinct from 'object' or jsonb_typeof(task.payload->'incoming') is distinct from 'object' or jsonb_typeof(task.payload->'existing') is distinct from 'object' then raise exception 'card_followup_source_shape';end if;
 before_tweak:=strpos(lower(coalesce(task.payload->'existing'->>'graphic_status','')),'tweak')>0;
 after_tweak:=strpos(lower(coalesce(task.payload->'incoming'->>'graphic_status','')),'tweak')>0;
 transition_required:=(task.payload->'patch'?'graphic_status') and case p_kind when 'graphic_baseline' then after_tweak and not before_tweak else before_tweak and not after_tweak end;
 if not transition_required then
  if p_outcome->>'reason' is distinct from (case p_kind when 'graphic_baseline' then 'not_graphic_tweaks_needed_transition' else 'not_graphic_tweaks_resolved_transition' end) or context.effect_count<>0 then raise exception 'card_followup_noop_mismatch';end if;
 else
  if context.effect_count<1 then raise exception 'card_followup_no_effect_owner_proof';end if;
  if p_kind='graphic_baseline' then
   if p_outcome->'captured' is distinct from 'true'::jsonb then raise exception 'card_followup_baseline_outcome';end if;
  else
   if jsonb_typeof(p_outcome->'checked') is distinct from 'number' or (p_outcome->>'checked')::numeric<=0 or p_outcome->'failed' is distinct from '0'::jsonb or p_outcome->'skipped' is distinct from '0'::jsonb then raise exception 'card_followup_resolution_outcome';end if;
  end if;
 end if;
 update public.card_write_followups_v1 set state='completed',outcome=jsonb_build_object('worker_result',p_outcome,'effect_hashes',context.effect_hashes,'effect_count',context.effect_count,'transaction_id',context.transaction_id),history=history||jsonb_build_array(jsonb_build_object('state','completed','attempt',attempt,'effect_count',context.effect_count,'at',clock_timestamp())),completed_at=clock_timestamp() where operation_id=p_operation_id and kind=p_kind;
 delete from public.card_write_transaction_context_v1 where transaction_id=context.transaction_id;
 return jsonb_build_object('completed',true,'effect_count',context.effect_count);
end $fn$;

create or replace function public.production_card_admission_seal_v1(p_epoch uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for update;
 if gate.epoch is distinct from p_epoch or gate.mode<>'closed' then raise exception 'card_admission_seal_cas';end if;
 if exists(select from public.card_write_followups_v1 where state<>'completed' and not(state='dispositioned' and attempt=0)) then raise exception 'card_admission_unresolved_followups';end if;
 update public.card_write_admission_v1 set mode='sealed',sealed_at=clock_timestamp() where singleton;
 return jsonb_build_object('epoch',p_epoch,'scope','reviewed_application_dml_only','global_freeze_proven',false,'retirement_activated',false);
end $fn$;
revoke all on function public.production_card_admission_flag_control_v1(uuid,text,jsonb,jsonb,text,text),public.production_card_admission_reopen_v1(uuid,text,text,text),public.production_card_followup_begin_v1(uuid,text,integer,uuid),public.production_card_followup_complete_v1(uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.production_card_admission_flag_control_v1(uuid,text,jsonb,jsonb,text,text),public.production_card_admission_reopen_v1(uuid,text,text,text),public.production_card_followup_begin_v1(uuid,text,integer,uuid),public.production_card_followup_complete_v1(uuid,text,integer,uuid,jsonb) to service_role;
commit;
