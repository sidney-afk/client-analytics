'use strict';
/*
 * A FAILURE PAGES ONLY ONCE IT IS CONFIRMED (owner rule 2026-10-11, OPEN_REPAIRS 405).
 *
 * The dead-man's switch used to page "RAN and reported failure" on a lane's
 * newest heartbeat alone, so one red run paged. The rule now: the "ran and
 * failed" page fires only when a lane's two most recent production runs both
 * failed. One failure then a pass, one failure with no second run yet, and
 * fail, pass, fail page nothing. A lane that keeps failing still pages, on its
 * second failure, so the 22-night and 26-night silences recorded in
 * monitoring-watchdog-core.mjs cannot repeat. The "lane went silent" (stale)
 * page is unchanged.
 *
 * A run on another branch (a pull request, a manual run of a branch under
 * review) never confirms, hides or ends a failure: on 2026-10-10 a passing
 * branch run un-latched a nightly that had failed on main every day, and the
 * next main failure paged again.
 *
 * Offline: a fake database and a fake relay, no network.
 */
const core = require('../scripts/monitoring-watchdog.js');
const coreModule = require('../supabase/functions/_shared/monitoring-watchdog-core.mjs');
const digest = require('../scripts/alert-digest.js');
const { relayPayload } = require('../supabase/functions/_shared/monitoring-alert-relay-core.mjs');
const fs = require('node:fs');
const path = require('node:path');

const {
  CONFIRMING_FAILED_RUNS,
  FAILING_KIND,
  HEARTBEAT_ACTION,
  HEARTBEAT_HISTORY_PER_LANE,
  LATCH_ACTION,
  PRODUCTION_REF,
  activeLanes,
  failingPageSpec,
  productionRuns,
  watchdogDecision,
} = core;

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const MIN = 60000;
const NOW = Date.parse('2026-10-11T12:00:00.000Z');
const LANE = 'samples_e2e_nightly';
const WATCHED = activeLanes();
const lanesOf = rows => rows.map(row => row.lane);

let nextId = 1;
function beat(lane, { ok: okFlag = true, minutesAgo = 5, run, ref } = {}) {
  const at = new Date(NOW - minutesAgo * MIN).toISOString();
  return {
    id: nextId++,
    ts: at,
    payload: { lane, ok: okFlag, at, run_id: run || `${7000 + minutesAgo}:1`, ...(ref === undefined ? {} : { ref }) },
  };
}
const latch = (lane, state, kind) => ({
  id: nextId++,
  ts: new Date(NOW).toISOString(),
  payload: { lane, incident_state: state, ...(kind ? { incident_kind: kind } : {}) },
});
// Fresh passing beats for every other watched lane, so only LANE moves.
const quiet = () => WATCHED.filter(lane => lane.key !== LANE).map(lane => beat(lane.key));
// `sequence` is oldest first, one run per entry, a nightly a day apart, the
// newest a few minutes old: 'F' failed, 'P' passed.
function nights(sequence, { lane = LANE, ref } = {}) {
  const runs = sequence.split('');
  return runs.map((flag, i) => beat(lane, { ok: flag === 'P', minutesAgo: 5 + (runs.length - 1 - i) * 24 * 60, ref }));
}
const decide = (laneRows, latchRows = []) => watchdogDecision({ heartbeatRows: [...quiet(), ...laneRows], latchRows, nowMs: NOW });

// --- 1. The four cases the owner named ---------------------------------------
ok(CONFIRMING_FAILED_RUNS === 2, 'a failure is confirmed by two runs in a row');
{
  const failThenPass = decide(nights('FP'));
  ok(failThenPass.failing.length === 0 && failThenPass.awaiting_confirmation.length === 0,
    'fail then pass: no page (the pass ends it)');
  const twoFails = decide(nights('FF'));
  ok(lanesOf(twoFails.failing).includes(LANE), 'two fails in a row: page');
  ok(twoFails.failing[0].failed_runs.length === 2 && twoFails.failing[0].failed_runs.every(Boolean),
    'the page row names both failed runs');
  const failPassFail = decide(nights('FPF'));
  ok(failPassFail.failing.length === 0, 'fail, pass, fail: no page');
  ok(lanesOf(failPassFail.awaiting_confirmation).includes(LANE),
    'and the newest failure is reported as awaiting confirmation, not hidden');
  const onlyOne = decide(nights('F'));
  ok(onlyOne.failing.length === 0 && lanesOf(onlyOne.awaiting_confirmation).includes(LANE),
    'one failure with no second run yet: no page, awaiting confirmation');
  const passFail = decide(nights('PPPF'));
  ok(passFail.failing.length === 0, 'a failure after a run of passes waits for the next run');
}

