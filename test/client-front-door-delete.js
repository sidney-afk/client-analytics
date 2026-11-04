'use strict';
/*
 * OPEN_REPAIRS 690: a client deleting its own note on a linked card.
 *
 * The client reads and writes the card's own notes; the add ALSO went through
 * the client front door, which copied the note to production_comments under
 * the card note's id (native_comment_id). The delete only tombstoned the card
 * copy, so the Production copy stayed open for staff. The client can never read
 * the canonical thread, so it never holds the version the lifecycle check
 * needs. The repair lets the server take that version from the row for exactly
 * one case (clientFrontDoorDeleteWithoutVersion) and nothing else.
 *
 * Three parts:
 *   1. the policy, as a table (what must work, and what must not);
 *   2. the writer's own lifecycle code, cut out of production-write/index.ts and
 *      run: resolve the note, the guard, the version check, the dispatch;
 *   3. the page: Calendar and Samples deletes ask the same front door.
 * Fictional data only: the slugs, ids and names below are invented.
 */
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

let failures = 0;
let passed = 0;
function ok(condition, message) {
  if (condition) { passed++; console.log('  ok  ' + message); }
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const writer = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'production-write', 'index.ts'), 'utf8');

// The text from `start` through the end of the first complete statement block
// that ends at or after `endMarker`, braces balanced.
function cutThrough(text, start, endMarker) {
  const from = text.indexOf(start);
  if (from < 0) throw new Error('start not found: ' + start);
  const markerAt = text.indexOf(endMarker, from);
  if (markerAt < 0) throw new Error('end not found: ' + endMarker);
  const close = text.indexOf('}', markerAt);
  return text.slice(from, close + 1);
}
// An if / else if / else chain starting at `start`, braces balanced.
function cutChain(text, start) {
  let index = text.indexOf(start);
  if (index < 0) throw new Error('chain not found: ' + start);
  const from = index;
  for (;;) {
    let depth = 0;
    let brace = text.indexOf('{', index);
    for (index = brace; index < text.length; index++) {
      if (text[index] === '{') depth++;
      else if (text[index] === '}' && --depth === 0) break;
    }
    const rest = text.slice(index + 1);
    const next = rest.match(/^\s*else\b/);
    if (!next) return text.slice(from, index + 1);
    index = index + 1 + next[0].length;
  }
}

