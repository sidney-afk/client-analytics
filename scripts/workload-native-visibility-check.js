'use strict';
/*
 * IS SYNCVIEW-AUTHORITATIVE WORK INVISIBLE TO THE EDITOR WHO OWES IT?
 *
 * The flip moved only the DUE DATE and the workload weight to the native store.
 * Workload still reads `status`, `status_type`, `active`, `is_sub_issue` and the
 * population itself from `workload_issues` -- the Linear mirror -- so a retired
 * system still decides what counts as live work on the page an editor opens to
 * see what they owe. `OPEN_REPAIRS.md` item 72 recorded the class and asked for
 * exactly this check to become standing:
 *
 *   "every non-archived native row in todo/in_progress/tweak that is not a
 *    batch parent must have a workload_issues row that is active, a sub-issue,
 *    and non-parked. Baseline at today's five and gate on growth."
 *
 * WHAT IT COUNTS, and the narrowing matters more than the count. Of the rows
 * that look dropped, the overwhelming majority are dropped CORRECTLY:
 *
 *   - a row with no native parent is a batch parent -- a post, not an assignable
 *     deliverable -- and Workload is right to exclude it. Measured 2026-09-02:
 *     81 of the 86 apparent drops are exactly this, and ZERO of them carry a
 *     native parent. Counting them would report a defect eighty-one times bigger
 *     than the one that exists, which is how a real five gets ignored.
 *   - archived and canceled rows are excluded: Linear archived them and nothing
 *     reconciles the native status, so they are stale natively, not hidden.
 *
 * What remains is a row that natively has a parent, is live work, is not
 * archived, and whose Linear mirror says `active = false` or denies it is a
 * sub-issue. That row is real work with a real owner that its owner cannot see.
 *
 * TWO CLASSES, and they have different mechanisms, so they are reported apart:
 *
 *   MIRROR SAYS INACTIVE (5) -- the row exists in workload_issues and says
 *     `active = false` while the native store says the work is live. This is
 *     item 72's class. Measured 2026-09-02: VID-13580, VID-13581, VID-13582,
 *     VID-13109, GRA-7237. The COUNT
 *     matches item 72's baseline; the MEMBERSHIP does not -- VID-13491 has
 *     resolved and GRA-7237 is new, and it is GRAPHICS while item 72 recorded
 *     this as video-only. A stable count concealing a moving membership is the
 *     reason this is a script and not a number in a document.
 *
 *   NEVER IMPORTED (7 real) -- no workload_issues row exists at all. NOT sync
 *     lag, and that was checked rather than assumed: the mirror's newest
 *     `synced_at` was 20 minutes old while these rows were 17 to 150 HOURS old.
 *     Measured 2026-09-02: GRA-7243..7247 (one client, created 2026-08-26),
 *     GRA-7286, GRA-7287 (a second client, 2026-08-28). Item 72 does not
 *     record this class; it is larger than the one it does.
 *
 *     AND THE CAUSE IS NOW KNOWN. Item 98 left it open -- "why B1 skipped seven
 *     live graphics issues for six days is not answered here". B1 skipped
 *     nothing. All seven were TRASHED IN LINEAR 15-47 seconds after the mirror
 *     created the issue there. `workload_issues` is rebuilt from a Linear query
 *     and a trashed issue is not in the result, so the row never entered the
 *     cache at all. `foreign_write_detected` recorded each webhook with
 *     `detect_only: true`, and SyncView correctly refused to apply the
 *     deletion -- so the native row stayed live and its owner cannot see it.
 *
 *     A DELETION ONLY EXPLAINS THE STATES A DELETION PRODUCES. It removes the
 *     row from the Linear query the mirror is rebuilt from, so it produces
 *     "no workload row at all" or `active = false` and nothing else -- it
 *     cannot make the mirror park a live row by NAME in an approval queue.
 *     Where the recorded deletion does not match the row's current state it is
 *     printed as HISTORY rather than as the cause, and restores are read too
 *     (`mirror_in_restore` exists here), last event winning. Raised by review
 *     on #1223: labelling a restored row with its oldest deletion would send
 *     the reader at the wrong repair with a confident wrong answer, which is
 *     worse than no answer.
 *
 *     THE TWO CLASSES ARE ONE DEFECT. Running the cause lookup over both,
 *     12 of the 13 gated rows carry a recorded deletion: 7 trashed, 5 with an
 *     explicit `mirror_in_delete`. The difference between "mirror says
 *     inactive" and "never imported" is only WHETHER A SYNC RAN between the
 *     issue being created and being deleted. Same mechanism, same repair,
 *     which is item 95 and the Workload native source.
 *
 *   MIRROR PARKS IT BY NAME (1) -- the mirror row is active, a sub-issue, and
 *     its TYPE is live, but its named status is an approval queue or a finished
 *     state. This is item 72's own headline shape (VID-13491, "For Kasper
 *     approval") and it was invisible to the first version of this check.
 *     Measured 2026-09-02: VID-12983, natively in `tweak`.
 *
 * THE TEST CLIENT IS REPORTED BUT NOT GATED. `sidneylaruel` is the disposable
 * drill client and is mutated constantly on purpose, so its rows would make the
 * gate ring for work nobody is owed. They are printed so a reader can see them.
 *
 * BASELINE 13 = 5 inactive + 7 never-imported + 1 parked-by-name, real clients only.
 *
 * THE CAUSE COLUMN. For each hidden row the check reads its own
 * `deliverable_events` for a `trashed: true` webhook snapshot or a
 * `mirror_in_delete`, and prints what it finds beside the row. Bounded to the
 * rows already found hidden (a dozen or so, one request) and FAILS SOFT: a
 * diagnosis is worth having and never worth turning a working gate red over.
 * A count without a cause gets read once and filed.
 *
 * READ-ONLY. Public key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/workload-native-visibility-check.js [--baseline=5] [--json]
 *
 * Exits 1 above the baseline so it can gate; 0 at or below it.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const baselineArg = args.find(a => a.startsWith('--baseline='));
const BASELINE = baselineArg ? Number(baselineArg.split('=')[1]) : 13;
/* Mutated constantly by drills; reported, never gated. */
const TEST_CLIENT = String(process.env.SYNCVIEW_TEST_CLIENT || 'sidneylaruel');

