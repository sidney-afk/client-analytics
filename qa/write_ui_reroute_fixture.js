'use strict';
/*
 * THE ONE PLACE THE HARNESSES SAY WHICH LANE PRODUCTION TAKES.
 *
 * Until 2026-09-08 all three browser harnesses -- `qa/probes/lib.js`,
 * `qa/sxr_courier_lib.js` and `qa/golden_lib.js` -- answered the
 * `write_ui_reroute_clients` flag read with HTTP 200 and `[]`, and each said in
 * as many words that this was the FAITHFUL simulation because "real clients run
 * the legacy lane".
 *
 * That claim is false, and measurably so. Read against the live flag on
 * 2026-09-07 (OPEN_REPAIRS 175): the allowlist holds 43 slugs, `clients` holds
 * 43 active rows, and the two sets match exactly -- no active client is
 * unenrolled and no enrolled slug lacks a row. Every real client takes the
 * native gateway. Both teams are SyncView-authoritative besides (graphics
 * 2026-08-16, video 2026-08-28), so the legacy webhooks the probes mocked are
 * not a lane production reaches for a status change at all.
 *
 * So the nightly was green about a world that no longer exists. That is the
 * exact shape of OPEN_REPAIRS 177 -- a unit test asserting the OLD behaviour,
 * nine green checks, and a Workload board down for every editor -- caught here
 * before it shipped rather than after.
 *
 * IT ALSO STOPPED WORKING MECHANICALLY, which is why this could not be left for
 * later. After the fail-closed repair (OPEN_REPAIRS 175, extended 2026-09-08) a
 * SUCCESSFUL read that yields no usable roster is no longer read as "nobody is
 * enrolled" when ROUTING a live write; it is read as "this roster cannot be
 * trusted", and the write goes native. `[]` therefore no longer buys a legacy
 * lane. It buys the native lane with a comment above it claiming the opposite,
 * which is strictly worse than either honest answer.
 *
 * WHAT THIS SERVES INSTEAD: what the live flag serves for the TEST client --
 * enrolled. It stays a pinned stub rather than a live read so a nightly cannot
 * change lanes underneath itself the moment the owner edits the roster;
 * `qa/probes/p95_write_ui_test_guard.js` opts into the genuinely live flag to
 * pin the roster's real contents.
 *
 * THE HALF THIS DOES NOT FIX, stated here because the next reader will hit it:
 * on the native lane a card needs a native work item. `_writeUiClassifyTargetless`
 * refuses a targetless card with `native_link_required` whenever its team is
 * SyncView-authoritative -- which both now are -- and NO probe seeds
 * `video_deliverable_id` / `graphic_deliverable_id`. Real cards carry one;
 * these fixtures do not, so they are still not production-shaped. Closing that
 * means minting real deliverables for the seeds, against the live backend.
 * Tracked in OPEN_REPAIRS 175. Do not "fix" a resulting refusal by putting the
 * roster back to `[]`: that restores the green, and the green was the defect.
 *
 * Only slugs appear here. The repository is public.
 */

/* The TEST client the probes drive. A slug, never a display name. */
const WRITE_UI_REROUTE_TEST_CLIENT = 'sidneylaruel';

