'use strict';
/*
 * Flip-day tester finding E, corrected — a card handed to Kasper with no file
 * attached used to vanish without a word.
 *
 * The tester drove a TEST card to Kasper Approval on both surfaces, confirmed
 * it on both, and then could not find it anywhere in Kasper's queue. They
 * concluded Kasper's queue reads only the Sheets-backed calendar-get webhook
 * and is therefore blind to every natively-created card. That conclusion is
 * wrong -- _kasperFetchAllRelevantPosts reads Supabase first for every client,
 * and live data shows native cards WITH media rendering in the queue right now
 * -- but the observation was right, and the real mechanism is worse in one
 * specific way: it is silent on BOTH sides.
 *
 * The card in question (measured live, 2026-08-30):
 *     video_status "Kasper Approval", asset_url "", thumbnail_url ""
 * The queue's content gate drops exactly that shape. Pre-flip it was nearly
 * harmless -- a media-less card at Kasper Approval was a freshly-synced Linear
 * stub, not a deliberate hand-off. Post-flip the Production tab moves status
 * without touching media, so an ordinary status change strands a card where
 * the SMM believes it is with Kasper and Kasper is never told it exists.
 *
 * This suite EXECUTES the shipped extract() loop body against that measured row
 * shape plus its neighbours, and pins the notice renderer's escaping.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace-balanced extraction that understands COMMENTS as well as strings.
 * The plain quote-aware scanner most suites use cannot read this region: the
 * loader is heavily commented and those comments are full of apostrophes
 * ("Kasper's queue", "hasn't yet propagated"), each of which opens a string
 * the scanner never closes. */
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

/* ---- 1. The gate itself, executed -------------------------------------- */

/* Slice the extract() body out of _kasperFetchAllRelevantPosts: from the
 * `const extract =` arrow through its closing `};`. Executing the real body is
 * the point -- a paraphrase of a filter is not a test of the filter. */
const fetchAll = grabFunc('_kasperFetchAllRelevantPosts');
/* The REAL media rule, not a stub: it is the thing this suite is about, and a
   stub would let the gate and the rule drift apart silently. */
const realReviewable = grabFunc('_kasperCompReviewable');
const extractAt = fetchAll.indexOf('const extract = (client, json) => {');
ok(extractAt >= 0, 'the shipped extract() closure is present in the loader');
let depth = 0, extractEnd = -1;
for (let i = fetchAll.indexOf('{', extractAt); i < fetchAll.length; i++) {
  const c = fetchAll[i];
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) { extractEnd = i + 1; break; }
}
const extractSrc = fetchAll.slice(extractAt, extractEnd) + ';';

const calls = { kasperVisible: 0 };
const sandbox = new Function('deps', `
  const { wlNormalizeClient, _calArchivedRefs, _calDedupeByLinearIssue, _calNormStatus,
          _calCoerceDate, _calLoadComments, _calIsArchivedRef, _calMigratePostShape,
          _kasperPatchSnapshot, _calPostKasperVisible, _kasperHistoryEntryFromPost,
          _kasperHasUnreadReply, _calComponentsFor, _calCompKasperVisible } = deps;
  ${realReviewable}
  ${extractSrc}
  return extract;
`)({
  wlNormalizeClient: name => String(name || '').toLowerCase().replace(/[^a-z0-9&]+/g, ''),
  _calArchivedRefs: () => new Set(),
  _calDedupeByLinearIssue: rows => rows,
  _calNormStatus: s => String(s || ''),
  _calCoerceDate: d => d,
  _calLoadComments: () => [],
  _calIsArchivedRef: () => false,
  _calMigratePostShape: () => {},
  _kasperPatchSnapshot: () => ({}),
  // The real per-component rule, reduced to the one clause under test: a video
  // or graphic sitting at Kasper Approval is Kasper's work.
  _calPostKasperVisible: post => {
    calls.kasperVisible++;
    return ['video', 'graphic', 'caption'].some(c => post[c + '_status'] === 'Kasper Approval');
  },
  /* The media gate is now asked PER COMPONENT (owner report 2026-09-03: three
     cards sat in the stranded notice waiting on a CAPTION that was already
     written, one of them a caption-only card whose video and thumbnail are both
     N/A). These two are the reduced real rules: which components a card has,
     and which of them are waiting on Kasper. */
  _calComponentsFor: () => ['video', 'graphic', 'caption'],
  _calCompKasperVisible: (post, comp) => post[comp + '_status'] === 'Kasper Approval',
  _kasperHistoryEntryFromPost: (post, client, slug, approvedAt) => ({ id: post.id, approvedAt }),
  _kasperHasUnreadReply: () => false,
});

