// kasper_samples_native_live.js — live proof on the TEST client that a Kasper
// review save lands on a NATIVE sample: create a sample through the real
// Samples "Create post" dialog, give it a video link, move its sub-issue to
// Kasper approval, approve it as Kasper, check the sample and sub-issue both
// advance to client approval, then archive the sample and cancel its sub-issue.
'use strict';
const H = require('./ot4_lib.js');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');
const { launch, open, SUPA, KEY } = H;
const TEST = 'sidneylaruel';
const results = []; const ok = (c, m, x) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m + (x ? '  [' + x + ']' : '')); };
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
const TS = Date.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(browser, route) {
  const p = await open(browser, '/qa/dawn/blank.html');
  await p.context().route(u => u.toString().startsWith(SUPA + '/functions/v1/'), r => {
    const h = r.request().headers();
    if (!h['x-syncview-key']) return r.fallback();
    return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': REAL }, ACTOR ? { 'x-syncview-actor': ACTOR } : {}) });
  });
  await p.goto(H.ORIGIN + route, { waitUntil: 'domcontentloaded' });
  return p;
}
async function rest(table, qs) {
  const r = await fetch(`${SUPA}/rest/v1/${table}?${qs}`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
  return r.json();
}
async function poll(fn, pred, ms) { const t = Date.now(); let v; while (Date.now() - t < ms) { v = await fn(); if (pred(v)) return v; await sleep(2000); } return null; }
const sample = id => rest('sample_reviews', `id=eq.${encodeURIComponent(id)}&client=eq.${TEST}&select=status,video_status,video_deliverable_id`).then(r => r[0] || null);
const deliv = id => rest('deliverables', `id=eq.${encodeURIComponent(id)}&client_slug=eq.${TEST}&select=status`).then(r => (r[0] || {}).status || null);
async function prodStatus(browser, id, status) {
  const p = await page(browser, '/index.html?prod=1#production');
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 });
  await p.evaluate(([i, s]) => _prodRunPickerWrite('status', [i], s), [id, status]);
  const done = await poll(() => deliv(id), s => s === status, 30000);
  await p.context().close();
  return !!done;
}
(async () => {
  const browser = await launch();
  let pid = null, did = null;
  try {
    const name = 'Atlas Kasper probe ' + TS;
    const p = await page(browser, '/index.html?sxr=1#sample-reviews/' + TEST);
    await p.waitForFunction(() => window.sxrV2Status && window.sxrV2Status().ready, null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(3000);
    await p.evaluate(([n, s]) => _calOpenNativePost(n, s, 'sxr'), [TEST_CLIENT.name, TEST]);
    await p.waitForSelector('#calNativePostCreate', { timeout: 20000 });
    await p.check('input[name=calNativeModeChoice][value=video]').catch(() => {});
    await p.locator('#calNativePostNames input').first().fill(name);
    const bn = p.locator('#calNativeBatchName'); if (await bn.count()) await bn.fill('Atlas probe ' + TS);
    await p.click('#calNativePostCreate');
    await p.waitForFunction(() => !document.getElementById('calNativePostOverlay'), null, { timeout: 60000 }).catch(() => {});
    await p.context().close();
    const row = await poll(() => rest('sample_reviews', `client=eq.${TEST}&name=like.*${encodeURIComponent(name)}&select=id,video_deliverable_id`).then(r => r[0]), r => r && r.video_deliverable_id, 60000);
    ok(!!row, 'Samples "Create post" made a native TEST sample with a linked sub-issue');
    if (!row) return;
    pid = row.id; did = row.video_deliverable_id;
    L.up({ id: pid, asset_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    // The SMM sends it to Kasper from the Samples status menu (the real handler).
    // A SyncLinear status change does NOT move a sample card: samples-origin rows
    // are out of scope of the calendar status projection by design.
    const sm = await page(browser, '/index.html?sxr=1#sample-reviews/' + TEST);
    await sm.waitForFunction(i => typeof sxrState === 'object' && (sxrState.posts || []).some(x => x.id === i && x.asset_url), pid, { timeout: 90000 }).catch(() => {});
    await sm.evaluate(i => _sxrStatusPick(i, 'Kasper Approval', 'video'), pid);
    await sm.waitForTimeout(6000);
    await sm.context().close();
    const inQ = await poll(() => sample(pid), s => s && s.video_status === 'Kasper Approval', 60000);
    ok(!!inQ, 'SMM sent it to Kasper: sample shows Kasper Approval', inQ ? '' : JSON.stringify(await sample(pid)));
    const k = await page(browser, '/index.html?Kasper=1&sxr=1#kasper');
    // Same Kasper unlock + Samples sub-tab the courier kasper() page uses.
    await k.evaluate(() => { try { sessionStorage.setItem('syncview_kasper_unlocked', 'ok'); } catch (e) {} });
    await k.reload({ waitUntil: 'domcontentloaded' });
    await k.waitForFunction(() => typeof window._kasperGotoTab === 'function', null, { timeout: 60000 }).catch(() => {});
    await k.evaluate(() => { try { window._kasperGotoTab('samples'); } catch (e) {} });
    await k.waitForFunction(n => typeof _sxrKasperApproveComp === 'function' && document.body.innerText.includes(n), name, { timeout: 90000 }).catch(() => {});
    const visible = await k.evaluate(n => document.body.innerText.includes(n), name);
    ok(visible, 'sample is in Kasper\'s review queue');
    await k.evaluate(i => _sxrKasperApproveComp(i, 'video'), pid);
    const s2 = await poll(() => sample(pid), s => s && s.video_status === 'Client Approval', 60000);
    ok(!!s2, 'Kasper approve saved: sample → Client Approval', s2 ? '' : JSON.stringify(await sample(pid)));
    const d2 = await poll(() => deliv(did), s => s === 'client_approval', 60000);
    ok(!!d2, 'Kasper approve saved: sub-issue → client_approval', d2 || String(await deliv(did)));
    await k.context().close();
  } catch (e) {
    ok(false, 'kasper flow raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 120));
  } finally {
    if (did) ok(await prodStatus(browser, did, 'canceled'), 'cleanup: probe sub-issue canceled');
    await browser.close();
    if (pid) { const a = L.archiveSafe(pid); ok(a !== false, 'cleanup: probe sample archived'); }
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
