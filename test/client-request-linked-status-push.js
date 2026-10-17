'use strict';
/*
 * A CLIENT'S "REQUEST CHANGES" ON A LINKED PART MUST REACH ITS WORK ITEM.
 * OPEN_REPAIRS 427.
 *
 * Live 2026-10-16 19:25 UTC: a client pressed Request changes on a video whose
 * card is linked to a Production work item. The card moved to Tweaks Needed;
 * the work item stayed in Client Approval, and the card-vs-work-item drift
 * check went red every hour after.
 *
 * Why: on a client link, when the client-comment front door is not available
 * (its runtime-flag read failed or ran past its two-second limit, the client
 * entry was not verified, the crosswalk could not be read), the comment is
 * kept on the card only and a deferred record is staged. The handler then put
 * the part on `_calNoLinearPush` / `_sxrNoLinearPush`, which makes the card
 * save SKIP its status push to the gateway. That skip dates from when the
 * deferred record was a comment + status pair sent to Linear. Since
 * OPEN_REPAIRS 239 the record is source-only and never touches the network, so
 * nothing delivered the status at all.
 *
 * This suite runs the REAL `_calReviewRequestTweak` and `_sxrReviewRequestTweak`
 * on a client link with the front door unavailable and asserts, at the moment
 * the card save runs, that:
 *   - a LINKED part is not on the skip list (its status goes to the gateway);
 *   - a part with NO work item still is (there is nothing to move, and the
 *     test client refuses a targetless status push: native_link_required).
 * It also pins the two facts that make the skip list matter: the card saves
 * still skip a part on the list, and the deferred record is still source-only.
 * If either changes, this question has to be asked again.
 *
 * Run: node test/client-request-linked-status-push.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* Everything the handlers touch that is not the decision under test answers
   from this scope. Unknown names become no-op functions, so the suite follows
   the handler's real control flow without re-stating its plumbing. */
function makeScope(surface, observed) {
  const state = { posts: [] };
  const reviewState = {
    drafts: Object.create(null), saving: Object.create(null), errors: Object.create(null),
    draftActionIds: Object.create(null), errorActionIds: Object.create(null), sendingNotes: Object.create(null),
    expanded: new Set()
  };
  const pending = Object.create(null);
  const skip = new Set();
  const sxr = surface === 'sxr';
  const explicit = {
    _isClientLink: true,
    [sxr ? 'sxrState' : 'calState']: state,
    [sxr ? '_sxrReviewState' : '_calReviewState']: reviewState,
    [sxr ? '_sxrPendingEdits' : '_calPendingEdits']: pending,
    [sxr ? '_sxrNoLinearPush' : '_calNoLinearPush']: skip,
    // The real native-id rule: a video or graphic part names its deliverable id.
    _writeUiNativeId: (post, comp) => !post || (comp !== 'video' && comp !== 'graphic') ? ''
      : String((comp === 'graphic' ? post.graphic_deliverable_id : post.video_deliverable_id) || '').trim(),
    _writeUiSourceClientSlug: () => 'sidneylaruel',
    _writeUiLegacyTargetWithLock: (s, slug, pid, comp, callback) => Promise.resolve().then(callback),
    _writeUiLegacyInspectTargetTweak: (s, slug, pid, comp, post, body, id) => Promise.resolve({ state: 'new', comment_id: id, ids: [] }),
    _writeUiLegacyRefreshActiveTweak: (s, inspection) => Promise.resolve(inspection),
    // The front door is unavailable: the shape _calPostLinearComment /
    // _sxrPostLinearComment answer in that case.
    [sxr ? '_sxrPostLinearComment' : '_calPostLinearComment']: () => Promise.resolve({
      skipped: true, source_only: true, legacy_transport_retired: true, deferred_until_source_save: true
    }),
    // What the real stager answers for the one source-only record it builds.
    _writeUiQueueDeferredLegacyTweak: (s, post, comp, comment) => Promise.resolve({
      state: 'staged', comment_id: comment.id, delivered: false, source_only: true,
      ids: ['deferred_' + s + '_' + comment.id + '_source']
    }),
    _writeUiMergeCommittedBatch: (target, batch) => Object.assign(target, batch),
    [sxr ? '_sxrFlushCardSave' : '_calFlushCardSave']: (pid) => {
      const post = state.posts.find(p => p.id === pid);
      observed.push({ pid, comp: post && post._probeComp, skipped: skip.has(pid + '|' + (post && post._probeComp)) });
      return Promise.resolve();
    },
    [sxr ? '_sxrMintCommentId' : '_calMintCommentId']: (() => { let n = 0; return () => 'c_probe_' + (++n); })(),
    [sxr ? '_sxrCurrentAuthor' : '_calCurrentAuthor']: () => 'Client',
    [sxr ? '_sxrCommentRole' : '_calCommentRole']: () => 'client',
    [sxr ? '_sxrCommentsFor' : '_calCommentsFor']: (post, comp) => (post[comp + '_comments'] || []),
    [sxr ? '_sxrSetCommentsFor' : '_calSetCommentsFor']: (post, comp, list) => { post[comp + '_comments'] = list; },
    [sxr ? '_sxrNextTweakRound' : '_calNextTweakRound']: () => 1,
    [sxr ? '_sxrStringifyComments' : '_calStringifyComments']: list => JSON.stringify(list || []),
    [sxr ? '_sxrComponentsFor' : '_calComponentsFor']: () => ['video', 'graphic'],
    [sxr ? '_sxrReviewComponentActive' : '_calReviewComponentActive']: () => true,
    [sxr ? '_sxrReviewMode' : '_calReviewMode']: () => 'client',
    [sxr ? '_sxrMsgAudience' : '_calMsgAudience']: c => c.audience,
    [sxr ? '_sxrMsgIsTweak' : '_calMsgIsTweak']: c => !!c.is_tweak,
    SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
    CAL_REVIEW_COMPONENTS: ['video', 'graphic', 'caption', 'title'],
    computeOverallStatus: () => 'Tweaks Needed',
    _writeUiRequestTweakMarkLocalStatus: () => ({ before: [], stamped: [] }),
    _writeUiLegacyPinnedSourceTransport: () => 'supabase',
    _writeUiFlushDeferredLegacyTweak: () => Promise.resolve({ state: 'confirmed' }),
  };
  const keep = new Set(['undefined', 'Promise', 'Object', 'String', 'Number', 'Boolean', 'Array', 'JSON', 'Date',
    'Math', 'Set', 'Map', 'Error', 'console', 'setTimeout', 'clearTimeout', 'Symbol', 'isFinite', 'parseInt']);
  const scope = new Proxy(explicit, {
    has: (target, key) => typeof key === 'string' && !keep.has(key),
    get: (target, key) => {
      if (key === Symbol.unscopables) return undefined;
      if (key in target) return target[key];
      return function noop() { return undefined; };
    },
    set: (target, key, value) => { target[key] = value; return true; }
  });
  return { scope, state, reviewState };
}

