'use strict';

/*
 * A SUITE THAT SKIPS BY DEFAULT CAN SHIP BROKEN, AND NOBODY FINDS OUT UNTIL CI.
 *
 * Lane B shipped `test/native-label-writes.js` lifted from the integration
 * candidate without `qa/native-label-catalog/`, the harness it spawns. Locally
 * it printed `SKIP native label writes: explicit disposable PostgreSQL
 * required` and exited 0, so a full `npm test` was green. CI sets
 * `F63_REQUIRE_POSTGRES=1`, so there the same suite ran, could not find the
 * harness, and threw `native_labels_actual_lane_failed_private_evidence_
 * retained` — a message that names neither the missing file nor the reason.
 * (PR #1349, OPEN_REPAIRS 170.)
 *
 * The skip is correct and stays: those lanes must never touch a live backend,
 * and demanding an explicit disposable cluster is how that is enforced. What is
 * wrong is that the skip also hides a suite whose harness does not exist, and
 * six parallel sessions are lifting candidate tests right now.
 *
 * So: every path a top-level suite spawns or reads must exist, whatever the
 * gate would have decided. This is a spelling check on file paths, and it runs
 * with no database, no credentials and no gate.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const SELF = path.basename(__filename);

/* Path literals that a suite hands to spawnSync/readFileSync via path.join with
 * __dirname. Deliberately narrow: it matches the shape these suites actually
 * use, and a miss here is a missed guard, never a false alarm. */
const HARNESS = /path\.join\(\s*(__dirname|root|ROOT)\s*,\s*['"`]((?:\.\.\/)*(?:qa|scripts|migrations|docs|test|supabase)\/[^'"`]+)['"`]\s*\)/g;

/* Suites disagree about their base: some join from `__dirname` (test/), most
 * from a `root`/`ROOT` they set to the repository root. Resolving every path
 * against one of those reports the other's paths as missing, which is how the
 * first draft of this file produced 200 false alarms. */
function baseFor(name) {
  return name === '__dirname' ? __dirname : root;
}

let passed = 0;
const missing = [];

const suites = fs.readdirSync(__dirname)
  .filter(f => f.endsWith('.js') && f !== 'run-all.js' && f !== SELF)
  .sort();

for (const suite of suites) {
  const source = fs.readFileSync(path.join(__dirname, suite), 'utf8');
  const seen = new Set();
  for (const match of source.matchAll(HARNESS)) {
    const key = `${match[1]}|${match[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /* resolve exactly as the suite itself does */
    const resolved = path.resolve(baseFor(match[1]), match[2]);
    if (!fs.existsSync(resolved)) missing.push(`test/${suite} → ${path.relative(root, resolved)}`);
  }
}

assert.deepEqual(missing, [],
  'a suite names a harness that is not in the tree; a default skip would hide this until CI:\n  '
  + missing.join('\n  '));
passed += 1;
console.log(`OK  every harness path named by the ${suites.length} top-level suites exists`);

/* The guard has to be able to fail, or it is decoration. Rebuild the exact
 * shape of the defect against a path that is genuinely absent and confirm the
 * matcher catches it. */
{
  const probe = "const r = spawnSync(process.execPath, [path.join(__dirname, '../qa/not-a-real-harness/proof.mjs')]);";
  const found = [...probe.matchAll(HARNESS)];
  assert.equal(found.length, 1, 'the matcher no longer recognises the shape it was written for');
  assert.deepEqual([found[0][1], found[0][2]], ['__dirname', '../qa/not-a-real-harness/proof.mjs']);
  assert.equal(fs.existsSync(path.resolve(baseFor(found[0][1]), found[0][2])), false);
  passed += 1;
  console.log('OK  the matcher catches the exact shape that shipped, so this gate is measuring something');
}

/* And it must not have been satisfied by finding nothing to check. */
{
  let checked = 0;
  for (const suite of suites) {
    const source = fs.readFileSync(path.join(__dirname, suite), 'utf8');
    checked += new Set([...source.matchAll(HARNESS)].map(m => `${m[1]}|${m[2]}`)).size;
  }
  assert.ok(checked >= 10, `only ${checked} harness paths were checked; the matcher has probably stopped matching`);
  passed += 1;
  console.log(`OK  ${checked} harness paths across the suite set were actually resolved, not vacuously skipped`);
}

console.log(`\ngated-suites-have-their-harness: ${passed} passed, 0 failed ✅`);
