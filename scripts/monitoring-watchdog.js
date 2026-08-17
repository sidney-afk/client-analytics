'use strict';

/*
 * Dead-man's switch for the repository-hosted monitors.
 *
 * THE FAILURE THIS CLOSES
 * Every watcher in this repo alerts on what it FINDS. None of them alert on
 * failing to look. A checker that crashes, is never scheduled, or is silently
 * disabled produces exactly the same signal as a healthy system: nothing. The
 * 2026-07-14..2026-08-04 write-drill outage and the 55-run reconciler-pager
 * outage both ran their full length inside that blind spot.
 *
 * HOW IT WORKS
 * Each monitored lane writes a `monitoring_heartbeat` event when it finishes a
 * run. The watchdog reads the newest heartbeat per lane and pages when one is
 * older than that lane's `max_age_minutes` -- or has never been written at all.
 * "Never" is a stale heartbeat, not an exemption: a lane that has never checked
 * in is precisely the lane nobody would notice was dead.
 *
 * WHO WATCHES THE WATCHDOG
 * The watchdog is itself a lane (`monitoring_watchdog`) and writes its own
 * heartbeat. It runs from two independent workflows on different schedules --
 * `monitoring-deadman.yml` and the reconciler workflow -- and each one's check
 * covers the other's lane. A single dead workflow is therefore still paged by
 * the surviving one. Both being dead at once is a GitHub Actions outage, which
 * is a documented residual, not something a workflow inside Actions can close.
 *
 * LATCHING
 * A stale lane pages ONCE and latches, keyed by lane. It un-latches when a
 * fresh heartbeat for that lane is observed. Without this the watchdog would
 * become the thing it exists to prevent: an unreadable, ignorable stream. That
 * is the same defect that turned the reconciler pager into 20-25 identical DMs
 * a day.
 *
 * PUBLIC SAFETY. Lane keys, ages, counts and GitHub run handles only.
 */

const { sendAlert } = require('./monitoring-alert-relay');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const GITHUB_RUN_ID = String(process.env.GITHUB_RUN_ID || 'local');
const GITHUB_RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.MONITORING_WATCHDOG_DRY_RUN || '');

const HEARTBEAT_ACTION = 'monitoring_heartbeat';
const LATCH_ACTION = 'monitoring_watchdog_latch';

/*
 * `max_age_minutes` is the lane's own cadence plus enough slack to absorb
 * GitHub's well-documented cron drift under load (a ten-minute schedule
 * routinely delivers ~13 runs/day, not 144). Too tight and it becomes noise;
 * too loose and an outage runs for a day before anyone hears about it.
 */
const LANES = Object.freeze([
  { key: 'reconciler_pager', label: 'reconciler drift pager', cadence: 'schedule ~10m (drifts)', max_age_minutes: 240 },
  { key: 'monitoring_watchdog', label: 'monitoring watchdog', cadence: 'schedule 15m + reconciler', max_age_minutes: 180 },
  { key: 'production_write_drill', label: 'production write drill', cadence: 'daily 04:17 UTC', max_age_minutes: 2160 },
  { key: 'b1_incremental_refresh', label: 'B1 incremental refresh', cadence: 'schedule 30m + pager', max_age_minutes: 240 },
  /*
   * Added 2026-08-07 after an audit of what actually alerts.
   *
   * The shadow audit runs daily at 05:17 UTC and was dark on BOTH axes: it
   * emitted no heartbeat, it was absent from this list, and the pager's three
   * `production_shadow_audit_*` alerts live in a transform script that was
   * never applied to the live n8n workflow. Nothing anywhere would have said a
   * word if it stopped.
   *
   * It has already stopped once, silently: an invalid `runner.temp` reference
   * in the job env block made GitHub reject the workflow outright from
   * 2026-07-13, so the audit never ran for weeks. That was found by a human
   * reading the file, not by a monitor.
   *
   * 2160 minutes (36h) matches the write drill: one missed daily run is
   * tolerated for a re-run or a schedule slip, two are not.
   */
  { key: 'production_shadow_audit', label: 'production shadow audit', cadence: 'daily 05:17 UTC', max_age_minutes: 2160 },
  /*
   * Added 2026-08-08, from the reset audit. Both nightlies had been red for
   * WEEKS in silence — samples 26 consecutive nights (since 2026-07-13),
   * calendar 16 (since 2026-07-23) — because their only alarm was a Slack
   * webhook step that degrades to a log warning when its secret is unset, and
   * it was: zero pages across all 42 failures. Same 36h tolerance as the other
   * dailies; the run-and-failed page covers the red itself.
   */
  { key: 'samples_e2e_nightly', label: 'samples E2E nightly', cadence: 'daily 06:00 UTC', max_age_minutes: 2160 },
  { key: 'calendar_e2e_nightly', label: 'calendar E2E nightly', cadence: 'daily 08:00 UTC', max_age_minutes: 2160 },
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function laneByKey(key) {
  return LANES.find(lane => lane.key === clean(key)) || null;
}

function payloadOf(row) {
  const value = row && row.payload;
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return {}; }
}

function ageMinutes(iso, nowMs) {
  const ms = Date.parse(clean(iso));
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, (nowMs - ms) / 60000);
}

