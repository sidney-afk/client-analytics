'use strict';

/*
 * F44 reviewable transform for VIDEO PRODUCTION AUTOMATION
 * (BrJSe8zCKUccfmIq).
 *
 * This module is deliberately side-effect free. It neither reads nor writes
 * n8n. The caller must fetch an exact private workflow snapshot, call
 * transform(), review/validate diffOperations(), apply the atomic operation
 * batch, publish, and then verify the readback.
 */

const crypto = require('crypto');

const WORKFLOW_ID = 'BrJSe8zCKUccfmIq';
const WORKFLOW_NAME = 'VIDEO PRODUCTION AUTOMATION';
const SUPABASE_CREDENTIAL = Object.freeze({
  id: 'XdBpJ6Xk8PMpZXXT',
  name: 'Supabase - SyncView Calendar',
});
const RECEIPT_TABLE = 'linear_intake_receipts';
const DEAD_LETTER_TABLE_ID = 'EncletbVvvYfSDfF';
const DEAD_LETTER_TABLE_NAME = 'linear_intake_receipts';
const MAX_ATTEMPTS = 3;
// This is the same always-reachable human recipient used by the live n8n
// error workflow. It is deliberately independent of the client SMM roster.
const TRIAGE_FALLBACK_SLACK_USER_ID = 'U0ACW93FS30';
const TRIAGE_FALLBACK_SLACK_CREDENTIAL = Object.freeze({
  id: 'qUlAcjdhd6EpKOTL',
  name: 'SyncView Bot',
});

const RECEIPT_FIELDS = Object.freeze([
  'receipt_key',
  'payload_hash',
  'client',
  'team',
  'payload_json',
  'requested_at',
  'updated_at',
  'status',
  'attempts',
  'parent_issue_id',
  'parent_issue_url',
  'child_issue_ids',
  'error',
  'replay_note',
]);

