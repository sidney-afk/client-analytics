'use strict';
/*
 * OPEN_REPAIRS item 70 — the two-second fallback that never healed.
 *
 * _writeUiFetchRerouteFlagOnce races the enrolment read against a 2s timeout
 * and, on ANY failure, falls back to an EMPTY allowlist. _writeUiPrimeRerouteFlag
 * memoises that promise for the life of the page. Composed, post-flip: one slow
 * moment at boot put a whole session on the legacy lane -- where every write
 * 409s server-side, is swallowed client-side, and the screen goes green -- for
 * as long as the tab stayed open. The realtime channel could not save such a
 * tab, because it fires only when the flag ROW changes.
 *
 * The heal runs on every resume and re-fetches ONLY when the last fetch
 * failed. This suite SLICES AND EXECUTES the shipped flag block (the wiring --
 * that the resume path actually awaits the heal, for staff and client owners
 * alike -- is proven by execution in write-ui-writer-durability.js and
 * client-entry-legacy-resume-lease.js, whose sandboxes stub the heal and whose
 * extracted resume function would throw without it; the source-order contract
 * lives in write-ui-calendar-sxr-reroute.js).
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
let block = src.slice(start, end);
// The slice drags in neighbouring flag machinery wired to page-only globals;
// the two subscription installers are not under test here.
block = block
  .replace(/_writeUiInstallRerouteFlagChannel\(\);?/g, '')
  .replace(/_calInstallUpsertFlagChannel\(\);?/g, '');

let fetchImpl = async () => { throw new Error('no fetch stub installed'); };
let fetchCount = 0;
const sandbox = new Function('fetchRef', `
  const CAL_SUPABASE_URL = 'https://stub.invalid';
  const CAL_SUPABASE_ANON_KEY = 'anon';
  const CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients';
  const _calV2Log = () => {};
  const _linearRefreshProjectsForRerouteChange = () => Promise.resolve();
  const fetch = (...args) => fetchRef.impl(...args);
  ${block}
  return {
    prime: _writeUiPrimeRerouteFlag,
    heal: _writeUiHealRerouteFlag,
    useGateway: (slug) => !!slug && _writeUiRerouteClients.has(slug),
    clients: () => Array.from(_writeUiRerouteClients),
    failed: () => _writeUiRerouteFlagFailed,
  };
`)({ get impl() { return fetchImpl; }, });

ok(typeof sandbox.heal === 'function' && typeof sandbox.prime === 'function',
  'the shipped prime and heal load and run (harness is not vacuous)');

const ROSTER = [{ key: 'write_ui_reroute_clients', value: { clients: ['sidneylaruel', 'clienta'] } }];
function serveRoster() {
  fetchImpl = async () => { fetchCount++; return { ok: true, json: async () => ROSTER }; };
}
function serveFailure() {
  fetchImpl = async () => { fetchCount++; throw new Error('boot network blip'); };
}

(async () => {
  /* 1. The failure that used to be permanent: boot read fails, allowlist dark. */
  serveFailure();
  await sandbox.prime();
  ok(sandbox.clients().length === 0 && sandbox.failed() === true,
    'a failed boot read falls back dark and is MARKED failed');
  ok(sandbox.useGateway('sidneylaruel') === false,
    'while dark, an enrolled client reads as unenrolled -- the item-70 hazard');

  /* 2. Priming again does NOT recover -- this is the memoisation the bug lives
   *    in, pinned so a future simplification cannot quietly re-fetch on every
   *    prime and turn the boot path into a request storm. */
  serveRoster();
  const beforePrime = fetchCount;
  await sandbox.prime();
  ok(fetchCount === beforePrime && sandbox.clients().length === 0,
    'prime alone never re-fetches -- the memo is the point, and the bug');

  /* 3. The heal recovers it on the next resume. */
  await sandbox.heal();
  ok(sandbox.clients().length === 2 && sandbox.failed() === false,
    'heal after a failed read re-fetches and repopulates the allowlist');
  ok(sandbox.useGateway('sidneylaruel') === true,
    'the enrolled client is back on the gateway lane');

  /* 4. A healthy heal is a no-op request-wise: resumes fire every 60s and on
   *    every focus, so this is what keeps steady-state traffic unchanged. */
  const beforeHealthy = fetchCount;
  await sandbox.heal();
  await sandbox.heal();
  ok(fetchCount === beforeHealthy,
    'heal on a healthy flag makes NO network request');

  /* 5. Failure -> failure stays dark, stays marked, and the next heal retries:
   *    one bad re-fetch must not un-mark the failure and strand the tab. Run
   *    in a fresh sandbox because the only shipped writer of the failed mark
   *    is the fetch itself, and the first sandbox is now healthy by design. */
  let fetchImpl2 = async () => { throw new Error('down'); };
  let count2 = 0;
  const sb2 = new Function('fetchRef', `
    const CAL_SUPABASE_URL = 'https://stub.invalid';
    const CAL_SUPABASE_ANON_KEY = 'anon';
    const CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients';
    const _calV2Log = () => {};
    const _linearRefreshProjectsForRerouteChange = () => Promise.resolve();
    const fetch = (...args) => fetchRef.impl(...args);
    ${block}
    return {
      prime: _writeUiPrimeRerouteFlag,
      heal: _writeUiHealRerouteFlag,
      clients: () => Array.from(_writeUiRerouteClients),
      failed: () => _writeUiRerouteFlagFailed,
    };
  `)({ get impl() { return fetchImpl2; } });
  fetchImpl2 = async () => { count2++; throw new Error('still down'); };
  await sb2.prime();
  await sb2.heal();
  ok(sb2.failed() === true && sb2.clients().length === 0,
    'a heal that fails again stays dark and stays MARKED, ready for the next resume');
  const failedAttempts = count2;
  fetchImpl2 = async () => { count2++; return { ok: true, json: async () => ROSTER }; };
  await sb2.heal();
  ok(sb2.clients().length === 2 && sb2.failed() === false && count2 === failedAttempts + 1,
    'the resume after that recovers with exactly one request');

  /* 6. A heal recovery lands MID-SESSION, so a changed roster must walk the
   *    same rebuild/reconcile path the realtime channel walks -- review
   *    finding on the item-70 fix: without {refreshProjects:true} the heal
   *    was the one reroute-set-change path that skipped the reconcile. The
   *    boot prime stays bare: nothing is rendered yet (and the shipped
   *    refresh helper early-returns before projects load regardless). */
  let fetchImpl3 = async () => { throw new Error('boot blip'); };
  const refreshCalls = [];
  const sb3 = new Function('fetchRef', 'refreshCalls', `
    const CAL_SUPABASE_URL = 'https://stub.invalid';
    const CAL_SUPABASE_ANON_KEY = 'anon';
    const CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients';
    const _calV2Log = () => {};
    const _linearRefreshProjectsForRerouteChange = (prev, next) => {
      refreshCalls.push([Array.from(prev), Array.from(next)]);
      return Promise.resolve();
    };
    const fetch = (...args) => fetchRef.impl(...args);
    ${block}
    return {
      prime: _writeUiPrimeRerouteFlag,
      heal: _writeUiHealRerouteFlag,
      clients: () => Array.from(_writeUiRerouteClients),
      failed: () => _writeUiRerouteFlagFailed,
    };
  `)({ get impl() { return fetchImpl3; } }, refreshCalls);

