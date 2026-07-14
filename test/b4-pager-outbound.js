'use strict';

const {
  NAMES,
  OUTBOUND_AGE_ALERT_LINE,
  OUTBOUND_AGE_PARSE_BLOCK,
  OUTBOUND_WATCH_BLOCK,
  OUTBOUND_WORKFLOW_URL,
  OUTBOUND_WORKFLOW_BODY,
  transformWorkflow,
  verify,
} = require('../scripts/b4-pager-outbound');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else {
    failures++;
    console.error('FAIL  ' + message);
  }
}

function baseWorkflow() {
  const trigger = {
    id: 'trigger-template',
    name: NAMES.triggerTemplate,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [0, 0],
    parameters: {
      method: 'POST',
      url: 'https://api.github.com/old',
      jsonBody: '{}',
      sendBody: true,
      sendHeaders: true,
    },
    credentials: { httpHeaderAuth: { id: 'fixture', name: 'fixture' } },
  };
  const summary = {
    id: 'summary-template',
    name: NAMES.v2Summary,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [0, 0],
    parameters: { method: 'GET', url: 'https://example.invalid/v2' },
  };
  return {
    name: 'Fixture pager',
    nodes: [
      { id: 'schedule', name: NAMES.schedule, type: 'n8n-nodes-base.scheduleTrigger', parameters: {}, position: [0, 0] },
      trigger,
      summary,
      { id: 'incremental', name: NAMES.incrementalSummary, type: 'n8n-nodes-base.httpRequest', parameters: {}, position: [0, 0] },
      {
        id: 'check',
        name: NAMES.check,
        type: 'n8n-nodes-base.code',
        parameters: { jsCode: `const incremental = first('${NAMES.incrementalSummary}');\nreturn out.filter(Boolean);` },
        position: [0, 0],
      },
    ],
    connections: {
      [NAMES.schedule]: { main: [[[NAMES.triggerTemplate].map(() => ({ node: NAMES.triggerTemplate, type: 'main', index: 0 }))[0]]] },
      [NAMES.v2Summary]: { main: [[{ node: NAMES.incrementalSummary, type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

const transformed = transformWorkflow(baseWorkflow());
ok(verify(transformed) === transformed, 'transformed pager satisfies the outbound contract');
ok(transformed.nodes.length === 7, 'transform adds exactly two nodes');
ok(transformed.connections[NAMES.schedule].main[0].some(edge => edge.node === NAMES.trigger),
  '15-minute schedule dispatches the outbound worker');
ok(transformed.connections[NAMES.v2Summary].main[0][0].node === NAMES.outboundSummary
  && transformed.connections[NAMES.outboundSummary].main[0][0].node === NAMES.incrementalSummary,
'outbound summary is inserted without breaking the watcher chain');

const trigger = transformed.nodes.find(node => node.name === NAMES.trigger);
ok(trigger.parameters.url === OUTBOUND_WORKFLOW_URL
  && trigger.parameters.jsonBody === OUTBOUND_WORKFLOW_BODY,
'dispatch uses the existing scoped Actions credential path');
ok(trigger.onError === 'continueRegularOutput',
  'dispatch is fail-soft until the workflow exists on main; stale-summary paging remains the live tripwire');
ok(trigger.credentials.httpHeaderAuth.id === 'fixture', 'existing scoped GitHub credential is preserved');

for (const token of [
  'outbound_failed', 'outbound_backlog', 'outbound_volume',
  'outbound_shadow_mismatch', 'outbound_oldest_pending',
  'oldest_pending_alert_threshold_minutes', "outboundMode !== 'off'", 'previousOutboundBacklog',
]) {
  ok(OUTBOUND_WATCH_BLOCK.includes(token), 'watcher includes ' + token);
}
ok(!/client_slug|client_name/.test(OUTBOUND_WATCH_BLOCK), 'outbound alerts never include client identity');
ok(transformWorkflow(transformed).nodes.length === transformed.nodes.length, 'pager transform is idempotent');
const preAgeInstall = JSON.parse(JSON.stringify(transformed));
const preAgeCode = preAgeInstall.nodes.find(node => node.name === NAMES.check).parameters;
preAgeCode.jsCode = preAgeCode.jsCode
  .replace(OUTBOUND_AGE_PARSE_BLOCK, '')
  .replace(OUTBOUND_AGE_ALERT_LINE, '');
const upgraded = transformWorkflow(preAgeInstall);
ok(upgraded.nodes.find(node => node.name === NAMES.check).parameters.jsCode.includes('outbound_oldest_pending'),
  'existing installed pager is upgraded in place with the age alert');
let watcherCompiles = true;
try { new Function(upgraded.nodes.find(node => node.name === NAMES.check).parameters.jsCode); } catch (_) { watcherCompiles = false; }
ok(watcherCompiles, 'upgraded pager condition code compiles');

if (failures) {
  console.error(`\n${failures} outbound-pager check(s) failed`);
  process.exit(1);
}
console.log('\nB4 outbound pager checks passed');
