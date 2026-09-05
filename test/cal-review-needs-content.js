#!/usr/bin/env node
'use strict';
/*
 * A component cannot be sent for review while the thing to review is empty.
 *
 * Owner, 2026-09-05: "if the caption is empty or if there is no thumbnail URL
 * or no video URL then it shouldn't go to Kasper Approval." Cards kept arriving
 * in Kasper's stranded notice because the status could move while the content
 * did not exist -- the SMM believed it was with him, and he opened a card with
 * nothing on it.
 *
 * The rule already existed twice (Kasper's queue, and the calendar's "No video
 * linked" warning) and was enforced nowhere. This pins the single definition,
 * the gate built on it, and -- the part that matters six months from now --
 * that EVERY writer of a component status consults the gate. A fourth writer
 * added later fails here rather than silently reopening the hole.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, stripNonCode } = require('./helpers/extract-function');
const { stripComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

/* ---- compile the real functions and run them ---------------------------- */

const statuses = /const CAL_STATUSES\s*=\s*(\[[^\]]*\]);/.exec(INDEX);
const reviewSet = /const CAL_REVIEW_STATUSES = new Set\((\[[^\]]*\])\);/.exec(INDEX);
if (!statuses || !reviewSet) { console.log('FAIL  could not read the status vocabulary'); process.exit(1); }

const sandbox = [
  'const CAL_STATUSES = ' + statuses[1] + ';',
  'const CAL_COMPONENTS = ' + (/const CAL_COMPONENTS = (\[[^\]]*\]);/.exec(INDEX) || [])[1] + ';',
  'const CAL_REVIEW_STATUSES = new Set(' + reviewSet[1] + ');',
  extractFunction(INDEX, '_calNormStatus'),
  extractFunction(INDEX, '_kasperCompReviewable'),
  extractFunction(INDEX, '_calCompHasContent'),
  extractFunction(INDEX, '_calStatusNeedsContent'),
  extractFunction(INDEX, '_calReviewBlockReason'),
  'module.exports = { _calCompHasContent, _calStatusNeedsContent, _calReviewBlockReason, CAL_STATUSES };',
].join('\n');

const tmp = path.join(require('os').tmpdir(), 'cal-review-needs-content-' + process.pid + '.js');
fs.writeFileSync(tmp, sandbox);
let api;
try { api = require(tmp); } finally { try { fs.unlinkSync(tmp); } catch (e) {} }
const { _calReviewBlockReason: block, _calCompHasContent: has, CAL_STATUSES } = api;

/* ---- 1. the block fires exactly where it should ------------------------- */

const empty = { asset_url: '', thumbnail_url: '', caption: '', caption_alt: '', name: '' };
const full = { asset_url: 'https://f/v.mp4', thumbnail_url: 'https://f/t.png', caption: 'hi', name: 'T' };

for (const st of ['For SMM Approval', 'Kasper Approval', 'Client Approval']) {
  ok(!!block(empty, 'video', st), 'an empty video is refused for "' + st + '"');
  ok(!!block(empty, 'graphic', st), 'an empty thumbnail is refused for "' + st + '"');
  ok(!!block(empty, 'caption', st), 'an empty caption is refused for "' + st + '"');
  ok(!block(full, 'video', st) && !block(full, 'graphic', st) && !block(full, 'caption', st),
    'and a card that HAS its content moves freely to "' + st + '"');
}

/* ---- 2. and nowhere else, which is what stops it breaking things -------- */

ok(!block(empty, 'video', 'Tweaks Needed'),
  'Tweaks Needed is never blocked — it is a rejection, and the content being absent is often the point');
for (const st of ['Approved', 'Scheduled', 'Posted', 'In Progress', 'N/A']) {
  ok(!block(empty, 'video', st),
    '"' + st + '" is never blocked — gating it would break bulk edits on legacy cards completed before the calendar carried media');
}
ok(/caption_alt/.test(extractFunction(INDEX, '_kasperCompReviewable')), 'an alt caption counts as a caption, so a card written only in the alt field is not held');

/* ---- 3. one definition, not four --------------------------------------- */

const calHas = stripNonCode(extractFunction(INDEX, '_calCompHasContent'));
ok(/_kasperCompReviewable/.test(calHas),
  'the status gate delegates to Kasper\'s definition, so what he can review and what may be sent to him cannot drift apart');
