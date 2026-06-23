'use strict';
/*
 * Cancelling a running caption job must clear the "Cancelling…" pill within a
 * short grace window — not hang for the 12-minute stale timeout — regression.
 *
 * Run:  node test/caption-cancel-grace.js   (exit 0 = all good)
 *
 * BUG. _calCancelCaptionJob set cancel_requested and waited for the backend to
 * write status='cancelled'. If the backend never wrote it, the UI sat on
 * "Cancelling…" until CAL_CAPJOB_STALE_MS (12 min) fired — and then settled to
 * 'error', not 'cancelled'.
 *
 * FIX. _calCancelCaptionJob stamps cancelRequestedAt, and the poll settles the
 * job locally to 'cancelled' once _calCapJobCancelExpired() is true (grace window
 * elapsed with no backend confirmation). This extracts the REAL predicate and
 * checks the wiring.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

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
function grabConstExpr(name) {
  const m = INDEX.match(new RegExp('const ' + name + '\\s*=\\s*([^;]+);'));
  if (!m) throw new Error('const not found: ' + name);
  return m[1];
}

const GRACE = eval(grabConstExpr('CAL_CAPJOB_CANCEL_GRACE_MS'));
const _calCapJobCancelExpired = new Function('CAL_CAPJOB_CANCEL_GRACE_MS',
  grabFunc('_calCapJobCancelExpired') + ';return _calCapJobCancelExpired;')(GRACE);

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

console.log('— grace window —', GRACE + 'ms');
const NOW = 1_000_000_000;
check('grace is a sane, short window (1s–60s)', GRACE >= 1000 && GRACE <= 60000, true);

console.log('\n— _calCapJobCancelExpired predicate —');
check('cancelled + grace elapsed → settle locally',
  _calCapJobCancelExpired({ cancelRequested: true, cancelRequestedAt: NOW - GRACE - 1000 }, NOW), true);
check('cancelled + still within grace → keep waiting for the backend',
  _calCapJobCancelExpired({ cancelRequested: true, cancelRequestedAt: NOW - 1000 }, NOW), false);
check('not cancelled → never force-settle',
  _calCapJobCancelExpired({ cancelRequested: false, cancelRequestedAt: NOW - 99999 }, NOW), false);
check('cancelled, no cancelRequestedAt → falls back to startedAt',
  _calCapJobCancelExpired({ cancelRequested: true, startedAt: NOW - GRACE - 1 }, NOW), true);
check('cancelled, startedAt recent (no stamp) → still within grace',
  _calCapJobCancelExpired({ cancelRequested: true, startedAt: NOW - 500 }, NOW), false);
check('null job → false', _calCapJobCancelExpired(null, NOW), false);

console.log('\n— wiring guards —');
const cancelSrc = grabFunc('_calCancelCaptionJob');
check('_calCancelCaptionJob stamps cancelRequestedAt', /cancelRequestedAt\s*=/.test(cancelSrc), true);
const pollSrc = grabFunc('_calCapJobsPoll');
check('the poll force-settles via _calCapJobCancelExpired', /_calCapJobCancelExpired\s*\(/.test(pollSrc), true);
check("the poll settles those jobs to 'cancelled'", /_calCapJobSettle\(\s*job\s*,\s*'cancelled'/.test(pollSrc), true);

// Regression: a backend result that finishes racing the cancel must NOT sneak a
// caption onto the card. _calCapJobSettle has to coerce a still-cancelRequested
// job to 'cancelled' (and drop the late caption) before the apply block runs.
const settleSrc = grabFunc('_calCapJobSettle');
check('_calCapJobSettle honours cancelRequested (no late result sneaks in)',
  /cancelRequested\s*&&\s*status\s*!==\s*'cancelled'/.test(settleSrc), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll caption-cancel-grace checks passed.');
