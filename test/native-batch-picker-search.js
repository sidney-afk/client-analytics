'use strict';
/*
 * THE BATCH YOU WANT MUST BE REACHABLE, AND YOU MUST BE ABLE TO FIND IT.
 *
 * Reported twice by the same SMM. First: "she can't see the linear that's
 * supposed to be added to" — that was a missing parent map, repaired. Then,
 * with the map repaired and the batch provably compatible, she STILL could not
 * see it, and the reason was a `.slice(0, 5)` on the compatible list.
 *
 * That cap was invisible when it was written — the median client had five
 * eligible batches. Measured 2026-08-26: 15 of 37 clients had batches hidden by
 * it and the worst hid 28. The batch she wanted ranked SIXTH. Nothing said "5
 * of 25"; the rest were simply gone, which is why two people looked at this
 * twice and concluded the data was wrong.
 *
 * Two properties are pinned here:
 *
 *   1. The compatible list is NOT truncated. A picker that silently drops most
 *      of its options is worse than a long list — it makes a present thing look
 *      absent, and absence is the one thing a user cannot debug.
 *   2. The filter matches how people actually name these. Every option begins
 *      with the same client name, so a <select>'s built-in prefix type-ahead is
 *      useless; what a person types is the middle ("episode 09").
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

// ---- 1. the cap is gone, and cannot come back unnoticed --------------------
/* Anchored on the builder's own closing `return { ... };`, not on whatever
   function happens to follow it. An end anchor that does not exist yields an
   EMPTY slice, and every "this text is absent" assertion below would then pass
   for the wrong reason — which is exactly how the first draft of this file
   reported the cap as removed before it had been. */
const listsStart = html.indexOf('function _calNativeBatchLists(');
const listsEnd = html.indexOf('incompatible: ranked.filter(', listsStart);
const lists = listsStart >= 0 && listsEnd > listsStart
  ? html.slice(listsStart, html.indexOf('\n', listsEnd) + 1)
  : '';
ok(lists.includes('compatible:') && lists.includes('incompatible:'),
  'the list builder is findable and BOTH lists are inside the slice (harness is not vacuous)');
const compatibleLine = (lists.match(/compatible:[^\n]*/) || [])[0] || '';
ok(!/\.slice\(/.test(compatibleLine),
  'the COMPATIBLE list is not truncated — a hidden option is indistinguishable from a missing batch'
    + (/\.slice\(/.test(compatibleLine) ? ' (' + compatibleLine.trim() + ')' : ''));
const incompatibleLine = (lists.match(/incompatible:[^\n]*/) || [])[0] || '';
ok(/\.slice\(0, 3\)/.test(incompatibleLine),
  'while the INCOMPATIBLE list stays capped — it is advisory, never chosen from');

// ---- 2. the matcher, EXECUTED rather than pattern-matched ------------------
const matcherSrc = html.slice(
  html.indexOf('function _calNativeBatchMatches('),
  html.indexOf('function _calNativeBatchFilter('),
);
ok(!!matcherSrc, 'the matcher is findable');
const displayName = batch => String((batch && batch.name) || '');
const matches = new Function('_calNativeBatchDisplayName',
  'return (' + matcherSrc.replace('function _calNativeBatchMatches(', 'function (') + ')')(displayName);

const EP09 = { name: 'JENNA PB | Episode 09' };
const EP05 = { name: 'JENNA PB | Episode 05' };
const DATED = { name: 'Jenna Phillips Ballard · 24 Aug 2026' };

ok(matches(EP09, '') === true, 'an empty query keeps every batch — the filter never hides by default');
ok(matches(EP09, '   ') === true, 'and neither does whitespace');
ok(matches(EP09, 'episode 09') === true, 'the exact thing she would type finds it');
ok(matches(EP09, '09') === true, 'a bare number finds it — this is the MIDDLE of the name, which prefix type-ahead cannot reach');
ok(matches(EP09, 'EPISODE') === true && matches(EP09, 'jenna') === true,
  'matching is case-insensitive in both directions');
ok(matches(EP09, 'ep 09') === true, 'terms may be partial and in any order ("ep 09")');
ok(matches(EP09, '09 episode') === true, 'and order does not matter ("09 episode")');
ok(matches(EP05, 'episode 09') === false, 'a sibling episode is excluded — every term must match, not just one');
ok(matches(DATED, 'episode') === false, 'and a dated batch is not dragged in by the client name alone');
ok(matches(EP09, 'jenna 09') === true, 'terms may span the client name and the episode number');
ok(matches({ name: '' }, 'x') === false, 'a nameless batch matches nothing rather than everything');

// ---- 3. the wiring the filter depends on ----------------------------------
ok(/oninput="_calNativeBatchFilter\(this\)"/.test(html),
  'the search input is wired to the filter on every keystroke');
ok(/type="search"/.test(html) && /aria-label="Search batches by name"/.test(html),
  'it is a labelled search input, not an unlabelled text box');
ok(/CAL_NATIVE_BATCH_FILTER_MIN/.test(html) && /compatible\.length > CAL_NATIVE_BATCH_FILTER_MIN/.test(html),
  'and it only appears once the list is long enough to need it');
/* Rebuilding beats hiding: Safari ignores display:none on an <option>, so a
   hide-based filter would look correct in Chrome and do nothing on a Mac —
   the same shape as the cap this replaces. */
ok(/select\.innerHTML = _calNativeBatchOptionsHtml\(/.test(html),
  'filtering REBUILDS the options rather than hiding <option> elements, which Safari ignores');
ok(/if \(shown\.length\) _calNativePrevBatchPick\(select, false\)/.test(html),
  'and the radio follows the filtered selection, so a post cannot append to a batch nobody can see');
ok(/const isLatest = !!all\.length && String\(all\[0\]\.id \|\| ''\) === String\(batch\.id \|\| ''\)/.test(html),
  '"last batch" marks the newest of ALL batches, so filtering cannot relabel an old one as the latest');

if (failures) {
  console.error(`\n${failures} batch-picker search check(s) failed`);
  process.exit(1);
}
console.log('\nbatch picker search checks passed');
