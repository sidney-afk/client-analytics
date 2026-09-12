-- Additive outcome proofs for the pinned thumbnail helper. No provider execution.
begin;
alter table public.card_write_transaction_context_v1 add column owner_prestate jsonb not null default '{}';
create function public.card_followup_client_key_v1(v text) returns text language sql immutable set search_path=pg_catalog as $fn$
 select regexp_replace(regexp_replace(regexp_replace(regexp_replace(lower(btrim(normalize(coalesce(v,''),NFD))),U&'[\0300-\036f]','','g'),'^dr\.?\s+',''),'\s+(and|&)\s+','&','g'),'[^a-z0-9&]+','','g')
$fn$;
-- NULL means URL syntax outside this reviewed parser, not a guessed non-Drive URL.
create function public.card_followup_drive_id_v1(v text) returns text language plpgsql immutable set search_path=pg_catalog as $fn$
declare raw text:=btrim(coalesce(v,'')); parts text[]; host text; hit text[];
begin
 if raw='' or raw ~* 'drive[.]google[.]com/(drive/)?(u/[0-9]+/)?folders/' or raw ~* 'drive[.]google[.]com/folderview[?]' then return '';end if;
 if raw ~ '^[A-Za-z0-9_-]{20,}$' then return raw;end if;
 parts:=regexp_match(raw,'^(https?://)?([^/?#]+)(/[^?#]*)?([?]([^#]*))?(#.*)?$','i');
 if parts is null or parts[2] !~ '^[A-Za-z0-9.-]+(:[0-9]+)?$' then return null;end if;
 host:=regexp_replace(lower(parts[2]),':[0-9]+$','');
 if host !~ '(^|[.])(drive|docs)[.]google[.]com$' then return '';end if;
 hit:=regexp_match(coalesce(parts[3],''),'/(file|document|spreadsheets|presentation|drawings|forms)/d/([A-Za-z0-9_-]+)','i');
 if hit is not null then return hit[2];end if;
 if coalesce(parts[5],'') ~ '[%+]' then return null;end if;
 hit:=regexp_match(coalesce(parts[5],''),'(^|&)id=([^&]*)');
 if hit is not null and hit[2] ~ '^[A-Za-z0-9_-]{20,}$' then return hit[2];end if;
 return '';
end $fn$;
create function public.card_followup_feature_enabled_v1(p_client text) returns boolean language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare value jsonb; mode text; normalized text:=public.card_followup_client_key_v1(p_client);
begin
 select f.value into value from public.syncview_runtime_flags f where key='thumbnail_revision_v2' for share;
 mode:=lower(btrim(coalesce(value->>'mode','')));
 if mode not in ('on','test') or normalized='' then return false;end if;
 if not exists(select from public.clients where active and public.card_followup_client_key_v1(slug)=normalized) then return false;end if;
 if mode='on' then return true;end if;
 if jsonb_typeof(value->'clients') is distinct from 'array' then return false;end if;
 if exists(select from jsonb_array_elements(value->'clients') t where jsonb_typeof(t)<>'string') then raise exception 'followup_config_client_shape';end if;
 return exists(select from jsonb_array_elements_text(value->'clients') t where public.card_followup_client_key_v1(t)=normalized);
end $fn$;

