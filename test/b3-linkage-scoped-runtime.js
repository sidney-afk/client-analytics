'use strict';

/*
 * Offline orchestration checks for the exceptional B3 lane. All dependencies
 * are synthetic; this file never opens a network connection or invokes an RPC.
 */

const assert = require('assert');
const {
  buildPublicSummary,
  databaseFailureFromBody,
  executeApplyOnceAndReadback,
  productionDeps,
  publicDatabaseFailure,
} = require('../scripts/b3-linkage-scoped-repair.js');

const PLAN = Object.freeze({
  expected_count: 15,
  scope_digest: '1'.repeat(64),
  plan_digest: '2'.repeat(64),
  global_failure_count: 266,
  global_failure_digest: '3'.repeat(64),
});

function exactReceipt() {
  return {
    id: 1,
    deliverable_id: null,
    batch_id: null,
    client_slug: '_system',
    actor: 'b3-scoped-runner',
    role: 'service_role',
    action: 'b3_scoped_card_linkage_apply',
    source: 'reconcile',
    event_key: 'b3-scoped-card-linkage:' + PLAN.plan_digest,
    payload: {
      contract: 'b3-scoped-card-linkage/v1',
      applied_count: PLAN.expected_count,
      scope_digest: PLAN.scope_digest,
      plan_digest: PLAN.plan_digest,
      global_failure_count: PLAN.global_failure_count,
      global_failure_digest: PLAN.global_failure_digest,
      calendar_event_digest: '4'.repeat(64),
      identity_fields: false,
      mutation: 'calendar_graphic_pointer_only',
    },
  };
}

