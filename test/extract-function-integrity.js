'use strict';
/*
 * NO SUITE MAY EXTRACT A FUNCTION THE HAND-ROLLED SCANNER GETS WRONG.
 *
 * OPEN_REPAIRS item 96. 122 of the test files hand-roll a brace-balancing
 * extractor, and the hand-rolled one does not know about regex literals: braces
 * inside `/(\d{1,2})/` are counted, and a quote inside a character class --
 * `.replace(/[\"]/g, ...)` -- opens a string that never closes. It throws on
 * some functions and, worse, can over-extract others while still parsing, so a
 * suite asserting with `/pattern/.test(source)` can be satisfied by a
 * NEIGHBOURING function and report a pass.
 *
 * REWRITING ALL 122 FILES IS NOT THE FIX AND WAS NOT DONE. Only a handful are
 * actually wrong today; rewriting the rest would be a very large diff whose own
 * failure mode is a test that looks like it passes -- exactly the hazard being
 * closed. This guard converts a silent hazard into a loud one instead: it
 * re-derives every function every suite extracts and FAILS, naming the function
 * and the file, if the naive scanner and the correct one disagree. A file may
 * keep its local copy for as long as that copy is right.
 *
 * MEASURED 2026-09-02 over 479 distinct names across 122 files:
 *   433  identical under both scanners
 *    42  extracted from sources other than index.html
 *     2  the naive scanner cannot close at all
 *     2  genuinely divergent
 * The four were migrated to test/helpers/extract-function.js; this guard keeps
 * the other 433 honest.
 *
 * A CORRECTION WORTH KEEPING. An earlier pass reported three MORE divergences
 * (_calRenderShell, renderWeekDeadlineTimeline, _calComposerHtml). That was the
 * new extractor being wrong, not the old one: it tracked template literals with
 * a boolean, so a nested backtick inside a `${...}` closed the outer template
 * early and the function ended mid-string. It now carries a frame STACK. The
 * mistake had the same shape as the bug it was written to fix -- a lexical
 * context the scanner did not model -- which is why the helper documents both.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction, extractFunctionNaive } = require('./helpers/extract-function.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Which names does each suite extract? Read from the call sites, so a suite
   that adds a new target is covered without anyone remembering to list it. */
const CALL = /(?:grabFunc|extractFunction|grabFn|grabSource)\s*\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?['"]([A-Za-z_$][\w$]*)['"]/g;
const targets = new Map();
let filesScanned = 0;
let migrated = 0;
for (const file of fs.readdirSync(__dirname).filter(f => f.endsWith('.js'))) {
  if (file === path.basename(__filename)) continue;
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  if (!/grabFunc|extractFunction|grabFn|grabSource/.test(src)) continue;
  filesScanned++;
  /* A suite that already delegates to the shared helper is CORRECT BY
     CONSTRUCTION and is not a subject of this guard -- it may safely extract a
     function the hand-rolled scanner cannot read, which is the entire reason it
     was migrated. Only files still carrying their own copy are checked. */
  if (/require\((['"])\.\/helpers\/extract-function\.js\1\)/.test(src)) { migrated++; continue; }
  let m;
  CALL.lastIndex = 0;
  while ((m = CALL.exec(src)) !== null) {
    if (!targets.has(m[1])) targets.set(m[1], new Set());
    targets.get(m[1]).add(file);
  }
}

ok(filesScanned > 50,
  `swept ${filesScanned} test files that extract source; ${migrated} already delegate to the shared helper and are correct by construction, leaving ${filesScanned - migrated} still carrying their own copy and ${targets.size} distinct names to re-derive`);

const inIndex = [...targets].filter(([name]) => INDEX.indexOf('function ' + name + '(') >= 0);
ok(inIndex.length > 300,
  `${inIndex.length} of them are functions in index.html and are re-derived here with both scanners`);

const divergent = [];
const naiveThrew = [];
for (const [name, files] of inIndex) {
  let correct;
  try {
    correct = extractFunction(INDEX, name);
  } catch (err) {
    failures++;
    console.error(`FAIL  the CORRECT extractor could not read ${name} (${[...files].join(', ')}): ${err.message}`);
    continue;
  }
  let naive = null;
  try { naive = extractFunctionNaive(INDEX, name); } catch (err) { naiveThrew.push([name, files]); continue; }
  if (naive !== correct) divergent.push([name, files, naive.length, correct.length]);
}

/* Both lists must be EMPTY. A name in either one means some suite is asserting
   over text that is not the function it names. */
ok(naiveThrew.length === 0,
  naiveThrew.length === 0
    ? 'no suite extracts a function the hand-rolled scanner cannot close'
    : 'these are unreadable by the hand-rolled scanner and their suites must use test/helpers/extract-function.js: '
      + naiveThrew.map(([n, f]) => `${n} (${[...f].join(', ')})`).join('; '));

ok(divergent.length === 0,
  divergent.length === 0
    ? 'and no suite extracts a function the two scanners disagree about — every assertion is made over the function it names'
    : 'these extract DIFFERENTLY and their suites must use test/helpers/extract-function.js: '
      + divergent.map(([n, f, a, b]) => `${n} naive=${a} correct=${b} (${[...f].join(', ')})`).join('; '));

/* ---- The extractor's own known-hard cases, pinned ---------------------- */

/* Each of these broke a scanner in a different way. They are asserted by
   PARSE, not by length, because a length is a fact about today's file. */
[
  ['_filmsParseMonth', 'braces inside a regex quantifier `/(\\d{1,2})/` are not code braces'],
  ['_prodFocusSelectorPart', 'a double quote inside a regex character class does not open a string'],
  ['renderWeekDeadlineTimeline', 'a nested backtick inside a `${...}` does not close the outer template'],
  ['_calRenderShell', 'a long template with many interpolations closes where it really closes'],
].forEach(([name, why]) => {
  let src = null;
  try { src = extractFunction(INDEX, name); } catch (e) { /* reported below */ }
  let parses = false;
  if (src) {
    try { new Function('return (' + src.replace(/^async\s+/, '') + ');'); parses = true; }
    catch (e) { parses = /await is only valid/.test(e.message); }
  }
  ok(parses, `${name}: ${why}`);
});

console.log(failures === 0
  ? '\nextract-function integrity checks passed'
  : '\n' + failures + ' extract-function integrity check(s) failed');
process.exit(failures === 0 ? 0 : 1);
