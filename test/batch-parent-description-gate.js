'use strict';
/*
 * A post's own description can actually be saved on its batch parent.
 *
 * OWNER REPORT, 2026-09-01, relaying his SMM: the new description he typed on
 * a batch parent "isn't saving". The screen showed ~10,000 characters of
 * Markdown, a Save button, and one red line under it: "This change is not
 * allowed on this issue." Nothing about the row was wrong, and nothing he
 * could do would have helped.
 *
 * ONE WRITE, THREE NAMES. #1203 shipped the batch-parent description write
 * that same morning. A batch parent writes the POST's text onto the batch row
 * through `batch_description`; every other row writes its own brief through
 * `description`. Three places had to agree on which name this row uses:
 *
 *   1. the gate on the Edit control        -> hardcoded 'description'
 *   2. the write itself                    -> 'batch_description'
 *   3. the sentence shown on a refusal     -> hardcoded 'description'
 *
 * So on a batch parent the Edit button rendered ENABLED (1 passes), the write
 * was refused by its own gate (2 hits `operation !== 'description'` in
 * `_prodCanWrite` and returns false), and the explanation was computed for the
 * OTHER operation (3), which the gate happily approved -- returning an empty
 * string, which falls through to the last-resort sentence above. The feature
 * was unusable from the hour it merged, and the one message it produced was the
 * one message that carries no information.
 *
 * The three now derive the name from the row, once, so they cannot drift again.
 * This file executes the REAL gates rather than describing them.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const POLICY_SRC = fs.readFileSync(
  path.join(ROOT, 'supabase/functions/production-write/policy.mjs'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(source, name) {
  const at = source.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = source.indexOf('{', at); j < source.length; j++) {
    const c = source[j], next = source[j + 1];
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
    else if (c === '}') { depth--; if (depth === 0) return source.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* The real gates, lifted out of the page and run against fakes. Only identity
   and page state are stubbed; every decision below is the shipped code. */
const REAL = [
  '_prodDescriptionOperation', '_prodIsDescriptionOperation',
  '_prodCanWrite', '_prodWriteGateText', '_prodRoleCanWrite', '_prodRoleGateText',
  '_prodIdentityRepairGateText', '_prodAttributionResolved', '_prodAttributionGateText',
  '_prodWriteTeam', '_prodTeamLabel', '_prodCreativeOwnsTarget', '_prodCreativeNextStatuses',
].map(name => grabFunc(INDEX, name)).join('\n');

function makeGates(role, memberTeam, authority) {
  const src = `
    const PROD_CREATIVE_ASSIGNEE_BOUND_OPERATIONS = ['status'];
    const _prodState = { authorityLoaded: true, authority: ${JSON.stringify(authority)} };
    function _syncviewStaffIdentityForHeaders() {
      return { role: ${JSON.stringify(role)}, member: { id: 'm1', team: ${JSON.stringify(memberTeam)} } };
    }
    function _prodIssue() { return null; }
    function _prodStatusOptions() { return []; }
    ${REAL}
    return {
      op: _prodDescriptionOperation,
      canWrite: _prodCanWrite,
      gateText: _prodWriteGateText,
      roleCanWrite: _prodRoleCanWrite,
    };
  `;
  return new Function(src)();
}

const AUTHORITY = { video: 'syncview', graphics: 'syncview' };
const RESOLVED = { state: 'resolved', clientSlug: 'acme', provisionalClientSlug: '', repairRequired: false, reason: '' };
const batchParent = () => ({
  id: 'b1_b_x', team: 'video', syntheticBatchParent: true,
  attribution: RESOLVED, identityRepair: null,
});
const subIssue = () => ({
  id: 'del_x', team: 'video', syntheticBatchParent: false,
  attribution: RESOLVED, identityRepair: null,
});

/* ---- 1. THE REPORTED FAILURE ------------------------------------------- */

{
  const g = makeGates('smm', '', AUTHORITY);
  const parent = batchParent();
  ok(g.op(parent) === 'batch_description',
    'a batch parent names its description write `batch_description` -- the operation the gateway actually receives');
  ok(g.op(subIssue()) === 'description',
    'and every other row still names it `description`, so no sub-issue write changed');
  ok(g.canWrite(parent, g.op(parent)) === true,
    'THE REPORT: an SMM may now save a batch parent description -- the gate no longer refuses the one operation the feature performs');
  ok(g.gateText(parent, g.op(parent)) === '',
    'and the gate agrees there is nothing to explain, which is what makes the refusal sentence unreachable rather than merely nicer');
}

