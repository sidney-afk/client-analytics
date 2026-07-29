'use strict';

const fs = require('fs');
const path = require('path');
const {
  ALERT_CLASSES,
  classCount,
  inboundCount,
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

// `summary` accepts any subset; unspecified counters are absent (i.e. zero).
const event = (id, summary = {}, identifiers = [], overrides = {}) => ({
  id,
  payload: {
    run_class: 'scheduled-monitor',
    github_event_name: 'schedule',
    github_run_id: String(id),
    github_run_attempt: '1',
    summary,
    inbound_identifier_sample: identifiers,
    ...overrides,
  },
});

// ---------------------------------------------------------------------------
// The regression this file exists to prevent: `inbound_diff_count` became a
// stamp-age counter on 2026-07-23 (PR #920 added compareAttribution), so a pager
// keyed to it fires once, latches, and never fires again -- the reset needs a
// zero that will not come. Live shape at the time of writing: inbound 4262 with
// every actionable counter at 0.
// ---------------------------------------------------------------------------
const stampDriftOnly = [
  event(1002, { inbound_diff_count: 4262, repair_list_size: 0, linkage_actionable: 0, outbound_diff_count: 0 }),
  event(1001, { inbound_diff_count: 4262, repair_list_size: 0, linkage_actionable: 0, outbound_diff_count: 0 }),
];
for (const entry of ALERT_CLASSES) {
  ok(!pageDecision(stampDriftOnly, null, entry.key).should_page,
    `stamp drift alone must never page (${entry.key})`);
}
ok(inboundCount(stampDriftOnly[0]) === 4262, 'inbound_diff_count is still readable as context');
ok(!ALERT_CLASSES.some(entry => entry.key === 'inbound_diff_count'),
  'inbound_diff_count is never a firing class');

// ---------------------------------------------------------------------------
// Each watched class pages on its own, and reports itself.
// ---------------------------------------------------------------------------
for (const entry of ALERT_CLASSES) {
  const breach = [
    event(1102, { [entry.key]: 3, inbound_diff_count: 4262 }, [{ identifier: 'VID-12', team: 'video' }]),
    event(1101, { [entry.key]: 1, inbound_diff_count: 4262 }, [{ identifier: 'GRA-4', team: 'graphics' }]),
    event(1100, { [entry.key]: 0, inbound_diff_count: 4262 }),
  ];
  const decision = pageDecision(breach, null, entry.key);
  ok(decision.should_page && decision.pair === '1101:1102', `${entry.key} pages on two consecutive nonzero runs`);
  ok(decision.alert_class === entry.key, `${entry.key} decision names its own class`);
  ok(classCount(breach[0], entry.key) === 3, `${entry.key} count is read from summary`);

  const text = slackPayload(decision).text;
  ok(text.includes(entry.key) && text.includes(entry.label), `${entry.key} message names the class`);
  ok(text.includes('inbound_diff_context=4262'), `${entry.key} message reports inbound as context only`);
  ok(text.includes('VID-12') && text.includes('GRA-4'), `${entry.key} message keeps the safe identifier sample`);

  ok(!pageDecision([event(1202, { [entry.key]: 0 }), event(1201, { [entry.key]: 3 })], null, entry.key).should_page,
    `${entry.key}: one clean run resets the consecutive condition`);
}

// ---------------------------------------------------------------------------
// F132: classes latch INDEPENDENTLY. A latched repair incident must not silence
// a genuinely new linkage or outbound one. Summing the classes would reproduce
// exactly the "one class can suppress another" defect MONITORING.md records
// against the n8n pager.
// ---------------------------------------------------------------------------
const repairLatched = {
  payload: {
    alert_class: 'repair_list_size',
    incident_state: 'latched',
    incident_id: '2001:2002',
    github_run_ids: ['2001', '2002'],
  },
};
const repairsStillBreachedLinkageNew = [
  event(2004, { repair_list_size: 27, linkage_actionable: 2 }),
  event(2003, { repair_list_size: 27, linkage_actionable: 2 }),
  event(2002, { repair_list_size: 27, linkage_actionable: 0 }),
];
ok(pageDecision(repairsStillBreachedLinkageNew, repairLatched, 'repair_list_size').reason === 'incident_already_latched',
  'a latched repair incident stays latched for repairs');
ok(pageDecision(repairsStillBreachedLinkageNew, null, 'linkage_actionable').should_page,
  'F132: a latched repair incident does NOT suppress a new linkage incident');
ok(pageDecision(repairsStillBreachedLinkageNew, repairLatched, 'linkage_actionable').should_page,
  'F132: the repair marker is not claimed by the linkage class');

// A marker written before alert_class existed belongs to no class.
const legacyMarker = { payload: { incident_state: 'latched', incident_id: '1:2', github_run_ids: ['1', '2'] } };
ok(pageDecision(repairsStillBreachedLinkageNew, null, 'repair_list_size').should_page,
  'with no marker for this class, a real repair breach pages');
ok(!/alert_class/.test(JSON.stringify(legacyMarker.payload)),
  'legacy marker fixture genuinely lacks alert_class');

// ---------------------------------------------------------------------------
// Latch / reset lifecycle, per class.
// ---------------------------------------------------------------------------
const latched = {
  payload: {
    alert_class: 'repair_list_size',
    incident_state: 'latched',
    incident_id: '301:302',
    github_run_ids: ['301', '302'],
  },
};
const drifting = [event(304, { repair_list_size: 4 }), event(303, { repair_list_size: 3 }), event(302, { repair_list_size: 2 })];
ok(pageDecision(drifting, latched, 'repair_list_size').reason === 'incident_already_latched',
  'one latched incident suppresses every later nonzero tick of the same class');

const cleanReset = pageDecision(
  [event(303, { repair_list_size: 0 }), event(302, { repair_list_size: 2 }), event(301, { repair_list_size: 2 })],
  latched, 'repair_list_size',
);
ok(cleanReset.should_reset && cleanReset.reason === 'clean_scheduled_run_reset',
  'a later clean scheduled run requests a persistent incident reset');
const resetPayload = stateMarkerPayload(cleanReset, 'reset');
ok(resetPayload.incident_state === 'reset' && resetPayload.reset_by_github_run_id === '303',
  'reset marker records the clean GitHub run identity');
ok(resetPayload.alert_class === 'repair_list_size', 'reset marker records its class');

const resetMarker = { payload: resetPayload };
ok(!pageDecision([event(304, { repair_list_size: 5 }), event(303, { repair_list_size: 0 })], resetMarker, 'repair_list_size').should_page,
  'one nonzero run after reset does not page');
const reopened = pageDecision(
  [event(305, { repair_list_size: 2 }), event(304, { repair_list_size: 5 }), event(303, { repair_list_size: 0 })],
  resetMarker, 'repair_list_size',
);
ok(reopened.should_page, 'two distinct nonzero scheduled runs after reset open one new incident');
const latchPayload = stateMarkerPayload(reopened, 'latched');
ok(latchPayload.alert_class === 'repair_list_size' && Array.isArray(latchPayload.alert_class_counts),
  'latched marker records its class and that class’s counts');

// ---------------------------------------------------------------------------
// Run identity, safety, and scheduled-only gating (unchanged contracts).
// ---------------------------------------------------------------------------
const reruns = [
  event(902, { repair_list_size: 7 }, [], { github_run_id: '500', github_run_attempt: '2' }),
  event(901, { repair_list_size: 7 }, [], { github_run_id: '500', github_run_attempt: '1' }),
];
const dedupedReruns = monitorSummaries(reruns);
ok(dedupedReruns.length === 1 && dedupedReruns[0].payload.github_run_attempt === '2',
  'rerun attempts collapse to one scheduled run and retain the latest attempt');
ok(!pageDecision(reruns, null, 'repair_list_size').should_page,
  'two attempts of one github_run_id cannot satisfy the two-run page condition');

ok(!pageDecision([
  event(402, { repair_list_size: 3 }, [], { run_class: 'manual-apply', github_event_name: 'workflow_dispatch' }),
  event(401, { repair_list_size: 3 }),
], null, 'repair_list_size').should_page, 'manual apply runs cannot satisfy the scheduled-monitor condition');
ok(!pageDecision([
  event(502, { repair_list_size: 3 }, [], { github_event_name: 'workflow_dispatch' }),
  event(501, { repair_list_size: 3 }, [], { github_event_name: 'workflow_dispatch' }),
], null, 'repair_list_size').should_page, 'a manual dry-run cannot masquerade as a scheduled monitor');

const unsafe = pageDecision([
  event(602, { repair_list_size: 2 }, [{ identifier: 'VID-12', team: 'video' }, { identifier: 'bad client name', team: 'video' }]),
  event(601, { repair_list_size: 1 }, [{ identifier: 'GRA-4', team: 'graphics' }]),
], null, 'repair_list_size');
ok(identifierSample(unsafe.events).map(row => row.identifier).join(',') === 'VID-12,GRA-4',
  'safe sample retains only Linear issue identifiers');
ok(!slackPayload(unsafe).text.includes('client name'),
  'Slack message excludes unsafe sample text');

// ---------------------------------------------------------------------------
// Source and workflow wiring.
// ---------------------------------------------------------------------------
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
ok(/repair_list_size[\s\S]{0,200}linkage_actionable[\s\S]{0,200}outbound_diff_count/.test(script),
  'the watched classes are the actionable counters');
ok(/stamp-age counter, not a health\s+\*\s*signal/.test(script),
  'the source records why inbound_diff_count is not watched');

console.log('linear-reconcile-inbound-pager checks passed');
