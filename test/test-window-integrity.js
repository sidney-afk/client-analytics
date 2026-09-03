'use strict';
/*
 * AN ASSERTION MAY NOT SCOPE A FUNCTION BY GUESSING ITS LENGTH.
 *
 * A suite that writes `source.slice(at, at + 1800)` is claiming two things: that
 * the code it cares about is inside that window, and that nothing else is. The
 * second claim is never checked, and 1800 is not a property of anything — it is
 * how long the function happened to be when somebody wrote the number down.
 *
 * Both ways it goes wrong were live in this repo on 2026-09-03:
 *
 *   OVERRUN — `write-ui-writer-durability.js` scoped 1,800 characters onto
 *   `_sxrReviewOnDraftInput`, which is 1,021 long. 779 characters of the NEXT
 *   function sat inside the assertion's reach, so moving the line it looks for
 *   out of the function would have kept the suite green. That is OPEN_REPAIRS
 *   111's shape — an assertion satisfied by a neighbour — arriving through a
 *   different door than the extractor bug did.
 *
 *   UNDERSHOOT — `production-deep-link-survives-cache.js` scoped 9,000
 *   characters onto `_prodLoadData` and asserted that it calls
 *   `_prodApplyDeepLinkFallback(true)`. Adding a comment to that function
 *   pushed the call past 9,000 and turned a true statement into a red suite.
 *   The behaviour never changed.
 *
 * So: a window ANCHORED ON A FUNCTION OPENING must not be longer than that
 * function. There is a correct tool for this — test/helpers/extract-function.js
 * — and it reads the real extent, which is what every one of these windows was
 * approximating.
 *
 * Windows anchored on something else (a CSS class, a marker constant, a region
 * of markup) are a different practice and are deliberately NOT failed here:
 * they scope a region whose end this check cannot know, so a rule about them
 * would be a guess of its own. They are listed at the end so the count stays
 * visible rather than forgotten.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.join(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}

/* The scan is a pure function of (file, text) so it can be pointed at a
   fixture as well as at the suite. A guard whose only subject is code that has
   already been fixed proves nothing — it would pass just as happily if the
   detection were broken, which is precisely the failure this repo hit on
   2026-09-03 when `prod-terminal-tail-settles.js` asserted on the call that
   CAUSED the bug and scored it green. */
/* Which FILE a haystack variable holds. `INDEX`/`source`/`html` are index.html
   by convention; anything else is resolved from the test's own
   `const <name> = fs.readFileSync(...)` line, reading a `scripts/x.js` or
   `path.join(ROOT, 'scripts', 'x.js')` literal out of it. Review on PR #1244
   (Codex, and the adversarial pass) caught that the first version only ever
   measured index.html, so a 1,400-character window onto a 1,370-character
   function in scripts/graphics-f2-evidence.js was invisible to it. */
