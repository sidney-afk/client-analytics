'use strict';
// YouTube and LinkedIn as their own sides of the Post tab (OPEN_REPAIRS 687, the owner on 3 Nov; plan row P3 page half
// first built as ticks, OPEN_REPAIRS 655), behind post_networks_v1. Opens the real page offline with every backend
// answer local and proves:
//   1. switch on: the platform switch has YouTube and LinkedIn; the Instagram side has no Instagram tick, only
//      "Also post to Facebook", on by default with a connected Page and hidden with none;
//   2. the YouTube side: its account, its own card (title from the caption's first line, following it until typed
//      into; Short by default; Public; made for kids from the profile), no carousel, no trial, no Facebook; the post
//      sends instagram:false, no Instagram account, and YouTube's profile id, title and format through the same create;
//   3. a landscape card cannot go as a Short; Regular video can;
//   4. the LinkedIn side: no cover; the post sends instagram:false and LinkedIn's profile id;
//   5. no YouTube or LinkedIn account: each side says so with Open Post for Me, and Post stays off;
//   6. each side's queue lists its own network's posts, under its own heading;
//   7. switch off: no YouTube or LinkedIn button, the Facebook card as before (also with no Page), today's body;
//   8. at 390 wide the switch and the YouTube side fit with no sideways scroll.
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
const IDS = { tiktok: 'spc_fixtureTikTok0001', instagram: 'spc_fixtureInstagram01', facebook: 'spc_fixtureFacebook001', youtube: 'spc_fixtureYouTube0001', linkedin: 'spc_fixtureLinkedIn001' };
const clientsCsv = (ids, kids) => ['client_name,postforme_account_id,postforme_instagram_account_id,postforme_facebook_account_id,postforme_youtube_account_id,postforme_linkedin_account_id,youtube_made_for_kids',
  [TEST_CLIENT, ids.tiktok, ids.instagram || '', ids.facebook || '', ids.youtube || '', ids.linkedin || '', kids ? 'true' : ''].map(csv).join(',')].join('\r\n') + '\r\n';
