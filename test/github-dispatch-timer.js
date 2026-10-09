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

console.log(failures ? `github-dispatch-timer: ${failures} check(s) failed` : `github-dispatch-timer checks passed (${rows.length} dispatched, ${Object.keys(SKIPPED).length} skipped)`);
process.exit(failures ? 1 : 0);
