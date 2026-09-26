'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '2026-07-13-write-ui-reroute-allowlist.sql'), 'utf8');

// 060 and 090 offer these setters so the Submit screen module (200) can
// change their state without assigning an ES module import (phase C step
// C3). A function that calls one gets it loaded beside it, so each vm
// context keeps writing the same context variables as before.
const LINEAR_200_SETTERS = [
  '_linearSetVideoCount', '_linearNextVideoCount', '_linearSetJustCreated',
  '_linearSetSubmitInFlight', '_linearSetResolvedPlanUrl',
];
function extract(name) {
  const body = extractOne(name);
  const setters = LINEAR_200_SETTERS.filter(setter => setter !== name && body.includes(setter + '('));
  return [body, ...setters.map(extractOne)].join('\n');
}

function extractOne(name) {
  const marker = 'function ' + name + '(';
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
  throw new Error('unclosed function ' + name);
}

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// F02/F23: the install seed is TEST-only, additive, and cannot overwrite an
// operator-managed rollout value.
assert(/'write_ui_reroute_clients'/.test(migration));
assert(/'\{"clients":\["sidneylaruel"\]\}'::jsonb/.test(migration));
assert(/on conflict \(key\) do nothing/i.test(migration));
assert(!/\bupdate\s+public\.syncview_runtime_flags/i.test(migration));
assert(source.includes("const WRITE_UI_REROUTE_FLAG_KEY = 'write_ui_reroute_clients'"));
assert(source.includes('const WRITE_UI_REROUTE_FLAG_TIMEOUT_MS = 2000'));
assert(source.includes("filter: 'key=eq.' + WRITE_UI_REROUTE_FLAG_KEY"));
/* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). These pinned the two legacy write
   endpoints as PRESENT, because the cutover's whole subject was routing each
   write to the gateway instead of to them. The four writers that used them are
   retired with their retry bookkeeping, no executable reference to either name
   survives in the page, and the constants are deleted. Pinned absent, which is
   the stronger end-state of the same cutover. */
assert(!source.includes("const LINEAR_SET_STATUS_URL ="));
assert(!source.includes("const LINEAR_ADD_COMMENT_URL ="));
assert(!source.includes('webhook/video-form'));
assert(!source.includes('webhook/graphic-form'));
assert(extract('_writeUiFetchRerouteFlagOnce').includes("_writeUiSetRerouteFlagValue({ clients: [] })"), 'flag read failures must fail dark');
assert(extract('_writeUiFetchRerouteFlagOnce').includes('Promise.race([request, timeout])'), 'flag read must have a bounded routing decision');
assert(extract('_writeUiFetchRerouteFlagOnce').includes('controller.abort()'), 'timed-out flag reads must abort the network request when supported');
const sourceClient = extract('_writeUiSourceClientSlug');
assert(sourceClient.includes('post.client_slug') && sourceClient.includes('post.clientSlug')
  && sourceClient.includes('post.client') && sourceClient.includes('post.client_name'),
'routing must prefer immutable client fields carried by the initiating post');
const readyRoute = extract('_writeUiUseGatewayWhenReady');
assert(readyRoute.indexOf('const clientSlug = _writeUiSourceClientSlug') < readyRoute.indexOf('await _writeUiPrimeRerouteFlag()'),
  'routing must capture the initiating client before the allowlist wait');
/* 2026-09-07 (LX-C / OPEN_REPAIRS 175): this used to pin the plain predicate,
   which returned false whenever the flag read failed -- and false here means
   LINEAR_SET_STATUS_URL / LINEAR_ADD_COMMENT_URL, for all four legacy writers
   asserted below. That was 'fail-legacy, never fail-open', correct while Linear
   was the safe destination and backwards once it is not. The routing decision
   now fails CLOSED against Linear. The assertion is not weakened: it still pins
   an exact call, and the two checks under it pin that the flip is real and that
   the allowlist is still honoured whenever the read actually succeeded. */
assert(readyRoute.includes('return _writeUiRerouteUseGatewayFailClosed(clientSlug)'),
  'live-write routing must go through the fail-closed predicate');
