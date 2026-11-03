'use strict';
// YouTube and LinkedIn on the Post tab's Instagram side (plan row P3, page half; decision D5; OPEN_REPAIRS 655),
// behind post_networks_v1. Opens the real page offline with every backend answer local and proves:
//   1. switch on: a "Post to" card with Instagram, Facebook, YouTube and LinkedIn; YouTube and LinkedIn start unticked;
//      ticking YouTube shows its title (the caption's first line, following the caption until typed into), Short by
//      default, Public and made for kids as the client's profile says; Instagram can be unticked; the button names
//      the networks; the post sends instagram:false, no Instagram account, YouTube's and LinkedIn's profile ids, the
//      title and format, and no cover when neither Instagram nor YouTube is ticked;
//   2. a typed YouTube title stays when the caption changes; an empty title or no network ticked keeps Post off;
//   3. a card whose copy is landscape cannot go as a Short (the reason shows and Post is off); Regular video can;
//   4. a carousel or a trial reel posts to Instagram only: YouTube and LinkedIn cannot be ticked, Instagram cannot be
//      unticked;
//   5. no YouTube or LinkedIn account: each row says so (YouTube links itself, LinkedIn needs Sidney) with Open Post
//      for Me; Instagram with no account cannot be ticked, and the post can still go to YouTube;
//   6. the queue shows every network's own result and link, and a row whose first network is YouTube names it;
//   7. switch off: today's Facebook card, and the post body carries no YouTube, LinkedIn or instagram key;
//   8. at 390 wide the card fits with no sideways scroll.
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
async function openInstagram(page, base) {
  await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
  await page.evaluate(({ client, posts }) => { calState.client = client; calState.posts = posts; }, { client: TEST_CLIENT, posts: POSTS });
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
  await page.click('#tkPlatInstagram');
  await page.waitForSelector('#igFormCol');
  if (!(await page.locator('#igFormCol .tk-profile-line').count())) {
    await page.click('#igClientBtn');
    await page.click(`#igClientMenu [data-sv-select-option][data-value=${JSON.stringify(TEST_CLIENT)}]`);
  }
  await page.waitForSelector('#igFormCol .tk-profile-line');
}
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

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  const ok = (cond, what) => { assert.ok(cond, what); checks++; };
  try {
    // ---- 1 and 2. the card, YouTube's fields, Instagram unticked, the body
    {
      const { context, page, log, errors } = await newPage(browser);
      await openInstagram(page, base);
      await page.waitForSelector('#igNetworksCard');
      ok(await page.locator('#igFacebookCard').count() === 0, 'switch on: the "Post to" card replaces the Facebook card');
      ok(await checked(page, '#igNetInstagram') && await checked(page, '#igFacebook'), 'Instagram and Facebook start ticked');
      ok(!(await checked(page, '#igNetYoutube')) && !(await checked(page, '#igNetLinkedin')), 'YouTube and LinkedIn start unticked');
      await attachVideo(page);
      await page.fill('#igTitle', '  First line here\nand the rest of the caption');
      await toggle(page, '#igNetYoutube', true);
      await page.waitForSelector('#igYtTitle');
      assert.equal(await page.inputValue('#igYtTitle'), 'First line here'); checks++;
      assert.equal(await textOf(page, '#igYtCount'), '15 / 100'); checks++;
      ok(await checked(page, 'input[name="igYtFormat"][value="short"]'), 'YouTube: Short by default');
      ok(/Public\. Made for kids: No \(set on the client's profile\)\./.test(await textOf(page, '#igYtNote')), 'YouTube: Public, and made for kids from the profile');
      // The title follows the caption until it is typed into.
      await page.fill('#igTitle', 'A new first line <b>\nrest');
      assert.equal(await page.inputValue('#igYtTitle'), 'A new first line b'); checks++;
      await page.fill('#igYtTitle', 'My own title');
      await page.fill('#igTitle', 'Changed again\nrest');
      assert.equal(await page.inputValue('#igYtTitle'), 'My own title'); checks++;
      await page.fill('#igYtTitle', '');
      ok(await disabled(page, '#igSubmit'), 'an empty YouTube title keeps Post off');
      await page.fill('#igYtTitle', 'My own title');
      ok(!(await disabled(page, '#igSubmit')), 'a title back: Post is on');
      await toggle(page, '#igNetLinkedin', true);
      await toggle(page, '#igNetInstagram', false);
      ok(await page.locator('#igFormCol .tk-card h3', { hasText: 'Trial reel' }).count() === 0, 'Instagram unticked: no Trial reel card');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to 3 networks'); checks++;
      // Nothing ticked: Post is off.
      await toggle(page, '#igFacebook', false); await toggle(page, '#igNetYoutube', false); await toggle(page, '#igNetLinkedin', false);
      ok(await disabled(page, '#igSubmit'), 'no network ticked: Post is off');
      await toggle(page, '#igFacebook', true); await toggle(page, '#igNetYoutube', true); await toggle(page, '#igNetLinkedin', true);
      await page.waitForSelector('#igYtTitle');
      assert.equal(await page.inputValue('#igYtTitle'), 'My own title'); checks++;
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Facebook, YouTube and LinkedIn\./.test(document.querySelector('#igFormCol .tk-step-note[role="status"]')?.textContent || ''));
      ok(true, 'the notice names the three networks');
      const body = log.creates[0];
      assert.equal(body.instagram, false); checks++;
      assert.equal(body.socialAccountId, ''); checks++;
      assert.deepEqual(body.youtube, { accountId: IDS.youtube, title: 'My own title', format: 'short' }); checks++;
      assert.deepEqual(body.linkedin, { accountId: IDS.linkedin }); checks++;
      ok(body.alsoFacebook === true && body.facebookAccountId === IDS.facebook, 'Facebook rides on the same post');
      ok(!errors.length, 'section 1: no page errors (' + errors.join(' | ') + ')');
      await context.close();
    }
    // ---- 3. a landscape card cannot go as a Short
    {
      const { context, page, log, errors } = await newPage(browser, { sources: true, card: { width: 1920, height: 1080, duration_seconds: 57 } });
      await openInstagram(page, base);
      await page.waitForSelector('input[name="igSrcMode"]');
      await page.click('label:has(input[name="igSrcMode"][value="card"])');
      await page.click('#igSrcCardBtn');
      await page.click('#igSrcCardMenu [data-sv-select-option][data-value="p_card_a"]');
      await page.waitForSelector('#igSrcReady');
      await toggle(page, '#igNetYoutube', true);
      await page.waitForSelector('#igYtProblem');
      assert.equal(await textOf(page, '#igYtProblem'), 'A Short is a vertical video; this one is 1920×1080. Post it as a regular video.'); checks++;
      ok(await disabled(page, '#igSubmit'), 'a landscape Short keeps Post off');
      await page.click('label:has(input[name="igYtFormat"][value="regular"])');
      await page.waitForFunction(() => !document.getElementById('igYtProblem'));
      ok(!(await disabled(page, '#igSubmit')), 'Regular video: Post is on');
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram, Facebook and YouTube\./.test(document.querySelector('#igFormCol .tk-step-note[role="status"]')?.textContent || ''));
      assert.deepEqual(log.creates[0].youtube, { accountId: IDS.youtube, title: 'Card caption line', format: 'regular', durationSeconds: 57, width: 1920, height: 1080 }); checks++;
      ok(!('instagram' in log.creates[0]) && log.creates[0].socialAccountId === IDS.instagram, 'Instagram ticked: its account, and no instagram key');
      ok(!errors.length, 'section 3: no page errors');
      await context.close();
    }
    // ---- 4. carousel and trial: Instagram only
    {
      const { context, page, errors } = await newPage(browser);
      await openInstagram(page, base);
      await page.waitForSelector('#igNetworksCard');
      await toggle(page, '#igTrial', true);
      await page.waitForFunction(() => document.getElementById('igNetYoutube')?.disabled);
      ok(await disabled(page, '#igNetInstagram') && await checked(page, '#igNetInstagram'), 'trial: Instagram ticked and fixed');
      assert.equal(await textOf(page, '#igNetYoutubeNote'), 'Trial reels are an Instagram feature, so this one posts to Instagram only.'); checks++;
      ok(await disabled(page, '#igNetLinkedin'), 'trial: LinkedIn cannot be ticked');
      await toggle(page, '#igTrial', false);
      await page.click('label:has(input[name="igKind"][value="carousel"])');
      await page.waitForFunction(() => /carousel goes to Instagram and Facebook only/.test(document.getElementById('igNetYoutubeNote')?.textContent || ''));
      ok(await disabled(page, '#igNetYoutube') && await disabled(page, '#igNetInstagram'), 'carousel: YouTube off, Instagram fixed');
      ok(!errors.length, 'section 4: no page errors');
      await context.close();
    }
    // ---- 5. no accounts
    {
      const { context, page, log, errors } = await newPage(browser, { ids: { tiktok: IDS.tiktok, youtube: IDS.youtube }, kids: true });
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.fill('#tkClientInput', TEST_CLIENT);
      await page.press('#tkClientInput', 'Enter');
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol');
      if (!(await page.locator('#igNetworksCard').count())) {
        await page.click('#igClientBtn');
        await page.click(`#igClientMenu [data-sv-select-option][data-value=${JSON.stringify(TEST_CLIENT)}]`);
      }
      await page.waitForSelector('#igNetworksCard');
      ok(await disabled(page, '#igNetInstagram') && !(await checked(page, '#igNetInstagram')), 'no Instagram account: Instagram cannot be ticked');
      assert.equal(await textOf(page, '#igNetLinkedinNote'), 'No LinkedIn account linked to this client yet. Connect it in Post for Me, then ask Sidney to link it to the client\'s profile: a LinkedIn account does not link itself. Open Post for Me'); checks++;
      ok(await page.locator('#igNetLinkedinNote a[href="https://www.postforme.dev"][target="_blank"]').count() === 1, 'LinkedIn: Open Post for Me beside it');
      await attachVideo(page);
      await page.fill('#igTitle', 'Only to YouTube');
      await toggle(page, '#igNetYoutube', true);
      await page.waitForSelector('#igYtNote');
      ok(/Made for kids: Yes/.test(await textOf(page, '#igYtNote')), 'made for kids reads the profile (Yes)');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to YouTube'); checks++;
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to YouTube\. It will show as Posted here once YouTube confirms\./.test(document.querySelector('#igFormCol .tk-step-note[role="status"]')?.textContent || ''));
      ok(log.creates[0].instagram === false && !log.creates[0].alsoFacebook && log.creates[0].youtube.accountId === IDS.youtube, 'YouTube only: the body');
      ok(!errors.length, 'section 5: no page errors');
      await context.close();
    }
    {
      const { context, page, errors } = await newPage(browser, { ids: { tiktok: IDS.tiktok, instagram: IDS.instagram } });
      await openInstagram(page, base);
      await page.waitForSelector('#igNetworksCard');
      assert.equal(await textOf(page, '#igNetYoutubeNote'), 'No YouTube account linked to this client yet. Connect it in Post for Me: it links itself here within the hour. If it still isn\'t here after that, ask Sidney. Open Post for Me'); checks++;
      ok(await disabled(page, '#igNetYoutube'), 'no YouTube account: YouTube cannot be ticked');
      ok(!errors.length, 'no YouTube account: no page errors');
      await context.close();
    }
    // ---- 6. the queue
    {
      const { context, page, errors } = await newPage(browser, { queue: QUEUE });
      await openInstagram(page, base);
      // A failure on any network files the row under Failed (LinkedIn failed here), not Upcoming.
      await page.waitForFunction(() => /Failed\s*1/.test(document.querySelector('#igQueueCol [data-ig-tab="failed"]')?.textContent || ''));
      ok(true, 'a failed network counts the row as failed');
      await page.click('#igQueueCol [data-ig-tab="failed"]');
      await page.waitForSelector('#igQueueCol .tk-queue-item');
      const first = page.locator('#igQueueCol .tk-queue-item').first();
      assert.equal((await first.locator('.tk-q-meta').textContent()).replace(/\s+/g, ' ').trim(), 'Reel · Instagram, YouTube and LinkedIn'); checks++;
      assert.deepEqual(await first.locator('.tk-q-net-name').allTextContents(), ['Instagram', 'YouTube', 'LinkedIn']); checks++;
      ok(/LinkedIn refused it/.test(await first.textContent()), 'the queue shows LinkedIn\'s own failure');
      await page.click('#igQueueCol [data-ig-tab="done"]');
      await page.waitForSelector('#igQueueCol .tk-queue-item');
      const done = page.locator('#igQueueCol .tk-queue-item').first();
      ok(/Reel · YouTube/.test(await done.locator('.tk-q-meta').textContent()), 'a row whose first network is YouTube names it');
      assert.equal(await done.locator('a.tk-q-btn').textContent(), 'Open'); checks++;
      ok(!errors.length, 'queue: no page errors');
      await context.close();
    }
    // ---- 7. switch off
    {
      const { context, page, log, errors } = await newPage(browser, { flag: false });
      await openInstagram(page, base);
      await page.waitForSelector('#igFacebookCard');
      ok(await page.locator('#igNetworksCard, #igNetYoutube').count() === 0, 'switch off: no YouTube or LinkedIn');
      await attachVideo(page);
      await page.fill('#igTitle', 'Off');
      assert.equal(await textOf(page, '#igSubmit'), 'Post to Instagram'); checks++;
      await page.click('#igSubmit');
      await page.waitForFunction(() => /Sent to Instagram and Facebook/.test(document.querySelector('#igFormCol .tk-step-note[role="status"]')?.textContent || ''));
      const body = log.creates[0];
      ok(!('youtube' in body) && !('linkedin' in body) && !('instagram' in body), 'switch off: the body is today\'s');
      ok(!errors.length, 'switch off: no page errors');
      await context.close();
    }
    // ---- 8. 390 wide
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 } });
      await openInstagram(page, base);
      await page.waitForSelector('#igNetworksCard');
      await toggle(page, '#igNetYoutube', true);
      await page.waitForSelector('#igYtTitle');
      ok(await noSideScroll(page), '390: the Post to card and YouTube fields fit with no sideways scroll');
      ok(!errors.length, '390: no page errors');
      await context.close();
    }
    console.log(`post-networks-browser: ${checks} checks passed`);
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
