'use strict';

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
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function debt(id, slug, issue) {
  return {
    id,
    kind: 'status',
    payload: { issue, status: 'Tweaks Needed' },
    attempts: 0,
    lastError: '',
    queuedAt: 100,
    transport: 'legacy_n8n',
    client_slug: slug
  };
}

const ownerA = Object.freeze({
  kind: 'client', runId: 1, generation: 1,
  slug: 'alpha', principal: 'client:alpha'
});
const ownerB = Object.freeze({
  kind: 'client', runId: 2, generation: 2,
  slug: 'beta', principal: 'client:beta'
});

(async () => {
  for (const fixture of [
    {
      label: 'Calendar',
      functionName: '_linearOutboxFlushRun',
      readName: '_linearOutboxRead',
      scheduleName: '_linearOutboxScheduleRetry',
      maxName: 'LINEAR_OUTBOX_MAX_ATTEMPTS'
    },
    {
      label: 'Samples',
      functionName: '_sxrLinearOutboxFlushRun',
      readName: '_sxrLinearOutboxRead',
      scheduleName: '_sxrLinearOutboxScheduleRetry',
      maxName: 'SXR_LINEAR_OUTBOX_MAX'
    }
  ]) {
    let rows = [
      debt(fixture.label + '-a', 'alpha', 'https://linear.invalid/VID-101'),
      debt(fixture.label + '-b', 'beta', 'https://linear.invalid/VID-202'),
      debt(fixture.label + '-empty', '', 'https://linear.invalid/VID-303'),
      Object.assign(
        debt(fixture.label + '-foreign-gate', 'alpha', 'https://linear.invalid/VID-304'),
        {
          source_gate: {
            surface: fixture.label === 'Calendar' ? 'calendar' : 'sxr',
            client_slug: 'alpha',
            principal: 'client:beta',
            post_id: fixture.label + '-foreign-gate-post',
            component: 'video',
            linear_issue: 'https://linear.invalid/VID-304'
          }
        }
      )
    ];
    let currentOwner = ownerA;
    let routing = Promise.resolve();
    let lockEntries = 0;
    let finalizeCalls = 0;
    let postStatuses = [500, 200];
    const posts = [];
    const scheduledOwners = [];
    const originalForeign = JSON.stringify(rows[1]);
    const originalEmpty = JSON.stringify(rows[2]);
    const originalForeignGate = JSON.stringify(rows[3]);
    const context = {
      navigator: {
        locks: {
          request: async (_name, _options, callback) => {
            lockEntries++;
            return callback();
          }
        }
      },
      _writeUiLegacyResumeOwnerCurrent: owner => owner === currentOwner,
      _writeUiPrimeRerouteFlag: () => routing,
      _writeUiLegacyItemOwnedBy: null,
      _writeUiLegacyRetainFrom: null,
      _writeUiLegacyDrainWithLock: null,
      wlNormalizeClient: value => String(value || '').trim().toLowerCase(),
      [fixture.readName]: () => clone(rows),
      _writeUiRerouteUseGateway: () => false,
      _writeUiLegacyFinalizeFlush: async (_surface, snapshot, remaining) => {
        finalizeCalls++;
        const snapshotIds = new Set(snapshot.map(item => String(item.id || '')));
        const retained = new Map(remaining.map(item => [String(item.id || ''), clone(item)]));
        rows = rows.flatMap(item => {
          const id = String(item.id || '');
          if (!snapshotIds.has(id)) return [item];
          return retained.has(id) ? [retained.get(id)] : [];
        });
        return clone(rows);
      },
      [fixture.scheduleName]: owner => scheduledOwners.push(owner),
      _writeUiLegacyGateSignature: () => 'gate',
      _writeUiLegacyStoredTeamTerminalItem: () => null,
      _writeUiLegacySourceGateState: async () => 'committed',
      _writeUiLegacyRememberCommittedTweak: () => true,
      _writeUiLegacyReconcileCommittedTweak: () => true,
      _writeUiLegacyRecordedTeamDeliveryReceiptItem: () => null,
      _writeUiLegacyTeamDeliveryReceiptItem: item => item,
      _writeUiLegacyQuarantine: () => false,
      _writeUiQueueDiagnostic: () => {},
      _writeUiIntentId: (_surface, _kind, parts) => parts.join(':'),
      _writeUiGatewayPost: async () => ({ ok: true }),
      _writeUiNativeStatus: value => value,
      _isClientLink: true,
      [fixture.maxName]: 6,
      LINEAR_ADD_COMMENT_URL: 'https://writer.invalid/comment',
      LINEAR_SET_STATUS_URL: 'https://writer.invalid/status',
      fetch: async (url, options) => {
        posts.push({ url, body: JSON.parse(options.body) });
        const status = postStatuses.shift() || 200;
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => ({ ok: status >= 200 && status < 300 })
        };
      },
      Date, JSON, Object, String, Number, Array, Error, Promise, Map, Set
    };
    vm.createContext(context);
    for (const name of [
      '_writeUiLegacyItemOwnedBy',
      '_writeUiLegacyRetainFrom',
      '_writeUiLegacyDrainWithLock',
      fixture.functionName
    ]) vm.runInContext(extract(name), context);

    const first = await context[fixture.functionName](ownerA);
    assert.strictEqual(first.deferred, undefined);
    assert.strictEqual(posts.length, 1, fixture.label + ' first retry sends only client A debt');
    assert.strictEqual(posts[0].body.issue, 'https://linear.invalid/VID-101');
    assert.strictEqual(rows.length, 4,
      fixture.label + ' keeps failed client A debt plus B, empty, and inconsistent-gate rows');
    assert.strictEqual(rows[0].attempts, 1, fixture.label + ' records the retryable 500 only on client A debt');
    assert.strictEqual(JSON.stringify(rows[1]), originalForeign,
      fixture.label + ' preserves foreign client B debt byte-for-byte');
    assert.strictEqual(JSON.stringify(rows[2]), originalEmpty,
      fixture.label + ' preserves unscoped debt byte-for-byte');
    assert.strictEqual(JSON.stringify(rows[3]), originalForeignGate,
      fixture.label + ' preserves outer-A debt with a matching gate slug but foreign principal byte-for-byte');
    assert.deepStrictEqual(scheduledOwners, [ownerA],
      fixture.label + ' retry timer captures the exact verified owner');

    await context[fixture.functionName](ownerA);
    assert.strictEqual(posts.length, 2, fixture.label + ' retries client A exactly once after the 500');
    assert.deepStrictEqual(rows.map(item => item.client_slug), ['beta', '', 'alpha'],
      fixture.label + ' successful retry removes A while retaining B, unscoped, and foreign-principal debt');
    assert.strictEqual(JSON.stringify(rows[0]), originalForeign);
    assert.strictEqual(JSON.stringify(rows[1]), originalEmpty);
    assert.strictEqual(JSON.stringify(rows[2]), originalForeignGate);

    rows = [
      debt(fixture.label + '-pending-a', 'alpha', 'https://linear.invalid/VID-404'),
      debt(fixture.label + '-pending-b', 'beta', 'https://linear.invalid/VID-505')
    ];
    const pendingBytes = JSON.stringify(rows);
    const heldRouting = deferred();
    routing = heldRouting.promise;
    currentOwner = ownerA;
    const pendingDrain = context[fixture.functionName](ownerA);
    await Promise.resolve();
    currentOwner = ownerB;
    heldRouting.resolve();
    const pendingResult = await pendingDrain;
    assert.strictEqual(pendingResult.deferred, true,
      fixture.label + ' stale generation releases a held routing read without draining');
    assert.strictEqual(JSON.stringify(rows), pendingBytes,
      fixture.label + ' held stale generation leaves A and B debt byte-for-byte unchanged');
    assert.strictEqual(posts.length, 2, fixture.label + ' held stale generation starts no POST');

    const heldSource = deferred();
    rows = [Object.assign(
      debt(fixture.label + '-source-a', 'alpha', 'https://linear.invalid/VID-606'),
      {
        source_gate: {
          surface: fixture.label === 'Calendar' ? 'calendar' : 'sxr',
          client_slug: 'alpha',
          principal: 'client:alpha',
          post_id: 'post-a',
          component: 'video',
          linear_issue: 'https://linear.invalid/VID-606'
        }
      }
    )];
    const sourceBytes = JSON.stringify(rows);
    const finalizeBeforeClientStale = finalizeCalls;
    routing = Promise.resolve();
    currentOwner = ownerA;
    context._writeUiLegacySourceGateState = () => heldSource.promise;
    const sourceDrain = context[fixture.functionName](ownerA);
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    currentOwner = ownerB;
    heldSource.resolve('committed');
    await sourceDrain;
    assert.strictEqual(JSON.stringify(rows), sourceBytes,
      fixture.label + ' rechecks after the source await and leaves the untouched item in place');
    assert.strictEqual(posts.length, 2,
      fixture.label + ' stale source release cannot start a legacy or gateway POST');
    assert.strictEqual(finalizeCalls, finalizeBeforeClientStale,
      fixture.label + ' stale pre-POST generation cannot finalize queue state');

    const staffOwnerFirst = Object.freeze({
      kind: 'staff', principal: 'staff:fixture', verificationEpoch: 11
    });
    const staffOwnerSecond = Object.freeze({
      kind: 'staff', principal: 'staff:fixture', verificationEpoch: 12
    });
    const heldStaffSource = deferred();
    rows = [Object.assign(
      debt(fixture.label + '-staff-held', 'alpha', 'https://linear.invalid/VID-607'),
      {
        source_gate: {
          surface: fixture.label === 'Calendar' ? 'calendar' : 'sxr',
          client_slug: 'alpha',
          principal: 'staff:fixture',
          post_id: 'post-staff',
          component: 'video',
          linear_issue: 'https://linear.invalid/VID-607'
        }
      }
    )];
    const staffBytes = JSON.stringify(rows);
    const finalizeBeforeStaffRotation = finalizeCalls;
    currentOwner = staffOwnerFirst;
    context._writeUiLegacySourceGateState = () => heldStaffSource.promise;
    const staffDrain = context[fixture.functionName](staffOwnerFirst);
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    currentOwner = staffOwnerSecond;
    heldStaffSource.resolve('committed');
    const staffResult = await staffDrain;
    assert.strictEqual(staffResult.deferred, true,
      fixture.label + ' old same-principal staff epoch becomes stale after re-verification');
    assert.strictEqual(JSON.stringify(rows), staffBytes,
      fixture.label + ' old staff epoch leaves queue storage byte-for-byte unchanged');
    assert.strictEqual(posts.length, 2,
      fixture.label + ' old staff epoch cannot POST after the held await releases');
    assert.strictEqual(finalizeCalls, finalizeBeforeStaffRotation,
      fixture.label + ' old staff epoch cannot finalize into the new same-principal session');
    assert(lockEntries >= 3, fixture.label + ' exercises the real serialized drain callback');
  }

  {
    const staffOwner = Object.freeze({
      kind: 'staff', principal: 'staff:fixture:smm', verificationEpoch: 21
    });
    const context = {
      _isClientLink: false,
      _syncviewStaffVerificationEpoch: 21,
      _syncviewStaffIdentityForHeaders: () => ({ member: { id: 'fixture' }, role: 'smm' }),
      _writeUiPrincipalKey: () => 'staff:fixture:smm',
      Number, String
    };
    vm.createContext(context);
    vm.runInContext(extract('_writeUiLegacyResumeOwnerCurrent'), context);
    assert.strictEqual(context._writeUiLegacyResumeOwnerCurrent(staffOwner), true,
      'captured staff owner is current in its exact verified epoch');
    context._syncviewStaffVerificationEpoch = 22;
    assert.strictEqual(context._writeUiLegacyResumeOwnerCurrent(staffOwner), false,
      'same principal cannot revive an owner from an earlier verification epoch');
  }

  {
    const authority = deferred();
    let verificationEpoch = 31;
    let fetchCalls = 0;
    let transportStarts = 0;
    const staffOwner = Object.freeze({
      kind: 'staff', principal: 'staff:fixture:smm', verificationEpoch
    });
    const context = {
      _writeUiLegacyResumeOwnerCurrent: owner => (
        owner === staffOwner && owner.verificationEpoch === verificationEpoch
      ),
      _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
      _writeUiIntentId: () => 'held-staff-request',
      _writeUiSourceTime: value => value,
      _writeUiRefreshAuthority: () => authority.promise,
      _writeUiHasCredential: () => true,
      _syncviewEfHeaders: headers => headers,
      WRITE_UI_PRODUCTION_WRITE_URL: 'https://writer.invalid/production-write',
      CAL_SUPABASE_ANON_KEY: 'synthetic-anon',
      fetch: async () => {
        fetchCalls++;
        return { ok: true, status: 200, json: async () => ({ ok: true, native_committed: true }) };
      },
      Date, JSON, Object, String, Error, Promise
    };
    vm.createContext(context);
    vm.runInContext(extract('_writeUiGatewayPost'), context);
    const pending = context._writeUiGatewayPost({
      surface: 'calendar',
      operation: 'status',
      team: 'video',
      issue: 'https://linear.invalid/VID-608',
      requestId: 'held-staff-request',
      sourceEditedAt: '2026-07-20T00:00:00.000Z',
      legacyOnly: true,
      legacyResumeOwner: staffOwner,
      onLegacyResumeTransportStart: () => { transportStarts++; }
    });
    await Promise.resolve();
    verificationEpoch = 32;
    authority.resolve({ video: 'linear', graphics: 'linear' });
    let error = null;
    try { await pending; } catch (caught) { error = caught; }
    assert.strictEqual(error && error.code, 'legacy_resume_lease_revoked',
      'gateway rechecks an old same-principal staff owner after its authority await');
    assert.strictEqual(fetchCalls, 0,
      'gateway cannot POST after the old staff epoch releases from authority');
    assert.strictEqual(transportStarts, 0,
      'gateway marks no transport start when the exact staff lease is stale');
  }

  for (const fixture of [
    {
      label: 'Calendar',
      surface: 'calendar',
      functionName: '_linearOutboxFlushRun',
      readName: '_linearOutboxRead',
      scheduleName: '_linearOutboxScheduleRetry',
      maxName: 'LINEAR_OUTBOX_MAX_ATTEMPTS'
    },
    {
      label: 'Samples',
      surface: 'sxr',
      functionName: '_sxrLinearOutboxFlushRun',
      readName: '_sxrLinearOutboxRead',
      scheduleName: '_sxrLinearOutboxScheduleRetry',
      maxName: 'SXR_LINEAR_OUTBOX_MAX'
    }
  ]) {
    const owner = Object.freeze({
      kind: 'staff', principal: 'staff:finalizer', verificationEpoch: 41
    });
    let ownerCurrent = true;
    let rows = [{
      id: fixture.surface + '-held-finalizer',
      kind: 'status',
      payload: {
        issue: 'https://linear.invalid/VID-701',
        status: 'Tweaks Needed'
      },
      attempts: 0,
      queuedAt: 100,
      transport: 'source_only',
      client_slug: 'alpha',
      source_gate: {
        surface: fixture.surface,
        client_slug: 'alpha',
        principal: owner.principal,
        post_id: 'post-finalizer',
        component: 'video',
        linear_issue: 'https://linear.invalid/VID-701',
        comment_id: 'comment-finalizer'
      }
    }];
    let finalizerReads = 0;
    let finalizerWrites = 0;
    let holdFinalizer = true;
    let releaseFinalizer = null;
    let postGate = null;
    let postCalls = 0;
    const lockRequest = (name, _options, callback) => {
      if (name === 'syncview-legacy-outbox-drain') return Promise.resolve().then(callback);
      if (name === 'syncview-legacy-outbox:' + fixture.surface && holdFinalizer) {
        return new Promise((resolve, reject) => {
          releaseFinalizer = () => Promise.resolve().then(callback).then(resolve, reject);
        });
      }
      return Promise.resolve().then(callback);
    };
    const context = {
      navigator: { locks: { request: lockRequest } },
      _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
      _writeUiLegacyResumeOwnerCurrent: candidate => candidate === owner && ownerCurrent,
      _writeUiPrimeRerouteFlag: async () => {},
      [fixture.readName]: () => clone(rows),
      _writeUiLegacyItemOwnedBy: () => true,
      _writeUiLegacyRetainFrom: (items, index, remaining) => {
        for (let cursor = index; cursor < items.length; cursor++) remaining.push(items[cursor]);
      },
      _writeUiLegacyGateSignature: () => 'held-finalizer-gate',
      _writeUiLegacyStoredTeamTerminalItem: () => null,
      _writeUiLegacySourceGateState: async () => 'committed',
      _writeUiLegacyRememberCommittedTweak: () => true,
      _writeUiLegacyReconcileCommittedTweak: () => true,
      _writeUiLegacyRecordedTeamDeliveryReceiptItem: () => null,
      _writeUiLegacyTeamDeliveryReceiptItem: item => item,
      _writeUiLegacyQuarantine: () => false,
      _writeUiQueueDiagnostic: () => {},
      _writeUiIntentId: (_surface, _kind, parts) => parts.join(':'),
      _writeUiRerouteUseGateway: () => false,
      _writeUiGatewayPost: async () => ({ ok: true }),
      _writeUiNativeStatus: value => value,
      _isClientLink: false,
      _writeUiLegacyOutboxItems: () => {
        finalizerReads++;
        return clone(rows);
      },
      _writeUiLegacyOutboxWrite: (_surface, next) => {
        finalizerWrites++;
        rows = clone(next);
        return true;
      },
      _writeUiLegacyItemMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
      [fixture.scheduleName]: () => {},
      [fixture.maxName]: 6,
      LINEAR_ADD_COMMENT_URL: 'https://writer.invalid/comment',
      LINEAR_SET_STATUS_URL: 'https://writer.invalid/status',
      fetch: async () => {
        postCalls++;
        if (postGate) await postGate.promise;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
      Date, JSON, Object, String, Number, Array, Error, Promise, Map, Set
    };
    vm.createContext(context);
    for (const name of [
      '_writeUiLegacyOutboxWithLock',
      '_writeUiLegacyDrainWithLock',
      '_writeUiLegacyFinalizeFlush',
      fixture.functionName
    ]) vm.runInContext(extract(name), context);

    const beforeBytes = JSON.stringify(rows);
    const pendingFinalize = context[fixture.functionName](owner);
    for (let tick = 0; tick < 20 && !releaseFinalizer; tick++) await Promise.resolve();
    assert.strictEqual(typeof releaseFinalizer, 'function',
      fixture.label + ' no-POST drain reaches the held surface finalizer lock');
    assert.strictEqual(finalizerReads, 0,
      fixture.label + ' held finalizer has not inspected current queue state');
    ownerCurrent = false;
    await releaseFinalizer();
    const deferredFinalize = await pendingFinalize;
    assert.strictEqual(deferredFinalize.deferred, true,
      fixture.label + ' stale no-POST finalizer returns the deferred sentinel');
    assert.strictEqual(finalizerReads, 0,
      fixture.label + ' stale finalizer guard runs before queue inspection inside the lock');
    assert.strictEqual(finalizerWrites, 0,
      fixture.label + ' stale finalizer performs no queue write');
    assert.strictEqual(JSON.stringify(rows), beforeBytes,
      fixture.label + ' stale finalizer leaves queue bytes unchanged');
    assert.strictEqual(postCalls, 0,
      fixture.label + ' no-POST finalizer scenario starts no transport');

    rows = [debt(
      fixture.surface + '-started-post',
      'alpha',
      'https://linear.invalid/VID-702'
    )];
    ownerCurrent = true;
    holdFinalizer = false;
    releaseFinalizer = null;
    finalizerReads = 0;
    finalizerWrites = 0;
    postCalls = 0;
    postGate = deferred();
    const startedPostDrain = context[fixture.functionName](owner);
    for (let tick = 0; tick < 20 && postCalls === 0; tick++) await Promise.resolve();
    assert.strictEqual(postCalls, 1,
      fixture.label + ' checkpoint exception begins one valid legacy POST');
    ownerCurrent = false;
    postGate.resolve();
    const checkpointed = await startedPostDrain;
    assert.strictEqual(checkpointed.deferred, undefined,
      fixture.label + ' a genuinely started transport may finish normally');
    assert.strictEqual(finalizerWrites, 1,
      fixture.label + ' a genuinely started transport may checkpoint after revocation');
    assert.deepStrictEqual(rows, [],
      fixture.label + ' successful started transport is removed exactly once');
  }

  for (const fixture of [
    { name: '_linearOutboxFlush', promise: '_linearOutboxFlushPromise', key: '_linearOutboxFlushOwnerKey', run: '_linearOutboxFlushRun' },
    { name: '_sxrLinearOutboxFlush', promise: '_sxrLinearOutboxPromise', key: '_sxrLinearOutboxOwnerKey', run: '_sxrLinearOutboxFlushRun' }
  ]) {
    const held = [];
    const context = {
      [fixture.promise]: null,
      [fixture.key]: '',
      _writeUiLegacyResumeOwner: () => null,
      _writeUiLegacyResumeOwnerCurrent: owner => owner === ownerA || owner === ownerB,
      _writeUiLegacyResumeOwnerKey: owner => [owner.runId, owner.generation, owner.slug].join('|'),
      [fixture.run]: owner => {
        const gate = deferred();
        held.push({ owner, gate });
        return gate.promise;
      },
      Promise
    };
    vm.createContext(context);
    vm.runInContext(extract(fixture.name), context);
    const firstA = context[fixture.name](ownerA);
    const secondA = context[fixture.name](ownerA);
    const firstB = context[fixture.name](ownerB);
    assert.strictEqual(firstA, secondA, fixture.name + ' coalesces only the same exact owner');
    assert.notStrictEqual(firstA, firstB, fixture.name + ' never coalesces across client generations');
    assert.deepStrictEqual(held.map(entry => entry.owner), [ownerA, ownerB]);
    held[0].gate.resolve({ outcomes: [] });
    held[1].gate.resolve({ outcomes: [] });
    await Promise.all([firstA, firstB]);
  }

  const resumeOwner = ownerA;
  let resumeCurrent = true;
  let resolvedOwner = null;
  let routingReads = 0;
  const clientFlushes = [];
  const forbidden = [];
  const resumeContext = {
    _writeUiLegacyResumePromise: null,
    _writeUiLegacyResumeActiveOwnerKey: '',
    _writeUiLegacyResumeOwner: () => resolvedOwner,
    _writeUiLegacyResumeOwnerCurrent: owner => !!owner && owner === resumeOwner && resumeCurrent,
    _writeUiLegacyResumeOwnerKey: () => 'client|1|1|alpha',
    _writeUiLegacyItemOwnedBy: (item, owner) => item.client_slug === owner.slug,
    _writeUiPrimeRerouteFlag: async () => { routingReads++; },
    _linearOutboxRead: () => [debt('resume-a', 'alpha', 'https://linear.invalid/VID-707'), debt('resume-b', 'beta', 'https://linear.invalid/VID-808')],
    _sxrLinearOutboxRead: () => [debt('resume-sxr-a', 'alpha', 'https://linear.invalid/VID-909')],
    _linearOutboxFlush: async owner => { clientFlushes.push(['calendar', owner]); },
    _sxrLinearOutboxFlush: async owner => { clientFlushes.push(['sxr', owner]); },
    _writeUiExpireV1Caches: () => forbidden.push('cache-expiry'),
    _linearIntakeRead: () => { forbidden.push('native-intake'); return null; },
    _writeUiRefreshAuthority: async () => { forbidden.push('authority'); return null; },
    _writeUiLegacyHydrateConfirmedCacheAfterAuthority: () => forbidden.push('metadata'),
    _calPruneLinearMetaForAuthority: () => forbidden.push('metadata-prune'),
    _calHydrateLinearMeta: () => forbidden.push('metadata-hydrate'),
    _calCardJobsRead: () => { forbidden.push('card-jobs'); return []; },
    _writeUiResumeSourceRepairs: async () => forbidden.push('source-repair'),
    Promise
  };
  vm.createContext(resumeContext);
  vm.runInContext(extract('_writeUiResumeLegacyQueues'), resumeContext);

  const preverify = await resumeContext._writeUiResumeLegacyQueues('startup');
  assert.strictEqual(preverify.deferred, true, 'pre-verification client startup stays deferred');
  assert.strictEqual(routingReads, 0, 'pre-verification client startup performs no routing read');
  assert.deepStrictEqual(clientFlushes, []);
  assert.deepStrictEqual(forbidden, []);

  resolvedOwner = resumeOwner;
  const verified = await resumeContext._writeUiResumeLegacyQueues('client-verified');
  assert.strictEqual(verified.deferred, false);
  assert.deepStrictEqual(clientFlushes, [['calendar', resumeOwner], ['sxr', resumeOwner]],
    'strict client success resumes only the two scoped queue lanes');
  assert.deepStrictEqual(forbidden, [],
    'client resume never enters native intake, card, authority, metadata, or source-repair lanes');

  resumeCurrent = false;
  resolvedOwner = null;
  const stale = await resumeContext._writeUiResumeLegacyQueues('focus');
  assert.strictEqual(stale.deferred, true);
  assert.strictEqual(clientFlushes.length, 2, 'revoked client lifecycle events cannot restart delivery');

  console.log('client entry legacy resume exact-generation and client-scope lease checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
