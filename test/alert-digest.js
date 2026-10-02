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

// --- workflow rules
const sources = digest.WORKFLOW_SOURCES;
const red = digest.workflowProblems({ runsByFile: { 'dawn-check.yml': [{ id: 7, status: 'completed', conclusion: 'failure', updated_at: '2026-10-02T16:00:00Z' }] }, nowMs: NOW, sources: sources.filter(s => s.key === 'dawn_check') });
ok(red.length === 1 && red[0].key === 'workflow_red:dawn_check' && red[0].evidence === 'run:7', 'a red latest run is a problem with its run number as evidence');
const noRuns = digest.workflowProblems({ runsByFile: {}, nowMs: NOW, sources: sources.filter(s => s.key === 'backup') });
ok(noRuns.length === 1 && noRuns[0].severity === 2, 'a workflow with no completed run is a problem');

// --- the switch: default off never posts; on posts once and only when it should
(async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    if (init && init.method === 'GET') { // the relay's finished-run lookup
      return { ok: true, json: async () => ({ data: [{ id: 9, status: 'success', data: { resultData: { runData: { 'Receive Edge Alert': [{ data: { main: [[{ json: { body: { type: 'syncview_digest', details: { run_id: 'local:1:digest' } } } }]] } }] } } } }] }) };
    }
    calls.push({ url, body: JSON.parse(init.body) });
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
