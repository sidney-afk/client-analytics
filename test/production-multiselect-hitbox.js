'use strict';
/*
 * The Production multi-select checkbox: a real click target, and shift-click
 * that range-selects.
 *
 * OWNER REPORT 2026-08-20: "make the hitbox for the multi-select thing bigger,
 * so I don't enter an issue without wanting to. Also, shift-click should select
 * all of them, like if I click one and then go scroll to the bottom and
 * shift-click, it should select all of them between those."
 *
 * TWO DEFECTS, BOTH REPRODUCED BELOW.
 *
 * 1. THE TARGET WAS 14px IN A 44px ROW. That leaves ~15px of dead zone above
 *    and below the box, and a miss is NOT harmless -- it lands on the row,
 *    whose handler opens the deliverable. The cost of missing a checkbox was
 *    a full-screen context switch.
 *
 * 2. SHIFT-CLICK WORKED ON THE ROW BUT NOT ON THE CHECKBOX. _prodRowClick has
 *    handled shift since it was written, but the checkbox's inline onclick
 *    called _prodToggleRowSelection(id) with no event, so the shift key was
 *    discarded before the function could see it. One gesture, two behaviours --
 *    and the affordance that LOOKS like the selection control was the one that
 *    did not do it.
 *
 * The hit-area assertions are structural because CSS geometry cannot execute
 * here; the shift-click assertions EXECUTE the real extracted function, per the
 * index.html:30560 convention -- a source-grep would have passed against the
 * broken version too, since the call string was present the whole time.
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

// ---------------------------------------------------------------------------
// 1. THE CLICK TARGET
// ---------------------------------------------------------------------------
const rowCss = /\.prod-check \{[^}]*\}/.exec(source);
ok(rowCss && /position:\s*relative/.test(rowCss[0]),
  'the row checkbox establishes a containing block for its hit pad');
ok(/\.prod-check::before \{[^}]*position:\s*absolute[^}]*\}/.test(source),
  'the hit pad is absolute, so it can never become a grid item and move the drawn box');
const pad = /\.prod-check::before \{([^}]*)\}/.exec(source);
ok(pad && /top:\s*-\d+px/.test(pad[1]) && /bottom:\s*-\d+px/.test(pad[1])
  && /left:\s*-\d+px/.test(pad[1]) && /right:\s*-\d+px/.test(pad[1]),
'the pad extends on all four sides, not just one');
ok(/\.prod-row \.prod-check::before \{[^}]*top:\s*-15px[^}]*bottom:\s*-15px[^}]*\}/.test(source),
  'inside a 44px row the pad covers the full row height (14 + 15 + 15 = 44)');
// The drawn box must not change size -- this is a hit-area fix, not a redesign.
ok(rowCss && /width:\s*14px/.test(rowCss[0]) && /height:\s*14px/.test(rowCss[0]),
  'the DRAWN checkbox is still 14px -- only the target grew');
/* The row pad is clipped by the row's own paint containment, which is what
   stops it reaching a neighbouring row. If that containment is ever removed,
   -15px starts stealing clicks from the row above and below. */
ok(/\.prod-row \{[^}]*contain:\s*content[^}]*\}/.test(source),
  'the row still carries `contain: content`, which clips the pad to its own row');
/* The subrow has NO containment, so its pad must be self-limiting instead. */
const subrow = /\.prod-subrow \{([^}]*)\}/.exec(source);
ok(subrow && !/contain:/.test(subrow[1]) && pad && /top:\s*-10px/.test(pad[1]),
  'the subrow default pad is sized to a subrow (14 + 10 + 10 = 34px), since nothing clips it');
/* The board card also has no containment; its pad must stay inside the card's
   own 11px/13px padding so it cannot swallow the title or the card edge. */
