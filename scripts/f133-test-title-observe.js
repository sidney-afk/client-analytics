#!/usr/bin/env node
'use strict';

/*
 * F133 production TEST-only observation/drain.
 *
 * The caller supplies only a SHA-256 correlation for one browser-owned title
 * request. The live request id, card id, deliverable ids, titles, and provider
 * ids are discovered server-side and never printed. The target client is the
 * repository's fixed active TEST fixture; no caller-selected identity or
 * dedup reaches the drainer.
 */

const crypto = require('crypto');

const TEST_CLIENT = 'sidneylaruel';
const TEST_PROJECT_NAMES = Object.freeze({
  video: 'Sidney Laruel',
  graphics: 'Test Project',
});
const TEST_TEAM_KEYS = Object.freeze({ video: 'VID', graphics: 'GRA' });
const OPERATION = 'observe-reviewed-test-title';
const CONFIRMATION = 'OBSERVE_REVIEWED_F133_CANONICAL_TITLE_TEST';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const REQUEST_RE = /^[A-Za-z0-9:_-]{8,199}$/;
const OPEN_STATUSES = new Set(['pending', 'failed', 'shadow_ok']);
const TERMINAL_STATUSES = new Set(['written', 'skipped']);

class SafeFailure extends Error {
  constructor(stage, code) {
    super(code);
    this.name = 'SafeFailure';
    this.stage = stage;
    this.code = code;
  }
}

function fail(stage, code) {
  throw new SafeFailure(stage, code);
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function canonicalTitle(value) {
  if (typeof value !== 'string' || value.includes('\0')) return '';
  const title = value.trim().replace(/\s+/gu, ' ');
  return !title || title.length > 500 || /[\u0000-\u001f\u007f]/u.test(title)
    || /^(?:video|graphics?)\s+[0-9]+$/iu.test(title) ? '' : title;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function certificateSha256(value) {
  return sha256(JSON.stringify(stable(value)));
}

function exactJson(value, expected) {
  return JSON.stringify(stable(object(value))) === JSON.stringify(stable(expected));
}

function safeFailureReceipt(error) {
  return {
    status: 'FAIL',
    stage: error instanceof SafeFailure ? error.stage : 'internal',
    code: error instanceof SafeFailure ? error.code : 'UNEXPECTED_FAILURE',
  };
}

function responseJson(response, stage, code) {
  return response.json().catch(() => fail(stage, code));
}

function buildSupabase(fetchImpl, supabaseUrl, serviceKey) {
  const root = clean(supabaseUrl).replace(/\/+$/, '');
  if (!/^https:\/\/[A-Za-z0-9.-]+$/.test(root) || !clean(serviceKey)) {
    fail('configuration', 'SERVICE_CONFIGURATION_REQUIRED');
  }
  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
  };
  return {
    async rows(table, params, stage) {
      const url = new URL(`${root}/rest/v1/${table}`);
      for (const [key, value] of Object.entries(params || {})) {
        url.searchParams.set(key, String(value));
      }
      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', headers });
      } catch (_error) {
        fail(stage, 'SUPABASE_READ_AMBIGUOUS');
      }
      if (!response || !response.ok) fail(stage, 'SUPABASE_READ_FAILED');
      const payload = await responseJson(response, stage, 'SUPABASE_READ_INVALID');
      if (!Array.isArray(payload)) fail(stage, 'SUPABASE_READ_INVALID');
      return payload;
    },
    async drain(dedupKey, stage) {
      let response;
      try {
        response = await fetchImpl(`${root}/functions/v1/linear-outbound`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({
            target_dedup_key: dedupKey,
            test_override: {
              client_slug: TEST_CLIENT,
              mode: 'live',
              authority: 'syncview',
            },
            confirm: 'B4_TEST_ONLY',
          }),
        });
      } catch (_error) {
        fail(stage, 'TARGET_DRAIN_RESPONSE_UNKNOWN');
      }
      const payload = await responseJson(response, stage, 'TARGET_DRAIN_RESPONSE_UNKNOWN');
      if (!response || !response.ok || object(payload).ok !== true) {
        fail(stage, 'TARGET_DRAIN_FAILED');
      }
      return object(payload);
    },
  };
}

