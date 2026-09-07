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
  const create = async (local, failHydration = false, rows = []) => {
    const run = await openCase(browser, server, { storage: { local: { ...baseStorage, ...local }, session: { syncview_staff_identity_prompted_v1: '1' } } });
    const writes = [], held = [];
    if (failHydration) await run.context.addInitScript(() => {
      window.__failRecoveryReads = true;
      const get = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (window.__failRecoveryReads && key.startsWith('syncview_sxr_work_v1:')) throw new Error('Synthetic storage read failure');
        return get.call(this,key);
      };
    });
    await run.context.route('**/*sample-review-upsert*', route => {
      const body = route.request().postDataJSON(); writes.push(body); held.push({ route, body });
    });
    await run.context.route('**/rest/v1/sample_reviews?*', route => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', 'content-range': rows.length ? `0-${rows.length - 1}/${rows.length}` : '*/0' }, body: JSON.stringify(rows) }));
    await streamedNavigation(run.page, server, () => run.page.goto(server.origin + '/index.html#sample-reviews', { waitUntil: 'load' }), 'static:sample-reviews');
    await run.page.waitForFunction(() => typeof sxrState !== 'undefined' && document.getElementById('sxrView') && !sxrState.loading);
    // A synthetic verified staff identity only, never a real credential.
    await run.page.evaluate(() => {
      _syncviewStaffIdentitySave({ key: 'synthetic-test-key', member: { id: 'synthetic-staff-1', name: 'Synthetic Test Operator' }, role: 'smm' });
      _syncviewStaffIdentityVerified = true;
      mountSxrView();
      return loadSxrCards({ skipCache: true });
    });
    return { ...run, writes, held };
  };
  try {
    const serverRow = { id: 'synthetic-existing', client: slugA, name: 'Server original', creative_direction: 'Server direction', status: 'In Progress' };
    const fields = await create({}, false, [serverRow]);
    try {
      const input = fields.page.locator('#sxrView .cal-fld-name').first();
      await input.fill('Unsaved first browser field');
      await input.blur();
      for (let i=0; i<100 && !fields.held.length; i++) await fields.page.waitForTimeout(20);
      assert.equal(fields.held.length, 1);
      await fields.page.locator('#sxrView [data-fld="creative_direction"]').first().fill('Newer browser direction');
      const first = fields.held.shift();
      await first.route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' });
      for (let i=0; i<100 && !fields.held.length; i++) await fields.page.waitForTimeout(20);
      assert.equal(fields.held.length, 1);
      const second = fields.held.shift();
      assert.equal(second.body.sample.name, undefined, 'later batch is a different field');
      Object.assign(serverRow, second.body.sample);
      await second.route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, sample: serverRow }) });
      await fields.page.waitForFunction(() => !Object.keys(_sxrSaveInFlight).length);
      const snapshot = await fields.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
      const fresh = await create(snapshot, false, [serverRow]);
      try {
        assert.equal(await fresh.page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Unsaved first browser field');
        assert.equal(await fresh.page.locator('#sxrView [data-fld="creative_direction"]').first().inputValue(), 'Newer browser direction');
        assert.equal(await fresh.page.locator('[data-saving="synthetic-existing"]').isVisible(), true);
        assert.equal(fresh.writes.length, 0, 'reload retains failed field without auto-writing');
      } finally { await fresh.context.close(); }
      assert.deepEqual(fields.pageErrors, []);
      console.log('PASS full-browser failed first field survives successful distinct field and fresh-context recovery');
    } finally { await fields.context.close(); }
    const creation = await create();
    try {
      await creation.page.locator('button[onclick="addSxrBlankCard()"]').first().click();
      await creation.page.locator('#sxrView .cal-fld-name').first().fill('Original created name');
      for (let i=0; i<100 && !creation.held.length; i++) await creation.page.waitForTimeout(20);
      assert.equal(creation.held.length, 1);
      await creation.page.locator('#sxrView [data-fld="creative_direction"]').first().fill('Trailing direction');
      await creation.page.locator('#sxrView .cal-fld-name').first().fill('Newer trailing name');
      const first = creation.held.shift(), peerAsset = 'https://synthetic.invalid/peer-asset.mp4';
      const receiver = { ...first.body.sample, asset_url: peerAsset };
      await first.route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, sample: first.body.sample }) });
      for (let i=0; i<100 && !creation.held.length; i++) await creation.page.waitForTimeout(20);
      assert.equal(creation.held.length, 1);
      const trailing = creation.held.shift();
      assert.deepEqual(trailing.body.sample, { id: receiver.id, name: 'Newer trailing name', creative_direction: 'Trailing direction' });
      const remaining = await creation.page.evaluate(() => Array.from(_sxrWorkView.records.values(), r => ({ isNew: r.isNew, edits: r.edits })));
      assert.equal(remaining[0].isNew, false);
      assert.deepEqual(remaining[0].edits, { name: 'Newer trailing name', creative_direction: 'Trailing direction' });
      Object.assign(receiver, trailing.body.sample);
      assert.equal(receiver.asset_url, peerAsset, 'trailing source patch preserves the peer-updated untouched asset');
      await trailing.route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, sample: receiver }) });
      await creation.page.waitForFunction(() => !Object.keys(_sxrSaveInFlight).length);
      assert.equal(await creation.page.evaluate(() => _sxrWorkView.records.size), 0);
      assert.deepEqual(creation.pageErrors, []);
      assert.equal(creation.network.unmocked.filter(r => r.method !== 'GET').length, 0);
      console.log('PASS full-browser acknowledged creation uses a trailing field patch and preserves a peer asset');
    } finally { await creation.context.close(); }
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
    let recoverySnapshot;
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
      recoverySnapshot = await quota.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
      console.log('PASS full-browser storage failure, visible recovery and keyboard retry at 360/1280 light/dark');
    } finally { await quota.context.close(); }
    const hydrate = await create(recoverySnapshot, true);
    try {
      const notice = hydrate.page.locator('#sxrWorkNotice');
      assert.equal(await notice.isVisible(), true);
      assert.equal(await hydrate.page.locator('#sxrView .cal-fld-name').count(), 0);
      await hydrate.page.evaluate(() => { window.__failRecoveryReads = false; });
      await notice.focus(); await hydrate.page.keyboard.press('Enter');
      assert.equal(await hydrate.page.locator('#sxrView .cal-fld-name').count(), 1);
      assert.equal(await notice.isVisible(), false);
      await hydrate.page.evaluate(() => _sxrWorkCheckpointView());
      assert.equal(await hydrate.page.locator('#sxrView .cal-fld-name').count(), 1);
      assert.equal(hydrate.writes.length, 0);
      assert.deepEqual(hydrate.pageErrors, []);
      console.log('PASS full-browser keyboard Retry rehydrates intact storage after first-read failure');
    } finally { await hydrate.context.close(); }
    for (const heldSave of [false, true]) {
      const privacy = await create(); const { page } = privacy;
      try {
        await page.locator('button[onclick="addSxrBlankCard()"]').first().click();
        await page.locator('#sxrView .cal-card[data-pid^="__sxrblank__"] .cal-fld-name').fill('Private synthetic A work');
        if (heldSave) {
          await page.evaluate(() => { window.__privacySave = _sxrFlushCardSave(sxrState.posts[0].id); });
          for (let i=0; i<100 && !privacy.held.length; i++) await page.waitForTimeout(20);
          assert.equal(privacy.held.length, 1);
        }
        await page.evaluate(() => {
          localStorage.setItem('syncview_linear_form', JSON.stringify({ title: 'Synthetic sensitive intake' }));
          _syncviewStaffSignOut();
        });
        const signout = await page.evaluate(() => ({
          posts: sxrState.posts.length, inputs: document.querySelectorAll('#sxrView input').length,
          principal: _writeUiPrincipalKey(), intake: localStorage.getItem('syncview_linear_form'),
          work: Object.keys(localStorage).filter(k => k.startsWith('syncview_sxr_work_v1:')).length,
        }));
        assert.deepEqual(signout, { posts: 0, inputs: 0, principal: '', intake: null, work: 1 });
        await page.evaluate(() => {
          _syncviewStaffIdentitySave({ key: 'synthetic-other-key', role: 'smm', member: { id: 'synthetic-staff-2', name: 'Synthetic Other Operator' } });
          _syncviewStaffIdentityVerified = true; _syncviewStaffRefreshChrome();
        });
        assert.equal(await page.locator('#sxrView .cal-fld-name').count(), 0, 'normal identity chrome cannot expose A work');
        if (heldSave) {
          await page.evaluate(() => mountSxrView());
          await page.waitForFunction(() => !sxrState.loading);
          await page.locator('button[onclick="addSxrBlankCard()"]').first().click();
          await page.locator('#sxrView .cal-card[data-pid^="__sxrblank__"] .cal-fld-name').fill('Private synthetic B work');
          const old = privacy.held.shift();
          await old.route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, sample: old.body.sample }) });
          await page.evaluate(() => window.__privacySave);
          assert.equal(await page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Private synthetic B work');
        } else {
          await page.waitForTimeout(750); assert.equal(privacy.writes.length, 0, 'signed-out pending debounce never writes');
          await page.evaluate(() => {
            _syncviewStaffIdentitySave({ key: 'synthetic-test-key', role: 'smm', member: { id: 'synthetic-staff-1', name: 'Synthetic Test Operator' } });
            _syncviewStaffIdentityVerified = true; mountSxrView();
          });
          await page.waitForFunction(() => sxrState.posts.some(p => p.name === 'Private synthetic A work'));
          assert.equal(await page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Private synthetic A work');
        }
        assert.deepEqual(privacy.pageErrors, []);
        console.log('PASS full-browser actual sign-out, identity replacement and ' + (heldSave ? 'late captured settlement' : 'matching-actor recovery without automatic write'));
      } finally { await privacy.context.close(); }
    }
  } finally { await browser.close(); await server.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