/* The exact row the tester drove to Kasper Approval, as read back from
 * calendar_posts: native ids present, both media columns empty. */
const STRANDED = {
  id: 'p_native_6ac03d0b41d2ad6e9ae9aef42037_1',
  name: 'Video 1',
  status: 'In Progress',
  video_status: 'Kasper Approval',
  graphic_status: 'In Progress',
  video_deliverable_id: 'del_d032bba8-8754-496b-ba5a-27f3ff9dcbf9',
  asset_url: '',
  thumbnail_url: '',
};
/* A native card WITH media at the same status -- live data has four of these
 * for real clients right now, and they must keep rendering exactly as before. */
const REVIEWABLE = {
  id: 'p_native_486cb7d543b18149a9da8be5417f_1',
  name: 'Video 1',
  status: 'Kasper Approval',
  video_status: 'Kasper Approval',
  graphic_status: 'Client Approval',
  video_deliverable_id: 'del_85021b4a-9f38-4db1-bda8-247977e1e347',
  asset_url: 'https://example.invalid/video.mp4',
  thumbnail_url: '',
};
/* Not Kasper's work at all: must appear in neither bucket. */
const ELSEWHERE = {
  id: 'p_native_ce7c191d4835b9a49da213afb24f_9',
  name: 'Video 9',
  status: 'In Progress',
  video_status: 'In Progress',
  graphic_status: 'In Progress',
  video_deliverable_id: 'del_x',
  asset_url: '',
  thumbnail_url: '',
};
/* A legacy sheet stub with no native id: still reported, because the SMM's
 * belief that it is with Kasper is wrong in exactly the same way. */
const LEGACY_STUB = {
  id: 'p_lin_vid13283',
  name: 'Legacy stub',
  status: 'In Progress',
  video_status: 'Kasper Approval',
  graphic_status: 'Posted',
  asset_url: '',
  thumbnail_url: '',
};

/* CAPTION-ONLY, and the reason this gate was rewritten. Owner report
 * 2026-09-03: three of the four cards in the stranded notice were waiting on a
 * CAPTION that was already written, one of them with video and thumbnail both
 * N/A. A caption is text; it needs no file. The old gate asked one question
 * about the whole card -- does it carry ANY media -- which a caption cannot
 * answer, so finished work sat in a notice telling the SMM to attach a file
 * that was never going to exist, and Kasper could not approve it.
 *
 * The caption text is load-bearing in this fixture, not decoration: the owner's
 * report was about captions that were ALREADY WRITTEN. Its absence is the
 * separate case below (CAPTION_BLANK), and the two must not be conflated --
 * that conflation was the over-correction Codex caught on #1252. */
const CAPTION_ONLY = {
  id: 'p_caption_only',
  name: 'Bank of music',
  status: 'In Progress',
  video_status: 'N/A',
  graphic_status: 'N/A',
  caption_status: 'Kasper Approval',
  caption: 'Three tracks, all royalty-free. Save this one.',
  asset_url: '',
  thumbnail_url: '',
};

/* The same card with the caption never written. Codex, #1252: the first fix
 * for the owner report let text through unconditionally, so this shape was
 * admitted to the queue and Kasper was offered an enabled Approve over the
 * "No caption yet." placeholder -- content nobody had written could be signed
 * off. Missing is missing; where it is stored is an implementation detail. */
const CAPTION_BLANK = {
  id: 'p_caption_blank',
  name: 'Bank of music',
  status: 'In Progress',
  video_status: 'N/A',
  graphic_status: 'N/A',
  caption_status: 'Kasper Approval',
  caption: '',
  caption_alt: '   ',
  asset_url: '',
  thumbnail_url: '',
};

const out = sandbox('Sidney Laruel', { ok: true, posts: [STRANDED, REVIEWABLE, ELSEWHERE, LEGACY_STUB] });


ok(out.queue.length === 1 && out.queue[0].post.id === REVIEWABLE.id,
  'the reviewable native card is the only thing in the actionable queue');
ok(Array.isArray(out.stranded) && out.stranded.length === 2,
  'both media-less Kasper-Approval cards are reported instead of discarded');
