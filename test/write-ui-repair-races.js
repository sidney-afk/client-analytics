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

function extractUntil(name, nextName) {
  const startMarker = 'function ' + name + '(';
  let start = source.indexOf(startMarker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  let end = source.indexOf('function ' + nextName + '(', start + startMarker.length);
  assert(end > start, 'missing boundary ' + nextName + ' after ' + name);
  if (source.slice(end - 6, end) === 'async ') end -= 6;
  return source.slice(start, end);
}

const clone = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const failures = [];

async function runCase(name, fn) {
  try {
    await fn();
    console.log('ok - ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.error('not ok - ' + name + ': ' + error.message);
  }
}

async function pendingMetadataCase(surface) {
  const ref = { key: surface + '-repair', token: surface + '-token' };
  const bucket = {
    video_status: 'Approved',
    _writeUiPrecommittedNative: true,
    _writeUiRepairRefs: [ref]
  };
  const isCalendar = surface === 'calendar';
  const ctx = isCalendar ? {
    _calPendingEdits: { card: bucket },
    _calSaveInFlight: { card: Promise.resolve() },
    _calAwaitCardSave: async () => 'waiting',
    calState: { client: 'fixture', posts: [{ id: 'card' }] },
    calClientSlug: () => 'fixture',
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _writeUiAppendRepairRef: (refs, value) => { if (value) refs.push(value); return refs; },
    _writeUiSnapshotRepairRefs: () => [],
    Object, Array, Promise
  } : {
    _sxrPendingEdits: { card: bucket },
    _sxrSaveInFlight: { card: Promise.resolve() },
    _sxrAwaitCardSave: async () => 'waiting',
    sxrState: { client: 'fixture', posts: [{ id: 'card' }] },
    Object, Array, Promise
  };
  vm.createContext(ctx);
  vm.runInContext(extract('_writeUiSourceEditsOnly'), ctx);
  vm.runInContext(isCalendar
    ? extractUntil('_calFlushCardSave', '_calRetrySave')
    : extractUntil('_sxrFlushCardSave', '_sxrRetrySave'), ctx);
  await ctx[isCalendar ? '_calFlushCardSave' : '_sxrFlushCardSave']('card');
  assert.strictEqual(bucket._writeUiPrecommittedNative, true,
    surface + ' must not consume trailing precommit metadata while another save owns the card');
  assert.deepStrictEqual(clone(bucket._writeUiRepairRefs), [ref],
    surface + ' must not consume trailing repair refs while another save owns the card');
}

async function cacheOnlyRetryBlockedCase(surface) {
  const isCalendar = surface === 'calendar';
  const pending = { caption: 'newer edit' };
  const post = {
    id: 'card',
    _writeUiRetrySourceAt: '2026-07-12T00:00:00Z',
    _writeUiRetryPrincipal: 'staff:fixture:smm',
    _writeUiRetryEdits: { video_status: 'Tweaks Needed' },
    _writeUiRepairRefs: [{ key: 'missing', token: 'missing' }]
  };
  let sourceWrites = 0;
  const common = {
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _writeUiJournalCoversRepairRefs: () => false,
    _writeUiQueueDiagnostic: () => {},
    Object, Array, Promise
  };
  const ctx = isCalendar ? {
    ...common,
    _calPendingEdits: { card: pending }, _calSaveInFlight: {},
    calState: { client: 'fixture', posts: [post] }, calClientSlug: () => 'fixture',
    _calCacheWrite: () => true, _calRenderBody: () => {},
    _calUpsertFetch: async () => { sourceWrites++; }
  } : {
    ...common,
    _sxrPendingEdits: { card: pending }, _sxrSaveInFlight: {},
    sxrState: { client: 'fixture', posts: [post] }, sxrClientSlug: () => 'fixture',
    _sxrCacheWrite: () => true, _sxrRenderBody: () => {},
    _sxrUpsertFetch: async () => { sourceWrites++; }
  };
  vm.createContext(ctx);
  vm.runInContext(extract('_writeUiSourceEditsOnly'), ctx);
  vm.runInContext(isCalendar
    ? extractUntil('_calFlushCardSave', '_calRetrySave')
    : extractUntil('_sxrFlushCardSave', '_sxrRetrySave'), ctx);
  await ctx[isCalendar ? '_calFlushCardSave' : '_sxrFlushCardSave']('card');
  assert.strictEqual(sourceWrites, 0, surface + ' cache-only debt must not reach a source writer');
  assert.strictEqual(ctx[isCalendar ? '_calPendingEdits' : '_sxrPendingEdits'].card, undefined,
    surface + ' removes the retry bucket so flush-all cannot spin');
  assert.strictEqual(post._writeUiHeldSourceEdits.caption, 'newer edit',
    surface + ' preserves newer local edits in the held diagnostic checkpoint');
}

async function calendarKasperCacheOnlyBlockedCase() {
  let sourceWrites = 0;
  const ctx = {
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _writeUiJournalCoversRepairRefs: () => false,
    _writeUiQueueDiagnostic: () => {},
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _calUpsertFetch: async () => { sourceWrites++; },
    Object, Array, Promise
  };
  vm.createContext(ctx);
  vm.runInContext(extractUntil('_kasperPersistPostWrite', '_kasperOnPanelDraftInput'), ctx);
  const item = { slug: 'fixture', post: {
    id: 'card', _writeUiRetrySourceAt: '2026-07-12T00:00:00Z',
    _writeUiRetryPrincipal: 'staff:fixture:smm'
  } };
  await assert.rejects(() => ctx._kasperPersistPostWrite(item, {}), /source_repair_receipt_required/);
  assert.strictEqual(sourceWrites, 0, 'Calendar Kasper cache-only debt cannot reach source persistence');
}

async function sxrKasperCommentFirstCase() {
  let commentCalls = 0, statusCalls = 0, sourceWrites = 0;
  const post = { id: 'card', video_status: 'Kasper Approval', video_comments: [] };
  const item = { slug: 'fixture', post };
  const ctx = {
    _sxrKasperState: { items: [item], saving: {}, drafts: {}, errors: {} },
    _kasperState: { sxrRepairs: [] },
    _sxrKasperFindItem: () => item,
    _sxrKasperRepaint: () => {}, _sxrLastLocalWriteAt: 0,
    _sxrCommentsFor: value => value.video_comments || [],
    _sxrMsgIsTweak: () => true,
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _kasperPersistCache: () => true,
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _sxrLinearUrlFor: () => 'https://linear.invalid/VID-1',
    _sxrPostLinearComment: async () => { commentCalls++; throw Object.assign(new Error('operation_forbidden'), { status: 403 }); },
    _sxrPushStatusToLinear: async () => { statusCalls++; return { native_committed: true }; },
    _sxrKasperPersist: async () => { sourceWrites++; },
    _writeUiReportFailure: () => {},
    JSON, Date, Object, Array, Set, Promise, console
  };
  vm.createContext(ctx);
  vm.runInContext(extractUntil('_sxrKasperApplyAndPersist', '_sxrKasperResumeSourceRepairs'), ctx);
  await ctx._sxrKasperApplyAndPersist('card', 'video', value => {
    value.video_status = 'Tweaks Needed';
    value.video_comments = [{ id: 'comment-1', body: 'change', author: 'Kasper' }];
    return { video_status: 'Tweaks Needed', video_tweaks: '[{"id":"comment-1"}]' };
  }, 'change', null);
  assert.strictEqual(commentCalls, 1, 'SXR Kasper attempts the composite comment first; state=' + JSON.stringify(ctx._sxrKasperState));
  assert.strictEqual(statusCalls, 0, 'a rejected comment cannot commit the companion status');
  assert.strictEqual(sourceWrites, 0, 'a rejected comment cannot leak through the Samples source patch');
}

async function kasperInvocationIsolationCase() {
  const post = { id: 'card', video_status: 'Kasper Approval', graphic_status: 'Kasper Approval' };
  const item = { slug: 'fixture', post };
  const persistResolvers = {};
  const completed = [];
  const ctx = {
    _sxrKasperState: { items: [item], saving: {}, drafts: {} },
    _kasperState: { sxrRepairs: [] },
    _sxrKasperFindItem: () => item,
    _sxrKasperRepaint: () => {},
    _sxrLastLocalWriteAt: 0,
    _sxrCommentsFor: () => [],
    _writeUiPrincipalKey: () => 'staff:fixture:smm',
    _kasperPersistCache: () => true,
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _sxrLinearUrlFor: (_post, component) => 'https://linear.invalid/' + component,
    _sxrPushStatusToLinear: async (_url, _status, meta) => ({
      ok: true,
      native_committed: true,
      source_repair: { key: 'repair-' + meta.component, token: 'token-' + meta.component }
    }),
    _writeUiAdoptReplayStatus: () => '',
    _sxrKasperPersist: (_item, patch) => new Promise(resolve => {
      const component = Object.prototype.hasOwnProperty.call(patch, 'graphic_status') ? 'graphic' : 'video';
      persistResolvers[component] = resolve;
    }),
    _writeUiCompleteSourceRepairRefs: async refs => { completed.push(clone(refs)); return true; },
    _sxrKasperStateError: null,
    _writeUiReportFailure: () => {},
    JSON, Date, Object, Array, Set, Promise, console
  };
  vm.createContext(ctx);
  for (const name of ['_writeUiAppendRepairRef', '_writeUiAdoptRepairAck', '_writeUiSnapshotRepairRefs',
    '_writeUiRemoveCompletedRepairRefs']) vm.runInContext(extract(name), ctx);
  vm.runInContext(extractUntil('_sxrKasperApplyAndPersist', '_sxrKasperResumeSourceRepairs'), ctx);

  const video = ctx._sxrKasperApplyAndPersist('card', 'video', value => {
    value.video_status = 'Approved';
    return { video_status: 'Approved' };
  }, '', null);
  const graphic = ctx._sxrKasperApplyAndPersist('card', 'graphic', value => {
    value.graphic_status = 'Approved';
    return { graphic_status: 'Approved' };
  }, '', null);

  for (let i = 0; i < 10 && (!persistResolvers.video || !persistResolvers.graphic); i++) await tick();
  assert(persistResolvers.video && persistResolvers.graphic, 'both Kasper source saves reached the controlled in-flight point');
  persistResolvers.graphic({ ok: true });
  await tick();
  assert.deepStrictEqual(completed[0], [{ key: 'repair-graphic', token: 'token-graphic' }],
    'the first completed Kasper invocation must clear only its own gateway ref');
  persistResolvers.video({ ok: true });
  await Promise.all([video, graphic]);
}

async function calendarKasperInvocationIsolationCase() {
  const firstRef = { key: 'calendar-first', token: 'token-first' };
  const secondRef = { key: 'calendar-second', token: 'token-second' };
  const item = { post: { id: 'card' } };
  const invocations = [];
  const resolvers = [];
  const ctx = {
    _kasperPersistPostWrite: (_item, repairContext) => new Promise(resolve => {
      invocations.push(clone(repairContext));
      resolvers.push(resolve);
    }),
    Promise, Array
  };
  vm.createContext(ctx);
  vm.runInContext(extract('_kasperPersistPost'), ctx);
  const first = ctx._kasperPersistPost(item, { precommitted: true, refs: [firstRef] });
  const second = ctx._kasperPersistPost(item, { precommitted: true, refs: [secondRef] });
  for (let i = 0; i < 10 && invocations.length < 1; i++) await tick();
  assert.deepStrictEqual(invocations[0].refs, [firstRef], 'first queued Calendar Kasper persist owns only its ref');
  resolvers[0]();
  for (let i = 0; i < 10 && invocations.length < 2; i++) await tick();
  assert.deepStrictEqual(invocations[1].refs, [secondRef], 'second queued Calendar Kasper persist owns only its ref');
  resolvers[1]();
  await Promise.all([first, second]);
}

async function resumeExactRefBindingCase() {
  const calRef = { key: 'repair-cal', token: 'token-cal' };
  const sxrRef = { key: 'repair-sxr', token: 'token-sxr' };
  const calPost = { id: 'cal-card', _writeUiRepairRefs: [{ key: 'repair-other-cal', token: 'token-other-cal' }] };
  const sxrPost = { id: 'sxr-card', _writeUiRepairRefs: [{ key: 'repair-other-sxr', token: 'token-other-sxr' }] };
  const capturedPending = {};
  let receiptReads = 0;
  let mutationCalls = 0;
  const ctx = {
    calState: { client: 'fixture', posts: [calPost] },
    sxrState: { client: 'fixture', posts: [sxrPost] },
    calClientSlug: () => 'fixture',
    sxrClientSlug: () => 'fixture',
    _calPendingEdits: {},
    _sxrPendingEdits: {},
    _writeUiApplyJournalEdits: (value, edits) => { Object.assign(value, edits); return Object.assign({}, edits); },
    _calFlushCardSave: async id => { capturedPending.calendar = clone(ctx._calPendingEdits[id]); },
    _sxrFlushCardSave: async id => { capturedPending.sxr = clone(ctx._sxrPendingEdits[id]); },
    _writeUiReadRepairReceipt: async () => {
      receiptReads++;
      return { ok: true, outcome: 'committed_exact', row: { status: 'approved' } };
    },
    _writeUiAdoptRepairReceipt: async (_group, intent, post) => {
      const refs = Array.isArray(post._writeUiRepairRefs) ? post._writeUiRepairRefs : [];
      ctx._writeUiAppendRepairRef(refs, { key: intent._repair_key, token: intent._repair_token });
      post._writeUiRepairRefs = refs;
      intent.reconciled = true;
    },
    _writeUiReplayPinnedIntent: async () => { mutationCalls++; },
    _writeUiReadCurrentNativeStatus: async () => { mutationCalls++; },
    _writeUiMarkRepairCommitted: async () => { mutationCalls++; },
    _calPushStatusToLinear: async () => { mutationCalls++; },
    _sxrPushStatusToLinear: async () => { mutationCalls++; },
    _calPostLinearComment: async () => { mutationCalls++; },
    _sxrPostLinearComment: async () => { mutationCalls++; },
    JSON, Date, Object, Array, Set, Promise
  };
  vm.createContext(ctx);
  for (const name of ['_writeUiAppendRepairRef', '_writeUiAdoptRepairAck', '_writeUiReplayRepairIntents',
    '_writeUiReplayJournalGroup']) vm.runInContext(extract(name), ctx);

  const group = (surface, postId, ref) => ({
    surface, lane: 'card', client_slug: 'fixture', post_id: postId,
    source_at: '2026-07-12T00:00:00Z', edits: { caption: 'recovered' }, refs: [ref],
    intents: [{ key: 'comment:video:one', operation: 'comment', component: 'video',
      attempted: true, native_committed: true, gateway_payload: '{"local":"hint-only"}',
      _repair_key: ref.key, _repair_token: ref.token }]
  });
  await ctx._writeUiReplayJournalGroup(group('calendar', 'cal-card', calRef), 'staff:fixture:smm');
  await ctx._writeUiReplayJournalGroup(group('sxr', 'sxr-card', sxrRef), 'staff:fixture:smm');

  assert.deepStrictEqual(capturedPending.calendar._writeUiRepairRefs, [calRef],
    'Calendar resume must bind exactly the journal group refs into this source-save attempt');
  assert.deepStrictEqual(capturedPending.sxr._writeUiRepairRefs, [sxrRef],
    'Samples resume must bind exactly the journal group refs into this source-save attempt');
  assert.strictEqual(receiptReads, 2, 'each attempted local hint is authenticated before its source patch is resumed');
  assert.strictEqual(mutationCalls, 0, 'exact authenticated receipts need no blind journal-time mutation replay');
}

function createReceiptReplayHarness(options) {
  const state = {
    receiptRequests: [], nativeReads: 0, marks: [],
    mutations: { blind: 0, status: 0, comment: 0 }, commentCalls: []
  };
  const mergeComments = (current, incoming) => {
    const rows = new Map((current || []).map(row => [String(row.id || ''), clone(row)]));
    (incoming || []).forEach(row => rows.set(String(row.id || ''), clone(row)));
    return Array.from(rows.values());
  };
  const ctx = {
    WRITE_UI_PRODUCTION_WRITE_URL: 'https://gateway.invalid',
    CAL_SUPABASE_URL: 'https://supabase.invalid', CAL_SUPABASE_ANON_KEY: 'anon',
    _writeUiHasCredential: () => true,
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _syncviewEfHeaders: headers => headers,
    _calLinearUrlFor: (_post, component) => 'https://linear.invalid/calendar/' + component,
    _sxrLinearUrlFor: (_post, component) => 'https://linear.invalid/sxr/' + component,
    fetch: async (url, request) => {
      if (url === 'https://gateway.invalid') {
        const payload = JSON.parse(request.body);
        state.receiptRequests.push(clone(payload));
        const value = clone(typeof options.receipt === 'function' ? options.receipt(payload) : options.receipt);
        value.row = Object.assign({
          id: 'native-video', client_slug: 'fixture', team: 'video', card_id: 'card'
        }, value.row || {});
        return { ok: true, status: 200, json: async () => clone(value) };
      }
      state.nativeReads++;
      return { ok: true, status: 200, json: async () => clone(options.currentRows || []) };
    },
    _writeUiReplayPinnedIntent: async () => { state.mutations.blind++; throw new Error('blind replay'); },
    _calPushStatusToLinear: async () => { state.mutations.status++; throw new Error('status mutation'); },
    _sxrPushStatusToLinear: async () => { state.mutations.status++; throw new Error('status mutation'); },
    _calPostLinearComment: async (url, body, author, meta) => {
      state.mutations.comment++;
      state.commentCalls.push({ url, body, author, meta: clone(meta) });
      return clone(options.commentAck || {
        ok: true, native_committed: true,
        source_repair: { key: meta.repairRecord.key, token: meta.repairRecord.token }
      });
    },
    _sxrPostLinearComment: async (url, body, author, meta) => ctx._calPostLinearComment(url, body, author, meta),
    _writeUiRepairRecordForIntent: intent => ({
      key: intent._repair_key, token: intent._repair_token, primary_intent_key: intent.key
    }),
    _writeUiMarkRepairCommitted: async (record, response, markOptions) => {
      state.marks.push({ record: clone(record), response: clone(response), options: clone(markOptions) });
      return { key: record.key, token: record.token };
    },
    _calCommentsFor: (post, component) => post[component + '_comments'] || [],
    _sxrCommentsFor: (post, component) => post[component + '_comments'] || [],
    _calMergeCommentLists: mergeComments, _sxrMergeCommentLists: mergeComments,
    _calSetCommentsFor: (post, component, comments) => { post[component + '_comments'] = clone(comments); },
    _sxrSetCommentsFor: (post, component, comments) => { post[component + '_comments'] = clone(comments); },
    _calStringifyComments: JSON.stringify, _sxrStringifyComments: JSON.stringify,
    JSON, Date, String, Number, Object, Array, Set, Map, Promise
  };
  vm.createContext(ctx);
  for (const name of [
    '_writeUiNativeId', '_writeUiNativeStatus', '_writeUiDisplayStatus', '_writeUiTeam',
    '_writeUiAppendRepairRef', '_writeUiAdoptRepairAck', '_writeUiMaxSourceClock',
    '_writeUiValidatePinnedRepairPayload', '_writeUiReceiptMatchesSource', '_writeUiReadRepairReceipt',
    '_writeUiCanonicalSourceComment', '_writeUiAdoptRepairReceipt',
    '_writeUiReadCurrentNativeStatus', '_writeUiReconcileReplayStatus', '_writeUiReplayRepairIntents'
  ]) {
    vm.runInContext(extract(name), ctx);
  }
  return { ctx, state };
}

function statusRepairGroup(nativeCommitted) {
  const sourceAt = '2026-07-12T00:00:00Z';
  const ref = { key: 'repair-status', token: 'token-status' };
  return {
    surface: 'calendar', lane: 'card', client_slug: 'fixture', post_id: 'card',
    source_at: sourceAt, edits: { video_status: 'Approved' }, refs: [ref],
    intents: [{
      key: 'status:video:approved', operation: 'status', component: 'video', status: 'Approved',
      source_at: sourceAt, attempted: true, native_committed: nativeCommitted,
      gateway_payload: JSON.stringify({
        surface: 'calendar', operation: 'status', id: 'native-video',
        source_edited_at: sourceAt, status: 'approved'
      }),
      _repair_key: ref.key, _repair_token: ref.token
    }]
  };
}

async function committedExactReceiptCase() {
  const statusHarness = createReceiptReplayHarness({
    receipt: {
      ok: true, outcome: 'committed_exact',
      row: { id: 'native-video', status: 'in_progress', status_at: '2026-07-12T00:05:00Z' }
    }
  });
  const statusPost = { id: 'card', video_deliverable_id: 'native-video', video_status: 'Approved' };
  const statusGroup = statusRepairGroup(false);
  await statusHarness.ctx._writeUiReplayRepairIntents(statusGroup, statusPost);
  assert.strictEqual(statusHarness.state.receiptRequests.length, 1);
  assert.strictEqual(statusHarness.state.receiptRequests[0].reconcile_only, true,
    'receipt lookup is an authenticated reconcile-only gateway call');
  assert.strictEqual(statusPost.video_status, 'In Progress', 'exact status receipt adopts the current canonical row');
  assert.strictEqual(statusGroup.edits.video_status, 'In Progress', 'canonical status replaces the stale source patch');
  assert.strictEqual(statusHarness.state.marks[0].options.reason, 'committed_exact_receipt');
  assert.deepStrictEqual(clone(statusPost._writeUiRepairRefs), [{ key: 'repair-status', token: 'token-status' }]);
  assert.deepStrictEqual(statusHarness.state.mutations, { blind: 0, status: 0, comment: 0 });

  const sourceAt = '2026-07-12T01:00:00Z';
  const commentHarness = createReceiptReplayHarness({
    receipt: {
      ok: true, outcome: 'committed_exact', row: { id: 'native-video' },
      comment: {
        native_comment_id: 'native-comment-1', body: 'Canonical edited body',
        author_name: 'Stable Human', audience: 'client', source_created_at: sourceAt,
        edited_at: '2026-07-12T01:05:00Z'
      }
    }
  });
  const localComment = { id: 'native-comment-1', body: 'Stale local body', author: 'Transport', created_at: sourceAt };
  const commentPost = {
    id: 'card', video_deliverable_id: 'native-video', video_comments: [localComment]
  };
  const commentGroup = {
    surface: 'calendar', lane: 'card', client_slug: 'fixture', post_id: 'card', source_at: sourceAt,
    edits: { video_tweaks: JSON.stringify([localComment]) },
    refs: [{ key: 'repair-comment', token: 'token-comment' }],
    intents: [{
      key: 'comment:video:native-comment-1', operation: 'comment', component: 'video',
      source_at: sourceAt, attempted: true, native_committed: false, comment: localComment,
      gateway_payload: JSON.stringify({
        surface: 'calendar', operation: 'comment', id: 'native-video', source_edited_at: sourceAt,
        comment: { native_comment_id: 'native-comment-1', body: 'Stale local body' }
      }),
      _repair_key: 'repair-comment', _repair_token: 'token-comment'
    }]
  };
  await commentHarness.ctx._writeUiReplayRepairIntents(commentGroup, commentPost);
  assert.strictEqual(commentPost.video_comments[0].body, 'Canonical edited body');
  assert.strictEqual(commentPost.video_comments[0].author, 'Stable Human');
  assert.strictEqual(commentPost.video_comments[0].updated_at, '2026-07-12T01:05:00Z');
  assert(JSON.parse(commentGroup.edits.video_tweaks)[0].body === 'Canonical edited body',
    'exact comment receipt repairs the source with canonical body and author metadata');
  assert.deepStrictEqual(commentHarness.state.mutations, { blind: 0, status: 0, comment: 0 });
}

async function clearedHistoricalIssueReceiptCase() {
  const { ctx, state } = createReceiptReplayHarness({
    receipt: {
      ok: true, outcome: 'committed_exact',
      row: { id: 'resolved-native-video', status: 'approved', status_at: '2026-07-12T03:05:00Z' }
    }
  });
  const sourceAt = '2026-07-12T03:00:00Z';
  const group = statusRepairGroup(true);
  group.source_at = sourceAt;
  group.intents[0].source_at = sourceAt;
  group.intents[0].gateway_payload = JSON.stringify({
    surface: 'calendar', operation: 'status', legacy_parity: true,
    issue: 'https://linear.invalid/VID-legacy', source_edited_at: sourceAt, status: 'approved'
  });
  const post = { id: 'card', video_status: 'Approved', linear_issue_id: '' };
  await ctx._writeUiReplayRepairIntents(group, post);
  assert.strictEqual(state.receiptRequests.length, 1,
    'a cleared current Linear URL does not prevent an authenticated historical receipt lookup');
  assert.strictEqual(state.receiptRequests[0].issue, 'https://linear.invalid/VID-legacy');
  assert.strictEqual(state.mutations.blind, 0);
}

async function absentStatusRetainsDebtCase() {
  const { ctx, state } = createReceiptReplayHarness({
    receipt: { ok: true, outcome: 'absent' },
    currentRows: [{ id: 'native-video', status: 'approved', status_at: '2026-07-11T23:59:00Z' }]
  });
  const group = statusRepairGroup(true);
  const post = { id: 'card', video_deliverable_id: 'native-video', video_status: 'Approved' };
  await assert.rejects(ctx._writeUiReplayRepairIntents(group, post), error =>
    error && error.status === 409 && error.code === 'status_reapply_required');
  assert.strictEqual(state.receiptRequests.length, 1, 'the attempted intent checks its server receipt despite local native_committed=true');
  assert.strictEqual(state.receiptRequests[0].reconcile_only, true);
  assert.strictEqual(state.nativeReads, 1, 'absence falls back to one read of native truth');
  assert.strictEqual(state.marks.length, 0, 'an absent, unsuperseded status retains repair debt');
  assert.deepStrictEqual(state.mutations, { blind: 0, status: 0, comment: 0 },
    'an absent status receipt never replays a pinned or current-lane mutation');
  assert.strictEqual(post.video_status, 'Approved');
}

async function newerStatusSupersedesAbsentReceiptCase() {
  const { ctx, state } = createReceiptReplayHarness({
    receipt: { ok: true, outcome: 'absent' },
    currentRows: [{ id: 'native-video', status: 'in_progress', status_at: '2026-07-12T00:10:00Z' }]
  });
  const group = statusRepairGroup(true);
  const post = { id: 'card', video_deliverable_id: 'native-video', video_status: 'Approved' };
  await ctx._writeUiReplayRepairIntents(group, post);
  assert.strictEqual(post.video_status, 'In Progress');
  assert.strictEqual(group.edits.video_status, 'In Progress');
  assert.strictEqual(state.marks.length, 1);
  assert.strictEqual(state.marks[0].options.reason, 'newer_native_status');
  assert.deepStrictEqual(state.mutations, { blind: 0, status: 0, comment: 0 },
    'a newer native status resolves the debt read-only');
}

async function absentCommentReissuesCurrentLaneCase() {
  const { ctx, state } = createReceiptReplayHarness({ receipt: { ok: true, outcome: 'absent' } });
  const sourceAt = '2026-07-12T02:00:00Z';
  const comment = { id: 'native-comment-2', body: 'Please revise', author: 'Stable Human', created_at: sourceAt };
  const group = {
    surface: 'calendar', lane: 'card', client_slug: 'fixture', post_id: 'card',
    source_at: sourceAt, edits: { video_tweaks: JSON.stringify([comment]) },
    refs: [{ key: 'repair-comment-2', token: 'token-comment-2' }],
    intents: [{
      key: 'comment:video:native-comment-2', operation: 'comment', component: 'video',
      source_at: sourceAt, attempted: true, native_committed: true, comment,
      comment_meta: { audience: 'internal', is_tweak: true, round: 2 },
      gateway_payload: JSON.stringify({
        surface: 'calendar', operation: 'comment', id: 'native-video', source_edited_at: sourceAt,
        comment: { native_comment_id: comment.id, body: comment.body }
      }),
      _repair_key: 'repair-comment-2', _repair_token: 'token-comment-2'
    }]
  };
  const post = { id: 'card', video_deliverable_id: 'native-video' };
  await ctx._writeUiReplayRepairIntents(group, post);
  assert.strictEqual(state.receiptRequests.length, 1);
  assert.strictEqual(state.mutations.comment, 1,
    'exact absence permits one idempotent append-only comment through the current authority lane');
  assert.strictEqual(state.mutations.blind, 0, 'the stored pinned mutation envelope is never replayed blindly');
  assert.strictEqual(state.commentCalls[0].meta.comment.id, comment.id);
  assert.strictEqual(state.commentCalls[0].meta.repairRecord.primary_intent_key, group.intents[0].key);
  assert.deepStrictEqual(clone(post._writeUiRepairRefs), [{ key: 'repair-comment-2', token: 'token-comment-2' }]);
}

(async () => {
  await runCase('Calendar keeps trailing pending repair metadata while a save is in flight', () => pendingMetadataCase('calendar'));
  await runCase('Samples keeps trailing pending repair metadata while a save is in flight', () => pendingMetadataCase('sxr'));
  await runCase('Calendar cache-only retry debt is held outside the source funnel', () => cacheOnlyRetryBlockedCase('calendar'));
  await runCase('Samples cache-only retry debt is held outside the source funnel', () => cacheOnlyRetryBlockedCase('sxr'));
  await runCase('Calendar Kasper cache-only retry debt is blocked', calendarKasperCacheOnlyBlockedCase);
  await runCase('Samples Kasper composite tweak commits comment before status', sxrKasperCommentFirstCase);
  await runCase('concurrent Kasper invocations complete only their own repair refs', kasperInvocationIsolationCase);
  await runCase('queued Calendar Kasper invocations retain separate repair contexts', calendarKasperInvocationIsolationCase);
  await runCase('journal resume binds the exact group refs into the source save', resumeExactRefBindingCase);
  await runCase('authenticated exact receipts adopt canonical status and comment state', committedExactReceiptCase);
  await runCase('cleared stale Linear URL still reconciles by bound historical receipt', clearedHistoricalIssueReceiptCase);
  await runCase('absent status ignores local commit hints and retains debt without mutation', absentStatusRetainsDebtCase);
  await runCase('newer native status supersedes absent receipt read-only', newerStatusSupersedesAbsentReceiptCase);
  await runCase('absent comment reissues once through the current authority lane', absentCommentReissuesCurrentLaneCase);

  if (failures.length) {
    console.error('\n' + failures.length + ' write-UI repair race regression(s) failed');
    process.exit(1);
  }
  console.log('\nwrite UI repair race checks passed');
})().catch(error => { console.error(error); process.exit(1); });
