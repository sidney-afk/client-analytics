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
 *   B. THE DELIVERABLE **IS** A BATCH PARENT — VID-13346 and VID-13355 are both
 *      titled "<client> · 17 Aug 2026" (F64: this repo is public, so no client
 *      is named here). Both have NO parent, were authored by "SyncView Mirror",
 *      and carry a Filming Plan link as their description. Those are parent issues that were imported INTO
 *      `deliverables` as if they were work. For the batch, that issue is the
 *      answer. For the deliverables table it is a separate defect and this
 *      script only reports it — a row that is not a deliverable should not be
 *      quietly repurposed into one.
 *
 * Shape B is why this is a script and not a SQL statement: "read the child's
 * parent" is wrong for a child that has none and is one.
 *
 * BUT "no parent" IS NOT ITSELF SHAPE B. A plain top-level issue also has no
 * parent, and the first version of this script called every one of them the
 * batch parent. It is shape B only when it carries one of the two measured
 * signals — the SyncView Mirror authorship or the Filming Plan description —
 * and without either, the honest verdict is that we do not know.
 *
 * Likewise a probe that FAILS stays a failure all the way to the verdict. A
 * blip on one child of a two-child batch used to leave one survivor, and one
 * survivor with a parent reads as unanimous: the batch would have been handed a
 * parent that the unread child might have contradicted. Any unread child makes
 * the batch `probe_incomplete` — re-run it, do not act on it.
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
/*
 * A PROBE IS A RECORD OF AN ATTEMPT, NOT AN ISSUE.
 *
 * It used to be the issue object or `null`, and `classifyBatch` filtered the
 * nulls away — so a network blip on one child of a two-child batch left one
 * survivor, and one survivor with a parent reads as unanimous. The batch would
 * have been recommended a parent that the child we could not read might have
 * contradicted. A failure has to stay visible all the way to the verdict.
 */
function probeOk(identifier, issue) { return { identifier, ok: true, issue }; }
function probeFailed(identifier, reason) { return { identifier, ok: false, reason }; }

/*
 * `creator` and `description` are not decoration: they are the only things that
 * separate shape B (a batch parent imported into `deliverables`) from an
 * ordinary top-level issue that simply has no parent. Without them a parentless
 * issue was being named the batch parent unconditionally.
 *
 * `description` is read for a boolean and never printed — it can carry client
 * detail (F64).
 */
async function linearIssue(identifier) {
  const res = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_KEY },
    body: JSON.stringify({
      query: `query($id:String!){ issue(id:$id){ id identifier title description team{key} project{id name}
                creator{ name displayName }
                parent{ id identifier title team{key} project{id} } } }`,
      variables: { id: identifier },
    }),
  });
  if (!res.ok) throw new Error('linear HTTP ' + res.status);
  const body = await res.json();
  if (body.errors) throw new Error('linear: ' + clean(body.errors[0] && body.errors[0].message));
  return body.data && body.data.issue;
}

/* One retry, because a single blip should not downgrade a whole batch's
   verdict to "come back later" when asking again would have answered it. */
async function probeIssue(identifier) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const issue = await linearIssue(identifier);
      if (issue && clean(issue.id)) return probeOk(identifier, issue);
      return probeFailed(identifier, 'linear has no issue ' + identifier);
    } catch (error) {
      if (attempt) return probeFailed(identifier, clean(error && error.message) || 'probe failed');
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  return probeFailed(identifier, 'probe failed');
}

/*
 * SHAPE-B SIGNALS. Measured on VID-13346 and VID-13355: no parent, authored by
 * "SyncView Mirror", Filming Plan link as the description. Either signal is
 * enough to call it a batch parent; NEITHER means we do not know what it is,
 * and saying so is the whole point.
 */
const BATCH_PARENT_AUTHORS = ['syncview mirror'];
/* Loose enough to survive punctuation and case drift between the two systems,
   strict enough that "Reel 03" never matches "Example Co | Episode 06". */
function titleKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function batchParentSignals(issue, context) {
  const found = [];
  const author = (clean(issue && issue.creator && issue.creator.name)
    || clean(issue && issue.creator && issue.creator.displayName)).toLowerCase();
  if (author && BATCH_PARENT_AUTHORS.includes(author)) found.push('authored by ' + author);
  if (/filming\s*plan/i.test(clean(issue && issue.description))) found.push('filming plan description');
  /* THE THIRD SIGNAL, found by running the dry run against all 26 on
     2026-08-25. Two batches held a single parentless issue authored by a
     PERSON with an ordinary description -- GRA-4431 and GRA-6816 -- so neither
     of the first two signals fired and both came back ambiguous. But each of
     those issues is titled EXACTLY what its batch is named, and that is what a
     batch parent is: the issue the batch was named after. A child never
     carries it -- children are "Reel 03", "Thumbnail 1", "Video 1". */
  const batchName = titleKey(context && context.batchName);
  if (batchName && titleKey(issue && issue.title) === batchName) found.push('titled as the batch');
  return found;
}

/*
 * THE JUDGEMENT, pure, so both shapes are testable without a network.
 *
 * The dangerous outcome here is not "no answer" — it is a confident wrong one,
 * because the caller writes what this returns. So there are exactly two ways to
 * get a parent out of it, and everything else is a refusal that names why.
 */
/* The verdict is what gets printed, including under --json. A shape-B parent is
   a full issue with a description on it, and descriptions can carry client
   detail (F64) — so the verdict carries an identity, never the body. */
function asParent(issue) {
  return { id: clean(issue && issue.id), identifier: clean(issue && issue.identifier),
    title: clean(issue && issue.title),
    team: { key: clean(issue && issue.team && issue.team.key) },
    project: { id: clean(issue && issue.project && issue.project.id) } };
}

