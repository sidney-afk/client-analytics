'use strict';
/*
 * Durable calendar-card write jobs harness.
 *
 * Run:  node test/calendar-card-write-jobs.js   (exit 0 = all good)
 *
 * Background: after a Linear form submit, the per-video calendar cards used to
 * be written by the submitting browser in a background task that waited ~15s,
 * polled Linear for up to ~110s, then POSTed one card per video
 * (`_writeLinearVideoCardsToCalendar`, discovering the just-created sub-issues
 * through `wlDiscoverProviderIssues`). That task used to live only in the
 * tab's memory -- closing/refreshing the tab in that window silently lost
 * every card (historical production incident: Linear issues created, zero
 * calendar-upsert-post executions). The durable-job machinery below (record,
 * resume, isolate, notify) fixed that and is still exactly how a native
 * submission's cards land, through `_writeNativeSubmissionCardsToCalendar`
 * (covered elsewhere) and the SAME job store as this file exercises.
 *
 * RETIRED 2026-09-20 (LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md, "what needs code"
 * item 2): every active client is native-enrolled now
 * (`write_ui_reroute_clients`, 43 of 43 measured 2026-09-20), and a native
 * submission never reaches `_writeLinearVideoCardsToCalendar` at all -- it
 * links its cards through `_writeNativeSubmissionCardsToCalendar` from its own
 * create-response IDs. `_writeLinearVideoCardsToCalendar` and
 * `wlDiscoverProviderIssues` (the direct Linear poll) are retired: the
 * discovery reader is deleted outright, and the writer holds visibly --
 * never falls back to a live Linear discovery read -- for the only paths that
 * can still reach it (a stale persisted job queued before its client
 * enrolled, or the retained rollback submission entry point). Section 2 below
 * is this file's offline coverage of that hold state, for both the
 * direct-call and the resumed-job entry points.
 *
 * Every behavioural test runs the REAL function brace-extracted from
 * index.html; the WIRING section asserts the shipped file still carries the
 * fix and that the retired discovery path is actually gone, not merely
 * unwired.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function');
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
// The (former) writer used to sleep 15s before polling and 5s between
// attempts / 200ms between writes; collapse any wait so the suite runs
// instantly, should a future caller reintroduce one.
globalThis.setTimeout = (fn) => { fn(); return 0; };

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
  return { json: async () => (okResp ? { ok: true, post: body.post } : { ok: false }) };
};

// Real helpers under test / used by the writer.
const wlNormalizeClient = def('wlNormalizeClient');
def('_calSubNum');
const _calCardJobsRead = def('_calCardJobsRead');
def('_calCardJobsWrite');
def('_calCardJobSave');
def('_calCardJobRemove');
const _calCardJobCreate = def('_calCardJobCreate');
def('_calCardJobTeams');
const _resumePendingCalCardJobs = def('_resumePendingCalCardJobs');
const _writeLinearVideoCardsToCalendar = def('_writeLinearVideoCardsToCalendar');

function reset() {
  _store.clear(); fetchLog = []; notifications = [];
  fetchOkFor = () => true;
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
  const job = _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  const stored = _calCardJobsRead();
  ok(stored.length === 1 && stored[0].id === job.id, 'created job is persisted to localStorage');
  ok(JSON.stringify(stored[0].videos) === JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }]), 'job stores the video numbers');
  ok(stored[0].done.length === 0 && stored[0].runs === 0, 'fresh job: nothing done, zero runs');
  _store.set(CAL_CARD_JOBS_KEY, '{corrupt');
  ok(Array.isArray(_calCardJobsRead()) && _calCardJobsRead().length === 0, 'corrupt store reads as empty, never throws');
}

console.log('\n============================================================');
console.log('2) RETIRED path — the writer holds, and never calls Linear');
console.log('============================================================');
/* LINEAR_EXIT_STEP26_NATIVE_WORKLOAD.md, "what needs code" item 2. The two
   entry points that could still reach this function -- a direct post-submit
   call (the retained rollback entry point, `_submitLinearFormOnce`) and a
   resumed pre-enrollment job (`_resumePendingCalCardJobs`, when the team is
   still Linear-authoritative) -- both hit the exact same hold: zero fetch
   calls (no cards written, unlinked or otherwise), zero polling, the job is
   settled (never left to retry into a call that will never succeed), and the
   user is told plainly instead of the cards silently vanishing. */
