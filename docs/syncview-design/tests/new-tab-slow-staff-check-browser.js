'use strict';

/*
 * A NEW TAB OPENS WHAT ITS ADDRESS NAMES, HOWEVER SLOW THE STAFF CHECK IS.
 *
 * The boot router routes only after the staff key check answers. Until then
 * currentNav still reads its starting value, 'home'. The runtime switch read
 * (syncview_runtime_flags) moves a person who is on Analytics to the Content
 * Calendar while Analytics is hidden, and it used to treat that starting
 * 'home' as "on Analytics". When the switch answer came back before a slow
 * (cold) key check, a SyncLinear tab opened from a Calendar card's button
 * showed the Calendar instead, and the boot router then stood down (session
 * Linkcheck, 2026-10-25). A fast check never showed it, so it looked random.
 *
 * Invented names only; the network is refused by the harness.
 * Run: node docs/syncview-design/tests/new-tab-slow-staff-check-browser.js
 */

const { launchWorkloadHarness } = require('./workload-harness-lib.js');

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL new-tab-slow-staff-check-browser: ' + message); }
}

const VERIFY_MS = 2500;

(async () => {
  // A switch answer that lists someone, as the live table does, so the read
  // announces itself (sv-review-stage-switch) the moment it lands.
  const h = await launchWorkloadHarness({ issues: [], flagRows: [{ key: 'review_stage_kasper_staff', value: { staff: ['someone'] } }] });
  try {
    const { page, context } = h;
    const base = page.url().split('/').slice(0, 3).join('/');
    await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 15000 });

    // The address a Calendar card's SyncLinear button puts on its link.
    const href = await page.evaluate(() => svRoute.fast('/?prod=1&d=deliv-1' + svRoute.cardOrigin('calendar', 'client-a', 'card-77')));
    expect(/^\/\?prod=1&d=deliv-1&from=calendar/.test(href), 'the card button links to SyncLinear: ' + href);

    // A cold key check: the switch read answers well before it.
    let flagsAt = 0, verifyAt = 0;
    await context.unroute('**/functions/v1/key-verify');
    await context.route('**/functions/v1/key-verify', async route => {
      await new Promise(r => setTimeout(r, VERIFY_MS));
      verifyAt = Date.now();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, role: 'admin', member: { id: 'qa_staff', name: 'QA Staff', role: 'admin', team: null } }) });
    });
    context.on('response', r => { if (/syncview_runtime_flags/.test(r.url()) && !flagsAt) flagsAt = Date.now(); });

    const land = async (address, ready) => {
      flagsAt = 0; verifyAt = 0;
      const tab = await context.newPage();
      await tab.goto(base + address);
      await tab.waitForTimeout(VERIFY_MS + 2500);
      if (ready) await tab.waitForSelector(ready, { timeout: 15000 }).catch(() => {});
      const out = await tab.evaluate(() => ({ nav: currentNav, path: location.pathname, prod: !!document.querySelector('.prod-topbar'), cal: !!document.getElementById('calView') }));
      out.flagsFirst = !!flagsAt && !!verifyAt && flagsAt < verifyAt;
      await tab.close();
      return out;
    };

    const prod = await land(href, '.prod-topbar');
    expect(prod.flagsFirst, 'the switch read answered before the key check (the race is set up)');
    expect(prod.nav === 'production' && prod.prod && !prod.cal, 'the SyncLinear link opens SyncLinear, not the Calendar: ' + JSON.stringify(prod));
    expect(/^\/synclinear\/deliv-1/.test(prod.path), 'and the address stays on the work item: ' + prod.path);

    const wl = await land('/#workload');
    expect(wl.nav === 'workload' && !wl.cal, 'a fresh Workload tab opens Workload: ' + JSON.stringify(wl));
  } finally { await h.close(); }

  if (failures) { console.error(`\nnew-tab-slow-staff-check-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\nnew-tab-slow-staff-check-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
