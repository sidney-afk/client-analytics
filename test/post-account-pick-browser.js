'use strict';
// Which account each network on the Post tab posts to (OPEN_REPAIRS 712, behind post_account_pick_v1, listed staff
// only). Opens the real page offline; every backend answer is local, nothing reaches Post for Me or a real account.
// Proves, for Instagram, TikTok, Facebook, YouTube (channel name) and LinkedIn:
//   1. switch off, or the signed-in person not listed: every line as before (the id chip), client-profile-write never called;
//   2. one account, nothing else offered: its name beside the toggle, no picker, nothing to click;
//   3. a second account that belongs to the client: a picker listing every one; choosing one saves it as the client's
//      default (pfm_account_pick) and the post carries it; with one account there is no picker;
//   4. none saved: the Facebook toggle is off and says so, offered accounts are listed, nothing is attached on its own;
//   5. an unreadable list: a plain message with Try again, and posting is as before.
// Set POSTPICK_SHOTS=<dir> to write screenshots.
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
const IDS = { tiktok: 'spc_fixtureTikTok0001', instagram: 'spc_fixtureInstagram01', facebook: 'spc_fixtureFacebook01', youtube: 'spc_fixtureYouTube0001', linkedin: 'spc_fixtureLinkedIn001' };
const ALT = { tiktok: 'spc_fixtureTikTok0002', instagram: 'spc_fixtureInstagram02', facebook: 'spc_fixtureFacebook02', youtube: 'spc_fixtureYouTube0002', linkedin: 'spc_fixtureLinkedIn002' };
const LABEL = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', linkedin: 'LinkedIn' };
const csv = v => '"' + String(v).replace(/"/g, '""') + '"';
const clientsCsv = saved => ['client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id,postforme_youtube_account_id,postforme_linkedin_account_id',
  [TEST_CLIENT, saved.tiktok || '', saved.instagram || '', saved.facebook || '', saved.youtube || '', saved.linkedin || ''].map(csv).join(',')].join('\r\n') + '\r\n';
const vid = name => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('not really a video ' + name) });
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
const SHOTS = process.env.POSTPICK_SHOTS || '';
// o: { flag, saved: { net: id }, lists: { net: [{id,name,handle?,connected?}] }, listFails }
async function open(browser, server, o) {
  const calls = { lists: [], picks: [], creates: [] };
  const state = { saved: Object.assign({}, o.saved) };
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
      if (/post_networks_v1/.test(url)) rows.push({ key: 'post_networks_v1', value: { clients: ['sidneylaruel'] } });
      if (o.flag && /post_account_pick_v1/.test(url)) rows.push({ key: 'post_account_pick_v1', value: o.flag });
      return reply(200, rows);
    }
    if (/functions\/v1\/tiktok-upload\b/.test(url) || /tiktok-uploads-list/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '[]' });
    if (/functions\/v1\/client-profile-write/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'pfm_account_choices') {
        calls.lists.push(body.network);
        if (o.listFails && calls.lists.length <= o.listFails) return reply(502, { ok: false, error: 'postforme_unreachable' });
        const sv = state.saved[body.network] || '';
        const accounts = ((o.lists || {})[body.network] || []).map(p => Object.assign({ connected: true, handle: '' }, p, { saved: p.id === sv }))
          .sort((x, y) => (y.saved ? 1 : 0) - (x.saved ? 1 : 0));
        return reply(200, { ok: true, saved_id: sv, accounts, updated_at: '2026-11-06T10:00:00Z' });
      }
      if (body.action === 'pfm_account_pick') { calls.picks.push(body); state.saved[body.network] = body.account_id; return reply(200, { ok: true, saved_id: body.account_id }); }
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
  await page.waitForSelector('#tkPlatTiktok', { timeout: 20000 });
  return { page, context, calls, errors };
}
async function side(page, net) {
  await page.click('#tkPlat' + { tiktok: 'Tiktok', instagram: 'Instagram', youtube: 'Youtube', linkedin: 'Linkedin' }[net]);
  await page.waitForSelector(net === 'tiktok' ? '#tkClientInput' : '#igClientBtn');
}
async function client(page, net) {
  if (net === 'tiktok') { await page.fill('#tkClientInput', TEST_CLIENT); await page.press('#tkClientInput', 'Enter'); }
  else await pickSv(page, 'igClient', TEST_CLIENT);
}
const lineOf = (page, net) => page.locator(net === 'tiktok' ? '#tkFormCol .tk-profile-line' : '#igFormCol .tk-profile-line').first().innerText();
async function shot(page, name, sel, below) {
  if (!SHOTS) return;
  for (let i = 0; i < 4; i++) { try { await shotOnce(page, name, sel, below); return; } catch (e) { if (i === 3) throw e; await page.waitForTimeout(400); } }
}
async function shotOnce(page, name, sel, below) {
  if (process.env.POSTPICK_TRACE) console.log('shot', name);
  fs.mkdirSync(SHOTS, { recursive: true });
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const a = await el.boundingBox();
  let h = a.height;
  // below: also take in the picker lines that follow, down to the end of the last of them (or the next card).
  if (below) { const z = await page.locator(below).last().boundingBox(); if (z) h = Math.max(h, z.y + z.height - a.y); }
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), clip: { x: Math.max(0, a.x - 12), y: Math.max(0, a.y - 12), width: Math.min(a.width + 24, 1240), height: h + 24 } });
}
const L = (net, id, name, extra) => Object.assign({ id, name }, extra || {});

