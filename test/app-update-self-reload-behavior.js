'use strict';
/*
 * The self-reload's safety condition, executed rather than pattern-matched.
 *
 * test/app-update-nudge.js pins the wiring with static assertions, and this
 * session produced the lesson twice that a source-scanning check can pass for
 * the wrong reason. The condition that decides whether a backgrounded tab
 * throws away a reader's half-finished Time Off request deserves to actually
 * RUN, so this lifts `visibleEl`, `onRenderedSurface`, `markEdited` and
 * `wouldLoseWork` out of the shipped file and exercises them against a stub DOM.
 *
 * The rule (owner ruling 2026-08-24): a hidden tab reloads itself, but only
 * when nothing typed is uncommitted and nothing is open on top of the page.
 * Everything else falls back to the banner.
 *
 * THE CASE THAT NEARLY SHIPPED WRONG. Every SyncView control that carries a
 * value is invisible by construction -- sv-select keeps its value in a
 * `type=hidden` input, sv-date in a 1px `opacity:0` input -- and a hidden
 * input's `defaultValue` MOVES WITH `.value` (HTML "default" value mode), so
 * comparing the two can never detect a pick. A Time Off request is a select,
 * two dates and a tick and nothing else, so the first version of this check
 * called that form clean and would have reloaded it away. Hence both halves
 * below: the value comparison, and the interaction marker.
 */
