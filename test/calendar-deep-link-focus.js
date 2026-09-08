'use strict';
/*
 * A CARD DEEP LINK THAT FAILS MUST NOT LOOK LIKE A CARD DEEP LINK THAT WORKED.
 *
 * OWNER REPORT 2026-08-26: an SMM sent a `#calendar/<slug>/<cardId>` link for
 * one card; opening it "focused on another card". The month and content filters
 * were both at All, so the card was not filtered out, and the card is in the
 * data — the lookup resolves it.
 *
 * What was left were two SILENT failures, and silence is what made this read as
 * "it opened the wrong one" instead of "it did nothing":
 *
 *   1. The DOM was queried on exactly one frame and, if the element was not
 *      there yet, the function returned without a word. The reader was then
 *      looking at the calendar's ordinary state — in which a DIFFERENT card
 *      carries `.cal-card-current`. Nothing had been focused; something else
 *      already was.
 *   2. The scroll was `behavior: 'smooth'`. A smooth scroll computes its target
 *      offset once and animates toward it; thumbnails decode mid-animation,
 *      every card ahead of the target changes width, and it finishes on a
 *      NEIGHBOUR. The outline sits on the right card, off screen.
 *
 * This suite executes the shipped function against a fake DOM and drives the
 * frames by hand, so each property is checked rather than pattern-matched.
 */
const fs = require('node:fs');
const path = require('node:path');
const { extractFunction } = require('./helpers/extract-function.js');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const start = html.indexOf('function _calApplyFocusRequest()');
const end = html.indexOf('/* ── The Organize menu', start);
const src = start >= 0 && end > start ? html.slice(start, end) : '';
ok(!!src, 'the focus handler is findable (harness is not vacuous)');
ok(/CAL_FOCUS_MAX_FRAMES/.test(src), 'and it is the retrying version, not the single-frame one');

/* ---- a fake DOM, driven a frame at a time -------------------------------- */
function harness(options) {
  const opts = options || {};
  const log = [];
  const frames = [];
  const timers = [];
  const card = {
    detached: false,
    classList: { add: c => log.push('class+' + c), remove: c => log.push('class-' + c) },
    scrollIntoView: init => log.push('scroll:' + init.behavior + ':' + init.inline + ':' + init.block),
    getBoundingClientRect: () => opts.rect || { left: 100, right: 300 },
  };
  let appearsAtFrame = opts.appearsAtFrame === undefined ? 0 : opts.appearsAtFrame;
  let frameNo = 0;
  const doc = {
    querySelector: () => (appearsAtFrame !== null && frameNo >= appearsAtFrame ? card : null),
    body: { contains: () => !card.detached },
    addEventListener: () => log.push('outside-listener'),
  };
  const notified = [];
  const viewChanges = [];
  const cleared = [];
  const renders = [];
  const toasts = [];
  const setFocusCalls = [];
  let hideToastCalls = 0;
  /* calState carries a view now, because a card only paints in the Sheet and
     the deferred deep-link path arrives with whatever view the client saved. */
  const calState = {
    client: 'Client',
    view: opts.view === undefined ? 'organizer' : opts.view,
    monthFilter: opts.monthFilter === undefined ? 'all' : opts.monthFilter,
    statusFilter: 'all',
    posts: opts.posts || [{ id: 'p_other', name: 'Other' }, { id: 'p_target', name: 'April 8th - Reel 14' }],
  };
  const fn = new Function(
    '_calFocusRequest', 'calState', 'wlNormalizeClient', 'showNotify',
    'requestAnimationFrame', 'document', 'window', 'setTimeout',
    '_calClearFocusHighlight', '_calFocusOutsideHandler',
    'onCalViewChange', 'onCalClearFilters', '_calOrganizeIsActive', '_calRenderBody',
    'showToast', '_calFmtDateShort', '_calSetFocusRequest', 'hideToast', '_calHideOwnToast',
    src + '\nreturn _calApplyFocusRequest;',
  )(
    { client: 'Client', cardId: 'p_target' },
    calState,
    v => String(v || '').toLowerCase(),
    (title, body) => notified.push(title + '|' + body),
    cb => frames.push(cb),
    doc,
    { innerWidth: 1400 },
    (cb, ms) => timers.push({ cb, ms }),
    () => log.push('clear-highlight'),
    () => {},
    v => { viewChanges.push(v); calState.view = v; },
    () => { cleared.push(calState.client); calState.monthFilter = 'all'; },
    () => calState.monthFilter !== 'all' || calState.statusFilter !== 'all',
    () => { renders.push(calState.focusPid); },
    msg => toasts.push(msg),
    iso => 'DATE(' + iso + ')',
    req => setFocusCalls.push(req),
    () => { hideToastCalls++; },
    () => { hideToastCalls++; },
  );
  fn();
  return {
    log, notified, card, timers, viewChanges, cleared, calState, renders, toasts, setFocusCalls,
    get hideToastCalls() { return hideToastCalls; },
    runFrames(n) { for (let i = 0; i < n; i++) { frameNo++; const queued = frames.splice(0); queued.forEach(cb => cb()); } },
    runTimers() { timers.splice(0).forEach(t => t.cb()); },
    pendingFrames: () => frames.length,
  };
}

