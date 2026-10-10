'use strict';
/*
 * The Instagram form's Calendar cover belongs to the client it was picked for.
 * Found 2026-10-10 (Digger, bug archaeology, OPEN_REPAIRS 397), the shape of
 * OPEN_REPAIRS 375 (a result decided its client after an await):
 *
 *   Pick a Calendar card on client A. While "Copying the Calendar thumbnail…"
 *   shows, pick client B. The client change cleared a Calendar cover only if one
 *   was already set, and the copy had not landed, so when it landed A's
 *   thumbnail became B's Reel cover (with A's card id), ready to be posted to
 *   B's Instagram. The caption the card filled in stayed too.
 *
 * Now the copy is dropped when the client or the picked card changed while it
 * ran, and a caption filled in from A's card (and not edited) leaves with A.
 * Real page, every backend answer local.
 */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const OTHER = 'Fixture Second Client';
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_instagram_account_id', `${csv(TEST_CLIENT)},${csv('spc_fixtureA')}`, `${csv(OTHER)},${csv('spc_fixtureB')}`].join('\r\n') + '\r\n';
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const CAL_PNG = png(72, 128, [30, 160, 60]);
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  let release = null;
  let thumbAsked = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
      const req = route.request(); const url = req.url();
      const json = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return json({ ok: true, role: 'admin', member: ADMIN });
      if (/\/gviz\/tq/.test(url)) {
        const sheet = new URL(url).searchParams.get('sheet') || '';
        return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
      }
      if (/functions\/v1\/instagram-upload/.test(url)) return json({ ok: true, rows: [] });
      if (/images\.fixture\.test/.test(url)) {
        thumbAsked++;
        if (release) await new Promise(r => { const prev = release; release = () => { prev(); r(); }; });
        return route.fulfill({ status: 200, contentType: 'image/png', headers: cors, body: CAL_PNG });
      }
      if (req.method() !== 'GET' && !/write-diagnostics/.test(url)) throw new Error('unexpected write: ' + req.method() + ' ' + url);
      return json(/\/rest\/v1\//.test(url) ? [] : {});
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tkPlatInstagram', { timeout: 20000 });
    await page.click('#tkPlatInstagram');
    await page.waitForSelector('#igFormCol:not([hidden])');
    await page.evaluate(([client, other]) => {
      if (!WL_CLIENT_NAMES.includes(other)) WL_CLIENT_NAMES.push(other);
      const d = (n) => { const t = new Date(); t.setDate(t.getDate() + n); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      calState.client = client;
      calState.posts = [{ id: 'p_a1', name: 'Video 1', scheduled_date: d(2), order_index: 1, caption: 'Client A caption', thumbnail_url: 'https://images.fixture.test/a.png', video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' }];
    }, [TEST_CLIENT, OTHER]);
    await pickSv(page, 'igClient', TEST_CLIENT);
    await page.waitForSelector('#igCardBtn', { timeout: 5000 });

    // A's card is picked; its thumbnail copy is held in flight.
    release = () => {};
    await pickSv(page, 'igCard', 'p_a1');
    for (let i = 0; i < 100 && !thumbAsked; i++) await page.waitForTimeout(20);
    ok(thumbAsked === 1, "A's thumbnail copy started");
    ok(await page.inputValue('#igTitle') === 'Client A caption', "A's card filled the empty caption");
    // B is picked while the copy runs, then the copy lands.
    await pickSv(page, 'igClient', OTHER);
    const r = release; release = null; r();
    await page.waitForTimeout(600);
    const st = await page.evaluate(() => ({ client: igState.client, blob: !!igState.cover.blob, cardId: igState.cover.cardId, source: igState.cover.source, title: igState.title, img: !!document.querySelector('#igPreviewImg') }));
    ok(st.client === OTHER, 'the form is on client B');
    ok(!st.blob && !st.img && st.source !== 'calendar', `A's Calendar thumbnail is not B's cover (cover from ${st.source || 'nothing'}, card ${st.cardId || 'none'})`);
    ok(st.cardId === '', "no A card id rides on B's form");
    ok(st.title === '', `the caption A's card filled in left with A (caption box: ${JSON.stringify(st.title)})`);

    // A caption the person typed stays across a client change.
    await page.fill('#igTitle', 'Typed by a person');
    await pickSv(page, 'igClient', TEST_CLIENT);
    ok(await page.inputValue('#igTitle') === 'Typed by a person', 'a typed caption is never cleared');

    // The ordinary path still works: pick the card and let the copy land.
    await page.fill('#igTitle', '');
    await page.evaluate(() => { igState.title = ''; });
    await pickSv(page, 'igCard', 'p_a1');
    await page.waitForSelector('#igPreviewImg', { timeout: 5000 });
    ok(await page.evaluate(() => igState.cover.source === 'calendar' && igState.cover.cardId === 'p_a1'), 'with no switch, the Calendar thumbnail becomes the cover');

    assert.deepEqual(errors, [], 'no page errors');
    console.log(`instagram-cover-client-switch-browser: ${checks} checks passed ✅`);
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
