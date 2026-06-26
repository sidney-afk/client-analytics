// sxr_b2_linear_outbox_retry.js — the DURABLE Linear OUTBOX retry path.
//   • Inject a real push FAILURE (a page-level route returns {ok:false} for
//     linear-set-status, taking precedence over the harness mock).
//   • A video sub-status change then fails to push → the FE ENQUEUES a 'status'
//     item into the durable outbox (localStorage syncview_sxr_linear_outbox_v1),
//     carrying the right {issue,status} payload.
//   • Remove the failing route (harness mock {ok:true} resumes) and call
//     _sxrLinearOutboxFlush() → the queued push retries, SUCCEEDS, and the outbox
//     DRAINS to empty; the harness records the retried linear-set-status call.
// Linear is MOCKED throughout; nothing reaches real Linear.
//
// Scoped to sidneylaruel; unique sr_b2_* id; archived on exit; 0 app JS errors.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + (!c && x !== undefined ? '  -> ' + JSON.stringify(x) : '')); };
const rowOf = (id) => { try { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=*'); return Array.isArray(r) && r[0] ? r[0] : null; } catch { return null; } };
async function waitRow(id, pred, ms = 22000) { return Q.poll(() => { const r = rowOf(id); return (r && pred(r)) ? r : false; }, ms) || rowOf(id); }
const norm = (s) => String(s == null ? '' : s).trim();
const OUTBOX_KEY = 'syncview_sxr_linear_outbox_v1';
const setStatusCalls = (issue) => Q.linearCalls().filter(c => c.path === 'linear-set-status' && (!issue || (c.payload && c.payload.issue === issue)));
async function cardReady(page, id, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if (await page.evaluate((id) => !!document.querySelector(`.sxr-card[data-sxr-id="${id}"]`), id)) return true;
    await page.waitForTimeout(900);
  }
  return false;
}
const readOutbox = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } }, OUTBOX_KEY);

(async () => {
  const base = 'sr_b2_' + Date.now();
  const id = base;
  const VID = 'https://linear.app/syn/issue/VID-OB-' + base.slice(-5);
  const ts = new Date().toISOString();
  const seed = Q.up({
    id, name: 'B2 outbox retry', order_index: '1',
    asset_url: 'https://example.com/b2.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png',
    linear_issue_id: VID, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', created_at: ts,
  });
  ok(seed && seed.ok === true, 'seed live sample (video linked @ Kasper Approval)', JSON.stringify(seed).slice(0, 140));

  const browser = await Q.launch();
  try {
    const page = await Q.smm(browser, 'sidneylaruel');
    ok(await cardReady(page, id), 'SMM card rendered', String(true));

    // Start from a clean outbox.
    await page.evaluate((k) => localStorage.removeItem(k), OUTBOX_KEY);
    Q.resetLinearCalls();

    // ── 1) inject a push FAILURE for linear-set-status (page route > context mock) ──
    await page.route(/\/webhook\/linear-set-status\b/, async route => {
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false, error: 'forced failure' }) });
    });

    // Trigger a video sub-status change → push attempted → fails → enqueued.
    await page.evaluate((id) => { _sxrKasperApproveComp(id, 'video'); }, id);
    const r1 = await waitRow(id, r => norm(r.video_status) === 'Client Approval');
    ok(r1 && norm(r1.video_status) === 'Client Approval', 'video → Client Approval persisted (the save itself succeeds)', r1 && r1.video_status);

    // Poll the durable outbox until the failed push is enqueued.
    let outbox = [];
    for (let i = 0; i < 20; i++) {
      outbox = await readOutbox(page);
      if (outbox.length) break;
      await page.waitForTimeout(700);
    }
    ok(outbox.length >= 1, 'failed Linear push ENQUEUED into the durable outbox', outbox.map(o => ({ kind: o.kind, p: o.payload })));
    const item = outbox.find(o => o.kind === 'status' && o.payload && o.payload.issue === VID);
    ok(!!item, 'outbox item is a status push for the VIDEO issue', item && item.payload);
    ok(item && item.payload.status === 'Client Approval', 'outbox item carries status = Client Approval', item && item.payload);
    ok(item && typeof item.attempts === 'number' && item.id, 'outbox item has retry bookkeeping (attempts + id)', item && { attempts: item.attempts, hasId: !!item.id });

    // ── 2) recover: remove the failing route, flush the outbox → it DRAINS ──
    await page.unroute(/\/webhook\/linear-set-status\b/);
    Q.resetLinearCalls();
    await page.evaluate(() => _sxrLinearOutboxFlush());
    let drained = false;
    for (let i = 0; i < 20; i++) {
      const ob = await readOutbox(page);
      if (ob.length === 0) { drained = true; break; }
      await page.waitForTimeout(700);
    }
    ok(drained === true, 'outbox DRAINS to empty after a successful retry flush', drained);
    const retry = await Q.poll(() => { const c = setStatusCalls(VID); return c.length ? c : false; }, 8000) || [];
    ok(retry.length >= 1 && retry.some(c => c.payload && c.payload.status === 'Client Approval'),
      'the retried push reached Linear (harness recorded linear-set-status Client Approval)', retry.map(c => c.payload));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 6)));
  } finally {
    try { await browser.close(); } catch {}
    Q.archiveSafe(id);
  }
  console.log(`PROBE sxr_b2_linear_outbox_retry: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK') + '  [Linear MOCKED]');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
