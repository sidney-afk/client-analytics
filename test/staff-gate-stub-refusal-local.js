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
    console.log('staff-gate-stub-refusal-local: 5 checks passed ✅');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
