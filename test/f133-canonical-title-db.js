const fs = require('fs');
const path = require('path');
const assert = require('assert');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'migrations', '2026-08-02-f133-canonical-title.sql'),
  'utf8',
);
const proof = fs.readFileSync(
  path.join(root, 'scripts', 'f133-canonical-title-proof.sql'),
  'utf8',
);
const workflow = fs.readFileSync(
  path.join(root, '.github', 'workflows', 'f133-canonical-title-proof.yml'),
  'utf8',
);
const preinstallGateProof = fs.readFileSync(
  path.join(root, 'scripts', 'f133-preinstall-gate-proof.js'),
  'utf8',
);
const executableMigration = migration.split(/\r?\n/)
  .filter(line => !/^\s*--/.test(line))
  .join('\n');

const legacyAppendStart = proof.indexOf(
  'create or replace function public.production_intake_append(',
);
const legacyAppendBodyStart = proof.indexOf('as $fn$', legacyAppendStart)
  + 'as $fn$'.length;
const legacyAppendBodyEnd = proof.indexOf('$fn$;', legacyAppendBodyStart);
const legacyAppendBody = proof
  .slice(legacyAppendBodyStart, legacyAppendBodyEnd)
  .replace(/\r\n/g, '\n');
assert.equal(
  crypto.createHash('sha256').update(legacyAppendBody).digest('hex'),
  '028c2c9c57891e37dcecb216173634cc4000a3d5b6d231ec6c96a908ac6d3804',
  'the retained production_intake_append proof fixture must remain byte-exact',
);
assert.equal((proof.match(/set check_function_bodies = off;/g) || []).length, 1);
assert.equal((proof.match(/reset check_function_bodies;/g) || []).length, 1);
assert.match(
  proof,
  /set check_function_bodies = off;\s*create or replace function public\.production_intake_append\([\s\S]*?\$fn\$;\s*reset check_function_bodies;/,
);

assert.match(migration, /production_intake_commit\([\s\S]*production_intake_append\(/);
assert.match(migration, /production_intake_card_adopt\([\s\S]*f133-intake-recover:[\s\S]*intake_recovery_identity_invalid/);
assert.match(migration, /production_intake_v3_card_contract\([\s\S]*_intake_version[\s\S]*production_canonical_title_card_guard\([\s\S]*production_intake_v3_card_contract\(/);
assert.match(migration, /production_canonical_title_from_linear\([\s\S]*payload->>'surface' = v_origin[\s\S]*v_latest_title_is_inbound[\s\S]*source, payload, event_key/);
assert.match(migration, /left\([\s\S]*'linear-inbound:title:' \|\| v_delivery_id \|\| ':'/);
assert.match(migration, /v_test_only := v_client_kind = 'test'[\s\S]*v_legacy_parity := not v_test_only[\s\S]*p_test_only := \(v_plan_item->>'test_only'\)::boolean/);
assert.match(migration, /v_committed_at := clock_timestamp\(\)[\s\S]*'client_edited_at', v_source_edited_at[\s\S]*p_source_edited_at := v_committed_at/);
assert.match(migration, /set_config\('app\.f133_canonical_title_write', '1', true\)[\s\S]*insert into public\.calendar_posts/);
assert.match(migration, /production_canonical_title_card_guard\(\)[\s\S]*linked_card_title_requires_canonical_rpc[\s\S]*linked_card_linkage_requires_canonical_rpc/);
assert.match(migration, /production_canonical_title_write\([\s\S]*expected_deliverable_titles[\s\S]*production_outbox_replay\([\s\S]*canonical_title_write_conflict/);
assert.match(migration, /pg_advisory_xact_lock\([\s\S]*f133-calendar-order:[\s\S]*max\([\s\S]*order_index[\s\S]*scheduled_date/);
assert.match(migration, /production_deliverable_linear_link_projection\(\)[\s\S]*f133_linear_link_projection_mismatch/);
assert.match(migration, /after update of linear_issue_url on public\.deliverables[\s\S]*production_deliverable_linear_link_projection\(\)/);
assert.match(migration, /expected_deliverable_titles[\s\S]*insert into public\.deliverable_events[\s\S]*'expected_deliverable_titles'[\s\S]*'event_id', v_event_id/);
assert.match(migration, /jsonb_array_length\(v_outbounds\) = 0[\s\S]*'noop', true[\s\S]*jsonb_array_length\(v_outbounds\) <> v_count/);
assert.match(migration, /insert into public\.deliverable_events \([\s\S]*'title_change'[\s\S]*mirror_outbox_enqueue\(/);
assert.match(migration, /mirror_outbox_legacy_parity_operation_check[\s\S]*'title'/);
assert.match(migration, /revoke all on function public\.production_canonical_title_write\(jsonb, jsonb\)[\s\S]*to service_role/);
assert.match(migration, /revoke all on function public\.production_intake_append[\s\S]*service_role/);
assert.doesNotMatch(executableMigration, /grant execute on function public\.production_intake_append\([\s\S]{0,160}service_role/);
assert.match(migration, /alter function public\.production_intake_append\([\s\S]*rename to production_intake_append_v3[\s\S]*grant execute on function public\.production_intake_append_v3\([\s\S]{0,160}service_role/);
assert.doesNotMatch(migration, /grant execute[\s\S]{0,200}to (anon|authenticated)/i);
assert.match(migration, /v_actor_key[\s\S]*v_auth_kind[\s\S]*client:' \|\| v_client_slug[\s\S]*canonical_title_client_collab_required/);
assert.match(migration, /count\(distinct nullif\(btrim\(item->>'dedup_key'\)[\s\S]*invalid_canonical_title_outbound/);
assert.match(migration, /production_outbox_replay\([\s\S]*v_existing_outbox\.authority_generation[\s\S]*v_replay_count = v_count[\s\S]*'superseded', v_superseded[\s\S]*Only a new mutation[\s\S]*production_assert_authority/);
assert.equal((migration.match(/'superseded', false/g) || []).length, 4);
assert.match(migration, /e\.payload - 'from_title'[\s\S]*'actor_key', v_actor_key[\s\S]*'auth_kind', v_auth_kind/);
assert.match(migration, /v_existing_outbox\.op is distinct from 'create'[\s\S]*e\.from_status is null[\s\S]*e\.event_key is null/);
assert.match(migration, /v_existing_outbox\.op is distinct from 'update_fields'/);
assert.match(migration, /production_canonical_title_dependency_valid\([\s\S]*v_dependency\.test_only is not distinct from v_row\.test_only[\s\S]*v_dependency\.legacy_parity is not distinct from v_row\.legacy_parity[\s\S]*v_dependency\.authority_generation is not distinct from v_row\.authority_generation/);
assert.match(migration, /if v_dependency\.status = 'written' then[\s\S]*Validate the create acknowledgement even when a nearer title row[\s\S]*v_bound_issue_id is not null and v_bound_issue_id is distinct from v_issue_id[\s\S]*if v_result is null then[\s\S]*'kind', 'create_root'/);
assert.doesNotMatch(migration, /elsif v_result is null then\s*v_expected_input := coalesce\(v_receipt->'expected'->'input'/);
assert.match(migration, /v_outbound \? 'depends_on_id'[\s\S]*invalid_canonical_title_outbound[\s\S]*order by o\.id desc[\s\S]*operation = 'create'[\s\S]*canonical_title_create_dependency_invalid/);
assert.match(migration, /if v_replay then[\s\S]*v_item\.batch_id[\s\S]*v_item\.kind[\s\S]*v_item\.title is distinct from v_title/);

for (const receipt of [
  'single_team_video_intake_atomic',
  'single_team_graphics_intake_atomic',
  'paired_single_intake_atomic',
  'paired_multiple_duplicate_titles_atomic',
  'locked_server_calendar_order_schedule_empty',
  'append_human_title_atomic',
  'linked_card_guard_title_and_linkage',
  'migration_first_legacy_card_adoption',
  'service_commit_nested_append_after_direct_revoke',
  'split_state_converges',
  'historical_whitespace_base_converges',
  'one_title_change_event',
  'async_title_outbox_per_link',
  'create_ack_title_clock_bound',
  'title_create_dependency_nine_waits_terminal',
  'title_dependency_514_gap_fork_cycle_binder_null_root',
  'f27_binder_exact',
  'lost_response_replay_exact',
  'intake_replay_current_authority_independent',
  'title_replay_current_authority_independent',
  'title_replay_exact_inventory_drift_refused',
  'title_event_exact_bases_and_replay_identity',
  'two_tab_cas_conflict_zero_residue',
  'independent_card_and_row_cas',
  'duplicate_title_dedup_refused',
  'zero_outbound_noop',
  'calendar_collaborative_client_noop',
  'calendar_client_mutation_and_bound_replay',
  'superseded_title_replay_current_state',
  'intake_replay_after_later_title',
  'calendar_and_samples_exact',
  'offline_ui_server_commit_clock',
  'linear_inbound_stale_replay_noop_exact',
  'linear_inbound_card_cursor_monotone',
  'linear_inbound_literal_delivery_id',
  'linear_inbound_test_lane_isolated',
  'cross_surface_title_clock_isolated',
  'sparse_ordinal_cursor_matches_js',
  'calendar_samples_linear_link_projection',
  'linear_link_projection_mismatch_refused',
  'review_fields_preserved',
  'blank_refused',
  'service_only_rpc_acl',
]) {
  assert.ok(proof.includes(`'${receipt}'`), `missing disposable proof receipt: ${receipt}`);
}
assert.match(proof, /Graphic 1[\s\S]*expected_deliverable_titles[\s\S]*Graphic 1/);
assert.match(proof, /f133_linked_card_linkage_requires_canonical_rpc/);
assert.match(proof, /f133_v3_compatibility_off_failed[\s\S]*f133_v4_receipt_entered_v3_compatibility[\s\S]*f133_v3_compatibility_arbitrary_field_accepted/);
assert.match(proof, /DROP FUNCTION IF EXISTS public\.production_canonical_title_card_guard\(\);[\s\S]{0,180}DROP FUNCTION IF EXISTS public\.production_intake_v3_card_contract\(text, text, text, text, jsonb\);/);
assert.match(proof, /'outbounds', '\[\]'::jsonb/);
assert.match(proof, /has_function_privilege\('anon'[\s\S]*has_function_privilege\('authenticated'[\s\S]*has_function_privilege\('service_role'/);
assert.match(proof, /f133_card_only_cas_unexpectedly_succeeded[\s\S]*f133_row_only_cas_unexpectedly_succeeded/);
assert.match(proof, /f133_duplicate_title_dedup_unexpectedly_succeeded/);
assert.match(proof, /f133_superseded_title_replay_failed[\s\S]*f133_intake_replay_after_title_failed/);
assert.match(proof, /f133_drifted_title_actor_key_unexpectedly_replayed/);
assert.match(proof, /FOR v_cycle IN 1\.\.9 LOOP[\s\S]*attempts <> 0[\s\S]*f133_dependency_terminal_linkage_failed/);
assert.match(proof, /FOR v_index IN 1\.\.515 LOOP[\s\S]*f133_dependency_514_chain_failed/);
for (const sabotage of ['fork', 'gap', 'cycle', 'binder_drift', 'null_root']) {
  assert.ok(proof.includes(`f133_dependency_${sabotage}`), `missing dependency sabotage: ${sabotage}`);
}
assert.match(proof, /SET linear_issue_uuid = 'f133-wrong-chain-issue'[\s\S]*production_canonical_title_dependency_resolve\(v_requested_id\)[\s\S]*f133_dependency_binder_drift_unexpectedly_passed/);
assert.match(proof, /v_ui_client_at < v_delayed_at AND v_delayed_at < v_ui_commit_at[\s\S]*f133_offline_ui_commit_clock_failed/);
assert.match(proof, /Linear webhook clocks arrive through Date\.toISOString\(\)[\s\S]*v_delayed_at := date_trunc\([\s\S]*'source_edited_at', date_trunc\([\s\S]*v_ui_commit_at \+ interval '2 seconds'/);
assert.match(proof, /f133_linear_inbound_title_not_exact[\s\S]*f133_linear_inbound_replay_failed[\s\S]*f133_linear_inbound_eventful_noop_failed[\s\S]*f133_linear_inbound_stale_regressed_state/);
assert.match(proof, /f133_linear_inbound_test_lane_failed/);
assert.match(proof, /v_prior_card_at[\s\S]*updated_at[\s\S]*v_result->'card'->>'updated_at'[\s\S]*<= v_prior_card_at/);
assert.match(proof, /F133_CANONICAL_TITLE_PROOF_OK/);

assert.match(workflow, /image: postgres:17/);
assert.match(workflow, /psql -X -v ON_ERROR_STOP=1 -f scripts\/f133-canonical-title-proof\.sql/);
assert.match(workflow, /node scripts\/f133-preinstall-gate-proof\.js/);
assert.match(workflow, /F133_POSTGRES_SERVICE_CONTAINER_ID: \$\{\{ job\.services\.postgres\.id \}\}/);
assert.match(preinstallGateProof, /F133_POSTGRES_SERVICE_CONTAINER_ID[\s\S]*\^\[a-f0-9\]\{12,64\}\$[\s\S]*spawnSync\('docker',[\s\S]*'exec', serviceContainerId,[\s\S]*'pg_dump', '--username=postgres', '--dbname', database/);
assert.match(preinstallGateProof, /normalizedDump = dump\.stdout[\s\S]*filter\(line => !\/\^\\\\\(\?:un\)\?restrict \/[\s\S]*update\(normalizedDump\)/);
for (const redCase of [
  'partial_revision_boundary',
  'dependency_owner_acl_drift',
  'dependency_foreign_grant',
  'open_title_intent',
  'foreign_f133_function',
  'retained_not_valid_revision_check',
  'retained_wrong_table_revision_check',
  'retained_widened_outbox_check',
]) assert.ok(preinstallGateProof.includes(redCase), `missing preinstall red proof: ${redCase}`);
assert.match(preinstallGateProof, /stateDigest\(database\) !== before/);
assert.doesNotMatch(workflow, /secrets\.|environment:/);

console.log('F133 canonical title database contract: PASS');
