'use strict';

const {
  IDS,
  LIVE_PRECONDITIONS,
  assertWorkflowPrecondition,
  sha,
  transformComment,
  transformForms,
  transformInbound,
  transformStatus,
  verifyTransformed,
  writableSettings,
} = require('../scripts/write-ui-n8n-authority-gates');

let failures = 0;
function ok(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL  ' + message); }
}
function code(name, jsCode) { return { id: name, name, type: 'n8n-nodes-base.code', parameters: { jsCode }, position: [0, 0] }; }
function webhook(name) { return { id: name, name, type: 'n8n-nodes-base.webhook', parameters: {}, position: [0, 0] }; }
function edge(name) { return { node: name, type: 'main', index: 0 }; }
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

for (const id of Object.values(IDS)) {
  ok(LIVE_PRECONDITIONS[id] && /^[0-9a-f-]{36}$/.test(LIVE_PRECONDITIONS[id].versionId), `${id} exact live version is pinned`);
  for (const hash of Object.values(LIVE_PRECONDITIONS[id].nodeHashes)) ok(/^[0-9a-f]{64}$/.test(hash), `${id} exact node hash is pinned`);
}
ok(LIVE_PRECONDITIONS[IDS.inbound].active === false, 'MJb inactive live state is a hard precondition');
ok(JSON.stringify(writableSettings({ executionOrder: 'v1', binaryMode: 'filesystem-v2' }))
    === JSON.stringify({ executionOrder: 'v1' }),
  'workflow PUT omits the server-returned legacy binaryMode field');

const fakeSpec = { name: 'Fixture', versionId: 'v1', active: false, nodeHashes: { Code: sha('fixture-code') } };
const fake = { id: 'fixture', name: 'Fixture', versionId: 'v1', active: false, nodes: [code('Code', 'fixture-code')] };
ok(assertWorkflowPrecondition(fake, fakeSpec) === fake, 'exact precondition accepts matching workflow');
for (const [label, changed] of [
  ['version drift', { ...fake, versionId: 'v2' }],
  ['active drift', { ...fake, active: true }],
  ['node drift', { ...fake, nodes: [code('Code', 'changed')] }],
]) {
  let rejected = false;
  try { assertWorkflowPrecondition(changed, fakeSpec); } catch (_) { rejected = true; }
  ok(rejected, `precondition rejects ${label}`);
}

const status = {
  id: IDS.status,
  active: true,
  nodes: [
    webhook('Receive POST'),
    code('Apply Status to Linear', `const query = '{ issue(id: "' + id + '") { id identifier state { id name } dueDate team { states { nodes { id name } } } } }';
const issue = {};
const states = (issue.team && issue.team.states && issue.team.states.nodes) || [];
const mutation = 'issueUpdate';`),
    { id: 'Respond JSON', name: 'Respond JSON', type: 'n8n-nodes-base.respondToWebhook', parameters: { options: {} }, position: [0, 0] },
  ],
  connections: {},
};
const statusAfter = transformStatus(status);
ok(statusAfter.nodes.find(n => n.name === 'Apply Status to Linear').parameters.jsCode.includes("reason: 'syncview_authoritative'"), 'status bridge blocks SyncView authority before issueUpdate');
ok(statusAfter.nodes.find(n => n.name === 'Apply Status to Linear').parameters.jsCode.includes("authorityState.source !== 'live'"), 'status bridge never authorizes from stale last-known-good');
ok(statusAfter.nodes.find(n => n.name === 'Respond JSON').parameters.options.responseCode.includes('http_status'), 'status bridge returns a real 409/503');
ok(verifyTransformed(status, statusAfter) === statusAfter, 'status transform verifies');
let statusCompiles = true;
try { new AsyncFunction(statusAfter.nodes.find(n => n.name === 'Apply Status to Linear').parameters.jsCode); } catch (_) { statusCompiles = false; }
ok(statusCompiles, 'transformed status code compiles');
ok(transformStatus(statusAfter).nodes.find(n => n.name === 'Apply Status to Linear').parameters.jsCode === statusAfter.nodes.find(n => n.name === 'Apply Status to Linear').parameters.jsCode, 'status transform is idempotent');

const comment = {
  id: IDS.comment,
  active: true,
  nodes: [
    webhook('Receive POST'),
    code('Post Comment To Linear', `const resolved = await call({ query: '{ issue(id: "' + ident + '") { id identifier } }' });
const issue = resolved.data.issue;
const safeAuthor = author.replace(/x/g, 'x');
const mutation = 'commentCreate';`),
    { id: 'Respond JSON', name: 'Respond JSON', type: 'n8n-nodes-base.respondToWebhook', parameters: { options: {} }, position: [0, 0] },
  ],
  connections: {},
};
const commentAfter = transformComment(comment);
ok(commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode.includes('team { key }'), 'comment bridge resolves team before mutation');
ok(commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode.includes("authorityState.source !== 'live'"), 'comment bridge never authorizes from stale last-known-good');
ok(commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode.indexOf("syncview_authoritative") < commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode.indexOf('commentCreate'), 'comment gate precedes commentCreate');
ok(verifyTransformed(comment, commentAfter) === commentAfter, 'comment transform verifies');
let commentCompiles = true;
try { new AsyncFunction(commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode); } catch (_) { commentCompiles = false; }
ok(commentCompiles, 'transformed comment code compiles');
ok(transformComment(commentAfter).nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode === commentAfter.nodes.find(n => n.name === 'Post Comment To Linear').parameters.jsCode, 'comment transform is idempotent');

