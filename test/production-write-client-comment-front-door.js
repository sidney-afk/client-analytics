'use strict';
/*
 * THE FRONT DOOR: the gateway's widened client-comment contract.
 *
 * Background (2026-08-13 P0, PR #1064): the strict predicate
 * `clientCommentTargetAllowed` authorizes ONLY a card-bound SXR thread, so two
 * live client populations — every CALENDAR-surface comment and every UNLINKED
 * samples thread — could never use the gateway and were routed down the legacy
 * n8n lane. That lane stops accepting graphics traffic at the F1 authority
 * flip. This suite pins the REPAIR: `clientCommentFrontDoorTargetAllowed`
 * admits exactly those two populations under the binding that CAN be verified
 * for them (server-resolved principal slug + component→team + reader-mirrored
 * surface→origin + exact-card-when-bound), and NOTHING else.
 *
 * These are table tests against the real policy module (imported directly —
 * policy.mjs is deliberately runtime-free so Node can execute it), plus
 * behavioral runs of the writer's actual add-guard and lifecycle-guard blocks
 * extracted from index.ts. Client-principal coverage is the explicit priority:
 * the 2026-08-13 incident shipped dormant precisely because no test exercised
 * a client principal on these paths.
 */
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const writer = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

function extractParenBlock(text, start) {
  // Extracts an `if (...) { ... }` statement: balanced parens for the
  // condition, then the balanced brace block.
  const paren = text.indexOf('(', start);
  let depth = 0;
  let index = paren;
  for (; index < text.length; index++) {
    const ch = text[index];
    if (ch === '(') depth++;
    else if (ch === ')' && --depth === 0) break;
  }
  const brace = text.indexOf('{', index);
  depth = 0;
  for (index = brace; index < text.length; index++) {
    const ch = text[index];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  throw new Error('unclosed block');
}

(async () => {
  const policy = await import(pathToFileURL(path.join(
    ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs',
  )).href + '?front-door');
  const frontDoor = policy.clientCommentFrontDoorTargetAllowed;
  const strict = policy.clientCommentTargetAllowed;

  // F64: every slug below is a FAKE fixture slug, never a real client.
  const SLUG = 'enrolledclient';
  const calVideoRow = Object.freeze({
    origin: 'calendar', team: 'video', client_slug: SLUG, card_id: '',
  });
  const calGraphicRow = Object.freeze({
    origin: 'calendar', team: 'graphics', client_slug: SLUG, card_id: '',
  });
  const calBoundRow = Object.freeze({
    origin: 'calendar', team: 'video', client_slug: SLUG, card_id: 'card-1',
  });
  const sxrUnlinkedRow = Object.freeze({
    origin: 'samples', team: 'graphics', client_slug: SLUG, card_id: '',
  });
  const sxrBoundRow = Object.freeze({
    origin: 'samples', team: 'video', client_slug: SLUG, card_id: 'sxr-card',
  });
  const batchRow = Object.freeze({ team: 'video', client_slug: SLUG }); // no origin column

  // --- 1. CALENDAR surface: allow matrix -------------------------------------
  ok(frontDoor('calendar', calVideoRow, 'video', '', SLUG) === true,
    'client on own calendar video deliverable (unbound, no card presented) = allow');
  ok(frontDoor('calendar', calVideoRow, 'video', 'card-9', SLUG) === true,
    'unbound calendar row: a presented card has nothing to match and does not deny');
  ok(frontDoor('calendar', calGraphicRow, 'graphic', '', SLUG) === true,
    'client on own calendar GRAPHICS deliverable with component graphic = allow');
  ok(frontDoor('calendar', calBoundRow, 'video', 'card-1', SLUG) === true,
    'card-BOUND calendar row + the exact matching card = allow');
  ok(frontDoor('calendar', calBoundRow, 'video', 'card-2', SLUG) === false
    && frontDoor('calendar', calBoundRow, 'video', '', SLUG) === false,
    'card-BOUND calendar row + wrong or missing card = deny (exact-match rule kept)');

  // --- 2. CALENDAR surface: deny matrix --------------------------------------
  ok(frontDoor('calendar', calVideoRow, 'video', '', 'otherclient') === false,
    'wrong principal slug = deny');
  ok(frontDoor('calendar', calVideoRow, 'video', '', '') === false
    && frontDoor('calendar', calVideoRow, 'video', '', null) === false,
    'empty/absent principal slug = deny (never defaults open)');
  ok(frontDoor('calendar', { ...calVideoRow, client_slug: '' }, 'video', '', SLUG) === false,
    'row with no client_slug = deny');
  ok(frontDoor('calendar', calVideoRow, 'graphic', '', SLUG) === false
    && frontDoor('calendar', calGraphicRow, 'video', '', SLUG) === false,
    'component/team mismatch = deny in both directions');
  ok(frontDoor('calendar', calVideoRow, 'caption', '', SLUG) === false
    && frontDoor('calendar', calVideoRow, '', '', SLUG) === false,
    'a component outside video/graphic = deny');
  ok(frontDoor('calendar', { ...calVideoRow, origin: 'samples' }, 'video', '', SLUG) === false
    && frontDoor('calendar', { ...calVideoRow, origin: 'manual' }, 'video', '', SLUG) === false
    && frontDoor('calendar', { ...calVideoRow, origin: '' }, 'video', '', SLUG) === false,
    'calendar surface requires origin=calendar (samples/manual/empty = deny)');
  ok(frontDoor('calendar', batchRow, 'video', '', SLUG) === false,
    'a batches row (no origin column) fails closed');

  // --- 3. SXR surface: unlinked allow/deny matrix ----------------------------
  ok(frontDoor('sxr', sxrUnlinkedRow, 'graphic', '', SLUG) === true
    && frontDoor('sxr', { ...sxrUnlinkedRow, team: 'video' }, 'video', '', SLUG) === true,
    'client on own UNLINKED samples thread = allow (both teams)');
  ok(frontDoor('sxr', sxrUnlinkedRow, 'graphic', 'any-card', SLUG) === true,
    'unlinked sxr row: a presented card id is not required and does not deny');
  ok(frontDoor('sxr', sxrUnlinkedRow, 'graphic', '', 'otherclient') === false,
    'unlinked sxr, wrong slug = deny');
  ok(frontDoor('sxr', sxrUnlinkedRow, 'video', '', SLUG) === false,
    'unlinked sxr, component/team mismatch = deny');
  ok(frontDoor('sxr', { ...sxrUnlinkedRow, origin: 'calendar' }, 'graphic', '', SLUG) === false
    && frontDoor('sxr', { ...sxrUnlinkedRow, origin: 'manual' }, 'graphic', '', SLUG) === false,
    'sxr surface requires origin=samples');

  // --- 4. Card-bound SXR stays governed by the STRICT predicate alone --------
  ok(frontDoor('sxr', sxrBoundRow, 'video', 'sxr-card', SLUG) === false
    && frontDoor('sxr', sxrBoundRow, 'video', 'other-card', SLUG) === false
    && frontDoor('sxr', sxrBoundRow, 'video', '', SLUG) === false,
    'a card-BOUND sxr row NEVER enters the front door — even with the matching card');
  ok(strict('sxr', sxrBoundRow, 'video', 'sxr-card') === true
    && strict('sxr', sxrBoundRow, 'video', 'other-card') === false
    && strict('sxr', sxrUnlinkedRow, 'graphic', 'any-card') === false
    && strict('calendar', calBoundRow, 'video', 'card-1') === false,
    'the strict predicate is byte-for-byte unchanged in behavior: exact sxr card match only');

  // --- 5. Other surfaces stay locked -----------------------------------------
  for (const surface of ['production', 'workload', 'submission', '', 'SXR-extra']) {
    ok(frontDoor(surface, calVideoRow, 'video', '', SLUG) === false
      && frontDoor(surface, sxrUnlinkedRow, 'graphic', '', SLUG) === false,
      `surface ${JSON.stringify(surface)} = deny on both row shapes`);
  }

  // --- 6. The writer's ADD guard, executed with client AND staff principals --
  const addGuardMarker = writer.indexOf('// A client add is bound to the exact SXR card/component/deliverable');
  const addGuardStart = writer.indexOf('if (principal.kind === "client"', addGuardMarker);
  const addGuard = extractParenBlock(writer, addGuardStart);
  const gatewayContext = {
    clientCommentTargetAllowed: strict,
    clientCommentFrontDoorTargetAllowed: frontDoor,
    GatewayError: class GatewayError extends Error {
      constructor(status, code) { super(code); this.status = status; this.code = code; }
    },
  };
  vm.createContext(gatewayContext);
  vm.runInContext(`
    function runAddGuard(principal, surface, existing, commentInput, requestedCardId) {
      ${addGuard}
      return { ok: true };
    }
  `, gatewayContext);
  const addVerdict = (principal, surface, existing, component, card) => {
    try {
      return gatewayContext.runAddGuard(principal, surface, existing, { component }, card).ok === true;
    } catch (error) {
      return error && error.code === 'comment_forbidden' ? false : error;
    }
  };
  const client = { kind: 'client', clientSlug: SLUG };
  ok(addVerdict(client, 'calendar', calVideoRow, 'video', '') === true
    && addVerdict(client, 'sxr', sxrUnlinkedRow, 'graphic', '') === true
    && addVerdict(client, 'sxr', sxrBoundRow, 'video', 'sxr-card') === true,
    'ADD guard: client allowed on calendar, unlinked sxr, and (unchanged) exact-card sxr');
  ok(addVerdict(client, 'calendar', { ...calVideoRow, client_slug: 'otherclient' }, 'video', '') === false
    && addVerdict(client, 'calendar', calGraphicRow, 'video', '') === false
    && addVerdict(client, 'sxr', sxrBoundRow, 'video', 'other-card') === false
    && addVerdict(client, 'production', calVideoRow, 'video', '') === false,
    'ADD guard: client denied on wrong slug, wrong team, mismatched card, wrong surface');
  ok(addVerdict({ kind: 'staff', keyRole: 'creative' }, 'calendar', { origin: 'manual', team: 'video', client_slug: 'x' }, 'video', '') === true,
    'ADD guard: staff principals never consult either client predicate (unaffected)');

  // --- 7. The writer's LIFECYCLE guard condition, executed ------------------
  const lifecycleStart = writer.indexOf('if (clean(lifecycleRow.client_slug) !== targetClientSlug');
  const lifecycleGuard = extractParenBlock(writer, lifecycleStart);
  const lifecycleContext = {
    clean: policy.clean,
    lower: policy.lower,
    normalizeTeam: policy.normalizeTeam,
    clientCommentTargetAllowed: strict,
    clientCommentFrontDoorTargetAllowed: frontDoor,
    commentLifecycleAllowed: policy.commentLifecycleAllowed,
    GatewayError: gatewayContext.GatewayError,
  };
  vm.createContext(lifecycleContext);
  vm.runInContext(`
    function runLifecycleGuard(principal, action, surface, existing, lifecycleRow,
        requestedCardId, targetClientSlug, entity, id, team) {
      ${lifecycleGuard}
      return { ok: true };
    }
  `, lifecycleContext);
  const lifecycleVerdict = (principal, action, surface, existing, row) => {
    try {
      return lifecycleContext.runLifecycleGuard(
        principal, action, surface, existing, row, '', SLUG, 'deliverable', 'deliv-1',
        policy.normalizeTeam(existing.team),
      ).ok === true;
    } catch (error) {
      return error && error.code === 'comment_forbidden' ? false : error;
    }
  };
  const clientPrincipal = { kind: 'client', clientSlug: SLUG, actorKey: 'client:' + SLUG };
  const ownComment = {
    client_slug: SLUG, deliverable_id: 'deliv-1', batch_id: '', team: 'video',
    audience: 'client', author_key: 'client:' + SLUG, component: 'video',
  };
  ok(lifecycleVerdict(clientPrincipal, 'edit', 'calendar', calVideoRow, ownComment) === true
    && lifecycleVerdict(clientPrincipal, 'delete', 'calendar', calVideoRow, ownComment) === true,
    'LIFECYCLE guard: a client may edit/delete its own client-audience comment on the calendar front door');
  ok(lifecycleVerdict(clientPrincipal, 'edit', 'sxr',
    { ...sxrUnlinkedRow, team: 'video' }, ownComment) === true,
    'LIFECYCLE guard: same for the unlinked sxr front door');
  ok(lifecycleVerdict(clientPrincipal, 'edit', 'calendar', calVideoRow,
    { ...ownComment, audience: 'internal' }) === false,
    'LIFECYCLE guard: an internal-audience comment stays invisible to the client principal');
  ok(lifecycleVerdict(clientPrincipal, 'edit', 'calendar', calVideoRow,
    { ...ownComment, author_key: 'client:otherclient' }) === false,
    'LIFECYCLE guard: a client may not edit a comment it did not author');
  ok(lifecycleVerdict(clientPrincipal, 'resolve', 'calendar', calVideoRow, ownComment) === false
    && lifecycleVerdict(clientPrincipal, 'unresolve', 'calendar', calVideoRow, ownComment) === false,
    'LIFECYCLE guard: resolve/reopen remain staff moderation, front door or not');
  ok(lifecycleVerdict(clientPrincipal, 'edit', 'calendar',
    { ...calVideoRow, origin: 'manual' }, ownComment) === false,
    'LIFECYCLE guard: a target the front door denies stays denied for lifecycle too');
  ok(lifecycleVerdict({ kind: 'staff', keyRole: 'smm', actorKey: 'member:1' }, 'resolve',
    'calendar', { origin: 'manual', team: 'video', client_slug: 'x' },
    { ...ownComment, audience: 'internal' }) === true,
    'LIFECYCLE guard: staff moderation is unaffected by the widening');

  // --- 8. Source pins the extraction above cannot express --------------------
  ok(/let audience = principal\.kind === "client" \? "client" : lower\(commentInput\.audience \|\| "internal"\)/.test(writer),
    'audience is still FORCED to client for client principals on add');
  ok((writer.match(/clientCommentFrontDoorTargetAllowed\(\s*surface, existing, (?:commentInput|lifecycleRow)\.component, requestedCardId, principal\.clientSlug,?\s*\)/g) || []).length === 2,
    'both call sites pass principal.clientSlug — the server-resolved token binding, never request input');
  ok(!/clientCommentFrontDoorTargetAllowed\([^)]*body\./.test(writer),
    'no front-door call site reads a slug from the request body');

  if (failures) {
    console.error(`\n${failures} front-door check(s) failed`);
    process.exit(1);
  }
  console.log('\nGateway client-comment front-door checks passed');
})().catch(error => {
  console.error('FAIL  front-door harness crashed: ' + (error && error.stack || error));
  process.exit(1);
});
