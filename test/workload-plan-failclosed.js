'use strict';

// F141 regression guard (behavioral). Workload plan-day saves are optimistic,
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

function makeSetContext(fetchImpl, fastTimeout, staffRole = 'admin') {
  const issue = {
    id: 'synthetic-issue-1',
    clientName: 'Synthetic Client',
    dueDate: '2026-07-25',
  };
  const renderDays = [];
  const notifies = [];
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
      planByIssueId: new Map(),
      planStatus: 'ready',
      calendarByDate: new Map([['2026-07-25', [issue]]]),
    },
    _syncviewStaffIdentityForHeaders: () => staffRole ? { role: staffRole } : null,
    _syncviewStaffRoleValue: identity => String(identity && identity.role || '').trim().toLowerCase(),
    _syncviewRequireStaffIdentity: async () => ({ key: 'synthetic' }),
    _syncviewEfHeaders: headers => headers,
    fetch: fetchImpl,
    wlIsTweaksNeeded: () => false,
    wlResetPlanDisplay: () => {},
    wlApplyData: () => {
      const day = context.wlState.planByIssueId.get(issue.id) || issue.dueDate;
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
    ok(context._syncviewStaffCan('workload-plan') === false
        && context.wlPlanEditingEnabled() === false,
      'Creative identities cannot read or edit Workload plan dates');
    role = 'smm';
    ok(context._syncviewStaffCan('workload-plan') === true
        && context.wlPlanEditingEnabled() === true,
      'SMM identities can read and edit when the plan snapshot is ready');
    role = 'admin';
    ok(context._syncviewStaffCan('workload-plan') === true
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
        && h.renderDays[h.renderDays.length - 1] === '2026-07-25'
        && !h.context.wlState.planByIssueId.has(h.issue.id)
        && h.context._wlPlanWriteInFlight.size === 0,
      'real save path moves optimistically, then re-buckets to the due date on a short count');
  }

  {
    const h = makeSetContext((_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }), true);
    const saved = await h.context.wlSetPlanDate(h.issue.id, '2026-07-29');
    ok(saved === false
        && h.renderDays[0] === '2026-07-29'
        && h.renderDays[h.renderDays.length - 1] === '2026-07-25'
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
      'a matching one-row clear preserves null for due-date fallback');
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

  // A delayed list response captured before a successful write must not
  // overwrite the just-saved local date after the in-flight token clears.
  {
    const context = {
      wlState: {
        planByIssueId: new Map([['synthetic-issue-1', '2026-07-29']]),
        planHasSnapshot: false,
      },
      _wlPlanWriteInFlight: new Map(),
      _wlPlanLastWriteGeneration: new Map([['synthetic-issue-1', 4]]),
      Date, Number, String, Map,
    };
    vm.createContext(context);
    vm.runInContext(extract('wlAdoptPlanRows'), context);
    context.wlAdoptPlanRows({
      rows: [{ issue_id: 'synthetic-issue-1', plan_date: '2026-07-27' }],
      readGeneration: 3,
    });
    ok(context.wlState.planByIssueId.get('synthetic-issue-1') === '2026-07-29',
      'a stale list response cannot overwrite a write that settled after the list began');
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
    const issueQueue = [oldIssues.promise, newIssues.promise];
    const planQueue = [oldPlans.promise, newPlans.promise];
    const applied = [];
    const adopted = [];
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
      },
      loadLinearIssues: () => issueQueue.shift(),
      wlFetchPlanRows: () => planQueue.shift(),
      wlAdoptPlanRows: value => {
        adopted.push(value.marker);
        context.wlState.planHasSnapshot = true;
        context.wlState.planStatus = 'ready';
      },
      wlMarkPlanReadFailure: () => {
        failuresMarked++;
        context.wlState.planStatus = 'stale';
      },
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
    await newer;
    oldIssues.resolve({ issues: [{ id: 'older' }], fetchedAt: 1 });
    oldPlans.reject(new Error('older failed'));
    await older;
    ok(adopted.join(',') === 'newer'
        && applied.join(',') === 'newer'
        && failuresMarked === 0
        && context.wlState.planStatus === 'ready',
      'only the newest overlapping refresh may publish plan data or failure state');
  }

  // Signing out must purge the staff-only override projection and invalidate
  // any late list/write response from the old identity.
  {
    const context = {
      _wlPlanSessionGeneration: 2,
      _wlPlanLoadGeneration: 5,
      _wlPlanWriteGeneration: 8,
      _wlPlanWriteInFlight: new Map([['synthetic-issue-1', {}]]),
      _wlPlanLastWriteGeneration: new Map([['synthetic-issue-1', 8]]),
      wlState: {
        planByIssueId: new Map([['synthetic-issue-1', '2026-07-29']]),
        planHasSnapshot: true,
        planStatus: 'ready',
        planError: null,
        planFetchedAt: 1,
        issueSnapshot: [{ id: 'synthetic-issue-1' }],
        fetchedAt: 1,
      },
      wlApplyData: () => {},
      document: { querySelector: () => null },
      Map, Array,
    };
    vm.createContext(context);
    vm.runInContext(extract('wlPurgePlanSensitiveState'), context);
    context.wlPurgePlanSensitiveState();
    ok(context.wlState.planByIssueId.size === 0
        && context.wlState.planHasSnapshot === false
        && context.wlState.planStatus === 'unknown'
        && context._wlPlanWriteInFlight.size === 0
        && context._wlPlanSessionGeneration === 3
        && context._wlPlanLoadGeneration === 6,
      'staff sign-out clears saved plan dates and invalidates old in-flight responses');
  }

  // Exercise the real delegated click ordering: the root handler opens an
  // issue popover, then the bubbling document handler must not close it.
  {
    const rootHandlers = {};
    const documentHandlers = {};
    let closeCount = 0;
    let pickerOpen = false;
    const setCalls = [];
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

    const cardClasses = new Set();
    const card = {
      closest: selector => selector === '[data-wl-plan-drag]' ? card : null,
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
      'delegated drag/drop writes the stable issue id and exact target day');

    const dateWrap = {
      getAttribute: name => name === 'data-wl-plan-issue' ? 'synthetic-issue-1' : '',
    };
    const dateInput = {
      value: '2026-07-31',
      closest: selector => selector === '[data-wl-plan-issue]' ? dateWrap : null,
      matches: selector => selector === 'input[type="date"]',
    };
    rootHandlers.change({ target: dateInput });
    ok(setCalls.some(call => call[0] === 'synthetic-issue-1' && call[1] === '2026-07-31'),
      'delegated branded-date change writes the stable issue id and selected day');

    const clear = {
      closest: selector => selector === '[data-wl-plan-clear]' ? clear : null,
      getAttribute: name => name === 'data-wl-plan-clear' ? 'synthetic-issue-1' : '',
    };
    rootHandlers.click({ target: clear, preventDefault: () => {} });
    ok(setCalls.some(call => call[0] === 'synthetic-issue-1' && call[1] === null),
      'delegated clear sends a nullable plan day for due-date fallback');

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
  console.log('\nWorkload plan fail-closed (F141) checks passed');
})();
