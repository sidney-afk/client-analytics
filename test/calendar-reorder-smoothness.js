'use strict';
/*
 * Calendar reorder smoothness + thumbnail-reload regression harness.
 *
 * Run:  node test/calendar-reorder-smoothness.js   (exit 0 = all good)
 *
 * Covers the three front-end fixes for the "reordering is messy / the
 * thumbnail reloads on every save / the header Saving badge shifts the
 * toolbar" report:
 *
 *  1. THUMBNAIL: _calThumbSrcBase (extracted verbatim) strips the per-save _cb
 *     (updated_at) token so two srcs differing only by _cb compare EQUAL — a save
 *     that bumps updated_at no longer re-decodes the <img>. It KEEPS the _r rev
 *     (bumped only on a real link write) so a link change compares DIFFERENT and
 *     the strip reloads the picture automatically, with no hard refresh.
 *
 *  2. REORDER GUARD: _calRecordReorderOptimistic (extracted verbatim) + a
 *     faithful copy of the loadCalendarPosts merge-pin and the error-clear must
 *     pin a just-applied drag's order_index over a reload that raced the write,
 *     expire after the window, and let a superseding drag win.
 *
 *  3. WIRING: assert the shipped index.html still carries the fixes (echo
 *     suppression in persistCalReorder, the merge pin, the link-gated thumb
 *     refresh) and does NOT re-introduce the toolbar-shifting header badge.
 */
const fs = require('fs');
const path = require('path');
const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(cond, label) { if (cond) { pass++; console.log('  ✅ ' + label); } else { fail++; console.log('  ❌ ' + label); } }

// Brace-balanced extraction of a top-level function (robust to line shifts).
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

// ---- Real code extracted verbatim from index.html ----
// Compile each extracted function in global scope (new Function), so the
// brace-balanced source from index.html is exercised as-is. _calReorderOptimistic
// is the guard map the extracted _calRecordReorderOptimistic mutates (free var
// → resolves to globalThis at call time), so it lives on globalThis and is
// aliased to a local const (same Map reference) for the assertions below.
function loadFn(name) { return new Function('return (' + grabFunc(name) + ')')(); }
globalThis._calReorderOptimistic = new Map();
const _calReorderOptimistic = globalThis._calReorderOptimistic;
const CAL_REORDER_GUARD_MS = 12000;
const _calThumbSrcBase = loadFn('_calThumbSrcBase');
const _calRecordReorderOptimistic = loadFn('_calRecordReorderOptimistic');

console.log('\n============================================================');
console.log('1) THUMBNAIL: cache-buster-agnostic src comparison');
console.log('============================================================');
const driveBase = 'https://drive.google.com/thumbnail?id=ABC&sz=w320';
ok(_calThumbSrcBase(driveBase + '&_cb=2026-06-15T14%3A00%3A00Z') === driveBase,
   'strips a trailing &_cb token (Drive thumb)');
ok(_calThumbSrcBase(driveBase + '&_cb=A') === _calThumbSrcBase(driveBase + '&_cb=B'),
   'two srcs differing only by _cb compare EQUAL (no per-save reload)');
const imgBase = 'https://cdn.example.com/a.jpg';
ok(_calThumbSrcBase(imgBase + '?_cb=2026-01-01') === imgBase,
   'strips a leading ?_cb token (direct image)');
ok(_calThumbSrcBase(imgBase + '?_cb=X&_r=12345') === imgBase + '?_r=12345',
   'strips _cb but KEEPS the _r rev (normalizing the now-leading separator)');
ok(_calThumbSrcBase(driveBase + '&_cb=A&_r=1') !== _calThumbSrcBase(driveBase + '&_cb=A&_r=2'),
   'two srcs differing by _r (a real link write) compare DIFFERENT → reloads');
ok(_calThumbSrcBase(driveBase + '&_cb=A&_r=7') === _calThumbSrcBase(driveBase + '&_cb=B&_r=7'),
   'same _r, differing _cb still compare EQUAL → no per-save reload');
ok(_calThumbSrcBase(driveBase) === driveBase,
   'leaves a URL without cache-busters untouched (real link changes still differ)');
ok(_calThumbSrcBase('https://drive.google.com/thumbnail?id=ABC&_cb=1') !==
   _calThumbSrcBase('https://drive.google.com/thumbnail?id=XYZ&_cb=1'),
   'a genuine link change (id ABC→XYZ) still compares DIFFERENT → reloads');

