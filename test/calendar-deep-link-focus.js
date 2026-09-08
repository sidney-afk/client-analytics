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
    'showToast', '_calFmtDateShort', '_calSetFocusRequest', 'hideToast',
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
  ok(/function _calSetClient\(name\) \{[^}]*calState\.client = name;/s.test(INDEX),
    'that one assignment being the setter\'s own');

  // Run it, rather than only reading it.
  const run = new Function('calState', `${setter}; return _calSetClient;`);
  let st = { client: 'a', focusPid: 'p1' };
  run(st)('b');
  ok(st.client === 'b' && st.focusPid === null, 'switching client drops the pin');
  st = { client: 'a', focusPid: 'p1' };
  run(st)('a');
  ok(st.client === 'a' && st.focusPid === 'p1',
    'while re-setting the SAME client keeps it — a no-op switch must not cancel a deep link mid-flight');
  st = { client: 'a', focusPid: 'p1' };
  run(st)(null);
  ok(st.client === null && st.focusPid === null, 'and clearing the client drops it too');

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
  ok(/if \(v !== 'organizer'\) calState\.focusPid = null;/.test(INDEX),
    'and the two older exits are still there: leaving the Sheet…');
  ok(/calState\.client !== name\) calState\.focusPid = null;/.test(INDEX),
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
}

if (failures) {
  console.error(`\n${failures} calendar deep-link focus check(s) failed`);

  process.exit(1);
}
console.log('\ncalendar deep-link focus checks passed');
