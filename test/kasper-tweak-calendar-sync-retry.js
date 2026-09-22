'use strict';
/*
 * Mirror bug reproduction + fix regression: Kasper's video tweak comments were
 * not reaching the Calendar row's `video_tweaks` cell (graphic worked).
 *
 * ROOT CAUSE. migrations/2026-09-18-native-calendar-status-bridge.sql projects
 * a native deliverable's status straight into calendar_posts.<comp>_status +
 * updated_at the instant the status commits -- out of band, ahead of the
 * browser's own calendar-upsert call -- but its own header says it deliberately
 * "does not recompute the card's OVERALL `status` column" (also recorded in
 * OPEN_REPAIRS 212, "Not done here"). `_kasperRequestTweakComp` pushes a native
 * status change and then, in the SAME action, calls `_calUpsertFetch` carrying
 * Kasper's comment plus the freshly recomputed overall `status`. Because the
 * bridge already bumped `updated_at` past the browser's stale `_baseAt`, and
 * `status` is in calendar-upsert's SCALAR_FIELDS conflict list while the
 * server's copy of `status` is now stale (the bridge never touches it),
 * calendar-upsert refuses the write with `{ok:false, conflict:true}` -- a
 * self-inflicted conflict, not a real concurrent edit. `_kasperPersistPostWrite`
 * threw, the native comment had already committed, so the catch in
 * `_kasperRequestTweakComp` showed "Card sync incomplete" and rolled nothing
 * back -- but the comment never reached `calendar_posts.<comp>_tweaks`, and the
 * dialog's "will retry automatically" was not true: nothing retries it.
 *
 * THE FIX. `_kasperPersistPostWrite` now retries the upsert exactly once, when
 * the response is this specific conflict AND this same call already committed
 * a native status change (`gatewayCommitted`) -- reading a fresh `updated_at`
 * via `_calReadFreshCardStamp` first so the retried write is no longer stale.
 * A genuinely concurrent edit (not our own bridge) still conflicts again on the
 * retry and is not swallowed. The dialog's wording was also corrected to stop
 * promising an automatic retry that never happens on a second failure.
 *
 * This harness extracts the REAL functions by name from index.html (built from
 * src/index/*.js.part by `npm run build:index`) so it exercises shipping code,
 * not a paraphrase.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Brace-balanced extractor, comment/string-aware (mirrors test/write-ui-repair-races.js).
function extract(name) {
  const marker = 'function ' + name + '(';
  let start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + name);
  if (source.slice(start - 6, start) === 'async ') start -= 6;
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (!quote && ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (!quote && ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unclosed ' + name);
}
function extractConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = source.match(re);
  assert(m, 'missing const ' + name);
  return m[0];
}

const REAL = [
  extractConst('CAL_STATUSES'), extractConst('CAL_PRIORITY'), extractConst('CAL_COMPONENTS'), extractConst('KASPER_PATCH_SCALARS'),
  extract('_calNormStatus'), extract('computeOverallStatus'),
  extract('_calStringifyComments'), extract('_calCommentsFor'),
  extract('_kasperPatchSnapshot'),
  extract('_writeUiGatewayError'), extract('_calReadFreshCardStamp'), extract('_calUnionCommentCell'),
  extract('_kasperPersistPostWrite'),
].join('\n\n');

const failures = [];
async function runCase(name, fn) {
  try { await fn(); console.log('ok - ' + name); }
  catch (error) { failures.push({ name, error }); console.error('not ok - ' + name + ': ' + (error && error.stack || error)); }
}

function jsonResponse(body) { return { ok: true, json: async () => body }; }

// Builds a fresh sandbox with the real extracted functions plus the minimal
// fixture-controlled seams: `_calUpsertFetch` (mocked network) and `fetch`
// (mocked, for the real `_calReadFreshCardStamp`'s REST read).
function makeSandbox({ upsertResponses, freshUpdatedAt, freshFetchOk = true, freshCells = null }) {
  const upsertCalls = [];
  const freshFetchCalls = [];
  const sandbox = {
    CAL_SUPABASE_URL: 'https://example.supabase.co',
    CAL_SUPABASE_ANON_KEY: 'anon-key',
    _writeUiPrincipalKey: () => 'staff:fixture:kasper',
    _kasperPersistCache: () => true,
    _writeUiCompleteSourceRepairRefs: async () => true,
    _writeUiRemoveCompletedRepairRefs: () => {},
    // The status-push branch must never run in this fixture: video_status and
    // graphic_status are unchanged from the patch base (see fixture below), so
    // `_kasperPersistPostWrite`'s own loop must `continue` past both components
    // without touching Linear/native status at all. Throwing here turns any
    // regression that widens that loop into a loud test failure instead of a
    // silent pass.
    _calPushStatusToLinear: () => { throw new Error('unexpected status push in this fixture'); },
    _writeUiReconcileReplayStatus: async () => { throw new Error('unexpected reconcile in this fixture'); },
    _writeUiAdoptRepairAck: () => { throw new Error('unexpected repair ack adoption in this fixture'); },
    _writeUiAdoptReplayStatus: () => '',
    _calLinearUrlFor: () => '',
    _calUpsertFetch: async (slug, payload) => {
      /* SNAPSHOT, do not keep the reference. `wire` is one object reused across
         the original attempt and the retry, and the retry mutates its comment
         cells in place -- so holding the live reference would make the first
         recorded call appear to contain whatever the SECOND one sent, and every
         before/after assertion below would pass vacuously. */
      upsertCalls.push({ slug, payload: JSON.parse(JSON.stringify(payload)) });
      const body = upsertResponses[upsertCalls.length - 1] || upsertResponses[upsertResponses.length - 1];
      return jsonResponse(body);
    },
    fetch: async (url) => {
      freshFetchCalls.push(url);
      if (!freshFetchOk) return { ok: false, json: async () => null };
      return { ok: true, json: async () => [Object.assign({ updated_at: freshUpdatedAt }, freshCells || {})] };
    },
    console,
    Object, Array, Promise, String, Number, JSON, Date, Boolean,
  };
  vm.createContext(sandbox);
  vm.runInContext(REAL, sandbox);
  return { sandbox, upsertCalls, freshFetchCalls };
}