const cardPad = /\.prod-card-check::before \{([^}]*)\}/.exec(source);
ok(cardPad, 'the board card checkbox has a hit pad too');
const cardNums = (cardPad ? cardPad[1].match(/-(\d+)px/g) || [] : []).map(v => Number(v.replace(/[^0-9]/g, '')));
ok(cardNums.length === 4 && Math.max(...cardNums) <= 11,
  'the card pad stays within the card padding (<=11px) rather than overflowing it');

// ---------------------------------------------------------------------------
// 2. SHIFT-CLICK RANGE SELECT -- executed, not grepped
// ---------------------------------------------------------------------------
const ORDER = ['a', 'b', 'c', 'd', 'e'];
const sandbox = {
  _prodState: { selected: new Set(), selAnchor: '', focusRow: '', hoverRow: '' },
  _prodIssue: id => (ORDER.includes(id) ? { id } : null),
  _prodFlatOrder: () => ORDER.slice(),
  _prodRender: () => { sandbox.renders++; },
  renders: 0,
};
vm.createContext(sandbox);
vm.runInContext(
  `${extractFn('_prodRangeSelectRow')}\n${extractFn('_prodToggleRowSelection')}\n`
  + 'this.toggle = _prodToggleRowSelection; this.range = _prodRangeSelectRow;',
  sandbox,
);
const toggle = sandbox.toggle;
ok(typeof toggle === 'function', 'the real toggler extracts and executes (harness is not vacuous)');
const sel = () => Array.from(sandbox._prodState.selected).sort().join(',');
const reset = () => { sandbox._prodState.selected = new Set(); sandbox._prodState.selAnchor = ''; };

// THE RULING: click one, shift-click a far one, get everything between.
reset();
toggle('b', false, { shiftKey: false });
ok(sel() === 'b' && sandbox._prodState.selAnchor === 'b', 'a plain checkbox click selects one row and anchors it');
toggle('e', false, { shiftKey: true });
ok(sel() === 'b,c,d,e', 'shift-clicking a later checkbox selects the whole range between them');

// Upward works identically -- the anchor is a point, not a floor.
reset();
toggle('d', false, {});
toggle('b', false, { shiftKey: true });
ok(sel() === 'b,c,d', 'the range also works when the second click is ABOVE the anchor');

// A plain click still toggles OFF; shift must not have replaced toggling.
reset();
toggle('c', false, {});
toggle('c', false, {});
ok(sel() === '', 'a second plain click on the same checkbox deselects it');

// Shift with nothing anchored degrades to a single selection, never a throw
// and never "select everything".
reset();
toggle('c', false, { shiftKey: true });
ok(sel() === 'c', 'shift-click with no anchor selects just that row rather than the whole list');

// An unknown id is refused before it can touch state.
reset();
toggle('zzz', false, { shiftKey: true });
ok(sel() === '', 'an id that is not a live issue changes no selection');

// Called with no event at all (the keyboard path, `x`) must still toggle.
reset();
toggle('a', true);
ok(sel() === 'a', 'the keyboard path still works when no event is passed');
ok(sandbox._prodState.focusRow === '' && sandbox._prodState.hoverRow === '',
  'keepFocus=true leaves focus untouched rather than clearing it');

// Every checkbox in the markup must actually forward the event, or the logic
// above is unreachable from the UI -- the exact shape of the original bug.
const forwarding = (source.match(/_prodToggleRowSelection\(' \+ _jsAttrArg\([a-z]\.id\) \+ ', false, event\)/g) || []).length;
ok(forwarding === 3, 'all three row/subrow checkboxes forward the click event (found ' + forwarding + ')');
ok(!/_prodToggleRowSelection\(' \+ _jsAttrArg\([a-z]\.id\) \+ '\)/.test(source),
  'no checkbox still calls the toggler without an event');
ok(/_prodToggleCardSelection\(' \+ _jsAttrArg\(id\) \+ ', !!event\.shiftKey\)/.test(source),
  'the board card checkbox forwards the shift key too, instead of hard-coding false');

if (failures) {
  console.error(`\n${failures} production multi-select check(s) failed.`);
  process.exit(1);
}
console.log('\nProduction multi-select checks passed.');
