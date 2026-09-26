'use strict';
/* Client review send queue (src/index/185-client-review-queue.js.part).
   A client's Approve / Request changes is held in the browser until the server
   confirms it. Measured 2026-09-26: without it, a dropped connection lost a
   client approval silently. The live proof is qa/client-review-queue/offline.js;
   this guards the wiring and the connection-vs-refusal rule offline. */
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let failed = 0;
const t = (ok, msg) => { console.log((ok ? '  ok  ' : '  ❌  ') + msg); if (!ok) failed++; };

const q = read('src/index/185-client-review-queue.js.part');
const c170 = read('src/index/170-calendar-links-status.js.part');
const c190 = read('src/index/190-calendar-approval-comments.js.part');
const manifest = read('src/index/manifest.txt').split('\n');

t(manifest.indexOf('185-client-review-queue.js.part') >= 0
    && manifest.indexOf('185-client-review-queue.js.part') < manifest.indexOf('190-calendar-approval-comments.js.part'),
    'the queue fragment is in the build, before the review handlers');
t(/_calCrqBegin\('approve'/.test(c190) && /_calCrqBegin\('request'/.test(c190), 'review Approve and Request changes record the action before sending');
t((c190.match(/_calCrqDone\(/g) || []).length >= 4, 'every success path of the review handlers confirms the queue entry');
t((c190.match(/_calCrqFailed\(/g) || []).length >= 4, 'every failure path of the review handlers reports to the queue');
t(/_calCrqBegin\('approve', pid, 'all'/.test(c170), 'the legacy "Approve post" button is queued too');
t(/localStorage\.setItem\(CLIENT_REVIEW_QUEUE_KEY/.test(q), 'the queue is kept in browser storage, so it survives a reload');
t(/addEventListener\('online'/.test(q), 're-sends when the connection comes back');

t(/_calCrqBegin\('request', pid, comp, \{ body: rawDraft, actionId:/.test(c190), 'a change request stores its action id before the first send, so a replay cannot post twice');
t(/CLIENT_REVIEW_QUEUE_MAX_AGE_MS/.test(q) && !/failingSince/.test(q), 'the give-up rule is a per-entry maximum age from the click (behaviour: client-review-queue-behavior.js)');
t((c190.match(/_calCrqDone\(/g) || []).length >= 6, 'the superseded-but-saved paths confirm the queue entry too');

// Connection failures are re-sent; server refusals are not.
const fnSrc = q.match(/function _crqIsConnectionFailure[\s\S]*?\n    }\n/)[0];
const isConn = new Function('navigator', fnSrc + '; return _crqIsConnectionFailure;')({ onLine: true });
['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'HTTP 503']
    .forEach(m => t(isConn(m) === true, 'held for re-send: ' + m));
['HTTP 403', 'This item changed while your request was waiting. Your draft is preserved.', 'forbidden (code: forbidden)']
    .forEach(m => t(isConn(m) === false, 'not re-sent, shown as a failure: ' + m));
const isConnOffline = new Function('navigator', fnSrc + '; return _crqIsConnectionFailure;')({ onLine: false });
t(isConnOffline('anything') === true, 'anything that fails while the browser is offline is held');

if (failed) { console.error('client-review-queue: ' + failed + ' check(s) failed'); process.exit(1); }
console.log('client-review-queue: all checks passed');
