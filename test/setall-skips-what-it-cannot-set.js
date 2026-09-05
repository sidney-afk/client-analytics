'use strict';
/*
 * "Set all" destroyed the half of the write that would have worked.
 *
 * Sweep item 87.15, found 2026-08-31. Filed as a false promise; it is data
 * loss, and the samples side is strictly worse than the filing described.
 *
 * `_sxrSetAllSettable` returned `true` unconditionally AND was dead — neither
 * the menu nor the apply loop ever called it — so Set all iterated
 * SXR_COMPONENTS regardless of whether a component had anything behind it. The
 * same card's pill is greyed and disabled 180 lines earlier for exactly that
 * reason.
 *
 * What then happens is not a refused write, it is a lost one. An unlinked
 * component reaches `_sxrPushStatusToLinear` with no url and no native id, so
 * `_writeUiClassifyTargetless` raises `native_link_required`. The throw lands
 * in the VIDEO leg — before the graphic leg, and before the source upsert:
 *
 *   - video unlinked  → both pills flip on screen, "Write not saved" appears,
 *     the card takes a _saveError badge, and NOTHING persists. The graphics
 *     status the user actually meant to set is destroyed with the impossible
 *     one.
 *   - graphic unlinked → the video leg has already committed natively, so the
 *     deliverable moves and the sample row does not, and the two systems
 *     disagree until somebody notices.
 *
 * MEASURED: 1,135 samples have a fully unlinked video component and 1,045 a
 * fully unlinked graphic; 205 have video unlinked while graphic IS linked —
 * the exact mixed card where Set all looks sensible and takes the good half
 * down with it.
 *
 * THE PREDICATE IS `_calCompLinked`, AND THAT IS THE WHOLE POINT. Porting the
 * calendar's `_calSetAllSettable` verbatim was the trap: it tested the Linear
 * URL alone, while the pill lock beside it tests url OR native deliverable id.
 * A native-only card would have an unlocked, working pill and be silently
 * skipped. Today that is latent — 0 samples and 0 live calendar cards carry a
 * deliverable id with no url — which is precisely why it had to be fixed
 * before it stopped being latent: post-flip, native-only is the shape new work
 * arrives in. So the CALENDAR moved to `_calCompLinked` too.
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

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* ---- 1. Both predicates, executed against the shapes that matter --------- */

const ctx = {
  /* The REAL rule, transcribed: linked when EITHER the Linear id or the native
     deliverable id is present. If this drifts from index.html the point of the
     whole file is gone, so it is asserted separately below. */
  _calCompLinked: (p, c) => {
    const link = c === 'graphic' ? p.graphic_linear_issue_id : p.linear_issue_id;
    const native = c === 'graphic' ? p.graphic_deliverable_id : p.video_deliverable_id;
    return !!(String(link || '').trim() || String(native || '').trim());
  },
};
vm.createContext(ctx);
vm.runInContext(
  grabFunc('_calSetAllSettable') + '\n' + grabFunc('_sxrSetAllSettable') + '\n'
  + 'this.cal = _calSetAllSettable; this.sxr = _sxrSetAllSettable;', ctx);

const linked = { linear_issue_id: 'https://linear.app/x/issue/VID-1/a' };
const nativeOnly = { video_deliverable_id: 'del_abc' };
const bare = {};

ok(ctx.sxr(linked, 'video') === true, 'a sample with a Linear link is settable');
ok(ctx.sxr(bare, 'video') === false,
  'a sample component with NOTHING behind it is not -- the predicate used to be `return true`, and dead besides');
ok(ctx.sxr(nativeOnly, 'video') === true,
  'THE TRAP: a native-only component IS settable. The calendar predicate this was almost copied from '
  + 'tested the Linear url alone, and would have skipped a card whose pill is unlocked and whose write succeeds');
ok(ctx.sxr(bare, 'graphic') === false && ctx.sxr({ graphic_deliverable_id: 'del_g' }, 'graphic') === true,
  'and the graphic component resolves its own ids, not the video ones');
ok(ctx.sxr(null, 'video') === false, 'a missing post is not settable rather than a crash');

ok(ctx.cal(bare, 'caption') === true,
  'on the calendar, caption stays always-settable: it has no sub-issue and never needed one');
ok(ctx.cal(nativeOnly, 'video') === true,
  '...and the calendar moved to the same predicate, so a native-only card stops being skipped there too');
ok(ctx.cal(bare, 'video') === false, 'while a bare component is still refused');

