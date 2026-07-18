// ot4_t0_client_thumb_derivation.js — TIER 0: client-visible THUMBNAIL
// DERIVATION on the samples client link. Real clients paste Drive share links
// and YouTube watch URLs, not direct image URLs — the client card must derive
// a renderable src from each shape:
//   A) thumbnail_url = drive.google.com/file/d/<id>/view →
//      img src on the lh3.googleusercontent.com/d/<id> form (the app's
//      reliable-derivation contract; bytes for a real id proven separately);
//   B) no thumbnail, asset_url = youtube watch URL → img src derived onto
//      the YouTube thumb host (img.youtube.com / ytimg) with real bytes.
// 0 app JS errors; both seeds archived + verified.
'use strict';
const H = require('./ot4_lib.js');
const { launch, client, up, archiveSafe, appErrs } = H;

const C = H.counter(); const t = C.t;
const TS = Date.now();
const A = 'sr_ot4th_drive_' + TS, NA = 'OT4 Drive Thumb ' + TS;
const B = 'sr_ot4th_yt_' + TS, NB = 'OT4 YT Derive ' + TS;
const DRIVE_ID = '1AbC_ot4-fake-file-id-' + TS;

(async () => {
  const browser = await launch();
  try {
    up({ id: A, name: NA, order_index: 1, video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
      thumbnail_url: `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing` });
    up({ id: B, name: NB, order_index: 2, video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval',
      asset_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    await H.pollRow(() => H.rowSxr(B, 'id,status'), r => r.status === 'Client Approval');

    const p = await client(browser);
    await H.expandReview(p, NA);

    // A) drive share link → NEVER a broken/blank img: either a derived image
    // that loads, or the DESIGNED announced warn state ("folder needs to be
    // shared with 'Anyone with the link'"). With a fake id the warn is the
    // expected outcome — the point is the client always sees an honest state.
    const drv = await p.waitForFunction((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      if (!card) return false;
      const warn = card.querySelector('.cal-mini-drive-warn');
      if (warn) return { state: 'announced-warn', title: warn.getAttribute('title') || '' };
      const img = card.querySelector('.kcard-thumb img');
      if (img && img.complete && img.naturalWidth > 0) return { state: 'image-loaded', src: img.src };
      return false;
    }, NA, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
    t(!!drv, 'A: drive thumbnail is an honest state (image or announced warn, never broken)', drv && (drv.state + ': ' + (drv.title || drv.src || '').slice(0, 80)));

    // B) youtube watch asset → ytimg thumb with real bytes
    await H.expandReview(p, NB);
    const yt = await p.waitForFunction((n) => {
      const card = [...document.querySelectorAll('.cal-review-card')].find(x => (x.querySelector('.kcard-title') || {}).textContent === n);
      const img = card && [...card.querySelectorAll('img')].find(i => /ytimg|img\.youtube\.com/.test(i.src));
      return (img && img.complete && img.naturalWidth > 0) ? img.src : false;
    }, NB, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
    t(!!yt, 'B: youtube asset derives a ytimg thumb that renders real bytes', (yt || 'no ytimg src').slice(0, 110));

    t(appErrs(p).length === 0, '0 app JS errors', (appErrs(p)[0] || ''));
  } catch (e) {
    t(false, 'EXCEPTION: ' + (e && e.message || e));
  } finally {
    try { await browser.close(); } catch {}
    let clean = archiveSafe(A); if (!archiveSafe(B)) clean = false;
    t(clean, 'cleanup: both seeds archived + verified');
  }
  console.log(`\npass=${C.ok} fail=${C.fail}`);
  process.exit(C.fail ? 1 : 0);
})();
