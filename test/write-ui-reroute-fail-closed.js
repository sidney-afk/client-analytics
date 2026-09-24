'use strict';
/*
 * The write-UI reroute flag now fails CLOSED against Linear.
 *
 * `_writeUiFetchRerouteFlagOnce` falls back to `{clients:[]}` on any failure
 * or on its two-second timeout, and sets `_writeUiRerouteFlagFailed`. Until
 * 2026-09-07 an empty allowlist meant one thing everywhere: legacy. So one
 * slow moment at boot sent EVERY client's status changes to
 * LINEAR_SET_STATUS_URL and every comment to LINEAR_ADD_COMMENT_URL, for as
 * long as that tab stayed open. The in-code comment called this
 * "fail-legacy, never fail-open".
 *
 * That was correct while Linear was the safe destination. After 2026-09-15 it
 * is exactly backwards: the legacy lane is a dead URL that fails silently,
 * while the native lane is an authority that can refuse out loud. AGENTS.md
 * already prefers that shape — "let the authority that can see it decide, and
 * make its refusal say something useful".
 *
 * THE INVERSION IS DELIBERATELY NARROW, and that is what most of this suite
 * pins. `_writeUiRerouteUseGateway` answers a FACTUAL question — is this slug
 * in the allowlist — and two kinds of caller need exactly that answer:
 *
 *   • the outbox drain, where a genuinely unenrolled client's legacy item is
 *     legitimate traffic. Flipping its answer would quarantine those items as
 *     `legacy_actor_unverifiable`, which is the item-63 defect rebuilt.
 *   • the project-source filter, which is describing enrollment, not routing.
 *
 * Only the two "when ready" helpers that gate a LIVE write were moved onto
 * `_writeUiRerouteUseGatewayFailClosed`. A future edit that widens the flip to
 * the drain fails here.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

function grabFunc(name) {
  const at = INDEX.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\('));
  if (at < 0) throw new Error('function not found: ' + name);
  let depth = 0, quote = '', escaped = false, comment = '';
  for (let j = INDEX.indexOf('{', at); j < INDEX.length; j++) {
    const c = INDEX[j], next = INDEX[j + 1];
    if (comment) {
      if (comment === 'line' && c === '\n') comment = '';
      else if (comment === 'block' && c === '*' && next === '/') { comment = ''; j++; }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '/' && next === '/') { comment = 'line'; j++; continue; }
    if (c === '/' && next === '*') { comment = 'block'; j++; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return INDEX.slice(at, j + 1); }
  }
  throw new Error('unclosed ' + name);
}

/* Run the two real predicates over a controlled allowlist + failure flag.
 *
 * 2026-09-08 (Codex finding 1): the routing predicate reads a SECOND signal,
 * `_writeUiRerouteRosterUnusable` — "the read landed but carried no usable
 * roster" — because item 175 covered only the read that never landed. Its
 * default here derives from the two arguments the scenarios below already pass,
 * so every one of them keeps meaning exactly what it meant: a failed read is
 * unusable, and so is an empty allowlist reached any other way. Behaviour of
 * the new signal is proved by execution in
 * test/write-ui-reroute-usable-roster.js; this suite stays about the NARROWNESS
 * of the flip. */
