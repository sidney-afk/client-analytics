'use strict';
/*
 * "Nothing waiting on SMM approval right now" — over a card that was waiting.
 *
 * Found by the unknowable-assertion sweep, 2026-08-31, and reproduced to the
 * single row on live data.
 *
 * `_calReviewItems` runs `if (!_calHasMedia(p)) return false;` BEFORE the
 * awaiting-approval test, and `_calApprovalBadgeCount` repeats the same skip —
 * so the badge agrees with the wrong list. A post whose component sits at
 * "For SMM Approval" with no video and no thumbnail yet is dropped from both,
 * and the queue then prints its empty state.
 *
 * Measured over 695 non-archived posts: 11 have a component at For SMM
 * Approval, and exactly 1 is hidden this way. That one is a live client's
 * ONLY awaiting card, scheduled for the next working day. For that client the
 * queue was 100% wrong and the badge said zero.
 *
 * THE GATE IS CORRECT AND STAYS. `_calReviewCardHtml` is built around media;
 * admitting the card would render a review card offering Approve and Request
 * changes on something there is nothing to look at. What was wrong is the
 * SILENCE — an absence claim about work that exists and is waiting.
 *
 * THE BADGE DELIBERATELY DOES NOT COUNT THEM, which looks like an oversight and
 * is not. The badge means "items you can review" and a reader checks it against
 * the list length; counting unrenderable cards would make the two disagree and
 * quietly change the badge into "items needing attention". The notice carries
 * its own count instead. This file pins that decision so it is not "fixed"
 * later by someone reading only the symptom.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
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
  throw new Error('unbalanced braces: ' + name);
}

/* The two functions under test, executed against a controlled roster. The
   dependencies are stubbed to the exact shapes the real ones return, so the
   behaviour under test is the FILTER, not the status vocabulary. */
function build(posts) {
  const ctx = {
    calState: { posts },
    _calReviewMode: () => 'smm',
    _calNormStatus: v => String(v || ''),
    _calIsYouTubeCard: () => false,
    _calHasMedia: p => !!(String(p.asset_url || '').trim() || String(p.thumbnail_url || '').trim()),
    _calComponentsFor: () => ['video', 'graphic'],
    _calReviewComponentActive: (p, c) => String(p[c + '_status'] || '') === 'For SMM Approval',
    _calEsc: v => String(v),
  };
  vm.createContext(ctx);
  vm.runInContext(
    grabFunc('_calReviewStrandedForMedia') + '\n'
    + grabFunc('_calReviewStrandedNoticeHtml') + '\n'
    + 'this.stranded = _calReviewStrandedForMedia; this.notice = _calReviewStrandedNoticeHtml;',
    ctx,
  );
  return ctx;
}

/* ---- 1. The live shape that produced the finding ------------------------ */
{
  const ctx = build([
    { id: 'p1', name: 'Video 1', status: 'In Progress', video_status: 'For SMM Approval', asset_url: '', thumbnail_url: '' },
  ]);
  ok(ctx.stranded().length === 1,
    'a post at For SMM Approval with no media is counted as stranded, not forgotten');
  const html = ctx.notice();
  ok(/1 post is waiting on SMM approval/.test(html),
    'the notice says one post is waiting');
  ok(/no video or thumbnail has landed/.test(html),
    '...and why it cannot be reviewed here, which is the actionable half');
  ok(/Video 1/.test(html),
    '...and names it, so the reader can go find it');
}

/* ---- 2. What must NOT be counted ---------------------------------------- */
{
  const ctx = build([
    // Has media: it is IN the queue, so it is not stranded.
    { id: 'p2', name: 'Has media', status: 'In Progress', video_status: 'For SMM Approval', asset_url: 'https://x/v' },
    // Not awaiting SMM at all.
    { id: 'p3', name: 'Not waiting', status: 'In Progress', video_status: 'In Progress', asset_url: '' },
    // Terminal: approved work is nobody's queue.
    { id: 'p4', name: 'Approved', status: 'Approved', video_status: 'For SMM Approval', asset_url: '' },
    { id: 'p5', name: 'Posted', status: 'Posted', video_status: 'For SMM Approval', asset_url: '' },
  ]);
  ok(ctx.stranded().length === 0,
    'a card with media, a card not awaiting SMM, and terminal cards are all excluded');
  ok(ctx.notice() === '',
    'and with nothing stranded the notice is absent entirely -- a banner with nothing to report is its own lie');
}

/* ---- 3. Plural, and the overflow tail ----------------------------------- */
{
  const posts = Array.from({ length: 6 }, (_, i) => ({
    id: 'q' + i, name: 'Post ' + i, status: 'In Progress', video_status: 'For SMM Approval', asset_url: '', thumbnail_url: '',
  }));
  const html = build(posts).notice();
  ok(/6 posts are waiting/.test(html), 'six reads as six, in the plural');
  ok(/and 2 more/.test(html), 'and the name list is capped with an honest tail rather than running long');
}

/* ---- 4. The queue and the badge ----------------------------------------- */

const render = grabFunc('renderCalReview');
ok(/const stranded = _calReviewStrandedNoticeHtml\(\);/.test(render),
  'the queue asks for the notice');
ok((render.match(/\$\{stranded\}/g) || []).length === 2,
  'and renders it in BOTH states -- a non-empty queue quietly missing a card is the same lie as an empty one');
ok(/stranded\s*\n?\s*\? 'Nothing can be reviewed here right now\.'/.test(render),
  'the empty-state sentence changes when work IS waiting, so it stops claiming nothing is');
ok(/Nothing waiting on SMM approval right now/.test(render),
  '...while the genuinely-empty case keeps the original sentence, which is true for it');

const badge = grabFunc('_calApprovalBadgeCount');
ok(/if \(mode === 'smm' && !_calHasMedia\(p\)\) return n;/.test(badge),
  'the badge still counts only reviewable items');
ok(/items you can review/.test(badge) && /_calReviewStrandedNoticeHtml/.test(badge),
  '...and says on the record WHY it does not count stranded work, so the next reader does not "fix" it '
  + 'into disagreeing with the list it sits next to');

console.log(failures === 0
  ? '\nSMM stranded-review checks passed'
  : '\n' + failures + ' stranded-review check(s) failed');
process.exit(failures === 0 ? 0 : 1);
