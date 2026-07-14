/*
 * truth-sync.js — keeps docs/truth/ honest (sibling of repo-map-sync.js).
 *
 * The living-truth docs are only useful if they can't silently rot, so this
 * suite fails when:
 *   1. a docs/truth/*.md is missing its exact date + commit freshness stamp,
 *   2. the endpoint inventory in docs/truth/ENDPOINTS.md drifts from what
 *      index.html actually calls (n8n `webhook/...` + `functions/v1/...`),
 *   3. a truth doc references a repo path that no longer exists,
 *   4. a truth doc references a `symbol()` that no longer exists in
 *      index.html, scripts/, or supabase/functions/.
 *   5. BRIEFING advertises a different finding boundary from the cutover register,
 *   6. an open P0/P1 cutover finding appears in none of the operative control docs.
 *
 * Change an endpoint or rename a symbol → update docs/truth/ in the same change.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

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

// 1. Exact, recent date + resolvable ancestor-commit freshness stamp in every doc.
const maxFreshnessDays = 30;
for (const d of docs) {
  const stamp = d.text.match(/Last verified: (\d{4}-\d{2}-\d{2}) @ ([0-9a-f]{7,40})\b/);
  ok(!!stamp,
    `${d.name} has an exact date + commit freshness stamp`);
  if (stamp) {
    const commit = spawnSync('git', ['cat-file', '-e', `${stamp[2]}^{commit}`], { cwd: ROOT });
    ok(commit.status === 0, `${d.name} freshness commit resolves`);
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', stamp[2], 'HEAD'], { cwd: ROOT });
    ok(ancestor.status === 0, `${d.name} freshness commit is an ancestor of HEAD`);
    const verifiedAt = Date.parse(`${stamp[1]}T00:00:00Z`);
    const ageDays = (Date.now() - verifiedAt) / 86400000;
    ok(Number.isFinite(ageDays) && ageDays >= -1 && ageDays <= maxFreshnessDays,
      `${d.name} freshness date is within ${maxFreshnessDays} days`);
  }
}

// 2. Endpoint inventory in ENDPOINTS.md matches index.html exactly (set equality).
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const endpointsDoc = docs.find(d => d.name.endsWith('ENDPOINTS.md'));
ok(!!endpointsDoc, 'docs/truth/ENDPOINTS.md exists');
if (endpointsDoc) {
  const webhookPattern = /webhook\/[a-zA-Z0-9_-]+/g;
  const functionPattern = /functions\/v1\/[a-zA-Z0-9_-]+/g;
  const literalFunctionCalls = new Set(INDEX.match(functionPattern) || []);
  const stringConstants = new Map([...INDEX.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g)]
    .map(match => [match[1], match[2]]));
  const composedFunctionCalls = new Set();
  for (const match of INDEX.matchAll(/\bconst\s+[A-Z][A-Z0-9_]*\s*=\s*([A-Z][A-Z0-9_]*)\s*\+\s*['"]\/([a-zA-Z0-9_-]+)['"]/g)) {
    const base = stringConstants.get(match[1]) || '';
    if (/\/functions\/v1\/?$/.test(base)) composedFunctionCalls.add(`functions/v1/${match[2]}`);
  }
  for (const kind of [webhookPattern, functionPattern]) {
    const inCode = new Set(INDEX.match(kind) || []);
    if (kind === functionPattern) for (const endpoint of composedFunctionCalls) inCode.add(endpoint);
    const inDoc = new Set(endpointsDoc.text.match(kind) || []);
    for (const e of inCode) ok(inDoc.has(e), `ENDPOINTS.md lists \`${e}\` (called by index.html)`);
    for (const e of inDoc) ok(inCode.has(e), `ENDPOINTS.md \`${e}\` is still called by index.html`);
  }
  const systemMap = fs.readFileSync(path.join(ROOT, 'docs', 'independence', 'SYSTEM_MAP.md'), 'utf8');
  ok(systemMap.includes(`"${literalFunctionCalls.size} literal + ${composedFunctionCalls.size} composed" Edge Functions`),
    'SYSTEM_MAP literal/composed Edge Function count matches index.html');
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

// 5. The read-first briefing must advertise the latest numbered finding in the register.
const auditPath = path.join(ROOT, 'docs', 'independence', 'CUTOVER_AUDIT_2026-07-13.md');
const briefing = docs.find(d => d.name.endsWith('BRIEFING.md'));
ok(fs.existsSync(auditPath), 'cutover audit register exists');
if (briefing && fs.existsSync(auditPath)) {
  const audit = fs.readFileSync(auditPath, 'utf8');
  const findingNumbers = [...audit.matchAll(/^\|\s*F(\d+)\s*\|/gm)].map(m => Number(m[1]));
  const briefingBoundary = briefing.text.match(/\bthrough F(\d+)\b/);
  ok(findingNumbers.length > 0, 'cutover audit register contains numbered findings');
  ok(!!briefingBoundary, 'BRIEFING declares its reconciled finding boundary');
  if (findingNumbers.length && briefingBoundary) {
    ok(Number(briefingBoundary[1]) === Math.max(...findingNumbers),
      'BRIEFING finding boundary equals the cutover register maximum');
  }

  // 6. Every non-closed P0/P1 finding must be present in at least one operator control surface.
  const controlPaths = [
    'docs/independence/GO_LIVE_CHECKLIST.md',
    'docs/independence/B4_READINESS.md',
    'docs/ops/MONITORING.md',
    'ROLLBACK.md',
  ];
  const controls = controlPaths.map(p => fs.readFileSync(path.join(ROOT, p), 'utf8')).join('\n');
  const openCritical = audit.split(/\r?\n/).map(line => {
    if (!/^\|\s*F\d+\s*\|/.test(line)) return null;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (!/^P[01]\b/.test(cells[1] || '')) return null;
    const status = cells[cells.length - 1] || '';
    if (/^(DONE|CLOSED)\b/.test(status) && !/\bOPEN\b/.test(status)) return null;
    return cells[0];
  }).filter(Boolean);
  ok(openCritical.length > 0, 'cutover register contains open P0/P1 findings');
  for (const id of openCritical) {
    ok(new RegExp(`\\b${id}\\b`).test(controls), `${id} appears in an operative control doc`);
  }
}

// 7. Current feature contracts must not regress into completed rollout instructions.
const reconciledFeatureDocs = [
  'docs/features/YOUTUBE_TITLE_REVIEW_DESIGN.md',
  'docs/features/KASPER_REVIEW_GLOBAL_ROLLOUT.md',
  'docs/features/THUMBNAIL_CACHE_ROLLOUT.md',
  'docs/features/SALES_INTAKE_DESIGN.md',
];
const staleFeatureMarkers = [
  /PR\s+#652[^\n]*\bis open\b/i,
  /Phase 0 backend[^\n]*\bPENDING\b/i,
  /Part B[^\n]*\bnot started\b/i,
  /^## Rollout steps\b/im,
  /until the backend below is in place/i,
  /open the \*\*`Build Row From Patch`\*\*/i,
  /claude\/sales-intake-form-tab/i,
  /https?:\/\/app\.notion\.com\/p\//i,
];
for (const rel of reconciledFeatureDocs) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  ok(/Current status \(verified 2026-07-14\)/.test(text), `${rel} declares its reconciled current status`);
  ok(!staleFeatureMarkers.some(pattern => pattern.test(text)), `${rel} has no executable stale-rollout marker`);
}
ok(!/later reply re-surfaces it/i.test(INDEX),
  'Kasper source comments match explicit-reroute-only finished behavior');

const reconciledMigrationRecords = [
  'migrations/kasper-review-state-migration.sql',
  'migrations/calendar-thumb-rev-migration.sql',
  'migrations/title-review-migration.sql',
  'migrations/sales-intake-migration.sql',
];
for (const rel of reconciledMigrationRecords) {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  ok(/CURRENT STATUS: deployed historical idempotent definition/.test(text),
    `${rel} is labelled as deployed historical schema`);
  ok(!/Run in the Supabase SQL editor|ROLLOUT ORDER \(important\)|There is no auto-runner — apply this manually/i.test(text),
    `${rel} contains no current manual-rollout instruction`);
}

console.log(`\ntruth-sync: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
