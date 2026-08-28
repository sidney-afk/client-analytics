'use strict';
/*
 * A CONTAINER'S DATE IS NOT ANYBODY'S LATE WORK (ledger item 50, display half).
 *
 * The B1 import records each Linear parent issue as a deliverable row of its
 * own. Measured 2026-08-27: 75 of 535 open deliverable rows are batch parents,
 * ~30 assigned to a person, 8 dated — and a dated parent rendered exactly like
 * late work: red calendar chip, red side row, "overdue by N days" in the
 * tooltip, for a row nobody can complete because it is not a task. One of them
 * had been "overdue" since February. The owner ruled (2026-08-27): containers
 * out of the overdue lanes.
 *
 * The repair is deliberately NOT removal. The Production tree resolves parent
 * NODES from these very rows (`_prodResolveParentLinks` maps children to
 * parents among deliverable rows only), so dropping them from the projection
 * would orphan every imported child under them — the unsafe-naive shape the
 * ledger recorded before this was built. Instead the row stays, the tree
 * stays, the date stays visible; only the OVERDUE treatment is withheld, by a
 * row-aware gate (`_prodRowOverdue` / `_prodRowOverdueText`) keyed on the
 * `isHierarchyParent` flag the adapter already computes. Children are
 * untouched — their flag is false, and an overdue sub-issue keeps the most
 * urgent signal on the board.
 *
 * This suite executes all three layers: the parent-link resolver (tree
 * intact), the hierarchy flagging (the right rows are containers), and the
 * gate itself (a genuinely past date that the calendar half calls overdue is
 * still withheld for a parent, and only for a parent).
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const slice = (from, to, label) => {
  const a = html.indexOf(from);
  const b = html.indexOf(to, a);
  ok(a > -1 && b > a, `the ${label} is findable (harness is not vacuous)`);
  return html.slice(a, b);
};

// ---- the real date logic, EXECUTED ----------------------------------------
/* Leaf stubs only: today is pinned, and terminal-status classification is
   collapsed to the one value the fixtures use. Everything under test is the
   file's own code. */
const isoFns = new Function(
  slice('function _prodIsoParts(value)', 'function _prodIsoFromParts', 'ISO helpers')
  + '\nreturn { _prodIsoParts, _prodIsoDayNumber };')();
const overdueFns = new Function(
  '_prodIsDone', '_prodIsoParts', '_prodPolicyTodayISO', '_prodIsoDayNumber',
  slice('function _prodOverdue(v, status, now)', 'function _prodDurationText', 'overdue chain')
  + '\nreturn { _prodOverdue, _prodOverdueText, _prodRowOverdue, _prodRowOverdueText };')(
  status => status === 'done',
  isoFns._prodIsoParts,
  () => '2026-08-27',
  isoFns._prodIsoDayNumber);

// ---- the tree, EXECUTED ----------------------------------------------------
/* The measured shape: an imported parent row (a real deliverable row whose
   uuid the children name), one open child past its date, one finished child. */
const rows = [
  { id: 'n-parent', linear_issue_uuid: 'uuid-parent', raw_issue_parent_id: '', due_date: '2026-07-17', status: 'tweak' },
  { id: 'n-kid-open', linear_issue_uuid: 'uuid-kid-open', raw_issue_parent_id: 'uuid-parent', due_date: '2026-08-01', status: 'todo' },
  { id: 'n-kid-done', linear_issue_uuid: 'uuid-kid-done', raw_issue_parent_id: 'uuid-parent', due_date: '', status: 'done' },
];
const resolveParentLinks = new Function(
  slice('function _prodResolveParentLinks(rows)', '/* Batch parents for natively created cards.', 'parent-link resolver')
  + '\nreturn _prodResolveParentLinks;')();
const links = resolveParentLinks(rows);
ok(links.get('n-kid-open') === 'n-parent' && links.get('n-kid-done') === 'n-parent',
  'both children resolve to the imported parent row — the tree the repair must not break');
