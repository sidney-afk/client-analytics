'use strict';

/*
 * One combined problem message (step 29c of the Linear exit, owner "yes"
 * 2026-09-28; design in docs/ops/LINEAR_EXIT_STEP29C_ALERT_CONSOLIDATION.md).
 *
 * It READS what is wrong right now from the places the existing alerts already
 * read, writes one list, and says nothing when the list is empty or unchanged.
 * It does not replace any existing alert: those keep posting until the owner
 * compares the two and says which to remove.
 *
 * THE SWITCH. `ALERT_DIGEST_ENABLED` must be exactly "true" for anything to be
 * posted. Unset or anything else (the default) means SHADOW: the message that
 * would be sent is printed, and nothing reaches Slack.
 * `--dry-run` (or ALERT_DIGEST_DRY_RUN=1) is stricter still: it also writes no
 * state and no heartbeat, and never touches the relay.
 *
 * WHAT COUNTS AS A PROBLEM (all read-only):
 *   1. a watched lane of scripts/monitoring-watchdog.js has not checked in, or
 *      checked in with ok:false (covers the Samples and Calendar nightlies);
 *   2. the latest completed production run of a watched workflow is red, or
 *      its last success is too old (backup, dawn check, daily analytics copy,
 *      quota watchdog). A production run is the database timer's on-time run
 *      ("(db-timer)" in its title) or a GitHub schedule run that really ran;
 *      a manual run is not one (see productionRuns);
 *   3. a daily analytics job (metrics, Top Videos) that is LIVE recorded a failed
 *      safety check for the day (a client with no result, a platform failed at the
 *      provider, frozen Instagram), or its check has stopped running.
 *
 * WHEN IT SPEAKS. Compared with the last state it saved: a new problem, a
 * higher severity, or changed evidence (a new failing run) posts the whole
 * current list. A problem that is merely still open, or that went away, is
 * quiet. A recovery never posts.
 *
 * PUBLIC SAFETY. Lane keys, ages, counts and run numbers only. No URLs, no
 * client names, no emails: relay's assertPublicSafe backs this up.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const relay = require('./monitoring-alert-relay');
const watchdog = require('./monitoring-watchdog');
const scheduleGuard = require('./schedule-fallback-guard');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const GITHUB_API = 'https://api.github.com';
const REPO = String(process.env.GITHUB_REPOSITORY || 'sidney-afk/client-analytics');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || '');
const RUN_ID = String(process.env.GITHUB_RUN_ID || 'local');
const RUN_ATTEMPT = String(process.env.GITHUB_RUN_ATTEMPT || '1');

const OWN_LANE = 'alert_digest';
const STATE_ACTION = 'alert_digest_state';
const SHADOW_STATE_ACTION = 'alert_digest_shadow_state';
// The most problems one message lists. Past it the message says how many more
// there are and where to read them; it never just stops.
const MAX_LISTED = 12;
const HOUR = 60;

/*
 * Workflows whose latest run says whether something is fine. `max_success_age`
 * is in minutes: the last green run may not be older than that. The backup
 * limit is the same 7 hours the backup script's own alert uses, so the two can
 * be compared like for like.
 */
const WORKFLOW_SOURCES = Object.freeze([
  { key: 'backup', file: 'track-b-backup.yml', severity: 2, max_success_age: 7 * HOUR,
    stale: 'Backup: no verified recovery backup within 7 hours.',
    red: 'Backup: the last backup run failed.' },
  { key: 'dawn_check', file: 'dawn-check.yml', severity: 1, max_success_age: 72 * HOUR,
    stale: 'Morning check: no passing run in the last 3 days.',
    red: 'Morning check: a morning flow failed on the test client.' },
  { key: 'analytics_daily_copy', file: 'sheets-mirror-daily.yml', severity: 1, max_success_age: 36 * HOUR,
    stale: 'Analytics daily copy: no passing run in the last 36 hours.',
    red: 'Analytics daily copy: the copy or the comparison failed.' },
  { key: 'n8n_quota_watchdog', file: 'n8n-execution-quota-watchdog.yml', severity: 1, max_success_age: 36 * HOUR,
    stale: 'Automation allowance check: no passing run in the last 36 hours.',
    red: 'Automation allowance check: the last run failed.' },
]);

