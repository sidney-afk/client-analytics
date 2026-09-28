'use strict';

// Clean addresses across tabs, and the default landing (owner, 2026-09-28).
//
//   1. Switching tabs drops every address setting that belongs to another
//      tab: /synclinear/<card>?order=...&sxr=1 -> Workload is just /workload,
//      and Calendar with a card open -> Workload is just /workload.
//   2. Old links with extra settings still open on their own tab, unchanged.
//   3. The bare address opens Today for staff on a new visit; a refresh on
//      Analytics stays on Analytics; a signed-out visitor gets the sign-in
//      gate and no staff tab.
//   4. A client share link still lands on its calendar, address untouched.
//
// Fully offline: every non-local request gets an empty answer, and the client
// link uses the synthetic verifier from qa/boot/client-entry-sequence.js.
// Fixture names only; this repo is public.

const { chromium } = require('playwright');
const { serveStatic } = require('./prod-test-utils');
const { seedStaffGate } = require('../../../qa/staff-gate-seed');
const { startStreamServer, openCase } = require('../../../qa/boot/client-entry-sequence');

const failures = [];
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failures.push(msg); }

async function openStaff(browser, port, path, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.route(url => !/^http:\/\/127\.0\.0\.1/.test(url.toString()),
    route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }).catch(() => {}));
  if (!opts.signedOut) await seedStaffGate(context);
  await context.addInitScript(() => { try { localStorage.removeItem('syncview_nav'); } catch (e) {} });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e && e.message || e)));
  await page.goto(`http://127.0.0.1:${port}${path}`, { waitUntil: 'domcontentloaded' });
  if (!opts.signedOut) await page.waitForFunction(() => typeof window.navTo === 'function' && typeof currentNav === 'string' && currentNav !== '', null, { timeout: 20000 });
  return { context, page, errors };
}
const addr = page => page.evaluate(() => location.pathname + location.search + location.hash);
const nav = page => page.evaluate(() => typeof currentNav === 'string' ? currentNav : '');

