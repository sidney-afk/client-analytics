// sxr_cold_open_journey.js — THE cold-open "test like a human" journey.
//
// ZERO seeding for the create. Open the Samples (Review) SMM tab and CREATE a
// sample through the REAL UI exactly as a person would — Add -> fill -> paste
// links -> change status -> comment -> archive -> assert no resurrection — checking
// observable output (DOM + backend rows) at each step, 0 app JS errors throughout.
//
// This is the litmus probe docs/HEADLESS-TESTING-GUIDE.md §3 mandates: delete
// every up(...) seed from the whole suite and THIS one must still prove the
// feature is usable from zero. The "Samples (Review)" tab shipped with no Add
// button and no delete precisely because no probe ever created a sample the way a
// human does — this probe is the regression net for that whole class.
//
// Scoped to sidneylaruel; unique sr_ ids; archives what it creates.
const Q = require('../sxr_courier_lib.js');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else fail++; console.log((c ? '  PASS ' : '  FAIL ') + m + ((!c && x) ? '  -> ' + x : '')); };

const TS = Date.now();
const NAME = 'COLD ' + TS;
const VIDEO_URL = 'https://example.com/cold-' + TS + '.mp4';
const THUMB_URL = 'https://via.placeholder.com/320x180.png?cold=' + TS;
const LINEAR_URL = 'https://linear.app/acme/issue/VID-9' + (TS % 1000) + '/cold-open-probe';

const sel = (rid, extra) => `#sxrBody .sxr-card[data-sxr-id="${rid}"]` + (extra ? ' ' + extra : '');

