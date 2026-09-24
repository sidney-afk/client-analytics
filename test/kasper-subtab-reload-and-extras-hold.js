'use strict';
/*
 * Speed map 2026-09-23 §5 and §7.
 *
 * §7: reloading a Kasper subtab (hiring 6/6, onboarding 4/6) landed on review.
 * Cause, measured on a live rig: navTo('kasper') wrote a bare #kasper, so the
 * URL the reload reads had already lost the subtab; and a capability gate that
 * ran before key-verify answered fell back to review permanently.
 *
 * §5: the review tab's first card waited behind the analytics extras
 * (TopVideos and the briefs sheets), which Kasper never displays.
 *
 * Executes the shipped functions extracted from index.html.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Brace-balanced extraction that understands COMMENTS as well as strings.
 * The plain quote-aware scanner most suites use cannot read this region: the
 * loader is heavily commented and those comments are full of apostrophes
 * ("Kasper's queue", "hasn't yet propagated"), each of which opens a string
 * the scanner never closes. */
function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

/* ---- 1. navTo keeps the Kasper subtab in the URL ----------------------- */
const navTo = grabFunc('navTo');
ok(/page === 'kasper'[\s\S]{0,160}hash = '#kasper\/' \+ _kasperState\.tab/.test(navTo),
  'navTo writes #kasper/<subtab> instead of a bare #kasper');

/* ---- 2. A gate that runs before key-verify answers is temporary --------- */
const src = ['_kasperStaffCheckPending', '_kasperDenySubtab', '_kasperRestorePendingSubtab', '_kasperFallbackToReview']
  .map(grabFunc).join('\n');
function world(opts) {
  const w = {
    valid: false, stored: true, role: 'admin', epoch: 3, nav: 'kasper', hash: '#kasper/hiring-process',
    saved: 'hiring-process', offers: 0, gotoCalls: [],
  };
  Object.assign(w, opts || {});
  const api = new Function('w', `
    let _kasperPendingSubtab = '', _kasperPendingEpoch = -1;
    const _kasperState = { tab: w.tab || 'hiring-process' };
    const KASPER_SUBTAB_KEY = 'k';
    const localStorage = { setItem: (k, v) => { w.saved = v; } };
    const location = { pathname: '/', search: '?Kasper=1' };
    const history = { replaceState: (s, t, u) => { w.hash = u.slice(u.indexOf('#')); } };
    const _syncviewStaffIdentityValid = () => w.valid;
    const _syncviewStaffIdentityLoad = () => w.stored ? { key: 'k', member: { id: 'm' } } : null;
    const _syncviewStaffCan = cap => w.valid && (cap !== 'hiring' || w.role === 'admin');
    const _syncviewOfferStaffSignIn = () => { w.offers++; };
    const _ptoEnabled = () => true;
    const _kasperSyncTabNav = () => {};
    const _kasperGotoTab = t => { w.gotoCalls.push(t); if (t === 'hiring-process' && !_syncviewStaffCan('hiring')) return; _kasperState.tab = t; };
    ${src.replace(/currentNav/g, 'w.nav').replace(/_syncviewNavEpoch/g, 'w.epoch')}
    return { state: _kasperState, deny: _kasperDenySubtab, restore: _kasperRestorePendingSubtab };
  `)(w);
  return { w, api };
}

let t = world();
t.api.deny('hiring');
ok(t.api.state.tab === 'review', 'pending: review shows while key-verify is out');
ok(t.w.hash === '#kasper/hiring-process' && t.w.saved === 'hiring-process',
  'pending: the URL and saved subtab keep the requested tab');
ok(t.w.offers === 0, 'pending: no sign-in prompt is raised');
t.w.valid = true;
t.api.restore();
ok(t.api.state.tab === 'hiring-process', 'verified admin: the hiring subtab comes back');

t = world();
t.api.deny('hiring');
t.w.valid = true; t.w.role = 'smm';
t.api.restore();
ok(t.api.state.tab === 'review' && t.w.hash === '#kasper' && t.w.saved === 'review',
  'verified but not allowed: the fallback becomes permanent, as before');

t = world();
t.api.deny('hiring');
t.w.epoch++;            // the visitor clicked a tab while key-verify was out
t.w.valid = true;
t.api.restore();
ok(t.w.gotoCalls.length === 0, 'a navigation since parking wins over the restore (Phase D epoch)');

t = world({ stored: false });
t.api.deny('hiring');
ok(t.w.hash === '#kasper' && t.w.saved === 'review' && t.w.offers === 1,
  'signed out: falls back and offers sign-in exactly as before');

ok(/_kasperRestorePendingSubtab\(\)/.test(grabFunc('_syncviewStaffRefreshChrome')),
  'the staff chrome refresh (runs when key-verify settles) calls the restore');

/* ---- 3. The analytics extras wait for Kasper's first content ----------- */
const holdSrc = ['_analyticsHoldExtras', '_analyticsReleaseExtras', 'fetchAll'].map(grabFunc).join('\n');
const h = new Function(`
  let _analyticsExtrasHold = null; let started = 0;
  const fetchEssentials = () => Promise.resolve();
  const fetchExtras = () => { started++; return Promise.resolve(); };
  ${holdSrc}
  return { hold: _analyticsHoldExtras, release: _analyticsReleaseExtras, fetchAll, started: () => started };
`)();
(async () => {
  h.hold(60000);
  h.fetchAll(null);
  await new Promise(r => setTimeout(r, 10));
  ok(h.started() === 0, 'held: the extras do not start at boot on a Kasper landing');
  h.release();
  await new Promise(r => setTimeout(r, 10));
  ok(h.started() === 1, 'released: the extras start once');
  h.fetchAll(null);
  ok(h.started() === 2, 'no hold: other landings start the extras immediately');

  const boot = INDEX.slice(INDEX.indexOf('const dataLoad = fetchAll(') - 400, INDEX.indexOf('const dataLoad = fetchAll('));
  ok(/_kasperHashLanding[\s\S]*_analyticsHoldExtras\(8000\)/.test(boot), 'the boot holds the extras only for a Kasper landing, with a safety timeout');
  ok(/_kasperState\.lastLoaded && typeof _analyticsReleaseExtras === 'function'/.test(grabFunc('_kasperPaintReview')),
    'the review releases them only after the queue has loaded and painted');
  ok(/page !== 'kasper' && typeof _analyticsReleaseExtras/.test(navTo), 'leaving Kasper releases them');
  ok(/if \(_analyticsExtrasHold\) \{ _analyticsReleaseExtras\(\); fetchExtras\(null\); \}/.test(grabFunc('_analyticsExtrasArrival')),
    'a client page reached without navTo (search, Back) releases and starts them itself');

  if (failures) { console.error('\n' + failures + ' check(s) failed'); process.exit(1); }
  console.log('\nKasper subtab reload + extras hold checks passed');
})();
