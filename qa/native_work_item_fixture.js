'use strict';
/*
 * THE OTHER HALF OF `qa/write_ui_reroute_fixture.js`: A CARD WITH A WORK ITEM.
 *
 * That fixture put the harnesses on the lane production takes — native. This
 * one gives their cards the thing a production card has and a probe card did
 * not: a native work item to write to.
 *
 * WHY IT IS NEEDED. On the native lane the gateway payload is built from
 * `intent.nativeId`, and `makePayload` in `_writeUiGatewayPost` throws
 * `native_link_required` when a SyncView-authoritative team has none — a pasted
 * `linear_issue_id` is not a substitute, which is the whole point of the sealed
 * link slot. Both teams have been SyncView-authoritative since 2026-08-28
 * (`prod_authority` read live 2026-09-08: `{"video":"syncview","graphics":"syncview"}`),
 * and NO probe seeded `video_deliverable_id` / `graphic_deliverable_id`. So
 * after the roster fixture landed, every probe that drives a status change or a
 * comment either went red or passed by proving a fallback the product does not
 * take. OPEN_REPAIRS 175 recorded that as the larger, unfixed half of the
 * finding; this is it.
 *
 * WHY THE IDS ARE FIXTURE-LEVEL AND NOT REAL. Minting a real row needs a write
 * to `public.deliverables`, and `calendar_posts.video_deliverable_id` carries a
 * foreign key to it — neither is reachable with the browser publishable key the
 * harness holds (`production_comment*` and friends answer 42501), and the n8n
 * upsert is not a lane a session may extend. Re-pointing a probe card at an
 * EXISTING client deliverable was the other option and is worse: two cards
 * naming one deliverable is exactly the F42 crosswalk breakage the product
 * refuses, so the fixture would be seeding a defect.
 *
 * So the ids are stamped into the RESPONSE, not into the database: the calendar
 * read is intercepted and the probe's own cards come back carrying a native id,
 * and the crosswalk read for those ids is answered with a row that genuinely
 * DESCRIBES the card (origin, team, client_slug, card_id — the four fields
 * `_prodCrosswalkMismatchFields` compares). Nothing else is faked: the flag
 * reads, the authority read, the card rows themselves and every other table
 * stay live. What this buys is that the probe reaches the REAL native branch
 * and the real gateway payload builder, instead of the refusal that stands in
 * front of it.
 *
 * WHAT IT DOES NOT BUY, stated here so the next reader does not over-read a
 * green run: the gateway itself is mocked, so nothing here proves the server
 * accepts the payload. It proves which lane the browser chooses, what it sends,
 * and — the assertion that used to be missing — that the retired Linear
 * webhooks receive nothing at all.
 *
 * Only slugs and synthetic ids appear here. The repository is public.
 */

/* The two retired n8n webhooks. A probe asserts ZERO traffic to these now;
   before 2026-09-08 three probes asserted the opposite. */
const RETIRED_SET_STATUS_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-set-status';
const RETIRED_ADD_COMMENT_URL = 'https://synchrosocial.app.n8n.cloud/webhook/linear-add-comment';

const NATIVE_GATEWAY_PATH = '/functions/v1/production-write';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
  'cache-control': 'no-store'
};

/* Deterministic, obviously synthetic, and derived from the card so two cards
   never share one — sharing is the crosswalk breakage this fixture exists to
   avoid seeding. */
function nativeDeliverableId(cardId, component) {
  return 'probe_del_' + (component === 'graphic' ? 'g' : 'v') + '_' + String(cardId || '');
}

function teamForComponent(component) {
  return component === 'graphic' ? 'graphics' : 'video';
}

/* The crosswalk row the app compares against the card. Matches on all four
   fields `_prodCrosswalkMismatchFields` checks, so the verdict is `valid` and
   the client front door can open — the state a real linked card is in. */
function crosswalkRowFor(cardId, component, slug) {
  return {
    id: nativeDeliverableId(cardId, component),
    client_slug: slug,
    team: teamForComponent(component),
    origin: 'calendar',
    card_id: String(cardId)
  };
}

/*
 * The comment-thread read for synthetic work items. Since #1642 (2026-09-25) a
 * note on a linked component waits for its canonical thread before it is sent,
 * and the live production-comments cannot know an id this fixture minted (it
 * refuses the probe's invented key with 401 besides), so the note never left
 * the page and p28/p60/p76 went red (OPEN_REPAIRS 373). A minted work item has
 * no comments yet: answer the empty canonical thread a new deliverable really
 * has. Every other deliverable's read is left live.
 */
