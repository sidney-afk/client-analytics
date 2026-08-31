'use strict';
/*
 * The group-header select-all checkbox refused every click with "Preview -
 * read-only", and that was wrong twice over. Sweep item 87.10.
 *
 * Selection is demonstrably not a write anywhere else in this view --
 * _prodToggleRowSelection and Ctrl/Cmd+A both mutate _prodState.selected
 * with no gate at all -- and the tab is not a read-only preview under the
 * live authority flag anyway, contradicting the sidebar chip ("Native
 * writes") a few inches away. The checkbox even paints its own on/partial
 * state from per-row selections, so it reflected a state it would not let
 * anyone set.
 *
 * DELIBERATELY NOT WIDENED TO ACTUALLY SELECT, in this pass. A whole-group
 * selection would pull in synthetic batch parents and attribution-repair
 * rows, and every downstream consumer of _prodState.selected -- the bulk
 * palette, the guarded keyboard shortcuts, _prodOpenSub's "Applying to N of
 * M" notice -- would start seeing that shape routinely. That is a real
 * behavior decision needing its own review, not a copy fix; shift-click and
 * Ctrl/Cmd+A already reach the same result today. So this pins that the
 * checkbox still refuses to select (unchanged), and now names the real,
 * narrow reason instead of the wrong broad one.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. The honest reason exists and says something actionable ---------- */

const REASON = (INDEX.match(/const PROD_GROUP_SELECT_UNSUPPORTED = '([^']+)';/) || [])[1] || '';
ok(!!REASON, 'the honest reason exists as its own constant');
ok(!/read-only/i.test(REASON) && !/Preview/.test(REASON),
  'and it does not borrow the read-only preview sentence, which is the whole defect');
ok(/Shift-click/.test(REASON) && /Ctrl\/Cmd\+A/.test(REASON),
  'it names the two things that DO select, since the checkbox still will not');
ok(/does not select the group yet/.test(REASON),
  'and states the narrow, true fact: this ONE control, not selection generally');

/* ---- 2. The guard passes it through, rather than the generic default ---- */

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

const guard = grabFunc('_prodGuardGroupSelection');
ok(/_prodReadonlyGuard\(PROD_GROUP_SELECT_UNSUPPORTED\);/.test(guard),
  '_prodGuardGroupSelection passes the specific reason, not the bare preview default');
ok(/return false;/.test(guard),
  'and the behavior is UNCHANGED -- it still refuses to select. This pass fixes what it says, not what it does');

/* ---- 3. The render site's tip matches what the click will actually say -- */
/* THE TRAP a copy-only fix can still get wrong: fixing the click handler but
   leaving the HOVER tooltip on the old sentence would mean hovering and
   clicking disagree, which is its own small dishonesty. */

const groupsFn = grabFunc('_prodGroupsFor');
const listFn = (() => {
  // The render site lives in the list function that maps groups to markup;
  // search the whole file rather than one function, since group rendering
  // is not itself named _prodGroupsFor.
  const at = INDEX.indexOf('data-prod-group-check');
  return INDEX.slice(Math.max(0, at - 400), at + 400);
})();
ok(/data-prod-tip="' \+ _calEscAttr\(PROD_GROUP_SELECT_UNSUPPORTED\) \+ '"/.test(listFn),
  'the hover tip on the checkbox itself uses the SAME constant the click handler uses, so hover and click agree');
ok(!/data-prod-tip="' \+ _prodPreviewText\(\) \+ '"><\/span><span class="prod-group-ico/.test(INDEX),
  'and the old generic preview-text tip is gone from this specific render site');

console.log(failures === 0
  ? '\nProduction group-select honesty checks passed'
  : '\n' + failures + ' group-select honesty check(s) failed');
process.exit(failures === 0 ? 0 : 1);
