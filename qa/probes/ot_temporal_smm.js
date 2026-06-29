// ot_temporal_smm.js — TEMPORAL sweep of SMM Sheet interactions (live).
// For every status transition (video chain + a graphic step) and for notes
// (add + mark-done): measure UI latency + DB-persist latency, then fire the
// flicker triggers (reloads + realtime echo) and assert NO revert / NO oscillation.
const L = require('../sxr_courier_lib.js');
const { launch, smm, up, supa, poll, appErrs, archiveSafe } = L;
const T = require('../temporal_lib.js');

const id = 'sr_tsmm_' + Date.now();
const NAME = 'OT temporal SMM ' + Date.now();
const rows = [];   // timing/flicker report rows
const fails = [];
function ok(c, m, extra) { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra ? '  ' + extra : '')); if (!c) fails.push(m); }
const sSig = `(()=>{const v=document.querySelector('[data-substatus-pid="${id}"][data-substatus-comp="video"]');const g=document.querySelector('[data-substatus-pid="${id}"][data-substatus-comp="graphic"]');return 'v:'+(v?v.getAttribute('data-val'):'?')+'|g:'+(g?g.getAttribute('data-val'):'?');})()`;
const cardSel = `#sxrStrip .cal-card[data-pid="${id}"]`;

async function statusStep(page, comp, target) {
  await T.track(page, cardSel, sSig);
  const tClick = Date.now();
  // open the comp's status menu, pick the target, and measure the OPTIMISTIC
  // (synchronous) UI update right inside the click — proving the pill reflects the
  // new status before any network round-trip.
  const res = await page.evaluate((args) => {
    const [cid, comp, target] = args;
    const wrap = document.querySelector(`[data-substatus-pid="${cid}"][data-substatus-comp="${comp}"]`);
    const trig = wrap && wrap.querySelector('.cal-fld-substatus-trigger');
    if (!trig) return { picked: false, why: 'no-trigger' };
    trig.click();
    const item = [...document.querySelectorAll('.cal-fld-status-menu .cal-fld-status-item')].find(i => new RegExp('^\\s*' + target + '\\s*$', 'i').test(i.textContent));
    if (!item) return { picked: false, why: 'no-item' };
    const t0 = performance.now();
    item.click();   // synchronous _sxrStatusPick → _sxrRenderBody
    const t1 = performance.now();
    const w2 = document.querySelector(`[data-substatus-pid="${cid}"][data-substatus-comp="${comp}"]`);
    return { picked: true, uiMs: +(t1 - t0).toFixed(1), valAfter: w2 ? w2.getAttribute('data-val') : null };
  }, [id, comp, target]);
  if (!res.picked) { ok(false, `${comp} → ${target}: open+pick`, res.why); return; }
  // DB-persist latency
  const col = comp + '_status'; const tDb = Date.now(); let dbMs = null;
  while (Date.now() - tDb < 14000) { const r = supa('id=eq.' + id + '&select=' + col); if (r[0] && r[0][col] === target) { dbMs = Date.now() - tClick; break; } await page.waitForTimeout(300); }
  // flicker/revert stress
  await T.fireFlickerTriggers(page, 'sidneylaruel');
  const tl = await T.timeline(page);
  const a = T.analyse(tl, await T.curSig(page));
  ok(res.valAfter === target, `${comp} → ${target}: pill updates OPTIMISTICALLY (synchronous)`, res.uiMs + 'ms, val=' + res.valAfter);
  ok(dbMs != null, `${comp} → ${target}: DB persisted`, dbMs + 'ms');
  ok(!a.reverted, `${comp} → ${target}: NO revert under reload+echo`, 'states after: ' + JSON.stringify(a.statesAfter));
  ok(a.flips <= 1, `${comp} → ${target}: no oscillation`, 'flips=' + a.flips);
  rows.push({ action: `${comp}→${target}`, uiMs: res.uiMs, dbMs, flips: a.flips, reverted: a.reverted });
}

