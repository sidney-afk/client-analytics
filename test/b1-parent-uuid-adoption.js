'use strict';
/*
 * A Linear rename must not fork the batch.
 *
 * `batchGroupKey` hashes client + parent TITLE + parent DESCRIPTION, and that
 * hash IS the batch's primary key. Both inputs are things a human edits in
 * Linear. So renaming a parent issue mints a batch with a new id for a parent
 * an existing batch still claims, and nothing ever releases the old claim.
 *
 * `_prodResolveBatchParentNodes` (index.html) fails CLOSED on a uuid claimed
 * by two batches — it will not guess which one is the parent — so every child
 * of that issue renders top-level with an "Add sub-issue" affordance on
 * something that is already a sub-issue. The owner hit exactly that on
 * 2026-08-23 opening a family of 15 thumbnails from Workload.
 *
 * Live census 2026-08-24, before the fix: 86 Linear parents claimed by 2+
 * batches across 123 batch rows, 45 sub-issues with no reachable parent, 107
 * of the losing rows minted by this importer.
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
const start = source.indexOf('function adoptExistingParentClaimants');
const end = source.indexOf('\n}', start) + 2;
ok(start > -1, 'adoptExistingParentClaimants is defined in the backfill script');
// eslint-disable-next-line no-eval
const adopt = eval(
  `(() => { function clean(v){return String(v==null?'':v).trim();}\n${source.slice(start, end)}\nreturn adoptExistingParentClaimants; })()`);

const P = uuid => ({ uuid, identifier: 'VID-1', url: 'https://x/VID-1' });

// --- 1. The defect itself --------------------------------------------------
{
  const stored = [{ id: 'b1_b_old', status: 'active', linear_parent_ids: { video: P('u-1') } }];
  const minted = [{ id: 'b1_b_renamed', name: '12 Reels', linear_parent_ids: { video: P('u-1') } }];
  const { adoptions } = adopt(minted, stored);
  ok(minted[0].id === 'b1_b_old',
    'a renamed group adopts the id of the batch that already claims its parent');
  ok(minted[0].name === '12 Reels',
    'the new name rides along, so the rename lands as an UPDATE instead of an INSERT');
  ok(adoptions.length === 1 && adoptions[0].minted_id === 'b1_b_renamed'
    && adoptions[0].adopted_id === 'b1_b_old',
    'the adoption is reported, so a silent id rewrite is never invisible in the run record');
}

// --- 2. An established home is never moved ---------------------------------
{
  const stored = [
    { id: 'b1_b_mine', status: 'active', linear_parent_ids: { video: P('u-1') } },
    { id: 'b1_b_other', status: 'active', linear_parent_ids: { video: P('u-1') } },
  ];
  const minted = [{ id: 'b1_b_mine', linear_parent_ids: { video: P('u-1') } }];
  const { adoptions } = adopt(minted, stored);
  ok(minted[0].id === 'b1_b_mine' && adoptions.length === 0,
    'a group whose minted id already exists keeps it — adopting away would move every child on a later pass');
}

// --- 3. An archived shell must not attract new children --------------------
{
  const stored = [{ id: 'b1_b_retired', status: 'archived', linear_parent_ids: { video: P('u-1') } }];
  const minted = [{ id: 'b1_b_fresh', linear_parent_ids: { video: P('u-1') } }];
  adopt(minted, stored);
  ok(minted[0].id === 'b1_b_fresh',
    'an archived batch is never an adoption target — the retired shell stays retired');
}

// --- 4. Two groups reaching one parent ------------------------------------
/*
 * Reachable, not theoretical: the group key includes the CLIENT, so when
 * attribution moves a parent's children between clients mid-run, one parent's
 * children arrive under two keys. 16 of the 86 live duplicates on 2026-08-24
 * straddled `unattributed` and a real client.
 *
 * The second group must NOT keep its minted id. Writing that row would insert
 * a fresh claim on the parent the first group just adopted — recreating the
 * exact ambiguity this function exists to prevent, on the very next run.
 */
{
  const stored = [{ id: 'bat_native', status: 'active', linear_parent_ids: { video: P('u-1') } }];
  const minted = [
    { id: 'b1_b_a', linear_parent_ids: { video: P('u-1') } },
    { id: 'b1_b_b', linear_parent_ids: { video: P('u-1') } },
  ];
  const { adoptions, withheld } = adopt(minted, stored);
  ok(minted[0].id === 'bat_native' && minted[1].id === 'bat_native',
    'BOTH groups point their children at the batch that owns the parent');
  ok(minted[0].adoptionWithheld !== true && minted[1].adoptionWithheld === true,
    'but only one of them writes a batch row — two rows sharing a primary key would break the upsert');
  ok(adoptions.length === 1 && withheld.length === 1
    && withheld[0].minted_id === 'b1_b_b' && withheld[0].adopted_id === 'bat_native',
    'the withheld group is reported, not silently dropped');
}
// The write plans must actually honour the flag, in both paths.
{
  const withheldFilters = source.match(/if \(r\.adoptionWithheld\) return false;/g) || [];
  ok(withheldFilters.length === 2,
    'both the full and the incremental write filters drop a withheld batch row');
}

