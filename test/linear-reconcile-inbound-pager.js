'use strict';

const fs = require('fs');
const path = require('path');
const {
  identifierSample,
  monitorSummaries,
  pageDecision,
  slackPayload,
  stateMarkerPayload,
} = require('../scripts/linear-reconcile-inbound-pager');

function ok(condition, message) {
  if (!condition) {
    console.error('FAIL linear-reconcile-inbound-pager:', message);
    process.exit(1);
  }
}

const event = (id, inbound, identifiers = [], overrides = {}) => ({
  id,
  payload: {
    run_class: 'scheduled-monitor',
    github_event_name: 'schedule',
    github_run_id: String(id),
    github_run_attempt: '1',
    summary: { inbound_diff_count: inbound },
    inbound_identifier_sample: identifiers,
    ...overrides,
  },
});

const persistent = [
  event(102, 3, [{ identifier: 'VID-12', team: 'video' }, { identifier: 'bad client name', team: 'video' }]),
  event(101, 1, [{ identifier: 'GRA-4', team: 'graphics' }]),
  event(100, 0),
];
const decision = pageDecision(persistent, null);
ok(decision.should_page && decision.pair === '101:102', 'two newest monitor summaries with inbound diffs page');
ok(identifierSample(decision.events).map(row => row.identifier).join(',') === 'VID-12,GRA-4',
  'safe sample retains only Linear issue identifiers');
const message = slackPayload(decision).text;
ok(message.includes('VID-12') && message.includes('GRA-4') && !message.includes('client name'),
  'Slack message is identifier-only and excludes unsafe sample text');
ok(!pageDecision([event(202, 0), event(201, 3)], null).should_page,
  'one clean run resets the consecutive condition');

const latchedMarker = {
  payload: {
    incident_state: 'latched',
    incident_id: '301:302',
    github_run_ids: ['301', '302'],
  },
};
const stillDrifting = pageDecision([event(304, 4), event(303, 3), event(302, 2)], latchedMarker);
ok(!stillDrifting.should_page && stillDrifting.reason === 'incident_already_latched',
  'one latched incident suppresses every later nonzero scheduled tick');

const cleanReset = pageDecision([event(303, 0), event(302, 2), event(301, 2)], latchedMarker);
ok(cleanReset.should_reset && cleanReset.reason === 'clean_scheduled_run_reset',
  'a later clean scheduled run requests a persistent incident reset');
const resetPayload = stateMarkerPayload(cleanReset, 'reset');
ok(resetPayload.incident_state === 'reset' && resetPayload.reset_by_github_run_id === '303',
  'reset marker records the clean GitHub run identity');
const resetMarker = { payload: resetPayload };
ok(!pageDecision([event(304, 5), event(303, 0)], resetMarker).should_page,
  'one nonzero run after reset does not page');
ok(pageDecision([event(305, 2), event(304, 5), event(303, 0)], resetMarker).should_page,
  'two distinct nonzero scheduled runs after reset open one new incident');

const reruns = [
  event(902, 7, [], { github_run_id: '500', github_run_attempt: '2' }),
  event(901, 7, [], { github_run_id: '500', github_run_attempt: '1' }),
];
const dedupedReruns = monitorSummaries(reruns);
ok(dedupedReruns.length === 1 && dedupedReruns[0].payload.github_run_attempt === '2',
  'rerun attempts collapse to one scheduled run and retain the latest attempt');
ok(!pageDecision(reruns, null).should_page,
  'two attempts of one github_run_id cannot satisfy the two-run page condition');

ok(!pageDecision([
  event(402, 3, [], { run_class: 'manual-apply', github_event_name: 'workflow_dispatch' }),
  event(401, 3),
], null).should_page, 'manual apply runs cannot satisfy the scheduled-monitor condition');
ok(!pageDecision([
  event(502, 3, [], { github_event_name: 'workflow_dispatch' }),
  event(501, 3, [], { github_event_name: 'workflow_dispatch' }),
], null).should_page, 'a manual dry-run cannot masquerade as a scheduled monitor');

const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linear-reconcile-inbound-pager.js'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'linear-deliverables-reconcile.yml'), 'utf8');
const reconciler = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'linear-deliverables-reconcile.js'), 'utf8');
ok(/SLACK_ALERT_WEBHOOK/.test(script) && /incident_state:[\s\S]{0,100}latched/.test(script),
  'pager requires direct Slack wiring and persists a latched incident marker');
ok(/Require non-n8n inbound pager secret/.test(workflow) && /linear-reconcile-inbound-pager\.js/.test(workflow),
  'reconcile workflow refuses a false green and runs the non-n8n pager');
ok(/github\.event_name == 'schedule'[\s\S]{0,100}'scheduled-monitor'/.test(workflow)
  && (workflow.match(/if: github\.event_name == 'schedule'/g) || []).length === 2,
  'only GitHub schedule events classify and invoke the scheduled pager');
ok(/run_class:[\s\S]{0,200}github_event_name:[\s\S]{0,200}github_run_id:[\s\S]{0,100}github_run_attempt:[\s\S]{0,300}inbound_identifier_sample/.test(reconciler),
  'reconcile summary records event, run, attempt, and safe identifier evidence');

console.log('linear-reconcile-inbound-pager checks passed');
