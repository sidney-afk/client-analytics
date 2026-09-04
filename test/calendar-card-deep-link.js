'use strict';
/*
 * test/calendar-card-deep-link.js
 *
 * OWNER REPORT 2026-09-03: "I click on the link and it just goes to the first
 * thing. It doesn't show the card that I'm opening."
 *
 * Two independent silent failures produced that one sentence, and both are
 * pinned here because both are SILENT — the defining property. A link that
 * opens the wrong thing without saying so is indistinguishable, to the reader,
 * from a broken link, which is why the report could not say which had happened.
 *
 *   1. The card is on the calendar but hidden by the per-client Organize
 *      filters, which are saved and re-applied when that client opens. The
 *      reader lands on the calendar's ordinary first card.
 *   2. The link's client slug does not resolve, and the code opened the first
 *      PINNED client instead, saying nothing.
 *
 * Source assertions, because the focus path needs a painted DOM, a live client
 * load and rAF timing. They pin the properties whose loss reproduces the
 * report, and they say plainly that they are the weaker kind of check.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// --- the focus path -------------------------------------------------------
/* Extracted by brace matching, NOT a fixed character window. The first draft
   sliced 6,000 characters from the function's start; adding ~25 lines to the
   function pushed half the assertions past the end of the window and they all
   failed at once, reporting nothing about the code they were meant to guard.
   `extractFunction` is in this repo for exactly that reason. */
const focus = extractFunction(SRC, '_calApplyFocusRequest');

/* The first version of this fix CLEARED the per-client Organize filters to make
   the card appear. It worked, and it was the wrong tool: it threw away a saved
   view to show one card, and persisted the loss. `calState.focusPid` already
   forces a single card through the month, status and client-ready filters —
   the mechanism `_calReviewOpenInSheet` has always used for the review→Sheet
   jump, which is what the owner meant by "we had that before". */
ok(/if \(req\.cardId\) calState\.focusPid = post\.id;/.test(focus),
  'a card link pins focusPid, bypassing the filters instead of clearing them');
ok(!/onCalClearFilters/.test(focus),
  'and it never clears or persists over the reader\'s saved view');
ok(/if \(calState\.view !== 'organizer'\) onCalViewChange\('organizer'\);/.test(focus),
  'it switches to the Sheet, the only view that renders .cal-card');
ok(/else if \(req\.cardId\) _calRenderBody\(\{ preserveScroll: true \}\);/.test(focus),
  'and re-renders when already on the Sheet, so the new focusPid takes effect');
{
  // focusPid and the view must both be settled BEFORE we start hunting for the
  // element, or the frame budget is spent looking for something that cannot exist.
  const pin = focus.indexOf('calState.focusPid = post.id');
  const loop = focus.indexOf('const focusWhenPainted');
  ok(pin > 0 && pin < loop, 'both happen before the frame budget starts, not after it is spent');
}
ok(/showNotify\('Card not shown'/.test(focus),
  'a card that still will not render says so — the path never ends in silence');

// --- two review findings, both real, both verified against source ---------
/* Codex on PR #1251. Neither was cosmetic: the second would have made the fix
   WORSE than the bug on exactly the links that prompted the report. */
ok(/if \(calState\.view !== 'organizer'\) onCalViewChange\('organizer'\);/.test(focus),
  'a deep link switches to the Sheet, the only view that renders .cal-card');
{
  // Mount forces the Sheet only when the focus request already exists. The
  // deferred path (an unseeded client) creates it AFTER mount, so without this
  // the card could never paint and the filter fallback would fire for nothing.
  const view = focus.indexOf("onCalViewChange('organizer')");
  const loop = focus.indexOf('const focusWhenPainted');
  ok(view > 0 && view < loop,
    'and it does so BEFORE the frame budget starts, not after it has been spent');
}
ok(/const focusClient = req\.client;/.test(focus),
  'the request\'s client is captured, not re-read from global state 40 frames later');
ok(/if \(!focusClientStillActive\(\)\) return;/.test(focus),
  'a client switch mid-wait abandons the focus instead of acting on the new client');
{
  /* focusPid is global state, so a client switch mid-wait would leave one
     client's focus pinned on another client's board. The clear-based version
     had the same hazard for a different reason; the guard survives the rewrite
     because the hazard did. */
  const loopTop = focus.slice(focus.indexOf('const focusWhenPainted'), focus.indexOf('const safe ='));
  ok(/focusClientStillActive\(\)/.test(loopTop),
    'and every frame re-checks the client, because focusPid is global state');
}

// --- the unresolved-slug path --------------------------------------------
{
  const at = SRC.indexOf('// Slug never resolved to a known client.');
  ok(at > 0, 'the unresolved-slug fallback is still where the deep link resolves');
  const block = SRC.slice(at - 200, at + 900);
  ok(/showNotify\('Calendar link not opened'/.test(block),
    'an unresolved slug SAYS SO instead of silently opening a different client');
  const notify = block.indexOf("showNotify('Calendar link not opened'");
  const open = block.indexOf('_calOpenClientTab(pins[0])');
  ok(notify > 0 && open > notify,
    'and it says so BEFORE falling back, so the message is not buried under a fresh render');
}

console.log(`\ncalendar-card-deep-link: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
