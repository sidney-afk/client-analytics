'use strict';

/*
 * Daily fail-closed TEST drill for the real production-write gateway.
 * Production flags are read before/after and never changed. Every mutable
 * request carries the service-only TEST override and is constrained to the
 * configured active TEST client/project ids supplied through Actions secrets.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SUPA_URL = String(process.env.SUPABASE_URL || 'https://uzltbbrjidmjwwfakwve.supabase.co').replace(/\/+$/, '');
const WRITE_URL = String(process.env.PRODUCTION_WRITE_URL || `${SUPA_URL}/functions/v1/production-write`);
const SUPA_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
const LINEAR_KEY = String(process.env.LINEAR_API_KEY || '');
let TEST_CLIENT = '';
const CONFIRMED = process.env.B4_CONFIRM_TEST_MUTATIONS === '1';
const REPORT_PATH = String(process.env.PRODUCTION_WRITE_DRILL_REPORT || '');
const PRIVATE_LOG_PATH = String(process.env.PRODUCTION_WRITE_DRILL_PRIVATE_LOG || '');
const RUN_ID = `write-ui-drill-${Date.now()}`;
const STARTED_AT = new Date().toISOString();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value == null ? '' : value).trim();

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
const stableJson = value => JSON.stringify(stable(value));
function parseJson(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_) { return {}; }
}

function writePrivateFailure(error, stage, outputPath = PRIVATE_LOG_PATH) {
  if (!error || !outputPath) return false;
  const resolved = path.resolve(outputPath);
  const root = path.resolve(__dirname, '..');
  const relative = path.relative(root, resolved);
  if (!relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('PRODUCTION_WRITE_DRILL_PRIVATE_LOG must resolve outside the public repository');
  }
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify({
    stage: clean(stage) || 'drill_failed',
    message: clean(error && error.message),
    stack: String(error && error.stack || error && error.message || error),
  }, null, 2));
  return true;
}

async function jsonResponse(response, label) {
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (_) {}
  if (!response.ok || !body || body.ok !== true) fail(`${label} HTTP ${response.status}: ${text.slice(0, 300)}`);
  return body;
}

async function gateway(body) {
  const response = await fetch(WRITE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      request_id: body.request_id || `${RUN_ID}:${body.operation}:${Date.now()}`,
      test_override: true,
      confirm: 'B4_TEST_ONLY',
      ...(body.skip_graphic_generation === true ? { skip_graphic_generation: true } : {}),
    }),
  });
  return jsonResponse(response, `production-write ${body.operation}`);
}

async function rest(route) {
  const response = await fetch(`${SUPA_URL}/rest/v1/${route}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Accept: 'application/json' },
  });
  if (!response.ok) fail(`Supabase REST ${route} HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  return response.json();
}

async function edge(name, body) {
  const response = await fetch(`${SUPA_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return jsonResponse(response, name);
}

async function linear(query, variables = {}) {
  const response = await fetch('https://api.linear.app/graphql', {
    method: 'POST',
    headers: { Authorization: LINEAR_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.errors) fail(`Linear read failed: HTTP ${response.status}`);
  return body.data;
}

async function poll(label, fn, timeoutMs = 60000, intervalMs = 750) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  fail(`${label} timed out`);
}

async function flags() {
  const rows = await rest('syncview_runtime_flags?select=key,value,updated_at&key=in.(prod_authority,linear_outbound_enabled,linear_inbound_enabled,auth_enforcement)&order=key.asc');
  assert(rows.length === 4, `expected four protected runtime flags, found ${rows.length}`);
  return Object.fromEntries(rows.map(row => [row.key, {
    value: row.value,
    updated_at: clean(row.updated_at),
  }]));
}

async function preflight() {
  assert(CONFIRMED, 'B4_CONFIRM_TEST_MUTATIONS=1 is required');
  assert(SUPA_KEY && LINEAR_KEY, 'Supabase service role and Linear read credential are required');
  const rows = await rest('clients?select=slug,kind,active&kind=eq.test&active=eq.true&order=slug.asc');
  assert(rows.length === 1, `expected exactly one active TEST client, found ${rows.length}`);
  TEST_CLIENT = clean(rows[0].slug);
  assert(TEST_CLIENT, 'active TEST client has no slug');
  const before = await flags();
  const authority = parseJson(before.prod_authority.value);
  const outbound = parseJson(before.linear_outbound_enabled.value);
  assert(authority.video === 'linear' && authority.graphics === 'linear', 'production authority must remain linear/linear');
  assert(outbound.mode === 'off', 'production outbound must remain off');
  return before;
}

async function mappedAssignee(team) {
  const rows = await rest(`team_members?select=id,team,active,linear_user_id&active=eq.true&team=eq.${team}&linear_user_id=not.is.null&order=id.asc&limit=1`);
  assert(rows.length === 1, `no mapped active ${team} assignee is available for the TEST drill`);
  return rows[0];
}

function rowFrom(response) {
  return response.row || (response.items && (response.items[0].row || response.items[0])) || null;
}

async function createFixture(team) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const response = await gateway({
    operation: 'intake_create',
    surface: 'submission',
    client_slug: TEST_CLIENT,
    batch: { name: `Write UI daily drill ${stamp}` },
    items: [{
      team,
      number: 1,
      title: team === 'video' ? `Write UI ${team} drill ${stamp}` : undefined,
      brief: team === 'video' ? 'Disposable TEST write-path drill.' : undefined,
    }],
    skip_graphic_generation: team === 'graphics',
  });
  const row = rowFrom(response);
  assert(response.batch && response.batch.id && row && row.id, `${team} native create response is incomplete`);
  return { team, batch: response.batch, row, operations: ['create'] };
}

async function mutateFixture(asset) {
  let row = asset.row;
  const request = async (operation, fields) => {
    const response = await gateway({
      operation,
      surface: 'production',
      entity: 'deliverable',
      id: row.id,
      expected_updated_at: row.updated_at || undefined,
      ...fields,
    });
    row = response.row || row;
    asset.operations.push(operation);
    return response;
  };
  for (const status of ['smm_approval', 'tweak', 'in_progress']) {
    await request('status', { expected_status: row.status, status });
  }
  asset.commentMarker = `${RUN_ID}:${asset.team}:comment`;
  await request('comment', { comment: { body: asset.commentMarker, audience: 'internal' } });
  const due = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  await request('due', { due_date: due });
  await request('due', { due_date: null });
  const member = await mappedAssignee(asset.team);
  await request('assignee', { assignee_id: member.id });
  await request('assignee', { assignee_id: null });
  asset.row = row;
}

async function linkedRow(asset) {
  return poll(`${asset.team} Linear linkage`, async () => {
    const rows = await rest(`deliverables?select=id,status,brief,due_date,assignee_id,linear_issue_uuid,linear_identifier,updated_at&id=eq.${encodeURIComponent(asset.row.id)}&limit=1`);
    const row = rows[0];
    return row && row.linear_issue_uuid ? row : null;
  });
}

async function verifyFixture(asset) {
  const row = await linkedRow(asset);
  const data = await linear(`query ProductionWriteDrillIssue($id: String!) {
    issue(id: $id) {
      id identifier description dueDate archivedAt
      state { name }
      assignee { id }
      comments(first: 50) { nodes { id body } }
    }
  }`, { id: row.linear_issue_uuid });
  const issue = data.issue;
  assert(issue && issue.id === row.linear_issue_uuid, `${asset.team} mirrored issue is missing`);
  if (asset.team === 'graphics') {
    assert(row.brief === 'Video 1' && issue.description === 'Video 1', 'graphics fallback description did not round-trip');
  }
  assert(!issue.dueDate && !issue.assignee, `${asset.team} due/assignee clear did not reach Linear`);
  assert((issue.comments.nodes || []).filter(comment => clean(comment.body).includes(asset.commentMarker)).length === 1, `${asset.team} Linear comment is missing or duplicated`);
  const nativeComments = await rest(`production_comments?select=id&deliverable_id=eq.${encodeURIComponent(row.id)}&body=eq.${encodeURIComponent(asset.commentMarker)}`);
  assert(nativeComments.length === 1, `${asset.team} native comment is missing or duplicated`);
  const foreign = await rest(`deliverable_events?select=id&deliverable_id=eq.${encodeURIComponent(row.id)}&action=eq.foreign_write_detected&ts=gte.${encodeURIComponent(STARTED_AT)}`);
  asset.echoUnexpected = foreign.length;
  assert(asset.echoUnexpected === 0, `${asset.team} produced a foreign-write/echo storm event`);
  asset.linear = { id: issue.id, identifier: issue.identifier };
}

async function reconcile() {
  const result = spawnSync(process.execPath, [
    'scripts/linear-deliverables-reconcile.js',
    `--client=${TEST_CLIENT}`,
    `--test-authority-client=${TEST_CLIENT}`,
  ], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, APPLY: 'false', CAP: '15', B4_CONFIRM_TEST_MUTATIONS: '1' },
    encoding: 'utf8',
    timeout: 10 * 60 * 1000,
  });
  if (result.status !== 0) fail(`TEST reconciler failed: ${(result.stderr || result.stdout).slice(-800)}`);
  const rows = await rest('deliverable_events?select=id,payload,ts&action=eq.linear_deliverables_reconcile_v2&order=id.desc&limit=10');
  const event = rows.map(row => ({ ...row, payload: parseJson(row.payload) })).find(row => row.payload.test_authority_client === TEST_CLIENT);
  assert(event, 'TEST reconciler summary event is missing');
  const summary = parseJson(event.payload.summary);
  assert(Number(summary.diff_count || 0) === 0 && Number(summary.repair_list_size || 0) === 0 && Number(summary.linkage_actionable || 0) === 0, 'TEST reconciler did not settle at 0/0/0');
  return { diff_count: Number(summary.diff_count || 0), repair_count: Number(summary.repair_list_size || 0), linkage_actionable: Number(summary.linkage_actionable || 0), event_id: event.id };
}

async function cleanupAsset(asset) {
  const row = (await rest(`deliverables?select=*&id=eq.${encodeURIComponent(asset.row.id)}&limit=1`))[0];
  if (row) {
    await edge('deliverable-write', {
      id: row.id,
      patch: {},
      operation: 'archive',
      dedup_key: `${RUN_ID}:${asset.team}:cleanup:deliverable`,
      source_edited_at: new Date().toISOString(),
      actor: 'Production write drill',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
  }
  const batch = (await rest(`batches?select=*&id=eq.${encodeURIComponent(asset.batch.id)}&limit=1`))[0];
  if (batch) {
    await edge('batch-write', {
      id: batch.id,
      patch: { status: 'archived' },
      operation: 'archive',
      dedup_key: `${RUN_ID}:${asset.team}:cleanup:batch`,
      source_edited_at: new Date().toISOString(),
      actor: 'Production write drill',
      test_override: true,
      confirm: 'B4_TEST_ONLY',
    });
  }
  await edge('linear-outbound', {
    limit: 20,
    test_override: { client_slug: TEST_CLIENT, mode: 'live', authority: 'syncview' },
    confirm: 'B4_TEST_ONLY',
  });
  if (asset.linear && asset.linear.id) {
    await poll(`${asset.team} cleanup archive`, async () => {
      const data = await linear('query ProductionWriteDrillCleanup($id: String!) { issue(id: $id) { archivedAt } }', { id: asset.linear.id });
      return data.issue && data.issue.archivedAt;
    });
  }
}

async function telemetry(payload) {
  const response = await fetch(`${SUPA_URL}/rest/v1/deliverable_events`, {
    method: 'POST',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify([{ client_slug: '_system', action: 'production_write_drill', source: 'system', payload }]),
  });
  if (!response.ok) fail(`write-drill telemetry HTTP ${response.status}`);
}

async function main() {
  const assets = [];
  let flagsBefore = null;
  let reconciliation = null;
  let failure = null;
  let failureStage = null;
  let cleanupOk = false;
  let stage = 'preflight';
  try {
    flagsBefore = await preflight();
    for (const team of ['video', 'graphics']) {
      stage = `${team}_create`;
      const asset = await createFixture(team);
      assets.push(asset);
      stage = `${team}_mutations`;
      await mutateFixture(asset);
      stage = `${team}_verification`;
      await verifyFixture(asset);
    }
    stage = 'reconciliation';
    reconciliation = await reconcile();
  } catch (error) {
    failure = error;
    failureStage = stage;
  }
  try {
    stage = 'cleanup';
    for (const asset of assets) await cleanupAsset(asset);
    cleanupOk = assets.length > 0;
  } catch (error) {
    failure = failure || error;
    failureStage = failureStage || stage;
  }
  let flagsAfter = null;
  try {
    stage = 'flag_readback';
    flagsAfter = await flags();
  } catch (error) {
    failure = failure || error;
    failureStage = failureStage || stage;
  }
  const flagsUnchanged = Boolean(flagsBefore && flagsAfter && stableJson(flagsBefore) === stableJson(flagsAfter));
  if (!flagsUnchanged) {
    failure = failure || new Error('runtime flags changed during TEST drill');
    failureStage = failureStage || 'flag_invariant';
  }
  if (failure && PRIVATE_LOG_PATH) writePrivateFailure(failure, failureStage);
  const payload = {
    run_id: RUN_ID,
    generated_at: new Date().toISOString(),
    ok: !failure && cleanupOk,
    team: 'both',
    operations_completed: assets.reduce((sum, asset) => sum + asset.operations.length, 0),
    teams_completed: assets.filter(asset => asset.linear).length,
    echo_unexpected: assets.reduce((sum, asset) => sum + Number(asset.echoUnexpected || 0), 0),
    reconcile_diff_count: reconciliation ? reconciliation.diff_count : -1,
    reconcile_repair_count: reconciliation ? reconciliation.repair_count : -1,
    reconcile_linkage_actionable: reconciliation ? reconciliation.linkage_actionable : -1,
    flags_unchanged: flagsUnchanged,
    cleanup_ok: cleanupOk,
    error_code: failure ? failureStage || 'drill_failed' : null,
  };
  if (REPORT_PATH) {
    const output = path.resolve(REPORT_PATH);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(payload, null, 2));
  }
  await telemetry(payload);
  console.log(JSON.stringify(payload, null, 2));
  if (failure) throw new Error(`production write drill failed (${payload.error_code})`);
  return payload;
}

module.exports = { stable, stableJson, writePrivateFailure };

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
