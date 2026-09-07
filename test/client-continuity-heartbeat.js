'use strict';
const assert = require('node:assert/strict');
const { run, TIMING } = require('../scripts/client-continuity-heartbeat');
const { assessLiveness } = require('../scripts/client-continuity-monitor');
const path = require('node:path');
const env = {
  CONTINUITY_HEARTBEAT_ACTIVATION: 'OWNER_APPROVED_SENTINEL_HEARTBEAT',
  CONTINUITY_HEALTHCHECKS_PING_URL: 'https://hc-ping.com/11111111-1111-4111-8111-111111111111',
  CONTINUITY_CHECKOUT: path.resolve(__dirname, '..'),
};
const healthy = { status: 0, stdout: JSON.stringify({ ok: true, code: 'pinned_receipts_and_sentinel_healthy', lane: 'observer' }) };
const accepted = { status: 200, text: async () => 'OK' };
let groups = 0;
async function check(input, child, reply, expected) {
  let executions = 0, sends = 0, execution, request;
  const result = await run(input, {
    execute(file, args, options) { executions++; execution = { args, options }; if (child instanceof Error) throw child; return child; },
    async fetchImpl(url, options) { sends++; request = { url, options }; if (reply instanceof Error) throw reply; return reply; },
  });
  assert.deepEqual([executions, sends, result.code], expected);
  // Assert outside the wrapper's caught dependency calls, including red cases.
  if (execution) { assert.equal(path.basename(execution.args[0]), 'client-continuity-independent.js'); assert.equal(execution.args.length, 1); assert.equal(execution.options.env.CONTINUITY_ACTIVATION, 'OWNER_APPROVED_CONTINUITY_SENTINEL'); assert.equal(execution.options.timeout, 125000); }
  if (request) { assert.equal(request.url, env.CONTINUITY_HEALTHCHECKS_PING_URL + (child === healthy ? '' : '/fail')); assert.equal(request.options.method, 'POST'); assert.equal(request.options.redirect, 'error'); assert.equal(request.options.body, ''); assert(request.options.signal instanceof AbortSignal); }
  if (child !== healthy) assert.equal(result.ok, false, 'failure transport acceptance cannot green assessment');
  groups++; return result;
}
(async () => {
  await check({}, healthy, null, [0, 0, 'sentinel_heartbeat_refused']);
  for (const url of ['https://other.test/ping', env.CONTINUITY_HEALTHCHECKS_PING_URL + '?secret=x', 'http://hc-ping.com/11111111-1111-4111-8111-111111111111', 'https://hc-ping.com/slug', env.CONTINUITY_HEALTHCHECKS_PING_URL + '/fail', env.CONTINUITY_HEALTHCHECKS_PING_URL + '#fragment', 'https://user:pass@hc-ping.com/11111111-1111-4111-8111-111111111111']) {
    await check({ ...env, CONTINUITY_HEALTHCHECKS_PING_URL: url }, healthy, null, [0, 0, 'sentinel_heartbeat_refused']);
  }
  for (const checkout of ['relative', path.resolve(__dirname), path.resolve(__dirname, 'missing')]) await check({ ...env, CONTINUITY_CHECKOUT: checkout }, healthy, null, [0, 0, 'sentinel_heartbeat_refused']);
  for (const child of [{ status: 1 }, { ...healthy, status: 2 }, { ...healthy, error: Error('timeout') }, { ...healthy, signal: 'SIGTERM' }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not-json' }, Error('spawn failure')]) {
    await check(env, child, accepted, [1, 1, 'sentinel_failure_signalled']);
  }
  await check(env, healthy, { status: 200, text: async () => 'OK' }, [1, 1, 'sentinel_heartbeat_confirmed']);
  await check(env, healthy, { status: 200, text: async () => 'not OK' }, [1, 1, 'heartbeat_unconfirmed']);
  await check(env, healthy, { status: 503 }, [1, 1, 'heartbeat_unconfirmed']);
  await check(env, healthy, Error('lost reply'), [1, 1, 'heartbeat_unconfirmed']);
  for (const code of ['receipt_unconfirmed', 'receipt_binding_mismatch', 'delivery_unconfirmed', 'sentinel_unconfirmed', 'unknown-private-detail']) {
    const child = { status: 2, stdout: JSON.stringify({ ok: false, lane: 'observer', code }) };
    const result = await check(env, child, accepted, [1, 1, 'sentinel_failure_signalled']);
    assert.equal(result.assessmentCode, code === 'unknown-private-detail' ? 'sentinel_unconfirmed' : code);
  }
  for (const reply of [{ status: 302 }, { status: 503 }, { status: 200, text: async () => 'OK (not found)' }, Error('lost reply')]) {
    await check(env, { status: 2 }, reply, [1, 1, 'sentinel_failure_signal_unconfirmed']);
  }
  // Fake clock uses the real liveness threshold and real wrapper. Transport
  // delays are bounded assumptions, not a claim about provider delivery SLA.
  const t0 = 1000000, period = 300000, grace = 300000;
  const state = { lane: 'calendar', enabled: true, activatedAt: t0, lastStartedAt: t0,
    terminal: { startedAt: t0, finishedAt: t0, code: 'healthy', count: 1 } };
  assert.equal(assessLiveness(state, t0 + 599999).ok, true);
  assert.equal(assessLiveness(state, t0 + 600000).code, 'monitor_missing');
  const priorSuccess = t0 + 599999;
  assert.equal(priorSuccess + period + grace - t0, 1199999, 'old success-only path stacks nearly twenty minutes');
  let now = t0 + 600000 + period, emittedAt, requests = 0;
  const timed = await run(env, {
    execute(file, args, options) { now += options.timeout; return { status: 2 }; },
    async fetchImpl(url) { requests++; emittedAt = now; assert(url.endsWith('/fail')); now += TIMING.pingTimeoutMs; return accepted; },
  });
  assert.equal(emittedAt - (t0 + 600000), 425000);
  assert.equal(now - (t0 + 600000), 430000, 'poll + configured child timeout + ping budget = 7m10 after staleness, before delivery/jitter');
  assert.equal(now - t0, 1030000, 'conservative last-evidence budget remains 17m10; never label ten-minute W10 proof');
  assert.equal(requests, 1); assert.equal(timed.ok, false);
  assert.equal(period + grace, 600000, 'stopped independent host expires separately after ten minutes since last success');
  groups++;
  console.log(`PASS ${groups} offline wrapper/timing groups; no subprocess or network invoked; hosting/delivery/acknowledgement unproven`);
})().catch(error => { console.error(error); process.exitCode = 1; });