(async () => {
  const server = await serveStatic();
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };
  const NAMES = { tiktok: 'Fixture TikTok', instagram: 'Fixture Instagram', facebook: 'Fixture Page One', youtube: 'Fixture Channel', linkedin: 'Fixture LinkedIn' };
  const oneEach = () => { const l = {}; for (const n of Object.keys(IDS)) l[n] = [L(n, IDS[n], NAMES[n], n === 'youtube' || n === 'instagram' ? { handle: 'fixture_handle' } : {})]; return l; };
  try {
    // 1. off: switch missing, someone else listed, a client list (wrong shape)
    for (const [label, flag] of [['switch off', false], ['someone else listed', { staff: ['somebody else'] }], ['a client-only list', { clients: ['sidneylaruel'] }]]) {
      const r = await open(browser, server, { flag, saved: IDS, lists: oneEach() });
      for (const net of ['tiktok', 'instagram', 'youtube', 'linkedin']) {
        await side(r.page, net); await client(r.page, net);
        await r.page.waitForTimeout(250);
        assert.match(await lineOf(r.page, net), /Posts to Post For Me account\s+spc_fixture/, label + ': ' + net + ' shows the id chip as before'); checks++;
      }
      ok(r.calls.lists.length === 0, label + ': client-profile-write is never called');
      assert.deepEqual(r.errors, []); checks++;
      await r.context.close();
    }

    // 2. listed: every network names its account; nothing to click
    let r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: IDS, lists: oneEach() });
    await side(r.page, 'tiktok'); await client(r.page, 'tiktok');
    await r.page.waitForFunction(() => /Posts to TikTok account/.test(document.querySelector('#tkFormCol .tk-profile-line')?.innerText || ''));
    assert.match(await lineOf(r.page, 'tiktok'), /Posts to TikTok account\s+Fixture TikTok/); checks++;
    ok(await r.page.locator('#tkAcctPage').count() === 0 && await r.page.locator('#tkAcctPageBtn').count() === 0, 'tiktok: one account, no picker');
    await shot(r.page, '1-tiktok-name', '#tkFormCol .tk-profile-line');
    await side(r.page, 'instagram'); await client(r.page, 'instagram');
    await r.page.waitForFunction(() => /Posts to Instagram account/.test(document.querySelector('#igFormCol .tk-profile-line')?.innerText || ''));
    assert.match(await lineOf(r.page, 'instagram'), /Posts to Instagram account\s+Fixture Instagram · @fixture_handle/); checks++;
    await r.page.waitForSelector('#igFbPickNote');
    assert.match(await r.page.innerText('#igFbPickNote'), /Posts to Facebook Page\s+Fixture Page One/); checks++;
    ok(await r.page.isChecked('#igFacebook') && !(await r.page.isDisabled('#igFacebook')), 'facebook: the toggle is as before (ticked)');
    await shot(r.page, '2-instagram-and-facebook-names', '#igFormCol');
    await r.page.setInputFiles('#igFile', vid('one.mp4')); await r.page.fill('#igTitle', 'One page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    assert.equal(r.calls.creates[0].facebookAccountId, IDS.facebook); checks++;
    await side(r.page, 'youtube'); await client(r.page, 'youtube');
    await r.page.waitForFunction(() => /Posts to YouTube channel/.test(document.querySelector('#igFormCol .tk-profile-line')?.innerText || ''));
    assert.match(await lineOf(r.page, 'youtube'), /Posts to YouTube channel\s+Fixture Channel · @fixture_handle/); checks++;
    await shot(r.page, '3-youtube-channel-name', '#igFormCol .tk-profile-line');
    await side(r.page, 'linkedin'); await client(r.page, 'linkedin');
    await r.page.waitForFunction(() => /Posts to LinkedIn account/.test(document.querySelector('#igFormCol .tk-profile-line')?.innerText || ''));
    assert.match(await lineOf(r.page, 'linkedin'), /Posts to LinkedIn account\s+Fixture LinkedIn/); checks++;
    ok(r.calls.picks.length === 0, 'one account each: no save was made');
    assert.deepEqual(r.errors, []); checks++;
    await r.context.close();

    // 3. two YouTube channels (one Google login, several channels) and two TikTok accounts: pick, save, post carries it
    const two = oneEach();
    two.youtube = [L('youtube', IDS.youtube, 'Fixture Channel', { handle: 'fixture_handle' }), L('youtube', ALT.youtube, 'Fixture Channel Español')];
    two.linkedin = [L('linkedin', IDS.linkedin, 'Fixture Person'), L('linkedin', ALT.linkedin, 'Fixture Company Ltd')];
    two.tiktok = [L('tiktok', IDS.tiktok, 'Fixture TikTok'), L('tiktok', ALT.tiktok, 'Fixture TikTok Two')];
    r = await open(browser, server, { flag: { staff: ['qa_admin'] }, saved: IDS, lists: two });
    await side(r.page, 'youtube'); await client(r.page, 'youtube');
    await r.page.waitForSelector('#igAcctPageBtn');
    assert.match(await r.page.innerText('#igAcctNote'), /More than one YouTube channel belongs to this client/); checks++;
    ok(r.calls.picks.length === 0, 'opening the picker saves nothing');
    await shot(r.page, '4-youtube-two-channels', '#igFormCol .tk-profile-line:visible', '#igAcctPageBtn');
    await pickSv(r.page, 'igAcctPage', ALT.youtube);
    await r.page.waitForSelector('#igAcctMsg');
    assert.deepEqual([r.calls.picks[0].network, r.calls.picks[0].slug, r.calls.picks[0].account_id, r.calls.picks[0].member_id], ['youtube', 'sidneylaruel', ALT.youtube, 'qa_admin']); checks++;
    assert.match(await r.page.innerText('#igAcctMsg'), /Saved\. YouTube posts for this client now go to Fixture Channel Español\./); checks++;
    await r.page.waitForFunction(() => /Posts to YouTube channel\s+Fixture Channel Español/.test(document.querySelector('#igFormCol .tk-profile-line')?.innerText || ''));
    await shot(r.page, '5-youtube-saved', '#igFormCol .tk-profile-line', '#igAcctMsg');
    await side(r.page, 'tiktok'); await client(r.page, 'tiktok');
    await r.page.waitForSelector('#tkAcctPageBtn');
    await pickSv(r.page, 'tkAcctPage', ALT.tiktok); await r.page.click('#tkAcctPageBtn');
    await r.page.waitForSelector('#tkAcctMsg');
    assert.deepEqual([r.calls.picks[1].network, r.calls.picks[1].account_id], ['tiktok', ALT.tiktok]); checks++;
    await shot(r.page, '6-tiktok-saved', '#tkFormCol .tk-profile-line', '#tkAcctMsg');
    await side(r.page, 'linkedin'); await client(r.page, 'linkedin');
    await r.page.waitForSelector('#igAcctPageBtn');
    await shot(r.page, '6b-linkedin-person-or-company', '#igFormCol .tk-profile-line:visible', '#igAcctPageBtn');
    await pickSv(r.page, 'igAcctPage', ALT.linkedin); await r.page.waitForSelector('#igAcctMsg');
    assert.deepEqual([r.calls.picks[2].network, r.calls.picks[2].account_id], ['linkedin', ALT.linkedin]); checks++;
    assert.match(await r.page.innerText('#igAcctMsg'), /LinkedIn posts for this client now go to Fixture Company Ltd/); checks++;
    assert.deepEqual(r.errors, []); checks++;
    await r.context.close();

    // 4. Facebook: a second Page offered; the post carries the picked Page after the button only
    const fb2 = oneEach(); fb2.facebook = [L('facebook', IDS.facebook, 'Fixture Page One'), L('facebook', ALT.facebook, 'Fixture Page Two')];
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: IDS, lists: fb2 });
    await side(r.page, 'instagram'); await client(r.page, 'instagram');
    await r.page.waitForSelector('#igFbPageBtn');
    await pickSv(r.page, 'igFbPage', ALT.facebook);
    await shot(r.page, '7-facebook-two-pages', '#igFacebookCard');
    await r.page.waitForSelector('#igFbMsg');
    await r.page.setInputFiles('#igFile', vid('two.mp4')); await r.page.fill('#igTitle', 'Two page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    assert.equal(r.calls.creates[0].facebookAccountId, ALT.facebook, 'the next post carries the picked Page'); checks++;
    await r.context.close();

    // 5. Facebook none saved, a Page offered: toggle off, nothing attached; none offered: says connect it
    const fb3 = oneEach(); fb3.facebook = [L('facebook', IDS.facebook, 'Fixture Page One')];
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: Object.assign({}, IDS, { facebook: '' }), lists: fb3 });
    await side(r.page, 'instagram'); await client(r.page, 'instagram');
    await r.page.waitForSelector('#igFbPageBtn');
    ok(await r.page.isDisabled('#igFacebook') && !(await r.page.isChecked('#igFacebook')), 'none saved: the toggle is off');
    assert.match(await r.page.innerText('#igFacebookNote'), /No Facebook Page is saved for this client yet\./); checks++;
    assert.match(await r.page.innerText('#igFbNote'), /Nothing is attached until you pick one/); checks++;
    await shot(r.page, '8-facebook-none-saved', '#igFacebookCard');
    await r.page.setInputFiles('#igFile', vid('none.mp4')); await r.page.fill('#igTitle', 'No page caption'); await r.page.click('#igSubmit');
    await r.page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol')?.innerText || '') && !igState.submitting, null, { timeout: 15000 });
    ok(!('alsoFacebook' in r.calls.creates[0]) && r.calls.picks.length === 0, 'none saved: nothing goes to Facebook and nothing was attached');
    await r.context.close();
    const none = oneEach(); none.facebook = [];
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: Object.assign({}, IDS, { facebook: '' }), lists: none });
    await side(r.page, 'instagram'); await client(r.page, 'instagram');
    await r.page.waitForFunction(() => /Open Post for Me/.test(document.querySelector('#igFacebookNote')?.innerText || ''));
    ok(await r.page.locator('#igFbPage').count() === 0, 'none offered: no picker');
    await shot(r.page, '9-facebook-none-offered', '#igFacebookCard');
    await r.context.close();

    // 6. an unreadable list
    r = await open(browser, server, { flag: { staff: ['QA Admin'] }, saved: IDS, lists: oneEach(), listFails: 1 });
    await side(r.page, 'tiktok'); await client(r.page, 'tiktok');
    await r.page.waitForSelector('#tkAcctRetry');
    assert.match(await r.page.innerText('#tkAcctNote'), /Could not read the accounts from Post for Me\./); checks++;
    assert.match(await lineOf(r.page, 'tiktok'), /Posts to Post For Me account\s+spc_fixture/); checks++;
    await r.page.click('#tkAcctRetry');
    await r.page.waitForFunction(() => /Posts to TikTok account/.test(document.querySelector('#tkFormCol .tk-profile-line')?.innerText || ''));
    await r.context.close();

    console.log(`post-account-pick-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
