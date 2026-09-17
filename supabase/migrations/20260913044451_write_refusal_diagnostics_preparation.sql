-- Separate WR101 preparation release. No business rows, text, credentials or raw payloads.
begin;
create schema write_refusal_diagnostics;
revoke all on schema write_refusal_diagnostics from public,anon,authenticated,service_role;
create table write_refusal_diagnostics.receipts_v1(
 attempt_id uuid primary key, recorded_at timestamptz not null default clock_timestamp(),
 origin text not null check(origin in ('gateway','browser_claim')),
 surface text not null check(surface in ('calendar','sxr','production','unknown')),
 operation text not null check(operation in ('comment','status','create','update','archive','restore','due','assignee','labels','description','attachment','intake_create','batch_asset','batch_description','component_fill','other')),
 code text not null check(code = any(array['ambiguous_client_token','ambiguous_credentials','artifact_not_resolvable','asset_context_unavailable','asset_evidence_unavailable','asset_scope_forbidden','assignee_load_unavailable','assignee_lookup_unavailable','assignee_provider_unavailable','assignee_scope_forbidden','assignment_scope_forbidden','authority_unavailable','batch_asset_slot_unsupported','batch_client_mismatch','batch_lookup_unavailable','batch_not_active','batch_not_found','batch_parent_lookup_unavailable','batch_parent_mapping_ambiguous','batch_parent_mapping_missing','browser_refusal','calendar_feedback_recovery_forbidden','canonical_comment_read_required','cas_required','client_auth_unavailable','client_inactive','client_lookup_unavailable','client_scope_mismatch','client_slug_required','comment_cas_required','comment_dependency_lookup_unavailable','comment_forbidden','comment_lookup_unavailable','comment_parent_ambiguous','comment_parent_forbidden','comment_parent_lookup_unavailable','comment_parent_not_found','comment_receipt_lookup_unavailable','comment_root_required','companion_status_unbound','companion_status_unreserved','component_fill_card_mismatch','component_fill_sibling_missing','component_fill_team_occupied','create_parent_lookup_unavailable','create_parent_not_found','create_replay_lookup_unavailable','credentials_required','deliverable_lookup_unavailable','deliverable_repair_unavailable','description_scope_forbidden','entity_id_required','entity_lookup_unavailable','entity_not_found','entity_scope_unavailable','graphics_default_assignee_unavailable','idempotency_conflict','idempotency_lookup_unavailable','idempotent_result_missing','identity_guard_unavailable','identity_repair_required','intake_assignee_override_conflict','intake_assignee_override_not_allowed','intake_editor_options_unavailable','intake_id_conflict','invalid_artifact_url','invalid_client_token','invalid_comment_action','invalid_comment_audience','invalid_comment_body','invalid_comment_parent','invalid_comment_round','invalid_component_fill_payload','invalid_cursor','invalid_description','invalid_due_date','invalid_entity','invalid_expected_batch_updated_at','invalid_intake_item','invalid_intake_item_name','invalid_intake_payload','invalid_intake_teams','invalid_intake_video_number','invalid_json','invalid_label_ids','invalid_native_comment_id','invalid_production_create_payload','invalid_production_create_scope','invalid_recover_source','invalid_source_edited_at','invalid_staff_key','invalid_status','invalid_surface','invalid_surface_operation','invalid_team','invalid_test_override','invalid_urgent_request','label_catalog_incomplete','label_catalog_unavailable','label_not_applicable','label_selection_incomplete','label_selection_invalid','label_selection_out_of_catalog','legacy_intake_acceptance_unavailable','legacy_intake_client_not_unique','legacy_intake_confirmation_required','legacy_intake_inbox_unavailable','legacy_intake_invalid_utf8','legacy_intake_missing','legacy_intake_native_epoch_required','legacy_intake_original_staff_required','legacy_intake_payload_conflict','legacy_intake_storage_unavailable','legacy_intake_too_large','legacy_link_ambiguous','legacy_parity_disabled','legacy_parity_gate_unavailable','legacy_parity_not_allowed','legacy_parity_required','linear_issue_team_unavailable','linear_issue_unavailable','linear_team_mapping_unavailable','native_label_catalog_changed','native_label_catalog_config_invalid','native_label_catalog_config_unavailable','native_label_catalog_held','native_label_catalog_malformed','native_label_catalog_unavailable','native_label_catalog_unverified','native_label_scope_forbidden','native_label_state_incomplete','native_ordinary_receipt_invalid','native_response_refresh_failed','native_write_failed','operation_forbidden','outbox_checkpoint_missing','production_create_batch_scope','production_create_closed','production_create_parent_nested','production_create_parent_route','production_create_parent_scope','project_mapping_ambiguous','project_mapping_missing','project_mapping_validation_unavailable','public_intake_disabled','public_intake_rate_limited','public_intake_rate_unavailable','public_intake_too_large','reconcile_comment_unavailable','reconcile_current_row_unavailable','reconcile_operation_unsupported','reconcile_receipt_unavailable','recover_source_unsupported','recovery_result_invalid','roster_actor_not_unique','roster_actor_required','roster_lookup_unavailable','skip_graphic_generation_forbidden','status_mapping_unavailable','team_authority_unknown','team_is_linear_authoritative','test_client_scope_ambiguous','test_client_scope_required','test_project_mapping_unavailable','test_project_scope_required','test_scope_service_only','unsupported_action','unsupported_batch_operation','unsupported_create_field','unsupported_operation','urgent_assignment_unavailable','urgent_context_unavailable','urgent_editor_unavailable','urgent_lookup_unavailable','urgent_notification_unavailable','urgent_round_unavailable','urgent_target_changed','valid_comment_id_required','valid_request_id_required','video_assignee_pool_unavailable','write_conflict','write_refused']::text[])), status integer not null check(status between 400 and 599),
 principal_kind text not null check(principal_kind in ('unverified','staff','client','test','public')),
 member_id uuid, identifiers jsonb not null
);
create index receipts_v1_recorded_at on write_refusal_diagnostics.receipts_v1(recorded_at);
alter table write_refusal_diagnostics.receipts_v1 enable row level security;
revoke all on write_refusal_diagnostics.receipts_v1 from public,anon,authenticated,service_role;
create function public.production_write_refusal_record_v1(p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare id uuid; prior write_refusal_diagnostics.receipts_v1%rowtype; k text; v jsonb; v_origin text;
begin
 if jsonb_typeof(p_receipt) is distinct from 'object' or (select array_agg(key order by key) from jsonb_object_keys(p_receipt) key) is distinct from array['attempt_id','code','identifiers','member_id','operation','origin','principal_kind','status','surface']::text[] then raise exception 'refusal_shape';end if;
 id:=(p_receipt->>'attempt_id')::uuid;v_origin:=p_receipt->>'origin';
 if id is null or jsonb_typeof(p_receipt->'identifiers') is distinct from 'object' then raise exception 'refusal_identifiers';end if;
 for k,v in select * from jsonb_each(p_receipt->'identifiers') loop
  if k not in ('id','client_slug','card','component','comment','parent','request_id') or jsonb_typeof(v) is distinct from 'string' or (v#>>'{}') !~ '^[a-f0-9]{64}$' then raise exception 'refusal_identifier_shape';end if;
 end loop;
 if v_origin='browser_claim' and (p_receipt->>'principal_kind'<>'unverified' or p_receipt->'member_id'<>'null'::jsonb) then raise exception 'refusal_browser_principal';end if;
 perform pg_advisory_xact_lock(19370101,101);
 select * into prior from write_refusal_diagnostics.receipts_v1 where attempt_id=id;
 if found then
  if (to_jsonb(prior)-'recorded_at') is distinct from p_receipt then raise exception 'refusal_attempt_conflict';end if;
  return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 if (select count(*) from write_refusal_diagnostics.receipts_v1 where recorded_at>=clock_timestamp()-interval '1 minute' and receipts_v1.origin=v_origin)>=(case when v_origin='browser_claim' then 100 else 1000 end) then raise exception 'refusal_rate_limited';end if;
 insert into write_refusal_diagnostics.receipts_v1(attempt_id,origin,surface,operation,code,status,principal_kind,member_id,identifiers)
 values(id,v_origin,p_receipt->>'surface',p_receipt->>'operation',p_receipt->>'code',(p_receipt->>'status')::integer,p_receipt->>'principal_kind',(p_receipt->>'member_id')::uuid,p_receipt->'identifiers');
 return jsonb_build_object('recorded',true,'duplicate',false);
end $fn$;
create function public.production_write_refusal_read_v1(p_identifier_hash text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
begin
 if p_identifier_hash is not null and p_identifier_hash !~ '^[a-f0-9]{64}$' then raise exception 'refusal_lookup_hash';end if;
 return jsonb_build_object('window_hours',24,'latest_recorded_at',(select max(recorded_at) from write_refusal_diagnostics.receipts_v1),
 'counts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select origin,code,count(*)::integer as count from write_refusal_diagnostics.receipts_v1 where recorded_at>=now()-interval '24 hours' group by origin,code order by origin,code) x),
 'receipts',case when p_identifier_hash is null then '[]'::jsonb else (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from write_refusal_diagnostics.receipts_v1 where recorded_at>=now()-interval '24 hours' and exists(select from jsonb_each_text(identifiers) e where e.value=p_identifier_hash) order by recorded_at desc,attempt_id limit 100) x) end,
 'storage_available',true,'offline_browser_delivery_proven',false,'telemetry_outage_capture_proven',false);
end $fn$;
create function public.production_write_refusal_retention_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $fn$
declare n integer;
begin
 with old as (select attempt_id from write_refusal_diagnostics.receipts_v1 where recorded_at<now()-interval '30 days' order by recorded_at limit 1000 for update skip locked)
 delete from write_refusal_diagnostics.receipts_v1 r using old where r.attempt_id=old.attempt_id;get diagnostics n=row_count;
 return jsonb_build_object('deleted',n,'retention_days',30);
end $fn$;
revoke all on function public.production_write_refusal_record_v1(jsonb),public.production_write_refusal_read_v1(text),public.production_write_refusal_retention_v1() from public,anon,authenticated;
grant execute on function public.production_write_refusal_record_v1(jsonb),public.production_write_refusal_read_v1(text),public.production_write_refusal_retention_v1() to service_role;
commit;
