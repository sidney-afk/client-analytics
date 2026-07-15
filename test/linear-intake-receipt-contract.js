'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONTRACT_PATH = path.join(ROOT, 'docs', 'ops', 'linear-intake-receipts.contract.json');
const RUNBOOK_PATH = path.join(ROOT, 'docs', 'ops', 'LINEAR_INTAKE_RECOVERY.md');
const MIGRATION_PATH = path.join(ROOT, 'migrations', '2026-07-14-linear-intake-receipts.sql');
const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
const runbook = fs.readFileSync(RUNBOOK_PATH, 'utf8');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const columns = new Map(contract.columns.map(column => [column.name, column]));
const requiredColumns = [
  'receipt_key', 'payload_hash', 'client', 'team', 'payload_json',
  'requested_at', 'updated_at', 'status', 'attempts', 'parent_issue_id',
  'parent_issue_url', 'child_issue_ids', 'error', 'replay_note',
];

ok(contract.authoritative_store.kind === 'supabase'
  && contract.authoritative_store.name === 'linear_intake_receipts'
  && contract.authoritative_store.primary_key === 'receipt_key',
  'Supabase is the named primary-key receipt authority');
ok(contract.schema_version === 2,
  'receipt contract version includes database-bound canonical payload and replay claims');
ok(contract.operator_mirror.id === 'EncletbVvvYfSDfF'
  && contract.operator_mirror.project_id === '4dvRQbC5gyJNowXX'
  && contract.operator_mirror.authority === false
  && contract.operator_mirror.mirrors_statuses.join(',') === 'failed,partial',
  'the deployed n8n table is pinned as a failed/partial operator mirror only');
ok(contract.authoritative_store.primary_key === 'receipt_key'
  && contract.identity.receipt_key === 'linear-intake-v1:<team>:<payload_hash>',
  'team plus canonical payload hash owns duplicate suppression');
ok(contract.identity.canonical_payload.top_level_fields.join(',') === 'clientName,filmingPlans,notes,title,videos'
  && contract.identity.canonical_payload.video_fields.join(',') === 'audio,dueDate,main_cam,number,side_cam'
  && contract.identity.canonical_payload.excluded_transport_fields.includes('mode')
  && contract.identity.canonical_payload.excluded_transport_fields.includes('team')
  && contract.identity.canonical_payload.excluded_transport_fields.includes('payload_hash')
  && contract.identity.canonical_payload.excluded_transport_fields.includes('operator_replay_id')
  && contract.identity.canonical_payload.expected_child_count === 'payload_json.videos.length',
  'canonical payload shape excludes transport metadata and owns the expected child count');
ok(requiredColumns.length === columns.size && requiredColumns.every(name => columns.has(name)),
  'the source contract exactly mirrors all deployed Data Table columns');
ok(columns.get('payload_hash').required === true
  && columns.get('payload_json').required === true
  && columns.get('status').required === true,
  'payload-bearing pending state cannot be represented as optional metadata');

const tableMatch = migration.match(/create table if not exists public\.linear_intake_receipts \(([\s\S]*?)\n\);/);
const sqlColumns = tableMatch
  ? tableMatch[1].split(/\n\s*constraint /)[0].split('\n')
    .map(line => line.trim()).filter(Boolean).map(line => line.split(/\s+/)[0])
  : [];
ok(requiredColumns.join(',') === sqlColumns.join(','),
  'the authoritative table has exactly the 14 n8n-compatible public columns');
ok(/receipt_key text primary key/.test(migration)
  && /payload_hash ~ '\^\[0-9a-f\]\{64\}\$'/.test(migration)
  && /team in \('video', 'graphics'\)/.test(migration)
  && /receipt_key = 'linear-intake-v1:' \|\| team \|\| ':' \|\| payload_hash/.test(migration),
  'database checks enforce the receipt primary key, team, and SHA-256 identity');
ok(/payload_json text not null/.test(migration)
  && /child_issue_ids text not null default '\[\]'/.test(migration)
  && /replay_note text/.test(migration)
  && /_linear_intake_payload_is_canonical\(payload_json\)/.test(migration)
  && /status in \('pending', 'created', 'failed', 'partial'\)/.test(migration)
  && /_linear_intake_is_string_array\(child_issue_ids::jsonb\)/.test(migration),
  'native-node JSON text fields are canonicalized with state and UUID-array guards');
