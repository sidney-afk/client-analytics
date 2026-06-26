// sxr_linear_guards.js — Tier 3 Linear slot guards: FORMAT guard rejects a
// non-Linear paste (nothing persists), and the UNIQUENESS conflict dialog +
// MOVE-to-another-card relocates a link (old card cleared, new card set).
// Drives the real dedicated slot UI. Scoped to sidneylaruel; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_lg_a_' + TS, B = 'sr_lg_b_' + TS;
const VID = 'https://linear.app/acme/issue/VID-77' + (TS % 1000) + '/shared-link';
const rowOf = (id) => { const r = Q.supa('id=eq.' + encodeURIComponent(id) + '&client=eq.sidneylaruel&select=id,linear_issue_id'); return (Array.isArray(r) && r[0]) || null; };

(async () => {
  // Seed two live cards; A already owns the VID link, B is empty.
  Q.up({ id: A, name: 'LG A ' + TS, asset_url: 'https://example.com/a.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', linear_issue_id: VID, video_status: 'In Progress', graphic_status: 'In Progress', order_index: '1', created_at: new Date().toISOString() });
  Q.up({ id: B, name: 'LG B ' + TS, asset_url: 'https://example.com/b.mp4', thumbnail_url: 'https://via.placeholder.com/320x180.png', video_status: 'In Progress', graphic_status: 'In Progress', order_index: '2', created_at: new Date().toISOString() });
  Q.setSubissuesResp({ ok: true, parent: { status: 'In Progress', identifier: 'VID-1' }, subIssues: [] });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    // Wait for both cards.
    await page.waitForFunction((ids) => ids.every(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [A, B], { timeout: 20000 }).catch(() => {});

    // ── 1) FORMAT guard: paste non-Linear text into B's video slot → rejected. ──
    await page.evaluate((id) => { const b = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-linear-row[data-sxr-linear-row$="|video"] .sxr-linear-btn`); if (b) b.click(); }, B);
    await page.waitForTimeout(250);
    await page.evaluate((id) => { const i = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-linear-row[data-sxr-linear-row$="|video"] .sxr-linear-input`); if (i) { i.focus(); i.value = 'just a random note, not a link'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true })); } }, B);
    await page.waitForTimeout(1500);
    const bAfterGarbage = rowOf(B);
    ok(bAfterGarbage && !String(bAfterGarbage.linear_issue_id || '').trim(), 'FORMAT guard: a non-Linear paste does NOT persist (slot stays empty)', JSON.stringify(bAfterGarbage));
    // Dismiss the showNotify if present.
    await page.evaluate(() => { const o = document.querySelector('#notifyOverlay, .notify-overlay'); if (o) o.classList.remove('active', 'open'); if (typeof window.dismissNotify === 'function') try { window.dismissNotify(); } catch (e) {} });

    // ── 2) UNIQUENESS: link A's VID into B's video slot → conflict dialog appears. ──
    await page.evaluate((o) => {
      const btn = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.id}"] .sxr-linear-row[data-sxr-linear-row$="|video"] .sxr-linear-btn`);
      if (btn) btn.click();
    }, { id: B });
    await page.waitForTimeout(250);
    await page.evaluate((o) => {
      const i = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.id}"] .sxr-linear-row[data-sxr-linear-row$="|video"] .sxr-linear-input`);
      if (i) { i.focus(); i.value = o.v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true })); }
    }, { id: B, v: VID });
    await page.waitForTimeout(400);
    const conflictShown = await page.evaluate((id) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-link-conflict`), B);
    ok(conflictShown, 'UNIQUENESS guard: linking a sub-issue already on another card shows the conflict dialog');

    // ── 3) MOVE it here → A cleared, B set. ──
    await page.evaluate((id) => { const m = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .sxr-link-conflict-move`); if (m) m.click(); }, B);
    const bGot = await Q.poll(() => { const r = rowOf(B); return (r && String(r.linear_issue_id || '').includes('VID-77')) ? r : false; }, 20000);
    ok(!!bGot, 'MOVE: the new card (B) now owns the link', JSON.stringify(bGot));
    const aCleared = await Q.poll(() => { const r = rowOf(A); return (r && !String(r.linear_issue_id || '').trim()) ? r : false; }, 20000);
    ok(!!aCleared, 'MOVE: the old card (A) was cleared (no two cards on one issue)', JSON.stringify(aCleared));

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A); Q.archiveSafe(B);
  }
  console.log(`PROBE sxr_linear_guards: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK') + '  [Linear MOCKED]');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
