'use strict';
// Posting a trial card's versions on the Post tab's Instagram side (plan row P4, decision D3, OPEN_REPAIRS 684),
// behind post_sources_v1 ("From a card"). Opens the real page offline with every backend answer local and proves:
//   1. a trial card picked "From a card" with Trial reel on lists its APPROVED versions only (a version waiting on a
//      change is left out), each ticked, with its own caption; the cover card is hidden and the caption box says it is
//      only a fallback; Facebook cannot be ticked; the button says how many trial reels go;
//   2. one press makes one Instagram trial reel per ticked version: the version on the card is copied as the card
//      (no letter), every other one by its letter; each post carries its own copied video, its own copied thumbnail
//      as the cover, its own caption, trial_reel_type manual, and its own key (the press key plus the letter); nothing
//      else is asked (no Facebook, no YouTube, no LinkedIn, no second post afterwards);
//   3. an unticked version is not posted;
//   4. after one version's post fails with an answer lost, a press again sends ONLY that version, under the same key,
//      and the ones that went are not sent again;
//   5. a version with no caption, and an empty caption box, keeps Post off until a caption is written;
//   6. a card that is not on trial posts as one Reel, as before; Trial reel off posts the card as before;
//   7. at 390 wide the version rows fit with no sideways scroll.
// Nothing is ever posted for real: every function is answered here.
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
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')},${csv('spc_fixtureFacebook001')}`].join('\r\n') + '\r\n';
const iso = (days) => { const d = new Date(Date.now() + days * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const approved = { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' };
const POSTS = [
  Object.assign({ id: 'p_trial', name: 'Video 16', scheduled_date: iso(3), order_index: 1, asset_url: 'https://f.io/b', caption: 'Card caption' }, approved),
  Object.assign({ id: 'p_plain', name: 'Video 17', scheduled_date: iso(4), order_index: 2, asset_url: 'https://f.io/plain', caption: 'Plain caption' }, approved),
];
const v = (letter, status, extra) => Object.assign({ id: 'v_' + letter, letter, status, revision: 1, on_card: false, frame_url: 'https://f.io/' + letter.toLowerCase(), effective: { thumbnail_url: 'https://img.example.test/' + letter + '.jpg', caption: 'Caption ' + letter } }, extra || {});
// The SMM put version B on the card, so A is posted by its letter and B as the card.
const TRIAL = { enabled: true, versions: [v('A', 'approved'), v('B', 'approved', { on_card: true }), v('C', 'change asked'), v('D', 'approved')] };

async function newPage(browser, opts) {
  const o = Object.assign({ viewport: { width: 1440, height: 1000 }, cards: { p_trial: TRIAL }, failCreate: {} }, opts || {});
  const context = await browser.newContext({ viewport: o.viewport });
  const log = { copies: [], creates: [], lists: 0 };
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
    }
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url)) {
      const rows = [];
      if (/post_sources_v1/.test(url)) rows.push({ key: 'post_sources_v1', value: { clients: ['sidneylaruel'] } });
      if (/trial_reels_pages/.test(url)) rows.push({ key: 'trial_reels_pages', value: { all: true } });
      return reply(200, rows);
    }
    if (/functions\/v1\/trial-reels\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'list') { log.lists++; return reply(200, { ok: true, cards: o.cards }); }
      if (body.action === 'list_many') return reply(200, { ok: true, clients: { sidneylaruel: { cards: o.cards } } });
      return reply(200, { ok: true, cards: {} });
    }
    if (/functions\/v1\/post-source\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      log.copies.push(body);
      const tag = body.letter || 'card';
      return reply(200, { ok: true, media_url: 'https://data.postforme.dev/v/' + tag, thumb_url: 'https://data.postforme.dev/t/' + tag, file_name: tag + '.mp4', bytes: 1000, width: 1080, height: 1920, duration_seconds: 30 });
    }
    if (/functions\/v1\/frameio-view\b/.test(url)) return reply(200, { ok: true, video: { url: 'https://frame.example.test/s.mp4', renditions: {} } });
    if (/functions\/v1\/instagram-upload\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'create') {
        log.creates.push(body);
        const letter = String(body.idempotencyKey || '').split('_').pop();
        if (o.failCreate[letter] > 0) { o.failCreate[letter]--; return reply(502, { ok: false, error: 'upstream' }); }
        return reply(200, { ok: true, row: { id: 'row_' + log.creates.length, status: 'scheduled', client: body.clientName, title: body.title, kind: 'reel', trial: true, network: 'instagram', created_at: new Date().toISOString() } });
      }
      return reply(200, { ok: true, rows: [] });
    }
    if (/functions\/v1\//.test(url)) return reply(200, { ok: true, rows: [] });
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) || /tiktok-uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, log, errors };
}
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
async function openCard(page, base, cardId) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  await page.evaluate(({ client, posts }) => { calState.client = client; calState.posts = posts; }, { client: TEST_CLIENT, posts: POSTS });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
  await page.click('#tkPlatInstagram');
  await page.waitForSelector('#igFormCol:not([hidden])');
  if (!(await page.locator('#igFormCol .tk-profile-line').count())) await pickSv(page, 'igClient', TEST_CLIENT);
  await page.waitForSelector('input[name="igSrcMode"]');
  await page.click('label:has(input[name="igSrcMode"][value="card"])');
  await page.waitForSelector('#igSrcCardBtn');
  await pickSv(page, 'igSrcCard', cardId);
  await page.waitForSelector('#igSrcReady');
}
const trialOn = (page) => page.click('label:has(#igTrial)');
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const notice = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#igFormCol .tk-submit-bar')?.textContent || ''), re.source);

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    // ---- 1, 2, 3 and 4
    {
      const { context, page, log, errors } = await newPage(browser, { failCreate: { D: 1 } });
      await openCard(page, base, 'p_trial');
      ok(await page.locator('#igCoverCard, #igCoverDrop, #igCoverRemote').count() >= 1, 'before Trial reel: the cover card is there');
      await trialOn(page);
      await page.waitForSelector('#igTrialVersions [data-ig-trv-row]');
      assert.deepEqual(await page.$$eval('[data-ig-trv-row]', els => els.map(e => e.getAttribute('data-ig-trv-row'))), ['A', 'B', 'D']); checks++;
      ok(await page.$$eval('[data-ig-trv]', els => els.every(e => e.checked)), 'every approved version starts ticked');
      ok(/Caption B/.test(await textOf(page, '[data-ig-trv-row="B"]')), 'each row shows its own caption');
      ok(await page.locator('#igCoverRemote, #igCoverDrop').count() === 0, 'the cover card is hidden: each version has its own thumbnail');
      ok(await page.locator('#igTrialCapNote').count() === 1, 'the caption box says it is only a fallback');
      ok(await page.isDisabled('#igFacebook'), 'Facebook cannot be ticked');
      assert.equal(await textOf(page, '#igSubmit'), 'Post 3 trial reels'); checks++;
      // Untick A, then tick it again.
      await page.click('[data-ig-trv-row="A"]');
      await page.waitForFunction(() => /Post 2 trial reels/.test(document.getElementById('igSubmit').textContent));
      ok(true, 'unticking a version: Post 2 trial reels');
      await page.click('[data-ig-trv-row="A"]');
      await page.waitForFunction(() => /Post 3 trial reels/.test(document.getElementById('igSubmit').textContent));
      const copiesBefore = log.copies.length;
      await page.click('#igSubmit');
      await notice(page, /2 of 3 went\. Press again to send the rest/);
      const firstCopies = log.copies.slice(copiesBefore);
      assert.deepEqual(firstCopies, [
        { client: TEST_CLIENT, post_id: 'p_trial', side: 'instagram', letter: 'A' },
        { client: TEST_CLIENT, post_id: 'p_trial', side: 'instagram' },
        { client: TEST_CLIENT, post_id: 'p_trial', side: 'instagram', letter: 'D' },
      ]); checks++;
      const [a, b, d] = log.creates;
      const base0 = a.idempotencyKey.slice(0, -2);
      ok(a.idempotencyKey === base0 + '_A' && b.idempotencyKey === base0 + '_B' && d.idempotencyKey === base0 + '_D', 'one press key, one key per version');
      ok(a.mediaUrl.endsWith('/v/A') && b.mediaUrl.endsWith('/v/card') && d.mediaUrl.endsWith('/v/D'), 'each post carries its own copied video');
      ok(a.coverUrl.endsWith('/t/A') && b.coverUrl.endsWith('/t/card'), 'each post carries its own copied thumbnail as the cover');
      ok(a.title === 'Caption A' && b.title === 'Caption B' && d.title === 'Caption D', 'each post carries its own caption');
      ok(log.creates.every(c => c.options && c.options.trial_reel_type === 'manual'), 'each is a trial reel');
      ok(log.creates.every(c => !c.alsoFacebook && !c.youtube && !c.linkedin && !('instagram' in c)), 'Instagram only: nothing for Facebook, YouTube or LinkedIn');
      ok(/Failed/.test(await textOf(page, '[data-ig-trv-row="D"]')), 'the version whose answer was lost says Failed');
      ok(/Sent/.test(await textOf(page, '[data-ig-trv-row="A"]')), 'a version that went says Sent');
      // A press again sends only D, under the same key.
      await page.click('#igSubmit');
      await notice(page, /Sent 3 trial reels/);
      const again = log.copies.slice(copiesBefore + 3);
      assert.deepEqual(again, [{ client: TEST_CLIENT, post_id: 'p_trial', side: 'instagram', letter: 'D' }]); checks++;
      assert.equal(log.creates.length, 4); checks++;
      assert.equal(log.creates[3].idempotencyKey, base0 + '_D'); checks++;
      ok(await page.locator('#igTrialVersions').count() === 0, 'after the press the card and its versions are cleared');
      ok(!errors.length, 'trial versions: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 3b. an unticked version is not posted
    {
      const { context, page, log, errors } = await newPage(browser);
      await openCard(page, base, 'p_trial');
      await trialOn(page);
      await page.waitForSelector('[data-ig-trv-row="D"]');
      await page.click('[data-ig-trv-row="D"]');
      await page.waitForFunction(() => /Post 2 trial reels/.test(document.getElementById('igSubmit').textContent));
      await page.click('#igSubmit');
      await notice(page, /Sent 2 trial reels/);
      assert.deepEqual(log.creates.map(c => c.idempotencyKey.slice(-1)), ['A', 'B']); checks++;
      ok(!errors.length, 'unticked: no page errors');
      await context.close();
    }
    // ---- 5. no caption anywhere keeps Post off
    {
      const bare = { enabled: true, versions: [v('A', 'approved', { on_card: true }), v('B', 'approved', { effective: { thumbnail_url: null, caption: null } })] };
      const { context, page, errors } = await newPage(browser, { cards: { p_trial: bare } });
      await openCard(page, base, 'p_trial');
      await page.fill('#igTitle', '');
      await trialOn(page);
      await page.waitForSelector('[data-ig-trv-row="B"]');
      ok(await page.isDisabled('#igSubmit'), 'a version with no caption and an empty box keeps Post off');
      ok(/No caption/.test(await textOf(page, '[data-ig-trv-row="B"]')), 'the row says it has no caption');
      await page.fill('#igTitle', 'Fallback caption');
      await page.click('[data-ig-trv-row="B"]'); await page.click('[data-ig-trv-row="B"]');
      await page.waitForFunction(() => !document.getElementById('igSubmit').disabled);
      ok(true, 'a caption in the box lets the bare version go');
      ok(!errors.length, 'no caption: no page errors');
      await context.close();
    }
    // ---- 6. not a trial card, and Trial reel off: one post, as before
    {
      const { context, page, log, errors } = await newPage(browser);
      await openCard(page, base, 'p_plain');
      await trialOn(page);
      await page.waitForTimeout(400);
      ok(await page.locator('[data-ig-trv-row]').count() === 0, 'a card with no versions: no version rows');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to Instagram'); checks++;
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram/.test(document.querySelector('#igFormCol .tk-submit-bar')?.textContent || ''));
      ok(log.creates.length === 1 && log.creates[0].options.trial_reel_type === 'manual' && !/_[A-G]$/.test(log.creates[0].idempotencyKey), 'one trial reel of the card, as before');
      ok(!errors.length, 'plain card: no page errors');
      await context.close();
    }
    {
      const { context, page, log, errors } = await newPage(browser);
      await openCard(page, base, 'p_trial');
      ok(await page.locator('[data-ig-trv-row]').count() === 0, 'Trial reel off: no version rows');
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram and Facebook/.test(document.querySelector('#igFormCol .tk-submit-bar')?.textContent || ''));
      ok(log.creates.length === 1 && !log.creates[0].options.trial_reel_type, 'Trial reel off: the card posts as an ordinary Reel');
      ok(!errors.length, 'trial off: no page errors');
      await context.close();
    }
    // ---- 7. 390 wide
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openCard(page, base, 'p_trial');
      await trialOn(page);
      await page.waitForSelector('[data-ig-trv-row="D"]');
      ok(await noSideScroll(page), '390: the version rows fit with no sideways scroll');
      ok(!errors.length, '390: no page errors');
      await context.close();
    }
    console.log(`post-trial-versions-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
