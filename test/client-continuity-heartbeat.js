'use strict';
const assert = require('node:assert/strict');
const { run } = require('../scripts/client-continuity-heartbeat');
const path = require('node:path');
const env = {
  CONTINUITY_HEARTBEAT_ACTIVATION: 'OWNER_APPROVED_SENTINEL_HEARTBEAT',
  CONTINUITY_HEALTHCHECKS_PING_URL: 'https://hc-ping.com/11111111-1111-4111-8111-111111111111',
  CONTINUITY_CHECKOUT: path.resolve(__dirname, '..'),
};
const healthy = { status: 0, stdout: JSON.stringify({ ok: true, code: 'pinned_receipts_and_sentinel_healthy', lane: 'observer' }) };
async function check(input, child, reply, expected) {
  let executions = 0, sends = 0;
  const result = await run(input, {
    execute(file, args, options) { executions++; assert.equal(path.basename(args[0]), 'client-continuity-independent.js'); assert.equal(args.length, 1); assert.equal(options.env.CONTINUITY_ACTIVATION, 'OWNER_APPROVED_CONTINUITY_SENTINEL'); return child; },
    async fetchImpl(url, options) { sends++; assert.equal(url, env.CONTINUITY_HEALTHCHECKS_PING_URL); assert.equal(options.redirect, 'error'); assert.equal(options.body, ''); if (reply instanceof Error) throw reply; return reply; },
  });
  assert.deepEqual([executions, sends, result.code], expected);
}
(async () => {
  await check({}, healthy, null, [0, 0, 'sentinel_heartbeat_refused']);
  for (const url of ['https://other.test/ping', env.CONTINUITY_HEALTHCHECKS_PING_URL + '?secret=x', 'http://hc-ping.com/11111111-1111-4111-8111-111111111111', 'https://hc-ping.com/slug']) {
    await check({ ...env, CONTINUITY_HEALTHCHECKS_PING_URL: url }, healthy, null, [0, 0, 'sentinel_heartbeat_refused']);
  }
  for (const child of [{ status: 1 }, { status: 0, error: Error('timeout') }, { status: 0, signal: 'SIGTERM' }, { status: 0, stdout: '{}' }, { status: 0, stdout: 'not-json' }]) {
    await check(env, child, null, [1, 0, 'sentinel_unconfirmed']);
  }
  await check(env, healthy, { status: 200, text: async () => 'OK' }, [1, 1, 'sentinel_heartbeat_confirmed']);
  await check(env, healthy, { status: 200, text: async () => 'not OK' }, [1, 1, 'heartbeat_unconfirmed']);
  await check(env, healthy, { status: 503 }, [1, 1, 'heartbeat_unconfirmed']);
  await check(env, healthy, Error('lost reply'), [1, 1, 'heartbeat_unconfirmed']);
  console.log('PASS 14 offline wrapper groups; no subprocess or network invoked');
})().catch(error => { console.error(error); process.exitCode = 1; });
