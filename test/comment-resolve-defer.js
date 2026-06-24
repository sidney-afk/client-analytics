'use strict';
/*
 * Marking the LAST open change-request done routes through the resolve-and-route
 * chooser FIRST and only resolves on a route pick — closing must leave the
 * change-request intact.
 *
 * Run:  node test/comment-resolve-defer.js   (exit 0 = all good)
 *
 * BUG (history). _calToggleCommentDone set root.done = true, queued the save and
 * re-rendered (the comment vanished), THEN opened the destination chooser.
 * Closing left the comment resolved/gone ("it disappears before I can choose; if
 * I cancel there's no comment anymore"). FIX. For the last open SMM tweak the
 * resolution is DEFERRED into the chooser: _calToggleCommentDone hands the
 * comment id to _calResolveLastTweak and returns; the chooser's onChoose resolves
 * it (_calResolveTweaksDone) then flips the status. Closing never reaches
 * onChoose, so nothing is applied.
 *
 * (The end-to-end behaviour — including the new 3-route / checklist / ✕-close
 *  chooser — is proven by qa/probes/p62_modal_resolve_delete.js and friends.)
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
check('the done-flip lives in a closure (mutate) for the non-deferred path',
  /const mutate = \(\) => \{[\s\S]*?root\.done = true/.test(toggle), true);
check('deferred path hands the comment id to the chooser, then returns (nothing applied yet)',
  /if \(deferToChooser\) \{[\s\S]*?_calResolveLastTweak\(pid, comp, rootId\);[\s\S]*?return;/.test(toggle), true);
check('non-deferred path still applies + refreshes immediately',
  /\n\s*mutate\(\);\n\s*refresh\(\);\n\s*\}/.test(toggle), true);

console.log('\n— _calResolveLastTweak resolves only on a route pick, never on close —');
check('takes the comment id to resolve', /function _calResolveLastTweak\(pid, comp, rootId\)/.test(resolve), true);
check('onChoose resolves the tweak BEFORE flipping the status',
  /onChoose:[\s\S]*?_calResolveTweaksDone\(post, comp,[\s\S]*?_calApplyAutoStatus/.test(resolve), true);
check('the resolve is gated inside onChoose — no mark-done before the chooser opens',
  resolve.indexOf('onChoose') > -1 && resolve.indexOf('_calResolveTweaksDone') > resolve.indexOf('onChoose'), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll comment-resolve-defer checks passed.');
