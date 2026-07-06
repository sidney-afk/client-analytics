'use strict';
/*
 * Templates refresh / back-forward routing. Regression for: refreshing on a
 * templates client (especially after switching to the Thumbnails tab) fell back
 * to the index. Root cause — navTo('templates') reset the hash to #templates and
 * dropped the client, so the next refresh had no client to restore. Now navTo
 * keeps #templates/<client> and carries the active tab in history.state (which
 * survives a reload), the boot handler + popstate restore both, and the tab is
 * persisted whenever it changes.
 *
 * (The URL/state-preservation + back/forward behaviour is additionally verified
 * end-to-end in a headless browser; this suite locks the wiring in place.)
 *
 * Run:  node test/templates-refresh-routing.js
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j]; if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}
let failures = 0;
function check(label, cond) { if (!cond) failures++; console.log(`${cond ? '✓' : '✗ FAIL'}  ${label}`); }

const navTo = grabFunc('navTo');
check('navTo carries the selected client + active tab in history.state for templates',
  /page === 'templates' && _templatesSelected\) \{ state\.templatesClient = _templatesSelected; state\.templatesTab = _templatesActiveTab; \}/.test(navTo));
check('navTo keeps #templates/<client> in the URL (does not reset to #templates)',
  /page === 'templates' && _templatesSelected\) hash = '#templates\/' \+ encodeURIComponent\(_templatesSelected\)/.test(navTo));

const switchTab = grabFunc('switchTemplatesTab');
check('switchTemplatesTab persists the active tab into history.state',
  /history\.replaceState\(\{ nav: 'templates'[^}]*templatesTab: tab \}/.test(switchTab) && /#templates\/' \+ encodeURIComponent\(_templatesSelected\)/.test(switchTab));

const openClient = grabFunc('openClientTemplate');
check('openClientTemplate seeds templatesTab in history.state',
  /templatesClient: name, templatesTab: 'reels'/.test(openClient));

// Boot handler (inside init) — prefer preserved history.state, restore the tab,
// and do NOT double-decode the already-decoded hash.
check('boot handler prefers the preserved history.state client + restores the tab',
  /const st = history\.state \|\| \{\};\s*\n\s*if \(st\.templatesClient\) seed = st\.templatesClient;/.test(INDEX) &&
  /if \(st\.templatesTab === 'reels' \|\| st\.templatesTab === 'thumbnails'\) _templatesActiveTab = st\.templatesTab;/.test(INDEX));
check('boot handler no longer double-decodes the (already-decoded) hash',
  !/let seed = tn; try \{ seed = decodeURIComponent\(tn\); \}/.test(INDEX));

// popstate (back/forward) restores the tab too.
check('popstate restores the templates tab from state',
  /state\.nav==='templates'[\s\S]{0,160}state\.templatesTab === 'reels' \|\| state\.templatesTab === 'thumbnails'\) _templatesActiveTab = state\.templatesTab;/.test(INDEX));

if (failures) { console.error(`\n${failures} check(s) failed ❌`); process.exit(1); }
console.log('\nAll templates-refresh-routing checks passed ✅');
