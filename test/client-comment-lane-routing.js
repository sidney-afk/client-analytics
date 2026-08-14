'use strict';
/*
 * CLIENT COMMENT LANE ROUTING — flag-gated front door, fail-legacy always.
 *
 * THE INCIDENT (2026-08-13). A wave-2 enrolled client could not leave a comment
 * on her review screen. The UI printed the gateway's raw refusal,
 * `comment_forbidden`, in red, and her requested change was lost. The gateway's
 * client-comment door (`clientCommentTargetAllowed`) authorizes ONLY
 * surface='sxr' + a card-bound samples thread, so two live populations could
 * never pass it: every CALENDAR-surface comment and every UNLINKED samples
 * thread. PR 1064 pinned the stopgap: every client comment took the legacy n8n
 * lane, unconditionally.
 *
 * THE REPAIR (2026-08-14, this contract). The gateway now ALSO accepts those
 * two populations under `clientCommentFrontDoorTargetAllowed`
 * (slug/origin/team-bound; see test/production-write-client-comment-front-door.js
 * for its full allow/deny matrix). Routing becomes:
 *
 *     client comments go LEGACY UNLESS
 *         the client_comment_gateway_enabled runtime flag is ON
 *         AND the tab can build a verified gateway context
 *             (_prodClientCommentGatewayContext returns non-null).
 *
 * The flag defaults OFF — missing, malformed, unreadable, deleted all read as
 * OFF — so merge and deploy order can never break anything: nothing changes
 * until the owner flips the flag AFTER the production-write EF deploy, and
 * rollback is flag off. An invalid context (unverified capability, missing
 * native id, unprovable crosswalk, wrong slug) also falls back to legacy — the
 * client must never again be handed a raw gateway refusal.
 *
 * THE LINES THAT MUST NOT MOVE:
 *   - flag OFF (the shipped default) keeps the exact PR 1064 behavior: every
 *     client comment routes legacy regardless of enrollment (pins the P0 fix);
 *   - flag ON + verified context routes the gateway and carries the card
 *     binding; flag ON + invalid context still falls back to legacy;
 *   - the LINKED sxr client thread stays fail-closed on the gateway, never
 *     diverted — and the strict server predicate keeps all six clauses;
 *   - the new front-door predicate keeps its slug/team/component and
 *     origin/card clauses (anti-weakening, both predicates);
 *   - client STATUS paths stay untouched (they never broke);
 *   - the retry-lane stamp and both drain conditions from the PR 1064
 *     amendment stay exactly as shipped.
 */
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const policy = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs'), 'utf8');

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = app.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (app.slice(start - 6, start) === 'async ') start -= 6;
  const brace = app.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < app.length; index++) {
    const ch = app[index], next = app[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return app.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

// --- 1. Routing-condition source pins ---------------------------------------
const calendarComment = app.slice(app.indexOf('async function _calPostLinearComment'));
const calendarHead = calendarComment.slice(0, calendarComment.indexOf('const url ='));
ok(/_writeUiUseGatewayWhenReady\('calendar', meta\)\)\s*\|\|\s*\(_isClientLink && !clientGatewaySurface\)/.test(calendarHead),
  'calendar comment: a client link routes legacy unless it holds a verified gateway context');
ok(/_prodClientCommentGatewayContext\('calendar', meta && meta\.post, component\)/.test(calendarHead),
  'calendar comment: that context comes from the flag-gated front-door builder');

const sxrComment = app.slice(app.indexOf('const clientCanonicalWrite'));
const sxrHead = sxrComment.slice(0, sxrComment.indexOf('const url ='));
ok(/_writeUiUseGatewayWhenReady\('sxr', meta\)\)\s*\|\|\s*\(_isClientLink && !clientFrontDoorSurface\)/.test(sxrHead),
  'samples comment: an UNLINKED client thread routes legacy unless it holds a verified gateway context');