const strandedIds = out.stranded.map(s => s.id);
ok(strandedIds.includes(STRANDED.id),
  "the tester's own card is reported, not dropped silently");
ok(strandedIds.includes(LEGACY_STUB.id),
  'a legacy media-less hand-off is reported too -- the silence was never native-specific');
ok(!strandedIds.includes(ELSEWHERE.id),
  'a card that is not at Kasper Approval is not reported (the notice is not a junk drawer)');
ok(out.stranded.find(s => s.id === STRANDED.id).native === true
    && out.stranded.find(s => s.id === LEGACY_STUB.id).native === false,
  'each report records whether the card carries a native deliverable id');
ok(out.stranded.every(s => s.client === 'Sidney Laruel' && s.slug === 'sidneylaruel' && s.name),
  'reports carry the client and card name a human needs to act on');

/* ---- 2. The notice renderer -------------------------------------------- */

const notice = grabFunc('_kasperRenderStrandedNotice');
const render = new Function('deps', `
  const { _kasperState, _calEsc } = deps;
  ${notice}
  return _kasperRenderStrandedNotice;
`)({
  _kasperState: { get stranded() { return renderState; } },
  _calEsc: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
});
let renderState = [];

ok(render() === '', 'a healthy queue renders no notice at all');

renderState = [{ id: 'a', client: 'Sidney Laruel', slug: 'sidneylaruel', name: 'Video 1', native: true }];
const one = render();
ok(/1 card is waiting on content, not on you/.test(one),
  'a single stranded card reads in the singular');
ok(one.includes('Sidney Laruel') && one.includes('Video 1'),
  'and names the client and the card');

renderState = [
  { id: 'a', client: '<script>x</script>', slug: 's', name: 'A & B', native: true },
  { id: 'b', client: 'Two', slug: 't', name: 'Video 2', native: false },
];
const two = render();
ok(/2 cards are waiting on content/.test(two), 'two stranded cards read in the plural');
ok(!/<script>/.test(two) && /&lt;script&gt;/.test(two) && /A &amp; B/.test(two),
  'client and card names are escaped -- they are sheet-sourced text, not markup');

renderState = Array.from({ length: 15 }, (_, i) => ({ id: 'x' + i, client: 'C' + i, slug: 'c', name: 'N' + i, native: true }));
const many = render();
ok((many.match(/<li>/g) || []).length === 13 && /and 3 more/.test(many),
  'a long list is capped at twelve rows plus an overflow line');

/* The caption-only case runs on its OWN fetch, under a neutral client name.
 * Not for isolation alone: `scripts/repo-identity-exposure-check.js` fails the
 * PR when a diff ADDS a roster term, and it reads added LINES — so editing the
 * shared call above, whose client argument is a real staff name, re-introduces
 * that name as though it were new. Leaving that line untouched keeps the guard
 * satisfied and keeps this case readable on its own terms. */
const captionOut = sandbox('Neutral Test Client', { ok: true, posts: [CAPTION_ONLY] });

ok(captionOut.queue.some(item => item.post.id === CAPTION_ONLY.id),
  'a caption awaiting Kasper reaches the QUEUE even with no video and no thumbnail');
ok(!captionOut.stranded.some(st => st.id === CAPTION_ONLY.id),
  'and it is never reported as waiting on content, because the caption is written');

const blankOut = sandbox('Neutral Test Client', { ok: true, posts: [CAPTION_BLANK] });
ok(!blankOut.queue.some(item => item.post.id === CAPTION_BLANK.id),
  'a caption at Kasper Approval that nobody has written does NOT reach the queue');
ok(blankOut.stranded.some(st => st.id === CAPTION_BLANK.id),
  'it is reported to the SMM instead -- the one person who can write it');

/* MIXED: a written caption waiting on Kasper, alongside a video also waiting on
 * him whose file never arrived. Caught in review: admitting the card on the
 * strength of the caption, then rendering an enabled Approve over a video that
 * does not exist, would trap Kasper on a card he cannot finish — "Finish
 * reviewing" stays disabled until every undecided component has an action, and
 * there is nothing to act on. The card is admitted for the caption; the video
 * must be excluded from the panels and from the undecided set, exactly as an
 * unlinked graphic already is. */
