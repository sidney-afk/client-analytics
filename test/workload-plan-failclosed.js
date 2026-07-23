'use strict';

// Workload plan-day fail-closed regression guard. Saves are optimistic,
// but the browser must keep the move only when the Edge Function reports one
// row it actually wrote and returns the matching canonical issue/date.

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
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

function makeContext(reply, optimisticDate) {
  const notifies = [];
  const renders = [];
  const issue = {
    id: 'synthetic-issue-1',
    clientName: 'Synthetic Client',
    dueDate: '2026-07-25',
  };
  const planByIssueId = new Map();
  if (optimisticDate) planByIssueId.set(issue.id, optimisticDate);
  const context = {
    _wlPlanWriteRequest: async () => {
      if (reply instanceof Error) throw reply;
      return {
        ok: reply.httpOk !== false,
        status: reply.status || 200,
        json: async () => reply.body,
      };
    },
    wlApplyPlanLocal: (issueId, planDate) => {
      if (planDate) planByIssueId.set(issueId, planDate);
      else planByIssueId.delete(issueId);
    },
    renderWorkloadAll: () => renders.push(true),
    showNotify: (title, body) => notifies.push([title, body]),
    String, Error, Promise, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extract('_wlPersistPlanDate'), context);
  return { context, issue, planByIssueId, notifies, renders };
}

function makeSetContext(fetchImpl, fastTimeout, staffRole = 'admin', initialPlan = null) {
  const issue = {
    id: 'synthetic-issue-1',
    clientName: 'Synthetic Client',
    dueDate: '2026-07-25',
  };
  const renderDays = [];
  const notifies = [];
  const initialPlanMap = new Map();
  if (initialPlan) initialPlanMap.set(issue.id, initialPlan);
  const initialDisplayDate = initialPlan || '2026-07-24';
  const context = {
    WORKLOAD_PLAN_URL: 'https://example.invalid/functions/v1/workload-plan',
    WL_PLAN_WRITE_TIMEOUT_MS: 10000,
    _wlPlanWriteGeneration: 0,
    _wlPlanSessionGeneration: 0,
    _wlPlanWriteInFlight: new Map(),
    _wlPlanLastWriteGeneration: new Map(),
    wlState: {
      allActiveSubs: [issue],
      issueSnapshot: [issue],
      fetchedAt: 1,
      planByIssueId: initialPlanMap,
      planHasSnapshot: true,
      planStatus: 'ready',
      calendarByDate: new Map([[initialDisplayDate, [issue]]]),
    },
    _syncviewStaffIdentityForHeaders: () => staffRole ? { role: staffRole } : null,
    _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
    _syncviewRequireStaffIdentity: async () => ({ key: 'synthetic' }),
    _syncviewEfHeaders: headers => headers,
    fetch: fetchImpl,
    wlIsTweaksNeeded: () => false,
    wlResetPlanDisplay: () => {},
    wlApplyData: () => {
      const day = context.wlState.planByIssueId.get(issue.id) || '2026-07-24';
      context.wlState.calendarByDate = new Map([[day, [issue]]]);
    },
    renderWorkloadAll: () => {
      renderDays.push([...context.wlState.calendarByDate.keys()][0] || null);
    },
    wlFocusPlanItem: () => {},
    showNotify: (title, body) => notifies.push([title, body]),
    AbortController,
    setTimeout: fastTimeout
      ? callback => { Promise.resolve().then(callback); return 1; }
      : setTimeout,
    clearTimeout: fastTimeout ? () => {} : clearTimeout,
    JSON, String, Error, Promise, Map, Array, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extract('_syncviewStaffCan'), context);
  vm.runInContext(extract('wlPlanEditingEnabled'), context);
  vm.runInContext(extract('wlPlanDate'), context);
  vm.runInContext(extract('wlApplyPlanLocal'), context);
  vm.runInContext(extract('_wlPlanWriteRequest'), context);
  vm.runInContext(extract('_wlPersistPlanDate'), context);
  vm.runInContext(extract('wlSetPlanDate'), context);
  return { context, issue, renderDays, notifies };
}

function makeGroupContext() {
  const sourceDate = '2026-07-24';
  const targetDate = '2026-07-30';
  const issues = Array.from({ length: 6 }, (_, index) => ({
    id: 'synthetic-group-' + (index + 1),
    identifier: 'VID-' + (index + 1),
    clientName: 'Synthetic Client',
    assigneeId: 'synthetic-editor',
    dueDate: index === 1 ? '2026-07-20' : sourceDate,
  }));
  const priorOverrideId = issues[1].id;
  const fallbackFailureId = issues[4].id;
  const failedIds = new Set([priorOverrideId, fallbackFailureId]);
  const planByIssueId = new Map([[priorOverrideId, sourceDate]]);
  const calls = [];
  const notifies = [];
  const renders = [];
  let active = 0;
  let maxActive = 0;
  let firstRequestSnapshot = null;
  const context = {
    _wlPlanWriteGeneration: 0,
    _wlPlanSessionGeneration: 0,
    _wlPlanWriteInFlight: new Map(),
    _wlPlanLastWriteGeneration: new Map(),
    wlState: {
      planByIssueId,
      planStatus: 'ready',
      calendarByDate: new Map([[sourceDate, issues]]),
    },
    wlPlanEditingEnabled: () => true,
    wlIsTweaksNeeded: () => false,
    wlPlanDate: issue => planByIssueId.get(String(issue && issue.id || '')) || '',
    wlApplyPlanLocal: (issueId, planDate) => {
      if (planDate) planByIssueId.set(String(issueId), planDate);
      else planByIssueId.delete(String(issueId));
    },
    renderWorkloadAll: () => renders.push(new Map(planByIssueId)),
    showNotify: (title, body) => notifies.push([title, body]),
    _wlPlanWriteRequest: async (issue, planDate) => {
      active++;
      maxActive = Math.max(maxActive, active);
      calls.push(issue.id);
      if (!firstRequestSnapshot) firstRequestSnapshot = new Map(planByIssueId);
      await Promise.resolve();
      active--;
      if (failedIds.has(issue.id)) throw new Error('synthetic failure');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          updated: 1,
          plan: { issue_id: issue.id, plan_date: planDate },
        }),
      };
    },
    String, Set, Map, Math, Number, Array, Error, Promise, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(extract('_wlPersistPlanDate'), context);
  vm.runInContext(extract('wlMovePlanGroup'), context);
  return {
    context, issues, sourceDate, targetDate, priorOverrideId, fallbackFailureId,
    calls, notifies, renders, planByIssueId,
    maxActive: () => maxActive,
    firstRequestSnapshot: () => firstRequestSnapshot,
  };
}

