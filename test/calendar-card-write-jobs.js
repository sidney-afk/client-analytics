'use strict';
/*
 * Durable calendar-card write jobs harness.
 *
 * Run:  node test/calendar-card-write-jobs.js   (exit 0 = all good)
 *
 * Background: after a Linear form submit, the per-video calendar cards are
 * written by the submitting browser in a background task that waits ~15s,
 * polls Linear for up to ~110s, then POSTs one card per video. That task used
 * to live only in the tab's memory — closing/refreshing the tab in that
 * window silently lost every card (historical production incident: Linear issues
 * created, zero calendar-upsert-post executions). This change:
 *   1. records each submission as a job in localStorage
 *      (syncview_calCardJobs_v1) and marks video numbers off as their card
 *      write returns ok;
 *   2. resumes unfinished jobs on the next app load (skipping done numbers,
 *      fresh-heartbeat jobs owned by another tab, and expired jobs);
 *   3. isolates each Linear poll attempt so one transient linear-issues
 *      error no longer aborts the whole loop (which downgraded every card
 *      to the unlinked/random-id path);
 *   4. surfaces a partial/zero write via showNotify instead of console-only.
 *
 * Every behavioural test runs the REAL function brace-extracted from
 * index.html; the WIRING section asserts the shipped file still carries the fix.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  let at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  if (INDEX.slice(at - 6, at) === 'async ') at -= 6; // keep the async keyword
  let i = INDEX.indexOf('{', at), depth = 0;
  for (let j = i; j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
function def(name) { const fn = new Function('return (' + grabFunc(name) + ')')(); globalThis[name] = fn; return fn; }

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } }

/* ── stubs ─────────────────────────────────────────────────────────────── */
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => { _store.set(k, String(v)); },
  removeItem: (k) => { _store.delete(k); },
};
// The writer sleeps 15s before polling and 5s between attempts / 200ms between
// writes; collapse every wait so the suite runs instantly.
globalThis.setTimeout = (fn) => { fn(); return 0; };
const lockTails = new Map();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request(name, options, fn) {
  const next = (lockTails.get(name) || Promise.resolve()).then(fn);
  lockTails.set(name, next.catch(() => {}));
  return next;
} } } });

// Job-store constants are top-level consts in index.html; the extracted
// functions resolve them as free variables, so mirror them here.
globalThis.CAL_CARD_JOBS_KEY = 'syncview_calCardJobs_v1';
globalThis.CAL_CARD_JOB_MAX_AGE_MS = 48 * 60 * 60 * 1000;
globalThis.CAL_CARD_JOB_MAX_RUNS = 5;
globalThis.CAL_CARD_JOB_LIVE_HEARTBEAT_MS = 3 * 60 * 1000;
globalThis.CALENDAR_UPSERT_URL = 'https://n8n.example/webhook/calendar-upsert-post';
globalThis._calUpsertFetch = async (_clientOrSlug, payload) => {
  return fetch(CALENDAR_UPSERT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
};

let notifications = [];
globalThis.showNotify = (title, msg) => notifications.push({ title, msg });
globalThis._calCacheRead = () => ({ posts: [{ order_index: 10 }] }); // baseOrder = 10
let authorityState = { video: 'linear', graphics: 'linear' };
let queueDiagnostics = [];
globalThis._writeUiRefreshAuthority = async () => authorityState;
globalThis._writeUiQueueDiagnostic = (surface, outcome, item) => queueDiagnostics.push({ surface, outcome, item });

let fetchLog = [];
let fetchOkFor = () => true; // per-test override: post => bool
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  fetchLog.push({ url, body });
  const okResp = fetchOkFor(body.post);
  return { ok: okResp, json: async () => (okResp ? { ok: true, post: body.post } : { ok: false }) };
};

let linearResponses = []; // queue; each entry: array | 'throw'
let linearForceLog = [];
globalThis.loadLinearIssues = async force => {
  linearForceLog.push(force);
  const next = linearResponses.length > 1 ? linearResponses.shift() : linearResponses[0];
  if (next === 'throw') throw new Error('HTTP 502');
  return { issues: next };
};

