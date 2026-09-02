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
 * THE TEST CLIENT IS REPORTED BUT NOT GATED. `sidneylaruel` is the disposable
 * drill client and is mutated constantly on purpose, so its rows would make the
 * gate ring for work nobody is owed. They are printed so a reader can see them.
 *
 * BASELINE 12 = 5 inactive + 7 never-imported, real clients only.
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
const BASELINE = baselineArg ? Number(baselineArg.split('=')[1]) : 12;
/* Mutated constantly by drills; reported, never gated. */
const TEST_CLIENT = String(process.env.SYNCVIEW_TEST_CLIENT || 'sidneylaruel');

/* Keyed on the Linear workflow-state TYPE, never the column name -- the same
   rule wlIsActiveStatus uses in index.html, including the 2026-08-23 owner
   ruling that Backlog is not work anyone is holding. */
const PARKED_TYPES = new Set(['completed', 'canceled', 'duplicate', 'triage', 'backlog']);
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
  if (PARKED_TYPES.has(type) || name === 'backlog') why.push(`parked (${type || name})`);
  return why.length ? why.join(' + ') : '';
}

(async () => {
  const [mirror, native] = await Promise.all([
    pageAll('workload_issues?select=identifier,is_sub_issue,status,status_type,active&order=identifier'),
    pageAll('production_deliverables_browser_v1?select=identifier,linear_identifier,team,status,client_slug,'
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
    hidden.push({ identifier: ident, team: row.team, status: row.status, client: row.client_slug, why });
  }

  hidden.sort((a, b) => a.identifier.localeCompare(b.identifier));
  const real = hidden.filter(h => h.client !== TEST_CLIENT);
  const test = hidden.filter(h => h.client === TEST_CLIENT);
  const inactive = real.filter(h => h.why.includes('active=false'));
  const absent = real.filter(h => h.why === 'no workload row at all');
  const other = real.filter(h => !inactive.includes(h) && !absent.includes(h));
  const failed = real.length > BASELINE;

  if (asJson) {
    console.log(JSON.stringify({ baseline: BASELINE, gated_count: real.length,
      mirror_says_inactive: inactive, never_imported: absent, other: other, test_client: test,
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
        console.log(`    ${h.identifier.padEnd(11)} ${String(h.team).padEnd(9)} ${String(h.status).padEnd(12)} ${h.client}`);
      }
      console.log('');
    };
    show('MIRROR SAYS INACTIVE (item 72 class)', inactive);
    show('NEVER IMPORTED — no workload row at all', absent);
    show('OTHER', other);
    show(`TEST CLIENT (${TEST_CLIENT}) — reported, not gated`, test);
    console.log(failed
      ? `FAIL: ${real.length} above the baseline of ${BASELINE} — new work has gone invisible ❌`
      : `At or under the baseline of ${BASELINE} ✅`);
    if (real.length) {
      console.log('Membership can move without the count moving — compare the identifiers, not just the number.');
    }
  }
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error('workload visibility check failed:', err.message); process.exit(2); });
