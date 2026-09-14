/*
 * ONE place that answers a `/webhook/linear-*` route inside a probe.
 *
 * WHY THIS FILE EXISTS. `qa/sxr_courier_lib.js` honours SYNCVIEW_QA_LINEAR_DEAD
 * and inverts every Linear webhook into a refusal/502/504/ok-lie rotation, which
 * is what makes the "Linear is dead" rehearsal mean anything. Four probes
 * (p28/p29/p30/p36) registered their OWN Playwright route for the same webhook
 * pattern and fulfilled `200 {"ok":true}` unconditionally, and a later-registered
 * route wins. (The pattern is deliberately NOT written literally here: the
 * detector in test/linear-dead-rehearsal.js scans this directory for it, and a
 * comment quoting it would report this file as a bypass, which is the opposite
 * of what it is.) So a full-manifest run with dead mode ON exercised a
 * HEALTHY Linear for exactly the status-and-comment write flows the rehearsal
 * most needs to watch die (Codex on PR #1350, F1).
 *
 * Those probes still need to RECORD the calls they intercept, which is why they
 * cannot simply drop their own route and inherit the library's. They can share
 * the answer, and this is it.
 *
 * The fault rotation is per-probe-process, which matches how the library scopes
 * it: a probe asserts on the shapes ITS run was given, not on a global sequence.
 */
const { LINEAR_DEAD, linearDeadShapeFor, linearDeadResponseFor } = require('../sxr_courier_lib.js');

const HEALTHY = Object.freeze({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
let index = 0;

/** Reset the rotation. Call between phases when a probe asserts on exact shapes. */
function resetLinearHookRotation() { index = 0; }

/**
 * Answer one intercepted Linear webhook route the way the current mode demands.
 * Healthy mode is the historical `200 {"ok":true}`, byte for byte, so a probe
 * that was green before this file existed stays green for the same reason.
 */
async function fulfilLinearHook(route) {
  if (!LINEAR_DEAD) return route.fulfill(HEALTHY);
  const response = linearDeadResponseFor(linearDeadShapeFor(index++));
  // null is "connection refused" — an abort, not a fulfil. A probe that treats
  // an aborted request as a 200 would report the opposite of what happened.
  return response === null ? route.abort('connectionrefused') : route.fulfill(response);
}

module.exports = { fulfilLinearHook, resetLinearHookRotation, LINEAR_DEAD };
