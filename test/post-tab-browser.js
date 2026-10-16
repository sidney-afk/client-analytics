'use strict';
// The Post tab (TikTok and Instagram; called TikTok Upload until 2026-10-16). Opens the real page offline and proves:
//   1. the tab is called Post in the menu and the heading, with its own icon; /post opens it and the old
//      address /tiktok-upload still does;
//   2. the panel takes a faint blue wash on TikTok and an orange-pink one on Instagram (light and dark), the
//      header shows the platform's name and logo, and the button says "Post to TikTok" / "Post to Instagram";
//   3. a video whose file name names exactly one of the client's Calendar cards fills an empty caption with that
//      card's caption and says so with an Undo; two matching cards fill nothing; a typed caption is never
//      replaced; Undo empties the box again; on Instagram, a caption the card wrote for Instagram wins.
// Every backend answer is local and nothing is ever submitted: the page is never asked to post.
// POST_SHOTS=<dir> also saves desktop and phone screenshots of both sides, light and dark.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const { seedStaffIdentity } = require('../qa/staff-gate-seed.js');

const ADMIN = { id: 'qa_admin', name: 'QA Admin', role: 'admin', team: null };
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS' };
// The test client's display name, read from the page's own roster (the only client this check uses).
const TEST_CLIENT = (fs.readFileSync(path.join(__dirname, '..', 'src', 'index', '070-core-client-names.js.part'), 'utf8').match(/'[^']+'/g) || [])
  .map(q => q.slice(1, -1)).find(n => n.toLowerCase().replace(/[^a-z]/g, '') === 'sidneylaruel');
assert.ok(TEST_CLIENT, 'the test client is on the roster');
const csv = (v) => '"' + String(v).replace(/"/g, '""') + '"';
const CLIENTS_CSV = ['client_name,postforme_account_id,postforme_instagram_account_id',
  `${csv(TEST_CLIENT)},${csv('spc_fixtureTikTok0001')},${csv('spc_fixtureInstagram01')}`].join('\r\n') + '\r\n';
// The test client's Calendar cards, as the Calendar reads them.
const CARDS = [
  { id: 'p_fx_15', client: 'x', order_index: 1, name: 'Video 15', caption: 'Caption fifteen #fixture', caption_alt: 'Instagram caption fifteen', caption_alt_platform: 'instagram', status: 'Approved', asset_url: '' },
  { id: 'p_fx_hook_a', client: 'x', order_index: 2, name: 'Hook clip', caption: 'Hook caption A', status: 'In Progress', asset_url: '' },
  { id: 'p_fx_hook_b', client: 'x', order_index: 3, name: 'Second hook', caption: 'Hook caption B', status: 'In Progress', asset_url: 'https://drive.fixture.test/files/hook_clip.mp4' },
  { id: 'p_fx_link', client: 'x', order_index: 4, name: 'Video 22', caption: 'Caption from the link', status: 'Approved', asset_url: 'https://drive.fixture.test/files/Final%20Cut%2022B.mov' },
];
const SHOTS = process.env.POST_SHOTS || '';
const video = (name) => ({ name, mimeType: 'video/mp4', buffer: Buffer.from('not really a video') });

async function newPage(browser, opts) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts || {}));
  const calls = { writes: [], cards: 0 };
  await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, async route => {
    const req = route.request(); const url = req.url();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (/key-verify/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, role: 'admin', member: ADMIN }) });
    if (/\/gviz\/tq/.test(url)) {
      const sheet = new URL(url).searchParams.get('sheet') || '';
      return route.fulfill({ status: 200, contentType: 'text/csv', headers: cors, body: sheet === 'Clients Info' ? CLIENTS_CSV : 'col\r\n' });
    }
    if (/\/rest\/v1\/calendar_posts\?/.test(url)) { calls.cards++; return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(CARDS) }); }
    if (/functions\/v1\/(instagram-upload|tiktok-upload)\b/.test(url)) {
      const body = JSON.parse(req.postData() || '{}');
      if (body.action && !/^(list|status)$/.test(body.action)) calls.writes.push(body.action);
      return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ok: true, rows: [] }) });
    }
    if (/write-diagnostics/.test(url)) return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: '{"ok":true}' });
    if (/n8n\.cloud\/webhook\/tiktok-upload(?!s-list|-status)/.test(url) || /tiktok-upload-cancel/.test(url)) calls.writes.push(url);
    if (req.method() !== 'GET' && !/tiktok-uploads-list|tiktok-upload-status|runtime|rpc\//.test(url)) calls.writes.push(req.method() + ' ' + url);
    return route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: /\/rest\/v1\//.test(url) ? '[]' : (/tiktok-uploads-list/.test(url) ? '[]' : '{}') });
  });
  await seedStaffIdentity(context, ADMIN);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return { context, page, calls, errors };
}