/* Workload parks a row for TWO independent reasons, and a classifier that knows
   only one of them measures the wrong thing.

   1. The Linear workflow-state TYPE (never the column's name), plus the
      2026-08-23 owner ruling that Backlog is not work anyone is holding.
   2. A NAMED status in WL_PARKED_STATUSES -- an approval queue or a finished
      state, whose type is often still `started`/`unstarted`.

   Reason 2 was missing here and review on #1218 caught it, correctly and
   damningly: `VID-13491` -- the case item 72 LEADS WITH, whose mirror reads
   "For Kasper approval" -- has an active, sub-issue mirror row with a live
   type, so a type-only classifier calls it visible. The check would have missed
   the exact row that motivated it. Both sets are mirrored from index.html
   verbatim, and test/workload-native-visibility.js extracts BOTH from the page
   and asserts they match term for term, so they cannot drift apart in silence. */
const PARKED_TYPES = new Set(['completed', 'canceled', 'duplicate', 'triage', 'backlog']);
const PARKED_STATUSES = new Set([
  'tweak applied', 'tweaks applied',
  'for smm approval', 'waiting for smm approval', 'smm approval',
  'for casper approval', 'waiting for casper approval', 'casper approval',
  'for kasper approval', 'waiting for kasper approval', 'kasper approval',
  'for client approval', 'waiting for client approval', 'client approval',
  'approved',
  'posted',
]);
const LIVE_NATIVE = new Set(['todo', 'in_progress', 'tweak']);