function parseCorrelatedEvent(event, correlationSha256) {
  const payload = object(event.payload);
  const surface = lower(payload.surface);
  const cardId = clean(payload.card_id);
  const eventKey = clean(event.event_key);
  if (!['calendar', 'samples'].includes(surface) || !cardId) return null;
  const prefix = `write-ui:title:card:${surface}:${TEST_CLIENT}:${cardId}:`;
  if (!eventKey.startsWith(prefix)) return null;
  const requestId = eventKey.slice(prefix.length);
  if (!REQUEST_RE.test(requestId) || sha256(requestId) !== correlationSha256) return null;
  return { event, payload, surface, cardId, requestId };
}

function exactTerminal(row, targetTitle) {
  const status = lower(row.status);
  const result = object(row.linear_result);
  const expected = object(result.expected);
  const input = object(expected.input);
  const conflict = object(result.conflict);
  return TERMINAL_STATUSES.has(status)
    && (status !== 'skipped' || lower(conflict.decision) === 'already_applied')
    && clean(result.mutation) === 'issueUpdate'
    && !!clean(result.issue_id)
    && !!clean(result.mirror_actor_id)
    && Number.isFinite(Date.parse(clean(result.updated_at)))
    && clean(expected.id) === clean(result.issue_id)
    && String(input.title == null ? '' : input.title) === targetTitle;
}

