'use strict';
/*
 * The samples SMM queue silently dropped a card that was waiting on approval.
 *
 * Found 2026-08-31 during a post-flip audit, and it is the SECOND time this
 * exact gate was missed on this exact surface.
 *
 * `_sxrReviewItems` drops a sample with no media BEFORE it tests whether the
 * sample is awaiting approval, and `_sxrApprovalBadgeCount` repeats the same
 * skip — so the badge agrees with the wrong list. A sample sitting at "For SMM
 * Approval" with no `asset_url` and no `thumbnail_url` therefore vanished from
 * the queue the SMM works from, beneath an empty state that said nothing was
 * waiting.
 *
 * The CALENDAR had precisely this and it was repaired on 2026-08-31 (item 87.3,
 * PR #1185): a counted "stranded" notice above the queue, with the media gate
 * itself deliberately unchanged. `OPEN_REPAIRS.md:6017` said at the time:
 *
 *     "Whatever is done here must also be checked against the Samples twin,
 *      which has the identical pair at _sxrApprovalBadgeCount — fixing one
 *      surface and not its sibling is how this gate got missed the first time."
 *
 * It was missed the second time too. This file exists so there is not a third.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. The media gate stays. `_sxrReviewCardHtml`
 * is built around a video or a thumbnail; admitting a card with neither would
 * render approve and request-change controls over a deliverable that does not
 * exist. And the BADGE keeps counting reviewable items only — counting stranded
 * cards would change its meaning from "items to review" to "items needing
 * attention" and make it disagree with the list length. The notice carries its
 * own count instead. Both are the shape the owner ratified on the calendar.
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

/* Comment-aware: index.html comments are prose full of apostrophes and braces,
   which a quote-only matcher misreads as code. */