/* ---- 1. the element is already there ------------------------------------ */
{
  const h = harness();
  h.runFrames(1);
  ok(h.log.includes('class+cal-card-focused'), 'a card that is already painted gets the persistent outline');
  ok(h.notified.length === 0, 'and nothing is announced via the blocking dialog, because nothing went wrong');
  ok(h.log.indexOf('class+cal-card-focused') < h.log.findIndex(e => e.startsWith('scroll:')),
    'the outline goes on BEFORE anything scrolls — if the scroll misbehaves the reader can still see which card was meant');
  ok(h.log.some(e => e.startsWith('scroll:auto:')),
    'the scroll is INSTANT: a smooth scroll fixes its target offset up front and late-decoding thumbnails land it on a neighbour');
  ok(!h.log.some(e => e.startsWith('scroll:smooth')), 'and is never smooth');
  ok(h.log.some(e => e === 'scroll:auto:center:nearest'),
    'centred horizontally, nearest vertically — block:center used to yank the whole page down');
  /* An outline color is easy to miss in a dense strip of near-identical cards —
     which is exactly what "I don't know which card it is" kept meaning even
     after the outline shipped. A toast says the card's name out loud. */
  ok(h.toasts.length === 1, 'arriving via a card link also announces which card, in words, via a toast');
  ok(/April 8th - Reel 14/.test(h.toasts[0]), 'and the toast names the exact card that was focused');
}
/* ---- 1b. the linked card does not exist on this calendar (Codex review, item 176) --- */
{
  // Nothing named 'p_target' in posts, so the lookup fails immediately —
  // still on the FIRST frame, well before the outline/toast success path.
  const h = harness({ posts: [{ id: 'p_other', name: 'Other' }] });
  h.runFrames(1);
  ok(h.notified.length === 1 && /Card not found/.test(h.notified[0]),
    'the blocking "Card not found" dialog still fires as before');
  ok(h.hideToastCalls === 1,
    'and the "Opening linked card…" toast the setter fired earlier is dismissed — without this it would sit on screen '
    + 'contradicting the modal that just told the reader the opposite');
}
{
  // A card with a scheduled date gets it appended, so the toast disambiguates
  // same-named drafts too, not just cards with distinct titles.
  const h = harness({ posts: [{ id: 'p_target', name: 'Reel', scheduled_date: '2026-09-08' }] });
  h.runFrames(1);
  ok(h.toasts.length === 1 && /DATE\(2026-09-08\)/.test(h.toasts[0]),
    'a scheduled card\'s toast includes its formatted date alongside its name');
}
{
  // No scheduled date yet (an unscheduled draft) must not print a bare "· " or
  // call the date formatter with nothing to format.
  const h = harness({ posts: [{ id: 'p_target', name: 'Draft' }] });
  h.runFrames(1);
  ok(h.toasts[0] === 'Linked to “Draft”',
    'an unscheduled card\'s toast has no trailing date separator');
}

/* ---- 2. the element paints a few frames late ---------------------------- */
{
  const h = harness({ appearsAtFrame: 6 });
  h.runFrames(1);
  ok(!h.log.length, 'a card that has not painted yet is not given up on after one frame — this is the bug that read as "it opened the wrong card"');
  ok(h.pendingFrames() === 1, 'the search is still queued for the next frame');
  h.runFrames(8);
  ok(h.log.includes('class+cal-card-focused'), 'and when the render lands, the right card is focused after all');
  ok(h.notified.length === 0, 'with nothing announced, because it worked');
}

