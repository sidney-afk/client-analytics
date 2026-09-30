'use strict';
/* pages-site-browser.js -- every address the app answers still loads from the
 * allowlisted site folder, in a real browser, fully offline.
 *
 * The published site is now built from an allowlist (scripts/pages-site.js)
 * instead of being the whole repository. test/pages-site-allowlist.js proves
 * the bytes and statuses; this proves the pages actually BOOT from that folder:
 * the router stubs, the 404.html deep-link router, the onboarding forms, the
 * weekly report, client share links, and every js/ part and image the page asks
 * for. It serves the folder the way GitHub Pages does (clean paths resolve to
 * .html, anything else is 404.html with status 404).
 *
 *   node docs/syncview-design/tests/pages-site-browser.js [--site=<dir>] [--compare]
 *
 *   --site=<dir>  the built folder (default: build one in a temp folder)
 *   --compare     also run every case against the repository root, which is
 *                 what is live today, and require the same outcome from both
 *
 * Every request outside the local server is answered with an empty success or
 * aborted, so this needs no backend, no key and no client data. Addresses use
 * invented placeholder names only.
 *
 * A case passes when: the page boots past its skeleton; the address the visitor
 * sees is the one they asked for; every same-origin script, style, image, media
 * and data request answers below 400 (the one allowed 404 is the deep-link
 * document itself, which is how 404.html gets to route it); no mount or
 * "before initialisation" error is logged; and, where the case names one, its
 * screen's own element is on the page.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { seedStaffGate } = require('../../../qa/staff-gate-seed.js');
const site = require('../../../scripts/pages-site.js');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const SLUG = 'synthetic-slug';
const CARD = 'p_synthetic_1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS' };
const CAP_MS = 25000;

// [name, path+query+hash, options]
//   staff:    seed a signed-in staff identity (the page loads the staff parts)
//   screen:   selector proving the screen drew
//   keepPath: the address bar must end on the same path the visitor asked for
//   wantPath: the path the app is known to settle on instead (see the case)
//   parts:    minimum number of js/ parts that must have loaded
//   deepLink: the first document answers 404 by design (404.html routes it)
const CASES = [
  // A signed-in staff member opening the root is sent to Today by the app.
  ['staff home', '/', { staff: true, wantPath: '/today', parts: 5 }],
  ['staff today', '/today', { staff: true, keepPath: true, parts: 5 }],
  ['staff submit', '/submit', { staff: true, keepPath: true, parts: 5 }],
  ['staff workload', '/workload', { staff: true, keepPath: true, parts: 5 }],
  ['staff calendar', '/calendar', { staff: true, keepPath: true, parts: 5 }],
  ['staff templates', '/templates', { staff: true, keepPath: true, parts: 5 }],
  ['staff filming plans', '/filming-plans', { staff: true, keepPath: true, parts: 5 }],
  ['staff tiktok upload', '/tiktok-upload', { staff: true, keepPath: true, parts: 5 }],
  // Time off is behind the PTO flag, which reads as off in this offline run (every
  // backend read is empty), so the app sends the visitor home. Same as today.
  ['staff time off', '/time-off', { staff: true, wantPath: '/', parts: 5 }],
  ['staff sample reviews', '/sample-reviews', { staff: true, keepPath: true, parts: 5 }],
  ['staff kasper', '/kasper', { staff: true, keepPath: true, parts: 5 }],
  ['staff client credentials', '/client-credentials', { staff: true, keepPath: true, parts: 5 }],
  ['staff synclinear', '/synclinear', { staff: true, keepPath: true, parts: 5 }],
  ['staff onboarding admin', '/onboarding', { staff: true, keepPath: true, parts: 5 }],
  // The weekly report pages get the whole script as one file, by design.
  ['staff weekly reports', '/smm-weekly-reports', { staff: true, keepPath: true, parts: 1 }],
  ['deep link calendar card', '/calendar/' + SLUG + '/' + CARD, { staff: true, keepPath: true, deepLink: true, parts: 5 }],
  ['deep link synclinear card', '/synclinear/synthetic-id', { staff: true, keepPath: true, deepLink: true, parts: 5 }],
  ['deep link synclinear batch', '/synclinear/batch/synthetic-batch', { staff: true, keepPath: true, deepLink: true, parts: 5 }],
  ['deep link sample reviews', '/sample-reviews/' + SLUG, { staff: true, deepLink: true, parts: 5 }],
  ['unknown path goes home', '/unknown/path', { staff: true, deepLink: true, parts: 5 }],
  ['form intake', '/intake', { screen: '#linearClientSearch', keepPath: true }],
  ['form weekly report', '/smm-weekly-report', { screen: '#smmWeeklyReportMount', keepPath: true }],
  ['form onboarding', '/onboarding_form', { screen: '#obCard', keepPath: true, deepLink: true }],
  ['form onboarding (dash)', '/onboarding-form', { screen: '#obCard', deepLink: true }],
  ['form onboarding AI', '/ai_onboarding_form', { screen: '#obCard', keepPath: true, deepLink: true }],
  ['form onboarding AI (dash)', '/ai-onboarding-form', { screen: '#obCard', deepLink: true }],
  ['legacy intake link', '/?intake=1', { screen: '#linearClientSearch' }],
  ['legacy onboarding link', '/?onboarding=1', { screen: '#obCard' }],
  ['legacy onboarding AI link', '/?onboarding=ai', { screen: '#obCard' }],
  ['legacy weekly report link', '/index.html#smm-weekly-report', { screen: '#smmWeeklyReportMount' }],
  ['client link calendar', '/?c=' + SLUG + '&v=calendar&t=synthetic-token', { parts: 1 }],
  ['client link brief', '/?c=' + SLUG + '&v=brief&t=synthetic-token', { parts: 1 }],
];

// Addresses that must no longer answer with their repository file.
const GONE = ['/docs/STATE_OF_THINGS.md', '/CLAUDE.md', '/scripts/pages-site.js', '/migrations/2026-06-18-atomic-comment-merge.sql', '/supabase/config.toml'];

async function runCase(browser, origin, [name, url, opt]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith(origin)) return route.fallback();
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS, body: '' });
    if (/\/rest\/v1\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' });
    if (/\/functions\/v1\/|\/webhook\//.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '{}' });
    if (/docs\.google\.com/.test(u)) return route.fulfill({ status: 200, headers: CORS, contentType: 'text/csv', body: '' });
    return route.abort();
  });
  if (opt.staff) await seedStaffGate(ctx);
  const page = await ctx.newPage();
  const problems = [];
  const parts = new Set();
  let firstDocument = true;
  page.on('response', res => {
    const u = res.url();
    if (!u.startsWith(origin)) return;
    const status = res.status();
    const type = res.request().resourceType();
    const p = new URL(u).pathname;
    if (/^\/js\/sv-/.test(p) && status < 400) parts.add(p);
    if (type === 'document' && firstDocument) {
      firstDocument = false;
      if (status === 404 && opt.deepLink) return; // 404.html is the deep-link router
    }
    if (status >= 400) problems.push(status + ' ' + type + ' ' + p);
  });
  page.on('requestfailed', req => {
    if (!req.url().startsWith(origin)) return;
    const err = (req.failure() && req.failure().errorText) || '';
    if (/ERR_ABORTED/.test(err)) return; // range requests and navigations Chromium cancels itself
    problems.push('request failed ' + req.resourceType() + ' ' + new URL(req.url()).pathname + ' ' + err);
  });
  page.on('console', m => { if (m.type() === 'error' && /mount failed|before initiali[sz]ation/i.test(m.text())) problems.push('console: ' + m.text().slice(0, 140)); });
  page.on('pageerror', e => problems.push('page error: ' + String(e.message).slice(0, 140)));

  let booted = false;
  let screenDrew = !opt.screen;
  try {
    await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
    booted = await page.waitForFunction(() => {
      const skeleton = document.querySelector('.boot-skeleton-variant');
      if (skeleton && skeleton.offsetParent !== null) return false;
      return document.body && document.body.innerText !== undefined && location.search.indexOf('sv_path=') === -1;
    }, null, { timeout: CAP_MS }).then(() => true, () => false);
    if (opt.screen) {
      screenDrew = await page.waitForFunction(sel => {
        const el = document.querySelector(sel);
        return !!(el && el.offsetParent !== null);
      }, opt.screen, { timeout: CAP_MS }).then(() => true, () => false);
    }
    // let deferred parts (staff tabs load on demand) and images settle
    await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(600);
  } catch (e) {
    problems.push('navigation: ' + String(e.message).slice(0, 140));
  }
  const finalPath = new URL(page.url()).pathname;
  const wantPath = new URL(origin + url).pathname;
  if (opt.wantPath && finalPath !== opt.wantPath) problems.push('address bar ended on ' + finalPath + ', wanted ' + opt.wantPath);
  if (opt.keepPath && finalPath !== wantPath) problems.push('address bar ended on ' + finalPath + ', wanted ' + wantPath);
  if (!booted) problems.push('page never left its skeleton');
  if (!screenDrew) problems.push('screen ' + opt.screen + ' never drew');
  if ((opt.parts || 0) > parts.size) problems.push('only ' + parts.size + ' js/ parts loaded, wanted at least ' + opt.parts);
  // every image the page actually shows must have decoded
  const brokenImages = await page.evaluate(() => Array.from(document.images)
    .filter(i => i.src && i.complete && i.naturalWidth === 0 && i.offsetParent !== null)
    .map(i => new URL(i.src).pathname)).catch(() => []);
  for (const img of brokenImages) problems.push('image did not decode: ' + img);
  await ctx.close();
  return { name, ok: problems.length === 0, problems, parts: parts.size, finalPath };
}

async function runGone(browser, origin) {
  const ctx = await browser.newContext();
  const out = [];
  for (const p of GONE) {
    const res = await ctx.request.get(origin + p);
    out.push({ path: p, status: res.status(), isRouter: /GitHub Pages serves this file|sv_path/.test(await res.text()) });
  }
  await ctx.close();
  return out;
}

async function runAll(browser, dir, label) {
  const server = await site.pagesServer(dir);
  const origin = 'http://127.0.0.1:' + server.address().port;
  const results = [];
  try {
    for (const c of CASES) results.push(await runCase(browser, origin, c));
    const gone = await runGone(browser, origin);
    return { label, results, gone };
  } finally {
    server.close();
  }
}

(async () => {
  const arg = n => (process.argv.find(a => a.startsWith('--' + n + '=')) || '').split('=').slice(1).join('=');
  const compare = process.argv.includes('--compare');
  let siteDir = arg('site');
  let tmp = null;
  if (!siteDir) {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-site-browser-'));
    siteDir = path.join(tmp, 'site');
    site.build(siteDir);
  }
  const browser = await chromium.launch({ headless: true });
  let failed = 0;
  try {
    const runs = [await runAll(browser, path.resolve(siteDir), 'site folder')];
    if (compare) runs.push(await runAll(browser, site.ROOT, 'repository root (live today)'));
    const [main, control] = runs;
    console.log('pages-site-browser: ' + main.label);
    for (const r of main.results) {
      if (!r.ok) failed++;
      console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name.padEnd(28)} ${String(r.parts).padStart(2)} js parts  ends on ${r.finalPath}${r.ok ? '' : '  <- ' + r.problems.join(' | ')}`);
    }
    for (const g of main.gone) {
      const bad = g.status !== 404;
      if (bad) failed++;
      console.log(`${bad ? 'FAIL' : 'PASS'} gone ${g.path} -> ${g.status}${g.isRouter ? ' (answered by the 404.html router)' : ''}`);
    }
    if (control) {
      console.log('pages-site-browser: control run against ' + control.label);
      let differs = 0;
      control.results.forEach((c, i) => {
        const m = main.results[i];
        const same = c.ok === m.ok && c.finalPath === m.finalPath && c.parts === m.parts;
        if (!same) differs++;
        console.log(`${same ? 'SAME' : 'DIFF'} ${c.name.padEnd(28)} today: ${c.ok ? 'ok' : 'fail'} ${c.parts} parts ${c.finalPath}   site: ${m.ok ? 'ok' : 'fail'} ${m.parts} parts ${m.finalPath}`);
      });
      // the control must be able to see the difference: today these files are served
      for (const g of control.gone) console.log(`${g.status === 200 ? 'SAME' : 'NOTE'} today ${g.path} -> ${g.status}`);
      if (differs) { failed += differs; console.log('pages-site-browser: ' + differs + ' cases differ from today'); }
    }
  } finally {
    await browser.close();
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed
    ? 'pages-site-browser: ' + failed + ' failures'
    : 'pages-site-browser: all ' + CASES.length + ' addresses load from the site folder and ' + GONE.length + ' source addresses answer 404');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('pages-site-browser: harness error', e && e.stack || e); process.exit(2); });