(async () => {
  const browser = await Q.launch();
  let realId = null;
  let page;
  try {
    page = await Q.smm(browser, 'sidneylaruel');

    // ── 1) An ADD affordance exists (hero when empty, '+' tile otherwise). ──
    const hasAdd = await page.evaluate(() => !!document.querySelector('#sxrBody .sxr-card-add'));
    ok(hasAdd, 'an Add-sample affordance (.sxr-card-add) is present in the grid/empty-state');

    // ── 2) Click Add → a blank editable card appears, name input focused. ──
    if (hasAdd) {
      await page.evaluate(() => { const b = document.querySelector('#sxrBody .sxr-card-add'); if (b) b.click(); });
      await page.waitForTimeout(450);
    }
    const blank = await page.evaluate(() => {
      const inp = document.querySelector('#sxrBody .sxr-card.is-editable .sxr-name-input:not([data-sxr-promoted])');
      const any = document.querySelector('#sxrBody .sxr-card.is-editable .sxr-name-input');
      const t = any || inp;
      return { exists: !!t, focused: !!(t && document.activeElement === t) };
    });
    ok(blank.exists, 'clicking Add inserts a blank editable card with a name input');
    ok(blank.focused, 'the new card name input is auto-focused');

    // ── 3) Type a name → first save promotes blank→real id AND creates the row. ──
    await page.evaluate((nm) => {
      const inp = document.querySelector('#sxrBody .sxr-card.is-editable .sxr-name-input');
      if (!inp) return;
      inp.focus(); inp.value = nm;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('blur', { bubbles: true }));
    }, NAME);

    const row = await Q.poll(() => {
      const r = Q.supa('client=eq.sidneylaruel&name=eq.' + encodeURIComponent(NAME) + '&select=id,name,status,video_status,graphic_status');
      return (Array.isArray(r) && r[0]) ? r[0] : false;
    }, 22000);
    ok(row && row.id && /^sr_/.test(row.id), 'typing a name CREATES a sample_reviews row with a real sr_ id', JSON.stringify(row));
    realId = row && row.id;

    if (realId) {
      const adopted = await page.evaluate((rid) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"]`), realId);
      ok(adopted, 'the on-screen card adopts the real sr_ id (promote, no full reload)', String(realId));
    }

    // ── 4) Paste video + thumbnail URLs → persist. ──
    if (realId) {
      await page.evaluate((o) => {
        const card = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.rid}"]`);
        const setFld = (f, v) => { const i = card && card.querySelector(`.sxr-input[data-sxr-fld="${f}"]`); if (i) { i.focus(); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true })); } };
        setFld('asset_url', o.v); setFld('thumbnail_url', o.t);
      }, { rid: realId, v: VIDEO_URL, t: THUMB_URL });
      const media = await Q.poll(() => {
        const r = Q.supa('id=eq.' + encodeURIComponent(realId) + '&client=eq.sidneylaruel&select=asset_url,thumbnail_url');
        const x = Array.isArray(r) && r[0]; return (x && x.asset_url === VIDEO_URL && x.thumbnail_url === THUMB_URL) ? x : false;
      }, 20000);
      ok(!!media, 'pasting video + thumbnail URLs persists to the backend row', JSON.stringify(media));
    }

    // ── 5) Paste a Linear sub-issue link → persist (commit-guard once Tier 3 lands). ──
    if (realId) {
      await page.evaluate((o) => {
        const card = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${o.rid}"]`);
        const i = card && card.querySelector('.sxr-input[data-sxr-fld="linear_issue_id"]');
        if (i) { i.focus(); i.value = o.l; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('blur', { bubbles: true })); }
      }, { rid: realId, l: LINEAR_URL });
      const lk = await Q.poll(() => {
        const r = Q.supa('id=eq.' + encodeURIComponent(realId) + '&client=eq.sidneylaruel&select=linear_issue_id');
        const x = Array.isArray(r) && r[0]; return (x && String(x.linear_issue_id || '').includes('VID-9')) ? x : false;
      }, 20000);
      ok(!!lk, 'pasting a Linear video sub-issue link persists', JSON.stringify(lk));
    }

    // ── 6) Click a status pill → menu → pick → persists. ──
    if (realId) {
      await page.evaluate((rid) => {
        const pill = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"] .sxr-pill-btn[data-sxr-comp-pill="video"]`);
        if (pill) pill.click();
      }, realId);
      await page.waitForTimeout(300);
      const picked = await page.evaluate(() => {
        const opts = Array.from(document.querySelectorAll('.sxr-status-menu .cal-fld-status-opt'));
        const target = opts.find(o => /For SMM Approval/i.test(o.textContent));
        if (target) { target.click(); return true; }
        return false;
      });
      ok(picked, 'clicking a status pill opens the status menu with options');
      const st = await Q.poll(() => {
        const r = Q.supa('id=eq.' + encodeURIComponent(realId) + '&client=eq.sidneylaruel&select=video_status');
        const x = Array.isArray(r) && r[0]; return (x && x.video_status === 'For SMM Approval') ? x : false;
      }, 20000);
      ok(!!st, 'picking a status updates + persists video_status', JSON.stringify(st));
    }

    // ── 7) Add a comment via the notes modal → persists. ──
    if (realId) {
      const opened = await page.evaluate((rid) => {
        const btn = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"] .sxr-card-foot button`);
        if (btn) { btn.click(); return true; } return false;
      }, realId);
      await page.waitForTimeout(500);
      if (opened) {
        await page.evaluate(() => {
          const ta = document.querySelector('#sxrCommentsModal textarea, .sxr-cm-modal textarea');
          if (ta) { ta.focus(); ta.value = 'cold-open note'; ta.dispatchEvent(new Event('input', { bubbles: true })); }
          const send = document.querySelector('#sxrCommentsModal .sxr-cm-send, .sxr-cm-modal .sxr-cm-send, #sxrCommentsModal button[title*="Send"]');
          if (send) send.click();
        });
        const cm = await Q.poll(() => {
          const r = Q.supa('id=eq.' + encodeURIComponent(realId) + '&client=eq.sidneylaruel&select=video_tweaks');
          const x = Array.isArray(r) && r[0]; return (x && /cold-open note/.test(String(x.video_tweaks || ''))) ? x : false;
        }, 18000);
        ok(!!cm, 'adding a comment persists into *_tweaks', cm ? 'ok' : 'no comment row');
        await page.evaluate(() => { const o = document.getElementById('sxrCommentsOverlay'); if (o) o.classList.remove('open'); if (typeof window.closeSxrComments === 'function') try { window.closeSxrComments(); } catch (e) {} });
        await page.waitForTimeout(300);
      } else {
        ok(false, 'notes button present on the card footer');
      }
    }

    // ── 8) Archive via the corner X → confirm → removed from grid + row Archived + no resurrection. ──
    if (realId) {
      const hasDel = await page.evaluate((rid) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"] .sxr-card-del`), realId);
      ok(hasDel, 'the card has a corner X (archive) button');
      await page.evaluate((rid) => { const d = document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"] .sxr-card-del`); if (d) d.click(); }, realId);
      await page.waitForTimeout(350);
      await page.evaluate(() => { const y = document.getElementById('confirmYes'); if (y) y.click(); });
      const gone = await page.evaluate(async (rid) => {
        for (let i = 0; i < 20; i++) { if (!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"]`)) return true; await new Promise(r => setTimeout(r, 250)); }
        return !document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"]`);
      }, realId);
      ok(gone, 'confirming archive removes the card from the grid (optimistic)');
      const arch = await Q.poll(() => {
        const r = Q.supa('id=eq.' + encodeURIComponent(realId) + '&client=eq.sidneylaruel&select=status');
        const x = Array.isArray(r) && r[0]; return (x && x.status === 'Archived') ? x : false;
      }, 20000);
      ok(!!arch, 'the backend row is flipped to Archived', JSON.stringify(arch));
      // Force a background reload and assert the archived card does NOT resurrect.
      await page.evaluate(() => { try { if (typeof window.loadSxrCards === 'function') window.loadSxrCards(undefined, { skipCache: true, background: true }); } catch (e) {} });
      await page.waitForTimeout(2500);
      const resurrected = await page.evaluate((rid) => !!document.querySelector(`#sxrBody .sxr-card[data-sxr-id="${rid}"]`), realId);
      ok(!resurrected, 'archived card does NOT resurrect on a forced background reload (ledger)');
    }

    // ── 9) No app JS errors across the whole journey. ──
    ok(Q.appErrs(page).length === 0, 'no app JS errors across the cold-open journey', JSON.stringify(Q.appErrs(page).slice(0, 5)));
  } catch (e) {
    ok(false, 'probe ran without crashing', String(e && e.message));
  } finally {
    if (browser) await browser.close();
    // Cleanup: ensure anything created is archived even if the journey aborted early.
    if (realId) Q.archiveSafe(realId);
  }
  console.log(`PROBE sxr_cold_open_journey: pass=${pass} fail=${fail} ` + (fail ? 'FAIL' : 'OK'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
