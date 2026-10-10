'use strict';

/*
 * THE GITHUB SCHEDULE COPY RUNS ONLY WHEN THE DATABASE TIMER MISSED (OPEN_REPAIRS 397).
 *
 * Since 2026-10-09 the database timer (pg_cron through pg_net,
 * migrations/2026-10-09-github-workflow-dispatch-timer.sql) starts every
 * scheduled workflow on time through the workflow_dispatch API. The workflows
 * kept their `schedule:` blocks "as a fallback", but GitHub keeps delivering
 * those as well, hours late, so every job ran twice. Measured 2026-10-10: the
 * Samples nightly paged twice for one failure, two Calendar E2E runs worked on
 * the test client at the same time, the 6-hourly backup wrote 7 backups in
 * about 21 hours instead of 4, and the roster sync applied twice.
 *
 * This module answers one question for one GitHub schedule run: did the timer
 * already start this workflow for the newest slot of its cron that was due?
 * If yes, the copy stands down (the guard job in
 * .github/workflows/schedule-fallback-guard.yml outputs run=false and every
 * other job of the run is skipped). If not, the copy runs exactly as before,
 * so a dead timer still falls back to GitHub's own schedule.
 *
 * The same function also tells scripts/alert-digest.js which schedule runs did
 * real work, so the guard and the combined problem message cannot disagree.
 *
 * HOW A TIMER RUN IS RECOGNISED. The runs API does not return a dispatch's
 * inputs, so every dispatched workflow sets `run-name`: a workflow with a
 * `source` input names its runs `<workflow> (<inputs.source || event name>)`,
 * one with no inputs `<workflow> (<event name>)`. So a run title ends in
 *   "(db-timer)"           the timer, in a workflow that has a `source` input;
 *   "(workflow_dispatch)"  any dispatch of a workflow with NO inputs at all.
 *                          The timer sends those workflows `{}`, so a timed
 *                          run and a hand-started one are the same run doing
 *                          the same work (test/github-dispatch-timer.js keeps
 *                          them input-free);
 *   anything else ("(manual)", "(schedule)", "(push)") is never a timer run.
 * A cancelled timer run does not count: when the copy replaced it in a
 * concurrency group, the copy has to do the work.
 *
 * THE WINDOW. Let S1 be the newest cron slot at or before the copy was created.
 * The timer's run for S1 normally exists a few seconds after S1, so the copy
 * looks for a timer run created from S1 (two minutes early, for clock skew)
 * up to its own creation. When the copy was created less than five minutes
 * after S1 the timer may not have dispatched S1 yet, so the slot before it
 * also counts. The first slot the timer misses therefore lets the next copy
 * run; a fixed "1.5 x cadence" window would have stood a daily copy down for a
 * whole day after the timer died.
 *
 * FAIL OPEN. Any doubt (an unreadable cron, an API error, no slot found) means
 * run=true: the copy behaves as it did before this guard existed.
 *
 * PUBLIC SAFETY. Prints run numbers, times and a reason code only.
 */

const DUE_GRACE_MINUTES = 5;
const EARLY_TOLERANCE_MINUTES = 2;
const LOOKBACK_MINUTES = 35 * 24 * 60;
const MINUTE = 60000;

const TIMER_TITLE = /\((db-timer|workflow_dispatch)\)$/;
const DB_TIMER_TITLE = /\(db-timer\)$/;

function clean(value) {
  return String(value == null ? '' : value).trim();
}

// ------------------------------------------------------------------ cron

function parseField(spec, min, max) {
  const values = new Set();
  for (const part of String(spec).split(',')) {
    const match = /^(\*|\d+)(?:-(\d+))?(?:\/(\d+))?$/.exec(part.trim());
    if (!match) return null;
    const step = match[3] ? Number(match[3]) : 1;
    if (!(step >= 1)) return null;
    let lo;
    let hi;
    if (match[1] === '*') {
      if (match[2]) return null;
      lo = min; hi = max;
    } else {
      lo = Number(match[1]);
      hi = match[2] ? Number(match[2]) : (match[3] ? max : lo);
    }
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) values.add(v);
  }
  return values.size ? values : null;
}

