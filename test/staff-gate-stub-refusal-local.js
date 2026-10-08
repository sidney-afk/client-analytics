'use strict';
// Headless suites sign in with a stub staff key the live backend cannot accept.
// Every production-write call carrying it used to reach the live function and
// land as an invalid_staff_key row in write_refusal_diagnostics.receipts_v1
// (~3,000 a day from CI), burying real client refusals. The shared gate seed now
// answers those calls in the browser with the same refusal. This proves:
//   1. a stub-key call never leaves the browser, and gets the live-shaped 401;
//   2. a call with any other key is NOT touched by the seed (falls through);
//   3. a suite's own production-write mock still wins over the seed.
// Fully offline: the fall-through case is answered by a route registered first.
const assert = require('assert/strict');
const http = require('http');
const { chromium } = require('playwright');
const { seedStaffGate, STAFF_GATE_KEY } = require('../qa/staff-gate-seed.js');

const EF = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/production-write';

async function callFrom(page, key) {
  return page.evaluate(async ({ url, key }) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key },
      body: JSON.stringify({ action: 'labels_read', surface: 'production', id: 'x' })
    });
    return { status: r.status, body: await r.json(), diag: r.headers.get('x-write-diagnostic-status') };
  }, { url: EF, key });
}

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>t</title>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    // Case 1 and 2. The "network" stand-in is registered FIRST, so it only
    // answers what the seed falls through on, exactly as the network would.
    const context = await browser.newContext();
    let reachedNetwork = 0;
    await context.route('**/functions/v1/production-write', route => {
      // The cross-origin preflight is not a production-write call; answer it
      // the way the live function's CORS does and do not count it.
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' } });
      reachedNetwork++;
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"from":"network"}' });
    });
    await seedStaffGate(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    const stub = await callFrom(page, STAFF_GATE_KEY);
    assert.equal(stub.status, 401);
    assert.deepEqual(stub.body, { ok: false, error: 'invalid_staff_key' });
    assert.equal(stub.diag, 'headless-stub');
    assert.equal(reachedNetwork, 0, 'a stub-key production-write must not reach the live backend');

    // Other invented keys (probes and suites that seed their own identity)
    // are fake too and are answered locally the same way (2026-09-25).
    const probe = await callFrom(page, 'probe-staff-key');
    assert.equal(probe.status, 401);
    assert.equal(probe.diag, 'headless-stub');
    assert.equal(reachedNetwork, 0, 'an invented probe key must not reach the live backend either');

    const other = await callFrom(page, 'some-other-key');
    assert.equal(other.body.from, 'network', 'a non-stub key must fall through to the network untouched');
    assert.equal(reachedNetwork, 1);
    await context.close();

    // Case 3: a suite mock registered after the seed still answers.
    const own = await browser.newContext();
    await seedStaffGate(own);
    await own.route('**/functions/v1/production-write', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"from":"suite"}' }));
    const p2 = await own.newPage();
    await p2.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal((await callFrom(p2, STAFF_GATE_KEY)).body.from, 'suite');
    await own.close();

    // Case 4 (analytics-read, 2026-09-28): a stub key's staff analytics read is
    // answered locally with "no mirror" (never reaching the live function);
    // a real-looking key falls through; keepAnalyticsRead leaves the suite's
    // own mock in charge.
    const AR = EF.replace('production-write', 'analytics-read');
    const readFrom = (pg, key) => pg.evaluate(async ({ url, key }) => {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Syncview-Key': key }, body: '{"scope":"overview"}' });
      return { status: r.status, body: await r.json() };
    }, { url: AR, key });
    const net = { hits: 0 };
    // Counts the preflight too: with the seed on, nothing about a stub-key
    // read (preflight included) may reach this stand-in for the network.
    const answerNetwork = ctx => ctx.route('**/functions/v1/analytics-read', route => {
      net.hits++;
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' } });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"from":"network"}' });
    });
    const ar = await browser.newContext();
    await answerNetwork(ar);
    await seedStaffGate(ar);
    const p3 = await ar.newPage();
    await p3.goto(`http://127.0.0.1:${server.address().port}/`);
    const stubRead = await readFrom(p3, STAFF_GATE_KEY);
    assert.equal(stubRead.status, 200);
    assert.deepEqual(stubRead.body, { ok: false, error: 'invalid_staff_key' });
    assert.equal(net.hits, 0, 'neither a stub-key analytics read nor its preflight may reach the live backend');
    const forged = await readFrom(p3, 'structure-fixture-key');
    assert.deepEqual(forged.body, { ok: false, error: 'invalid_staff_key' }, 'a key a suite forges mid-run is answered locally too');
    assert.equal(net.hits, 0, 'no harness key may reach the live analytics-read');
    await ar.close();

    const keep = await browser.newContext();
    await answerNetwork(keep);
    await seedStaffGate(keep, { keepAnalyticsRead: true });
    const p4 = await keep.newPage();
    await p4.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal((await readFrom(p4, STAFF_GATE_KEY)).body.from, 'network', 'keepAnalyticsRead leaves the suite mock in charge');
    await keep.close();

    // Case 5 (2026-09-28): the page must see analytics_mirror_read_enabled as
    // ABSENT, so a staff page never POSTs analytics-read at all; every other
    // flag in the same read still reaches the next handler untouched.
    const FLAGS = 'https://uzltbbrjidmjwwfakwve.supabase.co/rest/v1/syncview_runtime_flags';
    const flagCtx = await browser.newContext();
    const asked = [];
    await flagCtx.route('**/rest/v1/syncview_runtime_flags*', route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      asked.push(new URL(route.request().url()).searchParams.get('key'));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '[]' });
    });
    await seedStaffGate(flagCtx);
    const p5 = await flagCtx.newPage();
    await p5.goto(`http://127.0.0.1:${server.address().port}/`);
    const get = q => p5.evaluate(u => fetch(u).then(r => r.status), FLAGS + q);
    await get('?select=key,value&key=in.(' + encodeURIComponent('prod_authority,analytics_mirror_read_enabled,pto_v1') + ')&limit=3');
    await get('?select=value&key=eq.analytics_mirror_read_enabled&limit=1');
    await get('?select=value&key=eq.pto_v1&limit=1');
    assert.equal(asked[0], 'in.(prod_authority,pto_v1)', 'the batch read keeps every other flag and drops the mirror flag');
    assert.ok(!/analytics_mirror_read_enabled/.test(asked[1]), 'the single mirror-flag read never asks for the real flag');
    assert.equal(asked[2], 'eq.pto_v1', 'an unrelated single-flag read is untouched');
    await flagCtx.close();
    // Case 6 (OPEN_REPAIRS 373): the probes' native gateway stub is registered
    // FIRST and seedVerifiedProbeStaff registers the refusal again AFTER it,
    // on the context and on the page. The newest route runs first, so before
    // the fix the refusal answered every probe-key write and the stub never
    // saw one. The stub must win in both orders.
    const NW = require('../qa/native_work_item_fixture.js');
    const order = await browser.newContext();
    await seedStaffGate(order);
    const gatewayCalls = await NW.stubNativeGateway(order);
    const p6 = await order.newPage();
    await p6.goto(`http://127.0.0.1:${server.address().port}/`);
    // The blank page has no app to verify; only the route it registers matters.
    assert.match(await NW.seedVerifiedProbeStaff(p6), /^seed-failed/);
    await require('../qa/staff-gate-seed.js').refuseStubKeyProductionWrite(p6);
    const viaStub = await callFrom(p6, 'probe-staff-key');
    assert.equal(viaStub.status, 200, 'a refusal registered after the gateway stub must not shadow it');
    assert.equal(viaStub.body.native_committed, true);
    assert.equal(gatewayCalls.length, 1, 'the gateway stub sees the probe-key write');
    await order.close();
    const unstubbed = await browser.newContext();
    await seedStaffGate(unstubbed);
    const p7 = await unstubbed.newPage();
    await p7.goto(`http://127.0.0.1:${server.address().port}/`);
    assert.equal((await callFrom(p7, 'probe-staff-key')).diag, 'headless-stub', 'without a gateway stub the probe key is still refused locally');
    await unstubbed.close();
    console.log('staff-gate-stub-refusal-local: 21 checks passed ✅');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