const failClosed = extract('_writeUiRerouteUseGatewayFailClosed');
/* 2026-09-08 (Codex finding 1 on PR #1346): this pinned the failed mark ALONE,
   which covered only the read that never landed. A read that SUCCEEDED with
   `[]`, without the key, or with a malformed value produced an empty allowlist
   and left the mark clear, so routing answered the factual "not enrolled" and
   went to LINEAR_SET_STATUS_URL / LINEAR_ADD_COMMENT_URL. Both signals are
   pinned now; the assertion is strengthened, not relaxed. Behaviour is proved
   by execution in test/write-ui-reroute-usable-roster.js. */
assert(failClosed.includes('if (_writeUiRerouteFlagFailed || _writeUiRerouteRosterUnusable) return true'),
  'an unreadable flag AND a read that returned no usable roster must both route native, not to the dead Linear webhook');
assert(failClosed.includes('return _writeUiRerouteUseGateway(clientOrSlug)'),
  'and a healthy flag read must still be answered by the allowlist itself');

/* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). Each writer had to RETAIN its
   legacy transport and answer `legacy_transport: true` so the source save
   could continue immediately while the send ran fire-and-forget. The four
   legacy senders are retired. Per-client routing is unchanged and still
   pinned; the legacy branch must now refuse on the spot, still without
   blocking the caller's card write or source save -- which is what
   `legacy_transport_retired` reports. */
for (const [wrapper, legacy, surface] of [
  ['_calPushStatusToLinear', '_calLegacyPushStatusToLinear', 'calendar'],
  ['_calPostLinearComment', '_calLegacyPostLinearComment', 'calendar'],
  ['_sxrPushStatusToLinear', '_sxrLegacyPushStatusToLinear', 'sxr'],
  ['_sxrPostLinearComment', '_sxrLegacyPostLinearComment', 'sxr'],
]) {
  const body = extract(wrapper);
  assert(body.includes(`await _writeUiUseGatewayWhenReady('${surface}', meta)`), wrapper + ' must await per-client routing');
  assert(!body.includes(legacy + '('), wrapper + ' must not call the retired legacy transport');
  assert(!source.includes('function ' + legacy + '('), legacy + ' must be gone from the page, not merely uncalled');
  assert(body.includes('legacy_transport_retired: true'), wrapper + ' must report the retired lane without blocking the source save');
}

const submitEntry = extract('submitLinearForm');
const routedSubmit = extract('_submitLinearFormRoutedOnce');
assert(submitEntry.includes('_submitLinearFormRoutedOnce(mode)'));
assert(routedSubmit.includes('localStorage.getItem(LINEAR_RECEIPTS_KEY)'));
assert(routedSubmit.includes('await _writeUiRerouteUseGatewayWhenReady'));
assert(routedSubmit.includes("_linearHoldSubmission(mode, 'native_routing_unavailable'")
  && routedSubmit.includes('return _linearHoldSubmission(mode'),
  'Create Post must hold when routing would select the legacy transport');
assert(!routedSubmit.includes('return _submitLinearFormLegacy(mode)'),
  'Create Post must not retain a live legacy submission shortcut');
assert(!/_submitLinearFormLegacy|_submitLinearFormOnce|_linearAwaitCreate/.test(source),
  'the orphan legacy Submit sender chain must stay retired');
const addPost = extract('addCalBlankCard');
assert(addPost.indexOf("const clientName = String(calState.client || '').trim()")
  < addPost.indexOf('await _writeUiRerouteUseGatewayWhenReady(clientSlug)'));
assert(addPost.includes('calClientSlug(calState.client) !== clientSlug'));
assert(addPost.includes('_calOpenNativePost(clientName, clientSlug)'));
assert(extract('_linearOutboxFlushRun').includes('await _writeUiPrimeRerouteFlag()'));
assert(extract('_sxrLinearOutboxFlushRun').includes('await _writeUiPrimeRerouteFlag()'));
/* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). Each legacy sender had to freeze
   its client slug BEFORE its async fetch and hand that frozen local to the
   retry enqueue, so debt queued after a tab switch could not be attributed to
   whichever client happened to be open when the send failed. The senders and
   the enqueues are retired together, so there is no debt to misattribute.
   Pinned absent, both the functions and the enqueues. */
for (const name of [
  '_calLegacyPushStatusToLinear', '_calLegacyPostLinearComment',
  '_sxrLegacyPushStatusToLinear', '_sxrLegacyPostLinearComment',
  '_linearOutboxEnqueue', '_sxrLinearOutboxEnqueue',
]) {
  assert(!source.includes('function ' + name + '('), name + ' must be retired from the page');
}