/* 8. The race the P1 review found: a heal already IN FLIGHT when the realtime
 *    channel delivers must not land on top of it. The two connections are
 *    independent, so both orderings are reachable, and both used to end with an
 *    enrolled client back on the legacy lane -- post-flip that means writes
 *    409 server-side, are swallowed client-side, and the screen goes green.
 *    This runs the SHIPPED channel applier, not a paraphrase of it. */
function raceSandbox(fetchRef, refreshCalls) {
  return new Function('fetchRef', 'refreshCalls', `
    const CAL_SUPABASE_URL = 'https://stub.invalid';
    const CAL_SUPABASE_ANON_KEY = 'anon';
    const CALENDAR_UPSERT_FLAG_KEY = 'calendar_upsert_ef_clients';
    const _calV2Log = () => {};
    const _linearRefreshProjectsForRerouteChange = (prev, next) => {
      refreshCalls.push([Array.from(prev), Array.from(next)]);
      return Promise.resolve();
    };
    const fetch = (...args) => fetchRef.impl(...args);
    ${block}
    return {
      prime: _writeUiPrimeRerouteFlag,
      heal: _writeUiHealRerouteFlag,
      fromChannel: _writeUiApplyRerouteFlagFromChannel,
      clients: () => Array.from(_writeUiRerouteClients),
      failed: () => _writeUiRerouteFlagFailed,
    };
  `)(fetchRef, refreshCalls);
}

