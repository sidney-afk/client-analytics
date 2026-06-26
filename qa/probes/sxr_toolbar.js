// sxr_toolbar.js — Tier 2 toolbar chrome: 3-level zoom (persists), Share-with-client
// link generation (?c=…&v=sample-reviews), and per-client tab add/remove. All
// UI/localStorage only — no backend writes. Scoped to sidneylaruel.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

(async () => {
  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction(() => !!document.getElementById('sxrZoomIn'), { timeout: 15000 }).catch(() => {});

    // ── 1) Zoom: in → l, out twice → s; persists to localStorage. ──
    const z0 = await page.evaluate(() => document.getElementById('sxrBody').dataset.zoom);
    await page.evaluate(() => document.getElementById('sxrZoomIn').click());
    const zIn = await page.evaluate(() => document.getElementById('sxrBody').dataset.zoom);
    ok(zIn === 'l', 'zoom-in grows the grid to "l"', 'from ' + z0 + ' to ' + zIn);
    await page.evaluate(() => { document.getElementById('sxrZoomOut').click(); document.getElementById('sxrZoomOut').click(); });
    const zOut = await page.evaluate(() => document.getElementById('sxrBody').dataset.zoom);
    ok(zOut === 's', 'zoom-out twice shrinks the grid to "s"', zOut);
    const zLS = await page.evaluate(() => { try { return localStorage.getItem('syncview_sxr_zoom'); } catch (e) { return null; } });
    ok(zLS === 's', 'zoom level persists to localStorage', String(zLS));

    // ── 2) Share-with-client copies a ?c=…&v=sample-reviews link. ──
    const shared = await page.evaluate(async () => {
      let captured = null;
      try { navigator.clipboard.writeText = (t) => { captured = t; return Promise.resolve(); }; } catch (e) {}
      const btn = document.querySelector('.sxr-share-btn');
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 200));
      return captured;
    });
    ok(shared && /[?&]c=Sidney(%20| )Laruel/i.test(shared) && /[?&]v=sample-reviews/.test(shared),
      'Share button copies a client link (?c=Sidney Laruel&v=sample-reviews)', String(shared));

    // ── 3) Tab add → pick Sidney → tab appears with a remove X; remove → gone. ──
    // Fresh context has no pinned tabs, so the strip shows only "+ Add client".
    await page.evaluate(() => { const b = document.querySelector('.sxr-tab-add'); if (b) b.click(); });
    await page.waitForTimeout(200);
    const panelHasSidney = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#sxrTabAddPanel .sxr-tab-add-item'));
      return items.some(i => /Sidney Laruel/i.test(i.textContent || ''));
    });
    ok(panelHasSidney, 'the Add-client panel lists available clients (incl. Sidney Laruel)');
    await page.evaluate(() => { const items = Array.from(document.querySelectorAll('#sxrTabAddPanel .sxr-tab-add-item')); const s = items.find(i => /Sidney Laruel/i.test(i.textContent || '')); if (s) s.click(); });
    await page.waitForTimeout(400);
    const tabAdded = await page.evaluate(() => { const t = document.querySelector('#sxrTabs .sxr-tab'); return t ? { active: t.classList.contains('active'), hasX: !!t.querySelector('.sxr-tab-x'), text: (t.textContent || '').replace(/\s+/g, ' ').trim() } : null; });
    ok(tabAdded && /Sidney Laruel/i.test(tabAdded.text) && tabAdded.hasX, 'picking a client pins it as an active tab with a remove X', JSON.stringify(tabAdded));
    await page.evaluate(() => { const x = document.querySelector('#sxrTabs .sxr-tab .sxr-tab-x'); if (x) x.click(); });
    await page.waitForTimeout(300);
    const tabGone = await page.evaluate(() => !document.querySelector('#sxrTabs .sxr-tab'));
    ok(tabGone, 'the remove X unpins the client tab');

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
  }
  console.log(`PROBE sxr_toolbar: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
