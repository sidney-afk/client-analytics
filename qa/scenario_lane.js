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

/* CAN THE SCENARIO HARNESS DRIVE THE NATIVE LANE AT ALL? Today: no.
 *
 * `qa/scenario_engine.js` seeds only fake `linear_issue_id` / `graphic_linear_issue_id`
 * values. It installs no `stubNativeWorkItems`, no `stubNativeGateway` and no verified staff
 * identity — grep it for any of the three and the count is zero. On the native lane every
 * status and comment action would therefore refuse with `native_link_required` or
 * `credentials_required` before the journey it is testing ever runs.
 *
 * So routing the 80 scenarios that carry no Linear assertion to production would not give
 * them better coverage; it would turn the whole samples nightly red before any of them
 * asserted anything. Codex finding on a1b6d60, and it is the correction to the previous
 * round: the rule below is right, and applying it was premature.
 *
 * WHAT FLIPS THIS. Seed native work items in the scenario fixtures, capture the gateway, and
 * seed a verified staff identity — the same three things `qa/native_work_item_fixture.js`
 * already does for p28/p29/p30/p36/p60. Then set this to `true` and `scenarioUsesLegacyLane`
 * takes over, putting exactly the 4 of 84 that assert on the retired lane there and the other
 * 80 on the lane production takes. The selector is written and tested against the real data
 * so that migration is a one-line flip here, not a re-derivation.
 *
 * Tracked in OPEN_REPAIRS 175 with the rest of the owed harness migrations. */
const SCENARIO_HARNESS_CAN_DRIVE_NATIVE = false;

/* The RULE: does this scenario assert on the retired lane? */
function scenarioUsesLegacyLane(scn) {
  let text = '';
  try { text = JSON.stringify(scn && scn.steps ? scn.steps : scn); }
  catch (e) { return false; }
  return LEGACY_LANE_VERB.test(text || '');
}

/* What the engine actually asks for, which is the rule OR the harness limit above. Kept
   separate from the rule so the limit is visible as a limit rather than baked into a
   predicate that would then quietly lie about why a scenario is on the legacy lane. */
function scenarioLaneIsLegacy(scn) {
  return !SCENARIO_HARNESS_CAN_DRIVE_NATIVE || scenarioUsesLegacyLane(scn);
}

module.exports = {
  scenarioUsesLegacyLane,
  scenarioLaneIsLegacy,
  SCENARIO_HARNESS_CAN_DRIVE_NATIVE,
  LEGACY_LANE_VERB
};
