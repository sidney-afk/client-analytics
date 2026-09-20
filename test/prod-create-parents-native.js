'use strict';

/*
 * A NATIVE CARD (OR A SYNTHESIZED BATCH PARENT) STAYS OUT OF THE CREATE
 * PICKER UNTIL THE GATEWAY CAN ROUTE TO ONE.
 *
 * A first version of this fix dropped _prodCreateParents' `linear_issue_uuid`
 * clause, reading it as the same native-card exclusion PR #1444 removed
 * elsewhere. Codex review on PR #1447 caught that it is not the same thing:
 * `productionCreateParentRoute` (supabase/functions/production-write/index.ts)
 * resolves `parent_id` ONLY against the `deliverables` table and requires
 * `parentLinearIssueId(parent)` -- `linear_issue_uuid`, with no native
 * fallback -- to be non-empty. A synthesized batch-parent node's id is a
 * BATCH id, not a deliverable id at all, so the gateway would answer
 * `create_parent_not_found`; a genuinely native deliverable has no Linear
 * issue id, so it would answer `production_create_parent_scope`. Offering
 * either in the picker is only safe once the gateway can route to them too --
 * backend work no `index.html`-only change can do. This suite pins the
 * corrected (reverted) behavior: the clause stays, and BOTH native shapes
 * stay excluded, alongside every other exclusion reason already proven here.
 *
 * Executes the real _prodCreateParents (and the real _prodWriteTeam,
 * _prodIssueLabel it calls) out of the shipped file; a source scan would pass
 * on a comment that never runs.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (comment === 'line') { if (char === '\n') comment = ''; continue; }
    if (comment === 'block') { if (char === '*' && next === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { comment = 'line'; i++; continue; }
    if (char === '/' && next === '*') { comment = 'block'; i++; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

// The filter must still reference the UUID column -- that is the whole fix.
const fnSource = extractFunction('_prodCreateParents');
ok(/linear_issue_uuid/.test(fnSource),
  '_prodCreateParents still excludes candidates the gateway cannot route a create to (no linear_issue_uuid)');

const sandbox = { String, Array, Object };
vm.createContext(sandbox);
vm.runInContext(
  extractFunction('_prodWriteTeam') + '\n' +
  extractFunction('_prodIssueLabel') + '\n' +
  fnSource + '\n' +
  'this.createParents = _prodCreateParents;',
  sandbox
);

const ISSUES = [
  // A genuinely native, Linear-identity-less deliverable row with no parent.
  // productionCreateParentRoute would answer production_create_parent_scope.
  {
    id: 'native-root', title: 'Native Root Card', parent: null, project: 'alpha', team: 'video',
    raw: { linear_issue_uuid: '' }
  },
  // A synthesized batch-parent node minted for a fully native batch (#1444):
  // raw is the BATCH row, which has no linear_issue_uuid column at all, and
  // its id is a batch id -- productionCreateParentRoute's deliverables lookup
  // would answer create_parent_not_found.
  {
    id: 'native-batch-parent', title: 'Native Batch Parent', parent: null, project: 'alpha', team: 'video',
    syntheticBatchParent: true, raw: { id: 'bat_1', name: 'Native Batch Parent' }
  },
  // An ordinary Linear-imported root -- the gateway CAN route to this one.
  {
    id: 'linear-root', title: 'Linear Root Card', parent: null, project: 'alpha', team: 'video',
    raw: { linear_issue_uuid: 'lin-uuid-1' }
  },
  // Excluded for reasons OTHER than the UUID clause, to prove those still work.
  { id: 'has-parent', title: 'Already A Child', parent: 'native-root', project: 'alpha', team: 'video', raw: { linear_issue_uuid: 'lin-uuid-2' } },
  { id: 'wrong-project', title: 'Wrong Client', parent: null, project: 'beta', team: 'video', raw: { linear_issue_uuid: 'lin-uuid-3' } },
  { id: 'wrong-team', title: 'Wrong Team', parent: null, project: 'alpha', team: 'graphics', raw: { linear_issue_uuid: 'lin-uuid-4' } },
];

sandbox.__ISSUES = ISSUES;
sandbox._prodIssues = () => sandbox.__ISSUES;
sandbox._prodAttributionResolved = issue => true;

const draft = { clientSlug: 'alpha', team: 'video' };
const parents = sandbox.createParents(draft);
const ids = parents.map(p => p.id).sort();

ok(!ids.includes('native-root'),
  'a genuinely native card (no Linear identity at all) stays excluded -- the gateway cannot route a create to it');
ok(!ids.includes('native-batch-parent'),
  'a synthesized native batch-parent node stays excluded -- its id is a batch id, not a deliverable id the gateway can find');
ok(ids.includes('linear-root'),
  'an ordinary Linear-backed card the gateway CAN route to is still offered as a selectable parent');
ok(!ids.includes('has-parent'), 'a row that is already a child is still excluded');
ok(!ids.includes('wrong-project'), 'a row for a different client is still excluded');
ok(!ids.includes('wrong-team'), 'a row for a different team is still excluded');
ok(ids.length === 1 && ids[0] === 'linear-root',
  'exactly the one gateway-routable root is offered, nothing more (' + ids.join(',') + ')');

// Attribution must still gate the picker independently of the UUID clause.
sandbox._prodAttributionResolved = issue => issue.id !== 'linear-root';
const withoutAttribution = sandbox.createParents(draft).map(p => p.id);
ok(!withoutAttribution.includes('linear-root'),
  'an unresolved-attribution row is still excluded regardless of its Linear identity');

// The synthesized node is LABELLED as a post, not as its raw batch id. Owner,
// 2026-09-20 cutoff-day pass: "the batch ID is super long ... I don't know if
// that's normal". A label only: _prodIssue() resolves by id/displayId and no
// deep link is built from it, so nothing that routes to the node changes.
{
  const labelSrc = source.slice(source.indexOf('function _prodIssueLabel('),
    source.indexOf('function _prodIssueIdHTML('));
  ok(labelSrc.length > 0 && /function _prodIssueDisplayLabel\(/.test(labelSrc),
    'both label helpers extract (harness is not vacuous)');
  const SYN = { id: 'bat_00000000-0000-4000-8000-0000000000aa', syntheticBatchParent: true };
  const display = new Function('d', labelSrc + '\nreturn _prodIssueDisplayLabel(d);');
  const identity = new Function('d', labelSrc + '\nreturn _prodIssueLabel(d);');
  ok(display(SYN) === 'Post',
    'a synthetic batch-parent node DISPLAYS as "Post", never its raw bat_ id');
  ok(identity(SYN) === SYN.id,
    'but its IDENTITY label is still the batch id -- Copy issue ID, palette search and sort keys keep the real value (Codex P1 on #1455)');
  ok(display({ id: 'del_x', displayId: 'VID-9001' }) === 'VID-9001',
    'an ordinary card still shows its identifier');
  ok(display({ id: 'del_y' }) === 'del_y',
    'an unminted native card still falls through to its id (the mint is the fix for that one)');
  // The three presentation sites use the display helper; the identity sites do not.
  ok(/const label = _prodIssueDisplayLabel\(d\);/.test(source), 'the list id cell renders the display label');
  ok(/prod-detail-id">' \+ _calEsc\(_prodIssueDisplayLabel\(d\)\)/.test(source), 'the detail header renders the display label');
  ok(/'<b>' \+ _calEsc\(_prodIssueDisplayLabel\(d\)\) \+ '<\/b>'/.test(source), 'the breadcrumb renders the display label');
  const copySrc = source.slice(source.indexOf('function _prodCopyIssueIds('), source.indexOf('function _prodCopyIssueIds(') + 1500);
  ok(!/_prodIssueDisplayLabel/.test(copySrc), 'Copy issue ID never copies the display label');
}

console.log(failures ? '\nFAILED ' + failures : '\nall ok');
process.exit(failures ? 1 : 0);
