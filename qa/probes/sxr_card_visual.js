// sxr_card_visual.js — VISUAL parity check for the rebuilt Samples card.
// Seeds a fully-linked card (both Linear sub-issues + a thumbnail + mixed
// sub-statuses) and an unlinked card, opens the SMM surface, asserts the
// calendar-clone DOM is present (floating thumb, collapsed link pills, Linear
// pile, bottom sub-status row + "Set all to…"), drives the status menu and the
// Set-all menu, and writes a screenshot. Scoped to sidneylaruel; archives what
// it creates.
const Q = require('../sxr_courier_lib.js');
const SHOT = (process.env.SXR_TMP || '/tmp/qa') + '/sxr_card_visual.png';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const A = 'sr_vis_a_' + TS;   // fully linked, mixed statuses
const B = 'sr_vis_b_' + TS;   // unlinked (locked sub-status + warn pile)
const VID = 'https://linear.app/synchrosocial/issue/VID-901/sample-vis';
const GRA = 'https://linear.app/synchrosocial/issue/GRA-902/sample-vis';

(async () => {
  Q.up({ id: A, name: 'Visual A ' + TS, asset_url: 'https://example.com/a.mp4', thumbnail_url: 'https://via.placeholder.com/640x360.png?vis=' + TS, linear_issue_id: VID, graphic_linear_issue_id: GRA, video_status: 'Tweaks Needed', graphic_status: 'Approved', status: 'Tweaks Needed', order_index: '1', created_at: new Date().toISOString() });
  Q.up({ id: B, name: 'Visual B ' + TS, asset_url: '', thumbnail_url: '', video_status: 'In Progress', graphic_status: 'In Progress', status: 'In Progress', order_index: '2', created_at: new Date().toISOString() });

  const browser = await Q.launch();
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');
    await page.waitForFunction((ids) => ids.every(id => document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`)), [A, B], { timeout: 20000 }).catch(() => {});

    // ── 1) The calendar-clone structure is present on the linked card. ──
    const dom = await page.evaluate((id) => {
      const card = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`);
      if (!card) return { noCard: true };
      const cs = getComputedStyle(card);
      const grid = document.querySelector('#sxrBody .sxr-grid');
      const gcs = grid ? getComputedStyle(grid) : null;
      return {
        stripIsFlex: gcs ? gcs.display : null,
        cardWidth: Math.round(card.getBoundingClientRect().width),
        hasBody: !!card.querySelector('.cal-card-body'),
        hasTitleRow: !!card.querySelector('.cal-title-row .cal-fld-name'),
        linkPills: card.querySelectorAll('.cal-link-field.has-link').length,
        linearPile: card.querySelectorAll('.cal-linear-pile .cal-linear-btn.is-linked').length,
        subRow: !!card.querySelector('.cal-card-substatus-row'),
        setAll: !!card.querySelector('.cal-fld-setall'),
        triggers: card.querySelectorAll('.cal-fld-substatus-trigger').length,
        // the floating thumbnail uses object-fit:contain (calendar look), not cover
        thumbFit: (() => { const img = card.querySelector('.sxr-card-thumb img'); return img ? getComputedStyle(img).objectFit : null; })(),
      };
    }, A);
    ok(!dom.noCard, 'linked card rendered', JSON.stringify(dom));
    ok(dom.stripIsFlex === 'flex', 'the body is a horizontal strip (display:flex), like the calendar', String(dom.stripIsFlex));
    ok(dom.cardWidth >= 380, 'the card is a wide calendar-style card (>=380px)', String(dom.cardWidth));
    ok(dom.hasBody && dom.hasTitleRow, 'cal-card-body + cal-title-row name field present');
    ok(dom.linkPills === 2, 'both media links collapse to calendar link-pills', String(dom.linkPills));
    ok(dom.linearPile === 2, 'both Linear sub-issues show as linked buttons on the thumbnail pile', String(dom.linearPile));
    ok(dom.subRow && dom.setAll && dom.triggers === 2, 'bottom sub-status row with a "Set all to…" pill + 2 component triggers', JSON.stringify(dom));
    ok(dom.thumbFit === 'contain', 'thumbnail uses the calendar floating/contain fit (not cover)', String(dom.thumbFit));

    // ── 2) The unlinked card locks its triggers + shows the warn pile. ──
    const bDom = await page.evaluate((id) => {
      const card = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"]`);
      return {
        lockedTriggers: card.querySelectorAll('.cal-fld-substatus-trigger[disabled]').length,
        warnPile: card.querySelectorAll('.cal-linear-pile .cal-linear-btn-warn').length,
        thumbWarn: !!card.querySelector('.cal-thumb-linear-warn'),
      };
    }, B);
    ok(bDom.lockedTriggers === 0, 'an unlinked card keeps both sub-status triggers actionable (samples has no caption escape hatch → never fully locked)', JSON.stringify(bDom));
    ok(bDom.warnPile === 2 && bDom.thumbWarn, 'an unlinked card shows the orange Linear warn pile + thumb banner', JSON.stringify(bDom));

    // ── 3) The status menu opens (coloured) and a pick changes the sub-status. ──
    const picked = await page.evaluate(async (id) => {
      const trig = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .cal-fld-substatus-trigger[data-sxr-comp-pill="video"]`);
      if (!trig) return { noTrig: true };
      trig.click();
      await new Promise(r => setTimeout(r, 120));
      const menu = document.querySelector('.cal-fld-status-menu.open');
      if (!menu) return { noMenu: true };
      const item = Array.from(menu.querySelectorAll('.cal-fld-status-item')).find(b => /Kasper Approval/i.test(b.textContent || ''));
      const itemBg = item ? getComputedStyle(item).backgroundColor : null;
      if (item) item.click();
      await new Promise(r => setTimeout(r, 250));
      const lbl = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .cal-fld-substatus-trigger[data-sxr-comp-pill="video"] .cal-fld-substatus-label`);
      return { menuColoured: itemBg && itemBg !== 'rgba(0, 0, 0, 0)' && itemBg !== 'transparent', label: lbl ? lbl.textContent.trim() : null };
    }, A);
    ok(picked.menuColoured, 'the status menu items are colour-coded (calendar palette)', JSON.stringify(picked));
    ok(picked.label === 'Kasper Approval', 'picking a status changes the component sub-status in place', JSON.stringify(picked));

    // ── 4) "Set all to…" opens with a header and applies to both linked comps. ──
    const setall = await page.evaluate(async (id) => {
      const btn = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${id}"] .cal-fld-setall`);
      if (!btn) return { noBtn: true };
      btn.click();
      await new Promise(r => setTimeout(r, 120));
      const menu = document.querySelector('.cal-fld-status-menu.open');
      const head = menu ? !!menu.querySelector('.cal-fld-setall-menu-head') : false;
      const item = menu && Array.from(menu.querySelectorAll('.cal-fld-status-item')).find(b => /For SMM Approval/i.test(b.textContent || ''));
      if (item) item.click();
      await new Promise(r => setTimeout(r, 300));
      const labels = Array.from(document.querySelectorAll(`#sxrBody .sxr-card[data-sxr-id="${id}"] .cal-fld-substatus-label`)).map(l => l.textContent.trim());
      return { head, labels };
    }, A);
    ok(setall.head, 'the "Set all to…" menu shows the apply-to-components header');
    ok(setall.labels && setall.labels.every(l => l === 'For SMM Approval'), 'Set all moves every linked component to the chosen status', JSON.stringify(setall));

    await page.screenshot({ path: SHOT, fullPage: false });
    console.log('  SHOT ' + SHOT);

    ok(Q.appErrs(page).length === 0, 'no app JS errors', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    Q.archiveSafe(A); Q.archiveSafe(B);
  }
  console.log(`PROBE sxr_card_visual: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
