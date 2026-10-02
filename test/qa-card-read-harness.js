'use strict';
// Execute each real harness with fileless curl/fetch fakes: direct card REST is
// refused, as after phase 2. No browser, live request, credential or data file.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { TEST_CLIENT } = require('../qa/test-client-entry.js');
const root = path.resolve(__dirname, '..');
const staff = 'synthetic-staff-key', token = 'synthetic-client-token';
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log('OK ' + name); }

function harness(file, env) {
  const calls = [], state = { status: 200, body: '[{"id":"qa-card","status":"Archived"}]', fail: false };
  const request = (url, headers) => {
    calls.push({ url, headers });
    if (state.fail) throw new Error('transport detail containing ' + staff + token);
    const parsed = new URL(url);
    if (/\/rest\/v1\/(calendar_posts|sample_reviews)$/.test(parsed.pathname)) return { status: 403, body: '{}' };
    if (parsed.pathname === '/functions/v1/card-read') {
      assert.equal(parsed.searchParams.get('client'), 'eq.' + TEST_CLIENT.slug);
      assert.equal(headers['x-syncview-key'] || headers['x-syncview-client-token'], env.SYNCVIEW_STAFF_KEY || env.SYNCVIEW_TEST_CLIENT_TOKEN);
      assert(!(headers['x-syncview-key'] && headers['x-syncview-client-token']));
    }
    return { status: state.status, body: state.body };
  };
  const childProcess = {
    spawn() { throw new Error('unexpected process'); },
    spawnSync(binary, args, options) {
      assert.deepEqual(Array.from(args), ['--config', '-']);
      const config = options.input;
      const url = JSON.parse(config.match(/^url = (".*")$/m)[1]);
      const headers = {};
      for (const match of config.matchAll(/^header = (".*")$/gm)) {
        const value = JSON.parse(match[1]), colon = value.indexOf(':');
        headers[value.slice(0, colon).toLowerCase()] = value.slice(colon + 1).trim();
      }
      const marker = JSON.parse(config.match(/^write-out = (".*")$/m)[1]).split('%{http_code}')[0];
      const response = request(url, headers);
      return { status: 0, stdout: Buffer.from(response.body + marker + response.status + '\tapplication/json' + marker) };
    },
  };
  function load(name) {
    const filename = path.join(root, name), module = { exports: {} };
    const sandbox = { module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
      console, URL, URLSearchParams, Buffer, SharedArrayBuffer, Int32Array,
      Atomics: { wait() {} }, setTimeout, clearTimeout,
      process: { env, platform: process.platform },
      fetch: async (url, options) => {
        const response = request(url, Object.fromEntries(Object.entries(options.headers).map(([k,v])=>[k.toLowerCase(),v])));
        return new Response(response.body, { status: response.status });
      },
      require(spec) {
        if (spec.endsWith('card-read.js')) return load('qa/card-read.js');
        if (spec.endsWith('test-client-entry.js')) return require('../qa/test-client-entry.js');
        if (spec === 'child_process') return childProcess;
        if (spec === 'fs') return { mkdirSync() {} };
        if (spec.endsWith('staff-gate-seed.js')) return { isFakeStaffKey: require('../qa/staff-gate-seed.js').isFakeStaffKey, seedStaffGate: async () => {} };
        if (spec.endsWith('write_ui_reroute_fixture.js')) return require('../qa/write_ui_reroute_fixture.js');
        if (spec.endsWith('native_work_item_fixture.js')) return { applyProbeWorkItems: async () => {} };
        if (spec === 'playwright' || spec.endsWith('golden_lib.js')) return {};
        return require(spec);
      },
    };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8') + (name === 'qa/probes/lib.js' || name === 'qa/sxr_courier_lib.js' ? '\nmodule.exports.__readContext = _ctx;' : ''), sandbox, { filename });
    return module.exports;
  }
  return { api: load(file), calls, state };
}

