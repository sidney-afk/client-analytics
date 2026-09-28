#!/usr/bin/env node
'use strict';
/*
 * sheets-mirror-catchup.js — copy rows the Supabase mirror holds, and a Sheet
 * tab does not, back into that tab (docs/plans/2026-09-24-sheets-to-supabase.md,
 * Phase 3 rollback step 2). It is the way back if a Sheet write was switched
 * off and has to come back on: without it the Sheet would keep a gap for the
 * days it was off.
 *
 *   node scripts/sheets-mirror-catchup.js --dataset=metrics --since=2026-09-26
 *        dry run: counts what is missing from the Sheet, writes nothing
 *   ... --out=missing.csv          also write the missing rows, in Sheet column order
 *   ... --apply --sheet-id=<copy>  append them to that spreadsheet (Sheets API)
 *
 * Sources, so it can be rehearsed on a COPY before it is ever needed:
 *   --sheet-id=<id>      the spreadsheet to compare and append to. Defaults to
 *                        the page's SHEET_ID for a dry run; --apply refuses the
 *                        page's own Sheet unless --production is also passed.
 *   --sheet-csv=<file>   read the tab from a local CSV instead (rehearsal)
 *   --db-rows=<file>     read the mirror rows from a local JSON array instead
 *                        of SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Rows are matched by the same fingerprint analytics-write stores (row_hash),
 * counted, so an identical row that appears twice in the mirror is added
 * twice only if the Sheet has neither copy: re-running adds nothing.
 * --apply needs GOOGLE_CREDENTIALS_JSON (a service account with edit access to
 * that spreadsheet). Prints counts only, never row contents or client names.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE_SHEET_ID = (fs.readFileSync(path.join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
const arg = name => { const a = process.argv.find(x => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };
const has = name => process.argv.includes(name);

// Which mirror table holds each dataset, and its day column. Clients Info is
// not here: it is hand-edited in the Sheet and only ever copied one way.
const TABLES = {
  metrics: { table: 'analytics_metrics', day: 'date', order: 'seq' },
  top_videos: { table: 'analytics_top_videos', day: 'scraped_date', order: 'seq' },
  content_summaries: { table: 'analytics_content_summaries', day: 'date', order: 'seq' },
  // Keyed by brief id: this table has no seq column.
  market_research_briefs: { table: 'analytics_market_research_briefs', day: 'date', order: 'id' },
};

/* The rows to add: every mirror row whose fingerprint appears more often in
   the mirror than in the Sheet. Pure, so it is tested offline. */
async function missingRows(m, dataset, sheetRows, dbRows) {
  const inSheet = new Map();
  for (const row of sheetRows) {
    if (!m.clientSlug(row.client_name)) continue;
    const h = await m.rowHash(dataset, row);
    inSheet.set(h, (inSheet.get(h) || 0) + 1);
  }
  const out = [];
  for (const row of dbRows) {
    const h = row.row_hash || await m.rowHash(dataset, row);
    const left = inSheet.get(h) || 0;
    if (left > 0) { inSheet.set(h, left - 1); continue; }
    out.push(row);
  }
  return out;
}

// A mirror row in the tab's own column order; columns the mirror keeps in
// `extra` go back to their own column.
function toSheetValues(header, row) {
  const extra = (row.extra && typeof row.extra === 'object') ? row.extra : {};
  return header.map(col => {
    const v = row[col] != null ? row[col] : extra[col];
    return v == null ? '' : String(v);
  });
}

function csvLine(values) {
  return values.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
}

async function downloadTab(sheetId, tab) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download of the tab failed: HTTP ${r.status}`);
  return r.text();
}

async function readMirror(dataset, since) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --db-rows)');
  const { table, day, order } = TABLES[dataset];
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&${day}=gte.${since}&order=${order}`, {
      headers: { apikey: key, authorization: 'Bearer ' + key, range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`${table} read failed: HTTP ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

// Google service-account token (RS256 JWT), no dependencies.
async function googleToken(credentials) {
  const b64 = x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: credentials.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600,
  });
  const sig = crypto.createSign('RSA-SHA256').update(unsigned).sign(credentials.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + unsigned + '.' + sig,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Google sign-in refused: HTTP ' + r.status);
  return j.access_token;
}

async function appendRows(sheetId, tab, values, token) {
  for (let i = 0; i < values.length; i += 1000) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent("'" + tab + "'")}:append`
      + '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const r = await fetch(url, {
      method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ values: values.slice(i, i + 1000) }),
    });
    if (!r.ok) throw new Error(`append refused: HTTP ${r.status}`);
  }
}

async function main() {
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const dataset = arg('--dataset');
  const since = arg('--since');
  if (!TABLES[dataset]) throw new Error('--dataset must be one of ' + Object.keys(TABLES).join(', '));
  if (!since || !m.isIsoDate(since)) throw new Error('--since=YYYY-MM-DD is required');
  const tab = m.DATASETS[dataset].sheet;
  const sheetId = arg('--sheet-id') || PAGE_SHEET_ID;
  const apply = has('--apply');
  if (apply && sheetId === PAGE_SHEET_ID && !has('--production')) {
    throw new Error('--apply on the live Sheet needs --production; rehearse on a copy with --sheet-id first');
  }

  const csvFile = arg('--sheet-csv');
  const text = csvFile ? fs.readFileSync(csvFile, 'utf8') : await downloadTab(sheetId, tab);
  const header = (text.split(/\r?\n/, 1)[0].match(/"((?:[^"]|"")*)"|[^,]+/g) || []).map(h => h.replace(/^"|"$/g, '').replace(/""/g, '"').trim());
  if (!header.includes('client_name')) throw new Error('the tab has no client_name column');
  const day = TABLES[dataset].day;
  const sheetRows = m.parseCsv(text).filter(r => String(r[day] || '') >= since);
  const dbFile = arg('--db-rows');
  const dbRows = (dbFile ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : await readMirror(dataset, since))
    .filter(r => String(r[day] || '') >= since);

  const add = await missingRows(m, dataset, sheetRows, dbRows);
  const values = add.map(r => toSheetValues(header, r));
  const days = [...new Set(add.map(r => String(r[day])))].sort();
  console.log(`${dataset}: Sheet rows since ${since} ${sheetRows.length}, mirror rows ${dbRows.length}, missing from the Sheet ${add.length}`
    + (days.length ? ` (days ${days[0]} to ${days[days.length - 1]})` : ''));

  const out = arg('--out');
  if (out) fs.writeFileSync(out, [csvLine(header), ...values.map(csvLine)].join('\n') + '\n');
  if (!apply || !values.length) { if (!apply) console.log('DRY RUN: nothing written'); return; }
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON || '{}');
  if (!creds.client_email || !creds.private_key) throw new Error('--apply needs GOOGLE_CREDENTIALS_JSON (a service account)');
  await appendRows(sheetId, tab, values, await googleToken(creds));
  console.log(`appended ${values.length} row(s); run it again: it should now report 0 missing`);
}

module.exports = { missingRows, toSheetValues, csvLine };
if (require.main === module) main().catch(e => { console.error('catch-up failed: ' + e.message); process.exit(1); });
