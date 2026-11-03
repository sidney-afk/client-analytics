'use strict';
/*
 * OPEN_REPAIRS 674 (session Reviewguard, 2026-11-02): a test run's diagnostics reports never reach the live log as a
 * person's.
 *
 * Seen (read-only, live): between 19:22 and 21:29 UTC on 2 Nov, 10 reports classed traffic "person", all
 * calendar / client / status / landed_after_retry, all on card "rs1" (this fixture's card, not a real one), all from
 * Firefox on Linux, one per CI run. Two things let them through:
 *   - the report is sent with keepalive, so one sent just before a test closes its context outlived it and went to the
 *     real write-diagnostics, past the review-stage fixture's route (only Firefox's runs leaked);
 *   - headless Firefox's user agent looks like a person's, so the server counted it as one.
 *
 * On the review-stage fixture (fictional client and cards, nothing live), with a client link open:
 *   1. a report says it comes from a page a test robot drives (navigator.webdriver), so the server counts it as
 *      automation whatever the user agent says;
 *   2. under the fixture the report is a plain request (no keepalive), answered by the fixture and gone with the page;
 *   3. a real person's report is unchanged: no automation flag when navigator.webdriver is false.
 * On main 1 and 2 fail (no flag; keepalive kept).
 */
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { serveStatic } = require('../docs/syncview-design/tests/prod-test-utils.js');
const fx = require('./fixtures/review-stage-fixture.js');

const ok = m => console.log('  ok  ' + m);
const reportOn = async (t, sent) => {
  const before = sent.length;
  await t.page.evaluate(() => _writeRefusalBeacon('calendar', 'ui_write_failure', { kind: 'status', card: 'rs1' }, { code: 'write_conflict', status: 409 }));
  for (let i = 0; i < 80 && sent.length === before; i++) await fx.sleep(50);
  assert(sent.length > before, 'the report was sent');
  return sent[sent.length - 1];
};

(async () => {
  const server = await serveStatic();
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  try {
    // 1 and 2: a test robot's page.
    {
      const t = await fx.openClient(browser, origin, { flags: 'on' });
      const sent = [];
      t.page.on('request', r => { if (/\/functions\/v1\/write-diagnostics/.test(r.url()) && r.method() === 'POST') { try { sent.push(JSON.parse(r.postData() || '{}')); } catch (e) {} } });
      await fx.waitNew(t);
      const body = await reportOn(t, sent);
      assert.equal(body.automation, true, 'a report from a robot-driven page says so: ' + JSON.stringify(body));
      ok('a report from a page a test robot drives says so (automation), whatever its user agent');
      assert(await t.page.evaluate(() => window.__svDiagKeepaliveDropped) >= 1, 'the fixture sends the report as a plain request');
      ok('under the fixture the report is a plain request, answered by the fixture and gone with the page');
      await t.ctx.close();
    }
    // 3: a person's page (navigator.webdriver false) sends no flag.
    {
      const t = await fx.openClient(browser, origin, { flags: 'on' });
      await t.ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false, configurable: true }); } catch (e) {} });
      await t.page.reload({ waitUntil: 'domcontentloaded' });
      const sent = [];
      t.page.on('request', r => { if (/\/functions\/v1\/write-diagnostics/.test(r.url()) && r.method() === 'POST') { try { sent.push(JSON.parse(r.postData() || '{}')); } catch (e) {} } });
      await fx.waitNew(t);
      assert.equal(await t.page.evaluate(() => navigator.webdriver), false);
      const body = await reportOn(t, sent);
      assert(!('automation' in body), 'a person\'s report carries no automation flag: ' + JSON.stringify(body));
      ok('a person\'s report is unchanged (no automation flag)');
      await t.ctx.close();
    }
    console.log('diagnostics-test-traffic-browser: a test run\'s reports say they are automation and never outlive the test ✅');
  } finally { await browser.close(); await server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
