'use strict';
/*
 * NATIVE ASSIGNEE ELIGIBILITY — the offline half.
 *
 * The confirmed defect (PR1302's actual-handler control): an explicitly chosen
 * VIDEO editor on a server-admitted native intake still reached
 * assertEligibleAssignee -> assigneeEligibilityContext -> assigneeProviderPool
 * whenever `production_assignee_eligibility` was missing, unreadable or
 * strict, so an unreachable Linear refused native work. This suite pins the
 * policy that closes it and the gateway wiring that consumes it:
 *
 *   1. assigneeLanePolicy: a non-empty server-resolved native epoch is the ONLY
 *      thing that makes a lane native; on that lane no flag state can require a
 *      provider mapping or a provider read. The provider lane keeps the
 *      pre-existing contract byte for byte (missing/unreadable/malformed =
 *      strictest, exact retired value = no provider requirement).
 *   2. assigneeEligibility on the native lane still refuses missing, inactive,
 *      wrong-team and wrong-role rows with their exact reasons, and admits an
 *      active compatible member with no linear_user_id.
 *   3. nativeAssigneeCatalogReadiness: the roster-wide readiness aggregate the
 *      dry-run prints (counts only, never a name or id).
 *   4. Source pins on production-write: the native lane never reaches
 *      assigneeProviderPool, the automatic filter follows the same lane
 *      policy, and the intake handler passes its resolved epoch into both
 *      the explicit and the automatic path.
 *
 * The actual-handler half — real handler, real migrations, disposable
 * PostgreSQL, denied provider transport — is test/native-assignee-eligibility.js.
 */
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(ROOT, 'supabase/functions/production-write/index.ts'), 'utf8');
const POLICY_PATH = path.join(ROOT, 'supabase/functions/production-write/policy.mjs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function slice(from, to) {
  const start = edge.indexOf(from);
  if (start < 0) throw new Error('missing ' + from);
  const end = edge.indexOf(to, start + from.length);
  if (end < 0) throw new Error('missing ' + to);
  return edge.slice(start, end);
}

