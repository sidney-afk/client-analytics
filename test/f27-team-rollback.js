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
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'f27-team-rollback-proof.yml'), 'utf8');

ok(/track_b_f27_hold_guard/.test(sql), 'team hold blocks new active intents');
ok(!/\bdrop\s+(constraint|table|column|function|trigger)\b/i.test(sql),
  'candidate migration remains additive-only');
ok(/lock table public\.mirror_outbox in share row exclusive mode/i.test(sql), 'snapshot and finalize close enqueue races');
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
  && /status = 'written'[\s\S]*linear_result = p_reflected_receipt/.test(sql),
  'already-reflected dependencies require an audited Linear identity and become consumable');
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
ok(!/calendar-upsert|sample-review-upsert/i.test(sql), 'frozen writers are untouched');
ok(!/n8n-backups|webhook|workflow_id/i.test(sql), 'migration has no n8n mutation surface');

ok(/CREATE SCHEMA f27_test/.test(proof), 'proof uses an isolated TEST schema');
ok(/ROLLBACK TO SAVEPOINT blocked_before_classification/.test(proof), 'premature rollback refusal is exercised transactionally');
ok(/other_team_unchanged/.test(proof), 'proof asserts team isolation');
ok(/exact_prior_flags_restored/.test(proof), 'proof asserts exact pre-cycle flag restoration');
ok(/zero_payload_loss/.test(proof), 'proof hashes immutable payloads before and after');
ok(/terminal_receipts_correlated/.test(proof), 'proof asserts correlated terminal receipts');
ok(/unbound replay receipt unexpectedly succeeded/.test(proof), 'proof rejects copied or synthetic replay receipts');
ok(/in-flight begin unexpectedly succeeded/.test(proof), 'proof exercises in-flight lease refusal');
ok(/grant select on table public\.track_b_team_rollbacks to service_role/.test(sql)
  && !/grant select, insert, update on table public\.track_b_team_rollbacks/.test(sql),
  'service role can read but cannot rewrite rollback evidence directly');
ok(/postgres:16/.test(workflow) && /f27-proof/.test(workflow), 'cloud proof uses an isolated PostgreSQL service');
ok(/sha256sum/.test(workflow) && /GITHUB_STEP_SUMMARY/.test(workflow), 'outside-n8n observer publishes a content hash and terminal summary');

if (failures) process.exit(1);
console.log('F27 team rollback source contract passed.');
