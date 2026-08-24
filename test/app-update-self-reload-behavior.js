'use strict';
/*
 * The self-reload's safety condition, executed rather than pattern-matched.
 *
 * test/app-update-nudge.js pins the wiring with static assertions, and this
 * session already produced the lesson that a source-scanning check can pass
 * for the wrong reason. The condition that decides whether a backgrounded tab
 * throws away a reader's half-written caption deserves to actually RUN, so this
 * lifts `visibleEl` and `wouldLoseWork` out of the shipped file and exercises
 * them against a stub DOM.
 *
 * The rule being pinned (owner ruling 2026-08-24): a hidden tab reloads itself,
 * but only when nothing typed is uncommitted and nothing is open on top of the
 * page. Everything else falls back to the banner.
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
let NODES = [];
function el(spec) {
  return Object.assign({
    tagName: 'INPUT', type: 'text', value: '', defaultValue: '',
    isContentEditable: false, textContent: '',
    _w: 100, _h: 20, _display: 'block', _visibility: 'visible', _opacity: '1',
    _selectors: [],
    getBoundingClientRect() { return { width: this._w, height: this._h }; },
  }, spec);
}
const documentStub = {
  querySelectorAll(sel) { return NODES.filter(n => n._selectors.indexOf(sel) > -1); },
};
const windowStub = {
  getComputedStyle(node) {
    return { display: node._display, visibility: node._visibility, opacity: node._opacity };
  },
};
const FIELDS = 'input, textarea, [contenteditable="true"]';
const DIALOGS = '[role="dialog"], [aria-modal="true"], dialog[open]';

const wouldLoseWork = new Function('document', 'window',
  lift('visibleEl') + '\n' + lift('wouldLoseWork') + '\nreturn wouldLoseWork;')(documentStub, windowStub);

function field(spec) { return el(Object.assign({ _selectors: [FIELDS] }, spec)); }
function dialog(spec) { return el(Object.assign({ _selectors: [DIALOGS] }, spec)); }

// --- 1. The clean case: a list view nobody has touched ----------------------
NODES = [field({ value: '', defaultValue: '' }), field({ value: 'video', defaultValue: 'video' })];
ok(wouldLoseWork() === false,
  'an untouched page loses nothing — this is the case the self-reload exists for');

// --- 2. Typing blocks it ---------------------------------------------------
NODES = [field({ tagName: 'TEXTAREA', type: 'textarea', value: 'half a caption', defaultValue: '' })];
ok(wouldLoseWork() === true,
  'a half-written caption blocks the self-reload');

NODES = [field({ isContentEditable: true, textContent: '  drafted  ' })];
ok(wouldLoseWork() === true, 'so does a non-empty contenteditable');
NODES = [field({ isContentEditable: true, textContent: '   ' })];
ok(wouldLoseWork() === false, 'whitespace alone in a contenteditable does not');

// --- 3. Anything open on top blocks it -------------------------------------
NODES = [dialog({ tagName: 'DIV' })];
ok(wouldLoseWork() === true,
  'an open composer blocks it even with nothing typed yet — the reader is mid-task');
NODES = [dialog({ tagName: 'DIV', _display: 'none', _w: 0, _h: 0 })];
ok(wouldLoseWork() === false, 'a CLOSED modal still in the DOM does not block it');

// --- 4. Hidden and non-text fields are ignored ------------------------------
NODES = [field({ type: 'hidden', value: 'sv-select-state', defaultValue: '', _w: 0, _h: 0 })];
ok(wouldLoseWork() === false,
  'a hidden input does not block it — sv-select keeps its value in one, on every page');
NODES = [field({ type: 'checkbox', value: 'on', defaultValue: '' })];
ok(wouldLoseWork() === false, 'a checkbox is not typed work');
NODES = [field({ value: 'typed', defaultValue: '', _display: 'none', _w: 0, _h: 0 })];
ok(wouldLoseWork() === false, 'a field on a surface that is not rendered does not block it');

// --- 5. The known, deliberate false positive --------------------------------
/* Workload sets its client-search input through .value when a client is
 * selected, so a FILTERED Workload tab reads as dirty and gets the banner
 * instead of a silent reload. Pinned as intended, not as a bug: the filter is
 * state the reader chose, and it survives. An unfiltered tab clears the input
 * back to '' and reloads normally. */
NODES = [field({ value: 'a-client-slug', defaultValue: '' })];
ok(wouldLoseWork() === true, 'a FILTERED Workload tab gets the banner, keeping its filter');
NODES = [field({ value: '', defaultValue: '' })];
ok(wouldLoseWork() === false, 'an unfiltered one reloads normally');

// --- 6. A fixed-position element is still visible ---------------------------
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