function baseItem(comp, commentBody) {
  const staleBaseline = {
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval',
    status: 'Kasper Approval',
  };
  const post = {
    id: 'p_test_card',
    updated_at: '2026-09-22T14:00:00.000Z',
    _baseAt: '2026-09-22T14:00:00.000Z',
    video_status: 'Kasper Approval', graphic_status: 'Kasper Approval', caption_status: 'Kasper Approval',
    video_comments: [], graphic_comments: [], caption_comments: [], title_comments: [],
    video_tweaks: '', graphic_tweaks: '', caption_tweaks: '', title_tweaks: '',
  };
  // The touched component's status already sits at Tweaks Needed, matching its
  // patch-base snapshot (KASPER_PATCH_SCALARS diffs against `base`, so an
  // unchanged status never re-enters the loop's status-push branch) -- this
  // isolates the self-conflict retry from the status-push machinery, which is
  // covered elsewhere (test/write-ui-repair-races.js).
  post[comp + '_status'] = 'Tweaks Needed';
  post.status = 'Tweaks Needed';
  post[comp + '_comments'] = [{
    id: 'c_kasper_1', parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, round: 1,
    audience: 'internal', body: commentBody, created_at: '2026-09-22T14:05:00.000Z',
    updated_at: '2026-09-22T14:05:00.000Z', done: false, done_at: '', done_by: '',
  }];
  post[comp + '_tweaks'] = JSON.stringify(post[comp + '_comments']);
  const base = Object.assign({}, staleBaseline);
  base[comp + '_status'] = 'Tweaks Needed';
  // base.status stays at the STALE overall value on purpose: this is exactly
  // what makes `wire.status` differ from the server's post-bridge row and is
  // the trigger for the self-conflict this test reproduces.
  post._patchBase = base;
  return { post, slug: 'sidneylaruel' };
}

