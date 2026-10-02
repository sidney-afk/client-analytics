'use strict';
// Real page transport, synthetic staff identity, every remote request mocked.
require('./helpers/single-file-index.js');
const assert = require('assert/strict');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils');
const { seedStaffGate, STAFF_GATE_KEY } = require('../qa/staff-gate-seed');
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };
(async () => {
  const server = await serveStatic(path.resolve(__dirname, '..'));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const reads = []; let publicReads = 0;
    await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), async route => {
      const request = route.request(), url = new URL(request.url());
      const json = body => route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
      if (url.pathname === '/rest/v1/syncview_runtime_flags') return json([{ value: { mode: 'function' } }]);
      if (url.pathname === '/functions/v1/card-read') {
        assert.equal(request.method(), 'GET');
        assert.equal(request.headers()['x-syncview-key'], STAFF_GATE_KEY);
        assert.equal(request.headers()['x-syncview-client-token'], undefined);
        reads.push(url.searchParams.get('table'));
        return json([{ id: 'staff-fixture-card', client: 'stafffixture', status: 'In Progress' }]);
      }
      if (/^\/rest\/v1\/(calendar_posts|sample_reviews)$/.test(url.pathname)) {
        publicReads++; return route.fulfill({ status: 403, headers: CORS, body: '{}' });
      }
      if (url.pathname.startsWith('/rest/v1/')) return json([]);
      if (url.pathname.startsWith('/functions/v1/')) return json({ ok: true });
      return route.abort();
    });
    const page = await context.newPage();
    await seedStaffGate(page);
    await page.goto('http://127.0.0.1:' + server.address().port + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof _cardReadFetch === 'function' && !!_syncviewStaffIdentityForHeaders(), null, { timeout: 30000 });
    for (const table of ['calendar_posts', 'sample_reviews']) {
      const rows = await page.evaluate(async table => {
        const response = await _cardReadFetch(CAL_SUPABASE_URL + '/rest/v1/' + table + '?select=*&client=eq.stafffixture', {
          method: 'GET', headers: { apikey: CAL_SUPABASE_ANON_KEY }
        });
        return response.json();
      }, table);
      assert.equal(rows[0].id, 'staff-fixture-card');
      assert(reads.includes(table));
    }
    assert.equal(publicReads, 0);
    await context.close();
    console.log('card-read-staff-browser: both tables use verified staff credentials; zero public card reads');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
