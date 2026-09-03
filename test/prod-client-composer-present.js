'use strict';
/*
 * A CLIENT MUST HAVE A TEXT BOX. The 212-slot lockout, and the guard it never got.
 *
 * Run:  node test/prod-client-composer-present.js   (exit 0 = all good)
 *
 * OPEN_REPAIRS 107. `_prodCanonicalCommentGate` returned `linked: true` for a
 * client on a correctly-crosswalked calendar card, because the crosswalk really
 * did match. But `ready` needs a canonical thread read that a client's protected
 * reader can never authorize, so it stayed false — and `_calComposerHtml`
 * replaces the entire composer with "Notes could not load" whenever
 * `linked && !ready`. The client had no text box at all.
 *
 * The inversion is the reason it went unnoticed for so long: a BROKEN crosswalk
 * let the client comment, a CORRECT one locked them out. The better-configured
 * card was the unusable one.
 *
 * WHY THIS FILE EXISTS. The fix shipped on 2026-09-02 with no test. A 2026-09-03
 * audit deleted the eight-line guard from a scratch copy and re-ran all TEN
 * suites that mention `_prodCanonicalCommentGate`, `_calComposerHtml` or
 * `_prodVerifiedClientCommentSurfaceContext`: every one still exited 0. The
 * closest suite, test/production-canonical-gate-crosswalk.js, hardcodes
 * `_isClientLink: false` in its stub, so it exercises the staff path only and
 * could never have seen this. Nothing in the repo held the fix down.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}
function grabFunc(name) {
  let at = INDEX.indexOf('async function ' + name + '(');
  if (at < 0) at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* THE CASE THE EXISTING SUITES CANNOT BUILD, and the reason this one runs the
   real function instead of reading it.

   A CLIENT, on the calendar, on a card whose crosswalk is VALID and whose
   canonical read has landed clean. Every one of those is the good configuration
   — which is exactly what made the bug invisible: the better-configured card was
   the unusable one. `_prodVerifiedClientCommentSurfaceContext` answers only for
   the `sxr` surface, so on the calendar it returns null for every client, and
   before the fix the gate went on to report `linked: true` anyway. */
function runGate(opts) {
  const ctx = vm.createContext({ console });
  vm.runInContext(`
    const _isClientLink = ${opts.client ? 'true' : 'false'};
    function _writeUiNativeId() { return 'b1_d_deadbeef'; }
    function _prodCrosswalkVerdict() { return { state: ${JSON.stringify(opts.crosswalkState || 'valid')} }; }
    function _prodVerifiedClientCommentSurfaceContext() { return ${opts.surfaceVerified ? "{ surface: 'sxr', cardId: 'card-1', team: 'video' }" : 'null'}; }
    const POST = { _canonicalCommentReads: { 'b1_d_deadbeef': ${JSON.stringify(opts.readState || { status: 'ready' })} } };
  `, ctx);
  // The real key builder, not a stub: the verified-client branch below compares
  // two of its outputs, and a stub that returned a constant would make them
  // agree by construction and prove nothing.
  vm.runInContext(grabFunc('_prodClientCommentSurfaceKey') + `
  `, ctx);
  vm.runInContext(grabFunc('_prodCanonicalCommentGate'), ctx);
  return vm.runInContext(`_prodCanonicalCommentGate(POST, 'video')`, ctx);
}

const SOURCE = grabFunc('_prodCanonicalCommentGate');

/* ---- executed: the client keeps a text box on a GOOD card ---------------- */

const clientOnCalendar = runGate({ client: true, surfaceVerified: false });
ok(clientOnCalendar.linked === false,
'EXECUTED — a client on a valid, ready, correctly-crosswalked calendar card is reported NOT linked');
ok(clientOnCalendar.status === 'client_surface_unverifiable',
'EXECUTED — and the reason is recorded, not inferred');

/* `linked && !ready` is precisely what deletes the textarea, so this is the
   assertion that fails the moment the composer disappears again. */
ok(!(clientOnCalendar.linked && !clientOnCalendar.ready),
'EXECUTED — the composer-removing combination (linked && !ready) is unreachable for a client');

const staffSame = runGate({ client: false, surfaceVerified: false });
ok(staffSame.linked === true && staffSame.status !== 'client_surface_unverifiable',
'EXECUTED — staff on the same card still get the canonical thread; the guard did not widen');

const clientVerified = runGate({ client: true, surfaceVerified: true });
ok(clientVerified.linked === true,
'EXECUTED — a client on a surface that CAN be verified is still linked, so the fix is not a blanket opt-out');

/* ---- the property, stated as the client experiences it -------------------- */

ok(/if \(_isClientLink && !expectedClientSurface\)/.test(SOURCE),
'the gate refuses to claim a canonical link it cannot verify for a client');
ok(/client_surface_unverifiable/.test(SOURCE),
'and says why, with a status a reader can grep for');

/* The two halves that matter are `linked: false` — because `linked && !ready`
   is what removes the textarea — and the fact that this is decided BEFORE any
   readiness check, since a client can never make `ready` true. */
const guard = /if \(_isClientLink && !expectedClientSurface\)\s*\{([\s\S]{0,400}?)\}/.exec(SOURCE);
ok(!!guard && /linked:\s*false/.test(guard[1]),
'it reports NOT linked, which is the half that keeps the text box on screen');
ok(!!guard && /ready:\s*false/.test(guard[1]) && /client:\s*false/.test(guard[1]),
'and falls all the way back to the legacy card store, where the client’s notes already live');

/* Ordering: the guard has to come before the gate can conclude `linked: true`. */
const guardAt = SOURCE.indexOf('if (_isClientLink && !expectedClientSurface)');
const linkedTrueAt = SOURCE.search(/linked:\s*true/);
ok(guardAt >= 0 && (linkedTrueAt < 0 || guardAt < linkedTrueAt),
'the unverifiable-surface answer is reached before any answer that claims a link');

/* ---- the composer is the thing that actually breaks ---------------------- */

const composer = grabFunc('_calComposerHtml');
ok(/linked\s*&&\s*!\s*\w*[Rr]eady/.test(composer.replace(/\s+/g, ' '))
  || /!\w*[Gg]ate\w*\.ready/.test(composer),
'the composer still replaces itself when a link is claimed but not ready — the fix works by never claiming');
ok(/Notes could not load/.test(composer),
'and that replacement is the "Notes could not load" state the client was left with');

/* ---- the staff path is untouched ----------------------------------------- */

/* Asserted by execution above (staffSame), not by grepping for `_isClientLink ||`
   — the first version of this check did exactly that and failed on
   `const exactClientBinding = !_isClientLink || …`, a correct pre-existing line.
   Searching source for a token is not the same as testing a behaviour. */

if (failures) {
  console.error('\nClient composer presence checks FAILED');
  process.exit(1);
}
console.log('\nClient composer presence checks passed');
