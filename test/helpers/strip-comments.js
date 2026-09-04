'use strict';
// Remove comments from source WITHOUT removing code that merely looks like a
// comment. (Written with line comments throughout, because a block comment
// explaining block-comment delimiters terminates itself -- which is not a
// hypothetical: it happened while writing this file's own test.)
//
// WHY THIS EXISTS. Seventeen gates in this repo separated code from prose with
//
//     src.replace(/\/\*[\s\S]*?\*\//g, ' ')
//
// which opens a comment at ANY two characters "/" and "*", including the pair
// inside a string, a MIME type, or an HTML attribute -- and then runs to the
// next closing delimiter ANYWHERE in the file, deleting whatever lies between.
// Measured 2026-09-04 (OPEN_REPAIRS 145):
//
//     index.html:67329   accept="...,video/*"   swallowed 37,090 chars
//     index.html:68510   accept="...,video/*"   swallowed 27,330 chars
//     production-write/index.ts:418  accept: "*/*"   swallowed  2,620 chars
//
// About 64k characters of index.html were invisible to every gate that stripped
// this way. Positive assertions over that region fail loudly, so they hid
// nothing; NEGATIVE assertions -- ok(!/.../.test(CODE)) -- passed vacuously,
// because the text they forbid had been deleted before they looked.
//
// The app code is right: accept="video/*" is exactly what that attribute should
// say, and it must not be contorted to suit a test. The strippers were wrong.
//
// WHY A RULE AND NOT A PARSER. The obvious fix is to track string state, but
// the biggest consumer is index.html -- 5MB of HTML plus CSS plus JS. A JS
// scanner run over that drifts: an apostrophe in prose ("don't") opens a string
// that never closes, and a regex literal containing a quote (.replace(/'/g,...)
// -- index.html has several) flips the state the other way. A first attempt at
// exactly that mis-measured this very bug by 69k characters in the wrong
// direction. Stateless rules cannot drift.
//
// THE RULE. A real block comment's opener is never preceded by an identifier
// character, "*", "/", "." or a quote. Verified against every tracked .js, .ts,
// .html and .css file in the repo: it declines 69 openers, and all 69 are
// genuinely not comments -- glob paths ("functions/x/**"), MIME types
// ("image/*", "*/*"), a PostgREST range ("0-0/*"), and test strings that search
// for a comment marker. It accepts every real comment, including the awkward
// mid-line ones: "} catch (e) { /* ... */", "f(/* root */)", and a CSS
// declaration followed by a note.
//
// This is deliberately conservative in the safe direction. A comment wrongly
// KEPT makes a negative assertion stricter, so it fails loudly and someone
// looks. A comment wrongly OPENED deletes code silently, which is the failure
// this file exists to prevent.

// Characters that may legitimately precede a block comment. Note the omissions,
// each of which is load-bearing: identifier characters (video/*), "*" (*/*),
// "/", "." and both quote characters.
const OK_BEFORE = /[\s(\[{,;:=?&|!+\-<>~^%)]/;

// Replace every block comment with `fill`, leaving non-comment text untouched.
function stripBlockComments(src, fill) {
  const pad = fill === undefined ? ' ' : fill;
  let out = '', i = 0;
  while (i < src.length) {
    const j = src.indexOf('/*', i);
    if (j < 0) { out += src.slice(i); break; }
    const prev = j === 0 ? '' : src[j - 1];
    if (prev !== '' && !OK_BEFORE.test(prev)) {
      // Not a comment opener -- a glob, a MIME type, a string. Keep it.
      out += src.slice(i, j + 2);
      i = j + 2;
      continue;
    }
    const end = src.indexOf('*/', j + 2);
    out += src.slice(i, j) + pad;
    if (end < 0) { i = src.length; break; }
    i = end + 2;
  }
  return out;
}

// Block comments plus WHOLE-LINE // comments. Trailing line comments are left
// alone on purpose: stripping them needs to know a "//" inside "https://" is
// not a comment, which is the same class of mistake this file exists to fix.
function stripComments(src, fill) {
  return stripBlockComments(src, fill).replace(/^[ \t]*\/\/.*$/gm, fill === undefined ? ' ' : fill);
}

module.exports = { stripBlockComments, stripComments, OK_BEFORE };
