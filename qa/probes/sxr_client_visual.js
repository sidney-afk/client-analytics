// sxr_client_visual.js — VISUAL check of the rebuilt CLIENT review surface.
// Seeds a sample at Client Approval (+ one at Tweaks Needed), opens the client
// share link, asserts the calendar-style collapsible review LIST (cal-review-wrap
// → cal-review-list → kcard.cal-review-card) renders, expands a card, and writes
// a screenshot. Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');
const SHOT = (process.env.SXR_TMP || '/tmp/qa') + '/sxr_client_visual.png';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_clv_a_' + TS;   // Client Approval (actionable)
const B = 'sr_clv_b_' + TS;   // Tweaks Needed (changes requested)

(async () => {
  Q.up({ id: A, name: 'Client View A ' + TS, asset_url: 'https://example.com/a.mp4', thumbnail_url: 'https://via.placeholder.com/640x360.png?clv=' + TS, video_status: 'Client Approval', graphic_status: 'Client Approval', status: 'Client Approval', creative_direction: 'Keep the hook punchy and on-brand.', order_index: '1', created_at: new Date().toISOString() });
  Q.up({ id: B, name: 'Client View B ' + TS, asset_url: 'https://example.com/b.mp4', thumbnail_url: 'https://via.placeholder.com/640x360.png', video_status: 'Tweaks Needed', graphic_status: 'For SMM Approval', status: 'Tweaks Needed', order_index: '2', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.client(browser, 'Sidney Laruel');
    await page.waitForFunction((id) => !!document.querySelector(`.cal-review-card[data-sxr-review-pid="${id}"]`), A, { timeout: 20000 }).catch(() => {});

    // ── 1) The calendar review surface structure (not the SMM strip). ──
    const dom = await page.evaluate((ids) => {
      const wrap = document.querySelector('.cal-review-wrap');
      const list = document.querySelector('.cal-review-list');
      const a = document.querySelector(`.cal-review-card[data-sxr-review-pid="${ids.a}"]`);
      return {
        hasWrap: !!wrap, hasList: !!list,
        cards: document.querySelectorAll('.cal-review-card').length,
        noStrip: !document.querySelector('#sxrBody .sxr-card.is-editable'),
        aCollapsed: a ? !a.classList.contains('expanded') : null,
        aHasStrip: a ? !!a.querySelector('.kcard-strip') : null,
        aPending: a ? (a.querySelector('.kcard-pending') ? a.querySelector('.kcard-pending').textContent.trim() : '') : null,
      };
    }, { a: A, b: B });
    ok(dom.hasWrap && dom.hasList, 'client surface renders the calendar review surface (cal-review-wrap → cal-review-list)', JSON.stringify(dom));
    ok(dom.cards >= 1 && dom.aHasStrip, 'each sample is a collapsible kcard review card with a summary strip', JSON.stringify(dom));
    ok(dom.aCollapsed, 'review cards start collapsed (like the calendar)', JSON.stringify(dom));
    ok(/need(s)? your review/i.test(dom.aPending || ''), 'the strip shows a plain-English "what to do" line', JSON.stringify(dom));

    // ── 2) Expanding a card reveals the per-component review panels + approve. ──
    const exp = await page.evaluate(async (id) => {
      const strip = document.querySelector(`.cal-review-card[data-sxr-review-pid="${id}"] .kcard-strip`);
      if (strip) strip.click();
      await new Promise(r => setTimeout(r, 250));
      const card = document.querySelector(`.cal-review-card[data-sxr-review-pid="${id}"]`);
      return {
        expanded: card ? card.classList.contains('expanded') : false,
        panels: card ? card.querySelectorAll('.cal-review-panel').length : 0,
        approve: card ? !!card.querySelector('.cal-review-approve-btn') : false,
        cd: card ? !!card.querySelector('.sxr-review-cd') : false,
      };
    }, A);
    ok(exp.expanded && exp.panels === 2, 'clicking the strip expands it to the two per-component review panels', JSON.stringify(exp));
    ok(exp.approve, 'an expanded Client-Approval card shows the Approve button');
    ok(exp.cd, 'the client-visible creative-direction note shows in the expanded card');

    await page.screenshot({ path: SHOT, fullPage: false });
    console.log('  SHOT ' + SHOT);
    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A); Q.archiveSafe(B);
  }
  console.log(`PROBE sxr_client_visual: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