/* ---- 3. the element never paints ---------------------------------------- */
{
  const h = harness({ appearsAtFrame: null });
  h.runFrames(60);
  ok(h.notified.length === 1, 'a card that never renders is announced exactly once, not retried forever and not dropped in silence');
  ok(/Card not shown/.test(h.notified[0]), 'and the notice says the card was not SHOWN, which is the true fault — it is on the calendar');
  ok(/April 8th - Reel 14/.test(h.notified[0]), 'it names the card, so the reader knows the link resolved to the right thing');
  /* Was: "points at the filters, which is the one thing the reader can act on".
     The code now CLEARS those filters itself before giving up (item 134), so
     telling the reader to go check them would be stale advice about work
     already done. What must survive is that the notice names the card and does
     not pretend the card is missing. */
  ok(!/Organize/.test(h.notified[0]),
    'and no longer sends the reader to filters the code has already cleared itself');
  ok(h.pendingFrames() === 0, 'and the frame loop stops rather than spinning for the life of the tab');
}

/* ---- 4. the correction after the layout settles ------------------------- */
{
  const offscreen = harness({ rect: { left: 2000, right: 2300 } });
  offscreen.runFrames(1);
  const before = offscreen.log.filter(e => e.startsWith('scroll:')).length;
  offscreen.runTimers();
  ok(offscreen.log.filter(e => e.startsWith('scroll:')).length === before + 1,
    'a card pushed off screen by a late layout shift is scrolled back once');
}
{
  const onscreen = harness({ rect: { left: 100, right: 400 } });
  onscreen.runFrames(1);
  const before = onscreen.log.filter(e => e.startsWith('scroll:')).length;
  onscreen.runTimers();
  ok(onscreen.log.filter(e => e.startsWith('scroll:')).length === before,
    'and a card that is still visible is left alone rather than re-scrolled under the reader');
}
{
  const gone = harness({ rect: { left: 2000, right: 2300 } });
  gone.runFrames(1);
  gone.card.detached = true;
  const before = gone.log.filter(e => e.startsWith('scroll:')).length;
  gone.runTimers();
  ok(gone.log.filter(e => e.startsWith('scroll:')).length === before,
    'a repaint that replaced the card cannot make the correction scroll to a detached node');
}

/* ── Two review findings from PR #1251, driven for real ─────────────────
   Both were verified against source before being fixed, and the second would
   have made the fix WORSE than the bug on exactly the links that prompted the
   owner's report — an unseeded client's card link, where the focus request is
   created after mount and the saved view is therefore still in place. */
{
  // A card only paints in the Sheet. Arriving on any other view must switch.
  const h = harness({ view: 'smmreview', appearsAtFrame: 1 });
  h.runFrames(5);
  ok(h.viewChanges[0] === 'organizer',
    'arriving on a non-Sheet view switches to the Sheet, where cards render');
  ok(h.calState.view === 'organizer', 'and the view actually ends up there');
}
{
  // Already on the Sheet: nothing to switch, and switching would re-render for free.
  const h = harness({ view: 'organizer', appearsAtFrame: 0 });
  h.runFrames(3);
  ok(h.viewChanges.length === 0,
    'a link that already lands on the Sheet does not churn the view');
}
{
  // The clear persists to whatever client is current, so a mid-wait client
  // switch must abandon rather than erase a bystander's saved filters.
  const h = harness({ appearsAtFrame: null, monthFilter: '2026-04' });
  h.runFrames(10);
  h.calState.client = 'Someone Else';
  h.runFrames(60);
  ok(h.cleared.length === 0,
    'a client switch mid-wait abandons the focus and clears NOBODY\'s filters');
  ok(h.notified.length === 0,
    'and it says nothing, because the reader has already moved on');
}
{
  /* The filter-CLEARING version was replaced by a focusPid bypass, which is
     what _calReviewOpenInSheet has always used. Nothing is cleared and nothing
     is persisted; the card is forced through the filters instead. */
  const h = harness({ appearsAtFrame: 2, monthFilter: '2026-04' });
  h.runFrames(10);
  ok(h.cleared.length === 0,
    'a filtered-out card is shown by bypassing the filters, never by clearing them');
  ok(h.calState.focusPid === 'p_target',
    'the card is pinned through the month, status and ready filters via focusPid');
  ok(!h.notified.some(n => /Filters cleared/.test(n)),
    'and the reader is told nothing, because nothing of theirs was changed');
}

/* ---- the pin cannot outlive the client it belongs to -------------------- */

