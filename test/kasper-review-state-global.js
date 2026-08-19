'use strict';
/*
 * Kasper review state is GLOBAL (cross-device) and refresh-proof — regression test.
 *
 * Run:  node test/kasper-review-state-global.js   (exit 0 = all good)
 *
 * Extracts the REAL predicates from ../index.html (by name, brace-balanced —
 * robust to line shifts) so we test the ACTUAL shipping code, not a paraphrase.
 *
 * BACKGROUND. Kasper's "Finish reviewing" (hand-off) and "X-close" used to live
 * only in his browser's localStorage, so clicking Finish on his device never
 * reached anyone else's, and a stale-flag bug bounced finished cards back into
 * "Waiting" on refresh. The fix makes both GLOBAL via persisted timestamps on
 * the card — `kasper_finished_at` / `kasper_closed_at` — that ride the upsert
 * echo + Supabase realtime to every device (like `kasper_approved_at`). The old
 * per-browser flags are kept ONLY as a same-device fallback so behaviour is
 * unchanged until the backend columns are switched on (see
 * docs/features/KASPER_REVIEW_GLOBAL_ROLLOUT.md), then it becomes global automatically.
 *
 * This harness asserts:
 *   • GLOBAL: a card carrying kasper_finished_at reads as finished on a device
 *     with EMPTY localStorage (i.e. cross-device) — the whole point of the fix;
 *   • the unlinked-thumbnail gate still holds (a graphic at "Kasper Approval"
 *     with no GRA sub-issue must NOT un-finish the card on refresh);
 *   • a genuine fresh ask — a component re-sent to Kasper Approval — returns the
 *     card to "Waiting"; a later message (SMM reply OR client tweak) does NOT
 *     re-surface a finished card (product rule: it stays in "Tweaks pending");
 *   • the same-device localStorage fallback still works pre-backend;
 *   • X-close behaves the same way via kasper_closed_at;
 *   • the write paths actually persist the stamps (not just local state).
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract a top-level `function NAME(...) { ... }` by brace-balancing — robust
// to line shifts, so this stays valid as a regression test after edits.
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
// Extract a single-line `const NAME = ...;` declaration.
function grabConst(name) {
  const re = new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm');
  const m = INDEX.match(re);
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

// Stubs for the globals the predicates reach outside the extracted set: the
// in-memory fallback maps and the per-card local "last seen message" stamp.
const HARNESS = `
let _kasperState = { dismissed: {}, closed: {} };
let _seenMap = {};
function _kasperGetSeenAt(pid){ return _seenMap[pid] || ''; }
function _calPostPlatforms(){ return []; }   // test posts aren't YouTube → _calComponentsFor = base 3
`;

const REAL = [
  grabConst('CAL_STATUSES'),
  grabConst('CAL_COMPONENTS'),
  grabConst('CAL_REVIEW_COMPONENTS'),
  grabFunc('_calIsYouTubeCard'),
  grabFunc('_calTitleEngaged'),
  grabFunc('_calComponentsFor'),
  grabFunc('_calNormStatus'),
  grabFunc('_calCommentsFor'),
  grabFunc('_calLatestMsgAt'),
  grabFunc('_calLatestMsgCreatedAt'),
  grabFunc('_calCompLinked'),
  grabFunc('_kasperUndecidedComps'),
  grabFunc('_kasperFinishedAt'),
  grabFunc('_kasperIsFinished'),
  grabFunc('_kasperIsClosed'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL +
  ';return { _kasperIsFinished, _kasperIsClosed, _kasperState, _seenMap };')();
const { _kasperIsFinished, _kasperIsClosed } = mod;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}
function resetState() {
  mod._kasperState.dismissed = {}; mod._kasperState.closed = {};
  for (const k of Object.keys(mod._seenMap)) delete mod._seenMap[k];
}

function tweak(id, at) {
  return { id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true,
           audience: 'internal', body: 'fix this', created_at: at, updated_at: at, done: false, deleted: false };
}
function reply(id, at) {
  return { id, parent_id: null, author: 'SMM', role: 'smm', is_tweak: false,
           audience: 'internal', body: 'done', created_at: at, updated_at: at, done: false, deleted: false };
}
// A tweak CREATED at `createdAt` then RESOLVED (marked done) at `resolvedAt`:
// created_at stays put while updated_at jumps to the resolution time. This is the
// exact shape behind the bug — resolving must not read as a brand-new message.
function resolvedTweak(id, createdAt, resolvedAt) {
  return { id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true,
           audience: 'internal', body: 'fix this', created_at: createdAt, updated_at: resolvedAt,
           done: true, done_at: resolvedAt, done_by: 'SMM', deleted: false };
}
function buildPost(o) {
  return Object.assign({
    id: o.id,
    video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    graphic_linear_issue_id: '', kasper_finished_at: '', kasper_closed_at: '',
    video_comments: [], graphic_comments: [], caption_comments: [],
  }, o);
}
const T = {
  tweak:   '2026-06-16T10:00:00.000Z',
  later:   '2026-06-16T12:00:00.000Z',
  earlier: '2026-06-16T08:00:00.000Z',
};

console.log('— GLOBAL: kasper_finished_at makes "finished" cross-device (empty localStorage) —');

// G1 — the headline case. Kasper finished on HIS device; this is ANOTHER device
// with empty localStorage. The persisted stamp alone must keep it finished.
resetState();
check('hand-off w/ stamp, no local flag → finished (cross-device)',
  _kasperIsFinished(buildPost({
    id: 'g1', video_status: 'Tweaks Needed', caption_status: 'Client Approval',
    graphic_status: 'Kasper Approval', graphic_linear_issue_id: '',   // unlinked thumbnail
    kasper_finished_at: T.tweak, video_comments: [tweak('g1-v', T.tweak)],
  })), true);

// G2 — PRODUCT RULE: a later message (SMM reply OR client tweak) updates the card
// in place but must NOT re-surface it. Once finished it stays in "Tweaks pending"
// until a component is re-sent to Kasper Approval (G3). The old reply-re-surfaces
// behaviour was the friction — a client tweak kept bouncing finished cards back to
// "Waiting" (e.g. Alli Schaper "Video 12", a client tweak ~20 days after finish).
resetState();
check('stamp + reply after finish → STILL finished (a message does not re-surface)',
  _kasperIsFinished(buildPost({
    id: 'g2', video_status: 'Tweaks Needed', caption_status: 'Client Approval',
    kasper_finished_at: T.tweak,
    video_comments: [tweak('g2-v', T.tweak), reply('g2-r', T.later)],
  })), true);

// G3 — an ACTIONABLE component is back at Kasper Approval → fresh ask.
resetState();
check('stamp + linked video back at KA → not finished (fresh ask)',
  _kasperIsFinished(buildPost({
    id: 'g3', video_status: 'Kasper Approval', caption_status: 'Client Approval',
    kasper_finished_at: T.tweak, video_comments: [tweak('g3-v', T.tweak)],
  })), false);

// G4 — the unlinked-thumbnail gate: a graphic at KA with no GRA issue is NOT
// actionable, so it must not un-finish the card (the original bug).
resetState();
check('stamp + unlinked graphic stuck at KA → still finished (gate holds)',
  _kasperIsFinished(buildPost({
    id: 'g4', video_status: 'Tweaks Needed', caption_status: 'Client Approval',
    graphic_status: 'Kasper Approval', graphic_linear_issue_id: '',
    kasper_finished_at: T.tweak, video_comments: [tweak('g4-v', T.tweak)],
  })), true);

// G5 — REGRESSION GUARD for the reported bug. Kasper finished (stamp at the
// tweaks' CREATED time). The SMM then moved ONE component tweaks→Client Approval
// by RESOLVING its tweak (mark-done bumps that comment's updated_at to "now"),
// while ANOTHER component is still in Tweaks Needed. A resolution is not a fresh
// ask, so the card must STAY finished ("Tweaks pending"), not bounce to "Waiting".
// Under the old updated_at basis this returned false (the bug).
resetState();
check('stamp + a tweak RESOLVED after finish (other comp still in tweaks) → still finished',
  _kasperIsFinished(buildPost({
    id: 'g5', video_status: 'Client Approval', graphic_status: 'Tweaks Needed',
    graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-9/x',
    kasper_finished_at: T.tweak,
    video_comments:   [resolvedTweak('g5-v', T.tweak, T.later)],   // the resolved one
    graphic_comments: [tweak('g5-g', T.tweak)],                     // still open
  })), true);

console.log('\n— Same-device localStorage fallback (pre-backend, no stamp) —');

// L1 — no stamp yet (column not live); the local flag + seen stamp must still work.
resetState();
mod._kasperState.dismissed['l1'] = true; mod._seenMap['l1'] = T.tweak;
check('local flag, no stamp, no reply → finished (fallback)',
  _kasperIsFinished(buildPost({
    id: 'l1', video_status: 'Tweaks Needed', caption_status: 'Client Approval',
    video_comments: [tweak('l1-v', T.tweak)],
  })), true);

// L2 — same product rule for the local-flag fallback: a later reply does NOT
// un-finish a locally-finished card either.
resetState();
mod._kasperState.dismissed['l2'] = true; mod._seenMap['l2'] = T.tweak;
check('local flag + reply after seen → STILL finished (a message does not re-surface)',
  _kasperIsFinished(buildPost({
    id: 'l2', video_status: 'Tweaks Needed', caption_status: 'Client Approval',
    video_comments: [tweak('l2-v', T.tweak), reply('l2-r', T.later)],
  })), true);

// N1 — neither stamp nor local flag → plain Waiting card.
resetState();
check('no stamp, no local flag → not finished (Waiting)',
  _kasperIsFinished(buildPost({ id: 'n1', video_status: 'Kasper Approval' })), false);

console.log('\n— X-close: global via kasper_closed_at, local fallback —');

resetState();
check('closed stamp, no new message → closed (cross-device)',
  _kasperIsClosed(buildPost({ id: 'c1', kasper_closed_at: T.tweak, video_comments: [tweak('c1-v', T.earlier)] })), true);

resetState();
check('closed stamp + message after close → not closed (re-surfaces)',
  _kasperIsClosed(buildPost({ id: 'c2', kasper_closed_at: T.tweak, video_comments: [reply('c2-r', T.later)] })), false);

// C5 — closing analogue of G5: a RESOLVE after an X-close (updated_at bumped to
// T.later, but the message was CREATED at T.earlier, before the close) must NOT
// un-hide the card. Under the old updated_at basis this re-surfaced (the bug).
resetState();
check('closed stamp + a tweak RESOLVED after close (created before it) → still closed',
  _kasperIsClosed(buildPost({ id: 'c5', kasper_closed_at: T.tweak,
    video_comments: [resolvedTweak('c5-v', T.earlier, T.later)] })), true);

resetState();
mod._kasperState.closed['c3'] = true;
check('no stamp, local closed flag → closed (fallback)',
  _kasperIsClosed(buildPost({ id: 'c3', video_status: 'Kasper Approval' })), true);

resetState();
check('no stamp, no local flag → not closed',
  _kasperIsClosed(buildPost({ id: 'c4', video_status: 'Kasper Approval' })), false);

console.log('\n— Source-form guards: the write paths persist the stamps globally —');

const dismissSrc = grabFunc('_kasperDismiss');
check('_kasperDismiss sets post.kasper_finished_at',
  /post\.kasper_finished_at\s*=/.test(dismissSrc), true);
check('_kasperDismiss persists the post (not just localStorage)',
  /_kasperPersistPost\s*\(/.test(dismissSrc), true);

const closeSrc = grabFunc('_kasperClose');
check('_kasperClose sets post.kasper_closed_at',
  /\.kasper_closed_at\s*=/.test(closeSrc), true);
check('_kasperClose persists the post',
  /_kasperPersistPost\s*\(/.test(closeSrc), true);

const partSrc = grabFunc('_kasperPartitionItems');
check('_kasperPartitionItems buckets via _kasperIsFinished',
  /_kasperIsFinished\s*\(/.test(partSrc), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll kasper-review-state-global checks passed.');
