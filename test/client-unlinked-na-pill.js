'use strict';
/*
 * A component with no Linear sub-issue reads N/A in the client-facing pills.
 *
 * OWNER RULING 2026-08-20: "when a card doesn't have a thumbnail sub-issue link
 * or a video sub-issue link it appears grayed out [for the SMM], but from the
 * client point of view it appears as in progress... I wanted to make it so it
 * would just appear as N/A, because there's no sub-issue linked."
 *
 * The SMM card already tells this truth — _calCardHtml gives an unlinked
 * video/graphic pill `is-locked` and disables it with "Link a Linear sub-issue
 * first". That affordance is SMM-only, so the client was shown the bare
 * 'In Progress' default: work in flight where there is no work item at all.
 *
 * TWO RULINGS CONSTRAIN THIS AND BOTH ARE PINNED BELOW:
 *  - 2026-08-19: N/A is a MANUAL SMM choice; the system must never write it.
 *    So this is display-only — the stored status is untouched, which also
 *    keeps the reconcilers' N/A parking (which reads the STORED status)
 *    unaffected.
 *  - This function's own standing rule: Approved / Scheduled / Posted are
 *    ALWAYS shown to the client. An approval the client already holds must not
 *    vanish behind N/A, so a finished state is never rewritten.
 *
 * WHY THIS SUITE EXECUTES RATHER THAN GREPS. The first cut of this change
 * referenced a `CAL_STATUS_NA` constant that does not exist in index.html. It
 * was a live ReferenceError on every client card render, and a full 247-suite
 * run passed anyway, because nothing executed the function. index.html:30560
 * already carries the same warning for the sibling push guard ("Compared
 * inline, with no helper... a free identifier here breaks that harness"). A
 * source-grep pin would have shipped the bug; this one catches it.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function extractFn(name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error('missing function: ' + name);
  let depth = 0, seen = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') { depth++; seen = true; }
    else if (ch === '}') { depth--; if (seen && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error('unbalanced function: ' + name);
}

// The REAL bodies, lifted from index.html.
const pillsSrc = extractFn('_calClientCompPillsHtml');
const linkedSrc = extractFn('_calCompLinked');
const helperSrc = extractFn('_calPillDisplayStatus');

const sandbox = {
  _isClientLink: true,
  _calIsCollabOn: () => true,
  _CAL_CLIENT_READY_STATES: new Set(['Approved', 'Scheduled', 'Posted']),
  _calComponentsFor: () => ['video', 'graphic', 'caption'],
  _calNormStatus: v => String(v == null ? '' : v).trim(),
  _calStatusSlug: s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
  COMP_LABELS: { video: 'VIDEO', graphic: 'THUMBNAIL', caption: 'CAPTION' },
  _calCompStatusLabel: (p, c, cs) => cs,
  _calEsc: v => String(v),
  _calEscAttr: v => String(v),
};
vm.createContext(sandbox);
// Executing the real source is the point: an undefined free identifier (the
// bug this suite exists for) throws here instead of reaching a browser.
vm.runInContext(
  `${linkedSrc}\n${helperSrc}\n${pillsSrc}\n`
  + 'this._calCompLinked = _calCompLinked; this.render = _calClientCompPillsHtml;'
  + ' this.pillStatus = _calPillDisplayStatus;',
  sandbox,
);
const render = sandbox.render;
ok(typeof render === 'function', 'the real client pill renderer extracts and executes (harness is not vacuous)');

const linkedCard = {
  linear_issue_id: 'https://linear.app/x/issue/VID-1/a',
  graphic_linear_issue_id: 'https://linear.app/x/issue/GRA-1/b',
  video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
};
const unlinkedCard = {
  video_status: 'In Progress', graphic_status: 'In Progress', caption_status: 'In Progress',
};

// 1. THE RULING.
const out = render(unlinkedCard);
ok(/VIDEO: N\/A/.test(out), 'an unlinked VIDEO slot reads N/A to the client');
ok(/THUMBNAIL: N\/A/.test(out), 'an unlinked THUMBNAIL slot reads N/A to the client');
ok(/cal-fld-status-n-a/.test(out), 'the N/A pill carries the grey status class');

// 2. CAPTION IS NEVER AFFECTED — it has no sub-issue by design.
ok(/CAPTION: In Progress/.test(out) && !/CAPTION: N\/A/.test(out),
  'the caption pill is untouched — it has no Linear sub-issue by design');

// 3. A LINKED COMPONENT IS UNTOUCHED.
const linkedOut = render(linkedCard);
ok(/VIDEO: In Progress/.test(linkedOut) && /THUMBNAIL: In Progress/.test(linkedOut)
  && !/N\/A/.test(linkedOut),
'a linked component still shows its real status');

// 4. A FINISHED STATE IS NEVER HIDDEN — the standing client-visibility rule.
for (const finished of ['Approved', 'Scheduled', 'Posted']) {
  const o = render({ ...unlinkedCard, video_status: finished });
  ok(new RegExp('VIDEO: ' + finished).test(o) && !/VIDEO: N\/A/.test(o),
    `an unlinked but ${finished} component still shows ${finished}, never N/A`);
}

// 5. A MANUALLY-SET N/A on a LINKED component still reads N/A (the 2026-08-19
//    manual choice keeps working; this change neither creates nor erases it).
const manual = render({ ...linkedCard, graphic_status: 'N/A' });
ok(/THUMBNAIL: N\/A/.test(manual), "an SMM's manual N/A on a linked component is preserved");

// 6. NON-COLLABORATIVE MODE: unfinished pills stay hidden, N/A included.
sandbox._calIsCollabOn = () => false;
const hidden = render(unlinkedCard);
ok(hidden === '', 'with Collaborative mode off the client still sees no in-flight pills, N/A included');
const hiddenFinished = render({ ...unlinkedCard, video_status: 'Approved' });
ok(/VIDEO: Approved/.test(hiddenFinished) && !/THUMBNAIL/.test(hiddenFinished),
  'with Collaborative mode off a finished component is still shown and the rest stay hidden');
sandbox._calIsCollabOn = () => true;

// 7. DISPLAY ONLY — the renderer must not write. The stored status feeds the
//    reconcilers' N/A parking, and the owner ruled the system never writes N/A.
ok(!/_calSave|calendar-upsert|_calQueueSave|fetch\(/.test(pillsSrc),
  'the renderer performs no write — the stored status stays In Progress');
const probe = { ...unlinkedCard };
render(probe);
ok(probe.video_status === 'In Progress' && probe.graphic_status === 'In Progress',
  'rendering does not mutate the card object it was handed');

// 8. NO FREE IDENTIFIERS — the exact bug this suite was written for.
ok(!/CAL_STATUS_NA/.test(pillsSrc),
  'the renderer uses the inline N/A literal, not an undefined constant (index.html:30560 convention)');


// ---------------------------------------------------------------------------
// THE SMM VIEW USES THE SAME RULE (owner ruling 2026-08-20, extending it).
// A locked pill was greyed and disabled but still LABELLED "In Progress" —
// the same untrue claim the client used to get, only dimmer.
// ---------------------------------------------------------------------------
const pillStatus = sandbox.pillStatus;
ok(typeof pillStatus === 'function', 'the shared pill-display helper extracts and executes');
ok(pillStatus(unlinkedCard, 'video', 'In Progress') === 'N/A'
  && pillStatus(unlinkedCard, 'graphic', 'In Progress') === 'N/A',
'the SMM pill shows N/A for an unlinked video or graphic slot');
ok(pillStatus(linkedCard, 'video', 'In Progress') === 'In Progress',
  'a linked slot keeps its real status in the SMM view');
ok(pillStatus(unlinkedCard, 'caption', 'In Progress') === 'In Progress',
  'the caption pill is never substituted — it has no sub-issue by design');
for (const finished of ['Approved', 'Scheduled', 'Posted']) {
  ok(pillStatus(unlinkedCard, 'video', finished) === finished,
    `an unlinked but ${finished} slot keeps ${finished} in the SMM view too`);
}

// LOCKSTEP: the four render paths must all route through this one helper, or an
// in-place update silently reverts a pill the full render showed as N/A.
const calCard = source.slice(source.indexOf('const subStatusHtml = '), source.indexOf('const setAllHtml = '));
ok(/_calPillDisplayStatus\(p, c, cs\)/.test(calCard) && /_calStatusSlug\(shownStatus\)/.test(calCard)
  && /_calCompStatusLabel\(p, c, shownStatus\)/.test(calCard),
'the calendar SMM card renders class AND label from the helper');
ok(/data-val="\$\{_calEscAttr\(cs\)\}"/.test(calCard),
  'the calendar card keeps the STORED status in data-val, not the substitution');
const updaters = source.match(/_calPillDisplayStatus\(post, c, cs\)/g) || [];
ok(updaters.length === 2,
  'both in-place pill updaters (calendar and samples) call the helper');
/* Calling it is not enough — the RESULT has to reach both the class and the
   label. An updater that computed `shown` and then re-used `cs` would put
   "In Progress" back on a pill the full render had shown as N/A, which is
   exactly the drift this lockstep block exists to prevent. */
ok((source.match(/classList\.add\('cal-fld-status-' \+ _calStatusSlug\(shown\)\)/g) || []).length === 1
  && (source.match(/classList\.add\('cal-fld-status-' \+ _sxrStatusSlug\(shown\)\)/g) || []).length === 1,
'both updaters set the pill CLASS from the substituted status');
ok((source.match(/_calCompStatusLabel\(post, c, shown\)/g) || []).length === 1
  && (source.match(/_sxrStatusLabel\(shown\)/g) || []).length === 1,
'both in-place updaters set the pill LABEL from the substituted status');
ok((source.match(/_calCompStatusLabel\(p, c, shownStatus\)/g) || []).length === 1
  && (source.match(/_sxrStatusLabel\(shownStatus\)/g) || []).length === 1,
'both full card renders (calendar and samples) set the pill LABEL from the substituted status');
ok((source.match(/_calPillDisplayStatus/g) || []).length === 5,
  'exactly one definition and four call sites — no render path bypasses the rule');

if (failures) {
  console.error(`\n${failures} client unlinked-N/A check(s) failed.`);
  process.exit(1);
}
console.log('\nClient unlinked-N/A checks passed.');
