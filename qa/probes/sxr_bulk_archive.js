// sxr_bulk_archive.js — Tier 6 bulk multi-select archive: enter select mode,
// pick two of three cards, Archive → both removed + Archived in DB + no
// resurrection, the third stays. Drives the real select-mode UI.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_bk_a_' + TS, B = 'sr_bk_b_' + TS, C = 'sr_bk_c_' + TS;
const statusOf = (id) => { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=status'); return (Array.isArray(r) && r[0] && r[0].status) || null; };

(async () => {
  const seed = (id, n) => Q.up({ id, name: n + ' ' + TS, asset_url: 'https://example.com/' + id + '.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: String(n), created_at: new Date().toISOString() });
  seed(A, 'BK A'); seed(B, 'BK B'); seed(C, 'BK C');

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((ids) => ids.every(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [A, B, C], { timeout: 20000 }).catch(() => {});

    // Enter select mode.
    await page.evaluate(() => { const b = document.getElementById('sxrSelectBtn'); if (b) b.click(); });
    await page.waitForTimeout(300);
    const inSelect = await page.evaluate((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-card-select-overlay`), A);
    ok(inSelect, 'entering select mode renders the per-card select overlay');

    // Select A and B (click their overlays).
    await page.evaluate((ids) => { ids.forEach(id => { const o = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-card-select-overlay`); if (o) o.click(); }); }, [A, B]);
    await page.waitForTimeout(250);
    const countTxt = await page.evaluate(() => { const c = document.getElementById('sxrSelectCount'); return c ? c.textContent : ''; });
    ok(/2 selected/.test(countTxt), 'selecting two cards shows "2 selected"', countTxt);

    // Click Archive → confirm.
    await page.evaluate(() => { const a = document.getElementById('sxrSelectArchive'); if (a && !a.disabled) a.click(); });
    await page.waitForTimeout(350);
    await page.evaluate(() => { const y = document.getElementById('confirmYes'); if (y) y.click(); });

    // A and B leave the grid; C stays.
    const gone = await page.evaluate(async (ids) => {
      for (let i = 0; i < 24; i++) { const present = ids.some(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)); if (!present) return true; await new Promise(r => setTimeout(r, 250)); }
      return false;
    }, [A, B]);
    ok(gone, 'both selected cards are removed from the grid (optimistic)');
    const cStays = await page.evaluate((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`), C);
    ok(cStays, 'the unselected card remains');

    // Backend: A and B Archived.
    const aArch = await Q.poll(() => statusOf(A) === 'Archived' ? true : false, 20000);
    const bArch = await Q.poll(() => statusOf(B) === 'Archived' ? true : false, 20000);
    ok(aArch && bArch, 'both selected rows are Archived in the backend', 'A=' + statusOf(A) + ' B=' + statusOf(B));

    // No resurrection on a forced reload.
    await page.evaluate(() => { try { if (typeof window.loadSxrCards === 'function') window.loadSxrCards(undefined, { skipCache: true, background: true }); } catch (e) {} });
    await page.waitForTimeout(2500);
    const resurrected = await page.evaluate((ids) => ids.some(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [A, B]);
    ok(!resurrected, 'archived cards do NOT resurrect on a forced background reload (ledger)');

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A); Q.archiveSafe(B); Q.archiveSafe(C);
  }
  console.log(`PROBE sxr_bulk_archive: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