function runHandler(surface, post, comp) {
  const name = surface === 'sxr' ? '_sxrReviewRequestTweak' : '_calReviewRequestTweak';
  const observed = [];
  const { scope, state, reviewState } = makeScope(surface, observed);
  // eslint-disable-next-line no-new-func
  const handler = new Function('scope', 'with (scope) { return (' + extractFunction(INDEX, name) + '); }')(scope);
  post._probeComp = comp;
  state.posts.push(post);
  reviewState.drafts[post.id + '|' + comp] = 'Please shorten the intro';
  handler(post.id, comp);
  return new Promise(resolve => setTimeout(() => resolve({ observed, post }), 50));
}

let passed = 0;
function check(condition, message) { assert.ok(condition, message); passed++; console.log('ok  ' + message); }

(async () => {
  for (const surface of ['calendar', 'sxr']) {
    const label = surface === 'sxr' ? 'Samples' : 'Calendar';
    for (const comp of ['video', 'graphic']) {
      const linked = await runHandler(surface, {
        id: 'p_probe_linked_' + comp, client: 'sidneylaruel', status: 'Client Approval',
        [comp + '_status']: 'Client Approval',
        video_deliverable_id: comp === 'video' ? 'del_probe_video' : '',
        graphic_deliverable_id: comp === 'graphic' ? 'del_probe_graphic' : ''
      }, comp);
      check(linked.observed.length === 1, `${label} ${comp}: the request reaches the card save`);
      check(linked.post[comp + '_status'] === 'Tweaks Needed', `${label} ${comp}: the card part says Tweaks Needed`);
      check(linked.observed[0].skipped === false,
        `${label} ${comp}: a LINKED part is not skipped, so its status goes to the gateway (front door unavailable)`);

      const unlinked = await runHandler(surface, {
        id: 'p_probe_unlinked_' + comp, client: 'sidneylaruel', status: 'Client Approval',
        [comp + '_status']: 'Client Approval', video_deliverable_id: '', graphic_deliverable_id: ''
      }, comp);
      check(unlinked.observed.length === 1 && unlinked.observed[0].skipped === true,
        `${label} ${comp}: a part with NO work item still skips the status push (nothing to move)`);
    }
  }

  // The two facts that make the skip list matter.
  for (const [flush, skipName] of [['_calFlushCardSave', '_calNoLinearPush'], ['_sxrFlushCardSave', '_sxrNoLinearPush']]) {
    const src = extractFunction(INDEX, flush);
    check(src.includes(skipName + ".has(pid + '|video')") && src.includes(skipName + ".has(pid + '|graphic')")
      && (src.includes('|| suppressed) return null;') || (src.includes("in edits && !suppressVideo") && src.includes("in edits && !suppressGraphic"))),
    `${flush} still skips the status push for a part on ${skipName}`);
  }
  const builder = extractFunction(INDEX, '_writeUiBuildDeferredLegacyTweakRecords');
  const kinds = builder.match(/kind:\s*'([a-z_]+)'/g) || [];
  check(kinds.length === 1 && kinds[0].includes("'source_only'"),
    'the deferred request record is source-only (it carries no status anywhere)');

  console.log(`\n${passed} client-request linked status-push checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
