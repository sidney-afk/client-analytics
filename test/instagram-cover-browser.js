'use strict';
// The Instagram side's "Cover image" field. Opens the real page offline and proves: a cover image can be uploaded
// (JPEG or PNG only, a non-9:16 image is warned about but accepted), a Calendar card's thumbnail is offered and
// can be used, a frame of the video is the fallback, the chosen cover shows in the preview, and what reaches the
// instagram-upload function is exactly one of the two: `coverUrl` (an image already in Post For Me storage) or a
// frame time, never both. Every backend answer is local: nothing reaches Post For Me or any real account.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
// The test client's display name, read from the page's own roster (the only client a check may post for).
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const ACCOUNT_ID = 'spc_fixtureInstagram01';
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_instagram_account_id', `${csv(TEST_CLIENT)},${csv(ACCOUNT_ID)}`].join('\r\n') + '\r\n';

// A real PNG of the given size, made here so the test needs no image files.
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const COVER_PNG = png(90, 160, [200, 30, 30]);      // 9:16
const SQUARE_PNG = png(100, 100, [30, 30, 200]);    // not 9:16
const CAL_PNG = png(72, 128, [30, 160, 60]);        // the Calendar card's thumbnail, 9:16

async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const calls = { mints: 0, puts: [], creates: [] };
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (/\/gviz\/tq/.test(url)) {
        const sheet = new URL(url).searchParams.get('sheet') || '';
        return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
      }
      if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
      if (/functions\/v1\/instagram-upload/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        const ok = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, ...obj }) });
        if (body.action === 'list') return ok({ rows: [] });
        if (body.action === 'mint') { const n = ++calls.mints; return ok({ upload_url: `https://storage.fixture.test/put/${n}`, media_url: `https://data.postforme.dev/m/${n}` }); }
        if (body.action === 'create') {
          calls.creates.push(body);
          return ok({ id: body.idempotencyKey, status: 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: 'processing', placement: 'reels', created_at: new Date().toISOString(), error: '', instagram_url: '' } });
        }
        return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
      }
      if (/functions\/v1\/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
      if (/storage\.fixture\.test/.test(url)) { calls.puts.push({ method: req.method(), type: req.headers()['content-type'], size: (req.postDataBuffer() || Buffer.alloc(0)).length, url }); return route.fulfill({ status: 200, headers: cors, body: '' }); }
      if (/images\.fixture\.test/.test(url)) return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: CAL_PNG });
      if (req.method() !== 'GET') throw new Error('unexpected write: ' + req.method() + ' ' + url);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tkPlatInstagram', { timeout: 20000 });
    await page.click('#tkPlatInstagram');
    await page.waitForSelector('#igFormCol:not([hidden])');

    const attachVideo = async () => { await page.setInputFiles('#igFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') }); };
    const submitAndWait = async () => {
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || ''), null, { timeout: 10000 });
    };

    await pickSv(page, 'igClient', TEST_CLIENT);
    await attachVideo();
    await page.fill('#igTitle', 'Cover test caption');

    // --- the field is there, below the video, and optional
    const heads = await page.$$eval('#igFormCol > .tk-card h3', hs => hs.map(h => h.firstChild.textContent.trim()));
    assert.deepEqual(heads.slice(0, 4), ['Client', 'Video', 'Cover image', 'Caption'], 'Cover image sits right below the video'); checks++;
    assert.match(await page.innerText('#igPreviewCard'), /No cover chosen/, 'with no cover the preview says Instagram picks the first frame'); checks++;

    // --- a wrong file type is refused with a reason
    await page.setInputFiles('#igCoverFile', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await page.waitForSelector('#igCoverNote');
    assert.match(await page.innerText('#igCoverNote'), /JPEG or PNG/, 'only JPEG or PNG covers are taken'); checks++;

    // --- a square image is accepted with a heads-up, and shows in the preview
    await page.setInputFiles('#igCoverFile', { name: 'square.png', mimeType: 'image/png', buffer: SQUARE_PNG });
    await page.waitForSelector('#igCoverNote');
    assert.match(await page.innerText('#igCoverNote'), /100×100, not 9:16/, 'a non-9:16 image is warned about'); checks++;
    assert.equal(await page.locator('#igPreviewImg').count(), 1, 'the chosen cover shows in the preview'); checks++;
    await page.click('#igCoverRemove');
    assert.equal(await page.locator('#igPreviewImg').count(), 0, 'removing the cover empties the preview'); checks++;

    // --- a 9:16 upload: no warning, preview shows it, and it is sent as coverUrl only
    await page.setInputFiles('#igCoverFile', { name: 'cover.png', mimeType: 'image/png', buffer: COVER_PNG });
    await page.waitForSelector('#igPreviewImg');
    assert.equal(await page.locator('#igCoverNote').count(), 0, 'a 9:16 image raises no warning'); checks++;
    assert.match(await page.innerText('#igPreviewCard'), /Uploaded image/, 'the preview names the cover source'); checks++;
    await submitAndWait();
    assert.equal(calls.mints, 2, 'one storage address for the video, one for the cover'); checks++;
    assert.deepEqual(calls.puts.map(p => p.url.split('/').pop()), ['1', '2'], 'the video goes first, then the cover'); checks++;
    assert.equal(calls.puts[1].type, 'image/png', 'the cover is uploaded as the image it is'); checks++;
    assert.equal(calls.puts[1].size, COVER_PNG.length, 'the whole cover is uploaded'); checks++;
    let c = calls.creates[0];
    assert.equal(c.coverUrl, 'https://data.postforme.dev/m/2', 'the cover address from storage rides on the post'); checks++;
    assert.equal(c.options.cover_timestamp_ms, 0, 'no frame time is sent with an image cover'); checks++;
    assert.equal(c.mediaUrl, 'https://data.postforme.dev/m/1', 'the video address is the first one'); checks++;

    // --- the Calendar card picker: named like the Calendar names cards, Approved or Scheduled only, soonest first
    await page.evaluate((client) => {
      const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const st = (s) => ({ video_status: s, graphic_status: s, caption_status: s });
      const img = 'https://images.fixture.test/card.png';
      calState.client = client;
      calState.posts = [
        { id: 'p_15', name: 'Video 15', scheduled_date: d(3), order_index: 1, caption: 'Caption for 15', thumbnail_url: img, ...st('Approved') },
        { id: 'p_12', name: 'Video 12', scheduled_date: d(1), order_index: 9, caption: 'Caption for 12', thumbnail_url: img, ...st('Scheduled') },
        { id: 'p_9', name: 'Video 9', scheduled_date: d(-1), order_index: 3, caption: 'Past card', thumbnail_url: img, ...st('Approved') },
        { id: 'p_7', name: 'Video 7', scheduled_date: d(2), order_index: 4, caption: 'Posted card', thumbnail_url: img, ...st('Posted') },
        { id: 'p_20', name: 'Video 20', scheduled_date: d(4), order_index: 5, caption: 'Still in progress', thumbnail_url: img, ...st('In Progress') },
        { id: 'p_31', name: 'Video 31', scheduled_date: '', order_index: 5, caption: 'Undated caption 31', thumbnail_url: img, ...st('Approved') },
        { id: 'p_30', name: 'Video 30', scheduled_date: '', order_index: 2, caption: 'Undated caption 30', thumbnail_url: '', ...st('Scheduled') },
      ];
    }, TEST_CLIENT);
    await attachVideo();
    await pickSv(page, 'igClient', TEST_CLIENT);   // redraws the form, which now sees the Calendar
    await page.waitForSelector('#igCardBtn', { timeout: 5000 });
    const offered = await page.$$eval('#igCardMenu [data-sv-select-option]', os => os.map(o => o.textContent.trim()));
    assert.deepEqual(offered, ['No Calendar card', 'Video 12', 'Video 15', 'Video 30', 'Video 31'],
      'cards are named by card name; only Approved or Scheduled; dated from today soonest first, then undated in Calendar order; no posted, past or in-progress cards'); checks++;
    assert.equal(await page.inputValue('#igTitle'), '', 'the caption box starts empty'); checks++;
    await pickSv(page, 'igCard', 'p_15');
    await page.waitForSelector('#igPreviewImg', { timeout: 5000 });
    assert.equal(await page.inputValue('#igTitle'), 'Caption for 15', 'picking a card fills an empty caption'); checks++;
    assert.match(await page.innerText('#igPreviewCard'), /Calendar thumbnail/, 'the preview says the cover came from the Calendar'); checks++;
    await pickSv(page, 'igCard', 'p_12');
    await page.waitForFunction(() => /Calendar thumbnail/.test(document.querySelector('#igPreviewCard')?.innerText || ''));
    assert.equal(await page.inputValue('#igTitle'), 'Caption for 15', 'a caption already there is never overwritten'); checks++;
    await pickSv(page, 'igCard', 'p_30');
    await page.waitForSelector('#igCoverNote');
    assert.match(await page.innerText('#igCoverNote'), /no thumbnail yet/, 'a card without a thumbnail says so'); checks++;
    await pickSv(page, 'igCard', 'p_15');
    await page.waitForFunction(() => document.querySelector('#igPreviewImg'));
    await submitAndWait();
    c = calls.creates[1];
    assert.match(c.coverUrl, /^https:\/\/data\.postforme\.dev\/m\/\d+$/, 'the Calendar image was copied into Post For Me storage and sent as coverUrl'); checks++;
    assert.equal(c.title, 'Caption for 15', 'the card caption is what was posted'); checks++;
    assert.equal(calls.puts[calls.puts.length - 1].size, CAL_PNG.length, 'the Calendar thumbnail itself was uploaded'); checks++;

    // --- an empty caption is filled from a card with an empty caption box, even with no thumbnail
    await attachVideo();
    await pickSv(page, 'igCard', 'p_30');
    assert.equal(await page.inputValue('#igTitle'), 'Undated caption 30', 'a card with no thumbnail still fills the empty caption'); checks++;
    await page.fill('#igTitle', 'Frame cover caption');

    // --- the fallback: a frame of the video (sent as a time, with no image)
    const mintsBefore = calls.mints;
    await page.evaluate(() => {
      igState.cover.duration = 10;
      window._igCaptureFrame = async () => 'data:image/png;base64,' + 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
    });
    await page.click('label:has(input[name="igCoverMode"][value="frame"])');
    await page.waitForSelector('#igFrame');
    await page.evaluate(() => { const r = document.getElementById('igFrame'); r.value = '3000'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForSelector('#igPreviewImg');
    assert.match(await page.innerText('#igPreviewCard'), /Video frame at 3\.0 s/, 'the preview shows the chosen frame'); checks++;
    await submitAndWait();
    c = calls.creates[2];
    assert.equal(c.options.cover_timestamp_ms, 3000, 'the frame time is sent'); checks++;
    assert.equal(c.coverUrl, '', 'and no cover image with it'); checks++;
    assert.equal(calls.mints - mintsBefore, 1, 'a frame cover needs no extra upload'); checks++;

    // --- no cover at all: nothing extra is sent
    await attachVideo();
    await page.fill('#igTitle', 'Plain caption');
    await submitAndWait();
    c = calls.creates[3];
    assert.equal(c.coverUrl, '', 'no cover, no image'); checks++;
    assert.equal(c.options.cover_timestamp_ms, 0, 'no cover, no frame time'); checks++;

    assert.equal(await page.locator('#igFormCol select, #igFormCol input[type="range"][style*="display:none"]').count(), 0, 'no native select menus on the form'); checks++;
    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`instagram-cover-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
