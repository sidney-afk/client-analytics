'use strict';
/*
 * A LINK MOVE MUST NOT LAND ON THE CLIENT THE USER SWITCHED TO.
 *
 * Two findings, one flow, and they compose — which is why they are proved
 * together here rather than by two greps.
 *
 * FINDING 2 (the write). `_sxrMoveLink` awaits `_writeUiLinkSlotSealedLive`,
 * a live authority read over the network. `sxrState.client` and
 * `sxrState.posts` are mutable and the Samples client picker stays live while
 * that read is in flight, so staff can click "Move it here" and switch clients
 * before it resolves. The continuation then read the NEW client's state:
 * `sxrState.posts.find(p => p.id === newPid)` matches nothing, but the code
 * below it still stamps `_sxrPendingEdits[newPid]` and calls
 * `_sxrFlushCardSave(newPid)` — which, finding no id it recognises, treats it
 * as a NEW row and saves the previous client's card into the client now on
 * screen. That is a cross-client write, and the client lifecycle is the one
 * thing that must not break, so its low odds do not soften it.
 *
 * `addSxrBlankCard`, twenty lines further down the same file, already freezes
 * its slug across exactly this kind of wait. This is the same guard on the
 * same shape.
 *
 * FINDING 3 (the leftover UI). `_sxrMoveLinkConfirm` deletes
 * `_sxrPendingLinkMove[pid]` BEFORE calling `_sxrMoveLink`, so on any refusal —
 * the item-176 seal, or the client-switch abort above — the rendered "Move it
 * here" conflict row stayed on screen with nothing behind it. Every further
 * click hit the `if (!mv)` guard and did nothing: the user is told the move was
 * refused and then handed a button that silently no-ops.
 *
 * A STATIC CHECK CANNOT SEE EITHER OF THESE. The order of two statements around
 * an await is exactly what a grep gets wrong, so this suite lifts the shipped
 * functions into a vm, holds the authority read open, moves the client
 * underneath them, and asserts on what was actually written and rendered.
 *
 * Fixtures are synthetic slugs. The repository is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { stripComments } = require('./helpers/strip-comments');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

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
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

const OLD_PID = 'sr_old', NEW_PID = 'sr_new';
const LINK = 'https://linear.app/team/issue/VID-4242';

/* One scenario = one sandbox holding the shipped functions over a controllable
   authority read and a two-element fake DOM. `release` resolves the seal read;
   everything between the call and the release is the window the race lives in. */
function makeSandbox() {
  const calls = { flush: [], sync: [], notify: [], render: 0, archivedRemove: [] };
  let releaseSeal = null;
  const sealGate = new Promise(resolve => { releaseSeal = resolve; });

  const rows = new Map();          // pid -> { html }
  const sandbox = {
    console, String, Array, Set, Object, Error, Promise, JSON, Boolean,
    calls,
    _isClientLink: false,
    _sxrPendingEdits: Object.create(null),
    _sxrPendingLinkMove: Object.create(null),
    sxrState: {
      client: 'clientone',
      posts: [
        { id: OLD_PID, name: 'source card', linear_issue_id: LINK, graphic_linear_issue_id: '' },
        { id: NEW_PID, name: 'target card', linear_issue_id: '', graphic_linear_issue_id: '' }
      ]
    },
    /* The real normalisation, near enough: these fixtures are already slugs. */
    sxrClientSlug: (c) => String((c && c.name ? c.name : c) || '').toLowerCase().replace(/[^a-z0-9&]+/g, ''),
    _sxrLinkKey: (v) => String(v || '').trim().toLowerCase().replace(/\/+$/, ''),
    _sxrFlushCardSave: (pid) => { calls.flush.push({ pid, client: sandbox.sxrState.client }); return Promise.resolve(); },
    _sxrArchivedRemove: (slug, refs) => { calls.archivedRemove.push({ slug, refs }); },
    _sxrRenderBody: () => { calls.render++; },
    _sxrSyncStatusFromLinear: (pid, val, which) => { calls.sync.push({ pid, val, which }); },
    _sxrTitleRowHtml: (pid) => 'TITLE_ROW:' + pid,
    showNotify: (a, b) => { calls.notify.push([a, b]); },
    _writeUiLinkSlotSealedNotice: (which, reason) => ['refused', which + '/' + reason],
    /* The network-bound authority read the race lives around. */
    _writeUiLinkSlotSealedLive: () => sealGate,
    document: {
      querySelector: (sel) => {
        const m = /\[data-title-row="([^"]+)"\]/.exec(sel);
        if (!m) return null;
        const pid = m[1];
        if (!rows.has(pid)) return null;
        return rows.get(pid);
      }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    grabFunc('_sxrRestoreTitleRow') + '\n'
    + grabFunc('_sxrLinkConflictCancel') + '\n'
    + grabFunc('_sxrMoveLinkConfirm') + '\n'
    + grabFunc('_sxrMoveLink'), sandbox);

  return {
    sandbox,
    calls,
    /* Render a conflict row for pid, the way _sxrShowLinkConflict does. */
    showConflictRow(pid) { rows.set(pid, { innerHTML: 'CONFLICT_ROW' }); },
    rowHtml(pid) { return rows.has(pid) ? rows.get(pid).innerHTML : null; },
    releaseSealed() { releaseSeal({ sealed: true, reason: 'syncview_authoritative' }); },
    releaseOpen() { releaseSeal({ sealed: false, reason: 'syncview_authoritative' }); },
    /* let the pending continuations run */
    settle: () => new Promise(r => setImmediate(() => setImmediate(r)))
  };
}

