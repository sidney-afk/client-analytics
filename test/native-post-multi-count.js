'use strict';
/*
 * Create Post can mint several posts in one submission.
 *
 * OWNER REQUEST 2026-08-20: "I want to create multiple posts. So in a new
 * batch or not, but if it's 12 posts, it would be 12 sub-issues. But if it's
 * video plus thumbnail, it would be 24, right?"  Yes -- and that arithmetic is
 * what this suite pins, because it is the number that surprises: the SMM types
 * 12 and Linear gains 24 issues.
 *
 * The gateway already accepted a list; _linearIntakeItems maps over the videos
 * and emits one item PER TEAM per video, all sharing a card id. The dialog was
 * the only thing hard-coding that list to a single entry. So the risk here is
 * not "does it expand" -- it is the CEILING. production-write refuses a payload
 * with more than MAX_INTAKE_ITEMS = 100 items, counted in ITEMS not posts, so
 * "Video + Thumbnail" must stop at 50 while a single-team mode allows 100. A
 * browser that let 51 through would surface a bare 400 invalid_intake_payload,
 * which reads to the SMM as "Create Post is broken".
 *
 * WHY THIS SUITE EXECUTES. A grep pin shipped a live ReferenceError earlier
 * this week (CAL_STATUS_NA, index.html:30560 carries the standing warning), so
 * the real functions are lifted out of index.html and RUN.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}
function extractConst(decl, endsWith) {
  const start = source.indexOf(decl);
  if (start < 0) throw new Error('missing const: ' + decl);
  const end = source.indexOf(endsWith, start);
  return source.slice(start, end + endsWith.length);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  extractConst('const CAL_NATIVE_MODE_TEAMS = {', '};'),
  extractConst('const CAL_NATIVE_MAX_INTAKE_ITEMS =', ';'),
  extractFn('_calNativePostTeamsPer'),
  extractFn('_calNativePostCountMax'),
  extractFn('_calNativePostCount'),
  extractFn('_calNativePostCountHint'),
  extractFn('_linearIntakeItems'),
  'this.max = _calNativePostCountMax; this.count = _calNativePostCount;',
  'this.hint = _calNativePostCountHint; this.items = _linearIntakeItems;',
  'this.CAP = CAL_NATIVE_MAX_INTAKE_ITEMS;',
  // _linearIntakeItems reads these two free identifiers from module scope.
  'var PROD_CREATED_STATUS = "todo";',
  'function _linearVideoBrief() { return ""; }',
].join('\n'), sandbox);
const { max, count, hint, items, CAP } = sandbox;
ok(typeof max === 'function' && typeof items === 'function',
  'the real count helpers and the real item expander extract and execute (harness is not vacuous)');

// 1. THE OWNER'S ARITHMETIC, end to end through the REAL expander.
const videos = n => Array.from({ length: n }, (u, i) => ({ number: i + 1, dueDate: null }));
const both12 = items('both', videos(12), 'req12', 'calendar');
ok(both12.length === 24, '12 posts in Video + Thumbnail produce 24 sub-issues');
ok(new Set(both12.map(i => i.card_id)).size === 12, '...spread across exactly 12 cards');
ok(both12.filter(i => i.team === 'video').length === 12
  && both12.filter(i => i.team === 'graphics').length === 12,
'...split 12 video and 12 graphics');
const vid12 = items('video', videos(12), 'req12', 'calendar');
ok(vid12.length === 12 && vid12.every(i => i.team === 'video'),
  '12 posts in Video only produce 12 sub-issues, all video');
ok(items('thumbnail', videos(12), 'r', 'calendar').length === 12,
  '12 posts in Thumbnail only produce 12 sub-issues');

// 2. EVERY POST IS DISTINCT — a shared card id across posts would collapse the
//    batch into one card and silently lose 11 of the 12.
ok(new Set(vid12.map(i => i.card_id)).size === 12, 'each post gets its own card id');
ok(vid12.map(i => i.videoNumber).join(',') === '1,2,3,4,5,6,7,8,9,10,11,12',
  'posts are numbered 1..N in order');
ok(vid12.map(i => i.sort_key).join(',') === '0,1,2,3,4,5,6,7,8,9,10,11',
  'sort keys preserve the requested order');

// 3. THE CEILING. Counted in ITEMS, so "both" halves it.
ok(max('both') === 50, 'Video + Thumbnail stops at 50 posts (50 x 2 = the 100-item cap)');
ok(max('video') === 100 && max('thumbnail') === 100, 'a single-team mode allows 100 posts');
ok(items('both', videos(max('both')), 'r', 'calendar').length === CAP,
  'the cap is exact: the largest allowed Video + Thumbnail request is exactly 100 items');
ok(items('video', videos(max('video')), 'r', 'calendar').length === CAP,
  'and so is the largest allowed single-team request');

// 4. THE CLAMP. Switching mode must pull an over-max count back down, or the
//    browser posts 102 items and the SMM sees a bare 400.
ok(count({ mode: 'both', postCount: 80 }) === 50,
  '80 posts staged then switched to Video + Thumbnail clamps to 50');
ok(count({ mode: 'video', postCount: 80 }) === 80, '80 posts is fine in a single-team mode');
ok(count({ mode: 'video', postCount: 500 }) === 100, 'an absurd count clamps to the mode ceiling');

// 5. GARBAGE IN. The field is user-editable; every bad shape must floor to 1,
//    never 0 or NaN — a 0-item payload is refused by the gateway too.
for (const bad of [0, -5, null, undefined, '', 'abc', NaN, 1.9, '3.7']) {
  const got = count({ mode: 'both', postCount: bad });
  ok(Number.isInteger(got) && got >= 1 && got <= 50,
    `a count of ${JSON.stringify(bad)} resolves to a usable integer (${got}), never 0 or NaN`);
}
ok(count({ mode: 'both', postCount: '12' }) === 12, 'the input\'s string value is read as a number');
ok(count({}) === 1 && count(null) === 1, 'a missing count defaults to one post — the old behaviour');

// 6. THE HINT states the surprising total before submitting.
ok(/12 posts/.test(hint('both', 12)) && /24 sub-issues/.test(hint('both', 12)),
  'the hint tells the SMM 12 posts means 24 sub-issues BEFORE they submit');
ok(/12 video/.test(hint('both', 12)) && /12 thumbnail/.test(hint('both', 12)),
  'and breaks that down by team');
ok(/1 post\b/.test(hint('video', 1)) && /\b1 sub-issue\b/.test(hint('video', 1)),
  'singulars read correctly at one post');
ok(!/\(/.test(hint('video', 12)), 'a single-team mode gets no misleading team breakdown');

// 7. THE WIRING. Everything above proves the helpers and the expander are
//    correct -- and would keep passing if the dialog still sent one hard-coded
//    video, which is exactly the bug being fixed. So pin the submit path too.
//    (Source-level by necessity: the submit body is an async closure over the
//    live DOM. It is paired with the executing checks above, not a substitute.)
const submit = source.slice(source.indexOf("const choice = latest ? 'latest' : 'new';"));
const head = submit.slice(0, submit.indexOf('const signature'));
ok(/const postCount = _calNativePostCount\(state\);/.test(head),
  'the submit path re-derives the clamped count instead of trusting the input');
ok(/Array\.from\(\{ length: postCount \}/.test(head),
  'the videos list is built from that count, not hard-coded to one entry');
ok(!/const videos = \[\{ number: 1,/.test(head),
  'the old single-entry hard-coded list is gone');
ok(/post_count: postCount/.test(submit.slice(0, submit.indexOf('let pending'))),
  'the count is part of the resume signature, so a 3-post job never resumes under a 12-post request');
ok(/videos: videos\.map\(video => \(\{ number: video\.number \}\)\)/.test(submit),
  'telemetry reports the real post list rather than a fixed single entry');

if (failures) {
  console.error(`\n${failures} multi-post check(s) failed.`);
  process.exit(1);
}
console.log('\nCreate Post multi-count checks passed.');
