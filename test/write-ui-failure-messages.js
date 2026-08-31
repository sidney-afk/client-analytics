'use strict';
/*
 * Every write refusal must reach the user as something they can ACT on.
 *
 * The defect this suite exists to prevent: _writeUiReportFailure mapped four
 * codes and swallowed every other one into "The native <op> could not be
 * committed. Try the action again." For the largest group of refusals — a
 * runtime flag, a permission decision, a malformed payload — retrying is the
 * one action that cannot possibly work, and the code the gateway had already
 * computed was discarded at the UI, so an SMM had nothing to report and
 * support had nothing to search for.
 *
 * The gates below are total, not sampled: every refusal code either side of
 * the wire can produce must resolve to guidance, and an unmapped code must
 * still reach the user by name. Add a new GatewayError code without mapping it
 * and this suite fails.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const gateway = fs.readFileSync(
  path.join(root, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8',
);

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) return source.slice(start, i + 1); }
  }
  throw new Error('unterminated function ' + name);
}

// The tables plus their resolver are one contiguous block ending where the
// reporter begins.
const tableStart = source.indexOf('const WRITE_UI_FAILURE_CLASS_TEXT');
const tableEnd = source.indexOf('function _writeUiReportFailure(');
assert(tableStart >= 0 && tableEnd > tableStart, 'failure message tables not found');
const tables = source.slice(tableStart, tableEnd);

const box = { out: null };
vm.createContext(box);
vm.runInContext(tables + ';out = {'
  + 'CLASS: WRITE_UI_FAILURE_CLASS_TEXT,'
  + 'CODE_CLASS: WRITE_UI_FAILURE_CODE_CLASS,'
  + 'CODE_TEXT: WRITE_UI_FAILURE_CODE_TEXT,'
  + 'resolve: _writeUiFailureText};', box);
const { CLASS, CODE_CLASS, CODE_TEXT, resolve } = box.out;

// ── 1. The tables are internally sound ──────────────────────────────────────
for (const [code, klass] of Object.entries(CODE_CLASS)) {
  assert(CLASS[klass], 'code ' + code + ' points at unknown class ' + klass);
}
for (const [klass, entry] of Object.entries(CLASS)) {
  assert(entry && entry.title && entry.text, 'class ' + klass + ' has no text');
}
for (const [code, entry] of Object.entries(CODE_TEXT)) {
  assert(entry && entry.title && entry.text, 'code text ' + code + ' is incomplete');
}
console.log('  ok  every mapped code resolves to real guidance');

// ── 2. The four messages the notification already carried are unchanged ─────
/* native_link_required CHANGED on 2026-08-31 (sweep item 87.14) and is now
   asserted by property, not by literal. The retired text ended "Reload before
   trying again", which was false: makePayload throws this from the row's own
   state, nothing on this path reads a cache, and no client-side code backfills
   a deliverable id from a url -- so a reload re-reads the same server row and
   refuses identically. The code's own comment had said "forever after" for
   months. Measured live: 111 non-archived cards carry a Linear video link with
   no deliverable id (36 still in flight) and 149 the graphics equivalent.
   What is pinned is that it states the problem and does NOT prescribe a reload.
   It also names no remedy on purpose -- there is no in-app one post-flip, so
   the honest remedy is an escalation and which one is the owner's call. */
assert(!/Reload before trying again/.test(CODE_TEXT.native_link_required.text),
  'native_link_required no longer prescribes a reload that cannot work');
assert(/no SyncView work item behind it/.test(CODE_TEXT.native_link_required.text),
  '...and says what is actually wrong with the card');
assert(/Reloading will not change that/.test(CODE_TEXT.native_link_required.text),
  '...and contradicts the reload reading outright, because that is what readers had been told for months');
assert(CODE_TEXT.authority_unavailable.text.includes(
  'Team authority could not be verified. Reload and try again; no Linear write was attempted.',
));
assert(CODE_TEXT.repair_storage_unavailable.text.includes(
  'This browser cannot checkpoint recovery data. Free browser storage, then try again.',
));
assert(CODE_TEXT.client_credentials_required.text.includes(
  'This client link needs a current review token. Ask your SMM for a fresh link, then try again.',
));
console.log('  ok  the four pre-existing messages survived the refactor word for word');