/* The block that stood here built a VM context and executed all four legacy
   senders to prove their n8n request bodies stayed the exact pre-#813 shapes.
   There are no senders and no request bodies (OPEN_REPAIRS 239). */
// F04: URL-era and native-id-era linkages are interchangeable at all four
// Kasper decisions and at both SMM/SXR pill locks.
const linkageContext = {
  _calNormStatus: value => value,
  _sxrNormStatus: value => value,
  _calCompHasUnresolvedKasperTweak: () => false,
  _sxrCompHasUnresolvedKasperTweak: () => false,
  _calComponentsFor: () => ['video', 'graphic', 'caption'],
  SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
};
vm.createContext(linkageContext);
vm.runInContext([
  extract('_calCompLinked'),
  extract('_calCompKasperVisible'),
  extract('_kasperCompReviewable'),
  extract('_kasperUndecidedComps'),
  extract('_sxrCompKasperVisible'),
  extract('_sxrKasperUndecidedComps'),
].join('\n'), linkageContext);
/* thumbnail_url is what makes this graphic ACTIONABLE, and the assertions below
   are about LINKAGE, not about media. Kasper's undecided set has counted only
   components he can act on since OPEN_REPAIRS 135 -- an unlinked thumbnail, and
   now also one whose image never arrived -- so a fixture with no image would be
   testing the media rule by accident instead of the linkage rule on purpose. */
const nativeGraphic = {
  graphic_linear_issue_id: '',
  graphic_deliverable_id: 'deliverable-native',
  graphic_status: 'Kasper Approval',
  thumbnail_url: 'https://drive.google.com/native-thumb.png',
  video_status: 'In Progress',
  caption_status: 'In Progress',
};
assert.strictEqual(linkageContext._calCompLinked(nativeGraphic, 'graphic'), true);
assert.strictEqual(linkageContext._calCompKasperVisible(nativeGraphic, 'graphic'), true);
assert.deepStrictEqual(Array.from(linkageContext._kasperUndecidedComps(nativeGraphic)), ['graphic']);
assert.strictEqual(linkageContext._sxrCompKasperVisible(nativeGraphic, 'graphic'), true);
assert.deepStrictEqual(Array.from(linkageContext._sxrKasperUndecidedComps(nativeGraphic)), ['graphic']);
assert(count(extract('_calCompKasperVisible') + extract('_kasperUndecidedComps')
  + extract('_sxrCompKasperVisible') + extract('_sxrKasperUndecidedComps'), '_calCompLinked') === 4);
assert(extract('_calRenderInlineCard').includes('!_calCompLinked(p, c)'));
assert(extract('_sxrRenderInlineCard').includes('!_calCompLinked(p, c)'));

// F10: a 401 opens the existing staff dialog.
const failure = extract('_writeUiReportFailure');
assert(failure.includes("_syncviewOpenStaffIdentity({ reason: 'required' })"));
assert(failure.includes('_syncviewStaffIdentityClear()'));
assert(failure.indexOf('_syncviewStaffIdentityClear()') < failure.indexOf("_syncviewOpenStaffIdentity({ reason: 'required' })"));
assert(failure.indexOf('_syncviewOpenStaffIdentity') < failure.indexOf('showNotify('));
const staleIdentityContext = {
  _writeUiFailureNoticeAt: Object.create(null),
  _isClientLink: false,
  locallyVerified: true,
  storedIdentity: { member: { id: 'stale-member' } },
  events: [],
  console: { warn() {} },
  showNotify: () => staleIdentityContext.events.push('toast'),
  // Message resolution and the diagnostic ring have their own suite
  // (write-ui-failure-messages.js); here only the 401 ordering is under test.
  _writeUiQueueDiagnostic: () => {},
  _writeUiFailureText: () => ({ title: 'Write not saved', text: 'stub' }),
};
staleIdentityContext._syncviewStaffIdentityClear = () => {
  staleIdentityContext.events.push('clear');
  staleIdentityContext.locallyVerified = false;
  staleIdentityContext.storedIdentity = null;
};
staleIdentityContext._syncviewOpenStaffIdentity = options => {
  assert.strictEqual(options.reason, 'required');
  staleIdentityContext.events.push(staleIdentityContext.locallyVerified || staleIdentityContext.storedIdentity
    ? 'account-popover'
    : 'sign-in');
};
vm.createContext(staleIdentityContext);
vm.runInContext(failure, staleIdentityContext);
staleIdentityContext._writeUiReportFailure('calendar', 'status', { status: 401, code: 'credentials_required' });
assert.deepStrictEqual(staleIdentityContext.events, ['clear', 'sign-in']);

