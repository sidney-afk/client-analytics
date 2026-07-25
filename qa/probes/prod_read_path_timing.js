#!/usr/bin/env node
'use strict';
/*
 * prod_read_path_timing.js — READ-ONLY anon timing probe for the Production
 * browser read path (`production_deliverables_browser_v1`).
 *
 * Why this exists: on 2026-07-25 the Production boot was found to exceed the
 * anon statement timeout (PostgreSQL 57014 / HTTP 500) under its own page
 * burst, and F95 (bounded foreground refresh) adds read load on top of that.
 * Before designing around it we measured which part of the read is expensive.
 * This probe reproduces those measurements on demand so a future change can be
 * compared against the same shapes instead of a remembered number.
 *
 * SAFETY
 *   - GET only, anon publishable key only, no header that could authorize a
 *     write. It cannot mutate anything.
 *   - It prints latency, row counts, and payload sizes. It never prints, keeps,
 *     or transmits a row body, title, client name, identifier, or URL.
 *   - `burst` deliberately reproduces the failure and can push real anon
 *     requests into the statement timeout. Run it sparingly and never while a
 *     live drill or a real user session matters.
 *
 * USAGE
 *   node qa/probes/prod_read_path_timing.js            # single-request shapes
 *   node qa/probes/prod_read_path_timing.js pagination # keyset vs offset walk
 *   node qa/probes/prod_read_path_timing.js delta      # F95 refresh predicate
 *   node qa/probes/prod_read_path_timing.js burst      # reproduce 57014 (careful)
 *   node qa/probes/prod_read_path_timing.js all
 *
 * `REPS=<n>` sets repetitions per shape (default 3). The Supabase URL and anon
 * key default to the ones the shipped page already publishes in index.html and
 * can be overridden with SUPABASE_URL / SUPABASE_ANON_KEY.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function fromIndexHtml(name, fallback) {
  try {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const match = new RegExp(`const\\s+${name}\\s*=\\s*'([^']+)'`).exec(html);
    return match ? match[1] : fallback;
  } catch (_error) {
    return fallback;
  }
}

const BASE = (process.env.SUPABASE_URL || fromIndexHtml('CAL_SUPABASE_URL', '')).replace(/\/$/, '');
const ANON = process.env.SUPABASE_ANON_KEY || fromIndexHtml('CAL_SUPABASE_ANON_KEY', '');
const VIEW = 'production_deliverables_browser_v1';
const REPS = Math.max(1, Number(process.env.REPS || 3));

// The exact select list the shipped browser sends.
const FULL = fromIndexHtml('PROD_DELIVERABLE_SELECT', '');
const BASE_COLUMNS = FULL.split(',')
  .filter(column => !/^raw_|^identity_repair/.test(column)).join(',');
const RAW_COLUMNS = ['id'].concat(FULL.split(',')
  .filter(column => /^raw_|^identity_repair/.test(column))).join(',');
const LEGACY_SORT = 'team.asc,status.asc,due_date.asc';

if (!BASE || !ANON || !FULL) {
  console.error('missing Supabase URL, anon key, or PROD_DELIVERABLE_SELECT — cannot probe');
  process.exit(2);
}

async function get(query) {
  const started = Date.now();
  let response = null;
  let text = '';
  let networkError = '';
  try {
    response = await fetch(`${BASE}/rest/v1/${VIEW}?${query}`, {
      headers: { apikey: ANON, Accept: 'application/json' },
      signal: AbortSignal.timeout(60000),
    });
    text = await response.text();
  } catch (error) {
    networkError = String((error && error.message) || error);
  }
  const wall = Date.now() - started;
  let rows = null;
  let code = '';
  if (response && response.ok) {
    try { rows = JSON.parse(text); } catch (_error) { rows = null; }
  } else if (text) {
    try { code = JSON.parse(text).code || ''; } catch (_error) { code = 'unparseable'; }
  }
  return {
    status: response ? response.status : 0,
    upstream: response ? Number(response.headers.get('x-envoy-upstream-service-time') || 0) : 0,
    wall,
    bytes: text.length,
    rows,
    code,
    networkError,
  };
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

async function shape(label, query) {
  const runs = [];
  for (let i = 0; i < REPS; i++) {
    runs.push(await get(query));
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  const good = runs.filter(run => run.status === 200);
  const failed = runs.filter(run => run.status !== 200)
    .map(run => `${run.status}${run.code ? '/' + run.code : ''}${run.networkError ? '/' + run.networkError : ''}`);
  console.log([
    label.padEnd(34),
    `upstream_med=${String(median(good.map(run => run.upstream))).padStart(5)}ms`,
    `wall_med=${String(median(good.map(run => run.wall))).padStart(5)}ms`,
    `rows=${String(good[0] ? good[0].rows.length : 0).padStart(4)}`,
    `kb=${String(good[0] ? Math.round(good[0].bytes / 1024) : 0).padStart(5)}`,
    failed.length ? `FAILED=[${failed.join(' ')}]` : '',
  ].join('  ').trimEnd());
}

async function single() {
  console.log('\n== single request, 1000-row page ==');
  console.log('   Isolates what the page cost actually is. The sort is nearly free;');
  console.log('   each separate linear_raw extraction is what costs.\n');
  await shape('full projection + legacy sort', `select=${FULL}&order=${LEGACY_SORT}&limit=1000&offset=0`);
  await shape('full projection + legacy sort p4', `select=${FULL}&order=${LEGACY_SORT}&limit=1000&offset=4000`);
  await shape('full projection + id sort', `select=${FULL}&order=id.asc&limit=1000&offset=0`);
  await shape('base columns only + legacy sort', `select=${BASE_COLUMNS}&order=${LEGACY_SORT}&limit=1000`);
  await shape('raw_* columns only + id sort', `select=${RAW_COLUMNS}&order=id.asc&limit=1000`);
  await shape('two columns + legacy sort', `select=id,status&order=${LEGACY_SORT}&limit=1000`);
  await shape('full projection, no order', `select=${FULL}&limit=1000`);
}

// One sequential walk of the whole projection. `nextQuery(pageIndex, lastRow)`
// returns the query for each page; the walk stops on a short page, an error, or
// a cursor that cannot advance.
async function walk(label, nextQuery) {
  const upstream = [];
  let total = 0;
  let wall = 0;
  let lastRow = null;
  for (let page = 0; page < 12; page++) {
    const result = await get(nextQuery(page, lastRow));
    if (result.status !== 200) {
      console.log(`${label.padEnd(34)}  ABORTED status=${result.status}${result.code ? '/' + result.code : ''}`);
      return;
    }
    upstream.push(result.upstream);
    wall += result.wall;
    total += result.rows.length;
    if (result.rows.length < 1000) break;
    lastRow = result.rows[result.rows.length - 1];
    if (!lastRow || !lastRow.id) break;
  }
  console.log([
    label.padEnd(34),
    `rows=${String(total).padStart(5)}`,
    `sum_upstream=${String(upstream.reduce((a, b) => a + b, 0)).padStart(5)}ms`,
    `wall=${String(wall).padStart(5)}ms`,
    `pages=[${upstream.join(',')}]`,
  ].join('  '));
}

async function pagination() {
  console.log('\n== full sequential walk of the projection ==');
  console.log('   OFFSET re-projects the whole relation per page; a primary-key');
  console.log('   keyset walk only scans what is left.\n');
  for (let attempt = 0; attempt < 2; attempt++) {
    await walk(`offset walk (run ${attempt})`,
      page => `select=${FULL}&order=${LEGACY_SORT}&limit=1000&offset=${page * 1000}`);
    await walk(`keyset walk (run ${attempt})`,
      (page, lastRow) => `select=${FULL}&order=id.asc&limit=1000`
        + (lastRow ? `&id=gt.${encodeURIComponent(String(lastRow.id))}` : ''));
  }
}

async function delta() {
  console.log('\n== F95 refresh predicate ==');
  console.log('   What one foreground tick costs once a watermark is held.\n');
  const since = value => new Date(Date.now() - value).toISOString();
  await shape('delta, 15 minute window', `select=${FULL}&updated_at=gte.${encodeURIComponent(since(15 * 60 * 1000))}&order=id.asc&limit=1000`);
  await shape('delta, 24 hour window', `select=${FULL}&updated_at=gte.${encodeURIComponent(since(24 * 60 * 60 * 1000))}&order=id.asc&limit=1000`);
  await shape('watermark read', 'select=id,updated_at&order=updated_at.desc&limit=1');
}

async function burst() {
  console.log('\n== burst reproduction (the shipped 4-wide offset pager) ==');
  console.log('   CAREFUL: this is the failure, not a benchmark.\n');
  const first = await get(`select=${FULL}&order=${LEGACY_SORT}&limit=1000&offset=0`);
  const started = Date.now();
  const rest = await Promise.all([1, 2, 3, 4].map(page =>
    get(`select=${FULL}&order=${LEGACY_SORT}&limit=1000&offset=${page * 1000}`)));
  console.log(`  page 0 alone: ${first.status} in ${first.upstream}ms`);
  console.log(`  pages 1-4 in parallel: ${rest.map(result => `${result.status}${result.code ? '/' + result.code : ''}@${result.upstream}ms`).join(' ')}`);
  console.log(`  parallel wall: ${Date.now() - started}ms`);
  const timedOut = rest.filter(result => result.code === '57014' || result.status >= 500).length;
  console.log(`  statement-timeout/5xx responses in this burst: ${timedOut}/4`);
}

(async () => {
  const mode = process.argv[2] || 'single';
  console.log(`prod_read_path_timing — ${VIEW} — reps=${REPS} — READ-ONLY`);
  if (mode === 'single' || mode === 'all') await single();
  if (mode === 'pagination' || mode === 'all') await pagination();
  if (mode === 'delta' || mode === 'all') await delta();
  if (mode === 'burst') await burst();
  if (!['single', 'pagination', 'delta', 'burst', 'all'].includes(mode)) {
    console.error(`unknown mode "${mode}" — use single | pagination | delta | burst | all`);
    process.exit(2);
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
