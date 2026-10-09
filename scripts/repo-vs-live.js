#!/usr/bin/env node
'use strict';

/**
 * Repo vs live: what the repository says should be running, next to what is
 * running. Read only. It never deploys, applies, flips or edits anything.
 *
 * Three kinds of things are compared:
 *   - Edge Functions. Every function in supabase/functions at the chosen
 *     commit, against the live function list. With a Management token the
 *     bytes are compared by scripts/ef-fingerprint.js (the same attestor the
 *     deploy lanes use); without one, the last commit that touched a
 *     function's files is compared with the live deploy time ("repo newer").
 *   - Database changes and switches listed in scripts/repo-vs-live-shelf.json,
 *     each with one SELECT that answers yes/no or a count.
 *   - GitHub lanes listed there (latest run of a workflow).
 *
 * Usage:
 *   node scripts/repo-vs-live.js                      # live, needs SUPABASE_ACCESS_TOKEN
 *   node scripts/repo-vs-live.js --live-json=FILE     # offline, from facts gathered elsewhere
 *   node scripts/repo-vs-live.js --format=markdown|json|text --sha=<40-char sha> --strict
 *
 * Environment (live mode only, same names as scripts/ef-fingerprint.js):
 *   SUPABASE_ACCESS_TOKEN  Management API token (edge_functions:read, database read)
 *   PROJECT_REF            optional, else supabase/config.toml
 *   GITHUB_TOKEN           optional, for the lane reads (the repo is public)
 *
 * The SQL probes go to the Management API's query endpoint with read_only set,
 * and this script refuses any probe that is not one plain SELECT. Probe answers
 * are printed only when they are a yes/no or a number, so a probe can never
 * print a client name, an email or a key. Nothing secret is ever printed: the
 * token is only sent as a header, and an API error is reported by status code.
 *
 * Exit code: 0, or 1 with --strict when something is waiting that is not held.
 *
 * Not yet proven: the live mode was written without a token (2026-10-09, OPEN_REPAIRS 389) and has
 * not run against the real API. A probe it cannot read prints UNKNOWN, never LIVE.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHELF = path.join(__dirname, 'repo-vs-live-shelf.json');
const FUNCTIONS_PREFIX = 'supabase/functions/';
const SOURCE_EXTENSIONS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const INDEX_CANDIDATES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs'];
const API_ORIGIN = 'https://api.supabase.com';
const GITHUB_REPO = 'sidney-afk/client-analytics';
const FORBIDDEN_SQL = /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|set|reset|perform|vacuum|analyze|lock|refresh|notify|listen|comment|security|pg_read_file|pg_ls_dir|lo_import|dblink|pg_sleep)\b/i;

function fail(message) {
  console.error(`repo-vs-live: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const options = { format: 'text', sha: '', liveJson: '', strict: false, shelf: SHELF };
  for (const arg of argv) {
    if (arg === '--strict') options.strict = true;
    else if (arg.startsWith('--format=')) options.format = arg.slice(9);
    else if (arg.startsWith('--sha=')) options.sha = arg.slice(6).trim().toLowerCase();
    else if (arg.startsWith('--live-json=')) options.liveJson = arg.slice(12);
    else if (arg.startsWith('--shelf=')) options.shelf = arg.slice(8);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/repo-vs-live.js [--live-json=FILE] [--format=text|markdown|json] [--sha=<sha>] [--strict]');
      process.exit(0);
    } else fail(`unknown argument ${arg}`);
  }
  if (!['text', 'markdown', 'json'].includes(options.format)) fail('format must be text, markdown or json');
  return options;
}

// ---------- the repo side ----------

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed`);
  return r.stdout;
}

function resolveSha(sha) {
  const wanted = sha || 'HEAD';
  const out = git(['rev-parse', '--verify', `${wanted}^{commit}`]).toString('utf8').trim();
  if (!/^[0-9a-f]{40}$/.test(out)) throw new Error('could not resolve the commit');
  return out;
}

function localSpecifiers(source) {
  const specs = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const specifier = match[1].split(/[?#]/, 1)[0];
      if (specifier.startsWith('./') || specifier.startsWith('../')) specs.add(specifier);
    }
  }
  return [...specs];
}

// The files a function is built from: its entrypoint and every local import,
// the same walk scripts/ef-fingerprint.js does. readFile(path) -> string.
function closureFiles(slug, inventory, readFile) {
  const entry = INDEX_CANDIDATES.map(name => `${FUNCTIONS_PREFIX}${slug}/${name}`).find(f => inventory.has(f));
  if (!entry) return null;
  const pending = [entry];
  const seen = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of localSpecifiers(readFile(file))) {
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
      const candidates = [...SOURCE_EXTENSIONS.map(e => base + e), ...INDEX_CANDIDATES.map(i => `${base}/${i}`)];
      const hit = candidates.find(c => inventory.has(c));
      if (hit && !seen.has(hit)) pending.push(hit);
    }
  }
  return [...seen].sort();
}

function repoFunctions(sha) {
  const files = git(['ls-tree', '-r', '--name-only', sha, '--', FUNCTIONS_PREFIX]).toString('utf8').split('\n').filter(Boolean);
  const inventory = new Set(files);
  const slugs = [...new Set(files
    .filter(f => /\/index\.(?:ts|tsx|js|mjs)$/.test(f))
    .map(f => f.slice(FUNCTIONS_PREFIX.length).split('/')[0])
    .filter(s => s && s !== '_shared'))].sort();
  const cache = new Map();
  const readFile = f => {
    if (!cache.has(f)) cache.set(f, git(['show', `${sha}:${f}`]).toString('utf8'));
    return cache.get(f);
  };
  const out = [];
  for (const slug of slugs) {
    const closure = closureFiles(slug, inventory, readFile);
    if (!closure) continue;
    const last = git(['log', '-1', '--format=%H %cI', sha, '--', ...closure]).toString('utf8').trim().split(' ');
    out.push({ slug, files: closure.length, last_commit: last[0] || '', last_changed_at: last[1] || '' });
  }
  return out;
}

// ---------- the live side ----------

function assertReadOnlyProbe(sql) {
  const text = String(sql || '').trim();
  if (!/^(select|with)\b/i.test(text)) throw new Error('a probe must start with SELECT or WITH');
  // Words inside quotes are data (a privilege name such as 'EXECUTE'), not commands.
  const bare = text.replace(/'(?:[^']|'')*'/g, "''");
  if (bare.includes(';')) throw new Error('a probe must be one statement');
  if (/--|\/\*/.test(bare)) throw new Error('a probe may not carry comments');
  if (FORBIDDEN_SQL.test(bare)) throw new Error('a probe may only read');
  return text;
}

