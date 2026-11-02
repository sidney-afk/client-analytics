'use strict';
// TikTok keeps its press key across a reload while the post's outcome is unknown (plan row P0, OPEN_REPAIRS 647).
// Opens the real page offline, on the live path (the tiktok-upload function), and proves:
//   1. the create's answer is lost; the page is reloaded; the same file is attached again and the form is
//      unchanged; the re-press sends the SAME key and the same storage address, and mints nothing new (so the
//      server adopts the first post instead of making a second one);
//   2. after that success the kept attempt is gone, so the next post gets a key of its own;
//   3. a changed form after the reload gets a new key and a new upload;
//   4. a kept attempt older than Post for Me keeps an unattached upload (24 hours) keeps its key but uploads
//      the video again, after a reload and in a page left open alike (the key, not the upload, is what lets the
//      function find a first post that did land);
//   5. a clear "no" (HTTP 400) drops the kept attempt as well.
// Every backend answer is local; nothing reaches Post for Me.
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
const CLIENTS_CSV = ['client_name,postforme_account_id', `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')}`].join('\r\n') + '\r\n';
const RETRY_KEY = 'syncview_tiktokRetryCreate_v1';
const LOST = /could not be reached to finish creating the post/;

// One page whose tiktok-upload function answers each create as `plan` says: 'lost' drops the connection,
// 'no' answers HTTP 400, anything else succeeds.
async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const calls = { mints: 0, creates: [], plan: [] };
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
    }
    if (/syncview_runtime_flags/.test(url) && /tiktok/i.test(decodeURIComponent(url))) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify([{ value: { source: 'supabase' } }]) });
    if (/functions\/v1\/tiktok-upload\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      const ok = (obj) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, ...obj }) });
      if (body.action === 'mint') { const n = ++calls.mints; return ok({ upload_url: `https://storage.fixture.test/put/${n}`, media_url: `https://data.postforme.dev/m/${n}` }); }
      if (body.action === 'create') {
        calls.creates.push(body);
        const how = calls.plan.shift() || 'ok';
        if (how === 'lost') return route.abort('connectionreset');
        if (how === 'no') return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: false, error: 'That account is not a TikTok one.' }) });
        return ok({ id: body.idempotencyKey, status: 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: 'processing', created_at: new Date().toISOString(), error: '' } });
      }
      return ok({ rows: [] });
    }
    if (/storage\.fixture\.test/.test(url)) return route.fulfill({ status: 200, headers: cors, body: '' });
    if (/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
    if (/n8n\.cloud/.test(url)) throw new Error('the dead n8n path was used: ' + url);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\/|uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, calls, errors };
}