/* `calState.focusPid` is GLOBAL, so a client switch is the other way it goes
   stale (the first is leaving the Sheet, which onCalViewChange handles). The
   first fix cleared it inside `_calOpenClientTab` alone; Codex caught on #1252
   that an ordinary tab click goes through onCalTabClick -> onCalClientChange,
   and that the search picker, active-tab removal, boot mount and client-entry
   purge assign the client too. Seven assignments, one of them remembering is
   not a rule. So the rule lives in the assignment: there is exactly ONE place
   the active client changes, and it carries the clear. */
{
  const INDEX = html;
  const setter = extractFunction(INDEX, '_calSetClient');
  ok(/calState\.client !== name.*calState\.focusPid = null/s.test(setter),
    '_calSetClient drops the focus pin whenever the client actually changes');

  const assignments = (INDEX.match(/calState\.client = /g) || []).length;
  ok(assignments === 1,
    'and it is the ONLY place calState.client is assigned, so a new switch path '
    + 'gets the rule by construction (found ' + assignments + ')');
  ok(setter.trim().endsWith('calState.client = name;\n    }'),
    'that one assignment being the setter\'s own, as the function\'s final statement');

  // Run it, rather than only reading it. _calFocusRequest/_calPendingDeepLink
  // are free variables the setter now reads (fifth pass, below) — null in
  // this first pass so these assertions stay about focusPid alone.
  const run = new Function(
    'calState', 'wlNormalizeClient', 'calClientSlug',
    '_calFocusRequest', '_calPendingDeepLink',
    '_calSetFocusRequest', '_calSetPendingDeepLink', '_calHideOwnToast',
    `${setter}; return _calSetClient;`,
  );
  const noop4 = () => {};
  let st = { client: 'a', focusPid: 'p1' };
  run(st, String, String, null, null, noop4, noop4, noop4)('b');
  ok(st.client === 'b' && st.focusPid === null, 'switching client drops the pin');
  st = { client: 'a', focusPid: 'p1' };
  run(st, String, String, null, null, noop4, noop4, noop4)('a');
  ok(st.client === 'a' && st.focusPid === 'p1',
    'while re-setting the SAME client keeps it — a no-op switch must not cancel a deep link mid-flight');
  st = { client: 'a', focusPid: 'p1' };
  run(st, String, String, null, null, noop4, noop4, noop4)(null);
  ok(st.client === null && st.focusPid === null, 'and clearing the client drops it too');

  /* Codex review, PR for item 176 (fifth pass): switching CLIENT TABS
     within the calendar (not leaving the page) is a fourth way the pin goes
     stale, and it's specific to _calFocusRequest/_calPendingDeepLink — they
     aren't focusPid, and nothing above touches them. Full harness this
     time: the setter now reads both, and calls the real setters/toast guard
     to clear them, but ONLY for a client that ISN'T the one the pending
     request is actually for — _calResolvePendingDeepLink's own
     _calSetFocusRequest(...) then _calOpenClientTab(...) sequence must
     survive landing here. */
  function runSetClient(opts) {
    opts = opts || {};
    const calls = { hideToast: 0, setFocus: [], setPending: [] };
    const fn = new Function(
      'calState', 'wlNormalizeClient', 'calClientSlug',
      '_calFocusRequest', '_calPendingDeepLink',
      '_calSetFocusRequest', '_calSetPendingDeepLink', '_calHideOwnToast',
      `${setter}\nreturn _calSetClient;`,
    );
    const calState = opts.calState || { client: 'a' };
    const setClient = fn(
      calState,
      v => String(v || '').toLowerCase(),
      v => String(v || '').toLowerCase(),
      opts.focusRequest || null,
      opts.pendingDeepLink || null,
      req => calls.setFocus.push(req),
      v => calls.setPending.push(v),
      () => { calls.hideToast++; },
    );
    return { setClient, calState, calls };
  }
  {
    // Switching to a DIFFERENT client than the one a card link named.
    const h = runSetClient({ calState: { client: 'A' }, focusRequest: { client: 'A', cardId: 'p1' } });
    h.setClient('B');
    ok(h.calls.setFocus.length === 1 && h.calls.setFocus[0] === null,
      'switching to a different client abandons a card-link request pinned to the old one');
    ok(h.calls.hideToast === 1, 'and dismisses its toast, so it does not linger on the new client\'s calendar');
  }
  {
    // Switching TO the very client the pending request is for — the
    // _calResolvePendingDeepLink sequence. Must survive.
    const h = runSetClient({ calState: { client: 'A' }, focusRequest: { client: 'B', cardId: 'p1' } });
    h.setClient('B');
    ok(h.calls.setFocus.length === 0,
      'but switching TO the client a pending request already names does not cancel it — that request is what the switch is FOR');
  }
  {
    // Same two shapes, for the deferred (sheet-only-client) pending link.
    const h = runSetClient({ calState: { client: 'A' }, pendingDeepLink: { slug: 'a', cardId: 'p1' } });
    h.setClient('B');
    ok(h.calls.setPending.length === 1 && h.calls.setPending[0] === null,
      'a deferred pending link is abandoned the same way when the client actually changes to something else');
  }
  {
    const h = runSetClient({ calState: { client: 'A' }, pendingDeepLink: { slug: 'b', cardId: 'p1' } });
    h.setClient('B');
    ok(h.calls.setPending.length === 0, 'and left alone when switching to the client it already names');
  }
  {
    // No cardId (the identifier/search-jump shape) — request still gets
    // dropped on a real client change, but there was never a toast to hide.
    const h = runSetClient({ calState: { client: 'A' }, focusRequest: { client: 'A', identifier: 'SS-1' } });
    h.setClient('B');
    ok(h.calls.setFocus.length === 1 && h.calls.hideToast === 0,
      'the identifier shape is still abandoned on a real client change, but nothing was showing to dismiss');
  }
  {
    // A no-op re-set of the SAME client must not touch either request at all.
    const h = runSetClient({ calState: { client: 'A' }, focusRequest: { client: 'A', cardId: 'p1' } });
    h.setClient('A');
    ok(h.calls.setFocus.length === 0 && h.calls.hideToast === 0,
      'a no-op client re-set does not go anywhere near the pending request or its toast');
  }
  /* Codex review, PR for item 176 (sixth pass): mountCalendar deliberately
     routes through _calSetClient(null) as a loader placeholder while a
     sheet-only-client link's roster read is still in flight (`else if
     (_calPendingDeepLink) initial = null;`) — a RETURNING staff tab already
     had a real client in calState.client, so this transition is genuinely
     `calState.client !== name`, and the fifth pass's own fix would have
     read it as "switched to a different client" and abandoned the very
     link _calResolvePendingDeepLink is about to open. null must stay
     permissive here. */
  {
    const h = runSetClient({ calState: { client: 'A' }, focusRequest: { client: 'B', cardId: 'p1' } });
    h.setClient(null);
    ok(h.calls.setFocus.length === 0 && h.calls.hideToast === 0,
      'mounting the loader (client -> null) does not abandon a card-link request that is still resolving');
  }
  {
    const h = runSetClient({ calState: { client: 'A' }, pendingDeepLink: { slug: 'b', cardId: 'p1' } });
    h.setClient(null);
    ok(h.calls.setPending.length === 0,
      'nor a deferred sheet-only-client link — the exact scenario the report named');
  }

  /* THE THIRD WAY IT GOES STALE. onCalViewChange covers leaving the Sheet and
     _calSetClient covers changing client; neither fires when you navigate to
     Home and back, and returning to the SAME pinned client is a no-op switch,
     so the pin survived the round trip. navTo drops it on the way out. */
  const navToSrc = extractFunction(INDEX, 'navTo');
  ok(/if \(page !== 'calendar'\) calState\.focusPid = null;/.test(navToSrc),
    'navTo drops the focus pin whenever it routes away from the calendar');
  ok(navToSrc.indexOf("if (page !== 'calendar') calState.focusPid = null;")
       > navToSrc.indexOf('_calV2Teardown'),
    'beside the calendar teardown, which is where leaving-the-calendar cleanup lives');
  /* Codex review, PR for item 176 (fourth pass, generalized on the
     seventh): a pending card link's "Opening linked card…" toast has the
     exact same staleness shape as focusPid — nothing clears it on leaving
     the calendar except this. */
  ok(/_calAbandonLinkOnCalendarExit\(page === 'calendar'\)/.test(navToSrc),
    'navTo also abandons any outstanding card-link request (foreground and deferred) on the way out');
  ok(navToSrc.indexOf('_calAbandonLinkOnCalendarExit(') > navToSrc.indexOf("calState.focusPid = null;"),
    'placed beside the focusPid clear it mirrors, not scattered elsewhere in the function');
  /* Seventh pass: navTo is not the only exit. render() (client-profile tab
     switches) and the state.client popstate branch both bypass navTo
     entirely — by their own comments — so the abandonment logic is a
     shared function, called from every route that already shares the
     _calV2Teardown line beside it, not reproduced inline three times. */
  const helper = extractFunction(INDEX, '_calAbandonLinkOnCalendarExit');
  ok(!!helper, 'the shared exit helper is findable');
  ok(/_calHideOwnToast\('Opening linked card'\)/.test(helper),
    'and it is what dismisses the toast, so the reader does not carry it to wherever they went');
  {
    const calls = { setFocus: 0, setPending: 0, hideToast: 0 };
    const run = new Function(
      '_calFocusRequest', '_calPendingDeepLink', '_calSetFocusRequest', '_calSetPendingDeepLink', '_calHideOwnToast',
      `${helper}\nreturn _calAbandonLinkOnCalendarExit;`,
    );
    const fn = run(
      { client: 'A', cardId: 'p1' }, null,
      () => { calls.setFocus++; }, () => { calls.setPending++; }, () => { calls.hideToast++; },
    );
    fn(true);
    ok(calls.setFocus === 0 && calls.hideToast === 0, 'still on the calendar (stillOnCalendar=true) touches nothing');
    fn(false);
    ok(calls.setFocus === 1 && calls.hideToast === 1, 'leaving abandons the request and dismisses the toast');
  }
  {
    const renderSrc = extractFunction(INDEX, 'render');
    const teardownAt = renderSrc.indexOf("if(tab!=='calendar'&&typeof _calV2Teardown==='function')_calV2Teardown();");
    const helperAt = renderSrc.indexOf("_calAbandonLinkOnCalendarExit(tab==='calendar')");
    ok(teardownAt > 0 && helperAt > teardownAt && helperAt - teardownAt < 400,
      'render() — which its own comment says bypasses navTo() — calls the shared helper beside its own _calV2Teardown line');
  }
  {
    const start = INDEX.indexOf("window.addEventListener('popstate'");
    const popstateSrc = INDEX.slice(start, start + 4000);
    const teardownAt = popstateSrc.indexOf("if(tab!=='calendar'&&typeof _calV2Teardown==='function')_calV2Teardown();");
    const helperAt = popstateSrc.indexOf("_calAbandonLinkOnCalendarExit(tab==='calendar')");
    ok(teardownAt > 0 && helperAt > teardownAt && helperAt - teardownAt < 400,
      'and so does the state.client popstate branch, which its own comment says never reaches navTo() either');
  }
  ok(/if \(v !== 'organizer'\) calState\.focusPid = null;/.test(INDEX),
    'and the two older exits are still there: leaving the Sheet…');
  ok(/calState\.client !== name\)\s*\{\s*\n\s*calState\.focusPid = null;/.test(INDEX),
    '…and changing client');
}

