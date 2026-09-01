'use strict';
/*
 * A refresh must not take the focus away.
 *
 * OWNER REQUEST, 2026-09-01: "can you make it so when the asset thing
 * refreshes, it doesn't unfocus anything ... for the UI experience, this should
 * never bother anyone."
 *
 * WHY IT HAPPENS, and why the answer is one general rule rather than a second
 * special case. `_prodRender` sets `prodRoot.innerHTML` wholesale. Every node
 * inside is destroyed and rebuilt, so the focused element stops existing and
 * the browser drops focus to <body>: the caret vanishes mid-keystroke and a
 * keyboard user is returned to the top of the tab. The description editor had
 * a bespoke rescue for this. Nothing else did.
 *
 * And it is not rare. `_prodRefreshAssetSurfaces` IS `_prodRender`, and
 * `_prodEnsureAssets` calls it on each status transition, so simply opening a
 * row renders once on `loading` and again on `ready` -- the "it still refreshes
 * two times in a row" in the same report. The reads are NOT duplicated (the
 * ensure guard returns the cached state); the RENDERS are, and each one was a
 * focus loss.
 *
 * THE ONE THAT WOULD FAIL SILENTLY. The key is built from `data-prod-*`
 * attributes, and the asset section carries BOTH an identity
 * (`data-prod-assets="<id>"`) and a condition (`data-prod-assets-status`).
 * The condition flips loading -> ready across exactly the re-render this
 * exists to survive. A key containing it can never match on the far side --
 * `querySelector` returns null, nothing is restored, and the result is
 * indistinguishable from having no fix at all. Hence the volatile-attribute
 * exclusion, and hence most of this file.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Comment-aware AND regex-aware.
 *
 * The comment half is why every extractor in this suite is hand-written:
 * index.html comments are prose full of apostrophes and braces, which a
 * quote-only matcher reads as code and then calls unclosed.
 *
 * The regex half was added here after this file broke on its own subject.
 * `_prodFocusSelectorPart` contains `.replace(/[\\"]/g, ...)` -- a DOUBLE QUOTE
 * inside a regex character class. A scanner that does not know about regex
 * literals reads that quote as opening a string, swallows the rest of the
 * function, and reports "unclosed" for code that balances perfectly. It had
 * been passing by accident: the broken quote state happened to re-sync on a
 * later quote before a brace at depth zero. Editing the function moved the
 * text and the accident stopped landing, which is the worst way for a latent
 * bug to surface -- an unrelated edit failing for a reason that is not in it.
 *
 * A `/` opens a regex only where a value may begin, so the preceding
 * significant character decides it; character classes are tracked because a
 * `/` inside one does not close the literal.
 */
function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  let regex = false, charClass = false, prev = '';
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (regex) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (charClass) { if (c === ']') charClass = false; }
      else if (c === '[') charClass = true;
      else if (c === '/') regex = false;
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '/' && '(,=:[!&|?{};+~*%<>^-'.indexOf(prev) >= 0) {
      regex = true; charClass = false; escaped = false; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; prev = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error('unclosed: ' + signature);
}

/* ---- The real helpers, executed ----------------------------------------- */
/* No DOM library is available to the unit lane, so the nodes are fakes -- but
   the FUNCTIONS are the shipped ones, and what is asserted is the part that is
   ours: which attributes become the key, and that capture and restore agree on
   it exactly. Matching that selector against the document is the browser's job
   and CI's browser lanes cover it. */

const volatileLine = INDEX.match(/const PROD_FOCUS_VOLATILE_ATTR = .*/);
if (!volatileLine) throw new Error('PROD_FOCUS_VOLATILE_ATTR not found');

let ACTIVE = null;
const ctx = {
  console,
  CSS: { escape: v => String(v) },
  get document() { return { activeElement: ACTIVE }; },
};
vm.createContext(ctx);
vm.runInContext([
  volatileLine[0],
  grabFunc('function _prodFocusSelectorPart('),
  grabFunc('function _prodFocusShape('),
  grabFunc('function _prodFocusStructuralTail('),
  grabFunc('function _prodCaptureFocus('),
  grabFunc('function _prodRestoreFocus('),
  'this.part = _prodFocusSelectorPart;',
  'this.capture = _prodCaptureFocus;',
  'this.restore = _prodRestoreFocus;',
].join('\n'), ctx);

