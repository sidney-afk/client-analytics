'use strict';
/*
 * THE PUBLIC "START HERE" PAGE (/start), in a real browser, fully offline. Session Foyer, 2026-10-18;
 * round 2 (Sidney's feedback) by session Foyer 2, 2026-10-18.
 *
 * Serves the repository the way GitHub Pages does (scripts/pages-site.js) and proves, on desktop and phone:
 *   - /start and /start/ load with no console errors and no failed requests;
 *   - the page asks nothing of the app or any backend: every request is to this origin, except the review
 *     tutorial MP4, which is answered here with the frame viewer's generated clip (no network);
 *   - the first screen is the switch ("Review content" / "Upload content") and the review player;
 *   - the player carries the right MP4 address, never autoplays, plays and pauses from the big button and the bar;
 *   - the old upload tutorial (it showed a real client's form and a retired step) is gone from the page;
 *   - "Upload content" (and #upload, and the old #videographer link) shows the folder rules, the drawn tree and
 *     where to upload, with no player;
 *   - the page is static: nothing is sticky or fixed, nothing is scroll-driven, and scrolling changes no styles;
 *   - start/ is on the publish allow-list.
 * START_PAGE_SHOTS=<dir> also writes full-page and first-screen screenshots (desktop 1440 and phone 390) for the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = require('../scripts/pages-site.js');

const REVIEW_MP4 = 'https://embed-ssl.wistia.com/deliveries/8063b5cf9b2c2243a3413066c91feddb140a3352/file.mp4';
const UPLOAD_MP4 = 'https://embed-ssl.wistia.com/deliveries/720c8ce14c972e8829aca32c5dbada52ea48879c/file.mp4';
const UPLOAD_MP4_ID = '13b2f624ce35a73fffc264846cd340b9ced25479'; // the OLD upload tutorial: must never come back
const innerWidthGuess = w => w - 32;
const CLIP = fs.readFileSync(path.join(__dirname, 'fixtures/frameio-viewer-clip.webm'));
const SHOTS = process.env.START_PAGE_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  expect(site.PUBLISHED_DIRS.includes('start'), 'start/ is on the publish allow-list');
  const planned = site.plan().files;
  expect(planned.includes('start/index.html') && planned.includes('start/start.js') && planned.includes('start/start.css'), 'the site build includes the page, its script and its styles');

  const server = await site.pagesServer(site.ROOT);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    for (const view of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true }]) {
      console.log('— ' + view.name);
      const ctx = await browser.newContext({ viewport: { width: view.width, height: view.height }, isMobile: !!view.isMobile, hasTouch: !!view.hasTouch, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errors = [], foreign = [], failed = [];
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push(String(e)));
      page.on('requestfailed', r => { if (!/ERR_ABORTED/.test((r.failure() || {}).errorText || '')) failed.push(r.url()); }); // an abort is our own navigation cutting a lazy image
      page.on('response', r => { if (r.url().startsWith(origin) && r.status() >= 400) failed.push(r.status() + ' ' + r.url()); });
      await page.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith(origin)) return route.continue();
        if (u === REVIEW_MP4 || u === UPLOAD_MP4) return route.fulfill({ status: 200, contentType: 'video/webm', body: CLIP });
        foreign.push(u);
        return route.abort();
      });

      for (const addr of ['/start', '/start/']) {
        const res = await page.goto(origin + addr, { waitUntil: 'load' });
        expect(res && res.status() === 200, addr + ' answers 200');
      }
      await sleep(300);
      const html = await page.content();
      expect(!html.includes(UPLOAD_MP4_ID), 'the old upload tutorial is not on the page');
      expect(!/Linear/i.test(html), 'nothing on the page mentions Linear');
      expect(!/email/i.test(html), 'nothing on the page mentions email');

      const tabs = await page.$$eval('.switch [role="tab"]', ts => ts.map(t => t.textContent.trim()));
      expect(tabs.join('|') === 'Review content|Upload content', 'the switch reads "Review content" and "Upload content" (' + tabs.join(', ') + ')');
      expect(!/I am a (client|videographer)/i.test(html), 'the old "I am a client / videographer" labels are gone');

      // The first screen: the switch and the review player, whole, without scrolling.
      const first = await page.evaluate(() => {
        const inView = el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height > 0; };
        return { sw: inView(document.querySelector('.switch')), player: inView(document.querySelector('[data-player]')), y: scrollY };
      });
      expect(first.y === 0 && first.sw && first.player, 'the first screen shows the switch and the whole review player');

      const srcs = await page.$$eval('video', vs => vs.map(v => ({ src: v.getAttribute('src'), autoplay: v.autoplay, controls: v.controls, paused: v.paused, preload: v.preload })));
      expect(srcs.length === 2, 'two players on the page (the review tutorial and the upload tutorial)');
      expect(srcs[0] && srcs[0].src === REVIEW_MP4, 'the player plays the review tutorial MP4');
      expect(srcs.every(v => !v.autoplay && v.paused && !v.controls && v.preload === 'none'), 'the video does not autoplay, load early or show the browser controls');
      const parts = await page.$$eval('#panel-review [data-player] .big-play, #panel-review [data-player] .time, #panel-review [data-player] .speed, #panel-review [data-player] .back, #panel-review [data-player] .pp, #panel-review [data-player] .fwd, #panel-review [data-player] .vol, #panel-review [data-player] .full, #panel-review [data-player] .scrub', els => els.length);
      const upParts = await page.$$eval('#panel-upload [data-player] .big-play, #panel-upload [data-player] .scrub, #panel-upload [data-player] .full', els => els.length);
      expect(upParts === 3, 'the upload player is the same player (play button, seek line, full screen)');
      expect(parts === 9, 'the player has the big play button, time, speed, back 5 s, play/pause, forward 5 s, volume, full screen and the seek line');

      const player = page.locator('[data-player]').first();
      await player.locator('.big-play').click();
      await page.waitForFunction(() => { const v = document.querySelector('video'); return !v.paused && v.currentTime > 0; }, null, { timeout: 8000 }).catch(() => {});
      expect(await page.$eval('video', v => !v.paused && v.currentTime > 0), 'the big play button plays the review video');
      expect(await player.getAttribute('class').then(c => /playing/.test(c)), 'the player shows it is playing');
      await player.hover();
      await player.locator('.pp').click();
      expect(await page.$eval('video', v => v.paused), 'the bar\'s play/pause pauses it');
      await player.locator('.speed').click();
      expect(await page.$eval('video', v => v.playbackRate === 1.5) && (await player.locator('.speed').innerText()) === '1.5x', 'speed steps from 1x to 1.5x');
      await player.locator('.pp').click();
      await sleep(150);

      await page.locator('#tab-upload').click();
      expect(await page.$eval('video', v => v.paused), 'switching to Upload content pauses the review video');
      expect(!(await page.locator('[data-player]').first().isVisible()), 'Upload content hides the review player');
      expect(await page.locator('#panel-upload [data-player] video').count() === 1 && await page.locator('#panel-upload iframe').count() === 0, 'Upload content has its own player (the new upload tutorial)');
      expect(await page.$eval('#panel-upload video', v => v.getAttribute('src')) === UPLOAD_MP4 && await page.$eval('#panel-upload video', v => !v.autoplay), 'the upload player plays the upload tutorial MP4 and never autoplays');
      expect(await page.locator('.tree').isVisible() && await page.locator('.rules li').count() === 5, 'Upload content shows the five folder rules and the drawn folder tree');
      expect(await page.locator('.only-upload').isVisible() && /Google Drive/.test(await page.locator('.only-upload').innerText()), 'Upload content says where to upload');
      expect(await page.locator('.only-upload a.cta').getAttribute('href') === '/?intake=1' && await page.locator('.only-upload a.cta').isVisible(), 'Upload content links to the upload form');
      expect(await page.locator('.only-upload a.cta').getAttribute('target') === '_blank' && /noopener/.test(await page.locator('.only-upload a.cta').getAttribute('rel') || ''), 'the upload form opens in a new tab (owner, 2026-10-18)');
      // The quiet "I'm a client or videographer" chooser picks the side too.
      await page.click('.who [data-who="review"]');
      expect(await page.locator('#tab-review').getAttribute('aria-selected') === 'true' && await page.locator('.who [data-who="review"]').getAttribute('aria-pressed') === 'true', "I'm a client opens Review content");
      await page.click('.who [data-who="upload"]');
      expect(await page.locator('#tab-upload').getAttribute('aria-selected') === 'true' && await page.locator('.who [data-who="upload"]').getAttribute('aria-pressed') === 'true', "I'm a videographer opens Upload content");
      expect(await page.evaluate(() => location.hash) === '#upload', 'the address becomes #upload');
      await page.locator('.rules li').nth(3).hover();
      expect(await page.locator('.tree li.t-skip.on').count() === 1, 'pointing at "skip that folder" lights the skipped folder');
      await page.locator('#tab-review').click();
      expect(await page.locator('[data-player]').first().isVisible(), 'Review content shows the player again');
      for (const [h, want] of [['#upload', 'upload'], ['#videographer', 'upload'], ['#client', 'review']]) {
        await page.goto(origin + '/start/' + h, { waitUntil: 'load' });
        expect(await page.locator('.hero').getAttribute('data-path') === want, h + ' opens ' + want);
      }

      // Static: nothing pinned to the screen or driven by scroll.
      await page.goto(origin + '/start/', { waitUntil: 'load' });
      const pinned = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(el => /sticky|fixed/.test(getComputedStyle(el).position)).map(el => el.className || el.tagName));
      expect(pinned.length === 0, 'nothing is sticky or fixed' + (pinned.length ? ': ' + pinned.join(', ') : ''));
      expect(await page.locator('.lens, .tour-stage, .tour-shots, .step').count() === 0, 'the eye lens and the scroll tour are gone');
      const snap = () => page.evaluate(() => Array.from(document.querySelectorAll('main *')).map(el => { const c = getComputedStyle(el); return el.getAttribute('style') + c.opacity + c.transform + c.clipPath; }).join('|'));
      await sleep(500); // let the one-off panel fade finish
      const before = await snap();
      for (let y = 0; y <= 4000; y += 500) { await page.evaluate(v => window.scrollTo(0, v), y); await sleep(40); }
      await sleep(300);
      expect(await snap() === before, 'scrolling the whole page changes no style (no scroll-driven animation)');
      const pics = await page.$$eval('.pic img', ims => ims.map(i => Math.round(i.getBoundingClientRect().width)));
      expect(pics.length === 4 && pics.every(w => w >= Math.min(300, innerWidthGuess(view.width))), 'the four pictures are large (' + pics.join(', ') + ' px wide)');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow <= 0, 'no sideways scroll (' + overflow + ' px)');
      expect(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
      expect(failed.length === 0, 'no failed requests' + (failed.length ? ': ' + failed.join(' | ') : ''));
      expect(foreign.length === 0, 'no request leaves the site except the two tutorial MP4s' + (foreign.length ? ': ' + foreign.join(' | ') : ''));

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const sp = await ctx.newPage();
        await sp.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
        await sp.goto(origin + '/start/', { waitUntil: 'load' });
        await sp.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } window.scrollTo(0, 0); });
        await sleep(500);
        await sp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '-first-screen.png') });
        await sp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '.png'), fullPage: true });
        await sp.locator('#tab-upload').click(); await sleep(400);
        await sp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '-upload.png') });
      }
      await ctx.close();
    }

  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nSTART_PAGE_BROWSER_OK');
})().catch(e => { console.error(e); process.exit(1); });
