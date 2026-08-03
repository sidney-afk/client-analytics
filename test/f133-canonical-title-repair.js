#!/usr/bin/env node
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const {
  CAPTURE_SQL,
  CONTRACT,
  F133OperatorError,
  applyRepairs,
  canonicalBytes,
  fetchLinearIssues,
  inventoryIndexes,
  parseArgs,
  placeholderForCard,
  planInventory,
  publicFailure,
  sha256,
  validateFreshApplyState,
  verifyManifest,
} = require('../scripts/f133-canonical-title-repair');

let assertions = 0;
function ok(value, message) {
  assertions++;
  if (!value) throw new Error(`FAIL: ${message}`);
  console.log(`ok ${assertions} - ${message}`);
}
async function rejectsCode(work, code, message) {
  let actual = '';
  try { await work(); } catch (error) { actual = error && error.code; }
  ok(actual === code, `${message} (${actual || 'no error'})`);
}

const RELEASE = 'a'.repeat(40);
const INVENTORY_SHA = 'b'.repeat(64);
const CREATE_AT = '2026-07-28T20:00:00.000Z';
const CARD_AT = '2026-07-28T20:05:00.000Z';

function issue(id, title, updatedAt = CREATE_AT, suffix = '') {
  return {
    id, identifier: `VID-${suffix || id.slice(-1)}`, title, updatedAt,
    url: `https://linear.app/syncview/issue/${id}`,
    team: { id: 'team-video' }, project: { id: 'project-client' },
  };
}

function deliverable(id, team, title, cardId = 'p_native_abc12345_1', overrides = {}) {
  const linear = issue(`issue-${id}`, title, CREATE_AT, team === 'video' ? '1' : '2');
  return {
    id, batch_id: 'batch-1', client_slug: 'real-client', team,
    kind: team === 'graphics' ? 'thumbnail' : 'video', title,
    origin: 'calendar', card_id: cardId, sort_key: team === 'video' ? 0 : 1,
    created_by: 'member-owner', created_at: CREATE_AT, updated_at: CREATE_AT,
    linear_issue_uuid: linear.id, linear_identifier: linear.identifier,
    linear_issue_url: linear.url,
    linear_raw: { issue: linear, field_updated_at: {} },
    ...overrides,
  };
}

function createEvidence(row, id) {
  const dedup = `write-ui:intake_create:deliverable:${row.id}:request-old`;
  const fingerprint = `fingerprint-${row.id}`;
  return {
    event: {
      id, event_key: null, deliverable_id: row.id, batch_id: row.batch_id,
      client_slug: row.client_slug, ts: CREATE_AT, actor: 'Owner', role: 'smm',
      action: 'create', from_status: null, to_status: 'in_progress', source: 'ui',
      payload: { outbound: {
        entity: 'deliverable', entity_id: row.id, team: row.team,
        operation: 'create', dedup_key: dedup, source_edited_at: CREATE_AT,
        test_only: false, legacy_parity: true,
        payload: { title: row.title, team_id: `team-${row.team}`,
          project_id: 'project-client', _intent_fingerprint: fingerprint },
      } },
    },
    outbox: {
      id: id + 100, entity: 'deliverable', entity_id: row.id,
      deliverable_id: row.id, batch_id: row.batch_id, comment_id: null,
      operation: 'create', op: 'create', client_slug: row.client_slug, team: row.team,
      dedup_key: dedup, source_edited_at: CREATE_AT, actor: 'Owner', role: 'smm',
      status: 'written', depends_on_id: 1, test_only: false, legacy_parity: true,
      authority_generation: 0, attempts: 0, processed_at: CREATE_AT,
      payload: { title: row.title, team_id: `team-${row.team}`,
        project_id: 'project-client', _intent_fingerprint: fingerprint },
      linear_result: {
        mutation: 'issueCreate', issue_id: row.linear_issue_uuid,
        identifier: row.linear_identifier, updated_at: CREATE_AT,
        mirror_actor_id: 'mirror-actor',
        expected: { input: { title: row.title } },
      },
    },
  };
}

