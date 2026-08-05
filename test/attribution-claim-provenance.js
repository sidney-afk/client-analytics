'use strict';

/*
 * The attribution stamp comparison, after separating the CLAIM from its
 * PROVENANCE (docs/audits/2026-08-05-attribution-stamp-soak-signal.md).
 *
 * The point of this file is NOT that the diffs went away. It is that the diffs
 * that went away are exactly the noise and nothing else. Every case below that
 * asserts "still diffs" is a sabotage: it takes a row whose stamp was correct,
 * changes one thing about who the row belongs to or how that was concluded, and
 * requires that `compareAttribution` still calls it out. If one of those starts
 * passing silently, the comparison has been widened too far.
 */

const {
  compareAttribution,
  attributionClaimDelta,
  ATTRIBUTION_PROVENANCE_FIELDS,
  summarize,
} = require('../scripts/linear-deliverables-reconcile-lib');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

const ROSTER_NOW = 'a'.repeat(64);
const ROSTER_OLD = 'b'.repeat(64);

// What the reconciler computes for a mapped, direct-project row.
function computed(overrides) {
  return Object.assign({
    schema: 'syncview_attribution_v1',
    state: 'resolved',
    client_slug: 'client-one',
    owner_kind: 'client',
    source: 'direct_project',
    project_id: 'project-one',
    direct_project_id: 'project-one',
    ancestor_issue_id: null,
    ancestor_distance: null,
    mapping_revision: ROSTER_NOW,
    repair_required: false,
    reason: 'direct_project_mapped',
  }, overrides || {});
}

// What `production-write` actually stamps on a row it creates: the same claim,
// no roster revision. The two absent ancestor keys are what the DEPLOYED
// function writes today; the repository source now writes them as explicit
// nulls. Both shapes are exercised below, because the fix must hold whether or
// not the Edge Function has been deployed.
function stampedByGateway(overrides) {
  const stamp = computed(Object.assign({ mapping_revision: '' }, overrides || {}));
  delete stamp.ancestor_issue_id;
  delete stamp.ancestor_distance;
  return stamp;
}

function run(current, attribution, rowClientSlug) {
  const out = {
    row: { client_slug: rowClientSlug === undefined ? 'client-one' : rowClientSlug },
    patch: {},
    diffs: [],
    tolerated: [],
    repairs: [],
  };
  compareAttribution(out, { attribution }, JSON.stringify({ attribution: current }));
  return out;
}

function attributionDiffs(out) {
  return out.diffs.filter(d => d.field === 'client_attribution');
}

function toleratedReasons(out) {
  return out.tolerated.filter(t => t.field === 'client_attribution').map(t => t.reason);
}

console.log('provenance is exactly one field');
ok(ATTRIBUTION_PROVENANCE_FIELDS.size === 1 && ATTRIBUTION_PROVENANCE_FIELDS.has('mapping_revision'),
  'mapping_revision is the only field excluded from the claim');

/*
 * SABOTAGE CASES. Each starts from a stamp that matches and changes one thing.
 */

console.log('sabotage: the stamp names a different client');
{
  const out = run(computed({ client_slug: 'client-two' }), computed());
  const diffs = attributionDiffs(out);
  ok(diffs.length === 1 && diffs[0].reason === 'attribution_claim_mismatch',
    'wrong client_slug still diffs');
  ok(diffs[0].changed_claim_fields.includes('client_slug'),
    'the diff names client_slug as the field that moved');
}

console.log('sabotage: the stamp claims a different resolution state');
{
  const out = run(computed({ state: 'needs_attribution' }), computed());
  const diffs = attributionDiffs(out);
  ok(diffs.length === 1 && diffs[0].reason === 'attribution_claim_mismatch',
    'changed state still diffs');
  ok(diffs[0].changed_claim_fields.includes('state'), 'the diff names state');
}

console.log('sabotage: the ancestor path moved');
{
  const viaAncestor = computed({
    source: 'nearest_mapped_ancestor',
    ancestor_issue_id: 'issue-ancestor-new',
    ancestor_distance: 2,
    reason: 'nearest_mapped_ancestor',
  });
  const stale = Object.assign({}, viaAncestor, {
    ancestor_issue_id: 'issue-ancestor-old',
    ancestor_distance: 1,
  });
  const out = run(stale, viaAncestor);
  const diffs = attributionDiffs(out);
  ok(diffs.length === 1 && diffs[0].reason === 'attribution_claim_mismatch',
    'changed ancestor path still diffs');
  ok(diffs[0].changed_claim_fields.includes('ancestor_issue_id')
    && diffs[0].changed_claim_fields.includes('ancestor_distance'),
    'the diff names both ancestor fields');
}

console.log('sabotage: null ancestor -> real ancestor is not swallowed by null-normalisation');
{
  // The claim treats absent and null alike. It must NOT treat null and a real
  // value alike, or "this row is now owned via an ancestor" would go unseen.
  const out = run(stampedByGateway(), computed({
    source: 'nearest_mapped_ancestor',
    ancestor_issue_id: 'issue-ancestor',
    ancestor_distance: 1,
    reason: 'nearest_mapped_ancestor',
  }));
  ok(attributionDiffs(out).length === 1, 'null -> populated ancestor still diffs');
}

