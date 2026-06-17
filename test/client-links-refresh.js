'use strict';
/*
 * "Open profiles" (Instagram/TikTok/YouTube) must follow the ACTIVE client when
 * you switch tabs — not keep opening the previous client's accounts. Regression.
 *
 * Run:  node test/client-links-refresh.js   (exit 0 = all good)
 *
 * BUG. _calSyncClientLinks inserted the toolbar button once and then `if
 * (existing) return;` — so switching client tabs (which does NOT rebuild the
 * toolbar) left the PREVIOUS client's handles on the button. FIX. The button is
 * tagged data-client; _calSyncClientLinks rebuilds it when that differs from
 * calState.client, while still leaving it untouched for same-client background
 * refreshes (so an open menu isn't closed mid-click). Proven end-to-end with a
 * headless A/B (switch Chelsey→Danielle: old code keeps @chelsey, this build
 * updates to @dani).
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
let failures = 0;
function check(label, got, want) {
  const ok = got === want; if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${got}, want ${want})`);
}

const links = grabFunc('_calClientLinks');
check('handles are sourced from the CURRENT client (clientMap[calState.client])',
  /clientMap\[calState\.client\]/.test(links), true);

const html = grabFunc('_calClientLinksHtml');
check('the button is tagged with its client (data-client)',
  /id="calClientLinksWrap" data-client="\$\{_calEscAttr\(calState\.client/.test(html), true);

const sync = grabFunc('_calSyncClientLinks');
check('same client → leave the (maybe open) menu untouched (early return)',
  /getAttribute\('data-client'\)\s*===\s*\(calState\.client \|\| ''\)\) return;/.test(sync), true);
check('different client → drop the stale button and rebuild',
  /existing\.remove\(\);/.test(sync), true);
check('no longer the blanket "if (existing) return;" that froze the handles',
  /if \(existing\) return;/.test(sync), false);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll client-links-refresh checks passed.');