async function tweakSelfConflictRetrySucceeds(comp) {
  const commentBody = 'fix the ' + comp + ' cut at 0:12';
  const item = baseItem(comp, commentBody);
  const conflictResponse = {
    ok: false, conflict: true, id: item.post.id,
    error: 'Not saved: someone else updated this card (status) after your screen last loaded it. Refresh the calendar to see their version, then re-apply your change.',
  };
  const successResponse = { ok: true };
  const freshUpdatedAt = '2026-09-22T14:05:03.000Z'; // newer than the stale _baseAt
  const { sandbox, upsertCalls, freshFetchCalls } = makeSandbox({
    upsertResponses: [conflictResponse, successResponse],
    freshUpdatedAt,
  });

  // gatewayCommitted starts true via repairContext.precommitted, which is
  // exactly the shape `_kasperRequestTweakComp` passes when the native comment
  // already committed -- the precondition for the retry to be safe at all.
  await sandbox._kasperPersistPostWrite(item, { precommitted: true, refs: [], companions: [] });

  assert.strictEqual(upsertCalls.length, 2,
    comp + ': must retry the upsert exactly once after the self-conflict, not zero and not more');
  assert.strictEqual(freshFetchCalls.length, 1, comp + ': must read a fresh updated_at before retrying');

  const firstWire = upsertCalls[0].payload.post;
  const secondWire = upsertCalls[1].payload.post;
  assert.ok(String(firstWire[comp + '_tweaks'] || '').includes(commentBody),
    comp + ': the comment must be present on the FIRST (conflicting) attempt');
  assert.ok(String(secondWire[comp + '_tweaks'] || '').includes(commentBody),
    comp + ': the retried write must still carry Kasper\'s comment -- this is the bug: it must not be dropped on retry');
  assert.ok(upsertCalls[1].payload.comments_base_at > upsertCalls[0].payload.comments_base_at,
    comp + ': the retry must use a NEWER baseline than the original stale one, or it would conflict identically again');
  assert.strictEqual(upsertCalls[1].payload.comments_base_at, freshUpdatedAt,
    comp + ': the retry must use exactly the freshly read updated_at');
}

async function tweakWithoutNativeCommitDoesNotRetry(comp) {
  // Without a native precommit this call, a conflict is NOT presumed to be our
  // own bridge racing us -- it could be a genuinely concurrent edit -- so no
  // retry should be attempted; the original conflict must propagate untouched.
  const item = baseItem(comp, 'a comment');
  const conflictResponse = { ok: false, conflict: true, id: item.post.id, error: 'Not saved: someone else updated this card (status)...' };
  const { sandbox, upsertCalls, freshFetchCalls } = makeSandbox({
    upsertResponses: [conflictResponse],
    freshUpdatedAt: '2026-09-22T14:05:03.000Z',
  });
  await assert.rejects(
    () => sandbox._kasperPersistPostWrite(item, { precommitted: false, refs: [], companions: [] }),
    /someone else updated this card/,
    comp + ': a conflict with no native precommit must still propagate as a failure'
  );
  assert.strictEqual(upsertCalls.length, 1, comp + ': must not retry when this call made no native status commit');
  assert.strictEqual(freshFetchCalls.length, 0, comp + ': must not even read a fresh stamp when it will not retry');
}

