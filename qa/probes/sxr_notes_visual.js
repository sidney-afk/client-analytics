// sxr_notes_visual.js — VISUAL check of the re-skinned Notes modal (now the
// calendar's cal-comments-* / cal-cm-* markup). Seeds a sample with a tweak
// thread + a reply, opens the SMM surface, opens Notes, screenshots, and asserts
// the calendar comment-modal structure is present. Scoped to sidneylaruel.
const Q = require('../sxr_courier_lib.js');
const SHOT = (process.env.SXR_TMP || '/tmp/qa') + '/sxr_notes_visual.png';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_nv_' + TS;
const tweak = JSON.stringify([
  { id: 'c_root_' + TS, parent_id: null, author: 'Kasper', role: 'kasper', is_tweak: true, round: 1, audience: 'internal', body: 'Tighten the hook — the first 2s drag.', created_at: new Date(TS - 60000).toISOString(), updated_at: new Date(TS - 60000).toISOString(), done: false },
  { id: 'c_reply_' + TS, parent_id: 'c_root_' + TS, author: 'Synchro Social', role: 'smm', is_tweak: false, audience: 'internal', body: 'On it — recutting now.', created_at: new Date(TS - 30000).toISOString(), updated_at: new Date(TS - 30000).toISOString(), done: false },
]);

(async () => {
  Q.up({ id: A, name: 'Notes Visual ' + TS, asset_url: 'https://example.com/a.mp4', thumbnail_url: 'https://via.placeholder.com/640x360.png', video_status: 'Kasper Approval', graphic_status: 'In Progress', status: 'Kasper Approval', video_tweaks: tweak, order_index: '1', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-notes-btn`), A, { timeout: 20000 }).catch(() => {});

    // Open the Notes modal for the seeded card.
    await page.evaluate((id) => { const b = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-notes-btn`); if (b) b.click(); }, A);
    await page.waitForTimeout(500);

    const dom = await page.evaluate(() => {
      const modal = document.getElementById('sxrCommentsModal');
      const overlay = document.getElementById('sxrCommentsOverlay');
      return {
        overlayOpen: overlay ? overlay.classList.contains('open') : false,
        modalIsCal: modal ? modal.classList.contains('cal-comments-modal') : false,
        head: !!document.querySelector('#sxrCommentsModal .cal-comments-head'),
        feed: !!document.querySelector('#sxrCommentsModal .cal-comments-feed'),
        rows: document.querySelectorAll('#sxrCommentsModal .cal-cm-row').length,
        avatar: !!document.querySelector('#sxrCommentsModal .cal-cm-avatar'),
        typeTag: !!document.querySelector('#sxrCommentsModal .cal-cm-type-tag.is-tweak'),
        reply: !!document.querySelector('#sxrCommentsModal .cal-cm-row.is-reply'),
        composer: !!document.querySelector('#sxrCommentsModal .cal-cm-composer'),
        send: !!document.querySelector('#sxrCommentsModal .cal-cm-send'),
        audSegs: document.querySelectorAll('#sxrCommentsModal .cal-cm-audience').length,
        audBtns: document.querySelectorAll('#sxrCommentsModal .cal-cm-aud-btn').length,
        // no stale sxr-cm-* structural classes leak into the modal
        staleSxr: document.querySelectorAll('#sxrCommentsModal .sxr-cm-row, #sxrCommentsModal .sxr-cm-seg-btn, #sxrCommentsModal .sxr-cm-send, #sxrCommentsModal .sxr-cm-composer').length,
      };
    });
    ok(dom.overlayOpen && dom.modalIsCal, 'Notes opens the calendar-style modal (cal-comments-modal)', JSON.stringify(dom));
    ok(dom.head && dom.feed, 'modal has the calendar head + feed', JSON.stringify(dom));
    ok(dom.rows >= 2 && dom.reply, 'comment rows render in the calendar cal-cm-row shape (incl. a reply)', JSON.stringify(dom));
    ok(dom.typeTag, 'a change-request shows the calendar "Tweak" type tag', JSON.stringify(dom));
    ok(dom.composer && dom.send && dom.audBtns >= 4, 'composer is the calendar composer (segments + send)', JSON.stringify(dom));
    ok(dom.staleSxr === 0, 'no stale sxr-cm-* structural classes remain in the modal', JSON.stringify(dom));

    await page.screenshot({ path: SHOT, fullPage: false });
    console.log('  SHOT ' + SHOT);
    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A);
  }
  console.log(`PROBE sxr_notes_visual: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
