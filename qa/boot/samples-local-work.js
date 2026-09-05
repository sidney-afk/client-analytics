'use strict';
// Full local app in Chromium. All remote traffic is intercepted by the shared
// boot harness; this fixture intercepts every Samples write and holds its ack.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startStreamServer, openCase, streamedNavigation } = require('./client-entry-sequence');
const A = 'Boot Fixture Client', B = 'Residual Fixture Client', slugA = 'bootfixtureclient';
async function main() {
  const server = await startStreamServer();
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  const baseStorage = {
    syncview_auth_v1: 'ok', syncview_nav: 'sample-reviews',
    syncview_calendar_pins: JSON.stringify([A, B]),
    syncview_sxr_prefs_v1: JSON.stringify({ client: A, view: 'organizer' }),
  };
  const create = async local => {
    const run = await openCase(browser, server, { storage: { local: { ...baseStorage, ...local }, session: { syncview_staff_identity_prompted_v1: '1' } } });
    const writes = [], held = [];
    await run.context.route('**/*sample-review-upsert*', route => {
      const body = route.request().postDataJSON(); writes.push(body); held.push({ route, body });
    });
    await run.context.route('**/rest/v1/sample_reviews?*', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': '*/0' }, body: '[]' }));
    await streamedNavigation(run.page, server, () => run.page.goto(server.origin + '/index.html#sample-reviews', { waitUntil: 'load' }), 'static:sample-reviews');
    await run.page.waitForFunction(() => typeof sxrState !== 'undefined' && document.getElementById('sxrView') && !sxrState.loading);
    // A synthetic verified staff identity only, never a real credential.
    await run.page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'synthetic-test-key', member: { id: 'synthetic-staff-1', name: 'Synthetic Test Operator' }, role: 'smm' });
      _syncviewStaffIdentityVerified = true;
      return loadSxrCards({ skipCache: true });
    });
    return { ...run, writes, held };
  };
  try {
    for (const success of [false, true]) {
      const run = await create(); const { page } = run;
      try {
        await page.locator('button[onclick="addSxrBlankCard()"]').first().click();
        const input = page.locator('#sxrView .cal-card[data-pid^="__sxrblank__"] .cal-fld-name').first();
        await input.fill('Browser fictional draft');
        await page.evaluate(() => loadSxrCards({ skipCache: true }));
        assert.equal(await input.inputValue(), 'Browser fictional draft', 'refresh preserves focused typing');
        await page.waitForFunction(() => Object.keys(_sxrSaveInFlight).length > 0);
        for (let i=0; i<100 && !run.held.length; i++) await page.waitForTimeout(30);
        assert.equal(run.held.length, 1, 'real debounce reaches the intercepted writer');
        const savedId = run.writes[0].sample.id;
        await page.locator('#sxrTabs .cal-tab', { hasText: B }).click();
        await page.waitForFunction(b => sxrState.client === b && !sxrState.loading, B);
        assert.equal(await page.locator('#sxrView .cal-fld-name').count(), 0);
        const held = run.held.shift();
        await held.route.fulfill({ status: success ? 200 : 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(success ? { ok: true, sample: held.body.sample } : { ok: false }) });
        await page.waitForTimeout(120);
        const snapshot = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
        const cache = JSON.parse(snapshot['syncview_sxr_cache_v2_' + slugA] || '{"posts":[]}');
        assert.ok(cache.posts.every(p => p.client === slugA));
        assert.equal(await page.locator('#sxrView .cal-fld-name').count(), 0, 'late ack cannot repaint B');
        if (!success) {
          const fresh = await create({ ...snapshot, syncview_sxr_prefs_v1: baseStorage.syncview_sxr_prefs_v1 });
          try {
            await fresh.page.waitForFunction(id => sxrState.posts.some(p => p.id === id), savedId);
            assert.equal(await fresh.page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Browser fictional draft');
            const retry = fresh.page.locator(`[data-saving="${savedId}"]`);
            await retry.click();
            for (let i=0; i<100 && !fresh.held.length; i++) await fresh.page.waitForTimeout(30);
            assert.equal(fresh.held.length, 1); assert.equal(fresh.writes[0].sample.name, 'Browser fictional draft');
            const recovery = fresh.held.shift();
            await recovery.route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, sample: recovery.body.sample }) });
            await fresh.page.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('syncview_sxr_work_v1:')));
            assert.deepEqual(fresh.pageErrors, []);
          } finally { await fresh.context.close(); }
        }
        assert.deepEqual(run.pageErrors, []);
        assert.equal(run.network.unmocked.filter(r => r.method !== 'GET').length, 0, 'no unexpected write attempt');
        console.log('PASS full-browser debounce, refresh, client switch and held ' + (success ? 'success' : 'failure with fresh-context retry'));
      } finally { await run.context.close(); }
    }
    const quota = await create();
    try {
      await quota.page.evaluate(() => {
        window.__originalStorageSet = Storage.prototype.setItem;
        Storage.prototype.setItem = function(key, value) {
          if (key.startsWith('syncview_sxr_work_v1:')) throw new DOMException('Synthetic quota', 'QuotaExceededError');
          return window.__originalStorageSet.call(this, key, value);
        };
      });
      await quota.page.locator('button[onclick="addSxrBlankCard()"]').first().click();
      const notice = quota.page.locator('#sxrWorkNotice');
      for (const width of [360, 1280]) for (const theme of ['light', 'dark']) {
        await quota.page.setViewportSize({ width, height: 900 });
        await quota.page.evaluate(t => document.documentElement.dataset.theme = t, theme);
        assert.equal(await notice.isVisible(), true);
        const box = await notice.boundingBox();
        assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'recovery warning fits viewport and touch target');
      }
      await quota.page.evaluate(() => { Storage.prototype.setItem = window.__originalStorageSet; });
      await notice.focus(); await quota.page.keyboard.press('Enter');
      assert.equal(await notice.isVisible(), false);
      assert.equal(await quota.page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('syncview_sxr_work_v1:')).length), 1);
      assert.equal(quota.writes.length, 0, 'storage retry never invokes a backend writer');
      assert.deepEqual(quota.pageErrors, []);
      console.log('PASS full-browser storage failure, visible recovery and keyboard retry at 360/1280 light/dark');
    } finally { await quota.context.close(); }
  } finally { await browser.close(); await server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
