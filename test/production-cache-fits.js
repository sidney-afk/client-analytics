'use strict';
/*
 * A CACHE THAT CANNOT FIT MUST NOT DELETE ITS NEIGHBOURS TRYING — AND THE TEST
 * THAT SAYS IT FITS MUST BE MEASURING THE REAL ROWS.
 *
 * The Production tab paints from a localStorage snapshot and revalidates behind
 * it. It has never once written one.
 *
 *   Schema 1 serialised every client, member, batch and deliverable: 5.44M
 *   characters, ~10.9MB as UTF-16, against a ~5MB origin budget. It could not be
 *   written on any browser, on any day, by anyone — and on the way to failing it
 *   evicted every calendar and samples snapshot in the origin, because the
 *   quota retry loop deleted a neighbour and tried again, and no number of
 *   deletions could ever make room.
 *
 *   Schema 2 fixed the eviction and shrank the payload. It STILL did not fit,
 *   and THIS FILE IS WHY NOBODY NOTICED: its fixture rows were built from a
 *   SIXTEEN column list read off a truncated line, at ~499 characters a row. The
 *   shipped read asks for FORTY-FOUR (PROD_DELIVERABLE_SELECT) at ~1,674
 *   characters a row. The suite measured something 2.5x lighter than reality and
 *   passed, while the real projection sat at 3,283,150 characters against an
 *   1,800,000 budget. A green test asserting a false thing is worse than no
 *   test, and it cost a day.
 *
 * So the fixtures below are built FROM THE SHIPPED SELECT, parsed out of
 * index.html at run time. If a column is added to the read, this suite sizes
 * itself against the new list on the next run without anybody remembering to
 * update it. That is the single property that would have caught schema 2.
 *
 * The other half is key presence. `_prodHasOwn(row, field)` distinguishes
 * "absent" from "present and null" for identity_repair_state,
 * identity_repair_reason, identity_repair_resolved_linear_issue_id, brief/desc
 * and board_desc/desc. A columnar encoder that unions the keys it happens to see
 * fabricates `null` for every row missing one and flips those probes to TRUE —
 * which is a reader looking at a confident "No description." over a brief that
 * exists. The shipped codec is executed here against rows with deliberately
 * different key sets, in both directions.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
const hasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);

function fnSource(name) {
  const start = html.indexOf('function ' + name + '(');
  if (start < 0) return '';
  const end = html.indexOf('\n        }', start);
  return end < 0 ? '' : html.slice(start, end + 10);
}
function constValue(decl, endToken) {
  const start = html.indexOf(decl);
  if (start < 0) return '';
  const end = html.indexOf(endToken, start + decl.length);
  return end < 0 ? '' : html.slice(start + decl.length, end).trim();
}
function selectColumns(decl) {
  const raw = constValue(decl, ';').replace(/^'|'$/g, '');
  return raw.split(',').map(name => name.trim()).filter(Boolean);
}

// ---- the shipped column lists, not restated ------------------------------
const DELIVERABLE_COLUMNS = selectColumns("const PROD_DELIVERABLE_SELECT = ");
const BATCH_COLUMNS = selectColumns("const PROD_BATCH_SELECT = ")
  .filter(name => name !== 'description' && name !== 'desc');
ok(DELIVERABLE_COLUMNS.length >= 40,
  'the deliverable select is read from the shipped constant and is the FULL list ('
    + DELIVERABLE_COLUMNS.length + ' columns) — schema 2 was sized against 16 of them');
ok(DELIVERABLE_COLUMNS.includes('identity_repair_state') && DELIVERABLE_COLUMNS.includes('raw_project_id'),
  'including the identity-repair and raw attribution columns, which _prodHasOwn probes for presence');
ok(BATCH_COLUMNS.length > 5 && !BATCH_COLUMNS.includes('description'),
  'and the batch list is the shipped select minus description, the one column the cache drops');
ok(/_prodRestRows\('batches', PROD_BATCH_SELECT,/.test(html),
  'the batches READ uses that same constant, so the cache cannot be sized against a list the app does not use');

const schema = Number(constValue('const PROD_CACHE_SCHEMA = ', ';'));
const maxChars = Number(constValue('const PROD_CACHE_MAX_CHARS = ', ';'));
ok(schema === 3, 'schema 3 — a schema-2 snapshot is a different shape and is discarded, not decoded');
ok(Number.isFinite(maxChars) && maxChars > 0, 'the budget is a real number of characters (' + maxChars.toLocaleString() + ')');

// ---- the shipped codec, EXECUTED -----------------------------------------
const codecSrc = [
  'const _prodCacheHasOwn = (row, key) => Object.prototype.hasOwnProperty.call(row, key);',
  fnSource('_prodCachePackRows'),
  fnSource('_prodCacheUnpackRows'),
].join('\n');
ok(/function _prodCachePackRows/.test(codecSrc) && /function _prodCacheUnpackRows/.test(codecSrc),
  'both halves of the codec are findable (harness is not vacuous)');
const codec = { Map, Object, Array, String, Number, console };
vm.createContext(codec);
vm.runInContext(codecSrc, codec);

/* Three rows with three DIFFERENT key sets — the case a union-of-keys encoder
   gets wrong, and the one that decides whether a reader sees a real brief. */