ok(!links.has('n-parent'), 'and the parent row itself hangs under nobody');

const ISSUES = rows.map(d => ({
  id: d.id,
  parent: links.get(d.id) || null,
  status: d.status,
  due: d.due_date ? 'shown' : '',
  dueRaw: d.due_date,
  isHierarchyParent: false,
}));
const flagged = new Function('ISSUES', '_prodIsDone',
  slice('const parentSet = new Set(ISSUES.filter(i => i.parent).map(i => i.parent));', 'const issueCounts', 'hierarchy flagging')
  + '\nreturn ISSUES;')(ISSUES, status => status === 'done');

const parentIssue = flagged.find(i => i.id === 'n-parent');
const kidOpen = flagged.find(i => i.id === 'n-kid-open');
const kidDone = flagged.find(i => i.id === 'n-kid-done');
ok(parentIssue.isHierarchyParent === true,
  'the adapter marks the imported parent row a hierarchy parent — the flag the gate reads');
ok(kidOpen.isHierarchyParent === false && kidDone.isHierarchyParent === false,
  'and never marks a child');
ok(String(parentIssue.sub) === '1,2',
  'the parent still counts its children (1 of 2 done) — the container role survives whole');
ok(flagged.length === 3 && flagged.every(i => i.id),
  'no row was removed to get there — removal is the recorded unsafe repair, and this is not it');

// ---- the gate, EXECUTED ----------------------------------------------------
ok(overdueFns._prodOverdue(parentIssue.dueRaw, parentIssue.status) === true,
  'the calendar half genuinely calls the parent\'s February-style date overdue (the gate has something to withhold)');
ok(overdueFns._prodRowOverdue(parentIssue) === false,
  'yet the ROW is not overdue — a container\'s date is not anybody\'s late work');
ok(overdueFns._prodRowOverdueText(parentIssue) === '',
  'and its tooltip carries no "overdue by N days"');
ok(parentIssue.due === 'shown',
  'while the date itself still renders — withheld treatment, not hidden information');
ok(overdueFns._prodRowOverdue(kidOpen) === true,
  'the open child past its date keeps its red — the most urgent signal on the board');
ok(/overdue by \d+ day/.test(overdueFns._prodRowOverdueText(kidOpen)),
  'and keeps its tooltip arithmetic');
ok(overdueFns._prodRowOverdue(kidDone) === false,
  'a finished child stays quiet, as it always did');
/* Inversion — the flag is what withholds it, so losing the flag is caught. */
ok(overdueFns._prodRowOverdue(Object.assign({}, parentIssue, { isHierarchyParent: false })) === true,
  'strip the flag and the same row IS overdue again — the assertions above are doing work');

// ---- every render site goes through the gate -------------------------------
const directCalls = html.match(/_prodOverdue(?:Text)?\([dk]\.dueRaw/g) || [];
const gateSrc = slice('function _prodRowOverdue(d)', 'function _prodDurationText', 'row gate pair');
const gateCalls = gateSrc.match(/_prodOverdue(?:Text)?\([dk]\.dueRaw/g) || [];
ok(directCalls.length === 2 && gateCalls.length === 2,
  'the only direct calls to the date-only helpers are inside the gate itself — every render site goes through the row');
ok(/_prodRowOverdue\(d\) \? ' over'/.test(html),
  'the red calendar chip is gated per row');
ok(/d\.due && _prodRowOverdue\(d\) \? 'dueover'/.test(html),
  'and so is the red side row');
ok(/_prodRowOverdue\(k\)/.test(html) && /_prodRowOverdueText\(k\)/.test(html),
  'sub-rows route through the same gate (their flag is false, so nothing changes for them)');
ok(/due: '', dueRaw: '',/.test(html),
  'synthetic batch parents still carry no date at all — the other kind of container never entered the lane');

if (failures) {
  console.error(`\n${failures} parent-row overdue check(s) failed`);
  process.exit(1);
}
console.log('\nProduction parent-row overdue checks passed');
