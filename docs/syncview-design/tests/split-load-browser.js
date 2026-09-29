'use strict';
/* split-load-browser.js -- who gets the code how (plan step 2).
 *
 * docs/plans/2026-09-28-load-per-tab-plan.md. With src/index/split.json off,
 * index.html carries the whole script inline and there is nothing to choose;
 * this checks exactly that. With the split build (switch on, or the CI
 * split-preview job's --force-split), it checks, fully offline:
 *   - a client link, the intake and onboarding forms and a signed-out visitor
 *     get "full": the one js/sv-full-*.js file, the same code that was inline;
 *   - signed-in staff get "parts": every js/sv-NN-* file, in order, and every
 *     one of them ran;
 *   - a code file that fails to download makes the page reload itself once,
 *     not loop, and not be left half-loaded silently.
 * The CI preview job also builds with --force-split=parts, where everyone gets
 * the parts; there the client link must get parts too.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { serveStatic, formatFailures } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const { CORS, clientLinkRoute, clientLinkUrl } = require('./client-link-fixture');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const split = html.includes('/* SyncView loader.');
const forcedParts = /var FORCE = "parts";/.test(html);

const empty = r => (r.request().method() === 'OPTIONS'
  ? r.fulfill({ status: 204, headers: CORS, body: '' })
  : r.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: '[]' }).catch(() => {}));

async function load(browser, origin, { url, staff, route, dropFirstPart }) {
  const context = await browser.newContext();
  await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), route || empty);
  let dropped = 0;
  if (dropFirstPart) {
    // The first staff code file fails once, as a flaky download would.
    await context.route(/\/js\/sv-01-[\w-]+\.js$/, r => (dropped++ === 0 ? r.fulfill({ status: 503, body: '' }) : r.continue()));
  }
  if (staff) await seedStaffGate(context);
  const page = await context.newPage();
  let navigations = 0;
  // Count document loads, not address changes (boot rewrites the address).
  page.on('request', r => { if (r.resourceType() === 'document' && r.frame() === page.mainFrame()) navigations++; });
  await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const state = await page.evaluate(() => ({
    load: self.__svLoad || null,
    ran: self.__svParts || [],
    booted: typeof window.navTo === 'function',
  }));
  await context.close();
  return Object.assign(state, { navigations, dropped });
}

// Each area's views; the first is also used for the refresh, Retry and
// background checks, and every one must draw on demand from a cold start.
const LAZY_VIEWS = {
  tiktok: [{ route: 'tiktok-upload', drawn: '.tk-page #tkFormCol' }],
  templates: [
    { route: 'templates', drawn: '.tpl-index-centered, [data-sv-save-ind="templates"]' },
    { route: 'filming-plans', drawn: '.fp-view' },
  ],
  workload: [{ route: 'workload', drawn: '.workload-view' }],
  kasper: [
    { route: 'kasper', drawn: '.kasper-head' },
    { route: 'client-credentials', drawn: '.sv-staff-page' },
  ],
};
async function lazyChecks(browser, origin, failures) {
  const lazyNames = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'index', 'split.json'), 'utf8')).lazy || [];
  for (const name of lazyNames) {
    const views = LAZY_VIEWS[name];
    const view = views && views[0];
    if (!view) { failures.push(`lazy area "${name}" has no view in LAZY_VIEWS; add how to open it`); continue; }
    const open = async (url, opts = {}) => {
      const context = await browser.newContext();
      await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), empty);
      let fail = opts.failFirst ? 1 : 0;
      const fetched = [];
      await context.route(new RegExp(`/js/sv-\\d\\d-${name}-[0-9a-f]+\\.js$`), r => { fetched.push(r.request().url()); return fail-- > 0 ? r.fulfill({ status: 503, body: '' }) : r.continue(); });
      await seedStaffGate(context);
      await context.addInitScript(() => { try { localStorage.removeItem('syncview_nav'); } catch (e) {} });
      const page = await context.newPage();
      await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
      return { context, page, fetched };
    };
    // 1. Not in the first download; opening the tab fetches it and draws.
    for (const view of views) {
      const { context, page, fetched } = await open('/');
      const early = await page.evaluate(n => ({ lazy: self.__svLoad && self.__svLoad.lazy && self.__svLoad.lazy[n], ran: (self.__svParts || []).some(f => f.includes('-' + n + '-')) }), name);
      if (!early.lazy) failures.push(`${name}: not listed as on demand in the parts page`);
      if (early.ran) failures.push(`${name}: its code ran before anyone asked for it`);
      await page.evaluate(r => navTo(r), view.route);
      const drew = await page.waitForSelector(view.drawn, { timeout: 15000 }).then(() => true, () => false);
      if (!drew) failures.push(`${name}: opening ${view.route} never drew it`);
      if (fetched.length !== 1) failures.push(`${name}: expected one download of its code for ${view.route}, saw ${fetched.length}`);
      console.log(`split-load: ${name} on demand (${view.route}): ${drew ? 'drawn' : 'NOT drawn'} after ${fetched.length} download(s)`);
      await context.close();
    }
    // 2. Refresh while on the tab.
    {
      const { context, page } = await open('/#' + view.route);
      const drew = await page.waitForSelector(view.drawn, { timeout: 15000 }).then(() => true, () => false);
      if (!drew) failures.push(`${name}: a refresh on its tab never drew it`);
      await context.close();
    }
    // 3. Download fails once: Retry, then it draws.
    {
      const { context, page, fetched } = await open('/', { failFirst: true });
      await page.evaluate(r => navTo(r), view.route);
      const retry = await page.waitForSelector('[data-sv-area-retry]', { timeout: 15000 }).then(() => true, () => false);
      if (!retry) failures.push(`${name}: a failed download showed no Retry`);
      else {
        await page.click('[data-sv-area-retry]');
        const drew = await page.waitForSelector(view.drawn, { timeout: 15000 }).then(() => true, () => false);
        if (!drew) failures.push(`${name}: Retry after a failed download never drew it`);
      }
      console.log(`split-load: ${name} failed download: Retry ${retry ? 'shown' : 'MISSING'}, ${fetched.length} download(s)`);
      await context.close();
    }
    // 5. A refresh on the tab while the LAST always-loaded parts are slow: the
    // area's chunk arrives first and must wait for them (it uses names they
    // define), not run early and leave the page on "Loading...".
    if (name === 'kasper') {
      const context = await browser.newContext();
      await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), empty);
      await context.route(/\/js\/sv-\d\d-core-[0-9a-f]+\.js$/, async r => {
        const res = await r.fetch();
        const body = await res.text();
        if (body.includes('const KASPER_SUBTABS')) await new Promise(ok => setTimeout(ok, 2500));
        await r.fulfill({ response: res, body });
      });
      await seedStaffGate(context);
      await context.addInitScript(() => { try { localStorage.removeItem('syncview_nav'); } catch (e) {} });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(origin + '/#kasper', { waitUntil: 'domcontentloaded' });
      const drew = await page.waitForSelector(view.drawn, { timeout: 20000 }).then(() => true, () => false);
      if (!drew) failures.push(`${name}: a refresh with slow always-loaded parts never drew it (the area ran before they did)`);
      if (errors.some(e => /is not defined|before initialization/.test(e))) failures.push(`${name}: the area ran before the always-loaded parts: ${errors[0]}`);
      console.log(`split-load: ${name} refresh with slow core parts: ${drew ? 'drawn' : 'NOT drawn'}`);
      await context.close();
    }
    // 6. A button that loads the area (not a tab): a failed download says so.
    if (name === 'kasper') {
      const { context, page } = await open('/', { failFirst: true });
      await page.evaluate(() => _ccOpenModal('Sample Client'));
      const toast = await page.waitForSelector('.sv-toast', { timeout: 15000 }).then(() => true, () => false);
      if (!toast) failures.push(`${name}: a failed download from the Credentials button showed no message`);
      console.log(`split-load: ${name} failed download from a button: message ${toast ? 'shown' : 'MISSING'}`);
      await context.close();
    }
    // 4. Fetched quietly in the background after the first screen.
    {
      const { context, page } = await open('/');
      const ok = await page.waitForFunction(n => (self.__svParts || []).some(f => f.includes('-' + n + '-')), name, { timeout: 15000 }).then(() => true, () => false);
      if (!ok) failures.push(`${name}: never fetched in the background`);
      await context.close();
    }
  }
}

(async () => {
  const server = await serveStatic();
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    if (!split) {
      const s = await load(browser, origin, { url: '/', staff: true });
      if (s.load) failures.push('split.json is off, yet the page ran the loader');
      if (!s.booted) failures.push('single-file page did not boot');
      console.log('split-load: switch off, whole script inline: ' + (failures.length ? 'FAIL' : 'ok'));
    } else {
      const cases = [
        ['client link', { url: clientLinkUrl('', 'calendar'), route: clientLinkRoute('calendar') }, forcedParts ? 'parts' : 'full'],
        ['intake form', { url: '/?intake=1' }, forcedParts ? 'parts' : 'full'],
        ['onboarding form', { url: '/?onboarding=1' }, forcedParts ? 'parts' : 'full'],
        ['signed-out visitor', { url: '/' }, forcedParts ? 'parts' : 'full'],
        // Public entries opened in a browser that also holds a staff sign-in,
        // by their clean addresses too (svRoute rewrites them before the loader).
        ['intake form, staff browser, clean path', { url: '/intake', staff: true }, forcedParts ? 'parts' : 'full'],
        ['intake form, staff browser', { url: '/?intake=1', staff: true }, forcedParts ? 'parts' : 'full'],
        ['onboarding form, staff browser, clean path', { url: '/onboarding/qa-fixture', staff: true }, forcedParts ? 'parts' : 'full'],
        ['onboarding form, staff browser', { url: '/?onboarding=1', staff: true }, forcedParts ? 'parts' : 'full'],
        ['SMM weekly report, staff browser', { url: '/#smm-weekly-report', staff: true }, forcedParts ? 'parts' : 'full'],
        ['client link, staff browser', { url: clientLinkUrl('', 'calendar'), route: clientLinkRoute('calendar'), staff: true }, forcedParts ? 'parts' : 'full'],
        ['signed-in staff', { url: '/', staff: true }, 'parts'],
        ['signed-in staff, Calendar', { url: '/#calendar', staff: true }, 'parts'],
      ];
      for (const [label, opts, want] of cases) {
        const s = await load(browser, origin, opts);
        if (!s.load) { failures.push(`${label}: the loader did not run`); continue; }
        if (s.load.mode !== want) failures.push(`${label}: got "${s.load.mode}", expected "${want}"`);
        const missing = s.load.files.filter(f => !s.ran.includes(f));
        if (missing.length) failures.push(`${label}: ${missing.length} code file(s) did not run: ${missing.join(', ')}`);
        if (want === 'full' && (s.load.files.length !== 1 || !/^js\/sv-full-[0-9a-f]{12}\.js$/.test(s.load.files[0]))) failures.push(`${label}: full mode should load exactly one js/sv-full file`);
        if (!s.booted) failures.push(`${label}: the app did not boot`);
        console.log(`split-load: ${label}: ${s.load.mode}, ${s.ran.length} file(s) ran`);
      }
      // The per-browser way back: ?split=0 sends this browser the single file and
      // sticks; ?split=1 clears it. (Skipped when everyone is forced onto parts.)
      if (!forcedParts) {
        const context = await browser.newContext();
        await context.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.toString()), empty);
        await seedStaffGate(context);
        const page = await context.newPage();
        const modeAt = async url => {
          await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });
          return page.evaluate(() => self.__svLoad && self.__svLoad.mode);
        };
        const steps = [['/', 'parts'], ['/?split=0', 'full'], ['/', 'full'], ['/#calendar', 'full'], ['/?split=1', 'parts'], ['/', 'parts']];
        for (const [url, want] of steps) {
          const got = await modeAt(url);
          if (got !== want) failures.push(`opt-out: staff at ${url} got "${got}", expected "${want}"`);
        }
        console.log('split-load: per-browser opt-out (?split=0 sticks, ?split=1 clears): ' + (failures.some(f => f.startsWith('opt-out')) ? 'FAIL' : 'ok'));
        await context.close();
      }
      // On-demand areas (split.json "lazy"): staff start without their code,
      // get it when the tab opens (or on a refresh there), see Retry when the
      // download fails, and get it quietly in the background otherwise.
      await lazyChecks(browser, origin, failures);
      const r = await load(browser, origin, { url: '/', staff: true, dropFirstPart: true });
      if (r.dropped < 2) failures.push(`failed download: the page did not retry the missing file (requests: ${r.dropped})`);
      if (r.navigations !== 2) failures.push(`failed download: expected exactly one reload, saw ${r.navigations - 1}`);
      if (!r.booted || (r.load && r.load.files.some(f => !r.ran.includes(f)))) failures.push('failed download: the page was not whole after its one reload');
      console.log(`split-load: failed download: ${r.navigations - 1} reload, then ${r.ran.length} file(s) ran`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) {
    console.error(formatFailures('split-load failures', failures));
    process.exit(1);
  }
  console.log('split-load: PASS');
})().catch(err => { console.error(err); process.exit(1); });
