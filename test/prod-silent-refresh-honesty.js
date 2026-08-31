'use strict';
/*
 * A failed background refresh was recorded as a successful sync.
 *
 * Found by the unknowable-assertion sweep, 2026-08-31.
 *
 * `_prodLoadData` catches in silent mode and returns. An async function that
 * catches and RETURNS resolves — so `await` on it succeeds, and
 * `_prodDeltaRefresh` walked straight past the failure into its success tail:
 * it stamped `lastFullSyncAt`, then set `lastSyncAt`, cleared `lastSyncError`
 * and reset `refreshFailures` to zero.
 *
 * Three separate harms, and the third is the worst:
 *
 *   1. Nothing was read, and the tab said it had synced.
 *   2. The failure counter reset, so the backoff that exists to stop hammering
 *      a failing backend never engaged.
 *   3. Clearing `lastSyncError` ERASED a failure notice the tab had already
 *      earned from an earlier tick — and because the `finally` arm repaints
 *      whenever the error state flips, the freshness control was actively
 *      re-rendered as clean, carrying the words "Production refreshes
 *      automatically while this tab is open", over data that had stopped
 *      refreshing.
 *
 * THE FIX IS A RETURN VALUE, NOT A THROW, and that is the load-bearing part.
 * Making `_prodLoadData` rethrow in silent mode is the obvious repair and it
 * breaks three other callers — the tab-return refresh and the two post-create
 * reloads — which rely on it never rejecting. An unhandled rejection there
 * fails the boot probes on their zero-console-error contract. Those callers
 * ignore the return value, so a boolean costs them nothing.
 */
const fs = require('fs');
const path = require('path');

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

const load = grabFunc('_prodLoadData');
const delta = grabFunc('_prodDeltaRefresh');

/* ---- 1. The silent arm reports, and does not throw ---------------------- */

ok(/if \(silent\) \{[\s\S]{0,2600}return false;\s*\n\s*\}/.test(load),
  'the silent failure arm returns false rather than resolving indistinguishably from a success');
ok(!/if \(silent\) \{[\s\S]{0,2600}throw /.test(load),
  'and it does NOT throw -- three other silent callers rely on this never rejecting, '
  + 'and an unhandled rejection fails the boot probes on their zero-console-error contract');
ok(/setTimeout\(\(\) => _prodLoadBriefs\(\{ silent: true \}\), 6500\);\s*\n\s*return true;/.test(load),
  'the success path reports true, so the two outcomes are actually distinguishable');

/* ---- 2. The delta refresh acts on the answer ---------------------------- */

ok(/if \(await _prodLoadData\(\{ silent: true \}\) === false\) \{[\s\S]{0,520}new Error\('production_full_refresh_failed'\)/.test(delta),
  'a full refresh that did not land is routed into the failure arm instead of the success tail');

/* ---- 1b. ...carrying the status, which the boolean cannot ---------------
 * Codex P2, 2026-08-31, and correct. The first version threw a bare Error, so
 * `Number(error.status)` was NaN and a 401/403 landed on the generic "Live
 * updates are failing. Retry to catch up." -- telling an expired staff session
 * to keep retrying, while the sentence that fits it sat three lines below in
 * the same branch, unreachable.
 *
 * The status is passed as a SINGLE-USE BATON on _prodState rather than by
 * widening the return type. Two callers-worth of reasoning: three callers
 * ignore the return value entirely, and the repair above depends on the two
 * outcomes staying trivially distinguishable (`=== false`). A field that is
 * read and cleared cannot go stale into a later, unrelated failure the way one
 * left standing would. */
ok(/_prodState\.lastSilentLoadStatus = status \|\| 0;/.test(load),
  'the silent arm records the HTTP status it already computed, instead of discarding it with the error');
ok(/failed\.status = Number\(_prodState\.lastSilentLoadStatus \|\| 0\);/.test(delta),
  '...and the thrown error carries it, so the 401/403 branch below is reachable from a full refresh');
ok(/failed\.status = Number[\s\S]{0,80}_prodState\.lastSilentLoadStatus = 0;\s*\n\s*throw failed;/.test(delta),
  '...and it is CLEARED on read -- a baton left standing would colour the next unrelated failure');
ok(/lastSilentLoadStatus: 0,/.test(INDEX),
  'and the field is declared with the rest of the freshness state rather than sprouting on first failure');
const fullBranch = delta.slice(delta.indexOf('needsFull'), delta.indexOf('lastFullSyncAt = Date.now()'));
ok(/=== false/.test(fullBranch),
  '...and the check sits BEFORE the full-sync stamp, which is the value that was being falsified');

/* ---- 3. What the failure arm must still do ------------------------------ */

const catchArm = delta.slice(delta.indexOf('} catch (error) {'));
ok(/refreshFailures = Number\(_prodState\.refreshFailures \|\| 0\) \+ 1/.test(catchArm),
  'the failure counter increments -- it was being reset to zero on every failed full refresh, '
  + 'so the backoff never engaged');
ok(/lastSyncError = status === 401 \|\| status === 403/.test(catchArm),
  'and the visible notice is set rather than cleared');

/* ---- 4. The regression this must never become --------------------------- */

const successTail = delta.slice(delta.indexOf('_prodState.lastSyncAt = Date.now();'), delta.indexOf('} catch (error) {'));
ok(/lastSyncError = ''/.test(successTail) && /refreshFailures = 0/.test(successTail),
  'the success tail still clears the error and the counter, which is correct FOR A SUCCESS');
ok(successTail.indexOf('lastSyncError') > 0 && delta.indexOf('production_full_refresh_failed') < delta.indexOf('_prodState.lastSyncAt = Date.now();'),
  'and it is now unreachable from a failed full refresh, which is the entire defect');

console.log(failures === 0
  ? '\nSilent-refresh honesty checks passed'
  : '\n' + failures + ' silent-refresh check(s) failed');
process.exit(failures === 0 ? 0 : 1);
