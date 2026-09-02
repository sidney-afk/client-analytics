'use strict';
/*
 * THE DETAIL PANE'S SCROLL OFFSET MUST BE KEYED TO THE PANE IT WAS TAKEN FROM.
 *
 * Run:  node test/prod-detail-scroll-key.js   (exit 0 = all good)
 *
 * Owner report 2026-09-02 (OPEN_REPAIRS 108, the scroll half): opening a
 * sub-issue and then going back to its parent painted the parent SCROLLED DOWN
 * and immediately snapped it to the top.
 *
 * THE MECHANISM. `_prodRender` captures the detail scroll one line before the
 * innerHTML swap -- but the navigation helper has ALREADY written the new id
 * into `_prodState.openId` by then. The old code stamped the captured offset
 * with `_prodState.openId`, so the offset belonged to the OUTGOING item while
 * the label named the INCOMING one. The restore compared that state to itself,
 * matched, and pasted the sub-issue's offset onto the parent's fresh pane;
 * `_prodScrollDetailToTop`'s deferred reset then zeroed it a tick later. Two
 * mechanisms each correct on their own, one mismatched label between them, and
 * a visible flash where nothing should have moved.
 *
 * The repair is to ask the DOM which item is painted, so the thing measured and
 * the thing named are the same element.
 *
 * This harness extracts the REAL helpers from ../index.html (brace-balanced, so
 * it survives line shifts) and RUNS them against a DOM stub, rather than
 * pattern-matching the source -- OPEN_REPAIRS 106's rule that where a value is
 * derivable, deriving it beats matching its text.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

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

/* A detail pane as the tab really builds it: `.prod-detail-main` inside a
   container that stamps its own id. `kind` picks which of the three attributes
   carries it, because a deliverable, a batch parent and a project each use a
   different one and the key has to survive all three. */
const HARNESS = `
function makePane(kind, id, scrollTop) {
  const owner = {
    _attrs: { [kind]: id },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; }
  };
  const detail = { scrollTop: scrollTop, closest(sel) { return sel.split(',').some(s => owner.getAttribute(s.trim().slice(1, -1)) != null) ? owner : null; } };
  return { detail, owner };
}
function makeRoot(pane, listScrollTop) {
  const list = listScrollTop == null ? null : { scrollTop: listScrollTop };
  return {
    querySelector(sel) {
      if (sel === '.prod-detail-main') return pane ? pane.detail : null;
      if (sel === '.prod-listwrap') return list;
      return null;
    }
  };
}
const document = { getElementById() { return null; }, querySelector() { return null; } };
function setTimeout(fn) { return 0; }
const window = { scrollTo() {} };
const _prodState = { openId: '', openBatchId: '', listScrollTop: 0, detailScrollTop: 0, detailScrollKey: '' };
`;

const context = vm.createContext({ console });
vm.runInContext(
  HARNESS
  + grabFunc('_prodPaintedDetailKey') + '\n'
  + grabFunc('_prodCaptureListScroll') + '\n'
  + grabFunc('_prodScrollDetailToTop') + '\n',
  context);

const run = expr => vm.runInContext(expr, context);

/* ---- the key names the PAINTED item, for all three container shapes -------- */

ok(run(`_prodPaintedDetailKey(makeRoot(makePane('data-prod-detail', 'row-parent', 0)))`) === 'row-parent'
  && run(`_prodPaintedDetailKey(makeRoot(makePane('data-prod-batch-detail', 'batch-7', 0)))`) === 'batch-7'
  && run(`_prodPaintedDetailKey(makeRoot(makePane('data-prod-project-detail', 'someclient', 0)))`) === 'someclient',
'the painted key is read from a deliverable, a batch parent and a project alike');

ok(run(`_prodPaintedDetailKey(makeRoot(null))`) === '',
'a root with no detail pane painted yields no key rather than a stale one');

/* ---- THE REPRO: capture runs after the state has already moved ------------- */

/* This is exactly `_prodRender`'s position -- `_prodOpenDeliverable` has set
   openId to the sub-issue, the parent's pane is still in the document, and the
   innerHTML swap is the next statement. */
run(`_prodState.openId = 'row-subissue'; _prodState.detailScrollTop = 0; _prodState.detailScrollKey = '';
     _prodCaptureListScroll(makeRoot(makePane('data-prod-detail', 'row-parent', 640), 120));`);

ok(run(`_prodState.detailScrollKey`) === 'row-parent',
'an offset captured from the parent is keyed to the PARENT, not to the sub-issue being navigated to');
ok(run(`_prodState.detailScrollTop`) === 640 && run(`_prodState.listScrollTop`) === 120,
'the captured offsets themselves are unchanged');

/* The bug in one assertion: with the old expression the key would have read
   'row-subissue', the restore would have matched the incoming pane, and the
   sub-issue's 640px would have been pasted onto the parent. */
ok(run(`_prodState.detailScrollKey !== _prodState.openId`),
'the captured key and the destination differ during a navigation — the mismatch the old code could not represent');

/* ---- and it still keys correctly when nothing is navigating --------------- */

run(`_prodState.openId = 'row-parent';
     _prodCaptureListScroll(makeRoot(makePane('data-prod-detail', 'row-parent', 300), 0));`);
ok(run(`_prodState.detailScrollKey`) === 'row-parent' && run(`_prodState.detailScrollTop`) === 300,
'a plain re-render of the same open issue still captures its own offset under its own key');

/* ---- the top-scroll leaves no label on a zero offset ----------------------- */

run(`_prodState.openId = 'VID-13634'; _prodScrollDetailToTop();`);
ok(run(`_prodState.detailScrollTop`) === 0 && run(`_prodState.detailScrollKey`) === '',
'scrolling a freshly opened item to the top clears the key instead of stamping the URL identifier');

/* ---- the restore side, pinned structurally -------------------------------- */

/* `_prodRender` is not extractable on its own -- it calls most of the tab -- so
   its restore is checked in source form. Both halves matter: it must ask the
   DOM (not state) which item painted, and it must refuse an empty key, which is
   what a project view produced when the key came from openId||openBatchId. */
const restore = /const detailPane = root\.querySelector\('\.prod-detail-main'\);[\s\S]{0,600}?\n\s{12}\}/.exec(INDEX);
ok(!!restore, 'the detail restore in _prodRender is a guarded block, not a single-line state comparison');
ok(!!restore && /_prodPaintedDetailKey\(root\)/.test(restore[0]),
'the restore resolves the painted item from the DOM rather than comparing state to itself');
ok(!!restore && /_prodState\.detailScrollKey\b/.test(restore[0]) && /painted === _prodState\.detailScrollKey/.test(restore[0]),
'the restore applies an offset only when the painted item matches the captured key');
ok(!!restore && /&& _prodState\.detailScrollKey\)/.test(restore[0]),
'an empty captured key restores nothing, so two different projects cannot share one offset');
ok(!/detailScrollKey === String\(_prodState\.openId/.test(INDEX),
'no site still keys the detail offset by the id being navigated TO');

if (failures) {
  console.error('\nProduction detail scroll-key checks FAILED');
  process.exit(1);
}
console.log('\nProduction detail scroll-key checks passed');
