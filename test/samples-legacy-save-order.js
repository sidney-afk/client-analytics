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

async function runCase({ gateway, saveOk }) {
  const events = [];
  const legacyCalls = [];
  const gatewayCalls = [];
  const pid = 'sample-1';
  const issue = 'https://linear.app/acme/issue/VID-1/sample';
  const post = {
    id: pid,
    linear_issue_id: issue,
    video_status: 'In Progress',
    graphic_status: 'Backlog',
    status: 'In Progress',
    updated_at: '2026-07-16T12:00:00.000Z'
  };
  const context = {
    sxrState: { client: 'Fixture Client', posts: [post] },
    _sxrPendingEdits: { [pid]: { video_status: 'Approved' } },
    _sxrSaveInFlight: Object.create(null),
    _sxrNoLinearPush: new Set(),
    _sxrLinearPushChain: Object.create(null),
    _sxrLocalRecentSaves: new Map(),
    _sxrRecentSaveFields: new Map(),
    _sxrConflictNotified: new Set(),
    _sxrFailedNewCards: new Set(),
    _SXR_ROLLBACK_FIELDS: ['video_status', 'graphic_status', 'status'],
    SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    sxrClientSlug: () => 'fixtureclient',
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _sxrIsBlankId: () => false,
    computeSampleOverallStatus: row => row.video_status,
    _calShouldBumpThumbRevForGraphicStatus: () => false,
    _sxrSetCardStatus: () => {},
    _sxrCacheWrite: () => true,
    _sxrRenderBody: () => {},
    _sxrAwaitCardSave: async () => {},
    _sxrApplyClearSentinels: () => {},
    _sxrMigrateShape: () => {},
    _sxrMergePostComments: () => {},
    _sxrStringifyComments: JSON.stringify,
    _sxrCommentsFor: () => [],
    _writeUiAppendRepairRef: refs => refs,
    _writeUiAdoptRepairAck: () => {},
    _writeUiAdoptReplayStatus: () => '',
    _writeUiReconcileReplayStatus: async () => false,
    _writeUiCompleteSourceRepairRefs: async () => false,
    _writeUiRemoveCompletedRepairRefs: () => {},
    _writeUiReportFailure: () => { events.push('gateway-report'); },
    _writeUiUseGatewayWhenReady: async () => {
      events.push(gateway ? 'route:gateway' : 'route:legacy');
      return gateway;
    },
    _writeUiNativeId: () => '',
    _writeUiNativeStatus: value => String(value || '').trim().toLowerCase().replace(/\s+/g, '_'),
    _writeUiTeam: component => component === 'graphic' ? 'graphics' : 'video',
    _writeUiBuildSourceRepair: () => ({}),
    _writeUiGatewayWithRepair: async intent => {
      events.push('gateway');
      gatewayCalls.push(intent);
      return { ok: true, native_committed: true };
    },
    _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
    _writeUiClassifyTargetless: async () => ({ skipped: true }),
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _sxrLegacyPushStatusToLinear: (url, status, meta) => {
      events.push('legacy');
      legacyCalls.push({ url, status, component: meta && meta.component });
    },
    _sxrUpsertFetchPinned: async () => {
      events.push('save');
      if (!saveOk) return { ok: false, status: 503, json: async () => ({ ok: false }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          sample: { id: pid, video_status: 'Approved', updated_at: '2026-07-16T12:00:01.000Z' }
        })
      };
    },
    console: { warn() {} },
    Date,
    JSON,
    Object,
    Array,
    String,
    Set,
    Map,
    Promise
  };

  vm.createContext(context);
  vm.runInContext(extract('_sxrPushStatusToLinear'), context);
  vm.runInContext(extract('_sxrFlushCardSave'), context);
  await context._sxrFlushCardSave(pid);
  return { events, legacyCalls, gatewayCalls };
}

