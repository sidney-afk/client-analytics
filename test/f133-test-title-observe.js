'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  CONFIRMATION,
  OPERATION,
  TEST_CLIENT,
  runObservation,
  safeFailureReceipt,
  sha256,
} = require('../scripts/f133-test-title-observe');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'f133-test-title-observe.yml'),
  'utf8',
);
const RUNBOOK = fs.readFileSync(
  path.join(ROOT, 'docs', 'ops', 'F133_CANONICAL_TITLE_INSTALL_RUNBOOK.md'),
  'utf8',
);
const SCRIPT = fs.readFileSync(
  path.join(ROOT, 'scripts', 'f133-test-title-observe.js'),
  'utf8',
);

const RELEASE_SHA = 'a'.repeat(40);
const REQUEST_ID = 'calendar:title:f133-test-card:1785700000000:abc123';
const CORRELATION = sha256(REQUEST_ID);
const TARGET_TITLE = 'Exact TEST canonical title';
const EVENT_TS = '2026-08-02T22:00:00.000Z';
const PROVIDER_TS = '2026-08-02T22:00:01.000Z';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function fixture(options = {}) {
  const surface = options.surface === 'samples' ? 'samples' : 'calendar';
  const teams = options.multiple ? ['video', 'graphics'] : ['video'];
  const deliverables = teams.map(team => {
    const suffix = team === 'video' ? 'video' : 'graphics';
    const issueId = team === 'video' ? 'linear-test-issue' : 'linear-test-graphics-issue';
    return {
      id: `test-deliverable-${suffix}`, batch_id: 'test-batch', client_slug: TEST_CLIENT,
      team, kind: team === 'video' ? 'video' : 'graphic', title: TARGET_TITLE, origin: surface,
      card_id: 'f133-test-card', linear_issue_uuid: issueId,
      linear_raw: {
        issue: { id: issueId, title: 'Before title', updatedAt: EVENT_TS },
        field_updated_at: { title: EVENT_TS },
      },
    };
  });
  const outboxes = deliverables.map((row, index) => ({
    id: 9101 + index, status: options.initialStatus || 'pending', entity: 'deliverable',
    entity_id: row.id, deliverable_id: row.id,
    batch_id: 'test-batch', comment_id: null, operation: 'title', op: 'update_fields',
    client_slug: TEST_CLIENT, team: row.team,
    dedup_key: `write-ui:title:deliverable:${row.id}:${REQUEST_ID}`,
    depends_on_id: null,
    payload: { title: TARGET_TITLE, _intent_fingerprint: `f133-test-fingerprint-${row.team}` },
    source_edited_at: EVENT_TS, test_only: true,
    legacy_parity: options.legacyParity === true, authority_generation: 0,
    attempts: 0, linear_result: null,
  }));
  const state = {
    drainCalls: [],
    lostDrainThrown: false,
    providerReads: [],
    providerTitle: options.providerTitle || TARGET_TITLE,
    event: {
      id: 9001,
      event_key: `write-ui:title:card:${surface}:${TEST_CLIENT}:f133-test-card:${REQUEST_ID}`,
      batch_id: 'test-batch',
      client_slug: TEST_CLIENT,
      ts: EVENT_TS,
      actor: 'TEST operator',
      role: 'admin',
      action: 'title_change',
      source: 'ui',
      payload: {
        surface, card_id: 'f133-test-card',
        from_title: 'Before title', from_title_revision: 0,
        title: TARGET_TITLE, title_revision: 1,
        auth_kind: 'staff', actor_key: 'member:test-operator',
        deliverable_count: teams.length, outbox_count: teams.length,
        expected_deliverable_titles: Object.fromEntries(deliverables.map(row => [row.id, 'Before title'])),
      },
    },
    card: {
      id: 'f133-test-card', client: TEST_CLIENT, name: TARGET_TITLE,
      title_revision: 1, updated_at: EVENT_TS,
      video_deliverable_id: 'test-deliverable-video',
      graphic_deliverable_id: options.multiple ? 'test-deliverable-graphics' : null,
    },
    deliverables,
    outboxes,
  };
  state.deliverable = state.deliverables[0];
  state.outbox = state.outboxes[0];

  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.linear.app') {
      const body = JSON.parse(init.body);
      if (body.query.includes('F133TestProjects')) {
        assert.deepStrictEqual(body.variables, {});
        return jsonResponse({ data: { projects: { nodes: [
          { id: 'linear-test-video-project', name: 'Sidney Laruel', teams: { nodes: [{ key: 'VID' }] } },
          { id: 'linear-test-graphics-project', name: 'Test Project', teams: { nodes: [{ key: 'GRA' }] } },
        ] } } });
      }
      const issueId = String(body.variables && body.variables.id || '');
      const native = state.deliverables.find(row => row.linear_issue_uuid === issueId);
      assert(native, `unexpected provider issue ${issueId}`);
      state.providerReads.push(issueId);
      const team = native.team;
      return jsonResponse({
        data: { issue: {
          id: issueId, identifier: team === 'video' ? 'VID-133' : 'GRA-133',
          title: state.providerTitle, updatedAt: PROVIDER_TS,
          team: team === 'video'
            ? { id: 'linear-video-team', key: 'VID', name: 'Video' }
            : { id: 'linear-graphics-team', key: 'GRA', name: 'Graphics' },
          project: {
            id: team === 'video'
              ? (options.providerProjectId || 'linear-test-video-project')
              : 'linear-test-graphics-project',
            name: team === 'video'
              ? (options.providerProjectName || 'Sidney Laruel') : 'Test Project',
          },
        } },
      });
    }
    if (url.pathname.endsWith('/functions/v1/linear-outbound')) {
      const body = JSON.parse(init.body);
      state.drainCalls.push(body);
      const selected = state.outboxes.find(row => row.dedup_key === body.target_dedup_key);
      assert(selected, 'drain targeted an unknown outbox');
      assert.deepStrictEqual(body, {
        target_dedup_key: selected.dedup_key,
        test_override: { client_slug: TEST_CLIENT, mode: 'live', authority: 'syncview' },
        confirm: 'B4_TEST_ONLY',
      });
      const native = state.deliverables.find(row => row.id === selected.entity_id);
      selected.status = 'written';
      selected.linear_result = {
        mutation: 'issueUpdate', issue_id: native.linear_issue_uuid, updated_at: PROVIDER_TS,
        mirror_actor_id: 'mirror-test-actor',
        expected: { id: native.linear_issue_uuid, input: { title: TARGET_TITLE } },
      };
      native.linear_raw = {
        issue: { id: native.linear_issue_uuid, title: TARGET_TITLE, updatedAt: PROVIDER_TS },
        field_updated_at: { title: PROVIDER_TS },
      };
      if (options.lostDrainResponseOnce && !state.lostDrainThrown) {
        state.lostDrainThrown = true;
        throw new Error('synthetic lost drain response');
      }
      return jsonResponse({
        ok: true,
        target: {
          dedup_key: selected.dedup_key, operation: 'title',
          test_only: true, status: 'written',
        },
      });
    }
    if (url.pathname.endsWith('/rest/v1/clients')) {
      return jsonResponse([{ slug: TEST_CLIENT, kind: 'test', active: true }]);
    }
    if (url.pathname.endsWith('/rest/v1/syncview_runtime_flags')) {
      return jsonResponse([
        { key: 'auth_enforcement', value: { mode: 'permissive' } },
        { key: 'f133_canonical_title_enabled', value: { enabled: true } },
        { key: 'linear_inbound_enabled', value: { enabled: true } },
        { key: 'linear_outbound_enabled', value: { mode: 'off' } },
        { key: 'prod_authority', value: { video: 'linear', graphics: 'linear' } },
      ]);
    }
    if (url.pathname.endsWith('/rest/v1/deliverable_events')) return jsonResponse([state.event]);
    if (url.pathname.endsWith('/rest/v1/mirror_outbox')) {
      const id = String(url.searchParams.get('id') || '').replace(/^eq\./, '');
      return jsonResponse(id ? state.outboxes.filter(row => String(row.id) === id) : state.outboxes);
    }
    if (url.pathname.endsWith(`/rest/v1/${surface === 'calendar' ? 'calendar_posts' : 'sample_reviews'}`)) {
      return jsonResponse([state.card]);
    }
    if (url.pathname.endsWith('/rest/v1/deliverables')) return jsonResponse(state.deliverables);
    throw new Error(`unexpected fixture route: ${url.pathname}`);
  };
  return { state, fetchImpl };
}

