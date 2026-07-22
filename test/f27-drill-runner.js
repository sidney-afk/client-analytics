'use strict';

const assert = require('node:assert/strict');
const {
  DRILL_TEAM,
  EXPECTED_AUTHORITY,
  EXPECTED_OUTBOUND,
  EXPECTED_PARITY,
  executeConfigured,
  F27OperatorError,
  F27TransportError,
  LiveRestEdgeTransport,
  postgresJsonbStringify,
  publicFailure,
  sha256,
  runF27Drill,
  runF27DrillResume,
  validateLiveConfig,
  validatePsqlConfig,
} = require('../scripts/f27-drill-runner.js');

const ROLLBACK_ID = '11111111-1111-4111-8111-111111111111';
const CORRELATION_ID = '22222222-2222-4222-8222-222222222222';
const OUTBOX_ID = 27;
const ACTOR = 'f27-unit-operator';
const PROJECT_REF = 'abcdefghijklmnopqrst';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fixtureTransport({
  tamperReplay = null,
  loseAfterBegin = false,
  loseAfterClassify = false,
  loseAfterReplay = false,
  loseAfterFinalize = false,
} = {}) {
  const rowSnapshot = {
    id: OUTBOX_ID,
    op: 'update_state',
    role: 'system',
    team: DRILL_TEAM,
    actor: 'F27 drill',
    payload: { value: 'noop', f27_drill: true },
    status: 'pending',
    entity: 'deliverable',
    operation: 'status',
    test_only: true,
    entity_id: `f27-drill:${ROLLBACK_ID}`,
    dedup_key: `f27-drill:${ROLLBACK_ID}`,
    client_slug: DRILL_TEAM,
    legacy_parity: false,
    authority_generation: 0,
    f27_drill_rollback_id: ROLLBACK_ID,
  };
  const rowHash = sha256(postgresJsonbStringify(rowSnapshot));
  const snapshotHash = sha256(rowHash);
  const state = {
    open: false,
    classification: null,
    history: [],
    terminal: null,
    linearResult: null,
    outboxStatus: 'skipped',
    complete: false,
  };
  const calls = [];
  const guards = {
    authority: EXPECTED_AUTHORITY,
    outbound: EXPECTED_OUTBOUND,
    parity: EXPECTED_PARITY,
    realOutbox: { count: 2, sha256: 'a'.repeat(64) },
    realFences: { count: 2, sha256: 'b'.repeat(64) },
    runtimeFlags: { count: 3, sha256: 'c'.repeat(64) },
    flagFlips: { count: 0, sha256: 'd'.repeat(64) },
    openRealRollbacks: 0,
    openDrills: 0,
  };
  const begin = {
    ok: true,
    type: 'f27_drill_snapshot_terminal',
    rollback_id: ROLLBACK_ID,
    correlation_id: CORRELATION_ID,
    team: DRILL_TEAM,
    is_drill: true,
    outbox_id: OUTBOX_ID,
    snapshot_count: 1,
    row_sha256: rowHash,
    snapshot_sha256: snapshotHash,
    normal_outbound: EXPECTED_OUTBOUND,
    legacy_parity: EXPECTED_PARITY,
    authority: EXPECTED_AUTHORITY,
  };
  const transport = {
    kind: 'unit-fixture',
    resumeConfirmation: 'F27_RESERVED_DRILL_RESUME',
    calls,
    async guardState() {
      calls.push('guard');
      return clone({
        ...guards,
        openDrills: state.open && !state.complete ? 1 : 0,
        openDrillRecovery: state.open && !state.complete
          ? { team: DRILL_TEAM, rollback_id: ROLLBACK_ID }
          : null,
      });
    },
    async beginDrill() {
      calls.push('begin');
      state.open = true;
      if (loseAfterBegin) {
        loseAfterBegin = false;
        throw new F27TransportError('f27_transport_unavailable', 'begin_drill');
      }
      transport.lastRecovery = {
        team: DRILL_TEAM,
        rollback_id: ROLLBACK_ID,
        resume_confirmation: transport.resumeConfirmation,
      };
      return clone(begin);
    },
    async readDrill() {
      calls.push('read');
      const replay = state.linearResult;
      const finalReceipt = state.complete ? {
        ok: true,
        type: 'f27_drill_terminal',
        rollback_id: ROLLBACK_ID,
        correlation_id: CORRELATION_ID,
        team: DRILL_TEAM,
        is_drill: true,
        snapshot_count: 1,
        snapshot_sha256: snapshotHash,
        unclassified: 0,
        unreceipted_replays: 0,
        replay_intents: 1,
        exact_terminal_replays: 1,
        active_drill_rows: 0,
        authority_before: EXPECTED_AUTHORITY,
        authority_after: EXPECTED_AUTHORITY,
        authority_cas: 'refused',
        authority_cas_reason: 'f27_drill_authority_cas_refused',
        normal_outbound: EXPECTED_OUTBOUND,
        legacy_parity: EXPECTED_PARITY,
        audit_history_retained: true,
      } : null;
      return clone({
        rollback: {
          id: ROLLBACK_ID,
          correlation_id: CORRELATION_ID,
          team: DRILL_TEAM,
          is_drill: true,
          state: state.complete ? 'complete' : 'open',
          expected_authority: EXPECTED_AUTHORITY,
          prior_outbound: EXPECTED_OUTBOUND,
          prior_parity: EXPECTED_PARITY,
          fence_generation: null,
          snapshot_count: 1,
          snapshot_sha256: snapshotHash,
          actor: ACTOR,
          terminal_receipt: finalReceipt,
          completed_at: state.complete ? '2026-07-22T00:00:00.000Z' : null,
        },
        intent: {
          rollback_id: ROLLBACK_ID,
          outbox_id: OUTBOX_ID,
          row_snapshot: rowSnapshot,
          row_sha256: rowHash,
          classification: state.classification,
          classification_history: state.history,
          reason: state.classification ? 'reserved drill replay' : null,
          classified_by: state.classification ? ACTOR : null,
          terminal_receipt: state.terminal,
        },
        outbox: {
          id: OUTBOX_ID,
          payload: { f27_drill: true, value: 'noop' },
          entity: 'deliverable',
          entity_id: `f27-drill:${ROLLBACK_ID}`,
          operation: 'status',
          client_slug: DRILL_TEAM,
          team: DRILL_TEAM,
          dedup_key: `f27-drill:${ROLLBACK_ID}`,
          status: state.outboxStatus,
          linear_result: replay,
          test_only: true,
          legacy_parity: false,
          authority_generation: 0,
          f27_drill_rollback_id: ROLLBACK_ID,
          lock_token: null,
          locked_at: null,
        },
      });
    },
    async readDrillByRollbackId(rollbackId) {
      calls.push('read-by-rollback');
      assert.equal(rollbackId, ROLLBACK_ID);
      return transport.readDrill();
    },
    async discoverOpenDrill() {
      calls.push('discover');
      return state.open && !state.complete
        ? { team: DRILL_TEAM, rollback_id: ROLLBACK_ID }
        : null;
    },
    async classify(_rollback, _outbox, classification) {
      calls.push(`classify:${classification}`);
      if (classification !== 'replay') {
        throw new F27TransportError('f27_drill_replay_classification_required', 'classify');
      }
      state.classification = 'replay';
      state.history = [{ from: null, to: 'replay', actor: ACTOR }];
      if (loseAfterClassify) {
        loseAfterClassify = false;
        throw new F27TransportError('f27_transport_unavailable', 'classify');
      }
      return { ok: true, type: 'f27_classification_terminal', classification: 'replay' };
    },
    async executeReplay() {
      calls.push('replay');
      const result = {
        ok: true,
        type: 'f27_drill_replay_terminal',
        f27_drill: true,
        f27_preflight: true,
        no_external_call: true,
        mutation: 'f27DrillNoop',
        issue_id: `${DRILL_TEAM}:${ROLLBACK_ID}`,
        expected: { input: { stateId: DRILL_TEAM } },
        rollback_id: ROLLBACK_ID,
        correlation_id: CORRELATION_ID,
        outbox_id: OUTBOX_ID,
        dedup_key: `f27-drill:${ROLLBACK_ID}`,
        operation: 'status',
        intent_snapshot_sha256: rowHash,
      };
      const receipt = { ...result, linear_result_sha256: sha256(postgresJsonbStringify(result)) };
      if (tamperReplay) tamperReplay(receipt, result);
      state.linearResult = result;
      state.terminal = receipt;
      state.outboxStatus = 'written';
      if (loseAfterReplay) {
        loseAfterReplay = false;
        throw new F27TransportError('f27_transport_unavailable', 'replay');
      }
      return receipt;
    },
    async recordTerminal() {
      calls.push('record');
      return { ok: true, type: 'f27_replay_terminal', is_drill: true, idempotent: true };
    },
    async finalizeOrdinary() {
      calls.push('finalize-ordinary');
      throw new F27TransportError('f27_drill_authority_cas_refused', 'finalize');
    },
    async finalizeDrill() {
      calls.push('finalize-drill');
      state.complete = true;
      state.open = false;
      if (loseAfterFinalize) {
        loseAfterFinalize = false;
        throw new F27TransportError('f27_transport_unavailable', 'finalize_drill');
      }
      return (await transport.readDrill()).rollback.terminal_receipt;
    },
  };
  return transport;
}