// Alerts that exist in the repository or in n8n but are NOT read by this
// message in this version. Printed on every run so quiet is never mistaken for
// "everything is covered".
const NOT_COVERED = Object.freeze([
  'n8n_quota_80 and n8n_quota_90: usage is not read here; the existing watchdog still posts them',
  'the eleven n8n pager conditions: that workflow is switched off (checked 2026-10-02), so none posts today',
  'reconcile_* alerts: their reconciler workflows no longer exist in the repository',
]);

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function ageMinutes(iso, nowMs) {
  const ms = Date.parse(clean(iso));
  return Number.isFinite(ms) ? Math.max(0, (nowMs - ms) / 60000) : Infinity;
}

function span(minutes) {
  const total = Math.round(minutes);
  if (total < 120) return `${total} min`;
  const hours = Math.floor(total / 60);
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  return total % 60 ? `${hours} h ${total % 60} min` : `${hours} h`;
}

// Plain-English names for the two nightly tests, as the design's example reads.
const NIGHTLY_NAMES = Object.freeze({ samples_e2e_nightly: 'Samples nightly', calendar_e2e_nightly: 'Calendar nightly' });

function runNumber(value) {
  return clean(value).split(':')[0].replace(/[^0-9]/g, '') || 'unknown';
}

/** Lane problems, from the same decision the dead-man's switch makes. */
function laneProblems({ heartbeatRows, nowMs, lanes }) {
  const watched = (lanes || watchdog.activeLanes()).filter(lane => lane.key !== OWN_LANE);
  const decision = watchdog.watchdogDecision({ heartbeatRows, latchRows: [], nowMs, lanes: watched });
  const problems = [];
  for (const row of decision.stale) {
    problems.push({
      key: `lane_stale:${row.lane}`,
      severity: 1,
      evidence: 'stale',
      text: row.ever_seen
        ? `Monitoring: ${row.label} has not checked in for ${span(row.age_minutes)} (allowed ${span(row.max_age_minutes)}).`
        : `Monitoring: ${row.label} has never checked in.`,
    });
  }
  for (const row of decision.failing) {
    problems.push({
      key: `lane_failing:${row.lane}`,
      severity: 1,
      evidence: `run:${runNumber(row.last_run_id)}`,
      text: NIGHTLY_NAMES[row.lane]
        ? `${NIGHTLY_NAMES[row.lane]}: last scheduled test failed. Run ${runNumber(row.last_run_id)}.`
        : `${row.label}: the last scheduled run failed. Run ${runNumber(row.last_run_id)}.`,
    });
  }
  // `healthy` rows from a lane that is stale are already in `stale` (latch rows
  // are empty here, so nothing is suppressed).
  return problems;
}