(async () => {
  const cases = [
    ['qa/probes/lib.js', api => api.rawRow('qa-card & encoded', 'id,status')],
    ['qa/ef-writepath/lib.js', api => api.supaCal('id=eq.qa-card&select=id,status')],
    ['qa/ef-writepath/lib.js', api => api.supaSample('name=eq.fixture&select=id,status')],
    ['qa/sxr_courier_lib.js', api => api.supa('name=like.*fixture*&select=id,status')],
    ['qa/sxr_courier_lib.js', api => api.supaCal('video_deliverable_id=not.is.null&graphic_deliverable_id=not.is.null&order=id&select=id,status')],
  ];
  for (const [mode, env] of [['staff', { SYNCVIEW_STAFF_KEY: staff }], ['client', { SYNCVIEW_TEST_CLIENT_TOKEN: token }]]) {
    await check(mode + ': all three real QA readers use authenticated card-read with the TEST scope', async () => {
      for (const [file, read] of cases) {
        const fixture = harness(file, env), result = await read(fixture.api);
        assert.equal((Array.isArray(result) ? result[0] : result).id, 'qa-card');
        assert.equal(fixture.calls.length, 1);
        assert.equal(new URL(fixture.calls[0].url).pathname, '/functions/v1/card-read');
        if (file === 'qa/probes/lib.js') assert.equal(new URL(fixture.calls[0].url).searchParams.get('id'), 'eq.qa-card & encoded');
      }
    });
  }
  await check('missing credentials refuse before transport; refusals and malformed replies never look empty or fall back', async () => {
    for (const [file, read] of cases) {
      const missing = harness(file, {});
      await assert.rejects(async () => read(missing.api)); assert.equal(missing.calls.length, 0);
      for (const [status, body, fail] of [[401, '{}', false], [503, '{}', false], [200, '{}', false], [200, 'invalid', false], [200, '[]', true]]) {
        const fixture = harness(file, { SYNCVIEW_STAFF_KEY: staff }); Object.assign(fixture.state, { status, body, fail });
        await assert.rejects(async () => read(fixture.api), error => !error.message.includes(staff) && !error.message.includes(token));
        assert.equal(fixture.calls.length, 1);
      }
    }
  });
  await check('staff wins when both credentials are supplied; foreign or duplicate client filters refuse', async () => {
    const fixture = harness('qa/ef-writepath/lib.js', { SYNCVIEW_STAFF_KEY: staff, SYNCVIEW_TEST_CLIENT_TOKEN: token });
    fixture.api.supaCal('select=id');
    assert.equal(fixture.calls[0].headers['x-syncview-client-token'], undefined);
    for (const qs of ['client=eq.foreignfixture', 'client=eq.' + TEST_CLIENT.slug + '&client=eq.foreignfixture']) assert.throws(() => fixture.api.supaSample(qs));
    assert.equal(fixture.calls.length, 1);
  });
  await check('events retain their original REST transport and publishable headers', async () => {
    for (const [file, methods] of [['qa/ef-writepath/lib.js', ['supaCalEvents', 'supaSampleEvents']], ['qa/sxr_courier_lib.js', ['supaEvents']]]) {
      const fixture = harness(file, {});
      for (const method of methods) fixture.api[method]('select=id');
      for (const call of fixture.calls) { assert(new URL(call.url).pathname.startsWith('/rest/v1/')); assert.equal(call.headers['x-syncview-key'], undefined); }
    }
  });
  await check('polling sees saved cards and cleanup refuses to claim success after an unreadable card', async () => {
    const probes = harness('qa/probes/lib.js', { SYNCVIEW_STAFF_KEY: staff });
    assert.equal((await probes.api.pollRaw('qa-card', row => row.status === 'Archived')).id, 'qa-card');
    const ef = harness('qa/ef-writepath/lib.js', { SYNCVIEW_STAFF_KEY: staff });
    assert.equal((await ef.api.pollSample('qa-card', row => row.status === 'Archived')).id, 'qa-card');
    const sxr = harness('qa/sxr_courier_lib.js', { SYNCVIEW_STAFF_KEY: staff });
    assert.equal(sxr.api.archiveSafe('qa-card', 1), true); assert.equal(sxr.api.archiveCalSafe('qa-card', 1), true);
    sxr.state.status = 503;
    assert.equal(sxr.api.archiveSafe('qa-card', 1), false); assert.equal(sxr.api.archiveCalSafe('qa-card', 1), false);
    assert(sxr.calls.every(call => new URL(call.url).pathname === '/functions/v1/card-read'));
  });
  await check('actual function accepts the QA name and deliverable filters with staff or client credentials', async () => {
    const { handleCardRead } = await import('../supabase/functions/_shared/card-read.mjs');
    const fixture = harness('qa/sxr_courier_lib.js', { SYNCVIEW_TEST_CLIENT_TOKEN: token });
    fixture.api.supaCal('name=like.*fixture*&video_deliverable_id=not.is.null&graphic_deliverable_id=not.is.null&order=id&select=id');
    const call = fixture.calls[0];
    for (const headers of [call.headers, { 'x-syncview-key': staff }]) {
    const response = await handleCardRead(new Request(call.url, { headers }), {
      staffAuthorized: key => key === staff,
      clientAuthorized: async (slug, key) => slug === TEST_CLIENT.slug && key === token,
      read: async (table, query) => { assert.equal(query.get('order'), 'id.asc'); assert.equal(query.get('name'), 'like.*fixture*'); return Response.json([{ id: 'qa-card' }]); },
    });
    assert.equal(response.status, 200); assert.equal((await response.json())[0].id, 'qa-card');
    }
  });
  await check('staff page card GETs replace the synthetic entry key; client tabs and other requests retain their credentials', async () => {
    const { cardReadStaffHeaders } = require('../qa/card-read.js');
    const base = 'https://fixture.invalid', url = base + '/functions/v1/card-read';
    const env = { SYNCVIEW_STAFF_KEY: staff }, seeded = { 'X-Syncview-Key': 'qa-staff-gate-key' };
    assert.equal(cardReadStaffHeaders(base, 'GET', url, seeded, false, env)['x-syncview-key'], staff);
    for (const [method, target, headers, clientCtx] of [['GET', url, seeded, true], ['GET', url, { 'x-syncview-client-token': token }, false], ['GET', url, { 'x-syncview-key': 'real-fixture-credential' }, false], ['POST', url, seeded, false], ['GET', base + '/rest/v1/workload_issues', seeded, false], ['GET', 'https://foreign.invalid/functions/v1/card-read', seeded, false]]) assert.equal(cardReadStaffHeaders(base, method, target, headers, clientCtx, env), null);
    for (const file of ['qa/probes/lib.js', 'qa/ef-writepath/lib.js', 'qa/sxr_courier_lib.js']) {
      const fixture = harness(file, env), routes = [];
      const ctx = { addInitScript: async () => {}, route: async (pattern, handler) => routes.push({ pattern, handler }) };
      const browser = { newContext: async () => ctx };
      if (file === 'qa/ef-writepath/lib.js') await fixture.api.makeCtx(browser);
      else await fixture.api.__readContext(browser);
      const target = file === 'qa/probes/lib.js' ? routes.find(r => typeof r.pattern === 'string' && r.pattern.includes('/card-read')).handler : routes.find(r => r.pattern === '**/*').handler;
      const apiUrl = fixture.api.SUPA.replace(/\/rest\/v1\/calendar_posts$/, '') + '/functions/v1/card-read?table=calendar_posts&client=eq.' + TEST_CLIENT.slug;
      let continued;
      await target({ request: () => ({ method: () => 'GET', url: () => apiUrl, headers: () => seeded, postData: () => null }), continue: async options => { continued = options; }, fulfill: async () => {}, fallback: async () => {} });
      if (file === 'qa/probes/lib.js') assert.equal(continued.headers['x-syncview-key'], staff);
      else assert.equal(fixture.calls.at(-1).headers['x-syncview-key'], staff);
    }
  });
  console.log('qa-card-read-harness: ' + passed + ' checks passed; three harnesses; no live requests');
})().catch(error => { console.error(error); process.exitCode = 1; });
