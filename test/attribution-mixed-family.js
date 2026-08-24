'use strict';

/*
 * A parent does not out-vote a child that already knows its own answer.
 *
 * One person can be three clients here — a personal brand, a paid-ads brand and
 * a DJ brand, three roster rows and three Linear projects. A manager planning a
 * week for that person files ONE parent with children across two of them. That
 * is a legitimate way to work, and every child in it carries its own project, so
 * nothing about it is ambiguous.
 *
 * The old rule read the disagreement between parent and child as a conflict, and
 * the propagation fixpoint then spread it to every relative. Measured on live
 * data before this change: a family of 11 was entirely `conflict`, and writes are
 * gated on attribution being `resolved` — so seven videos sitting in the client
 * approval queue, plus one already overdue, could not be advanced from SyncView
 * at all. Across the whole projection, 29 rows were conflicted; 25 of them were
 * this, and the change moves exactly those 25 to `resolved` with ZERO rows made
 * worse and ZERO rows re-attributed to a different client.
 *
 * The conflict this gives up was never protecting anything: if a child really is
 * filed in the wrong project it is mis-attributed either way, and consulting its
 * parent cannot fix that. All the rule added was ten more unusable rows beside
 * it.
 *
 * What must SURVIVE is the case the rule was actually built for — a child with no
 * project of its own, which has to be read from the family. That one still
 * conflicts, and the last two cases here pin it.
 *
 * The webhook path settled the same question the same way one day earlier
 * (`own_project_outranks_parent`, linear-inbound). This is the browser catching up.
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

// Comment-aware: the block this lifts carries prose with quote characters in it.
function extractFunction(name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('missing ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    const char = source[i], next = source[i + 1];
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

const sandbox = { Map, Set, String, Array, Object, JSON, Boolean, RegExp };
vm.createContext(sandbox);
for (const name of ['_prodHasOwn', '_prodLinearRaw', '_prodConfiguredProjectIds', '_prodRawProjectId', '_prodRawAttribution', '_prodResolveAttributions']) {
  vm.runInContext(extractFunction(name), sandbox);
}
vm.runInContext('this.resolve = _prodResolveAttributions;', sandbox);
const resolve = sandbox.resolve;

const BRAND_A = 'project-brand-a';
const BRAND_B = 'project-brand-b';
const CLIENTS = [
  { slug: 'brand-a', active: true, kind: 'client', linear_project_ids: [BRAND_A] },
  { slug: 'brand-b', active: true, kind: 'client', linear_project_ids: [BRAND_B] },
];

function row(id, projectId, extra) {
  return Object.assign({
    id,
    linear_issue_uuid: 'uuid-' + id,
    client_slug: 'brand-a',
    raw_project_id: projectId,
    raw_attribution_schema: 'syncview_attribution_v1',
    raw_attribution_state: 'resolved',
    raw_attribution_source: 'direct_project',
    raw_attribution_client_slug: projectId === BRAND_A ? 'brand-a' : 'brand-b',
  }, extra || {});
}

// One parent on brand A; children split across brand A and brand B, each with
// its OWN project. This is the live shape that froze 11 rows.
const parent = row('parent', BRAND_A);
const kids = [
  row('a1', BRAND_A), row('a2', BRAND_A), row('a3', BRAND_A),
  row('b1', BRAND_B), row('b2', BRAND_B),
];
const links = new Map(kids.map(k => [k.id, 'parent']));
const mixed = resolve([parent].concat(kids), CLIENTS, links);

ok([...mixed.values()].every(a => a.state === 'resolved'),
  'a parent whose children span two brands is not a conflict — every row resolves');
ok(mixed.get('a1').clientSlug === 'brand-a' && mixed.get('b1').clientSlug === 'brand-b',
  'and each child lands on the client ITS OWN project names, not the parent\'s');
ok(mixed.get('parent').clientSlug === 'brand-a',
  'the parent keeps the client its own project names — a container does not inherit from its contents');
ok([...mixed.values()].every(a => a.reason !== 'hierarchy_conflict_propagated'),
  'nothing is poisoned by a relative');

// The whole point: writes are gated on `resolved`, so this is what was lost.
ok(mixed.get('b1').state === 'resolved' && mixed.get('a3').state === 'resolved',
  'both sides of the family are writable — approvals and deadlines work again');

// --- what must still propagate ----------------------------------------------
/*
 * This is the case that separates the fix from simply switching propagation off,
 * and it has to be built carefully. An earlier version of this suite used a
 * projectless child with a contradicting stored slug — but that row conflicts in
 * the PERSISTED branch, long before the family loop runs, so the assertion passed
 * without ever exercising the thing it claimed to test. Three mutations survived
 * it. What follows drives the propagation loop itself:
 *
 *   pConf     — conflicted by its own STORED state, so the conflict does not
 *               come from the project walk and can only reach the children by
 *               propagation.
 *   cSelf     — has its own project. Must SURVIVE: a relative's problem is not
 *               its problem.
 *   cInherit  — has no project of its own, so its client was read FROM the
 *               family. When the family is broken, so is it. Must CONFLICT.
 */
const pConf = row('pConf', BRAND_A, { raw_attribution_state: 'conflict', raw_attribution_reason: 'persisted_attribution_conflict' });
const cSelf = row('cSelf', BRAND_B);
const cInherit = {
  id: 'cInherit',
  linear_issue_uuid: 'uuid-cInherit',
  client_slug: 'brand-a',
  raw_project_id: '',
};
const propagated = resolve([pConf, cSelf, cInherit], CLIENTS,
  new Map([['cSelf', 'pConf'], ['cInherit', 'pConf']]));

ok(propagated.get('pConf').state === 'conflict',
  'a parent conflicted on its own stored state stays conflicted');
ok(propagated.get('cInherit').state === 'conflict',
  'a child that READ its client from the family conflicts with the family — propagation still works');
ok(propagated.get('cSelf').state === 'resolved' && propagated.get('cSelf').clientSlug === 'brand-b',
  'but a child with its OWN project survives a conflicted parent — that is the whole change');

// A project mapped to two different active clients is a roster problem and must
// stay loud — it is not a mixed family, it is an unanswerable question.
const AMBIGUOUS = 'project-owned-twice';
const doubleMapped = [
  { slug: 'brand-a', active: true, kind: 'client', linear_project_ids: [AMBIGUOUS] },
  { slug: 'brand-b', active: true, kind: 'client', linear_project_ids: [AMBIGUOUS] },
];
// A bare row (no stored attribution yet) on that project is the case the
// `project_mapping_conflict` verdict exists for, and it must survive untouched.
// Note the row that ALREADY carries a stored resolution behaves differently and
// always has: it comes out `needs_attribution`, not `conflict`. Both readings
// were checked against the pre-change file and neither moves — this change
// touches only the parent/child propagation, never how a single row is judged.
const ambiguous = resolve([{ id: 'x1', raw_project_id: AMBIGUOUS }], doubleMapped, new Map());
ok(ambiguous.get('x1').state === 'conflict' && ambiguous.get('x1').reason === 'project_mapping_conflict',
  'a project mapped to two active clients still conflicts — nothing here can answer that');

if (failures) {
  console.error('\n' + failures + ' mixed-family attribution check(s) failed');
  process.exit(1);
}
console.log('\nMixed-family attribution checks passed');
