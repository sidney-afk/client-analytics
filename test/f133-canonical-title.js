'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHash, webcrypto } = require('crypto');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const ui = read('index.html');
const gateway = read('supabase/functions/production-write/index.ts');
const policySource = read('supabase/functions/production-write/policy.mjs');
const outbound = read('supabase/functions/linear-outbound/index.ts');
const migration = read('migrations/2026-08-02-f133-canonical-title.sql');
const runbook = read('docs/ops/F133_CANONICAL_TITLE_INSTALL_RUNBOOK.md');

let failures = 0;
function ok(condition, label) {
  if (condition) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function extract(source, name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = brace; index < source.length; index++) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

function section(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end <= start) throw new Error('missing section ' + startMarker);
  return source.slice(start, end);
}

function titleReceipt(body, overrides = {}) {
  const origin = body.surface === 'sxr' ? 'samples' : 'calendar';
  const noop = overrides.noop === true;
  const expectedRevision = Number(body.expected_title_revision);
  const card = Object.assign({
    id: body.card_id, client: body.client_slug, name: body.title,
    title_revision: expectedRevision + (noop ? 0 : 1),
    updated_at: body.source_edited_at,
    video_deliverable_id: 'del-video', graphic_deliverable_id: 'del-graphics',
  }, overrides.card || {});
  const rows = overrides.rows || [
    { id: 'del-video', team: 'video', title: body.title, client_slug: body.client_slug, origin, card_id: body.card_id },
    { id: 'del-graphics', team: 'graphics', title: body.title, client_slug: body.client_slug, origin, card_id: body.card_id },
  ];
  return Object.assign({
    ok: true, native_committed: true, title: body.title, card, rows,
    noop: false, event_id: 7001, outbox_count: rows.length,
    event_key: ['write-ui', 'title', 'card', origin, body.client_slug, body.card_id, body.request_id].join(':'),
  }, overrides, { card, rows });
}

function browserHarness(sharedStorage, options = {}) {
  const storage = sharedStorage || new Map();
  const statuses = [];
  const requests = [];
  const cacheWrites = [];
  const timers = new Map();
  let timerCounter = 0;
  let requestCounter = 0;
  let f133State = options.f133State || (options.f133Enabled === false ? 'disabled' : 'enabled');
  let storageFailure = options.storageFailure || null;
  let storageRemoveFailure = options.storageRemoveFailure || null;
  const surface = options.surface === 'sxr' ? 'sxr' : 'calendar';
  const fixturePost = Object.assign({
    id: 'card-1', name: options.initialName || 'Original title',
    title_revision: options.initialRevision == null ? 0 : options.initialRevision,
    video_deliverable_id: 'del-video', graphic_deliverable_id: 'del-graphics',
  }, options.post || {});
  let fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return {
      ok: true,
      status: 201,
      json: async () => titleReceipt(body),
    };
  };
  const context = {
    CANONICAL_TITLE_MAX_LENGTH: 500,
    CAL_SAVE_DEBOUNCE_MS: 700,
    SXR_SAVE_DEBOUNCE_MS: 700,
    WRITE_UI_PRODUCTION_WRITE_URL: 'https://example.invalid/production-write',
    CAL_SUPABASE_ANON_KEY: 'public-anon-fixture',
    _canonicalTitleInFlight: new Map(),
    calState: {
      client: 'Fixture',
      posts: surface === 'calendar' ? [fixturePost] : [],
    },
    sxrState: { client: 'Fixture', posts: surface === 'sxr' ? [fixturePost] : [] },
    localStorage: {
      get length() { return storage.size; },
      key: index => [...storage.keys()][index] || null,
      getItem: key => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => {
        if (storageFailure && storageFailure(key, value)) throw new Error('fixture storage failure');
        storage.set(key, String(value));
      },
      removeItem: key => {
        if (storageRemoveFailure && storageRemoveFailure(key)) throw new Error('fixture storage remove failure');
        storage.delete(key);
      },
    },
    crypto: {
      randomUUID: () => options.tabId || 'tab-' + Math.random().toString(36).slice(2),
      subtle: webcrypto.subtle,
    },
    TextEncoder,
    sessionStorage: (() => {
      const rows = new Map();
      return {
        getItem: key => rows.has(key) ? rows.get(key) : null,
        setItem: (key, value) => rows.set(key, String(value)),
        removeItem: key => rows.delete(key),
      };
    })(),
    navigator: { locks: options.locks || { request: async (_name, _options, callback) => callback() } },
    window: { CSS: { escape: value => value } },
    CSS: { escape: value => value },
    document: { activeElement: null, querySelector: () => null },
    setTimeout: callback => {
      const id = ++timerCounter;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: id => timers.delete(id),
    fetch: (...args) => fetchImpl(...args),
    calClientSlug: () => 'fixture',
    sxrClientSlug: () => 'fixture',
    _calCacheWrite: (slug, posts) => cacheWrites.push({ surface: 'calendar', slug, posts }),
    _sxrCacheWrite: (slug, posts) => cacheWrites.push({ surface: 'sxr', slug, posts }),
    _calSetCardStatus: (id, value, message) => statuses.push({ id, value, message }),
    _sxrSetCardStatus: (id, value, message) => statuses.push({ id, value, message }),
    _writeUiIntentId: () => (options.requestPrefix || 'title-request') + '-' + (++requestCounter),
    _writeUiPrincipalKey: () => options.principal || 'staff:actor-a',
    _writeUiHasCredential: () => true,
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    _syncviewEfHeaders: headers => headers,
    _writeUiReportFailure: () => {},
    _f133CanonicalTitleIsEnabled: () => f133State === 'enabled',
    _f133CanonicalTitleIsAbsent: () => f133State === 'absent',
    _f133CanonicalTitleOwnsLinkedNames: () => f133State !== 'absent',
    _f133CanonicalTitleCanAdoptCommittedV3: () => ['enabled', 'disabled'].includes(f133State),
    console,
  };
  vm.createContext(context);
  vm.runInContext(section(
    ui,
    '    const CANONICAL_TITLE_MAX_LENGTH = 500;',
    '    function _writeUiSourceTime(',
  ), context);
  return {
    context,
    storage,
    statuses,
    requests,
    cacheWrites,
    timers,
    setFetch: value => { fetchImpl = value; },
    setStorageFailure: value => { storageFailure = value; },
    setStorageRemoveFailure: value => { storageRemoveFailure = value; },
    setF133Enabled: value => { f133State = value === true ? 'enabled' : 'disabled'; },
    setF133State: value => { f133State = String(value); },
    input: (inputSurface = surface) => ({
      value: (inputSurface === 'sxr' ? context.sxrState : context.calState).posts[0].name,
      dataset: { pid: 'card-1' },
      setAttribute: () => {},
    }),
  };
}

function queuedLockManager() {
  const tails = new Map();
  return {
    request(name, _options, callback) {
      const previous = tails.get(name) || Promise.resolve();
      const run = previous.then(callback);
      const tail = run.catch(() => {});
      tails.set(name, tail);
      return run.finally(() => {
        if (tails.get(name) === tail) tails.delete(name);
      });
    },
  };
}

