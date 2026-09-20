'use strict';

/*
 * A NATIVE CARD (OR A SYNTHESIZED BATCH PARENT) IS A VALID PARENT TO ATTACH TO.
 *
 * _prodCreateParents builds the parent-issue picker for the create/recovery
 * dialog. It filtered candidates on `issue.raw.linear_issue_uuid` being
 * truthy -- but a genuinely native row has no Linear identity at all (that is
 * the whole point of PR #1444), and the synthetic batch-parent node
 * _prodResolveBatchParentNodes mints for a native batch carries `raw:
 * node.batch` (a batches row), which has no `linear_issue_uuid` column
 * either. Both shapes are perfectly valid cards to attach a sub-issue to, and
 * both were silently excluded from the picker by this one clause.
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

// The filter must NOT reference the UUID column at all any more.
const fnSource = extractFunction('_prodCreateParents');
ok(!/linear_issue_uuid/.test(fnSource),
  '_prodCreateParents no longer excludes candidates on linear_issue_uuid presence');

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
  {
    id: 'native-root', title: 'Native Root Card', parent: null, project: 'alpha', team: 'video',
    raw: { linear_issue_uuid: '' }
  },
  // A synthesized batch-parent node minted for a fully native batch (#1444):
  // raw is the BATCH row, which has no linear_issue_uuid column at all.
  {
    id: 'native-batch-parent', title: 'Native Batch Parent', parent: null, project: 'alpha', team: 'video',
    syntheticBatchParent: true, raw: { id: 'bat_1', name: 'Native Batch Parent' }
  },
  // An ordinary Linear-imported root, for contrast -- must still qualify.
  {
    id: 'linear-root', title: 'Linear Root Card', parent: null, project: 'alpha', team: 'video',
    raw: { linear_issue_uuid: 'lin-uuid-1' }
  },
  // Excluded for reasons OTHER than the UUID clause, to prove those still work.
  { id: 'has-parent', title: 'Already A Child', parent: 'native-root', project: 'alpha', team: 'video', raw: {} },
  { id: 'wrong-project', title: 'Wrong Client', parent: null, project: 'beta', team: 'video', raw: {} },
  { id: 'wrong-team', title: 'Wrong Team', parent: null, project: 'alpha', team: 'graphics', raw: {} },
];

sandbox.__ISSUES = ISSUES;
sandbox._prodIssues = () => sandbox.__ISSUES;
sandbox._prodAttributionResolved = issue => true;

const draft = { clientSlug: 'alpha', team: 'video' };
const parents = sandbox.createParents(draft);
const ids = parents.map(p => p.id).sort();

ok(ids.includes('native-root'),
  'a genuinely native card (no Linear identity at all) is offered as a selectable parent');
ok(ids.includes('native-batch-parent'),
  'a synthesized native batch-parent node is offered as a selectable parent');
ok(ids.includes('linear-root'),
  'an ordinary Linear-backed card is still offered as a selectable parent');
ok(!ids.includes('has-parent'), 'a row that is already a child is still excluded');
ok(!ids.includes('wrong-project'), 'a row for a different client is still excluded');
ok(!ids.includes('wrong-team'), 'a row for a different team is still excluded');
ok(ids.length === 3, 'exactly the three eligible roots are offered, nothing more (' + ids.join(',') + ')');

// Attribution must still gate the picker -- removing the UUID clause did not
// also remove the attribution-resolved requirement.
sandbox._prodAttributionResolved = issue => issue.id !== 'native-root';
const withoutAttribution = sandbox.createParents(draft).map(p => p.id);
ok(!withoutAttribution.includes('native-root'),
  'an unresolved-attribution row is still excluded regardless of its Linear identity');

console.log(failures ? '\nFAILED ' + failures : '\nall ok');
process.exit(failures ? 1 : 0);
