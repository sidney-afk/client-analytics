'use strict';
// TikTok Upload layout (owner-approved 2026-09-26). Opens the real page
// offline and proves: the form reads as five numbered steps in the order
// Client, Media, Caption, Scheduling, TikTok options; the media type is a
// two-half toggle; TikTok options start collapsed behind a labelled button;
// Scheduling shows no date fields while "Post immediately" is on; and a
// queue row's Cancel / dismiss are invisible until the row is hovered.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const ROWS = [{ id: 's1', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: new Date(Date.now() + 20 * 3600000).toISOString(), title: 'Fixture post' }];

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(ROWS) });
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.tk-queue-item', { timeout: 20000 });

    const heads = await page.$$eval('#tkFormCol > .tk-card h3', hs => hs.map(h => h.firstChild.textContent.trim()));
    assert.deepEqual(heads, ['Client', 'Media', 'Caption', 'Scheduling', 'TikTok options'], 'step order'); checks++;
    const box = await page.$eval('#tkFormCol > .tk-card', el => { const s = getComputedStyle(el); return s.borderTopWidth + ' ' + s.backgroundColor; });
    assert.match(box, /^0px rgba\(0, 0, 0, 0\)/, 'steps have no box'); checks++;
    const numbers = await page.$$eval('#tkFormCol > .tk-card', els => els.map(el => getComputedStyle(el, '::before').content));
    assert.ok(numbers.every(c => c && c !== 'none'), 'every step shows a number'); checks++;

    const halves = await page.$$eval('.tk-seg .tk-radio', els => els.map(e => Math.round(e.getBoundingClientRect().width)));
    assert.equal(halves.length, 2); assert.ok(Math.abs(halves[0] - halves[1]) <= 2 && halves[0] > 150, 'media toggle splits into two equal halves'); checks++;

    assert.equal(await page.isHidden('#tkOptsBody'), true, 'TikTok options start collapsed'); checks++;
    assert.match(await page.innerText('#tkOptsToggle'), /Show options/); checks++;
    await page.click('#tkOptsToggle');
    assert.equal(await page.isVisible('#tkOptsBody'), true, 'Show options opens them'); checks++;
    assert.equal(await page.getAttribute('#tkOptsToggle', 'aria-expanded'), 'true'); checks++;

    assert.equal(await page.isChecked('#tkPostNow'), true);
    assert.equal(await page.isHidden('#tkScheduleFields'), true, 'no date fields while posting now'); checks++;
    await page.click('label:has(#tkPostNow)');
    await page.waitForSelector('#tkScheduleFields:not([hidden])');
    assert.equal(await page.isVisible('#tkScheduleDate'), true, 'switching off opens scheduling'); checks++;

    const actions = page.locator('.tk-queue-item').first().locator('.tk-queue-actions');
    await page.mouse.move(5, 5);
    assert.equal(await actions.evaluate(e => getComputedStyle(e).opacity), '0', 'row actions hidden until hover'); checks++;
    await page.locator('.tk-queue-item').first().hover();
    await page.waitForTimeout(250);
    assert.equal(await actions.evaluate(e => getComputedStyle(e).opacity), '1', 'hover shows them'); checks++;
    const border = await actions.locator('.tk-q-btn').first().evaluate(e => getComputedStyle(e).borderTopWidth);
    assert.equal(border, '0px', 'Cancel has no box'); checks++;

    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`tiktok-upload-steps-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
