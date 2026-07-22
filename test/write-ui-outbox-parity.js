'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(
  ROOT,
  'migrations',
  '2026-07-12-write-ui-outbox-parity.sql',
), 'utf8');
const outbound = fs.readFileSync(path.join(
  ROOT,
  'supabase',
  'functions',
  'linear-outbound',
  'index.ts',
), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

ok(/add column if not exists legacy_parity boolean not null default false/.test(migration),
  'legacy parity is an additive, default-off row marker');
ok(/legacy_parity = false[\s\S]*operation in \('create', 'status', 'comment'\)/.test(migration),
  'the database limits parity rows to the three approved operations');
ok(/'linear_legacy_parity_enabled'[\s\S]*'\{"enabled":false\}'::jsonb[\s\S]*on conflict \(key\) do nothing/.test(migration),
  'the independent kill gate is seeded disabled without changing an existing value');
ok(!/update public\.syncview_runtime_flags/i.test(migration),
  'the migration never changes an existing runtime flag');

ok(/v_legacy_parity boolean := coalesce\(\(v_outbound->>'legacy_parity'\)::boolean, false\)/.test(migration)
  && /jsonb_typeof\(new\.payload->'outbound'\) is distinct from 'object'/.test(migration)
  && /v_outbox_id := public\.mirror_outbox_enqueue\(/.test(migration)
  && /where id = v_outbox_id/.test(migration),
'the generic event trigger ignores envelope-free UI events and persists parity after idempotent enqueue');
ok(/v_team := coalesce\(nullif\(v_outbound->>'team', ''\), v_team\)/.test(migration),
  'team-specific parent intents support a nullable paired batch team');

ok(/function public\.production_comment_write\(\s*p_comment jsonb,\s*p_event jsonb default '\{\}'::jsonb\s*\)/.test(migration),
  'the gateway-facing normalized comment RPC has the agreed two-argument contract');
ok(/production_comment_upsert\([\s\S]*v_event - 'outbound'[\s\S]*mirror_outbox_enqueue\(/.test(migration),
  'comment storage strips the envelope before one explicit atomic enqueue');
ok(/jsonb_set\([\s\S]*'\{body\}'[\s\S]*to_jsonb\(v_result\.body\)/.test(migration),
  'the Linear body is sourced from normalized durable comment truth');
ok(/p_comment_id := v_result\.id/.test(migration)
  && /p_entity_id := v_target_id/.test(migration),
'the outbox records native comment identity while resolving the target entity');
ok(/revoke all on function public\.production_comment_write\(jsonb, jsonb\)[\s\S]*to service_role/.test(migration),
  'the atomic comment writer is service-role only');
ok(/function public\.production_outbox_replay\([\s\S]*pg_advisory_xact_lock\(hashtextextended\(p_dedup_key, 0\)\)[\s\S]*_intent_fingerprint[\s\S]*idempotency_conflict/.test(migration),
  'dedup equality is serialized and enforced inside the database transaction');
ok(/function public\.production_deliverable_write\([\s\S]*production_outbox_replay\([\s\S]*production-deliverable:[\s\S]*for update[\s\S]*expected_status[\s\S]*expected_updated_at[\s\S]*write_conflict/.test(migration),
  'deliverable writes recheck CAS under an entity lock after exact replay detection');
ok(/function public\.production_batch_write\(/.test(migration)
  && /function public\.production_batch_intent_write\(/.test(migration),
  'one native mixed batch can emit separate VID/GRA parent intents without a second row mutation');
ok(/function public\.production_assert_authority\(/.test(migration)
  && /linear_legacy_parity_enabled[\s\S]{0,180}for share/.test(migration)
  && /prod_authority[\s\S]{0,180}for share/.test(migration)
  && /p_team is null or p_team not in \('video', 'graphics'\)/.test(migration)
  && /v_authority is distinct from 'linear'/.test(migration)
  && /v_authority is distinct from 'syncview'/.test(migration),
  'authority and parity kill gates are locked and fail closed in the write transaction');

ok(/const LEGACY_PARITY_FLAG = "linear_legacy_parity_enabled"/.test(outbound)
  && /LEGACY_PARITY_OPERATIONS = new Set\(\["create", "status", "comment"\]\)/.test(outbound),
'the drainer has a separate parity control and operation allowlist');
ok(/target_dedup_key/.test(outbound)
  && /WRITE_UI_LEGACY_PARITY/.test(outbound)
  && /\.eq\("dedup_key", targetDedupKey\)/.test(outbound),
'production synchronous drain is confirmation-bound and dedup-targeted');
ok(/targetDedupKey && testClient/.test(outbound)
  && /B4_TEST_ONLY/.test(outbound)
  && /fetchLane\(false, normalStatuses, 1, "test"\)/.test(outbound),
'TEST synchronous drain targets only the named non-parity TEST row');
ok(/fetchLane\(true, parityStatuses, 1, "any"\)/.test(outbound)
  && /row\.test_only === true/.test(outbound),
'a service-confirmed parity target may select a TEST row by exact dedup and still enforces TEST project scope');
ok(/const parityStatuses = \["pending", "failed", "shadow_ok"\]/.test(outbound)
  && !/parityStatuses[^;]*written/.test(outbound)
  && !/parityStatuses[^;]*skipped/.test(outbound)
  && !/parityStatuses[^;]*stale/.test(outbound),
'terminal parity rows are never selected for redrain');
ok(/initialMode !== "off" \|\| parityEnabled/.test(outbound)
  && /parityEnabled \? fetchLane\(true, parityStatuses, limit \* 3, "real"\)/.test(outbound),
'scheduled recovery scans parity rows even while normal outbound is off');
ok(/mode: enabled \? "live" : "off"[\s\S]*legacyParity: true/.test(outbound)
  && /control\.legacyParity[\s\S]*control\.authority === "linear"[\s\S]*control\.authority === "syncview"/.test(outbound),
'parity writes require Linear authority while normal writes still require SyncView authority');
ok(/if \(error \|\| !data\) throw new Error\(`runtime flag unavailable: \$\{key\}`\)/.test(outbound)
  && /if \(!key\) return ""/.test(outbound)
  && /return raw === "linear" \? "linear" : ""/.test(outbound),
'parity fails closed when authority is unreadable, malformed, or has an unknown team/value');
ok(/if \(!team && requestedTeamId\) team = await readTeam\(requestedTeamId\)/.test(outbound)
  && /if \(!team && row\.operation === "create"\) team = await readTeamByRowTeam\(row\.team\)/.test(outbound)
  && /\["graphics", "graphic", "gra"\]\.includes\(rowTeam\)[\s\S]*\? "GRA"/.test(outbound)
  && /\["video", "vid"\]\.includes\(rowTeam\)[\s\S]*\? "VID"/.test(outbound)
  && /if \(!key\) return null/.test(outbound)
  && /teams\(first: 50\)/.test(outbound),
'create retains supplied team UUID support and otherwise resolves VID/GRA read-only');
ok(/async function targetResult/.test(outbound)
  && /status,operation,team,dedup_key,legacy_parity,test_only,attempts,next_retry_at,last_error,linear_result/.test(outbound)
  && /\.\.\.summary,\s*target/.test(outbound)
  && /\.\.\.\(f27DrillReceipt\s*\?\s*\{\s*f27_drill_receipt:\s*f27DrillReceipt\s*\}\s*:\s*\{\s*\}\)/.test(outbound),
'targeted responses expose terminal or pending status and Linear linkage without redraining');

if (failures) {
  console.error(`\n${failures} write-ui outbox parity check(s) failed`);
  process.exit(1);
}
console.log('\nwrite-ui outbox parity checks passed');
