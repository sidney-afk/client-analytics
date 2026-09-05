'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { classify, browserEnv, validateConfig, installTransportGuards, forwardRead, assessReport, SURFACES } = require('./policy.cjs');
const p = { site: 'https://fixture.invalid', backend: 'https://backend.invalid',
  staticPaths: new Set(['/', '/index.html', '/icon.png']), sheet: 'synthetic-workbook',
  test: { slug: 'synthetic-test', token: 'synthetic-token' } };
const check = (url, method = 'GET', body) => classify({ url, method, body }, p);
const verifyBody = JSON.stringify({ slug: p.test.slug, client: 'Synthetic Test', token: p.test.token, view: 'calendar', strict: true });
async function main() {
  assert.equal(check(p.site + '/index.html?c=synthetic'), 'read_pages_asset');
  assert.equal(check(p.backend + '/rest/v1/calendar_posts?client=eq.synthetic'), 'read_relation_calendar_posts');
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    assert.equal(check(p.backend + '/rest/v1/calendar_posts', method), 'blocked_method');
    assert.equal(check(p.site + '/', method), 'blocked_method');
  }
  for (const url of [p.backend + '/rest/v1/rpc/delete_all', p.backend + '/functions/v1/calendar-upsert',
    p.backend + '/functions/v1/sample-review-upsert', p.backend + '/functions/v1/client-review-link',
    p.backend + '/functions/v1/production-comments', p.backend + '/rest/v1/unreviewed_view']) {
    assert.equal(check(url), 'blocked_backend_endpoint');
  }
  assert.equal(check('https://fixture.invalid.evil.invalid/icon.png'), 'blocked_unreviewed_endpoint');
  assert.equal(check('https://user:password@fixture.invalid/icon.png'), 'blocked_transport');
  assert.equal(check('https://n8n.invalid/webhook/reader'), 'blocked_webhook');
  assert.equal(check('https://n8n.invalid/webhook-test/mutate'), 'blocked_webhook');
  assert.equal(check(p.backend + '/functions/v1/client-token-verify', 'POST', verifyBody), 'read_verifier_with_access_audit');
  for (const body of ['{}', '{', verifyBody.replace('synthetic-token', 'foreign-token'),
    verifyBody.replace('synthetic-test', 'foreign-client'), verifyBody.replace('true', 'false'),
    verifyBody.replace('"strict":true', '"strict":true,"operation":"rotate"')]) {
    assert.equal(check(p.backend + '/functions/v1/client-token-verify', 'POST', body), 'blocked_verifier_payload');
  }
  assert.deepEqual(browserEnv({ PATH: 'synthetic', SUPABASE_SERVICE_ROLE_KEY: 'never-child', SYNCVIEW_STAFF_KEY: 'never-child' }), { PATH: 'synthetic' });
  const config = { version: 1, test: p.test, surfaces: SURFACES.map(surface => ({ surface, url: p.site + '/' })) };
  assert.equal(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, surfaces: config.surfaces.slice(1) }));
  assert.throws(() => validateConfig({ ...config, surfaces: config.surfaces.map(x => ({ ...x, storageState: 'fake' })) }));
  assert.equal(assessReport({ rows: [] }).verdict, 'UNPROVEN');
  assert.equal(assessReport({ rows: [{ surface: 'client-calendar', viewport: { width: 390 }, display: { horizontalOverflow: true } }] }).verdict, 'FAIL');
  console.log('OFFLINE_TEST: endpoint, method, exact TEST verifier, config and child-environment guards passed');

  // Real Chromium enforcement: synthetic loopback server is a canary, never a
  // live backend. Page attempts GET side effects, writes, a popup and WebSocket.
  const { chromium } = require('playwright');
  let received = 0, blocked = 0, sockets = 0, redirects = 0;
  const receivedPaths = [];
  const server = http.createServer((req, res) => {
    received++; receivedPaths.push(req.method+' '+req.url);
    if (req.url === '/allowed-read') res.writeHead(302, { location: '/redirect-mutation', 'access-control-allow-origin': '*' });
    else res.writeHead(204);
    res.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true, env: browserEnv(process.env) });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.addInitScript(installTransportGuards);
    await context.routeWebSocket('**/*', ws => { sockets++; ws.close(); });
    await context.route('**/*', route => {
      if (route.request().url() === url + '/allowed-read') return forwardRead(route, code => { if (code === 'blocked_redirect') redirects++; });
      blocked++;
      assert.ok(check(route.request().url(), route.request().method(), route.request().postData()).startsWith('blocked_'));
      return route.abort();
    });
    const page = await context.newPage();
    await page.setContent('<button id="probe">Synthetic boundary test</button>');
    await page.evaluate(url => {
      document.querySelector('#probe').onclick = () => {
        fetch(url + '/webhook/get-write').catch(() => {});
        fetch(url + '/rest/v1/rows', { method: 'POST', body: '{}' }).catch(() => {});
        navigator.sendBeacon(url + '/beacon', 'synthetic');
        fetch(url + '/keepalive', { method: 'POST', body: 'synthetic', keepalive: true }).catch(() => {});
        fetch(new Request(url + '/keepalive-request', { method: 'POST', body: 'synthetic', keepalive: true })).catch(() => {});
        fetch(url + '/allowed-read').catch(() => {});
        new WebSocket(url.replace('http:', 'ws:') + '/socket');
        window.open(url + '/popup');
      };
    }, url);
    await page.click('#probe');
    await page.waitForTimeout(800);
    assert.deepEqual(receivedPaths, ['GET /allowed-read']);
    assert.equal(received, 1);
    assert.equal(redirects, 1);
    assert.ok(blocked >= 3, 'routed fetch, POST and popup must be intercepted');
    assert.equal(sockets, 1);
    await context.close();
    console.log('ISOLATED_BROWSER: zero forbidden requests; fetch, POST, beacon, keepalive, popup, WebSocket and redirected mutation blocked');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error('baseline_guard_failed', error); process.exitCode = 1; });
