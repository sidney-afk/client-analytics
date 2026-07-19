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
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
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

const calls = [];
let canonicalTestTarget = false;
const context = {
  _calLinearPushChain: Object.create(null),
  _sxrLinearPushChain: Object.create(null),
  _writeUiNativeId: (post, comp) => String(post && post[comp === 'graphic' ? 'graphic_deliverable_id' : 'video_deliverable_id'] || ''),
  _writeUiUseGatewayWhenReady: async () => true,
  _writeUiNativeStatus: value => String(value || '').toLowerCase().replace(/\s+/g, '_'),
  _writeUiTeam: comp => comp === 'graphic' ? 'graphics' : 'video',
  _writeUiBuildSourceRepair: () => ({ key: 'fixture-repair' }),
  _writeUiRequireRepairStorage: record => record,
  _writeUiRefreshAuthority: async () => ({ video: 'linear', graphics: 'linear' }),
  _writeUiClassifyTargetless: async (_surface, component) => {
    const authority = await context._writeUiRefreshAuthority();
    if (canonicalTestTarget || authority[context._writeUiTeam(component)] === 'syncview') {
      throw context._writeUiGatewayError(409, 'native_link_required');
    }
    return { skipped: true };
  },
  _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
  _writeUiIntentId: (surface, op, parts) => [surface, op].concat(parts || []).join(':'),
  _writeUiGatewayPost: async intent => { calls.push(intent); return { ok: true, native_committed: true }; },
  _writeUiGatewayWithRepair: async intent => { calls.push(intent); return { ok: true, native_committed: true }; },
  Date,
};
vm.createContext(context);
for (const name of ['_calPushStatusToLinear', '_calPostLinearComment', '_sxrPushStatusToLinear', '_sxrPostLinearComment']) {
  try { vm.runInContext(extract(name), context); }
  catch (error) { console.error('failed to evaluate ' + name); throw error; }
}