create function public.production_card_followup_verify_outcome_v1(p_context public.card_write_transaction_context_v1,p_task public.card_write_followups_v1,p_outcome jsonb)
returns void language plpgsql security definer set search_path=public,pg_catalog as $fn$
#variable_conflict use_column
declare payload jsonb:=p_task.payload; reason text:=p_outcome->>'reason'; before_tweak boolean;after_tweak boolean;needed boolean; enabled boolean; url text; file_id text; cycle timestamptz; revision public.thumbnail_media_revisions%rowtype; item jsonb; source jsonb; card_table text; checked integer; changed integer;unchanged integer;skipped integer;is_touched boolean;
begin
 if jsonb_typeof(payload->'patch') is distinct from 'object' or jsonb_typeof(payload->'incoming') is distinct from 'object' or jsonb_typeof(payload->'existing') is distinct from 'object' then raise exception 'followup_payload_shape';end if;
 before_tweak:=strpos(lower(coalesce(payload->'existing'->>'graphic_status','')),'tweak')>0;after_tweak:=strpos(lower(coalesce(payload->'incoming'->>'graphic_status','')),'tweak')>0;
 if reason is not null then
  if p_task.kind='graphic_baseline' and p_outcome->'captured' is distinct from 'false'::jsonb then raise exception 'followup_noop_outcome_shape';end if;
  if p_task.kind='graphic_resolution' and (p_outcome->'checked' is distinct from '0'::jsonb or p_outcome->'changed' is distinct from '0'::jsonb or p_outcome->'unchanged' is distinct from '0'::jsonb or p_outcome->'failed' is distinct from '0'::jsonb or p_outcome->'skipped' is distinct from '0'::jsonb) then raise exception 'followup_noop_outcome_shape';end if;
 end if;
 needed:=(payload->'patch'?'graphic_status') and case p_task.kind when 'graphic_baseline' then after_tweak and not before_tweak else before_tweak and not after_tweak end;
 if not needed then
  if reason is distinct from (case p_task.kind when 'graphic_baseline' then 'not_graphic_tweaks_needed_transition' else 'not_graphic_tweaks_resolved_transition' end) or p_context.effect_count<>0 then raise exception 'followup_noop_mismatch';end if;return;
 end if;
 enabled:=public.card_followup_feature_enabled_v1(payload->>'client');
 if reason='feature_disabled' then if enabled or p_context.effect_count<>0 then raise exception 'followup_feature_disabled_forged';end if;return;end if;
 if not enabled then raise exception 'followup_feature_not_enabled';end if;
 cycle:=(payload->>'now')::timestamptz;
 card_table:=case payload->>'surface' when 'calendar' then 'calendar_posts' when 'samples' then 'sample_reviews' end;
 execute format('select to_jsonb(t) from public.%I t where client=$1 and id=$2 for share',card_table) into source using payload->>'client',payload->>'sourceId';
 if p_task.kind='graphic_baseline' then
  url:=btrim(coalesce(nullif(payload->'incoming'->>'thumbnail_url',''),payload->'existing'->>'thumbnail_url',''));file_id:=public.card_followup_drive_id_v1(url);
  if reason in ('missing_thumbnail_url','folder_link','not_drive_file') then
   if p_context.effect_count<>0 or not coalesce((case reason when 'missing_thumbnail_url' then url='' when 'folder_link' then url ~* 'drive[.]google[.]com/(drive/)?(u/[0-9]+/)?folders/' or url ~* 'drive[.]google[.]com/folderview[?]' else url<>'' and file_id='' and url !~* 'drive[.]google[.]com/(drive/)?(u/[0-9]+/)?folders/' and url !~* 'drive[.]google[.]com/folderview[?]' end),false) then raise exception 'followup_thumbnail_noop_forged';end if;return;
  end if;
  if file_id is null or file_id='' or cycle is null then raise exception 'followup_drive_or_cycle_unproven';end if;
  select * into revision from public.thumbnail_media_revisions where surface=payload->>'surface' and client=payload->>'client' and source_id=payload->>'sourceId' and reason='graphic_tweaks_needed' and status='pending' for update;
  if not found then raise exception 'followup_pending_row_required';end if;
  is_touched:=exists(select from jsonb_array_elements(p_context.effect_hashes) e where e->>'table'='thumbnail_media_revisions' and e->>'row_id'=revision.id::text);
  if reason='pending_exists' then
   if revision.requested_at<cycle or not is_touched or not exists(select from jsonb_array_elements(p_context.owner_prestate->'revisions') r where r->>'id'=revision.id::text and r->>'status'='pending') then raise exception 'followup_pending_exists_forged';end if;return;
  end if;
  if p_outcome->'captured' is distinct from 'true'::jsonb or reason is not null or not is_touched or not exists(select from jsonb_array_elements(p_context.effect_hashes) e where e->>'table'='thumbnail_media_revisions' and e->>'row_id'=revision.id::text and e->>'operation'='INSERT') or revision.requested_at is distinct from cycle or revision.thumbnail_url is distinct from url or revision.drive_file_id is distinct from file_id or coalesce(revision.baseline_storage_path,'') !~ '^immutable-sha256/[a-f0-9]{64}$' or coalesce(revision.baseline_bytes,0)<=0 or nullif(revision.error,'') is not null or exists(select from jsonb_array_elements(p_context.owner_prestate->'revisions') r where r->>'id'=revision.id::text) then raise exception 'followup_baseline_row_proof';end if;
  return;
 end if;
 if reason is not null or jsonb_typeof(p_outcome->'items') is distinct from 'array' or p_outcome->'failed' is distinct from '0'::jsonb then raise exception 'followup_resolution_outcome_shape';end if;
 checked:=(p_outcome->>'checked')::integer;changed:=(p_outcome->>'changed')::integer;unchanged:=(p_outcome->>'unchanged')::integer;skipped:=(p_outcome->>'skipped')::integer;
 if checked is null or changed is null or unchanged is null or skipped is null or checked not between 0 and 1 or least(changed,unchanged,skipped)<0 or checked<>changed+unchanged+skipped or checked<>jsonb_array_length(p_outcome->'items') then raise exception 'followup_resolution_counters';end if;
 if checked=0 then
  if exists(select from public.thumbnail_media_revisions where surface=payload->>'surface' and client=payload->>'client' and source_id=payload->>'sourceId' and reason='continuous_watch' and status='pending') then raise exception 'followup_empty_scan_forged';end if;return;
 end if;
 item:=p_outcome->'items'->0;
 select * into revision from public.thumbnail_media_revisions where id::text=item->>'id' and surface=payload->>'surface' and client=payload->>'client' and source_id=payload->>'sourceId' and reason='continuous_watch' for update;
 if not found or nullif(revision.error,'') is not null or not exists(select from jsonb_array_elements(p_context.effect_hashes) e where e->>'table'='thumbnail_media_revisions' and e->>'row_id'=revision.id::text) then raise exception 'followup_resolution_row_proof';end if;
 if item->>'status'='skipped' then
  if skipped<>1 or revision.status<>'skipped' or not coalesce(((revision.skip_reason='inactive_client' and not exists(select from public.clients where slug=payload->>'client' and active)) or (revision.skip_reason='source_not_active_drive_thumbnail' and (source is null or lower(btrim(source->>'status'))='archived' or public.card_followup_drive_id_v1(source->>'thumbnail_url')=''))),false) then raise exception 'followup_skipped_proof';end if;return;
 elsif item->>'status' in ('unchanged','initialized') then
  if unchanged<>1 or revision.status<>'pending' or nullif(revision.baseline_storage_path,'') is null or coalesce(revision.baseline_bytes,0)<=0 then raise exception 'followup_unchanged_proof';end if;
  if strpos(lower(coalesce(source->>'graphic_status','')),'tweak')=0 and exists(select from public.thumbnail_media_revisions where surface=payload->>'surface' and client=payload->>'client' and source_id=payload->>'sourceId' and reason='graphic_tweaks_needed' and status='pending' and requested_at<=cycle) then raise exception 'followup_nochange_retirement_missing';end if;return;
 elsif item->>'status'='changed' then
  if changed<>1 or revision.status<>'changed' or nullif(item->>'thumb_rev','') is null or source->>'thumb_rev' is distinct from item->>'thumb_rev' or source->>'thumb_rev' is not distinct from p_context.owner_prestate->'source'->>'thumb_rev' or coalesce(revision.latest_storage_path,'') !~ '^immutable-sha256/[a-f0-9]{64}$' or coalesce(revision.latest_bytes,0)<=0 or not exists(select from jsonb_array_elements(p_context.owner_prestate->'revisions') r where r->>'id'=revision.id::text and r->>'status'='pending') then raise exception 'followup_changed_proof';end if;return;
 end if;
 raise exception 'followup_resolution_disposition_unproven';
