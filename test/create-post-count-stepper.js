'use strict';
/*
 * "HOW MANY POSTS" IS A BUTTON, NOT TWO SEVEN-PIXEL ARROWS.
 *
 * OWNER, 2026-08-26: "for the how many post things, instead of putting this
 * horrible up and down thing, let's just put a plus and a minus, a button left
 * and right".
 *
 * A number input's native spinner is two stacked ~7px arrows inside the field.
 * They are a hard target on a trackpad, absent on touch, and rendered
 * differently by every browser. The stepper replaces them with two real
 * buttons — and the input stays a REAL number input, so typing, min/max and
 * every existing pin on this dialog are untouched; only the spinner is hidden,
 * in CSS.
 *
 * The logic worth pinning is the CLAMP and the disabled state, because a
 * stepper whose buttons stay live at the ends is the same "click does nothing"
 * failure the deep link had: the reader presses, sees no change, and cannot
 * tell whether the control is broken or the value is already at its limit.
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
  // Functions here are indented four spaces, so their closing brace is the
  // first "\n    }" after the opening — an end anchor that must exist.
  const end = html.indexOf('\n    }', start);
  return end < 0 ? '' : html.slice(start, end + 6);
}

const NEEDED = ['_calStepNativePostCount', '_calSetNativePostCount', '_calNativePostCountMax',
  '_calNativePostTeamsPer', '_calNativePostCountHint'];
const sources = NEEDED.map(fnSrc);
ok(sources.every(Boolean), 'every function the stepper depends on is findable (harness is not vacuous)');

const maxItems = Number((html.match(/const CAL_NATIVE_MAX_INTAKE_ITEMS = (\d+)/) || [])[1]);
ok(Number.isFinite(maxItems) && maxItems > 1, 'the intake ceiling is a real number (' + maxItems + ')');

/* The mode->teams table comes from the shipped source too, so the ceilings this
   suite asserts are the ceilings the dialog actually enforces rather than a
   copy that can drift away from it. */
const modeTeamsStart = html.indexOf('const CAL_NATIVE_MODE_TEAMS = {');
const modeTeamsSrc = modeTeamsStart < 0 ? ''
  : html.slice(modeTeamsStart, html.indexOf('};', modeTeamsStart) + 2);
ok(/both:/.test(modeTeamsSrc) && /video:/.test(modeTeamsSrc) && /thumbnail:/.test(modeTeamsSrc),
  'the mode/teams table is read from the shipped source, not restated here');

/* A fake DOM with exactly the four elements the stepper touches. */
function makeDom() {
  const el = extra => Object.assign({ value: '', textContent: '', disabled: false }, extra || {});
  const nodes = {
    calNativePostCount: el({ value: '1' }),
    calNativePostCountHint: el(),
    calNativePostCountMinus: el({ disabled: true }),
    calNativePostCountPlus: el({ disabled: false }),
  };
  return { nodes, document: { getElementById: id => nodes[id] || null, activeElement: null } };
}