(async () => {
  const calPost = { id: 'card-cal', video_deliverable_id: 'native-video' };
  const sxrPost = { id: 'card-sxr', graphic_deliverable_id: 'native-graphic' };
  const statusPromise = context._calPushStatusToLinear('', 'Approved', { post: calPost, component: 'video', sourceEditedAt: '2026-07-12T00:00:00Z' });
  assert(statusPromise && typeof statusPromise.then === 'function');
  await statusPromise;
  await context._calPostLinearComment('', 'Native comment', 'Fixture', {
    post: calPost, component: 'video', comment: { id: 'comment-cal', created_at: '2026-07-12T00:00:00Z' }, audience: 'client'
  });
  await context._sxrPushStatusToLinear('', 'Tweaks Needed', { post: sxrPost, component: 'graphic', sourceEditedAt: '2026-07-12T00:00:01Z' });
  await context._sxrPostLinearComment('', 'Native sample comment', 'Fixture', {
    post: sxrPost, component: 'graphic', comment: { id: 'comment-sxr', created_at: '2026-07-12T00:00:01Z' }, audience: 'internal'
  });
  assert.strictEqual(calls.length, 4, 'all native-ID-only status/comment intents reach the gateway');
  assert(calls.every(call => call.nativeId && !call.issue), 'native ID is sufficient when the flipped-team cache removes Linear URLs');
  assert.deepStrictEqual(calls.map(call => call.operation), ['status', 'comment', 'status', 'comment']);

  context._writeUiUseGatewayWhenReady = async () => false;
  const calStatusDeferred = await context._calPushStatusToLinear('https://linear.invalid/GRA-0', 'Tweaks Needed', {
    post: { id: 'legacy-cal-status' }, component: 'graphic', deferLegacyUntilSourceSave: true
  });
  const calDeferred = await context._calPostLinearComment('https://linear.invalid/GRA-1', 'Calendar legacy', 'Fixture', {
    post: { id: 'legacy-cal' }, component: 'graphic', deferLegacyUntilSourceSave: true
  });
  const sxrDeferred = await context._sxrPostLinearComment('https://linear.invalid/GRA-2', 'Samples legacy', 'Fixture', {
    post: { id: 'legacy-sxr' }, component: 'graphic', deferLegacyUntilSourceSave: true
  });
  assert(calStatusDeferred && calStatusDeferred.deferred_until_source_save === true
    && calDeferred && calDeferred.deferred_until_source_save === true
    && sxrDeferred && sxrDeferred.deferred_until_source_save === true,
  'Calendar and Samples can defer legacy status/comment effects until the source row is durable');
  context._writeUiUseGatewayWhenReady = async () => true;

  calls.length = 0;
  await context._calPushStatusToLinear('', 'Approved', { post: { id: 'none' }, component: 'video' });
  await context._sxrPostLinearComment('', 'No target', 'Fixture', { post: { id: 'none' }, component: 'video' });
  assert.strictEqual(calls.length, 0, 'only a row with neither native nor Linear target is skipped');
  context._writeUiRefreshAuthority = async () => ({ video: 'syncview', graphics: 'syncview' });
  let targetlessBlocked = false;
  try { await context._calPushStatusToLinear('', 'Approved', { post: { id: 'none' }, component: 'video' }); }
  catch (error) { targetlessBlocked = error.code === 'native_link_required'; }
  assert(targetlessBlocked, 'a targetless status cannot bypass the gateway after a team flip');
  context._writeUiRefreshAuthority = async () => ({ video: 'linear', graphics: 'linear' });
  canonicalTestTarget = true;
  let testTargetlessBlocked = false;
  try { await context._sxrPostLinearComment('', 'No target', 'Fixture', { post: { id: 'none' }, component: 'video' }); }
  catch (error) { testTargetlessBlocked = error.code === 'native_link_required'; }
  assert(testTargetlessBlocked, 'canonical TEST cannot source-save a targetless comment while global authority remains Linear');
  canonicalTestTarget = false;

  let transportCalls = [];
  let transportStep = 0;
  const gatewayContext = {
    WRITE_UI_PRODUCTION_WRITE_URL: 'https://gateway.invalid', CAL_SUPABASE_ANON_KEY: 'anon',
    _writeUiIntentId: () => 'stable-request', _writeUiSourceTime: value => value,
    _writeUiRefreshAuthority: async () => ({ video: 'linear', graphics: 'linear' }),
    _writeUiHasCredential: () => true,
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _syncviewEfHeaders: headers => headers,
    fetch: async (_url, options) => {
      transportCalls.push(options.body);
      transportStep++;
      if (transportStep === 1) return { ok: false, status: 409, json: async () => ({ error: 'legacy_parity_not_allowed' }) };
      return { ok: true, status: 200, json: async () => ({ ok: true, native_committed: true }) };
    },
    Date, JSON,
  };
  vm.createContext(gatewayContext);
  vm.runInContext(extract('_writeUiGatewayPost'), gatewayContext);
  await gatewayContext._writeUiGatewayPost({ surface: 'calendar', operation: 'status', team: 'video', nativeId: 'native-1', status: 'approved', requestId: 'stable-request', sourceEditedAt: '2026-07-12T00:00:00Z' });
  const laneFirst = JSON.parse(transportCalls[0]), laneSecond = JSON.parse(transportCalls[1]);
  assert(laneFirst.legacy_parity === true && laneSecond.legacy_parity === undefined
    && laneFirst.request_id === laneSecond.request_id && laneFirst.source_edited_at === laneSecond.source_edited_at,
  'an explicit server TEST/lane rejection retries once without parity under the same intent');
  transportCalls = []; transportStep = 0;
  gatewayContext.fetch = async (_url, options) => {
    transportCalls.push(options.body); transportStep++;
    if (transportStep === 1) throw new Error('ambiguous network');
    return { ok: true, status: 200, json: async () => ({ ok: true, native_committed: true }) };
  };
  await gatewayContext._writeUiGatewayPost({ surface: 'calendar', operation: 'status', team: 'video', nativeId: 'native-1', status: 'approved', requestId: 'stable-request-2', sourceEditedAt: '2026-07-12T00:00:01Z' });
  assert.strictEqual(transportCalls[0], transportCalls[1], 'an ambiguous transport retry is byte-identical and cannot change authority lane');

  const calFlush = extract('_calFlushCardSave');
  const sxrFlush = extract('_sxrFlushCardSave');
  assert(calFlush.indexOf('await _calPushStatusToLinear') < calFlush.indexOf('await _calUpsertFetch'));
  assert(sxrFlush.indexOf('await _sxrPushStatusToLinear') < sxrFlush.indexOf('await _sxrUpsertFetch'));
  assert(calFlush.includes('_writeUiRetryEdits') && calFlush.includes('_writeUiRetrySourceAt'));
  assert(sxrFlush.includes('_writeUiRetryEdits') && sxrFlush.includes('_writeUiRetrySourceAt'));
  assert(calFlush.includes("_writeUiJournalCoversRepairRefs(retryPost, 'calendar', 'card'")
    && sxrFlush.includes("_writeUiJournalCoversRepairRefs(retryPost, 'sxr', 'card'")
    && calFlush.includes('_writeUiHeldSourceEdits') && sxrFlush.includes('_writeUiHeldSourceEdits'),
  'normal retries require exact journal-ref coverage and quarantine cache-only edits');
  assert(calFlush.includes('return _calAwaitCardSave(pid)') && sxrFlush.includes('return _sxrAwaitCardSave(pid)'), 'review acknowledgements wait through any trailing serialized save');
  assert(calFlush.indexOf('checkpointCommittedSource()') < calFlush.indexOf('await _calUpsertFetch'), 'Calendar checkpoints native acknowledgement before source IO');
  assert(sxrFlush.indexOf('checkpointCommittedSource()') < sxrFlush.indexOf('await _sxrUpsertFetch'), 'Samples checkpoints native acknowledgement before source IO');
  assert(calFlush.includes('_writeUiDeferLegacyStatusUntilSourceSave')
    && calFlush.includes('deferredLegacyStatusPushes')
    && calFlush.indexOf('_calLegacyPushStatusToLinear') > calFlush.indexOf('await _calUpsertFetch'),
  'Calendar request-change status notification waits until its source save succeeds');
  assert(calFlush.includes('_writeUiPinnedSourceTransport')
    && calFlush.includes('await _calUpsertFetchPinned')
    && sxrFlush.includes('_writeUiPinnedSourceTransport')
    && sxrFlush.includes('await _sxrUpsertFetchPinned')
    && extract('_calUpsertFetchPinned').includes('CALENDAR_UPSERT_EF_URL')
    && extract('_calUpsertFetchPinned').includes('CALENDAR_UPSERT_N8N_URL')
    && extract('_sxrUpsertFetchPinned').includes('SXR_UPSERT_EF_URL')
    && extract('_sxrUpsertFetchPinned').includes('SXR_UPSERT_N8N_URL'),
  'source-gated legacy actions write through the exact source transport recorded before staging');
  assert(calFlush.includes('_writeUiAdoptReplayStatus') && sxrFlush.includes('_writeUiAdoptReplayStatus'), 'source retries project the current native row, not a stale cached status');
  assert(calFlush.includes('_calCacheWrite(_saveSlug, calState.posts)') && sxrFlush.includes('_sxrCacheWrite(_saveSlug, sxrState.posts)'), 'source-repair checkpoints are crash-durable in the v2 caches');

  const calReview = extract('_calReviewRequestTweak');
  const sxrReview = extract('_sxrReviewRequestTweak');
  assert(calReview.indexOf('_calPostLinearComment') < calReview.indexOf('_calFlushCardSave'));
  assert(sxrReview.indexOf('_sxrPostLinearComment') < sxrReview.indexOf('_sxrFlushCardSave'));
  assert(calReview.includes('_writeUiLegacyTargetWithLock(')
    && sxrReview.includes('_writeUiLegacyTargetWithLock(')
    && calReview.includes('.catch(')
    && sxrReview.includes('.catch('),
  'synchronous target-lock and repair-checkpoint failures enter the review rollback chains');
  assert(extract('_calAppendComment').indexOf('await _calPostLinearComment') < extract('_calAppendComment').indexOf('arr.push(msg)'));
  assert(extract('_sxrAppendComment').indexOf('await _sxrPostLinearComment') < extract('_sxrAppendComment').indexOf('arr.push(msg)'));
  assert(extract('_kasperPersistPostWrite').indexOf('await _calPushStatusToLinear') < extract('_kasperPersistPostWrite').indexOf('await _calUpsertFetch'));
  assert(extract('_sxrKasperApplyAndPersist').indexOf('await _sxrPushStatusToLinear') < extract('_sxrKasperApplyAndPersist').indexOf('await _sxrKasperPersist'));
  for (const fixture of [
    {
      label: 'Calendar',
      surface: 'calendar',
      handler: calReview,
      freshPost: 'const post = calState.posts.find(p => p.id === pid)',
      mint: '_calMintCommentId()',
      comments: '_calCommentsFor(post, comp).slice()',
      previousFields: 'const previousFields = {',
      postComment: 'await _calPostLinearComment',
      activeBypass: "const acknowledgement = inspection.state === 'active'",
      clearApprovals: '_calClearStaleApprovals(post, repairEdits)',
      pending: '_calPendingEdits[pid]',
      sourceSave: 'await _calFlushCardSave(pid)',
      noLinear: "_calNoLinearPush.add(pid + '|' + comp)",
      state: '_calReviewState',
      render: '_calRenderBody({ preserveScroll: true })',
      sourceError: "_calReviewState.errors[key] = current._saveError || 'Save failed';",
      approvals: ['client_video_approved_at', 'client_graphic_approved_at',
        'client_caption_approved_at', 'client_title_approved_at', 'kasper_approved_at']
    },
    {
      label: 'Samples',
      surface: 'sxr',
      handler: sxrReview,
      freshPost: 'const post = sxrState.posts.find(p => p.id === pid)',
      mint: '_sxrMintCommentId()',
      comments: '_sxrCommentsFor(post, comp).slice()',
      previousFields: 'const previousFields = {',
      postComment: 'await _sxrPostLinearComment',
      activeBypass: "const acknowledgement = inspection.state === 'active'",
      clearApprovals: '_sxrClearStaleApprovals(post, repairEdits)',
      pending: '_sxrPendingEdits[pid]',
      sourceSave: 'await _sxrFlushCardSave(pid)',
      noLinear: "_sxrNoLinearPush.add(pid + '|' + comp)",
      state: '_sxrReviewState',
      render: '_sxrRenderBody({ preserveScroll: true })',
      sourceError: "_sxrReviewState.errors[key] = current._saveError || 'Save failed';",
      approvals: ['client_video_approved_at', 'client_graphic_approved_at', 'kasper_approved_at']
    }
  ]) {
    const targetAt = fixture.handler.indexOf('_writeUiLegacyTargetWithLock(');
    const freshPostAt = fixture.handler.indexOf(fixture.freshPost, targetAt);
    const mintAt = fixture.handler.indexOf(fixture.mint, freshPostAt);
    const inspectAt = fixture.handler.indexOf('await _writeUiLegacyInspectTargetTweak', mintAt);
    const inspectionCommittedAt = fixture.handler.indexOf("if (inspection.state === 'committed')", inspectAt);
    const listAt = fixture.handler.indexOf(fixture.comments, inspectAt);
    const previousFieldsAt = fixture.handler.indexOf(fixture.previousFields, listAt);
    const repairAt = fixture.handler.indexOf('const repairEdits = {', previousFieldsAt);
    const postCommentAt = fixture.handler.indexOf(fixture.postComment, repairAt);
    const stageAt = fixture.handler.indexOf('await _writeUiQueueDeferredLegacyTweak', postCommentAt);
    const stagedCommittedAt = fixture.handler.indexOf("staged.state === 'committed'", stageAt);
    const sourceAt = fixture.handler.indexOf(fixture.sourceSave, stagedCommittedAt);
    const settledAt = fixture.handler.indexOf(')).then(async outcome =>', sourceAt);
    const sourceErrorAt = fixture.handler.indexOf(fixture.sourceError, settledAt);
    assert(targetAt >= 0
      && fixture.handler.slice(targetAt, targetAt + 120).includes(`'${fixture.surface}'`)
      && freshPostAt > targetAt
      && mintAt > freshPostAt
      && inspectAt > mintAt
      && inspectionCommittedAt > inspectAt
      && inspectionCommittedAt < listAt
      && listAt < previousFieldsAt
      && previousFieldsAt < repairAt
      && repairAt < postCommentAt
      && postCommentAt < stageAt
      && stageAt < stagedCommittedAt
      && stagedCommittedAt < sourceAt
      && sourceAt < settledAt,
    fixture.label + ' holds the exact target from fresh action identity/snapshot construction through source commit');
    assert(fixture.handler.includes('const body = rawDraft.trim()')
      && fixture.handler.includes(`${fixture.state}.drafts[key] = rawDraft`)
      && fixture.handler.includes('deferLegacyUntilSourceSave: true')
      && fixture.handler.includes(fixture.activeBypass)
      && fixture.handler.includes("_writeUiLegacyPinnedSourceTransport('" + fixture.surface + "', deferredLegacyOutboxIds)")
      && fixture.handler.includes(fixture.noLinear)
      && fixture.handler.includes("_writeUiFlushDeferredLegacyTweak('" + fixture.surface + "'")
      && fixture.handler.includes("_writeUiScheduleDeferredLegacyTweak('" + fixture.surface + "')")
      && !fixture.handler.includes('_writeUiDiscardDeferredLegacyTweak')
      && fixture.approvals.every(field => fixture.handler.includes(field + ': post.' + field))
      && fixture.handler.includes('updated_at: post.updated_at')
      && fixture.handler.includes(fixture.clearApprovals)
      && fixture.handler.indexOf(fixture.pending) > repairAt
      && fixture.handler.indexOf('_writeUiBindRepairAck(post, committedBatch, acknowledgement)') > repairAt
      && fixture.handler.indexOf('_writeUiMergeCommittedBatch(pending, committedBatch)') > stageAt
      && sourceErrorAt > settledAt
      && fixture.handler.indexOf(fixture.render + ';', sourceErrorAt) > sourceErrorAt,
    fixture.label + ' stages exact source edits and restores the byte-exact draft after source failure');
  }
  const legacyStage = extract('_writeUiQueueDeferredLegacyTweak');
  const legacySignature = extract('_writeUiLegacyItemSignature');
  const legacyApprovalClears = extract('_writeUiLegacyApprovalClears');
  const legacyApprovalClearsFromEdits = extract('_writeUiLegacyApprovalClearsFromEdits');
  const legacyApprovalClearsValid = extract('_writeUiLegacyApprovalClearsValid');
  const legacyApprovalClearsForReconcile = extract('_writeUiLegacyApprovalClearsForReconcile');
  const legacyGate = extract('_writeUiLegacySourceGateState');
  const legacyReconcile = extract('_writeUiLegacyReconcileCommittedTweak');
  const legacyOutboxLock = extract('_writeUiLegacyOutboxWithLock');
  const legacyDrainLock = extract('_writeUiLegacyDrainWithLock');
  const legacyTargetLock = extract('_writeUiLegacyTargetWithLock');
  const legacyGateTargetIdentity = extract('_writeUiLegacyGateTargetIdentity');
  const legacyGateTargets = extract('_writeUiLegacyGateTargets');
  const legacyGateReflected = extract('_writeUiLegacyGateReflected');
  const legacyGateSignature = extract('_writeUiLegacyGateSignature');
  const legacyTargetPair = extract('_writeUiLegacyTargetPair');
  const legacyTargetDecision = extract('_writeUiLegacyTargetDecision');
  const legacyTargetLedgerLock = extract('_writeUiLegacyTargetLedgerWithLock');
  const legacyInspectTarget = extract('_writeUiLegacyInspectTargetTweak');
  const requestTweakMarkLocalStatus = extract('_writeUiRequestTweakMarkLocalStatus');
  const requestTweakRestoreLocalStatus = extract('_writeUiRequestTweakRestoreLocalStatus');
  const requestTweakRollback = extract('_writeUiRollbackRequestTweak');
  const legacyBuildRecords = extract('_writeUiBuildDeferredLegacyTweakRecords');
  const legacyAppend = extract('_writeUiLegacyAppendOutboxItem');
  const legacyFinalize = extract('_writeUiLegacyFinalizeFlush');
  for (const [surface, handler] of [['Calendar', calReview], ['Samples', sxrReview]]) {
    const stageAt = handler.indexOf('await _writeUiQueueDeferredLegacyTweak');
    const stageCall = handler.slice(stageAt, handler.indexOf(');', stageAt) + 2);
    assert(stageAt >= 0 && stageCall.includes('repairEdits') && stageCall.includes('inspection'),
      surface + ' stages the exact inspected action and approval clears from its committed source edits');
  }
  for (const fixture of [
    {
      label: 'Calendar',
      surface: 'calendar',
      handler: calReview,
      sourceSave: 'await _calFlushCardSave(pid)',
      teamFlush: "await _writeUiFlushDeferredLegacyTweak('calendar'",
      state: '_calReviewState',
      render: '_calRenderBody({ preserveScroll: true })',
      conflictName: 'targetConflict',
      committedIds: "await _writeUiFlushDeferredLegacyTweak('calendar', outcome.ids)"
    },
    {
      label: 'Samples',
      surface: 'sxr',
      handler: sxrReview,
      sourceSave: 'await _sxrFlushCardSave(pid)',
      teamFlush: "await _writeUiFlushDeferredLegacyTweak('sxr'",
      state: '_sxrReviewState',
      render: '_sxrRenderBody({ preserveScroll: true })',
      conflictName: 'targetConflict',
      committedIds: "await _writeUiFlushDeferredLegacyTweak('sxr', outcome.ids)"
    }
  ]) {
    const targetLockAt = fixture.handler.indexOf('_writeUiLegacyTargetWithLock(');
    const inspectionAt = fixture.handler.indexOf('await _writeUiLegacyInspectTargetTweak', targetLockAt);
    const inspectionConflictAt = fixture.handler.indexOf("inspection.state === 'conflict'", inspectionAt);
    const inspectionCommittedAt = fixture.handler.indexOf("inspection.state === 'committed'", inspectionAt);
    const stageAt = fixture.handler.indexOf('await _writeUiQueueDeferredLegacyTweak', inspectionCommittedAt);
    const stagedConflictAt = fixture.handler.indexOf("staged.state === 'conflict'", stageAt);
    const stagedCommittedAt = fixture.handler.indexOf("staged.state === 'committed'", stagedConflictAt);
    const sourceAt = fixture.handler.indexOf(fixture.sourceSave, stageAt);
    const settledAt = fixture.handler.indexOf(')).then(async outcome =>', sourceAt);
    const conflictOutcomeAt = fixture.handler.indexOf("outcome.state === 'conflict'", settledAt);
    const conflictOutcomeEnd = fixture.handler.indexOf("outcome.state ===", conflictOutcomeAt + 1);
    const conflictOutcome = fixture.handler.slice(conflictOutcomeAt, conflictOutcomeEnd);
    const rollbackAt = fixture.handler.indexOf(`_writeUiRollbackRequestTweak('${fixture.surface}'`, stageAt);
    const reconcileAt = fixture.handler.indexOf('_writeUiLegacyReconcileCommittedTweak', conflictOutcomeAt);
    const restoredDraftAt = fixture.handler.indexOf(`${fixture.state}.drafts[key] = rawDraft`, conflictOutcomeAt);
    const restoredErrorAt = fixture.handler.indexOf(
      `${fixture.state}.errors[key] = ${fixture.conflictName}.delivered`,
      restoredDraftAt
    );
    const committedOutcomeAt = fixture.handler.indexOf("outcome.state === 'committed'", settledAt);
    const committedOutcomeEnd = fixture.handler.indexOf("outcome.state ===", committedOutcomeAt + 1);
    const committedTeamAt = fixture.handler.indexOf(fixture.committedIds, committedOutcomeAt);
    const savedTeamAt = fixture.handler.indexOf('_writeUiFlushDeferredLegacyTweak', Math.max(
      conflictOutcomeEnd,
      committedOutcomeEnd
    ));
    assert(targetLockAt >= 0
      && inspectionAt > targetLockAt
      && inspectionConflictAt > inspectionAt
      && inspectionCommittedAt > inspectionConflictAt
      && inspectionCommittedAt < stageAt
      && stageAt < stagedConflictAt
      && stagedConflictAt < stagedCommittedAt
      && stagedCommittedAt < sourceAt
      && sourceAt < settledAt
      && conflictOutcomeAt > settledAt
      && committedOutcomeAt > settledAt
      && committedTeamAt > committedOutcomeAt
      && savedTeamAt > Math.max(conflictOutcomeAt, committedOutcomeAt),
    fixture.label + ' resolves ownership and staging inside the target lock, then flushes team debt only after target release');
    assert(conflictOutcome.includes(`${fixture.state}.drafts[key] = rawDraft`)
      && conflictOutcome.includes(`${fixture.state}.errors[key] = ${fixture.conflictName}.delivered`)
      && conflictOutcome.includes(`${fixture.state}.draftActionIds[key] = failedActionId`)
      && conflictOutcome.includes(`${fixture.state}.errorActionIds[key] = failedActionId`)
      && conflictOutcome.includes(fixture.render)
      && conflictOutcome.includes('return;')
      && rollbackAt >= 0
      && reconcileAt > rollbackAt
      && restoredDraftAt > reconcileAt
      && restoredErrorAt > restoredDraftAt
      && committedTeamAt < savedTeamAt,
    fixture.label + ' rolls back only the losing action, reconciles the winner, then restores exact losing draft/error ownership');
  }
  assert(legacyStage.includes('await _sxrPrimeSampleRoutingFlag()')
    && legacyStage.includes('await _calPrimeUpsertRoutingFlag()')
    && legacyStage.includes('_writeUiBuildDeferredLegacyTweakRecords')
    && legacyStage.includes('_writeUiLegacyTargetLedgerWithLock(surface')
    && legacyStage.includes('_writeUiLegacyTargetDecision')
    && legacyBuildRecords.includes("source_transport: surface === 'sxr'")
    && legacyBuildRecords.includes('return [{')
    && legacyBuildRecords.includes('committedEdits')
    && legacyBuildRecords.includes('principal: _writeUiPrincipalKey()')
    && legacyTargetLedgerLock.includes('_writeUiLegacyDrainWithLock(surface')
    && legacyTargetLedgerLock.includes('_writeUiLegacyOutboxWithLock(surface')
    && legacyTargetLedgerLock.indexOf('_writeUiLegacyDrainWithLock(surface')
      < legacyTargetLedgerLock.indexOf('_writeUiLegacyOutboxWithLock(surface'),
  'legacy request-change recovery pins the source route and stages its exact pair under global-then-surface ownership locks');
  assert(legacySignature.includes('approval_clears')
    && legacyGate.includes('approval_clears')
    && legacyReconcile.includes('_writeUiLegacyApprovalClearsForReconcile'),
  'approval clears participate in the durable signature, authoritative source gate, and local reconciliation');
  assert(legacyOutboxLock.includes('navigator.locks.request')
    && legacyFinalize.startsWith('async function ')
    && legacyFinalize.includes('_writeUiLegacyOutboxWithLock(surface')
    && extract('_linearOutboxFlushRun').includes('await _writeUiLegacyFinalizeFlush')
    && extract('_sxrLinearOutboxFlushRun').includes('await _writeUiLegacyFinalizeFlush'),
  'deferred staging and both finalizers serialize through the same required Web Lock');
  assert(legacyTargetLock.includes("'syncview-legacy-tweak-target:'")
    && legacyTargetLock.includes('[surface, slug, pid, comp]')
    && legacyTargetLock.includes('encodeURIComponent')
    && legacyTargetLock.includes("'legacy_tweak_target_lock_unavailable'"),
  'legacy request-change target locks bind the exact encoded surface/client/post/component tuple and fail closed');
  assert(legacyGate.includes("return 'principal_mismatch'")
    && legacyGate.includes("return 'conflict'")
    && legacyGate.includes("last = 'pending'")
    && legacyGate.includes("return 'superseded'")
    && legacyGate.includes("return 'committed'")
    && legacyGate.includes('WRITE_UI_LEGACY_SOURCE_GATE_PENDING_MS'),
  'legacy drains require the exact principal/comment semantics and retain propagation-lag reads');
  const calLegacyOutbox = extract('_linearOutboxFlushRun');
  const sxrLegacyOutbox = extract('_sxrLinearOutboxFlushRun');
  const calLegacyEnqueue = extract('_linearOutboxEnqueue');
  const sxrLegacyEnqueue = extract('_sxrLinearOutboxEnqueue');
  assert(calLegacyEnqueue.includes("await _writeUiLegacyAppendOutboxItem('calendar', record)")
    && sxrLegacyEnqueue.includes("await _writeUiLegacyAppendOutboxItem('sxr', record)")
    && legacyAppend.includes('_writeUiLegacyOutboxWithLock(surface')
    && legacyAppend.includes('_writeUiLegacyOutboxWrite(surface, next)')
    && legacyAppend.includes('_writeUiLegacyOutboxItems(surface)'),
  'all legacy enqueue paths append and verify their record under the surface mutation lock');
  const calDrainLockAt = calLegacyOutbox.indexOf("_writeUiLegacyDrainWithLock('calendar'");
  const sxrDrainLockAt = sxrLegacyOutbox.indexOf("_writeUiLegacyDrainWithLock('sxr'");
  assert(legacyDrainLock.includes('navigator.locks.request')
    && calDrainLockAt >= 0
    && calDrainLockAt < calLegacyOutbox.indexOf('await _writeUiPrimeRerouteFlag()')
    && sxrDrainLockAt >= 0
    && sxrDrainLockAt < sxrLegacyOutbox.indexOf('await _writeUiPrimeRerouteFlag()'),
  'both complete drains acquire the surface drain lock before source reads or team deliveries');
  assert(calLegacyOutbox.indexOf("_writeUiLegacyRememberCommittedTweak('calendar', it)")
      > calLegacyOutbox.indexOf("if (gateState !== 'committed')")
    && calLegacyOutbox.indexOf("_writeUiLegacyRememberCommittedTweak('calendar', it)")
      < calLegacyOutbox.indexOf("_writeUiLegacyReconcileCommittedTweak('calendar', it)")
    && calLegacyOutbox.indexOf("_writeUiLegacyReconcileCommittedTweak('calendar', it)")
      < calLegacyOutbox.indexOf('const resp = await fetch(endpoint')
    && sxrLegacyOutbox.indexOf("_writeUiLegacyRememberCommittedTweak('sxr', it)")
      > sxrLegacyOutbox.indexOf("if (gateState !== 'committed')")
    && sxrLegacyOutbox.indexOf("_writeUiLegacyRememberCommittedTweak('sxr', it)")
      < sxrLegacyOutbox.indexOf("_writeUiLegacyReconcileCommittedTweak('sxr', it)")
    && sxrLegacyOutbox.indexOf("_writeUiLegacyReconcileCommittedTweak('sxr', it)")
      < sxrLegacyOutbox.indexOf('const resp = await fetch(endpoint'),
  'authoritative confirmation is durably remembered and reconciled before the team drain can remove its gate');
  assert(legacyFinalize.includes('const latest of _writeUiLegacyOutboxItems(surface)')
    && legacyFinalize.includes('_writeUiLegacyItemMatches(latest, prior)'),
  'outbox finalization preserves records staged while an older flush was in flight');

  const gateContext = {
    WRITE_UI_LEGACY_SOURCE_GATE_PENDING_MS: 1000,
    _writeUiPrincipalKey: () => 'client:fixture',
    _sxrMigrateShape: () => {}, _calMigratePostShape: () => {},
    _sxrCommentsFor: (post, comp) => post[comp + '_comments'] || [],
    _calCommentsFor: (post, comp) => post[comp + '_comments'] || [],
    _sxrLinearUrlFor: (post, comp) => post[comp + '_linear_issue_id'] || '',
    _calLinearUrlFor: (post, comp) => post[comp + '_linear_issue_id'] || '',
    _sxrNormStatus: value => String(value || '').toLowerCase(),
    _calNormStatus: value => String(value || '').toLowerCase(),
    _writeUiLegacySourceRows: async () => [],
    Date, Number, Object, Array, Promise, setTimeout,
  };
  vm.createContext(gateContext);
  vm.runInContext(legacyApprovalClears + '\n' + legacyApprovalClearsValid + '\n' + legacyGate, gateContext);
  const gateItem = {
    id: 'deferred_calendar_comment-1_comment', kind: 'comment', queuedAt: Date.now(),
    payload: { issue: 'https://linear.invalid/GRA-1', body: 'Please revise', author: 'Client' },
    source_gate: {
      surface: 'calendar', client_slug: 'fixture', post_id: 'post-1', component: 'graphic',
      comment_id: 'comment-1', comment_body: 'Please revise', comment_author: 'Client',
      comment_role: 'client', comment_audience: 'client', comment_is_tweak: true,
      linear_issue: 'https://linear.invalid/GRA-1',
      intended_status: 'Tweaks Needed',
      approval_clears: [
        'client_video_approved_at',
        'client_graphic_approved_at',
        'client_title_approved_at',
        'kasper_approved_at'
      ],
      principal: 'client:fixture'
    }
  };
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'pending',
    'a fresh authoritative miss remains pending instead of deleting commit-lag recovery debt');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    client_video_approved_at: '', client_graphic_approved_at: '',
    client_title_approved_at: '2026-07-18T00:00:00Z', kasper_approved_at: '',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'pending',
    'a canonical comment waits until every approval clear committed by the action is authoritative');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    client_video_approved_at: '', client_graphic_approved_at: '',
    client_title_approved_at: '', kasper_approved_at: '',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'committed',
    'the exact canonical source comment authorizes its queued notification');
  for (const field of ['author', 'role', 'audience', 'is_tweak']) {
    const missingField = {
      id: 'post-1', graphic_status: 'Tweaks Needed',
      graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
      graphic_comments: [{
        id: 'comment-1', body: 'Please revise', author: 'Client',
        role: 'client', audience: 'client', is_tweak: true
      }]
    };
    delete missingField.graphic_comments[0][field];
    gateContext._writeUiLegacySourceRows = async () => [missingField];
    assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'conflict',
      'a persisted comment missing canonical ' + field + ' fails closed');
  }
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  const statusGateItem = Object.assign({}, gateItem, {
    id: 'deferred_calendar_comment-1_status', kind: 'status',
    payload: { issue: 'https://linear.invalid/GRA-1', status: 'Tweaks Needed' }
  });
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(statusGateItem, 1), 'committed');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Approved', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(statusGateItem, 1), 'superseded',
    'a delayed status notification cannot overwrite newer source truth');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    graphic_comments: [{ id: 'comment-1', body: 'Different text', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'conflict',
    'a matching ID with different source semantics fails closed');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-2',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise', author: 'Client', role: 'client', audience: 'client', is_tweak: true }]
  }];
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'target_changed',
    'a relinked source row cannot drain feedback to its obsolete issue');
  const wrongPrincipal = Object.assign({}, gateItem, { source_gate: Object.assign({}, gateItem.source_gate, { principal: 'client:other' }) });
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(wrongPrincipal, 1), 'principal_mismatch');
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(wrongPrincipal, 1, { sourceAcknowledged: true }), 'principal_mismatch',
    'an ephemeral source acknowledgement cannot bypass principal validation');
  const invalidApprovalClears = Object.assign({}, gateItem, {
    source_gate: Object.assign({}, gateItem.source_gate, {
      approval_clears: gateItem.source_gate.approval_clears.concat('arbitrary_post_field')
    })
  });
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(invalidApprovalClears, 1, { sourceAcknowledged: true }), 'conflict',
    'an ephemeral source acknowledgement cannot authorize an approval clear outside the surface allowlist');
  const corruptAckPayload = Object.assign({}, gateItem, {
    payload: Object.assign({}, gateItem.payload, { issue: 'https://linear.invalid/GRA-999' })
  });
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(corruptAckPayload, 1, { sourceAcknowledged: true }), 'conflict',
    'an ephemeral source acknowledgement cannot authorize a changed queued payload');
  gateContext._writeUiLegacySourceRows = async () => [];
  const expired = Object.assign({}, gateItem, { queuedAt: Date.now() - 5000 });
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(expired, 1), 'expired',
    'only an aged authoritative miss expires an uncommitted action');
  assert(extract('_linearOutboxFlushRun').includes("_writeUiLegacyQuarantine('calendar', it, 'source_gate_expired')")
    && extract('_sxrLinearOutboxFlushRun').includes("_writeUiLegacyQuarantine('sxr', it, 'source_gate_expired')"),
  'aged unresolved source gates move to auditable quarantine instead of disappearing');

  for (const fixture of [
    {
      surface: 'calendar',
      stateName: 'calState',
      reviewName: '_calReviewState',
      approvalClears: [
        'client_video_approved_at',
        'client_graphic_approved_at',
        'client_title_approved_at'
      ],
      preservedApprovals: ['client_caption_approved_at', 'kasper_approved_at']
    },
    {
      surface: 'sxr',
      stateName: 'sxrState',
      reviewName: '_sxrReviewState',
      approvalClears: [
        'client_video_approved_at',
        'client_graphic_approved_at',
        'kasper_approved_at'
      ],
      preservedApprovals: []
    }
  ]) {
    let reconcileRenders = 0;
    let reconcileCacheWrites = 0;
    const reconcileCacheSnapshots = [];
    const post = {
      id: 'post-1',
      graphic_status: 'Client Approval',
      status: 'Client Approval',
      graphic_comments: [],
      client_video_approved_at: '2026-07-18T00:00:00Z',
      client_graphic_approved_at: '2026-07-18T00:00:00Z',
      client_caption_approved_at: '2026-07-18T00:00:00Z',
      client_title_approved_at: '2026-07-18T00:00:00Z',
      kasper_approved_at: '2026-07-18T00:00:00Z',
      _saveError: 'Failed to fetch'
    };
    const review = {
      drafts: { 'post-1|graphic': '  Please revise\n' },
      errors: { 'post-1|graphic': 'Failed to fetch' },
      draftActionIds: { 'post-1|graphic': 'comment-1' },
      errorActionIds: { 'post-1|graphic': 'comment-1' },
      saving: {
        'post-1|graphic': false,
        'different-post|video': true
      }
    };
    const reconcileContext = {
      _isClientLink: true,
      calState: { posts: fixture.surface === 'calendar' ? [post] : [] },
      sxrState: { posts: fixture.surface === 'sxr' ? [post] : [] },
      _calReviewState: fixture.surface === 'calendar'
        ? review
        : { drafts: {}, errors: {}, draftActionIds: {}, errorActionIds: {}, saving: {} },
      _sxrReviewState: fixture.surface === 'sxr'
        ? review
        : { drafts: {}, errors: {}, draftActionIds: {}, errorActionIds: {}, saving: {} },
      _writeUiPrincipalKey: () => 'client:fixture',
      _calCommentsFor: row => row.graphic_comments || [],
      _calSetCommentsFor: (row, _comp, comments) => { row.graphic_comments = comments; },
      _calNextTweakRound: () => 1,
      computeOverallStatus: () => 'Tweaks Needed',
      _calRenderBody: () => { reconcileRenders++; },
      _calCacheWrite: (_slug, posts) => {
        reconcileCacheWrites++;
        reconcileCacheSnapshots.push(JSON.parse(JSON.stringify(posts)));
        return true;
      },
      _sxrCommentsFor: row => row.graphic_comments || [],
      _sxrSetCommentsFor: (row, _comp, comments) => { row.graphic_comments = comments; },
      _sxrNextTweakRound: () => 1,
      computeSampleOverallStatus: () => 'Tweaks Needed',
      _sxrRenderBody: () => { reconcileRenders++; },
      _sxrCacheWrite: (_slug, posts) => {
        reconcileCacheWrites++;
        reconcileCacheSnapshots.push(JSON.parse(JSON.stringify(posts)));
        return true;
      },
      Date, String, Number, Array, Object,
    };
    vm.createContext(reconcileContext);
    vm.runInContext([
      legacyApprovalClears,
      legacyApprovalClearsValid,
      legacyApprovalClearsForReconcile,
      legacyReconcile
    ].join('\n'), reconcileContext);
    const reconcileItem = Object.assign({}, statusGateItem, {
      queuedAt: Date.now(),
      source_gate: Object.assign({}, statusGateItem.source_gate, {
        surface: fixture.surface,
        approval_clears: fixture.approvalClears.slice()
      })
    });
    const beforeBusy = JSON.stringify({
      posts: reconcileContext[fixture.stateName].posts,
      review: reconcileContext[fixture.reviewName]
    });
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
      false,
      fixture.surface + ' reconciliation waits while any request-change save on the surface is active'
    );
    assert.strictEqual(
      JSON.stringify({
        posts: reconcileContext[fixture.stateName].posts,
        review: reconcileContext[fixture.reviewName]
      }),
      beforeBusy,
      fixture.surface + ' active-save deferral has zero in-memory mutation'
    );
    assert(reconcileRenders === 0 && reconcileCacheWrites === 0,
      fixture.surface + ' active-save deferral has zero render or cache writes');

    review.saving['different-post|video'] = false;
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
      true,
      fixture.surface + ' reconciliation resumes once every request-change save is clear'
    );
    const reconciled = reconcileContext[fixture.stateName].posts[0];
    assert(reconciled.graphic_status === 'Tweaks Needed'
      && reconciled.status === 'Tweaks Needed'
      && reconciled.graphic_comments.length === 1
      && reconciled.graphic_comments[0].id === 'comment-1'
      && fixture.approvalClears.every(field => reconciled[field] === '')
      && fixture.preservedApprovals.every(field => reconciled[field] === '2026-07-18T00:00:00Z')
      && !reconciled._saveError
      && review.drafts['post-1|graphic'] === ''
      && review.errors['post-1|graphic'] === ''
      && !review.draftActionIds['post-1|graphic']
      && !review.errorActionIds['post-1|graphic']
      && reconcileRenders === 1
      && reconcileCacheWrites === 1,
    fixture.surface + ' clear-state reconciliation applies the exact committed approval clears once');

    const distinctDraft = '  Please use a different transition\n';
    const distinctError = 'Distinct follow-up failed to save';
    reconciled._saveError = distinctError;
    review.drafts['post-1|graphic'] = distinctDraft;
    review.errors['post-1|graphic'] = distinctError;
    review.draftActionIds['post-1|graphic'] = 'comment-distinct';
    review.errorActionIds['post-1|graphic'] = 'comment-distinct';
    const rendersBeforeDistinct = reconcileRenders;
    const writesBeforeDistinct = reconcileCacheWrites;
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
      true,
      fixture.surface + ' can reconcile the older committed gate after a distinct retry rolls back'
    );
    assert(reconciled._saveError === distinctError
      && review.drafts['post-1|graphic'] === distinctDraft
      && review.errors['post-1|graphic'] === distinctError
      && review.draftActionIds['post-1|graphic'] === 'comment-distinct'
      && review.errorActionIds['post-1|graphic'] === 'comment-distinct'
      && reconcileRenders === rendersBeforeDistinct
      && reconcileCacheWrites === writesBeforeDistinct + 1,
    fixture.surface + ' older-gate reconciliation preserves the distinct failed retry surface');

    const identicalDraft = '  Please revise\n';
    const identicalError = 'Same-body follow-up failed to save';
    reconciled._saveError = identicalError;
    review.drafts['post-1|graphic'] = identicalDraft;
    review.errors['post-1|graphic'] = identicalError;
    review.draftActionIds['post-1|graphic'] = 'comment-newer';
    review.errorActionIds['post-1|graphic'] = 'comment-newer';
    const rendersBeforeIdentical = reconcileRenders;
    const writesBeforeIdentical = reconcileCacheWrites;
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
      true,
      fixture.surface + ' can reconcile an older gate beside a same-body newer failed action'
    );
    assert(reconciled._saveError === identicalError
      && review.drafts['post-1|graphic'] === identicalDraft
      && review.errors['post-1|graphic'] === identicalError
      && review.draftActionIds['post-1|graphic'] === 'comment-newer'
      && review.errorActionIds['post-1|graphic'] === 'comment-newer'
      && !reconcileCacheSnapshots[reconcileCacheSnapshots.length - 1][0]._saveError
      && reconcileRenders === rendersBeforeIdentical
      && reconcileCacheWrites === writesBeforeIdentical + 1,
    fixture.surface + ' keeps the newer same-body failure live but excludes it from the older gate cache snapshot');

    review.draftActionIds['post-1|graphic'] = 'comment-1';
    review.errorActionIds['post-1|graphic'] = 'comment-1';
    const rendersBeforeOwned = reconcileRenders;
    const writesBeforeOwned = reconcileCacheWrites;
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
      true,
      fixture.surface + ' reconciles the retry surface owned by the confirmed comment id'
    );
    assert(!reconciled._saveError
      && review.drafts['post-1|graphic'] === ''
      && review.errors['post-1|graphic'] === ''
      && !review.draftActionIds['post-1|graphic']
      && !review.errorActionIds['post-1|graphic']
      && reconcileRenders === rendersBeforeOwned + 1
      && reconcileCacheWrites === writesBeforeOwned + 1,
    fixture.surface + ' reconciliation clears draft and errors only when their action ids match');

    reconciled._saveError = distinctError;
    review.drafts['post-1|graphic'] = distinctDraft;
    review.errors['post-1|graphic'] = distinctError;
    review.draftActionIds['post-1|graphic'] = 'comment-fallback';
    review.errorActionIds['post-1|graphic'] = 'comment-fallback';
    reconciled.client_video_approved_at = 'preserve-video';
    reconciled.client_graphic_approved_at = 'clear-acted';
    reconciled.kasper_approved_at = 'clear-kasper';
    const legacyGateWithoutClears = Object.assign({}, reconcileItem.source_gate);
    delete legacyGateWithoutClears.approval_clears;
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, Object.assign(
        {},
        reconcileItem,
        { source_gate: legacyGateWithoutClears }
      )),
      true,
      fixture.surface + ' reconciles an older gate that predates explicit approval clears'
    );
    assert(reconciled.client_graphic_approved_at === ''
      && reconciled.kasper_approved_at === ''
      && reconciled.client_video_approved_at === 'preserve-video'
      && reconciled._saveError === distinctError
      && review.drafts['post-1|graphic'] === distinctDraft
      && review.errors['post-1|graphic'] === distinctError,
    fixture.surface + ' absent approval_clears falls back only to the acted component and Kasper');

    reconciled.client_graphic_approved_at = 'preserve-explicit';
    reconciled.kasper_approved_at = 'preserve-explicit';
    assert.strictEqual(
      reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, Object.assign(
        {},
        reconcileItem,
        {
          source_gate: Object.assign({}, reconcileItem.source_gate, {
            approval_clears: []
          })
        }
      )),
      true,
      fixture.surface + ' accepts an explicit empty approval-clear set'
    );
    assert(reconciled.client_graphic_approved_at === 'preserve-explicit'
      && reconciled.kasper_approved_at === 'preserve-explicit',
    fixture.surface + ' explicit empty approval_clears does not trigger the legacy fallback');

    for (const takeover of ['approve', 'plain comment']) {
      const takeoverError = takeover + ' save failed after request A';
      reconciled._saveError = takeoverError;
      review.drafts['post-1|graphic'] = '';
      review.errors['post-1|graphic'] = takeoverError;
      review.draftActionIds['post-1|graphic'] = 'comment-1';
      review.errorActionIds['post-1|graphic'] = 'comment-1';
      // The newer handler owns this surface now; its takeover must invalidate
      // request A's markers before that handler can publish its own error.
      delete review.draftActionIds['post-1|graphic'];
      delete review.errorActionIds['post-1|graphic'];
      const writesBeforeTakeover = reconcileCacheWrites;
      assert.strictEqual(
        reconcileContext._writeUiLegacyReconcileCommittedTweak(fixture.surface, reconcileItem),
        true,
        fixture.surface + ' reconciles request A after a newer ' + takeover + ' failure'
      );
      assert(reconciled._saveError === takeoverError
        && review.errors['post-1|graphic'] === takeoverError
        && !review.draftActionIds['post-1|graphic']
        && !review.errorActionIds['post-1|graphic']
        && !reconcileCacheSnapshots[reconcileCacheSnapshots.length - 1][0]._saveError
        && reconcileCacheWrites === writesBeforeTakeover + 1,
      fixture.surface + ' request A cannot clear the newer ' + takeover + ' error after ownership reset');
    }
  }

  const committedStorage = new Map();
  const retirementLocks = createWebLockHarness(true);
  let rejectCommittedWrite = false;
  const committedContext = {
    WRITE_UI_LEGACY_COMMITTED_TWEAK_KEY: 'committed-tweaks',
    _writeUiPrincipalKey: () => 'client:fixture',
    _writeUiLegacyOutboxItems: () => [],
    _sxrCommentsFor: post => post.graphic_comments || [],
    _calCommentsFor: post => post.graphic_comments || [],
    _sxrNormStatus: value => String(value || '').toLowerCase(),
    _calNormStatus: value => String(value || '').toLowerCase(),
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: retirementLocks.locks },
    localStorage: {
      getItem: key => committedStorage.has(key) ? committedStorage.get(key) : null,
      setItem: (key, value) => {
        if (rejectCommittedWrite) throw new Error('quota');
        committedStorage.set(key, String(value));
      }
    },
    Date, JSON, Object, String, Number, Array, Map, Promise, Error,
  };
  vm.createContext(committedContext);
  for (const name of [
    '_writeUiLegacyApprovalClears',
    '_writeUiLegacyDrainWithLock', '_writeUiLegacyRetireCommittedTweak',
    '_writeUiLegacyItemSignature', '_writeUiLegacyItemMatches',
    '_writeUiLegacyCommittedTweakRead', '_writeUiLegacyCommittedTweakWrite',
    '_writeUiLegacyTweakKey', '_writeUiLegacyRememberCommittedTweak',
    '_writeUiLegacyCommittedTweak', '_writeUiLegacyPendingTweak'
  ]) {
    vm.runInContext(extract(name), committedContext);
  }
  const committedItem = Object.assign({}, statusGateItem, {
    queuedAt: Date.now(),
    transport: 'legacy_n8n',
    client_slug: 'fixture'
  });
  const changedApprovalSignature = Object.assign({}, committedItem, {
    source_gate: Object.assign({}, committedItem.source_gate, {
      approval_clears: ['client_graphic_approved_at', 'kasper_approved_at']
    })
  });
  assert.notStrictEqual(
    committedContext._writeUiLegacyItemSignature(committedItem),
    committedContext._writeUiLegacyItemSignature(changedApprovalSignature),
    'changing the exact approval clears changes the durable action signature'
  );
  assert.strictEqual(committedContext._writeUiLegacyRememberCommittedTweak('calendar', committedItem), true);
  const staleCachedPost = {
    id: 'post-1', graphic_status: 'Client Approval', graphic_comments: []
  };
  const durablePending = committedContext._writeUiLegacyPendingTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleCachedPost, 'Please revise'
  );
  assert(durablePending && durablePending.delivered
    && durablePending.comment_id === 'comment-1'
    && durablePending.body === 'Please revise'
    && committedContext._writeUiLegacyCommittedTweakRead().length === 1,
  'a durable confirmation suppresses a stale retry after a cache-only reload');
  const followupGate = Object.assign({}, gateItem.source_gate, {
    comment_id: 'comment-2',
    comment_body: 'One more change'
  });
  const confirmedDebt = Object.assign({}, committedItem, {
    id: 'deferred_calendar_comment-1_comment',
    kind: 'comment',
    payload: {
      issue: 'https://linear.invalid/GRA-1',
      body: 'Please revise',
      author: 'Client'
    }
  });
  const activeFollowupItem = {
    id: 'deferred_calendar_comment-2_comment',
    kind: 'comment',
    queuedAt: Date.now(),
    transport: 'legacy_n8n',
    client_slug: 'fixture',
    payload: {
      issue: 'https://linear.invalid/GRA-1',
      body: 'One more change',
      author: 'Client'
    },
    source_gate: followupGate
  };
  committedContext._writeUiLegacyOutboxItems = () => [confirmedDebt, activeFollowupItem];
  const activeFollowup = committedContext._writeUiLegacyPendingTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleCachedPost, 'One more change'
  );
  assert(activeFollowup && !activeFollowup.delivered
    && activeFollowup.comment_id === 'comment-2'
    && activeFollowup.body === 'One more change',
  'older confirmed delivery debt cannot mask a newer same-body retry gate');
  committedContext._writeUiLegacyOutboxItems = () => [];
  const concurrentCommittedItem = Object.assign({}, committedItem, {
    id: 'deferred_calendar_comment-concurrent_status',
    source_gate: Object.assign({}, committedItem.source_gate, {
      post_id: 'post-concurrent',
      comment_id: 'comment-concurrent',
      comment_body: 'Concurrent confirmation'
    })
  });
  assert.strictEqual(
    committedContext._writeUiLegacyRememberCommittedTweak('calendar', concurrentCommittedItem),
    true,
    'a second bounded confirmation can share the durable ledger'
  );
  const ledgerBeforeRetirementRead = committedStorage.get('committed-tweaks');
  assert.strictEqual(committedContext._writeUiLegacyCommittedTweakRead().length, 2);
  const laterRoundPost = {
    id: 'post-1',
    graphic_status: 'Client Approval',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise' }]
  };
  assert.strictEqual(committedContext._writeUiLegacyCommittedTweak(
    'calendar', 'fixture', 'post-1', 'graphic', laterRoundPost
  ), null);
  assert(retirementLocks.names.length === 1
    && committedContext._writeUiLegacyCommittedTweakRead().length === 2
    && committedStorage.get('committed-tweaks') === ledgerBeforeRetirementRead,
  'a stale confirmation read returns null and queues retirement without synchronously rewriting the ledger');
  const newerSameKeyItem = Object.assign({}, committedItem, {
    id: 'deferred_calendar_comment-newer_status',
    queuedAt: Date.now() + 1,
    source_gate: Object.assign({}, committedItem.source_gate, {
      comment_id: 'comment-newer',
      comment_body: 'Newer same-key confirmation'
    })
  });
  assert.strictEqual(
    committedContext._writeUiLegacyRememberCommittedTweak('calendar', newerSameKeyItem),
    true,
    'a newer confirmation can replace the stale row while its retirement waits for the drain lock'
  );
  const ledgerAfterReplacement = committedStorage.get('committed-tweaks');
  retirementLocks.releaseFirst();
  await retirementLocks.idle();
  const ledgerAfterRetirement = committedContext._writeUiLegacyCommittedTweakRead();
  assert(ledgerAfterRetirement.length === 2
    && ledgerAfterRetirement.some(row => row && row.item
      && row.item.source_gate
      && row.item.source_gate.comment_id === 'comment-newer')
    && ledgerAfterRetirement.some(row => row && row.item
      && row.item.source_gate
      && row.item.source_gate.comment_id === 'comment-concurrent')
    && committedStorage.get('committed-tweaks') === ledgerAfterReplacement,
  'locked retirement re-reads and cannot erase a newer same-key replacement or another ledger row');
  rejectCommittedWrite = true;
  assert.strictEqual(committedContext._writeUiLegacyRememberCommittedTweak('calendar', committedItem), false,
    'confirmation storage failure keeps the active source gate fail-closed');

  for (const [surface, handler] of [['calendar', calReview], ['sxr', sxrReview]]) {
    const sourceError = handler.indexOf('if (current._saveError)');
    const resolvedRollback = handler.indexOf(`_writeUiRollbackRequestTweak('${surface}'`, sourceError);
    const sourceDraft = handler.indexOf(
      `${surface === 'sxr' ? '_sxrReviewState' : '_calReviewState'}.drafts[key] = rawDraft`,
      sourceError
    );
    const rejectedCatch = handler.lastIndexOf('.catch(');
    const rejectedRollback = handler.indexOf(`_writeUiRollbackRequestTweak('${surface}'`, rejectedCatch);
    const rejectedConfirmation = handler.indexOf('_writeUiLegacyCommittedTweak(', rejectedCatch);
    const rejectedDraft = handler.indexOf(
      `${surface === 'sxr' ? '_sxrReviewState' : '_calReviewState'}.drafts[key] = rawDraft`,
      rejectedCatch
    );
    assert(sourceError >= 0
      && resolvedRollback > sourceError
      && sourceDraft > resolvedRollback
      && rejectedCatch > sourceDraft
      && rejectedRollback > rejectedCatch
      && rejectedConfirmation > rejectedCatch
      && rejectedRollback < rejectedDraft
      && rejectedConfirmation < rejectedDraft
      && (handler.includes('!nativeCommitted')
        || handler.indexOf('_writeUiLegacyCommittedTweak(', sourceError) < resolvedRollback),
    `${surface} protects acknowledged source state and uses action-aware rollback before either failure surface is restored`);
    assert(handler.includes("inspection.state === 'active'")
      && handler.includes("inspection.state === 'committed'")
      && handler.includes('String(retryGate.comment_id || \'\')')
      && handler.indexOf(surface === 'sxr' ? '_sxrMintCommentId()' : '_calMintCommentId()')
        > handler.indexOf('_writeUiLegacyTargetWithLock('),
    `${surface} inspects ownership and mints/adopts its action identity only after acquiring the target lock`);
    const actionBinding = 'String(action && action.comment_id || attemptId)';
    const reviewState = surface === 'sxr' ? '_sxrReviewState' : '_calReviewState';
    const draftBindings = handler.split(`${reviewState}.draftActionIds[key] = ${actionBinding}`).length - 1
      + handler.split(`${reviewState}.draftActionIds[key] = failedActionId`).length - 1;
    const errorBindings = handler.split(`${reviewState}.errorActionIds[key] = ${actionBinding}`).length - 1
      + handler.split(`${reviewState}.errorActionIds[key] = failedActionId`).length - 1;
    assert(draftBindings === 3 && errorBindings === 3,
    `${surface} binds every rollback path's restored draft and error to the exact attempted comment`);
  }
  const calDraftInputAt = source.indexOf('function _calReviewOnDraftInput(');
  const sxrDraftInputAt = source.indexOf('function _sxrReviewOnDraftInput(');
  assert(source.slice(calDraftInputAt, calDraftInputAt + 1800)
      .includes('delete _calReviewState.draftActionIds[key]')
    && source.slice(sxrDraftInputAt, sxrDraftInputAt + 1800)
      .includes('delete _sxrReviewState.draftActionIds[key]'),
  'typing after rollback invalidates the saved action identity on both client review surfaces');

  function createWebLockHarness(holdFirst) {
    let tail = Promise.resolve();
    let active = 0;
    let maxActive = 0;
    let requestCount = 0;
    let releaseFirst = () => {};
    const firstBarrier = holdFirst
      ? new Promise(resolve => { releaseFirst = resolve; })
      : Promise.resolve();
    const names = [];
    return {
      names,
      releaseFirst: () => releaseFirst(),
      maxActive: () => maxActive,
      idle: () => tail,
      locks: {
        request(name, options, callback) {
          const cb = typeof options === 'function' ? options : callback;
          const ordinal = requestCount++;
          names.push(String(name));
          const run = tail.then(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            try {
              if (holdFirst && ordinal === 0) await firstBarrier;
              return await cb({ name: String(name), mode: 'exclusive' });
            } finally {
              active--;
            }
          });
          tail = run.catch(() => {});
          return run;
        }
      }
    };
  }
  function createKeyedWebLockHarness(holdFirst) {
    const tails = new Map();
    const names = [];
    let active = 0;
    let maxActive = 0;
    let requestCount = 0;
    let releaseFirst = () => {};
    const firstBarrier = holdFirst
      ? new Promise(resolve => { releaseFirst = resolve; })
      : Promise.resolve();
    return {
      names,
      maxActive: () => maxActive,
      idle: () => Promise.all(Array.from(tails.values())),
      releaseFirst,
      locks: {
        request(name, options, callback) {
          const key = String(name);
          const cb = typeof options === 'function' ? options : callback;
          const ordinal = requestCount++;
          names.push(key);
          const prior = tails.get(key) || Promise.resolve();
          const run = prior.then(async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            try {
              if (holdFirst && ordinal === 0) await firstBarrier;
              return await cb({ name: key, mode: 'exclusive' });
            } finally {
              active--;
            }
          });
          tails.set(key, run.catch(() => {}));
          return run;
        }
      }
    };
  }
  function createTracingKeyedWebLockHarness() {
    const tails = new Map();
    const events = [];
    return {
      events,
      locks: {
        request(name, options, callback) {
          const key = String(name);
          const cb = typeof options === 'function' ? options : callback;
          events.push('request:' + key);
          const prior = tails.get(key) || Promise.resolve();
          const run = prior.then(async () => {
            events.push('enter:' + key);
            try {
              return await cb({ name: key, mode: 'exclusive' });
            } finally {
              events.push('exit:' + key);
            }
          });
          tails.set(key, run.catch(() => {}));
          return run;
        }
      }
    };
  }
  const targetLocks = createKeyedWebLockHarness();
  let targetOutboxItems = [];
  let targetCommittedRows = [];
  const targetContext = {
    navigator: { locks: targetLocks.locks },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _writeUiPrincipalKey: () => 'client:fixture',
    _writeUiLegacyOutboxItems: surface => targetOutboxItems.filter(item =>
      item && item.source_gate && item.source_gate.surface === surface),
    _writeUiLegacyCommittedTweakRead: () => targetCommittedRows,
    _calLinearUrlFor: post => post.graphic_linear_issue_id || '',
    _sxrLinearUrlFor: post => post.graphic_linear_issue_id || '',
    _calCommentsFor: post => post.graphic_comments || [],
    _sxrCommentsFor: post => post.graphic_comments || [],
    _calNormStatus: value => String(value || '').toLowerCase(),
    _sxrNormStatus: value => String(value || '').toLowerCase(),
    Date, JSON, Object, String, Number, Array, Error, Promise, Map, Set, encodeURIComponent,
  };
  vm.createContext(targetContext);
  vm.runInContext([
    legacyApprovalClears,
    legacyApprovalClearsValid,
    legacyApprovalClearsForReconcile,
    legacyGateTargetIdentity,
    legacyGateTargets,
    legacyGateReflected,
    legacyGateSignature,
    legacyTargetPair,
    legacyTargetDecision,
    legacyTargetLedgerLock,
    legacyInspectTarget,
    legacyTargetLock,
    legacyOutboxLock,
    legacyDrainLock
  ].join('\n'), targetContext);

  let exactTargetCallbackHits = 0;
  await targetContext._writeUiLegacyTargetWithLock(
    'calendar',
    'Client / A',
    'post|1',
    'graphic',
    () => { exactTargetCallbackHits++; }
  );
  assert(exactTargetCallbackHits === 1
    && targetLocks.names[0] === 'syncview-legacy-tweak-target:calendar|Client%20%2F%20A|post%7C1|graphic',
  'the target lock key is the exact encoded surface/client/post/component tuple');

  let missingTargetCallbackHits = 0;
  const missingTargetContext = {
    navigator: {},
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    Promise, Error,
  };
  vm.createContext(missingTargetContext);
  vm.runInContext(legacyTargetLock, missingTargetContext);
  let missingTargetLockError = null;
  try {
    await missingTargetContext._writeUiLegacyTargetWithLock(
      'calendar', 'fixture', 'post-1', 'graphic', () => { missingTargetCallbackHits++; }
    );
  } catch (error) {
    missingTargetLockError = error;
  }
  assert(missingTargetLockError
    && missingTargetLockError.code === 'legacy_tweak_target_lock_unavailable'
    && missingTargetCallbackHits === 0,
  'missing Web Locks fail the target action closed before its commit callback');

  const targetGate = (surface, commentId, overrides) => Object.assign({
    surface,
    client_slug: 'fixture',
    source_transport: 'supabase',
    post_id: 'post-1',
    component: 'graphic',
    comment_id: commentId,
    comment_body: 'Please revise',
    comment_author: 'Client',
    comment_role: 'client',
    comment_audience: 'client',
    comment_is_tweak: true,
    intended_status: 'Tweaks Needed',
    approval_clears: [],
    linear_issue: 'https://linear.invalid/GRA-1',
    principal: 'client:fixture'
  }, overrides || {});
  const activeGate = targetGate('calendar', 'action-a');
  const targetPairForGate = gate => [{
    id: 'deferred_' + gate.surface + '_' + gate.comment_id + '_comment',
    kind: 'comment',
    payload: {
      issue: gate.linear_issue,
      body: gate.comment_body,
      author: gate.comment_author
    },
    queuedAt: Date.now(),
    transport: 'legacy_n8n',
    client_slug: gate.client_slug,
    source_gate: JSON.parse(JSON.stringify(gate))
  }, {
    id: 'deferred_' + gate.surface + '_' + gate.comment_id + '_status',
    kind: 'status',
    payload: { issue: gate.linear_issue, status: gate.intended_status },
    queuedAt: Date.now(),
    transport: 'legacy_n8n',
    client_slug: gate.client_slug,
    source_gate: JSON.parse(JSON.stringify(gate))
  }];
  const staleTargetPost = {
    id: 'post-1',
    graphic_status: 'Client Approval',
    status: 'Client Approval',
    graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    graphic_comments: []
  };
  targetOutboxItems = targetPairForGate(activeGate);
  targetCommittedRows = [];
  const activeRetry = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Please revise', 'action-a'
  );
  assert(activeRetry.state === 'active'
    && activeRetry.comment_id === 'action-a'
    && activeRetry.ids.length === 2,
  'the same action id reuses its exact complete active pair');
  const adoptedActive = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Please revise', 'action-b'
  );
  assert(adoptedActive.state === 'active' && adoptedActive.comment_id === 'action-a',
    'same-body contention adopts the exact existing action rather than minting a second pair');
  const activeConflict = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Second tab draft', 'action-b'
  );
  assert(activeConflict.state === 'conflict'
    && !activeConflict.delivered
    && activeConflict.comment_id === 'action-a',
  'different feedback sees the active same-target gate and cannot stage');
  const differentPostDecision = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-2', 'graphic',
    Object.assign({}, staleTargetPost, { id: 'post-2' }),
    'Second tab draft',
    'action-b'
  );
  assert.strictEqual(differentPostDecision.state, 'new',
    'a different post target remains independently writable');
  const differentSurfaceDecision = await targetContext._writeUiLegacyInspectTargetTweak(
    'sxr', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Second tab draft', 'action-b'
  );
  assert.strictEqual(differentSurfaceDecision.state, 'new',
    'a different surface remains independently writable');

  targetOutboxItems = [];
  targetCommittedRows = [{
    key: 'calendar|fixture|post-1|graphic',
    item: targetPairForGate(activeGate)[0]
  }];
  const committedRetry = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Please revise', 'action-a'
  );
  assert(committedRetry.state === 'committed'
    && committedRetry.comment_id === 'action-a'
    && committedRetry.ids.length === 0,
  'the exact same-id committed tombstone finishes without staging');
  const committedConflict = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Second tab draft', 'action-b'
  );
  assert(committedConflict.state === 'conflict'
    && committedConflict.delivered
    && committedConflict.comment_id === 'action-a',
    'an unreflected same-target tombstone blocks a distinct action');
  targetCommittedRows = [{
    key: 'calendar|fixture|post-1|graphic',
    item: targetPairForGate(targetGate('calendar', 'action-b', {
      comment_body: 'Second tab draft',
      principal: 'client:foreign'
    }))[0]
  }];
  const foreignCommittedConflict = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', staleTargetPost, 'Second tab draft', 'action-b'
  );
  assert(foreignCommittedConflict.state === 'conflict'
    && foreignCommittedConflict.delivered === false
    && foreignCommittedConflict.comment_id === 'action-b',
  'a foreign-principal tombstone owns the target even when it uses the attempted action id');
  targetCommittedRows = [{
    key: 'calendar|fixture|post-1|graphic',
    item: targetPairForGate(activeGate)[0]
  }];
  const reflectedTargetPost = {
    id: 'post-1',
    graphic_status: 'Tweaks Needed',
    status: 'Tweaks Needed',
    graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
    graphic_comments: [{
      id: 'action-a',
      body: 'Please revise',
      author: 'Client',
      role: 'client',
      audience: 'client',
      is_tweak: true
    }]
  };
  const reflectedDecision = await targetContext._writeUiLegacyInspectTargetTweak(
    'calendar', 'fixture', 'post-1', 'graphic', reflectedTargetPost, 'Second tab draft', 'action-b'
  );
  assert.strictEqual(reflectedDecision.state, 'new',
    'once the committed tombstone is exactly reflected, deliberate later feedback is allowed');

  const rollbackLocalStatus = {
    'post-1|graphic': 11,
    'post-1|': 12
  };
  let rollbackStatusStamp = 100;
  const rollbackContext = {
    _calLocalStatusAt: rollbackLocalStatus,
    _sxrLocalStatusAt: {},
    _calMarkLocalStatus: (pid, comp) => {
      rollbackLocalStatus[pid + '|' + comp] = ++rollbackStatusStamp;
      rollbackLocalStatus[pid + '|'] = ++rollbackStatusStamp;
    },
    _sxrMarkLocalStatus: () => {},
    _calCommentsFor: post => post.graphic_comments || [],
    _sxrCommentsFor: post => post.graphic_comments || [],
    _calSetCommentsFor: (post, _comp, comments) => { post.graphic_comments = comments; },
    _sxrSetCommentsFor: (post, _comp, comments) => { post.graphic_comments = comments; },
    JSON, Object, String, Map, Array
  };
  vm.createContext(rollbackContext);
  vm.runInContext([
    requestTweakMarkLocalStatus,
    requestTweakRestoreLocalStatus,
    requestTweakRollback
  ].join('\n'), rollbackContext);
  const rollbackMarker = rollbackContext._writeUiRequestTweakMarkLocalStatus(
    'calendar', 'post-1', 'graphic'
  );
  const optimisticComponentStamp = rollbackLocalStatus['post-1|graphic'];
  rollbackLocalStatus['post-1|'] = 999;
  const winningComment = {
    id: 'action-a',
    body: 'First tab request',
    author: 'Client',
    role: 'client',
    audience: 'client',
    is_tweak: true
  };
  const losingComment = {
    id: 'action-b',
    body: 'Second tab draft',
    author: 'Client',
    role: 'client',
    audience: 'client',
    is_tweak: true
  };
  const rollbackPost = {
    id: 'post-1',
    graphic_comments: [winningComment, losingComment],
    graphic_status: 'Tweaks Needed',
    status: 'Tweaks Needed',
    client_graphic_approved_at: '',
    kasper_approved_at: '',
    updated_at: '2026-07-18T20:00:00.000Z'
  };
  const changedBeyondLosingAction = rollbackContext._writeUiRollbackRequestTweak(
    'calendar',
    rollbackPost,
    'graphic',
    {
      comment_id: 'action-b',
      insertedComment: true,
      previousComments: [],
      previousFields: {
        graphic_status: 'Client Approval',
        status: 'Client Approval',
        client_graphic_approved_at: 'old-graphic-approval',
        kasper_approved_at: 'old-kasper-approval',
        updated_at: '2026-07-18T19:59:00.000Z'
      },
      optimisticFields: {
        graphic_status: 'Tweaks Needed',
        status: 'Tweaks Needed',
        client_graphic_approved_at: '',
        kasper_approved_at: '',
        updated_at: '2026-07-18T20:00:01.000Z'
      },
      localStatusMarker: rollbackMarker
    }
  );
  assert(changedBeyondLosingAction === true
    && rollbackPost.graphic_comments.length === 1
    && JSON.stringify(rollbackPost.graphic_comments[0]) === JSON.stringify(winningComment)
    && rollbackPost.graphic_status === 'Tweaks Needed'
    && rollbackPost.client_graphic_approved_at === ''
    && rollbackPost.updated_at === '2026-07-18T20:00:00.000Z'
    && rollbackLocalStatus['post-1|graphic'] === 11
    && rollbackLocalStatus['post-1|'] === 999
    && optimisticComponentStamp !== rollbackLocalStatus['post-1|graphic'],
  'action-aware rollback removes only the losing comment, preserves the reflected winner row, and restores only markers still owned by the loser');

  targetOutboxItems = [];
  targetCommittedRows = [];
  const sourceCommitStarted = {};
  sourceCommitStarted.promise = new Promise(resolve => { sourceCommitStarted.resolve = resolve; });
  const releaseSourceCommit = {};
  releaseSourceCommit.promise = new Promise(resolve => { releaseSourceCommit.resolve = resolve; });
  const actionWrites = {
    a: { stage: 0, source: 0, team: 0, entered: 0 },
    b: { stage: 0, source: 0, team: 0, entered: 0 }
  };
  const firstActionComment = {
    id: 'action-a',
    body: 'First tab request',
    author: 'Client',
    role: 'client',
    audience: 'client',
    is_tweak: true
  };
  const secondActionComment = {
    id: 'action-b',
    body: 'Second tab draft',
    author: 'Client',
    role: 'client',
    audience: 'client',
    is_tweak: true
  };
  const firstActionUpdatedAt = '2026-07-18T20:00:00.000Z';
  const retrySurface = {
    post: {
      id: 'post-1',
      graphic_status: 'Tweaks Needed',
      status: 'Tweaks Needed',
      graphic_comments: [firstActionComment, secondActionComment],
      updated_at: '2026-07-18T20:00:01.000Z'
    },
    prev: {
      id: 'post-1',
      graphic_status: 'Tweaks Needed',
      status: 'Tweaks Needed',
      graphic_comments: [firstActionComment],
      updated_at: firstActionUpdatedAt
    },
    rawDraft: '  Second tab draft\n',
    draft: '',
    error: '',
    draftActionId: '',
    errorActionId: '',
    renders: 0,
    localStatusFresh: true
  };
  let firstPairSnapshot = '';
  const runTargetAction = (id, gate, holdSource) => targetContext._writeUiLegacyTargetWithLock(
    gate.surface,
    gate.client_slug,
    gate.post_id,
    gate.component,
    async () => {
      actionWrites[id].entered++;
      const inspection = await targetContext._writeUiLegacyInspectTargetTweak(
        gate.surface,
        gate.client_slug,
        gate.post_id,
        gate.component,
        staleTargetPost,
        gate.comment_body,
        gate.comment_id
      );
      if (inspection.state === 'conflict' || inspection.state === 'committed') return inspection;
      actionWrites[id].stage++;
      targetOutboxItems.push(...targetPairForGate(gate));
      if (id === 'a') firstPairSnapshot = JSON.stringify(targetOutboxItems);
      if (holdSource) {
        sourceCommitStarted.resolve();
        await releaseSourceCommit.promise;
      }
      actionWrites[id].source++;
      return null;
    }
  ).then(conflict => {
    if (conflict) {
      Object.assign(retrySurface.post, retrySurface.prev);
      retrySurface.draft = retrySurface.rawDraft;
      retrySurface.error = conflict.delivered
        ? 'A change request from another tab was saved first. Your draft is preserved; review the latest status and retry.'
        : 'Another change request for this item is still being confirmed. Your draft is preserved; retry after it finishes.';
      retrySurface.draftActionId = gate.comment_id;
      retrySurface.errorActionId = gate.comment_id;
      retrySurface.localStatusFresh = false;
      retrySurface.renders++;
      return conflict;
    }
    actionWrites[id].team++;
    return null;
  });
  const firstTargetAction = runTargetAction('a', targetGate('calendar', 'action-a', {
    comment_body: 'First tab request'
  }), true);
  await sourceCommitStarted.promise;
  const secondTargetAction = runTargetAction('b', targetGate('calendar', 'action-b', {
    comment_body: 'Second tab draft'
  }), false);
  await Promise.resolve();
  assert(actionWrites.b.entered === 0,
    'the second same-target action cannot enter while the first source commit is in flight');
  releaseSourceCommit.resolve();
  const [, secondTargetConflict] = await Promise.all([firstTargetAction, secondTargetAction]);
  assert(secondTargetConflict
    && actionWrites.a.stage === 1
    && actionWrites.a.source === 1
    && actionWrites.a.team === 1
    && actionWrites.b.entered === 1
    && actionWrites.b.stage === 0
    && actionWrites.b.source === 0
    && actionWrites.b.team === 0
    && JSON.stringify(targetOutboxItems) === firstPairSnapshot
    && retrySurface.post.graphic_status === 'Tweaks Needed'
    && retrySurface.post.graphic_comments.length === 1
    && JSON.stringify(retrySurface.post.graphic_comments[0]) === JSON.stringify(firstActionComment)
    && retrySurface.post.updated_at === firstActionUpdatedAt
    && retrySurface.draft === retrySurface.rawDraft
    && retrySurface.error.includes('still being confirmed')
    && retrySurface.draftActionId === 'action-b'
    && retrySurface.errorActionId === 'action-b'
    && retrySurface.localStatusFresh === false
    && retrySurface.renders === 1,
  'serialized contention preserves the first pair and row while the second action gets zero writes and an exact actionable rollback');

  targetOutboxItems = [];
  targetCommittedRows = [{
    key: 'calendar|fixture|post-1|graphic',
    item: targetPairForGate(targetGate('calendar', 'action-a', {
      comment_body: 'First tab request'
    }))[0]
  }];
  Object.assign(retrySurface.post, {
    id: 'post-1',
    graphic_status: 'Tweaks Needed',
    status: 'Tweaks Needed',
    graphic_comments: [firstActionComment, secondActionComment],
    updated_at: '2026-07-18T20:00:02.000Z'
  });
  retrySurface.draft = '';
  retrySurface.error = '';
  retrySurface.draftActionId = '';
  retrySurface.errorActionId = '';
  retrySurface.renders = 0;
  retrySurface.localStatusFresh = true;
  actionWrites.b = { stage: 0, source: 0, team: 0, entered: 0 };
  const tombstoneTargetConflict = await runTargetAction(
    'b',
    targetGate('calendar', 'action-b', { comment_body: 'Second tab draft' }),
    false
  );
  assert(tombstoneTargetConflict
    && tombstoneTargetConflict.delivered
    && actionWrites.b.entered === 1
    && actionWrites.b.stage === 0
    && actionWrites.b.source === 0
    && actionWrites.b.team === 0
    && retrySurface.post.graphic_status === 'Tweaks Needed'
    && retrySurface.post.graphic_comments.length === 1
    && retrySurface.post.graphic_comments[0].id === 'action-a'
    && retrySurface.post.updated_at === firstActionUpdatedAt
    && retrySurface.draft === retrySurface.rawDraft
    && retrySurface.error.includes('saved first')
    && retrySurface.draftActionId === 'action-b'
    && retrySurface.errorActionId === 'action-b'
    && retrySurface.localStatusFresh === false
    && retrySurface.renders === 1,
  'an unreflected committed tombstone preserves the first row and gives the second action zero writes plus exact rollback ownership');

  const transactionLocks = createTracingKeyedWebLockHarness();
  const transactionContext = {
    navigator: { locks: transactionLocks.locks },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    Promise, Error, String, encodeURIComponent
  };
  vm.createContext(transactionContext);
  vm.runInContext([
    legacyTargetLock,
    legacyDrainLock,
    legacyOutboxLock
  ].join('\n'), transactionContext);
  const transactionEvents = transactionLocks.events;
  let sourceStartedResolve;
  const sourceStartedPromise = new Promise(resolve => { sourceStartedResolve = resolve; });
  let releaseSourceResolve;
  const releaseSourcePromise = new Promise(resolve => { releaseSourceResolve = resolve; });
  const targetTransaction = transactionContext._writeUiLegacyTargetWithLock(
    'calendar', 'fixture', 'post-order', 'graphic',
    async () => {
      await transactionContext._writeUiLegacyDrainWithLock('calendar', () =>
        transactionContext._writeUiLegacyOutboxWithLock('calendar', () => {
          transactionEvents.push('stage');
        })
      );
      transactionEvents.push('source');
      sourceStartedResolve();
      await releaseSourcePromise;
    }
  ).then(() => { transactionEvents.push('team'); });
  await sourceStartedPromise;
  const concurrentDrain = transactionContext._writeUiLegacyDrainWithLock(
    'sxr',
    () => transactionContext._writeUiLegacyOutboxWithLock('sxr', () => {
      transactionEvents.push('concurrent-drain');
    })
  );
  await Promise.race([
    concurrentDrain,
    new Promise((_resolve, reject) => setTimeout(
      () => reject(new Error('concurrent drain deadlocked behind target source commit')),
      250
    ))
  ]);
  const targetKey = 'syncview-legacy-tweak-target:calendar|fixture|post-order|graphic';
  const globalKey = 'syncview-legacy-outbox-drain';
  const calendarSurfaceKey = 'syncview-legacy-outbox:calendar';
  const sxrSurfaceKey = 'syncview-legacy-outbox:sxr';
  const firstGlobalEnter = transactionEvents.indexOf('enter:' + globalKey);
  const firstGlobalExit = transactionEvents.indexOf('exit:' + globalKey);
  const secondGlobalEnter = transactionEvents.indexOf('enter:' + globalKey, firstGlobalEnter + 1);
  assert(transactionEvents.indexOf('enter:' + targetKey) >= 0
    && transactionEvents.indexOf('enter:' + targetKey) < firstGlobalEnter
    && firstGlobalEnter < transactionEvents.indexOf('enter:' + calendarSurfaceKey)
    && transactionEvents.indexOf('enter:' + calendarSurfaceKey) < transactionEvents.indexOf('stage')
    && transactionEvents.indexOf('stage') < transactionEvents.indexOf('exit:' + calendarSurfaceKey)
    && transactionEvents.indexOf('exit:' + calendarSurfaceKey) < firstGlobalExit
    && firstGlobalExit < transactionEvents.indexOf('source')
    && transactionEvents.indexOf('source') < secondGlobalEnter
    && secondGlobalEnter < transactionEvents.indexOf('enter:' + sxrSurfaceKey)
    && transactionEvents.indexOf('concurrent-drain') > transactionEvents.indexOf('enter:' + sxrSurfaceKey)
    && transactionEvents.indexOf('exit:' + sxrSurfaceKey) < transactionEvents.indexOf('exit:' + globalKey, firstGlobalExit + 1)
    && transactionEvents.indexOf('exit:' + targetKey) < 0,
  'the target transaction acquires target, then short global, then surface locks and releases the shared locks before source IO');
  releaseSourceResolve();
  await targetTransaction;
  assert(transactionEvents.indexOf('exit:' + targetKey) > transactionEvents.indexOf('source')
    && transactionEvents.indexOf('team') > transactionEvents.indexOf('exit:' + targetKey),
  'a concurrent drain completes during source IO, and team delivery begins only after the target lock is released');

  const legacyVmBundle = [
    legacyApprovalClears,
    legacyApprovalClearsFromEdits,
    legacyApprovalClearsValid,
    legacyApprovalClearsForReconcile,
    legacySignature,
    extract('_writeUiLegacyItemMatches'),
    legacyGateTargetIdentity,
    legacyGateReflected,
    legacyGateSignature,
    legacyTargetPair,
    legacyTargetDecision,
    legacyDrainLock,
    legacyOutboxLock,
    legacyTargetLedgerLock,
    legacyInspectTarget,
    legacyBuildRecords,
    legacyStage,
    legacyFinalize
  ].join('\n');
  const committedApprovalEdits = {
    graphic_status: 'Tweaks Needed',
    status: 'Tweaks Needed',
    client_video_approved_at: '',
    client_graphic_approved_at: '',
    client_title_approved_at: '',
    kasper_approved_at: '',
    unrelated_field: ''
  };
  const expectedCalendarApprovalClears = [
    'client_video_approved_at',
    'client_graphic_approved_at',
    'client_title_approved_at',
    'kasper_approved_at'
  ];

  let stagedItems = [], stageWrites = 0, stageCommittedRows = [];
  const stageLocks = createKeyedWebLockHarness(false);
  const stageContext = {
    _sxrLinearUrlFor: () => '', _calLinearUrlFor: () => 'https://linear.invalid/GRA-1',
    _sxrPrimeSampleRoutingFlag: async () => {}, _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false, _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client', _calCurrentAuthor: () => 'Client',
    _calCommentsFor: post => post.graphic_comments || [], _sxrCommentsFor: post => post.graphic_comments || [],
    _calNormStatus: value => String(value || '').toLowerCase(), _sxrNormStatus: value => String(value || '').toLowerCase(),
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(stagedItems)),
    _writeUiLegacyCommittedTweakRead: () => JSON.parse(JSON.stringify(stageCommittedRows)),
    _writeUiLegacyOutboxWrite: (_surface, items) => { stageWrites++; stagedItems = JSON.parse(JSON.stringify(items)); return true; },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: stageLocks.locks },
    Date, JSON, Object, String, Array, Error, Promise,
  };
  vm.createContext(stageContext);
  vm.runInContext(legacyVmBundle, stageContext);
  const stagedOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client',
    committedApprovalEdits
  );
  const stagedIds = stagedOutcome.ids || [];
  assert(stagedOutcome.state === 'staged'
    && stagedIds.length === 2
    && stagedItems.length === 2
    && stageWrites === 1
    && stagedItems.every(item =>
      JSON.stringify(item.source_gate.approval_clears) === JSON.stringify(expectedCalendarApprovalClears)),
  'comment and status are staged together with the exact allowlisted committed approval clears');
  const exactStagedPair = JSON.parse(JSON.stringify(stagedItems));
  stagedItems = [];
  stageWrites = 0;
  stageContext._calLinearUrlFor = () => '';
  const targetlessOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-targetless', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-targetless', role: 'client', audience: 'client', is_tweak: true },
    'Source-only request',
    'Client',
    committedApprovalEdits,
    { state: 'new' }
  );
  const targetlessActiveOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-targetless', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-targetless', role: 'client', audience: 'client', is_tweak: true },
    'Source-only request',
    'Client',
    committedApprovalEdits,
    { state: 'active' }
  );
  assert(targetlessOutcome.state === 'skipped'
    && targetlessOutcome.reason === 'no_team_target'
    && targetlessOutcome.ids.length === 0
    && targetlessActiveOutcome.state === 'conflict'
    && stageWrites === 0
    && stagedItems.length === 0,
  'a new targetless request remains source-only while an impossible targetless active retry fails closed');
  stageContext._calLinearUrlFor = () => 'https://linear.invalid/GRA-1';
  stagedItems = JSON.parse(JSON.stringify(exactStagedPair));
  stageWrites = 1;
  const reusedStagedOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client',
    committedApprovalEdits
  );
  assert(stageWrites === 1
    && reusedStagedOutcome.state === 'active'
    && JSON.stringify(reusedStagedOutcome.ids) === JSON.stringify(stagedIds)
    && JSON.stringify(stagedItems) === JSON.stringify(exactStagedPair),
  'a same-action retry reuses the exact complete verified pair and both ids without rewriting it');
  stageCommittedRows = [{
    version: 1,
    key: 'calendar|fixture|post-1|graphic',
    confirmed_at: new Date().toISOString(),
    item: JSON.parse(JSON.stringify(exactStagedPair[0]))
  }];
  const committedWithDebtOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client',
    committedApprovalEdits
  );
  assert(committedWithDebtOutcome.state === 'committed'
    && JSON.stringify(committedWithDebtOutcome.ids) === JSON.stringify(stagedIds)
    && stageWrites === 1
    && JSON.stringify(stagedItems) === JSON.stringify(exactStagedPair),
  'a same-id tombstone with remaining exact debt returns only the existing pair for drain');
  stageCommittedRows = [];

  async function expectSameIdPairRejected(seed, label) {
    stagedItems = JSON.parse(JSON.stringify(seed));
    stageWrites = 0;
    const before = JSON.stringify(stagedItems);
    let outcome = null;
    let rejection = null;
    try {
      outcome = await stageContext._writeUiQueueDeferredLegacyTweak(
        'calendar',
        { id: 'post-1', graphic_status: 'Tweaks Needed' },
        'graphic',
        { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
        'Please revise',
        'Client',
        committedApprovalEdits
      );
    } catch (error) {
      rejection = error;
    }
    assert(!rejection
      && outcome
      && outcome.state === 'conflict'
      && stageWrites === 0
      && JSON.stringify(stagedItems) === before,
    label + ' fails closed without synthesizing, replacing, or rewriting any record');
  }
  await expectSameIdPairRejected(
    [exactStagedPair.find(item => item.kind === 'comment')],
    'a partial same-id pair'
  );
  await expectSameIdPairRejected(
    exactStagedPair.concat([JSON.parse(JSON.stringify(exactStagedPair[0]))]),
    'a duplicate same-id pair'
  );
  const mismatchedSameIdPair = JSON.parse(JSON.stringify(exactStagedPair));
  mismatchedSameIdPair.forEach(item => {
    item.source_gate.comment_body = 'Different request body';
    if (item.kind === 'comment') item.payload.body = 'Different request body';
  });
  await expectSameIdPairRejected(mismatchedSameIdPair, 'a signature-mismatched same-id pair');
  const foreignPrincipalPair = JSON.parse(JSON.stringify(exactStagedPair));
  foreignPrincipalPair.forEach(item => { item.source_gate.principal = 'client:foreign'; });
  await expectSameIdPairRejected(foreignPrincipalPair, 'a foreign-principal same-id pair');

  stagedItems = [];
  stageWrites = 0;
  stageCommittedRows = [{
    version: 1,
    key: 'calendar|fixture|post-1|graphic',
    confirmed_at: new Date().toISOString(),
    item: JSON.parse(JSON.stringify(exactStagedPair[0]))
  }];
  const committedStageOutcome = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client',
    committedApprovalEdits
  );
  assert(committedStageOutcome.state === 'committed'
    && committedStageOutcome.comment_id === 'comment-1'
    && stageWrites === 0
    && stagedItems.length === 0,
    'an exact same-id committed tombstone completes without recreating or rewriting a team pair');
  stageCommittedRows = [];

  const drainHandoffLocks = createTracingKeyedWebLockHarness();
  let drainHandoffItems = JSON.parse(JSON.stringify(exactStagedPair));
  let drainHandoffCommitted = [];
  let drainHandoffWrites = 0;
  let deliveredPayloads = 0;
  const drainHandoffContext = {
    _sxrLinearUrlFor: () => '',
    _calLinearUrlFor: () => 'https://linear.invalid/GRA-1',
    _sxrPrimeSampleRoutingFlag: async () => {},
    _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false,
    _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture',
    _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client',
    _calCurrentAuthor: () => 'Client',
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(drainHandoffItems)),
    _writeUiLegacyCommittedTweakRead: () => JSON.parse(JSON.stringify(drainHandoffCommitted)),
    _writeUiLegacyOutboxWrite: (_surface, items) => {
      drainHandoffWrites++;
      drainHandoffItems = JSON.parse(JSON.stringify(items));
      return true;
    },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: drainHandoffLocks.locks },
    Date, JSON, Object, String, Array, Error, Promise, Map, Set, encodeURIComponent
  };
  vm.createContext(drainHandoffContext);
  vm.runInContext([legacyVmBundle, legacyTargetLock].join('\n'), drainHandoffContext);
  let drainHandoffReadyResolve;
  const drainHandoffReady = new Promise(resolve => { drainHandoffReadyResolve = resolve; });
  let releaseDrainHandoffResolve;
  const releaseDrainHandoff = new Promise(resolve => { releaseDrainHandoffResolve = resolve; });
  const completingDrain = drainHandoffContext._writeUiLegacyDrainWithLock(
    'calendar',
    async () => {
      await drainHandoffContext._writeUiLegacyOutboxWithLock('calendar', () => {
        drainHandoffCommitted = [{
          version: 1,
          key: 'calendar|fixture|post-1|graphic',
          confirmed_at: new Date().toISOString(),
          item: JSON.parse(JSON.stringify(exactStagedPair[0]))
        }];
        deliveredPayloads += drainHandoffItems.length;
        drainHandoffItems = [];
        drainHandoffWrites = 0;
      });
      drainHandoffReadyResolve();
      await releaseDrainHandoff;
    }
  );
  await drainHandoffReady;
  const handoffRetry = drainHandoffContext._writeUiLegacyTargetWithLock(
    'calendar', 'fixture', 'post-1', 'graphic',
    () => drainHandoffContext._writeUiQueueDeferredLegacyTweak(
      'calendar',
      { id: 'post-1', graphic_status: 'Tweaks Needed' },
      'graphic',
      { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
      'Please revise',
      'Client',
      committedApprovalEdits
    )
  );
  for (let tick = 0; tick < 20
    && drainHandoffLocks.events.filter(event =>
      event === 'request:syncview-legacy-outbox-drain').length < 2;
    tick++) await Promise.resolve();
  assert(drainHandoffLocks.events.filter(event =>
    event === 'enter:syncview-legacy-outbox-drain').length === 1,
  'the retry waits behind the drain handoff before making its authoritative stage decision');
  releaseDrainHandoffResolve();
  const [, handoffOutcome] = await Promise.all([completingDrain, handoffRetry]);
  assert(handoffOutcome.state === 'committed'
    && handoffOutcome.comment_id === 'comment-1'
    && drainHandoffWrites === 0
    && drainHandoffItems.length === 0
    && deliveredPayloads === 2,
  'a drain-created same-id tombstone wins the handoff without a recreated pair or duplicate team payload');

  const concurrentStageLocks = createKeyedWebLockHarness(true);
  let concurrentStageWrites = 0;
  let concurrentStageItems = [];
  const concurrentStageContext = {
    _sxrLinearUrlFor: () => '', _calLinearUrlFor: post => post.linear_issue,
    _sxrPrimeSampleRoutingFlag: async () => {}, _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false, _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client', _calCurrentAuthor: () => 'Client',
    _calCommentsFor: post => post.graphic_comments || [], _sxrCommentsFor: post => post.graphic_comments || [],
    _calNormStatus: value => String(value || '').toLowerCase(), _sxrNormStatus: value => String(value || '').toLowerCase(),
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(concurrentStageItems)),
    _writeUiLegacyCommittedTweakRead: () => [],
    _writeUiLegacyOutboxWrite: (_surface, items) => {
      concurrentStageWrites++;
      concurrentStageItems = JSON.parse(JSON.stringify(items));
      return true;
    },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: concurrentStageLocks.locks },
    Date, JSON, Object, String, Array, Error, Promise, Map,
  };
  vm.createContext(concurrentStageContext);
  vm.runInContext(legacyVmBundle, concurrentStageContext);
  const concurrentA = concurrentStageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-a', graphic_status: 'Tweaks Needed', linear_issue: 'https://linear.invalid/GRA-1' },
    'graphic',
    { id: 'comment-a', role: 'client', audience: 'client', is_tweak: true },
    'First tab request',
    'Client',
    committedApprovalEdits
  );
  const concurrentB = concurrentStageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-b', graphic_status: 'Tweaks Needed', linear_issue: 'https://linear.invalid/GRA-2' },
    'graphic',
    { id: 'comment-b', role: 'client', audience: 'client', is_tweak: true },
    'Second tab request',
    'Client',
    committedApprovalEdits
  );
  for (let tick = 0; tick < 10 && concurrentStageLocks.names.length < 2; tick++) await Promise.resolve();
  assert.strictEqual(concurrentStageLocks.names.length, 2,
    'two tabs stage their source-gated pairs through the same surface lock');
  concurrentStageLocks.releaseFirst();
  await Promise.all([concurrentA, concurrentB]);
  assert(concurrentStageLocks.names.filter(name => name === 'syncview-legacy-outbox-drain').length === 2
    && concurrentStageLocks.names.filter(name => name === 'syncview-legacy-outbox:calendar').length === 2
    && concurrentStageWrites === 2
    && concurrentStageItems.length === 4
    && concurrentStageItems.filter(item => item.id.indexOf('deferred_calendar_comment-a_') === 0).length === 2
    && concurrentStageItems.filter(item => item.id.indexOf('deferred_calendar_comment-b_') === 0).length === 2,
  'serialized two-tab staging preserves both complete comment/status pairs');

  let noLockItems = [], noLockWrites = 0;
  const noLockContext = {
    _sxrLinearUrlFor: () => '', _calLinearUrlFor: () => 'https://linear.invalid/GRA-1',
    _sxrPrimeSampleRoutingFlag: async () => {}, _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false, _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client', _calCurrentAuthor: () => 'Client',
    _calCommentsFor: post => post.graphic_comments || [], _sxrCommentsFor: post => post.graphic_comments || [],
    _calNormStatus: value => String(value || '').toLowerCase(), _sxrNormStatus: value => String(value || '').toLowerCase(),
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(noLockItems)),
    _writeUiLegacyCommittedTweakRead: () => [],
    _writeUiLegacyOutboxWrite: (_surface, items) => { noLockWrites++; noLockItems = JSON.parse(JSON.stringify(items)); return true; },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: {},
    Date, JSON, Object, String, Array, Error, Promise, Map,
  };
  vm.createContext(noLockContext);
  vm.runInContext(legacyVmBundle, noLockContext);
  let missingStageLockError = null;
  try {
    await noLockContext._writeUiQueueDeferredLegacyTweak(
      'calendar',
      { id: 'post-lockless', graphic_status: 'Tweaks Needed' },
      'graphic',
      { id: 'comment-lockless', role: 'client', audience: 'client', is_tweak: true },
      'Do not stage without a lock',
      'Client',
      committedApprovalEdits
    );
  } catch (error) {
    missingStageLockError = error;
  }
  assert(missingStageLockError
    && missingStageLockError.code === 'legacy_outbox_lock_unavailable'
    && noLockItems.length === 0
    && noLockWrites === 0,
  'missing Web Locks fail staging closed before any outbox write');
  noLockItems = [{ id: 'old', kind: 'status', payload: { status: 'A' } }];
  noLockWrites = 0;
  let missingFinalizeLockError = null;
  try {
    await noLockContext._writeUiLegacyFinalizeFlush(
      'calendar',
      [{ id: 'old', kind: 'status', payload: { status: 'A' } }],
      []
    );
  } catch (error) {
    missingFinalizeLockError = error;
  }
  assert(missingFinalizeLockError
    && missingFinalizeLockError.code === 'legacy_outbox_lock_unavailable'
    && noLockItems.length === 1
    && noLockItems[0].id === 'old'
    && noLockWrites === 0,
  'missing Web Locks fail finalization closed before any outbox write');

  const overlapLocks = createKeyedWebLockHarness(true);
  let overlapWrites = 0;
  let overlapItems = [{ id: 'old', kind: 'status', payload: { status: 'A' } }];
  const overlapContext = {
    _sxrLinearUrlFor: () => '', _calLinearUrlFor: () => 'https://linear.invalid/GRA-1',
    _sxrPrimeSampleRoutingFlag: async () => {}, _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false, _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client', _calCurrentAuthor: () => 'Client',
    _calCommentsFor: post => post.graphic_comments || [], _sxrCommentsFor: post => post.graphic_comments || [],
    _calNormStatus: value => String(value || '').toLowerCase(), _sxrNormStatus: value => String(value || '').toLowerCase(),
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(overlapItems)),
    _writeUiLegacyCommittedTweakRead: () => [],
    _writeUiLegacyOutboxWrite: (_surface, items) => { overlapWrites++; overlapItems = JSON.parse(JSON.stringify(items)); return true; },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: overlapLocks.locks },
    Date, JSON, Object, String, Array, Error, Promise, Map,
  };
  vm.createContext(overlapContext);
  vm.runInContext(legacyVmBundle, overlapContext);
  const finalizePromise = overlapContext._writeUiLegacyFinalizeFlush(
    'calendar',
    [{ id: 'old', kind: 'status', payload: { status: 'A' } }],
    []
  );
  const overlapStagePromise = overlapContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-new', role: 'client', audience: 'client', is_tweak: true },
    'Staged while finalizing',
    'Client',
    committedApprovalEdits
  );
  for (let tick = 0; tick < 10 && overlapLocks.names.length < 2; tick++) await Promise.resolve();
  assert.strictEqual(overlapLocks.names.length, 2,
    'the overlapping finalizer and stager both wait on the outbox lock');
  overlapLocks.releaseFirst();
  await Promise.all([finalizePromise, overlapStagePromise]);
  assert(new Set(overlapLocks.names).size === 2
    && overlapLocks.names.includes('syncview-legacy-outbox-drain')
    && overlapLocks.names.includes('syncview-legacy-outbox:calendar')
    && overlapWrites === 2
    && overlapItems.length === 2
    && overlapItems.every(item => item.id.indexOf('deferred_calendar_comment-new_') === 0),
  'the shared exclusive lock preserves a pair staged during an overlapping old-snapshot finalization');

  let missingDrainCallbackEntries = 0;
  let missingDrainDeliveries = 0;
  const missingDrainContext = {
    navigator: {},
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _writeUiPrimeRerouteFlag: async () => { missingDrainCallbackEntries++; },
    fetch: async () => {
      missingDrainDeliveries++;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    Promise, Object, Error,
  };
  vm.createContext(missingDrainContext);
  vm.runInContext([
    legacyDrainLock,
    calLegacyOutbox,
    sxrLegacyOutbox
  ].join('\n'), missingDrainContext);
  const missingDrainErrors = [];
  for (const name of ['_linearOutboxFlushRun', '_sxrLinearOutboxFlushRun']) {
    try {
      await missingDrainContext[name]();
    } catch (error) {
      missingDrainErrors.push(error);
    }
  }
  assert(missingDrainErrors.length === 2
    && missingDrainErrors.every(error => error.code === 'legacy_outbox_lock_unavailable')
    && missingDrainCallbackEntries === 0
    && missingDrainDeliveries === 0,
  'without Web Locks neither full drain enters its callback nor attempts a team delivery');

  for (const fixture of [
    {
      surface: 'calendar',
      functionName: '_linearOutboxFlushRun',
      functionSource: calLegacyOutbox
    },
    {
      surface: 'sxr',
      functionName: '_sxrLinearOutboxFlushRun',
      functionSource: sxrLegacyOutbox
    }
  ]) {
    const drainLocks = createWebLockHarness(true);
    let drainEntries = 0;
    let drainDeliveries = 0;
    let sharedDebt = [{
      id: fixture.surface + '-shared-debt',
      kind: 'comment',
      payload: {
        issue: 'https://linear.invalid/GRA-1',
        body: 'Deliver exactly once',
        author: 'Client'
      },
      attempts: 0,
      queuedAt: Date.now(),
      transport: 'legacy_n8n',
      client_slug: 'fixture'
    }];
    const drainContext = {
      navigator: { locks: drainLocks.locks },
      _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
      _writeUiPrimeRerouteFlag: async () => { drainEntries++; },
      _linearOutboxRead: () => JSON.parse(JSON.stringify(sharedDebt)),
      _sxrLinearOutboxRead: () => JSON.parse(JSON.stringify(sharedDebt)),
      _writeUiRerouteUseGateway: () => false,
      _writeUiLegacyFinalizeFlush: async (_surface, _snapshot, remaining) => {
        sharedDebt = JSON.parse(JSON.stringify(remaining));
        return JSON.parse(JSON.stringify(sharedDebt));
      },
      _linearOutboxScheduleRetry: () => {},
      _sxrLinearOutboxScheduleRetry: () => {},
      fetch: async () => {
        drainDeliveries++;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
      LINEAR_OUTBOX_MAX_ATTEMPTS: 6,
      SXR_LINEAR_OUTBOX_MAX: 6,
      LINEAR_ADD_COMMENT_URL: 'https://writer.invalid/comment',
      LINEAR_SET_STATUS_URL: 'https://writer.invalid/status',
      Date, JSON, Object, String, Number, Array, Error, Promise, Map, Set,
    };
    vm.createContext(drainContext);
    vm.runInContext(legacyDrainLock + '\n' + fixture.functionSource, drainContext);
    const firstDrain = drainContext[fixture.functionName]();
    const secondDrain = drainContext[fixture.functionName]();
    for (let tick = 0; tick < 10 && drainLocks.names.length < 2; tick++) await Promise.resolve();
    assert.strictEqual(drainLocks.names.length, 2,
      fixture.surface + ' simultaneous full drains both contend on the drain lock');
    drainLocks.releaseFirst();
    await Promise.all([firstDrain, secondDrain]);
    assert(new Set(drainLocks.names).size === 1
      && drainLocks.maxActive() === 1
      && drainEntries === 2
      && drainDeliveries === 1
      && sharedDebt.length === 0,
    fixture.surface + ' serialized drains deliver one shared debt exactly once');
  }

  const calApprove = extract('_calReviewApplyApprove');
  const sxrApprove = extract('_sxrReviewApplyApprove');
  assert(calApprove.indexOf('_calFlushCardSave') < calApprove.indexOf('_calReviewRemoveCard'), 'Calendar review card is removed only after acknowledgement');
  assert(sxrApprove.indexOf('_sxrFlushCardSave') < sxrApprove.indexOf('_sxrReviewRemoveCard'), 'Samples review card is removed only after acknowledgement');
  const calCommentAt = source.indexOf('function _calReviewComment(');
  const calRequestAt = source.indexOf('function _calReviewRequestTweak(', calCommentAt);
  const sxrCommentAt = source.indexOf('function _sxrReviewComment(');
  const sxrRequestAt = source.indexOf('function _sxrReviewRequestTweak(', sxrCommentAt);
  const calPlainComment = source.slice(calCommentAt, calRequestAt);
  const sxrPlainComment = source.slice(sxrCommentAt, sxrRequestAt);
  for (const fixture of [
    {
      surface: 'Calendar',
      state: '_calReviewState',
      approve: calApprove,
      comment: calPlainComment,
      approveSave: '_calFlushCardSave(pid)',
      commentSave: '_calFlushCardSave(pid)'
    },
    {
      surface: 'Samples',
      state: '_sxrReviewState',
      approve: sxrApprove,
      comment: sxrPlainComment,
      approveSave: '_sxrFlushCardSave(pid)',
      commentSave: '_sxrFlushCardSave(pid)'
    }
  ]) {
    for (const [action, handler, saveMarker] of [
      ['approve', fixture.approve, fixture.approveSave],
      ['plain comment', fixture.comment, fixture.commentSave]
    ]) {
      const draftReset = handler.indexOf('delete ' + fixture.state + '.draftActionIds[key]');
      const errorReset = handler.indexOf('delete ' + fixture.state + '.errorActionIds[key]');
      const saveAt = handler.indexOf(saveMarker);
      assert(errorReset >= 0
        && saveAt >= 0
        && errorReset < saveAt
        && (action === 'approve' || (draftReset >= 0 && draftReset < saveAt)),
      fixture.surface + ' ' + action + ' invalidates the request ownership it supersedes before saving');
    }
  }
  const resumeRepairs = extract('_writeUiResumeSourceRepairs');
  assert(resumeRepairs.includes('_writeUiRetryPrincipal !== principal'), 'automatic source repair is bound to the initiating principal');
  assert(extract('_kasperPersistPostWrite').includes('_kasperPersistCache()'), 'Calendar Kasper repair is checkpointed in the existing Kasper cache');
  assert(extract('_sxrKasperApplyAndPersist').includes('_writeUiKasperRepair'), 'Samples Kasper repair is checkpointed for reload recovery');
  const calRepairCarry = source.slice(source.indexOf('// Source-repair metadata is local crash state'), source.indexOf('winner = _calAdoptThumbnailFolderMeta'));
  const sxrRepairCarry = source.slice(source.indexOf('const carrySourceRepair ='), source.indexOf('for (const srv of server)', source.indexOf('const carrySourceRepair =')));
  assert(calRepairCarry.includes('_writeUiHeldSourceEdits') && calRepairCarry.includes('_writeUiRepairRefs')
    && sxrRepairCarry.includes('_writeUiHeldSourceEdits') && sxrRepairCarry.includes('_writeUiRepairRefs'),
  'background Calendar/Samples merges preserve held edits and exact receipt refs');
  const sxrKasper = extract('_sxrKasperApplyAndPersist');
  assert(sxrKasper.indexOf('await _sxrPostLinearComment') < sxrKasper.indexOf('await _sxrPushStatusToLinear')
    && sxrKasper.includes('reserveStatusIntent') && sxrKasper.includes('repairRecord: companion'),
  'Samples Kasper composite tweaks reserve comment-first exact status companions');
  const calKasperTweak = extract('_kasperRequestTweakComp');
  const calKasperPersist = extract('_kasperPersistPostWrite');
  assert(calKasperTweak.includes('reserveStatusIntent')
    && calKasperTweak.includes('_writeUiRepairCompanions')
    && calKasperTweak.includes('companions')
    && calKasperPersist.includes('repairRecord: companion')
    && calKasperPersist.includes('_writeUiReconcileReplayStatus'),
  'Calendar Kasper composite tweaks carry the comment-first exact status companion into persistence');

  const builderContext = {
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'staff:a:smm',
    _writeUiSourceTime: value => value, _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _sxrCommentsFor: () => [], _calCommentsFor: post => post.video_comments || [],
    _sxrStringifyComments: JSON.stringify, _calStringifyComments: JSON.stringify,
    _writeUiRepairToken: () => 'builder-token', _isClientLink: false,
    computeSampleOverallStatus: () => 'Tweaks Needed', computeOverallStatus: () => 'Tweaks Needed',
    Date, JSON, Object,
  };
  vm.createContext(builderContext);
  vm.runInContext(extract('_writeUiBuildSourceRepair'), builderContext);
  const builtRepair = builderContext._writeUiBuildSourceRepair('calendar', 'comment', {
    post: { id: 'card-1', video_status: 'Tweaks Needed', status: 'Tweaks Needed', video_comments: [] },
    component: 'video', sourceEditedAt: '2026-07-12T00:00:00Z',
    comment: { id: 'comment-1', body: 'Please revise' }, isTweak: true,
    repairEdits: { video_status: 'Tweaks Needed', status: 'Tweaks Needed' },
    reserveStatusIntent: { status: 'Tweaks Needed' }
  });
  assert(builtRepair.intents.length === 2
    && builtRepair.intents[0].operation === 'comment'
    && builtRepair.intents[1].operation === 'status'
    && builtRepair.edits.video_status === 'Tweaks Needed',
  'the real source-repair builder materializes a full composite comment/status reservation');

  const storage = new Map();
  let liveAuthority = { video: 'linear', graphics: 'linear' };
  const cacheContext = {
    CAL_CACHE_KEY_PREFIX: 'cal:', CAL_CACHE_TTL_MS: 1000,
    SXR_CACHE_PREFIX: 'sxr:', SXR_CACHE_TTL_MS: 1000,
    CAL_SETTINGS_DEFAULTS: {}, calState: { settings: {} },
    _writeUiAuthoritySnapshot: () => liveAuthority,
    _writeUiFilterCachedPosts: posts => posts,
    _sxrNormStatus: status => status,
    localStorage: {
      get length() { return storage.size; },
      key: index => Array.from(storage.keys())[index] || null,
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key),
    },
    Date, Map, Set, JSON,
  };
  vm.createContext(cacheContext);
  const exactBetween = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length));
  vm.runInContext(exactBetween('function _calCacheKey', 'function _calCacheRead'), cacheContext);
  vm.runInContext(exactBetween('function _calCacheRead', 'function _calCacheWrite'), cacheContext);
  vm.runInContext(exactBetween('function _calCacheWrite', '/* ============================================================'), cacheContext);
  vm.runInContext(exactBetween('function _sxrCacheRead', 'function _sxrCacheWrite'), cacheContext);
  vm.runInContext(exactBetween('function _sxrCacheWrite', 'function _sxrIsArchivedRef'), cacheContext);
  const repair = { id: 'repair-1', video_status: 'Approved', _writeUiRetrySourceAt: '2026-07-12T00:00:00Z', _writeUiRetryEdits: { video_status: 'Approved' } };
  assert(cacheContext._calCacheWrite('fixture', [repair]));
  assert(cacheContext._sxrCacheWrite('fixture', [repair]));
  liveAuthority = null;
  assert.strictEqual(cacheContext._calCacheRead('fixture'), null, 'authority outage does not paint a cache');
  assert.strictEqual(cacheContext._sxrCacheRead('fixture'), null, 'authority outage does not paint a Samples cache');
  cacheContext._calCacheWrite('fixture', [{ id: 'repair-1', video_status: 'In Progress' }]);
  cacheContext._sxrCacheWrite('fixture', [{ id: 'repair-1', video_status: 'In Progress' }]);
  liveAuthority = { video: 'linear', graphics: 'linear' };
  assert.strictEqual(cacheContext._calCacheRead('fixture').posts[0].video_status, 'Approved', 'Calendar network revalidation cannot erase a committed repair during an authority outage');
  assert.strictEqual(cacheContext._sxrCacheRead('fixture').posts[0].video_status, 'Approved', 'Samples network revalidation cannot erase a committed repair during an authority outage');
  cacheContext._calCacheWrite('fixture', [{ id: 'repair-1', video_status: 'Approved' }], { clearRepairIds: ['repair-1'] });
  cacheContext._sxrCacheWrite('fixture', [{ id: 'repair-1', video_status: 'Approved' }], { clearRepairIds: ['repair-1'] });
  assert(!cacheContext._calCacheRead('fixture').posts[0]._writeUiRetrySourceAt && !cacheContext._sxrCacheRead('fixture').posts[0]._writeUiRetrySourceAt,
    'source acknowledgement explicitly clears both durable repair checkpoints');

  let hydrationAuthority = null;
  let hydrationRecords = [];
  let calendarHydrationCache = null;
  let samplesHydrationCache = null;
  let calendarHydrationLoads = 0;
  let samplesHydrationLoads = 0;
  let calendarHydrationReads = 0;
  let samplesHydrationReads = 0;
  const hydrationContext = {
    _isClientLink: true,
    _writeUiAuthoritySnapshot: () => hydrationAuthority,
    _writeUiLegacyCommittedTweakRead: () => hydrationRecords,
    _writeUiPrincipalKey: () => 'client:fixture',
    calState: { client: { slug: 'fixture' }, posts: [] },
    sxrState: { client: { slug: 'fixture' }, posts: [] },
    calClientSlug: client => String(client && client.slug || ''),
    sxrClientSlug: client => String(client && client.slug || ''),
    _calCacheRead: () => {
      calendarHydrationReads++;
      return calendarHydrationCache;
    },
    _sxrCacheRead: () => {
      samplesHydrationReads++;
      return samplesHydrationCache;
    },
    loadCalendarPosts: () => { calendarHydrationLoads++; },
    loadSxrCards: () => { samplesHydrationLoads++; },
    Array, Object, String,
  };
  vm.createContext(hydrationContext);
  vm.runInContext(extract('_writeUiLegacyHydrateConfirmedCacheAfterAuthority'), hydrationContext);
  const hydrationRecord = (surface, overrides) => ({
    item: {
      source_gate: Object.assign({
        surface,
        client_slug: 'fixture',
        post_id: surface === 'calendar' ? 'cal-post' : 'sxr-post',
        principal: 'client:fixture'
      }, overrides || {})
    }
  });
  const resetHydrationEvidence = () => {
    calendarHydrationLoads = 0;
    samplesHydrationLoads = 0;
    calendarHydrationReads = 0;
    samplesHydrationReads = 0;
    hydrationContext.calState.posts = [];
    hydrationContext.sxrState.posts = [];
    calendarHydrationCache = { posts: [{ id: 'cal-post' }] };
    samplesHydrationCache = { posts: [{ id: 'sxr-post' }] };
  };

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar'), hydrationRecord('sxr')];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 0
    && samplesHydrationLoads === 0
    && calendarHydrationReads === 0
    && samplesHydrationReads === 0,
  'confirmed-cache recovery fails closed before live authority exists');

  hydrationAuthority = { video: 'linear', graphics: 'linear' };
  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar', { principal: 'client:other' })];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 0 && calendarHydrationReads === 0,
    'confirmed-cache recovery ignores another principal tombstone');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar', { client_slug: 'other-client' })];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 0 && calendarHydrationReads === 0,
    'confirmed-cache recovery ignores a tombstone for another client');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar')];
  calendarHydrationCache = { posts: [{ id: 'different-post' }] };
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 0 && calendarHydrationReads === 1,
    'confirmed-cache recovery requires the exact tombstoned post in cache');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar')];
  hydrationContext.calState.posts = [{ id: 'already-live' }];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 0 && calendarHydrationReads === 0,
    'confirmed-cache recovery never replaces nonempty Calendar state');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('sxr')];
  hydrationContext.sxrState.posts = [{ id: 'already-live' }];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(samplesHydrationLoads === 0 && samplesHydrationReads === 0,
    'confirmed-cache recovery never replaces nonempty Samples state');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('calendar')];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(calendarHydrationLoads === 1
    && samplesHydrationLoads === 0
    && calendarHydrationReads === 1
    && samplesHydrationReads === 0,
  'live authority hydrates only Calendar for its exact committed tombstone and cached post');

  resetHydrationEvidence();
  hydrationRecords = [hydrationRecord('sxr')];
  hydrationContext._writeUiLegacyHydrateConfirmedCacheAfterAuthority();
  assert(samplesHydrationLoads === 1
    && calendarHydrationLoads === 0
    && samplesHydrationReads === 1
    && calendarHydrationReads === 0,
  'live authority hydrates only Samples for its exact committed tombstone and cached post');

  const legacyResume = extract('_writeUiResumeLegacyQueues');
  const authorityReadAt = legacyResume.indexOf('const authority = await _writeUiRefreshAuthority()');
  const authorityGuardAt = legacyResume.indexOf('if (!authority)', authorityReadAt);
  const hydrateAfterAuthorityAt = legacyResume.indexOf('_writeUiLegacyHydrateConfirmedCacheAfterAuthority()', authorityGuardAt);
  assert(authorityReadAt >= 0
    && authorityGuardAt > authorityReadAt
    && hydrateAfterAuthorityAt > authorityGuardAt,
  'legacy resume places confirmed-cache recovery behind its successful live-authority guard');
  let resumeAuthority = null;
  let resumeHydrationCalls = 0;
  const resumeTrace = [];
  const resumeContext = {
    _writeUiLegacyResumePromise: null,
    _writeUiExpireV1Caches: () => {},
    _writeUiPrimeRerouteFlag: async () => {},
    _linearIntakeRead: () => null,
    _linearOutboxRead: () => [],
    _sxrLinearOutboxRead: () => [],
    _writeUiRefreshAuthority: async () => {
      resumeTrace.push('authority');
      return resumeAuthority;
    },
    _writeUiLegacyHydrateConfirmedCacheAfterAuthority: () => {
      resumeTrace.push('hydrate');
      resumeHydrationCalls++;
    },
    _calPruneLinearMetaForAuthority: () => {},
    _calHydrateLinearMeta: () => {},
    _calCardJobsRead: () => [],
    _writeUiResumeSourceRepairs: async () => {},
    Promise,
  };
  vm.createContext(resumeContext);
  vm.runInContext(legacyResume, resumeContext);
  await resumeContext._writeUiResumeLegacyQueues('authority-outage');
  assert(resumeHydrationCalls === 0 && resumeTrace.join(',') === 'authority',
    'legacy resume does not hydrate a confirmed cache when the live authority read fails');
  resumeAuthority = { video: 'linear', graphics: 'linear' };
  resumeTrace.length = 0;
  await resumeContext._writeUiResumeLegacyQueues('authority-live');
  assert(resumeHydrationCalls === 1 && resumeTrace.join(',') === 'authority,hydrate',
    'legacy resume hydrates confirmed cache only after live authority succeeds');

  const repairStorage = new Map();
  let rejectRepairWrite = false;
  const repairContext = {
    WRITE_UI_SOURCE_REPAIR_KEY: 'repair-journal',
    localStorage: {
      get length() { return repairStorage.size; },
      key: index => Array.from(repairStorage.keys())[index] || null,
      getItem: key => repairStorage.has(key) ? repairStorage.get(key) : null,
      setItem: (key, value) => {
        if (key === 'repair-journal' && rejectRepairWrite) throw new Error('quota');
        repairStorage.set(key, String(value));
      },
      removeItem: key => repairStorage.delete(key),
    },
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    navigator: { locks: { request: async (_name, _options, callback) => callback() } },
    _writeUiGatewayPost: async (_intent, hooks) => {
      if (hooks && hooks.beforeAttempt) await hooks.beforeAttempt('{"fixture":true}');
      repairContext.gatewayHits++;
      const response = { ok: true, native_committed: true };
      if (hooks && hooks.afterCommit) await hooks.afterCommit(response);
      return response;
    },
    gatewayHits: 0,
    JSON, Map,
  };
  vm.createContext(repairContext);
  for (const name of [
    '_writeUiRepairJournalRead', '_writeUiRepairEvictDisplayCaches', '_writeUiRepairJournalWrite',
    '_writeUiRequireRepairStorage', '_writeUiRepairWithLock', '_writeUiReserveSourceRepair',
    '_writeUiPrepareRepairAttempt', '_writeUiMarkRepairCommitted',
    '_writeUiDiscardSourceRepairUnlocked', '_writeUiDiscardSourceRepair',
    '_writeUiCompleteSourceRepairRefsUnlocked', '_writeUiGatewayWithRepair'
  ]) {
    vm.runInContext(extract(name), repairContext);
  }
  const reservation = {
    version: 1, key: 'calendar|card|fixture|repair-1|comment', surface: 'calendar', lane: 'card',
    client_slug: 'fixture', post_id: 'repair-1', source_at: '2026-07-12T00:00:00Z', principal: 'staff:a:smm',
    edits: { video_tweaks: JSON.stringify([{ id: 'comment-1', body: 'durable body' }]) },
    primary_intent_key: 'comment:video:comment-1',
    intents: [{ key: 'comment:video:comment-1', operation: 'comment', component: 'video', attempted: false, native_committed: false }], token: 'token-1'
  };
  assert(repairContext._writeUiRequireRepairStorage(reservation), 'the real source-repair payload is durable before gateway IO');
  repairStorage.clear(); rejectRepairWrite = true;
  let quotaBlocked = false;
  try { await repairContext._writeUiGatewayWithRepair({ operation: 'comment' }, reservation); }
  catch (error) { quotaBlocked = error.status === 507 && error.code === 'repair_storage_unavailable'; }
  assert(quotaBlocked && !repairStorage.has('repair-journal') && repairContext.gatewayHits === 0,
    'full-payload quota failure blocks before a native mutation can start');
  rejectRepairWrite = false; repairStorage.set('repair-journal', '{broken');
  let corruptBlocked = false;
  try { repairContext._writeUiRequireRepairStorage(reservation); }
  catch (error) { corruptBlocked = error.status === 507 && error.code === 'repair_storage_unknown'; }
  assert(corruptBlocked, 'corrupt repair debt is surfaced as unknown and never overwritten as zero');
  assert(extract('_writeUiGatewayPost').includes("await runHook('beforeAttempt', payloadBody)")
    && extract('_writeUiGatewayPost').indexOf("await runHook('beforeAttempt', payloadBody)") < extract('_writeUiGatewayPost').indexOf('await fetch('),
  'the cross-tab-locked exact envelope is read back before gateway network IO');

  rejectRepairWrite = false; repairStorage.clear();
  const unrelated = Object.assign({}, reservation, { key: 'calendar|card|fixture|repair-1|other', token: 'token-2' });
  repairContext._writeUiRequireRepairStorage(reservation);
  repairContext._writeUiRequireRepairStorage(unrelated);
  assert(repairContext._writeUiCompleteSourceRepairRefsUnlocked([{ key: reservation.key, token: reservation.token }])
    && repairContext._writeUiRepairJournalRead().rows.length === 1
    && repairContext._writeUiRepairJournalRead().rows[0].token === 'token-2',
  'field-level source acknowledgement clears only the exact included repair token');

  const mutablePost = { _writeUiRepairRefs: [{ key: 'A', token: '1' }] };
  const refHelpers = { JSON, Set };
  vm.createContext(refHelpers);
  vm.runInContext(extract('_writeUiSnapshotRepairRefs') + '\n' + extract('_writeUiRemoveCompletedRepairRefs'), refHelpers);
  const included = refHelpers._writeUiSnapshotRepairRefs(mutablePost);
  mutablePost._writeUiRepairRefs.push({ key: 'B', token: '2' });
  refHelpers._writeUiRemoveCompletedRepairRefs(mutablePost, included);
  assert(mutablePost._writeUiRepairRefs.length === 1 && mutablePost._writeUiRepairRefs[0].key === 'B',
    'an in-flight source save clears only its ref snapshot and preserves refs appended while awaiting IO');

  const agedAt = Date.now() - 5000;
  const kasperCache = JSON.stringify({
    savedAt: agedAt,
    items: [
      { slug: 'fixture', post: { id: 'display-only' } },
      { slug: 'fixture', post: { id: 'calendar-repair', _writeUiRetrySourceAt: '2026-07-12T00:00:00Z', _writeUiRetryEdits: { video_status: 'Approved' } } }
    ],
    history: [{ id: 'stale-history' }], dismissed: { stale: true }, closed: { stale: true }, smmByClient: [],
    sxrRepairs: [{ id: 'samples-repair', slug: 'fixture', patch: { graphic_status: 'Approved' } }]
  });
  const kasperContext = {
    KASPER_CACHE_KEY: 'kasper', KASPER_CACHE_MAX_AGE_MS: 1000,
    localStorage: { getItem: key => key === 'kasper' ? kasperCache : null },
    _kasperState: { items: [], history: [], dismissed: {}, closed: {}, smmByClient: null, sxrRepairs: [], lastLoaded: 0 },
    _calLoadComments: () => [], _calMigratePostShape: () => {}, Date, JSON, Map, Set,
  };
  vm.createContext(kasperContext);
  vm.runInContext(extract('_kasperHydrateCache'), kasperContext);
  kasperContext._kasperHydrateCache();
  assert(kasperContext._kasperState.items.length === 1
    && kasperContext._kasperState.items[0].post.id === 'calendar-repair'
    && kasperContext._kasperState.sxrRepairs.length === 1
    && kasperContext._kasperState.sxrRepairs[0].id === 'samples-repair'
    && kasperContext._kasperState.history.length === 0
    && kasperContext._kasperState.lastLoaded === 0,
  'aged Kasper cache drops display state but hydrates both Calendar and Samples repair shapes');

  assert(extract('_writeUiStoredSourceRepairState').includes('unknown++')
    && source.includes('unknown_records: unknown') && source.includes("drain_state: unknown ? 'unknown' : 'observed'"),
  'queue closeout reports corrupt or unparseable debt as unknown instead of false zero');
  assert(calReview.includes('reserveStatusIntent') && calReview.includes('repairEdits: Object.assign')
    && sxrReview.includes('reserveStatusIntent') && sxrReview.includes('repairEdits: Object.assign'),
  'Calendar and Samples composite tweaks reserve comment plus full status/source edits before the first mutation');
  const receiptReplay = extract('_writeUiReplayRepairIntents');
  const receiptRead = extract('_writeUiReadRepairReceipt');
  assert(receiptReplay.includes('await _writeUiReadRepairReceipt(group, intent, post)')
    && receiptReplay.includes("receipt.outcome === 'committed_exact'")
    && !receiptReplay.includes('_writeUiReplayPinnedIntent')
    && receiptRead.includes('payload.reconcile_only = true'),
  'journal recovery authenticates the exact receipt and never blindly replays the pinned mutation envelope');
  assert(receiptReplay.includes("intent.operation === 'status'")
    && receiptReplay.includes("throw _writeUiGatewayError(409, 'status_reapply_required')")
    && receiptReplay.includes('await _calPostLinearComment'),
  'absent destructive status debt pauses while absent append-only comments may use the current authority lane');

  console.log('write UI native-target and gateway-before-source durability checks passed');
})().catch(error => { console.error(error); process.exit(1); });
