'use strict';
/*
 * QUERY-SHAPE SWEEP — every (relation, column) the code queries, validated
 * against the live schema, plus every server-side ORDER on a text-typed
 * column.
 *
 * Born 2026-08-27 from two same-day incidents the pre-video-flip bug
 * archaeology generalized:
 *   - `raw_issue_parent_id` selected from a table that never had it (42703):
 *     killed the B1 import lane loudly AND silently disabled the gateway's
 *     freest-editor correction — one wrong column, two failure modes.
 *   - `order=order_index.asc` on a TEXT column: lexicographic, "1000" < "999",
 *     so the Samples nightly reported a working reorder as broken for weeks.
 * Its first estate-wide run: 69 relations, 953 columns, ZERO missing columns
 * beyond the two already fixed, one real text-order defect (the archive
 * comment thread, fixed the same day in test/archive-comment-thread-order.js).
 *
 * READ-ONLY. Run before any flip or edge-function deploy:
 *   SUPABASE_ACCESS_TOKEN=... node scripts/query-shape-sweep.js        # live schema
 *   node scripts/query-shape-sweep.js --schema=path/to/schema.json     # offline
 * The live mode issues ONE information_schema SELECT through the Management
 * API. Static-shape scanner only: dynamic table names and template-built
 * queries are out of scope, and text-order rows are CANDIDATES for judgement
 * (slug/name sorts are legitimately lexicographic), not findings.
 * PUBLIC SAFETY: output is relation/column/type + repo file:line — no data.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

async function loadSchema() {
  const arg = process.argv.find(a => a.startsWith('--schema='));
  if (arg) return JSON.parse(fs.readFileSync(arg.slice('--schema='.length), 'utf8'));
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  const ref = String(process.env.PROJECT_REF || 'uzltbbrjidmjwwfakwve').trim();
  if (!token) {
    console.error('query-shape-sweep: set SUPABASE_ACCESS_TOKEN or pass --schema=<file>');
    process.exit(2);
  }
  const resp = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: "select table_name, column_name, data_type from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
    }),
  });
  if (!resp.ok) { console.error('query-shape-sweep: schema read HTTP ' + resp.status); process.exit(2); }
  return resp.json();
}

const cols = new Map(); // relation -> Map(col -> type), filled in main

const findings = [];       // {file, line, relation, column, kind}
const orders = [];         // {file, line, relation, column, type}
const unknownRel = [];
const IDENT = /^[a-z_][a-z0-9_]*$/;
const RESERVED = new Set(['select','order','limit','offset','or','and','apikey','on_conflict','columns','not']);

function lineOf(src, idx) { return src.slice(0, idx).split('\n').length; }

function checkCol(file, line, relation, column, kind) {
  if (!IDENT.test(column)) return;
  const rel = cols.get(relation);
  if (!rel) { return; } // unknown relation handled separately
  if (!rel.has(column)) findings.push({ file, line, relation, column, kind });
}

function noteOrder(file, line, relation, column) {
  const rel = cols.get(relation); if (!rel || !rel.has(column)) return;
  orders.push({ file, line, relation, column, type: rel.get(column) });
}

function parseSelectList(list) {
  // top-level commas only; strip alias:, ::cast; skip *, embedded(), count
  const out = []; let depth = 0, cur = '';
  for (const ch of list) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(s => s && s !== '*' && !s.includes('(') && !s.includes('$'))
    .map(s => s.includes(':') ? s.split(':').pop() : s)
    .map(s => s.split('::')[0].trim())
    .filter(s => s !== 'count');
}

function parseRestQuery(file, src, idx, relation, query) {
  const line = lineOf(src, idx);
  if (!cols.has(relation)) { unknownRel.push({ file, line, relation }); return; }
  for (const kvRaw of query.split('&')) {
    const kv = kvRaw.trim(); if (!kv) continue;
    const eq = kv.indexOf('='); if (eq < 0) continue;
    const key = kv.slice(0, eq), val = kv.slice(eq + 1);
    if (key.includes('$') || key.includes('{')) continue;
    if (key === 'select') { for (const c of parseSelectList(decodeURIComponent(val))) checkCol(file, line, relation, c, 'select'); }
    else if (key === 'order') {
      for (const part of val.split(',')) {
        const c = part.split('.')[0].trim();
        if (IDENT.test(c)) { checkCol(file, line, relation, c, 'order'); noteOrder(file, line, relation, c); }
      }
    } else if (key === 'or' || key === 'and') {
      // or=(col.eq.x,col2.is.null)
      for (const m of val.matchAll(/[( ,]([a-z_][a-z0-9_]*)\.(?:eq|neq|gt|gte|lt|lte|is|in|like|ilike|not)/g)) {
        checkCol(file, line, relation, m[1], 'or-filter');
      }
    } else if (!RESERVED.has(key)) { checkCol(file, line, relation, key, 'filter'); }
  }
}

// ---- source scanners --------------------------------------------------------
function scanRestUrls(file, src) {
  // /rest/v1/<table>?<query>  inside quotes or template literals (static prefix)
  for (const m of src.matchAll(/\/rest\/v1\/([a-z_][a-z0-9_]*)\?([^"'`\n\\]*)/g)) {
    parseRestQuery(file, src, m.index, m[1], m[2]);
  }
}

function scanSupabaseRows(file, src) {
  for (const m of src.matchAll(/supabaseRows\(\s*'([a-z_][a-z0-9_]*)'\s*,\s*'([^']*)'/g)) {
    const line = lineOf(src, m.index);
    if (!cols.has(m[1])) { unknownRel.push({ file, line, relation: m[1] }); continue; }
    for (const c of parseSelectList(m[2])) checkCol(file, line, m[1], c, 'select');
  }
}

function scanRestHelper(file, src) {
  // rest('table?select=...') and rest(`table?select=...${x}`)
  for (const m of src.matchAll(/rest\(\s*[`']([a-z_][a-z0-9_]*)\?([^`'\n]*)[`']/g)) {
    parseRestQuery(file, src, m.index, m[1], m[2].split('${')[0]);
  }
  // supa('client=eq...') — engine helper is sample_reviews-bound; skip (covered by its own suite)
}

function scanSupabaseChains(file, src) {
  // .from("table") ... chained builder calls until the chain plausibly ends
  const re = /\.from\(\s*["']([a-z_][a-z0-9_]*)["']\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const relation = m[1];
    const line = lineOf(src, m.index);
    if (!cols.has(relation)) { unknownRel.push({ file, line, relation }); continue; }
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 900);
    // A chain ends at its statement's semicolon or at the next .from( —
    // whichever comes first. Without the ';' cut, a following statement's
    // filters bleed onto this relation (the sweep's own first false positive).
    const stops = [tail.search(/\.from\(/), tail.indexOf(';')].filter(i => i >= 0);
    const seg = stops.length ? tail.slice(0, Math.min(...stops) + 1) : tail;
    const sel = seg.match(/\.select\(\s*["']([^"']*)["']/);
    if (sel) for (const c of parseSelectList(sel[1])) checkCol(file, line, relation, c, 'select');
    for (const f of seg.matchAll(/\.(eq|neq|gt|gte|lt|lte|is|in|like|ilike|contains)\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
      checkCol(file, line, relation, f[2], 'filter');
    }
    for (const f of seg.matchAll(/\.not\(\s*["']([a-z_][a-z0-9_]*)["']/g)) checkCol(file, line, relation, f[1], 'filter');
    for (const f of seg.matchAll(/\.order\(\s*["']([a-z_][a-z0-9_]*)["']/g)) {
      checkCol(file, line, relation, f[1], 'order'); noteOrder(file, line, relation, f[1]);
    }
    for (const u of seg.matchAll(/\.(update|insert|upsert)\(/g)) { /* write columns are object keys — skip, covered by migrations discipline */ }
  }
}

