'use strict';
/*
 * OPEN_REPAIRS item 84 — a bookmarked #calendar/<slug> opened the analytics
 * roster instead of the calendar.
 *
 * The tester read this as "the calendar never mounts". It does mount, and is
 * then painted over. A fragment navigation the app did not create -- typed,
 * bookmarked, or followed into an already-open tab, and any Back/Forward across
 * such an entry -- produces a history entry with NO state. The browser fires
 * popstate for it (before hashchange, and this app registers no hashchange
 * listener), and the stateless branch of the popstate handler knew exactly three
 * routes: templates, templates/<client>, and a bare client name. Everything else
 * fell to render('all'), which replaces #content with the analytics overview.
 *
 * It is silent because render() never assigns currentNav and never touches the
 * nav pills or calState: the tab keeps reading as active while its DOM is gone,
 * no exception is thrown, nothing is logged. Recovery is clicking the
 * already-active nav button, which is exactly what the tester found.
 *
 * This suite EXECUTES the shipped handler with a stubbed page and asserts where
 * each hash lands -- including that the two unlock-gated tabs cannot be entered
 * through popstate, which is the one way this repair could have widened access.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Slice the popstate listener: from its addEventListener through the balanced
 * close. Comment-aware, because the branch carries prose with apostrophes. */
const start = INDEX.indexOf("window.addEventListener('popstate'");
ok(start >= 0, 'the popstate listener exists');
let depth = 0, end = -1, quote = '', escaped = false, comment = '';
for (let i = INDEX.indexOf('{', start); i < INDEX.length; i++) {
  const c = INDEX[i], next = INDEX[i + 1];
  if (comment) {
    if (comment === 'line' && c === '\n') comment = '';
    else if (comment === 'block' && c === '*' && next === '/') { comment = ''; i++; }
    continue;
  }
  if (quote) {
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (c === quote) quote = '';
    continue;
  }
  if (c === '/' && next === '/') { comment = 'line'; i++; continue; }
  if (c === '/' && next === '*') { comment = 'block'; i++; continue; }
  if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
  if (c === '{') depth++;
  else if (c === '}' && --depth === 0) { end = INDEX.indexOf(')', i) + 1; break; }
}
ok(end > start, 'the listener closes');
const listener = INDEX.slice(start, end);

function fire(hash, opts) {
  opts = opts || {};
  const calls = { navTo: [], render: [], focus: null, smFocus: null, kasperTab: null };
  const ctx = {
    decodeURIComponent, console,
    window: {
      addEventListener: (_evt, fn) => { ctx.__handler = fn; },
      scrollTo: () => {},
    },
    document: { getElementById: () => ({ set innerHTML(_v) {} }) },
    location: { hash: hash ? '#' + hash : '' },
    navTo: (nav) => calls.navTo.push(nav),
    render: (what) => calls.render.push(what),
    wlIsAllowedClient: name => name === 'Sidney Laruel',
    wlCanonicalClient: name => name,
    wlNormalizeClient: name => String(name).toLowerCase().replace(/[^a-z0-9&]+/g, ''),
    WL_CLIENT_NAMES: ['Sidney Laruel'],
    KASPER_SUBTABS: [{ key: 'review' }, { key: 'filming' }],
    _kasperState: { set tab(v) { calls.kasperTab = v; } },
    _isClientLink: !!opts.clientLink,
    _kasperUnlocked: !!opts.kasperUnlocked,
    _ttpUnlocked: !!opts.ttpUnlocked,
    _syncviewClientEntryCapability: opts.clientLink ? { client: 'Sidney Laruel', slug: 'sidneylaruel', verified: true } : null,
    _syncviewClientEntryEnvelope: () => ({ ok: true }),
    _syncviewClientEntrySlug: name => String(name).toLowerCase().replace(/[^a-z0-9&]+/g, ''),
    _syncviewInvalidClientLinkScreen: () => { calls.invalidLinkScreen = true; },
    _syncviewSyncClientEntryRunHref: () => {},
    mountSxrClientView: () => { calls.sxrClientView = true; },
    clientViewTab: {}, activeBriefSection: {}, activeBriefTab: {}, activeMRBriefTab: {},
    clientHistory: () => [],
    renderClient: () => '',
    renderChart: () => {}, renderViewsChart: () => {},
    mountCalendarEmbedded: () => {},
    setTimeout: () => {},
    set _templatesSelected(v) { calls.templatesSelected = v; },
    get _templatesSelected() { return calls.templatesSelected; },
    set _templatesActiveTab(v) {},
    set _calFocusRequest(v) { calls.focus = v; },
    get _calFocusRequest() { return calls.focus; },
    set _calPendingDeepLink(v) { calls.pending = v; },
    get _calPendingDeepLink() { return calls.pending; },
    _calResolvePendingDeepLink: () => { calls.resolved = true; },
    set _smFocusRequest(v) { calls.smFocus = v; },
    get _smFocusRequest() { return calls.smFocus; },
  };
  vm.createContext(ctx);
  vm.runInContext(listener, ctx);
  ctx.__handler({ state: opts.state || null });
  return calls;
}

