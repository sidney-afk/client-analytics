'use strict';
// Trial-reels reads from a harness page signed in with an invented staff key (session Trialchange, 2026-11-02).
//
// The shared gate seed (qa/staff-gate-seed.js seedStaffGate) answers key-verify in the browser, so a harness page is
// "verified" for the app, and since trial_reels_pages went to {"all": true} (2 Nov 00:49 UTC) every such staff page
// asked the LIVE trial-reels function for each client's versions with its invented key. The function refuses that
// key with 401: Calendar E2E (nightly) sent 1,110 of them between 08:03 and 08:27 UTC on 2 Nov (one per client, per
// staff page load), and the 06:05 Samples nightly 1,232. A harness key can never read trial reels, so the seed now
// answers those reads in the browser with an empty, valid answer (as if Trial reels were off for that page), the way
// it already answers analytics-read and the staff reads. This proves:
//   1. a trial-reels READ (list, list_many, read) with an invented key never leaves the browser, and is answered
//      with the empty shape the page expects;
//   2. a trial-reels WRITE with an invented key is NOT answered by the seed (it goes on, as before);
//   3. a read with any other key, or a client link's review token, is NOT touched (falls through);
//   4. a suite's own trial-reels mock, registered after the seed, still wins.
// Fully offline: what falls through is answered by a route registered first, standing in for the network.
const assert = require('assert/strict');
const http = require('http');
const { chromium } = require('playwright');
const { seedStaffGate, STAFF_GATE_KEY } = require('../qa/staff-gate-seed.js');

const EF = 'https://uzltbbrjidmjwwfakwve.supabase.co/functions/v1/trial-reels';

async function callFrom(page, headers, body) {
  return page.evaluate(async ({ url, headers, body }) => {
    const r = await fetch(url, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch (e) {}
    return { status: r.status, body: json };
  }, { url: EF, headers, body });
}

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>t</title>'); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; console.log('  ok  ' + msg); };
  try {
    const context = await browser.newContext();
    const reached = [];
    // The network stand-in is registered FIRST, so it only answers what the seed lets through. It answers like the
    // live function does for a key it does not know.
    await context.route('**/functions/v1/trial-reels', route => {
      const r = route.request();
      if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': '*' } });
      let b = {}; try { b = JSON.parse(r.postData() || '{}'); } catch (e) {}
      reached.push(b.action);
      return route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":false,"error":"invalid_staff_key","from":"network"}' });
    });
    await seedStaffGate(context);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);

    // 1. Reads with the invented key: answered here, empty, never 401.
    const stub = { 'X-Syncview-Key': STAFF_GATE_KEY };
    let r = await callFrom(page, stub, { action: 'list', client: 'fixtureclient', post_id: '' });
    ok(r.status === 200 && r.body && r.body.ok === true && JSON.stringify(r.body.cards) === '{}', 'list with the stub key: answered here, no trial cards (' + JSON.stringify(r) + ')');
    r = await callFrom(page, stub, { action: 'list_many', clients: ['fixtureclient', 'otherclient'] });
    ok(r.status === 200 && r.body && r.body.ok === true && JSON.stringify(r.body.clients) === '{}', 'list_many with the stub key: answered here, no clients (' + JSON.stringify(r) + ')');
    r = await callFrom(page, stub, { action: 'read', client: 'fixtureclient', post_id: 'p1', probe: true });
    ok(r.status === 200 && r.body && r.body.ok === true && r.body.enabled === false && !('versions' in r.body), 'read with the stub key: answered here, the card switch off (' + JSON.stringify(r) + ')');
    r = await callFrom(page, { 'X-Syncview-Key': 'probe-staff-key' }, { action: 'list', client: 'fixtureclient', post_id: '' });
    ok(r.status === 200 && r.body && r.body.ok === true, 'any other invented key shape (probe-staff-key) is answered the same way');
    ok(reached.length === 0, 'no stub-key trial-reels read reached the network (' + JSON.stringify(reached) + ')');

    // 2. A write with the invented key goes on, as before (the live function refuses it, and that is the truth).
    r = await callFrom(page, stub, { action: 'version_drop', client: 'fixtureclient', post_id: 'p1', letter: 'B' });
    ok(r.status === 401 && reached.join() === 'version_drop', 'a stub-key WRITE is not answered by the seed (' + JSON.stringify(reached) + ')');

    // 3. A key that is not an invented shape, and a client link's token, fall through untouched.
    reached.length = 0;
    r = await callFrom(page, { 'X-Syncview-Key': 'Zq7-not-a-harness-shape' }, { action: 'list', client: 'fixtureclient', post_id: '' });
    ok(reached.join() === 'list', 'a read with any other key falls through to the network');
    reached.length = 0;
    r = await callFrom(page, { 'X-Syncview-Client-Token': 'fixture-review-token' }, { action: 'list', client: 'fixtureclient', post_id: '' });
    ok(reached.join() === 'list', "a client link's read (review token, no staff key) falls through to the network");

    // 4. A suite's own trial-reels mock, registered after the seed, still wins.
    const suite = await browser.newContext();
    await seedStaffGate(suite);
    await suite.route('**/functions/v1/trial-reels', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true,"cards":{"p1":{"enabled":true}},"from":"suite"}' }));
    const sp = await suite.newPage();
    await sp.goto(`http://127.0.0.1:${server.address().port}/`);
    r = await callFrom(sp, stub, { action: 'list', client: 'fixtureclient', post_id: '' });
    ok(r.body && r.body.from === 'suite', "a suite's own trial-reels mock still answers its stub-key reads");
    await suite.close();
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`staff-gate-trial-reels-stub-local: ${checks} checks passed`);
})().catch(e => { console.error(e && e.message || e); process.exit(1); });