function harness(mode) {
  const dom = makeDom();
  const state = { mode, postCount: 1 };
  const ctx = {
    document: dom.document,
    _calNativePostState: state,
    CAL_NATIVE_MAX_INTAKE_ITEMS: maxItems,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(modeTeamsSrc + '\n' + sources.join('\n'), ctx);
  return { dom, state, step: d => ctx._calStepNativePostCount(d), set: v => ctx._calSetNativePostCount(v), ctx };
}

// ---- the ordinary path ---------------------------------------------------
{
  const h = harness('both');
  h.step(1);
  ok(h.state.postCount === 2 && h.dom.nodes.calNativePostCount.value === '2',
    'plus raises the count, and the input shows it — the state and the field never disagree');
  h.step(-1);
  ok(h.state.postCount === 1, 'minus lowers it again');
  ok(/1 post/.test(h.dom.nodes.calNativePostCountHint.textContent),
    'and the hint under the control is rewritten every step, so the sub-issue total is never stale');
}

// ---- the ends, which is the whole reason this is a test ------------------
{
  const h = harness('both');
  h.step(-1);
  ok(h.state.postCount === 1, 'minus at one stays at one rather than going to zero or negative');
  ok(h.dom.nodes.calNativePostCountMinus.disabled === true,
    'and minus is disabled there — a live button that does nothing is indistinguishable from a broken one');
  ok(h.dom.nodes.calNativePostCountPlus.disabled === false, 'while plus is still live');
}
{
  const h = harness('both');
  const max = Math.floor(maxItems / 2); // 'both' makes two sub-issues per post
  for (let i = 0; i < max + 5; i++) h.step(1);
  ok(h.state.postCount === max,
    'plus stops at the ceiling the mode allows (' + max + ' posts in Video + Thumbnail), however many times it is pressed');
  ok(h.dom.nodes.calNativePostCountPlus.disabled === true, 'and plus is disabled at the ceiling');
  ok(h.dom.nodes.calNativePostCountMinus.disabled === false, 'while minus is live again');
}
{
  /* The ceiling is per MODE: Video-only makes one sub-issue per post, so it
     allows twice as many posts. The disabled state must be recomputed from the
     same max the setter clamps to, or a mode change leaves "+" live past the
     ceiling — the exact bug this pins against. */
  const both = harness('both');
  const video = harness('video');
  for (let i = 0; i < maxItems + 5; i++) { both.step(1); video.step(1); }
  ok(video.state.postCount > both.state.postCount,
    'Video only allows more posts than Video + Thumbnail, because it makes one sub-issue per post rather than two');
  ok(video.dom.nodes.calNativePostCountPlus.disabled === true
    && both.dom.nodes.calNativePostCountPlus.disabled === true,
    'and both modes disable plus at their OWN ceiling');
}

// ---- typed input is still a first-class way to set it --------------------
{
  const h = harness('both');
  h.set(7);
  ok(h.state.postCount === 7, 'typing a number still sets the count — the buttons are an addition, not a replacement');
  h.set('');
  ok(h.state.postCount === 1, 'and an emptied field falls back to one rather than NaN');
  const h2 = harness('both');
  h2.dom.nodes.calNativePostCount.value = 'abc';
  h2.step(1);
  ok(h2.state.postCount === 2,
    'a step from an unparseable field starts from one, so the control cannot be wedged by junk text');
}

// ---- the markup the CSS depends on --------------------------------------
ok(/id="calNativePostCountMinus"[^>]*aria-label="One post fewer"/.test(html)
  && /id="calNativePostCountPlus"[^>]*aria-label="One post more"/.test(html),
  'both buttons carry a label, because their only visible content is a line and a cross');
ok(/class="cal-native-count-stepper"/.test(html), 'the three cells are one segmented control');
ok(/-webkit-appearance: none; margin: 0; \}/.test(html)
  && /\.cal-native-count-input\[type="number"\] \{ -moz-appearance: textfield/.test(html),
  'the native spinner is hidden in BOTH engines — hiding it in one leaves the old control on the other');
ok(/type="number"/.test(html.slice(html.indexOf('id="calNativePostCount"') - 200, html.indexOf('id="calNativePostCount"') + 200)),
  'and the field is still a real number input, so min/max and mobile keypads are unchanged');

// ---- the batch controls got the room the owner asked for ----------------
ok(/\.cal-native-batch-controls \{ display: grid; gap: 10px;/.test(html),
  'the search box and the dropdown are separated by a real gap rather than sitting flush');
ok(/class="cal-native-batch-controls"/.test(html), 'and the wrapper is a class, not an inline style');
ok(/\.cal-native-batch-filter-empty \{ display: block; margin-top: 0;/.test(html),
  'the empty notice drops its own margin, so the grid gap is not doubled when it appears');
ok(/\.cal-native-batch-field::after/.test(html) && /appearance: none/.test(html.slice(html.indexOf('.cal-native-batch-select {'), html.indexOf('.cal-native-batch-select {') + 400)),
  'the dropdown draws its own chevron instead of inheriting a different native arrow per browser');
ok(!/Create a post for <strong>/.test(html),
  'and the subtitle is gone — the dialog only ever opens from one client\'s calendar, so naming them was restating the obvious');

if (failures) {
  console.error(`\n${failures} count-stepper check(s) failed`);
  process.exit(1);
}
console.log('\ncreate-post count stepper checks passed');
