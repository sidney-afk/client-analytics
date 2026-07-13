'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'migrations', '2026-07-12-production-comments.sql'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase', 'functions', 'production-comments', 'index.ts'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(/create table if not exists public\.production_comments/.test(migration), 'migration creates the additive comment store');
ok(/production_comments_target_check[\s\S]{0,520}deliverable_id is not null and batch_id is null[\s\S]{0,260}linear_issue_uuid/.test(migration), 'target check supports one native target or unmapped Linear history');
ok(/\n\s*client_slug text,/.test(migration) && !/client_slug text references public\.clients/.test(migration), 'unmapped archived history does not require a live client FK');
[
  'native_comment_id text',
  'linear_comment_id text',
  'linear_parent_comment_id text',
  'linear_thread_root_id text',
  'author_key text not null',
  'transport_actor text',
  'transport_role text',
  'transport_linear_user_id text',
  'source_created_at timestamptz',
  'source_updated_at timestamptz not null',
  'edited_at timestamptz',
  'deleted_at timestamptz',
  'resolved_at timestamptz',
  'import_run_id text',
  'backfill_tag text',
  'provenance jsonb',
].forEach(token => ok(migration.includes(token), `schema includes ${token}`));
ok(/production_comments_idempotency_key_idx[\s\S]{0,120}\(idempotency_key\)/.test(migration), 'idempotency key is unique');
ok(/production_comments_linear_comment_idx[\s\S]{0,160}where linear_comment_id is not null/.test(migration), 'Linear comment ID has a partial unique index');
ok(/production_comments_native_comment_idx[\s\S]{0,160}where native_comment_id is not null/.test(migration), 'native comment ID has a partial unique index');
ok(/origin in \('native', 'linear', 'legacy', 'bridge'\)/.test(migration), 'bridge provenance is supported');
ok(/linear_inbound[\s\S]{0,100}'"mirror"'::jsonb/.test(migration), 'transitional inbound source normalizes to mirror');
ok(migration.includes("v_input ? 'linear_issue_identifier'")
  && migration.includes("'{linear_identifier}'")
  && migration.includes("v_input ? 'author_role'")
  && migration.includes("'{role}'"), 'transitional field aliases normalize to canonical columns');
ok(/parent_id like 'linear:%'[\s\S]{0,420}linear_parent_comment_id[\s\S]{0,180}v_parent_id := null/.test(migration), 'unresolved external parents remain external metadata');
ok(/elsif v_batch_id is not null then[\s\S]*case when b\.team in \('video', 'graphics'\) then b\.team end[\s\S]*lower\(btrim\(v_input->>'team'\)\)[\s\S]*batch requires VID\/GRA issue team/.test(migration),
  'batch comments fall back to the normalized issue team for mixed-team batches');

ok(/alter table public\.production_comments enable row level security/.test(migration), 'base table enables RLS');
ok(/revoke all on table public\.production_comments from public, anon, authenticated/.test(migration), 'base table denies browser roles');
ok(!/grant select[^;]+production_comments[^;]+to (anon|authenticated)/i.test(migration), 'base table never grants direct browser SELECT');
ok(/protect production comment event bodies[\s\S]{0,380}as restrictive[\s\S]{0,240}comment_add/.test(migration), 'body-bearing ledger events are hidden by a restrictive policy');

ok(/create or replace function public\.production_comment_upsert\([\s\S]{0,180}security definer/.test(migration), 'service RPC is SECURITY DEFINER');
ok(/v_source_updated_at < v_existing\.source_updated_at[\s\S]{0,80}return v_existing/.test(migration), 'RPC drops stale source events');
ok(/on conflict do nothing[\s\S]{0,520}return v_result/.test(migration), 'concurrent identity retries return the committed row');
ok(/if v_deliverable_id is not null or v_batch_id is not null then[\s\S]{0,1800}insert into public\.deliverable_events/.test(migration), 'ledger snapshot is emitted only for native-mapped comments');
ok(/'comment', to_jsonb\(v_result\)/.test(migration), 'ledger snapshot is self-contained');
ok(/v_result\.author_name,[\s\S]{0,100}v_result\.role,[\s\S]{0,100}v_event_action/.test(migration), 'ledger actor and role use the stable human snapshot');
ok(/\(v_event - 'outbound' - 'comment' - 'event_key'\)/.test(migration), 'RPC strips any outbound descriptor');
ok(/grant execute on function public\.production_comment_upsert\(jsonb, jsonb\)[\s\S]{0,80}to service_role/.test(migration), 'only service_role receives RPC execute');

ok(/authorizeStaffKey\(key, \["admin", "smm", "creative"\]\)/.test(edge), 'reader requires a valid staff role key');
ok(/\.eq\("active", true\)/.test(edge) && /roleCompatible\(keyRole, member\)/.test(edge), 'reader requires one active compatible roster member');
ok(/req\.method === "OPTIONS"/.test(edge) && /req\.method !== "POST"/.test(edge), 'reader contract is POST with CORS preflight');
ok(/const MAX_LIMIT = 100/.test(edge) && /parsed > MAX_LIMIT/.test(edge), 'reader enforces the 100-row bound');
ok(/body\.deliverable_id/.test(edge) && /parseCursor\(body\.before\)/.test(edge), 'reader accepts deliverable_id and before cursor in JSON');
ok(/created_at\.lt\.\$\{before\.created_at\}[\s\S]{0,120}id\.lt\.\$\{before\.id\}/.test(edge), 'reader applies a stable created_at/id cursor');
ok(/count: "exact", head: true/.test(edge), 'reader returns an exact target total');
ok(/has_more: hasMore/.test(edge) && /next_cursor: hasMore/.test(edge), 'reader returns has_more and next_cursor');
ok(/"native_comment_id"/.test(edge) && /"transport_linear_user_id"/.test(edge), 'reader returns both native and transport identities');
ok(!/"provenance"/.test(edge), 'reader does not return raw provenance');
ok(/"Cache-Control": "no-store"/.test(edge), 'reader responses are no-store');

if (failures) {
  console.error(`\n${failures} production-comments source check(s) failed`);
  process.exit(1);
}
console.log('\nProduction-comments source checks passed');
