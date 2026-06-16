'use strict';
/*
 * `.kcard` thumbnails (Kasper review + client/SMM Review) must not BLINK / reflow
 * when a card repaints on approve / request-change / realtime echo — regression.
 *
 * Run:  node test/kcard-thumb-reuse.js   (exit 0 = all good)
 *
 * BUG. Kasper's _kasperRepaintCard / _kasperPaintReview and the Review surface's
 * _calReviewRepaintCard / _calRenderBody rebuilt the card DOM (replaceWith /
 * innerHTML), recreating the <img> — so the thumbnail vanished and the box
 * reflowed on every action, twice per action (optimistic + post-save, the latter
 * bumping updated_at -> a new _cb). The calendar STRIP already solved this with
 * _calHarvestThumbs/_calRestoreThumbs, but those target `.cal-card-thumb` only.
 *
 * FIX. _kcardHarvestThumbs / _kcardRestoreThumbs / _kcardReuseThumbInto reuse the
 * already-decoded <img> across the rebuild, keyed on _calThumbSrcBase (strips the
 * _cb=updated_at cache-buster, KEEPS _r=thumb_rev). So an updated_at bump on an
 * unchanged link reuses the decoded node (no blink) while a real link change
 * (new thumb_rev) still reloads. This harness proves the KEY function behaves and
 * that all four repaint paths route through the helpers.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function grabFunc(name) {
  const at = INDEX.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0;
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

const { _calThumbSrcBase } = new Function(grabFunc('_calThumbSrcBase') + ';return { _calThumbSrcBase };')();

let failures = 0;
function check(label, got, want) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FAIL'}  ${label}  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);
}

console.log('— _calThumbSrcBase: the reuse key (strip _cb, keep _r=thumb_rev) —');
const A = 'https://drive.google.com/thumbnail?id=ABC&_cb=2026-06-16T10:00:00.000Z&_r=k1';
const B = 'https://drive.google.com/thumbnail?id=ABC&_cb=2026-06-16T12:34:56.000Z&_r=k1'; // only _cb differs
const C = 'https://drive.google.com/thumbnail?id=ABC&_cb=2026-06-16T12:34:56.000Z&_r=k2'; // thumb_rev differs
check('an updated_at (_cb) bump alone keeps the SAME base → decoded <img> reused (no blink)',
  _calThumbSrcBase(A) === _calThumbSrcBase(B), true);
check('a thumb_rev (_r) change yields a DIFFERENT base → image reloads (real link change)',
  _calThumbSrcBase(A) === _calThumbSrcBase(C), false);
check('base still carries the _r token', /_r=k1/.test(_calThumbSrcBase(A)), true);
check('base drops the _cb token', /_cb=/.test(_calThumbSrcBase(A)), false);
check('leading-?_cb stays a valid query after stripping',
  _calThumbSrcBase('https://x/y?_cb=1&_r=z'), 'https://x/y?_r=z');

console.log('\n— Helpers exist and key on the cache-buster-agnostic base —');
for (const fn of ['_kcardHarvestThumbs', '_kcardRestoreThumbs', '_kcardReuseThumbInto']) {
  const src = grabFunc(fn);
  check(`${fn} keys on _calThumbSrcBase`, /_calThumbSrcBase\s*\(/.test(src), true);
}
const harvestSrc = grabFunc('_kcardHarvestThumbs');
check('_kcardHarvestThumbs only reuses a fully-decoded image',
  /naturalWidth\s*===?\s*0/.test(harvestSrc) || /naturalWidth\s*>\s*0/.test(harvestSrc), true);
const reuseSrc = grabFunc('_kcardReuseThumbInto');
check('_kcardReuseThumbInto bails when the link base changed',
  /!==\s*_calThumbSrcBase|_calThumbSrcBase[^=]*!==/.test(reuseSrc), true);

console.log('\n— All four repaint paths route through the reuse helpers —');
const kPaint = grabFunc('_kasperPaintReview');
check('_kasperPaintReview harvests + restores around its innerHTML rebuild',
  /_kcardHarvestThumbs\s*\(/.test(kPaint) && /_kcardRestoreThumbs\s*\(/.test(kPaint), true);
const kRepaint = grabFunc('_kasperRepaintCard');
check('_kasperRepaintCard reuses the decoded thumb before replaceWith',
  /_kcardReuseThumbInto\s*\(/.test(kRepaint), true);
const renderBody = grabFunc('_calRenderBody');
check('_calRenderBody review branch harvests + restores review thumbs',
  /_kcardHarvestThumbs\s*\(/.test(renderBody) && /_kcardRestoreThumbs\s*\(/.test(renderBody), true);
const revRepaint = grabFunc('_calReviewRepaintCard');
check('_calReviewRepaintCard reuses the decoded thumb before replaceWith',
  /_kcardReuseThumbInto\s*\(/.test(revRepaint), true);

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll kcard-thumb-reuse checks passed.');
