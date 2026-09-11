'use strict';
/*
 * The SAMPLE card half of "add the missing component".
 *
 * The calendar got this button on 2026-08-31; the samples card did not, and
 * the gap is worse there. Measured live 2026-09-07 across the 26 non-archived
 * sample cards: 2 carry both components, 3 only a video, 21 only a thumbnail,
 * 0 neither, so 24 of 26 are half a post, across 6 clients. A samples batch
 * is usually commissioned as thumbnails and then needs a video beside one.
 *
 * What this guards is the same thing its calendar twin guards, because it is
 * the same write: the button cannot appear where pressing it would create work
 * nobody can see, and cannot leave a component no card points at. The gate is
 * extracted and EXECUTED against real sample shapes rather than pattern-matched:
 * "when does this button appear" has eight interesting answers, and a regex
 * can only assert that some words are present.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// Comment- and quote-aware brace matcher, the same one the other source suites
// carry: a naive brace count walks straight off the end of any function whose
// comments contain braces or apostrophes.
function grabFunc(name) {
  const start = INDEX.indexOf(name);
  if (start < 0) throw new Error('not found: ' + name);
  let i = INDEX.indexOf('{', start);
  if (i < 0) throw new Error('no body: ' + name);
  let depth = 0, inS = '', inC = '';
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j], n = INDEX[j + 1];
    if (inC === 'line') { if (c === '\n') inC = ''; continue; }
    if (inC === 'block') { if (c === '*' && n === '/') { inC = ''; j++; } continue; }
    if (inS) {
      if (c === '\\') { j++; continue; }
      if (c === inS) inS = '';
      continue;
    }
    if (c === '/' && n === '/') { inC = 'line'; j++; continue; }
    if (c === '/' && n === '*') { inC = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { inS = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) return INDEX.slice(start, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

/* ---- 1. Executed: when does the button appear ------------------------- */

const gateSrc = grabFunc('function _sxrFillSiblingId(');
const gate = new Function(
  '_isClientLink', '_sxrIsBlankId', '_writeUiLinkSlotSealed',
  gateSrc + '; return _sxrFillSiblingId;',
);

const sealedAll = () => true;
const blankId = id => /^__sxrblank__/.test(String(id || ''));
const fill = (post, which, opts = {}) => gate(
  opts.clientView === true, blankId, opts.sealed || sealedAll)(post, which);

// The live shape of the 21: a thumbnail-only sample, no video anywhere on it.
const thumbOnly = { id: 'sr_mrfd5wbb_gzui9', graphic_deliverable_id: 'b1_d_81d7', status: 'In Progress' };
// And of the 3: a video-only sample.
const videoOnly = { id: 'p_native_525e7a66_1', video_deliverable_id: 'del_7c4a', status: 'In Progress' };

ok(fill(thumbOnly, 'video') === 'b1_d_81d7',
  'a sample with a thumbnail and no video offers to add the video, and names the thumbnail as the sibling to inherit from');
ok(fill(thumbOnly, 'graphic') === '',
  'and does not offer to add a second thumbnail');
ok(fill(videoOnly, 'graphic') === 'del_7c4a',
  'the mirror case works too: a video-only sample offers to add the thumbnail');
ok(fill(videoOnly, 'video') === '',
  'and not a second video');

/* A sample carrying NEITHER component has nothing to inherit a batch, a parent
   route, a sort position or a title from, so the write could not be built even
   if somebody pressed it. Create Post is the path for that: the samples "+"
   already routes there for an enrolled client. */
ok(fill({ id: 'sr_x' }, 'video') === '' && fill({ id: 'sr_x' }, 'graphic') === '',
  'a sample with NEITHER component offers nothing: there is nothing to inherit from');

/* A slot holding a Linear url with no native id is a legacy half-link, not a
   missing component. Filling it would leave the card naming two issues. Zero
   of the 24 live halves are in that state, and this is what keeps it so. */
ok(fill({ id: 'sr_y', graphic_deliverable_id: 'b1_d_1', linear_issue_id: 'https://linear.app/x' }, 'video') === '',
  'a slot holding a Linear url is left alone: that is a half-link to repair, not a gap to fill');

ok(fill({ id: '__sxrblank__3', graphic_deliverable_id: 'b1_d_1' }, 'video') === '',
  'a blank placeholder row offers nothing');
ok(fill(Object.assign({}, thumbOnly, { status: 'Archived' }), 'video') === '',
  'an archived sample offers nothing: archiving parks the sub-issues, and a fill landing after it mints work nothing will park');
ok(fill(thumbOnly, 'video', { clientView: true }) === '',
  'and the client never sees it: this is staff-only, like every other pile control');

/* THE ROLLBACK CASE. Under a per-team rollback the native create is refused at
   the database, so offering the button would be offering a dead one. */
ok(fill(thumbOnly, 'video', { sealed: team => team !== 'video' }) === '',
  'a team rolled back to Linear offers nothing, because the write would be refused anyway');
ok(fill(thumbOnly, 'video', { sealed: sealedAll }) === 'b1_d_81d7',
  'and is offered again once that team is SyncView-authoritative');

/* ---- 2. The retry story is the deterministic request id ---------------- */

const idSrc = grabFunc('function _sxrFillRequestId(');
const sxrRequestId = new Function(idSrc + '; return _sxrFillRequestId;')();
const calIdSrc = grabFunc('function _calFillRequestId(');
const calRequestId = new Function(calIdSrc + '; return _calFillRequestId;')();

ok(sxrRequestId('sr_mrfd5wbb_gzui9', 'video') === sxrRequestId('sr_mrfd5wbb_gzui9', 'video'),
  'the request id is stable across presses, so a retry replays instead of creating a second component');
