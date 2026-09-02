'use strict';
/*
 * NO SUITE MAY ASSERT OVER TEXT THAT IS NOT THE FUNCTION IT NAMES.
 *
 * OPEN_REPAIRS item 96. Most of the test files hand-roll a brace-balancing
 * extractor to lift a function out of index.html. The hand-rolled ones do not
 * know about regex literals: braces inside `/(\d{1,2})/` get counted, and in
 * the quote-tracking variants a quote inside a character class --
 * `.replace(/[\"]/g, ...)` -- opens a string that never closes. They throw on
 * some functions and, worse, can over-extract others while still parsing, so a
 * suite asserting with `/pattern/.test(source)` can be satisfied by a
 * NEIGHBOURING function and report a pass.
 *
 * REWRITING EVERY FILE IS NOT THE FIX AND WAS NOT DONE. Rewriting them all
 * would be a very large diff whose own failure mode is a test that looks like
 * it passes -- exactly the hazard being closed. This guard makes the hazard
 * loud instead: it re-derives every function every suite extracts and FAILS,
 * naming the function and the file, when a suite's own extraction is not the
 * function it names. A file may keep its local copy for as long as that copy is
 * right; a file that delegates to test/helpers/extract-function.js is correct by
 * construction and is exempt.
 *
 * ---------------------------------------------------------------------------
 * TWO CORRECTIONS FROM REVIEW ON #1220, both about this guard rather than the
 * extractor, and both the same mistake: it described the suite instead of
 * reading it.
 *
 * 1. IT ONLY SAW DIRECT CALLS. The call-site regex matched four hardcoded
 *    helper names taking a literal. But `calendar-linear-link-move.js` reaches
 *    its extractor through a wrapper -- `def('_calEsc')` calls `grabFunc` --
 *    and `onboarding-viewer-style-preview.js` names its extractor
 *    `grabFunction`, which was not in the list at all. Neither file was
 *    covered. Discovery is now derived from each file's OWN call graph: seed on
 *    the extractor idiom (`X.indexOf('function ' + name)`), then take the
 *    fixpoint over local callers, so a wrapper, a rename, or a new file needs
 *    nobody to remember anything.
 *
 * 2. IT COMPARED AGAINST A MODEL, NOT AGAINST THE SUITE. The first version
 *    re-derived each name with `extractFunctionNaive` -- ONE reconstruction of
 *    "the" hand-rolled scanner. The suite does not have one. Measured across
 *    the files that carry their own: 88 local extractors, of which roughly HALF
 *    track quotes and half count braces and nothing else. So the model was
 *    wrong in both directions -- it would miss a real divergence in a file that
 *    tracks quotes differently, and invent one in a file that does not track
 *    them at all. Review's example is exactly that case: it reported `_calEsc`
 *    extracting at 49,193 characters against a true 145, and that is what the
 *    MODEL does. `calendar-linear-link-move.js` counts braces only, never opens
 *    a string on the quote inside `/[\"]/`, and gets 145 -- the right answer.
 *
 *    So this guard no longer models. It COMPILES EACH FILE'S OWN SCANNER and
 *    runs it. The comparison is now between what that suite actually extracts
 *    and what the function actually is, which is the claim the guard makes.
 *
 * MEASURED 2026-09-02 after both corrections: 429 (file, function) pairs
 * executed through their own suite's scanner, ZERO divergent. The divergences
 * the modelling approach reported were artefacts of the model.
 *
 * WHAT THIS GUARD DOES NOT COVER is printed by the run, not hidden: call sites
 * whose target is not a string literal, and scanner shapes it cannot drive
 * (an extractor taking two names, say). Those are reported as uncovered so the
 * number is visible rather than read as "everything is checked".
 *
 * A CORRECTION WORTH KEEPING, from before review. An earlier pass reported
 * three MORE divergences (_calRenderShell, renderWeekDeadlineTimeline,
 * _calComposerHtml). That was the new extractor being wrong, not the old one:
 * it tracked template literals with a boolean, so a nested backtick inside a
 * `${...}` closed the outer template early. It now carries a frame STACK. That
 * mistake had the same shape as the bug it was written to fix -- a lexical
 * context the scanner did not model -- and so, exactly, did correction 2 above.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* The one thing every hand-rolled extractor in this repository does: find the
   function by its declaration text. Seeding on the IDIOM rather than on a list
   of helper names is what makes a rename or a new file cost nothing. */
