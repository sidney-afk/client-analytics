'use strict';
/*
 * The combined problem message (step 29c). Offline: no network, no Slack, no
 * database. Every post goes to a fake fetch that records the call.
 */
const fs = require('node:fs');
const path = require('node:path');
const digest = require('../scripts/alert-digest.js');
const watchdog = require('../scripts/monitoring-watchdog.js');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}

const ROOT = path.join(__dirname, '..');
const NOW = Date.parse('2026-10-02T17:00:00Z');
const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/alert-digest-demo.json'), 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const evalFx = (patch = {}) => digest.evaluate({ ...clone(fixture), nowMs: NOW, ...patch });

// --- the demo: three problems, one already known
const demo = evalFx();
ok(demo.problems.length === 3, 'demo lists three open problems');
ok(demo.new_count === 2 && demo.should_post, 'two are new, so it speaks');
ok(/^SyncView needs attention: 3 open problems \(2 new\)\n1\. Backup:/.test(demo.message), 'header counts problems and new ones; the backup (severity 2) is first');
ok(!/—/.test(demo.message), 'the message has no long dashes');
ok(demo.message.includes('Samples nightly: last scheduled test failed. Run 41000000001.'), 'nightly failure is in plain words with a run number');

// --- quiet when fine
const healthy = evalFx({
  heartbeatRows: fixture.heartbeatRows.map(row => ({ ...row, ts: '2026-10-02T16:55:00Z', payload: { ...row.payload, ok: true, at: '2026-10-02T16:55:00Z' } })),
  runsByFile: Object.fromEntries(Object.entries(fixture.runsByFile).map(([file, runs]) => [file, [{ ...runs[0], updated_at: '2026-10-02T16:00:00Z' }]])),
  previous: [],
});
ok(healthy.problems.length === 0 && healthy.message === '' && !healthy.should_post, 'everything fine: no message at all');

// --- the daily analytics jobs' safety check (plan section 8b): names a LIVE job's problems once a day
{
  const fineInputs = {
    heartbeatRows: fixture.heartbeatRows.map(row => ({ ...row, ts: '2026-10-02T16:55:00Z', payload: { ...row.payload, ok: true, at: '2026-10-02T16:55:00Z' } })),
    runsByFile: Object.fromEntries(Object.entries(fixture.runsByFile).map(([file, runs]) => [file, [{ ...runs[0], updated_at: '2026-10-02T16:00:00Z' }]])),
    previous: [],
  };
  const flags = (metrics, top = 'shadow', updated = '2026-09-30T00:00:00Z') => [
    { key: 'analytics_metrics_collect', value: { mode: metrics }, updated_at: updated },
    { key: 'analytics_top_videos_collect', value: { mode: top }, updated_at: updated }];
  const checkRow = (dataset, problems, result = {}, mode = 'live', day = '2026-10-02', at = '2026-10-02T09:07:00Z') =>
    ({ run_date: day, dataset, mode, problems, checked_at: at,
      result: { active_clients: 36, terminal_clients: 36, missing_terminal: 0, provider_failed_clients: 0, instagram_configured: 30, ...result } });
  const quietTop = checkRow('top_videos', [], {}, 'shadow', '2026-10-02', '2026-10-02T13:07:00Z');
  const run = (collectChecks, collectFlags, previous = []) => digest.evaluate({ ...clone(fineInputs), previous, nowMs: NOW, collectChecks, collectFlags });

  let r = run([checkRow('metrics', []), quietTop], flags('live'));
  ok(r.problems.length === 0 && !r.should_post, 'live job, clean check: quiet');
  r = run([checkRow('metrics', ['missing_terminal'], { missing_terminal: 2, terminal_clients: 34 }), quietTop], flags('live'));
  ok(r.problems.length === 1 && r.should_post && r.message.includes('Daily metrics job (2026-10-02): 2 of 36 active clients have no result.'), 'a client with no result is named, as a count');
  r = run([checkRow('metrics', ['provider_failed'], { provider_failed_clients: 1 }), quietTop], flags('live'));
  ok(r.message.includes('1 client had a platform fail at the provider'), 'a provider failure is named, as a count');
  r = run([checkRow('metrics', ['instagram_frozen'], { instagram_configured: 30 }), quietTop], flags('live'));
  ok(r.message.includes('Instagram looks frozen (30 clients healthy, none gained views)'), 'frozen Instagram is named');
  const all3 = run([checkRow('metrics', ['provider_failed', 'missing_terminal', 'instagram_frozen'], { missing_terminal: 1, provider_failed_clients: 3 }), quietTop], flags('live'));
  ok(all3.problems.length === 1 && all3.problems[0].text.split(';').length === 3, 'three conditions on one day are one line of the one message');
  ok(!/[a-z]+[0-9]*\s*\(slug\)|client_slug/.test(all3.message), 'counts only in the message');

  const again = run([checkRow('metrics', ['instagram_frozen'], { instagram_configured: 30 }), quietTop], flags('live'),
    [{ key: 'analytics_collect:metrics', severity: 1, evidence: '2026-10-02:instagram_frozen' }]);
  ok(again.problems.length === 1 && !again.should_post, 'the same problem an hour later: quiet (it was said once)');
  const nextDay = digest.evaluate({ ...clone(fineInputs), nowMs: NOW + 24 * 3600000,
    heartbeatRows: fineInputs.heartbeatRows.map(row => ({ ...row, ts: '2026-10-03T16:55:00Z', payload: { ...row.payload, at: '2026-10-03T16:55:00Z' } })),
    runsByFile: Object.fromEntries(Object.entries(fineInputs.runsByFile).map(([file, runs]) => [file, [{ ...runs[0], updated_at: '2026-10-03T16:00:00Z' }]])),
    collectChecks: [checkRow('metrics', ['instagram_frozen'], {}, 'live', '2026-10-03', '2026-10-03T09:07:00Z')], collectFlags: flags('live'),
    previous: [{ key: 'analytics_collect:metrics', severity: 1, evidence: '2026-10-02:instagram_frozen' }] });
  ok(nextDay.should_post && nextDay.problems.find(p => p.key === 'analytics_collect:metrics').change === 'changed', 'the same problem the next day is said again, once');

  r = run([checkRow('metrics', ['missing_terminal'], { missing_terminal: 5 }, 'shadow')], flags('shadow'));
  ok(r.problems.length === 0, 'a job in shadow never alerts (n8n still has its own checks)');
  r = run([checkRow('top_videos', ['provider_failed'], { provider_failed_clients: 2 }, 'live', '2026-10-02', '2026-10-02T13:07:00Z')], flags('shadow', 'live'));
  ok(r.problems.length === 1 && r.message.includes('Daily Top Videos job (2026-10-02): 2 clients had a platform fail at the provider.'), 'Top Videos problems are named too');
  r = run([checkRow('metrics', [], {}, 'live', '2026-09-30', '2026-09-30T09:07:00Z')], flags('live'));
  ok(r.problems.length === 1 && r.problems[0].key === 'analytics_collect_stale:metrics', 'a live job whose check stopped running is named');
  r = run([], flags('live', 'shadow', '2026-10-02T12:00:00Z'));
  ok(r.problems.length === 0, 'switched to live a few hours ago, before its first check: quiet');
  r = run(null, flags('live'));
  ok(r.problems.length === 1 && r.problems[0].key === 'analytics_collect_unreadable:metrics', 'a live job whose check table cannot be read is named');
  r = run(null, flags('shadow'));
  ok(r.problems.length === 0, 'before the migration (no table) and nothing live: quiet');
  ok(evalFx().problems.length === 3, 'inputs without the analytics checks behave exactly as before');
}