// F21 owner decision: the startup notice is gone, while ops inspection remains.
assert(!source.includes('_writeUiNotifyLegacyPending'));
assert(!source.includes('pending Linear updates from before the upgrade'));
assert(source.includes('window.peekWriteUiLegacyQuarantine'));

// F19, amended 2026-08-18 for the post-shape choice, and again the same day
// for the owner's round-2 picker (option E): compatibility is judged against
// the chosen mode (a graphics-only batch can hold a Thumbnail-only post),
// while a mixed post needs a parent recorded for BOTH lanes. Compatible batches
// live in ONE previous-batch card's always-visible dropdown, rows are titled
// by batch NAME, mode-incompatible batches are NOT RENDERED AT ALL (owner:
// "the batches that can't hold this post I prefer not to show"), and
// parentless orphans are excluded from both lists
// (test/create-post-picker.js holds the behavioral pins).
const batchCompatible = extract('_calNativeBatchCompatible');
// 2026-08-26: the team column no longer decides this. It describes a batch's
// existing CHILDREN, not the teams it can file, so it refused work whose parents
// resolve perfectly — 143 of 397 active batches, two SMM reports in one day.
// What is pinned now is the rule the gateway actually enforces: parent coverage
// for every needed team, plus the primary team's parent being owned by that
// team. test/batch-append-parent-map-rule.js holds the behavioural pins.
assert(batchCompatible.includes('needed.every(t => parentTeams.has(t))'));
assert(!/\bbatch\.team\b/.test(batchCompatible));
assert(batchCompatible.includes('return false'));
const batchLists = extract('_calNativeBatchLists');
assert(batchLists.includes('_calNativeBatchCompatible(batch, mode)'));
assert(batchLists.includes('filter(_calNativeBatchHasLinearParents)'));
const batchPicker = extract('_calRenderNativePostChoice');
assert(batchPicker.includes('_calNativeBatchLists(state.batchOptions, mode, state.batchPostCounts)'));
assert(!batchPicker.includes('is-incompatible') && !batchPicker.includes('cal-native-batch-unavailable'));
assert(batchPicker.includes('cal-native-batch-select') && batchPicker.includes('_calNativePrevBatchPick(this, true)'));
assert(batchPicker.includes('_calNativeBatchStartMeta(batch.created_at'));
assert(batchPicker.includes('_calNativeBatchDisplayName(batch)'));

// F03 browser half: tokens never come from the public Clients Info map. Each
// copy action awaits the authenticated, no-store issuer instead.
assert(source.includes("const CLIENT_REVIEW_LINK_URL = CAL_SUPABASE_URL + '/functions/v1/client-review-link'"));
assert(source.includes("const CLIENTS_INFO_FORBIDDEN_FIELDS = new Set(['client_review_token'])"));
assert(!/clientMap[^\n]{0,100}client_review_token/.test(source));
const reviewLinkHelper = extract('_syncviewIssueClientShareUrl');
const reviewLinkHeaders = extract('_syncviewEfHeaders');
assert(reviewLinkHelper.includes('_syncviewStaffIdentityForHeaders()'));
assert(reviewLinkHelper.includes('fetch(CLIENT_REVIEW_LINK_URL'));
assert(reviewLinkHelper.includes("headers: _syncviewEfHeaders({ 'Content-Type': 'application/json' }, CLIENT_REVIEW_LINK_URL)"));
assert(reviewLinkHelper.includes('body: JSON.stringify({ client: clientName })'));
assert(reviewLinkHelper.includes("q.set('t', json.token)"));
assert(!/localStorage|sessionStorage/.test(reviewLinkHelper));
assert(reviewLinkHeaders.includes("out['X-Syncview-Key'] = identity.key"));
assert(reviewLinkHeaders.includes("out['X-Syncview-Actor'] = identity.member.name"));
assert(reviewLinkHeaders.includes("out['X-Syncview-Role'] = identity.role"));
// smCopyShareLink went with the Samples Old page (removed 2026-09-24).
for (const name of ['copyShareLink', 'calCopyShareLink', '_sxrCopyShareLink']) {
  assert(extract(name).includes('await _syncviewIssueClientShareUrl'), name + ' must fetch the client review token at copy time');
}

