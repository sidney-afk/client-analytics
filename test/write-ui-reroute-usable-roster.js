'use strict';
/*
 * "SUCCEEDED WITH NOTHING USABLE" IS NOT "NOBODY IS ENROLLED".
 *
 * Item 175 made routing a live write fail CLOSED against Linear, and covered
 * exactly one failure: the read that never landed. `_writeUiFetchRerouteFlagOnce`
 * sets `_writeUiRerouteFlagFailed` in its catch, and
 * `_writeUiRerouteUseGatewayFailClosed` reads it.
 *
 * The SUCCESS path did not carry the same rule. It applied `rerouteRow.value`
 * when there was one and `{clients: []}` when there was not, then cleared the
 * failed mark unconditionally. So three states arrived with an EMPTY allowlist
 * and a flag reporting itself healthy:
 *
 *   • a 200 carrying `[]`
 *   • a 200 whose rows do not include `write_ui_reroute_clients`
 *   • a 200 whose value is null, a scalar, or otherwise the wrong shape
 *
 * In all three the routing predicate found no failure, answered the factual
 * "this slug is not enrolled", and sent every status change to
 * LINEAR_SET_STATUS_URL and every comment to LINEAR_ADD_COMMENT_URL. Delete or
 * corrupt that one row after 2026-09-15 and every write in every open tab goes
 * silently to a dead endpoint — the outcome item 175 exists to prevent,
 * reachable without a single network failure.
 *
 * THE FIX TRACKS VALIDITY SEPARATELY FROM THE ALLOWLIST, and most of this suite
 * is about that separation rather than the flip itself:
 *
 *   • the ALLOWLIST is untouched on every path. It stays the factual answer the
 *     outbox drain and the project-source filter need (item 175 pinned that,
 *     and flipping the drain rebuilds item 63).
 *   • `_writeUiRerouteFlagFailed` keeps its one narrow meaning — the READ
 *     failed — because `_writeUiHealRerouteFlag` keys on it to decide whether a
 *     resume re-fetches. A successful empty read must NOT arm the heal, or a
 *     tab with a legitimately empty roster re-fetches on every resume forever.
 *   • only the routing predicate's view of usability changes.
 *
 * This drives the SHIPPED block out of index.html through a stubbed fetch, so
 * it exercises the real read rather than a restatement of it.
 *
 * Fixtures are synthetic slugs. The repository is public.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const start = src.indexOf("    const WRITE_UI_REROUTE_FLAG_KEY = 'write_ui_reroute_clients';");
const end = src.indexOf('    window.peekWriteUiRerouteClients');
if (start < 0 || end < 0 || end <= start) throw new Error('could not slice the reroute-flag block from index.html');
const block = src.slice(start, end)
  .replace(/_writeUiInstallRerouteFlagChannel\(\);?/g, '')
  .replace(/_calInstallUpsertFlagChannel\(\);?/g, '');

/* A fresh copy of the shipped block per scenario: the failed mark and the
   memoised promise are page-lifetime state, and reusing one sandbox across
   cases would let an earlier read decide a later assertion. */
function makeSandbox(opts) {
  const conf = opts || {};
  const ref = { impl: async () => { throw new Error('no fetch stub installed'); }, count: 0 };
  const api = new Function('ref', `
    const CAL_SUPABASE_URL = ${conf.noSupabase ? 'undefined' : "'https://stub.invalid'"};
    const CAL_SUPABASE_ANON_KEY = ${conf.noSupabase ? 'undefined' : "'anon'"};
    const CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients';
    const _calV2Log = () => {};
    const _linearRefreshProjectsForRerouteChange = () => Promise.resolve();
    const fetch = (...args) => { ref.count++; return ref.impl(...args); };
    ${block}
    return {
      prime: _writeUiPrimeRerouteFlag,
      heal: _writeUiHealRerouteFlag,
      fetchOnce: _writeUiFetchRerouteFlagOnce,
      fromChannel: _writeUiApplyRerouteFlagFromChannel,
      /* the two predicates, exactly as shipped */
      factual: _writeUiRerouteUseGateway,
      routing: _writeUiRerouteUseGatewayFailClosed,
      clients: () => Array.from(_writeUiRerouteClients),
      failed: () => _writeUiRerouteFlagFailed,
    };
  `)(ref);
  api.serve = (rows) => { ref.impl = async () => ({ ok: true, json: async () => rows }); };
  api.serveFailure = () => { ref.impl = async () => { throw new Error('network blip'); }; };
  api.requests = () => ref.count;
  return api;
}

const ROSTER = [{ key: 'write_ui_reroute_clients', value: { clients: ['enrolledclient', 'clienta'] } }];

ok(typeof makeSandbox().routing === 'function' && typeof makeSandbox().fetchOnce === 'function',
  'the shipped read and both predicates load and run (harness is not vacuous)');

/* ---- 1. THE THREE SUCCESSFUL READS THAT CARRY NOTHING USABLE ------------- */

const EMPTY_CASES = [
  ['an empty row array', []],
  ['rows without the write_ui_reroute_clients key', [{ key: 'calendar_upsert_ef_clients', value: { clients: ['x'] } }]],
  ['the key present with a null value', [{ key: 'write_ui_reroute_clients', value: null }]],
  ['the key present with a scalar value', [{ key: 'write_ui_reroute_clients', value: 'clients' }]],
  ['the key present with an object of the wrong shape', [{ key: 'write_ui_reroute_clients', value: { enabled: true } }]],
  ['the key present with an explicitly empty roster', [{ key: 'write_ui_reroute_clients', value: { clients: [] } }]]
];

