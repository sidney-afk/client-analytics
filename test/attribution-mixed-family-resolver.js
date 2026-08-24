'use strict';
/*
 * The SHARED resolver must answer the mixed-family question the way the other
 * two components already do.
 *
 * WHAT THIS FIXES (2026-08-24). One person can be several clients here — a
 * personal brand, a paid-ads brand, a DJ brand — each with its own roster row
 * and its own Linear project. A manager files ONE parent with children across
 * two of them. `linear-inbound` decided on 2026-08-23 that a child's own
 * project outranks its parent (`own_project_outranks_parent`), and the browser
 * followed on 2026-08-24 (`selfAttributed`, index.html, covered by
 * test/attribution-mixed-family.js). `scripts/f200-attribution.js` did not —
 * and B1, the deliverables reconciler and the shadow audit all read THIS
 * resolver, so for those components the families stayed `conflict`.
 *
 * That split had a live cost, not a cosmetic one. `compareAttribution` proposes
 * moving any non-resolved row to the unresolved SENTINEL slug
 * (`linear-deliverables-reconcile-lib.js:287`), and a sentinel row appears in
 * NO client view at all. Measured on live data the day this landed: 27 rows —
 * every deliverable of one client's two secondary brands — read `conflict`
 * here and `resolved` in the browser, and the daily shadow audit had been
 * reporting them as unexplained divergences for three days.
 *
 * The three properties below are the three ways this change could be wrong:
 * it could fail to fix the mixed family, it could swallow the conflict the
 * rule was actually built for, or it could let one disagreement keep
 * propagating across the rest of the family.
 */