async function observe(overrides = {}, fixtureOptions = {}) {
  const test = fixture(fixtureOptions);
  const receipt = await runObservation({
    releaseSha: RELEASE_SHA,
    operation: OPERATION,
    confirmation: CONFIRMATION,
    requestCorrelationSha256: CORRELATION,
    supabaseUrl: 'https://example.supabase.co',
    serviceKey: 'service-secret',
    linearKey: 'linear-secret',
    fetchImpl: test.fetchImpl,
    ...overrides,
  });
  return { ...test, receipt };
}

async function expectFailure(code, overrides = {}, fixtureOptions = {}) {
  let caught;
  try { await observe(overrides, fixtureOptions); } catch (error) { caught = error; }
  assert(caught, `expected ${code} failure`);
  assert.strictEqual(caught.code, code);
  assert.deepStrictEqual(Object.keys(safeFailureReceipt(caught)).sort(), ['code', 'stage', 'status']);
  assert(!JSON.stringify(safeFailureReceipt(caught)).includes(TEST_CLIENT));
}

(async () => {
  const pass = await observe();
  assert.strictEqual(pass.receipt.status, 'PASS');
  assert.strictEqual(pass.receipt.event_count, 1);
  assert.strictEqual(pass.receipt.linked_deliverable_count, 1);
  assert.strictEqual(pass.receipt.terminal_title_intent_count, 1);
  assert.strictEqual(pass.receipt.provider_readback_count, 1);
  assert.strictEqual(pass.receipt.retained_audit_record_count, 2);
  assert.strictEqual(pass.receipt.title_equality, 'PASS');
  assert.match(pass.receipt.certificate_sha256, /^[a-f0-9]{64}$/);
  assert.strictEqual(pass.state.drainCalls.length, 1);
  assert.deepStrictEqual(pass.state.providerReads, ['linear-test-issue', 'linear-test-issue']);
  assert(!JSON.stringify(pass.receipt).includes(TEST_CLIENT));
  assert(!JSON.stringify(pass.receipt).includes(TARGET_TITLE));
  assert(!JSON.stringify(pass.receipt).includes('test-deliverable-video'));

  const samplesPair = await observe({}, {
    surface: 'samples', multiple: true, initialStatus: 'shadow_ok',
  });
  assert.strictEqual(samplesPair.receipt.linked_deliverable_count, 2);
  assert.strictEqual(samplesPair.receipt.terminal_title_intent_count, 2);
  assert.strictEqual(samplesPair.receipt.provider_readback_count, 2);
  assert.deepStrictEqual(
    samplesPair.state.drainCalls.map(call => call.target_dedup_key),
    samplesPair.state.outboxes.map(row => row.dedup_key),
    'two TEST title intents were not drained in exact serial outbox order',
  );

  const failedRetry = await observe({}, { initialStatus: 'failed' });
  assert.strictEqual(failedRetry.receipt.status, 'PASS');
  assert.strictEqual(failedRetry.state.drainCalls.length, 1);

  const replay = fixture();
  replay.state.outbox.status = 'written';
  replay.state.outbox.linear_result = {
    mutation: 'issueUpdate', issue_id: 'linear-test-issue', updated_at: PROVIDER_TS,
    mirror_actor_id: 'mirror-test-actor',
    expected: { id: 'linear-test-issue', input: { title: TARGET_TITLE } },
  };
  replay.state.deliverable.linear_raw = {
    issue: { id: 'linear-test-issue', title: TARGET_TITLE, updatedAt: PROVIDER_TS },
    field_updated_at: { title: PROVIDER_TS },
  };
  const replayReceipt = await runObservation({
    releaseSha: RELEASE_SHA, operation: OPERATION, confirmation: CONFIRMATION,
    requestCorrelationSha256: CORRELATION, supabaseUrl: 'https://example.supabase.co',
    serviceKey: 'service-secret', linearKey: 'linear-secret', fetchImpl: replay.fetchImpl,
  });
  assert.strictEqual(replayReceipt.status, 'PASS');
  assert.strictEqual(replay.state.drainCalls.length, 0, 'lost-response rerun must not repeat a terminal provider mutation');

  const lostResponse = fixture({ lostDrainResponseOnce: true });
  let lostFailure;
  try {
    await runObservation({
      releaseSha: RELEASE_SHA, operation: OPERATION, confirmation: CONFIRMATION,
      requestCorrelationSha256: CORRELATION, supabaseUrl: 'https://example.supabase.co',
      serviceKey: 'service-secret', linearKey: 'linear-secret', fetchImpl: lostResponse.fetchImpl,
    });
  } catch (error) { lostFailure = error; }
  assert(lostFailure);
  assert.strictEqual(lostFailure.code, 'TARGET_DRAIN_RESPONSE_UNKNOWN');
  const lostRetryReceipt = await runObservation({
    releaseSha: RELEASE_SHA, operation: OPERATION, confirmation: CONFIRMATION,
    requestCorrelationSha256: CORRELATION, supabaseUrl: 'https://example.supabase.co',
    serviceKey: 'service-secret', linearKey: 'linear-secret', fetchImpl: lostResponse.fetchImpl,
  });
  assert.strictEqual(lostRetryReceipt.status, 'PASS');
  assert.strictEqual(lostResponse.state.drainCalls.length, 1,
    'lost-response retry repeated an already-terminal provider mutation');

  const alreadyApplied = fixture();
  alreadyApplied.state.outbox.status = 'skipped';
  alreadyApplied.state.outbox.linear_result = {
    mutation: 'issueUpdate', issue_id: 'linear-test-issue', updated_at: PROVIDER_TS,
    mirror_actor_id: 'mirror-test-actor',
    expected: { id: 'linear-test-issue', input: { title: TARGET_TITLE } },
    conflict: { decision: 'already_applied' },
  };
  alreadyApplied.state.deliverable.linear_raw = {
    issue: { id: 'linear-test-issue', title: TARGET_TITLE, updatedAt: PROVIDER_TS },
    field_updated_at: { title: PROVIDER_TS },
  };
  const alreadyAppliedReceipt = await runObservation({
    releaseSha: RELEASE_SHA, operation: OPERATION, confirmation: CONFIRMATION,
    requestCorrelationSha256: CORRELATION, supabaseUrl: 'https://example.supabase.co',
    serviceKey: 'service-secret', linearKey: 'linear-secret', fetchImpl: alreadyApplied.fetchImpl,
  });
  assert.strictEqual(alreadyAppliedReceipt.status, 'PASS');
  assert.strictEqual(alreadyApplied.state.drainCalls.length, 0);

  // Seeded red proofs: a foreign lane binder and provider divergence must each
  // stop before a public receipt could expose any private identity or title.
  await expectFailure('OUTBOX_SCOPE_INVALID', {}, { legacyParity: true });
  const foreignProvider = fixture({ providerProjectId: 'real-client-project' });
  let foreignProviderFailure;
  try {
    await runObservation({
      releaseSha: RELEASE_SHA, operation: OPERATION, confirmation: CONFIRMATION,
      requestCorrelationSha256: CORRELATION, supabaseUrl: 'https://example.supabase.co',
      serviceKey: 'service-secret', linearKey: 'linear-secret', fetchImpl: foreignProvider.fetchImpl,
    });
  } catch (error) { foreignProviderFailure = error; }
  assert(foreignProviderFailure);
  assert.strictEqual(foreignProviderFailure.code, 'LINEAR_TEST_ISSUE_SCOPE_INVALID');
  assert.strictEqual(foreignProvider.state.drainCalls.length, 0,
    'a provider issue outside the reviewed TEST project reached the drainer');
  await expectFailure('TITLE_EQUALITY_MISMATCH', {}, { providerTitle: 'Foreign provider title' });
  await expectFailure('REQUEST_CORRELATION_NOT_UNIQUE', {
    requestCorrelationSha256: 'b'.repeat(64),
  });

  const trigger = WORKFLOW.slice(WORKFLOW.indexOf('on:'), WORKFLOW.indexOf('permissions:'));
  assert.match(trigger, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(trigger, /^\s{2}(?:push|pull_request|schedule|repository_dispatch):/m);
  assert.match(trigger, /operation:[\s\S]*?type: choice[\s\S]*?- observe-reviewed-test-title/);
  assert.match(trigger, /request_correlation_sha256:[\s\S]*?required: true[\s\S]*?type: string/);
  assert.doesNotMatch(trigger, /(?:client|card|deliverable|dedup|title|slug)_id:\n\s*description:/);

  const trustAt = WORKFLOW.indexOf('- name: Validate trusted current-main release and fixed operation');
  const releaseAt = WORKFLOW.indexOf('- name: Check out exactly the reviewed release');
  const secretAt = WORKFLOW.indexOf('${{ secrets.');
  assert(trustAt >= 0 && releaseAt > trustAt && secretAt > releaseAt);
  assert(WORKFLOW.slice(trustAt, releaseAt).includes('$RELEASE_SHA" != "$GITHUB_SHA'));
  assert(WORKFLOW.includes("F133_OPERATION\" != 'observe-reviewed-test-title'"));
  assert(WORKFLOW.includes("F133_CONFIRM\" != 'OBSERVE_REVIEWED_F133_CANONICAL_TITLE_TEST'"));
  assert(SCRIPT.includes("confirm: 'B4_TEST_ONLY'"));
  assert(WORKFLOW.includes('Caller-selectable client/card/deliverable/dedup: none'));
  assert(!WORKFLOW.includes('upload-artifact'));

  assert(RUNBOOK.includes('.github/workflows/f133-test-title-observe.yml'));
  assert(RUNBOOK.includes('operation=observe-reviewed-test-title'));
  assert(RUNBOOK.includes('confirm=OBSERVE_REVIEWED_F133_CANONICAL_TITLE_TEST'));
  assert(RUNBOOK.includes('request_correlation_sha256=<SHA256_OF_PRIVATE_BROWSER_REQUEST_ID>'));
  assert(RUNBOOK.includes('retains every TEST title event and terminal outbox row as audit evidence'));

  console.log('F133 TEST title observation checks passed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