// --- 5. An unclaimed parent still mints its own batch -----------------------
{
  const stored = [{ id: 'b1_b_unrelated', status: 'active', linear_parent_ids: { video: P('u-9') } }];
  const minted = [{ id: 'b1_b_new', linear_parent_ids: { video: P('u-1') } }];
  const { adoptions } = adopt(minted, stored);
  ok(minted[0].id === 'b1_b_new' && adoptions.length === 0,
    'a genuinely new parent is untouched — this only ever redirects a SECOND claim');
}

// --- 6. Target choice is deterministic -------------------------------------
{
  const shuffle = order => order.map(id => ({ id, status: 'active', linear_parent_ids: { video: P('u-1') } }));
  const a = [{ id: 'b1_b_new', linear_parent_ids: { video: P('u-1') } }];
  const b = [{ id: 'b1_b_new', linear_parent_ids: { video: P('u-1') } }];
  adopt(a, shuffle(['b1_b_zzz', 'b1_b_aaa']));
  adopt(b, shuffle(['b1_b_aaa', 'b1_b_zzz']));
  ok(a[0].id === b[0].id && a[0].id === 'b1_b_aaa',
    'the target does not depend on the order rows arrived in — two claimants resolve the same way every run');
}

// --- 7. Both plan paths call it --------------------------------------------
{
  // Assert on the CALLS, not on mentions: a count over the whole file would
  // move every time someone edits the comment above the function.
  ok(/adoptExistingParentClaimants\(batches, existingBatches\)/.test(source),
    'the full plan adopts before it compares batch rows');
  ok(/adoptExistingParentClaimants\(rawBatches, existingBatches\)/.test(source),
    'the incremental plan adopts too — the path that actually runs every 30 minutes');
  ok(/batch_parent_adoptions: batchParentAdoptions/.test(source),
    'both summaries carry the adoption record');
  /*
   * A receipt that exists only on an in-memory plan is not a receipt. The
   * scheduled workflow suppresses the private log and uploads only the public
   * artifact, so an adoption needs all three: the persisted private event
   * (ids allowed), the printed report, and an aggregate in the public file.
   */
  const persisted = source.match(/batch_parent_adoptions: plan\.batch_parent_adoptions \|\| \[\]/g) || [];
  ok(persisted.length === 2,
    'the persisted linear_incremental_refresh event carries it, on success AND on failure');
  ok(/Batch parent adoptions: \$\{\(plan\.batch_parent_adoptions \|\| \[\]\)\.length\}/.test(source),
    'the incremental report prints it — unconditionally, so a zero is distinguishable from a stale report');
}


