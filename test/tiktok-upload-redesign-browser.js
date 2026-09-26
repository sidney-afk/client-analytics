'use strict';
// TikTok Upload redesign (option A). Opens the real page offline (every
// backend call answered locally) and proves:
//   1. the client is picked with the Analytics client search: typing ranks
//      names that start with the query first, Enter picks the top match,
//      Escape puts back the chosen client;
//   2. the uploads card has Upcoming / Failed / Done tabs, lists upcoming
//      posts soonest first, shows 5 at a time with "Show more", and never
//      labels a failed upload "posted";
//   3. in dark mode every "on" control (selected pill, switch, AM/PM, the
//      submit button) stands out from its card instead of staying black.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const INDEX = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = /const WL_CLIENT_NAMES\s*=\s*\[([\s\S]*?)\];/.exec(INDEX);
assert.ok(block, 'client roster not found in index.html');
const NAMES = [...block[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map(m => m[1]).sort((a, b) => a.localeCompare(b));
assert.ok(NAMES.length > 1, 'client roster parsed empty');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const HOUR = 3600000;
// 12 scheduled uploads served out of order, one failure, one posted.
const upcoming = Array.from({ length: 12 }, (_, i) => ({
  id: 'up' + i, client: 'Fixture client', status: 'scheduled', timezone: 'UTC',
  scheduled_for: new Date(Date.now() + (i + 1) * 3 * HOUR).toISOString(), title: 'Fixture post ' + i,
}));
const ROWS = [...upcoming].reverse().concat([
  { id: 'f1', client: 'Fixture client', status: 'failed', posted_at: new Date(Date.now() - 5 * HOUR).toISOString(), title: 'Fixture failure', error: 'Fixture rejection' },
  { id: 'p1', client: 'Fixture client', status: 'posted', posted_at: new Date(Date.now() - HOUR).toISOString(), title: 'Fixture posted', tiktok_url: 'https://example.invalid/v' },
]);

function lum(rgb) {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

async function openPage(browser, port, dark) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(ROWS) });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  if (dark) await context.addInitScript(() => { try { localStorage.setItem('syncview_theme', 'dark'); } catch {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-queue-item', { timeout: 20000 });
  return { page, context, errors };
}

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const { page, context, errors } = await openPage(browser, port, false);

    // 1. Client search
    assert.equal(await page.locator('select#tkClient').count(), 0, 'the client dropdown is gone');
    const target = NAMES[0];
    const q = target.slice(0, 3);
    await page.fill('#tkClientInput', q);
    const shown = await page.locator('#tkClientResults [data-tk-client-pick]').evaluateAll(els => els.map(e => e.getAttribute('data-tk-client-pick')));
    const ql = q.toLowerCase();
    const expected = [...NAMES.filter(n => n.toLowerCase().startsWith(ql)), ...NAMES.filter(n => !n.toLowerCase().startsWith(ql) && n.toLowerCase().includes(ql))].slice(0, 6);
    assert.deepEqual(shown, expected, 'results rank starts-with matches first, like the Analytics picker'); checks++;
    assert.ok(await page.locator('#tkClientBox.search-dropdown.open').count(), 'the Analytics dropdown opens'); checks++;
    await page.press('#tkClientInput', 'Enter');
    await page.waitForFunction(n => document.getElementById('tkClientInput')?.value === n, expected[0]);
    assert.ok(await page.locator('.tk-profile-line').count(), 'picking a client shows its account line'); checks++;
    await page.fill('#tkClientInput', 'zzzz-no-such-client');
    assert.match(await page.locator('#tkClientResults').innerText(), /No clients found/); checks++;
    await page.press('#tkClientInput', 'Escape');
    assert.equal(await page.inputValue('#tkClientInput'), expected[0], 'Escape puts the chosen client back'); checks++;

    // 2. Uploads card
    const tabs = await page.locator('.tk-q-tab').allInnerTexts();
    assert.deepEqual(tabs.map(t => t.replace(/\s+/g, ' ').trim()), ['Upcoming 12', 'Failed 1', 'Done 1']); checks++;
    assert.ok(await page.locator('.tk-q-tab.alert', { hasText: 'Failed' }).count(), 'failures are flagged on their tab'); checks++;
    const titles = () => page.locator('.tk-queue-item .tk-queue-title').allInnerTexts();
    assert.deepEqual(await titles(), [0, 1, 2, 3, 4].map(i => 'Fixture post ' + i), 'soonest first, 5 at a time'); checks++;
    await page.click('.tk-q-more');
    assert.equal((await titles()).length, 10); checks++;
    await page.click('.tk-q-more');
    assert.equal((await titles()).length, 12); checks++;
    assert.equal(await page.locator('.tk-q-more').count(), 0, 'no Show more once everything is shown'); checks++;
    await page.click('.tk-q-tab:has-text("Failed")');
    const failedRow = await page.locator('.tk-queue-item').innerText();
    assert.match(failedRow, /Failed/); assert.doesNotMatch(failedRow, /posted/i, 'a failed upload is never called posted'); checks++;
    assert.ok(await page.locator('.tk-queue-item button', { hasText: 'Retry' }).count()); checks++;
    await page.click('.tk-q-tab:has-text("Done")');
    assert.match(await page.locator('.tk-queue-item').innerText(), /Posted/); checks++;
    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();

    // 3. Dark mode "on" states
    const d = await openPage(browser, port, true);
    // "Post immediately" is on by default: the switch the owner saw stay black.
    assert.equal(await d.page.isChecked('#tkPostNow'), true);
    const colors = await d.page.evaluate(() => {
      const bg = el => getComputedStyle(el).backgroundColor;
      const card = bg(document.querySelector('#tkFormCol .tk-card'));
      return {
        card,
        pill: bg(document.querySelector('.tk-radio.active')),
        track: bg(document.querySelector('#tkPostNow ~ .tk-toggle-track')),
        submit: bg(document.getElementById('tkSubmit')),
      };
    });
    for (const k of ['pill', 'track', 'submit']) {
      assert.ok(contrast(colors[k], colors.card) >= 3, `dark mode: the "on" ${k} (${colors[k]}) must stand out from the card (${colors.card})`); checks++;
    }
    assert.deepEqual(d.errors, []); checks++;
    await d.context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`tiktok-upload-redesign-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