const fs = require('fs');
const path = require('path');

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function lift(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('missing ' + name + ' in index.html');
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

// --- stub DOM --------------------------------------------------------------
const VISIBLE_PARENT = {
  nodeType: 1, _display: 'block', _visibility: 'visible', _opacity: '1',
  getBoundingClientRect() { return { width: 300, height: 200 }; },
  parentElement: null,
};
const UNRENDERED_PARENT = {
  nodeType: 1, _display: 'none', _visibility: 'visible', _opacity: '1',
  getBoundingClientRect() { return { width: 0, height: 0 }; },
  parentElement: null,
};
let NODES = [];
function el(spec) {
  return Object.assign({
    nodeType: 1, tagName: 'INPUT', type: 'text', value: '', defaultValue: '',
    checked: false, defaultChecked: false,
    isContentEditable: false, textContent: '', dataset: {},
    _w: 100, _h: 20, _display: 'block', _visibility: 'visible', _opacity: '1',
    _selectors: [], parentElement: VISIBLE_PARENT,
    getBoundingClientRect() { return { width: this._w, height: this._h }; },
  }, spec);
}
const documentStub = {
  querySelectorAll(sel) {
    if (sel === '[data-sv-unsaved-edit]') return NODES.filter(n => n.dataset && n.dataset.svUnsavedEdit);
    return NODES.filter(n => n._selectors.indexOf(sel) > -1);
  },
};
const windowStub = {
  getComputedStyle(node) {
    return { display: node._display, visibility: node._visibility, opacity: node._opacity };
  },
};
const FIELDS = 'input, textarea, select, [contenteditable="true"]';
const DIALOGS = '[role="dialog"], [aria-modal="true"], dialog[open]';

const built = new Function('document', 'window', `
  var EDIT_MARK = 'svUnsavedEdit';
  ${lift('visibleEl')}
  ${lift('onRenderedSurface')}
  ${lift('markEdited')}
  ${lift('wouldLoseWork')}
  return { wouldLoseWork: wouldLoseWork, markEdited: markEdited };
`)(documentStub, windowStub);
const wouldLoseWork = built.wouldLoseWork;
const markEdited = built.markEdited;

function field(spec) { return el(Object.assign({ _selectors: [FIELDS] }, spec)); }
function dialog(spec) { return el(Object.assign({ _selectors: [DIALOGS] }, spec)); }

// --- 1. The clean case: a list view nobody has touched ----------------------
NODES = [field({ value: '', defaultValue: '' }), field({ value: 'video', defaultValue: 'video' })];
ok(wouldLoseWork() === false,
  'an untouched page loses nothing — this is the case the self-reload exists for');

// --- 2. Typing blocks it ---------------------------------------------------
NODES = [field({ tagName: 'TEXTAREA', type: 'textarea', value: 'half a caption', defaultValue: '' })];
ok(wouldLoseWork() === true, 'a half-written caption blocks the self-reload');
NODES = [field({ isContentEditable: true, textContent: '  drafted  ' })];
ok(wouldLoseWork() === true, 'so does a non-empty contenteditable');
NODES = [field({ isContentEditable: true, textContent: '   ' })];
ok(wouldLoseWork() === false, 'whitespace alone in a contenteditable does not');

// --- 3. The branded controls, which carry most of SyncView's unsaved state --
/* An sv-select's hidden input cannot be caught by value-vs-default at all, so
 * the interaction marker is the ONLY thing standing between a half-filled Time
 * Off request and a silent reload. `_svSelectPick` dispatches bubbling `input`
 * and `change`, which is what puts the marker there. */
{
  const svSelect = field({ type: 'hidden', value: 'wellness', defaultValue: 'wellness', _w: 0, _h: 0, _display: 'none' });
  NODES = [svSelect];
  ok(wouldLoseWork() === false, 'an untouched sv-select is not treated as work');
  markEdited({ target: svSelect });
  ok(wouldLoseWork() === true,
    'a PICKED sv-select blocks the self-reload — defaultValue can never see this, the marker can');
}
{
  // sv-date: 1px, opacity:0, but type=date DOES keep a usable defaultValue.
  const svDate = field({ type: 'date', value: '2026-09-01', defaultValue: '', _w: 1, _h: 1, _opacity: '0' });
  NODES = [svDate];
  ok(wouldLoseWork() === true,
    'a chosen sv-date blocks it even though the input is visually hidden');
}
{
  const tick = field({ type: 'checkbox', checked: true, defaultChecked: false });
  NODES = [tick];
  ok(wouldLoseWork() === true, 'a ticked checkbox is a choice — "PTO enabled" is a checkbox and nothing else');
  NODES = [field({ type: 'checkbox', checked: false, defaultChecked: false })];
  ok(wouldLoseWork() === false, 'an untouched checkbox is not');
}

// --- 4. The marker is cleaned up by a re-render, not by a flag --------------
/* A successful save re-renders the surface, which replaces the element and
 * takes the marker with it. Modelled here by dropping the marked node. */
{
  const picked = field({ type: 'hidden', value: 'b', defaultValue: 'b', _display: 'none', _w: 0, _h: 0 });
  markEdited({ target: picked });
  NODES = [picked];
  ok(wouldLoseWork() === true, 'the marked control blocks while it is on the page');
  NODES = [field({ type: 'hidden', value: 'b', defaultValue: 'b', _display: 'none', _w: 0, _h: 0 })];
  ok(wouldLoseWork() === false, 're-rendering that surface clears it — no flag to reset, no way to leak');
}
{
  const submit = field({ type: 'submit', value: 'Save' });
  markEdited({ target: submit });
  ok(!submit.dataset.svUnsavedEdit, 'clicking Save does not mark the button itself as unsaved work');
}

// --- 5. Anything open on top blocks it -------------------------------------
NODES = [dialog({ tagName: 'DIV' })];
ok(wouldLoseWork() === true,
  'an open composer blocks it even with nothing typed yet — the reader is mid-task');
NODES = [dialog({ tagName: 'DIV', _display: 'none', _w: 0, _h: 0 })];
ok(wouldLoseWork() === false, 'a CLOSED modal still in the DOM does not block it');

// --- 6. Controls on a surface that is not rendered are ignored --------------
NODES = [field({ value: 'typed', defaultValue: '', parentElement: UNRENDERED_PARENT })];
ok(wouldLoseWork() === false, 'a field on a hidden surface does not block it');
{
  const stale = field({ type: 'hidden', parentElement: UNRENDERED_PARENT, _display: 'none', _w: 0, _h: 0 });
  markEdited({ target: stale });
  NODES = [stale];
  ok(wouldLoseWork() === false, 'nor does a marked control whose whole surface is hidden');
}

// --- 7. The known, deliberate false positive --------------------------------
/* Workload sets its client-search input through .value when a client is
 * selected, so a FILTERED Workload tab reads as dirty and gets the banner
 * instead of a silent reload. Pinned as intended, not as a bug: the filter is
 * state the reader chose, and it survives. */
NODES = [field({ value: 'a-client-slug', defaultValue: '' })];
ok(wouldLoseWork() === true, 'a FILTERED Workload tab gets the banner, keeping its filter');
NODES = [field({ value: '', defaultValue: '' })];
ok(wouldLoseWork() === false, 'an unfiltered one reloads normally');

// --- 8. A fixed-position element is still visible ---------------------------
/* offsetParent is null for position:fixed, which is exactly what a modal is —
 * using it as the visibility test would have made every open composer invisible
 * to this check and reloaded the tab out from under the reader. */
NODES = [dialog({ tagName: 'DIV', offsetParent: null, _w: 480, _h: 320 })];
ok(wouldLoseWork() === true,
  'a position:fixed modal (offsetParent === null) is still seen as open');

console.log(failures === 0
  ? '\nAll self-reload safety-condition checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
