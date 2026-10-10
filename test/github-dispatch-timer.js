'use strict';

/*
 * Locks the database timer that starts every scheduled GitHub workflow on time
 * (OPEN_REPAIRS 388, migrations/2026-10-09-github-workflow-dispatch-timer.sql).
 *
 * GitHub runs this repository's `schedule:` crons hours late, so the database
 * (pg_cron through pg_net) dispatches each scheduled workflow through the
 * workflow_dispatch API at its intended cron. What must hold:
 *
 *   1. Every actively scheduled workflow is EITHER dispatched by the timer OR
 *      on the explicit skip list below with a reason. A new scheduled workflow
 *      cannot appear without someone deciding which.
 *   2. Each dispatch uses the workflow's own cron, and the workflow accepts a
 *      dispatch (has workflow_dispatch, and declares every input sent).
 *   3. A timed dispatch behaves like the schedule: wherever a workflow tells a
 *      scheduled run apart (`github.event_name == 'schedule'`) or treats a
 *      dispatch as manual (`github.event_name == 'workflow_dispatch'` with
 *      inputs), it also recognises `inputs.source == 'db-timer'`, and the
 *      timer sends that input. Manual runs keep their behaviour.
 *   4. No token in the files; the install refuses without a proven token.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');
const TIMER = 'migrations/2026-10-09-github-workflow-dispatch-timer.sql';
const PING = 'migrations/2026-10-09-github-workflow-dispatch-ping.sql';

// Scheduled workflows the timer deliberately does NOT dispatch, and why.
const SKIPPED = Object.freeze({
  'monitoring-deadman.yml': 'the dead-man\'s switch already runs every 15 minutes on the database timer (monitoring-watchdog-tick); this host stays on GitHub\'s own schedule as the independent second observer',
  'monitoring-crosscheck.yml': 'same as monitoring-deadman.yml: the independent second observer must not depend on the timer it observes',
});

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The `on:` block only, and its live (uncommented) crons — the same reading
// test/monitoring-watchdog.js uses for "actively scheduled".
function triggerBlock(source) {
  const lines = String(source).split('\n');
  const start = lines.findIndex(line => /^on:/.test(line));
  if (start < 0) return '';
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\S/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block.join('\n');
}
function liveCrons(source) {
  const crons = [];
  let inSchedule = false;
  for (const line of triggerBlock(source).split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (/^ {2}schedule:\s*(#.*)?$/.test(line)) { inSchedule = true; continue; }
    if (/^ {2}\S/.test(line)) { inSchedule = false; continue; }
    const m = inSchedule && /^\s*-\s*cron:\s*(['"])(.+?)\1/.exec(line);
    if (m) crons.push(m[2]);
  }
  return crons;
}
function dispatchInputs(source) {
  const block = triggerBlock(source);
  const m = /^ {2}workflow_dispatch:\s*(?:#.*)?\n((?: {4,}.*\n?|\s*\n)*)/m.exec(block + '\n');
  if (!/^ {2}workflow_dispatch:/m.test(block)) return null;
  const body = m ? m[1] : '';
  return [...body.matchAll(/^ {6}([a-z_]+):\s*$/gm)].map(x => x[1]);
}

// ---------------------------------------------------------------------------
// The timer's list, read out of the migration.
// ---------------------------------------------------------------------------
const timerSql = read(TIMER);
const rows = [...timerSql.matchAll(/^\s*\('([a-z0-9-]+\.yml)',\s*'([^']+)',\s*'(\{[^']*\})'\),?\s*$/gm)]
  .map(m => ({ workflow: m[1], cron: m[2], inputs: JSON.parse(m[3]) }));
ok(rows.length >= 10, `the timer lists its workflows (${rows.length})`);
ok(new Set(rows.map(r => r.workflow)).size === rows.length, 'no workflow is dispatched twice');

const scheduled = fs.readdirSync(WORKFLOW_DIR).filter(f => /\.ya?ml$/.test(f)).sort()
  .filter(f => liveCrons(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf8')).length > 0);
ok(scheduled.length >= rows.length, `inventory: ${scheduled.length} actively scheduled workflows`);

// 1. The partition, in both directions.
for (const file of scheduled) {
  const dispatched = rows.some(r => r.workflow === file);
  const skipped = Object.prototype.hasOwnProperty.call(SKIPPED, file);
  ok(dispatched !== skipped,
    `${file} is ${dispatched && skipped ? 'BOTH dispatched and skipped' : 'either dispatched by the timer or on the skip list with a reason'}`);
}
for (const row of rows) ok(scheduled.includes(row.workflow), `${row.workflow} (dispatched) is an actively scheduled workflow`);
for (const [file, reason] of Object.entries(SKIPPED)) {
  ok(scheduled.includes(file) && reason.length > 20, `skip-list entry ${file} is a real scheduled workflow with a stated reason`);
  ok(timerSql.includes(file), `the timer file names the skipped ${file} and why`);
}

// THE SINGLE DISPATCHER. lane-ticker.yml was the earlier GitHub-side
// dispatcher of the frequent lanes; it is deleted, so the timer is the only
// thing that dispatches them and no lane is started twice per interval.
ok(!fs.existsSync(path.join(WORKFLOW_DIR, 'lane-ticker.yml')), 'lane-ticker.yml is deleted: the database timer is the single dispatcher');
for (const file of fs.readdirSync(WORKFLOW_DIR).filter(f => /\.ya?ml$/.test(f))) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8').split('\n').filter(line => !/^\s*#/.test(line)).join('\n');
  const dispatchesTimed = rows.filter(row => new RegExp(`(gh workflow run\\s+["']?${row.workflow.replace('.', '\\.')}|workflows/${row.workflow.replace('.', '\\.')}/dispatches)`).test(source));
  ok(dispatchesTimed.length === 0, `${file} does not dispatch a workflow the timer already dispatches${dispatchesTimed.length ? ` (${dispatchesTimed.map(r => r.workflow).join(', ')})` : ''}`);
}

// 2 and 3. Each dispatch matches its workflow.
for (const row of rows) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, row.workflow), 'utf8');
  const crons = liveCrons(source);
  ok(crons.length === 1 && crons[0] === row.cron, `${row.workflow}: timer cron '${row.cron}' is the workflow's own cron (${crons.join(', ')})`);
  const declared = dispatchInputs(source);
  ok(Array.isArray(declared), `${row.workflow} accepts workflow_dispatch`);
  for (const key of Object.keys(row.inputs)) {
    ok(declared && declared.includes(key), `${row.workflow} declares the input '${key}' the timer sends (GitHub refuses undeclared inputs)`);
  }
  const live = source.split('\n').filter(line => !/^\s*#/.test(line));
  const scheduleGates = live.filter(line => /github\.event_name == 'schedule'/.test(line));
  const manualGates = live.filter(line => /github\.event_name == 'workflow_dispatch' && inputs\./.test(line));
  const usesSource = row.inputs.source === 'db-timer';
  if (scheduleGates.length || manualGates.length) {
    ok(usesSource, `${row.workflow} tells scheduled runs apart, so the timer sends source=db-timer`);
  }
  for (const line of scheduleGates) {
    ok(/\(github\.event_name == 'schedule' \|\| inputs\.source == 'db-timer'\)/.test(line),
      `${row.workflow}: a schedule-only branch also runs for the timer: ${line.trim().slice(0, 90)}`);
  }
  for (const line of manualGates) {
    ok(/github\.event_name == 'workflow_dispatch' && inputs\.source != 'db-timer' && inputs\./.test(line),
      `${row.workflow}: a manual-only branch ignores the timer's runs: ${line.trim().slice(0, 90)}`);
  }
  if (usesSource) {
    ok(/^ {6}source:\n {8}description: .+\n {8}type: string\n {8}default: manual$/m.test(source),
      `${row.workflow} declares 'source' as a string defaulting to manual, so manual runs are unchanged`);
  }
}

// The quota watchdog's dry-run overrides read inputs without an event check;
// a timer run must not pick up their manual defaults ("1", "0.01,0.02").
{
  const q = read('.github/workflows/n8n-execution-quota-watchdog.yml');
  ok(/N8N_QUOTA_CAP_OVERRIDE: \$\{\{ inputs\.source != 'db-timer' && inputs\.cap_override \|\| '' \}\}/.test(q)
    && /N8N_QUOTA_THRESHOLDS_OVERRIDE: \$\{\{ inputs\.source != 'db-timer' && inputs\.thresholds_override \|\| '' \}\}/.test(q),
  'a timer run of the quota watchdog uses no dry-run override, exactly like the schedule');
}
// The two dispatched workflows with a destructive or alternate path keep it
// manual-only: their defaults are what the schedule does.
{
  const t = read('.github/workflows/track-b-backup.yml');
  ok(/restore_rehearsal:[\s\S]{0,200}?default: false/.test(t)
    && /if: github\.event_name == 'workflow_dispatch' && inputs\.source != 'db-timer' && inputs\.restore_rehearsal == true/.test(t),
    'track-b-backup: the destructive restore rehearsal can only be asked for by hand, never by the timer');
  ok(/backup_corpus:[\s\S]{0,400}?default: configured/.test(t),
    'track-b-backup: the timer\'s run uses the configured corpus, like the schedule');
  ok(!rows.find(r => r.workflow === 'track-b-backup.yml').inputs.restore_rehearsal, 'the timer never asks for a restore rehearsal');
}

// ---------------------------------------------------------------------------
// 4. The SQL itself.
// ---------------------------------------------------------------------------
{
  const strip = sql => sql.replace(/--.*$/gm, '');
  const timer = strip(timerSql);
  const ping = strip(read(PING));
  ok(/^-- STATE: BUILT, NOT APPLIED/.test(timerSql) && /^-- STATE: BUILT, NOT APPLIED/.test(read(PING)), 'both files say they are not applied');
  ok(/perform cron\.schedule\(\s*'gh-dispatch-' \|\| regexp_replace\(r\.workflow, '\\\.yml\$', ''\),\s*r\.schedule,/.test(timer),
    'one pg_cron job per workflow, named gh-dispatch-<workflow>, on that workflow\'s cron');
  ok(timer.includes("'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/' || r.workflow || '/dispatches'"),
    'each job dispatches that workflow of this repository');
  ok(/jsonb_build_object\('ref', 'main', 'inputs', %L::jsonb\)/.test(timer), 'every dispatch runs main');
  for (const [name, sql] of [['timer', timer], ['ping', ping]]) {
    ok(sql.includes("'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'github_dispatch_token' limit 1)"),
      `${name}: the token is read from Vault when the call is made, never stored in a job`);
    ok(sql.includes("'User-Agent', 'syncview-db-timer'"), `${name}: sends a User-Agent (GitHub refuses requests without one)`);
  }
  ok(/perform cron\.unschedule\(jobid\) from cron\.job where jobname like 'gh-dispatch-%'/.test(timer),
    're-running the file replaces the jobs instead of adding duplicates');
  ok(/raise exception 'no successful token READ/.test(timer) && /raise exception 'no successful token DISPATCH \(204\)/.test(timer),
    'the timer refuses to install unless the ping proved the token can read AND dispatch');
  ok(ping.includes("net.http_get(") && ping.includes('card-calendar-status-drift.yml/dispatches'),
    'the ping reads one workflow and dispatches one read-only workflow');
  ok(/^begin;$/m.test(timer) && /^commit;$/m.test(timer) && /^begin;$/m.test(ping) && /^commit;$/m.test(ping), 'each file is one transaction');
  for (const [name, raw] of [['timer', timerSql], ['ping', read(PING)]]) {
    ok(!/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|vault\.create_secret\('(?!<paste)/.test(raw),
      `${name} file carries no token: it is only ever pasted into Vault by hand`);
  }
  const watchdogSchedule = read('migrations/2026-10-09-monitoring-watchdog-tick-schedule.sql');
  ok(/if not exists \(select 1 from cron\.job where jobname like 'gh-dispatch-%' and active\) then\s*raise exception 'apply 2026-10-09-github-workflow-dispatch-timer\.sql first/.test(watchdogSchedule),
    'the watchdog timer refuses to install before the dispatch timer exists (lanes would still run late)');
}

// ---------------------------------------------------------------------------
// 5. THE SCHEDULE COPY IS A REAL FALLBACK (OPEN_REPAIRS 397).
//
// The `schedule:` blocks were kept "as a fallback", but GitHub kept delivering
// them, hours late, so every dispatched job ran twice: on 2026-10-10 the
// Samples nightly paged twice for one failure, two Calendar E2E runs worked on
// the test client at once, the backup ran 7 times in about 21 hours instead of
// 4, and the roster sync applied twice. The check above only proved the timer
// dispatched nothing twice; GitHub's own copy was invisible to it.
//
// What must hold now: every dispatched workflow names its runs by who started
// them, runs the shared guard job first, and gates every other job on it. The
// guard (scripts/schedule-fallback-guard.js) stands a schedule copy down when
// the timer already started the slot, and lets it run when the timer missed.
// ---------------------------------------------------------------------------
const guard = require('../scripts/schedule-fallback-guard.js');
// A workflow with a `source` input names the timer's runs "(db-timer)"; one with no
// inputs at all names every dispatched run "(workflow_dispatch)" (it has no
// `inputs.source` to read, and actionlint rightly refuses an undeclared input).
const RUN_NAME_SOURCE = 'run-name: ${{ github.workflow }} (${{ inputs.source || github.event_name }})';
const RUN_NAME_PLAIN = 'run-name: ${{ github.workflow }} (${{ github.event_name }})';
const GUARD_JOB = [
  '  schedule-guard:',
  '    # The GitHub schedule copy runs only when the database timer missed this slot (OPEN_REPAIRS 397).',
  '    uses: ./.github/workflows/schedule-fallback-guard.yml',
  '    permissions:',
  '      actions: read',
  '      contents: read',
].join('\n');
const GATE = "needs.schedule-guard.outputs.run == 'true'";
const E2E_GROUP = /^ {4}concurrency:\n {6}group: test-client-e2e\n {6}cancel-in-progress: false$/m;

function jobsOf(source) {
  const lines = String(source).split('\n');
  const start = lines.findIndex(line => /^jobs:\s*$/.test(line));
  const jobs = new Map();
  let current = null;
  for (let i = start + 1; start >= 0 && i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break;
    const id = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (id) { current = { id: id[1], lines: [] }; jobs.set(id[1], current); continue; }
    if (current) current.lines.push(line);
  }
  for (const job of jobs.values()) {
    const body = job.lines.join('\n');
    const needsLine = /^ {4}needs:[ \t]*(.*)$/m.exec(body);
    let needs = [];
    if (needsLine && needsLine[1].trim()) needs = needsLine[1].replace(/[[\]\s'"]/g, '').split(',').filter(Boolean);
    else if (needsLine) needs = [...body.slice(needsLine.index).matchAll(/^ {6}-\s*([A-Za-z0-9_-]+)\s*$/gm)].map(m => m[1]);
    const cond = /^ {4}if:\s*(.+)$/m.exec(body);
    Object.assign(job, { body, needs, if: cond ? cond[1].trim() : '' });
  }
  return jobs;
}

{
  const guardWorkflow = read('.github/workflows/schedule-fallback-guard.yml');
  ok(/^on:\n {2}workflow_call:/m.test(guardWorkflow) && !/^ {2}(schedule|push|pull_request|workflow_dispatch):/m.test(guardWorkflow),
    'the guard is a reusable workflow and nothing else starts it');
  ok(/run: \$\{\{ steps\.guard\.outputs\.run \|\| 'true' \}\}/.test(guardWorkflow),
    'the guard says run=true unless its check positively found the timer\'s run (fail open)');
  ok((guardWorkflow.match(/continue-on-error: true/g) || []).length === 2
    && (guardWorkflow.match(/if: github\.event_name == 'schedule'/g) || []).length === 2,
    'only a GitHub schedule run is checked, and a failing check can never fail or skip the caller');
  ok(/permissions:\n {6}actions: read\n {6}contents: read\n/.test(guardWorkflow) && !/: write\b/.test(guardWorkflow),
    'the guard can read runs and nothing more');
  ok(/SCHEDULE_CRON: \$\{\{ github\.event\.schedule \}\}/.test(guardWorkflow) && /run: node scripts\/schedule-fallback-guard\.js/.test(guardWorkflow),
    'the guard judges the copy against the cron that started it');
}

for (const row of rows) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, row.workflow), 'utf8');
  if (!liveCrons(source).length) continue;
  const runName = row.inputs.source === 'db-timer' ? RUN_NAME_SOURCE : RUN_NAME_PLAIN;
  ok(source.split('\n')[1] === runName,
    `${row.workflow} names each run by who started it, so a timer run can be told from a manual one (${runName.slice(10)})`);
  ok(source.includes(`\n${GUARD_JOB}\n`),
    `${row.workflow} runs the shared schedule-fallback guard job, byte for byte`);
  const jobs = jobsOf(source);
  const gated = new Map();
  const isGated = id => {
    if (gated.has(id)) return gated.get(id);
    gated.set(id, false);
    const job = jobs.get(id);
    // The gate must be one of the job condition's top-level AND terms.
    const terms = /\|\|/.test(job ? job.if : '') ? [] : String(job ? job.if : '').split(' && ').map(term => term.trim());
    const direct = Boolean(job) && job.needs.includes('schedule-guard') && terms.includes(GATE);
    const indirect = Boolean(job) && job.needs.length > 0 && job.needs.every(n => n !== 'schedule-guard' && isGated(n))
      && !/always\(\)|cancelled\(\)|failure\(\)/.test(job.if);
    gated.set(id, direct || indirect);
    return direct || indirect;
  };
  for (const id of jobs.keys()) {
    if (id === 'schedule-guard') continue;
    ok(isGated(id), `${row.workflow}: job '${id}' waits for the guard and is skipped when the timer already ran`);
  }
  const declared = dispatchInputs(source) || [];
  if (row.inputs.source !== 'db-timer') {
    ok(declared.length === 0 && Object.keys(row.inputs).length === 0,
      `${row.workflow} takes no inputs and the timer sends none, so any dispatched run is the same run the timer starts`);
  }
}
for (const file of Object.keys(SKIPPED)) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8');
  ok(!source.includes('schedule-fallback-guard'), `${file} stays on GitHub's own schedule with no guard (it observes the timer)`);
}

// The three browser runs that write to the test client never overlap.
for (const file of ['calendar-e2e-nightly.yml', 'samples-e2e-nightly.yml', 'dawn-check.yml']) {
  const jobs = jobsOf(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf8'));
  const writers = [...jobs.values()].filter(job => /SYNCVIEW_STAFF_KEY/.test(job.body));
  ok(writers.length >= 1 && writers.every(job => E2E_GROUP.test(job.body)),
    `${file}: every job holding the test-client key queues in the shared test-client-e2e group (never cancelled mid-run)`);
}
// The polish gate's late schedule copy used to land in the same cancel-in-progress
// group as the run the timer had started, and cancel it.
ok(/^ {2}group: production-polish-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name \}\}$/m.test(read('.github/workflows/production-polish-gate.yml')),
  'production-polish-gate: a schedule copy, a timer run and a push each get their own group, so one cannot cancel another');

// The guard's decision itself.
{
  const at = iso => Date.parse(iso);
  const run = (id, title, created, extra = {}) => ({ id, event: 'workflow_dispatch', display_title: title, created_at: created, head_branch: 'main', conclusion: 'success', ...extra });
  ok(rows.every(r => guard.parseCron(r.cron)), 'every timer cron parses');
  ok(guard.latestSlot('23 */6 * * *', at('2026-10-10T06:04:00Z')) === at('2026-10-10T00:23:00Z'), 'latest slot of a 6-hourly cron');
  ok(guard.latestSlot('30 11 * * 1-5', at('2026-10-12T09:00:00Z')) === at('2026-10-09T11:30:00Z'), 'a weekday cron on a Monday morning looks back to Friday');
  ok(guard.latestSlot('2-59/5 * * * *', at('2026-10-10T12:06:30Z')) === at('2026-10-10T12:02:00Z'), 'stepped ranges parse');

  // Measured 2026-10-10: timer run 06:00:02, GitHub's copy 12:18:02, both paged.
  const samples = guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'), branch: 'main',
    runs: [run(38029402444, 'Samples E2E (nightly) (db-timer)', '2026-10-10T06:00:02Z', { conclusion: 'failure' })] });
  ok(samples.covered && samples.timer_run === 38029402444, 'the late Samples copy stands down: the timer already ran (and failed, and paged) for 06:00');
  ok(!guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'),
    runs: [run(1, 'Samples E2E (nightly) (db-timer)', '2026-10-09T06:00:02Z')] }).covered,
  'a dead timer: yesterday\'s timer run does not cover today, so the copy runs');
  ok(!guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'),
    runs: [run(2, 'Samples E2E (nightly) (manual)', '2026-10-10T07:00:00Z')] }).covered,
  'a manual run is not the timer: the copy still runs');
  ok(!guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'),
    runs: [run(3, 'Samples E2E (nightly) (db-timer)', '2026-10-10T06:00:02Z', { conclusion: 'cancelled' })] }).covered,
  'a cancelled timer run does not count');
  ok(!guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'),
    runs: [run(4, 'Samples E2E (nightly) (db-timer)', '2026-10-10T06:00:02Z', { head_branch: 'feature' })], branch: 'main' }).covered,
  'a timer-looking run on another branch does not count');
  ok(guard.timerCovered({ cron: '*/5 * * * *', atMs: at('2026-10-10T12:03:00Z'),
    runs: [run(5, 'Native notification sender (workflow_dispatch)', '2026-10-10T11:55:02Z')] }).covered,
  'a no-input workflow: any dispatched run is the timer\'s run; within five minutes of a slot the slot before still counts');
  ok(!guard.timerCovered({ cron: '*/5 * * * *', atMs: at('2026-10-10T12:03:00Z'),
    runs: [run(6, 'Native notification sender (workflow_dispatch)', '2026-10-10T11:50:02Z')] }).covered,
  'two missed 5-minute slots: the copy runs');
  ok(guard.timerCovered({ cron: '23 */6 * * *', atMs: at('2026-10-09T22:45:00Z'),
    runs: [run(7, 'Track-B private backup (db-timer)', '2026-10-09T18:23:01Z')] }).covered,
  'the backup copy at 22:45 stands down for the timer\'s 18:23 run (measured 2026-10-09)');
  ok(guard.timerCovered({ cron: '30 11 * * 1-5', atMs: at('2026-10-12T16:00:00Z'),
    runs: [run(8, 'Dawn check (weekday mornings) (db-timer)', '2026-10-12T11:30:03Z')] }).covered
    && !guard.timerCovered({ cron: '30 11 * * 1-5', atMs: at('2026-10-12T16:00:00Z'),
      runs: [run(9, 'Dawn check (weekday mornings) (db-timer)', '2026-10-09T11:30:03Z')] }).covered,
  'dawn check: Monday\'s timer run covers Monday\'s copy; Friday\'s does not');
  ok(!guard.timerCovered({ cron: '0 6 * * *', atMs: at('2026-10-10T12:18:02Z'),
    runs: [run(10, 'Samples E2E (nightly) (db-timer)', '2026-10-10T12:30:00Z')] }).covered,
  'a timer run created after the copy is not counted (the combined message judges the same way)');
}

