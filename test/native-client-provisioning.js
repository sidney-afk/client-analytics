'use strict';
/* Source contract for the dormant native-client provisioning RPC.  The SQL
 * proof is deliberately separate and opt-in because it starts PostgreSQL. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '2026-09-09-native-client-provisioning.sql'), 'utf8');
const docs = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'NATIVE_CLIENT_PROVISIONING.md'), 'utf8');
function has(pattern, message) { assert.match(sql, pattern, message); }

has(/add column if not exists native_project_ids jsonb not null default '\{\}'::jsonb/i,
  'new native project mapping must be additive and non-null');
has(/jsonb_typeof\(native_project_ids->'video'\) = 'string'[\s\S]{0,240}jsonb_typeof\(native_project_ids->'graphics'\) = 'string'/,
  'mapping constraint must not let SQL CHECK NULL semantics admit fake ids');
has(/create unique index if not exists clients_native_project_ids_video_unique[\s\S]{0,220}clients_native_project_ids_graphics_unique/,
  'each native team identity must have one roster owner');
has(/'svproj_video_' \|\| encode\(gen_random_bytes\(16\), 'hex'\)/,
  'video identity must be opaque UUIDhex-shaped');
has(/'svproj_graphics_' \|\| encode\(gen_random_bytes\(16\), 'hex'\)/,
  'graphics identity must be opaque UUIDhex-shaped');
assert.doesNotMatch(sql, /set\s+linear_project_ids/i, 'native provisioning must not rewrite legacy mappings');
has(/create table if not exists public\.production_native_client_provisions/i,
  'immutable provision receipt is required');
has(/request_id text primary key/i, 'receipt has request id primary key');
has(/client_slug text not null unique references public\.clients\(slug\)/i,
  'receipt binds exactly one client slug');
has(/before update or delete/i, 'receipt update/delete must be rejected');
has(/before truncate/i, 'receipt truncation must be rejected');
has(/production_native_client_provision\(\s*\n?\s*p_request_id text,\s*\n?\s*p_client_slug text,\s*\n?\s*p_display_name text/s,
  'RPC signature must stay narrow and explicit');
has(/security definer\s*\nset search_path = pg_catalog, public, extensions, pg_temp/i,
  'RPC must carry a locked security-definer search path');
has(/pg_advisory_xact_lock\(hashtextextended\('native-client-provision-request:'/,
  'request advisory lock is required');
has(/pg_advisory_xact_lock\(hashtextextended\('native-client-provision-slug:'/,
  'slug advisory lock is required');
has(/order by key\s*\n    for update/i, 'runtime flags must lock in deterministic order');
has(/production_native_intake_epochs\(\)/, 'both native intake epochs must be checked through the canonical contract');
has(/v_authority->>'video'.*syncview/s, 'video authority must be SyncView');
has(/v_authority->>'graphics'.*syncview/s, 'graphics authority must be SyncView');
for (const key of ['calendar_upsert_ef_clients', 'sample_review_ef_clients', 'settings_ef_clients', 'write_ui_reroute_clients']) {
  assert.ok(sql.includes("'" + key + "'"), key + ' must be locked and enrolled');
}
has(/on conflict \(slug\) do nothing/i, 'token fallback must never rotate an existing token');
has(/v_client\.active is distinct from true[\s\S]{0,450}native_client_provision_state_drift/i,
  'replay must reject an offboarded or changed client');
has(/native_client_provision_routing_drift/i, 'replay must reject removed routing entries');
has(/revoke all on function public\.production_native_client_provision[\s\S]{0,180}from public, anon, authenticated[\s\S]{0,180}grant execute[\s\S]{0,120}to service_role/i,
  'RPC must be service-role only');
assert.doesNotMatch(sql, /return jsonb_build_object\([\s\S]{0,300}'display_name'/i,
  'safe RPC responses must never include a display name');
assert.doesNotMatch(sql, /return jsonb_build_object\([\s\S]{0,260}'review_token'/i,
  'safe RPC responses must never include a review token');
assert.match(docs, /DORMANT/i, 'operator docs must state the activation posture');
assert.match(docs, /No automatic mutation schedule/i, 'operator docs must state the monitoring gap');
console.log('ok native client provisioning source contract');
