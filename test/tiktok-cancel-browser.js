'use strict';
// TikTok Upload: Cancel really stops the post. Opens the real page offline and answers the Cancel button's
// call to the tiktok-upload-cancel function with the function's OWN decision logic
// (supabase/functions/tiktok-upload-cancel/logic.mjs), run against a fake Post For Me and a fake queue Sheet.
// Three scheduled uploads, three Post For Me answers:
//   1. success        -> the post is deleted in Post For Me and only then the row says Cancelled;
//   2. already posted -> "Already posted, could not cancel", the row stays Scheduled, nothing deleted;
//   3. failure        -> "Cancel failed, try again", the row stays Scheduled.
// Also: the confirm text no longer says "you may also need to cancel it there", the call carries the staff
// key, and the old n8n cancel webhook is never called.
const assert = require('assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const H = 3600000, now = Date.now();
const at = (h) => new Date(now + h * H).toISOString();
// The queue Sheet, as the list webhook returns it.
const SHEET = [
  { id: 'tk_ok', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: at(30), upload_post_id: 'sp_ok', title: 'Goes away', error: '', updated_at: '' },
  { id: 'tk_posted', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: at(31), upload_post_id: 'sp_posted', title: 'Too late', error: '', updated_at: '' },
  { id: 'tk_broken', client: 'Fixture client', status: 'scheduled', timezone: 'UTC', scheduled_for: at(32), upload_post_id: 'sp_broken', title: 'Server trouble', error: '', updated_at: '' },
];
// Post For Me: one cancellable post, one already published, one whose delete is refused.
const PFM_POSTS = {
  sp_ok: { id: 'sp_ok', status: 'scheduled' },
  sp_posted: { id: 'sp_posted', status: 'processed' },
  sp_broken: { id: 'sp_broken', status: 'scheduled' },
};
const pfmCalls = [];
async function pfm(method, p) {
  pfmCalls.push(method + ' ' + p);
  let m;
  if (/^\/social-post-results/.test(p)) return { ok: true, status: 200, data: { data: [] } };
  if ((m = /^\/social-posts\/(.+)$/.exec(p))) {
    const id = decodeURIComponent(m[1]);
    if (method === 'GET') return PFM_POSTS[id] ? { ok: true, status: 200, data: PFM_POSTS[id] } : { ok: false, status: 404, data: {} };
    if (method === 'DELETE') {
      if (id === 'sp_broken') return { ok: false, status: 500, data: { message: 'Internal server error when deleting the Post.' } };
      if (!PFM_POSTS[id]) return { ok: false, status: 404, data: {} };
      delete PFM_POSTS[id];
      return { ok: true, status: 200, data: { success: true } };
    }
  }
  throw new Error('unexpected Post For Me call ' + method + ' ' + p);
}
const sheet = {
  async find(id) { const row = SHEET.find((r) => r.id === id); return row ? { row: { ...row }, rowNumber: 2 + SHEET.indexOf(row), header: Object.keys(row) } : null; },
  async markCancelled(found, nowIso) { const row = SHEET.find((r) => r.id === found.row.id); row.status = 'cancelled'; row.updated_at = nowIso; },
};

(async () => {
  const L = await import(pathToFileURL(path.join(__dirname, '../supabase/functions/tiktok-upload-cancel/logic.mjs')).href);
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const cancelCalls = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async (route) => {
      const req = route.request(); const url = req.url();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
      if (/\/functions\/v1\/tiktok-upload-cancel$/.test(url)) {
        const body = JSON.parse(req.postData() || '{}');
        cancelCalls.push({ id: body.id, key: req.headers()['x-syncview-key'] || '' });
        const out = await L.cancelTiktokUpload({ id: body.id, pfm, sheet, nowIso: new Date().toISOString() });
        return route.fulfill({ status: out.status, contentType: 'application/json', headers: cors, body: JSON.stringify(out.body) });
      }
      if (/webhook\/tiktok-upload-cancel/.test(url)) throw new Error('the old n8n cancel webhook must not be called');
      if (/tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(SHEET) });
      if (/tiktok-upload-status/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, pfm: null }) });
      if (/tiktok-upload(-direct)?(\?|$)/.test(url)) throw new Error('the page must not post: ' + url);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
    });
    await seedStaffIdentity(context, ADMIN);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('#tkQueueCol .tk-queue-item button.tk-q-danger').length === 3, null, { timeout: 20000 });

    const row = (title) => page.locator('#tkQueueCol .tk-queue-item', { hasText: title });
    const cancel = async (title) => {
      await row(title).locator('button:has-text("Cancel")').click();
      await page.waitForSelector('#confirmOverlay.active');
      const msg = await page.locator('#confirmMsg').innerText();
      assert.doesNotMatch(msg, /may also need to cancel it there/, 'the old "cancel it there too" wording is gone'); checks++;
      assert.match(msg, /stops the post in Post For Me/, 'the confirm says it stops the post'); checks++;
      await page.click('#confirmYes');
    };
    const notice = async () => {
      await page.waitForSelector('#confirmOverlay.active', { timeout: 10000 });
      const t = await page.locator('#confirmTitle').innerText();
      await page.click('#confirmYes');
      await page.waitForFunction(() => !document.querySelector('#confirmOverlay.active'));
      return t;
    };

    // 1. Success.
    await cancel('Goes away');
    await page.waitForFunction(() => !/Goes away/.test(document.querySelector('#tkQueueCol')?.innerText || ''), null, { timeout: 10000 });
    assert.ok(!PFM_POSTS.sp_ok, 'the post was deleted in Post For Me'); checks++;
    assert.ok(pfmCalls.indexOf('DELETE /social-posts/sp_ok') < pfmCalls.lastIndexOf('GET /social-posts/sp_ok'), 'and read back to prove it is gone'); checks++;
    assert.equal(SHEET[0].status, 'cancelled', 'only then the queue row says cancelled'); checks++;
    await page.click('.tk-q-tab:has-text("Done")');
    assert.match(await row('Goes away').innerText(), /Cancelled/, 'the row shows Cancelled under Done'); checks++;
    await page.click('.tk-q-tab:has-text("Upcoming")');

    // 2. Already posted.
    await cancel('Too late');
    assert.equal(await notice(), 'Already posted, could not cancel', 'the person is told it already went out'); checks++;
    assert.ok(!pfmCalls.some((c) => c === 'DELETE /social-posts/sp_posted'), 'nothing was deleted'); checks++;
    assert.equal(SHEET[1].status, 'scheduled', 'the row does not say cancelled'); checks++;
    assert.match(await row('Too late').innerText(), /Scheduled/, 'the page still shows it Scheduled'); checks++;

    // 3. Failure.
    await cancel('Server trouble');
    assert.equal(await notice(), 'Cancel failed, try again', 'the person is told to try again'); checks++;
    assert.ok(PFM_POSTS.sp_broken, 'the post is still in Post For Me'); checks++;
    assert.equal(SHEET[2].status, 'scheduled', 'the row does not say cancelled'); checks++;
    assert.match(await row('Server trouble').innerText(), /Scheduled/, 'the page still shows it Scheduled'); checks++;

    assert.deepEqual(cancelCalls.map((c) => c.id), ['tk_ok', 'tk_posted', 'tk_broken'], 'one function call per Cancel'); checks++;
    assert.ok(cancelCalls.every((c) => c.key), 'every call carries the staff key'); checks++;
    assert.deepEqual(errors, [], 'no page errors'); checks++;
    await context.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`tiktok-cancel-browser: ${checks} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
