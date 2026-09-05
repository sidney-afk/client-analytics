'use strict';
// Actual complete HTML documents, real input/debounce/writers, same-origin
// navigation. All remote traffic intercepted; no live backend or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startStreamServer, openCase } = require('./client-entry-sequence');
const { build, gitSource, sha256, CANDIDATE, BASELINE } = require('../../scripts/samples-recovery-build');
const A = 'Boot Fixture Client', B = 'Residual Fixture Client', slug = 'bootfixtureclient';
const archivedKey = 'syncview_sxr_legacy_work_v1:' + slug;
const archivedBytes = JSON.stringify({ schema: 1, synthetic: 'unowned legacy debt; never replay', posts: [{ id: '__sxrblank__legacy', name: 'Archived synthetic typing' }] });
const forward = gitSource(CANDIDATE), baseline = gitSource(BASELINE), inverse = build(forward);
const builds = { forward, recovery: inverse.recovery, baseline };
const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' };
const report = { ...inverse.manifest, status: 'INCOMPLETE', groups: [], browser: null };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let n = 0; n < 150; n++) { if (await fn()) return; await pause(20); } assert.fail('bounded synthetic receiver wait expired'); }
function pass(name, detail = {}) { report.groups.push({ name, ...detail }); console.log('PASS ' + name); }
async function main() {
  const server = await startStreamServer();
  const browser = await chromium.launch({ headless: true, args: ['--host-resolver-rules=MAP * 0.0.0.0, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  report.browser = browser.version();
  async function create(rows = []) {
    const run = await openCase(browser, server, { storage: { local: {
      syncview_auth_v1: 'ok', syncview_nav: 'sample-reviews',
      syncview_calendar_pins: JSON.stringify([A, B]),
      syncview_sxr_prefs_v1: JSON.stringify({ client: A, view: 'organizer' }),
    }, session: { syncview_staff_identity_prompted_v1: '1' } } });
    const state = { build: 'forward', readStatus: 200, fallbackStatus: 500, fallback: {}, rows: new Map(rows.map(r => [r.id, { ...r }])), writes: [], held: [], logicalCreates: new Map(), served: [] };
    await run.context.routeWebSocket('**/*', socket => socket.close());
    await run.context.addInitScript(() => {
      const owned = k => k.startsWith('syncview_sxr_work_v1:') || k.startsWith('syncview_sxr_legacy_work_v1:');
      const snapshot = () => JSON.stringify(Object.fromEntries(Object.keys(localStorage).filter(owned).sort().map(k => [k, localStorage.getItem(k)])));
      // Observe the final bytes left by the previous document, BEFORE any new
      // application code. pagehide itself is too early: its async save can
      // checkpoint again before the old document is destroyed.
      sessionStorage.setItem('synthetic_recovery_entry', snapshot());
      sessionStorage.setItem('synthetic_recovery_prior_mutation', sessionStorage.getItem('synthetic_recovery_last_mutation') || snapshot());
      for (const method of ['setItem', 'removeItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function(key, ...args) {
          const result = original.call(this, key, ...args);
          if (this === localStorage && owned(String(key))) sessionStorage.setItem('synthetic_recovery_last_mutation', snapshot());
          return result;
        };
      }
    });
    await run.context.route('**/functions/v1/key-verify', route => {
      const id = route.request().postDataJSON().member.id;
      assert.ok(['synthetic-staff-1', 'synthetic-staff-2'].includes(id));
      return route.fulfill({ status: 200, contentType: 'application/json', headers, body: JSON.stringify({ ok: true, role: 'smm', member: { id, name: id === 'synthetic-staff-1' ? 'Synthetic Operator' : 'Synthetic Other', role: 'smm', team: null } }) });
    });
    await run.context.route(server.origin + '/index.html*', route => {
      const html = builds[state.build]; state.served.push(sha256(html));
      return route.fulfill({ status: 200, contentType: 'text/html', headers: { 'cache-control': 'no-store' }, body: html });
    });
    await run.context.route('**/rest/v1/sample_reviews?*', route => {
      const requestSlug = new URL(route.request().url()).searchParams.get('client');
      const body = [...state.rows.values()].filter(r => requestSlug === 'eq.' + r.client);
      return route.fulfill({ status: state.readStatus, contentType: 'application/json', headers: { ...headers, 'content-range': body.length ? `0-${body.length - 1}/${body.length}` : '*/0' }, body: JSON.stringify(state.readStatus === 200 ? body : {}) });
    });
    await run.context.route('**/*sample-review-get*', route => route.fulfill({ status: state.fallbackStatus, contentType: 'application/json', headers, body: JSON.stringify(state.fallback) }));
    await run.context.route('**/*sample-review-upsert*', route => {
      const body = route.request().postDataJSON();
      assert.equal(body.client, slug, 'no foreign owner write');
      const item = { route, body, build: state.build }; state.writes.push(item); state.held.push(item);
    });
    let navigation = 0;
    const navigate = async (next, first = false) => {
      state.build = next;
      await run.page.goto(server.origin + '/index.html?synthetic_recovery_step=' + (++navigation) + '#sample-reviews', { waitUntil: 'load' });
      await run.page.waitForFunction(() => typeof sxrState !== 'undefined' && document.getElementById('sxrView') && !sxrState.loading);
      if (first) await run.page.evaluate(() => {
        _syncviewStaffIdentitySave({ key: 'synthetic-test-key', member: { id: 'synthetic-staff-1', name: 'Synthetic Operator' }, role: 'smm' });
        _syncviewStaffIdentityVerified = true; mountSxrView(); return loadSxrCards({ skipCache: true });
      });
      // Installed after the real app listeners: capture the ACTUAL pagehide
      // checkpoint after its legitimate blank promotion/revision changes.
      await run.page.evaluate(() => {
        window.addEventListener('pagehide', () => {
          const own = Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('syncview_sxr_work_v1:') || k.startsWith('syncview_sxr_legacy_work_v1:')).sort().map(k => [k, localStorage.getItem(k)]));
          sessionStorage.setItem('synthetic_recovery_boundary', JSON.stringify(own));
        });
      });
    };
    const debt = () => run.page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k => k.startsWith('syncview_sxr_work_v1:') || k.startsWith('syncview_sxr_legacy_work_v1:')).sort().map(k => [k, localStorage.getItem(k)])));
    const boundary = () => run.page.evaluate(() => {
      const entry = sessionStorage.getItem('synthetic_recovery_entry');
      if (entry !== sessionStorage.getItem('synthetic_recovery_prior_mutation')) throw new Error('last old-document mutation differs from new-document entry');
      return JSON.parse(entry);
    });
    const settle = async (item, accepted, responseOk) => {
      if (accepted) {
        if (!state.rows.has(item.body.sample.id)) state.logicalCreates.set(item.body.sample.id, (state.logicalCreates.get(item.body.sample.id) || 0) + 1);
        state.rows.set(item.body.sample.id, { ...state.rows.get(item.body.sample.id), ...item.body.sample, client: item.body.client });
      }
      await item.route.fulfill({ status: responseOk ? 200 : 500, contentType: 'application/json', headers, body: JSON.stringify(responseOk ? { ok: true, sample: state.rows.get(item.body.sample.id) } : { ok: false }) });
    };
    const check = () => { assert.deepEqual(run.pageErrors, []); assert.deepEqual(run.network.unmocked.map(r => ({ method: r.method, path: new URL(r.url).pathname })), [], 'every remote request intercepted'); };
    await navigate('forward', true);
    return { ...run, state, navigate, debt, boundary, settle, check };
  }
  try {
    const row = { id: 'synthetic-existing', client: slug, name: 'Verified synthetic card', creative_direction: 'Original direction', status: 'In Progress' };
    const negative = await create([row]);
    try {
      await negative.navigate('baseline');
      negative.state.readStatus = 500;
      await negative.page.evaluate(() => loadSxrCards({ skipCache: true }));
      assert.equal(await negative.page.evaluate(() => sxrState.posts.length), 0);
      assert.equal(await negative.page.evaluate(() => !!sxrState.error), false);
      pass('raw baseline negative control reproduces failed read as successful emptiness');
    } finally { negative.check(); await negative.context.close(); }

    const reads = await create([row]);
    try {
      const cacheKey = 'syncview_sxr_cache_v2_' + slug;
      const cache = await reads.page.evaluate(k => localStorage.getItem(k), cacheKey);
      await reads.navigate('recovery');
      assert.equal(await reads.page.locator('#sxrStaleNotice').isVisible(), true);
      assert.equal(await reads.page.evaluate(k => localStorage.getItem(k), cacheKey), cache);
      reads.state.rows.clear();
      await reads.page.evaluate(() => loadSxrCards({ skipCache: true }));
      assert.equal(await reads.page.locator('#sxrView .cal-fld-name').first().inputValue(), row.name);
      assert.equal(await reads.page.evaluate(k => localStorage.getItem(k), cacheKey), cache);
      reads.state.readStatus = 500; reads.state.fallback = { ok: true, posts: [{ ...row, name: 'Incomplete fallback' }] };
      await reads.page.evaluate(() => loadSxrCards({ skipCache: true }));
      assert.equal(await reads.page.locator('#sxrView .cal-fld-name').first().inputValue(), row.name, '500 nonempty fallback cannot replace content');
      reads.state.fallbackStatus = 200;
      await reads.page.evaluate(() => loadSxrCards({ skipCache: true }));
      assert.equal(await reads.page.evaluate(k => localStorage.getItem(k), cacheKey), cache);
      await reads.page.evaluate(k => { localStorage.removeItem(k); sxrState.posts = []; }, cacheKey);
      await reads.page.evaluate(() => loadSxrCards({ skipCache: true }));
      assert.equal(await reads.page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Incomplete fallback');
      assert.equal(await reads.page.locator('#sxrStaleNotice').isVisible(), true);
      assert.equal(await reads.page.evaluate(k => localStorage.getItem(k), cacheKey), null);
      reads.state.fallback = { ok: true, posts: [] };
      await reads.page.evaluate(() => { sxrState.posts = []; return loadSxrCards({ skipCache: true }); });
      assert.equal(await reads.page.evaluate(() => !!sxrState.error), true);
      reads.state.readStatus = 200;
      await reads.navigate('forward');
      assert.equal(await reads.page.evaluate(() => !!sxrState.error || sxrState.posts.length > 0), false);
      assert.equal(await reads.page.locator('#sxrStaleNotice').isVisible(), false);
      pass('forward recovery forward: verified cache conserved, incomplete warned, empty failure honest, authoritative empty restored');
    } finally { reads.check(); await reads.context.close(); }

    for (const scenario of ['blank', 'typed-before-debounce', 'in-flight-create', 'in-flight-update', 'failed-create', 'ambiguous-create', 'acknowledged-create-trailing-field']) {
      const run = await create(scenario === 'in-flight-update' ? [row] : []);
      try {
        await run.page.evaluate(([k,v]) => localStorage.setItem(k,v), [archivedKey, archivedBytes]);
        if (scenario !== 'in-flight-update') await run.page.locator('button[onclick="addSxrBlankCard()"]').first().click();
        if (scenario !== 'blank') await run.page.locator('#sxrView .cal-fld-name').first().fill('Owned synthetic ' + scenario);
        if (!['blank', 'typed-before-debounce'].includes(scenario)) {
          await until(() => run.state.held.length > 0);
          if (scenario === 'failed-create' || scenario === 'ambiguous-create') {
            let failed = 0;
            await until(async () => {
              while (run.state.held.length) {
                assert.ok(++failed <= 5, 'bounded real promotion/status batches');
                await run.settle(run.state.held.shift(), scenario === 'ambiguous-create', false);
              }
              return run.page.evaluate(() => !Object.keys(_sxrSaveInFlight).length && !Object.values(_sxrSaveTimers).some(Boolean));
            });
          }
          if (scenario === 'acknowledged-create-trailing-field') {
            await run.page.locator('#sxrView [data-fld="creative_direction"]').first().fill('Trailing owned direction');
            await run.page.locator('#sxrView .cal-fld-name').first().fill('Trailing owned name');
            const initial = run.state.held.shift();
            await run.settle(initial, true, true);
            run.state.rows.get(initial.body.sample.id).asset_url = 'https://synthetic.invalid/peer-asset.mp4';
            await until(() => run.state.held.length > 0);
            assert.deepEqual(run.state.held[0].body.sample, { id: initial.body.sample.id, name: 'Trailing owned name', creative_direction: 'Trailing owned direction' });
          }
        } else assert.equal(run.state.writes.length, 0, 'still before real debounce');
        // A navigation can leave receipt unknown. No fake positive acknowledgement.
        await run.navigate('recovery');
        const conserved = await run.debt();
        assert.deepEqual(conserved, await run.boundary(), 'exact final old-document owned bytes survive recovery boot');
        assert.equal(conserved[archivedKey], archivedBytes);
        const ownedKeys = Object.keys(conserved).filter(k => k.startsWith('syncview_sxr_work_v1:'));
        assert.equal(ownedKeys.length, 1);
        const receipt = JSON.parse(conserved[ownedKeys[0]]);
        assert.equal(receipt.slug, slug);
        assert.equal(await run.page.locator('#sxrView .cal-fld-name').first().inputValue(), scenario === 'blank' ? '' : scenario === 'acknowledged-create-trailing-field' ? 'Trailing owned name' : 'Owned synthetic ' + scenario);
        const writesBeforeRefresh = run.state.writes.length;
        await run.page.evaluate(() => loadSxrCards({ skipCache: true }));
        assert.deepEqual(await run.debt(), conserved, 'refresh conserves receipts byte for byte');
        assert.equal(run.state.writes.length, writesBeforeRefresh, 'recovery never automatically replays debt');
        await run.page.locator('#sxrTabs .cal-tab', { hasText: B }).click();
        await run.page.waitForFunction(b => sxrState.client === b && !sxrState.loading, B);
        assert.equal(await run.page.locator('#sxrView .cal-fld-name').count(), 0);
        assert.deepEqual(await run.debt(), conserved);
        await run.page.evaluate(() => {
          _syncviewStaffIdentitySave({ key: 'synthetic-other-key', member: { id: 'synthetic-staff-2', name: 'Synthetic Other' }, role: 'smm' });
          _syncviewStaffIdentityVerified = true; mountSxrView(); return loadSxrCards({ skipCache: true });
        });
        assert.equal(await run.page.locator('#sxrView .cal-fld-name').count(), 0);
        assert.equal(run.state.writes.length, writesBeforeRefresh);
        assert.deepEqual(await run.debt(), conserved, 'other actor does not rewrite or claim debt');
        await run.page.evaluate(() => {
          _syncviewStaffIdentitySave({ key: 'synthetic-test-key', member: { id: 'synthetic-staff-1', name: 'Synthetic Operator' }, role: 'smm' });
          _syncviewStaffIdentityVerified = true;
        });
        await run.navigate('forward');
        assert.deepEqual(await run.debt(), conserved, 'exact original debt survives forward restoration');
        if (scenario === 'blank') {
          assert.equal(await run.page.locator('#sxrView .cal-fld-name').first().inputValue(), '');
          assert.equal(run.state.writes.length, 0);
          pass('blank: exact owned bytes forward/recovery/forward without promotion or replay');
          continue;
        }
        const countBeforeRetry = run.state.writes.length;
        await run.page.locator(`[data-saving="${receipt.post.id}"]`).click();
        await until(() => run.state.writes.length > countBeforeRetry);
        const retry = run.state.held.pop();
        assert.equal(retry.body.sample.id, receipt.post.id, 'stable ID retained through inverse');
        if (scenario === 'acknowledged-create-trailing-field') {
          assert.deepEqual(retry.body.sample, { id: receipt.post.id, name: 'Trailing owned name', creative_direction: 'Trailing owned direction' });
        }
        await run.settle(retry, true, true);
        await run.page.waitForFunction(() => !Object.keys(localStorage).some(k => k.startsWith('syncview_sxr_work_v1:')));
        assert.equal(run.state.logicalCreates.get(receipt.post.id) || 0, scenario === 'in-flight-update' ? 0 : 1, 'one logical acceptance in synthetic ID-keyed receiver');
        if (scenario === 'acknowledged-create-trailing-field') assert.equal(run.state.rows.get(receipt.post.id).asset_url, 'https://synthetic.invalid/peer-asset.mp4');
        assert.equal((await run.debt())[archivedKey], archivedBytes, 'unowned archive never consumed');
        pass(scenario + ': exact owned bytes forward/recovery/forward, explicit retry and owner isolation', { ownedReceiptSha256: sha256(JSON.stringify(conserved)), servedHtmlSha256: run.state.served });
      } finally { run.check(); await run.context.close(); }
    }
    for (const accepted of [false, true]) {
      const late = await create([row]);
      try {
        await late.navigate('recovery');
        const input = late.page.locator('#sxrView .cal-fld-name').first();
        await input.fill('Recovery-time owned update'); await input.blur();
        await until(() => late.state.held.length > 0);
        assert.equal(late.state.writes.length, 1);
        assert.equal(late.state.writes[0].build, 'recovery');
        await late.page.locator('#sxrTabs .cal-tab', { hasText: B }).click();
        await late.page.waitForFunction(b => sxrState.client === b && !sxrState.loading, B);
        await late.settle(late.state.held.shift(), accepted, accepted);
        await until(async () => {
          const records = Object.entries(await late.debt()).filter(([k]) => k.startsWith('syncview_sxr_work_v1:')).map(([,v]) => JSON.parse(v));
          return accepted ? records.length === 0 : records.length === 1 && records[0].phase === 'failed';
        });
        assert.equal(await late.page.locator('#sxrView .cal-fld-name').count(), 0, 'late recovery writer cannot paint other client');
        assert.equal(late.state.writes.length, 1);
        await late.navigate('forward');
        assert.equal(await late.page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Recovery-time owned update');
        pass('recovery-time writer late ' + (accepted ? 'acknowledgement' : 'failure') + ' settles only originating owner');
      } finally { late.check(); await late.context.close(); }
    }
    const lost = await create();
    try {
      await lost.page.locator('button[onclick="addSxrBlankCard()"]').first().click();
      await lost.page.locator('#sxrView .cal-fld-name').first().fill('Baseline cannot restore owned debt');
      await lost.navigate('baseline');
      assert.equal(await lost.page.locator('#sxrView .cal-fld-name').count(), 0);
      assert.ok(Object.keys(await lost.debt()).some(k => k.startsWith('syncview_sxr_work_v1:')));
      await lost.navigate('forward');
      assert.equal(await lost.page.locator('#sxrView .cal-fld-name').first().inputValue(), 'Baseline cannot restore owned debt');
      pass('raw baseline negative control cannot display candidate debt; forward reader restores it');
    } finally { lost.check(); await lost.context.close(); }
    report.status = 'PASS';
  } finally {
    await browser.close(); await server.close();
    const output = path.resolve(process.env.SAMPLES_RECOVERY_REPORT || '.codex-tmp/samples-recovery-report.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
