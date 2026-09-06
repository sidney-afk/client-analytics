-- Draft/unapplied. Default provider mode. Requires the immutable catalog owner
-- and existing production/F27 writers. Selected37 recovery does NOT cover the
-- catalog owner or these new trigger/ACL definitions: installation stays held.
begin;
alter table public.production_label_catalog_versions add column operator_attestation jsonb;
insert into public.syncview_runtime_flags(key,value,updated_by) values
 ('production_native_label_catalog','{"schema_version":1,"mode":"provider","version_id":null}','native-labels-draft')
on conflict(key) do nothing;

-- A privileged operator assertion, NOT automatic verification of an export.
-- Before calling: independently verify the authenticated original export,
-- archived-inclusive page closure, workspace/team mapping and zero/counts.
-- The immutable evidence hashes identify that review; SQL cannot perform it.
create function public.production_label_catalog_stage_attested(p_version_id uuid,p_manifest jsonb,p_attestation jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_hash text; v_row public.production_label_catalog_versions;
begin
  v_hash:=public.production_label_catalog_check_manifest(p_manifest);
  if p_version_id is null or jsonb_typeof(p_attestation) is distinct from 'object'
     or p_attestation->>'contract' is distinct from 'operator-reviewed-complete-export-v1'
     or p_attestation->>'source_sha256' is distinct from p_manifest->>'source_sha256'
     or p_attestation->>'workspace_fingerprint' is distinct from p_manifest->>'workspace_fingerprint'
     or p_attestation->'teams' is distinct from p_manifest->'teams'
     or p_attestation->'expected_count' is distinct from p_manifest->'expected_count'
     or p_attestation->>'capture_id' is distinct from p_manifest->>'capture_id'
     or coalesce(p_attestation->>'export_package_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_attestation->>'review_evidence_sha256','') !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_attestation->'operator_subject') is distinct from 'string'
     or coalesce(btrim(p_attestation->>'operator_subject'),'')=''
     or length(p_attestation->>'operator_subject')>128
     or p_attestation->'archived_pages_verified' is distinct from 'true'::jsonb
     or p_attestation->'independent_count_reconciled' is distinct from 'true'::jsonb
     or coalesce(p_attestation->>'reviewed_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then
    raise exception 'native_label_catalog_unverified';
  end if;
  perform (p_attestation->>'reviewed_at')::timestamptz;
  insert into public.production_label_catalog_versions(version_id,schema_version,manifest,manifest_sha256,operator_attestation)
    values(p_version_id,1,p_manifest,v_hash,p_attestation) on conflict(version_id) do nothing;
  select * into strict v_row from public.production_label_catalog_versions where version_id=p_version_id;
  if v_row.manifest is distinct from p_manifest or v_row.operator_attestation is distinct from p_attestation
     or v_row.manifest_sha256 is distinct from v_hash then raise exception 'label_catalog_version_conflict'; end if;
  return jsonb_build_object('ok',true,'version_id',p_version_id,'manifest_sha256',v_hash,
    'operator_attested',true,'provider_completeness_verified',false,'activated',false);
end; $$;

create function public.production_label_catalog_read_attested(p_version_id uuid,p_team text)
returns jsonb language plpgsql security definer stable set search_path=pg_catalog,public as $$
declare v_read jsonb; v_attestation jsonb;
begin
  v_read:=public.production_label_catalog_read_version(p_version_id,p_team);
  select operator_attestation into v_attestation from public.production_label_catalog_versions where version_id=p_version_id;
  if v_attestation is null then raise exception 'native_label_catalog_unverified'; end if;
  return v_read||jsonb_build_object('operator_attested',true,'verification_state','operator_attested',
    'attestation_sha256',encode(sha256(convert_to(v_attestation::text,'UTF8')),'hex'));
end; $$;

create function public.production_label_catalog_capability() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_value jsonb;
begin
  select value into v_value from public.syncview_runtime_flags where key='production_native_label_catalog' for share;
  if jsonb_typeof(v_value) is distinct from 'object' or v_value->'schema_version' is distinct from '1'::jsonb
     or coalesce(v_value->>'mode','') not in ('provider','native','hold')
     or not(v_value ? 'version_id') then raise exception 'native_label_catalog_config_invalid'; end if;
  if v_value->>'mode'='native' then
    if coalesce(v_value->>'version_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       then raise exception 'native_label_catalog_config_invalid'; end if;
  elsif v_value->'version_id' is distinct from 'null'::jsonb then raise exception 'native_label_catalog_config_invalid'; end if;
  return v_value;
end; $$;

-- Reuse existing outbox identity as a terminal native receipt. The marker is
-- immutable; it never converts an old provider receipt or requeues native work.
create function public.production_native_label_receipt_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_mode jsonb; v_version text;
begin
  if tg_op='DELETE' then
    if old.payload ? '_native_label_catalog_version' then raise exception 'native_label_receipt_retained'; end if;
    return old;
  end if;
  if tg_op='UPDATE' then
    if new.payload->'_native_label_catalog_version' is distinct from old.payload->'_native_label_catalog_version'
       or (old.payload ? '_native_label_catalog_version' and
         (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then raise exception 'idempotency_conflict'; end if;
    return new;
  end if;
  if new.operation is distinct from 'labels' or new.dedup_key not like 'write-ui:labels:deliverable:%' then
    if new.payload ? '_native_label_catalog_version' then raise exception 'native_label_scope_forbidden'; end if;
    return new;
  end if;
  v_mode:=public.production_label_catalog_capability();
  if v_mode->>'mode'='hold' then raise exception 'native_label_catalog_held'; end if;
  if v_mode->>'mode'='provider' then
    if new.payload ? '_native_label_catalog_version' then raise exception 'native_label_catalog_changed'; end if;
    return new;
  end if;
  v_version:=v_mode->>'version_id';
  if new.payload->>'_native_label_catalog_version' is distinct from v_version then raise exception 'native_label_catalog_changed'; end if;
  if new.entity is distinct from 'deliverable' or coalesce(new.role,'') not in ('admin','smm')
     or new.test_only is distinct from false or new.legacy_parity is distinct from false
     or coalesce(new.payload->>'_intent_fingerprint','')='' then raise exception 'native_label_scope_forbidden'; end if;
  perform public.production_assert_authority(new.client_slug,new.team,false,false);
  perform public.production_label_catalog_read_attested(v_version::uuid,new.team);
  new.status:='skipped'; new.processed_at:=clock_timestamp(); new.next_retry_at:=null; new.last_error:=null;
  new.linear_result:=jsonb_build_object('native_labels',true,'catalog_version',v_version);
  return new;
end; $$;
create trigger zzz_native_label_receipt_guard before insert or update or delete on public.mirror_outbox
for each row execute function public.production_native_label_receipt_guard();
create function public.production_native_label_truncate_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if exists(select 1 from public.mirror_outbox where payload ? '_native_label_catalog_version') then
    raise exception 'native_label_receipt_retained'; end if;
  return null;
end; $$;
create trigger zzz_native_label_truncate_guard before truncate on public.mirror_outbox
for each statement execute function public.production_native_label_truncate_guard();

create function public.production_labels_write(p_row jsonb,p_event jsonb) returns public.deliverables
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_out jsonb:=p_event->'outbound'; v_payload jsonb:=v_out->'payload'; v_mode jsonb;
  v_current public.deliverables; v_receipt public.mirror_outbox; v_selection jsonb; v_raw jsonb;
  v_nodes jsonb; v_ids jsonb; v_read jsonb; v_result public.deliverables;
begin
  if p_event->>'surface' is distinct from 'production' or p_event->>'auth_kind' is distinct from 'staff'
     or p_event->>'source' is distinct from 'ui' or p_event->>'action' is distinct from 'labels_change'
     or coalesce(p_event->>'role','') not in ('admin','smm') or coalesce(p_event->>'actor','')=''
     or v_out->>'operation' is distinct from 'labels' or v_out->>'entity' is distinct from 'deliverable'
     or v_out->>'entity_id' is distinct from p_row->>'id'
     or v_out->'test_only' is distinct from 'false'::jsonb or v_out->'legacy_parity' is distinct from 'false'::jsonb
     or coalesce(v_payload->>'_intent_fingerprint','')='' or coalesce(v_out->>'dedup_key','')=''
     or coalesce(p_event->>'expected_updated_at','')='' then raise exception 'native_label_scope_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_out->>'dedup_key',0));
  select * into v_receipt from public.mirror_outbox where dedup_key=v_out->>'dedup_key';
  -- Only retained native receipts can be adopted before current admission.
  -- This path reads the current scoped result and emits no new event/intent.
  if v_receipt.payload ? '_native_label_catalog_version' and
    public.production_outbox_replay('deliverable',p_row->>'id','labels',p_row->>'client_slug',p_row->>'team',
      p_event->>'actor',p_event->>'role',false,false,v_payload->>'_intent_fingerprint',v_out->>'dedup_key') then
    if v_receipt.payload->>'_native_label_catalog_version' is distinct from v_payload->>'_native_label_catalog_version'
       or v_receipt.status is distinct from 'skipped' or v_receipt.linear_result->>'native_labels' is distinct from 'true'
       or v_receipt.linear_result->>'catalog_version' is distinct from v_payload->>'_native_label_catalog_version'
       then raise exception 'idempotency_conflict'; end if;
    select * into v_result from public.deliverables where id=p_row->>'id' and client_slug=p_row->>'client_slug' and team=p_row->>'team';
    if not found then raise exception 'idempotent_result_missing'; end if;
    return v_result;
  end if;
  perform public.production_assert_authority(p_row->>'client_slug',p_row->>'team',false,false);
  -- The capability SHARE lock is retained through commit. Concurrent activation
  -- cannot switch the version between validation and the accepted receipt.
  v_mode:=public.production_label_catalog_capability();
  if v_mode->>'mode' is distinct from 'native' then raise exception 'native_label_catalog_held'; end if;
  if v_mode->>'version_id' is distinct from v_payload->>'_native_label_catalog_version' then raise exception 'native_label_catalog_changed'; end if;
  v_read:=public.production_label_catalog_read_attested((v_mode->>'version_id')::uuid,p_row->>'team');
  perform pg_advisory_xact_lock(hashtextextended('production-deliverable:'||(p_row->>'id'),0));
  select * into v_current from public.deliverables where id=p_row->>'id' for update;
  if not found or v_current.client_slug is distinct from p_row->>'client_slug' or v_current.team is distinct from p_row->>'team'
     then raise exception 'native_label_scope_forbidden'; end if;
  if v_current.updated_at is distinct from (p_event->>'expected_updated_at')::timestamptz then raise exception 'write_conflict'; end if;
  v_raw:=v_current.linear_raw; v_nodes:=v_raw->'issue'->'labels'->'nodes';
  if jsonb_typeof(v_nodes) is distinct from 'array' or v_raw->'issue'->'labels'->'pageInfo'->'hasNextPage' is distinct from 'false'::jsonb
     then raise exception 'native_label_state_incomplete'; end if;
  select coalesce(jsonb_agg(n->>'id' order by n->>'id'),'[]'::jsonb) into v_ids from jsonb_array_elements(v_nodes) n;
  if v_raw->'issue' ? 'labelIds' then
    if jsonb_typeof(v_raw->'issue'->'labelIds') is distinct from 'array' or
       (select coalesce(jsonb_agg(n order by n),'[]'::jsonb) from jsonb_array_elements(v_raw->'issue'->'labelIds') n) is distinct from v_ids
       then raise exception 'native_label_state_incomplete'; end if;
  end if;
  -- Match the existing native selected-state presentation: absent/invalid
  -- legacy color uses its documented fallback; missing descriptions are null.
  -- Do not manufacture or drop identities to make validation succeed.
  select coalesce(jsonb_agg(jsonb_build_object('id',btrim(n->>'id'),'name',btrim(n->>'name'),
    'color',case when btrim(n->>'color') ~ '^#[0-9a-fA-F]{6}$' then btrim(n->>'color') else '#5e6ad2' end,
    'description',nullif(btrim(n->>'description'),'')) order by n->>'id'),'[]'::jsonb)
    into v_nodes from jsonb_array_elements(v_nodes) n;
  v_selection:=public.production_label_catalog_validate_selection((v_mode->>'version_id')::uuid,v_current.team,v_nodes,v_payload->'label_ids');
  v_raw:=jsonb_set(v_raw,'{issue}',(v_raw->'issue')||jsonb_build_object('labelIds',v_selection->'selected_label_ids',
    'labels',jsonb_build_object('nodes',v_selection->'selected_labels','pageInfo',jsonb_build_object('hasNextPage',false,'endCursor',null))));
  -- Copy only this owned field from locked current state. Existing writes keep
  -- their event, F27, journal and receipt in this SAME transaction.
  return public.production_deliverable_write(to_jsonb(v_current)||jsonb_build_object('linear_raw',v_raw),p_event);
end; $$;

revoke all on function public.production_label_catalog_stage_attested(uuid,jsonb,jsonb),
 public.production_label_catalog_read_attested(uuid,text),public.production_labels_write(jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.production_label_catalog_stage_attested(uuid,jsonb,jsonb),
 public.production_label_catalog_read_attested(uuid,text),public.production_labels_write(jsonb,jsonb) to service_role;
revoke all on function public.production_label_catalog_capability(),public.production_native_label_receipt_guard(),
 public.production_native_label_truncate_guard() from public,anon,authenticated,service_role;
grant execute on function public.production_label_catalog_capability() to service_role;
commit;