async function genuineConcurrentConflictStillFails(comp) {
  // Both attempts conflict (a real third-party edit, not our own bridge): the
  // retry must not paper over it a second time.
  const item = baseItem(comp, 'a comment');
  const conflictResponse = { ok: false, conflict: true, id: item.post.id, error: 'Not saved: someone else updated this card (name) after your screen last loaded it.' };
  const { sandbox, upsertCalls } = makeSandbox({
    upsertResponses: [conflictResponse, conflictResponse],
    freshUpdatedAt: '2026-09-22T14:05:03.000Z',
  });
  await assert.rejects(
    () => sandbox._kasperPersistPostWrite(item, { precommitted: true, refs: [], companions: [] }),
    /someone else updated this card/,
    comp + ': a genuinely repeated conflict must still surface as a failure after the one retry'
  );
  assert.strictEqual(upsertCalls.length, 2, comp + ': exactly one retry, never an unbounded loop');
}

async function retryPreservesAConcurrentReviewersComment(comp) {
  /* THE P1 THIS TEST EXISTS FOR (Codex, PR 1493). Advancing `comments_base_at`
     to the bridge's fresh stamp is what lets the retry past the scalar guard --
     but calendar-upsert reuses that ONE field for its per-cell comment merge,
     where an existing comment missing from the incoming list survives only
     while it is NEWER than the baseline. A note another reviewer added between
     this tab's original baseline and the fresh read is therefore older than the
     new baseline, and a retry that did not carry it would have the server read
     its absence as a deliberate deletion and prune it: someone else's comment
     destroyed to save ours. The retry must union the server's current cell into
     its own payload, because an id PRESENT in the incoming list is never
     pruned. */
  const item = baseItem(comp, 'kasper note');
  const cell = comp + '_tweaks';
  const theirComment = { id: 'c_other_reviewer', body: 'a concurrent note', created_at: '2026-09-22T14:02:00.000Z', updated_at: '2026-09-22T14:02:00.000Z' };
  const freshUpdatedAt = '2026-09-22T14:05:03.000Z';
  const conflictResponse = { ok: false, conflict: true, id: item.post.id, error: 'Not saved: someone else updated this card (status)...' };
  const successResponse = { ok: true, id: item.post.id };
  const { sandbox, upsertCalls } = makeSandbox({
    upsertResponses: [conflictResponse, successResponse],
    freshUpdatedAt,
    freshCells: { [cell]: JSON.stringify([theirComment]) },
  });

  await sandbox._kasperPersistPostWrite(item, { precommitted: true, refs: [], companions: [] });

  assert.strictEqual(upsertCalls.length, 2, comp + ': the fixture must reach the retry');
  const retried = JSON.parse(String(upsertCalls[1].payload.post[cell] || '[]'));
  const ids = retried.map(c => String(c.id));
  assert.ok(ids.includes(theirComment.id),
    comp + ': the retry must carry the concurrent reviewer\'s comment, or the server prunes it as a deletion');
  assert.ok(retried.some(c => String(c.body || '').includes('kasper note')),
    comp + ': the retry must still carry Kasper\'s own comment alongside it');
  assert.strictEqual(new Set(ids).size, ids.length, comp + ': the union must not duplicate an id');
  // And the older comment must NOT have been in the first attempt -- otherwise
  // this fixture would pass without the union ever doing anything.
  const first = JSON.parse(String(upsertCalls[0].payload.post[cell] || '[]'));
  assert.ok(!first.some(c => String(c.id) === theirComment.id),
    comp + ': fixture guard -- the concurrent comment must be unknown to the first attempt');
}

(async () => {
  for (const comp of ['video', 'graphic']) {
    await runCase('self-conflict retry recovers the ' + comp + ' tweak comment', () => tweakSelfConflictRetrySucceeds(comp));
    await runCase(comp + ' conflict without a native precommit does not retry', () => tweakWithoutNativeCommitDoesNotRetry(comp));
    await runCase(comp + ' genuinely repeated conflict still fails after one retry', () => genuineConcurrentConflictStillFails(comp));
    await runCase(comp + ' retry preserves a concurrent reviewer\'s comment', () => retryPreservesAConcurrentReviewersComment(comp));
  }

  if (failures.length) {
    console.error('\n' + failures.length + ' failure(s).');
    process.exit(1);
  }
  console.log('\nAll kasper-tweak-calendar-sync-retry assertions passed.');
})();
