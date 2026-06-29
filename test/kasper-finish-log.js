'use strict';
/*
 * kasper_finish_log — durable, self-describing per-click finish record (regression).
 *
 * Run:  node test/kasper-finish-log.js   (exit 0 = all good)
 *
 * BACKGROUND. `kasper_finished_at` is a SINGLE overwritten stamp, so it can't reveal
 * the recurring review-card bug: a finished card that re-surfaces and gets FINISHED
 * AGAIN. `_kasperAppendFinishLog` appends one entry per Finish hand-off to
 * `kasper_finish_log`, rich enough to CLASSIFY a recurrence without a manual Linear
 * lookup: gap since the previous finish, message author, per-component tweak rounds,
 * Linear links, and a `why` that flags the bug-candidate bucket ('recheck'). This
 * asserts the REAL shipping function (extracted by name, brace-balanced).
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

// Stub the three calendar helpers the logger reaches: component list, status
// normalizer (identity here), and the per-component comment list (fed via
// post.__msgs). The factory defines the stubs, then the REAL extracted function.
const fn = grabFunc('_kasperAppendFinishLog');
// eslint-disable-next-line no-new-func
const factory = new Function('COMPS', `
  function _calComponentsFor(){ return COMPS; }
  function _calNormStatus(s){ return s || ''; }
  function _calCommentsFor(post, comp){ return (post.__msgs && post.__msgs[comp]) || []; }
  ${fn}
  return _kasperAppendFinishLog;
`);
const _kasperAppendFinishLog = factory(['video', 'graphic', 'caption']);

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('✓  ' + name); }
  else { fail++; console.log('✗  ' + name + '  (got ' + JSON.stringify(got) + ')'); }
}
function last(post) { return JSON.parse(post.kasper_finish_log).slice(-1)[0]; }
function isoAgo(min) { return new Date(Date.now() - min * 60000).toISOString(); }
function tweak(round, role, at) { return { is_tweak: true, round: round, role: role, created_at: at }; }
function msg(role, at) { return { is_tweak: false, role: role, created_at: at }; }

// 1) First finish → 'initial', captures statuses, rounds, links, last_msg.
{
  const post = {
    video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'For SMM Approval',
    linear_issue_id: 'https://linear.app/x/VID-1', graphic_linear_issue_id: 'https://linear.app/x/GRA-1',
    __msgs: { video: [tweak(1, 'kasper', isoAgo(5))], graphic: [], caption: [] },
  };
  _kasperAppendFinishLog(post);
  const e = last(post);
  ok('initial → why=initial', e.why === 'initial', e.why);
  ok('initial → kind=handoff', e.kind === 'handoff', e.kind);
  ok('initial → prev/gap null', e.prev === null && e.gap_min === null, e);
  ok('initial → statuses captured', e.statuses.video === 'Tweaks Needed' && e.statuses.graphic === 'Approved', e.statuses);
  ok('initial → rounds (max tweak round per comp)', e.rounds.video === 1 && e.rounds.graphic === 0, e.rounds);
  ok('initial → links captured', e.links.video.endsWith('VID-1') && e.links.graphic.endsWith('GRA-1'), e.links);
  ok('initial → last_msg captured', e.last_msg && e.last_msg.comp === 'video' && e.last_msg.role === 'kasper', e.last_msg);
}

// 2) Re-finish after someone ELSE replied → 'new-message'.
{
  const prev = isoAgo(120);
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, why: 'initial', rounds: { video: 1, graphic: 0, caption: 0 } }]),
    video_status: 'Tweaks Needed',
    __msgs: { video: [tweak(1, 'kasper', isoAgo(125)), msg('smm', isoAgo(10))], graphic: [], caption: [] },
  };
  _kasperAppendFinishLog(post);
  const e = last(post);
  ok('re-finish w/ later SMM reply → why=new-message', e.why === 'new-message', e.why);
  ok('new-message → last_msg.role=smm', e.last_msg.role === 'smm', e.last_msg);
  ok('new-message → gap_min ~120', e.gap_min >= 119 && e.gap_min <= 121, e.gap_min);
}

// 3) Re-finish after a fresh tweak round (editor reworked, Kasper re-asked) → 'new-round'.
{
  const prev = isoAgo(90);
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, why: 'initial', rounds: { video: 1, graphic: 0, caption: 0 } }]),
    video_status: 'Tweaks Needed',
    // newest message is Kasper's own round-2 tweak (so NOT new-message), and round grew 1→2
    __msgs: { video: [tweak(1, 'kasper', isoAgo(200)), tweak(2, 'kasper', isoAgo(5))], graphic: [], caption: [] },
  };
  _kasperAppendFinishLog(post);
  const e = last(post);
  ok('re-finish w/ new tweak round → why=new-round', e.why === 'new-round', e.why);
  ok('new-round → rounds.video=2', e.rounds.video === 2, e.rounds);
}

// 4) Re-finish with NOTHING new (no reply, no new round) → 'recheck' (bug-candidate).
{
  const prev = isoAgo(60);
  const post = {
    kasper_finished_at: prev,
    kasper_finish_log: JSON.stringify([{ at: prev, why: 'initial', rounds: { video: 1, graphic: 0, caption: 0 } }]),
    video_status: 'Tweaks Needed',
    __msgs: { video: [tweak(1, 'kasper', isoAgo(200))], graphic: [], caption: [] },  // all older than prev
  };
  _kasperAppendFinishLog(post);
  ok('re-finish w/ nothing new → why=recheck', last(post).why === 'recheck', last(post).why);
}

// 5) rounds = max tweak round; non-tweak comments and deleted tweaks are ignored.
{
  const post = {
    __msgs: { video: [], graphic: [
      tweak(1, 'kasper', isoAgo(50)),
      tweak(3, 'kasper', isoAgo(40)),
      { is_tweak: false, round: 9, role: 'smm', created_at: isoAgo(30) },        // plain comment, ignored
      { is_tweak: true, round: 5, role: 'kasper', created_at: isoAgo(20), deleted: true }, // deleted, ignored
    ], caption: [] },
  };
  _kasperAppendFinishLog(post);
  ok('rounds → max tweak round, ignores plain + deleted', last(post).rounds.graphic === 3, last(post).rounds);
}

// 6) links are null when a component has no Linear issue.
{
  const post = { __msgs: { video: [], graphic: [], caption: [] } };
  _kasperAppendFinishLog(post);
  const e = last(post);
  ok('no links → null', e.links.video === null && e.links.graphic === null, e.links);
}

// 7) Capped at 50, keeps the newest.
{
  const seed = [];
  for (let i = 0; i < 60; i++) seed.push({ at: isoAgo(1000 - i), why: 'x', n: i });
  const post = { kasper_finish_log: JSON.stringify(seed), __msgs: { video: [], graphic: [], caption: [] } };
  _kasperAppendFinishLog(post);
  const arr = JSON.parse(post.kasper_finish_log);
  ok('cap → length 50', arr.length === 50, arr.length);
  ok('cap → drops oldest (keeps tail)', arr[0].n === 11, arr[0].n);
  ok('cap → last is the new click', arr[49].kind === 'handoff', arr[49]);
}

// 8) Corrupt existing log never throws — recovers to a single entry.
{
  const post = { kasper_finish_log: 'not json {', __msgs: { video: [], graphic: [], caption: [] } };
  _kasperAppendFinishLog(post);
  ok('corrupt log → recovers to 1 entry', JSON.parse(post.kasper_finish_log).length === 1, post.kasper_finish_log);
}

console.log('\n' + (fail ? (fail + ' FAILED') : 'ALL ' + pass + ' PASSED'));
process.exit(fail ? 1 : 0);
