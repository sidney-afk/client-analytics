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
 * Session Dawn, 2026-10-18 ("the loading screen still looks horrible, even on mobile"), measured frame by frame on the
 * live site, adds what the first visit and the loading screen's looks did wrong:
 *   - a FIRST visit (nothing remembered) showed four different screens before the page: the small check card, the OLD
 *     calendar's loader, the old list of posts, a blank. It now draws the review page's shape from the first frame, in
 *     light, and never the check card, the old loader or the old list; a switch that reads off takes the shape away;
 *   - the placeholders were the page's own colour in light (contrast 1.0), so the screen looked empty: they are now
 *     measurably darker than what they sit on, in light and dark;
 *   - a client whose last page had nothing waiting saw a video and buttons that page never has: the next visit draws
 *     that page's shape (a short line and one card), which this browser remembers per link;
 *   - the page's code was fetched only after the switch answer: it now starts beside the link check.
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
const IN_PAGE = ({ pairs, tones }) => {
  window.__fpLog = [];
  window.__boot = null;
  window.__tone = null;
  const box = e => { const b = e.getBoundingClientRect(); return [b.x, b.y, b.width, b.height].map(Math.round); };
  const tick = () => {
    try {
      const de = document.documentElement;
      const cal = document.querySelector('#calView .kcard, #calView [data-cal-review-pid]');
      const oldShown = !!cal && cal.offsetParent !== null && !document.getElementById('svRsBootVeil') && !de.classList.contains('sv-rs-full');
      const b = Array.from(document.querySelectorAll('.sv-rs-boot')).find(x => x.getBoundingClientRect().height > 0 && getComputedStyle(x).display !== 'none');
      const chk = document.querySelector('.client-link-verify-card');
      const host = document.getElementById('svReviewStage'); const sr = host && host.shadowRoot; const app = sr && sr.getElementById('rsApp');
      const page = !!(host && host.offsetHeight && app && app.offsetHeight && ((sr.getElementById('stepper') && sr.getElementById('stepper').children.length) || sr.querySelector('.rc-card')));
      window.__fpLog.push({ dark: de.getAttribute('data-theme') === 'dark', veil: !!document.getElementById('svRsBootVeil'), oldShown,
        check: !!chk && chk.getBoundingClientRect().height > 0 && getComputedStyle(chk).display !== 'none', boot: !!b, page, empty: de.classList.contains('sv-rs-paint-empty') });
      if (b) {
        const o = {};
        for (const [k, sel] of pairs) { const q = b.querySelector(sel); if (q) o[k] = box(q); }
        if (Object.keys(o).length > 8) window.__boot = o;
        // How far each placeholder's colour is from what it sits on (WCAG contrast ratio), sampled once.
        if (!window.__tone) {
          const lum = c => { const m = String(c).match(/[\d.]+/g).map(Number); const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
          const back = e => { for (let q = e.parentElement; q; q = q.parentElement) { const bg = getComputedStyle(q).backgroundColor; const a = (bg.match(/[\d.]+/g) || []).map(Number); if (a.length >= 3 && (a.length === 3 || a[3] > 0.9)) return bg; } return 'rgb(255, 255, 255)'; };
          const t = {}; let n = 0;
          for (const [k, sel] of tones) { const q = b.querySelector(sel); if (!q || q.getBoundingClientRect().height <= 0) continue; const x = lum(getComputedStyle(q).backgroundColor), y = lum(back(q)); t[k] = Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; n++; }
          if (n === tones.length) window.__tone = t;
        }
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
// The page a client sees when nothing is waiting (a short line and one centred card), and the loading screen drawn for
// it once this browser remembers that (html.sv-rs-paint-empty).
const EMPTY_PAIRS = [['ecard', '.sv-rs-boot-ecard', '#recap .rc-card'], ['eicon', '.sv-rs-boot-eico', '#recap .rc-card .ei']];
const EMPTY_BARS = [['count', '.sv-rs-boot-count', '#skHead']];
const COMMON = ['help', 'tabs', 'theme'];
const TOL = 6;
// Placeholders that sit on the page's own background, and on a card. A bar must read as a bar: at least this far
// from what it sits on (the old loading screen drew them in the page's own colour, ratio 1.0, in light).
const TONES = [['name', '.sv-rs-boot-who > :first-child'], ['count', '.sv-rs-boot-count'], ['title', '.sv-rs-boot-main > .sv-skeleton-line'], ['step', '.sv-rs-boot-s1'], ['video', '.sv-rs-boot-video'], ['answer', '.sv-rs-boot-a1']];
const TONES_EMPTY = [['name', '.sv-rs-boot-who > :first-child'], ['count', '.sv-rs-boot-count'], ['icon', '.sv-rs-boot-eico'], ['line', '.sv-rs-boot-ep > :first-child']];
const MIN_TONE = 1.08;

// One visit, recorded frame by frame from the commit of the link's page. The page before it is a same-origin page, as a
// person's tab usually is, so the browser keeps showing it until the link paints (the way a refresh or a link followed
// inside the app does) instead of a bare white frame the page does not own.
async function visit(browser, origin, opt, after) {
  // The saved theme is seeded once below (not by the fixture, which sets it again on every load and would undo the button).
  const t = await fx.open(browser, origin, Object.assign({ stage: 'client', flags: 'on', flagDelay: 500, help: HELP }, opt, { dark: false }));
  if (opt.empty) t.state.cards.length = 0;
  const seed = Object.assign({}, opt.seed || {}, opt.dark ? { syncview_theme: 'dark' } : {});
  await t.page.addInitScript(s => { try { if (sessionStorage.getItem('__fpSeeded')) return; sessionStorage.setItem('__fpSeeded', '1'); for (const k in s) localStorage.setItem(k, s[k]); } catch (e) {} }, seed);
  await t.page.addInitScript(IN_PAGE, { pairs: PAIRS.concat(BARS, EMPTY_PAIRS).map(p => [p[0], p[1]]), tones: opt && opt.empty ? TONES_EMPTY : TONES });
  await t.page.goto(origin + '/404.html', { waitUntil: 'load' });
  const cdp = await t.ctx.newCDPSession(t.page);
  const frames = [];
  let from = 1e18;
  t.page.on('framenavigated', f => { if (f === t.page.mainFrame() && /index\.html/.test(f.url()) && from === 1e18) from = Date.now() / 1000; });
  cdp.on('Page.screencastFrame', async f => { if (f.metadata.timestamp >= from) frames.push({ data: f.data, at: Math.round((f.metadata.timestamp - from) * 1000) }); try { await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }); } catch (e) {} });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 480 });
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: opt.c || fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
  if (opt.expect === 'old') await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
  else if (opt.empty) await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.rc-card')); }, null, { timeout: 30000 });
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
// The first frame that shows anything (the very first animation frame can come before the body is parsed).
const firstShown = log => log.find(f => f.boot || f.check || f.oldShown || f.page) || null;
const bright = lum => lum.map((l, i) => [i, l]).filter(([, l]) => l > 0.4).map(([i, l]) => i + '=' + l.toFixed(2)).join(', ');
const dim = lum => lum.map((l, i) => [i, l]).filter(([, l]) => l < 0.6).map(([i, l]) => i + '=' + l.toFixed(2)).join(', ');

// The loading screen's boxes against the loaded page's, once the page has drawn.
async function shapeOf(browser, origin, dark, w, h, empty) {
  const t = await fx.open(browser, origin, { stage: 'client', flags: 'on', flagDelay: 1500, help: HELP, width: w, height: h });
  if (empty) t.state.cards.length = 0;
  await t.page.addInitScript(([d, c, hint, e]) => { try { if (d) localStorage.setItem('syncview_theme', 'dark'); localStorage.setItem('syncview_rs_paint_v1', c); localStorage.setItem('sv-rs-on-clients', hint); if (e) localStorage.setItem('syncview_rs_empty_v1', c); } catch (err) {} }, [dark, PAINT, HINT(true), !!empty]);
  await t.page.addInitScript(IN_PAGE, { pairs: PAIRS.concat(BARS, EMPTY_PAIRS, EMPTY_BARS).map(p => [p[0], p[1]]), tones: empty ? TONES_EMPTY : TONES });
  await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
  if (empty) await t.page.waitForFunction(() => { const hh = document.getElementById('svReviewStage'); return !!(hh && hh.shadowRoot && hh.shadowRoot.querySelector('.rc-card')); }, null, { timeout: 30000 });
  else await fx.waitNew(t);
  await fx.sleep(1800);
  const boot = await t.page.evaluate(() => window.__boot);
  const tone = await t.page.evaluate(() => window.__tone);
  const loaded = await t.page.evaluate(pairs => {
    const sr = document.getElementById('svReviewStage').shadowRoot; const o = {};
    for (const [k, , sel] of pairs) { const e = sr.querySelector(sel); if (e) { const b = e.getBoundingClientRect(); o[k] = [b.x, b.y, b.width, b.height].map(Math.round); } }
    return o;
  }, PAIRS.concat(BARS, EMPTY_PAIRS, EMPTY_BARS));
  await t.ctx.close();
  return { boot, loaded, tone };
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

    // ---------- a FIRST visit: nothing remembered, one screen from the first frame to the page ----------
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const name = 'first-' + w;
      console.log('--- a first visit, nothing remembered, ' + w + 'x' + h + ' ---');
      const r = await visit(browser, origin, { width: w, height: h, name, flagDelay: 1800 });
      expect(!!firstShown(r.log) && firstShown(r.log).boot, name + ': the review page\'s shape is the first thing on screen (' + JSON.stringify(firstShown(r.log)) + ')');
      expect(!r.log.some(f => f.check), name + ': the small check card never shows');
      expect(!r.log.some(f => f.oldShown), name + ': the old calendar\'s loader and list never show');
      const from = r.log.findIndex(f => f.boot);
      const gap = r.log.slice(Math.max(from, 0)).filter(f => !f.boot && !f.page);
      expect(from >= 0 && !gap.length, name + ': no blank frame between the loading screen and the page (' + gap.length + ' blank frames)');
      expect(r.log.length && r.log.every(f => !f.dark), name + ': light on every frame (nothing says this browser is dark)');
      expect(!dim(r.lum), name + ': no dark frame (' + dim(r.lum) + ')');
      expect(r.log[r.log.length - 1].page && !r.log[r.log.length - 1].boot, name + ': it ends on the page, with the loading screen gone');
      await r.t.ctx.close();
    }
    {
      console.log('--- a first visit, dark saved but no list names the link: the shape from the first frame, light until the switch is read ---');
      const r = await visit(browser, origin, { dark: true, width: 390, height: 844, name: 'first-dark-guess', flagDelay: 1500 });
      expect(!!firstShown(r.log) && firstShown(r.log).boot && !firstShown(r.log).dark, 'guess: the shape is the first thing on screen, in light (a guess never grants the saved theme)');
      const lightFrames = r.log.filter(f => f.boot && !f.dark).length, last = r.log[r.log.length - 1];
      expect(lightFrames > 0 && last.dark && last.page, 'guess: once the switch is read on, the saved dark theme applies (' + lightFrames + ' light loading frames, then dark)');
      expect(await r.t.page.evaluate(() => localStorage.getItem('syncview_theme') === 'dark' && !document.documentElement.classList.contains('sv-rs-paint-guess')), 'guess: the saved theme is untouched and the guess is dropped once the switch is read on');
      await r.t.ctx.close();
    }
    {
      console.log('--- a first visit, and the switch reads OFF: the guess is taken away, the old page shows, the next visit does not guess ---');
      const r = await visit(browser, origin, { flags: 'off', expect: 'old', width: 390, height: 844, name: 'guess-off', flagDelay: 800 }, async (t, cdp, frames, mark) => {
        const end = await t.page.evaluate(() => { const de = document.documentElement; return { paint: Array.from(de.classList).filter(c => c.indexOf('sv-rs-paint') === 0), veil: !!document.getElementById('svRsBootVeil'), dark: de.getAttribute('data-theme') === 'dark', list: localStorage.getItem('sv-rs-on-clients'), memory: localStorage.getItem('syncview_rs_paint_v1') }; });
        expect(!end.paint.length && !end.veil && !end.dark, 'off: no guess class, no loading layer and light once the old page shows (' + JSON.stringify({ paint: end.paint, veil: end.veil, dark: end.dark }) + ')');
        expect(!!end.list && !end.memory, 'off: the answer is kept (the list is written) and the link is not remembered as on');
        mark();
        await t.page.reload({ waitUntil: 'domcontentloaded' });
        await t.page.locator('.kcard[data-cal-review-pid="rs1"]').waitFor({ timeout: 30000 });
        await fx.sleep(500);
        const again = await t.page.evaluate(() => window.__fpLog.slice());
        expect(again.length && !again.some(f => f.boot || f.veil) && again.every(f => !f.dark), 'off: the next visit draws no review shape (the browser now knows), light on every frame');
      });
      await r.t.ctx.close();
    }
    {
      console.log('--- the page\'s code is fetched beside the link check, not after the switch answer ---');
      for (const known of [false, true]) {
        const t = await fx.open(browser, origin, { stage: 'client', flags: 'on', flagDelay: 2500, help: HELP, width: 390, height: 844 });
        if (known) await t.page.addInitScript(([c, hint]) => { try { localStorage.setItem('syncview_rs_paint_v1', c); localStorage.setItem('sv-rs-on-clients', hint); } catch (e) {} }, [PAINT, HINT(true)]);
        let codeAt = 0, answerAt = 0;
        t.page.on('request', r => { if (!codeAt && /reviewstage/.test(r.url())) codeAt = Date.now(); });
        t.page.on('response', r => { if (!answerAt && /syncview_runtime_flags/.test(r.url()) && /review_stage_client_pages/.test(decodeURIComponent(r.url()))) answerAt = Date.now(); });
        await t.page.goto(origin + '/index.html?' + new URLSearchParams({ c: fx.CLIENT, v: 'calendar', t: fx.TOKEN }), { waitUntil: 'domcontentloaded' });
        await fx.waitNew(t);
        const tag = known ? 'remembered link' : 'first visit';
        expect(!!codeAt && !!answerAt && codeAt < answerAt - 800, tag + ': the page\'s code is asked for ' + (answerAt - codeAt) + ' ms before the switch answer lands (at least 800)');
        await t.ctx.close();
      }
    }

    // ---------- a client with nothing waiting: the loading screen is that page's shape ----------
    {
      console.log('--- nothing waiting: remembered, and the next visit draws that page\'s shape ---');
      const r = await visit(browser, origin, { empty: true, width: 390, height: 844, name: 'empty-390', flagDelay: 1200 }, async (t, cdp, frames, mark) => {
        const mem = await t.page.evaluate(() => localStorage.getItem('syncview_rs_empty_v1'));
        expect(!!mem && JSON.parse(mem).indexOf(fx.CLIENT.toLowerCase()) >= 0, 'empty: the page that had nothing waiting is remembered for this link (' + mem + ')');
        const first = await t.page.evaluate(() => window.__fpLog.find(f => f.boot || f.check || f.oldShown || f.page) || null);
        expect(first && first.boot && !first.empty, 'empty: the first visit could not know, so it drew the usual shape');
        mark();
        await t.page.reload({ waitUntil: 'domcontentloaded' });
        await t.page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); return !!(h && h.shadowRoot && h.shadowRoot.querySelector('.rc-card')); }, null, { timeout: 30000 });
        await fx.sleep(600);
        const log = await t.page.evaluate(() => window.__fpLog.slice());
        expect(!!firstShown(log) && firstShown(log).boot && firstShown(log).empty, 'empty: the next visit draws the nothing-waiting shape as its first frame');
        expect(!log.some(f => f.check || f.oldShown), 'empty: no check card, no old loader');
        const gap = log.slice(Math.max(log.findIndex(f => f.boot), 0)).filter(f => !f.boot && !f.page);
        expect(!gap.length, 'empty: no blank frame between the loading screen and the page (' + gap.length + ')');
      });
      await r.t.ctx.close();
    }
    {
      console.log('--- the last page had nothing waiting but posts have come: the memory is dropped once they show ---');
      const r = await visit(browser, origin, { width: 390, height: 844, name: 'empty-gone', flagDelay: 600, seed: { syncview_rs_paint_v1: PAINT, 'sv-rs-on-clients': HINT(true), syncview_rs_empty_v1: PAINT } });
      expect(!!firstShown(r.log) && firstShown(r.log).boot && firstShown(r.log).empty, 'gone: the remembered empty shape shows first (it could not know)');
      expect(await r.t.page.evaluate(() => localStorage.getItem('syncview_rs_empty_v1') === null), 'gone: once the posts show, the link is no longer remembered as empty');
      await r.t.ctx.close();
    }

    // ---------- the loading screen has the page's shape, and its placeholders can be seen ----------
    for (const empty of [false, true]) {
      for (const dark of [true, false]) {
        for (const [w, h] of [[1440, 900], [430, 932], [390, 844]]) {
          if (empty && w === 430 && !dark) continue;
          const tag = (empty ? 'nothing waiting, ' : '') + (dark ? 'dark ' : 'light ') + w;
          console.log('--- shape, ' + tag + ' ---');
          const { boot, loaded, tone } = await shapeOf(browser, origin, dark, w, h, empty);
          expect(!!boot, tag + ': the loading screen was on screen');
          const pairs = empty ? PAIRS.filter(p => COMMON.includes(p[0])).concat(EMPTY_PAIRS) : PAIRS;
          const bars = empty ? BARS.slice(0, 1).concat(EMPTY_BARS) : BARS;
          for (const [k] of pairs) {
            const a = boot && boot[k], b = loaded[k];
            const close = a && b && a.every((v, i) => Math.abs(v - b[i]) <= TOL);
            expect(close, tag + ': the ' + k + ' placeholder sits where it lands, at its size (' + JSON.stringify(a) + ' then ' + JSON.stringify(b) + ')');
          }
          for (const [k] of bars) {
            const a = boot && boot[k], b = loaded[k];
            const close = a && b && Math.abs(a[0] - b[0]) <= TOL && Math.abs((a[1] + a[3] / 2) - (b[1] + b[3] / 2)) <= TOL;
            expect(close, tag + ': the ' + k + ' bar starts where the words do, on their line (' + JSON.stringify(a) + ' then ' + JSON.stringify(b) + ')');
          }
          for (const [k] of (empty ? TONES_EMPTY : TONES)) expect(tone && tone[k] >= MIN_TONE, tag + ': the ' + k + ' placeholder can be told from what it sits on (contrast ' + (tone && tone[k]) + ', at least ' + MIN_TONE + ')');
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