const fullRow = Object.fromEntries(DELIVERABLE_COLUMNS.map(c => [c, c === 'id' ? 'row-a' : null]));
const missingRepair = Object.fromEntries(DELIVERABLE_COLUMNS
  .filter(c => c !== 'identity_repair_reason')
  .map(c => [c, c === 'id' ? 'row-b' : null]));
const sparse = { id: 'row-c', title: 'only two columns', runtime_added: 'kept' };
const shapes = [fullRow, missingRepair, sparse];
const packed = codec._prodCachePackRows(shapes, DELIVERABLE_COLUMNS);
const back = codec._prodCacheUnpackRows(packed);

ok(JSON.stringify(back) === JSON.stringify(shapes),
  'a round trip returns the rows byte-identical, key order included');
ok(!hasOwn(back[1], 'identity_repair_reason'),
  'an ABSENT key stays absent — this is the one that makes _prodHasOwn lie and paints "No description." over a real brief');
ok(hasOwn(back[0], 'identity_repair_reason') && back[0].identity_repair_reason === null,
  'and a key present with a null value stays present, which is the other half of the same distinction');
ok(back[2].runtime_added === 'kept',
  'a key outside the closed column list is carried through rather than dropped');
ok(packed.s.length === 3 && packed.c.length === DELIVERABLE_COLUMNS.length,
  'distinct key-shapes are stored once each and the column names exactly once');
for (const malformed of [null, {}, { c: ['id'], s: ['1'], x: [0], v: [] }, { c: ['id'], s: ['11'], x: [0], v: [[1]] }]) {
  if (codec._prodCacheUnpackRows(malformed) !== null) {
    failures++; console.error('FAIL  a malformed snapshot decoded instead of being refused: ' + JSON.stringify(malformed));
  }
}
ok(true, 'a malformed snapshot decodes to null rather than a partial list — half a snapshot painted as truth is worse than none');

// ---- the size contract, at the measured estate ---------------------------
/* Sized from the 2026-08-26 live measurement: 1,504 non-terminal deliverables
   at ~1,674 characters a row across the full select, and 1,465 batches. The
   filler is distributed so a serialised row lands on that real weight rather
   than a convenient one. */
const LIVE_ROWS = 1504;
const BATCH_ROWS = 1465;
const TARGET_ROW_CHARS = 1674;
const TARGET_BATCH_ROW_CHARS = 529;
const filler = n => 'x'.repeat(n);
/* Value width is derived from the REAL column names, because in the verbatim
   shape a row pays for every name as well as every value — and the names here
   are long (`identity_repair_resolved_linear_issue_id` alone is 40 characters).
   Sizing the values without accounting for that is how the first draft of this
   fixture came out 46% heavy. */
function valueWidth(columns, targetRowChars) {
  const overhead = columns.reduce((sum, name) => sum + name.length + 6, 2);
  return Math.max(1, Math.round((targetRowChars - overhead) / columns.length));
}
const perColumn = valueWidth(DELIVERABLE_COLUMNS, TARGET_ROW_CHARS);
const perBatchColumn = valueWidth(BATCH_COLUMNS, TARGET_BATCH_ROW_CHARS);
const deliverables = Array.from({ length: LIVE_ROWS }, (_, i) => Object.fromEntries(
  DELIVERABLE_COLUMNS.map(c => [c, c === 'id' ? 'del-' + i + filler(perColumn) : filler(perColumn)])));
