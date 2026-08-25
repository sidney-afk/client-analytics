'use strict';
/*
 * THE BATCH FORGOT ITS PARENT. LINEAR STILL KNOWS IT.
 *
 * 26 active batches carry no `linear_parent_ids` at all while holding 63
 * deliverables, 35 of them still live. Nothing can be appended to a batch in
 * that state: `parentIdsForTeam` returns nothing, the picker hides it
 * (`_calNativeBatchHasLinearParents`), and the gateway would answer 409
 * `batch_parent_mapping_missing` if it were ever offered. So the work sits
 * there, reachable but unextendable.
 *
 * The map is recoverable without guessing, because every one of those batches
 * holds at least one deliverable that names a Linear issue, and Linear knows
 * that issue's parent. This script reads both sides and prints what it WOULD
 * write. It writes nothing, ever — there is no apply path in this file.
 *
 * TWO SHAPES, measured 2026-08-25 by probing four of them:
 *
 *   A. THE CHILD HAS A PARENT — the ordinary case. GRA-7149's parent is
 *      VID-13469; GRA-6992's is VID-13203. The batch parent is that parent, and
 *      note it is a VIDEO issue under a GRAPHICS child, which is the house
 *      shape: one parent issue carries both sub-issues.
 *
 *   B. THE DELIVERABLE **IS** A BATCH PARENT — VID-13346 ("Eben & Annie · 17 Aug
 *      2026") and VID-13355 ("Jenna Phillips Ballard · 17 Aug 2026") have NO
 *      parent, were authored by "SyncView Mirror", and carry a Filming Plan link
 *      as their description. Those are parent issues that were imported INTO
 *      `deliverables` as if they were work. For the batch, that issue is the
 *      answer. For the deliverables table it is a separate defect and this
 *      script only reports it — a row that is not a deliverable should not be
 *      quietly repurposed into one.
 *
 * Shape B is why this is a script and not a SQL statement: "read the child's
 * parent" is wrong for a child that has none and is one.
 *
 * READ-ONLY on Supabase (publishable key). Reads Linear with LINEAR_API_KEY,
 * which is the only credential it needs and is never printed.
 *
 *   LINEAR_API_KEY=lin_api_... node scripts/batch-parent-recovery-dry-run.js
 *   LINEAR_API_KEY=... node scripts/batch-parent-recovery-dry-run.js --json
 *
 * PUBLIC SAFETY: prints batch ids, Linear identifiers and counts. Client slugs
 * are withheld from the text report (F64) and appear only under --json, which
 * is for local triage.
 */
const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/$/, '');
const SUPA_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
  || 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || process.env.LINEAR_READ_API_KEY || '');
const AS_JSON = process.argv.includes('--json');

function clean(v) { return String(v == null ? '' : v).trim(); }

async function rest(path) {
  const res = await fetch(SUPA_URL + '/rest/v1/' + path, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY },
  });
  if (!res.ok) throw new Error(path.split('?')[0] + ' -> HTTP ' + res.status);
  return res.json();
}
async function pageAll(table, select, size = 500) {
  const out = [];
  for (let off = 0; off < 100000; off += size) {
    const page = await rest(table + '?select=' + select + '&order=id.asc&limit=' + size + '&offset=' + off);
    out.push(...page);
    if (page.length < size) break;
  }
  return out;
}
async function linearIssue(identifier) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_KEY },
    body: JSON.stringify({
      query: `query($id:String!){ issue(id:$id){ id identifier title team{key} project{id name}
                parent{ id identifier title team{key} project{id} } } }`,
      variables: { id: identifier },
    }),
  });
  if (!res.ok) throw new Error('linear HTTP ' + res.status);
  const body = await res.json();
  if (body.errors) throw new Error('linear: ' + clean(body.errors[0] && body.errors[0].message));
  return body.data && body.data.issue;
}