function evaluate(enrolledSlugs, flagFailed, rosterUnusable) {
  const sandbox = {
    console, String, Array, Set, Error,
    _writeUiRerouteClients: new Set(enrolledSlugs),
    _writeUiRerouteFlagFailed: flagFailed,
    _writeUiRerouteRosterUnusable: typeof rosterUnusable === 'boolean'
      ? rosterUnusable
      : (flagFailed || enrolledSlugs.length === 0),
    // The real calClientSlug is a large shared helper; the predicate falls
    // back to this exact normalisation when it throws, so force that path.
    calClientSlug: function () { throw new Error('not available in this harness'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(grabFunc('_writeUiRerouteUseGateway') + '\n'
    + grabFunc('_writeUiRerouteUseGatewayFailClosed'), sandbox);
  return sandbox;
}

/* ---- 1. Healthy flag: nothing about routing changes -------------------- */

const healthy = evaluate(['enrolledclient'], false);
ok(healthy._writeUiRerouteUseGatewayFailClosed('enrolledclient') === true,
  'flag read OK + enrolled client routes native, exactly as before');
ok(healthy._writeUiRerouteUseGatewayFailClosed('someoneelse') === false,
  'flag read OK + unenrolled client still routes legacy — enrollment is still respected');
ok(healthy._writeUiRerouteUseGateway('someoneelse') === false
  && healthy._writeUiRerouteUseGateway('enrolledclient') === true,
  'and the factual predicate is unchanged on the healthy path');

/* ---- 2. Failed flag read: THE INVERSION ------------------------------- */

const failed = evaluate([], true);
ok(failed._writeUiRerouteUseGatewayFailClosed('anyclient') === true,
  'flag read FAILED routes native — the dead Linear webhook is no longer the fallback destination');
ok(failed._writeUiRerouteUseGateway('anyclient') === false,
  'COUNTEREXAMPLE: the old predicate answers false on the same state, which is the branch that sent '
  + 'status changes to LINEAR_SET_STATUS_URL and comments to LINEAR_ADD_COMMENT_URL');
ok(failed._writeUiRerouteUseGatewayFailClosed('') === true,
  'and it holds even for an empty slug, so a missing selection cannot slip back onto the legacy lane');

/* A failure that later heals must go straight back to honouring the allowlist:
   the heal path clears the flag, and nothing may latch. */
const healed = evaluate(['enrolledclient'], false);
ok(healed._writeUiRerouteUseGatewayFailClosed('someoneelse') === false,
  'a healed flag returns to the allowlist answer — the native override does not latch');

/* ---- 3. THE NARROWNESS. This is the part that must not drift. --------- */

const whenReady = grabFunc('_writeUiRerouteUseGatewayWhenReady');
const useGatewayWhenReady = grabFunc('_writeUiUseGatewayWhenReady');
ok(/_writeUiRerouteUseGatewayFailClosed\(/.test(whenReady),
  '_writeUiRerouteUseGatewayWhenReady (Submit routing) reads the fail-closed predicate');
ok(/_writeUiRerouteUseGatewayFailClosed\(/.test(useGatewayWhenReady),
  '_writeUiUseGatewayWhenReady (status + comment routing) reads the fail-closed predicate');

/* REWRITTEN 2026-09-22 (OPEN_REPAIRS 239). The two drain sites that negated
   the predicate lived in the legacy delivery branch, deciding whether a queued
   item was deliberately-legacy traffic owed full retries or an enrolled write
   sneaking down the lane. That branch is retired: a `legacy_n8n` row is
   dropped before any predicate is consulted, so there is no routing decision
   left to keep factual and item 63 cannot be rebuilt through it. Pinned as
   the absence, with the drop that replaced it. */
const drainSites = INDEX.split('\n')
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(r => /!_writeUiRerouteUseGateway/.test(r.line));
ok(drainSites.length === 0,
  'no outbox-drain call site negates the predicate any more — the branch that did is retired');
ok((INDEX.match(/if \(it && it\.transport === 'legacy_n8n'\) continue;/g) || []).length === 2,
  'both drains drop the retired transport outright instead, calendar and samples');

// The Submit dropdown keeps the FACTUAL predicate for a usable roster, and
// only when the roster read failed or landed unusable does it list every
// native client -- the same set the fail-closed router would send natively.
const rebuild = INDEX.split('\n').filter(l => /\.filter\(row => failNative \|\| _writeUiRerouteUseGateway\(/.test(l));
ok(rebuild.length === 1 && !/FailClosed/.test(rebuild[0]),
  'the project-source enrollment filter keeps the factual predicate, overridden only by the explicit failed-roster fallback');

/* ---- 4. The stale comment is gone --------------------------------------- */

/* The phrase may survive ONCE, quoted as history inside the correction that
   explains it — that is how the next reader learns the rule changed. What must
   not survive is the phrase standing alone as a live description. */
const staleClaim = INDEX.split('\n').filter(l => /fail-legacy, never fail-open/.test(l));
ok(staleClaim.length > 0 && staleClaim.every(l => /"fail-legacy, never fail-open"/.test(l)),
  'every surviving mention of "fail-legacy, never fail-open" is a QUOTED citation, never an unquoted '
  + 'statement of what the code does now');
ok(/was correct while Linear was the safe/.test(INDEX)
  && /(backwards once it is not|is exactly backwards)/.test(INDEX),
  'and each citation is immediately followed by why it no longer holds, so a reader cannot take it as current');
ok(/_writeUiRerouteUseGatewayFailClosed/.test(INDEX)
  && /fails? CLOSED against Linear/i.test(INDEX),
  'and the new behaviour is stated at the predicate, where the next reader will be');

/* ---- 5. No-Supabase-config is NOT the failure case ---------------------- */
/* Without CAL_SUPABASE_URL the native gateway is unreachable too, so that
   early return deliberately does not set the failed flag: legacy is the only
   lane that could work there. Flipping it would route into nothing. */
const fetchOnce = grabFunc('_writeUiFetchRerouteFlagOnce');
const earlyReturn = fetchOnce.slice(0, fetchOnce.indexOf('AbortController'));
ok(/CAL_SUPABASE_URL/.test(earlyReturn) && !/_writeUiRerouteFlagFailed\s*=\s*true/.test(earlyReturn),
  'the missing-Supabase-config path does NOT mark the flag failed, so it stays on the only lane that can work');

console.log(`\nwrite-ui-reroute-fail-closed: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
process.exit(failures ? 1 : 0);
