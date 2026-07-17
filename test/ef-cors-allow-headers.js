'use strict';
/*
 * Regression guard for the browser-preflight CORS class of failures.
 *
 * Three shipped bugs share one mechanism: an Edge Function's static
 * `Access-Control-Allow-Headers` list omitted a header the browser actually
 * sends, so the preflight was rejected and the request never left the browser
 * — while CLI/Node tests (no CORS) stayed green. Incidents: client-review-link
 * omitted x-syncview-actor/x-syncview-role (share buttons, 2026-07-15, #838
 * follow-up); thumbnail-revision-read omitted a comparison header (#832); and
 * thumbnail-folder-resolve omitted x-syncview-key after `_syncviewEfHeaders`
 * started attaching the staff key to every functions/v1 call (2026-07-14
 * hardening) — the EF's allowlist predated the helper's behavior.
 *
 * This test derives, from index.html itself, which Edge Functions the browser
 * calls through `_syncviewEfHeaders` and which literal X-Syncview-* headers
 * each call site adds, then asserts every such function's allowlist covers
 * the staff identity triple plus those literals. The six Track-A writers are
 * additionally pinned to allow x-syncview-source and x-syncview-client-token:
 * client review links save through them (the F35 surface).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ' + msg); } else { fail++; console.error('FAIL  ' + msg); } };

// ---- map EF URL constants in index.html to function slugs ----
const constToSlug = {};
for (const m of SRC.matchAll(/const\s+([A-Z0-9_]+)\s*=\s*(?:CAL_SUPABASE_URL\s*\+\s*)?'(?:https:\/\/[a-z0-9]+\.supabase\.co)?\/functions\/v1\/([a-z0-9-]+)'/g)) {
  constToSlug[m[1]] = m[2];
}
ok(Object.keys(constToSlug).length >= 15, 'EF URL constant map discovered (' + Object.keys(constToSlug).length + ' constants)');

// ---- staff headers _syncviewEfHeaders attaches for any signed-in staff call ----
const STAFF_TRIPLE = ['x-syncview-key', 'x-syncview-actor', 'x-syncview-role'];

// ---- direct call sites: _syncviewEfHeaders({ ...literals... }, CONST) ----
const required = new Map(); // slug -> Set of required lowercase headers
const need = (slug, headers) => {
  if (!required.has(slug)) required.set(slug, new Set(['content-type', ...STAFF_TRIPLE]));
  headers.forEach(h => required.get(slug).add(h));
};
for (const m of SRC.matchAll(/_syncviewEfHeaders\(([\s\S]{0,500}?),\s*([A-Z0-9_]+)\s*\)/g)) {
  const slug = constToSlug[m[2]];
  if (!slug) continue;
  const literals = Array.from(m[1].matchAll(/['"](X-Syncview-[A-Za-z-]+)['"]/g), x => x[1].toLowerCase());
  need(slug, literals);
}

// ---- wrapper helpers that delegate to _syncviewEfHeaders with extra literals ----
const grabFunc = (name) => {
  const at = SRC.indexOf('function ' + name + '('); if (at < 0) return '';
  let depth = 0; for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  } return '';
};
for (const def of SRC.matchAll(/function\s+(_[A-Za-z0-9_]*Headers)\s*\(/g)) {
  const name = def[1];
  if (name === '_syncviewEfHeaders') continue;
  const body = grabFunc(name);
  if (!body.includes('_syncviewEfHeaders(')) continue;
  const literals = Array.from(body.matchAll(/['"](X-Syncview-[A-Za-z-]+)['"]/g), x => x[1].toLowerCase());
  for (const call of SRC.matchAll(new RegExp(name.replace(/[$_]/g, '\\$&') + '\\(([^)]{0,200})\\)', 'g'))) {
    for (const arg of call[1].matchAll(/\b([A-Z0-9_]+)\b/g)) {
      const slug = constToSlug[arg[1]];
      if (slug) need(slug, literals);
    }
  }
}

// The Track-A writers route through variable URLs (EF vs n8n), so static
// call-site discovery cannot always bind them; pin them explicitly. Client
// links write through these (X-Syncview-Client-Token) and every wrapper adds
// X-Syncview-Source.
for (const slug of ['calendar-upsert', 'calendar-reorder', 'sample-review-upsert',
  'sample-review-reorder', 'templates-save', 'caption-prompts-save']) {
  need(slug, ['x-syncview-source', 'x-syncview-client-token']);
}

// ---- anti-rot: the discovery must keep finding the surfaces that broke ----
for (const mustFind of ['thumbnail-folder-resolve', 'production-write', 'production-comments', 'pto', 'client-review-link']) {
  ok(required.has(mustFind), 'call-site discovery still finds ' + mustFind);
}

// ---- read each EF's Access-Control-Allow-Headers (string or array form) ----
function allowedHeaders(slug) {
  const file = path.join(ROOT, 'supabase', 'functions', slug, 'index.ts');
  if (!fs.existsSync(file)) return null;
  const ts = fs.readFileSync(file, 'utf8');
  const at = ts.indexOf('"Access-Control-Allow-Headers"');
  if (at < 0) return null;
  const tail = ts.slice(at, at + 800);
  const str = tail.match(/"Access-Control-Allow-Headers"\s*:\s*"([^"]+)"/);
  if (str) return new Set(str[1].split(',').map(s => s.trim().toLowerCase()));
  const arr = tail.match(/"Access-Control-Allow-Headers"\s*:\s*\[([\s\S]*?)\]/);
  if (arr) return new Set(Array.from(arr[1].matchAll(/"([^"]+)"/g), x => x[1].trim().toLowerCase()));
  return null;
}

for (const [slug, headers] of [...required.entries()].sort()) {
  const allowed = allowedHeaders(slug);
  ok(!!allowed, slug + ': allowlist found in EF source');
  if (!allowed) continue;
  const missing = [...headers].filter(h => !allowed.has(h));
  ok(missing.length === 0, slug + ': allowlist covers browser-sent headers'
    + (missing.length ? ' (MISSING: ' + missing.join(', ') + ')' : ''));
}

console.log(fail === 0
  ? 'EF CORS allow-header checks passed (' + pass + ')'
  : 'EF CORS allow-header checks FAILED (' + fail + ' of ' + (pass + fail) + ')');
process.exit(fail === 0 ? 0 : 1);