(async () => {
  // Even a fetch implementation that never settles cannot freeze write
  // routing. The bounded read resolves to an empty allowlist and the caller
  // chooses the legacy lane.
  let observedSignal = null;
  const timeoutRouteContext = {
    CAL_SUPABASE_URL: 'https://runtime.invalid',
    CAL_SUPABASE_ANON_KEY: 'anon',
    WRITE_UI_REROUTE_FLAG_KEY: 'write_ui_reroute_clients',
    // The client-comment front-door flag shares this fetch; its dark default
    // is covered in test/client-comment-lane-routing.js.
    CLIENT_COMMENT_GATEWAY_FLAG_KEY: 'client_comment_gateway_enabled',
    _clientCommentGatewaySetFlagValue: () => {},
    WRITE_UI_REROUTE_FLAG_TIMEOUT_MS: 5,
    _writeUiRerouteFlagPromise: null,
    _writeUiRerouteClients: new Set(['real-client']),
    wlNormalizeClient: value => String(value || '').trim(),
    AbortController,
    clearTimeout,
    encodeURIComponent,
    setTimeout,
    console: { warn() {} },
    fetch: (_url, options) => {
      observedSignal = options.signal || null;
      return new Promise(() => {});
    },
  };
  timeoutRouteContext._writeUiSetRerouteFlagValue = value => {
    timeoutRouteContext._writeUiRerouteClients = new Set(value && Array.isArray(value.clients) ? value.clients : []);
  };
  timeoutRouteContext._writeUiRerouteUseGateway = slug => timeoutRouteContext._writeUiRerouteClients.has(slug);
  vm.createContext(timeoutRouteContext);
  vm.runInContext([
    // Module-level state the extracted functions close over. The generation
    // counter retires a read that a newer read (fetch or realtime channel) has
    // already superseded -- see the item-70 race scenarios in
    // test/write-ui-reroute-flag-heal.js. Declared here because this harness
    // extracts functions individually rather than slicing the whole block.
    'let _writeUiRerouteFlagGeneration = 0;',
    'let _writeUiRerouteFlagFailed = false;',
    // Codex finding 1: the routing predicate's second signal, "the read landed
    // but carried no usable roster". Seeded TRUE to match the shipped
    // initialiser -- before any read there is nothing to trust -- and the real
    // _writeUiFetchRerouteFlagOnce extracted below is what settles it.
    'let _writeUiRerouteRosterUnusable = true;',
    // The fetch and the prime write this state through its owner's setters.
    extract('_writeUiSetRerouteFlagGeneration'),
    extract('_writeUiSetRerouteFlagFailed'),
    extract('_writeUiSetRerouteRosterUnusable'),
    extract('_writeUiSetRerouteFlagPromise'),
    // _writeUiRerouteRosterUsable normalises through this. Extracted rather
    // than stubbed so the usability rule is judged by the real slug rules; its
    // own try/catch covers calClientSlug being absent from this harness.
    extract('_calRuntimeFlagSlug'),
    extract('_calRuntimeFlagRawMembers'),
    extract('_calRuntimeFlagClients'),
    extract('_writeUiRerouteRosterUsable'),
    extract('_writeUiFetchRerouteFlagOnce'),
    extract('_writeUiPrimeRerouteFlag'),
    extract('_writeUiRerouteUseGatewayFailClosed'),
    extract('_writeUiRerouteUseGatewayWhenReady'),
  ].join('\n'), timeoutRouteContext);
  const timedRoute = await Promise.race([
    timeoutRouteContext._writeUiRerouteUseGatewayWhenReady('real-client'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('flag timeout fallback did not settle')), 100)),
  ]);
  /* THIS ASSERTION WAS INVERTED ON 2026-09-07 (LX-C / OPEN_REPAIRS 175), and it
     is the whole point of the change. It used to read `false` -- "never-settling
     flag read must resolve to the legacy lane" -- which is precisely the branch
     that sent every write to LINEAR_SET_STATUS_URL / LINEAR_ADD_COMMENT_URL after
     one slow moment at boot. After 2026-09-15 that lane is a dead URL that fails
     silently, so a bounded read that never settles must now resolve NATIVE, where
     an authority can refuse out loud. What is still pinned, and still matters, is
     that the read stays BOUNDED and aborts its fetch: the assertion below. */
  assert.strictEqual(timedRoute, true, 'never-settling flag read must resolve to the NATIVE lane, not the dead Linear webhook');
  assert.strictEqual(timeoutRouteContext._writeUiRerouteClients.size, 0,
    'and the allowlist itself is still emptied, so the outbox drain keeps its factual answer');
  assert(observedSignal && observedSignal.aborted, 'bounded flag read must abort its fetch');

  // A Calendar switch while the allowlist is pending cannot change the route
  // selected for an already-clicked card. The initiating post carries only
  // its historical `client` field here; the non-enrolled client must still
  // emit the byte-identical legacy request even after the visible tab changes
  // to an enrolled client.
  let resolveSlowFlag;
  const slowFlag = new Promise(resolve => { resolveSlowFlag = resolve; });
  const switchedRequests = [];
  const routedSlugs = [];
  const switchRouteContext = {
    calState: { client: 'Original Client' },
    sxrState: { client: 'Original Client' },
    wlNormalizeClient: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    calClientSlug: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    sxrClientSlug: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    _writeUiPrimeRerouteFlag: () => slowFlag,
    _writeUiRerouteUseGateway: slug => {
      routedSlugs.push(slug);
      return slug === 'switchedclient';
    },
    _calLinearPushLatest: Object.create(null),
    _calLinearPushChain: Object.create(null),
    _calCurrentAuthor: () => 'Calendar actor',
    _linearOutboxEnqueue: () => { throw new Error('unexpected legacy enqueue'); },
    LINEAR_SET_STATUS_URL: 'legacy-status',
    fetch: async (url, options) => {
      switchedRequests.push({ url, body: options.body, headers: options.headers });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
    console,
  };
  vm.createContext(switchRouteContext);
  vm.runInContext([
    // The writers answer source-only for a component with no work item of its
    // own (caption/title). Real predicate, not a stub. OPEN_REPAIRS 127.
    extract('_writeUiComponentHasWorkItem'),
    extract('_writeUiSourceClientSlug'),
    // Healthy read in this scenario: the flip is not what is under test here,
    // so the fail-closed predicate must fall through to the allowlist stub.
    'let _writeUiRerouteFlagFailed = false;',
    // Healthy read means a USABLE roster too, so both signals are clear and the
    // predicate falls through to the allowlist stub (Codex finding 1).
    'let _writeUiRerouteRosterUnusable = false;',
    extract('_writeUiRerouteUseGatewayFailClosed'),
    extract('_writeUiUseGatewayWhenReady'),
    extract('_calPushStatusToLinear'),
  ].join('\n'), switchRouteContext);
  const switchedWrite = switchRouteContext._calPushStatusToLinear(
    'https://linear.invalid/VID-RACE',
    'Approved',
    { post: { id: 'card-race', client: 'Original Client' }, component: 'video' },
  );
  switchRouteContext.calState.client = 'Switched Client';
  resolveSlowFlag();
  const switchedAck = await switchedWrite;
  await new Promise(resolve => setImmediate(resolve));
  /* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). The race this case exists to
     pin is the ROUTING one: a write started for one client, with the tab
     switched to another while the flag read was still pending, must be routed
     by the client that was clicked. That is still asserted below, and is the
     whole point. What changed is the losing branch's outcome -- it used to
     answer `legacy_transport: true` and POST the status to `legacy-status`;
     the lane is retired, so it answers `legacy_transport_retired` and sends
     nothing. */
  assert.strictEqual(switchedAck.legacy_transport_retired, true);
  assert.strictEqual(switchedAck.legacy_transport, undefined);
  assert.deepStrictEqual(routedSlugs, ['originalclient']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(switchedRequests)), []);

  // Top-level Create Post also freezes the clicked client. TEST is enrolled,
  // but switching to a real client while its flag read is pending must neither
  // open the native modal for that real client nor insert a legacy card there.
  let resolveCreateRoute;
  const createRoute = new Promise(resolve => { resolveCreateRoute = resolve; });
  const createRaceCalls = [];
  const createRaceContext = {
    _isClientLink: false,
    calState: { client: 'Sidney Laruel' },
    calClientSlug: value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    _writeUiRerouteUseGatewayWhenReady: () => createRoute,
    _calIsCollabOn: () => false,
    _calInsertLocalBlankCard: () => createRaceCalls.push('legacy'),
    _calOpenNativePost: (...args) => createRaceCalls.push(['gateway', ...args]),
  };
  vm.createContext(createRaceContext);
  vm.runInContext(extract('addCalBlankCard'), createRaceContext);
  const createRace = createRaceContext.addCalBlankCard();
  createRaceContext.calState.client = 'Real Client';
  resolveCreateRoute(true);
  await createRace;
  assert.deepStrictEqual(createRaceCalls, []);

  // Submit captures both name and slug before the same wait. A switch from
  // enrolled TEST to a non-enrolled real client aborts before either native
  // intake or the legacy bridge can be selected for the new value.
  let resolveSubmitRoute;
  const submitRoute = new Promise(resolve => { resolveSubmitRoute = resolve; });
  const submitInput = { value: 'Sidney Laruel', dataset: { clientSlug: 'sidneylaruel' } };
  const submitStatus = { textContent: '' };
  const submitRaceCalls = [];
  const submitRaceContext = {
    document: {
      getElementById: id => id === 'linearClientSearch' ? submitInput : id === 'linearStatus' ? submitStatus : null,
    },
    LINEAR_RECEIPTS_KEY: 'linear-receipts',
    localStorage: { getItem: () => null },
    _linearIntakeRead: () => null,
    _writeUiRerouteUseGatewayWhenReady: () => submitRoute,
    _submitLinearFormLegacy: () => submitRaceCalls.push('legacy'),
    linearClientRows: [{ slug: 'sidneylaruel' }],
    fetchLinearProjects: async () => submitRaceCalls.push('fetch-clients'),
    _linearResolveClientRow: () => { submitRaceCalls.push('resolve-native'); return { slug: 'realclient' }; },
  };
  vm.createContext(submitRaceContext);
  vm.runInContext(extract('_submitLinearFormRoutedOnce'), submitRaceContext);
  const submitRace = submitRaceContext._submitLinearFormRoutedOnce('both');
  submitInput.value = 'Real Client';
  submitInput.dataset.clientSlug = 'realclient';
  resolveSubmitRoute(true);
  await submitRace;
  assert.deepStrictEqual(submitRaceCalls, []);
  assert.strictEqual(submitStatus.textContent, 'The client selection changed. Review it and submit again.');

  // A pending allowlist read is a routing barrier: neither legacy nor gateway
  // is selected until the read resolves.
  let resolveRoute;
  const pendingCalls = [];
  const pendingRouteContext = {
    _writeUiUseGatewayWhenReady: () => new Promise(resolve => { resolveRoute = resolve; }),
    _calLegacyPushStatusToLinear: () => pendingCalls.push('legacy'),
  };
  vm.createContext(pendingRouteContext);
  vm.runInContext(extract('_writeUiComponentHasWorkItem'), pendingRouteContext);
  vm.runInContext(extract('_calPushStatusToLinear'), pendingRouteContext);
  const pendingWrite = pendingRouteContext._calPushStatusToLinear('VID-1', 'Approved', {});
  await Promise.resolve();
  assert.deepStrictEqual(pendingCalls, [], 'pending routing must send to neither transport');
  resolveRoute(false);
  const pendingAck = await pendingWrite;
  /* Was: `['legacy']` -- once the read resolved non-enrolled, the write took
     the legacy transport exactly once. The barrier property is unchanged and
     asserted above; what the resolved non-enrolled branch does now is refuse,
     so the send count stays zero on BOTH sides of the barrier
     (OPEN_REPAIRS 239). */
  assert.deepStrictEqual(pendingCalls, [], 'resolved non-enrolled routing sends nothing -- the lane is retired');
  assert.strictEqual(pendingAck.legacy_transport_retired, true);

  /* Removed 2026-09-22 (OPEN_REPAIRS 239): the slug-race case, which proved
     a client slug frozen before the send still reached the enqueue after a tab
     switch, and the payload-shape case, which pinned the four n8n request
     bodies byte for byte. Both executed the retired senders. Neither property
     has anything left to protect -- there is no send, no payload and no retry
     debt to attribute. */
  console.log('cutover UI fix-pack allowlist, linkage, auth, quarantine, batch, and token checks: ok');
})().catch(error => { console.error(error); process.exit(1); });
