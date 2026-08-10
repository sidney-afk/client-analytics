'use strict';
/*
 * A batch's per-team parent map must ACCUMULATE across incremental runs.
 *
 * WHAT THIS FIXES. `batchRowsFor` builds `linear_parent_ids` from the issues
 * present in the current run, and the incremental path loads only issues
 * changed since the cursor. The batch upsert replaces that column wholesale
 * (migrations/2026-07-06-b1-linear-data-model.sql:421). So a run carrying only
 * one team's children rewrote the map to that one team and dropped the other
 * team's parent — a correct entry, recomputed correctly on the next run that
 * happens to see those children, and discarded again.
 *
 * Measured on live data 2026-08-10: 93 batches held children of a team whose
 * parent entry was missing while another team's entry was present. The cost is
 * downstream, in linear-deliverables-reconcile.js:518-519, which falls back to
 * "first parent of any team" when its own team has no entry — so those children
 * resolve to the WRONG team's parent card. Today that is an
 * `outbound_parent_mismatch` in the nightly audit; after the graphics flip the
 * same path emits a real Linear write and would reparent those issues under the
 * other team's batch card.
 *
 * The line that must NOT move: mixed-team batches are a DESIGNED shape. B1
 * groups by client + parent title + parent description, deliberately without
 * team, and `batchShapeSummary` counts mirrored pairs as a first-class
 * category. The fix keeps both entries; it must never split the batch or pick
 * a winner.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'b1-linear-backfill.js');
const source = fs.readFileSync(SRC, 'utf8');

// Run the shipped function, not a re-implementation.
const start = source.indexOf('function mergeBatchParentIds');
const end = source.indexOf('\n}', start) + 2;
ok(start > -1, 'mergeBatchParentIds is defined in the backfill script');
// eslint-disable-next-line no-eval
const mergeBatchParentIds = eval(
  `(() => { function clean(v){return String(v==null?'':v).trim();}\n${source.slice(start, end)}\nreturn mergeBatchParentIds; })()`);

const VID = { uuid: 'u-vid', identifier: 'VID-1', url: 'https://x/VID-1' };
const GRA = { uuid: 'u-gra', identifier: 'GRA-1', url: 'https://x/GRA-1' };

// --- 1. The defect itself --------------------------------------------------
const truncating = mergeBatchParentIds(
  { linear_parent_ids: { video: VID }, team: 'video' },
  { linear_parent_ids: { graphics: GRA }, team: 'graphics' });
ok(truncating.linear_parent_ids.video === VID && truncating.linear_parent_ids.graphics === GRA,
  'a run that sees only one team KEEPS the other team\'s parent instead of dropping it');
ok(truncating.team === null,
  'a map spanning two teams forces the scalar team to null, matching the mixed-batch contract');

// --- 2. It must still accept genuine updates -------------------------------
const REPOINTED = { uuid: 'u-gra2', identifier: 'GRA-2', url: 'https://x/GRA-2' };
const updated = mergeBatchParentIds(
  { linear_parent_ids: { graphics: GRA }, team: 'graphics' },
  { linear_parent_ids: { graphics: REPOINTED }, team: 'graphics' });
ok(updated.linear_parent_ids.graphics === REPOINTED,
  'an incoming entry for a team that already has one WINS — merging is not freezing');
ok(updated.team === 'graphics',
  'a single-team map keeps its scalar team');

// --- 3. Boundaries ---------------------------------------------------------
const fresh = mergeBatchParentIds(null, { linear_parent_ids: { video: VID }, team: 'video' });
ok(fresh.linear_parent_ids.video === VID && fresh.team === 'video',
  'a brand-new batch passes through untouched');
const fromJsonText = mergeBatchParentIds(
  { linear_parent_ids: JSON.stringify({ video: VID }), team: 'video' },
  { linear_parent_ids: { graphics: GRA }, team: 'graphics' });
ok(fromJsonText.linear_parent_ids.video && fromJsonText.linear_parent_ids.graphics,
  'a stored map arriving as JSON TEXT is parsed rather than silently discarded');
for (const junk of [null, undefined, '', 'not json', 42, ['a']]) {
  const out = mergeBatchParentIds({ linear_parent_ids: junk, team: 'video' },
    { linear_parent_ids: { graphics: GRA }, team: 'graphics' });
  ok(out.linear_parent_ids.graphics === GRA,
    `an unusable stored map (${JSON.stringify(junk)}) falls back to the computed row rather than throwing`);
}

// --- 4. Idempotence --------------------------------------------------------
const once = mergeBatchParentIds({ linear_parent_ids: { video: VID }, team: 'video' },
  { linear_parent_ids: { graphics: GRA }, team: 'graphics' });
const twice = mergeBatchParentIds({ linear_parent_ids: once.linear_parent_ids, team: once.team }, once);
ok(JSON.stringify(twice.linear_parent_ids) === JSON.stringify(once.linear_parent_ids)
  && twice.team === once.team,
'merging a already-merged row changes nothing — the importer cannot oscillate');

// --- 4b. The write-loop trap ----------------------------------------------
/* THE defect this file exists to prevent, found while reviewing the first
 * version of this change. `sameValue` compares objects with `stableJson`,
 * which is a bare JSON.stringify (b1-linear-backfill.js:446-448) and does NOT
 * sort keys. PostgREST returns the stored map with keys in one order
 * (identifier, url, uuid) while batchRowsFor builds entries as
 * {uuid, identifier, url}. Putting linear_parent_ids into batchFields would
 * therefore have marked EVERY batch changed on EVERY run — rewriting all
 * ~1,300 batches every 30 minutes, forever. Worse than the bug being fixed.
 */
