// ot_temporal_kasper.js — TEMPORAL sweep of Kasper sample actions (live).
// approve→Client, request-change→Tweaks Needed, approve-after-tweaks→For SMM.
// Measures the optimistic "Saving…" indicator latency + DB-persist + card-leaves-
// queue, then fires queue reloads to prove the card never reappears (no revert).
const L = require('../sxr_courier_lib.js');
const { launch, kasper, up, supa, poll, appErrs, archiveSafe } = L;

const t = Date.now();
const APP = 'sr_tka_' + t, REQ = 'sr_tkr_' + t, AAT = 'sr_tkt_' + t;
const NAPP = 'OT-K approve ' + t, NREQ = 'OT-K request ' + t, NAAT = 'OT-K aat ' + t;
const rows = [], fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
function seed(id, nm) { up({ id, name: nm, order_index: 1, asset_url: 'https://frame.io/x/' + id, thumbnail_url: '', linear_issue_id: 'https://linear.app/syncsocial/issue/VID-' + id.slice(-4), video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval' }); }
const inQueue = (page, nm) => page.evaluate((n) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), nm);

async function expand(page, nm) {
  await page.evaluate((n) => { const c = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); if (c) (c.querySelector('.kcard-strip') || c).click(); }, nm);
  await page.waitForTimeout(400);
}
// type a draft into the panel (for request / aat)
async function draft(page, nm, msg) {
  await page.evaluate((args) => { const [n, m] = args; const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n); const p = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]'); const ta = p && p.querySelector('.cal-review-textarea'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, m); ta.dispatchEvent(new Event('input', { bubbles: true })); } }, [nm, msg]);
  await page.waitForTimeout(200);
}
// click an action button by selector, measuring the synchronous "Saving…" repaint
async function act(page, nm, btnSel) {
  return page.evaluate((args) => {
    const [n, sel] = args;
    const card = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const p = card && card.querySelector('.cal-review-panel[data-sxr-kasper-comp="video"]');
    const b = p && p.querySelector(sel);
    if (!b || b.disabled) return { ok: false };
    const t0 = performance.now(); b.click(); const t1 = performance.now();
    const card2 = [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
    const saving = card2 ? /Saving/i.test(card2.textContent) : false;
    return { ok: true, uiMs: +(t1 - t0).toFixed(1), savingShown: saving };
  }, [nm, btnSel]);
}
async function reloadsThenCheck(page, nm) {
  for (const d of [400, 1500, 3500]) { await page.waitForTimeout(d === 400 ? d : d - 1500); await page.evaluate(() => { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); }); }
  await page.waitForTimeout(1200);
  return inQueue(page, nm);
}

(async () => {
  seed(APP, NAPP); seed(REQ, NREQ); seed(AAT, NAAT);
  await poll(() => { const r = supa('id=in.(' + APP + ',' + REQ + ',' + AAT + ')&select=id'); return (Array.isArray(r) && r.length >= 3) ? r : null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await kasper(browser);
    await page.waitForFunction((n) => [...document.querySelectorAll('#kasperContent .kcard.cal-review-card')].some(c => (c.querySelector('.kcard-title') || {}).textContent === n), NAPP, { timeout: 15000 }).catch(() => {});

    // --- APPROVE → Client ---
    await expand(page, NAPP);
    const tA = Date.now();
    const ra = await act(page, NAPP, '.cal-review-approve-main');
    ok(ra.ok && ra.uiMs < 50, 'approve: optimistic UI reaction is synchronous (<50ms)', ra.uiMs + 'ms');
    const dbA = await poll(() => { const r = supa('id=eq.' + APP + '&select=video_status'); return (r[0] && r[0].video_status === 'Client Approval') ? r[0] : null; }, 14000, 400);
    const dbAms = Date.now() - tA;
    ok(!!dbA, 'approve: → Client Approval in live DB', dbAms + 'ms');
    await poll(async () => (await inQueue(page, NAPP)) ? null : true, 8000, 400);
    const goneA = await reloadsThenCheck(page, NAPP);
    ok(!goneA, 'approve: card leaves queue and does NOT reappear under reloads (no revert)');
    rows.push({ action: 'approve→Client', uiMs: ra.uiMs, dbMs: dbAms, revert: goneA });

    // --- REQUEST CHANGE → Tweaks Needed ---
    await expand(page, NREQ);
    await draft(page, NREQ, 'Kasper: tighten the intro');
    const tR = Date.now();
    const rr = await act(page, NREQ, '.cal-review-tweak-btn');
    ok(rr.ok, 'request-change: clicked', rr.uiMs + 'ms');
    const dbR = await poll(() => { const r = supa('id=eq.' + REQ + '&select=video_status'); return (r[0] && r[0].video_status === 'Tweaks Needed') ? r[0] : null; }, 14000, 400);
    const dbRms = Date.now() - tR;
    ok(!!dbR, 'request-change: → Tweaks Needed in live DB', dbRms + 'ms');
    const goneR = await reloadsThenCheck(page, NREQ);
    ok(!goneR, 'request-change: card leaves queue, no reappear (no revert)');
    rows.push({ action: 'request→Tweaks', uiMs: rr.uiMs, dbMs: dbRms, revert: goneR });

    // --- APPROVE AFTER TWEAKS → For SMM Approval ---
    await expand(page, NAAT);
    await draft(page, NAAT, 'Kasper: fix audio then send to SMM');
    const tT = Date.now();
    const rt = await act(page, NAAT, '.cal-review-aat-btn');
    ok(rt.ok, 'approve-after-tweaks: clicked', rt.uiMs + 'ms');
    const dbT = await poll(() => { const r = supa('id=eq.' + AAT + '&select=video_status,kasper_approved_after_tweaks'); return (r[0] && r[0].video_status === 'For SMM Approval') ? r[0] : null; }, 14000, 400);
    const dbTms = Date.now() - tT;
    ok(!!dbT, 'approve-after-tweaks: → For SMM Approval in live DB', dbTms + 'ms');
    ok(dbT && String(dbT.kasper_approved_after_tweaks || '').includes('video'), 'approve-after-tweaks: AAT flag set');
    const goneT = await reloadsThenCheck(page, NAAT);
    ok(!goneT, 'approve-after-tweaks: card leaves queue, no reappear (no revert)');
    rows.push({ action: 'aat→ForSMM', uiMs: rt.uiMs, dbMs: dbTms, revert: goneT });

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    [APP, REQ, AAT].forEach(id => archiveSafe(id));
  }

  console.log('\n--- Kasper timing/flicker table ---');
  rows.forEach(r => console.log(`  ${r.action.padEnd(22)} UI ${String(r.uiMs).padStart(4)}ms  DB ${String(r.dbMs).padStart(5)}ms  reappear/revert ${r.revert}`));
  console.log('\nRESULT ot_temporal_kasper: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
