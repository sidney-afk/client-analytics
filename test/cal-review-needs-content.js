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

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\ncalendar review-needs-content checks passed');
