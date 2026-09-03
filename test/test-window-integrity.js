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
function scan(entries) {
  const functionAnchored = [];
  const regionAnchored = [];
  for (const [file, src] of entries) {
  // `X.slice(anchor, anchor + N)` where a nearby declaration resolves the anchor
    const re = /([A-Za-z_$][\w$.]*)\.slice\(\s*([A-Za-z_$][\w$]*)\s*,\s*[^,)]*?\+\s*(\d{3,})\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const [, haystack, anchorVar, win] = m;
      const decl = new RegExp('(?:const|let|var)\\s+' + anchorVar
        + "\\s*=\\s*[A-Za-z_$][\\w$.]*\\.indexOf\\(\\s*['\"`]([^'\"`]+)").exec(src);
      const anchorText = decl ? decl[1] : '';
      const named = /function\s+([A-Za-z_$][\w$]*)\s*\(/.exec(anchorText);
      const overIndex = /INDEX|source|html|SRC/i.test(haystack);
      if (named && overIndex) functionAnchored.push({ file, fn: named[1], win: Number(win) });
      else regionAnchored.push({ file, win: Number(win), anchor: anchorText || anchorVar });
    }
  }
  return { functionAnchored, regionAnchored };
}
function offendersIn(functionAnchored, lengthOf) {
  const out = [];
  for (const w of functionAnchored) {
    const len = lengthOf(w.fn);
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
  ok(notCaught.length === 0,
    'and does NOT flag a window that fits inside its function, so it is a measurement and not a ban');
}

const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.js') && f !== path.basename(__filename));
const { functionAnchored, regionAnchored } = scan(files.map(f => [f, fs.readFileSync(path.join(__dirname, f), 'utf8')]));

const offenders = offendersIn(functionAnchored, name => {
  try { return extractFunction(INDEX, name).length; } catch (e) { return null; }
});

ok(offenders.length === 0,
  'no assertion scopes a function by a character count longer than the function ('
    + functionAnchored.length + ' function-anchored window(s) measured)'
    + (offenders.length ? '\n        ' + offenders.join('\n        ') : ''));

ok(true, regionAnchored.length + ' window(s) are anchored on a region rather than a function — not measurable here, listed for visibility');

if (failures) {
  console.error('\nTest window integrity checks FAILED');
  console.error('Scope the assertion with extractFunction(source, name) from test/helpers/extract-function.js');
  console.error('instead of a character count — it reads the real extent of the function.');
  process.exit(1);
}
console.log('\nTest window integrity checks passed');
