'use strict';

const crypto = require('crypto');
const {
  BRANCHES,
  DEAD_LETTER_TABLE_ID,
  INSTALL_NODE_NAMES,
  MAX_ATTEMPTS,
  RECEIPT_FIELDS,
  RECEIPT_TABLE,
  SUPABASE_CREDENTIAL,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  diffOperations,
  transform,
  verify,
} = require('../scripts/f44-linear-intake-transform');
const {
  formGateCode,
  isInstalled: isAuthorityInstalled,
  transformForms: transformAuthorityForms,
  verifyTransformed: verifyAuthorityTransformed,
} = require('../scripts/write-ui-n8n-authority-gates');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures += 1; console.error('FAIL  ' + message); }
}

function node(name, type = 'n8n-nodes-base.code', parameters = {}) {
  return { id: name.replace(/\W/g, '-'), name, type, typeVersion: type.endsWith('.code') ? 2 : 1, position: [0, 0], parameters };
}
function edge(name, index = 0) { return { node: name, type: 'main', index }; }
function link(connections, source, target, sourceIndex = 0) {
  connections[source] = connections[source] || { main: [] };
  while (connections[source].main.length <= sourceIndex) connections[source].main.push([]);
  connections[source].main[sourceIndex].push(edge(target));
}

/*
 * Sanitized live-shape fixture for BrJSe8zCKUccfmIq. It intentionally models
 * the current authority responses, lookup chains, old mutation nodes, Slack,
 * and graphics title helper. It is not the unrelated onboarding backup.
 */
function liveShapeFixture() {
  const names = [
    'Webhook', 'Webhook2',
    'Authority Gate - Video Form',
    'Authority Route - Video Form', 'Authority Accepted - Video Form', 'Authority Rejected - Video Form',
    'Authority Gate - Graphics Form',
    'Authority Route - Graphics Form', 'Authority Accepted - Graphics Form', 'Authority Rejected - Graphics Form',
    'Fetch Filming Plans', 'Fetch SMM', 'Lookup SMM Key', 'Find Project', 'Get Editors', 'Find Editor', 'Pick Freest Editor',
    'Create Parent Issue', 'Send a message', 'Code in JavaScript', 'Loop Over Items', 'Create Sub-Issues',
    'Fetch Filming Plans1', 'Fetch SMM1', 'Lookup SMM Key1', 'Code in JavaScript2', 'Download Filming Plan', 'Find GRA Project',
    'Create Parent Issue1', 'Send a message1', 'Code in JavaScript3', 'Generate Titles', 'Create Sub-Issues2',
  ];
  const nodes = names.map(name => {
    if (name.startsWith('Webhook')) return node(name, 'n8n-nodes-base.webhook', { responseMode: 'responseNode' });
    if (name === 'Authority Gate - Video Form') return node(name, 'n8n-nodes-base.code', { mode: 'runOnceForAllItems', jsCode: formGateCode('video') });
    if (name === 'Authority Gate - Graphics Form') return node(name, 'n8n-nodes-base.code', { mode: 'runOnceForAllItems', jsCode: formGateCode('graphics') });
    if (name.startsWith('Authority Route')) return node(name, 'n8n-nodes-base.if', {});
    if (name.startsWith('Authority Rejected')) {
      return node(name, 'n8n-nodes-base.respondToWebhook', { respondWith: 'json', responseBody: '={{ { ok: false } }}', options: { responseCode: '={{ $json._writeUiAuthority.http_status || 503 }}' } });
    }
    if (name.startsWith('Authority Accepted')) {
      return node(name, 'n8n-nodes-base.respondToWebhook', { respondWith: 'json', responseBody: '{"message":"Workflow was started"}', options: { responseCode: 200 } });
    }
    if (name.startsWith('Send a message')) return node(name, 'n8n-nodes-base.slack', { text: 'fixture' });
    if (['Lookup SMM Key', 'Lookup SMM Key1', 'Code in JavaScript2', 'Code in JavaScript', 'Code in JavaScript3', 'Generate Titles', 'Pick Freest Editor'].includes(name)) {
      return node(name, 'n8n-nodes-base.code', { mode: 'runOnceForAllItems', jsCode: 'return $input.all();' });
    }
    return node(name, 'n8n-nodes-base.httpRequest', {});
  });
  const connections = {};
  link(connections, 'Webhook', 'Authority Gate - Video Form');
  link(connections, 'Authority Gate - Video Form', 'Authority Route - Video Form');
  link(connections, 'Authority Route - Video Form', 'Authority Accepted - Video Form', 0);
  link(connections, 'Authority Route - Video Form', 'Authority Rejected - Video Form', 1);
  link(connections, 'Authority Accepted - Video Form', 'Fetch Filming Plans');
  for (const [a, b] of [
    ['Fetch Filming Plans', 'Fetch SMM'], ['Fetch SMM', 'Lookup SMM Key'], ['Lookup SMM Key', 'Find Project'],
    ['Find Project', 'Get Editors'], ['Get Editors', 'Find Editor'], ['Find Editor', 'Pick Freest Editor'],
    ['Pick Freest Editor', 'Create Parent Issue'], ['Create Parent Issue', 'Send a message'],
    ['Send a message', 'Code in JavaScript'], ['Code in JavaScript', 'Loop Over Items'],
    ['Create Sub-Issues', 'Loop Over Items'],
  ]) link(connections, a, b);
  link(connections, 'Loop Over Items', 'Create Sub-Issues', 1);

  link(connections, 'Webhook2', 'Authority Gate - Graphics Form');
  link(connections, 'Authority Gate - Graphics Form', 'Authority Route - Graphics Form');
  link(connections, 'Authority Route - Graphics Form', 'Authority Accepted - Graphics Form', 0);
  link(connections, 'Authority Route - Graphics Form', 'Authority Rejected - Graphics Form', 1);
  link(connections, 'Authority Accepted - Graphics Form', 'Fetch Filming Plans1');
  for (const [a, b] of [
    ['Fetch Filming Plans1', 'Fetch SMM1'], ['Fetch SMM1', 'Lookup SMM Key1'], ['Lookup SMM Key1', 'Code in JavaScript2'],
    ['Code in JavaScript2', 'Download Filming Plan'], ['Download Filming Plan', 'Find GRA Project'],
    ['Find GRA Project', 'Create Parent Issue1'], ['Create Parent Issue1', 'Send a message1'],
    ['Send a message1', 'Code in JavaScript3'], ['Code in JavaScript3', 'Generate Titles'],
    ['Generate Titles', 'Create Sub-Issues2'],
  ]) link(connections, a, b);
  return { id: WORKFLOW_ID, name: WORKFLOW_NAME, versionId: 'sanitized-live-shape', active: true, nodes, connections };
}

