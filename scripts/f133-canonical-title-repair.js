#!/usr/bin/env node
'use strict';

/*
 * F133 canonical-title inventory, repair, and verification operator.
 *
 * This is deliberately not a general backfill. `plan` takes one
 * REPEATABLE-READ / READ-ONLY database snapshot, independently reads every
 * referenced Linear issue, and accepts only two exact title states:
 *
 *   - exact_converged
 *   - exact_f133_generated_split
 *
 * The second state is source-derived. The old v3 intake creator generated the
 * exact string `Video N` for BOTH Video and Graphics, where N is the canonical
 * numeric suffix of its `p_native_<request>_<N>` card id. The create event,
 * create outbox row, provider receipt, stored provider projection, and a fresh
 * Linear read must all bind that same value and initial provider clock. A
 * regex-shaped title alone is never eligible, and `Graphic N` is never an
 * accepted historical value.
 *
 * Full manifests and apply journals are private. Stdout/stderr are restricted
 * to status, enums, counts, byte lengths, and hashes.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const CONTRACT = 'syncview-f133-canonical-title-repair/v1';
const HASH_RE = /^[a-f0-9]{64}$/;
const SHA_RE = /^[a-f0-9]{40}$/;
const TERMINAL = new Set(['written', 'skipped', 'stale']);
const OPEN = new Set(['pending', 'failed', 'shadow_ok']);
const CONFIRMATIONS = Object.freeze({
  plan: 'PLAN_F133_CANONICAL_TITLE_REPAIR',
  apply: 'APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR',
  verify: 'VERIFY_F133_CANONICAL_TITLE_REPAIR',
});

class F133OperatorError extends Error {
  constructor(code) {
    super(code);
    this.name = 'F133OperatorError';
    this.code = code;
  }
}

function fail(code) { throw new F133OperatorError(code); }
function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function canonicalTitle(value) {
  return clean(value).replace(/\s+/g, ' ');
}
function genericTitlePlaceholder(value) {
  return /^(?:video|graphics?)\s+[0-9]+$/i.test(canonicalTitle(value));
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value === undefined ? null : value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}
function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(stable(value))}\n`, 'utf8');
}
function sha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : canonicalBytes(value);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
function sha256Text(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}
function repairRequestId(identitySha256, planDigest) {
  if (!HASH_RE.test(clean(identitySha256)) || !HASH_RE.test(clean(planDigest))) {
    fail('REVIEWED_INVENTORY_MISMATCH');
  }
  return `f133-title-repair:${sha256Text(`${identitySha256}:${planDigest}`).slice(0, 32)}`;
}
function repairIdentitySha256(surface, clientSlug, cardId) {
  return sha256Text(`${clean(surface)}\0${clean(clientSlug)}\0${clean(cardId)}`);
}
function sameInstant(a, b) {
  const left = Date.parse(clean(a));
  const right = Date.parse(clean(b));
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}
function jsonObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function array(value) { return Array.isArray(value) ? value : []; }

// This is intentionally a single SQL command. `psql -qAt` returns only the
// final JSON document; BEGIN/COMMIT never enter the private manifest.
const CAPTURE_SQL = String.raw`
begin isolation level repeatable read read only;
with
cards as materialized (
  select 'calendar'::text surface, 'calendar'::text origin,
         c.client::text client_slug, c.id::text card_id, c.name::text title,
         c.updated_at::text updated_at, c.title_revision::bigint title_revision,
         nullif(btrim(c.video_deliverable_id), '')::text video_deliverable_id,
         nullif(btrim(c.graphic_deliverable_id), '')::text graphic_deliverable_id
  from public.calendar_posts c
  where nullif(btrim(c.video_deliverable_id), '') is not null
     or nullif(btrim(c.graphic_deliverable_id), '') is not null
  union all
  select 'sxr'::text, 'samples'::text,
         c.client::text, c.id::text, c.name::text, c.updated_at::text,
         c.title_revision::bigint,
         nullif(btrim(c.video_deliverable_id), '')::text,
         nullif(btrim(c.graphic_deliverable_id), '')::text
  from public.sample_reviews c
  where nullif(btrim(c.video_deliverable_id), '') is not null
     or nullif(btrim(c.graphic_deliverable_id), '') is not null
),
linked_deliverables as materialized (
  select d.id, d.batch_id, d.client_slug, d.team, d.kind, d.title, d.origin,
         d.card_id, d.sort_key, d.created_by, d.created_at, d.updated_at,
         d.linear_issue_uuid, d.linear_identifier, d.linear_issue_url,
         jsonb_build_object(
           'issue', d.linear_raw->'issue',
           'field_updated_at', jsonb_strip_nulls(jsonb_build_object(
             'title', d.linear_raw->'field_updated_at'->>'title'
           ))
         ) linear_raw
  from public.deliverables d
  where d.origin in ('calendar', 'samples')
    and nullif(btrim(d.card_id), '') is not null
),
linked_ids as materialized (select id from linked_deliverables),
linked_batches as materialized (select distinct batch_id from linked_deliverables),
events as materialized (
  select e.id, e.event_key, e.deliverable_id, e.batch_id, e.client_slug,
         e.ts, e.actor, e.role, e.action, e.from_status, e.to_status, e.source,
         jsonb_strip_nulls(jsonb_build_object(
           'surface', e.payload->>'surface',
           'card_id', e.payload->>'card_id',
           'from_title', e.payload->>'from_title',
           'title', e.payload->>'title',
           'client_edited_at', e.payload->>'client_edited_at',
           'expected_deliverable_titles', e.payload->'expected_deliverable_titles',
           'actor_key', e.payload->>'actor_key',
           'auth_kind', e.payload->>'auth_kind',
           'deliverable_count', e.payload->'deliverable_count',
           'outbox_count', e.payload->'outbox_count',
           'outbound', case when jsonb_typeof(e.payload->'outbound') = 'object' then
             jsonb_strip_nulls(jsonb_build_object(
               'entity', e.payload->'outbound'->>'entity',
               'entity_id', e.payload->'outbound'->>'entity_id',
               'team', e.payload->'outbound'->>'team',
               'operation', e.payload->'outbound'->>'operation',
               'dedup_key', e.payload->'outbound'->>'dedup_key',
               'source_edited_at', e.payload->'outbound'->>'source_edited_at',
               'test_only', e.payload->'outbound'->'test_only',
               'legacy_parity', e.payload->'outbound'->'legacy_parity',
               'payload', jsonb_strip_nulls(jsonb_build_object(
                 'title', e.payload->'outbound'->'payload'->>'title',
                 'team_id', e.payload->'outbound'->'payload'->>'team_id',
                 'project_id', e.payload->'outbound'->'payload'->>'project_id',
                 '_intent_fingerprint', e.payload->'outbound'->'payload'->>'_intent_fingerprint'
               ))
             )) else null end
         )) payload
  from public.deliverable_events e
  where e.deliverable_id in (select id from linked_ids)
     or (e.batch_id in (select batch_id from linked_batches)
         and e.action in ('create', 'title_change'))
),
outbox as materialized (
  select o.id, o.entity, o.entity_id, o.deliverable_id, o.batch_id,
         o.comment_id, o.operation, o.op, o.client_slug, o.team,
         o.dedup_key, o.source_edited_at, o.actor, o.role, o.status,
         o.depends_on_id, o.test_only, o.legacy_parity,
         o.authority_generation, o.attempts, o.processed_at,
         jsonb_strip_nulls(jsonb_build_object(
           'title', o.payload->>'title',
           'team_id', o.payload->>'team_id',
           'project_id', o.payload->>'project_id',
           '_intent_fingerprint', o.payload->>'_intent_fingerprint'
         )) payload,
         jsonb_strip_nulls(jsonb_build_object(
           'mutation', o.linear_result->>'mutation',
           'issue_id', o.linear_result->>'issue_id',
           'identifier', o.linear_result->>'identifier',
           'updated_at', o.linear_result->>'updated_at',
           'mirror_actor_id', o.linear_result->>'mirror_actor_id',
           'expected', jsonb_strip_nulls(jsonb_build_object(
             'id', o.linear_result->'expected'->>'id',
             'input', jsonb_strip_nulls(jsonb_build_object(
               'title', o.linear_result->'expected'->'input'->>'title'
             ))
           )),
           'conflict', o.linear_result->'conflict'
         )) linear_result
  from public.mirror_outbox o
  where o.entity_id in (select id from linked_ids)
     or o.deliverable_id in (select id from linked_ids)
),
flags as materialized (
  select coalesce(jsonb_object_agg(f.key, f.value order by f.key), '{}'::jsonb) value
  from public.syncview_runtime_flags f
  where f.key in ('prod_authority', 'linear_outbound_enabled',
                  'linear_legacy_parity_enabled', 'linear_inbound_enabled',
                  'auth_enforcement', 'f133_canonical_title_enabled')
),
prerequisites as materialized (
  select jsonb_build_object(
    'canonical_title_write_present',
      to_regprocedure('public.production_canonical_title_write(jsonb,jsonb)') is not null,
    'dependency_valid_present',
      to_regprocedure('public.production_canonical_title_dependency_valid(bigint)') is not null,
    'binder_adopt_present',
      to_regprocedure('public.production_canonical_title_binder_adopt(jsonb)') is not null,
    'service_role_execute_only', coalesce((
      select bool_or(r.rolname = 'service_role' and x.privilege_type = 'EXECUTE')
         and bool_and(x.grantee in (p.proowner, sr.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_roles sr on sr.rolname = 'service_role'
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      left join pg_roles r on r.oid = x.grantee
      where n.nspname = 'public' and p.proname = 'production_canonical_title_write'
        and p.oid = to_regprocedure('public.production_canonical_title_write(jsonb,jsonb)')
    ), false),
    'calendar_guard_present', exists (
      select 1 from pg_trigger where tgrelid = 'public.calendar_posts'::regclass
        and tgname = 'production_canonical_title_guard_before' and not tgisinternal
    ),
    'samples_guard_present', exists (
      select 1 from pg_trigger where tgrelid = 'public.sample_reviews'::regclass
        and tgname = 'production_canonical_title_guard_before' and not tgisinternal
    ),
    'deliverable_guard_present', exists (
      select 1 from pg_trigger where tgrelid = 'public.deliverables'::regclass
        and tgname = 'production_canonical_title_deliverable_guard_before' and not tgisinternal
    ),
    'cas_guard_present', exists (
      select 1 from pg_trigger where tgrelid = 'public.deliverables'::regclass
        and tgname = 'zz_production_canonical_title_cas_before' and not tgisinternal
    ),
    'title_revision_contract_present', (
      select count(*) = 2
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name in ('calendar_posts', 'sample_reviews')
        and c.column_name = 'title_revision'
        and c.data_type = 'bigint' and c.is_nullable = 'NO'
        and c.column_default = '0'
    ) and (
      select count(*) = 2
      from pg_constraint con
      where con.conname in (
          'calendar_posts_title_revision_nonnegative',
          'sample_reviews_title_revision_nonnegative'
        )
        and pg_get_constraintdef(con.oid, true) = 'CHECK (title_revision >= 0)'
    )
  ) value
)
select jsonb_build_object(
  'contract', '${CONTRACT}',
  'captured_at', transaction_timestamp(),
  'transaction', jsonb_build_object(
    'isolation', current_setting('transaction_isolation'),
    'read_only', current_setting('transaction_read_only')
  ),
  'cards', coalesce((select jsonb_agg(to_jsonb(c) order by c.origin,c.client_slug,c.card_id) from cards c), '[]'::jsonb),
  'deliverables', coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from linked_deliverables d), '[]'::jsonb),
  'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from events e), '[]'::jsonb),
  'outbox', coalesce((select jsonb_agg(to_jsonb(o) order by o.id) from outbox o), '[]'::jsonb),
  'clients', coalesce((
    select jsonb_agg(jsonb_build_object('slug', c.slug, 'active', c.active, 'kind', c.kind) order by c.slug)
    from public.clients c where c.slug in (select distinct client_slug from linked_deliverables)
  ), '[]'::jsonb),
  'flags', (select value from flags),
  'prerequisites', (select value from prerequisites)
);
commit;`;

function runPsqlCapture(databaseUrl, deps = {}) {
  if (!clean(databaseUrl)) fail('PRIVATE_DATABASE_URL_REQUIRED');
  const execPsql = deps.execPsql || ((url, sql) => spawnSync('psql', [
    '--no-psqlrc', '--quiet', '--tuples-only', '--no-align',
    '--set=ON_ERROR_STOP=1', url, '--command', sql,
  ], {
    encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PGAPPNAME: 'syncview-f133-title-repair' },
  }));
  const result = execPsql(databaseUrl, CAPTURE_SQL);
  if (!result || result.status !== 0) fail('PRIVATE_DATABASE_CAPTURE_FAILED');
  let snapshot;
  try { snapshot = JSON.parse(clean(result.stdout)); } catch (_) { fail('PRIVATE_DATABASE_CAPTURE_INVALID'); }
  if (snapshot.contract !== CONTRACT
      || lower(jsonObject(snapshot.transaction).isolation) !== 'repeatable read'
      || String(jsonObject(snapshot.transaction).read_only) !== 'on') {
    fail('PRIVATE_DATABASE_CAPTURE_INVALID');
  }
  return snapshot;
}

async function linearGraphql(linearKey, query, variables, fetchImpl, deps = {}) {
  if (!clean(linearKey)) fail('LINEAR_CREDENTIAL_REQUIRED');
  const sleepImpl = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response;
    try {
      response = await fetchImpl('https://api.linear.app/graphql', {
        method: 'POST',
        headers: { authorization: linearKey, 'content-type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
    } catch (_) {
      if (attempt < 3) { await sleepImpl(500 * (2 ** (attempt - 1))); continue; }
      fail('LINEAR_READ_FAILED');
    }
    let body;
    try { body = await response.json(); } catch (_) { body = null; }
    if (response.ok && body && !array(body.errors).length) {
      return jsonObject(body.data);
    }
    if (attempt < 3 && (Number(response.status) === 429 || Number(response.status) >= 500)) {
      await sleepImpl(500 * (2 ** (attempt - 1)));
      continue;
    }
    fail('LINEAR_READ_FAILED');
  }
  fail('LINEAR_READ_FAILED');
}

async function fetchLinearIssues(snapshot, linearKey, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE');
  const ids = [...new Set(array(snapshot.deliverables).map(row => clean(
    row && (row.linear_issue_uuid || jsonObject(jsonObject(row.linear_raw).issue).id),
  )).filter(Boolean))].sort();
  const issues = [];
  const chunkSize = 35;
  const pageDelayMs = deps.pageDelayMs == null ? 120 : Number(deps.pageDelayMs);
  const sleepImpl = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const fields = 'id identifier title updatedAt url team { id } project { id }';
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const aliases = chunk.map((id, index) =>
      `i${index}: issue(id: ${JSON.stringify(id)}) { ${fields} }`
    ).join('\n');
    const data = await linearGraphql(
      linearKey,
      `query F133CanonicalTitleIssues { ${aliases} }`,
      {},
      fetchImpl,
      { sleep: sleepImpl },
    );
    const expectedAliases = new Set(chunk.map((_id, index) => `i${index}`));
    if (Object.keys(data).some(key => !expectedAliases.has(key))) fail('LINEAR_IDENTITY_READ_FAILED');
    chunk.forEach((id, index) => {
      const issue = data[`i${index}`];
      if (!issue || clean(issue.id) !== id) fail('LINEAR_IDENTITY_READ_FAILED');
      issues.push(issue);
    });
    if (offset + chunkSize < ids.length && pageDelayMs > 0) await sleepImpl(pageDelayMs);
  }
  if (issues.length !== ids.length
      || new Set(issues.map(issue => clean(issue.id))).size !== ids.length) {
    fail('LINEAR_IDENTITY_READ_FAILED');
  }
  return issues;
}

function cardKey(surface, clientSlug, cardId) {
  return `${clean(surface)}\u0000${clean(clientSlug)}\u0000${clean(cardId)}`;
}
function placeholderForCard(card) {
  const id = clean(card && card.card_id);
  const match = /^p_native_([a-z0-9]{1,28})_([1-9][0-9]*)$/.exec(id);
  if (!match) return '';
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1 || String(number) !== match[2]) return '';
  return `Video ${number}`;
}
function reducedIssue(value) {
  const issue = jsonObject(value);
  return {
    id: clean(issue.id), identifier: clean(issue.identifier),
    title: String(issue.title == null ? '' : issue.title),
    updatedAt: clean(issue.updatedAt), url: clean(issue.url),
  };
}

function issueBinding(row, indexes, wantedTitle, requireBinder = true) {
  const stored = reducedIssue(jsonObject(jsonObject(row.linear_raw).issue));
  const uuid = clean(row.linear_issue_uuid);
  const identifier = clean(row.linear_identifier);
  const url = clean(row.linear_issue_url);
  const live = reducedIssue(indexes.issues.get(uuid));
  const titleClock = clean(jsonObject(jsonObject(row.linear_raw).field_updated_at).title);
  const titleClockMs = Date.parse(titleClock);
  const liveMs = Date.parse(live.updatedAt);
  const completeIdentity = !!uuid && !!identifier && !!url
    && stored.id === uuid && live.id === uuid
    && stored.identifier === identifier && live.identifier === identifier
    && stored.url === url && live.url === url;
  const exactTitle = String(row.title || '') === wantedTitle
    && stored.title === wantedTitle && live.title === wantedTitle;
  const providerClockExact = Number.isFinite(liveMs)
    && sameInstant(stored.updatedAt, live.updatedAt);
  const binderExact = Number.isFinite(titleClockMs) && Number.isFinite(liveMs)
    && titleClockMs <= liveMs;
  return {
    ok: completeIdentity && exactTitle && providerClockExact && (!requireBinder || binderExact),
    completeIdentity, exactTitle, providerClockExact, binderExact,
    titleClock, stored, live,
  };
}

function inventoryIndexes(snapshot, linearIssues) {
  const cards = new Map();
  const deliverables = new Map();
  const reverse = new Map();
  const eventsByDeliverable = new Map();
  const eventsByBatch = new Map();
  const outboxByDeliverable = new Map();
  const issues = new Map(array(linearIssues).map(issue => [clean(issue.id), issue]));
  const clients = new Map(array(snapshot.clients).map(row => [clean(row.slug), row]));
  for (const card of array(snapshot.cards)) {
    cards.set(cardKey(card.surface, card.client_slug, card.card_id), card);
  }
  for (const row of array(snapshot.deliverables)) {
    deliverables.set(clean(row.id), row);
    const surface = clean(row.origin) === 'samples' ? 'sxr' : 'calendar';
    const key = cardKey(surface, row.client_slug, row.card_id);
    if (!reverse.has(key)) reverse.set(key, []);
    reverse.get(key).push(row);
  }
  for (const event of array(snapshot.events)) {
    const id = clean(event.deliverable_id);
    const batch = clean(event.batch_id);
    if (id) {
      if (!eventsByDeliverable.has(id)) eventsByDeliverable.set(id, []);
      eventsByDeliverable.get(id).push(event);
    }
    if (batch) {
      if (!eventsByBatch.has(batch)) eventsByBatch.set(batch, []);
      eventsByBatch.get(batch).push(event);
    }
  }
  for (const row of array(snapshot.outbox)) {
    const id = clean(row.deliverable_id || row.entity_id);
    if (!id) continue;
    if (!outboxByDeliverable.has(id)) outboxByDeliverable.set(id, []);
    outboxByDeliverable.get(id).push(row);
  }
  return { cards, deliverables, reverse, eventsByDeliverable, eventsByBatch, outboxByDeliverable, issues, clients };
}

function exactCreateProof(row, wantedTitle, indexes) {
  const id = clean(row.id);
  const events = array(indexes.eventsByDeliverable.get(id)).filter(event => lower(event.action) === 'create');
  if (events.length !== 1) return { ok: false, reason: 'create_event_not_exact' };
  const event = events[0];
  const payload = jsonObject(event.payload);
  const outbound = jsonObject(payload.outbound);
  const outboundPayload = jsonObject(outbound.payload);
  if (clean(event.source) !== 'ui' || clean(outbound.entity) !== 'deliverable'
      || clean(outbound.entity_id) !== id || clean(outbound.team) !== clean(row.team)
      || clean(outbound.operation) !== 'create' || String(outboundPayload.title || '') !== wantedTitle
      || !clean(outboundPayload._intent_fingerprint)
      || !sameInstant(outbound.source_edited_at, event.ts)) {
    return { ok: false, reason: 'create_event_contract_mismatch' };
  }
  const createRows = array(indexes.outboxByDeliverable.get(id))
    .filter(outbox => lower(outbox.operation) === 'create');
  if (createRows.length !== 1) return { ok: false, reason: 'create_outbox_not_exact' };
  const outbox = createRows[0];
  const outboxPayload = jsonObject(outbox.payload);
  const result = jsonObject(outbox.linear_result);
  const expected = jsonObject(result.expected);
  const expectedInput = jsonObject(expected.input);
  const binding = issueBinding(row, indexes, wantedTitle, false);
  const storedIssue = binding.stored;
  const issueId = clean(row.linear_issue_uuid);
  const live = binding.live;
  const receiptClock = Date.parse(clean(result.updated_at));
  const liveClock = Date.parse(live.updatedAt);
  const titleClock = Date.parse(binding.titleClock);
  const providerClockSafe = sameInstant(live.updatedAt, result.updated_at)
    || (binding.binderExact && Number.isFinite(titleClock)
      && titleClock === receiptClock && liveClock >= titleClock);
  if (clean(outbox.dedup_key) !== clean(outbound.dedup_key)
      || clean(outbox.entity) !== 'deliverable' || clean(outbox.entity_id) !== id
      || clean(outbox.deliverable_id) !== id || clean(outbox.batch_id) !== clean(row.batch_id)
      || clean(outbox.client_slug) !== clean(row.client_slug) || clean(outbox.team) !== clean(row.team)
      || lower(outbox.status) !== 'written' || outbox.test_only !== false
      || String(outboxPayload.title || '') !== wantedTitle
      || clean(outboxPayload._intent_fingerprint) !== clean(outboundPayload._intent_fingerprint)
      || clean(result.mutation) !== 'issueCreate' || !issueId
      || clean(result.issue_id) !== issueId || !clean(result.mirror_actor_id)
      || !Number.isFinite(receiptClock)
      || String(expectedInput.title || '') !== wantedTitle
      || !binding.completeIdentity || !binding.exactTitle || !binding.providerClockExact
      || storedIssue.id !== issueId || live.id !== issueId
      || !providerClockSafe) {
    return { ok: false, reason: 'create_receipt_provider_mismatch' };
  }
  return {
    ok: true,
    evidence: {
      event_id: Number(event.id), outbox_id: Number(outbox.id),
      dedup_key: clean(outbox.dedup_key), source_at: clean(event.ts),
      provider_updated_at: clean(result.updated_at), issue_id: issueId,
    },
  };
}

function exactLinkage(card, rows) {
  if (!card || rows.length < 1 || rows.length > 2) return false;
  const ids = rows.map(row => clean(row.id));
  if (new Set(ids).size !== rows.length) return false;
  const expectedIds = [clean(card.video_deliverable_id), clean(card.graphic_deliverable_id)].filter(Boolean);
  if (expectedIds.length !== rows.length || expectedIds.some(id => !ids.includes(id))) return false;
  const batches = new Set(rows.map(row => clean(row.batch_id)).filter(Boolean));
  if (batches.size !== 1) return false;
  return rows.every(row => clean(row.client_slug) === clean(card.client_slug)
    && clean(row.origin) === clean(card.origin) && clean(row.card_id) === clean(card.card_id)
    && ((clean(row.team) === 'video' && clean(row.kind) === 'video'
      && clean(card.video_deliverable_id) === clean(row.id))
      || (clean(row.team) === 'graphics' && clean(row.kind) === 'thumbnail'
        && clean(card.graphic_deliverable_id) === clean(row.id))));
}

function titleHistoryAbsent(row, indexes) {
  const events = array(indexes.eventsByDeliverable.get(clean(row.id)));
  const batchEvents = array(indexes.eventsByBatch.get(clean(row.batch_id)));
  const titleEvents = [...events, ...batchEvents].filter(event => lower(event.action) === 'title_change');
  const titleOutbox = array(indexes.outboxByDeliverable.get(clean(row.id)))
    .filter(outbox => lower(outbox.operation) === 'title');
  return titleEvents.length === 0 && titleOutbox.length === 0;
}

function cardEvidenceFingerprint(card, rows, indexes) {
  return sha256({
    card: {
      surface: card.surface, origin: card.origin, client_slug: card.client_slug,
      card_id: card.card_id, title: card.title, updated_at: card.updated_at,
      title_revision: card.title_revision,
      video_deliverable_id: card.video_deliverable_id,
      graphic_deliverable_id: card.graphic_deliverable_id,
    },
    rows: rows.map(row => ({
      id: row.id, batch_id: row.batch_id, client_slug: row.client_slug,
      team: row.team, kind: row.kind, title: row.title, origin: row.origin,
      card_id: row.card_id, created_at: row.created_at, updated_at: row.updated_at,
      linear_issue_uuid: row.linear_issue_uuid, linear_raw: row.linear_raw,
      events: indexes.eventsByDeliverable.get(clean(row.id)) || [],
      outbox: indexes.outboxByDeliverable.get(clean(row.id)) || [],
      live_issue: indexes.issues.get(clean(row.linear_issue_uuid
        || jsonObject(jsonObject(row.linear_raw).issue).id)) || null,
    })).sort((a, b) => clean(a.id).localeCompare(clean(b.id))),
  });
}

// Binder adoption may change only deliverables.updated_at and the title field
// clock. This companion fingerprint deliberately omits those two values so an
// ambiguous adoption response can be resumed without accepting any other
// database, outbox, card, stored-issue, or live-provider drift.
function cardBinderProgressFingerprint(card, rows, indexes) {
  return sha256({
    card: {
      surface: card.surface, origin: card.origin, client_slug: card.client_slug,
      card_id: card.card_id, title: card.title, updated_at: card.updated_at,
      title_revision: card.title_revision,
      video_deliverable_id: card.video_deliverable_id,
      graphic_deliverable_id: card.graphic_deliverable_id,
    },
    rows: rows.map(row => ({
      id: row.id, batch_id: row.batch_id, client_slug: row.client_slug,
      team: row.team, kind: row.kind, title: row.title, origin: row.origin,
      card_id: row.card_id, created_at: row.created_at,
      linear_issue_uuid: row.linear_issue_uuid, linear_identifier: row.linear_identifier,
      linear_issue_url: row.linear_issue_url,
      linear_issue: jsonObject(jsonObject(row.linear_raw).issue),
      events: indexes.eventsByDeliverable.get(clean(row.id)) || [],
      outbox: indexes.outboxByDeliverable.get(clean(row.id)) || [],
      live_issue: indexes.issues.get(clean(row.linear_issue_uuid
        || jsonObject(jsonObject(row.linear_raw).issue).id)) || null,
    })).sort((a, b) => clean(a.id).localeCompare(clean(b.id))),
  });
}

function binderAdoptionEvidence(row, proof, indexes, releaseSha) {
  const binding = issueBinding(row, indexes, String(row.title || ''), false);
  const provider = jsonObject(indexes.issues.get(clean(row.linear_issue_uuid)));
  const event = array(indexes.eventsByDeliverable.get(clean(row.id)))
    .find(value => Number(value.id) === Number(proof.event_id));
  const outbound = jsonObject(jsonObject(event && event.payload).outbound);
  const outbox = array(indexes.outboxByDeliverable.get(clean(row.id)))
    .find(value => Number(value.id) === Number(proof.outbox_id));
  const outboxPayload = jsonObject(outbox && outbox.payload);
  const core = {
    contract: 'syncview-f133-canonical-title-binder-adopt/v1',
    release_sha: releaseSha,
    deliverable: {
      id: clean(row.id), batch_id: clean(row.batch_id), client_slug: clean(row.client_slug),
      team: clean(row.team), kind: clean(row.kind), origin: clean(row.origin),
      card_id: clean(row.card_id), title: String(row.title || ''),
      created_by: clean(row.created_by), created_at: clean(row.created_at),
      expected_updated_at: clean(row.updated_at), linear_issue_uuid: clean(row.linear_issue_uuid),
      linear_identifier: clean(row.linear_identifier), linear_issue_url: clean(row.linear_issue_url),
      stored_issue: jsonObject(jsonObject(row.linear_raw).issue),
      stored_title_clock: binding.titleClock || null,
    },
    create: {
      event_id: Number(proof.event_id), event_ts: clean(event && event.ts),
      outbox_id: Number(proof.outbox_id), dedup_key: clean(proof.dedup_key),
      source_at: clean(proof.source_at),
      intent_fingerprint: clean(outboxPayload._intent_fingerprint
        || jsonObject(outbound.payload)._intent_fingerprint),
      provider_updated_at: clean(proof.provider_updated_at),
    },
    provider: {
      id: clean(provider.id), identifier: clean(provider.identifier),
      title: String(provider.title == null ? '' : provider.title),
      updated_at: clean(provider.updatedAt), url: clean(provider.url),
      team_id: clean(jsonObject(provider.team).id), project_id: clean(jsonObject(provider.project).id),
    },
  };
  return { ...core, evidence_sha256: sha256(core) };
}

function classifyCard(card, rows, indexes, releaseSha) {
  const identity = cardKey(card.surface, card.client_slug, card.card_id);
  const base = { identity, surface: card.surface, origin: card.origin, card_id: card.card_id };
  if (!exactLinkage(card, rows)) return { ...base, classification: 'blocked', reason: 'linkage_not_exact' };
  const client = indexes.clients.get(clean(card.client_slug));
  if (!client || client.active !== true || lower(client.kind) === 'test') {
    return { ...base, classification: 'blocked', reason: 'client_scope_not_exact' };
  }
  const title = canonicalTitle(card.title);
  const titleRevision = Number(card.title_revision);
  if (!title || title.length > 500 || genericTitlePlaceholder(title)
      || String(card.title || '') !== title
      || typeof card.title_revision !== 'number'
      || !Number.isSafeInteger(titleRevision) || titleRevision < 0) {
    return { ...base, classification: 'blocked', reason: 'card_title_not_canonical' };
  }
  const locallyAndProviderEqual = rows.every(row => issueBinding(row, indexes, title, false).ok);
  if (locallyAndProviderEqual) {
    const adoptions = [];
    for (const row of rows) {
      if (issueBinding(row, indexes, title, true).ok) continue;
      if (!titleHistoryAbsent(row, indexes)) {
        return { ...base, classification: 'blocked', reason: 'binder_history_ambiguous' };
      }
      const proof = exactCreateProof(row, title, indexes);
      if (!proof.ok) return { ...base, classification: 'blocked', reason: proof.reason };
      adoptions.push(binderAdoptionEvidence(row, proof.evidence, indexes, releaseSha));
    }
    if (!adoptions.length) return { ...base, classification: 'exact_converged', title };
    return {
      ...base, classification: 'exact_converged',
      title, batch_id: clean(rows[0].batch_id), client_slug: clean(card.client_slug),
      expected_title_revision: titleRevision,
      linked_deliverable_ids: rows.map(row => clean(row.id)).sort(),
      title_mutation_required: false,
      binder_adoption_required: adoptions,
      before_fingerprint: cardEvidenceFingerprint(card, rows, indexes),
      before_binder_progress_fingerprint: cardBinderProgressFingerprint(card, rows, indexes),
    };
  }

  const placeholder = placeholderForCard(card);
  if (!placeholder || title === placeholder) {
    return { ...base, classification: 'blocked', reason: 'non_source_derived_split' };
  }
  const mismatches = rows.filter(row => String(row.title || '') !== title);
  if (!mismatches.length || mismatches.some(row => String(row.title || '') !== placeholder)) {
    return { ...base, classification: 'blocked', reason: 'real_or_ambiguous_split' };
  }
  const cardClock = Date.parse(clean(card.updated_at));
  if (!Number.isFinite(cardClock)) {
    return { ...base, classification: 'blocked', reason: 'card_clock_invalid' };
  }
  const proofs = [];
  const binderAdoptions = [];
  for (const row of rows) {
    if (!titleHistoryAbsent(row, indexes)) {
      return { ...base, classification: 'blocked', reason: 'later_title_history_present' };
    }
    const expectedCreatedTitle = String(row.title || '');
    const proof = exactCreateProof(row, expectedCreatedTitle, indexes);
    if (!proof.ok) return { ...base, classification: 'blocked', reason: proof.reason };
    if (cardClock <= Date.parse(proof.evidence.provider_updated_at)
        || cardClock <= Date.parse(proof.evidence.source_at)) {
      return { ...base, classification: 'blocked', reason: 'card_not_later_than_create' };
    }
    proofs.push({ deliverable_id: clean(row.id), ...proof.evidence });
    if (!issueBinding(row, indexes, expectedCreatedTitle, true).ok) {
      binderAdoptions.push(binderAdoptionEvidence(row, proof.evidence, indexes, releaseSha));
    }
  }
  const expectedTitles = Object.fromEntries(rows.map(row => [clean(row.id), String(row.title || '')]));
  const sourceAt = new Date(cardClock).toISOString();
  return {
    ...base,
    classification: 'exact_f133_generated_split',
    title_mutation_required: true,
    binder_adoption_required: binderAdoptions,
    title,
    placeholder,
    batch_id: clean(rows[0].batch_id),
    client_slug: clean(card.client_slug),
    linked_deliverable_ids: rows.map(row => clean(row.id)).sort(),
    expected_deliverable_titles: expectedTitles,
    expected_title_revision: titleRevision,
    source_edited_at: sourceAt,
    create_proofs: proofs.sort((a, b) => a.deliverable_id.localeCompare(b.deliverable_id)),
    before_fingerprint: cardEvidenceFingerprint(card, rows, indexes),
    before_binder_progress_fingerprint: cardBinderProgressFingerprint(card, rows, indexes),
  };
}

function assertSnapshotPrerequisites(snapshot, operation) {
  const tx = jsonObject(snapshot.transaction);
  if (lower(tx.isolation) !== 'repeatable read' || String(tx.read_only) !== 'on') {
    fail('READ_ONLY_SNAPSHOT_REQUIRED');
  }
  if (operation === 'apply' || operation === 'verify') {
    const required = jsonObject(snapshot.prerequisites);
    if (!required.canonical_title_write_present || !required.dependency_valid_present
        || !required.binder_adopt_present
        || !required.service_role_execute_only || !required.calendar_guard_present
        || !required.samples_guard_present || !required.deliverable_guard_present
        || !required.cas_guard_present || !required.title_revision_contract_present) {
      fail('F133_PHASE_PREREQUISITE_MISSING');
    }
    const flags = jsonObject(snapshot.flags);
    if (JSON.stringify(stable(jsonObject(flags.prod_authority))) !== JSON.stringify({ graphics: 'linear', video: 'linear' })
        || JSON.stringify(stable(jsonObject(flags.linear_outbound_enabled))) !== JSON.stringify({ mode: 'off' })
        || JSON.stringify(stable(jsonObject(flags.linear_inbound_enabled))) !== JSON.stringify({ enabled: true })
        || JSON.stringify(stable(jsonObject(flags.auth_enforcement))) !== JSON.stringify({ mode: 'permissive' })
        || JSON.stringify(stable(jsonObject(flags.linear_legacy_parity_enabled))) !== JSON.stringify({ enabled: true })
        || JSON.stringify(stable(jsonObject(flags.f133_canonical_title_enabled))) !== JSON.stringify({ enabled: false })) {
      fail('F133_REPAIR_POSTURE_REQUIRED');
    }
  }
}

function planInventory(snapshot, linearIssues, releaseSha) {
  if (!SHA_RE.test(clean(releaseSha))) fail('RELEASE_SHA_REQUIRED');
  assertSnapshotPrerequisites(snapshot, 'plan');
  const indexes = inventoryIndexes(snapshot, linearIssues);
  const keys = [...new Set([...indexes.cards.keys(), ...indexes.reverse.keys()])].sort();
  const classifications = [];
  for (const key of keys) {
    const card = indexes.cards.get(key);
    const rows = array(indexes.reverse.get(key)).sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
    if (!card) {
      classifications.push({ identity: key, classification: 'blocked', reason: 'reverse_deliverable_without_card' });
      continue;
    }
    classifications.push(classifyCard(card, rows, indexes, releaseSha));
  }
  const repairs = classifications.filter(row => row.classification === 'exact_f133_generated_split'
    || array(row.binder_adoption_required).length > 0);
  const blocked = classifications.filter(row => row.classification === 'blocked');
  const identityDigest = sha256(keys);
  const unaffected = classifications.filter(row => row.classification === 'exact_converged'
      && array(row.binder_adoption_required).length === 0)
    .map(row => ({ identity: row.identity, title: row.title }));
  const planCore = {
    contract: CONTRACT,
    release_sha: releaseSha,
    universe_identity_sha256: identityDigest,
    unaffected_title_sha256: sha256(unaffected),
    repair_count: repairs.length,
    repairs: repairs.map(row => ({
      identity: row.identity, classification: row.classification,
      title_mutation_required: row.title_mutation_required === true,
      surface: row.surface, origin: row.origin,
      client_slug: row.client_slug, card_id: row.card_id, batch_id: row.batch_id,
      title: row.title, placeholder: row.placeholder,
      linked_deliverable_ids: row.linked_deliverable_ids,
      expected_deliverable_titles: row.expected_deliverable_titles,
      expected_title_revision: row.expected_title_revision,
      identity_sha256: repairIdentitySha256(row.surface, row.client_slug, row.card_id),
      source_edited_at: row.source_edited_at,
      create_proofs: row.create_proofs, before_fingerprint: row.before_fingerprint,
      before_binder_progress_fingerprint: row.before_binder_progress_fingerprint,
      binder_adoption_required: row.binder_adoption_required,
    })),
  };
  const planDigest = sha256(planCore);
  const boundRepairs = planCore.repairs.map(repair => ({
    ...repair,
    request_id: repairRequestId(repair.identity_sha256, planDigest),
  }));
  return {
    ...planCore,
    repairs: boundRepairs,
    plan_digest: planDigest,
    captured_at: snapshot.captured_at,
    status: blocked.length ? 'BLOCKED' : 'READY',
    counts: {
      universe: keys.length,
      exact_converged: classifications.filter(row => row.classification === 'exact_converged').length,
      exact_f133_generated_split: classifications.filter(row => row.classification === 'exact_f133_generated_split').length,
      blocked: blocked.length,
      title_mutation_actions: repairs.filter(row => row.title_mutation_required === true).length,
      binder_adoption_actions: repairs.reduce((sum, row) => sum + array(row.binder_adoption_required).length, 0),
    },
    blocked_reasons: Object.fromEntries([...new Set(blocked.map(row => row.reason))].sort()
      .map(reason => [reason, blocked.filter(row => row.reason === reason).length])),
    private_classifications: classifications,
  };
}

function publicPlanReceipt(manifest, bytes) {
  return {
    status: manifest.status,
    operation: 'plan',
    contract: CONTRACT,
    release_sha: manifest.release_sha,
    plan_digest: manifest.plan_digest,
    inventory_sha256: sha256(bytes),
    byte_length: bytes.length,
    counts: manifest.counts,
    blocked_reasons: manifest.blocked_reasons,
  };
}

function assertManifest(manifest, releaseSha, expectedDigest, expectedCount) {
  if (!manifest || manifest.contract !== CONTRACT || manifest.release_sha !== releaseSha
      || manifest.status !== 'READY' || !HASH_RE.test(clean(manifest.plan_digest))
      || manifest.plan_digest !== expectedDigest
      || Number(manifest.repair_count) !== Number(expectedCount)
      || !Array.isArray(manifest.repairs)
      || manifest.repairs.length !== Number(expectedCount)) {
    fail('REVIEWED_INVENTORY_MISMATCH');
  }
  if (manifest.repairs.some(repair => ![
    'exact_converged', 'exact_f133_generated_split',
  ].includes(clean(repair.classification))
    || (repair.classification === 'exact_converged' && repair.title_mutation_required !== false)
    || (repair.classification === 'exact_f133_generated_split' && repair.title_mutation_required !== true)
    || !HASH_RE.test(clean(repair.identity_sha256))
    || clean(repair.identity_sha256) !== repairIdentitySha256(
      repair.surface, repair.client_slug, repair.card_id
    )
    || clean(repair.request_id) !== repairRequestId(repair.identity_sha256, manifest.plan_digest)
    || !Number.isSafeInteger(Number(repair.expected_title_revision))
    || Number(repair.expected_title_revision) < 0
    || !Array.isArray(repair.binder_adoption_required)
    || (repair.title_mutation_required !== true && repair.binder_adoption_required.length === 0))) {
    fail('REVIEWED_INVENTORY_MISMATCH');
  }
  const core = {
    contract: manifest.contract, release_sha: manifest.release_sha,
    universe_identity_sha256: manifest.universe_identity_sha256,
    unaffected_title_sha256: manifest.unaffected_title_sha256,
    repair_count: manifest.repair_count,
    repairs: manifest.repairs.map(({ request_id: _requestId, ...repair }) => repair),
  };
  if (sha256(core) !== manifest.plan_digest) fail('REVIEWED_INVENTORY_MISMATCH');
  return true;
}

function exactReplayOwned(repair, card, rows, indexes, inventorySha256, planDigest) {
  if (!card || !exactLinkage(card, rows) || String(card.title || '') !== repair.title
      || !Number.isSafeInteger(Number(card.title_revision))
      || Number(card.title_revision) < Number(repair.expected_title_revision) + 1
      || rows.some(row => String(row.title || '') !== repair.title)) return false;
  const eventKey = `write-ui:title:card:${repair.origin}:${repair.client_slug}:${repair.card_id}:${repair.request_id}`;
  const events = array(indexes.eventsByBatch.get(repair.batch_id)).filter(event => clean(event.event_key) === eventKey);
  if (events.length !== 1) return false;
  const event = events[0];
  const payload = jsonObject(event.payload);
  if (lower(event.action) !== 'title_change' || clean(event.source) !== 'ui'
      || clean(payload.card_id) !== repair.card_id || clean(payload.surface) !== repair.origin
      || String(payload.title || '') !== repair.title
      || canonicalTitle(payload.from_title) !== repair.title
      || Number(payload.from_title_revision) !== Number(repair.expected_title_revision)
      || Number(payload.title_revision) !== Number(repair.expected_title_revision) + 1
      || JSON.stringify(stable(jsonObject(payload.repair))) !== JSON.stringify(stable({
        confirmation: CONFIRMATIONS.apply,
        inventory_sha256: inventorySha256,
        plan_digest: planDigest,
        identity_sha256: repair.identity_sha256,
        request_id: repair.request_id,
      }))
      || !sameInstant(payload.client_edited_at, repair.source_edited_at)) return false;
  return rows.every(row => {
    const dedup = `write-ui:title:deliverable:${clean(row.id)}:${repair.request_id}`;
    const matches = array(indexes.outboxByDeliverable.get(clean(row.id)))
      .filter(outbox => clean(outbox.dedup_key) === dedup);
    return matches.length === 1 && lower(matches[0].operation) === 'title'
      && String(jsonObject(matches[0].payload).title || '') === repair.title;
  });
}

function binderAdoptionProgress(repair, card, rows, indexes) {
  const actions = array(repair.binder_adoption_required);
  if (!card || !exactLinkage(card, rows) || String(card.title || '') !== repair.title
      || cardBinderProgressFingerprint(card, rows, indexes)
        !== repair.before_binder_progress_fingerprint) return { ok: false };
  const byId = new Map(rows.map(row => [clean(row.id), row]));
  const pending = [];
  const applied = [];
  for (const evidence of actions) {
    const expected = jsonObject(evidence.deliverable);
    const provider = jsonObject(evidence.provider);
    const row = byId.get(clean(expected.id));
    if (!row || clean(expected.stored_title_clock)
        || String(row.title || '') !== String(expected.title || '')) return { ok: false };
    const clock = clean(jsonObject(jsonObject(row.linear_raw).field_updated_at).title);
    const sameIdentity = clean(row.linear_issue_uuid) === clean(provider.id)
      && clean(row.linear_identifier) === clean(provider.identifier)
      && clean(row.linear_issue_url) === clean(provider.url);
    if (!sameIdentity) return { ok: false };
    if (!clock && sameInstant(row.updated_at, expected.expected_updated_at)) pending.push(evidence);
    else if (sameInstant(clock, provider.updated_at)
        && Date.parse(clean(row.updated_at)) >= Date.parse(clean(expected.expected_updated_at))) {
      applied.push(evidence);
    } else return { ok: false };
  }
  return { ok: true, pending, applied };
}

function validateFreshApplyState(snapshot, linearIssues, manifest, inventorySha256) {
  if (!HASH_RE.test(clean(inventorySha256))) fail('REVIEWED_INVENTORY_MISMATCH');
  assertSnapshotPrerequisites(snapshot, 'apply');
  const indexes = inventoryIndexes(snapshot, linearIssues);
  const keys = [...new Set([...indexes.cards.keys(), ...indexes.reverse.keys()])].sort();
  if (sha256(keys) !== manifest.universe_identity_sha256) fail('LIVE_INVENTORY_DRIFT');
  const repairs = new Map(manifest.repairs.map(row => [row.identity, row]));
  const unaffected = [];
  const states = [];
  for (const key of keys) {
    const card = indexes.cards.get(key);
    const rows = array(indexes.reverse.get(key)).sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
    const repair = repairs.get(key);
    if (!repair) {
      const classified = card ? classifyCard(card, rows, indexes, manifest.release_sha)
        : { classification: 'blocked' };
      if (classified.classification !== 'exact_converged') fail('LIVE_INVENTORY_DRIFT');
      unaffected.push({ identity: key, title: classified.title });
      continue;
    }
    const binderProgress = binderAdoptionProgress(repair, card, rows, indexes);
    if (binderProgress.ok) {
      states.push({
        repair,
        state: repair.title_mutation_required ? 'reviewed_split' : 'reviewed_converged',
        pending_binder_adoptions: binderProgress.pending,
        applied_binder_adoptions: binderProgress.applied,
      });
    } else if (repair.title_mutation_required && exactReplayOwned(
      repair, card, rows, indexes, inventorySha256, manifest.plan_digest
    )) {
      states.push({
        repair, state: 'exact_replay', pending_binder_adoptions: [],
        applied_binder_adoptions: array(repair.binder_adoption_required),
      });
    } else fail('LIVE_REPAIR_STATE_DRIFT');
  }
  if (states.length !== manifest.repair_count || sha256(unaffected) !== manifest.unaffected_title_sha256) {
    fail('LIVE_INVENTORY_DRIFT');
  }
  return { indexes, states };
}

function writeJournal(file, journal) {
  if (!file || !path.isAbsolute(file)) fail('PRIVATE_JOURNAL_PATH_REQUIRED');
  fs.writeFileSync(file, canonicalBytes(journal), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) {}
}

async function postJson(url, body, headers, fetchImpl, ambiguousCode) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (_) { fail(ambiguousCode); }
  let payload;
  try { payload = await response.json(); } catch (_) { fail(ambiguousCode); }
  return { response, payload: jsonObject(payload) };
}

function exactTargetTerminal(target, repair, deliverableId) {
  target = jsonObject(target);
  const result = jsonObject(target.linear_result);
  const expected = jsonObject(result.expected);
  const input = jsonObject(expected.input);
  const conflict = jsonObject(result.conflict);
  const status = lower(target.status);
  const proof = array(repair.create_proofs)
    .find(value => clean(value.deliverable_id) === clean(deliverableId));
  const receiptClock = Date.parse(clean(result.updated_at));
  const receiptExact = clean(target.operation) === 'title'
    && clean(target.dedup_key) === `write-ui:title:deliverable:${clean(deliverableId)}:${repair.request_id}`
    && target.legacy_parity === true && target.test_only === false
    && clean(result.mutation) === 'issueUpdate'
    && proof && clean(result.issue_id) === clean(proof.issue_id)
    && clean(expected.id) === clean(proof.issue_id)
    && String(input.title == null ? '' : input.title) === repair.title
    && Number.isFinite(receiptClock)
    && receiptClock >= Date.parse(clean(repair.source_edited_at));
  return receiptExact && (status === 'written'
    || (status === 'skipped' && ['already_applied', 'already_exists'].includes(lower(conflict.decision))));
}

async function applyRepairs(manifest, validation, config, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') fail('FETCH_UNAVAILABLE');
  const base = clean(config.supabaseUrl).replace(/\/$/, '');
  if (!base || !clean(config.serviceKey) || !clean(config.staffKey) || !clean(config.actor)) {
    fail('APPLY_CREDENTIALS_REQUIRED');
  }
  const journal = {
    contract: `${CONTRACT}/apply-journal`, release_sha: manifest.release_sha,
    plan_digest: manifest.plan_digest, inventory_sha256: config.inventorySha256,
    status: 'running', attempts: [],
  };
  writeJournal(config.journal, journal);
  for (const state of validation.states) {
    const repair = state.repair;
    const attempt = {
      identity: repair.identity, request_id: repair.request_id,
      source_edited_at: repair.source_edited_at, state_before: state.state,
      title_response: null, drains: [],
    };
    journal.attempts.push(attempt);
    writeJournal(config.journal, journal);
    const pendingAdoptions = array(state.pending_binder_adoptions);
    if (array(repair.binder_adoption_required).length) {
      attempt.binder_responses = [];
      for (const evidence of pendingAdoptions) {
        const adopted = await postJson(
          `${base}/rest/v1/rpc/production_canonical_title_binder_adopt`,
          { p_evidence: evidence },
          { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey },
          fetchImpl, 'BINDER_ADOPTION_RESPONSE_AMBIGUOUS',
        );
        attempt.binder_responses.push({ status: adopted.response.status, body: adopted.payload });
        writeJournal(config.journal, journal);
        if (adopted.response.status === 404 || clean(adopted.payload.code) === 'PGRST202') {
          fail('BINDER_ADOPTION_UNAVAILABLE');
        }
        const provider = jsonObject(evidence.provider);
        if (!adopted.response.ok || adopted.payload.ok !== true
            || clean(adopted.payload.type) !== 'f133_title_binder_adoption'
            || clean(adopted.payload.deliverable_id) !== clean(jsonObject(evidence.deliverable).id)
            || clean(adopted.payload.evidence_sha256) !== clean(evidence.evidence_sha256)
            || String(adopted.payload.title || '') !== String(jsonObject(evidence.deliverable).title || '')
            || !sameInstant(adopted.payload.provider_updated_at, provider.updated_at)
            || typeof adopted.payload.replayed !== 'boolean') {
          fail('BINDER_ADOPTION_RECEIPT_INVALID');
        }
      }
    }
    if (!repair.title_mutation_required) {
      continue;
    }
    const { response, payload } = await postJson(
      `${base}/functions/v1/production-write`,
      {
        operation: 'title', surface: repair.surface,
        client_slug: repair.client_slug, card_id: repair.card_id,
        expected_title: repair.title, title: repair.title,
        expected_title_revision: repair.expected_title_revision,
        request_id: repair.request_id, source_edited_at: repair.source_edited_at,
        repair: {
          confirmation: CONFIRMATIONS.apply,
          inventory_sha256: config.inventorySha256,
          plan_digest: manifest.plan_digest,
          identity_sha256: repair.identity_sha256,
          request_id: repair.request_id,
        },
      },
      {
        authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
        'x-syncview-key': config.staffKey, 'x-syncview-actor': config.actor,
      }, fetchImpl, 'TITLE_RESPONSE_AMBIGUOUS',
    );
    attempt.title_response = { status: response.status, body: payload };
    writeJournal(config.journal, journal);
    if (!response.ok || payload.ok !== true || payload.native_committed !== true
        || payload.title !== repair.title || payload.requested_title !== repair.title
        || Number(jsonObject(payload.card).title_revision) !== Number(repair.expected_title_revision) + 1
        || JSON.stringify(stable(jsonObject(payload.repair))) !== JSON.stringify(stable({
          confirmation: CONFIRMATIONS.apply,
          inventory_sha256: config.inventorySha256,
          plan_digest: manifest.plan_digest,
          identity_sha256: repair.identity_sha256,
          request_id: repair.request_id,
        }))
        || !Array.isArray(payload.rows) || payload.rows.length !== repair.linked_deliverable_ids.length
        || payload.rows.some(row => !repair.linked_deliverable_ids.includes(clean(row.id))
          || String(row.title || '') !== repair.title)) {
      fail('TITLE_APPLY_RECEIPT_INVALID');
    }
    // The exact title operation deliberately mirrors asynchronously. Drain
    // only its deterministic dedups, one at a time. No broad drain exists in
    // this operator.
    for (const id of repair.linked_deliverable_ids) {
      const dedup = `write-ui:title:deliverable:${id}:${repair.request_id}`;
      const drained = await postJson(
        `${base}/functions/v1/linear-outbound`,
        { target_dedup_key: dedup, legacy_parity: true, confirm: 'WRITE_UI_LEGACY_PARITY' },
        { authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey },
        fetchImpl, 'TARGET_DRAIN_RESPONSE_AMBIGUOUS',
      );
      attempt.drains.push({ dedup_key: dedup, status: drained.response.status, body: drained.payload });
      writeJournal(config.journal, journal);
      const target = jsonObject(drained.payload.target);
      if (!drained.response.ok || drained.payload.ok !== true
          || !exactTargetTerminal(target, repair, id)) {
        fail('TARGET_DRAIN_NOT_TERMINAL');
      }
    }
  }
  journal.status = 'applied';
  writeJournal(config.journal, journal);
  const bytes = fs.readFileSync(config.journal);
  return {
    status: 'PASS', operation: 'apply', release_sha: manifest.release_sha,
    plan_digest: manifest.plan_digest, repair_count: validation.states.length,
    reviewed_split_count: validation.states.filter(row => row.state === 'reviewed_split').length,
    exact_replay_count: validation.states.filter(row => row.state === 'exact_replay').length,
    binder_adoption_actions: validation.states.reduce((sum, row) =>
      sum + array(row.repair.binder_adoption_required).length, 0),
    title_mutation_actions: validation.states.filter(row => row.repair.title_mutation_required).length,
    journal_sha256: sha256(bytes), journal_byte_length: bytes.length,
  };
}

function verifyManifest(snapshot, linearIssues, manifest) {
  assertSnapshotPrerequisites(snapshot, 'verify');
  const indexes = inventoryIndexes(snapshot, linearIssues);
  let cardCount = 0;
  let deliverableCount = 0;
  let linearCount = 0;
  let eventCount = 0;
  let terminalOutboxCount = 0;
  let binderAdoptionActionCount = 0;
  let openTitleIntents = 0;
  for (const repair of manifest.repairs) {
    binderAdoptionActionCount += array(repair.binder_adoption_required).length;
    const card = indexes.cards.get(repair.identity);
    const rows = array(indexes.reverse.get(repair.identity)).sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
    if (!card || !exactLinkage(card, rows) || String(card.title || '') !== repair.title
        || rows.length !== repair.linked_deliverable_ids.length
        || rows.some(row => !repair.linked_deliverable_ids.includes(clean(row.id))
          || String(row.title || '') !== repair.title)) fail('VERIFY_DATABASE_DIVERGENCE');
    cardCount++;
    deliverableCount += rows.length;
    for (const row of rows) {
      const issueId = clean(row.linear_issue_uuid);
      if (!issueBinding(row, indexes, repair.title, true).ok) fail('VERIFY_LINEAR_DIVERGENCE');
      linearCount++;
      if (!repair.title_mutation_required) continue;
      const dedup = `write-ui:title:deliverable:${clean(row.id)}:${repair.request_id}`;
      const matches = array(indexes.outboxByDeliverable.get(clean(row.id)))
        .filter(outbox => clean(outbox.dedup_key) === dedup);
      const result = jsonObject(matches[0] && matches[0].linear_result);
      if (matches.length !== 1 || !exactTargetTerminal(matches[0], repair, row.id)
          || String(jsonObject(matches[0].payload).title || '') !== repair.title
          || clean(result.mutation) !== 'issueUpdate'
          || clean(result.issue_id) !== issueId
          || !sameInstant(result.updated_at, jsonObject(indexes.issues.get(issueId)).updatedAt)) {
        fail('VERIFY_OUTBOX_DIVERGENCE');
      }
      terminalOutboxCount++;
    }
    if (!repair.title_mutation_required) {
      const byId = new Map(rows.map(row => [clean(row.id), row]));
      for (const evidence of array(repair.binder_adoption_required)) {
        const row = byId.get(clean(jsonObject(evidence.deliverable).id));
        const clock = clean(jsonObject(jsonObject(row && row.linear_raw).field_updated_at).title);
        if (!row || !sameInstant(clock, jsonObject(evidence.provider).updated_at)) {
          fail('VERIFY_BINDER_ADOPTION_DIVERGENCE');
        }
      }
    } else {
      const eventKey = `write-ui:title:card:${repair.origin}:${repair.client_slug}:${repair.card_id}:${repair.request_id}`;
      const events = array(indexes.eventsByBatch.get(repair.batch_id)).filter(event => clean(event.event_key) === eventKey);
      if (events.length !== 1) fail('VERIFY_EVENT_DIVERGENCE');
      eventCount++;
    }
  }
  for (const outbox of array(snapshot.outbox)) {
    if (lower(outbox.operation) === 'title' && outbox.test_only === false
        && OPEN.has(lower(outbox.status))) openTitleIntents++;
  }
  if (openTitleIntents !== 0) fail('VERIFY_OPEN_TITLE_INTENTS');
  // Global equality is the F133-specific flip certificate. Every linked card
  // in the full outer universe must now classify exact_converged; a new split
  // or an orphan discovered since plan fails this verification.
  const keys = [...new Set([...indexes.cards.keys(), ...indexes.reverse.keys()])].sort();
  for (const key of keys) {
    const card = indexes.cards.get(key);
    const rows = array(indexes.reverse.get(key)).sort((a, b) => clean(a.id).localeCompare(clean(b.id)));
    const classified = card ? classifyCard(card, rows, indexes, manifest.release_sha) : null;
    if (!classified || classified.classification !== 'exact_converged'
        || array(classified.binder_adoption_required).length !== 0) {
      fail('VERIFY_GLOBAL_TITLE_DIVERGENCE');
    }
  }
  const certificate = {
    repaired_cards: cardCount, linked_deliverables: deliverableCount,
    linear_issues: linearCount, title_change_events: eventCount,
    binder_adoption_actions: binderAdoptionActionCount,
    terminal_title_intents: terminalOutboxCount, open_title_intents: openTitleIntents,
    global_linked_title_divergence: 0,
  };
  return {
    status: 'PASS', operation: 'verify', release_sha: manifest.release_sha,
    plan_digest: manifest.plan_digest, counts: certificate,
    f133_flip_certificate_sha256: sha256(certificate),
  };
}

function parseArgs(argv) {
  const accepted = new Set([
    '--operation', '--confirm', '--release-sha', '--output', '--inventory',
    '--journal', '--expected-plan-digest', '--expected-repair-count',
    '--expected-inventory-sha256',
  ]);
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i];
    if (!accepted.has(name) || Object.prototype.hasOwnProperty.call(values, name)
        || !argv[i + 1] || argv[i + 1].startsWith('--')) fail('ARGUMENT_REJECTED');
    values[name] = argv[++i];
  }
  const operation = clean(values['--operation']);
  if (!Object.prototype.hasOwnProperty.call(CONFIRMATIONS, operation)
      || values['--confirm'] !== CONFIRMATIONS[operation]
      || !SHA_RE.test(clean(values['--release-sha']))) fail('ARGUMENT_REJECTED');
  if (operation === 'plan' && (!values['--output'] || !path.isAbsolute(values['--output']))) {
    fail('ARGUMENT_REJECTED');
  }
  if (operation !== 'plan' && (
    !values['--inventory'] || !path.isAbsolute(values['--inventory'])
    || !HASH_RE.test(clean(values['--expected-plan-digest']))
    || !/^(0|[1-9][0-9]*)$/.test(clean(values['--expected-repair-count']))
    || !HASH_RE.test(clean(values['--expected-inventory-sha256']))
  )) fail('ARGUMENT_REJECTED');
  if (operation === 'apply' && (!values['--journal'] || !path.isAbsolute(values['--journal']))) {
    fail('ARGUMENT_REJECTED');
  }
  return {
    operation, confirm: values['--confirm'], releaseSha: values['--release-sha'],
    output: values['--output'], inventory: values['--inventory'], journal: values['--journal'],
    expectedPlanDigest: values['--expected-plan-digest'],
    expectedRepairCount: values['--expected-repair-count'],
    expectedInventorySha256: values['--expected-inventory-sha256'],
  };
}

async function run(argv = process.argv.slice(2), env = process.env, deps = {}) {
  const args = parseArgs(argv);
  const snapshot = await (deps.capture ? deps.capture() : runPsqlCapture(env.F133_DATABASE_URL, deps));
  const linearIssues = await (deps.readLinear
    ? deps.readLinear(snapshot)
    : fetchLinearIssues(snapshot, env.LINEAR_API_KEY, deps));
  if (args.operation === 'plan') {
    const manifest = planInventory(snapshot, linearIssues, args.releaseSha);
    const bytes = canonicalBytes(manifest);
    fs.writeFileSync(args.output, bytes, { mode: 0o600 });
    try { fs.chmodSync(args.output, 0o600); } catch (_) {}
    const receipt = publicPlanReceipt(manifest, bytes);
    if (manifest.status !== 'READY') {
      process.exitCode = 2;
      return receipt;
    }
    return receipt;
  }
  const inventoryBytes = fs.readFileSync(args.inventory);
  if (sha256(inventoryBytes) !== args.expectedInventorySha256) fail('REVIEWED_INVENTORY_HASH_MISMATCH');
  let manifest;
  try { manifest = JSON.parse(inventoryBytes.toString('utf8')); } catch (_) { fail('REVIEWED_INVENTORY_INVALID'); }
  assertManifest(manifest, args.releaseSha, args.expectedPlanDigest, args.expectedRepairCount);
  if (args.operation === 'apply') {
    const validation = validateFreshApplyState(
      snapshot, linearIssues, manifest, args.expectedInventorySha256,
    );
    return applyRepairs(manifest, validation, {
      supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      staffKey: env.ROLE_KEY_ADMIN, actor: env.F133_TITLE_REPAIR_ACTOR,
      inventorySha256: args.expectedInventorySha256, journal: args.journal,
    }, deps);
  }
  return verifyManifest(snapshot, linearIssues, manifest);
}

function publicFailure(error, operation) {
  return {
    status: 'FAIL', operation: clean(operation) || 'unknown',
    code: error instanceof F133OperatorError ? error.code : 'F133_OPERATOR_FAILED',
  };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const opAt = argv.indexOf('--operation');
  const operation = opAt >= 0 ? argv[opAt + 1] : '';
  run(argv).then(receipt => {
    if (receipt) process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }).catch(error => {
    process.stderr.write(`${JSON.stringify(publicFailure(error, operation))}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  CAPTURE_SQL,
  CONFIRMATIONS,
  CONTRACT,
  F133OperatorError,
  applyRepairs,
  canonicalBytes,
  canonicalTitle,
  cardEvidenceFingerprint,
  classifyCard,
  exactCreateProof,
  exactLinkage,
  exactReplayOwned,
  fetchLinearIssues,
  inventoryIndexes,
  parseArgs,
  placeholderForCard,
  planInventory,
  publicFailure,
  publicPlanReceipt,
  run,
  runPsqlCapture,
  sha256,
  validateFreshApplyState,
  verifyManifest,
};