(async () => {
  const policy = await import(pathToFileURL(POLICY_PATH).href);
  const member = (over = {}) => ({
    id: 'm-1', name: 'Fixture Editor', role: 'editor', team: 'video', active: true, linear_user_id: 'lu-1', ...over,
  });

  /* 1. Lane policy matrix. */
  const flagStates = [
    ['missing', undefined, 'missing'], ['unreadable', undefined, 'unreadable'],
    ['malformed string', 'garbage', 'read'], ['malformed array', [], 'read'],
    ['strict', { provider_mapping_required: true }, 'read'], ['string-false', { provider_mapping_required: 'false' }, 'read'],
    ['retired', { provider_mapping_required: false }, 'read'], ['retired json string', '{"provider_mapping_required":false}', 'read'],
  ];
  for (const [label, value, state] of flagStates) {
    const native = policy.assigneeLanePolicy('epoch-video-1', value, state);
    ok(native.lane === 'native' && native.providerMappingRequired === false && native.providerVerificationRequired === false
      && native.policySource === 'native_epoch' && native.nativeEpoch === 'epoch-video-1',
      `native lane ignores the flag when it is ${label}`);
    const provider = policy.assigneeLanePolicy('', value, state);
    const legacy = state === 'read' ? policy.assigneeEligibilityPolicy(value).providerMappingRequired : true;
    ok(provider.lane === 'provider' && provider.providerMappingRequired === legacy && provider.providerVerificationRequired === legacy,
      `provider lane keeps the pre-existing contract when the flag is ${label} (required=${legacy})`);
  }
  ok(policy.assigneeLanePolicy('', null, 'missing').policySource === 'flag_missing'
    && policy.assigneeLanePolicy('', null, 'unreadable').policySource === 'flag_unreadable'
    && policy.assigneeLanePolicy('', { provider_mapping_required: true }).policySource === 'flag_strict'
    && policy.assigneeLanePolicy('', 'garbage').policySource === 'flag_strict'
    && policy.assigneeLanePolicy('', { provider_mapping_required: false }).policySource === 'flag_retired',
    'the provider lane names why it is strict or retired');
  ok(policy.assigneeLaneFor('  ') === 'provider' && policy.assigneeLaneFor(null) === 'provider' && policy.assigneeLaneFor('e') === 'native'
    && Object.isFrozen(policy.assigneeLanePolicy('e', null)) && policy.ASSIGNEE_LANES.includes('native'),
    'whitespace, null and undefined epochs are provider work; the policy object is immutable');

  /* 2. Native-lane eligibility verdicts. */
  const native = policy.assigneeLanePolicy('epoch-video-1', null, 'missing');
  const verdict = (row, team = 'video') => policy.assigneeEligibility(row, team, {
    providerMappingRequired: native.providerMappingRequired, providerActive: null,
  });
  ok(verdict(member()).eligible && verdict(member()).linear_user_id === 'lu-1', 'native lane: active mapped editor is eligible and keeps its optional mapping');
  ok(verdict(member({ linear_user_id: null })).eligible && verdict(member({ linear_user_id: null })).linear_user_id === '',
    'native lane: an active compatible member with NO linear_user_id is eligible (absent optional provider id)');
  ok(verdict(null).reason === 'assignee_not_found' && verdict({}).reason === 'assignee_not_found',
    'native lane: missing native membership is assignee_not_found, not a provider reason');
  ok(verdict(member({ active: false })).reason === 'assignee_inactive', 'native lane: inactive member refused');
  ok(verdict(member({ team: 'graphics' })).reason === 'assignee_out_of_scope', 'native lane: wrong team refused');
  ok(verdict(member({ role: 'smm' })).reason === 'assignee_role_incompatible', 'native lane: wrong role refused');
  ok(verdict(member({ role: 'designer', team: 'graphics' }), 'graphics').eligible
    && verdict(member({ role: 'designer', team: 'graphics', linear_user_id: '' }), 'graphics').eligible,
    'native lane: graphics designer eligible with or without a mapping');
  const providerStrict = policy.assigneeLanePolicy('', null, 'missing');
  ok(policy.assigneeEligibility(member({ linear_user_id: null }), 'video', { providerMappingRequired: providerStrict.providerMappingRequired, providerActive: null }).reason === 'assignee_mapping_unavailable'
    && policy.assigneeEligibility(member(), 'video', { providerMappingRequired: providerStrict.providerMappingRequired, providerActive: null }).reason === 'assignee_provider_unverified',
    'provider lane: unmapped and unverified targets are still refused exactly as before');
  const projection = policy.eligibleAssigneeProjection([
    member(), member({ id: 'm-2', name: 'Fixture Unmapped', linear_user_id: null }), member({ id: 'm-3', name: 'Fixture Retired', active: false }),
    member({ id: 'm-4', name: 'Fixture Manager', role: 'smm' }),
  ], 'video', { providerMappingRequired: native.providerMappingRequired, providerActiveFor: () => null });
  ok(projection.length === 2 && projection.map(row => row.id).sort().join() === 'm-1,m-2' && !projection.some(row => 'linear_user_id' in row),
    'native lane projection lists active compatible members including the unmapped one, never exposing the mapping');

  /* 3. Catalog readiness aggregate. */
  const roster = [
    member(), member({ id: 'm-2', name: 'Fixture Unmapped', linear_user_id: null }), member({ id: 'm-3', active: false }),
    member({ id: 'm-4', role: 'smm' }), { id: 'a-1', name: 'Fixture Admin', role: 'admin', team: null, active: true },
    { id: 'd-1', name: 'Fixture Designer', role: 'designer', team: 'graphics', active: true, default_for_team: true, linear_user_id: null },
  ];
  const ready = policy.nativeAssigneeCatalogReadiness(roster);
  ok(ready.ready === true && ready.teams.video.ready && ready.teams.graphics.ready, 'a roster with an active editor and one active default designer is ready on both teams');
  ok(ready.teams.video.active_creatives === 2 && ready.teams.video.unmapped_creatives === 1 && ready.teams.video.provider_lane_would_refuse === 1
    && ready.teams.video.inactive_creatives === 1 && ready.teams.video.role_incompatible_active === 1
    && ready.teams.graphics.unmapped_creatives === 1 && ready.teams.graphics.eligible_defaults === 1
    && ready.totals.rows === 6 && ready.totals.active === 5 && ready.totals.teamless === 1,
    'readiness reports counts per team: active, unmapped, inactive, role-incompatible, defaults');
  ok(!JSON.stringify(ready).includes('Fixture') && !JSON.stringify(ready).includes('m-1') && !JSON.stringify(ready).includes('lu-1'),
    'readiness output carries no name, id or provider identifier');
  const noDesigner = policy.nativeAssigneeCatalogReadiness(roster.filter(row => row.role !== 'designer'));
  ok(!noDesigner.ready && noDesigner.teams.graphics.reasons.includes('no_active_creative') && noDesigner.teams.graphics.reasons.includes('no_default_designer'),
    'graphics without a designer is not ready, with both reasons named');
  const twoDefaults = policy.nativeAssigneeCatalogReadiness([...roster, { id: 'd-2', role: 'designer', team: 'graphics', active: true, default_for_team: true }]);
  ok(!twoDefaults.ready && twoDefaults.teams.graphics.reasons.includes('ambiguous_default_designer'), 'two active default designers are ambiguous');
  const inactiveDefault = policy.nativeAssigneeCatalogReadiness(roster.map(row => (row.id === 'd-1' ? { ...row, active: false } : row)));
  ok(!inactiveDefault.ready && inactiveDefault.teams.graphics.reasons.includes('default_designer_ineligible') && inactiveDefault.teams.graphics.reasons.includes('no_active_creative'),
    'an inactive default designer is ineligible, not ambiguous');
  const noEditor = policy.nativeAssigneeCatalogReadiness(roster.filter(row => row.role !== 'editor'));
  ok(!noEditor.ready && noEditor.teams.video.reasons.join() === 'no_active_creative' && noEditor.teams.graphics.ready, 'video without an active editor is not ready; graphics readiness is independent');
  ok(policy.nativeAssigneeCatalogReadiness(null).totals.rows === 0 && policy.nativeAssigneeCatalogReadiness([null, 'x', 4]).totals.rows === 0,
    'garbage input is an empty roster, not a crash');

  /* 4. Gateway wiring pins. */
  const lanePolicyFor = slice('async function assigneeLanePolicyFor(', 'async function assigneeProviderPool(');
  const flagReader = slice('async function assigneeEligibilityPolicyFor(', 'async function assigneeLanePolicyFor(');
  ok(/if \(clean\(nativeEpoch\)\) return assigneeLanePolicy\(nativeEpoch, null, "read"\);/.test(lanePolicyFor)
    && lanePolicyFor.indexOf('return assigneeLanePolicy(nativeEpoch') < lanePolicyFor.indexOf('assigneeEligibilityPolicyFor(supabase)')
    && /if \(error \|\| !data\) return \{ providerMappingRequired: true \}/.test(flagReader)
    && /catch \(_error\) \{\s*return \{ providerMappingRequired: true \};/.test(flagReader)
    && !/from\("syncview_runtime_flags"\)/.test(lanePolicyFor),
    'assigneeLanePolicyFor returns the native policy BEFORE the unchanged flag reader runs; missing and unreadable reads stay strictest on the provider lane');
  const context = slice('async function assigneeEligibilityContext(', 'async function assigneeRosterRow(');
  ok(/nativeEpoch = ""/.test(context) && /assigneeLanePolicyFor\(supabase, nativeEpoch\)/.test(context)
    && /if \(!policy\.providerMappingRequired \|\| !needsProvider\) \{[\s\S]{0,120}return \{ \.\.\.policy, providerActiveFor: \(\) => null \};/.test(context)
    && context.indexOf('providerActiveFor: () => null') < context.indexOf('await assigneeProviderPool()'),
    'assigneeEligibilityContext cannot reach assigneeProviderPool when the lane policy does not require a mapping');
  const assertFn = slice('async function assertEligibleAssignee(', 'async function validateAssignee(');
  ok(/nativeEpoch = ""/.test(assertFn) && /if \(!assigneeId\) return null;/.test(assertFn)
    && assertFn.indexOf('if (!assigneeId) return null;') < assertFn.indexOf('assigneeRosterRow(')
    && /assigneeEligibilityContext\(supabase, !!member, nativeEpoch\)/.test(assertFn),
    'assertEligibleAssignee takes the lane epoch and returns for null unassignment before any roster, policy or provider read');
  const auto = slice('async function intakeAssigneePool(', 'SUBMIT-TAB THUMBNAIL TEXT');
  ok(/nativeEpoch = ""/.test(auto) && /const policy = await assigneeLanePolicyFor\(supabase, nativeEpoch\);/.test(auto)
    && /\.filter\(member => !policy\.providerMappingRequired \|\| clean\(member\.linear_user_id\)\)/.test(auto)
    && /default_for_team/.test(auto) && /graphics_default_assignee_unavailable/.test(auto) && /video_assignee_pool_unavailable/.test(auto)
    && !/assigneeProviderPool|linearRead\(/.test(auto),
    'the automatic pool filter follows the same lane policy, keeps both readiness refusals, and never reads the provider');
  ok(/const members = await intakeAssigneePool\(supabase, normalizedTeam, nativeEpoch\);/.test(auto), 'autoAssigneeForIntake draws from that pool');
  const intake = slice('async function handleIntakeCreate(', 'const rootManifest: JsonMap = {');
  ok(/await assertEligibleAssignee\(supabase, requestedByTeam\[team\], team, nativeEpochByTeam\[team\]\)/.test(intake)
    && /await autoAssigneeForIntake\(supabase, team, nativeEpochByTeam\[team\]\)/.test(intake)
    && intake.indexOf('const nativeEpochByTeam = await intakeEpochs(') < intake.indexOf('assertEligibleAssignee(supabase, requestedByTeam'),
    'intake resolves its native epochs first and hands them to both the explicit and the automatic assignment path');
  ok(/validateAssignee\([\s\S]{0,120}assertEligibleAssignee\(supabase, assigneeId, team\);/.test(edge)
    && /validateCreateAssignee\([\s\S]{0,140}return await assertEligibleAssignee\(supabase, assigneeId, team\);/.test(edge)
    && /assignees: await mappedCreateAssignees\(supabase, team\),/.test(edge),
    'the SyncLinear assignee operation, Production create and both pickers stay on the provider lane (no epoch passed)');
  ok(/assigneeLanePolicy,/.test(edge.slice(0, edge.indexOf('} from "./policy.mjs"'))), 'the gateway imports the lane policy from policy.mjs');

  if (failures) { console.error(`\n${failures} native assignee policy check(s) failed`); process.exit(1); }
  console.log('\nNative assignee policy checks passed');
})().catch(error => { console.error(error); process.exit(1); });
