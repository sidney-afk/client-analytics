'use strict';
/*
 * "HOW MANY POSTS" USES THE HOUSE STEPPER, NOT A SECOND COPY OF ONE.
 *
 * OWNER, 2026-08-26: "for the how many post things, instead of putting this
 * horrible up and down thing, let's just put a plus and a minus, a button left
 * and right".
 *
 * A number input's native spinner is two stacked ~7px arrows inside the field:
 * a hard target on a trackpad, absent on touch, drawn differently by every
 * browser. AGENTS.md is explicit that browser-native number spinners are not
 * acceptable on branded surfaces and that the documented SyncView controls are
 * to be REUSED.
 *
 * The first draft of this change hand-rolled the replacement: 36x36 buttons and
 * its own min/max disabling. Review caught it, and it was two faults at once —
 * a control below the 44px touch target on the very surface that was being
 * fixed for touch, and a second implementation of `_svStepNumber` /
 * `_svSyncStepper` that can drift from the original. It now uses
 * `_svStepperHtml`, which is 44px by contract and already carries the clamp and
 * the disabled ends.
 *
 * What is pinned here is the WIRING and the CLAMP, because reuse only helps if
 * the primitive's events actually reach this dialog's state. `_svStepNumber`
 * dispatches a bubbling `input` event after it writes, so a button press must
 * arrive at `_calSetNativePostCount` by exactly the path typing does — one path
 * in, not two. And a stepper whose buttons stay live at the ends is the same
 * failure the calendar deep link had: you press, nothing happens, and you
 * cannot tell whether the control is broken or the value is already at its
 * limit.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function fnSrc(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const end = html.indexOf('\n    }', start);
  return end < 0 ? '' : html.slice(start, end + 6);
}

const NEEDED = ['_svStepNumber', '_svSyncStepper', '_calSetNativePostCount',
  '_calNativePostCountMax', '_calNativePostTeamsPer', '_calNativePostCountHint'];
const sources = NEEDED.map(fnSrc);
ok(sources.every(Boolean), 'the shipped primitive and the dialog setter are both findable (harness is not vacuous)');

const maxItems = Number((html.match(/const CAL_NATIVE_MAX_INTAKE_ITEMS = (\d+)/) || [])[1]);
ok(Number.isFinite(maxItems) && maxItems > 1, 'the intake ceiling is a real number (' + maxItems + ')');

const modeTeamsStart = html.indexOf('const CAL_NATIVE_MODE_TEAMS = {');
const modeTeamsSrc = modeTeamsStart < 0 ? ''
  : html.slice(modeTeamsStart, html.indexOf('};', modeTeamsStart) + 2);
ok(/both:/.test(modeTeamsSrc) && /video:/.test(modeTeamsSrc) && /thumbnail:/.test(modeTeamsSrc),
  'the mode/teams table is read from the shipped source, not restated here');

/* A fake DOM carrying the four ids the primitive addresses, plus the hint. The
   input's `oninput` is wired the way the rendered markup wires it, so a button
   press has to travel the dispatched-event path to reach the setter — if that
   wiring is ever dropped from _svStepperHtml, these tests fail. */
function harness(mode, max) {
  const listeners = { input: [], change: [] };
  const input = {
    value: '1', min: '1', max: String(max), step: '1', disabled: false,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    dispatchEvent(event) { (listeners[event.type] || []).forEach(fn => fn(event)); return true; },
  };
  const btn = () => ({ disabled: false });
  const nodes = {
    calNativePostCount: input,
    calNativePostCountDown: btn(),
    calNativePostCountUp: btn(),
    calNativePostCountWrap: { classList: { toggle() {} } },
    calNativePostCountHint: { textContent: '' },
  };
  const state = { mode, postCount: 1 };
  const ctx = {
    document: { getElementById: id => nodes[id] || null, activeElement: null },
    _calNativePostState: state,
    CAL_NATIVE_MAX_INTAKE_ITEMS: maxItems,
    Event, Number, Math, String, console,
  };
  vm.createContext(ctx);
  vm.runInContext(modeTeamsSrc + '\n' + sources.join('\n'), ctx);
  // Exactly what the rendered markup wires: the primitive's own inline
  // `oninput` (sync only), and the `onchange` this dialog passes in. Both are
  // reached by _svStepNumber's dispatched events, which is the property under
  // test — if that wiring is ever dropped, these checks fail.
  input.addEventListener('input', () => ctx._svSyncStepper('calNativePostCount'));
  input.addEventListener('change', () => ctx._calSetNativePostCount(input.value));
  return { nodes, state, input, ctx, press: d => ctx._svStepNumber('calNativePostCount', d) };
}
const MAX_BOTH = Math.floor(maxItems / 2);