/* ── item 176: the reader is told the INSTANT a card link is recognized ────
   The outline (and the toast from item 175) only ever run once
   loadCalendarPosts's network read succeeds — replicated in a real browser,
   with that read mocked slow, there was nothing on screen saying a card link
   had even been recognized until the read finally landed, and mocked to
   never land at all, nothing ever appeared and no error was shown either.
   The fix is _calSetFocusRequest: the one place _calFocusRequest is ever
   assigned, which announces "Opening linked card…" immediately, before any
   fetch starts, and loadCalendarPosts's catch block, which speaks up if that
   promise is never kept. */
{
  const INDEX = html;
  const assignments = (INDEX.match(/_calFocusRequest = /g) || []).length;
  ok(assignments === 2,
    'and it is the ONLY place _calFocusRequest is assigned: the declaration '
    + 'and the setter\'s own body, so a new call site gets the announcement '
    + 'by construction (found ' + assignments + ')');
  ok(/function _calSetFocusRequest\(req\) \{[^}]*_calFocusRequest = req;/s.test(INDEX),
    'that one non-declaration assignment being the setter\'s own');

  const setter = extractFunction(INDEX, '_calSetFocusRequest');
  ok(!!setter, 'the setter is findable');
  const run = new Function('showToast', 'CAL_LOAD_TIMEOUT_MS', `
    let _calFocusRequest = null, _calFocusRequestLoadFailed = false;
    ${setter}
    return {
      set: _calSetFocusRequest,
      get: () => ({ _calFocusRequest, _calFocusRequestLoadFailed }),
      markFailed: () => { _calFocusRequestLoadFailed = true; },
    };
  `);
  {
    const toasts = [];
    const api = run(msg => toasts.push(msg), 20000);
    api.set({ client: 'Client', cardId: 'p_target' });
    ok(toasts.length === 1 && /Opening linked card/.test(toasts[0]),
      'a real card link announces itself immediately, before any network call has even started');
    ok(api.get()._calFocusRequest.cardId === 'p_target', 'and the request itself is still stored for loadCalendarPosts to act on');
  }
  {
    const toasts = [];
    const api = run(msg => toasts.push(msg), 20000);
    api.set({ client: 'Client', identifier: 'SS-123' });
    ok(toasts.length === 0,
      'the identifier/search-jump shape (no cardId) stays silent here — its own cal-card-flash covers it, not this');
  }
  {
    // A fresh link must not inherit a stale "already told them" flag from
    // whatever the PREVIOUS pinned link's load did — a second, different
    // card link right after a failed first one must still get its own
    // failure notice if it fails too.
    const api = run(() => {}, 20000);
    api.set({ client: 'Client', cardId: 'p_target' });
    api.markFailed(); // simulate: that link's load already failed once
    api.set({ client: 'Client', cardId: 'p_other' }); // a second, unrelated card link
    ok(api.get()._calFocusRequestLoadFailed === false,
      'setting a new card link resets the already-notified flag for the new pin');
  }
}

