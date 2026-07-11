/*
 * truth-sync.js — keeps docs/truth/ honest (sibling of repo-map-sync.js).
 *
 * The living-truth docs are only useful if they can't silently rot, so this
 * suite fails when:
 *   1. a docs/truth/*.md is missing its `Last verified:` freshness stamp,
 *   2. the endpoint inventory in docs/truth/ENDPOINTS.md drifts from what
 *      index.html actually calls (n8n `webhook/...` + `functions/v1/...`),
 *   3. a truth doc references a repo path that no longer exists,
 *   4. a truth doc references a `symbol()` that no longer exists in
 *      index.html, scripts/, or supabase/functions/.
 *
 * Change an endpoint or rename a symbol → update docs/truth/ in the same change.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TRUTH_DIR = path.join(ROOT, 'docs', 'truth');
let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('OK  ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}

const docs = fs.readdirSync(TRUTH_DIR).filter(f => f.endsWith('.md'))
  .map(f => ({ name: 'docs/truth/' + f, text: fs.readFileSync(path.join(TRUTH_DIR, f), 'utf8') }));
ok(docs.length > 0, 'docs/truth/ contains truth docs');

// 1. Freshness stamp in every doc.
for (const d of docs) {
  ok(/Last verified: \d{4}-\d{2}-\d{2}/.test(d.text), `${d.name} has a freshness stamp`);
}

// 2. Endpoint inventory in ENDPOINTS.md matches index.html exactly (set equality).
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const endpointsDoc = docs.find(d => d.name.endsWith('ENDPOINTS.md'));
ok(!!endpointsDoc, 'docs/truth/ENDPOINTS.md exists');
if (endpointsDoc) {
  for (const kind of [/webhook\/[a-zA-Z0-9_-]+/g, /functions\/v1\/[a-zA-Z0-9_-]+/g]) {
    const inCode = new Set(INDEX.match(kind) || []);
    const inDoc = new Set(endpointsDoc.text.match(kind) || []);
    for (const e of inCode) ok(inDoc.has(e), `ENDPOINTS.md lists \`${e}\` (called by index.html)`);
    for (const e of inDoc) ok(inCode.has(e), `ENDPOINTS.md \`${e}\` is still called by index.html`);
  }
}

// 3. Backticked path-like tokens must exist (same heuristic as repo-map-sync).
const checkedPaths = new Set();
for (const d of docs) {
  for (const m of d.text.matchAll(/`([^`\n]+)`/g)) {
    const raw = m[1];
    if (/[\s*?<>{}()]/.test(raw) || raw.startsWith('-') || raw.startsWith('/')) continue;
    if (/^(webhook|functions|rest)\//.test(raw)) continue;
    if (!raw.includes('/')) continue;
    const token = raw.replace(/\/$/, '');
    const key = d.name + ':' + token;
    if (checkedPaths.has(key)) continue;
    checkedPaths.add(key);
    ok(fs.existsSync(path.join(ROOT, token)), `${d.name} path \`${raw}\` exists`);
  }
}

// 4. Backticked `symbol()` tokens must exist in the code corpus.
function collectCorpus() {
  let corpus = INDEX;
  for (const dir of ['scripts', path.join('supabase', 'functions')]) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs, { recursive: true })) {
      const p = path.join(abs, String(f));
      if (fs.statSync(p).isFile() && /\.(js|ts)$/.test(String(f))) corpus += fs.readFileSync(p, 'utf8');
    }
  }
  return corpus;
}
const symbols = new Set();
for (const d of docs) {
  for (const m of d.text.matchAll(/`([A-Za-z_$][A-Za-z0-9_$]*)\(\)`/g)) symbols.add(m[1]);
}
if (symbols.size) {
  const corpus = collectCorpus();
  for (const s of symbols) ok(corpus.includes(s), `truth-doc symbol \`${s}()\` exists in code`);
}

console.log(`\ntruth-sync: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
