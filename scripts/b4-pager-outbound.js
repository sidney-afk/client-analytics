'use strict';

/*
 * Idempotently adds the B4 outbound dispatch and watcher lane to the existing
 * n8n monitoring pager. Snapshot the live workflow privately before --apply.
 */

const { randomUUID } = require('crypto');

const WORKFLOW_ID = process.env.N8N_PAGER_WORKFLOW_ID || 'qllIDZPkdNAPRj0b';
const N8N_BASE_URL = (process.env.N8N_BASE_URL || 'https://synchrosocial.app.n8n.cloud').replace(/\/+$/, '');
const N8N_KEY = process.env.N8N_API_KEY || '';
const APPLY = process.argv.includes('--apply');

const NAMES = Object.freeze({
  schedule: 'Every 15 min',
  triggerTemplate: 'Trigger Reconciler V2',
  trigger: 'Trigger Outbound Drainer',
  v2Summary: 'Fetch V2 Summary',
  outboundSummary: 'Fetch Outbound Summary',
  incrementalSummary: 'Fetch Incremental Summary',
  check: 'Check Pager Conditions',
});

const OUTBOUND_WORKFLOW_URL = 'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/linear-outbound-drain.yml/dispatches';
const OUTBOUND_WORKFLOW_BODY = '{"ref":"main","inputs":{"limit":"15"}}';

const OUTBOUND_AGE_PARSE_BLOCK = `let outboundOldest = outboundPayload.oldest_pending_minutes || {};
if (typeof outboundOldest === 'string') {
  try { outboundOldest = JSON.parse(outboundOldest); } catch (_e) { outboundOldest = {}; }
}
let outboundAuthority = outboundPayload.authority || {};
if (typeof outboundAuthority === 'string') {
  try { outboundAuthority = JSON.parse(outboundAuthority); } catch (_e) { outboundAuthority = {}; }
}
const outboundAgeThreshold = n(outboundPayload.oldest_pending_alert_threshold_minutes) || 30;
const outboundAgedTeams = ['video', 'graphics'].filter(team => clean(outboundAuthority[team]).toLowerCase() === 'syncview'
  && n(outboundOldest[team]) > outboundAgeThreshold);
`;
const OUTBOUND_AGE_ALERT_LINE = `if (outboundAgedTeams.length) out.push(alert('outbound_oldest_pending', \`Linear outbound oldest pending threshold_min=\${outboundAgeThreshold} teams=\${outboundAgedTeams.map(team => team + ':' + n(outboundOldest[team]) + 'm').join(',')} latest_event=\${outboundEventId}\`));
`;

const OUTBOUND_WATCH_BLOCK = `const outbound = first('Fetch Outbound Summary');
const outboundAge = ageMinutes(outbound?.ts);
let outboundPayload = outbound?.payload || {};
if (typeof outboundPayload === 'string') {
  try { outboundPayload = JSON.parse(outboundPayload); } catch (_e) { outboundPayload = {}; }
}
let outboundCounts = outboundPayload.counts || {};
if (typeof outboundCounts === 'string') {
  try { outboundCounts = JSON.parse(outboundCounts); } catch (_e) { outboundCounts = {}; }
}
const outboundMode = clean(outboundPayload.mode || 'off').toLowerCase();
const outboundEventId = clean(outbound?.id || 'none');
const outboundBacklog = n(outboundPayload.backlog);
const previousOutboundBacklog = n(staticData.outboundBacklog);
${OUTBOUND_AGE_PARSE_BLOCK}
if (outboundMode !== 'off' && (!outbound || outboundAge > 90)) out.push(alert('outbound_stale', \`Linear outbound summary stale age_min=\${outboundAge} latest_event=\${outboundEventId}\`));
if (n(outboundCounts.failed) > 0) out.push(alert('outbound_failed', \`Linear outbound failed_write_count=\${n(outboundCounts.failed)} latest_event=\${outboundEventId}\`));
if (outboundBacklog > 100 && outboundBacklog > previousOutboundBacklog) out.push(alert('outbound_backlog', \`Linear outbound backlog growing backlog=\${outboundBacklog} previous=\${previousOutboundBacklog} latest_event=\${outboundEventId}\`));
${OUTBOUND_AGE_ALERT_LINE}
if (n(outboundCounts.written) > 50) out.push(alert('outbound_volume', \`Linear outbound write-volume spike written=\${n(outboundCounts.written)} latest_event=\${outboundEventId}\`));
if (n(outboundCounts.shadow_vs_actual_divergence) > 0) out.push(alert('outbound_shadow_mismatch', \`Linear outbound shadow mismatch count=\${n(outboundCounts.shadow_vs_actual_divergence)} latest_event=\${outboundEventId}\`));
staticData.outboundBacklog = outboundBacklog;
`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function node(workflow, name) {
  return workflow.nodes.find(item => item.name === name);
}