/* ── Codex review on the item 176 PR: the SAME silence, one step earlier ───
   A card link for a client outside the WL_CLIENT_NAMES seed is recognized as
   _calPendingDeepLink before the roster read that would resolve it to a real
   _calFocusRequest even starts — so without its own announcement, exactly
   these deferred/sheet-only-client links kept the reported silence for as
   long as THAT read takes, unfixed by _calSetFocusRequest alone. */
{
  const INDEX = html;
  const assignments = (INDEX.match(/_calPendingDeepLink = /g) || []).length;
  ok(assignments === 2,
    'and it is the ONLY place _calPendingDeepLink is assigned: the declaration '
    + 'and the setter\'s own body (found ' + assignments + ')');
  ok(/function _calSetPendingDeepLink\(v\) \{[^}]*_calPendingDeepLink = v;/s.test(INDEX),
    'that one non-declaration assignment being the setter\'s own');

  const setter = extractFunction(INDEX, '_calSetPendingDeepLink');
  ok(!!setter, 'the setter is findable');
  const toasts = [];
  const run = new Function('showToast', 'CAL_LOAD_TIMEOUT_MS', `
    let _calPendingDeepLink = null;
    ${setter}
    return { set: _calSetPendingDeepLink, get: () => _calPendingDeepLink };
  `)(msg => toasts.push(msg), 20000);
  run.set({ slug: 'somenewclient', cardId: 'p_abc' });
  ok(toasts.length === 1 && /Opening linked card/.test(toasts[0]),
    'a sheet-only client\'s card link announces itself the moment it\'s queued, not once the roster resolves it');
  ok(run.get().cardId === 'p_abc', 'and the pending link itself is still stored for _calResolvePendingDeepLink');
  run.set({ slug: 'somenewclient', cardId: null });
  ok(toasts.length === 1, 'a bare client-slug link (no card) stays silent — nothing to announce yet');
}