/** A standard five-field cron (UTC, as GitHub and pg_cron read it), or null. */
function parseCron(expression) {
  const fields = clean(expression).split(/\s+/);
  if (fields.length !== 5) return null;
  const minute = parseField(fields[0], 0, 59);
  const hour = parseField(fields[1], 0, 23);
  const dom = parseField(fields[2], 1, 31);
  const month = parseField(fields[3], 1, 12);
  const dowRaw = parseField(fields[4], 0, 7);
  if (!minute || !hour || !dom || !month || !dowRaw) return null;
  const dow = new Set([...dowRaw].map(v => (v === 7 ? 0 : v)));
  return { minute, hour, dom, month, dow, domAny: fields[2] === '*', dowAny: fields[4] === '*' };
}

function cronMatches(cron, ms) {
  const d = new Date(ms);
  if (!cron.minute.has(d.getUTCMinutes()) || !cron.hour.has(d.getUTCHours()) || !cron.month.has(d.getUTCMonth() + 1)) return false;
  const domOk = cron.dom.has(d.getUTCDate());
  const dowOk = cron.dow.has(d.getUTCDay());
  // Standard cron: when both day fields are restricted, either one matching is enough.
  if (cron.domAny && cron.dowAny) return true;
  if (cron.domAny) return dowOk;
  if (cron.dowAny) return domOk;
  return domOk || dowOk;
}

/** The newest slot of `cron` at or before `atMs` (epoch ms), or null. */
function latestSlot(cron, atMs) {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  if (!parsed || !Number.isFinite(atMs)) return null;
  let t = Math.floor(atMs / MINUTE) * MINUTE;
  for (let i = 0; i <= LOOKBACK_MINUTES; i++, t -= MINUTE) {
    if (cronMatches(parsed, t)) return t;
  }
  return null;
}

/**
 * The earliest creation time a timer run may have and still cover a copy
 * created at `atMs`. Null when no slot can be found (the caller then runs).
 */
function coverWindow(cron, atMs) {
  const parsed = typeof cron === 'string' ? parseCron(cron) : cron;
  const s1 = latestSlot(parsed, atMs);
  if (s1 == null) return null;
  let slot = s1;
  if (atMs - s1 < DUE_GRACE_MINUTES * MINUTE) {
    const s0 = latestSlot(parsed, s1 - MINUTE);
    if (s0 != null) slot = s0;
  }
  return { slot, latest_slot: s1, from: slot - EARLY_TOLERANCE_MINUTES * MINUTE, to: atMs };
}

// ------------------------------------------------------------------ runs

function runTitle(run) {
  return clean(run && (run.display_title != null ? run.display_title : run.name));
}

/** The database timer's own run of a workflow that has a `source` input. */
function isDbTimerRun(run) {
  return Boolean(run) && run.event === 'workflow_dispatch' && DB_TIMER_TITLE.test(runTitle(run));
}

/** A run the guard accepts as the timer's (see the header). */
function countsAsTimerRun(run) {
  return Boolean(run) && run.event === 'workflow_dispatch' && TIMER_TITLE.test(runTitle(run))
    && run.conclusion !== 'cancelled';
}

/**
 * Did the timer already start this workflow for the newest slot that was due
 * when the schedule copy was created? Pure: no network, no clock.
 */
function timerCovered({ cron, runs, atMs, branch }) {
  const window = coverWindow(cron, atMs);
  if (!window) return { covered: false, reason: 'no_slot' };
  const hit = (Array.isArray(runs) ? runs : []).find(run => {
    if (!countsAsTimerRun(run)) return false;
    if (branch && run.head_branch && run.head_branch !== branch) return false;
    const created = Date.parse(clean(run.created_at));
    return Number.isFinite(created) && created >= window.from && created <= window.to;
  });
  return {
    covered: Boolean(hit),
    reason: hit ? 'timer_ran' : 'timer_missed',
    slot: new Date(window.slot).toISOString(),
    timer_run: hit ? hit.id : null,
  };
}

