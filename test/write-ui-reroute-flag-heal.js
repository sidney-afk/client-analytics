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

  if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
  console.log('\nwrite-UI reroute flag heal checks passed');
})();
