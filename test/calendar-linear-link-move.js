'use strict';
/*
 * Linear sub-issue link uniqueness + "Move it here" migration harness.
 *
 * Run:  node test/calendar-linear-link-move.js   (exit 0 = all good)
 *
 * Background: a Linear sub-issue link is effectively a unique key — the
 * status-sync, the status push and the calendar dedupe all assume one card per
 * issue. Pasting a link that's already on another card used to silently vanish
 * on the next refresh (the dedupe collapsed the two cards). This change:
 *   1. dedupes BOTH the video and graphic slots, symmetrically + case-folded;
 *   2. catches the clash at paste time (_calLinkConflict) and offers a
 *      "Move it here" / "Cancel" prompt instead of silently swallowing the link;
 *   3. the move clears the OLD card's slot FIRST, then sets the new one, so the
 *      two cards never hold the same issue at once (nothing to collapse).
 *
 * Every behavioural test runs the REAL function brace-extracted from index.html;
 * the WIRING section asserts the shipped file still carries the fix.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  let at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  if (INDEX.slice(at - 6, at) === 'async ') at -= 6; // keep the async keyword
  let i = INDEX.indexOf('{', at), depth = 0;
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
// Compile a function verbatim from index.html and publish it on globalThis so
// sibling extracted functions resolve it as a free variable at call time.
function def(name) { const fn = new Function('return (' + grabFunc(name) + ')')(); globalThis[name] = fn; return fn; }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } }

// Shared real helpers.
const _calLinkKey = def('_calLinkKey');
const _calIsArchivedRef = def('_calIsArchivedRef');
const _calDedupeByLinearIssue = def('_calDedupeByLinearIssue');

const VID1 = 'https://linear.app/acme/issue/VID-1/make-the-thing';
const VID2 = 'https://linear.app/acme/issue/VID-2/other';
const GRA9 = 'https://linear.app/acme/issue/GRA-9/the-graphic';

console.log('\n============================================================');
console.log('1) _calLinkKey — normalised comparison key');
console.log('============================================================');
ok(_calLinkKey('  ' + VID1 + ' ') === VID1.toLowerCase(), 'trims + lowercases');
ok(_calLinkKey(VID1.toUpperCase()) === _calLinkKey(VID1.toLowerCase()), 'case variants collapse to one key');
ok(_calLinkKey('') === '' && _calLinkKey(null) === '' && _calLinkKey(undefined) === '', 'empty / null / undefined → empty key');

console.log('\n============================================================');
console.log('2) _calDedupeByLinearIssue — video + graphic, symmetric');
console.log('============================================================');
// Legacy video dedupe: newer updated_at wins, loser dropped, order preserved.
{
  const a = { id: 'a', linear_issue_id: VID1, updated_at: '2026-01-02T00:00:00Z', order_index: 1 };
  const b = { id: 'b', linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 9 };
  const c = { id: 'c', linear_issue_id: VID2, updated_at: '2026-01-01T00:00:00Z', order_index: 2 };
  const out = _calDedupeByLinearIssue([a, b, c]);
  ok(out.length === 2 && out.includes(a) && out.includes(c) && !out.includes(b),
     'two cards on one VIDEO link collapse to the most-recently-updated one');
}
// Graphic dedupe (the new symmetry — previously graphic dups were NOT collapsed).
{
  const a = { id: 'a', graphic_linear_issue_id: GRA9, updated_at: '2026-01-02T00:00:00Z', order_index: 1 };
  const b = { id: 'b', graphic_linear_issue_id: GRA9, updated_at: '2026-01-01T00:00:00Z', order_index: 9 };
  const out = _calDedupeByLinearIssue([a, b]);
  ok(out.length === 1 && out[0] === a, 'two cards on one GRAPHIC link also collapse (symmetry)');
}
// Case / whitespace-only differences still collapse.
{
  const a = { id: 'a', linear_issue_id: VID1, updated_at: '2026-01-02T00:00:00Z', order_index: 1 };
  const b = { id: 'b', linear_issue_id: '  ' + VID1.toUpperCase() + ' ', updated_at: '2026-01-01T00:00:00Z', order_index: 9 };
  ok(_calDedupeByLinearIssue([a, b]).length === 1, 'case/whitespace-only variants of the same link collapse');
}
// A link in card A's video slot and card B's graphic slot = same issue → collapse.
{
  const a = { id: 'a', linear_issue_id: VID1, updated_at: '2026-01-02T00:00:00Z', order_index: 1 };
  const b = { id: 'b', graphic_linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 9 };
  ok(_calDedupeByLinearIssue([a, b]).length === 1, 'same issue across different slots collapses (cross-slot)');
}
// order_index breaks an updated_at tie; full tie keeps the first in input order.
{
  const a = { id: 'a', linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 1 };
  const b = { id: 'b', linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 9 };
  ok(_calDedupeByLinearIssue([a, b])[0] === b, 'equal updated_at → higher order_index wins');
  const c = { id: 'c', linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 5 };
  const d = { id: 'd', linear_issue_id: VID1, updated_at: '2026-01-01T00:00:00Z', order_index: 5 };
  ok(_calDedupeByLinearIssue([c, d])[0] === c, 'full tie → first in input order wins (deterministic)');
}
// Archived cards must NOT compete for a link key — an archived twin can't drop a
// live card off the calendar (mirrors _calLinkConflict; the "TEST 1 vanishes" bug).
{
  const live = { id: 'live', linear_issue_id: VID1, status: 'In Progress', updated_at: '2026-01-01T00:00:00Z', order_index: 1 };
  const archNewer = { id: 'arch', linear_issue_id: VID1, status: 'Archived', updated_at: '2026-09-09T00:00:00Z', order_index: 9 };
  const out = _calDedupeByLinearIssue([live, archNewer]);
  ok(out.some(p => p === live), 'a NEWER archived twin does NOT knock the live card off the calendar');
  const archG = { id: 'archG', graphic_linear_issue_id: GRA9, status: 'Archived', updated_at: '2026-09-09T00:00:00Z', order_index: 9 };
  const liveG = { id: 'liveG', graphic_linear_issue_id: GRA9, status: 'In Progress', updated_at: '2026-01-01T00:00:00Z', order_index: 1 };
  ok(_calDedupeByLinearIssue([archG, liveG]).some(p => p === liveG), 'same holds for a shared GRAPHIC link (archived ignored)');
}
// Rows with no link always pass through; ordering preserved.
{
  const a = { id: 'a' }, b = { id: 'b', linear_issue_id: VID1, updated_at: '2026-01-02T00:00:00Z' }, c = { id: 'c' };
  const out = _calDedupeByLinearIssue([a, b, c]);
  ok(out.length === 3 && out[0] === a && out[1] === b && out[2] === c, 'link-less rows pass through unchanged, order kept');
  ok(_calDedupeByLinearIssue([a]) === undefined || _calDedupeByLinearIssue([{ id: 'x' }]).length === 1, 'fewer than 2 posts returns input as-is');
}

console.log('\n============================================================');
console.log('3) _calLinkConflict — finds the clashing live card');
console.log('============================================================');
const _calLinkConflict = def('_calLinkConflict');
globalThis.calClientSlug = (n) => String(n || '').toLowerCase();
globalThis.calState = { client: 'Sydney', posts: [] };
const oldCard = { id: 'old', name: 'Old card', linear_issue_id: VID1, status: 'In Progress' };
const newCard = { id: 'new', name: 'New card', linear_issue_id: '', graphic_linear_issue_id: '', status: 'In Progress' };
const graphCard = { id: 'g', name: 'Graphic holder', graphic_linear_issue_id: GRA9, status: 'In Progress' };
const archByStatus = { id: 'arc', name: 'Archived', linear_issue_id: VID2, status: 'Archived' };
const archByLedger = { id: 'led', name: 'Ledgered', linear_issue_id: 'https://linear.app/acme/issue/VID-3/x', status: 'In Progress' };
globalThis.calState.posts = [oldCard, newCard, graphCard, archByStatus, archByLedger];
globalThis._calArchivedRefs = () => new Set(['led']); // 'led' archived locally, sheet not caught up

ok(_calLinkConflict(VID1, 'new') === oldCard, 'finds the other card holding the link in its VIDEO slot');
ok(_calLinkConflict(VID1.toUpperCase(), 'new') === oldCard, 'match is case-insensitive');
ok(_calLinkConflict(GRA9, 'new') === graphCard, 'finds a clash in another card\'s GRAPHIC slot');
ok(_calLinkConflict(VID1, 'old') === null, 'excludes the card being edited itself');
ok(_calLinkConflict(VID2, 'new') === null, 'ignores a card archived by status');
ok(_calLinkConflict('https://linear.app/acme/issue/VID-3/x', 'new') === null, 'ignores a card archived only in the local ledger');
ok(_calLinkConflict('', 'new') === null && _calLinkConflict('   ', 'new') === null, 'empty / whitespace link → no conflict');
ok(_calLinkConflict('https://linear.app/acme/issue/VID-404/none', 'new') === null, 'an unused link → no conflict');

console.log('\n============================================================');
console.log('4) _calLinearCommit — gates on the conflict before committing');
console.log('============================================================');
const _calLinearCommit = def('_calLinearCommit');
let showConflictCalls, flushCalls, archRemoveCalls, syncCalls, renderCalls;
function resetCommitSpies() {
  showConflictCalls = []; flushCalls = []; archRemoveCalls = []; syncCalls = []; renderCalls = 0;
  globalThis._calPendingEdits = {};
}
globalThis._calShowLinkConflict = (pid, which, val, conflict) => showConflictCalls.push({ pid, which, val, conflict });
globalThis._calFlushCardSave = (pid) => flushCalls.push(pid);
globalThis._calArchivedRemove = (slug, arr) => archRemoveCalls.push({ slug, arr });
globalThis._calSyncStatusFromLinear = (pid, val, which) => syncCalls.push({ pid, val, which });
globalThis._calRenderBody = () => { renderCalls++; };
globalThis._calTitleRowHtml = () => 'TITLE_HTML';
globalThis._isClientLink = false;
globalThis.document = { querySelector: () => ({ innerHTML: '' }) };
// New deps pulled in by the validation guard (real helpers + UI stubs).
def('_calIdentFromUrl');
def('_calLinearExpectPrefix');
globalThis.showNotify = () => {};
globalThis.showConfirm = () => {};

// (a) conflict present → prompt shown, NOTHING committed.
resetCommitSpies();
globalThis._calLinkConflict = () => ({ id: 'old', name: 'Old card' });
const tgt = { id: 'new', linear_issue_id: '' };
globalThis.calState = { client: 'Sydney', posts: [tgt] };
_calLinearCommit({ dataset: {}, value: VID1 }, 'new', 'video');
ok(showConflictCalls.length === 1 && showConflictCalls[0].val === VID1 && showConflictCalls[0].which === 'video',
   'a clashing link shows the Move/Cancel prompt');
ok(tgt.linear_issue_id === '' && !globalThis._calPendingEdits['new'] && flushCalls.length === 0,
   'a clashing link is NOT committed (no field write, no pending edit, no save)');
ok(archRemoveCalls.length === 0 && syncCalls.length === 0, 'no archive-ledger / Linear-sync side effects on a clash');

// (b) no conflict → normal commit.
resetCommitSpies();
globalThis._calLinkConflict = () => null;
const tgt2 = { id: 'new', linear_issue_id: '' };
globalThis.calState = { client: 'Sydney', posts: [tgt2] };
_calLinearCommit({ dataset: {}, value: VID1 }, 'new', 'video');
ok(tgt2.linear_issue_id === VID1 && globalThis._calPendingEdits['new'].linear_issue_id === VID1,
   'a non-clashing link commits to the field + pending edit');
ok(flushCalls.length === 1 && syncCalls.length === 1 && archRemoveCalls.length === 1 && showConflictCalls.length === 0,
   'non-clash path saves, syncs status, clears archive ledger, shows no prompt');

// (c) clearing the link (empty value) never consults the conflict check.
resetCommitSpies();
globalThis._calLinkConflict = () => { throw new Error('conflict check must not run on an empty value'); };
const tgt3 = { id: 'new', linear_issue_id: VID1 };
globalThis.calState = { client: 'Sydney', posts: [tgt3] };
let threw = false; try { _calLinearCommit({ dataset: {}, value: '' }, 'new', 'video'); } catch (e) { threw = true; }
ok(!threw && tgt3.linear_issue_id === '' && flushCalls.length === 1, 'clearing a link commits without a conflict check');
ok(archRemoveCalls.length === 0, 'clearing does not touch the archive ledger (no value)');

// (d) unchanged value → no commit, no prompt (just re-renders the row).
resetCommitSpies();
globalThis._calLinkConflict = () => { throw new Error('conflict check must not run when unchanged'); };
const tgt4 = { id: 'new', linear_issue_id: VID1 };
globalThis.calState = { client: 'Sydney', posts: [tgt4] };
threw = false; try { _calLinearCommit({ dataset: {}, value: VID1 }, 'new', 'video'); } catch (e) { threw = true; }
ok(!threw && flushCalls.length === 0 && showConflictCalls.length === 0, 're-entering the SAME link is a no-op');

// (e) cancelled (Escape) → no commit even if the text changed.
resetCommitSpies();
globalThis._calLinkConflict = () => { throw new Error('conflict check must not run when cancelled'); };
const tgt5 = { id: 'new', linear_issue_id: '' };
globalThis.calState = { client: 'Sydney', posts: [tgt5] };
threw = false; try { _calLinearCommit({ dataset: { cancel: '1' }, value: VID1 }, 'new', 'video'); } catch (e) { threw = true; }
ok(!threw && tgt5.linear_issue_id === '' && flushCalls.length === 0, 'Escape-cancel discards the typed link');

// (f) a non-Linear string → disclaimer, never stored, conflict check never runs.
resetCommitSpies();
let notifyCalls = []; globalThis.showNotify = (t, m) => notifyCalls.push({ t, m });
globalThis._calLinkConflict = () => { throw new Error('conflict check must not run on an invalid link'); };
const tgt6 = { id: 'new', linear_issue_id: '' };
globalThis.calState = { client: 'Sydney', posts: [tgt6] };
threw = false; try { _calLinearCommit({ dataset: {}, value: 'just a note, not a url' }, 'new', 'video'); } catch (e) { threw = true; }
ok(!threw && notifyCalls.length === 1 && tgt6.linear_issue_id === '' && flushCalls.length === 0,
   'a non-Linear string is rejected with a disclaimer and never stored');
globalThis.showNotify = () => {};

// (g) a GRA- link in the VIDEO slot → wrong-slot prompt; commit only on override.
resetCommitSpies();
let confirmYes = null; globalThis.showConfirm = (t, m, onYes) => { confirmYes = onYes; };
globalThis._calLinkConflict = () => null;
const tgt7 = { id: 'new', linear_issue_id: '' };
globalThis.calState = { client: 'Sydney', posts: [tgt7] };
_calLinearCommit({ dataset: {}, value: GRA9 }, 'new', 'video');
ok(typeof confirmYes === 'function' && tgt7.linear_issue_id === '' && flushCalls.length === 0,
   'a GRA- link in the VIDEO slot prompts and does NOT auto-commit');
confirmYes();   // user overrides
ok(tgt7.linear_issue_id === GRA9 && flushCalls.length === 1, 'override saves the mismatched link');
globalThis.showConfirm = () => {};

(async () => {
console.log('\n============================================================');
console.log('5) _calMoveLink — clear old (awaited) FIRST, then set new');
console.log('============================================================');
const _calMoveLink = def('_calMoveLink');
let maxHolders, moveFlush, moveSync, moveArch;
function holdersOf(key) {
  return globalThis.calState.posts.filter(p =>
    _calLinkKey(p.linear_issue_id) === key || _calLinkKey(p.graphic_linear_issue_id) === key).length;
}
function setupMove(oldC, newC, key) {
  globalThis.calState = { client: 'Sydney', posts: [oldC, newC] };
  globalThis._calPendingEdits = {};
  maxHolders = 0; moveFlush = []; moveSync = []; moveArch = [];
  // Async flush mock (matches the real signature) so the move's `await` on the
  // old-card clear actually defers the new-card write, as in production.
  globalThis._calFlushCardSave = async (pid) => { moveFlush.push(pid); maxHolders = Math.max(maxHolders, holdersOf(key)); };
  globalThis._calArchivedRemove = (slug, arr) => moveArch.push({ slug, arr });
  globalThis._calSyncStatusFromLinear = (pid, val, which) => moveSync.push({ pid, val, which });
  globalThis._calRenderBody = () => {};
}

// video → video move
{
  const oC = { id: 'old', linear_issue_id: VID1 };
  const nC = { id: 'new', linear_issue_id: '', graphic_linear_issue_id: '' };
  setupMove(oC, nC, _calLinkKey(VID1));
  await _calMoveLink('old', 'new', 'video', VID1);
  ok(oC.linear_issue_id === '', 'old card video slot cleared');
  ok(nC.linear_issue_id === VID1, 'new card video slot set');
  ok(globalThis._calPendingEdits['old'].linear_issue_id === '' && globalThis._calPendingEdits['new'].linear_issue_id === VID1,
     'both sides queued as pending edits');
  ok(moveFlush.includes('old') && moveFlush.includes('new'), 'both cards saved');
  ok(moveFlush[0] === 'old', 'OLD card is flushed BEFORE the new one (clear-then-set ordering)');
  ok(maxHolders <= 1 && holdersOf(_calLinkKey(VID1)) === 1, 'never two cards on the issue at once; exactly one holds it after');
  ok(moveSync.length === 1 && moveSync[0].pid === 'new' && moveSync[0].which === 'video', 'new card pulls its status from Linear');
  ok(moveArch.length === 1 && moveArch[0].arr[0] === VID1, 'the moved link is removed from the archive ledger');
}
// old card holds the link in its GRAPHIC slot, moving into the new card's VIDEO slot
{
  const oC = { id: 'old', linear_issue_id: '', graphic_linear_issue_id: VID1 };
  const nC = { id: 'new', linear_issue_id: '', graphic_linear_issue_id: '' };
  setupMove(oC, nC, _calLinkKey(VID1));
  await _calMoveLink('old', 'new', 'video', VID1);
  ok(oC.graphic_linear_issue_id === '' && nC.linear_issue_id === VID1, 'clears whichever slot the OLD card held it in');
  ok(maxHolders <= 1, 'cross-slot move still never lets both hold the issue at once');
}
// move INTO the graphic slot
{
  const oC = { id: 'old', linear_issue_id: VID1 };
  const nC = { id: 'new', linear_issue_id: '', graphic_linear_issue_id: '' };
  setupMove(oC, nC, _calLinkKey(VID1));
  await _calMoveLink('old', 'new', 'graphic', VID1);
  ok(nC.graphic_linear_issue_id === VID1 && nC.linear_issue_id === '', 'which="graphic" sets the graphic slot on the new card');
}
// receiving card is a brand-new BLANK card NOT yet in calState.posts (the exact
// real-world case: user clicked "add card", pasted the link, hit Move).
{
  const oC = { id: 'old', linear_issue_id: VID1 };
  setupMove(oC, { id: '__unused__' }, _calLinkKey(VID1));
  globalThis.calState.posts = [oC]; // the blank card isn't saved yet → not in state
  await _calMoveLink('old', '__blank__xyz', 'video', VID1);
  ok(oC.linear_issue_id === '', 'blank-card move: old card still cleared');
  ok(globalThis._calPendingEdits['__blank__xyz'] && globalThis._calPendingEdits['__blank__xyz'].linear_issue_id === VID1,
     'blank-card move: link queued for the not-yet-in-state new card (flush will promote it)');
  ok(moveFlush.includes('old') && moveFlush.includes('__blank__xyz'), 'blank-card move: both old clear and new set are flushed');
  ok(moveSync.some(s => s.pid === '__blank__xyz'), 'blank-card move: status sync attempted for the new card');
}

console.log('\n============================================================');
console.log('6) _calShowLinkConflict / _calLinkConflictCancel — rendering');
console.log('============================================================');
const _calEsc = def('_calEsc');
const _calEscAttr = def('_calEscAttr');
const _calShowLinkConflict = def('_calShowLinkConflict');
const _calLinkConflictCancel = def('_calLinkConflictCancel');
globalThis._calPendingLinkMove = Object.create(null);
let rowStore;
globalThis.document = { querySelector: (sel) => rowStore[sel] || (rowStore[sel] = { innerHTML: '' }) };

rowStore = {};
_calShowLinkConflict('new', 'video', VID1, { id: 'old', name: 'My Old Card' });
const html = rowStore['[data-title-row="new"]'].innerHTML;
ok(/Move it here/.test(html) && /Cancel/.test(html), 'prompt offers Move it here + Cancel');
ok(/already linked to/.test(html) && /My Old Card/.test(html), 'prompt names the card the issue is already on');
ok(/_calMoveLinkConfirm\('new'\)/.test(html) && /_calLinkConflictCancel\('new'\)/.test(html), 'buttons wire to the right handlers');
ok(globalThis._calPendingLinkMove['new'] && globalThis._calPendingLinkMove['new'].oldPid === 'old'
   && globalThis._calPendingLinkMove['new'].val === VID1 && globalThis._calPendingLinkMove['new'].which === 'video',
   'the pending move is stashed (no URL quoted into the onclick)');
// name is escaped (no raw injection)
rowStore = {};
_calShowLinkConflict('new', 'video', VID1, { id: 'old', name: '<b>"x" & y</b>' });
const html2 = rowStore['[data-title-row="new"]'].innerHTML;
ok(!/<b>/.test(html2) && /&lt;b&gt;/.test(html2) && /&amp;/.test(html2), 'the conflicting card name is HTML-escaped');
// blank name falls back
rowStore = {};
_calShowLinkConflict('new', 'video', VID1, { id: 'old', name: '   ' });
ok(/Untitled post/.test(rowStore['[data-title-row="new"]'].innerHTML), 'a nameless card shows "Untitled post"');

// Cancel reverts the row to the normal title and forgets the pending move.
globalThis._calTitleRowHtml = () => 'REVERTED_TITLE';
globalThis._isClientLink = false;
globalThis.calState = { client: 'Sydney', posts: [{ id: 'new', linear_issue_id: '' }] };
globalThis._calPendingLinkMove['new'] = { which: 'video', val: VID1, oldPid: 'old' };
rowStore = { '[data-title-row="new"]': { innerHTML: 'PROMPT' } };
_calLinkConflictCancel('new');
ok(rowStore['[data-title-row="new"]'].innerHTML === 'REVERTED_TITLE', 'Cancel restores the normal title row');
ok(!globalThis._calPendingLinkMove['new'], 'Cancel forgets the pending move');

console.log('\n============================================================');
console.log('7) WIRING — the shipped index.html still carries the fix');
console.log('============================================================');
const commitSrc = grabFunc('_calLinearCommit');
ok(/_calLinkConflict\(val, pid\)/.test(commitSrc) && /_calShowLinkConflict\(/.test(commitSrc),
   '_calLinearCommit gates a changed, non-empty link through the conflict check');
ok(/_calIdentFromUrl\(val\)/.test(commitSrc) && /isn.t a Linear link/.test(commitSrc) && /Wrong slot/.test(commitSrc),
   '_calLinearCommit validates the link (non-Linear rejected, wrong slot warned) before saving');
const dedupeSrc = grabFunc('_calDedupeByLinearIssue');
ok(/consider\(p, p\.linear_issue_id\)/.test(dedupeSrc) && /consider\(p, p\.graphic_linear_issue_id\)/.test(dedupeSrc),
   '_calDedupeByLinearIssue dedupes BOTH the video and graphic slots');
const showSrc = grabFunc('_calShowLinkConflict');
ok(/Move it here/.test(showSrc) && /Cancel/.test(showSrc) && /already linked to/.test(showSrc),
   '_calShowLinkConflict renders the Move/Cancel prompt copy');
const moveSrc = grabFunc('_calMoveLink');
ok(/async function _calMoveLink/.test(moveSrc), '_calMoveLink is async');
ok(/await _calFlushCardSave\(oldPid\)/.test(moveSrc), '_calMoveLink AWAITS the old-card clear');
ok(moveSrc.indexOf('await _calFlushCardSave(oldPid)') < moveSrc.indexOf('newFld] = val'),
   '_calMoveLink awaits the clear BEFORE setting the new card (dup-guard ordering)');
ok(!/Link anyway/i.test(INDEX), 'no "Link anyway" escape hatch was added');
ok(/\.cal-link-conflict\s*\{/.test(INDEX), 'the conflict-prompt CSS is present');
// the empty→sentinel translation in the save funnel (so a clear actually clears)
const flushSrc = grabFunc('_calFlushCardSave');
ok(/CAL_CLEAR_LINK_SENTINEL/.test(flushSrc) && /'linear_issue_id', 'graphic_linear_issue_id'/.test(flushSrc),
   '_calFlushCardSave translates an emptied link patch to the __CLEAR_LINK__ sentinel');
ok(/const CAL_CLEAR_LINK_SENTINEL = '__CLEAR_LINK__';/.test(INDEX), 'the clear sentinel constant is defined');

console.log(`\ncalendar-linear-link-move: ${pass} passed, ${fail} failed  ${fail ? '❌' : '✅'}`);
process.exit(fail ? 1 : 0);
})();