function edge(name) {
  return { node: name, type: 'main', index: 0 };
}

function assertBase(workflow) {
  for (const name of [NAMES.schedule, NAMES.triggerTemplate, NAMES.v2Summary, NAMES.incrementalSummary, NAMES.check]) {
    if (!node(workflow, name)) throw new Error(`Pager base node missing: ${name}`);
  }
  if (!workflow.connections[NAMES.v2Summary]?.main?.[0]?.some(item => [NAMES.incrementalSummary, NAMES.outboundSummary].includes(item.node))) {
    throw new Error('Pager summary-chain anchor drifted');
  }
}

function verify(workflow) {
  for (const name of [NAMES.trigger, NAMES.outboundSummary]) {
    if (!node(workflow, name)) throw new Error(`Outbound pager node missing: ${name}`);
  }
  const scheduleTargets = workflow.connections[NAMES.schedule].main[0].map(item => item.node);
  if (!scheduleTargets.includes(NAMES.trigger)) throw new Error('Outbound dispatch is not scheduled');
  const trigger = node(workflow, NAMES.trigger);
  if (trigger.parameters.url !== OUTBOUND_WORKFLOW_URL || trigger.parameters.jsonBody !== OUTBOUND_WORKFLOW_BODY) {
    throw new Error('Outbound dispatch does not use the scoped Actions workflow endpoint');
  }
  if (trigger.onError !== 'continueRegularOutput') {
    throw new Error('Pre-merge outbound dispatch is not fail-soft');
  }
  if (workflow.connections[NAMES.v2Summary].main[0][0].node !== NAMES.outboundSummary) {
    throw new Error('Outbound summary is not after the v2 summary');
  }
  if (workflow.connections[NAMES.outboundSummary].main[0][0].node !== NAMES.incrementalSummary) {
    throw new Error('Watcher chain does not continue after outbound summary');
  }
  const code = node(workflow, NAMES.check).parameters.jsCode || '';
  for (const token of ['outbound_failed', 'outbound_backlog', 'outbound_oldest_pending', 'outbound_volume', 'outbound_shadow_mismatch', 'outboundMode !== \'off\'']) {
    if (!code.includes(token)) throw new Error(`Outbound watcher missing: ${token}`);
  }
  return workflow;
}

