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
  await ctx.route(url => url.pathname === '/rest/v1/calendar_posts', async (route) => {
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
 * Route the two retired webhooks and COUNT them. They are answered 200 so a
 * probe that trips one fails on the assertion rather than on a network error —
 * a failure that says "this went to Linear" is worth more than one that says
 * "a request failed".
 */
async function captureRetiredWebhooks(ctx) {
  const setStatus = [];
  const addComment = [];
  await ctx.route('**/webhook/linear-set-status', async (route) => {
    try { setStatus.push(JSON.parse(route.request().postData() || '{}')); }
    catch (e) { setStatus.push({ parseErr: true }); }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"ok":true}' });
  });
  await ctx.route('**/webhook/linear-add-comment', async (route) => {
    try { addComment.push(JSON.parse(route.request().postData() || '{}')); }
    catch (e) { addComment.push({ parseErr: true }); }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: '{"ok":true}' });
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
 * ever presents it to a server. Same shape `qa/probes/cal_linear_deep.js` has
 * used since the item-63 drain work. Call it AFTER the page has loaded.
 */
async function seedVerifiedProbeStaff(page, options) {
  const opts = options || {};
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

module.exports = {
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
  statusCalls,
  commentCalls
};