ok(/const clientFrontDoorSurface = !clientCanonicalWrite && _isClientLink\s*\n\s*\? await _prodClientCommentGatewayContext\('sxr', meta && meta\.post, component\)/.test(sxrHead),
  'samples comment: the front-door context is consulted ONLY off the linked path');

/* The linked-thread branch supplies a verified card_id and is fail-closed by
 * design. Diverting it would silently downgrade an authenticated write, so the
 * repair must NOT have touched it. */
ok(/if \(clientCanonicalWrite\) \{[\s\S]{0,400}?canonical_comment_read_required/.test(sxrHead),
  'the LINKED client thread still fails closed on the gateway — not diverted');
ok(/clientSurface \? \{ card_id: clientSurface\.card_id \}/.test(sxrComment.slice(0, 8000)),
  'the linked thread still sends the verified card_id it was authorized against');

// --- 2. The fix is scoped to comments, not to every client write -----------
/* Status/approve travels a different gate (clientOperationAllowed) and WORKED
 * throughout the incident. */
const calendarStatus = app.slice(app.indexOf('async function _calPushStatusToLinear'));
ok(!/_isClientLink/.test(calendarStatus.slice(0, calendarStatus.indexOf('const url ='))),
  'calendar STATUS push is untouched — it was never broken');
const sxrStatus = app.slice(app.indexOf('async function _sxrPushStatusToLinear'));
ok(!/_isClientLink/.test(sxrStatus.slice(0, sxrStatus.indexOf('const url ='))),
  'samples STATUS push is untouched — it was never broken');

// --- 3. ANTI-WEAKENING: BOTH server predicates keep every clause ------------
const predicate = policy.slice(policy.indexOf('export function clientCommentTargetAllowed'));
const body = predicate.slice(0, predicate.indexOf('\n}\n') + 3);
for (const [clause, why] of [
  [/lower\(surface\) === "sxr"/, 'still restricted to the samples surface'],
  [/lower\(row\.origin\) === "samples"/, 'still requires a samples-origin row'],
  [/!!targetCardId/, 'still requires the target to HAVE a card binding'],
  [/!!requestedCard/, 'still requires the caller to PRESENT a card id'],
  [/targetCardId === requestedCard/, 'still requires the two to match exactly'],
  [/normalizeTeam\(row\.team\) === expectedTeam/, 'still requires the component team to match'],
]) {
  ok(clause.test(body), `clientCommentTargetAllowed ${why}`);
}
const frontDoorSource = policy.slice(policy.indexOf('export function clientCommentFrontDoorTargetAllowed'));
const frontDoorBody = frontDoorSource.slice(0, frontDoorSource.indexOf('\n}\n') + 3);
for (const [clause, why] of [
  [/normalizeTeam\(row\.team\) !== expectedTeam\) return false/, 'requires the component team to match the target row'],
  [/clientScopeAllowed\(principalSlug, row\.client_slug\)/, 'requires the server-resolved principal slug to own the row'],
  [/lower\(row\.origin\) === "calendar"/, 'calendar lane requires a calendar-origin row'],
  [/!targetCardId \|\| targetCardId === clean\(requestedCardId\)/, 'calendar lane keeps the exact-card match whenever the row is card-bound'],
  [/lower\(row\.origin\) === "samples" && !targetCardId/, 'sxr lane admits ONLY unlinked samples rows — card-bound sxr stays strict-only'],
]) {
  ok(clause.test(frontDoorBody), `clientCommentFrontDoorTargetAllowed ${why}`);
}

// --- 4. The runtime flag: dark default, strict parse, shared priming --------
ok(/let _clientCommentGatewayEnabled = false;/.test(app),
  'the flag DEFAULTS OFF in source — deploy order can never route a client at an undeployed contract');
ok(/value\.enabled === true/.test(extract('_clientCommentGatewaySetFlagValue')),
  'only the exact operator value { enabled: true } opens the door');