// ---- walk -------------------------------------------------------------------
const targets = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(js|ts|mjs)$/.test(e.name)) targets.push(p);
  }
}

async function main() {
  for (const r of await loadSchema()) {
    if (!cols.has(r.table_name)) cols.set(r.table_name, new Map());
    cols.get(r.table_name).set(r.column_name, r.data_type);
  }
  walk(path.join(ROOT, 'scripts'));
  walk(path.join(ROOT, 'supabase'));
  walk(path.join(ROOT, 'qa'));
  targets.push(path.join(ROOT, 'index.html'));

  for (const file of targets) {
    if (path.resolve(file) === __filename) continue; // the sweep's own docstring is not a query
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    scanRestUrls(rel, src);
    scanSupabaseRows(rel, src);
    scanRestHelper(rel, src);
    if (/\.(ts|mjs)$/.test(file) || file.includes('functions')) scanSupabaseChains(rel, src);
  }
  report();
}

// ---- report -----------------------------------------------------------------
function report() {
const seen = new Set();
console.log('=== MISSING COLUMNS (queried but absent from live schema) ===');
for (const f of findings) {
  const k = `${f.relation}.${f.column}`;
  if (seen.has(k + f.file + f.line)) continue; seen.add(k + f.file + f.line);
  console.log(`  ${f.relation}.${f.column}  [${f.kind}]  ${f.file}:${f.line}`);
}
if (!findings.length) console.log('  (none)');
console.log('\n=== UNKNOWN RELATIONS ===');
const ur = new Set();
for (const u of unknownRel) { const k = u.relation + u.file; if (ur.has(k)) continue; ur.add(k); console.log(`  ${u.relation}  ${u.file}:${u.line}`); }
if (!unknownRel.length) console.log('  (none)');
console.log('\n=== TEXT-TYPED ORDER COLUMNS (lexicographic sort risk) ===');
const os = new Set();
for (const o of orders) {
  if (!/text|character/.test(o.type)) continue;
  const k = `${o.relation}.${o.column}|${o.file}:${o.line}`; if (os.has(k)) continue; os.add(k);
  console.log(`  ${o.relation}.${o.column} (${o.type})  ${o.file}:${o.line}`);
}
  if (findings.length || unknownRel.length) process.exit(1);
}

main().catch(e => { console.error('query-shape-sweep failed: ' + (e && e.message || e)); process.exit(2); });
