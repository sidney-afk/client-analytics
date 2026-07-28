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
assert(CODE_TEXT.native_link_required.text.includes(
  'This team now writes natively, but this cached card has no native deliverable link. Reload before trying again.',
));
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

console.log('\nwrite UI failure message checks passed');
