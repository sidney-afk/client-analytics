#!/usr/bin/env node
'use strict';
/*
 * analytics-metrics-shadow-seed.js: copy the PostTracking tab (n8n's per-post
 * "yesterday / today" views, the state its daily gains are computed from) into
 * analytics_post_tracking, so the shadow run of the daily metrics job starts from
 * the same "yesterday" as n8n. docs/plans/2026-10-01-n8n-off-analytics.md, section 4.
 *
 * WHEN: after n8n's run of the day has finished (about 05:20 UTC) and before the
 * shadow's first tick of the next day (04:00 UTC). The function refuses once a run
 * of today has started. The flag analytics_metrics_collect must already say "shadow".
 *
 *   node scripts/analytics-metrics-shadow-seed.js            dry run: counts only
 *   ANALYTICS_COLLECT_KEY=... node scripts/analytics-metrics-shadow-seed.js --apply
 *
 * The key is the Edge Function secret ANALYTICS_COLLECT_KEY; it lives only in that
 * terminal session. Prints counts only, never row contents (the repository is public).
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SHEET_ID = (fs.readFileSync(path.join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
const FUNCTION_URL = (process.env.SYNCVIEW_SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co') + '/functions/v1/analytics-metrics-collect';
const APPLY = process.argv.includes('--apply');
const PER_CALL = 3000;

async function download(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) {
      if (attempt >= 4) throw new Error(`download of "${sheet}" failed: ${e.message}`);
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const parsed = m.parseCsv(await download('PostTracking'));
  const rows = parsed.filter(r => String(r.post_id || '').trim() && String(r.client_name || '').trim());
  const platforms = rows.reduce((a, r) => { const p = String(r.platform || '').trim(); a[p] = (a[p] || 0) + 1; return a; }, {});
  const ids = new Set(rows.map(r => String(r.post_id).trim()));
  console.log(`PostTracking: ${parsed.length} row(s), ${rows.length} usable, ${ids.size} distinct post ids, platforms ${JSON.stringify(platforms)}`);
  if (ids.size !== rows.length) console.log(`  ${rows.length - ids.size} repeated post id(s): the last one wins, as n8n's update-by-id does`);
  if (!APPLY) { console.log('DRY RUN: nothing sent. Add --apply (with ANALYTICS_COLLECT_KEY set) to copy.'); return; }
  const key = process.env.ANALYTICS_COLLECT_KEY || '';
  if (key.length < 32) throw new Error('ANALYTICS_COLLECT_KEY is not set in this terminal session');
  let written = 0;
  for (let i = 0; i < rows.length; i += PER_CALL) {
    const res = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-analytics-collect-key': key },
      body: JSON.stringify({ action: 'seed_post_tracking', rows: rows.slice(i, i + PER_CALL) }),
    });
    const body = await res.json().catch(() => ({}));
    if (body.skipped) throw new Error('the flag analytics_metrics_collect is not set to "shadow" yet; set it first (step 5), then run this again');
    if (!res.ok || body.ok !== true) throw new Error(`seed call failed: HTTP ${res.status} ${body.error || ''}`);
    written += body.written;
  }
  console.log(`SEEDED: ${written} row(s) written`);
})().catch(e => { console.error('FAILED: ' + e.message); process.exit(1); });
