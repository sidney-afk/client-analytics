// ot4_t0_client_edge_conditions.js — TIER 0 edge conditions on the samples
// CLIENT share link, all through real clicks:
//   P1 TOKEN — the ?t= link variant loads and its approve lands (the legacy
//      writer is un-gated; the token only rides edge-function calls — freeze
//      contract: existing links keep working, with or without token).
//   P2 MOBILE — 390×844 touch viewport: controls render inside the viewport,
//      a typed request-change lands in the DB.
//   P3 SLOW NETWORK — the save round-trip delayed 4 s: the panel shows a real
//      saving state (buttons disabled), no premature success, then the save
//      lands and the UI settles with no error.
//   P4 FAILURE — the save endpoint forced to 500: characterizes BUG F-1 (see
//      qa/OVERNIGHT_TEST_REPORT.md RUN 4): the failure is detected internally
//      but announced NOWHERE the client can see; DB stays untouched; after a
//      reload + recovery a re-sent request lands. When F-1 is fixed, flip the
//      CHARACTERIZED asserts to demand a visible announcement + preserved draft.
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, up, archiveSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const POLL = 35000;
const IDS = { tok: `sr_ot4e_tok_${TS}`, mob: `sr_ot4e_mob_${TS}`, slow: `sr_ot4e_slow_${TS}`, fail: `sr_ot4e_fail_${TS}` };
const NAMES = { tok: `OT4 Token ${TS}`, mob: `OT4 Mobile ${TS}`, slow: `OT4 SlowNet ${TS}`, fail: `OT4 FailSave ${TS}` };

