#!/usr/bin/env node
'use strict';
// A gate that separates code from prose is only as good as the separation.
// This pins the separation itself.
//
// Seventeen gates here used to strip block comments with a plain regex, which
// opens a comment at any "/" followed by "*" -- including the pair inside a
// string, a MIME type or an HTML attribute -- and then runs to the next closing
// delimiter anywhere in the file. In index.html that deleted about 64k
// characters of real code (two accept="...,video/*" attributes), and every
// NEGATIVE assertion over that region had been passing vacuously: the text they
// forbid was gone before they looked. OPEN_REPAIRS 145 has the measurements.
//
// So: nobody reintroduces the raw regex, and the helper keeps behaving.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { stripBlockComments, stripComments } = require('./helpers/strip-comments');

const ROOT = path.resolve(__dirname, '..');
const SELF = 'test/comment-strip-is-honest.js';

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

// ---- 1. The helper declines what is not a comment -----------------------

const DECLINE = [
  ['accept="video/mp4,video/quicktime,video/webm,video/*">', 'an HTML accept attribute'],
  ['headers: { accept: "*/*", range: "0-1" }', 'a wildcard MIME type'],
  ["await page.route('**/*', handler)", 'a Playwright route glob'],
  ["'supabase/functions/linear-outbound/**',", 'a workflow path glob'],
  ["parseExactCount('0-0/*')", 'a PostgREST content-range'],
];
for (const [src, what] of DECLINE) {
  const kept = stripBlockComments(src + '\nconst after = 1;', ' ');
  ok(kept.includes('after'), 'it does not open a comment inside ' + what + ' — the code after it survives');
}

// ---- 2. And still removes what IS a comment, including mid-line ---------

const ACCEPT = [
  ['/* a whole-line comment */\nconst a = 1;', 'a whole-line block comment'],
  ['} catch (e) { /* ignored on purpose */ }\nconst a = 1;', 'one that opens mid-line after a brace'],
  ['function f(/* root */) {}\nconst a = 1;', 'one standing in for an argument'],
  ['background: var(--x); /* why this colour */\nconst a = 1;', 'one trailing a CSS declaration'],
];
for (const [src, what] of ACCEPT) {
  const out = stripBlockComments(src, ' ');
  ok(!/comment |ignored|root |colour/.test(out) && out.includes('const a = 1;'),
    'it does remove ' + what);
}

// ---- 3. The blind spot is actually closed on the real files -------------

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const naive = INDEX.replace(/\/\*[\s\S]*?\*\//g, ' ');
const guarded = stripBlockComments(INDEX, ' ');
/* The swallowed regions are the two upload flows in full: 24 functions,
   _tkWireFormEvents through _ttpRenderQueue. Name two, so a reader can see what
   was invisible rather than take a character count on trust. */
for (const fn of ['_tkSubmit', '_ttpPollStatus']) {
  ok(!naive.includes('function ' + fn), 'the old regex really did delete ' + fn
    + ' — this gate is measuring something, not asserting a tautology');
  ok(guarded.includes('function ' + fn), 'and the helper keeps ' + fn);
}
ok(guarded.length - naive.length > 50000,
  'the recovered region is the size the ledger records: ' + (guarded.length - naive.length) + ' characters');

// ---- 4. Nobody reintroduces the raw regex ------------------------------

const files = cp.execSync("git ls-files 'test/*.js' 'test/**/*.js' 'scripts/*.js' 'qa/**/*.js' 'docs/syncview-design/tests/*.js'",
  { cwd: ROOT, encoding: 'utf8' }).split('\n').map(s => s.trim()).filter(Boolean);
const offenders = [];
for (const f of files) {
  if (f === SELF) continue;                       // this file names the pattern on purpose
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  // Read the CODE, not the prose: helpers/strip-comments.js explains the bug by
  // quoting it, and an explanation is not a use. (Asserting against raw source
  // here would fail on the documentation — the exact mistake being gated.)
  if (/\.replace\(\/\\\/\\\*\[\\s\\S\]\*\?\\\*\\\/\/g/.test(stripComments(src, ' '))) offenders.push(f);
}
ok(offenders.length === 0,
  'no gate strips block comments with the raw regex' + (offenders.length ? ' — found in: ' + offenders.join(', ') : ''));

if (failures) { console.log('\n' + failures + ' check(s) failed.'); process.exit(1); }
console.log('\ncomment strip honesty checks passed');
