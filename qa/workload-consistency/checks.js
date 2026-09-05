'use strict';
const assert = require('node:assert/strict');
const { compare } = require('./compare');
const { snapshot, issue, discrepancySnapshot } = require('./fixtures');
const { boardContext, context, cardStatus, source, extract } = require('./source-harness');
async function runChecks() {
  const results = [];
  async function check(id, fn) {
    try { await fn(); results.push({ id, verdict: 'PASS' }); }
    catch (_) { results.push({ id, verdict: 'FAIL', failureClass: 'assertion_or_harness_failure' }); }
  }
  const count = (s, code) => compare(s).counts[code] || 0;
  await check('C01-owner-native-legacy-alias', () => assert.equal(count(snapshot(), 'owner_mismatch'), 0));
  await check('C02-owner-mismatch', () => {
    const s = snapshot(); s.workload[0].ownerId = null;
    assert.equal(count(s, 'owner_mismatch'), 1);
  });
  await check('C03-active-role-and-team', () => {
    const s = snapshot(); Object.assign(s.members[0], { active: false, roles: ['smm'], teams: ['graphics'] });
    assert.equal(count(s, 'inactive_owner'), 1); assert.equal(count(s, 'owner_role_or_team_mismatch'), 1);
  });
  await check('C04-ambiguous-owner-does-not-last-win', () => {
    const s = snapshot(); s.members.push({ ...s.members[0], id: 'member-2' });
    assert(count(s, 'ambiguous_owner_identity') > 0);
  });
  await check('C05-status-drift-versus-card-vocabulary', () => {
    const s = snapshot(); assert.equal(count(s, 'status_mismatch'), 0);
    s.workload[0].status = 'For Kasper approval'; assert.equal(count(s, 'status_mismatch'), 1);
    assert.equal(cardStatus('todo', 'calendar'), 'In Progress');
    assert.equal(cardStatus('scheduled', 'samples'), null);
    assert.equal(cardStatus('posted', 'calendar'), 'Posted');
    assert.equal(cardStatus('duplicate', 'calendar'), null);
  });
  await check('C06-canonical-due-versus-publish-date', () => {
    const s = snapshot(); assert.equal(count(s, 'canonical_due_mismatch'), 0);
    assert.equal(count(s, 'intentional_date_semantics'), 1);
    s.workload[0].dueDate = '2026-09-11'; assert.equal(count(s, 'canonical_due_mismatch'), 1);
  });
  await check('C07-native-only-never-disappears-from-denominator', () => {
    const s = snapshot(); s.native[0].linearId = null; s.provider = []; s.workload = [];
    s.calendar[0].linearId = null;
    assert.equal(count(s, 'native_only'), 1); assert.equal(count(s, 'native_missing_from_workload'), 1);
  });
  await check('C08-provider-only-versus-genuinely-absent', () => {
    const s = snapshot(); s.native = [];
    assert.equal(count(s, 'provider_only'), 1); assert.equal(count(s, 'genuinely_absent'), 0);
    assert.equal(count(s, 'expected_provider_only'), 1);
    s.provider = []; assert.equal(count(s, 'genuinely_absent'), 1);
    s.coverage.native.complete = false; assert.equal(count(s, 'genuinely_absent'), 0);
    assert.equal(count(s, 'expected_absence_unproven'), 1);
  });
  await check('C09-native-filtered-versus-missing', () => {
    const s = snapshot(); s.workload[0].visible = false;
    assert.equal(count(s, 'native_stored_but_filtered'), 1); assert.equal(count(s, 'native_missing_from_workload'), 0);
    delete s.workload[0].visible; assert.equal(count(s, 'render_visibility_unproven'), 1);
  });
  await check('C10-archive-root-terminal-exclusions', () => {
    for (const patch of [{ archived: true }, { container: true }, { status: 'approved' }, { status: 'backlog' }]) {
      const s = snapshot(); Object.assign(s.native[0], patch); s.workload = [];
      assert.equal(count(s, 'legitimate_workload_exclusion'), 1); assert.equal(count(s, 'native_missing_from_workload'), 0);
    }
    const s = snapshot(); delete s.native[0].container;
    assert.equal(count(s, 'structural_visibility_unproven'), 1);
  });
  await check('C11-duplicates-and-conflicting-identities', () => {
    const s = snapshot(); s.workload.push({ ...s.workload[0] });
    assert.equal(count(s, 'duplicate_record'), 1); assert.equal(count(s, 'duplicate_workload_binding'), 1);
    s.native.push({ ...s.native[0], id: 'native-2', linearId: 'provider-2', legacyIds: [] });
    s.workload[0].linearId = 'provider-2'; assert(count(s, 'ambiguous_record_identity') > 0);
  });
  await check('C12-card-scope-kind-binding-and-missing', () => {
    const s = snapshot(); s.calendar[0].kind = 'graphic';
    assert.equal(count(s, 'binding_scope_or_kind_mismatch'), 1); assert.equal(count(s, 'expected_card_missing'), 1);
    s.calendar[0].kind = 'video'; s.calendar[0].nativeId = '';
    assert.equal(count(s, 'card_binding_gap'), 1);
    s.calendar = []; assert.equal(count(s, 'expected_card_missing'), 1);
  });
  await check('C13-samples-only-binding-no-calendar-requirement', () => {
    const s = snapshot(); s.samples = s.calendar; s.calendar = []; s.expected[0].surface = 'samples';
    assert.equal(count(s, 'expected_card_missing'), 0);
    s.samples[0].status = 'Approved'; assert.equal(count(s, 'status_mismatch'), 1);
  });
  await check('C14-missing-fields-and-completeness-stay-unproven', () => {
    const s = snapshot(); delete s.workload[0].ownerId; delete s.workload[0].dateSemantics;
    assert.equal(count(s, 'missing_field_proof'), 2);
    s.workload = []; s.coverage.workload.complete = false;
    assert.equal(count(s, 'native_missing_from_workload'), 0); assert.equal(count(s, 'workload_absence_unproven'), 1);
    assert.equal(compare(s).populationVerdict, 'UNPROVEN');
  });
  await check('C15-public-output-cannot-echo-input-values', () => {
    const s = snapshot(); const privateMarker = 'PRIVATE_MARKER_NOT_FOR_OUTPUT';
    s.workload[0].id = privateMarker; s.workload[0].ownerId = privateMarker;
    s.workload[0].status = privateMarker; s.workload[0].scope = privateMarker;
    assert(!JSON.stringify(compare(s)).includes(privateMarker));
    assert.throws(() => compare({}), /INVALID_NORMALIZED_SNAPSHOT/);
  });
  await check('C16-actual-bucketing-video-graphics-root-parked', () => {
    const ctx = boardContext();
    const rows = [issue(), issue({ id: 'graphics-1', assigneeName: 'Synthetic Graphics', teamKey: 'GRA', teamName: 'Graphics' }),
      issue({ id: 'root-1', isSubIssue: false }), issue({ id: 'parked-1', status: 'For Client Approval' }),
      issue({ id: 'terminal-1', status: 'Approved', statusType: 'completed' })];
    ctx.wlApplyData(rows, 1);
    assert.equal(ctx.wlState.planned.length, 2); assert.equal(ctx.wlState.allActiveSubs.length, 2);
  });
  await check('C17-actual-bucketing-unassigned-and-off-team', () => {
    const ctx = boardContext(); ctx.wlApplyData([
      issue({ id: 'unassigned-dated', assigneeId: null }),
      issue({ id: 'unassigned-undated', assigneeId: null, dueDate: null }),
      issue({ id: 'unassigned-active', assigneeId: null, dueDate: null, status: 'In Progress' }),
      issue({ id: 'wrong-team', assigneeName: 'Synthetic Graphics' }),
    ], 1);
    assert.equal(ctx.wlState.unassigned.length, 2);
    assert.equal(ctx.wlState.excluded.noAssigneeNoDate.length, 1);
    assert.equal(ctx.wlState.excluded.offTeamAssignee.length, 1);
  });
  await check('C18-plan-lookup-old-new-native-and-due-semantics', () => {
    const ctx = boardContext(), old = issue(), native = issue({ id: 'native-1', linearId: oldId() });
    function oldId() { return 'provider-1'; }
    ctx.wlState.planByIssueId.set(old.id, '2026-09-08');
    assert.equal(ctx.wlPlanDate(old), '2026-09-08'); assert.equal(ctx.wlPlanDate(native), '');
    ctx.wlState.planByIssueId.set(native.id, '2026-09-09'); assert.equal(ctx.wlPlanDate(native), '2026-09-09');
    assert.equal(ctx.wlDisplayDate(old), '2026-09-08'); assert.equal(old.dueDate, '2026-09-10');
    ctx.wlState.planByIssueId.clear(); assert.equal(ctx.wlAutoPlanDate(old), '2026-09-09');
    ctx.wlState.planHasSnapshot = false; assert.equal(ctx.wlDisplayDate(old), '2026-09-10');
    ctx.wlState.planLoading = true; assert.equal(ctx.wlDisplayDate(old), '2026-09-09');
  });
  await check('C19-loader-cold-cached-forced-empty-failed', async () => {
    for (const scenario of ['cold', 'cached', 'forced', 'empty', 'failed']) {
      const calls = [], cached = issue({ id: 'cached-1' });
      const ctx = context(['loadLinearIssues'], {
        wlReadCache: () => scenario === 'cached' || scenario === 'forced' ? { issues: [cached], fetchedAt: 1 } : null,
        wlIsFresh: () => true, wlWriteCache() {}, _wlV2Ready: () => true,
        _wlV2FetchIssues: async () => { calls.push('mirror'); if (scenario === 'failed') throw Error('synthetic'); return scenario === 'empty' ? [] : [issue()]; },
        LINEAR_ISSUES_WEBHOOK: 'https://example.invalid/provider',
        fetch: async (url, init) => { calls.push('provider'); assert.equal(init.method, 'GET'); return { ok: true, json: async () => [issue()] }; },
      });
      const result = await ctx.loadLinearIssues(scenario === 'forced');
      assert.deepEqual(calls, scenario === 'cached' ? [] : scenario === 'forced' ? ['provider']
        : ['empty', 'failed'].includes(scenario) ? ['mirror', 'provider'] : ['mirror']);
      assert.equal(result.fromCache, scenario === 'cached');
    }
  });
  await check('C20-native-diagnostic-not-a-render-switch', () => {
    const ctx = context(['_wlNativeDiffEnabled'], { location: { search: '?wlnative=1' } });
    assert.equal(ctx._wlNativeDiffEnabled(), true);
    const loader = extract('loadLinearIssues'); assert(!loader.includes('_wlNativeDiffEnabled'));
    assert(extract('_wlV2FetchIssues').includes('/workload_issues?'));
    assert(!extract('_wlV2FetchIssues').includes('workload_issues_native_v1'));
    assert(source.includes('window.wlNativeDiff = async function wlNativeDiff()'));
  });
  await check('C21-authority-healthy-http-failure-malformed-missing', async () => {
    for (const scenario of ['healthy', 'http', 'malformed', 'missing']) {
      const ctx = context(['wlProductionAuthorityValue', 'wlFetchProductionAuthority'], {
        CAL_SUPABASE_URL: 'https://example.invalid', CAL_SUPABASE_ANON_KEY: 'synthetic',
        fetch: async () => ({ ok: scenario !== 'http', status: 503, json: async () => scenario === 'missing' ? [] :
          [{ value: scenario === 'malformed' ? { video: 'unexpected' } : { video: 'syncview', graphics: 'syncview' } }] }),
      });
      if (scenario === 'healthy') assert.equal((await ctx.wlFetchProductionAuthority()).video, 'syncview');
      else await assert.rejects(ctx.wlFetchProductionAuthority());
    }
  });
  await check('C22-flag-read-failure-stops-metadata-fallback', async () => {
    let feederCalls = 0;
    const ctx = context(['wlFetchLinearMetadata', 'wlMetadataFailure'], {
      _wlPlanSessionGeneration: 0, wlIsActiveStatus: () => true, wlIsAllowedClient: () => true,
      _syncviewRequireStaffIdentity: async () => {}, wlFetchProductionAuthority: async () => { throw Error('synthetic'); },
      wlFetchForeignLinearMetadata: async () => { feederCalls++; return []; },
      wlFetchNativeMetadata: async () => { feederCalls++; return []; },
    });
    await assert.rejects(ctx.wlFetchLinearMetadata([issue()])); assert.equal(feederCalls, 0);
  });
  await check('C23-native-only-structural-child-enters-actual-buckets-if-supplied', () => {
    const ctx = boardContext(); const row = issue({ id: 'native-only', identifier: null, parentId: 'native-batch' });
    ctx.wlApplyData([row], 1); assert.equal(ctx.wlState.planned.length, 1);
    assert.equal(ctx.wlState.planned[0].id, row.id);
  });
  await check('C24-production-projection-is-separate-from-native-store', () => {
    const s = snapshot(); s.production = [];
    assert.equal(count(s, 'native_missing_from_production'), 1);
    s.coverage.production.complete = false;
    assert.equal(count(s, 'native_missing_from_production'), 0);
    assert.equal(count(s, 'production_absence_unproven'), 1);
  });
  await check('C25-seeded-discrepancy-counts-exact', () => {
    assert.deepEqual({ ...compare(discrepancySnapshot()).counts }, {
      provider_only: 1, owner_mismatch: 1, status_mismatch: 1, canonical_due_mismatch: 1,
      intentional_date_semantics: 1, native_stored_but_filtered: 1,
      native_only: 1, native_missing_from_workload: 1, card_binding_gap: 1,
    });
  });
  await check('C26-work-status-aliases-and-duplicate-native-ids', () => {
    const s = snapshot(); s.workload[0].status = ' To Do ';
    assert.equal(count(s, 'status_mismatch'), 0);
    s.native.push({ ...s.native[0] }); assert.equal(count(s, 'duplicate_native_identity'), 1);
  });
  await check('C27-unknown-membership-status-and-structure-are-not-exclusions', () => {
    const s = snapshot(); delete s.members[0].active; delete s.members[0].roles;
    s.native[0].status = 'unknown';
    assert.equal(count(s, 'owner_membership_unproven'), 1); assert.equal(count(s, 'inactive_owner'), 0);
    assert.equal(count(s, 'native_status_unproven'), 1); assert.equal(count(s, 'legitimate_workload_exclusion'), 0);
    s.native[0].container = null; assert.equal(count(s, 'structural_visibility_unproven'), 1);
  });
  await check('C28-ambiguous-links-cannot-establish-absence', () => {
    const s = snapshot(); s.native.push({ ...s.native[0], id: 'native-2', linearId: 'provider-2', legacyIds: [] });
    s.workload[0].linearId = 'provider-2';
    assert.equal(count(s, 'native_missing_from_workload'), 0); assert.equal(count(s, 'workload_absence_unproven'), 2);
    s.provider[0].nativeId = ''; s.provider[0].linearId = '';
    assert.equal(count(s, 'provider_only'), 0); assert.equal(count(s, 'record_identity_unproven'), 1);
  });
  return results;
}
module.exports = { runChecks };
