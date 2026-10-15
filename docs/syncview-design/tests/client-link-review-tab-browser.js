'use strict';
/* client-link-review-tab-browser.js -- a client link made with tab=review opens the
 * Calendar (or the Samples) on its Review view, whatever view that browser used last.
 * It is the address the Notify client alert builds (supabase/functions/_shared/client-review-alert.mjs).
 *
 * Fully offline, on a synthetic client link (client-link-fixture.js: made-up client,
 * made-up token). The page runs its real entry check and real token preflight against a
 * local stand-in for the verify function. Asserts, for the Calendar and the Samples:
 *   - the link the alert function builds opens on Review (the Review tab is the active
 *     one and a review card is drawn) even when this browser last used the Sheet;
 *   - the same link without tab=review still opens on the saved view (Calendar: the
 *     Sheet), so every older or copied link behaves as before;
 *   - tab is gone from the address once the page is up, the rest of the link stays, and
 *     the verify request is identical to the plain link's;
 *   - the check is not looser: tab=sheet, tab=, and a repeated tab show the invalid
 *     screen and send no verify request; tab=review on an Analytics link is harmless;
 *   - only a client link reads it: the Calendar's code reads it behind the client-link guard.
 */
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { clientLinkRoute, clientLinkCard } = require('./client-link-fixture');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const INVALID = /This link isn.t valid/;
const CLIENT = 'Link Fixture Client';
const TOKEN = 'synthetic-link-token';
const SURFACE = { calendar: 'calendar', samples: 'samples' };