// ---- the wiring: a button press reaches this dialog's state --------------
{
  const h = harness('both', MAX_BOTH);
  h.press(1);
  ok(h.state.postCount === 2,
    'pressing + reaches _calSetNativePostCount through the primitive\'s dispatched change event — one path in, not two');
  ok(/2 posts/.test(h.nodes.calNativePostCountHint.textContent),
    'and the hint under the control is rewritten, so the sub-issue total is never stale');
  h.press(-1);
  ok(h.state.postCount === 1, 'pressing − lowers it again');
}

// ---- the ends ON THE FIRST PAINT, which is where this went wrong --------
/* The gap this closes: every check below pressed a button first, so all of them
   passed while the dialog was OPENING with both ends live. `_svStepperHtml`
   renders both buttons enabled and only `_svStepNumber` / `_svSyncStepper` ever
   disable one, so a dialog that opens at its minimum -- which is every dialog,
   the default is 1 post -- showed a minus whose first press did nothing. Review
   caught it, not this file. Asserting the state a press produces is not the
   same as asserting the state a render produces. */
{
  const h = harness('both', MAX_BOTH);
  h.ctx._svSyncStepper('calNativePostCount');
  ok(h.nodes.calNativePostCountDown.disabled === true
    && h.nodes.calNativePostCountUp.disabled === false,
    'a freshly rendered stepper sitting at its minimum already shows − as disabled, before anything is pressed');
}
{
  const h = harness('both', MAX_BOTH);
  h.input.value = String(MAX_BOTH);
  h.ctx._svSyncStepper('calNativePostCount');
  ok(h.nodes.calNativePostCountUp.disabled === true
    && h.nodes.calNativePostCountDown.disabled === false,
    'and one rendered at its ceiling — which a mode change can do — already shows + as disabled');
}
ok(/if \(typeof _svSyncStepper === 'function'\) _svSyncStepper\('calNativePostCount'\);\n    \}/.test(html),
  'the dialog calls _svSyncStepper after writing its markup, the way PTO does after its own render — the primitive expects it and leaving it out is how a caller gets both ends live');

// ---- the ends after a press ----------------------------------------------
{
  const h = harness('both', MAX_BOTH);
  h.press(-1);
  ok(h.state.postCount === 1, '− at one stays at one rather than going to zero or negative');
  ok(h.nodes.calNativePostCountDown.disabled === true,
    'and − is disabled there — a live button that does nothing is indistinguishable from a broken one');
  ok(h.nodes.calNativePostCountUp.disabled === false, 'while + is still live');
}
{
  const h = harness('both', MAX_BOTH);
  for (let i = 0; i < MAX_BOTH + 5; i++) h.press(1);
  ok(h.state.postCount === MAX_BOTH,
    'the ceiling holds at ' + MAX_BOTH + ' posts for Video + Thumbnail, however many times + is pressed');
  ok(h.nodes.calNativePostCountUp.disabled === true, 'and + is disabled at the ceiling');
  ok(h.nodes.calNativePostCountDown.disabled === false, 'while − is live again');
}
{
  /* The ceiling is per MODE: Video only makes one sub-issue per post, so it
     allows twice as many. The disabled state is recomputed after the setter has
     clamped, so a mode change that lowers the ceiling cannot leave + live. */
  const both = harness('both', MAX_BOTH);
  const video = harness('video', maxItems);
  for (let i = 0; i < maxItems + 5; i++) { both.press(1); video.press(1); }
  ok(video.state.postCount > both.state.postCount,
    'Video only allows more posts than Video + Thumbnail, because it makes one sub-issue per post rather than two');
  ok(video.nodes.calNativePostCountUp.disabled === true
    && both.nodes.calNativePostCountUp.disabled === true,
    'and both modes disable + at their OWN ceiling');
}

