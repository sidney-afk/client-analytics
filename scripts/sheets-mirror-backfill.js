#!/usr/bin/env node
'use strict';
/*
 * One-time backfill of the Supabase mirror from the Google Sheets
 * (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 1).
 *
 *   node scripts/sheets-mirror-backfill.js              dry run: download, parse,
 *                                                       count; writes nothing
 *   node scripts/sheets-mirror-backfill.js --apply      send every row through
 *                                                       the analytics-write function
 *   --datasets=metrics,top_videos                       only these datasets
 *
 * --apply needs ANALYTICS_MIRROR_WRITE_KEY in the environment and the
 * analytics_mirror_write_enabled flag on. It goes through the same Edge
 * Function n8n will use (never a service-role key on a laptop), so the same
 * checks apply to both. Safe to re-run: rows are upserted on their
 * fingerprint, and each row carries its sheet-wide occurrence, so an exact
 * duplicate row in the Sheet stays a duplicate instead of collapsing and a
 * second run adds nothing.
 *
 * Prints counts only, never row contents (the repository is public).
 */
const path = require('path');
const { pathToFileURL } = require('url');

// The workbook the page reads, taken from the page source so there is one copy.
const SHEET_ID = (require('fs').readFileSync(require('path').join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
const FUNCTION_URL = (process.env.SYNCVIEW_SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co')
  + '/functions/v1/analytics-write';
const ROWS_PER_CALL = 2000;
const BYTES_PER_CALL = 6 * 1024 * 1024;

const arg = name => { const a = process.argv.find(x => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
const APPLY = process.argv.includes('--apply');

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

function chunks(rows) {
  const out = [];
  let cur = [];
  let bytes = 0;
  for (const r of rows) {
    const b = Buffer.byteLength(JSON.stringify(r));
    if (cur.length && (cur.length >= ROWS_PER_CALL || bytes + b > BYTES_PER_CALL)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(r); bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function send(key, body) {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-analytics-mirror-key': key },
      body: JSON.stringify(body),
    }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }));
    const out = await r.json().catch(() => ({}));
    if (r.ok && out.ok) return out;
    // Only a network failure or a 5xx is worth repeating; the call is idempotent.
    if (attempt >= 4 || (r.status && r.status < 500)) throw new Error(`analytics-write refused (${r.status}): ${out.error || 'unknown'}`);
    await new Promise(res => setTimeout(res, 2000 * attempt));
  }
}

(async () => {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const wanted = (arg('--datasets') || Object.keys(m.DATASETS).join(',')).split(',').map(s => s.trim()).filter(Boolean);
  for (const d of wanted) if (!m.DATASETS[d]) throw new Error('unknown dataset ' + d);
  const key = process.env.ANALYTICS_MIRROR_WRITE_KEY || '';
  if (APPLY && key.length < 32) throw new Error('--apply needs ANALYTICS_MIRROR_WRITE_KEY in the environment');
  const runId = 'backfill-' + new Date().toISOString();
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (nothing written)'} run ${runId}`);

  for (const dataset of wanted) {
    const spec = m.DATASETS[dataset];
    const t0 = Date.now();
    const text = await download(spec.sheet);
    const rows = await m.annotateSheetOccurrences(dataset, m.parseCsv(text));
    const { records, rejected } = await m.prepareRows(dataset, rows, { source: 'sheet-backfill', runId });
    const clients = new Set(records.map(r => r.client_slug || r.slug)).size;
    console.log(`  ${dataset.padEnd(24)} ${String(Buffer.byteLength(text)).padStart(9)} bytes  ${String(rows.length).padStart(6)} rows  `
      + `${String(rejected.length).padStart(3)} rejected  ${String(clients).padStart(3)} clients  (${Date.now() - t0} ms)`);
    if (rejected.length) {
      const why = {};
      for (const r of rejected) why[r.reason] = (why[r.reason] || 0) + 1;
      console.log('    rejected by reason: ' + JSON.stringify(why));
    }
    if (!APPLY) continue;
    const parts = dataset === 'client_profiles' ? [rows] : chunks(rows);
    let written = 0;
    for (let i = 0; i < parts.length; i++) {
      const out = await send(key, {
        dataset,
        source: dataset === 'client_profiles' ? 'sheet-copy' : 'sheet-backfill',
        run_id: runId,
        run_part: i,
        rows: parts[i],
        complete: i === parts.length - 1,
        // The last call of a whole-Sheet copy vouches for every client.
        full_snapshot: i === parts.length - 1,
      });
      written += out.rows_written;
    }
    console.log(`    sent in ${parts.length} call(s), ${written} rows written`);
  }
})().catch(e => { console.error('backfill failed: ' + e.message); process.exit(1); });