async function linearGraphql(fetchImpl, linearKey, query, variables, stage) {
  let response;
  try {
    response = await fetchImpl('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        authorization: clean(linearKey),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });
  } catch (_error) {
    fail(stage, 'LINEAR_READ_AMBIGUOUS');
  }
  if (!response || !response.ok) fail(stage, 'LINEAR_READ_FAILED');
  const payload = object(await responseJson(response, stage, 'LINEAR_READ_INVALID'));
  if (array(payload.errors).length) fail(stage, 'LINEAR_READ_FAILED');
  return object(payload.data);
}

async function linearTestProjects(fetchImpl, linearKey) {
  const data = await linearGraphql(
    fetchImpl,
    linearKey,
    'query F133TestProjects { projects(first: 100, includeArchived: false) { nodes { id name teams { nodes { key } } } } }',
    {},
    'provider_scope',
  );
  const nodes = array(object(data.projects).nodes);
  const projects = new Map();
  for (const [team, name] of Object.entries(TEST_PROJECT_NAMES)) {
    const key = TEST_TEAM_KEYS[team];
    const matches = nodes.filter(project => clean(project.name) === name
      && array(object(project.teams).nodes).some(row => clean(row.key) === key));
    if (matches.length !== 1 || !clean(matches[0].id)) {
      fail('provider_scope', 'LINEAR_TEST_PROJECT_SCOPE_INVALID');
    }
    projects.set(team, { id: clean(matches[0].id), name, key });
  }
  if (new Set([...projects.values()].map(project => project.id)).size !== projects.size) {
    fail('provider_scope', 'LINEAR_TEST_PROJECT_SCOPE_INVALID');
  }
  return projects;
}

async function linearIssue(fetchImpl, linearKey, issueId, stage = 'provider_readback') {
  const data = await linearGraphql(
    fetchImpl,
    linearKey,
    'query F133TitleObservation($id: String!) { issue(id: $id) { id identifier title updatedAt project { id name } team { id key name } } }',
    { id: issueId },
    stage,
  );
  const issue = object(data.issue);
  if (!clean(issue.id)) fail(stage, 'LINEAR_READ_INVALID');
  return issue;
}

async function runObservation(options) {
  const releaseSha = clean(options.releaseSha);
  const operation = clean(options.operation);
  const confirmation = clean(options.confirmation);
  const correlationSha256 = clean(options.requestCorrelationSha256);
  const fetchImpl = options.fetchImpl || global.fetch;
  if (!SHA_RE.test(releaseSha) || operation !== OPERATION
      || confirmation !== CONFIRMATION || !HASH_RE.test(correlationSha256)
      || typeof fetchImpl !== 'function' || !clean(options.linearKey)) {
    fail('configuration', 'REVIEWED_INPUT_REQUIRED');
  }
  const db = buildSupabase(fetchImpl, options.supabaseUrl, options.serviceKey);

  const clients = await db.rows('clients', {
    select: 'slug,kind,active', kind: 'eq.test', active: 'eq.true', order: 'slug.asc', limit: '2',
  }, 'test_scope');
  if (clients.length !== 1 || clean(clients[0].slug) !== TEST_CLIENT
      || lower(clients[0].kind) !== 'test' || clients[0].active !== true) {
    fail('test_scope', 'ACTIVE_TEST_CLIENT_NOT_EXACT');
  }

  const flagKeys = [
    'auth_enforcement', 'f133_canonical_title_enabled', 'linear_inbound_enabled',
    'linear_outbound_enabled', 'prod_authority',
  ];
  const flags = await db.rows('syncview_runtime_flags', {
    select: 'key,value', key: `in.(${flagKeys.join(',')})`, order: 'key.asc', limit: '5',
  }, 'posture');
  const byFlag = new Map(flags.map(row => [clean(row.key), row.value]));
  if (flags.length !== flagKeys.length
      || !exactJson(byFlag.get('f133_canonical_title_enabled'), { enabled: true })
      || !exactJson(byFlag.get('prod_authority'), { graphics: 'linear', video: 'linear' })
      || !exactJson(byFlag.get('linear_outbound_enabled'), { mode: 'off' })
      || !exactJson(byFlag.get('linear_inbound_enabled'), { enabled: true })
      || !exactJson(byFlag.get('auth_enforcement'), { mode: 'permissive' })) {
    fail('posture', 'F133_TEST_OBSERVATION_POSTURE_REQUIRED');
  }

  const recentEvents = await db.rows('deliverable_events', {
    select: 'id,event_key,batch_id,client_slug,ts,actor,role,action,source,payload',
    client_slug: `eq.${TEST_CLIENT}`, action: 'eq.title_change', source: 'eq.ui',
    order: 'id.desc', limit: '200',
  }, 'correlation');
  const matches = recentEvents.map(event => parseCorrelatedEvent(event, correlationSha256)).filter(Boolean);
  if (matches.length !== 1) fail('correlation', 'REQUEST_CORRELATION_NOT_UNIQUE');
  const correlated = matches[0];
  const { event, payload, surface, cardId, requestId } = correlated;
  const targetTitle = canonicalTitle(payload.title);
  const eventRevision = Number(payload.title_revision);
  const fromRevision = Number(payload.from_title_revision);
  if (clean(event.client_slug) !== TEST_CLIENT || clean(event.action) !== 'title_change'
      || clean(event.source) !== 'ui' || !targetTitle || String(payload.title) !== targetTitle
      || !Number.isSafeInteger(eventRevision) || eventRevision < 1
      || !Number.isSafeInteger(fromRevision) || fromRevision < 0
      || eventRevision !== fromRevision + 1
      || clean(payload.auth_kind) !== 'staff'
      || !['admin', 'smm'].includes(lower(event.role))
      || !['admin', 'smm'].includes(lower(payload.role || event.role))
      || Object.prototype.hasOwnProperty.call(payload, 'repair')
      || !Number.isFinite(Date.parse(clean(event.ts)))) {
    fail('correlation', 'TITLE_EVENT_CONTRACT_INVALID');
  }

  const outboxCandidates = await db.rows('mirror_outbox', {
    select: 'id,status,entity,entity_id,deliverable_id,batch_id,comment_id,operation,op,client_slug,team,dedup_key,depends_on_id,payload,source_edited_at,test_only,legacy_parity,authority_generation,attempts,linear_result',
    client_slug: `eq.${TEST_CLIENT}`, operation: 'eq.title', test_only: 'eq.true',
    source_edited_at: `eq.${clean(event.ts)}`, order: 'id.asc', limit: '4',
  }, 'outbox_scope');
  const suffix = `:${requestId}`;
  const outboxes = outboxCandidates.filter(row => clean(row.dedup_key).endsWith(suffix));
  const expectedCount = Number(payload.outbox_count);
  if (![1, 2].includes(outboxes.length) || expectedCount !== outboxes.length
      || Number(payload.deliverable_count) !== outboxes.length
      || outboxes.some(row => row.test_only !== true || row.legacy_parity !== false
        || clean(row.entity) !== 'deliverable' || clean(row.operation) !== 'title'
        || clean(row.op) !== 'update_fields' || clean(row.entity_id) !== clean(row.deliverable_id)
        || row.comment_id != null || clean(row.client_slug) !== TEST_CLIENT
        || clean(row.batch_id) !== clean(event.batch_id)
        || clean(row.source_edited_at) !== clean(event.ts)
        || clean(row.dedup_key) !== `write-ui:title:deliverable:${clean(row.entity_id)}:${requestId}`
        || !['video', 'graphics'].includes(lower(row.team))
        || !Number.isSafeInteger(Number(row.authority_generation))
        || Number(row.authority_generation) < 0
        || ![...OPEN_STATUSES, ...TERMINAL_STATUSES].includes(lower(row.status))
        || JSON.stringify(Object.keys(object(row.payload)).sort())
          !== JSON.stringify(['_intent_fingerprint', 'title'])
        || !clean(object(row.payload)._intent_fingerprint)
        || String(object(row.payload).title == null ? '' : object(row.payload).title) !== targetTitle)) {
    fail('outbox_scope', 'OUTBOX_SCOPE_INVALID');
  }
  if (new Set(outboxes.map(row => clean(row.entity_id))).size !== outboxes.length
      || new Set(outboxes.map(row => lower(row.team))).size !== outboxes.length) {
    fail('outbox_scope', 'OUTBOX_SCOPE_INVALID');
  }

  const cardTable = surface === 'calendar' ? 'calendar_posts' : 'sample_reviews';
  const readCard = async () => {
    const rows = await db.rows(cardTable, {
      select: 'id,client,name,title_revision,updated_at,video_deliverable_id,graphic_deliverable_id',
      client: `eq.${TEST_CLIENT}`, id: `eq.${cardId}`, limit: '2',
    }, 'native_readback');
    if (rows.length !== 1) fail('native_readback', 'CARD_IDENTITY_NOT_EXACT');
    return rows[0];
  };
  const readDeliverables = async () => db.rows('deliverables', {
    select: 'id,batch_id,client_slug,team,kind,title,origin,card_id,linear_issue_uuid,linear_raw',
    client_slug: `eq.${TEST_CLIENT}`, origin: `eq.${surface}`, card_id: `eq.${cardId}`,
    order: 'id.asc', limit: '3',
  }, 'native_readback');

  const initialCard = await readCard();
  const initialDeliverables = await readDeliverables();
  const expectedIds = [
    clean(initialCard.video_deliverable_id), clean(initialCard.graphic_deliverable_id),
  ].filter(Boolean).sort();
  const outboxIds = outboxes.map(row => clean(row.entity_id)).sort();
  if (clean(initialCard.id) !== cardId || clean(initialCard.client) !== TEST_CLIENT
      || String(initialCard.name == null ? '' : initialCard.name) !== targetTitle
      || Number(initialCard.title_revision) !== eventRevision
      || initialDeliverables.length !== outboxes.length
      || expectedIds.length !== outboxes.length
      || JSON.stringify(expectedIds) !== JSON.stringify(outboxIds)
      || initialDeliverables.some(row => !outboxIds.includes(clean(row.id))
        || clean(row.client_slug) !== TEST_CLIENT || clean(row.origin) !== surface
        || clean(row.card_id) !== cardId || clean(row.batch_id) !== clean(event.batch_id)
        || String(row.title == null ? '' : row.title) !== targetTitle)) {
    fail('native_readback', 'NATIVE_TITLE_EQUALITY_REQUIRED');
  }

  // Prove the provider target is inside the two reviewed TEST projects before
  // the first mutation. A TEST database row that is accidentally bound to a
  // real-client Linear issue must fail closed without calling the drainer.
  const testProjects = await linearTestProjects(fetchImpl, options.linearKey);
  const nativeById = new Map(initialDeliverables.map(row => [clean(row.id), row]));
  for (const selected of outboxes) {
    const native = nativeById.get(clean(selected.entity_id));
    const team = lower(selected.team);
    const project = testProjects.get(team);
    const issueId = clean(native && native.linear_issue_uuid);
    const issue = issueId
      ? await linearIssue(fetchImpl, options.linearKey, issueId, 'provider_scope') : null;
    if (!native || lower(native.team) !== team || !project || !issue
        || clean(issue.id) !== issueId
        || !new RegExp(`^${project.key}-\\d+$`, 'i').test(clean(issue.identifier))
        || clean(object(issue.team).key) !== project.key
        || clean(object(issue.project).id) !== project.id
        || clean(object(issue.project).name) !== project.name) {
      fail('provider_scope', 'LINEAR_TEST_ISSUE_SCOPE_INVALID');
    }
  }

  for (const selected of [...outboxes].sort((left, right) => Number(left.id) - Number(right.id))) {
    if (OPEN_STATUSES.has(lower(selected.status))) {
      const response = await db.drain(clean(selected.dedup_key), 'target_drain');
      const target = object(response.target);
      if (clean(target.dedup_key) !== clean(selected.dedup_key)
          || clean(target.operation) !== 'title' || target.test_only !== true
          || !TERMINAL_STATUSES.has(lower(target.status))) {
        fail('target_drain', 'TARGET_DRAIN_RECEIPT_INVALID');
      }
    }
  }

  const terminalRows = [];
  for (const selected of outboxes) {
    const rows = await db.rows('mirror_outbox', {
      select: 'id,status,entity,entity_id,deliverable_id,batch_id,comment_id,operation,op,client_slug,team,dedup_key,payload,source_edited_at,test_only,legacy_parity,authority_generation,linear_result',
      id: `eq.${Number(selected.id)}`, limit: '2',
    }, 'terminal_readback');
    if (rows.length !== 1 || Number(rows[0].id) !== Number(selected.id)
        || rows[0].test_only !== true || rows[0].legacy_parity !== false
        || clean(rows[0].dedup_key) !== clean(selected.dedup_key)
        || !exactTerminal(rows[0], targetTitle)) {
      fail('terminal_readback', 'TITLE_INTENT_NOT_EXACT_TERMINAL');
    }
    terminalRows.push(rows[0]);
  }

  const card = await readCard();
  const deliverables = await readDeliverables();
  const byDeliverable = new Map(deliverables.map(row => [clean(row.id), row]));
  if (String(card.name == null ? '' : card.name) !== targetTitle
      || Number(card.title_revision) !== eventRevision
      || deliverables.length !== terminalRows.length || byDeliverable.size !== terminalRows.length) {
    fail('equality', 'TITLE_EQUALITY_MISMATCH');
  }

  const providerProof = [];
  for (const terminal of terminalRows) {
    const native = byDeliverable.get(clean(terminal.entity_id));
    const result = object(terminal.linear_result);
    const raw = object(native && native.linear_raw);
    const storedIssue = object(raw.issue);
    const clocks = object(raw.field_updated_at);
    const issueId = clean(result.issue_id);
    const receiptClock = Date.parse(clean(result.updated_at));
    const storedClock = Date.parse(clean(clocks.title));
    const provider = await linearIssue(fetchImpl, options.linearKey, issueId);
    const providerClock = Date.parse(clean(provider.updatedAt));
    if (!native || String(native.title == null ? '' : native.title) !== targetTitle
        || clean(native.linear_issue_uuid) !== issueId
        || clean(storedIssue.id) !== issueId
        || String(storedIssue.title == null ? '' : storedIssue.title) !== targetTitle
        || !Number.isFinite(receiptClock) || !Number.isFinite(storedClock)
        || storedClock < receiptClock
        || clean(provider.id) !== issueId
        || String(provider.title == null ? '' : provider.title) !== targetTitle
        || !Number.isFinite(providerClock) || providerClock < storedClock) {
      fail('equality', 'TITLE_EQUALITY_MISMATCH');
    }
    providerProof.push({
      team: lower(native.team), deliverable_id: clean(native.id), issue_id: issueId,
      title: targetTitle, receipt_updated_at: clean(result.updated_at),
      stored_title_updated_at: clean(clocks.title), provider_updated_at: clean(provider.updatedAt),
    });
  }

  const certificate = {
    contract: 'syncview-f133-test-title-observation/v1',
    release_sha: releaseSha,
    request_correlation_sha256: correlationSha256,
    event: { id: Number(event.id), surface, card_id: cardId, title: targetTitle, revision: eventRevision },
    outboxes: terminalRows.map(row => ({
      id: Number(row.id), entity_id: clean(row.entity_id), team: lower(row.team),
      status: lower(row.status), dedup_key: clean(row.dedup_key),
    })).sort((left, right) => left.id - right.id),
    provider: providerProof.sort((left, right) => left.team.localeCompare(right.team)),
  };
  return {
    status: 'PASS',
    operation: OPERATION,
    release_sha: releaseSha,
    request_correlation_sha256: correlationSha256,
    event_count: 1,
    linked_deliverable_count: deliverables.length,
    terminal_title_intent_count: terminalRows.length,
    provider_readback_count: providerProof.length,
    retained_audit_record_count: 1 + terminalRows.length,
    title_equality: 'PASS',
    certificate_sha256: certificateSha256(certificate),
  };
}

async function main() {
  try {
    const receipt = await runObservation({
      releaseSha: process.env.RELEASE_SHA,
      operation: process.env.F133_OPERATION,
      confirmation: process.env.F133_CONFIRM,
      requestCorrelationSha256: process.env.F133_TEST_REQUEST_CORRELATION_SHA256,
      supabaseUrl: process.env.SUPABASE_URL,
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      linearKey: process.env.LINEAR_API_KEY,
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeFailureReceipt(error))}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  CONFIRMATION,
  OPERATION,
  SafeFailure,
  TEST_CLIENT,
  canonicalTitle,
  parseCorrelatedEvent,
  runObservation,
  safeFailureReceipt,
  sha256,
};