function seed(key, i) {
  up({ id: IDS[key], name: NAMES[key], order_index: i + 1,
    video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
    thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
}

(async () => {
  const browser = await launch();
  try {
    Object.keys(IDS).forEach((k, i) => seed(k, i));
    await H.pollRow(() => H.rowSxr(IDS.fail, 'id,status'), r => r.status === 'Client Approval');

    // ---- P1: token link ----------------------------------------------------
    {
      const p = await client(browser, undefined, 'ot4-qa-token-' + TS);
      const a = await H.clientAct(p, NAMES.tok, 'video', 'approve');
      t(a === 'ok', 'P1: token link loads; approve clickable', a);
      const r = await H.pollRow(() => H.rowSxr(IDS.tok, 'video_status'), x => x.video_status === 'Approved', POLL);
      t(!!r && r.video_status === 'Approved', 'P1: approve via token link landed in DB');
      t(appErrs(p).length === 0, 'P1: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P2: mobile viewport ----------------------------------------------
    {
      const p = await client(browser, undefined, undefined, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await H.expandReview(p, NAMES.mob);
      const fit = await p.evaluate((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-tweak-btn');
        const ta = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-textarea');
        if (!b || !ta) return { ok: false };
        const rb = b.getBoundingClientRect(), rt = ta.getBoundingClientRect();
        return { ok: true, btnIn: rb.right <= 391 && rb.left >= -1 && rb.width > 0, taIn: rt.right <= 391 && rt.left >= -1 && rt.width > 0 };
      }, NAMES.mob);
      t(fit.ok && fit.btnIn && fit.taIn, 'P2: mobile 390px — composer + request button fit the viewport', JSON.stringify(fit));
      const a = await H.clientAct(p, NAMES.mob, 'video', 'request', 'OT4 mobile req ' + TS);
      t(a === 'ok', 'P2: mobile typed request-change clicked', a);
      const r = await H.pollRow(() => H.rowSxr(IDS.mob, 'video_status,video_tweaks'), x => x.video_status === 'Tweaks Needed', POLL);
      t(!!r && r.video_status === 'Tweaks Needed' && JSON.stringify(r.video_tweaks || '').includes('OT4 mobile req'), 'P2: mobile request-change landed with text');
      t(appErrs(p).length === 0, 'P2: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P3: slow network --------------------------------------------------
    {
      const p = await client(browser);
      await p.route('**/sample-review-upsert*', async (route) => {
        await new Promise(r => setTimeout(r, 4000));
        await route.fallback();
      });
      await H.expandReview(p, NAMES.slow);
      const clicked = await p.evaluate((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        const b = card && card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
        if (!b || b.disabled) return 'no-btn';
        b.click(); return 'ok';
      }, NAMES.slow);
      t(clicked === 'ok', 'P3: approve clicked under a 4s-delayed network', clicked);
      // The repaint REPLACES the card node — re-query fresh from document. While
      // the slow save is in flight the acted panel must not offer a clickable
      // stale Approve (optimistic approved state or disabled control both count).
      const savingState = await p.waitForFunction((n) => {
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        if (!card) return { gone: true };
        const b = card.querySelector('.cal-review-panel[data-comp="video"] .cal-review-approve-btn');
        return (!b || b.disabled) ? { staleClickable: false } : false;
      }, NAMES.slow, { timeout: 2500 }).then(h => h.jsonValue()).catch(() => null);
      t(!!savingState, 'P3: during the slow save no stale clickable Approve remains (instant honest UI)', JSON.stringify(savingState));
      const r = await H.pollRow(() => H.rowSxr(IDS.slow, 'video_status'), x => x.video_status === 'Approved', POLL);
      t(!!r && r.video_status === 'Approved', 'P3: slow save still landed in DB');
      await H.sleep(1200);
      const ps = await H.panelState(p, NAMES.slow, 'video');
      t(!ps.error, 'P3: no error shown after the slow save settled', ps.error);
      t(appErrs(p).length === 0, 'P3: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- P4: failure injection --------------------------------------------
    {
      const p = await client(browser);
      let block = true;
      await p.route('**/sample-review-upsert*', async (route) => {
        if (block) return route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":false}' });
        await route.fallback();
      });
      const REQ = 'OT4 fail-then-retry ' + TS;
      const a = await H.clientAct(p, NAMES.fail, 'graphic', 'request', REQ);
      t(a === 'ok', 'P4: request-change clicked while backend is down', a);
      await H.sleep(6000);
      // F-1 CHARACTERIZATION (bug filed in qa/OVERNIGHT_TEST_REPORT.md): the
      // failure is DETECTED internally but ANNOUNCED NOWHERE — the optimistic
      // Tweaks-Needed flip deactivates the client panel that would render the
      // error; no toast, no retry control, draft cleared. These asserts pin
      // TODAY'S behavior so the eventual fix flips them intentionally.
      const st = await p.evaluate((args) => {
        const [pid, n] = args;
        const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
        return {
          detected: !!(_sxrReviewState.errors[pid + '|graphic']),
          panelErrShown: !!(card && card.querySelector('.cal-review-panel-err')),
          retryControl: !!(card && card.querySelector('[data-saving]')),
          toast: (document.querySelector('.sv-toast') || { textContent: '' }).textContent,
        };
      }, [IDS.fail, NAMES.fail]);
      t(st.detected, 'P4/F-1: failure IS detected internally (errors[key] recorded)');
      t(!st.panelErrShown && !st.retryControl && !/fail|error|retry/i.test(st.toast),
        'P4/F-1 CHARACTERIZED (BUG): failure is announced NOWHERE the client can see', JSON.stringify(st));
      const mid = H.rowSxr(IDS.fail, 'graphic_status');
      t(!!mid && mid.graphic_status === 'Client Approval', 'P4: DB untouched by the failed save', mid && mid.graphic_status);
      t(appErrs(p).length === 0, 'P4: 0 app JS errors on the failing page', (appErrs(p)[0] || ''));
      await p.context().close();
      // Recovery path a real client would eventually take: reload (server truth
      // restores Client Approval), backend healthy again, re-type + resend.
      const p2 = await client(browser);
      const a2 = await H.clientAct(p2, NAMES.fail, 'graphic', 'request', REQ);
      t(a2 === 'ok', 'P4: after reload + recovery the request can be re-sent', a2);
      const r = await H.pollRow(() => H.rowSxr(IDS.fail, 'graphic_status,graphic_tweaks'), x => x.graphic_status === 'Tweaks Needed', POLL);
      t(!!r && r.graphic_status === 'Tweaks Needed' && JSON.stringify(r.graphic_tweaks || '').includes('OT4 fail-then-retry'), 'P4: re-sent request landed');
      t(appErrs(p2).length === 0, 'P4: 0 app JS errors after recovery', (appErrs(p2)[0] || ''));
      await p2.context().close();
    }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    let clean = true;
    for (const id of Object.values(IDS)) if (!archiveSafe(id)) clean = false;
    t(clean, 'cleanup: all 4 seeds archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
