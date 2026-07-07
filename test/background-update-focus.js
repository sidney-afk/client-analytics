'use strict';
/*
 * Background updates must NEVER steal focus or caret — regression test (Workstream 1).
 *
 * Run:  node test/background-update-focus.js   (exit 0 = all good)
 *
 * BACKGROUND. A toast, a Supabase realtime echo, a tab-return refresh, or a
 * sibling card's after-save repaint can rebuild the DOM node the user is
 * actively typing in. The reported bug: in Samples Kasper approval, typing in a
 * component's tweak/comment field and then triggering Approve (which shows a
 * confirmation toast) yanked focus out of the field. The true cause is the
 * re-render replacing the focused node — showToast() itself never calls focus().
 *
 * The fix is a shared focus guard (_svCaptureFocus / _svRestoreFocus /
 * _svPreserveFocus) that captures the focused INPUT/TEXTAREA by a signature
 * surviving the rebuild (id, else its oninput handler string, else name) + the
 * caret, runs the render, then re-focuses the matching field in the fresh DOM.
 * The Samples Kasper queue re-renders (_sxrKasperRepaint, _sxrKasperRenderQueue)
 * are wrapped with it.
 *
 * This harness extracts the REAL helpers from ../index.html (brace-balanced, so
 * it survives line shifts), drives them against a minimal DOM stub, and asserts:
 *   • a field's focus + selection survive a full innerHTML rebuild that also
 *     fires a toast (the exact repro);
 *   • the same across a replaceWith-style single-node swap;
 *   • focus OUTSIDE the rebuilt region is left completely untouched;
 *   • the signature prefers id > oninput > name;
 *   • source-form: the Samples Kasper repaint paths use the guard, and
 *     showToast never calls .focus().
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

// Minimal DOM stub. Fields carry a tag, an optional id/name, an oninput
// handler string, and a caret (selectionStart/End/Direction). The document
// tracks which fields are currently "in the DOM" (for getElementById /
// querySelectorAll) and which is focused (activeElement). focus()/blur() and
// setSelectionRange() behave like the real thing.
const HARNESS = `
const document = {
  activeElement: null,
  _all: [],
  getElementById(id){ return this._all.find(n => n.id === id) || null; },
  querySelectorAll(_sel){ return this._all.slice(); },
};
function makeField(o){
  o = o || {};
  return {
    tagName: o.tag || 'TEXTAREA',
    id: o.id || '',
    name: o.name || '',
    _oninput: o.oninput || '',
    selectionStart: o.start == null ? 0 : o.start,
    selectionEnd: o.end == null ? 0 : o.end,
    selectionDirection: o.dir || 'none',
    getAttribute(k){ return k === 'oninput' ? (this._oninput || null) : null; },
    focus(){ document.activeElement = this; },
    setSelectionRange(s, e, d){ this.selectionStart = s; this.selectionEnd = e; this.selectionDirection = d || 'none'; },
  };
}
function makeContainer(children){
  return { _children: children.slice(), contains(node){ return this._children.includes(node); } };
}
`;

const REAL = [
  grabFunc('_svFieldSig'),
  grabFunc('_svCaptureFocus'),
  grabFunc('_svRestoreFocus'),
  grabFunc('_svPreserveFocus'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL + `
;return {
  document,
  makeField,
  makeContainer,
  fieldSig: _svFieldSig,
  capture: _svCaptureFocus,
  restore: _svRestoreFocus,
  preserve: _svPreserveFocus,
};`)();

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

const SIG = "_sxrKasperOnDraftInput(this,'p1','video')";

console.log('— A full innerHTML rebuild + toast preserves focus & caret (the repro) —');

// Kasper is typing in a card's tweak textarea (caret at 3).
let oldTa = mod.makeField({ oninput: SIG, start: 3, end: 3 });
const host = mod.makeContainer([oldTa]);
mod.document._all = [oldTa];
oldTa.focus();

let toastFired = false;
function fakeToast() { toastFired = true; }   // mirrors showToast: never calls focus()

// A background re-render (approve confirmation) rebuilds the queue: the old
// focused node is torn out (browser blurs it) and a fresh node with the SAME
// signature is inserted. The guard must land focus + caret on the new node.
let newTa = null;
mod.preserve(() => {
  fakeToast();
  mod.document.activeElement = null;          // innerHTML removal blurs the old node
  newTa = mod.makeField({ oninput: SIG, start: 0, end: 0 });
  host._children = [newTa];
  mod.document._all = [newTa];
}, host);

check('toast fired during the guarded render', toastFired, true);
check('focus landed on the NEW node (not the detached old one)', mod.document.activeElement === newTa, true);
check('focus is a live, in-document node', mod.document.activeElement !== oldTa, true);
check('caret start preserved', mod.document.activeElement && mod.document.activeElement.selectionStart, 3);
check('caret end preserved', mod.document.activeElement && mod.document.activeElement.selectionEnd, 3);

console.log('\n— A replaceWith-style single-node swap preserves focus & caret —');

let card = mod.makeField({ oninput: SIG, start: 5, end: 8, dir: 'forward' });
const cardHost = mod.makeContainer([card]);
mod.document._all = [card];
card.focus();
// Capture gated to the card, then swap the node (as _sxrKasperRepaint does).
const cap = mod.capture(cardHost);
mod.document.activeElement = null;            // replaceWith blurs the removed node
const swapped = mod.makeField({ oninput: SIG, start: 0, end: 0 });
mod.document._all = [swapped];
mod.restore(cap);
check('focus restored after replaceWith', mod.document.activeElement === swapped, true);
check('selection start restored', swapped.selectionStart, 5);
check('selection end restored', swapped.selectionEnd, 8);
check('selection direction restored', swapped.selectionDirection, 'forward');

console.log('\n— Focus OUTSIDE the rebuilt region is never touched —');

const outside = mod.makeField({ id: 'searchInput', start: 2, end: 2 });
mod.document._all = [outside];
outside.focus();
// Re-render a region that does NOT contain the focused field.
mod.preserve(() => { /* rebuild some unrelated container */ }, mod.makeContainer([]));
check('unrelated focused field left focused', mod.document.activeElement === outside, true);
check('unrelated field caret untouched', outside.selectionStart, 2);