// ---- typing is still a first-class way to set it -------------------------
{
  const h = harness('both', MAX_BOTH);
  h.ctx._calSetNativePostCount(7);
  ok(h.state.postCount === 7, 'typing a number still sets the count — the buttons are an addition, not a replacement');
  h.ctx._calSetNativePostCount('');
  ok(h.state.postCount === 1, 'and an emptied field falls back to one rather than NaN');
}

// ---- it is the PRIMITIVE, not another copy of it -------------------------
ok(/\$\{_svStepperHtml\('calNativePostCount', postCount, \{/.test(html),
  'the dialog renders the shared sv-stepper rather than its own markup');
ok(!/_calStepNativePostCount/.test(html),
  'and the hand-rolled stepper handler is gone — a second implementation of a primitive is a second thing to drift');
ok(!/cal-native-count-step\b/.test(html) && !/cal-native-count-input\b/.test(html),
  'along with its bespoke CSS, so there is one stepper style in the app and not two');
ok(/\.sv-stepper \{[^}]*min-height: 44px/.test(html),
  'the primitive it now uses is 44px by contract — the touch target the hand-rolled 36px one missed');
ok(/\.cal-native-count-row \.sv-stepper \{ width: 126px/.test(html),
  'only its width is scoped for this inline row, because the primitive is full-width for the PTO fields it was built for');
ok(/min: 1, max: postCountMax, step: 1/.test(html),
  'the ceiling is handed to the primitive, so the clamp and the disabled ends read the same max the setter does');
ok(/downTip: 'One post fewer', upTip: 'One post more'/.test(html),
  'and both ends carry their own tooltip, since their visible content is a minus and a plus');
ok(/onchange: '_calSetNativePostCount\(this\.value\)'/.test(html),
  'the dialog wires itself through the primitive\'s EXISTING onchange option');
/* The primitive must not be edited at all. It lives inside the PTO source
   slice that the leave-lifecycle evidence packet is fingerprinted over, so any
   edit here stales a published 101-screenshot packet whose only sanctioned
   repair is a human re-reviewing all 101. The first draft of this change added
   an "additive" oninput option to it, which looked free and was not --
   test/leave-evidence-fingerprint-coupling.js caught it. */
ok(/' oninput="_svSyncStepper\(' \+ _jsAttrArg\(id\) \+ '\)">/.test(html),
  'and _svStepperHtml is untouched — it is inside the fingerprinted leave source, where an edit costs a 101-screenshot re-review');
ok(/if \(typeof _svSyncStepper === 'function'\) _svSyncStepper\('calNativePostCount'\);/.test(html),
  'and the setter re-syncs the ends last, after its own clamp, so the disabled state cannot describe a value that moved');

// ---- the batch controls got the room the owner asked for ----------------
ok(/\.cal-native-batch-controls \{ display: grid; gap: 10px;/.test(html),
  'the search box and the dropdown are separated by a real gap rather than sitting flush');
ok(/\.cal-native-batch-filter-empty \{ display: block; margin-top: 0;/.test(html),
  'the empty notice drops its own margin, so the grid gap is not doubled when it appears');
ok(!/Create a post for <strong>/.test(html),
  'and the subtitle is gone — the dialog only ever opens from one client\'s calendar, so naming them was restating the obvious');

if (failures) {
  console.error(`\n${failures} count-stepper check(s) failed`);
  process.exit(1);
}
console.log('\ncreate-post count stepper checks passed');
