// workload_plan_set_clear_live.js — live proof on the TEST client that a
// Workload work day SETS and CLEARS, survives a fresh page load, and is put back.
// Workload only shows live work (not Backlog / client approval / done), and the
// TEST client normally has none, so the probe first moves ONE TEST sub-issue
// from Backlog to Todo through the real SyncLinear status write, and moves it
// back afterwards. Every write is TEST-client only and restored.
'use strict';
const H = require('./ot4_lib.js');
const { launch, open, SUPA, KEY } = H;
const TEST = 'sidneylaruel';
const results = []; const ok = (c, m) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m); };
const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
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
async function dbStatus(id) {
  const r = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${encodeURIComponent(id)}&client_slug=eq.${TEST}&select=status`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
  return ((await r.json())[0] || {}).status || null;
}
async function setStatus(browser, id, status) {
  const p = await page(browser, '/index.html?prod=1#production');
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 90000 });
  await p.evaluate(([i, s]) => _prodRunPickerWrite('status', [i], s), [id, status]);
  for (let k = 0; k < 20 && (await dbStatus(id)) !== status; k++) await sleep(1500);
  await p.context().close();
  return (await dbStatus(id)) === status;
}
async function board(browser, id) {
  const p = await page(browser, '/index.html#workload');
  await p.waitForFunction(() => typeof wlState === 'object' && (wlState.allActiveSubs || []).length > 0 && wlPlanEditingEnabled(), null, { timeout: 90000 });
  const found = await p.evaluate(i => (wlState.allActiveSubs || []).some(r => String(r.id) === i), id);
  return { p, found };
}
const planOf = (p, id) => p.evaluate(i => { const x = (wlState.allActiveSubs || []).find(r => String(r.id) === i); return x ? (wlPlanDate(x) || null) : 'missing'; }, id);
(async () => {
  const browser = await launch();
  let id = null, origStatus = null, origPlan = null, moved = false;
  try {
    // A backlog TEST sub-issue whose assignee is a live creative (so Workload lists it).
    const q = await fetch(`${SUPA}/rest/v1/deliverables?client_slug=eq.${TEST}&status=eq.backlog&assignee_id=not.is.null&select=id&order=id&limit=10`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } });
    const cands = (await q.json()).map(r => r.id);
    ok(cands.length > 0, 'found TEST backlog sub-issues with an assignee');
    for (const c of cands) {
      origStatus = await dbStatus(c);
      if (!(await setStatus(browser, c, 'todo'))) continue;
      moved = true; id = c;
      let vis = false;
      for (let k = 0; k < 6 && !vis; k++) { await sleep(10000); const b = await board(browser, c); vis = b.found; if (vis) origPlan = await planOf(b.p, c); await b.p.context().close(); }
      if (vis) break;
      await setStatus(browser, c, origStatus); moved = false; id = null;
    }
    ok(!!id, 'a TEST sub-issue moved to Todo shows on the Workload board');
    if (!id) return;
    const day = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    let b = await board(browser, id);
    ok(await b.p.evaluate(([i, v]) => wlSetPlanDate(i, v), [id, day]), 'set work day accepted');
    await b.p.context().close();
    b = await board(browser, id);
    ok(await planOf(b.p, id) === day, 'set work day survives a fresh page load');
    ok(await b.p.evaluate(i => wlSetPlanDate(i, null), id), 'clear work day accepted');
    await b.p.context().close();
    b = await board(browser, id);
    ok(await planOf(b.p, id) === null, 'cleared work day survives a fresh page load');
    if (origPlan) await b.p.evaluate(([i, v]) => wlSetPlanDate(i, v), [id, origPlan]);
    await b.p.context().close();
  } catch (e) {
    ok(false, 'workload flow raised: ' + String(e && e.message || e).split('\n')[0].slice(0, 120));
  } finally {
    if (moved && id) ok(await setStatus(browser, id, origStatus), 'restored: sub-issue back to its original status');
    await browser.close();
    console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length}`);
    process.exit(results.every(Boolean) ? 0 : 1);
  }
})();
