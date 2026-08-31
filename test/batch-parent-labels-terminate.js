'use strict';
/*
 * The batch-parent detail view hard-froze the tab on load.
 *
 * Round-3 tester, 2026-08-31 (PR #1186). 100% reproducible on two independent
 * batches, cold load and same-tab navigation alike.
 *
 * `_prodRender` calls `_prodEnsureLabels` on every render. The synthetic
 * batch-parent branch — shipped the same morning to stop that control claiming
 * a transient read failure — sat ABOVE the shared memo guard
 * (`if (!force && current) return current;`) and called
 * `_prodRefreshLabelSurfaces` unconditionally. That calls `_prodRender`, which
 * calls `_prodEnsureLabels`, which re-enters the same branch: infinite
 * synchronous recursion with no termination check. `_prodSubIssueRowHTML`
 * appeared twice in the tester's crash stack.
 *
 * It took the whole asset spec down with it — the parent asset panel and the
 * file pills are on that view — so §2a and §2d could not be exercised at all.
 *
 * THE FIX IS A MEMO CHECK INSIDE THE BRANCH, not a move below the shared one.
 * Below the shared guard sits the `writes` check and the staff-identity read,
 * and a synthetic batch parent must reach neither: it has no deliverable row to
 * write to and no identity question to ask. Re-rendering ONCE when the state is
 * first settled is correct and necessary — that is what replaces "Loading
 * labels…" with "No labels". Re-rendering when it is already settled is the
 * defect.
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

function grabFunc(name, kind) {
  const at = INDEX.indexOf((kind || 'function ') + name + '(');
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

/* ---- 1. It TERMINATES, executed against the real recursion edge ---------- */
/* The whole defect is a loop, so this runs the real function with the real
   cycle wired up: refreshing label surfaces re-enters ensureLabels exactly as
   _prodRender does in the browser. Before the fix this recurses until the stack
   blows; a source-only assertion could not have told the difference. */
{
  const labels = new Map();
  let renders = 0;
  let blewUp = false;
  const ctx = {
    _prodIssue: () => ({ id: 'bat_1', syntheticBatchParent: true }),
    _prodLabelState: id => labels.get(id) || null,
    _prodState: { labels, writes: new Set() },
    _syncviewStaffIdentityForHeaders: () => null,
    _prodRefreshLabelSurfaces: (id) => {
      renders++;
      if (renders > 50) { blewUp = true; return; }
      // This is _prodRender's edge: it calls back into ensureLabels.
      ctx.ensure(id, false);
    },
  };
  vm.createContext(ctx);
  vm.runInContext(grabFunc('_prodEnsureLabels', 'async function ') + '\nthis.ensure = _prodEnsureLabels;', ctx);

  ctx.ensure('bat_1', false);
  ok(!blewUp, 'a synthetic batch parent SETTLES instead of recursing -- this is the freeze, executed');
  ok(renders === 1,
    'and it repaints exactly ONCE (saw ' + renders + '): the first settle replaces "Loading labels" with '
    + '"No labels", and every later render must be a no-op');

  const state = labels.get('bat_1');
  ok(state && state.status === 'ready' && state.structural === true && state.complete === true,
    'the settled state is still the honest one -- ready, structural, no Retry to offer');
  ok(state && Array.isArray(state.catalog) && state.catalog.length === 0,
    '...with an empty catalog, because a batch parent has no Linear issue to carry labels');

  // A forced re-read must still repaint, or the Retry path elsewhere goes dead.
  renders = 0;
  ctx.ensure('bat_1', true);
  ok(renders === 1, 'and force:true still repaints, so an explicit refresh is not swallowed by the guard');
}

/* ---- 2. The guard is FIRST, and inside the branch ------------------------ */

const ensure = grabFunc('_prodEnsureLabels', 'async function ');
const branchAt = ensure.indexOf("if (issue.syntheticBatchParent === true) {");
const guardAt = ensure.indexOf("if (!force && current && current.structural === true) return current;");
const setAt = ensure.indexOf('_prodState.labels.set(id, state);');
const refreshAt = ensure.indexOf('_prodRefreshLabelSurfaces(id);');

ok(branchAt > 0 && guardAt > branchAt, 'the memo check lives INSIDE the synthetic-parent branch');
ok(guardAt < setAt && guardAt < refreshAt,
  '...and runs BEFORE the state write and the repaint, which is the entire fix');

const sharedGuardAt = ensure.indexOf("if (!force && current) return current;");
const writesAt = ensure.indexOf("_prodState.writes.has(id + ':labels')");
const identityAt = ensure.indexOf('_syncviewStaffIdentityForHeaders()');
ok(sharedGuardAt > branchAt && writesAt > branchAt && identityAt > branchAt,
  'the branch still returns before the writes check and the staff-identity read: a batch parent has no '
  + 'deliverable row to write to and no identity question to ask, which is why it is not simply moved below them');

/* ---- 3. The edge that made it a loop is still there --------------------- */
/* Not a regression risk to remove -- it is what makes the panel update at all.
   Asserted so a later reader understands the guard is load-bearing rather than
   defensive. */
ok(/function _prodRefreshLabelSurfaces\(id\) \{\s*\n\s*if \(document\.getElementById\('prodRoot'\)\) _prodRender\(\);/.test(INDEX),
  'refreshing label surfaces still calls _prodRender -- the cycle is real, and the guard is what breaks it');

console.log(failures === 0
  ? '\nBatch-parent label termination checks passed'
  : '\n' + failures + ' termination check(s) failed');
process.exit(failures === 0 ? 0 : 1);
