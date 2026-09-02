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
 *   1. staff + unlinked  -> LEGACY, and succeeds. This is the repair.
 *   2. staff + linked    -> gateway, byte for byte as before.
 *   3. client + a verified front-door context -> gateway, even though the gate
 *      says unlinked. The front door owns its own crosswalk decision and was
 *      deliberately built for the card_id-null population; the repair must not
 *      quietly close it.
 *   4. the LINKED client thread still fails closed on Samples.
 *   5. a caller that sends no verdict at all (the review-tweak lane, the
 *      repair drain, Kasper) is untouched.
 * Case 1 is also run against a variant with the new disjunct textually
 * removed, which must FAIL it — otherwise the assertion has no teeth.
 *
 * Plus the source contract: both append functions resolve the crosswalk for
 * the component the write will actually use — a REPLY inherits its component
 * from the parent thread, which may be one the modal-open projection never
 * resolved — and hand the verdict down rather than letting the transport
 * re-derive it from a `component` that collapses caption/title onto video.
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
      // 1. THE REPAIR. Staff, enrolled (the allowlist says gateway), on a card
      // whose crosswalk does not validate: the add lane takes the legacy card
      // store — the store this card is already read from — and succeeds.
      const { context, host } = harness(SHIPPED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM',
        Object.assign(meta(), { canonicalUnlinked: true }));
      ok(host.legacy.length === 1 && host.legacy[0][0] === surface && host.gateway.length === 0,
        `${surface}: an enrolled STAFF add on an UNLINKED card routes legacy instead of 409ing`);
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
      // 2. A VALIDLY LINKED card is untouched: gateway, staff repair journal
      // intact, no card binding invented.
      const { context, host } = harness(SHIPPED);
      await context[fn]('https://linear.app/x/issue/T-1', 'Staff reply', 'SMM',
        Object.assign(meta(), { canonicalUnlinked: false }));
      ok(host.gateway.length === 1 && host.legacy.length === 0
        && host.gateway[0].intent.comment.card_id === undefined
        && host.gateway[0].repair !== null,
        `${surface}: a staff add on a crosswalk-VALID card routes the gateway exactly as before`);
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
      // 3. THE CLIENT FRONT DOOR SURVIVES. card_id-null deliverables are the
      // normal case estate-wide, the gate calls them unlinked, and the front
      // door was built for precisely them. A verified context still wins.
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

  // --- The component the gate is asked about is the component the write uses -
  /* A REPLY inherits its component from the parent thread, so it can name a
     component that is not in the card's active review set — the only set the
     modal-open projection ever resolves. The verdict is therefore computed in
     the append function, where `comp` is the real one, and handed down; the
     transport must not re-derive it, because its own `component` collapses
     caption and title onto video. */
  const calAppend = extract('_calAppendComment');
  const sxrAppend = extract('_sxrAppendComment');
  for (const [label, body, surfaceArg, gateCall] of [
    ['_calAppendComment', calAppend, "'calendar'", '_calPostLinearComment'],
    ['_sxrAppendComment', sxrAppend, "'sxr'", '_sxrPostLinearComment'],
  ]) {
    ok(new RegExp('await _prodEnsureCardCrosswalk\\(' + surfaceArg + ', post, comp\\)').test(body),
      `${label}: resolves the crosswalk for the component this write will use, on demand`);
    ok(body.indexOf('_prodEnsureCardCrosswalk') < body.indexOf('_prodCanonicalCommentGate(post, comp)'),
      `${label}: and it does so BEFORE the gate that decides the transport is read`);
    ok(body.indexOf('_prodCanonicalCommentGate(post, comp)') < body.indexOf(gateCall + '('),
      `${label}: the gate verdict is computed before the transport is chosen`);
    ok(/canonicalUnlinked: !canonicalGate\.linked/.test(body),
      `${label}: and travels with the write rather than being re-derived downstream`);
  }
  ok(!/_prodCanonicalCommentGate\(meta && meta\.post/.test(CAL_SRC),
    'the calendar transport never re-derives the gate from its own collapsed component');

  /* The resolve is one-shot and idempotent: a slot that already carries a
     verdict costs nothing, and a failed lookup stamps `error`, which the gate
     reads as not linked — so refusing still fails toward legacy, never toward
     the gateway. */
  {
    const calls = [];
    const ensureCtx = vm.createContext({
      _writeUiNativeId: (post, component) => String((component === 'graphic'
        ? post && post.graphic_deliverable_id
        : post && post.video_deliverable_id) || '').trim(),
      _prodCrosswalkVerdict: (post, id, component) => (post._verdicts || {})[component + '|' + id] || null,
      _prodResolveCardCrosswalk: async (surface, post, components) => {
        calls.push([surface, post.id, components.join(',')]);
      },
      String, Promise, Object,
    });
    vm.runInContext(extract('_prodEnsureCardCrosswalk'), ensureCtx);

    await ensureCtx._prodEnsureCardCrosswalk('calendar', { id: 'c1' }, 'video');
    ok(calls.length === 0, 'a slot with no deliverable id never triggers a lookup');

    await ensureCtx._prodEnsureCardCrosswalk('calendar', { id: 'c1', graphic_deliverable_id: 'd1' }, 'graphic');
    ok(calls.length === 1 && calls[0][2] === 'graphic',
      'an unresolved slot resolves exactly its own component, not the whole card');

    await ensureCtx._prodEnsureCardCrosswalk('sxr', {
      id: 'c1', video_deliverable_id: 'd2', _verdicts: { 'video|d2': { state: 'valid' } },
    }, 'video');
    ok(calls.length === 1, 'a slot that already carries a verdict costs no second lookup');

    ensureCtx._prodResolveCardCrosswalk = async () => { throw new Error('network down'); };
    let threw = false;
    try {
      await ensureCtx._prodEnsureCardCrosswalk('calendar', { id: 'c1', video_deliverable_id: 'd3' }, 'video');
    } catch (error) { threw = true; }
    ok(!threw, 'a failed lookup never propagates: the unstamped verdict reads as not linked, which is legacy');
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