/**
 * Newest heartbeat per lane. A heartbeat with `ok:false` still counts as a
 * heartbeat: it proves the lane RAN. Whether the run succeeded is that lane's
 * own alarm's job, and conflating the two is how B1's checkpoint bug (F131)
 * managed to look green while skipping work.
 */
function newestHeartbeats(rows) {
  const newest = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = payloadOf(row);
    const lane = clean(payload.lane);
    if (!laneByKey(lane)) continue;
    const at = clean(payload.at || row.ts);
    if (!newest.has(lane) || Date.parse(at) > Date.parse(newest.get(lane).at)) {
      newest.set(lane, { lane, at, ok: payload.ok !== false, run_id: clean(payload.run_id) });
    }
  }
  return newest;
}

/*
 * Latches are keyed by (KIND, lane), not by lane alone.
 *
 * There are now two independent incidents a lane can be in — it stopped
 * running, and it ran and failed — and they must latch separately. Sharing one
 * key would let a lane that had already latched as stale swallow the page that
 * says it came back and is now failing, which is precisely the transition an
 * operator most needs to hear about.
 *
 * Rows written before this existed carry no `incident_kind` and are read as
 * `stale`, so no historical latch changes meaning.
 */
const STALE_KIND = 'stale';
const FAILING_KIND = 'failing';

function latchKey(kind, lane) {
  return `${kind}:${lane}`;
}

function latchedLanes(rows) {
  const state = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = payloadOf(row);
    const lane = clean(payload.lane);
    if (!lane) continue;
    const kind = clean(payload.incident_kind).toLowerCase() === FAILING_KIND ? FAILING_KIND : STALE_KIND;
    const key = latchKey(kind, lane);
    if (state.has(key)) continue; // rows arrive newest-first
    state.set(key, clean(payload.incident_state).toLowerCase() === 'latched');
  }
  return state;
}

/**
 * Pure decision function: which lanes are dead, which of those are new, and
 * which previously-dead lanes have come back and should un-latch.
 */