console.log('sabotage: extra keys the conflict and provisional states carry');
{
  // These are why the claim is "everything except mapping_revision" and not an
  // allowlist of the ten documented keys: an allowlist would stop comparing
  // them, and a provisional owner flipping clients would go silent.
  const provisional = {
    schema: 'syncview_attribution_v1',
    state: 'provisional_child_family',
    client_slug: null,
    owner_kind: null,
    source: 'unanimous_child_family',
    project_id: null,
    direct_project_id: null,
    ancestor_issue_id: null,
    ancestor_distance: null,
    provisional_client_slug: 'client-one',
    child_issue_count: 3,
    mapping_revision: ROSTER_NOW,
    repair_required: true,
    reason: 'projectless_parent_unanimous_child_family',
  };
  const flipped = Object.assign({}, provisional, { provisional_client_slug: 'client-two' });
  const out = run(flipped, provisional, null);
  ok(attributionDiffs(out).length === 1,
    'a provisional owner flipping client still diffs');
  ok(attributionDiffs(out)[0].changed_claim_fields.includes('provisional_client_slug'),
    'the diff names provisional_client_slug');
}

console.log('sabotage: resolution source and reason');
{
  const outSource = run(computed({ source: 'explicit_classification' }), computed());
  ok(attributionDiffs(outSource).length === 1, 'changed source still diffs');
  const outReason = run(computed({ reason: 'owner_classified' }), computed());
  ok(attributionDiffs(outReason).length === 1, 'changed reason still diffs');
  const outRepair = run(computed({ repair_required: true }), computed());
  ok(attributionDiffs(outRepair).length === 1, 'changed repair_required still diffs');
  const outProject = run(computed({ project_id: 'project-two' }), computed());
  ok(attributionDiffs(outProject).length === 1, 'changed project_id still diffs');
}

console.log('sabotage: a row with no stamp at all');
{
  const out = run({}, computed());
  ok(attributionDiffs(out).length === 1 && attributionDiffs(out)[0].actual === null,
    'an unstamped row still diffs');
}

/*
 * THE NOISE. These are the cases the change is meant to remove, and the only
 * ones.
 */

console.log('noise removed: a correct claim computed under an older roster');
{
  const out = run(computed({ mapping_revision: ROSTER_OLD }), computed());
  ok(attributionDiffs(out).length === 0, 'an older roster hash is not a diff');
  ok(toleratedReasons(out).includes('attribution_revision_stale'),
    'it is counted as attribution_revision_stale instead');
}

console.log('noise removed: the stamp production-write actually writes');
{
  const out = run(stampedByGateway(), computed());
  ok(out.diffs.length === 0,
    'a row created by the write gateway produces ZERO diffs where the project is mapped');
  ok(toleratedReasons(out).includes('attribution_revision_unstamped'),
    'an empty revision is counted apart from a genuinely stale one');
  ok(out.repairs.length === 0, 'and it is not a repair row either');
}

console.log('noise removed: the stamp the repository source writes after deploy');
{
  const withExplicitNulls = computed({ mapping_revision: '' });
  const out = run(withExplicitNulls, computed());
  ok(out.diffs.length === 0,
    'explicit-null ancestor keys also produce zero diffs — the fix is deploy-independent');
}

console.log('an exactly-current stamp is neither a diff nor tolerated');
{
  const out = run(computed(), computed());
  ok(out.diffs.length === 0 && out.tolerated.length === 0,
    'a fully matching stamp is silent');
}

console.log('claim delta reports only what moved');
{
  const delta = attributionClaimDelta(
    computed({ client_slug: 'client-two', mapping_revision: ROSTER_OLD }),
    computed(),
  );
  ok(delta.matches === false && delta.changed.join(',') === 'client_slug',
    'mapping_revision never appears in the changed field list');
}

/*
 * VISIBILITY. Non-gating, but it has to be countable or it is not a signal.
 */

console.log('the staleness counter is surfaced by summarize()');
{
  const stale = reason => ({
    team: 'video',
    entity: 'deliverable',
    direction: 'outbound',
    authority: 'syncview',
    diffs: [],
    tolerated: [{ field: 'client_attribution', reason }],
    repairs: [],
  });
  const s = summarize([stale('attribution_revision_stale'), stale('attribution_revision_stale'),
    stale('attribution_revision_unstamped')], []);
  ok(s.attribution_stamp_revision_stale === 2, 'stale stamps are counted');
  ok(s.attribution_stamp_revision_stale_rows === 2, 'and the affected row count is reported');
  ok(s.attribution_stamp_revision_unstamped === 1, 'unstamped rows are counted separately');
  ok(s.by_team.video.attribution_stamp_revision_stale === 2, 'the counter is broken out per team');
  ok(s.outbound_diff_count === 0,
    'and none of it reaches outbound_diff_count — the soak signal stays clean');
}

console.log('the reconcile summary states the staleness share outright');
{
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
  ok(source.includes('attributionStaleBanner'),
    'summaryMarkdown renders a dedicated banner, not just a table row');
  ok(/Attribution stamps on an older client roster/.test(source),
    'the banner names the condition in words');
  ok(/% of rows checked/.test(source),
    'the banner reports the share of rows, so a small absolute number is still readable');
}

console.log('the pager reports staleness as context and never fires on it');
{
  const pager = require('../scripts/linear-reconcile-inbound-pager');
  const event = { payload: { summary: { attribution_stamp_revision_stale: 7 } } };
  ok(pager.staleStampCount(event) === 7, 'the pager reads the counter as context');
  ok(!pager.ALERT_CLASSES.some(entry => entry.key === 'attribution_stamp_revision_stale'),
    'and it is not an alert class — it can never latch the pager');
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'scripts', 'linear-reconcile-inbound-pager.js'), 'utf8');
  ok(/stale_stamp_context/.test(source), 'the page body carries the stale-stamp trend');
  ok(/attribution_stamp_revision_stale_counts/.test(source),
    'and the marker row records it, so the trend is queryable');
}

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log('\nattribution claim/provenance separation: all checks passed');