// Real helpers under test / used by the writer.
const wlNormalizeClient = def('wlNormalizeClient');
def('_calSubNum');
const _calCardJobsRead = def('_calCardJobsRead');
for (const name of ['_calCardJobWithLock', '_calCardJobUncertain']) {
  if (INDEX.includes('function ' + name + '(')) def(name);
}
def('_calCardJobsWrite');
def('_calCardJobSave');
def('_calCardJobRemove');
const _calCardJobCreate = def('_calCardJobCreate');
def('_calCardJobTeams');
def('_calCardJobRetain');
const _resumePendingCalCardJobs = def('_resumePendingCalCardJobs');
const _writeLinearVideoCardsToCalendar = def('_writeLinearVideoCardsToCalendar');

const LIN = 'https://linear.app/acme/issue/';
function issuesFor(title, nums) {
  const out = [
    { id: 'vp', isSubIssue: false, clientName: 'Fixture Client', title, teamKey: 'VID' },
    { id: 'gp', isSubIssue: false, clientName: 'Fixture Client', title, teamKey: 'GRA' },
  ];
  nums.forEach(n => {
    out.push({ id: 'v' + n, isSubIssue: true, parentId: 'vp', identifier: 'VID-' + n, title: 'Video ' + n, url: LIN + 'VID-' + n + '/video-' + n });
    out.push({ id: 'g' + n, isSubIssue: true, parentId: 'gp', identifier: 'GRA-' + n, title: 'Video ' + n, url: LIN + 'GRA-' + n + '/video-' + n });
  });
  return out;
}
function reset() {
  globalThis._calCardJobsRetentionNotified = false;
  _store.clear(); fetchLog = []; notifications = []; linearForceLog = [];
  fetchOkFor = () => true;
  linearResponses = [issuesFor('T', [1, 2, 3])];
  globalThis._calCardJobsResumePromise = null;
  authorityState = { video: 'linear', graphics: 'linear' };
  queueDiagnostics = [];
}
const videos3 = [{ number: 1 }, { number: 2 }, { number: 3 }];

(async () => {

console.log('\n============================================================');
console.log('1) job store — create / persist / remove round-trip');
console.log('============================================================');
reset();
{
  const job = await _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  const stored = _calCardJobsRead();
  ok(stored.length === 1 && stored[0].id === job.id, 'created job is persisted to localStorage');
  ok(JSON.stringify(stored[0].videos) === JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }]), 'job stores the video numbers');
  ok(stored[0].done.length === 0 && stored[0].runs === 0, 'fresh job: nothing done, zero runs');
  _store.set(CAL_CARD_JOBS_KEY, '{corrupt');
  ok(Array.isArray(_calCardJobsRead()) && _calCardJobsRead().length === 0, 'corrupt store reads as empty, never throws');
}

console.log('\n============================================================');
console.log('2) happy path — all cards land, job is removed');
console.log('============================================================');
reset();
{
  const job = await _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  await _writeLinearVideoCardsToCalendar('Fixture Client', videos3, 'T', { mode: 'both', job });
  ok(fetchLog.length === 3, 'one upsert POST per video');
  ok(linearForceLog.length > 0 && linearForceLog.every(force => force === true),
    'post-create discovery always forces the direct no-cache Linear path');
  ok(fetchLog[0].body.client === 'fixtureclient', 'client slug is normalized (fixtureclient)');
  ok(fetchLog[0].body.post.id === 'p_lin_vid1', 'deterministic p_lin_ id from the VID sub-issue');
  ok(fetchLog[0].body.post.linear_issue_id === LIN + 'VID-1/video-1'
    && fetchLog[0].body.post.graphic_linear_issue_id === LIN + 'GRA-1/video-1', 'both Linear links paired by "Video N" title');
  ok(fetchLog[1].body.post.order_index === 12, 'order_index = cached max (10) + video number');
  ok(_calCardJobsRead().length === 0, 'completed job is removed from the store');
  ok(notifications.length === 0, 'no notification when every card lands');
}

