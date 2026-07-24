'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
let failures = 0;

function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function extractFunction(name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

const sandbox = { Map, Set, String, Array };
vm.createContext(sandbox);
vm.runInContext(
  extractFunction('_prodResolveParentLinks')
    + '\nthis.resolveParentLinks = _prodResolveParentLinks;',
  sandbox,
);

const rows = [
  {
    id: 'true-parent',
    linear_issue_uuid: 'linear-parent',
    batch_id: 'parent-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Real parent issue',
  },
  {
    id: 'title-matched-sibling',
    linear_issue_uuid: 'linear-child-1',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Creation Batch',
  },
  {
    id: 'cross-team-sibling',
    linear_issue_uuid: 'linear-child-2',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'graphics',
    title: 'TEST 2',
  },
  {
    id: 'cross-client-sibling',
    linear_issue_uuid: 'linear-child-3',
    raw_issue_parent_id: 'linear-parent',
    batch_id: 'creation-batch',
    client_slug: 'beta',
    team: 'video',
    title: 'TEST 3',
  },
  {
    id: 'grandchild',
    linear_issue_uuid: 'linear-grandchild',
    raw_issue_parent_id: 'linear-child-1',
    batch_id: 'third-level-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Nested work',
  },
  {
    id: 'same-batch-root',
    linear_issue_uuid: 'linear-root',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Ordinary root',
  },
  {
    id: 'unresolved-parent',
    linear_issue_uuid: 'linear-orphan',
    raw_issue_parent_id: 'linear-missing',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Visible orphan',
  },
  {
    id: 'self-parent',
    linear_issue_uuid: 'linear-self',
    raw_issue_parent_id: 'linear-self',
    batch_id: 'creation-batch',
    client_slug: 'alpha',
    team: 'video',
    title: 'Malformed self link',
  },
  {
    id: 'duplicate-parent-a',
    linear_issue_uuid: 'linear-duplicate',
  },
  {
    id: 'duplicate-parent-b',
    linear_issue_uuid: 'linear-duplicate',
  },
  {
    id: 'duplicate-parent-child',
    linear_issue_uuid: 'linear-duplicate-child',
    raw_issue_parent_id: 'linear-duplicate',
  },
  {
    id: 'cycle-a',
    linear_issue_uuid: 'linear-cycle-a',
    raw_issue_parent_id: 'linear-cycle-b',
  },
  {
    id: 'cycle-b',
    linear_issue_uuid: 'linear-cycle-b',
    raw_issue_parent_id: 'linear-cycle-a',
  },
];

const links = sandbox.resolveParentLinks(rows);
ok(links.get('title-matched-sibling') === 'true-parent',
  'a title-matched child follows its real parent across creation batches');
ok(links.get('cross-team-sibling') === 'true-parent',
  'a real parent link is not constrained by team');
ok(links.get('cross-client-sibling') === 'true-parent',
  'a real parent link is not constrained by client');
ok(links.get('grandchild') === 'title-matched-sibling',
  'a valid three-level hierarchy preserves a child that is also a parent');
ok(!links.has('same-batch-root'),
  'an unparented batch-mate stays a root instead of becoming a sibling child');
ok(!links.has('unresolved-parent'),
  'a missing parent fails closed as a visible root');
ok(!links.has('self-parent'),
  'a self-parent link fails closed');
ok(!links.has('duplicate-parent-child'),
  'an ambiguous duplicate Linear parent fails closed');
ok(!links.has('cycle-a') && !links.has('cycle-b'),
  'a cyclic parent graph fails closed');

const adapter = extractFunction('_prodAdapter');
ok(/const parentLinks = _prodResolveParentLinks\(deliverables\)/.test(adapter)
  && /parent: parentLinks\.get\(String\(d\.id \|\| ''\)\) \|\| null/.test(adapter),
'the Production adapter consumes only resolved parent links');
ok(!/batchParent|batchTeamKey|_prodSameTitle|title[^;\n]+batch\.name/.test(adapter),
  'the Production adapter has no batch/title parent heuristic');
ok(/linear_issue_uuid/.test(source)
  && /production_deliverables_browser_v1/.test(source)
  && /raw_issue_parent_id,raw_project_id/.test(source)
  && /if \(!_prodBrowserProjectionMissing\(error\)\) throw error/.test(source),
'the safe lightweight Production projection carries stable Linear issue and parent UUIDs');

if (failures) {
  console.error('\nproduction-parent-link-hierarchy: ' + failures + ' check(s) failed');
  process.exit(1);
}
console.log('production-parent-link-hierarchy: true Linear parent links pinned');
