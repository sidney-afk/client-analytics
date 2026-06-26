'use strict';
/*
 * App auto-update nudge — wiring regression harness.
 *
 * Run:  node test/app-update-nudge.js   (exit 0 = all good)
 *
 * What it guards: SyncView is a single index.html on GitHub Pages with no build
 * step, so a browser tab left open keeps running whatever version it loaded — a
 * new deploy isn't picked up until a reload. SMMs/clients keep the tab open for
 * days, so they silently run stale code (e.g. a thumbnail rendering change that
 * shipped after they last loaded looks "broken" only for them). The nudge polls
 * the deployed file's version token (the GitHub Pages ETag / Last-Modified) and,
 * when it changes, surfaces a one-click "Reload" banner. It must NEVER force a
 * reload (an SMM could be mid-edit) and must not poll/nudge on file:// opens
 * (unit/e2e harnesses, offline opens).
 *
 * This pins the shipped wiring with static assertions on the real index.html —
 * the behavioral side (banner appears on a new version, Reload reloads, dismiss
 * re-arms) is covered by the headless test in scratchpad/qa. Mirrors the style
 * of test/calendar-folder-thumb.js check #10.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

// Extract the nudge IIFE so assertions can't accidentally match unrelated code.
const at = INDEX.indexOf('function appUpdateNudge(');
if (at < 0) { console.log('FAIL  appUpdateNudge IIFE not found in index.html'); process.exit(1); }
let depth = 0, end = -1;
for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
  const c = INDEX[j];
  if (c === '{') depth++;
  else if (c === '}') { depth--; if (depth === 0) { end = j; break; } }
}
const NUDGE = INDEX.slice(at, end + 1);

let failures = 0;
function check(label, cond) {
  if (cond) console.log('  ok  ' + label);
  else { console.log('FAIL  ' + label); failures++; }
}

// ── Guards ────────────────────────────────────────────────────────────────
check('skips non-http(s) protocols (file:// — tests/offline never poll or nudge)',
  /location\.protocol !== 'http:' && location\.protocol !== 'https:'/.test(NUDGE) && /return;/.test(NUDGE.slice(0, 400)));
check('does not poll a backgrounded tab',
  /if \(document\.hidden\) return;/.test(NUDGE));

// ── Version probe ───────────────────────────────────────────────────────────
check('HEAD-fetches the app URL with cache: no-store (reads live deploy headers)',
  /fetch\(location\.pathname, \{ method: 'HEAD', cache: 'no-store' \}\)/.test(NUDGE));
check('targets location.pathname so client ?share= params are stripped',
  /fetch\(location\.pathname,/.test(NUDGE) && !/fetch\(location\.href/.test(NUDGE));
check('version token comes from ETag or Last-Modified',
  /resp\.headers\.get\('etag'\) \|\| resp\.headers\.get\('last-modified'\)/.test(NUDGE));
check('first poll captures the running version as the baseline (no false nudge)',
  /if \(baseline === null\) \{ baseline = t; return; \}/.test(NUDGE));
check('nudges only when the deployed token differs from the baseline',
  /if \(t !== baseline && !document\.getElementById\('svUpdateBar'\)\) showBar\(t\);/.test(NUDGE));
check('network errors are swallowed (offline → retry next tick, no crash)',
  /\.catch\(function\(\)\{\}\)/.test(NUDGE));

// ── Banner UX ───────────────────────────────────────────────────────────────
check('banner tells the user a new version is available and to reload',
  /A new version of SyncView is available — reload to get the latest\./.test(NUDGE));
check('banner has a one-click Reload button that reloads the page',
  /className = 'sv-up-reload'/.test(NUDGE) && /reload\.addEventListener\('click', function\(\)\{ location\.reload\(\); \}\)/.test(NUDGE));
check('NEVER force-reloads — no top-level/auto location.reload (reload only on click)',
  (NUDGE.match(/location\.reload\(\)/g) || []).length === 1);
check('banner is a dismissible, fixed status bar (role=status)',
  /setAttribute\('role', 'status'\)/.test(NUDGE) && /className = 'sv-up-x'/.test(NUDGE));
check('dismiss adopts the new token → re-nudges only on a YET newer build',
  /dismiss\.addEventListener\('click', function\(\)\{ baseline = t; bar\.remove\(\); \}\)/.test(NUDGE));

// ── Cadence ─────────────────────────────────────────────────────────────────
check('re-checks on an interval and on tab focus / visibility',
  /setInterval\(check, POLL_MS\)/.test(NUDGE)
  && /addEventListener\('visibilitychange'/.test(NUDGE)
  && /addEventListener\('focus', check\)/.test(NUDGE));
check('captures the baseline shortly after load',
  /setTimeout\(check, \d+\)/.test(NUDGE));

console.log(failures === 0
  ? '\nAll app-update-nudge wiring checks passed.'
  : '\n' + failures + ' check(s) FAILED.');
process.exit(failures === 0 ? 0 : 1);