// --- 8. The repair has to STAY repaired -----------------------------------
/*
 * Measured on live data 2026-08-25: the owner cleared 86 duplicated parent
 * claims at 00:42Z, and by 03:24Z one was already back. Nothing was wrong with
 * the repair. `b1_b_c53b1ba8…` still EXISTS and still hashes to that group, so
 * adoption correctly left it alone as an established home, and this importer
 * recomputed its parent map and re-wrote a claim on a parent another batch
 * (14 children to its 2) still owns. Left alone the repair erodes one batch at
 * a time, and every eroded parent takes its children's parent card with it.
 */
const dropStart = source.indexOf('function dropClaimsOwnedByAnotherBatch');
const dropEnd = source.indexOf('\n}', dropStart) + 2;
ok(dropStart > -1, 'dropClaimsOwnedByAnotherBatch is defined in the backfill script');
// eslint-disable-next-line no-eval
const dropClaims = eval(
  `(() => { function clean(v){return String(v==null?'':v).trim();}\n${source.slice(dropStart, dropEnd)}\nreturn dropClaimsOwnedByAnotherBatch; })()`);

{
  // The exact live shape: a cleared batch recomputing a claim the winner holds.
  const stored = [
    { id: 'b1_b_winner', status: 'active', linear_parent_ids: { video: P('u-1') } },
    { id: 'b1_b_cleared', status: 'active', linear_parent_ids: {} },
  ];
  const rows = [{ id: 'b1_b_cleared', linear_parent_ids: { video: P('u-1'), graphics: P('u-1') } }];
  const dropped = dropClaims(rows, stored);
  ok(Object.keys(rows[0].linear_parent_ids).length === 0,
    'a cleared batch cannot re-write a claim the winner still owns — the repair holds');
  ok(dropped.length === 2 && dropped[0].owned_by === 'b1_b_winner',
    'and every dropped slot is reported with who owns it');
}
{
  const stored = [{ id: 'b1_b_mine', status: 'active', linear_parent_ids: { video: P('u-1') } }];
  const rows = [{ id: 'b1_b_mine', linear_parent_ids: { video: P('u-1') } }];
  dropClaims(rows, stored);
  ok(rows[0].linear_parent_ids.video, 'a batch keeps the claim it already owns');
}
{
  const rows = [{ id: 'b1_b_new', linear_parent_ids: { video: P('u-9') } }];
  dropClaims(rows, [{ id: 'b1_b_other', status: 'active', linear_parent_ids: { video: P('u-1') } }]);
  ok(rows[0].linear_parent_ids.video, 'an unclaimed parent is written normally');
}
{
  const stored = [{ id: 'b1_b_retired', status: 'archived', linear_parent_ids: { video: P('u-1') } }];
  const rows = [{ id: 'b1_b_live', linear_parent_ids: { video: P('u-1') } }];
  dropClaims(rows, stored);
  ok(rows[0].linear_parent_ids.video,
    'an ARCHIVED holder never blocks — same rule as the adoption target');
}
{
  // Ownership is read from the STORE, never from the other rows in this run,
  // so two groups reaching one parent cannot each defer to the other.
  const stored = [{ id: 'b1_b_owner', status: 'active', linear_parent_ids: { video: P('u-1') } }];
  const rows = [
    { id: 'b1_b_a', linear_parent_ids: { video: P('u-1') } },
    { id: 'b1_b_b', linear_parent_ids: { video: P('u-1') } },
  ];
  dropClaims(rows, stored);
  ok(!rows[0].linear_parent_ids.video && !rows[1].linear_parent_ids.video,
    'both non-owners drop it; neither is talked out of dropping by the other');
}
{
  const calls = source.match(/dropClaimsOwnedByAnotherBatch\(batches, existingBatches\)/g) || [];
  ok(calls.length === 2, 'both the full and the incremental plan run the guard');
  ok(/batch_parent_claims_dropped: plan\.batch_parent_claims_dropped \|\| \[\]/.test(source),
    'and what it dropped reaches the persisted event');
}
console.log(failures ? `\n${failures} failing` : '\nall passing');
process.exit(failures ? 1 : 0);
