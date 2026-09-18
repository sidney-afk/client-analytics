'use strict';
/*
 * THE UNIT-LANE HALF of the row-cell overflow fixes.
 *
 * The measurement lives in `test/prod-client-chip-name-width.js`: it renders
 * the real extracted stylesheet in Chromium around a synthetic 24-character
 * client name and asserts the chip stays inside its row, and it was confirmed
 * to fail without the fix by 65px. That file needs a browser, so it is
 * classified `isolated_browser` and is NOT run by the unit lane or by CI.
 *
 * Which would leave the fix with no automatic guard at all. The layout suite
 * only catches a regression here when a long client name happens to exist in
 * live data -- and the whole reason this defect survived so long is that, for
 * months, none did.
 *
 * So this file pins the two declarations, in the lane that actually runs. It is
 * a source check and it is worth exactly what a source check is worth: it
 * proves the rules are present, not that they work. The proof that they work is
 * the other file. Neither is a substitute for the other, and saying so here is
 * cheaper than someone later reading a green unit lane as the stronger claim.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'index.html'), 'utf8');

/* `.prod-id` holds a 9-character Linear identifier on a provider card and the
   raw 40-character deliverable id on a native one, which has no identifier
   yet. Hyphenated, so without nowrap it wraps and the cell grows taller than
   the 44px row. This is the pair that stops that. */
assert.match(
  source,
  /\.prod-id\s*\{[^}]*white-space:\s*nowrap[^}]*\}/,
  '.prod-id must not wrap, or a hyphenated 40-character id grows the cell taller than its row',
);
assert.match(
  source,
  /\.prod-id\s*\{[^}]*text-overflow:\s*ellipsis[^}]*\}/,
  '.prod-id needs an ellipsis, or the truncation is a hard cut with no sign it happened',
);
/* The truncated value has to stay recoverable. */
assert.match(
  source,
  /function _prodIssueIdHTML\([\s\S]{0,400}_prodTitleAttrs\(label\)/,
  'the identifier cell must carry the full label on its hover, as the title cell does',
);
assert.doesNotMatch(
  source,
  /'<span class="prod-id">'/,
  'every identifier render site must go through _prodIssueIdHTML, not build the span inline',
);

/* `.prod-chip` sets `flex: none`, which is `flex: 0 0 auto` -- the chip cannot
   shrink and hangs outside any row too narrow for it. This override is what
   lets it yield. */
assert.match(
  source,
  /\.prod-chip-client\s*\{[^}]*flex-shrink:\s*1[^}]*\}/,
  '.prod-chip-client must override the flex: none it inherits from .prod-chip',
);
assert.match(
  source,
  /\.prod-chip-client\s*\{[^}]*min-width:\s*0[^}]*\}/,
  '.prod-chip-client needs min-width: 0, or a flex item refuses to shrink below its content',
);
/* The ellipsis on `.prod-chip` never fires: the label is in a nested span that
   the chip's own overflow only clips. This is the rule that ellipsizes it. */
assert.match(
  source,
  /\.prod-chip-client\s*>\s*span:last-child\s*\{[^}]*text-overflow:\s*ellipsis[^}]*\}/,
  'the client-chip label span must ellipsize rather than be clipped',
);

/* Every other chip keeps `flex: none` deliberately -- this fix is scoped to the
   one chip whose content is a name of unbounded length. */
assert.match(
  source,
  /\.prod-chip\s*\{[^}]*flex:\s*none[^}]*\}/,
  '.prod-chip itself still sets flex: none, so the override above stays scoped',
);

console.log('ok row-cell overflow rules are present (measurement: test/prod-row-cell-overflow.js)');