(async () => {
  const policy = await import(pathToFileURL(path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs')).href + '?690');
  const allow = policy.clientFrontDoorDeleteWithoutVersion;

  const SLUG = 'fixtureclient';
  const CARD = 'p_fixture_card';
  const calendarGraphics = Object.freeze({ origin: 'calendar', team: 'graphics', client_slug: SLUG, card_id: '' });
  const calendarBound = Object.freeze({ origin: 'calendar', team: 'graphics', client_slug: SLUG, card_id: CARD });
  const samplesUnlinked = Object.freeze({ origin: 'samples', team: 'graphics', client_slug: SLUG, card_id: '' });
  const client = Object.freeze({ kind: 'client', clientSlug: SLUG, actorKey: 'client:' + SLUG });
  const own = Object.freeze({
    id: 'pc_fixture-1', native_comment_id: 'c_fixture_note', client_slug: SLUG, deliverable_id: 'del_fixture',
    batch_id: '', team: 'graphics', component: 'graphic', audience: 'client', author_key: 'client:' + SLUG,
    origin: 'native', role: 'client', version: 3, updated_at: '2026-11-03T16:36:36.033+00:00', deleted_at: null, parent_id: null,
  });

  // --- 1. The policy ---------------------------------------------------------
  ok(allow(client, 'delete', 'calendar', calendarGraphics, own, 'c_fixture_note', CARD) === true,
    'allowed: the client deletes its own note on the calendar front door, named by the card note id');
  ok(allow(client, 'delete', 'calendar', calendarBound, own, 'c_fixture_note', CARD) === true,
    'allowed: the same on a card-bound row when the presented card is that card');
  ok(allow(client, 'delete', 'sxr', samplesUnlinked, own, 'c_fixture_note', '') === true,
    'allowed: the same on an unlinked Samples thread');
  ok(allow(client, 'edit', 'calendar', calendarGraphics, own, 'c_fixture_note', CARD) === false,
    'refused: an edit never skips the version check');
  for (const action of ['resolve', 'unresolve', 'add', '', 'remove']) {
    ok(allow(client, action, 'calendar', calendarGraphics, own, 'c_fixture_note', CARD) === false,
      'refused: action "' + action + '" never skips the version check');
  }
  ok(allow(client, 'delete', 'calendar', calendarGraphics, { ...own, author_key: 'member:fixture-smm', role: 'smm' }, 'c_fixture_note', CARD) === false,
    'refused: a staff note');
  ok(allow(client, 'delete', 'calendar', calendarGraphics, { ...own, author_key: 'client:otherfixture' }, 'c_fixture_note', CARD) === false,
    "refused: another client's note");
  ok(allow({ ...client, clientSlug: 'otherfixture', actorKey: 'client:otherfixture' }, 'delete', 'calendar', calendarGraphics, { ...own, author_key: 'client:otherfixture' }, 'c_fixture_note', CARD) === false,
    "refused: another client on this client's deliverable (wrong binding)");
  ok(allow(client, 'delete', 'calendar', calendarBound, own, 'c_fixture_note', 'p_other_card') === false
    && allow(client, 'delete', 'calendar', calendarBound, own, 'c_fixture_note', '') === false,
    'refused: a card-bound row with a different or missing card (wrong binding)');
  ok(allow(client, 'delete', 'calendar', { ...calendarGraphics, team: 'video' }, own, 'c_fixture_note', CARD) === false,
    'refused: a graphic note on a video deliverable (wrong binding)');
  ok(allow(client, 'delete', 'calendar', { ...calendarGraphics, origin: 'samples' }, own, 'c_fixture_note', CARD) === false
    && allow(client, 'delete', 'sxr', { ...samplesUnlinked, card_id: 'p_sample_card' }, own, 'c_fixture_note', 'p_sample_card') === false,
    'refused: a surface the front door does not admit (a card-bound Samples row reads the thread and keeps its check)');
  ok(allow(client, 'delete', 'production', calendarGraphics, own, 'c_fixture_note', CARD) === false,
    'refused: any surface other than calendar or sxr');
  ok(allow(client, 'delete', 'calendar', calendarGraphics, { ...own, audience: 'internal' }, 'c_fixture_note', CARD) === false,
    'refused: a note the client cannot see');
  ok(allow(client, 'delete', 'calendar', calendarGraphics, own, 'pc_fixture-1', CARD) === false,
    'refused: named by the canonical id, not the card note id');
  ok(allow(client, 'delete', 'calendar', calendarGraphics, { ...own, native_comment_id: 'pc_fixture-1' }, 'pc_fixture-1', CARD) === false,
    'refused: a row with no separate card note id');
  ok(allow(client, 'delete', 'calendar', calendarGraphics, { ...own, origin: 'linear' }, 'c_fixture_note', CARD) === false,
    'refused: a row that did not come from the page');
  for (const staff of [{ kind: 'staff', keyRole: 'smm', actorKey: 'member:fixture-smm' }, { kind: 'staff', keyRole: 'admin', actorKey: 'member:fixture-admin' }, { kind: 'test', keyRole: 'test', actorKey: 'test:fixture' }]) {
    ok(allow(staff, 'delete', 'calendar', calendarGraphics, { ...own, author_key: staff.actorKey }, 'c_fixture_note', CARD) === false,
      'refused: a ' + staff.kind + ' ' + staff.keyRole + ' delete keeps its version check');
  }
  ok(allow(null, 'delete', 'calendar', calendarGraphics, own, 'c_fixture_note', CARD) === false
    && allow(client, 'delete', 'calendar', null, own, 'c_fixture_note', CARD) === false
    && allow(client, 'delete', 'calendar', calendarGraphics, null, 'c_fixture_note', CARD) === false,
    'refused: missing principal, deliverable or note');

  // --- 2. The writer's own code, run -----------------------------------------
  const guardAndCheck = cutThrough(writer, 'const commentRef = clean(commentInput.id || commentInput.comment_id || commentInput.native_comment_id);', 'throw new GatewayError(400, "comment_cas_required");');
  const dispatch = cutChain(writer, 'if (lifecycleReplay) {');
  const fpFrom = writer.indexOf('const fingerprint = await (action === "add" ? commentAddFingerprint : intentFingerprint)({');
  const fingerprintCode = writer.slice(fpFrom, writer.indexOf('\n    });', fpFrom) + '\n    });'.length);
  ok(fpFrom > 0 && /expected_version: frontDoorDelete \? null : expectedCommentVersion/.test(fingerprintCode),
    'the fingerprint leaves the version out for a front-door delete');
  ok(/frontDoorDelete && clean\(currentRow\.deleted_at\)/.test(dispatch), 'the dispatch has the no-op branch for a note already deleted');
  class GatewayError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const context = {
    clean: policy.clean, lower: policy.lower, normalizeTeam: policy.normalizeTeam,
    clientCommentTargetAllowed: policy.clientCommentTargetAllowed,
    clientCommentFrontDoorTargetAllowed: policy.clientCommentFrontDoorTargetAllowed,
    commentLifecycleAllowed: policy.commentLifecycleAllowed,
    clientFrontDoorDeleteWithoutVersion: policy.clientFrontDoorDeleteWithoutVersion,
    GatewayError, Number, console,
    publicComment: row => ({ id: row && row.id }),
  };
  vm.createContext(context);
  vm.runInContext(`
    async function runLifecycle(env) {
      const { principal, action, surface, existing, commentInput, requestedCardId, targetClientSlug, entity, id, team, rows } = env;
      const writes = [];
      const supabase = {};
      const resolveCommentByRef = async (_db, ref) => {
        const hits = rows.filter(r => r.id === ref || r.native_comment_id === ref);
        if (hits.length === 1) return { state: 'found', row: hits[0] };
        return hits.length ? { state: 'ambiguous' } : { state: 'missing' };
      };
      const receipts = env.receipts || {};
      // As the writer's own readLifecycleReceipt: a receipt under this request's key must carry the same fingerprint.
      const readLifecycleReceipt = async (_db, key, commentId, act, fp) => {
        const r = receipts[key];
        if (!r) return null;
        if (r.comment_id !== commentId || r.action !== act || r.intent_fingerprint !== fp) throw new GatewayError(409, 'idempotency_conflict');
        return rows.find(x => x.id === commentId);
      };
      const rpc = async (_db, name, args) => {
        writes.push({ name, args });
        receipts[args.p_event.dedup] = { comment_id: args.p_comment.id, action: args.p_event.action, intent_fingerprint: args.p_event.fp };
        return { ...args.p_comment, deleted_at: 'now' };
      };
      const intentFingerprint = async (input) => JSON.stringify(input);
      const commentAddFingerprint = intentFingerprint;
      const commentRoundOrRefuse = (v) => v == null ? null : v;
      const operation = 'comment', requestId = env.requestId || 'fixture-request', legacyParity = false;
      let commentBody = '', audience = 'client', suppliedNativeId = '', nativeCommentId = '', parentId = '';
      const round = commentRoundOrRefuse(commentInput.round);
      let lifecycleRow = null;
      let expectedCommentVersion = null;
      let expectedCommentUpdatedAt = '';
      let frontDoorDelete = false;
      let result;
      ${guardAndCheck}
      commentBody = clean(lifecycleRow.body); audience = lower(lifecycleRow.audience);
      nativeCommentId = clean(lifecycleRow.native_comment_id) || clean(lifecycleRow.id); parentId = clean(lifecycleRow.parent_id);
      ${fingerprintCode}
      const currentRow = lifecycleRow;
      const comment = { id: currentRow.id };
      const dedup = 'dedup:' + requestId, productionCommentId = currentRow.id;
      const event = { dedup, action, fp: fingerprint };
      const lifecycleReplay = await readLifecycleReceipt(supabase, dedup, productionCommentId, action, fingerprint);
      ${dispatch}
      return { result, writes, frontDoorDelete, expectedCommentVersion, expectedCommentUpdatedAt, receipts };
    }
  `, context);
  const run = async (overrides) => {
    const env = {
      principal: client, action: 'delete', surface: 'calendar', existing: calendarGraphics,
      commentInput: { action: 'delete', native_comment_id: 'c_fixture_note', card_id: CARD }, requestedCardId: CARD,
      targetClientSlug: SLUG, entity: 'deliverable', id: 'del_fixture', team: 'graphics', rows: [own],
      ...overrides,
    };
    try { return { out: await context.runLifecycle(env) }; } catch (error) { if (process.env.DBG) console.error(error); return { error }; }
  };

  let r = await run({});
  ok(r.out && r.out.frontDoorDelete === true && r.out.writes.length === 1
    && r.out.writes[0].name === 'production_comment_lifecycle_write'
    && r.out.writes[0].args.p_expected_version === 3
    && r.out.writes[0].args.p_expected_updated_at === own.updated_at,
    'works: the client delete with no version is written once, checked against the row the server just read');
  {
    // A committed delete whose answer is lost: the page sends the identical request again (same request id). The
    // row has moved on (deleted, a new version), and the retry must still match its first receipt.
    const first = await run({ requestId: 'retry-request' });
    const after = { ...own, version: 4, updated_at: '2026-11-03T16:41:00.000+00:00', deleted_at: '2026-11-03T16:41:00.000+00:00' };
    const again = await run({ requestId: 'retry-request', rows: [after], receipts: first.out && first.out.receipts });
    ok(first.out && first.out.writes.length === 1 && again.out && again.out.writes.length === 0 && again.out.result && again.out.result.id === own.id,
      'works: a retry after a lost answer replays the first receipt, writes nothing and answers with the note (' + (again.error ? again.error.code : 'ok') + ')');
  }
  r = await run({ rows: [{ ...own, deleted_at: '2026-11-03T16:40:00Z' }] });
  ok(r.out && r.out.writes.length === 0 && r.out.result && r.out.result.id === own.id,
    'works: a second delete of a note already deleted writes nothing and answers with the note');
  r = await run({ rows: [{ ...own, author_key: 'member:fixture-smm', role: 'smm' }] });
  ok(r.error && r.error.code === 'comment_forbidden', 'refused, nothing written: a client deleting a staff note');
  r = await run({ rows: [{ ...own, author_key: 'client:otherfixture' }] });
  ok(r.error && r.error.code === 'comment_forbidden', "refused, nothing written: a client deleting another client's note");
  r = await run({ action: 'edit', commentInput: { action: 'edit', native_comment_id: 'c_fixture_note', card_id: CARD, body: 'Changed words' } });
  ok(r.error && r.error.code === 'comment_cas_required', 'refused, nothing written: an edit through this path still needs the version');
  r = await run({ existing: { ...calendarGraphics, client_slug: 'otherfixture' }, targetClientSlug: 'otherfixture' });
  ok(r.error && r.error.code === 'comment_forbidden', "refused, nothing written: a wrong binding (another client's deliverable)");
  r = await run({ existing: calendarBound, requestedCardId: 'p_other_card', commentInput: { action: 'delete', native_comment_id: 'c_fixture_note', card_id: 'p_other_card' } });
  ok(r.error && r.error.code === 'comment_forbidden', 'refused, nothing written: a wrong binding (another card)');
  r = await run({ commentInput: { action: 'delete', native_comment_id: 'c_unknown_note', card_id: CARD } });
  ok(r.error && r.error.code === 'comment_forbidden', 'refused, nothing written: an unknown card note id');
  r = await run({ commentInput: { action: 'delete', id: 'pc_fixture-1', card_id: CARD } });
  ok(r.error && r.error.code === 'comment_cas_required', 'refused, nothing written: named by the canonical id with no version');
  r = await run({ commentInput: { action: 'delete', native_comment_id: 'c_fixture_note', card_id: CARD, expected_version: 2, expected_updated_at: own.updated_at } });
  ok(r.error && r.error.code === 'write_conflict', 'unchanged: a delete that sends a version is checked against it (a stale one conflicts)');
  r = await run({ principal: { kind: 'staff', keyRole: 'smm', actorKey: 'member:fixture-smm' }, rows: [{ ...own, author_key: 'member:fixture-smm' }] });
  ok(r.error && r.error.code === 'comment_cas_required', 'unchanged: a staff delete with no version is refused as before');

  // --- 3. The page -----------------------------------------------------------
  const outbox = fs.readFileSync(path.join(ROOT, 'src', 'index', '140-calendar-legacy-outbox.js.part'), 'utf8');
  const calendar = fs.readFileSync(path.join(ROOT, 'src', 'index', '190-calendar-approval-comments.js.part'), 'utf8');
  const samples = fs.readFileSync(path.join(ROOT, 'src', 'index', '280-samples-cards-notes.js.part'), 'utf8');
  const helperAt = outbox.indexOf('async function _writeUiClientFrontDoorDelete(');
  const helper = helperAt >= 0 ? outbox.slice(helperAt, outbox.indexOf('\n    }\n', helperAt)) : '';
  ok(/comment: \{ action: 'delete', native_comment_id: noteId, card_id: context\.card_id \}/.test(helper)
    && !/expected_version/.test(helper),
    'page: the delete names the card note id and sends no version');
  ok(/_prodClientCommentGatewayContext\(surface, post, component\)/.test(helper) && /if \(!context\) return null;/.test(helper),
    'page: sent only where the add could have gone through the front door');
  ok(/_writeUiReportFailure\(surface, 'comment', error/.test(helper), 'page: a refusal goes to the write-refusal log');
  ok(/_writeUiClientFrontDoorDelete\('calendar', post, comp, target\)/.test(calendar)
    && /_writeUiClientFrontDoorDelete\('sxr', post, comp, target\)/.test(samples),
    'page: both the Calendar and the Samples delete call it, after the card tombstone');

  console.log('\nclient-front-door-delete: ' + passed + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(error => { console.error('FAIL  harness crashed: ' + (error && error.stack || error)); process.exit(1); });