console.log('\n============================================================');
console.log('3) partial failure — job survives with done markers + notify');
console.log('============================================================');
reset();
{
  fetchOkFor = (post) => post.name !== 'Video 2'; // Video 2 write fails
  const job = await _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  await _writeLinearVideoCardsToCalendar('Fixture Client', videos3, 'T', { mode: 'both', job });
  const stored = _calCardJobsRead();
  ok(stored.length === 1, 'incomplete job stays queued');
  ok(JSON.stringify(stored[0].done.slice().sort()) === JSON.stringify([1, 3]), 'done records exactly the numbers that landed');
  ok(stored[0].runs === 1, 'run counter bumped');
  ok(notifications.length === 1 && /2 of 3/.test(notifications[0].msg), 'shortfall is surfaced via showNotify (2 of 3)');
}

console.log('\n============================================================');
console.log('4) uncertain resume — keeps the exact missing-card attempt without replay');
console.log('============================================================');
{
  // continue from scenario 3's store state; age the heartbeat past the
  // "another tab owns this" window, as a real next-day app load would be
  const aged = _calCardJobsRead();
  aged[0].heartbeatAt = Date.now() - 4 * 60 * 1000;
  globalThis._calCardJobsWrite(aged);
  fetchOkFor = () => true; fetchLog = []; notifications = [];
  globalThis._calCardJobsResumePromise = null;
  await _resumePendingCalCardJobs(authorityState);
  ok(fetchLog.length === 0, 'resume does not resend an unacknowledged Video 2');
  ok(_calCardJobsRead()[0].card_attempts.find(row => row.number === 2).payload.post.id === 'p_lin_vid2', 'the original missing-card identity remains retained');
  ok(JSON.stringify(_calCardJobsRead()[0].done) === JSON.stringify([1, 3]), 'acknowledged siblings remain conserved with the unresolved attempt');
}

console.log('\n============================================================');
console.log('5) resume guards — live heartbeat, expiry, run cap, done jobs');
console.log('============================================================');
reset();
{
  const mk = (over) => Object.assign({
    id: 'ccj_' + Math.random().toString(36).slice(2), clientName: 'Fixture Client', formTitle: 'T',
    mode: 'both', videos: [{ number: 1 }], done: [], runs: 0, createdAt: Date.now(), heartbeatAt: 0,
  }, over);
  globalThis._calCardJobsWrite([
    mk({ id: 'ccj_live', heartbeatAt: Date.now() }),                                  // another tab mid-run
    mk({ id: 'ccj_old', createdAt: Date.now() - 49 * 60 * 60 * 1000 }),               // expired
    mk({ id: 'ccj_spent', runs: 5 }),                                                 // attempts exhausted
    mk({ id: 'ccj_done', done: [1] }),                                                // finished
  ]);
  fetchLog = []; notifications = [];
  globalThis._calCardJobsResumePromise = null;
  await _resumePendingCalCardJobs(authorityState);
  const left = _calCardJobsRead().map(j => j.id);
  ok(JSON.stringify(left) === JSON.stringify(['ccj_live','ccj_old','ccj_spent']), 'expired/spent and live-heartbeat jobs are retained; completed checkpoints are removed');
  ok(fetchLog.length === 0, 'none of the guarded jobs triggered a write');
  ok(notifications.length === 1 && /unconfirmed/.test(notifications[0].msg), 'retained debt gives one honest review notice per session');
  globalThis._calCardJobsResumePromise = null;
  const firstResume = _resumePendingCalCardJobs(authorityState);
  const secondResume = _resumePendingCalCardJobs(authorityState);
  ok(firstResume === secondResume, 'concurrent lifecycle paths share one serialized resume promise');
  await firstResume;
}

