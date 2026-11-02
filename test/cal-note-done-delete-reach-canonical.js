'use strict';
// OPEN_REPAIRS (Mender, 2026-10-13): on Calendar cards, a note marked done or
// deleted kept showing as open in the Notes panel, because some paths flipped
// only the legacy copy on the card while the panel reads the canonical thread.
// Executes the shipped functions from index.html against a fake canonical
// store, then "reloads" by projecting that store again: the note must stay
// done / deleted.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

require('./helpers/single-file-index.js');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const { extractFunction } = require('./helpers/extract-function.js');

function world({ linked = true, crosswalkInFlight = false, unlooked = false } = {}) {
  const canonical = new Map([
    ['n1', { id: 'n1', canonical: true, can_resolve: true, can_delete: true, done: false, deleted: false, is_tweak: true }],
    ['n2', { id: 'n2', canonical: true, can_resolve: true, can_delete: true, done: false, deleted: false, is_tweak: true }],
  ]);
  const legacy = new Map([...canonical].map(([k, v]) => [k, { ...v, canonical: false }]));
  const post = { id: 'card-1', video_deliverable_id: 'del-1', _canonicalCrosswalkInFlight: crosswalkInFlight };
  // unlooked: the card IS linked to its work item, but nothing on this page has looked the link up yet (the SMM's
  // Review tab never opened or pointed at Notes), so the gate answers crosswalk_unresolved until a projection runs.
  const state = { linked, looked: !unlooked };
  const reload = () => [...(state.linked && state.looked ? canonical : legacy).values()].map(c => ({ ...c }));
  let view = reload();
  const notices = [];
  let confirmCb = null;
  const ctx = {
    console, Promise, Set, Object, Array, String, Date, setTimeout: fn => fn(),
    document: { getElementById: () => null },
    calState: { posts: [post] },
    _isClientLink: false,
    _calOpenCommentsPid: 'card-1',
    _calPendingEdits: {},
    _calReviewState: { saving: {} },
    _calReviewMode: () => 'smm',
    _calCanResolveComment: () => true,
    _calCommentRole: () => 'kasper',
    _calMsgIsTweak: c => !!c.is_tweak,
    _calCanDeleteComment: () => true,
    _calFindCompForCommentId: () => 'video',
    _calCommentsFor: () => view,
    _calLoadComments: () => view,
    _calSetCommentsFor: (p, comp, list) => {
      view = list;
      for (const c of list) legacy.set(c.id, { ...c, canonical: false });
    },
    _calStringifyComments: list => JSON.stringify(list),
    _calCurrentAuthor: () => 'staff',
    _calOpenTweaksForComp: () => view.filter(c => !c.parent_id && !c.done && !c.deleted && c.is_tweak
      && !(typeof ctx._calTweakKept === 'function' && ctx._calTweakKept(c))),
    _calResolveDestReason: () => '',
    _calReviewBlockReason: () => '',
    _calSmmApproveTo: d => d,
    _calShowResolveDest: opts => opts.onChoose('stay', opts.openTweaks.map(t => t.id)),
    _calReviewApplyApprove: () => {},
    _calReviewRepaintCard: () => {},
    _calWatchNoteSave: () => {},
    _calRefreshCommentsBtn: () => {},
    _calUpdateCardStatusDisplay: () => {},
    _calCaptureModalDrafts: () => {},
    _calRenderCommentsModal: () => {},
    _calV2Log: () => {},
    _calResolveLastTweak: () => {},
    showNotify: (t, m) => notices.push(t + ' ' + m),
    showConfirm: (t, m, cb) => { confirmCb = cb; },
    _writeUiNativeId: (p, comp) => comp === 'video' ? p.video_deliverable_id : '',
    _prodCrosswalkInFlight: p => !!(p && p._canonicalCrosswalkInFlight),
    _prodCanonicalCommentGate: () => state.linked && state.looked && !post._canonicalCrosswalkInFlight
      ? { linked: true, ready: true }
      : { linked: false, ready: false, status: state.looked && !post._canonicalCrosswalkInFlight ? 'crosswalk_absent' : 'crosswalk_unresolved' },
    _writeUiCommitCardCommentLifecycle: async (surface, p, comp, comment, action) => {
      const row = canonical.get(comment.id);
      if (action === 'resolve') row.done = true;
      if (action === 'delete') row.deleted = true;
      view = reload();
      return { ok: true };
    },
    _writeUiPersistCanonicalCommentProjection: async () => {},
    _prodComments: { readCanonical: async () => {} },
    _prodProjectCanonicalCardComments: async () => { state.projections = (state.projections || 0) + 1; state.looked = true; view = reload(); return true; },
    _calNotesWarm: () => ctx._prodProjectCanonicalCardComments('calendar', 'card-1'),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext('let _calKeepTweakLetters = null;', ctx);
  for (const name of ['_calReviewApprove', '_calReviewResolveCanonical', '_calCanonicalCrosswalkPending',
    '_calResolveTweaksDone', '_calToggleCommentDone', '_calDeleteComment',
    '_calTweakKept', 'svCalReviewApproveKeeping', 'svCalResolveVersionTweaks']) {
    let src;
    try { src = extractFunction(INDEX, name); } catch (e) { continue; } // absent before the fix
    if (INDEX.includes('async function ' + name + '(') && !/^async /.test(src)) src = 'async ' + src;
    vm.runInContext(src, ctx);
  }
  return { ctx, canonical, legacy, state, post, notices, reloadPanel: () => (view = reload()), runConfirm: () => confirmCb && confirmCb() };
}
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // 1. Review-tab "Approve & send" marks the open requests done.
  {
    const w = world();
    w.ctx._calReviewApprove('card-1', 'video', 'client');
    await tick(); await tick();
    const after = w.reloadPanel();
    assert(after.every(c => c.done), 'after reload, notes marked done from the Review tab stay done');
    assert(w.canonical.get('n1').done && w.canonical.get('n2').done, 'the canonical rows are resolved');
  }
  // 2. Mark done from the Notes panel while the card's link is still loading:
  //    no silent legacy-only write; once loaded, it lands canonically.
  {
    const w = world({ crosswalkInFlight: true });
    w.ctx._calToggleCommentDone('n1');
    assert.equal(w.canonical.get('n1').done, false);
    assert.equal(w.notices.length, 1, 'the user is told to try again');
    w.post._canonicalCrosswalkInFlight = false;
    w.ctx._calToggleCommentDone('n1');
    await tick(); await tick();
    assert(w.reloadPanel().find(c => c.id === 'n1').done, 'after reload, the note stays done');
  }
  // 3. Delete, same two cases.
  {
    const w = world({ crosswalkInFlight: true });
    w.ctx._calDeleteComment('n2');
    await w.runConfirm();
    assert.equal(w.notices.length, 1, 'delete while loading is refused with a notice, not saved legacy-only');
    w.post._canonicalCrosswalkInFlight = false;
    w.ctx._calDeleteComment('n2');
    await w.runConfirm();
    assert(w.reloadPanel().find(c => c.id === 'n2').deleted, 'after reload, the note stays deleted');
  }
  // 4. An unlinked card keeps the legacy path.
  {
    const w = world({ linked: false });
    w.ctx._calReviewApprove('card-1', 'video', 'client');
    await tick();
    assert(w.reloadPanel().every(c => c.done), 'legacy-only cards still mark done');
  }
  // 5. OPEN_REPAIRS 447 review: with no pop-up in the way, a second press on the same part while the requests are
  //    still being resolved must not resolve and send twice; a refused send closes nothing more than the old pop-up did.
  {
    const w = world();
    let applies = 0, resolves = 0;
    w.ctx._calReviewApplyApprove = () => { applies++; };
    const base = w.ctx._writeUiCommitCardCommentLifecycle;
    w.ctx._writeUiCommitCardCommentLifecycle = async (...a) => { resolves++; return base(...a); };
    w.ctx._calReviewApprove('card-1', 'video', 'kasper');
    w.ctx._calReviewApprove('card-1', 'video', 'kasper');
    await tick(); await tick(); await tick(); await tick();
    assert.equal(resolves, 2, 'a double press resolves each open request once, not twice');
    assert.equal(applies, 1, 'a double press sends the part once');
    w.ctx._calReviewApprove('card-1', 'video', 'kasper');
    await tick(); await tick();
    assert.equal(applies, 2, 'the hold is released once the send has taken over (a later press with nothing open sends directly)');
  }
  // 6. OPEN_REPAIRS 637 (Reviewguard, 2026-11-02): the SMM approves from the Review tab on a card whose link to its work
  //    item nothing has looked up yet. The approve used to read that as "not linked" and mark the requests done on the
  //    card's legacy copy only, so production_comments.resolved_at stayed empty and the requests showed open again on
  //    every canonical read. It must look the link up first and resolve the canonical rows.
  {
    const w = world({ unlooked: true });
    let applies = 0;
    w.ctx._calReviewApplyApprove = () => { applies++; };
    w.ctx._calReviewApprove('card-1', 'video', 'client');
    for (let i = 0; i < 6; i++) await tick();
    assert(w.canonical.get('n1').done && w.canonical.get('n2').done,
      'an approve before the link was looked up resolves the canonical rows (resolved_at is set)');
    assert(w.reloadPanel().every(c => c.done), 'after reload, the requests stay done');
    assert.equal(applies, 1, 'the part is sent once');
    assert.equal(w.state.projections, 1, 'the link is looked up once');
  }
  // 7. The same press twice while the link is being looked up sends once and resolves each request once.
  {
    const w = world({ unlooked: true });
    let applies = 0, resolves = 0;
    w.ctx._calReviewApplyApprove = () => { applies++; };
    const base = w.ctx._writeUiCommitCardCommentLifecycle;
    w.ctx._writeUiCommitCardCommentLifecycle = async (...a) => { resolves++; return base(...a); };
    w.ctx._calReviewApprove('card-1', 'video', 'kasper');
    w.ctx._calReviewApprove('card-1', 'video', 'kasper');
    for (let i = 0; i < 8; i++) await tick();
    assert.equal(resolves, 2, 'each open request is resolved once');
    assert.equal(applies, 1, 'the part is sent once');
  }
  // 8. A card that turns out not to be linked keeps the legacy path once the lookup has answered.
  {
    const w = world({ linked: false, unlooked: true });
    let applies = 0;
    w.ctx._calReviewApplyApprove = () => { applies++; };
    w.ctx._calReviewApprove('card-1', 'video', 'client');
    for (let i = 0; i < 6; i++) await tick();
    assert(w.reloadPanel().every(c => c.done), 'an unlinked card still marks its legacy requests done');
    assert.equal(applies, 1, 'and sends the part once');
  }
  // 9. Codex on PR 2512: a trial-reel card's approve that keeps some versions' requests open (their new cut is still
  //    coming) must still keep them open when it first has to look the card's link up.
  {
    const w = world({ unlooked: true });
    // Both copies carry the same words, as on a real card.
    for (const [id, letter] of [['n1', 'A'], ['n2', 'B']]) {
      w.canonical.get(id).body = 'Video ' + letter + ': change';
      w.legacy.get(id).body = 'Video ' + letter + ': change';
    }
    w.reloadPanel();
    w.ctx.svCalReviewApproveKeeping('card-1', 'video', 'client', ['B']);
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(w.canonical.get('n1').done, true, 'version A\'s request is resolved');
    assert.equal(w.canonical.get('n2').done, false, 'version B\'s request stays open across the lookup');
  }
  // 10. The SMM approves a version's new cut on a card whose link was never looked up: that version's requests are
  //     resolved on the canonical thread too (the same fix, in svCalResolveVersionTweaks).
  {
    const w = world({ unlooked: true });
    for (const [id, letter] of [['n1', 'A'], ['n2', 'B']]) {
      w.canonical.get(id).body = 'Video ' + letter + ': change';
      w.legacy.get(id).body = 'Video ' + letter + ': change';
    }
    w.reloadPanel();
    w.ctx.svCalResolveVersionTweaks('card-1', 'video', ['A']);
    for (let i = 0; i < 6; i++) await tick();
    assert.equal(w.canonical.get('n1').done, true, 'version A\'s request is resolved canonically');
    assert.equal(w.canonical.get('n2').done, false, 'version B\'s request is left alone');
  }
  console.log('cal-note-done-delete-reach-canonical: done and delete reach the canonical thread ✅');
})().catch(e => { console.error(e); process.exit(1); });
