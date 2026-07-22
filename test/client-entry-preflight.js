'use strict';

/*
 * F102/F117 strict client-entry guard.
 *
 * This executes the real query-envelope, verifier-verdict, and canonical URL
 * helpers extracted from index.html with synthetic inputs only. It protects
 * the fail-closed boundary before any browser/data lane is allowed to mount.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

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
  throw new Error('unclosed function ' + name);
}

const viewsDecl = (source.match(/const SYNCVIEW_CLIENT_ENTRY_VIEWS = Object\.freeze\(\[[^\]]+\]\);/) || [])[0];
const keysDecl = (source.match(/const SYNCVIEW_CLIENT_ENTRY_KEYS = Object\.freeze\(\[[^\]]+\]\);/) || [])[0];
assert(viewsDecl, 'missing client-entry view allowlist');
assert(keysDecl, 'missing client-entry query-key allowlist');
[
  "window.addEventListener('pagehide', _syncviewSuspendClientEntry)",
  "window.addEventListener('pageshow', _syncviewResumeClientEntry, true)",
  "event.persisted !== true",
  'event.stopImmediatePropagation()',
  'localStorage.removeItem(ANALYTICS_CACHE_KEY)',
  'localStorage.removeItem(CAL_CACHE_KEY_PREFIX + slug)',
  'localStorage.removeItem(SXR_CACHE_PREFIX + slug)',
  'localStorage.removeItem(SM_CACHE_PREFIX + slug)',
  'run.href === location.href',
  'fetchEssentials(clientEntryRun)',
  'fetchExtras(clientEntryRun)',
  'fetchAll(_isClientLink?clientEntryRun:null)',
  'signal:clientEntryRun.signal',
  'if(clientEntryRun&&!_syncviewClientEntryRunCurrent(clientEntryRun))throw _syncviewStaleClientEntryError()',
  'if(!_isClientLink)loadTemplates()',
  'if (!_isClientLink) _calLoadCaptionPrompts()',
  'if (!_isClientLink) _calCapJobsRestore()',
  "localStorage.removeItem('syncview_contentSummaryState_v1')",
  "localStorage.removeItem('syncview_generalBriefState_v5')",
  '_autoSummaryAttempted.clear()',
  "clientEntryRun.signal.addEventListener('abort', abortForClientEntry",
].forEach(token => assert(source.includes(token), 'missing client lifecycle/cache guard: ' + token));

const slugSource = extract('_syncviewClientEntrySlug');
const envelopeSource = extract('_syncviewClientEntryEnvelope');
const canonicalizeSource = extract('_syncviewCanonicalizeClientEntry');
const preflightSource = extract('_syncviewPreflightClientEntry');
const purgeSource = extract('_syncviewPurgeClientEntrySurface');
const cancelBriefSource = extract('_syncviewCancelBriefWork');
const scheduleTabSummarySource = extract('_scheduleTabSummary');
const tabSummarySource = extract('fetchTabSummary');
const renderTabSummarySource = extract('renderTabSummary');
const prefetchTabSummarySource = extract('prefetchAllTabSummaries');
const fetchExtrasSource = extract('fetchExtras');
const clientExtrasGateSource = extract('_syncviewRenderClientExtrasGate');
const clientExtrasRetrySource = extract('_syncviewRetryClientExtras');
const clientExtrasWatchSource = extract('_syncviewWatchClientExtras');
const fetchBriefsSource = extract('fetchBriefs');
const startBriefPollingSource = extract('startBriefPolling');
const calAbortSource = extract('_calAbortActiveLoad');
const calCurrentSource = extract('_calLoadRunCurrent');
const calTeardownSource = extract('_calV2Teardown');
const calSubscribeSource = extract('_calV2EnsureSubscribed');
const calRealtimeSource = extract('_calV2OnRealtimeChange');
const calLoadSource = extract('loadCalendarPosts');
const calMetaSource = extract('_calRefreshParentLinkFlags');
const calReconcileSource = extract('_calReconcileLinearStatuses');
const calReturnSource = extract('_calRefreshOnReturn');
const calClearSuspendSource = extract('_calClearSuspendedLoadOwnership');
const calSuspendSource = extract('_calSuspendOnPagehide');
const calResumeSource = extract('_calResumeOnPageshow');
const clientResumeSource = extract('_syncviewResumeClientEntry');
const renderSource = extract('render');
const mountSxrClientSource = extract('mountSxrClientView');

assert(
  calAbortSource.includes('const run = _calActiveLoad;')
    && calAbortSource.includes('_calActiveLoad = null;')
    && calAbortSource.includes('run.retired = true;')
    && calAbortSource.includes('run.controller.abort()')
    && !calAbortSource.includes('clearTimeout('),
  'Calendar replacement must retire and abort the exact owner while retaining its wall-clock settle sentinel',
);
for (const token of [
  'run.seq !== _calLoadSeq',
  'run.slug !== calClientSlug(calState.client)',
  '!run.surface.isConnected',
  '_calActiveLoad && _calActiveLoad !== run',
  '!_syncviewClientEntryRunCurrent(run.clientEntryRun)',
]) {
  assert(calCurrentSource.includes(token), 'Calendar current-run lease is missing: ' + token);
}
assert(
  calTeardownSource.indexOf('++_calV2Epoch;') < calTeardownSource.indexOf('_calInvalidateActiveLoad();')
    && calTeardownSource.includes('_calV2RtPending = false;')
    && calTeardownSource.includes('_calV2DropChannel();'),
  'Calendar teardown must revoke realtime epoch, HTTP generation, pending callbacks, and channel',
);
for (const token of [
  'if (epoch !== _calV2Epoch || !_calLoadRunCurrent(loadRun)) return;',
  'surface: loadRun.surface',
  'clientEntryRun: loadRun.clientEntryRun',
  '_calV2LeaseCurrent(lease)',
]) {
  assert(calSubscribeSource.includes(token), 'Calendar async realtime lease is missing: ' + token);
}
assert(
  calRealtimeSource.includes('if (!_calV2LeaseCurrent(lease)) return;')
    && calRealtimeSource.match(/_calV2LeaseCurrent\(lease\)/g).length >= 2,
  'Calendar realtime callback and delayed timer must both reject a stale surface lease',
);
for (const token of [
  '_calAbortActiveLoad();',
  "surface: document.getElementById('calView')",
  'clientEntryRun: _isClientLink ? _syncviewClientEntryDataRun : null',
  "if ((!ok || !_calLoadRunCurrent(loadRun)) && _calActiveLoad === loadRun)",
  'ownedTailTasks.push(_calReconcileLinearStatuses(loadRun))',
  'ownedTailTasks.push(_calRefreshParentLinkFlags(loadRun, false))',
  'ownedTailTasks.push(_calRefreshParentLinkFlags(loadRun, true))',
  'if (ownedTailTasks.length) await Promise.all(ownedTailTasks);',
  'if (_calActiveLoad === loadRun) _calActiveLoad = null;',
  'await _calV2EnsureSubscribed(slug, loadRun);',
]) {
  assert(calLoadSource.includes(token), 'Calendar load ownership is missing: ' + token);
}
assert(
  calLoadSource.indexOf('ownedTailTasks.push(_calRefreshParentLinkFlags(loadRun, false))')
    < calLoadSource.lastIndexOf('if (_calActiveLoad === loadRun) _calActiveLoad = null;'),
  'Calendar exact owner must remain attached until every owned post-load continuation settles',
);
for (const [name, fnSource] of [
  ['metadata', calMetaSource],
  ['reconcile', calReconcileSource],
]) {
  assert(
    fnSource.includes('loadRun')
      && fnSource.includes('signal: loadRun.controller ? loadRun.controller.signal : undefined')
      && (fnSource.match(/_calLoadRunCurrent\(loadRun\)/g) || []).length >= 5,
    `Calendar ${name} must carry the completed load/surface lease through its transport and mutations`,
  );
  const fetchAt = fnSource.indexOf('await fetch(');
  const jsonAt = fnSource.indexOf('await resp.json()');
  assert(
    fetchAt >= 0
      && fnSource.indexOf('_calLoadRunCurrent(loadRun)', fetchAt) < jsonAt
      && fnSource.indexOf('_calLoadRunCurrent(loadRun)', jsonAt) > jsonAt,
    `Calendar ${name} must re-check ownership after fetch and response-body awaits`,
  );
}
for (const token of [
  '_calLinearStatusMetaSig = sig;',
  '_calLinearStatusMetaAt = Date.now();',
  '_calPersistLinearMeta();',
  '_calRenderBody({ preserveScroll: true });',
]) {
  assert(calMetaSource.includes(token), 'Calendar metadata guarded mutation is missing: ' + token);
}
assert(
  calReconcileSource.includes('if (_calSaveInFlight[post.id] || _calPendingEdits[post.id]) continue;')
    && calReconcileSource.includes('_calNoLinearPush.add(post.id);')
    && calReconcileSource.includes('_calFlushCardSave(post.id);')
    && calReconcileSource.includes('_calRenderBody({ preserveScroll: true });'),
  'Calendar reconcile must skip user-owned save buckets and guard pending/write/render mutations',
);
assert(
  calReturnSource.includes('if (_calStaffPagehideSuspended) return;')
    && calReturnSource.includes('loadCalendarPosts({ background: true, forceMeta: true });')
    && !calReturnSource.includes('_calRefreshParentLinkFlags('),
  'Calendar return metadata must run only inside the exact owned load tail',
);
for (const token of [
  '_calBgLoadInFlight = false;',
  'calState.loading = false;',
  '_calSetRefreshing(false);',
  '_calPendingBackgroundRender = false;',
  '_calPendingRenderInterval = null;',
  '_calLastReturnLoad = 0;',
  '_calLastNetworkLoadAt = 0;',
]) {
  assert(calClearSuspendSource.includes(token), 'staff Calendar pagehide reset is missing: ' + token);
}
assert(
  calSuspendSource.indexOf('_calFlushAllPending();') < calSuspendSource.indexOf('_calV2Teardown();')
    && calSuspendSource.includes('_calClearSuspendedLoadOwnership();'),
  'staff Calendar pagehide must flush writers before retiring read/realtime ownership',
);
assert(
  calResumeSource.includes('event.persisted !== true')
    && calResumeSource.includes('_calStaffPagehideSuspended = false;')
    && calResumeSource.includes('loadCalendarPosts({ background: true, forceMeta: true, skipCache: true });'),
  'persisted staff Calendar pageshow must install exactly one fresh owned load',
);
assert(
  clientResumeSource.includes('event.stopImmediatePropagation();')
    && clientResumeSource.indexOf('event.stopImmediatePropagation();')
      < clientResumeSource.indexOf('_syncviewStartClientEntry(false);'),
  'client BFCache capture must revalidate before Calendar return handlers can read',
);
assert(
  renderSource.includes("if(tab!=='calendar'&&typeof _calV2Teardown==='function')_calV2Teardown();"),
  'Calendar → Brief/Analytics/profile exits must retire transport without relying on navTo',
);
assert(
  renderSource.includes('if(clientOnly&&_syncviewRenderClientExtrasGate(sel,tab))return;'),
  'verified client Brief/Analytics renders must pass through the extras lifecycle gate',
);
for (const token of [
  "_fetchExtrasState={status:'loading',run:clientEntryRun||null}",
  'attempt===_fetchExtrasAttempt&&_fetchExtrasPromise===tracked',
  "_fetchExtrasState={status:'ready',run:clientEntryRun||null}",
  '_fetchExtrasPromise=null',
  "_fetchExtrasState={status:current?'error':'idle'",
]) {
  assert(fetchExtrasSource.includes(token), 'extras promise lifecycle guard is missing: ' + token);
}
for (const token of [
  "if(state==='ready')return false",
  "if(state==='error')_syncviewClientExtrasErrorScreen",
  "_syncviewClientEntryLoader({client:cap.client,view:tab},{extras:true})",
]) {
  assert(clientExtrasGateSource.includes(token), 'client extras visible gate is missing: ' + token);
}
assert(
  clientExtrasRetrySource.includes('const request=fetchExtras(run);')
    && clientExtrasRetrySource.includes('_syncviewRenderClientExtrasGate(cap.client,tab);')
    && clientExtrasRetrySource.includes('_syncviewWatchClientExtras(request,run);')
    && !clientExtrasRetrySource.includes('_syncviewStartClientEntry'),
  'extras retry must make one fresh extras request without repeating client verification',
);
assert(
  (clientExtrasWatchSource.match(/_syncviewRefreshClientExtrasRoute\(clientEntryRun\)/g) || []).length === 2
    && clientExtrasWatchSource.includes('_syncviewClientEntryRunCurrent(clientEntryRun)'),
  'extras success and failure must both repaint only the current active client route',
);
assert(
  mountSxrClientSource.includes("if (typeof _calV2Teardown === 'function') _calV2Teardown();"),
  'Calendar → client Samples must retire transport without relying on navTo',
);
assert(
  purgeSource.indexOf("_calV2Teardown === 'function'") < purgeSource.indexOf('calState.client = null'),
  'invalid-link/pagehide purge must abort Calendar before clearing client state',
);
assert(
  purgeSource.indexOf("_syncviewCancelBriefWork === 'function'") < purgeSource.indexOf('briefPollingState = {}'),
  'invalid-link/pagehide purge must cancel Brief work before dropping timer/controller handles',
);
for (const token of [
  'clearInterval(state.intervalId)',
  'tabSummaryStartTimers.forEach(timer=>clearTimeout(timer))',
  'tabSummaryControllers.forEach(controller=>controller.abort())',
]) {
  assert(cancelBriefSource.includes(token), 'Brief teardown is missing: ' + token);
}
assert(
  scheduleTabSummarySource.includes('tabSummaryStartTimers.delete(timer)')
    && scheduleTabSummarySource.includes('tabSummaryStartTimers.add(timer)')
    && renderTabSummarySource.includes('_scheduleTabSummary(name, briefType, tabId, tabData)')
    && prefetchTabSummarySource.includes('_scheduleTabSummary(name, briefType, tabId'),
  'every delayed tab-summary launch must use the one purge-owned timer registry',
);
for (const token of [
  'const clientEntryRun = _isClientLink ? _syncviewClientEntryDataRun : null',
  '_syncviewClientEntryRunCurrent(clientEntryRun)',
  'tabSummaryControllers.add(controller)',
  "clientEntryRun.signal.addEventListener('abort', abortForClientEntry",
  'tabSummaryControllers.delete(controller)',
]) {
  assert(tabSummarySource.includes(token), 'tab-summary client-entry lease is missing: ' + token);
}
assert(
  (tabSummarySource.match(/runCurrent\(\)/g) || []).length >= 5,
  'tab-summary work must recheck the client owner around every await/cache/render mutation',
);
assert(
  fetchBriefsSource.includes('clientEntryRun ? {signal:clientEntryRun.signal} : undefined')
    && (fetchBriefsSource.match(/runCurrent\(\)/g) || []).length >= 4
    && fetchBriefsSource.indexOf('const nextBriefs=parseCSV(briefText)') < fetchBriefsSource.indexOf('briefs=nextBriefs'),
  'Brief polling reads must parse locally and publish only for the current client-entry run',
);
assert(
  startBriefPollingSource.includes('const clientEntryRun=_isClientLink?_syncviewClientEntryDataRun:null;')
    && (startBriefPollingSource.match(/runCurrent\(\)/g) || []).length >= 3
    && startBriefPollingSource.includes('await fetchBriefs(clientEntryRun);'),
  'Brief polling closure must remain bound to the exact client-entry generation',
);

const normalizeClient = value => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^dr\.?\s+/, '')
  .replace(/\s+(?:and|&)\s+/g, '&')
  .replace(/[^a-z0-9&]+/g, '');
const plain = value => JSON.parse(JSON.stringify(value));

function envelope(search, hash = '', state = null) {
  const context = {
    URLSearchParams,
    location: { search, hash },
    history: { state },
    wlNormalizeClient: normalizeClient,
  };
  vm.createContext(context);
  vm.runInContext([viewsDecl, keysDecl, slugSource, envelopeSource].join('\n'), context);
  return plain(context._syncviewClientEntryEnvelope());
}

assert.deepStrictEqual(envelope('?c=Client+One&t=current-token'), {
  ok: true,
  client: 'Client One',
  slug: 'clientone',
  token: 'current-token',
  view: 'analytics',
  legacyHash: false,
});
assert.strictEqual(envelope('?c=Client+One').reason, 'missing_credential');
assert.strictEqual(envelope('?c=Client+One&t=one&t=two').reason, 'duplicate_t');
assert.strictEqual(envelope('?c=Client+One&t=token&prod=1').reason, 'mixed_entry');
assert.strictEqual(envelope('?c=Client+One&t=token&v=unknown').reason, 'unsupported_view');
assert.strictEqual(envelope('?c=Client+One&t=token&sxr=1').reason, 'mixed_samples_entry');
assert.strictEqual(envelope('?c=Client+One&t=token&v=sample-reviews').reason, 'invalid_samples_entry');
assert.strictEqual(envelope('?c=Client+One&t=token', '#Other Client').reason, 'mixed_hash');
assert.strictEqual(envelope('?c=Client+One&t=token', '', { nav: 'production' }).reason, 'staff_history');
assert.strictEqual(envelope('?c=Client+One&t=token', '', { client: 'Other Client' }).reason, 'mismatched_history');
assert.strictEqual(
  envelope('?c=Client+One&t=token', '#Client%20One').legacyHash,
  true,
  'the exact historical same-client hash is migration input only',
);
assert.strictEqual(
  envelope('?c=Client+One&t=token', '', { client: 'Client One', clientTab: 'brief' }).view,
  'brief',
  'same-client history may restore a supported profile subtab',
);

function canonicalize(entry) {
  let replacement = null;
  const context = {
    URLSearchParams,
    location: {
      search: '?c=Client+One&t=current-token&v=samples',
      pathname: '/',
    },
    history: {
      state: { client: 'Client One' },
      replaceState(state, _title, url) { replacement = { state: plain(state), url }; },
    },
    _syncviewClientEntrySlug: normalizeClient,
  };
  vm.createContext(context);
  vm.runInContext(canonicalizeSource, context);
  const capability = plain(context._syncviewCanonicalizeClientEntry(entry));
  return { capability, replacement };
}

const canonical = canonicalize({
  ok: true,
  client: 'Client One',
  slug: 'clientone',
  token: 'current-token',
  view: 'samples',
});
assert.deepStrictEqual(canonical.capability, {
  client: 'Client One',
  slug: 'clientone',
  view: 'sample-reviews',
  verified: true,
});
assert.strictEqual(canonical.replacement.state.client, 'Client One');
assert.strictEqual(canonical.replacement.state.clientSlug, 'clientone');
assert.strictEqual(canonical.replacement.state.clientTab, 'sample-reviews');
assert.strictEqual(canonical.replacement.state.clientEntryView, 'sample-reviews');
assert.strictEqual(canonical.replacement.state.nav, null);
const canonicalQuery = new URLSearchParams(canonical.replacement.url.split('?')[1]);
assert.strictEqual(canonicalQuery.get('c'), 'Client One');
assert.strictEqual(canonicalQuery.get('t'), 'current-token');
assert.strictEqual(canonicalQuery.get('v'), 'sample-reviews');
assert.strictEqual(canonicalQuery.get('sxr'), '1');
assert(!canonical.replacement.url.includes('#'), 'canonical client route must discard legacy hash authority');
assert(!Object.prototype.hasOwnProperty.call(canonical.capability, 'token'), 'verified capability must not retain the raw token');

async function preflight({
  envelopeResult,
  response,
  thrown,
  generation = 4,
  currentGeneration = 4,
  href = 'https://sync.invalid/?c=Client+One&t=current-token&v=calendar',
  currentHref = href,
}) {
  const requests = [];
  const context = {
    CLIENT_TOKEN_VERIFY_URL: 'https://supabase.invalid/functions/v1/client-token-verify',
    SYNCVIEW_CLIENT_ENTRY_PROTOCOL: 'syncview-client-entry-v1',
    _syncviewClientEntryEnvelope: () => envelopeResult || {
      ok: true,
      client: 'Client One',
      slug: 'clientone',
      token: 'current-token',
      view: 'calendar',
    },
    _syncviewClientEntrySlug: normalizeClient,
    _syncviewClientEntryGeneration: currentGeneration,
    location: { href: currentHref },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (thrown) throw thrown;
      return response;
    },
  };
  vm.createContext(context);
  vm.runInContext(preflightSource, context);
  const verdict = await context._syncviewPreflightClientEntry(generation, href);
  return { verdict: plain(verdict), requests };
}

(async () => {
  const success = await preflight({
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        valid: true,
        active: true,
        strict: true,
        protocol: 'syncview-client-entry-v1',
        slug: 'clientone',
        view: 'calendar',
        display_name: 'Client One',
      }),
    },
  });
  assert.strictEqual(success.verdict.kind, 'ok');
  assert.strictEqual(success.verdict.entry.client, 'Client One');
  assert.strictEqual(success.requests.length, 1);
  assert.strictEqual(success.requests[0].url, 'https://supabase.invalid/functions/v1/client-token-verify');
  assert.strictEqual(success.requests[0].options.cache, 'no-store');
  assert.deepStrictEqual(JSON.parse(success.requests[0].options.body), {
    client: 'Client One',
    slug: 'clientone',
    token: 'current-token',
    view: 'calendar',
    strict: true,
  });

  const permissiveInvalid = await preflight({
    response: {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valid: false, slug: 'clientone', view: 'calendar' }),
    },
  });
  assert.strictEqual(permissiveInvalid.verdict.kind, 'invalid',
    'HTTP 200 without valid=true must never authorize a client');

  const oldVerifierShape = await preflight({
    response: {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valid: true, slug: 'clientone' }),
    },
  });
  assert.strictEqual(oldVerifierShape.verdict.kind, 'invalid',
    'an old verifier response must fail closed until the strict active protocol is deployed');

  const wrongBinding = await preflight({
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        valid: true,
        active: true,
        strict: true,
        protocol: 'syncview-client-entry-v1',
        slug: 'otherclient',
        view: 'calendar',
        display_name: 'Other Client',
      }),
    },
  });
  assert.strictEqual(wrongBinding.verdict.kind, 'invalid');

  const displayNameMismatch = await preflight({
    response: {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        valid: true,
        active: true,
        strict: true,
        protocol: 'syncview-client-entry-v1',
        slug: 'clientone',
        view: 'calendar',
        display_name: 'Different Client',
      }),
    },
  });
  assert.strictEqual(displayNameMismatch.verdict.kind, 'invalid',
    'canonical display name must normalize to the exact verified slug before init/data');

  const denied = await preflight({
    response: { ok: false, status: 410, json: async () => ({ ok: false }) },
  });
  assert.strictEqual(denied.verdict.kind, 'invalid');

  const serverFailure = await preflight({
    response: { ok: false, status: 500, json: async () => ({ ok: false }) },
  });
  assert.strictEqual(serverFailure.verdict.kind, 'retry');

  const requestTimeout = await preflight({
    response: { ok: false, status: 408, json: async () => ({ ok: false }) },
  });
  assert.strictEqual(requestTimeout.verdict.kind, 'retry',
    'an upstream request-timeout response must retain the visible retry path');

  const networkFailure = await preflight({ thrown: new Error('synthetic offline') });
  assert.strictEqual(networkFailure.verdict.kind, 'retry');

  const invalidEnvelope = await preflight({
    envelopeResult: { ok: false, reason: 'mixed_entry' },
    response: { ok: true, status: 200, json: async () => ({ ok: true }) },
  });
  assert.deepStrictEqual(invalidEnvelope.verdict, { kind: 'invalid', reason: 'mixed_entry' });
  assert.strictEqual(invalidEnvelope.requests.length, 0, 'malformed entry must not reach any service or data request');

  const stale = await preflight({
    currentGeneration: 5,
    response: {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, valid: true, slug: 'clientone', view: 'calendar' }),
    },
  });
  assert.strictEqual(stale.verdict.kind, 'stale', 'late verifier result must not take over a newer entry attempt');

  console.log('client entry strict preflight checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
