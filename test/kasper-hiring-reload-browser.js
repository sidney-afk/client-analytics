'use strict';
// Speed maps 2026-09-23 §7 and 2026-09-24 §6: reloading
// ?Kasper=1#kasper/hiring-process never showed the hiring list again (0 of 5).
// This drives the REAL page in a headless browser, fully offline: a verified
// admin identity, a key-verify answer that arrives ~1 s late (as live does,
// which is the race the bug lived in), a mocked hiring list, and every other
// backend call answered empty. It opens the hiring link, reloads it twice, and
// requires the hiring rows to render each time with the address intact
// (the old ?Kasper=1#kasper/hiring-process forwards to /kasper/hiring-process).
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const KEY_VERIFY_DELAY_MS = 1000;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  const results = [];
  try {
    const context = await browser.newContext();
    // Everything external is answered locally; nothing reaches a live backend.
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = req.url();
      if (/\/functions\/v1\/hiring-applications/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        const payload = body.action === 'list'
          ? { ok: true, applications: [{ id: 'app-1', name: 'Fixture Applicant', role: 'video_editor', status: 'new', submitted_at: '2026-09-20T12:00:00Z' }] }
          : { ok: true, application: null };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(payload) });
      }
      const empty = /\/rest\/v1\//.test(url) ? '[]' : '{}';
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: empty });
    });
    await seedStaffIdentity(context, ADMIN);
    await context.route('**/functions/v1/key-verify', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      await new Promise(r => setTimeout(r, KEY_VERIFY_DELAY_MS));
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    });
    const page = await context.newPage();
    const url = `http://127.0.0.1:${server.address().port}/?Kasper=1#kasper/hiring-process`;
    const check = async label => {
      const rendered = await page.waitForSelector('.hp-row', { timeout: 15000 }).then(() => true, () => false);
      results.push({ label, rendered, path: await page.evaluate(() => location.pathname + location.hash) });
    };
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await check('fresh open');
    for (const n of [1, 2]) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      await check('reload ' + n);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results));
  for (const r of results) {
    assert.equal(r.rendered, true, `${r.label}: the hiring list never rendered`);
    assert.equal(r.path, '/kasper/hiring-process', `${r.label}: the hiring subtab was dropped from the URL`);
  }
  console.log('kasper-hiring-reload-browser: hiring renders on open and on every reload ✅');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
