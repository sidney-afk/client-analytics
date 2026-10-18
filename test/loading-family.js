'use strict';
/*
 * ONE LOADING FAMILY (session Lantern, 2026-10-18). Every spinner in the shared styles turns at --sv-spin-dur and
 * every grey placeholder shimmers at --sv-sheen-dur / --sv-sheen-ease; reduced motion stops the shimmer and slows the
 * spinners; content that replaces a placeholder fades in over --sv-fade-in-dur. Before this, six spinner speeds
 * (0.7 to 1 s) and four shimmer speeds (1.25 to 1.4 s) ran side by side. A new spinner or shimmer written with its own
 * number fails here: use the tokens.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const dir = path.join(__dirname, '..', 'src', 'index');
const files = fs.readdirSync(dir).filter(f => /\.(css|html|js)\.part$/.test(f))
  // The review page and the frame viewer carry their own sealed styles (sessions Curtain and Encore); not held here.
  .filter(f => !/^(187|195)-/.test(f));
let checks = 0;
const bad = [];
const SPIN = /animation:\s*([a-zA-Z-]*spin[a-zA-Z-]*)\s+([^;"'}]+)/gi;
const SHEEN = /animation:\s*([a-zA-Z-]*(?:shimmer|[sS]keleton)[a-zA-Z-]*)\s+([^;"'}]+)/g;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const [re, token] of [[SPIN, '--sv-spin-dur'], [SHEEN, '--sv-sheen-dur']]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      if (/keyframes/.test(m[1])) continue;
      // The Time Off spinner's line is part of the PTO evidence fingerprint (qa/pto-lifecycle): it keeps its literal,
      // which must stay equal to the token value.
      if (/\.pto-spinner \{/.test(src.slice(src.lastIndexOf('\n', m.index) + 1, m.index))) {
        checks++;
        if (!/^spin 0\.75s linear infinite/.test(m[1] + ' ' + m[2])) bad.push(f + ': the Time Off spinner must stay "spin 0.75s linear infinite" (equal to --sv-spin-dur)');
        continue;
      }
      checks++;
      if (!m[2].includes('var(' + token + ')')) bad.push(f + ': "' + m[0].trim().slice(0, 90) + '" should use var(' + token + ')');
    }
  }
}
assert.ok(checks >= 15, 'found the spinners and shimmers (' + checks + ')');
assert.deepStrictEqual(bad, [], 'every spinner and shimmer reads the family tokens:\n' + bad.join('\n'));
const css = fs.readFileSync(path.join(dir, '010-styles-foundation.css.part'), 'utf8');
assert.match(css, /--sv-spin-dur:\s*0\.75s;\s*--sv-sheen-dur:\s*1\.35s;\s*--sv-sheen-ease:\s*ease-in-out;/, 'the tokens are defined once');
assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\.sv-skeleton::after, \.prod-skeleton, \.tpl-skeleton, \.cal-cm-skel, \.srp-skel-line/, 'reduced motion stops every shimmer');
assert.match(css, /--sv-spin-dur: 1\.5s; --sv-fade-in-dur: 0s;/, 'reduced motion slows spinners and drops the fade');
assert.match(css, /\.sv-fade-in \{ animation: sv-fade-in var\(--sv-fade-in-dur\)/, 'the fade class reads its token');
checks += 4;
console.log('loading-family: ' + checks + ' checks passed');
