'use strict';
/*
 * THE NIGHTLY MUST ASSERT THE LANE PRODUCTION TAKES, NOT THE ONE IT LEFT.
 *
 * `test/qa-harness-routes-like-production.js` proved the harnesses ROUTE like
 * production. This proves the three probes that watch a write ASSERT like
 * production, and that the fixture standing behind them produces the shapes the
 * shipped code actually consumes.
 *
 * The defect it exists for: p28/p29/p30 waited for calls to `linear-set-status`
 * and `linear-add-comment` and passed when they arrived. Both teams have been
 * SyncView-authoritative since 2026-08-28 and all 43 active clients are
 * enrolled, so those webhooks are not a lane a real status change or comment
 * takes. Once the roster fixture put the TEST client on the production lane,
 * those three probes were left asserting retired traffic — a green nightly
 * describing a dead world, one layer below the one already repaired.
 *
 * WHY THIS SUITE EXISTS AT ALL, rather than "just run the probes": the probes
 * need a browser with a route to the live backend. This runs offline in
 * `npm test`, on every pull request, which is where a claim about what the
 * nightly asserts can be checked cheaply and often. It does not replace running
 * them.
 *
 * Everything below EXECUTES: the fixture's real route handlers are driven
 * through a stand-in for Playwright's routing API, and the predicates are
 * lifted out of `index.html` rather than restated.
 *
 * Only slugs and synthetic ids appear here. The repository is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const NW = require(path.join(ROOT, 'qa', 'native_work_item_fixture.js'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Same brace-matching lift the sibling suites use. */
function grabFunc(name) {
  const at = INDEX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}

const PROBES = ['p28_linear_sync.js', 'p29_linear_kasper.js', 'p30_linear_client.js'];
const PROBE_SRC = PROBES.map(name => [name, fs.readFileSync(path.join(ROOT, 'qa', 'probes', name), 'utf8')]);

/* ---- 1. NO PROBE STILL WAITS FOR THE RETIRED WEBHOOKS -------------------- */
/* The captures may still EXIST — a probe that does not watch those URLs cannot
   prove nothing went to them — but nothing may be asserted PRESENT on them. */

