'use strict';
/*
 * THE GATEWAY REUSES A VERDICT IT ALREADY HOLDS FOR THE SAME URL.
 *
 * OWNER, 2026-09-05: "do we really need to refresh access every single time?
 * ... some Delta thing so it just looks if one of them has changed ... 99% of
 * the time the asset links are not gonna change ... it's weird to always have
 * to wait for the asset to load."
 *
 * Every asset_access_read used to probe every slot live: up to
 * ASSET_PROBE_TIMEOUT_MS per URL, redirects included, four in parallel. The
 * ledger those probes write (production_asset_access_checks) already records
 * the verdict per (deliverable, slot, url_sha256) with its checked_at, and the
 * approval gate already trusts a row of it for ASSET_EVIDENCE_MAX_AGE_MS. So
 * the read now asks the ledger first, by slot and url hash across EVERY
 * deliverable -- a post's parent and sub-issues all name the same two folders
 * -- and probes only when nothing fresh is held, or when the Refresh access
 * button says `recheck: true`.
 *
 * What is NOT changed: the local checks that depend on the clock or the slot
 * run before any reuse; the approval gate still probes live on its own; and the
 * ledger row for the reading deliverable is still written, with the ORIGINAL
 * checked_at, so a reused verdict cannot outlive the window by being copied.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const GATEWAY = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
const UI = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  let at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  // Keep the `async` that precedes it, or the lifted body cannot await.
  if (source.slice(at - 6, at) === 'async ') at -= 6;
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}
/* The TypeScript-only annotations in the two lifted functions. Anything this
   list misses makes `new Function` throw, which is the right failure: it means
   the shipped source is no longer what runs here. */
const stripTs = src => src
  .replace(/supabase: SupabaseClient,/g, 'supabase,')
  .replace(/slot: string,/g, 'slot,')
  .replace(/value: unknown,/g, 'value,')
  .replace(/held\?: JsonMap \| null,/g, 'held,')
  .replace(/\): Promise<JsonMap \| null> \{/g, ') {')
  .replace(/\): Promise<JsonMap> \{/g, ') {')
  .replace(/ as JsonMap/g, '');

const clean = v => String(v == null ? '' : v).trim();
const sha256Hex = async v => crypto.createHash('sha256').update(v).digest('hex');
const MAX_AGE = 5 * 60 * 1000;
const URL = 'https://www.dropbox.com/scl/fo/footage/AAA?rlkey=k1';

/* ---- 1. Wiring, read from source --------------------------------------- */

const snapshot = grabFunc(GATEWAY, 'assetSnapshot');
ok(/async function assetSnapshot\(\s*supabase: SupabaseClient,\s*deliverable: JsonMap,\s*recheck = false,\s*\)/.test(GATEWAY),
  'assetSnapshot takes a plain recheck flag, default off -- a plain parameter rather than an options object, because three sibling suites lift this function by brace-matching from its name and an inline type literal would be the first brace they met');
