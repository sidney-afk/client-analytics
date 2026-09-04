'use strict';
/*
 * THE BOOT'S BATCH READ MUST PAGE BY PRIMARY KEY.
 *
 * It used to page with OFFSET over `order=created_at.desc`, and `created_at` is
 * not unique in that table: MEASURED 2026-09-03 against the live relation,
 * 85 of 1,665 batches share a timestamp with another batch, in 39 groups of up
 * to 5.
 *
 * PostgreSQL guarantees no order WITHIN a tie, and no two executions of the
 * same query need resolve one the same way. OFFSET paging asks the question
 * twice — `offset=0` then `offset=1000` — so a tie group lying across the page
 * boundary can hand back a row in both pages, or in neither. Neither answer
 * raises anything. "In neither" is a filming day that is simply not in
 * SyncLinear, which is the failure this repo keeps finding and the one a user
 * cannot report accurately: it arrives as "it's not in the list".
 *
 * It has not bitten yet only because the current boundary happens to fall
 * between two distinct timestamps. That is luck, and it moves every time a
 * batch is created.
 *
 * `id` is unique, so a keyset walk cannot express the bug — the same reasoning,
 * and the same mechanism, already applied to the deliverable projection.
 *
 * The second effect is waste rather than correctness, and is pinned here too so
 * it cannot quietly come back: the offset pager fires page 0 and then bursts
 * four more, so a 1,665-row table cost five requests to read two pages —
 * offset=2000/3000/4000 returned two bytes each, having each done a full
 * ORDER BY / OFFSET scan of the relation.
 */
const fs = require('fs');
const path = require('path');
const { extractFunction } = require('./helpers/extract-function.js');
const { stripBlockComments } = require('./helpers/strip-comments');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
let failures = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok  ' : 'FAIL  ') + msg);
  if (!cond) failures++;
}
const stripComments = s => stripBlockComments(String(s), ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

const loadData = stripComments(extractFunction(INDEX, '_prodLoadData'));

/* ---- the boot read itself ------------------------------------------------ */
const batchCall = (loadData.match(/_prodRestRows\(\s*'batches'[^\n]*\n?[^\n]*/) || [])[0] || '';
ok(!!batchCall, 'the boot still reads the batches table');
ok(/keysetColumn:\s*'id'/.test(batchCall),
  'and pages it by PRIMARY KEY, which is unique and therefore stable across the two page reads');
ok(!/order=created_at/.test(batchCall),
  'no created_at ordering is passed — it is not unique, and the keyset branch would drop it anyway');

/* ---- the property that makes the change safe ----------------------------- */
/*
 * Arrival order may not be load-bearing, or paging by a different column would
 * change what the board shows. Proven end-to-end before the change (the real
 * app booted over the same rows in server order and shuffled produced an
 * identical batch set, issue set and rendered list); pinned here at the two
 * places that consume the array, so a future edit that starts depending on
 * order fails loudly rather than silently reordering the board.
 */
const adapter = stripComments(extractFunction(INDEX, '_prodAdapter'));
ok(/BATCHES\[String\(b\.id\)\]\s*=/.test(adapter),
  'the adapter keys batches into a map by id, so the order they arrived in cannot reach the UI');
const preserve = stripComments(extractFunction(INDEX, '_prodPreserveProjectedFields'));
ok(/\bkey\b/.test(preserve) && /Map|\[key\]|\.get\(|\.set\(/.test(preserve),
  'and the merge that runs over them is keyed too, not positional');

/* ---- the burst that made this expensive stays off the boot path ---------- */
const restRows = stripComments(extractFunction(INDEX, '_prodRestRows'));
const keysetBranch = restRows.slice(restRows.indexOf('if (keysetColumn)'), restRows.indexOf('const pageUrl'));
ok(keysetBranch.length > 200 && !/Promise\.all/.test(keysetBranch),
  'the keyset walk asks for one page at a time, so it cannot over-fetch past the end');
ok(/Promise\.all/.test(restRows.slice(restRows.indexOf('const pageUrl'))),
  'the offset branch still bursts — it is unchanged, and no boot read uses it any more');

/* ---- and the same rule, stated over the whole file ----------------------
 *
 * The instance is `batches`; the CLASS is "paging a non-unique order". Pinning
 * only the one call site would let the next `order=created_at.desc` arrive
 * somewhere else with the same silent-loss shape, which is how this repo's bugs
 * usually travel. So: every created_at ordering in the file must carry a unique
 * tiebreak, wherever it is. */
const live = stripComments(INDEX);
const orderings = live.match(/order=created_at[^'"`]*/g) || [];
const untied = orderings.filter(o => !/[,.]id\./.test(o));
ok(untied.length === 0,
  'every created_at ordering in the file carries a unique id tiebreak (' + orderings.length
    + ' checked' + (untied.length ? ', offenders: ' + untied.join(' | ') : '') + ')');

if (failures) {
  console.error('\nBatch keyset paging checks FAILED');
  process.exit(1);
}
console.log('\nBatch keyset paging checks passed');
