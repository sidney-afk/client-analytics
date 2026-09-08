'use strict';
/*
 * WHICH WRITE LANE DOES ONE SCENARIO NEED?
 *
 * Split out of `qa/scenario_engine.js` so a unit suite can check this rule without loading a
 * browser harness. `scenario_engine` requires `qa/sxr_courier_lib.js`, which resolves
 * Playwright, shells out to curl, and creates a temp directory at module load — none of which
 * a pure predicate needs, and all of which are ways for an offline suite to fail for reasons
 * that have nothing to do with the thing it is testing. `test/probes-assert-native-write-lane.js`
 * requires THIS file and the two data modules, and touches none of that.
 *
 * THE RULE. A scenario needs the LEGACY roster only if it asserts on the retired webhooks —
 * `expectLinear` (a push happened) or `expectNoLinear` (none did; on the native lane that
 * would pass vacuously, so the scenario keeps the world its assertion was written against).
 *
 * Measured 2026-09-08: 4 of the 84 base scenarios, and 0 of the 12 compiled tree paths. The
 * first version of this wiring put ALL of them on the retired lane because the DSL merely HAS
 * the verb, so 80 ordinary approve/request/comment journeys stopped exercising the route
 * production clients take — green coverage that no longer covers the shipped lane, which is
 * the defect this whole change set exists to remove, inverted. Codex finding on 638ff37.
 *
 * The default is PRODUCTION. A scenario that cannot be read, or carries no steps, gets the
 * lane real clients take: its Linear assertion then fails loudly, rather than a native
 * regression hiding behind a green legacy run.
 */

const LEGACY_LANE_VERB = /expectLinear|expectNoLinear/;

function scenarioUsesLegacyLane(scn) {
  let text = '';
  try { text = JSON.stringify(scn && scn.steps ? scn.steps : scn); }
  catch (e) { return false; }
  return LEGACY_LANE_VERB.test(text || '');
}

module.exports = { scenarioUsesLegacyLane, LEGACY_LANE_VERB };
