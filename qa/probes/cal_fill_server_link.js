// cal_fill_server_link.js — ON DEMAND, not nightly: it creates real work items.
// Live proof on the TEST client that filling a missing thumbnail links the card
// in the SAME production-write request (OPEN_REPAIRS 254): make a video-only
// post through the real Create Post, press the fill button with the browser's
// own follow-up card write BLOCKED, and check the card already carries the new
// thumbnail id and that nothing else on it changed. Cleans up after itself:
// cancels every work item it made and archives every card.
// Run after a production-write deploy: node qa/probes/cal_fill_server_link.js
'use strict';
const H = require('./ot4_lib.js');
const L = require('../sxr_courier_lib.js');
const { TEST_CLIENT } = require('../test-client-entry.js');
const { launch, open, SUPA, KEY } = H;
const TEST = 'sidneylaruel';
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
const TS = Date.now();
const res = []; const ok = (c, m, x) => { res.push(!!c); console.log((c ? 'PASS ' : 'FAIL ') + m + (x ? '  [' + x + ']' : '')); };
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
const card = id => rest('calendar_posts', `client=eq.${TEST}&id=eq.${encodeURIComponent(id)}&select=*`).then(r => r[0] || null);
async function cancel(browser, id) {
  const p = await page(browser, '/index.html?prod=1#production');
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 }).catch(() => {});
  await p.evaluate(i => _prodRunPickerWrite('status', [i], 'canceled'), id).catch(() => {});
  const d = await poll(() => rest('deliverables', `id=eq.${encodeURIComponent(id)}&select=status`).then(r => (r[0] || {}).status), s => s === 'canceled', 30000);
  await p.context().close();
  return d === 'canceled';
}
(async () => {
  const browser = await launch();
  let pid = null, vid = null, gid = null;
  try {
    // 1. A test card with a video and no thumbnail, through the real Create Post.
    const name = 'Fill link probe ' + TS;
    const p = await page(browser, '/index.html#calendar/' + TEST);
    await p.waitForFunction(() => typeof _calOpenNativePost === 'function', null, { timeout: 60000 });
    await p.waitForTimeout(4000);
    await p.evaluate(([n, s]) => _calOpenNativePost(n, s, 'calendar'), [TEST_CLIENT.name, TEST]);
    await p.waitForSelector('#calNativePostCreate', { timeout: 20000 });
    await p.check('input[name=calNativeModeChoice][value=video]');
    await p.locator('#calNativePostNames input').first().fill(name);
    const bn = p.locator('#calNativeBatchName'); if (await bn.count()) await bn.fill('Fill link probe ' + TS);
    await p.click('#calNativePostCreate');
    await p.waitForFunction(() => !document.getElementById('calNativePostOverlay'), null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(15000);
    await p.context().close();
    const row = await poll(() => rest('calendar_posts', `client=eq.${TEST}&name=like.*${encodeURIComponent(name)}&select=id,video_deliverable_id,graphic_deliverable_id`).then(r => r[0]), r => r && r.video_deliverable_id, 60000);
    ok(!!row && !row.graphic_deliverable_id, 'step 1: test card has a video work item and no thumbnail', row && row.id);
    if (!row) return;
    pid = row.id; vid = row.video_deliverable_id;
    await sleep(3000);
    const before = await card(pid);

    // 2. Press the fill button, with the browser's own card write blocked.
    const f = await page(browser, '/index.html#calendar/' + TEST);
    let fillResponse = null, blocked = 0, upsertsBefore = 0;
    let fillDone = false;
    f.on('response', async r => {
      if (r.url().includes('/functions/v1/production-write') && r.request().method() === 'POST') {
        const body = r.request().postData() || '';
        if (body.includes('"component_fill"')) { try { fillResponse = await r.json(); } catch (e) { fillResponse = { parseErr: true }; } fillDone = true; }
      }
    });
    await f.context().route(u => /calendar-upsert/.test(u.toString()), r => {
      if (fillDone || /component-fill/.test(JSON.stringify(r.request().headers()) + (r.request().postData() || ''))) { blocked++; return r.abort(); }
      upsertsBefore++; return r.fallback();
    });
    await f.waitForFunction(i => typeof calState === 'object' && (calState.posts || []).some(x => x.id === i), pid, { timeout: 90000 });
    await f.waitForTimeout(3000);
    await f.evaluate(() => { window.showConfirm = (t, m, cb) => cb(); });
    await f.evaluate(i => _calFillComponent(i, 'graphic'), pid);
    await poll(async () => fillDone, v => v, 60000);
    await sleep(1500);

    // 3. The card holds the thumbnail link from the server alone.
    const after = await card(pid);
    gid = fillResponse && fillResponse.item && fillResponse.item.id;
    ok(fillResponse && fillResponse.ok === true && !!gid, 'step 2: fill request succeeded and made a thumbnail work item', gid);
    ok(fillResponse && fillResponse.card_link && fillResponse.card_link.linked === 1, 'server reply reports it linked the card', JSON.stringify(fillResponse && fillResponse.card_link));
    ok(blocked >= 1, 'the browser\'s own card write was blocked', 'blocked=' + blocked);
    ok(after && after.graphic_deliverable_id === gid, 'step 3: card carries the new thumbnail id with no browser write', after && after.graphic_deliverable_id);

    // 4. Nothing else changed.
    const changed = Object.keys(Object.assign({}, before, after)).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    ok(changed.filter(k => !['graphic_deliverable_id', 'updated_at'].includes(k)).length === 0, 'step 4: only graphic_deliverable_id and updated_at changed', changed.join(','));
    ok(after.video_deliverable_id === vid, 'video link unchanged');
    const dv = await rest('deliverables', `id=eq.${encodeURIComponent(gid)}&select=card_id,team,client_slug`);
    ok(dv[0] && dv[0].card_id === pid && dv[0].team === 'graphics' && dv[0].client_slug === TEST, 'the thumbnail work item points back at this card');
    await f.context().close();
  } catch (e) {
    ok(false, 'raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 160));
  } finally {
    // 5. Clean up.
    // Every work item and card this check made, including earlier attempts.
    const mine = await rest('production_deliverables_browser_v1', `client_slug=eq.${TEST}&title=like.*${encodeURIComponent('Fill link probe')}*&select=id,card_id,status`);
    for (const d of mine.filter(d => d.status !== 'canceled')) ok(await cancel(browser, d.id), 'cleanup: work item canceled ' + d.id);
    await browser.close();
    const cards = await rest('calendar_posts', `client=eq.${TEST}&name=like.*${encodeURIComponent('Fill link probe')}*&status=neq.archived&select=id`);
    for (const c of cards) ok(L.archiveCalSafe(c.id) !== false, 'cleanup: card archived ' + c.id);
    console.log(`\npass=${res.filter(Boolean).length} fail=${res.filter(x => !x).length}`);
    process.exit(res.every(Boolean) ? 0 : 1);
  }
})();