const CHANNEL_ROW = { value: { clients: ['sidneylaruel', 'clienta', 'clientb'] } };
/* heal() awaits the memoised promise before it issues its re-fetch, so the
 * fetch starts a microtask after the call. Wait for the stub to actually be
 * entered, or the race being tested never sets up. */
const until = async (fn) => { for (let i = 0; i < 100 && !fn(); i++) await new Promise(r => setTimeout(r, 0)); if (!fn()) throw new Error('the heal never reached the fetch stub'); };

/* Ordering 1: the in-flight heal FAILS after the channel already recovered. */
{
  let impl = async () => { throw new Error('boot blip'); };
  const sb = raceSandbox({ get impl() { return impl; } }, []);
  await sb.prime();                       // dark + marked
  ok(sb.failed() === true && sb.clients().length === 0, 'race-1: starts dark and marked');

  let releaseHeal;
  impl = () => new Promise((_, reject) => { releaseHeal = () => reject(new Error('still down')); });
  const healing = sb.heal();              // in flight, will fail
  await until(() => !!releaseHeal);
  sb.fromChannel(CHANNEL_ROW);            // realtime lands first
  ok(sb.clients().length === 3 && sb.failed() === false,
    'race-1: the channel delivery recovers the roster and clears the failed mark');
  releaseHeal();
  await healing;
  ok(sb.clients().length === 3,
    'race-1: the stale heal FAILURE does not blank the channel-delivered roster');
  ok(sb.failed() === false,
    'race-1: and does not re-mark the tab as failed, which would re-fetch and clobber again');
}

/* Ordering 2: the in-flight heal SUCCEEDS with an older snapshot. */
{
  let impl = async () => { throw new Error('boot blip'); };
  const sb = raceSandbox({ get impl() { return impl; } }, []);
  await sb.prime();

  let releaseHeal;
  impl = () => new Promise(resolve => {
    releaseHeal = () => resolve({ ok: true, json: async () => [{ key: 'write_ui_reroute_clients', value: { clients: ['sidneylaruel'] } }] });
  });
  const healing = sb.heal();
  await until(() => !!releaseHeal);
  sb.fromChannel(CHANNEL_ROW);            // newer roster: three clients
  releaseHeal();                          // older snapshot: one client
  await healing;
  ok(sb.clients().length === 3,
    'race-2: a slower successful read cannot roll the roster back to its older snapshot');
}

  await sb3.prime();
  ok(refreshCalls.length === 0,
    'the boot prime never triggers the project reconcile (even its dark fallback)');
  fetchImpl3 = async () => ({ ok: true, json: async () => ROSTER });
  await sb3.heal();
  ok(refreshCalls.length === 1
      && refreshCalls[0][0].length === 0 && refreshCalls[0][1].length === 2,
    'a heal recovery reconciles the project picker exactly once, empty -> full roster');
  await sb3.heal();
  ok(refreshCalls.length === 1,
    'a healthy heal after recovery does not reconcile again');

  /* 7. The channel handler is now a one-line delegation to the applier the
   *    race scenarios above EXECUTE, so the only thing left to pin at source
   *    level is that the handler actually delegates -- the behavior itself is
   *    proven by execution rather than by regex. */
  const chanStart = src.indexOf("filter: 'key=eq.' + WRITE_UI_REROUTE_FLAG_KEY");
  ok(chanStart >= 0, 'the reroute-flag realtime handler exists');
  const chanBlock = src.slice(chanStart, src.indexOf(".on('postgres_changes'", chanStart));
  ok(/_writeUiApplyRerouteFlagFromChannel\(row\)/.test(chanBlock),
    'the channel handler applies the row through the shared applier');
  ok(!/_writeUiSetRerouteFlagValue\(/.test(chanBlock),
    'and does not apply the roster a second way of its own, which is how the two paths drifted apart');

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nwrite-UI reroute flag heal checks passed');
})();