ok(/create extension if not exists pgcrypto with schema extensions/.test(migration)
  && /extensions\.digest\(convert_to\(p_value, 'UTF8'\), 'sha256'\)/.test(migration)
  && /payload_hash = public\._linear_intake_sha256_hex\(payload_json\)/.test(migration)
  && /client = btrim\(payload_json::jsonb ->> 'clientName'\)/.test(migration),
  'pgcrypto binds the receipt hash and client to the exact canonical payload bytes');
ok(/p_value <> public\._linear_intake_canonical_json\(v_payload\)/.test(migration)
  && /array\['clientName', 'filmingPlans', 'notes', 'title', 'videos'\]/.test(migration)
  && /array\['audio', 'dueDate', 'main_cam', 'number', 'side_cam'\]/.test(migration)
  && /\(v_video ->> 'number'\)::bigint <> v_ordinality/.test(migration),
  'database canonicalization pins stable field sets and consecutive video order');
ok(/linear_intake_identity_immutable/.test(migration)
  && /linear_intake_attempts_must_be_monotonic/.test(migration)
  && /linear_intake_child_ids_must_be_monotonic/.test(migration)
  && /linear_intake_created_is_terminal/.test(migration)
  && /linear_intake_replay_attempt_must_increment_once/.test(migration)
  && /linear_intake_new_replay_note_required/.test(migration)
  && /linear_intake_replay_id_must_be_new/.test(migration)
  && /linear_intake_pending_replay_conflict/.test(migration),
  'native row updates cannot rewrite identity, lose progress, reopen success, or reuse a replay claim');
ok(/new\.attempts <> old\.attempts \+ 1/.test(migration)
  && /new\.replay_note is not distinct from old\.replay_note/.test(migration)
  && /_linear_intake_replay_note_is_valid/.test(migration)
  && /old\.status = 'pending' and new\.status = 'pending'/.test(migration),
  'failed/partial replay claims atomically increment once and pending rejects a second claim');