const cStart = source.indexOf('function canonicalParentMap');
const cEnd = source.indexOf('\n}', cStart) + 2;
const pStart = source.indexOf('function batchParentsChanged');
const pEnd = source.indexOf('\n}', pStart) + 2;
// eslint-disable-next-line no-eval
const batchParentsChanged = eval(
  `(() => { function clean(v){return String(v==null?'':v).trim();}\n${source.slice(cStart, cEnd)}\n${source.slice(pStart, pEnd)}\nreturn batchParentsChanged; })()`);

const storedOrder = { video: { identifier: 'VID-1', url: 'https://x/VID-1', uuid: 'u-vid' } };
const builtOrder = { video: { uuid: 'u-vid', identifier: 'VID-1', url: 'https://x/VID-1' } };
ok(JSON.stringify(storedOrder) !== JSON.stringify(builtOrder),
  'the two key orders really are byte-different — the trap is real, not hypothetical');
ok(batchParentsChanged({ linear_parent_ids: storedOrder }, { linear_parent_ids: builtOrder }) === false,
  'the same map in a different key order is NOT a change — no rewrite-every-run loop');
ok(batchParentsChanged({ linear_parent_ids: { graphics: GRA, video: VID } },
  { linear_parent_ids: { video: VID, graphics: GRA } }) === false,
'top-level team key order is also ignored');
ok(batchParentsChanged({ linear_parent_ids: { video: VID } },
  { linear_parent_ids: { video: VID, graphics: GRA } }) === true,
'a genuinely added team IS a change');
ok(batchParentsChanged({ linear_parent_ids: { video: VID } },
  { linear_parent_ids: { video: REPOINTED } }) === true,
'a genuinely repointed parent IS a change');
ok(batchParentsChanged({ linear_parent_ids: JSON.stringify(storedOrder) },
  { linear_parent_ids: builtOrder }) === false,
'a map stored as JSON text still compares equal to the built object');
ok(!/const batchFields = \[[^\]]*linear_parent_ids/.test(source),
  'linear_parent_ids is deliberately NOT in batchFields — it is compared through canonicalParentMap instead');

// --- 5. The wiring ---------------------------------------------------------
/* The merge is worthless unless the column is COMPARED — `batchFields` omitted
 * `linear_parent_ids`, which is why a truncation was never even detected as a
 * change. And it must run BEFORE the comparison, or a partial run writes its
 * own truncation. */
ok((source.match(/batchParentsChanged\(existing, r\)/g) || []).length === 2,
  'BOTH plan paths check the parent map, so a truncation is detectable at all');
ok(/const batches = rawBatches\.map\(r => mergeBatchParentIds\(existingBatchById\.get\(r\.id\), r\)\);[\s\S]{0,400}?const batchCandidates/.test(source),
  'the incremental path merges BEFORE building write candidates');
ok(/const batches = batchRowsFor\(/.test(source),
  'the full backfill still builds its map authoritatively — it sees every issue, so it may legitimately clear a removed parent');

if (failures) {
  console.error(`\n${failures} b1 batch parent-merge check(s) failed`);
  process.exit(1);
}
console.log('\nB1 batch parent-merge checks passed');