(async () => {
  const now = new Date().toISOString();
  const openReq = [{ id: 'cm_tsmm_' + Date.now(), parent_id: null, author: 'Client', role: 'client', is_tweak: true, audience: 'client', round: 1, body: 'Open change request to resolve', created_at: now, updated_at: now, done: false, done_at: '', done_by: '' }];
  up({ id, name: NAME, order_index: 1, asset_url: 'https://frame.io/x', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', video_tweaks: JSON.stringify(openReq) });
  await poll(() => { const r = supa('id=eq.' + id + '&select=id'); return r[0] || null; }, 12000, 800);

  const browser = await launch();
  try {
    const page = await smm(browser);
    await page.waitForFunction((s) => !!document.querySelector(s), cardSel, { timeout: 12000 }).catch(() => {});

    // VIDEO status chain
    await statusStep(page, 'video', 'For SMM Approval');
    await statusStep(page, 'video', 'Kasper Approval');
    await statusStep(page, 'video', 'Client Approval');
    await statusStep(page, 'video', 'Approved');
    // GRAPHIC step (worst-of: overall should follow)
    await statusStep(page, 'graphic', 'Kasper Approval');

    // NOTES: add a note + mark it done, with flicker/revert stress
    const noteSig = `(()=>{const f=document.getElementById('sxrCommentsFeed');return f?('len:'+f.textContent.length+'|res:'+(f.textContent.match(/Resolved/g)||[]).length):'closed';})()`;
    await page.click(`${cardSel} .cal-comments-btn, ${cardSel} .cal-card-notes`);
    await page.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 6000 }).catch(() => {});
    await T.track(page, '#sxrCommentsOverlay', noteSig);
    const tNote = Date.now();
    await page.evaluate(() => { const ta = document.getElementById('sxrCommentComposer'); if (ta) { const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, 'Temporal note — tighten the open'); ta.dispatchEvent(new Event('input', { bubbles: true })); } });
    await page.waitForTimeout(150);
    await page.evaluate(() => { const b = document.querySelector('#sxrCommentsOverlay .cal-cm-send') || document.querySelector('.cal-cm-send'); if (b && !b.disabled) b.click(); });
    const noteShown = await poll(() => { const r = supa('id=eq.' + id + '&select=video_tweaks'); try { const arr = JSON.parse((r[0] && r[0].video_tweaks) || '[]'); return arr.some(c => /tighten the open/.test(c.body || '')) ? r[0] : null; } catch { return null; } }, 12000, 600);
    ok(!!noteShown, 'note: persisted to live DB', (Date.now() - tNote) + 'ms');
    await T.fireFlickerTriggers(page, 'sidneylaruel');
    const ntl = await T.timeline(page);
    const na = T.analyse(ntl, await T.curSig(page));
    ok(!na.reverted, 'note: NO revert/disappear under reload+echo', JSON.stringify(na.statesAfter));

    // mark-done (resolve) the seeded CHANGE REQUEST — it must STAY resolved (not flip back)
    const resolveSig = `(()=>{const r=${'`'}id=eq.${id}${'`'};return 'x';})()`;  // (sig recomputed below via DB)
    const tDone = Date.now();
    const clickedDone = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('#sxrCommentsFeed .cal-cm-action')].find(b => /Mark done/i.test(b.textContent));
      if (btn) { const t0 = performance.now(); btn.click(); const t1 = performance.now(); return { ok: true, uiMs: +(t1 - t0).toFixed(1) }; }
      return { ok: false };
    });
    ok(clickedDone.ok, 'mark-done: "Mark done" control present on the change request', clickedDone.ok ? clickedDone.uiMs + 'ms (optimistic)' : 'not found');
    if (clickedDone.ok) {
      // persisted as done in the live DB
      const doneRow = await poll(() => { const r = supa('id=eq.' + id + '&select=video_tweaks'); try { const arr = JSON.parse((r[0] && r[0].video_tweaks) || '[]'); return arr.some(c => c.done === true) ? r[0] : null; } catch { return null; } }, 12000, 600);
      ok(!!doneRow, 'mark-done: persisted done=true in live DB', (Date.now() - tDone) + 'ms');
      // flicker/revert: track the resolved-pill count in the feed
      await T.track(page, '#sxrCommentsOverlay', `(()=>{const f=document.getElementById('sxrCommentsFeed');return f?('res:'+(f.textContent.match(/Resolved/g)||[]).length):'closed';})()`);
      await T.fireFlickerTriggers(page, 'sidneylaruel');
      const rtl = await T.timeline(page);
      const ra = T.analyse(rtl, await T.curSig(page));
      ok(!ra.reverted, 'mark-done: stays resolved (no flip back) under reload+echo', JSON.stringify(ra.statesAfter));
    }

    ok((await appErrs(page)).length === 0, 'zero app JS errors', (await appErrs(page)).slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    ok(archiveSafe(id), 'cleanup: archived');
  }

  console.log('\n--- SMM timing/flicker table ---');
  rows.forEach(r => console.log(`  ${r.action.padEnd(28)} UI ${String(r.uiMs).padStart(4)}ms  DB ${String(r.dbMs).padStart(5)}ms  flips ${r.flips}  reverted ${r.reverted}`));
  console.log('\nRESULT ot_temporal_smm: ' + (fails.length ? 'FAIL (' + fails.length + ') — ' + fails.join('; ') : 'PASS'));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('PROBE ERROR', e && e.stack || e); process.exit(2); });