end $fn$;
revoke all on function public.card_followup_client_key_v1(text),public.card_followup_drive_id_v1(text),public.card_followup_feature_enabled_v1(text),public.production_card_followup_verify_outcome_v1(public.card_write_transaction_context_v1,public.card_write_followups_v1,jsonb) from public,anon,authenticated,service_role;
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

create or replace function public.production_card_followup_begin_v1(p_operation_id uuid,p_kind text,p_attempt integer,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare gate public.card_write_admission_v1%rowtype; task public.card_write_followups_v1%rowtype; source_row jsonb; prior_rows jsonb;
begin
 select * into strict gate from public.card_write_admission_v1 where singleton for share;
 if gate.mode='sealed' then raise exception 'card_followup_gate_sealed';end if;
 select * into strict task from public.card_write_followups_v1 where operation_id=p_operation_id and kind=p_kind for update;
 if task.state<>'running' or task.attempt is distinct from p_attempt or task.lease_token is distinct from p_lease or task.lease_until<clock_timestamp() then raise exception 'card_followup_begin_cas';end if;
 insert into public.card_write_transaction_context_v1(transaction_id,backend_pid,epoch,kind,operation_id,task_kind,attempt,lease_token,scope) values(txid_current(),pg_backend_pid(),gate.epoch,'followup',p_operation_id,p_kind,p_attempt,p_lease,task.payload);
 perform pg_advisory_xact_lock(hashtextextended('card-write:'||(task.payload->>'surface')||':'||(task.payload->>'client')||':'||(task.payload->>'sourceId'),0));
 execute format('select to_jsonb(t) from public.%I t where client=$1 and id=$2 for update',case task.payload->>'surface' when 'calendar' then 'calendar_posts' else 'sample_reviews' end) into source_row using task.payload->>'client',task.payload->>'sourceId';
 select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) into prior_rows from (select * from public.thumbnail_media_revisions where surface=task.payload->>'surface' and client=task.payload->>'client' and source_id=task.payload->>'sourceId' for update) r;
 update public.card_write_transaction_context_v1 set owner_prestate=jsonb_build_object('source',source_row,'revisions',prior_rows) where transaction_id=txid_current();
 return jsonb_build_object('payload',task.payload,'epoch',gate.epoch);