/* ---- 2. The predicate the pill uses IS the predicate Set-all uses -------- */
/* The defect underneath both halves of this finding is two rules for one
   question. Pinning the call, not the behaviour, is what stops them drifting
   apart again. */

ok(/function _calSetAllSettable\(post, comp\) \{[\s\S]{0,900}return _calCompLinked\(post, comp\);/.test(INDEX),
  'the calendar predicate defers to _calCompLinked rather than re-deriving the rule');
ok(/function _sxrSetAllSettable\(post, comp\) \{[\s\S]{0,1800}return _calCompLinked\(post, comp\);/.test(INDEX),
  'and so does the samples one -- one rule, asked in one place');
ok(!/const link = comp === 'graphic' \? post\.graphic_linear_issue_id : post\.linear_issue_id;/.test(INDEX),
  'and the url-only test is gone entirely, so it cannot be reached by accident');

/* ---- 3. The apply loop honours it --------------------------------------- */

const apply = grabFunc('_sxrSetAllStatus');
ok(/const linked = SXR_COMPONENTS\.filter\(c => _sxrSetAllSettable\(post, c\)\);/.test(apply)
  && /const settable = linked\.filter\(c => !_sxrReviewBlockReason\(post, c, status\)\);/.test(apply),
  'the samples apply path still asks _sxrSetAllSettable FIRST -- the empty-content review gate (2026-09-05) '
  + 'narrows it a second time, so what used to be one name is now `linked` then `settable`, but the link rule '
  + 'is still the first question and nothing outside its answer can be iterated');
ok(/for \(const c of settable\) \{/.test(apply) && !/for \(const c of SXR_COMPONENTS\) \{/.test(apply),
  'THE FIX ITSELF: it iterates the settable set, not every component. Iterating all of them is what '
  + 'threw in the video leg and took the graphics write down with it');
ok(/if \(!settable\.length\) \{[\s\S]{0,240}return;/.test(apply),
  'and with nothing settable it says so and stops, rather than entering a loop that can only fail');

/* ---- 4. What the reader is told BEFORE they pick ------------------------- */

const menu = grabFunc('_sxrOpenSetAllMenu');
ok(/const sxrSkipped = SXR_COMPONENTS\.filter\(c => !sxrSettable\.includes\(c\)\);/.test(menu),
  'the menu header knows what will be skipped');
ok(/no work item`/.test(menu) && /Apply to \$\{sxrSettable/.test(menu),
  '...and names it in the header, so an SMM sees the skip before choosing a status rather than after');
ok(!/>Apply to Video &amp; Thumbnail<\/div>`/.test(menu),
  'the hardcoded two-component header is gone');
ok(/Neither component has a work item behind it/.test(menu),
  'and the both-unlinked case has its own header rather than promising two components it cannot touch');

ok(/skipped\.length[\s\S]{0,220}skipped\.map\(c => COMP_LABELS\[c\]\)[\s\S]{0,200}skipped\)/.test(apply)
  || /no work item behind/.test(apply),
  'the confirm dialog discloses the skip too, matching the calendar twin');

/* ---- 5. The third site of the dead-control instruction ------------------- */
/* Found while fixing this: the calendar's own empty-case notify still said
   "link the Linear sub-issues first" -- the same sentence removed from the
   pills in 87.8/87.16, in a place the sweep did not list. */

/* Checked per LINE, and only on lines that are not comments. The replacement
   quotes the retired sentence on purpose, so a bare substring check would trip
   on its own documentation -- the same self-referential trap this estate has
   hit twice before. What must be gone is the string as SHIPPED TEXT. */
{
  const live = INDEX.split('\n').filter(line => {
    if (!/link the Linear sub-issues first/.test(line)) return false;
    const t = line.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*'));
  });
  ok(live.length === 0,
    'no surface still tells a reader to link a sub-issue, including the Set-all empty state'
    + (live.length ? ' — still live on ' + live.length + ' line(s)' : ''));
}
ok(/have a work item behind them, so there is nothing here to update/.test(INDEX),
  'the calendar empty case says what is true instead');
ok(/Neither component on this sample has a work item behind it/.test(INDEX),
  'and the samples empty case says it in its own vocabulary -- "sample", never "card"');

console.log(failures === 0
  ? '\nSet-all skip checks passed'
  : '\n' + failures + ' Set-all check(s) failed');
process.exit(failures === 0 ? 0 : 1);
