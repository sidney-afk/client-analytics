'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CFG = fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8');
const SQL = fs.readFileSync(path.join(ROOT, 'migrations/2026-07-04-a2-writer-edge-functions.sql'), 'utf8');
const CAL_REORDER = fs.readFileSync(path.join(ROOT, 'supabase/functions/calendar-reorder/index.ts'), 'utf8');
const SXR_UPSERT = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-upsert/index.ts'), 'utf8');
const SXR_REORDER = fs.readFileSync(path.join(ROOT, 'supabase/functions/sample-review-reorder/index.ts'), 'utf8');
const RECON = fs.readFileSync(path.join(ROOT, 'scripts/sample-linear-reconcile.js'), 'utf8');

function ok(cond, msg) {
  if (!cond) {
    console.error('FAIL a2-writer-edge-source:', msg);
    process.exit(1);
  }
}

ok(/'sample_review_ef_clients'/.test(SQL), 'sample_review_ef_clients seed missing');
ok(/"clients":\[\]/.test(SQL), 'sample_review_ef_clients must seed empty');

[
  'calendar-reorder',
  'sample-review-upsert',
  'sample-review-reorder',
].forEach(fn => ok(new RegExp(`\\[functions\\.${fn}\\]\\s*verify_jwt = false`).test(CFG), fn + ' verify_jwt=false missing'));

ok(/CALENDAR_REORDER_EF_URL/.test(INDEX), 'calendar reorder EF URL missing');
ok(/_calUpsertUseEf\(slug\)/.test(INDEX), 'calendar reorder must share calendar_upsert_ef_clients');
ok(/_calReorderUrlForClient/.test(INDEX), 'calendar reorder router missing');

ok(/SXR_SAMPLE_REVIEW_FLAG_KEY = 'sample_review_ef_clients'/.test(INDEX), 'samples runtime flag key missing');
ok(/SXR_UPSERT_N8N_URL/.test(INDEX) && /SXR_UPSERT_EF_URL/.test(INDEX), 'sample upsert n8n/EF URLs missing');
ok(/SXR_REORDER_N8N_URL/.test(INDEX) && /SXR_REORDER_EF_URL/.test(INDEX), 'sample reorder n8n/EF URLs missing');
ok(/_sxrSampleFlagPromise/.test(INDEX), 'samples runtime flag must be cached');
ok(/postgres_changes'[\s\S]*key=eq\.' \+ SXR_SAMPLE_REVIEW_FLAG_KEY/.test(INDEX), 'samples runtime flag realtime refresh missing');
ok(!/fetch\(SXR_UPSERT_URL/.test(INDEX), 'frontend must not fetch SXR_UPSERT_URL directly');
ok(!/fetch\(SXR_REORDER_URL/.test(INDEX), 'frontend must not fetch SXR_REORDER_URL directly');
ok((INDEX.match(/_sxrUpsertFetch\(/g) || []).length >= 4, 'expected samples upsert router definition plus call sites');
ok((INDEX.match(/_sxrReorderFetch\(/g) || []).length >= 2, 'expected samples reorder router definition plus call site');

[
  'READ_FAILURE_MESSAGE',
  'CONTENT_FIELDS',
  'SCALAR_FIELDS',
  '__CLEAR_LINK__',
  'sample_review_merge_comments',
  'sample_review_events',
  'link clear/carry-forward',
].forEach(token => ok(SXR_UPSERT.includes(token), 'sample upsert guard/source token missing: ' + token));

[
  'thumb_rev',
  'kasper_finished_at',
  'kasper_closed_at',
  'created_at',
].forEach(col => ok(SXR_UPSERT.includes(JSON.stringify(col)), 'sample upsert allowed/mirror column missing: ' + col));

ok(!/"video_status_at"/.test(SXR_UPSERT) && !/"graphic_status_at"/.test(SXR_UPSERT),
  'sample upsert must not write trigger-owned *_status_at columns');
ok(/p_base: ""/.test(SXR_UPSERT), 'sample upsert RPC mirror must match n8n p_base behavior');
ok(/delete out\.video_tweaks/.test(SXR_UPSERT) && /delete out\.graphic_tweaks/.test(SXR_UPSERT),
  'sample update must strip tweak columns after RPC');

ok(/from\("calendar_posts"\)[\s\S]*order_index[\s\S]*updated_at/.test(CAL_REORDER),
  'calendar reorder must update order_index and updated_at');
ok(/from\("sample_reviews"\)[\s\S]*order_index/.test(SXR_REORDER),
  'sample reorder must update sample_reviews order_index');
ok(!/updated_at/.test(SXR_REORDER.split('from("sample_reviews")')[1] || ''),
  'sample reorder must not add updated_at writes');

ok(/UPSERT_FLAG_URL/.test(RECON) && /sample_review_ef_clients/.test(RECON), 'sample reconciler runtime flag read missing');
ok(/loadUpsertEfClients/.test(RECON) && /await loadUpsertEfClients\(\)/.test(RECON),
  'sample reconciler must load flag once per run');
ok(/upsertUrlForClient\(card\.client\)/.test(RECON), 'sample reconciler must route by card client');
ok(!/fetch\(UPSERT_URL/.test(RECON), 'sample reconciler must not fetch UPSERT_URL directly');
ok(/X-Syncview-Source': 'reconcile'/.test(RECON), 'sample reconciler source header missing');

console.log('A2 writer Edge Function source checks passed');
