'use strict';
/*
 * THE NIGHTLY MUST EXERCISE THE LANE PRODUCTION TAKES.
 *
 * OPEN_REPAIRS 177: a lane shipped a change whose unit test asserted the OLD
 * behaviour was correct. Nine green checks, and the Workload board went down
 * for every editor, because the test described a world that no longer existed.
 *
 * This is the same shape, one layer out. Four browser harnesses --
 * `qa/probes/lib.js`, `qa/sxr_courier_lib.js`, `qa/golden_lib.js` and
 * `qa/ef-writepath/lib.js` -- answered the `write_ui_reroute_clients` flag read
 * with HTTP 200 and `[]`, each stating that this was FAITHFUL because "real
 * clients run the legacy lane". Measured against the live flag on 2026-09-07
 * (OPEN_REPAIRS 175) all 43 active clients are enrolled, and both teams are
 * SyncView-authoritative. Real clients take the native gateway. So a green
 * nightly covered mocked Linear writes on a lane production does not use.
 *
 * NOTHING IN THE NIGHTLY COULD CATCH THAT, because the nightly was the thing
 * that was wrong. It needs a check that runs where the claim is made, offline,
 * in CI, on every pull request -- which is here.
 *
 * The strong check is the last one: it lifts the SHIPPED routing predicates out
 * of `index.html`, feeds them the bytes the harness actually serves, and
 * asserts the harness puts the TEST client on the same lane production puts a
 * real one. That fails for `[]`, and it fails for any future body that stops
 * describing production -- including one that looks enrolled but is shaped
 * wrong. Grepping for the old comment alone would not have survived a reword.
 *
 * Only slugs appear here. The repository is public.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const FIXTURE = require(path.join(ROOT, 'qa', 'write_ui_reroute_fixture.js'));

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

/* Same brace-matching lift the sibling reroute suites use, so these run the
   shipped source rather than a copy that can drift. */
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

const HARNESSES = [
  'qa/probes/lib.js',
  'qa/sxr_courier_lib.js',
  'qa/golden_lib.js',
  'qa/ef-writepath/lib.js'
];

/* ---- 1. Every harness that answers the flag read uses the one fixture ---- */

const sources = new Map();
for (const rel of HARNESSES) {
  const abs = path.join(ROOT, rel);
  ok(fs.existsSync(abs), rel + ' exists');
  sources.set(rel, fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '');
}

for (const [rel, src] of sources) {
  ok(/write_ui_reroute_fixture/.test(src),
    rel + ' answers the reroute flag read from the shared fixture, not a body of its own');
  ok(/productionRosterBody\(\)/.test(src),
    rel + ' serves productionRosterBody() — one place decides which lane the nightly runs');
}

/* The literal that used to be served. A harness may not go back to it, under
   any comment. This is the cheap check; check 4 is the one that cannot be
   talked around. */
for (const [rel, src] of sources) {
  const emptyBody = src.split('\n')
    .filter(l => /body:\s*'\[\]'/.test(l) || /body:\s*"\[\]"/.test(l));
  ok(emptyBody.length === 0,
    rel + ' never fulfils a flag read with an empty roster body');
}

/* ---- 2. The false claim is gone as a live statement ---------------------- */
/* It may survive quoted, inside the correction that explains why it was wrong
   — that is how the next reader learns the rule changed. What must not survive
   is the sentence standing alone as a description of what the harness does. */

let liveClaims = 0;
for (const [rel, src] of sources) {
  src.split('\n').forEach((line, i) => {
    if (!/real clients (run|use)[^.]{0,25}legacy/i.test(line)) return;
    const corrected = /false|they do not|used to|no longer|claim/i.test(line)
      || /false|they do not|no longer/i.test(src.split('\n').slice(i, i + 4).join(' '));
    if (!corrected) { liveClaims++; console.error('      ' + rel + ':' + (i + 1)); }
  });
}
ok(liveClaims === 0,
  'no harness still states "real clients run the legacy lane" as current fact');

/* ---- 3. The fixture describes production, not an empty roster ------------ */

const rows = FIXTURE.WRITE_UI_REROUTE_PRODUCTION_ROWS;
ok(Array.isArray(rows) && rows.length >= 1, 'the fixture serves at least one flag row');
const rerouteRow = rows.find(r => r && r.key === 'write_ui_reroute_clients') || null;
ok(!!rerouteRow, 'the fixture carries the write_ui_reroute_clients key itself — a missing key is '
  + 'one of the three states that used to read as "nobody enrolled"');