/* Linear's team KEY is the short code on the identifier (VID-13276, GRA-7034);
   `linear_parent_ids` is keyed by the app's team names. Same mapping the rest
   of the repo uses (`scripts/b1-cursor-gap-report.js`). An unknown key gets no
   lane rather than a guessed one — that is what makes the split refusable. */
const TEAM_LANES = { VID: 'video', GRA: 'graphics' };
function teamKey(value) { return TEAM_LANES[clean(value).toUpperCase()] || ''; }

function classifyBatch(probes, context) {
  const all = (probes || []).filter(Boolean);
  const failed = all.filter(p => p.ok === false);
  const seen = all.filter(p => p.ok !== false && p.issue).map(p => p.issue);

  if (!all.length) return { verdict: 'no_probe', reason: 'no child named a Linear issue' };
  /* A partial read cannot produce a verdict: the child we could not reach is
     exactly the one that might have disagreed. Re-runnable, not human-bound. */
  if (failed.length) {
    return { verdict: 'probe_incomplete',
      reason: failed.length + ' of ' + all.length + ' probes did not return an issue',
      unread: failed.map(p => p.identifier),
      unread_reasons: failed.map(p => p.identifier + ': ' + clean(p.reason)) };
  }
  if (!seen.length) return { verdict: 'no_probe', reason: 'no child named a Linear issue' };

  const parents = new Map();
  const parentless = [];
  for (const issue of seen) {
    if (issue.parent && clean(issue.parent.id)) parents.set(clean(issue.parent.id), issue.parent);
    else parentless.push(issue);
  }
  const signalled = parentless.filter(issue => batchParentSignals(issue, context).length);

  if (parents.size > 1) {
    /* NOT EVERY DISAGREEMENT IS ONE. `linear_parent_ids` is keyed BY TEAM, so
       two parents are the right answer when the split follows the children's
       own teams -- the video children under one issue, the graphics children
       under another. Measured on a real batch (2026-08-25): two video children
       under VID-13276, three graphics children under GRA-7034, which the first
       version called a disagreement and refused.
       Two children of the SAME team under different parents is still a real
       disagreement, and still refused. */
    const byTeam = new Map();
    let split = true;
    for (const issue of seen) {
      if (!issue.parent || !clean(issue.parent.id)) continue;
      const team = teamKey(issue.team && issue.team.key);
      if (!team) { split = false; break; }
      if (!byTeam.has(team)) byTeam.set(team, new Map());
      byTeam.get(team).set(clean(issue.parent.id), issue.parent);
      if (byTeam.get(team).size > 1) { split = false; break; }
    }
    if (split && byTeam.size === parents.size) {
      const parentsByTeam = {};
      for (const [team, one] of byTeam) parentsByTeam[team] = asParent([...one.values()][0]);
      return { verdict: 'recover_per_team', parents: parentsByTeam,
        also_parentless: parentless.map(i => i.identifier),
        also_self_parent: signalled.map(i => i.identifier) };
    }
    return { verdict: 'ambiguous', reason: 'children disagree on their parent',
      candidates: [...parents.values()].map(p => p.identifier) };
  }
  if (parents.size === 1) {
    return { verdict: 'recover_from_child', parent: asParent([...parents.values()][0]),
      also_parentless: parentless.map(i => i.identifier),
      also_self_parent: signalled.map(i => i.identifier) };
  }
  /* Nothing has a parent. Only a shape-B signal makes one of these THE parent;
     a plain top-level issue with no signal is just an issue with no parent, and
     naming it the batch parent would be the confident wrong answer. */
  if (signalled.length === 1) {
    return { verdict: 'deliverable_is_the_parent', parent: asParent(signalled[0]),
      signals: batchParentSignals(signalled[0], context),
      also_parentless: parentless.filter(i => i !== signalled[0]).map(i => i.identifier) };
  }
  if (signalled.length > 1) {
    return { verdict: 'ambiguous', reason: 'several issues look like the batch parent',
      candidates: signalled.map(i => i.identifier) };
  }
  return { verdict: 'ambiguous',
    reason: parentless.length === 1
      ? 'the only child has no parent and carries no batch-parent signal'
      : 'several parentless issues and no shared parent',
    candidates: parentless.map(i => i.identifier) };
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
      const probe = await probeIssue(id);
      if (!probe.ok) console.error('  probe failed for ' + id + ': ' + probe.reason);
      probes.push(probe);
    }
    const verdict = classifyBatch(probes, { batchName: clean(batch.name) });
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
  console.log('  needs a human (no safe answer)       : ' + by('ambiguous').length);
  console.log('  Linear could not be read — RE-RUN    : ' + by('probe_incomplete').length);
  console.log('  no child named a Linear issue        : ' + by('no_probe').length);
  console.log('');
  for (const r of report) {
    const parent = r.parent ? r.parent.identifier + ' (' + clean(r.parent.team && r.parent.team.key) + ')' : '—';
    console.log('  ' + r.batch_id.slice(0, 18).padEnd(20)
      + String(r.items).padStart(3) + ' items, ' + String(r.live).padStart(2) + ' live  '
      + r.teams.join(',').padEnd(15) + r.verdict.padEnd(28) + 'parent ' + parent);
  }
  const incomplete = by('probe_incomplete');
  if (incomplete.length) {
    console.log('');
    console.log('RE-RUN before acting — Linear did not answer for:');
    for (const r of incomplete) console.log('  ' + r.batch_id.slice(0, 18) + '  ' + r.unread.join(', '));
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
