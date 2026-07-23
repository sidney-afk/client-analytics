'use strict';

// Hermetic browser contract for Workload's Linear due-date editor. The UI is
// optimistic, but any non-exact acknowledgement must restore the previous
// deadline. A confirmed Linear commit with a lagging mirror is the one case
// that stays visible and warns instead of pretending the write failed.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < source.length; index++) {
    const ch = source[index], next = source[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

function harness(reply, role = 'admin', manualPlanDate = null) {
  const issue = {
    id: 'synthetic-issue-1',
    clientName: 'Synthetic Client',
    dueDate: '2026-08-10',
  };
  const notifies = [];
  const paints = [];
  let fetches = 0;
  let optimisticAtRequest = null;
  let optimisticPlacementAtRequest = null;
  const context = {
    WORKLOAD_LINEAR_URL: 'https://example.invalid/functions/v1/workload-linear',
    WL_LINEAR_WRITE_TIMEOUT_MS: 12000,
    _wlPlanLoadGeneration: 0,
    _wlPlanSessionGeneration: 0,
    _wlDueWriteInFlight: new Map(),
    wlState: {
      allActiveSubs: [issue],
      issueSnapshot: [issue],
      fetchedAt: 1,
      linearMetadataStatus: 'ready',
      planByIssueId: new Map(manualPlanDate ? [[issue.id, manualPlanDate]] : []),
      planHasSnapshot: true,
    },
    _syncviewStaffIdentityForHeaders: () => role ? { role } : null,
    _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
    _syncviewRequireStaffIdentity: async () => ({ key: 'synthetic' }),
    _syncviewEfHeaders: headers => headers,
    _syncviewStaffIdentityClear: () => {},
    wlPurgePlanSensitiveState: () => {},
    wlIsTweaksNeeded: () => false,
    wlWorkloadTodayISO: () => '2026-07-22',
    wlApplyData: () => paints.push(issue.dueDate),
    renderWorkloadAll: () => paints.push(issue.dueDate),
    showNotify: (title, body) => notifies.push([title, body]),
    fetch: async () => {
      fetches++;
      optimisticAtRequest = issue.dueDate;
      optimisticPlacementAtRequest = context.wlDisplayDate(issue);
      if (reply instanceof Error) throw reply;
      return {
        ok: reply.httpOk !== false,
        status: reply.status || 200,
        json: async () => reply.body,
      };
    },
    document: { querySelector: () => ({}) },
    AbortController,
    setTimeout,
    clearTimeout,
    JSON, String, Number, Error, Promise, Map, Array, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const name of [
    'wlISO',
    'wlParseISO',
    'wlSubWorkingDays',
    'wlPlanDate',
    'wlAutoPlanDate',
    'wlDisplayDate',
    '_syncviewStaffCan',
    'wlLinearEditingEnabled',
    'wlApplyDueLocal',
    'wlValidRfc3339Timestamp',
    '_wlDueWriteRequest',
    'wlSetDueDate',
  ]) vm.runInContext(extract(name), context);
  return {
    context,
    issue,
    notifies,
    paints,
    get fetches() { return fetches; },
    get optimisticAtRequest() { return optimisticAtRequest; },
    get optimisticPlacementAtRequest() { return optimisticPlacementAtRequest; },
  };
}

function backgroundIssue(overrides = {}) {
  return Object.assign({
    id: 'issue-a',
    identifier: 'VID-1',
    title: 'Video 1',
    url: 'https://example.invalid/issue-a',
    isSubIssue: true,
    parentId: 'parent-a',
    parentIdentifier: 'VID-100',
    dueDate: '2026-08-10',
    sortOrder: 1,
    status: 'To Do',
    statusType: 'unstarted',
    teamKey: 'VID',
    teamName: 'Video',
    assigneeId: 'editor-a',
    assigneeName: 'Editor A',
    assigneeEmail: 'editor@example.invalid',
    clientName: 'Synthetic Client',
    syncedAt: '2026-07-22T12:00:00.000Z',
  }, overrides);
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function backgroundHarness(options = {}) {
  const initialIssues = (options.initialIssues || [backgroundIssue()]).map(issue => ({ ...issue }));
  const freshIssues = (options.freshIssues || initialIssues.map(issue => ({
    ...issue,
    syncedAt: '2026-07-22T12:01:00.000Z',
  }))).map(issue => ({ ...issue }));
  const initialPlans = options.initialPlans || [['issue-a', '2026-08-07']];
  const planRows = options.planRows || initialPlans.map(([issue_id, plan_date]) => ({ issue_id, plan_date }));
  const initialMetadata = options.initialMetadata === undefined
    ? [['issue-a', { label: '2× Workload', weight: 2, color: '#ff0000' }]]
    : options.initialMetadata;
  const metadataRows = options.metadataRows || [{
    issue_id: 'issue-a',
    due_date: '2026-08-10',
    workload: { label: '2× Workload', weight: 2, color: '#ff0000' },
  }];
  const counters = {
    watermark: 0,
    mirror: 0,
    plans: 0,
    metadata: 0,
    render: 0,
    status: 0,
    n8n: 0,
    applyData: 0,
    cacheWrite: 0,
    identityClear: 0,
  };
  const renderStates = [];
  const metadataIssueSets = [];
  const storedIdentity = options.staffIdentity === undefined ? {
    key: 'synthetic-key',
    role: 'admin',
    member: { id: 'staff-a', name: 'Staff A' },
  } : options.staffIdentity;
  const identityStorage = new Map();
  const context = {
    _wlV2WatermarkBusy: false,
    _wlBackgroundRefreshPromise: null,
    _wlBackgroundRefreshMode: null,
    _wlPlanLoadGeneration: 0,
    _wlPlanSessionGeneration: 0,
    _wlPlanLastWriteGeneration: new Map(),
    _wlPlanWriteGeneration: 0,
    _wlPlanWriteInFlight: new Map(),
    _wlDueWriteInFlight: new Map(),
    wlState: {
      sourceSyncedAt: '2026-07-22T12:00:00.000Z',
      issueSnapshot: initialIssues,
      planByIssueId: new Map(initialPlans),
      workloadByIssueId: new Map(initialMetadata),
      fetchedAt: 1,
      loading: false,
      refreshing: false,
      planStatus: 'ready',
      planHasSnapshot: initialPlans.length > 0,
      linearMetadataStatus: 'ready',
      error: null,
      backgroundError: null,
    },
    document: {
      hidden: false,
      querySelector: selector => selector === '.workload-view' ? {} : null,
    },
    WL_CLIENT_NAMES: ['Synthetic Client'],
    WL_VIEW_PREF_KEY: 'workload-view',
    SYNCVIEW_STAFF_IDENTITY_KEY: 'syncview_staff_identity_v1',
    _syncviewStaffIdentityMem: storedIdentity,
    _syncviewStaffIdentityLoaded: true,
    _syncviewStaffIdentityVerified: options.staffVerified !== false,
    localStorage: {
      getItem: key => identityStorage.get(key) || null,
      setItem: (key, value) => identityStorage.set(key, value),
      removeItem: key => identityStorage.delete(key),
    },
    _syncviewStaffIdentityForHeaders: () => (
      context._syncviewStaffIdentityVerified ? context._syncviewStaffIdentityMem : null
    ),
    _wlV2Ready: () => options.v2Ready !== false,
    _wlV2FetchLatestWatermark: async () => {
      counters.watermark++;
      return options.latestWatermark || '2026-07-22T12:01:00.000Z';
    },
    _wlV2FetchIssues: async () => {
      counters.mirror++;
      if (options.fail === 'issues') throw new Error('mirror unavailable');
      if (options.fetchIssues) return options.fetchIssues(counters.mirror);
      return freshIssues.map(issue => ({ ...issue }));
    },
    wlFetchPlanRows: async () => {
      counters.plans++;
      if (options.fail === 'plans') throw new Error('plans unavailable');
      if (options.fetchPlans) return options.fetchPlans(counters.plans);
      return { rows: planRows.map(row => ({ ...row })), readGeneration: 0 };
    },
    wlFetchLinearMetadata: async issues => {
      counters.metadata++;
      metadataIssueSets.push(issues
        .filter(issue => issue && issue.isSubIssue
          && context.wlIsActiveStatus(issue)
          && context.wlIsAllowedClient(issue.clientName))
        .map(issue => issue.id));
      if (options.fail === 'metadata') throw new Error('metadata unavailable');
      if (options.fetchMetadata) return options.fetchMetadata(counters.metadata, issues);
      return metadataRows.map(row => ({
        ...row,
        workload: row.workload ? { ...row.workload } : null,
      }));
    },
    wlAdoptPlanRows: snapshot => {
      context.wlState.planByIssueId = new Map((snapshot.rows || []).map(row => [row.issue_id, row.plan_date]));
      context.wlState.planHasSnapshot = true;
      context.wlState.planStatus = 'ready';
    },
    wlWriteCache: () => { counters.cacheWrite++; },
    wlApplyData: (issues, fetchedAt) => {
      counters.applyData++;
      context.wlState.issueSnapshot = issues;
      context.wlState.fetchedAt = fetchedAt;
    },
    wlPlanEditingEnabled: () => context.wlState.planStatus === 'ready',
    wlLinearEditingEnabled: () => context.wlState.linearMetadataStatus === 'ready',
    renderWorkloadAll: () => {
      counters.render++;
      renderStates.push({
        loading: context.wlState.loading,
        refreshing: context.wlState.refreshing,
        planStatus: context.wlState.planStatus,
        metadataStatus: context.wlState.linearMetadataStatus,
      });
    },
    renderWorkloadPlanStatus: () => { counters.status++; },
    _syncviewStaffIdentityClear: () => {
      counters.identityClear++;
      context.wlPurgePlanSensitiveState();
    },
    wlPurgePlanSensitiveState: () => {},
    wlClosePopover: () => {},
    loadLinearIssues: () => { counters.n8n++; throw new Error('background called n8n'); },
    wlLoadSnapshot: () => { counters.n8n++; throw new Error('background entered foreground loader'); },
    wlCanonicalClient: value => String(value || '').trim().toLowerCase(),
    wlIsActiveStatus: issue => !['completed', 'canceled', 'cancelled'].includes(String(issue && issue.statusType || '').toLowerCase()),
    wlIsAllowedClient: client => String(client || '') !== 'Disallowed Client',
    wlIsAllowedEditor: editor => String(editor || '') !== 'Disallowed Editor',
    wlWorkloadTodayISO: () => '2026-07-22',
    wlParseISO: () => new Date(2026, 6, 22),
    wlWeekMondayISO: () => '2026-07-20',
    wlReadCache: () => null,
    wlWireToolbar: () => {},
    wlWireClientSearch: () => {},
    _wlV2EnsureSubscribed: () => {},
    _wlV2EnsureWatermarkPoll: () => {},
    Date, JSON, String, Number, Boolean, Error, Promise, Map, Array,
    console: { log: console.log, error: console.error, warn: () => {} },
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const name of [
    'wlRenderableIssueProjection',
    'wlIssueBusinessFingerprint',
    'wlPlanBusinessFingerprint',
    'wlMetadataBusinessFingerprint',
    'wlBackgroundBusinessFingerprint',
    'wlMarkBackgroundRefreshFailure',
    'wlClearBackgroundRefreshFailure',
    'wlAdoptLinearMetadata',
    'wlPurgePlanSensitiveState',
    'wlRefetchSilent',
    'wlRefreshSensitiveStateSilent',
    '_wlV2CheckWatermark',
    '_wlOnVisibilityChange',
    '_syncviewStaffIdentitySave',
    'initWorkloadView',
  ]) vm.runInContext(extract(name), context);
  return { context, counters, renderStates, metadataIssueSets };
}

async function run() {
  // F201/F40: metadata follows the per-team authority split. A SyncView-
  // authoritative video reads its native due date and canonical labels from
  // deliverables; only the still-Linear graphics id reaches workload-linear.
  {
    const calls = [];
    const mixed = {
      CAL_SUPABASE_URL: 'https://example.invalid',
      CAL_SUPABASE_ANON_KEY: 'anon',
      WORKLOAD_LINEAR_URL: 'https://example.invalid/functions/v1/workload-linear',
      WL_LINEAR_READ_TIMEOUT_MS: 20000,
      _wlPlanSessionGeneration: 0,
      wlState: { workloadByIssueId: new Map(), linearMetadataStatus: 'loading', linearMetadataError: null },
      _syncviewRequireStaffIdentity: async () => ({ role: 'admin' }),
      _syncviewEfHeaders: headers => headers,
      wlIsActiveStatus: () => true,
      wlIsAllowedClient: () => true,
      wlWriteCache: () => {},
      fetch: async (url, options = {}) => {
        calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
        if (String(url).includes('syncview_runtime_flags')) {
          return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'linear' } }] };
        }
        if (String(url).includes('/rest/v1/deliverables')) {
          return { ok: true, status: 200, json: async () => [{
            linear_issue_uuid: 'native-video',
            due_date: '2026-08-14',
            linear_raw: { issue: { labels: {
              nodes: [
                { id: 'ordinary', name: 'Keep me', color: '#112233', description: 'Arbitrary label survives' },
                { id: 'three', name: '3× Workload', color: '#00aa44', description: 'Three units' },
              ],
              pageInfo: { hasNextPage: false },
            } } },
          }] };
        }
        if (String(url).includes('/functions/v1/workload-linear')) {
          return { ok: true, status: 200, json: async () => ({
            ok: true,
            complete: true,
            rows: [{ issue_id: 'linear-graphics', due_date: '2026-08-15', workload: {
              label: '3× Workload', weight: 3, color: '#FF0000',
            } }],
          }) };
        }
        throw new Error('unexpected fetch ' + url);
      },
      AbortController, setTimeout, clearTimeout, encodeURIComponent,
      JSON, String, Number, Error, Promise, Map, Set, Array, console,
    };
    mixed.globalThis = mixed;
    vm.createContext(mixed);
    for (const name of [
      'wlProductionAuthorityValue',
      'wlFetchProductionAuthority',
      'wlFetchForeignLinearMetadata',
      'wlNativeWorkloadLabel',
      'wlNativeDueDate',
      'wlFetchNativeMetadata',
      'wlMetadataFailure',
      'wlMetadataTeamBucket',
      'wlTeamBucket',
      'wlEditorCapacity',
      'wlFetchLinearMetadata',
      'wlAdoptLinearMetadata',
      'wlWorkloadMeta',
      'wlWorkloadWeight',
    ]) vm.runInContext(extract(name), mixed);
    const issues = [
      backgroundIssue({ id: 'native-video', teamKey: 'VID', teamName: 'Video' }),
      backgroundIssue({ id: 'linear-graphics', teamKey: 'GRA', teamName: 'Graphics' }),
    ];
    const rows = await mixed.wlFetchLinearMetadata(issues);
    assert.deepStrictEqual(Array.from(rows, row => row.issue_id).sort(), ['linear-graphics', 'native-video']);
    assert.deepStrictEqual(
      calls.find(call => call.url.includes('/functions/v1/workload-linear')).body.issue_ids,
      ['linear-graphics'],
      'only Linear-authoritative ids cross the workload-linear boundary');
    assert(calls.find(call => call.url.includes('/rest/v1/deliverables')).url.includes('native-video'),
      'SyncView-authoritative ids use native deliverables metadata');
    mixed.wlAdoptLinearMetadata(rows, issues, 1);
    assert.strictEqual(issues[0].dueDate, '2026-08-14', 'native due date reaches the current metadata shape');
    assert.strictEqual(mixed.wlState.workloadByIssueId.get('native-video').label, '3× Workload',
      'exact native Workload label reaches the shared metadata map');
    assert.strictEqual(mixed.wlWorkloadWeight(issues[0]), 3, 'native exact label reaches video capacity math');
    assert.strictEqual(mixed.wlWorkloadWeight(issues[1]), 1, 'Graphics remains 15 unweighted items');
    assert.strictEqual(mixed.wlEditorCapacity('GRA', 'Graphics'), 15, 'Graphics capacity remains exactly 15 items');
    assert.throws(() => mixed.wlNativeDueDate('2026-02-30'), /malformed/,
      'native due dates are exact calendar dates, not sliced arbitrary strings');

    const originalFetch = mixed.fetch;
    const unknownTeamCalls = [];
    mixed.fetch = async url => {
      unknownTeamCalls.push(String(url));
      if (String(url).includes('syncview_runtime_flags')) {
        return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'linear' } }] };
      }
      throw new Error('unknown team reached a metadata source');
    };
    await assert.rejects(
      mixed.wlFetchLinearMetadata([backgroundIssue({
        id: 'unknown-team',
        teamKey: 'CON',
        teamName: 'Content',
      })]),
      error => error
        && error.workloadMetadataFailure === true
        && Array.from(error.workloadMetadataIssueIds || []).join(',') === 'unknown-team'
        && /team authority is unavailable/.test(error.message),
      'an unrecognized active team fails closed for the complete active-id set');
    assert.strictEqual(unknownTeamCalls.some(url => url.includes('/rest/v1/deliverables')), false,
      'an unrecognized team never reaches native deliverables metadata');
    assert.strictEqual(unknownTeamCalls.some(url => url.includes('/functions/v1/workload-linear')), false,
      'an unrecognized team never reaches foreign Workload metadata');

    mixed.fetch = async url => {
      if (String(url).includes('syncview_runtime_flags')) {
        return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'syncview' } }] };
      }
      if (String(url).includes('/rest/v1/deliverables')) {
        return { ok: true, status: 200, json: async () => [{
          linear_issue_uuid: 'native-empty',
          due_date: null,
          linear_raw: { issue: { labels: { nodes: [], pageInfo: { hasNextPage: false } } } },
        }] };
      }
      throw new Error('empty native state fell through to Linear');
    };
    const emptyRows = await mixed.wlFetchLinearMetadata([backgroundIssue({ id: 'native-empty' })]);
    assert.strictEqual(emptyRows[0].workload, null, 'an explicit complete empty native label relation remains valid');

    mixed.fetch = async url => {
      if (String(url).includes('syncview_runtime_flags')) {
        return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'syncview' } }] };
      }
      if (String(url).includes('/rest/v1/deliverables')) {
        return { ok: true, status: 200, json: async () => [{
          linear_issue_uuid: 'native-incomplete',
          due_date: null,
          linear_raw: { issue: { labels: { nodes: [], pageInfo: { hasNextPage: true } } } },
        }] };
      }
      throw new Error('incomplete native state fell through to Linear');
    };
    await assert.rejects(
      mixed.wlFetchLinearMetadata([backgroundIssue({ id: 'native-incomplete' })]),
      /label state is incomplete/,
      'a paginated native label relation fails closed instead of silently weighting one');

    mixed.fetch = async url => {
      if (String(url).includes('syncview_runtime_flags')) {
        return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'syncview' } }] };
      }
      if (String(url).includes('/rest/v1/deliverables')) {
        return { ok: true, status: 200, json: async () => [{
          linear_issue_uuid: 'native-missing-page-info',
          due_date: null,
          linear_raw: { issue: { labels: { nodes: [] } } },
        }] };
      }
      throw new Error('unproven native state fell through to Linear');
    };
    await assert.rejects(
      mixed.wlFetchLinearMetadata([backgroundIssue({ id: 'native-missing-page-info' })]),
      /label state is incomplete/,
      'a nodes-only native label relation cannot claim complete empty state');

    for (const malformedRelation of [
      {
        id: 'native-duplicate-node',
        issue: {
          labelIds: ['duplicate'],
          labels: {
            nodes: [{ id: 'duplicate', name: 'One' }, { id: 'duplicate', name: 'Two' }],
            pageInfo: { hasNextPage: false },
          },
        },
        message: 'duplicate native label nodes fail closed',
      },
      {
        id: 'native-malformed-node',
        issue: {
          labelIds: ['missing-name'],
          labels: {
            nodes: [{ id: 'missing-name', name: '' }],
            pageInfo: { hasNextPage: false },
          },
        },
        message: 'native label nodes require a nonempty id and name',
      },
      {
        id: 'native-duplicate-label-ids',
        issue: {
          labelIds: ['one', 'one'],
          labels: {
            nodes: [{ id: 'one', name: 'One' }],
            pageInfo: { hasNextPage: false },
          },
        },
        message: 'duplicate native labelIds fail closed',
      },
      {
        id: 'native-label-id-mismatch',
        issue: {
          labelIds: ['other'],
          labels: {
            nodes: [{ id: 'one', name: 'One' }],
            pageInfo: { hasNextPage: false },
          },
        },
        message: 'native labelIds must exactly match the relation nodes',
      },
    ]) {
      mixed.fetch = async url => {
        if (String(url).includes('syncview_runtime_flags')) {
          return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'syncview' } }] };
        }
        if (String(url).includes('/rest/v1/deliverables')) {
          return { ok: true, status: 200, json: async () => [{
            linear_issue_uuid: malformedRelation.id,
            due_date: null,
            linear_raw: { issue: malformedRelation.issue },
          }] };
        }
        throw new Error('invalid native state fell through to Linear');
      };
      await assert.rejects(
        mixed.wlFetchLinearMetadata([backgroundIssue({ id: malformedRelation.id })]),
        /label state is incomplete/,
        malformedRelation.message);
    }
    mixed.fetch = originalFetch;

    const failCalls = [];
    const nativeIssue = backgroundIssue({ id: 'native-only', dueDate: '2026-09-01' });
    const nativeFailure = {
      ...mixed,
      wlState: {
        issueSnapshot: [nativeIssue],
        allActiveSubs: [nativeIssue],
        workloadByIssueId: new Map([['native-only', {
          label: '3\u00d7 Workload',
          weight: 3,
          color: '#EF4444',
        }]]),
        linearMetadataStatus: 'loading',
        linearMetadataError: null,
      },
      fetch: async (url, options = {}) => {
        failCalls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
        if (String(url).includes('syncview_runtime_flags')) {
          return { ok: true, status: 200, json: async () => [{ value: { video: 'syncview', graphics: 'syncview' } }] };
        }
        if (String(url).includes('/rest/v1/deliverables')) {
          return { ok: false, status: 503, json: async () => ({}) };
        }
        throw new Error('native issue fell through to foreign metadata');
      },
    };
    nativeFailure.globalThis = nativeFailure;
    vm.createContext(nativeFailure);
    for (const name of [
      'wlProductionAuthorityValue',
      'wlFetchProductionAuthority',
      'wlFetchForeignLinearMetadata',
      'wlNativeWorkloadLabel',
      'wlNativeDueDate',
      'wlFetchNativeMetadata',
      'wlMetadataFailure',
      'wlMetadataTeamBucket',
      'wlTeamBucket',
      'wlFetchLinearMetadata',
      'wlSanitizeFailedNativeMetadata',
      'wlMarkLinearMetadataFailure',
      'wlWorkloadMeta',
      'wlWorkloadWeight',
    ]) vm.runInContext(extract(name), nativeFailure);
    assert.strictEqual(nativeFailure.wlWorkloadWeight(nativeIssue), 3,
      'fixture begins with a retained foreign 3x weight');
    let nativeMetadataError = null;
    await assert.rejects(async () => {
      try {
        await nativeFailure.wlFetchLinearMetadata([nativeIssue]);
      } catch (error) {
        nativeMetadataError = error;
        throw error;
      }
    }, /Native Workload metadata HTTP 503/);
    assert.strictEqual(nativeFailure.wlMarkLinearMetadataFailure(nativeMetadataError, [nativeIssue]), true,
      'authority-flip native failure sanitizes retained feeder metadata');
    assert.strictEqual(nativeIssue.dueDate, null,
      'foreign workload_issues due date is cleared after the issue becomes SyncView-authoritative');
    assert.strictEqual(nativeFailure.wlState.issueSnapshot[0].dueDate, null,
      'the currently published Workload snapshot cannot retain the foreign due date');
    assert.strictEqual(nativeFailure.wlState.workloadByIssueId.has('native-only'), false,
      'the prior foreign 3x label weight is removed');
    assert.strictEqual(nativeFailure.wlWorkloadWeight(nativeIssue), 1,
      'failed native metadata falls closed to one capacity unit');
    assert.strictEqual(failCalls.some(call => call.url.includes('/functions/v1/workload-linear')), false,
      'native metadata failure never falls back to Linear');
  }

  const happy = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(happy.context.wlDisplayDate(happy.issue), '2026-08-07', 'automatic placement starts one working day before due');
  assert.strictEqual(await happy.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), true);
  assert.strictEqual(happy.optimisticAtRequest, '2026-08-12', 'new deadline is optimistic before the request');
  assert.strictEqual(happy.optimisticPlacementAtRequest, '2026-08-11', 'automatic placement follows the optimistic deadline');
  assert.strictEqual(happy.issue.dueDate, '2026-08-12');
  assert.strictEqual(happy.context.wlDisplayDate(happy.issue), '2026-08-11', 'automatic placement follows the confirmed deadline');
  assert.deepStrictEqual(happy.notifies, []);

  const pinned = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } }, 'admin', '2026-08-05');
  assert.strictEqual(pinned.context.wlDisplayDate(pinned.issue), '2026-08-05', 'manual placement starts on the saved pin');
  assert.strictEqual(await pinned.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), true);
  assert.strictEqual(pinned.optimisticPlacementAtRequest, '2026-08-05', 'manual placement stays pinned during the optimistic deadline update');
  assert.strictEqual(pinned.context.wlDisplayDate(pinned.issue), '2026-08-05', 'manual placement stays pinned after the confirmed deadline update');
  assert.strictEqual(pinned.context.wlState.planByIssueId.get('synthetic-issue-1'), '2026-08-05', 'the due writer never changes the saved plan date');

  const mismatch = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'different-issue',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await mismatch.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(mismatch.issue.dueDate, '2026-08-10', 'mismatched issue acknowledgement reverts');
  assert.match(mismatch.notifies[0][0], /Couldn't update/);

  const missingReceipt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await missingReceipt.context.wlSetDueDate('synthetic-issue-1', null), false);
  assert.strictEqual(missingReceipt.issue.dueDate, '2026-08-10', 'missing null due-date receipt reverts');

  const trailingDate = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12garbage',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await trailingDate.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(trailingDate.issue.dueDate, '2026-08-10', 'non-exact returned date reverts');

  const inconsistentMirror = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 0,
    mirror_pending: false,
  } });
  assert.strictEqual(await inconsistentMirror.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(inconsistentMirror.issue.dueDate, '2026-08-10', 'inconsistent mirror receipt reverts');

  const missingUpdatedAt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await missingUpdatedAt.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(missingUpdatedAt.issue.dueDate, '2026-08-10', 'missing update timestamp reverts');

  const malformedUpdatedAt = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: 'not-a-date',
    mirror_updated: 1,
    mirror_pending: false,
  } });
  assert.strictEqual(await malformedUpdatedAt.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(malformedUpdatedAt.issue.dueDate, '2026-08-10', 'malformed update timestamp reverts');

  const rejected = harness({ httpOk: false, status: 409, body: { ok: false, error: 'issue_not_writable' } });
  assert.strictEqual(await rejected.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(rejected.issue.dueDate, '2026-08-10', 'pre-write rejection reverts');
  assert.strictEqual(rejected.optimisticPlacementAtRequest, '2026-08-11', 'failed automatic write still previews the derived new day');
  assert.strictEqual(rejected.context.wlDisplayDate(rejected.issue), '2026-08-07', 'failed automatic write restores the previous derived day');
  assert.match(rejected.notifies[0][1], /previous due date was restored/i);

  const shortMirror = harness({ body: {
    ok: true,
    linear_committed: true,
    issue_id: 'synthetic-issue-1',
    due_date: '2026-08-12',
    updated_at: '2026-07-22T12:00:00Z',
    mirror_updated: 0,
    mirror_pending: true,
  } });
  assert.strictEqual(await shortMirror.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), true);
  assert.strictEqual(shortMirror.issue.dueDate, '2026-08-12', 'confirmed Linear commit survives a short mirror update');
  assert.match(shortMirror.notifies[0][1], /Workload is catching up/);

  const network = harness(new Error('offline'));
  assert.strictEqual(await network.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(network.issue.dueDate, '2026-08-10', 'network failure restores the prior deadline');

  const creative = harness({ body: {} }, 'creative');
  assert.strictEqual(await creative.context.wlSetDueDate('synthetic-issue-1', '2026-08-12'), false);
  assert.strictEqual(creative.fetches, 0, 'Creative cannot send a due-date write');
  assert.strictEqual(creative.issue.dueDate, '2026-08-10');
  assert.match(creative.notifies[0][0], /unavailable/);

  // A warm internal route switch paints synchronously from memory. It neither
  // re-enters the foreground loader nor calls the n8n-backed issue helper.
  {
    const paints = [];
    let cacheReads = 0, foregroundLoads = 0, watermarkChecks = 0;
    const warmContext = {
      wlState: {
        year: null,
        month: null,
        weekStart: null,
        viewMode: 'week',
        showDeadlines: false,
        clientOptions: [],
        issueSnapshot: [backgroundIssue()],
        fetchedAt: 1,
        loading: true,
        refreshing: true,
        planStatus: 'ready',
        linearMetadataStatus: 'ready',
      },
      WL_CLIENT_NAMES: ['Synthetic Client'],
      WL_VIEW_PREF_KEY: 'workload-view',
      localStorage: { getItem: () => null },
      wlWorkloadTodayISO: () => '2026-07-22',
      wlParseISO: () => new Date(2026, 6, 22),
      wlWeekMondayISO: () => '2026-07-20',
      wlReadCache: () => { cacheReads++; return null; },
      wlApplyData: () => {},
      renderWorkloadAll: () => paints.push({
        loading: warmContext.wlState.loading,
        refreshing: warmContext.wlState.refreshing,
        planStatus: warmContext.wlState.planStatus,
      }),
      wlWireToolbar: () => {},
      wlWireClientSearch: () => {},
      _wlV2EnsureSubscribed: () => {},
      _wlV2EnsureWatermarkPoll: () => {},
      _wlV2CheckWatermark: () => { watermarkChecks++; },
      wlLoadSnapshot: () => { foregroundLoads++; throw new Error('warm entry loaded'); },
      Array, Date, console,
    };
    warmContext.globalThis = warmContext;
    vm.createContext(warmContext);
    vm.runInContext(extract('initWorkloadView'), warmContext);
    const pending = warmContext.initWorkloadView();
    assert.strictEqual(paints.length, 1, 'warm Workload paints synchronously before yielding');
    assert.deepStrictEqual(paints[0], { loading: false, refreshing: false, planStatus: 'ready' });
    await pending;
    assert.strictEqual(cacheReads, 0, 'warm entry does not consult the persisted issue cache');
    assert.strictEqual(foregroundLoads, 0, 'warm entry never reaches the n8n-capable foreground loader');
    assert.strictEqual(watermarkChecks, 1, 'warm entry schedules only the cheap watermark check');
  }

  // Sign-out deliberately purges role-sensitive maps while retaining the
  // already-painted issue calendar. A later verified sign-in rehydrates only
  // plans and metadata; it never re-reads the mirror or enters the n8n loader.
  {
    const signedBackIn = backgroundHarness({
      staffIdentity: null,
      initialPlans: [],
      initialMetadata: [],
      planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-06' }],
      metadataRows: [{
        issue_id: 'issue-a',
        due_date: '2026-08-10',
        workload: { label: '2× Workload', weight: 2, color: '#ff0000' },
      }],
      latestWatermark: '2026-07-22T12:00:00.000Z',
    });
    signedBackIn.context.wlState.planStatus = 'unknown';
    signedBackIn.context.wlState.planHasSnapshot = false;
    signedBackIn.context.wlState.linearMetadataStatus = 'unknown';
    const issueBefore = signedBackIn.context.wlIssueBusinessFingerprint(
      signedBackIn.context.wlState.issueSnapshot,
    );
    signedBackIn.context._syncviewStaffIdentitySave({
      key: 'new-key',
      role: 'admin',
      member: { id: 'staff-b', name: 'Staff B' },
    });
    const hydration = signedBackIn.context._wlBackgroundRefreshPromise;
    assert.ok(hydration, 'verified sign-in starts sensitive-state hydration');
    assert.strictEqual(signedBackIn.counters.render, 0, 'sign-in does not blank or pre-emptively repaint the warm calendar');
    await hydration;
    assert.strictEqual(signedBackIn.counters.mirror, 0, 'sign-in hydration reuses the warm issue snapshot');
    assert.strictEqual(signedBackIn.counters.n8n, 0, 'sign-in hydration has no n8n fallback');
    assert.strictEqual(signedBackIn.counters.plans, 1);
    assert.strictEqual(signedBackIn.counters.metadata, 1);
    assert.strictEqual(signedBackIn.counters.render, 1, 'rehydrated sensitive state publishes in one repaint');
    assert.strictEqual(signedBackIn.context.wlState.planByIssueId.get('issue-a'), '2026-08-06');
    assert.strictEqual(signedBackIn.context.wlState.workloadByIssueId.get('issue-a').weight, 2);
    assert.strictEqual(
      signedBackIn.context.wlIssueBusinessFingerprint(signedBackIn.context.wlState.issueSnapshot),
      issueBefore,
      'sensitive hydration leaves the visible mirror snapshot untouched',
    );
  }

  // The same post-purge recovery happens on a warm route remount. The first
  // paint is synchronous, then plans/metadata arrive non-destructively before
  // the ordinary cheap watermark check.
  {
    const remount = backgroundHarness({
      initialPlans: [],
      initialMetadata: [],
      planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-05' }],
      metadataRows: [{
        issue_id: 'issue-a',
        due_date: '2026-08-10',
        workload: { label: '2× Workload', weight: 2, color: '#ff0000' },
      }],
      latestWatermark: '2026-07-22T12:00:00.000Z',
    });
    remount.context.wlState.planStatus = 'unknown';
    remount.context.wlState.planHasSnapshot = false;
    remount.context.wlState.linearMetadataStatus = 'unknown';
    const route = remount.context.initWorkloadView();
    assert.strictEqual(remount.counters.render, 1, 'warm post-sign-out remount paints retained issues synchronously');
    assert.strictEqual(remount.renderStates[0].loading, false);
    assert.strictEqual(remount.renderStates[0].refreshing, false);
    const hydration = remount.context._wlBackgroundRefreshPromise;
    assert.ok(hydration, 'warm non-ready remount starts sensitive-state hydration');
    await route;
    await hydration;
    await Promise.resolve();
    assert.strictEqual(remount.counters.mirror, 0, 'warm remount does not refetch the issue mirror');
    assert.strictEqual(remount.counters.n8n, 0, 'warm remount does not enter the foreground loader');
    assert.strictEqual(remount.counters.plans, 1);
    assert.strictEqual(remount.counters.metadata, 1);
    assert.strictEqual(remount.counters.render, 2, 'warm remount adds exactly one atomic hydration repaint');
    assert.strictEqual(remount.context.wlState.planByIssueId.get('issue-a'), '2026-08-05');
    assert.strictEqual(remount.context.wlState.workloadByIssueId.get('issue-a').weight, 2);
  }

  // Sensitive-only hydration must not make an old issue snapshot look newly
  // fetched. It updates the private maps while preserving the mirror's original
  // in-memory freshness timestamp and never republishes the issue snapshot.
  {
    const sensitive = backgroundHarness({
      initialPlans: [],
      initialMetadata: [],
      planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-05' }],
    });
    sensitive.context.wlState.planStatus = 'unknown';
    sensitive.context.wlState.linearMetadataStatus = 'unknown';
    const fetchedAt = sensitive.context.wlState.fetchedAt;
    assert.strictEqual(await sensitive.context.wlRefetchSilent({ sensitiveOnly: true }), true);
    assert.strictEqual(sensitive.context.wlState.fetchedAt, fetchedAt, 'sensitive hydration preserves issue freshness');
    assert.strictEqual(sensitive.counters.cacheWrite, 0, 'sensitive hydration does not renew the persisted issue-cache timestamp');
    assert.strictEqual(sensitive.counters.mirror, 0);
    assert.strictEqual(sensitive.counters.n8n, 0);
  }

  // The private Edge projections do not depend on the optional wl2 mirror
  // flag. They can rehydrate a retained calendar while a full mirror refresh
  // still fails closed when Supabase Workload v2 is unavailable.
  {
    const noMirror = backgroundHarness({
      v2Ready: false,
      initialPlans: [],
      initialMetadata: [],
      planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-05' }],
    });
    noMirror.context.wlState.planStatus = 'unknown';
    noMirror.context.wlState.linearMetadataStatus = 'unknown';
    assert.strictEqual(await noMirror.context.wlRefetchSilent(), false, 'full background refresh requires Workload v2');
    assert.strictEqual(noMirror.counters.mirror, 0);
    assert.strictEqual(noMirror.counters.plans, 0);
    assert.strictEqual(await noMirror.context.wlRefetchSilent({ sensitiveOnly: true }), true, 'sensitive hydration works with wl2 off');
    assert.strictEqual(noMirror.counters.mirror, 0);
    assert.strictEqual(noMirror.counters.plans, 1);
    assert.strictEqual(noMirror.counters.metadata, 1);
    assert.strictEqual(noMirror.counters.n8n, 0);
  }

  // A purge detaches an obsolete deferred refresh. If a new identity/session
  // starts another one, the old outer finally must not clear the new promise
  // and its stale result must never publish over the new session.
  {
    const oldPlans = deferred();
    const newPlans = deferred();
    const raced = backgroundHarness({
      initialPlans: [],
      initialMetadata: [],
      fetchPlans: call => (call === 1 ? oldPlans.promise : newPlans.promise),
    });
    raced.context.wlState.planStatus = 'unknown';
    raced.context.wlState.linearMetadataStatus = 'unknown';
    const oldCall = raced.context.wlRefetchSilent({ sensitiveOnly: true });
    const oldPending = raced.context._wlBackgroundRefreshPromise;
    assert.ok(oldPending, 'old refresh is pending');
    raced.context.wlPurgePlanSensitiveState();
    assert.strictEqual(raced.context._wlBackgroundRefreshPromise, null, 'purge detaches the old refresh');
    const newCall = raced.context.wlRefetchSilent({ sensitiveOnly: true });
    const newPending = raced.context._wlBackgroundRefreshPromise;
    assert.ok(newPending && newPending !== oldPending, 'new session owns a distinct refresh');
    oldPlans.resolve({
      rows: [{ issue_id: 'issue-a', plan_date: '2026-08-01' }],
      readGeneration: 0,
    });
    assert.strictEqual(await oldCall, false, 'old generation cannot publish after purge');
    assert.strictEqual(
      raced.context._wlBackgroundRefreshPromise,
      newPending,
      'old finally cannot clear the newer refresh promise',
    );
    assert.strictEqual(raced.context.wlState.planByIssueId.has('issue-a'), false, 'old plan never reaches state');
    newPlans.resolve({
      rows: [{ issue_id: 'issue-a', plan_date: '2026-08-06' }],
      readGeneration: 0,
    });
    assert.strictEqual(await newCall, true);
    assert.strictEqual(raced.context.wlState.planByIssueId.get('issue-a'), '2026-08-06');
    assert.strictEqual(raced.context._wlBackgroundRefreshPromise, null);
  }

  // A full mirror refresh requested behind a sensitive-only single-flight must
  // wait, then execute its own mirror lane. Returning the sensitive result
  // directly would let an advanced watermark be consumed without reading it.
  {
    const firstPlans = deferred();
    const queuedFull = backgroundHarness({
      fetchPlans: call => (call === 1
        ? firstPlans.promise
        : Promise.resolve({ rows: [{ issue_id: 'issue-a', plan_date: '2026-08-07' }], readGeneration: 0 })),
    });
    const sensitiveCall = queuedFull.context.wlRefetchSilent({ sensitiveOnly: true });
    const fullCall = queuedFull.context.wlRefetchSilent();
    assert.strictEqual(queuedFull.counters.mirror, 0, 'full lane waits while sensitive hydration owns the flight');
    firstPlans.resolve({ rows: [{ issue_id: 'issue-a', plan_date: '2026-08-07' }], readGeneration: 0 });
    assert.strictEqual(await sensitiveCall, true);
    assert.strictEqual(await fullCall, true);
    assert.strictEqual(queuedFull.counters.mirror, 1, 'queued full lane fetches the mirror after sensitive hydration');
    assert.strictEqual(queuedFull.counters.plans, 2);
    assert.strictEqual(queuedFull.counters.metadata, 2);
    assert.strictEqual(queuedFull.counters.n8n, 0);
  }

  // Plan and Linear metadata readiness are separate capabilities. Recovering
  // either one must repaint the controls once even when every business value
  // in the two maps is unchanged.
  for (const [label, planStatus, metadataStatus] of [
    ['plan capability', 'stale', 'ready'],
    ['metadata capability', 'ready', 'stale'],
  ]) {
    const recovered = backgroundHarness();
    recovered.context.wlState.planStatus = planStatus;
    recovered.context.wlState.linearMetadataStatus = metadataStatus;
    const before = recovered.context.wlBackgroundBusinessFingerprint();
    assert.strictEqual(await recovered.context.wlRefetchSilent({ sensitiveOnly: true }), true);
    assert.strictEqual(recovered.context.wlBackgroundBusinessFingerprint(), before, `${label} recovery keeps map data unchanged`);
    assert.strictEqual(recovered.counters.render, 1, `${label} recovery repaints exactly once`);
    assert.strictEqual(recovered.counters.mirror, 0);
    assert.strictEqual(recovered.counters.n8n, 0);
  }

  // Visibility return uses the same watermark-only gate. Hidden events and an
  // unchanged cursor perform no full fetch, repaint, skeleton, or n8n call.
  {
    const visibility = backgroundHarness({ latestWatermark: '2026-07-22T12:00:00.000Z' });
    visibility.context._wlOnVisibilityChange();
    await Promise.resolve();
    assert.strictEqual(visibility.counters.watermark, 1);
    assert.strictEqual(visibility.counters.mirror, 0);
    assert.strictEqual(visibility.counters.render, 0);
    assert.strictEqual(visibility.counters.n8n, 0);
    visibility.context.document.hidden = true;
    visibility.context._wlOnVisibilityChange();
    assert.strictEqual(visibility.counters.watermark, 1, 'hidden visibility events are ignored');
  }

  // An advanced reconcile cursor whose normalized business data is identical
  // is consumed once. syncedAt and Edge audit timestamp churn cannot repaint
  // the board or make every poll refetch the complete mirror forever.
  {
    const noDiff = backgroundHarness();
    await noDiff.context._wlV2CheckWatermark();
    assert.strictEqual(noDiff.counters.mirror, 1, 'advanced watermark reads the Supabase mirror once');
    assert.strictEqual(noDiff.counters.plans, 1);
    assert.strictEqual(noDiff.counters.metadata, 1);
    assert.strictEqual(noDiff.counters.render, 0, 'syncedAt-only change does not repaint');
    assert.strictEqual(noDiff.counters.n8n, 0, 'background compare has no n8n fallback');
    assert.strictEqual(noDiff.context.wlState.sourceSyncedAt, '2026-07-22T12:01:00.000Z', 'no-diff success consumes the watermark');
    await noDiff.context._wlV2CheckWatermark();
    assert.strictEqual(noDiff.counters.mirror, 1, 'consumed no-diff watermark is not refetched');
    assert.ok(noDiff.renderStates.every(state => state.loading === false
      && state.refreshing === false
      && state.planStatus === 'ready'
      && state.metadataStatus === 'ready'));
  }

  // Each independently visible business change publishes one atomic snapshot
  // and repaints exactly once. Deadline-only metadata changes are included even
  // when the issue has no Workload label.
  for (const [label, options] of [
    ['issue', { freshIssues: [backgroundIssue({ title: 'Changed title', syncedAt: '2026-07-22T12:01:00.000Z' })] }],
    ['plan', { planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-08', updated_at: 'ignored' }] }],
    ['metadata', { metadataRows: [{
      issue_id: 'issue-a', due_date: '2026-08-10', updated_at: 'ignored',
      workload: { label: '3× Workload', weight: 3, color: '#00ff00' },
    }] }],
    ['deadline', {
      initialMetadata: [],
      metadataRows: [{ issue_id: 'issue-a', due_date: '2026-08-11', updated_at: 'ignored', workload: null }],
    }],
  ]) {
    const changed = backgroundHarness(options);
    assert.strictEqual(await changed.context.wlRefetchSilent(), true, `${label} snapshot completes`);
    assert.strictEqual(changed.counters.render, 1, `${label} change repaints exactly once`);
    assert.strictEqual(changed.counters.n8n, 0, `${label} background change never calls n8n`);
    assert.ok(changed.renderStates.every(state => state.loading === false
      && state.refreshing === false
      && state.planStatus === 'ready'
      && state.metadataStatus === 'ready'), `${label} repaint cannot select the skeleton`);
  }

  // Churn that cannot affect the rendered calendar is ignored even when the
  // raw mirror or plan sidecar rows changed. This covers completed work,
  // disallowed clients, and plan rows whose issue has left the active mirror.
  for (const [label, options] of [
    ['completed issue', {
      initialIssues: [
        backgroundIssue(),
        backgroundIssue({
          id: 'issue-hidden', identifier: 'VID-2', parentId: 'parent-hidden',
          title: 'Completed old', status: 'Done', statusType: 'completed',
        }),
      ],
      freshIssues: [
        backgroundIssue({ syncedAt: '2026-07-22T12:01:00.000Z' }),
        backgroundIssue({
          id: 'issue-hidden', identifier: 'VID-2', parentId: 'parent-hidden',
          title: 'Completed changed', status: 'Done', statusType: 'completed',
          syncedAt: '2026-07-22T12:01:00.000Z',
        }),
      ],
      initialPlans: [['issue-a', '2026-08-07'], ['issue-hidden', '2026-08-01']],
      planRows: [
        { issue_id: 'issue-a', plan_date: '2026-08-07' },
        { issue_id: 'issue-hidden', plan_date: '2026-08-02' },
      ],
    }],
    ['disallowed client', {
      initialIssues: [
        backgroundIssue(),
        backgroundIssue({
          id: 'issue-hidden', identifier: 'VID-2', parentId: 'parent-hidden',
          title: 'Disallowed old', clientName: 'Disallowed Client',
        }),
      ],
      freshIssues: [
        backgroundIssue({ syncedAt: '2026-07-22T12:01:00.000Z' }),
        backgroundIssue({
          id: 'issue-hidden', identifier: 'VID-2', parentId: 'parent-hidden',
          title: 'Disallowed changed', clientName: 'Disallowed Client',
          syncedAt: '2026-07-22T12:01:00.000Z',
        }),
      ],
      initialPlans: [['issue-a', '2026-08-07'], ['issue-hidden', '2026-08-01']],
      planRows: [
        { issue_id: 'issue-a', plan_date: '2026-08-07' },
        { issue_id: 'issue-hidden', plan_date: '2026-08-02' },
      ],
    }],
    ['stale plan row', {
      initialPlans: [['issue-a', '2026-08-07'], ['issue-gone', '2026-08-01']],
      planRows: [
        { issue_id: 'issue-a', plan_date: '2026-08-07' },
        { issue_id: 'issue-gone', plan_date: '2026-08-02' },
      ],
    }],
  ]) {
    const invisible = backgroundHarness(options);
    const before = invisible.context.wlBackgroundBusinessFingerprint();
    assert.strictEqual(await invisible.context.wlRefetchSilent(), true, `${label} snapshot completes`);
    assert.strictEqual(
      invisible.context.wlBackgroundBusinessFingerprint(),
      before,
      `${label} stays outside the normalized rendered projection`,
    );
    assert.strictEqual(invisible.counters.render, 0, `${label} does not repaint`);
    assert.strictEqual(invisible.counters.n8n, 0);
  }

  // Eligibility transitions are visible business changes: an issue entering
  // the active/allowed projection must repaint exactly once.
  for (const [label, hiddenIssue, visibleIssue] of [
    [
      'completed to active',
      backgroundIssue({
        id: 'issue-b', identifier: 'VID-2', parentId: 'parent-b',
        status: 'Done', statusType: 'completed',
      }),
      backgroundIssue({
        id: 'issue-b', identifier: 'VID-2', parentId: 'parent-b',
        status: 'To Do', statusType: 'unstarted', syncedAt: '2026-07-22T12:01:00.000Z',
      }),
    ],
    [
      'disallowed to allowed',
      backgroundIssue({
        id: 'issue-b', identifier: 'VID-2', parentId: 'parent-b',
        clientName: 'Disallowed Client',
      }),
      backgroundIssue({
        id: 'issue-b', identifier: 'VID-2', parentId: 'parent-b',
        clientName: 'Synthetic Client', syncedAt: '2026-07-22T12:01:00.000Z',
      }),
    ],
  ]) {
    const transition = backgroundHarness({
      initialIssues: [backgroundIssue(), hiddenIssue],
      freshIssues: [backgroundIssue({ syncedAt: '2026-07-22T12:01:00.000Z' }), visibleIssue],
      planRows: [
        { issue_id: 'issue-a', plan_date: '2026-08-07' },
        { issue_id: 'issue-b', plan_date: '2026-08-07' },
      ],
      metadataRows: [
        { issue_id: 'issue-a', due_date: '2026-08-10', workload: null },
        { issue_id: 'issue-b', due_date: '2026-08-10', workload: null },
      ],
    });
    assert.strictEqual(await transition.context.wlRefetchSilent(), true, `${label} snapshot completes`);
    assert.strictEqual(transition.counters.render, 1, `${label} repaints exactly once`);
    assert.strictEqual(transition.counters.n8n, 0);
  }

  // Metadata must be derived from the mirror result just fetched. Reusing the
  // previous ID set would make the all-or-nothing Edge read fail with 409.
  {
    const freshIds = backgroundHarness({
      freshIssues: [
        backgroundIssue({ syncedAt: '2026-07-22T12:01:00.000Z' }),
        backgroundIssue({ id: 'issue-b', identifier: 'VID-2', title: 'Video 2', syncedAt: '2026-07-22T12:01:00.000Z' }),
      ],
      metadataRows: [
        { issue_id: 'issue-a', due_date: '2026-08-10', workload: { label: '2× Workload', weight: 2, color: '#ff0000' } },
        { issue_id: 'issue-b', due_date: '2026-08-10', workload: null },
      ],
    });
    await freshIds.context.wlRefetchSilent();
    assert.deepStrictEqual(freshIds.metadataIssueSets[0], ['issue-a', 'issue-b'], 'metadata receives the fresh active issue set');
    assert.strictEqual(freshIds.counters.render, 1);
  }

  // Failure in any background component is atomic: the visible calendar and
  // all role-sensitive maps remain exactly as they were, while only the small
  // non-destructive freshness warning is updated. The cursor stays retryable.
  {
    const failed = backgroundHarness({
      fail: 'metadata',
      freshIssues: [backgroundIssue({ title: 'Must not publish', syncedAt: '2026-07-22T12:01:00.000Z' })],
      planRows: [{ issue_id: 'issue-a', plan_date: '2026-08-09' }],
    });
    const before = failed.context.wlBackgroundBusinessFingerprint();
    await failed.context._wlV2CheckWatermark();
    assert.strictEqual(failed.context.wlBackgroundBusinessFingerprint(), before, 'failed background work publishes no partial state');
    assert.strictEqual(failed.counters.render, 0, 'failure preserves the visible calendar DOM');
    assert.strictEqual(failed.counters.status, 1, 'failure updates only the freshness warning');
    assert.match(failed.context.wlState.backgroundError, /metadata unavailable/);
    assert.strictEqual(failed.context.wlState.sourceSyncedAt, '2026-07-22T12:00:00.000Z', 'failed snapshot leaves the watermark retryable');
  }

  // Auth denial wins over an unrelated concurrent network failure. Otherwise
  // a rejected plan read can mask a metadata 401/403 and leave private maps
  // mounted after the server has revoked access.
  for (const status of [401, 403]) {
    const denied = backgroundHarness({
      fetchPlans: async () => { throw new Error('plan network unavailable'); },
      fetchMetadata: async () => {
        const error = new Error(`metadata ${status}`);
        error.status = status;
        throw error;
      },
    });
    const sessionBefore = denied.context._wlPlanSessionGeneration;
    assert.strictEqual(await denied.context.wlRefetchSilent({ sensitiveOnly: true }), false);
    assert.strictEqual(denied.context.wlState.planByIssueId.size, 0, `${status} purges saved plan rows`);
    assert.strictEqual(denied.context.wlState.workloadByIssueId.size, 0, `${status} purges workload metadata`);
    assert.strictEqual(denied.context.wlState.planStatus, 'unknown');
    assert.strictEqual(denied.context.wlState.linearMetadataStatus, 'unknown');
    assert.strictEqual(denied.context._wlPlanSessionGeneration, sessionBefore + 1, `${status} invalidates the old staff session`);
    assert.strictEqual(denied.counters.identityClear, status === 401 ? 1 : 0, `${status} uses the correct auth purge path`);
  }

  // Foreground loading has the same all-or-nothing private boundary. An auth
  // failure from either settled projection is handled before either fulfilled
  // sibling can be adopted; the non-sensitive issue payload remains usable.
  {
    const authError = (status, message) => Object.assign(new Error(message), { status });
    const genericError = message => new Error(message);
    const goodPlan = { rows: [{ issue_id: 'issue-a', plan_date: '2026-08-08' }], readGeneration: 0 };
    const goodMetadata = [{ issue_id: 'issue-a', due_date: '2026-08-10', workload: null }];
    for (const [label, planOutcome, metadataOutcome, expectedIdentityClears] of [
      ['plan 401 with fulfilled metadata', authError(401, 'plan expired'), goodMetadata, 1],
      ['metadata 401 with fulfilled plan', goodPlan, authError(401, 'metadata expired'), 1],
      ['plan 403 with generic metadata failure', authError(403, 'plan forbidden'), genericError('metadata offline'), 0],
      ['metadata 403 with generic plan failure', genericError('plan offline'), authError(403, 'metadata forbidden'), 0],
    ]) {
      const counts = { identityClear: 0, purge: 0, planAdopt: 0, metadataAdopt: 0, issueApply: 0 };
      const freshIssue = backgroundIssue({ title: `Fresh ${label}` });
      const foreground = {
        _wlPlanLoadGeneration: 0,
        wlState: {
          planHasSnapshot: true,
          planStatus: 'ready',
          planError: null,
          planByIssueId: new Map([['issue-a', '2026-08-07']]),
          workloadByIssueId: new Map([['issue-a', { label: '2× Workload', weight: 2, color: '#ff0000' }]]),
          linearMetadataStatus: 'ready',
          linearMetadataError: null,
          issueSnapshot: [backgroundIssue({ title: 'Old issue' })],
          fetchedAt: 1,
        },
        document: { querySelector: () => ({}) },
        renderWorkloadAll: () => {},
        loadLinearIssues: async () => ({ issues: [freshIssue], fetchedAt: 2, usedFallback: false }),
        wlFetchPlanRows: async () => {
          if (planOutcome instanceof Error) throw planOutcome;
          return planOutcome;
        },
        wlFetchLinearMetadata: async () => {
          if (metadataOutcome instanceof Error) throw metadataOutcome;
          return metadataOutcome;
        },
        wlPurgePlanSensitiveState: () => {
          counts.purge++;
          foreground.wlState.planByIssueId.clear();
          foreground.wlState.workloadByIssueId.clear();
          foreground.wlState.planStatus = 'unknown';
          foreground.wlState.linearMetadataStatus = 'unknown';
        },
        _syncviewStaffIdentityClear: () => {
          counts.identityClear++;
          foreground.wlPurgePlanSensitiveState();
        },
        wlAdoptPlanRows: () => { counts.planAdopt++; },
        wlAdoptLinearMetadata: () => { counts.metadataAdopt++; },
        wlMarkPlanReadFailure: () => {},
        wlMarkLinearMetadataFailure: () => {},
        wlSanitizeFailedNativeMetadata: () => false,
        wlApplyData: (issues, fetchedAt) => {
          counts.issueApply++;
          foreground.wlState.issueSnapshot = issues;
          foreground.wlState.fetchedAt = fetchedAt;
        },
        Array, Number, Error, Promise,
        console: { warn: () => {} },
      };
      foreground.globalThis = foreground;
      vm.createContext(foreground);
      vm.runInContext(extract('wlLoadSnapshot'), foreground);
      const payload = await foreground.wlLoadSnapshot(true, null);
      assert.strictEqual(payload.issues[0].title, freshIssue.title, `${label} retains public issue data`);
      assert.strictEqual(counts.issueApply, 1);
      assert.strictEqual(counts.planAdopt, 0, `${label} cannot adopt a fulfilled plan sibling`);
      assert.strictEqual(counts.metadataAdopt, 0, `${label} cannot adopt a fulfilled metadata sibling`);
      assert.strictEqual(foreground.wlState.planByIssueId.size, 0);
      assert.strictEqual(foreground.wlState.workloadByIssueId.size, 0);
      assert.strictEqual(counts.purge, 1);
      assert.strictEqual(counts.identityClear, expectedIdentityClears, `${label} uses the correct identity path`);
    }
  }

  // Manual Refresh remains the deliberate foreground exception: it marks the
  // board refreshing (the renderer's skeleton condition) and forces the direct
  // no-cache Linear/n8n lane.
  {
    let forced = null;
    let cursorDuringLoad = 'not-called';
    let watermarkReads = 0, mirrorReads = 0;
    const duringLoad = [];
    const manualContext = {
      wlState: {
        refreshing: false,
        error: null,
        backgroundError: 'old warning',
        sourceSyncedAt: '2026-07-22T12:00:00.000Z',
      },
      document: { querySelector: () => ({}) },
      _wlV2Ready: () => true,
      _wlV2FetchLatestWatermark: async () => {
        watermarkReads++;
        assert.strictEqual(manualContext.wlState.sourceSyncedAt, null, 'manual baseline reads only after clearing the old cursor');
        return '2026-07-22T12:05:00.000Z';
      },
      _wlV2FetchIssues: () => { mirrorReads++; throw new Error('manual baseline fetched mirror data'); },
      wlClearBackgroundRefreshFailure: () => { manualContext.wlState.backgroundError = null; },
      wlMarkBackgroundRefreshFailure: error => { manualContext.wlState.backgroundError = error.message; },
      wlSpinnerOn: () => {},
      wlSpinnerOff: () => {},
      wlLoadSnapshot: async (force, fallback) => {
        forced = [force, fallback];
        cursorDuringLoad = manualContext.wlState.sourceSyncedAt;
        duringLoad.push(manualContext.wlState.refreshing);
        return { usedFallback: false };
      },
      renderWorkloadAll: () => {},
      console,
    };
    manualContext.globalThis = manualContext;
    vm.createContext(manualContext);
    vm.runInContext(extract('wlRebaseMirrorWatermarkAfterDirectRefresh'), manualContext);
    vm.runInContext(extract('wlManualRefresh'), manualContext);
    await manualContext.wlManualRefresh();
    assert.deepStrictEqual(forced, [true, null], 'manual refresh keeps the forced direct path');
    assert.deepStrictEqual(duringLoad, [true], 'manual refresh enters the skeleton-producing refreshing state');
    assert.strictEqual(cursorDuringLoad, null, 'successful direct refresh starts with the old mirror cursor cleared');
    assert.strictEqual(watermarkReads, 1, 'manual refresh establishes one cheap Supabase watermark baseline');
    assert.strictEqual(mirrorReads, 0, 'manual baselining never applies mirror issue data');
    assert.strictEqual(manualContext.wlState.sourceSyncedAt, '2026-07-22T12:05:00.000Z');
    assert.strictEqual(manualContext.wlState.refreshing, false);
    assert.strictEqual(manualContext.wlState.backgroundError, null);
  }

  // If that cheap baseline request fails, the cursor remains empty. The next
  // ordinary watermark check establishes a baseline and returns; it cannot
  // mistake an older mirror snapshot for an advanced change and apply it.
  {
    let watermarkReads = 0, mirrorReads = 0, fullRefreshes = 0;
    const failedBaseline = {
      _wlV2WatermarkBusy: false,
      wlState: {
        refreshing: false,
        loading: false,
        planStatus: 'ready',
        error: null,
        backgroundError: null,
        sourceSyncedAt: '2026-07-22T12:00:00.000Z',
      },
      document: { hidden: false, querySelector: () => ({}) },
      _wlV2Ready: () => true,
      _wlV2FetchLatestWatermark: async () => {
        watermarkReads++;
        if (watermarkReads === 1) throw new Error('baseline unavailable');
        return '2026-07-22T12:06:00.000Z';
      },
      _wlV2FetchIssues: () => { mirrorReads++; throw new Error('baseline path fetched mirror'); },
      wlRefetchSilent: () => { fullRefreshes++; throw new Error('baseline path entered full refresh'); },
      wlClearBackgroundRefreshFailure: () => { failedBaseline.wlState.backgroundError = null; },
      wlMarkBackgroundRefreshFailure: error => { failedBaseline.wlState.backgroundError = error.message; },
      wlSpinnerOn: () => {},
      wlSpinnerOff: () => {},
      wlLoadSnapshot: async () => ({ usedFallback: false }),
      renderWorkloadAll: () => {},
      console: { warn: () => {}, error: console.error, log: console.log },
      Date, Promise, Error,
    };
    failedBaseline.globalThis = failedBaseline;
    vm.createContext(failedBaseline);
    vm.runInContext(extract('wlRebaseMirrorWatermarkAfterDirectRefresh'), failedBaseline);
    vm.runInContext(extract('wlManualRefresh'), failedBaseline);
    vm.runInContext(extract('_wlV2CheckWatermark'), failedBaseline);
    await failedBaseline.wlManualRefresh();
    assert.strictEqual(failedBaseline.wlState.sourceSyncedAt, null, 'failed manual baseline leaves the cursor empty');
    assert.match(failedBaseline.wlState.backgroundError, /baseline unavailable/);
    await failedBaseline._wlV2CheckWatermark();
    assert.strictEqual(failedBaseline.wlState.sourceSyncedAt, '2026-07-22T12:06:00.000Z');
    assert.strictEqual(watermarkReads, 2);
    assert.strictEqual(mirrorReads, 0, 'the next check establishes a cursor without reading mirror rows');
    assert.strictEqual(fullRefreshes, 0, 'the next check does not adopt an older mirror snapshot');
    assert.strictEqual(failedBaseline.wlState.backgroundError, null);
  }

  console.log('Workload Linear browser fail-closed checks passed');
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