reset();
{
  const job = _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  await _writeLinearVideoCardsToCalendar('Fixture Client', videos3, 'T', { mode: 'both', job });
  ok(fetchLog.length === 0, 'direct call: no calendar-upsert POST is ever made');
  ok(_calCardJobsRead().length === 0, 'direct call: the job is removed rather than left to retry forever');
  ok(notifications.length === 1, 'direct call: the user is told, exactly once');
  ok(/Fixture Client/.test(notifications[0].msg) && /not enrolled/i.test(notifications[0].msg),
    'direct call: the notice names the client and says it is not enrolled');
  ok(/3 card/.test(notifications[0].msg) && /Create Post/.test(notifications[0].msg),
    'direct call: the notice says how many cards and how to add them manually');
}
reset();
{
  // Same call, but with no job (the shape a bare invocation would use) --
  // must not throw for lack of one to remove.
  await _writeLinearVideoCardsToCalendar('Fixture Client', videos3, 'T', { mode: 'both' });
  ok(fetchLog.length === 0 && notifications.length === 1, 'a call with no job still holds cleanly (nothing to remove)');
}
reset();
{
  // A single video gets correct singular/plural copy.
  await _writeLinearVideoCardsToCalendar('Fixture Client', [{ number: 1 }], 'T', { mode: 'video' });
  ok(/1 card /.test(notifications[0].msg) && !/1 cards /.test(notifications[0].msg),
    'the hold notice uses "1 card", not "1 cards"');
}
reset();
{
  // The resumed-job entry point: a job persisted while its team was still
  // Linear-authoritative (authorityState default above) is neither discarded
  // (that branch is for a team that has since flipped native) nor written --
  // it holds through the exact same function.
  const job = _calCardJobCreate('Fixture Client', videos3, 'T', 'both');
  authorityState = { video: 'linear', graphics: 'linear' };
  await _resumePendingCalCardJobs(authorityState);
  ok(fetchLog.length === 0, 'resume: no calendar-upsert POST is made for a still-Linear-authoritative team');
  ok(_calCardJobsRead().length === 0, 'resume: the stale job is settled, not left to retry indefinitely');
  ok(notifications.length === 1 && /Fixture Client/.test(notifications[0].msg) && /not enrolled/i.test(notifications[0].msg),
    'resume: the same visible hold fires, not a silent drop');
  ok(!queueDiagnostics.some(row => row.outcome === 'discarded_authority'),
    'resume: this is the hold path, not the discarded_authority path -- the two must stay distinct');
}

console.log('\n============================================================');
console.log('3) resume guards — live heartbeat, expiry, run cap, done jobs');
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
  ok(JSON.stringify(left) === JSON.stringify(['ccj_live']), 'expired/spent/finished jobs are dropped; live-heartbeat job is left for its owner');
  ok(fetchLog.length === 0, 'none of the guarded jobs triggered a write');
  ok(notifications.length === 2 && notifications.every(n => /Create Post/.test(n.msg)), 'expired + spent jobs surface the manual backfill path');
  globalThis._calCardJobsResumePromise = null;
  const firstResume = _resumePendingCalCardJobs(authorityState);
  const secondResume = _resumePendingCalCardJobs(authorityState);
  ok(firstResume === secondResume, 'concurrent lifecycle paths share one serialized resume promise');
  await firstResume;
}

console.log('\n============================================================');
console.log('3b) authority guard — stale jobs discard after flip; outage preserves');
console.log('============================================================');
reset();
{
  const job = _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'both');
  authorityState = null;
  await _resumePendingCalCardJobs();
  ok(_calCardJobsRead().length === 1, 'authority read failure leaves the legacy job untouched');
  authorityState = { video: 'linear', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(_calCardJobsRead().length === 0, 'a job requiring a flipped team is terminally discarded');
  ok(queueDiagnostics.some(row => row.outcome === 'discarded_authority' && row.item.id === job.id),
    'authority discard is retained in the local public-safe diagnostic');
}

