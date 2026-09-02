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
 * MEASURED 2026-09-02 over every function the suite actually extracts (479
 * distinct names across 122 files):
 *
 *   432  identical under the naive and the regex-aware scanner
 *    42  come from sources other than index.html
 *     2  the naive scanner cannot close AT ALL (_filmsParseMonth,
 *        wlOpenRollupPopover) -- braces inside `/(\d{1,2})/` are counted
 *     3  silently OVER-EXTRACT and still parse, which is the dangerous case:
 *          _calRenderShell             9,388 correct -> 12,901 naive
 *          renderWeekDeadlineTimeline    945 correct ->  4,456 naive
 *          _calComposerHtml            5,992 correct ->  7,103 naive
 *
 * The over-extractions are why this is a correctness bug and not tidiness. A
 * suite that asserts with `/pattern/.test(source)` over 3,500 extra characters
 * of index.html can be satisfied by a NEIGHBOURING function and report a pass.
 * `renderWeekDeadlineTimeline` was extracting nearly five times its own length.
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

/* The scanner the repository had, kept so the integrity guard can compare the
   two and name any function where they disagree. Not for use in a suite. */
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