async function pickTiktokClient(page) {
  await page.fill('#tkClientInput', TEST_CLIENT);
  await page.press('#tkClientInput', 'Enter');
  await page.waitForSelector('[data-tk-picked-client]');
}
async function pickSv(page, id, value) {
  await page.click(`#${id}Btn`);
  await page.click(`#${id}Menu [data-sv-select-option][data-value=${JSON.stringify(value)}]`);
}
const lineText = (page, sel) => page.$eval(sel, el => el.textContent.replace(/\s+/g, ' ').trim());
const wash = (page) => page.$eval('.tk-page', el => getComputedStyle(el).backgroundImage);
const shot = async (page, name, focus) => { if (SHOTS) { if (focus) await page.$eval(focus, el => el.scrollIntoView({ block: 'center' })); await page.waitForTimeout(450); fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); } };

(async () => {
  const server = await serveStatic();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let checks = 0;
  try {
    // ---- 1. the name, the icon and the addresses
    for (const addr of ['/post', '/tiktok-upload', '/#tiktok-upload']) {
      const { context, page, errors } = await newPage(browser);
      await page.goto(base + addr, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.waitForFunction(() => location.pathname === '/post', null, { timeout: 5000 }).catch(() => {});
      assert.equal(await page.evaluate(() => location.pathname), '/post', `${addr} opens the Post tab at /post`); checks++;
      assert.equal(await page.evaluate(() => currentNav), 'tiktok-upload', `${addr}: the Post screen is showing`); checks++;
      assert.deepEqual(errors, [], `${addr}: no page errors`); checks++;
      await context.close();
    }
    {
      const { context, page, errors } = await newPage(browser);
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      const nav = await page.$eval('#navTiktokUpload', a => ({ text: a.textContent.trim(), aria: a.getAttribute('aria-label'), href: a.getAttribute('href'), ico: a.querySelector('.header-nav-ico').className, mask: getComputedStyle(a.querySelector('.header-nav-ico')).webkitMaskImage || getComputedStyle(a.querySelector('.header-nav-ico')).maskImage }));
      assert.equal(nav.text, 'Post', 'the menu says Post'); checks++;
      assert.equal(nav.aria, 'Post'); checks++;
      assert.equal(nav.href, '/post', 'the menu links to /post'); checks++;
      assert.match(nav.ico, /\bico-post\b/, 'the menu uses the Post icon'); checks++;
      assert.match(nav.mask, /nav-icons\/post\.png/, 'the icon is the new upload artwork'); checks++;
      assert.equal(await page.innerText('.tk-title'), 'Post', 'the heading says Post'); checks++;
      assert.match(await page.$eval('link[rel~="icon"]', l => l.getAttribute('href')), /post-favicon\.png/, 'the browser tab shows the Post icon'); checks++;
      const icon = await page.evaluate(() => fetch('/nav-icons/post.png').then(r => r.status));
      assert.equal(icon, 200, 'the icon file is served'); checks++;

      // ---- 2. which platform, at a glance
      assert.equal(await page.getAttribute('.tk-page', 'data-platform'), 'tiktok'); checks++;
      assert.match(await wash(page), /rgba\(37, 99, 235/, 'TikTok: a blue wash'); checks++;
      assert.equal((await page.innerText('#tkPlatBadge')).trim(), 'TikTok', 'the header names TikTok'); checks++;
      assert.equal(await page.locator('#tkPlatBadge svg').count(), 1, 'with its logo'); checks++;
      assert.equal((await page.innerText('#tkSubmit')).trim(), 'Post to TikTok', 'the button says Post to TikTok'); checks++;
      assert.equal(await page.locator('#tkSubmit svg').count(), 1, 'with the TikTok logo'); checks++;
      await page.click('label.tk-toggle:has(#tkPostNow)');
      assert.equal((await page.innerText('#tkSubmit')).trim(), 'Schedule on TikTok', 'scheduling still names TikTok'); checks++;
      await page.click('label.tk-toggle:has(#tkPostNow)');
      await shot(page, 'desktop-tiktok-light');

      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden]) #igSubmit');
      assert.equal(await page.getAttribute('.tk-page', 'data-platform'), 'instagram'); checks++;
      const igWash = await wash(page);
      assert.match(igWash, /rgba\(249, 115, 22/, 'Instagram: an orange wash'); checks++;
      assert.match(igWash, /rgba\(225, 48, 108/, 'running to pink'); checks++;
      assert.equal((await page.innerText('#tkPlatBadge')).trim(), 'Instagram', 'the header names Instagram'); checks++;
      assert.equal((await page.innerText('#igSubmit')).trim(), 'Post to Instagram', 'the button says Post to Instagram'); checks++;
      assert.equal(await page.locator('#igSubmit svg').count(), 1, 'with the Instagram logo'); checks++;
      await shot(page, 'desktop-instagram-light');

      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      assert.match(await wash(page), /rgba\(251, 146, 60/, 'dark mode has its own, softer Instagram wash'); checks++;
      const badgeDark = await page.$eval('#tkPlatBadge', el => getComputedStyle(el).color);
      assert.equal(badgeDark, 'rgb(249, 168, 212)', 'the Instagram badge is a light pink in dark mode'); checks++;
      await shot(page, 'desktop-instagram-dark');
      await page.click('#tkPlatTiktok');
      assert.match(await wash(page), /rgba\(96, 165, 250/, 'dark mode has its own TikTok wash'); checks++;
      assert.equal(await page.$eval('#tkPlatBadge', el => getComputedStyle(el).color), 'rgb(147, 197, 253)', 'the TikTok badge is a light blue in dark mode'); checks++;
      await shot(page, 'desktop-tiktok-dark');
      await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- 3. the caption from the Calendar, TikTok side
    {
      const { context, page, calls, errors } = await newPage(browser);
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await pickTiktokClient(page);

      // one card named like the file: its caption fills the empty box
      await page.setInputFiles('#tkFile', video('video_15.MP4'));
      await page.waitForSelector('#tkCapFill', { timeout: 10000 });
      assert.equal(await page.inputValue('#tkTitle'), 'Caption fifteen #fixture', 'the card caption fills the box'); checks++;
      assert.match(await lineText(page, '#tkCapFill'), /^Caption filled from Calendar: Video 15 Undo$/, 'and says where it came from'); checks++;
      assert.ok(calls.cards >= 1, 'the cards were read the way the Calendar reads them'); checks++;
      await shot(page, 'desktop-tiktok-caption-filled', '#tkCapFill');

      // Undo empties the box and drops the line
      await page.click('#tkCapFillUndo');
      assert.equal(await page.inputValue('#tkTitle'), '', 'Undo empties the caption'); checks++;
      assert.equal(await page.locator('#tkCapFill').count(), 0, 'and the line goes'); checks++;

      // a typed caption is never replaced
      await page.click('#tkFormCol .tk-mini-btn:has-text("Remove")');
      await page.fill('#tkTitle', 'My own words');
      await page.setInputFiles('#tkFile', video('Video 15.mp4'));
      await page.waitForTimeout(600);
      assert.equal(await page.inputValue('#tkTitle'), 'My own words', 'a typed caption stays'); checks++;
      assert.equal(await page.locator('#tkCapFill').count(), 0, 'nothing claims to have filled it'); checks++;

      // two cards match (one by name, one by its video link): nothing fills
      await page.click('#tkFormCol .tk-mini-btn:has-text("Remove")');
      await page.fill('#tkTitle', '');
      await page.setInputFiles('#tkFile', video('Hook Clip.mov'));
      await page.waitForTimeout(600);
      assert.equal(await page.inputValue('#tkTitle'), '', 'two matching cards fill nothing'); checks++;
      assert.equal(await page.locator('#tkCapFill').count(), 0); checks++;

      // the card's video link name counts too
      await page.click('#tkFormCol .tk-mini-btn:has-text("Remove")');
      await page.setInputFiles('#tkFile', video('final-cut 22b.mp4'));
      await page.waitForSelector('#tkCapFill', { timeout: 10000 });
      assert.equal(await page.inputValue('#tkTitle'), 'Caption from the link', 'a match on the card video link name fills'); checks++;
      // an edit keeps the text and retires the Undo
      await page.focus('#tkTitle');
      await page.$eval('#tkTitle', el => el.setSelectionRange(el.value.length, el.value.length));
      await page.keyboard.type('!');
      assert.equal(await page.locator('#tkCapFill').count(), 0, 'editing the filled caption makes it yours'); checks++;
      assert.equal(await page.inputValue('#tkTitle'), 'Caption from the link!'); checks++;

      // ---- the Instagram side: same rule, and a caption written for Instagram wins
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden]) #igSubmit');
      if (await page.locator('#igClientBtn').count()) {
        const picked = await page.$eval('#igClientBtn', b => b.textContent.trim());
        if (picked !== TEST_CLIENT) await pickSv(page, 'igClient', TEST_CLIENT);
      }
      await page.setInputFiles('#igFile', video('VIDEO 15.mp4'));
      await page.waitForSelector('#igCapFill', { timeout: 10000 });
      assert.equal(await page.inputValue('#igTitle'), 'Instagram caption fifteen', 'Instagram takes the card caption written for Instagram'); checks++;
      assert.match(await lineText(page, '#igCapFill'), /^Caption filled from Calendar: Video 15 Undo$/); checks++;
      await shot(page, 'desktop-instagram-caption-filled', '#igCapFill');
      await page.click('#igCapFillUndo');
      assert.equal(await page.inputValue('#igTitle'), '', 'Undo works on Instagram'); checks++;
      await page.fill('#igTitle', 'Typed for Instagram');
      await page.click('#igRemoveFile');
      await page.setInputFiles('#igFile', video('Video 15.mp4'));
      await page.waitForTimeout(600);
      assert.equal(await page.inputValue('#igTitle'), 'Typed for Instagram', 'a typed Instagram caption stays'); checks++;

      assert.deepEqual(calls.writes, [], 'nothing was posted, scheduled or cancelled'); checks++;
      assert.deepEqual(errors, [], 'no page errors'); checks++;
      await context.close();
    }

    // ---- phone: the header names the platform, and the wash and labels hold
    {
      const { context, page, errors } = await newPage(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
      await page.goto(base + '/post', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('.tk-page #tkPlatTiktok', { timeout: 20000 });
      await page.waitForTimeout(500);
      assert.match(await wash(page), /rgba\(37, 99, 235/, 'phone: the TikTok wash'); checks++;
      assert.match(await page.innerText('#tkSubmit'), /Post to TikTok/, 'phone: the TikTok button'); checks++;
      await shot(page, 'phone-tiktok-light');
      await page.click('#tkPlatInstagram');
      await page.waitForSelector('#igFormCol:not([hidden]) #igSubmit');
      await page.waitForTimeout(300);
      assert.match(await wash(page), /rgba\(249, 115, 22/, 'phone: the Instagram wash'); checks++;
      assert.match(await page.innerText('#igSubmit'), /Post to Instagram/, 'phone: the Instagram button'); checks++;
      await shot(page, 'phone-instagram-light');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      await shot(page, 'phone-instagram-dark');
      await page.click('#tkPlatTiktok');
      await shot(page, 'phone-tiktok-dark');
      assert.deepEqual(errors, [], 'phone: no page errors'); checks++;
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`post-tab-browser: ${checks} checks passed ✅`);
})().catch(e => { console.error(e); process.exit(1); });
