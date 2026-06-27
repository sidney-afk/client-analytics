'use strict';
/*
 * kasper_finish_log — durable per-click finish record (regression test).
 *
 * Run:  node test/kasper-finish-log.js   (exit 0 = all good)
 *
 * BACKGROUND. `kasper_finished_at` is a SINGLE overwritten stamp, so it cannot
 * reveal the recurring review-card bug's fingerprint: a finished card that
 * re-surfaces and gets FINISHED AGAIN later. `_kasperAppendFinishLog` appends one
 * entry per Finish click to `kasper_finish_log` (a JSON array in a text column),
 * capturing the gap since the previous finish and a best-effort cause. This
 * asserts the REAL shipping function (extracted by name, brace-balanced) builds
 * those entries correctly. See kasper-finish-log-migration.sql.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// We test _kasperAppendFinishLog in isolation. Its only outside reference is
// _calLatestMsgCreatedAt — stub it (via `ref.v`) so the test controls the
// "latest message time". The factory defines the stub, then the REAL extracted
// function (which closes over the stub), and returns it.
const fn = grabFunc('_kasperAppendFinishLog');
const ref = { v: '' };
// eslint-disable-next-line no-new-func
const factory = new Function('ref', `
  function _calLatestMsgCreatedAt(){ return ref.v; }
  ${fn}
  return _kasperAppendFinishLog;
`);
const _kasperAppendFinishLog = factory(ref);

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('✓  ' + name); }
  else { fail++; console.log('✗  ' + name + '  (got ' + JSON.stringify(got) + ')'); }
}
function lastEntry(post) { return JSON.parse(post.kasper_finish_log).slice(-1)[0]; }
function isoAgo(min) { return new Date(Date.now() - min * 60000).toISOString(); }

// 1) First finish on a fresh card → one 'initial' entry, no prev/gap.
{
  ref.v = '';
  const post = { graphic_status: 'Tweaks Needed', video_status: 'Client Approval' };
  _kasperAppendFinishLog(post, isoAgo(0));
  const arr = JSON.parse(post.kasper_finish_log);
  const e = arr[0];
  ok('first finish → 1 entry', arr.length === 1, arr.length);
  ok('first finish → why=initial', e.why === 'initial', e.why);
  ok('first finish → prev=null', e.prev === null, e.prev);
  ok('first finish → gap_min=null', e.gap_min === null, e.gap_min);
  ok('first finish → captures component statuses', e.graphic_status === 'Tweaks Needed' && e.video_status === 'Client Approval', e);
}

// 2) Re-finish after a component re-entered Kasper Approval (status_at advanced
//    past the prior finish), no new message → 'status-reentered', gap computed.
{
  ref.v = isoAgo(125);                       // newest message is OLDER than prev finish
  const prev = isoAgo(120);                  // finished 2h ago
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, prev: null, gap_min: null, why: 'initial' }]),
    graphic_status: 'Kasper Approval',
    graphic_status_at: isoAgo(5),            // graphic re-entered KA 5 min ago (after prev)
    video_status_at: isoAgo(200),
  };
  _kasperAppendFinishLog(post, isoAgo(0));
  const e = lastEntry(post);
  ok('re-finish → appends (2 entries)', JSON.parse(post.kasper_finish_log).length === 2, JSON.parse(post.kasper_finish_log).length);
  ok('re-finish → why=status-reentered', e.why === 'status-reentered', e.why);
  ok('re-finish → prev = prior finish', e.prev === prev, e.prev);
  ok('re-finish → gap_min ~120', e.gap_min >= 119 && e.gap_min <= 121, e.gap_min);
}

// 3) Re-finish because a NEW message arrived after the prior finish → 'new-message'
//    (message recency wins even if a status also moved).
{
  const prev = isoAgo(90);
  ref.v = isoAgo(10);                        // newest message is NEWER than prev finish
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, why: 'initial' }]),
    graphic_status_at: isoAgo(5),            // a status also moved — message must still win
    video_status_at: isoAgo(5),
  };
  _kasperAppendFinishLog(post, ref.v);
  ok('re-finish w/ newer message → why=new-message', lastEntry(post).why === 'new-message', lastEntry(post).why);
}

// 4) Re-finish with nothing newer than the prior finish → 'refinish-no-change'.
{
  const prev = isoAgo(60);
  ref.v = isoAgo(200);                       // message older than prev
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, why: 'initial' }]),
    graphic_status_at: isoAgo(200),          // status older than prev
    video_status_at: isoAgo(200),
  };
  _kasperAppendFinishLog(post, prev);
  ok('re-finish w/ no change → why=refinish-no-change', lastEntry(post).why === 'refinish-no-change', lastEntry(post).why);
}

// 5) Log is capped at 50 entries (keeps the most recent).
{
  ref.v = '';
  const seed = [];
  for (let i = 0; i < 60; i++) seed.push({ at: isoAgo(1000 - i), why: 'x', n: i });
  const post = { kasper_finish_log: JSON.stringify(seed) };
  _kasperAppendFinishLog(post, isoAgo(0));
  const arr = JSON.parse(post.kasper_finish_log);
  ok('cap → length 50', arr.length === 50, arr.length);
  ok('cap → drops oldest (keeps newest tail)', arr[0].n === 11, arr[0].n);
  ok('cap → last entry is the new click', arr[49].why === 'initial', arr[49].why);
}

// 6) Corrupt/absent existing log never throws — starts fresh.
{
  ref.v = '';
  const post = { kasper_finish_log: 'not json {' };
  _kasperAppendFinishLog(post, isoAgo(0));
  const arr = JSON.parse(post.kasper_finish_log);
  ok('corrupt log → recovers to 1 entry', arr.length === 1, arr.length);
}

console.log('\n' + (fail ? (fail + ' FAILED') : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