function node(attrs, parent, opts) {
  const el = {
    id: attrs && attrs.id || '',
    tagName: (opts && opts.tag) || 'BUTTON',
    className: (opts && opts.cls) || '',
    textContent: (opts && opts.text) || '',
    getAttribute(n) { const a = el.attributes.find(x => x.name === n); return a ? a.value : null; },
    attributes: Object.entries(attrs || {})
      .filter(([k]) => k !== 'id')
      .map(([name, value]) => ({ name, value: String(value) })),
    parentElement: parent || null,
    children: [],
    focusCalls: [],
    focus(o) { el.focusCalls.push(o); ACTIVE = el; },
  };
  if (parent) parent.children.push(el);
  return el;
}
function rootWith(map) {
  return {
    queries: [],
    contains: () => true,
    querySelector(sel) { this.queries.push(sel); return map[sel] || null; },
  };
}

/* ---- 1. The key is built from identity, ancestor-first ------------------- */

const assetsSection = node({ 'data-prod-assets': 'del_1' });
const assetInput = node({ 'data-prod-asset-input': 'del_1' }, assetsSection);
ACTIVE = assetInput;
const assetSnap = ctx.capture(rootWith({}));

ok(!!assetSnap && assetSnap.selector === '[data-prod-assets="del_1"] [data-prod-asset-input="del_1"]',
  'the key is the ancestor identity followed by the control identity, in document order');

/* ---- 2. THE SILENT-FAILURE GUARD: condition attributes are excluded ------ */
/* This is the assertion the whole fix rests on. */

const statusful = node({ 'data-prod-assets': 'del_1', 'data-prod-assets-status': 'loading' });
const inStatusful = node({ 'data-prod-asset-input': 'del_1' }, statusful);
ACTIVE = inStatusful;
const statusSnap = ctx.capture(rootWith({}));
ok(!!statusSnap && statusSnap.selector.indexOf('assets-status') === -1,
  'THE FINDING: data-prod-assets-status is NOT in the key -- it flips loading->ready across the very re-render this survives, so a key holding it could never match again');
ok(!!statusSnap && statusSnap.selector === assetSnap.selector,
  'so the key is byte-identical before and after the status changes, which is what makes the restore land');

[
  ['data-prod-tip', 'Recheck asset access'],
  ['data-prod-comments-state', 'loading'],
  ['data-prod-label-state', 'saving'],
  ['data-prod-attribution-state', 'stale'],
  ['data-prod-freshness', 'degraded'],
  ['data-prod-description-ready', '0'],
].forEach(([name, value]) => {
  const n = node({ 'data-prod-row': 'r1', [name]: value });
  ok(ctx.part(n) === '[data-prod-row="r1"]',
    name + ' is excluded from the key -- its VALUE is a condition');
});

/* The mirror image, and the first version of this file got it wrong. The test
   is what the value CARRIES, not what the name reads like. Two attributes look
   like conditions and are identities:
     data-prod-pstatus="<client id>"   -- WHICH project-status button
     data-prod-disabled="composer"     -- WHICH inert control
   Dropping either would delete the only thing naming the focused element and
   leave an ambiguous key, which restores the wrong control rather than none --
   strictly worse than the bug being fixed. */
[
  ['data-prod-pstatus', 'sidneylaruel'],
  ['data-prod-disabled', 'composer'],
].forEach(([name, value]) => {
  const n = node({ [name]: value });
  ok(ctx.part(n) === '[' + name + '="' + value + '"]',
    name + ' is KEPT -- it reads like a condition and holds an identity');
});

ok(ctx.part(node({ 'data-prod-description': 'd1', 'data-prod-description-control': 'source' }))
   === '[data-prod-description="d1"][data-prod-description-control="source"]',
  'two identity attributes on one node both survive, unseparated, so they AND together');

/* ---- 3. An id is the whole key and stops the climb ----------------------- */

const idParent = node({ id: 'prodDetail', 'data-prod-ignored': 'x' });
const idChild = node({ 'data-prod-row': 'r9' }, idParent);
const above = node({ 'data-prod-never': 'seen' });
idParent.parentElement = above;
ACTIVE = idChild;
const idSnap = ctx.capture(rootWith({}));
ok(idSnap.selector === '#prodDetail [data-prod-row="r9"]',
  'an id is the whole part for its node, and the walk stops there rather than climbing past it');
ok(idSnap.selector.indexOf('never') === -1,
  'so ancestors above the id add nothing -- an id is already unique in the document');

/* ---- 4. Nothing identifiable means no snapshot, not a wrong one ---------- */