async function pageAll(path) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPA_URL}/rest/v1/${path}&offset=${offset}&limit=1000`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error(`${path} -> not an array`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

function workloadHides(row) {
  if (!row) return 'no workload row at all';
  const type = String(row.status_type || '').toLowerCase();
  const name = String(row.status || '').trim().toLowerCase();
  const why = [];
  if (!row.active) why.push('active=false');
  if (!row.is_sub_issue) why.push('is_sub_issue=false');
  if (PARKED_TYPES.has(type) || name === 'backlog') why.push(`parked type (${type || name})`);
  else if (PARKED_STATUSES.has(name)) why.push(`parked status (${row.status})`);
  return why.length ? why.join(' + ') : '';
}

/* The two halves of the cause column that can be reasoned about without a
   network, lifted out so test/workload-native-visibility.js can RUN them over
   fixtures rather than pattern-match the source. */

/* Fold an ascending event stream into at most one deletion per deliverable.
   LAST EVENT WINS, and a restore clears it: a row deleted in Linear, restored,
   and hidden today for some other reason must not be labelled with its oldest
   deletion. `mirror_in_restore` exists in this estate, so that sequence is real
   rather than hypothetical. Raised by review on #1223. */
function foldDeletionEvents(events) {
  const out = new Map();
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || !ev.deliverable_id) continue;
    if (ev.action === 'mirror_in_restore') { out.delete(ev.deliverable_id); continue; }
    const issue = (ev.payload && ev.payload.issue) || {};
    const trashed = issue.trashed === true;
    if (!trashed && ev.action !== 'mirror_in_delete') continue;
    const seconds = issue.createdAt
      ? Math.round((Date.parse(ev.ts) - Date.parse(issue.createdAt)) / 1000)
      : null;
    out.set(ev.deliverable_id, {
      label: ev.action === 'mirror_in_delete'
        ? 'deleted in Linear'
        : 'trashed in Linear' + (Number.isFinite(seconds) ? ` ${seconds}s after the mirror created it` : ''),
      ts: ev.ts,
    });
  }
  return out;
}

/* A DELETION ONLY EXPLAINS THE STATES A DELETION PRODUCES. It removes the row
   from the Linear query the mirror is rebuilt from, so it produces exactly "no
   workload row at all" or `active = false`. It cannot make the mirror park a
   live row by NAME in an approval queue -- that is somebody moving the status.
   Attaching it there would be a confident wrong answer, which is worse than no
   answer. A deletion that does not match the current state is kept as HISTORY
   rather than dropped, so nothing goes quiet. */
function attachCauses(hidden, deletions) {
  for (const h of Array.isArray(hidden) ? hidden : []) {
    const found = h && h.id ? deletions.get(h.id) : null;
    if (!found) continue;
    const why = String(h.why || '');
    if (why === 'no workload row at all' || why.includes('active=false')) h.cause = found.label;
    else h.note = `${found.label} — but the row is hidden for another reason now, so this is history rather than the cause`;
  }
  return hidden;
}

/* NOT exported. This file ends in a top-level async IIFE that reads the estate
   and calls process.exit, so a `require()` would run it -- which is why the
   suite lifts these functions out of the SOURCE instead, exactly as it already
   does for workloadHides. */

(async () => {
  const [mirror, native] = await Promise.all([
    pageAll('workload_issues?select=identifier,is_sub_issue,status,status_type,active&order=identifier'),
    pageAll('production_deliverables_browser_v1?select=id,identifier,linear_identifier,team,status,client_slug,'
      + 'raw_issue_archived_at,raw_issue_canceled_at,raw_issue_parent_id'
      + `&status=in.(${[...LIVE_NATIVE].join(',')})&order=id`),
  ]);
  const byIdentifier = new Map();
  for (const row of mirror) if (row.identifier) byIdentifier.set(String(row.identifier), row);

  let batchParents = 0, staleNatively = 0, visible = 0;
  const hidden = [];
  for (const row of native) {
    if (row.raw_issue_archived_at || row.raw_issue_canceled_at) { staleNatively++; continue; }
    const ident = String(row.linear_identifier || '').trim();
    if (!ident) { staleNatively++; continue; }
    // No native parent means this IS the post, not work inside it.
    if (!String(row.raw_issue_parent_id || '').trim()) { batchParents++; continue; }
    const why = workloadHides(byIdentifier.get(ident));
    if (!why) { visible++; continue; }
    hidden.push({ id: row.id, identifier: ident, team: row.team, status: row.status, client: row.client_slug, why });
  }

  /* WHY IS IT HIDDEN? A count without a cause gets read once and filed.
     Measured 2026-09-02, answering the question item 98 left open ("why B1
     skipped seven live graphics issues for six days is not answered here"):
     B1 skipped nothing. Every one of those seven was TRASHED IN LINEAR
     15-55 seconds after the mirror created the issue there. `workload_issues`
     is rebuilt from a Linear query, and a trashed issue is not in the result,
     so the row never entered the cache at all -- while `foreign_write_detected`
     recorded the webhook with `detect_only: true` and SyncView correctly
     refused to apply the deletion, leaving the work live natively and
     invisible to the person who owes it.
     That is item 95's mechanism seen from the other side, so this looks for
     both of its signatures: a `trashed: true` webhook snapshot and an explicit
     `mirror_in_delete`.
     Bounded to the rows already found hidden -- a dozen or so, one request --
     and FAILS SOFT: a diagnosis is worth having and never worth turning a
     working gate red over. */
  const diagnosis = new Map();
  let diagnosisError = null;
  const hiddenIds = hidden.map(h => h.id).filter(Boolean);
  if (hiddenIds.length) {
    try {
      /* Ascending, and RESTORES are read too. Raised by review on #1223: a row
         deleted in Linear, restored, and now hidden for some other reason would
         otherwise be labelled with its oldest deletion and send the reader at
         the wrong repair. `mirror_in_restore` exists in this estate, so that is
         a real sequence rather than a hypothetical one. The last event wins. */
      const events = await pageAll('deliverable_events?select=deliverable_id,ts,action,payload'
        + `&deliverable_id=in.(${hiddenIds.join(',')})`
        + '&action=in.(foreign_write_detected,mirror_in_delete,mirror_in_restore)&order=ts');
      for (const [id, found] of foldDeletionEvents(events)) diagnosis.set(id, found);
    } catch (err) {
      diagnosisError = String(err && err.message || err);
    }
  }

  attachCauses(hidden, diagnosis);

  hidden.sort((a, b) => a.identifier.localeCompare(b.identifier));
  const real = hidden.filter(h => h.client !== TEST_CLIENT);
  const test = hidden.filter(h => h.client === TEST_CLIENT);
  const inactive = real.filter(h => h.why.includes('active=false'));
  const absent = real.filter(h => h.why === 'no workload row at all');
  const namedPark = real.filter(h => !inactive.includes(h) && !absent.includes(h)
    && h.why.startsWith('parked status'));
  const other = real.filter(h => !inactive.includes(h) && !absent.includes(h)
    && !namedPark.includes(h));
  const failed = real.length > BASELINE;

  if (asJson) {
    console.log(JSON.stringify({ baseline: BASELINE, gated_count: real.length,
      mirror_says_inactive: inactive, never_imported: absent, parked_by_name: namedPark,
      other: other, test_client: test, cause_lookup_error: diagnosisError,
      visible, batch_parents_excluded: batchParents, stale_natively_excluded: staleNatively }, null, 2));
  } else {
    console.log('Workload native visibility — is live native work reaching the editor who owes it?\n');
    console.log(`  native live-work rows checked      ${native.length}`);
    console.log(`    excluded, archived/canceled      ${staleNatively}`);
    console.log(`    excluded, batch parents (posts)  ${batchParents}`);
    console.log(`  visible on Workload                ${visible}`);
    console.log(`  INVISIBLE to their owner           ${real.length}   (baseline ${BASELINE}, test client excluded)\n`);
    const show = (title, list) => {
      if (!list.length) return;
      console.log(`  ${title} — ${list.length}`);
      for (const h of list) {
        console.log(`    ${h.identifier.padEnd(11)} ${String(h.team).padEnd(9)} ${String(h.status).padEnd(12)} `
          + `${String(h.client).padEnd(24)}${h.cause ? '  <- ' + h.cause : ''}${h.note ? '  (' + h.note + ')' : ''}`);
      }
      console.log('');
    };
    show('MIRROR SAYS INACTIVE (item 72 class)', inactive);
    show('NEVER IMPORTED — no workload row at all', absent);
    show('MIRROR PARKS IT BY NAME (an approval queue or a finished state)', namedPark);
    show('OTHER', other);
    show(`TEST CLIENT (${TEST_CLIENT}) — reported, not gated`, test);
    console.log(failed
      ? `FAIL: ${real.length} above the baseline of ${BASELINE} — new work has gone invisible ❌`
      : `At or under the baseline of ${BASELINE} ✅`);
    if (real.length) {
      console.log('Membership can move without the count moving — compare the identifiers, not just the number.');
      const diagnosed = real.filter(h => h.cause).length;
      const historical = real.filter(h => h.note).length;
      if (historical) {
        console.log(`${historical} row(s) carry a recorded deletion that does NOT explain their current state — printed as history, not as the cause.`);
      }
      if (diagnosed) {
        console.log(`${diagnosed} of ${real.length} carry a recorded cause above. "trashed in Linear" means the issue was`);
        console.log('deleted there after SyncView created it: the work is live natively, the mirror never saw it,');
        console.log('and nothing is wrong with the native row — see OPEN_REPAIRS items 95 and 98.');
      }
      if (diagnosisError) {
        console.log(`(cause lookup unavailable this run: ${diagnosisError} — the counts above are unaffected)`);
      }
    }
  }
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('workload visibility check failed:', err.message); process.exit(2); });
