'use strict';
/*
 * Calendar → Organize menu / auto-organize-by-date journey lane.
 *
 * Contract: FULLY MOCKED. It serves index.html from a local http server and
 * aborts every request that is not to that server, so it never reads from or
 * writes to a live backend. There is no live lane here and there must not be
 * one — the whole point of the suite is that the feature performs NO backend
 * writes, and it proves that by asserting on the requests it blocks.
 *
 *   node qa/calendar-organize/run.js            # interaction pass + 4 fuzz seeds
 *   node qa/calendar-organize/run.js --seeds=12 # widen the fuzz
 *   node qa/calendar-organize/run.js --quick    # interaction pass + 1 seed
 *
 * Two lanes:
 *
 *   interact.js — drives the menu the way a person does: open, change several
 *     settings without it closing, dismiss by outside-click and by Escape,
 *     watch a card re-place itself when its date is edited, toggle back, and
 *     follow the pill as the view tab changes.
 *
 *   stress.js — the round-trip proof. Seeds a calendar whose manual order is
 *     deliberately gappy and disagrees with date order, snapshots every
 *     order_index, then fuzzes 120 randomised operations, forcing a return to
 *     manual + no filters every 10th step and asserting the strip is identical
 *     to where it started. It also fires the strip's real drop handler while
 *     auto-organize is on (the one code path that rewrites order_index) and
 *     asserts nothing moved and the reorder webhook was never reached.
 *
 * Both are deterministic: stress.js takes a seed so any failure reproduces.
 *
 * Why this lane exists: auto-organize-by-date promises that flipping it off
 * gives the SMM back the exact order they dragged by hand. That promise is
 * only worth anything if it survives the messy middle — filters changing,
 * dates being edited, cards being created, view tabs switching. Source-level
 * assertions (test/calendar-organize-menu.js) pin the shape of the code; this
 * lane pins what the app actually does.
 */
const { spawnSync } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const quick = args.includes('--quick');
const seedArg = args.find(a => a.startsWith('--seeds='));
const SEEDS = [20260811, 999, 4242, 13, 7, 555, 31337, 20260812, 101, 24601, 88, 31415];
const count = quick ? 1 : (seedArg ? Math.max(1, Math.min(SEEDS.length, Number(seedArg.split('=')[1]) || 4)) : 4);

// Each child owns its own port so a stray listener from a previous run — or a
// parallel lane — can't make this one fail for the wrong reason.
let port = Number(process.env.SV_QA_PORT || 8181);
const run = (script, extra) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, script), ...(extra || [])], {
    stdio: 'inherit',
    env: Object.assign({}, process.env, { SV_QA_PORT: String(port++) }),
  });
  return r.status === 0;
};

let failed = 0;
console.log('=== Calendar Organize — interaction pass ===');
if (!run('interact.js')) failed++;

for (let i = 0; i < count; i++) {
  console.log('\n=== Calendar Organize — round-trip fuzz, seed ' + SEEDS[i] + ' ===');
  if (!run('stress.js', [String(SEEDS[i])])) failed++;
}

console.log(failed
  ? `\ncalendar-organize: ${failed} lane(s) FAILED ❌`
  : `\ncalendar-organize: all lanes passed ✅ (1 interaction pass + ${count} fuzz seed${count === 1 ? '' : 's'})`);
process.exit(failed ? 1 : 0);
