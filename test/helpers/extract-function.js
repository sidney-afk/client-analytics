'use strict';
/*
 * ONE CORRECT FUNCTION EXTRACTOR, because 122 test files hand-rolled their own
 * and the hand-rolled one cannot read a regex literal.
 *
 * OPEN_REPAIRS item 96. `test/prod-focus-survives-render.js` broke on
 * `_prodFocusSelectorPart`, which balances perfectly -- it contains
 * `.replace(/[\"]/g, ...)`, a double quote inside a regex CHARACTER CLASS. The
 * naive scanner read that quote as opening a string and swallowed the rest of
 * the function. It had been passing by accident: the broken quote state
 * happened to re-sync on a later quote before a brace at depth zero, and an
 * unrelated edit moved the text and stopped the accident landing.
 *
 * MEASURED 2026-09-02 over the 446 index.html functions the suite extracts,
 * comparing this scanner against `extractFunctionNaive` below:
 *
 *   439  identical
 *     3  the naive scanner cannot close AT ALL (_filmsParseMonth,
 *        wlOpenRollupPopover, _obvEsc) -- braces inside `/(\d{1,2})/` are
 *        counted, and a quote inside a character class opens a string
 *     4  disagree while both still parse, which is the dangerous case:
 *          renderCardView    10,221 correct -> 10,196 naive
 *          renderOverview    10,089 correct -> 10,048 naive
 *          _calEsc              145 correct -> 49,193 naive
 *          _calEscAttr           68 correct -> 26,722 naive
 *
 * A disagreement is why this is a correctness bug and not tidiness. A suite
 * that asserts with `/pattern/.test(source)` over tens of thousands of extra
 * characters of index.html can be satisfied by a NEIGHBOURING function and
 * report a pass.
 *
 * READ THAT TABLE CAREFULLY, because two of its rows are about the MODEL and
 * not about any suite. `extractFunctionNaive` is ONE reconstruction of the
 * hand-rolled scanner, and the suite does not have one: of the 88 local
 * extractors still in the test files, roughly half track quotes and half count
 * braces and nothing else. `calendar-linear-link-move.js` is in the second
 * group, so it never opens a string on the quote inside `/[\"]/` and extracts
 * `_calEsc` at its true 145 characters. The 49,193 above is what a quote-
 * tracking scanner WOULD do, and no suite does it.
 * `renderCardView`/`renderOverview` are real: `analytics-receipt-ui.js` did
 * track quotes, which is why it was migrated here.
 * `test/extract-function-integrity.js` therefore compares against each
 * suite's OWN compiled scanner rather than against this model.
 *
 * WHAT THIS TRACKS that the naive one does not: regex literals, including the
 * character class inside them (so `[/]` and `[\"]` are inert), and the
 * division-vs-regex ambiguity, resolved by the last significant character --
 * the standard lexical heuristic, and sufficient here because these are the
 * repository's own functions, not arbitrary input.
 *
 * Deliberately NOT a parser. A real one (acorn, espree) would be correct by
 * construction, but the suite takes no dependencies and index.html is not a
 * module; this is the smallest thing that closes the measured gap. If the gap
 * reopens, `test/extract-function-integrity.js` fails and names the function.
 */

const REGEX_ALLOWED_AFTER = new Set(
  ['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>'],
);
const REGEX_ALLOWED_KEYWORD = /\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)\s*$/;

/**
 * Extract `function <name>(...) { ... }` from `source`, brace-balanced, with
 * strings, template literals, comments and REGEX LITERALS all inert.
 * Throws if the name is absent or the body never closes.
 */
function extractFunction(source, name) {
  const src = String(source || '');
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  const open = src.indexOf('{', at);
  if (open < 0) throw new Error('function has no body: ' + name);

  /* A STACK, not a flag, because a template literal's `${...}` is ordinary code
     again: it can hold strings, regexes, braces, and FURTHER template literals.
     A single `inTemplate` boolean gets this wrong the moment a nested backtick
     appears -- the outer template looks closed, braces start counting again, and
     the function ends early. That is not hypothetical: it is exactly how the
     first version of this helper truncated `renderWeekDeadlineTimeline` to 945
     characters mid-template, and the mistake is the same SHAPE as the regex bug
     this file exists to fix -- a lexical context the scanner did not know about.
     Frames: 'code' (braces count), 'template' (only ` and ${ matter). */
  const stack = [{ kind: 'code', depth: 0 }];
  let escaped = false;
  let quote = '';        // ' or " only; templates are a frame, not a quote
  let comment = '';
  let regex = false;
  let charClass = false;
  let prev = '';

  for (let i = open; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    const top = stack[stack.length - 1];

    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && n === '/') { comment = ''; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (regex) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (charClass) { if (c === ']') charClass = false; }
      else if (c === '[') charClass = true;
      else if (c === '/') regex = false;
      else if (c === '\n') regex = false; // unterminated: do not run away
      continue;
    }

    if (top.kind === 'template') {
      if (escaped) { escaped = false; continue; }
      if (c === '\\') { escaped = true; continue; }
      if (c === '`') { stack.pop(); continue; }
      if (c === '$' && n === '{') { stack.push({ kind: 'code', depth: 1 }); i++; continue; }
      continue;
    }

    // top.kind === 'code'
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '/') {
      const back = src.slice(Math.max(0, i - 16), i);
      if (!prev || REGEX_ALLOWED_AFTER.has(prev) || REGEX_ALLOWED_KEYWORD.test(back)) {
        regex = true; charClass = false; continue;
      }
    }
    if (c === '`') { stack.push({ kind: 'template' }); continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') top.depth++;
    else if (c === '}') {
      top.depth--;
      if (top.depth === 0) {
        if (stack.length === 1) return src.slice(at, i + 1);
        stack.pop();               // closes a ${ ... } back into its template
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error('unclosed function: ' + name);
}

/* One reconstruction of the scanner the repository hand-rolled: the
   quote-and-comment-tracking variant, which is the more common of the two
   shapes in the test files. Kept as the executable statement of the bug -- the
   header's measurements are made with it -- and NOT for use in a suite.
   The integrity guard no longer compares against it: a single model is wrong
   for the half of the suite that counts braces only, in both directions. */
function extractFunctionNaive(source, name) {
  const src = String(source || '');
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && n === '/') { comment = ''; i++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && n === '/') { comment = 'line'; i++; continue; }
    if (c === '/' && n === '*') { comment = 'block'; i++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unclosed function: ' + name);
}

module.exports = { extractFunction, extractFunctionNaive };