ok(!!rerouteRow && Array.isArray(rerouteRow.value && rerouteRow.value.clients)
  && rerouteRow.value.clients.length > 0,
  'and its roster is non-empty, so the harness is not back to describing an empty allowlist');
ok(JSON.parse(FIXTURE.productionRosterBody()).length === rows.length,
  'the served body is the same rows the fixture declares');
/* ---- 3b. AND IT CARRIES THE SECOND FLAG THAT READ FETCHES --------------- */
/* Codex finding, 2026-09-08. The priming read asks for TWO keys in one request
   and splits the rows itself, so a reply carrying only the reroute row is a
   reply that says `client_comment_gateway_enabled` is absent — and absent is
   OFF. Every harness therefore ran with the client-comment front door shut
   while production has had it open since 2026-08-14, which put eligible client
   comments on the legacy `linear-add-comment` fallback in the nightly and on
   the native gateway in production. Same defect as the `[]` roster, one flag
   over. Every check below fails against the reroute-row-only fixture. */

const gatewayRow = rows.find(r => r && r.key === 'client_comment_gateway_enabled') || null;
ok(!!gatewayRow,
  'the fixture carries the client_comment_gateway_enabled row too — the read asks for both keys '
  + 'in one request, so a one-row answer states the second flag is absent');

/* Judged by the SHIPPED predicate, not by eyeballing the literal: only the
   exact value `{"enabled": true}` opens the door, and this is the function that
   decides. */
const gatewaySandbox = { console, Array, Boolean, String, _calV2Log: function () {}, _clientCommentGatewayEnabled: null };
vm.createContext(gatewaySandbox);
vm.runInContext(
  grabFunc('_clientCommentGatewaySetFlagValue') + '\n'
  + grabFunc('_clientCommentGatewayOn'), gatewaySandbox);

function frontDoorForBody(bodyText) {
  const list = JSON.parse(bodyText);
  const row = list.find(r => r && r.key === 'client_comment_gateway_enabled') || null;
  gatewaySandbox._clientCommentGatewaySetFlagValue(row && row.value ? row.value : null);
  return gatewaySandbox._clientCommentGatewayOn();
}

ok(frontDoorForBody(FIXTURE.productionRosterBody()) === true,
  'the body the harnesses serve opens the client-comment FRONT DOOR, which is what production '
  + 'has had open since the 2026-08-14 rollout');
ok(frontDoorForBody(JSON.stringify([rerouteRow])) === false,
  '  · COUNTEREXAMPLE: the reroute row on its own leaves it shut — the exact state every harness '
  + 'was in, and the reason a client comment there took the legacy lane');

ok(FIXTURE.isRerouteFlagRequest('https://x/rest/v1/syncview_runtime_flags?key=in.(write_ui_reroute_clients)')
  && !FIXTURE.isRerouteFlagRequest('https://x/rest/v1/syncview_runtime_flags?key=eq.calendar_upsert_ef_clients'),
  'the fixture matches the reroute flag read and leaves every other runtime flag live');

/* ---- 4. THE ONE THAT MATTERS ------------------------------------------- */
/* Run the SHIPPED read + predicates over the bytes the harness serves, and ask
   the question the nightly is actually answering: which lane does the TEST
   client take here? It must be the lane a real client takes — native. */