async function answerProbeCommentThreads(ctx, isProbeId) {
  await ctx.route(url => url.pathname === '/functions/v1/production-comments', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    let body = null;
    try { body = JSON.parse(request.postData() || '{}'); } catch (e) { body = null; }
    if (!body || !isProbeId(String(body.deliverable_id || ''))) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ comments: [], next_cursor: null, has_more: false, canonical_thread: true, feedback: null })
    });
  });
}

/*
 * Stamp native work items onto the probe's OWN cards, and answer the crosswalk
 * read for them.
 *
 * `cards` is `[{ id, components }]`; `components` defaults to both slots.
 * Every other row in the calendar response is passed through untouched, and a
 * deliverables read that names none of these ids is left live.
 */
async function stubNativeWorkItems(ctx, cards, options) {
  const opts = options || {};
  const slug = opts.slug || 'sidneylaruel';
  const wanted = new Map();
  for (const card of cards || []) {
    const id = String(card && card.id || '').trim();
    if (!id) continue;
    wanted.set(id, (card.components && card.components.length) ? card.components : ['video', 'graphic']);
  }
  if (!wanted.size) return { ids: new Map() };

  const idsByCard = new Map();
  const crosswalkById = new Map();
  wanted.forEach((components, cardId) => {
    const slots = {};
    for (const component of components) {
      const deliverableId = nativeDeliverableId(cardId, component);
      slots[component] = deliverableId;
      crosswalkById.set(deliverableId, crosswalkRowFor(cardId, component, slug));
    }
    idsByCard.set(cardId, slots);
  });

  // 1. The calendar read: stamp the ids onto the probe's cards on the way past.
  //    Done at the RESPONSE rather than in the database because the column
  //    carries a foreign key this harness cannot satisfy (see the header). It
  //    also survives a realtime reload, which re-runs this same REST read.
  //    Samples cards (sample_reviews) take the same stamp: since Linear was
  //    retired (2026-09-24) a component is linked only by its deliverable id,
  //    on both surfaces.
  await ctx.route(url => url.pathname === '/rest/v1/calendar_posts' || url.pathname === '/rest/v1/sample_reviews', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    let response;
    try { response = await route.fetch(); } catch (e) { return route.fallback(); }
    let rows;
    const body = await response.text();
    try { rows = JSON.parse(body); } catch (e) { rows = null; }
    if (!Array.isArray(rows)) {
      return route.fulfill({ response, body });
    }
    for (const row of rows) {
      const slots = row && idsByCard.get(String(row.id || ''));
      if (!slots) continue;
      if (slots.video) row.video_deliverable_id = slots.video;
      if (slots.graphic) row.graphic_deliverable_id = slots.graphic;
    }
    // Pass the original headers through: the calendar pages with Range, and
    // dropping `content-range` would make a paged read look truncated.
    return route.fulfill({ response, body: JSON.stringify(rows) });
  });

  // 2. The crosswalk read for exactly those synthetic ids. Any other
  //    deliverables read — the Production tab's, the link adopter's — is left
  //    live, because faking more than the ids this fixture minted would make
  //    the probe describe a world of its own.
  await ctx.route(url => url.pathname === '/rest/v1/deliverables', async (route) => {
    const raw = decodeURIComponent(route.request().url());
    const matched = [...crosswalkById.keys()].filter(id => raw.includes(id));
    if (!matched.length) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify(matched.map(id => crosswalkById.get(id)))
    });
  });

  // 3. The comment-thread read for exactly those synthetic ids (see
  //    answerProbeCommentThreads).
  await answerProbeCommentThreads(ctx, id => crosswalkById.has(id));

  return { ids: idsByCard };
}

/*
 * Capture what the browser sends to the native gateway, and answer it the way
 * a committing gateway answers. `_writeUiGatewayPost` treats anything without
 * `ok:true` AND `native_committed:true` as a failure, so both are required for
 * the probe to observe the success path.
 */
async function stubNativeGateway(ctx, options) {
  const opts = options || {};
  const calls = [];
  // Tell the shared stub-key refusal to step aside on this context, whenever
  // it is registered (seedVerifiedProbeStaff registers it again later).
  require('./staff-gate-seed.js').markProductionWriteMocked(ctx);
  await ctx.route(url => url.pathname.endsWith(NATIVE_GATEWAY_PATH), async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    let payload = null;
    try { payload = JSON.parse(request.postData() || '{}'); } catch (e) { payload = { parseErr: true }; }
    calls.push(payload);
    if (typeof opts.onCall === 'function') opts.onCall(payload);
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS,
      body: JSON.stringify({ ok: true, native_committed: true, request_id: payload && payload.request_id })
    });
  });
  return calls;
}

/*
 * Route the two retired webhooks, COUNT them, and deny transport. The seven
 * native-routing probes assert the count stays zero; aborting as well means a
 * missed assertion cannot turn this fixture into a healthy-provider stub.
 *
 * This is browser route proof only. The gateway above is also a browser stub,
 * so this helper cannot prove that a deployed or actual `production-write`
 * handler makes no server-side provider fetch. That separate claim requires an
 * actual-handler transport seam with provider egress denied.
 */
