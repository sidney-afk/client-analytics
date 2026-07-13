'use strict';
/*
 * Phase-1 retirement guard for Samples Old.
 *
 * This is intentionally source-level and offline: it proves the legacy nav is
 * absent, executes the route resolver used by navTo(), and pins the dormant
 * legacy/SXR boundaries so a later cleanup cannot accidentally happen here.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function check(label, condition) {
  if (condition) console.log('  ok  ' + label);
  else { console.log('  FAIL  ' + label); failures++; }
}

const header = (INDEX.match(/<div class="header-nav" id="headerNav">([\s\S]*?)<\/div>\s*<div class="header-actions">/) || [])[1] || '';
check('Samples Old nav button is absent', !/id="navSamples"/.test(header) && !/>\s*Samples Old\s*</.test(header));
check('Samples nav keeps the SXR id and route', /id="navSxr"[^>]*href="#sample-reviews"/.test(header));
check('Samples nav uses the post-retirement visible label', />\s*Samples\s*</.test(header) && !/>\s*Samples New\s*</.test(header));

const resolverSource = (INDEX.match(/function _resolveRetiredSamplesRoute\(page\) \{[\s\S]*?\n    \}/) || [])[0];
check('legacy route resolver is present', !!resolverSource);
if (resolverSource) {
  const resolve = vm.runInNewContext('(' + resolverSource + ')');
  check('#samples route resolves to Samples New', resolve('samples') === 'sample-reviews');
  check('#samples subpaths resolve to Samples New', resolve('samples/client/card') === 'sample-reviews');
  for (const route of ['home', 'calendar', 'sample-reviews', 'templates', 'production']) {
    check(route + ' route is unaffected', resolve(route) === route);
  }
}
const navToSource = (INDEX.match(/function navTo\(page, push = true\) \{[\s\S]*?\n    \}/) || [])[0] || '';
check('navTo applies the retirement resolver before selecting currentNav',
  navToSource.indexOf('page = _resolveRetiredSamplesRoute(page);') >= 0
  && navToSource.indexOf('page = _resolveRetiredSamplesRoute(page);') < navToSource.indexOf('currentNav = page;'));
check('boot predictor sends old hashes to Samples New',
  (INDEX.match(/target = [^;]*samples[^;]*sample-reviews[^;]*;/g) || []).length >= 2);

check('legacy renderer remains dormant for Phase 1',
  /function renderSamplesView\(/.test(INDEX) && /function mountSamplesView\(/.test(INDEX));
check('legacy endpoints remain intact for Phase 1',
  /webhook\/samples-get/.test(INDEX) && /webhook\/samples-upsert/.test(INDEX) && /webhook\/samples-reorder/.test(INDEX));
check('Samples New renderer and route remain intact',
  /page === 'sample-reviews'/.test(INDEX) && /renderSxrView\(\)/.test(INDEX) && /mountSxrView\(\)/.test(INDEX));

console.log(failures ? `\nsamples-legacy-retirement: ${failures} check(s) failed` : '\nsamples-legacy-retirement: all checks passed');
process.exit(failures ? 1 : 0);
