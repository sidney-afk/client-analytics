'use strict';
// TikTok Upload: an upload whose result never came back must not sit in
// Upcoming for ever. Opens the real page offline (every backend call answered
// locally) and proves:
//   1. an overdue row the Post For Me lookup says posted moves to Done as
//      Posted, with its TikTok link;
//   2. an overdue row with no result leaves Upcoming and shows
//      "No result from Post For Me" under Failed, with no Cancel or Retry;
//   3. a future scheduled row stays in Upcoming and is never looked up;
//   4. the page keeps checking while an overdue row is unresolved.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const H = 3600000, now = Date.now();
const ROWS = [
  { id: 'late-posted', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: new Date(now - 25 * 24 * H).toISOString(), upload_post_id: 'sp_a', title: 'Late but posted' },
  { id: 'late-silent', client: 'Fixture client', status: 'processing', timezone: 'UTC', scheduled_for: '', created_at: new Date(now - 16 * 24 * H).toISOString(), upload_post_id: 'sp_b', title: 'Never heard back' },
  { id: 'future', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: new Date(now + 20 * H).toISOString(), upload_post_id: 'sp_c', title: 'Tomorrow' },
];
const PFM = {
  'late-posted': { state: 'posted', url: 'https://example.invalid/video/1' },
  'late-silent': { state: 'none' },
};

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const looked = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(ROWS) });
      if (/tiktok-upload-status/.test(url)) {
        assert.equal(req.method(), 'GET', 'the lookup only reads');
        const id = new URL(url).searchParams.get('id'); looked.push(id);
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, row: ROWS.find(r => r.id === id), pfm: PFM[id] || null }) });
      }
      if (/tiktok-upload(-direct|-cancel)?(\?|$)/.test(url)) throw new Error('the page must not post, retry or cancel: ' + url);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tk-queue-item', { timeout: 20000 });
    await page.waitForFunction(() => /Failed\s*1/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });

    const upcoming = await page.locator('#tkQueueCol .tk-queue-title').allInnerTexts();
    assert.deepEqual(upcoming, ['Tomorrow'], 'only the future post is Upcoming'); checks++;
    assert.deepEqual(looked.sort(), ['late-posted', 'late-silent'], 'only overdue rows are looked up'); checks++;

    await page.click('.tk-q-tab:has-text("Failed")');
    const failed = page.locator('#tkQueueCol .tk-queue-item');
    assert.equal(await failed.count(), 1); checks++;
    assert.match(await failed.innerText(), /Never heard back[\s\S]*No result from Post For Me/, 'the silent row says so'); checks++;
    assert.equal(await failed.locator('button:has-text("Cancel"), button:has-text("Retry")').count(), 0, 'no Cancel or Retry on a lost result'); checks++;

    await page.click('.tk-q-tab:has-text("Done")');
    const done = page.locator('#tkQueueCol .tk-queue-item', { hasText: 'Late but posted' });
    assert.match(await done.innerText(), /Posted/, 'the lookup result wins'); checks++;
    assert.equal(await done.locator('a[href="https://example.invalid/video/1"]').count(), 1, 'with its TikTok link'); checks++;

    // Still unresolved: the page asks again later instead of going quiet.
    const before = looked.length;
    await page.clock.runFor(11 * 60000);
    await page.waitForTimeout(500);
    assert.ok(looked.filter(id => id === 'late-silent').length >= 2, 'keeps checking the unresolved row'); checks++;
    assert.equal(looked.filter(id => id === 'late-posted').length, 1, 'a settled row is not asked again'); checks++;

    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`tiktok-overdue-status-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
