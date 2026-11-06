'use strict';
// Which Facebook Page "Also post to Facebook" posts to (OPEN_REPAIRS 711, behind fb_page_pick_v1, listed staff only).
// Opens the real page offline; every backend answer is local, nothing reaches Post for Me or a real account. Proves:
//   1. switch off, or the signed-in person not listed: the card is as before and client-profile-write is never called;
//   2. one Page saved and nothing else offered: the Page's name next to the toggle, no picker, nothing to click;
//   3. a second Page offered: a picker and a "Use this Page" button; the saved Page changes only when pressed, the save
//      goes through client-profile-write's pfm_facebook_pick, and the next post carries the new Page;
//   4. no Page saved: the toggle is off and says so, the candidates are offered, and nothing is attached on its own;
//   5. an unreadable list: a plain message with Try again, and the post is still as before.
// Set FBPICK_SHOTS=<dir> to write screenshots of states 2 to 4.
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
const IG = 'spc_fixtureInstagram01';
const FB1 = 'spc_fixtureFacebook01';
const FB2 = 'spc_fixtureFacebook02';
const csv = v => '"' + String(v).replace(/"/g, '""') + '"';
const clientsCsv = saved => (saved
  ? ['client_name,postforme_instagram_account_id,postforme_facebook_account_id', `${csv(TEST_CLIENT)},${csv(IG)},${csv(saved)}`]
  : ['client_name,postforme_instagram_account_id', `${csv(TEST_CLIENT)},${csv(IG)}`]).join('\r\n') + '\r\n';
const vid = name => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('not really a video ' + name) });
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
const SHOTS = process.env.FBPICK_SHOTS || '';

