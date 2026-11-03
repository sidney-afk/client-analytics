'use strict';
// "From a card" on the Post tab, both sides (plan row P1, part P1b, OPEN_REPAIRS 651), behind post_sources_v1.
// Opens the real page offline with every backend answer local and proves:
//   1. switch on, TikTok: "From a card" lists only the client's Approved or Scheduled cards from today on; picking one
//      asks post-source (client, card id, side tiktok), shows "Copying…", then the file name, its size, length and
//      which Frame file went, and a plain <video> on Frame's small copy; the card's TikTok caption fills the empty
//      caption box; the post carries the copied address: no storage address is asked for and no file is uploaded;
//   2. switch on, Instagram: the same, side instagram; the card's thumbnail (copied server side) is the cover, and
//      the post carries both copied addresses;
//   3. a failed copy shows the server's reason and Try again; Post stays off; Try again copies;
//   4. a copy older than 20 hours is made again at the press, and the post keeps the SAME key as the press before
//      it (an answer lost on the first press can never become a second post);
//   5. switch off (or unreadable): no "From a card" anywhere; each side shows today's drop zone;
//   6. at 390 wide the picker fits with no sideways scroll.
// Nothing is ever posted for real: every function is answered here.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
// The test client's display name, read from the page's own roster (the only client this check uses).
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')},`].join('\r\n') + '\r\n';
const SMALL = 'https://frame.example.test/small-copy.mp4';
const iso = (days) => { const d = new Date(Date.now() + days * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const approved = { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' };
// Dated relative to today, so no month change ever moves them out of range.
const POSTS = [
  Object.assign({ id: 'p_card_a', name: 'Video 15', scheduled_date: iso(3), order_index: 1, asset_url: 'https://f.io/cardA', caption: 'The Instagram caption', caption_alt: 'The TikTok caption', caption_alt_platform: 'tiktok' }, approved),
  Object.assign({ id: 'p_card_old', name: 'Video 9', scheduled_date: iso(-3), order_index: 2, asset_url: 'https://f.io/old', caption: 'old' }, approved),
  { id: 'p_card_wip', name: 'Video 16', scheduled_date: iso(4), order_index: 3, asset_url: 'https://f.io/wip', caption: 'wip', video_status: 'In Progress', graphic_status: 'Approved', caption_status: 'Approved' },
];

async function newPage(browser, opts) {
  const o = Object.assign({ flag: true, viewport: { width: 1440, height: 1000 }, copyFails: 0 }, opts || {});
  const context = await browser.newContext({ viewport: o.viewport });
  const log = { copies: [], previews: [], creates: [], mints: 0, puts: [] };
  let copyNo = 0;
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
    if (/functions\/v1\/post-source\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      log.copies.push(body);
      if (copyNo++ < o.copyFails) return reply(409, { ok: false, error: 'no_link', message: 'This card has no Frame link yet.' });
      return reply(200, { ok: true, media_url: 'https://data.postforme.dev/v/' + copyNo, file_name: 'video_15_final.mp4', rendition: 'original', fell_back_from_original: false,
        bytes: 28291416, width: 1080, height: 1920, duration_seconds: 57.28, thumb_url: 'https://data.postforme.dev/t/' + copyNo, thumb_note: '', metadata_fields: [], took_ms: 4875 });
    }
    if (/functions\/v1\/frameio-view\b/.test(url)) {
      log.previews.push(JSON.parse(req.postData() || '{}'));
      return reply(200, { ok: true, video: { url: SMALL, renditions: { efficient: SMALL, high_quality: SMALL + '?hq' } } });
    }
    if (/functions\/v1\/(instagram-upload|tiktok-upload)\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'mint') { log.mints++; return reply(200, { ok: true, upload_url: 'https://storage.postforme.test/put', media_url: 'https://data.postforme.dev/up' }); }
      if (body.action === 'create') {
        log.creates.push(Object.assign({ fn: /instagram/.test(url) ? 'instagram' : 'tiktok' }, body));
        if (o.createFailsOnce && log.creates.length === 1) return reply(502, { ok: false, error: 'upstream' });
        return reply(200, { ok: true, row: { id: 'row_' + log.creates.length, status: 'scheduled', client_name: body.clientName, title: body.title, created_at: new Date().toISOString() } });
      }
      return reply(200, { ok: true, rows: [] });
    }
    if (/write-diagnostics/.test(url)) return reply(200, { ok: true });
    if (req.method() === 'PUT') { log.puts.push(url); return route.fulfill({ status: 200, headers: cors, body: '' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) || /tiktok-uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, log, errors };
}

async function openTikTok(page, base) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  // The client's Calendar, as if it had been open: the cards come from the page's own copy (nothing is fetched).
  await page.evaluate(({ client, posts }) => { calState.client = client; calState.posts = posts; }, { client: TEST_CLIENT, posts: POSTS });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
}
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
const options = (page, id) => page.$$eval(`#${id}Menu [data-sv-select-option]`, els => els.map(e => e.getAttribute('data-value')));
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    // ---- 1. TikTok, from a card
    {
      const { context, page, log, errors } = await newPage(browser);
      await openTikTok(page, base);
      await page.waitForSelector('input[name="tkSrcMode"]');
      ok(await page.locator('#tkDrop').count() === 1, 'TikTok: "From files" is the default, with today\'s drop zone');
      await page.click('label:has(input[name="tkSrcMode"][value="card"])');
      await page.waitForSelector('#tkSrcCardBtn');
      await page.click('#tkSrcCardBtn');
      assert.deepEqual(await options(page, 'tkSrcCard'), ['p_card_a']); checks++;   // not a past card, not one in progress
      await page.click('#tkSrcCardMenu [data-sv-select-option][data-value="p_card_a"]');
      await page.waitForSelector('#tkSrcReady');
      assert.deepEqual(log.copies[0], { client: TEST_CLIENT, post_id: 'p_card_a', side: 'tiktok' }); checks++;
      ok(log.previews.length === 1 && log.previews[0].link === 'https://f.io/cardA' && log.previews[0].part === 'video', 'the preview asks frameio-view for the card\'s own link');
      assert.equal(await textOf(page, '#tkSrcReady .tk-file-name'), 'video_15_final.mp4'); checks++;
      assert.equal(await textOf(page, '#tkSrcFacts'), '1080×1920 · 27 MB · 57 s · Frame\'s original file'); checks++;
      await page.waitForSelector('#tkSrcPreview');
      assert.equal(await page.getAttribute('#tkSrcPreview', 'src'), SMALL); checks++;
      await page.waitForSelector('#tkPreviewVideo');
      assert.equal(await page.getAttribute('#tkPreviewVideo', 'src'), SMALL); checks++;   // the phone preview plays it too
      assert.equal(await page.inputValue('#tkTitle'), 'The TikTok caption'); checks++;   // the card's caption written for TikTok
      await page.click('#tkSubmit');
      await page.waitForFunction(() => !tkState.submitting && !tkState.error && !tkState.source.cardId);
      const c = log.creates[0];
      ok(c && c.fn === 'tiktok' && c.mediaUrl === 'https://data.postforme.dev/v/1', 'the TikTok post carries the copied address');
      ok(log.mints === 0 && log.puts.length === 0, 'TikTok: no storage address asked for, nothing uploaded from the browser');
      ok(await page.evaluate(() => !tkState.source.cardId), 'after the post the card is cleared');
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }

    // ---- 2. Instagram, from a card: the thumbnail is the cover
    {
      const { context, page, log, errors } = await newPage(browser);
      await openTikTok(page, base);
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('input[name="igSrcMode"]');
      await page.click('label:has(input[name="igSrcMode"][value="card"])');
      await page.waitForSelector('#igSrcCardBtn');
      await pickSv(page, 'igSrcCard', 'p_card_a');
      await page.waitForSelector('#igSrcReady');
      assert.deepEqual(log.copies[0], { client: TEST_CLIENT, post_id: 'p_card_a', side: 'instagram' }); checks++;
      assert.equal(await page.inputValue('#igTitle'), 'The Instagram caption'); checks++;
      ok(await page.locator('#igCoverRemote').count() === 1, 'Instagram: the card\'s thumbnail is the cover');
      ok(await page.locator('#igCardBtn').count() === 0, 'Instagram: no second card picker in the cover card');
      assert.equal(await page.getAttribute('#igPreviewImg', 'src'), 'https://data.postforme.dev/t/1'); checks++;
      await page.click('#igSubmit');
      await page.waitForFunction(() => !igState.submitting && igState.uploads.some(r => r.id === 'row_1'));
      const c = log.creates[0];
      ok(c && c.fn === 'instagram' && c.mediaUrl === 'https://data.postforme.dev/v/1' && c.coverUrl === 'https://data.postforme.dev/t/1', 'the Instagram post carries the copied video and thumbnail');
      ok(log.mints === 0 && log.puts.length === 0, 'Instagram: no storage address asked for, nothing uploaded from the browser');
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }

    // ---- 3. a failed copy, then Try again
    {
      const { context, page, log, errors } = await newPage(browser, { copyFails: 1 });
      await openTikTok(page, base);
      await page.waitForSelector('input[name="tkSrcMode"]');
      await page.click('label:has(input[name="tkSrcMode"][value="card"])');
      await pickSv(page, 'tkSrcCard', 'p_card_a');
      await page.waitForSelector('#tkSrcRetry');
      assert.equal(await textOf(page, '#tkSrcStatus'), 'This card has no Frame link yet.'); checks++;
      ok(await page.isDisabled('#tkSubmit'), 'Post stays off while there is no copy');
      await page.click('#tkSrcRetry');
      await page.waitForSelector('#tkSrcReady');
      ok(log.copies.length === 2, 'Try again copies again');
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }

    // ---- 4. an old copy is made again at the press, under the same key
    {
      const { context, page, log, errors } = await newPage(browser, { createFailsOnce: true });
      await openTikTok(page, base);
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('input[name="igSrcMode"]');
      await page.click('label:has(input[name="igSrcMode"][value="card"])');
      await pickSv(page, 'igSrcCard', 'p_card_a');
      await page.waitForSelector('#igSrcReady');
      await page.click('#igSubmit');
      await page.waitForFunction(() => !igState.submitting && !!igState.error);
      ok(log.creates.length === 1 && log.copies.length === 1, 'the first press: one create, its answer lost');
      await page.evaluate(() => { igState.source.copiedAt = Date.now() - 21 * 3600 * 1000; });
      await page.click('#igSubmit');
      await page.waitForFunction(() => !igState.submitting && igState.uploads.some(r => r.id === 'row_2'));
      ok(log.copies.length === 2, 'a copy older than 20 hours is made again before the post');
      ok(log.creates[1].mediaUrl === 'https://data.postforme.dev/v/2' && log.creates[1].coverUrl === 'https://data.postforme.dev/t/2', 'the post carries the new copy');
      assert.equal(log.creates[1].idempotencyKey, log.creates[0].idempotencyKey, 'the same key: the server adopts the first post if it was made'); checks++;
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }

    // ---- 5. switch off: today's page
    {
      const { context, page, log, errors } = await newPage(browser, { flag: false });
      await openTikTok(page, base);
      await page.waitForSelector('#tkDrop');
      await page.waitForTimeout(300);
      ok(await page.locator('input[name="tkSrcMode"]').count() === 0, 'switch off: no "From a card" on TikTok');
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden])');
      if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('#igDrop');
      ok(await page.locator('input[name="igSrcMode"]').count() === 0, 'switch off: no "From a card" on Instagram');
      ok(log.copies.length === 0 && log.previews.length === 0, 'switch off: post-source and frameio-view are never asked');
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }

    // ---- 6. a phone
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openTikTok(page, base);
      await page.waitForSelector('input[name="tkSrcMode"]');
      await page.click('label:has(input[name="tkSrcMode"][value="card"])');
      await pickSv(page, 'tkSrcCard', 'p_card_a');
      await page.waitForSelector('#tkSrcReady');
      ok(await noSideScroll(page), '390 wide: no sideways scroll with a card picked');
      const box = await page.locator('#tkSrcReady').boundingBox();
      ok(box && box.x >= 0 && box.x + box.width <= 391, '390 wide: the picked card fits the screen');
      assert.deepEqual(errors, []); checks++;
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`post-from-card-browser: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