for (const [name, src] of PROBE_SRC) {
  ok(/captureRetiredWebhooks/.test(src),
    name + ' still watches the retired webhooks, which is how it can prove nothing reached them');
  ok(/retired\.setStatus\.length === 0 && retired\.addComment\.length === 0/.test(src),
    name + ' asserts ZERO traffic to linear-set-status and linear-add-comment');
  ok(/native_work_item_fixture/.test(src),
    name + ' seeds a native work item, so its cards are shaped like production cards');
  ok(/statusCalls\(|commentCalls\(/.test(src),
    name + ' asserts on native gateway intents');
}

/* ---- 2. THE FIXTURE ACTUALLY STAMPS THE CARD ----------------------------- */
/* Executed, not read. A stand-in for the slice of Playwright's routing API the
   fixture uses, so a handler that stopped working would fail here. */

function makeRoutingContext(upstream) {
  const handlers = [];
  const ctx = { route: async (matcher, handler) => { handlers.push({ matcher, handler }); } };
  async function dispatch(urlText, init) {
    const url = new URL(urlText);
    const request = {
      url: () => urlText,
      method: () => (init && init.method) || 'GET',
      postData: () => (init && init.body) || null
    };
    // Playwright matches most-recently-registered first and `fallback()` defers
    // to the next one down; `FELL_THROUGH` is "left live".
    const ordered = handlers.slice().reverse();
    let index = 0;
    const step = async () => {
      if (index >= ordered.length) return { outcome: 'FELL_THROUGH' };
      const entry = ordered[index++];
      const matches = typeof entry.matcher === 'function'
        ? entry.matcher(url)
        : urlText.includes(String(entry.matcher).replace(/\*/g, ''));
      if (!matches) return step();
      let result = null;
      const route = {
        request: () => request,
        fallback: async () => { result = await step(); return result; },
        fetch: async () => {
          const served = await upstream(urlText, init);
          return { text: async () => served.body, headers: () => served.headers || {} };
        },
        fulfill: async (options) => { result = { outcome: 'FULFILLED', body: options.body }; return result; }
      };
      await entry.handler(route);
      return result || { outcome: 'FELL_THROUGH' };
    };
    return step();
  }
  return { ctx, dispatch };
}

(async () => {
  const CARD = 'p_probe_card_1';
  const OTHER = 'p_someone_elses_card';
  const VID = NW.nativeDeliverableId(CARD, 'video');
  const GID = NW.nativeDeliverableId(CARD, 'graphic');

  const upstreamRows = [
    { id: CARD, client: 'sidneylaruel', video_deliverable_id: null, graphic_deliverable_id: null, video_status: 'In Progress' },
    { id: OTHER, client: 'sidneylaruel', video_deliverable_id: null, graphic_deliverable_id: null, video_status: 'In Progress' }
  ];
  const { ctx, dispatch } = makeRoutingContext(async () => ({
    body: JSON.stringify(upstreamRows),
    headers: { 'content-range': '0-1/2' }
  }));
  await NW.stubNativeWorkItems(ctx, [{ id: CARD, components: ['video', 'graphic'] }]);

  const calendarRead = await dispatch('https://stub.invalid/rest/v1/calendar_posts?select=*&client=eq.sidneylaruel');
  ok(calendarRead.outcome === 'FULFILLED', 'the fixture answers the calendar read');
  const served = JSON.parse(calendarRead.body);
  const mine = served.find(r => r.id === CARD);
  const theirs = served.find(r => r.id === OTHER);
  ok(mine && mine.video_deliverable_id === VID && mine.graphic_deliverable_id === GID,
    "the probe's own card comes back carrying both native work items");
  ok(theirs && !theirs.video_deliverable_id && !theirs.graphic_deliverable_id,
    'and every other card in the same response is untouched — the fixture stamps its cards, not the table');
  ok(mine && mine.video_status === 'In Progress',
    'and the rest of the row is passed through as the backend sent it');

  const crosswalkRead = await dispatch('https://stub.invalid/rest/v1/deliverables?select=id,client_slug,team,origin,card_id&id=in.(%22' + VID + '%22)');
  ok(crosswalkRead.outcome === 'FULFILLED', 'the crosswalk read for a fixture id is answered');
  const crosswalkRows = JSON.parse(crosswalkRead.body);
  ok(crosswalkRows.length === 1 && crosswalkRows[0].id === VID, 'with exactly the row that was asked for');

  const liveRead = await dispatch('https://stub.invalid/rest/v1/deliverables?select=*&client_slug=eq.sidneylaruel');
  ok(liveRead.outcome === 'FELL_THROUGH',
    'a deliverables read naming none of the fixture ids is left LIVE — the fixture fakes the ids it '
    + 'minted and nothing else');

  /* ---- 3. THE STAMPED CARD SATISFIES THE SHIPPED PREDICATES -------------- */
  /* The point of the fixture is to reach the real native branch. These are the
     three gates between a card and a native write, lifted from index.html and
     run against the fixture's own output. */

  const sandbox = { console, String, Array, Boolean, Number };
  vm.createContext(sandbox);
  vm.runInContext([
    grabFunc('_writeUiComponentHasWorkItem'),
    grabFunc('_writeUiNativeId'),
    grabFunc('_writeUiNativeStatus'),
    grabFunc('_prodCrosswalkTeamForComponent'),
    grabFunc('_prodCrosswalkCardSlug'),
    grabFunc('_prodCrosswalkMismatchFields'),
    "const PROD_CROSSWALK_SURFACE_ORIGIN = { calendar: 'calendar', sxr: 'samples' };"
  ].join('\n'), sandbox);

  const post = Object.assign({ client_slug: 'sidneylaruel' }, mine);
  ok(sandbox._writeUiNativeId(post, 'video') === VID && sandbox._writeUiNativeId(post, 'graphic') === GID,
    'the SHIPPED _writeUiNativeId reads both stamped ids off the card — so makePayload gets an '
    + '`id` instead of throwing native_link_required, which is the refusal that stood in front of '
    + 'every one of these probes');
  ok(sandbox._writeUiNativeId(post, 'caption') === '',
    'and still answers nothing for caption, which owns no work item (OPEN_REPAIRS 127) — the '
    + 'probes assert caption transports nothing, and this is why');

  for (const component of ['video', 'graphic']) {
    const row = NW.crosswalkRowFor(CARD, component, 'sidneylaruel');
    const mismatch = sandbox._prodCrosswalkMismatchFields(row, 'calendar', post, component);
    ok(mismatch.length === 0,
      'the fixture crosswalk row for ' + component + ' matches the card on all four fields the '
      + 'shipped comparison checks, so the verdict is `valid` and the client front door can open');
  }
  const wrongCardRow = NW.crosswalkRowFor(OTHER, 'video', 'sidneylaruel');
  ok(sandbox._prodCrosswalkMismatchFields(wrongCardRow, 'calendar', post, 'video').includes('card_id'),
    '  · CONTROL: a row describing a DIFFERENT card is a mismatch, so the check above is not vacuous');

  /* The exact native status strings the three probes assert, produced by the
     shipped mapper from the labels they click. A probe asserting a status the
     mapper never emits would pass review and fail at 08:00. */
  const STATUS_CASES = [
    ['Tweaks Needed', 'tweak'],
    ['For SMM Approval', 'smm_approval'],
    ['Kasper Approval', 'kasper_approval'],
    ['Client Approval', 'client_approval'],
    ['Approved', 'approved']
  ];
  for (const [label, native] of STATUS_CASES) {
    ok(sandbox._writeUiNativeStatus(label) === native,
      'the shipped mapper turns "' + label + '" into `' + native + '`, which is what the probes assert');
  }

  /* ---- 4. THE REFUSAL THE FIXTURE EXISTS TO GET PAST --------------------- */
  /* Pinned on the source because `makePayload` is a closure inside
     `_writeUiGatewayPost` and cannot be lifted alone. If this rule ever
     changes, the fixture's reason for existing changes with it. */
  ok(/if \(!intent\.legacyOnly && !legacyParity && !intent\.nativeId\) \{\s*throw _writeUiGatewayError\(409, 'native_link_required'\);/.test(INDEX),
    'the gateway payload builder still refuses a native write with no work item — the reason a probe '
    + 'card needs one, stated where a future edit would have to change it');

  console.log(`\nprobes-assert-native-write-lane: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAIL  suite threw: ' + (e && e.stack || e)); process.exit(1); });
