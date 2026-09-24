// rename_subissue_to_card_live.js — release 2 live proof on the TEST client:
// rename a sub-issue in SyncLinear (real title-edit UI), then check the card
// and its sibling sub-issue follow, then restore through the same UI.
'use strict';
const H = require('./ot4_lib.js');
const { launch, open, SUPA, KEY } = H;
const TEST = 'sidneylaruel';
const results = []; const ok = (c, m) => { results.push(!!c); console.log((c ? '✓  ' : '✗  ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function del(id) { const r = await fetch(`${SUPA}/rest/v1/deliverables?id=eq.${id}&select=title,card_id,linear_issue_uuid`, { headers: { apikey: KEY, authorization: 'Bearer ' + KEY } }); return (await r.json())[0]; }
async function poll(fn, pred, ms) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (pred(v)) return v; await sleep(2000); } return null; }
async function target() {
  const rows = H.supaCal(`client=eq.${TEST}&status=neq.Archived&video_deliverable_id=not.is.null&graphic_deliverable_id=not.is.null&select=id,name,video_deliverable_id,graphic_deliverable_id&order=id`) || [];
  for (const r of rows) {
    const v = await del(r.video_deliverable_id), g = await del(r.graphic_deliverable_id);
    if (v && g && v.card_id === r.id && g.card_id === r.id && !v.linear_issue_uuid && !g.linear_issue_uuid && v.title.includes(r.name) && g.title.includes(r.name)) return { card: r, vT: v.title, gT: g.title };
  }
  return null;
}
async function renameIn(browser, id, name) {
  const p = await open(browser, '/qa/dawn/blank.html');
  const REAL = String(process.env.SYNCVIEW_ROLE_KEY || process.env.SYNCVIEW_STAFF_KEY || '').trim();
  await p.context().route(u => u.toString().startsWith(SUPA + '/functions/v1/'), r => {
    const h = r.request().headers();
    const ACTOR = String(process.env.SYNCVIEW_ACTOR || '').trim();
    if (!h['x-syncview-key']) return r.fallback();
    return r.fallback({ headers: Object.assign({}, h, { 'x-syncview-key': REAL }, ACTOR ? { 'x-syncview-actor': ACTOR } : {}) });
  });
  await p.goto(H.ORIGIN + '/index.html?prod=1#production', { waitUntil: 'domcontentloaded' });
  p.on('response', r => { if (/functions\/v1\//.test(r.url()) && r.request().method()==='POST') console.log('   fn', r.url().split('/v1/')[1].split('?')[0], r.status()); });
  await p.waitForFunction(i => typeof _prodIssue === 'function' && !!_prodIssue(i), id, { timeout: 60000 });
  await p.evaluate(i => { _prodState.view = 'detail'; _prodState.openId = i; _prodRender(); }, id);
  const h = p.locator(`[data-prod-title-edit="${id}"]`);
  await h.waitFor({ timeout: 20000 });
  await h.click();
  const inp = p.locator('.prod-title-input'); await inp.fill(name); await inp.press('Enter');
  await sleep(8000); if (process.env.DBG) console.log('   toasts:', await p.evaluate(() => [...document.querySelectorAll('[class*=toast]')].map(e => e.innerText.trim()).filter(Boolean).join(' | ')));
  const toast = await p.waitForFunction(() => /Renamed\. The card will follow|didn.t|couldn.t|error/i.test(document.body.innerText), null, { timeout: 30000 }).then(() => p.evaluate(() => (document.body.innerText.match(/Renamed\. The card will follow\./) || ['other'])[0])).catch(() => 'none');
  if (process.env.DBG) { await p.screenshot({ path: '/tmp/claude-0/rn.png' }); console.log('   text:', (await p.evaluate(() => document.body.innerText)).replace(/\s+/g,' ').slice(0,300)); }
  await p.context().close();
  return toast;
}
(async () => {
  const t = await target(); if (!t) { ok(false, 'found a TEST card with two native sub-issues'); process.exit(1); }
  const orig = t.card.name, NEW = (orig + ' · atlas').slice(0, 150);
  const browser = await launch();
  try {
    const toast = await renameIn(browser, t.card.video_deliverable_id, NEW);
    ok(toast.startsWith('Renamed'), 'SyncLinear confirms the rename  [' + toast + ']');
    const v = await del(t.card.video_deliverable_id); ok(v.title.includes(NEW), 'video sub-issue saved with the new name');
    const c = await poll(async () => (H.supaCal(`id=eq.${t.card.id}&select=name`) || [])[0], r => r && r.name === NEW, 180000);
    ok(!!c, 'card name followed');
    const g = await poll(() => del(t.card.graphic_deliverable_id), r => r && r.title.includes(NEW), 180000);
    ok(!!g, 'sibling (graphic) sub-issue followed');
  } finally {
    await renameIn(browser, t.card.video_deliverable_id, orig).catch(() => {});
    const c = await poll(async () => (H.supaCal(`id=eq.${t.card.id}&select=name`) || [])[0], r => r && r.name === orig, 180000);
    const v = await del(t.card.video_deliverable_id), g = await poll(() => del(t.card.graphic_deliverable_id), r => r && r.title === t.gT, 180000);
    ok(!!c && v.title === t.vT && !!g, 'restored: card, video and graphic back to their exact originals');
    await browser.close();
  }
  console.log(`\npass=${results.filter(Boolean).length} fail=${results.filter(x => !x).length}`);
  process.exit(results.every(Boolean) ? 0 : 1);
})();