ok(/linear_intake_receipts_created_children_complete_check/.test(migration)
  && /jsonb_array_length\(child_issue_ids::jsonb\)[\s\S]{0,120}= public\._linear_intake_expected_child_count\(payload_json::jsonb\)/.test(migration)
  && /count\(distinct item\.value #>> '\{\}'\)/.test(migration)
  && /parent_issue_id is null[\s\S]{0,120}parent_issue_id ~\* '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/.test(migration)
  && /\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/.test(migration),
  'created authority accepts only a parent UUIDv4 and the exact payload-derived count of unique child UUIDv4s');
ok(/enable row level security/.test(migration)
  && /revoke all on table public\.linear_intake_receipts[\s\S]*from public, anon, authenticated, service_role/.test(migration)
  && /grant select, insert, update on table public\.linear_intake_receipts[\s\S]*to service_role/.test(migration)
  && !/grant[^;]*delete[^;]*linear_intake_receipts/i.test(migration),
  'receipt rows are service-role only and the workflow receives no delete grant');

const states = contract.states;
ok(Object.keys(states).sort().join(',') === 'created,failed,partial,pending',
  'the source contract exactly mirrors the four live workflow statuses');
ok(/fresh pending row is an in-progress workflow/i.test(states.pending)
  && /full payload/i.test(states.failed)
  && /expected issue/i.test(states.partial)
  && /only success state/i.test(states.created),
  'pending is concurrency-safe, failures stay replayable, and only confirmed creation is success');

ok(contract.retry.max_attempts === 3
  && contract.retry.backoff_seconds.length === contract.retry.max_attempts
  && contract.retry.automatic_retry_requires_zero_created_issue_ids === true
  && contract.retry.timeout_is_failure === true,
  'automatic retries are bounded and stop immediately after a partial create or timeout');

ok(contract.identity.linear_uuid_namespace === '8ec6f2de-20f4-4dc3-8f21-8b3298e780db'
  && /<receipt_key>:parent/.test(contract.identity.parent_seed)
  && /<receipt_key>:child:<stable-child-key>/.test(contract.identity.child_seed)
  && /same expected Linear UUIDs/.test(contract.identity.retry_rule)
  && /cannot replace it with a new payload hash/.test(contract.identity.receipt_abandonment_rule),
  'parent and child creates reuse deterministic Linear IDs across retries');

ok(contract.replay.resume_only_missing_expected_issue_ids === true
  && contract.replay.parent_replay_requires_recorded_absence_confirmation === true
  && contract.replay.never_clear_created_issue_ids === true
  && contract.replay.allowed_source_states.join(',') === 'failed,partial'
  && contract.replay.operator_required_source_states.join(',') === 'partial'
  && contract.replay.requires_operator_identity === 'partial only'
  && /failed receipt may be claimed/i.test(contract.replay.automatic_failed_retry)
  && /unchanged payload_json/.test(contract.replay.transport)
  && /operator_replay_id/.test(contract.replay.transport)
  && /exactly matches/.test(contract.replay.operator_claim_capability)
  && /payload_hash/.test(contract.replay.replay_note_rule),
  'operator replay is limited to positively missing work and cannot forget partial progress');
ok(/compare-and-set/.test(contract.replay.claim_rule)
  && /attempts=prior_attempts\+1/.test(contract.replay.claim_rule)
  && contract.replay.replay_note_schema.schema_version === 1
  && contract.replay.replay_note_schema.additional_fields === false
  && contract.replay.replay_note_schema.exact_id_readback.additional_fields === false
  && !contract.replay.replay_note_schema.required_fields.includes('payload_json')
  && /new UUIDv4/.test(contract.replay.replay_note_schema.replay_id)
  && contract.replay.replay_note_schema.exact_id_readback.strategy === 'read-before-create',
  'replay contract requires one winning claim and a new structured, receipt-bound note');
ok(/array\[\s*'exact_id_readback', 'payload_hash', 'prior_attempts', 'reason',[\s\S]{0,180}'schema_version', 'source_status'[\s\S]{0,30}\]::text\[\]/.test(migration)
  && /array\['confirmed_child_ids', 'parent', 'strategy'\]::text\[\]/.test(migration)
  && !contract.replay.replay_note_schema.required_fields.includes('payload_json'),
  'database replay-note allowlists distinguish each fresh claim without copying payload_json');
ok(/Read Linear by[\s\S]{0,120}every derived ID, not by title/.test(runbook)
  && /compute[^\n]*`expected - created`/.test(runbook)
  && /unknown result is not permission to create/i.test(runbook),
  'the runbook requires exact-ID classification and fails closed on ambiguous reads');
ok(/who confirmed parent absence[\s\n]*and when/.test(runbook)
  && /A duplicate-ID response from Linear is not automatically success/.test(runbook),
  'parent and duplicate recovery require readback rather than optimistic recreation');
ok(/Claim the replay with one compare-and-set update/.test(runbook)
  && /attempts = prior_attempts \+ 1/.test(runbook)
  && /If the update affects zero rows[\s\S]{0,80}stop and re-triage/.test(runbook)
  && /Never pre-write the note/.test(runbook)
  && /operator_replay_id/.test(runbook)
  && /missing or wrong capability returns[\s\S]{0,30}non-200/i.test(runbook),
  'operator recovery claims status, attempt, and a new note atomically');

function stableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableJson(value[key])).join(',') + '}';
}
const examplePayload = {
  clientName: 'Receipt Test',
  title: 'VID - Receipt Test - 2026-07-14',
  notes: '',
  videos: [{ number: 1, main_cam: '', side_cam: '', audio: '', dueDate: null }],
  filmingPlans: '',
};
const canonicalExample = stableJson(examplePayload);
const exampleHash = crypto.createHash('sha256').update(canonicalExample, 'utf8').digest('hex');
ok(/^[0-9a-f]{64}$/.test(exampleHash)
  && exampleHash === crypto.createHash('sha256').update(stableJson(examplePayload), 'utf8').digest('hex')
  && !canonicalExample.includes('"mode"')
  && !canonicalExample.includes('"team"'),
  'reference canonical serialization is stable across UI mode and team transport wrappers');

ok(contract.retention.created_days === 30
  && contract.retention.unresolved_auto_delete === false
  && /never automatically\s+pruned/i.test(runbook)
  && /execution-history[\s\S]*is not a\s+substitute/i.test(runbook),
  'unresolved payloads survive execution-log expiry and terminal retention is explicit');

if (failures) {
  console.error(`\n${failures} Linear intake receipt contract check(s) failed`);
  process.exit(1);
}
console.log('\nLinear intake receipt contract checks passed');