async function runReviewTweakCase({ gateway, saveOk, pending = null }) {
  const events = [];
  const legacyCalls = [];
  const gatewayCalls = [];
  const pid = 'review-sample';
  const key = pid + '|video';
  const post = {
    id: pid,
    linear_issue_id: 'https://linear.app/acme/issue/VID-2/review-sample',
    video_status: 'Client Approval',
    graphic_status: 'In Progress',
    status: 'Client Approval',
    video_comments: [],
    updated_at: '2026-07-16T13:00:00.000Z'
  };
  let stagedLegacy = null;
  const context = {
    sxrState: { posts: [post] },
    _sxrReviewState: { drafts: { [key]: 'Please revise this cut' }, saving: {}, errors: {} },
    _sxrPendingEdits: Object.create(null),
    _sxrNoLinearPush: new Set(),
    _sxrLinearPushChain: Object.create(null),
    _isClientLink: false,
    SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    _sxrCommentRole: () => 'smm',
    _sxrCommentsFor: row => row.video_comments || [],
    _sxrMintCommentId: () => 'review-comment-1',
    _sxrNextTweakRound: () => 1,
    _sxrCurrentAuthor: () => 'Fixture SMM',
    _sxrSetCommentsFor: (row, component, list) => { row[component + '_comments'] = list; },
    computeSampleOverallStatus: row => row.video_status,
    _sxrMarkLocalStatus: () => {},
    _sxrReviewMode: () => 'smm',
    _sxrReviewComponentActive: () => true,
    _sxrReviewRepaintCard: () => {},
    _sxrReviewRemoveCard: () => {},
    _sxrStringifyComments: JSON.stringify,
    _sxrClearStaleApprovals: () => {},
    _sxrLinearUrlFor: row => row.linear_issue_id,
    _writeUiSourceClientSlug: () => 'fixtureclient',
    _writeUiLegacyPendingTweak: () => pending,
    _writeUiLegacyCommittedTweak: () => null,
    _writeUiLegacyReconcileCommittedTweak: () => true,
    _writeUiQueueDeferredLegacyTweak: async (_surface, row, component, comment, body, author) => {
      stagedLegacy = { url: row.linear_issue_id, component, comment, body, author };
      return ['deferred-comment', 'deferred-status'];
    },
    _writeUiLegacyPinnedSourceTransport: () => 'webhook',
    _writeUiScheduleDeferredLegacyTweak: () => {},
    _writeUiFlushDeferredLegacyTweak: async () => {
      events.push('legacy:comment');
      legacyCalls.push({
        url: stagedLegacy.url,
        body: stagedLegacy.body,
        author: stagedLegacy.author
      });
    },
    _sxrMsgAudience: message => message.audience,
    _sxrMsgIsTweak: message => !!message.is_tweak,
    _writeUiBindRepairAck: () => {},
    _writeUiMergeCommittedBatch: (pending, batch) => Object.assign(pending, batch),
    _sxrFlushCardSave: async () => {
      events.push('save');
      if (saveOk) delete post._saveError;
      else post._saveError = 'save failed';
    },
    _writeUiReportFailure: () => { events.push('gateway-report'); },
    _sxrRenderBody: () => {},
    _writeUiUseGatewayWhenReady: async () => {
      events.push(gateway ? 'route:comment:gateway' : 'route:comment:legacy');
      return gateway;
    },
    _writeUiNativeId: () => '',
    _writeUiTeam: component => component === 'graphic' ? 'graphics' : 'video',
    _writeUiBuildSourceRepair: () => ({}),
    _writeUiGatewayWithRepair: async intent => {
      events.push('gateway:comment');
      gatewayCalls.push(intent);
      return { ok: true, native_committed: true };
    },
    _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
    _writeUiClassifyTargetless: async () => ({ skipped: true }),
    _sxrLegacyPostLinearComment: (url, body, author) => {
      events.push('legacy:comment');
      legacyCalls.push({ url, body, author });
    },
    Date,
    JSON,
    Object,
    Array,
    String,
    Promise
  };

  vm.createContext(context);
  vm.runInContext(extract('_sxrPostLinearComment'), context);
  vm.runInContext(extract('_sxrReviewRequestTweak'), context);
  context._sxrReviewRequestTweak(pid, 'video');
  for (let i = 0; i < 20 && context._sxrReviewState.saving[key] !== false; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.strictEqual(context._sxrReviewState.saving[key], false, 'review tweak fixture must settle');
  return { events, legacyCalls, gatewayCalls, stagedLegacy, post };
}

async function runKasperTweakCase({ gateway, saveOk }) {
  const events = [];
  const legacyStatusCalls = [];
  const legacyCommentCalls = [];
  const gatewayCalls = [];
  const pid = 'kasper-sample';
  const issue = 'https://linear.app/acme/issue/VID-3/kasper-sample';
  const post = {
    id: pid,
    linear_issue_id: issue,
    video_status: 'Kasper Approval',
    graphic_status: 'In Progress',
    status: 'Kasper Approval',
    video_comments: [],
    updated_at: '2026-07-16T14:00:00.000Z'
  };
  const item = { slug: 'fixtureclient', post };
  const context = {
    _sxrKasperState: { saving: {}, errors: {}, drafts: {} },
    _kasperState: { sxrRepairs: [] },
    _sxrLinearPushChain: Object.create(null),
    _sxrKasperFindItem: () => item,
    _writeUiQueueDiagnostic: () => {},
    _sxrKasperRepaint: () => {},
    _writeUiPrincipalKey: () => 'staff:kasper:kasper',
    _kasperPersistCache: () => true,
    _sxrLinearUrlFor: row => row.linear_issue_id,
    _sxrCommentsFor: row => row.video_comments || [],
    _sxrMsgIsTweak: message => !!message.is_tweak,
    _writeUiUseGatewayWhenReady: async (_surface, meta) => {
      const operation = meta && meta.comment ? 'comment' : 'status';
      events.push('route:' + operation + ':' + (gateway ? 'gateway' : 'legacy'));
      return gateway;
    },
    _writeUiNativeId: () => '',
    _writeUiNativeStatus: value => String(value || '').trim().toLowerCase().replace(/\s+/g, '_'),
    _writeUiTeam: component => component === 'graphic' ? 'graphics' : 'video',
    _writeUiBuildSourceRepair: () => ({}),
    _writeUiGatewayWithRepair: async intent => {
      events.push('gateway:' + intent.operation);
      gatewayCalls.push(intent);
      return { ok: true, native_committed: true };
    },
    _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
    _writeUiClassifyTargetless: async () => ({ skipped: true }),
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _writeUiAdoptRepairAck: () => {},
    _writeUiAppendRepairRef: refs => refs,
    _writeUiRepairCompanions: () => [],
    _writeUiReconcileReplayStatus: async () => false,
    _writeUiCompleteSourceRepairRefs: async () => false,
    _writeUiRemoveCompletedRepairRefs: () => {},
    _writeUiReportFailure: () => { events.push('gateway-report'); },
    showNotify: title => { events.push('notify:' + title); },
    _sxrKasperPersist: async () => {
      events.push('save');
      if (!saveOk) throw new Error('save failed');
    },
    _sxrLegacyPushStatusToLinear: (url, status, meta) => {
      events.push('legacy:status');
      legacyStatusCalls.push({ url, status, component: meta && meta.component });
    },
    _sxrLegacyPostLinearComment: (url, body, author, meta) => {
      events.push('legacy:comment');
      legacyCommentCalls.push({ url, body, author, component: meta && meta.component });
    },
    Date,
    JSON,
    Object,
    Array,
    String,
    Promise
  };

  vm.createContext(context);
  vm.runInContext(extract('_sxrPushStatusToLinear'), context);
  vm.runInContext(extract('_sxrPostLinearComment'), context);
  vm.runInContext(extract('_sxrKasperApplyAndPersist'), context);
  await context._sxrKasperApplyAndPersist(pid, 'video', row => {
    const message = {
      id: 'kasper-comment-1', author: 'Kasper', role: 'kasper', is_tweak: true,
      audience: 'internal', round: 1, body: 'Please revise this cut'
    };
    row.video_comments = [message];
    row.video_status = 'Tweaks Needed';
    row.status = 'Tweaks Needed';
    return { video_status: row.video_status, status: row.status, video_tweaks: JSON.stringify(row.video_comments) };
  }, 'Please revise this cut', null);
  return { events, legacyStatusCalls, legacyCommentCalls, gatewayCalls };
}

(async () => {
  const flush = extract('_sxrFlushCardSave');
  assert(
    flush.indexOf('await _sxrPushStatusToLinear') < flush.indexOf('await _sxrUpsertFetch'),
    'enrolled gateway status commits stay before the Samples source save'
  );
  assert(
    flush.indexOf('_sxrLegacyPushStatusToLinear(') > flush.indexOf("if (!json.ok) throw new Error(json.error || 'save failed')"),
    'direct legacy status transport is reachable only after the source save is confirmed'
  );

  const failedLegacy = await runCase({ gateway: false, saveOk: false });
  assert.deepStrictEqual(failedLegacy.events, ['route:legacy', 'save']);
  assert.strictEqual(failedLegacy.legacyCalls.length, 0, 'a failed Samples save must not notify legacy Linear');

  const successfulLegacy = await runCase({ gateway: false, saveOk: true });
  assert.deepStrictEqual(successfulLegacy.events, ['route:legacy', 'save', 'legacy']);
  assert.deepStrictEqual(successfulLegacy.legacyCalls, [{
    url: 'https://linear.app/acme/issue/VID-1/sample',
    status: 'Approved',
    component: 'video'
  }]);

  const successfulGateway = await runCase({ gateway: true, saveOk: true });
  assert.deepStrictEqual(successfulGateway.events, ['route:gateway', 'gateway', 'save']);
  assert.strictEqual(successfulGateway.gatewayCalls.length, 1, 'enrolled status uses the gateway before source IO');
  assert.strictEqual(successfulGateway.legacyCalls.length, 0, 'enrolled status never falls through to direct legacy transport');

  const reviewTweak = extract('_sxrReviewRequestTweak');
  assert(
    reviewTweak.indexOf('await _writeUiQueueDeferredLegacyTweak') < reviewTweak.indexOf('return _sxrFlushCardSave(pid)') &&
      reviewTweak.indexOf('_writeUiFlushDeferredLegacyTweak') > reviewTweak.indexOf('if (current._saveError)'),
    'legacy review-tweak pairs are staged before source IO and drained only after source success'
  );
  const failedLegacyReview = await runReviewTweakCase({ gateway: false, saveOk: false });
  assert.deepStrictEqual(failedLegacyReview.events, ['route:comment:legacy', 'save']);
  assert.strictEqual(failedLegacyReview.legacyCalls.length, 0, 'a failed review-tweak save must not notify legacy Linear');
  const successfulLegacyReview = await runReviewTweakCase({ gateway: false, saveOk: true });
  assert.deepStrictEqual(successfulLegacyReview.events, ['route:comment:legacy', 'save', 'legacy:comment']);
  assert.strictEqual(successfulLegacyReview.legacyCalls.length, 1);
  const successfulGatewayReview = await runReviewTweakCase({ gateway: true, saveOk: true });
  assert.deepStrictEqual(successfulGatewayReview.events, ['route:comment:gateway', 'gateway:comment', 'save']);
  assert.strictEqual(successfulGatewayReview.gatewayCalls.length, 1);
  assert.strictEqual(successfulGatewayReview.legacyCalls.length, 0);
  const distinctFollowup = await runReviewTweakCase({
    gateway: false,
    saveOk: true,
    pending: {
      delivered: true,
      comment_id: 'confirmed-comment-0',
      body: 'Earlier confirmed request',
      item: { source_gate: { comment_id: 'confirmed-comment-0' } }
    }
  });
  assert.deepStrictEqual(distinctFollowup.events, ['route:comment:legacy', 'save', 'legacy:comment']);
  assert(distinctFollowup.stagedLegacy
    && distinctFollowup.stagedLegacy.comment.id === 'review-comment-1'
    && distinctFollowup.stagedLegacy.body === 'Please revise this cut',
  'a distinct follow-up after confirmation gets a fresh comment id and normal source save');

  const kasperTweak = extract('_sxrKasperApplyAndPersist');
  assert(
    kasperTweak.indexOf('_sxrLegacyPushStatusToLinear(') > kasperTweak.indexOf('await _sxrKasperPersist'),
    'legacy Kasper status transport stays after source persistence'
  );
  assert(
    kasperTweak.indexOf('_sxrLegacyPostLinearComment(') > kasperTweak.indexOf('await _sxrKasperPersist'),
    'legacy Kasper comment transport stays after source persistence'
  );
  const failedLegacyKasper = await runKasperTweakCase({ gateway: false, saveOk: false });
  assert.deepStrictEqual(failedLegacyKasper.events, [
    'route:comment:legacy', 'route:status:legacy', 'save', 'notify:Save failed'
  ]);
  assert.strictEqual(failedLegacyKasper.legacyStatusCalls.length, 0);
  assert.strictEqual(failedLegacyKasper.legacyCommentCalls.length, 0);
  const successfulLegacyKasper = await runKasperTweakCase({ gateway: false, saveOk: true });
  assert.deepStrictEqual(successfulLegacyKasper.events, [
    'route:comment:legacy', 'route:status:legacy', 'save', 'legacy:status', 'legacy:comment'
  ]);
  assert.strictEqual(successfulLegacyKasper.legacyStatusCalls.length, 1);
  assert.strictEqual(successfulLegacyKasper.legacyCommentCalls.length, 1);
  const successfulGatewayKasper = await runKasperTweakCase({ gateway: true, saveOk: true });
  assert.deepStrictEqual(successfulGatewayKasper.events, [
    'route:comment:gateway', 'gateway:comment', 'route:status:gateway', 'gateway:status', 'save'
  ]);
  assert.strictEqual(successfulGatewayKasper.gatewayCalls.length, 2);
  assert.strictEqual(successfulGatewayKasper.legacyStatusCalls.length, 0);
  assert.strictEqual(successfulGatewayKasper.legacyCommentCalls.length, 0);

  console.log('samples legacy save order tests passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
