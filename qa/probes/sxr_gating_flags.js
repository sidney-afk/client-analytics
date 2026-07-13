// sxr_gating_flags.js — gating rules + flag isolation on the samples system.
//   1. UNLINKED gating: with no Linear links, an unlinked graphic at Kasper
//      Approval is gated OUT of the Kasper queue (unlinked-thumbnail rule).
//   2. Finished-card stays finished on a new message (BUG-7 FIX): after Kasper
//      "Finish", a later message must NOT pull the card back to Waiting — only a
//      genuine Kasper-Approval re-route may. Parity with the calendar rule.
//   3. Flag semantics (GA rollout 2026-07-02): samples is ON BY DEFAULT (no
//      param → enabled, "Samples" nav visible). `?sxr=0` is the sticky
//      per-browser OPT-OUT: everything dormant, nav hidden, route refused.
'use strict';
const L = require('../sxr_courier_lib.js');
const { launch, smm, kasper, open, up, supa, archiveSafe, appErrs, ORIGIN } = L;

let ok = 0, fail = 0;
const t = (pass, msg, extra) => { console.log(`${pass ? '✓' : '✗'}  ${msg}${extra ? '  [' + extra + ']' : ''}`); pass ? ok++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function kasperCardState(page, cid) {
  await page.evaluate(() => { const b = document.querySelector('.kasper-subtab[data-kasper-tab="samples"]'); if (b) b.click(); if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
  await sleep(3500);
  return page.evaluate((cid) => {
    const it = (typeof _sxrKasperFindItem === 'function') && _sxrKasperFindItem(cid);
    if (!it) return 'absent';
    return (typeof _sxrKasperIsFinished === 'function' && _sxrKasperIsFinished(it.post)) ? 'finished' : 'present';
  }, cid);
}

(async () => {
  const browser = await launch();
  const ts = Date.now();
  const idU = 'sr_probe_unlinked_' + ts, idR = 'sr_probe_resurface_' + ts;
  try {
    // ---------- 1. unlinked-graphic gating ----------
    up({ id: idU, name: 'GATE unlinked ' + ts, order_index: 1, video_status: 'Approved', graphic_status: 'Kasper Approval', status: 'Kasper Approval', linear_issue_id: '', graphic_linear_issue_id: '', thumbnail_url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' });
    await sleep(1500);
    const kp = await kasper(browser);
    const stU = await kasperCardState(kp, idU);
    t(stU === 'absent', 'unlinked graphic at Kasper Approval is gated OUT of the queue', 'state=' + stU);

    // ---------- 2. finished-card resurface-on-reply (BUG-7 pin) ----------
    up({ id: idR, name: 'GATE resurface ' + ts, order_index: 2, video_status: 'Kasper Approval', graphic_status: 'Approved', status: 'Kasper Approval', linear_issue_id: 'https://linear.app/x/VID-RS' + ts, graphic_linear_issue_id: 'https://linear.app/x/GRA-RS' + ts });
    await sleep(1500);
    await kp.evaluate(() => { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
    await kp.waitForFunction((cid) => (typeof _sxrKasperFindItem === 'function') && !!_sxrKasperFindItem(cid), idR, { timeout: 20000 });
    // Kasper requests a change (decides the only undecided comp), then finishes.
    await kp.evaluate((cid) => { _sxrKasperState.drafts[cid + '|video'] = 'tighten the hook'; _sxrKasperRequestTweakComp(cid, 'video'); }, idR);
    let landed = false; for (let i = 0; i < 20 && !landed; i++) { const r = supa('id=eq.' + idR + '&select=video_status'); landed = r[0] && r[0].video_status === 'Tweaks Needed'; if (!landed) await sleep(1000); }
    t(landed, 'kasper request landed (Tweaks Needed)');
    await kp.evaluate((cid) => { _sxrKasperDismiss(cid); }, idR);
    await sleep(3000);
    const stFin = await kasperCardState(kp, idR);
    t(stFin === 'finished', 'after Finish: card partitions as finished ("Sent to SMM")', 'state=' + stFin);
    // SMM replies (a NEW MESSAGE lands after the finish stamp)…
    const sp = await smm(browser);
    await sp.waitForFunction((cid) => !!document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`), idR, { timeout: 15000 });
    await sp.evaluate((cid) => { const card = document.querySelector(`#sxrStrip .cal-card[data-pid="${cid}"]`); const b = card && card.querySelector('.cal-comments-btn, .cal-card-notes'); if (b) b.click(); }, idR);
    await sp.waitForFunction(() => { const o = document.getElementById('sxrCommentsOverlay'); return o && o.classList.contains('open'); }, { timeout: 8000 });
    await sp.evaluate(() => {
      const ta = document.getElementById('sxrCommentComposer');
      const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; set.call(ta, 'done — new cut uploaded'); ta.dispatchEvent(new Event('input', { bubbles: true }));
      const send = document.querySelector('#sxrCommentsOverlay .cal-cm-send'); if (send && !send.disabled) send.click();
    });
    await sleep(5000);
    // …and on SAMPLES the finished card STAYS finished (BUG-7 FIX). Poll until the
    // queue's in-memory post actually CONTAINS the new message, THEN assert it is
    // still partitioned as finished (not pulled back to Waiting).
    let stAfter = 'absent', sawMsg = false;
    for (let i = 0; i < 25; i++) {
      await kp.evaluate(() => { if (typeof _sxrKasperLoadQueue === 'function') _sxrKasperLoadQueue(true); });
      await sleep(2500);
      const seen = await kp.evaluate((cid) => {
        const it = (typeof _sxrKasperFindItem === 'function') && _sxrKasperFindItem(cid);
        if (!it) return { found: false };
        return { found: true, hasMsg: String(it.post.video_tweaks || JSON.stringify(it.post.comments || '')).includes('new cut uploaded'), fin: _sxrKasperIsFinished(it.post) };
      }, idR);
      if (seen.found && seen.hasMsg) { sawMsg = true; stAfter = seen.fin ? 'finished' : 'present'; break; }
    }
    t(sawMsg, 'new SMM message landed on the finished card');
    t(stAfter === 'finished', 'BUG-7 FIX: a new message does NOT resurface a FINISHED card (stays in Tweaks pending; parity with calendar)', 'state=' + stAfter);

    // ---------- 3a. GA default-ON: no param → enabled, "Samples" nav visible ----------
    const defPage = await open(browser, '/index.html');   // NO sxr param at all
    await sleep(2500);
    const def = await defPage.evaluate(() => {
      const nav = document.querySelector('#navSxr');
      return {
        enabled: (typeof _sxrEnabled === 'function') ? _sxrEnabled() : 'no-fn',
        navVisible: !!nav && getComputedStyle(nav).display !== 'none' && nav.offsetParent !== null,
        navLabel: nav ? nav.textContent.trim() : '',
        oldNavPresent: !!document.querySelector('#navSamples'),
      };
    });
    t(def.enabled === true, 'GA default: _sxrEnabled() is TRUE with no param', String(def.enabled));
    t(def.navVisible, 'GA default: "Samples" nav tab is visible');
    t(def.navLabel === 'Samples', 'GA default: SXR tab labeled "Samples"', def.navLabel);
    t(!def.oldNavPresent, 'GA default: retired "Samples Old" nav tab is absent');

    // ---------- 3b. opt-out isolation: ?sxr=0 → dormant, nav hidden, route refused ----------
    const offPage = await open(browser, '/index.html?sxr=0#sample-reviews/sidneylaruel');
    await sleep(2500);
    const off = await offPage.evaluate(() => {
      const nav = document.querySelector('#navSxr');
      return {
        navVisible: !!nav && getComputedStyle(nav).display !== 'none' && nav.offsetParent !== null,
        hash: location.hash,
        sxrViewMounted: !!document.getElementById('sxrView'),
        cards: document.querySelectorAll('#sxrStrip .cal-card').length,
        enabled: (typeof _sxrEnabled === 'function') ? _sxrEnabled() : 'no-fn',
      };
    });
    t(off.enabled === false, 'opt-out: _sxrEnabled() is false with ?sxr=0', String(off.enabled));
    t(!off.navVisible, 'opt-out: samples nav is hidden (display:none)');
    t(off.cards === 0, 'opt-out: zero sample cards rendered', String(off.cards));
    t(off.hash === '' && !off.sxrViewMounted, 'opt-out: #sample-reviews route refused (hash cleared, no sxr view mounted)', `hash="${off.hash}" mounted=${off.sxrViewMounted}`);

    for (const p of [kp, sp]) { const errs = appErrs(p) || []; if (errs.length) t(false, 'appErrs', errs[0]); }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    for (const id of [idU, idR]) { try { archiveSafe(id); } catch {} }
  }
  console.log(`\npass=${ok} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
