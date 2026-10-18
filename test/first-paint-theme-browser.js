'use strict';
/*
 * FIRST PAINT ON THE CLIENT REVIEW LINK, frame by frame (session Lantern, 2026-10-18).
 *
 * Owner report: on the new review page in dark mode, a refresh showed a white page with a small white card (the link
 * check), then the dark review page. This test refreshes that page in a real browser, fully offline (the review page's
 * own fixture: fictional client, cards and token), records every painted frame from the reload to the loaded page, and
 * fails on:
 *   - dark saved: any frame brighter than the dark page (a white flash), or the old review list showing before the
 *     new page (a mismatched page), at 1440 x 900 and 390 x 844;
 *   - light saved: any frame darker than the light page;
 *   - the switch turned off since the last visit: the page must come back light, on the old page, and forget the link;
 *   - a client link the browser never saw switched on, with dark saved elsewhere: light from the first frame (a client
 *     link stays light unless the review page is on for it);
 *   - the page's first markup and the script's copy of the review-shaped loading screen drifting apart.
 * FIRST_PAINT_SHOTS=<dir> writes every recorded frame there (for the PR's before and after strips).
 */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const SHOTS = process.env.FIRST_PAINT_SHOTS || '';
const failures = [];
function expect(value, message) { if (!value) { failures.push(message); console.error('FAIL  ' + message); } else console.log('  ok  ' + message); }