ok(/const held = recheck \? null : await heldAssetEvidence\(supabase, slot\.key, values\[slot\.key\]\);\s*\n\s*const evidence = await probeAssetUrl\(slot\.key, values\[slot\.key\], held\);\s*\n\s*await recordAssetEvidence\(/.test(snapshot),
  'per slot: ask the ledger, then probe with what it held, then record for THIS deliverable -- in that order');
const readHandler = grabFunc(GATEWAY, 'handleAssetAccessRead');
ok(/assetSnapshot\(supabase, existing, body\.recheck === true\)/.test(readHandler),
  'the read handler passes only a literal `recheck: true` through');
const approval = grabFunc(GATEWAY, 'assertGraphicsApprovalArtifact');
ok(/probeAssetUrl\("deliverable_file", candidate\.url\)/.test(approval) && !/heldAssetEvidence/.test(approval),
  'the approval gate still probes LIVE -- it never reuses, because it is the moment resolvability is asserted');
ok(/_prodEnsureAssets\(id, true, \{ recheck: true \}\)/.test(grabFunc(UI, '_prodRefreshAssetsManual'))
  && /\.\.\.\(recheck \? \{ recheck: true \} : \{\}\)/.test(grabFunc(UI, '_prodEnsureAssets')),
  'and the browser sends it only from the Refresh access button');
const migrationPath = path.join(ROOT, 'migrations/2026-09-05-asset-evidence-by-url.sql');
ok(fs.existsSync(migrationPath)
  && /\(slot, url_sha256, checked_at desc\)/.test(fs.readFileSync(migrationPath, 'utf8')),
  'the optional index for the new lookup shape is written down as a migration');

/* ---- 2. Executed: heldAssetEvidence ------------------------------------- */

const heldSrc = stripTs(grabFunc(GATEWAY, 'heldAssetEvidence'));
const reusableMatch = GATEWAY.match(/const REUSABLE_ASSET_STATES = new Set\((\[[^\]]+\])\);/);
ok(!!reusableMatch, 'REUSABLE_ASSET_STATES is a literal set in source');
const REUSABLE_ASSET_STATES = new Set(JSON.parse(reusableMatch[1]));
ok(['available', 'permission_denied', 'expired', 'unavailable'].every(s => REUSABLE_ASSET_STATES.has(s))
  && !REUSABLE_ASSET_STATES.has('missing') && !REUSABLE_ASSET_STATES.has('invalid') && !REUSABLE_ASSET_STATES.has('checking'),
  'the four network verdicts are reusable; missing, invalid and checking are not');

function fakeLedger(answer) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { table, eq: {}, order: null, limit: null };
      const chain = {
        select() { return chain; },
        eq(col, val) { q.eq[col] = val; return chain; },
        order(col, opts) { q.order = [col, opts]; return chain; },
        limit(n) { q.limit = n; return chain; },
        then(resolve) { calls.push(q); return resolve(typeof answer === 'function' ? answer(q) : answer); },
      };
      return chain;
    },
  };
}
const runHeld = new Function('clean', 'sha256Hex', 'REUSABLE_ASSET_STATES', 'ASSET_EVIDENCE_MAX_AGE_MS',
  heldSrc + '\nreturn heldAssetEvidence;')(clean, sha256Hex, REUSABLE_ASSET_STATES, MAX_AGE);

const fresh = new Date(Date.now() - 60 * 1000).toISOString();
const stale = new Date(Date.now() - MAX_AGE - 1000).toISOString();
const future = new Date(Date.now() + 120 * 1000).toISOString();
const row = over => Object.assign({ state: 'available', http_status: 200, result_code: 'asset_available', checked_at: fresh, checker: 'production-write' }, over);