console.log('\n============================================================');
console.log('5b) authority guard — stale jobs remain after flip; outage preserves');
console.log('============================================================');
reset();
{
  const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'both');
  authorityState = null;
  await _resumePendingCalCardJobs();
  ok(_calCardJobsRead().length === 1, 'authority read failure leaves the legacy job untouched');
  authorityState = { video: 'linear', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(_calCardJobsRead().length === 1, 'a job requiring a flipped team is retained without replay');
  ok(queueDiagnostics.some(row => row.outcome === 'retained_authority' && !row.item.id),
    'authority retention has a diagnostic without identity');
}

/* Retain the historical both-team authority regression, now requiring exact
 * retention instead of deletion and unsafe recreation advice. */
reset();
{
  const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }, { number: 2 }], 'T', 'both');
  authorityState = { video: 'syncview', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(_calCardJobsRead().length === 1,
    'BOTH teams flipped: the job remains while the provider lane is closed');
  ok(queueDiagnostics.some(row => row.outcome === 'retained_authority' && !row.item.id),
    'retention is recorded without exposing job identity');
  ok(notifications.length === 1 && /unconfirmed/.test(notifications[0].msg)
     && !/Fixture Client/.test(notifications[0].msg),
    'recovery notice is honest and does not expose another client');
  ok(!/Import from Linear/i.test(notifications[0].msg),
    'and is NOT sent to Import from Linear, which mints unusable cards post-flip (item 66)');
}

/* A job with nothing left to write is not a loss, so it must not raise a
 * notice. Without this, the assertions above would also pass on a version that
 * simply notified unconditionally. */
reset();
{
  const job = await _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'both');
  job.done = [1];
  delete job.card_attempt_protocol; delete job.card_attempts; // historical acknowledged checkpoint
  await _calCardJobSave(job);
  authorityState = { video: 'syncview', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(notifications.length === 0,
    'a job whose cards all landed is discarded quietly -- the notice tracks lost work, not the discard');
}

console.log('\n============================================================');
console.log('6) poll resilience — one linear-issues error no longer unlinks cards');
console.log('============================================================');
reset();
{
  linearResponses = ['throw', issuesFor('T', [1, 2, 3])]; // attempt 0 fails, attempt 1 succeeds
  const job = await _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  await _writeLinearVideoCardsToCalendar('Fixture Client', videos3, 'T', { mode: 'both', job });
  ok(fetchLog.length === 3, 'all cards still written after a transient poll error');
  ok(fetchLog.every(f => f.body.post.id.startsWith('p_lin_')), 'cards keep their deterministic Linear-derived ids (not random fallback)');
  ok(fetchLog.every(f => f.body.post.linear_issue_id && f.body.post.graphic_linear_issue_id), 'cards keep both Linear links');
}

console.log('\n============================================================');
console.log('7) WIRING — the shipped index.html carries the fix');
console.log('============================================================');
ok(INDEX.includes("const CAL_CARD_JOBS_KEY = 'syncview_calCardJobs_v1'"), 'job store key is defined');
ok(/pending = await _linearIntakeWithLock\(\(\) => _linearIntakePending\(signature,/.test(INDEX), 'submitLinearForm records one cross-tab-locked durable native intake intent');
ok(/_writeNativeSubmissionCardsToCalendar\(job\)/.test(INDEX), 'native intake consumes checkpointed native IDs from the create response');
ok(/_resumePendingCalCardJobs\(\);/.test(INDEX), 'init() resumes pending jobs on boot');
ok(/if \(doneSet\.has\(n\)\) continue;/.test(INDEX), 'writer skips video numbers that already landed');
ok(INDEX.includes("pollTrace.push({ attempt, error: 'fetch: '"), 'per-attempt poll error isolation is in place');
ok(INDEX.includes("showNotify('Calendar sync incomplete'"), 'partial writes are surfaced to the user');

console.log('\n' + '='.repeat(60));
console.log(`OVERALL: ${fail ? 'FAIL' : 'PASS'}  (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