const flagFetch = extract('_writeUiFetchRerouteFlagOnce');
ok(/key=in\.\(/.test(flagFetch)
  && /WRITE_UI_REROUTE_FLAG_KEY \+ ',' \+ CLIENT_COMMENT_GATEWAY_FLAG_KEY/.test(flagFetch),
  'one bounded fetch primes BOTH routing flags (reroute list + front door)');
ok(/_clientCommentGatewaySetFlagValue\(null\)/.test(flagFetch),
  'a failed or missing flag read sets the front door OFF, never leaves it stale');
ok(/filter: 'key=eq\.' \+ CLIENT_COMMENT_GATEWAY_FLAG_KEY/.test(app),
  'the realtime subscription tracks the front-door flag so a flip reaches open tabs');
ok(/if \(!_clientCommentGatewayOn\(\)\) return null;/.test(extract('_prodClientCommentGatewayContext')),
  'the context builder refuses to build any context while the flag is off');

// --- 5. BEHAVIORAL: the real context builder under the real flag machinery --
// F64: 'enrolledclient' is a FAKE slug, never a real client.
const flagDecl = (app.match(/let _clientCommentGatewayEnabled = (?:false|true);/) || [''])[0];
function contextHarness(overrides) {
  const host = {
    _isClientLink: true,
    runCurrent: true,
    resolveCalls: 0,
    primeCalls: 0,
  };
  const context = vm.createContext({
    _isClientLink: true,
    _syncviewClientEntryCapability: { verified: true, view: 'calendar', slug: 'enrolledclient' },
    _syncviewClientEntryDataRun: {},
    _syncviewClientEntryRunCurrent: () => host.runCurrent,
    calState: { client: 'enrolledclient' },
    sxrState: { client: 'enrolledclient' },
    calClientSlug: value => String(value || ''),
    sxrClientSlug: value => String(value || ''),
    _writeUiPrimeRerouteFlag: async () => { host.primeCalls++; },
    _prodResolveCardCrosswalk: async () => { host.resolveCalls++; },
    _calV2Log: () => {},
    Object,
    String,
    Array,
  });
  vm.runInContext([
    flagDecl,
    extract('_clientCommentGatewaySetFlagValue'),
    extract('_clientCommentGatewayOn'),
    extract('_writeUiNativeId'),
    extract('_prodCrosswalkKey'),
    extract('_prodCrosswalkVerdict'),
    extract('_prodCrosswalkSetVerdict'),
    extract('_prodClientCommentGatewayContext'),
  ].join('\n'), context);
  Object.assign(context, overrides || {});
  return { context, host };
}
function calPost(verdict) {
  return {
    id: 'cal-card-1',
    client_slug: 'enrolledclient',
    video_deliverable_id: 'deliv-1',
    _canonicalCrosswalk: verdict ? { 'video|deliv-1': verdict } : undefined,
  };
}
const UNBOUND = { state: 'mismatch', fields: ['card_id'], card_unbound: true };

(async () => {
  {
    // 5a. FLAG OFF (the shipped default): a fully valid setup still refuses —
    // this is the pin on the P0 fix. If the source default ever flips to on,
    // both this check and the source pin above go red.
    const { context } = contextHarness();
    ok(context._clientCommentGatewayOn() === false,
      'flag machinery boots OFF before any runtime read');
    const denied = await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video');
    ok(denied === null,
      'flag OFF: even a fully verified calendar context is refused — client comments stay legacy');
  }
  {
    // 5b. Strict parse: everything except the exact operator value is OFF.
    const { context } = contextHarness();
    for (const [value, expected, label] of [
      [{ enabled: true }, true, 'the exact operator value turns the door on'],
      [null, false, 'null is off'],
      [{ enabled: 'true' }, false, 'a string true is off'],
      [{ enabled: false }, false, 'enabled:false is off'],
      [['enabled'], false, 'an array is off'],
      [{ clients: ['enrolledclient'] }, false, 'a reroute-shaped value is off'],
    ]) {
      context._clientCommentGatewaySetFlagValue(value);
      ok(context._clientCommentGatewayOn() === expected, 'flag parse: ' + label);
    }
  }
  {
    // 5c. FLAG ON + verified contexts.
    const { context } = contextHarness();
    context._clientCommentGatewaySetFlagValue({ enabled: true });
    const unbound = await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video');
    ok(!!unbound && unbound.source_surface === 'calendar'
      && unbound.card_id === 'cal-card-1' && unbound.component === 'video',
      'flag ON: an UNBOUND calendar deliverable (crosswalk mismatch on card_id alone) builds a context');
    const bound = await context._prodClientCommentGatewayContext('calendar',
      calPost({ state: 'valid', fields: [] }), 'video');
    ok(!!bound && bound.card_id === 'cal-card-1',
      'flag ON: a card-BOUND calendar deliverable (crosswalk valid) builds a context too');
    const sxrPost = {
      id: 'sxr-card-1', client_slug: 'enrolledclient', graphic_deliverable_id: 'deliv-2',
      _canonicalCrosswalk: { 'graphic|deliv-2': UNBOUND },
    };
    context._syncviewClientEntryCapability = { verified: true, view: 'sample-reviews', slug: 'enrolledclient' };
    const sxrCtx = await context._prodClientCommentGatewayContext('sxr', sxrPost, 'graphic');
    ok(!!sxrCtx && sxrCtx.source_surface === 'sxr' && sxrCtx.card_id === 'sxr-card-1'
      && sxrCtx.component === 'graphic',
      'flag ON: an unlinked sxr thread (unbound crosswalk) builds a context on a sample-reviews link');
  }
  {
    // 5d. FLAG ON + every invalid binding still refuses (fail-legacy table).
    const { context, host } = contextHarness();
    context._clientCommentGatewaySetFlagValue({ enabled: true });
    const cases = [
      ['a deliverable bound to a DIFFERENT card',
        () => context._prodClientCommentGatewayContext('calendar',
          calPost({ state: 'mismatch', fields: ['card_id'], card_unbound: false }), 'video')],
      ['a crosswalk mismatch beyond card_id (wrong slug)',
        () => context._prodClientCommentGatewayContext('calendar',
          calPost({ state: 'mismatch', fields: ['card_id', 'client_slug'], card_unbound: true }), 'video')],
      ['a crosswalk mismatch on team',
        () => context._prodClientCommentGatewayContext('calendar',
          calPost({ state: 'mismatch', fields: ['team'], card_unbound: true }), 'video')],
      ['a crosswalk read error',
        () => context._prodClientCommentGatewayContext('calendar',
          calPost({ state: 'error', fields: [] }), 'video')],
      ['a deliverable the crosswalk cannot find',
        () => context._prodClientCommentGatewayContext('calendar',
          calPost({ state: 'absent', fields: [] }), 'video')],
      ['a card with no deliverable id',
        () => context._prodClientCommentGatewayContext('calendar',
          { id: 'cal-card-1', client_slug: 'enrolledclient' }, 'video')],
      ['a component outside video/graphic',
        () => context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'caption')],
      ['a surface outside calendar/sxr',
        () => context._prodClientCommentGatewayContext('production', calPost(UNBOUND), 'video')],
    ];
    for (const [label, run] of cases) {
      ok((await run()) === null, 'flag ON, still legacy: ' + label);
    }
    context._syncviewClientEntryCapability = { verified: true, view: 'calendar', slug: 'someoneelse' };
    ok((await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video')) === null,
      'flag ON, still legacy: the capability slug does not match the mounted calendar');
    context._syncviewClientEntryCapability = { verified: false, view: 'calendar', slug: 'enrolledclient' };
    ok((await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video')) === null,
      'flag ON, still legacy: an unverified capability');
    context._syncviewClientEntryCapability = { verified: true, view: 'calendar', slug: 'enrolledclient' };
    host.runCurrent = false;
    ok((await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video')) === null,
      'flag ON, still legacy: a stale client-entry data run');
    host.runCurrent = true;
    ok((await context._prodClientCommentGatewayContext('calendar',
      { ...calPost(UNBOUND), client_slug: 'someoneelse' }, 'video')) === null,
      'flag ON, still legacy: a card row belonging to another slug');
    context._syncviewClientEntryCapability = { verified: true, view: 'analytics', slug: 'enrolledclient' };
    ok((await context._prodClientCommentGatewayContext('sxr', {
      id: 'sxr-card-1', client_slug: 'enrolledclient', graphic_deliverable_id: 'deliv-2',
      _canonicalCrosswalk: { 'graphic|deliv-2': UNBOUND },
    }, 'graphic')) === null,
      'flag ON, still legacy: an sxr context requires a sample-reviews link');
    context._isClientLink = false;
    ok((await context._prodClientCommentGatewayContext('calendar', calPost(UNBOUND), 'video')) === null,
      'a staff tab never builds a client gateway context');
  }
  {
    // 5e. An unresolved crosswalk triggers one on-demand resolve; the stamped
    // verdict decides. The card stays legacy when resolve stamps nothing.
    const { context, host } = contextHarness();
    context._clientCommentGatewaySetFlagValue({ enabled: true });
    const post = calPost(null);
    ok((await context._prodClientCommentGatewayContext('calendar', post, 'video')) === null
      && host.resolveCalls === 1,
      'no stamped verdict: the builder resolves the crosswalk once and refuses when nothing stamps');
    context._prodResolveCardCrosswalk = async (surface, target, components) => {
      context._prodCrosswalkSetVerdict(target, 'deliv-1', components[0], UNBOUND);
    };
    const resolved = await context._prodClientCommentGatewayContext('calendar', calPost(null), 'video');
    ok(!!resolved && resolved.card_id === 'cal-card-1',
      'the on-demand resolve result is honored when it proves an unbound same-client deliverable');
  }

  // --- 6. BEHAVIORAL: both routing sites, all principals ---------------------
  function routingHarness() {
    const host = { legacy: [], gateway: [], useGateway: true, contextResult: null };
    const context = vm.createContext({
      _isClientLink: true,
      _writeUiUseGatewayWhenReady: async () => host.useGateway,
      _prodClientCommentGatewayContext: async () => host.contextResult,
      _calLegacyPostLinearComment: (...args) => host.legacy.push(['calendar', args]),
      _sxrLegacyPostLinearComment: (...args) => host.legacy.push(['sxr', args]),
      _writeUiGatewayWithRepair: async (intent, repair) => {
        host.gateway.push({ intent, repair });
        return { ok: true, native_committed: true };
      },
      _writeUiNativeId: (post, component) => String((component === 'graphic'
        ? post && post.graphic_deliverable_id
        : post && post.video_deliverable_id) || '').trim(),
      _writeUiTeam: component => component === 'graphic' ? 'graphics' : 'video',
      _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
      _writeUiBuildSourceRepair: () => ({ staff_repair: true }),
      _writeUiClassifyTargetless: async () => ({ skipped: true }),
      _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
      _prodCanonicalCommentGate: () => ({ linked: false, ready: false, client: false, status: 'unlinked' }),
      _prodVerifiedClientCommentMutationContext: () => null,
      Date, Promise, Object, String, Number, JSON,
    });
    vm.runInContext(extract('_calPostLinearComment') + '\n' + extract('_sxrPostLinearComment'), context);
    return { context, host };
  }
  const CAL_META = () => ({
    post: { id: 'cal-card-1', client_slug: 'enrolledclient', video_deliverable_id: 'deliv-1' },
    component: 'video',
    comment: { id: 'note-1', created_at: '2026-08-14T00:00:00Z' },
    audience: 'client',
  });
  const SXR_META = () => ({
    post: { id: 'sxr-card-1', client_slug: 'enrolledclient', graphic_deliverable_id: 'deliv-2' },
    component: 'graphic',
    comment: { id: 'note-2', created_at: '2026-08-14T00:00:00Z' },
    audience: 'client',
  });
  for (const [fn, surface, meta, cardId] of [
    ['_calPostLinearComment', 'calendar', CAL_META, 'cal-card-1'],
    ['_sxrPostLinearComment', 'sxr', SXR_META, 'sxr-card-1'],
  ]) {
    {
      // Enrolled CLIENT, no verified context (flag off or unprovable) → legacy.
      const { context, host } = routingHarness();
      host.contextResult = null;
      await context[fn]('https://linear.app/x/issue/T-1', 'Please adjust', 'Client', meta());
      ok(host.legacy.length === 1 && host.legacy[0][0] === surface && host.gateway.length === 0,
        `${surface}: enrolled client WITHOUT a verified context still routes legacy (the P0 stays fixed)`);
    }
    {
      // Enrolled CLIENT with flag+context → gateway, carrying the card binding.
      const { context, host } = routingHarness();
      host.contextResult = Object.freeze({ source_surface: surface, card_id: cardId, component: meta().component });
      await context[fn]('https://linear.app/x/issue/T-1', 'Please adjust', 'Client', meta());
      ok(host.gateway.length === 1 && host.legacy.length === 0,
        `${surface}: enrolled client WITH flag + verified context routes the gateway`);
      const sent = host.gateway[0] || { intent: { comment: {} } };
      ok(sent.intent.surface === surface
        && sent.intent.comment.card_id === cardId
        && sent.intent.comment.component === meta().component,
        `${surface}: the gateway payload carries the verified card binding for the server contract`);
      ok(sent.repair === null,
        `${surface}: a client gateway comment carries no staff source-repair journal`);
    }
    {
      // UNENROLLED client: the reroute flag still gates the outer lane.
      const { context, host } = routingHarness();
      host.useGateway = false;
      host.contextResult = Object.freeze({ source_surface: surface, card_id: cardId, component: meta().component });
      await context[fn]('https://linear.app/x/issue/T-1', 'Please adjust', 'Client', meta());
      ok(host.legacy.length === 1 && host.gateway.length === 0,
        `${surface}: an unenrolled client stays legacy even with the front door open`);
    }
    {
      // Deferred legacy: the client save path still gets its deferral receipt.
      const { context, host } = routingHarness();
      host.contextResult = null;
      const deferMeta = Object.assign(meta(), { deferLegacyUntilSourceSave: true });
      const receipt = await context[fn]('https://linear.app/x/issue/T-1', 'Please adjust', 'Client', deferMeta);
      ok(receipt && receipt.deferred_until_source_save === true && host.legacy.length === 0,
        `${surface}: the defer-until-source-save legacy receipt is unchanged`);
    }
    {
      // STAFF routing is completely untouched by the front door.
      const { context, host } = routingHarness();
      context._isClientLink = false;
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff note', 'SMM', meta());
      ok(host.gateway.length === 1 && host.legacy.length === 0
        && host.gateway[0].intent.comment.card_id === undefined
        && host.gateway[0].repair !== null,
        `${surface}: an enrolled STAFF comment routes the gateway exactly as before (no card binding, repair intact)`);
      const { context: context2, host: host2 } = routingHarness();
      context2._isClientLink = false;
      host2.useGateway = false;
      await context2[fn]('https://linear.app/x/issue/T-1', 'Staff note', 'SMM', meta());
      ok(host2.legacy.length === 1 && host2.gateway.length === 0,
        `${surface}: an unenrolled STAFF comment routes legacy exactly as before`);
    }
  }

  // --- 7. RETRY LANE (PR 1064 amendment, unchanged contract) -----------------
  /* When a client comment's legacy send fails TRANSIENTLY it is enqueued for
   * retry, and the drain re-derives the lane from ENROLLMENT — so the enqueue
   * functions stamp `client_link: true` on client tabs and both drains admit
   * the stamp. The quarantine's security property (enrolled STAFF writes never
   * sneak down the legacy lane) must survive. */
  async function runEnqueue(fnName, scheduleName, isClientLink) {
    const captured = [];
    const context = vm.createContext({
      _isClientLink: isClientLink,
      _writeUiLegacyAppendOutboxItem: async (surface, record) => { captured.push({ surface, record }); },
      [scheduleName]: () => {},
    });
    vm.runInContext(extract(fnName), context);
    await context[fnName]('comment', { issue: 'https://example.invalid/i/1', body: 'x' }, 'http 502', 'enrolledclient');
    if (captured.length !== 1) throw new Error(fnName + ' did not append exactly one item');
    return captured[0];
  }

  for (const [fnName, scheduleName, surface] of [
    ['_linearOutboxEnqueue', '_linearOutboxScheduleRetry', 'calendar'],
    ['_sxrLinearOutboxEnqueue', '_sxrLinearOutboxScheduleRetry', 'sxr'],
  ]) {
    const clientSide = await runEnqueue(fnName, scheduleName, true);
    ok(clientSide.surface === surface && clientSide.record.client_link === true,
      `${fnName}: a CLIENT-tab enqueue stamps client_link:true`);
    ok(clientSide.record.transport === 'legacy_n8n'
        && clientSide.record.client_slug === 'enrolledclient'
        && clientSide.record.kind === 'comment',
      `${fnName}: transport/slug/kind are unchanged by the stamp`);
    const staffSide = await runEnqueue(fnName, scheduleName, false);
    ok(!staffSide.record.client_link,
      `${fnName}: a STAFF-tab enqueue does NOT carry the client stamp`);
  }

  const branchRe = /if \(it && it\.transport === 'legacy_n8n'\s+&& \(([\s\S]*?)\)\) \{/g;
  const conditions = [];
  let match;
  while ((match = branchRe.exec(app)) !== null) conditions.push(match[1]);
  ok(conditions.length === 2,
    `exactly two legacy-n8n drain branches exist (calendar + sxr); found ${conditions.length}`);
  ok(conditions.every(c => /it\.client_link/.test(c) && /it\.source_gate/.test(c)
      && /!_writeUiRerouteUseGateway\(it\.client_slug\)/.test(c)),
    'both drain conditions keep all three disjuncts: source_gate, client_link, unenrolled');

  const persisted = JSON.parse(JSON.stringify(
    (await runEnqueue('_linearOutboxEnqueue', '_linearOutboxScheduleRetry', true)).record));
  ok(persisted.client_link === true && !persisted.source_gate && persisted.attempts === 0,
    'the stamp survives the localStorage JSON round trip; the item is gate-less');

  const enrolled = slug => slug === 'enrolledclient';
  const unenrolled = () => false;
  conditions.forEach((cond, index) => {
    const label = index === 0 ? 'calendar drain' : 'sxr drain';
    const admits = new Function('it', '_writeUiRerouteUseGateway',
      `return !!(it && it.transport === 'legacy_n8n' && (${cond}));`);
    ok(admits(persisted, enrolled) === true,
      `${label}: admits the ENROLLED client's gate-less comment — full retries, not zero-retry quarantine`);
    const staffItem = { transport: 'legacy_n8n', kind: 'comment', client_slug: 'enrolledclient', attempts: 0 };
    ok(admits(staffItem, enrolled) === false,
      `${label}: STILL refuses an enrolled STAFF item — the quarantine's security property holds`);
    ok(admits(staffItem, unenrolled) === true,
      `${label}: an UNENROLLED item still drains legacy exactly as before`);
    ok(admits({ ...staffItem, source_gate: { comment_id: 'x' } }, enrolled) === true,
      `${label}: a source-gated item is still admitted exactly as before`);
  });

  const stamps = app.match(/client_link: _isClientLink === true/g) || [];
  ok(stamps.length === 2, `both enqueue functions carry the literal stamp; found ${stamps.length}`);

  if (failures) {
    console.error(`\n${failures} client-comment lane-routing check(s) failed`);
    process.exit(1);
  }
  console.log('\nclient-comment lane-routing checks passed');
})().catch(error => {
  console.error('FAIL  lane-routing harness crashed: ' + (error && error.stack || error));
  process.exit(1);
});
