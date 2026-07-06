'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FN = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-upsert/index.ts'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-03-a1-calendar-upsert.sql'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const PARITY = fs.readFileSync(path.join(ROOT, 'scripts/a1-calendar-upsert-parity.js'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL calendar-upsert-edge-source:', msg);
    process.exit(1);
  }
}

[
  'order_index', 'scheduled_date', 'name', 'asset_url', 'thumbnail_url',
  'caption', 'caption_alt', 'caption_alt_platform', 'post_url', 'cta',
  'tweaks', 'status', 'linear_issue_id', 'video_deliverable_id',
  'graphic_linear_issue_id', 'graphic_deliverable_id',
  'video_status', 'graphic_status', 'caption_status',
  'video_tweaks', 'graphic_tweaks', 'caption_tweaks',
  'title_status', 'title_tweaks', 'client_title_approved_at',
  'thumb_rev', 'kasper_finished_at', 'kasper_closed_at', 'kasper_finish_log'
].forEach(col => ok(FN.includes(JSON.stringify(col)), 'ALLOWED/list column missing: ' + col));

[
  'READ_FAILURE_MESSAGE',
  'CONTENT_FIELDS',
  'SCALAR_FIELDS',
  '__CLEAR_LINK__',
  'link-clobber',
  'duplicate-link',
  'comments_base_at',
  'calendar_merge_comments',
  'calendar_post_events',
  'x-syncview-actor',
  'x-syncview-role',
  'x-syncview-source',
].forEach(token => ok(FN.includes(token), 'guard/source token missing: ' + token));

ok(/for \(const col of \["video_tweaks", "graphic_tweaks", "caption_tweaks"\]/.test(FN),
  'only video/graphic/caption tweak columns are JS-merged before RPC, matching live n8n');
ok(/for \(const c of \["video", "graphic", "caption", "title"\]/.test(FN),
  'RPC args include title_tweaks even though the JS merge loop does not');
ok(/from\("calendar_posts"\)[\s\S]*\.eq\("linear_issue_id", link\)/.test(FN),
  'duplicate-link read must query linear_issue_id twins');
ok(/scalarPayloadForExisting/.test(FN) && /"title_tweaks", "tweaks"/.test(FN),
  'existing-row scalar update must strip tweak columns after RPC');

ok(/create table if not exists public\.calendar_post_events/.test(SQL), 'calendar_post_events table missing');
ok(/create table if not exists public\.syncview_runtime_flags/.test(SQL), 'runtime flags table missing');
ok(/'calendar_upsert_ef_clients'/.test(SQL), 'calendar_upsert_ef_clients seed missing');
ok(/"clients":\[\]/.test(SQL), 'runtime flag must seed empty canary allow-list');
ok(/alter publication supabase_realtime add table public\.syncview_runtime_flags/.test(SQL),
  'runtime flags table must be realtime-enabled');
ok(/alter publication supabase_realtime add table public\.calendar_post_events/.test(SQL),
  'event ledger table must be realtime-enabled');

ok(/\[functions\.calendar-upsert\]\s*verify_jwt = false/.test(CFG), 'calendar-upsert function must disable JWT verification');

ok(/A1_PARITY_CONFIRM/.test(PARITY) && /sidneylaruel/.test(PARITY),
  'parity harness must require explicit TEST-client confirmation');
ok(/normalizeGenerated/.test(PARITY) && /updated_at/.test(PARITY) && /created_at/.test(PARITY) && /ts/.test(PARITY) && /_status_at/.test(PARITY),
  'parity harness must normalize generated timestamps');
ok(/calendar_post_events/.test(PARITY) && /<generated:id>/.test(PARITY),
  'parity harness must normalize event auto-IDs before diagnostics');
ok(/comment-merge-video-tweaks/.test(PARITY) && /verifyMergedComments/.test(PARITY),
  'parity harness must include a threaded comment-merge parity case');
ok(/comments_base_at: '2026-07-03T01:05:00\.000Z'/.test(PARITY) && /concurrentComment/.test(PARITY),
  'comment-merge parity must retain a stored comment newer than the editor base');

console.log('calendar-upsert Edge Function source checks passed');
