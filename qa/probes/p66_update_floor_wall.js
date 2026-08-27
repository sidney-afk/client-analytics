'use strict';
// p66 — VERSION FLOOR / RELOAD WALL (Codex review on #1163: "exercise the new
// runtime-flag path in a browser harness"). The unit suite executes the verdict
// function; THIS runs the real IIFE in a real Chromium against every network
// edge the unit slice cannot reach: the HEAD poll, the runtime-flag fetch (well
// formed, malformed, and absent), the wall actually rendering, the Tab trap,
// and the one invariant that matters most — a CURRENT tab never sees the wall,
// however wrong the flag is.
//
// The nudge exits on loopback hosts by design, so this probe serves the app
// from a fictional https://syncview.qa origin entirely through route
// interception: the document, its HEAD polls, the flag read, and all backend
// noise are fulfilled from this file. page.clock drives the 5-minute poll and
// the 10-minute flag TTL without real waiting.
const fs = require('node:fs');
const path = require('node:path');
const Q = require('./lib.js');

const ROOT = path.resolve(__dirname, '..', '..');
const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  // Third-party tags would hit real CDNs from the fictional origin; strip by URL
  // (the boot harness learned the hard way not to pin attribute spelling).
  .replace(/^\s*<link\b[^>]*fonts\.googleapis\.com[^>]*>\s*$/gm, '')
  .replace(/^\s*<noscript><link\b[^>]*fonts\.googleapis\.com[^>]*><\/noscript>\s*$/gm, '')
  .replace(/^\s*<script\b[^>]*cdn\.jsdelivr\.net[^>]*><\/script>\s*$/gm, '');

const ORIGIN = 'https://syncview.qa';
const T0 = Date.parse('2026-08-27T12:00:00Z');
const HTTP = ms => new Date(ms).toUTCString();
const MIN = 60 * 1000;

