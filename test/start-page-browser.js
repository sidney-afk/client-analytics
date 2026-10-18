'use strict';
/*
 * THE PUBLIC "START HERE" PAGE (/start), in a real browser, fully offline. Session Foyer, 2026-10-18.
 *
 * Serves the repository the way GitHub Pages does (scripts/pages-site.js) and proves, on desktop and phone:
 *   - /start and /start/ load with no console errors and no failed requests;
 *   - the page asks nothing of the app or any backend: every request is to this origin, except the two tutorial
 *     MP4s, which are answered here with the frame viewer's generated clip (no network);
 *   - both players carry the right MP4 address, never autoplay, play and pause from the big button and the bar,
 *     and starting one pauses the other;
 *   - "I am a videographer" (and #videographer) hides the client-only review video; "I am a client" shows it;
 *   - start/ is on the publish allow-list.
 * START_PAGE_SHOTS=<dir> also writes full-page screenshots (desktop 1440 and phone 390) for the PR.
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const site = require('../scripts/pages-site.js');

const REVIEW_MP4 = 'https://embed-ssl.wistia.com/deliveries/8063b5cf9b2c2243a3413066c91feddb140a3352/file.mp4';
const UPLOAD_MP4 = 'https://embed-ssl.wistia.com/deliveries/13b2f624ce35a73fffc264846cd340b9ced25479/file.mp4';
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
      await sleep(400);
      expect(await page.locator('h1').innerText().then(t => /every post/i.test(t)), 'the headline draws');

      const srcs = await page.$$eval('video', vs => vs.map(v => ({ src: v.getAttribute('src'), autoplay: v.autoplay, controls: v.controls, paused: v.paused, preload: v.preload })));
      expect(srcs.length === 2, 'two players on the client view');
      expect(srcs[0] && srcs[0].src === REVIEW_MP4, 'the first player plays the review tutorial MP4');
      expect(srcs[1] && srcs[1].src === UPLOAD_MP4, 'the second player plays the upload tutorial MP4');
      expect(srcs.every(v => !v.autoplay && v.paused && !v.controls && v.preload === 'none'), 'neither video autoplays, loads early or shows the browser controls');
      for (const p of await page.$$('[data-player]')) {
        const parts = await p.$$eval('.big-play, .time, .speed, .back, .pp, .fwd, .vol, .full, .scrub', els => els.map(e => e.className));
        expect(parts.length === 9, 'a player has the big play button, time, speed, back 5 s, play/pause, forward 5 s, volume, full screen and the seek line');
      }

      const players = page.locator('[data-player]');
      await players.nth(0).scrollIntoViewIfNeeded();
      await players.nth(0).locator('.big-play').click();
      await page.waitForFunction(() => { const v = document.querySelectorAll('video')[0]; return !v.paused && v.currentTime > 0; }, null, { timeout: 8000 }).catch(() => {});
      expect(await page.$eval('video', v => !v.paused && v.currentTime > 0), 'the big play button plays the review video');
      expect(await players.nth(0).getAttribute('class').then(c => /playing/.test(c)), 'the player shows it is playing');
      await players.nth(0).hover();
      await players.nth(0).locator('.pp').click();
      expect(await page.$eval('video', v => v.paused), 'the bar\'s play/pause pauses it');
      await players.nth(0).locator('.speed').click();
      expect(await page.$eval('video', v => v.playbackRate === 1.5) && (await players.nth(0).locator('.speed').innerText()) === '1.5x', 'speed steps from 1x to 1.5x');
      await players.nth(0).locator('.pp').click();
      await sleep(200);
      await players.nth(1).scrollIntoViewIfNeeded();
      await players.nth(1).locator('.big-play').click();
      await page.waitForFunction(() => !document.querySelectorAll('video')[1].paused, null, { timeout: 8000 }).catch(() => {});
      const both = await page.$$eval('video', vs => vs.map(v => v.paused));
      expect(both[1] === false, 'the upload video plays');
      expect(both[0] === true, 'starting one video pauses the other');
      await players.nth(1).locator('.pp').click();

      await page.locator('[data-path="videographer"][role="tab"]').click();
      expect(!(await page.locator('video').nth(0).isVisible()), 'videographer view hides the review tutorial');
      expect(await page.locator('video').nth(1).isVisible(), 'videographer view keeps the upload tutorial');
      expect(await page.locator('.only-videographer').first().isVisible(), 'videographer view shows the videographer wording');
      await page.locator('[data-path="client"][role="tab"]').click();
      expect(await page.locator('video').nth(0).isVisible(), 'client view shows the review tutorial again');
      await page.goto(origin + '/start/#videographer', { waitUntil: 'load' });
      expect(await page.locator('#path-panel').getAttribute('data-path') === 'videographer', '#videographer opens the videographer view');

      await page.locator('.rules li').nth(3).hover();
      expect(await page.locator('.tree li.t-skip.on').count() === 1, 'pointing at "skip that folder" lights the skipped folder');

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow <= 0, 'no sideways scroll (' + overflow + ' px)');
      expect(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
      expect(failed.length === 0, 'no failed requests' + (failed.length ? ': ' + failed.join(' | ') : ''));
      expect(foreign.length === 0, 'no request leaves the site except the two tutorial MP4s' + (foreign.length ? ': ' + foreign.join(' | ') : ''));

      if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        const sp = await ctx.newPage();
        await sp.emulateMedia({ reducedMotion: 'reduce' });
        await sp.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
        await sp.goto(origin + '/start/', { waitUntil: 'load' });
        await sp.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 30)); } window.scrollTo(0, 0); });
        await sleep(600);
        await sp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '.png'), fullPage: true });
        // The motion, as a visitor sees it: the lens half open, then open, then the tour.
        const mp = await ctx.newPage();
        await mp.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
        await mp.goto(origin + '/start/', { waitUntil: 'load' });
        await sleep(1200);
        await mp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '-1-hero.png') });
        const lensTop = await mp.$eval('.lens', el => el.getBoundingClientRect().top + window.scrollY);
        for (const [i, f] of [[2, -0.35], [3, 0.45]]) { await mp.evaluate(y => window.scrollTo(0, y), lensTop + f * view.height); await sleep(700); await mp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '-' + i + '-lens.png') }); }
        const steps = await mp.$$eval('.step', els => els.map(e => { const r = e.getBoundingClientRect(); return r.top + window.scrollY + r.height / 2; }));
        await mp.evaluate(y => window.scrollTo(0, y - window.innerHeight / 2), steps[1]); await sleep(900);
        await mp.screenshot({ path: path.join(SHOTS, 'start-' + view.name + '-4-tour.png') });
      }
      await ctx.close();
    }

    // Reduced motion: the lens is open and nothing waits on a scroll.
    const rm = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const rp = await rm.newPage();
    await rp.route('**/*', r => r.request().url().startsWith(origin) ? r.continue() : r.abort());
    await rp.goto(origin + '/start/', { waitUntil: 'load' });
    const clip = await rp.$eval('.lens-frame', el => getComputedStyle(el).clipPath);
    expect(clip === 'none', 'with reduced motion the screenshot shows whole, no lens');
    await rm.close();
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nSTART_PAGE_BROWSER_OK');
})().catch(e => { console.error(e); process.exit(1); });