/* The judgement, pure, so the shapes are testable without a network. */
function classifyBatch(probes) {
  const seen = probes.filter(Boolean);
  if (!seen.length) return { verdict: 'no_probe', reason: 'no child named a Linear issue' };
  const parents = new Map();
  const selfParents = [];
  for (const p of seen) {
    if (p.parent && clean(p.parent.id)) {
      parents.set(clean(p.parent.id), p.parent);
    } else {
      // No parent of its own. Either a stray top-level issue, or a BATCH PARENT
      // that was imported as a deliverable (shape B).
      selfParents.push(p);
    }
  }
  if (parents.size > 1) {
    return { verdict: 'ambiguous', reason: 'children disagree on their parent',
      candidates: [...parents.values()].map(p => p.identifier) };
  }
  if (parents.size === 1) {
    const parent = [...parents.values()][0];
    return { verdict: 'recover_from_child', parent,
      also_self_parent: selfParents.map(p => p.identifier) };
  }
  if (selfParents.length === 1) {
    return { verdict: 'deliverable_is_the_parent', parent: selfParents[0] };
  }
  return { verdict: 'ambiguous', reason: 'several parentless issues and no shared parent',
    candidates: selfParents.map(p => p.identifier) };
}

async function main() {
  if (!LINEAR_KEY) {
    console.error('LINEAR_API_KEY is required — this reads Linear to find each batch\'s parent.');
    console.error('Nothing is written either way; without the key there is nothing to read.');
    process.exit(2);
  }
  const [batches, deliverables] = await Promise.all([
    pageAll('batches', 'id,client_slug,name,status,team,linear_parent_ids'),
    pageAll('deliverables', 'id,batch_id,team,kind,status,linear_identifier,linear_issue_uuid'),
  ]);
  const byBatch = new Map();
  for (const d of deliverables) {
    const k = clean(d.batch_id);
    if (!k) continue;
    if (!byBatch.has(k)) byBatch.set(k, []);
    byBatch.get(k).push(d);
  }
  const targets = batches.filter(b => clean(b.status).toLowerCase() === 'active'
    && !(b.linear_parent_ids && Object.keys(b.linear_parent_ids).length)
    && (byBatch.get(clean(b.id)) || []).length > 0);

  const report = [];
  for (const batch of targets) {
    const items = byBatch.get(clean(batch.id)) || [];
    const idents = [...new Set(items.map(i => clean(i.linear_identifier)).filter(Boolean))];
    const probes = [];
    for (const id of idents) {
      try { probes.push(await linearIssue(id)); }
      catch (error) { probes.push(null); console.error('  probe failed for ' + id + ': ' + error.message); }
    }
    const verdict = classifyBatch(probes);
    const teams = [...new Set(items.map(i => clean(i.team)).filter(Boolean))].sort();
    report.push({
      batch_id: clean(batch.id), client: clean(batch.client_slug), name: clean(batch.name),
      batch_team: clean(batch.team) || null, items: items.length,
      live: items.filter(i => !['posted', 'approved', 'archived', 'canceled']
        .includes(clean(i.status).toLowerCase())).length,
      teams, probed: idents, ...verdict,
    });
  }

  if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }
  const by = code => report.filter(r => r.verdict === code);
  console.log('Parentless active batches holding work: ' + report.length);
  console.log('  recoverable from a child\'s parent   : ' + by('recover_from_child').length);
  console.log('  the deliverable IS the batch parent  : ' + by('deliverable_is_the_parent').length
    + '   (also a deliverables-table defect — reported, not repaired)');
  console.log('  children disagree (needs a human)    : ' + by('ambiguous').length);
  console.log('  no child named a Linear issue        : ' + by('no_probe').length);
  console.log('');
  for (const r of report) {
    const parent = r.parent ? r.parent.identifier + ' (' + clean(r.parent.team && r.parent.team.key) + ')' : '—';
    console.log('  ' + r.batch_id.slice(0, 18).padEnd(20)
      + String(r.items).padStart(3) + ' items, ' + String(r.live).padStart(2) + ' live  '
      + r.teams.join(',').padEnd(15) + r.verdict.padEnd(28) + 'parent ' + parent);
  }
  console.log('');
  console.log('Nothing was written. Each `recover_from_child` row would get its batch parent map');
  console.log('written under BOTH team keys pointing at that one issue, with owner_team stamped to');
  console.log('the parent\'s own team — the shape a native batch already uses.');
}

if (require.main === module) {
  main().catch(e => { console.error('batch-parent-recovery-dry-run failed: ' + (e && e.message || e)); process.exit(1); });
}

module.exports = { classifyBatch };