const iso = (days) => { const d = new Date(Date.now() + days * 86400000); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const POSTS = [Object.assign({ id: 'p_card_a', name: 'Video 15', scheduled_date: iso(3), order_index: 1, asset_url: 'https://f.io/cardA', caption: 'Card caption line\nmore' },
  { video_status: 'Approved', graphic_status: 'Approved', caption_status: 'Approved' })];
const QUEUE = [
  { id: 'row_multi', client: 'Fixture', title: 'Three networks', status: 'scheduled', scheduled_for: new Date(Date.now() + 5 * 86400000).toISOString(), timezone: 'America/New_York', instagram_url: '', error: '', kind: 'reel', items: 1, trial: false,
    facebook: null, network: 'instagram', networks: { youtube: { status: 'scheduled', url: '', error: '' }, linkedin: { status: 'failed', url: '', error: 'LinkedIn refused it' } }, youtube: { title: 'Three', format: 'short', made_for_kids: false } },
  { id: 'row_yt', client: 'Fixture', title: 'YouTube only', status: 'posted', posted_at: new Date(Date.now() - 86400000).toISOString(), instagram_url: 'https://youtube.com/shorts/x', error: '', kind: 'reel', items: 1, trial: false,
    facebook: null, network: 'youtube', networks: null, youtube: { title: 'YouTube only', format: 'short', made_for_kids: false } },
];

async function newPage(browser, opts) {
  const o = Object.assign({ flag: true, sources: false, ids: IDS, kids: false, viewport: { width: 1440, height: 1000 }, card: { width: 1080, height: 1920, duration_seconds: 57.28 } }, opts || {});
  const context = await browser.newContext({ viewport: o.viewport });
  const log = { creates: [], puts: [] };
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    const reply = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return reply(200, { ok: true, role: 'admin', member: ADMIN });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? clientsCsv(o.ids, o.kids) : 'col\r\n' });
    }
    if (/\/rest\/v1\/syncview_runtime_flags/.test(url)) {
      const rows = [];
      if (/tiktok_upload_source/.test(url)) rows.push({ key: 'tiktok_upload_source', value: { source: 'supabase' } });
      if (o.flag && /post_networks_v1/.test(url)) rows.push({ key: 'post_networks_v1', value: { clients: ['sidneylaruel'] } });
      if (o.sources && /post_sources_v1/.test(url)) rows.push({ key: 'post_sources_v1', value: { clients: ['sidneylaruel'] } });
      return reply(200, rows);
    }
    if (/functions\/v1\/post-source\b/.test(url)) {
      return reply(200, Object.assign({ ok: true, media_url: 'https://data.postforme.dev/v/1', file_name: 'video_15.mp4', rendition: 'original', fell_back_from_original: false, bytes: 28291416, thumb_url: '', thumb_note: '', metadata_fields: [], took_ms: 10 }, o.card));
    }
    if (/functions\/v1\/frameio-view\b/.test(url)) return reply(200, { ok: true, video: { url: 'https://frame.example.test/s.mp4', renditions: {} } });
    if (/functions\/v1\/instagram-upload\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action === 'mint') return reply(200, { ok: true, upload_url: 'https://storage.postforme.test/put', media_url: 'https://data.postforme.dev/up' });
      if (body.action === 'create') { log.creates.push(body); return reply(200, { ok: true, row: { id: 'row_new', status: 'scheduled', client: body.clientName, title: body.title, kind: 'reel', network: 'instagram', created_at: new Date().toISOString() } }); }
      if (body.action === 'list') return reply(200, { ok: true, rows: o.queue || [] });
      return reply(200, { ok: true, rows: [] });
    }
    if (/functions\/v1\//.test(url)) return reply(200, { ok: true, rows: [] });
    if (req.method() === 'PUT') { log.puts.push(url); return route.fulfill({ status: 200, headers: cors, body: '' }); }
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) || /tiktok-uploads-list/.test(url) ? '[]' : '{}' });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, log, errors };
}
async function openSide(page, base, side) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  await page.evaluate(({ client, posts }) => { calState.client = client; calState.posts = posts; }, { client: TEST_CLIENT, posts: POSTS });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
  const btn = { instagram: '#tkPlatInstagram', youtube: '#tkPlatYoutube', linkedin: '#tkPlatLinkedin' }[side || 'instagram'];
  await page.waitForSelector(btn + ':not([hidden])');
  await page.click(btn);
  await page.waitForSelector('#igFormCol:not([hidden])');
  if (!(await page.locator('#igFormCol .tk-profile-line').count())) {
    await page.click('#igClientBtn');
    await page.click(`#igClientMenu [data-sv-select-option][data-value=${JSON.stringify(TEST_CLIENT)}]`);
  }
  await page.waitForSelector('#igFormCol .tk-profile-line');
}
const openInstagram = (page, base) => openSide(page, base, 'instagram');
const attachVideo = (page) => page.setInputFiles('#igFile', { name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });
const textOf = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const disabled = (page, sel) => page.$eval(sel, el => el.disabled);
const checked = (page, sel) => page.$eval(sel, el => el.checked);
// The toggles draw their own track over the box, so a person (and this test) clicks the label.
async function toggle(page, sel, on) {
  if ((await checked(page, sel)) !== on) await page.click(`label:has(${sel})`);
  await page.waitForFunction(({ sel, on }) => document.querySelector(sel) && document.querySelector(sel).checked === on, { sel, on });
}