function baseSnapshot(options = {}) {
  const cardId = options.cardId || 'p_native_abc12345_1';
  const target = options.target || 'Campaign Launch';
  const video = deliverable('deliverable-video', 'video', target, cardId);
  const graphic = deliverable('deliverable-graphic', 'graphics', options.graphicTitle || 'Video 1', cardId);
  const rows = options.single ? [video] : [video, graphic];
  if (options.binders === true) {
    for (const row of rows) row.linear_raw.field_updated_at.title = CREATE_AT;
  }
  const evidence = rows.map((row, index) => createEvidence(row, index + 1));
  const cards = [{
    surface: 'calendar', origin: 'calendar', client_slug: 'real-client',
    card_id: cardId, title: target, title_revision: 0, updated_at: CARD_AT,
    video_deliverable_id: video.id,
    graphic_deliverable_id: options.single ? null : graphic.id,
  }];
  return {
    contract: CONTRACT, captured_at: '2026-08-02T00:00:00.000Z',
    transaction: { isolation: 'repeatable read', read_only: 'on' },
    cards, deliverables: rows, events: evidence.map(value => value.event),
    outbox: evidence.map(value => value.outbox),
    clients: [{ slug: 'real-client', active: true, kind: 'production' }],
    flags: {
      prod_authority: { video: 'linear', graphics: 'linear' },
      linear_outbound_enabled: { mode: 'off' },
      linear_inbound_enabled: { enabled: true },
      linear_legacy_parity_enabled: { enabled: true },
      auth_enforcement: { mode: 'permissive' },
      f133_canonical_title_enabled: { enabled: false },
    },
    prerequisites: {
      canonical_title_write_present: true, dependency_valid_present: true,
      title_revision_contract_present: true,
      binder_adopt_present: true, service_role_execute_only: true,
      calendar_guard_present: true, samples_guard_present: true,
      deliverable_guard_present: true, cas_guard_present: true,
    },
    linear: rows.map(row => ({ ...row.linear_raw.issue })),
  };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function titleTerminal(row, repair, id, status = 'written') {
  const providerAt = '2026-08-02T01:00:00.000Z';
  return {
    id, entity: 'deliverable', entity_id: row.id, deliverable_id: row.id,
    batch_id: row.batch_id, operation: 'title', op: 'update_fields',
    client_slug: row.client_slug, team: row.team,
    dedup_key: `write-ui:title:deliverable:${row.id}:${repair.request_id}`,
    source_edited_at: repair.source_edited_at, actor: 'Owner', role: 'admin',
    status, test_only: false, legacy_parity: true, authority_generation: 0,
    payload: { title: repair.title, _intent_fingerprint: `title-${row.id}` },
    linear_result: {
      mutation: 'issueUpdate', issue_id: row.linear_issue_uuid,
      updated_at: providerAt,
      expected: { id: row.linear_issue_uuid, input: { title: repair.title } },
    },
  };
}

function postTitleState(snapshot, manifest) {
  const value = clone(snapshot);
  const repair = manifest.repairs.find(row => row.title_mutation_required === true);
  const providerAt = '2026-08-02T01:00:00.000Z';
  value.cards[0].title_revision = Number(repair.expected_title_revision) + 1;
  for (const row of value.deliverables) {
    row.title = repair.title;
    row.updated_at = providerAt;
    row.linear_raw.issue.title = repair.title;
    row.linear_raw.issue.updatedAt = providerAt;
    row.linear_raw.field_updated_at.title = providerAt;
  }
  value.linear = value.deliverables.map(row => ({ ...row.linear_raw.issue }));
  value.events.push({
    id: 500, event_key: `write-ui:title:card:${repair.origin}:${repair.client_slug}:${repair.card_id}:${repair.request_id}`,
    deliverable_id: null, batch_id: repair.batch_id, client_slug: repair.client_slug,
    ts: providerAt, actor: 'Owner', role: 'admin', action: 'title_change', source: 'ui',
    payload: { surface: repair.origin, card_id: repair.card_id,
      from_title: repair.title, title: repair.title,
      from_title_revision: repair.expected_title_revision,
      title_revision: Number(repair.expected_title_revision) + 1,
      repair: {
        confirmation: 'APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR',
        inventory_sha256: INVENTORY_SHA,
        plan_digest: manifest.plan_digest,
        identity_sha256: repair.identity_sha256,
        request_id: repair.request_id,
      },
      client_edited_at: repair.source_edited_at },
  });
  value.outbox.push(...value.deliverables.map((row, index) => titleTerminal(row, repair, 600 + index)));
  return value;
}

async function main() {
  const split = baseSnapshot();
  const splitPlan = planInventory(split, split.linear, RELEASE);
  ok(splitPlan.status === 'READY' && splitPlan.repair_count === 1
    && splitPlan.repairs[0].classification === 'exact_f133_generated_split'
    && splitPlan.repairs[0].title_mutation_required === true
    && splitPlan.counts.exact_f133_generated_split === 1,
  'the exact source-derived Video N split is the sole title repair');
  ok(splitPlan.repairs[0].placeholder === 'Video 1'
    && splitPlan.repairs[0].expected_deliverable_titles['deliverable-video'] === 'Campaign Launch'
    && splitPlan.repairs[0].expected_deliverable_titles['deliverable-graphic'] === 'Video 1',
  'the manifest preserves exact per-deliverable CAS bases privately');
  ok(placeholderForCard(split.cards[0]) === 'Video 1'
    && placeholderForCard({ card_id: 'p_native_abc_01' }) === ''
    && placeholderForCard({ card_id: 'other_1' }) === '',
  'placeholder derivation requires the exact historical card-id source shape and canonical N');
  const samples = clone(split);
  samples.cards[0].surface = 'sxr';
  samples.cards[0].origin = 'samples';
  samples.deliverables.forEach(row => { row.origin = 'samples'; });
  const samplesPlan = planInventory(samples, samples.linear, RELEASE);
  const expectedSamplesIdentity = crypto.createHash('sha256')
    .update(`sxr\0real-client\0${samples.cards[0].card_id}`)
    .digest('hex');
  const wrongStorageIdentity = crypto.createHash('sha256')
    .update(`samples\0real-client\0${samples.cards[0].card_id}`)
    .digest('hex');
  ok(samplesPlan.status === 'READY'
    && samplesPlan.repairs[0].surface === 'sxr'
    && samplesPlan.repairs[0].origin === 'samples'
    && samplesPlan.repairs[0].identity_sha256 === expectedSamplesIdentity
    && samplesPlan.repairs[0].identity_sha256 !== wrongStorageIdentity,
  'Samples repair binds the public sxr identity surface and keeps storage origin separate');

  const graphic = baseSnapshot({ graphicTitle: 'Graphic 1' });
  let plan = planInventory(graphic, graphic.linear, RELEASE);
  ok(plan.status === 'BLOCKED' && plan.blocked_reasons.real_or_ambiguous_split === 1,
    'Graphic N is never accepted as the historical source-generated placeholder');
  const realReal = baseSnapshot({ graphicTitle: 'Other Real Name' });
  plan = planInventory(realReal, realReal.linear, RELEASE);
  ok(plan.status === 'BLOCKED' && plan.blocked_reasons.real_or_ambiguous_split === 1,
    'a real-title versus real-title split blocks instead of guessing');
  const orphan = baseSnapshot();
  orphan.cards = [];
  plan = planInventory(orphan, orphan.linear, RELEASE);
  ok(plan.status === 'BLOCKED' && plan.blocked_reasons.reverse_deliverable_without_card === 1,
    'the reverse half of the full-outer universe blocks a deliverable without its card');

  const binderMissing = baseSnapshot({ single: true, graphicTitle: 'Campaign Launch' });
  plan = planInventory(binderMissing, binderMissing.linear, RELEASE);
  ok(plan.status === 'READY'
    && plan.repairs[0].classification === 'exact_converged'
    && plan.repairs[0].title_mutation_required === false
    && plan.counts.exact_converged === 1
    && !Object.prototype.hasOwnProperty.call(plan.counts, 'exact_f133_binder_adoption')
    && plan.repairs[0].binder_adoption_required.length === 1,
  'missing title-clock work remains exact_converged with a separate binder action');
  const binderExact = baseSnapshot({ single: true, graphicTitle: 'Campaign Launch', binders: true });
  plan = planInventory(binderExact, binderExact.linear, RELEASE);
  ok(plan.status === 'READY' && plan.repair_count === 0 && plan.counts.exact_converged === 1,
    'exact identity, title, provider read, and title clock classify converged');
  const missingIdentity = baseSnapshot({ single: true, binders: true });
  missingIdentity.deliverables[0].linear_identifier = '';
  plan = planInventory(missingIdentity, missingIdentity.linear, RELEASE);
  ok(plan.status === 'BLOCKED', 'a missing canonical provider identity field cannot certify convergence');

  const unrelatedClock = baseSnapshot();
  unrelatedClock.deliverables[0].linear_raw.field_updated_at.title = CREATE_AT;
  unrelatedClock.deliverables[0].linear_raw.issue.updatedAt = '2026-07-28T20:03:00.000Z';
  unrelatedClock.linear[0].updatedAt = '2026-07-28T20:03:00.000Z';
  plan = planInventory(unrelatedClock, unrelatedClock.linear, RELEASE);
  ok(plan.status === 'READY',
    'an exact title binder permits a later issue-wide clock caused by an unrelated provider edit');
  delete unrelatedClock.deliverables[0].linear_raw.field_updated_at.title;
  plan = planInventory(unrelatedClock, unrelatedClock.linear, RELEASE);
  ok(plan.status === 'BLOCKED',
    'a later issue-wide clock without the exact title binder is conservatively blocked');

  ok(/begin isolation level repeatable read read only/i.test(CAPTURE_SQL)
    && /from public\.calendar_posts/.test(CAPTURE_SQL)
    && /from public\.sample_reviews/.test(CAPTURE_SQL)
    && /from public\.deliverables/.test(CAPTURE_SQL)
    && /to_regprocedure\('public\.production_canonical_title_write/.test(CAPTURE_SQL)
    && !/has_function_privilege\([^\n]+production_canonical_title_write/.test(CAPTURE_SQL),
  'capture is one read-only repeatable-read full-outer inventory and missing pre-migration RPCs cannot throw');

  ok(parseArgs(['--operation', 'plan', '--confirm', 'PLAN_F133_CANONICAL_TITLE_REPAIR',
    '--release-sha', RELEASE, '--output', path.resolve('private.titleinventory')]).operation === 'plan',
  'plan CLI requires the exact operation confirmation and absolute private output');
  let badArgs = false;
  try { parseArgs(['--operation', 'apply', '--confirm', 'PLAN_F133_CANONICAL_TITLE_REPAIR',
    '--release-sha', RELEASE]); } catch (error) { badArgs = error.code === 'ARGUMENT_REJECTED'; }
  ok(badArgs, 'apply cannot borrow the plan confirmation or omit reviewed binders');

  const validation = validateFreshApplyState(split, split.linear, splitPlan, INVENTORY_SHA);
  ok(validation.states.length === 1 && validation.states[0].state === 'reviewed_split',
    'apply re-captures and matches the exact reviewed split before writes');
  const enabledTooEarly = clone(split);
  enabledTooEarly.flags.f133_canonical_title_enabled = { enabled: true };
  await rejectsCode(async () => validateFreshApplyState(enabledTooEarly, enabledTooEarly.linear, splitPlan, INVENTORY_SHA),
    'F133_REPAIR_POSTURE_REQUIRED',
    'adoption certificate requires F133 OFF with inbound on and auth permissive');
  const drift = clone(split);
  drift.cards[0].title = 'Changed after review';
  await rejectsCode(async () => validateFreshApplyState(drift, drift.linear, splitPlan, INVENTORY_SHA),
    'LIVE_REPAIR_STATE_DRIFT', 'a changed reviewed row blocks before apply');

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'f133-repair-test-'));
  try {
    const calls = [];
    const journal = path.join(temp, 'journal.titleinventory');
    const applyReceipt = await applyRepairs(splitPlan, validation, {
      supabaseUrl: 'https://fixture.invalid', serviceKey: 'service-secret',
      staffKey: 'staff-secret', actor: 'Fixture Actor', inventorySha256: INVENTORY_SHA, journal,
    }, { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });
      if (url.endsWith('/rest/v1/rpc/production_canonical_title_binder_adopt')) {
        const evidence = body.p_evidence;
        return { ok: true, status: 200, json: async () => ({
          ok: true, type: 'f133_title_binder_adoption',
          deliverable_id: evidence.deliverable.id,
          evidence_sha256: evidence.evidence_sha256,
          title: evidence.deliverable.title,
          provider_updated_at: evidence.provider.updated_at,
          replayed: false,
        }) };
      }
      if (url.endsWith('/production-write')) return {
        ok: true, status: 201, json: async () => ({ ok: true, native_committed: true,
          title: 'Campaign Launch', requested_title: 'Campaign Launch',
          card: { title_revision: 1 },
          repair: {
            confirmation: 'APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR',
            inventory_sha256: INVENTORY_SHA,
            plan_digest: splitPlan.plan_digest,
            identity_sha256: splitPlan.repairs[0].identity_sha256,
            request_id: splitPlan.repairs[0].request_id,
          },
          rows: split.deliverables.map(row => ({ id: row.id, title: 'Campaign Launch' })) }),
      };
      const id = body.target_dedup_key.includes('graphic') ? 'deliverable-graphic' : 'deliverable-video';
      return { ok: true, status: 200, json: async () => ({ ok: true, target: {
        status: 'written', operation: 'title', dedup_key: body.target_dedup_key,
        legacy_parity: true, test_only: false,
        linear_result: { mutation: 'issueUpdate', issue_id: `issue-${id}`,
          updated_at: '2026-08-02T01:00:00.000Z',
          expected: { id: `issue-${id}`, input: { title: 'Campaign Launch' } } },
      } }) };
    } });
    ok(applyReceipt.status === 'PASS' && calls.length === 5
      && calls.slice(0, 2).every(call =>
        call.url.endsWith('/rest/v1/rpc/production_canonical_title_binder_adopt'))
      && calls[2].url.endsWith('/production-write')
      && calls.slice(3).every(call => call.url.endsWith('/linear-outbound')
        && Object.keys(call.body).sort().join(',') === 'confirm,legacy_parity,target_dedup_key'),
    'apply adopts reviewed binders, uses one authenticated title CAS, then exact serial targeted drains');

    let wrongIssueCalls = 0;
    await rejectsCode(async () => applyRepairs(splitPlan, validation, {
      supabaseUrl: 'https://fixture.invalid', serviceKey: 'service-secret',
      staffKey: 'staff-secret', actor: 'Fixture Actor', inventorySha256: INVENTORY_SHA,
      journal: path.join(temp, 'wrong-issue.titleinventory'),
    }, { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      wrongIssueCalls++;
      if (url.endsWith('/rest/v1/rpc/production_canonical_title_binder_adopt')) {
        const evidence = body.p_evidence;
        return { ok: true, status: 200, json: async () => ({
          ok: true, type: 'f133_title_binder_adoption',
          deliverable_id: evidence.deliverable.id,
          evidence_sha256: evidence.evidence_sha256,
          title: evidence.deliverable.title,
          provider_updated_at: evidence.provider.updated_at,
          replayed: false,
        }) };
      }
      if (url.endsWith('/production-write')) return {
        ok: true, status: 201, json: async () => ({ ok: true, native_committed: true,
          title: 'Campaign Launch', requested_title: 'Campaign Launch',
          card: { title_revision: 1 },
          repair: {
            confirmation: 'APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR',
            inventory_sha256: INVENTORY_SHA,
            plan_digest: splitPlan.plan_digest,
            identity_sha256: splitPlan.repairs[0].identity_sha256,
            request_id: splitPlan.repairs[0].request_id,
          },
          rows: split.deliverables.map(row => ({ id: row.id, title: 'Campaign Launch' })) }),
      };
      return { ok: true, status: 200, json: async () => ({ ok: true, target: {
        status: 'written', operation: 'title', dedup_key: body.target_dedup_key,
        legacy_parity: true, test_only: false,
        linear_result: { mutation: 'issueUpdate', issue_id: 'wrong-provider-uuid',
          updated_at: '2026-08-02T01:00:00.000Z',
          expected: { id: 'wrong-provider-uuid', input: { title: 'Campaign Launch' } } },
      } }) };
    } }), 'TARGET_DRAIN_NOT_TERMINAL',
    'a targeted success for the wrong reviewed provider UUID fails during apply');
    ok(wrongIssueCalls === 4, 'wrong-issue proof stops before a second targeted drain');
    ok(fs.existsSync(journal) && JSON.parse(fs.readFileSync(journal, 'utf8')).status === 'applied',
      'apply preserves a private exact-response journal');

    const binderPlan = planInventory(binderMissing, binderMissing.linear, RELEASE);
    const binderValidation = validateFreshApplyState(
      binderMissing, binderMissing.linear, binderPlan, 'c'.repeat(64),
    );
    const binderCalls = [];
    const binderReceipt = await applyRepairs(binderPlan, binderValidation, {
      supabaseUrl: 'https://fixture.invalid', serviceKey: 'service-secret',
      staffKey: 'staff-secret', actor: 'Fixture Actor', inventorySha256: 'c'.repeat(64),
      journal: path.join(temp, 'binder-journal.titleinventory'),
    }, { fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      binderCalls.push({ url, body });
      const evidence = body.p_evidence;
      return { ok: true, status: 200, json: async () => ({
        ok: true, type: 'f133_title_binder_adoption',
        deliverable_id: evidence.deliverable.id, evidence_sha256: evidence.evidence_sha256,
        title: evidence.deliverable.title, provider_updated_at: evidence.provider.updated_at,
        replayed: false,
      }) };
    } });
    ok(binderReceipt.status === 'PASS' && binderCalls.length === 1
      && binderCalls[0].url.endsWith('/rest/v1/rpc/production_canonical_title_binder_adopt')
      && Object.keys(binderCalls[0].body).join(',') === 'p_evidence',
    'missing binders cross only the exact service-role adoption RPC');

    await rejectsCode(async () => applyRepairs(binderPlan, binderValidation, {
      supabaseUrl: 'https://fixture.invalid', serviceKey: 'service-secret',
      staffKey: 'staff-secret', actor: 'Fixture Actor', inventorySha256: 'c'.repeat(64),
      journal: path.join(temp, 'missing-rpc.titleinventory'),
    }, { fetch: async () => ({ ok: false, status: 404,
      json: async () => ({ code: 'PGRST202' }) }) }),
    'BINDER_ADOPTION_UNAVAILABLE', 'apply fails closed when the reviewed adoption phase is not deployed');

    await rejectsCode(async () => applyRepairs(splitPlan, validation, {
      supabaseUrl: 'https://fixture.invalid', serviceKey: 'service-secret',
      staffKey: 'staff-secret', actor: 'Fixture Actor', inventorySha256: INVENTORY_SHA,
      journal: path.join(temp, 'ambiguous.titleinventory'),
    }, { fetch: async (url, init) => {
      if (url.endsWith('/rest/v1/rpc/production_canonical_title_binder_adopt')) {
        const evidence = JSON.parse(init.body).p_evidence;
        return { ok: true, status: 200, json: async () => ({
          ok: true, type: 'f133_title_binder_adoption',
          deliverable_id: evidence.deliverable.id,
          evidence_sha256: evidence.evidence_sha256,
          title: evidence.deliverable.title,
          provider_updated_at: evidence.provider.updated_at,
          replayed: false,
        }) };
      }
      throw new Error('lost response');
    } }),
    'TITLE_RESPONSE_AMBIGUOUS', 'a lost CAS response stops with exact retry identity retained privately');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const post = postTitleState(split, splitPlan);
  const verified = verifyManifest(post, post.linear, splitPlan);
  ok(verified.status === 'PASS' && verified.counts.open_title_intents === 0
    && verified.counts.global_linked_title_divergence === 0
    && /^[a-f0-9]{64}$/.test(verified.f133_flip_certificate_sha256),
  'verify emits one public F133-specific zero-divergence certificate');
  const open = clone(post);
  open.outbox.find(row => row.operation === 'title').status = 'failed';
  await rejectsCode(async () => verifyManifest(open, open.linear, splitPlan),
    'VERIFY_OUTBOX_DIVERGENCE', 'seeded nonterminal title receipt makes verification red');

  const secret = 'private-client-title-and-token';
  const failure = JSON.stringify(publicFailure(new Error(secret), 'apply'));
  ok(!failure.includes(secret) && failure === '{"status":"FAIL","operation":"apply","code":"F133_OPERATOR_FAILED"}',
    'unexpected failures reduce to a fixed public-safe status/stage/code receipt');
  ok(HASH_RE(canonicalBytes(splitPlan))
    && sha256(canonicalBytes(splitPlan)) === sha256(canonicalBytes(splitPlan)),
  'private inventory hashing is canonical and deterministic');

  const providerRows = Array.from({ length: 72 }, (_value, index) => ({
    linear_issue_uuid: `issue-batch-${String(index).padStart(3, '0')}`,
  }));
  // Duplicate input identities must be collapsed before the 35-alias
  // boundary is applied.
  providerRows.push({ linear_issue_uuid: 'issue-batch-000' });
  const providerCalls = [];
  const providerSleeps = [];
  const fetchedIssues = await fetchLinearIssues(
    { deliverables: providerRows }, 'linear-secret', {
      pageDelayMs: 7,
      sleep: async ms => { providerSleeps.push(ms); },
      fetch: async (_url, init) => {
        const request = JSON.parse(init.body);
        const aliases = [...request.query.matchAll(/i([0-9]+): issue\(id: "([^"]+)"\)/g)];
        providerCalls.push(aliases.map(match => match[2]));
        return {
          ok: true, status: 200,
          json: async () => ({ data: Object.fromEntries(aliases.map(match => [
            `i${match[1]}`,
            issue(match[2], `Title ${match[2]}`),
          ])) }),
        };
      },
    },
  );
  ok(providerCalls.map(call => call.length).join(',') === '35,35,2'
    && fetchedIssues.length === 72
    && new Set(fetchedIssues.map(row => row.id)).size === 72
    && providerSleeps.join(',') === '7,7',
  'Linear inventory reads use exact 35-alias batches, deduplicate identities, and delay only between batches');

  let retryCalls = 0;
  const retrySleeps = [];
  const retriedIssues = await fetchLinearIssues(
    { deliverables: [{ linear_issue_uuid: 'issue-retry' }] }, 'linear-secret', {
      sleep: async ms => { retrySleeps.push(ms); },
      fetch: async (_url, init) => {
        retryCalls++;
        if (retryCalls === 1) return { ok: false, status: 429, json: async () => ({}) };
        const request = JSON.parse(init.body);
        ok(/i0: issue\(id: "issue-retry"\)/.test(request.query),
          'the retry preserves the exact requested alias identity');
        return { ok: true, status: 200,
          json: async () => ({ data: { i0: issue('issue-retry', 'Retry Title') } }) };
      },
    },
  );
  ok(retriedIssues.length === 1 && retryCalls === 2 && retrySleeps.join(',') === '500',
    'Linear 429 retries with bounded exponential backoff');
  await rejectsCode(async () => fetchLinearIssues(
    { deliverables: [{ linear_issue_uuid: 'issue-missing' }] }, 'linear-secret', {
      pageDelayMs: 0,
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }),
    },
  ), 'LINEAR_IDENTITY_READ_FAILED', 'a partial alias response fails closed');
  await rejectsCode(async () => fetchLinearIssues(
    { deliverables: [{ linear_issue_uuid: 'issue-expected' }] }, 'linear-secret', {
      pageDelayMs: 0,
      fetch: async () => ({ ok: true, status: 200,
        json: async () => ({ data: { i0: issue('issue-wrong', 'Wrong') } }) }),
    },
  ), 'LINEAR_IDENTITY_READ_FAILED', 'a wrong provider identity fails closed');

  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'f133-canonical-title-repair.yml'), 'utf8');
  const jobEnv = workflow.slice(workflow.indexOf('    env:'), workflow.indexOf('    steps:'));
  ok(/workflow_dispatch:/.test(workflow) && !/\n\s*(push|pull_request|schedule):/.test(workflow),
    'operator lane is dispatch-only');
  ok(!/secrets\./.test(jobEnv)
    && workflow.indexOf('Verify reviewed release and operation confirmation')
      < workflow.indexOf('${{ secrets.'),
  'trusted reviewed-SHA/confirmation validation precedes every step-scoped secret and job env has none');
  ok(/ref: \$\{\{ github\.sha \}\}[\s\S]+path: operator[\s\S]+persist-credentials: false/.test(workflow)
    && /GITHUB_REF[\s\S]+github\.event\.repository\.default_branch/.test(workflow)
    && /GITHUB_SHA" != "\$current_main_sha/.test(workflow)
    && /RUN_COMMIT" != "\$GITHUB_SHA/.test(workflow)
    && /ref: \$\{\{ inputs\.commit_sha \}\}[\s\S]+path: release[\s\S]+persist-credentials: false/.test(workflow)
    && workflow.indexOf('Verify the exact reviewed checkout') < workflow.indexOf('${{ secrets.'),
  'trusted current-main bytes validate the dispatch before an exact clean release checkout sees secrets');
  ok(/git -C operator show "\$RUN_COMMIT:supabase\/config\.toml"/.test(workflow)
    && /::add-mask::\$project_ref/.test(workflow)
    && /PROJECT_REF=\$project_ref/.test(workflow)
    && !/secrets\.PROJECT_REF/.test(workflow),
  'project identity is derived from reviewed config and masked, never injected as a secret');
  ok(/options: \[plan, apply, verify\]/.test(workflow)
    && /PLAN_F133_CANONICAL_TITLE_REPAIR/.test(workflow)
    && /APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR/.test(workflow)
    && /VERIFY_F133_CANONICAL_TITLE_REPAIR/.test(workflow),
  'three operations have distinct exact confirmation strings');
  ok(/--slugs=production-write,linear-outbound/.test(workflow)
    && !/inputs\.(?:slug|slugs|function)/.test(workflow),
  'apply pins the exact reviewed writer/drainer closures and accepts no arbitrary slug');
  ok(/--artifact-kind f133-title-inventory/.test(workflow)
    && /FETCH_PRIVATE_F133_TITLE_INVENTORY/.test(workflow)
    && !/actions\/upload-artifact/.test(workflow),
  'private inventories and journals use strict Drive binary round trips, never public Actions artifacts');
  ok(/EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256: 9d1480048b17bcd038650c4d3191e12cb94b65938374ab335b955a9cab2df042/.test(workflow)
    && (workflow.match(/--expected-folder-id-sha256 "\$EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256"/g) || []).length === 5
    && (workflow.match(/scripts\/f133-private-artifact-gate\.js round-trip/g) || []).length === 2
    && (workflow.match(/scripts\/f133-private-artifact-gate\.js fetch/g) || []).length === 1
    && /receipt\.folder_id_sha256 !== process\.env\.EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256/.test(workflow)
    && /r\.folder_id_sha256 !== process\.env\.EXPECTED_F27_SHARED_DRIVE_ROOT_ID_SHA256/.test(workflow)
    && /receipt\.artifact_kind !== 'f133-title-inventory'/.test(workflow)
    && /r\.artifact_kind !== 'f133-title-inventory'/.test(workflow),
  'plan, apply/verify fetch, and journal bind the exact public root hash before network and again in strict receipts');
  ok(!/cat\s+.*(?:titleinventory|receipt|journal)/.test(workflow)
    && !/tee\s+.*(?:titleinventory|journal)/.test(workflow),
  'workflow never prints private inventories, journals, or raw receipts');

  const runbook = fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops',
    'F133_CANONICAL_TITLE_INSTALL_RUNBOOK.md'), 'utf8');
  ok(/f133_canonical_title_enabled` is either[\s\S]{0,160}absent[\s\S]{0,160}exactly `\{\"enabled\":false\}`/.test(runbook)
    && /\.github\/workflows\/deploy-f133-canonical-title\.yml/.test(runbook)
    && /operation=capture-prior-three/.test(runbook)
    && /`linear-outbound`[\s\S]+`production-write`[\s\S]+`linear-inbound`/.test(runbook)
    && /confirm=DEPLOY_REVIEWED_F133_CANONICAL_TITLE_CLOSURES/.test(runbook)
    && /confirm=RESTORE_CAPTURED_F133_CANONICAL_TITLE_CLOSURES/.test(runbook)
    && /PLAN_F133_CANONICAL_TITLE_REPAIR/.test(runbook)
    && /APPLY_REVIEWED_F133_CANONICAL_TITLE_REPAIR/.test(runbook)
    && /VERIFY_F133_CANONICAL_TITLE_REPAIR/.test(runbook)
    && /Do not restore an old `linear-outbound` while any F133 `title` intent is open/.test(runbook)
    && runbook.indexOf('## 2. Deploy and read back exactly three Edge Functions')
      < runbook.indexOf('## 3. Apply and verify the migration')
    && /database inverse exactly once \*\*before\*\*[\s\S]+restoring any prior Edge closure/.test(runbook)
    && /preferred kill retains both the additive F133 database contract/.test(runbook)
    && !/<replace with merged|F133_EXACT_THREE_DEPLOY_WORKFLOW/.test(runbook),
  'install runbook is owner-gated, capture-first, merge-inert, and names the exact-three deploy/restore lane');

  const store = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-private-snapshot-store.js'), 'utf8');
  const fetcher = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'f27-private-snapshot-fetch.js'), 'utf8');
  ok(/'f133-title-inventory': '\.titleinventory'/.test(store)
    && /syncview-f133-title-inventory-/.test(store)
    && /FETCH_PRIVATE_F133_TITLE_INVENTORY/.test(fetcher),
  'F133 uses one explicitly reviewed opaque octet-stream Drive artifact kind');

  console.log(`\nF133 canonical-title repair operator tests passed (${assertions} assertions)`);
}

function HASH_RE(bytes) { return /^[a-f0-9]{64}$/.test(sha256(bytes)); }

main().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