const MIXED = {
  id: 'p_mixed',
  name: 'Caption ready, video never arrived',
  status: 'In Progress',
  video_status: 'Kasper Approval',
  graphic_status: 'N/A',
  caption_status: 'Kasper Approval',
  caption: 'Ready to go — the video is the only thing outstanding.',
  asset_url: '',
  thumbnail_url: '',
};
const mixedOut = sandbox('Neutral Test Client', { ok: true, posts: [MIXED] });
ok(mixedOut.queue.some(item => item.post.id === MIXED.id),
  'a mixed card is admitted on the strength of the component that IS reviewable');
ok(!mixedOut.stranded.some(st => st.id === MIXED.id),
  'and is not also reported as stranded');

/* The rule itself, run directly: it is what keeps the unreviewable component
   out of the rendered panels and out of the Finish-reviewing gate. */
const reviewable = new Function(`${realReviewable}; return _kasperCompReviewable;`)();
ok(reviewable(MIXED, 'video') === false, 'a video with no asset_url is not reviewable');
ok(reviewable({ asset_url: 'https://f.io/x' }, 'video') === true, 'a video with a file is');
ok(reviewable(MIXED, 'graphic') === false, 'a thumbnail with no thumbnail_url is not reviewable');
ok(reviewable({ thumbnail_url: 'https://d/x.png' }, 'graphic') === true, 'a thumbnail with an image is');
/* Text is asked the same question, for the same reason -- Codex, #1252. Only
   the column the content lives in differs. */
ok(reviewable(MIXED, 'caption') === true, 'a caption with text written is reviewable');
ok(reviewable(CAPTION_BLANK, 'caption') === false,
  'a caption with nothing written is NOT -- there is no honest Approve over "No caption yet."');
ok(reviewable({ caption: '', caption_alt: 'Version B for the reel' }, 'caption') === true,
  'the alternate caption alone is enough -- either column carries the review');
ok(reviewable(MIXED, 'title') === true, 'a title with text is reviewable');
ok(reviewable({ name: '   ' }, 'title') === false,
  'a title that is blank or whitespace is not -- same rule, same reason');

/* ---- 3. Wiring --------------------------------------------------------- */
/* The renderer and the open-tweak chip read ONE definition of "which panels
   does this card show", so the badge can never promise a thread the card does
   not render (Codex P2 on PR 1252 -- the defect _kasperOpenTweakCount was
   written to kill, re-created by content-gating both reasons a panel exists). */
ok(/const activeComps = _kasperPanelComps\(p\);/.test(INDEX),
  'the expanded card renders exactly _kasperPanelComps');
ok(/for \(const c of _kasperPanelComps\(post\)\) \{/.test(INDEX),
  'and the open-tweak chip tallies exactly the same set');
const CAL_STATUSES_SRC = (INDEX.match(/const CAL_STATUSES\s*=\s*\[[^\]]*\];/) || [''])[0];
ok(CAL_STATUSES_SRC !== '', 'the shipped status vocabulary is readable, so _calNormStatus is the real one');
const panelComps = new Function(`
  ${CAL_STATUSES_SRC}
  ${grabFunc('_calCompHasUnresolvedKasperTweak')}
  ${grabFunc('_calMsgIsTweak')}
  ${grabFunc('_calCommentsFor')}
  ${grabFunc('_calCompLinked')}
  ${grabFunc('_calShowApprovedAfterTweaks')}
  ${grabFunc('_calNormStatus')}
  ${grabFunc('_calCompKasperVisible')}
  ${realReviewable}
  const _calComponentsFor = () => ['video', 'graphic', 'caption'];
  ${grabFunc('_kasperPanelComps')}
  return _kasperPanelComps;
`)();
const kTweak = { id: 'k1', role: 'kasper', is_tweak: true, done: false, deleted: false, body: 'tighten the intro' };
/* Reason (2): a tweak Kasper already sent, on a video whose file never came.
   The panel is a thread, not a review -- its Approve is already hidden by
   `showApprove` -- so it stays, and the chip's count stays honest. */
