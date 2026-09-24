-- ============================================================
-- WR-101 refusal receipts keep the browser's own reason code.
--
-- The browser_claim beacon sends the code the page actually raised, but
-- write-diagnostics collapsed every browser code except three into
-- 'browser_refusal', and this table's check only admitted gateway codes, so a
-- page-local refusal such as status_reapply_required could not be stored as
-- itself. The function now admits the gateway codes plus the page's own list
-- (_shared/write-refusal-codes.mjs BROWSER_REFUSAL_CODES) for browser claims,
-- and this widens the check to match.
--
-- APPLY BEFORE deploying the write-diagnostics that carries the new codes.
-- Reversed, nothing breaks: the insert refuses, the beacon is fire-and-forget,
-- and that one receipt is lost. Additive and idempotent: the new check is a
-- strict superset of the old one (test/write-refusal-browser-codes.js).
-- No grant or revoke: only the check constraint changes, so every role's
-- rights on this table (none for public, anon, authenticated, service_role;
-- writes go through production_write_refusal_record_v1) are untouched.
-- ============================================================
begin;
alter table write_refusal_diagnostics.receipts_v1
  drop constraint if exists receipts_v1_code_check;
alter table write_refusal_diagnostics.receipts_v1
  add constraint receipts_v1_code_check check (code in (
    'ambiguous_client_token','ambiguous_credentials','artifact_not_resolvable','asset_context_unavailable',
    'asset_evidence_unavailable','asset_scope_forbidden','assignee_load_unavailable','assignee_lookup_unavailable',
    'assignee_provider_unavailable','assignee_scope_forbidden','assignment_scope_forbidden','authority_unavailable',
    'batch_asset_slot_unsupported','batch_client_mismatch','batch_lookup_unavailable','batch_not_active',
    'batch_not_found','batch_parent_lookup_unavailable','batch_parent_mapping_ambiguous','batch_parent_mapping_missing',
    'browser_refusal','calendar_feedback_recovery_forbidden','canonical_comment_read_required','cas_required',
    'client_auth_unavailable','client_inactive','client_lookup_unavailable','client_scope_mismatch',
    'client_scope_unavailable','client_slug_required','comment_cas_required','comment_dependency_lookup_unavailable',
    'comment_forbidden','comment_lookup_unavailable','comment_parent_ambiguous','comment_parent_forbidden',
    'comment_parent_lookup_unavailable','comment_parent_not_found','comment_receipt_lookup_unavailable','comment_root_required',
    'companion_status_unbound','companion_status_unreserved','component_fill_card_mismatch','component_fill_sibling_missing',
    'component_fill_team_occupied','create_parent_lookup_unavailable','create_parent_not_found','create_replay_lookup_unavailable',
    'credentials_required','deliverable_lookup_unavailable','deliverable_repair_unavailable','description_scope_forbidden',
    'entity_id_required','entity_lookup_unavailable','entity_not_found','entity_scope_unavailable',
    'graphics_default_assignee_unavailable','idempotency_conflict','idempotency_lookup_unavailable','idempotent_result_missing',
    'identity_guard_unavailable','identity_repair_required','intake_assignee_override_conflict','intake_assignee_override_not_allowed',
    'intake_editor_options_unavailable','intake_id_conflict','intent_conflict','invalid_artifact_url',
    'invalid_client_token','invalid_comment_action','invalid_comment_audience','invalid_comment_body',
    'invalid_comment_parent','invalid_comment_round','invalid_component_fill_payload','invalid_cursor',
    'invalid_description','invalid_due_date','invalid_entity','invalid_expected_batch_updated_at',
    'invalid_intake_item','invalid_intake_item_name','invalid_intake_payload','invalid_intake_teams',
    'invalid_intake_video_number','invalid_json','invalid_label_ids','invalid_native_comment_id',
    'invalid_production_create_payload','invalid_production_create_scope','invalid_recover_source','invalid_source_edited_at',
    'invalid_staff_key','invalid_status','invalid_surface','invalid_surface_operation',
    'invalid_team','invalid_test_override','invalid_urgent_request','label_catalog_incomplete',
    'label_catalog_unavailable','label_not_applicable','label_selection_incomplete','label_selection_invalid',
    'label_selection_out_of_catalog','legacy_committed_tweak_retire_failed','legacy_committed_tweak_retire_unverified','legacy_intake_acceptance_unavailable',
    'legacy_intake_client_not_unique','legacy_intake_confirmation_required','legacy_intake_inbox_unavailable','legacy_intake_invalid_utf8',
    'legacy_intake_missing','legacy_intake_native_epoch_required','legacy_intake_original_staff_required','legacy_intake_payload_conflict',
    'legacy_intake_storage_unavailable','legacy_intake_too_large','legacy_link_ambiguous','legacy_outbox_finalize_failed',
    'legacy_outbox_finalize_unverified','legacy_outbox_lock_unavailable','legacy_parity_disabled','legacy_parity_gate_unavailable',
    'legacy_parity_not_allowed','legacy_parity_required','legacy_resume_lease_revoked','legacy_tweak_confirmation_pending',
    'legacy_tweak_delivery_unconfirmed','legacy_tweak_target_lock_unavailable','linear_issue_team_unavailable','linear_issue_unavailable',
    'linear_team_mapping_unavailable','native_label_catalog_changed','native_label_catalog_config_invalid','native_label_catalog_config_unavailable',
    'native_label_catalog_held','native_label_catalog_malformed','native_label_catalog_unavailable','native_label_catalog_unverified',
    'native_label_scope_forbidden','native_label_state_incomplete','native_link_required','native_ordinary_receipt_invalid',
    'native_replay_clock_unavailable','native_replay_read_unavailable','native_replay_status_unavailable','native_response_refresh_failed',
    'native_write_failed','operation_forbidden','outbox_checkpoint_missing','production_create_batch_scope',
    'production_create_closed','production_create_parent_nested','production_create_parent_route','production_create_parent_scope',
    'project_mapping_ambiguous','project_mapping_missing','project_mapping_validation_unavailable','public_intake_disabled',
    'public_intake_rate_limited','public_intake_rate_unavailable','public_intake_too_large','reconcile_comment_unavailable',
    'reconcile_current_row_unavailable','reconcile_operation_unsupported','reconcile_receipt_invalid','reconcile_receipt_unavailable',
    'recover_source_unsupported','recovery_result_invalid','repair_checkpoint_missing','repair_comment_receipt_mismatch',
    'repair_context_unavailable','repair_intent_unavailable','repair_lock_unavailable','repair_operation_unsupported',
    'repair_payload_invalid','repair_payload_mismatch','repair_principal_conflict','repair_receipt_target_mismatch',
    'repair_status_invalid','repair_status_not_applied','repair_storage_unavailable','repair_storage_unknown',
    'roster_actor_not_unique','roster_actor_required','roster_lookup_unavailable','skip_graphic_generation_forbidden',
    'source_repair_receipt_required','status_commit_required','status_mapping_unavailable','status_reapply_required',
    'team_authority_unknown','team_is_linear_authoritative','test_client_scope_ambiguous','test_client_scope_required',
    'test_project_mapping_unavailable','test_project_scope_required','test_scope_service_only','unsupported_action',
    'unsupported_batch_operation','unsupported_create_field','unsupported_operation','urgent_assignment_unavailable',
    'urgent_context_unavailable','urgent_editor_unavailable','urgent_lookup_unavailable','urgent_notification_unavailable',
    'urgent_round_unavailable','urgent_target_changed','valid_comment_id_required','valid_request_id_required',
    'video_assignee_pool_unavailable','write_conflict','write_failed','write_gate_closed',
    'write_pending','write_refused'));
commit;
