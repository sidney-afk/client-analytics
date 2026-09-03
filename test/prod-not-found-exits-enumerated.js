'use strict';
/*
 * EVERY EXIT THAT SAYS "NOT FOUND" MUST FIRST ASK WHETHER IT KNOWS.
 *
 * The deep-link defect took FIVE rounds to close — items 108, 116, 120, and two
 * fixes in between — and every round has the same post-mortem: the fix repaired
 * the exit where it was reported, and nobody counted the exits. It moved rather
 * than closed. The eviction was gated, so the bug surfaced in the detail pane.
 * The detail pane was gated, so it surfaced on a failed tail. That was gated, so
 * it surfaced before any tail had run.
 *
 * The cure is not a better fix at each exit. It is a rule that makes the set of
 * exits ENUMERABLE, so a new one cannot be added ungated without the suite
 * saying so.
 *
 * THE RULE: a Production pane may print "… not found." only from a function that
 * has consulted `_prodIncompletePaneHTML()` — the shared helper that answers
 * "has the row set actually settled?" and returns a skeleton, an honest failed
 * state, or '' when the answer is genuinely known.
 *
 * This does not check WHERE in the function the consultation happens; the three
 * live exits already differ (one guards, two use `||`). It checks that the
 * question is asked at all, which is the thing that was missing every time.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

const NOT_FOUND = /prod-empty"?>[^<]*not found\./i;
const CONSULTS = '_prodIncompletePaneHTML(';

/* The scan is a pure function of the source so it can be run against a fixture
   as well as the app — a guard whose only subjects already pass proves nothing
   about its own detection. */
function ungatedExits(source) {
  const names = [];
  const re = /(?:^|\n)\s*(?:async\s+)?function\s+(_prod[A-Za-z0-9_$]*)\s*\(/g;
  let m;
  while ((m = re.exec(source))) names.push(m[1]);
  const offenders = [];
  const checked = [];
  for (const name of [...new Set(names)]) {
    let body;
    try { body = extractFunction(source, name); } catch (e) { continue; }
    if (!NOT_FOUND.test(body)) continue;
    checked.push(name);
    if (!body.includes(CONSULTS)) offenders.push(name);
  }
  return { checked, offenders };
}

/* ---- prove the detection first ------------------------------------------ */
{
  const gated = 'function _prodFixtureA(){ const x = _prodIncompletePaneHTML("item"); '
    + 'if (x) return x; return \'<div class="prod-empty">Widget not found.</div>\'; }';
  const bare = 'function _prodFixtureB(){ return \'<div class="prod-empty">Widget not found.</div>\'; }';
  const a = ungatedExits(gated);
  const b = ungatedExits(bare);
  ok(a.checked.length === 1 && a.offenders.length === 0,
    'a pane that consults the completeness helper before saying "not found" passes');
  ok(b.checked.length === 1 && b.offenders.length === 1,
    'a pane that says "not found" without asking is CAUGHT — proven on a fixture, not assumed');
}

/* ---- and now the app ----------------------------------------------------- */
const { checked, offenders } = ungatedExits(INDEX);

ok(checked.length >= 3,
  'the "not found" exits are found and counted (' + checked.length + ': ' + checked.join(', ') + ')');
ok(offenders.length === 0,
  'every one of them consults _prodIncompletePaneHTML first, so none can call a not-yet-loaded row absent'
    + (offenders.length ? '\n        ungated: ' + offenders.join(', ') : ''));

/* The helper those exits depend on must itself still ask the settled question,
 * or gating on it becomes ceremony. */
const helper = extractFunction(INDEX, '_prodIncompletePaneHTML');
ok(/_prodRowSetComplete\(\)/.test(helper),
  'and the helper answers from _prodRowSetComplete(), not from a flag that means something narrower');
const complete = extractFunction(INDEX, '_prodRowSetComplete');
ok(/terminalTailLoadedAt/.test(complete) && /terminalTailPending/.test(complete) && /terminalTailFailed/.test(complete),
  'which is still all three terms — a landed tail, none pending, none failed');

if (failures) {
  console.error('\nNot-found exit enumeration checks FAILED');
  console.error('A Production pane may only say "not found" after consulting _prodIncompletePaneHTML().');
  process.exit(1);
}
console.log('\nNot-found exit enumeration checks passed');