/* OPEN_REPAIRS item 65. Everything above 3b pins a world that ended on
 * 2026-08-16, and 3b itself stops at the MIXED shape -- so the branch that now
 * catches EVERY job was only ever exercised in the configuration where it
 * caught some. Post-F1(video) both teams are SyncView-authoritative, this
 * discard is the only path a pending job can take, and it used to take it in
 * total silence while the retry-cap branch beside it -- which drops strictly
 * less work -- notified. These four run under today's live shape. */
reset();
{
  const job = _calCardJobCreate('Fixture Client', [{ number: 1 }, { number: 2 }], 'T', 'both');
  authorityState = { video: 'syncview', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(_calCardJobsRead().length === 0,
    'BOTH teams flipped: the job is discarded, as it must be -- the lane it writes through is closed');
  ok(queueDiagnostics.some(row => row.outcome === 'discarded_authority' && row.item.id === job.id),
    'the discard is still recorded in the diagnostic ring');
  ok(notifications.length === 1 && /2 calendar card/.test(notifications[0].msg)
     && /Fixture Client/.test(notifications[0].msg),
    'the user is TOLD, and told how many cards and for which client -- not silently dropped');
  ok(!/Import from Linear/i.test(notifications[0].msg),
    'and is NOT sent to Import from Linear, which mints unusable cards post-flip (item 66)');
}

/* A job with nothing left to write is not a loss, so it must not raise a
 * notice. Without this, the assertions above would also pass on a version that
 * simply notified unconditionally. */
reset();
{
  const job = _calCardJobCreate('Fixture Client', [{ number: 1 }], 'T', 'both');
  job.done = [1];
  _calCardJobSave(job);
  authorityState = { video: 'syncview', graphics: 'syncview' };
  await _resumePendingCalCardJobs(authorityState);
  ok(notifications.length === 0,
    'a job whose cards all landed is discarded quietly -- the notice tracks lost work, not the discard');
}

console.log('\n============================================================');
console.log('4) WIRING — the shipped index.html carries the fix, and the');
console.log('   retired discovery path is actually gone');
console.log('============================================================');
ok(INDEX.includes("const CAL_CARD_JOBS_KEY = 'syncview_calCardJobs_v1'"), 'job store key is defined');
ok(/pending = await _linearIntakeWithLock\(\(\) => _linearIntakePending\(signature,/.test(INDEX), 'submitLinearForm records one cross-tab-locked durable native intake intent');
ok(/_writeNativeSubmissionCardsToCalendar\(job\)/.test(INDEX), 'native intake consumes checkpointed native IDs from the create response');
ok(/_resumePendingCalCardJobs\(\);/.test(INDEX), 'init() resumes pending jobs on boot');
ok(!/function wlDiscoverProviderIssues\(/.test(INDEX),
  'wlDiscoverProviderIssues -- the direct Linear discovery poll -- no longer exists');
ok(!/\(\{ issues \} = await wlDiscoverProviderIssues\(\)\);/.test(INDEX),
  'and nothing still calls it by that shape');
{
  const writer = extractFunction(INDEX, '_writeLinearVideoCardsToCalendar');
  ok(!/wlDiscoverProviderIssues|_wlLegacyLoadLinearIssues|LINEAR_ISSUES_WEBHOOK|setTimeout\(r, 15000\)/.test(writer),
    '_writeLinearVideoCardsToCalendar reaches no Linear read of any kind, directly or through the old poll delay');
  ok(/showNotify\(/.test(writer), 'and it always tells the user rather than failing silently');
}

console.log('\n' + '='.repeat(60));
console.log(`OVERALL: ${fail ? 'FAIL' : 'PASS'}  (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);

})().catch(e => { console.error(e); process.exit(1); });