function byName(workflow, name) { return workflow.nodes.find(item => item.name === name); }
function target(workflow, source, sourceIndex = 0) { return workflow.connections[source]?.main?.[sourceIndex]?.[0]?.node; }
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}

async function simulateReadBeforeCreate(workflow) {
  const payload = {
    clientName: 'Simulation Client',
    filmingPlans: 'https://docs.google.com/document/d/simulation',
    notes: 'Immutable simulation notes',
    title: 'Simulation Client | Jul. 14 - Jul. 18',
    videos: [{ number: 1, main_cam: 'https://drive/main', side_cam: '', audio: '', dueDate: '2026-07-21' }],
  };
  const payloadJson = stable(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
  const receiptKey = 'linear-intake-v1:video:' + payloadHash;
  const values = {
    'F44 Normalize Video': { _f44: { receipt_key: receiptKey, payload_hash: payloadHash, payload_json: payloadJson, client: payload.clientName, team: 'video', payload } },
    'F44 Read Claimed Receipt Video': { receipt_key: receiptKey, attempts: 0, replay_note: null },
    'Lookup SMM Key': { smmApiKey: 'simulation-key', filmingPlanUrl: payload.filmingPlans },
    'Find Project': { data: { team: { projects: { nodes: [{ id: 'simulation-project' }] } } } },
    'Find Editor': { data: { users: { nodes: [{ id: 'simulation-assignee' }] } } },
    'Pick Freest Editor': { id: 'simulation-assignee' },
  };
  const arrays = { 'Get Editors': [{ json: { email: 'editor@example.com' } }] };
  const dollar = name => ({
    first: () => ({ json: values[name] || {} }),
    all: () => arrays[name] || [{ json: values[name] || {} }],
  });
  const events = [];
  const stored = new Map();
  let parentId = null;
  let parentReadCount = 0;
  let parentCreateCount = 0;
  let childCreateCount = 0;
  const notFound = () => ({ errors: [{ message: 'Entity not found' }] });
  const issueFrom = input => ({
    id: input.id,
    identifier: input.parentId ? 'VID-CHILD' : 'VID-PARENT',
    title: input.title,
    url: 'https://linear.app/issue/' + input.id,
    team: { id: input.teamId, key: 'VID' },
    project: { id: input.projectId },
    parent: input.parentId ? { id: input.parentId } : null,
  });
  const helper = async ({ body }) => {
    const query = String(body && body.query || '');
    const variables = body && body.variables || {};
    if (query.includes('F44Viewer')) return { data: { viewer: { id: 'viewer' } } };
    if (query.includes('F44Project')) return { data: { project: { id: 'simulation-project', team: { id: BRANCHES[0].teamId } } } };
    if (query.includes('F44Assignee')) return { data: { user: { id: 'simulation-assignee', active: true } } };
    if (query.includes('F44ReadIssue')) {
      if (!parentId) parentId = variables.id;
      const kind = variables.id === parentId ? 'parent' : 'child';
      events.push('read:' + kind);
      if (kind === 'parent') {
        parentReadCount += 1;
        if (parentReadCount === 1) throw new Error('simulated read outage');
      }
      return stored.has(variables.id) ? { data: { issue: stored.get(variables.id) } } : notFound();
    }
    if (query.includes('F44CreateIssue')) {
      const input = variables.input;
      const kind = input.parentId ? 'child' : 'parent';
      events.push('create:' + kind);
      const issue = issueFrom(input);
      stored.set(input.id, issue);
      if (kind === 'parent') {
        parentCreateCount += 1;
        if (parentCreateCount === 1) throw new Error('simulated ambiguous create timeout');
      } else {
        childCreateCount += 1;
      }
      return { data: { issueCreate: { success: true, issue } } };
    }
    throw new Error('unexpected simulation query');
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('$', 'setTimeout', byName(workflow, 'F44 Worker Video').parameters.jsCode);
  const result = await run.call({ helpers: { httpRequest: helper } }, dollar, callback => { callback(); return 0; });
  return { events, result: result[0].json, parentCreateCount, childCreateCount, storedCount: stored.size };
}

async function runClassifier(workflow, suffix, expected, row) {
  const values = {
    [`F44 Normalize ${suffix}`]: { _f44: expected },
    [`F44 Fetch Existing Receipt ${suffix}`]: row,
  };
  const dollar = name => ({ first: () => ({ json: values[name] || {} }) });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('$', byName(workflow, `F44 Classify Existing Receipt ${suffix}`).parameters.jsCode);
  const result = await run(dollar);
  return result[0].json;
}

async function runClaimVerify(workflow, suffix, expected, classified, row) {
  const values = {
    [`F44 Normalize ${suffix}`]: { _f44: expected },
    [`F44 Classify Existing Receipt ${suffix}`]: classified,
    [`F44 Read Claimed Receipt ${suffix}`]: row,
  };
  const dollar = name => ({ first: () => ({ json: values[name] || {} }) });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('$', byName(workflow, `F44 Verify Claimed Receipt ${suffix}`).parameters.jsCode);
  const result = await run(dollar);
  return result[0].json;
}

async function simulateWorkerPlanDependency(workflow, mode) {
  const payload = {
    clientName: 'Preflight Client',
    filmingPlans: 'https://docs.google.com/document/d/preflight',
    notes: 'Immutable proof notes',
    title: 'Preflight Client | Jul. 14 - Jul. 18',
    videos: [{ number: 1, main_cam: 'https://drive/main', side_cam: '', audio: '', dueDate: '2026-07-21' }],
  };
  const payloadJson = stable(payload);
  const payloadHash = crypto.createHash('sha256').update(payloadJson).digest('hex');
  const receiptKey = 'linear-intake-v1:video:' + payloadHash;
  const mappedPlanUrl = mode === 'missing-mapped'
    ? ''
    : (mode === 'different' ? 'https://docs.google.com/document/d/current-mapping' : payload.filmingPlans);
  const values = {
    'F44 Normalize Video': { _f44: { receipt_key: receiptKey, payload_hash: payloadHash, payload_json: payloadJson, client: payload.clientName, team: 'video', payload } },
    'F44 Read Claimed Receipt Video': { receipt_key: receiptKey, attempts: mode === 'different' ? 1 : 0, replay_note: null },
    'Lookup SMM Key': { smmApiKey: 'proof-key', filmingPlanUrl: mappedPlanUrl },
    'Find Project': { data: { team: { projects: { nodes: [{ id: 'proof-project' }] } } } },
    'Find Editor': { data: { users: { nodes: [{ id: 'proof-assignee' }] } } },
    'Pick Freest Editor': { id: 'proof-assignee' },
  };
  const arrays = { 'Get Editors': [{ json: { email: 'editor@example.com' } }] };
  const dollar = name => ({
    first: () => ({ json: values[name] || {} }),
    all: () => arrays[name] || [{ json: values[name] || {} }],
  });
  const stored = new Map();
  let parentId = null;
  let requestCount = 0;
  let mutationCount = 0;
  const notFound = () => ({ errors: [{ message: 'Entity not found' }] });
  const issueFrom = input => ({
    id: input.id,
    identifier: input.parentId ? 'VID-CHILD' : 'VID-PARENT',
    title: input.title,
    url: 'https://linear.app/issue/' + input.id,
    team: { id: input.teamId, key: 'VID' },
    project: { id: input.projectId },
    parent: input.parentId ? { id: input.parentId } : null,
  });
  const helper = async ({ body }) => {
    requestCount += 1;
    const query = String(body && body.query || '');
    const variables = body && body.variables || {};
    if (query.includes('F44Viewer')) return { data: { viewer: { id: 'viewer' } } };
    if (query.includes('F44Project')) return { data: { project: { id: 'proof-project', team: { id: BRANCHES[0].teamId } } } };
    if (query.includes('F44Assignee')) return { data: { user: { id: 'proof-assignee', active: true } } };
    if (query.includes('F44ReadIssue')) {
      if (!parentId) parentId = variables.id;
      return stored.has(variables.id) ? { data: { issue: stored.get(variables.id) } } : notFound();
    }
    if (query.includes('F44CreateIssue')) {
      mutationCount += 1;
      const input = variables.input;
      const issue = issueFrom(input);
      stored.set(input.id, issue);
      return { data: { issueCreate: { success: true, issue } } };
    }
    throw new Error('unexpected proof query');
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('$', 'setTimeout', byName(workflow, 'F44 Worker Video').parameters.jsCode);
  const output = await run.call({ helpers: { httpRequest: helper } }, dollar, callback => { callback(); return 0; });
  return { result: output[0].json, requestCount, mutationCount, storedCount: stored.size };
}

const before = liveShapeFixture();
let after;
try { after = transform(before); } catch (error) { console.error(error.stack); failures += 1; }
ok(Boolean(after), 'sanitized VIDEO PRODUCTION live-shape transforms');
if (after) {
  ok(verify(after) === after, 'installed graph passes strict readback verification');
  ok(!after.nodes.some(item => /^Authority Accepted - (Video|Graphics) Form$/.test(item.name)), 'premature green Respond nodes are absent');
  ok(!after.nodes.some(item => ['Create Parent Issue', 'Create Parent Issue1', 'Create Sub-Issues', 'Create Sub-Issues2'].includes(item.name)), 'legacy parent/child mutation nodes are removed');
  ok(INSTALL_NODE_NAMES.every(name => byName(after, name)), 'all-or-nothing install marker set is complete');

  for (const branch of BRANCHES) {
    const suffix = branch.label;
    const normalize = byName(after, `F44 Normalize ${suffix}`);
    const insert = byName(after, `F44 Insert Receipt ${suffix}`);
    const classify = byName(after, `F44 Classify Existing Receipt ${suffix}`);
    const replay = byName(after, `F44 Replay Receipt ${suffix}`);
    const claimRead = byName(after, `F44 Read Claimed Receipt ${suffix}`);
    const claimVerify = byName(after, `F44 Verify Claimed Receipt ${suffix}`);
    const worker = byName(after, `F44 Worker ${suffix}`);
    const finalize = byName(after, `F44 Finalize Receipt ${suffix}`);
    const finalRead = byName(after, `F44 Read Final Receipt ${suffix}`);
    const finalVerify = byName(after, `F44 Verify Final Receipt ${suffix}`);
    const dlq = byName(after, `F44 Dead Letter Mirror ${suffix}`);
    const failureResponse = byName(after, `F44 Failure Response ${suffix}`);
    const success = byName(after, `F44 Success Response ${suffix}`);
    const duplicate = byName(after, `F44 Duplicate Success ${suffix}`);

    ok(target(after, branch.authorityRoute, 0) === `F44 Normalize ${suffix}`, `${suffix}: authority proceeds to canonical receipt, not success`);
    ok(insert.parameters.tableId === RECEIPT_TABLE
      && insert.credentials.supabaseApi.id === SUPABASE_CREDENTIAL.id
      && JSON.stringify(insert.parameters.fieldsUi.fieldValues.map(item => item.fieldId)) === JSON.stringify(RECEIPT_FIELDS), `${suffix}: authoritative receipt uses exact 14 fields and credential`);
    ok(insert.onError === 'continueErrorOutput'
      && target(after, `F44 Insert Receipt ${suffix}`, 1) === `F44 Fetch Existing Receipt ${suffix}`, `${suffix}: PK collision has a distinct dedupe path`);
    ok(/filming plan is required/.test(normalize.parameters.jsCode), `${suffix}: empty submitted filming plan is rejected before receipt insertion`);
    ok(/status === 'pending'/.test(classify.parameters.jsCode)
      && /http_status: 409/.test(classify.parameters.jsCode)
      && /operator must reconcile every deterministic Linear ID/.test(classify.parameters.jsCode), `${suffix}: fresh or stale pending never reports success`);
    ok(/row\.payload_json !== expected\.payload_json/.test(classify.parameters.jsCode)
      && /children\.length !== expected\.payload\.videos\.length/.test(classify.parameters.jsCode)
      && /uuidV4/.test(classify.parameters.jsCode), `${suffix}: stored duplicate requires exact payload, parent UUID, and child count`);
    ok(/exact_id_readback/.test(classify.parameters.jsCode)
      && /strategy: 'read-before-create'/.test(classify.parameters.jsCode)
      && /replay_id: replayId/.test(classify.parameters.jsCode)
      && /status === 'failed'/.test(classify.parameters.jsCode), `${suffix}: failed receipt replay note is structured and payload-free`);
    ok(/status === 'partial'/.test(classify.parameters.jsCode)
      && /action: 'operator_required'/.test(classify.parameters.jsCode)
      && /operator_replay_id/.test(classify.parameters.jsCode)
      && /note\.source_status === 'partial'/.test(classify.parameters.jsCode)
      && /transportReplayId === String\(note\.replay_id/.test(classify.parameters.jsCode), `${suffix}: partial receipts require an exact operator replay claim`);
    ok(replay.parameters.filters.conditions.map(item => item.keyName).join(',') === 'receipt_key,status,updated_at'
      && replay.parameters.fieldsUi.fieldValues.some(item => item.fieldId === 'attempts' && /\+ 1/.test(item.fieldValue)), `${suffix}: automatic failed replay uses status+version CAS and increments attempts`);
    ok(replay.alwaysOutputData === true && replay.onError === 'continueErrorOutput'
      && target(after, `F44 Replay Receipt ${suffix}`) === `F44 Read Claimed Receipt ${suffix}`
      && target(after, `F44 Replay Receipt ${suffix}`, 1) === `F44 Claim Conflict ${suffix}`, `${suffix}: zero-row/error replay cannot reach worker`);
    ok(target(after, `F44 Existing Replay ${suffix}`, 1) === `F44 Existing Claimed ${suffix}`
      && target(after, `F44 Existing Claimed ${suffix}`) === `F44 Read Claimed Receipt ${suffix}`
      && target(after, `F44 Existing Claimed ${suffix}`, 1) === `F44 Existing Receipt Response ${suffix}`, `${suffix}: only a validated operator claim bypasses automatic CAS`);
    ok(claimRead.alwaysOutputData === true && /row\.status === 'pending'/.test(claimVerify.parameters.jsCode)
      && /row\.payload_json === expected\.payload_json/.test(claimVerify.parameters.jsCode)
      && /preclaimedReplay/.test(claimVerify.parameters.jsCode)
      && /row\.updated_at/.test(claimVerify.parameters.jsCode), `${suffix}: exact automatic or operator-claimed row is re-read before work`);

    const workerCode = worker.parameters.jsCode;
    ok(workerCode.includes(`const MAX_ATTEMPTS = ${MAX_ATTEMPTS}`)
      && workerCode.includes('existing = await readIssue(expected.id)')
      && workerCode.includes('const readback = await readIssue(expected.id)')
      && workerCode.includes('An unavailable read never falls through to mutation')
      && workerCode.includes('timeout: 15000'), `${suffix}: bounded timeout/late-create path always exact-ID reads before retry`);
    ok(workerCode.includes('projects.length !== 1')
      && workerCode.includes('if (!projectId)')
      && workerCode.includes('if (!apiKey)')
      && workerCode.includes('if (!submittedPlanUrl)')
      && workerCode.includes('if (!mappedPlanUrl)')
      && workerCode.includes('no current filming plan mapping for ')
      && workerCode.includes('no ' + branch.team + ' roster'), `${suffix}: complete preflight forbids null project and missing credential/plan/roster`);
    ok(workerCode.includes("const description = String(ctx.payload.notes || '')")
      && workerCode.includes("title: String(ctx.payload.title || '')")
      && !workerCode.includes('mappedPlanUrl !== submittedPlanUrl'), `${suffix}: immutable payload stays bound while current nonempty plan mapping may advance`);
    ok(workerCode.includes('confirmedChildIds.length !== videos.length')
      && workerCode.includes('new Set(confirmedChildIds).size !== videos.length')
      && workerCode.includes("status: 'created'"), `${suffix}: created requires every expected child readback`);
    ok(!/mutation_started|safe_to_abandon_receipt/.test(workerCode + failureResponse.parameters.responseBody), `${suffix}: no server receipt can advertise abandonment or a corrected-hash escape`);

    const finalFilters = finalize.parameters.filters.conditions.map(item => item.keyName);
    ok(['receipt_key', 'payload_hash', 'status', 'updated_at', 'attempts'].every(name => finalFilters.includes(name))
      && finalize.onError === 'continueErrorOutput' && finalize.alwaysOutputData === true, `${suffix}: terminal write is claim-CAS and has explicit error output`);
    ok(finalRead.onError === 'continueErrorOutput' && finalRead.alwaysOutputData === true
      && /storedChildren\.length === expected\.payload\.videos\.length/.test(finalVerify.parameters.jsCode), `${suffix}: terminal row is re-read and child-count bound before 200`);
    ok(target(after, `F44 Final Receipt Valid ${suffix}`, 0) === `F44 Created ${suffix}`
      && target(after, `F44 Final Receipt Valid ${suffix}`, 1) === `F44 Dead Letter Mirror ${suffix}`, `${suffix}: failed final readback cannot enter success`);
    ok(dlq.parameters.dataTableId.value === DEAD_LETTER_TABLE_ID
      && dlq.onError === 'continueRegularOutput'
      && target(after, `F44 Finalize Receipt ${suffix}`, 1) === `F44 Dead Letter Mirror ${suffix}`, `${suffix}: finalize error carries payload/confirmed IDs to operator mirror`);
    ok(target(after, `F44 Created ${suffix}`, 0) === `F44 Success Response ${suffix}`
      && target(after, `F44 Success Response ${suffix}`) === `F44 Slack Shape ${suffix}`
      && target(after, `F44 Slack Shape ${suffix}`) === branch.slack, `${suffix}: browser success follows ledger and precedes fail-soft Slack`);
    ok(success.parameters.enableResponseOutput === true && success.parameters.options.responseCode === 200
      && /status: 'created'/.test(success.parameters.responseBody)
      && /ledger_status: 'created'/.test(success.parameters.responseBody)
      && /team:/.test(success.parameters.responseBody) && /payload_hash/.test(success.parameters.responseBody), `${suffix}: fresh success is a fully bound created receipt`);
    ok(duplicate.parameters.options.responseCode === 200 && /status: 'created'/.test(duplicate.parameters.responseBody)
      && /ledger_status: 'created'/.test(duplicate.parameters.responseBody)
      && /duplicate: true/.test(duplicate.parameters.responseBody) && /payload_hash/.test(duplicate.parameters.responseBody), `${suffix}: duplicate success uses the same created contract`);
    if (branch.team === 'graphics') {
      ok(target(after, 'Find GRA Project') === 'F44 Prepare Graphics Titles'
        && target(after, 'F44 Prepare Graphics Titles') === 'Generate Titles'
        && target(after, 'Generate Titles') === 'F44 Worker Graphics'
        && byName(after, 'Generate Titles').onError === 'continueRegularOutput'
        && byName(after, 'Generate Titles').alwaysOutputData === true
        && /generatedTitles\.get\(number\) \|\| childTitle/.test(workerCode), 'Graphics: existing generated-title descriptions are preserved with deterministic fallback');
    }
  }

  const videoInsert = byName(after, 'F44 Insert Receipt Video');
  const graphicsInsert = byName(after, 'F44 Insert Receipt Graphics');
  const videoKey = videoInsert.parameters.fieldsUi.fieldValues.find(item => item.fieldId === 'team').fieldValue;
  const graphicsKey = graphicsInsert.parameters.fieldsUi.fieldValues.find(item => item.fieldId === 'team').fieldValue;
  ok(videoKey === 'video' && graphicsKey === 'graphics', 'both-team submission has independent team-scoped PK receipts and partial states');

  const operations = diffOperations(before, after);
  ok(operations.some(item => item.type === 'removeNode' && item.nodeName === 'Authority Accepted - Video Form')
    && operations.some(item => item.type === 'removeNode' && item.nodeName === 'Create Parent Issue'), 'operation batch removes early response and old mutation path');
  ok(operations.some(item => item.type === 'addNode' && item.node.name === 'F44 Insert Receipt Video')
    && operations.some(item => item.type === 'addConnection' && item.source === 'F44 Success Response Video' && item.target === 'F44 Slack Shape Video'), 'operation batch installs durable response topology');
  ok(!JSON.stringify(operations).includes('sk-ant-') && !JSON.stringify(operations).includes('Bearer sb_'), 'reviewable operation batch copies no secret into source');
  ok(diffOperations(after, transform(after)).length === 0, 'transform and operation diff are idempotent');
  ok(isAuthorityInstalled(after), 'older authority installer recognizes the hardened F44 graph as installed');
  ok(JSON.stringify(transformAuthorityForms(after)) === JSON.stringify(after), 'older authority form transform is idempotent on hardened F44 graph');
  ok(verifyAuthorityTransformed(after, after) === after, 'older authority readback verifier accepts the hardened F44 graph');

  const partial = JSON.parse(JSON.stringify(before));
  partial.nodes.push(JSON.parse(JSON.stringify(byName(after, 'F44 Normalize Video'))));
  let partialRejected = false;
  try { transform(partial); } catch (error) { partialRejected = /partial install/.test(error.message); }
  ok(partialRejected, 'partial install fails closed rather than guessing');
}

async function main() {
  if (after) {
    const samplePayload = {
      clientName: 'Clínica Ñ',
      filmingPlans: 'https://docs.google.com/document/d/abc',
      notes: 'Filming Plan: https://docs.google.com/document/d/abc\n\nKeep this',
      title: 'Clínica Ñ | Jul. 14 - Jul. 18',
      videos: [{ number: 1, main_cam: 'https://drive/1', side_cam: '', audio: '', dueDate: '2026-07-21' }],
    };
    const expectedHash = crypto.createHash('sha256').update(stable(samplePayload)).digest('hex');
    const receiptKey = 'linear-intake-v1:video:' + expectedHash;
    const body = { ...samplePayload, mode: 'video', team: 'video', payload_hash: expectedHash, idempotency_key: receiptKey, receipt_key: receiptKey };
    const generated = await new (Object.getPrototypeOf(async function () {}).constructor)('$', byName(after, 'F44 Normalize Video').parameters.jsCode)(
      () => ({ first: () => ({ json: { body } }) }),
    );
    ok(generated[0].json._f44.valid === true
      && generated[0].json._f44.payload_hash === expectedHash
      && generated[0].json._f44.payload_json === stable(samplePayload), 'server recomputes UTF-8 SHA-256 over exact canonical payload_json');
    const operatorReplayId = '8d0db9ec-5ee7-44eb-8cdd-2d7cb824187e';
    const withOperatorToken = await new (Object.getPrototypeOf(async function () {}).constructor)('$', byName(after, 'F44 Normalize Video').parameters.jsCode)(
      () => ({ first: () => ({ json: { body: { ...body, operator_replay_id: operatorReplayId } } }) }),
    );
    ok(withOperatorToken[0].json._f44.valid === true
      && withOperatorToken[0].json._f44.payload_hash === generated[0].json._f44.payload_hash
      && withOperatorToken[0].json._f44.payload_json === generated[0].json._f44.payload_json, 'operator replay token is transport-only and cannot change the canonical payload/hash');
    const tampered = { ...body, title: body.title + ' changed' };
    const rejected = await new (Object.getPrototypeOf(async function () {}).constructor)('$', byName(after, 'F44 Normalize Video').parameters.jsCode)(
      () => ({ first: () => ({ json: { body: tampered } }) }),
    );
    ok(rejected[0].json._f44.valid === false && /payload hash mismatch/.test(rejected[0].json._f44.error), 'server rejects payload/hash drift before receipt or work');
    const wrongReceipt = { ...body, receipt_key: receiptKey + '-wrong' };
    const receiptRejected = await new (Object.getPrototypeOf(async function () {}).constructor)('$', byName(after, 'F44 Normalize Video').parameters.jsCode)(
      () => ({ first: () => ({ json: { body: wrongReceipt } }) }),
    );
    ok(receiptRejected[0].json._f44.valid === false && /receipt key mismatch/.test(receiptRejected[0].json._f44.error), 'server rejects a raw receipt_key that is not exactly team+canonical hash');
    const missingPlanPayload = { ...samplePayload, filmingPlans: '' };
    const missingPlanHash = crypto.createHash('sha256').update(stable(missingPlanPayload)).digest('hex');
    const missingPlanKey = 'linear-intake-v1:video:' + missingPlanHash;
    const missingPlanNormalized = await new (Object.getPrototypeOf(async function () {}).constructor)('$', byName(after, 'F44 Normalize Video').parameters.jsCode)(
      () => ({ first: () => ({ json: { body: {
        ...missingPlanPayload,
        mode: 'video',
        team: 'video',
        payload_hash: missingPlanHash,
        idempotency_key: missingPlanKey,
        receipt_key: missingPlanKey,
      } } }) }),
    );
    ok(missingPlanNormalized[0].json._f44.valid === false
      && missingPlanNormalized[0].json._f44.error === 'filming plan is required', 'empty submitted filming plan fails specifically before a server receipt can be inserted');

    const parentIssueId = '11111111-1111-4111-8111-111111111111';
    const childIssueId = '22222222-2222-4222-8222-222222222222';
    const rowBase = {
      receipt_key: receiptKey,
      payload_hash: expectedHash,
      client: samplePayload.clientName,
      team: 'video',
      payload_json: stable(samplePayload),
      attempts: 2,
      parent_issue_id: parentIssueId,
      parent_issue_url: 'https://linear.app/issue/' + parentIssueId,
      child_issue_ids: JSON.stringify([childIssueId]),
      error: 'prior partial failure',
      updated_at: '2026-07-14T12:00:00.000Z',
    };
    const partialResult = await runClassifier(after, 'Video', withOperatorToken[0].json._f44, { ...rowBase, status: 'partial', replay_note: null });
    ok(partialResult.action === 'operator_required' && partialResult.http_status === 409
      && /operator recovery/.test(partialResult.error), 'partial receipt is non-200 and requires operator recovery before any replay');
    const failedResult = await runClassifier(after, 'Video', generated[0].json._f44, {
      ...rowBase,
      status: 'failed',
      parent_issue_id: null,
      parent_issue_url: null,
      child_issue_ids: '[]',
      replay_note: null,
    });
    ok(failedResult.action === 'replay' && failedResult.http_status === 202
      && JSON.parse(failedResult.replay_note).source_status === 'failed', 'failed receipt retains bounded automatic retry with a structured claim');

    const replayNote = JSON.stringify({
      exact_id_readback: {
        confirmed_child_ids: [childIssueId],
        parent: 'present',
        strategy: 'read-before-create',
      },
      payload_hash: expectedHash,
      prior_attempts: 2,
      reason: 'operator reconciled all deterministic Linear IDs',
      receipt_key: receiptKey,
      replay_id: operatorReplayId,
      requested_at: '2026-07-14T12:05:00.000Z',
      requested_by: 'operator@example.com',
      schema_version: 1,
      source_status: 'partial',
    });
    const pendingClaim = { ...rowBase, status: 'pending', attempts: 3, replay_note: replayNote, updated_at: '2026-07-14T12:05:00.000Z' };
    const freshPending = await runClassifier(after, 'Video', generated[0].json._f44, {
      ...rowBase,
      status: 'pending',
      attempts: 0,
      parent_issue_id: null,
      parent_issue_url: null,
      child_issue_ids: '[]',
      replay_note: null,
    });
    const missingToken = await runClassifier(after, 'Video', generated[0].json._f44, pendingClaim);
    const wrongToken = await runClassifier(after, 'Video', {
      ...generated[0].json._f44,
      body: { ...body, operator_replay_id: '6bce61e1-8b85-4d4c-a3c8-a73be7c09560' },
    }, pendingClaim);
    const claimedResult = await runClassifier(after, 'Video', withOperatorToken[0].json._f44, pendingClaim);
    ok([freshPending, missingToken, wrongToken].every(result => result.action === 'pending' && result.http_status === 409), 'fresh pending and missing/wrong operator tokens stay 409 and cannot route to work');
    ok(claimedResult.action === 'claimed' && claimedResult.http_status === 202, 'DB-validated operator token plus exact receipt/attempt/issue bindings claims partial replay');
    const claimedReadback = await runClaimVerify(after, 'Video', withOperatorToken[0].json._f44, claimedResult, pendingClaim);
    const driftedReadback = await runClaimVerify(after, 'Video', withOperatorToken[0].json._f44, claimedResult, { ...pendingClaim, attempts: 4 });
    ok(claimedReadback.valid === true && claimedReadback.expected_attempts === 3, 'operator-claimed pending row reaches worker only after exact readback and without a second CAS');
    ok(driftedReadback.valid === false, 'operator claim readback fails closed when the DB attempt changes');

    const missingMappedPlan = await simulateWorkerPlanDependency(after, 'missing-mapped');
    ok(missingMappedPlan.result.status === 'failed'
      && missingMappedPlan.result.http_status === 422
      && missingMappedPlan.result.error === 'no current filming plan mapping for Preflight Client'
      && missingMappedPlan.result.attempts === 0
      && missingMappedPlan.result.parent_issue_id === null
      && missingMappedPlan.result.child_issue_ids.length === 0
      && missingMappedPlan.requestCount === 0
      && missingMappedPlan.mutationCount === 0, 'missing current filming-plan mapping is a specific preflight failure with no Linear mutation');
    const advancedMappedPlan = await simulateWorkerPlanDependency(after, 'different');
    ok(advancedMappedPlan.result.status === 'created'
      && advancedMappedPlan.result.payload_hash === advancedMappedPlan.result.receipt_key.slice('linear-intake-v1:video:'.length)
      && advancedMappedPlan.result.attempts === 3
      && advancedMappedPlan.result.child_issue_ids.length === 1
      && advancedMappedPlan.mutationCount === 2
      && advancedMappedPlan.storedCount === 2, 'unchanged receipt retry succeeds when the current nonempty plan mapping differs from the submitted URL');

    const simulation = await simulateReadBeforeCreate(after);
    const expectedPrefix = [
      'read:parent',
      'read:parent', 'create:parent', 'read:parent',
      'read:child', 'create:child', 'read:child',
    ];
    if (JSON.stringify(simulation.events) !== JSON.stringify(expectedPrefix)) console.error('simulation events:', JSON.stringify(simulation.events));
    if (!(simulation.result.status === 'created' && simulation.result.attempts === 2 && simulation.result.child_issue_ids.length === 1)) console.error('simulation result:', JSON.stringify(simulation.result));
    ok(JSON.stringify(simulation.events) === JSON.stringify(expectedPrefix), 'simulation: unavailable read never creates; ambiguous create is persisted then found by exact-ID readback');
    ok(simulation.result.status === 'created'
      && simulation.result.attempts === 2
      && simulation.result.child_issue_ids.length === 1
      && simulation.parentCreateCount === 1
      && simulation.childCreateCount === 1
      && simulation.storedCount === 2, 'simulation: ambiguous timeout produces exactly one parent, one child, and no duplicate/phantom work');
  }
  if (failures) process.exit(1);
  console.log('\nF44 Linear intake transform checks passed');
}

main().catch(error => { console.error(error.stack || error); process.exit(1); });
