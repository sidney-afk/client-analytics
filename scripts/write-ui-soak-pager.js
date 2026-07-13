'use strict';

/* Adds write-drill and full-roster shadow-audit summary watchers to qll. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW_ID = 'qllIDZPkdNAPRj0b';
const N8N_BASE_URL = String(process.env.N8N_BASE_URL || 'https://synchrosocial.app.n8n.cloud').replace(/\/+$/, '');
const N8N_KEY = String(process.env.N8N_API_KEY || '');
const APPLY = process.argv.includes('--apply');
const PRIVATE_BACKUP_DIR = String(process.env.N8N_PRIVATE_BACKUP_DIR || '');

const LIVE_PRECONDITION = Object.freeze({
  name: 'SyncView Monitoring Pager + Reconciler V2 Trigger',
  versionId: '16a436c6-5b49-4baa-9630-978cee2854a2',
  active: true,
  checkHash: '8c7837545f05e52111f3571352f9cebb5fd27094440880c0cf5c52e90f8dd4f0',
});

const NAMES = Object.freeze({
  v2: 'Fetch V2 Summary',
  outbound: 'Fetch Outbound Summary',
  incremental: 'Fetch Incremental Summary',
  writeDrill: 'Fetch Production Write Drill Summary',
  shadow: 'Fetch Production Shadow Audit Summary',
  check: 'Check Pager Conditions',
});

const WRITE_DRILL_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/deliverable_events?select=id,ts,action,source,payload&action=eq.production_write_drill&order=ts.desc&limit=1';
const SHADOW_URL = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/deliverable_events?select=id,ts,action,source,payload&action=eq.production_shadow_audit&order=ts.desc&limit=1';

const WATCH_BLOCK = `const soakStartedAt = Number(staticData.writeUiSoakMonitoringStartedAt || 0) || Date.now();
staticData.writeUiSoakMonitoringStartedAt = soakStartedAt;
const soakGrace = Date.now() - soakStartedAt < 36 * 60 * 60 * 1000;
const parsePayload = (event) => {
  let payload = event?.payload || {};
  if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_e) { payload = {}; } }
  return payload && typeof payload === 'object' ? payload : {};
};
const writeDrill = first('${NAMES.writeDrill}');
const writeDrillAge = ageMinutes(writeDrill?.ts);
const writeDrillPayload = parsePayload(writeDrill);
if ((!writeDrill || writeDrillAge > 30 * 60) && !soakGrace) out.push(alert('production_write_drill_stale', \
  \`production write drill stale age_min=\${writeDrillAge} latest_event=\${clean(writeDrill?.id || 'none')}\`));
if (writeDrill && writeDrillPayload.ok !== true) out.push(alert('production_write_drill_failed', \
  \`production write drill failed team=\${clean(writeDrillPayload.team || 'both')} latest_event=\${clean(writeDrill.id || 'none')}\`));
if (n(writeDrillPayload.echo_unexpected) > 0 || n(writeDrillPayload.reconcile_diff_count) > 0 || n(writeDrillPayload.reconcile_repair_count) > 0) out.push(alert('production_write_drill_integrity', \
  \`production write drill data-integrity failure team=\${clean(writeDrillPayload.team || 'both')} echo=\${n(writeDrillPayload.echo_unexpected)} diff=\${n(writeDrillPayload.reconcile_diff_count)} repair=\${n(writeDrillPayload.reconcile_repair_count)} latest_event=\${clean(writeDrill?.id || 'none')}\`));

const shadowAudit = first('${NAMES.shadow}');
const shadowAge = ageMinutes(shadowAudit?.ts);
const shadowPayload = parsePayload(shadowAudit);
if ((!shadowAudit || shadowAge > 30 * 60) && !soakGrace) out.push(alert('production_shadow_audit_stale', \
  \`production shadow audit stale age_min=\${shadowAge} latest_event=\${clean(shadowAudit?.id || 'none')}\`));
if (shadowAudit && shadowPayload.ok !== true) out.push(alert('production_shadow_audit_failed', \
  \`production shadow audit failed latest_event=\${clean(shadowAudit.id || 'none')}\`));
if (n(shadowPayload.unexpected_divergences) > 0 || n(shadowPayload.unexpected_intents) > 0 || n(shadowPayload.unexpected_repairs) > 0 || shadowPayload.zero_write_proof === false) out.push(alert('production_shadow_audit_integrity', \
  \`production shadow audit data-integrity failure diff=\${n(shadowPayload.unexpected_divergences)} intents=\${n(shadowPayload.unexpected_intents)} repairs=\${n(shadowPayload.unexpected_repairs)} latest_event=\${clean(shadowAudit?.id || 'none')}\`));
`;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function node(workflow, name) { return workflow.nodes.find(item => item.name === name); }
function edge(name) { return { node: name, type: 'main', index: 0 }; }

function assertLivePrecondition(workflow) {
  if (workflow.id !== WORKFLOW_ID || workflow.name !== LIVE_PRECONDITION.name) throw new Error('pager identity drifted');
  if (workflow.versionId !== LIVE_PRECONDITION.versionId) throw new Error(`pager version drifted: ${workflow.versionId}`);
  if (workflow.active !== true) throw new Error('pager active state drifted');
  const check = node(workflow, NAMES.check);
  if (!check || sha(check.parameters && check.parameters.jsCode || '') !== LIVE_PRECONDITION.checkHash) throw new Error('pager condition node hash drifted');
  return workflow;
}

function verify(workflow, activeBefore = workflow.active) {
  if (workflow.active !== activeBefore) throw new Error('pager active state changed');
  for (const name of [NAMES.writeDrill, NAMES.shadow, NAMES.check]) if (!node(workflow, name)) throw new Error(`pager node missing: ${name}`);
  if (node(workflow, NAMES.writeDrill).parameters.url !== WRITE_DRILL_URL) throw new Error('write drill summary URL drifted');
  if (node(workflow, NAMES.shadow).parameters.url !== SHADOW_URL) throw new Error('shadow audit summary URL drifted');
  if (workflow.connections[NAMES.outbound]?.main?.[0]?.[0]?.node !== NAMES.writeDrill) throw new Error('write drill summary not after outbound summary');
  if (workflow.connections[NAMES.writeDrill]?.main?.[0]?.[0]?.node !== NAMES.shadow) throw new Error('shadow summary not after write drill summary');
  if (workflow.connections[NAMES.shadow]?.main?.[0]?.[0]?.node !== NAMES.incremental) throw new Error('pager watcher chain not restored after soak summaries');
  const checkCode = node(workflow, NAMES.check).parameters.jsCode || '';
  for (const token of ['production_write_drill_stale', 'production_write_drill_integrity', 'production_shadow_audit_stale', 'production_shadow_audit_integrity']) {
    if (!checkCode.includes(token)) throw new Error(`pager watcher missing: ${token}`);
  }
  if (/client_slug|client_name|project_id/.test(WATCH_BLOCK)) throw new Error('soak pager block contains private identity fields');
  return workflow;
}

function transformWorkflow(input) {
  const workflow = clone(input);
  const installed = [NAMES.writeDrill, NAMES.shadow].filter(name => node(workflow, name));
  if (installed.length) {
    if (installed.length !== 2) throw new Error('partial soak watcher installation');
    return verify(workflow, input.active);
  }
  const outbound = node(workflow, NAMES.outbound);
  const incremental = node(workflow, NAMES.incremental);
  const summaryTemplate = node(workflow, NAMES.v2);
  const check = node(workflow, NAMES.check);
  if (!outbound || !incremental || !summaryTemplate || !check) throw new Error('pager watcher-chain anchor missing');
  if (workflow.connections[NAMES.outbound]?.main?.[0]?.[0]?.node !== NAMES.incremental) throw new Error('pager outbound-to-incremental edge drifted');

  const write = clone(summaryTemplate);
  write.id = crypto.randomUUID();
  write.name = NAMES.writeDrill;
  write.position = [430, 35];
  write.parameters.url = WRITE_DRILL_URL;
  workflow.nodes.push(write);

  const shadow = clone(summaryTemplate);
  shadow.id = crypto.randomUUID();
  shadow.name = NAMES.shadow;
  shadow.position = [560, 35];
  shadow.parameters.url = SHADOW_URL;
  workflow.nodes.push(shadow);

  const anchor = `const incremental = first('${NAMES.incremental}');`;
  if (!check.parameters.jsCode.includes(anchor)) throw new Error('pager condition-code insertion anchor drifted');
  check.parameters.jsCode = check.parameters.jsCode.replace(anchor, WATCH_BLOCK + anchor);
  workflow.connections[NAMES.outbound] = { main: [[edge(NAMES.writeDrill)]] };
  workflow.connections[NAMES.writeDrill] = { main: [[edge(NAMES.shadow)]] };
  workflow.connections[NAMES.shadow] = { main: [[edge(NAMES.incremental)]] };
  return verify(workflow, input.active);
}

async function n8n(method, route, body) {
  const response = await fetch(`${N8N_BASE_URL}/api/v1${route}`, {
    method,
    headers: { 'X-N8N-API-KEY': N8N_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`n8n ${method} ${route} failed: HTTP ${response.status} ${text.slice(0, 240)}`);
  return text ? JSON.parse(text) : null;
}

function backupDir() {
  if (!PRIVATE_BACKUP_DIR) throw new Error('N8N_PRIVATE_BACKUP_DIR outside the repository is required for --apply');
  const resolved = path.resolve(PRIVATE_BACKUP_DIR);
  const relative = path.relative(ROOT, resolved);
  if (!relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('private n8n backup directory must be outside the public repository');
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function writeBackup(dir, workflow, suffix) {
  const text = JSON.stringify(workflow, null, 2);
  const file = path.join(dir, `${WORKFLOW_ID}.${suffix}.json`);
  fs.writeFileSync(file, text);
  return { file: path.basename(file), sha256: sha(text) };
}

async function main() {
  if (!N8N_KEY) throw new Error('N8N_API_KEY is required');
  const before = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
  const installed = Boolean(node(before, NAMES.writeDrill) && node(before, NAMES.shadow));
  if (!installed) assertLivePrecondition(before);
  const after = installed ? verify(before, before.active) : transformWorkflow(before);
  if (!APPLY) {
    console.log(JSON.stringify({ ok: true, dry_run: true, workflow_id: WORKFLOW_ID, active: before.active, installed, before_nodes: before.nodes.length, after_nodes: after.nodes.length }, null, 2));
    return;
  }
  const dir = backupDir();
  const backups = [writeBackup(dir, before, 'pre-write-ui-soak-pager')];
  let readback = before;
  if (!installed) {
    await n8n('PUT', `/workflows/${WORKFLOW_ID}`, { name: after.name, nodes: after.nodes, connections: after.connections, settings: after.settings });
    readback = await n8n('GET', `/workflows/${WORKFLOW_ID}`);
    verify(readback, before.active);
    backups.push(writeBackup(dir, readback, 'post-write-ui-soak-pager'));
  }
  console.log(JSON.stringify({ ok: true, dry_run: false, workflow_id: WORKFLOW_ID, active: readback.active, backups }, null, 2));
}

module.exports = {
  LIVE_PRECONDITION,
  NAMES,
  SHADOW_URL,
  WATCH_BLOCK,
  WRITE_DRILL_URL,
  assertLivePrecondition,
  sha,
  transformWorkflow,
  verify,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
