'use strict';
// TikTok Upload preview: the empty-state line ("Attach a video to see how this
// post will look on TikTok.") ran under the action rail, so the avatar "?"
// badge covered its end. Opens the real page offline (every backend call
// answered locally) and requires the text's box and the rail's box not to
// intersect, for both the video and the photo placeholder.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  const results = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const url = req.url();
      if (/\/functions\/v1\/key-verify/.test(url)) {
        return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    const measure = async label => {
      await page.waitForSelector('.tk-preview-empty', { timeout: 15000 });
      results.push({ label, ...(await page.evaluate(() => {
        const empty = document.querySelector('.tk-preview-empty');
        const range = document.createRange();
        range.selectNodeContents(empty);
        const text = range.getBoundingClientRect();
        const rail = document.querySelector('.tk-preview-icons').getBoundingClientRect();
        const overlap = text.right > rail.left && text.left < rail.right && text.bottom > rail.top && text.top < rail.bottom;
        return { overlap, textRight: Math.round(text.right), railLeft: Math.round(rail.left) };
      })) });
    };
    await measure('video');
    await page.locator('label.tk-radio', { hasText: 'Photo carousel' }).click();
    await measure('photo');
  } finally {
    await browser.close();
    server.close();
  }
  console.log(JSON.stringify(results));
  for (const r of results) assert.equal(r.overlap, false, `${r.label}: the preview placeholder runs under the action rail`);
  console.log('tiktok-preview-empty-clearance-browser: placeholder clears the action rail ✅');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