/* The exact broken triple, asserted as a PROPERTY rather than a spelling: for
   every row shape, the gate consulted for the control, the gate consulted for
   the write, and the gate consulted for the message must be the same call. */
{
  const g = makeGates('smm', '', AUTHORITY);
  [batchParent(), subIssue()].forEach(issue => {
    const op = g.op(issue);
    const allowed = g.canWrite(issue, op);
    const text = g.gateText(issue, op);
    ok(allowed === (text === ''),
      (issue.syntheticBatchParent ? 'batch parent' : 'sub-issue')
        + ': the gate and its explanation cannot disagree -- an allowed write has no sentence, a refused one always has');
  });
}

/* ---- 2. The old bug, stated so it cannot come back --------------------- */

ok(!/syntheticBatchParent === true && operation !== 'description'/.test(INDEX),
  'no gate clause compares the operation to the single spelling `description` any more -- that comparison IS the bug');
ok((INDEX.match(/_prodDescriptionOperation\(issue\)/g) || []).length >= 6,
  'every description call site derives the operation from the row instead of hardcoding one');
ok(!/_prodWriteErrorText\(error, issue, 'description'\)/.test(INDEX),
  "the refusal text is no longer computed with a name the write may not have used");
ok(!/_prodWriteGateAttrs\(issue, 'description',/.test(INDEX),
  'and neither is the Edit control gate, which is what rendered an enabled button for a refused write');

/* ---- 3. The widened gate did not widen the PERMISSION ------------------ */

{
  const g = makeGates('creative', 'video', AUTHORITY);
  const parent = batchParent();
  ok(g.roleCanWrite(parent, 'batch_description') === false,
    'a CREATIVE still cannot write a post description -- descriptions are admin/SMM everywhere in the estate');
  ok(g.canWrite(parent, g.op(parent)) === false && g.gateText(parent, g.op(parent)) !== '',
    'and is refused with a reason rather than silently, now that the gate is reachable at all');
  ok(g.roleCanWrite(parent, 'batch_asset') === true,
    'while `batch_asset` is unchanged -- a shoot folder is shared work, a description is not');
}
/* The browser must refuse exactly what the gateway refuses. staffOperationAllowed
   returns false for batch_description before any team match; the browser said
   `!!memberTeam` for it, which was true for every rostered creative. That
   mismatch was masked while the parent gate refused everyone -- fixing the gate
   made it reachable, so it is corrected in the same change. */
ok(/if \(op === "batch_description"\) return false;/.test(POLICY_SRC),
  'the gateway refuses batch_description for creatives');
ok(/if \(operation === 'batch_description'\) return false;/.test(INDEX),
  'and the browser now refuses it in the same place, so no creative sees an Edit button the gateway would reject');
/* Narrowly the ROLE-GATE line. The same pair of names still appears in
   _prodGatewayWrite, where it retargets the write onto the batch row -- that
   one is correct and must stay, so this asserts the gate that returned a
   PERMISSION for both, not every mention of the two operations. */
ok(!/batch_asset' \|\| operation === 'batch_description'\) return !!memberTeam;/.test(INDEX),
  'the role gate no longer returns one permission for both -- that line is gone, not left beside its replacement');
ok(/if \(operation === 'batch_asset' \|\| operation === 'batch_description'\) \{/.test(INDEX),
  'while the write RETARGET still names both, because both do write the batch row rather than the deliverable');

/* ---- 4. Everything else on a batch parent stays closed ----------------- */

{
  const g = makeGates('admin', '', AUTHORITY);
  const parent = batchParent();
  ['status', 'due', 'assignee', 'attachment', 'comment', 'batch_asset'].forEach(op => {
    ok(g.canWrite(parent, op) === false,
      'a batch parent still refuses `' + op + '` -- it is not a deliverable and the gateway has no row to write');
  });
  ok(/open its sub-issues to work on it/.test(g.gateText(parent, 'status')),
    'and still says why, naming the sub-issues, rather than falling through to a generic refusal');
}

console.log(failures === 0
  ? '\nbatch parent description gate checks passed'
  : '\n' + failures + ' batch parent description check(s) failed');
process.exit(failures === 0 ? 0 : 1);