ok(sxrRequestId('sr_mrfd5wbb_gzui9', 'video') !== sxrRequestId('sr_mrfd5wbb_gzui9', 'graphics'),
  'and differs per team, so the two halves of a sample never collide');
/* The gateway derives the deliverable id from this string. Sample cards can
   carry `p_native_...` ids just as calendar cards do, so a shared prefix would
   make one id serve two different rows in two different tables if those ids
   ever met. They are minted independently; the prefix is what guarantees it. */
ok(sxrRequestId('p_native_525e7a66_1', 'video') !== calRequestId('p_native_525e7a66_1', 'video'),
  'and never collides with a CALENDAR fill of the same card id and team');
for (const id of ['sr_mrfd5wbb_gzui9', 'p_native_525e7a6649a287f949c10491f468_1']) {
  ok(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,199}$/.test(sxrRequestId(id, 'graphics')),
    'and satisfies the gateway validRequestId contract for ' + id);
}

/* ---- 3. The card write is PARTIAL ------------------------------------- */
/* sample-review-upsert copies only the keys a payload carries. A fill must
   send the two link columns and nothing else: these cards have real media
   links, creative direction, tweaks and statuses on them, and the other
   component is somebody's work. */

const writeSrc = grabFunc('async function _sxrFillWriteCardLink(');
ok(/graphic_deliverable_id/.test(writeSrc) && /graphic_linear_issue_id/.test(writeSrc)
  && /video_deliverable_id/.test(writeSrc) && /linear_issue_id/.test(writeSrc),
  'the card write carries the two link columns for the filled team');
