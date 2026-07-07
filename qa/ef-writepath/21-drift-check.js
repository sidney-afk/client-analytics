// Phase 1b — column drift check (READ-ONLY). For every FLAGGED client, read live
// (non-archived) calendar_posts + sample_reviews rows via the anon key and verify
// that no row carries a non-empty value in a column the EF's ALLOWED list would
// DROP (i.e. the EF preserves the full n8n row shape). Also flags any duplicate
// live Linear link within a client. No writes; real clients are read-only.
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const SUPA = 'https://uzltbbrjidmjwwfakwve.supabase.co';
const ROOT = path.resolve(__dirname, '..', '..');
// The flagged-client roster is read from the live runtime flag at run time — never
// hard-coded, so no client identifiers are committed to this public repo.
function flaggedClients() {
  const out = execSync(`curl -s ${JSON.stringify(SUPA + '/rest/v1/syncview_runtime_flags?select=value&key=eq.calendar_upsert_ef_clients&limit=1')} -H ${JSON.stringify('apikey: ' + KEY)} -H ${JSON.stringify('Authorization: Bearer ' + KEY)}`, { encoding: 'utf8' });
  try { const rows = JSON.parse(out); const v = rows && rows[0] && rows[0].value; return (v && Array.isArray(v.clients)) ? v.clients : []; }
  catch { return []; }
}
const CLIENTS = flaggedClients();

// Columns the EF legitimately does not carry in ALLOWED but that exist as
// id/foreign/trigger/DDL-owned system columns — not drift.
const SYSTEM = new Set(['id', 'client', 'client_slug', 'updated_at', 'created_at',
  'video_status_at', 'graphic_status_at', 'caption_status_at', 'title_status_at',
  'comments']);

function allowedFrom(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const m = src.match(/const ALLOWED = \[([\s\S]*?)\]\s*as const;/);
  if (!m) throw new Error('ALLOWED not found in ' + file);
  return new Set(m[1].split(',').map(x => (x.match(/"([^"]+)"/) || [])[1]).filter(Boolean));
}
function get(table, qs) {
  const out = execSync(`curl -s ${JSON.stringify(SUPA + '/rest/v1/' + table + '?' + qs)} -H ${JSON.stringify('apikey: ' + KEY)} -H ${JSON.stringify('Authorization: Bearer ' + KEY)}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  try { return JSON.parse(out); } catch { return []; }
}
const nonEmpty = (v) => v !== null && v !== undefined && String(v).trim() !== '';

function checkTable(table, allowed, client) {
  const rows = get(table, `client=eq.${client}&or=(status.is.null,status.neq.Archived)&select=*&limit=1000`);
  const drift = {}; const dupLinks = {};
  const seenV = new Map(), seenG = new Map();
  for (const r of (Array.isArray(rows) ? rows : [])) {
    for (const k of Object.keys(r)) {
      if (allowed.has(k) || SYSTEM.has(k)) continue;
      if (nonEmpty(r[k])) drift[k] = (drift[k] || 0) + 1;
    }
    const v = String(r.linear_issue_id || '').trim(), g = String(r.graphic_linear_issue_id || '').trim();
    if (v) { if (seenV.has(v)) dupLinks[v] = true; else seenV.set(v, r.id); }
    if (g) { if (seenG.has(g)) dupLinks[g] = true; else seenG.set(g, r.id); }
  }
  return { count: Array.isArray(rows) ? rows.length : 0, drift, dupLinks: Object.keys(dupLinks) };
}

(function () {
  const calAllowed = allowedFrom('supabase/functions/calendar-upsert/index.ts');
  const sxrAllowed = allowedFrom('supabase/functions/sample-review-upsert/index.ts');
  console.log('calendar-upsert ALLOWED cols:', calAllowed.size, '| sample-review-upsert ALLOWED cols:', sxrAllowed.size);
  let fail = 0;
  const summary = {};
  for (const c of CLIENTS) {
    const cal = checkTable('calendar_posts', calAllowed, c);
    const sxr = checkTable('sample_reviews', sxrAllowed, c);
    const calDrift = Object.keys(cal.drift), sxrDrift = Object.keys(sxr.drift);
    summary[c] = { cal, sxr };
    const bad = calDrift.length || sxrDrift.length || cal.dupLinks.length || sxr.dupLinks.length;
    if (bad) fail++;
    console.log(`\n[${c}] calendar rows=${cal.count} samples rows=${sxr.count}`);
    console.log(`  calendar drift cols: ${calDrift.length ? JSON.stringify(cal.drift) : 'NONE'}  | dup links: ${cal.dupLinks.length ? JSON.stringify(cal.dupLinks) : 'NONE'}`);
    console.log(`  samples  drift cols: ${sxrDrift.length ? JSON.stringify(sxr.drift) : 'NONE'}  | dup links: ${sxr.dupLinks.length ? JSON.stringify(sxr.dupLinks) : 'NONE'}`);
  }
  try { fs.writeFileSync('/tmp/qa-efwp/results-drift.json', JSON.stringify(summary, null, 2)); } catch (e) {}
  console.log(`\nDRIFT-CHECK: ${CLIENTS.length - fail}/${CLIENTS.length} clients clean (no dropped-column drift, no dup links)`);
  process.exit(fail ? 1 : 0);
})();