// o: { flag: false | { staff: [...] }, saved: id|'' , pages: [...] , listFails }
async function open(browser, server, o) {
  const calls = { pages: 0, picks: [], creates: [] };
  const state = { saved: o.saved || '', pages: o.pages || [] };
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    const reply = (status, obj) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(obj) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? clientsCsv(state.saved) : 'col\r\n' });
    }
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url)) {
      const rows = [];
      if (/tiktok_upload_source/.test(url)) rows.push({ key: 'tiktok_upload_source', value: { source: 'supabase' } });
      if (o.flag && /fb_page_pick_v1/.test(url)) rows.push({ key: 'fb_page_pick_v1', value: o.flag });
      return reply(200, rows);
    }
    if (/functions\/v1\/tiktok-upload\b/.test(url) || /tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
    if (/functions\/v1\/client-profile-write/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'pfm_facebook_pages') {
        calls.pages++;
        if (o.listFails && calls.pages <= o.listFails) return reply(502, { ok: false, error: 'postforme_unreachable' });
        return reply(200, { ok: true, saved_id: state.saved, pages: state.pages.map(p => Object.assign({}, p, { saved: p.id === state.saved })).sort((a, b) => (b.saved ? 1 : 0) - (a.saved ? 1 : 0)), same_connection_known: true, updated_at: '2026-11-06T10:00:00Z' });
      }
      if (body.action === 'pfm_facebook_pick') { calls.picks.push(body); state.saved = body.account_id; return reply(200, { ok: true, saved_id: body.account_id }); }
      return reply(400, { ok: false });
    }
    if (/functions\/v1\/instagram-upload/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      const ok = obj => reply(200, { ok: true, ...obj });
      if (body.action === 'list') return ok({ rows: [] });
      if (body.action === 'mint') return ok({ upload_url: 'https://storage.fixture.test/put/1', media_url: 'https://data.postforme.dev/m/1' });
      if (body.action === 'create') {
        calls.creates.push(body);
        return ok({ id: body.idempotencyKey, status: 'processing', row: { id: body.idempotencyKey, client: body.clientName, title: body.title, status: 'processing', placement: 'reels', kind: 'reel', items: 1, trial: false, created_at: new Date().toISOString(), error: '', instagram_url: '', facebook: body.alsoFacebook ? { status: 'processing', url: '', error: '', posted_at: '', placement: 'reels' } : null } });
      }
      return reply(400, { ok: false });
    }
    if (/functions\/v1\/write-diagnostics/.test(url)) return reply(200, { ok: true });
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
  await pickSv(page, 'igClient', TEST_CLIENT);
  await page.waitForSelector('#igFacebookCard');
  return { page, context, calls, errors };
}
async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.locator('#igFacebookCard').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false });
  await page.locator('#igFacebookCard').screenshot({ path: path.join(SHOTS, name + '-card.png') });
}
const P1 = { id: FB1, name: 'Fixture Page One', connected: true };
const P2 = { id: FB2, name: 'Fixture Page Two', connected: true };

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  try {
    // 1a. switch off
    for (const [label, flag] of [['switch off', false], ['someone else listed', { staff: ['somebody else'] }], ['a client-only list', { clients: ['sidneylaruel'] }]]) {
      const r = await open(browser, server, { flag, saved: FB1, pages: [P1, P2] });
      await r.page.waitForTimeout(600);
      ok(await r.page.locator('#igFbPickNote').count() === 0 && await r.page.locator('#igFbPage').count() === 0, label + ': no picker, no page name');
      ok(r.calls.pages === 0, label + ': client-profile-write is never called');
      assert.match(await r.page.innerText('#igFacebookNote'), /Facebook Reel/); checks++;
      assert.deepEqual(r.errors, []); checks++;
      await r.context.close();
    }

    // 2. listed by name, one Page: its name, nothing to click
    let r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: FB1, pages: [P1] });
    await r.page.waitForSelector('#igFbPickNote strong');
    assert.match(await r.page.innerText('#igFbPickNote'), /Posts to the Facebook Page Fixture Page One\./); checks++;
    ok(await r.page.locator('#igFbPage').count() === 0 && await r.page.locator('#igFbPageUse').count() === 0, 'one Page: no picker and no button');
    ok(await r.page.isChecked('#igFacebook') && !(await r.page.isDisabled('#igFacebook')), 'one Page: the toggle is as before (ticked)');
    await shot(r.page, '1-one-page');
    await r.page.setInputFiles('#igFile', vid('one.mp4')); await r.page.fill('#igTitle', 'One page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    assert.equal(r.calls.creates[0].facebookAccountId, FB1); checks++;
    ok(r.calls.picks.length === 0, 'one Page: no save was made');
    await r.context.close();

    // 3. listed by id, two Pages: pick, save, the next post carries it
    r = await open(browser, server, { flag: { staff: ['qa_admin'] }, saved: FB1, pages: [P1, P2] });
    await r.page.waitForSelector('#igFbPageUse');
    assert.match(await r.page.innerText('#igFbPickNote'), /Posts to the Facebook Page Fixture Page One\. Another Page connected with this client's accounts is available/); checks++;
    ok(await r.page.isDisabled('#igFbPageUse'), 'the button waits for a choice');
    await shot(r.page, '2-two-pages');
    await pickSv(r.page, 'igFbPage', FB2);
    ok(!(await r.page.isDisabled('#igFbPageUse')), 'a choice enables the button');
    ok(r.calls.picks.length === 0, 'choosing alone saves nothing');
    await shot(r.page, '3-two-pages-chosen');
    await r.page.click('#igFbPageUse');
    await r.page.waitForSelector('#igFbPickMsg');
    assert.equal(r.calls.picks.length, 1); checks++;
    assert.deepEqual([r.calls.picks[0].slug, r.calls.picks[0].account_id, r.calls.picks[0].member_id], ['sidneylaruel', FB2, 'qa_admin']); checks++;
    assert.match(await r.page.innerText('#igFbPickMsg'), /Saved\. Facebook posts for this client now go to Fixture Page Two\./); checks++;
    await shot(r.page, '4-saved');
    await r.page.waitForFunction(() => /Posts to the Facebook Page/.test(document.querySelector('#igFbPickNote')?.innerText || '') || document.querySelector('#igFbPage'));
    await r.page.setInputFiles('#igFile', vid('two.mp4')); await r.page.fill('#igTitle', 'Two page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    assert.equal(r.calls.creates[0].facebookAccountId, FB2, 'the next post carries the picked Page'); checks++;
    assert.deepEqual(r.errors, []); checks++;
    await r.context.close();

    // 4. no Page saved, candidates offered: off, says so, nothing attached
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: '', pages: [P1, P2] });
    await r.page.waitForSelector('#igFbPageUse');
    ok(await r.page.isDisabled('#igFacebook') && !(await r.page.isChecked('#igFacebook')), 'none saved: the toggle is off and disabled');
    assert.match(await r.page.innerText('#igFacebookNote'), /No Facebook Page is saved for this client yet\./); checks++;
    assert.match(await r.page.innerText('#igFbPickNote'), /Nothing is attached until you pick one/); checks++;
    await shot(r.page, '5-none-saved');
    await r.page.setInputFiles('#igFile', vid('none.mp4')); await r.page.fill('#igTitle', 'No page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    ok(!('alsoFacebook' in r.calls.creates[0]) && !('facebookAccountId' in r.calls.creates[0]), 'none saved: nothing goes to Facebook');
    ok(r.calls.picks.length === 0, 'none saved: nothing was attached');
    await r.context.close();

    // 4b. none saved and none offered
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: '', pages: [] });
    await r.page.waitForSelector('#igFbPickNote');
    await r.page.waitForFunction(() => /Post for Me shows none connected/.test(document.querySelector('#igFbPickNote')?.innerText || ''));
    ok(await r.page.locator('#igFbPage').count() === 0, 'none offered: no picker');
    await shot(r.page, '6-none-offered');
    await r.context.close();

    // 5. an unreadable list
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: FB1, pages: [P1], listFails: 1 });
    await r.page.waitForSelector('#igFbPickRetry');
    assert.match(await r.page.innerText('#igFbPickNote'), /Could not read the Facebook Pages from Post for Me\./); checks++;
    ok(await r.page.isChecked('#igFacebook'), 'unreadable: the toggle still works as before');
    await r.page.click('#igFbPickRetry');
    await r.page.waitForSelector('#igFbPickNote strong');
    await r.context.close();

    console.log(`instagram-facebook-page-pick-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