function haystackFile(varName, src) {
  if (/^(INDEX|source|html|SRC)$/i.test(varName)) return 'index.html';
  const decl = new RegExp('(?:const|let|var)\\s+' + varName + "\\s*=\\s*fs\\.readFileSync\\(([^\\n]*)").exec(src);
  if (!decl) return null;
  const parts = decl[1].match(/['"]([^'"]+)['"]/g) || [];
  const segs = parts.map(q => q.slice(1, -1)).filter(q => q !== 'utf8' && q !== 'utf-8');
  if (!segs.length) return null;
  return segs.join('/').replace(/^\.\.\//, '').replace(/\/+/g, '/');
}
/* What an `indexOf(...)` argument anchors on. A quoted literal naming a function
   opening is measurable. `'function ' + fn + '('` is ALSO a function anchor —
   but the name is a runtime value, so the window cannot be measured here and is
   reported as such rather than filed as a region and forgotten. The adversarial
   pass on PR #1244 found three of those live (client-review-link-auth.js), one
   of them 422 characters past the end of its function. */
function classifyAnchor(arg) {
  const s = String(arg || '').trim();
  const lit = /^(['"`])([^'"`]*)\1$/.exec(s);
  if (lit) {
    const named = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(lit[2]);
    return { text: lit[2], fn: named ? named[1] : null, unresolved: false };
  }
  if (/^(['"`])(?:async\s+)?function\s+\1\s*\+/.test(s)) return { text: s, fn: null, unresolved: true };
  return { text: s, fn: null, unresolved: false };
}
function fileWindow(list, file, anchor, win, target) {
  if (anchor.unresolved) list.functionAnchored.push({ file, fn: anchor.text, win, target, unresolved: true });
  else if (anchor.fn && target) list.functionAnchored.push({ file, fn: anchor.fn, win, target });
  else list.regionAnchored.push({ file, win, anchor: anchor.text });
}
function scan(entries) {
  const list = { functionAnchored: [], regionAnchored: [] };
  for (const [file, src] of entries) {
    // Inline form: X.slice(X.indexOf('t'), X.indexOf('t') + N) — the anchor is
    // spelled twice and never named. This is the shape the first version missed.
    const inline = /([A-Za-z_$][\w$.]*)\.slice\(\s*[A-Za-z_$][\w$.]*\.indexOf\(([^)]*)\)\s*,\s*[A-Za-z_$][\w$.]*\.indexOf\(([^)]*)\)\s*\+\s*(\d{3,})\s*\)/g;
    let im;
    while ((im = inline.exec(src))) {
      const [, haystack, anchorArg, , win] = im;
      fileWindow(list, file, classifyAnchor(anchorArg), Number(win), haystackFile(haystack, src));
    }
    // `X.slice(anchor, anchor + N)` where a declaration resolves the anchor. The
    // NEAREST PRECEDING declaration, not the first in the file: a test that
    // re-declares `const at` per block would otherwise have every window
    // measured against the first block's function (also found on PR #1244).
    const re = /([A-Za-z_$][\w$.]*)\.slice\(\s*([A-Za-z_$][\w$]*)\s*,\s*[^,)]*?\+\s*(\d{3,})\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const [, haystack, anchorVar, win] = m;
      const declRe = new RegExp('(?:const|let|var)\\s+' + anchorVar
        + '\\s*=\\s*[A-Za-z_$][\\w$.]*\\.indexOf\\(([^)]*)\\)', 'g');
      const before = src.slice(0, m.index);
      let decl = null;
      let d;
      while ((d = declRe.exec(before))) decl = d;
      const anchor = decl ? classifyAnchor(decl[1]) : { text: anchorVar, fn: null, unresolved: false };
      fileWindow(list, file, anchor, Number(win), haystackFile(haystack, src));
    }
  }
  return list;
}
function offendersIn(functionAnchored, lengthOf) {
  const out = [];
  for (const w of functionAnchored) {
    if (w.unresolved) {
      out.push(`${w.file}: ${w.win} chars onto a function named at runtime (${w.fn}) — not measurable; scope it with extractFunction`);
      continue;
    }
    const len = lengthOf(w.fn, w.target);
    if (len == null) continue;            // not a function of index.html; nothing to measure
    if (w.win > len) out.push(`${w.file}: ${w.win} chars onto ${w.fn}() which is ${len} — ${w.win - len} past its end`);
  }
  return out;
}

/* ---- the guard proves itself on a fixture first ------------------------- */
{
  const fixture = [['fixture.js',
    "const at = INDEX.indexOf('function _fixtureFn(');\nconst slice = INDEX.slice(at, at + 1800);\n"]];
  const { functionAnchored } = scan(fixture);
  const caught = offendersIn(functionAnchored, name => (name === '_fixtureFn' ? 900 : null));
  ok(functionAnchored.length === 1 && caught.length === 1,
    'the scan catches a window that overruns its function — proven on a fixture, not assumed');
  const notCaught = offendersIn(functionAnchored, name => (name === '_fixtureFn' ? 5000 : null));
  const inlineFixture = [['fixture2.js',
    "const evidence = fs.readFileSync(path.join(ROOT, 'scripts', 'x.js'), 'utf8');\n"
    + "const w = evidence.slice(evidence.indexOf('function _fx2('), evidence.indexOf('function _fx2(') + 1400);\n"]];
  const inl = scan(inlineFixture);
  const inlCaught = offendersIn(inl.functionAnchored, (name, target) => (name === '_fx2' && target === 'scripts/x.js' ? 1370 : null));
  ok(inl.functionAnchored.length === 1 && inl.functionAnchored[0].target === 'scripts/x.js' && inlCaught.length === 1,
    'the INLINE form (indexOf spelled twice, haystack not index.html) is scanned, resolved to its file, and caught');
  ok(notCaught.length === 0,
    'and does NOT flag a window that fits inside its function, so it is a measurement and not a ban');
  const twoBlocks = [['fixture3.js',
    "{ const at = INDEX.indexOf('function _hugeFn('); INDEX.slice(at, at + 500); }\n"
    + "{ const at = INDEX.indexOf('function _tinyFn('); INDEX.slice(at, at + 2000); }\n"]];
  const tb = scan(twoBlocks).functionAnchored.map(w => w.fn + ':' + w.win).join(' ');
  ok(tb === '_hugeFn:500 _tinyFn:2000',
    'each window resolves to the NEAREST preceding declaration of its anchor, not the first one in the file (' + tb + ')');
  const concat = [['fixture4.js',
    "for (const fn of ['a', 'b']) { const start = index.indexOf('function ' + fn + '('); index.slice(start, start + 900); }\n"]];
  const cc = scan(concat);
  const ccOff = offendersIn(cc.functionAnchored, () => 5000);
  ok(cc.functionAnchored.length === 1 && cc.regionAnchored.length === 0 && ccOff.length === 1,
    'a function anchor built by concatenation is reported as unmeasurable, not silently filed as a region');
}

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== path.basename(__filename));
const { functionAnchored, regionAnchored } = scan(files.map(f => [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]));

const SOURCES = new Map([['index.html', INDEX]]);
function sourceOf(target) {
  if (!SOURCES.has(target)) {
    try { SOURCES.set(target, fs.readFileSync(path.join(ROOT, target), 'utf8')); } catch (e) { SOURCES.set(target, null); }
  }
  return SOURCES.get(target);
}
const offenders = offendersIn(functionAnchored, (name, target) => {
  const src = sourceOf(target || 'index.html');
  if (!src) return null;
  try { return extractFunction(src, name).length; } catch (e) { return null; }
});

ok(offenders.length === 0,
  'no assertion scopes a function by a character count longer than the function ('
    + functionAnchored.length + ' function-anchored window(s) measured)'
    + (offenders.length ? '\n        ' + offenders.join('\n        ') : ''));

/* No "at least one subject" assertion here, on purpose. Zero function-anchored
   windows is the END STATE this guard exists to reach, not a failure of it; the
   proof that a zero-subject pass is not hollow is the fixture self-test above,
   which catches both the named-anchor and the inline form. */
ok(true, regionAnchored.length + ' window(s) are anchored on a region rather than a function — not measurable here, listed for visibility');

if (failures) {
  console.error('\nTest window integrity checks FAILED');
  console.error('Scope the assertion with extractFunction(source, name) from test/helpers/extract-function.js');
  console.error('instead of a character count — it reads the real extent of the function.');
  process.exit(1);
}
console.log('\nTest window integrity checks passed');
