'use strict';
/*
 * A CLIENT comment must never be sent to a door that is always locked.
 *
 * THE INCIDENT (2026-08-13). A wave-2 enrolled client could not leave a comment
 * on her review screen. The UI printed the gateway's raw refusal,
 * `comment_forbidden`, in red. Her requested change was lost: the card reached
 * "Tweaks Needed" carrying no client instructions at all, so the editor had
 * nothing to act on. It was reported by the client, through her SMM — not by
 * any test, alert, or health check we run.
 *
 * THE MECHANISM. `clientCommentTargetAllowed`
 * (supabase/functions/production-write/policy.mjs) authorizes a client comment
 * ONLY when every one of these holds:
 *
 *     surface === 'sxr'  AND  row.origin === 'samples'
 *     AND row.card_id is non-empty AND the request presents that same card_id
 *     AND the component maps to a team that matches the row's team
 *
 * Two live populations can never satisfy it:
 *
 *   1. Every comment from the CALENDAR review screen — the surface is
 *      'calendar', so the first clause fails before any data is consulted.
 *   2. Every comment on an UNLINKED samples thread — no card binding exists to
 *      send, so the card_id clauses fail. Three linked sample cards existed
 *      against 5,427 total when this was written, so "unlinked" is the normal
 *      case, not the edge case.
 *
 * WHY IT STAYED HIDDEN. Routing is decided by enrollment, not by principal: an
 * UNENROLLED client takes the legacy lane (which works), and only an enrolled
 * client reaches the gateway. So the defect shipped harmlessly and lay dormant
 * until wave-2 enrollment pointed four real clients at it. Nothing in the suite
 * exercised a CLIENT principal on either comment path — every existing test
 * covered staff — which is exactly why enrollment could arm a client-facing
 * outage without turning anything red.
 *
 * THE LINE THAT MUST NOT MOVE. These assertions pin BOTH halves, because either
 * one alone is a trap:
 *
 *   - the client-lane condition on both comment paths (regression guard), and
 *   - the server predicate's clauses (anti-weakening guard). The tempting
 *     "fix" is to relax `clientCommentTargetAllowed` so the rejected requests
 *     pass. That would let a client comment against a card binding nobody
 *     verified. The routing fix is correct precisely BECAUSE it changes no
 *     authorization: it only stops sending requests that are guaranteed 403s.
 */
const path = require('node:path');
const fs = require('node:fs');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const policy = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'production-write', 'policy.mjs'), 'utf8');

// --- 1. Both COMMENT paths route a client link to the legacy lane -----------
const calendarComment = app.slice(app.indexOf('async function _calPostLinearComment'));
const calendarHead = calendarComment.slice(0, calendarComment.indexOf('const url ='));
ok(/_writeUiUseGatewayWhenReady\('calendar', meta\)\)\s*\|\|\s*_isClientLink/.test(calendarHead),
  'calendar comment: a client link takes the legacy lane regardless of enrollment');

const sxrComment = app.slice(app.indexOf('const clientCanonicalWrite'));
const sxrHead = sxrComment.slice(0, sxrComment.indexOf('const url ='));
ok(/_writeUiUseGatewayWhenReady\('sxr', meta\)\)\s*\|\|\s*_isClientLink/.test(sxrHead),
  'samples comment: an UNLINKED client thread takes the legacy lane too');

/* The linked-thread branch supplies a verified card_id and is fail-closed by
 * design. Diverting it would silently downgrade an authenticated write, so the
 * fix must NOT have touched it. */
ok(/if \(clientCanonicalWrite\) \{[\s\S]{0,400}?canonical_comment_read_required/.test(sxrHead),
  'the LINKED client thread still fails closed on the gateway — not diverted');
ok(/clientSurface \? \{ card_id: clientSurface\.card_id \}/.test(sxrComment.slice(0, 6000)),
  'the linked thread still sends the verified card_id it was authorized against');

// --- 2. The fix is scoped to comments, not to every client write -----------
/* Status/approve travels a different gate (clientOperationAllowed) and WORKED
 * throughout the incident — the affected client approved a video minutes before
 * her comment failed. Diverting status too would have moved working traffic off
 * the gateway for no reason, losing the parity the enrollment exists to build. */
const calendarStatus = app.slice(app.indexOf('async function _calPushStatusToLinear'));
ok(!/_isClientLink/.test(calendarStatus.slice(0, calendarStatus.indexOf('const url ='))),
  'calendar STATUS push is untouched — it was never broken');
const sxrStatus = app.slice(app.indexOf('async function _sxrPushStatusToLinear'));
ok(!/_isClientLink/.test(sxrStatus.slice(0, sxrStatus.indexOf('const url ='))),
  'samples STATUS push is untouched — it was never broken');

// --- 3. ANTI-WEAKENING: the server predicate keeps every clause ------------
const predicate = policy.slice(policy.indexOf('export function clientCommentTargetAllowed'));
const body = predicate.slice(0, predicate.indexOf('\n}\n') + 3);
for (const [clause, why] of [
  [/lower\(surface\) === "sxr"/, 'still restricted to the samples surface'],
  [/lower\(row\.origin\) === "samples"/, 'still requires a samples-origin row'],
  [/!!targetCardId/, 'still requires the target to HAVE a card binding'],
  [/!!requestedCard/, 'still requires the caller to PRESENT a card id'],
  [/targetCardId === requestedCard/, 'still requires the two to match exactly'],
  [/normalizeTeam\(row\.team\) === expectedTeam/, 'still requires the component team to match'],
]) {
  ok(clause.test(body), `clientCommentTargetAllowed ${why}`);
}

if (failures) {
  console.error(`\n${failures} client-comment lane-routing check(s) failed`);
  process.exit(1);
}
console.log('\nclient-comment lane-routing checks passed');
