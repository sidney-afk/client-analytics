'use strict';

const assert = require('node:assert/strict');
const CLIENT_ENTRY = require('../qa/test-client-entry.js');
const {
  ISSUER_URL,
  STAFF_KEY_ENV,
  TEST_CLIENT,
  clientEntrySafeChildEnv,
  createCurrentTestClientTokenResolver,
  requireTestClientToken,
  resolveCurrentTestClientToken,
  testClientEntryPath,
} = CLIENT_ENTRY;

const SYNTHETIC_TOKEN = 'synthetic-test-client-token';

assert.equal(
  Object.hasOwn(CLIENT_ENTRY, 'exportTokenToGitHubEnv'),
  false,
  'shared helper must not expose a cross-process token exporter',
);

function queryFor(view) {
  const url = new URL(testClientEntryPath(view, TEST_CLIENT.name, SYNTHETIC_TOKEN), 'https://fixture.invalid');
  assert.equal(url.hash, '');
  assert.equal(url.searchParams.getAll('c').length, 1);
  assert.equal(url.searchParams.getAll('t').length, 1);
  assert.equal(url.searchParams.get('c'), TEST_CLIENT.name);
  assert.equal(url.searchParams.get('t'), SYNTHETIC_TOKEN);
  assert.equal(url.searchParams.has('v2debug'), false);
  assert.equal(url.searchParams.has('Kasper'), false);
  assert.equal(url.searchParams.has('prod'), false);
  return url.searchParams;
}

const priorLegacyToken = process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
process.env.SYNCVIEW_TEST_CLIENT_TOKEN = SYNTHETIC_TOKEN;
assert.throws(
  () => requireTestClientToken(),
  /explicit current TEST-client token is required/,
  'live client routes must reject even a legacy inherited token',
);
if (priorLegacyToken === undefined) delete process.env.SYNCVIEW_TEST_CLIENT_TOKEN;
else process.env.SYNCVIEW_TEST_CLIENT_TOKEN = priorLegacyToken;

const calendar = queryFor('calendar');
assert.deepEqual([...calendar.keys()].sort(), ['c', 't', 'v']);
assert.equal(calendar.get('v'), 'calendar');

const brief = queryFor('brief');
assert.deepEqual([...brief.keys()].sort(), ['c', 't', 'v']);
assert.equal(brief.get('v'), 'brief');

const analytics = queryFor('analytics');
assert.deepEqual([...analytics.keys()].sort(), ['c', 't']);

const samples = queryFor('sample-reviews');
assert.deepEqual([...samples.keys()].sort(), ['c', 'sxr', 't', 'v']);
assert.equal(samples.get('v'), 'sample-reviews');
assert.equal(samples.get('sxr'), '1');

assert.throws(
  () => testClientEntryPath('calendar', 'A Real Client', SYNTHETIC_TOKEN),
  /restricted to the TEST client/,
  'live harness URL construction must stay scoped to the TEST client',
);

(async () => {
  const calls = [];
  const resolved = await resolveCurrentTestClientToken({
    staffKey: 'synthetic-staff-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, client: TEST_CLIENT.slug, token: SYNTHETIC_TOKEN }),
      };
    },
  });
  assert.equal(resolved, SYNTHETIC_TOKEN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ISSUER_URL);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['X-Syncview-Key'], 'synthetic-staff-key');
  assert.deepEqual(JSON.parse(calls[0].options.body), { client: TEST_CLIENT.slug });

  await assert.rejects(
    resolveCurrentTestClientToken({ staffKey: '' }),
    new RegExp(`${STAFF_KEY_ENV} is required`),
  );
  for (const fixture of [
    { response: { ok: false, status: 401, json: async () => ({ error: 'secret-body-marker' }) }, pattern: /HTTP 401/ },
    { response: { ok: false, status: 500, json: async () => ({ error: 'secret-body-marker' }) }, pattern: /HTTP 500/ },
    { response: { ok: true, status: 200, json: async () => ({ ok: true, client: 'wrong-client', token: 'secret-body-marker' }) }, pattern: /invalid contract/ },
    { response: { ok: true, status: 200, json: async () => ({ ok: true, client: TEST_CLIENT.slug }) }, pattern: /invalid contract/ },
  ]) {
    await assert.rejects(
      resolveCurrentTestClientToken({
        staffKey: 'synthetic-staff-key',
        fetchImpl: async () => fixture.response,
      }),
      error => fixture.pattern.test(error.message) && !error.message.includes('secret-body-marker'),
    );
  }

  let cachedResolverCalls = 0;
  const currentToken = createCurrentTestClientTokenResolver({
    staffKey: 'synthetic-staff-key',
    fetchImpl: async () => {
      cachedResolverCalls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, client: TEST_CLIENT.slug, token: SYNTHETIC_TOKEN }),
      };
    },
  });
  assert.deepEqual(
    await Promise.all([currentToken(), currentToken()]),
    [SYNTHETIC_TOKEN, SYNTHETIC_TOKEN],
  );
  assert.equal(cachedResolverCalls, 1, 'one harness process resolves the current token once');

  const unsafeEnv = {
    PATH: '/synthetic/bin',
    [STAFF_KEY_ENV]: 'synthetic-staff-key',
    SYNCVIEW_TEST_CLIENT_TOKEN: SYNTHETIC_TOKEN,
  };
  assert.deepEqual(
    clientEntrySafeChildEnv(unsafeEnv),
    { PATH: '/synthetic/bin' },
    'browser and unrelated child environments strip client-entry credentials',
  );
  assert.equal(unsafeEnv[STAFF_KEY_ENV], 'synthetic-staff-key', 'source environment is not mutated');

  console.log('TEST client entry harness checks: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