/* 1. The tester's exact reproduction. */
{
  const c = fire('calendar/sidneylaruel');
  ok(c.navTo.join() === 'calendar' && !c.render.length,
    'a stateless #calendar/<slug> routes to the calendar and never repaints the roster');
  ok(c.focus && c.focus.client === 'Sidney Laruel' && c.focus.cardId === null,
    'and carries the client through as a focus request, so the deep link opens the right calendar');
}
/* 1b. A slug the seed allowlist does not know is a sheet-only client, not a
 *     dead link. Caught by review measurement: without this arm the calendar
 *     mounted on whichever client was previously active and the address bar was
 *     rewritten to it — the reader silently on the wrong calendar. */
{
  const c = fire('calendar/somesheetonlyclient');
  ok(c.navTo.join() === 'calendar', 'an unknown slug still mounts the calendar');
  ok(c.focus === null, 'and does NOT focus a client it never matched');
  ok(c.pending && c.pending.slug === 'somesheetonlyclient',
    'it is queued as a pending deep link, exactly as the boot router does');
  ok(c.resolved === true, 'and the resolver is invoked to settle it against the merged roster');
}

/* 2. The card-level deep link keeps its card id. */
{
  const c = fire('calendar/sidneylaruel/p_native_abc');
  ok(c.focus && c.focus.cardId === 'p_native_abc', 'a card deep link keeps its card id');
}
/* 3. The other half of the report. */
{
  const c = fire('kasper', { kasperUnlocked: true });
  ok(c.navTo.join() === 'kasper' && !c.render.length, 'an unlocked #kasper mounts Kasper');
}
/* 4. The line this repair must not cross: popstate is not an unlock. */
{
  const c = fire('kasper', { kasperUnlocked: false });
  ok(c.navTo.length === 0 && c.render.join() === 'all',
    'a LOCKED #kasper does not mount through popstate — it falls back, as before');
  const t = fire('tiktok-pilot', { ttpUnlocked: false });
  ok(t.navTo.length === 0 && t.render.join() === 'all',
    'and neither does a locked #tiktok-pilot');
}
/* 5. The plain fast tabs. */
{
  for (const tab of ['workload', 'linear', 'calendar', 'samples', 'filming-plans', 'time-off']) {
    const c = fire(tab);
    ok(c.navTo.join() === tab && !c.render.length, `a stateless #${tab} mounts ${tab}`);
  }
}
/* 6. What must NOT change: the three routes the branch already knew, and the
 *    genuine fallback for something unrecognized. */
{
  const t = fire('templates');
  ok(t.navTo.join() === 'templates', 'templates still routes');
  const tc = fire('templates/Sidney Laruel');
  ok(tc.navTo.join() === 'templates' && tc.templatesSelected === 'Sidney Laruel',
    'templates/<client> still selects the client');
  const cl = fire('Sidney Laruel');
  ok(cl.render.join() === 'Sidney Laruel', 'a bare client name still renders that client');
  const junk = fire('not-a-real-route');
  ok(junk.render.join() === 'all', 'an unrecognized hash still falls back to the overview');
  const empty = fire('');
  ok(empty.render.join() === 'all', 'and so does an empty hash');
}
/* 7. Client links never reach the new routing at all: the handler returns for
 *    them at its very first branch, and a stateless entry (no verified state)
 *    lands on the invalid-link screen exactly as before. The !_isClientLink
 *    guard inside the stateless branch is therefore belt-and-braces, and this
 *    is what proves it. */
{
  const c = fire('calendar/sidneylaruel', { clientLink: true });
  ok(c.invalidLinkScreen === true && c.navTo.length === 0 && c.render.length === 0,
    'a client link takes the client-entry path, never the new staff routing');
}
/* 8. A state-carrying entry never reaches this branch at all. */
{
  const c = fire('calendar/sidneylaruel', { state: { nav: 'workload' } });
  ok(c.navTo.join() === 'workload',
    'an entry the app created still routes from its state, not from the hash');
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\npopstate hash-route checks passed');