const path = require('node:path');
const { resolveAttributionGraph } = require(path.join(__dirname, '..', 'scripts', 'f200-attribution'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* One person, two brands, two projects, two roster rows — the real shape. */
const clients = [
  {
    slug: 'brand-primary',
    display_name: 'Primary Brand',
    kind: 'client',
    active: true,
    linear_project_ids: { video: 'project-primary', graphics: { id: 'project-primary' } },
  },
  {
    slug: 'brand-secondary',
    display_name: 'Secondary Brand',
    kind: 'client',
    active: true,
    linear_project_ids: { video: 'project-secondary', graphics: { id: 'project-secondary' } },
  },
];

const issue = (id, projectId, parentId) => ({
  id,
  identifier: id.toUpperCase(),
  title: id,
  project: projectId ? { id: projectId } : null,
  parent: parentId ? { id: parentId } : null,
});

// ---- 1. The mixed family resolves, and each row keeps its OWN client -------
// Parent in the primary brand's project; two children there, two in the
// secondary brand's. This is the measured live shape, reduced.
const mixed = resolveAttributionGraph([
  issue('mf-parent', 'project-primary', null),
  issue('mf-same-1', 'project-primary', 'mf-parent'),
  issue('mf-same-2', 'project-primary', 'mf-parent'),
  issue('mf-other-1', 'project-secondary', 'mf-parent'),
  issue('mf-other-2', 'project-secondary', 'mf-parent'),
], clients, { familyComplete: true });

const states = id => mixed.byIssueId.get(id);
ok(states('mf-parent').state === 'resolved' && states('mf-parent').client_slug === 'brand-primary',
  'the parent keeps the client ITS OWN project names');
ok(states('mf-other-1').state === 'resolved' && states('mf-other-1').client_slug === 'brand-secondary',
  'a child in the other brand keeps the client ITS OWN project names — the parent does not out-vote it');
ok(states('mf-other-2').state === 'resolved' && states('mf-other-2').client_slug === 'brand-secondary',
  'and so does its sibling');
ok(states('mf-same-1').state === 'resolved' && states('mf-same-2').state === 'resolved',
  'the UNINVOLVED children stay resolved — one disagreement no longer spreads across the family');
ok((mixed.summary.by_state.conflict || 0) === 0,
  'the whole family reports zero conflicts, so nothing here is proposed for the unresolved sentinel');

// ---- 2. The conflict the rule was BUILT for still fires --------------------
// A child with NO project of its own has to read its client from the family.
// Its source is `nearest_mapped_ancestor`, which is not self-attribution, so a
// disagreement involving it is still a real conflict.
const projectless = resolveAttributionGraph([
  issue('pl-parent', 'project-primary', null),
  issue('pl-child', null, 'pl-parent'),
], clients, { familyComplete: true });
const plChild = projectless.byIssueId.get('pl-child');
ok(plChild.state === 'resolved' && plChild.source === 'nearest_mapped_ancestor'
  && plChild.client_slug === 'brand-primary',
  'a projectless child still inherits its client from the nearest mapped ancestor');
ok(!(plChild.source === 'direct_project'),
  'and it is NOT self-attributed — which is what keeps the built-for case conflicting');

// ---- 3. A genuine conflict still propagates to non-self-attributed rows ----
// An explicit classification that disagrees with the row's own mapped project
// is a human and a mapping contradicting each other: still a conflict, and it
// must still reach relatives that cannot speak for themselves.
const propagated = resolveAttributionGraph([
  issue('pr-parent', 'project-primary', null),
  issue('pr-child', null, 'pr-parent'),
], clients, {
  familyComplete: true,
  explicitClassifications: {
    'pr-parent': {
      classification: 'explicit_roster',
      client_slug: 'brand-secondary',
      reason: 'owner_classified',
    },
  },
});
const prParent = propagated.byIssueId.get('pr-parent');
const prChild = propagated.byIssueId.get('pr-child');
ok(prParent.state === 'conflict'
  && prParent.reason === 'explicit_classification_disagrees_with_project_mapping',
  'an explicit classification fighting the project mapping is STILL a conflict');
ok(prChild.state === 'conflict' && prChild.reason === 'hierarchy_conflict_propagated',
  'and it still reaches a child that has no project of its own — propagation is narrowed, not removed');

// ---- 3b. A REAL conflict does not infect a self-attributed relative -------
// The narrowing has two halves and they fail independently: the parent guard
// and the child guard. Each needs a family where the OTHER side is genuinely
// conflicted and this side speaks for itself from its own project.
const conflictedChild = resolveAttributionGraph([
  issue('cc-parent', 'project-primary', null),
  issue('cc-child', 'project-primary', 'cc-parent'),
], clients, {
  familyComplete: true,
  explicitClassifications: {
    'cc-child': { classification: 'explicit_roster', client_slug: 'brand-secondary', reason: 'owner_classified' },
  },
});
ok(conflictedChild.byIssueId.get('cc-child').state === 'conflict',
  'a child whose explicit classification fights its own mapping is conflicted');
ok(conflictedChild.byIssueId.get('cc-parent').state === 'resolved'
  && conflictedChild.byIssueId.get('cc-parent').client_slug === 'brand-primary',
  'and its PARENT, which has a project of its own, does not catch that conflict');

const conflictedParent = resolveAttributionGraph([
  issue('cp-parent', 'project-primary', null),
  issue('cp-child', 'project-primary', 'cp-parent'),
], clients, {
  familyComplete: true,
  explicitClassifications: {
    'cp-parent': { classification: 'explicit_roster', client_slug: 'brand-secondary', reason: 'owner_classified' },
  },
});
ok(conflictedParent.byIssueId.get('cp-parent').state === 'conflict',
  'a parent whose explicit classification fights its own mapping is conflicted');
ok(conflictedParent.byIssueId.get('cp-child').state === 'resolved'
  && conflictedParent.byIssueId.get('cp-child').client_slug === 'brand-primary',
  'and its CHILD, which has a project of its own, does not catch that conflict either');

// ---- 4. The three components now agree on the helper --------------------
// The browser and this resolver must share the rule, not merely both have one.
// Pinning the predicate keeps a later edit to either side visible.
const fs = require('node:fs');
const resolverSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f200-attribution.js'), 'utf8');
const browserSource = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const predicate = /state === 'resolved'\s*\n?\s*&& \(entry\.source === 'direct_project' \|\| \/\^explicit_\/\.test\(String\(entry\.source \|\| ''\)\)\)/;
ok(predicate.test(resolverSource), 'the resolver carries the self-attribution predicate');
ok(/entry\.source === 'direct_project' \|\| \/\^explicit_\/\.test/.test(browserSource),
  'and the browser carries the same one — one question, one answer, three components');
ok(/if \(selfAttributed\(parentResult\) && selfAttributed\(childResult\)\) continue;/.test(resolverSource),
  'the disagreement branch defers to BOTH sides being self-attributed, never just one');

if (failures) {
  console.error(`\n${failures} mixed-family resolver check(s) failed`);
  process.exit(1);
}
console.log('\nmixed-family resolver checks passed');