(async () => {
  const server = await serveStatic();
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  try {
    // 1. SyncLinear card with settings -> Workload is clean.
    {
      const { context, page } = await openStaff(browser, port, '/synclinear/del_fixture?order=updated&sxr=1');
      check(/^\/synclinear\/del_fixture\?/.test(await addr(page)) && /order=updated/.test(await addr(page)), 'an old SyncLinear link with settings opens with its settings kept: ' + await addr(page));
      await page.evaluate(() => navTo('workload'));
      check(await addr(page) === '/workload', 'SyncLinear card -> Workload gives a clean /workload (got ' + await addr(page) + ')');
      await page.evaluate(() => navTo('calendar'));
      check(await addr(page) === '/calendar', 'Workload -> Calendar gives a clean /calendar (got ' + await addr(page) + ')');
      await context.close();
    }
    // 2. Calendar with a card open -> Workload is clean.
    {
      const { context, page } = await openStaff(browser, port, '/calendar/fixture-client/card_fixture?sxr=1');
      check((await addr(page)).startsWith('/calendar/fixture-client/card_fixture'), 'a Calendar card link opens on its card address: ' + await addr(page));
      await page.evaluate(() => navTo('workload'));
      check(await addr(page) === '/workload', 'Calendar with a card open -> Workload gives a clean /workload (got ' + await addr(page) + ')');
      await context.close();
    }
    // 3. Same tab keeps its own settings (an old link, then a re-render).
    {
      const { context, page } = await openStaff(browser, port, '/workload?sxr=1');
      check(await nav(page) === 'workload' && await addr(page) === '/workload?sxr=1', 'an old Workload link with a setting still opens Workload as it was (got ' + await addr(page) + ')');
      await page.evaluate(() => navTo('workload'));
      check(await addr(page) === '/workload?sxr=1', 'staying on the same tab keeps its address');
      await context.close();
    }
    // 3b. A switch in the address is saved before it is dropped (Codex on #1798).
    {
      const { context, page } = await openStaff(browser, port, '/?wl2=0&v2=0');
      await page.waitForFunction(() => currentNav === 'today', null, { timeout: 20000 }).catch(() => {});
      await page.evaluate(() => navTo('workload'));
      const saved = await page.evaluate(() => ({ wl: localStorage.getItem('syncview_workload_v2_off'), cal: localStorage.getItem('syncview_calendar_v2_off'), at: location.pathname + location.search }));
      check(saved.at === '/workload', 'a switch leaves the address on a tab change (got ' + saved.at + ')');
      check(saved.wl === '1' && saved.cal === '1', 'and is saved to this browser first, as if its tab had opened (' + JSON.stringify(saved) + ')');
      await context.close();
    }
    // 3c. The public intake form keeps its address (Codex on #1798).
    {
      const { context, page } = await openStaff(browser, port, '/intake');
      await page.waitForTimeout(800);
      await page.evaluate(() => navTo('linear'));
      check(await addr(page) === '/intake', 'the public intake form keeps /intake (got ' + await addr(page) + ')');
      await context.close();
    }
    // 4. Default landing.
    {
      const { context, page, errors } = await openStaff(browser, port, '/');
      await page.waitForFunction(() => currentNav === 'today', null, { timeout: 20000 }).catch(() => {});
      check(await nav(page) === 'today', 'the bare address opens Today for staff (got ' + await nav(page) + ')');
      check(await addr(page) === '/today', 'and the address reads /today (got ' + await addr(page) + ')');
      check(await page.evaluate(() => document.getElementById('navToday').classList.contains('active')), 'the Today tab is the active pill');
      await page.evaluate(() => navTo('home'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof currentNav === 'string' && currentNav !== '', null, { timeout: 20000 });
      await page.waitForTimeout(800);
      check(await nav(page) === 'home', 'a refresh on Analytics stays on Analytics (got ' + await nav(page) + ')');
      check(!errors.length, 'no page errors: ' + errors.join(' | '));
      await context.close();
    }
    {
      const { context, page } = await openStaff(browser, port, '/?sxr=1');
      await page.waitForFunction(() => currentNav === 'today', null, { timeout: 20000 }).catch(() => {});
      check(await nav(page) === 'today', 'a bare address with only a switch still opens Today');
      await context.close();
    }
    {
      const { context, page } = await openStaff(browser, port, '/', { signedOut: true });
      await page.waitForTimeout(1200);
      const gate = await page.evaluate(() => {
        const o = document.getElementById('staffGateOverlay');
        return { gate: document.documentElement.classList.contains('boot-gate'), overlay: !!o && getComputedStyle(o).display !== 'none' };
      });
      check(gate.gate && gate.overlay, 'a signed-out visitor on the bare address gets the sign-in prompt (' + JSON.stringify(gate) + ')');
      // Signing in lifts the gate and starts the app: it lands on Today.
      await context.route('**/functions/v1/key-verify', r => r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, role: 'admin', member: { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null } }) }));
      await page.evaluate(() => {
        _syncviewStaffIdentitySave({ key: 'qa-staff-gate-key', role: 'admin', member: { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null }, verified_at: new Date().toISOString() });
        _syncviewAcceptStaffVerification();   // what the sign-in card does once the key verifies
      });
      await page.waitForFunction(() => currentNav === 'today', null, { timeout: 20000 }).catch(() => {});
      check(await nav(page) === 'today', 'after signing in from the bare address they land on Today (got ' + await nav(page) + ')');
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  // 5. Client share link: lands on its calendar, address untouched.
  {
    const stream = await startStreamServer();
    const b2 = await chromium.launch({ headless: true });
    const run = await openCase(b2, stream);
    try {
      const q = new URLSearchParams({ c: 'Boot Fixture Client', v: 'calendar', t: 'synthetic-current-token' });
      const going = run.page.goto(`${stream.origin}/index.html?${q}`, { waitUntil: 'load', timeout: 15000 });
      (await stream.nextChunk()).release();
      await going;
      await run.page.waitForFunction(() => document.querySelector('.cal-tab-view') || document.querySelector('.cal-organizer'), null, { timeout: 20000 }).catch(() => {});
      const s = await run.page.evaluate(() => ({ search: location.search, cal: !!(document.querySelector('.cal-tab-view') || document.querySelector('.cal-organizer')), nav: typeof currentNav === 'string' ? currentNav : '' }));
      const kept = new URLSearchParams(s.search);
      check(s.cal, 'a client share link still lands on its calendar');
      check(kept.get('c') === 'Boot Fixture Client' && kept.get('v') === 'calendar' && kept.get('t') === 'synthetic-current-token', 'the share link address is untouched');
    } finally {
      await run.context.close();
      await b2.close();
      if (stream.close) await stream.close();
    }
  }

  if (failures.length) { console.log(`clean-address-landing: ${failures.length} failed`); process.exit(1); }
  console.log('clean-address-landing: PASS');
})().catch(e => { console.error(e); process.exit(1); });