const IDIOM = /([A-Za-z_$][\w$]*)\.indexOf\((['"])function \2\s*\+/;
const DECL = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
const DELEGATES = /require\((['"])\.\/helpers\/extract-function\.js\1\)/;

const norm = text => String(text).replace(/^async\s+/, '');

/* `extractFunction` starts at the `function` keyword, so it drops a leading
   `async `. Several local scanners deliberately keep it. Re-attach it here so a
   compiled family is valid JavaScript, and normalise it away when comparing --
   six characters of keyword are not the hazard this guard is about. */
function localSource(src, name) {
  const body = extractFunction(src, name);
  const at = src.indexOf('function ' + name + '(');
  return src.slice(at - 6, at) === 'async ' ? 'async ' + body : body;
}

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== path.basename(__filename));
let filesWithScanners = 0;
let delegating = 0;
let scannerCount = 0;
const pairs = [];                 // [file, scannerName, targetName, driver]
const uncovered = { nonLiteral: 0, undrivable: [], uncompilable: [], otherSource: [] };

for (const file of files) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  /* Correct by construction: it may safely extract a function no hand-rolled
     scanner can read, which is the entire reason it was migrated. Checked
     BEFORE the idiom, because a migrated file no longer contains the idiom and
     would otherwise vanish from both counts. */
  if (DELEGATES.test(src)) { delegating++; continue; }
  if (!IDIOM.test(src)) continue;
  filesWithScanners++;

  const locals = new Map();
  DECL.lastIndex = 0;
  let d;
  while ((d = DECL.exec(src)) !== null) {
    try { locals.set(d[1], localSource(src, d[1])); } catch (_e) { /* not liftable; nothing to drive */ }
  }

  const family = new Set();
  for (const [name, body] of locals) if (IDIOM.test(body)) family.add(name);
  /* Fixpoint over local WRAPPERS, so `def('_calEsc')` -> `grabFunc(name)` is
     covered, and so is a wrapper around `def`.
     A wrapper FORWARDS ONE OF ITS OWN PARAMETERS to the extractor. Merely
     calling it does not count: half the ordinary test-case functions in these
     files call the extractor with a literal, and sweeping those in would bury
     the real shapes under noise and make the uncovered report useless. */
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of locals) {
      if (family.has(name)) continue;
      const params = (body.slice(body.indexOf('('), body.indexOf(')')) || '')
        .replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean);
      if (!params.length) continue;
      const forwards = [...family].some(inner => params.some(p =>
        new RegExp('\\b' + inner + '\\s*\\([^)]*\\b' + p + '\\b').test(body)));
      if (forwards) { family.add(name); grew = true; }
    }
  }
  scannerCount += family.size;

  /* Which identifier holds the source, and is it a parameter (supplied by the
     call site) or a module-level constant (which must be bound in)? */
  const sourceIdents = new Set();
  for (const name of family) {
    const hit = locals.get(name).match(IDIOM);
    if (hit) sourceIdents.add(hit[1]);
  }
  const paramsOf = name => {
    const body = locals.get(name);
    const head = body.slice(body.indexOf('('), body.indexOf(')'));
    return head.replace(/[()]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  };

  /* Every module-level file the suite reads, and whether it is index.html.
     A scanner does not have to name its source in the idiom the way the seed
     detector sees it -- a wrapper may read a different constant entirely -- so
     bind them all rather than only the one the idiom named. Getting this wrong
     is not a silent miss: the family compiles and then throws
     `X is not defined` on the first call, which is how the mutation test
     caught it. */
  const READS = /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*fs\.readFileSync\(([\s\S]*?)\)\s*;/g;
  const indexConsts = new Set();
  const otherConsts = new Set();
  /* One level of indirection is resolved, because several files write
     `const SRC = process.env.OVERRIDE || path.join(ROOT, 'index.html');` and
     then read SRC. Testing only the readFileSync argument text calls those
     files "some other source" and quietly drops fifteen real pairs. */
  const CONSTS = /(?:^|\n)\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*([^\n;]+);/g;
  const constExpr = new Map();
  CONSTS.lastIndex = 0;
  let ce;
  while ((ce = CONSTS.exec(src)) !== null) if (!constExpr.has(ce[1])) constExpr.set(ce[1], ce[2]);
  READS.lastIndex = 0;
  let r;
  while ((r = READS.exec(src)) !== null) {
    let arg = r[2];
    const bare = arg.trim().match(/^([A-Za-z_$][\w$]*)\s*,/);
    if (bare && constExpr.has(bare[1])) arg += ' ' + constExpr.get(bare[1]);
    (/index\.html/.test(arg) ? indexConsts : otherConsts).add(r[1]);
  }

  const bindIn = new Set([...indexConsts]);
  for (const ident of sourceIdents) {
    if (![...family].some(name => paramsOf(name).includes(ident))) bindIn.add(ident);
  }
  for (const c of otherConsts) bindIn.delete(c);

  /* Several files read index.html AND something else -- a gateway function, a
     sibling HTML surface. Bind the index.html constants to index.html and every
     other read to the empty string: a scanner that reads one of those is not
     driven at all (see below), so the binding only has to keep the family
     COMPILING, and an empty string cannot silently masquerade as a match. */
  let bodySource = [...family].map(name => locals.get(name)).join('\n');
  for (const ident of bindIn) {
    bodySource = bodySource.replace(new RegExp('\\b' + ident + '\\b', 'g'), '__SRC__');
  }
  for (const ident of otherConsts) {
    bodySource = bodySource.replace(new RegExp('\\b' + ident + '\\b', 'g'), '__OTHER__');
  }

  /* Does a scanner read index.html? Directly, if its body names one of the
     index.html constants; TRANSITIVELY, if it forwards to one that does --
     `def` names no source at all, it just calls `grabFunc`. Computed as a
     fixpoint for the same reason discovery is: a wrapper must not fall out of
     coverage merely for being a wrapper. */
  const readsIndex = new Set();
  for (const name of family) {
    if ([...indexConsts].some(c => new RegExp('\\b' + c + '\\b').test(locals.get(name)))) readsIndex.add(name);
  }
  for (let grew = true; grew;) {
    grew = false;
    for (const name of family) {
      if (readsIndex.has(name)) continue;
      for (const inner of readsIndex) {
        if (new RegExp('\\b' + inner + '\\s*\\(').test(locals.get(name))) { readsIndex.add(name); grew = true; break; }
      }
    }
  }

  let compiled = null;
  try {
    const names = [...family];
    compiled = new Function('__SRC__', '__OTHER__', 'assert', 'require',
      bodySource + '\n; return {' + names.map(n => n + ': ' + n).join(', ') + '};')(INDEX, '', assert, require);
  } catch (err) {
    uncovered.uncompilable.push(`${file} (${[...family].join(', ')}): ${err.message}`);
    continue;
  }

  for (const name of family) {
    const params = paramsOf(name);
    /* Drivable shapes: `grab(name)` and `grab(source, name)`. Anything else --
       an extractor taking two function names, for instance -- is reported, not
       guessed at. */
    /* Is THIS scanner reading index.html? It is if the call site hands it the
       source, or if its body reads one of the index.html constants. A scanner
       that only reads another file cannot be compared against index.html, and
       pretending otherwise would invent divergences -- so it is reported as
       uncovered rather than skipped in silence. */
    const sourceAt = params.findIndex(p => sourceIdents.has(p));
    if (sourceAt < 0 && !readsIndex.has(name)) { uncovered.otherSource.push(`${file}:${name}`); continue; }
    const rest = params.filter((_, i) => i !== sourceAt);
    if (rest.length !== 1) { uncovered.undrivable.push(`${file}:${name}(${params.join(', ')})`); continue; }
    const driver = target => {
      const args = params.map((_, i) => (i === sourceAt ? INDEX : target));
      return compiled[name](...args);
    };

    const callRe = new RegExp('\\b' + name + '\\s*\\(([^)]*)\\)', 'g');
    let call;
    while ((call = callRe.exec(src)) !== null) {
      if (/function\s+$/.test(src.slice(Math.max(0, call.index - 10), call.index))) continue;
      const literal = call[1].match(/['"]([A-Za-z_$][\w$]*)['"]/);
      if (!literal) { uncovered.nonLiteral++; continue; }
      pairs.push([file, name, literal[1], driver]);
    }
  }
}

ok(filesWithScanners > 50,
  `swept ${filesWithScanners} test files carrying their own extractor (${scannerCount} scanner functions between them, discovered from each file's call graph); ${delegating} already delegate to the shared helper and are correct by construction`);

const inIndex = pairs.filter(([, , target]) => INDEX.indexOf('function ' + target + '(') >= 0);
const distinct = new Set(inIndex.map(([, , target]) => target));
ok(distinct.size > 300,
  `${inIndex.length} call sites naming ${distinct.size} distinct index.html functions are re-derived here — each one by running THAT FILE'S OWN scanner, not a model of it`);

const divergent = [];
const theirsThrew = [];
for (const [file, scanner, target, driver] of inIndex) {
  let correct;
  try {
    correct = extractFunction(INDEX, target);
  } catch (err) {
    failures++;
    console.error(`FAIL  the CORRECT extractor could not read ${target} (${file}): ${err.message}`);
    continue;
  }
  let theirs;
  try { theirs = driver(target); } catch (err) { theirsThrew.push(`${target} via ${scanner} (${file}): ${String(err.message).split('\n')[0].slice(0, 120)}`); continue; }
  if (norm(theirs) !== norm(correct)) divergent.push(`${target} theirs=${norm(theirs).length} correct=${norm(correct).length} (${file} via ${scanner})`);
}

/* Both lists must be EMPTY. A name in either one means some suite is asserting
   over text that is not the function it names. */
ok(theirsThrew.length === 0,
  theirsThrew.length === 0
    ? 'every suite\'s own scanner can close every function that suite extracts'
    : 'these suites cannot close a function they extract, and must use test/helpers/extract-function.js: ' + theirsThrew.join('; '));

ok(divergent.length === 0,
  divergent.length === 0
    ? 'and every one of those extractions is byte-identical to the real function — no suite is asserting over a neighbour'
    : 'these suites extract something OTHER than the function they name, and must use test/helpers/extract-function.js: ' + divergent.join('; '));

/* ---- What this guard does NOT cover, said out loud --------------------- */

/* A guard that quietly skips what it cannot drive reads exactly like a guard
   that found nothing wrong. These numbers are printed every run so the gap
   stays visible; they are not failures, and they are not zero. */
console.log(`  --  not covered: ${uncovered.nonLiteral} call site(s) whose target is not a string literal`
  + `; ${uncovered.otherSource.length} scanner(s) extracting from a source other than index.html`
  + (uncovered.otherSource.length ? ` [${uncovered.otherSource.join(', ')}]` : '')
  + `; ${uncovered.undrivable.length} scanner shape(s) this guard cannot drive`
  + (uncovered.undrivable.length ? ` [${uncovered.undrivable.join(', ')}]` : '')
  + `; ${uncovered.uncompilable.length} family/families that would not compile`
  + (uncovered.uncompilable.length ? ` [${uncovered.uncompilable.join('; ')}]` : ''));
ok(uncovered.uncompilable.length === 0,
  'and every discovered scanner family compiles, so none was skipped for a reason nobody looked at');

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