const kasper = stripNonCode(extractFunction(INDEX, '_kasperCompReviewable'));
ok(!/_calCompHasContent/.test(kasper),
  'and the delegation runs that way round on purpose: six suites compile _kasperCompReviewable in isolation, so it must stay dependency-free');

/* ---- 4. EVERY status writer consults the gate --------------------------- */

/* All FOUR paths that can put a component into a review status. The first two
   are the person clicking; the second two were the surprise this test found --
   an automatic router and an approve-onward that both target Kasper Approval,
   which is the likelier source of cards arriving stranded without anyone
   choosing to send them. */
const WRITERS = ['_calStatusPick', '_calSetAllStatus', '_calApplyAutoStatus', '_calReviewApplyApprove'];
for (const fn of WRITERS) {
  const src = stripNonCode(extractFunction(INDEX, fn));
  ok(/_calReviewBlockReason/.test(src), fn + ' consults the gate before writing a component status');
}
/* The roster is derived, not hand-kept: anything else that stages a component
   status into the calendar's pending edits has to appear here. A writer routes
   through `_calPendingEdits` (directly or via an `edits` alias) and assigns
   something whose name ends in `_status`. */
/* Detected on a view that KEEPS string literals: the status key is built as
   `c + '_status'`, and stripNonCode blanks that literal, so the first draft of
   this scan found none of the real writers. */