async function managementJson(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    await response.arrayBuffer().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function liveFromApi(shelf, sha) {
  const token = String(process.env.SUPABASE_ACCESS_TOKEN || '').trim();
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set (or pass --live-json=FILE)');
  let projectRef = String(process.env.PROJECT_REF || '').trim();
  if (!projectRef) {
    const config = git(['show', `${sha}:supabase/config.toml`]).toString('utf8');
    const m = /^project_id\s*=\s*["']([a-z0-9]{20})["']/m.exec(config);
    projectRef = m ? m[1] : '';
  }
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('PROJECT_REF must be a 20-character project ref');

  const list = await managementJson(`${API_ORIGIN}/v1/projects/${projectRef}/functions`, token);
  const functions = (Array.isArray(list) ? list : []).map(f => ({
    slug: String(f.slug || ''), version: f.version ?? null, updated_at: f.updated_at ?? null, status: String(f.status || ''),
  }));

  // Byte comparison through the deploy lanes' own attestor, report only.
  let fingerprints = null;
  const fp = spawnSync(process.execPath, [path.join(__dirname, 'ef-fingerprint.js'), sha, '--format=json', '--report-only'],
    { cwd: ROOT, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  if (fp.status === 0) {
    try {
      fingerprints = {};
      for (const r of JSON.parse(fp.stdout).results || []) fingerprints[r.slug] = r.result;
    } catch (_e) { fingerprints = null; }
  }

  const probes = {};
  for (const probe of shelf.probes.filter(p => p.kind === 'database' || p.kind === 'switch')) {
    try {
      const query = `select * from (${assertReadOnlyProbe(probe.sql)}) as probe`;
      const rows = await managementJson(`${API_ORIGIN}/v1/projects/${projectRef}/database/query`, token,
        { method: 'POST', body: JSON.stringify({ query, read_only: true }) });
      const row = Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' ? rows[0] : {};
      probes[probe.id] = Object.values(row)[0];
    } catch (error) {
      probes[probe.id] = { error: String(error && error.message || error) };
    }
  }

  const lanes = {};
  for (const probe of shelf.probes.filter(p => p.kind === 'lane')) {
    try {
      const q = new URLSearchParams({ per_page: '1', status: 'completed', branch: 'main' });
      if (probe.event) q.set('event', probe.event);
      const headers = { Accept: 'application/vnd.github+json' };
      if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/${encodeURIComponent(probe.workflow)}/runs?${q}`,
        { headers, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const run = ((await response.json()).workflow_runs || [])[0];
      lanes[probe.id] = run ? { conclusion: run.conclusion, created_at: run.created_at, event: run.event } : null;
    } catch (error) {
      lanes[probe.id] = { error: String(error && error.message || error) };
    }
  }

  return { captured_at: new Date().toISOString(), source: 'management-api', functions, fingerprints, probes, lanes };
}

// ---------- the comparison (pure, tested offline) ----------

function shownValue(value) {
  if (value === null || value === undefined) return 'nothing';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value))) return String(Number(value));
  if (typeof value === 'string' && /^(true|false|t|f)$/i.test(value)) return /^t/i.test(value) ? 'yes' : 'no';
  if (value && typeof value === 'object' && typeof value.error === 'string') return `could not read (${value.error.replace(/[^\w .:-]/g, '').slice(0, 40)})`;
  return '(hidden: not a yes/no or a count)';
}

function normalize(value) {
  if (typeof value === 'string' && /^(true|t)$/i.test(value)) return true;
  if (typeof value === 'string' && /^(false|f)$/i.test(value)) return false;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return value;
}

function toMillis(value) {
  if (typeof value === 'number') return value;
  const t = Date.parse(String(value || ''));
  return Number.isNaN(t) ? null : t;
}

function compareFunctions(repo, live, shelf) {
  const liveBySlug = new Map((live.functions || []).map(f => [f.slug, f]));
  const notes = shelf.functions || {};
  const rows = [];
  for (const fn of repo) {
    const note = notes[fn.slug] || {};
    const L = liveBySlug.get(fn.slug);
    const byBytes = live.fingerprints ? live.fingerprints[fn.slug] : undefined;
    let live_state;
    let same;
    if (!L) { live_state = 'not deployed'; same = false; }
    else if (byBytes === 'PASS') { live_state = `v${L.version}, same bytes`; same = true; }
    else if (byBytes === 'FAIL' || byBytes === 'ERROR') { live_state = `v${L.version}, bytes differ`; same = false; }
    else {
      const liveAt = toMillis(L.updated_at);
      const repoAt = toMillis(fn.last_changed_at);
      if (liveAt === null || repoAt === null) { live_state = `v${L.version}, date unknown`; same = null; }
      else if (repoAt > liveAt) {
        const hours = (repoAt - liveAt) / 3_600_000;
        live_state = `v${L.version}, repo changed ${hours < 24 ? 'within a day' : Math.round(hours / 24) + ' days'} after the live deploy`;
        same = hours < 24 ? null : false;
      } else { live_state = `v${L.version}, deployed after the last repo change`; same = true; }
    }
    let verdict = same === true ? 'LIVE' : same === null ? 'CHECK BYTES' : 'WAITING';
    if (verdict !== 'LIVE' && note.hold) verdict = 'HELD';
    rows.push({
      kind: 'function', id: fn.slug, entries: note.entries || [], what: fn.slug,
      repo: `changed ${String(fn.last_changed_at).slice(0, 10)} (${String(fn.last_commit).slice(0, 8)})`,
      live: live_state, verdict, note: note.hold || note.lane || '',
    });
  }
  const repoSlugs = new Set(repo.map(f => f.slug));
  for (const L of live.functions || []) {
    if (repoSlugs.has(L.slug)) continue;
    const owner = (shelf.owned_elsewhere || {})[L.slug];
    rows.push({ kind: 'function', id: L.slug, entries: [], what: L.slug, repo: owner ? `lives in ${owner}` : 'not in this repo',
      live: `v${L.version}`, verdict: owner ? 'ELSEWHERE' : 'UNKNOWN', note: owner ? '' : 'live function with no source here' });
  }
  return rows;
}

function compareProbes(shelf, live) {
  const rows = [];
  for (const probe of shelf.probes) {
    let actual;
    let verdict;
    if (probe.kind === 'manual') {
      actual = 'not measured';
      verdict = 'NOT MEASURED';
    } else if (probe.kind === 'lane') {
      const run = (live.lanes || {})[probe.id];
      if (!run) { actual = 'no run'; verdict = 'WAITING'; }
      else if (run.error) { actual = shownValue(run); verdict = 'UNKNOWN'; }
      else {
        actual = `${run.conclusion} (${run.event}, ${String(run.created_at).slice(0, 16).replace('T', ' ')} UTC)`;
        verdict = run.conclusion === probe.expect ? 'LIVE' : 'WAITING';
      }
    } else {
      const value = (live.probes || {})[probe.id];
      actual = shownValue(value);
      if (value === undefined) verdict = 'UNKNOWN';
      else if (value && typeof value === 'object') verdict = 'UNKNOWN';
      else verdict = normalize(value) === probe.expect ? 'LIVE' : 'WAITING';
    }
    if ((verdict === 'WAITING' || verdict === 'NOT MEASURED') && probe.hold) verdict = 'HELD';
    rows.push({ kind: probe.kind, id: probe.id, entries: probe.entry ? [probe.entry] : [], what: probe.what,
      repo: probe.kind === 'manual' ? 'owner step' : probe.kind === 'lane' ? `expects ${probe.expect}` : `expects ${shownValue(probe.expect)}`,
      live: actual, verdict, note: probe.hold || probe.how || '' });
  }
  return rows;
}

function buildReport({ sha, repo, live, shelf }) {
  const rows = [...compareFunctions(repo, live, shelf), ...compareProbes(shelf, live)];
  const count = v => rows.filter(r => r.verdict === v).length;
  return {
    schema_version: 1,
    sha,
    live_captured_at: live.captured_at || null,
    live_source: live.source || null,
    byte_compared: Object.keys(live.fingerprints || {}).length,
    rows,
    summary: {
      live: count('LIVE'), waiting: count('WAITING'), held: count('HELD'), check_bytes: count('CHECK BYTES'),
      not_measured: count('NOT MEASURED'), unknown: count('UNKNOWN'), elsewhere: count('ELSEWHERE'),
    },
  };
}

const ORDER = ['WAITING', 'NOT MEASURED', 'CHECK BYTES', 'UNKNOWN', 'HELD', 'LIVE', 'ELSEWHERE'];

function sortedRows(report) {
  return [...report.rows].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

function summaryLine(report) {
  const s = report.summary;
  return `waiting ${s.waiting}, not measured ${s.not_measured}, check bytes ${s.check_bytes}, unknown ${s.unknown}, held ${s.held}, live ${s.live}, elsewhere ${s.elsewhere}`;
}

function render(report, format) {
  if (format === 'json') return JSON.stringify(report, null, 2);
  const head = `Repo vs live at ${report.sha.slice(0, 12)}; live read ${report.live_captured_at || 'unknown'} (${report.live_source || 'unknown'}); functions compared by bytes for ${report.byte_compared}, by dates for the rest`;
  const rows = sortedRows(report);
  if (format === 'markdown') {
    const cell = v => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [head, '', '| Verdict | Kind | Item | Ledger | Repo | Live | Note |', '|---|---|---|---|---|---|---|'];
    for (const r of rows) lines.push(`| ${[r.verdict, r.kind, r.what, r.entries.join(', '), r.repo, r.live, r.note].map(cell).join(' | ')} |`);
    lines.push('', `Summary: ${summaryLine(report)}`);
    return lines.join('\n');
  }
  const lines = [head, ''];
  for (const r of rows) {
    lines.push(`${r.verdict.padEnd(12)} ${r.kind.padEnd(8)} ${r.what}${r.entries.length ? ` [${r.entries.join(', ')}]` : ''}`);
    lines.push(`${' '.repeat(22)}repo: ${r.repo}; live: ${r.live}${r.note ? `; ${r.note}` : ''}`);
  }
  lines.push('', `Summary: ${summaryLine(report)}`);
  return lines.join('\n');
}

function loadShelf(file) {
  const shelf = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (shelf.format !== 'repo-vs-live-shelf-v1' || !Array.isArray(shelf.probes)) throw new Error('shelf file has the wrong format');
  const ids = new Set();
  for (const p of shelf.probes) {
    if (!/^[a-z0-9-]+$/.test(p.id || '') || ids.has(p.id)) throw new Error(`bad or repeated probe id ${p.id}`);
    ids.add(p.id);
    if (!['database', 'switch', 'lane', 'manual'].includes(p.kind)) throw new Error(`probe ${p.id} has an unknown kind`);
    if (p.kind === 'database' || p.kind === 'switch') assertReadOnlyProbe(p.sql);
    if (p.kind === 'lane' && !/^[\w.-]+\.ya?ml$/.test(p.workflow || '')) throw new Error(`probe ${p.id} needs a workflow file`);
  }
  return shelf;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const shelf = loadShelf(options.shelf);
  const sha = resolveSha(options.sha);
  const repo = repoFunctions(sha);
  const live = options.liveJson
    ? JSON.parse(fs.readFileSync(options.liveJson, 'utf8'))
    : await liveFromApi(shelf, sha);
  const report = buildReport({ sha, repo, live, shelf });
  console.log(render(report, options.format));
  if (options.strict && report.summary.waiting) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(error => fail(String(error && error.message || error)));
} else {
  module.exports = {
    assertReadOnlyProbe, buildReport, closureFiles, compareFunctions, compareProbes, loadShelf, localSpecifiers,
    render, shownValue, summaryLine,
  };
}
