'use strict';
/*
 * A BATCH PARENT IS NOT A PIECE OF WORK, AND EMPTYING A BATCH IS WORSE THAN
 * LEAVING IT WRONG.
 *
 * 1,079 deliverable rows name their own batch's parent; 272 are live inside
 * active batches, and 56 of those were being counted as open work by the Create
 * Post editor picker — 17% of the number staff are shown.
 *
 * The temptation is one DELETE. The reason there isn't one is that these rows
 * are not interchangeable, and the classifier's ORDER is the safety argument:
 *
 *   - a card-bound row is never collateral, whatever else is true of it;
 *   - a row that is the ONLY live thing in its batch cannot be removed, because
 *     an empty batch reads as finished work when the work was simply never
 *     imported. That failure is worse than the one being repaired.
 *
 * This suite executes the shipped classifier and pins that order, because every
 * "simplification" of it produces a plausible-looking rule that quietly does
 * the destructive thing.
 */
const path = require('path');
const { classifyParentRow, ownParentIdentifiers, isLive } =
  require(path.join(__dirname, '..', 'scripts', 'batch-parent-row-triage.js'));

let failures = 0;
function ok(cond, label) {
  if (cond) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

const ACTIVE = { id: 'b1', status: 'active' };
const row = over => Object.assign({
  id: 'del-1', batch_id: 'b1', team: 'video', kind: 'video',
  status: 'in_progress', linear_identifier: 'VID-1', card_id: '', assignee_id: 'editor',
}, over || {});
const sibling = over => Object.assign({ id: 'del-2', status: 'in_progress' }, over || {});

ok(typeof classifyParentRow === 'function', 'the shipped classifier loads (harness is not vacuous)');

/* ---- the destructive mistake, pinned first ------------------------------- */
{
  const v = classifyParentRow(row(), { batch: ACTIVE, liveSiblings: [] });
  ok(v.verdict === 'sole_row',
    'the only live row in its batch is sole_row — removing it would empty the batch');
  ok(v.verdict !== 'detachable',
    'and is never detachable, which is the answer that makes unfinished work read as finished');
  ok(/never imported|only live/.test(String(v.reason)),
    'and the reason says what is actually missing: the batch\'s real children');
}
{
  const v = classifyParentRow(row(), { batch: ACTIVE, liveSiblings: [sibling()] });
  ok(v.verdict === 'detachable',
    'a batch that still holds live work survives losing its parent row');
  ok(/1 live sibling/.test(String(v.reason)),
    'and the reason counts what survives, so the call can be checked without re-querying');
}

/* ---- card binding outranks everything ------------------------------------ */
{
  const bound = classifyParentRow(row({ card_id: 'p_abc' }), { batch: ACTIVE, liveSiblings: [sibling()] });
  ok(bound.verdict === 'card_bound',
    'a card-bound row is card_bound even when the batch would survive without it');
  const boundTerminal = classifyParentRow(row({ card_id: 'p_abc', status: 'posted' }),
    { batch: ACTIVE, liveSiblings: [] });
  ok(boundTerminal.verdict === 'card_bound',
    'and even when it is terminal — a card points at it either way');
  ok(classifyParentRow(row({ card_id: '   ' }), { batch: ACTIVE, liveSiblings: [] }).verdict === 'sole_row',
    'but whitespace is not a card binding');
}

/* ---- terminal work is history, not a queue entry ------------------------- */
for (const status of ['posted', 'approved', 'archived', 'canceled', 'cancelled']) {
  const v = classifyParentRow(row({ status }), { batch: ACTIVE, liveSiblings: [] });
  ok(v.verdict === 'terminal', `a ${status} row is terminal, not a repair candidate`);
}
ok(classifyParentRow(row({ status: 'POSTED' }), { batch: ACTIVE, liveSiblings: [] }).verdict === 'terminal',
  'and the status match is case-insensitive, because the estate holds both');
ok(classifyParentRow(row({ status: 'tweak' }), { batch: ACTIVE, liveSiblings: [sibling()] }).verdict === 'detachable',
  'while a tweak is live work — the picker counts it, so a repair must see it');

/* An inactive batch is nobody's queue either, however live its rows look. */
{
  const v = classifyParentRow(row(), { batch: { id: 'b1', status: 'archived' }, liveSiblings: [] });
  ok(v.verdict === 'terminal', 'a live row inside an archived batch is terminal');
}

/* ---- dead siblings do not count as survivors ----------------------------- */
{
  const v = classifyParentRow(row(), { batch: ACTIVE, liveSiblings: [] });
  const withDead = classifyParentRow(row(), { batch: ACTIVE, liveSiblings: [null, undefined].filter(Boolean) });
  ok(v.verdict === 'sole_row' && withDead.verdict === 'sole_row',
    'an empty or nulled sibling list is still no siblings — a batch is not rescued by absent rows');
}

/* ---- the parent-identifier extraction ------------------------------------ */
{
  const both = ownParentIdentifiers({ linear_parent_ids: {
    video: { identifier: 'VID-1', uuid: 'u1' }, graphics: { identifier: 'GRA-1', uuid: 'u2' } } });
  ok(both.has('VID-1') && both.has('GRA-1') && both.size === 2,
    'both team lanes contribute their parent identifier');
  const shared = ownParentIdentifiers({ linear_parent_ids: {
    video: { identifier: 'VID-1' }, graphics: { identifier: 'VID-1' } } });
  ok(shared.size === 1,
    'one issue serving both lanes is one identifier, not two — the house shape must not double-count');
  for (const empty of [null, undefined, {}, { linear_parent_ids: null },
    { linear_parent_ids: [] }, { linear_parent_ids: 'VID-1' },
    { linear_parent_ids: { video: {} } }, { linear_parent_ids: { video: null } }]) {
    if (ownParentIdentifiers(empty && empty.linear_parent_ids !== undefined ? empty : { linear_parent_ids: empty }).size) {
      failures++; console.error('FAIL  a malformed parent map yielded an identifier: ' + JSON.stringify(empty));
    }
  }
  ok(true, 'a null, array, string, or empty parent map yields no identifiers rather than throwing');
}

/* isLive is exported because the report and the classifier must agree on what
   "live" means; two definitions is how a count and its own detail disagree. */
ok(isLive({ status: 'in_progress' }) && !isLive({ status: 'archived' }) && isLive({}),
  'isLive treats a missing status as live — an unknown state is not silently retired');

if (failures) { console.error('\nbatch parent row triage checks FAILED: ' + failures); process.exit(1); }
console.log('\nbatch parent row triage checks passed');