async function captureRetiredWebhooks(ctx) {
  const setStatus = [];
  const addComment = [];
  await ctx.route('**/webhook/linear-set-status', async (route) => {
    try { setStatus.push(JSON.parse(route.request().postData() || '{}')); }
    catch (e) { setStatus.push({ parseErr: true }); }
    await route.abort('blockedbyclient');
  });
  await ctx.route('**/webhook/linear-add-comment', async (route) => {
    try { addComment.push(JSON.parse(route.request().postData() || '{}')); }
    catch (e) { addComment.push({ parseErr: true }); }
    await route.abort('blockedbyclient');
  });
  return { setStatus, addComment };
}

/*
 * A VERIFIED STAFF IDENTITY, WHICH THE NATIVE LANE REQUIRES AND THE LEGACY LANE
 * DID NOT.
 *
 * `_writeUiGatewayPost` refuses with 401 `credentials_required` unless
 * `_writeUiHasCredential()` answers true, and for a staff surface that means a
 * VERIFIED identity in the page — `localStorage` alone is not enough, the
 * in-memory verified flag has to be set too. The retired webhooks needed none
 * of this, which is one more way the old probes were exercising a softer path
 * than production: a real SMM signs in.
 *
 * The key is synthetic and goes nowhere — the gateway is mocked, so nothing
 * ever presents it to a server. Same shape the retired `cal_linear_deep` probe
 * used since the item-63 drain work (OPEN_REPAIRS 253). Call it AFTER the page has loaded.
 */
async function seedVerifiedProbeStaff(page, options) {
  const opts = options || {};
  // The key is invented, so a production-write call carrying it is answered
  // locally with the live refusal instead of landing in the refusal log. A
  // stubNativeGateway on the same context still wins, registered before or
  // after this: it marks the context and the refusal falls back to it.
  await require('./staff-gate-seed.js').refuseStubKeyProductionWrite(page.context());
  // The staff reads that refuse this invented key with 401 would sign the
  // page straight back out (OPEN_REPAIRS 373); answer them as refused, not 401.
  await require('./staff-gate-seed.js').answerStubKeyStaffReads(page.context());
  return page.evaluate((identity) => {
    try {
      localStorage.setItem('syncview_staff_identity_v1', JSON.stringify(identity));
      _syncviewStaffIdentityMem = null;
      _syncviewStaffIdentityLoaded = false;
      _syncviewAcceptStaffVerification();
    } catch (e) { return 'seed-failed: ' + ((e && e.message) || e); }
    try { return _writeUiHasCredential() ? 'ok' : 'not-credentialed'; }
    catch (e) { return 'check-failed: ' + ((e && e.message) || e); }
  }, {
    key: opts.key || 'probe-staff-key',
    role: opts.role || 'smm',
    member: { id: opts.memberId || 'probe_staff', name: opts.memberName || 'Probe Staff', role: opts.role || 'smm', team: null }
  });
}

/*
 * Open a card's notes thread and wait until a note on `component` may be sent.
 * Since #1642 (2026-09-25) a note on a linked component is refused with
 * "Notes are still loading" until its canonical thread has been read, exactly
 * as a person cannot post into a thread that is still loading. A probe that
 * submits in the same tick as openCalComments therefore had its note dropped
 * (OPEN_REPAIRS 373). Resolves 'ready', 'unlinked' (nothing to wait for) or
 * the last gate status seen when the time runs out, so a probe can assert it.
 */
async function waitForNoteThread(page, pid, component, ms) {
  return page.evaluate(async (a) => {
    if (typeof _calOpenCommentsPid === 'undefined' || _calOpenCommentsPid !== a.pid) openCalComments(a.pid);
    if (typeof _calSetComposeComp === 'function') _calSetComposeComp(a.component);
    const until = Date.now() + a.ms;
    let gate = null;
    while (Date.now() < until) {
      const post = (calState.posts || []).find(x => x.id === a.pid);
      gate = post ? _prodCanonicalCommentGate(post, a.component) : null;
      // The app's own Send condition (_calAppendComment refuses while it is
      // true): a linked thread still loading, or the card's work-item lookup
      // still in flight, which holds every component's Send, caption included.
      // An unresolved lookup is still running, so it is waited out too.
      const settled = gate && post && !_calCommentSendPending(post, gate)
        && gate.status !== 'crosswalk_unresolved';
      if (settled) return gate.linked ? 'ready' : 'unlinked';
      await new Promise(r => setTimeout(r, 300));
    }
    return 'not-ready:' + (gate ? gate.status : 'no-post');
  }, { pid, component, ms: ms || 15000 });
}

