// sxr_realtime_catchup.js — (G) background catch-up of a cross-actor change.
// The courier can't tunnel the realtime WebSocket, so the app falls back to its
// REST reload; this drives that path: another actor moves a sub-status via the
// webhook, a background loadSxrCards adopts it (the card has no local pending
// edit), and the pill updates. Also asserts a card WITH a pending local edit is
// NOT clobbered by the same reload. Scoped to sidneylaruel; archives what it makes.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const P = 'sr_rt_' + TS, Q2 = 'sr_rt2_' + TS;
const NAME = 'RT local ' + TS;

(async () => {
  Q.up({ id: P, name: 'RT P ' + TS, asset_url: 'https://example.com/p.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '1', created_at: new Date().toISOString() });
  Q.up({ id: Q2, name: 'RT Q ' + TS, asset_url: 'https://example.com/q.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '2', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((ids) => ids.every(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [P, Q2], { timeout: 20000 }).catch(() => {});

    // ── 1) Cross-actor catch-up (NO focused field, so the repaint isn't deferred). ──
    // Another actor moves P's video_status via the webhook; wait until Supabase
    // actually reads the new value before reloading (avoids a timing race).
    Q.up({ id: P, video_status: 'Kasper Approval' });
    const landed = await Q.poll(() => { const r = Q.supa('id=eq.' + encodeURIComponent(P) + '&client=eq.sidneylaruel&select=video_status'); const x = Array.isArray(r) && r[0]; return (x && x.video_status === 'Kasper Approval') ? true : false; }, 20000);
    ok(landed, 'cross-actor webhook write reached Supabase');
    // Make sure no card field is focused, then background-reload (the realtime fallback).
    await page.evaluate(() => { try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {} });
    await page.evaluate(() => { try { window.loadSxrCards(undefined, { background: true, skipCache: true }); } catch (e) {} });
    const adopted = await page.evaluate(async (id) => {
      for (let i = 0; i < 24; i++) {
        const pill = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-pill-btn[data-sxr-comp-pill="video"]`);
        if (pill && /Kasper Approval/i.test(pill.textContent || '')) return true;
        await new Promise(r => setTimeout(r, 250));
      }
      return false;
    }, P);
    ok(adopted, 'a background reload adopts another actor’s sub-status change (pill updates)');

    // ── 2) A card with a pending LOCAL edit is NOT clobbered by a reload. ──
    await page.evaluate((o) => { const i = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.id}"] .sxr-name-input`); if (i) { i.focus(); i.value = o.nm; i.dispatchEvent(new Event('input', { bubbles: true })); } }, { id: Q2, nm: NAME });
    Q.up({ id: Q2, video_status: 'Kasper Approval' });   // another actor pokes Q2 too
    await page.waitForTimeout(2500);
    await page.evaluate(() => { try { window.loadSxrCards(undefined, { background: true, skipCache: true }); } catch (e) {} });
    await page.waitForTimeout(2000);
    const kept = await page.evaluate((o) => { const i = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.id}"] .sxr-name-input`); return i ? i.value : null; }, { id: Q2 });
    ok(kept === NAME, 'a card with a pending local edit keeps its typed value through a reload', String(kept));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(P); Q.archiveSafe(Q2);
  }
  console.log(`PROBE sxr_realtime_catchup: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
