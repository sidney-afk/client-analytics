'use strict';
// TikTok Upload: the queue polls less often when nothing changes, and starts
// again at the normal pace the moment something does. Opens the real page
// offline (every backend call answered locally) with a fake clock and counts
// the requests the page makes to the list and status webhooks.
//   1. an in-flight upload is read every 30 s for the first minutes;
//   2. after many reads with no change the gap grows (60 s, then 120 s);
//   3. a changed list puts the pace back to 30 s at once;
//   4. a lost result is asked about less and less often, never more than
//      the old fixed 10 minutes.
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const H = 3600000, now = Date.now();
const real = ms => new Promise(r => setTimeout(r, ms));

async function open(browser, server, rowsRef, counts) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    if (/tiktok-uploads-list/.test(url)) { counts.list++; return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(rowsRef.rows) }); }
    if (/tiktok-upload-status/.test(url)) { counts.status++; return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, row: null, pfm: { state: 'none' } }) }); }
    if (/tiktok-upload(-direct|-cancel)?(\?|$)/.test(url)) throw new Error('the page must not post, retry or cancel: ' + url);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${server.address().port}/#tiktok-upload`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tkQueueCol', { timeout: 20000 });
  for (let i = 0; i < 200 && !counts.list; i++) await real(50);
  assert.ok(counts.list > 0, 'the first read happened');
  return { context, page };
}
async function run(page, seconds) { for (let i = 0; i < seconds / 10; i++) { await page.clock.runFor(10000); await real(15); } await real(60); }

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  try {
    // A: one upload in flight, nothing ever changes.
    const rowsA = { rows: [{ id: 'flight', client: 'Fixture client', status: 'processing', timezone: 'UTC', scheduled_for: '', created_at: new Date(now).toISOString(), upload_post_id: 'sp_a', title: 'In flight' }] };
    const cA = { list: 0, status: 0 };
    const A = await open(browser, server, rowsA, cA);
    await real(200);
    const base = cA.list;
    await run(A.page, 180);
    const first3 = cA.list - base;
    assert.ok(first3 >= 5 && first3 <= 7, 'about every 30 s at first, got ' + first3); checks++;
    await run(A.page, 600);
    const base2 = cA.list;
    await run(A.page, 600);
    const later = cA.list - base2;
    assert.ok(later <= 7, 'ten quiet minutes later, at most 7 reads (old pace: 20), got ' + later); checks++;
    assert.ok(later >= 4, 'still polling while something is in flight, got ' + later); checks++;
    // the list changes: the page goes back to 30 s
    rowsA.rows = [{ ...rowsA.rows[0], status: 'uploading' }, { id: 'new', client: 'Fixture client', status: 'queued', timezone: 'UTC', scheduled_for: '', created_at: new Date(now).toISOString(), upload_post_id: 'sp_n', title: 'New one' }];
    await run(A.page, 130);
    const base3 = cA.list;
    await run(A.page, 120);
    assert.ok(cA.list - base3 >= 3, 'after a change the pace is back to about 30 s, got ' + (cA.list - base3)); checks++;
    await A.context.close();

    // B: a lost result is asked about less and less often.
    const rowsB = { rows: [{ id: 'silent', client: 'Fixture client', status: 'processing', timezone: 'UTC', scheduled_for: '', created_at: new Date(now - 16 * 24 * H).toISOString(), upload_post_id: 'sp_b', title: 'Never heard back' }] };
    const cB = { list: 0, status: 0 };
    const B = await open(browser, server, rowsB, cB);
    await real(300);
    await run(B.page, 70 * 60);
    assert.ok(cB.status >= 3 && cB.status <= 4, 'in 70 minutes: asked 10, 20, then every 30 min (old pace: 7), got ' + cB.status); checks++;
    await B.context.close();
    console.log(`tiktok-poll-backoff-browser: ${checks} checks passed ✅`);
  } finally {
    await browser.close(); server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