const batches = Array.from({ length: BATCH_ROWS }, (_, i) => Object.fromEntries(
  BATCH_COLUMNS.map(c => [c, c === 'id' ? 'bat-' + i : filler(perBatchColumn)])));

const rowChars = Math.round(JSON.stringify(deliverables).length / LIVE_ROWS);
const batchRowChars = Math.round(JSON.stringify(batches).length / BATCH_ROWS);
ok(Math.abs(rowChars - TARGET_ROW_CHARS) < 60,
  'the fixture deliverable row weighs what a real one weighs (' + rowChars + ' chars vs the measured ' + TARGET_ROW_CHARS + ')');
ok(Math.abs(batchRowChars - TARGET_BATCH_ROW_CHARS) < 60,
  'and the fixture batch row does too (' + batchRowChars + ' vs the measured ' + TARGET_BATCH_ROW_CHARS + ')');

const verbose = JSON.stringify({ schema: 2, savedAt: 1, clients: [], members: [], batches, deliverables });
const columnar = JSON.stringify({
  schema, savedAt: 1, clients: [], members: [],
  batches: codec._prodCachePackRows(batches, BATCH_COLUMNS),
  deliverables: codec._prodCachePackRows(deliverables, DELIVERABLE_COLUMNS),
});
ok(verbose.length > maxChars,
  'the VERBATIM shape is over budget at estate size (' + Math.round(verbose.length / 1000) + 'k chars) — this is the write schema 2 could never make');
ok(columnar.length <= maxChars,
  'the COLUMNAR shape fits (' + Math.round(columnar.length / 1000) + 'k of a ' + Math.round(maxChars / 1000) + 'k budget, '
    + Math.round((maxChars - columnar.length) / 1000) + 'k spare)');
ok(columnar.length * 2 < 5 * 1024 * 1024,
  'and fits in UTF-16 beside the calendar snapshots (' + (columnar.length * 2 / 1048576).toFixed(2) + 'MB of a ~5MB origin budget)');

// ---- what must not be cached ---------------------------------------------
const projectSrc = fnSource('_prodCacheProject');
ok(!!projectSrc, 'the projection is findable');
ok(!/authority:/.test(projectSrc),
  'AUTHORITY IS NOT CACHED — a 24h-old snapshot must never decide whether write controls are live, least of all on a flip morning');
ok(/_prodState\.authorityLoaded = false;/.test(html),
  'and the cached paint leaves authority unknown, so the tab stays read-only until the live read answers');
ok(/deliverables: _prodCachePackRows\(deliverables, _prodCacheDeliverableColumns\(\)\)/.test(projectSrc)
  && /batches: _prodCachePackRows\(batches, _prodCacheBatchColumns\(\)\)/.test(projectSrc),
  'both row sets are packed — batches alone were 775k of the 1.93M that still did not fit');

// ---- the order that is the whole safety argument -------------------------
const writeSrc = html.slice(html.indexOf('function _prodCacheWrite('), html.indexOf('function _prodCachePurge('));
const budgetAt = writeSrc.indexOf('PROD_CACHE_MAX_CHARS');
const evictAt = writeSrc.indexOf('evictable');
ok(budgetAt > 0 && evictAt > budgetAt,
  'the budget is checked BEFORE the eviction loop — checking after the first failure is the bug, because by then a neighbour is already gone');
ok(/if \(payload\.length > PROD_CACHE_MAX_CHARS\)[\s\S]{0,200}?return false;/.test(writeSrc),
  'and an oversized payload returns without writing rather than starting a retry it cannot win');

// ---- the snapshot is a projection, and says so ---------------------------
ok(/_prodState\.fromCache = true;\s*\n\s*_prodState\.cachePartial = true;/.test(html),
  'the cached paint marks itself partial');
ok(/_prodState\.fromCache = false;\s*\n\s*_prodState\.cachePartial = false;/.test(html),
  'and the live read clears it');
ok(/\(parsed\.deliverables\.c \|\| \[\]\)\.join\(','\) !== wanted/.test(html),
  'a snapshot written against a different column list is discarded, because "absent" is a real answer to _prodHasOwn and a stale shape would forge one');

if (failures) {
  console.error(`\n${failures} production cache check(s) failed`);
  process.exit(1);
}
console.log('\nproduction cache fits — measured against the columns the app actually reads');