const sent = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('#igFormCol .tk-submit-bar')?.textContent || ''), re.source);

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    // ---- 1. the switch and the Instagram side
    {
      const { context, page, log, errors } = await newPage(browser);
      await openInstagram(page, base);
      ok(await page.isVisible('#tkPlatYoutube') && await page.isVisible('#tkPlatLinkedin'), 'switch on: YouTube and LinkedIn are on the platform switch');
      ok(await page.locator('#igNetInstagram, #igNetworksCard, #igNetYoutube, #igNetLinkedin').count() === 0, 'the Instagram side has no Instagram, YouTube or LinkedIn tick');
      await page.waitForSelector('#igFacebookCard');
      ok(await checked(page, '#igFacebook'), 'Also post to Facebook is on by default with a connected Page');
      await attachVideo(page);
      await page.fill('#igTitle', 'To Instagram');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to Instagram'); checks++;
      await page.click('#igSubmit');
      await sent(page, /Sent to Instagram and Facebook/);
      const b = log.creates[0];
      ok(b.socialAccountId === IDS.instagram && b.alsoFacebook === true && !('instagram' in b) && !b.youtube && !b.linkedin, 'the Instagram side posts to Instagram and Facebook, as before');
      ok(!errors.length, 'Instagram side: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 2. the YouTube side
    {
      const { context, page, log, errors } = await newPage(browser);
      await openSide(page, base, 'youtube');
      ok(/Posting to the client's YouTube/.test(await textOf(page, '#tkPlatformSub')), 'the header names YouTube');
      ok(/spc_fixtureYouTube0001/.test(await textOf(page, '#igFormCol .tk-profile-line')), 'the YouTube side shows the YouTube account');
      ok(await page.locator('input[name="igKind"], #igFacebookCard, #igTrial').count() === 0, 'no carousel, no Facebook, no trial on the YouTube side');
      ok(/Posts to YouTube as soon as you press Post to YouTube/.test(await textOf(page, '#igFormCol')), 'the scheduling note names YouTube');
      await attachVideo(page);
      await page.fill('#igTitle', '  First line here\nand the rest of the caption');
      await page.waitForSelector('#igYoutubeCard #igYtTitle');
      assert.equal(await page.inputValue('#igYtTitle'), 'First line here'); checks++;
      ok(await page.isChecked('input[name="igYtFormat"][value="short"]'), 'Short by default');
      ok(/Public\. Made for kids: No \(set on the client's profile\)\./.test(await textOf(page, '#igYtNote')), 'Public, and made for kids from the profile');
      await page.fill('#igTitle', 'A new first line <b>\nrest');
      assert.equal(await page.inputValue('#igYtTitle'), 'A new first line b'); checks++;
      await page.fill('#igYtTitle', '');
      ok(await disabled(page, '#igSubmit'), 'an empty YouTube title keeps Post off');
      await page.fill('#igYtTitle', 'My own title');
      await page.fill('#igTitle', 'Changed\nrest');
      assert.equal(await page.inputValue('#igYtTitle'), 'My own title'); checks++;
      assert.equal(await textOf(page, '#igSubmit'), 'Post to YouTube'); checks++;
      await page.click('#igSubmit');
      await sent(page, /Sent to YouTube\. It will show as Posted here once YouTube confirms\./);
      const body = log.creates[0];
      assert.equal(body.instagram, false); checks++;
      assert.equal(body.socialAccountId, ''); checks++;
      assert.deepEqual(body.youtube, { accountId: IDS.youtube, title: 'My own title', format: 'short' }); checks++;
      ok(!body.alsoFacebook && !body.linkedin, 'nothing for Facebook or LinkedIn');
      assert.equal(await textOf(page, '#igQueueCol h3'), 'YouTube uploads'); checks++;
      ok(!errors.length, 'YouTube side: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 3. a landscape card cannot go as a Short
    {
      const { context, page, log, errors } = await newPage(browser, { sources: true, card: { width: 1920, height: 1080, duration_seconds: 57 } });
      await openSide(page, base, 'youtube');
      await page.waitForSelector('input[name="igSrcMode"]');
      ok(await page.isChecked('input[name="igSrcMode"][value="card"]'), 'the YouTube side starts on From Content Calendar');
      await page.click('#igSrcCardBtn');
      await page.click('#igSrcCardMenu [data-sv-select-option][data-value="p_card_a"]');
      await page.waitForSelector('#igSrcReady');
      await page.waitForSelector('#igYtProblem');
      assert.equal(await textOf(page, '#igYtProblem'), 'A Short is a vertical video; this one is 1920×1080. Post it as a regular video.'); checks++;
      ok(await disabled(page, '#igSubmit'), 'a landscape Short keeps Post off');
      await page.click('label:has(input[name="igYtFormat"][value="regular"])');
      await page.waitForFunction(() => !document.getElementById('igYtProblem'));
      await page.click('#igSubmit');
      await sent(page, /Sent to YouTube/);
      assert.deepEqual(log.creates[0].youtube, { accountId: IDS.youtube, title: 'Card caption line', format: 'regular', durationSeconds: 57, width: 1920, height: 1080 }); checks++;
      ok(!errors.length, 'landscape: no page errors');
      await context.close();
    }
    // ---- 4. the LinkedIn side
    {
      const { context, page, log, errors } = await newPage(browser);
      await openSide(page, base, 'linkedin');
      ok(await page.locator('#igCoverDrop, #igCoverRemote, #igYoutubeCard, #igFacebookCard').count() === 0, 'LinkedIn: no cover, no YouTube card, no Facebook');
      await attachVideo(page);
      await page.fill('#igTitle', 'To LinkedIn');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to LinkedIn'); checks++;
      await page.click('#igSubmit');
      await sent(page, /Sent to LinkedIn/);
      const body = log.creates[0];
      ok(body.instagram === false && body.socialAccountId === '' && body.linkedin && body.linkedin.accountId === IDS.linkedin && !body.youtube && !body.alsoFacebook, 'LinkedIn: the body names LinkedIn only');
      ok(!errors.length, 'LinkedIn side: no page errors');
      await context.close();
    }
    // ---- 5. no accounts
    {
      const { context, page, errors } = await newPage(browser, { ids: { tiktok: IDS.tiktok, instagram: IDS.instagram } });
      await openSide(page, base, 'youtube');
      assert.equal(await textOf(page, '#igFormCol .tk-profile-line'), '⚠ No YouTube account No YouTube account linked to this client yet. Connect it in Post for Me: it links itself here within the hour. If it still isn\'t here after that, ask Sidney. Open Post for Me'); checks++;
      await attachVideo(page);
      await page.fill('#igTitle', 'Caption');
      ok(await disabled(page, '#igSubmit'), 'no YouTube account: Post stays off');
      await page.click('#tkPlatLinkedin');
      await page.waitForFunction(() => /No LinkedIn account/.test(document.querySelector('#igFormCol .tk-profile-line')?.textContent || ''));
      ok(/ask Sidney to link it to the client's profile: a LinkedIn account does not link itself/.test(await textOf(page, '#igFormCol .tk-profile-line')), 'LinkedIn: ask Sidney to link it');
      ok(await page.locator('#igFormCol .tk-profile-line a[href="https://www.postforme.dev"]').count() === 1, 'LinkedIn: Open Post for Me');
      // The Instagram side with no Facebook Page: no Facebook card at all.
      await page.click('#tkPlatInstagram');
      await page.waitForFunction(() => /spc_fixtureInstagram01/.test(document.querySelector('#igFormCol .tk-profile-line')?.textContent || ''));
      ok(await page.locator('#igFacebookCard').count() === 0, 'no Facebook Page: the Facebook card is hidden');
      ok(!errors.length, 'no accounts: no page errors');
      await context.close();
    }
    // ---- 6. each side's queue
    {
      const { context, page, errors } = await newPage(browser, { queue: QUEUE });
      await openSide(page, base, 'youtube');
      await page.click('#igQueueCol [data-ig-tab="done"]');
      await page.waitForSelector('#igQueueCol .tk-queue-item');
      ok(/YouTube only/.test(await textOf(page, '#igQueueCol')), 'the YouTube side lists the YouTube-only post');
      await page.click('#tkPlatLinkedin');
      await page.waitForFunction(() => /LinkedIn uploads/.test(document.querySelector('#igQueueCol h3')?.textContent || ''));
      await page.click('#igQueueCol [data-ig-tab="done"]');
      await page.waitForTimeout(200);
      ok(!/YouTube only/.test(await textOf(page, '#igQueueCol')), 'the LinkedIn side does not list the YouTube-only post');
      await page.click('#igQueueCol [data-ig-tab="failed"]');
      await page.waitForSelector('#igQueueCol .tk-queue-item');
      ok(/LinkedIn refused it/.test(await textOf(page, '#igQueueCol')), 'the LinkedIn side lists the post with LinkedIn\'s own result');
      ok(!errors.length, 'queues: no page errors');
      await context.close();
    }
    // ---- 7. switch off
    {
      const { context, page, log, errors } = await newPage(browser, { flag: false });
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.waitForTimeout(600);
      ok(!(await page.isVisible('#tkPlatYoutube')) && !(await page.isVisible('#tkPlatLinkedin')), 'switch off: no YouTube or LinkedIn button');
      await page.fill('#tkClientInput', TEST_CLIENT);
      await page.press('#tkClientInput', 'Enter');
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFacebookCard');
      await attachVideo(page);
      await page.fill('#igTitle', 'Off');
      await page.click('#igSubmit');
      await sent(page, /Sent to Instagram and Facebook/);
      ok(!('youtube' in log.creates[0]) && !('linkedin' in log.creates[0]) && !('instagram' in log.creates[0]), 'switch off: today\'s body');
      ok(!errors.length, 'switch off: no page errors');
      await context.close();
    }
    {
      const { context, page, errors } = await newPage(browser, { flag: false, ids: { tiktok: IDS.tiktok, instagram: IDS.instagram } });
      await openInstagram(page, base);
      await page.waitForSelector('#igFacebookCard');
      ok(/No Facebook Page/.test(await textOf(page, '#igFacebookCard')), 'switch off, no Page: the Facebook card still says why, as before');
      ok(!errors.length, 'switch off, no Page: no page errors');
      await context.close();
    }
    // ---- 8. 390 wide
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openSide(page, base, 'youtube');
      await attachVideo(page);
      await page.fill('#igTitle', 'Phone');
      await page.waitForSelector('#igYtTitle');
      ok(await page.evaluate(() => document.querySelector('.tk-platform-switch').scrollWidth <= document.querySelector('.tk-platform-switch').clientWidth + 1), '390: the four platform buttons fit');
      ok(await noSideScroll(page), '390: the YouTube side fits with no sideways scroll');
      ok(!errors.length, '390: no page errors');
      await context.close();
    }
    console.log(`post-networks-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