end $fn$;

create or replace function public.production_card_followup_complete_v1(p_operation_id uuid,p_kind text,p_attempt integer,p_lease uuid,p_outcome jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $fn$
declare context public.card_write_transaction_context_v1%rowtype; task public.card_write_followups_v1%rowtype; before_tweak boolean; after_tweak boolean; transition_required boolean;
begin
 select * into strict context from public.card_write_transaction_context_v1 where transaction_id=txid_current() and backend_pid=pg_backend_pid() and kind='followup';
 if context.operation_id is distinct from p_operation_id or context.task_kind is distinct from p_kind or context.attempt is distinct from p_attempt or context.lease_token is distinct from p_lease or jsonb_typeof(p_outcome) is distinct from 'object' then raise exception 'card_followup_complete_context';end if;
 select * into strict task from public.card_write_followups_v1 where operation_id=p_operation_id and kind=p_kind for update;
 if task.state<>'running' or task.attempt is distinct from p_attempt or task.lease_token is distinct from p_lease or task.lease_until<clock_timestamp() then raise exception 'card_followup_complete_cas';end if;
 perform public.production_card_followup_verify_outcome_v1(context,task,p_outcome);
 update public.card_write_followups_v1 set state='completed',outcome=jsonb_build_object('worker_result',p_outcome,'effect_hashes',context.effect_hashes,'effect_count',context.effect_count,'transaction_id',context.transaction_id),history=history||jsonb_build_array(jsonb_build_object('state','completed','attempt',attempt,'effect_count',context.effect_count,'at',clock_timestamp())),completed_at=clock_timestamp() where operation_id=p_operation_id and kind=p_kind;
 delete from public.card_write_transaction_context_v1 where transaction_id=context.transaction_id;
 return jsonb_build_object('completed',true,'effect_count',context.effect_count);
end $fn$;
commit;
