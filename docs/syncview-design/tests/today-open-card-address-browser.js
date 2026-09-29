'use strict';

/*
 * TODAY "OPEN CARD" KEEPS THE CARD IN THE ADDRESS (Vigil's hand test, 2026-09-28).
 *
 * Open card from Today highlighted the card on the Content Calendar, but the
 * address held only the client, so a reload lost it. Now the address carries
 * the calendar's own card deep link (#calendar/<slug>/<card>) and a reload
 * keeps it. Invented names only; the network is refused by the harness.
 * Run: node docs/syncview-design/tests/today-open-card-address-browser.js
 */

const { launchWorkloadHarness } = require('./workload-harness-lib.js');

let failures = 0;
function expect(condition, message) {
  if (condition) console.log('  ok  ' + message);
  else { failures++; console.error('FAIL today-open-card-address-browser: ' + message); }
}

(async () => {
  const h = await launchWorkloadHarness({ issues: [] });
  try {
    await h.page.waitForFunction(() => typeof window._tdyCardInAddress === 'function', null, { timeout: 15000 });
    const hash = await h.page.evaluate(() => {
      navTo('calendar');
      window._tdyCardInAddress('Client A', 'card-123');
      return (location.pathname + location.hash);
    });
    expect(/calendar\/[a-z0-9-]+\/card-123$/.test(hash), 'the address carries the card after Open card (' + hash + ')');
    await h.page.waitForTimeout(2000); // the calendar mounts and writes its own address
    expect(await h.page.evaluate(() => (location.pathname + location.hash)) === hash, 'the calendar keeps the card in the address');
    const off = await h.page.evaluate(() => {
      navTo('today');
      const before = (location.pathname + location.hash);
      window._tdyCardInAddress('Client A', 'card-9');
      return (location.pathname + location.hash) === before;
    });
    expect(off, 'nothing is written when the calendar did not open');
    await h.page.evaluate(() => navTo('calendar'));
    await h.page.waitForTimeout(500);
    await h.page.evaluate(() => window._tdyCardInAddress('Client A', 'card-123'));
    await h.page.reload();
    await h.page.waitForTimeout(1500);
    expect((await h.page.evaluate(() => (location.pathname + location.hash))).endsWith('/card-123'), 'a reload keeps the card in the address');
  } finally { await h.close(); }

  if (failures) { console.error(`\ntoday-open-card-address-browser: ${failures} check(s) failed`); process.exit(1); }
  console.log('\ntoday-open-card-address-browser: all checks passed');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