(async () => {
  for (const [label, rows] of EMPTY_CASES) {
    const s = makeSandbox();
    s.serve(rows);
    await s.prime();

    ok(s.routing('anyclient') === true,
      `200 with ${label} routes a live write NATIVE`);
    ok(s.factual('anyclient') === false,
      `  · COUNTEREXAMPLE (${label}): the FACTUAL predicate still answers "not enrolled" — which is `
      + 'the answer that used to choose LINEAR_SET_STATUS_URL, and is still the right answer for the drain');
    ok(s.clients().length === 0,
      `  · and the allowlist itself is left empty (${label}) — the drain's factual answer is unchanged`);
    ok(s.failed() === false,
      `  · and the READ is not marked failed (${label}), so the heal's meaning is untouched`);
  }

  /* ---- 2. A GOOD ROSTER STILL DECIDES BY ENROLLMENT --------------------- */
  /* The flip must stay as narrow as item 175 made it: a readable, non-empty
     roster routes by what it says, and an unenrolled client still goes legacy. */

  const good = makeSandbox();
  good.serve(ROSTER);
  await good.prime();
  ok(good.routing('enrolledclient') === true, 'a usable roster routes an enrolled client native');
  ok(good.routing('someoneelse') === false,
    'and an UNENROLLED client still routes legacy — the fix did not widen into "always native"');
  ok(good.factual('someoneelse') === false && good.factual('enrolledclient') === true,
    'the factual predicate is unchanged on the healthy path');

  /* ---- 3. NOTHING LATCHES, IN EITHER DIRECTION -------------------------- */

  const flip = makeSandbox();
  flip.serve(ROSTER);
  await flip.prime();
  ok(flip.routing('someoneelse') === false, 'healthy read first: unenrolled routes legacy');
  flip.serve([]);
  await flip.fetchOnce();
  ok(flip.routing('someoneelse') === true,
    'a LATER read that comes back empty flips routing back to native — a good roster does not latch '
    + 'over a row that was since deleted');
  flip.serve(ROSTER);
  await flip.fetchOnce();
  ok(flip.routing('someoneelse') === false,
    'and restoring the row returns to the enrollment answer — the native override does not latch either');

  /* ---- 4. THE HEAL'S MEANING IS UNCHANGED ------------------------------- */
  /* `_writeUiRerouteFlagFailed` is read at the heal to decide whether a resume
     re-fetches. An empty-but-successful read must not arm it, or every resume
     on such a tab issues a request. This is the check that a future edit
     collapsing the two signals into one would fail. */

  const heal = makeSandbox();
  heal.serve([]);
  await heal.prime();
  const beforeHeal = heal.requests();
  await heal.heal();
  await heal.heal();
  ok(heal.requests() === beforeHeal,
    'a successful-but-empty read does NOT arm the heal: two resumes make no request');
  ok(heal.routing('anyclient') === true,
    'while still routing native, so the tab is safe without being chatty');

  const healFailed = makeSandbox();
  healFailed.serveFailure();
  await healFailed.prime();
  ok(healFailed.failed() === true && healFailed.routing('anyclient') === true,
    'a genuinely FAILED read still marks failed and still routes native (item 175, unchanged)');
  const beforeRetry = healFailed.requests();
  healFailed.serve(ROSTER);
  await healFailed.heal();
  ok(healFailed.requests() > beforeRetry && healFailed.routing('someoneelse') === false,
    'and the heal still re-fetches after a real failure and returns to the enrollment answer');

  /* ---- 5. THE REALTIME CHANNEL CARRIES THE SAME RULE -------------------- */
  /* A DELETE arrives with no row at all. That is the literal "someone removed
     the flag row" case, and it must not read as "nobody is enrolled". */

  const chan = makeSandbox();
  chan.serve(ROSTER);
  await chan.prime();
  ok(chan.routing('someoneelse') === false, 'channel case starts from a good roster');
  chan.fromChannel(null);
  ok(chan.routing('someoneelse') === true,
    'a channel DELETE (no row) routes native rather than reading as an empty allowlist');
  ok(chan.failed() === false,
    '  · and does not mark the READ failed — a delivery is a successful read');
  chan.fromChannel({ value: { clients: ['enrolledclient'] } });
  ok(chan.routing('someoneelse') === false && chan.routing('enrolledclient') === true,
    'a channel delivery carrying a roster returns to the enrollment answer');

  /* ---- 6. THE ONE PLACE AN EMPTY ROSTER IS STILL USABLE ----------------- */
  /* Without Supabase config the native gateway is unreachable too, so routing
     native routes into nothing. Item 175 carved this out deliberately and the
     carve-out has to survive: legacy is the only lane that could work here. */

  const noConf = makeSandbox({ noSupabase: true });
  await noConf.prime();
  ok(noConf.requests() === 0, 'the missing-Supabase-config path makes no request at all');
  ok(noConf.failed() === false, 'and does not mark the flag failed (item 175 pinned this)');
  ok(noConf.routing('anyclient') === false,
    'and still routes LEGACY, because with no Supabase config the native gateway is unreachable too — '
    + 'the one state where an empty roster means what it says');

  console.log(`\nwrite-ui-reroute-usable-roster: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})();
