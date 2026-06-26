// sxr_return_refresh.js — the tab-return / focus catch-up (the realtime parity
// fix). The courier can't tunnel the realtime WebSocket, so this drives the
// OTHER live path: another actor changes a card via the webhook, then a
// focus / visibilitychange event fires _sxrRefreshOnReturn → a background
// loadSxrCards that adopts the change (exactly what catches up a backgrounded
// tab whose socket missed the row). Scoped to sidneylaruel; archives what it makes.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const P = 'sr_ret_' + TS;

(async () => {
  Q.up({ id: P, name: 'RET ' + TS, asset_url: 'https://example.com/p.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', linear_issue_id: 'https://linear.app/syn/issue/VID-' + (TS % 10000), video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', order_index: '1', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`), P, { timeout: 20000 }).catch(() => {});

    // Confirm the tab-return handler exists (the fix is wired).
    const wired = await page.evaluate(() => typeof _sxrRefreshOnReturn === 'function');
    ok(wired, '_sxrRefreshOnReturn (tab-return catch-up) is wired');

    // Another actor moves the video sub-status via the webhook; wait until
    // Supabase actually serves the new value before triggering the return.
    Q.up({ id: P, video_status: 'Kasper Approval' });
    const landed = await Q.poll(() => { const r = Q.supa('id=eq.' + encodeURIComponent(P) + '&client=eq.sidneylaruel&select=video_status'); const x = Array.isArray(r) && r[0]; return (x && x.video_status === 'Kasper Approval') ? true : false; }, 20000);
    ok(landed, 'cross-actor webhook write reached Supabase');

    // Make sure nothing is focused (so the repaint isn't deferred), then drive
    // the REAL focus / visibilitychange handler — NOT loadSxrCards directly.
    const adopted = await page.evaluate(async (id) => {
      try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
      for (let i = 0; i < 16; i++) {
        // The handler self-throttles to 4s; fire repeatedly so it lands.
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
        await new Promise(r => setTimeout(r, 1000));
        const pill = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-pill-btn[data-sxr-comp-pill="video"]`);
        if (pill && /Kasper Approval/i.test(pill.textContent || '')) return true;
      }
      return false;
    }, P);
    ok(adopted, 'a focus / tab-return event triggers a background reload that adopts the cross-actor change', 'pill did not update');

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(P);
  }
  console.log(`PROBE sxr_return_refresh: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
