// ot4_t0_client_two_sittings.js — TIER 0: a real client reviews in TWO
// SITTINGS. Sitting 1: approve the video only, close the tab. Sitting 2
// (fresh context = fresh cache): the card is still in their queue, the video
// panel shows its approved state with NO enabled approve control, the graphic
// is still actionable — approve it, watch the card complete out of the queue,
// and confirm both approvals + stamps in the DB. 0 app JS errors both sittings.
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, up, archiveSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const ID = 'sr_ot4s_' + TS;
const NAME = 'OT4 Two Sittings ' + TS;
const POLL = 35000;

(async () => {
  const browser = await launch();
  try {
    up({ id: ID, name: NAME, order_index: 1,
      video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    await H.pollRow(() => H.rowSxr(ID, 'id,status'), r => r.status === 'Client Approval');

    // ---- Sitting 1: approve the video, close the tab ----------------------
    {
      const p = await client(browser);
      const a = await H.clientAct(p, NAME, 'video', 'approve');
      t(a === 'ok', 'sitting 1: video approved via real click', a);
      const r = await H.pollRow(() => H.rowSxr(ID, 'video_status,client_video_approved_at'), x => x.video_status === 'Approved', POLL);
      t(!!r && r.video_status === 'Approved' && !!r.client_video_approved_at, 'sitting 1: approve + stamp landed in DB');
      t(appErrs(p).length === 0, 'sitting 1: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }

    // ---- Sitting 2: fresh context, continue where they left off -----------
    {
      const p = await client(browser);
      await H.expandReview(p, NAME);
      const vs = await H.panelState(p, NAME, 'video');
      const gs = await H.panelState(p, NAME, 'graphic');
      t(vs.card, 'sitting 2: the half-reviewed card is still in the queue');
      // The approved component either renders no panel at all (nothing to
      // click) or a panel with no enabled approve — both honor the guarantee.
      const videoSafe = !vs.panel || (!vs.approveEnabled && /approved/i.test(vs.text || ''));
      t(videoSafe, 'sitting 2: approved video offers no enabled approve control', JSON.stringify({ panel: vs.panel, en: vs.approveEnabled, text: (vs.text || vs.cardText || '').slice(0, 70) }));
      t(gs.approveEnabled && gs.request, 'sitting 2: graphic is still actionable');
      const a = await H.clientAct(p, NAME, 'graphic', 'approve');
      t(a === 'ok', 'sitting 2: graphic approved via real click', a);
      const r = await H.pollRow(() => H.rowSxr(ID, 'graphic_status,client_graphic_approved_at,status'), x => x.graphic_status === 'Approved', POLL);
      t(!!r && r.graphic_status === 'Approved' && !!r.client_graphic_approved_at, 'sitting 2: second approve + stamp landed in DB');
      t(!!r && r.status === 'Approved', 'sitting 2: overall completed to Approved (worst-of resolves)', r && r.status);
      // the completed card leaves the client queue
      const gone = await p.waitForFunction((n) => ![...document.querySelectorAll('.cal-review-card .kcard-title')].some(x => x.textContent === n), NAME, { timeout: 15000 }).then(() => true).catch(() => false);
      t(gone, 'sitting 2: fully-approved card completes out of the client queue');
      t(appErrs(p).length === 0, 'sitting 2: 0 app JS errors', (appErrs(p)[0] || ''));
      await p.context().close();
    }
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    t(archiveSafe(ID), 'cleanup: seed archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
