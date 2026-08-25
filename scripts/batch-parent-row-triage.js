'use strict';
/*
 * THE BATCH PARENT IS SITTING IN THE WORK LIST.
 *
 * A batch names a Linear parent in `linear_parent_ids` and holds the work under
 * it in `deliverables`. Those are different roles: the parent is the container,
 * the deliverables are the things somebody makes. A healthy native batch shows
 * it plainly — parent `VID-13417`, deliverables `VID-13418` (video) and
 * `GRA-7131` (thumbnail). The parent is not among them.
 *
 * Estate-wide on 2026-08-25, **1,079 deliverable rows named their own batch's
 * parent**. 290 were live, and 272 of those sat in active batches. The parent
 * had been imported as if it were work.
 *
 * IT IS NOT COSMETIC. The Create Post editor picker suggests whoever has the
 * least open video work. It counted 332 rows that day and 56 of them were
 * parent rows — 17% of the number staff were shown, and enough to put the two
 * heaviest editors on screen in the reverse of their true order.
 *
 * WHY THIS IS A REPORT AND NOT A DELETE. Item 42 established the rule the hard
 * way: a confident wrong answer about parentage is worse than no answer. These
 * rows are not interchangeable, and one of the groups below must NOT be
 * removed — emptying a batch makes unfinished work look finished, which is a
 * worse failure than the one being repaired. So this classifies and stops.
 *
 * FOUR OUTCOMES:
 *
 *   card_bound   A calendar card points at this row. Whatever else is true, a
 *                card's link is not collateral. (Measured 2026-08-25: ZERO.
 *                Kept because the check costing nothing is the reason it can
 *                be trusted to still be zero.)
 *   terminal     Already posted/approved/archived. It is history, not a queue
 *                entry, and nothing is counting it.
 *   detachable   Live, and the batch ALSO holds live real work. Archiving the
 *                row leaves the batch intact and the work reachable.
 *   sole_row     Live, and the ONLY live row in its batch. The batch's real
 *                children were never imported. Removing the parent row would
 *                leave an empty batch that reads as finished. These want their
 *                children imported, not this row deleted.
 *
 * READ-ONLY. Supabase publishable key, no writes, no apply path in this file.
 *
 *   node scripts/batch-parent-row-triage.js
 *   node scripts/batch-parent-row-triage.js --json
 *   node scripts/batch-parent-row-triage.js --gate
 *
 * PUBLIC SAFETY (F64, this repo is public): the text report prints counts,
 * batch ids and Linear identifiers only. Client slugs appear under --json,
 * which is for local triage.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');
const AS_JSON = process.argv.includes('--json');
const AS_GATE = process.argv.includes('--gate');

function clean(v) { return String(v == null ? '' : v).trim(); }

/* Terminal states, lowercased. A row in one of these is not in anybody's queue
   and is not counted by the picker, so it is history rather than a defect to
   act on. */
const TERMINAL = ['posted', 'approved', 'archived', 'canceled', 'cancelled'];
function isLive(row) { return !TERMINAL.includes(clean(row && row.status).toLowerCase()); }

/* The parent identifiers a batch claims for itself, across every team lane. */
function ownParentIdentifiers(batch) {
  const map = batch && batch.linear_parent_ids;
  const found = new Set();
  if (!map || typeof map !== 'object' || Array.isArray(map)) return found;
  for (const value of Object.values(map)) {
    const identifier = clean(value && value.identifier);
    if (identifier) found.add(identifier);
  }
  return found;
}

/*
 * The judgement, pure, so every outcome is testable without a network.
 *
 * `context` carries what the row cannot know about itself: the batch it sits in
 * and its live siblings. Order matters and is the whole safety argument —
 * card_bound outranks everything because a card's link is never collateral, and
 * sole_row outranks detachable because emptying a batch is the worse failure.
 */