function laneForHarnessBody(bodyText) {
  const sandbox = {
    console, String, Array, Set, Error, JSON, Boolean,
    _writeUiRerouteClients: new Set(),
    _writeUiRerouteFlagFailed: false,
    _writeUiRerouteRosterUnusable: true,
    _calV2Log: function () {},
    _linearRefreshProjectsForRerouteChange: function () { return Promise.resolve(); },
    Promise,
    calClientSlug: function () { throw new Error('not available in this harness'); }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    grabFunc('_calRuntimeFlagSlug') + '\n'
    + grabFunc('_calRuntimeFlagRawMembers') + '\n'
    + grabFunc('_calRuntimeFlagClients') + '\n'
    + grabFunc('_writeUiRerouteRosterUsable') + '\n'
    + grabFunc('_writeUiSetRerouteFlagValue') + '\n'
    + grabFunc('_writeUiRerouteUseGateway') + '\n'
    + grabFunc('_writeUiRerouteUseGatewayFailClosed'), sandbox);

  /* Replay exactly what `_writeUiFetchRerouteFlagOnce` does with a 200 body:
     find the row, apply its value to the allowlist, clear the failed mark, and
     set usability from the row. */
  const list = JSON.parse(bodyText);
  const row = list.find(r => r && r.key === 'write_ui_reroute_clients') || null;
  sandbox._writeUiSetRerouteFlagValue(row && row.value ? row.value : { clients: [] });
  sandbox._writeUiRerouteFlagFailed = false;
  sandbox._writeUiRerouteRosterUnusable = !sandbox._writeUiRerouteRosterUsable(row);
  return {
    native: sandbox._writeUiRerouteUseGatewayFailClosed(FIXTURE.WRITE_UI_REROUTE_TEST_CLIENT),
    enrolled: sandbox._writeUiRerouteUseGateway(FIXTURE.WRITE_UI_REROUTE_TEST_CLIENT)
  };
}

const served = laneForHarnessBody(FIXTURE.productionRosterBody());
ok(served.native === true,
  'the body the harnesses serve routes the TEST client to the NATIVE gateway — the lane every '
  + 'one of the 43 enrolled clients takes in production');
ok(served.enrolled === true,
  'and it does so by ENROLLMENT, not by the fail-closed fallback: the harness is production, '
  + 'not a flag outage dressed up as one');

/* ---- 4b. THE EXPLICIT LEGACY BODY, PROVED THE SAME WAY -------------------- */
/* Codex on d6e26c3: switching the shared route moved lanes whose SUBJECT is the
   legacy path onto the native lane. The alternative it offered — an explicit
   legacy fixture for exactly those lanes — is only honest if the body actually
   selects the lane it claims. So it is judged by the SHIPPED predicates, like
   the production body above, rather than by reading the literal.

   The distinction that matters: it must route legacy by ENROLLMENT (a usable
   roster this client is simply not in), never by the fail-closed fallback. `[]`
   would be the fallback, and after the item-175 repair the fallback goes
   NATIVE — the opposite of what `[]` used to mean, which is the whole reason
   this fixture exists instead of the old one. */

const legacy = laneForHarnessBody(FIXTURE.legacyRosterBody());
ok(legacy.native === false,
  'the explicit legacy body routes the TEST client to the LEGACY lane, which is what a lane '
  + 'exercising the outbox drain or the ef-writepath Pipe B push needs');
ok(legacy.enrolled === false,
  '  · by ENROLLMENT — the roster is usable and simply does not name this client');
ok(FIXTURE.legacyRosterBody() !== FIXTURE.productionRosterBody(),
  '  · and it is a different body from the production one, so a lane cannot get legacy by '
  + 'accident');
ok(frontDoorForBody(FIXTURE.legacyRosterBody()) === true,
  '  · while the client-comment front door stays ON, because that is a separate flag and is '
  + 'on in production either way');
const legacyRows = JSON.parse(FIXTURE.legacyRosterBody());
const legacyReroute = legacyRows.find(r => r && r.key === 'write_ui_reroute_clients');
ok(legacyReroute && Array.isArray(legacyReroute.value.clients) && legacyReroute.value.clients.length > 0
  && !legacyReroute.value.clients.includes(FIXTURE.WRITE_UI_REROUTE_TEST_CLIENT),
  '  · and the roster is NON-EMPTY and excludes the TEST client — not `[]`, which now means '
  + 'native and is exactly the confusion this replaces');

/* THE COUNTEREXAMPLE. The exact body these harnesses used to serve. It must not
   route like production — if this ever passes, the check above has stopped
   discriminating and this suite is decoration. */
const oldBody = laneForHarnessBody('[]');
ok(oldBody.enrolled === false,
  'COUNTEREXAMPLE: the old `[]` body left the TEST client unenrolled, so every probe ran a lane '
  + 'no real client runs');
ok(oldBody.native === true,
  'and after the fail-closed repair that same `[]` no longer even buys the legacy lane it claimed '
  + '— a successful read with no usable roster routes native, so the old stub had stopped doing '
  + 'the one thing its comment said it did');

console.log(`\nqa-harness-routes-like-production: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
process.exit(failures ? 1 : 0);
