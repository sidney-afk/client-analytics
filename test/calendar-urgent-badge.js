'use strict';
/*
 * URGENT badge must track the LIVE component status, and never linger after a
 * component leaves "Tweaks Needed" — regression test.
 *
 * Run:  node test/calendar-urgent-badge.js   (exit 0 = all good)
 *
 * BUG. The URGENT ping button (Video-only, shown at "Tweaks Needed") is rendered
 * by the full card builder _calRenderBody. The "mark comment done → send to
 * client" flow does NOT re-render the card; it patches the DOM in place via
 * _calUpdateCardStatusDisplay, which refreshed the sub-status pill label but left
 * the previously-rendered .cal-urgent-btn / .has-urgent in place — so URGENT
 * stuck next to "For Client Approval" until the next full re-render.
 *
 * FIX. A single shared predicate _calShowUrgent(p, c) drives the badge in BOTH
 * the render and the in-place updater, and the updater toggles `has-urgent` +
 * adds/removes `.cal-urgent-btn` to match. This harness extracts the REAL
 * _calShowUrgent (brace-balanced) and asserts the predicate, plus source-form
 * guards that the render and the updater both go through it.
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
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const REAL = [
  grabConst('CAL_STATUSES'),
  grabFunc('_calNormStatus'),
  grabFunc('_calShowUrgent'),
].join('\n\n');
const mod = new Function(REAL + ';return { _calShowUrgent };')();
const { _calShowUrgent } = mod;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}
const VID = 'https://linear.app/x/issue/VID-1/x';
const GRA = 'https://linear.app/x/issue/GRA-1/x';
const post = (o) => Object.assign({ video_status: '', graphic_status: '', caption_status: '',
  linear_issue_id: '', graphic_linear_issue_id: '' }, o);

console.log('— _calShowUrgent predicate —');
check('video + Tweaks Needed + link → URGENT shows',
  _calShowUrgent(post({ video_status: 'Tweaks Needed', linear_issue_id: VID }), 'video'), true);
// THE BUG-4 CASE: moved to Client Approval → URGENT must be gone.
check('video + Client Approval + link → URGENT hidden (the bug)',
  _calShowUrgent(post({ video_status: 'Client Approval', linear_issue_id: VID }), 'video'), false);
check('video + For Client Approval (alias) + link → hidden',
  _calShowUrgent(post({ video_status: 'For Client Approval', linear_issue_id: VID }), 'video'), false);
check('video + Tweaks Needed + NO link → hidden (cannot resolve editor)',
  _calShowUrgent(post({ video_status: 'Tweaks Needed', linear_issue_id: '' }), 'video'), false);
check('graphic + Tweaks Needed + link → hidden (Video-only affordance)',
  _calShowUrgent(post({ graphic_status: 'Tweaks Needed', graphic_linear_issue_id: GRA }), 'graphic'), false);
check('caption + Tweaks Needed → hidden',
  _calShowUrgent(post({ caption_status: 'Tweaks Needed' }), 'caption'), false);
check('video blank + link → hidden',
  _calShowUrgent(post({ video_status: '', linear_issue_id: VID }), 'video'), false);
check('video + Kasper Approval + link → hidden',
  _calShowUrgent(post({ video_status: 'Kasper Approval', linear_issue_id: VID }), 'video'), false);

console.log('\n— Source-form guards: render + in-place updater both go through the shared predicate —');
check('card render drives URGENT via the shared _calShowUrgent(p, c)',
  /const showUrgent = _calShowUrgent\(p, c\);/.test(INDEX), true);
check('no inline urgent predicate left to drift out of sync',
  INDEX.indexOf("=== 'Tweaks Needed' && !!link") === -1, true);

const updSrc = grabFunc('_calUpdateCardStatusDisplay');
check('_calUpdateCardStatusDisplay calls _calShowUrgent', /_calShowUrgent\s*\(/.test(updSrc), true);
check('_calUpdateCardStatusDisplay toggles has-urgent', /has-urgent/.test(updSrc), true);
check('_calUpdateCardStatusDisplay removes a stale .cal-urgent-btn',
  /cal-urgent-btn/.test(updSrc) && /\.remove\(\)/.test(updSrc), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll urgent-badge checks passed.');
