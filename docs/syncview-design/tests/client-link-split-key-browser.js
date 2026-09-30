'use strict';
/* client-link-split-key-browser.js -- a client link may carry ?split=0 / ?split=1
 * (the per-browser way back from the split page) and still passes the real
 * client link check; nothing else got looser.
 *
 * Plan: docs/plans/2026-09-28-load-per-tab-plan.md, step 5. Found on the live
 * site after #1868: the check (SYNCVIEW_CLIENT_ENTRY_KEYS) refused every key
 * except c, t, v and sxr, so "&split=0" showed "This link isn't valid".
 *
 * Fully offline, on a synthetic client link (client-link-fixture.js: made-up
 * client, made-up token). The page runs its real entry check and its real
 * token preflight against a local stand-in for the verify function; this test
 * asserts, for the Calendar link, the Samples link and the Analytics link:
 *   - with &split=0 and with &split=1 the link is accepted (no "isn't valid"
 *     screen), the review card draws, and the verify request carries the same
 *     client and view as without the key;
 *   - the key is gone from the address once the page is up, and the rest of the
 *     link (c, t, v, sxr) is still there;
 *   - the way back still works: &split=0 loads the single file and sticks,
 *     &split=1 loads the parts again (only when the split page is built);
 *   - the check is not looser for anything else: &split=2, &split=, a repeated
 *     split, and other keys (alone or next to split) still show the invalid
 *     screen, and no verify request is sent for them.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { CORS, clientLinkCard, clientLinkRoute, clientLinkUrl } = require('./client-link-fixture');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const splitBuilt = html.includes('/* SyncView loader.');
const clientsOn = /var CLIENTS = true;/.test(html);
const forcedParts = /var FORCE = "parts";/.test(html);
const INVALID = /This link isn.t valid/;

async function open(browser, origin, surface, suffix, existing) {
  const context = existing || await browser.newContext();
  const verifies = [];
  const base = clientLinkRoute(surface);
  if (!existing) {
    await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), route => {
      const r = route.request();
      if (new URL(r.url()).pathname === '/functions/v1/client-token-verify') {
        let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
        verifies.push(body);
      }
      return base(route);
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + clientLinkUrl('', surface) + suffix, { waitUntil: 'domcontentloaded' });
  return { context, page, verifies, errors };
}
const bodyText = page => page.evaluate(() => document.body.innerText || '');

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    // 1. The two values pass the real check on every kind of client link.
    for (const surface of ['calendar', 'samples', 'analytics']) {
      let plainVerify = null;
      for (const suffix of ['', '&split=0', '&split=1']) {
        const label = `${surface} link${suffix ? ' ' + suffix : ''}`;
        const { context, page, verifies, errors } = await open(browser, origin, surface, suffix);
        const card = clientLinkCard(surface);
        let drew;
        if (card) {
          drew = await page.waitForSelector(card, { timeout: 20000 }).then(() => true, () => false);
        } else {
          drew = await page.waitForFunction(() => window.__svLoad !== undefined || typeof window.navTo === 'function', null, { timeout: 20000 }).then(() => true, () => false);
          await page.waitForTimeout(2500);
        }
        const text = await bodyText(page);
        if (INVALID.test(text)) failures.push(`${label}: shows "This link isn't valid"`);
        if (card && !drew) failures.push(`${label}: the review card did not draw`);
        if (!verifies.length) failures.push(`${label}: the page never asked the link check to verify it`);
        else {
          const v = { slug: verifies[0].slug, view: verifies[0].view, strict: verifies[0].strict };
          if (suffix === '') plainVerify = v;
          else if (plainVerify && JSON.stringify(v) !== JSON.stringify(plainVerify)) failures.push(`${label}: verify request differs from the plain link (${JSON.stringify(v)} vs ${JSON.stringify(plainVerify)})`);
        }
        const addr = await page.evaluate(() => { const q = new URLSearchParams(location.search); return { split: q.has('split'), c: q.get('c'), t: q.get('t'), v: q.get('v'), sxr: q.get('sxr') }; });
        if (addr.split) failures.push(`${label}: the split key is still in the address`);
        if (!addr.c || !addr.t) failures.push(`${label}: the rest of the link (c, t) was lost from the address`);
        if (surface === 'samples' && (addr.v !== 'sample-reviews' || addr.sxr !== '1')) failures.push(`${label}: the Samples view was lost from the address`);
        if (splitBuilt && !forcedParts && suffix) {
          const mode = await page.evaluate(() => self.__svLoad && self.__svLoad.mode);
          const want = suffix === '&split=0' ? 'full' : (clientsOn ? 'parts' : 'full');
          if (mode !== want) failures.push(`${label}: served as "${mode}", expected "${want}"`);
        }
        if (errors.length) failures.push(`${label}: page errors: ${errors.slice(0, 2).join(' | ')}`);
        console.log(`client-link-split-key: ${label}: accepted, ${card ? (drew ? 'card drawn' : 'card NOT drawn') : 'screen up'}, key removed from the address: ${!addr.split}`);
        await context.close();
      }
    }

    // 2. The way back sticks for the browser, and can be cleared (split page only).
    if (splitBuilt && !forcedParts) {
      const context = await browser.newContext();
      const base = clientLinkRoute('calendar');
      await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), base);
      const modeAt = async suffix => {
        const page = await context.newPage();
        await page.goto(origin + clientLinkUrl('', 'calendar') + suffix, { waitUntil: 'domcontentloaded' });
        await page.waitForSelector(clientLinkCard('calendar'), { timeout: 20000 }).catch(() => {});
        const mode = await page.evaluate(() => self.__svLoad && self.__svLoad.mode);
        const invalid = INVALID.test(await bodyText(page));
        await page.close();
        return { mode, invalid };
      };
      const steps = [['', clientsOn ? 'parts' : 'full'], ['&split=0', 'full'], ['', 'full'], ['&split=1', clientsOn ? 'parts' : 'full'], ['', clientsOn ? 'parts' : 'full']];
      for (const [suffix, want] of steps) {
        const got = await modeAt(suffix);
        if (got.mode !== want || got.invalid) failures.push(`way back: link${suffix ? ' ' + suffix : ''} got ${JSON.stringify(got)}, expected mode "${want}" and a valid link`);
      }
      console.log('client-link-split-key: the way back sticks (&split=0) and clears (&split=1) on a real client link: ' + (failures.some(f => f.startsWith('way back')) ? 'FAIL' : 'ok'));
      await context.close();
    }

    // 3. Nothing else got looser: still the invalid screen, and no verify request.
    for (const suffix of ['&split=2', '&split=', '&split=0&split=1', '&prod=1', '&split=0&prod=1', '&splitx=1', '&SPLIT=0', '&nav=production']) {
      const { context, page, verifies } = await open(browser, origin, 'calendar', suffix);
      const showed = await page.waitForFunction(() => /This link isn.t valid/.test(document.body.innerText || ''), null, { timeout: 15000 }).then(() => true, () => false);
      await page.waitForTimeout(500);
      if (!showed) failures.push(`link${suffix}: expected the invalid link screen and did not get it`);
      if (verifies.length) failures.push(`link${suffix}: a verify request was sent for a link the entry check should refuse`);
      console.log(`client-link-split-key: link${suffix}: ${showed ? 'refused' : 'NOT refused'}, ${verifies.length} verify request(s)`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('client-link-split-key failures', failures));
    process.exit(1);
  }
  console.log('client-link-split-key: PASS');
})().catch(err => { console.error(err); process.exit(1); });