function f133FlagHarness(fetchImpl) {
  const context = {
    CAL_SUPABASE_URL: 'https://example.invalid',
    CAL_SUPABASE_ANON_KEY: 'anon-fixture',
    F133_CANONICAL_TITLE_FLAG_TIMEOUT_MS: 50,
    AbortController,
    fetch: fetchImpl,
    setTimeout, clearTimeout,
    _calV2Log: () => {},
    _canonicalTitleTimers: { calendar: {}, sxr: {} },
    _canonicalTitleResumePending: async () => ({}),
    _f133RefreshVisibleUi: () => {},
    fetchLinearProjects: async () => {},
    currentNav: 'home', linearClientRows: [], _writeUiRerouteClients: new Set(),
    _linearRebuildProjectSource: () => {}, _linearReconcileProjectSelection: () => {},
    calClientSlug: value => String(value || ''),
    console: { warn() {} },
  };
  vm.createContext(context);
  vm.runInContext([
    "const F133_CANONICAL_TITLE_FLAG_KEY = 'f133_canonical_title_enabled';",
    "let _f133CanonicalTitleFlagState = 'loading';",
    'let _f133CanonicalTitleFlagEpoch = 0;',
    extract(ui, '_f133CanonicalTitleFlagValue'),
    extract(ui, '_f133CanonicalTitleIsEnabled'),
    extract(ui, '_f133CanonicalTitleIsAbsent'),
    extract(ui, '_f133CanonicalTitleOwnsLinkedNames'),
    extract(ui, '_f133CanonicalTitleIntakeVersion'),
    extract(ui, '_f133CanonicalTitleCanAdoptCommittedV3'),
    extract(ui, '_f133SetCanonicalTitleFlagState'),
    extract(ui, '_f133SetCanonicalTitleFlagValue'),
    extract(ui, '_f133FetchCanonicalTitleFlagOnce'),
  ].join('\n'), context);
  return context;
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href + '?f133=' + Date.now());

  ok(policy.canonicalTitle('  August\t product\n reveal  ') === 'August product reveal'
    && policy.canonicalTitle('   ') === null
    && policy.canonicalTitle('bad\u0000title') === null
    && policy.canonicalTitle('x'.repeat(501)) === null
    && policy.genericTitlePlaceholder('  VIDEO   1 ') === true
    && policy.genericTitlePlaceholder('Graphic 12') === true
    && policy.genericTitlePlaceholder('Graphics 12') === true
    && policy.genericTitlePlaceholder('Video launch plan') === false,
  'canonical title validation collapses whitespace and rejects blank, control, NUL, and overlong values');

  const absentBrowserFlag = f133FlagHarness(async () => ({ ok: true, json: async () => [] }));
  await absentBrowserFlag._f133FetchCanonicalTitleFlagOnce();
  ok(absentBrowserFlag._f133CanonicalTitleIsAbsent() === true
    && absentBrowserFlag._f133CanonicalTitleOwnsLinkedNames() === false
    && absentBrowserFlag._f133CanonicalTitleIntakeVersion() === 3,
  'an actually absent F133 row alone preserves the pre-install v3 lane');

  for (const [label, fetchImpl] of [
    ['duplicate rows', async () => ({ ok: true, json: async () => [{ value: { enabled: true } }, { value: { enabled: true } }] })],
    ['string boolean', async () => ({ ok: true, json: async () => [{ value: { enabled: 'true' } }] })],
    ['extra field', async () => ({ ok: true, json: async () => [{ value: { enabled: true, extra: false } }] })],
    ['read outage', async () => { throw new Error('offline'); }],
  ]) {
    const flag = f133FlagHarness(fetchImpl);
    await flag._f133FetchCanonicalTitleFlagOnce();
    ok(flag._f133CanonicalTitleIsEnabled() === false
      && flag._f133CanonicalTitleOwnsLinkedNames() === true
      && flag._f133CanonicalTitleIntakeVersion() == null,
    'F133 fails closed against old and new split writes for ' + label);
  }
  const pausedBrowserFlag = f133FlagHarness(async () => ({ ok: true, json: async () => [{ value: { enabled: false } }] }));
  await pausedBrowserFlag._f133FetchCanonicalTitleFlagOnce();
  ok(pausedBrowserFlag._f133CanonicalTitleIsEnabled() === false
    && pausedBrowserFlag._f133CanonicalTitleOwnsLinkedNames() === true
    && pausedBrowserFlag._f133CanonicalTitleIntakeVersion() == null
    && pausedBrowserFlag._f133CanonicalTitleCanAdoptCommittedV3() === true,
  'exact false is an installed pause that blocks new intake while retaining committed-v3 adoption');
  ok(runbook.includes('An absent row alone is\nthe pre-install v3 state.')
    && runbook.includes('Exact false is a visible installed pause')
    && runbook.includes('no new v3/v4 intake or title mutation')
    && runbook.includes('exact already-committed v3 receipt recoverable through the authenticated\nadopter')
    && runbook.includes('Loading, duplicate, malformed, or unreadable state also blocks new split writes.'),
  'the operator runbook pins absent-only legacy compatibility and fail-closed installed pause semantics');
  const exactBrowserFlag = f133FlagHarness(async () => ({ ok: true, json: async () => [{ value: { enabled: true } }] }));
  await exactBrowserFlag._f133FetchCanonicalTitleFlagOnce();
  ok(exactBrowserFlag._f133CanonicalTitleIsEnabled() === true
    && exactBrowserFlag._f133CanonicalTitleOwnsLinkedNames() === true
    && exactBrowserFlag._f133CanonicalTitleIntakeVersion() === 4,
  'only one exact {enabled:true} row activates F133');

  let releaseStaleRead;
  const staleRead = new Promise(resolve => { releaseStaleRead = resolve; });
  const staleBrowserFlag = f133FlagHarness(async () => {
    await staleRead;
    return { ok: true, json: async () => [{ value: { enabled: true } }] };
  });
  const staleFlagRequest = staleBrowserFlag._f133FetchCanonicalTitleFlagOnce();
  staleBrowserFlag._f133SetCanonicalTitleFlagValue({ enabled: false }, 1);
  releaseStaleRead();
  await staleFlagRequest;
  ok(staleBrowserFlag._f133CanonicalTitleIsEnabled() === false
    && staleBrowserFlag._f133CanonicalTitleIntakeVersion() == null,
  'a delayed exact-true GET cannot overwrite a newer exact-false realtime observation');

  const primeSource = extract(ui, '_calPrimeUpsertRoutingFlag');
  ok(primeSource.includes('_f133PrimeCanonicalTitleFlag();')
    && /Promise\.all\(\[_calFetchUpsertFlagOnce\(\), _writeUiPrimeRerouteFlag\(\)\]\)/.test(primeSource)
    && !/Promise\.all\([^\]]*f133/.test(primeSource),
  'F133 primes independently and cannot add its timeout to legacy Calendar/write routing');
  let subscribed = false;
  const primeContext = {
    _f133PrimeCanonicalTitleFlag: () => new Promise(() => {}),
    _calUpsertFlagPromise: null,
    _calFetchUpsertFlagOnce: async () => {},
    _writeUiPrimeRerouteFlag: async () => {},
    _calSubscribeUpsertFlag: async () => { subscribed = true; },
  };
  vm.createContext(primeContext);
  vm.runInContext(primeSource, primeContext);
  const legacyPrimeResult = await Promise.race([
    primeContext._calPrimeUpsertRoutingFlag().then(() => 'resolved'),
    new Promise(resolve => setTimeout(() => resolve('timed-out'), 40)),
  ]);
  ok(legacyPrimeResult === 'resolved' && subscribed,
  'a hung F133 read cannot delay the existing routing prime or realtime subscription');
  const flagSubscription = extract(ui, '_calSubscribeUpsertFlag');
  ok(flagSubscription.includes("filter: 'key=eq.' + F133_CANONICAL_TITLE_FLAG_KEY")
    && flagSubscription.includes('_f133SetCanonicalTitleFlagValue(row ? row.value : null, row ? 1 : 0)')
    && flagSubscription.includes("status === 'SUBSCRIBED'")
    && flagSubscription.includes('_f133FetchCanonicalTitleFlagOnce()')
    && /CHANNEL_ERROR[\s\S]*TIMED_OUT[\s\S]*CLOSED/.test(flagSubscription)
    && /if \(!client\) \{ _f133SetCanonicalTitleFlagState\('unavailable'\); return; \}/.test(flagSubscription)
    && /catch \(e\)[\s\S]*_calUpsertFlagChannel = null;[\s\S]*_f133SetCanonicalTitleFlagState\('unavailable'\)/.test(flagSubscription),
  'the shared runtime subscription closes its initial-read handoff and fails F133 closed on channel loss');

  ok(/id="calNativePostCanonicalTitle"[^>]*maxlength="500"[^>]*required/.test(ui)
    && /id="vid_title_\$\{num\}"[^>]*maxlength="500"[^>]*required/.test(ui)
    && /canonical_title_required/.test(extract(ui, '_linearIntakeItems'))
    && /title: canonicalTitle/.test(extract(ui, '_calSubmitNativePost')),
  'Calendar Create Post and every Submit post require the canonical title before commit');
  ok(/const canonicalTitleHtml = Number\(state\.version \|\| 3\) >= 4/.test(extract(ui, '_calRenderNativePostChoice'))
    && /const canonicalTitleInput = _f133CanonicalTitleOwnsLinkedNames\(\)/.test(extract(ui, 'renderVideoCard'))
    && /canonicalPaused[^]*aria-disabled="true"[^]*readonly/.test(extract(ui, '_calTitleRowHtml'))
    && /canonicalPaused[^]*aria-disabled="true"[^]*readonly/.test(extract(ui, '_sxrTitleRowHtml')),
  'installed F133 owns real-title controls and renders linked names visibly read-only while paused');

  const intake = section(gateway, 'async function handleIntakeCreate(', '\nDeno.serve(');
  ok(/production_intake_commit/.test(intake)
    && /p_cards: plannedCards/.test(intake)
    && /card_materialization: "server_committed"/.test(intake)
    && /genericTitlePlaceholder\(title\)[\s\S]*canonical_title_placeholder_forbidden/.test(intake)
    && !/await ensureBatch\(|await ensureDeliverable\(/.test(intake),
  'new and append intake use the one transactional deliverable-plus-card commit contract');
  const exactFlag = vm.runInNewContext('(' + extract(gateway, 'f133FlagIsExactlyEnabled')
    .replace('(value: unknown): boolean', '(value)') + ')', {
    parseJson: value => {
      if (!value) return {};
      if (typeof value === 'object' && !Array.isArray(value)) return value;
      try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch (_error) { return {}; }
    },
  });
  const GatewayError = class extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  };
  const intakeVersion = vm.runInNewContext('(' + extract(gateway, 'intakeContractVersion')
    .replace('(body: JsonMap): 3 | 4', '(body)') + ')', { GatewayError });
  const flagStateSource = extract(gateway, 'f133CanonicalTitleFlagState');
  let invalidVersion = '';
  try { intakeVersion({ intake_version: '4' }); } catch (error) { invalidVersion = error.code; }
  ok(exactFlag({ enabled: true }) === true
    && exactFlag({ enabled: false }) === false
    && exactFlag({ enabled: true, extra: false }) === false
    && exactFlag(null) === false
    && intakeVersion({}) === 3
    && intakeVersion({ intake_version: 4 }) === 4
    && invalidVersion === 'native_intake_version_invalid'
    && /if \(!data\)[\s\S]*production_intake_v3_card_contract[\s\S]*f133CapabilityIsExactlyMissing\(probe\.error\) \? "legacy" : "invalid"/.test(flagStateSource)
    && /parsed\.enabled === true \? "enabled" : "paused"/.test(flagStateSource)
    && /catch \(_error\) \{[\s\S]{0,40}return "invalid"/.test(flagStateSource),
  'F133 activation is exact-true, absent-only legacy, exact-false paused, fail-closed on read errors, and accepts only missing-v3 or numeric-v4 intake contracts');
  ok(intake.indexOf('intakeActivationReceiptKeys(') < intake.indexOf('f133CanonicalTitleFlagState(supabase)')
    && /activationNeedsReplay && activationReceiptKeys\.size === 0/.test(intake)
    && /intakeVersion === 3[\s\S]*production_intake_append_v3/.test(intake)
    && /intakeVersion === 4[\s\S]*production_intake_commit/.test(intake)
    && (intake.match(/intake_version: 4/g) || []).length >= 5
    && /_intake_version: 4/.test(intake)
    && /exactStoredIntakeVersion\(payload, expectedPayload\)/.test(gateway),
  'receipt-first activation never routes v3 into v4 and echoes the exact v4 contract on new and append success');
  const exactStoredVersion = vm.runInNewContext('(' + extract(gateway, 'exactStoredIntakeVersion')
    .replace('(payload: JsonMap, expectedPayload: JsonMap): boolean', '(payload, expectedPayload)') + ')');
  ok(exactStoredVersion({}, {}) === true
    && exactStoredVersion({ _intake_version: 4 }, { _intake_version: 4 }) === true
    && exactStoredVersion({}, { _intake_version: 4 }) === false
    && exactStoredVersion({ _intake_version: 4 }, {}) === false
    && exactStoredVersion({ _intake_version: '4' }, { _intake_version: 4 }) === false,
  'same-request cross-version receipts and non-numeric version markers cannot authorize replay');
  const activationReplay = vm.runInNewContext('(' + extract(gateway, 'assertIntakeActivationReplay')
    .replace('intakeVersion: 3 | 4,', 'intakeVersion,')
    .replace('activationNeedsReplay: boolean,', 'activationNeedsReplay,')
    .replace('observedKeys: Set<string>,', 'observedKeys,')
    .replace('expectedKeys: Set<string>,', 'expectedKeys,')
    .replace('exactReplayKeys: Set<string>,', 'exactReplayKeys,')
    .replace('): void', ')') + ')', { GatewayError });
  const activationCase = (version, observed, expected, exact) => {
    try {
      activationReplay(version, true, new Set(observed), new Set(expected), new Set(exact));
      return 'PASS';
    } catch (error) { return error.code; }
  };
  ok(activationCase(4, ['parent', 'video'], ['parent', 'video'], ['parent', 'video']) === 'PASS'
    && activationCase(4, ['parent'], ['parent', 'video'], ['parent']) === 'native_intake_activation_changed'
    && activationCase(3, ['parent'], ['parent', 'video'], ['parent']) === 'PASS'
    && activationCase(3, ['foreign-team'], ['parent', 'video'], ['foreign-team']) === 'idempotency_conflict'
    && activationCase(3, ['parent', 'extra-item'], ['parent', 'video'], ['parent', 'extra-item']) === 'idempotency_conflict',
  'activation replay accepts exact atomic v4 or an exact durable v3 subset, but rejects partial v4 and altered team/item sets');
  ok(/legacyMaterialization/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar'))
    && /operation: 'intake_recover'/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar'))
    && /card_materialization \|\| ''\) !== 'server_committed'/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar'))
    && /useReviewedV3Adopter/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar'))
    && /recordedVersion === 3 && _f133CanonicalTitleCanAdoptCommittedV3\(\)/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar'))
    && /_calUpsertFetch\(clientSlug/.test(extract(ui, '_writeNativeSubmissionCardsToCalendar')),
  'recorded v3 recovery uses the frozen writer only pre-install and the reviewed adopter in installed pause or ON');

  const titleHandler = section(gateway, 'async function handleTitleOperation(', '\nasync function handleEntityOperation(');
  ok(/operation: "title"/.test(titleHandler)
    && /production_canonical_title_write/.test(titleHandler)
    && /genericTitlePlaceholder\(title\)[\s\S]*canonical_title_placeholder_forbidden/.test(titleHandler)
    && /expected_deliverable_titles: expectedDeliverableTitles/.test(titleHandler)
    && /action: "title_change"/.test(titleHandler)
    && /asynchronous: !receiptNoop/.test(titleHandler)
    && !/targetedDrain|scheduleSyncviewLiveDrains/.test(titleHandler),
  'authenticated title CAS commits natively and leaves every Linear mirror mutation asynchronous');
  ok(titleHandler.indexOf('const priorEvent =') < titleHandler.indexOf('f133CanonicalTitleFlagState(supabase)')
    && /!priorEvent && !repairEnvelope && f133FlagState !== "enabled"/.test(titleHandler)
    && /repairEnvelope && f133FlagState !== "paused"/.test(titleHandler)
    && /canonical_title_feature_disabled/.test(titleHandler),
  'the title kill gate rejects new mutations, confines reviewed repair to installed pause, and adopts an exact durable receipt first');
  ok(/principal\.keyRole === "admin" \|\| principal\.keyRole === "smm"/.test(gateway)
    && /canonical_title_client_collab_required/.test(gateway)
    && /principal\.kind !== "client" \|\| surface !== "calendar"/.test(gateway),
  'title authorization preserves staff and Calendar-collaborative client policy without opening Samples or creative writes');

  ok(/operation in \('create', 'status', 'comment', 'title'\)/.test(migration)
    && /LEGACY_PARITY_OPERATIONS = new Set\(\["create", "status", "comment", "title"\]\)/.test(outbound)
    && /\(lane === "calendar" \|\| lane === "sxr"\)[\s\S]{0,100}op === "title"/.test(policySource),
  'the database, gateway policy, and drainer share the exact closed title-parity contract');

  ok(/before insert or update of name, title_revision,[\s\S]{0,80}video_deliverable_id, graphic_deliverable_id/.test(migration)
    && /f133_linked_card_title_requires_canonical_rpc/.test(migration)
    && /f133_linked_card_linkage_requires_canonical_rpc/.test(migration)
    && /revoke all on function public\.production_canonical_title_write/.test(migration)
    && /to service_role/.test(migration),
  'database guards prevent frozen writers from splitting linked card titles or linkage');

  ok(/insert into public\.deliverable_events[\s\S]*'title_change'/.test(migration)
    && /for v_index in 0\.\.v_count - 1[\s\S]*mirror_outbox_enqueue/.test(migration)
    && /'noop', true/.test(migration)
    && /'replayed', true/.test(migration)
    && (migration.match(/\^\(video\|graphics\?\)\[\[:space:\]\]\+\[0-9\]\+\$/g) || []).length === 4,
  'one title transaction records one title_change, one intent per linked row, exact no-op, and exact replay');

  const normal = browserHarness();
  const normalInput = normal.input();
  normal.context._canonicalTitleBegin('calendar', normalInput);
  normalInput.value = '  Revised   canonical title  ';
  await normal.context._canonicalTitleFlush('calendar', normalInput);
  ok(normal.requests.length === 1
    && normal.requests[0].expected_title === 'Original title'
    && normal.requests[0].title === 'Revised canonical title'
    && normal.context.calState.posts[0].name === 'Revised canonical title'
    && normal.context._canonicalTitleJournalRead().length === 0
    && normal.context._f133LatestTitleObservationCorrelationSha256()
      === createHash('sha256').update(normal.requests[0].request_id).digest('hex'),
  'one linked-card edit sends one stable CAS, adopts equality, and exposes only its request SHA for TEST observation');

  const commitSource = extract(ui, '_canonicalTitleCommitRecord');
  ok(commitSource.indexOf('_canonicalTitleJournalUpsert(current)')
      < commitSource.indexOf('await _canonicalTitleRememberObservationCorrelation(current.request_id)')
    && commitSource.indexOf('await _canonicalTitleRememberObservationCorrelation(current.request_id)')
      < commitSource.indexOf('await fetch(WRITE_UI_PRODUCTION_WRITE_URL')
    && extract(ui, '_f133LatestTitleObservationCorrelationSha256')
      .includes("return /^[a-f0-9]{64}$/.test(hash) ? hash : '';"),
  'the TEST correlation is written only after durable intent readback and before network, and its getter returns a SHA only');

  for (const surface of ['calendar', 'sxr']) {
    const paused = browserHarness(null, { surface, f133State: 'disabled' });
    const pausedInput = paused.input(surface);
    pausedInput.value = 'Blocked installed-pause title';
    ok(paused.context._canonicalTitleBegin(surface, pausedInput) === false
      && paused.context._canonicalTitleOnInput(surface, pausedInput) === true
      && paused.context._canonicalTitleOnBlur(surface, pausedInput) === true
      && paused.requests.length === 0 && paused.storage.size === 0 && paused.timers.size === 0
      && paused.statuses.some(row => row.message === 'canonical_title_feature_disabled'),
    surface + ' exact-false installed pause owns the linked field and cannot fall through to a frozen writer');

    const absent = browserHarness(null, { surface, f133State: 'absent' });
    const absentInput = absent.input(surface);
    absentInput.value = 'Pre-install legacy title';
    ok(absent.context._canonicalTitleBegin(surface, absentInput) === false
      && absent.context._canonicalTitleOnInput(surface, absentInput) === false
      && absent.context._canonicalTitleOnBlur(surface, absentInput) === false
      && absent.requests.length === 0 && absent.storage.size === 0 && absent.timers.size === 0,
    surface + ' only an absent flag row allows exact pre-install frozen-writer fallthrough');
  }

  const killedDebt = browserHarness();
  const killedInput = killedDebt.input();
  killedDebt.context._canonicalTitleBegin('calendar', killedInput);
  killedInput.value = 'Durable before kill';
  killedDebt.setFetch(async (_url, options) => {
    killedDebt.requests.push(JSON.parse(options.body));
    throw new Error('lost response');
  });
  await killedDebt.context._canonicalTitleFlush('calendar', killedInput);
  const requestsAtKill = killedDebt.requests.length;
  killedDebt.setF133Enabled(false);
  const resumeWhileOff = await killedDebt.context._canonicalTitleResumePending();
  const blockedByDebt = killedDebt.context._canonicalTitleOnInput('calendar', killedInput);
  ok(requestsAtKill === 1
    && resumeWhileOff.deferred === 1
    && blockedByDebt === true
    && killedDebt.requests.length === requestsAtKill
    && killedDebt.context._canonicalTitleJournalRead().length === 1,
  'a kill preserves durable title debt, emits no new title request, and never leaks that debt to the frozen writer');

  const beforeDebounce = browserHarness();
  const beforeDebounceInput = beforeDebounce.input();
  beforeDebounce.context._canonicalTitleBegin('calendar', beforeDebounceInput);
  beforeDebounceInput.value = 'Persisted before debounce';
  beforeDebounce.context._canonicalTitleOnInput('calendar', beforeDebounceInput);
  const synchronousDrafts = [...beforeDebounce.storage.entries()]
    .filter(([key]) => key.startsWith('syncview_canonical_title_draft_v1:'))
    .map(([, value]) => JSON.parse(value));
  ok(beforeDebounce.requests.length === 0
    && beforeDebounce.timers.size === 1
    && synchronousDrafts.length === 1
    && synchronousDrafts[0].title === 'Persisted before debounce'
    && synchronousDrafts[0].expected_title === 'Original title',
  'each input event persists its exact draft synchronously before debounce or network work');
  const afterReload = browserHarness(beforeDebounce.storage);
  await afterReload.context._canonicalTitleResumePending();
  ok(afterReload.requests.length === 1
    && afterReload.requests[0].title === 'Persisted before debounce'
    && afterReload.requests[0].expected_title === 'Original title'
    && afterReload.context.calState.posts[0].name === 'Persisted before debounce'
    && afterReload.context._canonicalTitleJournalRead().length === 0
    && afterReload.storage.size === 0,
  'reload recovery promotes the synchronous draft and commits the exact persisted title');

  for (const [label, value] of [
    ['whitespace-only', '   \t  '],
    ['control-character', 'Unsafe\u0001title'],
    ['generated Video N placeholder', '  VIDEO   1 '],
    ['generated Graphic N placeholder', 'Graphic 12'],
  ]) {
    const invalid = browserHarness();
    const invalidInput = invalid.input();
    invalid.context._canonicalTitleBegin('calendar', invalidInput);
    invalidInput.value = value;
    invalid.context._canonicalTitleOnInput('calendar', invalidInput);
    await invalid.context._canonicalTitleFlush('calendar', invalidInput);
    ok(invalidInput.value === value
      && invalid.context.calState.posts[0].name === 'Original title'
      && invalid.context.calState.posts[0]._canonicalTitleDraft == null
      && invalid.storage.size === 0 && invalid.requests.length === 0
      && invalid.statuses.some(row => row.value === 'error'),
    label + ' input stays visible for validation but never mutates the cached canonical title');
  }

  const invalidAfterValid = browserHarness();
  const invalidAfterValidInput = invalidAfterValid.input();
  invalidAfterValid.context._canonicalTitleBegin('calendar', invalidAfterValidInput);
  invalidAfterValidInput.value = 'Valid but not sent';
  invalidAfterValid.context._canonicalTitleOnInput('calendar', invalidAfterValidInput);
  invalidAfterValidInput.value = '   ';
  invalidAfterValid.context._canonicalTitleOnInput('calendar', invalidAfterValidInput);
  ok(invalidAfterValid.context.calState.posts[0].name === 'Original title'
    && invalidAfterValid.context.calState.posts[0]._canonicalTitleDraft == null
    && invalidAfterValid.storage.size === 0
    && invalidAfterValid.requests.length === 0,
  'an invalid edit supersedes and removes an unsent valid draft instead of replaying stale input after reload');

  for (const phase of ['draft', 'journal']) {
    const unavailable = browserHarness(null, {
      storageFailure: key => key.startsWith(phase === 'draft'
        ? 'syncview_canonical_title_draft_v1:'
        : 'syncview_canonical_title_intent_v1:'),
    });
    const unavailableInput = unavailable.input();
    unavailable.context._canonicalTitleBegin('calendar', unavailableInput);
    unavailableInput.value = 'Visible but not durable';
    if (phase === 'draft') {
      unavailable.context._canonicalTitleOnInput('calendar', unavailableInput);
    } else {
      await unavailable.context._canonicalTitleFlush('calendar', unavailableInput);
    }
    ok(unavailableInput.value === 'Visible but not durable'
      && unavailable.context.calState.posts[0].name === 'Original title'
      && unavailable.context.calState.posts[0]._canonicalTitleDraft == null
      && unavailable.requests.length === 0
      && unavailable.statuses.some(row => row.value === 'error'
        && row.message === 'title_intent_storage_unavailable'),
    'a ' + phase + ' storage failure cannot mutate cached post.name before a durable intent exists');
  }

  const noOp = browserHarness();
  const noOpInput = noOp.input();
  noOp.context._canonicalTitleBegin('calendar', noOpInput);
  noOpInput.value = '  Original   title ';
  await noOp.context._canonicalTitleFlush('calendar', noOpInput);
  ok(noOp.requests.length === 0 && noOp.context._canonicalTitleJournalRead().length === 0,
  'a whitespace-equivalent no-op creates no request, event intent, or duplicate journal row');

  // Accepting the title reported by a conflict looks like a local no-op, but
  // the server can move again before the user confirms it. The superseding
  // intent must therefore make an authenticated no-op CAS rather than clear
  // the durable conflict from browser state alone.
  const movedAgain = browserHarness(null, {
    initialName: 'Server title B', initialRevision: 1, requestPrefix: 'accept-b',
  });
  const movedAgainPost = movedAgain.context.calState.posts[0];
  const conflictAtB = {
    version: 1, surface: 'calendar', client_slug: 'fixture', card_id: 'card-1',
    expected_title: 'Original title A', title: 'Stale tab title',
    request_id: 'conflict-at-b', source_edited_at: '2026-08-02T01:00:00.000Z',
    created_at: '2026-08-02T01:00:00.000Z', principal: 'staff:actor-a',
    tab_id: 'closed-tab-b', predecessor_request_id: null, supersedes_request_id: null,
    attempted: true, blocked: true, draft: false, current_title: 'Server title B',
    current_title_revision: 1,
  };
  movedAgain.context._canonicalTitleJournalUpsert(conflictAtB);
  movedAgainPost._canonicalTitleBase = 'Server title B';
  movedAgainPost._canonicalTitleBlockedRequestId = conflictAtB.request_id;
  const acceptBInput = movedAgain.input();
  movedAgain.context._canonicalTitleBegin('calendar', acceptBInput);
  acceptBInput.value = '  Server   title B  ';
  movedAgain.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    movedAgain.requests.push(body);
    return {
      ok: false, status: 409,
      json: async () => ({
        ok: false, error: 'write_conflict', current_title: 'Server title C', current_title_revision: 2,
      }),
    };
  });
  await movedAgain.context._canonicalTitleFlush('calendar', acceptBInput);
  const movedDebt = movedAgain.context._canonicalTitleJournalRead().filter(row => row.blocked === true);
  const conflictAtC = movedDebt.find(row => row.current_title === 'Server title C');
  ok(movedAgain.requests.length === 1
    && movedAgain.requests[0].expected_title === 'Server title B'
    && movedAgain.requests[0].title === 'Server title B'
    && movedDebt.some(row => row.request_id === conflictAtB.request_id)
    && conflictAtC && conflictAtC.supersedes_request_id === conflictAtB.request_id
    && movedAgainPost._canonicalTitleBase === 'Server title C'
    && movedAgainPost._canonicalTitleBlockedRequestId === conflictAtC.request_id,
  'accepting conflict title B sends a server CAS and preserves rebased debt when the remote title has moved to C');

  const capped = browserHarness();
  for (let index = 0; index < 100; index++) {
    capped.context._canonicalTitleJournalUpsert({
      request_id: `intent-${String(index).padStart(3, '0')}`,
      created_at: `2026-08-02T00:00:${String(index % 60).padStart(2, '0')}.000Z`,
    });
  }
  let capError = null;
  try {
    capped.context._canonicalTitleJournalUpsert({ request_id: 'intent-over-limit' });
  } catch (error) { capError = error; }
  ok(capped.storage.size === 100
    && [...capped.storage.keys()].every(key => key.startsWith('syncview_canonical_title_intent_v1:'))
    && capError && capError.code === 'title_intent_storage_full'
    && capped.context._canonicalTitleJournalRead().length === 100,
  'the journal stores one record per key and fails closed at capacity without dropping older intents');

  const lost = browserHarness();
  const lostInput = lost.input();
  lost.context._canonicalTitleBegin('calendar', lostInput);
  lostInput.value = 'Recovered after lost response';
  let firstBody = null;
  lost.setFetch(async (_url, options) => {
    firstBody = JSON.parse(options.body);
    lost.requests.push(firstBody);
    throw new Error('simulated lost acknowledgement');
  });
  await lost.context._canonicalTitleFlush('calendar', lostInput);
  ok(lost.context._canonicalTitleJournalRead().length === 1,
  'an offline or lost-response failure retains the exact durable title intent');
  lost.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    lost.requests.push(body);
    return {
      ok: true, status: 200,
      json: async () => titleReceipt(body, { replayed: true }),
    };
  });
  await lost.context._canonicalTitleResumePending();
  ok(lost.requests.length === 2
    && JSON.stringify(lost.requests[0]) === JSON.stringify(lost.requests[1])
    && lost.context._canonicalTitleJournalRead().length === 0
    && lost.context.calState.posts[0].name === 'Recovered after lost response',
  'reload/online recovery replays the byte-identical request and clears only after the committed receipt');

  const duplicate = browserHarness();
  const duplicateInput = duplicate.input();
  duplicate.context._canonicalTitleBegin('calendar', duplicateInput);
  duplicateInput.value = 'One commit from blur and debounce';
  let releaseFetch;
  duplicate.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    duplicate.requests.push(body);
    await new Promise(resolve => { releaseFetch = resolve; });
    return {
      ok: true, status: 201,
      json: async () => titleReceipt(body),
    };
  });
  const firstFlush = duplicate.context._canonicalTitleFlush('calendar', duplicateInput);
  for (let attempt = 0; attempt < 20 && typeof releaseFetch !== 'function'; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const secondFlush = duplicate.context._canonicalTitleFlush('calendar', duplicateInput);
  releaseFetch();
  await Promise.all([firstFlush, secondFlush]);
  ok(duplicate.requests.length === 1 && duplicate.context._canonicalTitleJournalRead().length === 0,
  'duplicate blur/debounce delivery shares one in-flight request and one durable mutation');

  const sequential = browserHarness(null, { locks: queuedLockManager() });
  const sequentialInput = sequential.input();
  sequential.context._canonicalTitleBegin('calendar', sequentialInput);
  let releaseFirst;
  sequential.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    sequential.requests.push(body);
    if (sequential.requests.length === 1) {
      await new Promise(resolve => { releaseFirst = resolve; });
    }
    return { ok: true, status: 201, json: async () => titleReceipt(body) };
  });
  sequentialInput.value = 'First queued edit';
  sequential.context._canonicalTitleOnInput('calendar', sequentialInput);
  const sequentialFirst = sequential.context._canonicalTitleFlush('calendar', sequentialInput);
  await new Promise(resolve => setImmediate(resolve));
  sequentialInput.value = 'Second queued edit';
  sequential.context._canonicalTitleOnInput('calendar', sequentialInput);
  const sequentialSecond = sequential.context._canonicalTitleFlush('calendar', sequentialInput);
  await new Promise(resolve => setImmediate(resolve));
  const queuedBeforeAck = sequential.context._canonicalTitleJournalRead();
  releaseFirst();
  await Promise.all([sequentialFirst, sequentialSecond]);
  for (let attempt = 0; attempt < 20
    && (sequential.requests.length < 2 || sequential.context._canonicalTitleJournalRead().length); attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  ok(queuedBeforeAck.length === 2
    && sequential.requests.length === 2
    && sequential.requests[0].title === 'First queued edit'
    && sequential.requests[0].expected_title === 'Original title'
    && sequential.requests[1].title === 'Second queued edit'
    && sequential.requests[1].expected_title === 'First queued edit'
    && sequential.requests[0].request_id !== sequential.requests[1].request_id
    && queuedBeforeAck[1].predecessor_request_id === queuedBeforeAck[0].request_id
    && sequential.context.calState.posts[0].name === 'Second queued edit'
    && sequential.context._canonicalTitleJournalRead().length === 0,
  'a second edit made during the first request is retained through an immutable predecessor chain');

  const wrongReceipt = browserHarness();
  const wrongReceiptInput = wrongReceipt.input();
  wrongReceipt.context._canonicalTitleBegin('calendar', wrongReceiptInput);
  wrongReceiptInput.value = 'Do not adopt a mismatched receipt';
  wrongReceipt.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    wrongReceipt.requests.push(body);
    return {
      ok: true,
      status: 201,
      json: async () => titleReceipt(body, { card: { client: 'different-client' } }),
    };
  });
  await wrongReceipt.context._canonicalTitleFlush('calendar', wrongReceiptInput);
  ok(wrongReceipt.requests.length === 1
    && wrongReceipt.context._canonicalTitleJournalRead().length === 1
    && wrongReceipt.context._canonicalTitleJournalRead()[0].attempted === true
    && wrongReceipt.context.calState.posts[0]._canonicalTitleDraft === 'Do not adopt a mismatched receipt'
    && wrongReceipt.statuses.some(row => row.value === 'error'
      && row.message === 'canonical_title_receipt_invalid'),
  'a receipt with the wrong card identity is rejected and its durable intent remains retryable');

  const receiptSabotage = [
    ['row client scope', receipt => { receipt.rows[0].client_slug = 'other-client'; }],
    ['row origin', receipt => { receipt.rows[0].origin = 'samples'; }],
    ['row card binding', receipt => { receipt.rows[0].card_id = 'other-card'; }],
    ['event key', receipt => { receipt.event_key = 'write-ui:title:card:calendar:fixture:card-1:wrong'; }],
  ];
  for (const [label, sabotage] of receiptSabotage) {
    const h = browserHarness();
    const input = h.input();
    h.context._canonicalTitleBegin('calendar', input);
    input.value = 'Exact receipt or no adoption';
    h.setFetch(async (_url, options) => {
      const body = JSON.parse(options.body);
      h.requests.push(body);
      const receipt = titleReceipt(body);
      sabotage(receipt);
      return { ok: true, status: 201, json: async () => receipt };
    });
    await h.context._canonicalTitleFlush('calendar', input);
    ok(h.requests.length === 1 && h.context._canonicalTitleJournalRead().length === 1
      && h.statuses.some(row => row.value === 'error'
        && row.message === 'canonical_title_receipt_invalid'),
    'title adoption rejects a receipt with the wrong ' + label);
  }

  const tabs = browserHarness(null, { locks: queuedLockManager() });
  const left = tabs.input();
  const right = tabs.input();
  tabs.context._canonicalTitleBegin('calendar', left);
  tabs.context._canonicalTitleBegin('calendar', right);
  left.value = 'First tab wins';
  await tabs.context._canonicalTitleFlush('calendar', left);
  tabs.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    tabs.requests.push(body);
    return {
      ok: false, status: 409,
      json: async () => ({
        ok: false, error: 'write_conflict', current_title: 'First tab wins', current_title_revision: 1,
      }),
    };
  });
  right.value = 'Stale second tab';
  await tabs.context._canonicalTitleFlush('calendar', right);
  const blocked = tabs.context._canonicalTitleJournalRead().find(row => row.title === 'Stale second tab');
  ok(tabs.requests.length === 2 && blocked && blocked.blocked === true
    && tabs.context.calState.posts[0]._canonicalTitleBase === 'First tab wins'
    && tabs.context.calState.posts[0]._canonicalTitleDraft === 'Stale second tab',
  'two tabs serialize by card; a stale base is blocked while preserving the draft and authoritative server base');

  const sharedTabStorage = new Map();
  const sharedLocks = queuedLockManager();
  const tabA = browserHarness(sharedTabStorage, { tabId: 'tab-a', requestPrefix: 'tab-a', locks: sharedLocks });
  const tabB = browserHarness(sharedTabStorage, { tabId: 'tab-b', requestPrefix: 'tab-b', locks: sharedLocks });
  const tabAInput = tabA.input();
  const tabBInput = tabB.input();
  tabA.context._canonicalTitleBegin('calendar', tabAInput);
  tabB.context._canonicalTitleBegin('calendar', tabBInput);
  tabAInput.value = 'First cross-tab title';
  tabBInput.value = 'Independent stale title';
  tabA.context._canonicalTitleOnInput('calendar', tabAInput);
  tabB.context._canonicalTitleOnInput('calendar', tabBInput);
  const stagedTabDrafts = [...sharedTabStorage.entries()]
    .filter(([key]) => key.startsWith('syncview_canonical_title_draft_v1:'))
    .map(([, value]) => JSON.parse(value));
  let releaseTabA;
  const crossTabFetch = async (harness, _url, options) => {
    const body = JSON.parse(options.body);
    harness.requests.push(body);
    if (body.title === 'First cross-tab title') {
      await new Promise(resolve => { releaseTabA = resolve; });
      return { ok: true, status: 201, json: async () => titleReceipt(body) };
    }
    return {
      ok: false, status: 409,
      json: async () => ({
        ok: false, error: 'write_conflict', current_title: 'First cross-tab title', current_title_revision: 1,
      }),
    };
  };
  tabA.setFetch((...args) => crossTabFetch(tabA, ...args));
  tabB.setFetch((...args) => crossTabFetch(tabB, ...args));
  const tabAFlush = tabA.context._canonicalTitleFlush('calendar', tabAInput);
  while (!releaseTabA) await new Promise(resolve => setImmediate(resolve));
  const tabBFlush = tabB.context._canonicalTitleFlush('calendar', tabBInput);
  await new Promise(resolve => setImmediate(resolve));
  // A realtime read may update the second tab before its queued lock opens.
  // Its persisted CAS base must nevertheless remain immutable.
  tabB.context.calState.posts[0]._canonicalTitleBase = 'First cross-tab title';
  releaseTabA();
  await Promise.all([tabAFlush, tabBFlush]);
  for (let attempt = 0; attempt < 20 && tabA.requests.length + tabB.requests.length < 2; attempt++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  const crossTabRequests = tabA.requests.concat(tabB.requests);
  const staleRequest = crossTabRequests.find(body => body.title === 'Independent stale title');
  const durableBlocked = tabA.context._canonicalTitleJournalRead()
    .find(row => row.title === 'Independent stale title');
  ok(stagedTabDrafts.length === 2
    && new Set(stagedTabDrafts.map(row => row.tab_id)).size === 2
    && staleRequest && staleRequest.expected_title === 'Original title'
    && durableBlocked && durableBlocked.blocked === true,
  'independent tabs retain separate pre-debounce drafts and a queued stale intent never rebases from realtime state');

  // Both original tabs can disappear after a conflict. A fresh tab must be
  // able to associate the user's reviewed edit with durable conflict debt,
  // but only within the same principal/card scope and observed server base.
  const closedTabsStorage = new Map(sharedTabStorage);
  const recovered = browserHarness(closedTabsStorage, {
    tabId: 'tab-after-reload', requestPrefix: 'tab-after-reload',
    initialName: 'First cross-tab title', initialRevision: 1,
  });
  recovered.context._canonicalTitleJournalUpsert(Object.assign({}, durableBlocked, {
    request_id: 'same-scope-second-block', tab_id: 'closed-tab-c',
  }));
  recovered.context._canonicalTitleJournalUpsert(Object.assign({}, durableBlocked, {
    request_id: 'foreign-principal-block', principal: 'staff:actor-b', tab_id: 'closed-tab-d',
  }));
  recovered.context._canonicalTitleJournalUpsert(Object.assign({}, durableBlocked, {
    request_id: 'different-base-block', current_title: 'Different server title', tab_id: 'closed-tab-e',
  }));
  recovered.context._canonicalTitleJournalUpsert(Object.assign({}, durableBlocked, {
    request_id: 'different-card-block', card_id: 'card-2', tab_id: 'closed-tab-f',
  }));
  const recoveredInput = recovered.input();
  recovered.context._canonicalTitleBegin('calendar', recoveredInput);
  recoveredInput.value = 'Reviewed title after reload';
  recovered.context._canonicalTitleOnInput('calendar', recoveredInput);
  await recovered.context._canonicalTitleFlush('calendar', recoveredInput);
  const retainedBlocked = recovered.context._canonicalTitleJournalRead()
    .filter(row => row.blocked === true);
  ok(recovered.requests.length === 1
    && recovered.requests[0].expected_title === 'First cross-tab title'
    && recovered.requests[0].title === 'Reviewed title after reload'
    && retainedBlocked.length === 3
    && retainedBlocked.some(row => row.request_id === 'foreign-principal-block')
    && retainedBlocked.some(row => row.request_id === 'different-base-block')
    && retainedBlocked.some(row => row.request_id === 'different-card-block')
    && !retainedBlocked.some(row => row.request_id === durableBlocked.request_id
      || row.request_id === 'same-scope-second-block')
    && recovered.context.calState.posts[0].name === 'Reviewed title after reload',
  'after both tabs close, an exact-base reviewed CAS removes all and only safely superseded conflict debt');

  // Cleanup is storage-atomic by durable intent rather than by one all-or-none
  // localStorage primitive. Checkpoint the exact candidate IDs before deleting
  // the first one, then prove an injected second-delete failure can replay the
  // same successful request and finish without requiring the explicit ID to
  // still exist.
  const partialCleanup = browserHarness(null, {
    initialName: 'Server title B', initialRevision: 1, requestPrefix: 'cleanup-replay',
  });
  const cleanupBase = {
    version: 1, surface: 'calendar', client_slug: 'fixture', card_id: 'card-1',
    expected_title: 'Original title A', expected_title_revision: 0, title: 'Stale edit',
    source_edited_at: '2026-08-02T02:00:00.000Z', principal: 'staff:actor-a',
    tab_id: 'closed-cleanup-tab', predecessor_request_id: null,
    supersedes_request_id: null, attempted: true, blocked: true, draft: false,
    current_title: 'Server title B', current_title_revision: 1,
  };
  partialCleanup.context._canonicalTitleJournalUpsert(Object.assign({}, cleanupBase, {
    request_id: 'cleanup-block-a', created_at: '2026-08-02T02:00:00.000Z',
  }));
  partialCleanup.context._canonicalTitleJournalUpsert(Object.assign({}, cleanupBase, {
    request_id: 'cleanup-block-b', created_at: '2026-08-02T02:00:01.000Z',
  }));
  const cleanupRecord = {
    version: 1, surface: 'calendar', client_slug: 'fixture', card_id: 'card-1',
    expected_title: 'Server title B', expected_title_revision: 1, title: 'Reviewed title D',
    request_id: 'cleanup-success', source_edited_at: '2026-08-02T02:00:02.000Z',
    created_at: '2026-08-02T02:00:02.000Z', principal: 'staff:actor-a',
    tab_id: 'cleanup-tab', predecessor_request_id: null,
    supersedes_request_id: 'cleanup-block-a', attempted: false, blocked: false, draft: false,
  };
  partialCleanup.context._canonicalTitleJournalUpsert(cleanupRecord);
  let failSecondCleanupDelete = true;
  partialCleanup.setStorageRemoveFailure(key => {
    if (failSecondCleanupDelete && key.endsWith('cleanup-block-b')) {
      failSecondCleanupDelete = false;
      return true;
    }
    return false;
  });
  let partialCleanupError = null;
  try { await partialCleanup.context._canonicalTitleCommitRecord(cleanupRecord); }
  catch (error) { partialCleanupError = error; }
  const afterPartialCleanup = partialCleanup.context._canonicalTitleJournalRead();
  const checkpointedCleanup = afterPartialCleanup.find(row => row.request_id === cleanupRecord.request_id);
  const partialStateExact = partialCleanupError && partialCleanupError.code === 'title_intent_storage_unavailable'
    && !afterPartialCleanup.some(row => row.request_id === 'cleanup-block-a')
    && afterPartialCleanup.some(row => row.request_id === 'cleanup-block-b')
    && checkpointedCleanup
    && JSON.stringify(checkpointedCleanup.superseded_cleanup_request_ids)
      === JSON.stringify(['cleanup-block-a', 'cleanup-block-b']);
  partialCleanup.setStorageRemoveFailure(null);
  await partialCleanup.context._canonicalTitleCommitRecord(checkpointedCleanup);
  ok(partialStateExact
    && partialCleanup.requests.length === 2
    && partialCleanup.requests[0].request_id === partialCleanup.requests[1].request_id
    && partialCleanup.context._canonicalTitleJournalRead().length === 0,
  'a mid-cleanup removal failure replays the checkpointed exact candidate set and completes idempotently');

  const blockedCountBefore = tabA.context._canonicalTitleJournalRead().filter(row => row.blocked === true).length;
  const newer = {
    version: 1, surface: 'calendar', client_slug: 'fixture', card_id: 'card-1',
    expected_title: 'First cross-tab title', expected_title_revision: 1, title: 'Later explicit title',
    request_id: 'tab-a-later', source_edited_at: new Date().toISOString(),
    created_at: new Date(Date.now() + 1000).toISOString(), principal: 'staff:actor-a',
    tab_id: 'tab-a', predecessor_request_id: null, supersedes_request_id: null,
    attempted: false, blocked: false, draft: false,
  };
  tabA.context._canonicalTitleJournalUpsert(newer);
  tabA.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    tabA.requests.push(body);
    return { ok: true, status: 201, json: async () => titleReceipt(body) };
  });
  await tabA.context._canonicalTitleCommitRecord(newer);
  ok(blockedCountBefore === 1
    && tabA.context._canonicalTitleJournalRead().some(row => row.request_id === durableBlocked.request_id
      && row.blocked === true),
  'an unrelated later success cannot blanket-prune another tab\'s blocked draft');

  const retryCallsBefore = tabA.requests.length + tabB.requests.length;
  await tabA.context._canonicalTitleRetry('calendar', tabA.context.calState.posts[0], 'card-1');
  ok(tabA.requests.length + tabB.requests.length === retryCallsBefore
    && tabA.statuses.some(row => row.value === 'error'
      && row.message === 'canonical_title_conflict_review_required'),
  'explicit Retry leaves blocked title debt visible and performs no misleading network retry');

  for (const prefix of ['syncview_canonical_title_intent_v1:', 'syncview_canonical_title_draft_v1:']) {
    const corrupt = browserHarness(new Map([[prefix + 'broken', '{not-json']]), {
      tabId: 'corrupt-tab', requestPrefix: 'corrupt',
    });
    const debt = corrupt.context._canonicalTitleDebtState('calendar', 'fixture', 'card-1', 'staff:actor-a');
    await corrupt.context._canonicalTitleRetry('calendar', corrupt.context.calState.posts[0], 'card-1');
    ok(debt.state === 'corrupt' && corrupt.requests.length === 0
      && corrupt.statuses.some(row => row.value === 'error' && row.message === 'title_intent_storage_corrupt'),
    'malformed ' + (prefix.includes('draft') ? 'draft' : 'journal') + ' storage fails closed without a write');
  }

  const idleRecovery = browserHarness(new Map(), {
    tabId: 'idle-recovery-tab', principal: 'client:fixture', requestPrefix: 'idle-client',
  });
  const idleSummary = await idleRecovery.context._canonicalTitleResumePending();
  ok(idleSummary.attempted === 0 && idleSummary.committed === 0
    && idleRecovery.requests.length === 0,
  'an empty title journal performs no background browser request');

  const clientStorage = new Map();
  const clientBeforeReload = browserHarness(clientStorage, {
    tabId: 'client-before-reload', principal: 'client:fixture', requestPrefix: 'client-before',
  });
  const clientInput = clientBeforeReload.input();
  clientBeforeReload.context._canonicalTitleBegin('calendar', clientInput);
  clientInput.value = 'Client title saved after reload';
  clientBeforeReload.context._canonicalTitleOnInput('calendar', clientInput);
  const clientAfterReload = browserHarness(clientStorage, {
    tabId: 'client-after-reload', principal: 'client:fixture', requestPrefix: 'client-after',
  });
  const clientSummary = await clientAfterReload.context._canonicalTitleResumePending();
  ok(clientSummary.attempted === 1 && clientSummary.committed === 1
    && clientAfterReload.requests.length === 1
    && clientAfterReload.requests[0].expected_title === 'Original title'
    && clientAfterReload.requests[0].title === 'Client title saved after reload'
    && clientAfterReload.context.calState.posts[0].name === 'Client title saved after reload'
    && ![...clientStorage.keys()].some(key => key.startsWith('syncview_canonical_title_')),
  'a collaborative client reload resumes the exact durable draft under the same principal');

  for (const surface of ['calendar', 'sxr']) {
    for (const reviewState of [
      { label: 'pre-review', title_status: '' },
      { label: 'post-review', title_status: 'Approved' },
    ]) {
      const stateEdit = browserHarness(null, { surface, post: { title_status: reviewState.title_status } });
      const stateInput = stateEdit.input();
      stateEdit.context._canonicalTitleBegin(surface, stateInput);
      stateInput.value = surface + ' ' + reviewState.label + ' canonical title';
      await stateEdit.context._canonicalTitleFlush(surface, stateInput);
      const post = (surface === 'sxr' ? stateEdit.context.sxrState : stateEdit.context.calState).posts[0];
      ok(stateEdit.requests.length === 1
        && stateEdit.requests[0].surface === surface
        && post.title_status === reviewState.title_status
        && post.name === surface + ' ' + reviewState.label + ' canonical title',
      surface + ' preserves ' + reviewState.label + ' state while committing exact title equality');
    }

    const offlineStorage = new Map();
    const offline = browserHarness(offlineStorage, { surface, tabId: surface + '-offline' });
    const offlineInput = offline.input();
    offline.context._canonicalTitleBegin(surface, offlineInput);
    offlineInput.value = surface + ' offline durable title';
    offline.setFetch(async (_url, options) => {
      offline.requests.push(JSON.parse(options.body));
      throw new Error('offline fixture');
    });
    await offline.context._canonicalTitleFlush(surface, offlineInput);
    const reloaded = browserHarness(offlineStorage, { surface, tabId: surface + '-reloaded' });
    reloaded.setFetch(async (_url, options) => {
      const body = JSON.parse(options.body);
      reloaded.requests.push(body);
      return { ok: true, status: 200, json: async () => titleReceipt(body, { replayed: true }) };
    });
    const reloadedPost = (surface === 'sxr' ? reloaded.context.sxrState : reloaded.context.calState).posts[0];
    const retried = await reloaded.context._canonicalTitleRetry(surface, reloadedPost, 'card-1');
    ok(retried === true && offline.requests.length === 1 && reloaded.requests.length === 1
      && JSON.stringify(offline.requests[0]) === JSON.stringify(reloaded.requests[0])
      && reloadedPost.name === surface + ' offline durable title'
      && reloaded.context._canonicalTitleJournalRead().length === 0,
    surface + ' reload Retry replays the exact offline request and clears its durable debt');
  }

  const samplesTabStorage = new Map();
  const samplesLocks = queuedLockManager();
  const samplesA = browserHarness(samplesTabStorage, {
    surface: 'sxr', tabId: 'samples-tab-a', requestPrefix: 'samples-a', locks: samplesLocks,
  });
  const samplesB = browserHarness(samplesTabStorage, {
    surface: 'sxr', tabId: 'samples-tab-b', requestPrefix: 'samples-b', locks: samplesLocks,
  });
  const samplesAInput = samplesA.input();
  const samplesBInput = samplesB.input();
  samplesA.context._canonicalTitleBegin('sxr', samplesAInput);
  samplesB.context._canonicalTitleBegin('sxr', samplesBInput);
  samplesAInput.value = 'Samples first tab';
  samplesBInput.value = 'Samples stale tab';
  samplesA.context._canonicalTitleOnInput('sxr', samplesAInput);
  samplesB.context._canonicalTitleOnInput('sxr', samplesBInput);
  let releaseSamplesA;
  samplesA.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    samplesA.requests.push(body);
    await new Promise(resolve => { releaseSamplesA = resolve; });
    return { ok: true, status: 201, json: async () => titleReceipt(body) };
  });
  samplesB.setFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    samplesB.requests.push(body);
    return {
      ok: false, status: 409,
      json: async () => ({
        ok: false, error: 'write_conflict', current_title: 'Samples first tab', current_title_revision: 1,
      }),
    };
  });
  const samplesAFlush = samplesA.context._canonicalTitleFlush('sxr', samplesAInput);
  while (!releaseSamplesA) await new Promise(resolve => setImmediate(resolve));
  const samplesBFlush = samplesB.context._canonicalTitleFlush('sxr', samplesBInput);
  releaseSamplesA();
  await Promise.all([samplesAFlush, samplesBFlush]);
  ok(samplesA.requests.length === 1 && samplesB.requests.length === 1
    && samplesB.requests[0].expected_title === 'Original title'
    && samplesA.context._canonicalTitleJournalRead().some(row => row.blocked === true
      && row.surface === 'sxr' && row.title === 'Samples stale tab'),
  'Samples two-tab editing preserves the stale CAS as blocked durable debt');

  ok(/maxlength="500"[^>]*onfocus="_canonicalTitleBegin\('calendar'/.test(ui)
    && /maxlength="500"[^>]*onfocus="_canonicalTitleBegin\('sxr'/.test(ui)
    && /if \(fld === 'name' && _canonicalTitleOnInput\('calendar'/.test(ui)
    && /if \(fld === 'name' && _canonicalTitleOnInput\('sxr'/.test(ui),
  'linked Calendar and Samples title fields route through the dedicated journal instead of their frozen writers');

  const calendarRetry = extract(ui, '_calRetrySave');
  const samplesRetry = extract(ui, '_sxrRetrySave');
  const calendarGenericSave = section(ui, 'async function _calFlushCardSave(', '\n    function _calRetrySave(');
  const samplesGenericSave = section(ui, 'async function _sxrFlushCardSave(', '\n    function _sxrRetrySave(');
  ok(/_canonicalTitlePendingFor\('calendar'[^]*?_canonicalTitleRetry\('calendar'[^]*?return;/.test(calendarRetry)
    && /_canonicalTitlePendingFor\('sxr'[^]*?_canonicalTitleRetry\('sxr'[^]*?return;/.test(samplesRetry)
    && /_canonicalTitleOwnsLinkedWrite\('calendar'[^]*?delete wirePost\.name;/.test(calendarGenericSave)
    && /_canonicalTitleOwnsLinkedWrite\('sxr'[^]*?delete wirePost\.name;/.test(samplesGenericSave),
  'generic Retry resumes title debt first while absent pre-install cards without debt retain the frozen writer');

  const lifecycle = extract(ui, '_writeUiResumeLegacyQueues');
  const clientLifecycle = section(lifecycle, "if (owner.kind === 'client')", '\n            _writeUiExpireV1Caches');
  ok(/Promise\.all\(\[[^]*?_canonicalTitleResumePending\(\)/.test(clientLifecycle),
  'the collaborative-client lifecycle resumes that actor\'s durable canonical title intents');

  const journalWrite = extract(ui, '_canonicalTitleJournalUpsert');
  ok(/_canonicalTitleStorageKey\(WRITE_UI_TITLE_INTENT_PREFIX/.test(journalWrite)
    && /localStorage\.setItem\(key, payload\)/.test(journalWrite)
    && !/\.slice\(/.test(journalWrite)
    && !/WRITE_UI_TITLE_INTENTS_KEY/.test(journalWrite),
  'the title journal cannot regress to a shared-array read/modify/write store or a lossy slice cap');

  const intakeCards = extract(gateway, 'intakeCalendarCards');
  ok(/order_index: ""/.test(intakeCards)
    && /scheduled_date: ""/.test(intakeCards)
    && !/due_date:/.test(intakeCards),
  'intake card materialization leaves Calendar order allocation to the transaction and never maps due date to publish date');

  if (failures) {
    console.error(`\n${failures} F133 canonical title check(s) failed.`);
    process.exit(1);
  }
  console.log('\nF133 canonical title checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