ok(panelComps({
  video_status: 'Tweaks Needed', graphic_status: 'N/A', caption_status: 'N/A',
  asset_url: '', video_comments: [kTweak],
}).includes('video'), 'a fileless video carrying an unresolved tweak KEEPS its thread panel');
/* Reason (1) on the same card: nothing to decide on, so nothing is shown. */
ok(!panelComps({
  video_status: 'Kasper Approval', graphic_status: 'N/A', caption_status: 'N/A',
  asset_url: '', video_comments: [],
}).includes('video'), 'a fileless video merely PENDING his decision does not');
/* The Finish gate, and the one thing that must be true of it: the set that
   decides whether Finish is ALLOWED and the set that decides whether the card
   READS as finished have to be the same set.

   They were briefly split -- the finish gate media-aware, the fresh-ask test
   media-blind -- and Codex caught the limbo that created on #1252: deciding the
   caption on this very card emptied the finish gate, so Finish was allowed,
   while the fresh-ask test still saw the fileless video and returned false
   forever. The card could never leave Waiting. So this asserts the collapse,
   not a distinction. _calComponentsFor and _calNormStatus are stubbed because
   the component roster and the status vocabulary are not what is under test
   here -- both have their own suites. */
const gate = new Function(`
  const _calComponentsFor = () => ['video', 'graphic', 'caption'];
  const _calNormStatus = s => String(s || '').trim();
  ${grabFunc('_calCompLinked')}
  ${realReviewable}
  ${grabFunc('_kasperUndecidedComps')}
  return _kasperUndecidedComps;
`)();
const MIXED_LINKED = Object.assign({}, MIXED, { linear_issue_id: 'VID-1' });
ok(gate(MIXED_LINKED).join() === 'caption',
  'the fileless video is out of scope: he cannot watch what is not there, so it is not undecided');
const MIXED_WITH_FILE = Object.assign({}, MIXED_LINKED, { asset_url: 'https://frame.io/x.mp4' });
ok(gate(MIXED_WITH_FILE).join() === 'video,caption',
  'and the moment the file lands the video IS undecided again, with no other change');
ok(gate(Object.assign({}, MIXED_LINKED, { caption_status: 'Tweaks Needed' })).length === 0,
  'so deciding the caption empties the set entirely -- which is what lets Finish both run AND stick');
ok(!/_kasperBlockingComps/.test(INDEX),
  'there is no second set left to drift from this one');
ok(/const undecidedComps = _kasperUndecidedComps\(p\);/.test(INDEX),
  'the Finish button reads it');
ok(/if \(_kasperUndecidedComps\(post\)\.length\) return;/.test(INDEX),
  'the guard inside the finish handler reads it');
ok(/if \(stampedAt && _kasperUndecidedComps\(post\)\.length > 0\) return false;/.test(INDEX),
  'and so does the finished-state test -- the three cannot disagree because there is one set');

/* THE SAMPLES TWIN IS DELIBERATELY DIFFERENT, and this records why so the next
   reader does not "fix" it or re-derive the argument.

   Samples has no caption and no title -- SXR_REVIEW_COMPONENTS is ['video',
   'graphic'] -- so item 135's actual defect, a written caption hidden behind a
   media test, cannot happen there. And the samples surface is SELF-CONSISTENT
   today: one set, _sxrKasperUndecidedComps, read by its finish gate, its
   finished-state test and its finish handler alike, and it both counts a
   component and renders its panel.

   Adding the media filter to that set ALONE would break exactly that
   consistency -- a fileless component would stop counting while its panel still
   rendered an enabled Approve, which is the mirror image of the trap just
   removed from the calendar. Doing it properly means filtering the samples
   panel render too, which is a larger change than the one this suite covers. */
ok(/const SXR_REVIEW_COMPONENTS = \['video','graphic'\];/.test(INDEX),
  'samples has no caption or title component, so item 135 cannot occur there');
const sxrUndecided = grabFunc('_sxrKasperUndecidedComps');
ok(!/_kasperCompReviewable/.test(sxrUndecided),
  'and its undecided set is deliberately media-BLIND -- see the note above, this is not drift');
ok(/if \(stampedAt && _sxrKasperUndecidedComps\(post\)\.length\) return false;/.test(INDEX)
  && /const undecided = _sxrKasperUndecidedComps\(p\);/.test(INDEX)
  && /if \(_sxrKasperUndecidedComps\(p\)\.length\) return;/.test(INDEX),
  'because what matters is that samples reads ONE set in all three places too, which it does');


ok(/body\.innerHTML = _kasperRenderUnloadedNotice\(\) \+ _kasperRenderStrandedNotice\(\)/.test(INDEX),
  'the paint renders the notice above the queue, after the unloaded-clients notice (item 86)');
ok(/_kasperState\.stranded = Array\.isArray\(fetched\.stranded\)/.test(INDEX),
  'and the load actually fills it from the fetch result');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nKasper stranded-hand-off checks passed');
