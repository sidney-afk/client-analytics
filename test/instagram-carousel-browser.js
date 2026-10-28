'use strict';
// The Instagram side's Reel / Carousel choice. Opens the real page offline and proves the carousel picker works the
// way TikTok's Photo carousel does (pick or drop several files, arrows to reorder, x to remove, keyboard focus kept),
// with Instagram's limits (2 to 10 items, images and videos mixed), that a Reel-only field (cover, trial) is not
// offered on a carousel, and that what reaches the instagram-upload function is one create with kind "carousel"
// and the storage addresses in carousel order. A Reel posted afterwards is sent exactly as before.
// Every backend answer is local: nothing reaches Post For Me or any real account.
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
const RED = png(80, 100, [200, 30, 30]);
const BLUE = png(80, 100, [30, 30, 200]);
const GREEN = png(80, 100, [30, 160, 60]);
const img = (name, buf) => ({ name, mimeType: 'image/png', buffer: buf });
const vid = (name) => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('not really a video ' + name) });

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
          const carousel = body.kind === 'carousel';
          return ok({ id: body.idempotencyKey, status: 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: 'processing', placement: carousel ? 'timeline' : 'reels', kind: carousel ? 'carousel' : 'reel', items: carousel ? body.mediaUrls.length : 1, trial: false, created_at: new Date().toISOString(), error: '', instagram_url: '' } });
        }
        return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
      }
      if (/functions\/v1\/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
      if (/storage\.fixture\.test/.test(url)) { calls.puts.push({ method: req.method(), type: req.headers()['content-type'], size: (req.postDataBuffer() || Buffer.alloc(0)).length, head: (req.postDataBuffer() || Buffer.alloc(0)).subarray(0, 3).toString('hex'), url }); return route.fulfill({ status: 200, headers: cors, body: '' }); }
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
    await pickSv(page, 'igClient', TEST_CLIENT);

    const heads = () => page.$$eval('#igFormCol > .tk-card h3', hs => hs.map(h => h.firstChild.textContent.trim()));
    const badges = () => page.$$eval('#igCarGrid .tk-photo-badge', bs => bs.map(b => b.textContent.trim()));
    const order = () => page.$$eval('#igCarGrid .tk-photo-item img, #igCarGrid .tk-photo-item video', els => els.map(e => e.getAttribute('alt') || e.getAttribute('aria-label')));

    // --- Reel is the default, and the Reel form is as it was
    assert.equal(await page.isChecked('input[name="igKind"][value="reel"]'), true, 'Reel is picked by default'); checks++;
    assert.deepEqual((await heads()).slice(0, 4), ['Client', 'Video', 'Cover image', 'Caption'], 'the Reel form keeps Video, then Cover image, then Caption'); checks++;
    assert.equal(await page.locator('#igTrial').count(), 1, 'a Reel offers the Trial reel switch'); checks++;

    // --- switching to Carousel: no cover, no trial (a trial switched on beforehand is switched off)
    await page.click('label:has(#igTrial)');
    assert.equal(await page.isChecked('#igTrial'), true, 'trial switched on for the Reel'); checks++;
    await page.click('label:has(input[name="igKind"][value="carousel"])');
    await page.waitForSelector('#igCarDrop');
    assert.deepEqual((await heads()).slice(0, 3), ['Client', 'Carousel', 'Caption'], 'a carousel has no Cover image card'); checks++;
    assert.equal(await page.locator('#igTrial').count(), 0, 'a carousel has no Trial reel switch'); checks++;
    assert.equal(await page.evaluate(() => igState.trial), false, 'the trial is switched off when the carousel is picked'); checks++;
    assert.match(await page.innerText('#igCarDrop'), /2 to 10 items/, 'the drop zone states the limits'); checks++;

    // --- one item is not enough
    await page.fill('#igTitle', 'Carousel caption');
    await page.setInputFiles('#igCarFile', [img('one.png', RED)]);
    await page.waitForSelector('#igCarGrid');
    assert.equal(await page.isDisabled('#igSubmit'), true, 'one item cannot be posted'); checks++;
    assert.match(await page.innerText('#igCarCount'), /1 of 10 items · add at least 2/, 'the count asks for a second item'); checks++;

    // --- several at once, images and videos mixed, wrong types refused
    await page.setInputFiles('#igCarFile', [vid('two.mp4'), img('three.png', BLUE), { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }]);
    await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 3);
    assert.deepEqual(await badges(), ['1', '2 · Video', '3'], 'three items in the order picked, the video marked'); checks++;
    assert.match(await page.innerText('#igFormCol'), /notes\.txt" is not a JPEG, PNG or WEBP image, or a video/, 'a file that is neither is refused with its name'); checks++;
    assert.equal(await page.isDisabled('#igSubmit'), false, 'two or more items with a caption can be posted'); checks++;
    assert.equal(await page.locator('#igPreviewCard video#igPreviewImg, #igPreviewCard img#igPreviewImg').count(), 1, 'the preview shows the first item'); checks++;
    assert.match(await page.innerText('#igPreviewCard'), /Carousel · 3 items/, 'the preview says how many items'); checks++;

    // --- reorder with the arrows, keyboard focus follows the item
    await page.click('[data-ig-car-idx="2"][data-action="move-earlier"]');
    assert.deepEqual(await order(), ['Image 1', 'Image 2', 'Video 3'], 'the third item moved to second place'); checks++;
    assert.deepEqual(await page.evaluate(() => igState.items.map(i => i.file.name)), ['one.png', 'three.png', 'two.mp4'], 'the carousel order follows the arrows'); checks++;
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-ig-car-idx') + ':' + document.activeElement.getAttribute('data-action')), '1:move-earlier', 'focus stays on the moved item'); checks++;
    assert.equal(await page.isDisabled('[data-ig-car-idx="0"][data-action="move-earlier"]'), true, 'the first item cannot move earlier'); checks++;
    assert.equal(await page.isDisabled('[data-ig-car-idx="2"][data-action="move-later"]'), true, 'the last item cannot move later'); checks++;
    await page.click('[data-ig-car-idx="0"][data-action="move-later"]');
    assert.deepEqual(await page.evaluate(() => igState.items.map(i => i.file.name)), ['three.png', 'one.png', 'two.mp4'], 'and back with the other arrow'); checks++;

    // --- the limit: at most 10, the drop zone goes away when full
    await page.setInputFiles('#igCarFile', Array.from({ length: 9 }, (_, i) => img('extra' + i + '.png', GREEN)));
    await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 10);
    assert.match(await page.innerText('#igFormCol'), /Only 7 more items fit: a carousel holds 10/, 'files past the tenth are refused, and it says so'); checks++;
    assert.equal(await page.locator('#igCarDrop').count(), 0, 'a full carousel offers no drop zone'); checks++;

    // --- remove: the item goes, focus lands on the item that slid into its place
    for (let n = 0; n < 7; n++) await page.click('[data-ig-car-idx="3"][data-action="remove"]');
    assert.deepEqual(await page.evaluate(() => igState.items.map(i => i.file.name)), ['three.png', 'one.png', 'two.mp4'], 'removing takes exactly the item pressed'); checks++;
    assert.ok(await page.evaluate(() => /remove/.test(document.activeElement?.getAttribute('data-action') || '') || document.activeElement?.id === 'igCarFile'), 'focus stays in the picker after a remove'); checks++;
    await page.click('[data-ig-car-idx="1"][data-action="remove"]');
    assert.deepEqual(await page.evaluate(() => igState.items.map(i => i.file.name)), ['three.png', 'two.mp4'], 'the middle one removed'); checks++;
    await page.setInputFiles('#igCarFile', [img('four.png', RED)]);
    await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 3);

    // --- drop several files onto the zone
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }));
      dt.items.add(new File([new Uint8Array([1, 2, 3])], 'dropped.mp4', { type: 'video/mp4' }));
      document.getElementById('igCarDrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, GREEN.toString('base64'));
    await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 5);
    assert.deepEqual(await page.evaluate(() => igState.items.map(i => i.file.name)), ['three.png', 'two.mp4', 'four.png', 'dropped.png', 'dropped.mp4'], 'dropped files join the end of the carousel'); checks++;

    // --- post: one storage address per item, in carousel order, then one create
    await page.click('#igSubmit');
    await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || ''), null, { timeout: 15000 });
    assert.equal(calls.mints, 5, 'one storage address per item'); checks++;
    assert.deepEqual(calls.puts.map(p => p.url.split('/').pop()), ['1', '2', '3', '4', '5'], 'items go up one after another'); checks++;
    assert.deepEqual(calls.puts.map(p => p.type), ['image/jpeg', 'video/mp4', 'image/jpeg', 'image/jpeg', 'video/mp4'], 'images go up as JPEG (Instagram feed images), videos as they are'); checks++;
    assert.ok(calls.puts.filter(p => p.type === 'image/jpeg').every(p => p.head === 'ffd8ff'), 'the PNGs were redrawn as real JPEGs'); checks++;
    assert.equal(calls.creates.length, 1, 'one create call'); checks++;
    let c = calls.creates[0];
    assert.equal(c.kind, 'carousel', 'the create says carousel'); checks++;
    assert.deepEqual(c.mediaUrls, [1, 2, 3, 4, 5].map(n => 'https://data.postforme.dev/m/' + n), 'the storage addresses, in carousel order'); checks++;
    assert.ok(!('mediaUrl' in c) && !('coverUrl' in c), 'no single video and no cover ride on a carousel'); checks++;
    assert.deepEqual(c.options, {}, 'no trial and no cover frame in the options'); checks++;
    assert.equal(c.title, 'Carousel caption', 'the caption is sent'); checks++;
    assert.equal(c.clientName, TEST_CLIENT, 'for the picked client'); checks++;
    assert.equal(c.socialAccountId, ACCOUNT_ID, 'to its account on file'); checks++;
    assert.match(await page.innerText('#igQueueCol'), /Carousel \(5\)/, 'the queue row reads Carousel (5)'); checks++;
    assert.equal(await page.locator('#igCarGrid').count(), 0, 'the picker is empty after posting'); checks++;
    assert.equal(await page.isChecked('input[name="igKind"][value="carousel"]'), true, 'Carousel stays picked for the next post'); checks++;

    // --- back to Reel: the Reel form and its post are as before
    await page.click('label:has(input[name="igKind"][value="reel"])');
    await page.waitForSelector('#igDrop');
    assert.deepEqual((await heads()).slice(0, 4), ['Client', 'Video', 'Cover image', 'Caption'], 'Reel brings back the cover'); checks++;
    assert.equal(await page.locator('#igTrial').count(), 1, 'and the Trial reel switch'); checks++;
    await page.setInputFiles('#igFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
    await page.fill('#igTitle', 'Reel caption');
    await page.click('#igSubmit');
    await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    c = calls.creates[1];
    assert.ok(!('kind' in c) && !('mediaUrls' in c), 'a Reel create carries no kind and no list'); checks++;
    assert.equal(c.mediaUrl, 'https://data.postforme.dev/m/6', 'a Reel sends its one video'); checks++;
    assert.match(await page.innerText('#igQueueCol'), /Reel/, 'the Reel row reads Reel'); checks++;

    // --- phone width: the picker fits without a sideways scroll
    await page.setViewportSize({ width: 390, height: 900 });
    await page.click('label:has(input[name="igKind"][value="carousel"])');
    await page.setInputFiles('#igCarFile', [img('a.png', RED), img('b.png', BLUE), img('c.png', GREEN)]);
    await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 390'); checks++;
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('#igCarGrid .tk-photo-btn')].every(b => b.getBoundingClientRect().height >= 44)), 'the arrows and x are 44 px touch targets'); checks++;

    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`instagram-carousel-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