function watchdogDecision({ heartbeatRows, latchRows, nowMs, lanes = LANES }) {
  const newest = newestHeartbeats(heartbeatRows);
  const latched = latchedLanes(latchRows);
  const stale = [];
  const recovered = [];
  const healthy = [];
  const failing = [];
  const recoveredFailing = [];

  for (const lane of lanes) {
    const beat = newest.get(lane.key) || null;
    const age = beat ? ageMinutes(beat.at, nowMs) : Infinity;
    const isStale = age > lane.max_age_minutes;
    const wasLatched = latched.get(latchKey(STALE_KIND, lane.key)) === true;
    const row = {
      lane: lane.key,
      label: lane.label,
      max_age_minutes: lane.max_age_minutes,
      age_minutes: Number.isFinite(age) ? Math.round(age) : null,
      // `null` age means no heartbeat has EVER been recorded for this lane.
      ever_seen: Boolean(beat),
      last_run_id: beat ? beat.run_id : null,
    };
    if (isStale && !wasLatched) stale.push(row);
    else if (isStale && wasLatched) healthy.push({ ...row, suppressed: 'already_latched' });
    else if (!isStale && wasLatched) recovered.push(row);
    else healthy.push(row);

    /*
     * DID IT PASS — the half that was missing (2026-08-07).
     *
     * The staleness question above deliberately ignores `ok`, and rightly so:
     * a heartbeat with ok:false still proves the lane RAN, and conflating the
     * two is how F131 looked green while skipping work. But nothing then asked
     * the second question, and the answer was sitting in the heartbeat the
     * whole time.
     *
     * What that cost: the production write drill failed 22 consecutive nights
     * from 2026-07-14 to 2026-08-04, wrote ok:false every time, and sent zero
     * alerts. The conditions that would have caught it were written — in an
     * n8n transform script that was never applied to the live pager. The alarm
     * existed on paper and nowhere else.
     *
     * Only a FRESH heartbeat is judged. A stale lane already pages above, and
     * "it failed" is not a claim anyone can make about a lane that has not run
     * — reporting both for one lane would be two pages for one fact, and the
     * second would be guesswork.
     */
    const isFailing = Boolean(beat) && !isStale && beat.ok === false;
    const wasFailingLatched = latched.get(latchKey(FAILING_KIND, lane.key)) === true;
    if (isFailing && !wasFailingLatched) failing.push(row);
    else if (!isFailing && wasFailingLatched && Boolean(beat) && !isStale) recoveredFailing.push(row);
  }
  return { stale, recovered, healthy, failing, recovered_failing: recoveredFailing };
}

/*
 * The relay truncates the rendered summary at ~96 characters, so lane names
 * have to be ordered by how much an operator needs them, not by lane registry
 * order. Deadest first. Anything that does not fit is reported as `plusNmore`
 * by the relay client rather than silently disappearing — the first real page
 * this switch sent lost two of four lane names to that truncation.
 */
function stalePageSpec(rows) {
  const worst = rows.slice().sort((a, b) => {
    const left = a.ever_seen ? a.age_minutes : Infinity;
    const right = b.ever_seen ? b.age_minutes : Infinity;
    return right - left;
  });
  const detail = worst
    .map(row => `${row.lane}=${row.ever_seen ? `${row.age_minutes}m` : 'never'}/max${row.max_age_minutes}m`);
  return {
    type: 'monitoring_heartbeat_stale',
    // Counts first: even a fully truncated line still says how many lanes died.
    summaryParts: [`lanes${rows.length}`, 'no_heartbeat', ...detail],
    team: 'monitoring',
    count: rows.length,
    runId: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:deadman`,
    details: { lanes: rows.map(row => row.lane) },
    text: `SyncView monitoring dead-man's switch: ${rows.length} lane(s) have no fresh heartbeat. ${detail.join(' ')}`,
  };
}

/*
 * Same truncation discipline as stalePageSpec: counts first, then lane names,
 * because the relay clips the rendered summary at ~96 characters and a fully
 * clipped line must still say how many lanes are failing.
 *
 * A distinct `type` from the stale page matters. These are different problems
 * with different responses — "it stopped running" is usually scheduling or
 * permissions, "it ran and failed" is usually the thing the lane watches — and
 * an operator filtering their DMs should be able to tell them apart without
 * reading the detail.
 */
