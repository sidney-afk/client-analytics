#!/usr/bin/env node
'use strict';
/*
 * roster-managers-parity.js -- does the Social Media Managers Sheet tab hold
 * exactly the assignments the database holds? (Sheets move, slice 1:
 * docs/plans/2026-10-03-sheets-remaining-map.md.)
 *
 *   node scripts/roster-managers-parity.js            compare, print counts
 *   node scripts/roster-managers-parity.js --strict   exit 1 on any difference
 *
 * Since 2026-10-02 the database (social_media_managers) is the main copy and
 * the tab is a mirror the database keeps (roster-write's Sheet copy). The page
 * stops reading the tab when the roster switch is on, so this proves the two
 * copies agree before and after: one row per (client, manager, Slack link),
 * compared as a multiset after the same name normalisation the page uses.
 * Clients Info has its own comparison in sheets-mirror-parity.js.
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read only). Prints counts
 * and short sha256 references only, never a name, slug or link: the
 * repository and its CI logs are public.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SHEET_ID = (fs.readFileSync(path.join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];

const ref = v => crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 12);
// The page's own client-name key (wlNormalizeClient in src/index/070-core-client-names.js.part).
function clientKey(v) {
  let t = String(v == null ? '' : v).toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/^dr\.?\s+/, '');
  t = t.replace(/\s+(?:and|&)\s+/g, '&');
  return t.replace(/[^a-z0-9&]+/g, '');
}
const nameKey = v => String(v == null ? '' : v).trim().toLowerCase().replace(/\s+/g, ' ');
const linkKey = v => String(v == null ? '' : v).trim();

// One key per assignment row. A row without a client is not an assignment (the page skips it).
function sheetAssignments(rows) {
  const out = [];
  for (const r of rows || []) {
    const c = clientKey(r.client_name);
    if (!c) continue;
    out.push([c, nameKey(r.social_media_manager), linkKey(r.slack_profile_url)].join('\u0001'));
  }
  return out;
}
function databaseAssignments(managers) {
  const out = [];
  for (const m of managers || []) {
    if (!m || m.active === false) continue;
    for (const client of Array.isArray(m.source_clients) ? m.source_clients : []) {
      const c = clientKey(client);
      if (!c) continue;
      out.push([c, nameKey(m.name), linkKey(m.slack_profile_url)].join('\u0001'));
    }
  }
  return out;
}

// Multiset difference, reported per client reference.
function compareAssignments(sheet, db) {
  const count = list => { const m = new Map(); for (const k of list) m.set(k, (m.get(k) || 0) + 1); return m; };
  const a = count(sheet), b = count(db);
  const differences = [];
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    const inSheet = a.get(k) || 0, inDb = b.get(k) || 0;
    if (inSheet !== inDb) differences.push({ client: ref(k.split('\u0001')[0]), in_sheet: inSheet, in_db: inDb });
  }
  differences.sort((x, y) => x.client.localeCompare(y.client));
  return { sheet_rows: sheet.length, db_rows: db.length, clients: new Set(sheet.concat(db).map(k => k.split('\u0001')[0])).size, differences };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
  const m = await import(require('url').pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const csv = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('Social Media Managers')}`);
  if (!csv.ok) throw new Error('Sheet download failed: HTTP ' + csv.status);
  const r = await fetch(`${url}/rest/v1/social_media_managers?select=name,active,source_clients,slack_profile_url&active=eq.true`,
    { headers: { apikey: key, authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('database read failed: HTTP ' + r.status);
  const report = compareAssignments(sheetAssignments(m.parseCsv(await csv.text())), databaseAssignments(await r.json()));
  console.log(`  managers   ${String(report.sheet_rows).padStart(4)} Sheet rows  ${String(report.db_rows).padStart(4)} database rows  `
    + `${String(report.clients).padStart(3)} clients  ${report.differences.length} differences`);
  for (const d of report.differences.slice(0, 50)) console.log(`    client ${d.client}: Sheet ${d.in_sheet}, database ${d.in_db}`);
  console.log(report.differences.length ? 'PARITY: differences' : 'PARITY: clean');
  if (strict && report.differences.length) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(e => { console.error('parity failed: ' + e.message); process.exitCode = 1; });
}
module.exports = { clientKey, sheetAssignments, databaseAssignments, compareAssignments };
