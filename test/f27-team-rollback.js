const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(value, message) {
  if (!value) {
    console.error(`FAIL: ${message}`);
    failures++;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const root = path.join(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'migrations', '2026-07-20-f27-team-rollback.sql'), 'utf8');
const proof = fs.readFileSync(path.join(root, 'scripts', 'f27-team-rollback-proof.sql'), 'utf8');
const snapshotTool = fs.readFileSync(path.join(root, 'scripts', 'f27-mirror-outbox-snapshot.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'f27-team-rollback-proof.yml'), 'utf8');
const installRunbook = fs.readFileSync(path.join(root, 'docs', 'ops', 'F27_INSTALL_RUNBOOK.md'), 'utf8');

ok(/track_b_f27_hold_guard/.test(sql), 'team hold blocks new active intents');
ok(!/\bdrop\s+(constraint|table|column|function|trigger)\b/i.test(sql),
  'candidate migration remains additive-only');
ok(/lock table public\.mirror_outbox in share row exclusive mode/i.test(sql), 'snapshot and finalize close enqueue races');
ok(/track_b_f27_team_fences/.test(sql)
  && /authority_generation bigint not null default 0/.test(sql)
  && /_f27_authority_generation/.test(sql)
  && /f27_authority_generation_stale/.test(sql),
  'server fence binds every active real-team insert to the current generation');
ok(/before insert or update of status, team, authority_generation,\s*legacy_parity, test_only, f27_drill_rollback_id\s*on public\.mirror_outbox/.test(sql)
  && /dependency-only fence update unexpectedly succeeded/.test(proof),
  'field-only updates to every fence and lane binder are trigger-revalidated');
ok(/function public\.production_assert_authority\([\s\S]*lock table public\.mirror_outbox in row exclusive mode[\s\S]*for share/.test(sql),
  'native write RPCs hold the outbox table before authority validation and commit');
ok(/fence_generation, actor/.test(sql)
  && /where team = v_case\.team and generation = v_case\.fence_generation/.test(sql)
  && /fence_generation_after/.test(sql),
  'real begin snapshots the generation and finalize advances it by exact CAS');
ok(/track_b_f27_requeue/.test(sql)
  && /authority_generation = p_authority_generation/.test(sql)
  && /revoke all on function public\.track_b_f27_requeue\(bigint, bigint\)/.test(sql)
  && /grant execute on function public\.track_b_f27_requeue\(bigint, bigint\) to service_role/.test(sql),
  'post-CAS reconciler requeue refreshes generation atomically and remains service-only');
ok(/lock table public\.mirror_outbox in row exclusive mode;[\s\S]*for update of r/.test(sql),
  'classification follows the same outbox-table then rollback-row lock order as finalize');
ok(/f27_inflight_rows/.test(sql) && /lock_token is not null or o\.locked_at is not null/.test(sql),
  'snapshot refuses already-claimed or in-flight team rows');
ok(/status in \('pending', 'failed', 'shadow_ok'\)/.test(sql), 'active rollback residue is explicit');
ok(/classification in \([\s\S]*'replay'[\s\S]*'quarantine'[\s\S]*'discard'[\s\S]*'already_reflected'/.test(sql),
  'all owner classifications are represented');
ok(/classification_history jsonb not null default '\[\]'::jsonb/.test(sql)
  && /i\.classification = 'replay'/.test(sql)
  && /v_kind in \('quarantine', 'discard', 'already_reflected'\)/.test(sql)
  && /i\.terminal_receipt is null/.test(sql),
  'declined replay reclassification is append-audited and restricted to an unreceipted quarantine');
ok(/f27_correlated_terminal_receipt_required/.test(sql), 'approved replay requires a correlated terminal receipt');
ok(/f27_reflected_receipt_required/.test(sql)
  && /status = 'written'[\s\S]*linear_result = p_reflected_receipt/.test(sql)
  && /intent_snapshot_sha256/.test(sql)
  && /observed_result_sha256/.test(sql),
  'already-reflected dependencies require an audited Linear identity and become consumable');
ok((sql.match(/extensions\.digest/g) || []).length >= 4,
  'secured functions resolve pgcrypto from the production extensions schema');
ok(/p_receipt->>'rollback_id' is distinct from p_rollback_id::text/.test(sql)
  && /p_receipt->>'outbox_id' is distinct from p_outbox_id::text/.test(sql)
  && /linear_result_sha256/.test(sql)
  && /intent_snapshot_sha256/.test(sql),
  'replay receipt is bound to the exact rollback, intent snapshot, and persisted Linear result');
ok(/v_unclassified <> 0 or v_unreceipted <> 0 or v_active <> 0/.test(sql),
  'final authority CAS fails until the requested team is genuinely zero');
ok(/jsonb_set\(v_authority, array\[v_case\.team\], '"linear"'::jsonb, false\)/.test(sql),
  'final statement changes only the requested authority key');
ok(/v_outbound is distinct from '\{"mode":"off"\}'::jsonb[\s\S]*v_parity is distinct from '\{"enabled":false\}'::jsonb/.test(sql),
  'both emergency stops are required');
ok(/track_b_f27_begin_drill/.test(sql)
  && /team = '__f27_drill__'/.test(sql)
  && /f27_drill_rollback_id/.test(sql)
  && /f27_drill_insert_forbidden/.test(sql),
  'reserved drill scope is server-bound and cannot match a real team or generic insert');
ok(/returning row_sha256 into v_row_hash/.test(sql)
  && /string_agg\(i\.row_sha256, '' order by i\.outbox_id\)/.test(sql)
  && /'row_sha256', v_row_hash/.test(sql)
  && /r\.snapshot_sha256 <> i\.row_sha256/.test(proof),
  'drill preserves its row hash and separately exercises the real aggregate snapshot algorithm');
ok(/track_b_f27_execute_drill_replay/.test(sql)
  && /f27_drill_replay_terminal/.test(sql)
  && /'no_external_call', true/.test(sql),
  'drill replay exercises a deterministic no-external-call terminal lane');
ok(/track_b_f27_finalize_drill/.test(sql)
  && /'authority_cas', 'refused'/.test(sql)
  && /f27_drill_authority_cas_refused/.test(sql)
  && /'audit_history_retained', true/.test(sql),
  'drill completion proves authority CAS refusal and permanently retains its audit');
ok(/v_is_drill and v_kind <> 'replay'/.test(sql)
  && /v_replay_count <> 1/.test(sql)
  && /v_exact_terminal <> 1/.test(sql),
  'a drill cannot complete without its one exact replay classification and receipt');
ok(/f27_drill_terminal_receipt_cas_refused/.test(sql)
  && /i\.terminal_receipt = p_receipt/.test(sql)
  && /'idempotent', true/.test(sql),
  'drill execution stores its hash receipt atomically and exact readback is idempotent');
ok(/savepoint f27_enqueue_probe/.test(sql)
  && /rollback to savepoint f27_enqueue_probe/.test(sql)
  && /'f27-migration-test'/.test(sql),
  'exact migration transaction accepts and rolls back a synthetic TEST enqueue before commit');
ok(!/calendar-upsert|sample-review-upsert/i.test(sql), 'frozen writers are untouched');
ok(!/n8n-backups|webhook|workflow_id/i.test(sql), 'migration has no n8n mutation surface');

ok(/CREATE SCHEMA f27_test/.test(proof), 'proof uses an isolated TEST schema');
ok(/f27_migration_probe_not_rolled_back/.test(proof)
  && /dedup_key LIKE 'f27-migration-test:%'/.test(proof),
  'proof confirms the migration TEST enqueue leaves the live-queue fixture row count unchanged');
ok(/ROLLBACK TO SAVEPOINT blocked_before_classification/.test(proof), 'premature rollback refusal is exercised transactionally');
ok(/other_team_unchanged/.test(proof), 'proof asserts team isolation');
ok(/exact_prior_flags_restored/.test(proof), 'proof asserts exact pre-cycle flag restoration');
ok(/zero_payload_loss/.test(proof), 'proof hashes immutable payloads before and after');
ok(/terminal_receipts_correlated/.test(proof), 'proof asserts correlated terminal receipts');
ok(/unbound replay receipt unexpectedly succeeded/.test(proof), 'proof rejects copied or synthetic replay receipts');
ok(/in-flight begin unexpectedly succeeded/.test(proof), 'proof exercises in-flight lease refusal');
ok(/late pre-authorized insert unexpectedly succeeded/.test(proof)
  && /f27_authority_generation_stale:graphics/.test(proof)
  && /f27_generation_cas_not_exact/.test(proof),
  'proof reproduces authorize then finalize commit then rejected late insert');
ok(/auth_result::text AS write_authorization/.test(proof)
  && !/\bauthorization::text AS write_authorization/.test(proof),
  'PostgreSQL proof avoids the reserved AUTHORIZATION keyword as a value alias');
ok(/unfenced post-CAS requeue unexpectedly succeeded/.test(proof)
  && /CREATE OR REPLACE FUNCTION public\.mirror_outbox_requeue\(p_id bigint\)/.test(proof)
  && /f27_fenced_post_cas_requeue_failed/.test(proof),
  'proof rejects stale requeue and accepts a fresh-generation requeue atomically');
ok(/track_b_f27_begin_drill/.test(proof)
  && /track_b_f27_execute_drill_replay/.test(proof)
  && /unbound drill replay unexpectedly succeeded/.test(proof)
  && /track_b_f27_finalize_drill/.test(proof),
  'proof runs the complete drill snapshot, classification, replay, receipt, and completion contract');
ok(/non-replay drill classification unexpectedly succeeded/.test(proof)
  && /f27_drill_atomic_receipt_not_exact/.test(proof)
  && /current_setting\('f27\.drill_replay_result'\)::jsonb/.test(proof),
  'proof refuses non-replay drill classifications and consumes the server-returned atomic receipt');
ok(/drill authority CAS unexpectedly succeeded/.test(proof)
  && /f27_drill_authority_cas_refused/.test(proof),
  'proof exercises the correct authority CAS refusal in dormant Linear state');
ok(/drill_real_rows_untouched/.test(proof)
  && /drill_real_fences_untouched/.test(proof)
  && /drill_runtime_flags_untouched/.test(proof)
  && /f27_lane_not_dormant/.test(proof),
  'proof pins real-row isolation, unchanged flags/fences, and a dormant terminal lane');
ok(/drill_audit_history_not_terminal/.test(proof)
  && !/delete\s+from\s+public\.track_b_team_rollbacks/i.test(proof),
  'proof requires permanent drill audit history and never cleans it up');
ok(/grant select on table public\.track_b_team_rollbacks to service_role/.test(sql)
  && !/grant select, insert, update on table public\.track_b_team_rollbacks/.test(sql),
  'service role can read but cannot rewrite rollback evidence directly');
ok(/ALTER TABLE public\.mirror_outbox DISABLE TRIGGER track_b_f27_hold_guard/.test(installRunbook)
  && /retain the additive F27 columns\/tables, disabled trigger\/guard function/.test(installRunbook)
  && !/DROP TRIGGER track_b_f27_hold_guard/.test(installRunbook),
  'operational rollback disables only the new guard while retaining additive schema and audit');
ok(/postgres:16/.test(workflow) && /f27-proof/.test(workflow), 'cloud proof uses an isolated PostgreSQL service');
ok(/createdb f27_proof/.test(workflow)
  && /PGDATABASE=f27_proof[\s\S]*f27-team-rollback-proof\.sql/.test(workflow)
  && /createdb f27_contract/.test(workflow)
  && /PGDATABASE=f27_contract[\s\S]*F27_POST_CONTRACT_ONLY=1[\s\S]*f27-team-rollback-proof\.sql/.test(workflow)
  && /localhost:5432\/f27_contract/.test(workflow)
  && /database: 'f27_contract'/.test(workflow),
  'full drill proof and pristine post-contract fingerprint use separate explicit f27-prefixed disposable databases');
ok(/\\if :\{\?F27_POST_CONTRACT_ONLY\}[\s\S]*F27_POST_CONTRACT_ONLY_OK[\s\S]*\\quit/.test(proof),
  'post-contract-only fixture exits before the proof deliberately preserves drill audit history');
ok(/F27_CANDIDATE_RELEASE_SHA: \$\{\{ github\.sha \}\}/.test(workflow)
  && /'status', '--porcelain=v1', '--untracked-files=all'/.test(workflow)
  && /releaseInfo:[\s\S]*headSha,[\s\S]*originMainSha: null[\s\S]*dirty,[\s\S]*migrationSha256/.test(workflow)
  && /release_scope: 'checked_out_candidate'/.test(workflow),
  'PR proof binds the event SHA, clean checked-out candidate, and migration hash without impersonating origin/main');
ok(/origin\/main/.test(snapshotTool)
  && /Release SHA must match both checked-out HEAD and independently fetched origin\/main/.test(snapshotTool),
  'live snapshot CLI keeps the independent origin/main release guard');
ok(/sha256sum/.test(workflow) && /GITHUB_STEP_SUMMARY/.test(workflow), 'outside-n8n observer publishes a content hash and terminal summary');

if (failures) process.exit(1);
console.log('F27 team rollback source contract passed.');
