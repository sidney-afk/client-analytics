'use strict';
/* entry-links-boot-browser.js -- every signed-out special entry link must reach
 * its own screen, in a real browser, fully offline.
 *
 * Why: on 2026-09-24 ?intake=1 (the videographer Submit link) hung on its
 * loading skeleton for everyone. Its boot called navTo('linear') before a
 * later fragment's top-level `let` had initialised (TikTok upload's
 * _tkMounted); the error was swallowed, and since #1551 the boot router
 * stands down after any navTo(), so nothing ever drew the form. Every unit
 * check passed. Fragments are being moved and turned into modules (phase C),
 * which changes exactly this load order, so this runs on every pull request.
 *
 * Every network request outside the local server is answered with an empty
 * success (or aborted), so this needs no backend, no key and no client data.
 * Each link must show its screen's own element within the cap; the boot
 * skeleton still showing, or a "[... ] mount failed" console error, is red.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = path.resolve(__dirname, '..', '..', '..');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let file = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    file = path.normalize(file).replace(/^([.][\\/])+/, '');
    const full = path.join(root, file);
    if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': mime[path.extname(full).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(full).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// name, URL (path + query + hash), the element that proves the screen drew.
const LINKS = [
  ['intake', '/index.html?intake=1', '#linearClientSearch'],
  ['onboarding', '/index.html?onboarding=1', '#obCard'],
  ['onboarding-ai', '/index.html?onboarding=ai', '#obCard'],
  ['smm-weekly', '/index.html#smm-weekly-report', '#smmWeeklyReportMount'],
];
const CAP_MS = 20000;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };

async function check(browser, origin, [name, url, selector]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(origin)) return route.continue();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (/\/rest\/v1\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' });
    if (/\/functions\/v1\/|\/webhook\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
    if (/docs\.google\.com/.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  const page = await ctx.newPage();
  const mountErrors = [];
  page.on('console', m => { if (m.type() === 'error' && /mount failed|before initiali[sz]ation/i.test(m.text())) mountErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => { if (/before initiali[sz]ation/i.test(e.message)) mountErrors.push(e.message.slice(0, 160)); });
  await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
  const drew = await page.waitForFunction(sel => {
    const skeleton = document.querySelector('.boot-skeleton-variant');
    if (skeleton && skeleton.offsetParent !== null) return false;
    const el = document.querySelector(sel);
    return !!(el && el.offsetParent !== null);
  }, selector, { timeout: CAP_MS }).then(() => true, () => false);
  await ctx.close();
  return { name, ok: drew && mountErrors.length === 0, drew, mountErrors };
}

(async () => {
  const server = await serve();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  let failed = 0;
  try {
    for (const link of LINKS) {
      const r = await check(browser, origin, link);
      if (!r.ok) failed++;
      console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}${r.drew ? '' : ' (screen never drew)'}${r.mountErrors.length ? ' mount errors: ' + r.mountErrors.join(' | ') : ''}`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failed ? `entry-links-boot-browser: ${failed} of ${LINKS.length} links failed` : `entry-links-boot-browser: all ${LINKS.length} links reached their screen`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('entry-links-boot-browser: harness error', e && e.message); process.exit(2); });