/* THE READ FETCHES TWO KEYS, SO THE ANSWER HAS TO CARRY TWO ROWS.
 *
 * Codex finding, 2026-09-08. `_writeUiFetchRerouteFlagOnce` issues ONE request
 * for `key=in.(write_ui_reroute_clients,client_comment_gateway_enabled)` and
 * splits the rows itself. The first version of this fixture answered that
 * request with the reroute row alone, so `_clientCommentGatewaySetFlagValue`
 * received `null` on every harness run and the client-comment FRONT DOOR was
 * OFF — while production has it ON.
 *
 * That is the same defect as the `[]` roster it was written to repair, one flag
 * over: a harness answering a production read with a non-production body, so
 * eligible client comments exercised the legacy `linear-add-comment` fallback
 * instead of the shipped native path, and the nightly was green about a lane
 * the product does not take.
 *
 * Read live 2026-09-08, read-only with the browser publishable key:
 *   prod_authority                 {"video":"syncview","graphics":"syncview"}
 *   client_comment_gateway_enabled {"enabled":true}
 * The front door has been ON since the 2026-08-14 rollout (EXECUTION_LOG,
 * docs/ops/COMMENT_GATEWAY_ROLLOUT.md Step B, docs/truth/BRIEFING.md).
 *
 * Only the exact value `{"enabled": true}` opens the door, and the tab must
 * also be able to build a verified gateway context — so serving this does not
 * force every client comment native, it stops FORCING them legacy.
 *
 * Shaped exactly like the PostgREST rows the read consumes:
 * `select=key,value` over `syncview_runtime_flags`. */
const WRITE_UI_REROUTE_PRODUCTION_ROWS = [
  { key: 'write_ui_reroute_clients', value: { clients: [WRITE_UI_REROUTE_TEST_CLIENT] } },
  { key: 'client_comment_gateway_enabled', value: { enabled: true } }
];

/* THE EXPLICIT LEGACY ROSTER, for the lanes that are ABOUT the legacy write path.
 *
 * Codex finding on d6e26c3, and the alternative it offered to migrating them: changing this
 * shared route moved every consumer onto the native lane, including probes whose subject IS
 * the legacy lane — the outbox drain and its quarantine (OPEN_REPAIRS 63/175, deliberately
 * NOT flipped), and the ef-writepath "Pipe B" n8n push. Those probes do not time out because
 * they are stale; they time out because the harness stopped serving the world they test.
 * Recording them as owed does not keep the harness honest in the meantime.
 *
 * WHY IT IS NOT `[]`. Before this PR those lanes received `[]` and that meant legacy. After
 * the fail-closed repair a successful read with no usable roster routes NATIVE, so `[]` now
 * means the opposite of what it used to. The only honest way to ask for the legacy lane is a
 * roster that is perfectly USABLE and simply does not enrol this client — which is what this
 * serves, and it says so out loud instead of relying on a failure mode.
 *
 * This is NOT a second opinion about what production does. Production enrols all 43 active
 * clients; `productionRosterBody()` is the default and every lane that describes production
 * uses it. This is opt-in, per lane, for lanes that describe the legacy path on purpose, and
 * those lanes stay on the owed list in `test/probes-assert-native-write-lane.js` until they
 * are migrated for real.
 *
 * The comment-gateway row is served identically: the front door is a separate flag and is ON
 * in production either way. */
const WRITE_UI_REROUTE_LEGACY_ROWS = [
  { key: 'write_ui_reroute_clients', value: { clients: ['probelegacyroster'] } },
  { key: 'client_comment_gateway_enabled', value: { enabled: true } }
];

/* The body a lane serves when it is deliberately exercising the legacy path. */
function legacyRosterBody() {
  return JSON.stringify(WRITE_UI_REROUTE_LEGACY_ROWS);
}

const WRITE_UI_REROUTE_CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'cache-control': 'no-store'
};

/* The response body every harness serves for the flag read. */
function productionRosterBody() {
  return JSON.stringify(WRITE_UI_REROUTE_PRODUCTION_ROWS);
}

/* Does this URL look like the reroute flag read? Kept beside the body so a
   harness cannot match the request one way and answer it another. */
function isRerouteFlagRequest(url) {
  const s = String(url || '');
  return s.includes('syncview_runtime_flags') && s.includes('write_ui_reroute_clients');
}

module.exports = {
  WRITE_UI_REROUTE_TEST_CLIENT,
  WRITE_UI_REROUTE_PRODUCTION_ROWS,
  WRITE_UI_REROUTE_LEGACY_ROWS,
  WRITE_UI_REROUTE_CORS,
  productionRosterBody,
  legacyRosterBody,
  isRerouteFlagRequest
};
