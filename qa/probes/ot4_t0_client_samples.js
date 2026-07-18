// ot4_t0_client_samples.js — TIER 0: the samples CLIENT share journey, exactly
// as a real client uses it. Seeds ONE sample at Client Approval (both comps),
// then through REAL clicks/typing on ?sxr=1&c=Sidney%20Laruel&v=sample-reviews:
//   load → thumbnail renders (real bytes) → typed follow-up comment (no status
//   change) → approve video → request change on graphic (typed) → the card
//   leaves the client queue BY DESIGN ("we're on it" toast) → every write
//   verified in Supabase + audit events → a fresh reload shows the emptied
//   queue (client's work done). 0 app JS errors.
// Design note (verified in code): _sxrReviewComponentActive gates a client-link
// component to 'Client Approval' ONLY — after the client's own request-change
// the card is removed from their list live AND on reload until the team routes
// it back. Persistence is therefore proven on the DB row + events (the SMM
// surface picks it up — covered by the SMM probes).
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, up, supaEvents, archiveSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const ID = 'sr_ot4a_' + TS;
const NAME = 'OT4 Client Journey ' + TS;
const REQ_TXT = 'OT4 please tighten the hook ' + TS;
const CMT_TXT = 'OT4 loving the colors ' + TS;
const POLL = 35000;

(async () => {
  const browser = await launch();
  try {
    // SEED — a client-reviewable sample with REAL (tunneled) media.
    up({ id: ID, name: NAME, order_index: 1,
      video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
      asset_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });
    await H.pollRow(() => H.rowSxr(ID, 'id,status'), r => r.status === 'Client Approval');

    // 1) LOAD
    const p = await client(browser);
    await H.expandReview(p, NAME);
    const vs0 = await H.panelState(p, NAME, 'video');
    const gs0 = await H.panelState(p, NAME, 'graphic');
    t(vs0.panel && gs0.panel, 'client link loads; both review panels render');
    t(vs0.approveEnabled && vs0.request && vs0.textarea, 'video panel offers approve + request-change + composer', JSON.stringify(vs0).slice(0, 120));

    // 2) MEDIA — the thumbnail must render real bytes (not a broken img).
    const media = await p.evaluate((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const imgs = card ? [...card.querySelectorAll('img')] : [];
      const yt = imgs.find(i => /ytimg/.test(i.src));
      return { count: imgs.length, ytLoaded: !!(yt && yt.complete && yt.naturalWidth > 0), src: yt && yt.src };
    }, NAME);
    t(media.ytLoaded, 'client-visible thumbnail rendered with real bytes', media.src);

    // 3) COMMENT (no status change) on the graphic while it is reviewable.
    const a1 = await H.clientAct(p, NAME, 'graphic', 'comment', CMT_TXT);
    t(a1 === 'ok', 'graphic Comment clicked with typed text', a1);
    const r1 = await H.pollRow(() => H.rowSxr(ID, 'graphic_status,graphic_tweaks'), r => JSON.stringify(r.graphic_tweaks || '').includes(CMT_TXT), POLL);
    t(!!r1 && JSON.stringify(r1.graphic_tweaks || '').includes(CMT_TXT), 'DB: comment persisted');
    t(!!r1 && r1.graphic_status === 'Client Approval', 'DB: comment did NOT change status', r1 && r1.graphic_status);

    // 4) APPROVE video via the REAL button → must land in the DB.
    const a2 = await H.clientAct(p, NAME, 'video', 'approve');
    t(a2 === 'ok', 'video Approve button clicked', a2);
    const r2 = await H.pollRow(() => H.rowSxr(ID, 'video_status,client_video_approved_at,status'), r => r.video_status === 'Approved', POLL);
    t(!!r2 && r2.video_status === 'Approved', 'DB: video_status = Approved (save landed)', JSON.stringify(r2));
    t(!!r2 && !!r2.client_video_approved_at, 'DB: client_video_approved_at stamped');

    // 5) REQUEST CHANGE on graphic via typed text + real button.
    const a3 = await H.clientAct(p, NAME, 'graphic', 'request', REQ_TXT);
    t(a3 === 'ok', 'graphic Request-change clicked with typed text', a3);
    // The toast + card hand-off happen as soon as the page-side save resolves —
    // read them NOW (they are gone by the time the slow DB polls finish).
    const after = await p.waitForFunction((n) => {
      const toast = (document.querySelector('.sv-toast') || { textContent: '' }).textContent;
      const inDom = [...document.querySelectorAll('.cal-review-card .kcard-title')].some(x => x.textContent === n);
      return (/change request sent/i.test(toast) && !inDom) ? { toast, inDom } : false;
    }, NAME, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
    const r3 = await H.pollRow(() => H.rowSxr(ID, 'graphic_status,status,graphic_tweaks'), r => r.graphic_status === 'Tweaks Needed', POLL);
    t(!!r3 && r3.graphic_status === 'Tweaks Needed', 'DB: graphic_status = Tweaks Needed (save landed)', r3 && r3.graphic_status);
    t(!!r3 && JSON.stringify(r3.graphic_tweaks || '').includes(REQ_TXT), 'DB: change-request text persisted in graphic_tweaks');
    t(!!r3 && r3.status === 'Tweaks Needed', 'DB: overall = worst-of → Tweaks Needed', r3 && r3.status);

    // 6) The success was ANNOUNCED and the card left the client queue (design).
    t(!!after && /change request sent/i.test(after.toast), 'client sees the "Change request sent" toast (no silent success)', after && after.toast);
    t(!!after && !after.inDom, 'card leaves the client queue after their request (designed hand-off)');

    // 7) AUDIT EVENTS for both status changes.
    const evs = await H.pollRow(
      () => supaEvents('sample_id=eq.' + ID + '&action=eq.status_change&select=component,to_status'),
      e => Array.isArray(e) && e.some(x => x.component === 'video' && x.to_status === 'Approved') && e.some(x => x.component === 'graphic' && x.to_status === 'Tweaks Needed'), POLL);
    t(Array.isArray(evs) && evs.some(x => x.component === 'video' && x.to_status === 'Approved'), 'audit event: video → Approved');
    t(Array.isArray(evs) && evs.some(x => x.component === 'graphic' && x.to_status === 'Tweaks Needed'), 'audit event: graphic → Tweaks Needed');

    t(appErrs(p).length === 0, '0 app JS errors on the acting page', (appErrs(p)[0] || ''));
    await p.context().close();

    // 8) FRESH RELOAD — the emptied queue persists (their work is done).
    const p2 = await client(browser);
    await H.sleep(2500);
    const gone = await p2.evaluate((n) => ![...document.querySelectorAll('.cal-review-card .kcard-title')].some(x => x.textContent === n), NAME);
    t(gone, 'reload: handed-off card stays out of the client queue');
    t(appErrs(p2).length === 0, '0 app JS errors on the reloaded page', (appErrs(p2)[0] || ''));
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    t(archiveSafe(ID), 'cleanup: seed archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
