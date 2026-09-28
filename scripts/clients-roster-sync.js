#!/usr/bin/env node
'use strict';
/*
 * clients-roster-sync.js — keep public.clients.active in step with the
 * "Clients Info" tab (owner rule 2026-09-27: a client is current only if it is
 * on that tab). migrations/2026-09-28-clients-roster-sync.sql holds the rule;
 * this script only reads the tab and calls clients_roster_sync_v1.
 *
 *   node scripts/clients-roster-sync.js           dry run: reports, changes nothing
 *   node scripts/clients-roster-sync.js --apply   switches clients off/on
 *
 * Needs SUPABASE_SERVICE_ROLE_KEY (and optionally SUPABASE_URL). Test clients
 * (kind 'test') are never touched; nothing is added or deleted. Every call is
 * logged in public.clients_roster_sync_log.
 *
 * Prints counts only, never client names or slugs (the repository and its CI
 * logs are public). The names are in the log table.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SHEET_ID = (fs.readFileSync(path.join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co';
const APPLY = process.argv.includes('--apply');

async function download(sheet) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      // gviz answers an unknown tab with the FIRST tab; the header proves it is Clients Info.
      if (!/^"?client_name"?,/.test(text)) throw new Error('unexpected header');
      return text;
    } catch (e) {
      if (attempt >= 4) throw new Error(`download of "${sheet}" failed: ${e.message}`);
      await new Promise(res => setTimeout(res, 2000 * attempt));
    }
  }
}

(async () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const rows = m.parseCsv(await download('Clients Info'));
  const slugs = [...new Set(rows.map(r => m.clientSlug(r.client_name)).filter(Boolean))];
  const runId = 'roster-' + new Date().toISOString();

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/clients_roster_sync_v1`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: key, authorization: 'Bearer ' + key },
    body: JSON.stringify({ p_current_slugs: slugs, p_run_id: runId, p_apply: APPLY }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`clients_roster_sync_v1 refused (${r.status}): ${out.message || out.code || 'unknown'}`);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN (nothing changed)'} ${runId}`);
  console.log(`  on Clients Info:        ${out.sheet_count}`);
  console.log(`  switched off:           ${(out.deactivated || []).length}${out.applied ? '' : ' (would be)'}`);
  console.log(`  switched back on:       ${(out.reactivated || []).length}${out.applied ? '' : ' (would be)'}`);
  console.log(`  on the tab, not in SyncView (reported only): ${(out.not_in_clients || []).length}`);
  if (out.refused) {
    console.log(`  REFUSED: ${out.refused} (nothing changed; see clients_roster_sync_log)`);
    process.exit(1);
  }
})().catch(e => { console.error('clients-roster-sync failed: ' + e.message); process.exit(1); });
