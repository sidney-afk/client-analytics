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

function world({ linked = true, crosswalkInFlight = false } = {}) {
  const canonical = new Map([
    ['n1', { id: 'n1', canonical: true, can_resolve: true, can_delete: true, done: false, deleted: false, is_tweak: true }],
    ['n2', { id: 'n2', canonical: true, can_resolve: true, can_delete: true, done: false, deleted: false, is_tweak: true }],
  ]);
  const legacy = new Map([...canonical].map(([k, v]) => [k, { ...v, canonical: false }]));
  const post = { id: 'card-1', video_deliverable_id: 'del-1', _canonicalCrosswalkInFlight: crosswalkInFlight };
  const state = { linked };
  const reload = () => [...(state.linked ? canonical : legacy).values()].map(c => ({ ...c }));
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
    _calOpenTweaksForComp: () => view.filter(c => !c.parent_id && !c.done && !c.deleted && c.is_tweak),
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
    _prodCanonicalCommentGate: () => state.linked && !post._canonicalCrosswalkInFlight
      ? { linked: true, ready: true } : { linked: false, ready: false, status: 'crosswalk_unresolved' },
    _writeUiCommitCardCommentLifecycle: async (surface, p, comp, comment, action) => {
      const row = canonical.get(comment.id);
      if (action === 'resolve') row.done = true;
      if (action === 'delete') row.deleted = true;
      view = reload();
      return { ok: true };
    },
    _writeUiPersistCanonicalCommentProjection: async () => {},
    _prodComments: { readCanonical: async () => {} },
    _prodProjectCanonicalCardComments: async () => { view = reload(); },
  };
  vm.createContext(ctx);
  for (const name of ['_calReviewApprove', '_calReviewResolveCanonical', '_calCanonicalCrosswalkPending',
    '_calResolveTweaksDone', '_calToggleCommentDone', '_calDeleteComment']) {
    let src;
    try { src = extractFunction(INDEX, name); } catch (e) { continue; } // absent before the fix
    if (INDEX.includes('async function ' + name + '(') && !/^async /.test(src)) src = 'async ' + src;
    vm.runInContext(src, ctx);
  }
  return { ctx, canonical, state, post, notices, reloadPanel: () => (view = reload()), runConfirm: () => confirmCb && confirmCb() };
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
  console.log('cal-note-done-delete-reach-canonical: done and delete reach the canonical thread ✅');
})().catch(e => { console.error(e); process.exit(1); });
