'use strict';
/*
 * The missing-deep-link notice says only what this page can establish.
 *
 * OWNER REPORT, 2026-09-01, relaying a video editor: an issue she opened from
 * Linear "doesn't appear in SyncView", and the page told her it
 * "may live only in Linear, or belong to a client this view does not cover."
 *
 * MEASURED against the live projection that day: the SECOND half was false.
 * The client was on the roster with active = true and 328 of its rows already
 * visible; the identifier simply had no row in `deliverables` at all, nor in
 * the browser view. A reader handed two causes, one of which is wrong, cannot
 * act on either -- and there was nothing on the notice to act on anyway.
 *
 * WHY IT KEEPS HAPPENING, which is the part worth saying out loud: SyncView
 * creates the issue in Linear, never the reverse. The only importer left is the
 * B1 stray-catcher, and it scans by `updatedAt` since its previous run --
 * `incrementalChangedSince()` returns the last finished run minus a five-minute
 * overlap, on a 30-minute schedule. The `full` re-read that WOULD find an older
 * issue "refuses to apply unless a live flag read confirms BOTH teams are
 * Linear-authoritative, so this lane is unavailable after F1 by construction."
 * So an issue typed straight into Linear and left alone for an hour is not
 * late. It is never arriving on its own.
 *
 * The notice now states the one fact the page owns -- there is no row here --
 * and names the two things a person can actually do.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const B1 = fs.readFileSync(path.join(ROOT, 'scripts/b1-linear-backfill.js'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* The COPY assertions below read the rendered string, not the source, because
   the function's own comment quotes the sentences it replaced -- that is how a
   reader learns why the wording changed, and it must not read as the wording
   still being there. Code-fact assertions further down use the raw source. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map(line => line.replace(/(^|[^:'"])\/\/.*$/, '$1')).join('\n');
}

const notice = (() => {
  const at = INDEX.indexOf('function _prodDeepLinkNoticeHTML(');
  const end = INDEX.indexOf('function _prodDismissDeepLinkNotice(');
  if (at < 0 || end < 0) throw new Error('notice function not found');
  return INDEX.slice(at, end);
})();

/* ---- 1. The claim it must no longer make ------------------------------- */

const rendered = stripComments(notice);
ok(!/belong to a client this view does not cover/.test(rendered),
  'THE REPORT: the notice no longer guesses that the client may be uncovered — it was measurably not, and a wrong cause is worse than none');
ok(!/may live only in Linear/.test(rendered),
  'and no longer offers two causes at once, which left the reader unable to act on either');

/* ---- 2. What it says instead ------------------------------------------ */

ok(/has no row in Production\./.test(rendered),
  'it states the one thing this page can establish on its own: there is no row here under that identifier');
ok(/Issues created directly in Linear are not imported/.test(rendered),
  'and names the mechanism, which is the same every time rather than a possibility');
ok(/ask an Admin to run the/.test(rendered) && /create the post on the Calendar/.test(rendered),
  'then gives the two things a person can actually do — one for a row that already exists in Linear, one for a post that should exist in both');
ok(/Showing the full list instead\./.test(rendered),
  'and still explains what it did with the navigation, which is what the reader asked for');

/* No Retry and no Linear link: the page holds no Linear credential, so a button
   here can only re-ask a question that is already answered. */
ok(!/Retry/.test(rendered) && !/linear\.app/.test(rendered),
  'it offers no Retry and no Linear link — this page cannot check Linear, and a control that cannot succeed is the dead end this notice replaces');
ok(/prod-deeplink-dismiss/.test(rendered),
  'Dismiss is kept: the notice is information, and a reader who has read it must be able to put it away');

/* ---- 3. The mechanism the copy asserts is really the code -------------- */

/* If the importer ever gains a path that reaches back past its window, this
   copy becomes the wrong advice — so the claim is pinned to the code. */
ok(/async function incrementalChangedSince\(\)/.test(B1)
  && /const lastFinished = last && last\.payload && clean\(last\.payload\.finished_at\);/.test(B1)
  && /minutesAgoIso\(Number\(args\.get\('--since-minutes'\) \|\| 30\)\)/.test(B1),
  'the stray importer really does scan only from its previous run, so an older Linear-only issue is outside every scheduled window');
ok(/B1_STRAY_CATCHER: '1'/.test(
    fs.readFileSync(path.join(ROOT, '.github/workflows/b1-linear-incremental-refresh.yml'), 'utf8')),
  'and stray mode really is the standing mode, so the gap is the WINDOW rather than the importer being switched off');

console.log(failures === 0
  ? '\ndeep-link missing notice checks passed'
  : '\n' + failures + ' deep-link notice check(s) failed');
process.exit(failures === 0 ? 0 : 1);
