'use strict';
/*
 * Multi-select has to work on the rows the reader is looking at.
 *
 * Owner report 2026-08-25, filed as two bugs and fixed as one:
 *   "when I select and shift to multi-select, when I'm in a parent issue, it
 *    doesn't work, like the shift select doesn't select multiple things"
 *   "when I multi-selected the thumbnails and I went to action and changed
 *    status, it just changed one, it didn't change the rest"
 *
 * Two causes, and BOTH had to go:
 *
 *  1. Sub-issue rows inside a parent (and issue rows inside a project) called
 *     `_prodOpenDeliverable` directly, so they had no modifier path at all --
 *     a shift-click just opened the issue. Only the list row ever routed
 *     through `_prodRowClick`.
 *  2. `_prodRangeSelectRow` and `_prodTargetIds` both asked `_prodFlatOrder()`
 *     "what is on screen?", and that function only ever described the LIST
 *     view. Inside a parent it returns rows that are not rendered, so
 *     `indexOf` was -1 for both ends of the range, and the bulk filter dropped
 *     the entire selection -- which is how the Actions menu could count 15
 *     issues and write one.
 *
 * These run the SHIPPED functions against a stub state rather than scanning
 * the source for a pattern, because a source scan is exactly what would have
 * called cause 1 fixed while the rows still had no handler.
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
    /* Comments are SKIPPED, not parsed. index.html comments are prose and
       contain apostrophes -- "the row's scope" -- which a quote-only scanner
       reads as an unterminated string, swallowing every brace after it and
       throwing `unclosed` for a function that balances perfectly. That error
       names the wrong thing and sends the reader hunting a syntax error that
       is not there. A brace or quote inside a comment is not code. */
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const ch = INDEX[j];
    const next = INDEX[j + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; j++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; j++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; j++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

// --- stub world ------------------------------------------------------------
// A parent P with five children c1..c5, plus two unrelated list rows.
const ISSUES = [
  { id: 'P', parent: '' },
  { id: 'c1', parent: 'P' }, { id: 'c2', parent: 'P' }, { id: 'c3', parent: 'P' },
  { id: 'c4', parent: 'P' }, { id: 'c5', parent: 'P' },
  { id: 'x1', parent: '' }, { id: 'x2', parent: '' },
];
const LIST_ORDER = ['P', 'x1', 'x2'];

const ctx = {
  _prodState: null,
  // Mirrors the real _prodIssue: it resolves by id OR displayId (index.html).
  // The first version of this stub only matched `id`, which is precisely why it
  // passed while the deep-link path was still broken.
  _prodIssue: id => ISSUES.find(d => d.id === String(id) || d.displayId === String(id)) || null,
  _prodChildrenOf: id => ISSUES.filter(d => d.parent === String(id)),
  _prodBatchRows: batchId => ISSUES.filter(d => d.batchId === batchId),
  _prodGroupsFor: rows => [{ key: 'g', items: rows }],
  _prodIssueRows: () => LIST_ORDER.map(id => ({ id })),
  _prodFlatOrder: () => LIST_ORDER.slice(),
};
const build = new Function('ctx', `
  with (ctx) {
    ${lift('_prodVisibleRowOrder')}
    ${lift('_prodRangeSelectRow')}
    ${lift('_prodTargetIds')}
    return { _prodVisibleRowOrder, _prodRangeSelectRow, _prodTargetIds };
  }
`)(ctx);

function stateInParent() {
  return { view: 'detail', openId: 'P', openBatchId: '', openProjectId: '',
    selected: new Set(), selAnchor: '', focusRow: '', collapsed: new Set() };
}
function stateInList() {
  return { view: 'list', openId: '', openBatchId: '', openProjectId: '',
    selected: new Set(), selAnchor: '', focusRow: '', collapsed: new Set() };
}

// --- 1. The order helper reports what is actually rendered ------------------
ctx._prodState = stateInParent();
ok(JSON.stringify(build._prodVisibleRowOrder()) === JSON.stringify(['c1', 'c2', 'c3', 'c4', 'c5']),
  'inside a parent, the visible order is the parent\'s children — not the list');
ctx._prodState = stateInList();
ok(JSON.stringify(build._prodVisibleRowOrder()) === JSON.stringify(LIST_ORDER),
  'in the list view it is unchanged — the surface that already worked is untouched');

// --- 2. Shift-select across children ---------------------------------------
ctx._prodState = stateInParent();
ctx._prodState.selected.add('c2');
ctx._prodState.selAnchor = 'c2';
build._prodRangeSelectRow('c5');
ok(JSON.stringify([...ctx._prodState.selected].sort()) === JSON.stringify(['c2', 'c3', 'c4', 'c5']),
  'shift-clicking c5 with c2 anchored selects the whole range — the reported bug');
ctx._prodState = stateInParent();
ctx._prodState.selected.add('c4');
ctx._prodState.selAnchor = 'c4';
build._prodRangeSelectRow('c2');
ok(JSON.stringify([...ctx._prodState.selected].sort()) === JSON.stringify(['c2', 'c3', 'c4']),
  'and it works upwards too');

// --- 3. The bulk action targets every selected row -------------------------
ctx._prodState = stateInParent();
['c1', 'c2', 'c3'].forEach(id => ctx._prodState.selected.add(id));
ok(JSON.stringify(build._prodTargetIds('c1').sort()) === JSON.stringify(['c1', 'c2', 'c3']),
  'Actions targets all three — it used to fall back to one, so the menu counted 3 and wrote 1');
ctx._prodState = stateInParent();
ctx._prodState.selected.add('c2');
ok(JSON.stringify(build._prodTargetIds('c2')) === JSON.stringify(['c2']),
  'a single selection still resolves to itself');

// --- 4. A row the reader cannot see is still excluded -----------------------
/* The filter exists for a reason: a stale selection from another surface must
 * not be written by a bulk action aimed at this one. Widening the order must
 * not turn that guard off. */
ctx._prodState = stateInParent();
['c1', 'x1'].forEach(id => ctx._prodState.selected.add(id));
ok(JSON.stringify(build._prodTargetIds('c1')) === JSON.stringify(['c1']),
  'a selected row that is NOT rendered here is still filtered out');

// --- 5. A sub-issue's own detail has no child list --------------------------
ctx._prodState = stateInParent();
ctx._prodState.openId = 'c1';
ok(JSON.stringify(build._prodVisibleRowOrder()) === JSON.stringify([]),
  'opening a sub-issue itself renders no children, so nothing claims to be visible');

// --- 6. The rows actually route through the selection handler ---------------
/* Asserted as CALLS, not mentions: this is the half a source scan would have
 * gotten wrong, so it checks the exact onclick each renderer emits. */
const subRow = lift('_prodSubIssueRowHTML');
const projRow = lift('_prodProjectIssueRowHTML');
ok(/onclick="return _prodRowClick\(event,/.test(subRow),
  'the sub-issue row routes its click through _prodRowClick');
ok(!/onclick="_prodOpenDeliverable\(/.test(subRow),
  '...and no longer bypasses it (a plain click still opens, via _prodRowClick\'s fallthrough)');
ok(/onclick="return _prodRowClick\(event,/.test(projRow),
  'the project issue row does too');
ok(/prod-subissue-row' \+ \(selected \? ' selected' : ''\)/.test(subRow)
  && /prod-project-issue-row' \+ \(selected \? ' selected' : ''\)/.test(projRow),
  'both paint a selected state, so the selection is visible where it is made');
ok(/\.prod-subrow\.selected \{ background: var\(--prod-selected\); \}/.test(INDEX),
  'and it uses the list row\'s own token, not a second selection language');


// --- 9. Opened by LINEAR IDENTIFIER, which is how anyone actually gets here ---
/*
 * The Workload popover builds its parent link as ?prod=1&d=<Linear identifier>,
 * so _prodState.openId is routinely an identifier such as 'VID-13555' while a
 * child's `parent` holds the deliverable UUID. Resolving openId through
 * _prodIssue and then passing the RAW openId to _prodChildrenOf matched nothing,
 * so the order came back empty on the primary entry point and BOTH reported bugs
 * stayed live there. Caught by an adversarial review, not by this file's first
 * version - the stub had no displayId at all.
 */
{
  const saved = ISSUES.slice();
  ISSUES.length = 0;
  ISSUES.push(
    { id: 'uuid-P', displayId: 'VID-13555', parent: '' },
    { id: 'uuid-c1', parent: 'uuid-P' },
    { id: 'uuid-c2', parent: 'uuid-P' },
    { id: 'uuid-c3', parent: 'uuid-P' },
  );
  ctx._prodState = { view: 'detail', openId: 'VID-13555', openBatchId: '', openProjectId: '',
    selected: new Set(), selAnchor: '', focusRow: '', collapsed: new Set() };
  ok(JSON.stringify(build._prodVisibleRowOrder()) === JSON.stringify(['uuid-c1', 'uuid-c2', 'uuid-c3']),
    'a parent opened by Linear identifier still reports its children');

  ctx._prodState.selected.add('uuid-c1');
  ctx._prodState.selAnchor = 'uuid-c1';
  build._prodRangeSelectRow('uuid-c3');
  ok(JSON.stringify([...ctx._prodState.selected].sort()) === JSON.stringify(['uuid-c1', 'uuid-c2', 'uuid-c3']),
    '...so shift-select works on the deep-link path, not just the uuid path');

  ctx._prodState.selected = new Set(['uuid-c1', 'uuid-c2', 'uuid-c3']);
  ok(JSON.stringify(build._prodTargetIds('uuid-c1').sort()) === JSON.stringify(['uuid-c1', 'uuid-c2', 'uuid-c3']),
    '...and Actions targets all three instead of falling back to one');

  // The parent resolved by identifier must not be mistaken for a sub-issue.
  ISSUES[0].parent = 'uuid-grandparent';
  ok(JSON.stringify(build._prodVisibleRowOrder()) === JSON.stringify([]),
    'a SUB-issue opened by identifier still reports no children');
  ISSUES.length = 0;
  saved.forEach(x => ISSUES.push(x));
}

console.log(failures === 0
  ? '\nAll parent-view multi-select checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
