'use strict';
/*
 * OPEN_REPAIRS item 177 — the calendar's "which card is this" highlight
 * (the persistent outline a pasted card link puts on its target, and its
 * sibling flash/pulse effects) went invisible in dark mode.
 *
 * Report, after item 176 shipped the "Opening linked card…" toast: the toast
 * is now seen, but "I never saw the border color... it appears as like a
 * black thing" in dark mode.
 *
 * Root cause: `.cal-card-focused`'s box-shadow (and the sibling
 * `.cal-card-flash`/pulse/hover effects that share the same color family)
 * reads its color from the `--sv-shadow-rgba-94-106-210-*` custom
 * properties -- the brand indigo, rgb(94,106,210). The dark-theme override
 * block flattened every one of those to plain black (rgba(0,0,0,…)), which
 * is indistinguishable from the app's near-black dark background: a ring
 * meant to say "this one" instead said nothing. Every OTHER brand-indigo
 * token in the file (e.g. --sv-border-9aa3f0, --sv-fg-4a54c0) is brightened
 * for dark mode instead of blackened -- this family was the one exception.
 *
 * Fixed by keeping the same hue for dark mode, brightened to match the
 * established convention (rgb(174,181,242), the same value already used as
 * --sv-border-9aa3f0's own dark-mode counterpart) instead of collapsing to
 * black. Verified visually with a real Chromium render of the extracted
 * `.cal-card-focused` rule against both themes' variable values: the
 * pre-fix dark render was an outline barely distinguishable from the
 * background; the fix produces a clearly visible indigo ring, matching the
 * light-mode version's legibility.
 *
 * This suite pins the dark-theme override block itself, since the bug was
 * entirely in those six custom-property values, not in the box-shadow rule
 * that consumes them (which was already correct and untouched here).
 */
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function blockAfter(selector, fromIndex) {
  const re = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\n\\s*\\}', 'm');
  const rest = source.slice(fromIndex);
  const match = rest.match(re);
  ok(match, `CSS block for ${selector} (after offset ${fromIndex}) exists`);
  return match ? match[1] : '';
}

const SHADOW_VARS = [
  '--sv-shadow-rgba-94-106-210-_12',
  '--sv-shadow-rgba-94-106-210-0_18',
  '--sv-shadow-rgba-94-106-210-0_45',
  '--sv-shadow-rgba-94-106-210-0_55',
  '--sv-shadow-rgba-94-106-210-0_6',
];

// The file declares html[data-theme="dark"] { … } twice; only the SECOND
// (which comes after, and therefore overrides, the light :root block these
// vars are first declared in) is the one that actually wins the cascade.
// Anchor on the light-mode declaration and take the first dark block after it.
const lightAnchor = source.indexOf('--sv-shadow-rgba-94-106-210-0_6: rgba(94,106,210,0.6);');
ok(lightAnchor >= 0, 'the light-mode :root declaration of this shadow family is findable, to anchor the search');
const dark = blockAfter('html[data-theme="dark"]', lightAnchor);

for (const v of SHADOW_VARS) {
  const m = dark.match(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*([^;]+);'));
  ok(m, `${v} is declared in the dark-theme block`);
  const value = m ? m[1].trim() : '';
  ok(!/rgba\(\s*0,\s*0,\s*0\s*,/.test(value),
    `${v} keeps a colored (non-black) highlight in dark mode: ${value}`);
  ok(/rgba\(\s*174,\s*181,\s*242\s*,/.test(value),
    `${v} uses the brightened brand-indigo (174,181,242), matching the --sv-border-9aa3f0 dark-mode convention: ${value}`);
}

// The fully-transparent variant carries no color information visually, but
// pin its rgb triple anyway so a future edit can't quietly change it.
ok(dark.includes('--sv-shadow-rgba-94-106-210-0: rgba(94,106,210,0);'),
  'the transparent variant keeps its rgb triple (alpha 0, so no visible regression either way)');

// The rule that actually consumes these tokens for the persistent
// highlight -- unchanged by this fix, but if its variable names ever drift
// this suite should fail loudly rather than silently stop covering it.
ok(/\.cal-card-focused\s*\{\s*box-shadow:\s*0 0 0 3px var\(--sv-shadow-rgba-94-106-210-0_55\), 0 6px 22px var\(--sv-shadow-rgba-94-106-210-0_18\);\s*\}/.test(source),
  '.cal-card-focused still reads its ring color from the two pinned tokens above');

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\ncalendar focus-highlight dark-mode checks passed');
