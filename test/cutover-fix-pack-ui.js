'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations', '2026-07-13-write-ui-reroute-allowlist.sql'), 'utf8');

function extract(name) {
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
assert(source.includes("const LINEAR_SET_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-set-status'"));
assert(source.includes("const LINEAR_ADD_COMMENT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-add-comment'"));
assert(source.includes("const VIDEO_FORM_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/video-form'"));
assert(source.includes("const GRAPHIC_FORM_WEBHOOK = 'https://synchrosocial.app.n8n.cloud/webhook/graphic-form'"));
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
assert(readyRoute.includes('return _writeUiRerouteUseGateway(clientSlug)'));

for (const [wrapper, legacy, surface] of [
  ['_calPushStatusToLinear', '_calLegacyPushStatusToLinear', 'calendar'],
  ['_calPostLinearComment', '_calLegacyPostLinearComment', 'calendar'],
  ['_sxrPushStatusToLinear', '_sxrLegacyPushStatusToLinear', 'sxr'],
  ['_sxrPostLinearComment', '_sxrLegacyPostLinearComment', 'sxr'],
]) {
  const body = extract(wrapper);
  assert(body.includes(`await _writeUiUseGatewayWhenReady('${surface}', meta)`), wrapper + ' must await per-client routing');
  assert(body.includes(legacy), wrapper + ' must retain the legacy transport');
  assert(body.includes('legacy_transport: true'), wrapper + ' must let the legacy source save continue immediately');
}

const submitEntry = extract('submitLinearForm');
const routedSubmit = extract('_submitLinearFormRoutedOnce');
const legacySubmit = extract('_submitLinearFormLegacy');
const f44Submit = extract('_submitLinearFormOnce');
const f44Transport = extract('_linearAwaitCreate');
assert(submitEntry.includes('_submitLinearFormRoutedOnce(mode)'));
assert(routedSubmit.includes('localStorage.getItem(LINEAR_RECEIPTS_KEY)'));
assert(routedSubmit.includes('await _writeUiRerouteUseGatewayWhenReady'));
assert(routedSubmit.includes('if (!useGateway)') && routedSubmit.includes('return _submitLinearFormLegacy(mode)'));
assert(legacySubmit.includes('return _submitLinearFormOnce(mode)'));
assert(f44Submit.includes('_linearPrepareReceipts') && f44Submit.includes('_linearAwaitCreate'));
assert(f44Submit.includes('_linearApplyReceiptOutcomes'));
assert(f44Submit.includes('_calCardJobCreate') && f44Submit.includes('_writeLinearVideoCardsToCalendar'));
assert(f44Transport.includes('idempotency_key: receipt.receipt_key'));
assert(f44Transport.includes('await fetch(target.url') && f44Transport.includes('_linearConfirmedCreate'));
assert(!/fetch\((?:VIDEO_FORM_WEBHOOK|GRAPHIC_FORM_WEBHOOK), sendOptions\)/.test(source),
  'legacy fallback must never restore the pre-F44 fire-and-forget direct fetch');
const addPost = extract('addCalBlankCard');
assert(addPost.indexOf("const clientName = String(calState.client || '').trim()")
  < addPost.indexOf('await _writeUiRerouteUseGatewayWhenReady(clientSlug)'));
assert(addPost.includes('calClientSlug(calState.client) !== clientSlug'));
assert(addPost.includes('_calOpenNativePost(clientName, clientSlug)'));
assert(extract('_linearOutboxFlushRun').includes('await _writeUiPrimeRerouteFlag()'));
assert(extract('_sxrLinearOutboxFlushRun').includes('await _writeUiPrimeRerouteFlag()'));
for (const name of [
  '_calLegacyPushStatusToLinear', '_calLegacyPostLinearComment',
  '_sxrLegacyPushStatusToLinear', '_sxrLegacyPostLinearComment',
]) {
  const body = extract(name);
  assert(body.indexOf('const clientSlug = _writeUiSourceClientSlug') < body.indexOf('fetch('), name + ' must capture its client before async I/O');
  assert(body.includes("Enqueue('status', payload") || body.includes("Enqueue('comment', payload"));
  assert(body.includes(', clientSlug)'), name + ' must persist the captured client with retry debt');
}

// Execute the restored Calendar/SXR writers and prove the legacy n8n request
// bodies remain the exact pre-#813 shapes (no gateway metadata added).
const sent = [];
const transportContext = {
  LINEAR_SET_STATUS_URL: 'legacy-status',
  LINEAR_ADD_COMMENT_URL: 'legacy-comment',
  _calLinearPushLatest: Object.create(null),
  _calLinearPushChain: Object.create(null),
  _sxrLinearPushLatest: Object.create(null),
  _sxrLinearPushChain: Object.create(null),
  _calCurrentAuthor: () => 'Calendar actor',
  _sxrCurrentAuthor: () => 'Samples actor',
  _writeUiSourceClientSlug: () => 'real-client',
  _linearOutboxEnqueue: () => { throw new Error('unexpected Calendar enqueue'); },
  _sxrLinearOutboxEnqueue: () => { throw new Error('unexpected SXR enqueue'); },
  fetch: async (url, options) => {
    sent.push({ url, body: options.body, headers: options.headers });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  },
  console,
};
vm.createContext(transportContext);
vm.runInContext([
  extract('_calLegacyPushStatusToLinear'),
  extract('_calLegacyPostLinearComment'),
  extract('_sxrLegacyPushStatusToLinear'),
  extract('_sxrLegacyPostLinearComment'),
].join('\n'), transportContext);

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
  extract('_kasperUndecidedComps'),
  extract('_sxrCompKasperVisible'),
  extract('_sxrKasperUndecidedComps'),
].join('\n'), linkageContext);
const nativeGraphic = {
  graphic_linear_issue_id: '',
  graphic_deliverable_id: 'deliverable-native',
  graphic_status: 'Kasper Approval',
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
assert(failure.indexOf('_syncviewOpenStaffIdentity') < failure.indexOf("showNotify('Write not saved'"));
const staleIdentityContext = {
  _writeUiFailureNoticeAt: Object.create(null),
  _isClientLink: false,
  locallyVerified: true,
  storedIdentity: { member: { id: 'stale-member' } },
  events: [],
  console: { warn() {} },
  showNotify: () => staleIdentityContext.events.push('toast'),
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

// F19: paired VID+GRA can select only mixed-team batches. Every rendered row
// carries the name plus created time/team, so duplicate names are distinguishable.
const batchCompatible = extract('_calNativeBatchCompatible');
assert(batchCompatible.includes("!String(batch.team || '').trim()"));
const batchPicker = extract('_calRenderNativePostChoice');
assert(batchPicker.includes('filter(_calNativeBatchCompatible)'));
assert(batchPicker.includes('is-incompatible') && batchPicker.includes(' disabled'));
assert(batchPicker.includes('_calNativeBatchDate(batch.created_at)'));
assert(batchPicker.includes('_prodTeamLabel(batch.team)'));
assert(batchPicker.includes("batch.name || 'Current batch'"));

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
for (const name of ['copyShareLink', 'calCopyShareLink', 'smCopyShareLink', '_sxrCopyShareLink']) {
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
    extract('_writeUiFetchRerouteFlagOnce'),
    extract('_writeUiPrimeRerouteFlag'),
    extract('_writeUiRerouteUseGatewayWhenReady'),
  ].join('\n'), timeoutRouteContext);
  const timedRoute = await Promise.race([
    timeoutRouteContext._writeUiRerouteUseGatewayWhenReady('real-client'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('flag timeout fallback did not settle')), 100)),
  ]);
  assert.strictEqual(timedRoute, false, 'never-settling flag read must resolve to the legacy lane');
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
    extract('_writeUiSourceClientSlug'),
    extract('_writeUiUseGatewayWhenReady'),
    extract('_calLegacyPushStatusToLinear'),
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
  assert.strictEqual(switchedAck.legacy_transport, true);
  assert.deepStrictEqual(routedSlugs, ['originalclient']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(switchedRequests)), [{
    url: 'legacy-status',
    body: '{"issue":"https://linear.invalid/VID-RACE","status":"Approved"}',
    headers: { 'Content-Type': 'application/json' },
  }]);

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
  vm.runInContext(extract('_calPushStatusToLinear'), pendingRouteContext);
  const pendingWrite = pendingRouteContext._calPushStatusToLinear('VID-1', 'Approved', {});
  await Promise.resolve();
  assert.deepStrictEqual(pendingCalls, [], 'pending routing must send to neither transport');
  resolveRoute(false);
  await pendingWrite;
  assert.deepStrictEqual(pendingCalls, ['legacy'], 'resolved non-enrolled routing must use legacy once');

  // Calendar retry debt retains the client that initiated the request even if
  // the visible Calendar switches before the network failure settles.
  const queuedClients = [];
  const slugRaceContext = {
    currentSlug: 'client-a',
    _calLinearPushLatest: Object.create(null),
    _calLinearPushChain: Object.create(null),
    _calCurrentAuthor: () => 'Fixture',
    _writeUiSourceClientSlug: () => slugRaceContext.currentSlug,
    _linearOutboxEnqueue: (_kind, _payload, _error, slug) => queuedClients.push(slug),
    LINEAR_SET_STATUS_URL: 'legacy-status',
    LINEAR_ADD_COMMENT_URL: 'legacy-comment',
    fetch: async () => { throw new Error('offline'); },
    console: { warn() {} },
  };
  vm.createContext(slugRaceContext);
  vm.runInContext(extract('_calLegacyPushStatusToLinear') + '\n' + extract('_calLegacyPostLinearComment'), slugRaceContext);
  slugRaceContext._calLegacyPushStatusToLinear('VID-2', 'Approved', {});
  slugRaceContext._calLegacyPostLinearComment('VID-2', 'Note', 'Fixture', {});
  slugRaceContext.currentSlug = 'client-b';
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(queuedClients, ['client-a', 'client-a']);

  transportContext._calLegacyPushStatusToLinear('https://linear.invalid/VID-1', 'Approved', {});
  transportContext._calLegacyPostLinearComment('https://linear.invalid/VID-1', 'Tighten this', 'Kasper', {});
  transportContext._sxrLegacyPushStatusToLinear('https://linear.invalid/GRA-2', 'Tweaks Needed', {});
  transportContext._sxrLegacyPostLinearComment('https://linear.invalid/GRA-2', 'Use blue', 'SMM', {});
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepStrictEqual(sent.map(row => [row.url, JSON.parse(row.body)]), [
    ['legacy-comment', { issue: 'https://linear.invalid/VID-1', body: 'Tighten this', author: 'Kasper' }],
    ['legacy-comment', { issue: 'https://linear.invalid/GRA-2', body: 'Use blue', author: 'SMM' }],
    ['legacy-status', { issue: 'https://linear.invalid/VID-1', status: 'Approved' }],
    ['legacy-status', { issue: 'https://linear.invalid/GRA-2', status: 'Tweaks Needed' }],
  ]);
  assert(sent.every(row => JSON.stringify(row.headers) === JSON.stringify({ 'Content-Type': 'application/json' })));
  console.log('cutover UI fix-pack allowlist, linkage, auth, quarantine, batch, and token checks: ok');
})().catch(error => { console.error(error); process.exit(1); });