function makeIdentityPurgeContext() {
  const identityKey = 'syncview_staff_identity_v1';
  const currentIdentity = {
    key: 'synthetic-admin-key',
    role: 'admin',
    member: { id: 'synthetic-admin', name: 'Synthetic Admin' },
  };
  const storage = new Map([[identityKey, JSON.stringify(currentIdentity)]]);
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const warmIssueSnapshot = [{
    id: 'warm-issue',
    isSubIssue: true,
    dueDate: '2026-07-31',
  }];
  const applyCalls = [];
  const renders = [];
  let bootCalls = 0;
  let focusCalls = 0;
  const context = {
    SYNCVIEW_STAFF_IDENTITY_KEY: identityKey,
    _syncviewStaffIdentityMem: currentIdentity,
    _syncviewStaffIdentityLoaded: true,
    _syncviewStaffIdentityVerified: true,
    _syncviewStaffBootPromise: null,
    _wlPlanSessionGeneration: 2,
    _wlPlanLoadGeneration: 5,
    _wlPlanWriteGeneration: 8,
    _wlPlanWriteInFlight: new Map([['warm-issue', {}]]),
    _wlDueWriteInFlight: new Map([['warm-issue', {}]]),
    _wlPlanLastWriteGeneration: new Map([['warm-issue', 8]]),
    wlState: {
      planByIssueId: new Map([['warm-issue', '2026-07-29']]),
      planHasSnapshot: true,
      planStatus: 'ready',
      planError: null,
      planFetchedAt: 1,
      workloadByIssueId: new Map([['warm-issue', { weight: 3 }]]),
      linearMetadataStatus: 'ready',
      linearMetadataError: null,
      issueSnapshot: warmIssueSnapshot,
      calendarByDate: new Map([['2026-07-29', warmIssueSnapshot]]),
      fetchedAt: 1,
    },
    localStorage,
    wlApplyData: (issues, fetchedAt) => {
      applyCalls.push([issues, fetchedAt]);
      context.wlState.issueSnapshot = issues;
      context.wlState.calendarByDate = new Map([['2026-07-30', issues]]);
    },
    wlClosePopover: () => {},
    renderWorkloadAll: () => renders.push(true),
    _syncviewStaffClearLegacyIdentityStorage: () => {},
    _syncviewStaffRefreshChrome: () => {},
    _syncviewCloseStaffAccount: () => {},
    _syncviewStaffIdentityBoot: () => { bootCalls++; return Promise.resolve(null); },
    showToast: () => {},
    document: {
      querySelector: selector => selector === '.workload-view' ? {} : null,
      querySelectorAll: () => [],
      getElementById: id => id === 'headerMenuButton' ? { focus: () => { focusCalls++; } } : null,
    },
    setTimeout,
    clearTimeout,
    JSON, String, Number, Map, Array, Error, Promise, console,
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const name of [
    '_syncviewStaffIdentitySignature',
    '_syncviewStaffIdentityLoad',
    '_syncviewStaffIdentitySave',
    '_syncviewStaffIdentityValid',
    'wlPurgePlanSensitiveState',
    '_syncviewStaffPurgeSensitiveState',
    '_syncviewStaffIdentityClear',
    '_syncviewStaffSignOut',
    '_syncviewStaffIdentityStorageChanged',
    'wlMarkPlanReadFailure',
  ]) vm.runInContext(extract(name), context);
  return {
    context,
    warmIssueSnapshot,
    applyCalls,
    renders,
    bootCalls: () => bootCalls,
    focusCalls: () => focusCalls,
  };
}

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL workload-plan-failclosed: ' + message); }
}

