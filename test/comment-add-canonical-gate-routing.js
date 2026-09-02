'use strict';
/*
 * THE COMMENT *ADD* LANE ROUTES ON THE CANONICAL GATE, LIKE ITS SIBLINGS.
 *
 * THE SPLIT THREAD. A card slot whose deliverable fails the F42 crosswalk has
 * no canonical thread and never can have one, so everything that READS it —
 * and `_calToggleCommentDone`, `_sxrToggleCommentDone` and both delete
 * confirms — branches on `_prodCanonicalCommentGate(post, comp).linked` and
 * stays on the legacy card store. ADD was the one comment operation that did
 * not: it routed on `_writeUiUseGatewayWhenReady`, which consults the
 * write_ui_reroute_clients allowlist and knows a client slug, not a card.
 *
 * So one thread could be written through two transports. A client root on such
 * a card fails `_prodClientCommentGatewayContext` and lands in the card store
 * with no `production_comments` row behind it; a STAFF reply to that same root
 * is sent to the gateway on the allowlist alone, the gateway finds no parent,
 * and the reply is refused — and the catch in `_calAppendComment` returns
 * before the local append, so the typed text is gone. Measured 2026-09-02:
 * 20 card slots across 6 clients were in exactly that state (a broken
 * crosswalk plus at least one client-authored root), on an estate where 5,150
 * of 6,241 deliverables carry no card_id at all.
 *
 * WHAT IS PINNED HERE, all against the real extracted functions:
 *   1. staff + a broken crosswalk -> LEGACY, and succeeds. This is the repair.
 *   2. staff + a slot that is not proven broken -> gateway, byte for byte as
 *      before.
 *   3. client + a verified front-door context -> gateway. The front door owns
 *      its own crosswalk decision and was deliberately built for the
 *      card_id-null population; the repair must not quietly close it.
 *   4. the LINKED client thread still fails closed on Samples.
 *   5. a caller that sends no verdict at all (the review-tweak lane, the
 *      repair drain, Kasper) is untouched.
 * Case 1 is also run against a variant with the new disjunct textually
 * removed, which must FAIL it — otherwise the assertion has no teeth.
 *
 * AND THE PREDICATE ITSELF, which is the part that decides how much of the
 * estate this touches. `_prodCommentAddRoutesLegacy` asks the CROSSWALK, not
 * `_prodCanonicalCommentGate`. The gate answers `linked:false` for three more
 * states, and rerouting any of them would be a regression rather than a
 * repair:
 *   - `unlinked` — no deliverable id at all, 18,180 of 19,362 slots on
 *     2026-09-02. Post-flip that write is refused on purpose
 *     (`native_link_required`), and a legacy fallback would report success on a
 *     card whose note reaches nothing at all.
 *   - `legacy_retained` — a crosswalk-VALID link the coverage invariant is
 *     holding. The canonical thread is real; only the projection is held.
 *   - `crosswalk_error` — a lookup that failed. Unknown is not broken.
 * It also mirrors the ONE mismatch shape the gateway client front door admits
 * (`card_id` alone with the deliverable side unbound), because a client root
 * there went canonical and its reply must follow it.
 *
 * Plus the source contract: both append functions decide with the component
 * the write will actually use — a REPLY inherits its component from the parent
 * thread — and hand the answer down rather than letting the transport
 * re-derive it from a `component` that collapses caption/title onto video. And
 * the decision is made AFTER the gate is read, never before: an add lane that
 * stamped a fresh crosswalk verdict ahead of the gate would flip a card whose
 * canonical read nobody has performed from `linked:false` to
 * `{linked:true, ready:false}` and hard-refuse a send that succeeds today.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace matcher that SKIPS comments and strings. index.html comments are prose
   full of apostrophes and backticked identifiers, and a scanner that reads
   those as quotes swallows every brace after them. */
function extract(name, text) {
  const body = text || source;
  const marker = 'function ' + name + '(';
  let start = body.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (body.slice(start - 6, start) === 'async ') start -= 6;
  const brace = body.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < body.length; i++) {
    const ch = body[i], next = body[i + 1];
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
    else if (ch === '}' && --depth === 0) return body.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}

const CAL_SRC = extract('_calPostLinearComment');
const SXR_SRC = extract('_sxrPostLinearComment');

/* The single disjunct this suite is about. Removing it is how the negative
   control is built, so the test proves the LINE does the work, not the
   surrounding scaffolding. */
const DISJUNCT = ' || canonicalUnlinkedAdd';
assert(CAL_SRC.includes(DISJUNCT) && SXR_SRC.includes(DISJUNCT),
  'the add-lane disjunct was renamed; update DISJUNCT before trusting this suite');

