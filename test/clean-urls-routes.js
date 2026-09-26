'use strict';
// Clean addresses: the route translator (src/index/003-sv-route.html.part)
// maps every old address to its clean path and back, leaves client share
// links and onboarding forms alone, and every top-level page has its stub.
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');
const { routeTable } = require('../scripts/build-route-stubs.js');

const r = routeTable();
let n = 0;
const pairs = [
  ['', '#production', '/synclinear'],
  ['?prod=1&d=del_1', '#production', '/synclinear/del_1'],
  ['?prod=1&batch=b_1', '', '/synclinear/batch/b_1'],
  ['?prod=1&d=a%2Fb&group=status', '#production', '/synclinear/a%2Fb?group=status'],
  ['', '#linear', '/submit'],
  ['', '#samples/c1/p_1', '/sample-reviews/c1/p_1'],
  ['', '#calendar/c1/p_1', '/calendar/c1/p_1'],
  ['', '#templates/Some%20Client', '/templates/Some%20Client'],
  ['?sxr=1', '#sample-reviews/c1/p_1', '/sample-reviews/c1/p_1?sxr=1'],
  ['', '#smm-weekly-reports?week=2026-09-21&smm=x', '/smm-weekly-reports?week=2026-09-21&smm=x'],
  ['', '#kasper/hiring-process', '/kasper/hiring-process'],
  ['?Kasper=1', '', '/kasper'],
  ['?Kasper=1', '#workload', '/workload'],
  ['', '#staff-onboarding', '/onboarding'],
  ['', '#client-credentials', '/client-credentials'],
  ['?intake=1', '', '/intake'],
  ['?onboarding_view=c1', '', '/onboarding/c1'],
  ['?wl2=1', '', '/?wl2=1'],
  ['', '', '/'],
];
for (const [search, hash, clean] of pairs) {
  assert.equal(r.toClean(search, hash), clean, `${search}${hash} -> ${clean}`); n++;
  if (clean === '/' || clean.startsWith('/?') || search.includes('Kasper')) continue;
  const u = new URL(clean, 'https://x.invalid');
  const back = r.toLegacy(u.pathname, u.search);
  assert.equal(r.toClean(back.search, back.hash), clean, `${clean} round-trips`); n++;
}
// Never touched: client share links, onboarding forms, staff client profiles.
for (const [search, hash] of [['?c=X&v=calendar&t=T', ''], ['?sxr=1&c=X&v=sample-reviews&t=T', ''], ['?c=X', '#X'], ['?onboarding=1', ''], ['?onboarding=ai', ''], ['', '#Some%20Client']]) {
  assert.equal(r.toClean(search, hash), null, `${search}${hash} stays as it is`); n++;
}
for (const p of ['/onboarding_form', '/ai_onboarding_form', '/nav-icons/x.png', '/unknown']) {
  assert.equal(r.toLegacy(p, ''), null, `${p} is not a route`); n++;
}
execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'build-route-stubs.js'), '--check'], { stdio: 'pipe' }); n++;
console.log(`clean-urls-routes: ${n} checks passed ✅`);