function failingPageSpec(rows) {
  const detail = rows.map(row => `${row.lane}=failed/${row.age_minutes}m`);
  return {
    type: 'monitoring_lane_failing',
    summaryParts: [`lanes${rows.length}`, 'ran_but_failed', ...detail],
    team: 'monitoring',
    count: rows.length,
    runId: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:deadman`,
    details: { lanes: rows.map(row => row.lane) },
    text: `SyncView monitoring: ${rows.length} lane(s) RAN and reported failure. ${detail.join(' ')}`,
  };
}

async function restRows(path) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

async function insertEvent(action, payload) {
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify([{
      client_slug: '_system',
      action,
      source: 'system',
      actor: 'github-actions-monitoring-watchdog',
      payload,
    }]),
  });
  if (!response.ok) throw new Error(`Supabase ${action} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function writeHeartbeat(laneKey, { ok = true } = {}) {
  const lane = laneByKey(laneKey);
  if (!lane) throw new Error(`unknown monitoring lane: ${laneKey}`);
  const payload = {
    lane: lane.key,
    ok: ok !== false,
    at: new Date().toISOString(),
    run_id: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`,
    max_age_minutes: lane.max_age_minutes,
  };
  if (!DRY_RUN) await insertEvent(HEARTBEAT_ACTION, payload);
  return payload;
}

async function readState() {
  /*
   * ASK EACH LANE FOR ITS OWN NEWEST BEAT. Do not share one window.
   *
   * This used to read the newest `LANES.length * 25` heartbeat rows and pick
   * each lane's newest out of that slice. A row bound cannot satisfy a TIME
   * tolerance: the three ~15-minute lanes emit ~175 rows in about fifteen
   * hours, so every daily lane (36h tolerance) fell off the end of the window
   * and was read as `ever_seen: false` — "never checked in" — while its beat
   * sat in the table, minutes old by its own standard.
   *
   * Measured 2026-08-16: the window spanned 08:17→23:40 and contained
   * {monitoring_watchdog 75, b1_incremental_refresh 62, reconciler_pager 37,
   * calendar_e2e_nightly 1}. THREE of the four daily lanes were invisible.
   * Two of them — samples_e2e_nightly and production_shadow_audit — had beaten
   * `ok:false` for three consecutive nights, and because `isFailing` requires
   * a beat to be present (:218), the real ran-and-failed page was suppressed
   * and replaced by a false "never ran" page. That is precisely the silent
   * nightly failure this lane was built on 2026-08-08 to make impossible.
   *
   * One bounded request per lane is exact by construction and cannot rot as
   * cadences change.
   */
  const [heartbeatRows, latchRows] = await Promise.all([
    Promise.all(LANES.map(lane => restRows(
      `deliverable_events?select=id,ts,payload&action=eq.${HEARTBEAT_ACTION}`
      + `&payload->>lane=eq.${encodeURIComponent(lane.key)}&order=id.desc&limit=1`,
    ))).then(perLane => perLane.flat()),
    // x20, not x10: latch rows now come in two kinds per lane, and the window
    // has to still contain the newest row of EVERY (kind, lane) pair even when
    // one lane flaps far more than the rest. Too small a window silently reads
    // an absent latch as "not latched" and re-pages an incident every 15
    // minutes.
    restRows(`deliverable_events?select=id,ts,payload&action=eq.${LATCH_ACTION}&order=id.desc&limit=${LANES.length * 20}`),
  ]);
  return { heartbeatRows, latchRows };
}

async function runCheck() {
  const { heartbeatRows, latchRows } = await readState();
  const decision = watchdogDecision({ heartbeatRows, latchRows, nowMs: Date.now() });
  let receipt = null;

  if (decision.stale.length && !DRY_RUN) {
    receipt = await sendAlert(stalePageSpec(decision.stale), { webhook: SLACK_WEBHOOK });
    for (const row of decision.stale) {
      await insertEvent(LATCH_ACTION, {
        lane: row.lane,
        incident_state: 'latched',
        age_minutes: row.age_minutes,
        ever_seen: row.ever_seen,
        run_id: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`,
      });
    }
  }
  if (decision.recovered.length && !DRY_RUN) {
    for (const row of decision.recovered) {
      await insertEvent(LATCH_ACTION, {
        lane: row.lane,
        incident_state: 'reset',
        age_minutes: row.age_minutes,
        run_id: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`,
      });
    }
  }

  // The "ran and failed" incident, latched independently of staleness so the
  // two cannot suppress each other.
  let failingReceipt = null;
  if (decision.failing.length && !DRY_RUN) {
    failingReceipt = await sendAlert(failingPageSpec(decision.failing), { webhook: SLACK_WEBHOOK });
    for (const row of decision.failing) {
      await insertEvent(LATCH_ACTION, {
        lane: row.lane,
        incident_kind: FAILING_KIND,
        incident_state: 'latched',
        age_minutes: row.age_minutes,
        run_id: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`,
      });
    }
  }
  if (decision.recovered_failing.length && !DRY_RUN) {
    for (const row of decision.recovered_failing) {
      await insertEvent(LATCH_ACTION, {
        lane: row.lane,
        incident_kind: FAILING_KIND,
        incident_state: 'reset',
        age_minutes: row.age_minutes,
        run_id: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`,
      });
    }
  }

  // The watchdog's own liveness proof, written last so it reflects a completed
  // pass rather than merely a started one.
  const heartbeat = await writeHeartbeat('monitoring_watchdog');

  return {
    mode: 'check',
    dry_run: DRY_RUN || undefined,
    stale: decision.stale,
    recovered: decision.recovered.map(row => row.lane),
    healthy: decision.healthy.map(row => ({ lane: row.lane, age_minutes: row.age_minutes, suppressed: row.suppressed })),
    failing: decision.failing.map(row => row.lane),
    recovered_failing: decision.recovered_failing.map(row => row.lane),
    paged: Boolean(receipt),
    failing_paged: Boolean(failingReceipt),
    failing_relay_http_status: failingReceipt ? failingReceipt.http_status : null,
    failing_delivery_confirmed: failingReceipt ? failingReceipt.delivery_confirmed : null,
    relay_http_status: receipt ? receipt.http_status : null,
    delivery_confirmed: receipt ? receipt.delivery_confirmed : null,
    delivery_reason: receipt ? receipt.delivery_reason : null,
    relay_execution_id: receipt ? receipt.relay_execution_id : null,
    heartbeat_at: heartbeat.at,
  };
}

/**
 * Send one deliberately-labelled page through the real relay and report what
 * came back. This is how "the alarm can reach a human" gets proved without
 * waiting for a genuine incident -- and how the relay's rendered contract was
 * verified after the shape fix.
 */
async function runSelfTest() {
  const receipt = await sendAlert({
    type: 'monitoring_selftest',
    summary: `alert_path_selftest run=${GITHUB_RUN_ID} attempt=${GITHUB_RUN_ATTEMPT} expect=readable_fields`,
    team: 'monitoring',
    count: 1,
    runId: `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}:selftest`,
    details: { purpose: 'delivery_proof' },
    text: 'SyncView monitoring alert-path self-test. If you can read these fields, the relay contract is correct.',
  }, { webhook: SLACK_WEBHOOK });
  return { mode: 'selftest', ...receipt };
}

function parseArgs(argv) {
  const args = new Map();
  for (const raw of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (match) args.set(match[1], match[2] === undefined ? 'true' : match[2]);
  }
  return args;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.has('heartbeat')) {
    const result = await writeHeartbeat(args.get('heartbeat'), { ok: args.get('ok') !== 'false' });
    console.log(JSON.stringify({ mode: 'heartbeat', dry_run: DRY_RUN || undefined, ...result }));
    return;
  }
  if (args.has('selftest')) {
    const result = await runSelfTest();
    console.log(JSON.stringify(result));
    if (!result.accepted) throw new Error('alert relay did not accept the self-test page');
    return;
  }
  const result = await runCheck();
  console.log(JSON.stringify(result));
  // A stale lane is a real incident and must leave the run red, so GitHub's
  // failed-run email backs up the Slack page rather than depending on it.
  if (result.stale.length) throw new Error(`monitoring lanes without a fresh heartbeat: ${result.stale.map(row => row.lane).join(', ')}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error && error.message || String(error));
    process.exit(1);
  });
}

module.exports = {
  HEARTBEAT_ACTION,
  LANES,
  LATCH_ACTION,
  FAILING_KIND,
  STALE_KIND,
  ageMinutes,
  failingPageSpec,
  laneByKey,
  latchKey,
  latchedLanes,
  newestHeartbeats,
  stalePageSpec,
  watchdogDecision,
};
