'use strict';
/*
 * ATTRIBUTION THAT WAS INVALIDATED AND NEVER RE-DERIVED.
 *
 * When a Linear structure change moves an issue, `linear-inbound` marks its
 * attribution `needs_attribution` and clears `client_slug` — a deliberate
 * fail-closed, because a moved issue may now belong to somebody else. The row
 * keeps `previous_client_slug` so the old answer is not lost, and it stores
 * `repair_required: true` to say a re-derivation is owed.
 *
 * Nothing re-derives it. And since the graphics flip (2026-08-16) nothing CAN
 * on that side: B1 is gated off a SyncView-authoritative team, and
 * `linear-inbound` will not apply a foreign write to one either. So for a
 * graphics row the invalidation is a one-way door — applied, never answered.
 *
 * The same thing happens through a second door. A row imported while its
 * project was unmapped is stamped `direct_project_unmapped` — correctly, at the
 * time — and never re-checked once somebody maps that project. Both roads end
 * in the same place: a row that has an answer sitting on it and nobody applying
 * it.
 *
 * The cost is not cosmetic. A row with no `client_slug` appears in NO client
 * view, so its state has no owner. Measured 2026-08-22: 92 rows unresolved, 90
 * of them repairable from their own project mapping, 87 of those still live.
 *
 * But the number that matters is much smaller, and getting that right is the
 * point of this report. Sixty of the live ones resolve to a test fixture and
 * twenty-five to clients who are no longer active — history, inflating every
 * attribution count but nobody waiting. **Two** belong to an active client:
 * `GRA-7068` and `GRA-7084`, a designer's thumbnails that had been sitting in
 * Kasper's approval queue for 10 and 8 days, both past their due dates, visible
 * to nobody. That is the whole reason to look.
 *
 * So this report answers one question: of the rows whose attribution is not
 * resolved, which could be answered RIGHT NOW from their own project mapping,
 * and which genuinely need a human to map a project first?
 *
 *   repairable        the row's project maps to exactly one client. No
 *                     judgement needed; the answer is already in the data.
 *   unmapped_project  the row names a project no client claims. Somebody has
 *                     to say who owns that project — this is the real backlog.
 *   ambiguous         more than one client claims the project. Never guess.
 *   no_project        the row carries no project at all; attribution has to
 *                     come from its ancestors, which this report does not walk.
 *
 * READ-ONLY. Public key, no writes, no Linear calls, safe to run anywhere.
 *
 *   node scripts/attribution-stuck-check.js [--json] [--all]
 *
 * By default only LIVE rows are listed (a terminal row nobody will touch again
 * is counted, not printed). Exit 0 always: this is a CONTEXT report, not a
 * gate, because every repair here is somebody's decision to make.
 *
 * PUBLIC SAFETY: prints issue identifiers, client slugs already public in the
 * roster, statuses and counts. Never a title, description or asset link.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');

const args = new Map(process.argv.slice(2).map(a => {
  const m = String(a).match(/^--([^=]+)(?:=(.*))?$/);
  return m ? [m[1], m[2] == null ? '1' : m[2]] : [a, '1'];
}));
const AS_JSON = args.has('json');
const SHOW_ALL = args.has('all');

// A row in one of these has been decided; nobody is waiting on it.
const TERMINAL = new Set(['approved', 'posted', 'canceled', 'archived', 'duplicate']);

function clean(value) { return String(value == null ? '' : value).trim(); }

/* `linear_project_ids` is stored in two shapes and both are live: an ARRAY of
   ids for older roster rows, and a per-team OBJECT for the ones split after the
   two teams could differ. Reading only one shape would silently report half the
   roster as unmapped. */
function projectIdsFor(client) {
  const raw = client && client.linear_project_ids;
  if (!raw) return [];
  const values = Array.isArray(raw) ? raw
    : (typeof raw === 'object' ? Object.values(raw) : [raw]);
  // Deduplicated: the common per-team object points BOTH teams at one project,
  // and this is the set of projects a client claims, not a per-team listing.
  return [...new Set(values.map(clean).filter(Boolean))];
}

/* project id -> the slugs claiming it. A list, not a single slug: two clients
   claiming one project is a real possibility and must never be resolved by
   picking whichever came back first. */
function buildProjectOwners(clients) {
  const owners = new Map();
  for (const client of clients || []) {
    const slug = clean(client && client.slug);
    if (!slug) continue;
    for (const id of projectIdsFor(client)) {
      if (!owners.has(id)) owners.set(id, []);
      if (!owners.get(id).includes(slug)) owners.get(id).push(slug);
    }
  }
  return owners;
}

/* Who is actually WAITING. A roster entry can be a former client or an internal
   test fixture, and a stuck row belonging to one of those is history, not a
   person wondering where their thumbnail went. Counting them together is how a
   number stops meaning anything -- the same trap the card-linkage leak report
   fell into, where one July incident kept an eight-week percentage alive. */
function buildLiveClients(clients) {
  const live = new Set();
  for (const client of clients || []) {
    const slug = clean(client && client.slug);
    if (!slug) continue;
    if (client.active === true && clean(client.kind) === 'client') live.add(slug);
  }
  return live;
}