const forms = {
  id: IDS.forms,
  active: true,
  nodes: [webhook('Webhook'), webhook('Webhook2'), code('Fetch Filming Plans', 'return $input.all();'), code('Fetch Filming Plans1', 'return $input.all();')],
  connections: {
    Webhook: { main: [[edge('Fetch Filming Plans')]] },
    Webhook2: { main: [[edge('Fetch Filming Plans1')]] },
  },
};
const formsAfter = transformForms(forms);
ok(formsAfter.connections.Webhook.main[0][0].node === 'Authority Gate - Video Form', 'video form gate is first');
ok(formsAfter.connections.Webhook2.main[0][0].node === 'Authority Gate - Graphics Form', 'graphics form gate is first');
ok(formsAfter.nodes.length === forms.nodes.length + 8, 'forms transform adds an explicit gate/router/accepted/rejected quartet per webhook');
ok(formsAfter.nodes.find(n => n.name === 'Authority Gate - Video Form').parameters.jsCode.includes("reason = allowed ? 'linear_authoritative'"), 'form guard classifies allowed, SyncView-blocked, and unavailable stances');
ok(formsAfter.nodes.find(n => n.name === 'Authority Gate - Video Form').parameters.jsCode.includes("authorityState.source === 'live'"), 'form guard freezes when the live flag cannot be read');
ok(formsAfter.nodes.find(n => n.name === 'Webhook').parameters.responseMode === 'responseNode'
  && formsAfter.nodes.find(n => n.name === 'Webhook2').parameters.responseMode === 'responseNode', 'forms no longer acknowledge before the authority decision');
for (const [label, first] of [['Video Form', 'Fetch Filming Plans'], ['Graphics Form', 'Fetch Filming Plans1']]) {
  const accepted = `Authority Accepted - ${label}`;
  const rejected = `Authority Rejected - ${label}`;
  const route = `Authority Route - ${label}`;
  ok(formsAfter.nodes.find(n => n.name === accepted).parameters.options.responseCode === 200
    && formsAfter.connections[accepted].main[0][0].node === first, `${label} preserves the accepted 200 and existing graph`);
  ok(formsAfter.nodes.find(n => n.name === rejected).parameters.options.responseCode.includes('http_status'), `${label} returns explicit 409/503 when blocked`);
  ok(formsAfter.connections[route].main[1][0].node === rejected, `${label} blocked branch terminates at its rejection response`);
  ok(!formsAfter.nodes.find(n => n.name === rejected).parameters.responseBody.includes('={{ $json }}'), `${label} blocked response never echoes the submitted payload`);
}
let formCompiles = true;
try { new AsyncFunction(formsAfter.nodes.find(n => n.name === 'Authority Gate - Video Form').parameters.jsCode); } catch (_) { formCompiles = false; }
ok(formCompiles, 'transformed form authority code compiles');
ok(transformForms(formsAfter).nodes.length === formsAfter.nodes.length, 'form transform is idempotent');
ok(verifyTransformed(forms, formsAfter) === formsAfter, 'form transform verifies');

const handler = `const issue = {};
const teamKey = String((issue.team && issue.team.key) || '').toUpperCase();
let samples = [];
await upsert(samples);`;
const inbound = {
  id: IDS.inbound,
  active: false,
  nodes: [code('Handle Linear Event', handler), code('Plan Workload Row', 'return workload;'), code('Handle Sample Linear Event', handler)],
  connections: {},
};
const inboundAfter = transformInbound(inbound);
ok(inboundAfter.active === false, 'MJb remains inactive');
ok(inboundAfter.nodes.find(n => n.name === 'Plan Workload Row').parameters.jsCode === 'return workload;', 'MJb workload branch is byte-identical');
for (const name of ['Handle Linear Event', 'Handle Sample Linear Event']) {
  const source = inboundAfter.nodes.find(n => n.name === name).parameters.jsCode;
  ok(source.includes("skipped: 'syncview_authoritative'"), `${name} is authority-gated`);
  ok(source.includes("authorityState.source !== 'live'"), `${name} freezes when only last-known-good is available`);
  ok(source.indexOf("syncview_authoritative") < source.indexOf('await upsert'), `${name} gate precedes authoritative upsert`);
  let compiles = true;
  try { new AsyncFunction(source); } catch (_) { compiles = false; }
  ok(compiles, `${name} transformed code compiles`);
}
ok(verifyTransformed(inbound, inboundAfter) === inboundAfter, 'MJb transform verifies without activation');
ok(transformInbound(inboundAfter).nodes.find(n => n.name === 'Handle Linear Event').parameters.jsCode === inboundAfter.nodes.find(n => n.name === 'Handle Linear Event').parameters.jsCode, 'MJb transform is idempotent');
const inboundGuardStripped = JSON.parse(JSON.stringify(inboundAfter));
inboundGuardStripped.nodes.find(n => n.name === 'Handle Sample Linear Event').parameters.jsCode = handler;
let inboundReadbackRejected = false;
try { verifyTransformed(inboundAfter, inboundGuardStripped); } catch (_) { inboundReadbackRejected = true; }
ok(inboundReadbackRejected, 'readback verification rejects a stripped MJb handler guard');

const transformSource = require('fs').readFileSync(require('path').join(__dirname, '..', 'scripts', 'write-ui-n8n-authority-gates.js'), 'utf8');
ok(transformSource.includes('if (row.installed) continue;'), 'repeat apply skips already-installed workflows instead of publishing no-op versions');
ok(transformSource.includes('if (fs.existsSync(file))') && transformSource.includes('preserved: true'),
  'repeat apply preserves the first private pre-edit snapshot instead of overwriting it');

if (failures) process.exit(1);
console.log('\nWrite-UI n8n authority-gate transform checks passed');