(async () => {
  /* ---- 0. The harness is not vacuous ----------------------------------- */
  {
    const h = makeSandbox();
    ok(typeof h.sandbox._sxrMoveLink === 'function' && typeof h.sandbox._sxrMoveLinkConfirm === 'function',
      'the shipped _sxrMoveLink and _sxrMoveLinkConfirm load and run');
  }

  /* ---- 1. THE HAPPY PATH still moves the link -------------------------- */
  {
    const h = makeSandbox();
    const p = h.sandbox._sxrMoveLink(OLD_PID, NEW_PID, 'video', LINK);
    h.releaseOpen();
    const moved = await p;
    ok(moved === true, 'an unsealed move on the same client completes and reports success');
    const posts = h.sandbox.sxrState.posts;
    ok(posts.find(x => x.id === OLD_PID).linear_issue_id === '',
      '  · the source card\'s link is cleared');
    ok(posts.find(x => x.id === NEW_PID).linear_issue_id === LINK,
      '  · and the receiving card carries it');
    ok(h.calls.flush.some(f => f.pid === NEW_PID) && h.calls.sync.length === 1,
      '  · the receiving card is saved and the Linear status sync fires');
    ok(h.calls.archivedRemove.every(a => a.slug === 'clientone'),
      '  · and every write is stamped with the INITIATING client');
  }

  /* ---- 2. FINDING 2: the client changes while authority is in flight ---- */
  {
    const h = makeSandbox();
    const p = h.sandbox._sxrMoveLink(OLD_PID, NEW_PID, 'video', LINK);

    /* Staff switch Samples clients. This is the real gesture: `sxrState` is
       replaced wholesale by the client load, so `newPid` is not in it. */
    h.sandbox.sxrState.client = 'clienttwo';
    h.sandbox.sxrState.posts = [{ id: 'sr_other', name: 'a card belonging to clienttwo', linear_issue_id: '', graphic_linear_issue_id: '' }];

    h.releaseOpen();                       // authority answers: NOT sealed
    const moved = await p;

    ok(moved === false,
      'the move ABORTS when the selected client changed under the authority read');
    ok(h.calls.flush.length === 0,
      'THE FINDING: no card save is issued at all — `_sxrFlushCardSave` was never called, so the '
      + 'previous client\'s card cannot be written into the client now on screen');
    ok(!Object.prototype.hasOwnProperty.call(h.sandbox._sxrPendingEdits, NEW_PID),
      '  · and no pending edit is stamped for the moved card id, which is what `_sxrFlushCardSave` '
      + 'would have treated as a NEW row on the wrong client');
    ok(h.calls.sync.length === 0,
      '  · and no linear-subissues status sync fires for it');
    ok(h.sandbox.sxrState.posts.length === 1 && h.sandbox.sxrState.posts[0].id === 'sr_other'
      && h.sandbox.sxrState.posts[0].linear_issue_id === '',
      '  · the newly selected client\'s cards are untouched');
    ok(h.calls.archivedRemove.length === 0,
      '  · and nothing is un-archived against the wrong slug');
    ok(h.calls.notify.length === 0,
      'and it aborts SILENTLY, like addSxrBlankCard: a toast about the client the user just left is noise');
  }

  /* The source card must survive the abort too. A refusal that has already
     stripped the source is the item-66 shape the seal ordering exists to
     avoid, and the client-switch abort has to clear the same bar. */
  {
    const h = makeSandbox();
    const p = h.sandbox._sxrMoveLink(OLD_PID, NEW_PID, 'video', LINK);
    const source = h.sandbox.sxrState.posts.find(x => x.id === OLD_PID);
    h.sandbox.sxrState.client = 'clienttwo';
    h.releaseOpen();
    await p;
    ok(source.linear_issue_id === LINK,
      'the SOURCE card keeps its link across the abort — a refusal never leaves the user worse off');
    ok(!Object.prototype.hasOwnProperty.call(h.sandbox._sxrPendingEdits, OLD_PID),
      '  · and no clearing edit was queued for it either');
  }

  /* ---- 3. FINDING 3: a refused move must not leave a dead control ------- */
  {
    const h = makeSandbox();
    h.showConflictRow(NEW_PID);
    h.sandbox._sxrPendingLinkMove[NEW_PID] = { which: 'video', val: LINK, oldPid: OLD_PID };

    h.sandbox._sxrMoveLinkConfirm(NEW_PID);
    h.releaseSealed();                     // authority answers: SEALED, refuse
    await h.settle();

    ok(h.calls.notify.length === 1,
      'a sealed move still tells the user it was refused (item 176, unchanged)');
    ok(h.rowHtml(NEW_PID) === 'TITLE_ROW:' + NEW_PID,
      'THE FINDING: the conflict row is replaced by the ordinary title row, so the refused "Move it '
      + 'here" button is gone rather than left on screen as a silent no-op');
    ok(!h.sandbox._sxrPendingLinkMove[NEW_PID],
      '  · and the pending move stays dropped, so a stray second click cannot re-fire the write '
      + 'that was just refused');
  }

  /* The same must hold for the client-switch abort, which is the refusal that
     says nothing — leaving a dead button there would be the worse of the two. */
  {
    const h = makeSandbox();
    h.showConflictRow(NEW_PID);
    h.sandbox._sxrPendingLinkMove[NEW_PID] = { which: 'video', val: LINK, oldPid: OLD_PID };

    h.sandbox._sxrMoveLinkConfirm(NEW_PID);
    h.sandbox.sxrState.client = 'clienttwo';
    h.releaseOpen();
    await h.settle();

    ok(h.rowHtml(NEW_PID) === 'TITLE_ROW:' + NEW_PID,
      'a move aborted by a client switch also restores the title row');
    ok(h.calls.flush.length === 0,
      '  · while still writing nothing (findings 2 and 3 compose on the same click)');
  }

  /* A move that SUCCEEDS must not be "restored" — that would repaint the row
     from stale state and undo the rendering the move just did. */
  {
    const h = makeSandbox();
    h.showConflictRow(NEW_PID);
    h.sandbox._sxrPendingLinkMove[NEW_PID] = { which: 'video', val: LINK, oldPid: OLD_PID };
    h.sandbox._sxrMoveLinkConfirm(NEW_PID);
    h.releaseOpen();
    await h.settle();
    ok(h.rowHtml(NEW_PID) === 'CONFLICT_ROW',
      'a SUCCESSFUL move does not run the restore — only refusals do, so the move\'s own render stands');
    ok(h.calls.flush.some(f => f.pid === NEW_PID),
      '  · and the move actually happened');
  }

  /* Cancel is the reference behaviour the refusal path now matches. */
  {
    const h = makeSandbox();
    h.showConflictRow(NEW_PID);
    h.sandbox._sxrPendingLinkMove[NEW_PID] = { which: 'video', val: LINK, oldPid: OLD_PID };
    h.sandbox._sxrLinkConflictCancel(NEW_PID);
    ok(h.rowHtml(NEW_PID) === 'TITLE_ROW:' + NEW_PID && !h.sandbox._sxrPendingLinkMove[NEW_PID],
      'Cancel still clears the pending move and restores the row — the refusal path now matches it');
  }

  /* ---- 4. The client freeze is CAPTURED BEFORE THE AWAIT ---------------- */
  /* Behavioural checks above prove the outcome; this pins the mechanism, so a
     later edit that re-reads `sxrState.client` after the await — which would
     compare the new client against itself and always pass — fails here. */
  {
    /* Ordering is measured on the CODE, with comments stripped. The prose above
       these statements names the very functions being ordered — `indexOf` on a
       bare call finds the explanation first and reports a false position. The
       sibling suite hit the same trap on `_sxrSyncStatusFromLinear`. */
    // The house helper, not a hand-rolled strip: `/*` inside a string is not a
    // comment, and the raw regex silently blinded a dozen gates to ~64k
    // characters of index.html (OPEN_REPAIRS 145). test/comment-strip-is-honest.js
    // fails any suite that reintroduces it, and it failed this one.
    const body = stripComments(grabFunc('_sxrMoveLink'), ' ');
    const captureAt = body.indexOf('const slug = sxrClientSlug(sxrState.client)');
    const awaitAt = body.indexOf('await _writeUiLinkSlotSealedLive');
    const compareAt = body.indexOf('sxrClientSlug(sxrState.client) !== slug');
    ok(captureAt > 0 && awaitAt > 0 && captureAt < awaitAt,
      'the initiating client slug is captured BEFORE the authority await');
    ok(compareAt > awaitAt,
      'and compared against the live selection AFTER it');
    ok(body.indexOf('_sxrPendingEdits[newPid]') > compareAt
      && body.indexOf('_sxrFlushCardSave(newPid)') > compareAt,
      'every write to the receiving card sits behind that comparison');
    ok(body.indexOf("oldPost[f] = ''") > compareAt,
      'and so does the clearing of the source card, so an abort strips nothing');
  }

  console.log(`\nsxr-move-link-client-switch: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})();
