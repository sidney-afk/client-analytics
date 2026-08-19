'use strict';
/*
 * Multi-select parity across the three Production surfaces that render rows.
 *
 * The Issues list has always offered the hover checkbox and the selection
 * action bar. The project view and a parent issue sub-issue list render rows
 * too, and both grew the same hover checkbox -- but a checkbox with no action
 * bar is worse than no checkbox at all: rows appear selectable and nothing
 * happens. The detail view shipped in exactly that half state, so the bar is
 * pinned here per surface rather than left to the browser lanes.
 */

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(value, label) {
  if (value) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// --- the action bar reaches every surface that renders selectable rows -----
const detail = extract('_prodDetail');
const projectDetail = extract('_prodProjectDetail');

ok(detail.includes('_prodSelectionBar()'),
'a parent issue detail view renders the selection action bar for its sub-issues');
ok(projectDetail.includes('_prodSelectionBar()'),
'a project view renders the selection action bar for its issues');

// The detail view only renders the sub-issue section for a top-level issue,
// so the bar has to hang off the returned markup rather than the section.
ok(/\+ _prodSelectionBar\(\);/.test(detail) && detail.indexOf('_prodSelectionBar()') > detail.indexOf('aside class="prod-right"'),
'the detail action bar is appended to the view, not nested inside the sub-issue section');

// --- rows carry the hover checkbox on every surface -----------------------
const subRow = extract('_prodSubIssueRowHTML');
const projectRow = extract('_prodProjectIssueRowHTML');

ok(subRow.includes('prod-check'),
'sub-issue rows carry the hover selection checkbox');
ok(projectRow.includes('prod-check'),
'project issue rows carry the hover selection checkbox');

// --- selection reconciliation knows about the non-list surfaces -----------
// A selection that survives a view change must be pruned against the rows the
// new view actually shows, or the bar reports a count for invisible rows.
const reconcile = extract('_prodReconcileSelection');
ok(reconcile.includes('openProjectId') || reconcile.includes('_prodProjectAllRows'),
'selection reconciliation accounts for the project view rows');
ok(reconcile.includes('_prodChildrenOf'),
'selection reconciliation accounts for sub-issue rows in the detail view');

if (failures) process.exit(1);
console.log('\nProduction multi-select parity checks passed');