async function open(browser, origin, surface, url, prefs) {
  const context = await browser.newContext();
  const verifies = [];
  const base = clientLinkRoute(surface);
  await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), route => {
    const r = route.request();
    if (new URL(r.url()).pathname === '/functions/v1/client-token-verify') {
      let body = {}; try { body = JSON.parse(r.postData() || '{}'); } catch (e) {}
      verifies.push(body);
    }
    return base(route);
  });
  if (prefs) await context.addInitScript(p => { try { for (const [k, v] of Object.entries(p)) localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, prefs);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { context, page, verifies, errors };
}
const bodyText = page => page.evaluate(() => document.body.innerText || '');
const activeTab = page => page.evaluate(() => { const b = document.querySelector('.cal-view-btn.active'); return b ? b.getAttribute('data-cal-view') : null; });

(async () => {
  const { buildReviewLink } = await import(path.join(ROOT, 'supabase/functions/_shared/client-review-alert.mjs'));
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  // The links the alert function builds, pointed at the local page.
  const made = { calendar: buildReviewLink({ origin, displayName: CLIENT, surface: 'calendar', token: TOKEN }), samples: buildReviewLink({ origin, displayName: CLIENT, surface: 'samples', token: TOKEN }) };
  // The address as every earlier link has it: the same link without tab.
  const strip = url => { const u = new URL(url); u.searchParams.delete('tab'); return u.toString(); };
  const sheetPrefs = { syncview_calendar_prefs: { view: 'organizer' }, syncview_sxr_prefs_v1: { view: 'organizer' } };
  const withIndex = url => url.replace(origin + '/?', origin + '/index.html?');
  try {
    for (const surface of ['calendar', 'samples']) {
      const card = clientLinkCard(surface);
      // 1. The link the alert builds opens on Review, though this browser last used the Sheet.
      const url = withIndex(made[surface]);
      if (!/[?&]tab=review(&|$)/.test(url)) failures.push(`${surface}: the built link does not carry tab=review: ${url.replace(TOKEN, '<token>')}`);
      const a = await open(browser, origin, surface, url, sheetPrefs);
      const drew = await a.page.waitForSelector(card, { timeout: 20000 }).then(() => true, () => false);
      if (INVALID.test(await bodyText(a.page))) failures.push(`${surface} (alert link): shows "This link isn't valid"`);
      if (!drew) failures.push(`${surface} (alert link): the review card did not draw`);
      if (await activeTab(a.page) !== 'review') failures.push(`${surface} (alert link): the Review tab is not the active one (${await activeTab(a.page)})`);
      const addr = await a.page.evaluate(() => { const q = new URLSearchParams(location.search); return { tab: q.has('tab'), c: q.get('c'), t: q.get('t'), v: q.get('v'), sxr: q.get('sxr') }; });
      if (addr.tab) failures.push(`${surface} (alert link): tab is still in the address`);
      if (!addr.c || !addr.t || (surface === 'samples' && (addr.v !== 'sample-reviews' || addr.sxr !== '1'))) failures.push(`${surface} (alert link): the rest of the link was lost from the address (${JSON.stringify(addr)})`);
      if (!a.verifies.length) failures.push(`${surface} (alert link): the page never asked the link check to verify it`);
      if (a.errors.length) failures.push(`${surface} (alert link): page errors: ${a.errors.slice(0, 2).join(' | ')}`);
      console.log(`client-link-review-tab: ${surface}: the alert link opens on ${await activeTab(a.page)}, card ${drew ? 'drawn' : 'NOT drawn'}, tab removed from the address: ${!addr.tab}`);
      const verifyWith = { slug: a.verifies[0] && a.verifies[0].slug, view: a.verifies[0] && a.verifies[0].view, strict: a.verifies[0] && a.verifies[0].strict };
      await a.context.close();

      // 2. The same link without tab=review: unchanged. The Calendar follows the saved view (Sheet);
      //    the Samples client already lands on Review.
      const b = await open(browser, origin, surface, withIndex(strip(made[surface])), sheetPrefs);
      await b.page.waitForSelector(surface === 'calendar' ? '.cal-view-btn.active' : card, { timeout: 20000 }).catch(() => {});
      const want = surface === 'calendar' ? 'organizer' : 'review';
      const got = await activeTab(b.page);
      if (got !== want) failures.push(`${surface} (older link, browser last on the Sheet): opened on ${got}, expected ${want} as before`);
      const plain = { slug: b.verifies[0] && b.verifies[0].slug, view: b.verifies[0] && b.verifies[0].view, strict: b.verifies[0] && b.verifies[0].strict };
      if (JSON.stringify(plain) !== JSON.stringify(verifyWith)) failures.push(`${surface}: the verify request differs with tab=review (${JSON.stringify(verifyWith)} vs ${JSON.stringify(plain)})`);
      console.log(`client-link-review-tab: ${surface}: the older link (no tab) still opens on ${got}`);
      await b.context.close();

      // 3. A browser with nothing saved: both open on Review (the client default), with or without tab.
      for (const [label, u] of [['alert link', url], ['older link', withIndex(strip(made[surface]))]]) {
        const c = await open(browser, origin, surface, u, null);
        await c.page.waitForSelector(card, { timeout: 20000 }).catch(() => {});
        if (await activeTab(c.page) !== 'review') failures.push(`${surface} (${label}, fresh browser): not on Review (${await activeTab(c.page)})`);
        await c.context.close();
      }

      // 4. Nothing looser: only tab=review passes, once; no verify request for anything else.
      for (const suffix of ['&tab=sheet', '&tab=', '&tab=review&tab=review', '&tab=Review', '&tabx=review']) {
        const d = await open(browser, origin, surface, withIndex(strip(made[surface])) + suffix, sheetPrefs);
        const showed = await d.page.waitForFunction(() => /This link isn.t valid/.test(document.body.innerText || ''), null, { timeout: 15000 }).then(() => true, () => false);
        await d.page.waitForTimeout(400);
        if (!showed) failures.push(`${surface} link${suffix}: expected the invalid link screen and did not get it`);
        if (d.verifies.length) failures.push(`${surface} link${suffix}: a verify request was sent for a link the entry check should refuse`);
        console.log(`client-link-review-tab: ${surface} link${suffix}: ${showed ? 'refused' : 'NOT refused'}, ${d.verifies.length} verify request(s)`);
        await d.context.close();
      }
    }

    // 5. An Analytics link with tab=review is accepted and the key is harmless.
    {
      const analyticsUrl = `${origin}/index.html?${new URLSearchParams({ c: CLIENT, t: TOKEN, tab: 'review' })}`;
      const e = await open(browser, origin, 'analytics', analyticsUrl, sheetPrefs);
      await e.page.waitForTimeout(3000);
      if (INVALID.test(await bodyText(e.page))) failures.push('analytics link with tab=review: shows "This link isn\'t valid"');
      console.log('client-link-review-tab: an Analytics link with tab=review is accepted');
      await e.context.close();
    }

    // 6. Only a client link reads it: the source says so.
    const fs = require('fs');
    const boot = fs.readFileSync(path.join(ROOT, 'src/index/134-calendar-prefs-mount.js.part'), 'utf8');
    if (!/_isClientLink && !_calClientTabUsed && _syncviewClientEntryCapability/.test(boot)) failures.push('the Review tab is read without the client-link guard');
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.error(formatFailures('client-link-review-tab-browser', failures)); process.exit(1); }
  console.log('client-link-review-tab-browser: all checks passed');
})().catch(err => { console.error(err && err.stack ? err.stack : String(err)); process.exit(1); });