function harness(sources) {
  const host = {
    legacy: [], gateway: [], useGateway: true, frontDoor: null,
    gate: { linked: false, ready: false, client: false, status: 'crosswalk_mismatch' },
    mutationContext: null,
  };
  const context = vm.createContext({
    _isClientLink: false,
    _writeUiUseGatewayWhenReady: async () => host.useGateway,
    _prodClientCommentGatewayContext: async () => host.frontDoor,
    _prodCanonicalCommentGate: () => host.gate,
    _prodVerifiedClientCommentMutationContext: () => host.mutationContext,
    _calLegacyPostLinearComment: (...args) => host.legacy.push(['calendar', args]),
    _sxrLegacyPostLinearComment: (...args) => host.legacy.push(['sxr', args]),
    _writeUiGatewayWithRepair: async (intent, repair) => {
      host.gateway.push({ intent, repair });
      return { ok: true, native_committed: true };
    },
    _writeUiNativeId: (post, component) => String((component === 'graphic'
      ? post && post.graphic_deliverable_id
      : post && post.video_deliverable_id) || '').trim(),
    _writeUiTeam: component => (component === 'graphic' ? 'graphics' : 'video'),
    _writeUiIntentId: (surface, operation, parts) => [surface, operation].concat(parts || []).join(':'),
    _writeUiBuildSourceRepair: () => ({ staff_repair: true }),
    _writeUiClassifyTargetless: async () => ({ skipped: true }),
    _writeUiGatewayError: (status, code) => Object.assign(new Error(code), { status, code }),
    Date, Promise, Object, String, Number, JSON,
  });
  vm.runInContext(sources.join('\n'), context);
  return { context, host };
}

const SHIPPED = [CAL_SRC, SXR_SRC];
const REVERTED = [CAL_SRC.split(DISJUNCT).join(''), SXR_SRC.split(DISJUNCT).join('')];

const CAL_META = () => ({
  post: { id: 'cal-card-1', client_slug: 'aclient', video_deliverable_id: 'deliv-1' },
  component: 'video',
  comment: { id: 'note-1', created_at: '2026-09-02T00:00:00Z' },
  parentId: 'root-1',
  audience: 'client',
});
const SXR_META = () => ({
  post: { id: 'sxr-card-1', client_slug: 'aclient', graphic_deliverable_id: 'deliv-2' },
  component: 'graphic',
  comment: { id: 'note-2', created_at: '2026-09-02T00:00:00Z' },
  parentId: 'root-2',
  audience: 'client',
});
const LANES = [
  ['_calPostLinearComment', 'calendar', CAL_META, 'cal-card-1'],
  ['_sxrPostLinearComment', 'sxr', SXR_META, 'sxr-card-1'],
];

