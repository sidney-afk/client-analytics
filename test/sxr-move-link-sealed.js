'use strict';
/*
 * The Samples "Move it here" link move was not sealed.
 *
 * `_calMoveLink` on the calendar carries a live authority seal check, and its
 * own comment states the rule it exists for:
 *
 *   "Moving a link SETS one on the receiving card, so it is the same write the
 *    seal refuses -- gated here too rather than relying on the commit path
 *    having already checked. The repo's own lesson from the sub-issue
 *    multi-select bug is that a guard which lives only on the surface that
 *    usually calls it is a guard with a hole in it."
 *
 * `_sxrMoveLink`, its Samples twin, had no such check. `_sxrLinearCommit` does
 * seal before it calls `applyCommit`, but the link-conflict flow never goes
 * through it: `_sxrMoveLinkConfirm` is a different surface and calls
 * `_sxrMoveLink` directly. So on a syncview-authoritative team a staff member
 * could still move a Linear link onto a samples card, and the move also fires
 * `_sxrSyncStatusFromLinear`, which POSTs `linear-subissues` — an endpoint that
 * stops answering when Linear access ends on 2026-09-15.
 *
 * This is a standing seal defect in its own right, not only a cutover problem.
 *
 * ORDER MATTERS AS MUCH AS PRESENCE. `_sxrMoveLink` clears the OLD card's link
 * before setting the new one. A seal check placed after that clearing would
 * refuse the move and still have stripped the source card — the item-66 shape,
 * where a refusal leaves the user worse off than before they clicked.
 */
const fs = require('fs');
const path = require('path');

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

const sxrMove = grabFunc('_sxrMoveLink');
const calMove = grabFunc('_calMoveLink');

/* ---- 1. The seal is present at all ------------------------------------- */

ok(/_writeUiLinkSlotSealedLive\(which\)/.test(sxrMove),
  '_sxrMoveLink reads live link-slot authority before moving a Linear link');
ok(/_writeUiLinkSlotSealedNotice\(which, moveSeal\.reason\)/.test(sxrMove),
  'and refuses with the same shared seal notice its calendar twin uses');
/* 2026-09-08 (Codex finding 3): the refusal returns FALSE now rather than bare,
   so `_sxrMoveLinkConfirm` can tell a refusal from a completed move and put the
   title row back. Same control flow, explicit answer. */
ok(/moveSeal\.sealed[\s\S]{0,200}?return false;/.test(sxrMove),
  'the sealed branch returns, so nothing below it is reachable on a refusal');
ok(/\.then\(moved => \{ if \(!moved\) _sxrRestoreTitleRow\(pid\); \}\)/.test(INDEX),
  'and a refused move restores the title row instead of leaving a dead "Move it here" button '
  + '(behaviour proved in test/sxr-move-link-client-switch.js)');

/* ---- 2. THE TRAP: seal before the source card is stripped --------------- */

const sealAt = sxrMove.indexOf('_writeUiLinkSlotSealedLive');
const clearAt = sxrMove.indexOf("oldPost[f] = ''");
const pendingAt = sxrMove.indexOf('_sxrPendingEdits[oldPid]');
const flushAt = sxrMove.indexOf('_sxrFlushCardSave(oldPid)');
ok(sealAt > 0 && clearAt > 0 && sealAt < clearAt,
  'the seal runs BEFORE the old card\'s link is cleared, so a refused move leaves the source card intact');
ok(sealAt < pendingAt && sealAt < flushAt,
  'and before the pending-edit write and its flush, so a refusal saves nothing');

/* The sync that POSTs linear-subissues must also sit behind the seal. */
/* Match the CALL, not the explanatory comment above the seal that names the
   same function — indexOf on the bare name finds the comment first. */
const syncAt = sxrMove.indexOf('_sxrSyncStatusFromLinear(newPid');
ok(syncAt > 0 && sealAt < syncAt,
  'and before _sxrSyncStatusFromLinear, which POSTs linear-subissues — dead after 2026-09-15');

/* ---- 3. Parity with the calendar twin ---------------------------------- */

ok(/_writeUiLinkSlotSealedLive\(which\)/.test(calMove),
  'the calendar twin _calMoveLink still carries its seal (this is the reference, not the change)');
const calSeal = calMove.indexOf('_writeUiLinkSlotSealedLive');
const calClear = calMove.indexOf("oldPost[f] = ''");
ok(calSeal > 0 && calClear > 0 && calSeal < calClear,
  'and both twins now order the check the same way');