(async () => {
  const S = Q.makeOk('P66 version-floor wall');
  const browser = await Q.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, ignoreHTTPSErrors: true });

  // Mutable per-scenario knobs, read by the routes below on every request.
  const phase = {
    docEtag: '"v1"', docLm: T0 - 24 * 60 * MIN,   // what the DOCUMENT is served as
    headEtag: '"v1"', headLm: T0 - 24 * 60 * MIN, // what the HEAD poll reports deployed
    flagBody: '[]',                                // the app_version_floor response
  };
  let flagFetches = 0;

  await ctx.route(ORIGIN + '/**', async route => {
    const req = route.request();
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      etag: req.method() === 'HEAD' ? phase.headEtag : phase.docEtag,
      'last-modified': HTTP(req.method() === 'HEAD' ? phase.headLm : phase.docLm),
    };
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers, body: '' });
    return route.fulfill({ status: 200, headers, body: INDEX });
  });
  /* Playwright consults routes NEWEST-FIRST, so the specific flag route must
   * be registered AFTER the generic supabase catch-all or it never sees the
   * request — found the expensive way, as zero observed flag fetches. */
  await ctx.route('**/webhook/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/*supabase.co/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/syncview_runtime_flags*', async route => {
    if (route.request().url().includes('app_version_floor')) {
      flagFetches++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: phase.flagBody });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  // fastForward returns when fake-clock timers have FIRED, not when their
  // fetch round-trips (real async, through the route handlers above) have
  // settled — so every jump is followed by a real-time breath.
  const settle = () => new Promise(r => setTimeout(r, 500));
  const tick = async (page, ms) => { await page.clock.fastForward(ms); await settle(); };
  const wallOn = page => page.evaluate(() => !!document.getElementById('svUpdateWall'));
  const barOn = page => page.evaluate(() => !!document.getElementById('svUpdateBar'));
  const openPage = async () => {
    const page = await ctx.newPage();
    await page.clock.install({ time: T0 });
    await page.goto(ORIGIN + '/?intake=1', { waitUntil: 'domcontentloaded' });
    await tick(page, 5000); // past the 4s baseline capture
    await settle();
    return page;
  };

  // ---- A. current tab: no UI at all --------------------------------------
  const page = await openPage();
  await tick(page, 6 * MIN);
  S.ok(!(await barOn(page)) && !(await wallOn(page)), 'a current tab shows neither banner nor wall');

  // ---- B. a deploy lands: banner, flag read begins ------------------------
  phase.headEtag = '"v2"'; phase.headLm = T0; // newer than the doc by a day
  await tick(page, 6 * MIN);
  S.ok(await barOn(page), 'a stale tab gets the polite banner first');
  S.ok(!(await wallOn(page)), 'and no wall inside the grace window');
  S.ok(flagFetches >= 1, 'the floor flag was actually fetched over the network (' + flagFetches + 'x)');

  // ---- C. malformed floor value: fail-safe to banner ----------------------
  phase.flagBody = '[{"value":{"at":"not a time"}}]';
  await tick(page, 12 * MIN); // past the 10-min flag TTL
  await tick(page, 6 * MIN);
  S.ok(!(await wallOn(page)), 'an unparseable floor never walls anyone');

  // ---- D. a real floor in the past: the wall, replacing the banner --------
  phase.flagBody = JSON.stringify([{ value: { at: new Date(T0 - 60 * MIN).toISOString() } }]);
  await tick(page, 12 * MIN); // one poll re-reads the flag…
  await tick(page, 6 * MIN);  // …the next poll acts on it
  S.ok(await wallOn(page), 'a passed floor walls the stale tab');
  S.ok(!(await barOn(page)), 'and the banner is gone — the wall replaces it, not stacks on it');

  // ---- E. no way out but Reload -------------------------------------------
  const wallShape = await page.evaluate(() => {
    const wall = document.getElementById('svUpdateWall');
    const buttons = wall ? wall.querySelectorAll('button') : [];
    return {
      buttons: buttons.length,
      label: buttons[0] ? buttons[0].textContent : '',
      dismiss: wall ? !!wall.querySelector('.sv-up-x') : true,
      focused: document.activeElement === buttons[0],
    };
  });
  S.ok(wallShape.buttons === 1 && /reload/i.test(wallShape.label) && !wallShape.dismiss,
    'the wall has exactly one button — Reload — and no dismiss control');
  S.ok(wallShape.focused, 'focus starts on the Reload button');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  S.ok(await page.evaluate(() => {
    const wall = document.getElementById('svUpdateWall');
    return wall && wall.contains(document.activeElement);
  }), 'Tab in either direction cannot walk focus out of the wall');
  await page.close();

  // ---- F. the invariant: a CURRENT tab is immune to any floor -------------
  phase.docEtag = '"v2"'; phase.docLm = T0; // this page loads the NEW build
  const current = await openPage();
  await tick(current, 20 * MIN);
  S.ok(!(await wallOn(current)) && !(await barOn(current)),
    'a current tab stays untouched even with a passed floor on the wire — a bad flag cannot lock out a healthy build');
  await current.close();

  // ---- G. unsaved work defers the wall to the banner ----------------------
  phase.docEtag = '"v1"'; phase.docLm = T0 - 24 * 60 * MIN; // stale build again
  const dirty = await openPage();
  const typed = await dirty.evaluate(() => {
    const el = Array.from(document.querySelectorAll('input[type="text"], input:not([type]), textarea'))
      .find(n => n.offsetWidth > 0 || n.offsetHeight > 0);
    if (!el) return false;
    el.focus(); el.value = 'half-written thought';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  S.ok(typed, 'a visible field exists to dirty (harness is not vacuous)');
  await tick(dirty, 12 * MIN);
  await tick(dirty, 6 * MIN);
  S.ok(!(await wallOn(dirty)), 'the wall waits while typed work is unsaved');
  S.ok(await barOn(dirty), 'but the banner stays up — deferred is never silent');
  await dirty.close();

  await browser.close();
  process.exit(S.done());
})().catch(e => { console.error('P66 FAILED:', e); process.exit(1); });