for (const forbidden of ['creative_direction', 'asset_url', 'thumbnail_url', 'video_status', 'graphic_status', 'video_tweaks', 'graphic_tweaks', 'order_index']) {
  ok(!new RegExp('\\b' + forbidden + '\\b').test(writeSrc),
    'and never sends ' + forbidden + ', which a fill must not disturb on a sample that already carries work');
}
ok(/_sxrUpsertFetch\(clientSlug, \{ client: clientSlug, sample, comments_base_at/.test(writeSrc)
  && !/_calUpsertFetch/.test(writeSrc),
  'and it writes through the SAMPLES upsert, in the samples payload shape, not the calendar one');
/* A save already in flight was built before this write and echoes the link
   columns as they were, empty. Landing it afterwards would put the card
   straight back to unlinked. */
ok(/_sxrSaveInFlight\[pid\]/.test(writeSrc),
  'it waits for any in-flight save on this card, so a stale echo cannot undo the link it just wrote');
/* The full server echo would carry columns this write never sent, including
   ones the person may have edited since. Only what was written is applied. */
ok(!/json\.sample/.test(writeSrc),
  'and applies only the columns it wrote, never the whole echo over a card someone may be editing');

/* ---- 3f. EXECUTED: a parked edit survives and comes back ----------------
 *
 * Fourth-pass review, and it was right about the third pass's own fix:
 * deleting the bucket traded a wrong-client write for silent data loss, and
 * the person could not know, because `onSxrClientChange` had already tried to
 * flush that edit and its flush was sitting behind this very lock. The bucket
 * was its only copy. So it is parked against the slug and card it was typed
 * on, and handed back to the engine the next time that client loads. */

const parkSrc = grabFunc('function _sxrParkEditsForClient(');
const restoreSrc = grabFunc('function _sxrRestoreParkedEdits(');

function parkHarness(posts) {
  const seen = { diagnostics: [], notified: [], flushed: [] };
  const pending = Object.create(null);
  const state = { client: 'testclient', posts: posts || [], principal: 'staff:1:admin' };
  const made = new Function(
    '_sxrPendingEdits', '_writeUiQueueDiagnostic', 'showNotify', 'sxrClientSlug', 'sxrState',
    '_sxrFlushCardSave', '_writeUiPrincipalKey',
    'const _sxrParkedEdits = Object.create(null); const SXR_PARKED_EDIT_MAX_CARDS = 50;'
    + parkSrc + restoreSrc
    + '; return { park: _sxrParkEditsForClient, restore: _sxrRestoreParkedEdits, parked: _sxrParkedEdits };',
  )(
    pending,
    (surface, outcome) => { seen.diagnostics.push({ surface, outcome }); },
    (title, message) => { seen.notified.push({ title, message }); },
    () => state.client,
    state,
    pid => { seen.flushed.push({ pid, edits: Object.assign({}, pending[pid]) }); },
    () => state.principal,
  );
  return { seen, pending, state, ...made };
}

function parkChecks() {
  /* The round trip: typed on one client, parked when the view leaves, handed
     back when that client is loaded again. */
  const h = parkHarness([{ id: 'sr_1' }]);
  h.pending.sr_1 = { name: 'typed before the switch' };
  h.state.client = 'testclient';
  h.park('testclient', 'sr_1');
  ok(h.pending.sr_1 === undefined,
    'the bucket leaves the pending map, so nothing can flush it under another client');
  ok(h.parked.testclient && h.parked.testclient.sr_1.edits.name === 'typed before the switch',
    'and it is held against the client and card it was typed on, with the edit intact');
  ok(h.parked.testclient.sr_1.principal === 'staff:1:admin',
    'and with the principal who typed it, because a restored bucket is flushed under whoever is signed in later');
  ok(h.seen.notified.some(n => /not saved yet/i.test(n.title)),
    'and the person is told, because an edit that is held but unsaved is still not saved');
  ok(h.seen.notified.some(n => /reload/i.test(n.message)),
    'and told accurately: the bucket lives in this tab only, so the message never promises it survives a refresh');
  ok(h.seen.diagnostics.some(row => row.outcome === 'queued_edit_parked_off_client'),
    'and it is recorded for diagnostics');

  h.state.client = 'anotherclient';
  ok(h.restore('testclient') === 0 && h.seen.flushed.length === 0,
    'restoring is refused while the view is on a different client, which is the whole point of parking it');

  h.state.client = 'testclient';
  ok(h.restore('testclient') === 1,
    'and it is restored once that client is loaded again');
  ok(h.seen.flushed.length === 1 && h.seen.flushed[0].pid === 'sr_1'
    && h.seen.flushed[0].edits.name === 'typed before the switch',
    'through the normal engine flush, with the edit it was holding, so the status machinery and Linear pushes run as they would have');
  ok(h.parked.testclient === undefined,
    'and the parking slot is emptied rather than left to be replayed twice');

  /* A DIFFERENT ACCOUNT MUST NOT SEND IT. Staff identity is shared through
     localStorage, and a restored bucket is flushed with whoever is signed in
     then, so a parked status edit would reach the native gateway attributed to
     somebody who never made it. */
  const swappedPark = parkHarness([{ id: 'sr_4' }]);
  swappedPark.pending.sr_4 = { video_status: 'Approved' };
  swappedPark.park('testclient', 'sr_4');
  swappedPark.state.principal = 'staff:2:smm';
  ok(swappedPark.restore('testclient') === 0 && swappedPark.seen.flushed.length === 0,
    'a parked edit is not restored under a different signed-in account, so no one is recorded sending an edit they never made');
  ok(swappedPark.seen.diagnostics.some(row => row.outcome === 'parked_edit_principal_changed')
    && swappedPark.seen.notified.some(n => /discarded/i.test(n.title)),
    'and that discard is recorded and said out loud rather than being silent');

  /* NEWER INPUT WINS. Returning to a client paints from cache first, so someone
     can be typing in this card while the background load that triggers the
     restore is still in flight. */
  const newer = parkHarness([{ id: 'sr_5' }]);
  newer.pending.sr_5 = { name: 'older, typed before the switch', asset_url: 'https://old' };
  newer.park('testclient', 'sr_5');
  newer.pending.sr_5 = { name: 'newer, typed after coming back' };
  ok(newer.restore('testclient') === 1,
    'a parked edit merges with what is already queued rather than replacing it');
  ok(newer.seen.flushed[0].edits.name === 'newer, typed after coming back',
    'and the NEWER value wins on a field they both carry, so a restore cannot silently revert what was just typed');
  ok(newer.seen.flushed[0].edits.asset_url === 'https://old',
    'while a field only the parked bucket carries is still restored');

  /* A card the load did not return must NOT be re-queued: the engine would
     insert it as a new row, which is the defect parking exists to avoid. */
  const gone = parkHarness([]);
  gone.pending.sr_2 = { name: 'card was archived meanwhile' };
  gone.park('testclient', 'sr_2');
  ok(gone.restore('testclient') === 0 && gone.seen.flushed.length === 0,
    'a card the reload no longer returns is dropped rather than restored, because re-queuing it would insert it as a new sample');
  ok(gone.seen.diagnostics.some(row => row.outcome === 'parked_edit_card_gone'),
    'and that drop is recorded too');
  /* RECORDED IS NOT TOLD. This is the branch the person WAITED for: the park
     notice promised "open that client again and it will save", they did, and
     the card their edit belongs to is not in what came back. Refusing to
     restore is correct -- re-queuing inserts it as a new sample -- but a
     diagnostic row is read by whoever goes looking, and nobody goes looking for
     an edit they believe was saved. */
  ok(gone.seen.notified.some(n => /discarded/i.test(n.title)),
    'and the person who typed it is TOLD, not merely recorded: an edit dropped after being promised a save is silent data loss');
  ok(gone.seen.notified.some(n => /no longer in this client/i.test(n.message)
    && /nothing was written/i.test(n.message)),
    'and told why and what it means, so the message is actionable rather than an apology');
  ok(gone.seen.notified.every(n => !/will save|try again/i.test(n.message))
    || gone.seen.notified.filter(n => /discarded/i.test(n.title))
      .every(n => !/will save|try again/i.test(n.message)),
    'and never promises a recovery that does not exist: this edit is gone, not deferred');

  /* Bounded: this is a repair, not a queue. */
  const many = parkHarness([]);
  for (let i = 0; i < 55; i++) { many.pending['sr_' + i] = { name: 'x' + i }; many.park('testclient', 'sr_' + i); }
  ok(Object.keys(many.parked.testclient).length === 50,
    'parking is capped, so a tab left open for a week cannot grow it without limit');
  ok(many.seen.diagnostics.some(row => row.outcome === 'parked_edit_capacity_dropped'),
    'and hitting the cap is recorded rather than silent');
  /* The cap DESTROYS an edit. `_sxrParkEditsForClient` takes the bucket out of
     `_sxrPendingEdits` before it reaches this branch, so a refusal to park is
     not a deferral -- it is the data loss the whole parking mechanism was
     written to prevent, arriving through the mechanism itself. */
  ok(many.pending['sr_54'] === undefined && many.parked.testclient.sr_54 === undefined,
    'the 51st card is neither queued nor parked, so the cap really does destroy it');
  ok(many.seen.notified.some(n => /not saved/i.test(n.title) && /cannot be brought back/i.test(n.message)),
    'so the person is told it is gone, in those words, rather than left believing the park notice applied to theirs');
  ok(many.seen.notified.filter(n => /cannot be brought back/i.test(n.message))
    .every(n => n.message.includes('testclient')),
    'and told which client the held edits belong to, which is the only action left to them');

  /* An empty bucket is not worth a notification. */
  const empty = parkHarness([{ id: 'sr_3' }]);
  empty.pending.sr_3 = {};
  empty.park('testclient', 'sr_3');
  ok(empty.seen.notified.length === 0 && empty.parked.testclient === undefined,
    'and an empty bucket parks nothing and says nothing');
}

/* ---- 3c. EXECUTED: the fill cannot follow the view to another client ----
 *
 * Second-pass review findings, all three about what happens when the Samples
 * view moves while a fill is mid-flight. Executed, because "which client does
 * this write land on" is a question about ordering and state, and the previous
 * round proved that source-matching answers it wrongly. */

const stillCurrentSrc = grabFunc('function _sxrFillStillCurrent(');
const stillCurrent = new Function(
  'sxrClientSlug', 'sxrState', '_isClientLink', '_sxrIsBlankId', '_writeUiLinkSlotSealed',
  gateSrc + stillCurrentSrc + '; return _sxrFillStillCurrent;',
);
const currentFor = (slug, posts) => stillCurrent(
  () => slug, { client: slug, posts }, false, blankId, sealedAll);

ok(currentFor('testclient', [thumbOnly])('sr_mrfd5wbb_gzui9', 'video', 'testclient', 'b1_d_81d7') === true,
  'the card that was on screen when the button was pressed is still the one the write may go to');
ok(currentFor('anotherclient', [thumbOnly])('sr_mrfd5wbb_gzui9', 'video', 'testclient', 'b1_d_81d7') === false,
  'a client switch during the identity or authority read stops the fill, so a dialog opened over one client cannot mint work for another');
ok(currentFor('testclient', [])('sr_mrfd5wbb_gzui9', 'video', 'testclient', 'b1_d_81d7') === false,
  'and a card that is no longer in the loaded set stops it too');
ok(currentFor('testclient', [Object.assign({}, thumbOnly, { video_deliverable_id: 'del_peer' })])(
  'sr_mrfd5wbb_gzui9', 'video', 'testclient', 'b1_d_81d7') === false,
  'and a peer who filled the same slot first stops it, because the sibling no longer answers');

const handlerSrcNow = grabFunc('async function _sxrFillComponent(');
ok((handlerSrcNow.match(/_sxrFillStillCurrent\(/g) || []).length >= 2,
  'the handler re-asks that question twice: after the awaits, and again inside the confirm callback, because the dialog is itself a wait');
ok(/showConfirm\([\s\S]*?_sxrFillStillCurrent\(/.test(handlerSrcNow),
  'specifically inside the callback, so a tab switch with the dialog open cannot be confirmed into the wrong client');
ok(/on ' \+ clientSlug \+ '/.test(handlerSrcNow) && /cardName/.test(handlerSrcNow),
  'and the dialog names the client and the card it will act on, rather than saying only "this sample"');

/* ---- 3b. EXECUTED: the write holds the per-card save queue -------------
 *
 * Codex P1 on #1342, and it was right. Awaiting the in-flight save once is not
 * enough: that save's `finally` starts a REPLACEMENT `_sxrSaveInFlight[pid]`
 * for any edit queued while it drained, so the continuation resumed beside a
 * save it had never waited for. A field-level patch carries no link column and
 * is harmless, but the whole-card branch (a new row, or `_sxrRetrySave`
 * re-sending the current row) sends all four link columns from local state,
 * and a copy built before the fill carries them EMPTY.
 *
 * These run the real function against stubs rather than grepping it, because
 * "does a later save see the link" is a question about ordering and a regex
 * cannot answer it. */

const writeFn = new Function(
  '_sxrAwaitCardSave', '_sxrSaveInFlight', '_sxrUpsertFetch', 'sxrClientSlug', 'sxrState',
  '_sxrCacheWrite', '_sxrRenderBody', '_sxrIsBusy', '_sxrSchedulePendingRender',
  '_sxrPendingBackgroundRender', '_sxrPendingEdits', '_sxrFlushCardSave', '_sxrLastLocalWriteAt',
  '_writeUiQueueDiagnostic', '_sxrParkEditsForClient',
  writeSrc + '; return _sxrFillWriteCardLink;',
);

function harness(options = {}) {
  const state = {
    saveInFlight: Object.create(null),
    pendingEdits: options.pendingEdits || Object.create(null),
    posts: options.posts || [{ id: 'sr_1', name: 'Sample 1', graphic_deliverable_id: 'b1_d_1' }],
    slug: 'testclient',
    awaited: 0, cached: [], rendered: 0, flushed: [], sent: null, diagnostics: [], parked: [],
  };
  const awaitCardSave = async pid => {
    state.awaited += 1;
    for (;;) {
      const active = state.saveInFlight[pid];
      if (active) { await active; continue; }
      return;
    }
  };
  const fn = writeFn(
    awaitCardSave,
    state.saveInFlight,
    async (slug, payload) => {
      state.sent = { slug, payload };
      if (options.duringWrite) await options.duringWrite(state);
      return { ok: options.httpOk !== false, json: async () => ({ ok: options.bodyOk !== false }) };
    },
    () => state.slug,
    { get client() { return state.slug; }, get posts() { return state.posts; } },
    (slug, posts) => { state.cached.push({ slug, count: posts.length }); return true; },
    () => { state.rendered += 1; },
    () => false,
    () => {},
    false,
    state.pendingEdits,
    pid => { state.flushed.push(pid); },
    0,
    (surface, outcome) => { state.diagnostics.push({ surface, outcome }); },
    (slug, pid) => { state.parked.push({ slug, pid, edits: state.pendingEdits[pid] }); delete state.pendingEdits[pid]; },
  );
  return { state, fn };
}

async function orderingChecks() {
  /* THE ORDERING CASE. A flush that starts while the link write is in flight
     must see the link, not the emptiness that preceded it. The stub flush uses
     the save engine's own guard: `if (_sxrSaveInFlight[pid]) return
     _sxrAwaitCardSave(pid)`. */
  let followOnSnapshot = null;
  let followOn = null;
  const ordered = harness({
    duringWrite: state => {
      /* STARTED, NOT AWAITED. The flush runs BESIDE the link write, which is
         the whole scenario; awaiting it here would deadlock the stub on the
         very lock under test and, before this was fixed, made the suite exit
         silently with none of these checks run. */
      followOn = (async () => {
        if (state.saveInFlight.sr_1) await state.saveInFlight.sr_1;
        followOnSnapshot = Object.assign({}, state.posts[0]);
      })();
    },
  });
  await ordered.fn('testclient', 'sr_1', 'video', 'del_new', 'https://linear.app/x/VID-1');
  await followOn;
  ok(followOnSnapshot && followOnSnapshot.video_deliverable_id === 'del_new'
    && followOnSnapshot.linear_issue_id === 'https://linear.app/x/VID-1',
    'a save that starts DURING the link write waits for it and then reads the link, so its whole-card copy cannot detach the new component');
  ok(ordered.state.awaited >= 1,
    'and the queue was drained before the write as well, not only after it');
  ok(ordered.state.saveInFlight.sr_1 === undefined,
    'the per-card lock is released when the write finishes');
  ok(ordered.state.cached.length === 1 && ordered.state.cached[0].slug === 'testclient',
    'the card is cached once, under the client it belongs to');
  ok(ordered.state.rendered === 1, 'and the strip repaints once');

  /* THE LOCK MUST NOT SURVIVE A FAILURE. A stranded `_sxrSaveInFlight[pid]`
     would make every later edit on this card wait on a promise nobody
     resolves, which is worse than the write failing. */
  const failed = harness({ bodyOk: false, pendingEdits: { sr_1: { name: 'x' } } });
  let threw = false;
  try { await failed.fn('testclient', 'sr_1', 'video', 'del_new', ''); }
  catch (error) { threw = /sample_card_write_failed/.test(String(error && error.message)); }
  ok(threw, 'a refused card write throws, so the caller can say the component exists but the card is not linked yet');
  ok(failed.state.saveInFlight.sr_1 === undefined,
    'and the per-card lock is released even then, so the card is never stranded');
  ok(failed.state.flushed.includes('sr_1'),
    'and an edit queued while the lock was held is flushed on release rather than left sitting');

  /* THE DEPARTED-CLIENT CASE. Codex P2: staff switch Samples tabs while the
     request is in flight, so `sxrState.posts` holds the NEW client's rows while
     the write still names the old one. Caching that array under the old slug
     leaves one client's samples stored as another's. */
  const switched = harness({
    duringWrite: async state => {
      state.slug = 'anotherclient';
      state.posts = [{ id: 'sr_other', name: 'Someone else' }];
    },
  });
  await switched.fn('testclient', 'sr_1', 'video', 'del_new', '');
  ok(switched.state.sent && switched.state.sent.slug === 'testclient',
    'the server write still goes out for the client it was started for, because it is correct and already earned');
  ok(switched.state.cached.length === 0,
    'but the departed client cache is NOT overwritten with the newly selected client rows');
  ok(switched.state.rendered === 0,
    'and the newly selected view is not repainted by a write that belongs to the one before it');
  ok(switched.state.saveInFlight.sr_1 === undefined,
    'and the lock is still released');

  /* A QUEUED EDIT MUST NOT FOLLOW THE VIEW. `_sxrFlushCardSave` derives its
     slug and its row from `sxrState` at flush time and INSERTS a card it
     cannot find, and `sample_reviews` is keyed by (client, id) -- so a flush
     released after a client switch writes one client's edit as a brand-new
     sample under another. Dropping the bucket is also what stops the
     `_sxrAwaitCardSave` that `onSxrClientChange` deferred behind this very
     lock: it re-reads `_sxrPendingEdits[pid]`, finds nothing, and returns. */
  const switchedWithEdit = harness({
    pendingEdits: { sr_1: { name: 'typed before the switch' } },
    duringWrite: async state => {
      state.slug = 'anotherclient';
      state.posts = [];
    },
  });
  await switchedWithEdit.fn('testclient', 'sr_1', 'video', 'del_new', '');
  ok(switchedWithEdit.state.flushed.length === 0,
    'an edit queued during the fill is NOT flushed once the view has moved to another client');
  ok(switchedWithEdit.state.pendingEdits.sr_1 === undefined,
    'and its bucket leaves the pending map, so the deferred flush that onSxrClientChange started finds nothing to write under the wrong client');
  ok(switchedWithEdit.state.parked.length === 1
    && switchedWithEdit.state.parked[0].slug === 'testclient'
    && switchedWithEdit.state.parked[0].pid === 'sr_1',
    'and it is PARKED against the client and card it was typed on rather than deleted, so the change is not traded away for the wrong-client write');

  const stayedWithEdit = harness({ pendingEdits: { sr_1: { name: 'typed during the fill' } } });
  await stayedWithEdit.fn('testclient', 'sr_1', 'video', 'del_new', '');
  ok(stayedWithEdit.state.flushed.includes('sr_1'),
    'while on the same client it is flushed as before, so a normal edit made during a fill is never lost');
}

/* ---- 4. It asks the gateway for a samples fill, and cannot create a card */

const submitSrc = grabFunc('async function _sxrFillComponentSubmit(');
ok(/operation: 'component_fill'/.test(submitSrc) && /surface: 'sxr'/.test(submitSrc),
  'it asks for component_fill on the sxr surface, which the gateway has admitted since the operation shipped');
ok(/card_id: pid/.test(submitSrc) && /sibling_id: siblingId/.test(submitSrc),
  'and always names the card and the sibling, which the gateway and RPC both re-check');
ok(!/_calOpenNativePost|intake_create|addSxrBlankCard/.test(submitSrc),
  'and never falls back to creating a sample: a fill completes a card, it does not make one');

/* THE REPAIR ARM, shared with the calendar down to the lookup: both codes mean
   the component exists and the card is the stale half. */
ok(/component_fill_team_occupied[\s\S]{0,80}idempotency_conflict/.test(submitSrc),
  'an already-filled component repairs the card link instead of just reporting the refusal');
ok(/_calFillLookupExisting/.test(submitSrc),
  'by looking up the component the card should have been pointing at, with the same deliverables read the calendar uses rather than a second copy of it');
ok(/_sxrFillWriteCardLink/.test(submitSrc) && !/_calFillWriteCardLink/.test(submitSrc),
  'and repairs it through the SAMPLES card write, never the calendar one');

/* The RPC picks the card table from the BATCH purpose, so a sample whose batch
   is recorded purpose='calendar' is looked for among the calendar cards and not
   found. 3 of the 24 live half-complete samples are in exactly that state
   (2026-09-07, one batch minted by the F42 adoption path, children carrying
   origin='samples'). The shared failure handler answers that code by evicting
   the display caches and advising a reload, which is true on the calendar and
   false here,
   and the reader would spend the afternoon on it. */
ok(/component_fill_card_missing/.test(submitSrc)
  && /_writeUiQueueDiagnostic\('sxr'/.test(submitSrc),
  'a card the RPC looked for in the wrong table is answered with what is actually true, and still recorded for diagnostics');
ok(submitSrc.indexOf('component_fill_card_missing') < submitSrc.indexOf("_writeUiReportFailure('sxr', 'component_fill', failure)"),
  'and that answer runs BEFORE the shared handler, so no display cache is swept and no reload is advised');


/* ---- 3d. EXECUTED: a live fill answers before Linear exists -------------
 *
 * Codex P2, second pass. On a non-TEST fill `production-write` schedules the
 * outbound drain and answers `mirror_pending: true` BEFORE the issue exists,
 * so the card is written with the deliverable id and an EMPTY Linear url. That
 * is enough to retire the fill button, so nothing on the card asks for the link
 * any more and it would sit empty until an unrelated reload happened to run the
 * adopter. Executed through the real submit function, because the branch that
 * matters is chosen from a response shape. */

const submitFn = new Function(
  '_sxrFillRequestId', 'fetch', '_syncviewEfHeaders', 'CAL_SUPABASE_ANON_KEY', 'PROD_WRITE_EF_URL',
  '_calFillLookupExisting', '_sxrFillWriteCardLink', 'showNotify', '_writeUiReportFailure',
  '_writeUiQueueDiagnostic', '_sxrAdoptLinksAfterCreate',
  submitSrc + '; return _sxrFillComponentSubmit;',
);

function submitHarness(body, options = {}) {
  const seen = { adopted: [], linked: [], notified: [], reported: [], diagnostics: [], lookups: 0 };
  const fn = submitFn(
    (pid, team) => 'sfill:' + team + ':' + pid,
    async () => ({ ok: options.httpOk !== false, json: async () => body }),
    headers => headers,
    'key', 'https://example.invalid/production-write',
    async () => { seen.lookups += 1; return options.existing || null; },
    async (slug, pid, team, id, url) => { seen.linked.push({ slug, pid, team, id, url }); },
    (title, message) => { seen.notified.push({ title, message }); },
    (surface, operation, error) => { seen.reported.push({ surface, operation, code: error && error.code }); },
    (surface, outcome) => { seen.diagnostics.push({ surface, outcome }); },
    slug => { seen.adopted.push(slug); },
  );
  return { seen, fn };
}

async function mirrorChecks() {
  const draining = submitHarness({
    ok: true, native_committed: true, mirror_pending: true,
    item: { id: 'del_new', linear_issue_url: '' },
  });
  await draining.fn('sr_1', 'video', 'video', 'video', 'b1_d_1', 'testclient');
  ok(draining.seen.linked.length === 1 && draining.seen.linked[0].id === 'del_new',
    'a live fill links the card to the deliverable the gateway made, before the mirror has drained');
  ok(draining.seen.adopted.length === 1 && draining.seen.adopted[0] === 'testclient',
    'and starts the link adopter, so the Linear url arrives on its own instead of waiting for an unrelated reload');
  ok(/mirror is still draining/.test(draining.seen.notified.map(n => n.message).join(' ')),
    'and says so, rather than reporting a link that is not there yet');

  const drained = submitHarness({
    ok: true, native_committed: true,
    item: { id: 'del_new', linear_issue_url: 'https://linear.app/x/VID-9' },
  });
  await drained.fn('sr_1', 'video', 'video', 'video', 'b1_d_1', 'testclient');
  ok(drained.seen.adopted.length === 0,
    'a response that already carries the url starts no poll, because there is nothing left to adopt');

  /* The repair arm links the row somebody else made, which may itself still be
     draining, so it needs the same treatment. */
  const repaired = submitHarness(
    { ok: false, error: 'component_fill_team_occupied' },
    { httpOk: false, existing: { id: 'del_peer', linear_issue_url: '' } });
  await repaired.fn('sr_1', 'video', 'video', 'video', 'b1_d_1', 'testclient');
  ok(repaired.seen.lookups === 1 && repaired.seen.linked.length === 1 && repaired.seen.linked[0].id === 'del_peer',
    'an occupied slot is repaired by linking the component that already exists');
  ok(repaired.seen.adopted.length === 1,
    'and that row gets the adopter too, because a peer fill can be mid-drain as easily as this one');

  /* The drifted-batch refusal, executed rather than pattern-matched: it must be
     answered here and never handed to the shared reload-and-evict handler. */
  const missing = submitHarness(
    { ok: false, error: 'component_fill_card_missing' }, { httpOk: false });
  await missing.fn('sr_1', 'video', 'video', 'video', 'b1_d_1', 'testclient');
  ok(missing.seen.reported.length === 0,
    'a card the RPC looked for in the wrong table never reaches the shared handler, so no display cache is swept');
  ok(missing.seen.diagnostics.some(row => row.surface === 'sxr'),
    'it is recorded for diagnostics all the same');
  ok(/recorded as a calendar batch/.test(missing.seen.notified.map(n => n.message).join(' ')),
    'and the person is told what is actually true, not to reload');
  ok(missing.seen.linked.length === 0,
    'and nothing is written to the card, because nothing was created');
}


/* ---- 3e. EXECUTED: the dialog is a wait, and three things move under it -
 *
 * Third-pass review. The confirmation can sit open indefinitely, and in that
 * time the signed-in account can change (staff identity is shared through
 * localStorage and synced across tabs), team authority can be rolled back, and
 * the client can be switched. `_syncviewEfHeaders` reads the identity at
 * REQUEST time, so the person who pressed Confirm is the one recorded as
 * creating the work -- the captured one was never used. Executed by running the
 * real handler and firing the captured callback afterwards. */

const fillHandlerSrc = grabFunc('async function _sxrFillComponent(');

function confirmHarness(options = {}) {
  const seen = {
    confirmed: null, notified: [], submitted: [], authorityReads: 0, identityReads: 0,
  };
  let principal = options.principal || 'staff:1:admin';
  let sealed = { sealed: true, reason: 'syncview_authoritative' };
  let sealedHook = null;
  const state = { client: options.slug || 'testclient', posts: [thumbOnly] };
  const fn = new Function(
    '_isClientLink', '_sxrIsBlankId', '_writeUiLinkSlotSealed', 'sxrClientSlug', 'sxrState',
    'showNotify', 'showConfirm', '_syncviewRequireStaffIdentity', '_writeUiLinkSlotSealedLive',
    '_writeUiLinkSlotSealedNotice', '_writeUiPrincipalKey', '_sxrFillComponentSubmit', '_sxrEscAttr',
    gateSrc + grabFunc('function _sxrFillStillCurrent(') + fillHandlerSrc + '; return _sxrFillComponent;',
  )(
    false, blankId, sealedAll,
    () => state.client, state,
    (title, message) => { seen.notified.push({ title, message }); },
    (title, message, onYes) => { seen.confirmed = { title, message, onYes }; },
    async () => { seen.identityReads += 1; if (options.identityThrows) throw new Error('Admin or SMM sign-in required.'); return {}; },
    async () => { seen.authorityReads += 1; if (sealedHook) sealedHook(); return sealed; },
    () => ['Video links are set automatically now', 'nope'],
    () => principal,
    (...args) => { seen.submitted.push(args); },
  );
  return {
    seen, fn,
    setPrincipal: value => { principal = value; },
    setSealed: value => { sealed = value; },
    setSealedHook: fn => { sealedHook = fn; },
    setClient: value => { state.client = value; },
    setPosts: value => { state.posts = value; },
  };
}

async function confirmChecks() {
  /* The ordinary path still works end to end. */
  const happy = confirmHarness();
  await happy.fn('sr_mrfd5wbb_gzui9', 'video');
  ok(!!happy.seen.confirmed, 'the button opens a confirmation before anything is created');
  ok(/on testclient/.test(happy.seen.confirmed.message),
    'and the confirmation names the client it will act on, so it cannot be read as being about whatever is on screen now');
  await happy.seen.confirmed.onYes();
  ok(happy.seen.submitted.length === 1,
    'confirming it submits the fill');
  ok(happy.seen.submitted[0].length === 6,
    'and the submitter no longer takes an identity argument it never read');
  ok(happy.seen.authorityReads === 2 && happy.seen.identityReads === 2,
    'authority and identity are read again INSIDE the callback, not trusted from before the dialog opened');

  /* A rollback during the wait. The gateway would refuse this, but the UI is
     the one holding the current-authority boundary, and an avoidable failed
     action is still a failed action. */
  const rolledBack = confirmHarness();
  await rolledBack.fn('sr_mrfd5wbb_gzui9', 'video');
  rolledBack.setSealed({ sealed: false, reason: 'linear_authoritative' });
  await rolledBack.seen.confirmed.onYes();
  ok(rolledBack.seen.submitted.length === 0,
    'a team rolled back to Linear while the dialog was open stops the write in the browser, rather than sending one the gateway has to refuse');

  /* A different account signed in while the dialog waited. The captured
     identity was never used by the submitter, and the headers are built at
     request time, so without this the wrong person is recorded as the author
     of real Production and Linear work. */
  const swapped = confirmHarness();
  await swapped.fn('sr_mrfd5wbb_gzui9', 'video');
  swapped.setPrincipal('staff:2:smm');
  await swapped.seen.confirmed.onYes();
  ok(swapped.seen.submitted.length === 0,
    'a confirmation is bound to the account that opened it, so a sign-in change in another tab cannot record the work against the wrong person');
  ok(swapped.seen.notified.some(n => /signed-in account changed/i.test(n.title)),
    'and the person is told why, and to press it again as themselves');

  /* THE SWAP CAN ALSO LAND DURING THE AUTHORITY READ, which is a network round
     trip like the two before it. The rule is that the LAST thing before the
     write is a re-check, not that there is a re-check somewhere. */
  const swappedLate = confirmHarness();
  await swappedLate.fn('sr_mrfd5wbb_gzui9', 'video');
  swappedLate.setSealedHook(() => swappedLate.setPrincipal('staff:3:admin'));
  await swappedLate.seen.confirmed.onYes();
  ok(swappedLate.seen.submitted.length === 0,
    'an account change that arrives DURING the authority read is caught too, because the principal is compared again after it');

  /* Verification can lapse rather than change. */
  const lapsed = confirmHarness();
  await lapsed.fn('sr_mrfd5wbb_gzui9', 'video');
  lapsed.setPrincipal('');
  await lapsed.seen.confirmed.onYes();
  ok(lapsed.seen.submitted.length === 0,
    'and an identity that has lapsed to nothing is refused rather than treated as a match');

  /* The client can still move under the dialog. */
  const moved = confirmHarness();
  await moved.fn('sr_mrfd5wbb_gzui9', 'video');
  moved.setClient('anotherclient');
  await moved.seen.confirmed.onYes();
  ok(moved.seen.submitted.length === 0,
    'and the client switch check still runs first, before either round trip');

  /* A peer who filled the slot while the dialog sat open. */
  const raced = confirmHarness();
  await raced.fn('sr_mrfd5wbb_gzui9', 'video');
  raced.setPosts([Object.assign({}, thumbOnly, { video_deliverable_id: 'del_peer' })]);
  await raced.seen.confirmed.onYes();
  ok(raced.seen.submitted.length === 0,
    'and a peer who filled the same slot first stops it too');
}

/* ---- 5. Live authority, not the render-time guess ---------------------- */

const handlerSrc = grabFunc('async function _sxrFillComponent(');
ok(/_writeUiLinkSlotSealedLive\(target\)/.test(handlerSrc),
  'the authority flag is re-read live before the write, not trusted from when the button was drawn');
ok(/_sxrFillSiblingId\(post, target\)/.test(handlerSrc),
  'and the whole gate is re-evaluated against current state, so a stale tab sends nothing');
ok(/showConfirm\(/.test(handlerSrc),
  'and it confirms first, because this creates real work in Production and Linear');
ok(/_syncviewRequireStaffIdentity\('intake'\)/.test(handlerSrc),
  'and it requires the same staff identity the calendar fill and every intake require');

/* ---- 6. The button is actually rendered, in the pile ------------------- */
/* The gate can be perfect and the feature still absent. This is the wiring. */

const pileSrc = grabFunc('function _sxrLinearPileHtml(');
ok(/_sxrFillComponentSlotHtml\(p, 'video'\)/.test(pileSrc)
  && /_sxrFillComponentSlotHtml\(p, 'graphic'\)/.test(pileSrc),
  'both fill buttons are built by the samples Linear pile');
ok(/\$\{v\}\$\{pv\}\$\{fv\}\$\{g\}\$\{pg\}\$\{fg\}/.test(pileSrc),
  'and each sits where its missing component would have been, so a half-complete sample reads as one pile with a gap to close');
ok(/if \(!v && !g && !pv && !pg && !fv && !fg\) return '';/.test(pileSrc),
  'and a pile that holds nothing but a fill button still renders, because the empty-pile shortcut counts them');

const slotSrc = grabFunc('function _sxrFillComponentSlotHtml(');
const escAttr = v => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const slot = new Function(
  '_isClientLink', '_sxrIsBlankId', '_writeUiLinkSlotSealed', '_sxrEscAttr',
  gateSrc + slotSrc + '; return _sxrFillComponentSlotHtml;',
)(false, blankId, sealedAll, escAttr);

const rendered = slot(thumbOnly, 'video');
ok(/cal-fill-btn/.test(rendered),
  'the button reuses the shared fill-button styling rather than inventing a second look');
ok(/aria-label="Add the missing video to this sample"/.test(rendered)
  && /title="This sample has no video yet/.test(rendered),
  'and it says what it does, to a screen reader and on hover');
ok(rendered.includes("_sxrFillComponent('" + thumbOnly.id + "','video')"),
  'and it calls the samples handler with this card and the component being added');
ok(slot(thumbOnly, 'graphic') === '',
  'the slot renders nothing where the gate says nothing, so the pile is not padded with dead buttons');
/* The id is interpolated into an inline handler inside a double-quoted
   attribute. A card id is server-minted today, but the escape is what keeps
   that from being load-bearing. */
const nasty = slot({ id: 'sr_a"b', graphic_deliverable_id: 'b1_d_1', status: 'In Progress' }, 'video');
ok(!/_sxrFillComponent\('sr_a"b'/.test(nasty) && /&quot;/.test(nasty),
  'and a quote in a card id is escaped rather than closing the attribute');

/* A HANG MUST NOT READ AS A PASS. The executed section above is async, so a
   deadlocked stub empties the event loop and node exits 0 with the summary
   never printed. That happened once while writing it. The watchdog and the
   rejection handler make either failure loud. */
const watchdog = setTimeout(() => {
  console.error('FAIL  the executed save-queue checks never finished (deadlock or hang)');
  process.exit(1);
}, 20000);
process.on('unhandledRejection', error => {
  console.error('FAIL  unhandled rejection in the executed checks: ' + (error && error.message || error));
  process.exit(1);
});

orderingChecks().then(mirrorChecks).then(confirmChecks).then(parkChecks).then(() => {
  clearTimeout(watchdog);
  console.log(failures === 0
    ? '\nsamples component fill checks passed'
    : '\n' + failures + ' samples component fill check(s) failed');
  process.exit(failures === 0 ? 0 : 1);
}, error => {
  clearTimeout(watchdog);
  console.error('FAIL  the executed save-queue checks threw: ' + (error && error.stack || error));
  process.exit(1);
});
