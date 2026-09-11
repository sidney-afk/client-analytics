'use strict';
// Desired product contracts stay red until the application actually satisfies
// them. These are not baseline/expected-failure assertions disguised as passes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { context, boardContext, root } = require('./source-harness');
const { issue } = require('./fixtures');
async function runContracts() {
  const results = [];
  async function contract(id, expected, fn) {
    try {
      const actual = await fn();
      results.push({ id, expected, actual, verdict: actual === expected ? 'PASS' : 'FAIL', evidence: 'OFFLINE_TEST' });
    } catch (_) {
      results.push({ id, expected, actual: 'HARNESS_ERROR', verdict: 'ERROR', evidence: 'UNPROVEN' });
    }
  }
  await contract('WLC01-native-only-default-load', 'native_record_in_board_input', async () => {
    const native = issue({ id: 'native-only', identifier: null }), mirror = issue();
    let nativeRead = false;
    const ctx = context(['_wlV2MapRow', '_wlV2FetchIssues', 'loadLinearIssues'], {
      wlReadCache: () => null, wlWriteCache() {}, _wlV2Ready: () => true,
      CAL_SUPABASE_URL: 'https://example.invalid', CAL_SUPABASE_ANON_KEY: 'synthetic',
      LINEAR_ISSUES_WEBHOOK: 'https://example.invalid/provider',
      fetch: async url => {
        const isNative = String(url).includes('workload_issues_native_v1');
        nativeRead ||= isNative;
        return { ok: true, json: async () => isNative ? [{ id: native.id, is_sub_issue: true }]
          : [{ id: mirror.id, is_sub_issue: true }] };
      },
    });
    const result = await ctx.loadLinearIssues(false);
    return nativeRead && result.issues.some(row => row.id === native.id) ? 'native_record_in_board_input' : 'native_record_absent_from_board_input';
  });
  await contract('WLC02-forced-refresh-with-provider-unavailable', 'native_refresh_succeeds', async () => {
    const ctx = context(['loadLinearIssues'], {
      wlReadCache: () => null, wlWriteCache() {}, _wlV2Ready: () => true,
      _wlV2FetchIssues: async () => [issue({ id: 'native-only' })],
      LINEAR_ISSUES_WEBHOOK: 'https://example.invalid/provider',
      fetch: async () => { throw new Error('SYNTHETIC_PROVIDER_UNAVAILABLE'); },
    });
    try { await ctx.loadLinearIssues(true); return 'native_refresh_succeeds'; }
    catch (_) { return 'refresh_fails_on_provider'; }
  });
  await contract('WLC03-saved-plan-identity-migration', 'saved_plan_preserved', () => {
    const ctx = boardContext(); ctx.wlState.planByIssueId.set('provider-1', '2026-09-08');
    const mapped = issue({ id: 'native-1', linearId: 'provider-1', legacyIds: ['provider-1'] });
    return ctx.wlPlanDate(mapped) === '2026-09-08' ? 'saved_plan_preserved' : 'saved_plan_not_found';
  });
  await contract('WLC04-native-plan-target-validation', 'native_target_accepted', async () => {
    // Exact source body, with ONLY its TS signature and one cast erased. Do
    // not load Deno.serve, authorization, a client library, or any writer.
    const src = fs.readFileSync(path.join(root, 'supabase/functions/workload-plan/index.ts'), 'utf8');
    const raw = src.match(/async function requireWritableIssue\([\s\S]*?\n}\n/);
    assert(raw, 'validation helper present');
    const signature = /async function requireWritableIssue\(\s*db: SupabaseClient,\s*issueId: string,\s*client: string,\s*\): Promise<void> \{/;
    assert(signature.test(raw[0]), 'known types only');
    assert.equal((raw[0].match(/ as JsonMap \| null/g) || []).length, 1);
    const js = raw[0].replace(signature, 'async function requireWritableIssue(db, issueId, client) {')
      .replace('data as JsonMap | null', 'data');
    const native = { id: 'native-1', client_name: 'synthetic', is_sub_issue: true, active: true };
    let relation = '', key = '';
    const db = { from(name) { relation = name; return this; }, select() { return this; },
      eq(_field, value) { key = value; return this; },
      async maybeSingle() { return { data: relation === 'workload_issues' ? null : (key === native.id ? native : null), error: null }; } };
    const ctx = context([], { normalizeBrowserWriteClient: value => value,
      WorkloadPlanError: class extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } } });
    vm.runInContext(js, ctx);
    try { await ctx.requireWritableIssue(db, native.id, 'synthetic'); return 'native_target_accepted'; }
    catch (error) { if (error.code !== 'issue_not_writable' || error.status !== 409) throw error;
      return 'native_target_rejected_by_mirror_lookup'; }
  });
  await contract('WLC05-current-member-outside-static-name-roster', 'active_member_work_visible', () => {
    const ctx = boardContext();
    // Active membership is supplied, but the production predicate has no path
    // to it. This is a synthetic expansion case, not a live staffing finding.
    ctx.teamMembers = [{ id: 'new-member', active: true, roles: ['creative'], teams: ['video'], name: 'Synthetic New Editor' }];
    ctx.wlApplyData([issue({ assigneeId: 'new-member', assigneeName: 'Synthetic New Editor' })], 1);
    return ctx.wlState.planned.length === 1 ? 'active_member_work_visible' : 'excluded_by_static_name_roster';
  });
  return results;
}
module.exports = { runContracts };