function daysBetween(iso, nowMs) {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

/* The whole judgement as one pure function, exported so a test can EXECUTE it. */
function classify(rows, projectOwners, nowMs, liveClients) {
  const waiting = liveClients instanceof Set ? liveClients : new Set();
  const buckets = { repairable: [], unmapped_project: [], ambiguous: [], no_project: [] };
  for (const row of rows || []) {
    const state = clean(row && row.raw_attribution_state);
    if (!state || state === 'resolved') continue;
    const projectId = clean(row && row.raw_project_id);
    const claimants = projectId ? (projectOwners.get(projectId) || []) : [];
    const entry = {
      id: clean(row.id),
      issue: clean(row.linear_identifier) || clean(row.identifier),
      team: clean(row.team),
      status: clean(row.status),
      live: !TERMINAL.has(clean(row.status).toLowerCase()),
      stored_client: clean(row.client_slug),
      previous_client: clean(row.raw_attribution_client_slug) || null,
      reason: clean(row.raw_attribution_reason),
      project_id: projectId || null,
      days_stuck: daysBetween(row.updated_at, nowMs),
      resolves_to: claimants.length === 1 ? claimants[0] : null,
      claimants,
    };
    entry.owner_waiting = entry.live && !!entry.resolves_to && waiting.has(entry.resolves_to);
    if (!projectId) buckets.no_project.push(entry);
    else if (claimants.length === 1) buckets.repairable.push(entry);
    else if (claimants.length > 1) buckets.ambiguous.push(entry);
    else buckets.unmapped_project.push(entry);
  }
  for (const key of Object.keys(buckets)) {
    buckets[key].sort((a, b) => (b.days_stuck || 0) - (a.days_stuck || 0));
  }
  const counts = {};
  for (const [key, list] of Object.entries(buckets)) {
    counts[key] = {
      total: list.length,
      live: list.filter(e => e.live).length,
      owner_waiting: list.filter(e => e.owner_waiting).length,
    };
  }
  return { buckets, counts };
}

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status + ': ' + (await res.text()).slice(0, 200));
  return res.json();
}

async function main() {
  const clients = await rest('clients?select=slug,linear_project_ids,active,kind&limit=1000');
  const rows = [];
  const PAGE = 1000;
  for (let offset = 0; offset < 20000; offset += PAGE) {
    const page = await rest('production_deliverables_browser_v1'
      + '?select=id,identifier,linear_identifier,team,status,client_slug,updated_at,'
      + 'raw_project_id,raw_attribution_state,raw_attribution_reason,raw_attribution_client_slug'
      + '&raw_attribution_state=not.is.null&raw_attribution_state=neq.resolved'
      + '&order=updated_at.desc&limit=' + PAGE + '&offset=' + offset);
    rows.push(...page);
    if (page.length < PAGE) break;
  }

  const report = Object.assign(
    { generated_at: new Date().toISOString(), rows_examined: rows.length },
    classify(rows, buildProjectOwners(clients), Date.now(), buildLiveClients(clients)),
  );

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }

  console.log('Deliverables whose attribution is not resolved: ' + rows.length);
  for (const [key, count] of Object.entries(report.counts)) {
    console.log('  ' + key.padEnd(18) + String(count.total).padStart(4)
      + '   live: ' + String(count.live).padStart(3)
      + '   an ACTIVE client is waiting: ' + count.owner_waiting);
  }

  const show = (key, heading, note) => {
    const list = report.buckets[key].filter(e => SHOW_ALL || e.live);
    if (!list.length) return;
    console.log('');
    console.log(heading);
    for (const e of list) {
      const age = e.days_stuck == null ? '' : ' · ' + e.days_stuck + 'd since last touch';
      console.log('  ' + (e.owner_waiting ? '! ' : '  ') + (e.issue || e.id).padEnd(12) + (e.team || '?').padEnd(10)
        + (e.status || '?').padEnd(18)
        + (e.resolves_to ? '-> ' + e.resolves_to : (e.claimants.length ? 'claimed by ' + e.claimants.join(', ') : 'project unclaimed'))
        + age);
      if (e.previous_client && e.previous_client !== e.resolves_to) {
        console.log('  ' + ''.padEnd(12) + 'was ' + e.previous_client + ' before the change · ' + e.reason);
      }
    }
    if (note) console.log('  ' + note);
  };

  show('repairable', 'REPAIRABLE NOW — the project already names exactly one client:',
    'Nothing here needs a judgement. The answer is on the row.');
  show('ambiguous', 'AMBIGUOUS — more than one client claims the project. Never guess:');
  show('unmapped_project', 'NEEDS A PROJECT MAPPING — somebody has to say who owns the project:');
  show('no_project', 'NO PROJECT ON THE ROW — attribution would have to come from an ancestor:');

  if (!SHOW_ALL) console.log('\nTerminal rows are counted above but not listed; pass --all to see them.');
  if (report.counts.repairable.owner_waiting) {
    console.log('\nA row with no client_slug appears in NO client view, so its state has no owner.');
    console.log('The rows marked ! belong to an ACTIVE client and are live: somebody is waiting on');
    console.log('those without knowing it. The rest are former clients or test fixtures --');
    console.log('counted, because they inflate every attribution number, but nobody is waiting.');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('attribution-stuck-check failed: ' + (e && e.message || e)); process.exit(1); });
}

module.exports = { classify, buildProjectOwners, buildLiveClients, projectIdsFor, TERMINAL };
