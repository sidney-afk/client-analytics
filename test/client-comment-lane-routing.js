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
 *
 * THE RETRY-LANE GAP (amendment, 2026-08-14). The routing fix alone had a
 * second-order hole: when a client comment's legacy send fails TRANSIENTLY it
 * is enqueued for retry (_linearOutboxEnqueue / _sxrLinearOutboxEnqueue, kind
 * 'comment'), and the drain re-derives the lane from ENROLLMENT:
 *
 *     it.transport === 'legacy_n8n'
 *         && (it.source_gate || !_writeUiRerouteUseGateway(it.client_slug))
 *
 * A client-originated item has no source_gate, and an enrolled slug makes the
 * second disjunct false — so the item skipped the n8n branch and fell through
 * to the 'legacy_actor_unverifiable' quarantine with ZERO retry attempts,
 * while an unenrolled client's identical item got its full retry budget. The
 * amendment stamps every enqueued item with `client_link: true` when the tab
 * is a client link (inside the two enqueue functions, so every call site a
 * client can reach is covered), and both drains admit `it.client_link` items.
 *
 * SECURITY: the quarantine exists to stop enrolled STAFF writes sneaking down
 * the legacy lane. A client_link-stamped item is precisely the traffic the
 * routing fix deliberately sends legacy on the FIRST attempt, so honoring the
 * stamp on retry changes the lane of nothing and preserves the property. The
 * checks below prove the staff item is STILL refused by the branch.
 */
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');

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

// --- 4. RETRY LANE: a client comment that failed transiently keeps its lane -
/* Behavioral, not just textual: the real enqueue functions are extracted and
 * executed, the real drain branch conditions are extracted and evaluated
 * against a localStorage-shaped (JSON round-tripped) item. F64: the enrolled
 * slug below is FAKE ('enrolledclient') — never a real client slug. */

function extract(name) {
  const marker = 'function ' + name + '(';
  let start = app.indexOf(marker);
  if (start < 0) throw new Error('missing ' + name);
  if (app.slice(start - 6, start) === 'async ') start -= 6;
  const brace = app.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let index = brace; index < app.length; index++) {
    const ch = app[index], next = app[index + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; index++; } continue; }
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; index++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; index++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return app.slice(start, index + 1);
  }
  throw new Error('unclosed ' + name);
}

// 4a. Both enqueue functions stamp the client principal — executed for real.
async function runEnqueue(fnName, scheduleName, isClientLink) {
  const captured = [];
  const context = vm.createContext({
    _isClientLink: isClientLink,
    _writeUiLegacyAppendOutboxItem: async (surface, record) => { captured.push({ surface, record }); },
    [scheduleName]: () => {},
  });
  vm.runInContext(extract(fnName), context);
  await context[fnName]('comment', { issue: 'https://example.invalid/i/1', body: 'x' }, 'http 502', 'enrolledclient');
  if (captured.length !== 1) throw new Error(fnName + ' did not append exactly one item');
  return captured[0];
}

(async () => {
  for (const [fnName, scheduleName, surface] of [
    ['_linearOutboxEnqueue', '_linearOutboxScheduleRetry', 'calendar'],
    ['_sxrLinearOutboxEnqueue', '_sxrLinearOutboxScheduleRetry', 'sxr'],
  ]) {
    const clientSide = await runEnqueue(fnName, scheduleName, true);
    ok(clientSide.surface === surface && clientSide.record.client_link === true,
      `${fnName}: a CLIENT-tab enqueue stamps client_link:true`);
    ok(clientSide.record.transport === 'legacy_n8n'
        && clientSide.record.client_slug === 'enrolledclient'
        && clientSide.record.kind === 'comment',
      `${fnName}: transport/slug/kind are unchanged by the stamp`);
    const staffSide = await runEnqueue(fnName, scheduleName, false);
    ok(!staffSide.record.client_link,
      `${fnName}: a STAFF-tab enqueue does NOT carry the client stamp`);
  }

  // 4b. Both drain branch conditions, extracted verbatim and evaluated.
  const branchRe = /if \(it && it\.transport === 'legacy_n8n'\s+&& \(([\s\S]*?)\)\) \{/g;
  const conditions = [];
  let match;
  while ((match = branchRe.exec(app)) !== null) conditions.push(match[1]);
  ok(conditions.length === 2,
    `exactly two legacy-n8n drain branches exist (calendar + sxr); found ${conditions.length}`);
  ok(conditions.every(c => /it\.client_link/.test(c) && /it\.source_gate/.test(c)
      && /!_writeUiRerouteUseGateway\(it\.client_slug\)/.test(c)),
    'both drain conditions keep all three disjuncts: source_gate, client_link, unenrolled');

  // The item exactly as the drain will see it after a page reload: what the
  // client-tab enqueue wrote, persisted through localStorage-shaped JSON.
  const persisted = JSON.parse(JSON.stringify(
    (await runEnqueue('_linearOutboxEnqueue', '_linearOutboxScheduleRetry', true)).record));
  ok(persisted.client_link === true && !persisted.source_gate && persisted.attempts === 0,
    'the stamp survives the localStorage JSON round trip; the item is gate-less');

  const enrolled = slug => slug === 'enrolledclient';
  const unenrolled = () => false;
  conditions.forEach((cond, index) => {
    const label = index === 0 ? 'calendar drain' : 'sxr drain';
    const admits = new Function('it', '_writeUiRerouteUseGateway',
      `return !!(it && it.transport === 'legacy_n8n' && (${cond}));`);
    ok(admits(persisted, enrolled) === true,
      `${label}: admits the ENROLLED client's gate-less comment — full retries, not zero-retry quarantine`);
    const staffItem = { transport: 'legacy_n8n', kind: 'comment', client_slug: 'enrolledclient', attempts: 0 };
    ok(admits(staffItem, enrolled) === false,
      `${label}: STILL refuses an enrolled STAFF item — the quarantine's security property holds`);
    ok(admits(staffItem, unenrolled) === true,
      `${label}: an UNENROLLED item still drains legacy exactly as before`);
    ok(admits({ ...staffItem, source_gate: { comment_id: 'x' } }, enrolled) === true,
      `${label}: a source-gated item is still admitted exactly as before`);
  });

  // 4c. Source pin on the stamping itself (mutation guard: deleting either
  // stamp fails here even if the harness above ever goes stale).
  const stamps = app.match(/client_link: _isClientLink === true/g) || [];
  ok(stamps.length === 2, `both enqueue functions carry the literal stamp; found ${stamps.length}`);

  if (failures) {
    console.error(`\n${failures} client-comment lane-routing check(s) failed`);
    process.exit(1);
  }
  console.log('\nclient-comment lane-routing checks passed');
})().catch(error => {
  console.error('FAIL  retry-lane harness crashed: ' + (error && error.stack || error));
  process.exit(1);
});