console.log('\n— Nothing focused → guard is a no-op (never throws) —');
mod.document.activeElement = null;
let threw = false;
try { mod.preserve(() => { mod.document._all = [mod.makeField({ oninput: SIG })]; }); }
catch (e) { threw = true; }
check('no-focus render does not throw', threw, false);
check('no-focus render leaves activeElement null', mod.document.activeElement, null);

console.log('\n— Signature precedence: id > oninput > name —');
check('id wins', mod.fieldSig(mod.makeField({ id: 'x', oninput: 'f()', name: 'n' })), '#x');
check('oninput next', mod.fieldSig(mod.makeField({ oninput: 'f()', name: 'n' })), 'oninput=f()');
check('name last', mod.fieldSig(mod.makeField({ name: 'n' })), 'name=n');
check('non-field → empty sig', mod.fieldSig({ tagName: 'DIV' }), '');

console.log('\n— Source-form: the Samples Kasper re-render paths use the guard —');
const repaintSrc = grabFunc('_sxrKasperRepaint');
check('_sxrKasperRepaint captures the focused field before the swap',
  /_svCaptureFocus\s*\(/.test(repaintSrc), true);
check('_sxrKasperRepaint restores focus after the swap',
  /_svRestoreFocus\s*\(/.test(repaintSrc), true);
const queueSrc = grabFunc('_sxrKasperRenderQueue');
check('_sxrKasperRenderQueue wraps the innerHTML rebuild in _svPreserveFocus',
  /_svPreserveFocus\s*\(/.test(queueSrc), true);

console.log('\n— Source-form: showToast never grabs focus —');
const toastSrc = grabFunc('showToast');
check('showToast does not call .focus()', /\.focus\s*\(/.test(toastSrc), false);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll background-update-focus checks passed.');
