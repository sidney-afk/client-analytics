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
/* n8n exit, PR 2: the reorder has one route. It asks the SAME runtime flag
   (calendar_upsert_ef_clients) through the shared fresh, bounded read before
   the write, and no longer has an n8n router or a batch fallback. */
ok(/await _calAssertSavingOn\(slug\);\s*const url = CALENDAR_REORDER_EF_URL;/.test(INDEX), 'calendar reorder must check the fresh flag read then post to the EF');
ok(!/_calReorderUrlForClient|CALENDAR_REORDER_BATCH_URL|CALENDAR_REORDER_URL|n8n\.cloud\/webhook\/calendar-reorder/.test(INDEX), 'calendar reorder must not keep an n8n route');
ok(/async function _calFetchPostsForVerify\(\)[\s\S]*\/rest\/v1\/calendar_posts\?select=\*&client=eq\.[\s\S]*_calSupabaseFetchAllRows/.test(INDEX)
  && !/async function _calFetchPostsForVerify\(\)[\s\S]{0,1200}CALENDAR_GET_URL/.test(INDEX),
  'bulk import verification must always read calendar_posts, never n8n calendar-get (n8n exit, PR 2)');
ok(/_calUpsertHeaders\('ui', url\)/.test(INDEX)
  && /Number\(json\.updated \|\| 0\) < items\.length/.test(INDEX)
  && !/\[Calendar\] EF reorder failed; falling back to n8n/.test(INDEX),
  'calendar EF reorder must include token headers, verify updated count, and fail closed without n8n downgrade');
ok(/showToast\('Couldn.t save the new order[\s\S]*reverted/.test(INDEX),
  'calendar reorder EF failure must remain visible after the fail-closed rejection');

ok(/SXR_SAMPLE_REVIEW_FLAG_KEY = 'sample_review_ef_clients'/.test(INDEX), 'samples runtime flag key missing');
ok(/SXR_UPSERT_N8N_URL/.test(INDEX) && /SXR_UPSERT_EF_URL/.test(INDEX), 'sample upsert n8n/EF URLs missing');
ok(/SXR_REORDER_EF_URL/.test(INDEX) && !/SXR_REORDER_N8N_URL|SXR_REORDER_URL\b|n8n\.cloud\/webhook\/sample-review-reorder/.test(INDEX), 'sample reorder must have only the EF URL (n8n exit PR 4)');
ok(/_sxrSampleFlagPromise/.test(INDEX), 'samples runtime flag must be cached');
ok(/postgres_changes'[\s\S]*key=eq\.' \+ SXR_SAMPLE_REVIEW_FLAG_KEY/.test(INDEX), 'samples runtime flag realtime refresh missing');
ok(!/fetch\(SXR_UPSERT_URL/.test(INDEX), 'frontend must not fetch SXR_UPSERT_URL directly');
ok(!/fetch\(SXR_REORDER_URL/.test(INDEX), 'frontend must not fetch SXR_REORDER_URL directly');
ok((INDEX.match(/_sxrUpsertFetch\(/g) || []).length >= 4, 'expected samples upsert router definition plus call sites');
ok((INDEX.match(/_sxrReorderFetch\(/g) || []).length >= 2, 'expected samples reorder router definition plus call site');
ok(/async function _sxrReorderFetch[\s\S]{0,200}await _sxrAssertSavingOn\(clientOrSlug\);[\s\S]{0,300}SXR_REORDER_EF_URL/.test(INDEX)
  && !/\[Samples\] EF reorder failed; falling back to n8n/.test(INDEX),
  'sample reorder must read the flag afresh and post to the EF only, never n8n (n8n exit PR 4)');
ok(/const json = await resp\.clone\(\)\.json\(\)\.catch\(\(\) => null\);[\s\S]*json && json\.ok === false/.test(INDEX),
  'sample reorder fallback failure must remain visible to the UI');
ok(/showNotify\("Couldn't save the new order", e && e\.calWritePaused \? e\.message : 'It was put back/.test(INDEX),
  'sample reorder EF failure must notify the user after the fail-closed rejection');
// F141: a reorder whose id set does not fully match live rows must fail closed,
// exactly as the calendar reorder does. The EF must report the true match count
// and the browser must reject updated < items.length instead of trusting ok.
ok(/if \(Number\(\(json && json\.updated\) \|\| 0\) < items\.length\)/.test(INDEX),
  'sample EF reorder must verify the updated count (F141 silent-loss guard)');

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
  'video_deliverable_id',
  'graphic_deliverable_id',
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
// F141: the EF must return the count of rows it ACTUALLY matched, never
// parsed.items.length. Echoing the requested length reports success for a
// reorder that persisted nothing, defeating the browser's fail-closed check.
ok(/let updated = 0/.test(SXR_REORDER) && /updated\+\+/.test(SXR_REORDER)
  && /return json\(\{ ok: true, updated \}\)/.test(SXR_REORDER)
  && !/updated: parsed\.items\.length/.test(SXR_REORDER),
  'sample reorder EF must report the true matched-row count (F141 silent-loss guard)');

console.log('A2 writer Edge Function source checks passed');