// In-page log of what each animation frame shows: the theme, the loading layer, and whether the OLD review list is
// visible with nothing over it (it must never show on a switched-on link).
const FRAME_LOG = () => {
  window.__fpLog = [];
  const tick = () => {
    try {
      const de = document.documentElement;
      const cal = document.querySelector('#calView .kcard, #calView [data-cal-review-pid]');
      const oldShown = !!cal && cal.offsetParent !== null && !document.getElementById('svRsBootVeil') && !de.classList.contains('sv-rs-full');
      window.__fpLog.push({ t: performance.now(), dark: de.getAttribute('data-theme') === 'dark', veil: !!document.getElementById('svRsBootVeil'), oldShown });
    } catch (e) {}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

async function brightness(browser, frames) {
  const page = await browser.newPage();
  const out = await page.evaluate(async datas => {
    const c = document.createElement('canvas'); const g = c.getContext('2d', { willReadFrequently: true });
    const res = [];
    for (const d of datas) {
      const img = new Image(); img.src = 'data:image/png;base64,' + d; await img.decode();
      c.width = 96; c.height = Math.max(1, Math.round(96 * img.height / img.width));
      g.drawImage(img, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height).data; let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      res.push(sum / (px.length / 4) / 255);
    }
    return res;
  }, frames.map(f => f.data));
  await page.close();
  return out;
}

// Open the switched-on link once (the browser now knows it), then refresh it while recording.
async function recordRefresh(browser, origin, opt) {
  const t = await fx.openClient(browser, origin, Object.assign({ flags: 'on', flagDelay: 400 }, opt));
  await fx.waitNew(t);
  await fx.sleep(1200);
  await t.page.addInitScript(FRAME_LOG);
  const cdp = await t.ctx.newCDPSession(t.page);
  const frames = [];
  cdp.on('Page.screencastFrame', async f => { frames.push({ data: f.data, at: Date.now() }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {} });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 480 });
  await fx.sleep(250);
  const skip = frames.length; // frames of the page before the refresh
  await t.page.reload({ waitUntil: 'domcontentloaded' });
  await fx.waitNew(t);
  await fx.sleep(1200);
  await cdp.send('Page.stopScreencast');
  const log = await t.page.evaluate(() => window.__fpLog || []);
  const after = frames.slice(Math.max(0, skip - 1));
  const lum = await brightness(browser, after);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    after.forEach((f, i) => fs.writeFileSync(path.join(SHOTS, opt.name + '-' + String(i).padStart(3, '0') + '-' + (f.at - after[0].at) + 'ms.png'), Buffer.from(f.data, 'base64')));
  }
  return { t, lum, log };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- the two copies of the review-shaped loading screen stay equal ----------
    {
      const norm = s => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();
      const shell = fs.readFileSync(path.join(__dirname, '..', 'src/index/030-body-shell.html.part'), 'utf8');
      const a = shell.indexOf('<div class="sv-rs-boot"');
      const end = shell.indexOf('</div>\n        </div>\n        <div class="boot-skeleton-variant boot-skeleton-client-profile">', a);
      const staticCopy = norm(shell.slice(a, end));
      // The script's copy, from its own builder in 133.
      const src = fs.readFileSync(path.join(__dirname, '..', 'src/index/133-core-loading-skeletons.js.part'), 'utf8');
      const fn = new Function(src.slice(src.indexOf('function _svSkel('), src.indexOf('function _svTableSkeletonHtml'))
        + src.slice(src.indexOf('function _svRsBootSkeletonHtml'), src.indexOf('function _svClientVerifySkeletonHtml')) + 'return _svRsBootSkeletonHtml();');
      const built = norm(fn());
      expect(staticCopy.length > 500 && built === staticCopy, 'the first markup and the script draw the same review-shaped loading screen');
    }

    // ---------- dark saved, switch on: dark from the first frame, never the old page ----------
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const name = 'dark-' + w;
      console.log('--- refresh, dark saved, ' + w + 'x' + h + ' ---');
      const r = await recordRefresh(browser, origin, { dark: true, width: w, height: h, name });
      const bright = r.lum.map((l, i) => [i, l]).filter(([, l]) => l > 0.4);
      expect(r.lum.length >= 3, name + ': frames were recorded (' + r.lum.length + ')');
      expect(!bright.length, name + ': no white flash (frames brighter than 0.4: ' + bright.map(([i, l]) => i + '=' + l.toFixed(2)).join(', ') + ')');
      expect(r.log.length && r.log.every(f => f.dark), name + ': the page is dark on every frame from the first script on');
      expect(!r.log.some(f => f.oldShown), name + ': the old review list never shows before the new page');
      expect(r.log.some(f => f.veil), name + ': the review-shaped loading screen shows while the page loads');
      expect(!(await r.t.page.locator('#svRsBootVeil').count()), name + ': the loading screen is gone once the page has drawn');
      await r.t.ctx.close();
    }

    // ---------- light saved, switch on: no dark frame ----------
    {
      console.log('--- refresh, light saved, 1440x900 ---');
      const r = await recordRefresh(browser, origin, { dark: false, name: 'light-1440' });
      const dim = r.lum.map((l, i) => [i, l]).filter(([, l]) => l < 0.6);
      expect(!dim.length, 'light: no dark flash (frames darker than 0.6: ' + dim.map(([i, l]) => i + '=' + l.toFixed(2)).join(', ') + ')');
      expect(!r.log.some(f => f.oldShown), 'light: the old review list never shows before the new page');
      await r.t.ctx.close();
    }

    // ---------- the switch was turned off since the last visit ----------
    {
      console.log('--- refresh, dark saved, switch now off ---');
      const t = await fx.openClient(browser, origin, { flags: 'on', dark: true });
      await fx.waitNew(t);
      await fx.sleep(800);
      expect(await t.page.evaluate(() => (localStorage.getItem('syncview_rs_paint_v1') || '').length > 2), 'off: the switched-on link was remembered for the next visit');
      await t.ctx.close();
      // A second context with the same storage, the switch now off.
      const t2 = await fx.open(browser, origin, { stage: 'client', flags: 'off', dark: true });
      await t2.page.addInitScript(c => { try { localStorage.setItem('syncview_rs_paint_v1', JSON.stringify([c])); } catch (e) {} }, fx.CLIENT.toLowerCase());
      await t2.page.goto(origin + '/index.html?' + new URLSearchParams({ c: fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
      expect(await t2.page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'), 'off: the remembered link paints dark at first');
      await t2.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await fx.sleep(800);
      const end = await t2.page.evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme') || 'light',
        hint: localStorage.getItem('syncview_rs_paint_v1'),
        veil: !!document.getElementById('svRsBootVeil'),
        paint: document.documentElement.classList.contains('sv-rs-paint'),
      }));
      expect(end.theme === 'light', 'off: the page goes back to light (' + end.theme + ')');
      expect(!end.hint, 'off: the link is forgotten (' + end.hint + ')');
      expect(!end.veil && !end.paint, 'off: no loading layer or hint is left on the old page');
      expect(await t2.page.locator('#calView').isVisible(), 'off: the old review list shows');
      expect(t2.errors.length === 0, 'off: no page errors (' + t2.errors.join(' | ') + ')');
      await t2.ctx.close();
    }

    // ---------- a link never seen switched on stays light, even with dark saved ----------
    {
      console.log('--- first visit, dark saved, switch off ---');
      const t = await fx.open(browser, origin, { stage: 'client', flags: 'off', dark: true });
      await t.page.addInitScript(FRAME_LOG);
      await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
      await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
      await fx.sleep(600);
      const log = await t.page.evaluate(() => window.__fpLog || []);
      expect(log.length && log.every(f => !f.dark), 'never seen: light on every frame');
      expect(!log.some(f => f.veil), 'never seen: no review-shaped loading screen');
      await t.ctx.close();
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nfirst-paint-theme-browser: all passed');
})();
