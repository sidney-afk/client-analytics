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

  /* ---- 7. A MALFORMED ROSTER IS NOT A USABLE ONE ----------------------- */
  /* Codex finding on the section-1 fix, 2026-09-08. The usability question was
     "did normalisation produce at least one slug", and normalisation coerced
     every member with `String(x || '')`. `{}` coerces to "[object Object]",
     which the slug rules strip to `objectobject` — a non-empty, entirely
     plausible-looking entry. So a corrupt row cleared the unusable signal, the
     predicate fell back to the factual "this slug is not enrolled", and every
     real client went to LINEAR_SET_STATUS_URL / LINEAR_ADD_COMMENT_URL: the
     exact outcome section 1 exists to prevent, reached through section 1's own
     fix. Members are validated by TYPE now, and a roster carrying anything that
     is not a slug routes to the authority that can refuse out loud.

     Every check in this section fails against the predicate as it stood before
     2026-09-08. */

  const MALFORMED_CASES = [
    ['an object where a slug belongs — the finding verbatim', { clients: [{}] }],
    ['a populated object member', { clients: [{ slug: 'enrolledclient' }] }],
    ['a nested array member', { clients: [['enrolledclient']] }],
    ['a numeric member', { clients: [123] }],
    ['a boolean member', { clients: [true] }],
    ['a null member', { clients: [null] }],
    ['a whitespace-only member that normalises to nothing', { clients: ['   '] }],
    ['a bare array value carrying an object', [{}]]
  ];

  for (const [label, value] of MALFORMED_CASES) {
    const m = makeSandbox();
    m.serve([{ key: 'write_ui_reroute_clients', value }]);
    await m.prime();
    ok(m.routing('realclient') === true,
      `a roster whose members are corrupt (${label}) routes a live write NATIVE`);
    ok(m.clients().every(slug => slug !== 'objectobject'),
      `  · and no slug is FABRICATED out of it (${label}) — the allowlist gains nothing that could `
      + 'never have matched a real client');
  }

  /* THE MIXED CASE, which is the one a partial-validation fix would still get
     wrong: one good slug beside one corrupt member. Salvaging the good half
     would leave the router acting on a roster it cannot trust, and every client
     absent from the salvaged half — which is 42 of the 43 — back on the dead
     lane. The allowlist still keeps the good half, because the drain's question
     is factual and unchanged. */
  const mixed = makeSandbox();
  mixed.serve([{ key: 'write_ui_reroute_clients', value: { clients: ['enrolledclient', {}] } }]);
  await mixed.prime();
  ok(mixed.routing('someoneelse') === true,
    'one corrupt member beside a good slug makes the WHOLE roster unusable for routing');
  ok(mixed.routing('enrolledclient') === true,
    '  · including for the client that IS named in it — an untrustworthy roster is untrustworthy '
    + 'in both directions, and native is the direction that can refuse out loud');
  ok(mixed.clients().length === 1 && mixed.clients()[0] === 'enrolledclient',
    '  · while the ALLOWLIST keeps exactly the good slug and nothing invented — the drain and the '
    + 'project-source filter are untouched, as item 175 pinned');
  ok(mixed.failed() === false,
    '  · and the READ is still not marked failed: the transport was fine, the content was not');

  /* The positive control. Validation by type must not make a healthy roster
     unusable, or this section would pass by breaking everything. */
  const healthy = makeSandbox();
  healthy.serve(ROSTER);
  await healthy.prime();
  ok(healthy.routing('someoneelse') === false && healthy.routing('enrolledclient') === true,
    'CONTROL: an all-strings roster is still usable and still decides by enrollment');

  /* ── THE TRUTH DOCS SAY THE SAME THING THE CODE DOES ─────────────────── */
  /* Item 175 flipped the routing fail direction and the session that did it
     updated `docs/truth/LINEAR.md` — the file it was reading — and none of the
     four OTHER current-state sections that assert the same fact. They then said
     the exact inverse of the shipped behaviour for a day, and AGENTS.md tells a
     new session to TRUST them, so the next session would have reasoned from the
     opposite of the truth. Codex found it on bd6011e. That is this PR's own
     recurring pattern one more time: a change as wide as the place its author
     happened to be looking.

     WHAT THIS GUARD IS, EXACTLY. It is a string check for the four stale claims
     that were actually there, so those four cannot come back. It is NOT a
     general "the docs agree with the code" check — nothing here parses prose,
     and a fifth file, or a reworded fifth claim, would sail past it. It is
     worth having anyway because the observed failure was literal recurrence of
     these sentences, and it is named narrowly here so nobody later mistakes it
     for the general guarantee. The general one wants a single owning file that
     the others cite, which is a bigger change than this lane should make. */
  const docText = (rel) => fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
  const STALE = [
    ['docs/truth/BRIEFING.md', /fail direction is unchanged/,
      'BRIEFING no longer says the reroute fail direction is unchanged'],
    ['docs/truth/APP.md', /Enrolled clients \(TEST-only\s*\n?\s*today\)/,
      'APP no longer calls the enrolled cohort TEST-only'],
    ['docs/independence/SYSTEM_MAP.md', /is seeded for TEST only\./,
      'SYSTEM_MAP no longer says the cohort is seeded for TEST only'],
    ['docs/independence/SYSTEM_MAP.md', /it was last verified TEST-only, and missing\/malformed\/read-failed state selects the exact legacy lane/,
      'SYSTEM_MAP flag semantics no longer send missing\/malformed reads to the legacy lane']
  ];
  for (const [rel, re, label] of STALE) {
    ok(!re.test(docText(rel)), label + ' (' + rel + ')');
  }
  /* The self-test the rest of this PR taught me to write: a detector is worth
     nothing until it has been driven against the thing it claims to catch. */
  ok(STALE.every(([, re]) => re.test(
        're-armed: fail direction is unchanged / Enrolled clients (TEST-only today) / '
        + 'is seeded for TEST only. / it was last verified TEST-only, and missing/malformed/'
        + 'read-failed state selects the exact legacy lane')),
    '  · and each of the four patterns still MATCHES its stale sentence, so this is a live '
    + 'detector rather than four regexes that can no longer fire');

  console.log(`\nwrite-ui-reroute-usable-roster: ${failures ? failures + ' failed ❌' : 'all checks passed ✅'}`);
  process.exit(failures ? 1 : 0);
})();