(async () => {
  const hash = await sha256Hex(URL);
  let ledger = fakeLedger(q => ({ data: [row({ url_sha256: q.eq.url_sha256 })], error: null }));
  let held = await runHeld(ledger, 'raw_footage', URL);
  ok(held && held.state === 'available' && held.checked_at === fresh, 'a fresh `available` verdict for the same URL is reused');
  const q = ledger.calls[0];
  ok(q.table === 'production_asset_access_checks' && q.eq.slot === 'raw_footage' && q.eq.url_sha256 === hash
    && q.eq.checker === 'production-write' && q.order[0] === 'checked_at' && q.order[1].ascending === false && q.limit === 1
    && !('deliverable_id' in q.eq),
    'looked up by slot + sha256(url) + checker, newest first, one row -- and NOT by deliverable, so a sibling\'s probe counts');

  ledger = fakeLedger({ data: [row({ url_sha256: hash, checked_at: stale })], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'a verdict older than ASSET_EVIDENCE_MAX_AGE_MS is not reused');
  ledger = fakeLedger({ data: [row({ url_sha256: hash, checked_at: future })], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'nor one stamped in the future');
  ledger = fakeLedger({ data: [row({ url_sha256: hash, state: 'unavailable', http_status: null, result_code: 'asset_unavailable_timeout' })], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'an `unavailable` WITHOUT a status is a probe that threw -- transient, so it is asked again');
  ledger = fakeLedger({ data: [row({ url_sha256: hash, state: 'unavailable', http_status: 200, result_code: 'asset_unavailable' })], error: null });
  held = await runHeld(ledger, 'raw_footage', URL);
  ok(held && held.state === 'unavailable', 'an `unavailable` WITH a status completed and is a real verdict, reused like the others');
  ledger = fakeLedger({ data: [row({ url_sha256: hash, state: 'permission_denied', http_status: 403 })], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)).state === 'permission_denied', 'a fresh permission_denied is reused -- the folder did not become shared in the last four minutes by itself');
  ledger = fakeLedger({ data: [row({ url_sha256: 'someone-elses-hash' })], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'a row whose hash does not match the URL is refused even if the filter let it through');
  ledger = fakeLedger({ data: null, error: new Error('ledger down') });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'a ledger error fails OPEN to a live probe -- one round trip, never a wrong answer');
  ledger = fakeLedger({ data: [], error: null });
  ok((await runHeld(ledger, 'raw_footage', URL)) === null, 'and so does an empty ledger');
  ledger = fakeLedger({ data: [row()], error: null });
  ok((await runHeld(ledger, 'raw_footage', '')) === null && ledger.calls.length === 0, 'an empty value asks nothing -- `missing` is decided before the network');

  /* ---- 3. Executed: probeAssetUrl with a held verdict ------------------- */

  const probeSrc = stripTs(grabFunc(GATEWAY, 'probeAssetUrl'));
  let fetched = 0;
  const deps = {
    clean,
    assetUrlType: () => 'folder',
    assetTypeAllowed: () => true,
    signedAssetExpired: () => false,
    signedLinearUpload: () => true,
    assetGuidance: s => 'guidance:' + s,
    providerEvidenceState: () => 'available',
    assetProbeFailure: () => 'network_error',
    boundedAssetFetch: async () => { fetched++; return { response: { status: 200 }, sample: '' }; },
  };
  const makeProbe = d => new Function(...Object.keys(d), probeSrc + '\nreturn probeAssetUrl;')(...Object.values(d));
  let probe = makeProbe(deps);
  let out = await probe('raw_footage', URL, row({ checked_at: fresh, http_status: 200 }));
  ok(out.state === 'available' && out.reused === true && out.checked_at === fresh && out.http_status === 200 && fetched === 0,
    'with a held verdict the provider is not fetched; the answer carries the ORIGINAL checked_at and status');
  out = await probe('raw_footage', URL, row({ state: 'unavailable', http_status: 502, result_code: 'asset_unavailable', checked_at: fresh }));
  ok(out.state === 'unavailable' && out.guidance === 'guidance:unavailable' && fetched === 0 && !('failure' in out),
    'a held non-available verdict carries its guidance, and no failure word when the recorded probe did not throw');
  out = await probe('raw_footage', URL, null);
  ok(out.state === 'available' && !('reused' in out) && fetched === 1, 'with nothing held the provider IS fetched, exactly as before');
  probe = makeProbe(Object.assign({}, deps, { assetUrlType: () => 'invalid' }));
  out = await probe('raw_footage', URL, row());
  ok(out.state === 'invalid' && !('reused' in out), 'the local shape check runs BEFORE any reuse -- a held verdict cannot launder an invalid URL');
  probe = makeProbe(Object.assign({}, deps, { signedAssetExpired: () => true }));
  out = await probe('deliverable_file', URL, row());
  ok(out.state === 'expired' && !('reused' in out), 'and so does the clock check -- a signed URL that expired since the recorded probe says so now');
  probe = makeProbe(Object.assign({}, deps, { assetTypeAllowed: () => false }));
  out = await probe('filming_plan', URL, row());
  ok(out.state === 'invalid', 'and the slot check -- the same URL held as a valid folder elsewhere is still invalid where a document is required');

  /* ---- 4. The ledger write keeps the original clock --------------------- */

  const record = grabFunc(GATEWAY, 'recordAssetEvidence');
  ok(/checked_at: checkedAt,/.test(record) && /const checkedAt = clean\(evidence\.checked_at\);/.test(record),
    'recordAssetEvidence writes the evidence\'s own checked_at, so a reused verdict is recorded under the probe\'s clock, not the copy\'s -- it cannot outlive the window by being re-read');

  console.log(failures === 0
    ? '\nasset evidence reuse: all checks passed'
    : '\n' + failures + ' asset evidence reuse check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
})();