function transformWorkflow(input) {
  const workflow = clone(input);
  assertBase(workflow);
  const installed = [NAMES.trigger, NAMES.outboundSummary].filter(name => node(workflow, name));
  if (installed.length) {
    if (installed.length !== 2) throw new Error('Pager contains a partial outbound installation');
    const trigger = node(workflow, NAMES.trigger);
    trigger.parameters.url = OUTBOUND_WORKFLOW_URL;
    trigger.parameters.jsonBody = OUTBOUND_WORKFLOW_BODY;
    // Before this PR merges, GitHub cannot dispatch a workflow absent from main.
    // Once outbound mode is active, the 90-minute summary watchdog pages on a real failure.
    trigger.onError = 'continueRegularOutput';
    const check = node(workflow, NAMES.check);
    if (!(check.parameters.jsCode || '').includes('outbound_oldest_pending')) {
      const parseAnchor = "if (outboundMode !== 'off' && (!outbound || outboundAge > 90))";
      const alertAnchor = "if (n(outboundCounts.written) > 50)";
      if (!check.parameters.jsCode.includes(parseAnchor) || !check.parameters.jsCode.includes(alertAnchor)) {
        throw new Error('Outbound age watcher insertion anchor drifted');
      }
      check.parameters.jsCode = check.parameters.jsCode
        .replace(parseAnchor, OUTBOUND_AGE_PARSE_BLOCK + parseAnchor)
        .replace(alertAnchor, OUTBOUND_AGE_ALERT_LINE + alertAnchor);
    }
    return verify(workflow);
  }

  const trigger = clone(node(workflow, NAMES.triggerTemplate));
  trigger.id = randomUUID();
  trigger.name = NAMES.trigger;
  trigger.position = [500, -580];
  trigger.parameters.url = OUTBOUND_WORKFLOW_URL;
  trigger.parameters.jsonBody = OUTBOUND_WORKFLOW_BODY;
  trigger.onError = 'continueRegularOutput';
  workflow.nodes.push(trigger);

  const summary = clone(node(workflow, NAMES.v2Summary));
  summary.id = randomUUID();
  summary.name = NAMES.outboundSummary;
  summary.position = [370, 80];
  summary.parameters.url = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/deliverable_events?select=id,ts,action,source,payload&action=eq.linear_outbound_summary&order=ts.desc&limit=1';
  workflow.nodes.push(summary);

  const check = node(workflow, NAMES.check);
  const anchor = `const incremental = first('${NAMES.incrementalSummary}');`;
  if (!check.parameters.jsCode.includes(anchor)) throw new Error('Outbound watcher code anchor drifted');
  check.parameters.jsCode = check.parameters.jsCode.replace(anchor, OUTBOUND_WATCH_BLOCK + anchor);

  workflow.connections[NAMES.schedule].main[0].push(edge(NAMES.trigger));
  workflow.connections[NAMES.v2Summary] = { main: [[edge(NAMES.outboundSummary)]] };
  workflow.connections[NAMES.outboundSummary] = { main: [[edge(NAMES.incrementalSummary)]] };
  return verify(workflow);
}

async function n8n(method, route, body) {
  const response = await fetch(`${N8N_BASE_URL}/api/v1${route}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      accept: 'application/json',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n ${method} ${route} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!N8N_KEY) throw new Error('N8N_API_KEY is required');
  const before = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
  const transformed = transformWorkflow(before);
  if (!APPLY) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      workflow_id: WORKFLOW_ID,
      before_nodes: before.nodes.length,
      after_nodes: transformed.nodes.length,
      additions: [NAMES.trigger, NAMES.outboundSummary],
    }, null, 2));
    return;
  }

  await n8n('PUT', `/workflows/${WORKFLOW_ID}`, {
    name: transformed.name,
    nodes: transformed.nodes,
    connections: transformed.connections,
    settings: transformed.settings,
  });
  const readback = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
  verify(readback);
  console.log(JSON.stringify({
    ok: true,
    dry_run: false,
    workflow_id: WORKFLOW_ID,
    active: readback.active,
    updated_at: readback.updatedAt,
    node_count: readback.nodes.length,
    outbound_dispatch_minutes: 15,
    alert_throttle_minutes: 60,
  }, null, 2));
}

module.exports = {
  NAMES,
  OUTBOUND_AGE_ALERT_LINE,
  OUTBOUND_AGE_PARSE_BLOCK,
  OUTBOUND_WATCH_BLOCK,
  OUTBOUND_WORKFLOW_URL,
  OUTBOUND_WORKFLOW_BODY,
  transformWorkflow,
  verify,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