// --- 2. Staleness paging is unchanged ----------------------------------------
{
  // The stale half reads only the newest beat. Feeding the decision a lane's
  // whole history, or only its newest beat, must give the same stale answer.
  const cases = ['F', 'FF', 'FP', 'PF', 'FPF', 'FFF', 'P'];
  const mismatches = [];
  for (const sequence of cases) {
    for (const ageMinutes of [5, 2000, 2200, 9000]) {
      const rows = nights(sequence).map(row => {
        const shifted = Date.parse(row.payload.at) - (ageMinutes - 5) * MIN;
        const at = new Date(shifted).toISOString();
        return { ...row, ts: at, payload: { ...row.payload, at } };
      });
      for (const latchRows of [[], [latch(LANE, 'latched')]]) {
        const all = watchdogDecision({ heartbeatRows: [...quiet(), ...rows], latchRows, nowMs: NOW });
        const newestOnly = watchdogDecision({ heartbeatRows: [...quiet(), rows[rows.length - 1]], latchRows, nowMs: NOW });
        const same = ['stale', 'recovered'].every(key => JSON.stringify(lanesOf(all[key])) === JSON.stringify(lanesOf(newestOnly[key])))
          && JSON.stringify(all.healthy.map(row => [row.lane, row.suppressed || ''])) === JSON.stringify(newestOnly.healthy.map(row => [row.lane, row.suppressed || '']));
        if (!same) mismatches.push(`${sequence}/${ageMinutes}m/latch${latchRows.length}`);
      }
    }
  }
  ok(mismatches.length === 0,
    `staleness depends on the newest beat only, whatever the history (7 sequences x 4 ages x 2 latch states)${mismatches.length ? ': ' + mismatches.join(' ') : ''}`);
  const silent = decide(nights('FF').map(row => ({ ...row, ts: '2026-10-08T00:00:00.000Z', payload: { ...row.payload, at: '2026-10-08T00:00:00.000Z' } })));
  ok(lanesOf(silent.stale).includes(LANE) && silent.failing.length === 0,
    'a lane that went silent still pages as stale, and is never also reported as failing');
  const latchedStale = decide(nights('P').map(row => ({ ...row, payload: { ...row.payload, at: '2026-10-08T00:00:00.000Z' } })), [latch(LANE, 'latched')]);
  ok(!lanesOf(latchedStale.stale).includes(LANE), 'an already latched stale lane still does not re-page');
  const back = decide(nights('P'), [latch(LANE, 'latched')]);
  ok(lanesOf(back.recovered).includes(LANE), 'a stale lane that checks in again still un-latches');
}

// --- 3. Branch runs and repeated beats ---------------------------------------
{
  const mainFail = beat(LANE, { ok: false, minutesAgo: 5, ref: 'main' });
  const branchFail = beat(LANE, { ok: false, minutesAgo: 60, ref: 'feature-branch' });
  ok(decide([mainFail, branchFail]).failing.length === 0,
    'a failed run on another branch does not confirm a main failure');
  const prMain = [beat(LANE, { ok: false, minutesAgo: 5, ref: '2027/merge' }), beat(LANE, { ok: false, minutesAgo: 60, ref: '2027/merge' })];
  ok(decide(prMain).failing.length === 0, 'two failed pull request runs page nothing');
  const mainFailBranchPassMainFail = [
    beat(LANE, { ok: false, minutesAgo: 5, ref: 'main' }),
    beat(LANE, { ok: true, minutesAgo: 600, ref: 'feature-branch' }),
    beat(LANE, { ok: false, minutesAgo: 1440, ref: 'main' }),
  ];
  ok(lanesOf(decide(mainFailBranchPassMainFail).failing).includes(LANE),
    'a passing branch run between two main failures does not hide the confirmed failure');
  const latchedThenBranchPass = decide([
    beat(LANE, { ok: true, minutesAgo: 5, ref: 'feature-branch' }),
    beat(LANE, { ok: false, minutesAgo: 600, ref: 'main' }),
    beat(LANE, { ok: false, minutesAgo: 1440, ref: 'main' }),
  ], [latch(LANE, 'latched', FAILING_KIND)]);
  ok(latchedThenBranchPass.recovered_failing.length === 0 && latchedThenBranchPass.failing.length === 0,
    'a passing branch run never ends a failing incident (no un-latch, so no re-page later)');
  ok(lanesOf(decide(nights('FF')).failing).includes(LANE), 'beats written before `ref` existed count as production runs');
  const sameRun = [beat(LANE, { ok: false, minutesAgo: 5, run: '555:1' }), beat(LANE, { ok: false, minutesAgo: 6, run: '555:1' })];
  ok(decide(sameRun).failing.length === 0, 'two beats from one run are one run: no page');
  ok(productionRuns(sameRun).get(LANE).length === 1, 'productionRuns keeps one entry per run');
  const order = productionRuns([beat(LANE, { minutesAgo: 50, run: 'old:1' }), beat(LANE, { minutesAgo: 5, run: 'new:1' })]).get(LANE);
  ok(order[0].run_id === 'new:1' && order[1].run_id === 'old:1', 'runs are ordered newest first by their own time');
}