// The same file a person picks again from disk: same name, size and modified time.
async function attach(page, name) {
  await page.waitForSelector('#tkFile');
  await page.evaluate((n) => {
    const dt = new DataTransfer();
    dt.items.add(new File(['not really a video ' + n], n, { type: 'video/mp4', lastModified: 1761955200000 }));
    const input = document.getElementById('tkFile');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, name);
  await page.waitForSelector('.tk-file-card');
}
async function openForm(page, base, pickClient) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  if (pickClient) {
    await page.fill('#tkClientInput', TEST_CLIENT);
    await page.press('#tkClientInput', 'Enter');
  }
  await page.waitForSelector('[data-tk-picked-client]');
}
async function press(page, expect) {
  await page.click('#tkSubmit');
  await page.waitForFunction((src) => !tkState.submitting && (src ? new RegExp(src).test(document.querySelector('#tkFormCol .tk-error')?.textContent || '') : !tkState.error && !tkState.file), expect ? expect.source : '', { timeout: 15000 });
  // A success says "Upload queued" in a notice; close it as a person would.
  if (!expect) {
    await page.waitForSelector('#confirmOverlay.active', { timeout: 5000 }).catch(() => {});
    if (await page.locator('#confirmOverlay.active').count()) { await page.keyboard.press('Escape'); await page.waitForSelector('#confirmOverlay.active', { state: 'detached', timeout: 5000 }).catch(() => {}); await page.waitForFunction(() => !document.querySelector('#confirmOverlay.active'), null, { timeout: 5000 }); }
  }
}
const kept = (page) => page.evaluate((k) => localStorage.getItem(k), RETRY_KEY);

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  try {
    // ---- 1 and 2: lost answer, reload, unchanged re-press: same key, same media, no new mint
    {
      const { context, page, calls, errors } = await newPage(browser);
      await openForm(page, base, true);
      await attach(page, 'clip-one.mp4');
      await page.fill('#tkTitle', 'Lost answer caption');
      calls.plan.push('lost');
      await press(page, LOST);
      assert.equal(calls.creates.length, 1); assert.equal(calls.mints, 1);
      await page.waitForTimeout(500); // the draft saves on a short timer
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openForm(page, base, false);
      assert.equal(await page.inputValue('#tkTitle'), 'Lost answer caption', 'the draft came back');
      await attach(page, 'clip-one.mp4');
      await press(page, null);
      const [first, second] = calls.creates;
      assert.equal(second.idempotencyKey, first.idempotencyKey, 'after a reload, the re-press sends the same key'); checks++;
      assert.equal(second.mediaUrl, first.mediaUrl, 'and the video already in storage'); checks++;
      assert.equal(calls.mints, 1, 'and mints nothing new'); checks++;
      assert.equal(await kept(page), null, 'a success drops the kept attempt'); checks++;
      // The next post is a new one.
      await attach(page, 'clip-two.mp4');
      await page.fill('#tkTitle', 'Next post');
      await press(page, null);
      assert.notEqual(calls.creates[2].idempotencyKey, first.idempotencyKey, 'the next post gets its own key'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- 3: a changed form after the reload is a new post
    {
      const { context, page, calls, errors } = await newPage(browser);
      await openForm(page, base, true);
      await attach(page, 'clip-one.mp4');
      await page.fill('#tkTitle', 'Before the change');
      calls.plan.push('lost');
      await press(page, LOST);
      await page.waitForTimeout(500);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openForm(page, base, false);
      await attach(page, 'clip-one.mp4');
      await page.fill('#tkTitle', 'After the change');
      await press(page, null);
      assert.notEqual(calls.creates[1].idempotencyKey, calls.creates[0].idempotencyKey, 'a changed form gets a new key'); checks++;
      assert.equal(calls.mints, 2, 'and uploads again'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- 4: a kept attempt older than an unattached upload lives is dropped
    {
      const { context, page, calls, errors } = await newPage(browser);
      await openForm(page, base, true);
      await attach(page, 'clip-one.mp4');
      await page.fill('#tkTitle', 'Old attempt');
      calls.plan.push('lost');
      await press(page, LOST);
      await page.waitForTimeout(500);
      const raw = await kept(page);
      assert.ok(raw, 'the lost attempt is kept in this browser'); checks++;
      await page.evaluate(([k, v]) => { const o = JSON.parse(v); o.savedAt = Date.now() - 25 * 3600 * 1000; localStorage.setItem(k, JSON.stringify(o)); }, [RETRY_KEY, raw]);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await openForm(page, base, false);
      await attach(page, 'clip-one.mp4');
      await press(page, null);
      assert.equal(calls.creates[1].idempotencyKey, calls.creates[0].idempotencyKey, 'a 25-hour-old attempt keeps its key'); checks++;
      assert.equal(calls.mints, 2, 'but the video is uploaded again (Post for Me has deleted the old copy)'); checks++;
      assert.notEqual(calls.creates[1].mediaUrl, calls.creates[0].mediaUrl, 'and the new storage address is sent'); checks++;
      assert.equal(await kept(page), null, 'the success then drops it'); checks++;
      // The same in a page left open: no reload, the in-memory attempt ages past the upload's life.
      await attach(page, 'clip-three.mp4');
      await page.fill('#tkTitle', 'Open all day');
      calls.plan.push('lost');
      await press(page, LOST);
      await page.evaluate(() => { tkState.retryCreate.savedAt = Date.now() - 25 * 3600 * 1000; });
      await press(page, null);
      assert.equal(calls.creates[3].idempotencyKey, calls.creates[2].idempotencyKey, 'a page left open keeps the key too'); checks++;
      assert.equal(calls.mints, 4, 'and uploads again'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- 5: a clear no drops the kept attempt
    {
      const { context, page, calls, errors } = await newPage(browser);
      await openForm(page, base, true);
      await attach(page, 'clip-one.mp4');
      await page.fill('#tkTitle', 'Refused');
      calls.plan.push('lost', 'no');
      await press(page, LOST);
      assert.ok(await kept(page), 'kept after the lost answer'); checks++;
      await press(page, /not a TikTok one/);
      assert.equal(calls.creates[1].idempotencyKey, calls.creates[0].idempotencyKey, 'the in-page re-press already reused the key'); checks++;
      assert.equal(await kept(page), null, 'a 400 drops the kept attempt'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }
    console.log(`tiktok-press-key-reload-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