/* ── Codex review, PR for item 176 (fourth AND fifth pass): dismiss OUR
   toast only ────────────────────────────────────────────────────────────
   showToast/hideToast are one shared instance app-wide. Every hideToast()
   this feature calls now goes through _calHideOwnToast, which checks the
   toast actually on screen is still "Opening linked card…" before touching
   it — otherwise dismissing it after the fact could just as easily clobber
   an unrelated toast (an Undo prompt, a save confirmation) that legitimately
   replaced it in the interim.

   Fifth pass: the FIRST version of this check queried the DOM globally
   (document.querySelector), which is exactly wrong during hideToast()'s own
   220ms fade — the old element lingers in the document after _toastEl has
   already moved on to the new one, so a global query can read the dying
   leftover instead of what's actually live. Checking _toastEl directly (the
   one variable that IS the current toast, never a fading leftover) is the
   fix; this suite now passes _toastEl itself rather than a document mock,
   which is the point — there is no DOM query left to get stale. */
{
  const INDEX = html;
  const helper = extractFunction(INDEX, '_calHideOwnToast');
  ok(!!helper, 'the ownership-checking helper is findable');
  ok(!/document\.querySelector/.test(helper),
    'and it no longer queries the DOM at large — _toastEl is the only source of truth for "what toast is live"');
  const run = new Function('_toastEl', 'hideToast', `${helper}\nreturn _calHideOwnToast;`);
  {
    let hidden = 0;
    const toastEl = { querySelector: () => ({ textContent: 'Opening linked card… · Mon 09/08/26' }) };
    run(toastEl, () => { hidden++; })('Opening linked card');
    ok(hidden === 1, 'dismisses the toast when it is still the one this feature fired');
  }
  {
    let hidden = 0;
    // Some OTHER toast — an Undo prompt — has replaced ours by the time this
    // runs, so _toastEl now points at THAT element, not ours.
    const toastEl = { querySelector: () => ({ textContent: 'Card archived · Undo' }) };
    run(toastEl, () => { hidden++; })('Opening linked card');
    ok(hidden === 0, 'and leaves an unrelated toast alone — dismissing it would silently drop someone else\'s Undo');
  }
  {
    let hidden = 0;
    const toastEl = null;  // nothing showing at all
    run(toastEl, () => { hidden++; })('Opening linked card');
    ok(hidden === 0, 'and does nothing when no toast is showing at all');
  }
}