async function main() {
  assert.deepStrictEqual(
    publicDatabaseFailure('B3C01', 'REFUSED_CONTENTION'),
    { code: 'B3C01', failure_class: 'REFUSED_CONTENTION' },
  );
  assert.deepStrictEqual(
    publicDatabaseFailure('b3c01', 'refused_contention'),
    { code: '', failure_class: '' },
    'database code/message matching is exact and case-sensitive',
  );
  assert.deepStrictEqual(
    databaseFailureFromBody({
      code: 'B3P03',
      message: 'REFUSED_CROSSWALK',
      details: 'fictional-private-row-details',
      hint: 'fictional-private-provider-hint',
    }),
    { code: 'B3P03', failure_class: 'REFUSED_CROSSWALK' },
  );
  assert.deepStrictEqual(
    publicDatabaseFailure('B3C01', 'REFUSED_LIVE_DRIFT'),
    { code: '', failure_class: '' },
    'a code with the wrong fixed message must not enter public output',
  );

  const knownRefusalDeps = productionDeps({
    url: 'https://fictional-project.supabase.co',
    serviceKey: 'fictional-service-key',
  }, async function fixedRefusal() {
    return {
      ok: false,
      status: 409,
      async json() {
        return {
          code: 'B3C01',
          message: 'REFUSED_CONTENTION',
          details: 'fictional-private-lock-details',
          hint: 'fictional-private-lock-hint',
        };
      },
    };
  });
  const knownRefusal = await knownRefusalDeps.applyRpc(PLAN);
  assert.deepStrictEqual(knownRefusal, {
    acknowledged: false,
    code: 'B3C01',
    failure_class: 'REFUSED_CONTENTION',
  });
  assert.ok(!JSON.stringify(knownRefusal).includes('fictional-private'));
  let knownPreflightError;
  try {
    await knownRefusalDeps.preflightRpc();
    assert.fail('known preflight refusal must fail closed');
  } catch (error) {
    knownPreflightError = error;
  }
  assert.strictEqual(knownPreflightError.message, 'database_preflight_refused');
  assert.strictEqual(knownPreflightError.public_database_failure_code, 'B3C01');
  assert.strictEqual(
    knownPreflightError.public_database_failure_class,
    'REFUSED_CONTENTION',
  );
  assert.ok(!JSON.stringify(knownPreflightError).includes('fictional-private'));

  const unknownRefusalDeps = productionDeps({
    url: 'https://fictional-project.supabase.co',
    serviceKey: 'fictional-service-key',
  }, async function unknownRefusal() {
    return {
      ok: false,
      status: 409,
      async json() {
        return {
          code: '55P03',
          message: 'fictional-private-lock-timeout',
          details: 'fictional-private-row-details',
        };
      },
    };
  });
  const unknownRefusal = await unknownRefusalDeps.applyRpc(PLAN);
  assert.deepStrictEqual(unknownRefusal, {
    acknowledged: false,
    code: 'rpc_http_409',
    failure_class: '',
  });
  assert.ok(!JSON.stringify(unknownRefusal).includes('fictional-private'));
  let unknownPreflightError;
  try {
    await unknownRefusalDeps.preflightRpc();
    assert.fail('unknown preflight refusal must fail closed');
  } catch (error) {
    unknownPreflightError = error;
  }
  assert.strictEqual(unknownPreflightError.message, 'database_preflight_409');
  assert.strictEqual(unknownPreflightError.public_database_failure_code, '');
  assert.strictEqual(unknownPreflightError.public_database_failure_class, '');
  assert.ok(!JSON.stringify(unknownPreflightError).includes('fictional-private'));

  const publicRefusal = buildPublicSummary({
    ...PLAN,
    rpc_failure_code: 'B3C01',
    rpc_failure_class: 'REFUSED_CONTENTION',
    private_error: 'fictional-private-provider-body',
  }, { mode: 'apply', status: 'OUTCOME_UNKNOWN' });
  assert.strictEqual(publicRefusal.rpc_failure_code, 'B3C01');
  assert.strictEqual(publicRefusal.rpc_failure_class, 'REFUSED_CONTENTION');
  assert.ok(!JSON.stringify(publicRefusal).includes('fictional-private'));

  let applyCalls = 0;
  let readbackCalls = 0;
  let receiptCalls = 0;
  let verifierCalls = 0;
  const unknown = await executeApplyOnceAndReadback(
    PLAN,
    {
      async applyRpc() {
        applyCalls++;
        throw new Error('fictional_lost_response');
      },
      async loadLiveData(metadata) {
        readbackCalls++;
        assert.deepStrictEqual(metadata, { projectRef: 'fictional-project' });
        return { fictional: 'post-state' };
      },
      async loadApplyReceipt(plan) {
        receiptCalls++;
        assert.strictEqual(plan, PLAN);
        return [exactReceipt()];
      },
    },
    { projectRef: 'fictional-project' },
    function verify(plan, snapshot) {
      verifierCalls++;
      assert.strictEqual(plan.plan_digest, PLAN.plan_digest);
      assert.strictEqual(snapshot.fictional, 'post-state');
      return { ok: true, reasons: [] };
    },
  );
  assert.strictEqual(applyCalls, 1, 'an ambiguous outcome must never retry the RPC');
  assert.strictEqual(readbackCalls, 1, 'an ambiguous outcome must perform one independent readback');
  assert.strictEqual(receiptCalls, 1, 'an ambiguous outcome must prove one atomic apply receipt');
  assert.strictEqual(verifierCalls, 1, 'the independent state verifier must run exactly once');
  assert.strictEqual(unknown.rpc_result.acknowledged, false);
  assert.strictEqual(unknown.rpc_result.code, 'rpc_outcome_unknown');
  assert.strictEqual(unknown.status, 'APPLIED_CONFIRMED_BY_READBACK');

  applyCalls = 0;
  readbackCalls = 0;
  receiptCalls = 0;
  const gap = await executeApplyOnceAndReadback(
    PLAN,
    {
      async applyRpc() {
        applyCalls++;
        return { acknowledged: true };
      },
      async loadLiveData() {
        readbackCalls++;
        throw new Error('fictional_readback_failure');
      },
      async loadApplyReceipt() {
        receiptCalls++;
        return [exactReceipt()];
      },
    },
    {},
  );
  assert.strictEqual(applyCalls, 1);
  assert.strictEqual(readbackCalls, 1);
  assert.strictEqual(receiptCalls, 1);
  assert.deepStrictEqual(gap.readback, { ok: false, reasons: ['readback_unavailable'] });
  assert.strictEqual(gap.status, 'GAPS');

  applyCalls = 0;
  readbackCalls = 0;
  receiptCalls = 0;
  const fullyUnknown = await executeApplyOnceAndReadback(
    PLAN,
    {
      async applyRpc() {
        applyCalls++;
        throw new Error('fictional_lost_response');
      },
      async loadLiveData() {
        readbackCalls++;
        throw new Error('fictional_state_unavailable');
      },
      async loadApplyReceipt() {
        receiptCalls++;
        throw new Error('fictional_receipt_unavailable');
      },
    },
    {},
  );
  assert.strictEqual(applyCalls, 1);
  assert.strictEqual(readbackCalls, 1);
  assert.strictEqual(receiptCalls, 1);
  assert.deepStrictEqual(fullyUnknown.readback.reasons,
    ['readback_unavailable', 'receipt_readback_unavailable']);
  assert.strictEqual(fullyUnknown.status, 'OUTCOME_UNKNOWN');

  const malformed = await executeApplyOnceAndReadback(
    PLAN,
    {
      async applyRpc() { return null; },
      async loadLiveData() { return { fictional: 'post-state' }; },
      async loadApplyReceipt() { return [exactReceipt()]; },
    },
    {},
    function syntheticStateVerifier() { return { ok: true, reasons: [] }; },
  );
  assert.strictEqual(malformed.rpc_result.code, 'rpc_response_unconfirmed');
  assert.strictEqual(malformed.status, 'APPLIED_CONFIRMED_BY_READBACK');

  console.log('B3 scoped-linkage exactly-once/readback checks passed');
}

main().catch(function fail(error) {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
