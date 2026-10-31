'use strict';
// "Also post to Facebook" on the Instagram side (OPEN_REPAIRS 618). Opens the real page offline and proves the box's
// states: ticked by default when the client's Facebook Page is on file; unticked and disabled, with the reason, for
// a trial reel, for a carousel with a video, and for a client with no Page; what reaches the instagram-upload
// function in each case; and that the queue shows Instagram's and Facebook's results apart (a Facebook failure
// next to an Instagram success). Every backend answer is local: nothing reaches Post For Me or any real account.
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
const IG = 'spc_fixtureInstagram01';
const FB = 'spc_fixtureFacebook01';
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const clientsCsv = (withFacebook) => (withFacebook
  ? ['client_name,postforme_instagram_account_id,postforme_facebook_account_id', `${csv(TEST_CLIENT)},${csv(IG)},${csv(FB)}`]
  : ['client_name,postforme_instagram_account_id', `${csv(TEST_CLIENT)},${csv(IG)}`]).join('\r\n') + '\r\n';

function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const img = (name, rgb) => ({ name, mimeType: 'image/png', buffer: png(60, 75, rgb) });
const vid = (name) => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('not really a video ' + name) });

async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}

// One row already in the queue: posted on Instagram, failed on Facebook.
const SPLIT_ROW = {
  id: 'row_split', client: 'Fixture', title: 'Split result caption', status: 'posted', placement: 'reels', kind: 'reel', items: 1, trial: false,
  created_at: '2026-10-30T10:00:00.000Z', posted_at: '2026-10-30T10:01:00.000Z', instagram_url: 'https://www.instagram.com/reel/fixture/', error: '',
  facebook: { status: 'failed', url: '', error: 'Page token expired', posted_at: '', placement: 'reels' },
};

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  try {
    for (const withFacebook of [true, false]) {
      const calls = { mints: 0, creates: [] };
      const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
      await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
        const req = route.request(); const url = req.url();
        if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
        if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
        if (/\/gviz\/tq/.test(url)) {
          const sheet = new URL(url).searchParams.get('sheet') || '';
          return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? clientsCsv(withFacebook) : 'col\r\n' });
        }
        if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
        if (/functions\/v1\/instagram-upload/.test(url)) {
          const body = JSON.parse(req.postData() || '{}');
          const ok = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, ...obj }) });
          if (body.action === 'list') return ok({ rows: withFacebook ? [SPLIT_ROW] : [] });
          if (body.action === 'mint') { const n = ++calls.mints; return ok({ upload_url: `https://storage.fixture.test/put/${n}`, media_url: `https://data.postforme.dev/m/${n}` }); }
          if (body.action === 'create') {
            calls.creates.push(body);
            const carousel = body.kind === 'carousel';
            const fb = body.alsoFacebook ? { status: 'processing', url: '', error: '', posted_at: '', placement: carousel ? 'timeline' : 'reels' } : null;
            return ok({ id: body.idempotencyKey, status: 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: 'processing', placement: carousel ? 'timeline' : 'reels', kind: carousel ? 'carousel' : 'reel', items: carousel ? body.mediaUrls.length : 1, trial: false, created_at: new Date().toISOString(), error: '', instagram_url: '', facebook: fb } });
          }
          return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: '{"ok":false}' });
        }
        if (/functions\/v1\/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
        if (/storage\.fixture\.test/.test(url)) return route.fulfill({ status: 200, headers: cors, body: '' });
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
      assert.equal(await page.locator('#igFacebook').count(), 0, 'no Facebook box before a client is picked'); checks++;
      await pickSv(page, 'igClient', TEST_CLIENT);
      await page.waitForSelector('#igFacebook');
      const box = async () => ({ checked: await page.isChecked('#igFacebook'), disabled: await page.isDisabled('#igFacebook'), note: (await page.innerText('#igFacebookNote')).trim() });
      const sendReel = async (caption) => {
        await page.setInputFiles('#igFile', vid(caption + '.mp4'));
        await page.fill('#igTitle', caption);
        await page.click('#igSubmit');
        await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
        return calls.creates[calls.creates.length - 1];
      };

      if (!withFacebook) {
        // --- a client with no Facebook Page: the box is off, says why, and nothing goes to Facebook
        let b = await box();
        assert.deepEqual([b.checked, b.disabled], [false, true], 'no Page: unticked and disabled'); checks++;
        assert.match(b.note, /No Facebook Page connected for this client/, 'no Page: the reason is shown'); checks++;
        const c = await sendReel('No page caption');
        assert.ok(!('alsoFacebook' in c) && !('facebookAccountId' in c), 'no Page: the create is exactly as before'); checks++;
        assert.match(await page.innerText('#igFormCol'), /Sent to Instagram\. It will show as Posted here once Instagram confirms\./, 'no Page: the old message'); checks++;
        assert.doesNotMatch(await page.innerText('#igQueueCol'), /Facebook/, 'no Page: the queue never mentions Facebook'); checks++;
        assert.deepEqual(errors, [], 'no page errors'); checks++;
        await context.close();
        continue;
      }

      // --- Page on file: ticked by default for a Reel
      let b = await box();
      assert.deepEqual([b.checked, b.disabled], [true, false], 'ticked and usable by default'); checks++;
      assert.match(b.note, /Facebook Reel/, 'it says the Reel goes to Facebook as a Facebook Reel'); checks++;
      const heads = await page.$$eval('#igFormCol > .tk-card h3', hs => hs.map(h => h.firstChild.textContent.trim()));
      assert.ok(heads.indexOf('Facebook') === heads.indexOf('Scheduling') - 1, 'the Facebook card sits just above Scheduling'); checks++;

      // --- a trial reel: unticked and disabled, with the reason; untrialled it comes back ticked
      await page.click('label:has(#igTrial)');
      b = await box();
      assert.deepEqual([b.checked, b.disabled], [false, true], 'trial: unticked and disabled'); checks++;
      assert.match(b.note, /Trial reels are an Instagram feature, so this one posts to Instagram only/, 'trial: the plain reason'); checks++;
      await page.click('label:has(#igTrial)');
      b = await box();
      assert.deepEqual([b.checked, b.disabled], [true, false], 'trial off: ticked again'); checks++;

      // --- the person can untick it; it stays unticked until the client changes
      await page.click('label:has(#igFacebook)');
      b = await box();
      assert.deepEqual([b.checked, b.disabled, b.note], [false, false, 'Instagram only.'], 'unticked by hand: Instagram only'); checks++;
      let c = await sendReel('Instagram only caption');
      assert.ok(!('alsoFacebook' in c), 'unticked: nothing goes to Facebook'); checks++;
      assert.equal(await page.isChecked('#igFacebook'), false, 'still unticked after the post'); checks++;
      await page.click('label:has(#igFacebook)');
      assert.equal(await page.isChecked('#igFacebook'), true, 'ticked again by hand'); checks++;

      // --- ticked: one create carrying the Page
      c = await sendReel('Both caption');
      assert.equal(c.alsoFacebook, true, 'ticked: alsoFacebook is sent'); checks++;
      assert.equal(c.facebookAccountId, FB, 'with the Page on file'); checks++;
      assert.equal(c.socialAccountId, IG, 'and the Instagram account as before'); checks++;
      assert.equal(calls.creates.filter(x => x.title === 'Both caption').length, 1, 'one create, not one per network'); checks++;
      assert.match(await page.innerText('#igFormCol'), /Sent to Instagram and Facebook/, 'the message names both'); checks++;
      const newRow = page.locator('#igQueueCol .tk-queue-item', { hasText: 'Both caption' });
      assert.match(await newRow.innerText(), /Instagram and Facebook[\s\S]*Instagram[\s\S]*Posting[\s\S]*Facebook[\s\S]*Posting/, 'the new row shows each network on its own line'); checks++;

      // --- the queue keeps a Facebook failure next to an Instagram success
      await page.click('[data-ig-tab="failed"]');
      const split = page.locator('#igQueueCol .tk-queue-item', { hasText: 'Split result caption' });
      assert.equal(await split.count(), 1, 'a Facebook failure puts the row under Failed'); checks++;
      const splitText = await split.innerText();
      assert.match(splitText, /Instagram\s*Posted/, 'Instagram still reads Posted'); checks++;
      assert.match(splitText, /Facebook\s*Failed[\s\S]*Page token expired/, 'Facebook reads Failed, with its reason'); checks++;
      assert.equal(await split.locator('a[aria-label="Open on Instagram"]').getAttribute('href'), SPLIT_ROW.instagram_url, 'the Instagram link is there'); checks++;
      assert.equal(await split.locator('a[aria-label="Open on Facebook"]').count(), 0, 'no Facebook link for a failed Facebook post'); checks++;

      // --- carousels: photos only goes to Facebook; a video keeps it Instagram only
      await page.click('label:has(input[name="igKind"][value="carousel"])');
      await page.waitForSelector('#igCarDrop');
      await page.setInputFiles('#igCarFile', [img('a.png', [200, 30, 30]), img('b.png', [30, 30, 200])]);
      await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 2);
      b = await box();
      assert.deepEqual([b.checked, b.disabled], [true, false], 'photo carousel: ticked'); checks++;
      assert.match(b.note, /photos also go to the client's Facebook Page as one post/, 'photo carousel: what happens'); checks++;
      await page.setInputFiles('#igCarFile', [vid('c.mp4')]);
      await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 3);
      b = await box();
      assert.deepEqual([b.checked, b.disabled], [false, true], 'carousel with a video: unticked and disabled'); checks++;
      assert.match(b.note, /Facebook takes a carousel of photos only\. This one has a video, so it posts to Instagram only\./, 'the plain reason'); checks++;
      await page.click('#igCarGrid .tk-photo-item:nth-child(3) [data-action="remove"]');
      await page.waitForFunction(() => document.querySelectorAll('#igCarGrid .tk-photo-item').length === 2);
      assert.equal(await page.isChecked('#igFacebook'), true, 'video removed: ticked again'); checks++;
      await page.fill('#igTitle', 'Carousel both');
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram and Facebook/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
      c = calls.creates[calls.creates.length - 1];
      assert.equal(c.kind, 'carousel', 'a carousel create'); checks++;
      assert.deepEqual([c.alsoFacebook, c.facebookAccountId, c.itemTypes], [true, FB, ['image', 'image']], 'with the Page and one type per item'); checks++;

      // --- phone width: the card fits without a sideways scroll
      await page.setViewportSize({ width: 390, height: 900 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll at 390'); checks++;

      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`instagram-facebook-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
