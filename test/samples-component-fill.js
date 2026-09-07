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
  writeSrc + '; return _sxrFillWriteCardLink;',
);

function harness(options = {}) {
  const state = {
    saveInFlight: Object.create(null),
    pendingEdits: options.pendingEdits || Object.create(null),
    posts: options.posts || [{ id: 'sr_1', name: 'Sample 1', graphic_deliverable_id: 'b1_d_1' }],
    slug: 'testclient',
    awaited: 0, cached: [], rendered: 0, flushed: [], sent: null,
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

orderingChecks().then(() => {
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