const code = stripComments(INDEX, ' ');
const writerNames = new Set();
const re = /function (_cal[A-Za-z0-9_]+)\s*\(/g;
let m;
while ((m = re.exec(code))) {
  const body = extractFunction(INDEX, m[1]);
  if (!body) continue;
  const b = stripComments(body, ' ');
  if (!/_calPendingEdits/.test(b)) continue;
  /* Deliberately broad: `_calSetAllStatus` stages through an aliased
     `edits[key]`, so a pattern keyed on the assignment misses it. Anything that
     touches pending edits and mentions a component status is a candidate, and
     the exemption map below is what narrows it -- narrowing by regex is how a
     writer slips through unnoticed. */
  if (!/_status/.test(b)) continue;
  writerNames.add(m[1]);
}

/* Writers that legitimately never send anything for review. Each is listed
   with the reason, so a NEW writer is a failure until somebody classifies it
   rather than being silently absorbed. */
const EXEMPT = {
  _calClientApprove: "writes 'Approved' to every component -- an outcome, never a review request",
  _calTogglePostPlatform: "clears title_status to '' when YouTube is removed; clearing is not sending",
  _calReconcileLinearStatuses: 'mirrors the status Linear already holds; gating it would make the card disagree with Linear rather than stop a person sending an empty component',
  _calFlushCardSave: 'the transport -- it sends edits the writers above already staged and gated, and its own status line is the repair path',
  _calReviewRequestTweak: "writes 'Tweaks Needed', a rejection: the content being absent is frequently the reason for it",
  _calSyncStatusFromLinear: 'mirrors the status Linear already holds, like the reconciler above',
};
/* THE ROSTER MUST NOT BE EMPTY. An empty set makes the assertion below pass
   without examining anything -- the exact could-not-fail shape this repository
   keeps rediscovering (OPEN_REPAIRS 144/145), and the first draft of this very
   check found zero writers and reported success. */
ok(writerNames.size >= WRITERS.length,
  'the derived writer roster actually found the writers (' + writerNames.size + ' found: '
  + [...writerNames].join(', ') + ')');
for (const w of WRITERS) {
  ok(writerNames.has(w), 'and the roster includes the known writer ' + w);
}
const unguarded = [...writerNames].filter(n =>
  !/_calReviewBlockReason/.test(stripComments(extractFunction(INDEX, n), ' ')) && !EXEMPT[n]);
ok(unguarded.length === 0,
  'every calendar function that stages a component status either consults the gate or is explicitly exempt'
  + (unguarded.length ? ' — unclassified: ' + unguarded.join(', ') : ''));
const staleExempt = Object.keys(EXEMPT).filter(n => !writerNames.has(n));
ok(staleExempt.length === 0,
  'and no exemption names a function that no longer stages a status'
  + (staleExempt.length ? ' — stale: ' + staleExempt.join(', ') : ''));


/* ---- 5. the gate runs BEFORE anything is mutated ------------------------ */

/* Ordering, not presence. A gate that fires after the mutation it was meant to
   prevent reports the refusal accurately and leaves the damage in place, which
   is worse than no gate: the reader is told nothing happened. Both of these
   were real -- Codex found them on #1272 -- so they are pinned by position. */
function orderOk(fn, firstNeedle, secondNeedle) {
  const src = stripComments(extractFunction(INDEX, fn), ' ');
  const a = src.indexOf(firstNeedle), b = src.indexOf(secondNeedle);
  return a >= 0 && b >= 0 && a < b;
}
ok(orderOk('_calStatusPick', '_calReviewBlockReason', '_calPendingEdits[pid] = {}'),
  '_calStatusPick consults the gate BEFORE it creates the pending bucket — an empty bucket is not inert, _calFlushCardSave reads it as a card to write and resends the whole card from this tab\'s snapshot');
ok(orderOk('_calReviewApprove', '_calReviewBlockReason', '_calResolveTweaksDone'),
  '_calReviewApprove checks the content BEFORE it resolves the ticked change-requests — resolving first and refusing second marks tweaks done for an approval that never happened');
ok(orderOk('_sxrStatusPick', '_sxrReviewBlockReason', '_sxrPendingEdits[pid] = {}'),
  'and the samples twin creates its bucket after its gate too');
ok(orderOk('_sxrReviewApprove', '_sxrReviewBlockReason', '_sxrResolveTweaksDone'),
  'and the samples twin checks before resolving too');

/* One destination function per surface, consulted by both the pre-resolve
   guard and the approve. Two copies of that ternary is how the guard starts
   answering a different question than the thing it guards. */
for (const [approve, apply, helper] of [
  ['_calReviewApprove', '_calReviewApplyApprove', '_calSmmApproveTo'],
  ['_sxrReviewApprove', '_sxrReviewApplyApprove', '_sxrSmmApproveTo'],
]) {
  ok(new RegExp(helper).test(stripComments(extractFunction(INDEX, approve), ' '))
    && new RegExp(helper).test(stripComments(extractFunction(INDEX, apply), ' ')),
    approve + ' and ' + apply + ' agree on the destination via ' + helper + ' rather than each carrying its own copy');
}

/* ---- 6. Samples carries the same gate ----------------------------------- */

/* docs/features/SAMPLES_PARITY_LOG.md: a review change made in the calendar is
   NOT automatically made in the samples fork. Executed here rather than merely
   logged, because a parity row is a promise and this is the proof. */
const sxrSet = /const SXR_REVIEW_STATUSES = new Set\((\[[^\]]*\])\);/.exec(INDEX);
if (!sxrSet) { console.log('FAIL  could not read the samples status vocabulary'); process.exit(1); }
const sxrSandbox = [
  'const SXR_STATUSES = ' + (/const SXR_STATUSES\s*=\s*(\[[^\]]*\]);/.exec(INDEX) || [])[1] + ';',
  'const SXR_COMPONENTS = ' + (/const SXR_COMPONENTS = (\[[^\]]*\]);/.exec(INDEX) || [])[1] + ';',
  'const SXR_REVIEW_STATUSES = new Set(' + sxrSet[1] + ');',
  extractFunction(INDEX, '_sxrNormStatus'),
  extractFunction(INDEX, '_kasperCompReviewable'),
  extractFunction(INDEX, '_sxrCompHasContent'),
  extractFunction(INDEX, '_sxrStatusNeedsContent'),
  extractFunction(INDEX, '_sxrReviewBlockReason'),
  'module.exports = { _sxrReviewBlockReason, SXR_COMPONENTS };',
].join('\n');
const sxrTmp = path.join(require('os').tmpdir(), 'sxr-review-needs-content-' + process.pid + '.js');
fs.writeFileSync(sxrTmp, sxrSandbox);
let sxrApi;
try { sxrApi = require(sxrTmp); } finally { try { fs.unlinkSync(sxrTmp); } catch (e) {} }
const sblock = sxrApi._sxrReviewBlockReason;

ok(sxrApi.SXR_COMPONENTS.join(',') === 'video,graphic',
  'samples carries video and thumbnail only — no caption and no title, so those two rules are the whole gate here');