function grabFunc(signature) {
  const start = INDEX.indexOf(signature);
  if (start < 0) throw new Error('not found: ' + signature);
  let depth = 0, quote = '', comment = '', escaped = false;
  for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
    const c = INDEX[i], n = INDEX[i + 1];
    if (comment === 'line') { if (c === '\n') comment = ''; continue; }
    if (comment === 'block') { if (c === '*' && n === '/') { comment = ''; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return INDEX.slice(start, i + 1);
  }
  throw new Error('unclosed: ' + signature);
}

/* ---- 1. Executed: the notice sees exactly the stranded cards ------------ */

const ctx = {
  sxrState: { posts: [] },
  SXR_REVIEW_COMPONENTS: ['video', 'graphic'],
  _sxrReviewMode: () => 'smm',
  _sxrNormStatus: v => String(v || '').trim(),
  _sxrHasMedia: p => !!(String(p.asset_url || '').trim() || String(p.thumbnail_url || '').trim()),
  _sxrReviewComponentActive: (p, c, mode) =>
    String(p[c + '_status'] || '').trim() === 'For SMM Approval' && mode === 'smm',
  _sxrEsc: v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};
vm.createContext(ctx);
vm.runInContext([
  grabFunc('function _sxrReviewStrandedForMedia('),
  grabFunc('function _sxrReviewStrandedNoticeHtml('),
  'this.stranded = _sxrReviewStrandedForMedia; this.notice = _sxrReviewStrandedNoticeHtml;',
].join('\n'), ctx);

const awaitingNoMedia = { id: 'p1', name: 'Video 1', status: 'In Progress', video_status: 'For SMM Approval' };
const awaitingWithMedia = { id: 'p2', name: 'Video 2', status: 'In Progress', video_status: 'For SMM Approval', asset_url: 'https://f.io/x' };
const notAwaiting = { id: 'p3', name: 'Video 3', status: 'In Progress', video_status: 'In Progress' };
const approvedCard = { id: 'p4', name: 'Video 4', status: 'Approved', video_status: 'For SMM Approval' };

ctx.sxrState.posts = [awaitingNoMedia, awaitingWithMedia, notAwaiting, approvedCard];
const found = ctx.stranded();
ok(found.length === 1 && found[0].id === 'p1',
  'THE BUG: exactly the card awaiting SMM approval with no media is identified — it was previously dropped with no trace');
ok(!found.some(p => p.id === 'p2'),
  'a card that HAS media is not stranded — it is in the queue where it belongs');
ok(!found.some(p => p.id === 'p3'),
  'a card that is not awaiting approval is not stranded — it is simply not due');
ok(!found.some(p => p.id === 'p4'),
  'and an already-approved card is not stranded, matching the queue rule it mirrors');

const notice = ctx.notice();
ok(/1 sample is waiting on SMM approval/.test(notice),
  'the notice says how many and uses the singular for one');
ok(/Video 1/.test(notice),
  'and names the card, so the reader can go and find it');
ok(/cal-review-stranded/.test(notice),
  'reusing the calendar notice style rather than inventing a second look for the same idea');

ctx.sxrState.posts = [awaitingWithMedia, notAwaiting];
ok(ctx.notice() === '',
  'and there is NO notice when nothing is stranded — this must not become permanent furniture');

/* Plural and truncation, executed. */
ctx.sxrState.posts = Array.from({ length: 6 }, (_, i) => ({
  id: 'x' + i, name: 'Sample ' + i, status: 'In Progress', video_status: 'For SMM Approval',
}));
const many = ctx.notice();
ok(/6 samples are waiting/.test(many), 'six stranded cards read as plural');
ok(/and 2 more/.test(many), 'and the list is truncated after four rather than becoming a wall');

/* The client mode has no media gate, so it can have nothing to strand. */
ctx._sxrReviewMode = () => 'client';
ctx.sxrState.posts = [awaitingNoMedia];
ok(ctx.stranded().length === 0,
  'the client queue reports nothing stranded — its own filter never applied the media gate');

/* ---- 2. Rendered in BOTH queue states ---------------------------------- */

const render = grabFunc('function renderSxrReview(');
ok(/const stranded = _sxrReviewStrandedNoticeHtml\(\);/.test(render),
  'the renderer computes the notice once');
const emptyArm = render.slice(render.indexOf('if (!items.length)'), render.indexOf('return `<div class="cal-review-wrap">${stranded}<div class="cal-review-list">'));
ok(/\$\{stranded\}<div class="cal-empty">/.test(emptyArm),
  'it renders above an EMPTY queue — the case that made this necessary');
ok(/\$\{stranded\}<div class="cal-review-list">/.test(render),
  'and above a NON-EMPTY queue — a queue quietly missing a card is the same lie, just harder to see');
ok(/Nothing can be reviewed here right now\./.test(render),
  'and the empty-state copy stops claiming nothing is waiting when something is');

/* ---- 3. What must NOT have changed -------------------------------------- */

const items = grabFunc('function _sxrReviewItems(');
ok(/if \(!_sxrHasMedia\(p\)\) return false;/.test(items),
  'the media gate is UNCHANGED — the review card is built around a video or thumbnail, and admitting a card with neither would offer approve and request-change over a deliverable that does not exist');

const badge = grabFunc('function _sxrApprovalBadgeCount(');
ok(/!_sxrHasMedia\(p\)\) return n;/.test(badge),
  'and the badge still counts REVIEWABLE items only — counting stranded cards would change its meaning to "needs attention" and make it disagree with the list length');

/* ---- 4. The twin actually matches its sibling --------------------------- */
/* The whole failure mode here is one surface drifting from the other, so the
   test asserts the pair exists rather than only that samples has something. */

['_calReviewStrandedForMedia', '_calReviewStrandedNoticeHtml'].forEach(fn => {
  ok(INDEX.includes('function ' + fn + '('), 'the calendar still has ' + fn);
});
['_sxrReviewStrandedForMedia', '_sxrReviewStrandedNoticeHtml'].forEach(fn => {
  ok(INDEX.includes('function ' + fn + '('), 'and samples now has its twin ' + fn);
});

console.log(failures === 0
  ? '\nsamples stranded-media checks passed'
  : '\n' + failures + ' samples stranded-media check(s) failed');
process.exit(failures === 0 ? 0 : 1);
