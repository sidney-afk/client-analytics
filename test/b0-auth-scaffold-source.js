'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-05-b0-linear-auth-scaffold.sql'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const TOKEN_FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/client-token-verify/index.ts'), 'utf8');
const KEY_FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/key-verify/index.ts'), 'utf8');
const CAL_UPSERT = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const CAL_REORDER = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-reorder/index.ts'), 'utf8');
const SXR_UPSERT = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');
const SXR_REORDER = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-reorder/index.ts'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const SEED = fs.readFileSync(path.join(ROOT, 'scripts/b0-seed-auth-scaffold.js'), 'utf8');
const EDGE_WRITERS = [CAL_UPSERT, CAL_REORDER, SXR_UPSERT, SXR_REORDER].join('\n');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL b0-auth-scaffold-source:', msg);
    process.exit(1);
  }
}

[
  'create table if not exists public.team_members',
  'create table if not exists public.clients',
  'create table if not exists public.client_access',
  'create table if not exists public.client_access_events',
  'create table if not exists public.syncview_auth_events',
  'create table if not exists public.flag_flips',
  'syncview_runtime_flags_touch_updated_at',
  'syncview_runtime_flags_log_flip',
  "'auth_enforcement'",
  '{"mode":"permissive"}',
  "'prod_authority'",
  '{"video":"linear","graphics":"linear"}',
].forEach(token => ok(SQL.includes(token), 'migration token missing: ' + token));

ok(/alter publication supabase_realtime add table public\.clients/.test(SQL), 'clients must be realtime-enabled');
ok(/alter publication supabase_realtime add table public\.team_members/.test(SQL), 'team_members must be realtime-enabled');
ok(/alter publication supabase_realtime add table public\.flag_flips/.test(SQL), 'flag_flips must be realtime-enabled');
ok(/revoke all on public\.client_access from anon/.test(SQL), 'client_access must stay service-role-only');

ok(/\[functions\.client-token-verify\]\s*verify_jwt = false/.test(CFG), 'client-token-verify config missing');
ok(/\[functions\.key-verify\]\s*verify_jwt = false/.test(CFG), 'key-verify config missing');

[
  'timingSafeEqual',
  'client_access_events',
  'auth_enforcement',
  'permissive',
  'fresh_link_required',
].forEach(token => ok(TOKEN_FN.includes(token), 'client-token-verify token missing: ' + token));

[
  'ROLE_KEY_ADMIN',
  'ROLE_KEY_SMM',
  'ROLE_KEY_CREATIVE',
  'team_members',
  'syncview_auth_events',
  'roleCompatible',
].forEach(token => ok(KEY_FN.includes(token), 'key-verify token missing: ' + token));

[
  'CLIENT_TOKEN_VERIFY_URL',
  '_syncviewVerifyClientLinkAccess',
  'client-token verifier unavailable; preserving permissive client-link behavior',
  'X-Syncview-Client-Token',
].forEach(token => ok(INDEX.includes(token), 'browser token missing: ' + token));

ok((INDEX.match(/await _syncviewVerifyClientLinkAccess/g) || []).length >= 4,
  'all client-link boot paths must call the server verifier');
ok((EDGE_WRITERS.match(/x-syncview-client-token/g) || []).length >= 4,
  'Edge Function CORS must allow the client-token header');

[
  'Clients Info',
  'Video Editors',
  'Social Media Managers',
  '--apply',
  '--manifest',
  'The script never prints token values',
].forEach(token => ok(SEED.includes(token), 'B0 seed script token missing: ' + token));

console.log('B0 auth scaffold source checks passed');