for (const st of ['For SMM Approval', 'Kasper Approval', 'Client Approval']) {
  ok(!!sblock(empty, 'video', st) && !!sblock(empty, 'graphic', st),
    'an empty sample component is refused for "' + st + '"');
  ok(!sblock(full, 'video', st) && !sblock(full, 'graphic', st),
    'and a sample that HAS its media moves freely to "' + st + '"');
}
for (const st of ['Tweaks Needed', 'Approved', 'In Progress']) {
  ok(!sblock(empty, 'video', st), 'samples leaves "' + st + '" alone, same as the calendar');
}
ok(/_kasperCompReviewable/.test(stripNonCode(extractFunction(INDEX, '_sxrCompHasContent'))),
  'and samples reads the SAME content definition rather than a second copy of it — asset_url and thumbnail_url are the same columns on both surfaces');

/* The samples writer roster, derived exactly like the calendar's above. */
const sxrWriterNames = new Set();
const sre = /function (_sxr[A-Za-z0-9_]+)\s*\(/g;
let sm;
while ((sm = sre.exec(code))) {
  const body = extractFunction(INDEX, sm[1]);
  if (!body) continue;
  const b = stripComments(body, ' ');
  if (!/_sxrPendingEdits/.test(b)) continue;
  if (!/_status/.test(b)) continue;
  sxrWriterNames.add(sm[1]);
}
const SXR_WRITERS = ['_sxrStatusPick', '_sxrSetAllStatus', '_sxrApplyAutoStatus', '_sxrReviewApplyApprove'];
const SXR_EXEMPT = {
  _sxrReviewRequestTweak: "writes 'Tweaks Needed', a rejection",
  _sxrFlushCardSave: 'the transport — it sends edits the writers above already staged and gated',
  _sxrSyncStatusFromLinear: 'mirrors the status Linear already holds',
};
ok(sxrWriterNames.size >= SXR_WRITERS.length,
  'the derived samples writer roster actually found the writers (' + sxrWriterNames.size + ' found: '
  + [...sxrWriterNames].join(', ') + ')');
for (const w of SXR_WRITERS) {
  ok(sxrWriterNames.has(w), 'and the samples roster includes the known writer ' + w);
}
const sxrUnguarded = [...sxrWriterNames].filter(n =>
  !/_sxrReviewBlockReason/.test(stripComments(extractFunction(INDEX, n), ' ')) && !SXR_EXEMPT[n]);
ok(sxrUnguarded.length === 0,
  'every samples function that stages a component status either consults the gate or is explicitly exempt'
  + (sxrUnguarded.length ? ' — unclassified: ' + sxrUnguarded.join(', ') : ''));
const sxrStaleExempt = Object.keys(SXR_EXEMPT).filter(n => !sxrWriterNames.has(n));
ok(sxrStaleExempt.length === 0,
  'and no samples exemption names a function that no longer stages a status'
  + (sxrStaleExempt.length ? ' — stale: ' + sxrStaleExempt.join(', ') : ''));


/* ---- 7. the ESCAPE HATCH, and every caller of the auto-router ----------- */

/* Owner, 2026-09-05: "just make sure it doesn't break anything ... it should
   probably be N/A if there isn't a component". It already is, and this pins it:
   N/A must stay on the menu and stay OUT of the priority table, or a lane that
   will never have content would hold the whole card's status down and there
   would be nowhere for the reader to put it. */
const calStatusList = JSON.parse((statuses[1] || '[]').replace(/'/g, '"'));
ok(calStatusList.indexOf('N/A') === 0,
  'N/A is the first option on the component menu — the way out for a lane this post will never have');
ok(!block(empty, 'video', 'N/A') && !block(empty, 'graphic', 'N/A') && !block(empty, 'caption', 'N/A'),
  'and N/A is never gated, on any component, however empty it is');
const priority = /const CAL_PRIORITY = \{([^}]*)\}/.exec(INDEX);
ok(priority && !/'N\/A'/.test(priority[1]),
  'and N/A stays out of CAL_PRIORITY, so marking a lane not-applicable stops it dragging the overall card status down');
/* The one place N/A is NOT offered, and the note must not pretend otherwise. */
const titleList = JSON.parse((/const CAL_TITLE_STATUSES = (\[[^\]]*\]);/.exec(INDEX) || ['', '[]'])[1].replace(/'/g, '"'));
ok(titleList.indexOf('N/A') < 0,
  'title review has no N/A — a YouTube card that is in title review has a title by definition');
const noteFn = stripComments(extractFunction(INDEX, '_calMenuBlockedNote'), ' ');
ok(/menu\.indexOf\('N\/A'\) >= 0/.test(noteFn),
  "so the greyed-menu note offers N/A only where the menu actually carries it, derived from the list rather than hardcoded — telling a reader to use a control that isn't there is the dead-instruction class this repo keeps finding");

/* EVERY caller of the auto-router, not just the one the gate was written for.
   _calApplyAutoStatus returns false on an empty component and its callers
   ignore the return, so a caller that mutates BEFORE calling it closes the
   thread and moves nothing, silently. That is worse than the stranding it
   replaced, and it is what the owner asked to be checked. */
for (const [fn, gate, resolve] of [
  ['_calResolveLastTweak', '_calReviewBlockReason', '_calResolveTweaksDone'],
  ['_sxrResolveLastTweak', '_sxrReviewBlockReason', '_sxrResolveTweaksDone'],
]) {
  ok(orderOk(fn, gate, resolve),
    fn + ' checks the content BEFORE it resolves the change-request — the auto-router returns false for an empty component and this caller ignores the return, so resolving first would close the thread and move nothing, with nobody told');
}
/* The chooser's destination rule is NOT the approve-onward rule: an
   unrecognised dest means the client there and Kasper here. Two rules, two
   functions, and each guard must consult its own or it guards the wrong move. */
ok(/_calAutoResolveDestStatus/.test(stripComments(extractFunction(INDEX, '_calResolveLastTweak'), ' '))
  && /_calAutoResolveDestStatus/.test(stripComments(extractFunction(INDEX, '_calApplyAutoStatus'), ' ')),
  'and the guard and the router agree on the destination via _calAutoResolveDestStatus');
ok(/_sxrAutoResolveDestStatus/.test(stripComments(extractFunction(INDEX, '_sxrResolveLastTweak'), ' '))
  && /_sxrAutoResolveDestStatus/.test(stripComments(extractFunction(INDEX, '_sxrApplyAutoStatus'), ' ')),
  'and so do the samples twins');
const autoDest = new Function(extractFunction(INDEX, '_calAutoResolveDestStatus') + '\nreturn _calAutoResolveDestStatus;')();
const approveTo = new Function(extractFunction(INDEX, '_calSmmApproveTo') + '\nreturn _calSmmApproveTo;')();
ok(autoDest('kasper') === 'Kasper Approval' && autoDest('approved') === 'Approved' && autoDest('client') === 'Client Approval',
  'the chooser route resolves its three destinations');
ok(autoDest('') === 'Client Approval' && approveTo('') === 'Kasper Approval',
  'and the two rules genuinely differ on an unrecognised destination — which is why they are two functions and not one shared helper');

/* ---- 8. the menu refuses before the click, not after -------------------- */

/* The gate stays in the handler regardless: Set all, the auto-router and both
   approve paths reach the same rule without passing through this menu. This is
   the cosmetic half — being told "no" after choosing is the worse half of a
   correct refusal. */
for (const [fn, gate] of [['_calStatusToggleMenu', '_calReviewBlockReason'], ['_sxrStatusToggleMenu', '_sxrReviewBlockReason']]) {
  const src = stripComments(extractFunction(INDEX, fn), ' ');
  ok(new RegExp(gate).test(src) && /disabled/.test(src),
    fn + ' disables a status the component cannot be moved to, rather than offering it and refusing the click');
}
ok(/_calReviewBlockReason/.test(stripComments(extractFunction(INDEX, '_calStatusPick'), ' ')),
  'and the handler keeps its own check — a disabled button is a courtesy, not a guard, and every other writer bypasses the menu entirely');

/* THE NOTE MUST NOT BE ABLE TO HIDE WHAT IT POINTS AT. The menu is
   position: fixed, so a menu taller than the viewport is clipped with no way to
   scroll to the clipped part -- and the clipped part is the TOP of the list,
   where N/A sits. Adding a multi-line note made the nine-option menu tall
   enough to reach that on a short viewport, which would have made the sentence
   "set it to N/A" point at an option the reader cannot reach. Codex, #1277. */
const menuCss = /\.cal-fld-status-menu \{[\s\S]{0,900}?\}/.exec(INDEX);
ok(menuCss && /max-height:/.test(menuCss[0]) && /overflow-y:\s*auto/.test(menuCss[0]),
  'the status menu is capped to the viewport and scrolls — it is position:fixed, so anything taller is clipped and unreachable, starting with N/A at the top of the list');
for (const fn of ['_calStatusToggleMenu', '_sxrStatusToggleMenu']) {
  const src = stripComments(extractFunction(INDEX, fn), ' ');
  ok(/top = Math\.max\(10, Math\.min\(/.test(src),
    fn + ' floors the computed top at 10 — the inner Math.min goes negative for a menu taller than the viewport, which walks the first options off the top of the screen');
}


/* ---- 9. EVERY writer, any prefix -- the sweep the owner asked for ------- */

/* Owner, 2026-09-05: "make sure that you have discovered all the possible
   things it would break". Sections 4 and 6 derive rosters restricted to _cal*
   and _sxr*. That restriction is how Kasper's own approve handlers and the
   write-UI journal replay were missed on the first two passes: they write
   component statuses and carry no such prefix. This roster has NO prefix. Any
   function in index.html that assigns a component status on a post is in it,
   and has to be either a gated writer or an explicit exemption with a reason.
   A writer added under a new prefix fails here rather than being absorbed. */
const allWriters = new Set();
const anyFn = /function ([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
let am;
while ((am = anyFn.exec(code))) {
  const body = extractFunction(INDEX, am[1]);
  if (!body) continue;
  const b = stripComments(body, ' ');
  const writes =
    /\b(post|p|item\.post|current|card|row)\[(subKey|key|which \+ '_status'|c \+ '_status'|comp \+ '_status')\]\s*=[^=]/.test(b)
    || /\.(video|graphic|caption|title)_status\s*=[^=]/.test(b)
    || /\[subKey\]: /.test(b)
    || (/(video|graphic|caption|title)_status:\s*/.test(b) && /_calPendingEdits|_sxrPendingEdits|Object\.assign/.test(b));
  if (writes) allWriters.add(am[1]);
}
const GATED = {
  _calStatusPick: '_calReviewBlockReason', _calSetAllStatus: '_calReviewBlockReason',
  _calApplyAutoStatus: '_calReviewBlockReason', _calReviewApplyApprove: '_calReviewBlockReason',
  _kasperApproveComp: '_calReviewBlockReason',
  _sxrStatusPick: '_sxrReviewBlockReason', _sxrSetAllStatus: '_sxrReviewBlockReason',
  _sxrApplyAutoStatus: '_sxrReviewBlockReason', _sxrReviewApplyApprove: '_sxrReviewBlockReason',
  _sxrKasperApproveComp: '_sxrReviewBlockReason',
};
/* Each exemption names WHY the write can never put an empty component into a
   review status. "It is a mirror" and "it is a rejection" are the two honest
   reasons; "it was gated upstream" is the third and the one to read hardest. */
const ALL_EXEMPT = {
  _calClientApprove: "writes Approved to every component -- an outcome, never a review request",
  _calFlushCardSave: 'the transport; sends what the gated writers staged',
  _sxrFlushCardSave: 'the samples transport',
  _calMigratePostShape: 'load-time shape normalisation of a row already stored',
  _sxrMigrateShape: 'load-time shape normalisation, samples',
  _prodCacheUnpackRows: 'unpacks a cached snapshot; decides nothing',
  _calReconcileLinearStatuses: 'mirrors the status Linear already holds -- KNOWN GAP, deliberate: the gate is browser-side and a Linear-side move to a review status lands here unchallenged',
  _calSyncStatusFromLinear: 'mirrors the status Linear already holds, same gap',
  _sxrSyncStatusFromLinear: 'mirrors the status Linear already holds, samples',
  _calReviewRequestTweak: "writes Tweaks Needed, a rejection",
  _sxrReviewRequestTweak: "writes Tweaks Needed, a rejection",
  _kasperRequestTweakComp: "writes Tweaks Needed, a rejection",
  _sxrKasperRequestTweakComp: "writes Tweaks Needed, a rejection",
  _sxrKasperApproveAfterTweaksComp: "writes Tweaks Needed -- the pre-clear goes to the editor first, not to a review",
  _calSaveSettings: "the settings pseudo-row; every status it writes is ''",
  _calTogglePostPlatform: "clears title_status to '' when YouTube is removed; clearing is not sending",
  _sxrKasperUndoApprove: 'restores the status a component held moments ago -- gating a revert would strand an undo; the state it restores existed',
  _writeNativeSubmissionCardsToCalendar: 'creates every card at In Progress',
  _writeUiAdoptReplayStatus: "adopts the gateway's CURRENT native row into the card shadow -- authoritative state, not a person's choice",
  _writeUiApplyJournalEdits: 'replays edits that were gated when they were staged -- KNOWN GAP for entries journaled before the gate existed, a finite historical population',
  _writeUiLegacyReconcileCommittedTweak: 'restores gate.intended_status recorded by a gated path after the gateway confirmed it',
};
ok(allWriters.size >= Object.keys(GATED).length + Object.keys(ALL_EXEMPT).length - 2,
  'the prefix-free roster actually found the writers (' + allWriters.size + ')');
for (const [fn, gate] of Object.entries(GATED)) {
  ok(allWriters.has(fn), 'the prefix-free roster includes the gated writer ' + fn);
  ok(new RegExp(gate).test(stripComments(extractFunction(INDEX, fn) || '', ' ')),
    fn + ' consults ' + gate + ' -- ' + (/kasper/i.test(fn) ? "Kasper's approve targets Client Approval, a review status; his button is disabled for an empty component but a button is a courtesy and this is the handler" : 'a gated writer'));
}
const unclassified = [...allWriters].filter(n => !GATED[n] && !ALL_EXEMPT[n]);
ok(unclassified.length === 0,
  'every function on EITHER surface, under ANY prefix, that writes a component status is gated or explicitly exempt'
  + (unclassified.length ? ' -- unclassified: ' + unclassified.join(', ') : ''));
const staleAll = Object.keys(ALL_EXEMPT).filter(n => !allWriters.has(n));
ok(staleAll.length === 0,
  'and no exemption names a function that no longer writes a status'
  + (staleAll.length ? ' -- stale: ' + staleAll.join(', ') : ''));

/* Every CALLER of the auto-router with a routing trigger must consult the gate
   BEFORE it, because the router's refusal is a return value its callers were
   written to ignore. 'client_added' routes to Tweaks Needed and is exempt by
   its trigger. The retry path is the one the first two passes missed: it
   replays a resolve from a durable journal, whose content can have been
   cleared since it was written. */
const ROUTER_CALLERS = {
  _calResolveLastTweak: ['_calReviewBlockReason', '_calResolveTweaksDone'],
  _sxrResolveLastTweak: ['_sxrReviewBlockReason', '_sxrResolveTweaksDone'],
  _writeUiRetryCardCommentResolve: ['ReviewBlockReason', 'ApplyAutoStatus'],
};
for (const [fn, [gate, mutate]] of Object.entries(ROUTER_CALLERS)) {
  ok(orderOk(fn, gate, mutate),
    fn + ' consults the gate before ' + mutate + ' -- the router refuses an empty component by RETURN VALUE and this caller ignores it');
}
const routerCallers = [];
const rc = /function ([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
let rm;
while ((rm = rc.exec(code))) {
  const b = stripComments(extractFunction(INDEX, rm[1]) || '', ' ');
  if (/_(cal|sxr)ApplyAutoStatus\(/.test(b) && !/function _(cal|sxr)ApplyAutoStatus/.test(b)) routerCallers.push(rm[1]);
}
const ROUTER_EXEMPT = { _calAppendComment: "trigger is 'client_added' -> Tweaks Needed", _sxrAppendComment: "trigger is 'client_added' -> Tweaks Needed" };
const routerUnclassified = routerCallers.filter(n => !ROUTER_CALLERS[n] && !ROUTER_EXEMPT[n]);
ok(routerCallers.length >= 3 && routerUnclassified.length === 0,
  'every caller of the auto-router is classified (' + routerCallers.join(', ') + ')'
  + (routerUnclassified.length ? ' -- unclassified: ' + routerUnclassified.join(', ') : ''));

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\ncalendar + samples review-needs-content checks passed');
