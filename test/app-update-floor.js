'use strict';
/*
 * THE POLITE BANNER HAS A FLOOR UNDER IT NOW (owner request 2026-08-27).
 *
 * The update nudge's dismiss button adopts the new version token, which means
 * one click silences a build forever — and one SMM ran a pre-fix tab for days
 * on exactly that politeness, re-reporting a bug that had been fixed the
 * previous evening. The floor closes the hole with two escalations into a
 * full-screen reload wall that has no dismiss affordance at all:
 *
 *   1. stale for ESCALATE_MS with the newer version known -> wall;
 *   2. the owner sets `app_version_floor` {"at": <time>} -> every stale tab
 *      gets the wall as soon as that time has passed.
 *
 * The invariant this suite spends most of its assertions on: a CURRENT tab can
 * NEVER see the wall. Both triggers require staleness first, so a mistyped
 * floor value cannot lock the whole fleet out of a healthy build.
 */
const fs = require('node:fs');
const path = require('node:path');
const { stripBlockComments } = require('./helpers/strip-comments');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- the nudge IIFE, sliced ------------------------------------------------
const at = html.indexOf('function appUpdateNudge(');
ok(at > -1, 'the nudge IIFE is findable (harness is not vacuous)');
let depth = 0, end = -1;
for (let j = html.indexOf('{', at); j < html.length; j++) {
  if (html[j] === '{') depth++;
  else if (html[j] === '}' && --depth === 0) { end = j + 1; break; }
}
const iife = html.slice(at, end);

// ---- the verdict, EXECUTED -------------------------------------------------
const vFrom = iife.indexOf('function floorVerdict(');
const vTo = iife.indexOf('function refreshFloor(');
ok(vFrom > -1 && vTo > vFrom, 'the verdict function is findable (harness is not vacuous)');
const HOUR = 60 * 60 * 1000;
const escalateMs = Number((iife.match(/var ESCALATE_MS = ([\d\s*+]+);/) || [])[1]
  && eval((iife.match(/var ESCALATE_MS = ([\d\s*+]+);/) || [])[1]));
ok(escalateMs >= 1 * HOUR && escalateMs <= 12 * HOUR,
  'the grace window is measured in working hours, not seconds and not days (' + (escalateMs / HOUR) + 'h)');
const verdict = new Function('ESCALATE_MS',
  iife.slice(vFrom, vTo) + '\nreturn floorVerdict;')(escalateMs);

const NOW = 1900000000000;
/* The invariant: a current tab never sees the wall, whatever the flag says. */
ok(verdict(NOW, 0, 0, false) === 'none'
  && verdict(NOW, NOW - 99 * HOUR, NOW - 99 * HOUR, false) === 'none',
  'a CURRENT tab gets nothing — even a floor set 99 hours ago cannot touch it');
ok(verdict(NOW, NOW - 1000, 0, true) === 'banner',
  'a freshly stale tab gets the banner, exactly as before');
ok(verdict(NOW, NOW - escalateMs, 0, true) === 'block',
  'stale for the whole grace window -> the wall, with no flag involved');
ok(verdict(NOW, NOW - escalateMs + 1000, 0, true) === 'banner',
  'one second inside the grace window is still the banner');
ok(verdict(NOW, NOW - 1000, NOW - 1, true) === 'block',
  'a passed floor walls a stale tab immediately, however freshly stale');
ok(verdict(NOW, NOW - 1000, NOW + HOUR, true) === 'banner',
  'a FUTURE floor does nothing yet — the owner can pre-announce one');

// ---- the wall has no way out ----------------------------------------------
const wallFrom = iife.indexOf('function showFloor(');
const wallTo = iife.indexOf('function showBar(', wallFrom);
ok(wallFrom > -1 && wallTo > wallFrom, 'the wall builder is findable (harness is not vacuous)');
/* Comments stripped first: the builder carries a note explaining WHY Escape is
   not handled, and a naive search would find the word in the explanation. */