(async () => {
  {
    let role = 'creative';
    const context = {
      wlState: { planStatus: 'ready' },
      _syncviewStaffIdentityForHeaders: () => ({ role }),
      _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
      String,
    };
    vm.createContext(context);
    vm.runInContext(extract('_syncviewStaffCan'), context);
    vm.runInContext(extract('wlPlanEditingEnabled'), context);
    ok(context._syncviewStaffCan('workload-plan-read') === true
        && context._syncviewStaffCan('workload-plan') === false
        && context.wlPlanEditingEnabled() === false,
      'Creative identities read the shared Workload plan but cannot edit it');
    role = 'smm';
    ok(context._syncviewStaffCan('workload-plan-read') === true
        && context._syncviewStaffCan('workload-plan') === true
        && context.wlPlanEditingEnabled() === true,
      'SMM identities can read and edit when the plan snapshot is ready');
    role = 'admin';
    ok(context._syncviewStaffCan('workload-plan-read') === true
        && context._syncviewStaffCan('workload-plan') === true
        && context.wlPlanEditingEnabled() === true,
      'Admin identities can read and edit when the plan snapshot is ready');
    context.wlState.planStatus = 'stale';
    ok(context.wlPlanEditingEnabled() === false,
      'an authorized role still fails closed when the plan snapshot is stale');
  }

  {
    let fetchCalls = 0;
    const h = makeSetContext(async () => {
      fetchCalls++;
      throw new Error('Creative write must not reach fetch');
    }, false, 'creative');
    const saved = await h.context.wlSetPlanDate(h.issue.id, '2026-07-29');
    ok(saved === false
        && fetchCalls === 0
        && !h.context.wlState.planByIssueId.has(h.issue.id)
        && h.context._wlPlanWriteInFlight.size === 0,
      'Creative plan changes stop before optimistic state, in-flight state, or a request');
  }

  {
    let writtenPlanDate = null;
    const h = makeSetContext(async (_url, init) => {
      writtenPlanDate = JSON.parse(init.body).plan_date;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          updated: 1,
          plan: { issue_id: 'synthetic-issue-1', plan_date: '2026-07-24' },
        }),
      };
    });
    const saved = await h.context.wlSetPlanDate(h.issue.id, '2026-07-24');
    ok(saved === true
        && writtenPlanDate === '2026-07-24'
        && h.context.wlState.planByIssueId.get(h.issue.id) === '2026-07-24',
      'selecting the visible automatic day still writes an explicit manual pin');
  }

  {
    const h = makeContext({
      body: {
        ok: true,
        updated: 0,
        plan: { issue_id: 'synthetic-issue-1', plan_date: '2026-07-29' },
      },
    }, '2026-07-29');
    const saved = await h.context._wlPersistPlanDate(h.issue, '2026-07-29', '2026-07-27');
    ok(saved === false && h.planByIssueId.get(h.issue.id) === '2026-07-27',
      'updated=0 restores the exact previous plan day');
    ok(h.notifies.length === 1 && /put back/i.test(h.notifies[0][1]),
      'short writes visibly notify instead of silently keeping the move');
  }

  {
    const h = makeContext({
      body: {
        ok: true,
        updated: 2,
        plan: { issue_id: 'synthetic-issue-1', plan_date: '2026-07-29' },
      },
    }, '2026-07-29');
    const saved = await h.context._wlPersistPlanDate(h.issue, '2026-07-29', '2026-07-27');
    ok(saved === false && h.planByIssueId.get(h.issue.id) === '2026-07-27',
      'updated=2 also fails the exact-one gate and restores the previous plan day');
  }

  {
    const h = makeSetContext(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        updated: 0,
        plan: { issue_id: 'synthetic-issue-1', plan_date: '2026-07-29' },
      }),
    }));
    const saved = await h.context.wlSetPlanDate(h.issue.id, '2026-07-29');
    ok(saved === false
        && h.renderDays[0] === '2026-07-29'
        && h.renderDays[h.renderDays.length - 1] === '2026-07-24'
        && !h.context.wlState.planByIssueId.has(h.issue.id)
        && h.context._wlPlanWriteInFlight.size === 0,
      'real save path moves optimistically, then re-buckets to the automatic day on a short count');
  }

  {
    const h = makeSetContext((_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }), true);
    const saved = await h.context.wlSetPlanDate(h.issue.id, '2026-07-29');
    ok(saved === false
        && h.renderDays[0] === '2026-07-29'
        && h.renderDays[h.renderDays.length - 1] === '2026-07-24'
        && h.notifies.length === 1,
      'a never-settling write is aborted, reverted, and visibly reported');
  }

  {
    const h = makeContext(new Error('offline'), '2026-07-29');
    const saved = await h.context._wlPersistPlanDate(h.issue, '2026-07-29', null);
    ok(saved === false && !h.planByIssueId.has(h.issue.id),
      'network failure restores an absent previous override');
    ok(h.notifies.length === 1, 'network failure is visible');
  }

  {
    const h = makeContext({
      body: {
        ok: true,
        updated: 1,
        plan: { issue_id: 'synthetic-issue-1', plan_date: '2026-07-29' },
      },
    }, '2026-07-29');
    const saved = await h.context._wlPersistPlanDate(h.issue, '2026-07-29', '2026-07-27');
    ok(saved === true && h.planByIssueId.get(h.issue.id) === '2026-07-29',
      'one matching actual write preserves the optimistic move');
    ok(h.notifies.length === 0 && h.renders.length === 0,
      'successful persistence does not roll back or warn');
  }

  {
    const h = makeContext({
      body: {
        ok: true,
        updated: 1,
        plan: { issue_id: 'synthetic-issue-1', plan_date: null },
      },
    }, null);
    const saved = await h.context._wlPersistPlanDate(h.issue, null, '2026-07-27');
    ok(saved === true && !h.planByIssueId.has(h.issue.id),
      'a matching one-row clear preserves null so the automatic day becomes visible');
  }

  {
    const h = makeSetContext(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        updated: 0,
        plan: { issue_id: 'synthetic-issue-1', plan_date: null },
      }),
    }), false, 'admin', '2026-07-29');
    const saved = await h.context.wlSetPlanDate(h.issue.id, null);
    ok(saved === false
        && h.renderDays[0] === '2026-07-24'
        && h.renderDays[h.renderDays.length - 1] === '2026-07-29'
        && h.context.wlState.planByIssueId.get(h.issue.id) === '2026-07-29'
        && h.notifies.length === 1,
      'a failed Use automatic plan request restores the previous manual day and notifies');
  }

  {
    const h = makeContext({
      body: {
        ok: true,
        updated: 1,
        plan: { issue_id: 'different-issue', plan_date: '2026-07-29' },
      },
    }, '2026-07-29');
    const saved = await h.context._wlPersistPlanDate(h.issue, '2026-07-29', '2026-07-27');
    ok(saved === false && h.planByIssueId.get(h.issue.id) === '2026-07-27',
      'a mismatched canonical row fails closed and restores the previous value');
  }

  {
    const h = makeGroupContext();
    const moved = await h.context.wlMovePlanGroup(
      h.sourceDate, 'synthetic-editor', 'Synthetic Client', h.targetDate
    );
    const firstSnapshot = h.firstRequestSnapshot();
    const succeeded = h.issues.filter(issue =>
      issue.id !== h.priorOverrideId && issue.id !== h.fallbackFailureId
    );
    ok(moved === false
        && firstSnapshot
        && h.issues.every(issue => firstSnapshot.get(issue.id) === h.targetDate),
      'group drag paints every member on the target before its first request');
    ok(h.calls.join(',') === h.issues.map(issue => issue.id).join(',')
        && h.maxActive() === 1,
      'group drag persists through the existing one-row writer sequentially');
    ok(succeeded.every(issue => h.planByIssueId.get(issue.id) === h.targetDate)
        && h.planByIssueId.get(h.priorOverrideId) === h.sourceDate
        && !h.planByIssueId.has(h.fallbackFailureId)
        && h.context._wlPlanWriteInFlight.size === 0,
      'partial group failure keeps successes and restores each failed prior plan value');
    ok(h.notifies.length === 1
        && h.notifies[0][0] === 'Moved 4 of 6 — 2 put back'
        && h.renders.length === 2,
      'partial group failure emits one aggregate notification and one settled repaint');
  }

  // A delayed real list fetch captured before a successful write must not
  // overwrite the just-saved local date after the in-flight token clears.
  // Exercise wlFetchPlanRows itself so this proof stays bound to the exact
  // point where readGeneration is captured, not a handcrafted snapshot.
  {
    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const response = deferred();
    const fetchStarted = deferred();
    let requiredCapability = null;
    const context = {
      WORKLOAD_PLAN_URL: 'https://example.invalid/functions/v1/workload-plan',
      WL_PLAN_READ_TIMEOUT_MS: 8000,
      _wlPlanSessionGeneration: 0,
      _wlPlanWriteGeneration: 3,
      wlState: {
        planByIssueId: new Map([['synthetic-issue-1', '2026-07-29']]),
        planHasSnapshot: false,
        planStatus: 'ready',
        planError: null,
        planFetchedAt: null,
      },
      _wlPlanWriteInFlight: new Map(),
      _wlPlanLastWriteGeneration: new Map(),
      _syncviewRequireStaffIdentity: async capability => {
        requiredCapability = capability;
        return { key: 'synthetic' };
      },
      _syncviewEfHeaders: headers => headers,
      fetch: async () => {
        fetchStarted.resolve();
        return response.promise;
      },
      AbortController, setTimeout, clearTimeout,
      Date, Number, String, Map, Array, Error, Promise,
    };
    vm.createContext(context);
    vm.runInContext(extract('wlFetchPlanRows'), context);
    vm.runInContext(extract('wlAdoptPlanRows'), context);
    const pending = context.wlFetchPlanRows();
    await fetchStarted.promise;
    context._wlPlanWriteGeneration = 4;
    context._wlPlanLastWriteGeneration.set('synthetic-issue-1', 4);
    response.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        plans: [{ issue_id: 'synthetic-issue-1', plan_date: '2026-07-27' }],
      }),
    });
    const snapshot = await pending;
    context.wlAdoptPlanRows(snapshot);
    ok(requiredCapability === 'workload-plan-read'
        && snapshot.readGeneration === 3
        && context.wlState.planByIssueId.get('synthetic-issue-1') === '2026-07-29',
      'Creative-safe reads use the read capability and a real stale list fetch cannot overwrite a newer write');
  }

  // When two refreshes overlap, the older completion must not overwrite the
  // newer snapshot or downgrade its ready status after the newer one wins.
  {
    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const oldIssues = deferred();
    const newIssues = deferred();
    const oldPlans = deferred();
    const newPlans = deferred();
    const oldMetadata = deferred();
    const newMetadata = deferred();
    const issueQueue = [oldIssues.promise, newIssues.promise];
    const planQueue = [oldPlans.promise, newPlans.promise];
    const applied = [];
    const adopted = [];
    const metadataAdopted = [];
    let failuresMarked = 0;
    const context = {
      _wlPlanLoadGeneration: 0,
      wlState: {
        planByIssueId: new Map(),
        planHasSnapshot: false,
        planStatus: 'unknown',
        planError: null,
        issueSnapshot: [],
        fetchedAt: null,
        workloadByIssueId: new Map(),
        linearMetadataStatus: 'unknown',
        linearMetadataError: null,
      },
      loadLinearIssues: () => issueQueue.shift(),
      wlFetchPlanRows: () => planQueue.shift(),
      wlFetchLinearMetadata: issues => issues[0].id === 'newer' ? newMetadata.promise : oldMetadata.promise,
      wlAdoptPlanRows: value => {
        adopted.push(value.marker);
        context.wlState.planHasSnapshot = true;
        context.wlState.planStatus = 'ready';
      },
      wlMarkPlanReadFailure: () => {
        failuresMarked++;
        context.wlState.planStatus = 'stale';
      },
      wlAdoptLinearMetadata: (value, issues) => {
        metadataAdopted.push(value.marker);
        context.wlState.workloadByIssueId = new Map([[issues[0].id, value.weight]]);
        context.wlState.linearMetadataStatus = 'ready';
      },
      wlMarkLinearMetadataFailure: () => { failuresMarked++; },
      wlApplyData: issues => applied.push(issues[0].id),
      renderWorkloadAll: () => {},
      document: { querySelector: () => null },
      Promise, Array, Error,
    };
    vm.createContext(context);
    vm.runInContext(extract('wlLoadSnapshot'), context);
    const older = context.wlLoadSnapshot(true, null);
    const newer = context.wlLoadSnapshot(true, null);
    newIssues.resolve({ issues: [{ id: 'newer' }], fetchedAt: 2 });
    newPlans.resolve({ marker: 'newer' });
    newMetadata.resolve({ marker: 'newer', weight: 3 });
    await newer;
    oldIssues.resolve({ issues: [{ id: 'older' }], fetchedAt: 1 });
    oldPlans.reject(new Error('older failed'));
    oldMetadata.resolve({ marker: 'older', weight: 2 });
    await older;
    ok(adopted.join(',') === 'newer'
        && applied.join(',') === 'newer'
        && failuresMarked === 0
        && context.wlState.planStatus === 'ready'
        && metadataAdopted.join(',') === 'newer'
        && context.wlState.workloadByIssueId.get('newer') === 3
        && !context.wlState.workloadByIssueId.has('older'),
      'only the newest overlapping refresh may publish plan, workload metadata, issue, or failure state');
  }

  // Starting a due-date write must immediately invalidate any older background
  // metadata snapshot. Otherwise a fast successful write can settle first and
  // then be overwritten when the old read finally returns.
  {
    const dueWriteSource = extract('wlSetDueDate');
    const invalidateAt = dueWriteSource.indexOf('_wlPlanLoadGeneration++');
    const applyAt = dueWriteSource.indexOf('wlApplyDueLocal(key, dueDate)');
    const requestAt = dueWriteSource.indexOf('await _wlDueWriteRequest(issue, dueDate, route)');
    ok(invalidateAt >= 0 && invalidateAt < applyAt && applyAt < requestAt,
      'due-date writes invalidate older snapshot generations before optimistic state or network I/O');

    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const metadata = deferred();
    const metadataStarted = deferred();
    const dueResponse = deferred();
    const issue = {
      id: 'due-race-issue',
      isSubIssue: true,
      title: 'Current issue title',
      clientName: 'Synthetic Client',
      teamKey: 'VID',
      teamName: 'Video',
      dueDate: '2026-07-25',
    };
    const staleIssues = [{
      ...issue,
      title: 'Stale issue title',
      dueDate: '2026-07-25',
    }];
    const appliedSnapshots = [];
    let metadataAdopts = 0;
    let planAdopts = 0;
    let renders = 0;
    let dueRequestStarted = false;
    let metadataIssueIds = [];
    const context = {
      _wlPlanSessionGeneration: 0,
      _wlPlanLoadGeneration: 0,
      _wlPlanWriteInFlight: new Map(),
      _wlDueWriteInFlight: new Map(),
      _wlBackgroundRefreshPromise: null,
      wlState: {
        allActiveSubs: [issue],
        issueSnapshot: [issue],
        fetchedAt: 1,
        planByIssueId: new Map([[issue.id, '2026-07-30']]),
        workloadByIssueId: new Map([[issue.id, { label: '3× Workload', weight: 3, color: '#FF0000' }]]),
        dueAuthorityByIssueId: new Map([[issue.id, {
          authority: 'linear',
          team: 'video',
          fingerprint: 'video:linear|graphics:linear',
        }]]),
        nativeDueTargetByIssueId: new Map(),
        planStatus: 'ready',
        linearMetadataStatus: 'ready',
        error: null,
        backgroundError: null,
      },
      _wlV2Ready: () => true,
      _syncviewStaffIdentityForHeaders: () => ({ role: 'admin' }),
      _wlV2FetchIssues: async () => staleIssues,
      wlFetchPlanRows: async () => ({
        rows: [{ issue_id: issue.id, plan_date: '2026-07-29' }],
        readGeneration: 0,
      }),
      wlFetchLinearMetadata: issues => {
        metadataIssueIds = issues.map(row => row.id);
        metadataStarted.resolve();
        return metadata.promise;
      },
      wlAdoptPlanRows: () => {
        planAdopts++;
        context.wlState.planByIssueId.set(issue.id, '2026-07-29');
      },
      wlAdoptLinearMetadata: (rows, issues) => {
        metadataAdopts++;
        issues[0].dueDate = rows[0].due_date;
        context.wlState.workloadByIssueId.set(issue.id, { label: '2× Workload', weight: 2, color: '#00FF00' });
      },
      wlApplyData: issues => {
        appliedSnapshots.push(issues);
        context.wlState.issueSnapshot = issues;
        context.wlState.allActiveSubs = issues;
      },
      wlBackgroundBusinessFingerprint: () => 'synthetic-fingerprint',
      wlPlanEditingEnabled: () => true,
      wlLinearEditingEnabled: () => true,
      wlMarkBackgroundRefreshFailure: () => {},
      wlPurgePlanSensitiveState: () => {},
      _syncviewStaffIdentityClear: () => {},
      wlIsTweaksNeeded: () => false,
      wlNativeDueDate: value => value,
      wlDueWriteRoute: () => ({
        authority: 'linear',
        team: 'video',
        authorityFingerprint: 'video:linear|graphics:linear',
      }),
      _wlDueWriteRequest: () => {
        dueRequestStarted = true;
        return dueResponse.promise;
      },
      renderWorkloadAll: () => { renders++; },
      renderWorkloadPlanStatus: () => {},
      showNotify: () => {},
      document: { querySelector: selector => selector === '.workload-view' ? {} : null },
      JSON, String, Number, Object, Date, Map, Array, Error, Promise, console,
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(extract('wlValidRfc3339Timestamp'), context);
    vm.runInContext(extract('wlApplyDueLocal'), context);
    vm.runInContext(extract('wlSetDueDate'), context);
    vm.runInContext(extract('wlRefetchSilent'), context);

    const background = context.wlRefetchSilent();
    await metadataStarted.promise;
    ok(context._wlPlanLoadGeneration === 1 && metadataIssueIds.join(',') === issue.id,
      'the older background metadata read is genuinely in flight before the due write');

    const dueWrite = context.wlSetDueDate(issue.id, '2026-08-05');
    ok(dueRequestStarted
        && context._wlPlanLoadGeneration === 2
        && issue.dueDate === '2026-08-05',
      'starting the due write invalidates the older load before its request settles');
    dueResponse.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        linear_committed: true,
        issue_id: issue.id,
        due_date: '2026-08-05',
        updated_at: '2026-07-22T12:00:00.000Z',
        mirror_updated: 1,
        mirror_pending: false,
      }),
    });
    ok(await dueWrite === true && issue.dueDate === '2026-08-05'
        && context._wlDueWriteInFlight.size === 0,
      'the newer due-date write completes successfully and clears its write token');

    metadata.resolve([{
      issue_id: issue.id,
      due_date: '2026-07-25',
      workload: { label: '2× Workload', weight: 2, color: '#00FF00' },
    }]);
    const refreshed = await background;
    ok(refreshed === false
        && issue.dueDate === '2026-08-05'
        && context.wlState.issueSnapshot[0] === issue
        && context.wlState.issueSnapshot[0].title === 'Current issue title'
        && context.wlState.planByIssueId.get(issue.id) === '2026-07-30'
        && context.wlState.workloadByIssueId.get(issue.id).weight === 3
        && planAdopts === 0
        && metadataAdopts === 0
        && appliedSnapshots.every(snapshot => snapshot[0] === issue)
        && renders === 2,
      'an older background snapshot cannot restore the old due date or publish stale issue, plan, or metadata state');
  }

  // Exercise the real sign-out -> identity-clear -> global purge chain while a
  // snapshot load is in flight. Its late result must not repopulate either
  // staff-only map or replace the warm, non-sensitive issue calendar.
  {
    const deferred = () => {
      let resolve, reject;
      const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const issues = deferred();
    const plans = deferred();
    const h = makeIdentityPurgeContext();
    let planAdopts = 0;
    let metadataAdopts = 0;
    h.context.loadLinearIssues = () => issues.promise;
    h.context.wlFetchPlanRows = () => plans.promise;
    h.context.wlFetchLinearMetadata = async () => [{ issue_id: 'stale-issue' }];
    h.context.wlAdoptPlanRows = () => {
      planAdopts++;
      h.context.wlState.planByIssueId.set('stale-issue', '2026-08-01');
    };
    h.context.wlAdoptLinearMetadata = () => {
      metadataAdopts++;
      h.context.wlState.workloadByIssueId.set('stale-issue', { weight: 2 });
    };
    h.context.wlMarkLinearMetadataFailure = () => {};
    vm.runInContext(extract('wlLoadSnapshot'), h.context);

    const pending = h.context.wlLoadSnapshot(false, null);
    h.context._syncviewStaffSignOut();
    issues.resolve({ issues: [{ id: 'stale-issue' }], fetchedAt: 2 });
    plans.resolve({ rows: [{ issue_id: 'stale-issue', plan_date: '2026-08-01' }], readGeneration: 8 });
    const result = await pending;

    ok(result === null
        && planAdopts === 0
        && metadataAdopts === 0
        && h.context.wlState.planByIssueId.size === 0
        && h.context.wlState.workloadByIssueId.size === 0
        && h.context.wlState.planHasSnapshot === false
        && h.context._wlPlanWriteInFlight.size === 0
        && h.context._wlDueWriteInFlight.size === 0
        && h.context._wlPlanSessionGeneration === 3
        && h.context._wlPlanLoadGeneration === 7
        && h.context._syncviewStaffIdentityMem === null
        && h.focusCalls() === 1,
      'real staff sign-out purges plan and metadata state and invalidates a late snapshot completion');
    ok(h.context.wlState.issueSnapshot === h.warmIssueSnapshot
        && h.context.wlState.calendarByDate.get('2026-07-30') === h.warmIssueSnapshot
        && h.applyCalls.every(call => call[0] === h.warmIssueSnapshot)
        && h.renders.length >= 1,
      'staff sign-out preserves and repaints the warm non-sensitive issue calendar');
  }

  // Cross-tab identity replacement and removal use their own storage-event
  // path; both must purge before a replacement identity is reverified.
  {
    const h = makeIdentityPurgeContext();
    const replacement = {
      key: 'synthetic-creative-key',
      role: 'creative',
      member: { id: 'synthetic-creative', name: 'Synthetic Creative' },
    };
    h.context._syncviewStaffIdentityStorageChanged({
      key: h.context.SYNCVIEW_STAFF_IDENTITY_KEY,
      storageArea: h.context.localStorage,
      newValue: JSON.stringify(replacement),
    });
    ok(h.context.wlState.planByIssueId.size === 0
        && h.context.wlState.workloadByIssueId.size === 0
        && h.context._wlPlanSessionGeneration === 3
        && h.context._wlPlanLoadGeneration === 6
        && h.context._syncviewStaffIdentityMem.member.id === replacement.member.id
        && h.bootCalls() === 1,
      'a cross-tab identity replacement purges Workload state before reverification');
    ok(h.context.wlState.issueSnapshot === h.warmIssueSnapshot
        && h.context.wlState.calendarByDate.get('2026-07-30') === h.warmIssueSnapshot,
      'identity replacement leaves the warm issue calendar mounted');
  }

  {
    const h = makeIdentityPurgeContext();
    h.context._syncviewStaffIdentityStorageChanged({
      key: h.context.SYNCVIEW_STAFF_IDENTITY_KEY,
      storageArea: h.context.localStorage,
      newValue: null,
    });
    ok(h.context.wlState.planByIssueId.size === 0
        && h.context.wlState.workloadByIssueId.size === 0
        && h.context._wlPlanSessionGeneration === 3
        && h.context._wlPlanLoadGeneration === 6
        && h.context._syncviewStaffIdentityMem === null
        && h.bootCalls() === 0,
      'a cross-tab sign-out purges Workload state without trying to verify a missing identity');
    ok(h.context.wlState.issueSnapshot === h.warmIssueSnapshot
        && h.context.wlState.calendarByDate.get('2026-07-30') === h.warmIssueSnapshot,
      'cross-tab sign-out keeps the visible calendar warm');
  }

  // A Workload authorization failure must take the same centralized clear
  // path, not merely mark one projection stale.
  {
    const h = makeIdentityPurgeContext();
    const error = new Error('expired');
    error.status = 401;
    h.context.wlMarkPlanReadFailure(error);
    ok(h.context.wlState.planByIssueId.size === 0
        && h.context.wlState.workloadByIssueId.size === 0
        && h.context._wlPlanSessionGeneration === 3
        && h.context._wlPlanLoadGeneration === 6
        && h.context._syncviewStaffIdentityMem === null
        && h.context.localStorage.getItem(h.context.SYNCVIEW_STAFF_IDENTITY_KEY) === null,
      'a Workload 401 clears identity and purges both staff-only projections');
    ok(h.context.wlState.issueSnapshot === h.warmIssueSnapshot
        && h.context.wlState.calendarByDate.get('2026-07-30') === h.warmIssueSnapshot,
      'the Workload 401 path preserves the warm issue calendar');
  }

  // Exercise the real delegated click ordering: the root handler opens an
  // issue popover, then the bubbling document handler must not close it.
  {
    const rootHandlers = {};
    const documentHandlers = {};
    let closeCount = 0;
    let pickerOpen = false;
    const setCalls = [];
    const dueCalls = [];
    const groupCalls = [];
    const pop = {
      open: false,
      classList: { contains: name => name === 'open' && pop.open },
      contains: () => false,
    };
    const trigger = {
      getAttribute: () => '',
      closest: selector => selector === '[data-wl-issue-open]' ? trigger : null,
    };
    const root = {
      dataset: {},
      contains: () => true,
      addEventListener: (name, handler) => { rootHandlers[name] = handler; },
      querySelectorAll: () => [],
    };
    const document = {
      querySelector: selector => selector === '.workload-view' ? root : null,
      querySelectorAll: () => [],
      getElementById: id => id === 'wlPopover' ? pop : (id === 'svDatePickerPopup' && pickerOpen ? {} : null),
      addEventListener: (name, handler) => { documentHandlers[name] = handler; },
    };
    const context = {
      document,
      wlState: { popoverAnchor: null },
      wlOpenRollupPopover: element => { pop.open = true; context.wlState.popoverAnchor = element; },
      wlClosePopover: () => { pop.open = false; closeCount++; },
      wlCloseDropdowns: () => {},
      wlPlanEditingEnabled: () => true,
      wlSetPlanDate: (issueId, planDate) => { setCalls.push([issueId, planDate]); },
      wlSetDueDate: (issueId, dueDate) => { dueCalls.push([issueId, dueDate]); },
      wlMovePlanGroup: (...args) => { groupCalls.push(args); },
      _wlPlanWriteInFlight: new Map(),
      setTimeout: callback => { callback(); return 1; },
      Map,
    };
    vm.createContext(context);
    vm.runInContext(extract('wlWireToolbar'), context);
    context.wlWireToolbar();
    const event = { target: trigger, preventDefault: () => {}, metaKey: false, ctrlKey: false, shiftKey: false };
    rootHandlers.click(event);
    documentHandlers.click(event);
    ok(pop.open === true && closeCount === 0,
      'an issue-card click remains open after the bubbling outside-click handler');

    const cardBody = {
      closest: () => null,
    };
    let bodyDragPrevented = false;
    rootHandlers.dragstart({
      target: cardBody,
      dataTransfer: { setData: () => { throw new Error('card body must not start a drag'); } },
      preventDefault: () => { bodyDragPrevented = true; },
    });
    ok(bodyDragPrevented === true && !root.dataset.wlDragIssue,
      'dragging an issue title or status icon is ignored; only its handle can start a move');

    const cardClasses = new Set();
    const card = {
      closest: selector => selector === '[data-wl-drag-handle="issue"][data-wl-plan-drag]' ? card : null,
      getAttribute: name => name === 'data-wl-plan-drag' ? 'synthetic-issue-1' : '',
      classList: {
        add: name => cardClasses.add(name),
        remove: name => cardClasses.delete(name),
      },
    };
    const dayClasses = new Set();
    const day = {
      closest: selector => selector === '[data-wl-day]' ? day : null,
      getAttribute: name => name === 'data-wl-day' ? '2026-07-30' : '',
      contains: () => false,
      classList: {
        add: name => dayClasses.add(name),
        remove: name => dayClasses.delete(name),
      },
    };
    const transfer = {
      value: '',
      setData: (_type, value) => { transfer.value = value; },
      getData: () => transfer.value,
    };
    rootHandlers.dragstart({ target: card, dataTransfer: transfer, preventDefault: () => {} });
    rootHandlers.dragover({ target: day, dataTransfer: transfer, preventDefault: () => {} });
    rootHandlers.drop({ target: day, dataTransfer: transfer, preventDefault: () => {} });
    ok(setCalls.some(call => call[0] === 'synthetic-issue-1' && call[1] === '2026-07-30'),
      'delegated issue-handle drag writes the stable issue id and exact target day');

    const groupBody = { closest: () => null };
    let groupBodyPrevented = false;
    rootHandlers.dragstart({
      target: groupBody,
      dataTransfer: { setData: () => { throw new Error('group body must not start a drag'); } },
      preventDefault: () => { groupBodyPrevented = true; },
    });
    ok(groupBodyPrevented === true && !root.dataset.wlDragGroupDate && groupCalls.length === 0,
      'dragging a collapsed client chip body is ignored; only its handle can start a group move');

    const groupClasses = new Set();
    const group = {
      closest: selector => selector === '[data-wl-drag-handle="group"][data-wl-plan-group-drag]' ? group : null,
      getAttribute: name => ({
        draggable: 'true',
        'data-wl-date': '2026-07-24',
        'data-wl-assignee-id': 'synthetic-editor',
        'data-wl-client': 'Synthetic Client',
      })[name] || '',
      classList: {
        add: name => groupClasses.add(name),
        remove: name => groupClasses.delete(name),
      },
    };
    rootHandlers.dragstart({ target: group, dataTransfer: transfer, preventDefault: () => {} });
    rootHandlers.dragover({ target: day, dataTransfer: transfer, preventDefault: () => {} });
    rootHandlers.drop({ target: day, dataTransfer: transfer, preventDefault: () => {} });
    ok(groupCalls.some(call => call.join('|')
        === '2026-07-24|synthetic-editor|Synthetic Client|2026-07-30'),
      'delegated group-handle drag moves the exact editor and client group');

    const dateWrap = {
      getAttribute: name => name === 'data-wl-due-issue' ? 'synthetic-issue-1' : '',
    };
    const dateInput = {
      value: '2026-07-31',
      closest: selector => selector === '[data-wl-due-issue]' ? dateWrap : null,
      matches: selector => selector === 'input[type="date"]',
    };
    rootHandlers.change({ target: dateInput });
    ok(dueCalls.some(call => call[0] === 'synthetic-issue-1' && call[1] === '2026-07-31'),
      'delegated branded-date change writes the stable issue id and selected authoritative due date');

    const clear = {
      closest: selector => selector === '[data-wl-plan-clear]' ? clear : null,
      getAttribute: name => name === 'data-wl-plan-clear' ? 'synthetic-issue-1' : '',
    };
    rootHandlers.click({ target: clear, preventDefault: () => {} });
    ok(setCalls.some(call => call[0] === 'synthetic-issue-1' && call[1] === null),
      'delegated Use automatic plan sends a nullable manual override');

    pickerOpen = true;
    pop.open = true;
    documentHandlers.click({
      target: { closest: selector => selector === '#svDatePickerPopup' ? {} : null },
    });
    documentHandlers.keydown({ key: 'Escape' });
    ok(pop.open === true && closeCount === 0,
      'the body-portaled date picker owns outside clicks and the first Escape');
  }

  if (failures) process.exit(1);
  console.log('\nWorkload plan fail-closed checks passed');
})();