console.log('\n============================================================');
console.log('2) REORDER GUARD: pin optimistic order over a racing reload');
console.log('============================================================');
// Faithful copy of the loadCalendarPosts merge-pin block (kept in lockstep with
// index.html; the WIRING section below asserts the real file still has it).
function mergePin(fp, nowMs) {
  const winner = Object.assign({}, fp); // server row adopted by LWW
  const _ro = _calReorderOptimistic.get(fp.id);
  if (_ro) {
    if ((nowMs - _ro.at) < CAL_REORDER_GUARD_MS) winner.order_index = _ro.order_index;
    else _calReorderOptimistic.delete(fp.id);
  }
  return winner;
}
// Faithful copy of the persistCalReorder catch-block guard clear.
function errorClear(items) {
  items.forEach(({ id, order_index }) => {
    const ro = _calReorderOptimistic.get(id);
    if (ro && ro.order_index === Number(order_index)) _calReorderOptimistic.delete(id);
  });
}

_calReorderOptimistic.clear();
// A drag moves card "c1" to order 5; the reload still returns the PRE-drag 2.
_calRecordReorderOptimistic([{ id: 'c1', order_index: 5 }]);
let merged = mergePin({ id: 'c1', order_index: 2, updated_at: 't' }, Date.now());
ok(merged.order_index === 5, 'fresh drag pins order_index 5 over the stale fetched 2');

// After the window, the server order wins again (and the entry is pruned).
_calReorderOptimistic.clear();
_calReorderOptimistic.set('c1', { order_index: 5, at: Date.now() - (CAL_REORDER_GUARD_MS + 1000) });
merged = mergePin({ id: 'c1', order_index: 2, updated_at: 't' }, Date.now());
ok(merged.order_index === 2, 'expired entry → server order (2) wins');
ok(!_calReorderOptimistic.has('c1'), 'expired entry is pruned on access');

// A card with no recent drag is untouched (non-reorder saves unaffected).
_calReorderOptimistic.clear();
merged = mergePin({ id: 'c2', order_index: 9, updated_at: 't' }, Date.now());
ok(merged.order_index === 9, 'card with no guard entry keeps the fetched order');

// Coalescing: a superseding drag (B) must NOT be cleared by an earlier failed
// write (A) that targeted the same card with a now-stale order.
_calReorderOptimistic.clear();
_calRecordReorderOptimistic([{ id: 'c1', order_index: 7 }]); // drag B (latest)
errorClear([{ id: 'c1', order_index: 5 }]);                  // drag A failed (older order)
ok(_calReorderOptimistic.get('c1') && _calReorderOptimistic.get('c1').order_index === 7,
   'failed older write does NOT clear a newer drag’s guard entry');
// A failed write whose order is still the latest DOES clear (server wins).
errorClear([{ id: 'c1', order_index: 7 }]);
ok(!_calReorderOptimistic.has('c1'), 'failed write clears its own (still-current) guard entry');

console.log('\n============================================================');
console.log('3) WIRING: shipped index.html still carries the fixes');
console.log('============================================================');
const persist = grabFunc('persistCalReorder');
ok(/_calLastLocalWriteAt = Date\.now\(\)/.test(persist),
   'persistCalReorder marks a local write (self-echo suppression)');
ok((persist.match(/_calLastLocalWriteAt = Date\.now\(\)/g) || []).length >= 2,
   'self-echo stamp is set on BOTH start and success');
ok(!/_setCalStatus\(/.test(persist),
   'persistCalReorder no longer calls the toolbar-shifting header badge');
ok(INDEX.indexOf('function _setCalStatus(') < 0 && INDEX.indexOf('id="calStatusBadge"') < 0,
   'the dead _setCalStatus function and #calStatusBadge span are gone');
ok(/_calReorderOptimistic\.get\(fp\.id\)/.test(INDEX) && /winner\.order_index = _ro\.order_index/.test(INDEX),
   'loadCalendarPosts merge pins order_index from the optimistic guard');
ok(/_calRecordReorderOptimistic\(items\)/.test(INDEX),
   'the drag-drop handler records the optimistic order');
ok(/if \('thumbnail_url' in edits \|\| 'asset_url' in edits\) _calRefreshCardThumb/.test(INDEX),
   'the thumbnail refresh is gated on a real media-link edit');
ok(/_calThumbSrcBase\(existing\.getAttribute\('src'\)\) === _calThumbSrcBase\(info\.url\)/.test(INDEX),
   '_calRefreshCardThumb compares src with the cache-buster-agnostic guard');
ok(/map\.set\(pid \+ '\|' \+ _calThumbSrcBase\(src\), img\)/.test(INDEX),
   'refresh path: _calHarvestThumbs keys on the cache-buster-agnostic base URL');
ok(/map\.get\(pid \+ '\|' \+ _calThumbSrcBase\(src\)\)/.test(INDEX),
   'refresh path: _calRestoreThumbs reuses the <img> when only _cb changed');

console.log('\n============================================================');
console.log('SUMMARY');
console.log('============================================================');
console.log('  ' + (fail === 0 ? 'PASS ✅' : 'FAIL ❌') + '  (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail === 0 ? 0 : 1);