const stripComments = text => stripBlockComments(text, '').replace(/^\s*\/\/.*$/gm, '');
const wallSrc = stripComments(iife.slice(wallFrom, wallTo));
ok(!/sv-up-x|[Dd]ismiss|Escape/.test(wallSrc),
  'the wall has no dismiss button and no Escape handler — no way out but Reload');
ok(/ev\.key === 'Tab'/.test(wallSrc) && /ev\.preventDefault\(\)/.test(wallSrc),
  'and Tab is trapped on the one button, so a keyboard cannot walk into the stale page (Codex review)');
ok(/focusin/.test(wallSrc) && /!live\.contains\(ev\.target\)/.test(wallSrc),
  'focus that lands outside the wall by any other route is walked back in');
ok(/aria-modal/.test(wallSrc) && /alertdialog/.test(wallSrc),
  'and it is announced as a modal alert, not decoration');
ok(/svUpdateBar/.test(wallSrc) && /bar\.remove\(\)/.test(wallSrc),
  'it replaces the polite banner rather than stacking on it');

// ---- staleness is the DOCUMENT's, and the clock survives dismiss -----------
/* Codex review, 2026-08-27: a tab restored from cache after a deploy runs OLD
   JavaScript while its first HEAD already returns the NEW token, so a
   token-only baseline calls it current forever. The document's own
   Last-Modified is the version that actually loaded. */
ok(/var docBornMs = Date\.parse\(document\.lastModified \|\| ''\) \|\| 0;/.test(iife),
  'the loaded document\'s own birthdate is captured once, parse-safe');
ok(/\(docBornMs > 0 && lmMs > 0\)\s*\? \(lmMs - docBornMs > 60 \* 1000\)\s*: \(t !== firstBaseline\)/.test(iife),
  'staleness compares the deploy\'s Last-Modified against the DOCUMENT, with the token as fallback only');
const dismissHandler = iife.slice(iife.indexOf("dismiss.addEventListener('click'"), iife.indexOf('bar.appendChild(msg)'));
ok(dismissHandler.length > 0 && !/firstBaseline|staleSince|docBornMs/.test(dismissHandler),
  'dismiss silences the banner only — it cannot reset any staleness clock');
const blockBranch = iife.slice(iife.indexOf("floorVerdict(Date.now(), staleSince, floorAtMs, stale) === 'block'"), iife.indexOf("if (t === baseline && !stale) return;"));
ok(blockBranch.indexOf('if (!wouldLoseWork()) { showFloor(); return; }') > -1,
  'the wall defers to unsaved work exactly like the self-reload does');
ok(/if \(!document\.getElementById\('svUpdateBar'\)\) showBar\(t\);/.test(blockBranch),
  'and a deferred wall keeps the banner up — dirty work postpones the wall, never the warning (Codex review)');
ok(iife.indexOf("=== 'block'") < iife.indexOf('if (t === baseline && !stale) return;'),
  'the verdict runs BEFORE the dismissed-build early return, or dismiss would disarm it');
ok(/if \(t === baseline && !stale\) return;/.test(iife),
  'and a document-stale tab is nudged even when the token cannot tell it apart');

// ---- the flag read is fail-safe --------------------------------------------
ok(/app_version_floor/.test(iife), 'the floor flag has the documented name');
ok(/typeof CAL_SUPABASE_URL !== 'string'/.test(iife),
  'a context without Supabase constants skips the flag read instead of throwing');
ok(/isFinite\(ms\) && ms > 0 \? ms : 0/.test(iife),
  'an unparseable floor value degrades to "no floor", never to "wall everyone"');
ok(/FLOOR_TTL_MS/.test(iife) && /if \(stale\) refreshFloor\(\);/.test(iife),
  'the flag is only polled while stale, and at most once per TTL — a current fleet costs zero reads');

if (failures) {
  console.error(`\n${failures} version-floor check(s) failed`);
  process.exit(1);
}
console.log('\napp update version-floor checks passed');
