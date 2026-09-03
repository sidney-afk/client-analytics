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

ok(/let clearedFilters = false;/.test(focus),
  'the focus path can clear the filters that hid the card');
{
  /* Asserted as a property over the guard, not as one exact line: the guard
     grew a client re-check (below) and a punctuation-exact pin would have
     failed for that alone, which teaches people to edit pins. */
  const guard = focus.slice(focus.indexOf('if (!clearedFilters'), focus.indexOf('onCalClearFilters()'));
  ok(/_calOrganizeIsActive\(\)/.test(guard) && /typeof _calOrganizeIsActive === 'function'/.test(guard),
    'it only clears when filters are actually active — a default view is never disturbed');
}
ok(/clearedFilters = true;[\s\S]{0,80}framesWaited = 0;/.test(focus),
  'and it restarts the frame budget, so the card gets a fresh chance to paint');
ok(/onCalClearFilters\(\)/.test(focus),
  'it reuses the Organize menu\'s own Clear, so ordering mode survives and the change persists identically');
ok(/showNotify\('Filters cleared'/.test(focus),
  'the reader is told their view changed rather than left to notice');
{
  // Load-bearing ordering: clearing BEFORE the frame budget would throw away a
  // saved view on every deep link, including the ones about to paint anyway.
  const budget = focus.indexOf('framesWaited < CAL_FOCUS_MAX_FRAMES');
  const clear = focus.indexOf('onCalClearFilters()');
  ok(budget > 0 && clear > budget,
    'the clear happens only AFTER the frame budget is spent, never up front');
}
ok(/showNotify\('Card not shown'/.test(focus),
  'a card that still will not render says so — the path never ends in silence');
{
  // The old copy told the reader to go check the filters. Now it clears them,
  // so that instruction would be stale advice about work already done.
  const notShown = focus.slice(focus.indexOf("showNotify('Card not shown'"), focus.indexOf("showNotify('Card not shown'") + 300);
  ok(!/Organize filters/.test(notShown),
    'and it no longer tells the reader to check filters the code just cleared');
}

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
  // onCalClearFilters writes AND PERSISTS against whatever client is current.
  // Clearing without re-checking would erase a bystander client's saved filters.
  const clearGuard = focus.slice(focus.indexOf('if (!clearedFilters'), focus.indexOf('if (!clearedFilters') + 200);
  ok(/focusClientStillActive\(\)/.test(clearGuard),
    'and the clear itself re-checks the client, because it persists to that client\'s prefs');
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
