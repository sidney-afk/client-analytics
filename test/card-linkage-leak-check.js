'use strict';
/*
 * The leak report has to be honest in both directions.
 *
 * GRAPHICS_FLIP_STATUS carried "roughly 6% of newly created cards still miss the
 * stamp" from 2026-08-06 onward, and a stale number is worse than no number: it
 * is quoted as if it were current. Re-measured 2026-08-22, the eight-week figure
 * IS still 6.0% — and that is exactly the trap, because nearly all of it is one
 * day in July when thirteen cards were bulk-created unlinked and archived hours
 * later. Over the five weeks since, 215 cards produced 5 unlinked (2.3%) and the
 * most recent full week produced 0 of 43.
 *
 * So the report has to separate three things a single percentage cannot:
 *   - a card that was never linked and was then archived is a DISCARDED DRAFT,
 *   - a card that was never linked and is still live is ACTIONABLE,
 *   - and even that is not automatically a fault, because the calendar is also
 *     used to park a reference.
 *
 * This suite EXECUTES the real classifier from the script against fixtures
 * shaped like each of those cases. What it pins is that the actionable number
 * cannot be inflated by discarded drafts, cannot be deflated by an archived
 * card being counted as fine when it was never unlinked in the first place, and
 * cannot be corrupted by the two lanes stamping different columns.
 */
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.LEAK_CHECK_SRC || path.join(ROOT, 'scripts', 'card-linkage-leak-check.js');
const { cardLinked, isArchived, weekKey, classify } = require(SRC);

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

ok(typeof classify === 'function' && typeof cardLinked === 'function',
  'the real classifier loads and runs (harness is not vacuous)');

/* Both lanes stamp different columns, and a card that went through EITHER is
   not leaked. Getting this wrong would report the whole legacy lane as a leak. */
ok(cardLinked({ video_deliverable_id: 'del_v' }), 'a native video deliverable id counts as linked');
ok(cardLinked({ graphic_deliverable_id: 'del_g' }), 'a native thumbnail deliverable id counts as linked');
ok(cardLinked({ linear_issue_id: 'https://linear.app/x/VID-1' }), 'a legacy video Linear URL counts as linked');
ok(cardLinked({ graphic_linear_issue_id: 'https://linear.app/x/GRA-1' }), 'a legacy thumbnail URL counts as linked');
ok(!cardLinked({ video_deliverable_id: '', graphic_linear_issue_id: '   ' }),
  'blank and whitespace-only stamps are not links');
ok(!cardLinked(null) && !cardLinked(undefined), 'a missing row is not silently treated as linked');

ok(isArchived({ status: 'Archived' }) && isArchived({ status: 'archived' }),
  'archived is recognised regardless of case');
ok(!isArchived({ status: 'In Progress' }) && !isArchived({}), 'anything else is live');

/* Weeks are Monday-anchored so a bucket means the same thing on every run. */
ok(weekKey('2026-08-22T04:00:00Z') === '2026-08-17', 'a Saturday falls in its Monday week');
ok(weekKey('2026-08-17T00:00:00Z') === '2026-08-17', 'the Monday itself anchors its own week');
ok(weekKey('2026-08-16T23:59:59Z') === '2026-08-10', 'the Sunday before belongs to the previous week');
ok(weekKey('not a date') === 'unknown', 'an unparseable timestamp is bucketed as unknown, not as today');

/* The July shape, reproduced: a bulk create that never linked, archived the
   same day. It is 100% of that week's unlinked count and 0% of the actionable
   one — the exact distinction the old 6% could not make. */
const julyBulk = Array.from({ length: 13 }, (_, i) => ({
  id: 'p_bulk_' + i, client: 'client-a', created_at: '2026-07-16T03:53:4' + (i % 10) + 'Z',
  row: { status: 'Archived' },
}));
let report = classify(julyBulk);
ok(report.totals.created === 13 && report.totals.unlinked === 13,
  'every card in the bulk create is counted as unlinked');
ok(report.totals.unlinked_live === 0 && report.live_unlinked.length === 0,
  'and none of it is actionable, because it was all discarded');

/* A live unlinked card IS actionable and must be named, not just counted —
   the whole point is that a human can look at it and decide. */
report = classify([
  { id: 'p_live', client: 'client-b', created_at: '2026-08-12T14:41:33Z', row: { status: 'In Progress' } },
  { id: 'p_ok', client: 'client-b', created_at: '2026-08-12T15:00:00Z', row: { status: 'In Progress', video_deliverable_id: 'del_v' } },
  { id: 'p_gone', client: 'client-b', created_at: '2026-08-12T16:00:00Z', row: { status: 'Archived' } },
]);
ok(report.totals.created === 3, 'every born card is counted once');
ok(report.totals.unlinked === 2, 'both unlinked cards are counted');
ok(report.totals.unlinked_live === 1, 'only the live one is actionable');
ok(report.live_unlinked.length === 1 && report.live_unlinked[0].id === 'p_live',
  'and it is named, so somebody can open it');
ok(report.live_unlinked[0].client === 'client-b' && report.live_unlinked[0].status === 'In Progress',
  'with the client and status needed to find it');

/* A linked card is never actionable, whatever its status — otherwise the
   report would grow every time somebody archived finished work. */
report = classify([
  { id: 'p_done', client: 'client-c', created_at: '2026-08-12T10:00:00Z', row: { status: 'Archived', linear_issue_id: 'https://linear.app/x/VID-9' } },
]);
ok(report.totals.unlinked === 0 && report.totals.unlinked_live === 0,
  'an archived card that HAD its work is not a leak');

/* Weeks come back newest first and carry their own totals, so a reader sees the
   trend rather than one blended percentage. */
report = classify([
  { id: 'p_1', client: 'c', created_at: '2026-07-16T03:00:00Z', row: { status: 'Archived' } },
  { id: 'p_2', client: 'c', created_at: '2026-08-19T03:00:00Z', row: { status: 'In Progress', video_deliverable_id: 'del_v' } },
]);
ok(report.weeks.length === 2 && report.weeks[0].week === '2026-08-17',
  'weeks are reported newest first');
ok(report.weeks[0].created === 1 && report.weeks[0].unlinked === 0,
  'the recent week reports its own numbers, not the blended ones');
ok(report.weeks[1].unlinked === 1, 'and the old week keeps its own');

ok(classify([]).totals.created === 0 && classify(undefined).totals.created === 0,
  'an empty window reports zero rather than throwing');

if (failures) { console.error('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nall green');
