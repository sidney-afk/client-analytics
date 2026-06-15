'use strict';
/*
 * Review-tab collab gate — regression test.
 *
 * Run:  node test/review-collab-gate.js   (exit 0 = all good)
 *
 * Extracts the REAL _calReviewComponentActive + _calNormStatus from
 * ../index.html (by name, brace-balanced — robust to line shifts) so we test
 * the ACTUAL shipping code, not a paraphrase.
 *
 * Behaviour under test: on the CLIENT review surface (the 'review' tab the
 * client link sees) a component that has been sent back for tweaks
 * ("Tweaks Needed") stays in the client's review queue ONLY while
 * Collaborative mode is on. With collab OFF the client gets the SMM-style
 * hands-off view — the in-flight component (and any card whose only live
 * component is in tweaks) drops off the queue until it comes back at
 * "Client Approval". Components sitting at the surface's approval status are
 * always in play; the SMM surface never keeps Tweaks-Needed components and
 * ignores the collab toggle entirely.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` by brace-balancing.
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
// Extract a single-line `const NAME = ...;` declaration.
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}
// Extract a brace-delimited `const NAME = { ... };` object declaration.
function grabConstObj(name) {
  const at = INDEX.indexOf('const ' + name);
  if (at < 0) throw new Error('const not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1) + ';'; }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Toggleable stubs for the two globals the gate consults, plus the real
// status table + review config the extracted functions reference.
const HARNESS = `
let _isClientLink = false;
let _collabOn = false;
function _calIsCollabOn(){ return _collabOn; }
function setView(isClient, collabOn){ _isClientLink = isClient; _collabOn = collabOn; }
`;

const REAL = [
  grabConst('CAL_STATUSES'),
  grabConstObj('_CAL_REVIEW_CFG'),
  grabFunc('_calNormStatus'),
  grabFunc('_calReviewComponentActive'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL +
  ';return { _calReviewComponentActive, setView };')();
const { _calReviewComponentActive, setView } = mod;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}
// A post carrying a single component status (video) — the component the gate
// is asked about below.
function post(status) { return { video_status: status }; }

console.log('— Client review surface (client link) —');
// Awaiting the client's approval is always in play, collab or not.
setView(true, false);
check('Client Approval, collab OFF → active',
  _calReviewComponentActive(post('Client Approval'), 'video', 'client'), true);
setView(true, true);
check('Client Approval, collab ON  → active',
  _calReviewComponentActive(post('Client Approval'), 'video', 'client'), true);

// Tweaks Needed follows the collab toggle — the crux of this fix.
setView(true, false);
check('Tweaks Needed,   collab OFF → hidden',
  _calReviewComponentActive(post('Tweaks Needed'), 'video', 'client'), false);
setView(true, true);
check('Tweaks Needed,   collab ON  → active',
  _calReviewComponentActive(post('Tweaks Needed'), 'video', 'client'), true);

// Finished / not-yet-client states never sit in the client queue.
setView(true, true);
check('Approved,        collab ON  → hidden',
  _calReviewComponentActive(post('Approved'), 'video', 'client'), false);
check('For SMM Approval,collab ON  → hidden',
  _calReviewComponentActive(post('For SMM Approval'), 'video', 'client'), false);

console.log('\n— SMM review surface (unchanged: ignores collab, never keeps tweaks) —');
setView(false, false);
check('For SMM Approval, collab OFF → active',
  _calReviewComponentActive(post('For SMM Approval'), 'video', 'smm'), true);
check('Tweaks Needed,    collab OFF → hidden',
  _calReviewComponentActive(post('Tweaks Needed'), 'video', 'smm'), false);
setView(false, true);
check('Tweaks Needed,    collab ON  → hidden',
  _calReviewComponentActive(post('Tweaks Needed'), 'video', 'smm'), false);
check('Client Approval (routed to client), collab ON → hidden on SMM surface',
  _calReviewComponentActive(post('Client Approval'), 'video', 'smm'), false);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll review-collab-gate checks passed.');
