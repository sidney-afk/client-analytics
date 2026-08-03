'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const edge = fs.readFileSync(path.join(
  ROOT, 'supabase', 'functions', 'production-write', 'index.ts',
), 'utf8');

let failures = 0;
function ok(condition, label) {
  if (condition) console.log('  ok  ' + label);
  else { failures++; console.error('FAIL  ' + label); }
}

function executableTitleHandler() {
  const start = edge.indexOf('async function handleTitleOperation(');
  const end = edge.indexOf('\nasync function handleEntityOperation(', start);
  if (start < 0 || end < 0) throw new Error('handleTitleOperation source boundary missing');
  return edge.slice(start, end)
    .replace(
      /async function handleTitleOperation\([\s\S]*?\): Promise<Response> \{/,
      'async function handleTitleOperation(supabase, req, body, surface, requestId, sourceEditedAt) {',
    )
    .replace(/: JsonMap \| null/g, '')
    .replace(/: JsonMap\[\]/g, '')
    .replace(/: JsonMap/g, '')
    .replace(/ as JsonMap\[\]/g, '')
    .replace(/ as JsonMap/g, '')
    .replace(/new Map<string, JsonMap>\(\)/g, 'new Map()');
}

class GatewayError extends Error {
  constructor(status, code, details = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const clean = value => String(value == null ? '' : value).trim();
const lower = value => clean(value).toLowerCase();
const parseJson = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) { return {}; }
};
const canonicalTitle = value => clean(value).replace(/\s+/g, ' ');
const normalizeTeam = value => {
  const team = lower(value);
  return team === 'video' || team === 'graphics' ? team : '';
};
const sameInstant = (left, right) => {
  const leftMs = Date.parse(clean(left));
  const rightMs = Date.parse(clean(right));
  return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
};
const exactF133RepairEnvelope = (observed, expected) => {
  const parsed = parseJson(observed);
  return expected == null
    ? Object.keys(parsed).length === 0
    : JSON.stringify(parsed) === JSON.stringify(expected);
};

function createSupabase(resolveQuery) {
  return {
    from(table) {
      const state = { table, filters: [], mode: 'many' };
      const builder = {
        select() { return builder; },
        eq(column, value) { state.filters.push(['eq', column, value]); return builder; },
        in(column, values) { state.filters.push(['in', column, values]); return builder; },
        maybeSingle() { state.mode = 'single'; return Promise.resolve(resolveQuery(state)); },
        then(onFulfilled, onRejected) {
          return Promise.resolve(resolveQuery(state)).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

const SOURCE_EDITED_AT = '2026-08-03T10:00:00.000Z';
const COMMITTED_AT = '2026-08-03T10:00:01.000Z';
const EVENT_KEY = 'write-ui:title:card:calendar:fixture:card-1:req-1';
const PRINCIPAL = {
  kind: 'staff', keyRole: 'admin', actorName: 'Sydney', actorRole: 'admin',
  actorKey: 'staff-1', testOnly: false,
};
const CARD = {
  id: 'card-1', client: 'fixture', name: 'Original title', title_revision: 0,
  video_deliverable_id: 'video-1', graphic_deliverable_id: 'graphic-1',
};
const DELIVERABLES = [
  {
    id: 'video-1', client_slug: 'fixture', batch_id: 'batch-1', origin: 'calendar',
    card_id: 'card-1', team: 'video', kind: 'video', title: 'Original title',
    updated_at: '2026-08-03T09:00:00.000Z',
  },
  {
    id: 'graphic-1', client_slug: 'fixture', batch_id: 'batch-1', origin: 'calendar',
    card_id: 'card-1', team: 'graphics', kind: 'thumbnail', title: 'Original title',
    updated_at: '2026-08-03T09:00:00.000Z',
  },
];
const BODY = {
  client_slug: 'fixture', card_id: 'card-1', title: 'Revised title',
  expected_title: 'Original title', expected_title_revision: 0,
};

function dedupKey(_operation, _entity, id, requestId) {
  return `title:deliverable:${id}:${requestId}`;
}

function freshFixture(storedExpectedOverrides = null) {
  const expectedTitles = {
    'graphic-1': 'Original title',
    'video-1': 'Original title',
    ...(storedExpectedOverrides || {}),
  };
  const rows = DELIVERABLES.map(row => ({
    ...row, title: 'Revised title', updated_at: COMMITTED_AT,
  }));
  const outboxes = rows.map((row, index) => ({
    id: 101 + index,
    entity: 'deliverable', entity_id: row.id, deliverable_id: row.id, comment_id: null,
    operation: 'title', client_slug: 'fixture', team: row.team, batch_id: 'batch-1',
    depends_on_id: null, actor: 'Sydney', role: 'admin',
    dedup_key: dedupKey('title', 'deliverable', row.id, 'req-1'),
    source_edited_at: COMMITTED_AT, test_only: false, legacy_parity: false,
    authority_generation: 0, status: 'pending',
    payload: { title: 'Revised title', _intent_fingerprint: `fingerprint-${row.team}` },
  }));
  const event = {
    id: 201, event_key: EVENT_KEY, deliverable_id: null, action: 'title_change',
    client_slug: 'fixture', batch_id: 'batch-1', ts: COMMITTED_AT, source: 'ui',
    actor: 'Sydney', role: 'admin',
    payload: {
      surface: 'calendar', card_id: 'card-1', actor_key: 'staff-1', auth_kind: 'staff',
      client_edited_at: SOURCE_EDITED_AT, from_title: 'Original title',
      from_title_revision: 0, title: 'Revised title', title_revision: 1,
      deliverable_count: 2, outbox_count: 2,
      expected_deliverable_titles: expectedTitles,
    },
  };
  const written = {
    card: { ...CARD, name: 'Revised title', title_revision: 1, updated_at: COMMITTED_AT },
    rows, outbox_ids: [101, 102], event_id: 201, event_key: EVENT_KEY,
    committed_at: COMMITTED_AT, replayed: false, superseded: false, noop: false,
  };
  return { rows, outboxes, event, written };
}

function replayFixture() {
  const priorEvent = {
    id: 201, event_key: EVENT_KEY, deliverable_id: null, action: 'title_change',
    client_slug: 'fixture', batch_id: 'batch-1', ts: COMMITTED_AT, source: 'ui',
    actor: 'Sydney', role: 'admin',
    payload: {
      surface: 'calendar', card_id: 'card-1', actor_key: 'staff-1', auth_kind: 'staff',
      client_edited_at: SOURCE_EDITED_AT, from_title: 'Original title',
      from_title_revision: 0, title: 'Revised title', title_revision: 1,
      deliverable_count: 2, outbox_count: 2,
      expected_deliverable_titles: {
        'graphic-1': 'Original title', 'video-1': 'Original title',
      },
    },
  };
  const outboxes = DELIVERABLES.map((row, index) => ({
    id: 101 + index,
    entity: 'deliverable', entity_id: row.id, deliverable_id: row.id, comment_id: null,
    operation: 'title', client_slug: 'fixture', team: row.team, batch_id: 'batch-1',
    depends_on_id: null, actor: 'Sydney', role: 'admin',
    dedup_key: dedupKey('title', 'deliverable', row.id, 'req-1'),
    source_edited_at: COMMITTED_AT, test_only: false, legacy_parity: false,
    authority_generation: 0, status: 'pending',
    payload: {
      title: row.team === 'graphics' ? 'Wrong replay title' : 'Revised title',
      _intent_fingerprint: `fingerprint-${row.team}`,
    },
  }));
  return { priorEvent, outboxes };
}

function makeContext({ priorEvent = null, storedExpectedOverrides = null, replayOutboxes = null } = {}) {
  const fresh = freshFixture(storedExpectedOverrides);
  const rpcCalls = [];
  const resolveQuery = state => {
    const filter = column => state.filters.find(row => row[1] === column);
    if (state.table === 'deliverable_events' && filter('event_key')) {
      return { data: priorEvent, error: null };
    }
    if (state.table === 'deliverable_events' && filter('id')) {
      return { data: fresh.event, error: null };
    }
    if (state.table === 'calendar_posts') return { data: CARD, error: null };
    if (state.table === 'deliverables') return { data: DELIVERABLES, error: null };
    if (state.table === 'mirror_outbox' && filter('dedup_key')) {
      return { data: replayOutboxes || [], error: null };
    }
    if (state.table === 'mirror_outbox' && filter('id')) {
      return { data: fresh.outboxes, error: null };
    }
    throw new Error(`unexpected query ${state.table} ${JSON.stringify(state.filters)}`);
  };
  const context = {
    GatewayError,
    clean,
    lower,
    parseJson,
    canonicalTitle,
    normalizeTeam,
    sameInstant,
    exactF133RepairEnvelope,
    genericTitlePlaceholder: () => false,
    authenticate: async () => PRINCIPAL,
    sha256Hex: async () => '0'.repeat(64),
    serviceRoleRequest: async () => false,
    f133CanonicalTitleFlagState: async () => 'enabled',
    assertTitlePrincipalAllowed: async () => {},
    assertDeliverableIdentityWritable: async () => {},
    dedupKey,
    authorityFor: async () => 'syncview',
    authorityLane: () => false,
    assertLegacyParityEnabled: async () => {},
    f27WriteAuthorizationGeneration: async () => 0,
    intentFingerprint: async ({ team }) => `fingerprint-${team}`,
    f27FencedPayload: (payload, generation, legacyParity) => ({
      ...payload,
      _f27_authority_generation: generation,
      _f27_legacy_parity: legacyParity,
    }),
    publicRow: row => ({ ...row }),
    json: (body, status = 200) => ({ body, status }),
    rpc: async (_supabase, name) => {
      rpcCalls.push(name);
      if (priorEvent) throw new GatewayError(500, 'replay_title_guard_bypassed');
      if (name === 'production_canonical_title_write') return fresh.written;
      if (name === 'production_canonical_title_dependency_valid') return true;
      throw new Error(`unexpected rpc ${name}`);
    },
    Map,
    Set,
    Object,
    Array,
    Number,
    String,
    JSON,
    Date,
    Promise,
  };
  vm.createContext(context);
  vm.runInContext(executableTitleHandler(), context);
  return {
    handle: context.handleTitleOperation,
    supabase: createSupabase(resolveQuery),
    rpcCalls,
  };
}

async function run(harness) {
  try {
    const value = await harness.handle(
      harness.supabase, {}, BODY, 'calendar', 'req-1', SOURCE_EDITED_AT,
    );
    return { value, code: '' };
  } catch (error) {
    return { value: null, code: clean(error && (error.code || error.message)) };
  }
}

(async () => {
  const valid = await run(makeContext());
  ok(valid.code === '' && valid.value && valid.value.status === 201
    && valid.value.body && valid.value.body.native_committed === true,
  'the actual title handler accepts an exact fresh commit and its durable receipts');

  const foreignKey = await run(makeContext({
    // Empty is deliberate: if expectedTitleKeys is derived from storedExpected,
    // the later value comparator sees "" on both sides and cannot rescue the
    // exact-key-set guard.
    storedExpectedOverrides: { 'foreign-deliverable': '' },
  }));
  ok(foreignKey.code === 'canonical_title_receipt_invalid',
    'the actual title handler rejects a receipt with an extra expected-deliverable-title key');

  const wrongExpectedTitle = await run(makeContext({
    storedExpectedOverrides: { 'graphic-1': 'Wrong expected title' },
  }));
  ok(wrongExpectedTitle.code === 'canonical_title_receipt_invalid',
    'the actual title handler rejects a receipt whose expected deliverable title changed');

  const replay = replayFixture();
  const replayHarness = makeContext({
    priorEvent: replay.priorEvent,
    replayOutboxes: replay.outboxes,
  });
  const replayResult = await run(replayHarness);
  ok(replayResult.code === 'idempotency_conflict' && replayHarness.rpcCalls.length === 0,
    'the actual title handler rejects a replay outbox with a different title before any RPC');

  if (failures) {
    console.error(`\n${failures} F133 title-operation execution check(s) failed.`);
    process.exit(1);
  }
  console.log('\nF133 title-operation execution checks passed.');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
