#!/usr/bin/env node
'use strict';
/*
 * sheets-mirror-parity.js — does the Supabase mirror hold exactly what the
 * Sheets hold? (docs/plans/2026-09-24-sheets-to-supabase.md, Phase 3 step 1.)
 *
 *   node scripts/sheets-mirror-parity.js                 compare, print a report
 *   node scripts/sheets-mirror-parity.js --strict        exit 1 on any difference
 *   node scripts/sheets-mirror-parity.js --json=out.json also write the report
 *   node scripts/sheets-mirror-parity.js --db-digests=d.json
 *        use per-group digests computed elsewhere (read-only SQL) instead of
 *        reading the tables with SUPABASE_SERVICE_ROLE_KEY
 *
 * Every row is compared by its fingerprint (the same row_hash analytics-write
 * stores), not by a sample, grouped per client per day:
 *   metrics             client x date          (all history)
 *   top_videos          client x scraped_date  (last 90 days, what the site reads)
 *   content_summaries   client x date
 *   market_research_briefs  client x brief id
 *   client_profiles     client (active copy vs the Clients Info tab)
 *
 * Prints counts only. A client is shown as a short sha256 reference of its
 * slug, never by name or slug: the repository and its CI logs are public.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const SHEET_ID = (fs.readFileSync(path.join(__dirname, '..', 'src/index/040-shared-briefs.js.part'), 'utf8')
  .match(/const SHEET_ID\s*=\s*'([^']+)'/) || [])[1];
const arg = name => { const a = process.argv.find(x => x.startsWith(name + '=')); return a ? a.slice(name.length + 1) : null; };

const ref = slug => crypto.createHash('sha256').update(String(slug)).digest('hex').slice(0, 12);
const digest = hashes => crypto.createHash('md5').update([...hashes].sort().join(',')).digest('hex');

// Rows the daily analytics jobs write straight into the database in live mode
// (docs/plans/2026-10-01-n8n-off-analytics.md, section 8b). They never reach a Sheet (the
// owner decided nobody reads the Metrics and TopVideos tabs), so they are not compared:
// the comparison stays a Sheet-versus-database proof for the rows that came FROM the Sheet
// side (n8n's mirror and the copy). Once n8n is off those tabs stop growing and the
// comparison keeps proving that the history copied from them is intact.
const DATABASE_ONLY_SOURCE = 'edge';

// The datasets a live job owns (its flag says "live"): the daily copy leaves them alone, so
// an old Sheet copy can never vouch for days only the job wrote (whole-dataset receipts are
// what the staff pages trust; in live mode the job writes its own).
const COLLECT_FLAGS = Object.freeze({ analytics_metrics_collect: 'metrics', analytics_top_videos_collect: 'top_videos' });
function databaseOwnedDatasets(flagRows) {
  const owned = new Set();
  for (const row of flagRows || []) {
    const dataset = COLLECT_FLAGS[row && row.key];
    if (dataset && row.value && typeof row.value === 'object' && row.value.mode === 'live') owned.add(dataset);
  }
  return owned;
}

// Read with the service-role key (the daily lane has it). A failed read is an error, never
// "nothing owned": the caller decides whether to go on.
async function readDatabaseOwned(env = process.env, fetchImpl = fetch) {
  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to read the collect switches');
  const r = await fetchImpl(`${url}/rest/v1/syncview_runtime_flags?select=key,value&key=in.(${Object.keys(COLLECT_FLAGS).join(',')})`,
    { headers: { apikey: key, authorization: 'Bearer ' + key } });
  if (!r.ok) throw new Error('runtime flags read failed: HTTP ' + r.status);
  return databaseOwnedDatasets(await r.json());
}

// Which column groups a dataset, and which rows count.
const GROUPING = {
  metrics: { table: 'analytics_metrics', day: 'date', excludeSource: DATABASE_ONLY_SOURCE },
  top_videos: { table: 'analytics_top_videos', day: 'scraped_date', recentDays: 90, excludeSource: DATABASE_ONLY_SOURCE },
  content_summaries: { table: 'analytics_content_summaries', day: 'date' },
  market_research_briefs: { table: 'analytics_market_research_briefs', day: 'id', order: 'id' },   // no seq column
  client_profiles: { table: 'client_profiles', day: null },
};

/* groups: Map "slug\u0000day" -> { slug, day, hashes: string[] } */
function addTo(groups, slug, day, hash) {
  const k = slug + '\u0000' + (day || '');
  let g = groups.get(k);
  if (!g) { g = { slug, day: day || '', hashes: [] }; groups.set(k, g); }
  g.hashes.push(hash);
}

/* Compare two group maps. Returns { groups, matched, differences: [...] }.
   A difference names the client by reference and says which side has what. */
function compareGroups(sheet, db) {
  const keys = new Set([...sheet.keys(), ...db.keys()]);
  const differences = [];
  let matched = 0;
  for (const k of keys) {
    const s = sheet.get(k), d = db.get(k);
    const sh = s ? s.hashes : [], dh = d ? d.hashes : null;
    const sCount = sh.length;
    const dCount = d ? (d.count != null ? d.count : dh.length) : 0;
    const sDigest = sCount ? digest(sh) : '';
    const dDigest = d ? (d.digest != null ? d.digest : digest(dh || [])) : '';
    if (sCount === dCount && sDigest === dDigest) { matched++; continue; }
    const g = s || d;
    const diff = { client: ref(g.slug), day: g.day, sheet_rows: sCount, db_rows: dCount };
    if (dh) {
      const left = new Map(); for (const h of sh) left.set(h, (left.get(h) || 0) + 1);
      for (const h of dh) left.set(h, (left.get(h) || 0) - 1);
      diff.only_in_sheet = [...left.values()].filter(v => v > 0).reduce((a, v) => a + v, 0);
      diff.only_in_db = [...left.values()].filter(v => v < 0).reduce((a, v) => a - v, 0);
    }
    diff.kind = !d ? 'missing_in_db' : !s ? 'missing_in_sheet' : sCount !== dCount ? 'count_differs' : 'values_differ';
    differences.push(diff);
  }
  return { groups: keys.size, matched, differences };
}

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

