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

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\ncalendar + samples review-needs-content checks passed');
