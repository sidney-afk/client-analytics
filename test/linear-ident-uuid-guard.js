'use strict';
/*
 * F139 guard — UUID-form Linear links must never fabricate an ident.
 *
 * Run:  node test/linear-ident-uuid-guard.js   (exit 0 = all good)
 *
 * What it guards: Linear issue URLs come in two shapes — /issue/ABC-123/slug
 * and /issue/<uuid>. The old loose extraction (match ABC-123 anywhere in the
 * string) fabricated a garbage ident from INSIDE a UUID ("A-94" out of
 * ...be1a-94e6...), and one garbage id poisons the whole aliased GraphQL
 * batch the linear-issue-statuses webhook sends to Linear, which then falls
 * back to ~50 parallel per-id calls and can blow the 60s task-runner cap
 * (observed live 2026-07-17: reconcile failures + execution burn). This suite
 * pins the strict extraction; the batch-hygiene callers it used to check
 * (the card/sample reconcilers) are retired along with the webhook itself
 * (OPEN_REPAIRS 238) — see check 3 below for what remains reachable.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('  FAIL  ' + label); failures++; }
}

// ── extract the real _calIdentFromUrl from index.html (same trick the
//    reconcilers use, so the tested function IS the shipped function).
const grabFunc = (name) => {
  const at = SRC.indexOf('function ' + name + '('); if (at < 0) throw new Error('fn ' + name);
  let depth = 0; for (let j = SRC.indexOf('{', at); j < SRC.length; j++) {
    if (SRC[j] === '{') depth++; else if (SRC[j] === '}' && --depth === 0) return SRC.slice(at, j + 1);
  } throw new Error('braces ' + name);
};
const _calIdentFromUrl = new Function(grabFunc('_calIdentFromUrl') + '; return _calIdentFromUrl;')();

// 1. Ident extraction behavior.
check("standard URL → ident ('https://linear.app/x/issue/VID-12606/reel-6' → VID-12606)",
  _calIdentFromUrl('https://linear.app/synchro-social/issue/VID-12606/reel-6') === 'VID-12606');
check('URL with query/hash after the ident still resolves',
  _calIdentFromUrl('https://linear.app/x/issue/GRA-6578?comment=1') === 'GRA-6578');
check('bare ident passes through uppercased',
  _calIdentFromUrl('vid-12053') === 'VID-12053');
check('UUID-form URL yields NO ident (the F139 poison case)',
  _calIdentFromUrl('https://linear.app/synchro-social/issue/cecec0f3-4906-4f7e-be1a-94e607bc9db5') === '');
check('bare UUID yields NO ident',
  _calIdentFromUrl('cecec0f3-4906-4f7e-be1a-94e607bc9db5') === '');
check('empty/junk input yields NO ident',
  _calIdentFromUrl('') === '' && _calIdentFromUrl(null) === '' && _calIdentFromUrl('not a link') === '');

// 2. The two card/sample reconcilers that used to batch links through the
//    shared webhook are retired (OPEN_REPAIRS 238) along with the webhook
//    they called — see check 3 below for what remains reachable.

// 3. The browser status-import caller that this clause guarded was
//    _calReconcileLinearStatuses, removed on 2026-09-22 with the
//    linear-issue-statuses webhook (OPEN_REPAIRS 236). F139's poison case can
//    no longer be reached from the browser at all, which is stronger than
//    gating it — so the assertion is that the caller stays gone. The two
//    server-side reconcilers above still batch, and still carry the gate.
check('no browser-side status-import batch remains to poison',
  !/function\s+_calReconcileLinearStatuses\b/.test(SRC)
  && !SRC.includes("urls.push(p.linear_issue_id)"));
check('no loose anywhere-in-string ident regex remains in index.html',
  !/toUpperCase\(\)\.match\(\/\(\[A-Z\]\+-\\d\+\)\//.test(SRC));

console.log(failures ? `\nlinear-ident-uuid-guard: ${failures} FAILED ❌` : '\nlinear-ident-uuid-guard: all checks passed ✅');
process.exit(failures ? 1 : 0);
