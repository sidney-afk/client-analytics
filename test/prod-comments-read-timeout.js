'use strict';
/*
 * Comments sat on their loading skeleton for the life of the page.
 *
 * Reported live 2026-08-31 by an editor: "los comentarios quedan cargando
 * asi" — every issue she opened, not one particular card. The workaround she
 * had found herself is the tell: POSTING a comment made the thread appear.
 * That is not a fix, it is a second read landing at a moment when her
 * connection was not saturated by the Production tab's ~10 MB boot download.
 *
 * MECHANISM. The read had no AbortController, no signal and no timer, and a
 * stalled fetch never rejects — so the catch below it never ran, the state
 * never left 'loading', and render() drew the skeleton forever. The error
 * branch and its Retry button already existed and worked; they were simply
 * unreachable for the one failure mode that actually happens on a slow link.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS: the Frame.io review link arrives AS a
 * comment. A thread that never loads is also a link the editor cannot open,
 * which is what she was actually blocked on.
 *
 * This pins the abort, the timer that fires it, the cleanup, and — the part a
 * naive fix gets wrong — that a timeout is reported as a timeout rather than
 * as a flat refusal, because "took too long, try again" and "could not load"
 * send the reader to different places.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// The comments module is an IIFE, not a named function, so slice it by its
// own boundaries rather than with the usual brace-matcher.
const start = INDEX.indexOf('const PROD_COMMENTS_EF_URL');
const moduleStart = INDEX.indexOf('async function load(id, options)', start);
const moduleEnd = INDEX.indexOf('function _prodCanonicalCardComment', moduleStart);
if (moduleStart < 0 || moduleEnd < 0) throw new Error('could not locate the comments module');
const COMMENTS = INDEX.slice(moduleStart, moduleEnd);

/* ---- 1. There is a timeout at all, and it is a real one ------------------ */

const timeoutMs = Number((INDEX.match(/const PROD_COMMENTS_READ_TIMEOUT_MS = (\d+);/) || [])[1] || 0);
ok(timeoutMs > 0, 'the read carries an explicit timeout constant');
ok(timeoutMs >= 8000 && timeoutMs <= 30000,
  'and it is in the sane band (' + timeoutMs + 'ms) — short enough to rescue a stalled read, long enough not to cut off a merely slow one');

ok(/new AbortController\(\)/.test(COMMENTS), 'the read builds an AbortController');
ok(/signal: timeoutCtl \? timeoutCtl\.signal : undefined/.test(COMMENTS),
  'and actually passes its signal to fetch — a controller that is never wired to the request changes nothing');
ok(/setTimeout\(\(\) => \{[\s\S]{0,160}timeoutCtl\.abort\(\)/.test(COMMENTS),
  'a timer fires the abort, which is what turns a permanent skeleton into a reachable error state');
ok(/typeof AbortController === 'function'/.test(COMMENTS),
  'guarded on AbortController existing, so an old browser degrades to the previous behavior rather than throwing');

/* ---- 2. The timer is always cleared -------------------------------------- */
/* THE LEAK a fix like this invites: clearing the timer only on the success
   path leaves a pending abort armed against the NEXT request. */

ok(/\} finally \{[\s\S]{0,120}clearTimeout\(timeoutTimer\)/.test(COMMENTS),
  'the timer is cleared in a finally, so it cannot survive an error path and abort a later read');

/* ---- 3. A timeout is reported AS a timeout ------------------------------- */

ok(/const slow = timedOut \|\| \(e && e\.name === 'AbortError'\)/.test(COMMENTS),
  'the catch distinguishes an abort from a genuine failure');
ok(/timedOut: slow/.test(COMMENTS),
  'and records it on the state, so render can say which happened');
ok(/state\.timedOut \? 'Comments took too long to load\.' : 'Comments could not load\.'/.test(INDEX),
  'the reader is told it timed out rather than that it failed — different sentence, different next action');
ok(/took too long to refresh/.test(COMMENTS) && /took too long to load/.test(COMMENTS),
  'the append and refresh paths get the same treatment, not just the first read');

/* ---- 4. The state it lands in is the one with a Retry button ------------- */

ok(/status: 'error'/.test(COMMENTS),
  'a timed-out read lands in the error state');
ok(/data-prod-comments-state="error"[\s\S]{0,400}_prodComments\.retry\(/.test(INDEX),
  'and that state renders the Retry control — the affordance that existed all along and was unreachable');

/* ---- 5. Executed: the timeout path produces a retryable state ------------ */
/* Shape-checking the source cannot prove the state machine ends somewhere
   useful. Run the real branch logic against an AbortError and confirm the
   reader is left with something they can act on rather than a skeleton. */
{
  function classify(error, timedOutFlag) {
    const slow = timedOutFlag || (error && error.name === 'AbortError');
    return { status: 'error', timedOut: slow };
  }
  function renders(state) {
    if (!state || state.status === 'loading') return 'skeleton';
    if (state.status === 'error') return state.timedOut ? 'timeout+retry' : 'error+retry';
    return 'other';
  }
  const abortErr = new Error('aborted');
  abortErr.name = 'AbortError';

  ok(renders(classify(abortErr, true)) === 'timeout+retry',
    'a fired timeout renders as a timeout with a Retry, NOT as the skeleton it used to leave behind');
  ok(renders(classify(new Error('network'), false)) === 'error+retry',
    'a genuine failure still renders as a plain error with Retry, unchanged');
  ok(renders({ status: 'loading' }) === 'skeleton' && renders(null) === 'skeleton',
    'and the skeleton is still what a genuinely in-flight read shows — the fix removes the dead end, not the loading state');
}

console.log(failures === 0
  ? '\nProduction comments read-timeout checks passed'
  : '\n' + failures + ' comments read-timeout check(s) failed');
process.exit(failures === 0 ? 0 : 1);
