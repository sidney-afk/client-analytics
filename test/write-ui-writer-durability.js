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
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
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
  assert(calReview.includes('Promise.resolve().then(() => _calPostLinearComment')
    && sxrReview.includes('Promise.resolve().then(() => _sxrPostLinearComment'),
  'synchronous repair-checkpoint failures enter the review rollback chains');
  assert(extract('_calAppendComment').indexOf('await _calPostLinearComment') < extract('_calAppendComment').indexOf('arr.push(msg)'));
  assert(extract('_sxrAppendComment').indexOf('await _sxrPostLinearComment') < extract('_sxrAppendComment').indexOf('arr.push(msg)'));
  assert(extract('_kasperPersistPostWrite').indexOf('await _calPushStatusToLinear') < extract('_kasperPersistPostWrite').indexOf('await _calUpsertFetch'));
  assert(extract('_sxrKasperApplyAndPersist').indexOf('await _sxrPushStatusToLinear') < extract('_sxrKasperApplyAndPersist').indexOf('await _sxrKasperPersist'));
  const calTweakAck = calReview.indexOf('.then(async acknowledgement =>');
  const sxrTweakAck = sxrReview.indexOf('.then(async acknowledgement =>');
  const calSourceError = calReview.indexOf("_calReviewState.errors[key] = current._saveError || 'Save failed';");
  const sxrSourceError = sxrReview.indexOf("_sxrReviewState.errors[key] = current._saveError || 'Save failed';");
  assert(calReview.includes('const body = rawDraft.trim()')
    && calReview.includes('_calReviewState.drafts[key] = rawDraft')
    && calReview.includes('deferLegacyUntilSourceSave: true')
    && calReview.includes('await _writeUiQueueDeferredLegacyTweak')
    && calReview.includes("_writeUiLegacyPinnedSourceTransport('calendar', deferredLegacyOutboxIds)")
    && calReview.includes("_calNoLinearPush.add(pid + '|' + comp)")
    && calReview.includes("_writeUiFlushDeferredLegacyTweak('calendar', deferredLegacyOutboxIds)")
    && calReview.includes("_writeUiScheduleDeferredLegacyTweak('calendar')")
    && !calReview.includes('_writeUiDiscardDeferredLegacyTweak')
    && ['client_video_approved_at', 'client_graphic_approved_at', 'client_caption_approved_at',
      'client_title_approved_at', 'kasper_approved_at'].every(field => calReview.includes(field + ': post.' + field))
    && calSourceError >= 0
    && calReview.indexOf('_calRenderBody({ preserveScroll: true });', calSourceError) > calSourceError
    && calTweakAck >= 0
    && calReview.indexOf('_calPendingEdits[pid]') > calTweakAck
    && calReview.indexOf('_writeUiBindRepairAck(post, committedBatch, acknowledgement)') > calTweakAck
    && calReview.indexOf('await _writeUiQueueDeferredLegacyTweak')
      < calReview.indexOf('return _calFlushCardSave(pid)')
    && calReview.indexOf('_writeUiMergeCommittedBatch(pending, committedBatch)')
      > calReview.indexOf('_writeUiBindRepairAck(post, committedBatch, acknowledgement)'),
  'Calendar preserves the raw draft and durably stages its exact legacy pair before source IO');
  assert(sxrReview.includes('const body = rawDraft.trim()')
    && sxrReview.includes('_sxrReviewState.drafts[key] = rawDraft')
    && sxrReview.includes('await _writeUiQueueDeferredLegacyTweak')
    && sxrReview.includes("_writeUiLegacyPinnedSourceTransport('sxr', deferredLegacyOutboxIds)")
    && sxrReview.includes("_sxrNoLinearPush.add(pid + '|' + comp)")
    && sxrReview.includes("_writeUiFlushDeferredLegacyTweak('sxr', deferredLegacyOutboxIds)")
    && sxrReview.includes("_writeUiScheduleDeferredLegacyTweak('sxr')")
    && !sxrReview.includes('_writeUiDiscardDeferredLegacyTweak')
    && ['client_video_approved_at', 'client_graphic_approved_at', 'kasper_approved_at']
      .every(field => sxrReview.includes(field + ': post.' + field))
    && sxrSourceError >= 0
    && sxrReview.indexOf('_sxrRenderBody({ preserveScroll: true });', sxrSourceError) > sxrSourceError
    && sxrTweakAck >= 0
    && sxrReview.indexOf('_sxrPendingEdits[pid]') > sxrTweakAck
    && sxrReview.indexOf('_writeUiBindRepairAck(post, committedBatch, acknowledgement)') > sxrTweakAck
    && sxrReview.indexOf('await _writeUiQueueDeferredLegacyTweak')
      < sxrReview.indexOf('return _sxrFlushCardSave(pid)')
    && sxrReview.indexOf('_writeUiMergeCommittedBatch(pending, committedBatch)')
      > sxrReview.indexOf('_writeUiBindRepairAck(post, committedBatch, acknowledgement)'),
  'Samples preserves the raw draft, stages its exact legacy pair, and restores every cleared approval stamp');
  const legacyStage = extract('_writeUiQueueDeferredLegacyTweak');
  const legacyGate = extract('_writeUiLegacySourceGateState');
  const legacyReconcile = extract('_writeUiLegacyReconcileCommittedTweak');
  const legacyFinalize = extract('_writeUiLegacyFinalizeFlush');
  assert(legacyStage.includes('await _sxrPrimeSampleRoutingFlag()')
    && legacyStage.includes('await _calPrimeUpsertRoutingFlag()')
    && legacyStage.includes("source_transport: surface === 'sxr'")
    && legacyStage.includes('const records = [{')
    && legacyStage.includes('_writeUiLegacyOutboxWrite(surface, next)')
    && legacyStage.includes('const readback = _writeUiLegacyOutboxItems(surface)')
    && legacyStage.includes('principal: _writeUiPrincipalKey()'),
  'legacy request-change recovery pins the actual source route and verifies both intents in one durable write');
  assert(legacyGate.includes("return 'principal_mismatch'")
    && legacyGate.includes("return 'conflict'")
    && legacyGate.includes("last = 'pending'")
    && legacyGate.includes("'committed' : 'superseded'")
    && legacyGate.includes('WRITE_UI_LEGACY_SOURCE_GATE_PENDING_MS'),
  'legacy drains require the exact principal/comment semantics and retain propagation-lag reads');
  const calLegacyOutbox = extract('_linearOutboxFlushRun');
  const sxrLegacyOutbox = extract('_sxrLinearOutboxFlushRun');
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
  vm.runInContext(legacyGate, gateContext);
  const gateItem = {
    id: 'deferred_calendar_comment-1_comment', kind: 'comment', queuedAt: Date.now(),
    payload: { issue: 'https://linear.invalid/GRA-1', body: 'Please revise', author: 'Client' },
    source_gate: {
      surface: 'calendar', client_slug: 'fixture', post_id: 'post-1', component: 'graphic',
      comment_id: 'comment-1', comment_body: 'Please revise', comment_author: 'Client',
      comment_role: 'client', comment_audience: 'client', comment_is_tweak: true,
      linear_issue: 'https://linear.invalid/GRA-1',
      intended_status: 'Tweaks Needed',
      principal: 'client:fixture'
    }
  };
  assert.strictEqual(await gateContext._writeUiLegacySourceGateState(gateItem, 1), 'pending',
    'a fresh authoritative miss remains pending instead of deleting commit-lag recovery debt');
  gateContext._writeUiLegacySourceRows = async () => [{
    id: 'post-1', graphic_status: 'Tweaks Needed', graphic_linear_issue_id: 'https://linear.invalid/GRA-1',
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

  let reconcileRenders = 0;
  const reconcileContext = {
    _isClientLink: true,
    calState: {
      posts: [{
        id: 'post-1', graphic_status: 'Client Approval', status: 'Client Approval',
        graphic_comments: [], client_graphic_approved_at: '2026-07-18T00:00:00Z',
        kasper_approved_at: '2026-07-18T00:00:00Z', _saveError: 'Failed to fetch'
      }]
    },
    _calReviewState: {
      drafts: { 'post-1|graphic': '  Please revise\n' },
      errors: { 'post-1|graphic': 'Failed to fetch' },
      saving: { 'post-1|graphic': false }
    },
    _writeUiPrincipalKey: () => 'client:fixture',
    _calCommentsFor: post => post.graphic_comments || [],
    _calSetCommentsFor: (post, _comp, comments) => { post.graphic_comments = comments; },
    _calNextTweakRound: () => 1,
    computeOverallStatus: () => 'Tweaks Needed',
    _calRenderBody: () => { reconcileRenders++; },
    _calCacheWrite: () => true,
    _sxrCommentsFor: () => [], _sxrSetCommentsFor: () => {},
    _sxrNextTweakRound: () => 1, computeSampleOverallStatus: () => 'Tweaks Needed',
    _sxrRenderBody: () => {},
    _sxrCacheWrite: () => true,
    Date, String, Number, Array,
  };
  vm.createContext(reconcileContext);
  vm.runInContext(legacyReconcile, reconcileContext);
  assert.strictEqual(reconcileContext._writeUiLegacyReconcileCommittedTweak(
    'calendar',
    Object.assign({}, statusGateItem, { queuedAt: Date.now() })
  ), true);
  const reconciled = reconcileContext.calState.posts[0];
  assert(reconciled.graphic_status === 'Tweaks Needed'
    && reconciled.status === 'Tweaks Needed'
    && reconciled.graphic_comments.length === 1
    && reconciled.graphic_comments[0].id === 'comment-1'
    && reconciled.client_graphic_approved_at === ''
    && reconciled.kasper_approved_at === ''
    && reconcileContext._calReviewState.drafts['post-1|graphic'] === ''
    && reconcileContext._calReviewState.errors['post-1|graphic'] === ''
    && reconcileRenders === 1,
  'same-page source confirmation replaces the stale retry surface with committed source truth');

  reconciled.graphic_status = 'Client Approval';
  reconciled.status = 'Client Approval';
  reconciled.client_graphic_approved_at = '2026-07-18T01:00:00Z';
  reconciled.kasper_approved_at = '2026-07-18T01:00:00Z';
  reconciled._saveError = 'overlapping retry failed';
  reconcileContext._calReviewState.drafts['post-1|graphic'] = '  Please revise\n';
  reconcileContext._calReviewState.errors['post-1|graphic'] = 'overlapping retry failed';
  reconcileContext._calReviewState.saving['post-1|graphic'] = true;
  assert.strictEqual(reconcileContext._writeUiLegacyReconcileCommittedTweak(
    'calendar',
    Object.assign({}, statusGateItem, { queuedAt: Date.now() })
  ), true);
  assert(reconciled.graphic_status === 'Tweaks Needed'
    && reconciled.status === 'Tweaks Needed'
    && reconciled.client_graphic_approved_at === ''
    && reconciled.kasper_approved_at === ''
    && !reconciled._saveError
    && reconcileContext._calReviewState.saving['post-1|graphic'] === true
    && reconcileContext._calReviewState.drafts['post-1|graphic'] === '  Please revise\n'
    && reconcileContext._calReviewState.errors['post-1|graphic'] === 'overlapping retry failed'
    && reconcileRenders === 2,
  'authoritative reconciliation preserves an overlapping retry owner and its in-flight draft/error state');

  const committedStorage = new Map();
  let rejectCommittedWrite = false;
  const committedContext = {
    WRITE_UI_LEGACY_COMMITTED_TWEAK_KEY: 'committed-tweaks',
    _writeUiPrincipalKey: () => 'client:fixture',
    _writeUiLegacyOutboxItems: () => [],
    _sxrCommentsFor: post => post.graphic_comments || [],
    _calCommentsFor: post => post.graphic_comments || [],
    _sxrNormStatus: value => String(value || '').toLowerCase(),
    _calNormStatus: value => String(value || '').toLowerCase(),
    localStorage: {
      getItem: key => committedStorage.has(key) ? committedStorage.get(key) : null,
      setItem: (key, value) => {
        if (rejectCommittedWrite) throw new Error('quota');
        committedStorage.set(key, String(value));
      }
    },
    Date, JSON, Object, String, Number, Array, Map,
  };
  vm.createContext(committedContext);
  for (const name of [
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
  const laterRoundPost = {
    id: 'post-1',
    graphic_status: 'Client Approval',
    graphic_comments: [{ id: 'comment-1', body: 'Please revise' }]
  };
  assert.strictEqual(committedContext._writeUiLegacyCommittedTweak(
    'calendar', 'fixture', 'post-1', 'graphic', laterRoundPost
  ), null);
  assert.strictEqual(committedContext._writeUiLegacyCommittedTweakRead().length, 0,
    'a later approval round retires the old confirmation after its comment is present locally');
  rejectCommittedWrite = true;
  assert.strictEqual(committedContext._writeUiLegacyRememberCommittedTweak('calendar', committedItem), false,
    'confirmation storage failure keeps the active source gate fail-closed');

  for (const [surface, handler] of [['calendar', calReview], ['sxr', sxrReview]]) {
    const marker = `_writeUiLegacyCommittedTweak('${surface}'`;
    const firstMarker = handler.indexOf(marker);
    const secondMarker = handler.indexOf(marker, firstMarker + marker.length);
    const resolvedRollback = handler.indexOf('Object.assign(current, prev)');
    const rejectedRollback = handler.indexOf('Object.assign(post, prev)');
    assert(firstMarker >= 0 && firstMarker < resolvedRollback
      && secondMarker > firstMarker && secondMarker < rejectedRollback,
    `${surface} checks durable source confirmation before either failure rollback`);
    assert(handler.includes('_legacyPending.delivered && _legacyPending.body === body')
      && handler.includes('_legacyPending && !_legacyPending.delivered && _legacyPending.body !== body')
      && handler.includes('_legacyPending && !_legacyPending.delivered')
      && handler.includes('? _legacyPending.comment_id'),
    `${surface} suppresses only the same confirmed retry and mints a fresh id for distinct follow-up feedback`);
  }

  let stagedItems = [], stageWrites = 0;
  const stageContext = {
    _sxrLinearUrlFor: () => '', _calLinearUrlFor: () => 'https://linear.invalid/GRA-1',
    _sxrPrimeSampleRoutingFlag: async () => {}, _calPrimeUpsertRoutingFlag: async () => {},
    _sxrSampleUseEf: () => false, _calUpsertUseEf: () => true,
    _writeUiSourceClientSlug: () => 'fixture', _writeUiPrincipalKey: () => 'client:fixture',
    _sxrCurrentAuthor: () => 'Client', _calCurrentAuthor: () => 'Client',
    _writeUiLegacyOutboxItems: () => JSON.parse(JSON.stringify(stagedItems)),
    _writeUiLegacyOutboxWrite: (_surface, items) => { stageWrites++; stagedItems = JSON.parse(JSON.stringify(items)); return true; },
    Date, JSON, Object, String, Array, Error,
  };
  vm.createContext(stageContext);
  vm.runInContext(extract('_writeUiLegacyItemSignature') + '\n'
    + extract('_writeUiLegacyItemMatches') + '\n' + legacyStage, stageContext);
  const stagedIds = await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client'
  );
  assert(stagedIds.length === 2 && stagedItems.length === 2 && stageWrites === 1,
    'comment and status are staged together in one storage write');
  await stageContext._writeUiQueueDeferredLegacyTweak(
    'calendar',
    { id: 'post-1', graphic_status: 'Tweaks Needed' },
    'graphic',
    { id: 'comment-1', role: 'client', audience: 'client', is_tweak: true },
    'Please revise',
    'Client'
  );
  assert.strictEqual(stageWrites, 1, 'a same-action retry reuses the verified pair without rewriting it');

  let finalizedItems = [
    { id: 'old', kind: 'status', payload: { status: 'A' } },
    { id: 'new', kind: 'comment', payload: { body: 'staged during flush' } }
  ];
  const finalizeContext = {
    _writeUiLegacyOutboxItems: () => finalizedItems,
    _writeUiLegacyOutboxWrite: (_surface, items) => { finalizedItems = items; return true; },
    JSON, Object, String, Map,
  };
  vm.createContext(finalizeContext);
  vm.runInContext(extract('_writeUiLegacyItemSignature') + '\n'
    + extract('_writeUiLegacyItemMatches') + '\n' + legacyFinalize, finalizeContext);
  finalizeContext._writeUiLegacyFinalizeFlush(
    'calendar',
    [{ id: 'old', kind: 'status', payload: { status: 'A' } }],
    []
  );
  assert.strictEqual(finalizedItems.map(item => item.id).join(','), 'new',
    'finishing an old snapshot removes only processed IDs and preserves newly staged debt');

  const calApprove = extract('_calReviewApplyApprove');
  const sxrApprove = extract('_sxrReviewApplyApprove');
  assert(calApprove.indexOf('_calFlushCardSave') < calApprove.indexOf('_calReviewRemoveCard'), 'Calendar review card is removed only after acknowledgement');
  assert(sxrApprove.indexOf('_sxrFlushCardSave') < sxrApprove.indexOf('_sxrReviewRemoveCard'), 'Samples review card is removed only after acknowledgement');
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