/* loadCalendarPosts's catch: the failure twin of the announcement above. */
{
  const loadFn = extractFunction(html, 'loadCalendarPosts');
  const catchStart = loadFn.indexOf('} catch (e) {');
  const catchEnd = loadFn.indexOf('} finally {');
  ok(catchStart > 0 && catchEnd > catchStart, 'loadCalendarPosts still has its catch/finally shape (harness is not vacuous)');
  const catchBlock = loadFn.slice(catchStart, catchEnd);
  ok(/if \(!opts\.background && _calFocusRequest && _calFocusRequest\.cardId && !_calFocusRequestLoadFailed/.test(catchBlock),
    'a failed load only speaks up for a still-pending, not-yet-notified card link');
  /* Codex review, PR for item 176: gating on the local `background` (which
     also turns true whenever cache-priming left posts on screen) would
     re-silence a RETURNING user's first, deliberate deep-link load — the
     exact case this item exists to fix. Must be opts.background, the
     caller's own intent, not the render-mode derivation. */
  ok(!/if \(!background && _calFocusRequest/.test(catchBlock),
    'and specifically not the cache-derived `background` — that flag also covers a returning user\'s cache-primed FIRST load');
  ok(/wlNormalizeClient\(calState\.client\) === wlNormalizeClient\(_calFocusRequest\.client\)/.test(catchBlock),
    'and only when the failed load was actually for the pinned link\'s client — a stale pin from a client the reader left must stay silent');
  ok(/_calFocusRequestLoadFailed = true;/.test(catchBlock),
    'and it marks itself told, so a string of background retries after the first foreground failure cannot re-notify for the same pin');
  ok(/showNotify\('Linked card not confirmed'/.test(catchBlock),
    'and it says so through the same blocking-dialog channel _calApplyFocusRequest\'s own failures use, not a toast that could expire unread');
  /* Codex review, second pass, PR for item 176: _calApplyFocusRequest is
     never reached on THIS failure path (ok never became true), so its own
     hideToast() call never runs either. A quick rejection — nowhere near the
     toast's ~21s duration — left "Opening linked card…" on screen right next
     to this modal saying the opposite. */
  ok(/_calHideOwnToast\('Opening linked card'\);\s*\n\s*showNotify\('Linked card not confirmed'/.test(catchBlock),
    'the pending "Opening linked card…" toast is dismissed immediately before this modal, not left to say the opposite of it');
}

/* ── Codex review, PR for item 176 (seventh pass): announce the toast to
   assistive technology ─────────────────────────────────────────────────
   showToast() built a plain div/span with no live-region semantics, so a
   screen-reader user got no announcement for "Opening linked card…" or
   "Linked to…" at all — the same silent wait this whole item exists to
   remove, just for a different reason. Matches the role="status" +
   aria-live="polite" convention already used throughout this file for
   loading/status announcements (the boot skeletons, workload save
   indicators, etc.) rather than inventing a new one. */
{
  const showToastSrc = extractFunction(html, 'showToast');
  ok(!!showToastSrc, 'showToast is findable');
  ok(/el\.setAttribute\('role', 'status'\)/.test(showToastSrc),
    'the toast root now carries role="status"');
  ok(/el\.setAttribute\('aria-live', 'polite'\)/.test(showToastSrc),
    'and aria-live="polite", so assistive tech announces it without interrupting whatever the reader is doing');
  ok(showToastSrc.indexOf("el.setAttribute('role', 'status')") < showToastSrc.indexOf('document.body.appendChild(el)'),
    'set before the element is ever inserted, so nothing can observe it without the announcement attributes');
}

if (failures) {
  console.error(`\n${failures} calendar deep-link focus check(s) failed`);

  process.exit(1);
}
console.log('\ncalendar deep-link focus checks passed');