// --- dedupe, severity, evidence, recovery
const known = clone(demo.problems).map(({ key, severity, evidence }) => ({ key, severity, evidence }));
const same = evalFx({ previous: known });
ok(!same.should_post && same.new_count === 0, 'unchanged open problems stay quiet');
ok(same.fingerprint === demo.fingerprint, 'fingerprint is stable for the same problems');
const worse = evalFx({ previous: known.map(item => item.key.startsWith('workflow_stale:backup') ? { ...item, severity: 1 } : item) });
ok(worse.should_post && worse.problems.find(p => p.key === 'workflow_stale:backup').change === 'worse', 'a higher severity speaks again');
const newEvidence = evalFx({ previous: known.map(item => item.key.startsWith('lane_failing:') ? { ...item, evidence: 'run:1' } : item) });
ok(newEvidence.should_post, 'a new failing run (changed evidence) speaks again');
const recovered = evalFx({ previous: [...known, { key: 'lane_stale:gone', severity: 1, evidence: 'stale' }] });
ok(!recovered.should_post && recovered.resolved.includes('lane_stale:gone'), 'a recovery is recorded but never posts');

// --- bounded and complete
const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${String(i).padStart(2, '0')}`, severity: 1, evidence: 'x', text: `Problem ${i}.` }));
const big = digest.renderMessage(many, 20);
ok(big.split('\n').length === digest.MAX_LISTED + 2, 'a long list is bounded');
ok(/Plus 8 more problems: see run/.test(big), 'what is left out is counted, never silently dropped');

// --- scheduled runs only
const manualGreen = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
  { id: 2, event: 'workflow_dispatch', status: 'completed', conclusion: 'success', updated_at: '2026-10-02T16:50:00Z' },
  { id: 1, event: 'schedule', status: 'completed', conclusion: 'failure', updated_at: '2026-10-02T10:00:00Z' }] }, nowMs: NOW, sources: digest.WORKFLOW_SOURCES.filter(s => s.key === 'backup') });
ok(manualGreen.length === 1 && manualGreen[0].key === 'workflow_red:backup', 'a manual green run cannot hide a failed scheduled run');
const manualRed = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
  { id: 3, event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', updated_at: '2026-10-02T16:50:00Z' },
  { id: 1, event: 'schedule', status: 'completed', conclusion: 'success', updated_at: '2026-10-02T16:00:00Z' }] }, nowMs: NOW, sources: digest.WORKFLOW_SOURCES.filter(s => s.key === 'backup') });
ok(manualRed.length === 0, 'a manual red test run is not a production incident');

// --- the database timer's runs are production runs too (OPEN_REPAIRS 397)
// Since 2026-10-09 the on-time run of every judged workflow is a workflow_dispatch
// the database timer starts, titled "... (db-timer)". The digest used to read
// event=schedule only, so it judged health from GitHub's late copies alone.
{
  const backup = digest.WORKFLOW_SOURCES.filter(s => s.key === 'backup');
  const T = (id, event, title, conclusion, created, updated = created) =>
    ({ id, event, display_title: title, status: 'completed', conclusion, created_at: created, updated_at: updated, head_branch: 'main' });
  const timerRed = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
    T(31, 'workflow_dispatch', 'Track-B private backup (db-timer)', 'failure', '2026-10-02T12:23:01Z', '2026-10-02T12:31:00Z'),
    T(30, 'schedule', 'Track-B private backup (schedule)', 'success', '2026-10-02T10:04:00Z', '2026-10-02T10:12:00Z')] }, nowMs: NOW, sources: backup });
  ok(timerRed.length === 1 && timerRed[0].key === 'workflow_red:backup' && timerRed[0].evidence === 'run:31',
    'a failed timer run, newest, is red even when an older schedule run passed');
  const timerGreen = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
    T(33, 'workflow_dispatch', 'Track-B private backup (db-timer)', 'success', '2026-10-02T16:23:01Z', '2026-10-02T16:31:00Z'),
    T(32, 'schedule', 'Track-B private backup (schedule)', 'success', '2026-10-02T08:52:00Z', '2026-10-02T09:00:00Z')] }, nowMs: NOW, sources: backup });
  ok(timerGreen.length === 0, 'a fresh timer success counts: an 8-hour-old schedule success beside it is no longer "stale"');
  const manualOverTimerRed = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
    T(36, 'workflow_dispatch', 'Track-B private backup (manual)', 'success', '2026-10-02T16:40:00Z', '2026-10-02T16:50:00Z'),
    T(35, 'workflow_dispatch', 'Track-B private backup (db-timer)', 'failure', '2026-10-02T12:23:01Z', '2026-10-02T12:31:00Z')] }, nowMs: NOW, sources: backup });
  ok(manualOverTimerRed.length === 1 && manualOverTimerRed[0].key === 'workflow_red:backup',
    'a manual green run still cannot hide a failed timer run');
  // The guard stands a late GitHub copy down when the timer already ran its slot: that
  // run concludes "success" having done nothing, so it must not hide the timer's red run.
  const stoodDown = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
    T(38, 'schedule', 'Track-B private backup (schedule)', 'success', '2026-10-02T16:44:00Z', '2026-10-02T16:44:40Z'),
    T(37, 'workflow_dispatch', 'Track-B private backup (db-timer)', 'failure', '2026-10-02T12:23:01Z', '2026-10-02T12:31:00Z')] }, nowMs: NOW, sources: backup });
  ok(stoodDown.length === 1 && stoodDown[0].key === 'workflow_red:backup' && stoodDown[0].evidence === 'run:37',
    'a schedule copy the guard stood down is not evidence: the timer\'s failure stays red');
  const fellBack = digest.workflowProblems({ runsByFile: { 'track-b-backup.yml': [
    T(40, 'schedule', 'Track-B private backup (schedule)', 'success', '2026-10-02T16:44:00Z', '2026-10-02T16:52:00Z'),
    T(39, 'workflow_dispatch', 'Track-B private backup (db-timer)', 'failure', '2026-10-02T06:23:01Z', '2026-10-02T06:31:00Z')] }, nowMs: NOW, sources: backup });
  ok(fellBack.length === 0, 'when the timer missed its slot, the GitHub copy really ran, and its success counts');
  const src = fs.readFileSync(path.join(ROOT, 'scripts/alert-digest.js'), 'utf8');
  const readRunsSrc = src.slice(src.indexOf('async function readRuns('), src.indexOf('\n}\n', src.indexOf('async function readRuns(')));
  ok(!/event=schedule/.test(readRunsSrc) && !/status=completed/.test(readRunsSrc) && /display_title: run\.display_title/.test(readRunsSrc)
    && Number((/per_page=(\d+)/.exec(readRunsSrc) || [])[1]) >= 50,
  'the digest reads every recent run with its title (in-progress timer runs included), not the schedule runs alone');
}

// --- workflow rules
const sources = digest.WORKFLOW_SOURCES;
const red = digest.workflowProblems({ runsByFile: { 'dawn-check.yml': [{ id: 7, status: 'completed', conclusion: 'failure', updated_at: '2026-10-02T16:00:00Z' }] }, nowMs: NOW, sources: sources.filter(s => s.key === 'dawn_check') });
ok(red.length === 1 && red[0].key === 'workflow_red:dawn_check' && red[0].evidence === 'run:7', 'a red latest run is a problem with its run number as evidence');
const noRuns = digest.workflowProblems({ runsByFile: {}, nowMs: NOW, sources: sources.filter(s => s.key === 'backup') });
ok(noRuns.length === 1 && noRuns[0].severity === 2, 'a workflow with no completed run is a problem');

// --- the switch: default off never posts; on posts once and only when it should
(async () => {
  const calls = [];
  let lastRunId = '';
  const fakeFetch = async (url, init) => {
    if (init && init.method === 'GET') { // the relay's finished-run lookup
      return { ok: true, json: async () => ({ data: [{ id: 9, status: 'success', data: { resultData: { runData: { 'Receive Edge Alert': [{ data: { main: [[{ json: { body: { type: 'syncview_digest', details: { run_id: lastRunId } } } }]] } }] } } } }] }) };
    }
    calls.push({ url, body: JSON.parse(init.body) });
    lastRunId = calls[calls.length - 1].body.details.run_id;
    return { status: 200, text: async () => '{}' };
  };
  const realFetch = global.fetch;
  global.fetch = fakeFetch;
  const fx = path.join(ROOT, 'test/fixtures/alert-digest-demo.json');
  const args = [`--fixture=${fx}`, '--now=2026-10-02T17:00:00Z'];
  const off = await digest.run(args, { SLACK_ALERT_WEBHOOK: 'https://example.invalid/hook' });
  ok(off.summary.mode === 'shadow' && off.summary.would_post === true && off.summary.posted === false && calls.length === 0, 'switch unset: message built, nothing posted');
  const wrong = await digest.run(args, { ALERT_DIGEST_ENABLED: 'TRUE ', SLACK_ALERT_WEBHOOK: 'https://example.invalid/hook' });
  ok(wrong.summary.posted === false && calls.length === 0, 'only the exact word "true" turns it on');
  const dry = await digest.run([...args, '--dry-run'], { ALERT_DIGEST_ENABLED: 'true', SLACK_ALERT_WEBHOOK: 'https://example.invalid/hook' });
  ok(dry.summary.mode === 'dry_run' && calls.length === 0, 'dry run never posts even with the switch on');
  const on = await digest.run(args, { ALERT_DIGEST_ENABLED: 'true', SLACK_ALERT_WEBHOOK: 'https://example.invalid/hook', N8N_API_KEY: 'test-key' });
  ok(on.summary.posted === true && calls.length === 1 && on.summary.delivery.delivery_confirmed === true && !on.unconfirmed, 'switch on and something new: exactly one post, delivery confirmed');
  ok(on.summary.all_problems.length === 3, 'the run output lists every problem, whatever the message cut');
  const noKey = await digest.run(args, { ALERT_DIGEST_ENABLED: 'true', SLACK_ALERT_WEBHOOK: 'https://example.invalid/hook' });
  ok(noKey.unconfirmed === true && noKey.summary.delivery.delivery_confirmed === false, 'accepted but unconfirmed delivery is reported as unconfirmed, so state would not move');
  const body = calls[0] && calls[0].body;
  ok(body && body.type === 'syncview_digest' && body.digest_text === on.message, 'the post carries the full message in digest_text');
  ok(body && !/https?:\/\//.test(JSON.stringify(body)), 'the post carries no web address');
  global.fetch = realFetch;

  // --- wiring
  const lane = watchdog.laneByKey('alert_digest');
  ok(lane && !lane.retired && lane.hosts.includes('alert-digest.yml'), 'the digest is a watched lane, so its silence is paged by the old dead-man switch');
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/alert-digest.yml'), 'utf8');
  ok(/ALERT_DIGEST_ENABLED: \$\{\{ vars\.ALERT_DIGEST_ENABLED \}\}/.test(wf), 'the workflow reads the switch from a repository variable with no default');
  ok(!/vars\.ALERT_DIGEST_ENABLED\s*\|\|/.test(wf), 'the switch has no "or true" fallback');
  ok(/--heartbeat=alert_digest/.test(wf), 'the workflow records its own heartbeat');

  if (failures) { console.error(`\n${failures} alert-digest check(s) failed`); process.exit(1); }
  console.log('\nAlert digest checks passed');
})();