function classifyParentRow(row, context) {
  const batch = (context && context.batch) || null;
  const liveSiblings = ((context && context.liveSiblings) || []).filter(Boolean);
  if (clean(row && row.card_id)) {
    return { verdict: 'card_bound', reason: 'a calendar card points at this row' };
  }
  if (!isLive(row)) {
    return { verdict: 'terminal', reason: 'already ' + clean(row && row.status).toLowerCase() };
  }
  if (clean(batch && batch.status).toLowerCase() !== 'active') {
    return { verdict: 'terminal', reason: 'its batch is not active' };
  }
  if (!liveSiblings.length) {
    return { verdict: 'sole_row',
      reason: 'the only live row in its batch — its real children were never imported' };
  }
  return { verdict: 'detachable',
    reason: liveSiblings.length + ' live sibling(s) remain, so the batch survives without it' };
}

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status);
  return res.json();
}
/* PostgREST caps a page at 1000 regardless of the limit asked for, so a single
   large read comes back silently truncated and every count derived from it is
   wrong while looking fine. Always page. */
async function pageAll(table, select, size = 1000) {
  const out = [];
  for (let offset = 0; offset < 200000; offset += size) {
    const page = await rest(table + '?select=' + select + '&order=id.asc&limit=' + size + '&offset=' + offset);
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}

async function main() {
  const [batches, deliverables] = await Promise.all([
    pageAll('batches', 'id,client_slug,name,status,linear_parent_ids'),
    pageAll('deliverables', 'id,batch_id,client_slug,team,kind,status,linear_identifier,card_id,assignee_id'),
  ]);
  const batchById = new Map(batches.map(batch => [clean(batch.id), batch]));
  const ownById = new Map();
  for (const batch of batches) {
    const own = ownParentIdentifiers(batch);
    if (own.size) ownById.set(clean(batch.id), own);
  }
  const byBatch = new Map();
  for (const row of deliverables) {
    const key = clean(row.batch_id);
    if (!key) continue;
    if (!byBatch.has(key)) byBatch.set(key, []);
    byBatch.get(key).push(row);
  }

  const report = [];
  for (const row of deliverables) {
    const key = clean(row.batch_id);
    const identifier = clean(row.linear_identifier);
    if (!key || !identifier) continue;
    const own = ownById.get(key);
    if (!own || !own.has(identifier)) continue;
    const liveSiblings = (byBatch.get(key) || [])
      .filter(other => clean(other.id) !== clean(row.id) && isLive(other));
    const verdict = classifyParentRow(row, { batch: batchById.get(key), liveSiblings });
    report.push({
      deliverable_id: clean(row.id), batch_id: key, client: clean(row.client_slug),
      team: clean(row.team), kind: clean(row.kind), status: clean(row.status),
      identifier, assigned: !!clean(row.assignee_id),
      live_siblings: liveSiblings.length, ...verdict,
    });
  }

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return report; }

  const by = code => report.filter(entry => entry.verdict === code);
  console.log('Deliverable rows that ARE their own batch\'s parent: ' + report.length);
  console.log('  card_bound  (a card points at it — never touch blind) : ' + by('card_bound').length);
  console.log('  terminal    (history, nothing counts it)              : ' + by('terminal').length);
  console.log('  detachable  (batch holds other live work)             : ' + by('detachable').length);
  console.log('  sole_row    (would EMPTY its batch — import children) : ' + by('sole_row').length);
  const counted = report.filter(entry => entry.verdict === 'detachable' || entry.verdict === 'sole_row');
  console.log('');
  console.log('Of the ' + counted.length + ' live ones, ' + counted.filter(entry => entry.assigned).length
    + ' carry an assignee — those are the rows inflating the editor workload counts.');
  console.log('');
  console.log('Nothing was written. `detachable` is the only group a repair could archive');
  console.log('without changing what a batch appears to contain; `sole_row` needs its real');
  console.log('children imported instead, and emptying those batches would make unfinished');
  console.log('work read as finished.');

  if (AS_GATE && by('card_bound').length) {
    console.error('\nGATE: a parent row is bound to a calendar card. That was zero when this');
    console.error('was measured; it is not any more, and no repair should run until it is understood.');
    process.exit(1);
  }
  return report;
}

if (require.main === module) {
  main().catch(error => {
    console.error('batch-parent-row-triage failed: ' + (error && error.message || error));
    process.exit(1);
  });
}

module.exports = { classifyParentRow, ownParentIdentifiers, isLive };
