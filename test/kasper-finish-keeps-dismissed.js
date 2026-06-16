'use strict';
/*
 * Kasper "Finish reviewing" must survive a refresh — regression test.
 *
 * Run:  node test/kasper-finish-keeps-dismissed.js   (exit 0 = all good)
 *
 * Extracts the REAL _kasperKeepAfterDismiss + its gate helpers from
 * ../index.html (by name, brace-balanced — robust to line shifts) so we test
 * the ACTUAL shipping code, not a paraphrase.
 *
 * THE BUG: the Kasper queue partitions cards purely on the explicit
 * `dismissed[pid]` flag set by "Finish reviewing" (PR #480). On every refresh
 * _kasperKeepAfterDismiss decides whether to CLEAR that flag — and it cleared
 * it whenever ANY component read "Kasper Approval":
 *
 *     const backToKasper = CAL_COMPONENTS.some(c =>
 *         _calNormStatus(post[c+'_status']||'') === 'Kasper Approval');
 *
 * That raw scan is missing the unlinked-thumbnail gate every other Kasper path
 * applies (_calCompKasperVisible / _kasperUndecidedComps): a graphic slot with
 * no GRA sub-issue can sit at "Kasper Approval" forever — junk status nobody can
 * act on. It does NOT block Finish, so the moment Kasper finishes a hand-off on
 * such a card, the next refresh saw backToKasper === true, deleted the dismissed
 * flag, and the card bounced from "Tweaks pending" back to "Waiting for your
 * review" (so the Tweaks-pending section vanished). Since most cards carry a
 * thumbnail slot without a linked GRA issue, nearly every hand-off bounced back.
 *
 * THE FIX: gate backToKasper exactly like the rest — a fresh ask is an
 * ACTIONABLE component back at Kasper Approval, which is precisely
 * _kasperUndecidedComps(post).length > 0.
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

// Stubs for the two globals _kasperKeepAfterDismiss reaches outside the
// extracted set: the in-memory dismissal map, and the per-card "last seen
// message" timestamp (normally localStorage-backed, cross-refresh).
const HARNESS = `
let _kasperState = { dismissed: {} };
let _seenMap = {};
function _kasperGetSeenAt(pid){ return _seenMap[pid] || ''; }
`;

const REAL = [
  grabConst('CAL_STATUSES'),
  grabConst('CAL_COMPONENTS'),
  grabFunc('_calNormStatus'),
  grabFunc('_calCommentsFor'),
  grabFunc('_calLatestMsgAt'),
  grabFunc('_kasperUndecidedComps'),
  grabFunc('_kasperKeepAfterDismiss'),
].join('\n\n');

const mod = new Function(HARNESS + '\n' + REAL +
  ';return { _kasperKeepAfterDismiss, _kasperState, _seenMap };')();
const { _kasperKeepAfterDismiss } = mod;

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

// A Kasper change-request comment (is_tweak true). _calLatestMsgAt reads
// updated_at || created_at.
function tweak(id, at) {
  return { id, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true,
           audience: 'internal', body: 'fix this', created_at: at, updated_at: at,
           done: false, deleted: false };
}
// A reply that arrives in the thread (e.g. the SMM answering).
function reply(id, at) {
  return { id, parent_id: null, author: 'SMM', role: 'smm', is_tweak: false,
           audience: 'internal', body: 'done', created_at: at, updated_at: at,
           done: false, deleted: false };
}
function buildPost(o) {
  return Object.assign({
    id: o.id,
    video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
    graphic_linear_issue_id: '',
    video_comments: [], graphic_comments: [], caption_comments: [],
  }, o);
}

// Drive one refresh of _kasperKeepAfterDismiss against a freshly-dismissed
// card and report whether the dismissal SURVIVED (true = stays in "Tweaks
// pending"; false = bounced back to "Waiting").
function survivesRefresh(post, seenAt) {
  mod._kasperState.dismissed = { [post.id]: true };
  mod._seenMap[post.id] = seenAt;
  const ret = _kasperKeepAfterDismiss(post);
  if (ret !== true) { failures++; console.log(`✗ FAIL  ${post.id}: _kasperKeepAfterDismiss must always return true (got ${ret})`); }
  return !!mod._kasperState.dismissed[post.id];
}

console.log('— A finished hand-off must STAY in "Tweaks pending" across a refresh —');

// THE BUG CASE: video sent back for a tweak, caption approved, and an UNLINKED
// thumbnail graphic still parked at "Kasper Approval" (no GRA sub-issue). Kasper
// was allowed to Finish (the graphic is gated out of "undecided"), so it must
// NOT drag the card back to Waiting on refresh.
const unlinkedThumb = buildPost({
  id: 'unlinked-thumb',
  video_status: 'Tweaks Needed', caption_status: 'Client Approval',
  graphic_status: 'Kasper Approval', graphic_linear_issue_id: '',
  video_comments: [tweak('t-v', '2026-06-16T10:00:00.000Z')],
});
check('unlinked-thumbnail graphic at KA → stays dismissed',
  survivesRefresh(unlinkedThumb, '2026-06-16T10:00:00.000Z'), true);

// Plain hand-off: tweaks on video + caption, no graphic in play at all.
const plainHandoff = buildPost({
  id: 'plain-handoff',
  video_status: 'Tweaks Needed', caption_status: 'Tweaks Needed', graphic_status: 'Approved',
  video_comments: [tweak('h-v', '2026-06-16T09:00:00.000Z')],
  caption_comments: [tweak('h-c', '2026-06-16T09:30:00.000Z')],
});
check('plain hand-off (no KA component) → stays dismissed',
  survivesRefresh(plainHandoff, '2026-06-16T09:30:00.000Z'), true);

console.log('\n— A genuine fresh ask must un-dismiss (return to "Waiting") —');

// SMM re-routed the VIDEO back to Kasper Approval — a real new request.
const videoBack = buildPost({
  id: 'video-back',
  video_status: 'Kasper Approval', caption_status: 'Client Approval', graphic_status: 'Approved',
  video_comments: [tweak('b-v', '2026-06-16T08:00:00.000Z')],
});
check('linked video back at KA → un-dismissed',
  survivesRefresh(videoBack, '2026-06-16T08:00:00.000Z'), false);

// A LINKED graphic genuinely back at Kasper Approval IS actionable — it should
// bounce back (the contrast that proves the gate, not a blanket "ignore graphic").
const linkedGraphicBack = buildPost({
  id: 'linked-graphic-back',
  video_status: 'Client Approval', caption_status: 'Client Approval',
  graphic_status: 'Kasper Approval', graphic_linear_issue_id: 'GRA-123',
  graphic_comments: [tweak('g-g', '2026-06-16T08:00:00.000Z')],
});
check('linked graphic back at KA → un-dismissed',
  survivesRefresh(linkedGraphicBack, '2026-06-16T08:00:00.000Z'), false);

// The SMM replied in the thread after Kasper finished (latest > seenAt): the
// newReply path must still un-dismiss it. (Guards that the fix didn't break it.)
const newReply = buildPost({
  id: 'new-reply',
  video_status: 'Tweaks Needed', caption_status: 'Client Approval', graphic_status: 'Approved',
  video_comments: [tweak('r-v', '2026-06-16T07:00:00.000Z'), reply('r-r', '2026-06-16T11:00:00.000Z')],
});
check('SMM replied since finish → un-dismissed',
  survivesRefresh(newReply, '2026-06-16T07:00:00.000Z'), false);

console.log('\n— Source-form guard —');
// Belt-and-braces: the shipped function must compute backToKasper through the
// gated helper, not the raw ungated "Kasper Approval" scan that caused the bug.
const src = grabFunc('_kasperKeepAfterDismiss');
check('_kasperKeepAfterDismiss uses the gated _kasperUndecidedComps helper',
  /_kasperUndecidedComps\s*\(\s*post\s*\)/.test(src), true);
check('_kasperKeepAfterDismiss no longer scans component statuses ungated for "Kasper Approval"',
  src.includes("'Kasper Approval'"), false);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll kasper-finish-keeps-dismissed checks passed.');
