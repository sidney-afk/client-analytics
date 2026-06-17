'use strict';
/*
 * Marking the LAST open change-request done must show the client/Kasper chooser
 * FIRST and only resolve on confirm — cancelling must leave the comment intact.
 *
 * Run:  node test/comment-resolve-defer.js   (exit 0 = all good)
 *
 * BUG. _calToggleCommentDone set root.done = true, queued the save and re-rendered
 * (the comment vanished), THEN opened the destination chooser. Cancelling left the
 * comment resolved/gone ("it disappears before I can choose; if I cancel there's
 * no comment anymore"). FIX. For the last open SMM tweak the resolution is DEFERRED
 * into the chooser: _calToggleCommentDone passes a `mutate` callback to
 * _calResolveLastTweak and returns; the chooser's onChoose runs that resolve, then
 * flips the status. Cancel never reaches onChoose, so nothing is applied.
 *
 * (The end-to-end behaviour is proven by a headless A/B: live old code loses the
 *  comment on cancel; this build keeps it open through the chooser + cancel.)
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
let failures = 0;
function check(label, got, want) {
  const ok = got === want; if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

const toggle = grabFunc('_calToggleCommentDone');
const resolve = grabFunc('_calResolveLastTweak');

console.log('— _calToggleCommentDone defers the last-tweak resolve to the chooser —');
check('decides whether to defer to the chooser', /deferToChooser/.test(toggle), true);
check('the done-flip lives in a deferred closure (mutate), not run up front',
  /const mutate = \(\) => \{[\s\S]*?root\.done = true/.test(toggle), true);
check('deferred path hands the resolve to the chooser, then returns (nothing applied yet)',
  /if \(deferToChooser\) \{[\s\S]*?_calResolveLastTweak\(pid, comp, mutate\);[\s\S]*?return;/.test(toggle), true);
check('non-deferred path still applies + refreshes immediately',
  /\n\s*mutate\(\);\n\s*refresh\(\);\n\s*\}/.test(toggle), true);

console.log('\n— _calResolveLastTweak resolves only on a pick (confirm), never on cancel —');
check('takes the deferred resolve callback', /function _calResolveLastTweak\(pid, comp, resolveComment\)/.test(resolve), true);
check('onChoose runs the resolve BEFORE flipping the status',
  /onChoose:[\s\S]*?resolveComment\(\);[\s\S]*?_calApplyAutoStatus/.test(resolve), true);
check('cancel path (no onChoose) applies nothing — resolve is gated inside onChoose',
  /if \(typeof resolveComment === 'function'\) resolveComment\(\)/.test(resolve), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll comment-resolve-defer checks passed.');
