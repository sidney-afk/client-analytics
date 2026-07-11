'use strict';

const assert = require('assert');
const { NAMES, transformWorkflow } = require('../scripts/b4-pager-incremental-refresh');

function httpNode(name, url) {
  return {
    id: name,
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4,
    position: [0, 0],
    parameters: { url, jsonBody: '{}', method: 'POST' },
    credentials: { httpHeaderAuth: { id: 'dummy', name: 'dummy' } },
  };
}

const workflow = {
  id: 'dummy-workflow',
  name: 'Dummy pager',
  active: true,
  settings: { executionOrder: 'v1' },
  nodes: [
    { id: 'schedule', name: NAMES.schedule, type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, position: [0, 0], parameters: {} },
    httpNode('Trigger Reconciler V2', 'https://example.invalid/v2'),
    httpNode(NAMES.v2Summary, 'https://example.invalid/v2-summary'),
    httpNode(NAMES.mirror, 'https://example.invalid/mirror'),
    {
      id: 'check',
      name: NAMES.check,
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [0, 0],
      parameters: {
        jsCode: "const out = [];\nconst mirror = first('Fetch Latest Mirror Event');\nreturn out;",
      },
    },
  ],
  connections: {
    [NAMES.schedule]: { main: [[{ node: 'Trigger Reconciler V2', type: 'main', index: 0 }, { node: NAMES.v2Summary, type: 'main', index: 0 }]] },
    [NAMES.v2Summary]: { main: [[{ node: NAMES.mirror, type: 'main', index: 0 }]] },
  },
};

const original = JSON.parse(JSON.stringify(workflow));
const updated = transformWorkflow(workflow);

assert.deepStrictEqual(workflow, original, 'transform must not mutate the source workflow');
assert.strictEqual(updated.nodes.length, original.nodes.length + 3, 'exactly three additive nodes expected');
assert.ok(updated.nodes.find(node => node.name === NAMES.trigger).parameters.url.includes('b1-linear-incremental-refresh.yml'));
assert.strictEqual(updated.nodes.find(node => node.name === NAMES.trigger).parameters.jsonBody, '{"ref":"main"}');
assert.ok(updated.nodes.find(node => node.name === NAMES.incrementalSummary).parameters.url.includes('action=eq.linear_incremental_refresh'));
assert.ok(updated.nodes.find(node => node.name === NAMES.check).parameters.jsCode.includes('incrementalAge > 90'));
assert.strictEqual(updated.nodes.find(node => node.name === NAMES.trigger).credentials.httpHeaderAuth.id, 'dummy', 'existing GitHub credential must be reused');

const rerun = transformWorkflow(updated);
assert.deepStrictEqual(rerun, updated, 'transform must be idempotent');

console.log('B4 pager incremental-refresh transform: PASS');
