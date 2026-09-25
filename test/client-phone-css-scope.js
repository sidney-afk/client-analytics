'use strict';
/*
 * Client phone CSS scope guard.
 *
 * Run:  node test/client-phone-css-scope.js   (exit 0 = all good)
 *
 * The owner's hard rule for the client-phone layout: the desktop must not
 * move by a pixel, and no staff screen may change at all. So every rule
 * between a CLIENT-PHONE:BEGIN and CLIENT-PHONE:END marker in index.html must
 *   1. sit inside @media (max-width: N px) with N <= 767 (optionally narrowed
 *      further by more max-width or an orientation condition, never widened
 *      by min-width alone, never "or"/"," joined to a wider query), and
 *   2. have EVERY selector in its list start with `html.boot-client `, the
 *      permanent client-share-link lock set before first paint.
 * Anything else in the block (a bare rule, @import, @font-face, @supports,
 * @layer, a :root variable) could reach the desktop or a staff screen and
 * fails this suite. The checker is also exercised against known-bad input so
 * a broken parser cannot pass silently.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const MAX = 767;

const { stripBlockComments } = require('./helpers/strip-comments');
const stripComments = css => stripBlockComments(css);

// Split a CSS string into top-level items: { prelude, body } for blocks.
function items(css) {
  const out = []; let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    const open = css.indexOf('{', i); const semi = css.indexOf(';', i);
    if (open < 0 || (semi >= 0 && semi < open)) { out.push({ prelude: css.slice(i, semi < 0 ? css.length : semi).trim(), body: null }); i = semi < 0 ? css.length : semi + 1; continue; }
    let depth = 0, j = open;
    for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (depth === 0) break; } }
    if (depth !== 0) throw new Error('unbalanced braces');
    out.push({ prelude: css.slice(i, open).trim(), body: css.slice(open + 1, j) });
    i = j + 1;
  }
  return out;
}

function mediaIsPhoneOnly(prelude, alreadyCapped = false) {
  const m = /^@media\s+(.+)$/i.exec(prelude);
  if (!m) return false;
  const q = m[1].trim();
  if (/,|\bor\b|\bnot\b|\bonly\b|\bprint\b/i.test(q)) return false;
  const parts = q.split(/\s+and\s+/i).map(s => s.trim());
  let capped = alreadyCapped;
  for (const p of parts) {
    const mw = /^\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/i.exec(p);
    if (mw) { if (Number(mw[1]) > MAX) return false; capped = true; continue; }
    if (/^\(\s*orientation\s*:\s*(portrait|landscape)\s*\)$/i.test(p)) continue;
    if (/^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/i.test(p)) continue;
    if (/^screen$/i.test(p)) continue;
    return false;
  }
  return capped;
}

function selectorsScoped(prelude) {
  return prelude.split(',').map(s => s.trim()).every(s => /^html\.boot-client(?=[\s.:\[>~+])/.test(s) && !/^html\.boot-client\s*,/.test(s));
}

// Returns a list of problems for one marked block.
function checkBlock(css, underPhoneMedia = false) {
  const problems = [];
  for (const it of items(stripComments(css))) {
    if (it.body === null) { problems.push(`statement outside a rule: ${it.prelude.slice(0, 60)}`); continue; }
    if (it.prelude.startsWith('@')) {
      if (!/^@media\b/i.test(it.prelude)) { problems.push(`at-rule not allowed: ${it.prelude.slice(0, 60)}`); continue; }
      if (!mediaIsPhoneOnly(it.prelude, underPhoneMedia)) { problems.push(`media query can apply above ${MAX}px: ${it.prelude}`); continue; }
      problems.push(...checkBlock(it.body, true));
      continue;
    }
    if (!underPhoneMedia) { problems.push(`rule not inside a phone-only @media: ${it.prelude.slice(0, 60)}`); continue; }
    if (!selectorsScoped(it.prelude)) problems.push(`selector not scoped to html.boot-client: ${it.prelude.slice(0, 80)}`);
  }
  return problems;
}

function blocks(html) {
  const re = /\/\*\s*CLIENT-PHONE:BEGIN\s*\*\/([\s\S]*?)\/\*\s*CLIENT-PHONE:END\s*\*\//g;
  const out = []; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// Known-bad inputs the checker must reject, and a good one it must accept.
const good = '@media (max-width: 767px) { html.boot-client .a, html.boot-client .b:hover { color: red; } @media (orientation: landscape) { html.boot-client .c { top: 0; } } }';
assert.deepStrictEqual(checkBlock(good), [], 'checker rejected a valid block');
for (const [bad, why] of [
  ['html.boot-client .a { color: red; }', 'bare rule'],
  ['@media (max-width: 768px) { html.boot-client .a { color: red; } }', 'wider breakpoint'],
  ['@media (min-width: 300px) { html.boot-client .a { color: red; } }', 'min-width only'],
  ['@media (max-width: 767px), (min-width: 1000px) { html.boot-client .a { color: red; } }', 'or-joined query'],
  ['@media not (max-width: 767px) { html.boot-client .a { color: red; } }', 'negated query'],
  ['@media (max-width: 767px) { .a { color: red; } }', 'unscoped selector'],
  ['@media (max-width: 767px) { html.boot-client .a, .b { color: red; } }', 'one unscoped selector in a list'],
  ['@media (max-width: 767px) { html.boot-clientx .a { color: red; } }', 'lookalike class'],
  ['@media (max-width: 767px) { :root { --x: 1; } }', 'root variable'],
  ['@supports (display: grid) { html.boot-client .a { color: red; } }', 'supports'],
  ['@import url(x.css);', 'import'],
  ['@media (max-width: 767px) { @media (min-width: 900px) { html.boot-client .a { color: red; } } }', 'nested wider query'],
]) assert(checkBlock(bad).length > 0, `checker accepted a bad block (${why})`);

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const found = blocks(html);
assert(found.length >= 1, 'no CLIENT-PHONE block found in index.html');
const begins = (html.match(/CLIENT-PHONE:BEGIN/g) || []).length;
const ends = (html.match(/CLIENT-PHONE:END/g) || []).length;
assert.strictEqual(begins, ends, 'unmatched CLIENT-PHONE markers');
assert.strictEqual(found.length, begins, 'a CLIENT-PHONE:BEGIN marker is not in the exact form /* CLIENT-PHONE:BEGIN */, so its block would go unchecked');
let rules = 0;
for (const b of found) {
  const problems = checkBlock(b);
  assert.deepStrictEqual(problems, [], 'client-phone CSS could reach desktop or staff screens:\n  ' + problems.join('\n  '));
  rules += (stripComments(b).match(/\{/g) || []).length;
}
console.log(`client-phone-css-scope: OK (${found.length} block(s), ${rules} braces, all under @media (max-width: <=${MAX}px) and html.boot-client)`);