// --- 4. The latch: one page per confirmed incident ----------------------------
{
  const latched = decide(nights('FFF'), [latch(LANE, 'latched', FAILING_KIND)]);
  ok(latched.failing.length === 0 && latched.recovered_failing.length === 0,
    'a lane still failing after its page stays latched and does not re-page');
  const passed = decide(nights('FFP'), [latch(LANE, 'latched', FAILING_KIND)]);
  ok(lanesOf(passed.recovered_failing).includes(LANE), 'a pass ends the incident');
  const failAfterPass = decide(nights('FFPF'), [latch(LANE, 'latched', FAILING_KIND)]);
  ok(failAfterPass.failing.length === 0 && failAfterPass.recovered_failing.length === 0,
    'one failure after an unseen pass pages nothing, and a lone failure never ends an incident (only a pass does)');
  const lone = decide(nights('PF'), [latch(LANE, 'latched', FAILING_KIND)]);
  ok(lone.recovered_failing.length === 0, 'an existing failing latch is kept while the newest production run failed');
}

// --- 5. End to end: runCheck against a fake database and relay ----------------
function fakeEstate() {
  const state = { heartbeats: [], latches: [], pages: [], queries: [], id: 1, now: Date.parse('2026-09-01T03:00:00.000Z') };
  const insert = (action, payload) => {
    const row = { id: state.id++, ts: new Date(state.now).toISOString(), payload: JSON.parse(JSON.stringify(payload)) };
    if (action === HEARTBEAT_ACTION) state.heartbeats.push(row);
    else if (action === LATCH_ACTION) state.latches.push(row);
  };
  const io = (extra = {}) => ({
    restRows: async query => {
      state.queries.push(query);
      const limit = Number((/[?&]limit=(\d+)/.exec(query) || [])[1] || 1000);
      if (query.includes(`action=eq.${HEARTBEAT_ACTION}`)) {
        const lane = decodeURIComponent((/payload->>lane=eq\.([^&]+)/.exec(query) || [])[1] || '');
        const production = query.includes(`&or=(payload->>ref.is.null,payload->>ref.eq.${PRODUCTION_REF})`);
        return state.heartbeats
          .filter(row => row.payload.lane === lane && (!production || !row.payload.ref || row.payload.ref === PRODUCTION_REF))
          .sort((a, b) => b.id - a.id).slice(0, limit);
      }
      if (query.includes(`action=eq.${LATCH_ACTION}`)) return state.latches.slice().sort((a, b) => b.id - a.id).slice(0, limit);
      return [];
    },
    insertEvent: async (action, payload) => insert(action, payload),
    sendAlert: async spec => { state.pages.push(spec); return { http_status: 200, delivery_confirmed: true }; },
    runHandle: `check:${state.id}`,
    nowMs: () => state.now,
    dryRun: false,
    ...extra,
  });
  // One night: the lane's run beats (ok or not), every other lane beats ok, then a check.
  async function night(okFlag, { ref = 'main', run } = {}) {
    state.now += 24 * 60 * MIN;
    for (const lane of WATCHED) {
      const isLane = lane.key === LANE;
      await coreModule.writeHeartbeat(io({ runHandle: isLane ? (run || `night${state.id}:1`) : `other${state.id}:1`, ref: isLane ? ref : 'main' }),
        lane.key, { ok: isLane ? okFlag : true });
    }
    state.now += 10 * MIN;
    const before = state.pages.length;
    const result = await coreModule.runCheck(io());
    return { result, paged: state.pages.slice(before).filter(page => page.type === 'monitoring_lane_failing') };
  }
  return { state, io, night };
}

