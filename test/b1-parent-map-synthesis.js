'use strict';

/*
 * A batch that reaches the store with one team's parent refuses the other
 * team's work forever — the append gateway 409s any thumbnail aimed at a
 * video-only map. B1 was minting ~6 such maps a day (measured 2026-08-24:
 * 31 in the five days after ONE PARENT PER CARD shipped), which is how
 * OPEN_REPAIRS item 16's population grew 255 → 272 while the legacy fix was
 * being decided. `synthesizeParentMap` mirrors a lone team's parent into the
 * other slot with `owner_team` naming the source board — the modern native
 * shape, and the exact shape of the item-16 owner backfill.
 *
 * The ordering case (5) is the one that earns this suite its place. The merge
 * is incoming-wins per key, so a mirror synthesized BEFORE the merge would
 * overwrite a genuine stored graphics parent with a copy of this run's
 * one-sided view — silently, on every batch the incremental lane revisits.
 * That is the bug the first design draft would have shipped; the composition
 * is executed here in both orders so the wrong one can never come back quietly.
 */

const path = require('node:path');
const fs = require('node:fs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'b1-linear-backfill.js');
const { synthesizeParentMap } = require(SCRIPT);
const source = fs.readFileSync(SCRIPT, 'utf8');

// mergeBatchParentIds is deliberately unexported; extract it the same way
// test/b1-batch-parent-merge.js does.
const start = source.indexOf('function mergeBatchParentIds');
const bodyEnd = source.indexOf('\n}', start);
const mergeBatchParentIds = eval('(' + source.slice(start, bodyEnd + 2) + ')');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const vid = { uuid: 'uuid-v', identifier: 'VID-100', url: 'https://linear.app/x/issue/VID-100/a' };
const gra = { uuid: 'uuid-g', identifier: 'GRA-200', url: 'https://linear.app/x/issue/GRA-200/b' };

// --- 1. a lone video parent gains a graphics mirror --------------------------
const fromVideo = synthesizeParentMap({ id: 'b1', linear_parent_ids: { video: vid } });
ok(!!fromVideo.linear_parent_ids.graphics
  && fromVideo.linear_parent_ids.graphics.uuid === 'uuid-v'
  && fromVideo.linear_parent_ids.graphics.identifier === 'VID-100'
  && fromVideo.linear_parent_ids.graphics.owner_team === 'video',
  'a video-only map gains a graphics slot pointing at the SAME issue, owner_team naming the source board');
ok(!('owner_team' in fromVideo.linear_parent_ids.video),
  'the source entry is left exactly as it was — the mirror is the only addition');

// --- 2. symmetric for a lone graphics parent ---------------------------------
const fromGraphics = synthesizeParentMap({ id: 'b2', linear_parent_ids: { graphics: gra } });
ok(!!fromGraphics.linear_parent_ids.video
  && fromGraphics.linear_parent_ids.video.uuid === 'uuid-g'
  && fromGraphics.linear_parent_ids.video.owner_team === 'graphics',
  'a graphics-only map gains a video mirror the same way');

// --- 3. a synthesized entry never displaces a real one -----------------------
const both = synthesizeParentMap({ id: 'b3', linear_parent_ids: { video: vid, graphics: gra } });
ok(both.linear_parent_ids.graphics.uuid === 'uuid-g'
  && both.linear_parent_ids.video.uuid === 'uuid-v',
  'a map with both entries passes through untouched — the mirror only fills a truly empty slot');

// --- 4. degenerate shapes pass through ---------------------------------------
ok(synthesizeParentMap({ id: 'b4', linear_parent_ids: {} }).linear_parent_ids
  && Object.keys(synthesizeParentMap({ id: 'b4', linear_parent_ids: {} }).linear_parent_ids).length === 0,
  'an empty map stays empty — nothing to mirror is not an error');
const noMap = { id: 'b5' };
ok(synthesizeParentMap(noMap) === noMap, 'a row with no map at all is returned as-is');

// The helper is exported; a caller's object is not its scratch space. At the
// current call site the input is freshly built so an in-place mutant would be
// invisible there — this is the assertion that keeps it visible.
const pristine = { video: { uuid: 'uuid-v', identifier: 'VID-100', url: 'u' } };
const pristineRow = { id: 'b5b', linear_parent_ids: pristine };
synthesizeParentMap(pristineRow);
ok(!('graphics' in pristine) && Object.keys(pristine).length === 1,
  'the input map is never mutated — the mirror lives only on the returned copy');

// --- 5. THE ORDERING CASE — synthesis must run AFTER the merge ---------------
// Existing batch: a REAL graphics parent already stored. This run: only video
// children seen, so the incoming raw row is video-only.
const existing = { id: 'b6', linear_parent_ids: { graphics: gra } };
const incoming = { id: 'b6', linear_parent_ids: { video: vid } };

// Correct order: merge first (real graphics entry enters the map), synthesize
// second (mirror stands down because the slot is taken).
const correct = synthesizeParentMap(mergeBatchParentIds(existing, incoming));
ok(correct.linear_parent_ids.graphics.uuid === 'uuid-g'
  && correct.linear_parent_ids.video.uuid === 'uuid-v',
  'merge-then-synthesize keeps the REAL stored graphics parent and the new video one');

// Wrong order: synthesize first (mirror fabricates a graphics entry from the
// one-sided view), merge second (incoming-wins clobbers the real entry).
const wrong = mergeBatchParentIds(existing, synthesizeParentMap(incoming));
ok(wrong.linear_parent_ids.graphics.uuid === 'uuid-v',
  'sanity: the wrong order really does destroy the stored entry — this is what the ordering protects against');

// --- 6. the wiring uses the correct order, in the incremental plan -----------
// The composition itself is executed above; this pins WHERE it runs. The
// frozen full-mode lane is deliberately not wired — its plan path is retired
// and must stay byte-identical.
ok(/synthesizeParentMap\(mergeBatchParentIds\(existingBatchById\.get\(r\.id\), r\)\)/.test(source),
  'the incremental plan composes synthesize AFTER merge, exactly once, in that order');
// Two `synthesizeParentMap(`: the definition and the one wiring site. The
// export lists the bare name, so it does not match — which is what makes this
// an invocation count rather than a mention count.
ok((source.match(/synthesizeParentMap\(/g) || []).length === 2,
  'and the function is invoked nowhere else — no full-mode wiring, no second call site');

if (failures) {
  console.error('\n' + failures + ' parent-map synthesis check(s) failed');
  process.exit(1);
}
console.log('\nB1 parent-map synthesis checks passed');