/** The live (uncommented) crons of a workflow file's `on.schedule`. */
function workflowCrons(source) {
  const lines = String(source).split('\n');
  const start = lines.findIndex(line => /^on:/.test(line));
  if (start < 0) return [];
  const crons = [];
  let inSchedule = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    if (/^\s*#/.test(line)) continue;
    if (/^ {2}schedule:\s*(#.*)?$/.test(line)) { inSchedule = true; continue; }
    if (/^ {2}\S/.test(line)) { inSchedule = false; continue; }
    const match = inSchedule && /^\s*-\s*cron:\s*(['"])(.+?)\1/.exec(line);
    if (match) crons.push(match[2]);
  }
  return crons;
}

// ------------------------------------------------------------------ the guard job

async function getJson(url, token, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
  });
  if (!response.ok) throw new Error(`github_http_${response.status}`);
  return response.json();
}

/** The decision for this run. Never throws: any error means run=true. */
async function decide({ env = process.env, fetchImpl = fetch } = {}) {
  if (clean(env.GITHUB_EVENT_NAME) !== 'schedule') return { run: true, reason: 'not_schedule' };
  try {
    const cron = clean(env.SCHEDULE_CRON);
    if (!parseCron(cron)) return { run: true, reason: 'cron_unreadable' };
    const token = clean(env.GITHUB_TOKEN);
    if (!token) return { run: true, reason: 'no_token' };
    const api = `${clean(env.GITHUB_API_URL) || 'https://api.github.com'}/repos/${clean(env.GITHUB_REPOSITORY)}`;
    const own = await getJson(`${api}/actions/runs/${encodeURIComponent(clean(env.GITHUB_RUN_ID))}`, token, fetchImpl);
    const atMs = Date.parse(clean(own.created_at));
    const window = coverWindow(cron, atMs);
    if (!window) return { run: true, reason: 'no_slot' };
    // GitHub's search date syntax: a closed range, whole seconds, UTC. Only the
    // window is listed, so the answer stays a few runs even for a 5-minute lane.
    const second = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const range = encodeURIComponent(`${second(window.from)}..${second(window.to)}`);
    const list = await getJson(
      `${api}/actions/workflows/${encodeURIComponent(String(own.workflow_id))}/runs?event=workflow_dispatch&created=${range}&per_page=100&exclude_pull_requests=true`,
      token, fetchImpl);
    const verdict = timerCovered({ cron, runs: list.workflow_runs, atMs, branch: clean(own.head_branch) });
    return { run: !verdict.covered, ...verdict };
  } catch (error) {
    return { run: true, reason: 'guard_error', error: clean(error && error.message).replace(/[^a-z0-9_]/gi, '_').slice(0, 60) };
  }
}

async function main(env = process.env) {
  const verdict = await decide({ env });
  const fs = require('node:fs');
  const line = verdict.run
    ? `Schedule fallback guard: this run goes ahead (${verdict.reason}).`
    : `Schedule fallback guard: the database timer already started this workflow (run ${verdict.timer_run}) for the slot at ${verdict.slot}, so this late GitHub copy stands down.`;
  try { if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `run=${verdict.run ? 'true' : 'false'}\n`); } catch (_) { /* the job output then defaults to true */ }
  try { if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${line}\n`); } catch (_) { /* summary is a courtesy */ }
  if (verdict.reason === 'guard_error') console.log(`::warning::${line}`);
  console.log(JSON.stringify(verdict));
}

if (require.main === module) {
  main().catch(() => process.exit(0)); // never fail the run: run=true is the default
}

module.exports = {
  DUE_GRACE_MINUTES, EARLY_TOLERANCE_MINUTES,
  countsAsTimerRun, coverWindow, cronMatches, decide, isDbTimerRun, latestSlot, parseCron, runTitle, timerCovered, workflowCrons,
};
