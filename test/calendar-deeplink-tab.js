'use strict';
/*
 * Content Calendar — deep-link "open client as a tab" regression test.
 *
 * Run:  node test/calendar-deeplink-tab.js   (exit 0 = all good)
 *
 * Bug (reported for a #calendar/<slug> link handed over by another SMM): opening
 * the link did NOT open that client as a tab.
 *
 * Two root causes, both covered here:
 *
 *   1. NO PIN. mountCalendar set calState.client from the deep link's focus
 *      request but never added the client to the open-tabs list (pins). The tab
 *      strip renders ONLY pins, so the body showed the client with no matching
 *      tab pill. _calOpenClientTab now pins + switches (mirrors pickAndPin).
 *
 *   2. BOOT RACE. On the fast path the router matches the slug against
 *      WL_CLIENT_NAMES, which is SEED-ONLY until fetchAll folds in the Clients
 *      Info sheet (wlMergeClientsFromSheet). A sheet-only client (e.g. "Jenna
 *      Phillips Ballard") isn't in the allowlist yet, so the slug never matched
 *      and the client never opened. _calResolvePendingDeepLink re-resolves once
 *      data lands and opens the client as a tab; it degrades gracefully if the
 *      slug never resolves so the strip never sticks on its loader.
 *
 * Extracts the REAL _calOpenClientTab / _calResolvePendingDeepLink (plus the
 * real _calGetPins/_calSavePins/wlNormalizeClient) from ../index.html and runs
 * them with the DOM-coupled dependencies stubbed.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    if (INDEX[j] === '{') depth++;
    else if (INDEX[j] === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function grabConst(name) {
  const m = INDEX.match(new RegExp('^\\s*const ' + name + '\\s*=.*;\\s*$', 'm'));
  if (!m) throw new Error('const not found: ' + name);
  return m[0];
}

const SANDBOX = `
const _store = Object.create(null);
const localStorage = {
  getItem(k){ return k in _store ? _store[k] : null; },
  setItem(k,v){ _store[k] = String(v); },
  removeItem(k){ delete _store[k]; }
};
// Boot-race allowlist: SEED-ONLY. "Jenna Phillips Ballard" is a sheet-only
// client and is intentionally absent until a test "merges the sheet".
let WL_CLIENT_NAMES = ['Baya Voce', 'Jessica Winterstern', 'Morgan Burton'];
let currentNav = 'calendar';
let calState = { client: null, embedded: false, posts: [] };
let _calPendingDeepLink = null;
let _calFocusRequest = null;
const calls = { loadCalendarPosts: 0, renderBody: 0, renderTabs: 0, renderShell: 0 };
// DOM-coupled deps → no-ops / counters.
function _calRenderTabs(){ calls.renderTabs++; }
function _calRenderShell(){ calls.renderShell++; }
function _calFlushAllPending(){}
function _calResetSelection(){}
function _calLoadClientFilters(){}
function _calSavePrefs(){}
function _calSyncUrlClient(){}
function _calRefreshFilterPill(){}
function _calMonthFilterHtml(){ return ''; }
function _calStatusFilterHtml(){ return ''; }
function _calRenderBody(){ calls.renderBody++; }
function loadCalendarPosts(){ calls.loadCalendarPosts++; }
${grabConst('CAL_PINS_KEY')}
${grabFunc('wlNormalizeClient')}
${grabFunc('_calGetPins')}
${grabFunc('_calSavePins')}
${grabFunc('_calOpenClientTab')}
${grabFunc('_calResolvePendingDeepLink')}
return {
  _store, CAL_PINS_KEY, calls,
  _calGetPins, _calSavePins, _calOpenClientTab, _calResolvePendingDeepLink,
  get calState(){ return calState; },
  get pending(){ return _calPendingDeepLink; }, set pending(v){ _calPendingDeepLink = v; },
  get focus(){ return _calFocusRequest; }, set focus(v){ _calFocusRequest = v; },
  get nav(){ return currentNav; }, set nav(v){ currentNav = v; },
  set WL(v){ WL_CLIENT_NAMES = v; }
};`;
const m = new Function(SANDBOX)();

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } };
function reset() {
  m._calSavePins([]);
  m.calState.client = null;
  m.calState.embedded = false;
  m.pending = null;
  m.focus = null;
  m.nav = 'calendar';
  m.WL = ['Baya Voce', 'Jessica Winterstern', 'Morgan Burton'];
  m.calls.loadCalendarPosts = 0;
  m.calls.renderBody = 0;
  m.calls.renderTabs = 0;
  m.calls.renderShell = 0;
}

console.log('— _calOpenClientTab pins AND switches to the client —');
reset();
m._calOpenClientTab('Jenna Phillips Ballard');
ok(m._calGetPins()[0] === 'Jenna Phillips Ballard', 'client is added to the open-tabs list (a tab appears)');
ok(m.calState.client === 'Jenna Phillips Ballard', 'client becomes the active client');
ok(m.calls.renderShell === 1, 'cold activation rebuilds client-dependent toolbar chrome');
ok(m.calls.loadCalendarPosts === 1, 'its calendar is loaded');

console.log('\n— Opening the already-active client is a no-op reload (no dup tab) —');
reset();
m._calOpenClientTab('Baya Voce');           // open + load
const loadsAfterFirst = m.calls.loadCalendarPosts;
m._calOpenClientTab('Baya Voce');           // again
ok(m._calGetPins().filter(n => n === 'Baya Voce').length === 1, 'no duplicate tab');
ok(m.calls.loadCalendarPosts === loadsAfterFirst, 'does not reload the same client');

console.log('\n— Existing tabs are preserved; the new one goes to the front —');
reset();
m._calSavePins(['Morgan Burton']);
m._calOpenClientTab('Jenna Phillips Ballard');
const pins = m._calGetPins();
ok(pins[0] === 'Jenna Phillips Ballard' && pins.includes('Morgan Burton'), 'new tab first, old tab kept');

console.log('\n— Boot race: deferred resolve opens a sheet-only client once the sheet merges —');
reset();
m._calSavePins(['Baya Voce']);              // user had Baya open last
m.pending = { slug: 'jennaphillipsballard', cardId: null };
m.WL = ['Baya Voce', 'Jessica Winterstern', 'Morgan Burton', 'Jenna Phillips Ballard']; // sheet merged
m._calResolvePendingDeepLink();
ok(m.calState.client === 'Jenna Phillips Ballard', 'switches to the deep-linked client');
ok(m._calGetPins()[0] === 'Jenna Phillips Ballard', 'and opens it as a tab');
ok(m.calls.renderShell === 1, 'deferred deep link restores More and Sheet actions');
ok(m.pending === null, 'pending deep link is cleared');

console.log('\n— Boot race: a card deep link carries the cardId into the focus request —');
reset();
m.pending = { slug: 'jennaphillipsballard', cardId: 'p_abc123' };
m.WL = ['Baya Voce', 'Jenna Phillips Ballard'];
m._calResolvePendingDeepLink();
ok(m.focus && m.focus.client === 'Jenna Phillips Ballard' && m.focus.cardId === 'p_abc123',
   'focus request set so the card scrolls into view after load');

console.log('\n— Graceful fallback: an unresolvable slug never sticks on the loader —');
reset();
m._calSavePins(['Baya Voce']);
m.calState.client = null;                   // loader is showing, no client yet
m.pending = { slug: 'whoisthis', cardId: null };
// WL stays seed-only → slug never resolves
m._calResolvePendingDeepLink();
ok(m.calState.client === 'Baya Voce', 'falls back to the first pinned client');
ok(m.calls.renderShell === 1, 'fallback uses the same complete toolbar activation path');
ok(m.calls.loadCalendarPosts === 1, 'and loads it (no stuck loader)');

console.log('\n— Navigated away while loading: resolver does not yank the user back —');
reset();
m.calState.client = null;
m.pending = { slug: 'jennaphillipsballard', cardId: null };
m.WL = ['Baya Voce', 'Jenna Phillips Ballard'];
m.nav = 'home';                             // user left the calendar
m._calResolvePendingDeepLink();
ok(m.calState.client === null, 'active client untouched');
ok(m.calls.loadCalendarPosts === 0 && m.calls.renderBody === 0, 'no calendar work done');
ok(m.pending === null, 'pending deep link still cleared (no leak)');

console.log('\n' + (fail === 0 ? 'OVERALL: PASS' : 'OVERALL: FAIL (' + fail + ' failed)'));
process.exit(fail === 0 ? 0 : 1);
