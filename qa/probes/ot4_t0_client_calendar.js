// ot4_t0_client_calendar.js — TIER 0: the CALENDAR client share journey
// (?c=Sidney%20Laruel&v=calendar), exactly as a real client uses it. Seeds one
// post at Client Approval (video+graphic; caption pre-approved), then through
// REAL clicks/typing: load → review card + thumbnail render → typed comment
// (status unchanged) → approve video (DB + client_video_approved_at) → typed
// request-change on graphic (DB status + text + worst-of overall + toast) →
// fresh reload still renders the calendar for the client. 0 app JS errors.
// Cleanup tombstones the typed comments and archives the seed (p19 pattern).
'use strict';
const H = require('./ot4_lib.js');
const { launch, clientCal, upCal, archiveCalSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const ID = 'p_ot4c_' + TS;
const NAME = 'OT4 Cal Journey ' + TS;
const CMT_TXT = 'OT4 cal comment ' + TS;
const REQ_TXT = 'OT4 cal please adjust ' + TS;
const POLL = 35000;
const TOMORROW = new Date(Date.now() + 86400e3).toISOString().slice(0, 10);

// clientAct with a small retry while the previous save holds buttons disabled.
async function act(p, comp, kind, text) {
  for (let i = 0; i < 12; i++) {
    const r = await H.clientAct(p, NAME, comp, kind, text);
    if (r !== 'disabled') return r;
    await H.sleep(1000);
  }
  return 'disabled';
}

(async () => {
  const browser = await launch();
  try {
    upCal({ id: ID, name: NAME, platforms: 'youtube', scheduled_date: TOMORROW,
      video_status: 'Client Approval', graphic_status: 'Client Approval',
      caption_status: 'Approved', status: 'Client Approval',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
      asset_url: 'https://example.com/ot4.mp4' });
    await H.pollRow(() => H.rowCal(ID, 'id,status'), r => r.status === 'Client Approval');

    // 1) LOAD — the client calendar view, with our post reviewable.
    const p = await clientCal(browser);
    await H.expandReview(p, NAME);
    const vs0 = await H.panelState(p, NAME, 'video');
    const gs0 = await H.panelState(p, NAME, 'graphic');
    t(vs0.panel && gs0.panel, 'client calendar link loads; review panels render for both comps');
    t(vs0.approveEnabled && vs0.request && vs0.textarea, 'video panel offers approve + request-change + composer');

    // 2) MEDIA
    const media = await p.evaluate((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const imgs = card ? [...card.querySelectorAll('img')] : [];
      const yt = imgs.find(i => /ytimg/.test(i.src));
      return { ytLoaded: !!(yt && yt.complete && yt.naturalWidth > 0), src: yt && yt.src };
    }, NAME);
    t(media.ytLoaded, 'client-visible calendar thumbnail rendered with real bytes', media.src);

    // 3) COMMENT on graphic — no status flip.
    const a1 = await act(p, 'graphic', 'comment', CMT_TXT);
    t(a1 === 'ok', 'graphic Comment clicked with typed text', a1);
    const r1 = await H.pollRow(() => H.rowCal(ID, 'graphic_status,graphic_tweaks'), r => JSON.stringify(r.graphic_tweaks || '').includes(CMT_TXT), POLL);
    t(!!r1 && JSON.stringify(r1.graphic_tweaks || '').includes(CMT_TXT), 'DB: comment persisted in graphic_tweaks');
    t(!!r1 && r1.graphic_status === 'Client Approval', 'DB: comment did NOT change status', r1 && r1.graphic_status);

    // 4) APPROVE video.
    const a2 = await act(p, 'video', 'approve');
    t(a2 === 'ok', 'video Approve clicked', a2);
    const r2 = await H.pollRow(() => H.rowCal(ID, 'video_status,client_video_approved_at'), r => r.video_status === 'Approved', POLL);
    t(!!r2 && r2.video_status === 'Approved', 'DB: video_status = Approved (save landed)');
    t(!!r2 && !!r2.client_video_approved_at, 'DB: client_video_approved_at stamped');

    // 5) REQUEST CHANGE on graphic; capture the announcement promptly.
    const a3 = await act(p, 'graphic', 'request', REQ_TXT);
    t(a3 === 'ok', 'graphic Request-change clicked with typed text', a3);
    const toast = await p.waitForFunction(() => {
      const el = document.querySelector('.sv-toast');
      return el && /change request sent/i.test(el.textContent) ? el.textContent : false;
    }, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
    const r3 = await H.pollRow(() => H.rowCal(ID, 'graphic_status,status,graphic_tweaks'), r => r.graphic_status === 'Tweaks Needed', POLL);
    t(!!r3 && r3.graphic_status === 'Tweaks Needed', 'DB: graphic_status = Tweaks Needed (save landed)');
    t(!!r3 && JSON.stringify(r3.graphic_tweaks || '').includes(REQ_TXT), 'DB: change-request text persisted');
    t(!!r3 && r3.status === 'Tweaks Needed', 'DB: overall = worst-of → Tweaks Needed', r3 && r3.status);
    t(!!toast, 'client sees the "Change request sent" toast (no silent success)', toast);

    t(appErrs(p).length === 0, '0 app JS errors on the acting page', (appErrs(p)[0] || ''));
    await p.context().close();

    // 6) FRESH RELOAD — the client calendar still loads and knows the post.
    const p2 = await clientCal(browser);
    // calState is a top-level const (NOT window.calState) — use the bare
    // identifier, and poll in-page until the load settles.
    const re = await p2.evaluate(async (pid) => {
      for (let i = 0; i < 15; i++) {
        try {
          const post = (typeof calState !== 'undefined' && (calState.posts || []).find(x => x.id === pid)) || null;
          if (post) return { post: { v: post.video_status, g: post.graphic_status, s: post.status } };
        } catch (e) {}
        await new Promise(r => setTimeout(r, 1000));
      }
      return { post: null };
    }, ID);
    t(!!re.post && re.post.v === 'Approved' && re.post.g === 'Tweaks Needed', 'reload: client page reads back the persisted statuses', JSON.stringify(re.post));
    t(appErrs(p2).length === 0, '0 app JS errors on the reloaded page', (appErrs(p2)[0] || ''));
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    // tombstone the typed comments, then archive + verify.
    try {
      const row = H.rowCal(ID, 'graphic_tweaks');
      let arr = []; try { arr = JSON.parse((row && row.graphic_tweaks) || '[]'); } catch {}
      const tomb = arr.map(c => Object.assign({}, c, { deleted: true, updated_at: new Date().toISOString() }));
      upCal({ id: ID, graphic_tweaks: JSON.stringify(tomb) });
    } catch {}
    t(archiveCalSafe(ID), 'cleanup: calendar seed archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