(async () => {
  for (const [fn, surface, meta, cardId] of LANES) {
    {
      // 1. THE REPAIR. Staff, enrolled (the allowlist says gateway), on a slot
      // whose crosswalk does not validate: the add lane takes the legacy card
      // store — the store this card is already read from — and succeeds.
      const { context, host } = harness(SHIPPED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM',
        Object.assign(meta(), { canonicalUnlinked: true }));
      ok(host.legacy.length === 1 && host.legacy[0][0] === surface && host.gateway.length === 0,
        `${surface}: an enrolled STAFF add on a CROSSWALK-BROKEN card routes legacy instead of 409ing`);
      ok(host.legacy[0][1][1] === 'Staff reply',
        `${surface}: and it carries the typed text, which is the whole point`);
    }
    {
      // The negative control. Without the disjunct the same call reaches the
      // gateway — which is the shipped defect, reproduced.
      const { context, host } = harness(REVERTED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM',
        Object.assign(meta(), { canonicalUnlinked: true }));
      ok(host.gateway.length === 1 && host.legacy.length === 0,
        `${surface}: with the disjunct removed the same add goes to the gateway — the assertion has teeth`);
    }
    {
      // 2. ANY slot the crosswalk does not prove broken is untouched: gateway,
      // staff repair journal intact, no card binding invented. This is the case
      // that covers `unlinked`, `legacy_retained` and a failed lookup, all of
      // which `_prodCommentAddRoutesLegacy` answers false for.
      const { context, host } = harness(SHIPPED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM',
        Object.assign(meta(), { canonicalUnlinked: false }));
      ok(host.gateway.length === 1 && host.legacy.length === 0
        && host.gateway[0].intent.comment.card_id === undefined
        && host.gateway[0].repair !== null,
        `${surface}: a staff add on a slot NOT proven broken routes the gateway exactly as before`);
    }
    {
      // 5. A caller that sends no verdict (review-tweak, repair drain, Kasper)
      // keeps its current routing. The repair is scoped to the add lane.
      const { context, host } = harness(SHIPPED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM', meta());
      ok(host.gateway.length === 1 && host.legacy.length === 0,
        `${surface}: a caller that sends no gate verdict at all is routed exactly as before`);
    }
    {
      // 3. THE CLIENT FRONT DOOR SURVIVES, and outranks the handed-down answer
      // if the two ever disagree. card_id-null deliverables are the normal case
      // estate-wide and the front door was built for precisely them.
      const { context, host } = harness(SHIPPED);
      context._isClientLink = true;
      host.frontDoor = Object.freeze({ source_surface: surface, card_id: cardId, component: meta().component });
      await context[fn]('https://linear.app/x/issue/T-1', 'Client note', 'Client',
        Object.assign(meta(), { canonicalUnlinked: true }));
      ok(host.gateway.length === 1 && host.legacy.length === 0
        && host.gateway[0].intent.comment.card_id === cardId,
        `${surface}: a CLIENT with a verified front-door context still routes the gateway with its card binding`);
    }
    {
      // ...and a client WITHOUT one still routes legacy, as it did before.
      const { context, host } = harness(SHIPPED);
      context._isClientLink = true;
      host.frontDoor = null;
      await context[fn]('https://linear.app/x/issue/T-1', 'Client note', 'Client',
        Object.assign(meta(), { canonicalUnlinked: true }));
      ok(host.legacy.length === 1 && host.gateway.length === 0,
        `${surface}: a CLIENT without a verified context still routes legacy (the 2026-08-13 P0 stays fixed)`);
    }
  }

  {
    // 4. The LINKED client thread on Samples is fail-closed and must stay so:
    // an unready canonical read refuses rather than falling back, verdict or no
    // verdict. Nothing here may weaken that.
    const { context, host } = harness(SHIPPED);
    context._isClientLink = true;
    host.gate = { linked: true, ready: false, client: false, status: 'loading' };
    let refused = '';
    try {
      await context._sxrPostLinearComment('https://linear.app/x/issue/T-1', 'Client note', 'Client',
        Object.assign(SXR_META(), { canonicalUnlinked: false }));
    } catch (error) { refused = error && error.code; }
    ok(refused === 'canonical_comment_read_required' && host.legacy.length === 0 && host.gateway.length === 0,
      'sxr: a LINKED but unready client thread still fails closed and never falls back to legacy');
  }

  // --- The component decided on is the component the write uses -----------
  /* A REPLY inherits its component from the parent thread, so the decision has
     to be made where the real `comp` is known and handed down; the transport
     must not re-derive it, because its own `component` collapses caption and
     title onto video. And it must be made AFTER the gate is read: an add lane
     that resolved-and-stamped a crosswalk verdict first would turn a card
     nobody has read canonically from `linked:false` into
     `{linked:true, ready:false}`, and the guard immediately below the gate
     would then refuse a send that succeeds today, with no control to clear it
     until the modal is reopened. */
  const calAppend = extract('_calAppendComment');
  const sxrAppend = extract('_sxrAppendComment');
  for (const [label, body, surfaceArg, gateCall] of [
    ['_calAppendComment', calAppend, "'calendar'", '_calPostLinearComment'],
    ['_sxrAppendComment', sxrAppend, "'sxr'", '_sxrPostLinearComment'],
  ]) {
    ok(new RegExp('await _prodCommentAddRoutesLegacy\\(' + surfaceArg + ', post, comp\\)').test(body),
      `${label}: decides the transport from the crosswalk, for the component this write uses`);
    ok(!/_prodEnsureCardCrosswalk/.test(body),
      `${label}: and stamps no crosswalk verdict of its own before the gate is read`);
    ok(body.indexOf('_prodCanonicalCommentGate(post, comp)') < body.indexOf('_prodCommentAddRoutesLegacy'),
      `${label}: the gate is read BEFORE the routing lookup, so the lookup cannot change its answer`);
    ok(body.indexOf('_prodCanonicalCommentGate(post, comp)') < body.indexOf(gateCall + '('),
      `${label}: the gate verdict is computed before the transport is chosen`);
    ok(/canonicalUnlinked\b/.test(body) && !/canonicalUnlinked: !canonicalGate\.linked/.test(body),
      `${label}: the answer travels with the write and is NOT the gate's own linked flag`);
  }
  ok(!/_prodCanonicalCommentGate\(meta && meta\.post/.test(CAL_SRC),
    'the calendar transport never re-derives the gate from its own collapsed component');

  /* ---- THE PREDICATE, against the page's own crosswalk ------------------
     Everything above takes `canonicalUnlinked` as given. This is where the
     value comes from, and the narrowing is the whole safety argument: three
     states the GATE calls unlinked must keep the transport they have today,
     and the one mismatch shape the client front door admits must too. */
  {
    const lookups = [];
    const CARD = 'p_fixture_card_1';
    let FIXTURE_OK = true;
    let FIXTURE_ROWS = {};
    const predicateCtx = vm.createContext({
      _writeUiNativeId: (post, component) => String((component === 'graphic'
        ? post && post.graphic_deliverable_id
        : post && post.video_deliverable_id) || '').trim(),
      _prodCrosswalkVerdict: (post, id, component) =>
        (post && post._verdicts || {})[component + '|' + id] || null,
      _prodFetchCrosswalkRows: async ids => {
        lookups.push(ids.slice());
        const rows = new Map();
        for (const id of ids) if (FIXTURE_ROWS[id]) rows.set(id, FIXTURE_ROWS[id]);
        return { ok: FIXTURE_OK, rows };
      },
      Array, String, Object, Promise, JSON,
    });
    /* The page's own crosswalk, lifted rather than re-implemented: a predicate
       with a private idea of "mismatch" would route on a rule the gate and the
       standing check do not share. */
    vm.runInContext(/const PROD_CROSSWALK_SURFACE_ORIGIN = \{[^}]*\};/.exec(source)[0], predicateCtx);
    vm.runInContext(extract('_prodCrosswalkTeamForComponent'), predicateCtx);
    vm.runInContext(extract('_prodCrosswalkCardSlug'), predicateCtx);
    vm.runInContext(extract('_prodCrosswalkMismatchFields'), predicateCtx);
    vm.runInContext(extract('_prodCommentAddRoutesLegacy'), predicateCtx);

    const routes = (post, component) => predicateCtx._prodCommentAddRoutesLegacy('calendar', post, component);
    const card = extra => Object.assign({ id: CARD, client: 'aclient' }, extra || {});
    const good = { id: 'b1_d_x', origin: 'calendar', team: 'graphics', client_slug: 'aclient', card_id: CARD };

    ok(await routes(card({ graphic_deliverable_id: '' }), 'graphic') === false
      && lookups.length === 0,
      'UNLINKED (no deliverable id) keeps the gateway and its deliberate native_link_required refusal — '
      + '18,180 of 19,362 slots, and not one of them is looked up');
    ok(await routes(card({ caption_deliverable_id: 'b1_d_x' }), 'caption') === false,
      'a component that carries no deliverable at all is never routed by this rule');

    FIXTURE_ROWS = { b1_d_x: good };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === false,
      'a crosswalk-VALID slot keeps the gateway — which is also the `legacy_retained` case, because the '
      + 'coverage hold lives on the READ and never on the crosswalk');

    FIXTURE_ROWS = { b1_d_x: { ...good, origin: 'manual', card_id: null } };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === true,
      'THE REPAIR: origin+card_id is the live 2026-09-02 incident shape, and 16 of the 20 at-risk slots');

    FIXTURE_ROWS = { b1_d_x: { ...good, team: 'video' } };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === true,
      'a team mismatch routes legacy too — 2 of the 20');

    FIXTURE_ROWS = { b1_d_x: { ...good, card_id: null } };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === false,
      'THE FRONT-DOOR CARVE-OUT: card_id alone with the deliverable side UNBOUND is the one mismatch the '
      + 'gateway client door admits, so the client root there IS canonical and the reply must follow it');

    FIXTURE_ROWS = { b1_d_x: { ...good, card_id: 'p_fixture_card_2' } };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === true,
      'but card_id naming a DIFFERENT card is not that carve-out — the gateway denies it, so it goes legacy. '
      + 'All 8 card_id-only mismatches in the estate on 2026-09-02 are this shape');

    FIXTURE_ROWS = {};
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === false,
      'a deliverable row we cannot see is UNKNOWN, not broken: no reroute');
    FIXTURE_OK = false;
    FIXTURE_ROWS = { b1_d_x: { ...good, origin: 'manual', card_id: null } };
    ok(await routes(card({ graphic_deliverable_id: 'b1_d_x' }), 'graphic') === false,
      'and a failed lookup keeps the transport it has rather than inventing a verdict');
    FIXTURE_OK = true;

    const before = lookups.length;
    const stamped = card({
      graphic_deliverable_id: 'b1_d_x',
      _verdicts: { 'graphic|b1_d_x': { state: 'mismatch', fields: ['card_id', 'origin'] } },
    });
    ok(await routes(stamped, 'graphic') === true && lookups.length === before,
      'a slot the projection already stamped costs no second lookup and gives the same answer');
    ok(!stamped._canonicalCrosswalk,
      'AND NOTHING IS STAMPED BY THIS PATH: the routing lookup never writes a verdict, so it can never '
      + 'flip the gate to {linked:true, ready:false} and refuse a send that works today');
  }

  if (failures) {
    console.error(`\n${failures} comment add-lane routing check(s) failed`);
    process.exit(1);
  }
  console.log('\ncomment add-lane canonical gate routing checks passed');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
