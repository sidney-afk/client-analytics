'use strict';
// A failed first queue read must stay visibly unverified and retry without
// making the operator leave the tab. Every backend response is local.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const OPERATOR = { id: 'fixture_operator', name: 'Fixture Operator', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const rows = [{ id: 'queued-fixture', client: 'Fixture account', title: 'Recovered upload', status: 'queued', created_at: new Date().toISOString() }];

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  let reads = 0;
  let failNextRead = false;
  let startFirstRead;
  let releaseFirstRead;
  const firstReadStarted = new Promise(resolve => { startFirstRead = resolve; });
  const heldFirstRead = new Promise(resolve => { releaseFirstRead = resolve; });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
      const request = route.request();
      const url = request.url();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: OPERATOR }) });
      if (/tiktok-uploads-list/.test(url)) {
        assert.equal(request.method(), 'GET', 'the queue test only reads');
        reads++;
        if (reads === 1) {
          startFirstRead();
          await heldFirstRead;
          return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: '{}' });
        }
        if (failNextRead) {
          failNextRead = false;
          return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: '{}' });
        }
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rows) });
      }
      if (request.method() !== 'GET') throw new Error('unexpected write: ' + url);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, OPERATOR);
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await firstReadStarted;
    const queue = page.locator('#tkQueueCol');
    assert.doesNotMatch(await queue.innerText(), /Nothing scheduled yet\./, 'an unfinished first read is not an empty list'); checks++;
    assert.doesNotMatch(await queue.innerText(), /Upcoming\s+0/, 'unverified counts do not claim zero'); checks++;

    const failedResponse = page.waitForResponse(response => /tiktok-uploads-list/.test(response.url()) && response.status() === 503);
    releaseFirstRead();
    await failedResponse;
    await page.waitForFunction(() => /Couldn't load your uploads/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 5000 });
    assert.doesNotMatch(await queue.innerText(), /Nothing scheduled yet\./, 'a failed first read is not an empty list'); checks++;
    assert.match(await queue.innerText(), /Trying again shortly\./, 'the page explains recovery'); checks++;

    await page.waitForTimeout(100);
    await page.clock.runFor(31_000);
    await page.waitForSelector('#tkQueueCol .tk-queue-item', { timeout: 5000 });
    assert.equal(reads, 2, 'the empty local queue retries on its own'); checks++;
    assert.match(await queue.innerText(), /Recovered upload/, 'the retry shows the server row'); checks++;
    assert.doesNotMatch(await queue.innerText(), /Couldn't load your uploads|Nothing scheduled yet\./, 'the error clears after recovery'); checks++;
    assert.equal(await queue.locator('.tk-queue-item-cached').count(), 0, 'a live row is actionable'); checks++;

    // A later refresh that fails, without a reload, must make the kept row
    // read-only too, so a stale Cancel or Retry cannot be sent (Codex review on #1773).
    failNextRead = true;
    await page.clock.runFor(31_000);
    await page.waitForFunction(() => /Couldn't load your uploads/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 5000 });
    assert.equal(await queue.locator('.tk-queue-item-cached').count(), 1, 'a failed refresh makes the kept row read-only'); checks++;
    assert.equal(await queue.locator('.tk-q-danger, .tk-q-primary').count(), 0, 'no Cancel or Retry on an unverified row'); checks++;
    await page.clock.runFor(61_000);
    await page.waitForFunction(() => !/Couldn't load your uploads/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 5000 });
    assert.equal(await queue.locator('.tk-queue-item-cached').count(), 0, 'a successful read makes the row actionable again'); checks++;

    failNextRead = true;
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => /Couldn't load your uploads/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 5000 });
    assert.match(await queue.innerText(), /Recovered upload/, 'a later failure keeps the cached row visible'); checks++;
    assert.match(await queue.innerText(), /Showing available rows/, 'cached rows are marked unverified'); checks++;
    assert.equal(await queue.locator('.tk-queue-item-cached').count(), 1, 'the cached row stays read-only'); checks++;
    assert.deepEqual(pageErrors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    releaseFirstRead();
    await browser.close();
    server.close();
  }
  console.log(`tiktok-queue-first-read-browser: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
