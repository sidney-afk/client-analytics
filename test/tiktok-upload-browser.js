'use strict';
// TikTok Upload tab off n8n and off the Sheet (OPEN_REPAIRS 362). Opens the real page offline with the switch
// syncview_runtime_flags.tiktok_upload_source = {"source":"supabase"} and answers the tiktok-upload and
// tiktok-upload-cancel calls with the functions' OWN code (supabase/functions/tiktok-upload/handler.mjs and
// tiktok-upload-cancel/logic.mjs) over a fake Post For Me and a fake tiktok_uploads table. Proves:
//   1. the queue comes from the function, and a result Post For Me already has lands on the row (posted);
//   2. submit: a small video goes mint -> PUT to storage -> create, never through any n8n webhook;
//   3. a Post For Me refusal shows its reason on the form, and Retry sends the kept request again;
//   4. cancel: success, already posted, and a failed cancel each end where they should;
//   5. every function call carries the staff key; no n8n webhook is ever called.
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');
const { fakePostForMe, fakeQueueTable, cancelQueueOver } = require('./helpers/tiktok-upload-fakes.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const CLIENT = 'Fixture Upload Client';
const ACCOUNT = 'spc_fixtureUpload01';
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
const H = 3600000, now = Date.now();
const at = (h) => new Date(now + h * H).toISOString();
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';

(async () => {
  const { handleTiktokUpload } = await import(pathToFileURL(path.join(__dirname, '../supabase/functions/tiktok-upload/handler.mjs')).href);
  const C = await import(pathToFileURL(path.join(__dirname, '../supabase/functions/tiktok-upload-cancel/logic.mjs')).href);
  const pfm = fakePostForMe({
    accounts: { [ACCOUNT]: 'tiktok' },
    posts: {
      sp_future: { id: 'sp_future', status: 'scheduled' },
      sp_gone_out: { id: 'sp_gone_out', status: 'processed' },
      sp_stubborn: { id: 'sp_stubborn', status: 'scheduled' },
    },
    results: { sp_overdue: [{ post_id: 'sp_overdue', success: true, platform_data: { url: 'https://example.invalid/video/7' } }] },
  });
  const base = { client: CLIENT, profile: ACCOUNT, timezone: 'UTC', error: '', tiktok_url: '' };
  const store = fakeQueueTable({
    profiles: [{ slug: 'fixtureuploadclient', display_name: CLIENT, postforme_account_id: ACCOUNT }],
    rows: [
      { ...base, id: 'old', title: 'Copied from the Sheet', status: 'posted', created_at: at(-200), updated_at: at(-200), source: 'sheet' },
      { ...base, id: 'future', title: 'Cancel me', status: 'scheduled', scheduled_for: at(30), upload_post_id: 'sp_future', created_at: at(-2) },
      { ...base, id: 'gone', title: 'Already went out', status: 'scheduled', scheduled_for: at(31), upload_post_id: 'sp_gone_out', created_at: at(-2) },
      { ...base, id: 'stubborn', title: 'Will not cancel', status: 'scheduled', scheduled_for: at(32), upload_post_id: 'sp_stubborn', created_at: at(-2) },
      { ...base, id: 'overdue', title: 'Result came back', status: 'processing', upload_post_id: 'sp_overdue', created_at: at(-5) },
    ],
  });

  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const fnCalls = [], n8nCalls = [], puts = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
      if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
      if (/syncview_runtime_flags.*tiktok_upload_source/.test(url)) return reply(200, [{ value: { source: 'supabase' } }]);
      if (/gviz\/tq/.test(url)) {
        const sheet = new URL(url).searchParams.get('sheet') || '';
        return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? `client_name,postforme_account_id\r\n${csv(CLIENT)},${csv(ACCOUNT)}\r\n` : 'col\r\n' });
      }
      if (/\/functions\/v1\/tiktok-upload$/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        fnCalls.push({ action: body.action, key: req.headers()['x-syncview-key'] || '' });
        const out = await handleTiktokUpload({ body, role: 'admin', actor: 'QA Admin', pfm, store, readSheet: async () => null });
        return reply(out.status, out.body);
      }
      if (/\/functions\/v1\/tiktok-upload-cancel$/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        fnCalls.push({ action: 'cancel', key: req.headers()['x-syncview-key'] || '' });
        const out = await C.cancelTiktokUpload({ id: body.id, pfm, queue: C.firstQueue([cancelQueueOver(store)]), nowIso: new Date().toISOString() });
        return reply(out.status, out.body);
      }
      if (/storage\.postforme\.test/.test(url)) { puts.push({ url, type: req.headers()['content-type'] || '', bytes: (req.postDataBuffer() || Buffer.alloc(0)).length }); return reply(200, {}); }
      if (/\/webhook\//.test(url)) { n8nCalls.push(url); return reply(500, { ok: false }); }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#tkQueueCol .tk-queue-item').length >= 3, null, { timeout: 20000 });
    const queueText = () => page.locator('#tkQueueCol').innerText();
    const row = (title) => page.locator('#tkQueueCol .tk-queue-item', { hasText: title });
    const tab = async (name) => { await page.click(`.tk-q-tab:has-text("${name}")`); };
    const notice = async () => {
      await page.waitForSelector('#confirmOverlay.active', { timeout: 10000 });
      const t = await page.locator('#confirmTitle').innerText();
      await page.click('#confirmYes');
      await page.waitForFunction(() => !document.querySelector('#confirmOverlay.active'));
      return t;
    };

    // 1. The queue comes from the function; the overdue row's result already landed server side.
    assert.ok(fnCalls.some((c) => c.action === 'list'), 'the queue is read from the function'); checks++;
    assert.equal(store.table.get('overdue').status, 'posted', 'the list asked Post For Me and saved the result'); checks++;
    await tab('Done');
    assert.match(await row('Result came back').innerText(), /Posted/, 'the overdue row shows Posted'); checks++;
    assert.equal(await row('Result came back').locator('a[href="https://example.invalid/video/7"]').count(), 1, 'with its TikTok link'); checks++;
    assert.match(await row('Copied from the Sheet').innerText(), /Posted/, 'a row copied from the Sheet shows as history'); checks++;
    await tab('Upcoming');

    // 2. Submit a small video: mint -> PUT -> create on the function, never n8n.
    await page.evaluate((name) => {
      WL_CLIENT_NAMES.length = 0; WL_CLIENT_NAMES.push(name);
      if (typeof WL_CLIENT_CANONICAL !== 'undefined') { WL_CLIENT_CANONICAL.clear(); WL_CLIENT_CANONICAL.set(wlNormalizeClient(name), name); }
      if (typeof _tkRenderForm === 'function') _tkRenderForm();
    }, CLIENT);
    let picked = false;
    for (let i = 0; i < 4 && !picked; i++) {
      await page.fill('#tkClientInput', CLIENT.slice(0, 5));
      const offered = await page.locator('#tkClientResults [data-tk-client-pick]').first().getAttribute('data-tk-client-pick', { timeout: 5000 }).catch(() => null);
      if (offered !== CLIENT) continue;
      await page.press('#tkClientInput', 'Enter').catch(() => {});
      picked = await page.waitForFunction((n) => document.getElementById('tkClientInput')?.value === n, CLIENT, { timeout: 5000 }).then(() => true).catch(() => false);
    }
    assert.ok(picked, 'the fixture client is picked'); checks++;
    const submitVideo = async (caption) => {
      await page.setInputFiles('#tkFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) });
      await page.fill('#tkTitle', caption);
      await page.waitForFunction(() => !document.getElementById('tkSubmit').disabled, null, { timeout: 10000 });
      await page.click('#tkSubmit');
    };
    await submitVideo('Fresh from the function');
    await page.waitForFunction(() => document.getElementById('tkTitle').value === '', null, { timeout: 15000 });
    assert.equal(await notice(), 'Upload queued', 'the person is told it queued'); checks++;
    assert.deepEqual(fnCalls.filter((c) => c.action === 'mint' || c.action === 'create').map((c) => c.action), ['mint', 'create'], 'mint then create on the function'); checks++;
    assert.equal(puts.length, 1, 'the video went straight to storage once'); checks++;
    assert.equal(puts[0].type, 'video/mp4'); checks++;
    const sent = pfm.calls.find((c) => c.method === 'POST' && c.path === '/social-posts');
    assert.deepEqual([sent.body.social_accounts, sent.body.caption, sent.body.media[0].url], [[ACCOUNT], 'Fresh from the function', 'https://data.postforme.dev/fixture/media-1'], 'Post For Me got the post for the client\'s account'); checks++;
    const made = [...store.table.values()].find((r) => r.title === 'Fresh from the function');
    assert.equal(made.status, 'processing', 'the row is in the table'); checks++;
    await page.waitForFunction(() => /Fresh from the function/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });
    assert.ok(true, 'and on the page'); checks++;

    // 3. A Post For Me refusal shows its reason; Retry sends the kept request again.
    pfm.createError = 'TikTok says the caption is too long';
    await submitVideo('Refused at first');
    await page.waitForSelector('.tk-error', { timeout: 15000 });
    assert.match(await page.locator('.tk-error').innerText(), /Upload failed: TikTok says the caption is too long/, 'the refusal reason is on the form'); checks++;
    pfm.createError = '';
    await page.evaluate(() => _tkFetchQueue());
    await tab('Failed');
    await page.waitForFunction(() => /Refused at first/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });
    await row('Refused at first').locator('button:has-text("Retry")').click();
    await page.waitForFunction(() => !/Refused at first/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });
    const retried = [...store.table.values()].find((r) => r.title === 'Refused at first');
    assert.deepEqual([retried.status, !!retried.upload_post_id], ['processing', true], 'Retry posted it from the kept request'); checks++;
    await tab('Upcoming');

    // 4. Cancel: success, already posted, failure.
    const cancel = async (title) => {
      await row(title).locator('button:has-text("Cancel")').click();
      await page.waitForSelector('#confirmOverlay.active');
      await page.click('#confirmYes');
    };
    await cancel('Cancel me');
    await page.waitForFunction(() => !/Cancel me/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });
    assert.deepEqual([!!pfm.posts.sp_future, store.table.get('future').status], [false, 'cancelled'], 'gone from Post For Me, then cancelled in the table'); checks++;
    await cancel('Already went out');
    assert.equal(await notice(), 'Already posted, could not cancel', 'already posted is said plainly'); checks++;
    assert.equal(store.table.get('gone').status, 'scheduled', 'and the row does not say cancelled'); checks++;
    pfm.mode = 'refuse_delete';
    await cancel('Will not cancel');
    assert.equal(await notice(), 'Cancel failed, try again', 'a failed cancel says to try again'); checks++;
    assert.deepEqual([store.table.get('stubborn').status, !!pfm.posts.sp_stubborn], ['scheduled', true], 'and nothing changed'); checks++;
    pfm.mode = '';
    await tab('Done');
    assert.match(await row('Cancel me').innerText(), /Cancelled/, 'the cancelled row shows under Done'); checks++;

    // 5. Staff key on every call; n8n never called.
    assert.ok(fnCalls.length >= 6 && fnCalls.every((c) => c.key), 'every function call carries the staff key'); checks++;
    assert.deepEqual(n8nCalls, [], 'no n8n webhook was called'); checks++;
    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`tiktok-upload-browser: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