/*
 * How many calls reached the retired webhooks, across one or more captures.
 *
 * ONE shape for this assertion in every probe, on purpose. p36 watches three browser
 * contexts and the others watch one, and before this each spelled the zero-check its own
 * way — which is how `test/probes-assert-native-write-lane.js` ends up pattern-matching
 * prose instead of a contract. Every probe on the production roster now asserts
 * `NW.retiredCallCount(...) === 0`, and that guard checks for exactly that.
 */
function retiredCallCount(...captures) {
  return captures.flat()
    .filter(Boolean)
    .reduce((n, cap) => n
      + ((cap.setStatus && cap.setStatus.length) || 0)
      + ((cap.addComment && cap.addComment.length) || 0), 0);
}

/* Small readers the probes share, so three probes cannot drift into three
   different ideas of what "a status intent for this card" means. */
function statusCalls(calls, deliverableId) {
  return (calls || []).filter(c => c && c.operation === 'status' && c.id === deliverableId);
}
function commentCalls(calls, deliverableId) {
  return (calls || []).filter(c => c && c.operation === 'comment' && c.id === deliverableId);
}

/*
 * A PROBE-WIDE REGISTRY, for probes that open their pages through the shared
 * helpers (qa/sxr_courier_lib.js, qa/probes/lib.js) and never hold the context.
 * A probe names its own test-client cards once, before it opens a page:
 *
 *   NW.registerProbeWorkItems([{ id: PID, components: ['video', 'graphic'] }]);
 *
 * and every context those helpers create afterwards stamps them. This is what
 * replaced "seed a Linear URL to make the component linked": since Linear was
 * retired (2026-09-24) only a deliverable id links a component, and the
 * column's foreign key means a probe cannot persist a synthetic one.
 */
const _registered = [];
function registerProbeWorkItems(cards, options) {
  for (const card of cards || []) if (card && card.id) _registered.push({ card, options: options || {} });
}
async function applyProbeWorkItems(ctx) {
  // Looked up per request, not snapshotted, so a card a probe registers after
  // its pages are open (a second seed mid-run) is still stamped.
  const slotsFor = (cardId) => {
    for (let i = _registered.length - 1; i >= 0; i--) {
      const { card } = _registered[i];
      if (String(card.id) !== String(cardId)) continue;
      const comps = (card.components && card.components.length) ? card.components : ['video', 'graphic'];
      return Object.fromEntries(comps.map(c => [c, nativeDeliverableId(card.id, c)]));
    }
    return null;
  };
  const crosswalkFor = (deliverableId) => {
    for (const { card, options } of _registered) {
      for (const c of ['video', 'graphic']) {
        if (nativeDeliverableId(card.id, c) === deliverableId) return crosswalkRowFor(card.id, c, options.slug || 'sidneylaruel');
      }
    }
    return null;
  };
  await ctx.route(url => url.pathname === '/rest/v1/calendar_posts' || url.pathname === '/rest/v1/sample_reviews', async (route) => {
    if (!_registered.length || route.request().method() !== 'GET') return route.fallback();
    let response;
    try { response = await route.fetch(); } catch (e) { return route.fallback(); }
    const body = await response.text();
    let rows;
    try { rows = JSON.parse(body); } catch (e) { rows = null; }
    if (!Array.isArray(rows)) return route.fulfill({ response, body });
    for (const row of rows) {
      const slots = row && slotsFor(row.id);
      if (!slots) continue;
      if (slots.video) row.video_deliverable_id = slots.video;
      if (slots.graphic) row.graphic_deliverable_id = slots.graphic;
    }
    return route.fulfill({ response, body: JSON.stringify(rows) });
  });
  await ctx.route(url => url.pathname === '/rest/v1/deliverables', async (route) => {
    const raw = decodeURIComponent(route.request().url());
    const ids = (raw.match(/probe_del_[vg]_[A-Za-z0-9_-]+/g) || []);
    const rows = [...new Set(ids)].map(crosswalkFor).filter(Boolean);
    if (!rows.length) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify(rows) });
  });
  await answerProbeCommentThreads(ctx, id => !!crosswalkFor(id));
  return true;
}

module.exports = {
  registerProbeWorkItems,
  applyProbeWorkItems,
  RETIRED_SET_STATUS_URL,
  RETIRED_ADD_COMMENT_URL,
  NATIVE_GATEWAY_PATH,
  nativeDeliverableId,
  crosswalkRowFor,
  stubNativeWorkItems,
  stubNativeGateway,
  captureRetiredWebhooks,
  retiredCallCount,
  seedVerifiedProbeStaff,
  waitForNoteThread,
  statusCalls,
  commentCalls
};