(async () => {
  assert.throws(() => validateLiveConfig({}, {}), error =>
    error instanceof F27OperatorError && error.code === 'f27_live_confirmation_required');
  assert.throws(() => validateLiveConfig({
    confirm: 'F27_RESERVED_DRILL_ONLY',
    'confirm-project': PROJECT_REF,
    actor: ACTOR,
  }, {
    SUPABASE_URL: 'https://tsrqponmlkjihgfedcba.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret',
  }), error => error.code === 'f27_live_url_project_mismatch');
  assert.deepEqual(validateLiveConfig({
    confirm: 'F27_RESERVED_DRILL_ONLY',
    'confirm-project': PROJECT_REF,
    actor: ACTOR,
  }, {
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret',
  }).projectRef, PROJECT_REF);
  for (const badUrl of [
    `https://${PROJECT_REF}.supabase.co.evil.example`,
    `https://${PROJECT_REF}.supabase.co@evil.example`,
    `https://${PROJECT_REF}.supabase.co/rest/v1`,
    `https://${PROJECT_REF}.supabase.co?redirect=evil`,
  ]) {
    assert.throws(() => validateLiveConfig({
      confirm: 'F27_RESERVED_DRILL_ONLY',
      'confirm-project': PROJECT_REF,
      actor: ACTOR,
    }, {
      SUPABASE_URL: badUrl,
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret',
    }), error => error.code === 'f27_live_url_project_mismatch');
  }
  let constructorFetchCalled = false;
  assert.throws(() => new LiveRestEdgeTransport({
    url: `https://${PROJECT_REF}.supabase.co.evil.example`,
    projectRef: PROJECT_REF,
    serviceKey: 'must-never-be-sent',
    resumeConfirmation: 'F27_RESERVED_DRILL_RESUME',
  }, async () => { constructorFetchCalled = true; }), error =>
    error.code === 'f27_live_url_project_mismatch');
  assert.equal(constructorFetchCalled, false,
    'the reusable live transport refuses a noncanonical host before any key-bearing fetch');
  let observedLiveInit = null;
  const redirectSafeTransport = new LiveRestEdgeTransport({
    url: `https://${PROJECT_REF}.supabase.co`,
    projectRef: PROJECT_REF,
    serviceKey: 'fixture-secret',
    resumeConfirmation: 'F27_RESERVED_DRILL_RESUME',
  }, async (_url, init) => {
    observedLiveInit = init;
    return { ok: true, status: 200, text: async () => '{}', headers: { get: () => null } };
  });
  await redirectSafeTransport.request('/rest/v1/f27_fixture', {
    method: 'GET', redirect: 'follow',
  }, 'redirect-test');
  assert.equal(observedLiveInit.redirect, 'error',
    'live service-role requests refuse redirects even when a caller asks to follow');
  const liveResume = validateLiveConfig({
    confirm: 'F27_RESERVED_DRILL_RESUME',
    'confirm-project': PROJECT_REF,
    'resume-rollback-id': ROLLBACK_ID,
    actor: ACTOR,
  }, {
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret',
  });
  assert.equal(liveResume.operation, 'resume');
  assert.equal(liveResume.resumeRollbackId, ROLLBACK_ID);
  assert.throws(() => validateLiveConfig({
    confirm: 'F27_RESERVED_DRILL_ONLY',
    'confirm-project': PROJECT_REF,
    'resume-rollback-id': ROLLBACK_ID,
    actor: ACTOR,
  }, {
    SUPABASE_URL: `https://${PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-secret',
  }), error => error.code === 'f27_live_resume_confirmation_required');

  assert.throws(() => validatePsqlConfig({
    confirm: 'F27_DISPOSABLE_DRILL_ONLY',
    'confirm-database': 'wrong',
    actor: ACTOR,
  }, { PGDATABASE: 'f27_operator_fixture' }), error =>
    error.code === 'f27_disposable_database_mismatch');
  assert.equal(validatePsqlConfig({
    confirm: 'F27_DISPOSABLE_DRILL_RESUME',
    'confirm-database': 'f27_operator_fixture',
    'resume-rollback-id': ROLLBACK_ID,
    actor: ACTOR,
  }, { PGDATABASE: 'f27_operator_fixture' }).operation, 'resume');

  const transport = fixtureTransport();
  const result = await runF27Drill(transport, { actor: ACTOR });
  assert.equal(result.terminal, 'F27_DRILL_RUNNER_OK');
  assert.equal(result.authority_cas, 'refused');
  assert.equal(result.audit_history_retained, true);
  assert.equal(result.dormant, true);
  assert(!JSON.stringify(result).includes(ROLLBACK_ID), 'public terminal must omit drill identifiers');
  assert.deepEqual(transport.calls, [
    'guard',
    'begin',
    'read',
    'classify:quarantine',
    'classify:discard',
    'classify:already_reflected',
    'read',
    'classify:replay',
    'read',
    'replay',
    'read',
    'record',
    'finalize-ordinary',
    'finalize-drill',
    'read',
    'read',
    'guard',
  ]);

  await assert.rejects(
    runF27Drill(fixtureTransport({
      tamperReplay(receipt) { receipt.no_external_call = false; },
    }), { actor: ACTOR }),
    error => error instanceof F27OperatorError && error.code === 'f27_drill_replay_terminal_invalid',
  );

  for (const [label, option, expectedStage] of [
    ['begin response', 'loseAfterBegin', 'unclassified'],
    ['classification response', 'loseAfterClassify', 'classified'],
    ['replay response', 'loseAfterReplay', 'terminal'],
    ['finalization response', 'loseAfterFinalize', 'finalized'],
  ]) {
    const resumable = fixtureTransport({ [option]: true });
    let lostError;
    try {
      await executeConfigured(resumable, {
        operation: 'start',
        actor: ACTOR,
        resumeConfirmation: 'F27_RESERVED_DRILL_RESUME',
      });
    } catch (error) {
      lostError = error;
    }
    assert(lostError instanceof F27TransportError
      && lostError.code === 'f27_transport_unavailable',
    `${label} must be modeled as lost after the database commit`);
    assert.deepEqual(publicFailure(lostError).recovery, {
      team: DRILL_TEAM,
      rollback_id: ROLLBACK_ID,
      resume_confirmation: 'F27_RESERVED_DRILL_RESUME',
    }, `${label} exposes only the synthetic recovery identity`);
    const resumed = await executeConfigured(resumable, {
      operation: 'resume',
      actor: ACTOR,
      resumeRollbackId: ROLLBACK_ID,
      resumeConfirmation: 'F27_RESERVED_DRILL_RESUME',
    });
    assert.equal(resumed.resumed, true, `${label} is safely resumable`);
    assert.equal(resumed.recovered_stage, expectedStage);
    assert.equal(resumed.dormant, true);
    assert(!JSON.stringify(resumed).includes(ROLLBACK_ID), 'resume terminal remains public-safe');
  }

  const stranded = fixtureTransport({ loseAfterBegin: true });
  await assert.rejects(runF27Drill(stranded, { actor: ACTOR }));
  await assert.rejects(
    runF27Drill(stranded, { actor: ACTOR }),
    error => error.code === 'f27_open_drill_present'
      && error.recovery
      && error.recovery.rollback_id === ROLLBACK_ID,
    'normal start refuses a pre-existing open drill and returns only its synthetic recovery identity',
  );
  try {
    await runF27Drill(stranded, { actor: ACTOR });
  } catch (error) {
    const failure = publicFailure(error);
    assert.deepEqual(failure.recovery, {
      team: DRILL_TEAM,
      rollback_id: ROLLBACK_ID,
      resume_confirmation: 'F27_RESERVED_DRILL_RESUME',
    });
    assert(!JSON.stringify(failure).includes(ACTOR),
      'public recovery omits actor, project, row bodies, and all non-synthetic identity');
  }
  await assert.rejects(
    runF27DrillResume(stranded, { actor: 'different-operator', rollbackId: ROLLBACK_ID }),
    error => error.code === 'f27_resume_actor_mismatch',
    'resume cannot attach under a different actor',
  );
  await assert.rejects(
    runF27DrillResume(stranded, {
      actor: ACTOR,
      rollbackId: '33333333-3333-4333-8333-333333333333',
    }),
    error => error.code === 'f27_resume_rollback_id_mismatch',
    'resume cannot attach to a different rollback id even when exactly one reserved drill is open',
  );

  process.stdout.write('f27-drill-runner tests: OK\n');
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