(async () => {
  const env = { GITHUB_EVENT_NAME: 'schedule', SCHEDULE_CRON: '0 6 * * *', GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '42' };
  const urls = [];
  const fakeFetch = runs => async url => {
    urls.push(String(url));
    if (/\/actions\/runs\/42$/.test(url)) return { ok: true, json: async () => ({ id: 42, workflow_id: 7, created_at: '2026-10-10T12:18:02Z', head_branch: 'main' }) };
    return { ok: true, json: async () => ({ workflow_runs: runs }) };
  };
  const timerRun = { id: 1, event: 'workflow_dispatch', display_title: 'X (db-timer)', created_at: '2026-10-10T06:00:02Z', head_branch: 'main', conclusion: 'success' };
  const stand = await guard.decide({ env, fetchImpl: fakeFetch([timerRun]) });
  ok(stand.run === false && stand.reason === 'timer_ran', 'decide: a schedule copy whose slot the timer ran stands down');
  ok(urls.some(u => /\/actions\/workflows\/7\/runs\?event=workflow_dispatch&created=2026-10-10T05%3A58%3A00Z\.\.2026-10-10T12%3A18%3A02Z&/.test(u)),
    'decide: it lists only this workflow\'s dispatched runs between the slot and the copy');
  ok((await guard.decide({ env, fetchImpl: fakeFetch([]) })).run === true, 'decide: no timer run, the copy runs');
  ok((await guard.decide({ env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, fetchImpl: async () => { throw new Error('no call'); } })).run === true,
    'decide: anything but a schedule run goes ahead without a call');
  const broken = await guard.decide({ env, fetchImpl: async () => ({ ok: false, status: 502 }) });
  ok(broken.run === true && broken.reason === 'guard_error', 'decide: an API error fails open, so the copy runs');
  ok((await guard.decide({ env: { ...env, SCHEDULE_CRON: 'not a cron' }, fetchImpl: fakeFetch([timerRun]) })).run === true,
    'decide: an unreadable cron fails open');

  console.log(failures ? `github-dispatch-timer: ${failures} check(s) failed` : `github-dispatch-timer checks passed (${rows.length} dispatched, ${Object.keys(SKIPPED).length} skipped)`);
  process.exit(failures ? 1 : 0);
})();