/** The workflow file's own cron, read from the checkout (null when it has none). */
function workflowCron(file) {
  try {
    return scheduleGuard.workflowCrons(fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', file), 'utf8'))[0] || null;
  } catch (_error) {
    return null;
  }
}

/*
 * The runs that say something about production health, newest first (OPEN_REPAIRS 397).
 *
 * Since 2026-10-09 the database timer starts each of these workflows on time through
 * workflow_dispatch, and names that run "<workflow> (db-timer)". Those are production
 * runs. A manual or test run ("(manual)") says nothing about production health and is
 * left out, as before. GitHub still delivers each workflow's own `schedule:` hours late;
 * when the timer already started that slot, the guard job stands the copy down and the
 * run ends "success" having done nothing, so it is not evidence either way. The same
 * function the guard uses (scripts/schedule-fallback-guard.js) decides which copies
 * those were, so the two can never disagree. A schedule run the timer did not cover
 * really ran (the timer missed), and counts. `runs` is every recent run, in progress
 * included, because a copy can be stood down by a timer run that is still running.
 */
function productionRuns(runs, cron) {
  const all = (runs || []).filter(Boolean);
  return all.filter(run => {
    if (run.status !== 'completed') return false;
    if (scheduleGuard.isDbTimerRun(run)) return true;
    if (run.event && run.event !== 'schedule') return false;
    if (!cron) return true;
    return !scheduleGuard.timerCovered({ cron, runs: all, atMs: Date.parse(clean(run.created_at)), branch: run.head_branch }).covered;
  });
}

/** Workflow problems, from each workflow's recent runs (newest first). */
function workflowProblems({ runsByFile, nowMs, sources = WORKFLOW_SOURCES }) {
  const problems = [];
  for (const source of sources) {
    const cron = source.cron === undefined ? workflowCron(source.file) : source.cron;
    const runs = productionRuns(runsByFile[source.file] || [], cron);
    if (!runs.length) {
      problems.push({ key: `workflow_stale:${source.key}`, severity: source.severity, evidence: 'no_run', text: source.stale });
      continue;
    }
    const latest = runs[0];
    if (latest.conclusion !== 'success' && latest.conclusion !== 'skipped') {
      problems.push({
        key: `workflow_red:${source.key}`,
        severity: source.severity,
        evidence: `run:${runNumber(latest.id)}`,
        text: `${source.red} Run ${runNumber(latest.id)}.`,
      });
      continue;
    }
    const lastGreen = runs.find(run => run.conclusion === 'success');
    if (!lastGreen || ageMinutes(lastGreen.updated_at || lastGreen.created_at, nowMs) > source.max_success_age) {
      problems.push({ key: `workflow_stale:${source.key}`, severity: source.severity, evidence: 'stale', text: source.stale });
    }
  }
  return problems;
}

/*
 * The daily analytics jobs' own safety check (docs/plans/2026-10-01-n8n-off-analytics.md,
 * section 8b; it replaces n8n's end-of-run checks once n8n is off). pg_cron records one row
 * per dataset per day in analytics_collect_daily_checks; only a LIVE job's problems are
 * named here. The evidence is the day plus the problem codes, so a problem speaks once per
 * day: still open an hour later is quiet, open again the next day is new evidence.
 * Counts only, never a client.
 */
const COLLECT_DATASETS = Object.freeze([
  { dataset: 'metrics', flag: 'analytics_metrics_collect', label: 'Daily metrics job' },
  { dataset: 'top_videos', flag: 'analytics_top_videos_collect', label: 'Daily Top Videos job' },
]);
const COLLECT_CHECK_MAX_AGE = 30 * HOUR;

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

function collectProblemText(label, row) {
  const r = row.result && typeof row.result === 'object' ? row.result : {};
  const parts = [];
  const problems = Array.isArray(row.problems) ? row.problems : [];
  if (problems.includes('missing_terminal')) {
    parts.push(`${Number(r.missing_terminal) || 0} of ${Number(r.active_clients) || 0} active clients have no result`);
  }
  if (problems.includes('provider_failed')) {
    parts.push(`${plural(Number(r.provider_failed_clients) || 0, 'client', 'clients')} had a platform fail at the provider`);
  }
  if (problems.includes('instagram_frozen')) {
    parts.push(`Instagram looks frozen (${Number(r.instagram_configured) || 0} clients healthy, none gained views)`);
  }
  return `${label} (${clean(row.run_date)}): ${parts.join('; ')}.`;
}

/** Problems of the live daily analytics jobs. collectChecks null = the table could not be read. */
function collectProblems({ collectChecks, collectFlags, nowMs }) {
  if (collectChecks === undefined && collectFlags === undefined) return [];
  const flags = new Map((collectFlags || []).map(row => [row.key, row]));
  const problems = [];
  for (const spec of COLLECT_DATASETS) {
    const flag = flags.get(spec.flag);
    const mode = flag && flag.value && typeof flag.value === 'object' ? flag.value.mode : null;
    if (mode !== 'live') continue;
    if (collectChecks === null) {
      problems.push({ key: `analytics_collect_unreadable:${spec.dataset}`, severity: 1, evidence: 'unreadable',
        text: `${spec.label}: its daily safety check could not be read.` });
      continue;
    }
    const latest = (collectChecks || []).filter(row => row && row.dataset === spec.dataset)
      .sort((a, b) => clean(b.run_date).localeCompare(clean(a.run_date)))[0];
    if (!latest || ageMinutes(latest.checked_at, nowMs) > COLLECT_CHECK_MAX_AGE) {
      // Just switched on: the first check has not had its turn yet.
      if (!latest && ageMinutes(flag.updated_at, nowMs) <= COLLECT_CHECK_MAX_AGE) continue;
      problems.push({ key: `analytics_collect_stale:${spec.dataset}`, severity: 1, evidence: latest ? `since:${clean(latest.run_date)}` : 'never',
        text: `${spec.label}: its daily safety check has not run in the last 30 hours.` });
      continue;
    }
    const codes = (Array.isArray(latest.problems) ? latest.problems : []).map(clean).filter(Boolean).sort();
    if (latest.mode !== 'live' || !codes.length) continue;
    problems.push({ key: `analytics_collect:${spec.dataset}`, severity: 1, evidence: `${clean(latest.run_date)}:${codes.join('+')}`,
      text: collectProblemText(spec.label, { ...latest, problems: codes }) });
  }
  return problems;
}

function sortProblems(problems) {
  return problems.slice().sort((a, b) => (b.severity - a.severity) || a.key.localeCompare(b.key));
}

/**
 * Compare today's problems with the saved ones. `changed` is what justifies
 * speaking: new, more severe, or different evidence.
 */
function compare(problems, previous) {
  const before = new Map((previous || []).map(item => [item.key, item]));
  const marked = problems.map(problem => {
    const old = before.get(problem.key);
    let change = 'same';
    if (!old) change = 'new';
    else if (problem.severity > old.severity) change = 'worse';
    else if (problem.evidence !== old.evidence) change = 'changed';
    return { ...problem, change };
  });
  const now = new Set(problems.map(problem => problem.key));
  const resolved = (previous || []).filter(item => !now.has(item.key)).map(item => item.key);
  return {
    problems: marked,
    resolved,
    new_count: marked.filter(problem => problem.change === 'new').length,
    should_post: marked.some(problem => problem.change !== 'same'),
  };
}

function fingerprint(problems) {
  const body = problems.map(problem => `${problem.key}|${problem.severity}|${problem.evidence}`).sort().join('\n');
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

/** The whole message. Empty list means there is no message at all. */
function renderMessage(problems, newCount) {
  if (!problems.length) return '';
  const total = problems.length;
  const head = `SyncView needs attention: ${total} open problem${total === 1 ? '' : 's'}`
    + (newCount ? ` (${newCount} new)` : '');
  const listed = problems.slice(0, MAX_LISTED);
  const lines = listed.map((problem, index) => `${index + 1}. ${problem.text}`);
  const hidden = total - listed.length;
  if (hidden > 0) lines.push(`Plus ${hidden} more problem${hidden === 1 ? '' : 's'}: see run ${RUN_ID} for the full list.`);
  return [head, ...lines].join('\n');
}

/** One pass over already-collected inputs. Pure: no network, no clock. */
function evaluate({ heartbeatRows, runsByFile, previous, nowMs, lanes, sources, collectChecks, collectFlags }) {
  const problems = sortProblems([
    ...laneProblems({ heartbeatRows, nowMs, lanes }),
    ...workflowProblems({ runsByFile, nowMs, sources }),
    ...collectProblems({ collectChecks, collectFlags, nowMs }),
  ]);
  const verdict = compare(problems, previous);
  return {
    ...verdict,
    fingerprint: fingerprint(problems),
    message: renderMessage(verdict.problems, verdict.new_count),
  };
}

// ---------------------------------------------------------------- collectors

async function supaGet(path) {
  if (!SUPA_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
  const response = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Supabase read HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

async function supaInsertEvent(action, payload) {
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal',
    },
    body: JSON.stringify([{ client_slug: '_system', action, source: 'system', actor: 'github-actions-alert-digest', payload }]),
  });
  if (!response.ok) throw new Error(`Supabase ${action} HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

async function readHeartbeats() {
  const lanes = watchdog.activeLanes().filter(lane => lane.key !== OWN_LANE);
  const perLane = await Promise.all(lanes.map(lane => supaGet(
    `deliverable_events?select=id,ts,payload&action=eq.${watchdog.HEARTBEAT_ACTION}`
    + `&payload->>lane=eq.${encodeURIComponent(lane.key)}&order=id.desc&limit=1`)));
  return perLane.flat();
}

async function readRuns(sources = WORKFLOW_SOURCES) {
  if (!GITHUB_TOKEN) throw new Error('GITHUB_TOKEN is required to read workflow runs');
  const out = {};
  for (const source of sources) {
    // Every event, in progress included: the timer's on-time runs are workflow_dispatch
    // runs, and productionRuns needs them all to tell which schedule copies stood down.
    // 50 runs is several days of the busiest one (the 6-hourly backup).
    const response = await fetch(
      `${GITHUB_API}/repos/${REPO}/actions/workflows/${source.file}/runs?per_page=50&exclude_pull_requests=true`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (!response.ok) throw new Error(`GitHub runs for ${source.file} HTTP ${response.status}`);
    const body = await response.json();
    out[source.file] = (body.workflow_runs || []).map(run => ({
      id: run.id, event: run.event, status: run.status, conclusion: run.conclusion, updated_at: run.updated_at, created_at: run.created_at,
      display_title: run.display_title, head_branch: run.head_branch,
    }));
  }
  return out;
}

// The two analytics jobs' switches, and their recorded daily checks. Before the live
// migration is applied the checks table does not exist: that reads as null, which only
// matters (as a problem) once a job is live.
async function readCollectFlags() {
  return supaGet('syncview_runtime_flags?select=key,value,updated_at&key=in.(analytics_metrics_collect,analytics_top_videos_collect)');
}

async function readCollectChecks() {
  try {
    return await supaGet('analytics_collect_daily_checks?select=run_date,dataset,mode,problems,result,checked_at&order=run_date.desc&limit=6');
  } catch (_error) {
    return null;
  }
}

async function readPrevious(action) {
  const rows = await supaGet(`deliverable_events?select=id,payload&action=eq.${action}&order=id.desc&limit=1`);
  const payload = rows[0] && rows[0].payload;
  const parsed = typeof payload === 'string' ? JSON.parse(payload) : payload;
  return Array.isArray(parsed && parsed.problems) ? parsed.problems : [];
}

// ---------------------------------------------------------------------- post

/**
 * Send the digest through the existing relay. The relay renders only a short
 * single line today (see the plan: a multi-line digest needs one n8n edit, which
 * is NOT made here), so the full text rides in `digest_text`, which an edited
 * relay will show and an unedited one ignores. Until the edit, what arrives is
 * the one-line summary: type, how many problems, and the first few.
 */
async function postDigest(result, { webhook, fetchImpl = fetch, apiKey } = {}) {
  const worst = result.problems.slice(0, 3).map(problem => problem.key.split(':')[1] || problem.key);
  const payload = relay.relayPayload({
    type: 'syncview_digest',
    summaryParts: [`${result.problems.length}_open_problems`, `${result.new_count}_new`, ...worst],
    team: 'account',
    count: result.problems.length,
    runId: `${RUN_ID}:${RUN_ATTEMPT}:digest`,
    details: { purpose: 'combined_problem_message', fingerprint: result.fingerprint },
    text: result.message,
  });
  payload.digest_text = result.message;
  relay.assertPublicSafe(payload);
  const accepted = await relay.postAlert(payload, { webhook, fetchImpl });
  // 2xx proves the relay took it, not that Slack got it. Look for the relay's
  // finished run; without the n8n key the answer is "unknown", never "sent".
  const delivery = await relay.confirmRelayDelivery({
    runId: payload.details.run_id, type: payload.type, apiKey: apiKey === undefined ? process.env.N8N_API_KEY : apiKey, fetchImpl,
  });
  return {
    accepted: accepted.accepted, http_status: accepted.status,
    delivery_confirmed: delivery.confirmed === true, delivery_reason: delivery.reason || null,
    rendered_single_line: payload.issue_identifier,
  };
}

// ---------------------------------------------------------------------- main

function parseArgs(argv) {
  const args = new Map();
  for (const raw of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(raw);
    if (match) args.set(match[1], match[2] === undefined ? 'true' : match[2]);
  }
  return args;
}

function isOn(value) {
  return clean(value) === 'true';
}

async function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const nowMs = args.has('now') ? Date.parse(args.get('now')) : Date.now();
  const enabled = isOn(env.ALERT_DIGEST_ENABLED);
  const dryRun = args.has('dry-run') || /^(1|true|yes)$/i.test(clean(env.ALERT_DIGEST_DRY_RUN));
  const stateAction = enabled ? STATE_ACTION : SHADOW_STATE_ACTION;

  let inputs;
  if (args.has('fixture')) {
    inputs = JSON.parse(fs.readFileSync(args.get('fixture'), 'utf8')); // offline: no network at all
  } else {
    inputs = {
      heartbeatRows: await readHeartbeats(),
      runsByFile: await readRuns(),
      collectFlags: await readCollectFlags(),
      collectChecks: await readCollectChecks(),
      previous: await readPrevious(stateAction),
    };
  }
  const result = evaluate({ ...inputs, nowMs });

  const summary = {
    mode: dryRun ? 'dry_run' : (enabled ? 'live' : 'shadow'),
    switch_on: enabled,
    open_problems: result.problems.length,
    new_problems: result.new_count,
    resolved_quietly: result.resolved,
    would_post: result.should_post,
    fingerprint: result.fingerprint,
    // The complete list, so a message cut at the limit can still be read in full here.
    all_problems: result.problems.map(problem => `${problem.change}: ${problem.text}`),
    not_covered: NOT_COVERED,
  };

  let posted = null;
  if (result.should_post && enabled && !dryRun) {
    posted = await postDigest(result, { webhook: env.SLACK_ALERT_WEBHOOK, apiKey: env.N8N_API_KEY });
  }
  // State moves only after a successful post, so a failed post is retried.
  if (!dryRun && !args.has('fixture')) {
    if (!result.should_post || !enabled || (posted && posted.delivery_confirmed)) {
      await supaInsertEvent(stateAction, { problems: result.problems.map(({ key, severity, evidence }) => ({ key, severity, evidence })), fingerprint: result.fingerprint, run_id: `${RUN_ID}:${RUN_ATTEMPT}` });
    }
  }
  const unconfirmed = Boolean(posted) && !posted.delivery_confirmed;
  return { summary: { ...summary, posted: Boolean(posted), delivery: posted || undefined, state_saved: !dryRun && !args.has('fixture') && !unconfirmed }, message: result.message, unconfirmed };
}

async function main() {
  const { summary, message, unconfirmed } = await run();
  console.log(message ? `----- message ${summary.switch_on ? '(live)' : '(NOT SENT: switch is off)'} -----\n${message}\n-----` : 'No open problems: nothing to say.');
  console.log(JSON.stringify(summary));
  // Left red on purpose: state did not move, so the next hour tries again.
  if (unconfirmed) throw new Error(`relay accepted the digest but delivery was not confirmed (${summary.delivery.delivery_reason})`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || String(error));
    process.exit(1);
  });
}

module.exports = {
  MAX_LISTED, NOT_COVERED, OWN_LANE, STATE_ACTION, SHADOW_STATE_ACTION, WORKFLOW_SOURCES,
  COLLECT_DATASETS, collectProblems,
  compare, evaluate, fingerprint, isOn, laneProblems, postDigest, productionRuns, renderMessage, run, workflowProblems,
};
