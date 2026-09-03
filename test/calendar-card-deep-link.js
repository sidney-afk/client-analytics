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

const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// --- the focus path -------------------------------------------------------
const focus = SRC.slice(SRC.indexOf('function _calApplyFocusRequest'),
  SRC.indexOf('function _calApplyFocusRequest') + 6000);

ok(/let clearedFilters = false;/.test(focus),
  'the focus path can clear the filters that hid the card');
ok(/if \(!clearedFilters && typeof _calOrganizeIsActive === 'function' && _calOrganizeIsActive\(\)\)/.test(focus),
  'it only clears when filters are actually active — a default view is never disturbed');
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
