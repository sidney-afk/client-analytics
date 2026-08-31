'use strict';
/*
 * A locked status pill told the SMM to do something the flip had deleted.
 *
 * Sweep items 87.8 and 87.16, one defect on two surfaces (calendar and
 * samples), found 2026-08-31.
 *
 * A component with no Linear sub-issue AND no native deliverable gets a greyed,
 * disabled pill carrying `title="Link a Linear sub-issue first"`. Post-flip
 * there is no control anywhere that satisfies that instruction:
 *
 *   - `_calLinearSlotHtml` returns the EMPTY STRING for an empty sealed slot,
 *     and its own comment says the warning it replaced "was actively asking
 *     people to create the defect";
 *   - `_calProdSlotHtml` returns '' with no deliverable id;
 *   - Production creation is closed for everyone (PROD_CREATE_CLOSED_TEXT);
 *   - `_calOpenNativePost` is reachable only from the two Add-card paths.
 *
 * So the reader who takes the instruction goes looking for a control that does
 * not exist on any surface, and the search cannot end. CSS gives the disabled
 * trigger `cursor: not-allowed` without `pointer-events: none`, so the tooltip
 * genuinely does surface on hover -- it is on screen, not theoretical.
 *
 * MEASURED, cards not archived: 66 have a fully unlinked video component and 36
 * a fully unlinked graphic (~100 pills), plus the samples equivalents.
 *
 * THE LOCK IS CORRECT AND STAYS. `_calCompLinked` is load-bearing for the N/A
 * display rule and the client view; only the sentence was stale.
 *
 * IT NAMES NO REMEDY, ON PURPOSE, and that is the part a later reader will want
 * to "improve". There is no in-app way to give an existing card a work item
 * post-flip, so any remedy this sentence named would be invented. What it DOES
 * say is that one cannot be created from this screen -- a fact, and the half
 * that stops the hunting. Which escalation to name is the owner's call
 * (OPEN_REPAIRS 87.8/87.16), exactly as for native_link_required in 87.14.
 */
const fs = require('fs');
const path = require('path');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* ---- 1. The sentence ----------------------------------------------------- */

const text = (INDEX.match(/const WRITE_UI_NO_WORK_ITEM_TEXT = '([^']+)';/) || [])[1] || '';

ok(!!text, 'the replacement text exists as a single shared constant');
ok(/no work item behind it/.test(text),
  'it says what is actually wrong: there is nothing behind the component');
ok(/status cannot be changed here/.test(text),
  '...and what that means for the control the reader just tried to press');
ok(/cannot be created from this screen/.test(text),
  '...and that one cannot be made here either, which is the half that stops the hunting');
ok(!/Link a Linear/.test(text) && !/[Ll]ink .* first/.test(text),
  'and it no longer instructs the reader toward a control the flip deleted');
ok(!/[Rr]eload/.test(text),
  'nor toward a reload, which is the same defect one surface over (87.14)');

/* ---- 2. Both surfaces read the SAME constant ----------------------------- */
/* The string lived inline on two surfaces and the pill label is recomputed by
   two separate in-place updaters, so copy changed in one place drifts. That is
   how these two ended up filed as separate findings in the first place. */

const uses = INDEX.match(/_calEscAttr\(WRITE_UI_NO_WORK_ITEM_TEXT\)/g) || [];
ok(uses.length === 2,
  'both the calendar and the samples pill render it (' + uses.length + ' sites), from one constant rather than two literals');
ok(!/disabled title="Link a Linear sub-issue first"/.test(INDEX),
  'and no inline copy of the retired sentence survives on either surface');
ok(/_calStatusToggleMenu[\s\S]{0,200}WRITE_UI_NO_WORK_ITEM_TEXT/.test(INDEX)
  && /_sxrStatusToggleMenu[\s\S]{0,200}WRITE_UI_NO_WORK_ITEM_TEXT/.test(INDEX),
  'specifically the calendar trigger and the samples trigger, which are the two that carried it');

/* ---- 3. The lock itself is untouched ------------------------------------- */
/* THE LOAD-BEARING NEGATIVE. The tempting "fix" is to unlock the pill so the
   sentence stops being needed. _calCompLinked drives the N/A display rule and
   the client view; unlocking would put a live status menu on a component with
   nothing behind it, which is the defect the lock exists to prevent. */

ok(/const lock = \(c !== 'caption' && c !== 'title' && !_calCompLinked\(p, c\)\) \? ' is-locked' : '';/.test(INDEX),
  'the lock predicate is unchanged -- the sentence was stale, the lock never was');
ok(/\$\{lock \? ` disabled title=/.test(INDEX),
  'and a locked pill is still genuinely disabled, not merely labelled');

/* ---- 4. The comments stopped re-seeding the retired claim ---------------- */
/* The finding was explicit that leaving these would re-seed it: both described
   the old tooltip as the thing that made the surface honest. They quote it now
   as history, which is why this checks the CLAIM rather than the substring. */

/* Line-wrap tolerant. A comment reflowed by one word is not a regression, and
   a check that breaks on rewrapping trains the next person to stop editing
   comments rather than to keep them true. */
ok(/it named a control the flip removed and now says what is\s+true instead/.test(INDEX),
  'the client-view comment records that the tooltip was corrected, rather than still citing it as the fix');
ok(/sent hunting for a control that does not exist on any surface/.test(INDEX),
  'and the SMM-view comment says what was wrong with it, so the next reader does not restore it');
ok(/the lock\s+itself is unchanged -- it was always correct/.test(INDEX),
  '...while recording that the lock was never the problem');

console.log(failures === 0
  ? '\nLocked-pill dead-control checks passed'
  : '\n' + failures + ' locked-pill check(s) failed');
process.exit(failures === 0 ? 0 : 1);
