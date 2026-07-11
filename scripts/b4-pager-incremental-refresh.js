'use strict';

/*
 * Idempotently adds the B1 incremental-refresh dispatch and freshness watcher
 * to the existing n8n monitoring pager. The live workflow must be backed up
 * privately before --apply is used.
 */

const { randomUUID } = require('crypto');

const WORKFLOW_ID = process.env.N8N_PAGER_WORKFLOW_ID || 'qllIDZPkdNAPRj0b';
const N8N_BASE_URL = (process.env.N8N_BASE_URL || 'https://synchrosocial.app.n8n.cloud').replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const N8N_KEY = process.env.N8N_API_KEY || '';

const NAMES = {
  schedule: 'Every 15 min',
  gate: 'Gate Incremental Refresh 30m',
  trigger: 'Trigger Incremental Refresh',
  v2Summary: 'Fetch V2 Summary',
  incrementalSummary: 'Fetch Incremental Summary',
  mirror: 'Fetch Latest Mirror Event',
  check: 'Check Pager Conditions',
};

const GATE_CODE = `const now = Date.now();
const staticData = $getWorkflowStaticData('global');
const last = Number(staticData.lastIncrementalDispatchAt || 0);
if (last && now - last < 25 * 60 * 1000) return [];
staticData.lastIncrementalDispatchAt = now;
return $input.all();`;

const STALE_BLOCK = `const incremental = first('Fetch Incremental Summary');
const incrementalAge = ageMinutes(incremental?.ts);
if (!incremental || incrementalAge > 90) out.push(alert('incremental_refresh_stale', \`B1 incremental refresh stale age_min=\${incrementalAge} latest_event=\${clean(incremental?.id || 'none')}\`));
`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getNode(workflow, name) {
  return workflow.nodes.find(node => node.name === name);
}

function connection(node) {
  return { node, type: 'main', index: 0 };
}

function assertBase(workflow) {
  for (const name of [NAMES.schedule, NAMES.v2Summary, NAMES.mirror, NAMES.check, 'Trigger Reconciler V2']) {
    if (!getNode(workflow, name)) throw new Error(`Pager base node missing: ${name}`);
  }
  const checkCode = getNode(workflow, NAMES.check).parameters.jsCode || '';
  if (!checkCode.includes(`const mirror = first('${NAMES.mirror}');`)) throw new Error('Pager condition-code anchor drifted');
}

function verifyTransformed(workflow) {
  for (const name of [NAMES.gate, NAMES.trigger, NAMES.incrementalSummary]) {
    if (!getNode(workflow, name)) throw new Error(`Incremental pager node missing: ${name}`);
  }
  const checkCode = getNode(workflow, NAMES.check).parameters.jsCode || '';
  if (!checkCode.includes("incremental_refresh_stale") || !checkCode.includes('incrementalAge > 90')) {
    throw new Error('Incremental-refresh staleness check missing');
  }
  const scheduleTargets = workflow.connections[NAMES.schedule].main[0].map(edge => edge.node);
  if (!scheduleTargets.includes(NAMES.gate)) throw new Error('30-minute dispatch gate is not connected to the schedule');
  if (workflow.connections[NAMES.gate].main[0][0].node !== NAMES.trigger) throw new Error('Incremental dispatch gate is not connected to its trigger');
  if (workflow.connections[NAMES.v2Summary].main[0][0].node !== NAMES.incrementalSummary) throw new Error('Incremental summary is not in the watcher chain');
  if (workflow.connections[NAMES.incrementalSummary].main[0][0].node !== NAMES.mirror) throw new Error('Watcher chain does not continue after the incremental summary');
  return workflow;
}

function transformWorkflow(input) {
  const workflow = clone(input);
  assertBase(workflow);

  const present = [NAMES.gate, NAMES.trigger, NAMES.incrementalSummary].filter(name => getNode(workflow, name));
  if (present.length) {
    if (present.length !== 3) throw new Error('Pager contains a partial incremental-refresh installation');
    return verifyTransformed(workflow);
  }

  const triggerTemplate = getNode(workflow, 'Trigger Reconciler V2');
  const summaryTemplate = getNode(workflow, NAMES.v2Summary);
  const checkNode = getNode(workflow, NAMES.check);

  workflow.nodes.push({
    parameters: { jsCode: GATE_CODE, mode: 'runOnceForAllItems' },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [240, -400],
    id: randomUUID(),
    name: NAMES.gate,
  });

  const trigger = clone(triggerTemplate);
  trigger.id = randomUUID();
  trigger.name = NAMES.trigger;
  trigger.position = [500, -400];
  trigger.parameters.url = 'https://api.github.com/repos/sidney-afk/client-analytics/actions/workflows/b1-linear-incremental-refresh.yml/dispatches';
  trigger.parameters.jsonBody = '{"ref":"main"}';
  workflow.nodes.push(trigger);

  const summary = clone(summaryTemplate);
  summary.id = randomUUID();
  summary.name = NAMES.incrementalSummary;
  summary.position = [500, 80];
  summary.parameters.url = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/deliverable_events?select=id,ts,action,source,payload&action=eq.linear_incremental_refresh&order=ts.desc&limit=1';
  workflow.nodes.push(summary);

  checkNode.parameters.jsCode = checkNode.parameters.jsCode.replace(
    `const mirror = first('${NAMES.mirror}');`,
    `${STALE_BLOCK}const mirror = first('${NAMES.mirror}');`,
  );

  workflow.connections[NAMES.schedule].main[0].push(connection(NAMES.gate));
  workflow.connections[NAMES.gate] = { main: [[connection(NAMES.trigger)]] };
  workflow.connections[NAMES.v2Summary] = { main: [[connection(NAMES.incrementalSummary)]] };
  workflow.connections[NAMES.incrementalSummary] = { main: [[connection(NAMES.mirror)]] };

  return verifyTransformed(workflow);
}

async function n8n(method, path, body) {
  const response = await fetch(`${N8N_BASE_URL}/api/v1${path}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n ${method} ${path} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!N8N_KEY) throw new Error('N8N_API_KEY is required');
  const before = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
  const transformed = transformWorkflow(before);
  const payload = {
    name: transformed.name,
    nodes: transformed.nodes,
    connections: transformed.connections,
    settings: transformed.settings,
  };

  if (!APPLY) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      workflow_id: WORKFLOW_ID,
      before_nodes: before.nodes.length,
      after_nodes: transformed.nodes.length,
      additions: [NAMES.gate, NAMES.trigger, NAMES.incrementalSummary],
    }, null, 2));
    return;
  }

  await n8n('PUT', `/workflows/${WORKFLOW_ID}`, payload);
  const readback = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
  verifyTransformed(readback);
  console.log(JSON.stringify({
    ok: true,
    dry_run: false,
    workflow_id: WORKFLOW_ID,
    active: readback.active,
    updated_at: readback.updatedAt,
    node_count: readback.nodes.length,
    staleness_minutes: 90,
    dispatch_interval_minutes: 30,
  }, null, 2));
}

module.exports = { GATE_CODE, NAMES, STALE_BLOCK, transformWorkflow, verifyTransformed };

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