ACTIVE = node({ class: 'prod-btn' }, node({ class: 'prod-wrap' }));
ok(ctx.capture(rootWith({})) === null,
  'an element with no identifying attribute yields NO snapshot -- better to restore nothing than to restore the wrong control');
ACTIVE = null;
ok(ctx.capture(rootWith({})) === null, 'and nothing focused yields no snapshot');

/* ---- 5. The caret is carried, and only where a caret exists -------------- */

const typing = node({ 'data-prod-asset-input': 'del_1' });
typing.selectionStart = 4; typing.selectionEnd = 9; typing.selectionDirection = 'backward';
ACTIVE = typing;
const caret = ctx.capture(rootWith({}));
ok(caret.selectionStart === 4 && caret.selectionEnd === 9 && caret.selectionDirection === 'backward',
  'a text control carries its selection, so a refresh mid-edit does not silently move the caret to the start');

const checkbox = node({ 'data-prod-row-check': 'r1' });
checkbox.selectionStart = null;
ACTIVE = checkbox;
ok(ctx.capture(rootWith({})).selectionStart === undefined,
  'a control with no caret carries none -- setSelectionRange on one of those throws, and a throw here would abandon the restore');

/* ---- 6. Capture and restore agree on the selector, exactly --------------- */

const rebuilt = node({ 'data-prod-asset-input': 'del_1' });
rebuilt.value = 'https://drive.example/folder';
const root6 = rootWith({ '[data-prod-assets="del_1"] [data-prod-asset-input="del_1"]': rebuilt });
rebuilt.setSelectionRange = (s, e, d) => { rebuilt.range = [s, e, d]; };
ACTIVE = null;
ok(ctx.restore(assetSnap, root6) === true,
  'the restore finds the rebuilt control and focus really lands on it');
ok(root6.queries.length === 1 && root6.queries[0] === assetSnap.selector,
  'and it queries with EXACTLY the captured selector -- capture and restore cannot drift apart');
ok(rebuilt.focusCalls.length === 1 && rebuilt.focusCalls[0] && rebuilt.focusCalls[0].preventScroll === true,
  'focus is restored with preventScroll, or the fix would trade a focus jump for a scroll jump');

/* ---- 7. The caret is clamped to what came back -------------------------- */

const shorter = node({ 'data-prod-asset-input': 'del_1' });
shorter.value = 'ab';
shorter.setSelectionRange = (s, e, d) => { shorter.range = [s, e, d]; };
ACTIVE = null;
ctx.restore(caret, rootWith({ '[data-prod-asset-input="del_1"]': shorter }));
ok(shorter.range && shorter.range[0] === 2 && shorter.range[1] === 2,
  'a caret past the end of the value that came back is clamped, not passed through to throw');

/* ---- 8. Failure is quiet and total, never half-applied ------------------- */

ACTIVE = null;
ok(ctx.restore(assetSnap, rootWith({})) === false,
  'a control that did not come back restores nothing and says so');
const thrower = { contains: () => true, querySelector() { throw new Error('bad selector'); } };
let threw = false;
try { ok(ctx.restore(assetSnap, thrower) === false, 'an unparseable selector returns false'); }
catch (e) { threw = true; }
ok(!threw, 'and never throws -- a focus restore must not be able to take the whole render down with it');
ok(ctx.restore(null, rootWith({})) === false, 'no snapshot restores nothing');

/* ---- 9. _prodRender wires it around the destructive write ---------------- */

const render = grabFunc('function _prodRender(');
const iCapture = render.indexOf('_prodCaptureFocus(root)');
const iWipe = render.indexOf('root.innerHTML =');
const iRestore = render.indexOf('_prodRestoreFocus(focusSnapshot, root)');
ok(iCapture > -1 && iWipe > -1 && iRestore > -1, '_prodRender captures and restores around the rebuild');
ok(iCapture < iWipe,
  'the capture runs BEFORE innerHTML is replaced -- after it, the focused element no longer exists to read');
ok(iRestore > iWipe,
  'and the restore runs after, against the nodes that actually came back');

ok(/if \(!_prodRestoreDescriptionFocus\(descriptionFocus\)\) _prodRestoreFocus\(focusSnapshot, root\)/.test(render),
  'the description restore is tried first and the general one is the fallback -- the description snapshot carries a caret from state that the live element no longer shows');

const restoreDesc = grabFunc('function _prodRestoreDescriptionFocus(');
ok(/return false;/.test(restoreDesc) && /return document\.activeElement === target;/.test(restoreDesc),
  'and _prodRestoreDescriptionFocus reports whether it actually restored, rather than the caller assuming it did');

