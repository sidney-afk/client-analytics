'use strict';
/*
 * Samples realtime STATUS propagation — regression test (P1: "note updates live
 * but the status pill stays stale until a manual refresh").
 *
 * Run:  node test/samples-realtime-status-propagation.js   (exit 0 = all good)
 *
 * THE BUG. On the SMM's Samples view, when Kasper requests a change on a
 * component the realtime sample_reviews event arrives (the note dot updates) but
 * the derived status pill did NOT flip to "Tweaks Needed" until a manual refresh.
 * Root cause: the samples clone diverged from the calendar's LWW+reconcile merge.
 * _sxrMergeServerRows blanket-KEPT the local row for 5 minutes after any local
 * status write (_sxrIsLocalStatusFresh) — folding in the server's new COMMENT
 * (so the note updated) while keeping the stale local STATUS. A genuine newer
 * change from ANOTHER role was swallowed.
 *
 * THE FIX. Port the calendar's _calRecentSaveReconcile: within the local-fresh
 * window, adopt only the sub-statuses the server genuinely moved to a NEW value
 * (differs from BOTH what we wrote and its pre-save base) — a peer's Tweaks-Needed
 * / approval — while still refusing a bare stale Linear round-trip (a status-only
 * regression with no new change-request comment) and a self-echo of our own write.
 *
 * This harness extracts the REAL functions from ../index.html (brace-balanced,
 * survives line shifts), drives _sxrMergeServerRows against a minimal in-memory
 * state, and asserts the status is adopted / kept correctly per role & case.
 * It also asserts the source wires the fix in (merge → reconcile; the realtime
 * shortcut branches → _sxrRepaintLiveStatus → _svPreserveFocus).
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Constants + mutable state the merge/reconcile read (mirrors index.html).
const HARNESS = `
const SXR_COMPONENTS = ['video','graphic'];
const SXR_STATUSES  = ['In Progress','For SMM Approval','Kasper Approval','Client Approval','Tweaks Needed','Approved'];
const SXR_PRIORITY  = { 'Tweaks Needed':0,'In Progress':1,'For SMM Approval':2,'Kasper Approval':3,'Client Approval':4,'Approved':5 };
const SXR_REORDER_GUARD_MS = 12000;
const SXR_LOCAL_STATUS_GRACE_MS = 5 * 60 * 1000;
const _sxrLocalStatusAt = Object.create(null);
const _sxrReorderOptimistic = new Map();
let sxrState = { posts: [] };
let _sxrPendingEdits = Object.create(null);
let _sxrSaveInFlight = Object.create(null);
let _sxrFailedNewCards = new Set();
let _sxrRecentSaveFields = new Map();
`;

const REAL = [
  grabFunc('_sxrNormStatus'),
  grabFunc('computeSampleOverallStatus'),
  grabFunc('_sxrCommentsFor'),
  grabFunc('_sxrSetCommentsFor'),
  grabFunc('_sxrStringifyComments'),
  grabFunc('_sxrCommentStamp'),
  grabFunc('_sxrMergeCommentLists'),
  grabFunc('_sxrMergePostComments'),
  grabFunc('_sxrMsgIsTweak'),
  grabFunc('_sxrMarkLocalStatus'),
  grabFunc('_sxrIsLocalStatusFresh'),
  grabFunc('_sxrIsBlankId'),
  grabFunc('_sxrReconcileHasGenuineTweak'),
  grabFunc('_sxrIsStaleLinearRegress'),
  grabFunc('_sxrRecentSaveReconcile'),
  grabFunc('_sxrMergeServerRows'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL + `
;return {
  set state(v){ sxrState = v; },
  get state(){ return sxrState; },
  reset(){ sxrState = { posts: [] }; _sxrPendingEdits = Object.create(null); _sxrSaveInFlight = Object.create(null); _sxrFailedNewCards = new Set(); _sxrRecentSaveFields = new Map(); for (const k in _sxrLocalStatusAt) delete _sxrLocalStatusAt[k]; },
  markFresh(pid){ _sxrMarkLocalStatus(pid); },
  setRsf(pid, wrote, base){ _sxrRecentSaveFields.set(pid, { wrote, base }); },
  setInFlight(pid){ _sxrSaveInFlight[pid] = true; },
  merge(server){ return _sxrMergeServerRows(server); },
  computeOverall: computeSampleOverallStatus,
};`)();

let failures = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}
function checkTrue(label, ok) { if (!ok) failures++; console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}`); }

const tweak = (id, role) => ({ id, parent_id: null, author: role, role, is_tweak: true, audience: 'internal', body: 'fix this', created_at: '2026-07-07T00:00:00Z', updated_at: '2026-07-07T00:00:00Z', done: false });
const commentIds = (arr) => (arr || []).map(c => c.id).sort();

// ─────────────────────────────────────────────────────────────────────────────
console.log('— 1. THE REPRO: SMM just routed to Kasper, Kasper requests a change —');
// SMM approved For-SMM → Kasper Approval (local, fresh), then Kasper flips it to
// Tweaks Needed WITH a new tweak note. The status MUST adopt; the note MUST fold in.
mod.reset();
const p1 = { id: 'sr_1', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T10:00:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p1] };
mod.markFresh('sr_1');
mod.setRsf('sr_1', { video_status: 'Kasper Approval', graphic_status: 'Approved' }, { video_status: 'For SMM Approval', graphic_status: 'Approved' });
const srv1 = { id: 'sr_1', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed', updated_at: '2026-07-07T10:02:00Z', video_comments: [tweak('k1', 'kasper')], graphic_comments: [] };
let out1 = mod.merge([srv1]);
check('video sub-status flips to Tweaks Needed live (the fix)', out1[0].video_status, 'Tweaks Needed');
check('overall status recomputes to Tweaks Needed', out1[0].status, 'Tweaks Needed');
check("Kasper's new note is folded in (note dot updates too)", commentIds(out1[0].video_comments), ['k1']);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 2. SELF-ECHO must NOT spuriously change anything —');
// Our OWN write echoes back over realtime with the SAME value we set.
mod.reset();
const p2 = { id: 'sr_2', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T10:02:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p2] };
mod.markFresh('sr_2');
mod.setRsf('sr_2', { video_status: 'Kasper Approval', graphic_status: 'Approved' }, { video_status: 'For SMM Approval', graphic_status: 'Approved' });
const srv2 = { id: 'sr_2', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T10:02:03Z', video_comments: [], graphic_comments: [] };
let out2 = mod.merge([srv2]);
check('self-echo keeps our status (no flicker)', out2[0].video_status, 'Kasper Approval');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 3. STALE Linear regress (status-only, no new note) is REFUSED —');
// We approved to Client Approval; a bare Linear round-trip of a drifted issue
// regresses it below with NO change-request comment. Keep our approval.
mod.reset();
const p3 = { id: 'sr_3', video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval', updated_at: '2026-07-07T10:00:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p3] };
mod.markFresh('sr_3');
mod.setRsf('sr_3', { video_status: 'Client Approval', graphic_status: 'Approved' }, { video_status: 'For SMM Approval', graphic_status: 'Approved' });
const srv3 = { id: 'sr_3', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T10:01:00Z', video_comments: [], graphic_comments: [] };
let out3 = mod.merge([srv3]);
check('stale Linear regress refused → keeps Client Approval', out3[0].video_status, 'Client Approval');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 4. GENUINE client change-from-above (Tweaks Needed WITH a note) is ADOPTED —');
// We approved to Client Approval; the CLIENT then requests a change (a real
// Tweaks-Needed always lands a comment). Adopt it even though it regresses.
mod.reset();
const p4 = { id: 'sr_4', video_status: 'Client Approval', graphic_status: 'Approved', status: 'Client Approval', updated_at: '2026-07-07T10:00:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p4] };
mod.markFresh('sr_4');
mod.setRsf('sr_4', { video_status: 'Client Approval', graphic_status: 'Approved' }, { video_status: 'Kasper Approval', graphic_status: 'Approved' });
const srv4 = { id: 'sr_4', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed', updated_at: '2026-07-07T10:01:00Z', video_comments: [tweak('c1', 'client')], graphic_comments: [] };
let out4 = mod.merge([srv4]);
check('genuine client tweak adopted → Tweaks Needed', out4[0].video_status, 'Tweaks Needed');
check("client's note folded in", commentIds(out4[0].video_comments), ['c1']);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 5. In-flight save keeps local (never adopt a pre-change poll) —');
mod.reset();
const p5 = { id: 'sr_5', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed', updated_at: '2026-07-07T10:03:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p5] };
mod.setInFlight('sr_5');
const srv5 = { id: 'sr_5', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T10:02:00Z', video_comments: [], graphic_comments: [] };
let out5 = mod.merge([srv5]);
check('in-flight save keeps optimistic local status', out5[0].video_status, 'Tweaks Needed');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 6. Passive observer (NOT recently touched) still adopts server normally —');
// The general realtime path (no local-fresh guard) must keep working: a peer's
// change is adopted directly.
mod.reset();
const p6 = { id: 'sr_6', video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', updated_at: '2026-07-07T09:00:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p6] };
const srv6 = { id: 'sr_6', video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed', updated_at: '2026-07-07T10:00:00Z', video_comments: [tweak('k9', 'kasper')], graphic_comments: [] };
let out6 = mod.merge([srv6]);
check('un-touched card adopts server status', out6[0].video_status, 'Tweaks Needed');
check('and folds the note in', commentIds(out6[0].video_comments), ['k9']);

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 7. Graphic-component change also propagates (both Linear-backed comps) —');
mod.reset();
const p7 = { id: 'sr_7', video_status: 'Approved', graphic_status: 'Kasper Approval', status: 'Kasper Approval', updated_at: '2026-07-07T10:00:00Z', video_comments: [], graphic_comments: [] };
mod.state = { posts: [p7] };
mod.markFresh('sr_7');
mod.setRsf('sr_7', { video_status: 'Approved', graphic_status: 'Kasper Approval' }, { video_status: 'Approved', graphic_status: 'For SMM Approval' });
const srv7 = { id: 'sr_7', video_status: 'Approved', graphic_status: 'Tweaks Needed', status: 'Tweaks Needed', updated_at: '2026-07-07T10:02:00Z', video_comments: [], graphic_comments: [tweak('k7', 'kasper')] };
let out7 = mod.merge([srv7]);
check('graphic sub-status flips to Tweaks Needed live', out7[0].graphic_status, 'Tweaks Needed');
check('overall recomputes from the worst sub', out7[0].status, 'Tweaks Needed');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n— 8. Source-form: the fix is wired into the merge + realtime branches —');
const mergeSrc = grabFunc('_sxrMergeServerRows');
checkTrue('_sxrMergeServerRows calls _sxrRecentSaveReconcile in the local-fresh path',
  /_sxrRecentSaveReconcile\s*\(/.test(mergeSrc));
checkTrue('_sxrMergeServerRows still guards in-flight / pending edits',
  /_sxrSaveInFlight\[srv\.id\]/.test(mergeSrc) && /_sxrPendingEdits\[srv\.id\]/.test(mergeSrc));
const repaintSrc = grabFunc('_sxrRepaintLiveStatus');
checkTrue('_sxrRepaintLiveStatus repaints via _sxrUpdateCardStatusDisplay',
  /_sxrUpdateCardStatusDisplay\s*\(/.test(repaintSrc));
checkTrue('_sxrRepaintLiveStatus is focus-guarded with _svPreserveFocus (#705)',
  /_svPreserveFocus\s*\(/.test(repaintSrc));
const loadSrc = grabFunc('loadSxrCards');
checkTrue('loadSxrCards no-visible-change branch repaints status live',
  (loadSrc.match(/_sxrRepaintLiveStatus\s*\(/g) || []).length >= 2);
checkTrue('loadSxrCards still refreshes the note dots in both shortcut branches',
  (loadSrc.match(/_sxrRefreshCommentsBtn/g) || []).length >= 2);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll samples realtime status-propagation checks passed.');
