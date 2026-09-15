'use strict';

/*
 * Canonical card-comment mark-done CAS contract.
 *
 * A resolve is idempotent and body-free, so it may refresh immediately before
 * writing and perform one conflict rebase. Text edits, deletes and reopen must
 * never inherit that automatic retry. The Calendar/Samples "stay" destination
 * also remains a comment-only action: it may project the resolved thread to the
 * legacy card column, but it cannot move status or call a status gateway.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function extractFunction(name) {
  const marker = 'function ' + name;
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing function ' + name);
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
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
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
  throw new Error('unterminated function ' + name);
}

function extractIife(name) {
  const marker = 'const ' + name + ' = (() => {';
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing IIFE ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
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
    else if (ch === '}' && --depth === 0) {
      const end = source.indexOf('})();', i);
      assert(end >= 0, 'unterminated IIFE call ' + name);
      return source.slice(start, end + 5);
    }
  }
  throw new Error('unterminated IIFE ' + name);
}

async function proveStrictReaderReplacement() {
  let serverRound = 1;
  const requests = [];
  const normalize = row => Object.assign({}, row, {
    row_updated_at: String(row.updated_at || ''),
    version: Number(row.version || 1),
    done: !!String(row.resolved_at || ''),
    hidden: false,
  });
  const ctx = {
    console: { warn() {} },
    CAL_SUPABASE_ANON_KEY: 'anon',
    PROD_COMMENTS_EF_URL: 'https://example.invalid/production-comments',
    PROD_COMMENTS_PAGE_SIZE: 50,
    _isClientLink: false,
    _prodRender() {},
    _prodClientCommentSurfaceKey: () => '',
    _syncviewEfHeaders: headers => headers,
    _syncviewStaffIdentityForHeaders: () => ({ key: 'staff' }),
    _prodCommentMerge: (existing, incoming) => {
      const rows = new Map();
      for (const row of [].concat(existing || [], incoming || [])) rows.set(String(row.id), normalize(row));
      return Array.from(rows.values());
    },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ round: serverRound, before: body.before });
      const older = !!body.before;
      const payload = older
        ? {
            comments: serverRound === 1
              ? [
                  { id: 'older', body: 'cached resolved', updated_at: '2026-08-05T10:00:00.000Z', version: 1, resolved_at: '2026-08-05T10:00:00.000Z' },
                  { id: 'cached-only', body: 'removed before strict reread', updated_at: '2026-08-05T09:55:00.000Z', version: 1 },
                ]
              : [{ id: 'older', body: 'reopened remotely', updated_at: '2026-08-05T10:05:00.000Z', version: 2, resolved_at: '' }],
            next_cursor: null,
            has_more: false,
          }
        : {
            comments: [{ id: 'newest', body: 'newest page', updated_at: '2026-08-05T10:10:00.000Z', version: serverRound }],
            next_cursor: { created_at: '2026-08-05T10:00:00.000Z', id: 'older' },
            has_more: true,
          };
      return { ok: true, status: 200, json: async () => payload };
    },
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('_prodFeedbackState') + '\n' + extractIife('_prodComments') + '\nthis.__reader = _prodComments;', ctx);
  await ctx.__reader.readCanonical('deliverable-1');
  assert.strictEqual(ctx.__reader.find('deliverable-1', 'older').done, true);
  assert.strictEqual(requests.length, 2);
  serverRound = 2;
  await ctx.__reader.readCanonical('deliverable-1', { replace: true });
  const current = ctx.__reader.find('deliverable-1', 'older');
  assert.strictEqual(requests.length, 4, 'strict read reused the exhausted cached deep cursor');
  assert.strictEqual(current.body, 'reopened remotely');
  assert.strictEqual(current.done, false);
  assert.strictEqual(current.version, 2);
  assert.strictEqual(current.row_updated_at, '2026-08-05T10:05:00.000Z');
  assert.strictEqual(ctx.__reader.find('deliverable-1', 'cached-only'), null, 'strict read retained a row absent from the new snapshot');
}

function gatewayError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

function comment(version, updatedAt, extra) {
  return Object.assign({
    id: 'comment-1', parent_id: '', component: 'video', body: 'Please tighten this cut.',
    version, row_updated_at: updatedAt, canonical_updated_at: updatedAt,
    can_resolve: true, can_edit: true, can_delete: true, done: false,
  }, extra || {});
}

function makeLifecycleHarness(options) {
  const opts = options || {};
  const targetSurface = opts.surface === 'sxr' ? 'sxr' : 'calendar';
  const post = {
    id: 'card-1', client: 'acme', video_deliverable_id: 'deliverable-1',
    _canonicalCommentReads: { 'deliverable-1': { status: 'ready' } },
  };
  let identity = { key: 'smm-key', role: 'smm', member: { id: 'member-1' } };
  let current = comment(1, '2026-08-05T10:00:00.000Z');
  const reads = (opts.reads || []).slice();
  const writes = [];
  const order = [];
  const reports = [];
  const readOptions = [];
  const autoStatus = [];
  const toggles = [];
  const persisted = [];
  let writeIndex = 0;
  const otherPost = Object.assign({}, post);

  const ctx = {
    console: { warn() {} },
    Date,
    _isClientLink: false,
    _syncviewStaffVerificationEpoch: 7,
    calState: { posts: [targetSurface === 'calendar' ? post : otherPost] },
    sxrState: { posts: [targetSurface === 'sxr' ? post : otherPost] },
    _syncviewStaffIdentityForHeaders: () => identity,
    _syncviewStaffIdentitySignature: value => value && value.key && value.member && value.member.id
      ? [value.key, value.role || '', value.member.id].join('\u0000') : '',
    _writeUiGatewayError: gatewayError,
    _writeUiNativeId: row => String(row && row.video_deliverable_id || ''),
    _prodCardBindingToken: (surface, row, components) => [surface, row.id]
      .concat((components || []).map(component => component + '=' + row.video_deliverable_id)).join('|'),
    _prodCanonicalCommentGate: row => ({
      linked: !!(row && row.video_deliverable_id), ready: true, client: false, status: 'ready',
    }),
    _prodVerifiedClientCommentMutationContext: () => null,
    _writeUiTeam: () => 'video',
    _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
    _writeUiGatewayWithRepair: async payload => {
      order.push('write');
      writes.push(payload);
      const outcome = (opts.writeOutcomes || [])[writeIndex++];
      if (outcome) throw gatewayError(outcome.status, outcome.code);
      return { ok: true, comment: Object.assign({}, current, { done: true }) };
    },
    _prodComments: {
      readCanonical: async (id, options) => {
        order.push('read');
        readOptions.push(Object.assign({}, options || {}));
        const next = reads.length ? reads.shift() : { row: current };
        if (next.row) current = Object.assign({}, next.row);
        if (typeof next.afterRead === 'function') next.afterRead({
          post,
          setIdentity: value => { identity = value; },
          bumpVerificationEpoch: () => { ctx._syncviewStaffVerificationEpoch += 1; },
          replacePost: (surface, value) => { ctx[surface === 'calendar' ? 'calState' : 'sxrState'].posts[0] = value; },
        });
        return next.thread || { status: 'ready', hasMore: false, cursor: null, items: [current] };
      },
      find: (deliverableId, id) => deliverableId === 'deliverable-1' && String(id) === String(current.id)
        ? Object.assign({}, current) : null,
      adopt: () => { order.push('adopt'); },
    },
    _prodProjectCanonicalCardComments: async () => { order.push('project'); return true; },
    _writeUiPersistCanonicalCommentProjection: async (...args) => { persisted.push(args); },
    _calApplyAutoStatus: (...args) => autoStatus.push(['calendar'].concat(args)),
    _sxrApplyAutoStatus: (...args) => autoStatus.push(['sxr'].concat(args)),
    _calToggleCommentDone: (...args) => toggles.push(['calendar'].concat(args)),
    _sxrToggleCommentDone: (...args) => toggles.push(['sxr'].concat(args)),
    _calDeleteComment() {}, _sxrDeleteComment() {},
    _calRetryCommentEdit() {}, _sxrRetryCommentEdit() {},
    _writeUiReportFailure: (surface, operation, error) => reports.push({ surface, operation, code: error.code }),
    _calOpenCommentsPid: null,
    _sxrOpenCommentsPid: null,
    _calRenderCommentsModal() {},
    _sxrRenderCommentsModal() {},
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFunction('_writeUiCardCommentLifecycle'),
    extractFunction('_writeUiCurrentCardCommentForResolve'),
    extractFunction('_writeUiResolveCardComment'),
    extractFunction('_writeUiCommitCardCommentLifecycle'),
    extractFunction('_writeUiRetryCardCommentResolve'),
    extractFunction('_writeUiRetryCardCommentAction'),
  ].join('\n'), ctx);
  return { ctx, post, writes, order, reports, readOptions, autoStatus, toggles, persisted };
}

function makeStayHarness(surface) {
  const row = comment(3, '2026-08-05T10:03:00.000Z', { canonical: true, is_tweak: true });
  const post = {
    id: 'card-1', status: 'Tweaks Needed', video_status: 'Tweaks Needed',
    video_deliverable_id: 'deliverable-1', comments: [row], video_comments: [row],
  };
  const calls = { chooser: 0, lifecycle: [], autoStatus: [], projection: 0, legacySave: 0 };
  let choosePromise = null;
  const ctx = {
    calState: { posts: [post] }, sxrState: { posts: [post] },
    _calOpenTweaksForComp: () => [row], _sxrOpenTweaksForComp: () => [row],
    _calResolveDestRecommend: () => 'client', _sxrResolveDestRecommend: () => 'client',
    _calResolveDestReason: () => '', _sxrResolveDestReason: () => '',
    _calShowResolveDest: options => {
      calls.chooser++;
      choosePromise = options.onChoose('stay', [row.id]);
    },
    _sxrShowResolveDest: options => {
      calls.chooser++;
      choosePromise = options.onChoose('stay', [row.id]);
    },
    _prodCanonicalCommentGate: () => ({ linked: true, ready: true }),
    _calCommentsFor: () => [row], _sxrCommentsFor: () => [row],
    _writeUiCommitCardCommentLifecycle: async (...args) => {
      calls.lifecycle.push(args);
      return { ok: true, comment: Object.assign({}, row, { done: true }) };
    },
    _calResolveTweaksDone() { throw new Error('canonical stay fell back to legacy Calendar resolve'); },
    _sxrResolveTweaksDone() { throw new Error('canonical stay fell back to legacy Samples resolve'); },
    _calApplyAutoStatus: (...args) => calls.autoStatus.push(args),
    _sxrApplyAutoStatus: (...args) => calls.autoStatus.push(args),
    _writeUiPersistCanonicalCommentProjection: async () => { calls.projection++; },
    _calWatchNoteSave: () => { calls.legacySave++; },
    _sxrWatchNoteSave: () => { calls.legacySave++; },
    _calRefreshCommentsBtn() {}, _sxrRefreshCommentsBtn() {},
    _calUpdateCardStatusDisplay() {}, _sxrUpdateCardStatusDisplay() {},
    _calCaptureModalDrafts() {}, _sxrCaptureModalDrafts() {},
    _calRenderCommentsModal() {}, _sxrRenderCommentsModal() {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction(surface === 'calendar' ? '_calResolveLastTweak' : '_sxrResolveLastTweak'), ctx);
  return {
    ctx, post, calls,
    async chooseStay() {
      ctx[surface === 'calendar' ? '_calResolveLastTweak' : '_sxrResolveLastTweak']('card-1', 'video', row.id);
      await choosePromise;
    },
  };
}

function makeProjectionHarness(surface) {
  const row = comment(3, '2026-08-05T10:03:00.000Z', { canonical: true, is_tweak: true, done: true });
  const post = {
    id: 'card-1', status: 'Owner-selected status', video_status: 'Tweaks Needed',
    graphic_status: 'Client Approval', video_deliverable_id: 'deliverable-1',
  };
  const pending = {};
  const saves = [];
  const ctx = {
    _isClientLink: false,
    _calPendingEdits: surface === 'calendar' ? pending : {},
    _sxrPendingEdits: surface === 'sxr' ? pending : {},
    _calCommentsFor: () => [row], _sxrCommentsFor: () => [row],
    _sxrCanonicalCommentsFor: () => [row],
    _calStringifyComments: rows => JSON.stringify(rows),
    _sxrStringifyComments: rows => JSON.stringify(rows),
    _calWatchNoteSave: async pid => saves.push(['calendar', pid]),
    _sxrWatchNoteSave: async pid => saves.push(['sxr', pid]),
    _calRefreshCommentsBtn() {}, _sxrRefreshCommentsBtn() {},
    _calUpdateCardStatusDisplay() {}, _sxrUpdateCardStatusDisplay() {},
    _calOpenCommentsPid: null, _sxrOpenCommentsPid: null,
    _calRenderCommentsModal() {}, _sxrRenderCommentsModal() {},
  };
  vm.createContext(ctx);
  vm.runInContext(extractFunction('_writeUiPersistCanonicalCommentProjection'), ctx);
  return { ctx, post, pending, saves };
}

(async () => {
  await proveStrictReaderReplacement();
  console.log('  ok  strict prewrite read discards and refetches every cached page');

  // The same shared helper owns Calendar and Samples.
  for (const surface of ['calendar', 'sxr']) {
    const fresh = comment(2, '2026-08-05T10:02:00.000Z');
    const h = makeLifecycleHarness({ surface, reads: [{ row: fresh }] });
    const receipt = await h.ctx._writeUiCommitCardCommentLifecycle(
      surface, h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z'), 'resolve',
    );
    assert(receipt && receipt.ok, surface + ' resolve did not succeed');
    assert.deepStrictEqual(h.order, ['read', 'write', 'adopt', 'project']);
    assert.strictEqual(h.writes.length, 1);
    const payload = h.writes[0];
    assert.strictEqual(payload.surface, surface);
    assert.strictEqual(payload.operation, 'comment');
    assert.strictEqual(payload.comment.action, 'resolve');
    assert.strictEqual(payload.comment.expected_version, 2);
    assert.strictEqual(payload.comment.expected_updated_at, '2026-08-05T10:02:00.000Z');
    assert.deepStrictEqual(h.readOptions, [{ replace: true }]);
    assert(!Object.prototype.hasOwnProperty.call(payload.comment, 'body'), 'resolve carried comment text');
    assert(!Object.prototype.hasOwnProperty.call(payload, 'status'), 'resolve carried card status');
  }
  console.log('  ok  Calendar and Samples reread the current CAS immediately before resolve');

  {
    const h = makeLifecycleHarness({
      reads: [
        { row: comment(2, '2026-08-05T10:02:00.000Z') },
        { row: comment(3, '2026-08-05T10:03:00.000Z') },
      ],
      writeOutcomes: [{ status: 409, code: 'write_conflict' }],
    });
    const receipt = await h.ctx._writeUiCommitCardCommentLifecycle(
      'calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z'), 'resolve',
    );
    assert(receipt && receipt.ok);
    assert.deepStrictEqual(h.order, ['read', 'write', 'read', 'write', 'adopt', 'project']);
    assert.strictEqual(h.writes.length, 2);
    assert.deepStrictEqual(h.writes.map(row => row.comment.expected_version), [2, 3]);
    assert.notStrictEqual(h.writes[0].requestId, h.writes[1].requestId, 'resolve rebase reused the stale intent id');
    assert.deepStrictEqual(h.readOptions.slice(0, 2), [{ replace: true }, { replace: true }]);
    assert(h.writes.every(row => row.comment.action === 'resolve' && !('body' in row.comment)));
  }
  console.log('  ok  one real write_conflict rereads and retries resolve exactly once');

  {
    const h = makeLifecycleHarness({
      reads: [
        { row: comment(2, '2026-08-05T10:02:00.000Z') },
        { row: comment(3, '2026-08-05T10:03:00.000Z') },
        { row: comment(4, '2026-08-05T10:04:00.000Z') },
      ],
      writeOutcomes: [
        { status: 409, code: 'write_conflict' },
        { status: 409, code: 'write_conflict' },
      ],
    });
    const receipt = await h.ctx._writeUiCommitCardCommentLifecycle(
      'calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z'), 'resolve',
    );
    assert.strictEqual(receipt, null);
    assert.strictEqual(h.writes.length, 2, 'resolve exceeded its one automatic retry');
    assert.strictEqual(h.reports.length, 1);
    assert.strictEqual(h.post._canonicalCommentActionError.message, 'write_conflict');
  }
  console.log('  ok  a second conflict fails closed after two total resolve attempts');

  {
    const h = makeLifecycleHarness({
      reads: [{ row: comment(2, '2026-08-05T10:02:00.000Z', { done: true }) }],
    });
    const receipt = await h.ctx._writeUiCommitCardCommentLifecycle(
      'calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z'), 'resolve',
    );
    assert(receipt && receipt.already_resolved === true);
    assert.strictEqual(h.writes.length, 0, 'already-resolved row created another lifecycle write');
  }
  console.log('  ok  an already-resolved row is adopted as idempotent success with zero write');

  {
    const h = makeLifecycleHarness({
      reads: [{
        row: comment(2, '2026-08-05T10:02:00.000Z'),
        afterRead: ({ setIdentity }) => setIdentity({ key: 'other', role: 'smm', member: { id: 'member-2' } }),
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment('calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  {
    const h = makeLifecycleHarness({
      reads: [{
        row: comment(2, '2026-08-05T10:02:00.000Z'),
        afterRead: ({ bumpVerificationEpoch }) => bumpVerificationEpoch(),
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment('calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  {
    const h = makeLifecycleHarness({
      reads: [{
        row: comment(2, '2026-08-05T10:02:00.000Z'),
        thread: { status: 'ready', hasMore: true, cursor: { created_at: 'x', id: 'y' } },
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment('calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  {
    const h = makeLifecycleHarness({
      reads: [{
        // The production reader deliberately preserves an old ready cache when
        // a forced refresh fails. That is useful for display, but it cannot be
        // accepted as the immediate pre-write canonical reread.
        thread: {
          status: 'ready', hasMore: false, cursor: null,
          refreshError: 'Comments could not refresh.',
        },
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment('calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  for (const surface of ['calendar', 'sxr']) {
    const h = makeLifecycleHarness({
      surface,
      reads: [{
        row: comment(2, '2026-08-05T10:02:00.000Z'),
        afterRead: ({ post, replacePost }) => replacePost(surface, Object.assign({}, post)),
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment(surface, h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  for (const surface of ['calendar', 'sxr']) {
    const h = makeLifecycleHarness({
      surface,
      reads: [{
        row: comment(2, '2026-08-05T10:02:00.000Z'),
        afterRead: ({ post }) => { post.video_deliverable_id = 'deliverable-2'; },
      }],
    });
    await assert.rejects(
      () => h.ctx._writeUiResolveCardComment(surface, h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z')),
      error => error && error.code === 'canonical_comment_read_required',
    );
    assert.strictEqual(h.writes.length, 0);
  }
  console.log('  ok  identity/binding drift, incomplete data, or a failed refresh blocks every write');

  for (const action of ['edit', 'delete', 'unresolve']) {
    const h = makeLifecycleHarness({
      reads: [{ row: comment(2, '2026-08-05T10:02:00.000Z') }],
      writeOutcomes: [{ status: 409, code: 'write_conflict' }],
    });
    const result = await h.ctx._writeUiCommitCardCommentLifecycle(
      'calendar', h.post, 'video', comment(1, '2026-08-05T10:00:00.000Z'), action,
      action === 'edit' ? 'My changed text' : undefined,
    );
    assert.strictEqual(result, null);
    assert.strictEqual(h.writes.length, 1, action + ' inherited the resolve automatic retry');
    assert.strictEqual(h.writes[0].comment.action, action);
  }
  console.log('  ok  edit/delete/unresolve conflicts perform one write and never auto-rebase/retry');

  for (const surface of ['calendar', 'sxr']) {
    const h = makeLifecycleHarness({
      surface,
      reads: [{ row: comment(3, '2026-08-05T10:03:00.000Z', { done: true }) }],
    });
    h.post._canonicalCommentActionError = {
      action: 'resolve', component: 'video', commentId: 'comment-1', resolveDestination: 'stay',
    };
    h.ctx._writeUiRetryCardCommentAction(surface, h.post.id);
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));
    assert.strictEqual(h.writes.length, 0, surface + ' manual resolve retry rewrote an already-resolved row');
    assert.strictEqual(h.toggles.length, 0, surface + ' manual resolve retry entered the reopen toggle');
    assert.strictEqual(h.autoStatus.length, 0, surface + ' stay retry moved status');
    assert.strictEqual(h.persisted.length, 1, surface + ' retry did not project the adopted resolved row');
  }
  console.log('  ok  manual Retry preserves resolve semantics and can never reopen an already-done row');

  for (const surface of ['calendar', 'sxr']) {
    const h = makeStayHarness(surface);
    const before = JSON.stringify({ status: h.post.status, video_status: h.post.video_status });
    await h.chooseStay();
    assert.strictEqual(h.calls.chooser, 1);
    assert.strictEqual(h.calls.lifecycle.length, 1);
    assert.strictEqual(h.calls.lifecycle[0][4], 'resolve');
    assert.strictEqual(h.calls.autoStatus.length, 0, surface + ' stay invoked a status transition');
    assert.strictEqual(h.calls.projection, 1, surface + ' stay omitted the legacy card projection');
    assert.strictEqual(h.calls.legacySave, 0, surface + ' canonical path also ran the legacy resolver save');
    assert.strictEqual(JSON.stringify({ status: h.post.status, video_status: h.post.video_status }), before);
  }

  for (const surface of ['calendar', 'sxr']) {
    const h = makeProjectionHarness(surface);
    const before = JSON.stringify({
      status: h.post.status,
      video_status: h.post.video_status,
      graphic_status: h.post.graphic_status,
    });
    await h.ctx._writeUiPersistCanonicalCommentProjection(surface, h.post, 'video');
    assert.deepStrictEqual(Object.keys(h.pending[h.post.id] || {}).sort(), ['video_tweaks']);
    assert.strictEqual(h.saves.length, 1);
    assert.strictEqual(JSON.stringify({
      status: h.post.status,
      video_status: h.post.video_status,
      graphic_status: h.post.graphic_status,
    }), before);
  }

  const projection = extractFunction('_writeUiPersistCanonicalCommentProjection');
  const applyStatus = extractFunction('_writeUiApplyOverallStatus');
  const calendarFlush = extractFunction('_calFlushCardSave');
  const samplesFlush = extractFunction('_sxrFlushCardSave');
  assert(/\[component \+ '_tweaks'\]/.test(projection));
  let calendarComputes = 0;
  let samplesComputes = 0;
  const statusCtx = {
    computeOverallStatus: () => { calendarComputes++; return 'Calendar computed'; },
    computeSampleOverallStatus: () => { samplesComputes++; return 'Samples computed'; },
  };
  vm.createContext(statusCtx);
  vm.runInContext(applyStatus, statusCtx);
  for (const surface of ['calendar', 'sxr']) {
    const post = { status: 'Owner-selected status' };
    const edits = { video_tweaks: '[]' };
    assert.strictEqual(statusCtx._writeUiApplyOverallStatus(surface, post, edits, false, true), false);
    assert.strictEqual(post.status, 'Owner-selected status');
    assert(!Object.prototype.hasOwnProperty.call(edits, 'status'));
  }
  assert.strictEqual(calendarComputes, 0);
  assert.strictEqual(samplesComputes, 0);
  const calendarPost = { status: 'Before' };
  const calendarEdits = { caption_status: 'Approved' };
  assert.strictEqual(statusCtx._writeUiApplyOverallStatus('calendar', calendarPost, calendarEdits, false, true), true);
  assert.strictEqual(calendarComputes, 1);
  assert.strictEqual(calendarPost.status, 'Calendar computed');
  assert.strictEqual(calendarEdits.status, 'Calendar computed');
  const samplesPost = { status: 'Before' };
  const samplesEdits = {};
  assert.strictEqual(statusCtx._writeUiApplyOverallStatus('sxr', samplesPost, samplesEdits, true, false), true);
  assert.strictEqual(samplesComputes, 1);
  assert.strictEqual(samplesPost.status, 'Samples computed');
  assert(!Object.prototype.hasOwnProperty.call(samplesEdits, 'status'));
  assert.strictEqual((calendarFlush.match(/_writeUiApplyOverallStatus\('calendar', post, edits, wasNewRow, (?:false|true)\);/g) || []).length, 2);
  assert(!/computeOverallStatus\s*\(/.test(calendarFlush));
  assert.strictEqual((samplesFlush.match(/_writeUiApplyOverallStatus\('sxr', post, edits, wasNewRow, (?:false|true)\);/g) || []).length, 2);
  assert(!/computeSampleOverallStatus\s*\(/.test(samplesFlush));
  assert(/if \('video_status' in edits \|\| 'graphic_status' in edits \|\| 'caption_status' in edits\) wirePost\.status/.test(calendarFlush));
  assert(/if \('video_status' in edits \|\| 'graphic_status' in edits\) wirePost\.status/.test(samplesFlush));
  assert(/const replace = !append && options\.replace === true;/.test(source));
  assert(/const current = bindingChanged \|\| replace \? null : previous;/.test(source));
  assert(/replace: options\.replace === true,/.test(source));
  console.log('  ok  stay queues only the comment projection and cannot recompute either card status');

  const commit = extractFunction('_writeUiCommitCardCommentLifecycle');
  assert(/action === 'resolve'[\s\S]*?_writeUiResolveCardComment[\s\S]*?: await _writeUiCardCommentLifecycle/.test(commit));
  console.log('\nproduction comment mark-done CAS checks passed');
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
