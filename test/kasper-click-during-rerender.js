'use strict';
/*
 * Kasper queue: a click is never eaten by a background re-render — regression test.
 *
 * Run:  node test/kasper-click-during-rerender.js   (exit 0 = all good)
 *
 * BACKGROUND. The review queue repaints by rebuilding DOM: _kasperPaintReview
 * rebuilds the whole "Waiting" list (body.innerHTML = …) and _kasperRepaintCard
 * replaces a single card (el.replaceWith). A BACKGROUND repaint — the realtime
 * echo of ANY client's calendar change, a tab-focus refresh, or a slow save
 * landing — can fire in the instant Kasper has a button pressed, tearing that
 * button out between pointerdown and click so the click never registers.
 * "Finish reviewing" then silently no-ops and he has to click again (the symptom
 * Kasper reported). The fix tracks a pressed pointer on a queue control
 * (_kasperPointerHeld) and DEFERS background repaints until it's released; a user
 * action's own repaint is unaffected because its onclick runs only after
 * pointerup, when the flag is already clear.
 *
 * This harness extracts the REAL handlers from ../index.html (brace-balanced, so
 * it survives line shifts) and asserts:
 *   • pointerdown on a control inside #kasperContent arms the guard;
 *   • pointerdown outside the queue / not on a control does NOT;
 *   • release clears the guard (and a deferred paint catches up via its own
 *     short retry — release adds no redundant full rebuild);
 *   • the safety auto-release can't leave the queue frozen;
 *   • source-form: both repaint paths early-return AND re-arm a short retry while
 *     the guard is held, and the listeners are wired on mount / removed on teardown.
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

// Harness: the guard state + spies the real handlers close over. setTimeout is
// stubbed so the test drives the deferred work deterministically.
const HARNESS = `
let _kasperPointerHeld = false;
let _kasperPointerSafetyTimer = null;
let paintCalls = 0;
let scheduled = [];                 // [{fn, ms, id}]
let nextId = 1;
function _kasperPaintReview(){ paintCalls++; }
function setTimeout(fn, ms){ const id = nextId++; scheduled.push({ fn, ms, id }); return id; }
function clearTimeout(id){ scheduled = scheduled.filter(t => t.id !== id); }
// Run the most-recently-scheduled timer whose delay is <= ms (simulates the
// clock advancing). Returns how many fired.
function runTimers(maxMs){
  const due = scheduled.filter(t => t.ms <= maxMs);
  scheduled = scheduled.filter(t => t.ms > maxMs);
  for (const t of due) t.fn();
  return due.length;
}
// Fake event target: closest('#kasperContent') / control-selector resolve per flags.
function makeTarget(inContent, isControl){
  return { closest(sel){
    if (sel === '#kasperContent') return inContent ? {} : null;
    return isControl ? {} : null;   // the control selector (button, a, …)
  }};
}
`;

const REAL = [
  grabFunc('_kasperOnPointerDown'),
  grabFunc('_kasperReleasePointer'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL + `
;return {
  press: (inContent, isControl) => _kasperOnPointerDown({ target: makeTarget(inContent, isControl) }),
  release: () => _kasperReleasePointer(),
  runTimers,
  held: () => _kasperPointerHeld,
  paintCalls: () => paintCalls,
  pending: () => scheduled.slice(),
};`)();

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

console.log('— Pointer guard arms only on a real queue control —');

// A1 — press on a control inside the queue arms the guard.
mod.press(true, true);
check('press on a control in #kasperContent → held', mod.held(), true);

// A2 — release just clears the guard (and the safety timer); it must NOT itself
// queue a redundant full-list rebuild (a deferred paint catches up via the
// guard's own retry, not via release). After A1 the only pending timer is the
// safety timer, which release clears — leaving nothing scheduled.
const paintsBefore = mod.paintCalls();
mod.release();
check('release → not held', mod.held(), false);
check('release leaves nothing scheduled (clears safety, adds no paint)', mod.pending().length, 0);
mod.runTimers(0);
check('release does not itself repaint', mod.paintCalls(), paintsBefore);

// A3 — press OUTSIDE the queue is ignored (must not freeze live updates).
mod.press(false, true);
check('press outside #kasperContent → not held', mod.held(), false);

// A4 — press inside the queue but NOT on a control is ignored.
mod.press(true, false);
check('press on inert content → not held', mod.held(), false);

console.log('\n— Safety auto-release can never freeze the queue —');

// A5 — a press with a never-fired pointerup must auto-release via the safety
// timer (1.5s), so background repaints resume on their own.
mod.press(true, true);
check('press arms the guard', mod.held(), true);
mod.runTimers(1500);                               // fire the safety timer
check('safety timer auto-releases the guard', mod.held(), false);

console.log('\n— Source-form guards: both repaint paths defer while held —');

const paintSrc = grabFunc('_kasperPaintReview');
check('_kasperPaintReview guards on _kasperPointerHeld, re-arms a retry, returns',
  /if\s*\(\s*_kasperPointerHeld\s*\)\s*\{[\s\S]*?setTimeout\(\s*_kasperPaintReview[\s\S]*?return;[\s\S]*?\}/.test(paintSrc), true);

const cardSrc = grabFunc('_kasperRepaintCard');
check('_kasperRepaintCard guards on _kasperPointerHeld, re-arms a retry, returns',
  /if\s*\(\s*_kasperPointerHeld\s*\)\s*\{[\s\S]*?setTimeout\([\s\S]*?_kasperRepaintCard[\s\S]*?return;[\s\S]*?\}/.test(cardSrc), true);

console.log('\n— Wiring: listeners attach on mount and detach on teardown —');

const ensureSrc = grabFunc('_kasperEnsureAutoRefresh');
check('mount adds the pointerdown guard listener',
  /addEventListener\(\s*['"]pointerdown['"]\s*,\s*_kasperOnPointerDown/.test(ensureSrc), true);
check('mount adds the pointerup release listener',
  /addEventListener\(\s*['"]pointerup['"]\s*,\s*_kasperReleasePointer/.test(ensureSrc), true);

const teardownSrc = grabFunc('_kasperTeardown');
check('teardown removes the pointerdown guard listener',
  /removeEventListener\(\s*['"]pointerdown['"]\s*,\s*_kasperOnPointerDown/.test(teardownSrc), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll kasper-click-during-rerender checks passed.');