/* ---- 4. The reachable surface is real ---------------------------------- */
/* _sxrMoveLinkConfirm is wired to a rendered button, and is the caller that
   bypassed _sxrLinearCommit's own seal. If this stops being reachable the
   defect is gone for a different reason and this suite should be revisited. */
ok(/_sxrMoveLinkConfirm\('\$\{pid\}'\)/.test(INDEX) || /_sxrMoveLinkConfirm\(/.test(INDEX),
  '_sxrMoveLinkConfirm is still a rendered, staff-reachable entry point');
/* The window is generous because the explanation of finding 3 now sits between
   the two, and this check is about the CALL existing, not about how much prose
   precedes it. */
ok(/function _sxrMoveLinkConfirm[\s\S]{0,1600}?_sxrMoveLink\(/.test(INDEX),
  'and it calls _sxrMoveLink directly, which is why _sxrLinearCommit\'s seal never covered it');
ok(/if \(_isClientLink\) return false;/.test(sxrMove),
  'clients still cannot reach it at all — the staff-only guard is unchanged');

/* ---- EXECUTED: the client switch during EITHER await -------------------- */
/* Codex, 2026-09-08: the freeze guarded the authority read, and then
   `_sxrFlushCardSave(oldPid)` introduced a SECOND network await with the same
   consequence. Driven rather than grepped, because every earlier check in this
   file is a source assertion and a source assertion cannot tell you what the
   function DOES when the client moves mid-flight. */
const vm = require('vm');

function driveMove(switchDuring) {
  const writes = [];
  const sandbox = {
    console, String, Object, Array, Promise, JSON,
    _isClientLink: false,
    sxrState: { client: 'Client A', posts: [
      { id: 'old1', linear_issue_id: 'https://linear.invalid/VID-1', graphic_linear_issue_id: '' }
    ] },
    sxrClientSlug: v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ''),
    _sxrLinkKey: v => String(v || '').trim().toLowerCase(),
    _sxrPendingEdits: {},
    _sxrRenderBody: () => {},
    _sxrArchivedRemove: () => {},
    _sxrSyncStatusFromLinear: () => { writes.push('sync'); },
    showNotify: () => {},
    _writeUiLinkSlotSealedNotice: () => ['t', 'b'],
    // The seal read is network-bound; the flush is a second one. Each can be
    // made to yield, and the test switches the client inside the named one.
    _writeUiLinkSlotSealedLive: async () => {
      if (switchDuring === 'authority') sandbox.sxrState.client = 'Client B';
      return { sealed: false, reason: 'ok' };
    },
    _sxrFlushCardSave: async (pid) => {
      writes.push('flush:' + pid);
      if (switchDuring === 'flush') sandbox.sxrState.client = 'Client B';
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(grabFunc('_sxrMoveLink'), sandbox);
  return sandbox._sxrMoveLink('old1', 'new1', 'video', 'https://linear.invalid/VID-1')
    .then(result => ({ result, writes, pending: Object.keys(sandbox._sxrPendingEdits) }));
}

(async () => {
  const clean = await driveMove(null);
  ok(clean.result === true && clean.pending.includes('new1'),
    'CONTROL: with no client switch the move completes and stamps the receiving card');

  const duringAuthority = await driveMove('authority');
  ok(duringAuthority.result === false && !duringAuthority.pending.includes('new1'),
    'a switch during the AUTHORITY await refuses and never stamps the receiving card');

  const duringFlush = await driveMove('flush');
  ok(duringFlush.result === false,
    'a switch during the SOURCE-SAVE await refuses too — the second await was the hole Codex '
    + 'found after the first was closed');
  ok(!duringFlush.pending.includes('new1'),
    '  · and no pending edit is stamped for the receiving card, so nothing can be flushed into '
    + 'the client now on screen');
  ok(!duringFlush.writes.includes('flush:new1') && !duringFlush.writes.includes('sync'),
    '  · and neither the receiving save nor the Linear status sync runs — a cross-client WRITE '
    + 'is the harm this refuses');
  ok(duringFlush.writes.includes('flush:old1'),
    '  · the source card\'s own clear DID save, which is the deliberate half-done state: an '
    + 'incomplete move is the lesser harm than a write to another client');

  console.log(`\nsxr-move-link-sealed: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})();