/* ---- 10. It reaches the control the owner named -------------------------- */
/* A key scheme that no real control can be keyed by would pass every assertion
   above and fix nothing. The asset URL input is the one in the report. */

ok(/data-prod-asset-input="/.test(INDEX),
  'the asset URL input carries an identity attribute, so it can be keyed at all');
ok(!/^data-prod-tip$|-(state|status|freshness|disabled|error)$/.test('data-prod-asset-input'),
  'and that attribute is not one the volatile filter drops -- the reported control is genuinely covered');
ok(/data-prod-assets="/.test(INDEX) && /data-prod-assets-status="/.test(INDEX),
  'while its section really does carry both an identity and a status, which is why the split matters here');

/* ---- 11. THE CONTROLS THAT CARRY NO IDENTITY AT ALL ---------------------- */
/* Raised by review on #1206, and it was right on both halves. Most focusable
   controls in this tab have no `data-prod-*`: `.prod-assets-refresh` has none,
   and `.prod-nav-btn` has only `data-prod-tip`, which the filter drops. The
   first version covered neither -- and on `.prod-assets-refresh` it did
   something worse than nothing, climbing past the button to its
   `[data-prod-assets]` SECTION and producing a key that named the ancestor.
   Restoring that focuses a <section>. */

const assetsSec = node({ 'data-prod-assets': 'del_9' }, null, { tag: 'SECTION', cls: 'prod-assets' });
const assetsHead = node({}, assetsSec, { tag: 'DIV', cls: 'prod-assets-head' });
node({}, assetsHead, { tag: 'SPAN', cls: 'prod-assets-title' });
const refreshBtn = node({}, assetsHead, { tag: 'BUTTON', cls: 'prod-assets-refresh', text: 'Refresh access' });
ACTIVE = refreshBtn;
const refreshSnap = ctx.capture(rootWith({}));
ok(!!refreshSnap, 'a control with NO data-prod attribute is still captured');
ok(refreshSnap.selector === '[data-prod-assets="del_9"] > :nth-child(1) > :nth-child(2)',
  'THE FINDING: the key anchors at the identified section and then walks DOWN structurally to the button, instead of stopping at the section and naming the wrong element');
ok(refreshSnap.shape === 'BUTTON.prod-assets-refresh#Refresh access',
  'and it records the shape -- tag, class AND accessible name -- because a structural step names a position rather than an element');

/* A nav button has no identified ancestor anywhere, so the anchor is the root. */
/* Rooted at prodRoot itself, which is what the real sidebar is: the walk has to
   reach the root for the structural fallback to have anything to anchor on. */
const navRoot = rootWith({});
navRoot.children = [];
navRoot.contains = () => true;
const navWrap = node({}, navRoot, { tag: 'DIV', cls: 'prod-nav' });
node({}, navWrap, { tag: 'BUTTON', cls: 'prod-nav-btn' });
const navBtn = node({ 'data-prod-tip': 'Issues' }, navWrap, { tag: 'BUTTON', cls: 'prod-nav-btn active', text: 'Issues' });
ACTIVE = navBtn;
const navSnap = ctx.capture(navRoot);
ok(!!navSnap && navSnap.selector === ':scope > :nth-child(1) > :nth-child(2)',
  'a nav button, whose only data-prod attribute is the excluded tooltip, is keyed structurally from the root rather than dropped');
ok(navSnap.shape === 'BUTTON.prod-nav-btn#Issues',
  'and its shape uses the FIRST class token, so the `active` state class appended after it is free to change across the rebuild');

/* ---- 12. The shape check is what makes a positional key safe ------------- */

const wrongKind = node({}, null, { tag: 'INPUT', cls: 'prod-assets-input' });
ACTIVE = null;
ok(ctx.restore(refreshSnap, rootWith({ '[data-prod-assets="del_9"] > :nth-child(1) > :nth-child(2)': wrongKind })) === false,
  'if the rebuild moved things and that position now holds a DIFFERENT control, nothing is restored -- a positional key must not put the caret where the reader did not leave it');

const rightKind = node({}, null, { tag: 'BUTTON', cls: 'prod-assets-refresh', text: 'Refresh access' });
ACTIVE = null;
ok(ctx.restore(refreshSnap, rootWith({ '[data-prod-assets="del_9"] > :nth-child(1) > :nth-child(2)': rightKind })) === true,
  'and the same control at the same position is restored');