// ── 3. Total coverage of every code either side of the wire can throw ───────
const mapped = new Set(Object.keys(CODE_CLASS).concat(Object.keys(CODE_TEXT)));

const browserCodes = new Set(
  [...source.matchAll(/_writeUiGatewayError\(\s*\d+\s*,\s*'([a-z0-9_]+)'/g)].map(m => m[1]),
);
assert(browserCodes.size > 30, 'browser refusal codes not found — did the helper get renamed?');
const browserGap = [...browserCodes].filter(code => !mapped.has(code)).sort();
assert.deepStrictEqual(browserGap, [],
  'browser refusal codes with no user guidance: ' + browserGap.join(', '));

const serverCodes = new Set(
  [...gateway.matchAll(/new GatewayError\(\s*\d+\s*,\s*"([a-z0-9_]+)"/g)].map(m => m[1]),
);
for (const m of gateway.matchAll(/error:\s*"([a-z0-9_]+)"/g)) serverCodes.add(m[1]);
assert(serverCodes.size > 100, 'gateway refusal codes not found — did GatewayError get renamed?');
const serverGap = [...serverCodes].filter(code => !mapped.has(code)).sort();
assert.deepStrictEqual(serverGap, [],
  'gateway refusal codes with no user guidance: ' + serverGap.join(', '));
console.log('  ok  all ' + browserCodes.size + ' browser and ' + serverCodes.size
  + ' gateway refusal codes carry guidance');

// ── 4. A deterministic refusal never advises a retry ────────────────────────
// legacy_parity_disabled is the live example: prod_authority is linear/linear
// and linear_legacy_parity_enabled is {"enabled": false}, so every canonical
// comment lifecycle write is refused identically on every attempt.
for (const code of ['legacy_parity_disabled', 'legacy_parity_not_allowed',
  'team_is_linear_authoritative', 'operation_forbidden', 'comment_forbidden',
  'invalid_comment_action', 'invalid_surface_operation']) {
  const text = resolve('comment', code, 409).text;
  assert(!/try (the action )?again/i.test(text),
    code + ' still tells the user to retry a refusal that cannot succeed');
  assert(/will not|not help|not change|every retry|refuse/i.test(text),
    code + ' does not tell the user that retrying is pointless');
}
console.log('  ok  deterministic refusals say so instead of "try again"');

// ── 5. An UNMAPPED code is named, never flattened ───────────────────────────
const unknown = resolve('comment', 'a_code_invented_in_2027', 409);
assert(/does not recognise/.test(unknown.text), 'unknown code is not reported as unknown');
assert(/send this code to the owner/i.test(unknown.text), 'unknown code has no reporting advice');
const unknownTransient = resolve('comment', 'a_code_invented_in_2027', 503);
assert(/Try once more/.test(unknownTransient.text),
  'an unknown 5xx should still be worth one retry');
assert(!source.includes('could not be committed. Try the action again.'),
  'the generic swallow-everything message is back');
console.log('  ok  an unmapped code reaches the user by name');

// ── 6. The reporter always prints the code, and always records it ───────────
const reporter = extract('_writeUiReportFailure');
assert(reporter.includes("' (code: ' + code + ')'"), 'the notification drops the code again');
assert(reporter.indexOf('_writeUiQueueDiagnostic') < reporter.indexOf('_writeUiFailureNoticeAt[key]'),
  'the diagnostic row must be written BEFORE the 30s notice throttle can return');

const seen = [];
const notices = [];
const ctx = {
  _writeUiFailureNoticeAt: Object.create(null),
  _isClientLink: false,
  console: { warn() {} },
  Date,
  _writeUiQueueDiagnostic: (surface, outcome, item, error) =>
    seen.push([surface, outcome, item.kind, String(error && error.code || '')]),
  showNotify: (title, body) => notices.push([title, body]),
};
vm.createContext(ctx);
vm.runInContext(tables + reporter, ctx);

ctx._writeUiReportFailure('calendar', 'comment', { status: 409, code: 'legacy_parity_disabled' });
assert.strictEqual(notices.length, 1);
assert.strictEqual(notices[0][0], 'Write refused');
assert(notices[0][1].endsWith('(code: legacy_parity_disabled)'), notices[0][1]);
assert(!/try (the action )?again/i.test(notices[0][1]), notices[0][1]);
assert.deepStrictEqual(seen, [['calendar', 'ui_write_failure', 'comment', 'legacy_parity_disabled']]);

// Throttled repeat: no second notice, but the attempt is still recorded, so
// peekWriteUiQueueDiagnostics() sees every attempt rather than the first.
ctx._writeUiReportFailure('calendar', 'comment', { status: 409, code: 'legacy_parity_disabled' });
assert.strictEqual(notices.length, 1, 'the 30s throttle stopped working');
assert.strictEqual(seen.length, 2, 'a throttled failure left no diagnostic row');

// A raw transport error has no code — it is named by its message, not swallowed.
ctx._writeUiReportFailure('sxr', 'comment', new TypeError('Failed to fetch'));
assert(notices[1][1].endsWith('(code: Failed to fetch)'), notices[1][1]);

// A client-link 401 keeps the review-token wording; staff sessions without the
// identity opener get the sign-in instruction rather than a bare retry.
const clientCtx = Object.assign({}, ctx, {
  _isClientLink: true, _writeUiFailureNoticeAt: Object.create(null),
});
const clientNotices = [];
clientCtx.showNotify = (title, body) => clientNotices.push([title, body]);
vm.createContext(clientCtx);
vm.runInContext(tables + reporter, clientCtx);
clientCtx._writeUiReportFailure('sxr', 'comment', { status: 401, code: 'invalid_client_token' });
assert(clientNotices[0][1].includes('Ask your SMM for a fresh link'), clientNotices[0][1]);
assert(clientNotices[0][1].endsWith('(code: invalid_client_token)'), clientNotices[0][1]);
console.log('  ok  the reporter names the code, records it, and keeps the 401 routes');

// ── 7. The in-modal banner surfaces the code too ────────────────────────────
const banner = extract('_writeUiCommentActionFailureHtml');
const bannerCtx = { _calEsc: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;') };
vm.createContext(bannerCtx);
vm.runInContext(banner, bannerCtx);

const editFail = bannerCtx._writeUiCommentActionFailureHtml(
  { action: 'edit', rebased: false, message: 'legacy_parity_disabled' }, 'retry()',
);
assert(editFail.includes('Your draft was kept'), editFail);
assert(editFail.includes('(code: legacy_parity_disabled)'), editFail);
assert(editFail.includes('onclick="retry()"'), editFail);

// A CAS rebase substitutes its own explanation; the code would only be noise.
const rebased = bannerCtx._writeUiCommentActionFailureHtml(
  { action: 'edit', rebased: true, message: 'A newer version was loaded.' }, 'retry()',
);
assert(rebased.includes('A newer version was loaded. Your draft was preserved'), rebased);
assert(!rebased.includes('(code:'), rebased);

const resolveFail = bannerCtx._writeUiCommentActionFailureHtml(
  { action: 'resolve', rebased: false, message: 'write_conflict' }, 'retry()',
);
assert(resolveFail.includes('(code: write_conflict)'), resolveFail);
assert.strictEqual(bannerCtx._writeUiCommentActionFailureHtml(null, 'retry()'), '');

// Both surfaces render through the one helper, so they cannot drift apart.
const banners = source.split('const actionFailure = post._canonicalCommentActionError').length - 1;
assert.strictEqual(banners, 2, 'expected the calendar and samples banners');
assert.strictEqual(
  source.split('_writeUiCommentActionFailureHtml(').length - 1, 3,
  'both banners must call the shared helper',
);
console.log('  ok  the comment-action banner carries the code on both surfaces');

// -- 8. A dead file link is never answered with "reload the page" ------------
/*
 * OPEN_REPAIRS 14. Moving a graphics card to For SMM Approval makes the
 * gateway probe the card file link, and until 2026-08-16 the refusal
 * `artifact_not_resolvable` sat in the `reload` bucket. A designer whose link
 * was missing or unshared was told "This page is holding an out-of-date copy...
 * reload the page" -- advice that cannot work, and that loops them until they
 * give up.
 *
 * The class exists now. What was missing is anything stopping it from sliding
 * back: the code appears in a long list of other codes, one line from the
 * `reload` list, and nothing failed if it moved. The register asked for a
 * UI-level check; this is it, and it is executed against the real resolver
 * rather than read off the source.
 */
assert.strictEqual(CODE_CLASS.artifact_not_resolvable, 'artifact',
  'artifact_not_resolvable must not drift back into another bucket');
const artifactText = resolve('status', 'artifact_not_resolvable', 409);
assert(!/reload/i.test(artifactText.title + ' ' + artifactText.text),
  'the file-link refusal must never tell anyone to reload: ' + artifactText.text);
assert(/link/i.test(artifactText.text),
  'it must name the link, which is the thing to fix: ' + artifactText.text);
for (const klass of ['reload', 'repair']) {
  assert(/reload/i.test(CLASS[klass].text),
    'the ' + klass + ' class is the one that DOES advise a reload; this check is not vacuous');
}

/* The Production tab answers the same refusal through its own dialog, and that
   path must surface what the gateway already computed rather than a generic
   line. `expired` is the case that matters: Drive returns the same 404 for a
   deleted file and for one that exists but was never shared. */
const prodErr = extract('_prodWriteErrorText');
const assetText = extract('_prodAssetStateText');
const prodCtx = {
  _prodIdentityRepairGateText: () => '',
  _prodWriteGateText: () => '',
  String, Boolean, Object,
};
vm.createContext(prodCtx);
vm.runInContext(assetText + '\n' + prodErr
  + ';this.text = _prodWriteErrorText; this.assetState = _prodAssetStateText;', prodCtx);

const permission = prodCtx.text({ code: 'artifact_not_resolvable', assetState: 'permission_denied' }, {}, 'status');
assert(/Anyone with the link/.test(permission), permission);
assert(!/reload/i.test(permission), 'the Production dialog must not advise a reload either: ' + permission);
const expired = prodCtx.text({ code: 'artifact_not_resolvable', assetState: 'expired' }, {}, 'status');
assert(/deleted OR simply never shared/.test(expired),
  'the expired case must name both causes, cheapest check first: ' + expired);
const passthrough = prodCtx.text(
  { code: 'artifact_not_resolvable', assetState: 'missing', guidance: 'Add a thumbnail link to this card.' }, {}, 'status',
);
assert.strictEqual(passthrough, 'Add a thumbnail link to this card.',
  'a state the gateway already explains keeps the gateway wording');
const unknownState = prodCtx.text({ code: 'artifact_not_resolvable' }, {}, 'status');
assert(/could not be verified/.test(unknownState) && !/reload/i.test(unknownState), unknownState);
console.log('  ok  a dead file link points at the link, on both surfaces, never at a reload');

// -- 9. "Reload the page" only works if the reload reads server truth --------
/*
 * OPEN_REPAIRS 13. A card whose backing deliverable was deleted kept rendering
 * from the display cache, so every save was refused with entity_not_found and
 * the dialog said to reload -- but localStorage survives a hard refresh, the
 * stale card came straight back, and it presented as "saving is broken" rather
 * than as a missing row.
 *
 * Measured 2026-08-22: ZERO cards anywhere, TEST client included, now point at
 * a deliverable that does not exist, so the data cause is gone. The browser
 * path that turned it into a loop is not, and it costs one line to close: the
 * two refusals that mean "you named a row I do not have" drop the display
 * caches, so the reload the message asks for actually reaches the server.
 */
const evictCtx = Object.assign({}, ctx, { _writeUiFailureNoticeAt: Object.create(null) });
let evictions = 0;
const evictNotices = [];
evictCtx._writeUiRepairEvictDisplayCaches = () => { evictions++; };
evictCtx.showNotify = (title, body) => evictNotices.push([title, body]);
vm.createContext(evictCtx);
vm.runInContext(tables + reporter, evictCtx);

evictCtx._writeUiReportFailure('calendar', 'status', { status: 404, code: 'entity_not_found' });
assert.strictEqual(evictions, 1, 'a stale-row refusal must drop the display caches');
assert(/reload/i.test(evictNotices[0][1]), 'and still tell the person to reload: ' + evictNotices[0][1]);

evictCtx._writeUiReportFailure('sxr', 'status', { status: 404, code: 'batch_not_found' });
assert.strictEqual(evictions, 2, 'the batch form of the same refusal evicts too');

// The throttle must not suppress the eviction: the second person to click the
// same dead card within 30s needs the cache gone just as much as the first.
evictCtx._writeUiReportFailure('calendar', 'status', { status: 404, code: 'entity_not_found' });
assert.strictEqual(evictions, 3, 'eviction happens before the notice throttle, not after it');
assert.strictEqual(evictNotices.length, 2, 'the notice itself is still throttled');

// Everything else leaves the caches alone. A conflict, a permission answer or
// a transient failure are not evidence that the cache is stale, and evicting on
// them would turn every hiccup into a full refetch.
for (const code of ['write_conflict', 'operation_forbidden', 'service_unavailable', 'artifact_not_resolvable']) {
  const before = evictions;
  evictCtx._writeUiReportFailure('calendar', 'status', { status: 409, code });
  assert.strictEqual(evictions, before, code + ' must not evict the display caches');
}

// The call is guarded, so a context without the evictor still reports.
const bareCtx = Object.assign({}, ctx, { _writeUiFailureNoticeAt: Object.create(null) });
const bareNotices = [];
bareCtx.showNotify = (title, body) => bareNotices.push([title, body]);
delete bareCtx._writeUiRepairEvictDisplayCaches;
vm.createContext(bareCtx);
vm.runInContext(tables + reporter, bareCtx);
bareCtx._writeUiReportFailure('calendar', 'status', { status: 404, code: 'entity_not_found' });
assert.strictEqual(bareNotices.length, 1, 'the notice survives even where no evictor exists');
console.log('  ok  a stale-row refusal clears the cache the reload would otherwise re-read');

/* The eviction above is only safe because the shared evictor refuses to touch a
   cache holding an unacknowledged repair -- the one thing in there that is not
   re-fetchable. That guard predates this use and nothing pinned it, so a change
   to it would silently turn a stale-card recovery into data loss. Executed
   against the real function with a stand-in localStorage. */
const evictor = extract('_writeUiRepairEvictDisplayCaches');
const store = new Map([
  ['syncview_calCache_v2:clienta', '{"posts":[{"id":"p_1"}]}'],
  ['syncview_calCache_v2:clientb', '{"posts":[{"id":"p_2","_writeUiRetrySourceAt":"2026-08-22T00:00:00Z"}]}'],
  ['syncview_sxr_cache_v2_clientc', '{"posts":[{"id":"s_1"}]}'],
  ['syncview_sxr_cache_v2_clientd', '{"posts":[{"id":"s_2","_writeUiKasperRepair":true}]}'],
  ['syncview_staff_identity', 'not-a-display-cache'],
]);
const storeCtx = {
  localStorage: {
    get length() { return store.size; },
    key: index => [...store.keys()][index],
    getItem: k => (store.has(k) ? store.get(k) : null),
    removeItem: k => { store.delete(k); },
  },
  String,
};
vm.createContext(storeCtx);
vm.runInContext(evictor + ';this.evict = _writeUiRepairEvictDisplayCaches;', storeCtx);
storeCtx.evict();
assert(!store.has('syncview_calCache_v2:clienta'), 'a plain calendar cache is evicted');
assert(!store.has('syncview_sxr_cache_v2_clientc'), 'a plain samples cache is evicted');
assert(store.has('syncview_calCache_v2:clientb'),
  'a cache holding an unacknowledged source repair must SURVIVE eviction');
assert(store.has('syncview_sxr_cache_v2_clientd'),
  'a cache holding a Kasper repair must survive too');
assert(store.has('syncview_staff_identity'), 'unrelated keys are never touched');
console.log('  ok  eviction spares the caches holding work that cannot be re-fetched');

console.log('\nwrite UI failure message checks passed');
