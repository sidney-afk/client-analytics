'use strict';
/*
 * A DARK USER NEVER SEES A WHITE FRAME ON THE CLIENT REVIEW LINK, AND THE LOADING SHAPE IS THE PAGE'S SHAPE
 * (owner report 2026-10-18, session Dusk: "if mine is dark themed, then the skeleton should be dark themed too. When I
 * open the client review, the skeleton is white, and not the shape of what loads").
 *
 * test/first-paint-theme-browser.js covers a refresh of a link this browser already remembers. This one covers the
 * ways a dark browser still saw white or the wrong shape. In a real browser, fully offline (the review page's own
 * fixture: fictional client, cards and token), every painted frame from the moment the page commits:
 *   - the first visit to a link whose client the browser's other list (sv-rs-on-clients, written by every switch read,
 *     staff pages too) names, spelled differently from any earlier link: dark from the first frame, at 1440 and 390;
 *   - a switch read that fails (HTTP 500, or the 4 s time-out) keeps what the browser remembered, so the NEXT visit is
 *     still dark (it used to forget the link, and that visit painted white);
 *   - the page's own sun/moon button: light saved, the next load is light on every frame; dark saved, dark on every
 *     frame;
 *   - the loading screen drawn before the page has the page's shape: tabs, the "?" button, the sun/moon button, the
 *     first post chip, the card, the video, the step buttons, both answer buttons and the conversation sit where
 *     they land, within a few pixels, light and dark, at 1440 and 390.
 * A link nothing is known about (no list names it) stays light until the switch is read: a client link stays light
 * when the new page is not switched on for it (owner rule), and the browser cannot tell before the read.
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
const HELP = 'https://example.test/start#review';
const HINT = help => JSON.stringify({ clients: [fx.SLUG], help });
const PAINT = JSON.stringify([fx.CLIENT.toLowerCase()]);

// In-page log of what each animation frame shows, and the loading screen's boxes while it is on screen.
const IN_PAGE = pairs => {
  window.__fpLog = [];
  window.__boot = null;
  const box = e => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
  const tick = () => {
    try {
      const de = document.documentElement;
      const cal = document.querySelector('#calView .kcard, #calView [data-cal-review-pid]');
      const oldShown = !!cal && cal.offsetParent !== null && !document.getElementById('svRsBootVeil') && !de.classList.contains('sv-rs-full');
      window.__fpLog.push({ dark: de.getAttribute('data-theme') === 'dark', veil: !!document.getElementById('svRsBootVeil'), oldShown });
      const b = Array.from(document.querySelectorAll('.sv-rs-boot')).find(x => x.getBoundingClientRect().height > 0 && getComputedStyle(x).display !== 'none');
      if (b) {
        const o = {};
        for (const [k, sel] of pairs) { const q = b.querySelector(sel); if (q) o[k] = box(q); }
        if (Object.keys(o).length > 8) window.__boot = o;
      }
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

const PAIRS = [
  ['help', '.sv-rs-boot-help', '#rsHelp'], ['tabs', '.sv-rs-boot-tabs', '#rsTabs'], ['theme', '.sv-rs-boot-round:last-child', '#rsTheme'],
  ['chip', '.sv-rs-boot-chip.is-cur', '#skList .chipp'], ['card', '.sv-rs-boot-card', '.card'], ['video', '.sv-rs-boot-video', '#fvHost .fv-player'],
  ['step1', '.sv-rs-boot-steps > :nth-child(1)', '#stepper li:nth-child(1) > *'], ['step2', '.sv-rs-boot-steps > :nth-child(2)', '#stepper li:nth-child(3) > *'],
  ['step3', '.sv-rs-boot-steps > :nth-child(3)', '#stepper li:nth-child(5) > *'],
  ['approve', '.sv-rs-boot-acts > :nth-child(1)', '#drow .dec > *:nth-child(1)'], ['ask', '.sv-rs-boot-acts > :nth-child(2)', '#drow .dec > *:nth-child(2)'],
  ['chat', '.sv-rs-boot-chat', '#chat'],
];
// Text bars: a bar cannot be as wide as the words it stands for, so they must start in the same place and sit on the
// same line (centre within the tolerance), not match in width.
const BARS = [['name', '.sv-rs-boot-who > :first-child', '#rsName'], ['title', '.sv-rs-boot-main > .sv-skeleton-line', '#side h2']];
const TOL = 6;

// One visit, recorded frame by frame from the commit of the link's page. The page before it is a same-origin page, as a
// person's tab usually is, so the browser keeps showing it until the link paints (the way a refresh or a link followed
// inside the app does) instead of a bare white frame the page does not own.
async function visit(browser, origin, opt, after) {
  // The saved theme is seeded once below (not by the fixture, which sets it again on every load and would undo the button).
  const t = await fx.open(browser, origin, Object.assign({ stage: 'client', flags: 'on', flagDelay: 500, help: HELP }, opt, { dark: false }));
  const seed = Object.assign({}, opt.seed || {}, opt.dark ? { syncview_theme: 'dark' } : {});
  await t.page.addInitScript(s => { try { if (sessionStorage.getItem('__fpSeeded')) return; sessionStorage.setItem('__fpSeeded', '1'); for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} }, seed);
  await t.page.addInitScript(IN_PAGE, PAIRS.concat(BARS).map(p => [p[0], p[1]]));
  await t.page.goto(origin + '/404.html', { waitUntil: 'load' });
  const cdp = await t.ctx.newCDPSession(t.page);
  const frames = [];
  let from = 1e18;
  t.page.on('framenavigated', f => { if (f === t.page.mainFrame() && /index\.html/.test(f.url()) && from === 1e18) from = Date.now() / 1000; });
  cdp.on('Page.screencastFrame', async f => { if (f.metadata.timestamp >= from) frames.push({ data: f.data, at: Math.round((f.metadata.timestamp - from) * 1000) }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {} });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 480 });
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: opt.c || fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
  if (opt.expect === 'old') await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
  else await fx.waitNew(t);
  await fx.sleep(1200);
  // A test that reloads asks to start again from the reload's own commit.
  if (after) await after(t, cdp, frames, () => { from = 1e18; });
  await cdp.send('Page.stopScreencast');
  const log = await t.page.evaluate(() => window.__fpLog || []);
  const lum = await brightness(browser, frames);
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    frames.forEach((f, i) => fs.writeFileSync(path.join(SHOTS, opt.name + '-' + String(i).padStart(3, '0') + '-' + f.at + 'ms.png'), Buffer.from(f.data, 'base64')));
  }
  return { t, lum, log, frames };
}
const bright = lum => lum.map((l, i) => [i, l]).filter(([, l]) => l > 0.4).map(([i, l]) => i + '=' + l.toFixed(2)).join(', ');
const dim = lum => lum.map((l, i) => [i, l]).filter(([, l]) => l < 0.6).map(([i, l]) => i + '=' + l.toFixed(2)).join(', ');

// The loading screen's boxes against the loaded page's, once the page has drawn.
async function shapeOf(browser, origin, dark, w, h) {
  const t = await fx.open(browser, origin, { stage: 'client', flags: 'on', flagDelay: 1500, help: HELP, width: w, height: h });
  await t.page.addInitScript(([d, c, hint]) => { try { if (d) localStorage.setItem('syncview_theme', 'dark'); localStorage.setItem('syncview_rs_paint_v1', c); localStorage.setItem('sv-rs-on-clients', hint); } catch (e) {} }, [dark, PAINT, HINT(true)]);
  await t.page.addInitScript(IN_PAGE, PAIRS.concat(BARS).map(p => [p[0], p[1]]));
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
  await fx.waitNew(t);
  await fx.sleep(1800);
  const boot = await t.page.evaluate(() => window.__boot);
  const loaded = await t.page.evaluate(pairs => {
    const sr = document.getElementById('svReviewStage').shadowRoot; const o = {};
    for (const [k, , sel] of pairs) { const e = sr.querySelector(sel); if (e) { const b = e.getBoundingClientRect(); o[k] = [b.x, b.y, b.width, b.height].map(Math.round); } }
    return o;
  }, PAIRS.concat(BARS));
  await t.ctx.close();
  return { boot, loaded };
}

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // ---------- a first visit, named only by the browser's other list, spelled another way ----------
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const name = 'hint-' + w;
      console.log('--- dark saved, only the staff/other list names the client, link spelled another way, ' + w + 'x' + h + ' ---');
      const r = await visit(browser, origin, { dark: true, width: w, height: h, name, c: 'fixture-studio', seed: { 'sv-rs-on-clients': HINT(true) } });
      expect(r.lum.length >= 3, name + ': frames were recorded (' + r.lum.length + ')');
      expect(!bright(r.lum), name + ': no white frame (brighter than 0.4: ' + bright(r.lum) + ')');
      expect(r.log.length && r.log.every(f => f.dark), name + ': the page is dark on every frame from the first script on');
      expect(r.log.some(f => f.veil), name + ': the review-shaped loading screen shows while the page loads');
      expect(!r.log.some(f => f.oldShown), name + ': the old review list never shows before the new page');
      expect(await r.t.page.evaluate(() => localStorage.getItem('syncview_theme') === 'dark'), name + ': the saved theme is still dark');
      await r.t.ctx.close();
    }
    {
      console.log('--- every client is on (the other list says all) ---');
      const r = await visit(browser, origin, { dark: true, name: 'hint-all', seed: { 'sv-rs-on-clients': JSON.stringify({ all: true }) } });
      expect(!bright(r.lum) && r.log.every(f => f.dark), 'all: dark on every frame (' + bright(r.lum) + ')');
      await r.t.ctx.close();
    }

    // ---------- the other list names a different client: the link stays light ----------
    {
      console.log('--- the other list names another client ---');
      const r = await visit(browser, origin, { dark: true, flags: 'off', expect: 'old', name: 'hint-other', seed: { 'sv-rs-on-clients': JSON.stringify({ clients: ['someoneelse'] }) } });
      expect(r.log.length && r.log.every(f => !f.dark), 'other: light on every frame (a link nothing names stays light)');
      expect(!r.log.some(f => f.veil), 'other: no review-shaped loading screen');
      await r.t.ctx.close();
    }

    // ---------- a switch read that fails keeps what the browser remembered ----------
    {
      console.log('--- the switch read fails (HTTP 500) on a remembered link ---');
      const r = await visit(browser, origin, { dark: true, flags: 'unreadable', expect: 'old', name: 'failed-read', seed: { syncview_rs_paint_v1: PAINT, 'sv-rs-on-clients': HINT(true) } });
      const end = await r.t.page.evaluate(() => ({ memory: localStorage.getItem('syncview_rs_paint_v1'), other: localStorage.getItem('sv-rs-on-clients'), theme: localStorage.getItem('syncview_theme'), paint: document.documentElement.classList.contains('sv-rs-paint'), veil: !!document.getElementById('svRsBootVeil'), shown: document.documentElement.getAttribute('data-theme') || 'light' }));
      expect(end.memory === PAINT, 'failed read: the remembered link is still remembered (' + end.memory + ')');
      expect(!!end.other && end.theme === 'dark', 'failed read: the other list and the saved theme are untouched');
      expect(!end.paint && !end.veil && end.shown === 'light', 'failed read: this visit still ends on the old page in light, with no loading layer left (' + JSON.stringify({ paint: end.paint, veil: end.veil, shown: end.shown }) + ')');
      await r.t.ctx.close();
    }

    // ---------- the page's own sun/moon button ----------
    {
      console.log('--- sun/moon button, then a reload each time ---');
      let toLight, toDark;
      const r = await visit(browser, origin, { dark: true, name: 'toggle', seed: { syncview_rs_paint_v1: PAINT } }, async (t, cdp, frames, mark) => {
        const sr = () => t.page.locator('#svReviewStage').locator('#rsTheme');
        await sr().click();
        await fx.sleep(300);
        const saved = await t.page.evaluate(() => localStorage.getItem('syncview_theme'));
        expect(saved === null, 'toggle: light is saved by removing the key (' + saved + ')');
        frames.length = 0; mark();
        await t.page.reload({ waitUntil: 'domcontentloaded' });
        await fx.waitNew(t); await fx.sleep(1000);
        toLight = frames.slice(); toLight.log = await t.page.evaluate(() => window.__fpLog.slice());
        await sr().click();
        await fx.sleep(300);
        expect(await t.page.evaluate(() => localStorage.getItem('syncview_theme')) === 'dark', 'toggle: dark is saved again');
        frames.length = 0; mark();
        await t.page.reload({ waitUntil: 'domcontentloaded' });
        await fx.waitNew(t); await fx.sleep(1000);
        toDark = frames.slice(); toDark.log = await t.page.evaluate(() => window.__fpLog.slice());
      });
      const lightLum = await brightness(browser, toLight), darkLum = await brightness(browser, toDark);
      expect(lightLum.length >= 3 && !dim(lightLum), 'toggle: after choosing light, no dark frame on the next load (' + dim(lightLum) + ')');
      expect(toLight.log.length && toLight.log.every(f => !f.dark), 'toggle: after choosing light, the page is light on every frame');
      expect(darkLum.length >= 3 && !bright(darkLum), 'toggle: after choosing dark again, no white frame on the next load (' + bright(darkLum) + ')');
      expect(toDark.log.length && toDark.log.every(f => f.dark), 'toggle: after choosing dark again, the page is dark on every frame');
      await r.t.ctx.close();
    }

    // ---------- the loading screen has the page's shape ----------
    for (const dark of [true, false]) {
      for (const [w, h] of [[1440, 900], [390, 844]]) {
        const tag = (dark ? 'dark ' : 'light ') + w;
        console.log('--- shape, ' + tag + ' ---');
        const { boot, loaded } = await shapeOf(browser, origin, dark, w, h);
        expect(!!boot, tag + ': the loading screen was on screen');
        for (const [k] of PAIRS) {
          const a = boot && boot[k], b = loaded[k];
          const close = a && b && a.every((v, i) => Math.abs(v - b[i]) <= TOL);
          expect(close, tag + ': the ' + k + ' placeholder sits where it lands, at its size (' + JSON.stringify(a) + ' then ' + JSON.stringify(b) + ')');
        }
        for (const [k] of BARS) {
          const a = boot && boot[k], b = loaded[k];
          const close = a && b && Math.abs(a[0] - b[0]) <= TOL && Math.abs((a[1] + a[3] / 2) - (b[1] + b[3] / 2)) <= TOL;
          expect(close, tag + ': the ' + k + ' bar starts where the words do, on their line (' + JSON.stringify(a) + ' then ' + JSON.stringify(b) + ')');
        }
      }
    }
  } catch (e) {
    failures.push('crashed: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error('\n' + failures.length + ' failure(s)'); process.exit(1); }
  console.log('\nclient-link-dark-first-paint-browser: all passed');
})();
