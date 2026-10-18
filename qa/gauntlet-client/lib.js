// qa/gauntlet-client/lib.js: the client review link on the LIVE site, in a real
// Chromium, test client only (session Gauntlet Client, 2026-10-17).
//
// Reuses qa/test-client-entry.js for the link (the token never leaves this
// process: no URL, no token in any log line, error or file) and
// qa/sxr_courier_lib.js for seeding and reading cards. Unlike the courier
// harness this opens https://syncview.synchrosocial.com itself, through the
// sandbox proxy, so the page under test is the deployed build.
//
// Safety: every POST naming a client other than the test client is aborted and
// counted; api.linear.app and any linear-* function are aborted; nothing is
// mocked otherwise.
'use strict';
let PW; try { PW = require('playwright'); } catch { PW = require('/opt/node22/lib/node_modules/playwright'); }
const entry = require('../test-client-entry.js');
const L = require('../sxr_courier_lib.js');

const LIVE = process.env.GAUNTLET_ORIGIN || 'https://syncview.synchrosocial.com';
const TEST_SLUG = 'sidneylaruel';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  return PW.chromium.launch({ headless: true, args: ['--ignore-certificate-errors'], ...(proxy ? { proxy: { server: proxy } } : {}), env: entry.clientEntrySafeChildEnv() });
}

// A fresh browser context with the guards and a save log.
async function context(browser, o = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width || 1440, height: o.height || 900 }, ignoreHTTPSErrors: true,
    ...(o.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 3 } : {}) });
  ctx._log = []; ctx._violations = [];
  await ctx.addInitScript((theme) => {
    try { if (theme === 'dark') localStorage.setItem('syncview_theme', 'dark'); else if (theme === 'light') localStorage.setItem('syncview_theme', 'light'); } catch (e) {}
  }, o.theme || '');
  await ctx.route('**/*', async (route) => {
    const req = route.request(); const url = req.url();
    if (/api\.linear\.app|\/functions\/v1\/linear-|\/webhook\/linear-/.test(url)) { ctx._violations.push('linear'); return route.abort(); }
    if (req.method() === 'POST') {
      const body = req.postData() || '';
      const m = body.match(/"(?:client|client_slug|slug)"\s*:\s*"([^"]*)"/g) || [];
      const bad = m.map(s => s.split(':').pop().replace(/[\s"]/g, '').toLowerCase()).filter(v => v && v !== TEST_SLUG && v !== 'sidneylaruel' && v !== 'sidneylaruel');
      if (bad.length) { ctx._violations.push('other-client'); return route.abort(); }
    }
    if (o.delay && /supabase\.co/.test(url)) await sleep(o.delay);
    return route.fallback();
  });
  ctx.on('request', req => { if (req.method() === 'POST' && /\/functions\/v1\//.test(req.url())) { req._t0 = Date.now(); } });
  ctx.on('requestfinished', async req => {
    if (!req._t0) return;
    let status = 0; try { const r = await req.response(); status = r ? r.status() : 0; } catch {}
    ctx._log.push({ fn: new URL(req.url()).pathname.replace('/functions/v1/', ''), status, ms: Date.now() - req._t0, at: Date.now(), body: (req.postData() || '').slice(0, 4000) });
  });
  ctx.on('requestfailed', req => { if (req._t0) ctx._log.push({ fn: new URL(req.url()).pathname.replace('/functions/v1/', ''), status: -1, ms: Date.now() - req._t0, at: Date.now(), body: (req.postData() || '').slice(0, 4000) }); });
  return ctx;
}

function capture(page) {
  page._errs = [];
  page.on('pageerror', e => page._errs.push(String(e && e.message).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!/realtime|WebSocket|favicon|net::ERR_ABORTED|Failed to load resource/i.test(t)) page._errs.push(t.replace(/[?&]t=[^&\s]+/g, '').slice(0, 200)); } });
}

let _token = null;
async function token() { if (!_token) _token = await entry.currentTestClientToken(); return _token; }

// Open the client link (view: calendar | sample-reviews) on a new page in ctx.
async function openClient(ctx, o = {}) {
  const page = await ctx.newPage(); capture(page);
  const t0 = Date.now();
  await entry.gotoTestClientEntry(page, { origin: LIVE, view: o.view || 'calendar', name: entry.TEST_CLIENT.name, token: await token(), gotoOptions: { waitUntil: 'domcontentloaded', timeout: 60000 } });
  page._t0 = t0;
  return page;
}
// The new page's stage is drawn (stepper has steps) or the empty "All caught up" card.
async function waitStage(page, ms = 45000) {
  await page.waitForFunction(() => { const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; return !!(h && !h.hidden && r && ((r.getElementById('stepper') && r.getElementById('stepper').children.length) || r.querySelector('.rc-card'))); }, null, { timeout: ms });
  return Date.now() - (page._t0 || Date.now());
}
const S = (page, sel) => page.locator('#svReviewStage').locator(sel);
// Everything the client sees on the stage, as plain data.
function look(page) {
  return page.evaluate(() => {
    const h = document.getElementById('svReviewStage'); const r = h && h.shadowRoot; if (!r) return null;
    const q = s => r.querySelector(s); const t = s => (q(s) || {}).textContent || '';
    return {
      title: t('.sd-t h2').trim(), date: t('#sdate').trim(),
      steps: [...r.querySelectorAll('.stp')].map(b => (b.dataset.step || '') + ':' + [...b.classList].filter(c => c !== 'stp').join('.')),
      on: (q('.stp.on') || { dataset: {} }).dataset.step || '',
      dec: t('#dec').replace(/\s+/g, ' ').trim().slice(0, 160),
      flash: t('#flash').trim(), toast: t('#rsToast .tx').trim(),
      chips: r.querySelectorAll('.chipp').length, strip: t('#skHead').replace(/\s+/g, ' ').trim(),
      finish: q('#finishBtn') ? (q('#finishBtn').disabled ? 'off' : 'on') + ' ' + t('#finishBtn').trim() : '',
      empty: t('.rc-card h3').trim(), composer: !!q('#ta') && !!q('#cmpCancel'),
      theme: h.getAttribute('data-theme') || '', help: !!(q('#rsHelp') && q('#rsHelp').offsetParent),
    };
  });
}
// Read a card row back (service role, read only).
function row(id, cols) { try { const r = L.supaCal('id=eq.' + encodeURIComponent(id) + '&client=eq.' + TEST_SLUG + '&select=' + cols); return (Array.isArray(r) && r[0]) || null; } catch { return null; } }
async function pollRow(id, cols, pred, ms = 30000) { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { last = row(id, cols); if (last && pred(last)) return { row: last, ms: Date.now() - t0 }; await sleep(700); } return { row: last, ms: null }; }

module.exports = { PW, LIVE, TEST_SLUG, sleep, launch, context, openClient, waitStage, S, look, row, pollRow, upCal: L.upCal, archiveCalSafe: L.archiveCalSafe, supaCal: L.supaCal };
