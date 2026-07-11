/*
 * system-map-sync.js — keeps docs/independence/SYSTEM_MAP.md honest.
 *
 * The map's freshness contract says its endpoint inventory must be mechanically
 * re-derivable from index.html. This suite does exactly that and fails when:
 *   1. index.html references an n8n webhook / edge function / REST table /
 *      runtime-flag key that the map's "Endpoint inventory" section doesn't list,
 *   2. the map lists one that index.html no longer references,
 *   3. the counts printed in the inventory labels drift from the lists,
 *   4. a dynamic REST call site (`.../rest/v1/' + <var>`) appears or disappears
 *      without the map's "dynamic" bullet naming that variable.
 *
 * Surface gains/loses a backend → update SYSTEM_MAP.md in the same change
 * (both the owning surface's section and the inventory in the appendix).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MAP_PATH = 'docs/independence/SYSTEM_MAP.md';
const MAP = fs.readFileSync(path.join(ROOT, MAP_PATH), 'utf8');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('OK  ' + msg); }
  else { fail++; console.log('FAIL ' + msg); }
}
function extract(re, src, group) {
  const out = new Set();
  let m;
  while ((m = re.exec(src)) !== null) out.add(m[group == null ? 1 : group]);
  return out;
}

/* ── 1. Derive the live inventory from index.html ────────────────────── */

// n8n webhook paths (any mention counts — the contract is mechanical).
const htmlN8n = extract(/\bwebhook\/([a-z0-9-]+)/g, HTML);

// Edge functions: literal `functions/v1/<name>` …
const htmlEf = extract(/functions\/v1\/([a-z0-9-]+)/g, HTML);
// … plus names composed onto a `<CONST> = '…/functions/v1'` base
// (e.g. ONBOARDING_EDGE_BASE + '/onboarding-list').
for (const base of extract(/const\s+(\w+)\s*=\s*'[^']*\/functions\/v1'/g, HTML)) {
  const composed = extract(new RegExp(base + "\\s*\\+\\s*'\\/([a-z0-9-]+)'", 'g'), HTML);
  for (const name of composed) htmlEf.add(name);
}

// Supabase REST tables referenced literally.
const htmlRest = extract(/rest\/v1\/([A-Za-z_]+)/g, HTML);

// Dynamic REST call sites: `…/rest/v1/' + <variable>` — record the variable name.
const htmlRestDynamicVars = extract(/\/rest\/v1\/'\s*\+\s*([A-Za-z_$][\w$]*)/g, HTML);

// Runtime kill-switch flag keys (`const *_FLAG_KEY = '<key>'`).
const htmlFlags = extract(/const\s+\w*FLAG_KEY\s*=\s*'([a-z_]+)'/g, HTML);

/* ── 2. Parse the map's "Endpoint inventory" section ─────────────────── */

const invHeading = MAP.match(/^##[^\n]*Endpoint inventory[^\n]*$/m);
ok(!!invHeading, `${MAP_PATH} has an "Endpoint inventory" section (## heading)`);

// Grab a labelled bullet's full block (bullet line + wrapped continuation lines),
// then pull the backticked tokens out of it.
function bulletBlock(label) {
  const re = new RegExp('^- \\*\\*' + label + '[^*]*\\*\\*:?([^\\n]*(?:\\n(?!- \\*\\*|#)[^\\n]*)*)', 'm');
  const m = MAP.match(re);
  return m ? m[0] : null;
}
function bulletTokens(label) {
  const block = bulletBlock(label);
  if (block == null) return null;
  return extract(/`([A-Za-z0-9_$-]+)`/g, block);
}
function bulletCount(label) {
  const block = bulletBlock(label);
  if (block == null) return null;
  const m = block.match(/\((\d+)\)/);
  return m ? Number(m[1]) : null;
}

/* ── 3. Compare, both directions, with actionable messages ───────────── */

function compareSets(name, label, live, doc) {
  if (doc == null) {
    ok(false, `${MAP_PATH} inventory has a "${label}" bullet`);
    return;
  }
  const missing = [...live].filter(x => !doc.has(x)).sort();
  const stale = [...doc].filter(x => !live.has(x)).sort();
  ok(missing.length === 0,
    `every ${name} in index.html is listed in the map` +
    (missing.length ? ` — MISSING from ${MAP_PATH}: ${missing.join(', ')} (add to the inventory AND to the owning surface's section)` : ''));
  ok(stale.length === 0,
    `every ${name} in the map still exists in index.html` +
    (stale.length ? ` — STALE in ${MAP_PATH}: ${stale.join(', ')} (retired from index.html? remove it from the inventory and note the retirement on the owning surface)` : ''));
  const count = bulletCount(label);
  if (count != null) {
    ok(count === live.size,
      `"${label}" count (${count}) matches index.html (${live.size})`);
  }
}

compareSets('n8n webhook', 'n8n webhooks', htmlN8n, bulletTokens('n8n webhooks'));
compareSets('edge function', 'Edge functions', htmlEf, bulletTokens('Edge functions'));
compareSets('literal REST table', 'Supabase REST tables, literal', htmlRest, bulletTokens('Supabase REST tables, literal'));
compareSets('runtime flag key', 'Runtime kill-switch flags', htmlFlags, bulletTokens('Runtime kill-switch flags'));

// Dynamic REST call sites: the map's "dynamic" bullet must name each variable
// that index.html splices onto '/rest/v1/' — so a new dynamic read can't ship
// undocumented.
{
  const block = bulletBlock('Supabase REST tables, dynamic');
  ok(block != null, `${MAP_PATH} inventory has a "Supabase REST tables, dynamic" bullet`);
  if (block != null) {
    for (const v of htmlRestDynamicVars) {
      ok(new RegExp('\\b' + v + '\\b').test(block),
        `dynamic REST call-site variable \`${v}\` is named in the dynamic bullet` +
        (new RegExp('\\b' + v + '\\b').test(block) ? '' : ` — index.html builds a URL from \`'/rest/v1/' + ${v}\`; document what tables it reaches`));
    }
  }
}

console.log(`\nsystem-map-sync: ${pass} passed, ${fail} failed`);
if (fail) {
  console.log('\nThe system map and index.html have drifted. Fix by updating');
  console.log(MAP_PATH + ' (the Endpoint inventory section AND the owning');
  console.log('surface\'s entry) in the same change that touched index.html.');
  process.exit(1);
}