const restyled = node({}, null, { tag: 'BUTTON', cls: 'prod-nav-btn', text: 'Issues' });
ACTIVE = null;
ok(ctx.restore(navSnap, rootWith({ ':scope > :nth-child(1) > :nth-child(2)': restyled })) === true,
  'a state class that came and went does not block the restore, because only the first token is compared');

/* ---- 13. SIBLINGS THAT SHARE A CLASS ------------------------------------ */
/* Raised by review on #1206 and the sharpest finding on this change. Every
   comment lifecycle control is <button class="prod-comment-action"> with NO
   attribute distinguishing it -- only its onclick and its label differ.
   Resolving a comment during the 30-second refresh removes Reply and shifts
   Edit, Reopen and Delete up one. A positional key lands on the old ordinal,
   and tag-plus-class waves it through because all four are identical under
   that test. Focus moves from Edit to Reopen and the next keypress performs
   the WRONG lifecycle write -- the exact failure the shape guard was added to
   prevent, which it did not. */

const actionsRow = node({ 'data-prod-comment': 'c1' }, null, { tag: 'DIV', cls: 'prod-comment-actions' });
node({}, actionsRow, { tag: 'BUTTON', cls: 'prod-comment-action', text: 'Reply' });
const editBtn = node({}, actionsRow, { tag: 'BUTTON', cls: 'prod-comment-action', text: 'Edit' });
node({}, actionsRow, { tag: 'BUTTON', cls: 'prod-comment-action', text: 'Resolve' });
ACTIVE = editBtn;
const editSnap = ctx.capture(rootWith({}));
ok(!!editSnap && editSnap.shape === 'BUTTON.prod-comment-action#Edit',
  'the shape carries the accessible name, which is the ONLY thing telling these buttons apart');

/* Reply is gone; Edit shifted up; the old ordinal now holds Resolve/Reopen. */
const reopenAtOldSlot = node({}, null, { tag: 'BUTTON', cls: 'prod-comment-action', text: 'Reopen' });
ACTIVE = null;
ok(ctx.restore(editSnap, rootWith({ [editSnap.selector]: reopenAtOldSlot })) === false,
  'THE FINDING: after Reply is removed, the old position holds Reopen -- focus does NOT move there, so the next keypress cannot perform the wrong lifecycle write');

const editMoved = node({}, null, { tag: 'BUTTON', cls: 'prod-comment-action', text: 'Edit' });
ACTIVE = null;
ok(ctx.restore(editSnap, rootWith({ [editSnap.selector]: editMoved })) === true,
  'and the same button, still Edit, is restored normally');

const labelRoot = rootWith({});
labelRoot.children = [];
labelRoot.contains = () => true;
const labelled = node({ 'aria-label': 'Delete comment' }, labelRoot, { tag: 'BUTTON', cls: 'prod-comment-action', text: '\u00d7' });
ACTIVE = labelled;
ok(ctx.capture(labelRoot).shape === 'BUTTON.prod-comment-action#Delete comment',
  'aria-label wins over text, so an icon-only control is still told apart from its siblings');

/* ---- 14. The readiness flag is state, not identity ---------------------- */
/* _prodMarkDescriptionsStale() flips data-prod-description-ready 1 -> 0 and is
   called immediately BEFORE the render this exists to survive, so treating it
   as identity meant the Description Edit button could never be restored. */

const readyEdit = node({
  'data-prod-description-control': 'edit',
  'data-prod-description-edit': '1',
  'data-prod-description-ready': '1',
}, null, { tag: 'BUTTON', cls: 'prod-description-action', text: 'Edit' });
ACTIVE = readyEdit;
const beforeStale = ctx.capture(rootWith({}));  // has its own identity attrs, so no structural tail needed
const staleEdit = node({
  'data-prod-description-control': 'edit',
  'data-prod-description-edit': '1',
  'data-prod-description-ready': '0',
}, null, { tag: 'BUTTON', cls: 'prod-description-action', text: 'Edit' });
ACTIVE = staleEdit;
const afterStale = ctx.capture(rootWith({}));
ok(beforeStale.selector === afterStale.selector,
  'the Description Edit button keys identically either side of _prodMarkDescriptionsStale, so the refresh it runs before no longer strands it');
ok(beforeStale.selector.indexOf('ready') === -1,
  'because data-prod-description-ready is excluded -- it is a readiness condition, not an identity');

console.log(failures === 0
  ? '\nproduction focus-survives-render checks passed'
  : '\n' + failures + ' focus-survives-render check(s) failed');
process.exit(failures === 0 ? 0 : 1);
