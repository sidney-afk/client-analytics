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
 * heartbeat. Since 2026-10-09 its PRIMARY host is outside GitHub: the Edge
 * Function `monitoring-watchdog-tick`, called every 15 minutes by Supabase's
 * own timer (pg_cron through pg_net). It also still runs from two independent
 * workflows on different schedules -- `monitoring-deadman.yml` and
 * `monitoring-crosscheck.yml` -- and every host's check covers the others'
 * beat. A single dead host is therefore still seen by a surviving one, and a
 * GitHub Actions outage no longer silences the switch.
 *
 * ONE SOURCE. The lane table, the decision, the page and the `--check` pass
 * itself live in supabase/functions/_shared/monitoring-watchdog-core.mjs,
 * which the Edge Function bundles and this script loads with require(). This
 * file is only the GitHub host's half: environment, transport, CLI.
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

const core = require('../supabase/functions/_shared/monitoring-watchdog-core.mjs');
const { sendAlert } = require('./monitoring-alert-relay');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const SLACK_WEBHOOK = String(process.env.SLACK_ALERT_WEBHOOK || '');
const GITHUB_RUN_ID = String(process.env.GITHUB_RUN_ID || 'local');
const GITHUB_RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');
const DRY_RUN = /^(1|true|yes)$/i.test(process.env.MONITORING_WATCHDOG_DRY_RUN || '');
const RUN_HANDLE = `${GITHUB_RUN_ID}:${GITHUB_RUN_ATTEMPT}`;

const {
  HEARTBEAT_ACTION,
  LANES,
  LATCH_ACTION,
  FAILING_KIND,
  STALE_KIND,
  activeLanes,
  ageMinutes,
  heartbeatFlagFor,
  laneByKey,
  latchKey,
  latchedLanes,
  newestHeartbeats,
  retiredLanes,
  watchdogDecision,
} = core;

// The page carries this run's GitHub handle, exactly as before the core moved.
const stalePageSpec = rows => core.stalePageSpec(rows, RUN_HANDLE);
const failingPageSpec = rows => core.failingPageSpec(rows, RUN_HANDLE);

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

/** The GitHub host's `io` for the shared core. */
function githubIo() {
  return {
    restRows,
    insertEvent,
    sendAlert: spec => sendAlert(spec, { webhook: SLACK_WEBHOOK }),
    runHandle: RUN_HANDLE,
    nowMs: () => Date.now(),
    dryRun: DRY_RUN,
  };
}

async function writeHeartbeat(laneKey, options = {}) {
  return core.writeHeartbeat(githubIo(), laneKey, options);
}

async function runCheck() {
  return core.runCheck(githubIo());
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
  activeLanes,
  ageMinutes,
  failingPageSpec,
  heartbeatFlagFor,
  laneByKey,
  latchKey,
  latchedLanes,
  newestHeartbeats,
  retiredLanes,
  stalePageSpec,
  watchdogDecision,
};