async function sheetGroups(m, dataset, text, cutoff) {
  const spec = m.DATASETS[dataset];
  const g = GROUPING[dataset];
  const groups = new Map();
  // Rows with no client belong to no client: the page skips them and the copy
  // leaves them out (#1653), so they are not a difference.
  for (const row of m.parseCsv(text)) {
    const slug = m.clientSlug(row.client_name);
    if (!slug) continue;
    const day = g.day ? String(row[g.day] == null ? '' : row[g.day]).trim() : '';
    if (spec.dateColumn && !m.isIsoDate(day)) continue;   // the copy rejects these too
    if (g.recentDays && day < cutoff) continue;
    addTo(groups, slug, day, await m.rowHash(dataset, row));
  }
  return groups;
}

async function restRows(table, select, filter, order) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (or pass --db-digests)');
  const out = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${url}/rest/v1/${table}?select=${select}${filter || ''}&order=${order || 'seq'}`, {
      headers: { apikey: key, authorization: 'Bearer ' + key, range: `${from}-${from + 999}` },
    });
    if (!r.ok) throw new Error(`${table} read failed: HTTP ${r.status}`);
    const page = await r.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function dbGroupsRest(dataset, cutoff) {
  const g = GROUPING[dataset];
  const groups = new Map();
  if (dataset === 'client_profiles') {
    const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await fetch(`${url}/rest/v1/client_profiles?select=slug,row_hash&archived_at=is.null`, { headers: { apikey: key, authorization: 'Bearer ' + key } });
    if (!r.ok) throw new Error('client_profiles read failed: HTTP ' + r.status);
    for (const p of await r.json()) addTo(groups, p.slug, '', p.row_hash);
    return groups;
  }
  const filter = (g.recentDays ? `&${g.day}=gte.${cutoff}` : '') + (g.excludeSource ? `&source=neq.${g.excludeSource}` : '');
  for (const row of await restRows(g.table, `client_slug,${g.day},row_hash`, filter, g.order)) {
    addTo(groups, row.client_slug, String(row[g.day] || ''), row.row_hash);
  }
  return groups;
}

// --db-digests: { "<dataset>": [{ slug, day, count, digest }] } from read-only SQL. That SQL
// must leave out rows whose source is 'edge' for metrics and top_videos, as the REST read does.
function dbGroupsFromDigests(all, dataset) {
  const groups = new Map();
  for (const x of all[dataset] || []) {
    groups.set(x.slug + '\u0000' + (x.day || ''), { slug: x.slug, day: x.day || '', count: Number(x.count), digest: x.digest });
  }
  return groups;
}

async function main() {
  if (!SHEET_ID) throw new Error('SHEET_ID not found in src/index/040-shared-briefs.js.part');
  const m = await import(pathToFileURL(path.join(__dirname, '..', 'supabase/functions/_shared/sheets-mirror.mjs')).href);
  const cutoff = m.topVideosCutoff();
  const digestsFile = arg('--db-digests');
  const digests = digestsFile ? JSON.parse(fs.readFileSync(digestsFile, 'utf8')) : null;
  const report = { at: new Date().toISOString(), top_videos_since: cutoff, datasets: {} };
  let differences = 0;

  const roster = new Set(m.parseCsv(await download('Clients Info')).map(r => m.clientSlug(r.client_name)).filter(Boolean));
  report.active_clients = roster.size;

  for (const dataset of Object.keys(GROUPING)) {
    const text = await download(m.DATASETS[dataset].sheet);
    const sheet = await sheetGroups(m, dataset, text, cutoff);
    const db = digests ? dbGroupsFromDigests(digests, dataset) : await dbGroupsRest(dataset, cutoff);
    const res = compareGroups(sheet, db);
    const byKind = {};
    for (const d of res.differences) byKind[d.kind] = (byKind[d.kind] || 0) + 1;
    const clientsWithDiff = new Set(res.differences.map(d => d.client));
    const activeRefs = new Set([...roster].map(ref));
    const activeWithDiff = new Set(res.differences.filter(d => activeRefs.has(d.client)).map(d => d.client));
    report.datasets[dataset] = {
      groups: res.groups, matched: res.matched, differing: res.differences.length, by_kind: byKind,
      clients_with_difference: clientsWithDiff.size, active_clients_with_difference: activeWithDiff.size,
      days_with_difference: [...new Set(res.differences.map(d => d.day))].sort().slice(-10),
      differences: res.differences.slice(0, 200),
    };
    differences += res.differences.length;
    console.log(`${dataset.padEnd(24)} groups ${String(res.groups).padStart(6)}  matched ${String(res.matched).padStart(6)}  differing ${String(res.differences.length).padStart(5)}  ${JSON.stringify(byKind)}`);
  }
  report.total_differences = differences;
  const out = arg('--json');
  if (out) fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(differences ? `PARITY: ${differences} difference(s)` : 'PARITY: clean');
  if (differences && process.argv.includes('--strict')) process.exitCode = 1;
}

module.exports = { compareGroups, digest, ref, addTo, GROUPING, DATABASE_ONLY_SOURCE, databaseOwnedDatasets, readDatabaseOwned, dbGroupsRest };
if (require.main === module) main().catch(e => { console.error('parity failed: ' + e.message); process.exit(1); });