const BRANCHES = Object.freeze([
  Object.freeze({
    label: 'Video',
    team: 'video',
    webhook: 'Webhook',
    authorityGate: 'Authority Gate - Video Form',
    authorityRoute: 'Authority Route - Video Form',
    earlyResponse: 'Authority Accepted - Video Form',
    rejectedResponse: 'Authority Rejected - Video Form',
    lookupStart: 'Fetch Filming Plans',
    lookupSmm: 'Lookup SMM Key',
    projectNode: 'Find Project',
    oldMutationNodes: ['Create Parent Issue', 'Code in JavaScript', 'Loop Over Items', 'Create Sub-Issues'],
    workerPredecessor: 'Pick Freest Editor',
    slack: 'Send a message',
    teamId: 'cd12db10-751a-4cea-bed7-be7bbea1efa6',
    stateId: '0db5ffa8-d0c8-4733-8481-57f9e07f76a2',
  }),
  Object.freeze({
    label: 'Graphics',
    team: 'graphics',
    webhook: 'Webhook2',
    authorityGate: 'Authority Gate - Graphics Form',
    authorityRoute: 'Authority Route - Graphics Form',
    earlyResponse: 'Authority Accepted - Graphics Form',
    rejectedResponse: 'Authority Rejected - Graphics Form',
    lookupStart: 'Fetch Filming Plans1',
    lookupSmm: 'Lookup SMM Key1',
    projectNode: 'Find GRA Project',
    oldMutationNodes: ['Create Parent Issue1', 'Code in JavaScript3', 'Create Sub-Issues2'],
    workerPredecessor: 'Generate Titles',
    slack: 'Send a message1',
    teamId: '4789fc53-4e9b-4599-aab8-4e22420931d7',
    stateId: '6ebdc29c-2f9f-4430-a906-fe0a8ff82e64',
    graphicsAssigneeId: '091b6305-34fd-46ee-b84c-4aeee947c5b8',
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}

function same(a, b) {
  return stable(a) === stable(b);
}

function findNode(workflow, name) {
  return (workflow.nodes || []).find(item => item.name === name);
}

function requireNode(workflow, name) {
  const found = findNode(workflow, name);
  if (!found) throw new Error(`F44 workflow shape drifted: missing node ${name}`);
  return found;
}

function uuidForName(name) {
  const hex = crypto.createHash('sha256').update('syncview-f44-node:' + name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function edge(node, index = 0) {
  return { node, type: 'main', index };
}

function outputs(workflow, source) {
  workflow.connections = workflow.connections || {};
  workflow.connections[source] = workflow.connections[source] || { main: [] };
  workflow.connections[source].main = workflow.connections[source].main || [];
  return workflow.connections[source].main;
}

function connect(workflow, source, target, sourceIndex = 0, targetIndex = 0) {
  const main = outputs(workflow, source);
  while (main.length <= sourceIndex) main.push([]);
  if (!main[sourceIndex].some(item => item.node === target && item.index === targetIndex)) {
    main[sourceIndex].push(edge(target, targetIndex));
  }
}

function disconnect(workflow, source, target, sourceIndex) {
  const main = workflow.connections?.[source]?.main;
  if (!Array.isArray(main)) return;
  const indexes = sourceIndex === undefined ? main.map((_, index) => index) : [sourceIndex];
  for (const index of indexes) {
    if (Array.isArray(main[index])) main[index] = main[index].filter(item => item.node !== target);
  }
}

function removeNode(workflow, name) {
  workflow.nodes = (workflow.nodes || []).filter(item => item.name !== name);
  delete workflow.connections?.[name];
  for (const source of Object.keys(workflow.connections || {})) disconnect(workflow, source, name);
}

function addNode(workflow, item) {
  if (findNode(workflow, item.name)) throw new Error(`F44 node already exists: ${item.name}`);
  workflow.nodes.push(item);
}

function upsertNode(workflow, item) {
  const current = findNode(workflow, item.name);
  if (!current) {
    addNode(workflow, item);
    return item;
  }
  const credentials = current.credentials;
  Object.assign(current, item);
  if (credentials && !item.credentials) current.credentials = credentials;
  return current;
}

function codeNode(name, jsCode, position) {
  return {
    id: uuidForName(name),
    name,
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position,
    parameters: { mode: 'runOnceForAllItems', jsCode },
  };
}

function ifNode(name, leftValue, rightValue, position) {
  return {
    id: uuidForName(name),
    name,
    type: 'n8n-nodes-base.if',
    typeVersion: 2.3,
    position,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
        conditions: [{
          id: uuidForName(name + ':condition'),
          leftValue,
          rightValue,
          operator: { type: 'string', operation: 'equals' },
        }],
        combinator: 'and',
      },
      looseTypeValidation: false,
      options: {},
    },
  };
}

function responseHeaders() {
  return {
    entries: [
      { name: 'Access-Control-Allow-Origin', value: '*' },
      { name: 'Cache-Control', value: 'no-store' },
    ],
  };
}

function respondNode(name, responseBody, responseCode, position) {
  return {
    id: uuidForName(name),
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    typeVersion: 1.5,
    position,
    parameters: {
      respondWith: 'json',
      responseBody,
      options: { responseCode, responseHeaders: responseHeaders() },
    },
  };
}

function receiptFields(values) {
  return {
    fieldValues: RECEIPT_FIELDS.map(fieldId => ({ fieldId, fieldValue: values[fieldId] })),
  };
}

function supabaseNode(name, operation, parameters, position) {
  return {
    id: uuidForName(name),
    name,
    type: 'n8n-nodes-base.supabase',
    typeVersion: 1,
    position,
    credentials: { supabaseApi: clone(SUPABASE_CREDENTIAL) },
    parameters: { resource: 'row', operation, tableId: RECEIPT_TABLE, ...parameters },
  };
}

function dataTableSchema() {
  return RECEIPT_FIELDS.map(name => ({
    id: name,
    displayName: name,
    required: false,
    defaultMatch: false,
    display: true,
    type: name === 'attempts' ? 'number' : (name.endsWith('_at') ? 'date' : 'string'),
    canBeUsedToMatch: true,
  }));
}

function deadLetterNode(branch, position) {
  const name = `F44 Dead Letter Mirror ${branch.label}`;
  const worker = `F44 Worker ${branch.label}`;
  const normalize = `F44 Normalize ${branch.label}`;
  const value = {};
  for (const field of RECEIPT_FIELDS) {
    if (['payload_hash', 'client', 'team', 'payload_json', 'requested_at'].includes(field)) {
      value[field] = `={{ $('${normalize}').first().json._f44.${field} }}`;
    } else if (field === 'updated_at') {
      value[field] = `={{ $('${worker}').first().json.updated_at }}`;
    } else if (field === 'child_issue_ids') {
      value[field] = `={{ JSON.stringify($('${worker}').first().json.child_issue_ids || []) }}`;
    } else if (field === 'status') {
      value[field] = `={{ $('${worker}').first().json.status === 'created' ? 'partial' : $('${worker}').first().json.status }}`;
    } else if (field === 'error') {
      value[field] = `={{ $('${worker}').first().json.status === 'created' ? 'Linear issues were confirmed but the authoritative receipt finalization was not confirmed' : $('${worker}').first().json.error }}`;
    } else {
      value[field] = `={{ $('${worker}').first().json.${field} ?? '' }}`;
    }
  }
  return {
    id: uuidForName(name),
    name,
    type: 'n8n-nodes-base.dataTable',
    typeVersion: 1.1,
    position,
    onError: 'continueRegularOutput',
    parameters: {
      resource: 'row',
      operation: 'upsert',
      dataTableId: { __rl: true, mode: 'id', value: DEAD_LETTER_TABLE_ID, cachedResultName: DEAD_LETTER_TABLE_NAME },
      matchType: 'allConditions',
      filters: { conditions: [{ keyName: 'receipt_key', condition: 'eq', keyValue: `={{ $('${worker}').first().json.receipt_key }}` }] },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['receipt_key'],
        value,
        schema: dataTableSchema(),
      },
      options: {},
    },
  };
}

const SHA256_CODE = String.raw`
function _f44Sha256Hex(text) {
  const source = unescape(encodeURIComponent(String(text)));
  const bytes = Array.from(source, char => char.charCodeAt(0));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 255);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 255);
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotr = (value, count) => (value >>> count) | (value << (32 - count));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const w = new Array(64);
    for (let i = 0; i < 16; i++) {
      const p = offset + i * 4;
      w[i] = ((bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    h[0]=(h[0]+a)>>>0; h[1]=(h[1]+b)>>>0; h[2]=(h[2]+c)>>>0; h[3]=(h[3]+d)>>>0;
    h[4]=(h[4]+e)>>>0; h[5]=(h[5]+f)>>>0; h[6]=(h[6]+g)>>>0; h[7]=(h[7]+hh)>>>0;
  }
  return h.map(value => value.toString(16).padStart(8, '0')).join('');
}
function _f44StableJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_f44StableJson).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + _f44StableJson(value[key])).join(',') + '}';
}`;

function normalizeCode(branch) {
  return `${SHA256_CODE}
const raw = ($('${branch.webhook}').first().json || {}).body || {};
const videos = Array.isArray(raw.videos) ? raw.videos.map((video, index) => ({
  number: Number(video && video.number) || index + 1,
  main_cam: String(video && video.main_cam || ''),
  side_cam: String(video && video.side_cam || ''),
  audio: String(video && video.audio || ''),
  dueDate: video && video.dueDate ? String(video.dueDate) : null,
})) : [];
const payload = {
  clientName: String(raw.clientName || ''),
  title: String(raw.title || ''),
  notes: String(raw.notes || ''),
  videos,
  filmingPlans: String(raw.filmingPlans || ''),
};
const mode = String(raw.mode || '');
const payloadJson = _f44StableJson(payload);
const computedHash = _f44Sha256Hex(payloadJson);
const suppliedHash = String(raw.payload_hash || '').trim().toLowerCase();
const receiptKey = 'linear-intake-v1:${branch.team}:' + computedHash;
const suppliedKey = String(raw.idempotency_key || '');
const suppliedReceiptKey = String(raw.receipt_key || '');
const errors = [];
if (!payload.clientName.trim()) errors.push('client is required');
if (!payload.title.trim()) errors.push('title is required');
if (!videos.length) errors.push('at least one video is required');
if (!/^[0-9a-f]{64}$/.test(suppliedHash) || suppliedHash !== computedHash) errors.push('payload hash mismatch');
if (String(raw.team || '').toLowerCase() !== '${branch.team}') errors.push('team mismatch');
if (suppliedKey !== receiptKey) errors.push('idempotency key mismatch');
if (suppliedReceiptKey !== receiptKey) errors.push('receipt key mismatch');
const now = new Date().toISOString();
return [{ json: {
  ...raw,
  _f44: {
    valid: errors.length === 0,
    error: errors.join('; ') || null,
    receipt_key: receiptKey,
    payload_hash: computedHash,
    client: payload.clientName.trim(),
    team: '${branch.team}',
    payload,
    payload_json: payloadJson,
    body: raw,
    requested_at: now,
    updated_at: now,
  },
} }];`;
}

function classifyCode(branch) {
  const normalize = `F44 Normalize ${branch.label}`;
  const fetch = `F44 Fetch Existing Receipt ${branch.label}`;
  return `const expected = $('${normalize}').first().json._f44;
const row = $('${fetch}').first().json || {};
if (!row.receipt_key || row.receipt_key !== expected.receipt_key || row.payload_hash !== expected.payload_hash || row.team !== expected.team) {
  return [{ json: { action: 'error', http_status: 503, error: 'intake receipt collision could not be verified' } }];
}
const status = String(row.status || '').toLowerCase();
const triageCodesForText = value => {
  const text = String(value || '').toLowerCase();
  if (/no smm credential/.test(text)) return ['smm_credential_missing'];
  if (/expected exactly one .* project/.test(text)) return ['project_mapping_ambiguous'];
  if (/no .* project|null project/.test(text)) return ['project_mapping_missing'];
  if (/project\\/team mismatch/.test(text)) return ['project_team_mismatch'];
  if (/invalid smm credential/.test(text)) return ['linear_credential_invalid'];
  if (/no video editor roster/.test(text)) return ['video_editor_roster_missing'];
  if (/no graphics roster/.test(text)) return ['graphics_assignee_missing'];
  if (/authority unavailable/.test(text)) return ['legacy_authority_unavailable'];
  if (/syncview authoritative/.test(text)) return ['legacy_authority_not_linear'];
  if (/linear request failed|linear rejected|linear returned no result/.test(text)) return ['linear_api_unavailable'];
  if (/partial/.test(text)) return ['partial_linear_work_requires_recovery'];
  return ['intake_receipt_requires_staff_review'];
};
const received = (source, summary) => {
  const codes = Array.isArray(source.triage_reason_codes) && source.triage_reason_codes.length
    ? source.triage_reason_codes.map(String)
    : triageCodesForText(source.error || summary);
  return [{ json: {
    ...source,
    action: 'received',
    http_status: 202,
    triage_required: true,
    triage_reason_codes: [...new Set(codes)],
    triage_summary: String(summary || 'The stored intake needs staff recovery before Linear work can be confirmed.'),
  } }];
};
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const parseChildren = value => {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (_) { return []; }
};
if (status === 'created') {
  const children = parseChildren(row.child_issue_ids);
  if (row.payload_json !== expected.payload_json
      || !uuidV4.test(String(row.parent_issue_id || ''))
      || !Array.isArray(children)
      || children.length !== expected.payload.videos.length
      || new Set(children.map(String)).size !== children.length
      || !children.every(id => uuidV4.test(String(id)))) {
    return [{ json: { action: 'error', http_status: 503, error: 'created receipt failed exact parent/child confirmation' } }];
  }
  return [{ json: { ...row, action: 'created', http_status: 200 } }];
}
if (status === 'partial') {
  return received(row, 'Some Linear work may exist. Staff must reconcile this retained submission before continuing.');
}
if (status === 'failed') {
  return received(row, 'The submission is retained. Staff must repair the internal prerequisite before an explicit replay.');
}
if (status === 'pending') {
  const transportReplayId = String(expected.body && expected.body.operator_replay_id || '');
  const children = parseChildren(row.child_issue_ids);
  let note = null;
  try { note = JSON.parse(String(row.replay_note || '')); } catch (_) {}
  const exact = note && note.exact_id_readback;
  const expectedParent = row.parent_issue_id ? 'present' : 'absent';
  const claimed = Boolean(
    note && exact
    && uuidV4.test(transportReplayId)
    && transportReplayId === String(note.replay_id || '')
    && note.schema_version === 1
    && (note.source_status === 'partial' || note.source_status === 'failed')
    && note.receipt_key === expected.receipt_key
    && note.payload_hash === expected.payload_hash
    && Number(note.prior_attempts) + 1 === Number(row.attempts)
    && exact.strategy === 'read-before-create'
    && exact.parent === expectedParent
    && Array.isArray(exact.confirmed_child_ids)
    && JSON.stringify(exact.confirmed_child_ids.map(String)) === JSON.stringify(children)
    && String(note.requested_by || '').trim()
    && String(note.reason || '').trim()
    && row.payload_json === expected.payload_json
  );
  if (claimed) return [{ json: { ...row, action: 'claimed', http_status: 202 } }];
  return received(row, 'The submission is already retained and awaiting staff confirmation.');
}
return [{ json: { ...row, action: 'error', http_status: 503, error: 'intake receipt has an invalid status' } }];`;
}

function prepareGraphicsTitlesCode() {
  return `const videos = (($('Webhook2').first().json || {}).body || {}).videos || [];
return videos.map((video, index) => ({ json: {
  videoNumber: Number(video && video.number) || index + 1,
  dueDate: video && video.dueDate ? String(video.dueDate) : null,
} }));`;
}

function workerCode(branch) {
  const normalize = `F44 Normalize ${branch.label}`;
  const lookup = branch.lookupSmm;
  const project = branch.projectNode;
  const receiptClaim = `F44 Read Claimed Receipt ${branch.label}`;
  const graphicsGenerated = branch.team === 'graphics' ? `
const generatedTitles = new Map();
for (const item of _nodeAll('Generate Titles')) {
  const number = Number(item.json && item.json.videoNumber);
  const title = String(item.json && item.json.generatedTitle || '').trim();
  if (number && title) generatedTitles.set(number, title);
}` : '';
  const rosterPreflight = branch.team === 'video' ? `
  const roster = _nodeAll('Get Editors').map(item => String(item.json && item.json.email || '').trim()).filter(Boolean);
  const resolvedRoster = (((_nodeJson('Find Editor').data || {}).users || {}).nodes || []);
  const picked = _nodeJson('Pick Freest Editor');
  if (!roster.length || !resolvedRoster.length || !String(picked.id || '').trim()) fail('no video editor roster for ' + client);
  assigneeId = String(picked.id).trim();` : `
  assigneeId = '${branch.graphicsAssigneeId}';`;

  return `${SHA256_CODE}
const MAX_ATTEMPTS = ${MAX_ATTEMPTS};
const RETRY_BACKOFF_MS = [2000, 5000, 10000];
const ctx = $('${normalize}').first().json._f44;
const client = ctx.client;
const receiptKey = ctx.receipt_key;
const _nodeJson = name => { try { return $(name).first().json || {}; } catch (_) { return {}; } };
const _nodeAll = name => { try { return $(name).all() || []; } catch (_) { return []; } };
const authority = _nodeJson('${branch.authorityGate}')._writeUiAuthority || {};
const claimed = _nodeJson('${receiptClaim}');
const prior = claimed.receipt_key === receiptKey ? claimed : {};
let attempts = Number(prior.attempts || 0);
let parentIssue = null;
const confirmedChildIds = [];
let replayNote = String(prior.replay_note || '').trim() || null;
const updatedAt = () => new Date().toISOString();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeError = error => String(error && error.message || error || 'unknown intake failure').slice(0, 1500);
const fail = message => { throw new Error(message); };
const deterministicUuidV4 = seed => {
  const hex = _f44Sha256Hex('8ec6f2de-20f4-4dc3-8f21-8b3298e780db:' + seed);
  return hex.slice(0,8) + '-' + hex.slice(8,12) + '-4' + hex.slice(13,16) + '-a' + hex.slice(17,20) + '-' + hex.slice(20,32);
};
const lookupData = _nodeJson('${lookup}');
const projectData = _nodeJson('${project}');
const apiKey = String(lookupData.smmApiKey || '').trim();
const projects = (((projectData.data || {}).team || {}).projects || {}).nodes || [];
const mappedPlanUrl = String(lookupData.filmingPlanUrl || '').trim();
const submittedPlanUrl = String(ctx.payload.filmingPlans || '').trim();
const notesWithoutPlan = String(ctx.payload.notes || '')
  .split(/\\r?\\n/)
  .filter(line => !/^\\s*Filming Plan:\\s*/i.test(line))
  .join('\\n')
  .trim();
let filmingPlanUrl = mappedPlanUrl || submittedPlanUrl || null;
const authorityBlocked = authority && authority.allowed === false;
let filmingPlanStatus = authorityBlocked ? 'not_checked' : 'resolved_server';
let filmingPlanAlert = '';
let filmingPlanMarker = '';
if (authorityBlocked) {
  filmingPlanUrl = null;
} else if (mappedPlanUrl && submittedPlanUrl && mappedPlanUrl !== submittedPlanUrl) {
  filmingPlanStatus = 'server_mapping_mismatch';
  filmingPlanMarker = '[SyncView] FILMING PLAN LINK MISMATCH - server mapping used; submitted link retained for SMM review: ' + submittedPlanUrl;
  filmingPlanAlert = '[SyncView] FILMING PLAN ACTION REQUIRED for ' + client + ': server mapping differed from the submitted link. Review the parent issue.';
} else if (!mappedPlanUrl && submittedPlanUrl) {
  filmingPlanStatus = 'submitted_unverified';
  filmingPlanMarker = '[SyncView] FILMING PLAN MAPPING MISSING - submitted link retained; SMM verify: ' + submittedPlanUrl;
  filmingPlanAlert = '[SyncView] FILMING PLAN ACTION REQUIRED for ' + client + ': no protected mapping was found; the submitted link was retained for review.';
} else if (!mappedPlanUrl) {
  filmingPlanStatus = 'missing';
  filmingPlanMarker = '[SyncView] FILMING PLAN MISSING - client submission accepted; SMM add or repair the protected mapping.';
  filmingPlanAlert = '[SyncView] FILMING PLAN ACTION REQUIRED for ' + client + ': submission was created without a filming plan. Add or repair the protected mapping.';
}
const description = [
  filmingPlanUrl ? 'Filming Plan: ' + filmingPlanUrl : '',
  filmingPlanMarker,
  notesWithoutPlan,
].filter(Boolean).join('\\n\\n');
const videos = Array.isArray(ctx.payload.videos) ? ctx.payload.videos : [];
const parentId = deterministicUuidV4(receiptKey + ':parent');
const teamId = '${branch.teamId}';
const stateId = '${branch.stateId}';
let projectId = '';
let assigneeId = '';
${graphicsGenerated}
const triageCodeForError = error => {
  const text = safeError(error).toLowerCase();
  if (/no smm credential/.test(text)) return 'smm_credential_missing';
  if (/expected exactly one .* project/.test(text)) return 'project_mapping_ambiguous';
  if (/no .* project|null project/.test(text)) return 'project_mapping_missing';
  if (/project\\/team mismatch/.test(text)) return 'project_team_mismatch';
  if (/invalid smm credential/.test(text)) return 'linear_credential_invalid';
  if (/no video editor roster/.test(text)) return 'video_editor_roster_missing';
  if (/no graphics roster/.test(text)) return 'graphics_assignee_missing';
  if (/linear request failed|linear rejected|linear returned no result/.test(text)) return 'linear_api_unavailable';
  if (/deterministic|not every deterministic/.test(text)) return 'linear_confirmation_unavailable';
  return 'linear_intake_internal_error';
};
const triageSummary = codes => codes.map(code => ({
  legacy_authority_unavailable: 'Legacy authority is unavailable; no legacy Linear mutation was attempted.',
  legacy_authority_not_linear: 'SyncView is authoritative; no legacy Linear mutation was attempted.',
  smm_credential_missing: 'The client has no usable SMM Linear credential.',
  project_mapping_ambiguous: 'The client does not resolve to exactly one Linear project.',
  project_mapping_missing: 'The client has no usable Linear project mapping.',
  project_team_mismatch: 'The resolved project is not valid for this team.',
  linear_credential_invalid: 'The configured Linear credential was rejected.',
  video_editor_roster_missing: 'The video editor roster could not resolve an active assignee.',
  graphics_assignee_missing: 'The graphics assignee could not resolve as active.',
  linear_api_unavailable: 'Linear could not complete a required request.',
  linear_confirmation_unavailable: 'Linear work could not be exactly confirmed.',
  filming_plan_mapping_missing: 'The protected filming-plan mapping is missing.',
  linear_intake_internal_error: 'An internal intake dependency needs staff recovery.',
}[code] || code)).join(' ');
const triageResult = (codes, error) => {
  const uniqueCodes = [...new Set(codes.filter(Boolean).map(String))];
  return {
    receipt_key: receiptKey,
    team: ctx.team,
    payload_hash: ctx.payload_hash,
    status: parentIssue || confirmedChildIds.length ? 'partial' : 'failed',
    attempts,
    parent_issue_id: parentIssue ? parentIssue.id : null,
    parent_issue_url: parentIssue ? (parentIssue.url || null) : null,
    parent_identifier: parentIssue ? (parentIssue.identifier || null) : null,
    parent_title: parentIssue ? (parentIssue.title || String(ctx.payload.title || '')) : null,
    child_issue_ids: confirmedChildIds,
    filming_plan_status: filmingPlanStatus,
    filming_plan_url: filmingPlanUrl,
    filming_plan_alert: filmingPlanAlert || null,
    triage_required: true,
    triage_reason_codes: uniqueCodes,
    triage_summary: triageSummary(uniqueCodes),
    error: safeError(error),
    replay_note: replayNote,
    updated_at: updatedAt(),
    http_status: 202,
  };
};
if (authorityBlocked) {
  const authorityCode = authority.reason === 'syncview_authoritative'
    ? 'legacy_authority_not_linear'
    : 'legacy_authority_unavailable';
  return [{ json: triageResult([authorityCode], 'legacy authority blocked the Linear mutation') }];
}
const httpRequest = options => this.helpers.httpRequest(options);

async function graph(query, variables, allowNotFound) {
  let response;
  try {
    response = await httpRequest({
      method: 'POST',
      url: 'https://api.linear.app/graphql',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: { query, variables },
      json: true,
      timeout: 15000,
    });
  } catch (error) {
    throw new Error('Linear request failed: ' + safeError(error));
  }
  const errors = Array.isArray(response && response.errors) ? response.errors : [];
  if (errors.length) {
    const detail = errors.map(item => String(item && item.message || '')).join('; ');
    if (allowNotFound && /not found|entity not found|could not find/i.test(detail)) return { data: { issue: null } };
    throw new Error('Linear rejected the request: ' + detail);
  }
  if (!response || !response.data) throw new Error('Linear returned no result');
  return response;
}

async function readIssue(id) {
  const result = await graph(
    'query F44ReadIssue($id: String!) { issue(id: $id) { id identifier title url team { id key } project { id } parent { id } } }',
    { id },
    true,
  );
  return result.data.issue || null;
}

function verifyIssue(issue, expected, kind) {
  if (!issue || issue.id !== expected.id) fail(kind + ' deterministic-ID readback mismatch');
  if (!issue.team || issue.team.id !== teamId) fail(kind + ' deterministic ID belongs to another team');
  if (!issue.project || issue.project.id !== projectId) fail(kind + ' deterministic ID belongs to another project');
  if (String(issue.title || '') !== expected.title) fail(kind + ' deterministic ID belongs to another payload');
  if (expected.parentId && (!issue.parent || issue.parent.id !== expected.parentId)) fail(kind + ' deterministic ID belongs to another parent');
  return issue;
}

async function readOrCreate(expected, input, kind) {
  let lastError = null;
  for (let cycle = 0; cycle < MAX_ATTEMPTS; cycle++) {
    let existing;
    try {
      existing = await readIssue(expected.id);
    } catch (error) {
      lastError = error;
      if (cycle < MAX_ATTEMPTS - 1) await wait(RETRY_BACKOFF_MS[cycle]);
      continue;
    }
    if (existing) return verifyIssue(existing, expected, kind);

    // A successful exact-ID absence read is the authorization for this one
    // create attempt. An unavailable read never falls through to mutation.
    attempts += 1;
    try {
      const created = await graph(
        'mutation F44CreateIssue($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier title url } } }',
        { input },
        false,
      );
      if (!created.data.issueCreate || created.data.issueCreate.success !== true) throw new Error('Linear issueCreate did not confirm success');
    } catch (error) {
      lastError = error;
    }
    // Always read back after a create response, including a timeout or other
    // ambiguous result. The next cycle starts with another absence read.
    try {
      const readback = await readIssue(expected.id);
      if (readback) return verifyIssue(readback, expected, kind);
    } catch (error) {
      lastError = error;
    }
    if (cycle < MAX_ATTEMPTS - 1) await wait(RETRY_BACKOFF_MS[cycle]);
  }
  throw lastError || new Error(kind + ' was not confirmed after bounded retry');
}

try {
  if (projects.length !== 1) fail('expected exactly one ${branch.team} project for ' + client + '; found ' + projects.length);
  projectId = String(projects[0] && projects[0].id || '').trim();
  if (!projectId) fail('no ${branch.team} project for ' + client + '; null project is forbidden');
  if (!apiKey) fail('no SMM credential for ' + client);
  if (!videos.length) fail('no video roster for ' + client);
${rosterPreflight}
  const viewer = await graph('query F44Viewer { viewer { id } }', {}, false);
  if (!viewer.data.viewer || !viewer.data.viewer.id) fail('invalid SMM credential for ' + client);
  const projectCheck = await graph('query F44Project($id: String!) { project(id: $id) { id teams { nodes { id } } } }', { id: projectId }, false);
  const projectTeams = projectCheck.data.project && projectCheck.data.project.teams && projectCheck.data.project.teams.nodes;
  if (!projectCheck.data.project || projectCheck.data.project.id !== projectId || !Array.isArray(projectTeams) || !projectTeams.some(projectTeam => projectTeam && projectTeam.id === teamId)) {
    fail('project/team mismatch for ' + client);
  }
  const assigneeCheck = await graph('query F44Assignee($id: String!) { user(id: $id) { id active } }', { id: assigneeId }, false);
  if (!assigneeCheck.data.user || assigneeCheck.data.user.id !== assigneeId || assigneeCheck.data.user.active === false) {
    fail('no ${branch.team} roster for ' + client);
  }

  const parentExpected = { id: parentId, title: String(ctx.payload.title || ''), parentId: null };
  parentIssue = await readOrCreate(parentExpected, {
    id: parentId,
    title: parentExpected.title,
    teamId,
    description,
    stateId,
    projectId,
    assigneeId,
  }, 'parent');

  for (let index = 0; index < videos.length; index++) {
    const video = videos[index];
    const number = Number(video.number) || index + 1;
    const childId = deterministicUuidV4(receiptKey + ':child:${branch.team}-video:' + index);
    const childTitle = 'Video ' + number;
    const childExpected = { id: childId, title: childTitle, parentId };
    const childDescription = '${branch.team}' === 'video'
      ? '**Main Camera:** ' + String(video.main_cam || '') + '\\n**Side Camera:** ' + String(video.side_cam || '') + '\\n**Audio:** ' + String(video.audio || '')
      : (generatedTitles.get(number) || childTitle);
    const child = await readOrCreate(childExpected, {
      id: childId,
      title: childTitle,
      teamId,
      description: childDescription,
      parentId,
      projectId,
      stateId,
      sortOrder: number,
      assigneeId,
      dueDate: video.dueDate || null,
    }, 'child ' + number);
    confirmedChildIds.push(child.id);
  }

  if (!parentIssue || confirmedChildIds.length !== videos.length || new Set(confirmedChildIds).size !== videos.length) fail('not every deterministic issue was confirmed');
  return [{ json: {
    receipt_key: receiptKey,
    team: ctx.team,
    payload_hash: ctx.payload_hash,
    status: 'created',
    attempts,
    parent_issue_id: parentIssue.id,
    parent_issue_url: parentIssue.url || null,
    parent_identifier: parentIssue.identifier || null,
    parent_title: parentIssue.title || String(ctx.payload.title || ''),
    child_issue_ids: confirmedChildIds,
    filming_plan_status: filmingPlanStatus,
    filming_plan_url: filmingPlanUrl,
    filming_plan_alert: filmingPlanAlert || null,
    error: null,
    replay_note: replayNote,
    updated_at: updatedAt(),
    http_status: 200,
  } }];
} catch (error) {
  const codes = [triageCodeForError(error)];
  if (filmingPlanStatus === 'missing' || filmingPlanStatus === 'submitted_unverified') {
    codes.unshift('filming_plan_mapping_missing');
  }
  return [{ json: triageResult(codes, error) }];
}`;
}

function namesFor(branch) {
  const suffix = branch.label;
  return Object.freeze({
    normalize: `F44 Normalize ${suffix}`,
    hashRoute: `F44 Hash Valid ${suffix}`,
    badRequest: `F44 Bad Request ${suffix}`,
    insert: `F44 Insert Receipt ${suffix}`,
    fetch: `F44 Fetch Existing Receipt ${suffix}`,
    classify: `F44 Classify Existing Receipt ${suffix}`,
    createdRoute: `F44 Existing Created ${suffix}`,
    replayRoute: `F44 Existing Replay ${suffix}`,
    claimedRoute: `F44 Existing Claimed ${suffix}`,
    existingResponse: `F44 Existing Receipt Response ${suffix}`,
    receivedResponse: `F44 Existing Received Response ${suffix}`,
    duplicateResponse: `F44 Duplicate Success ${suffix}`,
    replay: `F44 Replay Receipt ${suffix}`,
    claimRead: `F44 Read Claimed Receipt ${suffix}`,
    claimVerify: `F44 Verify Claimed Receipt ${suffix}`,
    claimRoute: `F44 Claim Valid ${suffix}`,
    claimConflict: `F44 Claim Conflict ${suffix}`,
    prepareTitles: `F44 Prepare Graphics Titles`,
    worker: `F44 Worker ${suffix}`,
    finalize: `F44 Finalize Receipt ${suffix}`,
    finalRead: `F44 Read Final Receipt ${suffix}`,
    finalVerify: `F44 Verify Final Receipt ${suffix}`,
    finalVerifyRoute: `F44 Final Receipt Valid ${suffix}`,
    finalRoute: `F44 Created ${suffix}`,
    deadLetter: `F44 Dead Letter Mirror ${suffix}`,
    failureResponse: `F44 Failure Response ${suffix}`,
    slackShape: `F44 Slack Shape ${suffix}`,
    triageShape: `F44 Triage Alert Shape ${suffix}`,
    triageSlack: `F44 Triage Alert ${suffix}`,
    successResponse: `F44 Success Response ${suffix}`,
  });
}

function claimVerifyCode(branch) {
  const names = namesFor(branch);
  return `const row = $('${names.claimRead}').first().json || {};
const expected = $('${names.normalize}').first().json._f44;
let classified = {};
try {
  classified = $('${names.classify}').first().json || {};
} catch (_) { /* fresh insert path */ }
const automaticReplay = classified.action === 'replay';
const preclaimedReplay = classified.action === 'claimed';
const expectedAttempts = automaticReplay
  ? Number(classified.attempts || 0) + 1
  : (preclaimedReplay ? Number(classified.attempts || 0) : 0);
const expectedNote = automaticReplay || preclaimedReplay ? String(classified.replay_note || '') : '';
const expectedChildren = automaticReplay || preclaimedReplay ? String(classified.child_issue_ids || '[]') : '[]';
const expectedParent = automaticReplay || preclaimedReplay ? String(classified.parent_issue_id || '') : '';
const valid = row.receipt_key === expected.receipt_key
  && row.payload_hash === expected.payload_hash
  && row.team === expected.team
  && row.client === expected.client
  && row.payload_json === expected.payload_json
  && row.status === 'pending'
  && Number(row.attempts || 0) === expectedAttempts
  && String(row.replay_note || '') === expectedNote
  && String(row.child_issue_ids || '[]') === expectedChildren
  && String(row.parent_issue_id || '') === expectedParent
  && (!preclaimedReplay || String(row.updated_at || '') === String(classified.updated_at || ''));
return [{ json: {
  valid,
  error: valid ? null : 'the intake claim changed before work began; no create was attempted',
  expected_attempts: expectedAttempts,
  expected_replay_note: expectedNote,
} }];`;
}

function finalVerifyCode(branch) {
  const names = namesFor(branch);
  return `const row = $('${names.finalRead}').first().json || {};
const worker = $('${names.worker}').first().json || {};
const expected = $('${names.normalize}').first().json._f44;
let storedChildren = [];
try { storedChildren = JSON.parse(String(row.child_issue_ids || '[]')); } catch (_) {}
const expectedChildren = Array.isArray(worker.child_issue_ids) ? worker.child_issue_ids : [];
const sameChildren = JSON.stringify(storedChildren) === JSON.stringify(expectedChildren);
const createdShape = worker.status !== 'created' || (
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(row.parent_issue_id || ''))
  && storedChildren.length === expected.payload.videos.length
  && new Set(storedChildren.map(String)).size === storedChildren.length
  && storedChildren.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id)))
);
const valid = row.receipt_key === expected.receipt_key
  && row.payload_hash === expected.payload_hash
  && row.team === expected.team
  && row.payload_json === expected.payload_json
  && row.status === worker.status
  && Number(row.attempts || 0) === Number(worker.attempts || 0)
  && String(row.parent_issue_id || '') === String(worker.parent_issue_id || '')
  && sameChildren
  && createdShape;
return [{ json: { valid, error: valid ? null : 'the terminal intake receipt could not be confirmed after update' } }];`;
}

const INSTALL_NODE_NAMES = Object.freeze(BRANCHES.flatMap(branch => {
  const names = namesFor(branch);
  const result = Object.values(names);
  return branch.team === 'video' ? result.filter(name => name !== names.prepareTitles) : result;
}));
const TRIAGE_NODE_NAMES = Object.freeze(BRANCHES.flatMap(branch => {
  const names = namesFor(branch);
  return [names.receivedResponse, names.triageShape, names.triageSlack];
}));
const CORE_INSTALL_NODE_NAMES = Object.freeze(INSTALL_NODE_NAMES.filter(name => !TRIAGE_NODE_NAMES.includes(name)));

function slackShapeCode(branch) {
  const names = namesFor(branch);
  return `const result = $('${names.worker}').first().json || {};
return [{ json: {
  data: { issueCreate: { issue: {
    id: result.parent_issue_id,
    identifier: result.parent_identifier,
    title: result.parent_title,
    url: result.parent_issue_url,
  } } },
  filming_plan_status: result.filming_plan_status || null,
  filming_plan_url: result.filming_plan_url || null,
  filming_plan_alert: result.filming_plan_alert || '',
} }];`;
}

function triageShapeCode(branch) {
  const names = namesFor(branch);
  return `const ctx = $('${names.normalize}').first().json._f44 || {};
const _nodeJson = name => { try { return $(name).first().json || {}; } catch (_) { return {}; } };
const worker = _nodeJson('${names.worker}');
const classified = _nodeJson('${names.classify}');
const claim = _nodeJson('${names.claimVerify}');
const authority = (_nodeJson('${branch.authorityGate}')._writeUiAuthority || {});
const source = worker.receipt_key ? worker : classified;
const ledgerStatus = source.status === 'created' ? 'partial' : String(source.status || 'pending');
let codes = Array.isArray(source.triage_reason_codes) ? source.triage_reason_codes.map(String).filter(Boolean) : [];
if (!codes.length) {
  if (worker.status === 'created') codes = ['receipt_finalization_unconfirmed'];
  else if (authority.allowed === false) codes = [authority.reason === 'syncview_authoritative'
    ? 'legacy_authority_not_linear' : 'legacy_authority_unavailable'];
  else if (claim.error) codes = ['receipt_claim_requires_staff_review'];
  else if (ledgerStatus === 'partial') codes = ['partial_linear_work_requires_recovery'];
  else if (ledgerStatus === 'failed') codes = ['intake_receipt_requires_staff_review'];
  else codes = ['receipt_pending_review'];
}
codes = [...new Set(codes)];
const labels = {
  legacy_authority_unavailable: 'Legacy authority unavailable',
  legacy_authority_not_linear: 'SyncView authority is active',
  smm_credential_missing: 'SMM Linear credential missing',
  project_mapping_ambiguous: 'Project mapping is ambiguous',
  project_mapping_missing: 'Project mapping missing',
  project_team_mismatch: 'Project/team mapping mismatch',
  linear_credential_invalid: 'Linear credential rejected',
  video_editor_roster_missing: 'Video editor roster missing',
  graphics_assignee_missing: 'Graphics assignee missing',
  linear_api_unavailable: 'Linear API unavailable',
  linear_confirmation_unavailable: 'Linear confirmation unavailable',
  filming_plan_mapping_missing: 'Filming-plan mapping missing',
  receipt_finalization_unconfirmed: 'Receipt finalization unconfirmed',
  receipt_claim_requires_staff_review: 'Receipt claim requires staff review',
  receipt_pending_review: 'Receipt remains pending review',
  partial_linear_work_requires_recovery: 'Partial Linear work requires recovery',
  intake_receipt_requires_staff_review: 'Retained intake requires staff review',
  linear_intake_internal_error: 'Internal intake dependency failed',
};
return [{ json: {
  client: String(ctx.client || ''),
  team: String(ctx.team || '${branch.team}'),
  receipt_key: String(ctx.receipt_key || source.receipt_key || ''),
  ledger_status: ledgerStatus,
  triage_reason_codes: codes,
  triage_summary: String(source.triage_summary || codes.map(code => labels[code] || code).join('; ')),
  filming_plan_status: source.filming_plan_status || 'not_checked',
  title: String(ctx.payload && ctx.payload.title || ''),
} }];`;
}

function triageSlackText() {
  return '=CLIENT INTAKE TRIAGE REQUIRED\\nClient: {{ $json.client }}\\nTeam: {{ $json.team }}\\nReceipt: {{ $json.receipt_key }}\\nLedger: {{ $json.ledger_status }}\\nPrerequisite: {{ $json.triage_summary }}\\nFilming plan: {{ $json.filming_plan_status }}\\nClient has already been told the submission was received.';
}

function triageSlackNode(workflow, branch, position) {
  const names = namesFor(branch);
  const base = clone(requireNode(workflow, branch.slack));
  base.id = uuidForName(names.triageSlack);
  base.name = names.triageSlack;
  base.position = position;
  base.parameters = {
    ...(base.parameters || {}),
    select: 'user',
    user: { __rl: true, mode: 'id', value: TRIAGE_FALLBACK_SLACK_USER_ID },
    text: triageSlackText(),
    otherOptions: { includeLinkToWorkflow: false },
    resource: 'message',
    operation: 'post',
    messageType: 'text',
  };
  // n8n's workflow export masks credentials. This branch must not depend on
  // a masked normal-SMM Slack node being copied with its credential intact.
  base.credentials = { slackApi: clone(TRIAGE_FALLBACK_SLACK_CREDENTIAL) };
  base.onError = 'continueRegularOutput';
  return base;
}

function slackText(branch) {
  return `=New Linear issue created for {{ $('${branch.lookupSmm}').item.json.body.clientName }}: {{ $json.data.issueCreate.issue.identifier }} - {{ $json.data.issueCreate.issue.title }}*
{{ $json.data.issueCreate.issue.url }}{{ $json.filming_plan_alert ? ' | ' + $json.filming_plan_alert : '' }}`;
}

function successResponseBody(branch) {
  const names = namesFor(branch);
  // Never return the protected plan URL to the browser. The status/alert are
  // sufficient for the client contract; the URL remains only in server-owned
  // work and the internal SMM notification path.
  return `={{ { ok: true, status: 'created', ledger_status: 'created', duplicate: false, team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.worker}').first().json.receipt_key, parent_id: $('${names.worker}').first().json.parent_issue_id, parent: { id: $('${names.worker}').first().json.parent_issue_id, identifier: $('${names.worker}').first().json.parent_identifier, title: $('${names.worker}').first().json.parent_title, url: $('${names.worker}').first().json.parent_issue_url }, child_issue_ids: $('${names.worker}').first().json.child_issue_ids, filming_plan_status: $('${names.worker}').first().json.filming_plan_status, filming_plan_alert: $('${names.worker}').first().json.filming_plan_alert } }}`;
}

function receivedResponseBody(branch) {
  const names = namesFor(branch);
  return `={{ { ok: true, status: 'received', durable_capture: true, triage_required: true, team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.normalize}').first().json._f44.receipt_key, idempotency_key: $('${names.normalize}').first().json._f44.receipt_key, ledger_status: $('${names.classify}').first().json.status || 'pending', triage_reason_codes: $('${names.classify}').first().json.triage_reason_codes || ['intake_receipt_requires_staff_review'], message: 'Production work received. Our team will complete an internal setup step; no action is needed from you.' } }}`;
}

function failureReceivedResponseBody(branch) {
  const names = namesFor(branch);
  return `={{ { ok: true, status: 'received', durable_capture: true, triage_required: true, team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.worker}').first().json.receipt_key, idempotency_key: $('${names.worker}').first().json.receipt_key, ledger_status: $('${names.worker}').first().json.status === 'created' ? 'partial' : $('${names.worker}').first().json.status, triage_reason_codes: $('${names.worker}').first().json.status === 'created' ? ['receipt_finalization_unconfirmed'] : ($('${names.worker}').first().json.triage_reason_codes || ['intake_receipt_requires_staff_review']), message: 'Production work received. Our team will complete an internal setup step; no action is needed from you.' } }}`;
}

function claimReceivedResponseBody(branch) {
  const names = namesFor(branch);
  return `={{ { ok: true, status: 'received', durable_capture: true, triage_required: true, team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.normalize}').first().json._f44.receipt_key, idempotency_key: $('${names.normalize}').first().json._f44.receipt_key, ledger_status: 'pending', triage_reason_codes: ['receipt_claim_requires_staff_review'], message: 'Production work received. Our team will complete an internal setup step; no action is needed from you.' } }}`;
}

function configureReceivedNodes(workflow, branch, lane) {
  const names = namesFor(branch);
  const x = -820;
  const y = lane === 0 ? 1640 : -1440;
  const receivedRoute = ifNode(names.replayRoute, '={{ $json.action }}', 'received', [x + 1320, y + 180]);
  const existingReceived = respondNode(names.receivedResponse, receivedResponseBody(branch), 202, [x + 1540, y + 300]);
  existingReceived.parameters.enableResponseOutput = true;
  const claimReceived = respondNode(names.claimConflict, claimReceivedResponseBody(branch), 202, [x + 2300, y + 180]);
  claimReceived.parameters.enableResponseOutput = true;
  const failureReceived = respondNode(names.failureResponse, failureReceivedResponseBody(branch), 202, [x + 4280, y + 120]);
  failureReceived.parameters.enableResponseOutput = true;
  const triageShape = codeNode(names.triageShape, triageShapeCode(branch), [x + 4500, y + 120]);
  const triageSlack = triageSlackNode(workflow, branch, [x + 4720, y + 120]);
  for (const item of [receivedRoute, existingReceived, claimReceived, failureReceived, triageShape, triageSlack]) {
    upsertNode(workflow, item);
  }
}

function wireReceivedFallback(workflow, branch) {
  const names = namesFor(branch);
  removeNode(workflow, branch.rejectedResponse);
  disconnect(workflow, branch.webhook, branch.authorityGate);
  connect(workflow, branch.webhook, names.normalize);
  disconnect(workflow, names.claimRoute, branch.lookupStart, 0);
  connect(workflow, names.claimRoute, branch.authorityGate, 0);
  connect(workflow, branch.authorityGate, branch.authorityRoute);
  disconnect(workflow, branch.authorityRoute, names.normalize, 0);
  connect(workflow, branch.authorityRoute, branch.lookupStart, 0);
  connect(workflow, branch.authorityRoute, names.worker, 1);
  disconnect(workflow, names.replayRoute, names.replay, 0);
  disconnect(workflow, names.replay, names.claimRead, 0);
  disconnect(workflow, names.replay, names.claimConflict, 1);
  disconnect(workflow, names.finalize, names.deadLetter, 1);
  disconnect(workflow, names.finalRead, names.deadLetter, 1);
  disconnect(workflow, names.finalVerifyRoute, names.deadLetter, 1);
  disconnect(workflow, names.finalRoute, names.deadLetter, 1);
  disconnect(workflow, names.deadLetter, names.failureResponse, 0);
  connect(workflow, names.replayRoute, names.receivedResponse, 0);
  connect(workflow, names.replayRoute, names.claimedRoute, 1);
  connect(workflow, names.finalize, names.failureResponse, 1);
  connect(workflow, names.finalRead, names.failureResponse, 1);
  connect(workflow, names.finalVerifyRoute, names.failureResponse, 1);
  connect(workflow, names.finalRoute, names.failureResponse, 1);
  connect(workflow, names.failureResponse, names.deadLetter);
  connect(workflow, names.failureResponse, names.triageShape);
  connect(workflow, names.receivedResponse, names.triageShape);
  connect(workflow, names.claimConflict, names.triageShape);
  connect(workflow, names.triageShape, names.triageSlack);
}

function refreshInstalledPlanResolution(workflow) {
  for (const [lane, branch] of BRANCHES.entries()) {
    const names = namesFor(branch);
    requireNode(workflow, names.normalize).parameters.jsCode = normalizeCode(branch);
    requireNode(workflow, names.classify).parameters.jsCode = classifyCode(branch);
    requireNode(workflow, names.worker).parameters.jsCode = workerCode(branch);
    requireNode(workflow, names.slackShape).parameters.jsCode = slackShapeCode(branch);
    requireNode(workflow, names.successResponse).parameters.responseBody = successResponseBody(branch);
    const slack = requireNode(workflow, branch.slack);
    slack.parameters.text = slackText(branch);
    slack.onError = 'continueRegularOutput';
    configureReceivedNodes(workflow, branch, lane);
    wireReceivedFallback(workflow, branch);
  }
  return workflow;
}

function installNodes(workflow, branch, lane) {
  const names = namesFor(branch);
  const x = lane === 0 ? -820 : -820;
  const y = lane === 0 ? 1640 : -1440;
  const normalize = codeNode(names.normalize, normalizeCode(branch), [x, y]);
  const hashRoute = ifNode(names.hashRoute, '={{ $json._f44.valid ? "yes" : "no" }}', 'yes', [x + 220, y]);
  const badRequest = respondNode(
    names.badRequest,
    `={{ { ok: false, status: 'rejected', error: $('${names.normalize}').first().json._f44.error } }}`,
    400,
    [x + 440, y + 180],
  );
  const insertValues = {
    receipt_key: `={{ $('${names.normalize}').first().json._f44.receipt_key }}`,
    payload_hash: `={{ $('${names.normalize}').first().json._f44.payload_hash }}`,
    client: `={{ $('${names.normalize}').first().json._f44.client }}`,
    team: branch.team,
    payload_json: `={{ $('${names.normalize}').first().json._f44.payload_json }}`,
    requested_at: `={{ $('${names.normalize}').first().json._f44.requested_at }}`,
    updated_at: `={{ $('${names.normalize}').first().json._f44.updated_at }}`,
    status: 'pending',
    attempts: '={{ 0 }}',
    parent_issue_id: '={{ null }}',
    parent_issue_url: '={{ null }}',
    child_issue_ids: '[]',
    error: '={{ null }}',
    replay_note: '={{ null }}',
  };
  const insert = supabaseNode(names.insert, 'create', {
    dataToSend: 'defineBelow',
    fieldsUi: receiptFields(insertValues),
  }, [x + 440, y - 40]);
  insert.onError = 'continueErrorOutput';
  const fetch = supabaseNode(names.fetch, 'get', {
    filters: { conditions: [{ keyName: 'receipt_key', keyValue: `={{ $('${names.normalize}').first().json._f44.receipt_key }}` }] },
  }, [x + 660, y + 100]);
  fetch.onError = 'continueRegularOutput';
  fetch.alwaysOutputData = true;
  const classify = codeNode(names.classify, classifyCode(branch), [x + 880, y + 100]);
  const createdRoute = ifNode(names.createdRoute, '={{ $json.action }}', 'created', [x + 1100, y + 100]);
  const replayRoute = ifNode(names.replayRoute, '={{ $json.action }}', 'replay', [x + 1320, y + 180]);
  const claimedRoute = ifNode(names.claimedRoute, '={{ $json.action }}', 'claimed', [x + 1540, y + 220]);
  const existingResponse = respondNode(
    names.existingResponse,
    `={{ { ok: false, status: $('${names.classify}').first().json.action, receipt_key: $('${names.normalize}').first().json._f44.receipt_key, error: $('${names.classify}').first().json.error } }}`,
    `={{ $('${names.classify}').first().json.http_status || 503 }}`,
    [x + 1540, y + 280],
  );
  const duplicateResponse = respondNode(
    names.duplicateResponse,
    `={{ { ok: true, status: 'created', ledger_status: 'created', duplicate: true, team: $('${names.fetch}').first().json.team, payload_hash: $('${names.fetch}').first().json.payload_hash, receipt_key: $('${names.fetch}').first().json.receipt_key, parent_id: $('${names.fetch}').first().json.parent_issue_id, parent: { id: $('${names.fetch}').first().json.parent_issue_id, url: $('${names.fetch}').first().json.parent_issue_url }, child_issue_ids: JSON.parse($('${names.fetch}').first().json.child_issue_ids || '[]') } }}`,
    200,
    [x + 1320, y - 80],
  );
  const replay = supabaseNode(names.replay, 'update', {
    filterType: 'manual',
    matchType: 'allFilters',
    filters: { conditions: [
      { keyName: 'receipt_key', condition: 'eq', keyValue: `={{ $('${names.normalize}').first().json._f44.receipt_key }}` },
      { keyName: 'status', condition: 'eq', keyValue: `={{ $('${names.classify}').first().json.status }}` },
      { keyName: 'updated_at', condition: 'eq', keyValue: `={{ $('${names.classify}').first().json.updated_at }}` },
    ] },
    dataToSend: 'defineBelow',
    fieldsUi: {
      fieldValues: [
        { fieldId: 'status', fieldValue: 'pending' },
        { fieldId: 'attempts', fieldValue: `={{ Number($('${names.classify}').first().json.attempts || 0) + 1 }}` },
        { fieldId: 'replay_note', fieldValue: `={{ $('${names.classify}').first().json.replay_note }}` },
        { fieldId: 'updated_at', fieldValue: '={{ new Date().toISOString() }}' },
      ],
    },
  }, [x + 1540, y + 100]);
  replay.onError = 'continueErrorOutput';
  replay.alwaysOutputData = true;
  const claimRead = supabaseNode(names.claimRead, 'get', {
    filters: { conditions: [{ keyName: 'receipt_key', keyValue: `={{ $('${names.normalize}').first().json._f44.receipt_key }}` }] },
  }, [x + 1760, y - 40]);
  claimRead.onError = 'continueErrorOutput';
  claimRead.alwaysOutputData = true;
  const claimVerify = codeNode(names.claimVerify, claimVerifyCode(branch), [x + 1940, y - 40]);
  const claimRoute = ifNode(names.claimRoute, '={{ $json.valid ? "yes" : "no" }}', 'yes', [x + 2120, y - 40]);
  const claimConflict = respondNode(
    names.claimConflict,
    `={{ { ok: false, status: 'conflict', team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.normalize}').first().json._f44.receipt_key, error: 'the intake claim could not be acquired; no create was authorized' } }}`,
    409,
    [x + 2300, y + 180],
  );

  const worker = codeNode(names.worker, workerCode(branch), [x + 2740, y - 40]);
  const finalValues = {
    status: `={{ $('${names.worker}').first().json.status }}`,
    attempts: `={{ $('${names.worker}').first().json.attempts }}`,
    parent_issue_id: `={{ $('${names.worker}').first().json.parent_issue_id }}`,
    parent_issue_url: `={{ $('${names.worker}').first().json.parent_issue_url }}`,
    child_issue_ids: `={{ JSON.stringify($('${names.worker}').first().json.child_issue_ids || []) }}`,
    error: `={{ $('${names.worker}').first().json.error }}`,
    replay_note: `={{ $('${names.worker}').first().json.replay_note }}`,
    updated_at: `={{ $('${names.worker}').first().json.updated_at }}`,
  };
  const finalize = supabaseNode(names.finalize, 'update', {
    filterType: 'manual',
    matchType: 'allFilters',
    filters: { conditions: [
      { keyName: 'receipt_key', condition: 'eq', keyValue: `={{ $('${names.worker}').first().json.receipt_key }}` },
      { keyName: 'payload_hash', condition: 'eq', keyValue: `={{ $('${names.normalize}').first().json._f44.payload_hash }}` },
      { keyName: 'status', condition: 'eq', keyValue: 'pending' },
      { keyName: 'updated_at', condition: 'eq', keyValue: `={{ $('${names.claimRead}').first().json.updated_at }}` },
      { keyName: 'attempts', condition: 'eq', keyValue: `={{ $('${names.claimRead}').first().json.attempts }}` },
    ] },
    dataToSend: 'defineBelow',
    fieldsUi: { fieldValues: Object.entries(finalValues).map(([fieldId, fieldValue]) => ({ fieldId, fieldValue })) },
  }, [x + 2960, y - 40]);
  finalize.onError = 'continueErrorOutput';
  finalize.alwaysOutputData = true;
  const finalRead = supabaseNode(names.finalRead, 'get', {
    filters: { conditions: [{ keyName: 'receipt_key', keyValue: `={{ $('${names.worker}').first().json.receipt_key }}` }] },
  }, [x + 3180, y - 40]);
  finalRead.onError = 'continueErrorOutput';
  finalRead.alwaysOutputData = true;
  const finalVerify = codeNode(names.finalVerify, finalVerifyCode(branch), [x + 3400, y - 40]);
  const finalVerifyRoute = ifNode(names.finalVerifyRoute, '={{ $json.valid ? "yes" : "no" }}', 'yes', [x + 3620, y - 40]);
  const finalRoute = ifNode(names.finalRoute, `={{ $('${names.worker}').first().json.status }}`, 'created', [x + 3840, y - 40]);
  const deadLetter = deadLetterNode(branch, [x + 4060, y + 120]);
  const failureResponse = respondNode(
    names.failureResponse,
    `={{ { ok: false, status: $('${names.worker}').first().json.status === 'created' ? 'partial' : $('${names.worker}').first().json.status, team: '${branch.team}', payload_hash: $('${names.normalize}').first().json._f44.payload_hash, receipt_key: $('${names.worker}').first().json.receipt_key, error: $('${names.worker}').first().json.status === 'created' ? 'Linear issues were confirmed but the authoritative receipt finalization was not confirmed; operator recovery is required' : $('${names.worker}').first().json.error, parent_id: $('${names.worker}').first().json.parent_issue_id, child_issue_ids: $('${names.worker}').first().json.child_issue_ids } }}`,
    `={{ $('${names.worker}').first().json.status === 'created' ? 503 : ($('${names.worker}').first().json.http_status || 502) }}`,
    [x + 4280, y + 120],
  );
  const slackShape = codeNode(names.slackShape, slackShapeCode(branch), [x + 4280, y - 160]);
  const successResponse = respondNode(
    names.successResponse,
    successResponseBody(branch),
    200,
    [x + 4060, y - 160],
  );
  successResponse.parameters.enableResponseOutput = true;

  for (const item of [normalize, hashRoute, badRequest, insert, fetch, classify, createdRoute, replayRoute, claimedRoute,
    existingResponse, duplicateResponse, replay, claimRead, claimVerify, claimRoute, claimConflict, worker,
    finalize, finalRead, finalVerify, finalVerifyRoute, finalRoute, deadLetter, failureResponse, slackShape,
    successResponse]) addNode(workflow, item);

  if (branch.team === 'graphics') {
    addNode(workflow, codeNode(names.prepareTitles, prepareGraphicsTitlesCode(), [x + 2520, y - 40]));
  }
  const preflightNames = branch.team === 'video'
    ? ['Fetch Filming Plans', 'Fetch SMM', 'Lookup SMM Key', 'Find Project', 'Get Editors', 'Find Editor', 'Pick Freest Editor']
    : ['Fetch Filming Plans1', 'Fetch SMM1', 'Lookup SMM Key1', 'Code in JavaScript2', 'Download Filming Plan', 'Find GRA Project', names.prepareTitles, 'Generate Titles'];
  for (const name of preflightNames) {
    const item = requireNode(workflow, name);
    item.onError = 'continueRegularOutput';
    item.alwaysOutputData = true;
  }
  const slack = requireNode(workflow, branch.slack);
  slack.onError = 'continueRegularOutput';
  slack.parameters.text = slackText(branch);

  connect(workflow, branch.authorityRoute, names.normalize, 0);
  connect(workflow, names.normalize, names.hashRoute);
  connect(workflow, names.hashRoute, names.insert, 0);
  connect(workflow, names.hashRoute, names.badRequest, 1);
  connect(workflow, names.insert, names.claimRead, 0);
  connect(workflow, names.insert, names.fetch, 1);
  connect(workflow, names.fetch, names.classify);
  connect(workflow, names.classify, names.createdRoute);
  connect(workflow, names.createdRoute, names.duplicateResponse, 0);
  connect(workflow, names.createdRoute, names.replayRoute, 1);
  connect(workflow, names.replayRoute, names.replay, 0);
  connect(workflow, names.replayRoute, names.claimedRoute, 1);
  connect(workflow, names.claimedRoute, names.claimRead, 0);
  connect(workflow, names.claimedRoute, names.existingResponse, 1);
  connect(workflow, names.replay, names.claimRead, 0);
  connect(workflow, names.replay, names.claimConflict, 1);
  connect(workflow, names.claimRead, names.claimVerify, 0);
  connect(workflow, names.claimRead, names.claimConflict, 1);
  connect(workflow, names.claimVerify, names.claimRoute);
  connect(workflow, names.claimRoute, branch.lookupStart, 0);
  connect(workflow, names.claimRoute, names.claimConflict, 1);

  if (branch.team === 'graphics') {
    connect(workflow, branch.projectNode, names.prepareTitles);
    connect(workflow, names.prepareTitles, 'Generate Titles');
    connect(workflow, 'Generate Titles', names.worker);
  } else {
    connect(workflow, branch.workerPredecessor, names.worker);
  }
  connect(workflow, names.worker, names.finalize);
  connect(workflow, names.finalize, names.finalRead, 0);
  connect(workflow, names.finalize, names.failureResponse, 1);
  connect(workflow, names.finalRead, names.finalVerify, 0);
  connect(workflow, names.finalRead, names.failureResponse, 1);
  connect(workflow, names.finalVerify, names.finalVerifyRoute);
  connect(workflow, names.finalVerifyRoute, names.finalRoute, 0);
  connect(workflow, names.finalVerifyRoute, names.failureResponse, 1);
  connect(workflow, names.finalRoute, names.successResponse, 0);
  connect(workflow, names.finalRoute, names.failureResponse, 1);
  // The durable 202 acknowledgement must precede optional internal mirrors.
  // A dead-letter outage must not turn retained client work into a rejection.
  connect(workflow, names.failureResponse, names.deadLetter);
  connect(workflow, names.successResponse, names.slackShape);
  connect(workflow, names.slackShape, branch.slack);
  configureReceivedNodes(workflow, branch, lane);
  wireReceivedFallback(workflow, branch);
}

function assertBaseShape(workflow) {
  if (!workflow || typeof workflow !== 'object') throw new Error('F44 workflow object is required');
  if (workflow.id && workflow.id !== WORKFLOW_ID) throw new Error(`F44 refused workflow ${workflow.id}`);
  if (workflow.name && workflow.name !== WORKFLOW_NAME) throw new Error(`F44 refused workflow name ${workflow.name}`);
  for (const branch of BRANCHES) {
    for (const name of [branch.webhook, branch.authorityRoute, branch.earlyResponse, branch.rejectedResponse,
      branch.lookupStart, branch.lookupSmm, branch.projectNode, branch.workerPredecessor, branch.slack,
      ...branch.oldMutationNodes]) requireNode(workflow, name);
    const trueEdges = workflow.connections?.[branch.authorityRoute]?.main?.[0] || [];
    if (trueEdges.length !== 1 || trueEdges[0].node !== branch.earlyResponse) {
      throw new Error(`F44 authority true branch drifted for ${branch.label}`);
    }
    const acceptedEdges = workflow.connections?.[branch.earlyResponse]?.main?.[0] || [];
    if (acceptedEdges.length !== 1 || acceptedEdges[0].node !== branch.lookupStart) {
      throw new Error(`F44 premature response chain drifted for ${branch.label}`);
    }
  }
}

function transform(input) {
  const existing = CORE_INSTALL_NODE_NAMES.filter(name => findNode(input, name));
  if (existing.length) {
    if (existing.length !== CORE_INSTALL_NODE_NAMES.length) {
      throw new Error(`F44 partial install detected (${existing.length}/${INSTALL_NODE_NAMES.length}); refusing to guess`);
    }
    const installed = clone(input);
    refreshInstalledPlanResolution(installed);
    verify(installed);
    return installed;
  }
  assertBaseShape(input);
  const workflow = clone(input);
  for (const branch of BRANCHES) {
    removeNode(workflow, branch.earlyResponse);
    for (const name of branch.oldMutationNodes) removeNode(workflow, name);
  }
  BRANCHES.forEach((branch, lane) => installNodes(workflow, branch, lane));
  verify(workflow);
  return workflow;
}

function hasOnlyEdge(workflow, source, sourceIndex, target) {
  const list = workflow.connections?.[source]?.main?.[sourceIndex] || [];
  return list.length === 1 && list[0].node === target;
}

function hasEdge(workflow, source, sourceIndex, target) {
  const list = workflow.connections?.[source]?.main?.[sourceIndex] || [];
  return list.some(item => item.node === target);
}

function compileCodeNodes(workflow, names) {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  for (const name of names) {
    const source = String(requireNode(workflow, name).parameters?.jsCode || '');
    try {
      new AsyncFunction(source);
    } catch (error) {
      throw new Error(`F44 generated code does not compile (${name}): ${error.message}`);
    }
  }
}

function verify(workflow) {
  if (!workflow || typeof workflow !== 'object') throw new Error('F44 workflow object is required');
  if (workflow.id && workflow.id !== WORKFLOW_ID) throw new Error(`F44 refused workflow ${workflow.id}`);
  if (workflow.name && workflow.name !== WORKFLOW_NAME) throw new Error(`F44 refused workflow name ${workflow.name}`);
  const duplicates = (workflow.nodes || []).map(item => item.name).filter((name, index, all) => all.indexOf(name) !== index);
  if (duplicates.length) throw new Error(`F44 duplicate node names: ${[...new Set(duplicates)].join(', ')}`);
  for (const name of INSTALL_NODE_NAMES) requireNode(workflow, name);
  for (const branch of BRANCHES) {
    const names = namesFor(branch);
    if (findNode(workflow, branch.earlyResponse)) throw new Error(`F44 premature success response remains for ${branch.label}`);
    if (findNode(workflow, branch.rejectedResponse)) throw new Error(`F44 pre-receipt rejection remains for ${branch.label}`);
    for (const name of branch.oldMutationNodes) {
      if (findNode(workflow, name)) throw new Error(`F44 legacy mutation node remains reachable: ${name}`);
    }
    if (!hasOnlyEdge(workflow, branch.webhook, 0, names.normalize)
        || !hasOnlyEdge(workflow, names.claimRoute, 0, branch.authorityGate)
        || !hasOnlyEdge(workflow, branch.authorityGate, 0, branch.authorityRoute)
        || !hasOnlyEdge(workflow, branch.authorityRoute, 0, branch.lookupStart)
        || !hasOnlyEdge(workflow, branch.authorityRoute, 1, names.worker)) {
      throw new Error(`F44 ${branch.label} authority decision is not receipt-first with a captured fallback`);
    }
    if (!hasOnlyEdge(workflow, names.normalize, 0, names.hashRoute)) throw new Error(`F44 ${branch.label} normalization route is incomplete`);
    if (!hasOnlyEdge(workflow, names.hashRoute, 0, names.insert) || !hasOnlyEdge(workflow, names.hashRoute, 1, names.badRequest)) {
      throw new Error(`F44 ${branch.label} invalid hashes do not fail closed`);
    }
    const normalizeSource = String(requireNode(workflow, names.normalize).parameters.jsCode || '');
    for (const required of [
      'const payloadJson = _f44StableJson(payload)',
      'const computedHash = _f44Sha256Hex(payloadJson)',
      `'linear-intake-v1:${branch.team}:' + computedHash`,
      "suppliedHash !== computedHash",
      `String(raw.team || '').toLowerCase() !== '${branch.team}'`,
      'suppliedKey !== receiptKey',
      'suppliedReceiptKey !== receiptKey',
      "filmingPlans: String(raw.filmingPlans || '')",
      'payload_json: payloadJson',
    ]) {
      if (!normalizeSource.includes(required)) throw new Error(`F44 ${branch.label} canonical hash/binding guard missing: ${required}`);
    }
    if (normalizeSource.includes("filming plan is required")) {
      throw new Error(`F44 ${branch.label} rejects a blank client plan before protected server resolution`);
    }
    const insert = requireNode(workflow, names.insert);
    if (insert.credentials?.supabaseApi?.id !== SUPABASE_CREDENTIAL.id || insert.parameters.tableId !== RECEIPT_TABLE) {
      throw new Error(`F44 ${branch.label} insert is not using the authoritative Supabase table/credential`);
    }
    const insertFields = (insert.parameters.fieldsUi?.fieldValues || []).map(item => item.fieldId);
    if (!same(insertFields, RECEIPT_FIELDS)) throw new Error(`F44 ${branch.label} insert does not use the exact 14-field receipt contract`);
    if (insert.onError !== 'continueErrorOutput') throw new Error(`F44 ${branch.label} PK collision has no explicit error branch`);
    if (!hasOnlyEdge(workflow, names.insert, 0, names.claimRead) || !hasOnlyEdge(workflow, names.insert, 1, names.fetch)) {
      throw new Error(`F44 ${branch.label} unique race is not split from fresh work`);
    }
    const classifySource = String(requireNode(workflow, names.classify).parameters.jsCode || '');
    for (const required of [
      "status === 'pending'",
      "status === 'failed'",
      "status === 'partial'",
      "status === 'created'",
      "action: 'received'",
      'triage_required: true',
      'const transportReplayId = String(expected.body && expected.body.operator_replay_id',
      "note.source_status === 'partial' || note.source_status === 'failed'",
      "transportReplayId === String(note.replay_id || '')",
      'Number(note.prior_attempts) + 1 === Number(row.attempts)',
      "exact.parent === expectedParent",
      'JSON.stringify(exact.confirmed_child_ids.map(String)) === JSON.stringify(children)',
      "if (claimed) return [{ json: { ...row, action: 'claimed', http_status: 202 } }]",
    ]) {
      if (!classifySource.includes(required)) throw new Error(`F44 ${branch.label} durable-received classification missing: ${required}`);
    }
    if (classifySource.includes("action: 'replay'")) {
      throw new Error(`F44 ${branch.label} lets an anonymous browser replay a triage receipt`);
    }
    if (!hasOnlyEdge(workflow, names.replayRoute, 0, names.receivedResponse)
        || !hasOnlyEdge(workflow, names.replayRoute, 1, names.claimedRoute)
        || !hasOnlyEdge(workflow, names.claimedRoute, 0, names.claimRead)
        || !hasOnlyEdge(workflow, names.claimedRoute, 1, names.existingResponse)) {
      throw new Error(`F44 ${branch.label} durable-received/explicit-replay routing is incomplete`);
    }
    for (const required of ['row.payload_json !== expected.payload_json', 'children.length !== expected.payload.videos.length', 'new Set(children.map(String)).size', 'uuidV4.test']) {
      if (!classifySource.includes(required)) throw new Error(`F44 ${branch.label} stored-created validation missing: ${required}`);
    }
    const replayEdges = workflow.connections?.[names.replay]?.main || [];
    if (replayEdges.some(list => Array.isArray(list) && list.length)) {
      throw new Error(`F44 ${branch.label} leaves automatic replay reachable from intake`);
    }
    const claimRead = requireNode(workflow, names.claimRead);
    const claimSource = String(requireNode(workflow, names.claimVerify).parameters.jsCode || '');
    if (claimRead.onError !== 'continueErrorOutput' || claimRead.alwaysOutputData !== true
        || !claimSource.includes("row.status === 'pending'")
        || !claimSource.includes('row.payload_json === expected.payload_json')
        || !claimSource.includes('String(row.replay_note || \'\') === expectedNote')
        || !claimSource.includes("const preclaimedReplay = classified.action === 'claimed'")
        || !claimSource.includes('Number(classified.attempts || 0) : 0')
        || !claimSource.includes("String(row.child_issue_ids || '[]') === expectedChildren")
        || !claimSource.includes("String(row.parent_issue_id || '') === expectedParent")
        || !claimSource.includes("String(row.updated_at || '') === String(classified.updated_at || '')")
        || !hasOnlyEdge(workflow, names.claimRoute, 0, branch.authorityGate)
        || !hasOnlyEdge(workflow, names.claimRoute, 1, names.claimConflict)) {
      throw new Error(`F44 ${branch.label} claim readback is not exact`);
    }
    const workerSource = String(requireNode(workflow, names.worker).parameters.jsCode || '');
    for (const required of [
      `const MAX_ATTEMPTS = ${MAX_ATTEMPTS}`,
      'deterministicUuidV4',
      'async function readIssue',
      'existing = await readIssue(expected.id)',
      'const readback = await readIssue(expected.id)',
      'An unavailable read never falls through to mutation',
      'timeout: 15000',
      'projects.length !== 1',
      'if (!projectId)',
      'if (!apiKey)',
      'const mappedPlanUrl',
      'const submittedPlanUrl',
      'const notesWithoutPlan',
      'let filmingPlanUrl = mappedPlanUrl || submittedPlanUrl || null;',
      'const authorityBlocked = authority && authority.allowed === false;',
      'if (authorityBlocked)',
      'const triageResult = (codes, error) => {',
      'triage_reason_codes: uniqueCodes',
      'triage_summary: triageSummary(uniqueCodes)',
      "filmingPlanStatus = 'missing'",
      'FILMING PLAN MISSING',
      'FILMING PLAN MAPPING MISSING',
      'FILMING PLAN LINK MISMATCH',
      'filming_plan_status: filmingPlanStatus',
      'filming_plan_alert: filmingPlanAlert || null',
      "title: String(ctx.payload.title || '')",
      'confirmedChildIds.length !== videos.length',
      'new Set(confirmedChildIds).size !== videos.length',
      "status: 'created'",
    ]) {
      if (!workerSource.includes(required)) throw new Error(`F44 ${branch.label} worker invariant missing: ${required}`);
    }
    if (workerSource.indexOf('existing = await readIssue(expected.id)') > workerSource.indexOf("mutation F44CreateIssue")) {
      throw new Error(`F44 ${branch.label} can create before exact-ID absence read`);
    }
    if (workerSource.indexOf('if (authorityBlocked)') > workerSource.indexOf('const httpRequest')) {
      throw new Error(`F44 ${branch.label} can reach Linear before an authority failure is captured`);
    }
    if (/if \(!submittedPlanUrl\) fail|if \(!mappedPlanUrl\) fail/.test(workerSource)) {
      throw new Error(`F44 ${branch.label} can still dead-end a client for an internal filming-plan field`);
    }
    const failureBody = String(requireNode(workflow, names.failureResponse).parameters.responseBody || '');
    if (/safe_to_abandon_receipt|mutation_started/.test(workerSource + failureBody)) {
      throw new Error(`F44 ${branch.label} exposes an unsafe post-receipt abandonment path`);
    }
    if (workerSource.includes('projectId: null')) throw new Error(`F44 ${branch.label} permits a null project`);
    const preflightNames = branch.team === 'video'
      ? ['Fetch Filming Plans', 'Fetch SMM', 'Lookup SMM Key', 'Find Project', 'Get Editors', 'Find Editor', 'Pick Freest Editor']
      : ['Fetch Filming Plans1', 'Fetch SMM1', 'Lookup SMM Key1', 'Code in JavaScript2', 'Download Filming Plan', 'Find GRA Project', names.prepareTitles, 'Generate Titles'];
    for (const name of preflightNames) {
      const item = requireNode(workflow, name);
      if (item.onError !== 'continueRegularOutput' || item.alwaysOutputData !== true) {
        throw new Error(`F44 ${branch.label} preflight dependency can stop before a receipt error: ${name}`);
      }
    }
    if (branch.team === 'graphics') {
      if (!hasOnlyEdge(workflow, branch.projectNode, 0, names.prepareTitles)
          || !hasOnlyEdge(workflow, names.prepareTitles, 0, 'Generate Titles')
          || !hasOnlyEdge(workflow, 'Generate Titles', 0, names.worker)
          || !workerSource.includes("_nodeAll('Generate Titles')")
          || !workerSource.includes('(generatedTitles.get(number) || childTitle)')) {
        throw new Error('F44 Graphics generated-title compatibility path is incomplete');
      }
    }
    const finalize = requireNode(workflow, names.finalize);
    const finalizeFilters = finalize.parameters.filters?.conditions || [];
    if (!['receipt_key', 'payload_hash', 'status', 'updated_at', 'attempts'].every(field => finalizeFilters.some(item => item.keyName === field))) {
      throw new Error(`F44 ${branch.label} terminal update is not claim-CAS bound`);
    }
    if (finalize.onError !== 'continueErrorOutput' || finalize.alwaysOutputData !== true
        || !hasOnlyEdge(workflow, names.worker, 0, names.finalize)
        || !hasOnlyEdge(workflow, names.finalize, 0, names.finalRead)
        || !hasOnlyEdge(workflow, names.finalize, 1, names.failureResponse)) {
      throw new Error(`F44 ${branch.label} receipt is not finalized before terminal routing`);
    }
    const finalRead = requireNode(workflow, names.finalRead);
    const finalVerifySource = String(requireNode(workflow, names.finalVerify).parameters.jsCode || '');
    if (finalRead.onError !== 'continueErrorOutput' || finalRead.alwaysOutputData !== true
        || !finalVerifySource.includes('storedChildren.length === expected.payload.videos.length')
        || !finalVerifySource.includes('new Set(storedChildren.map(String)).size')
        || !finalVerifySource.includes('row.payload_json === expected.payload_json')
        || !hasOnlyEdge(workflow, names.finalVerifyRoute, 0, names.finalRoute)
        || !hasOnlyEdge(workflow, names.finalRead, 1, names.failureResponse)
        || !hasOnlyEdge(workflow, names.finalVerifyRoute, 1, names.failureResponse)) {
      throw new Error(`F44 ${branch.label} terminal receipt readback is not exact`);
    }
    if (!hasOnlyEdge(workflow, names.finalRoute, 0, names.successResponse) || !hasOnlyEdge(workflow, names.finalRoute, 1, names.failureResponse)) {
      throw new Error(`F44 ${branch.label} created and failed/partial paths are not isolated`);
    }
    if (!hasOnlyEdge(workflow, names.successResponse, 0, names.slackShape) || !hasOnlyEdge(workflow, names.slackShape, 0, branch.slack)) {
      throw new Error(`F44 ${branch.label} fail-soft Slack does not run after the durable browser response`);
    }
    if (requireNode(workflow, branch.slack).onError !== 'continueRegularOutput') throw new Error(`F44 ${branch.label} Slack is not fail-soft`);
    const slackShapeSource = String(requireNode(workflow, names.slackShape).parameters.jsCode || '');
    const slackTextValue = String(requireNode(workflow, branch.slack).parameters.text || '');
    const successResponseBody = String(requireNode(workflow, names.successResponse).parameters.responseBody || '');
    if (!slackShapeSource.includes('filming_plan_alert') || !slackTextValue.includes('filming_plan_alert')
        || !successResponseBody.includes('filming_plan_status') || successResponseBody.includes('filming_plan_url')) {
      throw new Error(`F44 ${branch.label} does not notify the assigned SMM when plan follow-up is required`);
    }
    const deadLetter = requireNode(workflow, names.deadLetter);
    if (deadLetter.parameters.dataTableId?.value !== DEAD_LETTER_TABLE_ID || deadLetter.onError !== 'continueRegularOutput') {
      throw new Error(`F44 ${branch.label} failed/partial mirror is misconfigured`);
    }
    const received = requireNode(workflow, names.receivedResponse);
    const failure = requireNode(workflow, names.failureResponse);
    const claimConflict = requireNode(workflow, names.claimConflict);
    const triageShape = requireNode(workflow, names.triageShape);
    const triageSlack = requireNode(workflow, names.triageSlack);
    const triageShapeSource = String(triageShape.parameters.jsCode || '');
    const triageText = String(triageSlack.parameters.text || '');
    if (!hasEdge(workflow, names.failureResponse, 0, names.triageShape)
        || !hasEdge(workflow, names.failureResponse, 0, names.deadLetter)
        || !hasOnlyEdge(workflow, names.receivedResponse, 0, names.triageShape)
        || !hasOnlyEdge(workflow, names.claimConflict, 0, names.triageShape)
        || !hasOnlyEdge(workflow, names.triageShape, 0, names.triageSlack)
        || failure.parameters.options?.responseCode !== 202
        || received.parameters.options?.responseCode !== 202
        || claimConflict.parameters.options?.responseCode !== 202
        || failure.parameters.enableResponseOutput !== true
        || received.parameters.enableResponseOutput !== true
        || claimConflict.parameters.enableResponseOutput !== true
        || !String(failure.parameters.responseBody || '').includes("status: 'received'")
        || !String(failure.parameters.responseBody || '').includes('durable_capture: true')
        || !String(received.parameters.responseBody || '').includes("status: 'received'")
        || !String(received.parameters.responseBody || '').includes('durable_capture: true')
        || !triageShapeSource.includes('triage_reason_codes')
        || triageShapeSource.includes('filming_plan_url')
        || !triageText.includes('CLIENT INTAKE TRIAGE REQUIRED')
        || triageSlack.parameters.user?.value !== TRIAGE_FALLBACK_SLACK_USER_ID
        || triageSlack.credentials?.slackApi?.id !== TRIAGE_FALLBACK_SLACK_CREDENTIAL.id
        || triageSlack.onError !== 'continueRegularOutput') {
      throw new Error(`F44 ${branch.label} durable-received fallback alert is incomplete`);
    }
    const success = requireNode(workflow, names.successResponse);
    const duplicate = requireNode(workflow, names.duplicateResponse);
    if (success.parameters.options?.responseCode !== 200 || duplicate.parameters.options?.responseCode !== 200
        || success.parameters.enableResponseOutput !== true
        || !String(success.parameters.responseBody).includes("status: 'created'")
        || !String(duplicate.parameters.responseBody).includes("status: 'created'")
        || !String(success.parameters.responseBody).includes("ledger_status: 'created'")
        || !String(duplicate.parameters.responseBody).includes("ledger_status: 'created'")
        || !String(success.parameters.responseBody).includes('payload_hash')
        || !String(duplicate.parameters.responseBody).includes('payload_hash')) {
      throw new Error(`F44 ${branch.label} created responses are not explicit 200s`);
    }
    for (const responseName of [names.badRequest, names.existingResponse]) {
      const code = requireNode(workflow, responseName).parameters.options?.responseCode;
      if (code === 200 || String(code).trim() === '200') throw new Error(`F44 ${branch.label} non-created response can return 200 (${responseName})`);
    }
    compileCodeNodes(workflow, [names.normalize, names.classify, names.claimVerify, names.worker, names.finalVerify, names.slackShape, names.triageShape]
      .concat(branch.team === 'graphics' ? [names.prepareTitles] : []));
  }
  const videoKey = `linear-intake-v1:${BRANCHES[0].team}:`;
  const graphicsKey = `linear-intake-v1:${BRANCHES[1].team}:`;
  if (videoKey === graphicsKey) throw new Error('F44 both-team receipts are not independent');
  return workflow;
}

function flattenedConnections(workflow) {
  const result = [];
  for (const [source, value] of Object.entries(workflow.connections || {})) {
    for (let sourceIndex = 0; sourceIndex < (value.main || []).length; sourceIndex++) {
      for (const item of value.main[sourceIndex] || []) {
        result.push({ source, sourceIndex, target: item.node, targetIndex: Number(item.index || 0), connectionType: item.type || 'main' });
      }
    }
  }
  return result;
}

function connectionKey(item) {
  return [item.source, item.sourceIndex, item.target, item.targetIndex, item.connectionType].join('\u0000');
}

function nodeSettings(item) {
  const settings = {};
  for (const key of ['alwaysOutputData', 'executeOnce', 'maxTries', 'onError', 'retryOnFail', 'waitBetweenTries']) {
    if (item && item[key] !== undefined) settings[key] = item[key];
  }
  return settings;
}

function diffOperations(before, after) {
  if (!before || !after) throw new Error('F44 before and after workflows are required');
  verify(after);
  const beforeByName = new Map((before.nodes || []).map(item => [item.name, item]));
  const afterByName = new Map((after.nodes || []).map(item => [item.name, item]));
  const removedNames = [...beforeByName.keys()].filter(name => !afterByName.has(name));
  const addedNames = [...afterByName.keys()].filter(name => !beforeByName.has(name));
  const operations = [];

  for (const name of [...beforeByName.keys()].filter(item => afterByName.has(item))) {
    const oldNode = beforeByName.get(name);
    const newNode = afterByName.get(name);
    if (!same(oldNode.parameters || {}, newNode.parameters || {})) {
      operations.push({ type: 'updateNodeParameters', nodeName: name, parameters: clone(newNode.parameters || {}), replace: true });
    }
    if (!same(oldNode.credentials || {}, newNode.credentials || {})) {
      for (const [credentialKey, credential] of Object.entries(newNode.credentials || {})) {
        operations.push({ type: 'setNodeCredential', nodeName: name, credentialKey, credentialId: credential.id, credentialName: credential.name });
      }
    }
    const oldSettings = nodeSettings(oldNode);
    const newSettings = nodeSettings(newNode);
    if (!same(oldSettings, newSettings)) operations.push({ type: 'setNodeSettings', nodeName: name, settings: newSettings });
    if (!same(oldNode.position, newNode.position)) operations.push({ type: 'setNodePosition', nodeName: name, position: clone(newNode.position) });
  }

  const beforeConnections = flattenedConnections(before);
  const afterConnections = flattenedConnections(after);
  const afterKeys = new Set(afterConnections.map(connectionKey));
  const beforeKeys = new Set(beforeConnections.map(connectionKey));
  for (const item of beforeConnections) {
    if (!afterKeys.has(connectionKey(item)) && !removedNames.includes(item.source) && !removedNames.includes(item.target)) {
      operations.push({ type: 'removeConnection', ...item });
    }
  }
  for (const name of removedNames) operations.push({ type: 'removeNode', nodeName: name });
  for (const name of addedNames) {
    const item = afterByName.get(name);
    const node = {
      id: item.id,
      name: item.name,
      type: item.type,
      typeVersion: item.typeVersion,
      position: clone(item.position),
      parameters: clone(item.parameters || {}),
    };
    if (item.credentials) node.credentials = clone(item.credentials);
    if (item.notes) node.notes = item.notes;
    if (item.disabled !== undefined) node.disabled = item.disabled;
    operations.push({ type: 'addNode', node });
    const settings = nodeSettings(item);
    if (Object.keys(settings).length) operations.push({ type: 'setNodeSettings', nodeName: name, settings });
  }
  for (const item of afterConnections) {
    if (!beforeKeys.has(connectionKey(item))) operations.push({ type: 'addConnection', ...item });
  }
  return operations;
}

module.exports = {
  BRANCHES,
  CORE_INSTALL_NODE_NAMES,
  DEAD_LETTER_TABLE_ID,
  INSTALL_NODE_NAMES,
  MAX_ATTEMPTS,
  RECEIPT_FIELDS,
  RECEIPT_TABLE,
  SUPABASE_CREDENTIAL,
  TRIAGE_FALLBACK_SLACK_CREDENTIAL,
  WORKFLOW_ID,
  WORKFLOW_NAME,
  diffOperations,
  transform,
  verify,
};
