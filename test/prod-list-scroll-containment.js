'use strict';
/*
 * Production list scroll containment — CSS contract.
 *
 * Slice 5 TEST drill run #16 failed f95_list_not_constrained with
 * client_height 1874 == scroll_height 1874: .prod-listwrap grew to fit its
 * content instead of scrolling inside a fixed frame, and the document scrolled
 * instead. The cause was a FLOOR where a ceiling was needed — .prod-view
 * carried min-height: calc(100vh - 64px), so the root of the flex chain was
 * free to grow and no descendant ever received a constrained height.
 *
 * This suite guards the declarations. The measured proof (real Chromium, four
 * viewport heights, long and short lists) lives in
 * docs/syncview-design/tests/prod-list-scroll-containment.js.
 */
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// The one rule that changed. A ceiling, not a floor: with only min-height the
// chain below can never resolve, whatever the descendants declare.
const view = (SOURCE.match(/^\s*\.prod-view \{[^}]*\}/m) || [''])[0];
// Anchored to a declaration boundary: \b would also match inside min-height.
ok(/(?:^|[;{])\s*height: calc\(100vh - 64px\);/.test(view),
  '.prod-view sets a definite height, so the flex chain has something to divide');
ok(!/\bmin-height: calc\(100vh - 64px\);/.test(view),
  '.prod-view no longer sets only a floor, which is what let the list grow');
ok(/\boverflow: hidden;/.test(view) && /\bdisplay: flex;/.test(view),
  '.prod-view still clips and still lays its children out as a flex row');

// The rest of the chain is UNCHANGED and load-bearing. If any of these drift,
// the definite height above stops reaching .prod-listwrap.
const rule = selector => {
  const match = SOURCE.match(new RegExp(`^\\s*\\${selector} \\{[^}]*\\}`, 'm'));
  return match ? match[0] : '';
};
const main = rule('.prod-main');
ok(/flex: 1;/.test(main) && /display: flex;/.test(main) && /flex-direction: column;/.test(main),
  '.prod-main still stretches to the view and stacks its children vertically');
const content = rule('.prod-content');
ok(/flex: 1;/.test(content) && /min-height: 0;/.test(content) && /overflow: hidden;/.test(content),
  '.prod-content still carries min-height: 0, without which a flex child cannot shrink');
const listwrap = rule('.prod-listwrap');
ok(/flex: 1;/.test(listwrap) && /overflow: auto;/.test(listwrap),
  '.prod-listwrap is still the scroll container');
ok(/<div class="prod-listwrap" role="region" aria-label="Production deliverables" tabindex="0">/.test(SOURCE),
  '.prod-listwrap is a named keyboard-focusable scroll region even when its rows have no controls');

// Consequences checked in the browser proof, pinned here so a later edit that
// changes their premise is caught by npm test rather than by a drill run.
const row = rule('.prod-row');
ok(/height: 44px;/.test(row) && /contain-intrinsic-size: 0 44px;/.test(row),
  'contain-intrinsic-size matches the real row height, so scrollHeight is exact');
const group = rule('.prod-group');
ok(/position: sticky;/.test(group) && /top: 0;/.test(group),
  '.prod-group is still sticky, and now sticks inside .prod-listwrap rather than the document');
const side = rule('.prod-side-scroll');
ok(/flex: 1;/.test(side) && /min-height: 0;/.test(side) && /overflow: auto;/.test(side),
  '.prod-side-scroll can absorb a tall sidebar now that the view cannot grow');

console.log(failures
  ? `\nProduction list scroll containment: ${failures} check(s) failed ❌`
  : '\nProduction list scroll containment checks passed');
process.exit(failures ? 1 : 0);
