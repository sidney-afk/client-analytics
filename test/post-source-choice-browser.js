'use strict';
// Where a Post tab video comes from (OPEN_REPAIRS 687, the owner on 3 Nov), behind post_sources_v1. Opens the real
// page offline with every backend answer local and proves, on both sides:
//   1. "From Content Calendar" (no longer "From a card") is the default and the first choice; "From files" is the
//      second, and shows the drop zone;
//   2. the choice is the house's small two-option row (the Notes composer's "Who sees this?", cal-cm-audience), not
//      the big segmented control the post type uses: it is a different control, visibly smaller, and the post-type
//      control (Video / Photo carousel, Reel / Carousel) is unchanged;
//   3. with no Approved or Scheduled card, the note points to "From files";
//   4. switch off: no choice, today's drop zone;
//   5. at 390 wide it fits with no sideways scroll.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')}`].join('\r\n') + '\r\n';
const iso = (days) => { const d = new Date(Date.now() + days * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const POSTS = [{ id: 'p_card_a', name: 'Video 15', scheduled_date: iso(3), order_index: 1, asset_url: 'https://f.io/a', caption: 'c', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' }];

async function newPage(browser, opts) {
  const o = Object.assign({ flag: true, viewport: { width: 1440, height: 1000 } }, opts || {});
  const context = await browser.newContext({ viewport: o.viewport });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
    }
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url)) {
      const rows = [];
      if (/tiktok_upload_source/.test(url)) rows.push({ key: 'tiktok_upload_source', value: { source: 'supabase' } });
      if (o.flag && /post_sources_v1/.test(url)) rows.push({ key: 'post_sources_v1', value: { clients: ['sidneylaruel'] } });
      return reply(200, rows);
    }
    if (/functions\/v1\//.test(url)) return reply(200, { ok: true, rows: [] });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) || /tiktok-uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, errors };
}
async function openTikTok(page, base, posts) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  await page.evaluate(({ client, posts }) => { calState.client = client; calState.posts = posts; }, { client: TEST_CLIENT, posts: posts || POSTS });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
}
async function toInstagram(page) {
  await page.click('#tkPlatInstagram');
  await page.waitForSelector('#igFormCol:not([hidden])');
  if (!(await page.locator('#igFormCol .tk-profile-line').count())) {
    await page.click('#igClientBtn');
    await page.click(`#igClientMenu [data-sv-select-option][data-value=${JSON.stringify(TEST_CLIENT)}]`);
  }
  await page.waitForSelector('#igFormCol .tk-profile-line');
}
const box = (page, sel) => page.$eval(sel, el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    for (const side of ['tk', 'ig']) {
      const { context, page, errors } = await newPage(browser);
      await openTikTok(page, base);
      if (side === 'ig') await toInstagram(page);
      const name = side === 'tk' ? 'TikTok' : 'Instagram';
      await page.waitForSelector(`input[name="${side}SrcMode"]`);
      // 1. the default and the order
      assert.deepEqual(await page.$$eval(`input[name="${side}SrcMode"]`, els => els.map(e => [e.value, e.closest('label').textContent.trim(), e.checked])),
        [['card', 'From Content Calendar', true], ['files', 'From files', false]]); checks++;
      ok(await page.locator(`#${side}SrcCardBtn`).count() === 1 && await page.locator(side === 'tk' ? '#tkDrop' : '#igDrop').count() === 0, name + ': the card picker shows first, not the drop zone');
      // 2. a different, quieter control than the post type's
      const src = `#${side === 'tk' ? 'tkFormCol' : 'igFormCol'} .tk-src-switch`;
      ok(await page.locator(src + ' .cal-cm-aud-seg').count() === 1, name + ': the source is the house two-option row');
      ok(await page.locator(src + '.tk-seg, ' + src + ' .tk-seg').count() === 0, name + ': not the post type\'s segmented control');
      const typeSel = side === 'tk' ? '#tkFormCol .tk-seg:has(input[name="tkMediaType"])' : '#igFormCol .tk-seg:has(input[name="igKind"])';
      ok(await page.locator(typeSel).count() === 1, name + ': the post-type control is still the big segmented one');
      const t = await box(page, typeSel), s = await box(page, src + ' .cal-cm-aud-seg');
      ok(s.w < t.w * 0.7 && s.h < t.h, name + ': the source row is visibly smaller than the post-type control (' + JSON.stringify({ s, t }) + ')');
      // From files shows the drop zone.
      await page.click(`label:has(input[name="${side}SrcMode"][value="files"])`);
      await page.waitForSelector(side === 'tk' ? '#tkDrop' : '#igDrop');
      ok(true, name + ': From files shows the drop zone');
      ok(!errors.length, name + ': no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // 3. no card to pick
    {
      const { context, page, errors } = await newPage(browser);
      await openTikTok(page, base, []);
      await page.waitForSelector('#tkSrcEmpty');
      assert.equal((await page.textContent('#tkSrcEmpty')).trim(), 'No Approved or Scheduled cards from today on. Choose From files to drop the file instead.'); checks++;
      ok(!errors.length, 'no cards: no page errors');
      await context.close();
    }
    // 4. switch off
    {
      const { context, page, errors } = await newPage(browser, { flag: false });
      await openTikTok(page, base);
      await page.waitForSelector('#tkDrop');
      await page.waitForTimeout(400);
      ok(await page.locator('input[name="tkSrcMode"]').count() === 0, 'switch off: no source choice, today\'s drop zone');
      ok(!errors.length, 'switch off: no page errors');
      await context.close();
    }
    // 5. 390 wide
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openTikTok(page, base);
      await page.waitForSelector('input[name="tkSrcMode"]');
      ok(await noSideScroll(page), '390: the source row fits with no sideways scroll');
      ok(!errors.length, '390: no page errors');
      await context.close();
    }
    console.log(`post-source-choice-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
