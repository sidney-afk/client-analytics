'use strict';

/*
 * Reviewable, idempotent transforms for the four legacy Linear mutation
 * webhooks and MJb's card/sample inbound writers. Dry-run is the default.
 *
 * Live apply requires a private backup directory outside this public repo.
 * Every workflow is fetched, exact-version/hash checked, and snapshotted before
 * the first PUT. The transform never activates/deactivates a workflow; notably,
 * MJb's current inactive state is a hard precondition and must remain inactive.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const N8N_BASE_URL = String(process.env.N8N_BASE_URL || 'https://synchrosocial.app.n8n.cloud').replace(/\/+$/, '');
const N8N_KEY = String(process.env.N8N_API_KEY || '');
const APPLY = process.argv.includes('--apply');
const PRIVATE_BACKUP_DIR = String(process.env.N8N_PRIVATE_BACKUP_DIR || '');

const IDS = Object.freeze({
  status: 'VQqqeY9B2GZbh2Bt',
  comment: '8stSpZUiyG7f2LQX',
  forms: 'BrJSe8zCKUccfmIq',
  inbound: 'MJbMZ789B5ExZz9x',
});

const LIVE_PRECONDITIONS = Object.freeze({
  [IDS.status]: {
    name: 'SyncView Calendar - Linear Set Status',
    versionId: '0976710e-e56b-4707-b736-f1264f058b57',
    active: true,
    nodeHashes: {
      'Apply Status to Linear': '8d4d9c201d071e97f5cb79839789d91a4a6f4c29d1c6bfda4f75fc34ba7ab7ee',
    },
  },
  [IDS.comment]: {
    name: 'SyncView Calendar - Linear Add Comment',
    versionId: '6798ea93-5819-46aa-b618-bde8bb451571',
    active: true,
    nodeHashes: {
      'Post Comment To Linear': '534b05750713de240047317f7613e0a92f65c80560f5c1c1ca1cc7fdd14229b5',
    },
  },
  [IDS.forms]: {
    name: 'VIDEO PRODUCTION AUTOMATION',
    versionId: '0efdd2c7-a71e-43a7-8280-adc18934b526',
    active: true,
    nodeHashes: {
      'Lookup SMM Key': '940923de25fa89e7d1afb32370d6cffef8ef4622ea3f7743c059238b84d7476f',
      'Lookup SMM Key1': 'a9b1ab985f0f0bbad54fcb25a05b05707ee410ccb19f69a6aa7f7e01715c4348',
    },
  },
  [IDS.inbound]: {
    name: 'SyncView Calendar - Linear Status Sync',
    versionId: '655b6aa5-e571-451e-8f65-f4fcf78aff02',
    active: false,
    nodeHashes: {
      'Handle Linear Event': '4f33e9c35a1fbf430491a268b4e6920dedbc2b0273a49996a8efc58ea9fc2cbf',
      'Plan Workload Row': '1f555e6af4057362d114c4aec6d0b8cd9295b3ef38155b0ac795c25194b722f1',
      'Handle Sample Linear Event': '6bb2df802bd950a295706cd6f94c05a79124b5fea508e93ebd21220e69eb8a6a',
    },
  },
});

const AUTHORITY_HELPER = `
const PROD_AUTHORITY_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags?select=value&key=eq.prod_authority&limit=1';
const PROD_AUTHORITY_KEY = 'sb_publishable_P4-NdUWJqjtACWZOB6LPEA_8GANHAUA';
const _prodNormalizeAuthority = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('prod_authority malformed');
  const side = (v) => {
    const s = String(v || '').trim().toLowerCase();
    if (s === 'linear') return 'linear';
    if (s === 'syncview' || s === 'supabase') return 'syncview';
    throw new Error('prod_authority side malformed');
  };
  return { video: side(value.video), graphics: side(value.graphics) };
};
const _prodTeamKey = (value) => String(value || '').trim().toUpperCase() === 'GRA' ? 'graphics' : (String(value || '').trim().toUpperCase() === 'VID' ? 'video' : '');
const _prodLoadAuthority = async () => {
  const staticData = $getWorkflowStaticData('global');
  try {
    const rows = await this.helpers.httpRequest({ method: 'GET', url: PROD_AUTHORITY_URL, headers: { apikey: PROD_AUTHORITY_KEY, Authorization: 'Bearer ' + PROD_AUTHORITY_KEY, Accept: 'application/json' }, json: true, timeout: 15000 });
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('prod_authority row count');
    const value = _prodNormalizeAuthority(rows[0] && rows[0].value);
    staticData.prodAuthorityLastKnownGood = value;
    return { value, source: 'live' };
  } catch (error) {
    try {
      return { value: _prodNormalizeAuthority(staticData.prodAuthorityLastKnownGood), source: 'last-known-good', warning: String(error && error.message || error) };
    } catch (_) {
      console.error('prod_authority unavailable; legacy mutation frozen');
      return { value: null, source: 'cold-fail-closed', warning: String(error && error.message || error) };
    }
  }
};
`;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function node(workflow, name) { return workflow.nodes.find(item => item.name === name); }
function edge(name) { return { node: name, type: 'main', index: 0 }; }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function nodeCode(workflow, name) { return String((node(workflow, name) || {}).parameters?.jsCode || ''); }

function assertWorkflowPrecondition(workflow, spec) {
  if (!workflow || !spec) throw new Error('workflow and precondition are required');
  if (workflow.name !== spec.name) throw new Error(`workflow ${workflow.id || '?'} name drifted`);
  if (workflow.versionId !== spec.versionId) throw new Error(`workflow ${workflow.id || '?'} version drifted: ${workflow.versionId}`);
  if (Boolean(workflow.active) !== Boolean(spec.active)) throw new Error(`workflow ${workflow.id || '?'} active state drifted`);
  for (const [name, expected] of Object.entries(spec.nodeHashes || {})) {
    const item = node(workflow, name);
    if (!item) throw new Error(`workflow ${workflow.id || '?'} node missing: ${name}`);
    const actual = sha(item.parameters && item.parameters.jsCode || '');
    if (actual !== expected) throw new Error(`workflow ${workflow.id || '?'} node hash drifted: ${name}`);
  }
  return workflow;
}

function prependHelper(code) {
  return code.includes('const _prodLoadAuthority = async') ? code : `${AUTHORITY_HELPER}\n${code}`;
}

function transformStatus(input) {
  const workflow = clone(input);
  const apply = node(workflow, 'Apply Status to Linear');
  const respond = node(workflow, 'Respond JSON');
  if (!apply || !respond) throw new Error('status workflow shape drifted');
  let code = prependHelper(String(apply.parameters.jsCode || ''));
  if (!code.includes("team { key states")) {
    if (!code.includes('team { states')) throw new Error('status team-query anchor drifted');
    code = code.replace('team { states', 'team { key states');
  }
  if (!code.includes("reason: 'syncview_authoritative'")) {
    const anchor = 'const states = (issue.team && issue.team.states && issue.team.states.nodes) || [];';
    if (!code.includes(anchor)) throw new Error('status authority insertion anchor drifted');
    const guard = `const authorityState = await _prodLoadAuthority();
const authorityTeam = _prodTeamKey(issue.team && issue.team.key);
if (!authorityState.value || authorityState.source !== 'live' || !authorityTeam) return [{ json: { ok: false, blocked: true, reason: 'authority_unavailable', http_status: 503 } }];
if (authorityState.value[authorityTeam] !== 'linear') return [{ json: { ok: false, blocked: true, reason: 'syncview_authoritative', team: authorityTeam, http_status: 409 } }];
`;
    code = code.replace(anchor, guard + anchor);
  }
  apply.parameters.jsCode = code;
  respond.parameters.options = respond.parameters.options || {};
  respond.parameters.options.responseCode = '={{ $json.http_status || 200 }}';
  return workflow;
}

function transformComment(input) {
  const workflow = clone(input);
  const apply = node(workflow, 'Post Comment To Linear');
  const respond = node(workflow, 'Respond JSON');
  if (!apply || !respond) throw new Error('comment workflow shape drifted');
  let code = prependHelper(String(apply.parameters.jsCode || ''));
  if (!code.includes('team { key }')) {
    const query = "{ issue(id: \"' + ident + '\") { id identifier } }";
    if (!code.includes(query)) throw new Error('comment team-query anchor drifted');
    code = code.replace(query, "{ issue(id: \"' + ident + '\") { id identifier team { key } } }");
  }
  if (!code.includes("reason: 'syncview_authoritative'")) {
    const anchor = 'const safeAuthor = author.replace';
    if (!code.includes(anchor)) throw new Error('comment authority insertion anchor drifted');
    const guard = `const authorityState = await _prodLoadAuthority();
const authorityTeam = _prodTeamKey(issue.team && issue.team.key);
if (!authorityState.value || authorityState.source !== 'live' || !authorityTeam) return [{ json: { ok: false, blocked: true, reason: 'authority_unavailable', http_status: 503 } }];
if (authorityState.value[authorityTeam] !== 'linear') return [{ json: { ok: false, blocked: true, reason: 'syncview_authoritative', team: authorityTeam, http_status: 409 } }];
`;
    code = code.replace(anchor, guard + anchor);
  }
  apply.parameters.jsCode = code;
  respond.parameters.options = respond.parameters.options || {};
  respond.parameters.options.responseCode = '={{ $json.http_status || 200 }}';
  return workflow;
}

function formGateCode(team) {
  return `${AUTHORITY_HELPER}
const items = $input.all();
const authorityState = await _prodLoadAuthority();
const live = Boolean(authorityState.value && authorityState.source === 'live');
const allowed = Boolean(live && authorityState.value.${team} === 'linear');
const reason = allowed ? 'linear_authoritative' : (live ? 'syncview_authoritative' : 'authority_unavailable');
const httpStatus = allowed ? 200 : (live ? 409 : 503);
return items.map(item => ({ ...item, json: { ...(item.json || {}), _writeUiAuthority: { allowed, reason, http_status: httpStatus, team: '${team}' } } }));`;
}

function formNodeNames(gateName) {
  const label = gateName.replace(/^Authority Gate - /, '');
  return {
    gate: gateName,
    route: `Authority Route - ${label}`,
    accepted: `Authority Accepted - ${label}`,
    rejected: `Authority Rejected - ${label}`,
  };
}

function formResponseHeaders() {
  return {
    entries: [
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Cache-Control', value: 'no-store' },
    ],
  };
}

function installGate(workflow, webhookName, gateName, expectedFirst, team, position) {
  const names = formNodeNames(gateName);
  const installed = Object.values(names).filter(name => node(workflow, name));
  if (installed.length) {
    if (installed.length !== Object.keys(names).length) throw new Error(`${webhookName} has a partial authority response gate`);
    return;
  }
  const current = workflow.connections[webhookName]?.main?.[0] || [];
  if (current.length !== 1 || current[0].node !== expectedFirst) throw new Error(`${webhookName} first edge drifted`);
  const webhook = node(workflow, webhookName);
  if (!webhook) throw new Error(`${webhookName} node missing`);
  webhook.parameters = webhook.parameters || {};
  webhook.parameters.responseMode = 'responseNode';
  workflow.nodes.push({
    parameters: { mode: 'runOnceForAllItems', jsCode: formGateCode(team) },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    id: crypto.randomUUID(),
    name: names.gate,
  }, {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 3 },
        conditions: [{
          id: crypto.randomUUID(),
          leftValue: '={{ $json._writeUiAuthority.allowed ? "true" : "false" }}',
          rightValue: 'true',
          operator: { type: 'string', operation: 'equals', name: 'filter.operator.equals' },
        }],
        combinator: 'and',
      },
      looseTypeValidation: true,
      options: {},
    },
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position: [position[0] + 180, position[1]],
    id: crypto.randomUUID(),
    name: names.route,
  }, {
    parameters: {
      respondWith: 'json',
      responseBody: '{"message":"Workflow was started"}',
      options: { responseCode: 200, responseHeaders: formResponseHeaders() },
    },
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.5,
    position: [position[0] + 360, position[1] - 80],
    id: crypto.randomUUID(),
    name: names.accepted,
  }, {
    parameters: {
      respondWith: 'json',
      responseBody: '={{ { ok: false, blocked: true, reason: $json._writeUiAuthority.reason } }}',
      options: { responseCode: '={{ $json._writeUiAuthority.http_status || 503 }}', responseHeaders: formResponseHeaders() },
    },
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.5,
    position: [position[0] + 360, position[1] + 80],
    id: crypto.randomUUID(),
    name: names.rejected,
  });
  workflow.connections[webhookName] = { main: [[edge(names.gate)]] };
  workflow.connections[names.gate] = { main: [[edge(names.route)]] };
  workflow.connections[names.route] = { main: [[edge(names.accepted)], [edge(names.rejected)]] };
  workflow.connections[names.accepted] = { main: [[edge(expectedFirst)]] };
}

function transformForms(input) {
  const workflow = clone(input);
  installGate(workflow, 'Webhook', 'Authority Gate - Video Form', 'Fetch Filming Plans', 'video', [-1240, -640]);
  installGate(workflow, 'Webhook2', 'Authority Gate - Graphics Form', 'Fetch Filming Plans1', 'graphics', [-1240, 80]);
  return workflow;
}

function gateInboundHandler(code) {
  code = prependHelper(String(code || ''));
  if (code.includes("skipped: 'syncview_authoritative'")) return code;
  const anchor = "const teamKey = String((issue.team && issue.team.key) || '').toUpperCase();";
  if (!code.includes(anchor)) throw new Error('MJb team authority anchor drifted');
  const guard = `${anchor}
  const authorityState = await _prodLoadAuthority();
  const authorityTeam = _prodTeamKey(teamKey);
  if (!authorityState.value || authorityState.source !== 'live' || !authorityTeam) return [{ json: { ok: false, updated: 0, skipped: 'authority_unavailable' } }];
  if (authorityState.value[authorityTeam] !== 'linear') return [{ json: { ok: true, updated: 0, skipped: 'syncview_authoritative', teamKey: teamKey } }];`;
  return code.replace(anchor, guard);
}

function transformInbound(input) {
  const workflow = clone(input);
  if (workflow.active !== false) throw new Error('MJb must remain inactive during this transform');
  const workloadBefore = nodeCode(workflow, 'Plan Workload Row');
  if (!workloadBefore) throw new Error('MJb workload node missing');
  for (const name of ['Handle Linear Event', 'Handle Sample Linear Event']) {
    const item = node(workflow, name);
    if (!item) throw new Error(`MJb node missing: ${name}`);
    item.parameters.jsCode = gateInboundHandler(item.parameters.jsCode);
  }
  if (nodeCode(workflow, 'Plan Workload Row') !== workloadBefore) {
    throw new Error('MJb workload node changed; transform must not touch it');
  }
  return workflow;
}

function transformWorkflow(workflow) {
  switch (workflow.id) {
    case IDS.status: return transformStatus(workflow);
    case IDS.comment: return transformComment(workflow);
    case IDS.forms: return transformForms(workflow);
    case IDS.inbound: return transformInbound(workflow);
    default: throw new Error(`unsupported workflow: ${workflow.id}`);
  }
}

function isInstalled(workflow) {
  if (workflow.id === IDS.status) return nodeCode(workflow, 'Apply Status to Linear').includes("reason: 'syncview_authoritative'");
  if (workflow.id === IDS.comment) return nodeCode(workflow, 'Post Comment To Linear').includes("reason: 'syncview_authoritative'");
  if (workflow.id === IDS.forms) {
    return [
      ...Object.values(formNodeNames('Authority Gate - Video Form')),
      ...Object.values(formNodeNames('Authority Gate - Graphics Form')),
    ].every(name => node(workflow, name))
      && node(workflow, 'Webhook')?.parameters?.responseMode === 'responseNode'
      && node(workflow, 'Webhook2')?.parameters?.responseMode === 'responseNode';
  }
  if (workflow.id === IDS.inbound) return ['Handle Linear Event', 'Handle Sample Linear Event']
    .every(name => nodeCode(workflow, name).includes("skipped: 'syncview_authoritative'"));
  return false;
}

function verifyTransformed(before, after) {
  if (Boolean(after.active) !== Boolean(before.active)) throw new Error(`${before.id} active state changed`);
  if (before.id === IDS.status || before.id === IDS.comment) {
    const codeName = before.id === IDS.status ? 'Apply Status to Linear' : 'Post Comment To Linear';
    const code = nodeCode(after, codeName);
    const mutationToken = before.id === IDS.status ? 'issueUpdate' : 'commentCreate';
    if (!code.includes("reason: 'syncview_authoritative'")
        || !code.includes("authorityState.source !== 'live'")
        || !code.includes('cold-fail-closed')
        || code.indexOf("reason: 'syncview_authoritative'") > code.indexOf(mutationToken)) {
      throw new Error(`${before.id} authority guard missing or ordered after mutation`);
    }
    if (node(after, 'Respond JSON').parameters.options.responseCode !== '={{ $json.http_status || 200 }}') throw new Error(`${before.id} response status gate missing`);
  }
  if (before.id === IDS.forms) {
    if (after.connections.Webhook.main[0][0].node !== 'Authority Gate - Video Form') throw new Error('video form gate not first');
    if (after.connections.Webhook2.main[0][0].node !== 'Authority Gate - Graphics Form') throw new Error('graphics form gate not first');
    for (const [webhookName, gateName, team, expectedFirst] of [
      ['Webhook', 'Authority Gate - Video Form', 'video', 'Fetch Filming Plans'],
      ['Webhook2', 'Authority Gate - Graphics Form', 'graphics', 'Fetch Filming Plans1'],
    ]) {
      const names = formNodeNames(gateName);
      if (node(after, webhookName)?.parameters?.responseMode !== 'responseNode') throw new Error(`${webhookName} still responds before authority check`);
      if (nodeCode(after, names.gate) !== formGateCode(team)) throw new Error(`${team} form gate code drifted`);
      if (after.connections[names.gate]?.main?.[0]?.[0]?.node !== names.route) throw new Error(`${team} form authority route missing`);
      if (after.connections[names.route]?.main?.[0]?.[0]?.node !== names.accepted) throw new Error(`${team} form accepted response missing`);
      if (after.connections[names.route]?.main?.[1]?.[0]?.node !== names.rejected) throw new Error(`${team} form rejected response missing`);
      if (after.connections[names.accepted]?.main?.[0]?.[0]?.node !== expectedFirst) throw new Error(`${team} form accepted graph changed`);
      if (node(after, names.accepted)?.parameters?.options?.responseCode !== 200) throw new Error(`${team} form accepted response changed`);
      if (node(after, names.rejected)?.parameters?.options?.responseCode !== '={{ $json._writeUiAuthority.http_status || 503 }}') throw new Error(`${team} form blocked status missing`);
    }
  }
  if (before.id === IDS.inbound) {
    if (after.active !== false) throw new Error('MJb was activated');
    if (nodeCode(after, 'Plan Workload Row') !== nodeCode(before, 'Plan Workload Row')) throw new Error('MJb workload branch changed');
    for (const name of ['Handle Linear Event', 'Handle Sample Linear Event']) {
      const code = nodeCode(after, name);
      if (!code.includes("skipped: 'syncview_authoritative'")
          || !code.includes("authorityState.source !== 'live'")
          || !code.includes('cold-fail-closed')) {
        throw new Error(`MJb authority guard missing: ${name}`);
      }
    }
  }
  return after;
}

async function n8n(method, route, body) {
  const response = await fetch(`${N8N_BASE_URL}/api/v1${route}`, {
    method,
    headers: {
      'X-N8N-API-KEY': N8N_KEY,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n ${method} ${route} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

function privateBackupDir() {
  if (!PRIVATE_BACKUP_DIR) throw new Error('N8N_PRIVATE_BACKUP_DIR outside the repository is required for --apply');
  const resolved = path.resolve(PRIVATE_BACKUP_DIR);
  const relative = path.relative(ROOT, resolved);
  if (!relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('private n8n backup directory must be outside the public repository');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writePrivateBackup(dir, workflow, suffix) {
  const text = JSON.stringify(workflow, null, 2);
  const file = path.join(dir, `${workflow.id}.${suffix}.json`);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    return { file: path.basename(file), sha256: sha(existing), preserved: true };
  }
  fs.writeFileSync(file, text);
  return { file: path.basename(file), sha256: sha(text) };
}

function writableSettings(settings) {
  const result = clone(settings || {});
  // n8n returns this legacy read-only field on large/older workflows, while
  // the public workflow PUT schema rejects it.
  delete result.binaryMode;
  return result;
}

async function main() {
  if (!N8N_KEY) throw new Error('N8N_API_KEY is required');
  const rows = [];
  for (const id of Object.values(IDS)) {
    const before = await n8n('GET', `/workflows/${id}`);
    const installed = isInstalled(before);
    if (!installed) assertWorkflowPrecondition(before, LIVE_PRECONDITIONS[id]);
    const after = installed ? verifyTransformed(before, before) : verifyTransformed(before, transformWorkflow(before));
    rows.push({ before, after, installed });
  }
  if (!APPLY) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      workflows: rows.map(({ before, after, installed }) => ({ id: before.id, active: before.active, installed, before_nodes: before.nodes.length, after_nodes: after.nodes.length })),
    }, null, 2));
    return;
  }

  const dir = privateBackupDir();
  const backups = rows.map(({ before }) => writePrivateBackup(dir, before, 'pre-write-ui-authority-gates'));
  for (const row of rows) {
    if (row.installed) continue;
    await n8n('PUT', `/workflows/${row.before.id}`, {
      name: row.after.name,
      nodes: row.after.nodes,
      connections: row.after.connections,
      settings: writableSettings(row.after.settings),
    });
    const readback = await n8n('GET', `/workflows/${row.before.id}`);
    verifyTransformed(row.before, readback);
    backups.push(writePrivateBackup(dir, readback, 'post-write-ui-authority-gates'));
  }
  console.log(JSON.stringify({ ok: true, dry_run: false, installed: rows.filter(row => !row.installed).length, already_installed: rows.filter(row => row.installed).length, backups }, null, 2));
}

module.exports = {
  AUTHORITY_HELPER,
  IDS,
  LIVE_PRECONDITIONS,
  assertWorkflowPrecondition,
  formGateCode,
  isInstalled,
  sha,
  transformComment,
  transformForms,
  transformInbound,
  transformStatus,
  transformWorkflow,
  verifyTransformed,
  writableSettings,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
