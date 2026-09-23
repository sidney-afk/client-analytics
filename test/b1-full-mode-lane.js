'use strict';
/*
 * The full (authoritative) B1 lane must be reachable, and reachable ONLY on
 * purpose.
 *
 * WHY IT EXISTS. #1051 made the incremental importer MERGE a batch's per-team
 * parent map instead of replacing it, because clearing by omission was the bug:
 * a run carrying one team's children was wiping the other team's parent. The
 * cost of that fix is stated in the PR itself — "a parent legitimately removed
 * in Linear can no longer be cleared by an incremental run" — and OPEN_REPAIRS
 * item 14 records the consequence: post-flip, `linear-deliverables-reconcile`
 * turns a stale entry into a REAL Linear reparent write.
 *
 * Only the full path replaces the map authoritatively. Every workflow passed
 * `--incremental` unconditionally, so nothing in the repository could run it —
 * the repair item 14 asks for had no lane at all. That is the same shape as
 * F40: a code path that exists, is correct, and is unreachable, so no test and
 * no scheduled job ever touches it.
 *
 * THE LINE THAT MUST NOT MOVE: a scheduled run is always incremental. The full
 * path rewrites every batch's parent map from one traversal; a cron that could
 * take it by accident would be a standing risk for a repair that should happen
 * deliberately, under observation, a handful of times.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const script = fs.readFileSync(path.join(ROOT, 'scripts', 'b1-linear-backfill.js'), 'utf8');

/* Sections 1-4 asserted the dispatch lane in b1-linear-incremental-refresh.yml
 * (mode input, cron-cannot-take-full guard, conditional --incremental, and the
 * changed_since+full refusal). That workflow was retired with B2 slice 6
 * (2026-09-23), so only the script-side freeze below remains to pin. */

// --- 5. The script-side freeze this lane depends on ------------------------
/* The workflow does not enforce the pre-F1 constraint itself, and must not
 * claim to: the script does, on a LIVE flag read. Pinned here so the
 * workflow's notice text cannot drift into a promise nothing keeps. */
ok(/full B1 apply is frozen unless a live flag read confirms both production teams are Linear-authoritative/.test(script),
  'the script still refuses a full apply unless both teams are Linear-authoritative');
ok(/async function assertFullApplyAuthority\(\)[\s\S]{0,400}?state\.authority\.video !== 'linear' \|\| state\.authority\.graphics !== 'linear'/.test(script),
  'that freeze reads BOTH teams, so the lane closes itself at F1 rather than relying on the operator');

if (failures) {
  console.error(`\n${failures} B1 full-mode lane check(s) failed`);
  process.exit(1);
}
console.log('\nB1 full-mode lane checks passed');