(async () => {
  {
    const estate = fakeEstate();
    const n1 = await estate.night(false);
    ok(n1.paged.length === 0 && n1.result.awaiting_confirmation.includes(LANE),
      'runCheck, night 1 fails: no page, the lane is listed as awaiting confirmation');
    const n2 = await estate.night(false);
    ok(n2.paged.length === 1 && n2.result.failing.includes(LANE) && /last 2 runs in a row/.test(n2.paged[0].text),
      'night 2 fails too: exactly one "ran and failed" page, saying two runs in a row');
    const n3 = await estate.night(false);
    ok(n3.paged.length === 0, 'night 3 still failing: latched, no repeat page');
    const n4 = await estate.night(true);
    ok(n4.paged.length === 0 && n4.result.recovered_failing.includes(LANE), 'night 4 passes: the incident ends');
    const n5 = await estate.night(false);
    ok(n5.paged.length === 0, 'night 5 fails once after the pass: no page');
    const n6 = await estate.night(false);
    ok(n6.paged.length === 1, 'night 6 fails again: a new confirmed incident pages');
    const heartbeatQueries = estate.state.queries.filter(query => query.includes(`action=eq.${HEARTBEAT_ACTION}`));
    const newestReads = heartbeatQueries.filter(query => query.endsWith('&order=id.desc&limit=1'));
    const historyReads = heartbeatQueries.filter(query => query.includes(`&or=(payload->>ref.is.null,payload->>ref.eq.${PRODUCTION_REF})&order=id.desc&limit=${HEARTBEAT_HISTORY_PER_LANE}`));
    ok(heartbeatQueries.every(query => /payload->>lane=eq\./.test(query)) && newestReads.length === historyReads.length
      && newestReads.length + historyReads.length === heartbeatQueries.length && newestReads.every(query => !query.includes('or=(')),
      `each lane gets two reads: its newest beat of any branch (staleness, unchanged) and its newest ${HEARTBEAT_HISTORY_PER_LANE} production beats`);
    ok(estate.state.heartbeats.filter(row => row.payload.lane === LANE).every(row => row.payload.ref === 'main'),
      'a heartbeat written with a known branch records it');
  }

  {
    const estate = fakeEstate();
    const n1 = await estate.night(false);
    const n2 = await estate.night(true);
    ok(n1.paged.length === 0 && n2.paged.length === 0, 'runCheck, the owner\'s case: a failed night then a passing one pages nothing');
  }

  // Many branch runs between two main failures cannot hide the confirmed failure.
  {
    const estate = fakeEstate();
    await estate.night(false);
    for (let i = 0; i < 12; i++) await estate.night(true, { ref: 'review-branch' });
    const after = await estate.night(false);
    ok(after.paged.length === 1, '12 passing branch runs between two main failures: the confirmed failure still pages (branch beats are filtered before the read limit)');
  }

  // MIXED VERSIONS. Between the merge and the tick's redeploy (and again after
  // a rollback) one host runs main's old rule and the other this one, on one
  // shared latch. The old rule pages a single failure; this one must not reset
  // that latch, or the two would re-page it every 15 minutes.
  async function oldRuleCheck(estate) {
    const newest = estate.state.heartbeats.filter(row => row.payload.lane === LANE).sort((a, b) => b.id - a.id)[0];
    const latchRow = estate.state.latches.filter(row => row.payload.lane === LANE && row.payload.incident_kind === FAILING_KIND).sort((a, b) => b.id - a.id)[0];
    const latched = Boolean(latchRow) && latchRow.payload.incident_state === 'latched';
    const insert = async state => estate.io().insertEvent(LATCH_ACTION, { lane: LANE, incident_kind: FAILING_KIND, incident_state: state });
    if (newest && newest.payload.ok === false && !latched) {
      estate.state.pages.push({ type: 'monitoring_lane_failing', text: 'old rule' });
      await insert('latched');
      return 1;
    }
    if (newest && newest.payload.ok !== false && latched) await insert('reset');
    return 0;
  }
  for (const order of ['old tick first', 'new host first']) {
    const estate = fakeEstate();
    await estate.night(false); await estate.night(true); await estate.night(false); // F, P, F: one unconfirmed failure
    const pagesBefore = estate.state.pages.filter(page => page.type === 'monitoring_lane_failing').length;
    let pages = 0;
    for (let round = 0; round < 4; round++) {
      estate.state.now += 15 * MIN;
      if (order === 'old tick first') { pages += await oldRuleCheck(estate); await coreModule.runCheck(estate.io()); }
      else { await coreModule.runCheck(estate.io()); pages += await oldRuleCheck(estate); }
    }
    const newPages = estate.state.pages.filter(page => page.type === 'monitoring_lane_failing' && page.text !== 'old rule').length - pagesBefore;
    ok(pages <= 1 && newPages === 0, `mixed versions (${order}): one unconfirmed failure pages at most once in 4 rounds (old rule ${pages}, new rule ${newPages})`);
  }

  // The two silences this file exists to prevent, replayed night by night.
  for (const [label, count] of [['production write drill, 22 nights (2026-07-14 to 08-04)', 22], ['Samples nightly, 26 nights (from 2026-07-13)', 26]]) {
    const estate = fakeEstate();
    const pagedOn = [];
    for (let i = 1; i <= count; i++) {
      const { paged } = await estate.night(false);
      if (paged.length) pagedOn.push(i);
    }
    ok(pagedOn.length === 1 && pagedOn[0] === 2, `${label}: pages once, on night 2, and not on night 1 (paged on ${pagedOn.join(',') || 'none'})`);
  }

  // 2026-10-10/11, replayed with invented run numbers: main failing every day,
  // a branch run failing then passing in the afternoon, main failing again.
  {
    const estate = fakeEstate();
    await estate.night(false);
    await estate.night(false); // confirmed and latched, as it was since 2026-09-29
    const branchFail = await estate.night(false, { ref: 'review-branch' });
    const branchPass = await estate.night(true, { ref: 'review-branch' });
    const mainFail = await estate.night(false);
    ok(branchFail.paged.length === 0 && branchPass.paged.length === 0 && branchPass.result.recovered_failing.length === 0,
      'the branch runs neither page nor end the incident');
    ok(mainFail.paged.length === 0, 'so the next main failure does not page again: the 2026-10-11 page would not have been sent');
  }

  {
    const estate = fakeEstate();
    await coreModule.writeHeartbeat(estate.io({ ref: '' }), LANE, { ok: false });
    ok(!('ref' in estate.state.heartbeats[0].payload), 'a host that does not know its branch writes no `ref` (the beat counts as production)');
  }

  // The Node host records the branch GitHub gives it.
  const host = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'monitoring-watchdog.js'), 'utf8');
  ok(/const GITHUB_REF_NAME = String\(process\.env\.GITHUB_REF_NAME \|\| ''\);/.test(host) && /ref: GITHUB_REF_NAME,/.test(host),
    'the GitHub host passes GITHUB_REF_NAME as the heartbeat branch');

  // The relay shows only a ~96-character summary: both nightlies still fit by name.
  const page = relayPayload(failingPageSpec([
    { lane: 'samples_e2e_nightly', age_minutes: 25 },
    { lane: 'calendar_e2e_nightly', age_minutes: 1405 },
  ]));
  ok(page.issue_identifier.includes('samples_e2e_nightly') && page.issue_identifier.includes('calendar_e2e_nightly') && !/plus\d+more/.test(page.issue_identifier),
    `both failing nightlies are named in the relay summary (${page.issue_identifier})`);
  ok(/on their last 2 runs in a row/.test(page.text), 'and the full text says the failure is confirmed');

  // --- 6. The combined message judges the same way ----------------------------
  const nowIso = new Date(NOW).toISOString();
  const others = WATCHED.filter(lane => !['alert_digest', LANE].includes(lane.key)).map(lane => beat(lane.key));
  const one = digest.laneProblems({ heartbeatRows: [...others, ...nights('PF')], nowMs: NOW });
  ok(!one.some(problem => problem.key === `lane_failing:${LANE}`), 'the combined message ignores one unconfirmed failure');
  const two = digest.laneProblems({ heartbeatRows: [...others, ...nights('FF')], nowMs: NOW });
  const problem = two.find(item => item.key === `lane_failing:${LANE}`);
  ok(problem && /the last two scheduled tests failed/.test(problem.text), `and reports a confirmed one (${nowIso})`);
  const digestSource = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'alert-digest.js'), 'utf8');
  ok(/&order=id\.desc&limit=1`/.test(digestSource)
      && /&or=\(payload->>ref\.is\.null,payload->>ref\.eq\.\$\{watchdog\.PRODUCTION_REF\}\)`/.test(digestSource)
      && /&order=id\.desc&limit=\$\{watchdog\.HEARTBEAT_HISTORY_PER_LANE\}`/.test(digestSource),
    'and reads the same two per-lane windows as the dead-man\'s switch');

  console.log(failures ? `\n${failures} confirmed-failure check(s) failed` : '\nMonitoring confirmed-failure checks passed');
  process.exit(failures ? 1 : 0);
})().catch(error => { console.error(error); process.exit(1); });
