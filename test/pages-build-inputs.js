'use strict';
/*
 * The page is built, not committed (since 2026-10-15). Three lists must agree
 * so a change to the build always republishes and re-tests the page:
 *   - BUILD_INPUTS in scripts/pages-retained-bundles.js (what it rebuilds),
 *   - every repository file scripts/build-index.js loads, transitively,
 *   - the path filters of the workflows that used to trigger on index.html.
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { BUILD_INPUTS } = require('../scripts/pages-retained-bundles');
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ok  ' + m); else { failures++; console.error('FAIL  ' + m); } };

const seen = new Set();
(function walk(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  for (const m of src.matchAll(/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
    let dep = path.posix.normalize(path.posix.join(path.posix.dirname(rel), m[1]));
    if (!dep.endsWith('.js')) dep += '.js';
    walk(dep);
  }
})('scripts/build-index.js');
for (const rel of seen) {
  ok(BUILD_INPUTS.includes(rel) || BUILD_INPUTS.some(i => rel.startsWith(i + '/')), `${rel} is a listed build input`);
}
ok(BUILD_INPUTS.includes('src/index'), 'src/index is a build input');

const filters = ['src/index/**', 'scripts/build-index.js', 'scripts/index-modules.js', 'scripts/index-split.js', 'scripts/index-minify.js', '.github/actions/build-index/**'];
for (const rel of seen) ok(filters.includes(rel) || rel.startsWith('src/index/'), `${rel} is in the shared path filter list`);
for (const wf of ['pages-site', 'production-polish-gate', 'pto-ui-tests', 'tiktok-carousel-browser-journey', 'client-entry-visible-boot', 'card-calendar-status-drift', 'linear-exit-preparation-ci']) {
  const text = fs.readFileSync(path.join(ROOT, '.github/workflows', wf + '.yml'), 'utf8');
  const missing = filters.filter(f => !text.includes(`- '${f}'`));
  ok(!missing.length, `${wf}.yml triggers on every build input${missing.length ? ' (missing ' + missing.join(', ') + ')' : ''}`);
  ok(text.includes('uses: ./.github/actions/build-index'), `${wf}.yml builds the page before reading it`);
}
const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const line of ['/index.html', '/js/sv-*.js', '/src/index/INDEX.md']) ok(ignore.split('\n').includes(line), `.gitignore lists ${line}`);
if (failures) { console.error(`\n${failures} build-input check(s) failed`); process.exit(1); }
console.log('\npages build input checks passed');
